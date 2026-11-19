// A recording fake AudioContext for node. It makes no sound: it records every node, every connection, every
// source start / stop and every AudioParam call (with the context time at which the call was made), so tests can
// check scheduling, budgets and automation without a browser.
//
//   const ctx = new FakeAudioContext();           // sampleRate 44100, state 'running', currentTime 0
//   ...build the persistent graph...; ctx.markPersistent();   // everything created so far is "the mixer"
//   ctx.currentTime = 1.25;                       // the test owns the clock
//   ...call the code under test...
//   lintSources(ctx), lintEnvelopes(ctx), lintSchedule(ctx), lintGraph(ctx), lintStartValues(ctx),
//   lintAutomation(ctx, { since })                -> arrays of messages, [] = clean
//   valueAt(param, T)                             -> what the automation makes of the parameter at time T
//   nodeRate(ctx), startRate(ctx), liveAt(ctx, T), pendingAt(ctx, T), peakLive(ctx)   -> the budget numbers
//
// What a browser does with the recorded calls is modelled where it was measured (Chromium 153): a source started in
// the past starts now, automation scheduled in the past moves to the currentTime of the call, and a .value write
// is an event at currentTime.
//
// It is deliberately strict:
//   - it throws where a real browser throws (exponential ramp to 0, negative or non-finite times and values,
//     start() twice, stop() before start(), a second buffer on a buffer source, connecting across contexts, ...);
//   - it also throws where a browser would fail SILENTLY (an unknown oscillator / filter type string is ignored by
//     browsers; here it is an error), because nobody on this project can hear a silent failure;
//   - every method of the real API that is not implemented here throws by name, and every object is sealed, so a
//     misspelt property (gain.gain.vlaue = 0) or an expando on a node is a TypeError instead of a no-op (in strict
//     code, which every ES module is).
// Extend this file when the engine needs more of the API; never loosen it.

const dom = (name, msg) => new DOMException(msg, name);
const num = (v, what) => { if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`${what}: the provided value (${v}) is non-finite`); return v; };
const time = (v, what) => { num(v, what); if (v < 0) throw new RangeError(`${what}: time (${v}) must be a finite non-negative number`); return v; };
const OSC_TYPES = ['sine', 'square', 'sawtooth', 'triangle'];
const BIQUAD_TYPES = ['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'peaking', 'notch', 'allpass'];

class FakeParam {
  constructor(node, name, def, min, max) {
    this.node = node; this.name = name; this.defaultValue = def; this.minValue = min; this.maxValue = max;
    this.ev = [];        // every call in call order: { k: 'value'|'set'|'lin'|'exp'|'target'|'cancel', v, t, tc, at }; at = currentTime of the call
    this.nIn = 0;        // audio-rate connections into this param
    this.reads = 0;      // how often .value was read (the engine must keep its own shadow values)
    Object.seal(this);
  }
  get label() { return `${this.node.label}.${this.name}`; }
  _rec(k, v, t, tc) { this.ev.push({ k, v, t, tc, at: this.node.ctx.currentTime }); this.node.ctx.calls++; return this; }
  _range(v, what) { if (v < this.minValue || v > this.maxValue) this.node.ctx.warnings.push(`${this.label} ${what}: ${v} is outside the nominal range [${this.minValue}, ${this.maxValue}] (a browser clamps it)`); }
  get value() { this.reads++; return valueAt(this, this.node.ctx.currentTime); }
  set value(v) { num(v, `${this.label}.value`); this._range(v, 'value'); this._rec('value', v, this.node.ctx.currentTime, 0); }   // an event at currentTime, as in a browser
  setValueAtTime(v, t) { num(v, `${this.label}.setValueAtTime`); time(t, `${this.label}.setValueAtTime`); this._range(v, 'setValueAtTime'); return this._rec('set', v, t, 0); }
  linearRampToValueAtTime(v, t) { num(v, `${this.label}.linearRampToValueAtTime`); time(t, `${this.label}.linearRampToValueAtTime`); this._range(v, 'linearRamp'); return this._rec('lin', v, t, 0); }
  exponentialRampToValueAtTime(v, t) {
    num(v, `${this.label}.exponentialRampToValueAtTime`); time(t, `${this.label}.exponentialRampToValueAtTime`);
    if (v === 0) throw new RangeError(`${this.label}.exponentialRampToValueAtTime: the float target value provided (0) should not be zero`);
    this._range(v, 'exponentialRamp'); return this._rec('exp', v, t, 0);
  }
  setTargetAtTime(v, t, tc) {
    num(v, `${this.label}.setTargetAtTime`); time(t, `${this.label}.setTargetAtTime`); num(tc, `${this.label}.setTargetAtTime timeConstant`);
    if (tc < 0) throw new RangeError(`${this.label}.setTargetAtTime: the time constant (${tc}) must be non-negative`);
    this._range(v, 'setTarget'); return this._rec('target', v, t, tc);
  }
  cancelScheduledValues(t) { time(t, `${this.label}.cancelScheduledValues`); return this._rec('cancel', 0, t, 0); }
  cancelAndHoldAtTime() { throw new Error(`fakectx: ${this.label}.cancelAndHoldAtTime is not implemented (spec section 5 bans it, and Firefox lacks it)`); }
  setValueCurveAtTime() { throw new Error(`fakectx: ${this.label}.setValueCurveAtTime is not implemented`); }
}

class FakeNode {
  constructor(ctx, kind, nIn, nOut) {
    this.ctx = ctx; this.kind = kind; this.id = ctx._id++; this.born = ctx.currentTime;
    this.numberOfInputs = nIn; this.numberOfOutputs = nOut;
    this.outs = [];            // FakeNode | FakeParam, one entry per connect()
    this.nIn = 0;              // connections into this node
    this.persistent = false;   // set by ctx.markPersistent()
    ctx._reg(this);
  }
  get label() { return `${this.kind}#${this.id}`; }
  connect(dest, output = 0, input = 0) {
    const isNode = dest instanceof FakeNode, isParam = dest instanceof FakeParam;
    if (!isNode && !isParam) throw new TypeError(`${this.label}.connect: parameter 1 is not an AudioNode or AudioParam (${dest === undefined ? 'undefined' : dest === null ? 'null' : typeof dest})`);
    if ((isNode ? dest.ctx : dest.node.ctx) !== this.ctx) throw dom('InvalidAccessError', `${this.label}.connect: cannot connect to a destination belonging to a different audio context`);
    if (output !== 0 || output >= this.numberOfOutputs) throw dom('IndexSizeError', `${this.label}.connect: output index (${output}) exceeds number of outputs (${this.numberOfOutputs})`);
    if (isNode && (input !== 0 || input >= dest.numberOfInputs)) throw dom('IndexSizeError', `${this.label}.connect: input index (${input}) exceeds number of inputs (${dest.numberOfInputs})`);
    if (!this.outs.includes(dest)) { this.outs.push(dest); dest.nIn++; this.ctx.connections++; }   // a repeated connection is a no-op, as in a browser
    return isNode ? dest : undefined;
  }
  disconnect(dest) {
    if (dest === undefined) { for (const d of this.outs) d.nIn--; this.outs.length = 0; return; }
    const i = this.outs.indexOf(dest);
    if (i < 0) throw dom('InvalidAccessError', `${this.label}.disconnect: the given destination is not connected`);
    this.outs.splice(i, 1); dest.nIn--;
  }
}

class Destination extends FakeNode { constructor(ctx) { super(ctx, 'destination', 1, 0); this.maxChannelCount = 2; Object.seal(this); } }
class Gain extends FakeNode { constructor(ctx) { super(ctx, 'gain', 1, 1); this.gain = new FakeParam(this, 'gain', 1, -3.4e38, 3.4e38); Object.seal(this); } }
class Delay extends FakeNode {
  constructor(ctx, max) { super(ctx, 'delay', 1, 1); this.maxDelayTime = max; this.delayTime = new FakeParam(this, 'delayTime', 0, 0, max); Object.seal(this); }
}
class Biquad extends FakeNode {
  constructor(ctx) {
    super(ctx, 'biquad', 1, 1); this._type = 'lowpass';
    this.frequency = new FakeParam(this, 'frequency', 350, 0, ctx.sampleRate / 2); this.detune = new FakeParam(this, 'detune', 0, -153600, 153600);
    this.Q = new FakeParam(this, 'Q', 1, -3.4e38, 3.4e38); this.gain = new FakeParam(this, 'gain', 0, -3.4e38, 1541);
    Object.seal(this);
  }
  get type() { return this._type; }
  set type(v) { if (!BIQUAD_TYPES.includes(v)) throw new Error(`fakectx: ${this.label}.type = ${JSON.stringify(v)} is not a BiquadFilterType (a browser silently ignores this)`); this._type = v; }
  getFrequencyResponse() { throw new Error('fakectx: BiquadFilterNode.getFrequencyResponse is not implemented'); }
}
class Shaper extends FakeNode {
  constructor(ctx) { super(ctx, 'shaper', 1, 1); this._curve = null; this._over = 'none'; Object.seal(this); }
  get curve() { return this._curve; }
  set curve(v) {
    if (v !== null) { if (!(v instanceof Float32Array)) throw new TypeError(`${this.label}.curve: not a Float32Array`); if (v.length < 2) throw dom('InvalidAccessError', `${this.label}.curve: the curve length (${v.length}) is less than the minimum bound (2)`); }   // Chromium's name for it (the spec says InvalidStateError)
    this._curve = v;
  }
  get oversample() { return this._over; }
  set oversample(v) { if (!['none', '2x', '4x'].includes(v)) throw new Error(`fakectx: ${this.label}.oversample = ${JSON.stringify(v)} is not an OverSampleType (a browser silently ignores this)`); this._over = v; }
}
class Compressor extends FakeNode {
  constructor(ctx) {
    super(ctx, 'compressor', 1, 1);
    this.threshold = new FakeParam(this, 'threshold', -24, -100, 0); this.knee = new FakeParam(this, 'knee', 30, 0, 40); this.ratio = new FakeParam(this, 'ratio', 12, 1, 20);
    this.attack = new FakeParam(this, 'attack', 0.003, 0, 1); this.release = new FakeParam(this, 'release', 0.25, 0, 1); this.reduction = 0;
    Object.seal(this);
  }
}
class Source extends FakeNode {
  constructor(ctx, kind) {
    super(ctx, kind, 0, 1);
    this.t0 = null; this.t1 = null;          // effective start / stop time: max(requested, currentTime of the call), as a browser plays it
    this.w0 = null; this.w1 = null;          // the times that were asked for
    this.startAt = null; this.stopAt = null; // currentTime of the start() / stop() call
    this.onended = null;
  }
  _start(when) {
    time(when, `${this.label}.start`);
    if (this.t0 !== null) throw dom('InvalidStateError', `${this.label}.start: cannot call start more than once`);
    const now = this.ctx.currentTime;
    this.w0 = when; this.t0 = when > now ? when : now; this.startAt = now; this.ctx.sources.push(this);
    (this.kind === 'osc' ? this.ctx.oscStarts : this.ctx.bufStarts).push(this.t0);
  }
  stop(when = 0) {
    time(when, `${this.label}.stop`);
    if (this.t0 === null) throw dom('InvalidStateError', `${this.label}.stop: cannot call stop without calling start first`);
    const now = this.ctx.currentTime;
    this.w1 = when; this.t1 = when > now ? when : now; this.stopAt = now;   // a later stop() replaces an earlier one
  }
}
class Osc extends Source {
  constructor(ctx) {
    super(ctx, 'osc'); this._type = 'sine'; this.wave = null;
    this.frequency = new FakeParam(this, 'frequency', 440, -ctx.sampleRate / 2, ctx.sampleRate / 2); this.detune = new FakeParam(this, 'detune', 0, -153600, 153600);
    Object.seal(this);
  }
  get type() { return this._type; }
  set type(v) {
    if (v === 'custom') throw dom('InvalidStateError', `${this.label}.type: 'custom' can only be set through setPeriodicWave()`);
    if (!OSC_TYPES.includes(v)) throw new Error(`fakectx: ${this.label}.type = ${JSON.stringify(v)} is not an OscillatorType (a browser silently ignores this)`);
    this._type = v; this.wave = null;
  }
  setPeriodicWave(w) {
    if (!(w instanceof FakePeriodicWave)) throw new TypeError(`${this.label}.setPeriodicWave: parameter 1 is not of type 'PeriodicWave'`);
    if (w.ctx !== this.ctx) throw dom('InvalidAccessError', `${this.label}.setPeriodicWave: the wave belongs to a different audio context`);
    this.wave = w; this._type = 'custom';
  }
  start(when = 0) { this._start(when); }
}
class BufferSource extends Source {
  constructor(ctx) {
    super(ctx, 'bufsrc'); this._buf = null; this.offset = 0; this.loop = false; this.loopStart = 0; this.loopEnd = 0;
    this.playbackRate = new FakeParam(this, 'playbackRate', 1, -3.4e38, 3.4e38); this.detune = new FakeParam(this, 'detune', 0, -3.4e38, 3.4e38);
    Object.seal(this);
  }
  get buffer() { return this._buf; }
  set buffer(b) {
    if (b !== null && !(b instanceof FakeBuffer)) throw new TypeError(`${this.label}.buffer: the provided value is not of type 'AudioBuffer'`);
    if (b !== null && this._buf !== null) throw dom('InvalidStateError', `${this.label}.buffer: cannot set buffer to non-null after it has been already been set to a non-null buffer`);
    this._buf = b;
  }
  start(when = 0, offset = 0, duration) {
    time(offset, `${this.label}.start offset`); if (duration !== undefined) time(duration, `${this.label}.start duration`);
    this._start(when); this.offset = offset;
    if (this._buf === null) this.ctx.warnings.push(`${this.label} was started without a buffer (a browser plays silence)`);
  }
}
class FakeBuffer {
  constructor(channels, length, sampleRate) {
    this.numberOfChannels = channels; this.length = length; this.sampleRate = sampleRate; this.duration = length / sampleRate;
    this._d = []; for (let i = 0; i < channels; i++) this._d.push(new Float32Array(length));
    Object.seal(this);
  }
  getChannelData(c) { if (!(c >= 0 && c < this.numberOfChannels)) throw dom('IndexSizeError', `AudioBuffer.getChannelData: channel index (${c}) exceeds number of channels (${this.numberOfChannels})`); return this._d[c]; }
  copyToChannel(src, c, start = 0) { this.getChannelData(c).set(src.subarray(0, Math.max(0, this.length - start)), start); }
  copyFromChannel(dst, c, start = 0) { dst.set(this.getChannelData(c).subarray(start, start + dst.length)); }
}
class FakePeriodicWave {
  constructor(ctx, real, imag, disableNormalization) { this.ctx = ctx; this.real = Float32Array.from(real); this.imag = Float32Array.from(imag); this.disableNormalization = disableNormalization; Object.freeze(this); }
}

export class FakeAudioContext {
  constructor({ sampleRate = 44100, state = 'running' } = {}) {
    this.sampleRate = sampleRate; this._t = 0;
    this.state = state;              // tests may set 'suspended' | 'interrupted' (iOS) | 'running' | 'closed'
    this._id = 0;
    this.nodes = [];                 // every node still on record (prune() drops finished voices)
    this.sources = [];               // every source that was start()ed, in call order
    this.waves = [];                 // every PeriodicWave created
    this.warnings = [];              // things a browser accepts silently but that are almost certainly bugs
    this.count = { total: 0 };       // cumulative node creations by kind; never reset by prune()
    this.births = [];                // currentTime at each node creation (cumulative)
    this.oscStarts = [];             // scheduled start time of every oscillator (cumulative)
    this.bufStarts = [];             // scheduled start time of every buffer source (cumulative)
    this.connections = 0; this.calls = 0; this.buffers = 0; this.resumes = 0; this.suspends = 0;
    this.onstatechange = null;
    this.destination = null;
    Object.seal(this);
    this.destination = new Destination(this); this.destination.persistent = true;
    this.count.total = 0; this.count.destination = 0; this.births.length = 0;   // the destination is not a creation
  }
  _reg(n) { this.nodes.push(n); this.count[n.kind] = (this.count[n.kind] || 0) + 1; this.count.total++; this.births.push(this._t); }
  get currentTime() { return this._t; }
  set currentTime(v) { num(v, 'currentTime'); if (v < 0) throw new RangeError('fakectx: currentTime must be >= 0'); this._t = v; }

  createGain() { return new Gain(this); }
  createOscillator() { return new Osc(this); }
  createBiquadFilter() { return new Biquad(this); }
  createDynamicsCompressor() { return new Compressor(this); }
  createWaveShaper() { return new Shaper(this); }
  createBufferSource() { return new BufferSource(this); }
  createDelay(maxDelayTime = 1) {
    num(maxDelayTime, 'createDelay');
    if (maxDelayTime <= 0 || maxDelayTime >= 180) throw dom('NotSupportedError', `createDelay: the max delay time provided (${maxDelayTime}) is outside the range (0, 180)`);
    return new Delay(this, maxDelayTime);
  }
  createBuffer(channels, length, sampleRate) {
    if (!(Number.isInteger(channels) && channels >= 1 && channels <= 32)) throw dom('NotSupportedError', `createBuffer: the number of channels provided (${channels}) is outside the range [1, 32]`);
    if (!(Number.isInteger(length) && length >= 1)) throw dom('NotSupportedError', `createBuffer: the number of frames provided (${length}) is less than or equal to the minimum bound (0)`);
    if (!(sampleRate >= 3000 && sampleRate <= 768000)) throw dom('NotSupportedError', `createBuffer: the sample rate provided (${sampleRate}) is outside the range [3000, 768000]`);
    this.buffers++; return new FakeBuffer(channels, length, sampleRate);
  }
  createPeriodicWave(real, imag, constraints) {
    const arr = a => a instanceof Float32Array || Array.isArray(a);
    if (!arr(real) || !arr(imag)) throw new TypeError('createPeriodicWave: real and imag must be sequences of numbers');
    if (real.length !== imag.length) throw dom('IndexSizeError', `createPeriodicWave: length of real array (${real.length}) and length of imaginary array (${imag.length}) must match`);
    if (real.length < 2) throw dom('IndexSizeError', `createPeriodicWave: the length of the real array provided (${real.length}) is less than the minimum bound (2)`);
    for (let i = 0; i < real.length; i++) { num(real[i], 'createPeriodicWave real'); num(imag[i], 'createPeriodicWave imag'); }
    if (constraints !== undefined && (constraints === null || typeof constraints !== 'object')) throw new TypeError('createPeriodicWave: parameter 3 is not an object');
    const w = new FakePeriodicWave(this, real, imag, !!(constraints && constraints.disableNormalization)); this.waves.push(w); return w;
  }
  resume() { if (this.state === 'closed') return Promise.reject(dom('InvalidStateError', 'resume: cannot resume a closed AudioContext')); this.state = 'running'; this.resumes++; return Promise.resolve(); }
  suspend() { if (this.state === 'closed') return Promise.reject(dom('InvalidStateError', 'suspend: cannot suspend a closed AudioContext')); this.state = 'suspended'; this.suspends++; return Promise.resolve(); }

  // ----- test helpers (not part of the Web Audio API)
  // Everything created so far is the persistent mixer graph; everything created later is a voice.
  markPersistent() { let n = 0; for (const x of this.nodes) if (!x.persistent) { x.persistent = true; n++; } return n; }
  // Forget finished voices (soak tests): drops non-persistent nodes born before `before` whose sources have stopped
  // before it. Cumulative counters, births and start times are kept.
  prune(before) {
    const dead = n => !n.persistent && n.born < before && (!(n instanceof Source) || (n.t0 !== null && n.t1 !== null && n.t1 < before));
    this.nodes = this.nodes.filter(n => !dead(n)); this.sources = this.sources.filter(n => !dead(n));
  }
}
// Everything else in BaseAudioContext throws by name, so a feature test (`if (ctx.createStereoPanner)`) cannot
// quietly take a path that was never exercised here.
for (const m of ['createAnalyser', 'createConvolver', 'createStereoPanner', 'createPanner', 'createConstantSource', 'createChannelMerger', 'createChannelSplitter',
  'createIIRFilter', 'createScriptProcessor', 'createMediaElementSource', 'createMediaStreamSource', 'createMediaStreamDestination', 'decodeAudioData', 'close',
  'startRendering', 'getOutputTimestamp', 'addEventListener', 'removeEventListener'])
  Object.defineProperty(FakeAudioContext.prototype, m, { value() { throw new Error(`fakectx: AudioContext.${m} is not implemented`); } });
for (const p of ['audioWorklet', 'listener', 'baseLatency', 'outputLatency'])
  Object.defineProperty(FakeAudioContext.prototype, p, { get() { throw new Error(`fakectx: AudioContext.${p} is not implemented`); } });

// ---------------------------------------------------------------------------------------------------------------
// Automation evaluator: the value an AudioParam has at time T, from its recorded calls (Web Audio semantics:
// events are kept in time order, ties in call order; a ramp runs from the previous event to its own end time;
// setTarget decays towards its target until the next event; cancelScheduledValues drops events at or after t).
// An event whose time was already past when it was scheduled is moved to the currentTime of the call, as the
// spec says and as Chromium was measured to do: that is what makes a late setTarget attack collapse to silence.
export function timeline(param) {
  const tl = [];
  for (const e0 of param.ev) {
    const e = e0.k !== 'cancel' && e0.t < e0.at ? { ...e0, t: e0.at } : e0;
    if (e.k === 'cancel') { for (let i = tl.length - 1; i >= 0; i--) if (tl[i].t >= e.t) tl.splice(i, 1); continue; }
    let i = tl.length; while (i > 0 && tl[i - 1].t > e.t) i--;
    tl.splice(i, 0, e);
  }
  return tl;
}
export function valueAt(param, T) {
  const tl = timeline(param);
  let v = param.defaultValue, seg = null;      // seg = the running setTarget, if any
  const cur = t => seg ? (seg.tc > 0 ? seg.v + (seg.v0 - seg.v) * Math.exp(-(t - seg.t) / seg.tc) : seg.v) : v;
  let prevT = 0;
  for (let i = 0; i < tl.length; i++) {
    const e = tl[i];
    if (e.k === 'lin' || e.k === 'exp') {
      const v0 = seg ? seg.v0 : v, t0 = prevT;   // a ramp after a setTarget replaces it (starts from the value before the target)
      if (T < e.t) {
        if (T <= t0) return v0;
        const x = (T - t0) / (e.t - t0);
        return e.k === 'lin' ? v0 + (e.v - v0) * x : (v0 > 0 && e.v > 0) || (v0 < 0 && e.v < 0) ? v0 * Math.pow(e.v / v0, x) : v0;
      }
      v = e.v; seg = null; prevT = e.t; continue;
    }
    if (e.t > T) break;
    if (e.k === 'target') { const v0 = cur(e.t); v = v0; seg = { v: e.v, v0, t: e.t, tc: e.tc }; }
    else { v = e.v; seg = null; }                // 'set' and 'value'
    prevT = e.t;
  }
  return cur(T);
}

// ---------------------------------------------------------------------------------------------------------------
// Lint helpers. Each returns an array of messages; an empty array is a pass. `max` caps the list.
const sched = e => e.k === 'set' || e.k === 'lin' || e.k === 'exp' || e.k === 'target';
const params = n => { const out = []; for (const k of Object.keys(n)) if (n[k] instanceof FakeParam) out.push(n[k]); return out; };
const isSource = n => n instanceof Source;
const toZero = e => (e.k === 'target' && e.v === 0) || ((e.k === 'lin' || e.k === 'exp') && Math.abs(e.v) <= 1e-3) || (e.k === 'set' && e.v === 0);

// Every source that was created was started, every started source has a stop time after its start, and a buffer
// source starts on a sample frame.
export function lintSources(ctx, max = 20) {
  const out = [];
  for (const n of ctx.nodes) {
    if (!isSource(n) || out.length >= max) continue;
    if (n.t0 === null) out.push(`${n.label} was created (t=${n.born}) but never started`);
    else if (n.t1 === null) out.push(`${n.label} started at ${n.t0} has no stop time`);
    else if (!(n.t1 > n.t0)) out.push(`${n.label} stops at ${n.t1}, not after its start at ${n.t0}`);
    if (n.kind === 'bufsrc' && n.t0 !== null && n.buffer === null) out.push(`${n.label} was started without a buffer`);
    if (n.kind === 'bufsrc' && n.t0 !== null && n.w0 >= n.startAt) {   // measured in Chromium: started off the sample grid, a buffer is interpolated for its whole life (white noise up to -3.2 dB, a hat -4.5 dB)
      const off = Math.abs(n.w0 * ctx.sampleRate - Math.round(n.w0 * ctx.sampleRate));
      if (off > 1e-6) out.push(`${n.label} starts at ${n.w0}, ${off.toFixed(3)} of a sample off the sample grid (the buffer would be interpolated)`);
    }
  }
  return out;
}

// Envelope rules for voices (non-persistent nodes):
//  1. on every AudioParam the scheduled segments are in time order in the order they were called;
//  2. on every gain envelope that ends at zero, the attack comes first: a ramp or setValueAtTime attack is complete
//     no later than the decay that follows it, a setTarget attack starts strictly before the final release;
//  3. no exponential ramp starts from zero / across zero (browsers hold, then jump), no ramp follows a setTarget,
//     and no linear ramp on a gain is followed by a setTarget (measured hazard on late calls);
//  4. every source feeds an envelope that reaches zero, and stops no earlier than `k` time constants after that
//     decay began (ramps: no earlier than the ramp's end). Sources that only modulate an AudioParam are exempt.
export function lintEnvelopes(ctx, { k = 7, max = 20, eps = 1e-9 } = {}) {
  const out = [], add = m => { if (out.length < max) out.push(m); };
  for (const n of ctx.nodes) {
    if (n.persistent) continue;
    for (const p of params(n)) {
      const ev = p.ev.filter(sched);
      for (let i = 1; i < ev.length; i++) {
        if (ev[i].t < ev[i - 1].t - eps) add(`${p.label}: segment ${i} (${ev[i].k} at ${ev[i].t}) is scheduled before segment ${i - 1} (${ev[i - 1].k} at ${ev[i - 1].t})`);
        if ((ev[i].k === 'lin' || ev[i].k === 'exp') && ev[i - 1].k === 'target') add(`${p.label}: a ramp follows a setTarget (browser-dependent start value)`);
        if (ev[i].k === 'target' && ev[i - 1].k === 'lin' && n.kind === 'gain') add(`${p.label}: a linear ramp is followed by a setTarget (when the call is late Chromium collapses the ramp: measured silent 7/48, gain 1.0 4/48)`);
        if (ev[i].k === 'exp' && !(ev[i - 1].v * ev[i].v > 0)) add(`${p.label}: exponential ramp from ${ev[i - 1].v} to ${ev[i].v} (no curve: browsers hold then jump)`);
      }
      if (ev.length && ev[0].k === 'exp') add(`${p.label}: exponential ramp with no preceding event`);
      if (n.kind !== 'gain' || p.name !== 'gain' || !ev.length || !toZero(ev[ev.length - 1])) continue;
      const a = ev.findIndex(e => e.v > 0);
      let r = ev.length - 1; while (r > 0 && toZero(ev[r - 1]) && ev[r - 1].k === 'target') r--;   // first of the trailing decays
      if (a < 0) add(`${p.label}: envelope never rises above zero`);
      else if (a > r) add(`${p.label}: the release (segment ${r}) is scheduled before the attack (segment ${a})`);
      else if (ev[a].k === 'target' ? !(ev[a].t < ev[ev.length - 1].t - eps) : ev[a].t > ev[r].t + eps) add(`${p.label}: attack at ${ev[a].t} does not precede the release at ${ev[ev.length - 1].t}`);   // a ramp or a set attack is complete at its own time
    }
  }
  for (const s of ctx.sources) {
    if (s.persistent || s.t1 === null) continue;
    const seen = new Set(), envs = []; let audible = false;
    const walk = n => {
      for (const d of n.outs) {
        if (d instanceof FakeParam) continue;                          // modulation path
        if (d.persistent) { audible = true; continue; }                // reached the mixer
        if (seen.has(d)) continue; seen.add(d);
        if (d.kind === 'gain' && d.gain.ev.some(sched)) envs.push(d);
        walk(d);
      }
    };
    walk(s);
    if (!audible) continue;
    const zeros = envs.filter(g => { const ev = g.gain.ev.filter(sched); return toZero(ev[ev.length - 1]); });
    if (!zeros.length) { add(`${s.label} reaches the mixer without an envelope that ends at zero`); continue; }
    for (const g of zeros) {
      const ok = g.gain.ev.some(e => sched(e) && toZero(e) && (e.k === 'target' ? e.t + k * e.tc : e.t) <= s.t1 + eps);
      if (!ok) { const e = g.gain.ev.filter(sched).pop(); add(`${s.label} stops at ${s.t1}, only ${((s.t1 - e.t) / (e.tc || 1)).toFixed(2)} time constants after the release at ${e.t} (${g.label}); need ${k}`); }
    }
  }
  return out;
}

// Start values, both measured in Chromium 153:
//  - an automated parameter of a SOURCE (oscillator frequency / detune, buffer playbackRate) must begin with
//    setValueAtTime and its intrinsic .value must already hold that first value: Chromium plays the rest of the
//    source's first render quantum at the intrinsic value (440 Hz for up to 2.9 ms on an oscillator);
//  - a voice GAIN that carries an envelope must never be written through .value: the write is an event at
//    currentTime, so on a call that arrives late it lands after the envelope and holds the gain until the cut.
export function lintStartValues(ctx, max = 20) {
  const out = [];
  for (const n of ctx.nodes) {
    if (n.persistent || out.length >= max) continue;
    if (n.kind === 'gain' && n.gain.ev.some(sched) && n.gain.ev.some(e => e.k === 'value')) out.push(`${n.label}.gain: an envelope gain is also written through .value (a late call would stick at that value)`);
    if (!isSource(n)) continue;
    for (const p of params(n)) {
      const i = p.ev.findIndex(sched); if (i < 0) continue;
      const first = p.ev[i]; let v = p.defaultValue; for (let j = 0; j < i; j++) if (p.ev[j].k === 'value') v = p.ev[j].v;
      if (first.k !== 'set') out.push(`${p.label}: automation begins with ${first.k}, not setValueAtTime`);
      else if (Math.abs(v - first.v) > 1e-9 * Math.max(1, Math.abs(first.v))) out.push(`${p.label}: intrinsic value ${v} differs from the first scheduled value ${first.v}`);
    }
  }
  return out;
}

// Nothing is scheduled in the past: every automation time, start and stop is >= the currentTime of its call.
export function lintSchedule(ctx, { eps = 1e-9, max = 20, persistent = true } = {}) {
  const out = [];
  for (const n of ctx.nodes) {
    if (out.length >= max) break;
    if (n.persistent && !persistent) continue;
    for (const p of params(n)) for (const e of p.ev) if (sched(e) && e.t < e.at - eps && out.length < max) out.push(`${p.label}: ${e.k} scheduled for ${e.t} at currentTime ${e.at}`);
    if (isSource(n) && n.t0 !== null) {
      if (n.w0 < n.startAt - eps) out.push(`${n.label}: start(${n.w0}) called at currentTime ${n.startAt}`);
      if (n.w1 !== null && n.w1 < n.stopAt - eps) out.push(`${n.label}: stop(${n.w1}) called at currentTime ${n.stopAt}`);
    }
  }
  return out;
}

// Every started voice reaches the destination (through the persistent graph) or modulates a parameter, and no
// voice node is left unconnected.
export function lintGraph(ctx, max = 20) {
  const out = [], memo = new Map();
  const reaches = n => {
    if (n === ctx.destination) return true;
    if (memo.has(n)) return memo.get(n);
    memo.set(n, false);
    let ok = false; for (const d of n.outs) if (reaches(d instanceof FakeParam ? d.node : d)) { ok = true; break; }   // a modulator counts if what it modulates is heard
    memo.set(n, ok); return ok;
  };
  for (const n of ctx.nodes) {
    if (out.length >= max) break;
    if (n.persistent) continue;
    if (!n.outs.length) out.push(`${n.label} is not connected to anything`);
    else if (isSource(n) && !reaches(n)) out.push(`${n.label} never reaches the destination`);
    if (!isSource(n) && n.nIn === 0 && params(n).every(p => p.nIn === 0)) out.push(`${n.label} has no input`);
  }
  return out;
}

// Rules of spec section 5 for the persistent graph, for events recorded after `since` (the end of init):
// parameters move only by setTargetAtTime with a time constant of at least 5 ms (gains) or 15 ms (frequencies),
// are never written through .value, never ramped, never cancelled, and .value is never read.
// `allow(param, event)` can exempt a documented exception (the DJ echo's delayTime).
export function lintAutomation(ctx, { since = 0, max = 20, allow = null } = {}) {
  const out = [];
  for (const n of ctx.nodes) {
    if (!n.persistent || out.length >= max) continue;
    for (const p of params(n)) {
      if (p.reads) out.push(`${p.label}.value was read ${p.reads} time(s); keep a JS shadow value`);
      for (const e of p.ev) {
        if (e.at < since || (allow && allow(p, e)) || out.length >= max) continue;
        if (e.k !== 'target') out.push(`${p.label}: ${e.k === 'value' ? '.value write' : e.k} at currentTime ${e.at} (only setTargetAtTime is allowed on persistent nodes)`);
        else if (e.tc < (p.name === 'frequency' ? 0.015 : 0.005) - 1e-12) out.push(`${p.label}: setTargetAtTime time constant ${e.tc} is below the ${p.name === 'frequency' ? 15 : 5} ms floor`);
      }
    }
  }
  return out;
}

// Largest number of `times` inside any half-open window of `w` seconds.
export function maxInWindow(times, w = 1) {
  const a = Float64Array.from(times).sort(); let best = 0;
  for (let i = 0, j = 0; i < a.length; i++) { while (a[i] - a[j] >= w) j++; if (i - j + 1 > best) best = i - j + 1; }
  return best;
}
// Node creations in the busiest window, by the currentTime at which they were created.
export const nodeRate = (ctx, w = 1) => maxInWindow(ctx.births, w);
// Source starts in the busiest window, by scheduled start time. kind: 'osc' (the spec's ceiling) | 'buf' | 'all'.
export const startRate = (ctx, w = 1, kind = 'osc') => maxInWindow(kind === 'osc' ? ctx.oscStarts : kind === 'buf' ? ctx.bufStarts : ctx.oscStarts.concat(ctx.bufStarts), w);
// Sources sounding at time T (started, not yet stopped).
export function liveAt(ctx, T) { let n = 0; for (const s of ctx.sources) if (s.t0 <= T && (s.t1 === null || s.t1 > T)) n++; return n; }
// Sources whose stop time is still ahead of T, sounding or still waiting to start (what Synth.live(T) reports).
export function pendingAt(ctx, T) { let n = 0; for (const s of ctx.sources) if (s.t1 === null || s.t1 > T) n++; return n; }
// Peak number of simultaneously sounding sources in [from, to].
export function peakLive(ctx, from = 0, to = Infinity) {
  const ev = []; for (const s of ctx.sources) { ev.push([s.t0, 1]); if (s.t1 !== null) ev.push([s.t1, -1]); }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);      // at one instant, stops count before starts
  let cur = 0, peak = 0; for (const [t, d] of ev) { if (t > to) break; cur += d; if (t >= from && cur > peak) peak = cur; }
  return Math.max(peak, liveAt(ctx, from));
}
// All nodes reachable downstream of `node` without entering the persistent graph (the voice a source belongs to).
export function voiceOf(node) { const seen = new Set([node]); const walk = n => { for (const d of n.outs) { const m = d instanceof FakeParam ? d.node : d; if (!m.persistent && !seen.has(m)) { seen.add(m); walk(m); } } }; walk(node); return [...seen]; }

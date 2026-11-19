// src/synth.js on the fake AudioContext. The fake context is the measuring instrument, so it is tested first:
// it must throw where a browser throws and its lints must catch the defects they exist for (negative controls).
import { FakeAudioContext, lintSources, lintEnvelopes, lintSchedule, lintGraph, lintStartValues, lintAutomation, valueAt, maxInWindow, nodeRate, startRate, liveAt, pendingAt, peakLive, voiceOf } from '../fakectx.mjs';
import { Synth, PATCH, KITS, TRIM, ELEM_INST, WAVES, ORN_MIN, ORN_TIER2, DRIVE, mtof } from '../../src/synth.js';

const PATCHES = ['square', 'sawlead', 'fiddle', 'flute', 'brass', 'clav', 'vibes', 'marimba', 'epiano', 'harpsi', 'pluck', 'nylon', 'organ', 'strings', 'dist', 'bell', 'pulse25', 'synbass', 'finger', 'slap', 'organbass'];
const BASSES = ['synbass', 'finger', 'slap', 'organbass'];
const KIT_NAMES = ['rock', 'tight', 'disco', 'brush', 'hand', 'court', 'folk', 'chip'];
const DRUMS = ['kick', 'snare', 'clap', 'rim', 'tom1', 'tom2', 'tom3', 'timp', 'hat', 'ohat', 'pedal', 'ride', 'crash', 'shaker', 'tamb', 'cow', 'brush'];
const BUILTIN = ['sine', 'square', 'sawtooth', 'triangle'];
const OVER = 1 / (1 - Math.exp(-3)), EPS = 1e-9;

const seeded = (s = 99) => () => (s = (s * 16807) % 2147483647) / 2147483647;
// a context with the three buses a voice can play into, marked persistent, and a Synth on it
function rig(opts = {}) {
  const ctx = new FakeAudioContext(), out = ctx.createGain(), send = ctx.createGain(), dist = ctx.createGain();
  for (const n of [out, send, dist]) n.connect(ctx.destination);
  ctx.markPersistent();
  const syn = new Synth(ctx, { rand: seeded(opts.seed) });
  return { ctx, out, send, dist, syn, route: { out, send, dist } };
}
const lintAll = ctx => [...lintSources(ctx), ...lintEnvelopes(ctx), ...lintSchedule(ctx), ...lintGraph(ctx), ...lintStartValues(ctx), ...ctx.warnings];
const voices = ctx => ctx.nodes.filter(n => !n.persistent);
const sched = p => p.ev.filter(e => e.k !== 'value' && e.k !== 'cancel');
const intrinsic = p => { let v = p.defaultValue; for (const e of p.ev) { if (e.k !== 'value') break; v = e.v; } return v; };
const errName = fn => { try { fn(); } catch (e) { return e.name; } return null; };
const close = (a, b, rel = 1e-6) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));
// the old audio.js note(), envelope part only: the negative control for the envelope lint
function oldNote(ctx, dest, P, t, dur) {
  const g = ctx.createGain(), lvl = P.lvl * 0.8, end = t + Math.max(0.03, dur), o = ctx.createOscillator();
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(lvl, t + P.a);
  g.gain.setTargetAtTime(lvl * P.s, t + P.a, P.d ? P.d / 3 : 0.04); g.gain.setTargetAtTime(0, end, P.r / 3);
  o.connect(g); g.connect(dest); o.start(t); o.stop(end + P.r * 2 + 0.03);
}

export default async function (t) {
  // =====================================================================================================
  t.section('fakectx: throws where a browser throws');
  {
    const c = new FakeAudioContext(), g = c.createGain(), o = c.createOscillator(), b = c.createBufferSource(), f = c.createBiquadFilter(), ws = c.createWaveShaper();
    const is = (fn, name, msg) => t.eq(errName(fn), name, msg);
    is(() => g.gain.exponentialRampToValueAtTime(0, 1), 'RangeError', 'exponential ramp to 0');
    is(() => g.gain.setValueAtTime(1, -1), 'RangeError', 'setValueAtTime at a negative time');
    is(() => g.gain.linearRampToValueAtTime(1, -1), 'RangeError', 'linearRamp at a negative time');
    is(() => g.gain.setTargetAtTime(1, -0.1, 0.1), 'RangeError', 'setTargetAtTime at a negative time');
    is(() => g.gain.setTargetAtTime(1, 0, -1), 'RangeError', 'setTargetAtTime with a negative time constant');
    is(() => g.gain.cancelScheduledValues(-1), 'RangeError', 'cancelScheduledValues at a negative time');
    is(() => g.gain.setValueAtTime(NaN, 0), 'TypeError', 'setValueAtTime(NaN)');
    is(() => g.gain.setValueAtTime(1, Infinity), 'TypeError', 'setValueAtTime at Infinity');
    is(() => g.gain.setTargetAtTime(1, 0, NaN), 'TypeError', 'setTargetAtTime with a NaN time constant');
    is(() => { g.gain.value = NaN; }, 'TypeError', '.value = NaN');
    is(() => { g.gain.value = undefined; }, 'TypeError', '.value = undefined');
    is(() => o.stop(1), 'InvalidStateError', 'stop() before start()');
    is(() => o.start(-1), 'RangeError', 'start at a negative time');
    is(() => o.start(NaN), 'TypeError', 'start(NaN)');
    o.start(1);
    is(() => o.start(2), 'InvalidStateError', 'start() twice');
    is(() => o.stop(-1), 'RangeError', 'stop at a negative time');
    is(() => { o.type = 'custom'; }, 'InvalidStateError', "type = 'custom'");
    is(() => { o.type = 'saw'; }, 'Error', 'unknown oscillator type (a browser ignores it; the fake does not)');
    is(() => { f.type = 'lp'; }, 'Error', 'unknown filter type');
    is(() => { ws.oversample = '3x'; }, 'Error', 'unknown oversample');
    is(() => o.setPeriodicWave({}), 'TypeError', 'setPeriodicWave with a non-wave');
    is(() => o.setPeriodicWave(new FakeAudioContext().createPeriodicWave([0, 0], [0, 1])), 'InvalidAccessError', 'PeriodicWave of another context');
    is(() => c.createPeriodicWave([0, 0, 0], [0, 1]), 'IndexSizeError', 'PeriodicWave arrays of different length');
    is(() => c.createPeriodicWave([0], [0]), 'IndexSizeError', 'PeriodicWave of length 1');
    is(() => c.createPeriodicWave([0, NaN], [0, 1]), 'TypeError', 'PeriodicWave with NaN');
    is(() => c.createDelay(0), 'NotSupportedError', 'createDelay(0)');
    is(() => c.createDelay(180), 'NotSupportedError', 'createDelay(180)');
    is(() => c.createBuffer(0, 10, 44100), 'NotSupportedError', 'createBuffer with 0 channels');
    is(() => c.createBuffer(1, 0, 44100), 'NotSupportedError', 'createBuffer with 0 frames');
    is(() => c.createBuffer(1, 10, 100), 'NotSupportedError', 'createBuffer at 100 Hz');
    is(() => c.createBuffer(1, 10, 44100).getChannelData(1), 'IndexSizeError', 'getChannelData out of range');
    b.buffer = c.createBuffer(1, 10, 44100);
    is(() => { b.buffer = c.createBuffer(1, 10, 44100); }, 'InvalidStateError', 'a second buffer on a buffer source');
    is(() => b.start(0, -1), 'RangeError', 'buffer source start with a negative offset');
    is(() => g.connect(undefined), 'TypeError', 'connect(undefined)');
    is(() => g.connect({}), 'TypeError', 'connect(a plain object)');
    is(() => g.connect(new FakeAudioContext().destination), 'InvalidAccessError', 'connect across contexts');
    is(() => g.connect(c.destination, 1), 'IndexSizeError', 'connect from output 1');
    is(() => c.destination.connect(g), 'IndexSizeError', 'connect from the destination');
    is(() => g.disconnect(f), 'InvalidAccessError', 'disconnect something not connected');
    is(() => { ws.curve = new Float32Array(1); }, 'InvalidAccessError', 'a curve of length 1');
    is(() => { c.currentTime = -1; }, 'RangeError', 'negative currentTime');
    for (const m of ['createConvolver', 'createStereoPanner', 'createAnalyser', 'createConstantSource', 'createPanner', 'decodeAudioData', 'close'])
      t.ok(errName(() => c[m]()) === 'Error', `unimplemented ${m}() throws by name`);
    t.ok(errName(() => c.audioWorklet) === 'Error', 'unimplemented audioWorklet throws');
    t.ok(errName(() => g.gain.cancelAndHoldAtTime(1)) === 'Error', 'cancelAndHoldAtTime throws');
    t.ok(errName(() => g.gain.setValueCurveAtTime([0, 1], 0, 1)) === 'Error', 'setValueCurveAtTime throws');
    is(() => c.createReverb(), 'TypeError', 'a method that does not exist at all');
    is(() => { g.gain.vlaue = 1; }, 'TypeError', 'a misspelt property on a param');
    is(() => { g.shadow = 1; }, 'TypeError', 'an expando on a node');
    is(() => { c.foo = 1; }, 'TypeError', 'an expando on the context');
    // things a browser allows must not throw
    t.eq(errName(() => { o.stop(3); o.stop(2); g.connect(c.destination); g.connect(c.destination); g.gain.setTargetAtTime(1, 0, 0); g.gain.exponentialRampToValueAtTime(-1, 2); ws.curve = null; ws.curve = new Float32Array(3); f.type = 'bandpass'; o.type = 'square'; }), null, 'legal calls do not throw');
    t.eq(o.t1, 2, 'a later stop() replaces the earlier one');
    t.eq(g.outs.length, 1, 'a repeated connect is a no-op');
    c.state = 'interrupted'; await c.resume(); t.eq(c.state, 'running', "resume() from 'interrupted' (iOS)"); await c.suspend(); t.eq(c.state, 'suspended', 'suspend()');
    c.state = 'closed'; let rej = false; await c.resume().catch(() => { rej = true; }); t.ok(rej, 'resume() on a closed context rejects');
  }

  // =====================================================================================================
  t.section('fakectx: records nodes, connections, sources and automation');
  {
    const c = new FakeAudioContext(), bus = c.createGain(); bus.connect(c.destination); t.eq(c.markPersistent(), 1, 'markPersistent counts the mixer nodes');
    c.currentTime = 2;
    const o = c.createOscillator(), g = c.createGain(); o.connect(g); g.connect(bus);
    g.gain.setValueAtTime(0, 2.5); g.gain.setTargetAtTime(1, 2.5, 0.1); g.gain.setTargetAtTime(0, 3, 0.05); o.start(2.5); o.stop(3.4);
    t.eq(c.count.total, 3, 'three creations (the destination is not one)'); t.eq(c.count.osc, 1, 'one oscillator'); t.eq(c.births[2], 2, 'birth time is the currentTime of creation');
    t.eq(c.connections, 3, 'three connections'); t.eq(c.sources.length, 1, 'one started source'); t.eq(o.t0, 2.5, 'start time'); t.eq(o.t1, 3.4, 'stop time'); t.eq(o.startAt, 2, 'currentTime of the start call');
    t.eq(g.gain.ev.length, 3, 'three parameter calls recorded'); t.eq(g.gain.ev[1].at, 2, 'each with the currentTime of the call'); t.eq(g.gain.ev[1].tc, 0.1, 'and the time constant');
    t.eq(lintAll(c).join(' | '), '', 'the well-formed voice passes every lint');
    t.near(valueAt(g.gain, 2.6), 1 - Math.exp(-1), 1e-9, 'valueAt follows a setTarget curve');
    t.near(valueAt(g.gain, 3.05), (1 - Math.exp(-5)) * Math.exp(-1), 1e-9, 'valueAt chains setTargets from the running value');
    t.eq(valueAt(g.gain, 2.2), 1, 'valueAt before the first event is the intrinsic value');
    c.currentTime = 2.6; t.near(g.gain.value, 1 - Math.exp(-1), 1e-9, '.value reads the computed value'); t.eq(g.gain.reads, 1, 'and the read is counted');
    const p = c.createGain().gain; p.setValueAtTime(1, 11); p.linearRampToValueAtTime(3, 12); p.exponentialRampToValueAtTime(12, 14);
    t.near(valueAt(p, 11.5), 2, 1e-9, 'valueAt on a linear ramp'); t.near(valueAt(p, 13), 6, 1e-9, 'valueAt on an exponential ramp'); t.eq(valueAt(p, 19), 12, 'valueAt after the last event');
    p.cancelScheduledValues(11.5); t.eq(valueAt(p, 13), 1, 'cancelScheduledValues drops later events');
    const q = c.createGain().gain; q.setValueAtTime(0, 1); q.linearRampToValueAtTime(0.5, 1.2); q.setTargetAtTime(0, 1.2, 0.1);
    t.near(valueAt(q, 2.7), 0.5 * Math.exp(-1), 1e-9, 'valueAt moves events that are already past to the currentTime of the call (2.6): a late ramp is an instant attack');
    t.eq(liveAt(c, 2.4), 0, 'liveAt before the start'); t.eq(liveAt(c, 3), 1, 'liveAt while sounding'); t.eq(liveAt(c, 3.4), 0, 'liveAt at the stop time');
    t.eq(pendingAt(c, 2.1), 1, 'pendingAt counts a scheduled source'); t.eq(peakLive(c), 1, 'peakLive');
    t.eq(maxInWindow([0, 0.5, 0.99, 1.0, 1.2, 3], 1), 4, 'maxInWindow uses half-open windows'); t.eq(maxInWindow([], 1), 0, 'maxInWindow of nothing');
    t.eq(nodeRate(c), 4, 'nodeRate counts creations by call time, in the busiest window'); t.eq(nodeRate(c, 5), 5, 'nodeRate over a longer window'); t.eq(startRate(c), 1, 'startRate counts oscillator starts');
    t.eq(voiceOf(o).length, 2, 'voiceOf stops at the persistent graph');
    c.currentTime = 10; c.prune(9); t.eq(c.nodes.includes(o), false, 'prune drops finished voices'); t.eq(c.nodes.includes(bus), true, 'prune keeps the mixer'); t.eq(c.count.osc, 1, 'prune keeps cumulative counts');
  }

  t.section('fakectx: every lint catches its defect (negative controls)');
  {
    const mk = () => { const c = new FakeAudioContext(), bus = c.createGain(); bus.connect(c.destination); c.markPersistent(); return { c, bus }; };
    const FIDDLE = { a: 0.04, d: 0, s: 0.9, r: 0.08, lvl: 0.12 }, STRINGS = { a: 0.09, d: 0, s: 1, r: 0.16, lvl: 0.04 };
    { const { c, bus } = mk(); oldNote(c, bus, FIDDLE, 1, 0.03); const l = lintEnvelopes(c); t.ok(l.some(m => /scheduled before segment/.test(m)), 'the old envelope on a 30 ms fiddle note is flagged: release scheduled before the attack ends'); }
    { const { c, bus } = mk(); oldNote(c, bus, FIDDLE, 1, 0.5); t.eq(lintEnvelopes(c).filter(m => /scheduled before/.test(m)).length, 0, 'the old envelope on a 0.5 s note is in order (the lint is not trigger-happy)'); }
    { const { c, bus } = mk(); oldNote(c, bus, STRINGS, 1, 0.5); t.ok(lintEnvelopes(c).some(m => /time constants after the release/.test(m)), 'the old stop time (6.6 time constants for strings) is flagged'); }
    { const { c, bus } = mk(); const o = c.createOscillator(), g = c.createGain(); o.connect(g); g.connect(bus); g.gain.setValueAtTime(0, 1); g.gain.setTargetAtTime(0.5, 1, 0.01); g.gain.setTargetAtTime(0, 1, 0.01); o.start(1); o.stop(2);
      t.ok(lintEnvelopes(c).some(m => /does not precede the release/.test(m)), 'an attack at the same instant as the release is flagged'); }
    { const { c, bus } = mk(); const o = c.createOscillator(); o.connect(bus); o.start(1); o.stop(2); t.ok(lintEnvelopes(c).some(m => /without an envelope/.test(m)), 'a source with no envelope is flagged'); }
    { const { c, bus } = mk(); const o = c.createOscillator(), g = c.createGain(); o.connect(g); g.connect(bus); g.gain.setValueAtTime(0.5, 1); g.gain.exponentialRampToValueAtTime(0.0001, 1.2); o.start(1); o.stop(1.1);
      t.ok(lintEnvelopes(c).some(m => /time constants after the release/.test(m)), 'a source cut before its ramp ends is flagged'); }
    { const { c, bus } = mk(); const o = c.createOscillator(), g = c.createGain(); o.connect(g); g.connect(bus); g.gain.setValueAtTime(0, 1); g.gain.exponentialRampToValueAtTime(0.5, 1.1); g.gain.setTargetAtTime(0, 1.5, 0.01); o.start(1); o.stop(2);
      t.ok(lintEnvelopes(c).some(m => /no curve/.test(m)), 'an exponential ramp from zero is flagged'); }
    { const { c, bus } = mk(); const b = c.createBufferSource(), g = c.createGain(); b.buffer = c.createBuffer(1, 100, 44100); b.connect(g); g.connect(bus); b.start(1.00001, 0.3); b.stop(2);
      t.ok(lintSources(c).some(m => /off the sample grid/.test(m)), 'a buffer source that starts between two sample frames is flagged (Chromium interpolates it: a hat measured 4.5 dB down)');
      const b2 = c.createBufferSource(); b2.buffer = b.buffer; b2.connect(g); b2.start(1, 0.30001); b2.stop(2); t.eq(lintSources(c).filter(m => /off the sample grid/.test(m)).length, 1, 'a read offset between two frames is not (the browser rounds it)'); }
    { const { c, bus } = mk(); const o = c.createOscillator(); o.connect(bus); t.ok(lintSources(c).some(m => /never started/.test(m)), 'a source that is never started is flagged'); o.start(1); t.ok(lintSources(c).some(m => /no stop time/.test(m)), 'a source without a stop time is flagged'); o.stop(1); t.ok(lintSources(c).some(m => /not after its start/.test(m)), 'a source that stops at its start is flagged'); }
    { const { c, bus } = mk(); c.currentTime = 5; const o = c.createOscillator(), g = c.createGain(); o.connect(g); g.connect(bus); g.gain.setValueAtTime(0, 4.9); o.start(4.9); o.stop(6);
      const l = lintSchedule(c); t.ok(l.some(m => /setValueAtTime|set scheduled for 4.9/.test(m)) && l.some(m => /start\(4.9\)/.test(m)), 'automation and starts before currentTime are flagged'); t.eq(o.t0, 5, 'and the source is recorded as starting now, as a browser plays it'); }
    { const { c } = mk(); const o = c.createOscillator(), g = c.createGain(); o.connect(g); o.start(1); o.stop(2); t.ok(lintGraph(c).some(m => /not connected/.test(m)) && lintGraph(c).some(m => /never reaches/.test(m)), 'a voice that reaches nothing is flagged'); }
    { const { c, bus } = mk(); const o = c.createOscillator(); o.connect(bus); o.frequency.setValueAtTime(210, 1); t.ok(lintStartValues(c).some(m => /intrinsic value 440/.test(m)), 'automation that starts from the default .value is flagged (Chromium plays 440 Hz first)');
      const o2 = c.createOscillator(); o2.connect(bus); o2.frequency.value = 210; o2.frequency.setValueAtTime(210, 1); t.eq(lintStartValues(c).length, 1, 'and passes once .value is set first'); }
    { const { c, bus } = mk(); c.currentTime = 1; const o = c.createOscillator(), g = c.createGain(); o.connect(g); g.connect(bus); g.gain.value = 0.5; g.gain.setValueAtTime(0.5, 0.99); g.gain.setTargetAtTime(0, 0.99, 0.01); o.start(0.99); o.stop(1.2);
      t.ok(lintStartValues(c).some(m => /written through \.value/.test(m)), 'a .value write on an envelope gain is flagged'); }
    { const { c, bus } = mk(); c.currentTime = 1; const g = c.createGain(); g.connect(bus); g.gain.setValueAtTime(0.5, 0.99); g.gain.setTargetAtTime(0, 0.99, 0.01); g.gain.value = 0.5;
      t.near(valueAt(g.gain, 1.1), 0.5, 1e-9, 'because a .value write is an event at currentTime: after a late envelope it holds the gain'); }
    { const { c, bus } = mk(); c.currentTime = 1; bus.gain.setTargetAtTime(0.5, 1, 0.01); t.eq(lintAutomation(c, { since: 0.5 }).length, 0, 'setTargetAtTime on the mixer is allowed');
      bus.gain.setTargetAtTime(0.5, 1, 0.001); t.ok(lintAutomation(c, { since: 0.5 }).some(m => /below the 5 ms floor/.test(m)), 'a too-fast time constant on the mixer is flagged');
      bus.gain.value = 1; t.ok(lintAutomation(c, { since: 0.5 }).some(m => /\.value write/.test(m)), 'a .value write on the mixer is flagged');
      bus.gain.linearRampToValueAtTime(0, 2); t.ok(lintAutomation(c, { since: 0.5 }).some(m => /: lin at/.test(m)), 'a ramp on the mixer is flagged');
      void bus.gain.value; t.ok(lintAutomation(c, { since: 0.5 }).some(m => /was read/.test(m)), 'reading .value on the mixer is flagged');
      t.eq(lintAutomation(c, { since: 0.5, allow: () => true }).filter(m => !/was read/.test(m)).length, 0, 'allow() exempts documented exceptions'); }
  }

  // =====================================================================================================
  t.section('synth: module shape');
  {
    t.eq(Object.keys(PATCH).sort().join(), [...PATCHES].sort().join(), 'PATCH has the 20 existing names plus pulse25');
    for (const name of PATCHES) {
      const P = PATCH[name];
      t.ok(P.o.length >= 1 && P.o.every(o => o.length === 3 && (BUILTIN.includes(o[0]) || WAVES[o[0]]) && o[1] > 0 && Number.isFinite(o[2])), `${name}: oscillators are [known waveform, ratio, detune]`);
      t.ok(P.a >= 0.002 && P.r >= 0.02 && P.lvl > 0 && P.s >= 0 && P.s <= 1 && P.d >= 0 && (P.d > 0 || P.s > 0), `${name}: envelope numbers are sane`);
    }
    t.eq(Object.keys(KITS).join(), KIT_NAMES.join(), 'KITS has the eight kits');
    for (const k of KIT_NAMES) {
      t.eq(Object.keys(KITS[k]).sort().join(), [...DRUMS].sort().join(), `kit ${k} knows the whole drum vocabulary`);
      for (const d of DRUMS) for (const p of KITS[k][d]) {
        t.ok(Object.isFrozen(p) && p.d > 0 && p.v > 0 && p.tc > 0 && p.st >= p.at + 7 * p.tc - EPS && p.st >= p.at + p.d, `${k}.${d}: decay and stop are consistent`);
        t.ok(p.k === 1 ? (p.ft === null || ['lowpass', 'highpass', 'bandpass'].includes(p.ft)) : (BUILTIN.includes(p.w) || !!WAVES[p.w]), `${k}.${d}: known filter / waveform`);
        if (p.re) t.ok(p.re[0] === 0 && p.re.every((x, i) => !i || x > p.re[i - 1]) && p.rtc > 0, `${k}.${d}: bursts start at 0 and ascend`);
      }
    }
    const genres = ['baroque', 'metal', 'jazz', 'funk', 'synthwave', 'celtic', 'chiprock', 'latin'], parts = ['kit', 'tops', 'bass', 'comp', 'color', 'lead', 'rune'];
    t.eq(Object.keys(TRIM).sort().join(), [...genres].sort().join(), 'TRIM has the eight genres');
    t.ok(genres.every(g => parts.every(p => TRIM[g][p] === 1) && Object.keys(TRIM[g]).length === parts.length), 'TRIM[genre][part] is 1 for the seven parts');
    t.eq(Object.keys(ELEM_INST).sort().join(), 'arcane,fire,frost,nature,steel,void,volt', 'ELEM_INST covers the seven elements');
    t.ok(Object.values(ELEM_INST).every(i => PATCH[i]), 'ELEM_INST names real patches');
    for (const w in WAVES) t.ok(Math.abs(WAVES[w].re.reduce((x, y) => x + y, 0)) < 1e-6, `wavetable ${w} starts at a zero crossing (an instant attack is not a step)`);
    for (const w in WAVES) t.ok(WAVES[w].re.length === WAVES[w].im.length && WAVES[w].re.length >= 2 && WAVES[w].re.every(Number.isFinite) && WAVES[w].im.every(Number.isFinite) && WAVES[w].im.some(x => x !== 0), `wavetable ${w} is well-formed`);
    for (const name of ['organ', 'epiano', 'flute', 'nylon', 'vibes', 'marimba']) t.ok(PATCH[name].o.length === 1 && !!WAVES[PATCH[name].o[0][0]], `${name} is one PeriodicWave oscillator per note`);
    t.near(mtof(69), 440, 1e-9, 'mtof(69)'); t.near(mtof(60.5), 440 * Math.pow(2, -8.5 / 12), 1e-9, 'mtof of a fractional pitch');

    const { ctx, syn } = rig();
    t.eq(ctx.waves.length, Object.keys(WAVES).length, 'one PeriodicWave per table');
    t.ok(ctx.waves.every(w => w.disableNormalization === true), 'every PeriodicWave is built with disableNormalization');
    const syn2 = new Synth(ctx, { rand: seeded(5) });
    t.eq(ctx.waves.length, Object.keys(WAVES).length, 'a second Synth on the context builds no new tables'); t.ok(syn2.waves === syn.waves, 'and shares them');
    t.eq(ctx.buffers, 2, 'one noise buffer per Synth');
    const nz = syn.noiseBuf.getChannelData(0); let mx = 0, mean = 0; for (const v of nz) { mx = Math.max(mx, Math.abs(v)); mean += v / nz.length; }
    t.ok(nz.length === Math.floor(44100 * 1.2) && mx <= 1 && mx > 0.99 && Math.abs(mean) < 0.02, 'the noise buffer is 1.2 s of full-scale noise');
    const again = rig().syn.noiseBuf.getChannelData(0); t.ok(again.every((v, i) => v === nz[i]), 'the same seed gives the same noise');
    t.eq(ctx.count.total, 3, 'building a Synth creates no nodes');
    // basses: the 2nd and 3rd harmonic of the note are in the table
    for (const name of ['finger', 'organbass']) { const o = PATCH[name].o[0], im = WAVES[o[0]].im, k = 1 / o[1]; t.ok(im[2 * k] >= 0.5 * im[k] && im[3 * k] >= 0.3 * im[k], `${name}: 2nd harmonic ${im[2 * k]} and 3rd ${im[3 * k].toFixed(2)} against the fundamental ${im[k]}`); }
    for (const name of BASSES) { const o = PATCH[name].o[0], w = WAVES[o[0]], k = 1 / o[1], a = h => Math.hypot(w.re[h * k], w.im[h * k]); t.ok(a(2) > 0.1 * a(1) && a(3) > 0.1 * a(1), `${name}: has a 2nd and a 3rd harmonic`); }
    const p25 = WAVES.pulse25; t.ok(Math.abs(Math.hypot(p25.re[4], p25.im[4])) < 1e-6 && Math.hypot(p25.re[1], p25.im[1]) > 0.5 && Math.hypot(p25.re[2], p25.im[2]) > 0.4, 'pulse25: every 4th harmonic is missing, the 2nd is strong (a 25% pulse)');
  }

  // =====================================================================================================
  t.section('synth: every patch, single notes from 2 s down to 20 ms');
  const cost = {};
  for (const name of PATCHES) {
    const P = PATCH[name], n = BASSES.includes(name) ? 40 : 60, filters = (P.lp !== undefined ? 1 : 0) + (P.hp !== undefined ? 1 : 0);
    for (const len of [2, 0.5, 0.12, 0.05, 0.02, 0.001]) {
      const { ctx, syn, route, out, send, dist } = rig(), T0 = 1.25, tag = `${name} ${len}s`, eff = Math.max(0.02, len);
      ctx.currentTime = 1.2;
      const ret = syn.note(route, { n, d: 1, v: 0.8 }, T0, len, 0.5, name), vib = P.vib && eff > 0.28 ? 1 : 0;
      const vs = voices(ctx), oscs = vs.filter(x => x.kind === 'osc'), gains = vs.filter(x => x.kind === 'gain'), biq = vs.filter(x => x.kind === 'biquad');
      t.eq(ret, P.o.length + vib, `${tag}: returns the oscillators started`); t.eq(oscs.length, ret, `${tag}: and that many exist`);
      t.eq(biq.length, filters, `${tag}: filter count`); t.eq(gains.length, 1 + vib, `${tag}: one envelope${vib ? ' and the vibrato depth' : ''}`);
      t.eq(vs.length, P.o.length + filters + 1 + 2 * vib, `${tag}: node count`); t.eq(syn.counters.nodes, vs.length, `${tag}: counters.nodes`); t.eq(syn.counters.starts, ctx.sources.length, `${tag}: counters.starts`);
      if (len === 0.5) cost[name] = vs.length - 2 * vib;
      const env = gains.find(g => g.outs.includes(out) || g.outs.includes(dist));
      if (!t.ok(!!env, `${tag}: the envelope reaches a bus`)) continue;
      if (P.bus === 'dist') t.ok(env.outs.length === 1 && env.outs[0] === dist, `${tag}: a dist patch plays into the distortion bus only`);
      else t.ok(env.outs.length === 2 && env.outs.includes(out) && env.outs.includes(send), `${tag}: plays into out and send`);
      const ev = sched(env.gain), lvl = (P.bus === 'dist' ? DRIVE : P.lvl) * 0.8 * 0.5, a = Math.min(P.a, 0.3 * eff);
      const plucked = P.d > 0 && P.s === 0, rel = ev[ev.length - 1];
      t.ok(env.gain.ev.every(e => e.k === 'set' || e.k === 'target'), `${tag}: the envelope is built from setValueAtTime and setTargetAtTime only, never .value, never a ramp`);
      if (plucked) {
        t.eq(ev.map(e => e.k).join(), 'set,target,target', `${tag}: a plucked envelope is an instant attack, a decay and a release`);
        t.ok(ev[0].t === T0 && close(ev[0].v, lvl) && ev[1].t === T0 && ev[1].v === 0 && close(ev[1].tc, P.d / 3), `${tag}: full level at the note time, decaying over the patch decay`);
        t.near(valueAt(env.gain, T0), lvl, lvl * 1e-9, `${tag}: the level at the note time is the patch level`);
      } else {
        t.eq(ev.map(e => e.k).join(), 'set,target,target,target', `${tag}: a held envelope is set + three setTargets`);
        t.ok(ev[0].v === 0 && ev[0].t === T0, `${tag}: starts from zero at the note time`);
        t.ok(ev[1].t === T0 && close(ev[1].tc, a / 3) && close(ev[1].v, lvl * OVER), `${tag}: attack of ${a.toFixed(4)} s`);
        t.ok(a <= 0.3 * eff + EPS && a <= P.a + EPS && close(ev[2].t, T0 + a) && ev[2].t > ev[1].t, `${tag}: the attack is never longer than 0.3 of the note and ends before the next segment`);
        t.near(valueAt(env.gain, T0 + a), lvl, lvl * 1e-3, `${tag}: the level at the end of the attack is the patch level`);
        t.ok(close(ev[2].v, lvl * P.s) && close(ev[2].tc, P.d ? P.d / 3 : 0.013), `${tag}: settles to the sustain level`);
      }
      t.ok(close(rel.t, T0 + eff) && rel.v === 0 && close(rel.tc, P.r / 3) && rel.t > ev[ev.length - 2].t, `${tag}: release at the note end, after the attack`);
      const stops = [...new Set(ctx.sources.map(s => s.t1))];
      t.eq(stops.length, 1, `${tag}: every oscillator of the voice stops together`);
      const natural = plucked ? T0 + 7 * P.d / 3 : Infinity, need = Math.min(T0 + eff + 7 * P.r / 3, natural);
      t.ok(stops[0] >= need - EPS && stops[0] <= need + 0.006, `${tag}: stops 7 time constants into the final decay (${(stops[0] - T0).toFixed(3)} s after the start)`);
      t.ok(valueAt(env.gain, stops[0]) <= lvl * 1e-3, `${tag}: the envelope is below -60 dB of the note at the stop`);
      for (const o of oscs.filter(o => o.frequency.ev.length && !o.outs.some(d => d.kind === 'gain' && d !== env && !d.outs.includes(out)))) void o;
      const tone = oscs.filter(o => o.outs.some(d => d === env || d.kind === 'biquad'));
      t.eq(tone.length, P.o.length, `${tag}: the tone oscillators feed the envelope chain`);
      tone.forEach((o, j) => {
        const od = P.o[j];
        t.ok(close(intrinsic(o.frequency), mtof(n) * od[1]) && sched(o.frequency).length === 0, `${tag}: oscillator ${j} at the note frequency x ${od[1]}, no automation`);
        t.ok(BUILTIN.includes(od[0]) ? o.type === od[0] && o.wave === null : o.type === 'custom' && o.wave === syn.waves[od[0]], `${tag}: oscillator ${j} waveform ${od[0]}`);
        t.eq(intrinsic(o.detune), od[2], `${tag}: oscillator ${j} detune`);
        t.ok(o.t0 === T0, `${tag}: oscillator ${j} starts at the note time`);
      });
      if (vib) { const lfo = oscs.find(o => !tone.includes(o)), lg = gains.find(g => g !== env); t.ok(lfo.outs.length === 1 && lfo.outs[0] === lg && tone.every(o => lg.outs.includes(o.detune)) && lg.outs.length === tone.length, `${tag}: the vibrato modulates detune, not frequency`); t.ok(valueAt(lg.gain, T0 + 0.05) === 0 && valueAt(lg.gain, T0 + 1) > 9, `${tag}: the vibrato is delayed and reaches 10 cents`); }
      const lint = lintAll(ctx); t.eq(lint.length, 0, `${tag}: lint clean${lint.length ? ' (' + lint[0] + ')' : ''}`);
    }
  }
  t.report('nodes per note, new engine (square sawlead fiddle flute brass clav vibes marimba epiano harpsi pluck nylon organ strings dist bell pulse25 synbass finger slap organbass)', PATCHES.map(n => cost[n]).join(' '));

  // =====================================================================================================
  t.section('synth: chords of 2, 3 and 4 notes are N oscillators into one envelope');
  const CH = { 2: [60, 67], 3: [60, 64, 67], 4: [60, 64, 67, 71] };
  for (const name of PATCHES) for (const k of [2, 3, 4]) for (const len of [0.5, 0.02]) {
    const P = PATCH[name], { ctx, syn, route, out, dist } = rig(), ns = CH[k], tag = `${name} x${k} ${len}s`, filters = (P.lp !== undefined ? 1 : 0) + (P.hp !== undefined ? 1 : 0), vib = P.vib && len > 0.28 ? 1 : 0;
    const ret = syn.note(route, { n: ns[0], ns, d: 1, v: 0.8 }, 1, len, 1, name), vs = voices(ctx), gains = vs.filter(x => x.kind === 'gain'), oscs = vs.filter(x => x.kind === 'osc');
    t.eq(ret, k * P.o.length + vib, `${tag}: oscillators started`);
    t.eq(vs.length, k * P.o.length + filters + 1 + 2 * vib, `${tag}: node count`);
    const envs = gains.filter(g => g.outs.includes(out) || g.outs.includes(dist));
    t.eq(envs.length, 1, `${tag}: exactly one envelope`); t.eq(vs.filter(x => x.kind === 'biquad').length, filters, `${tag}: filters are shared by the chord`);
    const tone = oscs.filter(o => o.outs.some(d => d === envs[0] || d.kind === 'biquad')), want = []; for (const m of ns) for (const od of P.o) want.push(mtof(m) * od[1]);
    t.ok(tone.length === want.length && tone.every((o, i) => close(intrinsic(o.frequency), want[i])), `${tag}: one oscillator set per chord note, at its pitch`);
    t.near(valueAt(envs[0].gain, 1 + (P.d && !P.s ? 0 : Math.min(P.a, 0.3 * len))), (P.bus === 'dist' ? DRIVE : P.lvl) * 0.8 / Math.sqrt(k), 1e-4, `${tag}: the chord is power-normalised (level / sqrt(${k}))`);
    t.eq(new Set(ctx.sources.map(s => s.t1)).size, 1, `${tag}: one stop time`);
    const lint = lintAll(ctx); t.eq(lint.length, 0, `${tag}: lint clean${lint.length ? ' (' + lint[0] + ')' : ''}`);
  }
  {
    const { ctx, syn, route } = rig(); const ret = syn.note(route, { n: 60, ns: [60, 64, 67, 71], d: 1, v: 0.7 }, 1, 0.42, 1, 'epiano');
    t.eq(ret, 4, 'a 4-note epiano chord starts 4 oscillators'); t.eq(voices(ctx).length, 5, 'a 4-note epiano chord costs 5 nodes (the old engine: 24)'); t.eq(voices(ctx).filter(x => x.kind === 'gain').length, 1, 'a 4-note epiano chord costs one envelope');
    const a = rig(); a.syn.note(a.route, { n: 60, ns: [60], d: 1, v: 0.7 }, 1, 0.42, 1, 'epiano'); t.eq(voices(a.ctx).length, 2, 'ns of one note is a single note');
    const b = rig(); b.syn.note(b.route, { n: 60, ns: [60, 62, 64, 65, 67], d: 1, v: 0.7 }, 1, 0.42, 1, 'epiano'); t.eq(voices(b.ctx).length, 6, 'a 5-note cluster still works');
  }

  // =====================================================================================================
  t.section('synth: ornaments are realised in seconds and skipped on short notes');
  {
    const N0 = 72, ON = 74, f = mtof(N0), fo = mtof(ON);
    const play = (orn, len, bd, inst = 'flute', extra = {}) => { const r = rig(); r.syn.note(r.route, { n: N0, d: len / bd, v: 0.8, orn, on: ON, ...extra }, 2, bd, 1, inst); const env = voices(r.ctx).find(x => x.kind === 'gain' && x.outs.includes(r.out)); r.tone = voices(r.ctx).filter(x => x.kind === 'osc' && x.outs.some(d => d === env || d.kind === 'biquad')); return r; };
    const fe = o => sched(o.frequency).map(e => [e.k, +(e.t - 2).toFixed(6), e.v]);
    const same = (got, want) => got.length === want.length && got.every((e, i) => e[0] === want[i][0] && Math.abs(e[1] - want[i][1]) < 1e-6 && close(e[2], want[i][2]));
    for (const orn of ['cut', 'flip']) {
      let r = play(orn, 0.5, 0.42); t.ok(same(fe(r.tone[0]), [['set', 0, fo], ['set', 0.06, f]]) && close(intrinsic(r.tone[0].frequency), fo), `${orn}: the neighbour for 60 ms, then the note`);
      r = play(orn, 0.16, 0.42); t.ok(same(fe(r.tone[0]), [['set', 0, fo], ['set', 0.04, f]]), `${orn}: a quarter of a 160 ms note`);
      t.eq(lintAll(r.ctx).length, 0, `${orn}: lint clean`);
    }
    { const r = play('mordent', 0.42, 0.42); t.ok(same(fe(r.tone[0]), [['set', 0, f], ['set', 0.05, fo], ['set', 0.1, f]]) && close(intrinsic(r.tone[0].frequency), f), 'mordent: note, neighbour, note at 50 ms each'); t.eq(lintAll(r.ctx).length, 0, 'mordent: lint clean'); }
    for (const [len, bd] of [[0.84, 0.42], [0.42, 0.42], [0.3, 0.3], [1.2, 0.3], [2.0, 0.5], [0.3, 0.62]]) {
      const r = play('trill', len, bd), e = fe(r.tone[0]), st = Math.max(0.06, bd / 4), tag = `trill len ${len} bd ${bd}`;
      t.ok(e.every((x, i) => x[0] === 'set' && Math.abs(x[1] - i * st) < 1e-6 && close(x[2], i % 2 ? fo : f)), `${tag}: alternates note / neighbour every max(60 ms, bd / 4)`);
      t.ok(e.length % 2 === 1 && close(e[e.length - 1][2], f), `${tag}: ends on the note`);
      t.ok(e[e.length - 1][1] <= len / 2 + st + 1e-9 && (e.length === 1 || e[e.length - 2][1] < len / 2), `${tag}: lasts half the note`);
      t.ok(len < 2 * st + 1e-9 || e.length >= 3, `${tag}: at least one alternation when there is room`);
      t.eq(lintAll(r.ctx).length, 0, `${tag}: lint clean`);
    }
    for (const orn of ['bend', 'glide']) { const r = play(orn, 0.5, 0.42), fp = r.tone[0].frequency; t.ok(same(fe(r.tone[0]), [['target', 0, f]]) === false && fe(r.tone[0]).length === 2 && fe(r.tone[0])[0][0] === 'set' && close(fe(r.tone[0])[0][2], fo) && fe(r.tone[0])[1][0] === 'target' && close(fe(r.tone[0])[1][2], f) && close(intrinsic(fp), fo), `${orn}: slides from the neighbour to the note`);
      t.ok(Math.abs(1200 * Math.log2(valueAt(fp, 2.06) / f)) < 12 && Math.abs(1200 * Math.log2(valueAt(fp, 2.12) / f)) < 1, `${orn}: within ${Math.abs(1200 * Math.log2(valueAt(fp, 2.06) / f)).toFixed(1)} cents after 60 ms, under 1 cent after 120 ms`); t.eq(lintAll(r.ctx).length, 0, `${orn}: lint clean`); }
    // the skip rule: one millisecond under the minimum is a plain note, the minimum itself is ornamented
    for (const orn of Object.keys(ORN_MIN)) {
      const short = play(orn, ORN_MIN[orn] - 0.001, 0.42), ok = play(orn, ORN_MIN[orn], 0.42);
      t.ok(fe(short.tone[0]).length === 0 && close(intrinsic(short.tone[0].frequency), f), `${orn}: skipped on a note of ${(ORN_MIN[orn] - 0.001).toFixed(3)} s`);
      t.ok(fe(ok.tone[0]).length >= 2, `${orn}: played on a note of ${ORN_MIN[orn]} s`);
      const all = fe(ok.tone[0]); t.ok(all.every(e => e[1] >= 0 && e[1] <= ORN_MIN[orn] + 1e-9), `${orn}: stays inside the note`);
    }
    t.eq(JSON.stringify(ORN_MIN), JSON.stringify({ cut: 0.12, flip: 0.12, mordent: 0.2, trill: 0.3, bend: 0.12, glide: 0.12 }), 'the skip thresholds are the spec table');
    for (const orn of ['mordent', 'trill']) { t.eq(fe(play(orn, 0.8, ORN_TIER2 - 0.01).tone[0]).length, 0, `${orn}: skipped below tier 2 (beat under ${ORN_TIER2} s)`); t.ok(fe(play(orn, 0.8, ORN_TIER2).tone[0]).length > 0, `${orn}: played at tier 2`); }
    for (const orn of ['cut', 'bend']) t.ok(fe(play(orn, 0.2, 0.15).tone[0]).length > 0, `${orn}: still played at tier 1`);
    t.eq(fe(play('cut', 0.5, 0.42, 'flute', { on: undefined }).tone[0]).length, 0, 'no neighbour pitch: plain note');
    t.eq(fe(play('cut', 0.5, 0.42, 'flute', { on: N0 }).tone[0]).length, 0, 'neighbour equal to the note: plain note');
    t.eq(fe(play('wobble', 0.5, 0.42).tone[0]).length, 0, 'unknown ornament: plain note');
    t.eq(fe(play('constructor', 0.5, 0.42).tone[0]).length, 0, 'an ornament name from Object.prototype: plain note');
    { const r = play('cut', 0.5, 0.42, 'flute', { ns: [72, 76] }); t.ok(r.tone.every(o => fe(o).length === 0), 'ornaments are for single notes: a chord ignores them'); }
    { const r = play('trill', 0.84, 0.42, 'sawlead'); t.ok(r.tone.length === 2 && JSON.stringify(fe(r.tone[0])) === JSON.stringify(fe(r.tone[1])), 'a two-oscillator lead ornaments both oscillators alike'); const lfo = voices(r.ctx).find(x => x.kind === 'osc' && !r.tone.includes(x)); t.ok(!!lfo && sched(lfo.frequency).length === 0, 'and keeps its vibrato'); }
  }

  // =====================================================================================================
  t.section('synth: x.arp steps one oscillator through the chord');
  {
    const ARP = [0, 4, 7], f = mtof(60);
    const play = (bd, d, swing, inst = 'pulse25', arp = ARP) => { const r = rig(); r.syn.swing = swing; r.ret = r.syn.note(r.route, { n: 60, d, v: 0.8, x: { arp } }, 3, bd, 1, inst); r.osc = voices(r.ctx).filter(x => x.kind === 'osc'); return r; };
    { const r = play(0.42, 1, 0.5), e = sched(r.osc[0].frequency);
      t.eq(r.ret, 1, 'an arp event is one oscillator'); t.eq(voices(r.ctx).length, 2, 'and two nodes');
      t.ok(e.length === 4 && e.every((x, i) => x.k === 'set' && Math.abs(x.t - (3 + i * 0.105)) < 1e-9 && close(x.v, f * Math.pow(2, ARP[i % 3] / 12))), 'straight grid: a step every quarter of a beat, through the offsets in order');
      t.ok(close(intrinsic(r.osc[0].frequency), f), 'the oscillator starts on the first step'); t.eq(lintAll(r.ctx).length, 0, 'arp: lint clean'); }
    { const e = sched(play(0.42, 1, 2 / 3).osc[0].frequency); t.ok(e.length === 3 && e.every((x, i) => Math.abs(x.t - (3 + i * 0.14)) < 1e-9), 'swung grid: a step every third of a beat'); }
    { const e = sched(play(0.42, 1, 0.58).osc[0].frequency); t.eq(e.length, 4, 'swing 0.58 (mid-slew) still counts as straight'); }
    { const e = sched(play(0.42, 2, 0.5).osc[0].frequency); t.ok(e.length === 8 && close(e[7].v, f * Math.pow(2, 4 / 12)), 'a two-beat arp keeps cycling'); }
    for (const sw of [0.5, 2 / 3]) for (const bd of [0.6, 0.42, 0.3, 0.21, 0.14, 0.105, 0.08, 0.05, 0.02]) for (const d of [1, 0.5, 2]) {
      const r = play(bd, d, sw), e = sched(r.osc[0].frequency), gaps = e.slice(1).map((x, i) => x.t - e[i].t), tag = `arp bd ${bd} d ${d} swing ${sw.toFixed(2)}`, len = Math.max(0.02, d * bd);
      t.ok(gaps.every(g => g >= 0.03 - 1e-9), `${tag}: never faster than 30 ms`);
      const grid = sw > 0.58 ? [bd / 3, bd] : [bd / 4, bd / 2, bd];
      t.ok(!gaps.length || grid.some(g => g >= 0.03 - 1e-9 && gaps.every(x => Math.abs(x - g) < 1e-9)) || (bd < 0.03 && gaps.every(x => Math.abs(x - 0.03) < 1e-9)), `${tag}: steps stay on the beat grid`);
      t.ok(e.length >= 1 && e[0].t === 3 && e.every(x => x.t < 3 + len), `${tag}: every step is inside the note`);
      const lint = lintAll(r.ctx); t.eq(lint.length, 0, `${tag}: lint clean${lint.length ? ' (' + lint[0] + ')' : ''}`);
    }
    { const r = play(0.42, 1, 0.5, 'sawlead'); t.ok(r.osc.filter(o => sched(o.frequency).length === 4).length === 2, 'a two-oscillator patch arpeggiates both'); }
    { const r = play(0.42, 1, 0.5, 'pulse25', []); t.eq(sched(r.osc[0].frequency).length, 0, 'an empty arp is a plain note'); }
    { const r = rig(); r.syn.note(r.route, { n: 60, d: 1, v: 0.8, orn: 'cut', on: 62, x: { arp: ARP } }, 3, 0.42, 1, 'pulse25'); t.eq(sched(voices(r.ctx).find(x => x.kind === 'osc').frequency).length, 4, 'arp wins over an ornament'); }
    { const r = play(0.42, 1, 0.5, 'pulse25', [0, 3.5, -12]); const e = sched(r.osc[0].frequency); t.ok(close(e[1].v, f * Math.pow(2, 3.5 / 12)) && close(e[2].v, f / 2), 'fractional and negative offsets'); }
  }

  // =====================================================================================================
  t.section('synth: routing, x.bus, x.pad, gain and guards');
  {
    const env = r => voices(r.ctx).find(x => x.kind === 'gain' && x.outs.some(d => d === r.out || d === r.dist));
    { const r = rig(); r.syn.note(r.route, { n: 40, d: 1, v: 0.8, x: { bus: 'dist' } }, 1, 0.42, 0.5, 'synbass'); const g = env(r);
      t.ok(g.outs.length === 1 && g.outs[0] === r.dist, "x.bus === 'dist' plays into the distortion bus only"); t.near(valueAt(g.gain, 1 + PATCH.synbass.a), DRIVE * 0.8 * 0.5, 1e-4, 'and is driven at DRIVE, not at the patch level');
      const fl = voices(r.ctx).find(x => x.kind === 'biquad'); t.eq(sched(fl.frequency).map(e => e.k).join(), 'set,target', 'a filter sweep is set + setTarget'); t.eq(intrinsic(fl.frequency), PATCH.synbass.lp[0], 'and starts from its first value'); t.eq(lintAll(r.ctx).length, 0, 'x.bus: lint clean'); }
    { const r = rig(); r.syn.note({ out: r.out, send: r.send }, { n: 52, ns: [52, 59, 64], d: 1, v: 0.8 }, 1, 0.42, 1, 'dist'); const g = env(r);
      t.ok(g.outs.length === 2 && g.outs.includes(r.out) && g.outs.includes(r.send), 'a dist patch without a dist bus falls back to out and send'); t.near(valueAt(g.gain, 1 + PATCH.dist.a), PATCH.dist.lvl * 0.8 / Math.sqrt(3), 1e-4, 'at its clean level'); }
    { const r = rig(); r.syn.note({ out: r.out }, { n: 60, d: 1, v: 0.8 }, 1, 0.42, 1, 'epiano'); t.ok(env(r).outs.length === 1 && env(r).outs[0] === r.out, 'a route without send plays into out only'); }
    { const r = rig(); r.syn.note({ out: r.ctx.destination }, { n: 60, d: 1, v: 0.8 }, 1, 0.42, 1, 'epiano'); t.eq(lintAll(r.ctx).length, 0, 'the destination itself is a valid route'); }
    for (const inst of ['epiano', 'strings', 'fiddle', 'pluck']) {
      const P = PATCH[inst], r = rig(); r.syn.note(r.route, { n: 60, ns: [60, 64, 67], d: 2, v: 0.6, x: { pad: 1 } }, 1, 0.42, 1, inst); const g = env(r), ev = sched(g.gain), lvl = P.lvl * 0.6 / Math.sqrt(3);
      t.ok(ev[1].tc >= 0.02 - EPS && ev[2].t >= 1.06 - EPS, `pad ${inst}: the attack is at least 60 ms`);
      t.ok(ev.length === 4 && valueAt(g.gain, 1.8) >= 0.84 * lvl, `pad ${inst}: held near full level to the end of the note (${(valueAt(g.gain, 1.8) / lvl).toFixed(2)})`);
      t.ok(ev[3].tc >= 0.06 - EPS && r.ctx.sources.every(s => s.t1 >= 1.84 + 7 * 0.06 - EPS), `pad ${inst}: a release of at least 180 ms, with its 7 time constants`);
      t.eq(voices(r.ctx).filter(x => x.kind === 'osc').length, 3 * P.o.length, `pad ${inst}: no vibrato`); t.eq(lintAll(r.ctx).length, 0, `pad ${inst}: lint clean`);
    }
    { const r = rig(); r.syn.note(r.route, { n: 60, d: 0.1, v: 0.6, x: { pad: 1 } }, 1, 0.42, 1, 'strings'); const ev = sched(env(r).gain); t.ok(close(ev[2].t - 1, 0.3 * 0.042), 'pad: a short pad still obeys the 0.3 rule'); }
    { const a = rig(), b = rig(); a.syn.note(a.route, { n: 60, d: 1, v: 0.8 }, 1, 0.42, 1, 'organ'); b.syn.note(b.route, { n: 60, d: 1, v: 0.4 }, 1, 0.42, 0.5, 'organ'); t.near(valueAt(env(b).gain, 1.2) / valueAt(env(a).gain, 1.2), 0.25, 1e-9, 'velocity and gain scale the level linearly');
      const c = rig(); c.syn.note(c.route, { n: 60, d: 1, v: 0.8 }, 1, 0.42, undefined, 'organ'); t.near(valueAt(env(c).gain, 1.2), valueAt(env(a).gain, 1.2), 1e-12, 'gain defaults to 1'); }
    { const a = rig(), b = rig(); a.syn.note(a.route, { n: 60, d: 1, v: 0.8, i: 'vibes' }, 1, 0.42, 1); b.syn.note(b.route, { n: 60, d: 1, v: 0.8, i: 'vibes' }, 1, 0.42, 1, 'organ');
      t.ok(voices(a.ctx).find(x => x.kind === 'osc').wave === a.syn.waves.vibes, 'ev.i names the patch'); t.ok(voices(b.ctx).find(x => x.kind === 'osc').wave === b.syn.waves.organ, 'the inst argument overrides ev.i'); }
    { const r = rig(); t.eq(r.syn.note(r.route, { n: 60, d: 1, v: 0.8 }, 1, 0.42, 1, 'theremin'), 1 + 1, 'an unknown patch falls back to square (with vibrato on a long note)'); }
    { const r = rig(), bad = [[{ n: 60, d: 1, v: 0 }, 1, 0.42, 1], [{ n: 60, d: 1, v: 0.8 }, 1, 0.42, 0], [{ n: 60, d: 1, v: 0.8 }, NaN, 0.42, 1], [{ n: 60, d: 1, v: 0.8 }, -1, 0.42, 1], [{ n: 60, d: 1, v: 0.8 }, 1, 0, 1], [{ n: 60, d: 1, v: 0.8 }, 1, NaN, 1], [{ n: 'kick', d: 0, v: 0.8 }, 1, 0.42, 1], [{ n: 60, d: 1 }, 1, 0.42, 1], [{ n: 60, d: 1, v: NaN }, 1, 0.42, 1],
        [{ n: NaN, d: 1, v: 0.8 }, 1, 0.42, 1], [{ d: 1, v: 0.8 }, 1, 0.42, 1], [{ n: 60, ns: [60, NaN, 67], d: 1, v: 0.8 }, 1, 0.42, 1], [{ n: 60, ns: [60, 'kick'], d: 1, v: 0.8 }, 1, 0.42, 1]];
      t.ok(bad.every(a => r.syn.note(r.route, ...a, 'epiano') === 0), 'silent, unschedulable or unpitched events return 0'); t.eq(voices(r.ctx).length, 0, 'and create nothing'); t.eq(r.syn.counters.nodes + r.syn.counters.starts, 0, 'and count nothing'); }
    { const r = rig(); r.ctx.currentTime = 5; r.syn.note(r.route, { n: 60, d: 1, v: 0.8 }, 5.005, 0.42, 1, 'brass'); r.syn.drum(r.out, 'rock', 'snare', 5.005, 1); t.eq(lintSchedule(r.ctx).length, 0, 'scheduled 5 ms ahead: nothing lands before currentTime');
      r.syn.note(r.route, { n: 60, d: 1, v: 0.8 }, 4.99, 0.42, 1, 'brass'); t.ok(lintSchedule(r.ctx).length > 0, 'the synth does not hide a late call: the lint sees it'); }
    // LATE CALLS. A browser moves events that are already past to "now" (the fake's valueAt does the same). A voice
    // that arrives late must still be heard at its level and must still die away before its sources stop.
    for (const lateBy of [0.001, 0.004, 0.01, 0.04]) {
      for (const kit of ['rock', 'hand', 'chip']) for (const dn of DRUMS) { const r = rig(); r.ctx.currentTime = 3; r.syn.drum(r.out, kit, dn, 3 - lateBy, 1); const stop = Math.max(...r.ctx.sources.map(s => s.t1));
        for (const g of voices(r.ctx).filter(x => x.kind === 'gain')) { const pk = Math.max(...sched(g.gain).map(e => e.v)); let heard = 0; for (let k = 0; k <= 80; k++) heard = Math.max(heard, valueAt(g.gain, 3 + k * 0.001));
          if (dn !== 'brush' || lateBy <= 0.01) /* the brush is the one slow attack: later than that it fades out */ t.ok(heard >= 0.6 * pk, `${kit}.${dn} ${lateBy * 1000} ms late: still reaches ${(heard / pk).toFixed(2)} of its volume`); t.ok(valueAt(g.gain, stop) <= pk * 2e-3, `${kit}.${dn} ${lateBy * 1000} ms late: has died away by the stop`); } }
      for (const inst of PATCHES) { const P = PATCH[inst], r = rig(); r.ctx.currentTime = 3; r.syn.note(r.route, { n: 60, d: 1, v: 0.8 }, 3 - lateBy, 0.2, 1, inst); const g = env(r), lvl = (P.bus === 'dist' ? DRIVE : P.lvl) * 0.8;
        let heard = 0; for (let k = 0; k <= 100; k++) heard = Math.max(heard, valueAt(g.gain, 3 + k * 0.001));
        t.ok(heard >= 0.9 * lvl * (P.d && !P.s ? 1 : P.s), `${inst} ${lateBy * 1000} ms late: the note is heard at ${(heard / lvl).toFixed(2)} of its level`);
        t.ok(heard <= lvl * (1 + 1e-9), `${inst} ${lateBy * 1000} ms late: and never above it`); t.ok(valueAt(g.gain, r.ctx.sources[0].t1) <= lvl * 2e-3, `${inst} ${lateBy * 1000} ms late: and still releases to silence`); } }
    { const c = new FakeAudioContext(), g = c.createGain(); c.currentTime = 3; g.gain.setValueAtTime(0, 2.99); g.gain.setTargetAtTime(0.5, 2.99, 0.001); g.gain.setTargetAtTime(0, 2.993, 0.1);
      t.eq(valueAt(g.gain, 3.02), 0, 'negative control: a 10 ms late setTarget attack followed by a decay is silent (measured in Chromium, modelled by the fake)'); }
    { const c = new FakeAudioContext(), bus = c.createGain(); bus.connect(c.destination); c.markPersistent(); const o = c.createOscillator(), g = c.createGain(); o.connect(g); g.connect(bus);
      g.gain.setValueAtTime(0, 1); g.gain.linearRampToValueAtTime(0.5, 1.003); g.gain.setTargetAtTime(0, 1.003, 0.1); o.start(1); o.stop(2);
      t.ok(lintEnvelopes(c).some(m => /linear ramp is followed by a setTarget/.test(m)), 'negative control: a linear-ramp attack followed by a setTarget is flagged (Chromium blasts or drops it when late)'); }
  }

  // =====================================================================================================
  t.section('synth: every drum of every kit');
  let maxNodes = 0, maxSrc = 0;
  for (const kit of KIT_NAMES) for (const dn of DRUMS) for (const v of [1, 0.3]) {
    const r = rig(), R = KITS[kit][dn], tag = `${kit}.${dn} v${v}`, T0 = 2.5000077;   // not on a sample frame
    r.ctx.currentTime = 2.4;
    const ret = r.syn.drum(r.out, kit, dn, T0, v), vs = voices(r.ctx), gains = vs.filter(x => x.kind === 'gain');
    t.eq(ret, R.length, `${tag}: returns the sources started`); t.eq(r.ctx.sources.length, ret, `${tag}: and that many exist`);
    t.eq(r.syn.counters.nodes, vs.length, `${tag}: counters.nodes`); t.eq(r.syn.counters.starts, ret, `${tag}: counters.starts`); t.eq(r.syn.counters.oscs, vs.filter(x => x.kind === 'osc').length, `${tag}: counters.oscs`);
    t.ok(vs.length <= 6 && ret <= 2, `${tag}: at most 6 nodes and 2 sources (${vs.length}, ${ret})`); maxNodes = Math.max(maxNodes, vs.length); maxSrc = Math.max(maxSrc, ret);
    t.ok(gains.every(g => g.outs.length === 1 && g.outs[0] === r.out), `${tag}: every envelope plays into the given bus`);
    t.ok(r.ctx.sources.every(s => s.t0 > T0 - 1 / 44100 && s.t0 <= T0 + 0.05), `${tag}: starts at the hit time`);
    for (const b of vs.filter(x => x.kind === 'bufsrc')) { const fr = x => Math.abs(x * 44100 - Math.round(x * 44100)), g = b.outs[0].kind === 'gain' ? b.outs[0] : b.outs[0].outs[0], g0 = sched(g.gain)[0].t;
      t.ok(fr(b.t0) < 1e-6, `${tag}: the noise starts on a sample frame`); t.ok(g0 < b.t0 && g0 > b.t0 - 1 / 44100, `${tag}: its envelope starts within the sample before it`); }
    // one envelope per un-joined component, at the component volume x velocity
    const own = R.filter(p => !p.j); t.eq(gains.length, own.length, `${tag}: one envelope per component (joined partials share)`);
    own.forEach((p, i) => { const pk = Math.max(...sched(gains[i].gain).map(e => e.v)); t.ok(close(pk, p.v * v * (p.at ? OVER : 1)), `${tag}: component ${i} peaks at volume x velocity`); });
    t.ok(vs.every(x => Object.values(x).every(p => !p || !p.ev || p.ev.every(e => e.k === 'value' ? x.kind !== 'gain' : e.k === 'set' || e.k === 'target'))), `${tag}: only setValueAtTime / setTargetAtTime, and no .value on an envelope gain`);
    t.eq(vs.filter(x => x.kind === 'biquad').length, R.filter(p => p.k === 1 && p.ft).length, `${tag}: one filter per filtered noise, none for raw noise`);
    t.ok(vs.filter(x => x.kind === 'bufsrc').every(b => b.buffer === r.syn.noiseBuf && b.loop === true && b.offset >= 0 && b.offset < 1.2), `${tag}: noise is the looped shared buffer`);
    const lint = lintAll(r.ctx); t.eq(lint.length, 0, `${tag}: lint clean${lint.length ? ' (' + lint[0] + ')' : ''}`);
  }
  t.report('most nodes for one drum hit', maxNodes); t.report('most sources for one drum hit', maxSrc);
  {
    for (const kit of KIT_NAMES) { const c = KITS[kit].kick.find(p => p.w === 'click'), im = WAVES.click.im; t.ok(!!c && im[4] === Math.max(...im) && c.f * 4 >= 2400 && c.f * 4 <= 3200 && c.d <= 0.03, `${kit}.kick has a click partial near 2.8 kHz (${c ? c.f * 4 : 0} Hz)`); }
    t.ok(KITS.tight.kick[0].d < KITS.rock.kick[0].d && KITS.rock.kick[0].d < KITS.disco.kick[0].d, 'kick body: tight is shorter than rock, disco longer');
    t.ok(DRUMS.every(d => KITS.chip[d].filter(p => p.k === 1).every(p => p.ft === null)), 'chip: every noise burst is unfiltered');
    { const r = rig(); for (const d of DRUMS) r.syn.drum(r.out, 'chip', d, 1, 1); t.eq(r.ctx.count.biquad || 0, 0, 'chip: the whole kit creates no filter'); }
    for (const kit of KIT_NAMES) { const b = KITS[kit].brush; t.ok(b.length === 1 && b[0].k === 1 && b[0].at >= 0.03 && b[0].d >= 0.12 && b[0].v <= 0.1, `${kit}.brush is one long soft noise with a slow attack`); }
    { const im = WAVES.ride.im, nz = []; im.forEach((v, i) => { if (v) nz.push(i); }); t.eq(nz.join(), '20,26,31,78,93', 'ride table: a sine and two band-limited squares (fundamental + third harmonic each)'); t.ok(close(im[26] / im[78], 3) && close(im[31] / im[93], 3), 'ride table: the squares have the 1/3 third harmonic'); }
    for (const kit of KIT_NAMES) { const p = KITS[kit].ride.find(x => x.w === 'ride'); t.ok(!!p && p.f * 20 > 3500 && p.f * 31 < 8000, `${kit}.ride has the ping, 4-7 kHz`); }
    { const r = rig(); r.syn.drum(r.out, 'rock', 'clap', 1, 1); const g = voices(r.ctx).find(x => x.kind === 'gain'); t.eq(r.ctx.sources.length, 1, 'clap: one noise source'); t.eq(sched(g.gain).filter(e => e.k === 'set').length, 3, 'clap: three bursts on one envelope'); }
    { const r = rig(); r.syn.drum(r.out, 'rock', 'cow', 1, 1); const vs = voices(r.ctx); t.ok(vs.filter(x => x.kind === 'osc').length === 2 && vs.filter(x => x.kind === 'gain').length === 1, 'cow: two partials into one envelope'); }
    { const a = rig(), b = rig(); t.eq(a.syn.drum(a.out, 'nokit', 'kick', 1, 1), b.syn.drum(b.out, 'rock', 'kick', 1, 1), 'an unknown kit plays the rock kit'); }
    { const r = rig(); t.ok([r.syn.drum(r.out, 'rock', 'gong', 1, 1), r.syn.drum(r.out, 'rock', 'kick', 1, 0), r.syn.drum(r.out, 'rock', 'kick', NaN, 1), r.syn.drum(r.out, 'rock', 'kick', -1, 1), r.syn.drum(r.out, 'rock', 60, 1, 1)].every(x => x === 0) && voices(r.ctx).length === 0, 'unknown drums, zero velocity and bad times return 0 and create nothing'); }
    // a kick sweep starts from its own pitch (not 440 Hz) and velocity does not change the decay
    { const a = rig(), b = rig(); a.syn.drum(a.out, 'rock', 'kick', 1, 1); b.syn.drum(b.out, 'rock', 'kick', 1, 0.3); const o = voices(a.ctx).find(x => x.kind === 'osc'); t.eq(intrinsic(o.frequency), KITS.rock.kick[0].f, 'kick: the intrinsic frequency is the start of the sweep');
      const ta = sched(voices(a.ctx).find(x => x.kind === 'gain').gain)[1].tc, tb = sched(voices(b.ctx).find(x => x.kind === 'gain').gain)[1].tc; t.eq(ta, tb, 'kick: the decay does not depend on velocity'); }
  }

  // =====================================================================================================
  t.section('synth: hitNoise and hitTone (sound effects, swells, impacts)');
  {
    { const r = rig(); t.eq(r.syn.hitNoise(r.out, 1, 0.42, 0.2, 'bandpass', 400, 6000, 1.5), 1, 'hitNoise returns 1'); const vs = voices(r.ctx), fl = vs.find(x => x.kind === 'biquad'), g = vs.find(x => x.kind === 'gain'), src = r.ctx.sources[0];
      t.eq(vs.length, 3, 'hitNoise: source, filter, envelope'); t.ok(fl.type === 'bandpass' && intrinsic(fl.frequency) === 400 && intrinsic(fl.Q) === 1.5, 'hitNoise: filter type, start frequency and Q');
      t.eq(sched(fl.frequency).map(e => `${e.k}:${e.v}@${e.t}`).join(), 'set:400@1,target:6000@1', 'hitNoise: the sweep is a setTarget from f to `to`'); t.near(valueAt(fl.frequency, 1.42), 6000 - 5600 * Math.exp(-3), 1e-6, 'hitNoise: three time constants over the duration');
      const ev = sched(g.gain); t.ok(ev[0].k === 'set' && ev[0].v === 0.2 && ev[1].k === 'target' && ev[1].v === 0 && ev[1].t === ev[0].t && ev[0].t <= 1 && ev[0].t > 1 - 1 / 44100, 'hitNoise: instant attack, exponential decay, from half a sample before the source starts');
      t.near(valueAt(g.gain, 1.42), 1e-4, 1e-6, 'hitNoise: the level is 1e-4 after `dur`, as the old exponential ramp was'); t.ok(src.t1 >= 1 + 7 * ev[1].tc - EPS && src.t1 >= 1.42, 'hitNoise: stops after the decay'); t.eq(lintAll(r.ctx).length, 0, 'hitNoise: lint clean'); }
    { const r = rig(); r.syn.hitNoise(r.out, 1, 0.1, 0.1, null); t.eq(voices(r.ctx).length, 2, 'hitNoise with no filter type is raw noise (2 nodes)'); r.syn.hitNoise(r.out, 1, 0.1, 0.1, 'highpass', 6000); t.eq(sched(voices(r.ctx).find(x => x.kind === 'biquad').frequency).length, 0, 'hitNoise without a sweep target sets a plain frequency'); t.eq(lintAll(r.ctx).length, 0, 'lint clean'); }
    { const r = rig(); r.syn.hitNoise(r.out, 1, 2.5, 0.3, 'lowpass', 4000, 100); t.ok(r.ctx.sources[0].loop && r.ctx.sources[0].t1 >= 3.5, 'hitNoise can outlast the 1.2 s buffer (looped)'); }
    { const r = rig(); t.eq(r.syn.hitTone(r.out, 1, 'sine', 90, 35, 0.5, 0.5), 1, 'hitTone returns 1'); const vs = voices(r.ctx), o = vs.find(x => x.kind === 'osc'), g = vs.find(x => x.kind === 'gain');
      t.eq(vs.length, 2, 'hitTone: oscillator and envelope'); t.ok(intrinsic(o.frequency) === 90 && sched(o.frequency).map(e => `${e.k}:${e.v}@${e.t}`).join() === 'set:90@1,target:35@1' && close(sched(o.frequency)[1].tc, 0.5 / 3), 'hitTone: sweep from f to `to` over the duration');
      t.near(valueAt(g.gain, 1.5), 1e-4, 1e-6, 'hitTone: the level is 1e-4 after `dur`'); t.eq(lintAll(r.ctx).length, 0, 'hitTone: lint clean'); }
    { const r = rig(); r.syn.hitTone(r.out, 1, 'square', 880, 0, 0.06, 0.08); r.syn.hitTone(r.out, 1, 'triangle', 300, 5, 0.07, 0.1); r.syn.hitTone(r.out, 1, 'ride', 205, 0, 0.2, 0.004); const os = voices(r.ctx).filter(x => x.kind === 'osc');
      t.ok(sched(os[0].frequency).length === 0 && os[0].type === 'square', 'hitTone without a sweep'); t.eq(sched(os[1].frequency)[1].v, 20, 'hitTone: a sweep target under 20 Hz is clamped'); t.ok(os[2].wave === r.syn.waves.ride, 'hitTone accepts a wavetable name'); t.eq(lintAll(r.ctx).length, 0, 'lint clean (also for a very quiet hit)'); }
    { const r = rig(); t.ok([r.syn.hitTone(r.out, 1, 'sine', 90, 0, 0.5, 0), r.syn.hitNoise(r.out, 1, 0.5, 0, 'lowpass', 500), r.syn.hitNoise(r.out, NaN, 0.5, 0.1, 'lowpass', 500), r.syn.hitTone(r.out, 1, 'sine', 90, 0, 0, 0.5)].every(x => x === 0) && voices(r.ctx).length === 0, 'silent or unschedulable hits return 0 and create nothing'); }
  }

  // =====================================================================================================
  t.section('synth: live() and counters cannot drift');
  {
    const r = rig({ seed: 7 }), R = seeded(4242), pick = a => a[Math.floor(R() * a.length)];
    let now = 0, checks = 0, bad = 0, sum = 0, mono = true, last = 0;
    for (let i = 0; i < 6000; i++) {
      now += R() * 0.05; r.ctx.currentTime = now; const at = now + 0.005 + R() * 0.3, k = R();
      if (k < 0.35) sum += r.syn.note(r.route, { n: 48 + Math.floor(R() * 30), d: 0.1 + R() * 3, v: 0.3 + R() * 0.7 }, at, 0.1 + R() * 0.4, 1, pick(PATCHES));
      else if (k < 0.5) { const n = 48 + Math.floor(R() * 20); sum += r.syn.note(r.route, { n, ns: [n, n + 4, n + 7, n + 11].slice(0, 2 + Math.floor(R() * 3)), d: 0.5 + R() * 2, v: 0.6, x: R() < 0.3 ? { pad: 1 } : undefined }, at, 0.2 + R() * 0.3, 1, pick(['epiano', 'strings', 'dist', 'nylon'])); }
      else if (k < 0.58) sum += r.syn.note(r.route, { n: 72, d: 1 + R(), v: 0.7, orn: pick(['cut', 'flip', 'mordent', 'trill', 'bend', 'glide']), on: 74 }, at, 0.1 + R() * 0.4, 1, pick(['flute', 'fiddle', 'sawlead']));
      else if (k < 0.64) sum += r.syn.note(r.route, { n: 60, d: 1, v: 0.7, x: { arp: [0, 3, 7] } }, at, 0.1 + R() * 0.4, 1, 'pulse25');
      else if (k < 0.94) r.syn.drum(r.out, pick(KIT_NAMES), pick(DRUMS), at, 0.2 + R() * 0.8);
      else if (k < 0.97) r.syn.hitNoise(r.out, at, 0.05 + R() * 2, 0.2, 'bandpass', 400, 6000);
      else r.syn.hitTone(r.out, at, 'sine', 90, 35, 0.5, 0.5);
      if (i % 7 === 0) { const a = r.syn.live(now), b = pendingAt(r.ctx, now); checks++; if (a !== b) bad++; if (i % 700 === 0) r.ctx.prune(now - 1); }
      if (r.syn.counters.starts < last) mono = false; last = r.syn.counters.starts;
    }
    t.eq(bad, 0, `live(now) equals the recorded sources with a stop time ahead, at ${checks} checkpoints over ${Math.round(now)} s`);
    t.eq(r.syn.counters.nodes, r.ctx.count.total - 3, 'counters.nodes equals every node the context created');
    t.eq(r.syn.counters.starts, r.ctx.oscStarts.length + r.ctx.bufStarts.length, 'counters.starts equals every source started'); t.eq(r.syn.counters.oscs, r.ctx.count.osc, 'counters.oscs equals every oscillator created');
    t.ok(mono, 'counters only grow'); t.ok(sum > 0 && sum <= r.syn.counters.oscs, 'note() return values add up to oscillators');
    t.ok(r.syn.live(now + 0.3) <= r.syn.live(now), 'live() falls as time passes'); t.eq(r.syn.live(now + 30), 0, 'nothing is live 30 s after the last event'); t.eq(r.syn.live(now), 0, 'and a pruned source never comes back');
    const lint = [...lintSources(r.ctx), ...lintEnvelopes(r.ctx), ...lintSchedule(r.ctx), ...lintGraph(r.ctx), ...lintStartValues(r.ctx), ...r.ctx.warnings];
    t.eq(lint.length, 0, `the whole random session is lint clean${lint.length ? ' (' + lint[0] + ')' : ''}`);
    // more pending sources than the tracking array holds, with live() never called in between
    const b = rig(); for (let i = 0; i < 1500; i++) b.syn.note(b.route, { n: 60, ns: [60, 64, 67], d: 1, v: 0.5 }, 1 + i * 1e-4, 0.4, 1, 'organ');
    t.eq(b.syn.live(0), 4500, '4500 sources scheduled at once are all counted'); t.eq(b.syn.live(1.3), pendingAt(b.ctx, 1.3), 'and still agree with the record once time moves');
    const c = rig(); let ok = true; for (let i = 0; i < 5000; i++) { c.ctx.currentTime = i * 0.01; c.syn.drum(c.out, 'rock', 'hat', i * 0.01 + 0.005, 1); if (i % 997 === 0 && c.syn.live(i * 0.01) !== pendingAt(c.ctx, i * 0.01)) ok = false; }
    t.ok(ok && c.syn._stops.length === 1024, '5000 hits over 50 s without regular live() calls: counts agree and the tracking array did not grow');
  }

  // =====================================================================================================
  t.section('synth: cost of a busy second (report)');
  {
    // 52 events in one second, the spec ceiling: a funk-like mix of chords, clav, bass, lead, kit and tops
    const r = rig(); let ev = 0;
    for (let b = 0; b < 4; b++) {
      const at = 1 + b * 0.25;
      r.syn.drum(r.out, 'tight', 'kick', at, 1); r.syn.drum(r.out, 'tight', b % 2 ? 'snare' : 'kick', at + 0.125, 0.8); ev += 2;
      for (let s = 0; s < 4; s++) { r.syn.drum(r.out, 'tight', 'hat', at + s * 0.0625, 0.6); ev++; }
      for (let s = 0; s < 2; s++) { r.syn.note(r.route, { n: 40, d: 0.4, v: 0.9 }, at + s * 0.125, 0.25, 1, 'slap'); ev++; }
      r.syn.note(r.route, { n: 60, ns: [60, 64, 67, 70], d: 0.3, v: 0.7 }, at, 0.25, 1, 'epiano'); ev += 4;
      for (let s = 0; s < 4; s++) { r.syn.note(r.route, { n: 72, d: 0.2, v: 0.5 }, at + s * 0.0625, 0.25, 1, 'clav'); ev++; }
      r.syn.note(r.route, { n: 76, d: 0.9, v: 0.8 }, at, 0.25, 1, 'brass'); ev++;
    }
    t.report('events scheduled in the busy second', ev);
    t.report('node creations', r.ctx.count.total - 3); t.report('oscillator starts in the busiest 1 s window', startRate(r.ctx)); t.report('peak simultaneous sources', peakLive(r.ctx));
    t.ok(r.ctx.count.total - 3 <= 260, 'a 68-event funk second stays under 260 node creations'); t.ok(startRate(r.ctx) <= 110, 'and under 110 oscillator starts');
    const t0 = performance.now(), b = rig(); for (let i = 0; i < 20000; i++) { b.syn.note(b.route, { n: 60, ns: [60, 64, 67], d: 1, v: 0.5 }, 1 + i * 0.01, 0.4, 1, 'epiano'); if (i % 500 === 0) { b.ctx.currentTime = i * 0.01; b.ctx.prune(i * 0.01 - 5); b.syn.live(i * 0.01); } }
    t.report('microseconds per 3-note chord on the fake context', (performance.now() - t0) * 1000 / 20000);
  }
}

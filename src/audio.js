// HEXBEAT — WebAudio synth. The wheel IS the music: every step plays drums plus the fired rune's note.
const SCALE = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22];
const PATTERN = [0, 2, 4, 2, 3, 5, 4, 6];
const PROG = [0, 0, -4, -2];
const TIMBRE = { arcane: 'triangle', fire: 'sawtooth', frost: 'sine', volt: 'square', void: 'sawtooth', nature: 'triangle', steel: 'square', mod: 'sine' };

export class Audio {
  constructor(opts) { this.opts = opts; this.ctx = null; this.root = 0; this.bar = 0; this.last = {}; }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      const c = this.ctx = new C();
      this.out = c.createDynamicsCompressor(); this.out.threshold.value = -14; this.out.ratio.value = 6; this.out.connect(c.destination);
      this.music = c.createGain(); this.music.gain.value = 0.5; this.music.connect(this.out);
      this.fxg = c.createGain(); this.fxg.gain.value = 0.55; this.fxg.connect(this.out);
      const len = c.sampleRate * 0.5, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    } catch (e) { this.ctx = null; }
  }
  setRoot(r) { this.root = r; }
  freq(semi) { return 110 * Math.pow(2, (semi + this.root % 12 - 2) / 12); }
  tone(dest, type, f, dur, vol, o = {}) {
    const c = this.ctx, t = c.currentTime + (o.delay || 0), osc = c.createOscillator(), g = c.createGain();
    osc.type = type; osc.frequency.setValueAtTime(f, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + (o.att || 0.005)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (o.lp) { const f2 = c.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = o.lp; osc.connect(f2); node = f2; }
    node.connect(g); g.connect(dest); osc.start(t); osc.stop(t + dur + 0.02);
  }
  noise(dest, dur, vol, o = {}) {
    const c = this.ctx, t = c.currentTime + (o.delay || 0), src = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter();
    src.buffer = this.noiseBuf; f.type = o.type || 'highpass'; f.frequency.setValueAtTime(o.f || 6000, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest); src.start(t); src.stop(t + dur + 0.02);
  }
  // one wheel step
  step(i, n, def, drop, boss) {
    if (!this.ctx || !this.opts.music) return;
    const m = this.music, half = n >> 1;
    if (i === 0) this.bar++;
    const chord = PROG[this.bar % 4];
    if (i === 0 || i === half || (drop && i % 2 === 0)) { this.tone(m, 'sine', 150, 0.22, 0.9, { to: 40 }); }
    if (i === 0) this.tone(m, 'sawtooth', this.freq(chord - 12), 0.32, 0.3, { lp: 500 });
    else if (i % 2 === 0 || boss) this.tone(m, 'sawtooth', this.freq(chord - 12 + (i === half ? 7 : 0)), 0.14, 0.2, { lp: 420 });
    this.noise(m, i % 2 ? 0.05 : 0.03, i % 2 ? 0.16 : 0.09, { f: 8000 });
    if ((boss || drop) && (i === half || (n >= 6 && i === n - 2))) this.noise(m, 0.14, 0.3, { type: 'bandpass', f: 1800 });
    if (!def) { this.tone(m, 'triangle', this.freq(chord + SCALE[PATTERN[i]] + 12), 0.09, 0.07); return; }
    if (def.type === 'mod') { this.noise(m, 0.09, 0.22, { type: 'bandpass', f: 2600 }); this.tone(m, 'sine', this.freq(chord + 24), 0.06, 0.1); return; }
    const semi = chord + SCALE[PATTERN[i]] + (def.elem === 'void' || def.elem === 'fire' ? 0 : 12);
    this.tone(m, TIMBRE[def.elem], this.freq(semi), 0.24, def.elem === 'frost' || def.elem === 'arcane' ? 0.22 : 0.12, { lp: def.elem === 'fire' || def.elem === 'void' ? 1400 : 3200 });
    this.tone(m, 'sine', this.freq(semi + 12), 0.3, 0.06, { delay: 0.01 });
  }
  sfx(name) {
    if (!this.ctx || !this.opts.sfx) return;
    const now = this.ctx.currentTime, gap = { hit: 0.045, kill: 0.05, gem: 0.04, coin: 0.05, crit: 0.06, zap: 0.08, boom: 0.08, eshoot: 0.15 }[name] || 0;
    if (gap && now - (this.last[name] || 0) < gap) return;
    this.last[name] = now;
    const f = this.fxg;
    switch (name) {
      case 'hit': this.noise(f, 0.04, 0.12, { type: 'bandpass', f: 1500 + Math.random() * 800 }); break;
      case 'crit': this.tone(f, 'square', 1200, 0.07, 0.1, { to: 600 }); this.noise(f, 0.05, 0.15, { f: 4000 }); break;
      case 'kill': this.tone(f, 'triangle', 300 + Math.random() * 120, 0.08, 0.14, { to: 90 }); break;
      case 'gem': this.gemN = now - (this.gemT || 0) < 0.4 ? Math.min(12, (this.gemN || 0) + 1) : 0; this.gemT = now; this.tone(f, 'sine', 700 * Math.pow(2, this.gemN / 12), 0.07, 0.1); break;
      case 'coin': this.tone(f, 'square', 1320, 0.05, 0.06); this.tone(f, 'square', 1760, 0.09, 0.06, { delay: 0.05 }); break;
      case 'heal': this.tone(f, 'sine', 520, 0.12, 0.15); this.tone(f, 'sine', 780, 0.18, 0.15, { delay: 0.09 }); break;
      case 'chest': [0, 4, 7, 12].forEach((s, k) => this.tone(f, 'triangle', 440 * Math.pow(2, s / 12), 0.2, 0.16, { delay: k * 0.07 })); break;
      case 'levelup': [0, 4, 7, 12, 16].forEach((s, k) => this.tone(f, 'square', 330 * Math.pow(2, s / 12), 0.16, 0.09, { delay: k * 0.06 })); break;
      case 'pick': this.tone(f, 'triangle', 660, 0.08, 0.16); this.tone(f, 'triangle', 990, 0.14, 0.16, { delay: 0.06 }); break;
      case 'ui': this.tone(f, 'square', 520, 0.04, 0.06); break;
      case 'deny': this.tone(f, 'square', 160, 0.12, 0.1); break;
      case 'buy': this.tone(f, 'square', 880, 0.06, 0.08); this.tone(f, 'square', 1320, 0.14, 0.08, { delay: 0.06 }); break;
      case 'dash': this.noise(f, 0.16, 0.2, { type: 'bandpass', f: 800, to: 3200 }); break;
      case 'hurt': this.tone(f, 'sawtooth', 220, 0.22, 0.3, { to: 60 }); this.noise(f, 0.12, 0.3, { type: 'lowpass', f: 900 }); break;
      case 'die': this.tone(f, 'sawtooth', 330, 1.1, 0.35, { to: 30 }); this.noise(f, 0.6, 0.3, { type: 'lowpass', f: 1200, to: 100 }); break;
      case 'zap': this.tone(f, 'square', 1800, 0.08, 0.06, { to: 300 }); break;
      case 'boom': this.tone(f, 'sine', 120, 0.3, 0.4, { to: 35 }); this.noise(f, 0.22, 0.25, { type: 'lowpass', f: 1400, to: 200 }); break;
      case 'wave': this.tone(f, 'sawtooth', 90, 0.25, 0.3, { to: 45, lp: 600 }); break;
      case 'react': this.tone(f, 'square', 880, 0.05, 0.1); this.tone(f, 'square', 1760, 0.12, 0.1, { delay: 0.04 }); this.noise(f, 0.1, 0.15, { f: 5000 }); break;
      case 'eshoot': this.tone(f, 'square', 400, 0.08, 0.05, { to: 200 }); break;
      case 'warn': this.tone(f, 'square', 440, 0.12, 0.12); this.tone(f, 'square', 440, 0.12, 0.12, { delay: 0.18 }); break;
      case 'boss': this.tone(f, 'sawtooth', 55, 1.2, 0.5, { lp: 400 }); this.tone(f, 'sawtooth', 58, 1.2, 0.4, { lp: 400 }); this.noise(f, 0.8, 0.2, { type: 'lowpass', f: 300, to: 2000 }); break;
      case 'bossDie': this.tone(f, 'sine', 200, 1.2, 0.5, { to: 30 }); this.noise(f, 1, 0.4, { type: 'lowpass', f: 4000, to: 100 }); [0, 7, 12, 19].forEach((s, k) => this.tone(f, 'triangle', 220 * Math.pow(2, s / 12), 0.5, 0.15, { delay: 0.3 + k * 0.1 })); break;
      case 'drop': this.noise(f, 0.5, 0.35, { type: 'bandpass', f: 300, to: 6000 }); this.tone(f, 'sine', 180, 0.7, 0.7, { to: 28, delay: 0.05 }); this.tone(f, 'sawtooth', 880, 0.4, 0.12, { to: 110 }); break;
      case 'dropEnd': this.tone(f, 'sine', 500, 0.3, 0.12, { to: 120 }); break;
    }
  }
}

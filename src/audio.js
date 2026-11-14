// HEXBEAT — WebAudio. A small General-MIDI-flavoured synth plays the song written by music.js.
// The wheel is the conductor: every wheel step is one beat, so the game's tempo and meter ARE the music's.
import { Song } from './music.js';

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

// Instrument patches. o: [waveform, frequency ratio, gain, detune cents]. d = decay seconds (0 = sustained),
// s = sustain level, lp = lowpass Hz or [from, to, seconds] sweep, hp = highpass Hz.
const PATCH = {
  square: { o: [['square', 1, 1, 0]], a: 0.005, d: 0, s: 0.8, r: 0.06, lp: 3600, lvl: 0.13, vib: 1 },
  sawlead: { o: [['sawtooth', 1, 1, -6], ['sawtooth', 1, 0.8, 7]], a: 0.01, d: 0, s: 0.85, r: 0.08, lp: 2600, lvl: 0.1, vib: 1 },
  fiddle: { o: [['sawtooth', 1, 1, 0]], a: 0.04, d: 0, s: 0.9, r: 0.08, lp: 2300, hp: 300, lvl: 0.12, vib: 1 },
  flute: { o: [['sine', 1, 1, 0], ['triangle', 2, 0.18, 0]], a: 0.035, d: 0, s: 0.9, r: 0.07, lvl: 0.2, vib: 1 },
  brass: { o: [['sawtooth', 1, 1, 0], ['sawtooth', 1, 0.6, 5]], a: 0.02, d: 0, s: 0.8, r: 0.07, lp: [500, 2600, 0.07], lvl: 0.11 },
  clav: { o: [['square', 1, 1, 0]], a: 0.002, d: 0.22, s: 0, r: 0.03, lp: 3000, hp: 500, lvl: 0.16 },
  vibes: { o: [['sine', 1, 1, 0], ['sine', 4, 0.22, 0]], a: 0.003, d: 0.9, s: 0, r: 0.2, lvl: 0.2 },
  marimba: { o: [['sine', 1, 1, 0], ['sine', 4, 0.3, 0]], a: 0.002, d: 0.24, s: 0, r: 0.05, lvl: 0.26 },
  epiano: { o: [['sine', 1, 1, 0], ['sine', 2, 0.25, 0], ['sine', 7, 0.08, 0]], a: 0.003, d: 0.7, s: 0, r: 0.1, lvl: 0.13 },
  harpsi: { o: [['sawtooth', 1, 1, 0], ['square', 2, 0.5, 0]], a: 0.002, d: 0.38, s: 0, r: 0.04, hp: 400, lp: 5000, lvl: 0.075 },
  pluck: { o: [['sawtooth', 1, 1, 0]], a: 0.002, d: 0.2, s: 0, r: 0.04, lp: [3200, 500, 0.15], lvl: 0.09 },
  nylon: { o: [['triangle', 1, 1, 0], ['sine', 2, 0.3, 0]], a: 0.003, d: 0.45, s: 0, r: 0.06, lp: 2000, lvl: 0.13 },
  organ: { o: [['sine', 1, 1, 0], ['sine', 2, 0.5, 0], ['sine', 3, 0.25, 0]], a: 0.01, d: 0, s: 1, r: 0.05, lvl: 0.07 },
  strings: { o: [['sawtooth', 1, 1, -8], ['sawtooth', 1, 1, 8]], a: 0.09, d: 0, s: 1, r: 0.16, lp: 1700, lvl: 0.04 },
  dist: { o: [['sawtooth', 1, 1, 0], ['square', 1, 0.5, 4]], a: 0.004, d: 0, s: 0.9, r: 0.04, lvl: 0.5, bus: 'dist' },
  bell: { o: [['sine', 1, 1, 0], ['sine', 3.01, 0.35, 0]], a: 0.002, d: 0.5, s: 0, r: 0.1, lvl: 0.16 },
  // basses
  synbass: { o: [['sawtooth', 1, 1, 0], ['square', 0.5, 0.4, 0]], a: 0.004, d: 0, s: 0.8, r: 0.04, lp: [900, 380, 0.12], lvl: 0.26 },
  finger: { o: [['triangle', 1, 1, 0], ['sine', 1, 0.6, 0]], a: 0.006, d: 0.7, s: 0, r: 0.05, lp: 900, lvl: 0.42 },
  slap: { o: [['square', 1, 1, 0], ['sawtooth', 2, 0.3, 0]], a: 0.002, d: 0.3, s: 0, r: 0.03, lp: [2400, 600, 0.08], lvl: 0.24 },
};
PATCH.organbass = { ...PATCH.organ, lvl: 0.3 };
// which voice answers when a rune of this element fires
const ELEM_INST = { arcane: 'vibes', fire: 'brass', frost: 'bell', volt: 'square', void: 'organ', nature: 'marimba', steel: 'harpsi' };

export class Audio {
  constructor(opts) { this.opts = opts; this.ctx = null; this.last = {}; this.song = null; this.barIdx = -1; this.biome = 'crypt'; }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try { const C = window.AudioContext || window.webkitAudioContext; if (C) this.init(new C()); } catch (e) { this.ctx = null; }
  }
  // also used with an OfflineAudioContext by the render test
  init(c) {
    this.ctx = c;
    this.out = c.createDynamicsCompressor(); this.out.threshold.value = -16; this.out.ratio.value = 5; this.out.attack.value = 0.005; this.out.release.value = 0.2; this.out.connect(c.destination);
    this.music = c.createGain(); this.music.gain.value = 0.48; this.music.connect(this.out);
    this.fxg = c.createGain(); this.fxg.gain.value = 0.42; this.fxg.connect(this.out);
    // a short feedback echo gives the dry synths a little room
    const dl = c.createDelay(0.5), fb = c.createGain(), lp = c.createBiquadFilter(); dl.delayTime.value = 0.19; fb.gain.value = 0.28; lp.type = 'lowpass'; lp.frequency.value = 2200;
    this.send = c.createGain(); this.send.gain.value = 0.2; this.send.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(this.music);
    // distortion bus for guitars
    const ws = c.createWaveShaper(), curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 6); } ws.curve = curve;
    const dlp = c.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2600; const dg = c.createGain(); dg.gain.value = 0.11;
    this.dist = c.createGain(); this.dist.connect(ws); ws.connect(dlp); dlp.connect(dg); dg.connect(this.music);
    const len = Math.floor(c.sampleRate * 1.2), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    if (!this.song) this.newSong(this.biome);
  }
  newSong(biome) { this.biome = biome || this.biome; this.song = new Song((Math.random() * 4294967296) >>> 0, this.biome); this.barIdx = -1; return this.song; }
  info() { return this.song ? this.song.title : ''; }

  // ---------- synth ----------
  note(patchName, midi, t, dur, vel, scale = 1) {
    const P = PATCH[patchName] || PATCH.square, c = this.ctx, f = mtof(midi);
    const g = c.createGain(), lvl = P.lvl * vel * scale, end = t + Math.max(0.03, dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(lvl, t + P.a);
    if (P.d) g.gain.setTargetAtTime(lvl * P.s, t + P.a, P.d / 3); else g.gain.setTargetAtTime(lvl * P.s, t + P.a, 0.04);
    g.gain.setTargetAtTime(0, end, P.r / 3);
    const stop = end + P.r * 2 + 0.03;
    let head = g;
    if (P.lp) { const fl = c.createBiquadFilter(); fl.type = 'lowpass'; if (Array.isArray(P.lp)) { fl.frequency.setValueAtTime(P.lp[0], t); fl.frequency.exponentialRampToValueAtTime(P.lp[1], t + P.lp[2]); } else fl.frequency.value = P.lp; fl.connect(g); head = fl; }
    if (P.hp) { const fh = c.createBiquadFilter(); fh.type = 'highpass'; fh.frequency.value = P.hp; fh.connect(head); head = fh; }
    let lfo = null;
    if (P.vib && dur > 0.28) { lfo = c.createOscillator(); const lg = c.createGain(); lfo.frequency.value = 5.6; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.006, t + 0.25); lfo.connect(lg); lfo.start(t); lfo.stop(stop); lfo.lg = lg; }
    for (const [type, ratio, gain, det] of P.o) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = f * ratio; if (det) o.detune.value = det;
      if (lfo) lfo.lg.connect(o.frequency);
      if (gain === 1) o.connect(head); else { const og = c.createGain(); og.gain.value = gain; o.connect(og); og.connect(head); }
      o.start(t); o.stop(stop);
    }
    if (P.bus === 'dist') g.connect(this.dist); else { g.connect(this.music); if (!P.dry) g.connect(this.send); }
  }
  hitNoise(dest, t, dur, vol, type, f, to, q) {
    const c = this.ctx, src = c.createBufferSource(), g = c.createGain(), fl = c.createBiquadFilter();
    src.buffer = this.noiseBuf; fl.type = type; fl.frequency.setValueAtTime(f, t); if (to) fl.frequency.exponentialRampToValueAtTime(to, t + dur); if (q) fl.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(fl); fl.connect(g); g.connect(dest); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }
  hitTone(dest, t, type, f, to, dur, vol) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.02);
  }
  drum(n, t, v) {
    const m = this.music, N = (dur, vol, type, f, to, q) => this.hitNoise(m, t, dur, vol * v, type, f, to, q), T = (type, f, to, dur, vol) => this.hitTone(m, t, type, f, to, dur, vol * v);
    switch (n) {
      case 'kick': T('sine', 150, 42, 0.2, 0.85); T('triangle', 900, 100, 0.02, 0.2); break;
      case 'snare': N(0.14, 0.3, 'bandpass', 1900, 0, 0.7); T('triangle', 200, 140, 0.09, 0.3); break;
      case 'hat': N(0.035, 0.13, 'highpass', 7800); break;
      case 'pedal': N(0.05, 0.1, 'highpass', 6000); break;
      case 'ohat': N(0.2, 0.12, 'highpass', 7000); break;
      case 'ride': N(0.25, 0.07, 'highpass', 6500); T('sine', 4100, 0, 0.18, 0.03); break;
      case 'crash': N(0.9, 0.16, 'highpass', 4500); break;
      case 'clap': this.hitNoise(m, t, 0.02, 0.22 * v, 'bandpass', 1400, 0, 1); this.hitNoise(m, t + 0.012, 0.02, 0.22 * v, 'bandpass', 1400, 0, 1); this.hitNoise(m, t + 0.024, 0.11, 0.26 * v, 'bandpass', 1400, 0, 1); break;
      case 'rim': T('triangle', 1750, 0, 0.025, 0.3); N(0.012, 0.1, 'highpass', 3000); break;
      case 'tom1': T('sine', 210, 130, 0.2, 0.5); break;
      case 'tom2': T('sine', 150, 95, 0.22, 0.5); break;
      case 'tom3': T('sine', 105, 65, 0.26, 0.6); break;
      case 'shaker': N(0.04, 0.07, 'bandpass', 5200, 0, 1.2); break;
      case 'cow': T('square', 545, 0, 0.09, 0.07); T('square', 815, 0, 0.09, 0.05); break;
      case 'tamb': N(0.09, 0.09, 'highpass', 6800); break;
      case 'timp': T('sine', 98, 82, 0.6, 0.6); N(0.08, 0.12, 'lowpass', 500); break;
    }
  }

  // ---------- sequencing: one call per wheel step ----------
  // m = { beat, beats, unit, dur (seconds this beat lasts), def (rune fired), slot, drop, boss }
  step(m, when) {
    const c = this.ctx; if (!c || !this.opts.music || !this.song) return;
    const t = (when === undefined ? c.currentTime : when) + 0.015, song = this.song;
    if (m.beat === 0) this.barIdx++;
    if (this.barIdx < 0) this.barIdx = 0;
    const bar = song.bar(this.barIdx, m.beats, m.unit), evs = bar.events[m.beat]; if (!evs) return;
    const busy = m.dur < 0.13; // double time + DROP: thin the texture so it stays clean (and cheap)
    let hasKick = false;
    for (const e of evs) {
      const at = t + e.o * m.dur, len = e.d * m.dur;
      if (e.part === 'drum') { if (busy && e.o !== 0 && e.n !== 'kick' && e.n !== 'snare') continue; if (e.n === 'kick' && e.o === 0) hasKick = true; this.drum(e.n, at, e.v); }
      else if (e.part === 'lead') { this.note(song.leadInst, e.n, at, len, e.v); if (m.boss) this.note('sawlead', e.n - 12, at, len, e.v * 0.5); }
      else if (e.part === 'bass') this.note(song.g.bass[0] === 'organ' ? 'organbass' : song.g.bass[0], e.n, at, len, e.v);
      else { if (busy && e.o !== 0) continue; this.note(e.part.slice(5), e.n, at, len, e.v, 0.8); }
    }
    const acc = bar.accents.includes(m.beat);
    if (m.boss && !hasKick && (acc || m.unit === 4)) this.drum('kick', t, 0.7);
    if (m.drop) { this.drum('hat', t + m.dur * 0.5, 0.6); if (acc) this.drum('clap', t, 0.7); }
    // the rune that just fired answers on a chord tone, in its element's voice
    const d = m.def;
    if (d) {
      const v = bar.voicing;
      if (d.fusion) v.forEach((n, k) => this.note('brass', n + 12, t + k * 0.012, m.dur * 0.9, 0.6));
      else if (d.type === 'mod') { this.drum('rim', t, 0.8); this.drum(m.slot % 2 ? 'tom1' : 'cow', t + m.dur * 0.5, 0.6); }
      else this.note(ELEM_INST[d.elem] || 'vibes', v[m.slot % v.length] + 12, t, Math.min(0.3, m.dur * 0.8), 0.55);
    }
  }
  // a Grace Note slot takes no time: play an actual grace note
  grace() {
    const c = this.ctx; if (!c || !this.opts.music || !this.song) return;
    const bar = this.song.bar(Math.max(0, this.barIdx), 4, 4), top = bar.voicing[bar.voicing.length - 1] + 12, t = c.currentTime + 0.01;
    this.note('marimba', top + 2, t, 0.05, 0.5); this.note('marimba', top, t + 0.045, 0.1, 0.6);
  }

  // ---------- sound effects ----------
  tone(dest, type, f, dur, vol, o = {}) {
    const c = this.ctx, t = c.currentTime + (o.delay || 0), osc = c.createOscillator(), g = c.createGain();
    osc.type = type; osc.frequency.setValueAtTime(f, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + (o.att || 0.005)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (o.lp) { const f2 = c.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = o.lp; osc.connect(f2); node = f2; }
    node.connect(g); g.connect(dest); osc.start(t); osc.stop(t + dur + 0.02);
  }
  noise(dest, dur, vol, o = {}) { this.hitNoise(dest, this.ctx.currentTime + (o.delay || 0), dur, vol, o.type || 'highpass', o.f || 6000, o.to); }
  sfx(name) {
    if (!this.ctx || !this.opts.sfx) return;
    const now = this.ctx.currentTime, gap = { hit: 0.05, kill: 0.06, gem: 0.04, coin: 0.05, crit: 0.07, zap: 0.09, boom: 0.09, eshoot: 0.15 }[name] || 0;
    if (gap && now - (this.last[name] || 0) < gap) return;
    this.last[name] = now;
    const f = this.fxg;
    switch (name) {
      case 'hit': this.noise(f, 0.035, 0.07, { type: 'bandpass', f: 1500 + Math.random() * 800 }); break;
      case 'crit': this.tone(f, 'square', 1200, 0.06, 0.07, { to: 600 }); this.noise(f, 0.04, 0.1, { f: 4000 }); break;
      case 'kill': this.tone(f, 'triangle', 300 + Math.random() * 120, 0.07, 0.1, { to: 90 }); break;
      case 'gem': this.gemN = now - (this.gemT || 0) < 0.4 ? Math.min(12, (this.gemN || 0) + 1) : 0; this.gemT = now; this.tone(f, 'sine', 700 * Math.pow(2, this.gemN / 12), 0.07, 0.08); break;
      case 'coin': this.tone(f, 'square', 1320, 0.05, 0.05); this.tone(f, 'square', 1760, 0.09, 0.05, { delay: 0.05 }); break;
      case 'heal': this.tone(f, 'sine', 520, 0.12, 0.15); this.tone(f, 'sine', 780, 0.18, 0.15, { delay: 0.09 }); break;
      case 'chest': [0, 4, 7, 12].forEach((s, k) => this.tone(f, 'triangle', 440 * Math.pow(2, s / 12), 0.2, 0.16, { delay: k * 0.07 })); break;
      case 'levelup': [0, 4, 7, 12, 16].forEach((s, k) => this.tone(f, 'square', 330 * Math.pow(2, s / 12), 0.16, 0.09, { delay: k * 0.06 })); break;
      case 'fuse': [0, 7, 12, 16, 19, 24].forEach((s, k) => this.tone(f, 'sawtooth', 220 * Math.pow(2, s / 12), 0.5, 0.1, { delay: k * 0.07, lp: 2400 })); this.noise(f, 0.9, 0.2, { type: 'bandpass', f: 400, to: 7000 }); break;
      case 'pick': this.tone(f, 'triangle', 660, 0.08, 0.16); this.tone(f, 'triangle', 990, 0.14, 0.16, { delay: 0.06 }); break;
      case 'ui': this.tone(f, 'square', 520, 0.04, 0.06); break;
      case 'deny': this.tone(f, 'square', 160, 0.12, 0.1); break;
      case 'buy': this.tone(f, 'square', 880, 0.06, 0.08); this.tone(f, 'square', 1320, 0.14, 0.08, { delay: 0.06 }); break;
      case 'dash': this.noise(f, 0.16, 0.2, { type: 'bandpass', f: 800, to: 3200 }); break;
      case 'hurt': this.tone(f, 'sawtooth', 220, 0.22, 0.3, { to: 60 }); this.noise(f, 0.12, 0.3, { type: 'lowpass', f: 900 }); break;
      case 'die': this.tone(f, 'sawtooth', 330, 1.1, 0.35, { to: 30 }); this.noise(f, 0.6, 0.3, { type: 'lowpass', f: 1200, to: 100 }); break;
      case 'zap': this.tone(f, 'square', 1800, 0.07, 0.045, { to: 300 }); break;
      case 'boom': this.tone(f, 'sine', 120, 0.3, 0.32, { to: 35 }); this.noise(f, 0.2, 0.18, { type: 'lowpass', f: 1400, to: 200 }); break;
      case 'wave': this.tone(f, 'sawtooth', 90, 0.25, 0.3, { to: 45, lp: 600 }); break;
      case 'react': this.tone(f, 'square', 880, 0.05, 0.08); this.tone(f, 'square', 1760, 0.12, 0.08, { delay: 0.04 }); this.noise(f, 0.1, 0.12, { f: 5000 }); break;
      case 'eshoot': this.tone(f, 'square', 400, 0.08, 0.05, { to: 200 }); break;
      case 'warn': this.tone(f, 'square', 440, 0.12, 0.12); this.tone(f, 'square', 440, 0.12, 0.12, { delay: 0.18 }); break;
      case 'boss': this.tone(f, 'sawtooth', 55, 1.2, 0.5, { lp: 400 }); this.tone(f, 'sawtooth', 58, 1.2, 0.4, { lp: 400 }); this.noise(f, 0.8, 0.2, { type: 'lowpass', f: 300, to: 2000 }); break;
      case 'bossDie': this.tone(f, 'sine', 200, 1.2, 0.5, { to: 30 }); this.noise(f, 1, 0.4, { type: 'lowpass', f: 4000, to: 100 }); [0, 7, 12, 19].forEach((s, k) => this.tone(f, 'triangle', 220 * Math.pow(2, s / 12), 0.5, 0.15, { delay: 0.3 + k * 0.1 })); break;
      case 'drop': this.noise(f, 0.5, 0.35, { type: 'bandpass', f: 300, to: 6000 }); this.tone(f, 'sine', 180, 0.7, 0.7, { to: 28, delay: 0.05 }); this.tone(f, 'sawtooth', 880, 0.4, 0.12, { to: 110 }); break;
      case 'dropEnd': this.tone(f, 'sine', 500, 0.3, 0.12, { to: 120 }); break;
    }
  }
}

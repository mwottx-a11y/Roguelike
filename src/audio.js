// HEXBEAT — WebAudio engine. The wheel is the conductor: every wheel step is one beat, so the game's tempo
// and meter ARE the music's. music.js composes the song, the genre packs arrange it, blend.js decides who
// plays which stem, mixer.js is the DJ (phrase-locked handovers, energy, form), synth.js makes the sound.
// This file owns the mixing desk and the clock, and schedules one beat per step.
//
//   kit, bass, rune answers ─────────────► dry ───────────────┐
//   hats / chords / colour / tune ─► main ─┐                   │
//      (coming in)                ─► in  ─► lowpass ──┼─► pump ─┼─► music ─► master lowpass ─► comp ─┐
//      (going out)                ─► out ─► highpass ─┘ (+echo) │                                    ├─► limiter ─► out
//   sound effects ───────────────────────────────────────────────────────────────────────────────────┘
import { Song, genreMix, ELEM_GENRE, MODES } from './music.js';
import { GENRES } from './genres/index.js';
import { layerEvents } from './blend.js';
import { Mixer, DROP_HOLD } from './mixer.js';
import { Synth, ELEM_INST, mtof } from './synth.js';

// part levels into the desk (set by measurement: tools/rendertest.mjs)
export const PART_GAIN = { kit: 1, tops: 1.1, bass: 0.9, comp: 1.6, color: 0.95, lead: 0.75, rune: 0.8 };
// Per-genre corrections from the offline render (A-weighted level of each part played alone, 8 bars of 4/4),
// pulling every genre toward the same balance: tune on top, then bass and kit, chords under them, colour and
// hats at the back. Clamped to a few dB: sparse parts measure low without being quiet.
const CAL = {
  baroque: { bass: 0.71, comp: 1.4 }, jazz: { bass: 0.8, comp: 1.2, color: 0.8 }, latin: { bass: 0.8 }, celtic: { bass: 0.9, color: 0.8 },
  funk: { bass: 1.25, comp: 0.7, color: 1.25, lead: 1.5 }, metal: { bass: 1.25 }, synthwave: { bass: 1.2, color: 1.4 }, chiprock: { bass: 1.2, comp: 0.63, color: 1.6, lead: 1.2 },
};
const ORDER = { kit: 0, bass: 1, lead: 2, comp: 3, tops: 4, color: 5 };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export class Audio {
  constructor(opts) {
    this.opts = opts; this.ctx = null; this.last = {}; this.song = null; this.scene = null; this.mixer = new Mixer();
    this.rand = (opts && opts.rand) || Math.random; this.mix = genreMix({ arcane: 1 }); this.mixer.cue(this.mix);
    this.gridT = null; this.hs = 0; this.wasDrop = false; this.held = 0; this.holdBd = 0.42; this.hBeat = 0; this.hAcc = 0; this.late = 0; this.steps = 0; this.toasts = [];
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (!document.hidden) this.resync(); });
  }
  unlock() {
    if (this.ctx) { if (this.ctx.state !== 'running') { try { this.ctx.resume(); } catch (e) { /* not yet allowed */ } this.resync(); } return; }
    try { const C = window.AudioContext || window.webkitAudioContext; if (C) this.init(new C()); } catch (e) { this.ctx = null; }
  }
  // also used with an OfflineAudioContext (render test) and a fake context (node tests)
  init(c) {
    this.ctx = c; this.syn = new Synth(c, { rand: this.rand });
    const G = v => { const g = c.createGain(); g.gain.value = v; return g; };
    const F = (type, f, q) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q) b.Q.value = q; return b; };
    this.lim = c.createDynamicsCompressor(); this.lim.threshold.value = -3; this.lim.knee.value = 0; this.lim.ratio.value = 20; this.lim.attack.value = 0.003; this.lim.release.value = 0.1; this.lim.connect(c.destination);
    this.out = c.createDynamicsCompressor(); this.out.threshold.value = -16; this.out.ratio.value = 5; this.out.attack.value = 0.005; this.out.release.value = 0.2; this.out.connect(this.lim);
    this.mlp = F('lowpass', 18000, 0.7); this.mlp.connect(this.out);
    this.music = G(0.45); this.music.connect(this.mlp);
    this.fxg = G(0.42); this.fxg.connect(this.lim);
    this.pump = G(1); this.pump.connect(this.music);
    this.dry = G(1); this.dry.connect(this.music);
    this.bMain = G(1); this.bMain.connect(this.pump);
    this.inLP = F('lowpass', 18000, 0.8); this.inLP.connect(this.pump); this.bIn = G(1); this.bIn.connect(this.inLP);
    this.outHP = F('highpass', 40, 0.8); this.outHP.connect(this.pump); this.bOut = G(1); this.bOut.connect(this.outHP);
    // a short feedback echo gives the dry synths a little room
    const dl = c.createDelay(0.5), fb = G(0.28), lp = F('lowpass', 2200); dl.delayTime.value = 0.19;
    this.send = G(0.2); this.send.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(this.music);
    // the DJ echo: what leaves the mix is thrown into a longer delay
    const edl = c.createDelay(1), efb = G(0.5), elp = F('lowpass', 2500); edl.delayTime.value = 0.315;
    this.eSend = G(0); this.outHP.connect(this.eSend); this.eSend.connect(edl); edl.connect(elp); elp.connect(efb); efb.connect(edl); elp.connect(this.pump);
    // distortion bus for guitars (odd-length symmetric curve: silence stays silence)
    const ws = c.createWaveShaper(), curve = new Float32Array(1025); for (let i = 0; i < 1025; i++) curve[i] = Math.tanh((i / 512 - 1) * 6); ws.curve = curve;
    const dlp = F('lowpass', 2600), dg = G(0.06);
    this.dist = G(1); this.dist.connect(ws); ws.connect(dlp); dlp.connect(dg); dg.connect(this.pump);
    this.rDry = { out: this.dry, dist: this.dist };
    this.rMain = { out: this.bMain, send: this.send, dist: this.dist };
    this.rIn = { out: this.bIn, send: this.send, dist: this.dist };
    this.rOut = { out: this.bOut, dist: this.dist };
    if (!this.song) this.newSong();
  }

  // ---------- the game's side of the desk ----------
  // A fresh song for the current wheel. o.intro: two bars of rhythm section first (a stage start).
  newSong(seed, o = {}) {
    const s = seed != null ? seed >>> 0 : (this.rand() * 4294967296) >>> 0;
    this.song = new Song(s, this.mix, { prevKey: this.song ? this.song.keyPc : undefined });
    this.mixer.reset(this.song, { intro: !!o.intro }); this.scene = null; this.gridT = null; this.hs = 0; this.wasDrop = false;
    return this.song;
  }
  // elemWeights: { fire: 5, frost: 2, ... } from the runes on the wheel. o.first = element of slot 0 (it calls
  // the tune), o.now = cut on the next downbeat instead of mixing (menus).
  setMix(elemWeights, o = {}) { this.mix = genreMix(elemWeights); this.mixer.cue(this.mix, { first: ELEM_GENRE[o.first], now: o.now }); }
  info() { return this.song ? this.mixer.air.style.name + ' in ' + this.song.keyLabel : ''; }
  decks() { return this.mixer.decks(); }
  stats() { return { tier: this.scene ? this.scene.tier : 2, level: this.mixer.level, live: this.syn && this.ctx ? this.syn.live(this.ctx.currentTime) : 0, late: this.late, steps: this.steps, seed: this.song ? this.song.seed : 0 }; }
  takeToast() { return this.toasts.shift() || null; }
  resync() { this.gridT = null; if (this.ctx && this.mlp && !this.held) { const t = this.ctx.currentTime; this.mlp.frequency.setTargetAtTime(18000, t, 0.05); this.inLP.frequency.setTargetAtTime(18000, t, 0.05); this.outHP.frequency.setTargetAtTime(40, t, 0.05); } }

  // ---------- sequencing: one call per wheel step ----------
  // m = { beat, beats, unit, dur (seconds this step lasts), def (rune fired), slot, lvl, drop, boss, ready, sig }
  step(m, when) {
    const c = this.ctx; if (!c || !this.opts.music || !this.song) return;
    if (this.held) this.hold(false);
    // phase-locked beat clock: follow the game's steps, but smooth frame jitter out of the grid
    const now = c.currentTime, ideal = (when === undefined ? now : when) + 0.03;
    const t = this.gridT == null || Math.abs(ideal - this.gridT) > 0.06 ? ideal : Math.max(now + 0.005, this.gridT + 0.15 * (ideal - this.gridT));
    this.gridT = t + m.dur; this.steps++; if (t - now < 0.008) this.late++;
    // transport: in a DROP the band holds its tempo and every step is half a beat
    const hold = !!m.drop && DROP_HOLD; let beat = m.beat, half = -1, bd = m.dur, down;
    if (hold) { if (!this.wasDrop) this.hs = 0; beat = (this.hs >> 1) % m.beats; half = this.hs & 1; bd = m.dur * 2; down = beat === 0 && half === 0; this.hs++; }
    else { down = beat === 0 || !this.scene || this.scene.beats !== m.beats; this.holdBd = m.dur; }
    this.wasDrop = hold;
    if (down) this.newBar(m, t, bd);
    const sc = this.scene; if (!sc) return;
    if (beat >= sc.beats) beat %= sc.beats;
    this.playBeat(sc, beat, half, t, bd, 0);
    if (!hold && m.drop) { this.syn.drum(this.bMain, 'rock', 'hat', t + m.dur * 0.5, 0.6); if (sc.frame.accents.includes(beat)) this.syn.drum(this.dry, 'rock', 'clap', t, 0.7); }
    // the rune that just fired answers on a chord tone under the tune, in its element's voice
    const d = m.def;
    if (d && !this.solo) {
      const f = sc.frame, g = PART_GAIN.rune;
      if (d.fusion) this.syn.note(this.rDry, { n: f.voicing[0] + 12, ns: f.voicing.map(x => x + 12), d: half < 0 ? 0.9 : 0.45, v: 0.6 }, t, bd, g, 'brass');
      else if (d.type === 'mod') { const cl = f.clave.includes(beat * f.ppb); this.syn.drum(this.dry, 'hand', cl ? 'cow' : 'rim', t, 0.7); if (half < 0) this.syn.drum(this.dry, 'hand', m.slot % 2 ? 'tom1' : 'rim', t + m.dur * 0.5, 0.45); }
      else {
        let n = f.rune[beat] || f.voicing[m.slot % 3] + 12;
        if (half === 1) for (let k = 1; k <= 12; k++) if (f.chord.pcs.includes((((n + k - f.tonic) % 12) + 12) % 12)) { n += k; break; }   // the wheel arpeggiates upward through the drop
        this.syn.note(this.rDry, { n, d: Math.min(0.3, m.dur * 0.8) / bd, v: 0.45 + 0.05 * Math.min(5, m.lvl || 1) }, t, bd, g, ELEM_INST[d.elem] || 'vibes');
      }
    }
  }

  // A downbeat: ask the DJ for the scene, resolve its layers to events, move the desk.
  newBar(m, t, bd) {
    const song = this.song; song.setVariant(m.boss ? 'boss' : null);
    const sc = this.mixer.bar(m), T = sc.table, barSec = bd * m.beats;
    sc.beats = m.beats; sc.unit = m.unit; sc.frame = song.frame(sc.idx, m.beats, m.unit);
    sc.sw = m.unit === 4 ? sc.swing : 0.5; this.syn.swing = sc.sw;
    const L = [];
    for (const l of sc.layers) {
      let ev = layerEvents(song, T, l, sc.idx, m.beats, m.unit);
      if (l.oct) ev = ev.map(list => list.map(e => ({ o: e.o, d: e.d, v: e.v, p: e.p, s: e.s, n: e.n + l.oct })));
      const isIn = sc.entering && sc.entering.includes(l.g + ':' + l.part);
      L.push({ g: l.g, part: l.part, ev, inst: l.inst, maxP: Math.min(sc.maxP[l.part], l.onlyP == null ? 3 : l.onlyP), kit: GENRES[l.g].drumKit, dbl: !!l.dbl,
        gain: l.lvl * PART_GAIN[l.part] * ((CAL[l.g] && CAL[l.g][l.part]) || 1) * (isIn && sc.enterBar === 1 ? 0.6 : 1),
        route: l.part === 'kit' || l.part === 'bass' ? this.rDry : isIn ? this.rIn : this.rMain });
    }
    if (m.boss && !L.some(l => l.dbl)) { const ld = L.find(l => l.part === 'lead'); if (ld) L.push({ ...ld, ev: ld.ev.map(list => list.map(e => ({ o: e.o, d: e.d, v: e.v, p: e.p, s: e.s, n: e.n - 12 }))), inst: 'sawlead', gain: ld.gain * 0.4, dbl: true }); }
    for (const l of sc.leave) L.push({ g: l.g, part: l.part, ev: layerEvents(song, T, l, sc.idx, m.beats, m.unit), inst: l.inst, maxP: 1, kit: GENRES[l.g].drumKit, dbl: false, gain: l.lvl * PART_GAIN[l.part] * 0.8, route: this.rOut });
    L.sort((a, b) => ORDER[a.part] - ORDER[b.part] || a.dbl - b.dbl);
    sc.L = this.solo ? L.filter(l => l.part === this.solo) : L;   // solo: one part alone, for the level measurements
    // the desk: every move is a setTargetAtTime toward where it should be by the end of the bar
    const P = (p, v, tc, at) => p.setTargetAtTime(v, at === undefined ? t : at, tc);
    if (sc.entering) { if (sc.enterBar === 1) { P(this.inLP.frequency, 700, 0.004); P(this.inLP.frequency, 3200, barSec / 3, t + 0.02); } else P(this.inLP.frequency, 18000, barSec / 3); }
    else P(this.inLP.frequency, 18000, 0.02);
    if (sc.leave.length) { P(this.outHP.frequency, 2500, barSec / 3); P(this.eSend.gain, 0.6, barSec / 3); }
    else { P(this.outHP.frequency, 40, 0.05); P(this.eSend.gain, 0, 0.05); }
    if (!this.held) P(this.mlp.frequency, 18000, 0.3);
    if (sc.fx.crash) this.syn.drum(this.dry, GENRES[T.own.kit].drumKit, 'crash', t, 0.8);
    if (sc.fx.impact) this.syn.hitTone(this.fxg, t, 'sine', 90, 35, 0.5, 0.5);
    if (sc.toast) this.toasts.push(sc.toast);
    song.warm((sc.idx + 1) % 16, m.beats, m.unit, sc.layers);
    this.scene = sc;
  }

  // Schedule one beat (or one half of it in a DROP) of the scene. booth: 1 = backstage loop, 2 = bass and chords only.
  playBeat(sc, beat, half, t, bd, booth) {
    const syn = this.syn, sw = sc.sw, tier = sc.tier; let kick = false;
    let budget = clamp(Math.round(52 * (half < 0 ? bd : bd / 2)), 4, 24) - 1;      // one voice is kept for the rune answer
    for (const l of sc.L) {
      const list = l.ev[beat]; if (!list) continue;
      const part = l.part, rhythm = part === 'kit' || part === 'bass';
      if (part === 'bass' && sc.noBass && !booth) continue;
      if (booth && (part === 'lead' || part === 'color' || l.route === this.rOut || (booth === 2 && (part === 'kit' || part === 'tops')))) continue;
      const maxP = booth ? Math.min(1, l.maxP) : l.maxP;
      for (const e of list) {
        if (e.p > maxP && !(part === 'lead' && e.s)) continue;
        if (half === 0 ? e.o >= 0.5 : half === 1 && e.o < 0.5) continue;
        if (tier < 2 && !rhythm && e.o !== 0 && e.o !== 0.5) continue;
        if (tier === 0 && e.p > 0 && e.o !== 0) continue;
        const drum = typeof e.n === 'string';
        if (sc.roll && part === 'kit' && !booth && (e.n === 'kick' || e.n === 'snare' || e.n === 'clap') && !(beat === 0 && e.o === 0)) continue;
        const cost = e.ns ? e.ns.length : 1; if (e.p > 0 && budget < cost) continue; budget -= cost;
        const o = sw !== 0.5 ? (e.o < 0.5 ? e.o * sw * 2 : sw + (e.o - 0.5) * (1 - sw) * 2) : e.o, at = t + o * bd;
        if (drum) { syn.drum(part === 'kit' ? this.dry : l.route.out, l.kit, e.n, at, e.v * l.gain); if (part === 'kit' && e.n === 'kick' && e.o === 0) kick = true; }
        else syn.note(l.route, e, at, bd, l.gain, l.inst);
      }
    }
    if (booth) return;
    const kit = GENRES[sc.table.own.kit].drumKit, first = half < 1;
    if (sc.drop && half >= 0) {                                             // the drop: four on the floor, open hats between
      if (half === 0 && !kick) { syn.drum(this.dry, kit, 'kick', t, 0.9); kick = true; }
      if (half === 1) syn.drum(this.bMain, kit, 'ohat', t, 0.5 * PART_GAIN.tops);
    }
    if (kick && sc.pump > 0 && first) { this.pump.gain.setTargetAtTime(1 - sc.pump, t, 0.004); this.pump.gain.setTargetAtTime(1, t + 0.03, clamp(0.18 * bd, 0.03, 0.12)); }
    if (first && sc.roll && beat > 0) {                                     // build bar: the incoming drummer rolls in
      const k = beat / sc.beats, n = (k < 0.5 ? 2 : 4) >> (tier < 2 ? 1 : 0) || 1;
      for (let q = 0; q < n; q++) syn.drum(this.dry, kit, sc.roll, t + (q / n) * bd, 0.35 + 0.65 * (k + q / n / sc.beats));
    }
    if (first && sc.fx.swell) { const k = beat / Math.max(1, sc.beats - 1); syn.hitNoise(this.fxg, t, bd, 0.05 + 0.15 * k, 'bandpass', 400 * Math.pow(15, k), 0, 1.2); }
  }
  // a Grace Note slot takes no time: play an actual grace note, on the same clock, in the current harmony
  grace() {
    const c = this.ctx; if (!c || !this.opts.music || !this.song) return;
    const f = this.scene ? this.scene.frame : this.song.frame(0, 4, 4), top = f.voicing[f.voicing.length - 1] + 12, t = Math.max(c.currentTime + 0.01, (this.gridT || 0) - 0.06);
    this.syn.note(this.rDry, { n: top + 2, d: 0.05, v: 0.5 }, t, 1, 1, 'marimba'); this.syn.note(this.rDry, { n: top, d: 0.1, v: 0.6 }, t + 0.045, 1, 1, 'marimba');
  }

  // ---------- no dead air: while a menu is over the game the band keeps looping the bar, muffled ----------
  hold(on, kind) {
    on = !!on; const was = !!this.held; this.held = on ? kind || this.held || 'ov' : 0;
    if (!this.ctx || !this.mlp || on === was) return;
    const t = this.ctx.currentTime;
    this.mlp.frequency.setTargetAtTime(on ? 650 : 18000, t, on ? 0.08 : 0.3);
    this.music.gain.setTargetAtTime(on ? 0.32 : 0.45, t, 0.08);
    if (on) { this.hAcc = this.holdBd; this.hBeat = 0; } else this.gridT = null;
  }
  idle(dt) {
    const c = this.ctx; if (!c || !this.held || !this.opts.music || !this.scene || !(dt > 0) || dt > 0.1) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    this.hAcc -= dt; if (this.hAcc > 0) return;
    const sc = this.scene, bd = clamp(this.holdBd, 0.2, 0.6); this.hAcc += bd;
    this.playBeat(sc, this.hBeat++ % sc.beats, -1, c.currentTime + 0.03, bd, this.held === 'over' ? 2 : 1);
  }
  // stage clear: the home chord, the root and a crash, thrown into the echo
  outro() {
    const c = this.ctx; if (!c || !this.opts.music || !this.song || !this.scene) return;
    const t = c.currentTime + 0.03, T = this.song.tonic, sc = MODES[this.song.activeMode], own = this.mixer.air.own;
    this.syn.note(this.rMain, { n: T + 12, ns: [T + 12, T + 12 + sc[2], T + 19], d: 5, v: 0.7, x: { pad: 1 } }, t, 0.42, 1, 'strings');
    this.syn.note(this.rDry, { n: 36 + (T % 12), d: 4, v: 0.9 }, t, 0.42, 1, GENRES[own.bass].inst.bass);
    this.syn.drum(this.dry, GENRES[own.kit].drumKit, 'crash', t, 0.9);
  }

  // ---------- sound effects ----------
  tone(dest, type, f, dur, vol, o = {}) {
    const c = this.ctx, t = c.currentTime + (o.delay || 0), osc = c.createOscillator(), g = c.createGain();
    osc.type = type; osc.frequency.value = f; osc.frequency.setValueAtTime(f, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + dur);
    g.gain.value = 0.0001; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + (o.att || 0.005)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (o.lp) { const f2 = c.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = o.lp; osc.connect(f2); node = f2; }
    node.connect(g); g.connect(dest); osc.start(t); osc.stop(t + dur + 0.02);
  }
  noise(dest, dur, vol, o = {}) { this.syn.hitNoise(dest, this.ctx.currentTime + (o.delay || 0), dur, vol, o.type || 'highpass', o.f || 6000, o.to); }
  // pitch of a chord tone of the bar that is playing, k steps up the chord (so pickups sing in key)
  inKey(k, oct = 2) { const f = this.scene && this.scene.frame; if (!f) return 700 * Math.pow(2, k / 12); const v = f.voicing; return mtof(v[k % v.length] + 12 * (oct + Math.floor(k / v.length))); }
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
      case 'gem': this.gemN = now - (this.gemT || 0) < 0.4 ? Math.min(8, (this.gemN || 0) + 1) : 0; this.gemT = now; this.tone(f, 'sine', this.inKey(this.gemN, 1), 0.07, 0.08); break;   // gems climb the chord
      case 'coin': this.tone(f, 'square', this.inKey(0, 2), 0.05, 0.05); this.tone(f, 'square', this.inKey(2, 2), 0.09, 0.05, { delay: 0.05 }); break;
      case 'heal': this.tone(f, 'sine', this.inKey(0, 1), 0.12, 0.15); this.tone(f, 'sine', this.inKey(2, 1), 0.18, 0.15, { delay: 0.09 }); break;
      case 'chest': [0, 1, 2, 3].forEach(k => this.tone(f, 'triangle', this.inKey(k, 1), 0.2, 0.16, { delay: k * 0.07 })); break;
      case 'levelup': [0, 1, 2, 3, 4].forEach(k => this.tone(f, 'square', this.inKey(k, 0), 0.16, 0.09, { delay: k * 0.06 })); break;
      case 'fuse': [0, 1, 2, 3, 4, 5].forEach(k => this.tone(f, 'sawtooth', this.inKey(k, -1), 0.5, 0.1, { delay: k * 0.07, lp: 2400 })); this.noise(f, 0.9, 0.2, { type: 'bandpass', f: 400, to: 7000 }); break;
      case 'pick': this.tone(f, 'triangle', this.inKey(0, 1), 0.08, 0.16); this.tone(f, 'triangle', this.inKey(2, 1), 0.14, 0.16, { delay: 0.06 }); break;
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
      case 'bossDie': this.tone(f, 'sine', 200, 1.2, 0.5, { to: 30 }); this.noise(f, 1, 0.4, { type: 'lowpass', f: 4000, to: 100 }); [0, 1, 2, 3].forEach(k => this.tone(f, 'triangle', this.inKey(k, 0), 0.5, 0.15, { delay: 0.3 + k * 0.1 })); break;
      case 'drop': this.noise(f, 0.5, 0.35, { type: 'bandpass', f: 300, to: 6000 }); this.tone(f, 'sine', 180, 0.7, 0.7, { to: 28, delay: 0.05 }); this.tone(f, 'sawtooth', 880, 0.4, 0.12, { to: 110 }); break;
      case 'dropEnd': this.tone(f, 'sine', 500, 0.3, 0.12, { to: 120 }); break;
    }
  }
}

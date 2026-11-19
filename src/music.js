// HEXBEAT — the song. Pure data, no audio.
//
// A Song is composed once from a seed: key, mode, a 16-bar AABA chord plan with real cadences, one clave per
// meter and ONE tune (theme.js). After the constructor has picked the mode from the leading genre it never
// looks at the mix again: every genre is a deck that can play any stem of this same song, so any blend is in
// key and on the grid by construction.
//
//   song.frame(idx, beats, unit)                 the genre-free bar: chord, voicing, clave, theme, rune line
//   song.stem(idx, beats, unit, genreId, part)   one genre's kit | tops | bass | comp | color | lead for that bar
//
// Events: Ev = { o, d, v, n, ns?, p, i?, s?, orn?, on?, x? } per beat (see src/genres/_lib.js and the packs).
// Everything inside chord (root, tones, pcs, scale, sev) is in semitones relative to frame.tonic.

import { GENRES } from './genres/index.js';
import { composeTheme, themeBar, dialect, runeLine } from './theme.js';

export { GENRES };

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const hashStr = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const pickR = (R, arr) => arr[Math.floor(R() * arr.length)];

export const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10], harmonic: [0, 2, 3, 5, 7, 8, 11],
};
export const MODE_LABEL = { major: 'major', dorian: 'dorian', aeolian: 'minor', phrygian: 'phrygian', mixolydian: 'mixolydian', harmonic: 'harmonic minor' };
export const NOTE = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
// Progressions as scale degrees (0 = tonic). 'V' = the major dominant of a minor key (it raises the seventh).
export const PROGS = {
  aeolian: [[0, 5, 6, 0], [0, 6, 5, 'V'], [0, 3, 6, 2], [0, 3, 'V', 0], [5, 6, 0, 0], [0, 2, 6, 'V']],
  harmonic: [[0, 3, 'V', 0], [0, 3, 6, 2], [0, 5, 3, 'V'], [0, 'V', 5, 'V']],
  dorian: [[0, 3, 0, 3], [0, 6, 3, 0], [0, 2, 3, 0], [0, 3, 6, 0]],
  phrygian: [[0, 1, 0, 6], [0, 1, 2, 1], [0, 6, 1, 0]],
  major: [[0, 4, 5, 3], [0, 5, 1, 4], [0, 3, 4, 0], [1, 4, 0, 5], [0, 3, 0, 4], [0, 2, 3, 4]],
  mixolydian: [[0, 6, 3, 0], [0, 6, 0, 6], [0, 3, 6, 0], [0, 4, 6, 3]],
};
// The cadence plan's vocabulary, per mode: the chord that leads home, the chords that prepare it, and the
// off-tonic chords a bridge may start on. All diatonic.
const DOMINANT = { aeolian: 'V', harmonic: 'V', dorian: 6, phrygian: 1, major: 4, mixolydian: 6 };
const PREDOM = { aeolian: [3, 5], harmonic: [3, 5], dorian: [3, 1], phrygian: [3, 6], major: [3, 1], mixolydian: [3, 4] };
const OFFTONIC = { aeolian: [5, 2, 3, 6], harmonic: [5, 2, 3, 6], dorian: [3, 6, 2], phrygian: [1, 5, 2], major: [3, 5, 1], mixolydian: [6, 3, 4] };
// The boss plays your song in the parallel darker mode: same tonic, same degrees, no transposition.
const BOSS_MODE = { major: 'aeolian', mixolydian: 'dorian', dorian: 'aeolian', aeolian: 'phrygian', harmonic: 'harmonic', phrygian: 'phrygian' };
// Decorative lead notes of a pentatonic dialect stay on these scale degrees
const PENTA = { major: [0, 1, 2, 4, 5], mixolydian: [0, 1, 2, 4, 5], dorian: [0, 2, 3, 4, 6], aeolian: [0, 2, 3, 4, 6], phrygian: [0, 2, 3, 4, 6], harmonic: [0, 2, 3, 4, 6] };

// Each spell class has a genre. The runes on your wheel decide the band (see src/blend.js).
export const ELEM_GENRE = { arcane: 'baroque', fire: 'metal', frost: 'jazz', volt: 'funk', void: 'synthwave', nature: 'celtic', steel: 'chiprock', mod: 'latin' };
// { fire: 5, frost: 2 } -> [['metal', 5], ['jazz', 2]] sorted by weight
export function genreMix(elemWeights) {
  const w = {}; for (const e in elemWeights || {}) { const g = ELEM_GENRE[e]; if (g && elemWeights[e] > 0) w[g] = (w[g] || 0) + elemWeights[e]; }
  const out = Object.entries(w).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return out.length ? out : [['baroque', 1]];
}

// How each meter is felt: groups of beats. Group starts carry the accents.
export function grouping(beats, unit) {
  if (unit === 4) return { 1: [1], 2: [2], 3: [3], 4: [2, 2], 5: [3, 2] }[beats] || [beats];
  return { 1: [1], 2: [2], 3: [3], 4: [2, 2], 5: [3, 2], 6: [3, 3], 7: [2, 2, 3], 8: [2, 2, 2, 2] }[beats] || [beats];
}
// Backbone drum pattern per meter: K kick, S snare, s soft snare/rim, h nothing special
const KIT = {
  4: { 1: 'K', 2: 'KS', 3: 'Kss', 4: 'KSKS', 5: 'KhSKS' },
  8: { 1: 'K', 2: 'KS', 3: 'KhS', 4: 'KhSh', 5: 'KhhSh', 6: 'KhhShh', 7: 'KhShKhS', 8: 'KhShKhSh' },
};
// One clave per song and meter: a two-bar accent timeline in pulses (pulse = half a beat in /4, a beat in /8).
// The whole band syncopates on it. [bar 1 side, bar 2 side]; a bar plays side pos % 2.
const CLAVES = {
  '4:1': [[[0], [0, 1]]],
  '4:2': [[[0, 3], [0, 2]], [[0, 3], [1, 2]]],
  '4:3': [[[0, 2, 4], [0, 3]], [[0, 3, 4], [0, 2, 4]]],                       // the hemiola pair
  '4:4': [[[0, 3, 6], [2, 4]], [[0, 3, 6], [0, 3, 6]], [[0, 3, 5], [2, 6]]],  // son, tresillo, rumba
  '4:5': [[[0, 3, 6, 8], [0, 3, 6, 8]], [[0, 2, 4, 7], [0, 3, 6, 8]]],         // the Take Five vamp
  '8:1': [[[0], [0]]],
  '8:2': [[[0], [0, 1]]],
  '8:3': [[[0, 2], [0, 1]]],
  '8:4': [[[0, 3], [0, 2]]],
  '8:5': [[[0, 3], [0, 3]], [[0, 3], [0, 2, 3]]],
  '8:6': [[[0, 3], [0, 2, 4]], [[0, 2, 4, 5], [1, 3, 5]]],                     // jig against hemiola; bembe halves
  '8:7': [[[0, 2, 4], [0, 2, 4]], [[0, 2, 4], [0, 2, 4, 6]]],
  '8:8': [[[0, 3, 6], [2, 4]], [[0, 3, 6], [0, 3, 6]]],
};
const freeze = Object.freeze;
const deep = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { freeze(o); for (const k in o) deep(o[k]); } return o; };
// the tables above are shared by every Song and handed out inside frozen frames: freeze them once, here
for (const tbl of [MODES, MODE_LABEL, NOTE, PROGS, DOMINANT, PREDOM, OFFTONIC, BOSS_MODE, PENTA, ELEM_GENRE, KIT, CLAVES]) deep(tbl);

function mkChord(deg, mode) {
  let sc = MODES[mode], d = deg;
  if (deg === 'V') { d = 4; if (sc[6] !== 11) { sc = sc.slice(); sc[6] = 11; } }
  const at = k => sc[k % 7] + 12 * Math.floor(k / 7), tones = [at(d), at(d + 2), at(d + 4)];
  return deep({ deg, di: d, root: tones[0] % 12, tones, pcs: tones.map(x => x % 12), scale: sc, sev: at(d + 6) % 12 });
}

export class Song {
  // mix: [[genreId, weight], ...] strongest first. Only its leader matters, and only here: it picks the mode.
  // opts.prevKey (0..11): the new key is a fifth, a fourth or a tone above the previous stage's, or the same.
  constructor(seed, mix, opts = {}) {
    this.seed = seed >>> 0;
    const R = rng(this.seed);
    this.genreId = mix && mix.length && GENRES[mix[0][0]] ? mix[0][0] : 'baroque';
    this.mode = pickR(R, GENRES[this.genreId].modes);
    const kr = R();
    this.keyPc = opts.prevKey == null ? Math.floor(kr * 12) : (((opts.prevKey + [7, 5, 2, 0][Math.floor(kr * 4)]) % 12) + 12) % 12;
    this.tonic = 48 + ((this.keyPc + 6) % 12) - 6; if (this.tonic < 45) this.tonic += 12;      // tonic near C3: 45..56
    // ----- harmony: one chord per bar, 16 bars, AABA with a first and a second ending
    const m = this.mode, progs = PROGS[m], dom = DOMINANT[m];
    this.progA = progs[Math.floor(R() * progs.length)];
    const off = OFFTONIC[m].filter(d => d !== dom), o1 = pickR(R, off), o2 = pickR(R, off.filter(d => d !== o1).length ? off.filter(d => d !== o1) : off);
    const pre = PREDOM[m].filter(d => d !== o2), pd = pickR(R, pre.length ? pre : PREDOM[m]);
    const A = this.progA;
    this.plan = freeze([
      A[0], A[1], A[2], dom,        // A1: ends open, on the dominant
      A[0], A[1], dom, 0,           // A2: dominant, then home (the tune lands on the root)
      o1, o2, pd, dom,              // B: off the tonic, predominant, dominant
      A[0], A[1], dom, 0,           // A3 = A2
    ]);
    this.variant = null;
    this._chords = { '': this.plan.map(d => mkChord(d, m)), boss: this.plan.map(d => mkChord(d, BOSS_MODE[m])) };
    this._voic = {}; this._claves = new Map(); this._meters = new Map();
    this._frames = new Map(); this.cache = new Map(); this.writes = 0;
    // ----- the tune: ladder ranks over the lead register, which starts at the first scale note >= 67
    const sc = MODES[m]; let base = 0; while (this.tonic + 12 * Math.floor(base / 7) + sc[base % 7] < 67) base++;
    this.theme = composeTheme(rng((this.seed ^ 0x9E3779B9) >>> 0), { deg: this.plan.map(d => (d === 'V' ? 4 : d)), base });
  }
  get activeMode() { return this.variant === 'boss' ? BOSS_MODE[this.mode] : this.mode; }
  get keyLabel() { return NOTE[this.keyPc] + ' ' + MODE_LABEL[this.activeMode]; }
  // 'boss' re-harmonises the same song in the parallel darker mode; null goes back. The variant is part of
  // every cache key, so nothing is recomposed twice and nothing stale is ever returned.
  setVariant(v) { this.variant = v === 'boss' ? 'boss' : null; return this; }

  section(idx) { const s = Math.floor(idx / 4) % 4, pos = idx % 4; return { sec: s === 2 ? 'B' : 'A', pos, rep: s, deg: this.plan[idx] }; }
  chordAt(idx) { return this._chords[this.variant || ''][((idx % 16) + 16) % 16]; }
  meter(beats, unit) {
    const key = beats * 16 + unit; let m = this._meters.get(key);
    if (!m) {
      const groups = grouping(beats, unit), accents = []; let k = 0; for (const n of groups) { accents.push(k); k += n; }
      m = deep({ groups, accents, ppb: unit === 4 ? 2 : 1, lastAcc: accents[accents.length - 1], backbone: (KIT[unit] && KIT[unit][beats]) || 'K' + 'h'.repeat(Math.max(0, beats - 1)) });
      this._meters.set(key, m);
    }
    return m;
  }
  // [side A, side B] for a meter: chosen by the seed, never by a genre
  claveFor(beats, unit) {
    const key = beats * 16 + unit; let c = this._claves.get(key);
    if (!c) {
      const lib = CLAVES[unit + ':' + beats];
      if (lib) c = lib[hashStr(this.seed + ':clave:' + beats + ':' + unit) % lib.length];
      else { const N = beats * (unit === 4 ? 2 : 1), a = [], b = []; for (let p = 0; p < N; p += 3) a.push(p); for (let p = 2; p < N; p += 4) b.push(p); c = [a, b.length ? b : [0]]; }
      c = deep(c.map(s => s.slice())); this._claves.set(key, c);
    }
    return c;
  }
  // theme rank -> midi in bar idx, in the active variant's scale (so the boss changes pitches, never contour)
  pitchAt(idx, r) { const sc = this.chordAt(idx).scale, k = this.theme.base + r; return this.tonic + 12 * Math.floor(k / 7) + sc[((k % 7) + 7) % 7]; }
  // Comp voicings: the triad in close position between 55 and 67 (under the tune), each bar placed to move
  // as little as possible from the bar before; chained from bar 0 and memoised per variant.
  voicingAt(idx) {
    const v = this.variant || ''; let all = this._voic[v];
    if (!all) {
      all = []; let prev = null;
      for (let i = 0; i < 16; i++) {
        const pcs = this._chords[v][i].tones.map(t => (this.tonic + t) % 12); let best = null, bc = 1e9;
        for (let inv = 0; inv < 3; inv++) {
          const a = 55 + ((pcs[inv] - 7 + 24) % 12), b = a + ((pcs[(inv + 1) % 3] - pcs[inv] + 12) % 12), c = b + ((pcs[(inv + 2) % 3] - pcs[(inv + 1) % 3] + 12) % 12);
          // a top note above 67 would crowd the tune: only as a last resort (the lowest inversion never needs it)
          const cost = Math.max(0, c - 67) * 4 + (prev ? Math.abs(a - prev[0]) + Math.abs(b - prev[1]) + Math.abs(c - prev[2]) : 0) + 0.15 * Math.abs(b - 61);
          if (cost < bc) { bc = cost; best = [a, b, c]; }
        }
        all.push(freeze(best)); prev = best;
      }
      this._voic[v] = all;
    }
    return all[((idx % 16) + 16) % 16];
  }

  // The genre-free bar. Cached per (idx, beats, unit, variant); frozen.
  frame(idx, beats, unit) {
    idx = ((idx % 16) + 16) % 16;
    const key = idx + ':' + beats + ':' + unit + ':' + (this.variant || '');
    let f = this._frames.get(key); if (f) return f;
    const S = this.section(idx), M = this.meter(beats, unit), chord = this.chordAt(idx), next = this.chordAt(idx + 1);
    const cl = this.claveFor(beats, unit), th = this.theme, theme = themeBar(this, idx, beats, unit);
    const holes = []; let t = 0;
    for (const n of theme) { const st = n.beat + n.o; if (st - t >= 1 - 1e-9) holes.push({ beat: Math.floor(t + 1e-9), o: t - Math.floor(t + 1e-9), d: st - t }); t = Math.max(t, st + n.d); }
    if (beats - t >= 1 - 1e-9) holes.push({ beat: Math.floor(t + 1e-9), o: t - Math.floor(t + 1e-9), d: beats - t });
    f = {
      idx, sec: S.sec, pos: S.pos, rep: S.rep, beats, unit, ppb: M.ppb, groups: M.groups, accents: M.accents, lastAcc: M.lastAcc, backbone: M.backbone,
      tonic: this.tonic, chord, next, voicing: this.voicingAt(idx),
      bassRoot: 36 + ((this.tonic + chord.root) % 12), nextBassRoot: 36 + ((this.tonic + next.root) % 12),
      clave: cl[S.pos % 2], claves: cl, theme, holes, rune: null,
      // extras the dialects use: the song's dice, the lead register in this bar's scale, the pentatonic subset
      seed: this.seed, variant: this.variant, lo: this.pitchAt(idx, 0), cap: this.pitchAt(idx, th.bars[idx].cap), peak: this.pitchAt(10, th.peak), penta: PENTA[this.activeMode],
    };
    f.rune = runeLine(theme, f);
    deep(f);
    this._frames.set(key, f);
    if (this._frames.size > 600) { let n = 100; for (const k of this._frames.keys()) { if (n-- <= 0) break; this._frames.delete(k); } }
    return f;
  }

  // One genre's stem for one bar: Ev[][] with `beats` lists. part: kit | tops | bass | comp | color | lead.
  // The lead is never written by a pack: it is the theme performed in the pack's dialect.
  // LRU of 1500 stems (the oldest 200 go when it is full; it is never cleared wholesale). The mix, the energy
  // and the tempo are not part of the key: a stem is the same whoever else is playing.
  stem(idx, beats, unit, genreId, part) {
    idx = ((idx % 16) + 16) % 16;
    const key = idx + ':' + beats + ':' + unit + ':' + (this.variant || '') + ':' + genreId + ':' + part, C = this.cache;
    let ev = C.get(key);
    if (ev) { C.delete(key); C.set(key, ev); return ev; }
    const pack = GENRES[genreId]; if (!pack) throw new Error('unknown genre ' + genreId);
    ev = this.render(idx, beats, unit, pack, part);
    C.set(key, ev); this.writes++;
    if (C.size > 1500) { let n = 200; for (const k of C.keys()) { if (n-- <= 0) break; C.delete(k); } }
    return ev;
  }
  // The uncached write behind stem(): takes a pack object, so tools can audition a draft that is not in GENRES.
  // The engine fills the patch (`i`) from pack.inst where the pack left it out, and freezes the result.
  render(idx, beats, unit, pack, part) {
    const f = this.frame(idx, beats, unit); let ev, inst;
    if (part === 'lead') { ev = dialect(f.theme, pack.dialect, f); inst = pack.inst.lead[0]; }
    else { if (typeof pack[part] !== 'function') throw new Error('unknown part ' + part); ev = pack[part](this.context(f, pack.id, part)); inst = pack.inst[part]; }
    for (const list of ev) { for (const e of list) { if (typeof e.n === 'number' && !e.i && inst) e.i = inst; deep(e); } freeze(list); }
    return freeze(ev);
  }
  // What a pack generator sees: the frame without the theme, plus the theme as read-only `lead`, the accent
  // and clave tests, and three seeded dice:
  //   riff(tag)    seed:genre:part:beats:unit:tag — the same every bar; use it for anything that must repeat
  //   groove(tag)  seed:genre:beats:unit:tag      — also the same for every PART of the genre (kick follows bass)
  //   bar(tag)     riff plus the bar index        — per-bar variation, use sparingly
  context(f, genreId, part) {
    const tag = this.seed + ':' + genreId + ':', mt = ':' + f.beats + ':' + f.unit + ':', { accents, clave, ppb } = f;
    const c = {};
    for (const k in f) if (k !== 'theme' && k !== 'holes' && k !== 'rune') c[k] = f[k];
    c.lead = f.theme; c.fill = f.pos === 3;
    c.isAcc = i => accents.includes(i);
    c.isClave = (beat, o = 0) => clave.includes((beat + o) * ppb);
    c.riff = t => rng(hashStr(tag + part + mt + t));
    c.groove = t => rng(hashStr(tag + mt + t));
    c.bar = t => rng(hashStr(tag + part + mt + t + ':' + f.idx));
    return freeze(c);
  }
  // Pre-write stems so a downbeat never has to: layers = [{ g, part }] (a Scene's layers) or [[g, part]].
  warm(idx, beats, unit, layers) { for (const l of layers || []) { const g = l.g || l[0], part = l.part || l[1]; if (GENRES[g]) this.stem(idx, beats, unit, g, part); } }
}

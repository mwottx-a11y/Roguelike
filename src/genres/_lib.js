// HEXBEAT — helpers shared by the genre packs. Pure: no state, no randomness of its own.
//
// A pack generator gets one frozen context `c` (see Song.stem in music.js) and returns Ev[][]: one list of
// events per beat. Everything harmonic in `c.chord` is relative to `c.tonic` (root, tones, pcs, scale and sev
// are semitone offsets from the tonic), so the helpers below do the midi arithmetic.

export const stem = n => Array.from({ length: n }, () => []);
export const KIT_VOICES = ['kick', 'snare', 'clap', 'rim', 'tom1', 'tom2', 'tom3', 'timp'];
export const TOPS_VOICES = ['hat', 'ohat', 'pedal', 'ride', 'crash', 'shaker', 'tamb', 'cow', 'brush'];

// k onsets spread as evenly as they will go over n steps (tresillo = euclid(3, 8)), optionally rotated
export function euclid(k, n, rot = 0) { const out = []; for (let i = 0; i < n; i++) out.push((((i + rot) % n) * k) % n < k); return out; }

// ----- pitch
export const rel = (c, n) => (((n - c.tonic) % 12) + 12) % 12;          // pitch class relative to the tonic
export const inScale = (c, n) => c.chord.scale.includes(rel(c, n));
export const isTone = (c, n) => c.chord.pcs.includes(rel(c, n));         // triad tone of this bar's chord
export const fit = (n, lo, hi) => { while (n < lo) n += 12; while (n > hi) n -= 12; return n; };
// n moved k steps along this bar's scale (a note off the scale is first pulled down onto it)
export function walk(c, n, k) {
  const sc = c.chord.scale; let pc = rel(c, n), i = sc.indexOf(pc);
  while (i < 0) { n--; pc = rel(c, n); i = sc.indexOf(pc); }
  const j = i + k;
  return n - pc + sc[((j % 7) + 7) % 7] + 12 * Math.floor(j / 7);
}
// signed number of scale steps from a to b (both pulled onto the scale)
export function steps(c, a, b) {
  const sc = c.chord.scale, ix = n => { let pc = rel(c, n), i = sc.indexOf(pc); while (i < 0) { n--; pc = rel(c, n); i = sc.indexOf(pc); } return 7 * Math.floor((n - c.tonic) / 12) + i; };
  return ix(b) - ix(a);
}
// chord intervals above the root, in semitones. A fifth is not always perfect (ii° in minor, III+ and vii° in
// harmonic minor, the boss V in phrygian), so anything that wants a stable fifth asks `p5` first.
export const third = c => c.chord.tones[1] - c.chord.tones[0];
export const fifth = c => c.chord.tones[2] - c.chord.tones[0];
export const p5 = c => fifth(c) === 7;
export const seventh = c => (c.chord.sev - c.chord.root + 12) % 12;
// the diatonic ninth, only when it is a major ninth (a minor ninth over the root is a rub, not a colour)
export function ninth(c) { const sc = c.chord.scale, i = sc.indexOf(c.chord.root); return i >= 0 && (sc[(i + 1) % 7] - c.chord.root + 12) % 12 === 2 ? 2 : 0; }
// triad tones between lo and hi, ascending
export function tones(c, lo, hi) { const out = []; for (let n = lo; n <= hi; n++) if (isTone(c, n)) out.push(n); return out; }
export function nearTone(c, n, lo = 0, hi = 127) { for (let k = 0; k < 12; k++) { if (n - k >= lo && isTone(c, n - k)) return n - k; if (n + k <= hi && isTone(c, n + k)) return n + k; } return n; }
// the chord root in a register: rootIn(c, 48) is the root between 48 and 59
export const rootIn = (c, lo) => fit(c.bassRoot, lo, lo + 11);
// power chord for the dist bus, 40..64: root, fifth (only when perfect) and octave
export function power(c) { const r = fit(c.bassRoot, 40, 51); return p5(c) ? [r, r + 7, r + 12] : [r, r + 12]; }
// the next bar's bass root in the octave nearest to `from`, kept inside the bass register
export function nextRoot(c, from) { let n = c.nextBassRoot; if (Math.abs(n + 12 - from) < Math.abs(n - from) && n + 12 <= 59) n += 12; return n; }
// a note leading into the next root: its scale neighbour on the side we come from when that is a tone or a
// semitone away, otherwise the chromatic semitone (the one out-of-scale note a bass may play, d <= 0.5)
export function approach(c, from) {
  const t = nextRoot(c, from), s = from >= t ? 1 : -1;
  for (const n of [t + s, t + 2 * s, t - s, t - 2 * s]) if (n >= 36 && n <= 59 && inScale(c, n)) return { n, chromatic: false };
  return { n: t + s >= 36 && t + s <= 59 ? t + s : t - s, chromatic: true };
}

// ----- time
export const pulses = c => c.beats * c.ppb;                              // pulses in the bar
export const at = (c, p) => [Math.floor(p / c.ppb), (p % c.ppb) / c.ppb]; // pulse index -> [beat, o]
export const pulseOf = (c, beat, o) => (beat + o) * c.ppb;                // integer when (beat, o) is on a pulse
// beats that carry the backbeat ('S' in the meter's backbone) and the softer 's'
export const backbeats = c => { const out = []; for (let i = 0; i < c.beats; i++) if (c.backbone[i] === 'S') out.push(i); return out; };
// where a backbeat kit puts its snare: the backbone's 'S' beats; a bar of three (no 'S', an oom-pah-pah
// backbone) takes one snare on its last beat instead
export const snares = c => { const s = backbeats(c); return s.length || c.beats < 3 ? s : [c.beats - 1]; };

// ----- the tune, for parts that must stay out of its way
// "A beat or longer" is counted in pulses (two or more), so 6/8, where the beat is an eighth at double tempo,
// is treated exactly like 4/4.
export const isLong = (c, l) => l.d * c.ppb >= 2 - 1e-9;
const rub = (a, b) => { const x = (((a - b) % 12) + 12) % 12; return x === 1 || x === 11; };
// Chord tones that are safe under the tune between t0 and t1 (beats from the bar start).
//  - triad tones are dropped only against a long lead note that overlaps the event;
//  - colour tones (seventh, ninth) are dropped for the whole bar when the tune touches a chord tone a semitone
//    away (root under a major seventh, minor third under a ninth), because a dialect may hold that note longer.
export function clear(c, ns, t0 = 0, t1 = c.beats) {
  return ns.filter(m => {
    const core = isTone(c, m);
    for (const l of c.lead) {
      if (!rub(m, l.n)) continue;
      const st = l.beat + l.o;
      if (core ? isLong(c, l) && st < t1 && st + l.d > t0 : isLong(c, l) || l.s || isTone(c, l.n)) return false;
    }
    return true;
  });
}
// one comp event from a list of tones: a chord when two or more survive, a single note when one does
export function chord(o, ns, d, v, p, x) {
  if (!ns.length) return null;
  const e = { o, n: ns[0], d, v, p }; if (ns.length > 1) e.ns = ns.slice(0, 4); if (x) e.x = x; return e;
}
export const put = (ev, beat, e) => { if (e && beat >= 0 && beat < ev.length) ev[beat].push(e); };

// ----- finishing: every generator returns fin(c, ev, max)
// Sorts each beat by offset, keeps notes inside the bar, drops off-grid offsets in /8 meters and enforces the
// per-beat ceiling by dropping the least important events first (highest p, then quietest; never a p0).
export function fin(c, ev, max = 4) {
  const cap = c.unit === 8 ? Math.min(max, max === 4 ? 2 : max) : max;
  for (let i = 0; i < ev.length; i++) {
    let L = ev[i].filter(e => e && (c.unit === 4 || e.o === 0 || e.o === 0.5));
    for (const e of L) if (typeof e.n === 'number') e.d = Math.min(e.d, c.beats - i - e.o);
    L = L.filter(e => typeof e.n !== 'number' || e.d > 0);
    while (L.length > cap) {
      let w = -1;
      for (let k = 0; k < L.length; k++) if (L[k].p > 0 && (w < 0 || L[k].p > L[w].p || (L[k].p === L[w].p && L[k].v < L[w].v))) w = k;
      if (w < 0) break; L.splice(w, 1);
    }
    L.sort((a, b) => a.o - b.o);
    ev[i] = L;
  }
  return ev;
}
// monophonic lines: trim each note so it ends by the next onset (bass, single-voice comp)
export function mono(c, ev) {
  let prev = null, pt = 0;
  for (let i = 0; i < ev.length; i++) for (const e of ev[i].slice().sort((a, b) => a.o - b.o)) {
    const t = i + e.o; if (prev && pt + prev.d > t) prev.d = Math.max(0.05, t - pt - 0.02); prev = e; pt = t;
  }
  return ev;
}

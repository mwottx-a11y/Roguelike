// Funk (volt): everything hangs on "the one". A slap riff is built once per song (long root on one, nothing on
// beat two, octave pops on the clave, the seventh falling back to the root at the end), the kick plays the
// riff's low notes, the hats run in sixteenths and open just before each snare.
import { stem, fin, mono, at, fit, walk, ninth, euclid, snares, clear, chord, put } from './_lib.js';
// The riff on a sixteenth grid (eighths in /8), shared by bass and kick:
// R long root, r accent root, P octave pop, g ghost, 7 the scale seventh under the root, o the octave.
function riff(c) {
  const R = c.groove('riff'), spb = c.unit === 4 ? 4 : 2, n = c.beats * spb, st = new Array(n).fill(null);
  st[0] = 'R';
  for (const a of c.accents) if (a >= 2) st[a * spb] = 'r';
  for (const p of c.claves[0]) { const s = p * spb / c.ppb; if (s >= 2 * spb && s < n && !st[s]) st[s] = 'P'; }   // beat two stays empty
  for (let s = 2 * spb + 1; s < n; s++) if (st[s] === 'P' && !st[s - 1] && R() < 0.6) st[s - 1] = 'g';
  if (c.beats >= 3) { st[n - 2] = '7'; st[n - 1] = 'o'; }
  return st;
}
export default {
  id: 'funk', name: 'Funk', elem: 'volt',
  modes: ['dorian', 'mixolydian'],
  hook: { kit: 1.6, tops: 1.6, bass: 2.2, comp: 1.8, lead: 1.3 },
  swing: 0.5, pump: 0.15, drumKit: 'tight', fillVoice: 'tom1',
  inst: { lead: ['brass', 'clav'], bass: 'slap', comp: 'epiano', color: 'clav' },
  dialect: { fill: 0, thin: 0.3, push: 0.4, art: 0.45, penta: true, orn: [] },
  spice: 'clav stabs',
  kit(c) {                                       // kick with the riff, backbeat snare, ghost strokes between
    const ev = stem(c.beats), st = riff(c), spb = c.unit === 4 ? 4 : 2, R = c.riff('ghost'), last = c.beats - 1, sn = snares(c);
    for (let s = 0; s < st.length; s++) {
      const b = Math.floor(s / spb), o = (s % spb) / spb;
      if (st[s] === 'R') ev[b].push({ o, n: 'kick', d: 0, v: 1, p: 0 });
      else if (st[s] === 'r' && !sn.includes(b)) ev[b].push({ o, n: 'kick', d: 0, v: 0.9, p: 1 });
      else if (st[s] === 'P' && !(o === 0 && sn.includes(b))) ev[b].push({ o, n: 'kick', d: 0, v: 0.8, p: 2 });   // the kick pushes with every pop
    }
    for (let i = 0; i < c.beats; i++) {
      const roll = c.fill && c.beats > 1 && i === last && i >= c.lastAcc;
      if (sn.includes(i)) ev[i].push({ o: 0, n: 'snare', d: 0, v: 1, p: 0 });
      if (roll) { ev[i].push({ o: 0.5, n: 'tom1', d: 0, v: 0.7, p: 2 }); if (c.unit === 4) ev[i].push({ o: 0.75, n: 'tom2', d: 0, v: 0.8, p: 2 }); continue; }
      const u = R(), w = R();
      if (c.unit === 4) { if (u < 0.5 && !st[i * 4 + 1]) ev[i].push({ o: 0.25, n: 'snare', d: 0, v: 0.25, p: 3 }); if (w < 0.6 && !st[i * 4 + 3] && !sn.includes(i + 1)) ev[i].push({ o: 0.75, n: 'snare', d: 0, v: 0.25, p: 3 }); }
      else if (u < 0.6 && !st[i * 2 + 1]) ev[i].push({ o: 0.5, n: 'snare', d: 0, v: 0.25, p: 3 });
    }
    return fin(c, ev);
  },
  tops(c) {                                      // sixteenth hats; the hat opens on the pulse before a snare
    const ev = stem(c.beats), sn = snares(c);
    for (let i = 0; i < c.beats; i++) {
      const open = sn.includes(i + 1);
      if (c.unit === 4) {
        ev[i].push({ o: 0, n: 'hat', d: 0, v: 0.7, p: 1 }, { o: 0.25, n: 'hat', d: 0, v: 0.45, p: 3 }, { o: 0.5, n: open ? 'ohat' : 'hat', d: 0, v: open ? 0.65 : 0.55, p: 2 });
        if (!open) ev[i].push({ o: 0.75, n: 'hat', d: 0, v: 0.45, p: 3 });
      } else ev[i].push({ o: 0, n: open ? 'ohat' : 'hat', d: 0, v: 0.7, p: 1 }, { o: 0.5, n: 'hat', d: 0, v: 0.5, p: 2 });
    }
    return fin(c, ev);
  },
  bass(c) {                                      // the slap riff, transposed to the bar's root
    const ev = stem(c.beats), st = riff(c), spb = c.unit === 4 ? 4 : 2, r = c.bassRoot, u = 4 / spb;
    for (let s = 0; s < st.length; s++) {
      const b = Math.floor(s / spb), o = (s % spb) / spb, k = st[s]; if (!k) continue;
      const pr = o === 0 ? 1 : o === 0.5 ? 2 : 3;
      if (k === 'R') ev[b].push({ o, n: r, d: 0.7 * u, v: 1, p: 0 });
      else if (k === 'r') ev[b].push({ o, n: r, d: 0.3 * u, v: 0.9, p: 0 });
      else if (k === 'P') ev[b].push({ o, n: r + 12, d: 0.15 * u, v: 0.85, p: pr });
      else if (k === 'g') ev[b].push({ o, n: r, d: 0.08 * u, v: 0.35, p: 3 });
      else if (k === '7') ev[b].push({ o, n: walk(c, r + 12, -1), d: 0.2 * u, v: 0.7, p: pr });
      else ev[b].push({ o, n: r + 12, d: 0.2 * u, v: 0.8, p: pr });
    }
    return fin(c, mono(c, ev));
  },
  comp(c) {                                      // short stabs on the clave: seventh at the bottom, third, ninth on top
    const ev = stem(c.beats), s7 = fit(c.tonic + c.chord.sev, 50, 61);
    const up = (from, pc) => from + 1 + ((((c.tonic + pc - from - 1) % 12) + 12) % 12);
    const t3 = up(s7, c.chord.tones[1]), top = up(t3, ninth(c) ? c.chord.root + 2 : c.chord.tones[2]);
    let ns = clear(c, [s7, t3, top]); if (ns.length < 2) ns = clear(c, [t3, up(t3, c.chord.tones[2])]);   // the tune holds the root: third and fifth
    const hits = c.clave.includes(0) ? c.clave : [0, ...c.clave];
    for (const p of hits) { const [b, o] = at(c, p); put(ev, b, chord(o, ns, c.unit === 4 ? 0.15 : 0.3, p === 0 ? 0.9 : 0.8, o === 0 ? 1 : 2)); }
    return fin(c, ev);
  },
  color(c) {                                     // clav scratch: muted upper dyad on a sixteenth mask, one per song
    const ev = stem(c.beats), spb = c.unit === 4 ? 4 : 2, n = c.beats * spb, R = c.riff('scratch');
    const k = Math.max(1, Math.min(n, Math.round(n * [5, 7, 9, 11][Math.floor(R() * 4)] / 16))), mask = euclid(k, n, Math.floor(R() * n)), ns = clear(c, [c.voicing[1], c.voicing[2]]);
    for (let s = 0; s < n; s++) if (mask[s]) { const o = (s % spb) / spb, on = o === 0 || (c.unit === 4 && o === 0.5); put(ev, Math.floor(s / spb), chord(o, ns, c.unit === 4 ? 0.06 : 0.12, on ? 0.35 : 0.25, on ? 2 : 3)); }
    return fin(c, ev);
  },
};

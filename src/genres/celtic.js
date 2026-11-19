// Celtic (nature): a bodhran instead of a kit (low strokes on the accents, tip strokes between), a tambourine,
// a bass that only plays roots and fifths, an open-voiced guitar strum and a fiddle drone.
import { stem, fin, fifth, p5, rootIn, walk, nextRoot, clear, chord, put } from './_lib.js';
export default {
  id: 'celtic', name: 'Celtic', elem: 'nature',
  modes: ['dorian', 'mixolydian'],
  hook: { kit: 1.2, tops: 0.8, bass: 0.8, comp: 1.2, lead: 2.2 },
  swing: 0.5, pump: 0, drumKit: 'folk', fillVoice: 'tom2',
  inst: { lead: ['flute', 'fiddle'], bass: 'finger', comp: 'nylon', color: 'fiddle' },
  dialect: { fill: 1.0, thin: 0, push: 0, art: 0.85, penta: true, orn: ['cut'] },
  spice: 'fiddle drone',
  kit(c) {                                       // bodhran: tom3 on the accents, tom2 everywhere else
    const ev = stem(c.beats), R = c.riff('bodhran'), last = c.beats - 1;
    for (let i = 0; i < c.beats; i++) {
      const acc = c.isAcc(i), tip = R(), roll = c.fill && c.beats > 1 && i === last && i >= c.lastAcc;
      ev[i].push({ o: 0, n: acc ? 'tom3' : 'tom2', d: 0, v: i === 0 ? 1 : acc ? 0.85 : 0.5, p: i === 0 ? 0 : 1 });
      if (roll) { ev[i].push({ o: 0.5, n: 'tom2', d: 0, v: 0.6, p: 2 }); if (c.unit === 4) ev[i].push({ o: 0.75, n: 'tom3', d: 0, v: 0.8, p: 2 }); }
      else if (c.unit === 4) { ev[i].push({ o: 0.5, n: 'tom2', d: 0, v: 0.45, p: 2 }); if (tip < 0.4) ev[i].push({ o: 0.75, n: 'tom2', d: 0, v: 0.35, p: 3 }); }
      else if (tip < 0.5) ev[i].push({ o: 0.5, n: 'tom2', d: 0, v: 0.35, p: 3 });
    }
    return fin(c, ev);
  },
  tops(c) {                                      // tambourine: backbeats, with the jingle carrying over the off-beat
    const ev = stem(c.beats);
    for (let i = 0; i < c.beats; i++) {
      const k = c.backbone[i], back = k === 'S' || k === 's';
      if (back) { ev[i].push({ o: 0, n: 'tamb', d: 0, v: 0.6, p: 1 }); if (c.unit === 4) ev[i].push({ o: 0.5, n: 'tamb', d: 0, v: 0.3, p: 2 }); }
      else if (c.isAcc(i)) ev[i].push({ o: 0, n: 'shaker', d: 0, v: 0.3, p: 1 });
    }
    return fin(c, ev);
  },
  bass(c) {                                      // root on the first group, fifth on the next, and so on
    const ev = stem(c.beats), r = c.bassRoot, f = r + fifth(c), pick = c.riff('pickup')() < 0.5;
    c.accents.forEach((a, k) => {
      const g = c.groups[k], n = k % 2 ? f : r;
      ev[a].push({ o: 0, n, d: (c.unit === 4 && g >= 3 ? 2 : g) * 0.9, v: k ? 0.9 : 1, p: 0 });
      if (c.unit === 4 && g >= 3) ev[a + 2].push({ o: 0, n: k % 2 ? r : f, d: 0.9, v: 0.7, p: 1 });      // the third beat of a waltz group answers
    });
    // some songs lift into the next bar with one scale step, on the last off-beat
    if (pick && c.unit === 4 && c.beats >= 2) { const t = nextRoot(c, r), last = ev[c.beats - 1]; for (const e of last) e.d = Math.min(e.d, 0.45); last.push({ o: 0.5, n: walk(c, t, t > r ? -1 : 1), d: 0.4, v: 0.6, p: 2 }); }
    for (let i = 0; i < c.beats; i++) for (const e of ev[i]) { const nx = c.accents.find(a => a > i); if (nx != null) e.d = Math.min(e.d, nx - i - e.o - 0.05); }
    if (pick && c.unit === 4 && c.beats >= 2) for (let i = 0; i < c.beats - 1; i++) for (const e of ev[i]) e.d = Math.min(e.d, c.beats - 0.55 - i - e.o);
    return fin(c, ev);
  },
  comp(c) {                                      // open strum (root, fifth, octave) per group, up-strokes between
    const ev = stem(c.beats), r = rootIn(c, 48), open = p5(c) ? [r, r + 7, r + 12] : [r, r + 12], R = c.riff('strum');
    c.accents.forEach((a, k) => {
      const g = c.groups[k];
      put(ev, a, chord(0, clear(c, open, a, a + Math.min(g, 1.5)), Math.min(g, 1.5) * 0.9, k ? 0.6 : 0.7, 1));
      for (let j = 0; j < g; j++) { const u = R(); if (c.unit === 4 ? u < 0.6 : j > 0 && u < 0.5) put(ev, a + j, chord(c.unit === 4 ? 0.5 : 0, clear(c, open.slice(1), a + j, a + j + 1), 0.25, 0.4, 2)); }
    });
    return fin(c, ev);
  },
  color(c) {                                     // fiddle drone: the chord's root and fifth, re-bowed on each group
    const ev = stem(c.beats), r = rootIn(c, 55), dr = p5(c) ? [r, r + 7] : [r, r + 12];
    c.accents.forEach((a, k) => put(ev, a, chord(0, clear(c, dr, a, a + c.groups[k]), c.groups[k] * 0.98, 0.4, 2, { pad: 1 })));
    return fin(c, ev);
  },
};

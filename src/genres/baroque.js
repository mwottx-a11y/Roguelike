// Baroque (arcane): no drum kit at all. A timpani marks the bar and rolls into each new phrase, a tambourine
// keeps the dance, the organ continuo walks under one harpsichord figuration that never changes shape.
import { stem, fin, at, walk, steps, nextRoot, clear, chord, put } from './_lib.js';
const FIGS = [[0, 1, 2, 1], [0, 2, 1, 2], [0, 1, 2, 3], [2, 1, 0, 1], [0, 2, 3, 2], [3, 2, 1, 2]];   // indexes into low, mid, high, low+8ve
const WALKS = [[0, 1, 2, 1], [0, 2, 1, 2], [0, 1, 2, 3], [0, 2, 4, 2]];                              // scale steps above the root
export default {
  id: 'baroque', name: 'Baroque', elem: 'arcane',
  modes: ['harmonic'],
  hook: { kit: 0.7, tops: 0.7, bass: 1.5, comp: 2.0, lead: 2.0 },
  swing: 0.5, pump: 0, drumKit: 'court', fillVoice: 'timp',
  inst: { lead: ['flute', 'harpsi'], bass: 'organbass', comp: 'harpsi', color: 'organ' },
  dialect: { fill: 0.9, thin: 0, push: 0, art: 0.9, penta: false, orn: ['trill', 'mordent'] },
  spice: 'organ pad',
  kit(c) {                                       // timpani on the bar head, a crescendo roll into the next phrase
    const ev = stem(c.beats), last = c.beats - 1;
    ev[0].push({ o: 0, n: 'timp', d: 0, v: c.pos === 0 ? 0.9 : 0.5, p: 0 });
    if (c.fill && c.beats > 1) {
      const roll = [];
      for (const o of c.unit === 4 ? [0, 0.25, 0.5, 0.75] : [0, 0.5]) if (last >= c.lastAcc) roll.push([last, o]);
      roll.forEach(([i, o], j) => ev[i].push({ o, n: 'timp', d: 0, v: 0.45 + 0.45 * (j + 1) / roll.length, p: 2 }));
    }
    return fin(c, ev);
  },
  tops(c) {                                      // tambourine on the backbeats, a whisper of it on the accents
    const ev = stem(c.beats);
    for (let i = 0; i < c.beats; i++) {
      const k = c.backbone[i];
      if (k === 'S' || k === 's') ev[i].push({ o: 0, n: 'tamb', d: 0, v: k === 'S' ? 0.5 : 0.35, p: 1 });
      else if (c.isAcc(i)) ev[i].push({ o: 0, n: 'tamb', d: 0, v: 0.2, p: 1 });
    }
    return fin(c, ev);
  },
  bass(c) {                                      // continuo: the root on every group head, the pulses between walk
    const ev = stem(c.beats), r = c.bassRoot, N = c.beats * c.ppb, fig = WALKS[Math.floor(c.riff('continuo')() * WALKS.length)];
    const t = nextRoot(c, r), D = steps(c, r, t), s = Math.sign(D), reach = Math.abs(D) - 1;     // steps available between the two roots
    let q = 0;
    for (let p = 0; p < N; p++) {
      const [b, o] = at(c, p), head = o === 0 && c.isAcc(b); if (head) q = 0;
      const left = N - p;                                                                        // pulses to the barline
      const n = head ? r : left <= reach ? walk(c, t, -s * left) : walk(c, r, fig[q % 4]);
      ev[b].push({ o, n, d: c.unit === 4 ? 0.45 : 0.9, v: p === 0 ? 1 : head ? 0.9 : 0.7, p: head ? 0 : o === 0 ? 1 : 2 });
      q++;
    }
    return fin(c, ev);
  },
  comp(c) {                                      // one figuration for the whole song, two notes to the beat
    const ev = stem(c.beats), t = [...c.voicing, c.voicing[0] + 12], pat = FIGS[Math.floor(c.riff('fig')() * FIGS.length)];
    let k = 0;
    for (let i = 0; i < c.beats; i++) {
      ev[i].push({ o: 0, n: t[pat[k++ % 4]], d: c.unit === 4 ? 0.45 : 0.9, v: c.isAcc(i) ? 0.7 : 0.5, p: c.unit === 4 || c.isAcc(i) ? 1 : 2 });
      if (c.unit === 4) ev[i].push({ o: 0.5, n: t[pat[k++ % 4]], d: 0.45, v: 0.5, p: 2 });
    }
    return fin(c, ev);
  },
  color(c) {                                     // organ pad, the outer voices of the chord, one per group
    const ev = stem(c.beats);
    c.accents.forEach((a, k) => put(ev, a, chord(0, clear(c, [c.voicing[0], c.voicing[2]], a, a + c.groups[k]), c.groups[k] * 0.95, 0.4, 2, { pad: 1 })));
    return fin(c, ev);
  },
};

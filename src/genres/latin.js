// Latin (modifier runes): the percussion section. The rim plays the song's clave out loud, the shaker and
// cowbell keep time, congas answer on two and at the end of the bar, the bass plays a tumbao that lands on
// the NEXT chord's root before the barline, and the guitar's montuno sits on the clave.
import { stem, fin, mono, at, fifth, inScale, nextRoot, euclid, clear, chord, put } from './_lib.js';
export default {
  id: 'latin', name: 'Latin', elem: 'mod',
  modes: ['major', 'mixolydian'],
  hook: { kit: 1.4, tops: 2.2, bass: 1.8, comp: 1.6, lead: 1.2 },
  excl: { take: 0.5, keep: 0.45 },
  swing: 0.5, pump: 0, drumKit: 'hand', fillVoice: 'tom1',
  inst: { lead: ['marimba', 'flute'], bass: 'finger', comp: 'nylon', color: 'marimba' },
  dialect: { fill: 0.4, thin: 0, push: 0.5, art: 0.7, penta: false, orn: [] },
  spice: 'cowbell and shaker',
  kit(c) {                                       // kick on one, high conga on two, low conga on the last two pulses
    const ev = stem(c.beats), N = c.beats * c.ppb, last = c.beats - 1;
    ev[0].push({ o: 0, n: 'kick', d: 0, v: 0.9, p: 0 });
    const two = c.unit === 4 || c.beats < 4 ? 1 : 2;
    if (c.beats > two) ev[two].push({ o: 0, n: 'tom1', d: 0, v: 0.7, p: 1 });
    if (c.fill && c.beats > 1 && last >= c.lastAcc) (c.unit === 4 ? [0, 0.25, 0.5, 0.75] : [0, 0.5]).forEach((o, j, a) => ev[last].push({ o, n: 'rim', d: 0, v: 0.5 + 0.4 * (j + 1) / a.length, p: 2 }));
    else if (N >= 4) for (const p of [N - 2, N - 1]) { const [b, o] = at(c, p); if (b > 0 && !ev[b].some(e => e.o === o)) ev[b].push({ o, n: 'tom2', d: 0, v: p === N - 1 ? 0.7 : 0.6, p: 2 }); }
    return fin(c, ev);
  },
  tops(c) {                                      // shaker eighths, cowbell on the accents, rim on the clave exactly
    const ev = stem(c.beats);
    for (let i = 0; i < c.beats; i++) {
      const cow = c.isAcc(i), rim0 = c.isClave(i, 0);
      if (c.unit === 4 || !(cow && rim0)) ev[i].push({ o: 0, n: 'shaker', d: 0, v: 0.6, p: 1 });
      if (c.unit === 4) ev[i].push({ o: 0.5, n: 'shaker', d: 0, v: 0.35, p: 2 });
      if (cow) ev[i].push({ o: 0, n: 'cow', d: 0, v: 0.5, p: 1 });
      if (rim0) ev[i].push({ o: 0, n: 'rim', d: 0, v: 0.8, p: 1 });
      if (c.unit === 4 && c.isClave(i, 0.5)) ev[i].push({ o: 0.5, n: 'rim', d: 0, v: 0.8, p: 2 });
    }
    return fin(c, ev);
  },
  bass(c) {                                      // tumbao: root on one, fifth on pulse 3, the next root on the last pulse
    const ev = stem(c.beats), r = c.bassRoot, f = r + fifth(c), N = c.beats * c.ppb, u = 1 / c.ppb;
    let t = nextRoot(c, f); if (!inScale(c, t)) t = r;                       // only if it belongs to this bar's scale
    const hits = [[0, r, 1, 0]];
    if (N >= 6) hits.push([3, f, 0.8, 1]);
    if (N >= 10) hits.push([6, r, 0.8, 1]);
    if (N >= 4) hits.push([N - 1, t, 0.85, c.unit === 4 ? 2 : 1]);
    hits.forEach(([p, n, v, pr], k) => { const [b, o] = at(c, p), end = k + 1 < hits.length ? hits[k + 1][0] : N; put(ev, b, { o, n, d: p === N - 1 ? 0.5 * Math.min(1, 2 * u) : Math.max(0.2, (end - p) * u - 0.1), v, p: pr }); });
    return fin(c, mono(c, ev));
  },
  comp(c) {                                      // montuno on the clave: the doubled top note, then the inner dyad
    const ev = stem(c.beats), v = c.voicing, top = [v[2] - 12, v[2]], inner = [v[0], v[1]];
    const hits = c.clave.includes(0) ? c.clave : [0, ...c.clave];
    hits.forEach((p, k) => { const [b, o] = at(c, p); put(ev, b, chord(o, clear(c, k % 2 ? inner : top, b + o, b + o + 0.5), c.unit === 4 ? 0.4 : 0.8, k ? 0.6 : 0.75, o === 0 ? 1 : 2)); });
    return fin(c, ev);
  },
  color(c) {                                     // as a guest it brings only percussion: a bell pattern and the shaker's sixteenths
    const ev = stem(c.beats), N = c.beats * c.ppb, R = c.riff('bell'), bell = euclid(Math.max(1, Math.round(N * 0.6)), N, Math.floor(R() * N));
    for (let p = 0; p < N; p++) {
      const [b, o] = at(c, p);
      if (bell[p]) ev[b].push({ o, n: 'cow', d: 0, v: 0.4, p: 2 });
      ev[b].push({ o: c.unit === 4 ? o + 0.25 : 0.5, n: 'shaker', d: 0, v: 0.3, p: 3 });
    }
    return fin(c, ev);
  },
};

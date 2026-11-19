// Jazz (frost): the time lives in the ride cymbal and the walking bass. The kick is only felt, the snare
// drops comments on the clave's off-beats, and the piano plays rootless shells on the Charleston.
import { stem, fin, at, fit, walk, steps, approach, ninth, tones, clear, chord, put } from './_lib.js';
export default {
  id: 'jazz', name: 'Jazz', elem: 'frost',
  modes: ['dorian', 'major'],
  hook: { kit: 1.0, tops: 2.0, bass: 2.2, comp: 1.6, lead: 1.6 },
  swing: 2 / 3, pump: 0, drumKit: 'brush', fillVoice: 'snare',
  inst: { lead: ['vibes', 'epiano'], bass: 'finger', comp: 'epiano', color: 'vibes' },
  dialect: { fill: 0.5, thin: 0, push: 0.35, art: 0.8, penta: false, orn: [] },
  spice: 'vibes',
  kit(c) {                                       // feathered kick on the group heads, snare drops on the clave
    const ev = stem(c.beats), N = c.beats * c.ppb, last = c.beats - 1;
    for (const a of c.accents) ev[a].push({ o: 0, n: 'kick', d: 0, v: 0.3, p: a === 0 ? 0 : 1 });
    for (const p of c.clave) { const [b, o] = at(c, p); if (p < N && (c.unit === 4 ? o === 0.5 : !c.isAcc(b) && c.backbone[b] !== 'S')) ev[b].push({ o, n: 'snare', d: 0, v: 0.45, p: 2 }); }
    if (c.fill && c.beats > 1 && last >= c.lastAcc && !ev[last].some(e => e.o === 0.5)) ev[last].push({ o: 0.5, n: 'snare', d: 0, v: 0.55, p: 2 });
    return fin(c, ev);
  },
  tops(c) {                                      // ride on every beat, the skip note and the hi-hat foot on the backbeats
    const ev = stem(c.beats);
    for (let i = 0; i < c.beats; i++) {
      const k = c.backbone[i], back = k === 'S' || k === 's';
      ev[i].push({ o: 0, n: 'ride', d: 0, v: c.isAcc(i) ? 0.8 : 0.6, p: 1 });
      if (back) ev[i].push({ o: 0, n: 'pedal', d: 0, v: 0.6, p: 1 });
      if (c.unit === 4 && back) ev[i].push({ o: 0.5, n: 'ride', d: 0, v: 0.45, p: 2 });
    }
    return fin(c, ev);
  },
  bass(c) {                                      // walking: root on one, steps between, an approach into the next root
    const ev = stem(c.beats), r = c.bassRoot, last = c.beats - 1, on = [];
    for (let i = 0; i < c.beats; i++) if (c.unit === 4 || c.isAcc(i) || i === last) on.push(i);
    const m = on.length, ap = m > 1 ? approach(c, r) : null, line = [r];
    // Every move is one or two scale steps and never zero, so no pitch repeats; with beats to spare the line
    // wanders away first and comes back, and it prefers to reach the approach note by a single step.
    const away = r < 41 || c.riff('walk')() < 0.5 ? 1 : -1, ok = (d, q) => (q === 0 ? d === 0 : q === 1 ? d !== 0 && Math.abs(d) <= 2 : Math.abs(d) <= 2 * q);
    for (let k = 1; k < m - 1; k++) {
      const cur = line[k - 1], q = m - 1 - k, d = steps(c, cur, ap.n), t = Math.sign(d) || away;
      let mv = 0;
      for (const strict of [true, false]) { for (const v of [t, -t, 2 * t, -2 * t]) { const n = walk(c, cur, v); if (n >= 36 && n <= 59 && ok(d - v, q) && (!strict || q !== 1 || Math.abs(d - v) === 1)) { mv = v; break; } } if (mv) break; }
      line.push(walk(c, cur, mv || t));
    }
    if (m > 1) line.push(ap.n);
    on.forEach((i, k) => {
      const end = k + 1 < m ? on[k + 1] : c.beats, chrom = k === m - 1 && m > 1 && ap.chromatic;
      ev[i].push({ o: 0, n: line[k], d: chrom ? 0.5 : (end - i) * 0.9, v: c.isAcc(i) ? 0.95 : 0.8, p: i === 0 || c.isAcc(i) ? 0 : 1 });
    });
    return fin(c, ev);
  },
  comp(c) {                                      // shells (third, seventh, ninth when it fits) on pulses 0 and 3
    const ev = stem(c.beats), N = c.beats * c.ppb, t3 = fit(c.tonic + c.chord.tones[1], 52, 63);
    const up = pc => t3 + 1 + ((((c.tonic + pc - t3 - 1) % 12) + 12) % 12);                       // the next such pitch above the third
    const full = [t3, up(c.chord.sev)]; if (ninth(c)) full.push(up(c.chord.root + 2));
    let ns = clear(c, full.sort((a, b) => a - b));
    if (ns.length < 2) ns = clear(c, [t3, up(c.chord.tones[2] % 12)]);                           // the tune holds the root: plain third and fifth
    for (const p of N >= 10 ? [0, 3, 6, 8] : [0, 3]) if (p < N) { const [b, o] = at(c, p); put(ev, b, chord(o, ns, p === 0 ? (c.unit === 4 ? 0.3 : 0.6) : (c.unit === 4 ? 0.5 : 0.9), p === 0 ? 0.55 : 0.6, 1)); }
    return fin(c, ev);
  },
  color(c) {                                     // vibes guide tones: the third or fifth nearest one register, one per group
    const ev = stem(c.beats), centre = 66 + Math.floor(c.riff('guide')() * 8), rp = (c.tonic + c.chord.root) % 12;
    const cand = tones(c, 60, 80).filter(n => n % 12 !== rp), n = cand.sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre))[0];
    c.accents.forEach((a, k) => { if (n != null) ev[a].push({ o: 0, n, d: Math.min(c.groups[k], 2) * 0.9, v: 0.45, p: 2 }); });
    return fin(c, ev);
  },
};

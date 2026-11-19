// Chip rock (steel): a rock backbeat with one syncopated kick, noise-hat eighths, a root-and-octave bass that
// runs up the scale into the next chord, and chords that are never struck: one pulse voice flickers through
// them (x.arp), the way a three-channel console fakes harmony.
import { stem, fin, at, walk, nextRoot, inScale, fit } from './_lib.js';
const ORDERS = [[0, 1, 2, 1], [0, 2, 1, 2], [2, 1, 0, 1], [0, 1, 2, 0], [2, 0, 1, 0]];   // the three chord tones, four steps to the beat
export default {
  id: 'chiprock', name: 'Chip Rock', elem: 'steel',
  modes: ['aeolian', 'dorian'],
  hook: { kit: 1.6, tops: 1.0, bass: 1.4, comp: 1.8, lead: 1.8 },
  swing: 0.5, pump: 0.1, drumKit: 'chip', fillVoice: 'snare',
  inst: { lead: ['square', 'pulse25'], bass: 'synbass', comp: 'pulse25', color: 'pluck' },
  dialect: { fill: 0.5, thin: 0, push: 0.1, art: 0.7, penta: false, orn: ['flip', 'echo'] },
  spice: 'octave blips',
  kit(c) {                                       // kick and snare backbone, a snare roll that gets louder
    const ev = stem(c.beats), R = c.riff('kick'), last = c.beats - 1;
    // the one extra kick of the riff: the "and" of a later kick beat, or of a beat that leads into a kick
    // (an unaccented eighth in /8). Which one is the song's own.
    const cands = []; for (let i = 0; i < c.beats; i++) if (c.unit === 4 ? i < last && (c.backbone[i + 1] !== 'S' || (i > 0 && c.backbone[i] === 'K')) : i > 0 && c.backbone[i] === 'h') cands.push(i);
    const extra = cands.length ? cands[Math.floor(R() * cands.length)] : -1;
    const from = Math.max(c.lastAcc, c.beats - 2), roll = [];
    if (c.fill && c.beats > 1) for (let i = from; i <= last; i++) for (const o of c.unit === 4 ? (i === last ? [0, 0.25, 0.5, 0.75] : [0.5, 0.75]) : (i === last ? [0, 0.5] : [0.5])) roll.push([i, o]);
    for (let i = 0; i < c.beats; i++) {
      const k = c.backbone[i], inRoll = roll.some(x => x[0] === i && x[1] === 0);
      if (k === 'K') ev[i].push({ o: 0, n: 'kick', d: 0, v: 1, p: i === 0 ? 0 : 1 });
      if (k === 'S' && !inRoll) ev[i].push({ o: 0, n: 'snare', d: 0, v: 1, p: 0 });
      if (k === 's' && !inRoll) ev[i].push({ o: 0, n: 'snare', d: 0, v: 0.55, p: 1 });
      if (i === extra) ev[i].push({ o: c.unit === 4 ? 0.5 : 0, n: 'kick', d: 0, v: 0.8, p: 2 });
    }
    roll.forEach(([i, o], j) => ev[i].push({ o, n: 'snare', d: 0, v: 0.4 + 0.6 * (j + 1) / roll.length, p: o === 0 && c.backbone[i] === 'S' ? 0 : 2 }));
    return fin(c, ev);
  },
  tops(c) {                                      // noise hats: one noise channel, so they speak up between the drums
    const ev = stem(c.beats);
    for (let i = 0; i < c.beats; i++) {
      ev[i].push({ o: 0, n: 'hat', d: 0, v: c.unit === 4 || c.isAcc(i) ? 0.2 : 0.5, p: 1 });
      if (c.unit === 4) ev[i].push({ o: 0.5, n: 'hat', d: 0, v: 0.5, p: 2 });
    }
    if (c.pos === 0) ev[0].unshift({ o: 0, n: 'crash', d: 0, v: 0.7, p: 1 });
    return fin(c, ev);
  },
  bass(c) {                                      // root, octave, root, octave; the last pulses run into the next root
    const ev = stem(c.beats), r = c.bassRoot, N = c.beats * c.ppb, run = N >= 6 ? 3 : N >= 4 ? 2 : N === 3 ? 1 : 0;
    const t = nextRoot(c, r + 6), on = inScale(c, t), below = walk(c, t, -run - (on ? 0 : -1)) >= 36;
    let k = 0;
    for (let p = 0; p < N; p++) {
      const [b, o] = at(c, p), j = N - p, acc = o === 0 && c.isAcc(b); if (acc) k = 0;
      const n = j <= run ? fit(below ? walk(c, t, on ? -j : 1 - j) : walk(c, t, j), 36, 59) : k % 2 ? r + 12 : r;
      ev[b].push({ o, n, d: c.unit === 4 ? 0.42 : 0.8, v: acc ? 1 : j <= run ? 0.75 : 0.7, p: p === 0 || acc ? 0 : o === 0 ? 1 : 2 });
      k++;
    }
    return fin(c, ev);
  },
  comp(c) {                                      // one arpeggiating pulse voice per beat, never a struck chord
    const ev = stem(c.beats), base = c.voicing[0], t = [0, c.voicing[1] - base, c.voicing[2] - base];          // inside the voicing, so always under the tune
    // n is the first pitch that sounds; x.arp are the steps from it (so arp[0] is always 0)
    const order = ORDERS[Math.floor(c.riff('arp')() * ORDERS.length)], first = t[order[0]], arp = order.map(k => t[k] - first);
    for (let i = 0; i < c.beats; i++) ev[i].push({ o: 0, n: base + first, d: 0.95, v: c.isAcc(i) ? 0.6 : 0.45, p: c.isAcc(i) ? 1 : 2, i: 'pulse25', x: { arp } });
    return fin(c, ev);
  },
  color(c) {                                     // octave blips on the off-beats
    const ev = stem(c.beats), hi = c.voicing[Math.floor(c.riff('blip')() * 3)] + 12;
    for (let i = 0; i < c.beats; i++) {
      if (c.unit === 4) ev[i].push({ o: 0.5, n: i % 2 ? hi - 12 : hi, d: 0.12, v: 0.45, p: i % 2 ? 3 : 2 });
      else if (!c.isAcc(i)) ev[i].push({ o: 0, n: i % 2 ? hi : hi - 12, d: 0.25, v: 0.4, p: 2 });
    }
    return fin(c, ev);
  },
};

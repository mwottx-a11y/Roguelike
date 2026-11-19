// Synthwave (void): four-on-the-floor, a clap on the backbeat, an eighth-note root ostinato, a pad that is
// re-struck on every group head and one pluck arpeggio shape for the whole song.
import { stem, fin, clear, chord, put } from './_lib.js';
const SHAPES = [[0, 1, 2, 3, 2, 1], [0, 2, 1, 3, 1, 2], [3, 2, 1, 0, 1, 2], [0, 1, 2, 1, 3, 2]];
export default {
  id: 'synthwave', name: 'Synthwave', elem: 'void',
  modes: ['aeolian'],
  hook: { kit: 1.8, tops: 1.6, bass: 1.6, comp: 2.2, lead: 1.2 },
  swing: 0.5, pump: 0.35, drumKit: 'disco', fillVoice: 'tom2',
  inst: { lead: ['sawlead', 'square'], bass: 'synbass', comp: 'strings', color: 'pluck' },
  dialect: { fill: 0, thin: 0.7, push: 0.15, art: 1, penta: false, orn: ['glide'] },
  spice: 'pluck arp',
  kit(c) {                                       // four-on-the-floor, clap on the backbeat, tom fill
    const ev = stem(c.beats);
    for (let i = 0; i < c.beats; i++) {
      if (c.unit === 4 || c.isAcc(i)) ev[i].push({ o: 0, n: 'kick', d: 0, v: 1, p: c.isAcc(i) ? 0 : 1 });
      if (c.backbone[i] === 'S' || (c.unit === 4 && c.beats === 3 && i === 1)) ev[i].push({ o: 0, n: 'clap', d: 0, v: 0.9, p: 0 });   // a bar of three claps on two
      if (c.fill && c.beats > 1 && i >= c.lastAcc)
        ev[i].push({ o: 0.5, n: ['tom1', 'tom2', 'tom3'][Math.min(2, i - c.lastAcc)], d: 0, v: 0.8, p: 2 });
    }
    return fin(c, ev);
  },
  tops(c) {                                      // closed hat on the beat, open hat on the off-beat
    const ev = stem(c.beats);
    for (let i = 0; i < c.beats; i++) {
      const open = c.unit === 8 && (c.isAcc(i + 1) || i === c.beats - 1) && c.beats > 1;
      ev[i].push({ o: 0, n: open ? 'ohat' : 'hat', d: 0, v: open ? 0.7 : c.unit === 4 ? 0.35 : 0.5, p: 1 });
      if (c.unit === 4) ev[i].push({ o: 0.5, n: 'ohat', d: 0, v: 0.7, p: 2 });
    }
    if (c.pos === 0) ev[0].unshift({ o: 0, n: 'crash', d: 0, v: 0.8, p: 1 });
    return fin(c, ev);
  },
  bass(c) {                                      // root ostinato, the octave on the clave's off-beats
    const ev = stem(c.beats), r = c.bassRoot;
    for (let i = 0; i < c.beats; i++) {
      ev[i].push({ o: 0, n: r, d: c.unit === 4 ? 0.45 : 0.9, v: c.isAcc(i) ? 1 : 0.8, p: i === 0 || c.isAcc(i) ? 0 : 1 });
      if (c.unit === 4) ev[i].push({ o: 0.5, n: c.isClave(i, 0.5) ? r + 12 : r, d: 0.42, v: 0.7, p: 2 });
    }
    return fin(c, ev);
  },
  comp(c) {                                      // pad re-struck on each group head
    const ev = stem(c.beats);
    c.accents.forEach((a, k) => put(ev, a, chord(0, clear(c, c.voicing, a, a + c.groups[k]), c.groups[k] * 0.95, 0.6, 1, { pad: 1 })));
    return fin(c, ev);
  },
  color(c) {                                     // pluck arpeggio, one fixed shape for the whole song
    const ev = stem(c.beats), t = [...c.voicing, c.voicing[0] + 12], pat = SHAPES[Math.floor(c.riff('arp')() * SHAPES.length)];
    let k = 0;
    for (let i = 0; i < c.beats; i++) {
      ev[i].push({ o: 0, n: t[pat[k++ % 6]], d: c.unit === 4 ? 0.4 : 0.8, v: 0.5, p: 2 });
      if (c.unit === 4) ev[i].push({ o: 0.5, n: t[pat[k++ % 6]], d: 0.4, v: 0.4, p: 3 });
    }
    return fin(c, ev);
  },
};

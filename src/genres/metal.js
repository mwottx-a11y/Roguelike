// Metal (fire): the guitar chugs the root on every pulse and slams the power chord on the song's clave; the
// bass doubles it, the kick follows it, and on the galloping beats all three play 1-and-a together.
import { stem, fin, mono, at, power, rootIn, p5, approach, snares } from './_lib.js';
// which beats gallop: one pattern per song and meter, shared by kick, bass and guitar
const gallop = c => { const R = c.groove('gallop'); return Array.from({ length: c.beats }, () => R() < 0.4); };
export default {
  id: 'metal', name: 'Metal', elem: 'fire',
  modes: ['phrygian', 'aeolian'],
  hook: { kit: 2.0, tops: 1.2, bass: 1.6, comp: 2.2, lead: 1.4 },
  swing: 0.5, pump: 0.1, drumKit: 'tight', fillVoice: 'tom2',
  inst: { lead: ['sawlead', 'square'], bass: 'synbass', comp: 'dist', color: 'dist' },
  dialect: { fill: 0.3, thin: 0, push: 0.2, art: 1, penta: false, orn: ['bend'] },
  spice: 'power chugs',
  kit(c) {                                       // kick on the bass's eighths, snare on the backbeat, sixteenths as a luxury
    const ev = stem(c.beats), g = gallop(c), last = c.beats - 1, sn = snares(c);
    for (let i = 0; i < c.beats; i++) {
      const roll = c.fill && c.beats > 1 && i === last && i >= c.lastAcc, strong = i === 0 || c.isClave(i, 0) || c.isAcc(i);
      // the double-bass drive: in /4 the kick plays the bass's eighths; in /8 the riff's hits, the rest as a luxury
      // (the feet rest under the snare, as a drummer's do)
      if (i === 0 || !sn.includes(i)) ev[i].push({ o: 0, n: 'kick', d: 0, v: i === 0 ? 1 : strong ? 0.95 : 0.8, p: i === 0 ? 0 : c.unit === 4 || strong ? 1 : 3 });
      if (sn.includes(i)) ev[i].push({ o: 0, n: 'snare', d: 0, v: 1, p: 0 });
      if (roll) { ev[i].push({ o: 0.5, n: 'tom2', d: 0, v: 0.8, p: 2 }); if (c.unit === 4) ev[i].push({ o: 0.75, n: 'tom3', d: 0, v: 0.9, p: 2 }); continue; }
      if (c.unit === 4) {
        ev[i].push({ o: 0.5, n: 'kick', d: 0, v: c.isClave(i, 0.5) ? 0.9 : 0.7, p: 2 });
        if (g[i]) ev[i].push({ o: 0.75, n: 'kick', d: 0, v: 0.7, p: 3 });
      }
    }
    return fin(c, ev);
  },
  tops(c) {                                      // ride on the beats, a quiet hat between, crash on the phrase
    const ev = stem(c.beats);
    for (let i = 0; i < c.beats; i++) {
      ev[i].push({ o: 0, n: c.unit === 4 || c.isAcc(i) ? 'ride' : 'hat', d: 0, v: c.isAcc(i) ? 0.8 : 0.6, p: 1 });
      if (c.unit === 4) ev[i].push({ o: 0.5, n: 'hat', d: 0, v: 0.3, p: 2 });
    }
    if (c.pos === 0) ev[0].unshift({ o: 0, n: 'crash', d: 0, v: 0.9, p: 1 });
    return fin(c, ev);
  },
  bass(c) {                                      // root chug on every pulse, accents on the clave
    const ev = stem(c.beats), r = c.bassRoot, g = gallop(c), u4 = c.unit === 4;
    for (let i = 0; i < c.beats; i++) for (const o of u4 ? (g[i] ? [0, 0.5, 0.75] : [0, 0.5]) : [0]) {
      const hit = (i === 0 && o === 0) || c.isClave(i, o);
      ev[i].push({ o, n: r, d: hit ? (u4 ? 0.4 : 0.8) : u4 ? 0.2 : 0.4, v: hit ? 1 : 0.7, p: o === 0 ? (i === 0 || c.isAcc(i) ? 0 : 1) : o === 0.5 ? 2 : 3 });
    }
    // the last pulse leans into the next chord
    if (c.beats > 1 && c.nextBassRoot !== r) { const L = ev[c.beats - 1], e = L[L.length - 1], a = approach(c, r); e.n = a.n; e.d = Math.min(e.d, 0.5); }
    return fin(c, mono(c, ev));
  },
  comp(c) {                                      // power chord on the clave, palm-muted root everywhere else
    const ev = stem(c.beats), pw = power(c), g = gallop(c), N = c.beats * c.ppb, u4 = c.unit === 4, x = { bus: 'dist' };
    for (let p = 0; p < N; p++) {
      const [b, o] = at(c, p), hit = p === 0 || c.clave.includes(p);
      if (hit) ev[b].push({ o, n: pw[0], ns: pw, d: u4 ? 0.45 : 0.9, v: 0.9, p: 1, x });
      else ev[b].push({ o, n: pw[0], d: u4 ? 0.2 : 0.4, v: 0.55, p: 2, x });
      if (u4 && o === 0.5 && g[b]) ev[b].push({ o: 0.75, n: pw[0], d: 0.2, v: 0.5, p: 3, x });
    }
    return fin(c, mono(c, ev));
  },
  color(c) {                                     // as a guest: power-chord stabs on the accents and the clave
    const ev = stem(c.beats), r = rootIn(c, 48), ns = p5(c) ? [r, r + 7] : [r, r + 12], x = { bus: 'dist' }, N = c.beats * c.ppb;
    for (let p = 0; p < N; p++) {
      const [b, o] = at(c, p);
      if (o === 0 && c.isAcc(b)) ev[b].push({ o, n: ns[0], ns, d: c.unit === 4 ? 0.3 : 0.6, v: 0.6, p: 2, x });
      else if (c.clave.includes(p)) ev[b].push({ o, n: ns[0], ns, d: c.unit === 4 ? 0.2 : 0.4, v: 0.5, p: 3, x });
    }
    return fin(c, ev);
  },
};

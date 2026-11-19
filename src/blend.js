// HEXBEAT — the blend: who plays which stem of the song. Pure: no RNG, no clock, no audio.
//
// Every genre is a deck playing its own arrangement of the same song (see music.js), so any stem of one genre
// sits on any stem of another in key and on the grid. A wheel's class weights become "seats", and each seated
// genre bids for stems with share x hook (the stems that genre is famous for). One kit and one bass, ever;
// hats and chords are layered at equal power; the tune is traded phrase by phrase; the smallest seat adds its
// colour. Two genres that both hold a real share form a named hybrid with its own signature devices.
import { GENRES } from './genres/index.js';

const SEAT = 0.08, STAY = 0.05, ZONE_IN = 0.30, ZONE_OUT = 0.26;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// mix: [[genreId, weight], ...] (genreMix output). Up to three genres with a real share get a seat.
export function seats(mix, prev) {
  const was = prev ? prev.seats : [];
  let tot = 0; for (const m of mix || []) if (GENRES[m[0]] && m[1] > 0) tot += m[1];
  if (!(tot > 0)) return [{ g: 'baroque', share: 1 }];
  let st = mix.filter(m => GENRES[m[0]] && m[1] > 0).map(m => ({ g: m[0], share: m[1] / tot }));
  st.sort((a, b) => b.share - a.share || (a.g < b.g ? -1 : 1));
  const lead = st[0];
  st = st.filter(s => s.share >= (was.includes(s.g) ? STAY : SEAT)).slice(0, 3);
  if (!st.length) st = [lead];
  let s = 0; for (const x of st) s += x.share; for (const x of st) x.share /= s;
  return st;
}

// ---------- the 28 hybrids: data only. pin = forced owners inside the zone, dev = devices, swap = patch swaps
const H = (name, pin, dev = [], swap = null) => ({ name, pin, dev, swap });
export const HYBRIDS = {
  'baroque+celtic': H('Court Jig', { kit: 'celtic', bass: 'baroque' }, [['drone']]),
  'baroque+chiprock': H('8-Bit Baroque', { kit: 'chiprock' }, [['chipArp', 'baroque']]),
  'baroque+funk': H('Clavinet Funk', { kit: 'funk', bass: 'funk' }, [['claveLock', 'funk']], { funk: { comp: 'harpsi' } }),
  'baroque+jazz': H('Swing Bach', { tops: 'jazz', bass: 'jazz' }, [], { jazz: { comp: 'harpsi' } }),
  'baroque+latin': H('Chacona', { tops: 'latin', bass: 'baroque' }, [['claveRim'], ['claveLock', 'baroque']]),
  'baroque+metal': H('Neoclassical Metal', { kit: 'metal', bass: 'metal', color: 'baroque' }, [['gallop', 'metal']]),
  'baroque+synthwave': H('Switched-On Baroque', { kit: 'synthwave' }, [['fourFloor'], ['pump']], { baroque: { comp: 'pluck' } }),
  'celtic+chiprock': H('Pixel Jig', { kit: 'chiprock' }, [['drone'], ['chipArp', 'chiprock']]),
  'celtic+funk': H('Acid Croft', { kit: 'funk', bass: 'funk' }, [['drone']]),
  'celtic+jazz': H('Swung Jig', { tops: 'jazz', bass: 'jazz' }, [['drone']]),
  'celtic+latin': H('Salsa Celtica', { tops: 'latin', bass: 'latin' }, [['thirds'], ['claveLock', 'celtic']]),
  'celtic+metal': H('Folk Metal', { kit: 'metal', bass: 'metal' }, [['gallop', 'metal'], ['drone']]),
  'celtic+synthwave': H('Neon Reel', { kit: 'synthwave', bass: 'synthwave' }, [['fourFloor'], ['pump'], ['drone']]),
  'chiprock+funk': H('Mega Drive Funk', { kit: 'funk', bass: 'funk' }, [['unison', 'chiprock']]),
  'chiprock+jazz': H('Bit Bop', { tops: 'jazz', bass: 'jazz' }, [['chipArp', 'chiprock']]),
  'chiprock+latin': H('8-Bit Cumbia', { kit: 'chiprock', tops: 'latin' }, [['thirds'], ['claveLock', 'chiprock']]),
  'chiprock+metal': H('Nintendocore', { kit: 'metal' }, [['gallop', 'metal'], ['chipArp', 'chiprock']]),
  'chiprock+synthwave': H('Chipwave', { kit: 'synthwave' }, [['fourFloor'], ['pump'], ['chipArp', 'chiprock']]),
  'funk+jazz': H('Jazz-Funk', { kit: 'funk', tops: 'funk', bass: 'funk' }, [['claveLock', 'jazz']]),
  'funk+latin': H('Boogaloo', { kit: 'funk', tops: 'latin' }, [['claveLock', 'funk']]),
  'funk+metal': H('Funk Metal', { kit: 'metal', bass: 'funk' }, [['unison', 'metal']]),
  'funk+synthwave': H('Nu-Disco', { kit: 'synthwave', bass: 'funk' }, [['fourFloor'], ['pump']]),
  'jazz+latin': H('Bossa Nova', { tops: 'latin', bass: 'latin' }, [['claveLock', 'jazz']]),
  'jazz+metal': H('Swing Metal', { kit: 'metal', tops: 'jazz' }, [['gallop', 'metal']]),
  'jazz+synthwave': H('Electro Swing', { kit: 'synthwave', tops: 'jazz', bass: 'jazz' }, [['fourFloor'], ['pump']]),
  'latin+metal': H('Latin Metal', { kit: 'metal', tops: 'latin' }, [['claveLock', 'metal'], ['thirds']]),
  'latin+synthwave': H('Neon Dembow', { kit: 'synthwave', tops: 'latin' }, [['dembow'], ['pump']]),
  'metal+synthwave': H('Darksynth', { kit: 'synthwave', bass: 'synthwave' }, [['distBass'], ['fourFloor'], ['pump']]),
};
const ELEM_NAME = { arcane: 'Arcane', fire: 'Fire', frost: 'Frost', volt: 'Volt', void: 'Void', nature: 'Nature', steel: 'Steel', mod: 'Modifier' };
// The collection: 8 pure styles and 28 hybrids, with the recipe a player needs.
export const ALL_STYLES = [
  ...Object.keys(GENRES).map(g => ({ id: g, name: GENRES[g].name, a: g, b: null, recipe: 'Mostly ' + ELEM_NAME[GENRES[g].elem] + ' runes' })),
  ...Object.keys(HYBRIDS).map(id => { const [a, b] = id.split('+'); return { id, name: HYBRIDS[id].name, a, b, recipe: ELEM_NAME[GENRES[a].elem] + ' + ' + ELEM_NAME[GENRES[b].elem] + ', both strong' }; }),
];
// element weights that put a style on air (for the record player)
export function mixForStyle(id) { const s = ALL_STYLES.find(x => x.id === id), w = {}; if (!s) return { arcane: 1 }; w[GENRES[s.a].elem] = 5; if (s.b) w[GENRES[s.b].elem] = 5; return w; }

// ---------- the auction
// st = seats(); prev = the table on air (incumbents bid x1.2 and keep a stem down to a lower share);
// opt.first = genre of the rune in slot 0 (it calls the tune: x1.25 on the lead);
// opt.keep = { kit, bass }: owners that must stay while a swap is waiting for its phrase downbeat.
export function allocate(st, prev, opt = {}) {
  const ids = st.map(s => s.g), share = {}; for (const s of st) share[s.g] = s.share;
  const guest = ids.length === 3 ? ids[2] : null, a = ids[0], b = ids[1] || null;
  const x = b ? share[b] / (share[a] + share[b]) : 0;
  let hybrid = null;
  if (b) { const key = [a, b].sort().join('+'); if (x >= (prev && prev.hybrid === key ? ZONE_OUT : ZONE_IN)) hybrid = key; }
  const row = hybrid ? HYBRIDS[hybrid] : null, pin = row ? row.pin : {};
  const exclOf = g => GENRES[g].excl || { take: 0.25, keep: 0.2 };
  const excl = part => {
    const kept = opt.keep && opt.keep[part]; if (kept && share[kept] != null) return kept;
    if (pin[part]) return pin[part];
    let best = null, bb = -1;
    for (const g of ids) {
      if (g === guest) continue;
      const inc = prev && prev.own[part] === g, e = exclOf(g);
      if (ids.length > 1 && share[g] < (inc ? e.keep : e.take)) continue;
      const v = share[g] * GENRES[g].hook[part] * (inc ? 1.2 : 1); if (v > bb) { bb = v; best = g; }
    }
    return best || ids.find(g => g !== guest && exclOf(g).take <= 0.25) || a;
  };
  const shared = part => {
    let c = ids.filter(g => part === 'tops' || g !== guest).map(g => [g, share[g] * GENRES[g].hook[part]]).sort((p, q) => q[1] - p[1]);
    if (pin[part]) c.sort((p, q) => (q[0] === pin[part]) - (p[0] === pin[part]));
    c = c.slice(0, 2);
    const tot = c.reduce((n, p) => n + p[1], 0), out = {};
    if (c.length > 1 && c[1][1] / tot < 0.09) c.pop();
    const t2 = c.reduce((n, p) => n + p[1], 0);
    for (const p of c) out[p[0]] = Math.sqrt(p[1] / t2);          // squares sum to 1: an equal-power crossfade
    return out;
  };
  const own = { kit: excl('kit'), bass: excl('bass'), color: ids.length > 1 ? (pin.color || ids[ids.length - 1]) : a };
  const lvl = { tops: shared('tops'), comp: shared('comp'), color: clamp(0.5 + 1.5 * share[own.color], 0.5, 1) };
  // the tune: three phrase slots by largest remainder; the leader states it, the smallest holder takes the
  // bridge, and the last A is a tutti (the runner-up doubles the same notes an octave away)
  const lb = ids.map(g => [g, share[g] * GENRES[g].hook.lead * (opt.first === g ? 1.25 : 1)]).sort((p, q) => q[1] - p[1]);
  const lt = lb.reduce((n, p) => n + p[1], 0), n = {}; let left = 3;
  for (const p of lb) { n[p[0]] = Math.floor(p[1] / lt * 3); left -= n[p[0]]; }
  for (const p of lb.slice().sort((p, q) => (q[1] / lt * 3) % 1 - (p[1] / lt * 3) % 1)) if (left > 0) { n[p[0]]++; left--; }
  const top = lb[0][0], hold = lb.filter(p => n[p[0]] > 0).map(p => p[0]), small = hold[hold.length - 1];
  const run = lb[1] && lb[1][1] / lt >= 0.2 ? lb[1][0] : null;
  const lead = [
    { g: top, alt: false, dbl: null },
    hold.length === 1 ? { g: top, alt: true, dbl: null } : { g: n[top] >= 2 ? top : hold[1], alt: false, dbl: null },
    { g: small, alt: small === top, dbl: null },
    { g: top, alt: false, dbl: run || top },
  ];
  const primary = Object.keys(lvl.tops)[0], dev = row ? row.dev : [];
  let pump = GENRES[own.kit].pump || 0; if (dev.some(d => d[0] === 'pump')) pump = Math.max(0.35, pump);
  const name = hybrid ? row.name + (guest ? ' feat. ' + GENRES[guest].name : '') : GENRES[a].name + (b ? ' with ' + GENRES[own.color].spice : '');
  return { seats: ids, share, own, lvl, lead, swing: GENRES[primary].swing || 0.5, pump, hybrid, dev, swap: row ? row.swap : null,
    style: { id: hybrid || a, name, a, b, guest, x } };
}
export const styleOf = table => table.style;
// do two tables put the same players on the same stems? (levels may differ)
export function sameBand(p, q) {
  return p.own.kit === q.own.kit && p.own.bass === q.own.bass && p.own.color === q.own.color && p.hybrid === q.hybrid
    && Object.keys(p.lvl.tops).join() === Object.keys(q.lvl.tops).join() && Object.keys(p.lvl.comp).join() === Object.keys(q.lvl.comp).join();
}

// The layers of a bar. rep = which phrase of the AABA form (0..3).
export function layersOf(T, rep) {
  const L = [{ g: T.own.kit, part: 'kit', lvl: 1 }, { g: T.own.bass, part: 'bass', lvl: 1 }];
  const ld = T.lead[rep & 3], pk = GENRES[ld.g];
  L.push({ g: ld.g, part: 'lead', lvl: 1, inst: pk.inst.lead[ld.alt ? 1 : 0] });
  let k = 0; for (const g in T.lvl.comp) L.push({ g, part: 'comp', lvl: T.lvl.comp[g], onlyP: k++ ? 1 : 3 });   // the weaker layer plays its core only
  k = 0; for (const g in T.lvl.tops) L.push({ g, part: 'tops', lvl: T.lvl.tops[g], onlyP: k++ ? 1 : 3 });
  L.push({ g: T.own.color, part: 'color', lvl: T.lvl.color });
  if (ld.dbl) L.push({ g: ld.g, part: 'lead', lvl: 0.5, inst: GENRES[ld.dbl].inst.lead[ld.dbl === ld.g ? 1 : 0], oct: -12, dbl: 1 });
  return L;
}

// ---------- devices: pure transforms that give a hybrid its signature. (ev, frame, layer, table, song) -> ev
const pulseAt = (f, p) => [Math.floor(p / f.ppb), (p % f.ppb) / f.ppb];
const onClave = (f, b, o) => { const p = (b + o) * f.ppb; return Number.isInteger(p) && f.clave.includes(p); };
const isKick = e => e.n === 'kick';
function fourFloor(ev, f) {
  const heads = f.unit === 4 ? ev.map((_, i) => i) : f.accents;
  for (const b of heads) if (!ev[b].some(e => e.o === 0 && isKick(e))) ev[b].push({ o: 0, n: 'kick', d: 0, v: 0.9, p: 1 });
  return ev;
}
export const DEVICES = {
  fourFloor,
  // four on the floor with the dembow snare: "boom - ch - boom chk"
  dembow(ev, f) {
    fourFloor(ev, f);
    for (let b = 0; b < ev.length; b++) ev[b] = ev[b].filter(e => e.n !== 'snare' && e.n !== 'clap');
    if (f.unit === 4) { for (let b = 0; b + 1 < ev.length; b += 2) { ev[b].push({ o: 0.75, n: 'snare', d: 0, v: 0.9, p: 1 }); ev[b + 1].push({ o: 0.5, n: 'snare', d: 0, v: 0.9, p: 1 }); } }
    else f.groups.forEach((n, k) => { if (n > 1) ev[f.accents[k] + n - 1].push({ o: 0, n: 'snare', d: 0, v: 0.9, p: 1 }); });
    return ev;
  },
  // every beat becomes the gallop: long - short short, on the beat's own pitch or chord
  gallop(ev, f) {
    let cur = null;
    return ev.map((list, b) => {
      cur = list.find(e => typeof e.n === 'number') || cur; if (!cur) return list;
      const os = f.unit === 4 ? [0, 0.5, 0.75] : f.accents.includes(b) ? [0] : [0, 0.5];
      const x = cur.x && cur.x.bus ? { bus: cur.x.bus } : undefined;
      return os.map(o => ({ ...cur, o, d: f.unit === 4 ? 0.2 : 0.4, v: o === 0 ? cur.v : cur.v * 0.8, p: o === 0 ? Math.min(cur.p, 1) : 2, x }));
    });
  },
  // chords speak on the clave and whisper everywhere else
  claveLock(ev, f) {
    for (let b = 0; b < ev.length; b++) for (const e of ev[b]) { if (onClave(f, b, e.o)) { e.v = Math.max(0.85, e.v); e.p = Math.min(e.p, 1); } else { e.v *= 0.5; e.p = 3; } }
    return ev;
  },
  claveRim(ev, f) { for (const p of f.clave) { const [b, o] = pulseAt(f, p); if (ev[b]) ev[b].push({ o, n: 'rim', d: 0, v: 0.7, p: 1 }); } return ev; },
  // a held tonic and fifth under everything; a pitch that would grind against the chord is left out
  drone(ev, f) {
    const T = 48 + (f.tonic % 12), fifth = T + 7 <= 60 ? T + 7 : T - 5, bad = n => f.chord.pcs.some(pc => { const d = (((n - f.tonic - pc) % 12) + 12) % 12; return d === 1 || d === 11; });
    const ns = [Math.min(T, fifth), Math.max(T, fifth)].filter(n => !bad(n)), out = ev.map(() => []);
    if (ns.length) out[0].push({ o: 0, n: ns[0], ns: ns.length > 1 ? ns : undefined, d: ev.length, v: 0.45, p: 2, i: 'fiddle', x: { pad: 1 } });
    return out;
  },
  // a harmony voice under the tune: the nearest chord tone a third to a sixth below
  thirds(ev, f, L, T) {
    const partner = T.style.a === L.g ? T.style.b : T.style.a, inst = GENRES[partner || L.g].inst.lead[0];
    for (let b = 0; b < ev.length; b++) for (const e of ev[b].slice()) {
      if (typeof e.n !== 'number' || e.d < 0.5 || e.echo) continue;
      for (let k = 3; k <= 9; k++) if (f.chord.pcs.includes((((e.n - k - f.tonic) % 12) + 12) % 12)) { ev[b].push({ o: e.o, n: e.n - k, d: e.d, v: e.v * 0.6, p: 3, i: inst }); break; }
    }
    return ev;
  },
  distBass(ev) { for (const list of ev) for (const e of list) e.x = { ...(e.x || {}), bus: 'dist' }; return ev; },
  // chords become one flickering square voice per beat
  chipArp(ev) {
    let cur = null;
    return ev.map(list => {
      const c = list.find(e => e.ns); if (c) cur = c; if (!cur) return list;
      return [...list.filter(e => !e.ns && typeof e.n !== 'number'), { o: 0, n: cur.ns[0], d: 0.95, v: cur.v, p: 1, i: 'pulse25', x: { arp: cur.ns.map(m => m - cur.ns[0]) } }];
    });
  },
  // chords strike only where the bass does
  unison(ev, f, L, T, song) {
    const bass = song.stem(f.idx, f.beats, f.unit, T.own.bass, 'bass'); let cur = null;
    return ev.map((list, b) => {
      cur = list.find(e => typeof e.n === 'number') || cur; if (!cur) return [];
      const x = cur.x && cur.x.bus ? { bus: cur.x.bus } : undefined;
      return bass[b].map(n => ({ ...cur, o: n.o, d: 0.2, v: 0.8, p: n.o === 0 ? 1 : 2, x }));
    });
  },
  pump: null,   // table level: see allocate()
};
const TARGET = {   // which layer a device rewrites
  fourFloor: (L) => L.part === 'kit', dembow: (L) => L.part === 'kit',
  gallop: (L, g) => L.g === g && (L.part === 'bass' || L.part === 'comp'),
  claveLock: (L, g) => L.g === g && L.part === 'comp', chipArp: (L, g) => L.g === g && L.part === 'comp', unison: (L, g) => L.g === g && L.part === 'comp',
  claveRim: (L) => L.part === 'tops' && L.onlyP === 3, drone: (L) => L.part === 'color', thirds: (L) => L.part === 'lead' && !L.dbl,
  distBass: (L) => L.part === 'bass', pump: () => false,
};
const DEVCACHE = new WeakMap();
// The events a layer plays in one bar: the genre's cached stem, rewritten by the hybrid's devices and patch swaps.
export function layerEvents(song, T, L, idx, beats, unit) {
  const base = song.stem(idx, beats, unit, L.g, L.part);
  const devs = T.dev.filter(d => DEVICES[d[0]] && TARGET[d[0]](L, d[1])), sw = T.swap && T.swap[L.g] && T.swap[L.g][L.part];
  if (!devs.length && !sw) return base;
  let C = DEVCACHE.get(song); if (!C) DEVCACHE.set(song, C = new Map());
  const key = [idx, beats, unit, song.variant || '', L.g, L.part, T.hybrid, T.own.bass, L.onlyP, L.dbl ? 1 : 0].join(':');
  let ev = C.get(key); if (ev) return ev;
  const f = song.frame(idx, beats, unit);
  ev = base.map(list => list.map(e => ({ ...e })));
  for (const d of devs) ev = DEVICES[d[0]](ev, f, L, T, song);
  for (const list of ev) { if (sw) for (const e of list) if (typeof e.n === 'number') e.i = sw; list.sort((p, q) => p.o - q.o); }
  C.set(key, ev); if (C.size > 500) { let n = 100; for (const k of C.keys()) { if (n-- <= 0) break; C.delete(k); } }
  return ev;
}
// A whole mixed bar as one event list (for tests and tools): events[beat] = [{ ...ev, part, g }]
export function renderBar(song, T, idx, beats, unit) {
  const f = song.frame(idx, beats, unit), events = Array.from({ length: beats }, () => []);
  for (const L of layersOf(T, f.rep)) {
    const ev = layerEvents(song, T, L, idx, beats, unit), maxP = L.onlyP == null ? 3 : L.onlyP;
    for (let b = 0; b < beats; b++) for (const e of ev[b]) if (e.p == null || e.p <= maxP || e.s) events[b].push({ ...e, n: L.oct && typeof e.n === 'number' ? e.n + L.oct : e.n, part: L.part, g: L.g, dbl: L.dbl });
  }
  return { frame: f, chord: f.chord, voicing: f.voicing, events, groups: f.groups, accents: f.accents, sec: f.sec, pos: f.pos };
}

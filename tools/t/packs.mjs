// Genre pack contract (spec section 3) and the "Riffs and groove" gates (spec section 9).
//   node tools/musictest.mjs packs          all eight packs
//   node tools/packcheck.mjs path/pack.js   one pack file (a draft does not have to be in GENRES)
// checkPack(pack, t, opts) is the contract; everything else in this file compares packs with each other.
import { Song, GENRES, MODES } from '../../src/music.js';
import { KIT_VOICES, TOPS_VOICES } from '../../src/genres/_lib.js';

export const PARTS = ['kit', 'tops', 'bass', 'comp', 'color'];
export const METERS = []; for (const unit of [4, 8]) for (let beats = 1; beats <= 8; beats++) METERS.push([beats, unit]);
export const GAME_METERS = [[3, 4], [4, 4], [5, 4], [6, 8]];
const LEADERS = Object.keys(GENRES);
const DRUMS = new Set([...KIT_VOICES, ...TOPS_VOICES]);
const ORN = ['mordent', 'trill', 'cut', 'glide', 'bend', 'flip', 'echo'];
const GRID4 = [0, 0.25, 0.5, 0.75], GRID8 = [0, 0.5];
const pcOf = (f, n) => (((n - f.tonic) % 12) + 12) % 12;
const rub = (a, b) => { const x = (((a - b) % 12) + 12) % 12; return x === 1 || x === 11; };
const tonesOf = e => (e.ns ? e.ns : e.x && e.x.arp ? e.x.arp.map(o => e.n + o) : [e.n]);
const flat = ev => { const out = []; ev.forEach((l, b) => l.forEach(e => out.push({ ...e, t: b + e.o, beat: b }))); return out; };
const sig = (ev, vel) => flat(ev).map(e => e.t + ':' + (typeof e.n === 'string' ? e.n : '') + (vel ? ':' + e.v : '')).join(' ');
export const songFor = (seed, variant) => { const s = new Song(seed, [[LEADERS[seed % LEADERS.length], 1]]); if (variant) s.setVariant(variant); return s; };

// The contract. Returns the number of failed checks. opts: { seeds (default 12), bars (default 16), where }
export function checkPack(pack, t, opts = {}) {
  const seeds = opts.seeds || 12, id = pack && pack.id, tag = (m, x) => `${id} ${m}${x ? ' @ ' + x : ''}`;
  let bad = 0; const ok = (cond, msg, at) => { if (!t.ok(cond, tag(msg, cond ? '' : at))) bad++; return cond; };

  // ----- shape
  ok(pack && typeof pack === 'object', 'default export is an object');
  if (!pack || typeof pack !== 'object') return bad + 1;
  ok(typeof pack.id === 'string' && typeof pack.name === 'string' && typeof pack.elem === 'string', 'id, name, elem are strings');
  ok(Array.isArray(pack.modes) && pack.modes.length > 0 && pack.modes.every(m => MODES[m]), 'modes are known modes');
  ok(pack.hook && ['kit', 'tops', 'bass', 'comp', 'lead'].every(k => pack.hook[k] >= 0.6 && pack.hook[k] <= 2.2), 'hook.{kit,tops,bass,comp,lead} within 0.6..2.2');
  ok(!pack.excl || (pack.excl.take > 0 && pack.excl.take <= 1 && pack.excl.keep > 0 && pack.excl.keep <= pack.excl.take), 'excl = { take, keep } with keep <= take');
  ok(pack.swing === 0.5 || Math.abs(pack.swing - 2 / 3) < 1e-9, 'swing is 0.5 or 2/3');
  ok(pack.pump >= 0 && pack.pump <= 0.55, 'pump within 0..0.55');
  ok(typeof pack.drumKit === 'string' && DRUMS.has(pack.fillVoice), 'drumKit is a name, fillVoice a drum');
  ok(pack.inst && Array.isArray(pack.inst.lead) && pack.inst.lead.length === 2 && pack.inst.lead.every(x => typeof x === 'string') && ['bass', 'comp', 'color'].every(k => typeof pack.inst[k] === 'string'), 'inst = { lead: [a, b], bass, comp, color }');
  const d = pack.dialect || {};
  ok(d.fill >= 0 && d.fill <= 1 && d.thin >= 0 && d.thin <= 1 && d.push >= 0 && d.push <= 1 && d.art >= 0.2 && d.art <= 1 && typeof d.penta === 'boolean' && Array.isArray(d.orn) && d.orn.every(o => ORN.includes(o)), 'dialect = { fill, thin, push, art, penta, orn }');
  ok(typeof pack.spice === 'string' && pack.spice.length > 0 && pack.spice.length <= 24, 'spice is a short phrase');
  for (const p of PARTS) ok(typeof pack[p] === 'function', p + '() exists');
  ok(pack.lead === undefined, 'no lead(): the engine writes the lead from the theme');
  if (bad) return bad;

  // ----- every generator, every meter
  const fails = new Map(), note = (cond, msg, at) => { if (!cond) { const f = fails.get(msg); if (f) f.n++; else fails.set(msg, { n: 1, at }); } return cond; };
  let stems = 0;
  for (let seed = 1; seed <= seeds; seed++) for (const variant of seed % 4 === 0 ? [null, 'boss'] : [null]) {
    const song = songFor(seed, variant);
    for (const [beats, unit] of METERS) {
      const grid = unit === 4 ? GRID4 : GRID8, perBeat = unit === 4 ? 4 : 2, where0 = `seed ${seed}${variant ? ' boss' : ''} ${beats}/${unit}`;
      const all = {};
      for (const part of PARTS) {
        all[part] = [];
        for (let idx = 0; idx < 16; idx++) {
          const where = `${where0} bar ${idx} ${part}`, f = song.frame(idx, beats, unit);
          let ev, again;
          try { ev = song.render(idx, beats, unit, pack, part); again = song.render(idx, beats, unit, pack, part); }
          catch (e) { note(false, part + ': generator threw ' + (e && e.message), where); all[part].push(null); continue; }
          all[part].push(ev); stems++;
          note(JSON.stringify(ev) === JSON.stringify(again), part + ': deterministic from c alone', where);
          if (!note(Array.isArray(ev) && ev.length === beats && ev.every(Array.isArray), part + ': returns `beats` lists', where)) continue;
          const evs = flat(ev);
          for (let b = 0; b < beats; b++) {
            const L = ev[b];
            for (let k = 0; k < L.length; k++) {
              const e = L[k], pitched = typeof e.n === 'number';
              note(grid.includes(e.o), part + ': offsets on the grid (0 .25 .5 .75; in /8 only 0 .5)', where + ` o=${e.o}`);
              note(k === 0 || L[k - 1].o <= e.o, part + ': each beat sorted by o', where);
              note(e.v > 0 && e.v <= 1, part + ': 0 < v <= 1', where + ` v=${e.v}`);
              note(Number.isInteger(e.p) && e.p >= 0 && e.p <= 3, part + ': p is 0..3', where);
              if (pitched) {
                note(Number.isInteger(e.n) && e.d > 0, part + ': pitched events have an integer n and d > 0', where);
                note(b + e.o + e.d <= beats + 1e-9, part + ': nothing sounds past the bar end', where + ` beat ${b} o ${e.o} d ${e.d}`);
                if (e.ns) note(Array.isArray(e.ns) && e.ns.length >= 2 && e.ns.length <= 4 && e.ns[0] === e.n && e.ns.every((x, i) => Number.isInteger(x) && (i === 0 || x > e.ns[i - 1])), part + ': ns is 2..4 ascending integers with n === ns[0]', where);
                note(typeof e.i === 'string', part + ': pitched events carry a patch', where);
                if (e.x !== undefined) note(e.x && typeof e.x === 'object' && (e.x.bus === 'dist' || e.x.pad === 1 || (Array.isArray(e.x.arp) && e.x.arp.length >= 2 && e.x.arp.length <= 8 && e.x.arp[0] === 0 && e.x.arp.every(Number.isInteger) && !e.ns)), part + ': x is { bus: \'dist\' }, { pad: 1 } or { arp: [0, ...semitone steps from n] } on a single note', where);
              } else note(DRUMS.has(e.n) && e.d === 0, part + ': drum events use the drum vocabulary and d = 0', where + ` n=${e.n}`);
            }
          }
          const at0 = ev[0].filter(e => e.o === 0);
          if (part === 'kit') {
            note(evs.every(e => KIT_VOICES.includes(e.n)), 'kit: only kit voices', where);
            note(at0.some(e => e.p === 0 && ['kick', 'timp', 'tom3'].includes(e.n)), 'kit: a p0 kick, timp or tom3 at beat 0, o 0', where);
            note(evs.every(e => !(e.o === 0 && f.backbone[e.beat] === 'S' && (e.n === 'snare' || e.n === 'clap')) || e.p === 0), 'kit: backbeats are p0', where);
            note(ev.every(L => L.length <= perBeat), 'kit: at most 4 hits per beat (2 in /8)', where);
          } else if (part === 'tops') {
            note(evs.every(e => TOPS_VOICES.includes(e.n) || e.n === 'rim'), 'tops: only tops voices (and rim for a clave)', where);
            note(f.accents.every(a => ev[a].length > 0), 'tops: something on every accent beat', where);
            note(evs.every(e => e.p === (e.o === 0 ? 1 : e.o === 0.5 ? 2 : 3)), 'tops: o 0 is p1, o .5 is p2, o .25/.75 are p3', where);
            note(evs.every(e => e.n !== 'crash' || (f.pos === 0 && e.beat === 0)), 'tops: crash only at pos 0, beat 0', where);
            note(ev.every(L => L.length <= perBeat), 'tops: at most 4 per beat (2 in /8)', where);
          } else if (part === 'bass') {
            note(evs.every(e => typeof e.n === 'number' && !e.ns), 'bass: single pitched notes only', where);
            note(evs.every(e => e.n >= 36 && e.n <= 59), 'bass: pitches 36..59', where + ' ' + evs.map(e => e.n).join(','));
            note(evs.every((e, k) => k === evs.length - 1 || e.t + e.d <= evs[k + 1].t + 1e-9), 'bass: monophonic (each note ends by the next onset)', where);
            note(at0.length > 0 && at0[0].n === f.bassRoot && at0[0].p === 0, 'bass: beat 0, o 0 is c.bassRoot at p0', where);
            const out = evs.filter(e => !f.chord.scale.includes(pcOf(f, e.n)));
            note(out.length <= 1 && out.every(e => e.beat === beats - 1 && e.d <= 0.5 + 1e-9 && rub(e.n, f.nextBassRoot)), 'bass: in scale, except one approach note (last beat, d <= .5, a semitone from the next root)', where);
            note(ev.every(L => L.length <= 4), 'bass: at most 4 notes per beat', where);
          } else if (part === 'comp') {
            const fifthPc = f.chord.pcs[2], okPc = new Set([...f.chord.pcs, f.chord.sev]); if (f.chord.scale.includes((f.chord.root + 2) % 12)) okPc.add((f.chord.root + 2) % 12);
            for (const e of evs) {
              if (typeof e.n !== 'number') { note(false, 'comp: pitched events only', where); continue; }
              const ts = tonesOf(e), dist = e.x && e.x.bus === 'dist';
              if (dist) { note(ts.every(n => n >= 40 && n <= 64), 'comp: power chords within 40..64', where + ' ' + ts); note(ts.every(n => pcOf(f, n) === f.chord.root || pcOf(f, n) === fifthPc), 'comp: power chords are root, fifth and octave only', where + ' ' + ts); }
              else note(ts.every(n => n >= 48 && n <= 79), 'comp: pitches within 48..79', where + ' ' + ts);
              note(ts.every(n => okPc.has(pcOf(f, n))), 'comp: pitch classes from the triad, the seventh, or the ninth when it is in the scale', where + ' ' + ts);
              // "a beat or longer" is counted as two pulses or more, so /8 is judged like /4
              for (const l of f.theme) if (l.d * f.ppb >= 2 - 1e-9 && l.beat + l.o < e.t + e.d - 1e-9 && l.beat + l.o + l.d > e.t + 1e-9) note(ts.every(n => !rub(n, l.n)), 'comp: no tone a semitone from a long lead note that sounds with it', where + ` comp ${ts} lead ${l.n}`);
            }
            note(ev.every(L => L.length <= 4), 'comp: at most 4 events per beat', where);
            note(at0.length > 0, 'comp: something sounds on beat 0', where);
          } else {
            note(evs.every(e => e.p === 2 || e.p === 3), 'color: every event is p2 or p3', where);
            for (const e of evs) {
              if (typeof e.n !== 'number') { note(TOPS_VOICES.includes(e.n), 'color: unpitched colour uses the tops voices', where + ' ' + e.n); continue; }
              const ts = tonesOf(e);
              note(ts.every(n => n >= 48 && n <= 88), 'color: pitches within 48..88', where + ' ' + ts);
              note(ts.every(n => f.chord.scale.includes(pcOf(f, n))), 'color: in the bar\'s scale', where + ' ' + ts);
              if (e.d >= 1 - 1e-9) note(ts.every(n => f.chord.pcs.includes(pcOf(f, n))), 'color: notes of a beat or longer are chord tones', where + ' ' + ts);
            }
            const pit = evs.filter(e => typeof e.n === 'number');
            note(pit.every(e => pit.reduce((s, x) => s + (x.t <= e.t + 1e-9 && x.t + x.d > e.t + 1e-9 ? tonesOf(x).length : 0), 0) <= 2), 'color: at most 2 voices at once', where);
          }
          if (beats <= 2 && part !== 'color') note(ev[0].some(e => e.o === 0), part + ': short bars keep the beat-0 event', where);
        }
      }
      // ----- across the bars of a phrase
      for (let ph = 0; ph < 4; ph++) {
        const i0 = ph * 4, where = `${where0} phrase ${ph}`, K = all.kit, B = all.bass;
        if (K[i0] && K[i0 + 2]) note(sig(K[i0]) === sig(K[i0 + 2]), 'kit: the rhythm of pos 0-2 comes from c.riff (pos 0 and pos 2 are the same pattern)', where);
        if (K[i0 + 1] && K[i0 + 3]) {
          const la = song.frame(i0, beats, unit).lastAcc, head = ev => sig(ev.slice(0, la));
          note(head(K[i0 + 1]) === head(K[i0 + 3]), 'kit: a fill only touches beats >= lastAcc of pos 3', where);
        }
        if (B[i0] && B[i0 + 1] && B[i0 + 2]) note(sig(B[i0]) === sig(B[i0 + 1]) && sig(B[i0]) === sig(B[i0 + 2]), 'bass: the onset pattern is identical in pos 0, 1 and 2 (riff identity)', where);
      }
    }
  }
  // ----- against the tune as the eight dialects actually play it (the pack only sees the neutral theme)
  let shared = 0, above = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const song = songFor(seed);
    for (const [beats, unit] of GAME_METERS) for (let idx = 0; idx < 16; idx++) {
      let comp; try { comp = flat(song.render(idx, beats, unit, pack, 'comp')); } catch (e) { continue; }
      const f = song.frame(idx, beats, unit), mine = flat(song.render(idx, beats, unit, pack, 'lead'));
      for (const lead of [mine, ...LEADERS.map(g => flat(song.stem(idx, beats, unit, g, 'lead')))]) for (const l of lead) for (const e of comp) {
        if (typeof e.n !== 'number') continue;
        if (l.d * f.ppb >= 2 - 1e-9 && e.t < l.t + l.d - 1e-9 && e.t + e.d > l.t + 1e-9) note(tonesOf(e).every(n => !rub(n, l.n)), 'comp: no tone a semitone from a lead note of two pulses or longer, in any dialect (guard sevenths and ninths with clear())', `seed ${seed} ${beats}/${unit} bar ${idx}: comp ${tonesOf(e)} lead ${l.n}`);
        if (Math.abs(e.t - l.t) < 1e-9 && !(e.x && e.x.bus === 'dist')) { shared++; if (l.n > Math.max(...tonesOf(e))) above++; }
      }
    }
  }
  for (const [msg, f] of fails) { ok(false, `${msg}  [${f.n} cases, first: ${f.at}]`); }
  if (shared) ok(above / shared >= 0.85, `comp: the lead is above the top comp note on >= 85% of shared onsets (${(100 * above / shared).toFixed(1)}%)`);
  ok(true, `${stems} stems checked`);
  return bad;
}

// ----- groove measurements shared with the report below
// Drum fingerprint of one bar: the loudest hit per sixteenth in three lanes (low, mid, high).
const LANE = { kick: 0, tom3: 0, timp: 0, tom2: 0, snare: 1, clap: 1, rim: 1, tom1: 1, cow: 1, hat: 2, ohat: 2, ride: 2, shaker: 2, tamb: 2, pedal: 2, crash: 2, brush: 2 };
export function drumPrint(song, pack, idx, beats, unit) {
  const v = new Float64Array(3 * beats * 4);
  for (const part of ['kit', 'tops']) song.render(idx, beats, unit, pack, part).forEach((L, b) => { for (const e of L) { const k = LANE[e.n] * beats * 4 + b * 4 + Math.round(e.o * 4); if (e.v > v[k]) v[k] = e.v; } });
  return v;
}
const cosd = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return x && y ? 1 - d / Math.sqrt(x * y) : 1; };

// centroids of the drum fingerprints of a list of packs in one meter, over training seeds
export function drumCentroids(packs, beats, unit, from = 1, to = 24) {
  const cen = packs.map(() => new Float64Array(3 * beats * 4)); let n = 0;
  for (let seed = from; seed <= to; seed++) { const song = songFor(seed); for (let idx = 0; idx < 16; idx++) { packs.forEach((p, g) => { const v = drumPrint(song, p, idx, beats, unit); for (let i = 0; i < v.length; i++) cen[g][i] += v[i]; }); n++; } }
  cen.forEach(c => { for (let i = 0; i < c.length; i++) c[i] /= n; });
  return cen;
}
// The "Riffs and groove" gates for a set of packs (the eight, or seven plus a draft). Returns failures.
export function checkGroove(packs, t, opts = {}) {
  let bad = 0; const ok = (c, m) => { if (!t.ok(c, m)) bad++; return c; }, only = opts.only;
  // kick against bass: funk, metal and synthwave lock the kick to the bass line
  for (const pack of packs) if (['funk', 'metal', 'synthwave'].includes(pack.id) && (!only || pack.id === only)) for (const [beats, unit] of GAME_METERS) {
    let hit = 0, tot = 0;
    for (let seed = 1; seed <= 12; seed++) { const song = songFor(seed); for (let idx = 0; idx < 16; idx++) { const on = new Set(flat(song.render(idx, beats, unit, pack, 'bass')).map(e => e.t)); for (const e of flat(song.render(idx, beats, unit, pack, 'kit'))) if (e.n === 'kick') { tot++; if (on.has(e.t)) hit++; } } }
    ok(tot > 0 && hit / tot >= 0.8, `${pack.id} ${beats}/${unit}: at least 80% of kicks land on a bass onset (${hit}/${tot})`);
  }
  // a riff repeats inside a song and differs between songs
  for (const pack of packs) if (!only || pack.id === only) {
    const riffs = new Set(), kits = new Set(); let back = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const song = songFor(seed), f = song.frame(0, 4, 4);
      const rel = part => flat(song.render(0, 4, 4, pack, part)).map(e => e.t + ':' + (typeof e.n === 'number' ? tonesOf(e).map(n => n - f.bassRoot).join('+') : e.n)).join(' ');
      riffs.add(PARTS.map(rel).join(' | ')); kits.add(rel('kit') + rel('tops'));
      if (sig(song.render(0, 4, 4, pack, 'kit')) === sig(song.render(8, 4, 4, pack, 'kit'))) back++;
    }
    ok(back === 12, `${pack.id}: the kit pattern of bar 0 returns in bar 8 in every song (${back}/12)`);
    ok(riffs.size >= 6, `${pack.id}: the band's bar-0 pattern differs between songs (${riffs.size} distinct in 12 seeds, want >= 6)`);
    t.report(`${pack.id} distinct bar-0 arrangements / drum patterns in 12 songs`, riffs.size + ' / ' + kits.size);
  }
  // the kits are rhythmically distinct: nearest-centroid classification of single bars, drums only
  let worstAcc = 1, worstDist = 9, worstPair = '';
  for (const [beats, unit] of GAME_METERS) {
    const cen = drumCentroids(packs, beats, unit);
    let hit = 0, tot = 0;
    for (let seed = 101; seed <= 124; seed++) { const song = songFor(seed); packs.forEach((p, g) => { if (only && p.id !== only) return; for (let idx = 0; idx < 16; idx++) { const v = drumPrint(song, p, idx, beats, unit); let best = 0, bd = 9; cen.forEach((c, k) => { const d = cosd(v, c); if (d < bd) { bd = d; best = k; } }); tot++; if (best === g) hit++; } }); }
    let md = 9, pair = '';
    for (let a = 0; a < packs.length; a++) for (let b = a + 1; b < packs.length; b++) { if (only && packs[a].id !== only && packs[b].id !== only) continue; const d = cosd(cen[a], cen[b]); if (d < md) { md = d; pair = packs[a].id + '/' + packs[b].id; } }
    ok(hit / tot >= 0.95, `${beats}/${unit}: drums-only nearest-centroid genre classification >= 95% on held-out seeds (${(100 * hit / tot).toFixed(1)}%)`);
    ok(md >= 0.15, `${beats}/${unit}: kit centroid distance >= 0.15 between any two genres (closest ${pair} ${md.toFixed(3)})`);
    t.report(`${beats}/${unit} drum classification / closest pair`, `${(100 * hit / tot).toFixed(1)}% / ${pair} ${md.toFixed(3)}`);
    if (hit / tot < worstAcc) worstAcc = hit / tot; if (md < worstDist) { worstDist = md; worstPair = pair + ' ' + beats + '/' + unit; }
  }
  t.report('worst drum classification accuracy', worstAcc); t.report('smallest kit centroid distance (' + worstPair + ')', worstDist);
  return bad;
}

// ----- required content: detectors taken from the spec's table, one set per genre. A pack that is rewritten
// must still be the genre the table describes; anything the table does not say is the author's.
function detect(id, t) {
  const T = new Map(), R = {};
  const no = (cond, msg, at) => { let f = T.get(msg); if (!f) T.set(msg, f = { n: 0, bad: 0, at: null }); f.n++; if (!cond) { f.bad++; if (!f.at) f.at = at; } };
  const rate = (name, cond) => { const r = R[name] || (R[name] = [0, 0]); r[1]++; if (cond) r[0]++; };
  for (let seed = 1; seed <= 8; seed++) {
    const song = songFor(seed);
    for (const [beats, unit] of GAME_METERS) {
      const u4 = unit === 4, N = beats * (u4 ? 2 : 1), pat = {}, same = (key, val, at) => { if (pat[key] === undefined) pat[key] = val; no(pat[key] === val, key + ' is the same in every bar of the song', at); };
      for (let idx = 0; idx < 16; idx++) {
        const f = song.frame(idx, beats, unit), at = `seed ${seed} ${beats}/${unit} bar ${idx}`, fill = f.pos === 3 && beats > 1;
        const S = {}; for (const p of PARTS) S[p] = flat(song.stem(idx, beats, unit, id, p));
        const { kit, tops, bass, comp, color } = S, pl = e => e.t * f.ppb, pc = n => pcOf(f, n), fifthPc = f.chord.pcs[2], rootPc = f.chord.root;
        const has = (L, n, beat, o = 0) => L.some(e => e.n === n && e.beat === beat && e.o === o), only = (L, names) => L.every(e => names.includes(e.n));
        const patch = (L, i) => L.every(e => typeof e.n !== 'number' || e.i === i), backs = []; for (let i = 0; i < beats; i++) if (f.backbone[i] === 'S') backs.push(i);
        const ixs = L => L.map(e => [f.voicing[0], f.voicing[1], f.voicing[2], f.voicing[0] + 12].indexOf(e.n)).join('');
        const nextPc = f.next.root, dist12 = (a, b) => { const x = (((a - b) % 12) + 12) % 12; return Math.min(x, 12 - x); };
        if (id === 'baroque') {
          no(only(kit, ['timp']) && kit[0].t === 0 && kit[0].v === (f.pos === 0 ? 0.9 : 0.5), 'kit is a timpani on the bar head (0.9 at phrase heads, 0.5 otherwise), no kick or snare', at);
          if (fill) no(kit.length >= 3, 'a timpani roll in the fill', at);
          no(only(tops, ['tamb']) && backs.every(b => has(tops, 'tamb', b)), 'tambourine on the backbeats', at);
          no(patch(bass, 'organbass') && f.accents.every(a => bass.some(e => e.t === a && pc(e.n) === rootPc)), 'continuo on organbass with the root on every group head', at);
          rate('baroque bass: onsets per pulse', bass.length / N >= 0.85); for (let k = 1; k < bass.length; k++) rate('baroque bass: stepwise motion', Math.abs(bass[k].n - bass[k - 1].n) <= 3);
          no(patch(comp, 'harpsi') && comp.every(e => !e.ns) && (!u4 || comp.length === 2 * beats), 'harpsichord figuration: single notes, two per beat', at);
          same('baroque figuration index pattern', ixs(comp), at);
          no(patch(color, 'organ') && color.length === f.groups.length && color.every((e, k) => e.t === f.accents[k] && e.x && e.x.pad), 'organ pad, one per group', at);
        } else if (id === 'metal') {
          no(backs.every(b => fill && b === beats - 1 ? true : kit.some(e => e.n === 'snare' && e.beat === b && e.o === 0 && e.p === 0)), 'snare on the backbeats', at);
          no(kit.every(e => e.n !== 'kick' || (e.o !== 0.25 && e.o !== 0.75) || e.p === 3), 'sixteenth double kick only at p3', at);
          no(only(tops, ['hat', 'ride', 'crash']) && (!u4 || [...Array(beats).keys()].every(b => tops.some(e => e.beat === b && e.o === 0) && tops.some(e => e.beat === b && e.o === 0.5))) && (f.pos !== 0 || has(tops, 'crash', 0)), 'hat or ride eighths, crash at phrase heads', at);
          no(patch(bass, 'synbass') && new Set(bass.filter(e => Number.isInteger(pl(e))).map(pl)).size === N && bass.slice(0, -1).every(e => e.n === f.bassRoot), 'synbass root chug on every pulse', at);
          no(bass.every(e => !f.clave.includes(pl(e)) || e === bass[bass.length - 1] || e.v >= 0.9), 'bass accents on the clave', at);
          no(comp.every(e => e.x && e.x.bus === 'dist') && comp.every(e => (e.ns ? (pl(e) === 0 || f.clave.includes(pl(e))) && e.p === 1 : e.p >= 2 && e.n === comp[0].n)) && f.clave.every(p => comp.some(e => e.ns && pl(e) === p)), 'dist power chords on the clave hits (p1), root chug elsewhere (p2)', at);
          no(color.every(e => e.x && e.x.bus === 'dist') && f.accents.every(a => color.some(e => e.t === a)), 'colour: power chugs on the accents', at);
        } else if (id === 'jazz') {
          no(kit.every(e => e.n !== 'kick' || (e.v <= 0.35 && e.o === 0 && f.accents.includes(e.beat))) && kit.every(e => e.n !== 'snare' || e.p === 2), 'feathered kick on the group heads, snare drops at p2', at);
          if (!fill) no(kit.every(e => e.n !== 'snare' || f.clave.includes(pl(e))), 'snare drops only on clave hits', at);
          no([...Array(beats).keys()].every(b => has(tops, 'ride', b)) && tops.filter(e => e.n === 'pedal').every(e => e.o === 0 && 'Ss'.includes(f.backbone[e.beat])) && backs.every(b => has(tops, 'pedal', b)), 'ride on every beat, pedal hat on the backbeats', at);
          if (u4) rate('jazz ride: bars with an off-beat skip note', tops.some(e => e.n === 'ride' && e.o === 0.5));
          const nxt = flat(song.stem(idx + 1, beats, unit, id, 'bass'))[0], last = bass[bass.length - 1];
          no(patch(bass, 'finger') && bass[0].n === f.bassRoot && bass.every((e, k) => !k || e.n !== bass[k - 1].n) && pc(nxt.n) !== pc(last.n), 'walking bass: root on one, no repeated pitch', at);
          if (bass.length > 1) no(dist12(pc(last.n), nextPc) >= 1 && dist12(pc(last.n), nextPc) <= 2, 'walking bass: an approach note into the next root on the last beat', at);
          for (let k = 1; k < bass.length; k++) rate('jazz bass: stepwise motion', Math.abs(bass[k].n - bass[k - 1].n) <= 2);
          no(patch(comp, 'epiano') && comp.every(e => tonesOf(e).every(n => pc(n) !== rootPc)) && comp.some(e => pl(e) === 0) && (N <= 3 || comp.some(e => pl(e) === 3)), 'rootless epiano shells on pulses 0 and 3', at);
          no(patch(color, 'vibes') && color.length === f.groups.length && color.every((e, k) => e.t === f.accents[k] && !e.ns && pc(e.n) !== rootPc), 'vibes guide tones, one per group', at);
        } else if (id === 'funk') {
          const sn = backs.length || beats < 3 ? backs : [beats - 1];
          no(kit.some(e => e.n === 'kick' && e.t === 0 && e.p === 0) && sn.every(b => kit.some(e => e.n === 'snare' && e.beat === b && e.o === 0)) && kit.every(e => e.n !== 'snare' || e.o === 0 || (e.p === 3 && e.v <= 0.3)), 'kick on the one, backbeat snare, ghost snares at p3', at);
          if (u4) no([...Array(beats).keys()].every(b => tops.filter(e => e.beat === b).length >= 3 && tops.some(e => e.beat === b && e.o === 0.25)), 'sixteenth hats', at);
          no(tops.filter(e => e.n === 'ohat').every(e => sn.includes(e.beat + 1) && pl(e) === (e.beat + 1) * f.ppb - 1) && sn.every(b => b === 0 || tops.some(e => e.n === 'ohat' && pl(e) === b * f.ppb - 1)), 'the hat opens on the pulse before each snare, and only there', at);
          no(patch(bass, 'slap') && bass[0].n === f.bassRoot && bass[0].d >= (u4 ? 0.6 : 1.2) && (beats < 3 || !bass.some(e => e.beat === 1)), 'slap riff: a long root on one, then nothing through beat two', at);
          if (beats >= 3) no(bass.length >= 3 && bass[bass.length - 1].n === f.bassRoot + 12 && [1, 2, 3].includes(f.bassRoot + 12 - bass[bass.length - 2].n), 'slap riff: the seventh falls back to the root at the end', at);
          no(bass.every(e => e.n !== f.bassRoot + 12 || !Number.isInteger(pl(e)) || e.t >= beats - 1 || f.claves[0].includes(pl(e))), 'slap riff: octave pops sit on the clave', at);
          if (f.pos < 3) same('funk riff (onsets, and root / octave / seventh at each)', bass.map(e => e.t + (e.n === f.bassRoot ? 'R' : e.n === f.bassRoot + 12 ? 'O' : '7')).join(' '), at);
          no(patch(comp, 'epiano') && comp.every(e => e.d <= 0.3 + 1e-9 && (pl(e) === 0 || f.clave.includes(pl(e)))) && f.clave.every(p => comp.some(e => pl(e) === p)), 'short stabs on the clave hits', at);
          rate('funk stabs that carry a seventh or ninth', comp.some(e => tonesOf(e).some(n => !f.chord.pcs.includes(pc(n)))));
          no(patch(color, 'clav') && color.every(e => e.d <= 0.15), 'clav scratches are short', at); if (u4) rate('funk colour: bars with scratches on the sixteenths', color.some(e => e.o === 0.25 || e.o === 0.75));
        } else if (id === 'synthwave') {
          no([...Array(beats).keys()].every(b => (u4 || f.accents.includes(b) ? has(kit, 'kick', b) : true)) && backs.every(b => kit.some(e => e.n === 'clap' && e.beat === b && e.o === 0 && e.p === 0)), 'kick on every beat (every group head in /8), clap on the backbeats', at);
          no(kit.every(e => !e.n.startsWith('tom') || fill), 'toms only in the fill', at);
          no([...Array(beats).keys()].every(b => tops.some(e => e.beat === b && e.o === 0 && (e.n === 'hat' || e.n === 'ohat'))) && (!u4 || ([...Array(beats).keys()].every(b => has(tops, 'ohat', b, 0.5)) && tops.every(e => e.n !== 'ohat' || e.o === 0.5))), 'closed hat on the beat, open hat on the off-beat', at);
          no(patch(bass, 'synbass') && new Set(bass.map(pl)).size === N && bass.every(e => e.n === f.bassRoot || (e.n === f.bassRoot + 12 && f.clave.includes(pl(e)))), 'root ostinato on every pulse, the octave only on clave hits', at);
          no(patch(comp, 'strings') && comp.length === f.groups.length && comp.every((e, k) => e.t === f.accents[k] && e.x && e.x.pad && e.d >= 0.9 * f.groups[k]), 'a pad per group', at);
          no(patch(color, 'pluck'), 'pluck arpeggio', at); same('synthwave arp shape', ixs(color), at);
        } else if (id === 'celtic') {
          no(only(kit, ['tom2', 'tom3']) && [...Array(beats).keys()].every(b => (fill && b === beats - 1) || has(kit, f.accents.includes(b) ? 'tom3' : 'tom2', b)), 'bodhran: tom3 on the accents, tom2 elsewhere, no kick or snare', at);
          no(only(tops, ['tamb', 'shaker']) && backs.every(b => has(tops, 'tamb', b)), 'tambourine on the backbeats', at);
          no(patch(bass, 'finger') && f.accents.every(a => bass.some(e => e.t === a && [rootPc, fifthPc].includes(pc(e.n)))), 'bass: root or fifth on every group head', at);
          for (const e of bass) rate('celtic bass: roots and fifths', [rootPc, fifthPc].includes(pc(e.n)));
          no(patch(comp, 'nylon') && f.accents.every(a => comp.some(e => e.t === a)) && comp.every(e => tonesOf(e).every(n => [rootPc, fifthPc].includes(pc(n)))), 'nylon strum per group, voiced root, fifth, octave', at);
          no(patch(color, 'fiddle') && color.length === f.groups.length && color.every((e, k) => e.t === f.accents[k] && tonesOf(e).every(n => [rootPc, fifthPc].includes(pc(n)))), 'fiddle drone: root and fifth, re-bowed per group', at);
        } else if (id === 'chiprock') {
          if (!fill) no([...Array(beats).keys()].every(b => (f.backbone[b] !== 'K' || has(kit, 'kick', b)) && (f.backbone[b] !== 'S' || has(kit, 'snare', b))), 'rock backbone: kick on K, snare on S', at);
          else { const roll = kit.filter(e => e.n === 'snare' && e.beat === beats - 1); no(roll.length >= (u4 ? 4 : 2) && roll.every((e, k) => !k || e.v > roll[k - 1].v), 'fill: a snare roll with rising velocity', at); }
          no(only(tops, ['hat', 'crash']) && (!u4 || [...Array(beats).keys()].every(b => has(tops, 'hat', b) && has(tops, 'hat', b, 0.5))), 'hat eighths', at);
          const run = N >= 6 ? 3 : N >= 4 ? 2 : 1, body = bass.slice(0, bass.length - run);
          no(patch(bass, 'synbass') && new Set(bass.map(pl)).size === N && body.every(e => e.n === f.bassRoot || e.n === f.bassRoot + 12), 'synbass root and octave on the eighths', at);
          for (let k = 1; k < body.length; k++) rate('chiprock bass: root/octave alternation', body[k].n !== body[k - 1].n);
          if (N >= 6) { const r3 = bass.slice(-3).map(e => e.n); no(Math.sign(r3[1] - r3[0]) === Math.sign(r3[2] - r3[1]) && r3[1] !== r3[0] && Math.abs(r3[1] - r3[0]) <= 3 && Math.abs(r3[2] - r3[1]) <= 3 && dist12(pc(r3[2]), nextPc) <= 3, 'a three-step run into the next root', at + ' ' + r3 + ' next pc ' + nextPc); }
          no(comp.length === beats && comp.every((e, b) => e.t === b && !e.ns && e.i === 'pulse25' && e.x && Array.isArray(e.x.arp) && e.x.arp.length >= 3), 'comp is one arpeggiating pulse25 voice per beat, never a struck chord', at);
          same('chiprock arp order (as chord-tone ranks)', comp[0].x.arp.map(o => [...new Set(comp[0].x.arp)].sort((a, b) => a - b).indexOf(o)).join('') + ':' + new Set(comp[0].x.arp).size, at);
          no(patch(color, 'pluck') && color.every(e => (!u4 || e.o === 0.5) && pc(e.n) === pc(color[0].n)), 'pluck octave blips on the off-beats', at);
        } else if (id === 'latin') {
          no(kit.filter(e => e.n === 'kick').length === 1 && kit[0].n === 'kick' && kit[0].t === 0 && !kit.some(e => e.n === 'snare' || e.n === 'clap'), 'kick on the bar head only, no snare', at);
          if (u4 && beats >= 2) no(has(kit, 'tom1', 1), 'conga (tom1) on beat two', at);
          if (!fill && N >= 4) no(kit.some(e => e.n === 'tom2' && pl(e) === N - 1) && kit.some(e => e.n === 'tom2' && pl(e) === N - 2), 'low conga (tom2) on the last two pulses', at);
          no((!u4 || new Set(tops.filter(e => e.n === 'shaker').map(pl)).size === N) && f.accents.every(a => has(tops, 'cow', a) || tops.filter(e => e.beat === a).length >= 2), 'shaker eighths, cowbell on the accents', at);
          no(JSON.stringify(tops.filter(e => e.n === 'rim').map(pl)) === JSON.stringify([...f.clave]), 'the rim plays the clave exactly', at + ' ' + tops.filter(e => e.n === 'rim').map(pl) + ' vs ' + f.clave);
          const lastN = bass[bass.length - 1];
          no(patch(bass, 'finger') && bass[0].n === f.bassRoot && (N < 6 || bass.some(e => pl(e) === 3 && pc(e.n) === fifthPc)), 'tumbao: root on one, fifth on pulse 3', at);
          if (N >= 4) no(pl(lastN) === N - 1 && lastN.d <= 0.5 + 1e-9 && (pc(lastN.n) === nextPc || (!f.chord.scale.includes(nextPc) && pc(lastN.n) === rootPc)), 'tumbao: the next root on the last pulse, inside the bar', at);
          no(patch(comp, 'nylon') && JSON.stringify([...new Set([0, ...f.clave])].sort((a, b) => a - b)) === JSON.stringify(comp.map(pl)), 'montuno on the clave pulses', at);
          no(color.length > 0 && color.every(e => e.n === 'cow' || e.n === 'shaker'), 'colour is unpitched: cowbell and shaker', at);
        }
      }
    }
  }
  for (const [msg, f] of T) t.ok(f.bad === 0, `${id}: ${msg} (${f.n - f.bad}/${f.n}${f.bad ? ', first: ' + f.at : ''})`);
  const MIN = { 'baroque bass: onsets per pulse': 0.85, 'baroque bass: stepwise motion': 0.7, 'jazz bass: stepwise motion': 0.7, 'jazz ride: bars with an off-beat skip note': 0.9, 'celtic bass: roots and fifths': 0.85, 'chiprock bass: root/octave alternation': 0.8, 'funk colour: bars with scratches on the sixteenths': 0.5 };
  for (const k in R) { const v = R[k][0] / R[k][1]; if (MIN[k] !== undefined) t.ok(v >= MIN[k], `${k} >= ${MIN[k]} (${v.toFixed(3)})`); t.report(k, v); }
}

export default async function (t) {
  const ids = Object.keys(GENRES), packs = ids.map(id => GENRES[id]);
  t.section('contract: 8 packs x beats 1..8 x unit 4 and 8 x 16 bars x 12 seeds (every 4th seed also as the boss variant)');
  t.eq(ids.length, 8, 'eight packs');
  for (const id of ids) { t.eq(GENRES[id].id, id, 'pack id matches its key ' + id); checkPack(GENRES[id], t, { seeds: 12 }); }
  t.ok(new Set(packs.map(p => p.elem)).size === 8, 'every pack has its own element');
  // the lead dialect table of spec section 3, and the fields the allocator reads
  const TABLE = { baroque: [0.9, 0, 0, 0.9, false, ['mordent', 'trill']], celtic: [1, 0, 0, 0.85, true, ['cut']], jazz: [0.5, 0, 0.35, 0.8, false, []], funk: [0, 0.3, 0.4, 0.45, true, []], synthwave: [0, 0.7, 0.15, 1, false, ['glide']], metal: [0.3, 0, 0.2, 1, false, ['bend']], chiprock: [0.5, 0, 0.1, 0.7, false, ['echo', 'flip']], latin: [0.4, 0, 0.5, 0.7, false, []] };
  for (const id of ids) { const d = GENRES[id].dialect, w = TABLE[id]; t.ok(d.fill === w[0] && d.thin === w[1] && d.push === w[2] && d.art === w[3] && d.penta === w[4] && JSON.stringify(d.orn.slice().sort()) === JSON.stringify(w[5]), `${id}: dialect parameters match the spec's table`); }
  t.ok(GENRES.latin.excl && GENRES.latin.excl.take === 0.5 && GENRES.latin.excl.keep === 0.45, 'latin needs half the wheel to take kit or bass (excl 0.5 / 0.45)');
  t.ok(Math.abs(GENRES.jazz.swing - 2 / 3) < 1e-9 && ids.filter(id => id !== 'jazz').every(id => GENRES[id].swing === 0.5), 'only jazz swings');
  t.section('riffs and groove');
  checkGroove(packs, t);
  t.section('required content (the spec\'s table, per genre)');
  for (const id of ids) detect(id, t);
}

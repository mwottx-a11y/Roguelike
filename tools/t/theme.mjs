// The song and its tune: "Theme and identity", "Theory, kept from today" and the single-song parts of
// "Grid and legality" (spec section 9), plus harmony plan, clave, boss variant, stem cache and compose cost.
// Statistical gates are windows over many seeds; everything else must hold for every bar of every song.
import { performance } from 'node:perf_hooks';
import { Song, GENRES, MODES, NOTE, MODE_LABEL, PROGS, rng, hashStr, grouping, genreMix, ELEM_GENRE } from '../../src/music.js';
import { composeTheme, themeBar, dialect, runeLine, classifyNCT } from '../../src/theme.js';

const IDS = Object.keys(GENRES), PARTS = ['kit', 'tops', 'bass', 'comp', 'color', 'lead'];
const SEVEN = [[2, 4], [3, 4], [4, 4], [5, 4], [5, 8], [6, 8], [7, 8]];           // the meters the identity gate names
const GAME = [[3, 4], [4, 4], [5, 4], [6, 8]];
const ALL = []; for (const u of [4, 8]) for (let b = 1; b <= 8; b++) ALL.push([b, u]);
const SONGS = 96, mk = (seed, variant) => { const s = new Song(seed, [[IDS[seed % 8], 1]]); if (variant) s.setVariant(variant); return s; };
const pcOf = (f, n) => (((n - f.tonic) % 12) + 12) % 12, inScale = (f, n) => f.chord.scale.includes(pcOf(f, n)), isCT = (f, n) => f.chord.pcs.includes(pcOf(f, n));
const flat = ev => { const out = []; ev.forEach((l, b) => l.forEach(e => out.push({ ...e, beat: b, t: b + e.o }))); return out; };
const rub = (a, b) => { const x = (((a - b) % 12) + 12) % 12; return x === 1 || x === 11; };
const tonesOf = e => (e.ns ? e.ns : e.x && e.x.arp ? e.x.arp.map(o => e.n + o) : [e.n]);
const pct = (a, b) => (b ? Math.round(1000 * a / b) / 10 : 100);
// a failing case is counted, and only the first few are printed
function tally(t) {
  const m = new Map();
  return { no(cond, msg, at) { let f = m.get(msg); if (!f) m.set(msg, f = { n: 0, bad: 0, at: null }); f.n++; if (!cond) { f.bad++; if (!f.at) f.at = at; } return cond; },
    done() { let n = 0; for (const [msg, f] of m) { n += f.n; t.ok(f.bad === 0, `${msg} (${f.n - f.bad}/${f.n}${f.bad ? ', first: ' + f.at : ''})`); } t.report('cases checked in ' + m.size + ' rules', n); } };
}

export default async function (t) {
  // ------------------------------------------------------------------ API and determinism
  t.section('API');
  {
    const a = new Song(12345, [['funk', 3], ['jazz', 1]]), b = new Song(12345, [['funk', 9]]);
    t.ok(typeof rng(1)() === 'number' && hashStr('a') === hashStr('a') && grouping(5, 4).join() === '3,2' && MODES.dorian && NOTE.length === 12 && PROGS.major && MODE_LABEL.aeolian === 'minor', 'music.js exports rng, hashStr, MODES, MODE_LABEL, NOTE, PROGS, grouping');
    t.eq(JSON.stringify(genreMix({ fire: 5, frost: 2, mod: 2 })), '[["metal",5],["jazz",2],["latin",2]]', 'genreMix sorts by weight then name');
    t.eq(JSON.stringify(genreMix({})), '[["baroque",1]]', 'genreMix of nothing is baroque');
    t.eq(Object.keys(ELEM_GENRE).length, 8, 'eight classes map to genres');
    t.ok(IDS.length === 8 && IDS.every(id => GENRES[id].id === id), 'GENRES is re-exported, keyed by id');
    t.eq(JSON.stringify(a.frame(5, 4, 4)), JSON.stringify(b.frame(5, 4, 4)), 'composition depends on the seed and the leading genre only, not on the weights');
    t.ok(a.seed === 12345 && a.keyPc >= 0 && a.keyPc < 12 && GENRES.funk.modes.includes(a.mode), 'song.seed, keyPc, mode');
    t.eq(a.keyLabel, NOTE[a.keyPc] + ' ' + MODE_LABEL[a.mode], 'keyLabel names key and mode');
    for (const k of ['setMix', 'bar', 'write', 'title', 'style', 'sig']) t.ok(a[k] === undefined, 'old API removed: song.' + k);
    const f = a.frame(0, 4, 4);
    for (const k of ['idx', 'sec', 'pos', 'rep', 'beats', 'unit', 'ppb', 'groups', 'accents', 'lastAcc', 'backbone', 'tonic', 'chord', 'next', 'voicing', 'bassRoot', 'nextBassRoot', 'clave', 'theme', 'holes', 'rune']) t.ok(f[k] !== undefined && f[k] !== null, 'frame.' + k);
    for (const k of ['deg', 'root', 'tones', 'pcs', 'scale', 'sev']) t.ok(f.chord[k] !== undefined, 'frame.chord.' + k);
    t.ok(Object.isFrozen(f) && Object.isFrozen(f.theme) && Object.isFrozen(f.theme[0]) && Object.isFrozen(f.chord), 'frames are frozen');
    t.ok(a.frame(16, 4, 4) === f && a.frame(-16, 4, 4) === f, 'frame index wraps at 16 and is cached');
    const st = a.stem(0, 4, 4, 'jazz', 'lead');
    t.ok(a.stem(0, 4, 4, 'jazz', 'lead') === st && Object.isFrozen(st) && Object.isFrozen(st[0]) && Object.isFrozen(st[0][0]), 'stems are cached and frozen');
    t.ok(flat(st).every(e => e.i === GENRES.jazz.inst.lead[0]), 'the lead patch defaults to pack.inst.lead[0]');
    const w = a.writes; a.warm(1, 4, 4, [{ g: 'funk', part: 'kit' }, { g: 'jazz', part: 'bass' }, ['metal', 'comp']]);
    t.eq(a.writes, w + 3, 'warm() pre-writes the stems it is given');
    const n0 = a.writes; a.stem(1, 4, 4, 'funk', 'kit'); t.eq(a.writes, n0, 'a warmed stem is not written again');
    const c1 = new Song(5, [['latin', 1]], { prevKey: 3 }); t.ok([7, 5, 2, 0].includes((c1.keyPc - 3 + 12) % 12), 'prevKey: the next key is +7, +5, +2 or the same');
    let keys = new Set(); for (let s = 0; s < 40; s++) keys.add((new Song(s, [['latin', 1]], { prevKey: 3 }).keyPc - 3 + 12) % 12); t.eq(keys.size, 4, 'prevKey: all four relations occur');
  }

  // ------------------------------------------------------------------ harmony plan
  t.section('harmony: cadence plan, triads, voice leading, bass register');
  {
    const T = tally(t); let move = 0, moves = 0, topMove = 0, maxTop = 0;
    const DOM = { aeolian: 'V', harmonic: 'V', dorian: 6, phrygian: 1, major: 4, mixolydian: 6 };
    for (let seed = 1; seed <= SONGS; seed++) for (const variant of [null, 'boss']) {
      const s = mk(seed, variant), at = `seed ${seed} ${variant || ''}`, p = s.plan, d = DOM[s.mode];
      T.no(p.length === 16 && p[3] === d && p[6] === d && p[14] === d && p[11] === d, 'bars 3, 6, 11, 14 are the dominant', at);
      T.no(p[7] === 0 && p[15] === 0, 'bars 7 and 15 are the tonic', at);
      T.no(p[8] !== 0 && p[9] !== 0 && p[10] !== 0 && p[11] !== 0, 'the bridge never touches the tonic chord', at);
      T.no(p[4] === p[0] && p[5] === p[1] && p[12] === p[0] && p[13] === p[1] && PROGS[s.mode].some(g => g[0] === p[0] && g[1] === p[1] && g[2] === p[2]), 'A sections start from one progression of the mode', at);
      let prev = null;
      for (let i = 0; i < 16; i++) {
        const f = s.frame(i, 4, 4), c = f.chord, v = f.voicing;
        T.no(c.tones.length === 3 && c.pcs.length === 3 && !c.pcs.includes(c.sev) && c.scale.includes(c.sev), 'chord is a triad; the seventh is offered separately and is diatonic', at + ' bar ' + i);
        T.no(c.pcs.every(x => c.scale.includes(x)) && c.scale.length === 7, 'chord tones lie in the bar\'s scale', at + ' bar ' + i);
        T.no(v.length === 3 && v.every((n, k) => n >= 55 && n <= 78 && isCT(f, n) && (k === 0 || n > v[k - 1])) && new Set(v.map(n => n % 12)).size === 3 && v[2] - v[0] <= 12, 'voicing: the full triad, close position, 55..78', at + ' bar ' + i + ' ' + v);
        T.no(f.bassRoot >= 36 && f.bassRoot <= 47 && pcOf(f, f.bassRoot) === c.root && f.nextBassRoot >= 36 && f.nextBassRoot <= 47 && pcOf(f, f.nextBassRoot) === f.next.root, 'bassRoot and nextBassRoot are roots in 36..47', at + ' bar ' + i);
        T.no(f.next === s.frame(i + 1, 4, 4).chord, 'frame.next is the next bar\'s chord', at);
        if (prev) { for (let k = 0; k < 3; k++) { move += Math.abs(v[k] - prev[k]); moves++; } topMove += Math.abs(v[2] - prev[2]); maxTop = Math.max(maxTop, Math.abs(v[2] - prev[2])); }
        prev = v;
      }
    }
    T.done();
    t.ok(move / moves <= 2.5, `mean voice movement between consecutive voicings <= 2.5 semitones (${(move / moves).toFixed(2)})`);
    t.report('voice leading: mean semitones per voice / largest top-voice move', (move / moves).toFixed(2) + ' / ' + maxTop);
  }

  // ------------------------------------------------------------------ clave
  t.section('one clave per song and meter');
  {
    const T = tally(t), kinds = {};
    for (let seed = 1; seed <= SONGS; seed++) {
      const s = mk(seed);
      for (const [b, u] of ALL) {
        const N = b * (u === 4 ? 2 : 1), cl = s.claveFor(b, u), key = b + '/' + u; (kinds[key] = kinds[key] || new Set()).add(JSON.stringify(cl));
        for (let i = 0; i < 16; i++) {
          const f = s.frame(i, b, u);
          T.no(JSON.stringify(f.clave) === JSON.stringify(cl[f.pos % 2]), 'frame.clave is the side for pos % 2', `seed ${seed} ${key}`);
          T.no(f.clave.length > 0 && f.clave.every((p, k) => Number.isInteger(p) && p >= 0 && p < N && (k === 0 || p > f.clave[k - 1])), 'clave pulses are ascending and inside the bar', `seed ${seed} ${key} ${f.clave}`);
        }
      }
    }
    T.done();
    t.ok(kinds['4/4'].size === 3 && kinds['3/4'].size === 2 && kinds['5/4'].size === 2 && kinds['6/8'].size === 2, 'the library is used: 3 claves in 4/4, 2 in 3/4, 5/4 and 6/8 across seeds');
  }

  // ------------------------------------------------------------------ the tune
  t.section(`theme and identity (${SONGS} songs)`);
  const dstat = {}; for (const id of IDS) dstat[id] = { notes: 0, bars: 0, len: 0, push: 0, heads: 0, orn: 0, six: 0 };
  {
    const T = tally(t);
    let structAll = 0, structSame = 0, barlines = 0, smooth = 0, hookMin = 99, hookSum = 0, bounced = 0, plain = 0, nct = 0, notes = 0, leaps = 0, ivs = 0, lowLead = 0, leadN = 0;
    const restBy = {}, tunes = [], hooks = new Set(), grams = new Set(), figs = new Set();
    for (let seed = 1; seed <= SONGS; seed++) {
      const s = mk(seed), th = s.theme; bounced += th.bounced; plain += th.plain; grams.add(th.gram); figs.add(th.x.rh + th.x.shape + th.x.dir + '/' + th.y.rh + th.y.shape + th.y.dir);
      // bar-head pitch is the same in every meter
      for (let i = 0; i < 16; i++) { const h = SEVEN.map(([b, u]) => { const n = s.frame(i, b, u).theme[0]; return n.beat === 0 && n.o === 0 ? n.n : -1; }); T.no(h.every(x => x === h[0] && x > 0), 'bar-head pitch identical in 2/4, 3/4, 4/4, 5/4, 5/8, 6/8, 7/8', `seed ${seed} bar ${i}: ${h}`); }
      for (let i = 0; i < 16; i++) if (i % 4 !== 3) { const m = [[4, 4, 2], [5, 4, 3], [6, 8, 3]].map(([b, u, at]) => { const n = s.frame(i, b, u).theme.find(x => x.beat === at && x.o === 0); return n && n.s ? n.n : -1; }); T.no(m.every(x => x === m[0] && x > 0), 'the second group head carries the same pitch in 4/4, 5/4 and 6/8', `seed ${seed} bar ${i}: ${m}`); }
      for (const [b, u] of ALL) {
        const key = b + '/' + u, game = GAME.some(m => m[0] === b && m[1] === u), seven = SEVEN.some(m => m[0] === b && m[1] === u), ppb = u === 4 ? 2 : 1;
        const F = []; for (let i = 0; i < 16; i++) F.push(s.frame(i, b, u));
        let top = -1, topBars = new Set(), sounding = 0;
        for (let i = 0; i < 16; i++) {
          const f = F[i], nf = F[(i + 1) % 16], at = `seed ${seed} ${key} bar ${i}`, th0 = f.theme;
          T.no(th0.length > 0 && th0[0].beat === 0 && th0[0].o === 0 && th0[0].s === 1, 'every bar starts with a structural note on the downbeat', at);
          let cover = 0;
          th0.forEach((n, k) => {
            const nx = th0[k + 1], st = n.beat + n.o, contiguous = nx ? Math.abs(nx.beat + nx.o - st - n.d) < 1e-9 : Math.abs(st + n.d - b) < 1e-9;
            const next = contiguous ? (nx ? nx.n : nf.theme[0].n) : null, prev = k ? th0[k - 1].n : null;
            T.no(inScale(f, n.n), 'theme: every note is in the bar\'s scale', at);
            T.no(Number.isInteger(st * ppb) && Number.isInteger(n.d * ppb) && st + n.d <= b + 1e-9 && (!nx || st + n.d <= nx.beat + nx.o + 1e-9), 'theme: notes sit on the pulse grid, do not overlap and stay inside the bar', at);
            const kind = classifyNCT(n.n, prev, next, f, nx ? f : nf);
            if (kind !== 'ct') { nct++; T.no(kind !== 'bad' && n.d <= 1 + 1e-9 && n.d * ppb <= 1 + 1e-9, 'theme: a non-chord tone lasts one pulse and leaves by step', at + ` ${n.n} -> ${next}`); T.no(!n.s, 'theme: structural notes are chord tones', at); }
            if (n.n > top) { top = n.n; topBars = new Set([i]); } else if (n.n === top) topBars.add(i);
            cover += n.d; notes++;
            if (seven && nx && contiguous) { ivs++; if (Math.abs(nx.n - n.n) > 4) leaps++; }
          });
          sounding += cover;
          for (const a of f.accents) { const snd = th0.find(n => n.beat + n.o <= a + 1e-9 && n.beat + n.o + n.d > a + 1e-9); if (snd) T.no(isCT(f, snd.n), 'theme: the tone sounding at a group head is a chord tone', at + ' beat ' + a); const hit = th0.find(n => n.beat === a && n.o === 0); if (hit) T.no(isCT(f, hit.n) && hit.s === 1, 'theme: a note struck on a group head is a structural chord tone', at); }
          if (f.pos === 3) {
            T.no(th0[0].c === 1 && th0[0].d * ppb >= Math.min(2, b * ppb - 1), 'cadence bar: the goal is held on the downbeat', at);
            if (b >= 2) T.no(f.holes.some(h => h.d >= 1 - 1e-9), 'cadence bar: a rest of a beat or more', at + ' ' + JSON.stringify(f.holes));
            if (i === 7 || i === 15) T.no(pcOf(f, th0[0].n) === 0 && f.chord.root === 0, 'closed cadence: the tune lands on the tonic root', at);
            if (i === 3 || i === 11) T.no(pcOf(f, th0[0].n) !== f.chord.root, 'open cadence: the tune ends on the third or fifth of the dominant', at);
          }
          if (seven && f.pos !== 3) { barlines++; const last = th0[th0.length - 1]; if (Math.abs(nf.theme[0].n - last.n) <= 4) smooth++; }
          // the rune line: a chord tone 3..9 semitones under the sounding note, one per beat
          T.no(f.rune.length === b && f.rune.every(isCT.bind(null, f)), 'rune line: one chord tone per beat', at);
          for (let k = 0; k < b; k++) { const snd = th0.find(n => n.beat + n.o <= k + 1e-9 && n.beat + n.o + n.d > k + 1e-9) || th0.find(n => n.beat === k); if (snd) T.no(snd.n - f.rune[k] >= 3 && snd.n - f.rune[k] <= 9, 'rune line: 3..9 semitones under the sounding theme note', at + ` beat ${k}`); }
          for (const n of th0) { leadN++; if (n.n <= f.voicing[2]) lowLead++; }
        }
        T.no(topBars.size === 1 && topBars.has(10), 'the highest note occurs in exactly one bar, bar 10', `seed ${seed} ${key}: bars ${[...topBars]}`);
        if (seven) { const r = 1 - sounding / (16 * b); (restBy[key] = restBy[key] || []).push(r); T.no(r >= 0.12 - 1e-9 && r <= 0.35 + 1e-9, 'lead rests 12-35% of the loop', `seed ${seed} ${key}: ${(100 * r).toFixed(1)}%`); }
        if (!game) continue;
        // ---- the eight dialects
        for (const id of IDS) {
          const P = GENRES[id].dialect, D = dstat[id], peakN = F[10].theme[0].n; let dtop = -1, dtopBars = new Set();
          const L = F.map((f, i) => s.stem(i, b, u, id, 'lead'));
          for (let i = 0; i < 16; i++) {
            const f = F[i], at = `seed ${seed} ${key} bar ${i} ${id}`, ev = flat(L[i]), nextFirst = flat(L[(i + 1) % 16])[0];
            const sN = f.theme.filter(n => n.s), sD = ev.filter(e => e.s);
            structAll += sN.length;
            sN.forEach((n, k) => { const e = sD[k]; if (e && e.n === n.n && Math.abs(e.t - (n.beat + n.o)) <= 1 / ppb + 1e-9 && sD.length === sN.length) structSame++; });
            T.no(JSON.stringify(sN.map(n => n.n)) === JSON.stringify(sD.map(e => e.n)), 'dialect: structural pitches are exactly the theme\'s', at);
            T.no(ev.every(e => e.p === 0 || !e.s) && sD.every(e => e.p === 0), 'dialect: structural notes are p0, nothing else is', at);
            ev.forEach((e, k) => {
              const nx = ev[k + 1], grid = u === 4 ? [0, 0.25, 0.5, 0.75] : [0, 0.5];
              T.no(grid.includes(e.o), 'dialect: offsets are multiples of 0.25 (0 or 0.5 in /8)', at + ' o=' + e.o);
              T.no(inScale(f, e.n) && (e.on === undefined || inScale(f, e.on)), 'dialect: every note and ornament pitch is in the bar\'s scale', at);
              T.no(e.d > 0 && e.t + e.d <= b + 1e-9 && (!nx || e.t + e.d <= nx.t + 1e-9), 'dialect: monophonic, inside the bar', at);
              T.no(e.v > 0 && e.v <= 1 && [0, 1, 2, 3].includes(e.p), 'dialect: v and p are in range', at);
              if (e.o === 0 && f.accents.includes(e.beat)) T.no(isCT(f, e.n), 'dialect: strong beats are chord tones', at);
              // the written length of a note is the gap to the next onset when it is legato; articulation only shortens it
              if (!isCT(f, e.n)) { const span = nx ? nx.t - e.t : b - e.t, next = nx ? nx.n : nextFirst.n, kind = classifyNCT(e.n, k ? ev[k - 1].n : null, next, f, nx ? f : F[(i + 1) % 16]); T.no(kind !== 'bad' && e.d <= 1 + 1e-9 && span * ppb <= 1 + 1e-9, 'dialect: a non-chord tone lasts one pulse at most and leaves by step', at + ` ${e.n} -> ${next}`); }
              if (e.orn) {
                D.orn++; const span = (nx ? nx.t : b) - e.t;
                T.no(P.orn.includes(e.orn) && Number.isInteger(e.on) && span >= 0.5 - 1e-9, 'dialect: ornaments come from the pack\'s list, with a neighbour pitch, on notes of half a beat or more', at);
                T.no(e.orn === 'flip' ? Math.abs(e.on - e.n) === 12 : e.orn === 'glide' ? Math.abs(e.on - e.n) <= 12 && e.on !== e.n : Math.abs(e.on - e.n) >= 1 && Math.abs(e.on - e.n) <= 3, 'dialect: the ornament neighbour is a scale step away (an octave for flip, the previous note for glide)', at + ' ' + e.orn + ' ' + e.n + ' ' + e.on);
                T.no(e.orn === 'glide' ? e.on <= peakN : e.on < peakN, 'dialect: no ornament touches the peak (a glide may start from it)', at);
              }
              if (e.n > dtop) { dtop = e.n; dtopBars = new Set([i]); } else if (e.n === dtop) dtopBars.add(i);
              D.notes++; D.len += e.d; if (e.o === 0.25 || e.o === 0.75) D.six++;
            });
            for (const a of f.accents) { const snd = ev.find(e => e.t <= a + 1e-9 && e.t + e.d > a + 1e-9); if (snd) T.no(isCT(f, snd.n), 'dialect: the tone sounding at a group head is a chord tone', at); }
            for (const h of f.holes) T.no(!ev.some(e => e.t >= h.beat + h.o - 1e-9 && e.t < h.beat + h.o + h.d - 1e-9), 'dialect: the tune\'s rests stay rests', at);
            { const per = f.accents.map(() => 0); for (const e of ev) if (e.orn) { let g = 0; f.accents.forEach((a, k) => { if (a <= e.t + 1e-9) g = k; }); per[g]++; } T.no(per.every(x => x <= 1), 'dialect: at most one ornament per group', at); }
            for (const n of sN) if (n.beat > 0 && n.o === 0 && f.accents.includes(n.beat)) { D.heads++; if (!ev.some(e => e.s && e.t === n.beat)) D.push++; }
            D.bars++;
          }
          T.no(dtopBars.size === 1 && dtopBars.has(10), 'dialect: the highest note is still only in bar 10', `seed ${seed} ${key} ${id}: ${[...dtopBars]}`);
        }
      }
      // the hook: bars whose first group has bar 0's rhythm and contour
      {
        const F = []; for (let i = 0; i < 16; i++) F.push(s.frame(i, 4, 4).theme.filter(n => n.beat < 2));
        const sg = L => L.map((n, k) => (n.beat + n.o) + '/' + n.d + (k ? Math.sign(n.n - L[k - 1].n) : '')).join(' ');
        const same = F.filter(L => sg(L) === sg(F[0])).length; hookMin = Math.min(hookMin, same); hookSum += same;
        T.no(same >= 4, 'the hook returns: at least 4 of 16 bars share bar 0\'s first-group rhythm and contour', `seed ${seed}: ${same}`);
        hooks.add(sg(F[0]));
        tunes.push(Array.from({ length: 16 }, (_, i) => s.frame(i, 4, 4).theme.map(n => (n.beat + n.o) + ':' + n.d + ':' + (n.n - s.tonic)).join(',')).join('|'));
      }
    }
    T.done();
    t.ok(structSame / structAll >= 0.98, `structural lead pitches identical across all 8 dialects, within a pulse of their place: >= 98% (${pct(structSame, structAll)}%)`);
    t.ok(smooth / barlines >= 0.9, `barline interval at most 4 semitones in >= 90% of non-phrase barlines (${pct(smooth, barlines)}%)`);
    t.ok(new Set(tunes).size === SONGS, `every seed gives a different tune (${new Set(tunes).size} distinct of ${SONGS})`);
    // how different: share of 4/4 pulse slots on which two tunes agree about "a note starts here"
    let agree = 0, pairs = 0, mx = 0;
    const grid = tunes.map(tn => tn.split('|').map(bar => { const g = new Array(8).fill(0); for (const n of bar.split(',')) g[Math.round(parseFloat(n) * 2)] = 1; return g; }).flat());
    for (let a = 0; a < SONGS; a++) for (let b2 = a + 1; b2 < SONGS; b2++) { let eq = 0; for (let k = 0; k < 128; k++) if (grid[a][k] === grid[b2][k]) eq++; agree += eq / 128; pairs++; mx = Math.max(mx, eq / 128); }
    t.ok(agree / pairs <= 0.8, `different seeds have different rhythms: mean onset-grid agreement between two tunes <= 80% (${pct(agree, pairs)}%)`);
    t.ok(hooks.size >= 15 && figs.size >= 60 && grams.size === 4, `variety: ${hooks.size} distinct hook cells (>= 15), ${figs.size} figure pairs (>= 60), ${grams.size} grammars (4) in ${SONGS} songs`);
    for (const k of Object.keys(restBy)) t.report(`rest share ${k} min / mean / max %`, restBy[k].map(x => 100 * x).reduce((a, x, i, arr) => i === arr.length - 1 ? [Math.min(a[0], x), a[1] + x, Math.max(a[2], x)].map((v, j) => (j === 1 ? v / arr.length : v).toFixed(1)).join(' / ') : [Math.min(a[0], x), a[1] + x, Math.max(a[2], x)], [99, 0, 0]));
    t.report('structural identity across dialects %', pct(structSame, structAll));
    t.report('smooth non-phrase barlines %', pct(smooth, barlines));
    t.report('hook recurrence: min / mean bars of 16', hookMin + ' / ' + (hookSum / SONGS).toFixed(1));
    t.report('distinct hooks / figure pairs / grammars', hooks.size + ' / ' + figs.size + ' / ' + grams.size);
    t.report('tune pairs: mean / max onset-grid agreement %', pct(agree, pairs) + ' / ' + Math.round(1000 * mx) / 10);
    t.ok(bounced + plain <= SONGS * 12 * 0.02, `figures fit the register: at most 2% of bars needed a turned-around move or a plain held note (${bounced} + ${plain} of ${SONGS * 12})`);
    t.report('bars with a turned-around move / a plain held note instead of a figure', bounced + ' / ' + plain);
    t.report('non-chord tones % of theme notes', pct(nct, notes));
    t.report('leaps (> major third) % of melodic intervals', pct(leaps, ivs));
    t.report('theme notes at or below the top of the voicing %', pct(lowLead, leadN));
    for (const id of IDS) { const D = dstat[id]; t.report(`dialect ${id}: notes/bar, mean length, push %, sixteenths %, ornaments/bar`, [(D.notes / D.bars).toFixed(2), (D.len / D.notes).toFixed(2), pct(D.push, D.heads), pct(D.six, D.notes), (D.orn / D.bars).toFixed(2)].join(', ')); }
    // the dialects must actually differ from each other
    const den = id => dstat[id].notes / dstat[id].bars, ln = id => dstat[id].len / dstat[id].notes;
    t.ok(den('celtic') > den('baroque') * 0.95 && den('baroque') > den('jazz') && den('jazz') > den('synthwave') && den('synthwave') < den('funk'), 'dialect density order: celtic and baroque busiest, synthwave sparsest');
    t.ok(ln('funk') < ln('latin') && ln('synthwave') > 2 * ln('funk'), 'dialect note length: funk shortest, synthwave long');
    t.ok(dstat.latin.push > dstat.jazz.push && dstat.jazz.push > 0 && dstat.baroque.push === 0 && dstat.celtic.push === 0, 'dialect push: latin most, baroque and celtic none');
    t.ok(dstat.baroque.orn > 0 && dstat.celtic.orn > 0 && dstat.synthwave.orn > 0 && dstat.metal.orn > 0 && dstat.chiprock.orn > 0 && dstat.jazz.orn === 0 && dstat.funk.orn === 0 && dstat.latin.orn === 0, 'ornaments: only where the dialect table lists them');
  }

  // ------------------------------------------------------------------ theory, kept from today + grid and legality
  t.section('theory and legality against the packs (all 8 x 8 lead and comp pairings, game meters)');
  {
    const T = tally(t); let shared = 0, above = 0; const worst = {};
    for (let seed = 1; seed <= 48; seed++) for (const variant of seed % 6 === 0 ? [null, 'boss'] : [null]) {
      const s = mk(seed, variant);
      for (const [b, u] of GAME) for (let i = 0; i < 16; i++) {
        const f = s.frame(i, b, u), at = `seed ${seed}${variant ? ' boss' : ''} ${b}/${u} bar ${i}`, ppb = f.ppb;
        const leads = IDS.map(id => flat(s.stem(i, b, u, id, 'lead')));
        for (const id of IDS) {
          const bass = flat(s.stem(i, b, u, id, 'bass')), comp = flat(s.stem(i, b, u, id, 'comp'));
          T.no(bass.length > 0 && bass[0].t === 0 && bass[0].n === f.bassRoot, 'bass root on the downbeat', at + ' ' + id);
          T.no(bass.every((e, k) => k === bass.length - 1 || e.t + e.d <= bass[k + 1].t + 1e-9), 'one bass note at a time', at + ' ' + id);
          for (const part of PARTS) for (const e of flat(s.stem(i, b, u, id, part))) {
            T.no(Number.isInteger(e.o * 4) && (u === 4 || e.o === 0 || e.o === 0.5), 'all composed offsets are multiples of 0.25', at + ` ${id} ${part} o=${e.o}`);
          }
          // swing warp: straight, the slew steps towards 2/3, and 2/3 itself never bring two onsets within 1/8 beat
          for (const sw of [0.5, 0.5 + 1 / 24, 0.5 + 2 / 24, 0.5 + 3 / 24, 2 / 3]) for (const part of PARTS) {
            const ev = s.stem(i, b, u, id, part);
            for (const L of ev) { const os = [...new Set(L.map(e => e.o))].map(o => (o <= 0.5 ? o * sw / 0.5 : sw + (o - 0.5) * (1 - sw) / 0.5)).sort((x, y) => x - y); for (let k = 1; k < os.length; k++) T.no(os[k] - os[k - 1] >= 0.125 - 1e-9, 'after the swing warp no two onsets in a beat are closer than 1/8 beat', at + ` ${id} ${part} swing ${sw.toFixed(3)}`); }
          }
          leads.forEach((lead, li) => {
            // "a beat or longer" = two pulses or more, so /8 is judged like /4
            for (const l of lead) if (l.d * ppb >= 2 - 1e-9) for (const c of comp) if (c.t < l.t + l.d - 1e-9 && c.t + c.d > l.t + 1e-9) T.no(tonesOf(c).every(n => !rub(n, l.n)), 'no comp tone a semitone from a lead note of two pulses or longer', at + ` comp ${id} lead ${IDS[li]}: ${tonesOf(c)} vs ${l.n}`);
            for (const l of lead) for (const c of comp) if (Math.abs(c.t - l.t) < 1e-9 && !(c.x && c.x.bus === 'dist')) { shared++; const hi = Math.max(...tonesOf(c)); const k = id; worst[k] = worst[k] || [0, 0]; worst[k][1]++; if (l.n > hi) { above++; worst[k][0]++; } }
          });
        }
      }
    }
    T.done();
    t.ok(above / shared >= 0.85, `lead above the top comp note on >= 85% of shared onsets (${pct(above, shared)}%)`);
    for (const id of IDS) if (worst[id]) { t.ok(worst[id][0] / worst[id][1] >= 0.85, `lead above ${id}'s comp on >= 85% of shared onsets (${pct(worst[id][0], worst[id][1])}%)`); }
    t.report('lead above the top comp note %', pct(above, shared));
  }

  // ------------------------------------------------------------------ boss variant
  t.section('boss variant: the parallel darker mode, same rhythm, same contour');
  {
    const T = tally(t), BOSS = { major: 'aeolian', mixolydian: 'dorian', dorian: 'aeolian', aeolian: 'phrygian', harmonic: 'harmonic', phrygian: 'phrygian' };
    let changed = 0, total = 0, dContour = 0, dNotes = 0;
    for (let seed = 1; seed <= SONGS; seed++) {
      const s = mk(seed), want = BOSS[s.mode];
      for (const [b, u] of SEVEN) for (let i = 0; i < 16; i++) {
        const at = `seed ${seed} ${b}/${u} bar ${i}`;
        s.setVariant(null); const f0 = s.frame(i, b, u), l0 = IDS.map(id => flat(s.stem(i, b, u, id, 'lead')));
        s.setVariant('boss'); const f1 = s.frame(i, b, u), l1 = IDS.map(id => flat(s.stem(i, b, u, id, 'lead')));
        T.no(f1 !== f0 && f1.tonic === f0.tonic && f1.chord.root === (f0.chord.deg === 'V' ? 7 : MODES[want][f0.chord.di]) && f1.chord.deg === f0.chord.deg, 'boss: same tonic and degrees, no transposition', at);
        const sc = f1.chord.deg === 'V' ? MODES[want].map((x, k) => (k === 6 ? 11 : x)) : MODES[want];
        T.no(JSON.stringify(f1.chord.scale) === JSON.stringify(sc), 'boss: the bar\'s scale is the variant mode', at);
        T.no(f1.theme.length === f0.theme.length && f1.theme.every((n, k) => { const m = f0.theme[k]; return n.beat === m.beat && n.o === m.o && n.d === m.d && n.s === m.s; }), 'boss theme: rhythm and structure identical', at);
        T.no(f1.theme.every((n, k) => k === 0 || Math.sign(n.n - f1.theme[k - 1].n) === Math.sign(f0.theme[k].n - f0.theme[k - 1].n)), 'boss theme: contour identical', at);
        T.no(f1.theme.every(n => inScale(f1, n.n) && Math.abs(n.n - f0.theme[f1.theme.indexOf(n)].n) <= 1), 'boss theme: every pitch in the variant scale, at most a semitone from the original', at);
        T.no(f1.theme.every(n => !n.s || isCT(f1, n.n)), 'boss theme: structural notes are chord tones of the variant chord', at);
        f1.theme.forEach((n, k) => { total++; if (n.n !== f0.theme[k].n) changed++; });
        if (GAME.some(m => m[0] === b && m[1] === u)) l1.forEach((ev, g) => {
          T.no(ev.every(e => inScale(f1, e.n) && (e.on === undefined || inScale(f1, e.on))), 'boss dialects: every pitch in the variant scale', at + ' ' + IDS[g]);
          T.no(ev.length === l0[g].length && ev.every((e, k) => e.t === l0[g][k].t && e.s === l0[g][k].s), 'boss dialects: same onsets', at + ' ' + IDS[g]);
          if (ev.length === l0[g].length) ev.forEach((e, k) => { if (k) { dNotes++; if (Math.sign(e.n - ev[k - 1].n) === Math.sign(l0[g][k].n - l0[g][k - 1].n)) dContour++; } });
        });
      }
      s.setVariant('boss'); T.no(s.keyLabel === NOTE[s.keyPc] + ' ' + MODE_LABEL[want] && s.activeMode === want && s.mode !== undefined, 'boss: keyLabel reflects the active variant', `seed ${seed}`);
      const fb = s.frame(3, 4, 4); s.setVariant(null); T.no(s.frame(3, 4, 4) !== fb && s.frame(3, 4, 4) === s.frame(3, 4, 4) && s.keyLabel === NOTE[s.keyPc] + ' ' + MODE_LABEL[s.mode], 'setVariant(null) returns to the original frames', `seed ${seed}`);
    }
    T.done();
    t.ok(dContour / dNotes >= 0.97, `boss dialects: contour identical on >= 97% of intervals (${pct(dContour, dNotes)}%; only pentatonic snaps may differ)`);
    t.report('boss: theme notes whose pitch changes %', pct(changed, total));
    t.report('boss: dialect contour identity %', pct(dContour, dNotes));
  }

  // ------------------------------------------------------------------ cache
  t.section('stem cache: LRU of 1500, evicts the oldest 200, never clears');
  {
    const s = mk(3); let maxSize = 0, minAfterFull = 1e9, n = 0; const first = s.stem(0, 4, 4, 'funk', 'bass');
    outer: for (const [b, u] of ALL) for (let i = 0; i < 16; i++) for (const id of IDS) for (const part of PARTS) {
      s.stem(i, b, u, id, part); n++; maxSize = Math.max(maxSize, s.cache.size); if (n > 1500) minAfterFull = Math.min(minAfterFull, s.cache.size);
      if (n % 97 === 0) s.stem(0, 4, 4, 'funk', 'bass');                      // keep one stem in use
      if (n > 6000) break outer;
    }
    t.ok(maxSize <= 1500, 'the cache never holds more than 1500 stems (' + maxSize + ')');
    t.ok(minAfterFull >= 1300, 'eviction removes the oldest 200, never everything (smallest size once full: ' + minAfterFull + ')');
    t.ok(s.stem(0, 4, 4, 'funk', 'bass') === first, 'a stem that keeps being used is never evicted (LRU, not FIFO)');
    const k0 = [...s.cache.keys()][0].split(':'); t.eq(k0.length, 6, 'cache key is idx:beats:unit:variant:genre:part');
    s.setVariant('boss'); const vb = s.stem(0, 4, 4, 'funk', 'bass'); s.setVariant(null);
    t.ok(vb !== first && s.stem(0, 4, 4, 'funk', 'bass') === first, 'the variant is part of the key');
    let threw = false; try { s.stem(0, 4, 4, 'polka', 'kit'); } catch (e) { threw = true; } t.ok(threw, 'an unknown genre throws instead of composing something');
  }

  // ------------------------------------------------------------------ theme.js as a library
  t.section('theme.js exports');
  {
    const s = mk(11), f = s.frame(2, 4, 4);
    t.ok(typeof composeTheme === 'function' && JSON.stringify(themeBar(s, 2, 4, 4)) === JSON.stringify(f.theme), 'themeBar(song, idx, beats, unit) is the frame\'s theme');
    t.eq(JSON.stringify(dialect(f.theme, GENRES.celtic.dialect, f).map(l => l.map(e => [e.o, e.n, e.s]))), JSON.stringify(s.stem(2, 4, 4, 'celtic', 'lead').map(l => l.map(e => [e.o, e.n, e.s]))), 'dialect(notes, pack.dialect, frame) is the lead stem');
    t.eq(JSON.stringify(runeLine(f.theme, f)), JSON.stringify(f.rune), 'runeLine(notes, frame) is the frame\'s rune line');
    const neutral = dialect(f.theme, { fill: 0, thin: 0, push: 0, art: 1, penta: false, orn: [] }, f);
    t.eq(JSON.stringify(flat(neutral).map(e => [e.t, e.d, e.n])), JSON.stringify(f.theme.map(n => [n.beat + n.o, n.d, n.n])), 'a neutral dialect returns the theme unchanged');
    const C = { chord: { pcs: [0, 4, 7], scale: MODES.major }, tonic: 60 };
    t.ok(classifyNCT(64, 62, 65, C) === 'ct' && classifyNCT(62, 60, 64, C) === 'pass' && classifyNCT(62, 60, 60, C) === 'nbr' && classifyNCT(65, 72, 64, C) === 'step' && classifyNCT(65, 64, 69, C) === 'bad' && classifyNCT(62, 60, null, C) === 'bad', 'classifyNCT: chord tone, passing, neighbour, leapt-in, unresolved');
  }

  // ------------------------------------------------------------------ cost
  t.section('compose cost (node, this machine)');
  {
    const tm = fn => { const t0 = performance.now(); fn(); return performance.now() - t0; };
    for (let w = 0; w < 30; w++) { const s = mk(900 + w); for (let i = 0; i < 16; i++) for (const id of IDS) for (const p of PARTS) s.stem(i, 4, 4, id, p); }   // warm the JIT
    let songMs = 0, frameMs = 0, stemMs = 0, barMs = [], frames = 0, stems = 0;
    for (let seed = 2000; seed < 2040; seed++) {
      let s; songMs += tm(() => { s = mk(seed); });
      for (const [b, u] of GAME) for (let i = 0; i < 16; i++) {
        frameMs += tm(() => s.frame(i, b, u)); frames++;
        const three = [IDS[(seed + i) % 8], IDS[(seed + i + 3) % 8], IDS[(seed + i + 5) % 8]];
        const ms = tm(() => { for (const g of three) for (const p of PARTS) s.stem(i, b, u, g, p); }); stemMs += ms; stems += 18; barMs.push(ms);
      }
    }
    barMs.sort((a, b) => a - b);
    const p50 = barMs[barMs.length >> 1], p90 = barMs[Math.floor(barMs.length * 0.9)], p99 = barMs[Math.floor(barMs.length * 0.99)], mx = barMs[barMs.length - 1];
    t.report('new Song(): ms', songMs / 40);
    t.report('frame, cold: ms', frameMs / frames);
    t.report('stem, cold: ms', stemMs / stems);
    t.report('one bar, 3 genres x 6 parts, cold: ms median / p99 / max', p50.toFixed(3) + ' / ' + p99.toFixed(3) + ' / ' + mx.toFixed(3));
    // the median is the gate (a busy machine or a GC pause stretches the tail; p99 and max are reported above)
    t.ok(p50 < 1 && p90 < 4, 'one bar of 3 genres x 6 parts composes in well under 4 ms (median ' + p50.toFixed(3) + ' ms, p90 ' + p90.toFixed(3) + ' ms)');
  }
}

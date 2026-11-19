// HEXBEAT — the tune. Pure data, no audio, no imports.
//
// One song has ONE theme. It is composed once from the seed as ladder ranks (rank 0 is the bottom of the lead
// register, one rank is one scale step), so it does not know the genre, the meter or even the exact mode:
//   - two short figures, x (the hook) and y (its answer), each a rhythm cell plus a contour;
//   - a phrase grammar that states, restates and answers them over four bars;
//   - a held cadence note and a breath at the end of every phrase, with a pickup into the next one;
//   - one highest note, on the downbeat of bar 10 (the bridge), and nowhere else. The bridge climbs to it: bar 9
//     runs into it without a rest and ends a third, a fourth or a fifth under it; it is held two pulses or
//     more, struck once, and stands a third or more above everything in bars 8 and 9.
// themeBar() lays one bar of it onto any meter; dialect() performs that bar in a genre's accent without ever
// moving a structural note; runeLine() derives the harmony part the wheel plays under it.
//
// Rules that hold by construction (tools/t/theme.mjs checks them on data):
//   every note is in the bar's scale; every note on a group head is a chord tone; a non-chord tone lasts one
//   pulse and leaves by step; the bar's first pitch is the same in every meter; no chromatic material anywhere;
//   the augmented second of a minor key (b6 to the raised 7) is never taken as a step, in the tune or in a
//   dialect; no leap is wider than an octave; the hook keeps its long-against-short rhythm in every meter (in /8
//   by splitting a pulse, see alloc); a song that has a pickup has it before every phrase in every meter.
// How a bar is chosen (composeTheme: build) is a price list, not a first fit: see there.

const RMAX = 13;                                   // ranks 0..13: about an octave and a sixth
const RH_X = ['LSS', 'SSL', 'LS', 'SL', 'SLS'];    // hook rhythms always contain a long note against short ones
const RH_Y = ['LSS', 'SSL', 'LS', 'SL', 'SLS', 'LL', 'SSSS'];
// A contour is a list of moves between successive notes: s = one scale step, c = to the next chord tone,
// l = a leap of at least `leap` steps landing on a chord tone, r = repeat. The sign is relative to the
// figure's direction, so every restatement keeps the same up/down pattern wherever it starts.
const MOVES = {
  run: [['s', 1], ['s', 1], ['s', 1]],
  neighbor: [['s', 1], ['s', -1], ['s', -1]],
  turn: [['s', 1], ['s', 1], ['s', -1]],
  leapfill: [['l', 1], ['s', -1], ['s', -1]],      // the gap-fill archetype: leap, then step back into the gap
  arp: [['c', 1], ['c', 1], ['c', -1]],
  pendulum: [['c', 1], ['c', -1], ['c', 1]],
  repeat: [['r', 0], ['s', 1], ['s', 1]],
  dip: [['c', -1], ['s', 1], ['s', 1]],
};
// A tune is sung in steps and coloured by leaps, so the stepwise shapes are drawn twice as often as the
// chord shapes, and a song has at most one chord shape (CHORDAL) between its two figures.
const SHAPE_W = { run: 2, neighbor: 2, turn: 2, leapfill: 2, repeat: 1, dip: 1, arp: 1, pendulum: 1 };
const SHAPES = Object.keys(SHAPE_W), SHAPE_SUM = SHAPES.reduce((n, k) => n + SHAPE_W[k], 0);
const CHORDAL = ['arp', 'pendulum', 'dip'], WIDE = ['leapfill', 'arp', 'pendulum', 'dip'];
// Phrase grammars. Each bar has two roles (first group, last group): x, y, X/Y (the figure upside down),
// H (hold the group head, then rest), U (climb to the note the peak is reached from: the bar before the peak
// has no rest), P (the peak: held, then the hook's contour falling from the top note).
// Bar 3 of every phrase is the cadence. Every A phrase states x on at least two bar heads.
const GRAM = {
  sentence: { A: ['xy', 'xH', 'xx'], B: ['yy', 'yU', 'Px'] },   // idea, idea again, fragments, cadence
  period: { A: ['xy', 'yH', 'xy'], B: ['yx', 'yU', 'Py'] },     // antecedent, consequent
  echo: { A: ['xx', 'yH', 'xy'], B: ['Xy', 'XU', 'Py'] },       // the hook answers itself; the bridge inverts it
  call: { A: ['xH', 'xy', 'yx'], B: ['yY', 'yU', 'Px'] },       // a call, a breath, then the full reply
};
const ARCH = [[0, 2, 4], [4, 2, 0], [0, 3, 1], [3, 0, 2], [1, 4, 2], [2, 0, 3], [0, 1, 3], [3, 1, 0]];
const BARCH = [[-6, -3], [-5, -3], [-5, -2], [-4, -2]];           // bridge bar heads relative to the peak: the bridge only climbs

const NOGAP = [0, 2, 4, 5, 7, 9, 11];
// semitones above the tonic of ladder rank r in a bar whose scale is sc
const semOf = (sc, base, r) => { const k = base + r; return 12 * Math.floor(k / 7) + sc[((k % 7) + 7) % 7]; };
// The augmented second: two ranks next door whose pitches are three semitones apart. th.sc holds each bar's
// scale in the mode the song was composed in; the boss variant has its gaps on the same ranks.
// augOf(th)(i, a, b[, j]) asks about rank a in bar i against rank b in bar j.
const augOf = th => (i, a, b, j = i) => Math.abs(a - b) === 1 && Math.abs(semOf(th.sc[i & 15], th.base, a) - semOf(th.sc[j & 15], th.base, b)) === 3;
const ctOf = (base, deg, r) => { const d = (((base + r - deg) % 7) + 7) % 7; return d === 0 || d === 2 || d === 4; };
export const ctAt = (th, idx, r) => ctOf(th.base, th.deg[idx], r);
// The tune's highest note is the top chord tone of bar 10 and is reached from a chord tone of bar 9. True when
// the third under it is one (d9, d10: the chord degrees of the two bars; base as in composeTheme's plan), so
// the harmony can be laid out for the climb (music.js does, where its chord pools leave a choice).
export const climbsByThird = (base, d9, d10) => { let p = RMAX; while (!ctOf(base, d10, p)) p--; return ctOf(base, d9, p - 2); };
// cheap integer hash -> [0, 1): the dialect's dice. Keyed by phrase position, never by bar index, so a
// restated phrase is ornamented the same way.
function unit(seed, a, b, c) {
  let h = (seed ^ Math.imul(a + 1, 0x9E3779B1) ^ Math.imul(b + 7, 0x85EBCA6B) ^ Math.imul(c + 13, 0xC2B2AE35)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2C1B3C6D); h = Math.imul(h ^ (h >>> 12), 0x297A2D39); return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

// Make a run of notes legal, right to left. ns[i] = { r, len (pulses), fx (may not move), gap (a rest follows) }.
// A non-chord tone may stay only if it lasts one pulse and the next note is one true step away; otherwise it
// moves next door to the following note (when that is no more than a third from the note before it), or
// else to a chord tone: towards the following note for choice, so that no leap is left behind.
// aug(a, b) says that two ranks of this bar are an augmented second apart (augX: the last note against nextR,
// which lies in the next bar): that is not a step, so a non-chord tone neither leaves nor is entered across it.
function legalize(ns, isCT, nextR, lo, hi, long = 1, aug = null, augX = aug) {
  for (let j = ns.length - 1; j >= 0; j--) {
    const a = ns[j]; if (a.fx || isCT(a.r)) continue;
    const end = j + 1 >= ns.length, nx = a.gap ? null : !end ? (a.p == null || a.p + a.len === ns[j + 1].p ? ns[j + 1].r : null) : nextR;
    const q = j > 0 ? ns[j - 1] : null, pv = q ? q.r : a.r, inDir = Math.sign(a.r - pv);
    const firm = q && !q.gap && (q.p == null || q.p + q.len === a.p) && (q.fx || isCT(q.r));     // entered from a note that stays
    const ag = (x, y) => !!(end ? augX && augX(x, y) : aug && aug(x, y));
    const out = r => nx != null && Math.abs(nx - r) === 1 && !ag(r, nx), into = r => !(firm && aug && aug(pv, r));
    if (a.len <= long && out(a.r) && into(a.r)) continue;
    if (a.len <= long && nx != null) {
      const s = Math.sign(nx - a.r), cand = nx - s;
      if (s !== 0 && Math.abs(cand - pv) <= 2 && cand >= lo && cand <= hi && cand !== pv && out(cand) && into(cand)) { a.r = cand; continue; }
    }
    const d0 = (nx != null && Math.abs(nx - a.r) > 1 ? Math.sign(nx - a.r) : 0) || inDir || 1;
    let done = false;
    for (const d of [d0, -d0]) { for (let t = 1; t <= 3 && !done; t++) { const r = a.r + d * t; if (r < lo || r > hi) break; if (isCT(r) && !(nx != null && ag(r, nx))) { a.r = r; done = true; } } if (done) break; }
  }
  return ns;
}

// One figure from a starting rank. Returns the ranks, or null when it leaves [lo, hi] (the caller then tries
// another starting note; with `bounce` an out-of-range move is turned around instead). With `clean` a figure
// whose moves would cross an augmented second is refused as well, so the caller starts it somewhere else;
// without it the crossing is repaired (the non-chord tone at the gap gives way to a chord tone).
function figure(isCT, f, start, lo, hi, leap, dir, bounce, aug, clean) {
  const n = f.rh.length, mv = MOVES[f.shape], out = [start];
  let cur = start;
  for (let j = 1; j < n; j++) {
    const type = mv[j - 1][0]; let s = mv[j - 1][1] * dir, nx;
    for (let pass = 0; pass < 2; pass++) {
      if (type === 'r') nx = bounce ? cur - 1 : cur;
      else if (type === 's') nx = cur + s;
      else if (type === 'c') { nx = cur + s; while (!isCT(nx)) nx += s; }
      else { nx = cur + s * leap; while (!isCT(nx)) nx += s; }
      if (f.rh[j] === 'L') while (!isCT(nx)) nx += s || dir;           // long notes are chord tones
      if (nx >= lo && nx <= hi) break;
      if (!bounce || pass) return null;
      s = -s || -1;
    }
    out.push(nx); cur = nx;
  }
  const crosses = seq => !!aug && seq.some((r, j) => j > 0 && aug(seq[j - 1], r));
  if (clean && crosses(out)) return null;
  const ns = out.map((r, j) => ({ r, len: f.rh[j] === 'L' ? 2 : 1, fx: j === 0 }));
  const last = ns.pop(); legalize(ns, isCT, last.r, lo, hi, 1, aug);
  const res = ns.map(x => x.r); res.push(last.r);
  if (clean && crosses(res)) return null;
  return res.every((r, j) => j === 0 || (r >= lo && r <= hi)) ? res : null;   // the start is the caller's choice
}

// plan = { deg: [16 chord degrees, 0..6], base: degree index of rank 0, sc: [16 scales, semitones] }. sc may
// be left out (then no scale step is an augmented second). R is the song's theme rng.
export function composeTheme(R, plan) {
  const { deg, base } = plan, pick = a => a[Math.floor(R() * a.length)];
  const shape = () => { let r = R() * SHAPE_SUM; for (const k of SHAPES) { r -= SHAPE_W[k]; if (r < 0) return k; } return SHAPES[0]; };
  const x = { rh: pick(RH_X), shape: shape(), dir: R() < 0.5 ? 1 : -1 };
  // the answer differs from the hook in rhythm and in shape; a pendulum never runs in four even notes (it
  // would only wobble between two pitches)
  let y; do y = { rh: pick(RH_Y), shape: shape(), dir: R() < 0.5 ? 1 : -1 }; while (y.rh === x.rh || y.shape === x.shape || (CHORDAL.includes(x.shape) && CHORDAL.includes(y.shape)) || (y.shape === 'pendulum' && y.rh === 'SSSS'));
  // one of the two must carry a real interval, or the tune is all steps
  if (!WIDE.includes(x.shape) && !WIDE.includes(y.shape)) (R() < 0.6 ? x : y).shape = R() < 0.6 ? 'leapfill' : 'arp';
  // ... and a pendulum is not stated twice in one bar (xx, yy), for the same reason
  const gram = pick(Object.keys(GRAM).filter(g => !(x.shape === 'pendulum' && (g === 'sentence' || g === 'echo')) && !(y.shape === 'pendulum' && g === 'sentence')));
  const leap = 3 + Math.floor(R() * 3), pickup = Math.floor(R() * 3), lean = R() < 0.5 ? 1 : -1;
  const arch = pick(ARCH), b0 = 1 + Math.floor(R() * 3), barch = pick(BARCH);
  const link = Math.floor(R() * 3);                 // how a connecting cell (the third beat of 5/4) leads on: 0 a run, 1 a neighbour figure, 2 one held note
  const ct = (i, r) => ctOf(base, deg[i], r);
  // The peak: the highest chord tone of bar 10. The A sections stay 3 ranks below it, the two bridge bars that
  // climb to it 2 ranks (so it clears everything heard before it by a third), what follows it 1 rank.
  // It is reached from the last note of bar 9, a chord tone at least a third under it: a third for choice, then
  // a perfect fourth or fifth (never a step, or the peak would not clear what came before it). If the top chord
  // tone can only be reached by a tritone or worse, the next one down is the peak.
  const semP = (i, r) => semOf((plan.sc && plan.sc[i]) || NOGAP, base, r);
  const reach = pk => { let end = null, ec = 99; for (let r = pk - 2; r >= pk - 5 && r >= 0; r--) if (ct(9, r)) { const d = semP(10, pk) - semP(9, r), c = d <= 4 ? 0 : d === 5 ? 1 : d === 7 ? 2 : d === 6 ? 6 : 8; if (c < ec) { ec = c; end = r; } } return [ec, end]; };
  let peak = RMAX; while (!ct(10, peak)) peak--;
  if (reach(peak)[0] > 2) { let p2 = peak - 1; while (!ct(10, p2)) p2--; if (reach(p2)[0] <= 2) peak = p2; }
  const capA = peak - 3, capB = peak - 1, capU = peak - 2, end = reach(peak)[1];
  const th = { x, y, gram, leap, pickup, lean, link, arch, peak, capA, capB, base, deg: deg.slice(), sc: deg.map((d, i) => (plan.sc && plan.sc[i]) || NOGAP), bars: new Array(16), bounced: 0, plain: 0 };   // bounced / plain count the bars that needed a last resort
  const augAt = augOf(th);
  const turnL = rh => { const k = rh.indexOf('L'); return rh.slice(k) + rh.slice(0, k); };
  const PK = { rh: turnL(x.rh), shape: x.shape, dir: -1 };      // the peak cell: the hook's rhythm turned so that its long note comes first
  const figOf = sym => (sym === 'P' ? { f: PK, dir: -1 } : { f: sym === 'x' || sym === 'X' ? x : y, dir: (sym === 'X' || sym === 'Y' ? -1 : 1) * (sym === 'x' || sym === 'X' ? x : y).dir });
  const cts = (i, lo, hi) => { const o = []; for (let r = lo; r <= hi; r++) if (ct(i, r)) o.push(r); return o; };
  const near = (list, t) => list.slice().sort((a, b) => Math.abs(a - t) - Math.abs(b - t) || a - b);
  // what an interval of d ranks between two successive notes costs: a step is free, a third cheap, a repeated
  // note or a fourth dearer, anything wider dear
  const jump = d => (d === 1 ? 0 : d === 2 ? 0.3 : d === 0 ? 0.7 : 0.9 + (d - 3) * 1.2);
  // four notes that only go back and forth between two pitches
  const wobble = q => { let n = 0; for (let k = 3; k < q.length; k++) if (q[k] === q[k - 2] && q[k - 1] === q[k - 3] && q[k] !== q[k - 1]) n++; return n; };

  // One ordinary bar. Every way of writing it (head, leap, middle note, direction of the second figure) is
  // priced, and the cheapest wins: the head near its place in the arch, both figures as the song states them,
  // small intervals where the cells join, and a last note from which the next bar's head is a step or a third.
  // o.fixed: the head is given. o.like: restate that bar's first figure note for note. o.avoid: a head to stay
  // off. o.under: stay below this head. o.end: the rank the bar's last note climbs to (role U). o.after: where
  // the first cell of the bar before will end (already written): the head stays within an octave of it.
  // o.before: [bar, rank] of a held note the bar follows after a rest: not an augmented second from the head.
  const build = (i, roles, target, nextHead, cap, o = {}) => {
    const isCT = r => ct(i, r), aug = (a, b) => augAt(i, a, b), r0 = roles[0], r1 = roles[1], A = figOf(r0), B2 = r1 === 'H' || r1 === 'U' ? null : figOf(r1);
    const heads = o.like ? [o.like.head] : o.fixed != null ? [o.fixed] : near(cts(i, 0, cap), target);
    const lpsOf = f => { if (f.shape !== 'leapfill') return [leap]; const l = []; for (let k = leap; k >= 2; k--) l.push(k); return l; };   // only a leap figure cares
    // how the bar leaves: z is its last note in 4/4, y the note before it. A short last note that is neither a
    // step nor a chord third from the next head will be replaced by that head's neighbour, so y pays the leap.
    const land = (seq, rh) => {
      const n = seq.length, z = seq[n - 1], d = Math.abs(z - nextHead), long = rh[n - 1] === 'L' || n === 1;
      if (d === 1) return 0; if (d === 2 && isCT(z)) return 0.3;
      if (long) return d === 0 ? 0.7 : 0.4 + jump(d - 1);
      const y = n > 1 ? seq[n - 2] : z, dy = Math.abs(y - nextHead);
      return 0.4 + jump(Math.max(1, dy - 1)) + (!isCT(y) && dy !== 2 && dy !== 0 ? 1.5 : 0);        // a non-chord tone before it could not step to the new last note
    };
    let best = null, bc = 1e9;
    const offer = (c, bar) => { if (c < bc - 1e-9) { bc = c; best = bar; } };
    const sweep = (bounce, strict) => {
      for (const h of heads) {
        const hc = Math.abs(h - target) + (h === o.avoid ? 2 : 0) + (o.under != null && h >= o.under ? 3 : 0) + (o.after != null && Math.abs(h - o.after) > 7 ? 8 : 0) + (o.before && augAt(o.before[0], o.before[1], h, i) ? 6 : 0);
        if (hc >= bc) continue;
        const firsts = [];
        if (o.like) firsts.push([o.like.a.seq, 0]);
        else for (const lp of lpsOf(A.f)) for (const clean of [true, false]) {
          const a = figure(isCT, A.f, h, 0, cap, lp, A.dir, bounce || r0 === 'P', aug, clean);
          if (a) { firsts.push([a, (leap - lp) * 0.75 + (clean ? 0 : 4)]); break; }
        }
        for (let [a, ac] of firsts) {
          let e = a[a.length - 1], mids = null; const rhA = o.like ? o.like.a.rh : A.f.rh;
          if (!isCT(e)) {
            mids = [e + 1, e - 1].filter(r => r >= 0 && r <= cap && isCT(r) && !aug(e, r));              // a non-chord tone resolves by a true step
            if (!mids.length && a.length > 1 && !o.like) {
              // no chord tone next door (under the peak, say): the figure's last note is the chord tone it was heading for
              const d = Math.sign(e - a[a.length - 2]) || -1; let r = null;
              for (const dd of [d, -d]) { let q = e + dd; while (q >= 0 && q <= cap && !isCT(q)) q += dd; if (q >= 0 && q <= cap && q !== a[a.length - 2]) { r = q; break; } }
              if (r != null) { a = a.slice(0, -1).concat(r); e = r; ac += 1; mids = null; }
            }
          }
          // (a bar of one cell, 2/4, ends on this note: it stays within an octave of the next head)
          const c0 = hc + ac + (bounce ? 6 : 0) + (Math.abs(e - nextHead) > 7 ? 8 : 0);
          if (c0 >= bc) continue;
          if (!mids) {
            let up = e + 1; while (!isCT(up)) up++; let dn = e - 1; while (!isCT(dn)) dn--;
            mids = [e, up, dn];
            if (r1 === 'H') for (let r = nextHead - 2; r <= nextHead + 2; r++) if (isCT(r) && Math.abs(r - e) <= 4 && !mids.includes(r)) mids.push(r);
            if (r1 === 'U') { mids = []; for (let r = o.end - 1; r >= o.end - 5 && r >= 0; r--) if (isCT(r)) mids.push(r); }
            mids = mids.filter(r => r >= 0 && r <= cap);
          }
          for (const mid of mids) {
            const c1 = c0 + jump(Math.abs(mid - e));
            if (c1 >= bc) continue;
            const bar = { head: h, a: { rh: rhA, seq: a }, mid, b: null, hold: false, cap };
            if (r1 === 'H') { bar.hold = true; offer(c1 + (augAt(i, mid, nextHead, i + 1) ? 6 : 0) + 2.5 * Math.max(0, Math.abs(mid - nextHead) - 2) + (a.length > 2 && mid === a[a.length - 2] && e === a[a.length - 3] ? 1 : 0), bar); continue; }
            if (r1 === 'U') { if (mid >= o.end) continue; bar.up = o.end; offer(c1 + 0.7 * Math.max(0, o.end - mid - 2) + 0.5 * Math.max(0, mid - e - 2), bar); continue; }
            // in 3/4 the second figure has one beat: its first note must already be within reach of the next head
            const reach3 = 0.8 * Math.max(0, Math.abs(mid - nextHead) - 3);
            let found = false;
            for (const d of [B2.dir, -B2.dir]) for (const l2 of lpsOf(B2.f)) for (const clean of [true, false]) {
              const b = figure(isCT, B2.f, mid, 0, cap, l2, d, false, aug, clean); if (!b) continue;
              found = true;
              offer(c1 + reach3 + (d === B2.dir ? 0 : 1.25) + (leap - l2) * 0.5 + (clean ? 0 : 4) + land(b, B2.f.rh) + 3.5 * wobble(a.concat(b)), { ...bar, b: { rh: B2.f.rh, seq: b } });
              break;
            }
            if (!found && !strict) offer(c1 + 20 + land([mid], 'L'), { ...bar, b: { rh: 'L', seq: [mid] }, plain: 1 });   // the answer shrinks to one long note
          }
        }
      }
      return best;
    };
    if (sweep(false, true)) return best;
    th.bounced++;                                                   // turning a move around: a last resort
    if (sweep(true, true)) return best;
    th.plain++;
    if (sweep(false, false) || sweep(true, false)) return best;
    // nothing fits: the head, held. (The peak bar falls through its chord instead, so the top note is struck once.)
    if (r0 === 'P') { const dn = cts(i, 0, cap).reverse().slice(0, 2); return { head: heads[0], a: { rh: 'LSS'.slice(0, 1 + dn.length), seq: [heads[0], ...dn] }, mid: dn[dn.length - 1], b: null, hold: true, cap }; }
    return { head: heads[0], a: { rh: 'L', seq: [heads[0]] }, mid: heads[0], b: null, hold: true, cap };
  };
  // a cadence note is not an augmented second from the head that follows it (`next`, when it is already written)
  const cadence = (i, cands, target, cap, next) => { const ok = cands.filter(r => r <= cap), free = next == null ? ok : ok.filter(r => !augAt(i, r, next, i + 1)); return { cad: true, head: near(free.length ? free : ok, target)[0], cap }; };
  const open = i => cts(i, 0, RMAX).filter(r => (((base + r - deg[i]) % 7) + 7) % 7 !== 0);   // third or fifth of the dominant
  const root = i => cts(i, 0, RMAX).filter(r => (((base + r - deg[i]) % 7) + 7) % 7 === 0);

  const G = GRAM[gram], tA = arch.map(a => Math.min(capA - 1, a + b0)), B = th.bars;
  // A1: open ending on bar 3. Bars are built backwards so each one knows the head it leads to.
  B[3] = cadence(3, open(3), tA[2] - 1, capA);
  B[2] = build(2, G.A[2], tA[2], B[3].head, capA);
  B[1] = build(1, G.A[1], tA[1], B[2].head, capA, { avoid: B[2].head });
  B[0] = build(0, G.A[0], tA[0], B[1].head, capA, { avoid: B[1].head, before: [3, B[3].head] });
  // A2 = A1 with the second ending: dominant on bar 6, the tonic root held on bar 7
  B[7] = cadence(7, root(7), tA[2] - 1, capA, B[0].head);                      // bar 15 is this bar again, and leads back to bar 0
  B[6] = build(6, G.A[2], tA[2], B[7].head, capA, { after: B[1].a.seq[B[1].a.seq.length - 1] });
  B[5] = build(5, G.A[1], tA[1], B[6].head, capA, { like: B[1] });
  B[4] = build(4, G.A[0], tA[0], B[5].head, capA, { like: B[0] });
  // B: off the tonic, climbing to the peak on bar 10, then down to an open cadence.
  B[11] = cadence(11, open(11), peak - 4, capB, B[4].head);
  B[10] = build(10, G.B[2], peak, B[11].head, capB, { fixed: peak });          // only the head may touch the peak
  // bar 9 ends on the note the peak is reached from
  B[9] = build(9, G.B[1], peak + barch[1], end, capU, { end });
  B[8] = build(8, G.B[0], peak + barch[0], B[9].head, capU, { avoid: B[9].head, under: B[9].head, before: [7, B[7].head] });
  // A3 = A2 (the mixer plays it as the tutti)
  for (let i = 0; i < 4; i++) B[12 + i] = B[4 + i];
  return th;
}

// ----- one bar of the neutral theme in a meter
// Melodic cells: in /4 a cell is two beats (a three-beat group is two beats and a tail); in /8 a cell is a group.
function cellsOf(groups, ppb) {
  const out = []; let p = 0;
  for (const G of groups) {
    const P = G * ppb; let q = 0;
    if (ppb === 2) { while (P - q >= 4) { out.push({ p: p + q, len: 4, gh: q === 0, main: 1 }); q += 4; } if (P - q > 0) out.push({ p: p + q, len: P - q, gh: q === 0, main: 0 }); }
    else { while (P - q > 4) { out.push({ p: p + q, len: 3, gh: q === 0, main: 1 }); q += 3; } out.push({ p: p + q, len: P - q, gh: q === 0, main: 1 }); }
    p += P;
  }
  if (!out.some(c => c.main)) out[0].main = 1;
  return out;
}
// S takes one pulse; the L's share what is left, so the same symbols fit a 2-, 3- or 4-pulse cell. Where that
// leaves no room for a long note (three notes in a three-pulse group of 6/8), an /8 meter (`half`) splits the
// pulse instead: the S's take half a pulse each, and the cell keeps its long-against-short shape and all its
// notes. In /4 the pulse is never split (sixteenths belong to the dialects): a short cell drops the last notes.
function alloc(rh, P, half) {
  let all = 0; for (const ch of rh) if (ch === 'L') all++;
  if (half && all && P - (rh.length - all) < 2 * all) {
    const each = (P - (rh.length - all) / 2) / all;
    if (each >= 1 && each > 0.5 && Number.isInteger(each * 2)) return Array.from(rh, ch => (ch === 'L' ? each : 0.5));
  }
  // ... and four even notes keep all four: the inner ones are the quick ones (in a two-pulse cell, all of them)
  if (half && !all && rh.length > P && 2 * P >= rh.length) { const k = 2 * (rh.length - P), a0 = Math.floor((rh.length - k) / 2); return Array.from(rh, (ch, j) => (j >= a0 && j < a0 + k ? 0.5 : 1)); }
  const n = Math.min(rh.length, P), sym = rh.slice(0, n); let nL = 0; for (const ch of sym) if (ch === 'L') nL++;
  const out = [];
  if (!nL) { for (let j = 0; j < n; j++) out.push(1); out[n - 1] += P - n; return out; }
  const rest = P - (n - nL), each = Math.floor(rest / nL); let extra = rest - each * nL;
  for (const ch of sym) out.push(ch === 'L' ? each + (extra-- > 0 ? 1 : 0) : 1);
  return out;
}

// song must offer: theme, meter(beats, unit) -> { groups, accents, ppb }, pitchAt(idx, rank) -> midi.
// Returns [{ beat, o, d, n, s, c?, pk? }]: s = structural (group head, cadence goal, peak), c = the held
// cadence note, pk = the peak. d is the full written length; rests are the gaps. Onsets and lengths are whole
// pulses in /4 and whole or half pulses in /8 (o is 0 or 0.5 either way).
export function themeBar(song, idx, beats, unit) {
  const th = song.theme; idx = ((idx % 16) + 16) % 16;
  const bar = th.bars[idx], T = th.bars[(idx + 1) % 16].head;
  const { groups, accents, ppb } = song.meter(beats, unit), N = beats * ppb, half = ppb === 1;
  const isCT = r => ctAt(th, idx, r), cap = bar.cap, lean = th.lean, ns = [];
  const augAt = augOf(th), aug = (a, b) => augAt(idx, a, b), augX = (a, b) => augAt(idx, a, b, idx + 1);   // inside the bar; into the next head
  const add = (p, len, r, fx, more) => { const o = { p, len, r, fx: fx ? 1 : 0, gap: 0 }; if (more) Object.assign(o, more); ns.push(o); return o; };
  const heads = new Set(accents.map(a => a * ppb));
  if (bar.cad) {
    // The goal, held; a breath; then the pickup steps into the next phrase. A short bar keeps one pickup note
    // by holding the goal a pulse less. An open cadence (bars 3 and 11) hangs a pulse shorter than a closed one:
    // the breath after a question is the longer one.
    let full = 0;
    if (ppb === 2) full = Math.min(4, N - 2); else { for (const g of groups) { if (full + g > 4) break; full += g; } if (!full) full = Math.min(groups[0], 4); }
    const minRest = N < 4 ? 1 : ppb === 1 && N >= 7 ? 3 : 2;
    let K = Math.min(th.pickup, N >= 8 ? 2 : N >= 5 ? 1 : 0), s = Math.sign(T - bar.head) || lean;
    while (K > 0 && heads.has(N - K)) K--;                            // a pickup never starts on a group head
    let hold = Math.max(1, Math.min(full, N - minRest - K, N - (N >= 4 ? 2 : 1)));
    if ((idx & 7) !== 7 && hold > 2) hold--;
    add(0, hold, bar.head, 1, { c: 1, gap: 1 });
    // The pickup belongs to the next phrase (so it may use that bar's register): the longest stepwise run into
    // the next head that fits, from the cadence note's side for choice. It never steps across an augmented
    // second; where no step is left at all, one chord tone of this bar a third or a fourth from that head.
    const capP = Math.max(cap, th.bars[(idx + 1) % 16].cap);
    const fits = (d, k) => { if (aug(bar.head, T - d * k)) return false; for (let j = k; j >= 1; j--) { const r = T - d * j; if (r < 0 || r > capP || (j > 1 ? aug(r, T - d * (j - 1)) : augX(r, T))) return false; } return true; };   // (not even from the held note, across the breath)
    let run = null;
    for (let k = K; k >= 1 && !run; k--) for (const d of [s, -s]) if (fits(d, k)) { run = [d, k]; break; }
    if (run) for (let j = run[1]; j >= 1; j--) add(N - j, 1, T - run[0] * j, 0);
    else if (K > 0) { for (const d of [2 * s, -2 * s, 3 * s, -3 * s, 4 * s, -4 * s, 0]) if (T + d >= 0 && T + d <= capP && isCT(T + d) && !aug(bar.head, T + d)) { add(N - 1, 1, T + d, 0); break; } }
  } else {
    const cells = cellsOf(groups, ppb), mains = cells.filter(c => c.main), A = mains[0];
    const B = mains.length > 1 ? mains[mains.length - 1] : cells[cells.indexOf(A) + 1] || null;
    const lay = (c, f, lens) => { let p = c.p; lens.forEach((len, j) => { add(p, len, f.seq[j], j === 0 && heads.has(p)); p += len; }); };
    for (const c of cells) {
      if (c === A) {
        let lens = alloc(bar.a.rh, c.len, half);
        if (idx === 10 && lens[0] < 2) lens = [c.len];                // the peak is held two pulses or more, in a short cell alone
        lay(c, bar.a, lens); for (const n of ns) n.hk = 1;           // the hook cell: its rhythm is the tune's signature
      } else if (c === B && bar.up != null) {
        // the climb into the peak: the cell's head, then passing notes up to the last pulse, which carries bar.up
        const E = bar.up, M = bar.mid, e = ns[ns.length - 1].r;
        if (!c.main) add(c.p, c.len - 1, Math.abs(e - (E - 1)) <= 2 && !aug(E - 1, E) ? E - 1 : M, heads.has(c.p));       // the tail of 3/4: one note, then bar.up
        else {
          let K = Math.max(0, Math.min(E - M - 1, c.len - 2));
          if (E - K - M > 2) K = 0;                                                                                      // the run would start with a leap into a passing note
          for (let j = K; j >= 0 && K; j--) if (aug(j === K ? M : E - j - 1, E - j)) K = 0;                              // no passing note across an augmented second
          if (c.len > 1) add(c.p, c.len - K - 1, M, heads.has(c.p));
          for (let j = K; j >= 1; j--) add(c.p + c.len - 1 - j, 1, E - j, 0);
        }
        add(c.p + c.len - 1, 1, E, c.len === 1 && heads.has(c.p));
      } else if (c === B && bar.hold) {
        const h = c.len >= 3 ? Math.ceil(c.len / 2) : 1;
        add(c.p, h, bar.mid, heads.has(c.p), { gap: h < c.len ? 1 : 0 });
      } else if (c === B && !c.main) {
        // the tail of 3/4 has two pulses for the second figure: one that starts long keeps its first note for
        // the whole tail, one that starts short keeps its first two as eighths, so hook and answer still differ
        const f = bar.b; lay(c, f, f.rh[0] === 'L' || f.seq.length < 2 || c.len < 2 ? [c.len] : [1, c.len - 1]);
      } else if (c === B) lay(c, bar.b, alloc(bar.b.rh, c.len, half));
      else {
        // A connecting cell leads into the next structural note X. A two-pulse cell inside the bar (the third beat
        // of 5/4) does it the way this song does (th.link): a short run that steps into X, X's own neighbour
        // figure, or one held chord tone on the way; whichever of these does not just wobble between the two
        // pitches before it. Any other connecting cell is the run.
        const X = B && c.p < B.p ? bar.mid : T, inBar = !!(B && c.p < B.p), prev = ns[ns.length - 1], e = prev ? prev.r : bar.head;
        const s = Math.sign(X - e) || lean, m = Math.min(c.len, 3), first = c.len - (m - 1), gh = heads.has(c.p);
        if (inBar && c.len === 2 && prev && !prev.gap) {
          const p2 = ns.length > 1 ? ns[ns.length - 2].r : null, inR = r => r >= 0 && r <= cap, eCT = isCT(e);
          const after = bar.up != null ? (bar.up - X > 1 && B.len > 2 && !aug(bar.up - 1, bar.up) ? bar.up - Math.min(bar.up - X - 1, B.len - 2) : bar.up) : bar.hold || !bar.b || bar.b.seq.length < 2 ? null : bar.b.seq[1];   // the note that will follow X
          const runs = [[X - 2 * s, X - s], [X + 2 * s, X + s]], nbrs = [[X, X - s], [X, X + s]], holds = [];
          for (let r = X - s; r !== e - s && holds.length < 2; r -= s) if (isCT(r) && r !== e) holds.push([r]);
          const order = th.link === 1 ? [nbrs[0], nbrs[1], runs[0], ...holds, runs[1]] : th.link === 2 ? [...holds, runs[0], nbrs[0], runs[1], nbrs[1]] : [runs[0], ...holds, nbrs[0], runs[1], nbrs[1]];
          const good = q => {
            if (!q.every(inR) || q[0] === e || (!eCT && (Math.abs(q[0] - e) !== 1 || aug(e, q[0]))) || ((gh || q.length === 1) && !isCT(q[0]))) return false;
            const line = [...q, X]; for (let j = 0; j < q.length; j++) if (aug(line[j], line[j + 1]) || (!isCT(q[j]) && Math.abs(line[j + 1] - q[j]) !== 1)) return false;
            if (Math.abs(q[0] - e) > (isCT(q[0]) ? 3 : 2)) return false;                     // a non-chord tone is entered by a step or a third
            const w = [p2, e, ...q, X]; if (after != null) w.push(after);
            for (let j = 3; j < w.length; j++) if (w[j] === w[j - 2] && w[j - 1] === w[j - 3] && w[j] !== w[j - 1]) return false;
            return true;
          };
          const q = order.find(good);
          if (q) { if (q.length === 1) add(c.p, 2, q[0], gh); else { add(c.p, 1, q[0], gh); add(c.p + 1, 1, q[1], 0); } continue; }
        }
        let seq = []; for (let j = m; j >= 1; j--) seq.push(X - s * j);
        if (seq.some(r => r < 0 || r > cap)) seq = seq.map((r, j) => X + s * (m - j));
        seq = seq.map(r => Math.max(0, Math.min(cap, r)));
        if (prev && !prev.gap && !isCT(e)) { const up = isCT(e + 1) && e + 1 <= cap, dn = isCT(e - 1) && e - 1 >= 0; seq[0] = up && (s > 0 || !dn) ? e + 1 : dn ? e - 1 : seq[0]; }
        if ((gh || first > 1) && !isCT(seq[0])) { for (const d of [s, -s, 2 * s, -2 * s]) if (seq[0] + d >= 0 && seq[0] + d <= cap && isCT(seq[0] + d)) { seq[0] += d; break; } }
        let p = c.p; seq.forEach((r, j) => { const len = j === 0 ? first : 1; add(p, len, r, j === 0 && heads.has(p)); p += len; });
      }
    }
    const z = ns[ns.length - 1], pv = ns.length > 1 ? ns[ns.length - 2].r : z.r;
    if (bar.up != null) {
      // a bar too short for the climb still ends on the note the peak is reached from
      if (z.r !== bar.up && !z.gap && z.p + z.len === N) { if (z.len <= 1 && !z.fx) z.r = bar.up; else if (z.len > 1) { z.len--; add(N - 1, 1, bar.up, 0); } }
    } else if (!z.gap && z.p + z.len === N) {
      // The barline: the last note leads into the next bar's head by a true step, or sits within a third of it.
      // A chord tone within a third of that head may stand (it is part of a figure). Anything else becomes the
      // head's neighbour when that is no more than a third from the note before it; a line that is further
      // away lands on a chord tone between the two instead, so the leap is not just moved one note back.
      // (an augmented second or a tritone into the next head is no way to cross a barline)
      const triX = r => Math.abs(semOf(th.sc[idx], th.base, r) - semOf(th.sc[(idx + 1) & 15], th.base, T)) === 6;
      const gap = Math.abs(T - z.r), bad = augX(z.r, T) || triX(z.r), ok = r => r >= 0 && r <= cap && !augX(r, T) && !triX(r);
      const swap = z.len <= 1 && !z.fx, from = swap ? pv : z.r;       // the note the new last note is reached from
      const L = ns.length - (swap ? 1 : 0), wob = r => L > 2 && r === ns[L - 2].r && from === ns[L - 3].r && r !== from;    // it would only go back and forth
      const pickEnd = () => {
        const s = Math.sign(T - from) || Math.sign(T - z.r) || lean;
        for (const r of [T - s, T + s]) if (ok(r) && r !== from && Math.abs(r - from) <= 2 && !wob(r)) return r;
        // a chord tone within a third of the head and no more than a fifth from the line; failing that, one between the two
        let best = null, bc = 99;
        for (let r = Math.max(0, T - 4); r <= Math.min(cap, T + 4); r++) if (isCT(r) && r !== T && r !== from && ok(r)) { const dT = Math.abs(r - T), dF = Math.abs(r - from), c = (dT <= 2 && dF <= 4 ? dF / 10 : 1 + Math.max(dF, dT + 0.5)) + (wob(r) ? 0.45 : 0); if (c < bc) { bc = c; best = r; } }
        return best != null ? best : ok(T - s) ? T - s : ok(T + s) ? T + s : null;
      };
      if (z.len <= 1 && !z.fx) {
        if (bad || !(gap === 1 || (gap === 2 && isCT(z.r)))) { const r = pickEnd(); if (r != null) z.r = r; }
      } else if (z.len > 1 && (bad || (gap >= 3 && !z.fx && !z.hk))) {            // (a long note of the hook cell is never split: 2/4)
        const r = pickEnd(); if (r != null && r !== z.r) { z.len--; add(N - 1, 1, r, 0); }
      }
    }
    legalize(ns, isCT, T, 0, cap, 1, aug, augX);
  }
  const out = [];
  for (const a of ns) {
    const o = { beat: Math.floor(a.p / ppb), o: (a.p % ppb) / ppb, d: a.len / ppb, n: song.pitchAt(idx, a.r), s: a.fx ? 1 : 0 };
    if (a.c) o.c = 1; if (idx === 10 && a.p === 0) o.pk = 1;
    out.push(o);
  }
  return out;
}

// ----- lead dialects: the same bar in a genre's accent
// P = { fill, thin, push, art, penta, orn, dev? }. ctx is the Frame (beats, ppb, accents, tonic, chord, clave,
// pos, sec, seed, cap, peak, lo, penta).
//   thin   drops notes between structural ones and lets the note before ring (the barline note always stays)
//   push   a structural note on a later group head arrives a pulse early, when the clave is there
//   fill   a long note gives its last pulses to notes that lead on; from 0.8 it is a motor with a lilt.
//          A diatonic motor (baroque) runs in even pulses and splits the pulse before the beat; a pentatonic
//          one (celtic) is dotted (one quick lead-in at the end of the long note) and splits the pulse on it
//   penta  decorative non-chord tones move onto the five-note subset
//   orn    ornaments (a field on the note); 'echo' is chiprock's quiet answer at the end of a long note
//   dev    one device for a dialect with no ornament of its own (music.js names them for the packs):
//          'clave'  latin: every clave-hit head is pushed, and in a bar of one group the note on the last
//                   clave hit; a held cadence note is struck again on the clave
//          'above'  jazz: laid back (a long note after a structural one comes in a pulse late); fills approach
//                   the next note from above; a held cadence note falls off to the chord tone under it
//          'chug'   metal: a held structural note is re-struck on every pulse
//          'stab'   funk: a held first note of the bar is hit twice, on the one and on the pulse after it
// Each dialect rolls its own dice (saltOf), so two of them never decorate the same places by construction.
// Structural notes keep their pitch whatever happens; only push may move their onset. The peak is struck once
// and keeps its two pulses; bars 8 and 9 stay under their cap; no step is an augmented second.
// Output events: { o, d, v, n, p, s, orn?, on?, echo? }. p: 0 structural, 1 the written tune, 2 fills,
// re-strikes and echoes, 3 sixteenths (in /8 a split pulse sits at o 0.5 and is p2: it survives tier 1).
function saltOf(P) {
  let h = 0x811C9DC5 | 0; const mix = v => { h = Math.imul(h ^ (v | 0), 0x01000193); };
  for (const v of [P.fill || 0, P.thin || 0, P.push || 0, P.art == null ? 1 : P.art]) mix(Math.round(v * 1000) + 1);
  mix(P.penta ? 7 : 3); for (const ch of (P.orn || []).join(',') + '/' + (P.dev || '')) mix(ch.charCodeAt(0));
  return h;
}
export function dialect(notes, P, ctx) {
  const { beats, ppb, tonic, chord } = ctx, sc = chord.scale, tpp = 4 / ppb, END = beats * 4, dev = P.dev || '', seed = (ctx.seed ^ saltOf(P)) | 0;
  const kOf = n => { const x = n - tonic; return 7 * Math.floor(x / 12) + sc.indexOf((((x % 12) + 12) % 12)); };
  const pit = k => tonic + 12 * Math.floor(k / 7) + sc[((k % 7) + 7) % 7];
  const isCT = k => chord.pcs.includes(sc[((k % 7) + 7) % 7]);
  const hiK = ctx.cap != null ? kOf(ctx.cap) : 999, loK = ctx.lo != null ? kOf(ctx.lo) : -999, top = ctx.peak != null ? ctx.peak : 999;
  const ph = (ctx.sec === 'B' ? 4 : 0) + (ctx.pos | 0), u = (a, salt) => unit(seed, ph, a, salt);
  const ag = (a, b) => Math.abs(a - b) === 1 && Math.abs(pit(a) - pit(b)) === 3;      // an augmented second is not a step
  const clean = (a, path, b) => { let p = a; for (const k of path) { if (ag(p, k)) return false; p = k; } return !ag(p, b); };
  // upper neighbour, unless it would top the cap or lie across an augmented second (then the lower one, or none)
  const nb = k => (k + 1 <= hiK && !ag(k, k + 1) ? k + 1 : k - 1 >= loK && !ag(k, k - 1) ? k - 1 : null);
  const joined = (a, b) => a.t + a.len === b.t;
  let L = notes.map(n => ({ t: Math.round((n.beat + n.o) * 4), len: Math.round(n.d * 4), k: kOf(n.n), s: n.s ? 1 : 0, c: n.c, pk: n.pk, kind: 0 }));
  if (L.length) L[L.length - 1].z = 1;                                    // the bar's last note is left alone: it owns the barline

  // thin: keep the notes that lead INTO a structural note, drop the ones after it and let it ring
  if (P.thin > 0) {
    const out = []; let i = 0;
    while (i < L.length) {
      if (L[i].s) { out.push(L[i++]); continue; }
      let j = i; while (j < L.length && !L[j].s) j++;
      let keep = Math.round((1 - P.thin) * (j - i)); const pv = out[out.length - 1];
      if (!keep && j === L.length && L[j - 1].t + L[j - 1].len === END) keep = 1;        // the note that reaches the barline leads into the next bar: it stays
      // a structural note more than a third away keeps the note that leads into it, if that one is nearer
      if (!keep && j < L.length && pv && Math.abs(L[j].k - pv.k) > 2 && Math.abs(L[j].k - L[j - 1].k) <= 2) keep = 1;
      // a dropped note may not leave an augmented second between the note that rings on and the next one kept
      while (keep > 0 && keep < j - i && pv && ag(pv.k, L[j - keep].k)) keep++;
      for (let q = i; q < j; q++) {
        const a = L[q], bf = out[out.length - 1], tied = bf && joined(bf, a);
        // a kept note that only says the ringing note again, or the structural note it leads into, goes as well
        const dull = q >= j - keep && tied && (bf.k === a.k || (q === j - 1 && j < L.length && L[j].k === a.k && !ag(bf.k, L[j].k)));
        if (q >= j - keep && !dull) { out.push(a); continue; }
        if (tied && (bf.s || dull)) { bf.len += a.len; if (a.z) bf.z = 1; }
      }
      i = j;
    }
    L = out;
  }
  // push: a structural note on a later group head arrives one pulse early and is tied over, when that head
  // or the pulse it lands on is a clave hit. Never the bar head, so never across a barline. The notes that
  // start inside the pulse it takes give way (never a structural or a cadence note); the one before is cut,
  // but the peak keeps its two pulses. Only sounding time is taken, never a rest.
  if (P.push > 0 && ctx.clave) {
    const take = i => {
      const x = L[i], dest = x.t - tpp; let j = i - 1; while (j >= 0 && L[j].t >= dest) j--;
      const q = j >= 0 ? L[j] : null;
      let at = dest; for (let k = Math.max(0, j); k < i; k++) { if (L[k].t > at) return false; at = Math.max(at, L[k].t + L[k].len); } if (at < x.t) return false;
      if (L.slice(j + 1, i).some(y => y.s || y.c) || (q && q.t + q.len >= dest && ag(q.k, x.k)) || (q && q.pk && dest - q.t < 2 * tpp)) return false;
      L.splice(j + 1, i - j - 1); if (q && q.t + q.len > dest) q.len = dest - q.t;
      x.t = dest; x.len += tpp; x.pu = 1; return true;
    };
    for (const a of ctx.accents) {
      if (a === 0) continue;
      const hp = a * ppb, i = L.findIndex(x => x.s && x.t === hp * tpp);
      if (i < 1 || !(ctx.clave.includes(hp) || ctx.clave.includes(hp - 1)) || (dev !== 'clave' && u(hp, 1) >= P.push)) continue;
      take(i);
    }
    // the clave lock in a bar of one group (3/4 has no later head): the chord tone on the last clave hit comes early instead
    if (dev === 'clave' && ctx.accents.length === 1) { const hp = ctx.clave[ctx.clave.length - 1], i = L.findIndex(x => x.t === hp * tpp); if (hp > 0 && i >= 1 && !L[i].s && !L[i].c && isCT(L[i].k)) take(i); }
  }
  // jazz lays back: a note of two pulses or more that follows a structural note comes in one pulse late.
  // The held cadence note falls off, on its last pulse, to the chord tone under it (it keeps a beat or more).
  if (dev === 'above') {
    for (let i = 0; i + 1 < L.length; i++) { const a = L[i], n = L[i + 1]; if (a.s && !a.c && !a.pu && !n.s && joined(a, n) && n.len >= 2 * tpp) { a.len += tpp; n.t += tpp; n.len -= tpp; } }
    const i = L.findIndex(x => x.c);
    // (When nothing follows it in the bar it does not land on the sixth or seventh degree: in a minor key
    // those are an augmented second apart, and the next bar's head is not known here.)
    const six7 = k => { const g = ((k % 7) + 7) % 7; return g === 5 || g === 6; };
    if (i >= 0 && L[i].len >= 3 * tpp) { let d = L[i].k - 1; while (d >= loK && (!isCT(d) || (L[i + 1] ? ag(d, L[i + 1].k) : six7(d)))) d--; if (d >= loK) { L[i].len -= tpp; L.splice(i + 1, 0, { t: L[i].t + L[i].len, len: tpp, k: d, s: 0, kind: 1 }); } }
  }
  // fill: a long note gives its last pulses to passing tones that walk to the next note
  if (P.fill > 0) {
    // A pentatonic motor (celtic) is dotted: its lead-in is one quick note on the last half pulse of the long
    // note (a sixteenth in /4), where a diatonic one (baroque) runs in even pulses.
    const out = [], motor = P.fill >= 0.8, half = tpp / 2, quick = motor && !!P.penta, sub = ppb === 2 ? 2 : 1;   // a split pulse is a sixteenth (p3) only in /4
    for (let i = 0; i < L.length; i++) {
      const a = L[i], b = L[i + 1], m = quick ? (a.len - half >= (a.pk ? 2 : 1) * tpp ? 1 : 0) : Math.floor(a.len / tpp) - (a.pk ? 2 : 1);
      if (m < 1 || a.c || a.pu || !b || !joined(a, b) || u(a.t, 2) >= P.fill) { out.push(a); continue; }
      const D = b.k - a.k, sg = Math.sign(D); let path = [];
      // jazz comes down onto the next note from its upper neighbour, wherever the line came from
      if (dev === 'above' && b.k + 1 <= hiK && b.k + 1 !== a.k && Math.abs(b.k + 1 - a.k) <= 4) path = [b.k + 1];
      else if (D === 0) path = [nb(a.k)];                                                // unison: a neighbour note
      else if (Math.abs(D) === 1) { const ov = b.k + sg; path = [ov <= hiK && ov >= loK && !ag(ov, b.k) ? ov : a.k]; }   // a step: overshoot and fall back
      else for (let q = Math.min(m, Math.abs(D) - 1); q >= 1; q--) path.push(b.k - sg * q);          // wider: run into it
      if (path[0] == null || !clean(a.k, path, b.k)) { out.push(a); continue; }           // no way round the augmented second: the note stays whole
      if (quick) { if (path[0] !== a.k) { a.len -= half; out.push(a, { t: a.t + a.len, len: half, k: path[path.length - 1], s: 0, kind: sub }); } else out.push(a); continue; }
      if (motor) while (path.length < m) { const n1 = nb(a.k); if (m - path.length >= 2 && n1 != null) path.unshift(n1, a.k); else path.unshift(a.k); }
      a.len -= path.length * tpp; out.push(a);
      path.forEach((k, j) => out.push({ t: a.t + a.len + j * tpp, len: tpp, k, s: 0, kind: 1 }));
    }
    L = out;
    // The lilt of a motor: one pulse-long note splits in two (in /4 an eighth into sixteenths, in /8 a pulse
    // into halves). A diatonic motor splits the note before the beat (long-short-short), a pentatonic one the
    // note on it (short-short-long): baroque and celtic never lilt in the same place.
    if (motor) {
      const o2 = [], jig = !!P.penta;
      for (let i = 0; i < L.length; i++) {
        const r = L[i], b = L[i + 1]; o2.push(r);
        const pulse = Math.round(r.t / tpp), on = ppb === 2 ? pulse % 2 === 0 : ctx.accents.includes(pulse) || ctx.accents.includes(pulse - 1), site = r.t % tpp === 0 && (jig ? on : !on);
        if (r.s || r.len !== tpp || !site || !b || !joined(r, b) || u(r.t, 3) >= (P.fill - 0.7) / 0.3) continue;
        const D = b.k - r.k, sg = Math.sign(D), ct = isCT(r.k); let ins = null;
        if (Math.abs(D) === 2) ins = r.k + sg; else if (!ct) continue;
        else if (D === 0) ins = nb(r.k); else if (Math.abs(D) >= 3) ins = b.k - sg; else { const ov = b.k + sg; if (ov <= hiK && ov >= loK) ins = ov; }
        if (ins == null || ag(r.k, ins) || ag(ins, b.k)) continue;
        r.len = half; o2.push({ t: r.t + half, len: half, k: ins, s: 0, kind: sub });
      }
      L = o2;
    }
  }
  // Re-strikes. latin: the held cadence note is struck again on every clave hit it spans. metal: a held
  // structural note is re-struck on every pulse. funk: the bar's first note, when it is held, is hit twice
  // (on the one and on the pulse after) in three bars of five. Never the peak: the top note is struck once.
  if (dev === 'clave' || dev === 'chug' || dev === 'stab') {
    const out = [];
    for (const a of L) {
      out.push(a); if (a.kind || a.pk || !(dev === 'clave' ? a.c : dev === 'stab' ? a.s && a.t === 0 && u(0, 6) < 0.6 : a.s)) continue;
      const end = a.t + a.len, cuts = [];
      for (let t = (Math.floor(a.t / tpp) + 1) * tpp; t < end; t += tpp) if (dev === 'chug' || (dev === 'stab' ? !cuts.length : ctx.clave && ctx.clave.includes(t / tpp))) cuts.push(t);
      let prev = a; for (const t of cuts) { prev.len = t - prev.t; prev = { t, len: end - t, k: a.k, s: 0, kind: 1 }; if (a.z) { prev.z = 1; a.z = 0; } out.push(prev); }
    }
    L = out;
  }
  // pentatonic: decorative non-chord tones off the five-note subset move to the neighbour that is on it,
  // unless that only repeats the note before or after (then the passing note stays as it is)
  if (P.penta && ctx.penta) {
    for (let i = 0; i < L.length; i++) {
      const a = L[i]; if (a.s || a.z || isCT(a.k) || ctx.penta.includes(((a.k % 7) + 7) % 7)) continue;
      const nx = L[i + 1], pv = L[i - 1], up = a.k + 1, dn = a.k - 1;
      let k = nx && nx.k === up ? dn : nx && nx.k === dn ? up : pv && pv.k < a.k ? up : dn;
      if (k > hiK) k = dn;
      if ((pv && pv.k === k) || (nx && nx.k === k) || k < loK) continue;
      a.k = k;
    }
  }
  if (P.penta || P.push > 0 || P.fill > 0 || P.thin > 0 || dev) {
    const ns = L.map((a, i) => ({ r: a.k, p: a.t, len: a.len, fx: a.s || a.z || a.kind === 0 && !P.penta && !P.push && !P.thin, gap: !L[i + 1] || !joined(a, L[i + 1]), a }));
    legalize(ns, isCT, null, loK, hiK, tpp, ag); ns.forEach(x => { x.a.k = x.r; });
    // the last resort: a decoration that still sits an augmented second from its neighbour is taken out again
    for (let i = 0; i + 1 < L.length; i++) {
      const a = L[i], b = L[i + 1]; if (!joined(a, b) || !ag(a.k, b.k)) continue;
      const free = x => !x.s && !x.z, d = free(b) ? i + 1 : free(a) && i > 0 && joined(L[i - 1], a) ? i : -1;
      if (d < 0) continue;
      L[d - 1].len += L[d].len; L.splice(d, 1); i = Math.max(-1, i - 2);
    }
  }
  // chiprock's echo: a long note keeps the first half of its length (a beat or more in /4) and answers itself
  // quietly on its last pulse. Not the peak: the top note is struck once.
  if ((P.orn || []).includes('echo')) {
    const out = [];
    for (const a of L) {
      out.push(a); const n = a.len / tpp, main = Math.max(Math.ceil(n / 2), ppb === 2 ? 2 : 1);
      if (a.kind !== 0 || a.pk || a.pu || !Number.isInteger(n) || main >= n) continue;
      out.push({ t: a.t + a.len - tpp, len: tpp, k: a.k, s: 0, kind: 3, z: a.z }); a.len = main * tpp;
    }
    L = out;
  }
  // ornaments: a field on the note, one per group, never on anything shorter than half a beat
  const grp = t => { let g = 0; for (let k = 0; k < ctx.accents.length; k++) if (ctx.accents[k] * 4 <= t) g = k; return g; }, used = new Set();
  const up = k => (pit(k + 1) < top && k + 1 <= Math.max(hiK, k) ? k + 1 : k - 1);
  for (const typ of P.orn || []) for (let i = 0; i < L.length; i++) {
    const a = L[i], pv = L[i - 1]; if (a.orn || a.kind >= 2 || a.len < 2 || used.has(grp(a.t))) continue;
    let on = null;
    if (typ === 'trill') { if (a.c || a.len >= 6) on = pit(up(a.k)); }
    else if (typ === 'mordent') { if (a.s && u(a.t, 4) < 0.6) on = pit(up(a.k)); }
    else if (typ === 'cut') { if (a.s || (pv && pv.k === a.k)) on = pit(up(a.k)); }
    else if (typ === 'glide') { if (pv && joined(pv, a) && (a.c || a.pk || (a.s && Math.abs(pv.k - a.k) >= 2))) on = pit(pv.k); else if (a.c || a.pk) on = pit(a.k - 1); }
    else if (typ === 'bend') { if (a.len >= 2 * tpp) on = pit(a.k - 1); }
    else if (typ === 'flip') { if (a.s && a.t === 0 && (ctx.pos === 0 || u(0, 5) < 0.5)) on = pit(a.k) + (a.k + 7 <= hiK ? 12 : -12); }   // the octave above, unless that would leave the bar's register
    if (on != null) { a.orn = typ; a.on = on; used.add(grp(a.t)); }
  }
  const ev = Array.from({ length: beats }, () => []);
  for (const a of L) {
    const beat = Math.floor(a.t / 4); if (beat < 0 || beat >= beats) continue;
    const o = (a.t % 4) / 4, len = a.len / 4;
    const e = {
      o, d: Math.min(Math.max(Math.min(len, 0.2), len * P.art), beats - beat - o),
      v: a.kind === 3 ? 0.3 : a.s ? (a.t === 0 ? 0.95 : 0.88) : a.kind === 0 ? 0.74 : a.kind === 1 ? 0.62 : 0.5,
      n: pit(a.k), p: a.s ? 0 : a.kind === 0 ? 1 : a.kind === 2 ? 3 : 2, s: a.s,
    };
    if (a.orn) { e.orn = a.orn; e.on = a.on; }
    if (a.kind === 3) e.echo = 1;
    ev[beat].push(e);
  }
  for (const l of ev) l.sort((x, y) => x.o - y.o);
  return ev;
}

// The wheel's part: for each beat the nearest chord tone 3..9 semitones under the sounding theme note; while
// the tune rests it stays on the chord tone nearest to where it was.
export function runeLine(notes, ctx) {
  const out = [], tone = n => ctx.chord.pcs.includes((((n - ctx.tonic) % 12) + 12) % 12);
  let prev = null;
  for (let b = 0; b < ctx.beats; b++) {
    let snd = null;
    for (const n of notes) { const st = n.beat + n.o; if (st <= b + 1e-9 && st + n.d > b + 1e-9) snd = n; }
    if (!snd) snd = notes.find(n => n.beat === b) || null;
    let r = null;
    if (snd) { for (let x = snd.n - 3; x >= snd.n - 9; x--) if (tone(x)) { r = x; break; } }
    if (r == null) { const ref = prev != null ? prev : ctx.voicing[ctx.voicing.length - 1]; for (let k = 0; k < 12 && r == null; k++) r = tone(ref - k) ? ref - k : tone(ref + k) ? ref + k : null; }
    out.push(r); prev = r;
  }
  return out;
}

// What a note is doing against the harmony. note/prev/next are midi numbers (or notes with .n); prev and next
// are null across a rest. ctx = { chord, tonic }; nextCtx is the following note's frame when it sits in the
// next bar. Returns 'ct', 'pass' (stepped in and out, same direction), 'nbr' (stepped in and out, back again),
// 'step' (leapt or rested in, stepped out) or 'bad' (a non-chord tone that does not leave by step; the three
// semitones between b6 and the raised 7 of a minor key are not a step).
export function classifyNCT(note, prev, next, ctx, nextCtx) {
  const m = x => (x == null ? null : typeof x === 'number' ? x : x.n), n = m(note), p = m(prev), q = m(next);
  const pc = (x, c) => (((x - c.tonic) % 12) + 12) % 12;
  if (ctx.chord.pcs.includes(pc(n, ctx))) return 'ct';
  const adj = (a, b) => { const d = Math.abs(a - b); return d === 1 || d === 2; };     // a step is a semitone or a tone; an augmented second is not one
  if (q == null || !adj(n, q)) return 'bad';
  if (p == null || !adj(p, n)) return 'step';
  return Math.sign(n - p) === Math.sign(q - n) ? 'pass' : 'nbr';
}

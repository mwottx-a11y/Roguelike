// HEXBEAT — the tune. Pure data, no audio, no imports.
//
// One song has ONE theme. It is composed once from the seed as ladder ranks (rank 0 is the bottom of the lead
// register, one rank is one scale step), so it does not know the genre, the meter or even the exact mode:
//   - two short figures, x (the hook) and y (its answer), each a rhythm cell plus a contour;
//   - a phrase grammar that states, restates and answers them over four bars;
//   - a held cadence note and a breath at the end of every phrase, with a pickup into the next one;
//   - one highest note, on the downbeat of bar 10 (the bridge), and nowhere else.
// themeBar() lays one bar of it onto any meter; dialect() performs that bar in a genre's accent without ever
// moving a structural note; runeLine() derives the harmony part the wheel plays under it.
//
// Rules that hold by construction (tools/t/theme.mjs checks them on data):
//   every note is in the bar's scale; every note on a group head is a chord tone; a non-chord tone lasts one
//   pulse and leaves by step; the bar's first pitch is the same in every meter; no chromatic material anywhere.

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
const SHAPES = Object.keys(MOVES);
// Phrase grammars. Each bar has two roles (first group, last group): x, y, X/Y (the figure upside down),
// H (hold the group head, then rest), P (the peak: the hook's rhythm falling from the top note).
// Bar 3 of every phrase is the cadence. Every A phrase states x on at least two bar heads.
const GRAM = {
  sentence: { A: ['xy', 'xH', 'xx'], B: ['yy', 'yH', 'Px'] },   // idea, idea again, fragments, cadence
  period: { A: ['xy', 'yH', 'xy'], B: ['yx', 'yH', 'Py'] },     // antecedent, consequent
  echo: { A: ['xx', 'yH', 'xy'], B: ['Xy', 'XH', 'Py'] },       // the hook answers itself; the bridge inverts it
  call: { A: ['xH', 'xy', 'yx'], B: ['yY', 'yH', 'Px'] },       // a call, a breath, then the full reply
};
const ARCH = [[0, 2, 4], [4, 2, 0], [0, 3, 1], [3, 0, 2], [1, 4, 2], [2, 0, 3], [0, 1, 3], [3, 1, 0]];
const BARCH = [[-6, -3], [-4, -6], [-5, -4], [-3, -5]];           // bridge bar heads relative to the peak

const ctOf = (base, deg, r) => { const d = (((base + r - deg) % 7) + 7) % 7; return d === 0 || d === 2 || d === 4; };
export const ctAt = (th, idx, r) => ctOf(th.base, th.deg[idx], r);
// cheap integer hash -> [0, 1): the dialect's dice. Keyed by phrase position, never by bar index, so a
// restated phrase is ornamented the same way.
function unit(seed, a, b, c) {
  let h = (seed ^ Math.imul(a + 1, 0x9E3779B1) ^ Math.imul(b + 7, 0x85EBCA6B) ^ Math.imul(c + 13, 0xC2B2AE35)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2C1B3C6D); h = Math.imul(h ^ (h >>> 12), 0x297A2D39); return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

// Make a run of notes legal, right to left. ns[i] = { r, len (pulses), fx (may not move), gap (a rest follows) }.
// A non-chord tone may stay only if it lasts one pulse and the next note is one step away; otherwise it slides
// along its direction of travel until it is next door to the following note, or lands on a chord tone.
function legalize(ns, isCT, nextR, lo, hi, long = 1) {
  for (let j = ns.length - 1; j >= 0; j--) {
    const a = ns[j]; if (a.fx || isCT(a.r)) continue;
    const nx = a.gap ? null : j + 1 < ns.length ? (ns[j].p == null || ns[j].p + ns[j].len === ns[j + 1].p ? ns[j + 1].r : null) : nextR;
    if (a.len <= long && nx != null && Math.abs(nx - a.r) === 1) continue;
    const pv = j > 0 ? ns[j - 1].r : a.r, inDir = Math.sign(a.r - pv);
    if (a.len <= long && nx != null) {
      const s = Math.sign(nx - a.r), cand = nx - s;
      if (s !== 0 && (inDir === 0 || inDir === s) && cand >= lo && cand <= hi && cand !== pv) { a.r = cand; continue; }
    }
    const d0 = inDir || (nx != null ? Math.sign(nx - a.r) : 0) || 1;
    let done = false;
    for (const d of [d0, -d0]) { for (let t = 1; t <= 3 && !done; t++) { const r = a.r + d * t; if (r < lo || r > hi) break; if (isCT(r)) { a.r = r; done = true; } } if (done) break; }
  }
  return ns;
}

// One figure from a starting rank. Returns the ranks, or null when it leaves [lo, hi] (the caller then tries
// another starting note; with `bounce` an out-of-range move is turned around instead).
function figure(isCT, f, start, lo, hi, leap, dir, bounce) {
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
  const ns = out.map((r, j) => ({ r, len: f.rh[j] === 'L' ? 2 : 1, fx: j === 0 }));
  const last = ns.pop(); legalize(ns, isCT, last.r, lo, hi);
  const res = ns.map(x => x.r); res.push(last.r);
  return res.every((r, j) => j === 0 || (r >= lo && r <= hi)) ? res : null;   // the start is the caller's choice
}

// plan = { deg: [16 chord degrees, 0..6], base: degree index of rank 0 }. R is the song's theme rng.
export function composeTheme(R, plan) {
  const { deg, base } = plan, pick = a => a[Math.floor(R() * a.length)];
  const x = { rh: pick(RH_X), shape: pick(SHAPES), dir: R() < 0.5 ? 1 : -1 };
  let y; do y = { rh: pick(RH_Y), shape: pick(SHAPES), dir: R() < 0.5 ? 1 : -1 }; while (y.rh === x.rh || y.shape === x.shape);
  // one of the two must carry a real interval, or the tune is all steps
  if (!['leapfill', 'arp', 'pendulum'].includes(x.shape) && !['leapfill', 'arp', 'pendulum'].includes(y.shape)) (R() < 0.6 ? x : y).shape = R() < 0.6 ? 'leapfill' : 'arp';
  const gram = pick(Object.keys(GRAM)), leap = 3 + Math.floor(R() * 3), pickup = Math.floor(R() * 3), lean = R() < 0.5 ? 1 : -1;
  const arch = pick(ARCH), b0 = 1 + Math.floor(R() * 3), barch = pick(BARCH);
  const ct = (i, r) => ctOf(base, deg[i], r);
  // the peak: the highest chord tone of bar 10. Everything else stays 3 ranks (A) or 1 rank (B) below it.
  let peak = RMAX; while (!ct(10, peak)) peak--;
  const capA = peak - 3, capB = peak - 1;
  const th = { x, y, gram, leap, pickup, lean, arch, peak, capA, capB, base, deg: deg.slice(), bars: new Array(16), bounced: 0, plain: 0 };   // bounced / plain count the bars that needed a last resort
  const figOf = sym => { const f = sym === 'x' || sym === 'X' || sym === 'P' ? x : y; return { f, dir: (sym === 'X' || sym === 'Y' ? -1 : 1) * f.dir }; };
  const cts = (i, lo, hi) => { const o = []; for (let r = lo; r <= hi; r++) if (ct(i, r)) o.push(r); return o; };
  const near = (list, t) => list.slice().sort((a, b) => Math.abs(a - t) - Math.abs(b - t) || a - b);

  // one ordinary bar: pick the head nearest its target for which both figures fit the register
  const build = (i, roles, target, nextHead, cap, fixed, avoid) => {
    const isCT = r => ct(i, r), r0 = roles[0], r1 = roles[1], A = figOf(r0);
    let heads = fixed != null ? [fixed] : near(cts(i, 0, cap), target);
    if (fixed == null && avoid != null && heads.length > 1) heads = heads.filter(h => h !== avoid);
    // lp: the leap to use. When the register is too tight for the song's leap, a smaller one keeps the
    // figure's rhythm and contour; turning a move around (bounce) or holding one note are the last resorts.
    const tryHead = (h, bounce, lp, strict) => {
      const a = r0 === 'P' ? figure(isCT, A.f, h, 0, cap, lp, -1, true) : figure(isCT, A.f, h, 0, cap, lp, A.dir, bounce);
      if (!a) return null;
      const e = a[a.length - 1];
      let mids;
      if (!isCT(e)) mids = near([e + 1, e - 1].filter(r => r >= 0 && r <= cap && isCT(r)), nextHead);     // resolve by step
      else {
        let up = e + 1; while (!isCT(up)) up++; let dn = e - 1; while (!isCT(dn)) dn--;
        const d = Math.sign(nextHead - e) || lean;
        mids = (r1 === 'H' ? near([e, up, dn], nextHead) : d > 0 ? [up, e, dn] : [dn, e, up]).filter(r => r >= 0 && r <= cap);
      }
      if (!mids.length) return null;
      if (r1 === 'H') return { head: h, a: { rh: A.f.rh, seq: a }, mid: mids[0], b: null, hold: true, cap };
      const B = figOf(r1);
      for (const d of [B.dir, -B.dir]) for (let l2 = lp; l2 >= 2; l2--) for (const mid of mids) { const b = figure(isCT, B.f, mid, 0, cap, l2, d, false); if (b) return { head: h, a: { rh: A.f.rh, seq: a }, mid, b: { rh: B.f.rh, seq: b }, hold: false, cap }; }
      if (strict) return null;
      th.plain++;
      return { head: h, a: { rh: A.f.rh, seq: a }, mid: mids[0], b: { rh: 'L', seq: [mids[0]] }, hold: false, cap };   // the answer shrinks to one long note
    };
    for (let lp = leap; lp >= 2; lp--) for (const h of heads) { const b = tryHead(h, false, lp, true); if (b) return b; }
    th.bounced++;
    for (const h of heads) { const b = tryHead(h, true, leap, true); if (b) return b; }
    for (const bounce of [false, true]) for (const h of heads) { const b = tryHead(h, bounce, leap, false); if (b) return b; }
    th.plain++;
    return { head: heads[0], a: { rh: 'L', seq: [heads[0]] }, mid: heads[0], b: null, hold: true, cap };
  };
  const cadence = (i, cands, target, cap) => ({ cad: true, head: near(cands.filter(r => r <= cap), target)[0], cap });
  const open = i => cts(i, 0, RMAX).filter(r => (((base + r - deg[i]) % 7) + 7) % 7 !== 0);   // third or fifth of the dominant
  const root = i => cts(i, 0, RMAX).filter(r => (((base + r - deg[i]) % 7) + 7) % 7 === 0);

  const G = GRAM[gram], tA = arch.map(a => Math.min(capA - 1, a + b0)), B = th.bars;
  // A1: open ending on bar 3. Bars are built backwards so each one knows the head it leads to.
  B[3] = cadence(3, open(3), tA[2] - 1, capA);
  B[2] = build(2, G.A[2], tA[2], B[3].head, capA);
  B[1] = build(1, G.A[1], tA[1], B[2].head, capA, null, B[2].head);
  B[0] = build(0, G.A[0], tA[0], B[1].head, capA, null, B[1].head);
  // A2 = A1 with the second ending: dominant on bar 6, the tonic root held on bar 7
  B[7] = cadence(7, root(7), tA[2] - 1, capA);
  B[6] = build(6, G.A[2], tA[2], B[7].head, capA);
  B[5] = build(5, G.A[1], tA[1], B[6].head, capA, B[1].head);
  B[4] = build(4, G.A[0], tA[0], B[5].head, capA, B[0].head);
  // B: off the tonic, climbing to the peak on bar 10, then down to an open cadence
  B[11] = cadence(11, open(11), peak - 4, capB);
  B[10] = build(10, G.B[2], peak, B[11].head, capB, peak);                    // only the head may touch the peak
  B[9] = build(9, G.B[1], peak + barch[1], B[10].head, capB);
  B[8] = build(8, G.B[0], peak + barch[0], B[9].head, capB, null, B[9].head);
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
// S takes one pulse; the L's share what is left, so the same symbols fit a 2-, 3- or 4-pulse cell
function alloc(rh, P) {
  const n = Math.min(rh.length, P), sym = rh.slice(0, n); let nL = 0; for (const ch of sym) if (ch === 'L') nL++;
  const out = [];
  if (!nL) { for (let j = 0; j < n; j++) out.push(1); out[n - 1] += P - n; return out; }
  const rest = P - (n - nL), each = Math.floor(rest / nL); let extra = rest - each * nL;
  for (const ch of sym) out.push(ch === 'L' ? each + (extra-- > 0 ? 1 : 0) : 1);
  return out;
}

// song must offer: theme, meter(beats, unit) -> { groups, accents, ppb }, pitchAt(idx, rank) -> midi.
// Returns [{ beat, o, d, n, s, c?, pk? }]: s = structural (group head, cadence goal, peak), c = the held
// cadence note, pk = the peak. d is the full written length; rests are the gaps.
export function themeBar(song, idx, beats, unit) {
  const th = song.theme; idx = ((idx % 16) + 16) % 16;
  const bar = th.bars[idx], T = th.bars[(idx + 1) % 16].head;
  const { groups, accents, ppb } = song.meter(beats, unit), N = beats * ppb;
  const isCT = r => ctAt(th, idx, r), cap = bar.cap, lean = th.lean, ns = [];
  const add = (p, len, r, fx, more) => { const o = { p, len, r, fx: fx ? 1 : 0, gap: 0 }; if (more) Object.assign(o, more); ns.push(o); return o; };
  const heads = new Set(accents.map(a => a * ppb));
  if (bar.cad) {
    // the goal, held; a breath; then the pickup steps into the next phrase
    let hold = 0;
    if (ppb === 2) hold = Math.min(4, N - 2); else { for (const g of groups) { if (hold + g > 4) break; hold += g; } if (!hold) hold = Math.min(groups[0], 4); }
    hold = Math.max(1, Math.min(hold, N - (N >= 4 ? 2 : 1)));
    add(0, hold, bar.head, 1, { c: 1, gap: 1 });
    const minRest = N < 4 ? 1 : ppb === 1 && N >= 7 ? 3 : 2;
    let K = Math.max(0, Math.min(th.pickup, N - hold - minRest)), s = Math.sign(T - bar.head) || lean;
    if (T - s * K < 0 || T - s * K > cap || T - s > cap || T - s < 0) s = -s;
    while (K > 0 && (T - s * K < 0 || T - s * K > cap)) K--;
    for (let j = K; j >= 1; j--) add(N - j, 1, T - s * j, 0);
  } else {
    const cells = cellsOf(groups, ppb), mains = cells.filter(c => c.main), A = mains[0];
    const B = mains.length > 1 ? mains[mains.length - 1] : cells[cells.indexOf(A) + 1] || null;
    for (const c of cells) {
      if (c === A || (c === B && !bar.hold)) {
        const f = c === A ? bar.a : bar.b, lens = alloc(f.rh, c.len); let p = c.p;
        lens.forEach((len, j) => { add(p, len, f.seq[j], j === 0 && heads.has(p)); p += len; });
      } else if (c === B) {
        const h = c.len >= 3 ? Math.ceil(c.len / 2) : 1;
        add(c.p, h, bar.mid, heads.has(c.p), { gap: h < c.len ? 1 : 0 });
      } else {
        // a connecting cell: a short run that steps into the next structural note
        const X = B && c.p < B.p ? bar.mid : T, prev = ns[ns.length - 1], e = prev ? prev.r : bar.head;
        const s = Math.sign(X - e) || lean, m = Math.min(c.len, 3);
        let seq = []; for (let j = m; j >= 1; j--) seq.push(X - s * j);
        if (seq.some(r => r < 0 || r > cap)) seq = seq.map((r, j) => X + s * (m - j));
        seq = seq.map(r => Math.max(0, Math.min(cap, r)));
        if (prev && !prev.gap && !isCT(e)) { const up = isCT(e + 1) && e + 1 <= cap, dn = isCT(e - 1) && e - 1 >= 0; seq[0] = up && (s > 0 || !dn) ? e + 1 : dn ? e - 1 : seq[0]; }
        const first = c.len - (m - 1);
        if ((heads.has(c.p) || first > 1) && !isCT(seq[0])) { for (const d of [s, -s, 2 * s, -2 * s]) if (seq[0] + d >= 0 && seq[0] + d <= cap && isCT(seq[0] + d)) { seq[0] += d; break; } }
        let p = c.p; seq.forEach((r, j) => { const len = j === 0 ? first : 1; add(p, len, r, j === 0 && heads.has(p)); p += len; });
      }
    }
    // the barline: the last note leads into the next bar's head by step, or sits within a third of it
    const z = ns[ns.length - 1];
    if (z && !z.gap && !z.fx && z.p + z.len === N) {
      const pv = ns.length > 1 ? ns[ns.length - 2].r : z.r;
      const gap = Math.abs(T - z.r);
      if (z.len === 1) {
        // a chord tone within a third of the next head may stand (it is part of a figure); anything else becomes
        // that head's neighbour, from the side the line comes from unless that would just repeat the last note
        if (!(gap === 1 || (gap === 2 && isCT(z.r)))) {
          const s = Math.sign(T - pv) || Math.sign(T - z.r) || lean; let r = T - s;
          if (r < 0 || r > cap || (r === pv && T + s >= 0 && T + s <= cap)) r = T + s;
          if (r >= 0 && r <= cap) z.r = r;
        }
      } else if (gap >= 3) { z.len--; add(N - 1, 1, T - Math.sign(T - z.r), 0); }
    }
    legalize(ns, isCT, T, 0, cap);
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
// P = { fill, thin, push, art, penta, orn }. ctx is the Frame (beats, ppb, accents, tonic, chord, clave, pos,
// sec, seed, cap, peak, lo, penta). Order: thin, push, fill, sixteenths, pentatonic snap, ornaments,
// articulation. Structural notes keep their pitch whatever happens; only push may move their onset.
// Output events: { o, d, v, n, p, s, orn?, on? }. p: 0 structural, 1 the written tune, 2 fills, 3 sixteenths
// and echoes.
export function dialect(notes, P, ctx) {
  const { beats, ppb, tonic, chord } = ctx, sc = chord.scale, tpp = 4 / ppb, seed = ctx.seed | 0;
  const kOf = n => { const x = n - tonic; return 7 * Math.floor(x / 12) + sc.indexOf((((x % 12) + 12) % 12)); };
  const pit = k => tonic + 12 * Math.floor(k / 7) + sc[((k % 7) + 7) % 7];
  const isCT = k => chord.pcs.includes(sc[((k % 7) + 7) % 7]);
  const hiK = ctx.cap != null ? kOf(ctx.cap) : 999, loK = ctx.lo != null ? kOf(ctx.lo) : -999, top = ctx.peak != null ? ctx.peak : 999;
  const ph = (ctx.sec === 'B' ? 4 : 0) + (ctx.pos | 0), u = (a, salt) => unit(seed, ph, a, salt);
  const nb = k => (k + 1 <= hiK ? k + 1 : k - 1);                       // upper neighbour, unless it would top the peak
  let L = notes.map(n => ({ t: Math.round((n.beat + n.o) * 4), len: Math.round(n.d * 4), k: kOf(n.n), s: n.s ? 1 : 0, c: n.c, pk: n.pk, kind: 0 }));
  const lastT = L.length ? L[L.length - 1].t : -1;                       // the bar's last note is left alone: it owns the barline

  // thin: keep the notes that lead INTO a structural note, drop the ones after it and let it ring
  if (P.thin > 0) {
    const out = []; let i = 0;
    while (i < L.length) {
      if (L[i].s) { out.push(L[i++]); continue; }
      let j = i; while (j < L.length && !L[j].s) j++;
      const keep = Math.round((1 - P.thin) * (j - i));
      for (let q = i; q < j - keep; q++) { const pv = out[out.length - 1]; if (pv && pv.s && pv.t + pv.len === L[q].t) pv.len += L[q].len; }
      for (let q = j - keep; q < j; q++) out.push(L[q]);
      i = j;
    }
    L = out;
  }
  // push: a structural note on a later group head arrives one pulse early and is tied over, when that head
  // or the pulse it lands on is a clave hit. Never the bar head, so never across a barline.
  if (P.push > 0 && ctx.clave) for (const a of ctx.accents) {
    if (a === 0) continue;
    const hp = a * ppb, dest = hp - 1, i = L.findIndex(x => x.s && x.t === hp * tpp);
    if (i < 1 || !(ctx.clave.includes(hp) || ctx.clave.includes(dest)) || u(hp, 1) >= P.push) continue;
    const q = L[i - 1];
    if (q.t + q.len > dest * tpp) { if (q.t >= dest * tpp) { if (q.s || q.c) continue; L.splice(i - 1, 1); } else q.len = dest * tpp - q.t; }
    const x = L.find(y => y.s && y.t === hp * tpp); x.t = dest * tpp; x.len += tpp; x.pu = 1;
  }
  // fill: a long note gives its last pulses to passing tones that walk to the next note
  if (P.fill > 0) {
    const out = [], motor = P.fill >= 0.8;
    for (let i = 0; i < L.length; i++) {
      const a = L[i], b = L[i + 1], m = Math.floor(a.len / tpp) - 1;
      if (m < 1 || a.c || a.pu || !b || a.t + a.len !== b.t || u(a.t, 2) >= P.fill) { out.push(a); continue; }
      const D = b.k - a.k, sg = Math.sign(D); let path = [];
      if (D === 0) path = [nb(a.k)];                                                     // unison: a neighbour note
      else if (Math.abs(D) === 1) { const ov = b.k + sg; path = [ov <= hiK && ov >= loK ? ov : a.k]; }   // a step: overshoot and fall back
      else for (let q = Math.min(m, Math.abs(D) - 1); q >= 1; q--) path.push(b.k - sg * q);          // wider: run into it
      if (motor) while (path.length < m) { if (m - path.length >= 2) path.unshift(nb(a.k), a.k); else path.unshift(a.k); }
      a.len -= path.length * tpp; out.push(a);
      path.forEach((k, j) => out.push({ t: a.t + a.len + j * tpp, len: tpp, k, s: 0, kind: 1 }));
    }
    L = out;
    // the lilt: with a full fill in /4 an off-beat eighth splits into two sixteenths (long-short-short)
    if (motor && ppb === 2) {
      const o2 = [];
      for (let i = 0; i < L.length; i++) {
        const r = L[i], b = L[i + 1]; o2.push(r);
        if (r.s || r.len !== 2 || r.t % 4 !== 2 || !b || b.t !== r.t + 2 || u(r.t, 3) >= (P.fill - 0.7) / 0.45) continue;
        const D = b.k - r.k, sg = Math.sign(D), ct = isCT(r.k); let ins = null;
        if (Math.abs(D) === 2) ins = r.k + sg; else if (!ct) continue;
        else if (D === 0) ins = nb(r.k); else if (Math.abs(D) >= 3) ins = b.k - sg; else { const ov = b.k + sg; if (ov <= hiK && ov >= loK) ins = ov; }
        if (ins == null) continue;
        r.len = 1; o2.push({ t: r.t + 1, len: 1, k: ins, s: 0, kind: 2 });
      }
      L = o2;
    }
  }
  // pentatonic: decorative non-chord tones off the five-note subset move to the neighbour that is on it
  if (P.penta && ctx.penta) {
    for (let i = 0; i < L.length; i++) {
      const a = L[i]; if (a.s || a.t === lastT || isCT(a.k) || ctx.penta.includes(((a.k % 7) + 7) % 7)) continue;
      const nx = L[i + 1], pv = L[i - 1], up = a.k + 1, dn = a.k - 1;
      a.k = nx && nx.k === up ? dn : nx && nx.k === dn ? up : pv && pv.k < a.k ? up : dn;
      if (a.k > hiK) a.k = dn;
    }
  }
  if (P.penta || P.push > 0 || P.fill > 0) {
    const ns = L.map((a, i) => ({ r: a.k, len: a.len, fx: a.s || a.t === lastT || a.kind === 0 && !P.penta && !P.push, gap: !L[i + 1] || a.t + a.len !== L[i + 1].t, a }));
    legalize(ns, isCT, null, loK, hiK, tpp); ns.forEach(x => { x.a.k = x.r; });
  }
  // chiprock's echo: a long note is cut to one pulse and answers itself quietly on the next
  const echo = (P.orn || []).includes('echo');
  if (echo) { const out = []; for (const a of L) { out.push(a); if (a.kind === 0 && a.len >= 2 * tpp && !a.c) { out.push({ t: a.t + tpp, len: a.len - tpp, k: a.k, s: 0, kind: 3 }); a.len = tpp; } } L = out; }
  // ornaments: a field on the note, one per group, never on anything shorter than half a beat
  const grp = t => { let g = 0; for (let k = 0; k < ctx.accents.length; k++) if (ctx.accents[k] * 4 <= t) g = k; return g; }, used = new Set();
  const up = k => (pit(k + 1) < top && k + 1 <= Math.max(hiK, k) ? k + 1 : k - 1);
  for (const typ of P.orn || []) for (let i = 0; i < L.length; i++) {
    const a = L[i], pv = L[i - 1]; if (a.orn || a.kind >= 2 || a.len < 2 || used.has(grp(a.t))) continue;
    let on = null;
    if (typ === 'trill') { if (a.c || a.len >= 6) on = pit(up(a.k)); }
    else if (typ === 'mordent') { if (a.s && u(a.t, 4) < 0.6) on = pit(up(a.k)); }
    else if (typ === 'cut') { if (a.s || (pv && pv.k === a.k)) on = pit(up(a.k)); }
    else if (typ === 'glide') { if (pv && pv.t + pv.len === a.t && (a.c || a.pk || (a.s && Math.abs(pv.k - a.k) >= 2))) on = pit(pv.k); else if (a.c || a.pk) on = pit(a.k - 1); }
    else if (typ === 'bend') { if (a.len >= 2 * tpp) on = pit(a.k - 1); }
    else if (typ === 'flip') { if (a.s && a.t === 0 && (ctx.pos === 0 || u(0, 5) < 0.5)) on = pit(a.k) + (pit(a.k) + 12 < top ? 12 : -12); }   // the octave above, unless that would top the peak
    if (on != null) { a.orn = typ; a.on = on; used.add(grp(a.t)); }
  }
  const ev = Array.from({ length: beats }, () => []);
  for (const a of L) {
    const beat = Math.floor(a.t / 4); if (beat < 0 || beat >= beats) continue;
    const o = (a.t % 4) / 4, len = a.len / 4;
    const e = {
      o, d: Math.min(Math.max(Math.min(len, 0.2), len * P.art), beats - beat - o),
      v: a.kind === 3 ? 0.3 : a.s ? (a.t === 0 ? 0.95 : 0.88) : a.kind === 0 ? 0.74 : a.kind === 1 ? 0.62 : 0.5,
      n: pit(a.k), p: a.s ? 0 : a.kind === 0 ? 1 : a.kind === 1 ? 2 : 3, s: a.s,
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
// 'step' (leapt or rested in, stepped out) or 'bad' (a non-chord tone that does not leave by step).
export function classifyNCT(note, prev, next, ctx, nextCtx) {
  const m = x => (x == null ? null : typeof x === 'number' ? x : x.n), n = m(note), p = m(prev), q = m(next);
  const pc = (x, c) => (((x - c.tonic) % 12) + 12) % 12;
  if (ctx.chord.pcs.includes(pc(n, ctx))) return 'ct';
  const adj = (a, b, c) => { const d = Math.abs(a - b); if (d === 1 || d === 2) return true; if (d !== 3) return false; const i = c.chord.scale.indexOf(pc(a, c)), j = c.chord.scale.indexOf(pc(b, c)); return i >= 0 && j >= 0 && (Math.abs(i - j) === 1 || Math.abs(i - j) === 6); };
  if (q == null || !(adj(n, q, ctx) || (nextCtx && adj(n, q, nextCtx)))) return 'bad';
  if (p == null || !adj(p, n, ctx)) return 'step';
  return Math.sign(n - p) === Math.sign(q - n) ? 'pass' : 'nbr';
}

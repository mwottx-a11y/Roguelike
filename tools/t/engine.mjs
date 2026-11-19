// blend.js, mixer.js and audio.js: the allocator's rules, the DJ's transitions, and the whole engine driven
// step by step on the fake AudioContext (budgets, clean scheduling, the hold loop).
import { FakeAudioContext, lintSources, lintEnvelopes, lintSchedule, lintGraph, maxInWindow, liveAt } from '../fakectx.mjs';
import { Song, genreMix } from '../../src/music.js';
import { GENRES } from '../../src/genres/index.js';
import { seats, allocate, layersOf, renderBar, HYBRIDS, ALL_STYLES, mixForStyle } from '../../src/blend.js';
import { Mixer, conduct, tierOf, DROP_HOLD } from '../../src/mixer.js';
import { Audio } from '../../src/audio.js';

const IDS = Object.keys(GENRES), METERS = [[3, 4], [4, 4], [5, 4], [6, 8]];
const seeded = (s = 7) => () => (s = (s * 16807) % 2147483647) / 2147483647;
const table = (mix, prev, first) => allocate(seats(mix, prev), prev, { first });
const pairs = []; for (let i = 0; i < IDS.length; i++) for (let j = i + 1; j < IDS.length; j++) pairs.push([IDS[i], IDS[j]]);

export default async function (t) {
  t.section('hybrids: 28 rows, one per pair, unique short names, valid pins and devices');
  t.eq(Object.keys(HYBRIDS).length, 28, 'hybrid rows');
  const names = new Set();
  for (const [a, b] of pairs) {
    const row = HYBRIDS[[a, b].sort().join('+')]; if (!t.ok(!!row, `row for ${a}+${b}`)) continue;
    names.add(row.name); t.ok(row.name.length <= 24, `name length ${row.name}`);
    for (const part in row.pin) t.ok(row.pin[part] === a || row.pin[part] === b, `${row.name}: pin ${part} is one of the pair`);
    t.ok(!(row.pin.kit === 'latin'), `${row.name}: latin kit is never pinned`);
  }
  t.eq(names.size, 28, 'unique hybrid names'); t.eq(ALL_STYLES.length, 36, 'collection size');
  for (const s of ALL_STYLES) { const T = table(genreMix(mixForStyle(s.id)), null); t.ok(T.style.id === s.id, `mixForStyle(${s.id}) gives ${T.style.id}`); }

  t.section('allocator: one kit, one bass, equal-power layers, thresholds, no flapping');
  let flaps = 0, ladders = 0;
  for (const [a, b] of pairs) for (const [x, y] of [[a, b], [b, a]]) {
    let prev = null, changes = 0, last = null;
    for (let s = 0; s <= 100; s += 2) {                               // y rises from 0% to 100% against x
      const T = table([[x, 100 - s], [y, s]].filter(m => m[1] > 0).sort((p, q) => q[1] - p[1]), prev);
      t.ok(T.seats.includes(T.own.kit) && T.seats.includes(T.own.bass) && T.seats.includes(T.own.color), `${x}/${y} ${s}%: owners are seated`);
      for (const part of ['tops', 'comp']) { let sq = 0; for (const g in T.lvl[part]) sq += T.lvl[part][g] ** 2; t.near(sq, 1, 1e-9, `${x}/${y} ${s}%: ${part} power`); }
      for (const g of T.seats) if (g === 'latin' && T.seats.length > 1 && T.share.latin < 0.45) t.ok(T.own.kit !== 'latin' && (T.own.bass !== 'latin' || (T.hybrid && HYBRIDS[T.hybrid].pin.bass === 'latin')), `${x}/${y} ${s}%: latin owns no rhythm section below half (unless a hybrid pins its bass)`);
      t.eq(T.lead.length, 4, 'lead table');
      const sig = T.own.kit + T.own.bass; if (last && sig !== last) changes++; last = sig; prev = T;
    }
    ladders += changes;
    // +-4% noise around every share: an exclusive stem must not change hands more than once
    for (let s = 10; s <= 90; s += 10) {
      let p = null, n = 0, l = null;
      for (const d of [0, 4, -4, 4, -4, 0, 4, -4]) { const T = table([[x, 100 - s - d], [y, s + d]].sort((u, v) => v[1] - u[1]), p); const g = T.own.kit + '/' + T.own.bass; if (l && g !== l) n++; l = g; p = T; }
      if (n > 1) flaps++;
    }
  }
  t.eq(flaps, 0, 'stems that flap under +-4% share noise'); t.report('rhythm-section handovers per 0-100% sweep (mean)', ladders / 56);
  for (const g of IDS) { const T = table([[g, 5], [IDS[(IDS.indexOf(g) + 1) % 8], 3], [IDS[(IDS.indexOf(g) + 3) % 8], 2]], null); const guest = T.seats[2]; t.ok(T.own.kit !== guest && T.own.bass !== guest && !(guest in T.lvl.comp), `${g}: the guest holds no kit, bass or chords`); }

  t.section('mixed bars are legal: one bass at a time, a kit on the one, nothing past the bar, small clash rate');
  const combos = [...IDS.map(g => [[g, 1]]), ...pairs.map(p => [[p[0], 5], [p[1], 5]]), ...pairs.map(p => [[p[0], 7], [p[1], 3]]), ...pairs.filter((_, i) => i % 3 === 0).map((p, i) => [[p[0], 5], [p[1], 3], [IDS[(i * 5 + 2) % 8], 2]].filter((m, k, a) => a.findIndex(q => q[0] === m[0]) === k))];
  let clash = 0, longs = 0, diff = 0;
  for (const mix of combos) for (const [beats, unit] of METERS) for (const seed of [3, 11]) {
    const song = new Song(seed * 7919, mix), T = table(mix.slice().sort((p, q) => q[1] - p[1]), null), tag = T.style.id + ' ' + beats + '/' + unit;
    for (let idx = 0; idx < 16; idx += 3) {
      const bar = renderBar(song, T, idx, beats, unit), bass = [];
      t.ok(bar.events[0].some(e => e.part === 'kit' && e.o === 0), `${tag} bar ${idx}: kit on the one`);
      for (let b = 0; b < beats; b++) for (const e of bar.events[b]) {
        t.ok(typeof e.n === 'string' || (Number.isFinite(e.n) && e.n > 20 && e.n < 110), `${tag}: pitch ${e.n}`);
        t.ok(e.o >= 0 && e.o < 1 && b + e.o + (e.d || 0) <= beats + 1e-6, `${tag} bar ${idx}: event inside the bar (${e.part} ${b}+${e.o} d${e.d})`);
        if (e.part === 'bass') bass.push([b + e.o, b + e.o + e.d]);
        if (e.part === 'lead' && !e.dbl && e.d >= 1) {
          longs++; const a0 = b + e.o, a1 = a0 + e.d;
          for (let c = 0; c < beats; c++) for (const q of bar.events[c]) if (q.part === 'comp' && c + q.o < a1 && c + q.o + q.d > a0) for (const m of q.ns || [q.n]) { const d = (((m - e.n) % 12) + 12) % 12; if (d === 1 || d === 11) { clash++; break; } }
        }
      }
      bass.sort((p, q) => p[0] - q[0]); for (let i = 1; i < bass.length; i++) t.ok(bass[i][0] >= bass[i - 1][1] - 1e-6, `${tag} bar ${idx}: one bass note at a time`);
    }
  }
  t.report('long lead notes with a chord tone a semitone away', clash / Math.max(1, longs)); t.ok(clash / Math.max(1, longs) < 0.03, 'semitone clashes under 3% of long lead notes');
  for (const [a, b] of pairs) { const s = new Song(5, [[a, 1]]), one = JSON.stringify(renderBar(s, table([[a, 1]], null), 0, 4, 4).events), two = JSON.stringify(renderBar(s, table([[a, 9], [b, 1]], null), 0, 4, 4).events); if (one !== two) diff++; }
  t.eq(diff, 28, 'adding a second class at 10% changes what is played');

  t.section('mixer: swaps land on phrase downbeats after a build bar; cuts are immediate; it settles; it is deterministic');
  const session = seed => {
    const R = seeded(seed), M = new Mixer(), log = []; let mix = [[IDS[Math.floor(R() * 8)], 5]], beats = 4, unit = 4, drop = 0, boss = false, kills = 0;
    M.cue(mix); M.reset(new Song(seed, mix), { intro: R() < 0.5 });
    for (let bar = 0; bar < 96; bar++) {
      const r = R();
      if (bar < 80 && r < 0.12) { mix = genreMix(Object.fromEntries(['fire', 'frost', 'volt', 'void', 'nature', 'steel', 'arcane', 'mod'].filter(() => R() < 0.4).map(e => [e, 1 + Math.floor(R() * 5)]))); M.cue(mix); }
      else if (bar < 80 && r < 0.16) { const n = 3 + Math.floor(R() * 4); beats = n; unit = n >= 6 ? 8 : 4; }
      else if (bar < 80 && r < 0.2) drop = 2; else if (bar === 60 && R() < 0.5) boss = true;
      kills += Math.floor(R() * 6);
      const sc = M.bar({ beat: 0, beats, unit, dur: unit === 8 ? 0.21 : 0.42, drop: drop > 0, boss, sig: { prog: bar / 96, kills, bossHp: 1 } }); if (drop > 0) drop--;
      log.push({ bar, idx: sc.idx, state: sc.state, kit: sc.table.own.kit, bass: sc.table.own.bass, noBass: sc.noBass, level: sc.level, style: sc.table.style.id, n: sc.layers.length });
    }
    return { log, M, mix };
  };
  let lands = 0, builds = 0;
  for (let s = 1; s <= 120; s++) {
    const { log, M, mix } = session(s);
    for (let i = 1; i < log.length; i++) {
      const a = log[i - 1], b = log[i];
      if (b.state === 'land') { lands++; t.ok(b.idx % 4 === 0, `session ${s} bar ${i}: swap lands on a phrase downbeat (idx ${b.idx})`); t.ok(a.state === 'build', `session ${s} bar ${i}: a build bar precedes the landing`); }
      if (b.state === 'build') builds++;
      if ((a.kit !== b.kit || a.bass !== b.bass)) t.ok(b.state === 'land' || b.state === 'cut' || b.state === 'steady', `session ${s} bar ${i}: rhythm section changed in state ${b.state}`);
      t.ok(!(a.noBass && b.noBass), `session ${s}: never two bars without bass`);
      t.ok(b.level >= 1 && b.level <= 3 && b.n >= 3, `session ${s}: level and layers in range`);
    }
    const want = allocate(seats(mix, M.air), M.air, {});
    t.ok(want.own.kit === M.air.own.kit && want.own.bass === M.air.own.bass, `session ${s}: settled on the wish 16 bars after the last cue`);
    if (s <= 10) t.eq(JSON.stringify(session(s).log), JSON.stringify(log), `session ${s} is deterministic`);
  }
  t.report('swap landings over 120 sessions', lands); t.ok(lands > 20, 'the simulation exercises swaps');
  t.eq(tierOf(0.42), 2, 'tier 4/4'); t.eq(tierOf(0.21), 1, 'tier 6/8'); t.eq(tierOf(0.105), 0, 'tier 6/8 legacy drop');
  { const S = { E: 0.3, base: 0, level: 1, kills: 0, wait: 0 }; let k = 0, max = 0; for (let i = 0; i < 60; i++) { k += i > 30 ? 12 : 1; max = Math.max(max, conduct(S, { prog: i / 60, kills: k }, 1.7, false, !(i & 1))); } t.eq(max, 3, 'a kill surge late in a stage reaches level 3'); }

  t.section('engine on the fake context: every style, four meters, drop and boss; clean scheduling inside the budgets');
  let worstOsc = 0, worstNodes = 0, worstLive = 0, lint = [];
  const run = (weights, beats, unit, o = {}) => {
    const ctx = new FakeAudioContext(), au = new Audio({ music: true, sfx: true, rand: seeded(o.seed || 5) });
    au.init(ctx); ctx.markPersistent(); au.setMix(weights, { first: Object.keys(weights)[0] }); au.newSong(o.seed || 5, { intro: !!o.intro });
    const dur = (unit === 8 ? 0.21 : 0.42) / (o.drop ? 2 : 1), steps = o.steps || beats * 10; let now = 0.1, kills = 0;
    const def = { elem: 'fire', type: 'spell' };
    for (let i = 0; i < steps; i++) {
      ctx.currentTime = now + (o.jitter ? (seeded(i + 3)() - 0.5) * 0.03 : 0);
      if (o.swapAt === i) au.setMix(o.swapTo, {});
      au.step({ beat: i % beats, beats, unit, dur, def: i % 2 ? def : null, slot: i % beats, lvl: 3, drop: !!o.drop && i >= beats * 2, boss: !!o.boss && i >= beats * 3, ready: false, sig: { prog: i / steps, kills: (kills += 2), bossHp: 0.5 } });
      now += dur;
    }
    ctx.currentTime = now;
    const starts = [...ctx.oscStarts, ...ctx.bufStarts].sort((a, b) => a - b);
    worstOsc = Math.max(worstOsc, maxInWindow(starts, 1)); worstNodes = Math.max(worstNodes, maxInWindow(ctx.births.slice().sort((a, b) => a - b), 1));
    for (let T = 0.5; T < now; T += 0.37) worstLive = Math.max(worstLive, liveAt(ctx, T));
    lint.push(...lintSources(ctx, 3), ...lintEnvelopes(ctx, { max: 3 }), ...lintSchedule(ctx, { max: 3 }), ...lintGraph(ctx, 3));
    t.ok(liveAt(ctx, now + 8) === 0, 'no source left running 8 s after the last step');
    return { ctx, au, now };
  };
  for (const s of ALL_STYLES) for (const [beats, unit] of METERS) run(mixForStyle(s.id), beats, unit, { seed: 3 + beats });
  for (const [beats, unit] of METERS) { run({ fire: 5, frost: 5, mod: 2 }, beats, unit, { drop: true, boss: true, jitter: true, steps: beats * 16 }); run({ volt: 4, void: 4, nature: 3 }, beats, unit, { intro: true, swapAt: beats * 3, swapTo: { arcane: 6, steel: 5 }, steps: beats * 24 }); }
  t.eq(lint.length, 0, 'scheduling lint is clean: ' + lint.slice(0, 4).join(' | '));
  t.report('worst source starts in any 1 s', worstOsc); t.report('worst node creations in any 1 s', worstNodes); t.report('worst simultaneous sources', worstLive);
  t.ok(worstOsc <= 130, 'source starts per second inside the budget'); t.ok(worstNodes <= 420, 'node creations per second inside the budget'); t.ok(worstLive <= 80, 'simultaneous sources inside the budget');

  t.section('hold: the booth loop plays without advancing the song, and releases cleanly');
  { const { ctx, au, now } = run({ fire: 5, frost: 3 }, 4, 4, { steps: 20 }); const idx = au.scene.idx, before = ctx.count.total; let T = now;
    au.hold(true, 'level'); au.hold(true, 'level'); for (let i = 0; i < 1800; i++) { T += 1 / 60; ctx.currentTime = T; au.idle(1 / 60); }
    t.eq(au.scene.idx, idx, 'the bar does not advance while held'); t.ok(ctx.count.total > before + 100, 'the booth loop keeps playing'); t.eq(au.mixer.bars, 5, 'the mixer is frozen');
    au.hold(false); t.eq(au.held, 0, 'released'); au.step({ beat: 0, beats: 4, unit: 4, dur: 0.42 }); t.ok(au.scene.idx !== idx, 'the next downbeat moves on'); }
  t.ok(DROP_HOLD === true || DROP_HOLD === false, 'DROP_HOLD is a switch');
}

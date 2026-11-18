// A competent player stand-in: looks ahead in 16 directions, kites, drafts sensibly, buys heals when hurt.
// node tools/pro.mjs <runs> <volume> <metaFraction> [maxStage]
import { Run } from '../src/game.js';
import { META, RUNES, CHARS, MAX_RUNE_LVL } from '../src/data.js';
const runs = +process.argv[2] || 10, volume = +process.argv[3] || 0, rank = +process.argv[4] || 0, maxStage = +process.argv[5] || 5;
const metaLevels = {}; for (const m of META) metaLevels[m.id] = Math.min(m.max, Math.round(m.max * rank));
const TAU = Math.PI * 2;
function steer(run) {
  const p = run.p, sp = run.s.speed, look = 0.45; let best = 0, bs = -1e9, bx = 0, bz = 0;
  for (let k = -1; k < 16; k++) {
    const dx = k < 0 ? 0 : Math.cos(k / 16 * TAU), dz = k < 0 ? 0 : Math.sin(k / 16 * TAU), x = p.x + dx * sp * look, z = p.z + dz * sp * look; let sc = 0;
    for (const e of run.enemies) { if (e.dead) continue; const ex = e.x + (p.x - e.x) * 0.12, ez = e.z + (p.z - e.z) * 0.12, d = Math.hypot(x - ex, z - ez) - e.r; if (d < 5) sc -= (e.boss ? 3 : 1) * (d < 0.9 ? 60 : 6 / (d * d)); }
    for (const b of run.bullets) { const d = Math.hypot(x - (b.x + b.vx * look), z - (b.z + b.vz * look)); if (d < 2.5) sc -= d < 0.7 ? 80 : 5 / (d * d); }
    for (const q of run.zones) if (q.enemy) { const d = Math.hypot(x - q.x, z - q.z); if (d < q.r + 0.4) sc -= 70; }
    const ar = run.stage.arena; if (ar && Math.hypot(x - ar.x, z - ar.z) > ar.r - 0.5) sc -= 40;
    let g = 0; for (const u of run.pickups) { const d = Math.hypot(x - u.x, z - u.z); if (d < 7) g += (u.type === 'chest' || u.type === 'heart' ? 3 : 0.25) / (1 + d); } sc += Math.min(3, g);
    if (run.spot) sc += 2.5 / (1 + Math.hypot(x - run.spot.x, z - run.spot.z));
    if (sc > bs) { bs = sc; best = k; bx = dx; bz = dz; }
  }
  run.input.x = bx; run.input.z = bz;
  if (bs < -55 && p.dashN > 0) run.input.dash = true;
  if (run.drop >= 100 && (run.enemies.length > 25 || run.stage.boss)) run.input.drop = true;
}
function draft(run, ch) {
  const sc = o => o.kind === 'fuse' ? 100 : o.kind === 'passive' && o.id === 'slot' ? 60 : o.kind === 'up' ? 30 + o.lvl * 3 + (RUNES[o.id].type === 'spell' ? 5 : 0) : o.kind === 'rune' ? (run.runeCount() < run.size ? 40 : 2) : o.kind === 'relic' ? 50 : o.kind === 'passive' ? ({ might: 28, tempo: 27, vital: run.p.hp < run.s.maxHp * 0.6 ? 45 : 20, armor: 22, regen: 21, area: 24, crit: 20 }[o.id] || 15) : 1;
  return ch.slice().sort((a, b) => sc(b) - sc(a))[0];
}
const res = [];
for (let r = 0; r < runs; r++) {
  const run = new Run({ char: CHARS[r % 3].id, volume, metaLevels });
  let hpSum = 0, n = 0, minFrac = 1, lowT = 0, heals = 0, healed = 0, dmg = 0; const stageLog = [];
  const h0 = run.heal.bind(run); run.heal = v => { const b = run.p.hp; h0(v); healed += run.p.hp - b; };
  const dt = 1 / 30; let guard = 0, st0 = { dmg: 0, min: 1 };
  while (run.state !== 'dead' && guard++ < 30 * 60 * 25) {
    while (run.pending.length && (run.state === 'play' || run.state === 'clear')) { const kind = run.pending.shift(), ch = kind === 'level' ? run.levelChoices() : run.relicChoices(); const o = draft(run, ch); run.applyChoice(o, run.needsSlot(o) ? run.wheel.findIndex((w, i) => i < run.size && w && w.lvl === Math.min(...run.wheel.slice(0, run.size).map(q => q.lvl))) : undefined); }
    if (run.state === 'shop') {
      stageLog.push(`s${run.stage.n + 1}:${Math.round(100 * st0.min)}%/${Math.round(run.c.dmgTaken - st0.dmg)}`); st0 = { dmg: run.c.dmgTaken, min: 1 };
      for (const o of run.shopOffers().sort((a, b) => (a.kind === 'heal' ? -1 : 0) - (b.kind === 'heal' ? -1 : 0))) { if (o.pact) continue; if (o.kind === 'heal') { if (run.p.hp < run.s.maxHp * 0.65 && run.gold >= o.price) { run.gold -= o.price; run.applyChoice(o); heals++; } } else if (run.gold >= o.price) { run.gold -= o.price; run.applyChoice(o); } }
      if (run.stage.n + 1 >= maxStage) break;
      run.startStage(run.stage.n + 1, 'calm');
    }
    steer(run); const regen0 = run.p.hp; run.update(dt);
    const f = run.p.hp / run.s.maxHp; hpSum += f; n++; if (f < minFrac) minFrac = f; if (f < st0.min) st0.min = f; if (f < 0.5) lowT += dt;
  }
  const s = run.summary(); res.push({ ...s, avgHp: hpSum / n, minFrac, lowT, heals, hits: 0, dead: run.state === 'dead' });
  console.log(`run ${r} ${run.char.id}: ${run.state === 'dead' ? 'DIED st' + s.stage : 'WON'} t=${(s.time / 60).toFixed(1)}m lvl ${s.level} avgHP ${Math.round(100 * hpSum / n)}% dmgTaken ${s.dmgTaken} heals bought ${heals} maxHp ${run.s.maxHp} armor ${run.s.armor} regen ${run.s.regen.toFixed(1)} | per stage minHP%/dmg: ${stageLog.join(' ')}`);
}
const avg = k => res.reduce((a, b) => a + b[k], 0) / res.length;
console.log(`SUMMARY vol ${volume} meta ${rank}: wins ${res.filter(r => !r.dead).length}/${runs}  avg cleared ${avg('cleared').toFixed(1)}  avgHP ${Math.round(100 * avg('avgHp'))}%  lowest HP ${Math.round(100 * avg('minFrac'))}%  time<50%HP ${avg('lowT').toFixed(0)}s  dmgTaken ${Math.round(avg('dmgTaken'))}  heals bought ${avg('heals').toFixed(1)}`);

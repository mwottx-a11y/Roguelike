// Headless balance bot: node tools/sim.mjs [runs] [volume] [metaRank]
import { Run } from '../src/game.js';
import { META, RUNES } from '../src/data.js';
const runs = +process.argv[2] || 10, volume = +process.argv[3] || 0, rank = +process.argv[4] || 0;
const starters = Object.keys(RUNES).filter(id => RUNES[id].cost === 0 && !RUNES[id].feat);
const metaLevels = {}; for (const m of META) metaLevels[m.id] = Math.min(m.max, Math.round(m.max * rank));
function bot(run) {
  const p = run.p; let fx = 0, fz = 0;
  for (const e of run.enemies) { const dx = p.x - e.x, dz = p.z - e.z, d2 = dx * dx + dz * dz; if (d2 < 36) { const w = (e.boss ? 3 : 1) / (d2 + 0.3); fx += dx * w; fz += dz * w; } }
  for (const b of run.bullets) { const dx = p.x - b.x, dz = p.z - b.z, d2 = dx * dx + dz * dz; if (d2 < 9) { const w = 2 / (d2 + 0.2); fx += dx * w; fz += dz * w; } }
  for (const z of run.zones) if (z.enemy) { const dx = p.x - z.x, dz = p.z - z.z, d2 = dx * dx + dz * dz; if (d2 < (z.r + 1) ** 2) { fx += dx * 3 / (d2 + 0.2); fz += dz * 3 / (d2 + 0.2); } }
  let best = null, bd = 60; for (const g of run.pickups) { const d = (g.x - p.x) ** 2 + (g.z - p.z) ** 2; if (d < bd) { bd = d; best = g; } }
  if (best) { const d = Math.sqrt(bd) || 1; fx += (best.x - p.x) / d * 0.35; fz += (best.z - p.z) / d * 0.35; }
  const l = Math.hypot(fx, fz); run.input.x = l > 0.05 ? fx / l : 0; run.input.z = l > 0.05 ? fz / l : 0;
  if (run.drop >= 100) run.input.drop = true;
  if (l > 6 && p.dashN > 0) run.input.dash = true;
}
const res = [];
for (let r = 0; r < runs; r++) {
  const run = new Run({ char: 'cantor', volume, metaLevels, unlocked: starters });
  const dt = 1 / 30; let guard = 0;
  while (run.state !== 'dead' && guard++ < 30 * 60 * 30) {
    while (run.pending.length && (run.state === 'play' || run.state === 'clear')) {
      const kind = run.pending.shift(), ch = kind === 'level' ? run.levelChoices() : run.relicChoices();
      const o = ch.find(c => c.kind === 'up') && Math.random() < 0.6 ? ch.find(c => c.kind === 'up') : ch[(Math.random() * ch.length) | 0];
      run.applyChoice(o, run.needsSlot(o) ? (Math.random() * run.size) | 0 : undefined);
    }
    if (run.state === 'shop') {
      for (const o of run.shopOffers()) if (run.gold >= o.price && (o.kind !== 'heal' || run.p.hp < run.s.maxHp * 0.6)) { run.gold -= o.price; run.applyChoice(o); }
      if (run.stage.n >= 7) break;
      console.log(`   stage ${run.stage.n+1} done t=${(run.time/60).toFixed(1)} lvl ${run.level} kills ${run.kills} gold ${run.gold}`);
      run.startStage(run.stage.n + 1, run.nextStageOptions()[0].id);
    }
    bot(run); run.update(dt);
  }
  const s = run.summary();
  res.push(s);
  console.log(`run ${r}: stage ${s.stage} t=${(s.time / 60).toFixed(1)}m lvl ${s.level} kills ${s.kills} echoes ${s.echoes} hp ${Math.round(run.p.hp)}/${run.s.maxHp} dmgTaken ${s.dmgTaken} wheel ${run.wheel.slice(0, run.size).map(w => w ? w.id + w.lvl : '-').join(',')}`);
}
const avg = k => (res.reduce((a, b) => a + b[k], 0) / res.length).toFixed(1);
console.log(`AVG stage ${avg('stage')} cleared ${avg('cleared')} level ${avg('level')} kills ${avg('kills')} echoes ${avg('echoes')}`);

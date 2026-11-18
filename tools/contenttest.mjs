// Runs every rune, modifier, fusion, relic and tome through the sim to catch crashes: node tools/contenttest.mjs
import { Run } from '../src/game.js';
import { RUNES, RELICS, PASSIVES, FUSIONS, CHARS } from '../src/data.js';
const spells = Object.keys(RUNES).filter(id => RUNES[id].type === 'spell'), mods = Object.keys(RUNES).filter(id => RUNES[id].type === 'mod');
let fails = 0; const dps = {};
const drive = (run, secs) => { const k0 = run.kills; let dmg = 0; const h0 = run.hit.bind(run); run.hit = (e, b, el, o) => { const hp = e.hp; h0(e, b, el, o); dmg += Math.max(0, hp - Math.max(0, e.hp)); }; for (let i = 0; i < secs * 30; i++) { run.pending.length = 0; run.p.hp = Math.max(run.p.hp, 50); run.input.x = Math.sin(i / 50); run.input.z = Math.cos(i / 50); if (i % 90 === 0) run.input.dash = true; if (run.drop >= 100) run.input.drop = true; run.update(1 / 30); if (run.state !== 'play') { run.state = 'play'; } } return dmg / secs; };
const attempt = (label, f) => { try { return f(); } catch (e) { fails++; console.log('FAIL', label, e.stack.split('\n').slice(0, 3).join(' | ')); } };
for (const id of spells) for (const lvl of [1, 3, 5]) attempt(`${id}@${lvl}`, () => {
  const run = new Run({ char: 'cantor' }); run.passives.slot = 3; run.recalc(); run.startStage(2, 'swarm'); run.stage.t = 30;
  for (let i = 0; i < 6; i++) run.wheel[i] = null; run.wheel[0] = { id, lvl }; run.wheelChanged();
  const d = drive(run, 25); if (lvl === 5) dps[id] = Math.round(d);
});
for (const m of mods) for (const sp of ['fireball', 'hound', 'mines', 'rift', 'aegis']) attempt(`${m}+${sp}`, () => {
  const run = new Run({ char: 'cantor' }); run.passives.slot = 3; run.recalc(); run.startStage(1, 'calm'); run.stage.t = 30;
  [m, sp, 'echo', m, 'decoy', 'bolt'].forEach((id, i) => run.wheel[i] = { id, lvl: 5 }); run.wheelChanged(); drive(run, 12);
});
attempt('all relics + tomes', () => {
  for (const ch of CHARS) { const run = new Run({ char: ch.id }); for (const id in PASSIVES) run.passives[id] = PASSIVES[id].max; run.passives.slot = 3; for (const id in RELICS) run.applyChoice({ kind: 'relic', id });
    ['blood', 'meteor', 'coda', 'dynamo', 'staccato', 'thorns'].forEach((id, i) => run.wheel[i] = { id, lvl: 4 }); run.wheelChanged(); run.startStage(3, 'dark'); run.stage.t = 20; drive(run, 30); run.spawnBoss(); drive(run, 15); run.shopOffers(); run.levelChoices(); run.summary(); }
});
attempt('shield blocks', () => { const run = new Run({ char: 'cantor' }); run.shield = 2; const hp = run.p.hp; run.hurt(50); if (run.p.hp !== hp || run.shield !== 1 || run.c.blocks !== 1) throw new Error('shield did not block'); run.p.inv = 0; run.hurt(50); run.p.inv = 0; run.hurt(50); if (run.p.hp >= hp) throw new Error('unshielded hit did no damage'); });
attempt('decoy lures', () => { const run = new Run({ char: 'cantor' }); run.enemies.length = 0; const e = run.spawn('slime', 3, 0); run.decoy = { x: 6, z: 0, t: 5, dmg: 1, r: 1, o: {} }; const x0 = e.x; for (let i = 0; i < 20; i++) { run.stage.spawnAcc = -99; run.update(1 / 30); } if (!(e.x > x0)) throw new Error('enemy did not walk toward the decoy'); });
attempt('coda halves the tail', () => { const run = new Run({ char: 'cantor' }); run.passives.slot = 1; run.recalc(); const seen = [0, 0, 0, 0]; ['bolt', 'coda', 'nova', 'thorns'].forEach((id, i) => run.wheel[i] = { id, lvl: 1 }); run.wheelChanged(); const c0 = run.cast.bind(run); run.cast = (id, l, c) => { seen[['bolt', 'coda', 'nova', 'thorns'].indexOf(id)]++; return c0(id, l, c); }; for (let i = 0; i < 40; i++) run.fireStep(); if (!(seen[0] > seen[2] * 1.6 && seen[2] > 0)) throw new Error('coda pattern wrong ' + seen); });
for (const f of FUSIONS) attempt('fusion ' + f.id, () => { const run = new Run({ char: 'cantor' }); run.wheel[0] = { id: f.a, lvl: 5 }; run.wheel[1] = { id: f.b, lvl: 5 }; run.wheelChanged(); const o = run.levelChoices().find(c => c.kind === 'fuse'); if (!o) throw new Error('no fusion offered'); run.applyChoice(o); drive(run, 15); });
console.log('lvl-5 solo damage/sec (stage 3 swarm):', Object.entries(dps).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
console.log(fails ? `${fails} FAILURES` : 'all content ran clean');
process.exit(fails ? 1 : 0);

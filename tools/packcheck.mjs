// Check ONE genre pack file against the pack contract, without touching GENRES.
//   node tools/packcheck.mjs src/genres/funk.next.js            contract + groove gates against the other seven
//   node tools/packcheck.mjs src/genres/funk.next.js --seeds 24 more songs (default 12)
//   node tools/packcheck.mjs src/genres/funk.next.js --contract contract only
// Exit code 0 when everything holds, 1 otherwise. Read the music with:
//   node tools/score.mjs --pack src/genres/funk.next.js --meter 4/4 --seed 7 --bars 0-3
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { GENRES } from '../src/music.js';
import { checkPack, checkGroove } from './t/packs.mjs';

const argv = process.argv.slice(2), file = argv.find(a => !a.startsWith('--'));
if (!file) { console.error('usage: node tools/packcheck.mjs path/to/pack.js [--seeds N] [--contract]'); process.exit(2); }
const seeds = argv.includes('--seeds') ? Number(argv[argv.indexOf('--seeds') + 1]) || 12 : 12;

let pack;
try { pack = (await import(pathToFileURL(resolve(file)).href)).default; }
catch (e) { console.error('FAIL could not load ' + file + ': ' + (e && e.stack || e)); process.exit(1); }

let checks = 0, fails = 0;
const t = {
  section(name) { console.log('- ' + name); },
  ok(cond, msg) { checks++; if (!cond) { fails++; console.log('  FAIL ' + msg); } return !!cond; },
  eq(a, b, msg) { return t.ok(a === b, `${msg} (got ${a}, want ${b})`); },
  near(a, b, tol, msg) { return t.ok(Math.abs(a - b) <= tol, `${msg} (got ${a}, want ${b} +/- ${tol})`); },
  report(name, value) { console.log(`  ${name}: ${typeof value === 'number' ? Math.round(value * 1000) / 1000 : value}`); },
};
t.section(`contract: ${file} (beats 1..8 x unit 4 and 8 x 16 bars x ${seeds} seeds, every 4th seed also as the boss variant)`);
const bad = checkPack(pack, t, { seeds });
if (!bad && !argv.includes('--contract') && pack && GENRES[pack.id]) {
  // the draft takes its genre's place among the eight: kick/bass lock, riff identity, kit distinctness
  t.section('groove: this pack among the other seven');
  checkGroove(Object.keys(GENRES).map(id => (id === pack.id ? pack : GENRES[id])), t, { only: pack.id });
} else if (!bad && pack && !GENRES[pack.id]) console.log('  (id "' + pack.id + '" is not one of the eight genres: groove gates skipped)');
console.log(fails ? `${fails} of ${checks} checks FAILED for ${file}` : `OK ${pack.id}: ${checks} checks passed for ${file}`);
process.exit(fails ? 1 : 0);

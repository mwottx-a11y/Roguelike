// Music test runner. Every file in tools/t/*.mjs default-exports `async function (t)` and checks one module.
//   node tools/musictest.mjs            run everything
//   node tools/musictest.mjs theme mix  run only files whose name contains one of the words
// Gates: t.ok / t.eq / t.near are hard (a failure fails the run). t.report prints a number for the log only.
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const dir = join(dirname(fileURLToPath(import.meta.url)), 't');
const want = process.argv.slice(2);
const files = readdirSync(dir).filter(f => f.endsWith('.mjs') && !f.startsWith('_')).sort()
  .filter(f => !want.length || want.some(w => f.includes(w)));
let fails = 0, checks = 0;
for (const f of files) {
  const failed = [];
  const t = {
    section(name) { console.log('  - ' + name); },
    ok(cond, msg) { checks++; if (!cond) { failed.push(msg); if (failed.length <= 12) console.log('    FAIL ' + msg); } return !!cond; },
    eq(a, b, msg) { return t.ok(a === b, `${msg} (got ${a}, want ${b})`); },
    near(a, b, tol, msg) { return t.ok(Math.abs(a - b) <= tol, `${msg} (got ${a}, want ${b} +/- ${tol})`); },
    report(name, value) { console.log(`    ${name}: ${typeof value === 'number' ? Math.round(value * 1000) / 1000 : value}`); },
  };
  console.log(f);
  try { await (await import(pathToFileURL(join(dir, f)).href)).default(t); }
  catch (e) { failed.push('threw: ' + (e && e.stack || e)); console.log('    THREW ' + (e && e.stack || e)); }
  if (failed.length > 12) console.log(`    ... and ${failed.length - 12} more`);
  fails += failed.length;
}
console.log(`${files.length} files, ${checks} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);

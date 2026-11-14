// Turns the single-file build into a body-only HTML fragment (for hosts that supply their own <html> skeleton).
// usage: SINGLE=1 npx vite build && node tools/artifact.mjs <out.html>
import fs from 'fs';
const html = fs.readFileSync('dist-single/game.html', 'utf8');
const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.trim());
const out = `<title>HEXBEAT</title>
<meta name="theme-color" content="#0b0714">
<style>:root{color-scheme:dark;--bg:#0b0714;--fg:#f4f4f4}body{background:var(--bg);color:var(--fg)}
${styles}</style>
<div id="stage"><canvas id="three"></canvas><div id="ui"></div></div>
${scripts.map(s => `<script type="module">${s}</script>`).join('\n')}
`;
fs.writeFileSync(process.argv[2], out);
console.log('wrote', process.argv[2], (out.length / 1024).toFixed(0) + ' KB', 'scripts', scripts.length, 'fonts inlined', /font\/woff2;base64/.test(out));

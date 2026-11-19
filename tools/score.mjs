// A text score: read the music instead of listening to it.
//   node tools/score.mjs --genre funk --parts kit,tops,bass,comp,color,lead --meter 4/4 --seed 7 --bars 0-3
//   node tools/score.mjs --seed 7 --theme [--meter 6/8]          the neutral tune, all 16 bars
// Options: --variant boss   --leader <genre> (the genre that picked the mode; default --genre)
//          --pack path/to/pack.js (score a draft pack that is not in GENRES)
// Drum grid: one row per drum voice, one column per sixteenth (in /8 a beat is an eighth, so two columns per
// beat). A cell is two digits: velocity 1-9, then priority 0-3 (0 never dropped ... 3 dropped first).
// Pitched parts: per beat [n], each event `offset Note length vVelocity pPriority`, with
//   *  structural lead note        ~orn(Note)  ornament and its neighbour pitch
//   C3+G3+C4  one chord event      {dist} {pad} {arp 0 3 7 12}  the x field        (echo)  a chiprock echo
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { Song, GENRES, NOTE } from '../src/music.js';

const args = {}; { const a = process.argv.slice(2); for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { const k = a[i].slice(2); args[k] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true; } }
if (args.help || args.h) { console.log('usage: node tools/score.mjs --genre <id> [--parts kit,tops,bass,comp,color,lead] [--meter 4/4] [--seed 7] [--bars 0-3] [--variant boss] [--leader <id>] [--pack file] | --theme'); process.exit(0); }
const [beats, unit] = String(args.meter || '4/4').split('/').map(Number);
const seed = args.seed === undefined ? 7 : Number(args.seed) >>> 0;
let pack = null;
if (args.pack) pack = (await import(pathToFileURL(resolve(String(args.pack))).href)).default;
const genre = pack ? pack.id : String(args.genre || 'baroque');
if (!pack) pack = GENRES[genre];
if (!pack) { console.error('unknown genre ' + genre + ' (have: ' + Object.keys(GENRES).join(', ') + ')'); process.exit(1); }
const leader = String(args.leader || (GENRES[genre] ? genre : 'baroque'));
const song = new Song(seed, [[leader, 1]]);
if (args.variant === 'boss') song.setVariant('boss');
const parts = String(args.parts || 'kit,tops,bass,comp,color,lead').split(',').filter(Boolean);
const bars = []; for (const seg of String(args.bars === undefined ? (args.theme ? '0-15' : '0-3') : args.bars).split(',')) { const [a, b] = seg.split('-').map(Number); for (let i = a; i <= (b === undefined ? a : b); i++) bars.push(i); }

const nn = n => NOTE[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
const f2 = x => { const s = (Math.round(x * 100) / 100).toString(); return s.startsWith('0.') ? s.slice(1) : s; };
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
function chordName(f) {
  const c = f.chord, t = c.tones[1] - c.tones[0], q = c.tones[2] - c.tones[0];
  const qual = t === 4 && q === 7 ? '' : t === 3 && q === 7 ? 'm' : t === 3 && q === 6 ? 'dim' : t === 4 && q === 8 ? 'aug' : t === 4 && q === 6 ? '(b5)' : '?';
  const rom = t === 3 ? ROMAN[c.di].toLowerCase() : ROMAN[c.di];
  return `${rom}${q === 6 && t === 3 ? '°' : q === 8 ? '+' : ''} = ${NOTE[(f.tonic + c.root) % 12]}${qual} (${c.pcs.map(p => NOTE[(f.tonic + p) % 12]).join(' ')}; 7th ${NOTE[(f.tonic + c.sev) % 12]})`;
}
const SEC = ['A1', 'A2', 'B', 'A3'];
function header(f) {
  const N = f.beats * f.ppb; let cl = ''; for (let p = 0; p < N; p++) cl += f.clave.includes(p) ? 'x' : '.';
  return `bar ${String(f.idx).padStart(2)}  ${SEC[f.rep]}.${f.pos + 1}  ${chordName(f)} | voicing ${f.voicing.map(nn).join(' ')} | bass root ${nn(f.bassRoot)} -> ${nn(f.nextBassRoot)} | clave ${cl} (pulse = ${f.unit === 4 ? 'eighth, 2 per beat' : 'eighth = beat'}) | groups ${f.groups.join('+')}`;
}
const DRUM_ORDER = ['crash', 'ride', 'ohat', 'hat', 'pedal', 'shaker', 'tamb', 'brush', 'cow', 'rim', 'clap', 'snare', 'tom1', 'tom2', 'tom3', 'timp', 'kick'];
function drumGrid(rows, label) {
  // rows: [[part, Ev[][]]]
  const cols = unit === 4 ? 4 : 2, voices = new Map();
  for (const [part, ev] of rows) ev.forEach((L, b) => { for (const e of L) if (typeof e.n === 'string') { const key = part + ' ' + e.n; if (!voices.has(key)) voices.set(key, new Array(beats * cols).fill('--')); voices.get(key)[b * cols + Math.round(e.o * cols)] = '' + Math.max(1, Math.min(9, Math.round(e.v * 9))) + e.p; } });
  if (!voices.size) return;
  const keys = [...voices.keys()].sort((a, b) => DRUM_ORDER.indexOf(a.split(' ')[1]) - DRUM_ORDER.indexOf(b.split(' ')[1]));
  const w = Math.max(...keys.map(k => k.length)) + 2;
  let head = ''.padEnd(w + 2); for (let b = 0; b < beats; b++) head += String(b + 1).padEnd(cols * 3 + 2);
  console.log(`  ${label}`); console.log(head.trimEnd());
  for (const k of keys) { let line = '  ' + k.padEnd(w); const v = voices.get(k); for (let b = 0; b < beats; b++) line += (b ? '| ' : '') + v.slice(b * cols, b * cols + cols).join(' ') + ' '; console.log(line.trimEnd()); }
}
function evText(e) {
  const pitch = e.ns ? e.ns.map(nn).join('+') : nn(e.n);
  let s = `${f2(e.o) || '0'} ${pitch}${e.s ? '*' : ''} ${f2(e.d)} v${Math.round(e.v * 100)} p${e.p}`;
  if (e.orn) s += ` ~${e.orn}(${nn(e.on)})`;
  if (e.echo) s += ' (echo)';
  if (e.x) s += e.x.arp ? ` {arp ${e.x.arp.join(' ')}}` : e.x.bus ? ` {${e.x.bus}}` : e.x.pad ? ' {pad}' : '';
  return s;
}
function pitched(part, ev) {
  const any = ev.some(L => L.some(e => typeof e.n === 'number')); if (!any) return;
  const patch = new Set(); ev.forEach(L => L.forEach(e => { if (e.i) patch.add(e.i); }));
  const segs = ev.map((L, b) => `[${b + 1}] ` + (L.filter(e => typeof e.n === 'number').map(evText).join(', ') || '-'));
  console.log(`  ${(part + ' (' + [...patch].join('/') + ')').padEnd(18)} ${segs.join(' | ')}`);
}

console.log(`seed ${seed}  ${song.keyLabel}${song.variant ? ' (boss variant of ' + song.mode + ')' : ''}  mode picked by ${leader}  meter ${beats}/${unit}  plan ${song.plan.join(' ')}`);
if (args.theme) {
  const th = song.theme;
  console.log(`theme: hook x = ${th.x.rh} ${th.x.shape} ${th.x.dir > 0 ? 'up' : 'down'}, answer y = ${th.y.rh} ${th.y.shape} ${th.y.dir > 0 ? 'up' : 'down'}, grammar ${th.gram}, leap ${th.leap}, pickup ${th.pickup} pulses, peak ${nn(song.pitchAt(10, th.peak))} on bar 10`);
  console.log('  each note: onset(beats from bar start) Note length; * structural, ^ the peak, = the held cadence note');
  for (const idx of bars) {
    const f = song.frame(idx, beats, unit);
    const notes = f.theme.map(n => `${f2(n.beat + n.o) || '0'} ${nn(n.n)}${n.pk ? '^' : ''}${n.c ? '=' : ''}${n.s ? '*' : ''} ${f2(n.d)}`).join(', ');
    console.log(`bar ${String(idx).padStart(2)} ${SEC[f.rep]}.${f.pos + 1} ${chordName(f).split(' (')[0].padEnd(12)} ${notes}${f.holes.length ? '   rests: ' + f.holes.map(h => f2(h.beat + h.o) + '+' + f2(h.d)).join(' ') : ''}   rune: ${f.rune.map(nn).join(' ')}`);
  }
  process.exit(0);
}
console.log(`genre ${pack.name}: lead ${pack.inst.lead.join('/')}, bass ${pack.inst.bass}, comp ${pack.inst.comp}, color ${pack.inst.color}; kit ${pack.drumKit}; swing ${f2(pack.swing)}; dialect ${JSON.stringify(pack.dialect)}`);
for (const idx of bars) {
  const f = song.frame(idx, beats, unit), stems = parts.map(p => [p, song.render(idx, beats, unit, pack, p)]);
  console.log(header(f));
  drumGrid(stems.filter(([p]) => p !== 'lead'), `drums: velocity 1-9 then priority 0-3; ${unit === 4 ? 'a column is a sixteenth' : 'a column is half a beat (a sixteenth)'}`);
  for (const [p, ev] of stems) pitched(p, ev);
}

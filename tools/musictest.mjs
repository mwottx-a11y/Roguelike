// Sanity-checks the composer against basic theory rules: node tools/musictest.mjs
import { Song, GENRES, BIOME_GENRES, MODES, grouping } from '../src/music.js';
const METERS = [[2, 4], [3, 4], [4, 4], [5, 4], [5, 8], [6, 8], [7, 8], [8, 8], [1, 4]];
let bad = 0, songs = 0; const stats = {};
for (const biome of Object.keys(BIOME_GENRES)) for (let seed = 1; seed <= 40; seed++) {
  const s = new Song(seed * 7919 + biome.length, biome); songs++;
  const st = stats[s.genreId] || (stats[s.genreId] = { n: 0, lead: 0, inScale: 0, strong: 0, strongCT: 0, bassDown: 0, bassRoot: 0, bars: 0, ev: 0, leaps: 0, steps: 0, lo: 999, hi: 0, titles: new Set() });
  st.n++; st.titles.add(s.title);
  for (const [beats, unit] of METERS) {
    let prev = null;
    for (let i = 0; i < 16; i++) {
      const b = s.bar(i, beats, unit); st.bars++;
      if (b.events.length !== beats) { bad++; console.log('BAD length', s.title, beats, unit); }
      if (grouping(beats, unit).reduce((a, c) => a + c, 0) !== beats) { bad++; console.log('BAD grouping', beats, unit); }
      const hasBassDown = b.events[0].some(e => e.part === 'bass' && e.o === 0);
      st.bassDown++; if (hasBassDown) { const e = b.events[0].find(e => e.part === 'bass' && e.o === 0); if (((e.n - s.tonic) % 12 + 12) % 12 === b.chord.root % 12) st.bassRoot++; }
      b.events.forEach((list, bi) => list.forEach(e => {
        st.ev++;
        if (!(e.o >= 0 && e.o < 1) || !(e.v > 0 && e.v <= 1) || (e.part !== 'drum' && (!Number.isFinite(e.n) || e.n < 24 || e.n > 100 || !(e.d > 0)))) { bad++; console.log('BAD event', s.title, beats, unit, JSON.stringify(e)); }
        if (e.part === 'lead') {
          st.lead++; const pc = ((e.n - s.tonic) % 12 + 12) % 12;
          if (b.chord.scale.includes(pc)) st.inScale++;
          if (e.o === 0 && b.accents.includes(bi)) { st.strong++; if (b.chord.pcs.includes(pc)) st.strongCT++; }
          if (prev !== null) { const d = Math.abs(e.n - prev); if (d > 4) st.leaps++; else st.steps++; }
          prev = e.n; st.lo = Math.min(st.lo, e.n); st.hi = Math.max(st.hi, e.n);
        }
      }));
      // same bar requested twice must be identical (the tune is stable)
      if (s.bar(i, beats, unit) !== b) { bad++; console.log('BAD cache'); }
    }
  }
}
const pct = (a, b) => (100 * a / b).toFixed(0) + '%';
for (const g in stats) { const t = stats[g]; console.log(g.padEnd(10), `songs ${String(t.n).padStart(3)}  melody in scale ${pct(t.inScale, t.lead)}  strong beats on chord tones ${pct(t.strongCT, t.strong)}  bass root on downbeat ${pct(t.bassRoot, t.bassDown)}  stepwise ${pct(t.steps, t.steps + t.leaps)}  range ${t.lo}-${t.hi}  ev/bar ${(t.ev / t.bars).toFixed(0)}  distinct keys/modes ${t.titles.size}`); }
console.log('songs', songs, 'genres', Object.keys(stats).length + '/' + Object.keys(GENRES).length, 'violations', bad);
const ex = new Song(12345, 'vault'); console.log('example:', ex.title, 'A', JSON.stringify(ex.progA), 'B', JSON.stringify(ex.progB), 'lead', ex.leadInst);
const bar = ex.bar(0, 5, 4); console.log('5/4 bar 1 lead:', bar.events.map((l, i) => l.filter(e => e.part === 'lead').map(e => `${i + 1}+${e.o.toFixed(2)}:${e.n}`).join(' ')).join(' | '));
console.log('5/4 bar 1 drums:', bar.events.map(l => l.filter(e => e.part === 'drum').map(e => e.n + '@' + e.o.toFixed(2)).join(',')).join(' | '));
process.exit(bad ? 1 : 0);

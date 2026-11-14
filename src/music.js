// HEXBEAT — procedural composer. Pure data, no audio: given a seed it invents a song (genre, key, mode,
// chord progressions, a 16-bar AABA form) and can write any bar of it in any meter on demand, so the
// tune survives the wheel changing time signature mid-song.
//
// A bar is { chord, voicing, events }, events[beat] = [{ o, part, n, d, v }]
//   o = offset inside the beat (0..1), d = duration in beats, v = velocity 0..1
//   part = 'lead' | 'bass' | 'comp' | 'drum'; n = midi note, or a drum name for part 'drum'

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hashStr = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const pickR = (R, arr) => arr[Math.floor(R() * arr.length)];
const wpick = (R, pairs) => { let t = 0; for (const p of pairs) t += p[1]; let r = R() * t; for (const p of pairs) { r -= p[1]; if (r <= 0) return p[0]; } return pairs[pairs.length - 1][0]; };

export const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10], harmonic: [0, 2, 3, 5, 7, 8, 11],
};
const MODE_LABEL = { major: 'major', dorian: 'dorian', aeolian: 'minor', phrygian: 'phrygian', mixolydian: 'mixolydian', harmonic: 'harmonic minor' };
// Progressions as scale degrees (0 = tonic). 'V' = the major dominant borrowed into a minor key.
const PROGS = {
  aeolian: [[0, 5, 6, 0], [0, 6, 5, 'V'], [0, 3, 6, 2], [0, 3, 'V', 0], [5, 6, 0, 0], [0, 2, 6, 'V']],
  harmonic: [[0, 3, 'V', 0], [0, 3, 6, 2], [0, 5, 3, 'V'], [0, 'V', 5, 'V']],
  dorian: [[0, 3, 0, 3], [0, 6, 3, 0], [0, 2, 3, 0], [0, 3, 6, 0]],
  phrygian: [[0, 1, 0, 6], [0, 1, 2, 1], [0, 6, 1, 0]],
  major: [[0, 4, 5, 3], [0, 5, 1, 4], [0, 3, 4, 0], [1, 4, 0, 5], [0, 3, 0, 4], [0, 2, 3, 4]],
  mixolydian: [[0, 6, 3, 0], [0, 6, 0, 6], [0, 3, 6, 0], [0, 4, 6, 3]],
};
const DOMINANT = { aeolian: 'V', harmonic: 'V', dorian: 6, phrygian: 1, major: 4, mixolydian: 6 };

export const GENRES = {
  chiprock: { name: 'Chip Rock', modes: ['aeolian', 'dorian'], lead: ['square', 'sawlead'], comp: ['strings', 'pad'], comp2: ['pluck', 'arp'], bass: ['synbass', 'root8'], drums: 'rock', dens: 0.65 },
  baroque: { name: 'Baroque', modes: ['harmonic'], lead: ['flute', 'harpsi'], comp: ['harpsi', 'arp'], comp2: ['organ', 'pad'], bass: ['organ', 'oompah'], drums: 'court', dens: 0.75 },
  funk: { name: 'Funk', modes: ['dorian', 'mixolydian'], lead: ['brass', 'clav'], comp: ['epiano', 'stab'], bass: ['slap', 'funk'], drums: 'funk', dens: 0.55, sevenths: true },
  synthwave: { name: 'Synthwave', modes: ['aeolian'], lead: ['sawlead', 'square'], comp: ['strings', 'pad'], comp2: ['pluck', 'arp'], bass: ['synbass', 'root8'], drums: 'disco', dens: 0.45 },
  jazz: { name: 'Jazz', modes: ['dorian', 'major'], lead: ['vibes', 'epiano'], comp: ['epiano', 'comp'], bass: ['finger', 'walk'], drums: 'swing', dens: 0.6, swing: 0.66, sevenths: true },
  latin: { name: 'Latin', modes: ['major', 'mixolydian'], lead: ['marimba', 'flute'], comp: ['nylon', 'strum'], bass: ['finger', 'latin'], drums: 'latin', dens: 0.65 },
  metal: { name: 'Metal', modes: ['phrygian', 'aeolian'], lead: ['sawlead', 'square'], comp: ['dist', 'power'], bass: ['synbass', 'root8'], drums: 'metal', dens: 0.7 },
  celtic: { name: 'Celtic', modes: ['dorian', 'mixolydian'], lead: ['flute', 'fiddle'], comp: ['nylon', 'strum'], bass: ['finger', 'oompah'], drums: 'folk', dens: 0.8 },
};
export const BIOME_GENRES = {
  crypt: ['baroque', 'chiprock', 'synthwave'], hollow: ['celtic', 'latin', 'funk'], vault: ['jazz', 'synthwave', 'baroque'],
  foundry: ['metal', 'funk', 'chiprock'], stage: ['funk', 'metal', 'jazz', 'synthwave', 'latin'],
};
const NOTE = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

// How each meter is felt: groups of beats. Group starts carry the accents.
export function grouping(beats, unit) {
  if (unit === 4) return { 1: [1], 2: [2], 3: [3], 4: [2, 2], 5: [3, 2] }[beats] || [beats];
  return { 1: [1], 2: [2], 3: [3], 4: [2, 2], 5: [3, 2], 6: [3, 3], 7: [2, 2, 3], 8: [2, 2, 2, 2] }[beats] || [beats];
}
// Backbone drum pattern per meter: K kick, S snare, s soft snare/rim, h nothing special
const KIT = {
  4: { 1: 'K', 2: 'KS', 3: 'Kss', 4: 'KSKS', 5: 'KhSKS' },
  8: { 1: 'K', 2: 'KS', 3: 'KhS', 4: 'KhSh', 5: 'KhhSh', 6: 'KhhShh', 7: 'KhShKhS', 8: 'KhShKhSh' },
};

export class Song {
  constructor(seed, biome) {
    this.seed = seed >>> 0;
    const R = rng(this.seed);
    this.genreId = pickR(R, BIOME_GENRES[biome] || Object.keys(GENRES));
    const g = this.g = GENRES[this.genreId];
    this.mode = pickR(R, g.modes);
    this.keyPc = Math.floor(R() * 12);
    this.tonic = 48 + ((this.keyPc + 6) % 12) - 6 + 0; // tonic near C3
    if (this.tonic < 45) this.tonic += 12;
    const progs = PROGS[this.mode];
    const ai = Math.floor(R() * progs.length); let bi = Math.floor(R() * progs.length); if (bi === ai) bi = (bi + 1) % progs.length;
    this.progA = progs[ai];
    const b = progs[bi], rot = 1 + Math.floor(R() * 2);
    this.progB = [b[rot % 4], b[(rot + 1) % 4], b[(rot + 2) % 4], DOMINANT[this.mode]];
    this.leadInst = pickR(R, g.lead);
    this.cache = new Map();
    this.title = `${g.name} in ${NOTE[this.keyPc]} ${MODE_LABEL[this.mode]}`;
  }
  // chord for a degree: tones as semitone offsets from the tonic (root position, stacked thirds)
  chord(deg) {
    const sc = MODES[this.mode], at = k => sc[((k % 7) + 7) % 7] + 12 * Math.floor(k / 7);
    if (deg === 'V') { const t = [7, 11, 14]; if (this.g.sevenths) t.push(17); return { deg, root: 7, tones: t, pcs: t.map(x => x % 12), scale: MODES.harmonic }; }
    const t = [at(deg), at(deg + 2), at(deg + 4)]; if (this.g.sevenths) t.push(at(deg + 6));
    return { deg, root: t[0] % 12, tones: t, pcs: t.map(x => ((x % 12) + 12) % 12), scale: sc };
  }
  section(idx) { const s = Math.floor(idx / 4) % 4, pos = idx % 4; return { sec: s === 2 ? 'B' : 'A', pos, rep: s, deg: (s === 2 ? this.progB : this.progA)[pos] }; }

  bar(idx, beats, unit) {
    idx = ((idx % 16) + 16) % 16;
    const key = idx + ':' + beats + ':' + unit;
    let b = this.cache.get(key);
    if (!b) { b = this.write(idx, beats, unit); this.cache.set(key, b); if (this.cache.size > 400) this.cache.clear(); }
    return b;
  }

  write(idx, beats, unit) {
    const S = this.section(idx), nextS = this.section((idx + 1) % 16), g = this.g;
    const chord = this.chord(S.deg), next = this.chord(nextS.deg);
    const groups = grouping(beats, unit), accents = []; { let k = 0; for (const n of groups) { accents.push(k); k += n; } }
    const isAcc = i => accents.includes(i);
    const ev = Array.from({ length: beats }, () => []);
    const put = (beat, o, part, n, d, v) => { if (beat >= 0 && beat < beats) ev[beat].push({ o, part, n, d, v }); };
    const sw = g.swing && unit === 4 ? g.swing : 0.5;
    const tag = `${this.seed}:${S.sec}:${beats}:${unit}:`;
    const tonic = this.tonic;

    // ----- voicing for chords: keep tones close to middle register (simple voice leading)
    const centre = tonic + 16;
    const voicing = chord.tones.map(t => { let m = tonic + (((t % 12) + 12) % 12); while (m < centre - 6) m += 12; while (m >= centre + 6) m -= 12; return m; }).sort((a, b2) => a - b2);

    // ----- melody
    {
      const R = rng(hashStr(tag + 'mel' + (S.pos % 2)));        // rhythm + contour: shared by bars 1/3 and 2/4 (a sequence)
      const P = rng(hashStr(tag + 'pit' + S.pos));              // starting tone
      const lo = tonic + 12, hi = tonic + 31;
      const ladder = []; for (let m = lo; m <= hi; m++) if (chord.scale.includes(((m - tonic) % 12 + 12) % 12)) ladder.push(m);
      const isCT = m => chord.pcs.includes(((m - tonic) % 12 + 12) % 12);
      const nearCT = (i, R2) => { let best = i, bd = 99; for (let k = 0; k < ladder.length; k++) if (isCT(ladder[k])) { const d = Math.abs(k - i) + (R2 ? R2() * 0.9 : 0); if (d < bd) { bd = d; best = k; } } return best; };
      let cur = nearCT(Math.floor(ladder.length * (0.3 + P() * 0.4)), P), dir = P() < 0.5 ? 1 : -1;
      const notes = []; // {beat, o, len}
      const dens = g.dens;
      for (let i = 0; i < beats; i++) {
        const acc = isAcc(i);
        let cell;
        if (unit === 4) cell = wpick(R, [['Q', acc ? 3 : 2], ['E2', 4 * dens], ['DOT', 1.2 * dens], ['OFF', acc ? 0.2 : 1.2], ['S4', dens > 0.6 ? 1.1 : 0.2], ['ESS', dens > 0.6 ? 0.8 : 0.2], ['REST', acc ? 0.15 : 1.1 - dens], ['HOLD', i === 0 ? 0 : 1.3 - dens]]);
        else cell = wpick(R, [['Q', acc ? 5 : 3], ['SS', 1.6 * dens], ['REST', acc ? 0.1 : 1.3 - dens], ['HOLD', i === 0 ? 0 : 1.7 - dens]]);
        const add = (o, len) => notes.push({ beat: i, o, len });
        if (cell === 'Q') add(0, 1); else if (cell === 'E2') { add(0, sw); add(sw, 1 - sw); } else if (cell === 'DOT') { add(0, 0.75); add(0.75, 0.25); }
        else if (cell === 'OFF') add(sw, 1 - sw); else if (cell === 'S4') { for (let k = 0; k < 4; k++) add(k * 0.25, 0.25); } else if (cell === 'ESS') { add(0, 0.5); add(0.5, 0.25); add(0.75, 0.25); }
        else if (cell === 'SS') { add(0, 0.5); add(0.5, 0.5); } else if (cell === 'HOLD' && notes.length) notes[notes.length - 1].len += 1;
      }
      // phrase ending: last group of the 4th bar resolves to one long note
      const lastAcc = accents[accents.length - 1];
      let ending = null;
      if (S.pos === 3) { while (notes.length && notes[notes.length - 1].beat >= lastAcc) notes.pop(); ending = { beat: lastAcc, o: 0, len: beats - lastAcc }; notes.push(ending); }
      if (!notes.length) notes.push({ beat: 0, o: 0, len: 1 });
      let first = true;
      for (const n of notes) {
        if (n === ending) {
          // A sections end open (5th/3rd) the first time and closed (root) the second; B always leans on the dominant chord
          const closed = S.sec === 'A' && (S.rep === 1 || S.rep === 3);
          const want = closed ? chord.pcs[0] : chord.pcs[chord.pcs.length > 2 ? 2 : 0];
          let best = cur, bd = 99; for (let k = 0; k < ladder.length; k++) if (((ladder[k] - tonic) % 12 + 12) % 12 === want) { const d = Math.abs(k - cur); if (d < bd) { bd = d; best = k; } } cur = best;
        } else if (first || (n.o === 0 && isAcc(n.beat))) cur = nearCT(cur + (first ? 0 : dir * (R() < 0.5 ? 1 : 0)), null);
        else {
          const r = R();
          if (R() < 0.28) dir = -dir;
          if (cur >= ladder.length - 2) dir = -1; else if (cur <= 1) dir = 1;
          cur += r < 0.62 ? dir : r < 0.86 ? dir * 2 : 0;
          cur = Math.max(0, Math.min(ladder.length - 1, cur));
        }
        first = false;
        put(n.beat, n.o, 'lead', ladder[cur], n.len * 0.92, n.o === 0 && isAcc(n.beat) ? 0.95 : 0.75);
      }
    }

    // ----- bass
    {
      const R = rng(hashStr(tag + 'bass' + S.pos)), style = g.bass[1];
      let root = tonic - 24 + chord.root; while (root < 31) root += 12; while (root > 45) root -= 12;
      let nroot = tonic - 24 + next.root; while (nroot < 31) nroot += 12; while (nroot > 45) nroot -= 12;
      const fifth = root + 7, third = root + (chord.tones[1] - chord.tones[0]), approach = nroot + (R() < 0.5 ? -1 : (chord.scale.includes((nroot + 2 - tonic + 240) % 12) ? 2 : 1));
      const last = beats - 1;
      if (style === 'root8') {
        for (let i = 0; i < beats; i++) {
          if (unit === 4) { put(i, 0, 'bass', root, 0.45, isAcc(i) ? 1 : 0.8); put(i, 0.5, 'bass', i === last ? approach : (R() < 0.25 ? root + 12 : root), 0.42, 0.7); }
          else put(i, 0, 'bass', i === last && beats > 2 ? approach : (!isAcc(i) && R() < 0.2 ? root + 12 : root), 0.8, isAcc(i) ? 1 : 0.72);
        }
      } else if (style === 'walk') {
        const pool = [third, fifth, root + 12, root + 2, fifth - 2, third + 12 > 52 ? third : third];
        for (let i = 0; i < beats; i++) {
          if (unit === 8 && !isAcc(i) && i !== last && R() < 0.5) continue;
          const n = i === 0 ? root : i === last && beats > 1 ? approach : pickR(R, pool);
          put(i, 0, 'bass', n, 0.9, isAcc(i) ? 0.95 : 0.8);
          if (unit === 4 && R() < 0.12) put(i, sw, 'bass', n, 0.3, 0.5);
        }
      } else if (style === 'oompah') {
        accents.forEach((a, gi) => put(a, 0, 'bass', gi % 2 ? fifth - 12 < 31 ? fifth : fifth - 12 : root, unit === 4 ? 0.9 : 1.6, 1));
        for (let i = 0; i < beats; i++) if (!isAcc(i) && unit === 4) put(i, 0, 'bass', R() < 0.5 ? fifth : third + 12 > 55 ? third : third + 12, 0.4, 0.55);
        if (beats > 2 && R() < 0.5) put(last, unit === 4 ? 0.5 : 0, 'bass', approach, 0.4, 0.7);
      } else if (style === 'funk') {
        put(0, 0, 'bass', root, 0.4, 1);
        for (let i = 0; i < beats; i++) {
          const cell = wpick(R, [['-', 2], ['a', 2], ['e', 1.5], ['oa', 1.5], ['ea', 1.2]]);
          const tone = () => wpick(R, [[root, 3], [root + 12, 2], [root + 10, 1], [fifth, 1]]);
          if (unit === 8) { if (i > 0 && cell !== '-') put(i, cell === 'ea' ? 0.5 : 0, 'bass', tone(), 0.4, isAcc(i) ? 0.9 : 0.7); continue; }
          if (i > 0 && isAcc(i)) put(i, 0, 'bass', root, 0.3, 0.9);
          if (cell === 'a') put(i, 0.75, 'bass', tone(), 0.2, 0.75); else if (cell === 'e') put(i, 0.5, 'bass', tone(), 0.22, 0.7);
          else if (cell === 'oa') { put(i, 0.5, 'bass', root + 12, 0.15, 0.8); put(i, 0.75, 'bass', tone(), 0.2, 0.7); } else if (cell === 'ea') { put(i, 0.25, 'bass', tone(), 0.2, 0.6); put(i, 0.75, 'bass', tone(), 0.2, 0.75); }
        }
      } else { // latin
        accents.forEach((a, gi) => { const len = groups[gi]; put(a, 0, 'bass', root, unit === 4 ? 1.4 : 1.6, 1); if (len >= 2) { if (unit === 4) put(a + 1, 0.5, 'bass', fifth, 0.9, 0.8); else put(a + len - 1, 0, 'bass', fifth, 0.9, 0.8); } });
        put(last, unit === 4 ? 0.5 : 0, 'bass', nroot, 0.5, 0.85);
      }
    }

    // ----- chords
    const comp = (inst, style, salt) => {
      const R = rng(hashStr(tag + 'comp' + style + salt + (S.pos % 2)));
      const all = (beat, o, d, v, tones = voicing) => tones.forEach(m => put(beat, o, 'comp:' + inst, m, d, v));
      if (style === 'pad') all(0, 0, beats * 0.98, 0.6);
      else if (style === 'arp') {
        const pat = pickR(R, [[0, 1, 2, 1], [0, 2, 1, 2], [0, 1, 2, 3], [2, 1, 0, 1]]), sub = unit === 4 ? (g.dens > 0.7 ? 4 : 2) : 1; let k = 0;
        const tones = [...voicing, voicing[0] + 12];
        for (let i = 0; i < beats; i++) for (let q = 0; q < sub; q++) put(i, q / sub, 'comp:' + inst, tones[pat[k++ % 4] % tones.length], 0.9 / sub, q === 0 && isAcc(i) ? 0.7 : 0.5);
      } else if (style === 'stab') {
        for (let i = 0; i < beats; i++) {
          if (unit === 8) { if (!isAcc(i) && R() < 0.75) all(i, 0, 0.35, 0.6); continue; }
          const cell = wpick(R, [['off', 4], ['two', 1.5], ['late', 1.5], ['-', 1]]);
          if (cell === 'off') all(i, 0.5, 0.2, 0.65); else if (cell === 'two') { all(i, 0.25, 0.12, 0.5); all(i, 0.75, 0.15, 0.6); } else if (cell === 'late') { all(i, 0.5, 0.12, 0.6); all(i, 0.75, 0.12, 0.5); }
        }
      } else if (style === 'comp') {
        for (let i = 0; i < beats; i++) {
          if (unit === 8) { if (isAcc(i) || R() < 0.25) all(i, 0, isAcc(i) ? 1.2 : 0.4, isAcc(i) ? 0.6 : 0.45); continue; }
          const cell = wpick(R, [['on', isAcc(i) ? 3 : 1], ['sw', 2.2], ['both', 1], ['-', 2]]);
          if (cell === 'on' || cell === 'both') all(i, 0, 0.3, 0.55); if (cell === 'sw' || cell === 'both') all(i, sw, 0.5, 0.6);
        }
      } else if (style === 'power') {
        let r = tonic - 12 + chord.root; while (r < 40) r += 12; while (r > 52) r -= 12; const pw = [r, r + 7, r + 12];
        for (let i = 0; i < beats; i++) {
          if (unit === 8) { all(i, 0, isAcc(i) ? 0.85 : 0.4, isAcc(i) ? 0.8 : 0.55, pw); continue; }
          all(i, 0, isAcc(i) ? 0.45 : 0.25, isAcc(i) ? 0.8 : 0.6, pw); if (R() < 0.85) all(i, 0.5, 0.22, 0.55, pw); if (R() < 0.25) all(i, 0.75, 0.15, 0.5, pw);
        }
      } else { // strum
        for (let i = 0; i < beats; i++) { all(i, 0, isAcc(i) ? 0.8 : 0.35, isAcc(i) ? 0.7 : 0.45); if (unit === 4 && R() < 0.6) all(i, 0.5, 0.25, 0.4, voicing.slice(1)); }
      }
    };
    comp(g.comp[0], g.comp[1], 'a');
    if (g.comp2) comp(g.comp2[0], g.comp2[1], 'b');

    // ----- drums
    {
      const R = rng(hashStr(tag + 'drum' + (S.pos % 2))), style = g.drums, kit = (KIT[unit][beats] || 'K' + 'h'.repeat(beats - 1));
      const d = (beat, o, n, v) => put(beat, o, 'drum', n, 0, v);
      const fill = S.pos === 3, lastAcc = accents[accents.length - 1];
      for (let i = 0; i < beats; i++) {
        const c = kit[i], inFill = fill && i >= lastAcc && beats > 1;
        const K = c === 'K', Sn = c === 'S', sn = c === 's';
        if (style === 'rock' || style === 'metal' || style === 'disco' || style === 'funk') {
          if (K || (style === 'disco' && (unit === 4 || i % 2 === 0))) d(i, 0, 'kick', 1);
          if (Sn) d(i, 0, style === 'disco' ? 'clap' : 'snare', 1); if (Sn && style === 'disco') d(i, 0, 'snare', 0.6); if (sn) d(i, 0, 'snare', 0.55);
          if (!inFill) {
            if (style === 'funk' && unit === 4) { for (let q = 0; q < 4; q++) d(i, q * 0.25, R() < 0.12 ? 'ohat' : 'hat', q % 2 ? 0.4 : 0.7); if (R() < 0.3) d(i, 0.75, 'snare', 0.25); if (R() < 0.35) d(i, wpick(R, [[0.5, 1], [0.75, 2]]), 'kick', 0.8); }
            else if (style === 'disco') { d(i, 0, 'hat', 0.6); if (unit === 4) d(i, 0.5, 'ohat', 0.6); else if (i % 2) d(i, 0, 'ohat', 0.5); }
            else if (style === 'metal') { d(i, 0, isAcc(i) ? 'ride' : 'hat', 0.7); if (unit === 4) { for (const q of [0.25, 0.5, 0.75]) if (!Sn || q !== 0) d(i, q, 'kick', 0.7); } else if (!K && !Sn) d(i, 0, 'kick', 0.7), d(i, 0.5, 'kick', 0.6); }
            else { d(i, 0, 'hat', 0.7); if (unit === 4) { d(i, 0.5, 'hat', 0.45); if (!K && R() < 0.25) d(i, 0.5, 'kick', 0.8); } }
          } else { const toms = ['tom1', 'tom1', 'tom2', 'tom3']; const sub = unit === 4 ? 4 : 2; for (let q = 0; q < sub; q++) d(i, q / sub, toms[Math.min(3, Math.floor(((i - lastAcc) * sub + q) / Math.max(1, (beats - lastAcc) * sub) * 4))], 0.8); }
          if (i === 0 && S.pos === 0) d(0, 0, 'crash', 0.8);
        } else if (style === 'swing') {
          d(i, 0, 'ride', isAcc(i) ? 0.8 : 0.6); if (unit === 4 && (i % 2 === 1 || R() < 0.3)) d(i, sw, 'ride', 0.45);
          if (Sn || sn) d(i, 0, 'pedal', 0.6); if (K) d(i, 0, 'kick', 0.45);
          if (R() < 0.18) d(i, unit === 4 ? sw : 0, 'snare', 0.3); if (inFill && R() < 0.6) d(i, unit === 4 ? sw : 0.5, 'snare', 0.5);
        } else if (style === 'latin') {
          if (unit === 4) { for (let q = 0; q < 4; q++) d(i, q * 0.25, 'shaker', q % 2 ? 0.35 : 0.6); } else { d(i, 0, 'shaker', 0.6); d(i, 0.5, 'shaker', 0.35); }
          if (K) d(i, 0, 'kick', 0.9); if (Sn || sn) d(i, 0, 'rim', 0.8); if (!K && R() < 0.4) d(i, unit === 4 ? 0.5 : 0, 'rim', 0.6);
          if (isAcc(i)) d(i, 0, 'cow', 0.5); else if (R() < 0.3) d(i, unit === 4 ? 0.5 : 0, 'cow', 0.35);
          if (inFill) d(i, unit === 4 ? 0.5 : 0, 'tom1', 0.7);
        } else if (style === 'folk') {
          d(i, 0, isAcc(i) ? 'tom3' : 'tom2', isAcc(i) ? 1 : 0.5); if (R() < (unit === 4 ? 0.7 : 0.3)) d(i, 0.5, 'tom2', 0.4); if (unit === 4 && R() < 0.25) d(i, 0.75, 'tom2', 0.3);
          if (Sn || sn) d(i, 0, 'tamb', 0.6);
        } else { // court
          if (i === 0 && S.pos % 2 === 0) d(0, 0, 'timp', 0.9); if (Sn || sn) d(i, 0, 'tamb', 0.45); if (inFill) d(i, 0, 'timp', 0.6 + 0.1 * (i - lastAcc));
        }
      }
    }
    for (const list of ev) list.sort((a, b2) => a.o - b2.o);
    return { chord, voicing, events: ev, groups, accents, sec: S.sec, pos: S.pos };
  }
}

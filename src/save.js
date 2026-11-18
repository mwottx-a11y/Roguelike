import { RUNES, RUNE_IDS, FEATS, META, CHARS } from './data.js';

const KEY = 'hexbeat_save_v1';

const fresh = () => ({
  echoes: 0,
  meta: {},
  chars: ['cantor'],
  char: 'cantor',
  runes: RUNE_IDS.filter(id => RUNES[id].cost === 0 && !RUNES[id].feat),
  fusions: [],
  skin: 'wizard',
  skins: ['wizard'],
  feats: [],
  volume: 0,
  maxVolume: 0,
  stats: { kills: 0, runs: 0, wins: 0, bestStage: 0, bestLevel: 0, bestCombo: 0, time: 0, echoesTotal: 0 },
  opts: { sfx: true, music: true, shake: true, bloom: true, haptics: true },
  seenTutorial: false,
});

export let save = fresh();

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw), f = fresh();
      save = { ...f, ...d, stats: { ...f.stats, ...d.stats }, opts: { ...f.opts, ...d.opts } };
      // content added after this save was made: grant anything that is free from the start
      for (const id of f.runes) if (!save.runes.includes(id)) save.runes.push(id);
      save.runes = save.runes.filter(id => RUNES[id]); save.chars = save.chars.filter(id => CHARS.some(c => c.id === id)); if (!save.chars.includes(save.char)) save.char = 'cantor';
    }
  } catch (e) { /* storage unavailable: play with a fresh profile */ }
  return save;
}
export function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
}
export function resetSave() { save = fresh(); persist(); }

export const metaLvl = id => save.meta[id] || 0;
export const hasRune = id => save.runes.includes(id);

// Checks achievements; returns newly earned ones. `r` is a run summary or null.
export function checkFeats(r) {
  const got = [];
  for (const f of FEATS) {
    if (save.feats.includes(f.id)) continue;
    let ok = false;
    try { ok = !!f.t(save.stats, r, save); } catch (e) { ok = false; }
    if (ok) {
      save.feats.push(f.id);
      save.echoes += f.echo;
      if (f.unlock && !save.runes.includes(f.unlock)) save.runes.push(f.unlock);
      got.push(f);
    }
  }
  return got;
}

export function metaTotals() {
  let have = 0, all = 0;
  for (const m of META) { have += metaLvl(m.id); all += m.max; }
  return { have, all, chars: save.chars.length, charsAll: CHARS.length, runes: save.runes.length, runesAll: RUNE_IDS.length, feats: save.feats.length, featsAll: FEATS.length };
}

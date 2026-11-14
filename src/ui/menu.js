import Phaser from 'phaser';
import { G, C, makeRoot, txt, img, btn, panel, tap, clear, hexs } from './kit.js';
import { save, persist, resetSave, metaLvl, checkFeats, metaTotals } from '../save.js';
import { CHARS, META, metaCost, RUNES, RUNE_IDS, ELEM, FEATS, FUSIONS, VOLUME_MAX, volumeDesc, TIPS, BIOMES } from '../data.js';

export class MenuScene extends Phaser.Scene {
  constructor() { super('menu'); }
  create() {
    this.view = 'home'; this.sel = 0; this.confirm = false;
    this.charIdx = Math.max(0, CHARS.findIndex(c => c.id === save.char));
    G.world.reset(); G.world.biome(BIOMES[(save.stats.runs || 0) % BIOMES.length]);
    G.audio.newSong(BIOMES[(save.stats.runs || 0) % BIOMES.length].id); this.mt = 0.3; this.mb = 0; this.runeTab = 'runes';
    const got = checkFeats(null); if (got.length) persist();
    this.tip = Phaser.Utils.Array.GetRandom(TIPS);
    this.build();
    this.scale.on('resize', this.build, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.build, this));
  }
  go(view) { this.view = view; this.sel = 0; this.confirm = false; this.build(); }
  update(t, dms) {
    if (G.hidden) return;
    const c = CHARS[this.charIdx];
    G.world.renderMenu(Math.min(0.05, dms / 1000), c.id, c.start);
    // title music: a freshly composed tune in 4/4
    this.mt = Math.max(-0.1, this.mt - dms / 1000);
    if (this.mt <= 0) { this.mt += 0.42; G.audio.step({ beat: this.mb % 4, beats: 4, unit: 4, dur: 0.42 }); this.mb++; }
  }
  header(title) {
    const r = this.root, m = this.m;
    txt(this, r, m.cx, 34 + m.top, title, 26, C.text, 0.5, 0.5, { bold: true });
    btn(this, r, m.cx - 142, 34 + m.top, 56, 30, '< BACK', () => this.go('home'), { size: 11 });
    this.echoTag(m.cx + 172, 34 + m.top);
  }
  echoTag(x, y) { const r = this.root; const t = txt(this, r, x, y, String(save.echoes), 16, C.pink, 1, 0.5, { bold: true }); img(this, r, x - t.width - 12, y, 'i_echo', 2, 0xff5ccd); }

  build() {
    clear(this);
    const r = makeRoot(this), m = this.m;
    const dim = this.add.graphics(); r.add(dim);
    if (this.view !== 'home') { dim.fillStyle(0x0b0714, 0.82); dim.fillRect(0, 0, m.UW, m.UH); }
    this[this.view]();
  }

  home() {
    const r = this.root, m = this.m, x = m.cx, ch = CHARS[this.charIdx], owned = save.chars.includes(ch.id);
    const g = this.add.graphics(); r.add(g);
    g.fillGradientStyle(0x0b0714, 0x0b0714, 0x0b0714, 0x0b0714, 0.85, 0.85, 0, 0); g.fillRect(0, 0, m.UW, 190);
    g.fillGradientStyle(0x0b0714, 0x0b0714, 0x0b0714, 0x0b0714, 0, 0, 0.92, 0.92); g.fillRect(0, m.UH - 290, m.UW, 290);
    const logoY = 84 + m.top;
    const sh = txt(this, r, x + 3, logoY + 4, 'HEXBEAT', 62, '#5d275d', 0.5, 0.5, { bold: true, stroke: 0 });
    const logo = txt(this, r, x, logoY, 'HEXBEAT', 62, '#ffffff', 0.5, 0.5, { bold: true, stroke: 8 });
    logo.setTint(0xff5ccd, 0xff5ccd, 0x73eff6, 0x73eff6);
    this.tweens.add({ targets: [logo, sh], scale: 1.04, duration: 375, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    txt(this, r, x, logoY + 40, 'BUILD THE WHEEL. SURVIVE THE BEAT.', 11, C.dim);
    this.echoTag(m.UW - 12 - m.right, 20 + m.top);

    const by = m.UH - m.bot;
    // character picker
    txt(this, r, x, by - 262, ch.name, 24, owned ? C.text : C.dim, 0.5, 0.5, { bold: true });
    txt(this, r, x, by - 240, ch.desc + '  ' + ch.perk, 11, C.gold);
    const sx = x - (ch.start.length - 1) * 16;
    ch.start.forEach((id, i) => img(this, r, sx + i * 32, by - 214, 'rune_' + id, 2));
    btn(this, r, x - 130, by - 250, 40, 40, '<', () => { this.charIdx = (this.charIdx + CHARS.length - 1) % CHARS.length; this.pickChar(); }, { size: 20 });
    btn(this, r, x + 130, by - 250, 40, 40, '>', () => { this.charIdx = (this.charIdx + 1) % CHARS.length; this.pickChar(); }, { size: 20 });
    // volume
    const vy = by - 174;
    txt(this, r, x, vy, 'VOLUME ' + save.volume, 16, save.volume ? C.pink : C.text, 0.5, 0.5, { bold: true });
    txt(this, r, x, vy + 17, save.maxVolume === 0 && save.volume === 0 ? 'Beat The Conductor to unlock higher Volume.' : volumeDesc(save.volume), 9, C.dim, 0.5, 0.5, { wrap: 300 });
    btn(this, r, x - 80, vy, 30, 26, '-', () => { save.volume = Math.max(0, save.volume - 1); persist(); this.build(); }, { size: 16 }).setDisabled(save.volume <= 0);
    btn(this, r, x + 80, vy, 30, 26, '+', () => { save.volume = Math.min(save.maxVolume, save.volume + 1); persist(); this.build(); }, { size: 16 }).setDisabled(save.volume >= save.maxVolume);
    // play / unlock
    if (owned) {
      const b = btn(this, r, x, by - 116, 220, 52, 'PLAY', () => { save.char = ch.id; persist(); G.audio.unlock(); this.scene.start('run'); }, { size: 28, fill: 0x7a1f6a, border: 0xff5ccd, sfx: 'pick' });
      this.tweens.add({ targets: b, scale: 1.05, duration: 375, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    } else {
      btn(this, r, x, by - 116, 220, 52, 'UNLOCK  ' + ch.cost, () => { save.echoes -= ch.cost; save.chars.push(ch.id); save.char = ch.id; checkFeats(null); persist(); G.audio.sfx('chest'); this.build(); }, { size: 20, fill: 0x3a2a10, border: 0xffcd75, color: C.gold, sfx: 'buy' }).setDisabled(save.echoes < ch.cost);
    }
    txt(this, r, x, by - 76, this.tip, 9, C.dim, 0.5, 0.5, { wrap: 320 });
    const T = metaTotals(), nav = [['UPGRADES', 'upgrades', `${T.have}/${T.all}`], ['RUNES', 'runes', `${T.runes}/${T.runesAll}`], ['FEATS', 'feats', `${T.feats}/${T.featsAll}`], ['OPTIONS', 'options', '']];
    nav.forEach(([label, view, sub], i) => { const bx = x - 132 + i * 88, b = btn(this, r, bx, by - 34, 82, 40, label, () => this.go(view), { size: 12 }); if (sub) { b.label.y = -7; txt(this, b, 0, 9, sub, 9, C.dim); } });
    // affordable upgrade hint
    if (META.some(u => metaLvl(u.id) < u.max && metaCost(u, metaLvl(u.id)) <= save.echoes)) { const dot = txt(this, r, x - 132 + 34, by - 52, '!', 14, C.gold, 0.5, 0.5, { bold: true }); this.tweens.add({ targets: dot, y: by - 56, duration: 300, yoyo: true, repeat: -1 }); }
  }
  pickChar() { const c = CHARS[this.charIdx]; if (save.chars.includes(c.id)) { save.char = c.id; persist(); } this.build(); }

  // generic grid + detail layout
  grid(title, items, detail, pad = 0) {
    const r = this.root, m = this.m, x = m.cx, cols = 5, cell = 62, y0 = 96 + m.top + pad;
    this.header(title);
    items.forEach((it, i) => {
      const cx = x - (cols - 1) * cell / 2 + (i % cols) * cell, cy = y0 + Math.floor(i / cols) * cell, c = this.add.container(cx, cy); r.add(c);
      const g = this.add.graphics(); c.add(g);
      const sel = i === this.sel;
      g.fillStyle(sel ? 0xffffff : C.line, 1); g.fillRect(-28, -28, 56, 56); g.fillStyle(sel ? C.panel2 : C.panel, 1); g.fillRect(-26, -26, 52, 52);
      const ic = img(this, c, 0, -6, it.icon, it.scale || 3, it.tint); if (it.dim) ic.setAlpha(0.35);
      if (it.lock) img(this, c, 16, -16, 'i_lock', 1.5, 0x9a94b8);
      txt(this, c, 0, 18, it.sub || '', 9, it.subColor || C.dim);
      tap(this, c, 56, 56, () => { this.sel = i; this.confirm = false; G.audio.sfx('ui'); this.build(); });
    });
    const d = detail(items[this.sel], this.sel), py = y0 + Math.ceil(items.length / cols) * cell + 52;
    panel(this, r, x, py, 320, 132);
    txt(this, r, x, py - 46, d.name, 17, d.color || C.text, 0.5, 0.5, { bold: true });
    txt(this, r, x, py - 14, d.desc, 11, C.dim, 0.5, 0.5, { wrap: 290, ls: 2 });
    if (d.button) btn(this, r, x, py + 38, 190, 34, d.button.label, d.button.cb, { size: 14, fill: 0x3a2a10, border: 0xffcd75, color: C.gold, sfx: 'buy' }).setDisabled(!d.button.ok);
    else if (d.note) txt(this, r, x, py + 38, d.note, 12, d.noteColor || C.green, 0.5, 0.5, { bold: true });
  }
  upgrades() {
    const items = META.map(u => { const l = metaLvl(u.id); return { icon: u.icon, tint: l >= u.max ? 0xffcd75 : l > 0 ? 0xffffff : 0x8a84a8, sub: l >= u.max ? 'MAX' : `${l}/${u.max}`, subColor: l >= u.max ? C.gold : C.dim }; });
    this.grid('UPGRADES', items, (it, i) => {
      const u = META[i], l = metaLvl(u.id), cost = metaCost(u, l);
      return { name: `${u.name}  ${l}/${u.max}`, desc: u.desc, button: l < u.max ? { label: `BUY   ${cost}`, ok: save.echoes >= cost, cb: () => { save.echoes -= cost; save.meta[u.id] = l + 1; persist(); this.build(); } } : null, note: 'MAXED', noteColor: C.gold };
    });
  }
  runes() {
    const r0 = this.root, m0 = this.m;
    btn(this, r0, m0.cx, 66 + m0.top, 200, 24, this.runeTab === 'runes' ? 'SHOW FUSIONS >' : '< SHOW RUNES', () => { this.runeTab = this.runeTab === 'runes' ? 'fusions' : 'runes'; this.sel = 0; this.build(); }, { size: 11, color: C.gold });
    if (this.runeTab === 'fusions') {
      const items = FUSIONS.map(f => { const got = (save.fusions || []).includes(f.id); return { icon: 'rune_' + f.id, dim: !got, sub: got ? 'MADE' : '', subColor: C.green }; });
      return this.grid('FUSIONS', items, (it, i) => { const f = FUSIONS[i], got = (save.fusions || []).includes(f.id); return { name: f.name, color: hexs(ELEM[f.elem].c), desc: `${RUNES[f.a].name} + ${RUNES[f.b].name}\n${f.desc}`, note: got ? 'DISCOVERED' : 'Both MAX level, side by side on the wheel', noteColor: got ? C.green : C.gold }; }, 24);
    }
    const items = RUNE_IDS.map(id => { const R = RUNES[id], own = save.runes.includes(id); return { icon: 'rune_' + id, dim: !own, lock: !own, sub: own ? '' : R.feat ? 'FEAT' : String(R.cost), subColor: C.gold }; });
    this.grid('RUNES', items, (it, i) => {
      const id = RUNE_IDS[i], R = RUNES[id], own = save.runes.includes(id), feat = R.feat && FEATS.find(f => f.id === R.feat);
      const d = { name: R.name, color: hexs(ELEM[R.elem].c), desc: `${ELEM[R.elem].name} ${R.type === 'mod' ? '' : 'spell'}\n${R.desc}` };
      if (own) d.note = 'IN YOUR POOL';
      else if (feat) { d.note = `Feat: ${feat.desc}`; d.noteColor = C.gold; }
      else d.button = { label: `UNLOCK   ${R.cost}`, ok: save.echoes >= R.cost, cb: () => { save.echoes -= R.cost; save.runes.push(id); persist(); this.build(); } };
      return d;
    }, 24);
  }
  feats() {
    const items = FEATS.map(f => { const got = save.feats.includes(f.id); return { icon: 'i_star', tint: got ? 0xffcd75 : 0x4a4266, sub: got ? 'DONE' : '+' + f.echo, subColor: got ? C.green : C.pink }; });
    this.grid('FEATS', items, (it, i) => { const f = FEATS[i], got = save.feats.includes(f.id); return { name: f.name, desc: f.desc, note: `${got ? 'EARNED' : 'REWARD'}: ${f.echo} echoes${f.unlock ? ' + ' + RUNES[f.unlock].name : ''}`, noteColor: got ? C.green : C.pink }; });
  }
  options() {
    const r = this.root, m = this.m, x = m.cx, o = save.opts; let y = 92 + m.top;
    this.header('OPTIONS');
    for (const [k, label] of [['music', 'MUSIC'], ['sfx', 'SOUND FX'], ['shake', 'SCREEN SHAKE'], ['bloom', 'BLOOM GLOW'], ['haptics', 'VIBRATION']]) {
      btn(this, r, x, y, 260, 36, `${label}:  ${o[k] ? 'ON' : 'OFF'}`, () => { o[k] = !o[k]; persist(); this.build(); }, { size: 14, color: o[k] ? C.green : C.dim }); y += 44;
    }
    const s = save.stats;
    panel(this, r, x, y + 60, 300, 130);
    txt(this, r, x, y + 60, `RUNS ${s.runs}    WINS ${s.wins}\nKILLS ${s.kills}\nBEST STAGE ${s.bestStage}    BEST LEVEL ${s.bestLevel}\nBEST COMBO ${s.bestCombo}\nMAX VOLUME ${save.maxVolume}    ECHOES EARNED ${s.echoesTotal}`, 11, C.dim, 0.5, 0.5, { ls: 5 });
    btn(this, r, x, y + 156, 220, 32, this.confirm ? 'TAP AGAIN TO ERASE' : 'RESET ALL PROGRESS', () => { if (this.confirm) { resetSave(); Object.assign(G.world.opts, save.opts); G.world.opts = G.audio.opts = save.opts; this.charIdx = 0; this.go('home'); } else { this.confirm = true; this.build(); } }, { size: 12, fill: 0x3a1020, border: 0xff5c7a, color: C.red });
  }
}

import Phaser from 'phaser';
import { G, C, makeRoot, metrics, txt, img, btn, panel, tap, box, hexs } from './kit.js';
import { save, persist, checkFeats } from '../save.js';
import { Run, xpNeed } from '../game.js';
import { RUNES, ELEM, PASSIVES, RELICS, MAX_RUNE_LVL, BIOMES } from '../data.js';

const fmtTime = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export class RunScene extends Phaser.Scene {
  constructor() { super('run'); }
  create() {
    G.world.reset();
    this.run = new Run({ char: save.char, volume: save.volume, metaLevels: save.meta, unlocked: save.runes, fx: G.world.fx, audio: G.audio });
    this.ov = null; this.ovKind = null; this.paused = false; this.joy = null; this.deadT = 0; this.banked = null; this.swapSel = -1; this.toastQ = []; this.toastT = 0; this._quit = false; this._sfxed = false; this.root = null; this.ovRoot = null;
    this.keys = this.input.keyboard ? this.input.keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE,SHIFT,E,ESC,P') : null;
    this.jg = this.add.graphics().setDepth(5);
    this.buildHud();
    this.input.on('pointerdown', (p, over) => { if (over.length || this.ov) return; if (!this.joy) this.joy = { id: p.id, ox: p.x, oy: p.y, x: p.x, y: p.y }; });
    this.input.on('pointermove', p => { if (this.joy && this.joy.id === p.id) { this.joy.x = p.x; this.joy.y = p.y; } });
    const up = p => { if (this.joy && this.joy.id === p.id) this.joy = null; };
    this.input.on('pointerup', up); this.input.on('pointerupoutside', up);
    this.scale.on('resize', this.relayout, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.relayout, this));
    if (!save.seenTutorial) this.openTutorial();
  }
  relayout() { const k = this.ovKind, d = this.ovData; this.joy = null; this.buildHud(); if (k) this.openOverlay(k, d); }

  // ---------------- HUD ----------------
  buildHud() {
    if (this.root) this.root.destroy(true);
    if (this.ovRoot) { this.ovRoot.destroy(true); this.ovRoot = null; this.ov = null; }
    const r = makeRoot(this, true), m = this.hm = this.m, run = this.run, h = this.hud = {};
    const top = m.top, L = 10 + m.left, R = m.UW - 10 - m.right;
    h.g = this.add.graphics(); r.add(h.g);
    h.lvl = txt(this, r, L, 22 + top, '', 13, C.cyan, 0, 0.5, { bold: true });
    h.hp = txt(this, r, L + 66, 39 + top, '', 10, C.text, 0.5, 0.5);
    h.gold = txt(this, r, R - 34, 22 + top, '', 13, C.gold, 1, 0.5, { bold: true });
    img(this, r, R - 26, 22 + top, 'coin', 2).setOrigin(0.5);
    h.time = txt(this, r, m.cx, 24 + top, '', 18, C.text, 0.5, 0.5, { bold: true });
    h.stage = txt(this, r, m.cx, 42 + top, '', 9, C.dim);
    h.combo = txt(this, r, R, 64 + top, '', 20, C.gold, 1, 0.5, { bold: true });
    h.boss = txt(this, r, m.cx, 66 + top, '', 11, C.red, 0.5, 0.5, { bold: true });
    h.relics = this.add.container(L, 58 + top); r.add(h.relics); h.relicN = -1;
    h.toast = txt(this, r, m.cx, m.UH * 0.27, '', 30, C.text, 0.5, 0.5, { bold: true, stroke: 6 }).setAlpha(0);
    btn(this, r, R - 8, 22 + top, 24, 24, 'II', () => this.openOverlay('pause'), { size: 11 });
    // wheel strip
    const by = m.UH - m.bot;
    h.wheelY = by - 32; h.wheel = this.wheelRow(r, m.cx, h.wheelY, 32, null);
    // action buttons
    const bx = R - 40, mk = (y, label, key, cb) => {
      const c = this.add.container(bx, y), g = this.add.graphics(); c.add(g); r.add(c);
      c.g = g; c.t = txt(this, c, 0, -2, label, 13, C.text, 0.5, 0.5, { bold: true }); c.k = txt(this, c, 0, 13, m.touch ? '' : key, 8, C.dim);
      tap(this, c, 76, 76, cb, { instant: true }); return c;
    };
    h.dash = mk(by - 112, 'DASH', 'SPACE', () => { run.input.dash = true; });
    h.drop = mk(by - 196, 'DROP', 'E', () => { run.input.drop = true; });
    this.hudTick(true);
    this.m = metrics(this);
  }
  wheelRow(parent, cx, cy, size, onTap) {
    const run = this.run, c = this.add.container(cx, cy), n = run.size, sp = size + 4, w = { c, slots: [], n, size };
    parent.add(c);
    w.hl = this.add.graphics(); c.add(w.hl);
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * sp, s = this.add.container(x, 0); c.add(s);
      s.im = img(this, s, 0, 0, 'slot_empty', size / 13);
      s.lv = txt(this, s, size / 2 - 1, size / 2 - 1, '', 9, C.gold, 1, 1, { bold: true });
      s.res = txt(this, s, -size / 2 + 1, -size / 2, '', 8, C.green, 0, 0, { bold: true });
      if (onTap) tap(this, s, size + 2, size + 2, () => onTap(i), { instant: true });
      w.slots.push(s);
    }
    w.refresh = () => { for (let i = 0; i < n; i++) { const q = run.wheel[i], s = w.slots[i]; s.im.setFrame(q ? 'rune_' + q.id : 'slot_empty'); s.lv.setText(q ? (q.lvl >= MAX_RUNE_LVL ? 'MAX' : String(q.lvl)) : ''); s.res.setText(run.res[i] ? '+' + run.res[i] : ''); } };
    w.refresh(); return w;
  }
  hudTick(force) {
    const h = this.hud, run = this.run, m = this.hm, p = run.p, s = run.s, g = h.g, st = run.stage, top = m.top, L = 10 + m.left;
    g.clear();
    // xp
    g.fillStyle(C.ink, 0.8); g.fillRect(0, top, m.UW, 8);
    g.fillStyle(0x73eff6, 1); g.fillRect(0, top + 1, m.UW * Math.min(1, run.xp / xpNeed(run.level)), 5);
    // hp
    box(g, L, 32 + top, 132, 14, 0x2a1020, C.ink);
    const hpq = Math.max(0, p.hp / s.maxHp); g.fillStyle(hpq < 0.3 ? 0xff3050 : 0xe0425e, 1); g.fillRect(L + 2, 34 + top, 128 * hpq, 10); g.fillStyle(0xffffff, 0.25); g.fillRect(L + 2, 34 + top, 128 * hpq, 3);
    h.hp.setText(`${Math.ceil(p.hp)}/${s.maxHp}`); h.lvl.setText('LV ' + run.level); h.gold.setText(String(run.gold));
    h.time.setText(st.boss ? 'BOSS' : st.bossDone ? 'CLEAR' : fmtTime(Math.max(0, st.dur - st.t))); h.time.setColor(st.boss ? C.red : C.text);
    h.stage.setText(`STAGE ${st.n + 1}  ${st.biome.name}${run.volume ? '  VOL ' + run.volume : ''}`);
    h.combo.setText(run.combo >= 5 ? 'x' + run.combo : ''); if (run.combo >= 5) h.combo.setScale(1 + Math.min(0.5, run.comboT > 2.4 ? 0.25 : 0));
    if (st.boss) { const b = st.boss, w = Math.min(300, m.UW - 40), x = m.cx - w / 2; box(g, x, 74 + top, w, 12, 0x2a1020, C.ink); g.fillStyle(0xff3050, 1); g.fillRect(x + 2, 76 + top, (w - 4) * Math.max(0, b.hp / b.maxHp), 8); h.boss.setText(b.name); } else h.boss.setText('');
    if (h.relicN !== run.relics.length || force) { h.relicN = run.relics.length; h.relics.removeAll(true); run.relics.forEach((id, i) => img(this, h.relics, 8 + (i % 8) * 17, 6 + Math.floor(i / 8) * 17, RELICS[id].icon, 2, 0xffcd75)); }
    // wheel strip
    const w = h.wheel; if (w.n !== run.size) { w.c.destroy(true); h.wheel = this.wheelRow(this.root, m.cx, h.wheelY, 32, null); return; }
    if (force || this._wv !== this.wheelSig()) { this._wv = this.wheelSig(); w.refresh(); }
    w.hl.clear();
    const sp = w.size + 4, wx = -(w.n - 1) / 2 * sp;
    box(w.hl, wx - sp / 2 - 3, -w.size / 2 - 5, w.n * sp + 6, w.size + 10, C.ink, undefined, 0.6);
    for (let i = 0; i < w.n; i++) { const f = Math.max(0, run.fire[i]), sl = w.slots[i]; sl.setScale(1 + f * 0.28); sl.y = -f * 7; if (f > 0) { const q = run.wheel[i], col = q ? ELEM[RUNES[q.id].elem].c : 0xcfc4ff; w.hl.fillStyle(col, f * 0.9); w.hl.fillRect(wx + i * sp - sp / 2, w.size / 2 + 2, sp, 3); } }
    if (run.pend.any) { w.hl.fillStyle(0xffffff, 0.9); w.hl.fillRect(wx + run.step * sp - 4, -w.size / 2 - 5, 8, 3); }
    // buttons
    const circ = (c, q, col, ready, label) => { const G2 = c.g; G2.clear(); G2.fillStyle(C.ink, 0.55); G2.fillCircle(0, 0, 34); G2.lineStyle(4, 0x4a4266, 1); G2.strokeCircle(0, 0, 32); if (q > 0) { G2.lineStyle(4, col, 1); G2.beginPath(); G2.arc(0, 0, 32, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, q)); G2.strokePath(); } if (ready) { G2.fillStyle(col, 0.25 + 0.2 * run.beat); G2.fillCircle(0, 0, 30); } c.t.setText(label); c.t.setColor(ready ? C.text : C.dim); };
    circ(h.dash, p.dashN >= s.dashes ? 1 : 1 - p.dashCd / 2.4, 0x73eff6, p.dashN > 0, s.dashes > 1 ? `DASH ${p.dashN}` : 'DASH');
    const dr = run.dropT > 0; circ(h.drop, dr ? run.dropT / s.dropDur : run.drop / 100, 0xff5ccd, run.drop >= 100 || dr, dr ? 'x2!' : 'DROP');
    h.drop.setScale(run.drop >= 100 ? 1.05 + 0.08 * run.beat : 1);
    // toasts
    while (run.toasts.length) this.toastQ.push(run.toasts.shift());
    this.toastT -= this.game.loop.delta / 1000;
    if (this.toastT <= 0 && this.toastQ.length) { const t = this.toastQ.shift(); h.toast.setText(t.text).setColor(hexs(t.color)).setAlpha(1).setScale(1.5); this.tweens.add({ targets: h.toast, scale: 1, duration: 180, ease: 'Back.easeOut' }); this.tweens.add({ targets: h.toast, alpha: 0, delay: 900, duration: 300 }); this.toastT = 0.8; }
  }
  wheelSig() { const r = this.run; let s = ''; for (let i = 0; i < r.size; i++) { const q = r.wheel[i]; s += q ? q.id + q.lvl + r.res[i] : '-'; } return s; }

  // ---------------- frame ----------------
  update(t, dms) {
    if (G.hidden) return;
    const dt = Math.min(0.05, dms / 1000), run = this.run, K = this.keys, m = this.hm;
    let ix = 0, iz = 0;
    if (K) {
      if (K.A.isDown || K.LEFT.isDown) ix -= 1; if (K.D.isDown || K.RIGHT.isDown) ix += 1; if (K.W.isDown || K.UP.isDown) iz -= 1; if (K.S.isDown || K.DOWN.isDown) iz += 1;
      if (Phaser.Input.Keyboard.JustDown(K.SPACE) || Phaser.Input.Keyboard.JustDown(K.SHIFT)) run.input.dash = true;
      if (Phaser.Input.Keyboard.JustDown(K.E)) run.input.drop = true;
      if (Phaser.Input.Keyboard.JustDown(K.ESC) || Phaser.Input.Keyboard.JustDown(K.P)) { if (!this.ov) this.openOverlay('pause'); else if (this.ovKind === 'pause') this.closeOverlay(); }
    }
    this.jg.clear();
    if (this.joy && !this.ov) {
      const j = this.joy, R = 52 * m.S; let dx = j.x - j.ox, dy = j.y - j.oy; const d = Math.hypot(dx, dy);
      if (d > R) { j.ox += dx * (1 - R / d); j.oy += dy * (1 - R / d); dx = j.x - j.ox; dy = j.y - j.oy; }
      if (d > R * 0.12) { ix = dx / R; iz = dy / R; }
      this.jg.lineStyle(3 * m.S, 0xffffff, 0.25); this.jg.strokeCircle(j.ox, j.oy, R); this.jg.fillStyle(0xffffff, 0.35); this.jg.fillCircle(j.x, j.y, 20 * m.S);
    }
    run.input.x = ix; run.input.z = iz;
    const W = G.world;
    if (!this.ov) {
      if (W.hitstopT > 0) W.hitstopT -= dt; else run.update(dt);
      if (run.pending.length && (run.state === 'play' || run.state === 'clear')) this.openOverlay(run.pending.shift());
      else if (run.state === 'shop') this.openOverlay('shop');
      else if (run.state === 'dead') { this.deadT += dt; if (this.deadT > 1.3) this.openOverlay('over'); }
    }
    W.render(run, this.ov ? dt * 0.15 : dt);
    this.hudTick(false);
    if (this.ov && this.ov.tick) this.ov.tick();
  }

  // ---------------- overlays ----------------
  openOverlay(kind, data) {
    if (this.ovRoot) this.ovRoot.destroy(true);
    this.joy = null; this.run.input.x = this.run.input.z = 0;
    const m = this.m, o = this.ovRoot = this.add.container(0, 0).setScale(m.S).setDepth(10);
    const dim = this.add.graphics(); dim.fillStyle(0x0b0714, kind === 'over' || kind === 'pause' ? 0.88 : 0.78); dim.fillRect(0, 0, m.UW, m.UH); o.add(dim);
    const z = this.add.zone(m.UW / 2, m.UH / 2, m.UW, m.UH).setInteractive(); o.add(z);
    this.ov = {}; this.ovKind = kind; this.ovData = data; this.swapSel = -1;
    this.root.setAlpha(kind === 'over' ? 0 : 0.35);
    ({ level: this.ovChoice, relic: this.ovChoice, shop: this.ovShop, pause: this.ovPause, over: this.ovOver, tut: this.ovTut })[kind].call(this, o, kind, data);
    if (kind !== 'pause' && kind !== 'tut') { o.setAlpha(0); this.tweens.add({ targets: o, alpha: 1, duration: 140 }); }
  }
  closeOverlay() { if (this.ovRoot) this.ovRoot.destroy(true); this.ovRoot = null; this.ov = null; this.ovKind = null; this.ovData = null; this.root.setAlpha(1); this.hudTick(true); }

  // editable wheel used on choice / shop / pause screens
  editWheel(o, y, replaceCb) {
    const m = this.m, run = this.run, size = Math.min(38, (330 - run.size * 4) / run.size);
    const sel = this.add.graphics();
    const w = this.wheelRow(o, m.cx, y, size, i => {
      if (this.ov.replace) { replaceCb(i); return; }
      if (this.swapSel < 0) { this.swapSel = i; G.audio.sfx('ui'); }
      else { if (this.swapSel !== i) { run.swap(this.swapSel, i); G.audio.sfx('pick'); } this.swapSel = -1; w.refresh(); }
      draw();
    });
    w.c.add(sel);
    const draw = () => { sel.clear(); if (this.swapSel >= 0) { const x = (this.swapSel - (run.size - 1) / 2) * (size + 4); sel.lineStyle(2, 0xffffff, 1); sel.strokeRect(x - size / 2 - 2, -size / 2 - 2, size + 4, size + 4); } };
    this.ov.hint = txt(this, o, m.cx, y + size / 2 + 12, 'YOUR WHEEL: tap two slots to swap them', 9, C.dim);
    return w;
  }
  card(o, x, y, w, h, opt, cb, price) {
    const run = this.run, c = this.add.container(x, y); o.add(c);
    let icon, name, tag, desc, col = 0x8a7fd0, tint;
    if (opt.kind === 'rune' || opt.kind === 'up') {
      const R = RUNES[opt.id]; icon = 'rune_' + opt.id; name = R.name; col = ELEM[R.elem].c;
      if (opt.kind === 'rune') { tag = `NEW  ${ELEM[R.elem].name.toUpperCase()}${R.type === 'mod' ? '' : ' SPELL'}`; desc = R.desc; }
      else { tag = `UPGRADE  LV ${opt.lvl} > ${opt.lvl + 1}`; desc = R.up[opt.lvl - 1]; }
    } else if (opt.kind === 'passive') { const P = PASSIVES[opt.id]; icon = P.icon; name = P.name; tag = `TOME  ${opt.lvl + 1}/${P.max}`; desc = P.desc; tint = 0xa7f070; col = 0xa7f070; }
    else if (opt.kind === 'relic') { const R = RELICS[opt.id]; icon = R.icon; name = R.name; tag = 'RELIC'; desc = R.desc; tint = 0xffcd75; col = 0xffcd75; }
    else if (opt.kind === 'gold') { icon = 'i_coin'; name = `${opt.v} Gold`; tag = 'TREASURE'; desc = 'A little pocket money.'; tint = 0xffcd75; col = 0xffcd75; }
    else { icon = 'i_heart'; name = 'Encore Snack'; tag = 'HEAL'; desc = `Restore ${opt.v}% of your HP.`; tint = 0xff5c7a; col = 0xff5c7a; }
    const g = this.add.graphics(); c.add(g);
    g.fillStyle(C.ink, 0.9); g.fillRect(-w / 2 + 3, -h / 2 + 4, w - 2, h);
    box(g, -w / 2, -h / 2, w, h, C.panel, col);
    g.fillStyle(col, 0.12); g.fillRect(-w / 2 + 2, -h / 2 + 2, 56, h - 4);
    const ic = img(this, c, -w / 2 + 30, 0, icon, icon.startsWith('rune_') ? 3 : 4, tint);
    const sm = h < 70;
    txt(this, c, -w / 2 + 66, -h / 2 + (sm ? 2 : 8), tag, 9, hexs(col), 0, 0);
    txt(this, c, -w / 2 + 66, -h / 2 + (sm ? 12 : 20), name, sm ? 14 : 16, C.text, 0, 0);
    txt(this, c, -w / 2 + 66, -h / 2 + (sm ? 30 : 41), desc, sm ? 9 : 10, C.dim, 0, 0, { wrap: w - 76 - (price ? 50 : 0), ls: 1 });
    if (price) c.price = txt(this, c, w / 2 - 10, 0, String(price), 16, C.gold, 1, 0.5, { bold: true });
    c.ic = ic; c.gfx = g;
    tap(this, c, w, h, () => cb(opt, c));
    return c;
  }

  ovChoice(o, kind) {
    const m = this.m, run = this.run, x = m.cx, isLvl = kind === 'level';
    const opts = this.ovData || (isLvl ? run.levelChoices() : run.relicChoices()); this.ovData = opts;
    if (!this._sfxed) G.audio.sfx(isLvl ? 'levelup' : 'chest'); this._sfxed = true;
    const n = opts.length, ch = Math.min(84, (m.UH - 300) / n), top = Math.max(96, (m.UH - (n * (ch + 8) + 190)) / 2 + 40);
    const title = txt(this, o, x, top - 44, isLvl ? 'LEVEL UP!' : 'RELIC FOUND', 30, isLvl ? C.cyan : C.gold, 0.5, 0.5, { bold: true, stroke: 6 });
    this.tweens.add({ targets: title, scale: 1.08, duration: 300, yoyo: true, repeat: -1 });
    txt(this, o, x, top - 20, isLvl ? `LEVEL ${run.level}  -  CHOOSE ONE` : 'CHOOSE ONE', 10, C.dim);
    let picked = null;
    const done = (opt, slot) => { run.applyChoice(opt, slot); G.audio.sfx('pick'); this._sfxed = false; this.closeOverlay(); };
    const cards = opts.map((opt, i) => this.card(o, x, top + i * (ch + 8) + ch / 2, 336, ch, opt, (op, c) => {
      if (run.needsSlot(op)) { picked = op; this.ov.replace = true; cards.forEach(q => q.setAlpha(q === c ? 1 : 0.4)); this.ov.hint.setText('WHEEL FULL: tap the slot to REPLACE').setColor(C.gold); G.audio.sfx('ui'); }
      else done(op);
    }));
    cards.forEach((c, i) => { c.setScale(0.8); c.setAlpha(0); this.tweens.add({ targets: c, scale: 1, alpha: 1, delay: 60 * i, duration: 160, ease: 'Back.easeOut' }); });
    const wy = top + n * (ch + 8) + 34;
    this.editWheel(o, wy, i => done(picked, i));
    if (isLvl) {
      btn(this, o, x - 86, wy + 76, 150, 34, `REROLL (${run.rerolls})`, () => { run.rerolls--; this._sfxed = true; this.openOverlay(kind); }, { size: 12 }).setDisabled(run.rerolls <= 0);
      btn(this, o, x + 86, wy + 76, 150, 34, `SKIP  +${run.s.skipGold}g`, () => { run.gold += run.s.skipGold; this._sfxed = false; this.closeOverlay(); }, { size: 12 });
    }
  }

  ovShop(o) {
    const m = this.m, run = this.run, x = m.cx;
    const d = this.ovData || (this.ovData = { offers: run.shopOffers(), next: run.nextStageOptions() });
    const top = Math.max(50, (m.UH - 600) / 2 + 50) + m.top;
    txt(this, o, x, top, 'BACKSTAGE', 28, C.pink, 0.5, 0.5, { bold: true, stroke: 6 });
    const gold = txt(this, o, x, top + 24, '', 14, C.gold, 0.5, 0.5, { bold: true });
    const refresh = () => gold.setText(`GOLD ${run.gold}`); refresh();
    const ch = Math.min(60, (m.UH - top - 330) / d.offers.length - 6);
    d.offers.forEach((of, i) => {
      const c = this.card(o, x, top + 50 + i * (ch + 6) + ch / 2, 336, ch, of, (op, cc) => {
        if (op.sold) return;
        if (run.gold < op.price || (op.kind === 'heal' && run.p.hp >= run.s.maxHp)) { G.audio.sfx('deny'); return; }
        run.gold -= op.price; run.applyChoice(op); op.sold = true; G.audio.sfx('buy'); this.openOverlay('shop', d);
      }, of.sold ? 'SOLD' : of.price);
      if (of.sold) c.setAlpha(0.3); else if (run.gold < of.price) c.price.setColor(C.red);
    });
    const wy = top + 50 + d.offers.length * (ch + 6) + 30;
    this.editWheel(o, wy, () => {});
    const ny = wy + 62, nb = BIOMES[(run.stage.n + 1) % BIOMES.length];
    txt(this, o, x, ny, `NEXT: STAGE ${run.stage.n + 2}  ${nb.name}`, 12, hexs(nb.acc), 0.5, 0.5, { bold: true });
    d.next.forEach((mu, i) => {
      const b = btn(this, o, x + (i ? 86 : -86), ny + 44, 164, 62, mu.name, () => { this.closeOverlay(); run.startStage(run.stage.n + 1, mu.id); }, { size: 13, fill: 0x2a1640, border: nb.acc, sfx: 'pick' });
      b.label.y = -18; txt(this, b, 0, 0, mu.desc, 9, C.red); txt(this, b, 0, 14, mu.bonus || 'no bonus', 9, C.green);
    });
    if (run.c.cleared >= 5) btn(this, o, x, ny + 100, 220, 30, 'TAKE A BOW  (end run, bank echoes)', () => { run.state = 'won'; this.openOverlay('over'); }, { size: 10, color: C.gold });
  }

  ovPause(o) {
    const m = this.m, run = this.run, x = m.cx, s = run.s; let y = Math.max(70, m.UH / 2 - 230) + m.top;
    txt(this, o, x, y, 'PAUSED', 30, C.text, 0.5, 0.5, { bold: true, stroke: 6 }); y += 50;
    this.editWheel(o, y, () => {}); y += 60;
    const pas = Object.keys(run.passives).map(id => `${PASSIVES[id].name} ${run.passives[id]}`).join('   ') || 'No tomes yet';
    txt(this, o, x, y, pas, 9, C.green, 0.5, 0, { wrap: 330 }); y += 30;
    txt(this, o, x, y, `DMG x${s.dmg.toFixed(2)}   TEMPO x${s.tempo.toFixed(2)}   CRIT ${Math.round(s.crit * 100)}%   AREA x${s.area.toFixed(2)}\nARMOR ${s.armor}   SPEED ${s.speed.toFixed(1)}   KILLS ${run.kills}   TIME ${fmtTime(run.time)}`, 9, C.dim, 0.5, 0, { ls: 4 }); y += 40;
    run.relics.slice(0, 8).forEach((id, i) => { const R = RELICS[id]; img(this, o, x - 160, y + i * 17 + 5, R.icon, 2, 0xffcd75); txt(this, o, x - 146, y + i * 17 + 5, `${R.name}: ${R.desc}`, 8, C.dim, 0, 0.5); });
    const by = Math.max(y + 8 * 17 + 30, m.UH - m.bot - 110);
    btn(this, o, x, by, 220, 44, 'RESUME', () => this.closeOverlay(), { size: 20, fill: 0x7a1f6a, border: 0xff5ccd });
    btn(this, o, x, by + 50, 220, 30, this._quit ? 'TAP AGAIN TO END RUN' : 'END RUN', () => { if (this._quit) { run.state = 'dead'; this.openOverlay('over'); } else { this._quit = true; this.openOverlay('pause'); } }, { size: 11, color: C.red });
  }

  ovTut(o) {
    const m = this.m, x = m.cx, y = m.UH / 2;
    panel(this, o, x, y, 330, 330, C.panel, 0xff5ccd);
    txt(this, o, x, y - 135, 'HOW TO PLAY', 24, C.pink, 0.5, 0.5, { bold: true });
    const lines = [[m.touch ? 'DRAG anywhere to move.' : 'WASD / arrows to move.', C.text], ['Your WHEEL casts by itself, one slot per beat.', C.cyan], ['Level up to add RUNES. Their ORDER matters:\nmodifiers boost the next spell.', C.text], ['DASH through danger. Fill the DROP meter\nwith kills for double tempo.', C.gold], ['Survive the timer, beat the boss, go deeper.\nEchoes you earn unlock permanent power.', C.text]];
    lines.forEach(([s, c], i) => txt(this, o, x, y - 92 + i * 42, s, 11, c, 0.5, 0.5, { ls: 2 }));
    btn(this, o, x, y + 128, 180, 40, "LET'S GO", () => { save.seenTutorial = true; persist(); this.closeOverlay(); }, { size: 18, fill: 0x7a1f6a, border: 0xff5ccd, sfx: 'pick' });
  }
  openTutorial() { this.openOverlay('tut'); }

  ovOver(o) {
    const m = this.m, run = this.run, x = m.cx;
    if (!this.banked) {
      const sm = run.summary(), st = save.stats;
      save.echoes += sm.echoes; st.echoesTotal += sm.echoes; st.kills += sm.kills; st.runs++; st.time += sm.time; if (sm.won) st.wins++;
      st.bestStage = Math.max(st.bestStage, sm.cleared); st.bestLevel = Math.max(st.bestLevel, sm.level); st.bestCombo = Math.max(st.bestCombo, sm.maxCombo);
      let volUp = false; if (sm.won && run.volume >= save.maxVolume && save.maxVolume < 12) { save.maxVolume++; volUp = true; }
      const feats = checkFeats(sm); persist();
      this.banked = { sm, feats, volUp };
    }
    const { sm, feats, volUp } = this.banked, won = sm.won;
    let y = Math.max(60, m.UH / 2 - 250) + m.top;
    txt(this, o, x, y, won ? 'STANDING OVATION' : 'SILENCED', won ? 28 : 36, won ? C.gold : C.red, 0.5, 0.5, { bold: true, stroke: 6 }); y += 30;
    txt(this, o, x, y, `${run.char.name}  -  STAGE ${sm.stage}  ${run.stage.biome.name}`, 10, C.dim); y += 26;
    panel(this, o, x, y + 62, 300, 124);
    const rows = [['TIME', fmtTime(sm.time)], ['LEVEL', sm.level], ['KILLS', sm.kills], ['BEST COMBO', 'x' + sm.maxCombo], ['STAGES CLEARED', sm.cleared], ['REACTIONS', sm.reactions]];
    rows.forEach(([k, v], i) => { txt(this, o, x - 132, y + 14 + i * 19, k, 11, C.dim, 0, 0.5); txt(this, o, x + 132, y + 14 + i * 19, String(v), 12, C.text, 1, 0.5, { bold: true }); });
    y += 146;
    const et = txt(this, o, x, y, '+0 ECHOES', 26, C.pink, 0.5, 0.5, { bold: true, stroke: 5 });
    this.tweens.addCounter({ from: 0, to: sm.echoes, duration: 900, ease: 'Cubic.easeOut', onUpdate: tw => et.setText(`+${Math.round(tw.getValue())} ECHOES`) });
    y += 22; txt(this, o, x, y, `TOTAL ${save.echoes}`, 10, C.dim); y += 20;
    const notes = feats.map(f => `FEAT: ${f.name}  +${f.echo}${f.unlock ? '  (new rune: ' + RUNES[f.unlock].name + ')' : ''}`); if (volUp) notes.unshift(`VOLUME ${save.maxVolume} UNLOCKED`);
    notes.slice(0, 5).forEach((s, i) => { const t = txt(this, o, x, y + i * 15, s, 10, C.gold, 0.5, 0.5, { bold: true }); t.setAlpha(0); this.tweens.add({ targets: t, alpha: 1, delay: 600 + i * 200, duration: 200 }); });
    const by = Math.max(y + 90, m.UH - m.bot - 120);
    btn(this, o, x, by, 220, 48, 'PLAY AGAIN', () => this.scene.restart(), { size: 22, fill: 0x7a1f6a, border: 0xff5ccd, sfx: 'pick' });
    btn(this, o, x, by + 54, 220, 36, 'SPEND ECHOES', () => this.scene.start('menu'), { size: 14, color: C.gold });
  }
}

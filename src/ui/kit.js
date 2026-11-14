// Tiny Phaser UI toolkit. All layout is in "design units": the root container is scaled so a 360x600 column always fits.
export const G = { world: null, audio: null, atlas: null, game: null, hidden: false };
export const FONT = '"Pixelify Sans", ui-monospace, monospace';
export const hexs = n => '#' + n.toString(16).padStart(6, '0');
export const C = { ink: 0x0d0b1a, panel: 0x1a1530, panel2: 0x251e42, line: 0x4a4266, text: '#f4f4f4', dim: '#9a94b8', gold: '#ffcd75', pink: '#ff5ccd', red: '#ff5c7a', green: '#a7f070', cyan: '#73eff6' };

let probe;
function insets() {
  if (!probe) { probe = document.createElement('div'); probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)'; document.body.appendChild(probe); }
  const cs = getComputedStyle(probe); return { t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0, r: parseFloat(cs.paddingRight) || 0 };
}
export function metrics(scene, hud) {
  const W = scene.scale.width, H = scene.scale.height, S = hud ? Math.max(Math.min(W / 360, H / 600), Math.min(W / 640, H / 350)) : Math.min(W / 360, H / 600), k = W / window.innerWidth / S, i = insets();
  return { W, H, S, UW: W / S, UH: H / S, cx: W / S / 2, top: i.t * k, bot: i.b * k, left: i.l * k, right: i.r * k, touch: window.matchMedia && window.matchMedia('(pointer: coarse)').matches };
}
export function makeRoot(scene, hud) { const m = metrics(scene, hud); scene.m = m; const r = scene.add.container(0, 0).setScale(m.S); scene.root = r; return r; }

export function txt(scene, parent, x, y, str, size = 14, color = C.text, ox = 0.5, oy = 0.5, o = {}) {
  const S = scene.m.S;
  const big = (o.stroke || 0) > 3 || size >= 24;
  const t = scene.add.text(x, y, str, { fontFamily: FONT, fontSize: size + 'px', color, fontStyle: o.bold && size >= 40 ? 'bold' : '', align: o.align || (ox === 0 ? 'left' : ox === 1 ? 'right' : 'center'), wordWrap: o.wrap ? { width: o.wrap } : undefined, resolution: Math.min(4, Math.max(1, S)), lineSpacing: o.ls || 0, padding: { x: 2, y: 3 },
    shadow: o.stroke === 0 ? undefined : { offsetX: big ? 2 : 1, offsetY: big ? 3 : 1.5, color: '#0d0b1a', blur: 0, fill: true } }).setOrigin(ox, oy);
  if (parent) parent.add(t); return t;
}
export function img(scene, parent, x, y, frame, scale = 2, tint) { const i = scene.add.image(x, y, 'atlas', frame).setScale(scale); if (tint !== undefined) i.setTint(tint); if (parent) parent.add(i); return i; }
export function box(g, x, y, w, h, fill, border, a = 1) {
  if (border !== undefined) { g.fillStyle(border, a); g.fillRect(x + 2, y, w - 4, h); g.fillRect(x, y + 2, w, h - 4); g.fillStyle(fill, a); g.fillRect(x + 2, y + 2, w - 4, h - 4); }
  else { g.fillStyle(fill, a); g.fillRect(x + 2, y, w - 4, h); g.fillRect(x, y + 2, w, h - 4); }
}
export function panel(scene, parent, x, y, w, h, fill = C.panel, border = C.line, a = 1) { const g = scene.add.graphics(); box(g, x - w / 2, y - h / 2, w, h, fill, border, a); if (parent) parent.add(g); return g; }

// Generic tappable. cb fires on release inside (or on press when o.instant).
export function tap(scene, obj, w, h, cb, o = {}) {
  obj.setSize(w, h); obj.setInteractive({ useHandCursor: true });
  let down = false;
  obj.on('pointerdown', () => { down = true; if (!o.noScale) obj.setScale((o.base || 1) * 0.94); if (o.instant) cb(); });
  obj.on('pointerout', () => { down = false; if (!o.noScale) obj.setScale(o.base || 1); });
  obj.on('pointerup', () => { if (!o.noScale) obj.setScale(o.base || 1); if (down && !o.instant) { down = false; cb(); } });
  return obj;
}
export function btn(scene, parent, x, y, w, h, label, cb, o = {}) {
  const c = scene.add.container(x, y), g = scene.add.graphics();
  const fill = o.fill === undefined ? C.panel2 : o.fill, border = o.border === undefined ? 0x8a7fd0 : o.border;
  g.fillStyle(C.ink, 0.9); g.fillRect(-w / 2 + 2, -h / 2 + 3, w - 2, h);
  box(g, -w / 2, -h / 2, w, h, fill, border);
  g.fillStyle(0xffffff, 0.08); g.fillRect(-w / 2 + 3, -h / 2 + 3, w - 6, Math.max(2, h * 0.3));
  c.add(g);
  c.label = txt(scene, c, 0, -1, label, o.size || 14, o.color || C.text, 0.5, 0.5, { bold: o.bold !== false });
  if (parent) parent.add(c);
  tap(scene, c, w, h, () => { if (c.disabled) { G.audio.sfx('deny'); return; } G.audio.sfx(o.sfx || 'ui'); cb(); }, o);
  c.setDisabled = d => { c.disabled = d; c.setAlpha(d ? 0.45 : 1); return c; };
  return c;
}
export function clear(scene) { scene.tweens.killAll(); if (scene.root) scene.root.destroy(true); }

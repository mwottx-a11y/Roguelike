import Phaser from 'phaser';
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/700.css';
import { buildAtlas } from './sprites.js';
import { World } from './world.js';
import { Audio } from './audio.js';
import { Song } from './music.js';
import { loadSave, save } from './save.js';
import { G } from './ui/kit.js';
import { MenuScene } from './ui/menu.js';
import { RunScene } from './ui/run.js';

async function boot() {
  loadSave();
  const atlas = buildAtlas();
  G.atlas = atlas;
  G.world = new World(document.getElementById('three'), atlas, save.opts);
  G.audio = new Audio(save.opts);
  try { await Promise.all([document.fonts.load('16px "Pixelify Sans"'), document.fonts.load('bold 16px "Pixelify Sans"')]); } catch (e) { /* fall back to monospace */ }

  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
  class Boot extends Phaser.Scene {
    constructor() { super('boot'); }
    create() {
      const tex = this.textures.addCanvas('atlas', atlas.canvas);
      for (const k in atlas.frames) { const f = atlas.frames[k]; tex.add(k, 0, f.x, f.y, f.w, f.h); }
      this.scene.start('menu');
    }
  }
  const game = new Phaser.Game({
    type: Phaser.WEBGL, parent: 'ui', transparent: true, banner: false,
    scale: { mode: Phaser.Scale.NONE, width: Math.round(window.innerWidth * dpr()), height: Math.round(window.innerHeight * dpr()), zoom: 1 / dpr() },
    render: { pixelArt: true, antialias: false, powerPreference: 'high-performance' },
    input: { activePointers: 4 }, audio: { noAudio: true }, scene: [Boot, MenuScene, RunScene],
  });
  G.game = game; G.AudioClass = Audio; G.Song = Song; window.HEX = G; // debug/test handle
  let rt = 0;
  const onResize = () => { clearTimeout(rt); rt = setTimeout(() => { G.world.resize(); game.scale.setZoom(1 / dpr()); game.scale.resize(Math.round(window.innerWidth * dpr()), Math.round(window.innerHeight * dpr())); const st = game.canvas.style; st.width = window.innerWidth + 'px'; st.height = window.innerHeight + 'px'; }, 60); };   // at dpr 1 Phaser leaves the old CSS size
  window.addEventListener('resize', onResize); window.addEventListener('orientationchange', onResize);
  const unlock = () => G.audio.unlock();
  window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock); window.addEventListener('touchend', unlock);
  document.addEventListener('visibilitychange', () => { G.hidden = document.hidden; if (G.audio.ctx) { document.hidden ? G.audio.ctx.suspend() : G.audio.ctx.resume(); } });
  document.addEventListener('contextmenu', e => e.preventDefault());
}
boot();

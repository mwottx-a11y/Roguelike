// Procedural pixel art. Everything is drawn into one atlas canvas shared by three.js and Phaser.
import { CHARS, RUNES, ELEM, SKINS } from './data.js';

const PAL = {
  k: '#1a1c2c', p: '#5d275d', r: '#b13e53', o: '#ef7d57', y: '#ffcd75', l: '#a7f070', g: '#38b764', t: '#257179',
  n: '#29366f', b: '#3b5dc9', s: '#41a6f6', c: '#73eff6', w: '#f4f4f4', a: '#94b0c2', d: '#566c86', e: '#333c57',
  m: '#ff5ccd', v: '#9b5de5', u: '#f2c9a0', h: '#3b5dc9', H: '#ffcd75', R: '#29366f',
};
const OUTLINE = '#0d0b1a';

// Half sprites (mirrored left->right)
// Hero looks. h = hat/hair colour, H = trim, R = robe: recoloured per character.
const HERO = {
  knight: ['....rr', '...aaa', '..aaaa', '..aaaa', '..akkk', '..aaaa', '...aaa', '.aRRRR', 'aaRRRy', 'a.RRRR', '..RRRR', '..aaaa', '...aa.', '...dd.'],
  ninja: ['......', '...eee', '..eeee', 'H.HHHH', '.Heeee', '..ukuu', '..eeee', '.eeeee', 'ueeeeR', '.eeeeR', '.eeeee', '..eeee', '...ee.', '...dd.'],
  witch: ['.....h', '....hh', '...hhh', '..hhHH', 'hhhhhh', '.ouuuu', '.oukuu', '.ouuuu', '.oRRRR', 'uRRRRy', '.RRRRR', 'RRRRRR', 'RRRRRR', '...kk.'],
  cat: ['.h....', '.hh...', '.hhhhh', '.hhhhh', '.hkhhh', '.hhhhw', '..hhhh', '..RRRR', '.hRRRy', '.hRRRR', '..RRRR', '..RRRR', '...hh.', '...hh.'],
  robot: ['.....y', '.....a', '..aaaa', '..aaaa', '..acaa', '..aaaa', '..akkk', '....dd', '.aRRRR', 'aaRRRy', 'a.RRRR', '..aaaa', '...aa.', '..ddd.'],
  dj: ['..hhhh', '.hhhhh', 'Hhhhhh', '..uuuu', 'kkukuu', 'kkuuuu', '..uuuu', '.RRRRR', 'uRRRRw', '.RRRRR', '.RRRRR', '..RRRR', '...dd.', '...ww.'],
  ghost: ['......', '..wwww', '.wwwww', '.wwwww', '.wkkww', '.wkkww', '.wwwww', 'RRRRRR', 'wwwwww', 'wwwwww', 'wwwwww', 'wwwwww', 'ww.www', 'w...w.'],
};
const HALF = {
  hero: ['....hh', '...hhh', '..hhhh', '..hhhh', '.HHHHH', '..uuuu', '..ukuu', '..uuuu', '.RRRRR', 'uRRRRy', '.RRRRR', '.RRRRR', '..RRRR', '...dd.'],
  slime: ['...ggg', '..gggg', '.glggg', '.ggggg', 'ggwkgg', 'ggwkgg', 'gggggg', 'gggggg', '.ttttt'],
  bat: ['p.....p', 'pp...pp', 'ppp.ppp', 'pppppvv', '.pppvrv', '..ppvvv', '...p.vw'],
  skel: ['..wwww', '.wwwww', '.wkkww', '.wkkww', '.wwwww', '..wkwk', '....aa', '.waaaa', 'w.awaw', 'w.aaaa', '...awa', '...aa.', '..aa..'],
  ghost: ['..cccc', '.ccccc', 'cccccc', 'cckkcc', 'cckkcc', 'cccccc', 'ccccck', 'cccccc', 'cccccc', 'cc.ccc', 'c...c.'],
  shroom: ['...rrrr', '.rrwrrr', 'rrrrrrw', 'rwrrrrr', 'rrrrrrr', '..yyyyy', '..ykyyy', '..yyyyy', '..yyyyy', '...yyyy', '...dd..'],
  boar: ['.ee....', 'eeeeeee', 'eoooooo', 'ookwooo', 'ooooooo', 'woooopp', 'wooooop', '.oooooo', '.dd.dd.'],
  bomb: ['.....y', '....aa', '..eeee', '.eeeee', 'eewkee', 'eewkee', 'eeeeee', 'eerrre', '.eeeee', '..d.d.'],
  golem: ['..ddddd', '.dddddd', '.dcdddd', '.dddddd', 'ddddaaa', 'dddaaaa', 'dd.aaca', 'dd.aaaa', 'dd.dddd', '...dddd', '...dd..', '..ddd..'],
  eye: ['..rrrr', '.rwwww', 'rwwwcc', 'rwwcck', 'rwwcck', 'rwwwcc', '.rwwww', '..rrrr', '...r.r'],
  b_slime: ['..y...y..y', '..yy.yy.yy', '..yyyyyyyy', '..yryyyryy', '...ggggggg', '..gggggggg', '.gglgggggg', '.glggggggg', 'gggggggggg', 'gggwwkgggg', 'gggwwkgggg', 'gggggggggg', 'ggggggkkkk', 'gggggggwkw', 'gggggggggg', '.ttttttttt'],
  b_lich: ['......pppp', '....pppppp', '...ppppppp', '..pppwwwww', '..ppwwwwww', '..ppwkkwww', '..ppwklwww', '..ppwwwwwk', '..pppwkwkw', '..ppppwwww', '.ppppppppp', '.ppppppppy', 'pppppppppp', 'pwpppppppp', 'pwpppppppp', '.ppppppppp', '.pppp.pppp', '..pp...ppp'],
  b_golem: ['w.........', 'ww....dddd', '.ww..ddddd', '..wwdddddd', '...ddddddd', '...ddrrddd', '...ddrrddd', '...ddddddd', '.ddddddwkw', 'dddddddddd', 'dddd.ddddd', 'ddd..ddcdd', 'ddd..ddccc', 'ddd..ddddd', 'dd...ddddd', '.....ddd..', '....dddd..', '....dddd..'],
  b_conductor: ['.....kkkkk', '.....kkkkk', '.....kkkkk', '.....kmmmm', '...kkkkkkk', '.....wwwww', '.....wkwww', '.....wwwww', '......wwkk', '...kkkkmmm', '..kkkkkkmw', '.kkmkkkkkw', 'wkkmkkkkkk', 'w.kmkkkkkk', 'y.kmmkkkkk', 'y.kkmkkkkk', '..kkkmkkkk', '..kkkkk.kk', '...kkk..kk', '...ee...ee'],
  tomb: ['..aaa', '.aaaa', 'aaaaa', 'aaaad', 'aaddd', 'aaaad', 'aaaad', 'aaaaa', 'ddddd'],
  candle: ['.y', 'yo', '.y', 'ww', 'ww', 'ww', 'ww', 'aa'],
  bigshroom: ['....mmmm', '..mmmmmm', '.mmwmmmm', 'mmmmmmwm', 'mmmmmmmm', 'mwmmmmmm', '..vvvvvv', '.....yyy', '.....yyy', '.....yyy', '.....yyy', '....yyyy', '....yyyy', '...ddddd'],
  fern: ['g...g', '.g.gg', 'g.ggl', '.gggl', '..ggg'],
  crystal: ['....c', '...cc', '...cw', '..ccw', '..csw', 'c.csw', 'ccssw', 'cscsw', 'cssss', 'cssss', '.bsss', '.bbbb'],
  brazier: ['...y.', '..yoy', '.yooy', '.ooro', 'ddddd', '.dddd', '..ddd', '...dd', '...dd', '..ddd'],
  speaker: ['eeeee', 'ekkkk', 'ekkdd', 'ekdda', 'ekkdd', 'ekkkk', 'ekkkk', 'ekkdd', 'ekdaa', 'ekdaa', 'ekkdd', 'eeeee'],
  skitter: ['p..p..', '.p.prr', '..prrr', 'pprryr', '..prrr', '.p.prr', 'p..p..'],
  blinker: ['...vvv', '..vvvv', '.vvvvv', '.vvcvv', '.vvvvv', 'vvvvvv', 'vvmvvv', 'vv.vvv', 'v..vv.', '...v..'],
  warden: ['...aaaa', '..aaaaa', '..akkka', '..aaaaa', 'sss.aaa', 'sbsaddd', 'sbsaddy', 'sbsaddd', 'sss.ddd', '.s..ddd', '....dd.', '...ddd.'],
  shaman: ['y...rr.', 'y..rrrr', 'y.llllr', 'y.lkwll', 'y.lllll', 'y..llkk', 'yggggg.', 'ygggggy', 'y.ggggg', 'y.ggggg', 'y..gggg', '....dd.'],
  lobber: ['.lll...', 'lwkl...', 'lllllll', 'glggggg', 'ggggyyy', 'gggyyyy', '.gggggg', 'gg..gg.'],
  lancer: ['..rrrr', '.rrrrr', '.rwkrr', '.rrrrr', '..rrrr', '...oo.', '..oooo', 'o.oooo', 'oo.ooo', '...oo.', '..oo..', '..dd..'],
  necro: ['..pppp', '.ppppp', '.pwwww', '.pwkkw', '.pwwww', '..pwkw', '.ppppp', 'pppppm', 'pppppp', 'wppppp', '.ppppp', '..pppp'],
  bloom: ['..m.mmm', '.mmmmmm', 'mmmyyyy', '.mmyyky', 'mmmyyyy', '.mmmmmm', '..m.mmm', '.....gg', 'g..gggg', 'gg.gggg', '.gggggg'],
  hound: ['p....p.', 'pp..pp.', 'ppppppp', 'pmppppp', 'ppppppp', '.pppppk', '..pppww', '.pp.pp.'],
  chest: ['.yyyy', 'yoooo', 'yoooo', 'yyyyw', 'yooow', 'yoooo', 'yyyyy'],
  totem: ['..y', '.yy', 'yyy', '.ee', '.ey', '.ee', '.ey', '.ee', 'eee'],
};
// Full sprites
const FULL = {
  gem: ['..c..', '.csc.', 'cswsc', 'cssbc', '.cbc.', '..c..'],
  coin: ['.yyy.', 'yywyy', 'yyyoy', 'yyoyy', '.ooo.'],
  heart: ['.rr.rr.', 'rwrrrrr', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...'],
  blade: ['...w...', '..waw..', '.wwaww.', '..waw..', '...w...'],
  i_sword: ['......w', '.....ww', '....ww.', 'w..ww..', '.www...', '..ww...', '.w..w..'],
  i_clock: ['..www..', '.w.w.w.', 'w..w..w', 'w..ww.w', 'w.....w', '.w...w.', '..www..'],
  i_heart: ['.ww.ww.', 'wwwwwww', 'wwwwwww', 'wwwwwww', '.wwwww.', '..www..', '...w...'],
  i_boot: ['..ww...', '..ww...', '..ww...', '..www..', '..wwww.', '.wwwwww', '.wwwwww'],
  i_magnet: ['ww...ww', 'ww...ww', 'ww...ww', 'ww...ww', 'www.www', '.wwwww.', '..www..'],
  i_ring: ['..www..', '.w...w.', 'w..w..w', 'w.w.w.w', 'w..w..w', '.w...w.', '..www..'],
  i_star: ['...w...', '..www..', 'wwwwwww', '.wwwww.', '.ww.ww.', 'ww...ww', '.......'],
  i_plus: ['..www..', '..www..', 'wwwwwww', 'wwwwwww', 'wwwwwww', '..www..', '..www..'],
  i_multi: ['w..w..w', 'w..w..w', '.w.w.w.', '.w.w.w.', '..www..', '..www..', '...w...'],
  i_leaf: ['....www', '..wwwww', '.ww.www', '.w.wwww', 'w.wwww.', 'wwwww..', 'w......'],
  i_shield: ['wwwwwww', 'wwwwwww', 'wwwwwww', 'wwwwwww', '.wwwww.', '..www..', '...w...'],
  i_book: ['www.www', 'w.www.w', 'w.www.w', 'w.www.w', 'www.www', 'wwwwwww', '.......'],
  i_skull: ['.wwwww.', 'wwwwwww', 'w..w..w', 'w..w..w', 'wwwwwww', '.w.w.w.', '.w.w.w.'],
  i_fang: ['w.....w', 'ww...ww', 'ww...ww', 'ww...ww', '.w...w.', '.w...w.', '.......'],
  i_feather: ['....www', '...wwww', '..wwww.', '.wwww..', '.www...', 'w.w....', 'w......'],
  i_fork: ['.w...w.', '.w...w.', '.w...w.', '..www..', '...w...', '...w...', '...w...'],
  i_speaker: ['wwwwwww', 'w..w..w', 'w.www.w', 'w..w..w', 'w.....w', 'w.www.w', 'wwwwwww'],
  i_bolt: ['....ww.', '...ww..', '..ww...', '.wwwww.', '...ww..', '..ww...', '.ww....'],
  i_flake: ['w..w..w', '.w.w.w.', '..www..', 'wwwwwww', '..www..', '.w.w.w.', 'w..w..w'],
  i_flame: ['...w...', '..ww...', '..www.w', '.wwwwww', 'www.www', 'ww...ww', '.wwwww.'],
  i_note: ['..wwwww', '..w...w', '..w...w', '..w...w', '.ww..ww', 'www.www', '.w...w.'],
  i_flask: ['..www..', '...w...', '...w...', '..www..', '.wwwww.', 'wwwwwww', '.wwwww.'],
  i_coin: ['..www..', '.wwwww.', 'www.www', 'www.www', 'www.www', '.wwwww.', '..www..'],
  i_dice: ['wwwwwww', 'w.www.w', 'wwwwwww', 'www.www', 'wwwwwww', 'w.www.w', 'wwwwwww'],
  i_lock: ['..www..', '.w...w.', '.w...w.', 'wwwwwww', 'www.www', 'www.www', 'wwwwwww'],
  i_echo: ['...w...', '..www..', '.wwwww.', 'wwwwwww', '.wwwww.', '..www..', '...w...'],
  r_bolt: ['....www', '.....ww', '....w.w', '...w...', '..w....', '.w.....', 'w......'],
  r_wisps: ['.ww....', '.ww..ww', '.....ww', '.......', '..ww...', '..ww...', '.......'],
  r_meteor: ['w......', '.w..w..', '..w..w.', '...www.', '..wwwww', '..wwwww', '...www.'],
  r_lance: ['...w...', '..www..', '..www..', '...w...', '...w...', '...w...', '...w...'],
  r_totem: ['..www..', '.w.w.w.', '..www..', '...w...', '..www..', '...w...', '.wwwww.'],
  r_rift: ['.wwww..', 'w....w.', 'w.ww..w', 'w.w.w.w', 'w..ww.w', '.w....w', '..wwww.'],
  r_chakram: ['...w...', '.wwwww.', '.ww.ww.', 'ww...ww', '.ww.ww.', '.wwwww.', '...w...'],
  r_spores: ['.ww.ww.', 'wwwwwww', 'wwwwwww', '.wwwww.', '.......', '.w.w.w.', '..w.w..'],
  r_beam: ['..w....', 'w.w....', '.ww....', 'wwwwwww', '.ww....', 'w.w....', '..w....'],
  r_amp: ['...w...', '..www..', '.ww.ww.', 'ww.w.ww', '..www..', '.ww.ww.', 'ww...ww'],
  r_echo: ['.w..w..', '..w..w.', 'w..w..w', 'w..w..w', 'w..w..w', '..w..w.', '.w..w..'],
  r_grow: ['ww...ww', 'w.....w', '..www..', '..www..', '..www..', 'w.....w', 'ww...ww'],
  r_cresc: ['......w', '....ww.', '..ww...', 'ww.....', '..ww...', '....ww.', '......w'],
  r_twin: ['.w...w.', 'www.www', '.w...w.', '.......', '.w...w.', 'www.www', '.w...w.'],
  r_mine: ['..w.w..', '.wwwww.', 'wwwwwww', '.ww.ww.', 'wwwwwww', '.wwwww.', '..w.w..'],
  r_wake: ['ww...ww', '..w.w..', '...w...', '.......', 'ww...ww', '..w.w..', '...w...'],
  r_decoy: ['..www..', '..www..', '...w...', '.wwwww.', '...w...', '..w.w..', '.w...w.'],
  r_dynamo: ['.wwww..', 'w....w.', 'w..w..w', 'w.www.w', 'w..w...', '.w....w', '..wwww.'],
  r_siphon: ['...w...', '..www..', '..www..', '.wwwww.', '.wwwww.', '.wwwww.', '..www..'],
  r_roots: ['...w...', '...w...', '..www..', '.w.w.w.', 'w..w..w', 'w..w..w', '..w.w..'],
  r_hound: ['.w...w.', '.ww.ww.', '.wwwww.', 'w.www.w', 'wwwwwww', '.ww.ww.', '..www..'],
  r_coda: ['.wwww..', 'w....w.', 'w.....w', 'w...www', 'w....w.', '.w.....', '..www..'],
  r_one: ['..ww...', '.www...', '..ww...', '..ww...', '..ww...', '..ww...', '.wwww..'],
  r_dot: ['.......', '..www..', '.wwwww.', '.wwwww.', '.wwwww.', '..www..', '.......'],
  r_ferm: ['..www..', '.w...w.', 'w.....w', 'w.....w', '.......', '...w...', '.......'],
};
const RUNE_GLYPH = {
  bolt: 'r_bolt', fireball: 'i_flame', nova: 'i_flake', chain: 'i_bolt', blades: 'i_sword', thorns: 'i_leaf', wisps: 'r_wisps', meteor: 'r_meteor',
  lance: 'r_lance', totem: 'r_totem', rift: 'r_rift', hex: 'i_skull', chakram: 'r_chakram', wave: 'i_speaker', spores: 'r_spores', beam: 'r_beam',
  f_starfall: 'i_star', f_supernova: 'r_meteor', f_glacier: 'i_flake', f_tesla: 'r_totem', f_halo: 'r_chakram', f_bloom: 'r_spores', f_horizon: 'r_rift', f_thermal: 'i_flame', f_prism: 'r_beam', f_boom: 'i_speaker',
  mines: 'r_mine', wake: 'r_wake', decoy: 'r_decoy', dynamo: 'r_dynamo', siphon: 'r_siphon', roots: 'r_roots', aegis: 'i_shield', hound: 'r_hound',
  blood: 'i_heart', coda: 'r_coda', reprise: 'r_one', transmute: 'i_flask', staccato: 'r_dot', fermata: 'r_ferm',
  f_pack: 'r_hound', f_jugger: 'r_dynamo', f_parasite: 'r_roots', f_lane: 'r_mine',
  amp: 'r_amp', twin: 'r_twin', echo: 'r_echo', grow: 'r_grow', sharp: 'i_star', grace: 'i_note', cresc: 'r_cresc',
};
const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];

const hex = n => '#' + n.toString(16).padStart(6, '0');

export function buildAtlas() {
  const SIZE = 512;
  const cv = document.createElement('canvas'); cv.width = cv.height = SIZE;
  const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = false;
  const frames = {};
  let cx = 1, cy = 1, rowH = 0;
  const alloc = (name, w, h) => {
    if (cx + w + 1 > SIZE) { cx = 1; cy += rowH + 1; rowH = 0; }
    const f = { x: cx, y: cy, w, h }; frames[name] = f; cx += w + 1; rowH = Math.max(rowH, h); return f;
  };
  const grid = (name, rows, pal = {}, outline = true) => {
    const h = rows.length, w = Math.max(...rows.map(r => r.length)), o = outline ? 1 : 0;
    const f = alloc(name, w + o * 2, h + o * 2);
    const at = (x, y) => (y >= 0 && y < h && x >= 0 && x < rows[y].length && rows[y][x] !== '.') ? rows[y][x] : null;
    for (let y = -o; y < h + o; y++) for (let x = -o; x < w + o; x++) {
      const c = at(x, y);
      if (c) {
        ctx.fillStyle = pal[c] || PAL[c] || '#ff00ff'; ctx.fillRect(f.x + x + o, f.y + y + o, 1, 1);
        // soft bottom-right shading for volume
        if (outline && c !== 'k' && c !== 'w' && (!at(x + 1, y) || !at(x, y + 1))) { ctx.fillStyle = 'rgba(10,6,30,0.28)'; ctx.fillRect(f.x + x + o, f.y + y + o, 1, 1); }
      } else if (o && (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1))) { ctx.fillStyle = OUTLINE; ctx.fillRect(f.x + x + o, f.y + y + o, 1, 1); }
    }
    return f;
  };
  const mirror = rows => rows.map(r => r + r.split('').reverse().join(''));

  for (const k in HALF) if (k !== 'hero') grid(k, mirror(HALF[k]));
  for (const c of CHARS) for (const k of SKINS) grid(`hero_${c.id}_${k.id}`, mirror(k.id === 'wizard' ? HALF.hero : HERO[k.id]), { h: c.pal.h, H: c.pal.H, R: c.pal.r });
  for (const k in FULL) grid(k, FULL[k], {}, !/^(i_|r_)/.test(k));
  DIGITS.forEach((bits, d) => grid('d' + d, [0, 1, 2, 3, 4].map(r => bits.slice(r * 3, r * 3 + 3).replace(/1/g, 'w').replace(/0/g, '.'))));

  // rune tiles: dark plate, element border, tinted glyph
  for (const id in RUNES) {
    const col = hex(ELEM[RUNES[id].elem].c), mod = RUNES[id].type === 'mod', fus = RUNES[id].fusion, f = alloc('rune_' + id, 13, 13), g = FULL[RUNE_GLYPH[id]];
    ctx.fillStyle = fus ? '#ffcd75' : col; ctx.fillRect(f.x + 1, f.y, 11, 13); ctx.fillRect(f.x, f.y + 1, 13, 11);
    ctx.fillStyle = mod ? '#3a3350' : '#161226'; ctx.fillRect(f.x + 1, f.y + 1, 11, 11);
    if (mod) { ctx.fillStyle = '#161226'; ctx.fillRect(f.x + 2, f.y + 2, 9, 9); }
    if (fus) { ctx.fillStyle = '#3a2a10'; ctx.fillRect(f.x + 1, f.y + 1, 11, 11); ctx.fillStyle = '#fff2c0'; for (const [x, y] of [[1, 1], [11, 1], [1, 11], [11, 11]]) ctx.fillRect(f.x + x, f.y + y, 1, 1); }
    ctx.fillStyle = col;
    g.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] !== '.') ctx.fillRect(f.x + 3 + x, f.y + 3 + y, 1, 1); });
  }
  { const f = alloc('slot_empty', 13, 13); ctx.fillStyle = '#4a4266'; ctx.fillRect(f.x + 1, f.y, 11, 13); ctx.fillRect(f.x, f.y + 1, 13, 11); ctx.fillStyle = '#161226'; ctx.fillRect(f.x + 1, f.y + 1, 11, 11); ctx.fillStyle = '#4a4266'; ctx.fillRect(f.x + 6, f.y + 6, 1, 1); }

  // fx shapes
  const shape = (name, n, fn) => {
    const f = alloc(name, n, n), img = ctx.createImageData(n, n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n * 2 - 1, v = (y + 0.5) / n * 2 - 1, a = Math.max(0, Math.min(1, fn(Math.hypot(u, v), x, y, u, v))), i = (y * n + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.round(a * 255);
    }
    ctx.putImageData(img, f.x, f.y);
  };
  const q = (v, n = 5) => Math.round(v * n) / n;
  shape('glow', 24, d => q(Math.pow(Math.max(0, 1 - d), 1.6), 6));
  shape('orb', 12, d => d < 0.55 ? 1 : d < 0.95 ? 0.45 : 0);
  shape('ring', 64, d => (d > 0.86 && d < 0.98) ? 1 : (d <= 0.86 ? 0.1 * d : 0));
  shape('ringthin', 64, d => (d > 0.92 && d < 0.99) ? 1 : 0);
  shape('disc', 32, d => d < 0.96 ? 1 : 0);
  shape('tele', 48, (d, x, y) => d > 0.9 && d < 1 ? 1 : d < 0.9 && ((x + y) & 3) === 0 ? 0.55 : 0);
  shape('px', 4, () => 1);
  shape('soft', 8, d => q(Math.max(0, 1 - d * d), 3));
  shape('shadow', 16, (d, x, y) => d < 0.95 && ((x + y) & 1) ? 1 : 0);
  // shadow is black
  { const f = frames.shadow, img = ctx.getImageData(f.x, f.y, f.w, f.h); for (let i = 0; i < img.data.length; i += 4) { img.data[i] = 8; img.data[i + 1] = 4; img.data[i + 2] = 20; } ctx.putImageData(img, f.x, f.y); }
  return { canvas: cv, frames, size: SIZE };
}

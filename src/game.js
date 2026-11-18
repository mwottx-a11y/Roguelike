// HEXBEAT — run simulation. Pure logic: no DOM, no rendering. The renderer reads our arrays each frame.
import { RUNES, PASSIVES, RELICS, RELIC_IDS, PACT_IDS, CHARS, META, ENEMIES, BIOMES, MUTATORS, ELEM, MAX_RUNE_LVL, fusionOf } from './data.js';

const TAU = Math.PI * 2;
const rnd = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const pick = arr => arr[(Math.random() * arr.length) | 0];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const NOFX = new Proxy({}, { get: () => () => {} });

export const xpNeed = l => Math.floor(4 + 3 * l + 0.5 * l * l);
// One wheel slot = one beat. Up to 5 slots a beat is a quarter note; from 6 slots it is an eighth note (double time).
export const STEP_Q = 0.42;
export const MAX_SLOTS = 6;
// ---- difficulty dials (tuned with tools/pro.mjs) ----
export const TUNE = {
  enemyHp: 1.05,      // all enemy health
  enemyHpStage: 2.0,  // health growth per stage
  enemyDmg: 1.6,      // all enemy damage
  enemyDmgStage: 1.5, // damage growth per stage
  enemySpd: 1.18,     // enemy move speed
  spdCap: 4.3,        // nothing ordinary outruns a base-speed player
  iframes: 0.45,      // seconds of safety after a hit
  armorK: 10,         // damage taken = dmg * K / (K + armor)
  bossHeal: 0.1,      // fraction of max HP restored by a boss kill
};

export class Run {
  constructor({ char, volume = 0, metaLevels = {}, unlocked, fx, audio }) {
    this.char = CHARS.find(c => c.id === char) || CHARS[0];
    this.volume = volume;
    this.metaLevels = metaLevels;
    this.unlocked = unlocked || Object.keys(RUNES);
    this.fx = fx || NOFX;
    this.audio = audio || NOFX;
    this.passives = {};
    this.relics = [];
    this.wheel = new Array(8).fill(null);
    this.res = new Array(8).fill(0);
    this.fire = new Array(8).fill(0); // per-slot flash timers for the HUD
    this.recalc();
    this.size = Math.min(MAX_SLOTS, this.s.slots);
    this.char.start.forEach((id, i) => { this.wheel[i] = { id, lvl: 1 }; });
    this.p = { x: 0, z: 0, hp: this.s.maxHp, inv: 0, dashT: 0, dashCd: 0, dashN: this.s.dashes, dx: 0, dz: 1, fx: 1, fz: 1, moving: false, hurt: 0 };
    this.input = { x: 0, z: 0, dash: false, drop: false };
    this.enemies = []; this.shots = []; this.bullets = []; this.pickups = []; this.zones = []; this.turrets = []; this.timers = [];
    this.orbs = null;
    this.level = 1; this.xp = 0; this.gold = 0; this.kills = 0; this.combo = 0; this.comboT = 0;
    this.drop = 0; this.dropT = 0;
    this.step = 0; this.stepT = 0.5; this.loops = 0; this.mBeat = 0; this.storm = null; this.fusedIds = []; this.mines = []; this.pets = []; this.decoy = null; this.wake = null; this.jugger = null; this.shield = 0; this.aegisN = 0; this.aegisMax = 1; this.moved = 0; this.stillT = 0; this.moveT = 0; this.dyn = 1; this.wheelBonus = 1; this.roadieT = 18; this.beatN = 0; this.codaFlip = false; this.chemT = 0; this.diveHit = null; this.pend = this.freshPend(); this.last = null; this.cresc = 0; this.crescPct = 0;
    this.rerolls = this.s.rerolls; this.revivesUsed = 0;
    this.pending = []; // queued choice screens: 'level' | 'relic'
    this.state = 'play';
    this.time = 0; this.beat = 0;
    this.c = { cleared: 0, reactions: 0, maxCombo: 0, maxGold: 0, drops: 0, noHitStage: false, fullWheel: false, bossKills: 0, dmgTaken: 0, spots: 0, fusions: 0, pacts: 0, blocks: 0 };
    this.toasts = []; this.seenReact = {};
    this.wheelChanged();
    this.startStage(0, 'calm');
    for (let i = 0; i < this.s.headStart; i++) { this.level++; this.pending.push('level'); }
  }

  // ---------- stats ----------
  recalc() {
    const s = {
      dmg: 1, tempo: 1, maxHp: 100, maxHpMul: 1, speed: 4.3, magnet: 1, xpMul: 1, goldMul: 1, crit: 0.05, critMul: 2, armor: 0, regen: 0, area: 1,
      multi: 0, luck: 0, dropGain: 1, dropDur: 5, rerolls: 1, skipGold: 10, dashes: 1, slots: 3, headStart: 0, revives: 0, echoMul: 1, leech: 0,
      burnMul: 1, reactMul: 1, resMul: 1, modPow: 1, choices: 3, chillDur: 1, elem: {}, dur: 1, dashCd: 1, twinChance: 0, execute: 0, enemySpd: 1,
    };
    for (const m of META) { const n = this.metaLevels[m.id] || 0; if (n) m.f(s, n); }
    this.char.f(s);
    const P = this.passives;
    s.dmg *= 1 + 0.12 * (P.might || 0); s.tempo *= 1 + 0.06 * (P.tempo || 0); s.maxHp += 20 * (P.vital || 0); s.speed *= 1 + 0.07 * (P.swift || 0);
    s.magnet *= 1 + 0.35 * (P.magnet || 0); s.area *= 1 + 0.1 * (P.area || 0); s.crit += 0.07 * (P.crit || 0); s.slots += P.slot || 0; s.multi += P.multi || 0;
    s.regen += 0.25 * (P.regen || 0); s.armor += 2 * (P.armor || 0); s.xpMul *= 1 + 0.1 * (P.growth || 0);
    s.dur *= 1 + 0.15 * (P.sustain || 0); s.dashCd *= Math.pow(0.88, P.agility || 0); s.twinChance += 0.06 * (P.dstop || 0); s.execute += 0.12 * (P.finisher || 0); s.dropGain *= 1 + 0.2 * (P.hype || 0); s.luck += 0.3 * (P.fortune || 0);
    for (const id of this.relics) RELICS[id].f(s);
    s.maxHp = Math.max(20, Math.round(s.maxHp * s.maxHpMul));
    this.s = s;
    if (this.p) { const z0 = this.size; this.size = Math.min(MAX_SLOTS, s.slots); this.p.hp = Math.min(this.p.hp, s.maxHp); if (z0 !== this.size) this.wheelChanged(); }
  }
  wheelChanged() {
    const n = this.size;
    let full = n >= MAX_SLOTS;
    for (let i = 0; i < 8; i++) {
      this.res[i] = 0;
      const w = this.wheel[i];
      if (i < n && !w) full = false;
      if (i >= n || !w || RUNES[w.id].type !== 'spell') continue;
      const el = RUNES[w.id].elem;
      for (const j of [(i + n - 1) % n, (i + 1) % n]) {
        const o = this.wheel[j];
        if (j !== i && o && RUNES[o.id].type === 'spell' && RUNES[o.id].elem === el) this.res[i]++;
      }
    }
    if (full) this.c.fullWheel = true;
    const cr = this.wheel.find((w, i) => i < n && w && w.id === 'cresc');
    this.crescPct = cr ? [0.04, 0.05, 0.06, 0.07, 0.09][cr.lvl - 1] * this.s.modPow : 0;
    if (!cr) this.cresc = 0;
    { // relics that care about what is on the wheel
      const s = this.s, els = new Set(); let empty = 0, spells = 0;
      for (let i = 0; i < n; i++) { const w = this.wheel[i]; if (!w) { empty++; continue; } if (RUNES[w.id].type === 'spell') { spells++; els.add(RUNES[w.id].elem); } }
      let b = 1; if (s.minimal) b *= 1 + 0.2 * empty; if (s.purist && spells >= 2 && els.size === 1) b *= 1.5; if (s.eclectic) b *= 1 + 0.09 * els.size;
      this.wheelBonus = b;
    }
    let beats = 0; for (let i = 0; i < n; i++) if (!this.wheel[i] || this.wheel[i].id !== 'grace') beats++;
    this.beats = Math.max(1, beats);
    const meter = this.beats + '/' + (n >= 6 ? 8 : 4);
    if (this.meter && meter !== this.meter && this.toasts) this.toast(meter + (n >= 6 && this.meter.endsWith('/4') ? '  DOUBLE TIME!' : ' TIME'), 0x73eff6);
    this.meter = meter;
    // the band follows the wheel: each spell class brings its genre, weighted by rune level
    const mix = {}; for (let i = 0; i < n; i++) { const w = this.wheel[i]; if (!w) continue; const d = RUNES[w.id]; mix[d.elem] = (mix[d.elem] || 0) + (d.fusion ? 8 : d.type === 'mod' ? w.lvl * 0.6 : w.lvl); }
    this.audio.setMix(mix);
  }
  stepLen() { return this.size >= 6 ? STEP_Q / 2 : STEP_Q; }
  // adjacent (circular) pairs of MAX spells that match a recipe
  fusionReady() {
    const n = this.size, out = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, a = this.wheel[i], b = this.wheel[j];
      if (j === i || !a || !b || (n === 2 && i === 1)) continue;
      const f = fusionOf(a.id, b.id);
      if (f && a.lvl >= MAX_RUNE_LVL && b.lvl >= MAX_RUNE_LVL) out.push({ kind: 'fuse', id: f.id, i, j, a: a.id, b: b.id });
    }
    return out;
  }
  swap(i, j) { const t = this.wheel[i]; this.wheel[i] = this.wheel[j]; this.wheel[j] = t; this.wheelChanged(); }
  freshPend() { return { dmg: 1, area: 1, rep: 0, repPow: 0.75, crit: false, critBonus: 0, any: false, dur: 1, elemX: null, pop: 0 }; }
  dashMax() { return 2.4 * this.s.dashCd; }
  toast(text, color = 0xffffff) { this.toasts.push({ text, color }); }

  // ---------- stage flow ----------
  startStage(n, mutId) {
    const biome = BIOMES[n % BIOMES.length];
    const st = { n, biome, t: 0, dur: 60 + 5 * Math.min(n, 4), spawnAcc: 0, spawnMul: 1, goldMul: 1, xpMul: 1, spdMul: 1, hpMul: 1, dmgMul: 1, shootMul: 1, elites: 1, elitesDone: 0, boss: null, bossDone: false, clearT: 0, hit: false, eventT: 14, spotT: 10, mut: MUTATORS.find(m => m.id === mutId) || MUTATORS[0] };
    st.mut.f(st);
    this.stage = st;
    const v = this.volume;
    const late = n >= 3 ? 1.6 * Math.pow(1.3, n - 3) : 1; // the wheel hits double time around stage 4; foes toughen to match
    this.late = late;
    this.eHp = TUNE.enemyHp * Math.pow(TUNE.enemyHpStage, n) * late * (1 + 0.42 * v + 0.03 * v * v) * st.hpMul;
    this.eDmg = TUNE.enemyDmg * Math.pow(TUNE.enemyDmgStage, n) * (1 + 0.2 * v) * st.dmgMul;
    this.eSpd = TUNE.enemySpd * (1 + Math.min(0.2, 0.02 * v)) * this.s.enemySpd * st.spdMul * (1 + Math.min(0.2, 0.02 * Math.max(0, n - 4)));
    this.enemies.length = 0; this.bullets.length = 0; this.zones = this.zones.filter(z => !z.enemy); this.spot = null; this.mines.length = 0; this.pets.length = 0; this.decoy = null;
    this.state = 'play';
    this.fx.biome(biome);
    this.audio.newSong();
    this.toast(biome.name, biome.acc);
    if (st.mut.id !== 'calm') this.toast(st.mut.name.toUpperCase(), 0xffcd75);
    if (st.freeRelic) this.pending.push('relic');
  }
  nextStageOptions() {
    const pool = MUTATORS.filter(m => m.id !== 'calm');
    const a = pick(pool);
    return Math.random() < 0.5 ? [MUTATORS[0], a] : [a, pick(pool.filter(m => m !== a))];
  }

  // ---------- main update ----------
  update(dt) {
    if (this.state !== 'play' && this.state !== 'clear') return;
    this.time += dt;
    const p = this.p, s = this.s, st = this.stage;
    // timers
    for (let i = this.timers.length - 1; i >= 0; i--) { const t = this.timers[i]; t.t -= dt; if (t.t <= 0) { this.timers.splice(i, 1); t.f(); } }
    for (let i = 0; i < 8; i++) if (this.fire[i] > 0) this.fire[i] -= dt * 4;
    this.beat = Math.max(0, this.beat - dt * 3.5);
    // player
    const inp = this.input;
    let ix = inp.x, iz = inp.z; const il = Math.hypot(ix, iz);
    if (il > 1) { ix /= il; iz /= il; }
    p.moving = il > 0.1;
    if (p.moving) { const l = Math.hypot(ix, iz); p.dx = ix / l; p.dz = iz / l; if (Math.abs(ix) > 0.05) p.fx = ix > 0 ? 1 : -1; }
    if (p.dashN < s.dashes) { p.dashCd -= dt; if (p.dashCd <= 0) { p.dashN++; p.dashCd = this.dashMax(); } }
    if (inp.dash) { inp.dash = false; if (p.dashN > 0 && p.dashT <= 0 && !s.noDash) { if (p.dashN === s.dashes) p.dashCd = this.dashMax(); this.diveHit = s.dive ? new Set() : null; if (s.rubato) this.stepT = 0; p.dashN--; p.dashT = 0.2; p.inv = Math.max(p.inv, 0.38); this.audio.sfx('dash'); this.fx.burst(p.x, p.z, 0xffffff, 8, { up: 0.5 }); if (s.dashWave) this.aoe(p.x, p.z, 3 * s.area, 14, 'steel', { kb: 6 }, 0xd8e4f0); } }
    if (inp.drop) { inp.drop = false; this.useDrop(); }
    const px0 = p.x, pz0 = p.z;
    if (p.dashT > 0 && this.diveHit) for (const e of this.enemies) { if (e.dead || this.diveHit.has(e)) continue; if ((e.x - p.x) ** 2 + (e.z - p.z) ** 2 < (1.1 + e.r) ** 2) { this.diveHit.add(e); this.hit(e, 40 + this.level, 'steel', { kb: 5, noReact: true }); if (e.dead && p.dashN < s.dashes) { p.dashN++; this.diveHit = new Set(this.diveHit); } } }
    if (p.dashT > 0) { p.dashT -= dt; p.x += p.dx * 17 * dt; p.z += p.dz * 17 * dt; if (Math.random() < 0.6) this.fx.burst(p.x, p.z, 0xb48cff, 1, { up: 0.3, spd: 0.5 }); }
    else { p.x += ix * s.speed * dt; p.z += iz * s.speed * dt; }
    { // movement trackers and the damage bonuses that depend on what you are doing right now
      const mv = Math.hypot(p.x - px0, p.z - pz0); this.moved = Math.min(14, this.moved + mv);
      if (p.moving || p.dashT > 0) { this.stillT = 0; this.moveT += dt; } else { this.stillT += dt; if (this.stillT > 0.3) this.moveT = 0; }
      let d = this.wheelBonus;
      if (s.still && this.stillT > 0.6) d *= 1.45;
      if (s.momentum) d *= 1 + Math.min(0.36, 0.04 * this.moveT);
      if (s.fright && p.moving) d *= 1.6;
      if (s.blues && p.hp < s.maxHp * 0.5) d *= 1.4;
      if (s.majorKey && p.hp >= s.maxHp) d *= 1.25;
      this.dyn = d;
      if (s.roadie) { this.roadieT -= dt; if (this.roadieT <= 0) { this.roadieT = 18; if (this.shield < 1) { this.shield = 1; this.fx.ring(p.x, p.z, 1.6, 0xd8e4f0, 0.3); } } }
      if (this.chemT > 0) this.chemT -= dt;
      const wk = this.wake;
      if (wk && wk.t > 0) { wk.t -= dt; wk.acc += mv; if (wk.acc > 0.9) { wk.acc = 0; this.zones.push({ type: 'cloud', x: p.x, z: p.z, r: wk.r, t: 0, dur: wk.life, tick: 0, dmg: wk.dmg, elem: wk.fire && Math.random() < 0.5 ? 'fire' : 'frost', color: wk.fire ? 0xff9a5d : 0x73eff6, o: wk.o }); if (wk.fire && Math.random() < 0.5) this.dropMine(p.x, p.z, wk.dmg * 4, 1.8, wk.o); } }
    }
    const ar = st.arena;
    if (ar) { const dx = p.x - ar.x, dz = p.z - ar.z, d = Math.hypot(dx, dz); if (d > ar.r) { p.x = ar.x + dx / d * ar.r; p.z = ar.z + dz / d * ar.r; } }
    if (p.inv > 0) p.inv -= dt;
    if (p.hurt > 0) p.hurt -= dt;
    if (s.regen > 0 && p.hp < s.maxHp) p.hp = Math.min(s.maxHp, p.hp + s.regen * dt);
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }
    if (this.dropT > 0) { this.dropT -= dt; if (this.dropT <= 0) this.audio.sfx('dropEnd'); }

    // wheel
    if (this.state === 'play') {
      this.stepT -= dt * s.tempo * (s.blues && p.hp < s.maxHp * 0.5 ? 1.15 : 1) * (this.dropT > 0 ? 2 : 1);
      let guard = 0;
      while (this.stepT <= 0 && guard++ < 10) { this.stepT += this.stepLen(); this.fireStep(); }
    }
    const sp = this.spot;
    if (sp) {
      sp.life -= dt;
      if ((p.x - sp.x) ** 2 + (p.z - sp.z) ** 2 < sp.r * sp.r) { sp.q += dt / 2.4; sp.life = Math.max(sp.life, 1); } else sp.q = Math.max(0, sp.q - dt * 0.12);
      if (sp.q >= 1) {
        this.spot = null; this.c.spots++; this.fx.ring(sp.x, sp.z, 5, 0xffcd75, 0.5); this.fx.burst(sp.x, sp.z, 0xffcd75, 24, { spd: 6, up: 3 }); this.audio.sfx('levelup'); this.fx.haptic(30);
        if (sp.kind === 'xp') { this.gainXp(xpNeed(this.level) * 0.7 / (s.xpMul * st.xpMul)); this.toast('ENCORE XP!', 0x73eff6); }
        else if (sp.kind === 'gold') { const g = 20 + 8 * Math.min(st.n, 8); this.gold += g; this.toast('+' + g + ' GOLD', 0xffcd75); }
        else if (sp.kind === 'heal') { this.heal(s.maxHp * 0.35); this.toast('HEALED!', 0xff5c7a); }
        else { this.drop = 100; this.toast('DROP READY!', 0xff5ccd); }
      } else if (sp.life <= 0) this.spot = null;
    }
    this.updateSummons(dt);
    this.updateOrbs(dt); this.updateTurrets(dt); this.updateShots(dt); this.updateZones(dt);
    this.updateEnemies(dt); this.updateBullets(dt); this.updatePickups(dt);

    // stage director
    if (this.state === 'play') {
      st.t += dt;
      if (!st.boss) {
        const prog = Math.min(1, st.t / st.dur);
        const cap = 110 + 20 * Math.min(st.n, 7);
        const rate = (2.2 + 0.8 * Math.min(st.n, 10)) * (0.6 + 1.6 * prog) * st.spawnMul * (1 + 0.05 * this.volume);
        st.spawnAcc += rate * dt;
        while (st.spawnAcc >= 1) { st.spawnAcc -= 1; if (this.enemies.length < cap) this.spawnRoster(prog); }
        const eliteTimes = st.elites >= 2 ? [0.25, 0.45, 0.65, 0.85] : [0.4, 0.75];
        if (st.elitesDone < eliteTimes.length && prog >= eliteTimes[st.elitesDone]) { st.elitesDone++; this.spawnElite(prog); }
        st.eventT -= dt;
        if (st.eventT <= 0) { st.eventT = rnd(15, 22); this.spawnEvent(); }
        st.spotT -= dt;
        if (st.spotT <= 0 && !this.spot && st.t < st.dur - 12) { st.spotT = rnd(20, 28); const a = rnd(TAU), d = rnd(7, 10); this.spot = { x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d, r: 2.3, q: 0, life: 20, kind: pick(['xp', 'xp', 'gold', 'heal', 'drop']) }; this.toast('SPOTLIGHT!', 0xffcd75); this.audio.sfx('chest'); }
        if (st.t >= st.dur) this.spawnBoss();
      } else if (!st.bossDone) {
        st.spawnAcc += (0.5 + 0.15 * st.n) * dt;
        while (st.spawnAcc >= 1) { st.spawnAcc -= 1; if (this.enemies.length < 40) this.spawnRoster(0.3); }
      }
    } else if (this.state === 'clear') {
      st.clearT -= dt;
      for (const g of this.pickups) g.pull = true;
      if (st.clearT <= 0 && !this.pending.length) { this.state = 'shop'; }
    }
    this.enemies = this.enemies.filter(e => !e.dead);
    if (this.purge) { this.purge = false; this.bullets.length = 0; this.zones = this.zones.filter(z => !z.enemy); }
    if (this.gold > this.c.maxGold) this.c.maxGold = this.gold;
  }

  // ---------- the wheel ----------
  fireStep() {
    const i = this.step, n = this.size, s = this.s;
    this.step = (i + 1) % n;
    this.fire[i] = 1; this.beat = 1;
    const slot = this.wheel[i];
    const def = slot && RUNES[slot.id];
    if (i === 0) this.mBeat = 0;
    if (slot && slot.id === 'grace') this.audio.grace();
    else { this.audio.step({ beat: this.mBeat % this.beats, beats: this.beats, unit: n >= 6 ? 8 : 4, def, slot: i, drop: this.dropT > 0, boss: !!this.stage.boss, dur: this.stepLen() / (s.tempo * (this.dropT > 0 ? 2 : 1)) }); this.mBeat++; }
    if (i === 0) this.fx.pulse();
    if (this.step === 0) {
      this.loops++;
      if (this.crescPct && this.cresc < 10) this.cresc++;
      if (s.encore && this.last && Math.random() < s.encore) this.after(0.1, () => this.last && this.cast(this.last.id, this.last.lvl, { ...this.last.c, dmg: this.last.c.dmg * 0.8 }));
    }
    if (!slot) { // empty slot: a weak pluck so no beat is ever dead air
      const t = this.nearest(this.p.x, this.p.z, 11);
      if (t) this.shoot(t, { spd: 15, dmg: 5 * (s.fork ? 3 : 1), elem: 'arcane', pierce: s.fork ? 3 : 0, size: 0.3, color: 0xcfc4ff });
      return;
    }
    const lv = slot.lvl, pn = this.pend, mp = s.modPow;
    if (def.type === 'mod') {
      pn.any = true;
      switch (slot.id) {
        case 'amp': pn.dmg *= 1 + (0.6 + 0.2 * lv) * mp; break;
        case 'twin': pn.rep += lv >= 4 ? 2 : 1; pn.repPow = Math.max(pn.repPow, [0.75, 0.85, 0.95, 0.95, 1][lv - 1]); break;
        case 'grow': pn.area *= 1 + ([0.4, 0.5, 0.6, 0.7, 0.9][lv - 1]) * mp; break;
        case 'sharp': pn.crit = true; pn.critBonus += 0.25 * (lv - 1) * mp; break;
        case 'grace': pn.dmg *= 1 + ([0.15, 0.25, 0.35, 0.45, 0.6][lv - 1]) * mp; this.stepT = 0; break;
        case 'echo': if (this.last) { const pw = [0.6, 0.7, 0.8, 0.9, 1.1][lv - 1] * mp; this.cast(this.last.id, this.last.lvl, { ...this.last.c, dmg: this.last.c.dmg * pw }); } break;
        case 'cresc': break;
        case 'blood': if (this.p.hp > 5) { this.p.hp -= 4; this.fx.burst(this.p.x, this.p.z, 0xff3050, 5, { up: 2 }); } pn.dmg *= 1 + (1.3 + 0.2 * lv + (lv >= 5 ? 0.1 : 0)) * mp; break;
        case 'coda': pn.dmg *= 1 + ([0.35, 0.45, 0.55, 0.65, 0.8][lv - 1]) * mp; this.codaFlip = !this.codaFlip; if (this.codaFlip && this.step !== 0) { this.step = 0; this.loops++; } break;
        case 'reprise': { let f = null; for (let k = 0; k < n; k++) { const w = this.wheel[k]; if (w && RUNES[w.id].type === 'spell') { f = w; break; } } if (f) this.cast(f.id, f.lvl, { dmg: [0.7, 0.8, 0.9, 1, 1.2][lv - 1] * mp, area: s.area, dur: s.dur, crit: false, critBonus: 0 }); break; }
        case 'transmute': pn.elemX = pick(['fire', 'frost', 'volt', 'void', 'nature']); pn.dmg *= 1 + ([0.25, 0.3, 0.35, 0.4, 0.5][lv - 1]) * mp; break;
        case 'staccato': pn.pop = Math.max(pn.pop, [0.5, 0.65, 0.8, 0.95, 1.3][lv - 1] * mp); break;
        case 'fermata': pn.dur *= 1 + ([0.8, 1, 1.2, 1.4, 1.8][lv - 1]) * mp; break;
      }
      return;
    }
    const c = { dmg: pn.dmg * (1 + 0.15 * s.resMul * this.res[i]), area: pn.area * s.area, crit: pn.crit, critBonus: pn.critBonus, dur: pn.dur * s.dur, elemX: pn.elemX, pop: pn.pop };
    if (i === 0 && s.downbeat) { c.dmg *= 1.5; c.crit = true; }
    let rep = pn.rep; const repPow = pn.repPow;
    if (s.twinChance && Math.random() < s.twinChance) rep++;
    if (s.finale && i === n - 1) rep++;
    this.pend = this.freshPend();
    this.cast(slot.id, lv, c);
    for (let r = 1; r <= rep; r++) this.after(0.11 * r, () => this.cast(slot.id, lv, { ...c, dmg: c.dmg * repPow }));
    this.last = { id: slot.id, lvl: lv, c };
    // Polyrhythm: every 4th beat another spell joins in
    if (s.poly && ++this.beatN % 4 === 0) { const others = []; for (let k = 0; k < n; k++) { const w = this.wheel[k]; if (k !== i && w && RUNES[w.id].type === 'spell') others.push(w); } if (others.length) { const w = pick(others); this.after(0.06, () => this.cast(w.id, w.lvl, { dmg: 0.6, area: s.area, dur: s.dur, crit: false, critBonus: 0 })); } }
  }
  dropMine(x, z, dmg, r, o) { if (this.mines.length >= 26) this.mines.shift(); this.mines.push({ x, z, t: 0, life: 12, dmg, r, o }); }
  after(t, f) { this.timers.push({ t, f }); }

  nearest(x, z, maxR = 99, skip) {
    let best = null, bd = maxR * maxR;
    for (const e of this.enemies) { if (e.dead || (skip && skip.has(e))) continue; const d = (e.x - x) ** 2 + (e.z - z) ** 2; if (d < bd) { bd = d; best = e; } }
    return best;
  }
  nearestN(n, maxR = 12) {
    const p = this.p, arr = [];
    for (const e of this.enemies) { if (e.dead) continue; const d = (e.x - p.x) ** 2 + (e.z - p.z) ** 2; if (d < maxR * maxR) arr.push([d, e]); }
    arr.sort((a, b) => a[0] - b[0]);
    return arr.slice(0, n).map(a => a[1]);
  }
  randomNear(maxR = 8) {
    const p = this.p, arr = this.enemies.filter(e => !e.dead && (e.x - p.x) ** 2 + (e.z - p.z) ** 2 < maxR * maxR);
    return arr.length ? pick(arr) : null;
  }
  aimDir() { const t = this.nearest(this.p.x, this.p.z, 14); return t ? Math.atan2(t.z - this.p.z, t.x - this.p.x) : Math.atan2(this.p.dz, this.p.dx); }
  shoot(target, o) {
    const p = this.p, a = typeof target === 'number' ? target : Math.atan2(target.z - p.z, target.x - p.x);
    const sh = { x: p.x, z: p.z, vx: Math.cos(a) * o.spd, vz: Math.sin(a) * o.spd, life: o.life || 1.6, r: (o.size || 0.3), hit: new Set(), pierce: 0, type: 'bullet', elem: 'arcane', color: 0xffffff, ...o };
    this.shots.push(sh); return sh;
  }

  cast(id, lv, c) {
    const p = this.p, s = this.s, L = 1 + 0.3 * (lv - 1), col = ELEM[RUNES[id].elem].c, A = c.area;
    const o = { crit: c.crit, critBonus: c.critBonus, elem: c.elemX || undefined, pop: c.pop || 0 }, D = c.dur || 1;
    switch (id) {
      case 'bolt': {
        const n = 1 + (lv >= 3) + (lv >= 5) + s.multi, ts = this.nearestN(n, 12);
        if (!ts.length) break;
        for (let k = 0; k < n; k++) this.shoot(ts[k % ts.length], { spd: 15, dmg: 15 * L * c.dmg, elem: 'arcane', color: col, pierce: lv >= 4 ? 1 : 0, size: 0.34 * Math.sqrt(A), o, spread: k });
        this.shots.slice(-n).forEach((sh, k) => { if (k >= ts.length) { const a = Math.atan2(sh.vz, sh.vx) + (k - ts.length + 1) * 0.18; sh.vx = Math.cos(a) * 15; sh.vz = Math.sin(a) * 15; } });
        break;
      }
      case 'fireball': {
        const n = 1 + s.multi, ts = this.nearestN(n, 12); if (!ts.length) break;
        for (let k = 0; k < n; k++) this.shoot(ts[k % ts.length], { spd: 9, dmg: 17 * L * c.dmg, elem: 'fire', color: col, size: 0.5, type: 'fireball', aoe: 1.6 * (lv >= 3 ? 1.3 : 1) * A, ground: lv >= 5, o, life: 2 });
        break;
      }
      case 'nova':
        this.zones.push({ type: 'nova', x: p.x, z: p.z, r: 0, R: 3.1 * (lv >= 3 ? 1.3 : 1) * A, t: 0, dur: 0.32, dmg: 13 * L * c.dmg, elem: 'frost', color: col, hit: new Set(), freeze: lv >= 5, o, follow: true });
        break;
      case 'chain': {
        let cur = this.nearest(p.x, p.z, 9); if (!cur) break;
        const jumps = 3 + (lv >= 2) + (lv >= 3) + (lv >= 5 ? 2 : 0) + s.multi, seen = new Set(); let px = p.x, pz = p.z, d = 15 * (lv >= 4 ? 1.5 : 1) * (1 + 0.1 * (lv - 1)) * c.dmg;
        for (let j = 0; j < jumps && cur; j++) {
          seen.add(cur); this.fx.beam(px, pz, cur.x, cur.z, col, 0.14, 0.14);
          px = cur.x; pz = cur.z; this.hit(cur, d, 'volt', o); d *= 0.92;
          cur = this.nearest(px, pz, 4.5 * Math.sqrt(A), seen);
        }
        this.audio.sfx('zap');
        break;
      }
      case 'blades': {
        const n = 2 + (lv >= 3) + (lv >= 5) + s.multi;
        this.orbs = { n: Math.min(8, Math.max(n, this.orbs && this.orbs.t > 0 ? this.orbs.n : 0)), t: 2.6 * D, ang: this.orbs ? this.orbs.ang : 0, r: 1.9 * Math.sqrt(A), dmg: 10.5 * L * c.dmg, o, color: col };
        break;
      }
      case 'thorns': {
        const n = 8 + (lv >= 3 ? 2 : 0) + (lv >= 5 ? 2 : 0) + s.multi * 2, off = this.loops * 0.37;
        for (let k = 0; k < n; k++) this.shoot(off + k / n * TAU, { spd: 9.5, dmg: 8 * L * c.dmg, elem: 'nature', color: col, pierce: 2 + (lv >> 1), size: 0.28 * Math.sqrt(A), life: 0.75 * A, o });
        break;
      }
      case 'wisps': {
        const n = 3 + (lv >= 3) + (lv >= 5) + s.multi;
        for (let k = 0; k < n; k++) this.shoot(rnd(TAU), { spd: 7, dmg: 13 * L * c.dmg, elem: 'arcane', color: 0xd9c4ff, type: 'wisp', life: 3, size: 0.32 * Math.sqrt(A), o });
        break;
      }
      case 'meteor': {
        const n = 1 + (lv >= 4) + s.multi;
        for (let k = 0; k < n; k++) {
          const t = this.randomNear(9); const x = t ? t.x : p.x + rnd(-4, 4), z = t ? t.z : p.z + rnd(-4, 4);
          this.zones.push({ type: 'meteor', x, z, r: 2.1 * (lv >= 5 ? 1.5 : 1) * A, t: 0, dur: 0.65 + k * 0.15, dmg: 42 * (1 + 0.35 * (lv - 1)) * c.dmg, elem: 'fire', color: col, o });
        }
        break;
      }
      case 'lance': {
        const a = this.aimDir(), n = (lv >= 3 ? 3 : 1) + s.multi;
        for (let k = 0; k < n; k++) this.shoot(a + (k - (n - 1) / 2) * 0.22, { spd: 24, dmg: 21 * L * c.dmg, elem: 'frost', color: col, pierce: 99, size: 0.36 * Math.sqrt(A), life: 0.7, long: true, freeze: lv >= 5, o });
        break;
      }
      case 'totem':
        this.turrets.push({ x: p.x, z: p.z, t: (lv >= 5 ? 8 : 5) * D, cd: 0.2, rate: lv >= 3 ? 0.3 : 0.45, dmg: 6.5 * L * c.dmg, range: 6 * Math.sqrt(A), o, color: col });
        if (this.turrets.length > 4) this.turrets.shift();
        break;
      case 'rift': {
        const t = this.randomNear(7); const x = t ? t.x : p.x + p.dx * 3, z = t ? t.z : p.z + p.dz * 3;
        this.zones.push({ type: 'rift', x, z, r: 2.7 * (lv >= 3 ? 1.3 : 1) * A, t: 0, dur: 2.4 * D, tick: 0, dmg: 5 * L * c.dmg, elem: 'void', color: col, implode: lv >= 5, o });
        break;
      }
      case 'hex': {
        const ts = this.nearestN(3 + (lv >= 2) + (lv >= 3 ? 2 : 0) + s.multi, 10);
        for (const e of ts) { e.hexT = 4.5; e.hexMul = lv >= 5 ? 1.6 : 1.4; e.hexDmg = 16 * L * c.dmg; e.hexR = (lv >= 4 ? 2.3 : 1.6) * A; this.hit(e, 5 * L * c.dmg, 'void', o); this.fx.burst(e.x, e.z, col, 4, { up: 1.2 }); }
        break;
      }
      case 'chakram': {
        const a = this.aimDir(), n = 1 + (lv >= 3) + s.multi;
        for (let k = 0; k < n; k++) this.shoot(a + (k - (n - 1) / 2) * 0.5, { spd: 13, dmg: 11 * L * c.dmg, elem: 'steel', color: col, pierce: 99, type: 'chakram', life: 2.2, size: (lv >= 5 ? 0.9 : 0.55) * Math.sqrt(A), o, age: 0, cd: new Map() });
        break;
      }
      case 'wave': {
        const a = this.aimDir(), half = (lv >= 3 ? 0.85 : 0.6), R = 4.6 * A;
        this.fx.cone(p.x, p.z, a, half, R, col);
        for (const e of this.enemies) { if (e.dead) continue; const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz); if (d > R + e.r) continue; let da = Math.atan2(dz, dx) - a; da = Math.atan2(Math.sin(da), Math.cos(da)); if (Math.abs(da) < half) { if (lv >= 5) e.stun = Math.max(e.stun, 0.7); this.hit(e, 19 * L * c.dmg, 'steel', { ...o, kb: 7 }); } }
        this.audio.sfx('wave');
        break;
      }
      case 'spores': {
        const t = this.randomNear(8); const x = t ? t.x : p.x, z = t ? t.z : p.z;
        this.zones.push({ type: 'cloud', x, z, r: 2.1 * (lv >= 3 ? 1.3 : 1) * A, t: 0, dur: (lv >= 5 ? 6 : 4) * D, tick: 0, dmg: 4.5 * L * c.dmg, elem: 'nature', color: col, o });
        break;
      }
      case 'f_starfall': { const n = 10 + s.multi * 2; for (let k = 0; k < n; k++) this.shoot(k / n * TAU + rnd(0.3), { spd: 9, dmg: 24 * c.dmg, elem: 'arcane', color: 0xfff2a8, type: 'wisp', life: 3.5, pierce: 2, size: 0.36 * Math.sqrt(A), o }); break; }
      case 'f_supernova': { const t = this.randomNear(9); this.zones.push({ type: 'meteor', x: t ? t.x : p.x, z: t ? t.z : p.z - 3, r: 3.6 * A, t: 0, dur: 0.75, dmg: 160 * c.dmg, elem: 'fire', color: col, o, nova: true }); break; }
      case 'f_glacier': {
        this.zones.push({ type: 'nova', x: p.x, z: p.z, r: 0, R: 4.6 * A, t: 0, dur: 0.34, dmg: 32 * c.dmg, elem: 'frost', color: col, hit: new Set(), freeze: true, o, follow: true });
        for (let k = 0; k < 8; k++) this.shoot(this.loops * 0.4 + k / 8 * TAU, { spd: 22, dmg: 30 * c.dmg, elem: 'frost', color: col, pierce: 99, size: 0.36 * Math.sqrt(A), life: 0.7, long: true, freeze: true, o });
        break;
      }
      case 'f_tesla': this.storm = { t: 3.2 * D, cd: 0, dmg: 24 * c.dmg, o, r: 7 * Math.sqrt(A) }; break;
      case 'f_halo': {
        this.orbs = { n: 8, t: 3.6, ang: this.orbs ? this.orbs.ang : 0, r: 2.7 * Math.sqrt(A), dmg: 22 * c.dmg, o, color: 0xffffff };
        const a = this.aimDir(); for (let k = 0; k < 2; k++) this.shoot(a + (k - 0.5) * 0.7, { spd: 13, dmg: 20 * c.dmg, elem: 'steel', color: col, pierce: 99, type: 'chakram', life: 2.2, size: 0.8 * Math.sqrt(A), o, age: 0, cd: new Map() });
        break;
      }
      case 'f_bloom': {
        for (let k = 0; k < 14; k++) this.shoot(this.loops * 0.37 + k / 14 * TAU, { spd: 9.5, dmg: 16 * c.dmg, elem: 'nature', color: col, pierce: 5, size: 0.3 * Math.sqrt(A), life: 0.9 * A, o });
        this.zones.push({ type: 'cloud', x: p.x, z: p.z, r: 3.4 * A, t: 0, dur: 3, tick: 0, dmg: 10 * c.dmg, elem: 'nature', color: col, o, follow: true });
        break;
      }
      case 'f_horizon': { const t = this.randomNear(7); this.zones.push({ type: 'rift', x: t ? t.x : p.x + p.dx * 3, z: t ? t.z : p.z + p.dz * 3, r: 4.4 * A, t: 0, dur: 2.8, tick: 0, dmg: 13 * c.dmg, elem: 'void', color: col, implode: true, implodeMul: 10, hexAll: 30 * c.dmg, o }); break; }
      case 'f_thermal': {
        this.zones.push({ type: 'nova', x: p.x, z: p.z, r: 0, R: 4.2 * A, t: 0, dur: 0.3, dmg: 24 * c.dmg, elem: 'frost', color: col, hit: new Set(), o, follow: true });
        this.after(0.34, () => { this.aoe(this.p.x, this.p.z, 4.2 * A, 30 * c.dmg, 'fire', o, 0xff7a3d); this.audio.sfx('boom'); });
        break;
      }
      case 'f_prism': {
        const a = this.aimDir(), w = 0.9 * A, len = 14, cx = Math.cos(a), cz = Math.sin(a); let arcs = 0;
        this.fx.beam(p.x, p.z, p.x + cx * len, p.z + cz * len, col, w * 1.6, 0.28);
        for (const e of this.enemies.slice()) {
          if (e.dead) continue; const dx = e.x - p.x, dz = e.z - p.z, al = dx * cx + dz * cz; if (al < 0 || al > len || Math.abs(dx * cz - dz * cx) > w + e.r) continue;
          this.hit(e, 48 * c.dmg, 'arcane', o);
          if (arcs++ < 6) { let cur = this.nearest(e.x, e.z, 4.5, new Set([e])), px = e.x, pz = e.z; const seen = new Set([e]); for (let j = 0; j < 3 && cur; j++) { seen.add(cur); this.fx.beam(px, pz, cur.x, cur.z, 0xffe14d, 0.12, 0.14); px = cur.x; pz = cur.z; this.hit(cur, 18 * c.dmg, 'volt', o); cur = this.nearest(px, pz, 4.5, seen); } }
        }
        this.audio.sfx('zap'); break;
      }
      case 'f_boom': {
        const R = 6.2 * A; this.fx.ring(p.x, p.z, R * 0.6, 0xffffff, 0.25); this.fx.shake(0.4); this.audio.sfx('wave');
        for (const e of this.enemies) if (!e.dead && (e.x - p.x) ** 2 + (e.z - p.z) ** 2 < (R + e.r) ** 2 && !e.boss) e.stun = Math.max(e.stun, 1);
        this.aoe(p.x, p.z, R, 44 * c.dmg, 'steel', { ...o, kb: 10 }, col);
        break;
      }
      case 'mines': {
        const n = 2 + (lv >= 3) + (lv >= 5) + s.multi;
        for (let k = 0; k < n; k++) { const a = rnd(TAU), d = k ? rnd(0.6, 1.5) : 0; this.dropMine(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, 24 * L * c.dmg, (lv >= 5 ? 2.5 : 2) * A, o); }
        this.mines.forEach(m => { if (m.t === 0) m.life = 12 * D; });
        break;
      }
      case 'wake': this.wake = { t: (lv >= 5 ? 4.2 : 2.8) * D, acc: 1, r: (lv >= 3 ? 1.5 : 1.15) * A, life: 2.4 * D, dmg: 6.5 * L * c.dmg, o }; break;
      case 'decoy': if (this.decoy) this.decoy.t = 0, this.updateSummons(0); this.decoy = { x: p.x, z: p.z, t: (lv >= 3 ? 3.8 : 2.8) * D, dmg: 34 * L * c.dmg, r: (lv >= 5 ? 3.6 : 2.5) * A, o }; this.fx.burst(p.x, p.z, col, 8, { up: 2 }); break;
      case 'dynamo': {
        const R = (lv >= 3 ? 3.3 : 2.6) * A, dm = (7 + this.moved * 3.2) * L * c.dmg; this.moved = 0;
        if (lv >= 5) for (const e of this.enemies) if (!e.dead && !e.boss && (e.x - p.x) ** 2 + (e.z - p.z) ** 2 < (R + e.r) ** 2) e.stun = Math.max(e.stun, 0.5);
        this.aoe(p.x, p.z, R, dm, 'volt', o); this.audio.sfx('zap');
        break;
      }
      case 'siphon': {
        const ts = this.nearestN(2 + (lv >= 3) + (lv >= 5) + s.multi, 8); let healed = 0;
        for (const e of ts) { this.fx.beam(e.x, e.z, p.x, p.z, col, 0.12, 0.2); this.hit(e, 11 * L * c.dmg, 'void', o); healed += lv >= 5 ? 0.8 : 0.5; }
        if (healed) this.heal(Math.min(1.5, healed));
        break;
      }
      case 'roots': {
        const R = (lv >= 3 ? 4 : 3.2) * A, hold = (lv >= 4 ? 1.7 : 1.1) * Math.sqrt(D);
        this.fx.ring(p.x, p.z, R, col, 0.35);
        for (const e of this.enemies) if (!e.dead && (e.x - p.x) ** 2 + (e.z - p.z) ** 2 < (R + e.r) ** 2) { e.stun = Math.max(e.stun, e.boss ? 0.25 : hold); this.hit(e, 7.5 * L * c.dmg, 'nature', o); }
        break;
      }
      case 'aegis': {
        this.aegisMax = 1 + (lv >= 3) + (lv >= 5);
        if (this.time - (this.aegisAt || -99) >= (lv >= 4 ? 7 : 10) && this.shield < this.aegisMax) { this.aegisAt = this.time; this.shield++; this.fx.ring(p.x, p.z, 1.6, 0xffffff, 0.3); }
        this.aoe(p.x, p.z, 2.5 * A, 10 * L * c.dmg, 'steel', { ...o, kb: 2 });
        break;
      }
      case 'hound': {
        const cap = 2 + (lv >= 5) + s.multi; if (this.pets.length >= cap) this.pets.shift();
        this.pets.push({ x: p.x, z: p.z, t: (lv >= 3 ? 7.5 : 5.5) * D, dmg: 10 * L * c.dmg, cd: 0, o, a: 0 });
        break;
      }
      case 'f_pack': {
        this.pets = this.pets.slice(-2); for (let k = 0; k < 3; k++) this.pets.push({ x: p.x + rnd(-1, 1), z: p.z + rnd(-1, 1), t: 5 * D, dmg: 24 * c.dmg, cd: k * 0.1, o, a: 0, big: true });
        if (!this.decoy) this.decoy = { x: p.x, z: p.z, t: 3 * D, dmg: 60 * c.dmg, r: 3.4 * A, o };
        break;
      }
      case 'f_jugger': {
        this.jugger = { t: 3 * D, dmg: 42 * c.dmg, cd: 0, r: 1.9 * Math.sqrt(A), o }; this.moved = 0;
        this.aegisMax = Math.max(this.aegisMax, 3); if (this.time - (this.aegisAt || -99) >= 6 && this.shield < this.aegisMax) { this.aegisAt = this.time; this.shield++; }
        break;
      }
      case 'f_parasite': {
        const R = 4.6 * A; let n = 0; this.fx.ring(p.x, p.z, R, col, 0.4);
        for (const e of this.enemies) if (!e.dead && (e.x - p.x) ** 2 + (e.z - p.z) ** 2 < (R + e.r) ** 2) { e.stun = Math.max(e.stun, e.boss ? 0.3 : 1.6); this.hit(e, 38 * c.dmg, 'nature', o); n++; }
        if (n) this.heal(Math.min(4, 0.5 + n * 0.35));
        break;
      }
      case 'f_lane': this.wake = { t: 3.4 * D, acc: 1, r: 1.6 * A, life: 2.8 * D, dmg: 13 * c.dmg, o, fire: true }; break;
      case 'beam': {
        const a = this.aimDir(), w = 0.45 * (lv >= 3 ? 1.6 : 1) * A, len = 13;
        const go = () => {
          const cx = Math.cos(a), cz = Math.sin(a); this.fx.beam(p.x, p.z, p.x + cx * len, p.z + cz * len, col, w * 1.6, 0.22);
          for (const e of this.enemies) { if (e.dead) continue; const dx = e.x - p.x, dz = e.z - p.z, al = dx * cx + dz * cz; if (al < 0 || al > len) continue; if (Math.abs(dx * cz - dz * cx) < w + e.r) this.hit(e, 19 * L * c.dmg, 'arcane', o); }
        };
        go(); if (lv >= 5) this.after(0.15, go);
        this.audio.sfx('zap');
        break;
      }
    }
  }

  // ---------- damage ----------
  hit(e, base, elem, o = {}) {
    if (e.dead) return;
    const s = this.s;
    if (o.elem && !o.dot) elem = o.elem;
    let d = base * s.dmg * this.dyn * (s.elem[elem] || 1) * (1 + this.cresc * this.crescPct);
    if (s.execute && e.hp < e.maxHp * 0.5) d *= 1 + s.execute;
    if (s.hunter && (e.elite || e.boss)) d *= 1.5;
    if (s.goldDmg) d *= 1 + 0.04 * Math.floor(this.gold / 100);
    const crit = !o.dot && (o.crit || Math.random() < s.crit);
    if (crit) d *= s.critMul + (o.critBonus || 0);
    if (e.shockT > 0) d *= 1.25;
    if (e.hexT > 0) d *= e.hexMul;
    if (s.frostbite && e.chillT > 0) d *= 1.35;
    if (!o.noReact && !o.dot) {
      const rm = s.reactMul;
      if (elem === 'fire' && e.chillT > 0) { e.chillT = 0; this.react(e, 0x9ff3ff, 'SHATTER'); this.aoe(e.x, e.z, 2, base * 1.6 * rm, 'steel', { noReact: true }, 0x9ff3ff); }
      else if (elem === 'volt' && e.burnT > 0) { e.burnT = 0; this.react(e, 0xffb347, 'OVERLOAD'); this.aoe(e.x, e.z, 2.2, base * 1.4 * rm, 'fire', { noReact: true }, 0xffb347); }
      else if (elem === 'frost' && e.shockT > 0) { e.shockT = 0; this.react(e, 0xffffff, 'DEEP FREEZE'); e.stun = Math.max(e.stun, e.boss ? 0.5 : 1.6); d += base * s.dmg * 1.2 * rm; }
      else if (elem === 'void' && e.psnT > 0) { this.react(e, 0xc77dff, 'BLIGHT'); const ps = e.psn * 1.5 * rm; for (const q of this.enemies) if (!q.dead && q !== e && (q.x - e.x) ** 2 + (q.z - e.z) ** 2 < 9) { q.psn = Math.max(q.psn, ps); q.psnT = 4; } d += base * s.dmg * 0.8 * rm; }
      if (elem === 'fire') { e.burnT = 3; e.burn = Math.max(e.burn, base * 0.3); }
      else if (elem === 'frost') e.chillT = 2.5 * s.chillDur;
      else if (elem === 'volt') e.shockT = 3;
      else if (elem === 'nature') { e.psnT = 4; e.psn = Math.min(base * 2, e.psn + base * 0.2); }
    }
    if (o.kb && !e.boss) { const dx = e.x - this.p.x, dz = e.z - this.p.z, l = Math.hypot(dx, dz) || 1, k = o.kb / (e.k.scale || 1); e.kx += dx / l * k; e.kz += dz / l * k; }
    e.hp -= d; e.flash = 0.07;
    if (!o.dot) { this.fx.num(e.x, e.z, d, crit ? 0xffe14d : ELEM[elem].c, crit); this.audio.sfx(crit ? 'crit' : 'hit'); }
    if (e.hp <= 0) { this.kill(e); if (o.pop && !o.noReact) { const x = e.x, z = e.z, pd = base * o.pop; this.after(0.04, () => this.aoe(x, z, 1.5 + o.pop, pd, elem, { noReact: true })); } }
  }
  react(e, color, name) { this.c.reactions++; if (this.s.chem && this.chemT <= 0) { this.chemT = 0.4; this.heal(1); } if (!this.seenReact[name]) { this.seenReact[name] = 1; this.toast(name + '!', color); } this.fx.ring(e.x, e.z, 1.8, color, 0.3); this.fx.burst(e.x, e.z, color, 5, { spd: 4 }); this.audio.sfx('react'); }
  aoe(x, z, r, dmg, elem, o = {}, color) {
    this.fx.ring(x, z, r, color || ELEM[elem].c, 0.28);
    for (const e of this.enemies) { if (!e.dead && (e.x - x) ** 2 + (e.z - z) ** 2 < (r + e.r) ** 2) this.hit(e, dmg, elem, o); }
  }
  kill(e) {
    if (e.dead) return;
    e.dead = true; this.kills++; this.combo++; this.comboT = 2.5; if (this.combo > this.c.maxCombo) this.c.maxCombo = this.combo;
    const s = this.s, st = this.stage;
    if (this.dropT <= 0 && this.drop < 100) { this.drop = Math.min(100, this.drop + (0.75 + Math.min(1.5, this.combo * 0.01)) * s.dropGain * (e.elite ? 8 : 1)); if (this.drop >= 100) { this.toast('DROP READY!', 0xff5ccd); this.audio.sfx('chest'); } }
    this.fx.burst(e.x, e.z, e.color || 0xffffff, e.boss ? 60 : e.elite ? 20 : 4, { spd: e.boss ? 8 : 3.5 });
    this.audio.sfx('kill');
    if (s.leech && Math.random() < s.leech) this.heal(2);
    if (e.hexT > 0) this.after(0.05, () => this.aoe(e.x, e.z, e.hexR, e.hexDmg, 'void', { noReact: true }));
    if (s.liveWire && e.shockT > 0) { const q = this.nearest(e.x, e.z, 4, new Set([e])); if (q) { this.fx.beam(e.x, e.z, q.x, q.z, 0xffe14d, 0.12, 0.12); this.after(0.03, () => this.hit(q, 14, 'volt', { noReact: true })); } }
    if (e.k.split) for (let k = 0; k < 2; k++) this.spawn(e.k.split, e.x + rnd(-0.4, 0.4), e.z + rnd(-0.4, 0.4));
    if (e.boss) return this.bossDown(e);
    this.pickups.push({ type: 'xp', x: e.x, z: e.z, v: e.k.xp * (e.elite ? 10 : 1), t: 0 });
    if (Math.random() < 0.11) this.pickups.push({ type: 'gold', x: e.x + rnd(-0.3, 0.3), z: e.z + rnd(-0.3, 0.3), v: Math.ceil(rnd(1, 3) * (1 + Math.min(st.n, 6) * 0.12)), t: 0 });
    if (Math.random() < 0.006) this.pickups.push({ type: 'heart', x: e.x, z: e.z, v: 20, t: 0 });
    if (Math.random() < 0.0015) this.pickups.push({ type: 'magnet', x: e.x, z: e.z, v: 0, t: 0 });
    if (e.elite) { this.pickups.push({ type: 'chest', x: e.x, z: e.z, v: 0, t: 0 }); for (let k = 0; k < 6; k++) this.pickups.push({ type: 'gold', x: e.x + rnd(-1, 1), z: e.z + rnd(-1, 1), v: 3, t: 0 }); this.fx.shake(0.3); }
    if (this.pickups.length > 420) { const g = this.pickups.find(g => g.type === 'xp'); if (g) { const h = this.pickups.find(q => q.type === 'xp' && q !== g); if (h) { h.v += g.v; this.pickups.splice(this.pickups.indexOf(g), 1); } } }
  }
  bossDown(e) {
    const st = this.stage;
    st.bossDone = true; st.boss = null; st.arena = null; this.c.bossKills++; this.c.cleared = Math.max(this.c.cleared, st.n + 1);
    if (!st.hit) this.c.noHitStage = true;
    this.fx.shake(1); this.fx.flash(0xffffff, 0.8); this.fx.hitstop(0.25); this.audio.sfx('bossDie');
    for (const q of this.enemies) if (!q.dead && !q.boss) { q.dead = true; this.fx.burst(q.x, q.z, q.color, 5, {}); this.pickups.push({ type: 'xp', x: q.x, z: q.z, v: q.k.xp, t: 0 }); }
    this.purge = true;
    for (let k = 0; k < 14; k++) this.pickups.push({ type: 'gold', x: e.x + rnd(-2, 2), z: e.z + rnd(-2, 2), v: 4, t: 0 });
    for (let k = 0; k < 10; k++) this.pickups.push({ type: 'xp', x: e.x + rnd(-2, 2), z: e.z + rnd(-2, 2), v: 4 + st.n * 2, t: 0 });
    this.pending.push('relic');
    if (this.s.cheque) { const g = Math.min(60, Math.floor(this.gold * 0.15)); if (g > 0) { this.gold += g; this.toast('+' + g + ' INTEREST', 0xffcd75); } }
    this.heal(this.s.maxHp * TUNE.bossHeal);
    this.state = 'clear'; st.clearT = 2.4;
    this.toast('STAGE CLEAR', 0xffcd75);
  }
  heal(v) { const p = this.p; if (p.hp <= 0) return; p.hp = Math.min(this.s.maxHp, p.hp + v); }
  hurt(dmg) {
    const p = this.p, s = this.s;
    if (p.inv > 0 || this.state !== 'play') return;
    if (this.shield > 0) { // a shield eats the hit and bursts
      this.shield--; this.c.blocks++; p.inv = TUNE.iframes; this.fx.ring(p.x, p.z, 3, 0xffffff, 0.3); this.fx.shake(0.25); this.audio.sfx('crit'); this.fx.haptic(15);
      this.aoe(p.x, p.z, 3, 18 + this.level, 'steel', { kb: 6, noReact: true }, 0xd8e4f0); return;
    }
    // armour is a percentage with diminishing returns, so it can never make hits meaningless
    const d = Math.max(1, Math.round(dmg * TUNE.armorK / (TUNE.armorK + s.armor)));
    p.hp -= d; p.inv = TUNE.iframes; p.hurt = 0.3; this.stage.hit = true; this.cresc = 0; this.c.dmgTaken += d;
    this.fx.shake(0.45); this.fx.flash(0xff2040, 0.35); this.fx.hitstop(0.07); this.audio.sfx('hurt'); this.fx.haptic(40);
    if (s.feedback) this.aoe(p.x, p.z, 3.2 * s.area, 30, 'steel', { kb: 6 }, 0xff5ccd);
    if (p.hp <= 0) {
      if (this.revivesUsed < s.revives) { this.revivesUsed++; p.hp = Math.round(s.maxHp * 0.5); p.inv = 2.5; this.aoe(p.x, p.z, 7, 80, 'fire', { kb: 9 }, 0xffcd75); this.fx.flash(0xffcd75, 0.8); this.toast('REVIVED!', 0xffcd75); this.audio.sfx('levelup'); }
      else { p.hp = 0; this.state = 'dead'; this.fx.shake(1); this.fx.burst(p.x, p.z, 0xff5ccd, 40, { spd: 7 }); this.audio.sfx('die'); }
    }
  }
  useDrop() {
    if (this.drop < 100 || this.dropT > 0 || this.state !== 'play') return;
    this.drop = 0; this.dropT = this.s.dropDur; this.c.drops++;
    this.fx.flash(0xffffff, 0.5); this.fx.shake(0.8); this.fx.ring(this.p.x, this.p.z, 9, 0xff5ccd, 0.5); this.audio.sfx('drop'); this.fx.haptic(80);
    for (const e of this.enemies) { const dx = e.x - this.p.x, dz = e.z - this.p.z, d = Math.hypot(dx, dz); if (d < 9) { if (!e.boss) { e.kx += dx / d * 9; e.kz += dz / d * 9; e.stun = Math.max(e.stun, 0.6); } this.hit(e, 20 + this.level * 2, 'steel', { noReact: true }); } }
    this.bullets.length = 0;
    for (const g of this.pickups) if (g.type !== 'chest') g.pull = true;
    this.toast('DROP!', 0xff5ccd);
    if (this.s.bassCannon) { let k = 0; for (let i = 0; i < this.size; i++) { const w = this.wheel[i]; if (w && RUNES[w.id].type === 'spell') this.after(0.08 * k++, () => this.cast(w.id, w.lvl, { dmg: 1, area: this.s.area, dur: this.s.dur, crit: false, critBonus: 0 })); } }
  }
  // ---------- mines, decoys, hounds, juggernaut ----------
  updateSummons(dt) {
    const p = this.p;
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i]; m.t += dt;
      let boom = m.t > m.life;
      if (!boom && m.t > 0.35) for (const e of this.enemies) if (!e.dead && (e.x - m.x) ** 2 + (e.z - m.z) ** 2 < (0.8 + e.r) ** 2) { boom = true; break; }
      if (boom) { this.mines.splice(i, 1); if (m.t <= m.life) { this.aoe(m.x, m.z, m.r, m.dmg, 'fire', m.o); this.fx.burst(m.x, m.z, 0xff7a3d, 6, { spd: 5 }); this.audio.sfx('boom'); } }
    }
    const dc = this.decoy;
    if (dc) { dc.t -= dt; if (dc.t <= 0) { this.decoy = null; this.aoe(dc.x, dc.z, dc.r, dc.dmg, 'arcane', dc.o); this.fx.burst(dc.x, dc.z, 0xb48cff, 14, { spd: 6 }); this.audio.sfx('boom'); } }
    for (let i = this.pets.length - 1; i >= 0; i--) {
      const h = this.pets[i]; h.t -= dt; h.cd -= dt; h.a += dt;
      if (h.t <= 0) { this.pets.splice(i, 1); this.fx.burst(h.x, h.z, 0xe04dff, 4, {}); continue; }
      const e = this.nearest(h.x, h.z, 14);
      const tx = e ? e.x : p.x + Math.cos(h.a * 2 + i * 2) * 1.5, tz = e ? e.z : p.z + Math.sin(h.a * 2 + i * 2) * 1.5, dx = tx - h.x, dz = tz - h.z, d = Math.hypot(dx, dz) || 1;
      if (d > 0.6) { const sp = Math.min(d / dt, 8.5); h.x += dx / d * sp * dt; h.z += dz / d * sp * dt; h.fx = dx > 0 ? 1 : -1; }
      if (e && d < 0.9 + e.r && h.cd <= 0) { h.cd = 0.38; this.hit(e, h.dmg, 'void', h.o); }
      if ((h.x - p.x) ** 2 + (h.z - p.z) ** 2 > 400) { h.x = p.x; h.z = p.z; }
    }
    const j = this.jugger;
    if (j && j.t > 0) { j.t -= dt; j.cd -= dt; if (j.cd <= 0) { j.cd = 0.22; const bonus = 1 + Math.min(1, this.moved / 6); this.moved = 0; for (const e of this.enemies) if (!e.dead && (e.x - p.x) ** 2 + (e.z - p.z) ** 2 < (j.r + e.r) ** 2) this.hit(e, j.dmg * bonus, 'steel', { ...j.o, kb: 4 }); } }
  }

  // ---------- projectiles & zones ----------
  updateOrbs(dt) {
    const ob = this.orbs; if (!ob || ob.t <= 0) return;
    ob.t -= dt; ob.ang += dt * 5.5;
    const p = this.p;
    for (let k = 0; k < ob.n; k++) {
      const a = ob.ang + k / ob.n * TAU, x = p.x + Math.cos(a) * ob.r, z = p.z + Math.sin(a) * ob.r;
      for (const e of this.enemies) { if (e.dead || e.orbCd > 0) continue; if ((e.x - x) ** 2 + (e.z - z) ** 2 < (0.55 + e.r) ** 2) { e.orbCd = 0.3; this.hit(e, ob.dmg, 'steel', { ...ob.o, kb: 1.5 }); } }
    }
  }
  updateTurrets(dt) {
    const sm = this.storm;
    if (sm && sm.t > 0) {
      sm.t -= dt; sm.cd -= dt;
      if (sm.cd <= 0) { sm.cd = 0.1; const p = this.p, e = this.randomNear(sm.r); if (e) { this.fx.beam(p.x, p.z, e.x, e.z, 0xffe14d, 0.13, 0.12); this.hit(e, sm.dmg, 'volt', sm.o); const q = this.nearest(e.x, e.z, 4.5, new Set([e])); if (q) { this.fx.beam(e.x, e.z, q.x, q.z, 0xffe14d, 0.1, 0.12); this.hit(q, sm.dmg * 0.8, 'volt', sm.o); } this.audio.sfx('zap'); } }
    }
    for (let i = this.turrets.length - 1; i >= 0; i--) {
      const t = this.turrets[i]; t.t -= dt; t.cd -= dt;
      if (t.t <= 0) { this.turrets.splice(i, 1); continue; }
      if (t.cd <= 0) { t.cd = t.rate; const e = this.nearest(t.x, t.z, t.range); if (e) { this.fx.beam(t.x, t.z, e.x, e.z, t.color, 0.1, 0.1, 1.1); this.hit(e, t.dmg, 'volt', t.o); } }
    }
  }
  updateShots(dt) {
    const p = this.p;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const sh = this.shots[i]; sh.life -= dt;
      if (sh.type === 'wisp') {
        const t = this.nearest(sh.x, sh.z, 12, sh.hit);
        if (t) { const a = Math.atan2(t.z - sh.z, t.x - sh.x); sh.vx += Math.cos(a) * 40 * dt; sh.vz += Math.sin(a) * 40 * dt; const v = Math.hypot(sh.vx, sh.vz); if (v > 10) { sh.vx *= 10 / v; sh.vz *= 10 / v; } }
      } else if (sh.type === 'chakram') {
        sh.age += dt;
        if (sh.age > 0.45) { const dx = p.x - sh.x, dz = p.z - sh.z, d = Math.hypot(dx, dz) || 1; sh.vx += dx / d * 45 * dt; sh.vz += dz / d * 45 * dt; const v = Math.hypot(sh.vx, sh.vz); if (v > 15) { sh.vx *= 15 / v; sh.vz *= 15 / v; } if (d < 0.7 && sh.age > 0.8) sh.life = 0; }
        for (const [e, t] of sh.cd) { if (t - dt <= 0) sh.cd.delete(e); else sh.cd.set(e, t - dt); }
      }
      sh.x += sh.vx * dt; sh.z += sh.vz * dt;
      let gone = sh.life <= 0;
      if (!gone) for (const e of this.enemies) {
        if (e.dead) continue;
        const rr = sh.r + e.r; if ((e.x - sh.x) ** 2 + (e.z - sh.z) ** 2 > rr * rr) continue;
        if (sh.type === 'chakram') { if (sh.cd.has(e)) continue; sh.cd.set(e, 0.35); this.hit(e, sh.dmg, sh.elem, sh.o); continue; }
        if (sh.hit.has(e)) continue;
        sh.hit.add(e);
        if (sh.type === 'fireball') { gone = true; break; }
        if (sh.freeze) e.stun = Math.max(e.stun, e.boss ? 0.3 : 1);
        this.hit(e, sh.dmg, sh.elem, sh.o);
        if (sh.pierce-- <= 0) { gone = true; break; }
      }
      if (gone) {
        if (sh.type === 'fireball') { this.aoe(sh.x, sh.z, sh.aoe, sh.dmg, 'fire', sh.o); this.fx.burst(sh.x, sh.z, 0xff7a3d, 7, { spd: 5 }); this.audio.sfx('boom'); if (sh.ground) this.zones.push({ type: 'cloud', x: sh.x, z: sh.z, r: sh.aoe * 0.8, t: 0, dur: 2.5, tick: 0, dmg: sh.dmg * 0.22, elem: 'fire', color: 0xff7a3d, o: sh.o }); }
        else this.fx.burst(sh.x, sh.z, sh.color, 2, { spd: 2 });
        this.shots.splice(i, 1);
      }
    }
  }
  updateZones(dt) {
    const p = this.p;
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i]; if (!z) continue; z.t += dt;
      const done = z.t >= z.dur;
      switch (z.type) {
        case 'nova':
          if (z.follow) { z.x = p.x; z.z = p.z; }
          z.r = z.R * Math.min(1, z.t / z.dur);
          for (const e of this.enemies) { if (e.dead || z.hit.has(e)) continue; if ((e.x - z.x) ** 2 + (e.z - z.z) ** 2 < (z.r + e.r) ** 2) { z.hit.add(e); if (z.freeze) e.stun = Math.max(e.stun, e.boss ? 0.3 : 1.1); this.hit(e, z.dmg, z.elem, { ...z.o, kb: 1.5 }); } }
          break;
        case 'rift': case 'cloud':
          z.tick -= dt;
          if (z.follow) { z.x = p.x; z.z = p.z; }
          if (z.type === 'rift') for (const e of this.enemies) { if (e.dead || e.boss) continue; const dx = z.x - e.x, dz = z.z - e.z, d = Math.hypot(dx, dz); if (d < z.r * 1.5 && d > 0.2) { const f = 5.5 * dt / (e.k.scale || 1); e.x += dx / d * f; e.z += dz / d * f; } }
          if (z.tick <= 0) { z.tick = z.type === 'rift' ? 0.25 : 0.4; for (const e of this.enemies) if (!e.dead && (e.x - z.x) ** 2 + (e.z - z.z) ** 2 < (z.r + e.r) ** 2) { if (z.hexAll) { e.hexT = 2; e.hexMul = 1.5; e.hexDmg = z.hexAll; e.hexR = 1.8; } this.hit(e, z.dmg, z.elem, { ...z.o, crit: false }); } }
          if (done && z.implode) this.aoe(z.x, z.z, z.r, z.dmg * (z.implodeMul || 6), 'void', z.o);
          break;
        case 'meteor':
          if (done) { this.aoe(z.x, z.z, z.r, z.dmg, 'fire', z.o); this.fx.burst(z.x, z.z, 0xff7a3d, 16, { spd: 7 }); this.fx.shake(0.35); this.audio.sfx('boom'); if (z.nova) { for (let k = 0; k < 8; k++) this.shoot(k / 8 * TAU, { x: z.x, z: z.z, spd: 8, dmg: z.dmg * 0.3, elem: 'fire', color: 0xff7a3d, size: 0.5, type: 'fireball', aoe: 1.9, o: z.o, life: 0.6 }); this.zones.push({ type: 'cloud', x: z.x, z: z.z, r: z.r * 0.8, t: 0, dur: 3, tick: 0, dmg: z.dmg * 0.08, elem: 'fire', color: 0xff7a3d, o: z.o }); } }
          break;
        case 'hazard':
          if (done) { if ((p.x - z.x) ** 2 + (p.z - z.z) ** 2 < z.r * z.r) this.hurt(z.dmg); this.fx.ring(z.x, z.z, z.r, 0xff3050, 0.25); this.fx.burst(z.x, z.z, 0xff3050, 10, { spd: 5 }); }
          break;
      }
      if (done) this.zones.splice(i, 1);
    }
  }
  updateBullets(dt) {
    const p = this.p;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i]; if (!b) continue; b.x += b.vx * dt; b.z += b.vz * dt; b.life -= dt;
      if (b.life <= 0) { this.bullets.splice(i, 1); continue; }
      if ((b.x - p.x) ** 2 + (b.z - p.z) ** 2 < 0.2) { if (p.inv <= 0) { this.hurt(b.dmg); this.bullets.splice(i, 1); } }
    }
  }
  ebullet(x, z, a, spd, dmg) { if (this.bullets.length < 260) this.bullets.push({ x, z, vx: Math.cos(a) * spd, vz: Math.sin(a) * spd, dmg: dmg * this.eDmg, life: 6 }); }
  updatePickups(dt) {
    const p = this.p, s = this.s, mr = 2.3 * s.magnet;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const g = this.pickups[i]; g.t += dt;
      const dx = p.x - g.x, dz = p.z - g.z, d = Math.hypot(dx, dz);
      if (!g.pull && d < (g.type === 'chest' ? 1.2 : mr)) g.pull = true;
      if (g.pull) { g.sp = Math.min(22, (g.sp || 5) + 40 * dt); g.x += dx / (d || 1) * g.sp * dt; g.z += dz / (d || 1) * g.sp * dt; }
      if (d < 0.6) {
        this.pickups.splice(i, 1);
        if (g.type === 'xp') { this.gainXp(g.v); this.audio.sfx('gem'); if (s.gemShot && Math.random() < 0.25) { const t = this.nearest(p.x, p.z, 11); if (t) this.shoot(t, { spd: 16, dmg: 9 + this.level * 0.5, elem: 'arcane', size: 0.3, color: 0xffcd75 }); } }
        else if (g.type === 'gold') { this.gold += Math.ceil(g.v * s.goldMul * this.stage.goldMul); this.audio.sfx('coin'); }
        else if (g.type === 'heart') { this.heal(g.v); this.fx.burst(p.x, p.z, 0xff5c7a, 8, { up: 2 }); this.audio.sfx('heal'); }
        else if (g.type === 'magnet') { for (const q of this.pickups) if (q.type !== 'chest') q.pull = true; this.audio.sfx('heal'); }
        else if (g.type === 'chest') { this.pending.push('relic'); this.audio.sfx('chest'); }
      } else if (d > 40 && g.type !== 'chest') this.pickups.splice(i, 1);
    }
  }
  gainXp(v) {
    this.xp += v * this.s.xpMul * this.stage.xpMul;
    while (this.xp >= xpNeed(this.level)) { this.xp -= xpNeed(this.level); this.level++; this.pending.push('level'); }
  }

  // ---------- enemies ----------
  spawn(kind, x, z, o = {}) {
    const k = ENEMIES[kind], st = this.stage;
    const tm = 1 + 0.6 * Math.min(1, st.t / st.dur);
    const e = { k, x, z, hp: k.hp * this.eHp * tm * (o.hp || 1), r: k.r * (o.size || 1), spd: Math.min(k.spd * this.eSpd, TUNE.spdCap) * rnd(0.92, 1.08), dmg: k.dmg * this.eDmg, t: rnd(10), flash: 0, kx: 0, kz: 0, burnT: 0, burn: 0, chillT: 0, shockT: 0, psn: 0, psnT: 0, hexT: 0, stun: 0, orbCd: 0, dotT: 0, cd: rnd(1, 3), mode: 0, mt: 0, y: 0, color: o.color || st.biome.tint, scale: (k.scale || 1) * (o.size || 1), elite: !!o.elite, spr: k.spr };
    e.maxHp = e.hp; this.enemies.push(e); return e;
  }
  spawnPos(r = 17) { const a = rnd(TAU), p = this.p; return [p.x + Math.cos(a) * r * 0.8 + p.dx * 2, p.z + Math.sin(a) * r * 1.15 + p.dz * 2]; }
  spawnRoster(prog) {
    const ros = this.stage.biome.roster.filter(r => r[1] <= prog); const [kind] = pick(ros); const [x, z] = this.spawnPos(); this.spawn(kind, x, z);
  }
  spawnElite(prog) {
    const ros = this.stage.biome.roster.filter(r => r[1] <= prog && ENEMIES[r[0]].ai !== 'bomb'); const [kind] = pick(ros); const [x, z] = this.spawnPos(15);
    this.spawn(kind, x, z, { hp: 9 + this.stage.n, size: 1.6, color: 0xffd24d, elite: true }); this.toast('ELITE!', 0xffd24d); this.audio.sfx('warn');
  }
  spawnEvent() {
    const p = this.p, n = 10 + this.stage.n * 3, kind = this.stage.biome.roster[0][0];
    if (Math.random() < 0.5) { for (let k = 0; k < n; k++) { const a = k / n * TAU; this.spawn('bat', p.x + Math.cos(a) * 15, p.z + Math.sin(a) * 15); } }
    else { const a = rnd(TAU), cx = Math.cos(a), cz = Math.sin(a); for (let k = 0; k < n; k++) this.spawn(kind, p.x + cx * 16 - cz * (k - n / 2) * 0.9, p.z + cz * 16 + cx * (k - n / 2) * 0.9); }
    this.audio.sfx('warn');
  }
  spawnBoss() {
    const st = this.stage, b = st.biome, n = st.n, p = this.p;
    const e = this.spawn('golem', p.x, p.z - 9, { color: 0xffffff });
    e.boss = true; e.bt = b.boss; e.spr = b.bossSpr; e.scale = 1; e.r = 1.25; e.name = b.bossName + (n >= 5 ? ' ' + 'I'.repeat(Math.min(3, Math.floor(n / 5))) + '+' : '');
    e.hp = e.maxHp = 620 * Math.pow(2.05, n) * this.late * (1 + 0.42 * this.volume) * st.hpMul; e.spd = 2.3; e.dmg = 18 * this.eDmg; e.seqI = 0; e.mt = 0; e.mode = 'intro'; e.ang = 0; e.color = b.acc;
    e.seq = { slammer: ['walk', 'jump'], caster: ['spiral', 'fan', 'rest', 'summon'], charger: ['aim', 'dash', 'rest'], slamcaster: ['walk', 'jump', 'jump', 'spiral', 'fan'], conductor: ['spiral', 'fan', 'jump', 'jump', 'aim', 'dash', 'aim', 'dash', 'rain', 'summon'] }[e.bt];
    st.arena = { x: p.x, z: p.z - 2, r: 10.5 };
    this.spot = null;
    st.boss = e; this.toast(e.name, 0xff3050); this.audio.sfx('boss'); this.fx.shake(0.6); this.fx.flash(0xff3050, 0.4);
  }
  bossAI(e, dt) {
    const p = this.p, n = this.stage.n, ph2 = e.hp < e.maxHp * 0.5;
    dt *= (ph2 ? 1.3 : 1) * (this.volume >= 8 ? 1.2 : 1);
    const dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz) || 1;
    e.mt += dt;
    const ar = this.stage.arena;
    if (ar && e.mode !== 'jump') { const ax = e.x - ar.x, az = e.z - ar.z, ad = Math.hypot(ax, az); if (ad > ar.r) { e.x = ar.x + ax / ad * ar.r; e.z = ar.z + az / ad * ar.r; if (e.mode === 'dash') e.mt = 9; } }
    const next = () => { e.seqI = (e.seqI + 1) % e.seq.length; e.mode = e.seq[e.seqI]; e.mt = 0; e.sub = 0; };
    const ring = (cnt, spd, off = 0) => { for (let k = 0; k < cnt; k++) this.ebullet(e.x, e.z, off + k / cnt * TAU, spd, 11); };
    switch (e.mode) {
      case 'intro': if (e.mt > 1.2) { e.mode = e.seq[0]; e.mt = 0; e.sub = 0; } break;
      case 'walk': e.x += dx / d * e.spd * dt; e.z += dz / d * e.spd * dt; if (e.mt > 1.5) next(); break;
      case 'rest': if (e.mt > 1.1) next(); break;
      case 'jump': {
        if (!e.sub) { e.sub = 1; e.jx = e.x; e.jz = e.z; e.tx = p.x; e.tz = p.z; this.zones.push({ type: 'hazard', enemy: true, x: e.tx, z: e.tz, r: 2.4, t: 0, dur: 0.85, dmg: e.dmg * 1.3 }); }
        const q = Math.min(1, e.mt / 0.85); e.x = e.jx + (e.tx - e.jx) * q; e.z = e.jz + (e.tz - e.jz) * q; e.y = Math.sin(q * Math.PI) * 3.5;
        if (q >= 1) { e.y = 0; this.fx.shake(0.5); this.audio.sfx('boom'); ring(10 + Math.min(8, n * 2), 4.6, rnd(1)); if (ph2) this.after(0.35, () => !e.dead && ring(10, 3.3, rnd(1))); next(); }
        break;
      }
      case 'spiral': {
        const want = 6.5; const mv = d > want + 1 ? 1 : d < want - 1 ? -1 : 0; e.x += dx / d * e.spd * mv * dt; e.z += dz / d * e.spd * mv * dt;
        e.sub = (e.sub || 0) - dt;
        if (e.sub <= 0) { e.sub = 0.2; e.ang += 0.42; this.ebullet(e.x, e.z, e.ang, 4.4, 10); if (ph2) this.ebullet(e.x, e.z, e.ang + Math.PI, 4.4, 10); if (n >= 4) this.ebullet(e.x, e.z, -e.ang * 1.3, 3.6, 10); }
        if (e.mt > 4) next();
        break;
      }
      case 'fan': if (e.mt > 0.4) { const a = Math.atan2(dz, dx); for (let k = -2; k <= 2; k++) this.ebullet(e.x, e.z, a + k * 0.2, 6.2, 11); this.audio.sfx('eshoot'); if (ph2) this.after(0.3, () => { if (!e.dead) for (let k = -3; k <= 3; k++) this.ebullet(e.x, e.z, a + k * 0.16 + 0.08, 5.2, 11); }); next(); } break;
      case 'summon': if (e.mt > 0.5) { for (let k = 0; k < 4 + Math.min(4, n); k++) { const a = rnd(TAU); this.spawn(k % 2 ? 'bat' : this.stage.biome.roster[0][0], e.x + Math.cos(a) * 2, e.z + Math.sin(a) * 2); } this.fx.ring(e.x, e.z, 2.5, e.color, 0.4); next(); } break;
      case 'aim': {
        if (!e.sub) { e.sub = 1; e.ca = Math.atan2(dz, dx); e.line = { a: e.ca, len: 13 }; }
        if (e.mt < 0.45) { e.ca = Math.atan2(dz, dx); e.line.a = e.ca; }
        if (e.mt > (ph2 ? 0.65 : 0.9)) { next(); }
        break;
      }
      case 'dash': {
        e.line = null; e.x += Math.cos(e.ca) * 19 * dt; e.z += Math.sin(e.ca) * 19 * dt;
        if (Math.random() < 0.5) this.fx.burst(e.x, e.z, e.color, 1, { spd: 1 });
        if (e.mt > 0.62) { ring(8 + Math.min(6, n), 4.2, rnd(1)); this.fx.shake(0.3); next(); }
        break;
      }
      case 'rain': {
        e.sub = (e.sub || 0) - dt;
        if (e.sub <= 0) { e.sub = 0.3; this.zones.push({ type: 'hazard', enemy: true, x: p.x + p.dx * (p.moving ? 1.5 : 0) + rnd(-1, 1), z: p.z + p.dz * (p.moving ? 1.5 : 0) + rnd(-1, 1), r: 1.9, t: 0, dur: 0.9, dmg: e.dmg }); }
        if (e.mt > 2.6) next();
        break;
      }
    }
    if (e.mode !== 'aim') e.line = null;
    if (e.y < 0.5 && d < e.r + 0.35) this.hurt(e.dmg);
  }
  updateEnemies(dt) {
    const p = this.p, es = this.enemies, st = this.stage, s = this.s;
    for (let i = 0; i < es.length; i++) {
      const e = es[i]; if (e.dead) continue;
      e.t += dt; if (e.flash > 0) e.flash -= dt; if (e.orbCd > 0) e.orbCd -= dt;
      // status
      if (e.hexT > 0) e.hexT -= dt; if (e.shockT > 0) e.shockT -= dt; if (e.chillT > 0) e.chillT -= dt;
      if (e.burnT > 0 || e.psnT > 0) {
        e.dotT -= dt;
        if (e.dotT <= 0) { e.dotT = 0.5; let d = 0; if (e.burnT > 0) d += e.burn * s.burnMul * 0.5; if (e.psnT > 0) d += e.psn * 0.5; this.hit(e, d, e.burnT > 0 ? 'fire' : 'nature', { dot: true, noReact: true }); if (e.dead) continue; }
        e.burnT -= dt; e.psnT -= dt; if (e.psnT <= 0) e.psn = 0; if (e.burnT <= 0) e.burn = 0;
      }
      if (e.kx || e.kz) { e.x += e.kx * dt; e.z += e.kz * dt; const f = Math.exp(-8 * dt); e.kx *= f; e.kz *= f; if (Math.abs(e.kx) + Math.abs(e.kz) < 0.05) e.kx = e.kz = 0; }
      if (e.stun > 0) { e.stun -= dt; continue; }
      if (e.boss) { this.bossAI(e, dt); continue; }
      const dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz) || 1;
      if (d > 29) { const [x, z] = this.spawnPos(); e.x = x; e.z = z; continue; }
      let sp = e.spd * (e.chillT > 0 ? 0.55 : 1), mx = dx / d, mz = dz / d;
      if (s.coldOpen && d < 3.4) sp *= 0.7;
      // a decoy pulls the crowd: anything near it chases it instead of you
      const dc = this.decoy;
      if (dc && e.mode === 0) { const ex = dc.x - e.x, ez = dc.z - e.z, ed = Math.hypot(ex, ez); if (ed < 9) { if (ed > 0.7) { mx = ex / ed; mz = ez / ed; } else { mx = mz = 0; } } }
      switch (e.k.ai) {
        case 'weave': { const w = Math.sin(e.t * 4) * 0.9; const ox = -mz * w, oz = mx * w; mx += ox; mz += oz; break; }
        case 'ghost': sp *= 0.5 + 1.1 * Math.max(0, Math.sin(e.t * 2.2)); break;
        case 'shoot':
          if (d < 5) { mx = -mx * 0.6; mz = -mz * 0.6; } else if (d < 7) { const t = mx; mx = -mz * 0.7; mz = t * 0.7; }
          e.cd -= dt * st.shootMul;
          if (e.cd <= 0 && d < 10) { e.cd = 2.6; this.ebullet(e.x, e.z, Math.atan2(dz, dx), 5, 9); this.audio.sfx('eshoot'); e.flash = 0.1; }
          break;
        case 'charge':
          if (e.mode === 0) { e.cd -= dt; if (e.cd <= 0 && d < 6.5) { e.mode = 1; e.mt = 0.55; } }
          else if (e.mode === 1) { e.mt -= dt; sp = 0; e.flash = 0.05; if (e.mt <= 0) { e.mode = 2; e.mt = 0.6; e.cx = mx; e.cz = mz; } }
          else { e.mt -= dt; mx = e.cx; mz = e.cz; sp = 9.5; if (e.mt <= 0) { e.mode = 0; e.cd = 2.8; } }
          break;
        case 'bomb':
          if (e.mode === 1) { e.mt -= dt; sp = 0; e.flash = 0.05; if (e.mt <= 0) { this.fx.ring(e.x, e.z, 2, 0xff3050, 0.3); this.fx.burst(e.x, e.z, 0xff7a3d, 16, { spd: 6 }); this.audio.sfx('boom'); if (d < 2.1) this.hurt(e.dmg); this.kill(e); continue; } }
          else if (d < 1.4) { e.mode = 1; e.mt = 0.5; }
          break;
      }
      e.x += mx * sp * dt; e.z += mz * sp * dt;
      if (d < e.r + 0.35 && e.mode !== 1) this.hurt(e.dmg);
    }
    // soft separation
    for (let i = 0; i < es.length; i++) {
      const a = es[i]; if (a.dead || a.boss) continue;
      for (let j = i + 1; j < es.length; j++) {
        const b = es[j]; if (b.dead || b.boss) continue;
        const dx = b.x - a.x; if (dx > 1.3 || dx < -1.3) continue; const dz = b.z - a.z; if (dz > 1.3 || dz < -1.3) continue;
        const rr = (a.r + b.r) * 0.9, d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 0.0001) { const d = Math.sqrt(d2), f = (rr - d) / d * 0.5 * Math.min(1, dt * 12); a.x -= dx * f; a.z -= dz * f; b.x += dx * f; b.z += dz * f; }
      }
    }
  }

  // ---------- choices ----------
  runeCount() { let n = 0; for (let i = 0; i < this.size; i++) if (this.wheel[i]) n++; return n; }
  levelChoices() {
    const s = this.s, pool = [], owned = new Map();
    for (let i = 0; i < this.size; i++) { const w = this.wheel[i]; if (w) owned.set(w.id + '#' + i, i); }
    const empty = this.size - this.runeCount();
    const spells = this.wheel.filter((w, i) => i < this.size && w && RUNES[w.id].type === 'spell').length;
    for (let i = 0; i < this.size; i++) { const w = this.wheel[i]; if (w && w.lvl < MAX_RUNE_LVL) pool.push({ kind: 'up', id: w.id, slot: i, lvl: w.lvl, w: 2.6 }); }
    for (const id of this.unlocked) {
      const def = RUNES[id];
      if (def.fusion) continue;
      if (def.type === 'mod' && spells < 2) continue;
      if (id === 'cresc' && this.wheel.some(w => w && w.id === 'cresc')) continue;
      pool.push({ kind: 'rune', id, w: (empty > 0 ? 2.2 : 0.5) * (def.type === 'mod' ? 0.7 : 1) });
    }
    for (const id in PASSIVES) {
      const P = PASSIVES[id], l = this.passives[id] || 0; if (l >= P.max) continue;
      if (id === 'slot' && s.slots >= MAX_SLOTS) continue;
      pool.push({ kind: 'passive', id, lvl: l, w: id === 'slot' ? (empty === 0 ? 1.6 : 0.7) : P.rare ? 0.35 * (1 + s.luck) : 1 });
    }
    const out = this.fusionReady().slice(0, 2);
    for (let k = out.length; k < s.choices && pool.length; k++) {
      let tot = 0; for (const o of pool) tot += o.w;
      let r = Math.random() * tot, idx = 0; for (; idx < pool.length - 1; idx++) { r -= pool[idx].w; if (r <= 0) break; }
      const o = pool.splice(idx, 1)[0]; out.push(o);
      for (let q = pool.length - 1; q >= 0; q--) if (pool[q].kind === o.kind && pool[q].id === o.id && (o.kind !== 'up' || pool[q].slot === o.slot)) pool.splice(q, 1);
    }
    if (!out.length) out.push({ kind: 'gold', v: 40 }, { kind: 'heal', v: 40 });
    return out;
  }
  relicChoices(n = 3) {
    const pool = RELIC_IDS.filter(id => !this.relics.includes(id)), out = [];
    while (out.length < n && pool.length) out.push({ kind: 'relic', id: pool.splice((Math.random() * pool.length) | 0, 1)[0] });
    if (!out.length) out.push({ kind: 'gold', v: 60 });
    return out;
  }
  needsSlot(o) { return o.kind === 'rune' && this.runeCount() >= this.size; }
  applyChoice(o, slot) {
    switch (o.kind) {
      case 'rune': {
        let i = slot; if (i === undefined) { for (i = 0; i < this.size; i++) if (!this.wheel[i]) break; }
        if (i >= this.size) i = this.size - 1;
        this.wheel[i] = { id: o.id, lvl: 1 }; break;
      }
      case 'up': { const w = this.wheel[o.slot]; if (w && w.id === o.id) w.lvl = Math.min(MAX_RUNE_LVL, w.lvl + 1); else { const q = this.wheel.find(q => q && q.id === o.id && q.lvl < MAX_RUNE_LVL); if (q) q.lvl++; } break; }
      case 'fuse': {
        const a = this.wheel[o.i], b = this.wheel[o.j];
        if (!a || !b || a.id !== o.a || b.id !== o.b) break;
        this.wheel[o.i] = { id: o.id, lvl: MAX_RUNE_LVL, fused: true }; this.wheel[o.j] = null;
        this.c.fusions++; if (!this.fusedIds.includes(o.id)) this.fusedIds.push(o.id);
        this.toast('FUSION: ' + RUNES[o.id].name.toUpperCase() + '!', ELEM[RUNES[o.id].elem].c);
        this.fx.flash(0xffffff, 0.7); this.fx.shake(0.6); this.fx.ring(this.p.x, this.p.z, 8, ELEM[RUNES[o.id].elem].c, 0.6); this.fx.burst(this.p.x, this.p.z, 0xffcd75, 40, { spd: 8, up: 3 });
        break;
      }
      case 'passive': this.passives[o.id] = (this.passives[o.id] || 0) + 1; this.recalc(); if (o.id === 'vital') this.heal(20); if (o.id === 'fortune') this.rerolls++; break;
      case 'relic': { const hp0 = this.s.maxHp; if (RELICS[o.id].pact) this.c.pacts++; this.relics.push(o.id); this.recalc(); if (this.s.maxHp > hp0) this.heal(this.s.maxHp - hp0); break; }
      case 'gold': this.gold += o.v; break;
      case 'heal': this.heal(this.s.maxHp * o.v / 100); break;
    }
    this.wheelChanged();
  }
  shopOffers() {
    const n = this.stage.n, out = this.relicChoices(3).filter(o => o.kind === 'relic').map(o => ({ ...o, price: Math.round((70 + n * 14) * rnd(0.85, 1.15) / 5) * 5 }));
    out.push({ kind: 'heal', v: 50, price: 30 + n * 6 });
    const ups = []; for (let i = 0; i < this.size; i++) { const w = this.wheel[i]; if (w && w.lvl < MAX_RUNE_LVL) ups.push({ kind: 'up', id: w.id, slot: i, lvl: w.lvl }); }
    if (ups.length) out.push({ ...pick(ups), price: 55 + n * 12 });
    const pacts = PACT_IDS.filter(id => !this.relics.includes(id));
    if (pacts.length) out.push({ kind: 'relic', id: pick(pacts), price: 0, pact: true });
    return out;
  }
  summary(won) {
    const c = this.c, echoes = Math.floor((this.kills * 0.06 + c.cleared * 30 + c.bossKills * 12 + this.level * 2) * (1 + 0.25 * this.volume) * this.s.echoMul) + (c.cleared >= 5 ? 100 : 0);
    return { ...c, kills: this.kills, level: this.level, time: this.time, volume: this.volume, relics: this.relics.length, stage: this.stage.n + 1, echoes, won: c.cleared >= 5, char: this.char.id };
  }
}

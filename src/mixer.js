// HEXBEAT — the DJ. Pure state machine: no audio, no clock, no RNG. Once per bar it turns the wheel's
// wish (the class mix) into a Scene the audio engine plays, and it never just swaps the band:
//   - new hats, chords and colours come in at once, filtered open over two bars; what leaves is echoed out;
//   - a change of drummer or bassist is latched and lands on the next phrase downbeat, after a build bar in
//     which the old bass drops out and the incoming kit rolls in, with a crash on the landing;
//   - a new meter, a boss or a DROP is a hard cut on the downbeat.
// It also conducts: an energy level follows the stage and the kill rate, and the AABA form breathes (the
// bridge thins out, the last A is the full band).
import { seats, allocate, layersOf, sameBand } from './blend.js';
import { GENRES } from './genres/index.js';

// true: in a DROP the band holds its tempo and each wheel step is half a beat (the wheel plays double time
// over the band). false: the band doubles with the wheel, as the first version of the game did.
export const DROP_HOLD = true;
// how much detail a beat of this length can carry: 2 everything, 1 no sixteenths, 0 skeleton
export const tierOf = bd => (bd >= 0.3 ? 2 : bd >= 0.14 ? 1 : 0);
const clamp01 = x => Math.max(0, Math.min(1, x));
const ARC = [[0, 0.12], [0.06, 0.3], [0.4, 0.55], [0.75, 0.7], [1, 0.8]];
const arc = p => { p = clamp01(p || 0); for (let i = 1; i < ARC.length; i++) if (p <= ARC[i][0]) { const a = ARC[i - 1], b = ARC[i]; return a[1] + (b[1] - a[1]) * (p - a[0]) / (b[0] - a[0]); } return 0.8; };
const TH = [0.25, 0.5, 0.74];

// Energy 1..3 for the coming bar. S = { E, base, level, kills, wait }; sig = { prog, kills, bossHp }.
// A slow baseline of the kill rate makes a burst of kills a surge whatever the build's usual pace is.
export function conduct(S, sig, barSec, boss, even) {
  const rate = Math.max(0, (sig.kills || 0) - S.kills) / Math.max(0.2, barSec); S.kills = sig.kills || 0;
  S.base += (rate - S.base) * (1 - Math.exp(-barSec / 20));
  const surge = Math.tanh((rate - S.base) / (S.base + 0.5));
  const target = boss ? 0.85 + 0.15 * (1 - (sig.bossHp == null ? 1 : sig.bossHp)) : clamp01(arc(sig.prog) + 0.25 * surge);
  S.E += (target - S.E) * (1 - Math.exp(-barSec / (target > S.E ? 2 : 5)));
  let lv = S.level;
  if (S.wait > 0) S.wait--;
  else if (lv < 3 && S.E > TH[lv] + 0.04) { lv++; S.wait = 1; }                   // up on any barline
  else if (lv > 0 && S.E < TH[lv - 1] - 0.04 && even) { lv--; S.wait = 1; }       // down only on even bars
  return (S.level = Math.max(boss ? 2 : 1, lv));
}

export class Mixer {
  constructor() { this.mix = [['baroque', 1]]; this.first = null; this.reset(null); }
  // a new song: the wish goes on air directly. intro = two bars of rhythm section before the tune starts.
  reset(song, o = {}) {
    this.song = song; this.air = allocate(seats(this.mix, null), null, { first: this.first });
    this.idx = o.intro ? 13 : -1; this.intro = o.intro ? 2 : 0; this.bars = 0; this.pend = null; this.dwell = 0; this.enter = null;
    this.en = { E: 0.3, base: 0, level: 2, kills: -1, wait: 0 }; this.meter = ''; this.boss = false; this.dropOn = false; this.now = false;
    this.styleId = this.air.style.id; this.styleBars = 0; this.level = 2;
  }
  // the wheel changed. now = no blend, cut on the next downbeat (menus, the record player)
  cue(mix, o = {}) { this.mix = mix && mix.length ? mix : [['baroque', 1]]; this.first = o.first || null; if (o.now) this.now = true; }

  // Called on every downbeat with the step payload. The only place the state changes. Returns the Scene.
  bar(m) {
    const meter = m.beats + '/' + m.unit, cutMeter = this.meter !== '' && meter !== this.meter; this.meter = meter;
    const bossIn = !!m.boss && !this.boss, dropIn = !!m.drop && !this.dropOn; this.boss = !!m.boss; this.dropOn = !!m.drop;
    this.idx = (this.idx + 1) % 16; this.bars++;
    if (cutMeter) this.idx = (Math.ceil(this.idx / 4) * 4) % 16;          // a new meter starts a new phrase
    if (dropIn && DROP_HOLD) this.idx = 12;                                // the drop is the last A: the hook, full band
    const bd = m.dur * (m.drop && DROP_HOLD ? 2 : 1), tier = tierOf(bd), prev = this.air, fx = {};
    const want = allocate(seats(this.mix, prev), prev, { first: this.first });
    const kc = want.own.kit !== prev.own.kit, bc = want.own.bass !== prev.own.bass;
    const hold = () => allocate(seats(this.mix, prev), prev, { first: this.first, keep: { kit: prev.own.kit, bass: prev.own.bass } });
    let state = 'steady', toast = null, noBass = false, roll = null, leave = [];
    if (this.dwell > 0) this.dwell--;
    if (cutMeter || bossIn || dropIn || this.now || tier === 0 || this.bars === 1) {
      this.air = want; this.pend = null; this.enter = null; this.now = false; state = 'cut';
      if (this.bars > 1) { fx.crash = 1; this.dwell = 4; } if (bossIn || dropIn) fx.impact = 1;
    } else if (this.pend && this.bars >= this.pend.land && this.pend.built && (kc || bc)) {   // LAND: the handover, on a phrase downbeat
      this.air = want; this.pend = null; this.dwell = 8; fx.crash = 1; if (kc) fx.impact = 1; state = 'land';
      toast = kc ? 'DRUMS > ' + GENRES[want.own.kit].name.toUpperCase() : 'BASS > ' + GENRES[want.own.bass].name.toUpperCase();
    } else if (kc || bc) {
      if (this.pend && this.bars >= this.pend.land) this.pend = null;     // the wish changed under the build: start over
      const air = this.air = hold();                                       // guests move now; the rhythm section waits for the phrase
      if (air.own.kit !== prev.own.kit || air.own.bass !== prev.own.bass) { this.pend = null; this.dwell = 2; fx.crash = 1; state = 'cut'; }   // its player left the wheel: no waiting
      else if (this.pend) { if (this.bars === this.pend.land - 1) { this.pend.built = true; state = 'build'; noBass = bc; roll = kc ? GENRES[want.own.kit].fillVoice || 'tom1' : null; fx.swell = 1; } }
      else if (this.dwell <= 0) {
        let land = this.bars + 2; while ((this.idx + land - this.bars) % 4) land++;
        this.pend = { land, built: false, kit: kc ? want.own.kit : null, bass: bc ? want.own.bass : null };
      }
    } else { this.air = want; this.pend = null; }
    const sec = this.idx >= 8 && this.idx < 12 ? 'B' : 'A', rep = this.idx >> 2, pos = this.idx & 3;
    // who came and who went (hats, chords and colour only: the tune is traded by design, kit and bass land clean)
    const air = this.air, soft = T => layersOf(T, rep).filter(l => l.part !== 'kit' && l.part !== 'bass' && l.part !== 'lead');
    if (state !== 'cut' && !sameBand(prev, air)) {
      const was = soft(prev), is = soft(air), key = l => l.g + ':' + l.part;
      const inK = is.filter(l => !was.some(w => key(w) === key(l))).map(key);
      leave = was.filter(l => !is.some(w => key(w) === key(l)));
      if (inK.length) this.enter = { keys: inK, bars: 2 };
    }
    let entering = null, enterBar = 0;
    if (this.enter) { entering = this.enter.keys; enterBar = 3 - this.enter.bars; if (--this.enter.bars <= 0) this.enter = null; }
    // energy and form
    let level = m.sig ? conduct(this.en, m.sig, bd * m.beats, this.boss, !(this.idx & 1)) : 2;
    if (m.drop) level = 3;
    this.level = level;
    const up = rep === 3 || m.drop ? 1 : 0, down = sec === 'B' && !m.drop ? 1 : 0, lv = d => Math.max(1, Math.min(3, level + d));
    const cap = tier === 2 ? 3 : tier === 1 ? 2 : 1;
    const maxP = { kit: Math.min(cap, lv(up - down)), tops: Math.min(cap, lv(up)), bass: Math.min(cap, lv(up)), comp: Math.min(cap, lv(up - down)), color: Math.min(cap, lv(up)), lead: cap };
    let layers = layersOf(air, rep);
    if (lv(up) < 2) layers = layers.filter(l => l.part !== 'color');     // colour only from level 2
    if (lv(up) < 3 && !m.drop) layers = layers.filter(l => !l.dbl);      // the octave double is for the full band
    let intro = 0;
    if (this.intro > 0) {                                                  // intro: rhythm section, then chords, then the tune
      intro = this.intro--; layers = layers.filter(l => l.part === 'kit' || l.part === 'tops' || l.part === 'bass' || (intro === 1 && l.part === 'comp'));
      if (intro === 1) { entering = layers.filter(l => l.part === 'comp').map(l => l.g + ':comp'); enterBar = 2; }
    } else if (this.idx === 0 && this.bars === 3 && state !== 'cut') fx.crash = 1;
    if (air.style.id === this.styleId) this.styleBars++; else { this.styleId = air.style.id; this.styleBars = 1; }
    return { idx: this.idx, pos, rep, sec, table: air, layers, leave, entering, enterBar, state, level, maxP, tier, bd,
      swing: air.swing, pump: m.drop ? Math.max(0.5, air.pump) : air.pump, noBass, roll, fx, toast, drop: !!m.drop, boss: this.boss, intro };
  }

  // what the HUD shows
  decks() {
    const a = this.air, N = g => GENRES[g].name;
    return { kit: N(a.own.kit), bass: N(a.own.bass), comp: Object.keys(a.lvl.comp).map(N), tops: Object.keys(a.lvl.tops).map(N), color: N(a.own.color),
      lead: N(a.lead[Math.max(0, this.idx) >> 2 & 3].g), style: a.style, styleBars: this.styleBars, phrase: Math.max(0, this.idx) & 3, level: this.level,
      pending: this.pend ? (this.pend.kit ? 'DRUMS > ' + N(this.pend.kit) : 'BASS > ' + N(this.pend.bass)) : null };
  }
}

// HEXBEAT — synth voices. A small General-MIDI-flavoured sound module: pitched patches, eight drum kits and the
// noise / tone hits the sound effects are made of. Everything here creates short-lived per-voice nodes only; the
// persistent graph (buses, filters, limiter) belongs to audio.js, which hands each voice a route to play into.
//
// Rules that hold by construction (tools/t/synth.mjs checks them on a fake context):
//  - every parameter moves only by time-ordered setValueAtTime / setTargetAtTime segments (no ramps), an attack is
//    never longer than 0.3 of the note, and a source stops no earlier than 7 time constants into its final decay
//    (-61 dB);
//  - a chord is N oscillators into ONE envelope; harmonic patches are one PeriodicWave oscillator per note;
//  - every source gets its stop time when it is started, and live() counts only from those recorded times.

const MTOF = new Float64Array(128); for (let i = 0; i < 128; i++) MTOF[i] = 440 * Math.pow(2, (i - 69) / 12);
export const mtof = m => (m >= 0 && m < 128 && m === (m | 0) ? MTOF[m] : 440 * Math.pow(2, (m - 69) / 12));
const SEMI = new Float64Array(97); for (let i = 0; i < 97; i++) SEMI[i] = Math.pow(2, (i - 48) / 12);
const semi = s => (s >= -48 && s <= 48 && s === (s | 0) ? SEMI[s + 48] : Math.pow(2, s / 12));

// ---------- wavetables (Fourier coefficients; one PeriodicWave each per context, never normalised) ----------
// Chrome's built-in sawtooth and square are peak-normalised band-limited tables: measured RMS 0.4936 and 0.8471
// against 0.5774 and 1 for the ideal shapes. The composite tables use the same factors so a patch that used to
// mix built-in oscillators keeps its balance.
const NS = 0.855, NQ = 0.847;
export const WAVES = {};
const tab = (name, n) => (WAVES[name] = { re: new Float32Array(n + 1), im: new Float32Array(n + 1) });
const harm = (name, amps) => { const w = tab(name, Math.max(1, amps.length)); amps.forEach((a, k) => { w.im[k + 1] = a; }); return w; };
// add a sawtooth / square / triangle whose fundamental sits on harmonic `mul` of the table
const saw = (w, mul, amp) => { for (let k = mul, h = 1; k < w.im.length; k += mul, h++) w.im[k] += amp * NS * 2 / (Math.PI * h) * (h & 1 ? 1 : -1); };
const sqr = (w, mul, amp) => { for (let k = mul, h = 1; k < w.im.length; k += 2 * mul, h += 2) w.im[k] += amp * NQ * 4 / (Math.PI * h); };
const tri = (w, mul, amp) => { for (let k = mul, h = 1; k < w.im.length; k += 2 * mul, h += 2) w.im[k] += amp * 8 / (Math.PI * Math.PI * h * h) * (h & 2 ? -1 : 1); };
harm('organ', [1, 0.5, 0.25]);
harm('epiano', [1, 0.25, 0, 0, 0, 0, 0.08]);
harm('vibes', [1, 0, 0, 0.22]);
harm('marimba', [1, 0, 0, 0.3]);
harm('sine35', [0.35]);                                    // the bell's inharmonic partial, pre-scaled
tri(harm('flute', [1, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 2, 0.18); // a sine with a triangle an octave up
{ const w = tab('nylon', 9); tri(w, 1, 1); w.im[2] += 0.3; }
{ const w = tab('harpsi', 32); saw(w, 1, 1); sqr(w, 2, 0.5); }
{ const w = tab('slap', 32); sqr(w, 1, 1); saw(w, 2, 0.3); }
{ const w = tab('synbass', 48); saw(w, 2, 1); sqr(w, 1, 0.4); }   // played an octave down: the saw is the note, the square its sub
saw(tab('saw80', 64), 1, 0.8); saw(tab('saw60', 64), 1, 0.6); sqr(tab('sq50', 64), 1, 0.5);   // detuned second oscillators, pre-scaled
// Basses carry strong second and third harmonics: the root window is 65-123 Hz, below what a phone speaker
// reproduces, so the line has to be readable from 130-370 Hz.
harm('finger', [1, 0.55, 0.38, 0.24, 0.14, 0.08]);
harm('organbass', [1, 0.7, 0.45, 0.28, 0.16, 0.08]);
// 25% pulse (the NES lead): +1 for a quarter of the cycle, -1 for the rest
{
  const w = tab('pulse25', 32), re = [], im = [];
  for (let k = 1; k <= 32; k++) { const c = NQ * 2 / (Math.PI * k); re[k] = c * Math.sin(Math.PI * k / 2); im[k] = c * (1 - Math.cos(Math.PI * k / 2)); }
  // rotate the cycle so it starts where the band-limited rising edge crosses zero (every table starts at a zero crossing)
  const val = x => { let v = 0; for (let k = 1; k <= 32; k++) v += re[k] * Math.cos(k * x) + im[k] * Math.sin(k * x); return v; };
  let lo = -0.2, hi = 0; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (val(m) < 0) lo = m; else hi = m; }
  for (let k = 1; k <= 32; k++) { w.re[k] = re[k] * Math.cos(k * hi) + im[k] * Math.sin(k * hi); w.im[k] = im[k] * Math.cos(k * hi) - re[k] * Math.sin(k * hi); }
}
// drums: a beater click (knock on the fundamental, click on the 4th harmonic), a drum head with overtones, a
// timpani (partials 1 : 1.5 : 2 : 2.5 ... of the note, written on a table an octave down) and a ride "ping": a sine
// on harmonic 20 plus two band-limited squares on 26 and 31 (their thirds land on 78 and 93; played at 205 Hz
// that is 4.1, 5.3 and 6.4 kHz, an inharmonic cluster from one oscillator)
harm('click', [0.6, 0, 0, 1]);
harm('tom', [1, 0.4, 0.25, 0.14, 0.07]);
harm('timp', [0, 1, 0.5, 0.35, 0.2, 0.12, 0.08, 0.05]);
{ const w = tab('ride', 93); w.im[20] = 1; sqr(w, 26, 0.7); sqr(w, 31, 0.55); }
const TABLES = new WeakMap();   // AudioContext -> { name: PeriodicWave }

// ---------- patches ----------
// o: oscillators per note as [waveform or WAVES name, frequency ratio, detune cents]. a = attack seconds,
// d = decay seconds (0 = sustained), s = sustain level, r = release seconds, lp = lowpass Hz or [from, to, seconds]
// sweep, hp = highpass Hz, lvl = peak gain, vib = delayed vibrato on notes longer than 0.28 s. A patch that decays
// to nothing (d > 0, s = 0) attacks instantly; a is then used only when x.pad turns it into a pad.
// A patch (or an event with x.bus === 'dist') that plays into the distortion bus is driven at DRIVE instead of lvl.
export const PATCH = {
  square: { o: [['square', 1, 0]], a: 0.005, d: 0, s: 0.8, r: 0.06, lp: 3600, lvl: 0.13, vib: 1 },
  sawlead: { o: [['sawtooth', 1, -6], ['saw80', 1, 7]], a: 0.01, d: 0, s: 0.85, r: 0.08, lp: 2600, lvl: 0.1, vib: 1 },
  fiddle: { o: [['sawtooth', 1, 0]], a: 0.04, d: 0, s: 0.9, r: 0.08, lp: 2300, hp: 300, lvl: 0.12, vib: 1 },
  flute: { o: [['flute', 1, 0]], a: 0.035, d: 0, s: 0.9, r: 0.07, lvl: 0.2, vib: 1 },
  brass: { o: [['sawtooth', 1, 0], ['saw60', 1, 5]], a: 0.02, d: 0, s: 0.8, r: 0.07, lp: [500, 2600, 0.07], lvl: 0.11 },
  clav: { o: [['square', 1, 0]], a: 0.002, d: 0.22, s: 0, r: 0.03, lp: 3000, hp: 500, lvl: 0.16 },
  vibes: { o: [['vibes', 1, 0]], a: 0.003, d: 0.9, s: 0, r: 0.2, lvl: 0.2 },
  marimba: { o: [['marimba', 1, 0]], a: 0.002, d: 0.24, s: 0, r: 0.05, lvl: 0.26 },
  epiano: { o: [['epiano', 1, 0]], a: 0.003, d: 0.7, s: 0, r: 0.1, lvl: 0.13 },
  harpsi: { o: [['harpsi', 1, 0]], a: 0.002, d: 0.38, s: 0, r: 0.04, hp: 400, lp: 5000, lvl: 0.075 },
  pluck: { o: [['sawtooth', 1, 0]], a: 0.002, d: 0.2, s: 0, r: 0.04, lp: [3200, 500, 0.15], lvl: 0.09 },
  nylon: { o: [['nylon', 1, 0]], a: 0.003, d: 0.45, s: 0, r: 0.06, lvl: 0.13 },
  organ: { o: [['organ', 1, 0]], a: 0.01, d: 0, s: 1, r: 0.05, lvl: 0.07 },
  strings: { o: [['sawtooth', 1, -8], ['sawtooth', 1, 8]], a: 0.09, d: 0, s: 1, r: 0.16, lp: 1700, lvl: 0.04 },
  dist: { o: [['sawtooth', 1, 0], ['sq50', 1, 4]], a: 0.004, d: 0, s: 0.9, r: 0.04, lvl: 0.07, bus: 'dist' },
  bell: { o: [['sine', 1, 0], ['sine35', 3.01, 0]], a: 0.002, d: 0.5, s: 0, r: 0.1, lvl: 0.16 },
  // the chip chord voice: one raw 25% pulse; with x.arp it flickers through the chord like a 2A03
  pulse25: { o: [['pulse25', 1, 0]], a: 0.003, d: 0, s: 0.85, r: 0.03, lvl: 0.1 },
  // basses
  synbass: { o: [['synbass', 0.5, 0]], a: 0.004, d: 0, s: 0.8, r: 0.04, lp: [900, 380, 0.12], lvl: 0.26 },
  finger: { o: [['finger', 1, 0]], a: 0.006, d: 0.7, s: 0, r: 0.05, lvl: 0.36 },
  slap: { o: [['slap', 1, 0]], a: 0.002, d: 0.3, s: 0, r: 0.03, lp: [2400, 600, 0.08], lvl: 0.24 },
  organbass: { o: [['organbass', 1, 0]], a: 0.01, d: 0, s: 1, r: 0.05, lvl: 0.24 },
};
export const DRIVE = 0.5;       // level into the distortion bus (the old dist patch's lvl): it sets the amount of drive, not the loudness
// which voice answers when a rune of this element fires
export const ELEM_INST = { arcane: 'vibes', fire: 'brass', frost: 'bell', volt: 'square', void: 'organ', nature: 'marimba', steel: 'harpsi' };
// Per-genre, per-part level trims, filled by `tools/rendertest.mjs --calibrate`. All 1 until measured.
const PARTS = ['kit', 'tops', 'bass', 'comp', 'color', 'lead', 'rune'];
export const TRIM = {};
for (const g of ['baroque', 'metal', 'jazz', 'funk', 'synthwave', 'celtic', 'chiprock', 'latin']) { TRIM[g] = {}; for (const p of PARTS) TRIM[g][p] = 1; }

// Ornaments are realised in seconds, so they sound the same at every tempo and vanish when the note is too
// short to carry them. kind: 1 grace (the neighbour, then the note), 2 mordent, 3 trill, 4 slide from the neighbour.
const ORN = { cut: 1, flip: 1, mordent: 2, trill: 3, bend: 4, glide: 4 };
export const ORN_MIN = { cut: 0.12, flip: 0.12, mordent: 0.2, trill: 0.3, bend: 0.12, glide: 0.12 };   // shortest note in seconds
const ORN_LEN = [0, 0.12, 0.2, 0.3, 0.12];
export const ORN_TIER2 = 0.3;   // mordent and trill need a beat of at least this (density tier 2)
const MIN_LEN = 0.02, OVER = 1 / (1 - Math.exp(-3)), VIB_CENTS = 10, CHORD = [1, 1, Math.SQRT1_2, 1 / Math.sqrt(3), 0.5];

// ---------- drum kits ----------
// A drum is a list of components. Tone: { w waveform, f Hz, to sweep target Hz, d seconds, v volume }.
// Noise: { d, v, ft filter type or null for raw noise, f, to, q }. Shared: dl delay, at attack seconds (0 = instant),
// j = 1 shares the previous tone's envelope (a second partial for one more node), re = burst times of a clap.
// The volume falls to 1e-4 in d seconds, as the old exponential ramps did, whatever the velocity.
const T = (w, f, to, d, v, x) => ({ k: 0, w, f, to, d, v, ft: null, q: 0, dl: 0, at: 0, j: 0, re: null, rv: 0, rd: 0, ...x });
const N = (d, v, ft, f, to, q, x) => ({ k: 1, w: null, f: f || 0, to: to || 0, d, v, ft: ft || null, q: q || 0, dl: 0, at: 0, j: 0, re: null, rv: 0, rd: 0, ...x });
const decay = (d, v) => d / Math.log((v > 3e-4 ? v : 3e-4) * 1e4);
const TAIL = 0.04;   // sources outlive their decay by this much, so a hit that lands up to 40 ms late (it restarts at "now") still ends in silence
const BASE = {
  kick: [T('sine', 150, 42, 0.2, 0.72), T('click', 700, 0, 0.018, 0.34)],   // the click (0.7 and 2.8 kHz) is the part a phone plays
  snare: [N(0.14, 0.3, 'bandpass', 1900, 0, 0.7), T('triangle', 200, 140, 0.09, 0.3)],
  clap: [N(0.11, 0.26, 'bandpass', 1400, 0, 1, { re: [0, 0.012, 0.024], rv: 0.22, rd: 0.02 })],   // three bursts of one noise source
  rim: [T('triangle', 1750, 0, 0.025, 0.3), N(0.012, 0.1, 'highpass', 3000)],
  tom1: [T('tom', 210, 130, 0.2, 0.38)],
  tom2: [T('tom', 150, 95, 0.22, 0.38)],
  tom3: [T('tom', 105, 65, 0.26, 0.45)],
  timp: [T('timp', 49, 41, 0.6, 0.32), N(0.05, 0.3, 'bandpass', 900, 0, 0.8)],     // the mallet's thwack is the part a phone plays
  hat: [N(0.035, 0.13, 'highpass', 7800)],
  ohat: [N(0.2, 0.12, 'highpass', 7000)],
  pedal: [N(0.05, 0.1, 'highpass', 6000)],
  ride: [N(0.25, 0.07, 'highpass', 6500), T('ride', 205, 0, 0.18, 0.02)],
  crash: [N(0.9, 0.16, 'highpass', 4500)],
  shaker: [N(0.04, 0.07, 'bandpass', 5200, 0, 1.2)],
  tamb: [N(0.09, 0.09, 'highpass', 6800)],
  cow: [T('square', 545, 0, 0.09, 0.06), T('square', 815, 0, 0.09, 0.06, { j: 1 })],
  brush: [N(0.2, 0.06, 'bandpass', 3200, 0, 0.5, { at: 0.05 })],          // a swish: slow attack, long soft tail
};
// Parameter overrides per kit, by component index (null removes a component, a full T()/N() appends one).
const KIT_OVER = {
  rock: {},
  // metal, funk: a short body so double kicks and ghost notes stay separate; the click and the snare crack carry it
  tight: {
    kick: [{ f: 160, to: 50, d: 0.12 }, { v: 0.38 }],
    snare: [{ d: 0.1, f: 2400 }, { f: 230, to: 170, d: 0.06 }],
    hat: [{ d: 0.025 }], ohat: [{ d: 0.13 }], pedal: [{ d: 0.035 }],
    tom1: [{ d: 0.14 }], tom2: [{ d: 0.15 }], tom3: [{ d: 0.18 }],
  },
  // synthwave: a long kick for the pump to breathe against, a wide clap, sweeping electronic toms
  disco: {
    kick: [{ f: 140, to: 38, d: 0.32, v: 0.74 }, { v: 0.36 }],
    snare: [{ d: 0.2, f: 1500, q: 0.5 }, { f: 180, to: 120 }],
    clap: [{ d: 0.16, v: 0.3 }],
    ohat: [{ d: 0.26 }],
    tom1: [{ f: 260, to: 100, d: 0.25 }], tom2: [{ f: 200, to: 75, d: 0.27 }], tom3: [{ f: 150, to: 55, d: 0.3 }],
  },
  // jazz: a feathered kick, a brushed snare, a ride that pings, soft hats
  brush: {
    kick: [{ f: 110, to: 50, d: 0.15, v: 0.6 }, { v: 0.27 }],
    snare: [{ d: 0.09, v: 0.2, f: 2600, q: 0.5 }, { v: 0.12 }],
    hat: [{ v: 0.09 }], pedal: [{ d: 0.045, f: 5000 }],
    ride: [{ d: 0.3, v: 0.055 }, { d: 0.3, v: 0.03 }],
    crash: [{ d: 0.7, v: 0.12, f: 3800 }],
    brush: [{ d: 0.28, v: 0.08 }],
  },
  // latin: congas for toms, a clave for the rim, a longer shaker, the cowbell out front
  hand: {
    kick: [{ f: 120, to: 55, d: 0.16, v: 0.7 }, { v: 0.32 }],
    snare: [{ d: 0.08, v: 0.16, f: 3000 }, { f: 330, to: 300, d: 0.1 }],
    tom1: [{ f: 370, to: 320, d: 0.13 }], tom2: [{ f: 250, to: 215, d: 0.16 }], tom3: [{ f: 170, to: 150, d: 0.2 }],
    rim: [{ w: 'sine', f: 2450, d: 0.04, v: 0.28 }, { v: 0.04 }],
    shaker: [{ d: 0.055, v: 0.1 }],
    cow: [{ d: 0.12, v: 0.08 }, { d: 0.12 }],
  },
  // baroque: long timpani with a harder mallet, a field drum, longer jingles
  court: {
    kick: [{ f: 95, to: 60, d: 0.3, v: 0.7 }, { v: 0.31 }],
    snare: [{ d: 0.2, v: 0.22, f: 1500 }, { f: 170, to: 150, v: 0.2 }],
    timp: [{ d: 0.7 }, { v: 0.4 }],
    tamb: [{ d: 0.12 }],
  },
  // celtic: bodhran strokes (low on tom3, high on tom2) with the tipper's tick; everything else soft
  folk: {
    kick: [{ f: 85, to: 55, d: 0.18, v: 0.7 }, { v: 0.29 }],
    snare: [{ d: 0.1, v: 0.16 }, { v: 0.2 }],
    tom1: [{ f: 170, to: 140, d: 0.12 }, T('click', 520, 0, 0.012, 0.16)],
    tom2: [{ f: 130, to: 100, d: 0.13 }, T('click', 480, 0, 0.012, 0.16)],
    tom3: [{ f: 95, to: 70, d: 0.17 }, T('click', 450, 0, 0.012, 0.2)],
  },
  // chiprock: the 2A03's triangle and noise channels: triangle-wave drums and unfiltered noise bursts
  chip: {
    kick: [{ w: 'triangle', f: 220, to: 45, d: 0.11, v: 0.75 }, { v: 0.3 }],
    snare: [{ ft: null, d: 0.09, v: 0.14 }, { f: 240, to: 150, d: 0.05, v: 0.25 }],
    clap: [{ ft: null, v: 0.1, rv: 0.09 }],
    rim: [{ w: 'square', d: 0.012, v: 0.25 }, null],
    tom1: [{ w: 'triangle', f: 300, to: 150, d: 0.12, v: 0.5 }], tom2: [{ w: 'triangle', f: 220, to: 110, d: 0.13, v: 0.5 }], tom3: [{ w: 'triangle', f: 160, to: 80, d: 0.15, v: 0.55 }],
    timp: [{ w: 'triangle', f: 98, to: 82, d: 0.3, v: 0.5 }, null],
    hat: [{ ft: null, d: 0.02, v: 0.1 }], ohat: [{ ft: null, d: 0.11, v: 0.09 }], pedal: [{ ft: null, d: 0.03, v: 0.09 }],
    ride: [{ ft: null, d: 0.07, v: 0.07 }],
    crash: [{ ft: null, d: 0.45, v: 0.14 }],
    shaker: [{ ft: null, d: 0.025, v: 0.045 }], tamb: [{ ft: null, d: 0.05, v: 0.08 }], brush: [{ ft: null, d: 0.14, v: 0.035 }],
  },
};
function buildKit(over) {
  const kit = {};
  for (const name in BASE) {
    const b = BASE[name], o = over[name] || [], out = [];
    for (let i = 0; i < Math.max(b.length, o.length); i++) {
      if (o[i] === null) continue;
      const p = o[i] === undefined ? { ...b[i] } : b[i] ? { ...b[i], ...o[i] } : { ...o[i] };
      if (p.k === undefined) throw new Error(`KITS: ${name}[${i}] has no base component to override`);
      const lead = p.j ? out[out.length - 1] : null;
      if (lead) { p.d = lead.d; p.at = lead.at; p.v = lead.v; }            // a joined partial has no envelope of its own
      p.tc = decay(p.d, p.v); p.st = p.at + Math.max(p.d, 7 * p.tc) + TAIL;   // decay time constant; when the source stops, after the hit
      p.rtc = p.re ? decay(p.rd, p.rv) : 0;
      out.push(Object.freeze(p));
    }
    kit[name] = Object.freeze(out);
  }
  return Object.freeze(kit);
}
// KITS[kit][drum] -> components. Every kit knows every drum name: kick snare clap rim tom1 tom2 tom3 timp
// hat ohat pedal ride crash shaker tamb cow brush.
export const KITS = {};
for (const k in KIT_OVER) KITS[k] = buildKit(KIT_OVER[k]);

// Four things measured in Chromium 153 that shape the scheduling code below:
//  - START PITCH. An oscillator whose frequency is given only by setValueAtTime(f, t) at its start time plays the
//    rest of its first render quantum (up to 2.9 ms) at the intrinsic value, 440 Hz by default: the old kick began
//    at a random wrong pitch. So every automated frequency (oscillator or filter) is also written to .value first.
//  - LATE CALLS. Events whose time is already past are moved to "now", in order, and an attack can collapse onto
//    the decay behind it. Over 48 clock times and 4 to 30 ms of lateness: a setTarget attack followed by a decay to
//    zero rendered as exact silence every time; a linear-ramp attack followed by a setTarget was silent 7 times in
//    48 and played at the gain's default value of 1.0 (a full-scale blast) 4 times in 48; a setTarget attack
//    followed by a sustain, and an instant attack (setValueAtTime, then decay), were right every time. The audio
//    thread can run a whole buffer ahead of the currentTime a script last read, so calls that looked 5 ms early do
//    land late. Hence: no ramps anywhere, plucked patches and drums attack instantly, held patches attack by
//    setTarget, and every waveform starts at a zero crossing so that an instant attack is not a step.
//  - Writing .value is itself an event at currentTime. On an envelope gain it would land after the envelope of a
//    late call and hold the gain there until the source is cut, so envelope gains are never written through .value.
//  - SAMPLE GRID. A buffer source that starts between two sample frames is linearly interpolated for its whole
//    life, which is a low-pass on noise: the same burst measured 2.2 dB quieter a quarter of a sample off the grid
//    and 3.2 dB quieter at half a sample, a 7.8 kHz hat 4.5 dB quieter and duller, so every hit of the old engine
//    had its own level. Noise therefore starts on a sample frame. (The read offset is rounded by the browser, and
//    oscillators compute their phase exactly: neither needs it.)
export class Synth {
  // rand feeds the noise buffer and the noise start offsets; pass a seeded one for reproducible renders.
  constructor(ctx, opts) {
    this.ctx = ctx; this.rand = (opts && opts.rand) || Math.random; this.sr = ctx.sampleRate;
    this.swing = 0.5;                                   // audio.js copies the scene's swing here; x.arp steps in thirds of a beat above 0.58
    this.counters = { nodes: 0, starts: 0, oscs: 0 };   // cumulative: nodes created, sources started, of which oscillators
    this._stops = new Float64Array(1024); this._n = 0;  // stop times of sources that may still be alive
    let W = TABLES.get(ctx);
    if (!W) { W = {}; for (const k in WAVES) W[k] = ctx.createPeriodicWave(WAVES[k].re, WAVES[k].im, { disableNormalization: true }); TABLES.set(ctx, W); }
    this.waves = W;
    const len = Math.floor(ctx.sampleRate * 1.2), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = this.rand() * 2 - 1;
    this.noiseBuf = buf;
  }

  // Sources whose stop time is still ahead of `now` (sounding or scheduled). Counted from the stop times recorded
  // when each source was started, never from the graph, so it cannot drift. `now` must not run backwards.
  live(now) {
    const a = this._stops; let k = 0;
    for (let i = 0, n = this._n; i < n; i++) { const s = a[i]; if (s > now) a[k++] = s; }
    this._n = k; return k;
  }
  _track(stop) {
    if (this._n === this._stops.length) {
      this.live(this.ctx.currentTime);
      if (this._n > this._stops.length >> 1) { const b = new Float64Array(this._stops.length * 2); b.set(this._stops); this._stops = b; }
    }
    this._stops[this._n++] = stop; this.counters.starts++;
  }
  _osc(wave) {
    const o = this.ctx.createOscillator(), w = this.waves[wave];
    if (w !== undefined) o.setPeriodicWave(w); else o.type = wave;
    this.counters.nodes++; this.counters.oscs++;
    return o;
  }

  // Play one event. route = { out, send, dist } (send and dist optional): the envelope connects to out and send,
  // or to dist alone for a dist patch or x.bus === 'dist'. ev = { n | ns, d (beats), v, i, orn, on, x }; bd = seconds
  // per beat; gain = layer level x trim; inst overrides ev.i. Returns the number of oscillators started.
  note(route, ev, t, bd, gain, inst) {
    const n0 = ev.n; if (!(n0 > 0)) return 0;                       // a drum name, NaN or nothing: not a pitch
    const P = PATCH[inst || ev.i] || PATCH.square, x = ev.x, ns = ev.ns, nn = ns && ns.length > 1 ? ns.length : 1;
    if (nn > 1) for (let k = 0; k < nn; k++) if (!(ns[k] > 0)) return 0;
    const dist = route.dist && (P.bus === 'dist' || (x && x.bus === 'dist')) ? route.dist : null;
    // a chord is power-normalised, so the comp level does not depend on how many notes the voicing has
    let lvl = (dist ? DRIVE : P.lvl) * ev.v * (gain === undefined ? 1 : gain); if (nn > 1) lvl *= nn < 5 ? CHORD[nn] : 1 / Math.sqrt(nn);
    if (!(lvl > 0) || !(t >= 0) || !(bd > 0)) return 0;
    let len = ev.d * bd; if (!(len > MIN_LEN)) len = MIN_LEN;
    const c = this.ctx, C = this.counters, pad = x && x.pad;
    // x.pad: a slow swell, held at full level, with a long tail, whatever the patch
    let a = pad && P.a < 0.06 ? 0.06 : P.a; if (a > 0.3 * len) a = 0.3 * len;
    const dec = pad ? 0 : P.d, s = pad && P.s < 0.85 ? 0.85 : P.s, tr = (pad && P.r < 0.18 ? 0.18 : P.r) / 3, end = t + len;
    let stop = end + 7 * tr + 0.005;
    const g = c.createGain(), gp = g.gain; C.nodes++;
    if (dec && !s) {                                                // plucked, struck: instant attack (see LATE CALLS above the class)
      gp.setValueAtTime(lvl, t); gp.setTargetAtTime(0, t, dec / 3);
      const quiet = t + 7 * dec / 3 + 0.005; if (quiet < stop) stop = quiet;   // gone before its key is released
    } else {                                                        // blown, bowed, held: three time constants reach lvl at t + a
      gp.setValueAtTime(0, t); gp.setTargetAtTime(lvl * OVER, t, a / 3); gp.setTargetAtTime(lvl * s, t + a, dec ? dec / 3 : 0.013);
    }
    gp.setTargetAtTime(0, end, tr);
    let head = g;
    const lp = P.lp, hp = P.hp;
    if (lp !== undefined) {
      const fl = c.createBiquadFilter(); C.nodes++;
      if (typeof lp === 'number') fl.frequency.value = lp; else { fl.frequency.value = lp[0]; fl.frequency.setValueAtTime(lp[0], t); fl.frequency.setTargetAtTime(lp[1], t, lp[2] / 3); }
      fl.connect(head); head = fl;
    }
    if (hp !== undefined) { const fh = c.createBiquadFilter(); C.nodes++; fh.type = 'highpass'; fh.frequency.value = hp; fh.connect(head); head = fh; }
    let started = 0, lg = null;
    if (P.vib && !pad && len > 0.28) {                              // vibrato in cents on detune, so it survives ornaments and suits any pitch
      const lfo = this._osc('sine'); lg = c.createGain(); C.nodes++;
      lfo.frequency.value = 5.6; lg.gain.setValueAtTime(0, t); lg.gain.setTargetAtTime(VIB_CENTS, t + 0.1, 0.07);
      lfo.connect(lg); lfo.start(t); lfo.stop(stop); this._track(stop); started++;
    }
    // what moves the pitch inside the note: a chip arpeggio, or a lead ornament when the note can carry it
    const arp = x && x.arp && x.arp.length ? x.arp : null;
    let orn = 0, fon = 0, step = 0;
    if (arp) {
      const sw = this.swing > 0.58; step = bd / (sw ? 3 : 4);
      if (step < 0.03) { step = sw ? bd : bd / 2; if (step < 0.03) step = bd < 0.03 ? 0.03 : bd; }   // never faster than 30 ms, still on the grid
    } else if (ev.orn !== undefined && nn === 1) {
      const k = ORN[ev.orn] | 0, on = ev.on;
      if (k && typeof on === 'number' && on !== n0 && len >= ORN_LEN[k] && (k === 1 || k === 4 || bd >= ORN_TIER2)) { orn = k; fon = mtof(on); }
    }
    const O = P.o;
    for (let k = 0; k < nn; k++) {
      const f = mtof(nn > 1 ? ns[k] : n0);
      for (let j = 0; j < O.length; j++) {
        const od = O[j], o = this._osc(od[0]), fr = o.frequency, fj = f * od[1];
        if (od[2]) o.detune.value = od[2];
        if (arp) { const m = arp.length; fr.value = fj * semi(arp[0]); for (let i = 0, at = t; at < end - 1e-4; at = t + ++i * step) fr.setValueAtTime(fj * semi(arp[i % m]), at); }
        else if (orn) this._orn(fr, fj, fon * od[1], orn, t, len, bd);
        else fr.value = fj;
        if (lg) lg.connect(o.detune);
        o.connect(head); o.start(t); o.stop(stop); this._track(stop); started++;
      }
    }
    if (dist) g.connect(dist); else { g.connect(route.out); if (route.send) g.connect(route.send); }
    return started;
  }
  // f = the note, fo = its neighbour. Frequency steps are phase-continuous, so none of this clicks.
  _orn(fr, f, fo, kind, t, len, bd) {
    if (kind === 1) { fr.value = fo; fr.setValueAtTime(fo, t); fr.setValueAtTime(f, t + (len < 0.24 ? len / 4 : 0.06)); }           // cut, flip
    else if (kind === 2) { fr.value = f; fr.setValueAtTime(f, t); fr.setValueAtTime(fo, t + 0.05); fr.setValueAtTime(f, t + 0.1); }   // mordent
    else if (kind === 3) {                                                                                                         // trill: half the note, ending on the note
      const st = bd / 4 > 0.06 ? bd / 4 : 0.06, half = len / 2; let k = 1;
      fr.value = f; fr.setValueAtTime(f, t);
      for (; k * st < half; k++) fr.setValueAtTime(k & 1 ? fo : f, t + k * st);
      if (!(k & 1)) fr.setValueAtTime(f, t + k * st);
    } else { fr.value = fo; fr.setValueAtTime(fo, t); fr.setTargetAtTime(f, t, 0.02); }                                           // bend, glide: three time constants in 60 ms
  }

  // One drum hit. kit = key of KITS (unknown kits fall back to rock). Returns the number of sources started.
  drum(out, kit, name, t, v) {
    const R = (KITS[kit] || KITS.rock)[name];
    if (R === undefined || !(v > 0) || !(t >= 0)) return 0;
    let g = null;
    for (let i = 0; i < R.length; i++) {
      const p = R[i];
      if (p.k === 0) g = this._tone(out, t + p.dl, p.w, p.f, p.to, p.d, p.v * v, p.tc, p.at, p.st, p.j ? g : null);
      else this._noise(out, t + p.dl, p.d, p.v * v, p.tc, p.st, p.ft, p.f, p.to, p.q, p.at, p.re, p.rv * v, p.rtc);
    }
    return R.length;
  }
  // A filtered noise burst that dies away in `dur` seconds: drums, swells, impacts and sound effects.
  // type = a BiquadFilterType, or null for raw noise; f -> to sweeps the filter over `dur`.
  hitNoise(dest, t, dur, vol, type, f, to, q) {
    if (!(vol > 0) || !(t >= 0) || !(dur > 0)) return 0;
    const tc = decay(dur, vol);
    this._noise(dest, t, dur, vol, tc, (dur > 7 * tc ? dur : 7 * tc) + TAIL, type || null, f, to, q, 0, null, 0, 0);
    return 1;
  }
  // A pitched blip that dies away in `dur` seconds; f -> to sweeps the pitch over `dur`. type = a waveform or a WAVES name.
  hitTone(dest, t, type, f, to, dur, vol) {
    if (!(vol > 0) || !(t >= 0) || !(dur > 0)) return 0;
    const tc = decay(dur, vol);
    this._tone(dest, t, type, f, to, dur, vol, tc, 0, (dur > 7 * tc ? dur : 7 * tc) + TAIL, null);
    return 1;
  }
  _tone(dest, t, wave, f, to, dur, vol, tc, at, st, join) {
    const o = this._osc(wave), stop = t + st;
    o.frequency.value = f;
    if (to > 0) { o.frequency.setValueAtTime(f, t); o.frequency.setTargetAtTime(to < 20 ? 20 : to, t, dur / 3); }
    let g = join;
    if (!g) {
      g = this.ctx.createGain(); this.counters.nodes++;
      const gp = g.gain;
      if (at > 0) { gp.setValueAtTime(0, t); gp.setTargetAtTime(vol * OVER, t, at / 3); gp.setTargetAtTime(0, t + at, tc); }
      else { gp.setValueAtTime(vol, t); gp.setTargetAtTime(0, t, tc); }   // instant attack: every waveform starts at a zero crossing
      g.connect(dest);
    }
    o.connect(g); o.start(t); o.stop(stop); this._track(stop);
    return g;
  }
  _noise(dest, t, dur, vol, tc, st, ft, f, to, q, at, re, rvol, rtc) {
    const c = this.ctx, sr = this.sr, src = c.createBufferSource(), g = c.createGain(), gp = g.gain; this.counters.nodes += 2;
    src.buffer = this.noiseBuf; src.loop = true;                        // looped, so a long swell never runs off the end of the buffer
    // SAMPLE GRID (see above the class): the source starts on a sample frame; its envelope starts half a sample
    // earlier, so the first sample can never pass at the gain's default of 1
    t = Math.round(t * sr) / sr;
    const tg = t >= 1 / sr ? t - 0.5 / sr : t;
    let head = g, t1 = tg;
    if (ft) {
      const fl = c.createBiquadFilter(); this.counters.nodes++;
      fl.type = ft; fl.frequency.value = f; if (to > 0) { fl.frequency.setValueAtTime(f, t); fl.frequency.setTargetAtTime(to, t, dur / 3); }
      if (q) fl.Q.value = q;
      fl.connect(g); head = fl;
    }
    if (re) {                                                           // a clap: short bursts, then the tail
      const last = re.length - 1;
      for (let i = 0; i < last; i++) { gp.setValueAtTime(rvol, tg + re[i]); gp.setTargetAtTime(0, tg + re[i], rtc); }
      t1 = tg + re[last]; gp.setValueAtTime(vol, t1); gp.setTargetAtTime(0, t1, tc);
    } else if (at > 0) { gp.setValueAtTime(0, tg); gp.setTargetAtTime(vol * OVER, tg, at / 3); gp.setTargetAtTime(0, tg + at, tc); }   // a slow swish; one that lands later than its attack is dropped
    else { gp.setValueAtTime(vol, tg); gp.setTargetAtTime(0, tg, tc); }
    const stop = t1 + st;
    src.connect(head); g.connect(dest); src.start(t, this.rand() * 0.6); src.stop(stop); this._track(stop);
  }
}

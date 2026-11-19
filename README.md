# HEXBEAT

A pixel roguelike where your weapon is a **step sequencer**.

Your wheel fires one slot per beat. Runes are spells; modifiers bend whatever comes next
(`Amp → Twin → Meteor` is a very different bar of music than `Meteor → Amp → Twin`).
Every cast plays a note, so the build you draft is also the soundtrack you hear.

Genre soup: survivors-style arena combat + deckbuilder-style drafting and ordering +
bullet-hell bosses + a generative rhythm toy.

- **three.js** renders the world: tilted perspective camera, instanced billboard sprites on a
  shader-driven floor, beat-reactive pillars, bloom, low-res pixel upscaling.
- **Phaser 3** runs on a transparent canvas on top: HUD, touch input, menus, drafting screens.
- All art is drawn procedurally into one texture atlas at boot. All audio is WebAudio synthesis.
  There are no asset files.

## Play

```
npm install
npm run dev        # dev server, entry is /game.html
npm run build      # static site in docs/ (committed; GitHub Pages serves it)
SINGLE=1 npx vite build   # one self-contained HTML file in dist-single/
```

Controls: drag anywhere to move, DASH and DROP buttons on the right.
Desktop: WASD / arrows, Space = dash, E = drop, Esc = pause.

## How a run works

1. Survive each stage's timer while the wheel auto-casts. Kills drop XP, gold, and fill the DROP meter
   (double tempo for a few seconds).
2. Level up: draft a rune, upgrade one, or take a stat tome. Tap two wheel slots to swap them.
3. Elites drop relic chests. The stage ends with a boss locked in an arena with you.
4. Backstage shop, then pick the next stage's twist (harder mutators pay better).
5. Beat stage 5's Conductor to win — or keep going for an encore.

Depth: 24 spells, 13 modifiers, elemental reactions (Shatter, Overload, Deep Freeze, Blight),
neighbour resonance, 41 relics, 5 cursed pacts, 18 tomes.

Some of it changes how you play rather than how hard you hit: Mirror Decoy pulls the crowd off you,
Ember Mines and Frost Wake reward kiting, Dynamo scales with distance run, Aegis forges shields,
Shade Hound fights on its own. Modifiers like Coda (skip back to slot 1 every other loop), Transmute
(random element), Staccato (kills explode) and Blood Note (pay HP for damage) reshape the wheel.
Relics such as Rest Beat (stand still), Tour Bus (keep moving), Rubato (dash fires the next slot),
Minimalist (empty slots are power) and Bass Cannon (DROP casts everything) push whole builds.
Pacts are free at the shop and always cost something.

**Enemies.** 18 kinds. Beyond chasers, shooters, chargers and bombers there are Skitter packs, Blink
Wraiths that teleport beside you, Wardens whose aura halves damage to everything near them, Shamans that
heal the crowd, Lobbers that mortar your position, Lancers that paint a line before a fast shot,
Necromancers that keep raising skitters, and rooted Bloom Cannons. Each stage after the first also invites
two random guest kinds, a few foes spawn as brutes or runts, and every elite rolls an affix (Swift,
Armored, Volatile, Splitting, Regenerating, Frenzied).

**Looks.** Eight hero sprites (Apprentice, Knight, Shinobi, Hedge Witch, Familiar, Automaton, Selector,
Bedsheet), bought with Echoes in the Looks menu. Cosmetic only; each is redrawn in every character's colours.

**Fusions.** Two MAX-level spells sitting side by side can merge into one of 14 fusion runes
(Fireball + Meteor = Supernova, Chain Spark + Storm Totem = Tesla Field, ...). The fusion takes one
slot and frees the other. The wheel shows a link marker between neighbours that form a recipe.

**Time signatures.** One wheel slot is one beat, so the wheel's size is the meter: 3 slots = 3/4,
4 = 4/4, 5 = 5/4. At 6 slots (the maximum) a beat becomes an eighth note: 6/8, double time.
Slots come from the Extra Slot tome, the Bigger Wheel upgrade, and the character Vex.

**Music.** Every stage gets a new song, and every genre plays that same song.

- `src/music.js` composes it from a seed: key, mode, a 16-bar AABA chord plan with open and closed
  cadences, one clave, and (`src/theme.js`) one tune with a real hook: two short figures stated,
  restated and answered, a held note and a breath at the end of each phrase, and a single highest note
  that arrives once, in the bridge. The tune is the same in every meter and every genre.
- `src/genres/` holds one pack per genre. A pack writes five stems for any bar (kit, hats and
  percussion, bass, chords, a colour layer) and names a dialect for playing the tune (running eighths
  for baroque, long gliding notes for synthwave, clipped stabs for funk, and so on).
- `src/blend.js` decides who plays what. Each class on the wheel is a deck; its share of the wheel times
  how much each stem matters to its genre is its bid. One kit and one bass, ever; hats and chords are
  layered at equal power; the tune is traded phrase by phrase; the smallest class adds its colour.
  Two classes that both hold a real share form one of 28 named hybrids (Folk Metal, Electro Swing,
  Bossa Nova, Darksynth ...), each with its own signature device.
- `src/mixer.js` is the DJ. New hats, chords and colours come in at once through a filter; a change of
  drummer or bassist waits for the next phrase, with a build bar and a crash on the landing; a new
  meter, a boss or a DROP is a hard cut. Energy follows the stage and your kill rate, the bridge thins
  out and the last A is the full band. During a DROP the band holds its tempo and the wheel plays
  double time over it (`DROP_HOLD` in `mixer.js` switches back to the old doubling).
- `src/synth.js` makes the sound and `src/audio.js` runs the desk and the clock. The music keeps
  looping, muffled, behind every menu instead of stopping.

**Your spells pick the band.** Arcane = baroque, Fire = metal, Frost = jazz, Volt = funk,
Void = synthwave, Nature = celtic, Steel = chip rock, modifiers = latin. Runes are weighted by level;
a fused rune counts for the classes of both parents. The style on air is shown under the meter, draft
cards say `MIX > ...` when a pick would change it, and every style you play for 8 bars joins the
collection (menu, RUNES, SHOW STYLES), where found styles can be put on as menu music.
Adding `?soundcheck=1` to the URL makes every style playable there, in each meter.

`node tools/musictest.mjs` runs the music checks (theory rules, the pack contract, the allocator, the
mixer simulation, and the whole engine on a fake audio context). `node tools/score.mjs --genre funk
--parts kit,bass,lead --meter 4/4 --seed 7` prints the music as a text score.

Progression: Echoes buy 20 permanent upgrade tracks (98 ranks), 9 characters, new runes;
30 feats; a fusion codex; Volume 0–12 difficulty ladder.

## Difficulty

All the dials live in `TUNE` at the top of `src/game.js` (enemy health, damage, speed, their growth per
stage, invulnerability time after a hit, armour curve, boss heal). Armour is a percentage with
diminishing returns: damage taken = damage x 10 / (10 + armour). Volume adds enemy health, damage and
speed per step; winning at your highest Volume unlocks the next and selects it.

## Layout

| file | what |
| --- | --- |
| `src/game.js` | the whole simulation, DOM-free |
| `src/data.js` | runes, relics, enemies, biomes, meta upgrades, feats |
| `src/world.js` | three.js renderer |
| `src/sprites.js` | procedural pixel-art atlas |
| `src/music.js`, `src/theme.js` | procedural composer: harmony, clave, the tune (pure data) |
| `src/genres/` | one arrangement pack per genre |
| `src/blend.js`, `src/mixer.js` | who plays which stem; phrase-locked transitions and energy |
| `src/synth.js`, `src/audio.js` | voices and drum kits; the mixing desk, clock and sound effects |
| `src/ui/` | Phaser scenes (menu, run HUD, overlays) |
| `tools/contenttest.mjs` | runs every rune, fusion, relic and tome through the sim |
| `tools/pro.mjs` | competent-player bot used to tune difficulty: `node tools/pro.mjs <runs> <volume> <metaFraction>` |
| `tools/sim.mjs` | headless balance bot: `node tools/sim.mjs <runs> <volume> <metaFraction> [all] [chars]` |

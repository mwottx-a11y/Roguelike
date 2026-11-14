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

Depth: 16 spells, 7 modifiers, elemental reactions (Shatter, Overload, Deep Freeze, Blight),
neighbour resonance, 24 relics, 12 tomes.

Progression: Echoes buy 20 permanent upgrade tracks (98 ranks), 7 characters, new runes;
24 feats; Volume 0–12 difficulty ladder.

## Layout

| file | what |
| --- | --- |
| `src/game.js` | the whole simulation, DOM-free |
| `src/data.js` | runes, relics, enemies, biomes, meta upgrades, feats |
| `src/world.js` | three.js renderer |
| `src/sprites.js` | procedural pixel-art atlas |
| `src/audio.js` | synth + generative music |
| `src/ui/` | Phaser scenes (menu, run HUD, overlays) |
| `tools/sim.mjs` | headless balance bot: `node tools/sim.mjs <runs> <volume> <metaFraction> [all] [chars]` |

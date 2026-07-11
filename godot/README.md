# 🐊 BITE DOWN — Godot Edition

A native **Godot 4** port of the HTML5 original, built from the same procedural
recipes: the exact 4×5 pixel font, palette, swamp scene and gator geometry from
`game.js`, re-implemented in GDScript on a 480×270 pixel-perfect viewport.

## Run it

1. Download **Godot 4.3+** (free, ~50 MB): https://godotengine.org/download/
2. Open Godot → **Import** → pick this `godot/` folder (select `project.godot`)
3. Press **F5** (or the ▶ button)

That's the whole setup — no plugins, no addons.

## What's in the port

- **The full core loop** — press teeth to build TEETH × MULT, bank bites,
  dodge the hidden snap tooth. 3 bites and 3 x-rays per round.
- **8 antes, 3 rounds each** — Snappy Turtle → Risky/Golden Gator → Boss,
  with sim-tuned targets (`ANTE_BASE`).
- **4 bosses with rule-bends** — the Swamp King (bigger mouth, 2 snappers),
  Two-Fang (2 snappers), the Restless (snap teeth relocate every 3rd press),
  and the ante-8 Apex Predator (2 snappers, x-rays capped at 1) — each with a
  boss-intro splash card.
- **The living swamp** — night sky, twinkling stars, moon + beams, drifting
  clouds, jagged treeline, hanging moss, shimmering water, lilypads, cattails,
  16 wandering fireflies, bubbles, click ripples, scattering birds, and a
  blood-moon rainstorm on boss rounds.
- **The procedural gator** — same geometry as the original: breathing snout,
  vertical jaw slam, blinking pupil-tracking eyes, tail sway, claws, scutes,
  drool, plus per-variant features (turtle shell, king crown, boss scars/fangs,
  red eyes).
- **Tooth types** — plain, gold (+$), ruby (+4 MULT), rotten (+6 MULT),
  steel (×1.5 MULT), sapphire (+12) — bought at the shop, added to your deck.
- **12 charms** at the Everglades Trading Post (Sweet Tooth, Molar Magnet,
  Baby Fangs, Gator Insurance, Big Jaw…), reroll, interest, per-bite payouts.
- **Juice** — screen shake, red flash, tooth-shard bursts, water splash,
  floating combat text, combo-flame chips, clean-sweep auto-bank at ×1.25.
- **Sound** — 21 WAVs synthesized from the original's WebAudio recipes
  (chain-pitched clicks, bank arpeggio, snap crunch, boss drone) plus a
  seamless swamp-groove loop.
- Best-ante persistence, pause (ESC), mute (M), mouse/touch input.

## Files

| file | what |
|---|---|
| `project.godot` | 480×270 viewport, integer-scaled, nearest filtering |
| `main.tscn` | one Node2D running the whole game |
| `main.gd` | game logic + immediate-mode renderer (~1,700 lines) |
| `gamedata.gd` | font glyphs, palette, gator styles, charms, bosses |
| `sfx/*.wav` | synthesized sound pack |

## Porting notes

The original is a single-file immediate-mode canvas game, so the port keeps
that architecture: one `_draw()` repaints everything from rects each frame —
which is why the whole game fits in two scripts with zero image assets.
Layouts, colors, animation formulas (jaw drop = `closeT × 66px`, blink every
4.3 s, breathing `sin(t × 1.6)`) match `game.js` line for line where possible.

Not ported (yet): the branching trail map, mini-game events, the gacha-pon,
rangers, gloves, quests, the dentist bench, snack packs and the other 50-odd
charms. The scaffolding for all of it is here — `CHARMS`/`BOSSES` tables and
the state machine extend the same way the JS ones do.

# 🐊 BITE DOWN

**A push-your-luck dental roguelike.** Balatro's bones, a crocodile's teeth.

Instead of poker hands, you play the croc-dentist snap game: press teeth one at a
time and hope the jaw doesn't slam shut. Every safe tooth pumps up your **TEETH ×
MULT** score — but somewhere in that mouth is a **snap tooth**, and pressing it
costs you the whole unbanked bite.

![Bite Down screenshot](screenshot.png)

## How to play

Open `index.html` in a browser — that's it. No build, no dependencies, no assets.
(Or serve it: `python3 -m http.server` and visit `http://localhost:8000`.)

### The loop

| Balatro | Bite Down |
|---|---|
| Play a poker hand | **Press teeth** — each safe tooth adds its value to TEETH and grows the MULT chain +1 |
| Chips × Mult | **TEETH × MULT**, locked in when you **BANK BITE** |
| Hands | **BITES** — 3 per round; a snap or a bank spends one |
| Discards | **X-RAYS** — scan a tooth to learn if it's a snapper |
| Blinds | **SMALL CROC → BIG CROC → BOSS CROC**, 8 antes deep |
| Boss Blind effects | Boss gimmicks: extra snap teeth, blocked X-rays, hidden values, Lockjaw, Loan Shark… |
| Jokers | **CHARMS** — 5 slots of passive build-warping powers |
| Tarot cards | **CARDS** — one-shot consumables (Panorama, Novocaine, Extraction…) |
| Your deck of 52 | **Your tooth deck** — buy Gold, Ruby, Sapphire, Steel, Lucky, Rotten and Vampire teeth that shuffle into future mouths |
| The shop | **THE GATOR SHOP** — charms, cards, teeth, rerolls, interest on savings |

### Tips

- Banking early is safe money; clean-sweeping every safe tooth pays a ×1.25 bonus.
- Risk rises as the mouth empties — the SNAP RISK meter tells you the truth.
- Gold teeth print money. Rotten teeth are free MULT. Glass Jaw is a deal with the devil.
- Survive all 8 antes to win; **Endless Mode** waits on the other side.

### Controls

Mouse only. `M` mutes. Hover anything for a tooltip.

## Tech

- Single 480×270 canvas scaled up with nearest-neighbor for the chunky pixel look
- Everything procedural: hand-rolled 4×5 pixel font, croc and teeth drawn from
  rectangles, Balatro-style swirling background rendered per-pixel, CRT scanlines
- WebAudio-synthesized sound effects and a little swamp bass groove
- Zero dependencies, zero network, ~1,300 lines of vanilla JS

---

## Also in this repo

🕹️ **[Poké Auto Arena](poke-auto-arena/)** — a Super Auto Pets-style Pokémon auto battler
with catching, a Pokédex, crafting, held items, idle camp income, and real-time eggs & chests.
Open `poke-auto-arena/index.html` to play.

# 🐊 BITE DOWN

**A push-your-luck dental roguelike, set in a living swamp.**

You're a back-bayou dentist with a lantern-lit shop and a very bad idea: press a
gator's teeth one at a time and hope the jaw doesn't slam shut. Every safe tooth
pumps up your **TEETH × MULT** score — but somewhere in that mouth is a **snap
tooth**, and pressing it costs you the whole unbanked bite.

![Bite Down screenshot](screenshot.png)

## How to play

Open `index.html` in a browser — that's it. No build, no dependencies, no assets.
(Or serve it: `python3 -m http.server` and visit `http://localhost:8000`.)

### The loop

- **Press teeth** — each safe tooth adds its value to TEETH and grows the MULT chain +1
- **BANK BITE** to lock in TEETH × MULT, or push deeper and risk the snap
- 3 **BITES** and 3 **X-RAYS** per round; reach the target score before you run out
- Climb 8 antes, then Endless Mode

### The Swamp Trail

Every ante is a journey across a map. Pick your path at each fork:

- **EASY GATOR** — a gentle target, modest pay
- **RISKY GATOR** — 1.5× the target, better pay
- **GOLDEN GATOR** — a gilded monster with 1.9× the target and a fat purse
- **? EVENTS** — no fight, no shop: a **skill mini-game**. Hook fish off the
  night dock, lob drumsticks to a cruising gator, hold the campfire gumbo at a
  simmer, pull marshmallows at peak gold, or shoot up the carnival duck
  gallery. Five games — the better you play, the more they pay.

Fight nodes carry **modifiers** so every fork is a different gamble: FOGGY,
SWARMING, BRITTLE, TOLL GATE and TIRED ARM make routes nastier; BLESSED,
RICH WATERS, GILDED, TAILWIND and CHARMED sweeten them. The deeper the ante,
the heavier the mods… and the **BOSS GATOR** always waits at the end.

### The swamp is alive

Night sky, moon and fireflies over animated water — the gator sits *in* it.
Clicks ripple the surface, snaps scatter birds from the trees and splash the
water, and boss rounds roll in under a blood moon and rain.

### The gators

Every round type has its own gator, and each of the **15 boss gators** has a look
to match its rule-bend: Loan Shark wears a top hat and taxes your banks, Lockjaw
is bolted into a steel brace, The Restless relocates its snap teeth mid-bite,
the Swamp King wears a crown over a bigger, meaner mouth, Shellback hides under
a turtle shell demanding six presses per bank, Mudcake halves your teeth,
Two-Timer's four eyes demand two banks per round, The Albino's X-rays *lie*…
and the ante-8 **Apex Predator** is waiting at the end with two snappers and
red eyes.

### Cards, charms, tools and the barrel

- **55+ BADGES** (charms wear circular park-badge art now) across six rarities —
  Common, Uncommon, Rare, **EPIC**, **LEGENDARY** and **MYTHICAL** ($20+:
  Leviathan doubles every bank; Foreverglades pays bites, x-rays and cash
  every round; Million Fang counts your whole deck)
- **15 one-shot CARDS** plus **15 DENTIST TOOLS** — the tarot deck of Bite Down.
  Tools open **the Dentist Bench**: a workbench with a model mouth showing your
  deck's teeth. Pick targets and get to work — polish, gold fillings, ruby
  inlays, infections (+8 MULT, value 0), veneers, cloning wire, fluoride baths,
  diamond caps, or yank teeth for cash
- **SNACK-STAND PACKS** at the Everglades Trading Post: Gator Gummies,
  Chomp-Pops, Swamp Sundae (five teeth, pick TWO), Tackle Box and the Ranger
  Toolbelt — bigger packs pull rarer teeth, up to Obsidian, Pearl, Crystal,
  Honey, Fossil, Wraith and the mythical **TITAN TOOTH** (+20)
- **Click any card** for a full-detail view with flavor text
- **Drag cards onto the gator** to use them; drag charms into the **sell barrel**

### Rangers

Five animal rangers with big, blinking, cursor-tracking eyes. Only the Scout
starts unlocked — earn the rest:

- **BAYOU SCOUT** (the heron, free) — +1 tooth per mouth, one free reveal per mouth
- **SWAMP MEDIC** (the opossum, beat a boss) — +1 bite, starts holding a Novocaine
- **BOG TRADER** (the raccoon, hold $50) — starts with $12, interest cap $8
- **BULLFROG BRAWLER** (the bullfrog, 3 sweeps in a run) — Clean Sweeps pay ×1.75
- **SNAIL SAGE** (the snail, WIN a run) — every bite starts at +3 MULT, −1 bite

### The Scout Gacha-Pon and the Quest Board

Earn **Scout Cookies**: achievements +25, quests +15 and up, events +3, antes
+2. Trade 25 cookies for a spin of the **Gacha-Pon machine** — every capsule
is a prize you don't own yet: new cards and tools for your shop pools, three
gacha-only glove skins, and three **permanent perks** (start richer, a free
shop reroll, fatter snack packs). No duplicates, ever. Cookies come from
**three NPC quest chains** — Granny Snapper the turtle, Ferryman Crow, and Doc
Mudbug the crawfish dentist — tracked live on the trail map.

### Your hand, your gloves

You press with an on-screen pixel hand — and it's customizable. Earn
**achievements** (first press, beating bosses, holding $50, surviving 25 snaps,
clean sweeps, winning a run…) or lucky gacha spins to unlock **11 gloves**,
from the humble Rubber Glove to the Midas Touch and the Night Sky. Pick yours
from the rack on the title screen.

### Controls

Mouse only. Click teeth and buttons; click cards to inspect; drag cards to act.
`M` mutes. Hover anything for a tooltip.

## Tech

- Single 480×270 canvas scaled with nearest-neighbor for the chunky pixel look
- Everything procedural: hand-rolled 4×5 pixel font, the swamp scene, every
  gator variant, teeth, cards and the hand are drawn from rectangles at runtime
- WebAudio-synthesized sound effects and a little swamp bass groove
- Zero dependencies, zero network, one HTML file + one JS file

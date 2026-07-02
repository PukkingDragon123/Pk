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
- **? EVENTS** — no fight, no shop: a choice. Dive for the sunken chest, haggle
  with the hermit dentist, chase the firefly swarm, rob a sleeping gator, or
  trade teeth with the swamp witch. Five events, all with consequences.

…and the **BOSS GATOR** always waits at the end of the trail.

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

- **40+ CHARMS** across four rarities — Common, Uncommon, Rare and **LEGENDARY**
  (Jackpot Jaw pays ×5 on exactly-7-press banks; Tail Eater carries your whole
  MULT chain into the next mouth after a Clean Sweep; Dragon Hoard uncaps interest)
- **15 one-shot CARDS** plus **10 DENTIST TOOLS** — the tarot deck of Bite Down.
  Tools open **the Dentist Bench**: a workbench with a model mouth showing your
  deck's teeth. Pick targets and get to work — polish, gold fillings, ruby
  inlays, infections (+8 MULT, value 0), veneers, cloning wire, fluoride baths,
  diamond caps, or yank teeth for cash
- **PACKS** in the shop: Tooth Packs (pick 1 of 3) and Tool Packs (pick 1 of 2)
- **Click any card** for a full-detail view with flavor text
- **Drag cards onto the gator** to use them; drag charms into the **sell barrel**

### Rangers

Pick your ranger before every run — five animal rangers with big, blinking,
cursor-tracking eyes:

- **BAYOU SCOUT** (the heron) — +1 tooth in every mouth, one free reveal per mouth
- **SWAMP MEDIC** (the opossum) — +1 bite every round, starts holding a Novocaine
- **BOG TRADER** (the raccoon) — starts with $12 and an interest cap of $8
- **BULLFROG BRAWLER** (the bullfrog) — Clean Sweeps pay ×1.75 instead of ×1.25
- **SNAIL SAGE** (the snail) — every bite starts at +3 MULT, but −1 bite per round

### The Swamp Pass and the Quest Board

Earn **Ranger Points**: achievements +25, daily quests +15, events +3, antes +2.
RP climbs a **15-tier pass** that drops new cards, tools and legendary charms
into your pools. Daily quests come from **three NPC quest-givers** — Granny
Snapper the turtle, Ferryman Crow, and Doc Mudbug the crawfish dentist — and
each day you can **pledge** to one of them to double their quest's reward.

### Your hand, your gloves

You press with an on-screen pixel hand — and it's customizable. Earn
**achievements** (first press, beating bosses, holding $50, surviving 25 snaps,
clean sweeps, winning a run…) to unlock **8 gloves**, from the humble Rubber
Glove to the Midas Touch and the Royal Grip. Pick yours from the rack on the
title screen.

### Controls

Mouse only. Click teeth and buttons; click cards to inspect; drag cards to act.
`M` mutes. Hover anything for a tooltip.

## Tech

- Single 480×270 canvas scaled with nearest-neighbor for the chunky pixel look
- Everything procedural: hand-rolled 4×5 pixel font, the swamp scene, every
  gator variant, teeth, cards and the hand are drawn from rectangles at runtime
- WebAudio-synthesized sound effects and a little swamp bass groove
- Zero dependencies, zero network, one HTML file + one JS file

class_name GameData
## Static data ported 1:1 from game.js — the 4x5 pixel font, palette,
## gator style table, tooth types, charms and bosses.

# 4x5 glyphs, each row one hex digit, bit 8 = leftmost pixel (same as game.js)
const FONT := {
	"A": "69F99", "B": "E9E9E", "C": "69896", "D": "E999E", "E": "F8E8F",
	"F": "F8E88", "G": "68B96", "H": "99F99", "I": "72227", "J": "722A4",
	"K": "9ACA9", "L": "8888F", "M": "9FF99", "N": "9DB99", "O": "69996",
	"P": "E9E88", "Q": "699A5", "R": "E9EA9", "S": "7861E", "T": "F4444",
	"U": "99996", "V": "99964", "W": "99FF9", "X": "99699", "Y": "99644",
	"Z": "F168F",
	"0": "69BD6", "1": "4C44E", "2": "E168F", "3": "E161E", "4": "99F11",
	"5": "F8E1E", "6": "68E96", "7": "F1244", "8": "69696", "9": "69716",
	".": "00004", ",": "00048", ":": "04040", "!": "44404", "?": "E1604",
	"+": "04E40", "-": "00E00", "$": "476E4", "*": "0A4A0", "/": "12480",
	"(": "24442", ")": "42224", "'": "44000", "%": "92490", ">": "84248",
	"<": "12421", "=": "0E0E0", "#": "AFAFA", " ": "00000",
}

# palette (game.js `C`)
const INK := Color("0b1416")
const WHITE := Color("f4f2e4")
const DIM := Color("8fa6a8")
const PANEL := Color("1c2b33")
const PANEL_HI := Color("2c4250")
const EDGE := Color("49646f")
const BLUE := Color("3ea6ff")
const RED := Color("ff5348")
const RED_D := Color("95251f")
const GOLD := Color("ffc843")
const GOLD_D := Color("a4741a")
const GREEN := Color("63d66a")
const GREEN_D := Color("2c7d3a")
const PURPLE := Color("c07dff")
const ORANGE := Color("ff9838")

# gator variants (subset of game.js CROC_STYLES, exact colors)
const CROC_STYLES := {
	"small": {"a": "5aa843", "b": "3c7c2e", "c": "8cd34f", "d": "295722",
		"maw": "4a1420", "mawD": "320b14", "tongue": "c94f63", "tongueHi": "e0778a",
		"sclera": "f8f4dc", "flags": []},
	"turtle": {"a": "8a9a4e", "b": "5c6a2e", "c": "b0bc6a", "d": "3a4420",
		"maw": "5a2a1a", "mawD": "3a1a0e", "tongue": "d0766a", "tongueHi": "e89a8a",
		"sclera": "f8f4dc", "flags": ["shell", "sleepy"]},
	"big": {"a": "4e8f3d", "b": "2f6626", "c": "79b944", "d": "1f4519",
		"maw": "40101c", "mawD": "2a0a12", "tongue": "b8455a", "tongueHi": "d06a7c",
		"sclera": "f0e8c8", "flags": ["scars", "ridge"]},
	"gold": {"a": "d8b842", "b": "a8882a", "c": "f0d868", "d": "7a6014",
		"maw": "5a3010", "mawD": "3e2008", "tongue": "e0a050", "tongueHi": "f0c078",
		"sclera": "fff6dc", "flags": ["goldTooth"]},
	"king": {"a": "4a7a3a", "b": "305424", "c": "74a858", "d": "1e3a16",
		"maw": "4a1420", "mawD": "320b14", "tongue": "c94f63", "tongueHi": "e0778a",
		"sclera": "f0e8c8", "flags": ["crown", "moss"]},
	"twofang": {"a": "57755a", "b": "3a523e", "c": "7d9a80", "d": "263a2a",
		"maw": "3a0e18", "mawD": "260810", "tongue": "b8455a", "tongueHi": "d06a7c",
		"sclera": "f0e0c0", "flags": ["fangs", "scars"]},
	"restless": {"a": "6a5a8a", "b": "484060", "c": "8f7cae", "d": "2e2844",
		"maw": "38102a", "mawD": "240a1c", "tongue": "b8455a", "tongueHi": "d06a7c",
		"sclera": "e8c8c8", "flags": ["redEye", "bags"]},
	"apexpred": {"a": "2e3a34", "b": "1c2620", "c": "48584e", "d": "0e1612",
		"maw": "2e0810", "mawD": "1c040a", "tongue": "8a3040", "tongueHi": "a84858",
		"sclera": "e8d0c0", "flags": ["redEye", "scars", "fangs", "ridge"]},
}

# tooth types found in a wild gator's mouth (values from game.js TOOTH_DEFS)
const TOOTH_DEFS := {
	"plain": {"name": "TOOTH", "base": 3, "col": "f4f2e4", "desc": "+3 TEETH"},
	"gold": {"name": "GOLD TOOTH", "base": 3, "col": "ffc843", "desc": "+3 TEETH, EARN $2"},
	"ruby": {"name": "RUBY TOOTH", "base": 2, "col": "ff5348", "desc": "+2 TEETH, +4 MULT"},
	"rotten": {"name": "ROTTEN TOOTH", "base": 0, "col": "8a9a4e", "desc": "+6 MULT"},
	"sapph": {"name": "SAPPHIRE TOOTH", "base": 12, "col": "3ea6ff", "desc": "+12 TEETH"},
	"steel": {"name": "STEEL TOOTH", "base": 2, "col": "98a2aa", "desc": "X1.5 MULT"},
	"snap": {"name": "SNAP TOOTH", "base": 0, "col": "ff5348", "desc": "DO NOT PRESS"},
}

# charms sold at the trading post between rounds
const CHARMS := [
	{"id": "sweet", "name": "SWEET TOOTH", "cost": 4, "ico": "candy",
		"desc": "+1 EXTRA MULT FOR EVERY TOOTH PRESSED"},
	{"id": "overbite", "name": "OVERBITE", "cost": 4, "ico": "tooth",
		"desc": "FIRST TOOTH OF EACH BITE GIVES +12 TEETH"},
	{"id": "greedy", "name": "GREEDY GATOR", "cost": 5, "ico": "coin",
		"desc": "EARN $1 FOR EVERY 4 TEETH PRESSED"},
	{"id": "magnet", "name": "MOLAR MAGNET", "cost": 4, "ico": "magnet",
		"desc": "+15 TEETH WHEN YOU BANK"},
	{"id": "babyfangs", "name": "BABY FANGS", "cost": 5, "ico": "heart",
		"desc": "TEETH OF VALUE 2 OR LESS GIVE +4 MULT"},
	{"id": "lens", "name": "SWAMP LENS", "cost": 5, "ico": "lens",
		"desc": "+1 X-RAY EVERY ROUND"},
	{"id": "lantern", "name": "BOG LANTERN", "cost": 6, "ico": "lantern",
		"desc": "ONE FREE TOOTH REVEAL EACH MOUTH"},
	{"id": "insurance", "name": "GATOR INSURANCE", "cost": 6, "ico": "shield",
		"desc": "SNAPS KEEP HALF YOUR UNBANKED BITE"},
	{"id": "goldrush", "name": "GOLD RUSH", "cost": 5, "ico": "coin",
		"desc": "GOLD TEETH PAY DOUBLE"},
	{"id": "bigjaw", "name": "BIG JAW", "cost": 7, "ico": "jaw",
		"desc": "+2 TEETH IN EVERY MOUTH"},
	{"id": "snailshell", "name": "SNAIL SHELL", "cost": 4, "ico": "shell",
		"desc": "+$2 INTEREST AFTER EVERY ROUND"},
	{"id": "heron", "name": "HERON FEATHER", "cost": 4, "ico": "feather",
		"desc": "+1 X-RAY VS SMALL GATORS"},
]

# bosses: ante 8 is always the Apex Predator (game.js boss flavor)
const BOSSES := [
	{"id": "king", "name": "THE SWAMP KING", "quip": "KNEEL BEFORE THE CROWN.",
		"rule": "A BIGGER, MEANER MOUTH (+2 TEETH, HIGHER TARGET)"},
	{"id": "twofang", "name": "TWO-FANG", "quip": "TWICE THE TEETH TO FEAR.",
		"rule": "TWO SNAP TEETH HIDE IN THIS MOUTH"},
	{"id": "restless", "name": "THE RESTLESS", "quip": "IT NEVER SLEEPS. IT MOVES.",
		"rule": "THE SNAP TOOTH RELOCATES AFTER EVERY BANK"},
	{"id": "apexpred", "name": "APEX PREDATOR", "quip": "THE SWAMP ENDS HERE.",
		"rule": "TWO SNAPS. NO MERCY. THE FINAL JAW"},
]

const ROUND_NAMES := ["SNAPPY TURTLE", "BIG GATOR", "BOSS GATOR"]

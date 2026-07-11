extends Node2D
## BITE DOWN — native Godot 4 port of the HTML5 original.
## One immediate-mode CanvasItem, same architecture as game.js:
## everything is redrawn each frame on a 480x270 buffer from rects,
## with the original's 4x5 pixel font, palette and gator geometry.

const W := 480
const H := 270
const WATERY := 198.0
const MAW := Rect2(186, 112, 216, 92)
const BODY_X := 164.0
const BODY_W := 260.0
# retuned for the port's charm pool (sim-tested: median death ante 4,
# deaths spread across all 8 antes, winnable with sharp play)
const ANTE_BASE := [50, 105, 180, 285, 420, 590, 800, 1080]
const NODE_MULT := {"small": 1.0, "big": 1.5, "gold": 1.9, "boss": 2.0}
const NODE_REWARD := {"small": 3, "big": 5, "gold": 8, "boss": 6}
const BANK_RECT := Rect2(150, 240, 130, 24)
const XRAY_RECT := Rect2(290, 240, 86, 24)
const MAX_CHARMS := 5

const THEMES := {
	"night": {
		"sky": ["0a1626", "0c1c2e", "0f2434", "132c3c", "17343f"],
		"treeFar": "0d2028", "tree": "071318", "water": "0a2028", "waterHi": "1e4a52",
		"waterFront": "081c24", "moon": "e8e8d0", "stars": true, "rain": false,
		"reed": "132d1e", "reedHead": "4a3320", "pad": "1a4a30", "padHi": "2a6a42",
	},
	"boss": {
		"sky": ["180a12", "1e0d16", "26101a", "2e141e", "361822"],
		"treeFar": "22101a", "tree": "120711", "water": "1a0d14", "waterHi": "4a2030",
		"waterFront": "160a10", "moon": "c03830", "stars": false, "rain": true,
		"reed": "241018", "reedHead": "3a1a20", "pad": "301820", "padHi": "48242e",
	},
}

const TOOTH_STYLE := {
	"plain": {"a": "fef9e6", "b": "e3d5ab", "c": "b1a078", "gem": "", "gemD": ""},
	"gold": {"a": "ffe066", "b": "f0b429", "c": "a8781a", "gem": "fff6c8", "gemD": ""},
	"ruby": {"a": "fef9e6", "b": "e3d5ab", "c": "b1a078", "gem": "ff4d6a", "gemD": "a3162e"},
	"sapph": {"a": "eaf6ff", "b": "bcdcf5", "c": "7ba6c9", "gem": "3f8cff", "gemD": "1e4fa3"},
	"steel": {"a": "dfe8ec", "b": "aebfc7", "c": "77909b", "gem": "f4feff", "gemD": ""},
	"rotten": {"a": "c9c99a", "b": "a3a368", "c": "6f7042", "gem": "4c5a23", "gemD": ""},
	"snap": {"a": "fef9e6", "b": "e3d5ab", "c": "b1a078", "gem": "", "gemD": ""},
}

# ---------------------------------------------------------------- state ----
var state := "title"
var tnow := 0.0
var mp := Vector2(-40, -40)
var shk := Vector2.ZERO
var shake := 0.0
var flash_red := 0.0

var ante := 1
var round_i := 0          # 0 small 1 big 2 boss
var node_type := "small"
var boss: Dictionary = {}
var boss_order: Array = []
var target := 0
var score := 0
var disp_score := 0.0
var score_pulse := 0.0
var bites := 3
var xrays := 3
var money := 8
var deck: Array = []
var draw_pile: Array = []
var mouth: Array = []
var pool := {"teeth": 0, "mult": 1, "clicks": 0}
var jaw_close := 0.0
var charms: Array = []
var greedy_count := 0
var insurance_used := false
var round_banks := 0
var best_ante := 0
var won_once := false
var run_sweeps := 0

var mode := "idle"        # idle | xray
var xanim := {"i": -1, "t": 99.0}
var snap_t := 0.0
var snap_idx := -1
var snap_burst_done := false
var swap_t := 0.0
var bi_start := 0.0       # boss intro timer
var cash := {}
var shop_items: Array = []
var shop_tooth := {}
var reroll_cost := 4
var paused := false
var muted := false

# fx entity pools
var floats: Array = []
var parts: Array = []
var ripples: Array = []
var bubbles: Array = []
var birds: Array = []
var fireflies: Array = []
var rain: Array = []
var bubble_timer := 0.0

# audio
var sfx_players: Array = []
var sfx_streams := {}
var music_player: AudioStreamPlayer

const gd = preload("res://gamedata.gd")


# ---------------------------------------------------------------- setup ----
func _ready() -> void:
	randomize()
	Input.mouse_mode = Input.MOUSE_MODE_HIDDEN
	for i in range(16):
		fireflies.append({"x": randf() * W, "y": 60 + randf() * 150,
			"vx": 0.0, "vy": 0.0, "ph": randf() * 9.0})
	for i in range(42):
		rain.append({"x": randf() * W, "y": randf() * H, "s": 2.4 + randf() * 1.6})
	_setup_audio()
	_load_best()
	new_run()
	state = "title"
	_menu_mouth()


func _setup_audio() -> void:
	var names := ["click0", "click1", "click2", "click3", "click4", "click5",
		"click6", "click7", "hover", "bank", "coin", "snap", "splash", "xray",
		"error", "buy", "win", "boss", "whoosh", "sweep"]
	for n in names:
		var st := load("res://sfx/%s.wav" % n)
		if st:
			sfx_streams[n] = st
	for i in range(12):
		var p := AudioStreamPlayer.new()
		add_child(p)
		sfx_players.append(p)
	music_player = AudioStreamPlayer.new()
	music_player.volume_db = -6.0
	add_child(music_player)
	var groove := load("res://sfx/groove.wav")
	if groove:
		if groove is AudioStreamWAV:
			groove.loop_mode = AudioStreamWAV.LOOP_FORWARD
			groove.loop_begin = 0
			groove.loop_end = int(groove.data.size() / 2.0)
		music_player.stream = groove
		music_player.finished.connect(func() -> void: music_player.play())
		music_player.play()


func play_sfx(n: String) -> void:
	if muted or not sfx_streams.has(n):
		return
	for p in sfx_players:
		if not p.playing:
			p.stream = sfx_streams[n]
			p.play()
			return
	var p2: AudioStreamPlayer = sfx_players[0]
	p2.stream = sfx_streams[n]
	p2.play()


func _load_best() -> void:
	var cfg := ConfigFile.new()
	if cfg.load("user://bitedown.cfg") == OK:
		best_ante = int(cfg.get_value("run", "best", 0))


func _save_best() -> void:
	var cfg := ConfigFile.new()
	cfg.set_value("run", "best", best_ante)
	cfg.save("user://bitedown.cfg")


# ---------------------------------------------------------------- run ------
func new_run() -> void:
	ante = 1
	round_i = 0
	money = 8
	score = 0
	disp_score = 0.0
	charms = []
	deck = []
	run_sweeps = 0
	won_once = false
	for v in [1, 2, 3, 4, 5]:
		for k in range(4):
			deck.append({"type": "plain", "base": v})
	boss_order = ["king", "twofang", "restless"]
	boss_order.shuffle()


func _menu_mouth() -> void:
	mouth = []
	for i in range(10):
		mouth.append({"t": {"type": "plain", "base": 3}, "snap": false,
			"pressed": false, "revealed": "", "gone": false, "pop": 0.0})
	pool = {"teeth": 0, "mult": 1, "clicks": 0}


func has_charm(id: String) -> bool:
	for c in charms:
		if c["id"] == id:
			return true
	return false


func boss_is(id: String) -> bool:
	return round_i == 2 and not boss.is_empty() and boss["id"] == id


func mouth_size() -> int:
	var s := 10 + (2 if boss_is("king") else 0) + (2 if has_charm("bigjaw") else 0)
	return clampi(s, 6, deck.size())


func snap_count() -> int:
	var n := 1
	if boss_is("twofang") or boss_is("apexpred") or boss_is("king"):
		n += 1
	return n


func start_fight() -> void:
	node_type = "small" if round_i == 0 else ("boss" if round_i == 2 else node_type)
	boss = {}
	if round_i == 2:
		var bid: String = "apexpred" if ante == 8 else boss_order[(ante - 1) % boss_order.size()]
		for b in gd.BOSSES:
			if b["id"] == bid:
				boss = b
	var base: float = ANTE_BASE[ante - 1] if ante <= 8 else ANTE_BASE[7] * pow(1.7, ante - 8)
	target = roundi(base * NODE_MULT[node_type])
	score = 0
	disp_score = 0.0
	bites = 3
	xrays = 3 + (1 if has_charm("lens") else 0) \
		+ (1 if has_charm("heron") and node_type == "small" else 0)
	if boss_is("apexpred"):
		xrays = mini(xrays, 1)
	greedy_count = 0
	insurance_used = false
	round_banks = 0
	draw_pile = deck.duplicate(true)
	draw_pile.shuffle()
	new_mouth()
	if round_i == 2:
		state = "bossintro"
		bi_start = tnow
		play_sfx("boss")
	else:
		state = "play"
		play_sfx("whoosh")


func new_mouth() -> void:
	var size := mouth_size()
	var snaps: int = mini(snap_count(), maxi(1, size - 4))
	if draw_pile.size() < size:
		draw_pile = deck.duplicate(true)
		draw_pile.shuffle()
	var drawn: Array = []
	for i in range(size):
		drawn.append(draw_pile.pop_front())
	var order: Array = range(size)
	order.shuffle()
	var snap_set := {}
	for k in range(snaps):
		snap_set[order[k]] = true
	mouth = []
	for i in range(size):
		mouth.append({"t": drawn[i], "snap": snap_set.has(i), "pressed": false,
			"revealed": "", "gone": false, "pop": 0.0})
	pool = {"teeth": 0, "mult": 1, "clicks": 0}
	jaw_close = 0.0
	mode = "idle"
	xanim = {"i": -1, "t": 99.0}
	if has_charm("lantern"):
		var hidden: Array = mouth.filter(func(m: Dictionary) -> bool: return m["revealed"] == "")
		if hidden.size() > 0:
			var s: Dictionary = hidden.pick_random()
			s["revealed"] = "snap" if s["snap"] else "safe"


# ------------------------------------------------------------- fight -------
func mouth_layout() -> Dictionary:
	var n := mouth.size()
	var top_n := int(ceil(n / 2.0))
	var bot_n := n - top_n
	var slots: Array = []
	var jaw_drop := jaw_close * (MAW.size.y - 26.0)
	for row in [[top_n, false, MAW.position.y + 2.0 + jaw_drop],
			[bot_n, true, MAW.position.y + MAW.size.y - 28.0]]:
		var count: int = row[0]
		var tw: float = minf(24.0, floorf((MAW.size.x - 16.0) / maxf(1.0, count)) - 3.0)
		var total := count * (tw + 3.0) - 3.0
		var x0: float = MAW.position.x + (MAW.size.x - total) / 2.0
		for k in range(count):
			slots.append({"x": x0 + k * (tw + 3.0), "y": row[2], "w": tw, "h": 26.0, "up": row[1]})
	return {"slots": slots, "jaw_drop": jaw_drop}


func tooth_at(p: Vector2) -> int:
	var lay := mouth_layout()
	for i in range(lay["slots"].size()):
		var sl: Dictionary = lay["slots"][i]
		var s: Dictionary = mouth[i]
		if s["pressed"] or s["gone"]:
			continue
		if p.x >= sl["x"] - 1 and p.x < sl["x"] + sl["w"] + 1 \
				and p.y >= sl["y"] - 2 and p.y < sl["y"] + sl["h"] + 2:
			return i
	return -1


func tooth_pos(i: int) -> Vector2:
	var lay := mouth_layout()
	if i < 0 or i >= lay["slots"].size():
		return Vector2(W / 2.0, H / 2.0)
	var sl: Dictionary = lay["slots"][i]
	return Vector2(sl["x"] + sl["w"] / 2.0, sl["y"] + sl["h"] / 2.0)


func press_tooth(i: int) -> void:
	if state != "play":
		return
	var s: Dictionary = mouth[i]
	if s["pressed"] or s["gone"]:
		return
	if xanim["i"] == i and xanim["t"] < 0.5:
		return
	if mode == "xray":
		do_xray(i)
		return
	var p := tooth_pos(i)
	if s["snap"]:
		start_snap(i)
		return
	s["pressed"] = true
	s["pop"] = 0.25
	pool["clicks"] += 1
	var add: int = s["t"]["base"]
	var mgain := 1
	if has_charm("sweet"):
		mgain += 1
	if has_charm("babyfangs") and s["t"]["base"] <= 2:
		mgain += 4
	if has_charm("overbite") and pool["clicks"] == 1:
		add += 12
		add_float(p.x, p.y - 22, "OVERBITE +12", gd.BLUE, 1)
	var steel := false
	match s["t"]["type"]:
		"gold":
			var m := 4 if has_charm("goldrush") else 2
			money += m
			add_float(p.x, p.y - 22, "+$%d" % m, gd.GOLD, 1)
			play_sfx("coin")
		"ruby":
			mgain += 4
		"rotten":
			mgain += 6
		"steel":
			steel = true
	pool["teeth"] += add
	pool["mult"] += mgain
	if steel:
		pool["mult"] = roundi(pool["mult"] * 1.5)
		add_float(p.x, p.y - 22, "X1.5 MULT", gd.RED, 1)
	if has_charm("greedy"):
		greedy_count += 1
		if greedy_count % 4 == 0:
			money += 1
			add_float(p.x, p.y - 28, "GREEDY +$1", gd.GOLD, 1)
	add_float(p.x - 8, p.y - 12, "+%d" % add, gd.BLUE, 1)
	if mgain > 0:
		add_float(p.x + 10, p.y - 6, "+%d" % mgain, gd.RED, 1)
	burst(p.x, p.y, Color("fef9e6"), 5, 40)
	play_sfx("click%d" % mini(pool["clicks"], 7))
	if boss_is("restless") and pool["clicks"] % 3 == 0:
		relocate_snaps()
	check_sweep()


func relocate_snaps() -> void:
	var hidden: Array = mouth.filter(func(m: Dictionary) -> bool: return not m["pressed"] and not m["gone"])
	if hidden.size() < 2:
		return
	var n := 0
	for o in hidden:
		if o["snap"]:
			n += 1
	if n == 0:
		return
	for o in hidden:
		o["snap"] = false
		o["revealed"] = ""
	hidden.shuffle()
	for k in range(n):
		hidden[k]["snap"] = true
	add_float(W / 2.0 + 40, 96, "THE SNAPPERS MOVED!", gd.PURPLE, 1, 1.4)


func check_sweep() -> void:
	for s in mouth:
		if not s["snap"] and not s["pressed"] and not s["gone"]:
			return
	if pool["clicks"] > 0:
		add_float(W / 2.0 + 50, 96, "CLEAN SWEEP!", gd.GOLD, 2, 1.6)
		play_sfx("sweep")
		burst(W / 2.0 + 50, 130, gd.GOLD, 20, 90)
		run_sweeps += 1
		bank(true)
	else:
		add_float(W / 2.0 + 50, 96, "NOTHING SAFE LEFT!", gd.DIM, 1, 1.4)
		end_bite()


func bank_value(sweep := false) -> int:
	var t: float = pool["teeth"]
	var m: float = pool["mult"]
	if has_charm("magnet"):
		t += 15
	if sweep:
		m *= 1.25
	return int(floor(t * m))


func bank(sweep := false) -> void:
	if state != "play":
		return
	if pool["clicks"] == 0:
		play_sfx("error")
		add_float(248, 232, "PRESS A TOOTH FIRST!", gd.RED, 1)
		return
	var val := bank_value(sweep)
	score += val
	round_banks += 1
	score_pulse = 0.4
	add_float(60, 96, "+" + fmt(val), gd.GOLD, 2, 1.4)
	burst(60, 100, gd.GOLD, 14, 80)
	add_ripple(180 + randf() * 200, 254, false)
	if not sweep:
		play_sfx("bank")
	end_bite()


func start_snap(i: int) -> void:
	var s: Dictionary = mouth[i]
	s["pressed"] = true
	s["revealed"] = "snap"
	state = "snap"
	snap_t = 0.0
	snap_idx = i
	snap_burst_done = false
	play_sfx("snap")


func end_bite() -> void:
	bites -= 1
	mode = "idle"
	if score >= target:
		round_won()
		return
	if bites <= 0:
		game_over()
		return
	state = "swap"
	swap_t = 0.0


func round_won() -> void:
	var base: int = NODE_REWARD[node_type] + int(ante / 3.0)
	var per_bite := bites
	var interest: int = mini(5, int(money / 5.0)) + (2 if has_charm("snailshell") else 0)
	cash = {"base": base, "per_bite": per_bite, "interest": interest,
		"total": base + per_bite + interest}
	state = "roundend"
	jaw_close = 0.9
	play_sfx("win")
	if ante > best_ante:
		best_ante = ante
		_save_best()


func cash_out() -> void:
	money += cash["total"]
	if ante == 8 and round_i == 2:
		won_once = true
		state = "win"
		play_sfx("sweep")
		return
	enter_shop()


func game_over() -> void:
	state = "gameover"
	jaw_close = 1.0
	if ante > best_ante:
		best_ante = ante
		_save_best()
	play_sfx("boss")


func do_xray(i: int) -> void:
	var s: Dictionary = mouth[i]
	if s["pressed"] or s["gone"] or s["revealed"] != "":
		play_sfx("error")
		return
	s["revealed"] = "snap" if s["snap"] else "safe"
	xrays -= 1
	mode = "idle"
	xanim = {"i": i, "t": 0.0}
	var p := tooth_pos(i)
	add_float(p.x, p.y - 20, "SCANNING...", Color("9fe8ff"), 1, 0.5)
	play_sfx("xray")


# ------------------------------------------------------------- shop --------
func enter_shop() -> void:
	reroll_cost = 4
	roll_shop()
	state = "shop"
	jaw_close = 0.0


func roll_shop() -> void:
	shop_items = []
	var pool2: Array = []
	for c in gd.CHARMS:
		if not has_charm(c["id"]):
			pool2.append(c)
	pool2.shuffle()
	for k in range(mini(3, pool2.size())):
		shop_items.append({"def": pool2[k], "sold": false})
	var teeth_pool := [["gold", 3], ["ruby", 3], ["rotten", 3], ["steel", 4], ["sapph", 5]]
	var pick: Array = teeth_pool.pick_random()
	shop_tooth = {"type": pick[0], "cost": pick[1], "sold": false,
		"base": gd.TOOTH_DEFS[pick[0]]["base"]}


func buy_charm(k: int) -> void:
	var it: Dictionary = shop_items[k]
	if it["sold"]:
		return
	if charms.size() >= MAX_CHARMS:
		play_sfx("error")
		add_float(mp.x, mp.y - 10, "CHARMS FULL!", gd.RED, 1)
		return
	if money < it["def"]["cost"]:
		play_sfx("error")
		add_float(mp.x, mp.y - 10, "NOT ENOUGH $", gd.RED, 1)
		return
	money -= it["def"]["cost"]
	charms.append(it["def"])
	it["sold"] = true
	play_sfx("buy")


func buy_tooth() -> void:
	if shop_tooth["sold"]:
		return
	if money < shop_tooth["cost"]:
		play_sfx("error")
		add_float(mp.x, mp.y - 10, "NOT ENOUGH $", gd.RED, 1)
		return
	money -= shop_tooth["cost"]
	deck.append({"type": shop_tooth["type"], "base": shop_tooth["base"]})
	shop_tooth["sold"] = true
	play_sfx("buy")


func reroll_shop() -> void:
	if money < reroll_cost:
		play_sfx("error")
		return
	money -= reroll_cost
	reroll_cost += 1
	roll_shop()
	play_sfx("buy")


func leave_shop() -> void:
	round_i += 1
	if round_i >= 3:
		round_i = 0
		ante += 1
	if round_i == 1:
		node_type = "gold" if (ante >= 2 and randf() < 0.25) else "big"
	play_sfx("whoosh")
	start_fight()


# --------------------------------------------------------------- fx --------
func add_float(x: float, y: float, txt: String, col: Color, sc := 1, life := 1.0) -> void:
	floats.append({"x": x, "y": y, "txt": txt, "col": col, "sc": sc, "t": 0.0, "life": life})


func burst(x: float, y: float, col: Color, n: int, speed: float) -> void:
	for i in range(n):
		var a := randf() * TAU
		var v := speed * (0.4 + randf() * 0.6)
		parts.append({"x": x, "y": y, "vx": cos(a) * v, "vy": sin(a) * v - 20.0,
			"g": 160.0, "t": 0.0, "life": 0.4 + randf() * 0.4, "col": col,
			"sz": 1 + randi() % 2})


func add_ripple(x: float, y: float, big: bool) -> void:
	ripples.append({"x": x, "y": y, "r": 2.0, "vr": 34.0 if big else 20.0,
		"t": 0.0, "life": 1.1 if big else 0.7})
	if big:
		ripples.append({"x": x, "y": y, "r": 1.0, "vr": 22.0, "t": -0.15, "life": 1.2})


func scare_fireflies(x: float, y: float, pw: float) -> void:
	for f in fireflies:
		var dx: float = f["x"] - x
		var dy: float = f["y"] - y
		var d := maxf(8.0, Vector2(dx, dy).length())
		if d < 90.0:
			f["vx"] += dx / d * pw
			f["vy"] += dy / d * pw


func scatter_birds() -> void:
	for i in range(5):
		birds.append({"x": 20 + randf() * 90 + (330 if i % 2 == 1 else 0),
			"y": 92 + randf() * 30,
			"vx": (-1.0 if randf() < 0.5 else 1.0) * (40 + randf() * 30),
			"vy": -30 - randf() * 25, "t": 0.0})


func splash_water() -> void:
	add_ripple(200 + randf() * 180, 250, true)
	add_ripple(180 + randf() * 220, 258, true)
	for i in range(12):
		parts.append({"x": 200 + randf() * 180, "y": 250.0,
			"vx": (randf() - 0.5) * 90, "vy": -60 - randf() * 80, "g": 300.0,
			"t": 0.0, "life": 0.5 + randf() * 0.4, "col": Color("7fb8c8"),
			"sz": 1 + randi() % 2})
	play_sfx("splash")


# ------------------------------------------------------------ update -------
func _process(dt: float) -> void:
	if paused:
		queue_redraw()
		return
	tnow += dt
	mp = get_global_mouse_position()
	if shake > 0:
		shake = maxf(0.0, shake - 22.0 * dt)
		shk = Vector2(randi_range(-int(shake), int(shake)) / 2.0,
			randi_range(-int(shake), int(shake)) / 2.0)
	else:
		shk = Vector2.ZERO
	flash_red = maxf(0.0, flash_red - dt)
	score_pulse = maxf(0.0, score_pulse - dt)
	disp_score = lerpf(disp_score, float(score), 1.0 - pow(0.002, dt))
	xanim["t"] += dt
	for s in mouth:
		s["pop"] = maxf(0.0, s["pop"] - dt)
	_update_scene(dt)
	for fl in floats:
		fl["t"] += dt
	floats = floats.filter(func(fl: Dictionary) -> bool: return fl["t"] < fl["life"])
	for pt in parts:
		pt["t"] += dt
		pt["vy"] += pt["g"] * dt
		pt["x"] += pt["vx"] * dt
		pt["y"] += pt["vy"] * dt
	parts = parts.filter(func(pt: Dictionary) -> bool: return pt["t"] < pt["life"])
	match state:
		"title":
			jaw_close = maxf(0.0, sin(tnow * 1.4)) * 0.9
		"snap":
			_update_snap(dt)
		"swap":
			swap_t += dt
			if swap_t > 0.45:
				new_mouth()
				state = "play"
	queue_redraw()


func _update_scene(dt: float) -> void:
	for f in fireflies:
		f["vx"] += (randf() - 0.5) * 26 * dt
		f["vy"] += (randf() - 0.5) * 20 * dt
		f["vx"] *= 0.985
		f["vy"] *= 0.985
		f["x"] += f["vx"] * dt
		f["y"] += f["vy"] * dt
		if f["x"] < -8:
			f["x"] = W + 8
		if f["x"] > W + 8:
			f["x"] = -8
		if f["y"] < 46:
			f["y"] = 46
			f["vy"] = absf(f["vy"])
		if f["y"] > H - 6:
			f["y"] = H - 6
			f["vy"] = -absf(f["vy"])
	for rp in ripples:
		rp["t"] += dt
		rp["r"] += rp["vr"] * dt
	ripples = ripples.filter(func(rp: Dictionary) -> bool: return rp["t"] < rp["life"])
	for b in bubbles:
		b["t"] += dt
		b["y"] -= 9 * dt
	bubbles = bubbles.filter(func(b: Dictionary) -> bool: return b["t"] < 1.4)
	for b in birds:
		b["t"] += dt
		b["x"] += b["vx"] * dt
		b["y"] += b["vy"] * dt
	birds = birds.filter(func(b: Dictionary) -> bool:
		return b["x"] > -20 and b["x"] < W + 20 and b["y"] > -20)
	bubble_timer -= dt
	if bubble_timer <= 0:
		bubble_timer = 1.4 + randf() * 2.2
		bubbles.append({"x": 150 + randf() * 220, "y": 246 + randf() * 18, "t": 0.0})
	if _theme()["rain"]:
		for d in rain:
			d["y"] += d["s"] * 150 * dt
			d["x"] -= d["s"] * 22 * dt
			if d["y"] > H:
				d["y"] = -6
				d["x"] = randf() * (W + 60)


func _update_snap(dt: float) -> void:
	snap_t += dt
	if snap_t < 0.22:
		var k := snap_t / 0.22
		jaw_close = k * k * k
	else:
		if jaw_close < 1.0:
			shake = 7.0
			flash_red = 0.35
			if not snap_burst_done:
				snap_burst_done = true
				burst(MAW.position.x + MAW.size.x / 2, MAW.position.y + MAW.size.y / 2,
					Color("fef9e6"), 22, 130)
				burst(MAW.position.x + MAW.size.x / 2, MAW.position.y + MAW.size.y / 2,
					gd.RED, 10, 90)
				scatter_birds()
				splash_water()
				scare_fireflies(W / 2.0, 150, 140)
		jaw_close = 1.0
	if snap_t > 1.5:
		var lost := bank_value() if pool["clicks"] > 0 else 0
		if has_charm("insurance") and not insurance_used and lost > 0:
			insurance_used = true
			var save2 := int(lost / 2.0)
			score += save2
			score_pulse = 0.4
			add_float(60, 88, "INSURANCE SAVED " + fmt(save2) + "!", gd.GREEN, 1, 1.6)
		elif lost > 0:
			add_float(60, 96, "LOST " + fmt(lost) + "!", gd.RED, 1, 1.4)
		jaw_close = 0.0
		state = "play"
		end_bite()


# ------------------------------------------------------------- input -------
func _input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_M:
			muted = not muted
			music_player.stream_paused = muted
			add_float(mp.x, mp.y - 12, "MUTED" if muted else "SOUND ON", gd.DIM, 1)
		elif event.keycode == KEY_ESCAPE:
			if state == "play":
				paused = not paused
			elif paused:
				paused = false
		elif event.keycode == KEY_Q and paused:
			paused = false
			state = "title"
			_menu_mouth()
	if event is InputEventMouseButton and event.pressed \
			and event.button_index == MOUSE_BUTTON_LEFT:
		var p: Vector2 = get_global_mouse_position()
		_click(p)


func _click(p: Vector2) -> void:
	scare_fireflies(p.x, p.y, 60)
	if p.y > WATERY:
		add_ripple(p.x, p.y, false)
	if paused:
		paused = false
		return
	match state:
		"title":
			if _btn_rect_play().has_point(p):
				new_run()
				round_i = 0
				node_type = "small"
				play_sfx("whoosh")
				start_fight()
		"play":
			var ti := tooth_at(p)
			if ti >= 0:
				press_tooth(ti)
				return
			if BANK_RECT.has_point(p):
				bank(false)
				return
			if XRAY_RECT.has_point(p):
				if mode == "xray":
					mode = "idle"
				elif xrays > 0:
					mode = "xray"
					play_sfx("click0")
				else:
					play_sfx("error")
		"bossintro":
			if tnow - bi_start > 0.6:
				state = "play"
				play_sfx("whoosh")
		"roundend":
			if _btn_rect_cash().has_point(p):
				play_sfx("coin")
				cash_out()
		"shop":
			_shop_click(p)
		"gameover", "win":
			if _btn_rect_play().has_point(p):
				state = "title"
				_menu_mouth()
				play_sfx("whoosh")


func _btn_rect_play() -> Rect2:
	return Rect2(W / 2.0 - 52, 168, 104, 26)


func _btn_rect_cash() -> Rect2:
	return Rect2(W / 2.0 - 60, 206, 120, 24)


func _shop_slot_rect(k: int) -> Rect2:
	return Rect2(96 + k * 78, 92, 64, 84)


func _shop_click(p: Vector2) -> void:
	for k in range(shop_items.size()):
		if _shop_slot_rect(k).has_point(p):
			buy_charm(k)
			return
	if _shop_slot_rect(3).has_point(p):
		buy_tooth()
		return
	if Rect2(120, 196, 100, 20).has_point(p):
		reroll_shop()
		return
	if Rect2(260, 196, 100, 20).has_point(p):
		leave_shop()


# ------------------------------------------------------- draw helpers ------
func fmt(n: int) -> String:
	var s := str(n)
	var o := ""
	for i in range(s.length()):
		o += s[i]
		var left := s.length() - 1 - i
		if left > 0 and left % 3 == 0:
			o += ","
	return o


func px(x: float, y: float, w: float, h: float, col: Color) -> void:
	draw_rect(Rect2(floorf(x), floorf(y), floorf(w), floorf(h)), col)


func pxa(x: float, y: float, w: float, h: float, col: Color, a: float) -> void:
	var c := col
	c.a = clampf(a, 0.0, 1.0)
	px(x, y, w, h, c)


func rr(x: float, y: float, w: float, h: float, r: int, col: Color) -> void:
	r = mini(r, mini(int(h / 2.0), int(w / 2.0)))
	if r <= 0:
		px(x, y, w, h, col)
		return
	var cuts: Array = [[1], [2, 1], [3, 1, 1], [4, 2, 1, 1]][mini(r, 4) - 1]
	for i in range(r):
		var c: int = cuts[i]
		px(x + c, y + i, w - 2 * c, 1, col)
		px(x + c, y + h - 1 - i, w - 2 * c, 1, col)
	px(x, y + r, w, h - 2 * r, col)


func fill_circle(cx: float, cy: float, r: float, col: Color) -> void:
	for dy in range(-int(r), int(r) + 1):
		var w2 := floorf(sqrt(r * r - dy * dy))
		px(cx - w2, cy + dy, w2 * 2 + 1, 1, col)


func text(s: String, x: float, y: float, col: Color, sc := 1) -> void:
	s = s.to_upper()
	var cx := floorf(x)
	for i in range(s.length()):
		var ch := s[i]
		var g: String = gd.FONT.get(ch, gd.FONT["?"])
		for r in range(5):
			var bits := g[r].hex_to_int()
			for c in range(4):
				if bits & (8 >> c):
					px(cx + c * sc, floorf(y) + r * sc, sc, sc, col)
		cx += 5 * sc
	# (trailing advance unused)


func text_w(s: String, sc := 1) -> float:
	return s.length() * 5.0 * sc - sc


func text_c(s: String, cx: float, y: float, col: Color, sc := 1) -> void:
	text(s, cx - text_w(s, sc) / 2.0, y, col, sc)


func text_sh(s: String, x: float, y: float, col: Color, sc := 1) -> void:
	text(s, x, y + sc, Color(0, 0, 0, 0.56), sc)
	text(s, x, y, col, sc)


func text_csh(s: String, cx: float, y: float, col: Color, sc := 1) -> void:
	text_sh(s, cx - text_w(s, sc) / 2.0, y, col, sc)


func panel(x: float, y: float, w: float, h: float, face := Color("1c2b33"),
		edge := Color("49646f"), r := 3) -> void:
	rr(x + 1, y + 2, w, h, r, Color(0, 0, 0, 0.4))
	rr(x, y, w, h, r, edge)
	rr(x + 1, y + 1, w - 2, h - 2, maxi(0, r - 1), face)


func button(x: float, y: float, w: float, h: float, label: String, col: Color,
		col_d: Color, disabled := false, sub := "", sub_col := Color.WHITE) -> void:
	var hov := not disabled and Rect2(x, y, w, h).has_point(mp)
	var yy := y + 1 if hov else y
	rr(x, y + 3, w, h, 3, Color(0, 0, 0, 0.53))
	rr(x, yy + 2, w, h - 1, 3, col_d)
	rr(x, yy, w, h - 2, 3, Color("3a4a50") if disabled else col)
	var tcol := Color("7d8f94") if disabled else gd.WHITE
	text_c(label, x + w / 2.0, yy + floorf((h - 2 - 5) / 2.0), tcol, 1)
	if sub != "":
		text_c(sub, x + w / 2.0, yy + h - 8, sub_col if not disabled else tcol, 1)


func chip(x: float, y: float, w: float, h: float, val: int, col_a: Color, col_b: Color) -> void:
	rr(x, y + 2, w, h, 2, Color(0, 0, 0, 0.4))
	rr(x, y, w, h, 2, col_b)
	rr(x + 1, y + 1, w - 2, h - 2, 2, col_a)
	text_c(fmt(val), x + w / 2.0, y + floorf((h - 5) / 2.0) + 1, gd.WHITE, 1)


func draw_flames(x: float, y: float, w2: float, inten: float, cols: Array) -> void:
	if inten <= 0.02:
		return
	var n := maxi(4, int(w2 / 8.0))
	for k in range(n):
		var fx := x + 2 + k * (w2 - 5.0) / (n - 1)
		var hgt := roundf((2.0 + inten * 8.0) * (0.45 + 0.55 * absf(sin(tnow * 8.0 + k * 2.3))))
		if hgt < 1:
			continue
		pxa(fx, y - hgt, 3, hgt, Color(cols[0]), 0.7)
		pxa(fx + 1, y - hgt * 0.55, 1, hgt * 0.55, Color(cols[1]), 0.7)
		if inten > 0.4 and int(tnow * 8 + k) % 4 == 0:
			pxa(fx + 1, y - hgt - 2, 1, 2, Color(cols[2]), 0.7)


# ----------------------------------------------------------- draw scene ----
func _theme() -> Dictionary:
	if round_i == 2 and state != "title":
		return THEMES["boss"]
	return THEMES["night"]


func draw_scene_back(th: Dictionary) -> void:
	var band_h := ceilf(WATERY / th["sky"].size())
	for i in range(th["sky"].size()):
		px(0, i * band_h, W, band_h, Color(th["sky"][i]))
	if th["stars"]:
		for i in range(34):
			var sx := (i * 97 + 13) % W
			var sy := (i * 53 + 7) % 105
			var tw := sin(tnow * 1.7 + i * 2.3)
			if tw > -0.3:
				pxa(sx, sy, 1, 1, Color("cfe8f0"), 0.25 + tw * 0.3)
	var mx0 := 404.0
	var my0 := 40.0
	var mr := 24.0 if th["rain"] else 19.0
	var moon := Color(th["moon"])
	var halo := moon
	halo.a = 0.25
	fill_circle(mx0, my0, mr + 6, halo)
	fill_circle(mx0, my0, mr, moon)
	var crater := Color(0, 0, 0, 0.22)
	fill_circle(mx0 - 6, my0 - 4, 4, crater)
	fill_circle(mx0 + 5, my0 + 6, 3, crater)
	fill_circle(mx0 + 8, my0 - 7, 2, crater)
	for shaft in [[-30.0, 16.0, 0.05], [-6.0, 20.0, 0.06], [16.0, 14.0, 0.04]]:
		for d in range(11):
			var yy := my0 + 24 + d * 12
			if yy > WATERY - 12:
				break
			pxa(mx0 + shaft[0] - d * 4, yy, shaft[1], 12, moon, shaft[2])
	for k in range(3):
		var cw := 70.0 + k * 28
		var cx0 := fposmod(tnow * (4 + k * 2) + k * 210, W + cw + 60) - cw - 30
		pxa(cx0, 32 + k * 22, cw, 8, Color.BLACK, 0.16)
		pxa(cx0 + 12, 28 + k * 22, cw - 30, 6, Color.BLACK, 0.16)
	var tree_far := Color(th["treeFar"])
	var x := 0
	while x < W:
		var h1 := 34.0 + floorf(sin(x * 0.13) * 12) + float((x * 7) % 9)
		px(x, WATERY - h1, 6, h1, tree_far)
		x += 6
	var tree := Color(th["tree"])
	for blob in [[-30.0, 130.0, 66.0], [392.0, 120.0, 74.0]]:
		rr(blob[0], WATERY - blob[2], blob[1], blob[2], 4, tree)
		rr(blob[0] + blob[1] / 4, WATERY - blob[2] - 12, blob[1] / 2, 16, 4, tree)
		px(blob[0] + blob[1] / 2 - 3, WATERY - 28, 6, 28, tree)
	for k in range(9):
		var x0: float = 8 + k * 20 if k < 5 else 396 + (k - 5) * 22
		var length := 10 + (k * 37) % 14
		var sway := sin(tnow * 1.1 + k * 1.9) * 2
		var seg := 0
		while seg < length:
			px(x0 + sway * (float(seg) / length), WATERY - 62 + seg, 1, 2, tree_far)
			seg += 2
	px(0, WATERY, W, H - WATERY, Color(th["water"]))
	for k in range(8):
		var yy2 := WATERY + 4 + k * 8
		var off := sin(tnow * 1.3 + k) * (3 + k)
		pxa(mx0 - 8 + off, yy2, 14 - k, 1, moon, 0.35 - k * 0.035)
	var water_hi := Color(th["waterHi"])
	for k in range(5):
		var yy3 := WATERY + 6 + k * 13
		var off2 := sin(tnow * 0.8 + k * 2.2) * 9
		for d in range(5):
			px(fposmod(d * 100 + off2 + k * 31, W + 40) - 20, yy3, 12 + k * 2, 1, water_hi)
	var padc := Color(th["pad"])
	var padhi := Color(th["padHi"])
	for pd in [[52.0, 216.0, 20.0], [438.0, 228.0, 22.0], [88.0, 250.0, 18.0]]:
		rr(pd[0], pd[1], pd[2], 4, 2, padc)
		px(pd[0] + 2, pd[1], pd[2] - 6, 1, padhi)
		px(pd[0] + pd[2] - 4, pd[1] + 1, 3, 1, Color(th["water"]))
	px(58, 213, 2, 2, Color("e8a0c0"))
	draw_ripples(0.5)


func draw_ripples(alpha_mul: float) -> void:
	for rp in ripples:
		if rp["t"] < 0:
			continue
		var a: float = clampf(1.0 - rp["t"] / rp["life"], 0, 1) * alpha_mul * 0.6
		var rx: float = rp["r"]
		var ry: float = rp["r"] * 0.32
		for k in range(10):
			var ang := k / 10.0 * TAU
			pxa(rp["x"] + cos(ang) * rx, rp["y"] + sin(ang) * ry, 2, 1, Color("9fd8e0"), a)


func draw_scene_front(th: Dictionary) -> void:
	for m in range(2):
		for k in range(5):
			var xx := fposmod(tnow * (6 + m * 4) + k * 110 + m * 55, W + 140.0) - 70
			var mist := Color("cfe8f0")
			mist.a = 0.05 + m * 0.025
			rr(xx, WATERY - 9 + m * 5 + sin(tnow + k) * 1.5, 92, 6, 3, mist)
	pxa(0, 250, W, H - 250, Color(th["waterFront"]), 0.62)
	var water_hi := Color(th["waterHi"])
	for d in range(6):
		var off := sin(tnow * 0.9 + d * 1.7) * 7
		px(fposmod(d * 90 + off, W + 30.0) - 15, 253 + (d % 3) * 5, 16, 1, water_hi)
	draw_ripples(1.0)
	for b in bubbles:
		var a: float = (1.0 - b["t"] / 1.4) * 0.7
		if b["t"] > 1.15:
			pxa(b["x"] - 1, b["y"], 3, 1, Color("9fd8e0"), a)
			pxa(b["x"], b["y"] - 1, 1, 3, Color("9fd8e0"), a)
		else:
			pxa(b["x"], b["y"], 2, 2, Color("7fb8c8"), a)
	var reed := Color(th["reed"])
	var reed_head := Color(th["reedHead"])
	for rd in [[120.0, 26, 0], [128.0, 34, 1], [137.0, 22, 2],
			[458.0, 30, 3], [466.0, 40, 4], [473.0, 24, 5]]:
		var sway := sin(tnow * 1.4 + rd[2] * 2.1) * 2
		var seg := 0
		while seg < rd[1]:
			px(rd[0] + sway * (float(seg) / rd[1]), H - seg - 2, 1, 2, reed)
			seg += 2
		rr(rd[0] + sway - 1, H - rd[1] - 8, 3, 8, 1, reed_head)
	for f in fireflies:
		var br: float = (sin(tnow * 2.1 + f["ph"]) + 1) / 2
		if br > 0.55:
			pxa(f["x"] - 1, f["y"] - 1, 3, 3, Color("d8ff90"), (br - 0.55) * 0.16)
			px(f["x"], f["y"], 1, 1, Color("eaffa0"))
		else:
			pxa(f["x"], f["y"], 1, 1, Color("a8c870"), 0.3)
	for b in birds:
		var fl := int(b["t"] * 10) % 2
		var byo: float = 0.0 if fl == 1 else -1.0
		px(b["x"] - 2, b["y"] + byo, 2, 1, Color("0a0f12"))
		px(b["x"] + 1, b["y"] + byo, 2, 1, Color("0a0f12"))
		px(b["x"], b["y"], 1, 1, Color("0a0f12"))
	if th["rain"]:
		for d2 in rain:
			pxa(d2["x"], d2["y"], 1, 5, Color("9fb8d8"), 0.3)
			pxa(d2["x"] - 1, d2["y"] + 5, 1, 2, Color("9fb8d8"), 0.3)


# ----------------------------------------------------------- draw croc -----
func croc_style() -> Dictionary:
	if state == "title":
		return gd.CROC_STYLES["small"]
	if round_i == 2 and not boss.is_empty():
		return gd.CROC_STYLES[boss["id"]]
	if node_type == "gold":
		return gd.CROC_STYLES["gold"]
	if round_i == 1:
		return gd.CROC_STYLES["big"]
	if round_i == 0:
		return gd.CROC_STYLES["turtle"]
	return gd.CROC_STYLES["small"]


func draw_croc(close_t: float, angry := false) -> void:
	var st := croc_style()
	var a := Color(st["a"])
	var b := Color(st["b"])
	var c := Color(st["c"])
	var d := Color(st["d"])
	var flags: Array = st["flags"]
	var jaw_drop := close_t * (MAW.size.y - 26.0)
	var breathe := sin(tnow * 1.6) if (state == "play" or state == "title") else 0.0
	# tail
	var tail_x := BODY_X + BODY_W - 8
	var tail_sway := sin(tnow * 0.9) * 2
	rr(tail_x, 232, 34, 16, 4, b)
	rr(tail_x + 26, 222 + tail_sway, 22, 16, 4, b)
	rr(tail_x + 42, 212 + tail_sway * 2, 14, 14, 4, b)
	rr(tail_x + 50, 206 + tail_sway * 2, 8, 8, 3, a)
	for sp in [[tail_x + 6, 228.0], [tail_x + 20, 226.0],
			[tail_x + 32, 218 + tail_sway], [tail_x + 45, 208 + tail_sway * 2]]:
		px(sp[0], sp[1], 4, 4, a)
		px(sp[0] + 1, sp[1] - 2, 2, 2, a)
	# feet + claws
	for fx in [BODY_X - 12, BODY_X + BODY_W - 12]:
		rr(fx, 240, 24, 12, 3, b)
		rr(fx + 2, 242, 20, 8, 3, a)
		px(fx + 3, 250, 4, 3, Color("f4f0dc"))
		px(fx + 10, 250, 4, 3, Color("f4f0dc"))
		px(fx + 17, 250, 4, 3, Color("f4f0dc"))
	var lap_x := BODY_X - 18
	while lap_x < BODY_X + BODY_W + 18:
		pxa(lap_x, 245 + sin(tnow * 2.1 + lap_x * 0.31) * 1.5, 5, 1, Color("7fb8c8"), 0.45)
		lap_x += 9
	# lower jaw base
	rr(BODY_X, MAW.position.y + MAW.size.y - 6, BODY_W, 40, 4, d)
	rr(BODY_X + 1, MAW.position.y + MAW.size.y - 6, BODY_W - 2, 38, 4, b)
	rr(BODY_X + 3, MAW.position.y + MAW.size.y + 8, BODY_W - 6, 26, 4, a)
	for k in range(3):
		px(BODY_X + 16, MAW.position.y + MAW.size.y + 14 + k * 7, BODY_W - 32, 1, b)
	# maw interior
	rr(MAW.position.x - 6, MAW.position.y - 4, MAW.size.x + 12, MAW.size.y + 10, 4, Color(st["mawD"]))
	rr(MAW.position.x - 3, MAW.position.y - 1, MAW.size.x + 6, MAW.size.y + 4, 4, Color(st["maw"]))
	rr(MAW.position.x + 30, MAW.position.y + MAW.size.y - 34, MAW.size.x - 60, 28, 4, Color(st["tongue"]))
	rr(MAW.position.x + 40, MAW.position.y + MAW.size.y - 32, MAW.size.x - 80, 10, 3, Color(st["tongueHi"]))
	px(MAW.position.x + MAW.size.x / 2 - 1, MAW.position.y + MAW.size.y - 30, 2, 22, Color("a83a4e"))
	# pressable teeth
	draw_mouth_teeth()
	# lower lip
	rr(BODY_X, MAW.position.y + MAW.size.y - 2, BODY_W, 10, 3, b)
	px(BODY_X + 2, MAW.position.y + MAW.size.y - 2, BODY_W - 4, 3, d)
	# upper jaw
	var jy := MAW.position.y - 58 + jaw_drop + breathe
	rr(BODY_X - 4, jy, BODY_W + 8, 62, 4, d)
	rr(BODY_X - 3, jy + 1, BODY_W + 6, 60, 4, b)
	rr(BODY_X - 1, jy + 3, BODY_W + 2, 52, 4, a)
	rr(BODY_X + 6, jy + 5, BODY_W - 12, 10, 3, c)
	for k in range(7):
		px(BODY_X + 14 + k * 36, jy + 22 + (k % 2) * 8, 3, 3, b)
	for k in range(6):
		var sx2 := BODY_X + 20 + k * floorf((BODY_W - 44) / 5.0)
		px(sx2, jy + 17, 6, 3, b)
		px(sx2 + 1, jy + 15, 4, 2, c)
		px(sx2 + 15, jy + 36, 5, 3, b)
	for k in range(9):
		pxa(BODY_X + 12 + fmod(k * 47.0, BODY_W - 24), jy + 26 + fmod(k * 31.0, 22.0), 2, 2, d, 0.35)
	var shx := BODY_X + fposmod(tnow * 22.0, BODY_W + 60.0) - 30
	pxa(shx, jy + 4, 4, 50, Color("eafcff"), 0.08)
	pxa(shx + 8, jy + 4, 2, 50, Color("eafcff"), 0.08)
	if flags.has("ridge"):
		px(BODY_X + 10, jy + 3, BODY_W - 20, 2, b)
		px(BODY_X + 30, jy + 6, BODY_W - 60, 1, b)
	if flags.has("scars"):
		for sc2 in [[BODY_X + 30, jy + 18], [BODY_X + BODY_W - 60, jy + 26]]:
			px(sc2[0], sc2[1], 10, 2, c)
			px(sc2[0] + 2, sc2[1] - 3, 2, 8, c)
			px(sc2[0] + 6, sc2[1] - 3, 2, 8, c)
	if flags.has("moss"):
		for ms in [[BODY_X + 20, jy + 12], [BODY_X + BODY_W - 50, jy + 8], [BODY_X + 90, jy + 30]]:
			rr(ms[0], ms[1], 14, 4, 2, Color("2c5a24"))
			px(ms[0] + 3, ms[1] + 4, 3, 3, Color("2c5a24"))
	if flags.has("shell"):
		var shx2 := MAW.position.x + MAW.size.x / 2 - 42
		var shy := jy - 22
		rr(shx2, shy, 84, 24, 4, Color("4a5a2e"))
		rr(shx2 + 4, shy + 3, 76, 18, 4, Color("5c7038"))
		for k in range(3):
			px(shx2 + 14 + k * 22, shy + 6, 12, 10, Color("4a5a2e"))
		px(shx2 + 2, shy + 20, 80, 3, Color("38441e"))
	# nostrils
	rr(MAW.position.x + MAW.size.x / 2 - 34, jy + 8, 12, 8, 2, b)
	rr(MAW.position.x + MAW.size.x / 2 + 22, jy + 8, 12, 8, 2, b)
	px(MAW.position.x + MAW.size.x / 2 - 31, jy + 11, 4, 3, d)
	px(MAW.position.x + MAW.size.x / 2 + 27, jy + 11, 4, 3, d)
	# upper lip + gum
	px(BODY_X - 1, jy + 55, BODY_W + 2, 3, d)
	rr(BODY_X - 1, jy + 52, BODY_W + 2, 6, 2, b)
	px(MAW.position.x + 2, jy + 58, MAW.size.x - 4, 3, Color("a03a4a"))
	if jaw_drop > 8:
		for i in range(2):
			var dxp := MAW.position.x + 10 if i == 0 else MAW.position.x + MAW.size.x - 14
			var ph := fmod(tnow * 0.8 + i * 0.45, 1.0)
			if ph < 0.72:
				pxa(dxp, jy + 60 + ph * 30, 2, 3, Color("9fd8e0"), 0.6)
	if flags.has("fangs"):
		var fy := jy + 56
		for fx2 in [MAW.position.x - 14, MAW.position.x + MAW.size.x + 2]:
			px(fx2, fy, 10, 8, Color("f4f0dc"))
			px(fx2 + 2, fy + 8, 6, 6, Color("f4f0dc"))
			px(fx2 + 4, fy + 14, 3, 4, Color("f4f0dc"))
			px(fx2 + 8, fy + 2, 2, 8, Color("cfc8a8"))
	if flags.has("goldTooth"):
		px(MAW.position.x + 20, jy + 54, 8, 6, Color("ffd54a"))
		px(MAW.position.x + 22, jy + 55, 2, 2, Color("fff6c8"))
	# eyes
	var squeeze := close_t > 0.5 or angry
	var ey := jy - 10
	var red_eye := flags.has("redEye")
	var sleepy := flags.has("sleepy")
	for ex in [MAW.position.x + 18, MAW.position.x + MAW.size.x - 48]:
		rr(ex - 4, ey, 30, 20, 4, b)
		rr(ex - 3, ey + 1, 28, 17, 4, a)
		if squeeze:
			px(ex + 2, ey + 8, 18, 3, d)
		else:
			var blink := fmod(tnow, 4.3) > 4.15 or (sleepy and fmod(tnow, 4.3) > 3.9)
			rr(ex + 3, ey + 4, 16, 12, 3, Color("e8b0a0") if red_eye else Color(st["sclera"]))
			if blink:
				px(ex + 3, ey + 4, 16, 12, a)
			else:
				var dx := clampf((mp.x - (ex + 11)) / 60.0, -1, 1) * 3
				var dy := clampf((mp.y - (ey + 10)) / 60.0, -1, 1) * 2
				px(ex + 9 + dx, ey + 6 + dy, 4, 8, Color("8a1010") if red_eye else Color("1b1408"))
				px(ex + 10 + dx, ey + 7 + dy, 1, 2, Color.WHITE)
				if sleepy:
					px(ex + 3, ey + 4, 16, 5, a)
		px(ex - 2, ey - 2, 26, 3, d)
		if flags.has("bags"):
			px(ex + 2, ey + 17, 18, 2, Color("3a2a4a"))
			px(ex + 4, ey + 19, 14, 1, Color("3a2a4a"))
		for sc3 in [[ex - 12, ey + 4], [ex + 28, ey + 6]]:
			px(sc3[0], sc3[1], 5, 6, b)
			px(sc3[0] + 1, sc3[1] - 3, 3, 3, b)
			px(sc3[0] + 2, sc3[1] - 5, 1, 2, b)
	if flags.has("crown"):
		var kx := MAW.position.x + MAW.size.x / 2 - 14
		var ky := ey - 12
		px(kx, ky + 6, 28, 6, gd.GOLD)
		px(kx, ky, 4, 8, gd.GOLD)
		px(kx + 8, ky + 2, 4, 6, gd.GOLD)
		px(kx + 16, ky, 4, 8, gd.GOLD)
		px(kx + 24, ky + 2, 4, 6, gd.GOLD)
		px(kx + 6, ky + 8, 2, 2, gd.RED)
		px(kx + 20, ky + 8, 2, 2, Color("3f8cff"))


func draw_mouth_teeth() -> void:
	var lay := mouth_layout()
	for i in range(lay["slots"].size()):
		if i >= mouth.size():
			break
		var sl: Dictionary = lay["slots"][i]
		var s: Dictionary = mouth[i]
		if s["gone"]:
			rr(sl["x"] + 2, sl["y"] + sl["h"] - 8 if sl["up"] else sl["y"],
				sl["w"] - 4, 6, 2, Color(0, 0, 0, 0.33))
			continue
		var hov: bool = state == "play" and not s["pressed"] \
			and mp.x >= sl["x"] and mp.x < sl["x"] + sl["w"] \
			and mp.y >= sl["y"] and mp.y < sl["y"] + sl["h"]
		var ty: float = sl["y"]
		var th: float = sl["h"]
		if s["pressed"]:
			th = floorf(sl["h"] * 0.55)
			if sl["up"]:
				ty = sl["y"] + (sl["h"] - th)
		elif hov:
			ty += -2.0 if sl["up"] else 2.0
		if s["pop"] > 0:
			ty += 2.0 if sl["up"] else -2.0
		var snapping: bool = state == "snap" and snap_idx == i
		var scanning: bool = xanim["i"] == i and xanim["t"] < 0.5
		var outline := Color(0, 0, 0, 0.33)
		if hov:
			outline = gd.GOLD
		if s["revealed"] == "snap" and not s["pressed"]:
			outline = gd.RED
		if snapping:
			outline = gd.RED if int(tnow * 14) % 2 == 1 else gd.WHITE
		draw_tooth(sl["x"], ty, sl["w"], th, sl["up"], s["t"]["type"],
			s["pressed"], outline, scanning, scanning and s["revealed"] == "snap")
		if not s["pressed"] and not scanning:
			var vy: float = ty + th - 7 if sl["up"] else ty + 2
			text_c(str(s["t"]["base"]), sl["x"] + sl["w"] / 2.0, vy, Color("6d5c3a"), 1)
		if s["revealed"] == "safe" and not s["pressed"] and not scanning:
			rr(sl["x"] + sl["w"] - 7, sl["y"] - 5 if sl["up"] else sl["y"] + sl["h"] - 1,
				7, 7, 2, gd.GREEN_D)
			text("+", sl["x"] + sl["w"] - 6, (sl["y"] - 4 if sl["up"] else sl["y"] + sl["h"]),
				gd.WHITE, 1)
		if s["revealed"] == "snap" and not s["pressed"] and not scanning:
			rr(sl["x"] + sl["w"] - 7, sl["y"] - 5 if sl["up"] else sl["y"] + sl["h"] - 1,
				7, 7, 2, gd.RED_D)
			text("!", sl["x"] + sl["w"] - 5, (sl["y"] - 4 if sl["up"] else sl["y"] + sl["h"]),
				gd.WHITE, 1)


func draw_tooth(x: float, y: float, w: float, h: float, up: bool, type: String,
		pressed: bool, outline: Color, xray_on: bool, xray_snap: bool) -> void:
	var st: Dictionary = TOOTH_STYLE.get(type, TOOTH_STYLE["plain"])
	x = floorf(x)
	y = floorf(y)
	w = floorf(w)
	h = floorf(h)
	var cy := floorf(h / 2.0)
	if up:
		draw_set_transform_matrix(Transform2D(Vector2(1, 0), Vector2(0, 1), shk + Vector2(x, y)))
	else:
		draw_set_transform_matrix(Transform2D(Vector2(1, 0), Vector2(0, -1), shk + Vector2(x, y + 2 * cy)))
	var body := Color(st["b"]) if pressed else Color(st["a"])
	rr(-1, 0, w + 2, h, 3, outline)
	rr(0, 0, w, h - 3, 3, body)
	px(1, h - 4, floorf(w / 2.0) - 2, 4, body)
	px(w - floorf(w / 2.0) + 1, h - 4, floorf(w / 2.0) - 2, 4, body)
	px(w - 3, 2, 2, h - 6, Color(st["b"]))
	px(w - 2, 3, 1, h - 8, Color(st["c"]))
	px(2, h - 6, w - 5, 2, Color(st["b"]))
	pxa(2, 2, 2, maxf(2, floorf(h / 3.0)), Color.WHITE, 0.53)
	if type == "rotten":
		px(floorf(w / 2.0) - 1, 3, 3, 3, Color(st["gem"]))
		px(2, h - 9, 2, 2, Color(st["gem"]))
	elif type == "gold":
		pxa(2, floorf(h / 2.0) - 2, w - 4, 2, Color("fff6c8"), 0.67)
	elif type == "steel":
		pxa(2, floorf(h / 2.0) - 3, w - 4, 1, Color.WHITE, 0.67)
		px(2, floorf(h / 2.0) - 1, w - 4, 1, Color("77909b"))
	elif st["gem"] != "":
		var gx := floorf(w / 2.0) - 2
		var gy := floorf(h / 2.0) - 4
		var gem := Color(st["gem"])
		var gem_d := Color(st["gemD"]) if st["gemD"] != "" else gem
		px(gx + 1, gy, 3, 1, gem_d)
		px(gx, gy + 1, 5, 2, gem)
		px(gx + 1, gy + 3, 3, 1, gem_d)
		px(gx + 2, gy + 4, 1, 1, gem_d)
		pxa(gx + 1, gy + 1, 1, 1, Color.WHITE, 0.8)
	if xray_on:
		var ov := Color("0a2440")
		ov.a = 0.9
		rr(0, 0, w, h, 3, ov)
		var cxx := floorf(w / 2.0)
		px(cxx - 1, 2, 2, h - 8, Color("bfe8ff"))
		px(cxx - 3, h - 7, 2, 5, Color("bfe8ff"))
		px(cxx + 1, h - 7, 2, 5, Color("bfe8ff"))
		if xray_snap:
			px(cxx - 3, floorf(h / 2.0) - 3, 6, 2, gd.RED)
			px(cxx - 3, floorf(h / 2.0), 2, 2, gd.RED)
			px(cxx + 1, floorf(h / 2.0), 2, 2, gd.RED)
		pxa(0, floorf(fmod(xanim["t"] * 2.4, 1.0) * (h - 1)), w, 1, Color("8fe8ff"), 0.85)
	draw_set_transform(shk, 0.0, Vector2.ONE)


# ------------------------------------------------------------ draw HUD -----
func draw_sidebar() -> void:
	panel(2, 2, 110, 266, Color(0.09, 0.14, 0.17, 0.93))
	var y := 7.0
	var plate_face := Color("2c6b38")
	var plate_edge: Color = gd.GREEN
	var sub_col := Color("b8d8b8")
	var rname: String = gd.ROUND_NAMES[round_i]
	if round_i == 2:
		plate_face = Color("95251f")
		plate_edge = gd.RED
		sub_col = Color("ffb0a8")
		if not boss.is_empty():
			rname = boss["name"]
	elif round_i == 1:
		plate_face = Color("8a5a16")
		plate_edge = gd.ORANGE
		if node_type == "gold":
			rname = "GOLDEN GATOR"
	panel(7, y, 100, 26, plate_face, plate_edge)
	text_c(rname, 57, y + 4, gd.WHITE, 1)
	text_c("ANTE %d/8" % ante, 57, y + 15, sub_col, 1)
	y += 30
	if round_i == 2 and not boss.is_empty():
		panel(7, y, 100, 20, Color("33161a"), gd.RED_D)
		var rule: String = boss["rule"]
		var sp := rule.rfind(" ", 19)
		if sp < 1 or rule.length() <= 19:
			sp = mini(19, rule.length())
		text_c(rule.substr(0, sp), 57, y + 4, Color("ffb0a8"), 1)
		text_c(rule.substr(sp).strip_edges().substr(0, 19), 57, y + 11, Color("ffb0a8"), 1)
		y += 24
	panel(7, y, 100, 40, Color("131f24"))
	text("TARGET", 11, y + 4, gd.DIM, 1)
	text(fmt(target), 11, y + 12, gd.ORANGE, 1)
	text("SCORE", 11, y + 22, gd.DIM, 1)
	var ssc := 2 if disp_score < 100000 else 1
	text(fmt(int(disp_score)), 11, y + 29, gd.GOLD, ssc)
	if score_pulse > 0:
		pxa(8, y + 26, 98, 14, gd.GOLD, score_pulse * 0.5)
	px(11, y + 38, 92, 2, Color("0a1215"))
	px(11, y + 38, floorf(clampf(float(score) / target, 0, 1) * 92), 2, gd.GOLD)
	y += 44
	var t_int := clampf(pool["teeth"] / 60.0, 0, 1)
	var m_int := clampf((pool["mult"] - 1) / 8.0, 0, 1)
	draw_flames(7, y, 44, t_int, ["1565b5", "5cc8ff", "cfeaff"])
	draw_flames(63, y, 44, m_int, ["c22a20", "ff9838", "ffe089"])
	chip(7, y, 44, 16, pool["teeth"], Color("1565b5"), Color("0c3f75"))
	text_c("*", 57, y + 5, gd.RED, 2)
	chip(63, y, 44, 16, pool["mult"], Color("c22a20"), Color("801812"))
	text("TEETH", 9, y + 18, Color("7fb8e8"), 1)
	text("MULT", 65, y + 18, Color("ff9a90"), 1)
	y += 27
	panel(7, y, 100, 14, Color("252017"), Color("6b5a2a"))
	text("BITE", 11, y + 4, gd.DIM, 1)
	text(fmt(bank_value()), 37, y + 4, gd.GOLD, 1)
	y += 19
	text("BITES", 9, y + 2, gd.DIM, 1)
	for i in range(mini(bites, 6)):
		var bx := 7 + 34 + i * 12
		rr(bx + 2, y - 1, 8, 8, 2, gd.WHITE)
		px(bx + 2, y + 6, 3, 3, gd.WHITE)
		px(bx + 7, y + 6, 3, 3, gd.WHITE)
	y += 13
	text("X-RAYS", 9, y + 2, gd.DIM, 1)
	for i in range(mini(xrays, 5)):
		rr(7 + 38 + i * 11, y, 9, 9, 2, Color("123a52"))
		rr(7 + 39 + i * 11, y + 1, 7, 7, 2, Color("2277cc"))
	y += 15
	panel(7, y, 100, 18, Color("26321e"), Color("5a7a3a"))
	text("$" + str(money), 13, y + 5, gd.GOLD, 2)
	text_c("MONEY", 85, y + 7, Color("9ab87a"), 1)
	y += 23
	panel(7, y, 100, 14, Color("243a44"), Color("16262c"))
	text_c("DECK %d/%d" % [draw_pile.size(), deck.size()], 57, y + 4, gd.DIM, 1)
	text_c("BEST ANTE: %d" % best_ante, 57, 250, gd.DIM, 1)
	text_c("ESC PAUSE - M MUTE", 57, 259, Color(0.35, 0.42, 0.44), 1)


func draw_charm_row() -> void:
	text("CHARMS %d/%d" % [charms.size(), MAX_CHARMS], 120, 4, gd.DIM, 1)
	for i in range(MAX_CHARMS):
		var x := 120 + i * 31
		if i < charms.size():
			var ch: Dictionary = charms[i]
			fill_circle(x + 13, 26, 13, Color(0, 0, 0, 0.4))
			fill_circle(x + 13, 24, 12, Color("5d7a86"))
			fill_circle(x + 13, 24, 10, Color("2a3a30"))
			fill_circle(x + 13, 23, 9, Color("33463a"))
			text_c(ch["name"].substr(0, 2), x + 13, 21, gd.GOLD, 1)
			var hov := Rect2(x, 12, 26, 26).has_point(mp)
			if hov:
				panel(mp.x - 40, 44, 96, 16, Color(0.06, 0.1, 0.12, 0.96))
				text_c(ch["name"], mp.x + 8, 47, gd.WHITE, 1)
		else:
			rr(x, 12, 26, 26, 2, Color(1, 1, 1, 0.09))
			rr(x + 1, 13, 24, 24, 2, Color(0, 0, 0, 0.19))


func draw_play() -> void:
	var th := _theme()
	draw_scene_back(th)
	draw_croc(jaw_close, false)
	draw_scene_front(th)
	draw_sidebar()
	draw_charm_row()
	if mode == "xray":
		text_csh("PICK A TOOTH TO SCAN", 290, 66, Color("9fe8ff"), 1)
	var can_bank: bool = state == "play" and pool["clicks"] > 0
	button(BANK_RECT.position.x, BANK_RECT.position.y, BANK_RECT.size.x, BANK_RECT.size.y,
		"BANK BITE", Color("e8a020"), Color("98650e"), not can_bank,
		"+" + fmt(bank_value()), Color("5a3c08"))
	var xlabel := "CANCEL" if mode == "xray" else "X-RAY (%d)" % xrays
	button(XRAY_RECT.position.x, XRAY_RECT.position.y, XRAY_RECT.size.x, XRAY_RECT.size.y,
		xlabel, Color("2277cc"), Color("124a80"), xrays <= 0 and mode != "xray")
	var unpressed := 0
	var snaps_left := 0
	for s in mouth:
		if not s["pressed"] and not s["gone"]:
			unpressed += 1
			if s["snap"]:
				snaps_left += 1
	if unpressed > 0:
		var risk := roundi(100.0 * snaps_left / unpressed)
		var rc: Color = gd.GREEN
		if risk >= 34:
			rc = gd.RED
		elif risk >= 15:
			rc = gd.ORANGE
		text_csh("SNAP RISK %d%%" % risk, 428, 240, rc, 1)
		text_csh("%d %s LEFT" % [unpressed, "TOOTH" if unpressed == 1 else "TEETH"],
			428, 252, gd.DIM, 1)


# --------------------------------------------------------- draw screens ----
func draw_title() -> void:
	var th: Dictionary = THEMES["night"]
	draw_scene_back(th)
	draw_croc(jaw_close, false)
	draw_scene_front(th)
	var sc := 4
	var cx := W / 2.0
	for wrd in [["BITE", 6.0, Color("ffc843"), Color("ffd45a")],
			["DOWN", 6.0 + 5 * sc + 4, Color("63d66a"), Color("7ce67f")]]:
		var wx: float = cx - text_w(wrd[0], sc) / 2.0
		text(wrd[0], wx + 2, wrd[1] + 3, Color(0, 0, 0, 0.6), sc)
		for o in [[-2, 0], [2, 0], [0, -2], [0, 2], [-2, -2], [2, 2], [-2, 2], [2, -2]]:
			text(wrd[0], wx + o[0], wrd[1] + o[1], Color("160e1e"), sc)
		text(wrd[0], wx + 1, wrd[1], wrd[2], sc)
		text(wrd[0], wx, wrd[1], wrd[3], sc)
	var tag := "A PUSH-YOUR-LUCK DENTAL ROGUELIKE"
	rr(cx - text_w(tag, 1) / 2 - 6, 53, text_w(tag, 1) + 12, 11, 3, Color(0, 0, 0, 0.47))
	text_c(tag, cx, 56, Color("f6efd8"), 1)
	var pr := _btn_rect_play()
	button(pr.position.x, pr.position.y, pr.size.x, pr.size.y, "PLAY",
		Color("e8a020"), Color("98650e"))
	if best_ante > 0:
		text_csh("BEST ANTE: %d" % best_ante, cx, 202, gd.GOLD, 1)
	text_csh("PRESS TEETH. BANK BITES. DODGE THE SNAPPER.", cx, 216, gd.DIM, 1)
	text_csh("GODOT EDITION", cx, 240, Color(0.35, 0.42, 0.44), 1)


func draw_boss_intro() -> void:
	draw_play()
	pxa(0, 0, W, H, Color("120409"), 0.82)
	var k := clampf((tnow - bi_start) / 0.4, 0.0, 1.0)
	var name_y := 60 + (1.0 - k) * -40
	panel(90, 50, 300, 130, Color("1c0a10"), gd.RED_D, 4)
	text_csh(boss.get("name", "BOSS"), 240, name_y, gd.RED, 3)
	text_csh(boss.get("quip", ""), 240, 100, Color("ffb0a8"), 1)
	text_c(boss.get("rule", ""), 240, 124, gd.WHITE, 1)
	text_c("TARGET: " + fmt(target), 240, 144, gd.ORANGE, 1)
	if fmod(tnow, 1.0) < 0.6:
		text_csh("TAP TO FIGHT", 240, 162, gd.GOLD, 1)


func draw_snap_screen() -> void:
	draw_play()
	if snap_t > 0.22 and snap_t < 1.4:
		var lost := bank_value() if pool["clicks"] > 0 else 0
		panel(W / 2.0 + 50 - 78, 70, 156, 56 if lost > 0 else 40, Color(0.16, 0.05, 0.07, 0.93), gd.RED_D)
		text_csh("SNAP!", W / 2.0 + 50, 78, gd.RED, 4)
		if lost > 0:
			text_csh("BITE LOST: " + fmt(lost), W / 2.0 + 50, 112, Color("ffb0a8"), 1)


func draw_swap_screen() -> void:
	draw_play()
	var k := clampf(swap_t / 0.45, 0, 1)
	var a := k * 2 if k < 0.5 else (1 - k) * 2
	var col: Color = gd.GREEN
	col.a = a
	text_c("FRESH MOUTH...", W / 2.0 + 50, 92, col, 2)


func draw_roundend() -> void:
	var th := _theme()
	draw_scene_back(th)
	draw_croc(0.9, false)
	draw_scene_front(th)
	panel(W / 2.0 - 90, 60, 180, 136, Color(0.08, 0.14, 0.1, 0.95), gd.GREEN_D, 4)
	text_csh("ROUND WON!", W / 2.0, 70, gd.GREEN, 2)
	text("REWARD", W / 2.0 - 74, 94, gd.DIM, 1)
	text("$" + str(cash["base"]), W / 2.0 + 44, 94, gd.GOLD, 1)
	text("UNUSED BITES", W / 2.0 - 74, 108, gd.DIM, 1)
	text("$" + str(cash["per_bite"]), W / 2.0 + 44, 108, gd.GOLD, 1)
	text("INTEREST", W / 2.0 - 74, 122, gd.DIM, 1)
	text("$" + str(cash["interest"]), W / 2.0 + 44, 122, gd.GOLD, 1)
	px(W / 2.0 - 74, 136, 148, 1, gd.EDGE)
	text("TOTAL", W / 2.0 - 74, 144, gd.WHITE, 1)
	text("$" + str(cash["total"]), W / 2.0 + 38, 142, gd.GOLD, 2)
	var cr := _btn_rect_cash()
	button(cr.position.x, cr.position.y, cr.size.x, cr.size.y, "CASH OUT",
		Color("e8a020"), Color("98650e"))


func draw_shop() -> void:
	var th: Dictionary = THEMES["night"]
	draw_scene_back(th)
	pxa(0, 0, W, H, Color("0a0810"), 0.72)
	panel(70, 30, 340, 200, Color(0.1, 0.12, 0.16, 0.97), Color("6b5a2a"), 4)
	text_csh("EVERGLADES TRADING POST", 240, 40, gd.GOLD, 2)
	text_c("$" + str(money), 240, 60, gd.GOLD, 2)
	for k in range(shop_items.size()):
		var it: Dictionary = shop_items[k]
		var r := _shop_slot_rect(k)
		var hov: bool = r.has_point(mp) and not it["sold"]
		panel(r.position.x, r.position.y, r.size.x, r.size.y,
			Color("2a3a30") if hov else Color("1c2b33"),
			gd.GOLD if hov else gd.EDGE)
		if it["sold"]:
			text_c("SOLD", r.position.x + 32, r.position.y + 38, gd.DIM, 1)
			continue
		var def: Dictionary = it["def"]
		fill_circle(r.position.x + 32, r.position.y + 22, 13, Color("5d7a86"))
		fill_circle(r.position.x + 32, r.position.y + 22, 11, Color("2a3a30"))
		fill_circle(r.position.x + 32, r.position.y + 21, 10, Color("33463a"))
		text_c(def["name"].substr(0, 2), r.position.x + 32, r.position.y + 18, gd.GOLD, 1)
		var nm: String = def["name"]
		if nm.length() > 13:
			var sp := nm.rfind(" ", 12)
			if sp < 1:
				sp = 13
			text_c(nm.substr(0, sp), r.position.x + 32, r.position.y + 40, gd.WHITE, 1)
			text_c(nm.substr(sp + 1), r.position.x + 32, r.position.y + 47, gd.WHITE, 1)
		else:
			text_c(nm, r.position.x + 32, r.position.y + 42, gd.WHITE, 1)
		text_c("$" + str(def["cost"]), r.position.x + 32, r.position.y + 58,
			gd.GOLD if money >= def["cost"] else gd.RED, 1)
		if hov:
			panel(100, 232, 280, 18, Color(0.06, 0.1, 0.12, 0.97))
			text_c(def["desc"].substr(0, 44), 240, 237, Color("cfe0d0"), 1)
	var tr := _shop_slot_rect(3)
	var thov: bool = tr.has_point(mp) and not shop_tooth["sold"]
	panel(tr.position.x, tr.position.y, tr.size.x, tr.size.y,
		Color("2a3a30") if thov else Color("1c2b33"),
		gd.GOLD if thov else gd.EDGE)
	if shop_tooth["sold"]:
		text_c("SOLD", tr.position.x + 32, tr.position.y + 38, gd.DIM, 1)
	else:
		draw_tooth(tr.position.x + 22, tr.position.y + 12, 20, 26, true,
			shop_tooth["type"], false, Color(0, 0, 0, 0.33), false, false)
		text_c(gd.TOOTH_DEFS[shop_tooth["type"]]["name"].replace(" TOOTH", ""),
			tr.position.x + 32, tr.position.y + 44, gd.WHITE, 1)
		text_c("$" + str(shop_tooth["cost"]), tr.position.x + 32, tr.position.y + 58,
			gd.GOLD if money >= shop_tooth["cost"] else gd.RED, 1)
		if thov:
			panel(100, 232, 280, 18, Color(0.06, 0.1, 0.12, 0.97))
			text_c(gd.TOOTH_DEFS[shop_tooth["type"]]["desc"] + " - ADDS TO YOUR DECK",
				240, 237, Color("cfe0d0"), 1)
	button(120, 196, 100, 20, "REROLL $%d" % reroll_cost, Color("2277cc"), Color("124a80"),
		money < reroll_cost)
	button(260, 196, 100, 20, "HIT THE TRAIL", Color("e8a020"), Color("98650e"))


func draw_gameover() -> void:
	var th := _theme()
	draw_scene_back(th)
	draw_croc(1.0, true)
	draw_scene_front(th)
	pxa(0, 0, W, H, Color("120409"), 0.6)
	panel(W / 2.0 - 100, 62, 200, 120, Color(0.14, 0.05, 0.06, 0.95), gd.RED_D, 4)
	text_csh("THE SWAMP WINS", W / 2.0, 74, gd.RED, 2)
	text_c("YOU REACHED ANTE %d" % ante, W / 2.0, 104, gd.WHITE, 1)
	text_c("BEST: ANTE %d" % best_ante, W / 2.0, 118, gd.GOLD, 1)
	text_c("THE GATOR KEEPS YOUR FINGERS", W / 2.0, 136, gd.DIM, 1)
	var pr := _btn_rect_play()
	button(pr.position.x, pr.position.y, pr.size.x, pr.size.y, "TRY AGAIN",
		Color("e8a020"), Color("98650e"))


func draw_win() -> void:
	var th: Dictionary = THEMES["night"]
	draw_scene_back(th)
	draw_croc(0.15, false)
	draw_scene_front(th)
	panel(W / 2.0 - 110, 56, 220, 126, Color(0.1, 0.14, 0.08, 0.95), gd.GOLD_D, 4)
	text_csh("SWAMP CHAMPION!", W / 2.0, 68, gd.GOLD, 2)
	text_c("ALL 8 ANTES CONQUERED", W / 2.0, 96, gd.WHITE, 1)
	text_c("THE APEX PREDATOR BOWS TO YOU", W / 2.0, 110, gd.GREEN, 1)
	text_c("FINAL PURSE: $%d" % money, W / 2.0, 130, gd.GOLD, 1)
	if int(tnow * 2) % 2 == 0:
		for i in range(6):
			var fx := W / 2.0 - 90 + i * 36 + sin(tnow * 3 + i) * 6
			px(fx, 60 + fmod(tnow * 30 + i * 17, 110.0), 2, 2,
				[gd.GOLD, gd.GREEN, gd.BLUE, gd.PURPLE][i % 4])
	var pr := _btn_rect_play()
	button(pr.position.x, pr.position.y, pr.size.x, pr.size.y, "PLAY AGAIN",
		Color("e8a020"), Color("98650e"))


func draw_hand() -> void:
	if mp.x < -20:
		return
	var hx := floorf(mp.x)
	var hy := floorf(mp.y)
	px(hx, hy, 2, 8, Color("0b1416"))
	px(hx + 1, hy + 1, 2, 7, Color("e8b088"))
	px(hx + 1, hy + 7, 6, 5, Color("e8b088"))
	px(hx + 2, hy + 8, 5, 3, Color("c07850"))
	px(hx + 1, hy + 11, 6, 2, Color("3a5560"))
	px(hx + 1, hy + 1, 1, 6, Color("f8d0a8"))


# --------------------------------------------------------------- _draw -----
func _draw() -> void:
	draw_set_transform(shk, 0.0, Vector2.ONE)
	match state:
		"title":
			draw_title()
		"play":
			draw_play()
		"snap":
			draw_snap_screen()
		"swap":
			draw_swap_screen()
		"bossintro":
			draw_boss_intro()
		"roundend":
			draw_roundend()
		"shop":
			draw_shop()
		"gameover":
			draw_gameover()
		"win":
			draw_win()
	for pt in parts:
		var a: float = clampf(1.0 - pt["t"] / pt["life"], 0, 1)
		pxa(pt["x"], pt["y"], pt["sz"], pt["sz"], pt["col"], a)
	for fl in floats:
		var k: float = fl["t"] / fl["life"]
		var rise := (1.0 - (1.0 - k) * (1.0 - k)) * 24.0
		var a2 := 1.0 if k < 0.7 else (1.0 - k) / 0.3
		var col: Color = fl["col"]
		col.a = a2
		var fx: float = fl["x"] - text_w(fl["txt"], fl["sc"]) / 2.0
		var fy: float = fl["y"] - rise
		var shc := Color(0, 0, 0, 0.56 * a2)
		text(fl["txt"], fx, fy + fl["sc"], shc, fl["sc"])
		text(fl["txt"], fx, fy, col, fl["sc"])
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	if flash_red > 0:
		pxa(0, 0, W, H, Color("a01818"), flash_red * 1.4)
	if paused:
		pxa(0, 0, W, H, Color("06080a"), 0.72)
		text_csh("PAUSED", W / 2.0, 108, gd.WHITE, 3)
		text_c("TAP TO RESUME", W / 2.0, 140, gd.DIM, 1)
		text_c("Q - QUIT TO TITLE", W / 2.0, 152, gd.DIM, 1)
	draw_hand()

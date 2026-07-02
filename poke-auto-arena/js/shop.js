// ── shop.js ── shop phase: rolls, buying, merging, selling, catch flow ────
const Shop = (() => {
  const UNIT_COST = 3;
  const REROLL_COST = 1;
  const DEPLOY_COST = 3;

  const run = () => G.s.run;

  function unitSlots(turn) { return turn >= 9 ? 5 : turn >= 5 ? 4 : 3; }
  function maxShopTier(turn) { return U.clamp(Math.ceil(turn / 2), 1, 6); }

  // Goods that can appear next to Pokémon in the shop
  function goodsPool(turn) {
    const pool = [
      { kind: 'mat', id: 'berry', cost: 1, w: 3 },
      { kind: 'mat', id: 'apricorn', cost: 1, w: 3 },
      { kind: 'item', id: 'pokeball', cost: 3, w: 3 },
      { kind: 'mat', id: 'stardust', cost: 2, w: 2 },
      { kind: 'item', id: 'expcandy', cost: 4, w: 1.5 },
    ];
    if (turn >= 5) pool.push({ kind: 'item', id: 'greatball', cost: 5, w: 1.5 });
    if (turn >= 5) pool.push({ kind: 'heldRandom', id: null, cost: 6, w: 1.2 });
    if (turn >= 9) pool.push({ kind: 'item', id: 'ultraball', cost: 7, w: 1 });
    return pool;
  }

  function roll(free) {
    const r = run();
    if (!r) return;
    if (!free) {
      if (r.gold < REROLL_COST) return false;
      r.gold -= REROLL_COST;
    }
    const turn = r.turn;
    const tierCap = maxShopTier(turn);
    const pool = DATA.shopLines.filter(l => l.tier <= tierCap);
    // higher tiers slightly favored once unlocked, newest tier boosted
    const uslots = unitSlots(turn);
    const kept = r.shop.units.filter(x => x.frozen);
    r.shop.units = kept.slice(0, uslots);
    while (r.shop.units.length < uslots) {
      const lineDef = U.pickW(pool, l => l.tier === tierCap ? l.tier + 3 : l.tier);
      r.shop.units.push({ line: lineDef.id, cost: UNIT_COST, frozen: false });
    }
    const keptG = r.shop.goods.filter(x => x.frozen);
    r.shop.goods = keptG.slice(0, 2);
    const gp = goodsPool(turn);
    while (r.shop.goods.length < 2) {
      const g = U.pickW(gp, x => x.w);
      const id = g.kind === 'heldRandom' ? U.pick(Object.keys(DATA.ITEMS).filter(k => DATA.ITEMS[k].kind === 'held')) : g.id;
      r.shop.goods.push({ kind: g.kind === 'heldRandom' ? 'item' : g.kind, id, cost: g.cost, frozen: false });
    }
    G.save();
    return true;
  }

  // Buy shop unit at index → auto-merge into same line on team, else first empty slot.
  // Returns {ok, msg, evolved, newDex}
  function buyUnit(i) {
    const r = run();
    const offer = r.shop.units[i];
    if (!offer) return { ok: false, msg: 'Nothing there.' };
    if (r.gold < offer.cost) return { ok: false, msg: 'Not enough gold.' };
    const team = r.team;
    const mergeTarget = team.find(u => u && u.line === offer.line && u.xp < G.XP_MAX);
    let evolved = null, newDex = null, unit = null;
    if (mergeTarget) {
      const res = G.mergeUnits(mergeTarget, G.makeUnit(offer.line));
      evolved = res.evolved; newDex = res.newDex; unit = mergeTarget;
    } else {
      const slot = G.firstEmptySlot();
      if (slot < 0) return { ok: false, msg: 'Team is full — sell or merge first.' };
      unit = G.makeUnit(offer.line);
      team[slot] = unit;
      newDex = G.registerDex(unit);
    }
    r.gold -= offer.cost;
    r.shop.units.splice(i, 1);
    G.save();
    return { ok: true, unit, evolved, newDex };
  }

  function buyGood(i) {
    const r = run();
    const offer = r.shop.goods[i];
    if (!offer) return { ok: false, msg: 'Nothing there.' };
    if (r.gold < offer.cost) return { ok: false, msg: 'Not enough gold.' };
    r.gold -= offer.cost;
    if (offer.kind === 'mat') G.addMat(offer.id, 1);
    else G.addItem(offer.id, 1);
    r.shop.goods.splice(i, 1);
    G.save();
    const name = offer.kind === 'mat' ? DATA.MATS[offer.id].name : DATA.ITEMS[offer.id].name;
    return { ok: true, msg: name + ' added to bag.' };
  }

  function sellUnit(slot) {
    const r = run();
    const u = r.team[slot];
    if (!u) return { ok: false };
    const lv = G.levelOf(u.xp);
    const gold = lv;                              // 1/2/3 gold by level
    const ess = G.lineOf(u).tier;                 // plus essence by tier
    if (u.item) G.addItem(u.item, 1);             // held item returns to bag
    r.team[slot] = null;
    r.gold += gold;
    G.addMat('essence', ess);
    G.save();
    return { ok: true, gold, ess, name: G.spec(u).name };
  }

  // Deploy a Box Pokémon into the run (costs gold, merges if possible)
  function deployFromBox(uid) {
    const r = run();
    if (!r) return { ok: false, msg: 'No active run.' };
    if (r.gold < DEPLOY_COST) return { ok: false, msg: 'Need ' + DEPLOY_COST + ' gold to deploy.' };
    const idx = G.s.meta.box.findIndex(x => x.uid === uid);
    if (idx < 0) return { ok: false, msg: 'Not in box.' };
    const u = G.s.meta.box[idx];
    const mergeTarget = r.team.find(t => t && t.line === u.line && t.xp < G.XP_MAX);
    if (mergeTarget) {
      G.s.meta.box.splice(idx, 1);
      const res = G.mergeUnits(mergeTarget, u);
      r.gold -= DEPLOY_COST;
      G.save();
      return { ok: true, merged: true, evolved: res.evolved, unit: mergeTarget };
    }
    const slot = G.firstEmptySlot();
    if (slot < 0) return { ok: false, msg: 'Team is full.' };
    G.s.meta.box.splice(idx, 1);
    r.team[slot] = u;
    r.gold -= DEPLOY_COST;
    G.save();
    return { ok: true, merged: false, unit: u };
  }

  // Feed a candy item to a team unit
  function feedCandy(slot, itemId) {
    const r = run();
    const u = r && r.team[slot];
    const it = DATA.ITEMS[itemId];
    if (!u || !it || it.kind !== 'consumable' || G.itemCount(itemId) < 1) return { ok: false };
    if (u.xp >= G.XP_MAX) return { ok: false, msg: 'Already max level!' };
    G.addItem(itemId, -1);
    const res = G.gainXp(u, it.xp);
    G.save();
    return { ok: true, res, unit: u };
  }

  function equipItem(slot, itemId) {
    const r = run();
    const u = r && r.team[slot];
    const it = DATA.ITEMS[itemId];
    if (!u || !it || it.kind !== 'held' || G.itemCount(itemId) < 1) return { ok: false };
    G.addItem(itemId, -1);
    if (u.item) G.addItem(u.item, 1);
    u.item = itemId;
    G.save();
    return { ok: true };
  }
  function unequipItem(slot) {
    const r = run();
    const u = r && r.team[slot];
    if (!u || !u.item) return { ok: false };
    G.addItem(u.item, 1);
    u.item = null;
    G.save();
    return { ok: true };
  }

  // ── Battle rewards ──
  function lootRoll(turn, won) {
    const loot = { mats: {}, items: {}, chests: [], eggs: [], trophies: 0 };
    if (!won) {
      if (U.chance(.5)) loot.mats.berry = 1;
      return loot;
    }
    loot.trophies = 1;
    const rolls = 2 + (U.chance(.5) ? 1 : 0);
    for (let i = 0; i < rolls; i++) {
      const m = U.pickW([['berry', 3], ['apricorn', 2.5], ['stardust', 2], ['iron', 1.5]], x => x[1])[0];
      loot.mats[m] = (loot.mats[m] || 0) + U.rint(1, 2);
    }
    if (U.chance(.12)) loot.items.pokeball = 1;
    return loot;
  }

  // Milestones on win count within the run. Returns array of {kind, id|msg}
  function winMilestones(wins) {
    const out = [];
    if (wins % 10 === 0) {
      out.push({ kind: 'badge' });
      out.push({ kind: 'chest', id: wins >= 20 ? 'mysticchest' : 'goldchest' });
      out.push({ kind: 'egg', id: wins >= 30 ? 'legendegg' : wins >= 20 ? 'epicegg' : 'rareegg' });
    } else if (wins % 10 === 5) {
      out.push({ kind: 'egg', id: wins >= 15 ? 'rareegg' : 'basicegg' });
    } else if (wins % 3 === 0) {
      out.push({ kind: 'chest', id: wins >= 12 ? 'silverchest' : 'woodchest' });
    }
    return out;
  }

  // ── Catching ──
  function catchChance(ballId, enemy) {
    const ball = DATA.ITEMS[ballId];
    if (!ball || ball.kind !== 'ball') return 0;
    if (ballId === 'masterball') return 1;
    let c = ball.rate - (enemy.tier - 1) * .05;
    if (enemy.fainted) c += .15;
    if (enemy.level >= 2) c -= .05 * (enemy.level - 1);
    if (DATA.LINE_MAP[enemy.lineId].legendary) c = Math.min(c, .4);
    return U.clamp(c, .05, .95);
  }

  // Attempt the catch. Enemy snapshot {lineId, level, fainted}. Returns {ok, caught, unit?}
  function attemptCatch(ballId, enemy) {
    if (G.itemCount(ballId) < 1) return { ok: false, msg: 'No ' + DATA.ITEMS[ballId].name + ' left!' };
    G.addItem(ballId, -1);
    const c = catchChance(ballId, enemy);
    const caught = U.chance(c);
    if (!caught) { G.save(); return { ok: true, caught: false }; }
    const xp = enemy.level === 3 ? 6 : enemy.level === 2 ? 3 : 1;
    const unit = G.makeUnit(enemy.lineId, { xp, bAtk: Math.max(0, xp - 1), bHp: Math.max(0, xp - 1) });
    G.boxAdd(unit);
    G.s.meta.stats.catches++;
    G.save();
    return { ok: true, caught: true, unit };
  }

  return { UNIT_COST, REROLL_COST, DEPLOY_COST, unitSlots, roll, buyUnit, buyGood, sellUnit, deployFromBox, feedCandy, equipItem, unequipItem, lootRoll, winMilestones, catchChance, attemptCatch };
})();

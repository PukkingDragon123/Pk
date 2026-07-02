// ── idle.js ── camp income (works while away), nursery timers, eggs, chests ──
const Idle = (() => {
  const CAP_HOURS = 12;          // camp accrues for at most 12h unattended
  const MAX_SLOTS = 6;

  // Per-minute camp rates grow with your Pokédex and badges
  function rates() {
    const dex = G.dexCount();
    const badges = G.s.meta.badges;
    const mult = 1 + dex * 0.03 + badges * 0.15;
    return {
      berry: 0.10 * mult,
      apricorn: 0.06 * mult,
      stardust: 0.04 * mult,
      iron: 0.025 * mult,
      mult,
    };
  }

  // Collect camp income accrued since last collection. Returns {mins, gains} or null.
  function collectCamp(silent) {
    const camp = G.s.meta.camp;
    const now = Date.now();
    const mins = Math.min((now - camp.last) / 60000, CAP_HOURS * 60);
    if (mins < 1) return null;
    const r = rates();
    const gains = {};
    for (const m of ['berry', 'apricorn', 'stardust', 'iron']) {
      const amt = Math.floor(r[m] * mins);
      if (amt > 0) { gains[m] = amt; G.addMat(m, amt); }
    }
    camp.last = now;
    if (!silent) G.save();
    if (!Object.keys(gains).length) return null;
    return { mins: Math.floor(mins), gains, capped: mins >= CAP_HOURS * 60 };
  }
  function campProgress() {
    const mins = Math.min((Date.now() - G.s.meta.camp.last) / 60000, CAP_HOURS * 60);
    return { mins, capMins: CAP_HOURS * 60 };
  }

  // ── Nursery: eggs & chests tick in real time ──
  const nursery = () => G.s.meta.nursery;
  const defOf = (t) => t.kind === 'egg' ? DATA.EGGS[t.defId] : DATA.CHESTS[t.defId];

  function addToStorage(kind, defId) {
    nursery().storage.push({ kind, defId });
    G.save();
  }
  function startTimer(storageIdx) {
    const n = nursery();
    if (n.active.length >= n.slots) return { ok: false, msg: 'All nursery slots are busy.' };
    const item = n.storage[storageIdx];
    if (!item) return { ok: false };
    n.storage.splice(storageIdx, 1);
    const def = item.kind === 'egg' ? DATA.EGGS[item.defId] : DATA.CHESTS[item.defId];
    n.active.push({ id: U.uid(), kind: item.kind, defId: item.defId, start: Date.now(), dur: def.mins * 60000 });
    G.save();
    return { ok: true };
  }
  const remaining = (t) => Math.max(0, t.start + t.dur - Date.now());
  const isReady = (t) => remaining(t) <= 0;
  function readyCount() { return nursery().active.filter(isReady).length; }

  // Claim a finished timer → rewards. Returns {kind, ...}
  function claim(timerId) {
    const n = nursery();
    const idx = n.active.findIndex(t => t.id === timerId);
    if (idx < 0) return null;
    const t = n.active[idx];
    if (!isReady(t)) return null;
    n.active.splice(idx, 1);
    let result;
    if (t.kind === 'egg') result = hatchEgg(t.defId);
    else result = openChest(t.defId);
    G.save();
    return result;
  }

  function hatchEgg(defId) {
    const def = DATA.EGGS[defId];
    let lineDef;
    if (U.chance(def.legendChance)) {
      lineDef = U.pick(DATA.LINES.filter(l => l.legendary));
    } else {
      const pool = DATA.LINES.filter(l => !l.legendary && def.tiers.includes(l.tier));
      lineDef = U.pick(pool);
    }
    const lv2 = U.chance(def.lv2Chance);
    const unit = G.makeUnit(lineDef.id, lv2 ? { xp: 3, bAtk: 2, bHp: 2 } : {});
    G.boxAdd(unit);
    G.s.meta.stats.hatches++;
    return { kind: 'egg', defId, unit, newDex: G.s.meta.dex[G.spec(unit).id] ? null : G.spec(unit) };
  }

  function openChest(defId) {
    const loot = { mats: {}, items: {}, eggs: [] };
    const addM = (m, n) => { loot.mats[m] = (loot.mats[m] || 0) + n; G.addMat(m, n); };
    const addI = (i, n) => { loot.items[i] = (loot.items[i] || 0) + n; G.addItem(i, n); };
    const heldPool = Object.keys(DATA.ITEMS).filter(k => DATA.ITEMS[k].kind === 'held');
    if (defId === 'woodchest') {
      addM('berry', U.rint(2, 4)); addM('apricorn', U.rint(1, 3));
      if (U.chance(.4)) addI('pokeball', 1);
      if (U.chance(.2)) addM('stardust', 1);
    } else if (defId === 'silverchest') {
      addM('berry', U.rint(3, 6)); addM('apricorn', U.rint(2, 4)); addM('stardust', U.rint(1, 3)); addM('iron', U.rint(1, 3));
      addI(U.chance(.6) ? 'pokeball' : 'greatball', 1);
      if (U.chance(.2)) addI(U.pick(heldPool), 1);
    } else if (defId === 'goldchest') {
      addM('berry', U.rint(5, 9)); addM('apricorn', U.rint(3, 6)); addM('stardust', U.rint(2, 5)); addM('iron', U.rint(2, 4)); addM('essence', U.rint(1, 3));
      addI(U.chance(.5) ? 'greatball' : 'ultraball', 1);
      addI('expcandy', 1);
      if (U.chance(.45)) addI(U.pick(heldPool), 1);
      if (U.chance(.3)) { loot.eggs.push('rareegg'); nursery().storage.push({ kind: 'egg', defId: 'rareegg' }); }
    } else { // mysticchest
      addM('berry', U.rint(7, 12)); addM('apricorn', U.rint(5, 8)); addM('stardust', U.rint(4, 8)); addM('iron', U.rint(3, 6)); addM('essence', U.rint(2, 5));
      addI('ultraball', 1);
      addI(U.chance(.5) ? 'rarecandy' : 'expcandy', 1);
      addI(U.pick(heldPool), 1);
      if (U.chance(.5)) { const e = U.chance(.3) ? 'legendegg' : 'epicegg'; loot.eggs.push(e); nursery().storage.push({ kind: 'egg', defId: e }); }
    }
    return { kind: 'chest', defId, loot };
  }

  function buyNurserySlot() {
    const n = nursery();
    if (n.slots >= MAX_SLOTS) return { ok: false, msg: 'Nursery is maxed out.' };
    n.slots++;
    G.save();
    return { ok: true };
  }

  // Summary of everything that happened while the tab was closed
  function awayReport() {
    const away = Date.now() - (G.s.lastSeen || Date.now());
    if (away < 5 * 60000) return null;   // only show after 5+ minutes away
    const camp = collectCamp(true);
    const ready = readyCount();
    if (!camp && !ready) return null;
    return { awayMs: away, camp, ready };
  }

  return { CAP_HOURS, MAX_SLOTS, rates, collectCamp, campProgress, nursery, defOf, addToStorage, startTimer, remaining, isReady, readyCount, claim, buyNurserySlot, awayReport };
})();

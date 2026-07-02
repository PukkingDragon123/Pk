// ── state.js ── save state, units, xp/evolution, inventory, dex ──────────
const G = (() => {
  const SAVE_KEY = 'pokeAutoArena.save.v1';
  const TEAM_SIZE = 5;
  const XP_MAX = 6; // lv1 = 1xp, lv2 = 3xp, lv3 = 6xp (SAP-style)

  let s = null;

  const levelOf = (xp) => xp >= 6 ? 3 : xp >= 3 ? 2 : 1;
  const xpToNext = (xp) => xp >= 6 ? null : xp >= 3 ? 6 - xp : 3 - xp;

  function freshMeta() {
    return {
      trophies: 0, badges: 0,
      mats: { berry: 6, apricorn: 4, stardust: 2, iron: 2, essence: 0 },
      items: { pokeball: 2 },
      box: [],
      dex: {},                       // speciesId -> true (seen = owned at some point)
      nursery: { slots: 3, active: [], storage: [{ kind: 'egg', defId: 'basicegg' }, { kind: 'chest', defId: 'woodchest' }] },
      camp: { last: Date.now() },
      stats: { runs: 0, battles: 0, wins: 0, losses: 0, catches: 0, hatches: 0, crafts: 0, bestWins: 0, released: 0 },
      seenIntro: false,
    };
  }

  function freshState() {
    return { v: 1, meta: freshMeta(), run: null, lastSeen: Date.now() };
  }

  function save() {
    try {
      s.lastSeen = Date.now();
      localStorage.setItem(SAVE_KEY, JSON.stringify(s));
    } catch (e) { console.warn('save failed', e); }
  }

  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.v === 1 && parsed.meta) { s = parsed; return true; }
      }
    } catch (e) { console.warn('load failed', e); }
    s = freshState();
    return false;
  }

  function hardReset() { s = freshState(); save(); }

  function exportSave() { return btoa(unescape(encodeURIComponent(JSON.stringify(s)))); }
  function importSave(str) {
    try {
      const parsed = JSON.parse(decodeURIComponent(escape(atob(str.trim()))));
      if (!parsed || parsed.v !== 1 || !parsed.meta) return false;
      s = parsed; save(); return true;
    } catch (e) { return false; }
  }

  // ── Units ──
  // unit = { uid, line, xp, bAtk, bHp, item }
  function makeUnit(lineId, opts) {
    opts = opts || {};
    return { uid: U.uid(), line: lineId, xp: opts.xp || 1, bAtk: opts.bAtk || 0, bHp: opts.bHp || 0, item: opts.item || null };
  }
  const spec = (u) => DATA.speciesAt(u.line, levelOf(u.xp));
  const lineOf = (u) => DATA.LINE_MAP[u.line];

  function itemAtkBonus(u) {
    if (!u.item) return 0;
    const it = DATA.ITEMS[u.item];
    let b = 0;
    if (it.boost && it.boost === lineOf(u).type) b += 2;
    if (u.item === 'choiceband') b += 3;
    return b;
  }
  const itemHpBonus = (u) => u.item === 'assaultvest' ? 6 : 0;
  const atkOf = (u) => spec(u).atk + u.bAtk + itemAtkBonus(u);
  const hpOf = (u) => spec(u).hp + u.bHp + itemHpBonus(u);

  function registerDex(u) {
    const sp = spec(u);
    if (!s.meta.dex[sp.id]) {
      s.meta.dex[sp.id] = true;
      s.meta.mats.stardust += 2; // new dex entry bonus
      return sp;
    }
    return null;
  }
  const dexCount = () => Object.keys(s.meta.dex).length;
  const dexTotal = () => Object.keys(DATA.SPECIES).length;

  // Feed xp into a unit; returns {gained, evolved: species|null, newDex: species|null}
  function gainXp(u, n) {
    const before = levelOf(u.xp);
    const gained = Math.min(XP_MAX - u.xp, n);
    if (gained <= 0) return { gained: 0, evolved: null, newDex: null };
    u.xp += gained;
    u.bAtk += gained; u.bHp += gained; // every xp point = +1/+1, SAP-style
    const evolved = levelOf(u.xp) > before ? spec(u) : null;
    const newDex = registerDex(u);
    return { gained, evolved, newDex };
  }

  const canMerge = (a, b) => !!a && !!b && a.uid !== b.uid && a.line === b.line && a.xp < XP_MAX;

  // Merge source into target (target stays). Returns gainXp result.
  function mergeUnits(target, source) {
    target.bAtk = Math.max(target.bAtk, source.bAtk);
    target.bHp = Math.max(target.bHp, source.bHp);
    const res = gainXp(target, source.xp);
    if (source.item) {
      if (!target.item) target.item = source.item;
      else addItem(source.item, 1); // no room — send spare item back to the bag
    }
    return res;
  }

  // ── Inventory ──
  const matCount = (m) => s.meta.mats[m] || 0;
  function addMat(m, n) { s.meta.mats[m] = (s.meta.mats[m] || 0) + n; }
  const itemCount = (id) => s.meta.items[id] || 0;
  function addItem(id, n) { s.meta.items[id] = (s.meta.items[id] || 0) + n; if (s.meta.items[id] <= 0) delete s.meta.items[id]; }
  function canAfford(cost) { return Object.entries(cost).every(([m, q]) => matCount(m) >= q); }
  function payCost(cost) { for (const [m, q] of Object.entries(cost)) s.meta.mats[m] -= q; }

  // ── Run lifecycle ──
  function newRun() {
    s.meta.stats.runs++;
    s.run = {
      turn: 1, gold: 10, hearts: 5, wins: 0, streak: 0,
      team: [null, null, null, null, null],
      shop: { units: [], goods: [] },
      log: [],
    };
    Shop.roll(true);
    save();
  }
  function endRun() {
    if (!s.run) return;
    s.meta.stats.bestWins = Math.max(s.meta.stats.bestWins, s.run.wins);
    s.run = null;
    save();
  }

  const team = () => s.run ? s.run.team : [];
  const teamUnits = () => team().filter(Boolean);
  function firstEmptySlot() { const t = team(); for (let i = 0; i < TEAM_SIZE; i++) if (!t[i]) return i; return -1; }

  // Box (meta collection, persists across runs)
  function boxAdd(u) { s.meta.box.push(u); registerDex(u); }
  function boxRemove(uid) { const i = s.meta.box.findIndex(x => x.uid === uid); if (i >= 0) return s.meta.box.splice(i, 1)[0]; return null; }
  function releaseUnit(u) { // → essence by tier & level
    const amt = lineOf(u).tier + (levelOf(u.xp) - 1) * 2;
    addMat('essence', amt);
    s.meta.stats.released++;
    return amt;
  }

  load();
  return {
    get s() { return s; },
    TEAM_SIZE, XP_MAX,
    save, load, hardReset, exportSave, importSave,
    levelOf, xpToNext, makeUnit, spec, lineOf, atkOf, hpOf, itemAtkBonus, itemHpBonus,
    gainXp, canMerge, mergeUnits, registerDex, dexCount, dexTotal,
    matCount, addMat, itemCount, addItem, canAfford, payCost,
    newRun, endRun, team, teamUnits, firstEmptySlot,
    boxAdd, boxRemove, releaseUnit,
  };
})();

// ── ui.js ── all rendering & interaction ─────────────────────────────────
const UI = (() => {
  let tab = 'shop';
  let speed = 1;
  let inBattle = false;

  const $ = (sel) => document.querySelector(sel);
  const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; };

  // ── Toasts ──
  function toast(msg, cls) {
    const t = el(`<div class="toast ${cls || ''}">${msg}</div>`);
    $('#toast-root').appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, 2400);
  }

  // ── Modals ──
  function modal(html, opts) {
    opts = opts || {};
    const wrap = el(`<div class="modal-wrap"><div class="modal">${html}</div></div>`);
    if (!opts.sticky) wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    function close() { wrap.remove(); if (opts.onClose) opts.onClose(); }
    wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    $('#modal-root').appendChild(wrap);
    return { wrap, close };
  }

  // ── Small shared renderers ──
  const typeChip = (t) => { const ty = DATA.TYPES[t]; return `<span class="type-chip" style="background:${ty.color}">${ty.icon} ${ty.name}</span>`; };
  const matChip = (m, n) => `<span class="mat-chip">${DATA.MATS[m].icon}${n !== undefined ? ' ' + n : ''}</span>`;
  const lvlPips = (lv) => `<span class="pips">${'●'.repeat(lv)}${'○'.repeat(3 - lv)}</span>`;

  function costChips(cost) {
    return Object.entries(cost).map(([m, q]) => {
      const ok = G.matCount(m) >= q;
      return `<span class="mat-chip ${ok ? '' : 'lack'}">${DATA.MATS[m].icon} ${q}</span>`;
    }).join('');
  }

  function unitCardHTML(u, extraCls, footer) {
    const sp = G.spec(u), lv = G.levelOf(u.xp), ty = DATA.TYPES[G.lineOf(u).type];
    const item = u.item ? `<span class="card-item" title="${DATA.ITEMS[u.item].name}">${DATA.ITEMS[u.item].icon}</span>` : '';
    return `<div class="unit-card ${extraCls || ''}" style="--tc:${ty.color}">
      <div class="card-top">${lvlPips(lv)}${item}</div>
      <div class="card-emoji">${sp.emoji}</div>
      <div class="card-name">${sp.name}</div>
      <div class="card-stats"><span class="atk">⚔️ ${G.atkOf(u)}</span><span class="hp">♥ ${G.hpOf(u)}</span></div>
      ${footer || ''}
    </div>`;
  }

  // ── Header ──
  function renderHeader() {
    const m = G.s.meta, r = G.s.run;
    const runPart = r
      ? `<span class="stat" title="Hearts — lose one per defeat">❤️ ${r.hearts}</span>
         <span class="stat" title="Gold this turn">🪙 ${r.gold}</span>
         <span class="stat" title="Turn">🎲 ${r.turn}</span>
         <span class="stat" title="Wins this run (10 = badge)">🏆 ${r.wins}</span>`
      : `<span class="stat dim">no active run</span>`;
    $('#topbar').innerHTML = `
      <div class="brand">⚡ Poké Auto Arena</div>
      <div class="hstats">${runPart}
        <span class="stat" title="Trophies — spend in the Trophy Exchange">🎖️ ${m.trophies}</span>
        <span class="stat" title="League badges">📛 ${m.badges}</span>
      </div>
      <div class="hmats">${['berry', 'apricorn', 'stardust', 'iron', 'essence'].map(x => `<span class="stat sm" title="${DATA.MATS[x].name}">${DATA.MATS[x].icon}${G.matCount(x)}</span>`).join('')}</div>`;
  }

  // ── Tabs ──
  const TABS = [
    ['shop', '🛒', 'Shop'], ['box', '📦', 'Box'], ['dex', '📖', 'Dex'],
    ['craft', '🛠️', 'Craft'], ['nursery', '🪺', 'Nursery'], ['camp', '🏕️', 'Camp'],
  ];
  function renderTabs() {
    $('#tabs').innerHTML = TABS.map(([id, icon, name]) => {
      const dot = id === 'nursery' && Idle.readyCount() > 0 ? '<span class="dot"></span>' : '';
      return `<button class="tab ${tab === id ? 'active' : ''}" data-tab="${id}">${icon}<span>${name}</span>${dot}</button>`;
    }).join('');
    $('#tabs').querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
  }

  function render() {
    renderHeader(); renderTabs();
    const v = $('#view');
    v.scrollTop = 0;
    if (tab === 'shop') renderShop(v);
    else if (tab === 'box') renderBox(v);
    else if (tab === 'dex') renderDex(v);
    else if (tab === 'craft') renderCraft(v);
    else if (tab === 'nursery') renderNursery(v);
    else if (tab === 'camp') renderCamp(v);
  }

  // ── SHOP TAB ──
  function renderShop(v) {
    const r = G.s.run;
    if (!r) {
      v.innerHTML = `<div class="panel center-panel">
        <div class="big-emoji">⚡</div>
        <h2>Ready for the Arena?</h2>
        <p>Build a team from the shop, then auto-battle trainers. Win 10 battles for a League Badge.<br>
        You have <b>5 hearts</b> — each defeat costs one. Catch enemies to grow your Box & Pokédex!</p>
        <button class="btn primary big" id="start-run">Start a Run</button>
        <button class="btn ghost" id="show-help">How to play</button>
      </div>`;
      $('#start-run').addEventListener('click', () => { G.newRun(); render(); toast('Run started — good luck, trainer!'); });
      $('#show-help').addEventListener('click', showHelp);
      return;
    }

    const teamHtml = r.team.map((u, i) => u
      ? `<div class="slot" data-slot="${i}">${unitCardHTML(u)}</div>`
      : `<div class="slot empty" data-slot="${i}"><div class="empty-hint">empty</div></div>`).join('');

    const shopUnits = r.shop.units.map((o, i) => {
      const ln = DATA.LINE_MAP[o.line], sp = DATA.speciesAt(o.line, 1), ty = DATA.TYPES[ln.type];
      return `<div class="unit-card shop-card ${o.frozen ? 'frozen' : ''}" data-buy="${i}" style="--tc:${ty.color}">
        <div class="card-top"><span class="tier-tag">T${ln.tier}</span><button class="freeze-btn" data-freeze="${i}" title="Freeze — keep it for next turn">${o.frozen ? '🧊' : '❄'}</button></div>
        <div class="card-emoji">${sp.emoji}</div>
        <div class="card-name">${sp.name}</div>
        <div class="card-stats"><span class="atk">⚔️ ${sp.atk}</span><span class="hp">♥ ${sp.hp}</span></div>
        <div class="card-cost">🪙 ${o.cost}</div>
      </div>`;
    }).join('');

    const shopGoods = r.shop.goods.map((o, i) => {
      const def = o.kind === 'mat' ? DATA.MATS[o.id] : DATA.ITEMS[o.id];
      return `<div class="good-card ${o.frozen ? 'frozen' : ''}" data-buyg="${i}" title="${def.desc}">
        <button class="freeze-btn" data-freezeg="${i}">${o.frozen ? '🧊' : '❄'}</button>
        <div class="good-icon">${def.icon}</div>
        <div class="good-name">${def.name}</div>
        <div class="card-cost">🪙 ${o.cost}</div>
      </div>`;
    }).join('');

    v.innerHTML = `
      <div class="panel">
        <div class="panel-title">Your Team <span class="hint">— front of the line fights first. Tap a Pokémon to manage it.</span></div>
        <div class="team-row" id="team-row">${teamHtml}<div class="front-arrow">➡ front</div></div>
      </div>
      <div class="panel">
        <div class="panel-title">Poké Mart <span class="hint">— 🪙 ${r.gold} left. Buying a duplicate line merges & levels it up!</span></div>
        <div class="shop-row">${shopUnits}</div>
        <div class="goods-row">${shopGoods}</div>
        <div class="shop-actions">
          <button class="btn" id="reroll">🎲 Reroll (🪙 ${Shop.REROLL_COST})</button>
          <button class="btn primary big" id="end-turn">⚔️ BATTLE!</button>
        </div>
      </div>`;

    v.querySelectorAll('[data-buy]').forEach(c => c.addEventListener('click', (e) => {
      if (e.target.closest('.freeze-btn')) return;
      const res = Shop.buyUnit(+c.dataset.buy);
      if (!res.ok) return toast(res.msg, 'warn');
      if (res.evolved) toast(`✨ Evolved into ${res.evolved.name}!`, 'good');
      if (res.newDex) toast(`📖 New Pokédex entry: ${res.newDex.name}! +2 ✨`, 'good');
      render();
    }));
    v.querySelectorAll('[data-freeze]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const o = r.shop.units[+b.dataset.freeze]; o.frozen = !o.frozen; G.save(); render();
    }));
    v.querySelectorAll('[data-buyg]').forEach(c => c.addEventListener('click', (e) => {
      if (e.target.closest('.freeze-btn')) return;
      const res = Shop.buyGood(+c.dataset.buyg);
      toast(res.ok ? res.msg : res.msg, res.ok ? '' : 'warn');
      render();
    }));
    v.querySelectorAll('[data-freezeg]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const o = r.shop.goods[+b.dataset.freezeg]; o.frozen = !o.frozen; G.save(); render();
    }));
    v.querySelectorAll('.slot').forEach(s => s.addEventListener('click', () => {
      const i = +s.dataset.slot;
      if (r.team[i]) unitModal(i);
    }));
    $('#reroll').addEventListener('click', () => { if (Shop.roll(false) === false) toast('Not enough gold.', 'warn'); render(); });
    $('#end-turn').addEventListener('click', startBattle);
  }

  // ── Unit management modal ──
  function unitModal(slot) {
    const r = G.s.run;
    const u = r.team[slot];
    if (!u) return;
    const sp = G.spec(u), ln = G.lineOf(u), lv = G.levelOf(u.xp);
    const pv = DATA.PASSIVES[ln.passive];
    const heldList = Object.keys(G.s.meta.items).filter(id => DATA.ITEMS[id].kind === 'held' && G.itemCount(id) > 0);
    const candies = Object.keys(G.s.meta.items).filter(id => DATA.ITEMS[id].kind === 'consumable' && G.itemCount(id) > 0);
    const next = G.xpToNext(u.xp);

    const m = modal(`
      <div class="modal-head"><span class="m-emoji">${sp.emoji}</span>
        <div><b>${sp.name}</b> ${lvlPips(lv)}<br>${typeChip(ln.type)} <span class="tier-tag">Tier ${ln.tier}</span></div>
        <button class="x" data-close>✕</button></div>
      <div class="m-stats"><span class="atk">⚔️ ${G.atkOf(u)}</span> <span class="hp">♥ ${G.hpOf(u)}</span>
        <span class="dim">${next !== null ? next + ' merge(s) to level ' + (lv + 1) : 'MAX level'}</span></div>
      <div class="m-block"><b>🎯 ${DATA.moveNameAt(ln, lv)}</b><br><span class="dim">${DATA.moveDesc(ln, lv)}</span></div>
      <div class="m-block"><b>🧬 ${pv.name}</b><br><span class="dim">${pv.desc}</span></div>
      <div class="m-block"><b>🎒 Held:</b> ${u.item ? DATA.ITEMS[u.item].icon + ' ' + DATA.ITEMS[u.item].name + ' <button class="btn tiny" id="unequip">remove</button>' : '<span class="dim">nothing</span>'}
        ${heldList.length ? '<div class="m-row">' + heldList.map(id => `<button class="btn tiny" data-equip="${id}">${DATA.ITEMS[id].icon} give (${G.itemCount(id)})</button>`).join('') : ''}</div>
      ${candies.length && next !== null ? '<div class="m-block"><b>🍬 Feed:</b> <div class="m-row">' + candies.map(id => `<button class="btn tiny" data-feed="${id}">${DATA.ITEMS[id].icon} ${DATA.ITEMS[id].name} (${G.itemCount(id)})</button>`).join('') + '</div></div>' : ''}
      <div class="m-actions">
        <button class="btn" id="mv-left" ${slot === 0 ? 'disabled' : ''}>◀ forward</button>
        <button class="btn" id="mv-right" ${slot === G.TEAM_SIZE - 1 ? 'disabled' : ''}>back ▶</button>
        <button class="btn danger" id="sell">Sell (🪙 ${lv} + ${matChip('essence', ln.tier)})</button>
      </div>`);

    m.wrap.querySelectorAll('[data-equip]').forEach(b => b.addEventListener('click', () => { Shop.equipItem(slot, b.dataset.equip); m.close(); render(); }));
    m.wrap.querySelectorAll('[data-feed]').forEach(b => b.addEventListener('click', () => {
      const res = Shop.feedCandy(slot, b.dataset.feed);
      if (res.ok && res.res.evolved) toast(`✨ Evolved into ${res.res.evolved.name}!`, 'good');
      m.close(); render();
    }));
    const unq = m.wrap.querySelector('#unequip');
    if (unq) unq.addEventListener('click', () => { Shop.unequipItem(slot); m.close(); render(); });
    m.wrap.querySelector('#mv-left').addEventListener('click', () => { swap(slot, slot - 1); m.close(); render(); });
    m.wrap.querySelector('#mv-right').addEventListener('click', () => { swap(slot, slot + 1); m.close(); render(); });
    m.wrap.querySelector('#sell').addEventListener('click', () => {
      const res = Shop.sellUnit(slot);
      if (res.ok) toast(`Sold ${res.name} for 🪙${res.gold} + ${res.ess}🔮`);
      m.close(); render();
    });
    function swap(a, b) {
      if (b < 0 || b >= G.TEAM_SIZE) return;
      const t = r.team; [t[a], t[b]] = [t[b], t[a]]; G.save();
    }
  }

  // ── BATTLE ──
  async function startBattle() {
    const r = G.s.run;
    const units = G.teamUnits();
    if (!units.length) return toast('You need at least one Pokémon!', 'warn');
    if (inBattle) return;
    inBattle = true;
    speed = 1;

    const teamP = r.team.filter(Boolean).map(u => Battle.fromSaveUnit(u, 'P'));
    const gen = Battle.genEnemyTeam(r.turn);
    const teamE = gen.team;
    const enemySnapshot = teamE.map(u => ({ uid: u.uid, lineId: u.lineId, level: u.level, name: u.name, emoji: u.emoji, tier: u.tier, fainted: false }));

    const bs = $('#battle-screen');
    bs.classList.remove('hidden');
    bs.innerHTML = `
      <div class="b-top">
        <div class="b-title">Turn ${r.turn} — vs <b>${gen.trainer}</b></div>
        <div class="b-speed">
          ${[1, 2, 4].map(x => `<button class="btn tiny spd ${x === 1 ? 'active' : ''}" data-spd="${x}">×${x}</button>`).join('')}
          <button class="btn tiny" data-spd="40">skip ⏩</button>
        </div>
      </div>
      <div class="b-arena">
        <div class="b-side" id="b-p"></div>
        <div class="b-vs">VS</div>
        <div class="b-side" id="b-e"></div>
      </div>
      <div class="b-banner hidden" id="b-banner"></div>
      <div class="b-log" id="b-log"></div>`;
    bs.querySelectorAll('[data-spd]').forEach(b => b.addEventListener('click', () => {
      speed = +b.dataset.spd;
      bs.querySelectorAll('.spd').forEach(x => x.classList.toggle('active', +x.dataset.spd === speed));
    }));

    const chipFor = (u) => `
      <div class="cunit" id="cu_${u.uid}" style="--tc:${DATA.TYPES[u.type].color}">
        <div class="bubble hidden"></div>
        <div class="c-emoji">${u.emoji}</div>
        <div class="c-hpbar"><div class="c-hpfill" style="width:100%"></div></div>
        <div class="c-stats">⚔️<span class="c-atk">${u.atk}</span> ♥<span class="c-hp">${u.hp}</span></div>
        <div class="c-status"></div>
        <div class="c-name">${u.name}${u.level > 1 ? ' <span class="c-lv">Lv' + u.level + '</span>' : ''}</div>
      </div>`;
    // player: front on the right (next to VS); enemy: front on the left
    $('#b-p').innerHTML = teamP.slice().reverse().map(chipFor).join('');
    $('#b-e').innerHTML = teamE.map(chipFor).join('');

    const log = (txt) => {
      const l = $('#b-log');
      l.insertAdjacentHTML('beforeend', `<div>${txt}</div>`);
      while (l.children.length > 40) l.firstChild.remove();
      l.scrollTop = l.scrollHeight;
    };
    const chip = (u) => document.getElementById('cu_' + u.uid);
    const wait = (ms) => U.sleep(ms / speed);
    const fx = (u, txt, cls) => {
      const c = chip(u); if (!c) return;
      const f = el(`<div class="float ${cls || ''}">${txt}</div>`);
      c.appendChild(f); setTimeout(() => f.remove(), 900);
    };
    const refresh = (u) => {
      const c = chip(u); if (!c) return;
      c.querySelector('.c-atk').textContent = u.atk;
      c.querySelector('.c-hp').textContent = Math.max(0, u.hp);
      c.querySelector('.c-hpfill').style.width = Math.max(0, 100 * u.hp / u.maxHp) + '%';
      const stIcons = [];
      if (u.status.burn > 0) stIcons.push('🔥'); if (u.status.curse > 0) stIcons.push('🕯️');
      if (u.status.poison > 0) stIcons.push('☠️'); if (u.status.para > 0) stIcons.push('⚡');
      if (u.status.flinch > 0) stIcons.push('💫'); if (u.shield > 0) stIcons.push('🛡️');
      c.querySelector('.c-status').textContent = stIcons.join('');
    };

    const sideName = (u) => u.side === 'P' ? '<span class="pn">' + u.name + '</span>' : '<span class="en">' + u.name + '</span>';

    async function emit(type, d) {
      switch (type) {
        case 'exchange': break;
        case 'trigger': {
          const c = chip(d.u);
          if (c) { const b = c.querySelector('.bubble'); b.textContent = d.text; b.classList.remove('hidden'); setTimeout(() => b.classList.add('hidden'), 800 / speed); }
          log(sideName(d.u) + ' — <i>' + d.text + '</i>');
          await wait(260); break;
        }
        case 'strike': {
          const c = chip(d.u); if (c) { c.classList.add(d.u.side === 'P' ? 'lungeR' : 'lungeL'); setTimeout(() => c.classList.remove('lungeR', 'lungeL'), 300 / speed); }
          await wait(300); break;
        }
        case 'damage': {
          const c = chip(d.u); if (c) { c.classList.add('hit'); setTimeout(() => c.classList.remove('hit'), 280 / speed); }
          const effTxt = d.eff > 1 ? ' super-effective!' : d.eff < 1 && d.eff > 0 ? ' not very effective…' : '';
          fx(d.u, '-' + d.amt, d.eff > 1 ? 'crit' : d.eff < 1 ? 'weak' : '');
          refresh(d.u);
          if (d.amt > 0) log(sideName(d.u) + ` takes <b>${d.amt}</b>${d.tag ? ' (' + d.tag + ')' : ''}${effTxt ? '<span class="eff">' + effTxt + '</span>' : ''}`);
          await wait(220); break;
        }
        case 'heal': fx(d.u, '+' + d.amt, 'heal'); refresh(d.u); log(sideName(d.u) + ` heals <b>${d.amt}</b>${d.label ? ' (' + d.label + ')' : ''}`); await wait(160); break;
        case 'buff': fx(d.u, (d.atk ? (d.atk > 0 ? '+' : '') + d.atk + '⚔️ ' : '') + (d.hp ? '+' + d.hp + '♥' : ''), d.atk < 0 ? 'weak' : 'buff'); refresh(d.u); await wait(160); break;
        case 'status': fx(d.u, { burn: '🔥', poison: '☠️', para: '⚡', flinch: '💫', curse: '🕯️' }[d.kind] || '!', 'stat'); refresh(d.u); await wait(160); break;
        case 'shieldGain': refresh(d.u); fx(d.u, '🛡️+' + d.amt, 'buff'); await wait(160); break;
        case 'shield': fx(d.u, '🛡️', 'buff'); refresh(d.u); await wait(100); break;
        case 'dodge': fx(d.u, 'miss!', 'stat'); log(sideName(d.u) + ' dodges!'); await wait(160); break;
        case 'immune': fx(d.u, 'immune', 'stat'); await wait(140); break;
        case 'skip': fx(d.u, d.why + '!', 'stat'); log(sideName(d.u) + ' is ' + d.why + '!'); await wait(200); break;
        case 'faint': {
          const c = chip(d.u); if (c) c.classList.add('dead');
          const snap = enemySnapshot.find(s => s.uid === d.u.uid); if (snap) snap.fainted = true;
          log(sideName(d.u) + ' <b>fainted!</b>');
          await wait(300); break;
        }
        case 'end': break;
      }
    }

    const result = await Battle.simulate(teamP, teamE, emit);

    const banner = $('#b-banner');
    banner.classList.remove('hidden');
    banner.textContent = result.winner === 'P' ? '🎉 VICTORY!' : result.winner === 'E' ? '💔 DEFEAT' : '🤝 DRAW';
    banner.className = 'b-banner ' + (result.winner === 'P' ? 'win' : result.winner === 'E' ? 'lose' : '');
    await U.sleep(Math.max(600, 1100 / speed));

    inBattle = false;
    bs.classList.add('hidden');
    resolveBattle(result, enemySnapshot, gen.trainer);
  }

  // Apply results + show the post-battle modal (loot, milestones, catching)
  function resolveBattle(result, enemySnapshot, trainer) {
    const r = G.s.run;
    const m = G.s.meta;
    m.stats.battles++;
    let lootHtml = '', mileHtml = '';
    const won = result.winner === 'P';

    if (won) {
      r.wins++; r.streak++;
      m.trophies += 1; m.stats.wins++;
      const loot = Shop.lootRoll(r.turn, true);
      // Pickup passive: bonus berries per pickup Pokémon on the team
      const pickups = G.teamUnits().filter(u => G.lineOf(u).passive === 'pickup').length;
      if (pickups) { loot.mats.berry = (loot.mats.berry || 0) + 2 * pickups; }
      for (const [mt, n] of Object.entries(loot.mats)) G.addMat(mt, n);
      for (const [it, n] of Object.entries(loot.items)) G.addItem(it, n);
      // EXP Share holders
      for (const u of G.teamUnits()) if (u.item === 'expshare' && u.xp < G.XP_MAX) {
        const res = G.gainXp(u, 1);
        if (res.evolved) toast(`✨ ${res.evolved.name} evolved (EXP Share)!`, 'good');
      }
      lootHtml = `<div class="m-block"><b>Loot:</b> 🎖️+1 ${Object.entries(loot.mats).map(([k, n]) => matChip(k, '+' + n)).join('')}
        ${Object.entries(loot.items).map(([k, n]) => `<span class="mat-chip">${DATA.ITEMS[k].icon} +${n}</span>`).join('')}
        ${pickups ? `<span class="dim">(Pickup ×${pickups})</span>` : ''}</div>`;
      const miles = Shop.winMilestones(r.wins);
      const mparts = [];
      for (const mi of miles) {
        if (mi.kind === 'badge') { m.badges++; mparts.push('📛 <b>League Badge earned!</b>'); }
        if (mi.kind === 'chest') { Idle.addToStorage('chest', mi.id); mparts.push(DATA.CHESTS[mi.id].icon + ' ' + DATA.CHESTS[mi.id].name + ' → Nursery'); }
        if (mi.kind === 'egg') { Idle.addToStorage('egg', mi.id); mparts.push('🥚 ' + DATA.EGGS[mi.id].name + ' → Nursery'); }
      }
      if (r.streak >= 3) { m.trophies += 1; mparts.push(`🔥 ${r.streak}-win streak: +1 🎖️`); }
      if (mparts.length) mileHtml = `<div class="m-block">${mparts.join('<br>')}</div>`;
    } else if (result.winner === 'E') {
      r.hearts--; r.streak = 0; m.stats.losses++;
      const loot = Shop.lootRoll(r.turn, false);
      for (const [mt, n] of Object.entries(loot.mats)) G.addMat(mt, n);
      lootHtml = `<div class="m-block dim">You lose a heart… ${r.hearts > 0 ? r.hearts + ' ❤️ left.' : 'That was your last one!'}</div>`;
    } else {
      lootHtml = `<div class="m-block dim">A draw — nobody loses a heart.</div>`;
    }
    G.save();

    // catch section: pick a defeated-or-not enemy, throw balls
    let caughtOne = false;
    const balls = () => ['pokeball', 'greatball', 'ultraball', 'masterball'].filter(b => G.itemCount(b) > 0);
    const catchSection = won ? `
      <div class="m-block" id="catch-block">
        <b>🎯 Catch one of ${trainer}'s Pokémon!</b> <span class="dim">Pick a target, throw a ball. Fainted targets are easier.</span>
        <div class="catch-row">${enemySnapshot.map((e, i) => `
          <div class="catch-target ${e.fainted ? 'fainted' : ''}" data-ct="${i}">
            <div class="ct-emoji">${e.emoji}</div><div class="ct-name">${e.name}</div>
            ${e.level > 1 ? '<div class="c-lv">Lv' + e.level + '</div>' : ''}
            ${e.fainted ? '<div class="ct-tag">fainted</div>' : ''}
          </div>`).join('')}</div>
        <div class="catch-balls" id="catch-balls"></div>
        <div id="catch-result" class="dim"></div>
      </div>` : '';

    const mm = modal(`
      <div class="modal-head"><span class="m-emoji">${won ? '🎉' : result.winner === 'E' ? '💔' : '🤝'}</span>
        <div><b>${won ? 'Victory!' : result.winner === 'E' ? 'Defeat…' : 'Draw'}</b><br><span class="dim">vs ${trainer}</span></div></div>
      ${lootHtml}${mileHtml}${catchSection}
      <div class="m-actions"><button class="btn primary big" id="next-turn">${r.hearts <= 0 ? 'End of the road…' : 'Continue ➡'}</button></div>`,
      { sticky: true });

    let target = enemySnapshot.findIndex(e => e.fainted);
    if (target < 0) target = 0;
    function renderCatch() {
      if (!won) return;
      mm.wrap.querySelectorAll('.catch-target').forEach((c, i) => c.classList.toggle('sel', i === target && !caughtOne));
      const bDiv = mm.wrap.querySelector('#catch-balls');
      if (!bDiv) return;
      if (caughtOne) { bDiv.innerHTML = ''; return; }
      const bl = balls();
      bDiv.innerHTML = bl.length
        ? bl.map(b => `<button class="btn" data-throw="${b}">${DATA.ITEMS[b].icon} ${DATA.ITEMS[b].name} ×${G.itemCount(b)} <span class="dim">${Math.round(Shop.catchChance(b, enemySnapshot[target]) * 100)}%</span></button>`).join('')
        : '<span class="dim">No balls left — craft some in the workshop!</span>';
      bDiv.querySelectorAll('[data-throw]').forEach(btn => btn.addEventListener('click', () => {
        const res = Shop.attemptCatch(btn.dataset.throw, enemySnapshot[target]);
        const out = mm.wrap.querySelector('#catch-result');
        if (!res.ok) { out.textContent = res.msg; return; }
        if (res.caught) {
          caughtOne = true;
          const sp = G.spec(res.unit);
          out.innerHTML = `<b class="good">Gotcha! ${sp.emoji} ${sp.name} was caught → Box</b>`;
          toast(`📦 Caught ${sp.name}!`, 'good');
        } else {
          out.innerHTML = `<b class="bad">Oh no, it broke free!</b>`;
        }
        renderHeader(); renderCatch();
      }));
    }
    if (won) {
      mm.wrap.querySelectorAll('.catch-target').forEach((c) => c.addEventListener('click', () => { if (!caughtOne) { target = +c.dataset.ct; renderCatch(); } }));
      renderCatch();
    }

    mm.wrap.querySelector('#next-turn').addEventListener('click', () => {
      mm.close();
      if (r.hearts <= 0) return runOver();
      r.turn++;
      r.gold = 10;
      Shop.roll(true);
      G.save();
      tab = 'shop';
      render();
    });
    renderHeader();
  }

  // ── Run over: keep one team member, rest release as essence ──
  function runOver() {
    const r = G.s.run;
    const units = G.teamUnits();
    const mm = modal(`
      <div class="modal-head"><span class="m-emoji">🏁</span><div><b>Run over!</b><br>
        <span class="dim">${r.wins} wins · turn ${r.turn} · best ever ${Math.max(G.s.meta.stats.bestWins, r.wins)}</span></div></div>
      ${units.length ? `<div class="m-block"><b>Choose ONE Pokémon to keep in your Box.</b><br><span class="dim">The rest return to the wild as ${matChip('essence')} essence.</span>
        <div class="catch-row">${units.map((u, i) => `<div class="catch-target" data-keep="${i}">
          <div class="ct-emoji">${G.spec(u).emoji}</div><div class="ct-name">${G.spec(u).name}</div>
          ${G.levelOf(u.xp) > 1 ? '<div class="c-lv">Lv' + G.levelOf(u.xp) + '</div>' : ''}</div>`).join('')}</div></div>`
        : '<div class="m-block dim">The team is empty — nothing to keep.</div>'}
      <div class="m-actions"><button class="btn primary big" id="finish-run">${units.length ? 'Keep nothing — release all' : 'Back to Camp'}</button></div>`,
      { sticky: true });

    function finish(keepIdx) {
      let ess = 0;
      units.forEach((u, i) => {
        if (i === keepIdx) { if (u.item) { G.addItem(u.item, 1); u.item = null; } G.boxAdd(u); }
        else ess += G.releaseUnit(u);
      });
      if (keepIdx !== undefined && keepIdx !== null && units[keepIdx]) toast(`📦 ${G.spec(units[keepIdx]).name} saved to Box!`, 'good');
      if (ess) toast(`+${ess} 🔮 essence from released Pokémon`);
      G.endRun();
      mm.close();
      tab = 'shop';
      render();
    }
    mm.wrap.querySelectorAll('[data-keep]').forEach(c => c.addEventListener('click', () => finish(+c.dataset.keep)));
    mm.wrap.querySelector('#finish-run').addEventListener('click', () => finish(null));
  }

  // ── BOX TAB ──
  function renderBox(v) {
    const box = G.s.meta.box;
    const r = G.s.run;
    v.innerHTML = `<div class="panel">
      <div class="panel-title">Storage Box <span class="hint">— caught & hatched Pokémon live here between runs. ${box.length} stored.</span></div>
      <div class="box-grid">${box.length ? box.map((u, i) => `
        <div class="box-entry">
          ${unitCardHTML(u)}
          <div class="box-actions">
            ${r ? `<button class="btn tiny" data-deploy="${u.uid}">⚔️ Deploy 🪙${Shop.DEPLOY_COST}</button>` : ''}
            <button class="btn tiny danger" data-release="${i}">🔮 Release</button>
          </div>
        </div>`).join('') : '<div class="dim pad">Empty. Catch enemies after battles, or hatch eggs in the Nursery!</div>'}</div>
    </div>`;
    v.querySelectorAll('[data-deploy]').forEach(b => b.addEventListener('click', () => {
      const res = Shop.deployFromBox(b.dataset.deploy);
      if (!res.ok) return toast(res.msg, 'warn');
      if (res.evolved) toast(`✨ Evolved into ${res.evolved.name}!`, 'good');
      toast(res.merged ? 'Merged into your team!' : 'Deployed to the team!');
      render();
    }));
    v.querySelectorAll('[data-release]').forEach(b => b.addEventListener('click', () => {
      const i = +b.dataset.release;
      const u = box[i];
      if (!u) return;
      const sp = G.spec(u);
      const cm = modal(`<div class="modal-head"><span class="m-emoji">${sp.emoji}</span><div><b>Release ${sp.name}?</b><br><span class="dim">You'll get ${G.lineOf(u).tier + (G.levelOf(u.xp) - 1) * 2} 🔮 essence. This can't be undone.</span></div></div>
        <div class="m-actions"><button class="btn danger" id="rel-yes">Release</button><button class="btn" data-close>Keep</button></div>`);
      cm.wrap.querySelector('#rel-yes').addEventListener('click', () => {
        if (u.item) G.addItem(u.item, 1);
        G.boxRemove(u.uid);
        const ess = G.releaseUnit(u);
        toast(`+${ess} 🔮 essence`);
        cm.close(); render();
      });
    }));
  }

  // ── DEX TAB ──
  function renderDex(v) {
    const owned = G.s.meta.dex;
    let cells = '';
    for (const lineDef of DATA.dexOrder) {
      for (const sid of lineDef.stageIds) {
        const sp = DATA.SPECIES[sid];
        const has = !!owned[sid];
        cells += `<div class="dex-cell ${has ? 'owned' : ''}" data-dex="${sid}" style="--tc:${DATA.TYPES[sp.type].color}">
          <div class="dex-emoji">${has ? sp.emoji : '❓'}</div>
          <div class="dex-name">${has ? sp.name : '???'}</div>
          ${sp.legendary ? '<div class="dex-leg">★</div>' : ''}
        </div>`;
      }
    }
    v.innerHTML = `<div class="panel">
      <div class="panel-title">Pokédex <span class="hint">— ${G.dexCount()}/${G.dexTotal()} registered. Each new entry: +2 ✨ and a bigger Camp bonus!</span></div>
      <div class="dex-grid">${cells}</div>
    </div>`;
    v.querySelectorAll('[data-dex]').forEach(c => c.addEventListener('click', () => {
      const sid = c.dataset.dex;
      const sp = DATA.SPECIES[sid];
      const has = !!owned[sid];
      if (!has) return toast('Not registered yet — catch or hatch one!', 'warn');
      const lineDef = DATA.LINE_MAP[sp.line];
      const pv = DATA.PASSIVES[lineDef.passive];
      modal(`<div class="modal-head"><span class="m-emoji">${sp.emoji}</span>
        <div><b>${sp.name}</b> ${sp.legendary ? '★' : ''}<br>${typeChip(sp.type)} <span class="tier-tag">Tier ${sp.tier}</span></div>
        <button class="x" data-close>✕</button></div>
        <div class="m-stats"><span class="atk">⚔️ ${sp.atk}</span> <span class="hp">♥ ${sp.hp}</span> <span class="dim">base stats</span></div>
        <div class="m-block"><b>🎯 ${lineDef.move.name}</b><br><span class="dim">${DATA.moveDesc(lineDef, sp.stageIndex + 1)}</span></div>
        <div class="m-block"><b>🧬 ${pv.name}</b><br><span class="dim">${pv.desc}</span></div>
        <div class="m-block dim">Line: ${lineDef.stageIds.map(s => DATA.SPECIES[s].name).join(' → ')}</div>`);
    }));
  }

  // ── CRAFT TAB ──
  function renderCraft(v) {
    const bag = Object.entries(G.s.meta.items);
    v.innerHTML = `<div class="panel">
      <div class="panel-title">Workshop <span class="hint">— turn materials into balls, candy & held items.</span></div>
      <div class="recipes">${DATA.RECIPES.map((rc, i) => {
        const it = DATA.ITEMS[rc.out];
        const ok = G.canAfford(rc.cost);
        return `<div class="recipe ${ok ? '' : 'locked'}">
          <span class="r-icon">${it.icon}</span>
          <span class="r-body"><b>${it.name}</b> <span class="dim sm">${it.desc}</span></span>
          <span class="r-cost">${costChips(rc.cost)}</span>
          <button class="btn tiny ${ok ? 'primary' : ''}" data-craft="${i}" ${ok ? '' : 'disabled'}>Craft</button>
        </div>`;
      }).join('')}</div>
    </div>
    <div class="panel">
      <div class="panel-title">Bag</div>
      <div class="bag-row">${bag.length ? bag.map(([id, n]) => `<span class="bag-item" title="${DATA.ITEMS[id].desc}">${DATA.ITEMS[id].icon} ${DATA.ITEMS[id].name} ×${n}</span>`).join('') : '<span class="dim">Nothing yet.</span>'}</div>
      <div class="dim sm pad-top">Held items are given to team Pokémon from their card (tap one in the Shop tab). Balls are thrown after victories. Candy is fed from a Pokémon's card.</div>
    </div>`;
    v.querySelectorAll('[data-craft]').forEach(b => b.addEventListener('click', () => {
      const rc = DATA.RECIPES[+b.dataset.craft];
      if (!G.canAfford(rc.cost)) return toast('Missing materials.', 'warn');
      G.payCost(rc.cost);
      G.addItem(rc.out, 1);
      G.s.meta.stats.crafts++;
      G.save();
      toast(`${DATA.ITEMS[rc.out].icon} Crafted ${DATA.ITEMS[rc.out].name}!`, 'good');
      render();
    }));
  }

  // ── NURSERY TAB (eggs, chests, trophy exchange) ──
  function renderNursery(v) {
    const n = Idle.nursery();
    const slots = [];
    for (let i = 0; i < n.slots; i++) {
      const t = n.active[i];
      if (!t) { slots.push('<div class="n-slot empty"><div class="dim">empty slot</div></div>'); continue; }
      const def = Idle.defOf(t);
      const rem = Idle.remaining(t);
      const pct = 100 - 100 * rem / t.dur;
      slots.push(`<div class="n-slot" style="--nc:${def.color}">
        <div class="n-icon">${def.icon}</div>
        <div class="n-name">${def.name}</div>
        <div class="n-bar"><div class="n-fill" style="width:${pct}%"></div></div>
        ${rem <= 0 ? `<button class="btn primary tiny" data-claim="${t.id}">${t.kind === 'egg' ? 'Hatch!' : 'Open!'}</button>`
                   : `<div class="n-time" data-time="${t.id}">${U.fmtDur(rem)}</div>`}
      </div>`);
    }
    const storage = n.storage.map((it, i) => {
      const def = it.kind === 'egg' ? DATA.EGGS[it.defId] : DATA.CHESTS[it.defId];
      return `<div class="n-store" style="--nc:${def.color}">
        <span>${def.icon} ${def.name} <span class="dim sm">(${U.fmtDur(def.mins * 60000)})</span></span>
        <button class="btn tiny" data-start="${i}" ${n.active.length >= n.slots ? 'disabled' : ''}>Start</button>
      </div>`;
    }).join('');

    const shopRows = DATA.TROPHY_SHOP.map((o, i) => {
      const def = o.kind === 'egg' ? DATA.EGGS[o.id] : o.kind === 'chest' ? DATA.CHESTS[o.id] : o.kind === 'item' ? DATA.ITEMS[o.id] : o;
      const maxed = o.kind === 'slot' && n.slots >= Idle.MAX_SLOTS;
      const ok = G.s.meta.trophies >= o.cost && !maxed;
      return `<div class="recipe ${ok ? '' : 'locked'}">
        <span class="r-icon">${def.icon}</span>
        <span class="r-body"><b>${def.name}</b>${o.kind === 'slot' ? ` <span class="dim sm">${o.desc}</span>` : ''}</span>
        <span class="r-cost"><span class="mat-chip ${G.s.meta.trophies >= o.cost ? '' : 'lack'}">🎖️ ${o.cost}</span></span>
        <button class="btn tiny ${ok ? 'primary' : ''}" data-tbuy="${i}" ${ok ? '' : 'disabled'}>${maxed ? 'Max' : 'Buy'}</button>
      </div>`;
    }).join('');

    v.innerHTML = `
      <div class="panel">
        <div class="panel-title">Nursery <span class="hint">— eggs & chests tick in real time, even while you're away.</span></div>
        <div class="n-slots">${slots.join('')}</div>
        <div class="panel-title sm">Waiting to start</div>
        <div class="n-storage">${storage || '<div class="dim pad">Nothing waiting. Win battles or visit the Trophy Exchange below!</div>'}</div>
      </div>
      <div class="panel">
        <div class="panel-title">Trophy Exchange <span class="hint">— you have 🎖️ ${G.s.meta.trophies}</span></div>
        <div class="recipes">${shopRows}</div>
      </div>`;

    v.querySelectorAll('[data-claim]').forEach(b => b.addEventListener('click', () => {
      const res = Idle.claim(b.dataset.claim);
      if (!res) return;
      if (res.kind === 'egg') {
        const sp = G.spec(res.unit);
        modal(`<div class="modal-head"><span class="m-emoji">${sp.emoji}</span><div><b>The egg hatched!</b><br>
          <span class="dim">${sp.name}${G.levelOf(res.unit.xp) > 1 ? ' (Lv' + G.levelOf(res.unit.xp) + ')' : ''} joined your Box${res.newDex ? ' — new Pokédex entry! +2 ✨' : ''}</span></div></div>
          <div class="m-actions"><button class="btn primary" data-close>Sweet!</button></div>`);
      } else {
        const l = res.loot;
        modal(`<div class="modal-head"><span class="m-emoji">${DATA.CHESTS[res.defId].icon}</span><div><b>${DATA.CHESTS[res.defId].name} opened!</b></div></div>
          <div class="m-block">${Object.entries(l.mats).map(([k, x]) => matChip(k, '+' + x)).join('')}
          ${Object.entries(l.items).map(([k, x]) => `<span class="mat-chip">${DATA.ITEMS[k].icon} +${x}</span>`).join('')}
          ${l.eggs.map(e => `<span class="mat-chip">🥚 ${DATA.EGGS[e].name}!</span>`).join('')}</div>
          <div class="m-actions"><button class="btn primary" data-close>Nice!</button></div>`);
      }
      render();
    }));
    v.querySelectorAll('[data-start]').forEach(b => b.addEventListener('click', () => {
      const res = Idle.startTimer(+b.dataset.start);
      if (!res.ok) toast(res.msg || 'Cannot start.', 'warn');
      render();
    }));
    v.querySelectorAll('[data-tbuy]').forEach(b => b.addEventListener('click', () => {
      const o = DATA.TROPHY_SHOP[+b.dataset.tbuy];
      if (G.s.meta.trophies < o.cost) return toast('Not enough trophies.', 'warn');
      if (o.kind === 'slot') {
        const res = Idle.buyNurserySlot();
        if (!res.ok) return toast(res.msg, 'warn');
      } else if (o.kind === 'item') {
        G.addItem(o.id, 1);
      } else {
        Idle.addToStorage(o.kind, o.id);
      }
      G.s.meta.trophies -= o.cost;
      G.save();
      toast('Purchased!', 'good');
      render();
    }));
  }

  // ── CAMP TAB (idle income, stats, settings) ──
  function renderCamp(v) {
    const r = Idle.rates();
    const prog = Idle.campProgress();
    const st = G.s.meta.stats;
    const pct = 100 * prog.mins / prog.capMins;
    v.innerHTML = `
      <div class="panel">
        <div class="panel-title">Base Camp <span class="hint">— your Pokémon forage while you're away (up to ${Idle.CAP_HOURS}h).</span></div>
        <div class="m-block">Income multiplier: <b>×${r.mult.toFixed(2)}</b> <span class="dim sm">(grows with Pokédex ${G.dexCount()} & badges ${G.s.meta.badges})</span><br>
          <span class="dim sm">per hour ≈</span> ${matChip('berry', (r.berry * 60).toFixed(1))} ${matChip('apricorn', (r.apricorn * 60).toFixed(1))} ${matChip('stardust', (r.stardust * 60).toFixed(1))} ${matChip('iron', (r.iron * 60).toFixed(1))}</div>
        <div class="n-bar big"><div class="n-fill" style="width:${pct}%"></div></div>
        <div class="dim sm">${Math.floor(prog.mins)} / ${prog.capMins} minutes accrued</div>
        <div class="m-actions"><button class="btn primary" id="collect">🧺 Collect</button></div>
      </div>
      <div class="panel">
        <div class="panel-title">Trainer Card</div>
        <div class="m-block dim">Runs: <b>${st.runs}</b> · Battles: <b>${st.battles}</b> · Wins: <b>${st.wins}</b> · Best run: <b>${st.bestWins}</b> 🏆<br>
        Caught: <b>${st.catches}</b> · Hatched: <b>${st.hatches}</b> · Crafted: <b>${st.crafts}</b> · Released: <b>${st.released}</b></div>
      </div>
      <div class="panel">
        <div class="panel-title">Settings</div>
        <div class="m-actions wrap">
          <button class="btn" id="help">❓ How to play</button>
          <button class="btn" id="export">📤 Export save</button>
          <button class="btn" id="import">📥 Import save</button>
          <button class="btn danger" id="reset">🗑️ Reset everything</button>
        </div>
        <div class="dim sm pad-top">Poké Auto Arena is a free fan-made project. Not affiliated with, endorsed by, or connected to Nintendo, Game Freak, or The Pokémon Company.</div>
      </div>`;
    $('#collect').addEventListener('click', () => {
      const res = Idle.collectCamp();
      if (!res) return toast('Nothing to collect yet — give it a minute.', 'warn');
      toast('Collected: ' + Object.entries(res.gains).map(([k, n]) => `${DATA.MATS[k].icon}${n}`).join(' '), 'good');
      render();
    });
    $('#help').addEventListener('click', showHelp);
    $('#export').addEventListener('click', () => {
      const code = G.exportSave();
      modal(`<div class="modal-head"><div><b>Export save</b><br><span class="dim">Copy this code somewhere safe.</span></div><button class="x" data-close>✕</button></div>
        <textarea class="save-box" readonly>${code}</textarea>
        <div class="m-actions"><button class="btn primary" id="copy">Copy</button></div>`)
        .wrap.querySelector('#copy').addEventListener('click', function () {
          navigator.clipboard && navigator.clipboard.writeText(code);
          this.textContent = 'Copied!';
        });
    });
    $('#import').addEventListener('click', () => {
      const m = modal(`<div class="modal-head"><div><b>Import save</b><br><span class="dim">Paste an export code. Replaces the current save!</span></div><button class="x" data-close>✕</button></div>
        <textarea class="save-box" id="imp-box" placeholder="paste code here"></textarea>
        <div class="m-actions"><button class="btn primary" id="imp-go">Import</button></div>`);
      m.wrap.querySelector('#imp-go').addEventListener('click', () => {
        if (G.importSave(m.wrap.querySelector('#imp-box').value)) { m.close(); render(); toast('Save imported!', 'good'); }
        else toast('That code is not valid.', 'warn');
      });
    });
    $('#reset').addEventListener('click', () => {
      const m = modal(`<div class="modal-head"><div><b>Reset EVERYTHING?</b><br><span class="dim">Pokédex, Box, items, trophies — all gone. Forever.</span></div></div>
        <div class="m-actions"><button class="btn danger" id="reset-yes">Yes, wipe it</button><button class="btn" data-close>No!</button></div>`);
      m.wrap.querySelector('#reset-yes').addEventListener('click', () => { G.hardReset(); m.close(); render(); toast('Fresh start.'); });
    });
  }

  // ── Help & onboarding ──
  function showHelp() {
    modal(`<div class="modal-head"><span class="m-emoji">📘</span><div><b>How to play</b></div><button class="x" data-close>✕</button></div>
      <div class="m-block"><b>🛒 Shop phase</b><br><span class="dim">Each turn you get 10 🪙. Buy Pokémon (3 🪙), reroll (1 🪙), or freeze cards for next turn. Buying a Pokémon whose evolution line is already on your team <b>merges</b> it: 3 copies = Level 2, 6 = Level 3 — and it <b>evolves</b>! Tap a team Pokémon to reposition, sell, feed candy or give a held item.</span></div>
      <div class="m-block"><b>⚔️ Battle</b><br><span class="dim">Battles run themselves: front Pokémon trade blows, moves & passives trigger, and <b>type match-ups</b> multiply damage (Water beats Fire, etc.). Lose = -1 ❤️ (you have 5). Win 10 battles for a League Badge — then it keeps going, harder.</span></div>
      <div class="m-block"><b>🎯 Catching</b><br><span class="dim">After every victory you may throw balls at ONE enemy Pokémon. Fainted targets are easier. Caught Pokémon go to your 📦 Box — deploy them into any run for 3 🪙, or release them for 🔮 essence.</span></div>
      <div class="m-block"><b>🛠️ Crafting</b><br><span class="dim">Battles, chests and your Camp produce materials. Craft Poké Balls, XP candy and held items (Focus Sash, Leftovers, Choice Band…). One held item per Pokémon.</span></div>
      <div class="m-block"><b>🪺 Nursery & 🏕️ Camp</b><br><span class="dim">Eggs and chests tick in <b>real time</b> — even with the game closed. Legendaries only hatch from the best eggs. Camp forages materials while you're away (12h cap). The Pokédex boosts Camp income: collect 'em all!</span></div>
      <div class="m-actions"><button class="btn primary" data-close>Let's go!</button></div>`);
  }

  function maybeShowAway() {
    const rep = Idle.awayReport();
    if (!rep) return;
    G.save();
    const mins = Math.floor(rep.awayMs / 60000);
    const timeTxt = mins >= 60 ? Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm' : mins + 'm';
    modal(`<div class="modal-head"><span class="m-emoji">🏕️</span><div><b>Welcome back!</b><br><span class="dim">You were away ${timeTxt}.</span></div></div>
      ${rep.camp ? `<div class="m-block"><b>Camp foraged:</b> ${Object.entries(rep.camp.gains).map(([k, n]) => matChip(k, '+' + n)).join('')}${rep.camp.capped ? ' <span class="dim sm">(capped at ' + Idle.CAP_HOURS + 'h)</span>' : ''}</div>` : ''}
      ${rep.ready ? `<div class="m-block"><b>🪺 ${rep.ready} egg/chest timer${rep.ready > 1 ? 's are' : ' is'} ready!</b></div>` : ''}
      <div class="m-actions"><button class="btn primary" data-close>Collect & play</button></div>`);
  }

  function maybeShowIntro() {
    if (G.s.meta.seenIntro) return;
    G.s.meta.seenIntro = true;
    G.save();
    showHelp();
  }

  // 1s tick: update countdowns in place, refresh nursery dot
  function tick() {
    document.querySelectorAll('[data-time]').forEach(elm => {
      const t = Idle.nursery().active.find(x => x.id === elm.dataset.time);
      if (!t) return;
      const rem = Idle.remaining(t);
      elm.textContent = U.fmtDur(rem);
      if (rem <= 0 && tab === 'nursery') render();
    });
    if (Idle.readyCount() > 0 && !document.querySelector('#tabs .dot') && !inBattle) renderTabs();
  }

  return { render, tick, toast, maybeShowAway, maybeShowIntro, showHelp, get tab() { return tab; }, set tab(t) { tab = t; } };
})();

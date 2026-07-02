// ── battle.js ── auto-battle simulation. Emits awaitable events for the UI ──
const Battle = (() => {

  // Build a combat copy from a saved unit (player) — battles never hurt the real team.
  function fromSaveUnit(u, side) {
    const sp = G.spec(u), ln = G.lineOf(u), lv = G.levelOf(u.xp);
    return combatUnit({
      uid: u.uid, side, lineId: ln.id, level: lv,
      name: sp.name, emoji: sp.emoji, type: ln.type, tier: ln.tier,
      atk: G.atkOf(u), hp: G.hpOf(u), item: u.item,
    });
  }

  function combatUnit(o) {
    return Object.assign({
      shield: 0, dead: false,
      status: { burn: 0, curse: 0, poison: 0, para: 0, flinch: 0 },
      flags: { sashUsed: false, sturdyUsed: false, restUsed: false, blinkUsed: false, oranUsed: false, struck: false },
      exch: 0,
    }, o, { maxHp: o.hp });
  }

  const ln = (u) => DATA.LINE_MAP[u.lineId];
  const mv = (u) => ln(u).move;
  const pas = (u) => ln(u).passive;
  const p = (u, key) => U.byLevel(mv(u)[key], u.level);        // level-scaled move param
  const moveName = (u) => DATA.moveNameAt(ln(u), u.level);
  const alive = (t) => t.filter(x => !x.dead);
  const front = (t) => t.find(x => !x.dead) || null;
  const back = (t) => { const a = alive(t); return a.length ? a[a.length - 1] : null; };
  const statused = (u) => u.status.burn > 0 || u.status.poison > 0 || u.status.para > 0 || u.status.curse > 0;
  const isFirstStriker = (u) => pas(u) === 'speedster' || u.item === 'quickclaw';

  // ── The simulation ──
  // teams: {P: combatUnit[], E: combatUnit[]}; emit: async (type, data) => {}
  async function simulate(teamP, teamE, emitFn) {
    const emit = emitFn || (async () => {});
    const T = { P: teamP, E: teamE };
    const foes = (u) => T[u.side === 'P' ? 'E' : 'P'];
    const pals = (u) => T[u.side];

    const effAtk = (u) => Math.max(0, u.atk + (pas(u) === 'guts' && statused(u) ? 2 : 0));

    async function announce(u, text) { await emit('trigger', { u, text }); }

    // Core damage application. Returns actual damage dealt.
    // opts: {type, isStrike, canDodge, mults, flat, ignoreReduction, tag}
    async function dealDamage(att, def, base, opts) {
      opts = opts || {};
      if (!def || def.dead) return 0;
      const dtype = opts.type || (att ? ln(att).type : 'normal');

      // dodges (strikes only)
      if (opts.canDodge && att) {
        if (pas(def) === 'blink' && !def.flags.blinkUsed) {
          def.flags.blinkUsed = true;
          await announce(def, DATA.PASSIVES.blink.name + '!');
          await emit('dodge', { u: def });
          return 0;
        }
        if (pas(def) === 'dodge20' && U.chance(.2)) { await emit('dodge', { u: def }); return 0; }
      }

      // type multiplier & immunities (sourceless ticks — burn, recoil, thorns — are typeless)
      let mult = (att || opts.type) ? DATA.typeMult(dtype, ln(def).type) : 1;
      if (att && pas(att) === 'scrappy' && mult === 0) mult = 1;
      const pk = pas(def);
      if ((pk === 'immuneFire' && dtype === 'fire') || (pk === 'immuneWater' && dtype === 'water') ||
          (pk === 'immuneElectric' && dtype === 'electric') || (pk === 'levitate' && dtype === 'ground')) mult = 0;
      if (mult === 0) { await emit('immune', { u: def }); return 0; }

      let dmg = base;
      if (att && !u_isDot(opts)) {
        if (pas(att) === 'pinch' && att.hp < att.maxHp / 2) dmg = Math.round(dmg * 1.5);
        if (pas(att) === 'technician') dmg += 1;
      }
      dmg = Math.round(dmg * mult) + (opts.flat || 0);
      // defender reductions
      if (!opts.ignoreReduction) {
        if (pas(def) === 'multiscale' && def.hp >= def.maxHp) dmg = Math.ceil(dmg / 2);
        if (pas(def) === 'thickFat' && (dtype === 'fire' || dtype === 'ice')) dmg -= 2;
        if (pas(def) === 'thickSkin') dmg -= 1;
        if (pas(def) === 'pressure') dmg -= 2;
      }
      dmg = Math.max(dmg, mult > 0 && base > 0 ? 1 : 0);

      // shield soaks first
      if (def.shield > 0 && dmg > 0) {
        const soak = Math.min(def.shield, dmg);
        def.shield -= soak; dmg -= soak;
        await emit('shield', { u: def, soak });
      }

      // lethal saves
      if (dmg >= def.hp) {
        if (def.item === 'focussash' && !def.flags.sashUsed) {
          def.flags.sashUsed = true; dmg = def.hp - 1;
          await announce(def, 'Focus Sash!');
        } else if (pas(def) === 'sturdy' && !def.flags.sturdyUsed) {
          def.flags.sturdyUsed = true; dmg = def.hp - 1;
          await announce(def, 'Sturdy!');
        }
      }

      def.hp -= dmg;
      await emit('damage', { u: def, amt: dmg, eff: mult, from: att, tag: opts.tag });

      // post-damage self-saves
      if (!def.dead && def.hp > 0) {
        if (def.item === 'oranberry' && !def.flags.oranUsed && def.hp < def.maxHp / 2) {
          def.flags.oranUsed = true; await heal(def, 5, 'Oran Berry');
        }
        if (mv(def).key === 'rest' && mv(def).trigger === 'hurt' && !def.flags.restUsed && def.hp < def.maxHp * .4) {
          def.flags.restUsed = true; await announce(def, moveName(def) + '!'); await heal(def, p(def, 'amt'), null);
        }
        if (mv(def).key === 'flail' && def.hp > 0 && att) {
          const amt = p(def, 'amt'); def.atk += amt;
          await announce(def, moveName(def) + '!'); await emit('buff', { u: def, atk: amt, hp: 0 });
        }
      }
      return dmg;
    }
    const u_isDot = (opts) => opts.tag === 'burn' || opts.tag === 'poison' || opts.tag === 'curse';

    async function heal(u, amt, label) {
      if (u.dead || amt <= 0) return;
      const real = Math.min(amt, u.maxHp - u.hp);
      if (real <= 0) return;
      u.hp += real;
      await emit('heal', { u, amt: real, label });
    }

    async function applyStatus(u, kind, turns) {
      if (u.dead) return false;
      if (pas(u) === 'immuneStatus' && kind !== 'flinch') { await emit('immune', { u }); return false; }
      if (kind === 'flinch' && (pas(u) === 'noFlinch' || pas(u) === 'immuneStatus')) { await emit('immune', { u }); return false; }
      if (kind === 'flinch') u.status.flinch += turns;
      else u.status[kind] = Math.max(u.status[kind], turns);
      await emit('status', { u, kind });
      return true;
    }

    async function debuffAtk(u, amt) {
      if (u.dead) return;
      if (pas(u) === 'noDebuff') { await emit('immune', { u }); return; }
      u.atk = Math.max(0, u.atk - amt);
      await emit('buff', { u, atk: -amt, hp: 0 });
    }

    async function buff(u, a, h) {
      if (u.dead) return;
      u.atk += a; if (h) { u.hp += h; u.maxHp += h; }
      await emit('buff', { u, atk: a, hp: h || 0 });
    }

    // ── Faint processing (loops because Explosion can chain) ──
    async function processFaints() {
      let any = true;
      while (any) {
        any = false;
        for (const side of ['P', 'E']) {
          for (const u of T[side]) {
            if (!u.dead && u.hp <= 0) {
              any = true;
              u.dead = true;
              await emit('faint', { u });
              // faint move
              if (mv(u).trigger === 'faint' && mv(u).key === 'explode') {
                await announce(u, moveName(u) + '!');
                const targets = alive(foes(u)).slice(0, 2);
                for (const t of targets) await dealDamage(u, t, p(u, 'dmg'), { type: ln(u).type, tag: 'explode' });
              }
              // reactions
              for (const a of alive(pals(u))) if (pas(a) === 'vengeful') { await announce(a, DATA.PASSIVES.vengeful.name + '!'); await buff(a, 2, 0); }
              for (const e of alive(foes(u))) if (pas(e) === 'moxie') { await announce(e, DATA.PASSIVES.moxie.name + '!'); await buff(e, 1, 0); }
            }
          }
        }
      }
    }

    // ── One strike: att hits the enemy front ──
    async function strike(att, defTeam, opts) {
      opts = opts || {};
      const def = front(defTeam);
      if (!def || att.dead) return;

      if (att.status.flinch > 0) { att.status.flinch--; await emit('skip', { u: att, why: 'flinched' }); return; }
      if (att.status.para > 0 && U.chance(.4)) { await emit('skip', { u: att, why: 'paralyzed' }); return; }

      await emit('strike', { u: att, target: def });
      let base = Math.max(1, opts.halfPower ? Math.ceil(effAtk(att) / 2) : effAtk(att));

      // strike modifiers from the attacker's move
      const m = mv(att);
      let flat = 0, tag = null;
      if (!opts.plain && m.trigger === 'attack') {
        if (m.key === 'crit' && U.chance(p(att, 'chance'))) { base *= (m.mult || 2); await announce(att, moveName(att) + ' — critical!'); }
        if (m.key === 'ambush' && !att.flags.struck) { base *= (m.mult || 2); await announce(att, moveName(att) + '!'); }
        if (m.key === 'recoilBonus') { flat += p(att, 'dmg'); tag = 'bonus'; }
        if (m.key === 'guillotine' && U.chance(p(att, 'chance'))) {
          await announce(att, moveName(att) + '!');
          await dealDamage(att, def, def.hp + def.shield, { type: ln(att).type, ignoreReduction: true, tag: 'guillotine' });
        }
      }
      // item boost for matching types is already in atk (shop layer for player; enemies get it in genEnemy)
      const dealt = await dealDamage(att, def, base, { isStrike: true, canDodge: true, flat, tag });
      att.flags.struck = true;

      // attacker heals
      if (att.item === 'shellbell') await heal(att, 2, 'Shell Bell');

      // post-strike move effects
      if (!opts.plain && m.trigger === 'attack' && !att.dead) {
        if (m.key === 'recoilBonus' && (m.self ? U.byLevel(m.self, att.level) : 0) > 0) {
          await dealDamage(null, att, U.byLevel(m.self, att.level), { ignoreReduction: true, tag: 'recoil' });
        }
        if (m.key === 'lifesteal' && dealt > 0) { await announce(att, moveName(att) + '!'); await heal(att, Math.max(1, Math.round(dealt * p(att, 'pct'))), null); }
        if (m.key === 'burnHit' && !def.dead && U.chance(p(att, 'chance'))) { await announce(att, moveName(att) + '!'); await applyStatus(def, 'burn', 3); }
        if (m.key === 'paraHit' && !def.dead && U.chance(p(att, 'chance'))) { await announce(att, moveName(att) + '!'); await applyStatus(def, 'para', 3); }
        if (m.key === 'flinchHit' && !def.dead && U.chance(p(att, 'chance'))) { await announce(att, moveName(att) + '!'); await applyStatus(def, 'flinch', 1); }
        if (m.key === 'splash') {
          const a = alive(defTeam); const behind = a[1];
          if (behind) { await announce(att, moveName(att) + '!'); await dealDamage(att, behind, p(att, 'dmg'), { tag: 'splash' }); }
        }
        if (m.key === 'hitBack') {
          const b = back(defTeam);
          if (b && b !== def) { await announce(att, moveName(att) + '!'); await dealDamage(att, b, p(att, 'dmg'), { tag: 'snipe' }); }
        }
        if (m.key === 'hitAll') {
          await announce(att, moveName(att) + '!');
          for (const t of alive(defTeam)) await dealDamage(att, t, p(att, 'dmg'), { tag: 'aoe' });
        }
        if (m.key === 'metronome') {
          await announce(att, 'Metronome!');
          const roll = U.rint(1, 6);
          if (roll === 1 && !def.dead) await applyStatus(def, 'burn', 3);
          else if (roll === 2 && !def.dead) await applyStatus(def, 'para', 3);
          else if (roll === 3 && !def.dead) await applyStatus(def, 'poison', 3);
          else if (roll === 4) await heal(att, 4, 'Metronome');
          else if (roll === 5) await buff(att, 2, 2);
          else if (!def.dead) await dealDamage(att, def, 3, { tag: 'bonus' });
        }
        if (m.key === 'strikeAgain' && !def.dead && U.chance(p(att, 'chance'))) {
          await announce(att, moveName(att) + '!');
          await strike(att, defTeam, { halfPower: true, plain: true });
        }
      }

      // defender melee reactions
      if (dealt > 0 && !def.dead && !att.dead) {
        if (def.item === 'rockyhelmet') { await announce(def, 'Rocky Helmet!'); await dealDamage(null, att, 2, { ignoreReduction: true, tag: 'thorns' }); }
        if (mv(def).trigger === 'hurt' && mv(def).key === 'reflect' && !att.dead) {
          await announce(def, moveName(def) + '!');
          await dealDamage(def, att, U.byLevel(mv(def).dmg, def.level), { tag: 'counter' });
        }
        if (pas(def) === 'static' && !att.dead && U.chance(.3)) { await announce(def, 'Static!'); await applyStatus(att, 'para', 3); }
        if (pas(def) === 'spore' && !att.dead && U.chance(.3)) { await announce(def, DATA.PASSIVES.spore.name + '!'); await applyStatus(att, 'poison', 3); }
      }
    }

    // ── Battle start triggers, ordered by attack ──
    await emit('begin', { P: teamP, E: teamE });
    const starters = [...teamP, ...teamE].filter(u => !u.dead).sort((a, b) => b.atk - a.atk);
    for (const u of starters) {
      if (u.dead) continue;
      if (pas(u) === 'intimidate') {
        const f = front(foes(u));
        if (f) { await announce(u, 'Intimidate!'); await debuffAtk(f, 1); }
      }
      const m = mv(u);
      if (m.trigger !== 'start') continue;
      const enemyFront = front(foes(u));
      if (m.key === 'debuffAtk' && enemyFront) { await announce(u, moveName(u) + '!'); await debuffAtk(enemyFront, p(u, 'amt')); }
      if (m.key === 'burnFront' && enemyFront && U.chance(p(u, 'chance'))) { await announce(u, moveName(u) + '!'); await applyStatus(enemyFront, 'burn', 3); }
      if (m.key === 'burnAll') { await announce(u, moveName(u) + '!'); for (const t of alive(foes(u))) if (U.chance(p(u, 'chance'))) await applyStatus(t, 'burn', 3); }
      if (m.key === 'paraFront' && enemyFront && U.chance(p(u, 'chance'))) { await announce(u, moveName(u) + '!'); await applyStatus(enemyFront, 'para', 3); }
      if (m.key === 'flinchFront' && enemyFront) { await announce(u, moveName(u) + '!'); await applyStatus(enemyFront, 'flinch', p(u, 'count')); }
      if (m.key === 'shieldSelf') { await announce(u, moveName(u) + '!'); u.shield += p(u, 'amt'); await emit('shieldGain', { u, amt: p(u, 'amt') }); }
      if (m.key === 'buffSelf') { await announce(u, moveName(u) + '!'); await buff(u, p(u, 'atk'), p(u, 'hp')); }
      if (m.key === 'hitFront' && enemyFront) { await announce(u, moveName(u) + '!'); await dealDamage(u, enemyFront, p(u, 'dmg'), { tag: 'opener' }); }
      if (m.key === 'hitBack') { const b = back(foes(u)); if (b) { await announce(u, moveName(u) + '!'); await dealDamage(u, b, p(u, 'dmg'), { tag: 'snipe' }); } }
      if (m.key === 'hitAll') { await announce(u, moveName(u) + '!'); for (const t of alive(foes(u))) await dealDamage(u, t, p(u, 'dmg'), { tag: 'aoe' }); }
      if (m.key === 'curseFront' && enemyFront) { await announce(u, moveName(u) + '!'); await applyStatus(enemyFront, 'curse', p(u, 'turns')); }
      await processFaints();
      if (!front(teamP) || !front(teamE)) break;
    }

    // ── Exchange loop ──
    let exchanges = 0;
    while (front(teamP) && front(teamE) && exchanges < 80) {
      exchanges++;
      await emit('exchange', { n: exchanges });
      const a = front(teamP), b = front(teamE);

      const aFirst = isFirstStriker(a) && !isFirstStriker(b);
      const bFirst = isFirstStriker(b) && !isFirstStriker(a);
      if (aFirst || bFirst) {
        const [x, yTeam, y, xTeam] = aFirst ? [a, teamE, b, teamP] : [b, teamP, a, teamE];
        await strike(x, yTeam);
        await processFaints();
        if (!y.dead && !x.dead) { await strike(y, xTeam); await processFaints(); }
      } else {
        // simultaneous: faints resolve after both blows, so a unit at 0 HP still swings
        await strike(a, teamE);
        if (!a.dead) await strike(b, teamP);
        await processFaints();
      }

      // end-of-exchange ticks for everyone alive
      for (const u of [...alive(teamP), ...alive(teamE)]) {
        if (u.status.burn > 0) { u.status.burn--; await dealDamage(null, u, 2, { tag: 'burn', ignoreReduction: true }); }
        if (u.dead) continue;
        if (u.status.curse > 0) { u.status.curse--; await dealDamage(null, u, 2, { tag: 'curse', ignoreReduction: true }); }
        if (u.dead) continue;
        if (u.status.poison > 0) { u.status.poison--; await dealDamage(null, u, 1, { tag: 'poison', ignoreReduction: true }); }
        if (u.dead) continue;
        if (u.status.para > 0) u.status.para--;
        if (pas(u) === 'regen') await heal(u, 1, null);
        if (u.item === 'leftovers') await heal(u, 1, 'Leftovers');
        const m = mv(u);
        if (m.trigger === 'turnEnd') {
          if (m.key === 'ramp') { await announce(u, moveName(u) + '!'); await buff(u, p(u, 'atk'), p(u, 'hp') || 0); }
          if (m.key === 'quake') {
            u.exch++;
            if (u.exch % (m.every || 3) === 0) {
              await announce(u, moveName(u) + '!');
              for (const t of alive(foes(u))) await dealDamage(u, t, p(u, 'dmg'), { tag: 'aoe' });
            }
          }
        }
      }
      await processFaints();
    }

    const pAlive = alive(teamP).length, eAlive = alive(teamE).length;
    const winner = pAlive && !eAlive ? 'P' : eAlive && !pAlive ? 'E' : pAlive && eAlive ? 'draw' : 'draw';
    await emit('end', { winner, exchanges });
    return { winner, exchanges, survivorsP: pAlive, survivorsE: eAlive };
  }

  // ── Enemy team generation, scaled by turn ──
  function genEnemyTeam(turn) {
    const size = Math.min(5, 2 + Math.ceil(turn / 3));
    const maxTier = U.clamp(Math.ceil(turn / 2), 1, 6);
    const pool = DATA.shopLines.filter(l => l.tier <= maxTier);
    const lv2Chance = turn >= 6 ? Math.min(.8, (turn - 5) * .12) : 0;
    const lv3Chance = turn >= 11 ? Math.min(.7, (turn - 10) * .1) : 0;
    const flat = Math.floor(turn / 4);
    const heldChance = turn >= 8 ? .25 : 0;
    const heldPool = Object.keys(DATA.ITEMS).filter(k => DATA.ITEMS[k].kind === 'held');

    const team = [];
    for (let i = 0; i < size; i++) {
      const lineDef = U.pickW(pool, l => l.tier * l.tier + 1);
      const level = U.chance(lv3Chance) ? 3 : U.chance(lv2Chance) ? 2 : 1;
      const xp = level === 3 ? 6 : level === 2 ? 3 : 1;
      const sp = DATA.speciesAt(lineDef.id, level);
      const bonus = (xp - 1) + flat + U.rint(0, Math.floor(turn / 6));
      const item = U.chance(heldChance) ? U.pick(heldPool) : null;
      let atk = sp.atk + bonus, hp = sp.hp + bonus;
      if (item === 'choiceband') atk += 3;
      if (item === 'assaultvest') hp += 6;
      if (item && DATA.ITEMS[item].boost === lineDef.type) atk += 2;
      team.push(combatUnit({
        uid: U.uid(), side: 'E', lineId: lineDef.id, level,
        name: sp.name, emoji: sp.emoji, type: lineDef.type, tier: lineDef.tier,
        atk, hp, item,
      }));
    }
    // strongest up front-ish, with a little shuffle
    team.sort((a, b) => (b.atk + b.hp) - (a.atk + a.hp));
    const trainer = U.pick(DATA.TRAINER_CLASSES) + ' ' + U.pick(DATA.TRAINER_NAMES);
    return { team, trainer };
  }

  return { fromSaveUnit, combatUnit, simulate, genEnemyTeam };
})();

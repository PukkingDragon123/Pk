// ── main.js ── boot, ticking, dev hooks ──────────────────────────────────
(function () {
  function boot() {
    UI.render();
    UI.maybeShowAway();
    UI.maybeShowIntro();

    setInterval(UI.tick, 1000);                     // countdown labels
    setInterval(() => { G.save(); }, 30000);        // heartbeat save (keeps lastSeen fresh)
    window.addEventListener('beforeunload', () => G.save());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') G.save();
      else UI.maybeShowAway();
    });
  }

  // Dev helpers for testing: open with ?dev=1, then use window.dev.*
  if (U.params.get('dev') === '1') {
    window.dev = {
      G, DATA, Shop, Battle, Idle, UI,
      mats(n) { for (const m of Object.keys(DATA.MATS)) G.addMat(m, n || 50); G.save(); UI.render(); },
      gold(n) { if (G.s.run) { G.s.run.gold += (n || 50); G.save(); UI.render(); } },
      balls(n) { ['pokeball', 'greatball', 'ultraball', 'masterball'].forEach(b => G.addItem(b, n || 5)); G.save(); UI.render(); },
      trophies(n) { G.s.meta.trophies += (n || 50); G.save(); UI.render(); },
      finishTimers() { for (const t of Idle.nursery().active) t.start = Date.now() - t.dur - 1000; G.save(); UI.render(); },
      wipe() { G.hardReset(); location.reload(); },
    };
    console.log('dev mode: window.dev ready');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

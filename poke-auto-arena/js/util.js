// ── util.js ── tiny helpers, seedable RNG ────────────────────────────────
const U = (() => {
  // Mulberry32 seedable PRNG so battles/tests can be reproduced with ?seed=N
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const params = new URLSearchParams(location.search);
  const seedParam = params.get('seed');
  let rng = mulberry32(seedParam ? (parseInt(seedParam, 10) || 1) : ((Date.now() ^ (Math.random() * 1e9)) >>> 0));

  const rand = () => rng();
  const rint = (a, b) => a + Math.floor(rng() * (b - a + 1));       // inclusive
  const chance = (p) => rng() < p;
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const pickW = (arr, wfn) => {                                      // weighted pick
    let total = 0; for (const x of arr) total += wfn(x);
    let r = rng() * total;
    for (const x of arr) { r -= wfn(x); if (r <= 0) return x; }
    return arr[arr.length - 1];
  };
  const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  let uidCounter = 1;
  const uid = () => 'u' + (uidCounter++) + '_' + Math.floor(rand() * 1e6).toString(36);
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  // param that scales with level: arrays are [lv1, lv2, lv3]
  const byLevel = (p, level) => Array.isArray(p) ? p[clamp(level, 1, 3) - 1] : p;

  // "2h 05m" / "3m 12s" style countdown text
  function fmtDur(ms) {
    if (ms <= 0) return 'ready!';
    const s = Math.ceil(ms / 1000);
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60), sec = s % 60;
    if (m < 60) return m + 'm ' + String(sec).padStart(2, '0') + 's';
    const h = Math.floor(m / 60), min = m % 60;
    return h + 'h ' + String(min).padStart(2, '0') + 'm';
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  return { rand, rint, chance, pick, pickW, shuffle, clamp, clone, uid, sleep, byLevel, fmtDur, esc, params };
})();

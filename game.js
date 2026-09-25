'use strict';
/* ==========================================================================
   BITE DOWN — a push-your-luck dental roguelike set in a living swamp.
   - Rounds: Small Gator / Big Gator / Boss Gator across 8 antes
   - Bites (hands), X-Rays (discards), Charms (jokers), tooth deck, shop
   - Procedural pixel art on a 480x270 buffer, WebAudio synth sfx
   - Drag cards to use/sell, click cards for details, unlockable gloves
   ========================================================================== */

// ------------------------------------------------------------ canvas ------
// Logical play-field stays 480x270, but the backing store is SUPERSAMPLED by
// RS so curves, rotations, gradients and text render at much higher resolution
// (the whole scene is drawn with a base ctx.scale(RS) each frame).
const W = 480, H = 270, RS = 3;
const canvas = document.getElementById('game');
canvas.width = W * RS; canvas.height = H * RS;
let ctx = canvas.getContext('2d');   // let: offscreen passes (silhouettes) swap it briefly
ctx.imageSmoothingEnabled = false;
canvas.style.cursor = 'none'; // we draw our own pixel hand

let LAYOUT = { s: 1, rot: false };
function fit() {
  // visualViewport gives the true visible area on mobile (excludes the browser
  // toolbar), so the canvas never spills under the chrome and looks "zoomed".
  const vv = window.visualViewport;
  const vw = Math.max(1, Math.round(vv ? vv.width : innerWidth));
  const vh = Math.max(1, Math.round(vv ? vv.height : innerHeight));
  // portrait: rotate the landscape game 90deg so it fills the whole screen
  const rot = vh > vw;
  const availW = rot ? vh : vw, availH = rot ? vw : vh;
  const s = Math.min(availW / W, availH / H); // fractional fill — no wasted bars
  LAYOUT = { s, rot };
  canvas.style.width = Math.round(W * s) + 'px';
  canvas.style.height = Math.round(H * s) + 'px';
  canvas.style.transform = 'translate(-50%,-50%)' + (rot ? ' rotate(90deg)' : '');
}
const IS_TOUCH = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
function scheduleFit() { fit(); setTimeout(fit, 250); } // iOS lays out late after rotate
addEventListener('resize', fit);
addEventListener('orientationchange', scheduleFit);
if (window.visualViewport) { visualViewport.addEventListener('resize', fit); visualViewport.addEventListener('scroll', fit); }
// stop iOS pinch / double-tap zoom from fighting the fullscreen canvas
['gesturestart', 'gesturechange', 'gestureend'].forEach(g => addEventListener(g, e => e.preventDefault(), { passive: false }));
fit();

// ------------------------------------------------------------ helpers -----
const rnd = Math.random;
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const choice = a => a[Math.floor(rnd() * a.length)];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
// blend two #rrggbb colours; used for the lake's depth gradient
function mixHex(a, b, t) {
  t = clamp(t, 0, 1);
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round(lerp((pa >> 16) & 255, (pb >> 16) & 255, t));
  const g = Math.round(lerp((pa >> 8) & 255, (pb >> 8) & 255, t));
  const bl = Math.round(lerp(pa & 255, pb & 255, t));
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
}
const easeOut = t => 1 - (1 - t) * (1 - t);
const easeIn = t => t * t * t;
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function fmt(n) { n = Math.floor(n); const s = '' + n; let o = ''; for (let i = 0; i < s.length; i++) { o += s[i]; const left = s.length - 1 - i; if (left > 0 && left % 3 === 0) o += ','; } return o; }
let UID = 1; const uid = () => UID++;

// ------------------------------------------------------------ pixel font --
// 4x5 glyphs, each row is one hex digit, bit 8 = leftmost pixel
const FONT = {
  A:'69F99', B:'E9E9E', C:'69896', D:'E999E', E:'F8E8F', F:'F8E88', G:'68B96',
  H:'99F99', I:'72227', J:'722A4', K:'9ACA9', L:'8888F', M:'9FF99', N:'9DB99',
  O:'69996', P:'E9E88', Q:'699A5', R:'E9EA9', S:'7861E', T:'F4444', U:'99996',
  V:'99964', W:'99FF9', X:'99699', Y:'99644', Z:'F168F',
  '0':'69BD6','1':'4C44E','2':'E168F','3':'E161E','4':'99F11','5':'F8E1E',
  '6':'68E96','7':'F1244','8':'69696','9':'69716',
  '.':'00004', ',':'00048', ':':'04040', '!':'44404', '?':'E1604', '+':'04E40',
  '-':'00E00', '$':'476E4', '*':'0A4A0', '/':'12480', '(':'24442', ')':'42224',
  "'":'44000', '%':'92490', '>':'84248', '<':'12421', '=':'0E0E0', '#':'AFAFA',
  ' ':'00000'
};

function drawText(s, x, y, col, sc) {
  sc = sc || 1;
  s = ('' + s).toUpperCase();
  ctx.fillStyle = col;
  let cx = x | 0;
  for (let i = 0; i < s.length; i++) {
    const g = FONT[s[i]] || FONT['?'];
    for (let r = 0; r < 5; r++) {
      const bits = parseInt(g[r], 16);
      for (let c = 0; c < 4; c++) {
        if (bits & (8 >> c)) ctx.fillRect(cx + c * sc, (y | 0) + r * sc, sc, sc);
      }
    }
    cx += 5 * sc;
  }
}
const textW = (s, sc) => ('' + s).length * 5 * (sc || 1) - (sc || 1);
function drawTextC(s, cx, y, col, sc) { drawText(s, cx - textW(s, sc) / 2, y, col, sc); }
function drawTextSh(s, x, y, col, sc, sh) { drawText(s, x, y + (sc || 1), sh || '#00000090', sc); drawText(s, x, y, col, sc); }
function drawTextCSh(s, cx, y, col, sc, sh) { const x = cx - textW(s, sc) / 2; drawTextSh(s, x, y, col, sc, sh); }

// ------------------------------------------------------------ palette -----
const C = {
  ink: '#0b1416', white: '#f4f2e4', dim: '#8fa6a8', dark2: '#131f24',
  panel: '#1c2b33', panelHi: '#2c4250', edge: '#49646f', shadow: '#0a121599',
  blue: '#3ea6ff', blueD: '#1c5c9e', red: '#ff5348', redD: '#95251f',
  gold: '#ffc843', goldD: '#a4741a', green: '#63d66a', greenD: '#2c7d3a',
  purple: '#c07dff', orange: '#ff9838',
  maw: '#4a1420', mawD: '#320b14', tongue: '#c94f63', tongueHi: '#e0778a',
  gum: '#a03a4a',
};

// ------------------------------------------------------------ audio -------
let AC = null, muted = false;
// volume settings live in meta (loaded later); read lazily
function sfxGain() { try { return [0, 0.5, 1][meta.set.sfx]; } catch (e) { return 1; } }
function musGain() { try { return [0, 0.5, 1][meta.set.mus]; } catch (e) { return 1; } }
function audio() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
  if (AC && AC.state === 'suspended') AC.resume();
  return AC;
}
function tone(freq, dur, type, vol, slide, delay) {
  const ac = AC; if (!ac || muted) return;
  const t0 = ac.currentTime + (delay || 0);
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type || 'square';
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
  const gv = (vol || 0.12) * sfxGain();
  if (gv <= 0) return;
  g.gain.setValueAtTime(gv, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(ac.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
}
function noiseHit(dur, vol, delay, lp) {
  const ac = AC; if (!ac || muted) return;
  const t0 = ac.currentTime + (delay || 0);
  const n = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (rnd() * 2 - 1) * (1 - i / n);
  const s = ac.createBufferSource(); s.buffer = buf;
  const gv = vol * sfxGain();
  if (gv <= 0) return;
  const g = ac.createGain(); g.gain.setValueAtTime(gv, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp || 900;
  s.connect(f); f.connect(g); g.connect(ac.destination); s.start(t0);
}
const sfx = {
  hover() { tone(700, 0.025, 'square', 0.02); },
  click(chain) { tone(260 + Math.min(chain, 16) * 38, 0.07, 'square', 0.1, 60); tone(520 + chain * 38, 0.05, 'triangle', 0.06, 80, 0.02); },
  bank() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, 'triangle', 0.11, 0, i * 0.06)); },
  coin() { tone(988, 0.06, 'triangle', 0.1); tone(1319, 0.1, 'triangle', 0.1, 0, 0.06); },
  snap() { noiseHit(0.35, 0.35); tone(140, 0.3, 'sawtooth', 0.22, -100); tone(70, 0.4, 'sine', 0.25, -35, 0.05); },
  splash() { noiseHit(0.4, 0.18, 0.08, 500); },
  xray() { tone(420, 0.14, 'sine', 0.09, 480); tone(1200, 0.03, 'square', 0.05, 0, 0.18); tone(1200, 0.03, 'square', 0.05, 0, 0.32); },
  error() { tone(110, 0.12, 'square', 0.12, -20); },
  buy() { tone(660, 0.06, 'triangle', 0.1); tone(880, 0.08, 'triangle', 0.1, 0, 0.05); tone(1320, 0.1, 'triangle', 0.08, 0, 0.1); },
  boss() { tone(82, 0.4, 'sawtooth', 0.16, -20); tone(62, 0.5, 'sawtooth', 0.16, -14, 0.35); },
  win() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.16, 'square', 0.08, 0, i * 0.09)); },
  defuse() { tone(880, 0.08, 'sine', 0.1, 220); tone(1200, 0.1, 'sine', 0.08, 200, 0.07); },
  sweep() { [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.13, 'triangle', 0.1, 0, i * 0.05)); },
  pickup() { tone(500, 0.05, 'triangle', 0.09, 250); },
  drop() { tone(700, 0.06, 'triangle', 0.09, -280); },
  thunk() { tone(160, 0.08, 'square', 0.09, -50); },
  ach() { [659, 831, 988, 1319].forEach((f, i) => tone(f, 0.15, 'square', 0.07, 0, i * 0.08)); },
  whoosh() { noiseHit(0.28, 0.14, 0, 2400); tone(300, 0.24, 'sine', 0.05, -180); },
  pin() { tone(1400, 0.03, 'square', 0.08); tone(900, 0.05, 'square', 0.06, 0, 0.03); },
  pause() { tone(440, 0.08, 'triangle', 0.09, -120); },
  drill() { for (let k = 0; k < 5; k++) tone(180 + (k % 2) * 60, 0.08, 'sawtooth', 0.06, 40, k * 0.07); },
  pour() { [880, 1100, 1320].forEach((f, i) => tone(f, 0.07, 'triangle', 0.07, 0, i * 0.08)); },
  yank() { tone(200, 0.09, 'square', 0.1, 300); noiseHit(0.12, 0.1, 0.08, 1200); },
  spray() { noiseHit(0.3, 0.12, 0, 3000); },
  inject() { tone(1200, 0.04, 'sine', 0.07); tone(700, 0.1, 'sine', 0.06, -200, 0.05); },
};
// ---- per-screen soundtracks: bass + lead voices over a hat tick -----------
// note values in Hz, 0 = rest; each track is an 8-step loop
const TRACKS = {
  menu: { step: 0.30, bass: [55, 0, 65.4, 0, 49, 0, 58.3, 61.7], lead: [220, 0, 261.6, 293.7, 0, 246.9, 0, 196], lt: 'triangle', lv: 0.035 },
  map: { step: 0.26, bass: [49, 0, 55, 0, 58.3, 0, 55, 0], lead: [196, 220, 0, 246.9, 0, 220, 196, 0], lt: 'triangle', lv: 0.03 },
  fight: { step: 0.22, bass: [55, 0, 55, 65.4, 0, 49, 58.3, 0], lead: [0, 220, 0, 0, 261.6, 0, 220, 0], lt: 'square', lv: 0.022 },
  boss: { step: 0.19, bass: [49, 49, 0, 46.2, 49, 0, 55, 46.2], lead: [196, 0, 185, 0, 196, 220, 0, 185], lt: 'sawtooth', lv: 0.02 },
  shop: { step: 0.28, bass: [65.4, 0, 73.4, 0, 61.7, 0, 65.4, 0], lead: [261.6, 293.7, 0, 329.6, 0, 293.7, 261.6, 0], lt: 'triangle', lv: 0.035 },
};
function trackNow() {
  if (typeof G === 'undefined') return TRACKS.menu;
  if (G.paused) return null;
  switch (G.state) {
    case 'menu': case 'ranger': case 'how': case 'skins': case 'index': case 'tutorial': case 'pass': case 'gameover': case 'win': return TRACKS.menu;
    case 'intro': return TRACKS.boss;
    case 'map': case 'event': return TRACKS.map;
    case 'shop': case 'bench': return TRACKS.shop;
    default: return (G.round === 2 ? TRACKS.boss : TRACKS.fight);
  }
}
let musicNext = 0, musicStep = 0;
function musicTick() {
  const ac = AC; if (!ac || muted) return;
  const tr = trackNow(); if (!tr) { musicNext = ac.currentTime; return; }
  const mg = musGain(); if (mg <= 0) { musicNext = ac.currentTime; return; }
  while (musicNext < ac.currentTime + 0.25) {
    if (musicNext < ac.currentTime) musicNext = ac.currentTime;
    const t0 = musicNext, i = musicStep % 8;
    const bf = tr.bass[i];
    if (bf) {
      const o = ac.createOscillator(), g = ac.createGain(), fl = ac.createBiquadFilter();
      o.type = 'square'; o.frequency.value = bf;
      fl.type = 'lowpass'; fl.frequency.value = 260;
      g.gain.setValueAtTime(0.055 * mg, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + tr.step + 0.04);
      o.connect(fl); fl.connect(g); g.connect(ac.destination); o.start(t0); o.stop(t0 + tr.step + 0.08);
    }
    const lf = tr.lead[i];
    if (lf) {
      const o = ac.createOscillator(), g = ac.createGain(), fl = ac.createBiquadFilter();
      o.type = tr.lt; o.frequency.value = lf;
      fl.type = 'lowpass'; fl.frequency.value = 1400;
      g.gain.setValueAtTime(tr.lv * mg, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + tr.step * 1.6);
      o.connect(fl); fl.connect(g); g.connect(ac.destination); o.start(t0); o.stop(t0 + tr.step * 1.8);
    }
    if (i % 2 === 0) {
      const n = Math.floor(ac.sampleRate * 0.03);
      const buf = ac.createBuffer(1, n, ac.sampleRate); const d = buf.getChannelData(0);
      for (let k = 0; k < n; k++) d[k] = (rnd() * 2 - 1) * (1 - k / n);
      const src = ac.createBufferSource(); src.buffer = buf;
      const g = ac.createGain(); g.gain.setValueAtTime(0.016 * mg, t0 + tr.step * 0.5);
      const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
      src.connect(hp); hp.connect(g); g.connect(ac.destination); src.start(t0 + tr.step * 0.5);
    }
    musicStep++; musicNext += tr.step;
  }
}

// ------------------------------------------------------------ primitives --
function rect(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x | 0, y | 0, w | 0, h | 0); }
// corner cut tables for rr(): inset per scanline, built from a circle so that
// big radii actually round instead of falling back to a square.
const RCUT = (() => {
  const t = {};
  for (let r = 1; r <= 48; r++) {
    const a = [];
    for (let i = 0; i < r; i++) a.push(Math.ceil(r - Math.sqrt(r * r - (r - i) * (r - i))));
    t[r] = a;
  }
  return t;
})();
function rr(x, y, w, h, r, c) {
  x |= 0; y |= 0; w |= 0; h |= 0;
  r = Math.min(r, Math.floor(h / 2), Math.floor(w / 2));
  const cut = RCUT[r] || [];
  ctx.fillStyle = c;
  for (let i = 0; i < r; i++) {
    const k = cut[i] || 0;
    ctx.fillRect(x + k, y + i, w - 2 * k, 1);
    ctx.fillRect(x + k, y + h - 1 - i, w - 2 * k, 1);
  }
  ctx.fillRect(x, y + r, w, h - 2 * r);
}
// ======================= TEXTURED PIXEL SHADING ===========================
//  Every moulded block in the game is shaded like hand-placed pixel art: a
//  key light from the upper-left, a curved terminator with a 1px checker
//  dither between tones, a bounce-lit shadow edge and a fixed speckle grain
//  so no surface ever reads as smooth plastic.  The grain is hashed from the
//  pixel position, so it sits still on the surface instead of crawling.
//  Every ramp is [outline, shade, base, light, shine].
// ==========================================================================
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const MIXC = new Map();
function mixC(a, b, t) { const k = a + b + t; let v = MIXC.get(k); if (!v) { v = mixHex(a, b, t); MIXC.set(k, v); } return v; }
// Textured boxes are painted once per (size, ramp, options) into a little
// offscreen canvas and then stamped - the grain is position-independent, so
// the stamp is pixel-identical to painting it in place, at a fraction of the cost.
const PB_CACHE = new Map();
function plasticBox(x, y, w, h, r, ramp, o) {
  o = o || {};
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  if (w < 2 || h < 2) return;
  const key = w + ',' + h + ',' + r + ',' + ramp.join('') + (o.flat ? 'f' : '') + (o.noShine ? 'n' : '') + (o.smooth ? 's' : '') + (o.seed || 0);
  let c = PB_CACHE.get(key);
  if (!c) {
    c = document.createElement('canvas'); c.width = w * RS; c.height = h * RS;
    const c2 = c.getContext('2d'); c2.imageSmoothingEnabled = false; c2.setTransform(RS, 0, 0, RS, 0, 0);
    const main = ctx; ctx = c2;
    try { plasticBoxRaw(0, 0, w, h, r, ramp, o); } finally { ctx = main; }
    if (PB_CACHE.size > 6000) PB_CACHE.clear();
    PB_CACHE.set(key, c);
  }
  ctx.drawImage(c, x, y, w, h);
}
function plasticBoxRaw(x, y, w, h, r, ramp, o) {
  const ri = Math.max(1, r - 1);
  rr(x, y, w, h, r, ramp[0]);                                   // ink edge
  const ix = x + 1, iy = y + 1, iw = w - 2, ih = h - 2;
  rr(ix, iy, iw, ih, ri, ramp[2]);
  if (iw < 2 || ih < 2) return;
  const cutR = Math.min(ri, Math.floor(ih / 2), Math.floor(iw / 2)), cut = RCUT[cutR] || [];
  const inset = j => (j < cutR ? cut[j] : j >= ih - cutR ? cut[ih - 1 - j] : 0) || 0;
  const lit = o.noShine ? 0.26 : 0.4, shd = o.flat ? 2 : 0.74;
  const seed = o.seed || 0;
  for (let j = 0; j < ih; j++) {
    const k = inset(j), a = ix + k, b = ix + iw - k, rw = b - a, yy = iy + j, v = j / Math.max(1, ih - 1);
    if (rw <= 0) continue;
    if (!o.flat) {
      // lit wedge: a diagonal terminator, dithered on its edge
      const lw = Math.round(iw * (lit - v * 0.62) * 1.6) - k;
      if (lw > 0) {
        rect(a, yy, Math.min(lw, rw), 1, ramp[3]);
        if (lw < rw && ((j + seed) & 1)) rect(a + lw, yy, 1, 1, ramp[3]);
      }
      // core shadow down the right and along the floor
      const sw = Math.round(iw * (v - shd + 0.34) * 1.3) + (v > 0.82 ? rw : 0);
      const sw2 = Math.max(Math.min(rw, sw), iw > 5 ? 1 : 0);
      if (sw2 > 0) {
        rect(b - sw2, yy, sw2, 1, ramp[1]);
        if (sw2 < rw && ((j + seed + 1) & 1)) rect(b - sw2 - 1, yy, 1, 1, ramp[1]);
      }
    }
    // grain: dark pits and pale flecks at fixed spots on the surface
    if (!o.smooth && iw > 3 && ih > 3) {
      const pit = mixC(ramp[1], ramp[2], 0.45), fleck = mixC(ramp[2], ramp[3], 0.55);
      for (let xx = a + 1; xx < b - 1; xx++) {
        const q = hash2(xx - x + seed * 7, j + seed * 13);
        if (q < 0.05) rect(xx, yy, (q < 0.02 && xx < b - 2) ? 2 : 1, 1, pit);
        else if (q > 0.965 && j < ih * 0.7) rect(xx, yy, 1, 1, fleck);
      }
    }
  }
  // crisp top-left rim and a single pixel glint, no glossy blob
  if (!o.flat && iw > 4) {
    rect(ix + inset(0) + 1, iy, Math.max(0, Math.round(iw * 0.5) - inset(0)), 1, ramp[3]);
    if (!o.noShine && iw > 7 && ih > 6) rect(ix + 2, iy + 1, 1, 1, ramp[4]);
  }
}
function plasticRound(cx, cy, rad, ramp, o) {
  o = o || {};
  cx = Math.round(cx); cy = Math.round(cy);
  fillCircle(cx, cy, rad, ramp[0]);
  fillCircle(cx, cy, rad - 1, ramp[1]);
  fillCircle(cx - 1, cy - 1, rad - 2, ramp[2]);
  if (!o.flat && rad > 4) fillCircle(cx - 2, cy - 2, Math.max(1, rad - 4), ramp[3]);
  if (rad > 4) for (let a = 0; a < 10; a++) {
    const an = a * 2.4 + rad, rr2 = (rad - 2) * hash2(a, rad);
    rect(cx + Math.cos(an) * rr2, cy + Math.sin(an) * rr2, 1, 1, a & 1 ? ramp[1] : ramp[3]);
  }
  if (!o.noShine && rad > 3) rect(cx - rad + 3, cy - rad + 3, 1, 1, ramp[4]);
}
// a soft dithered sheen across a panel (checker pixels, never a smooth wash)
function plasticGloss(x, y, w, h, a) {
  ctx.save(); ctx.globalAlpha = a === undefined ? 0.16 : a;
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  for (let k = 0; k < h; k++) {
    const x0 = x + Math.round(w * 0.18 + k * 0.7), bw = Math.max(2, Math.round(w * 0.14));
    for (let i = 0; i < bw; i++) if (((i + k) & 1) === 0) rect(x0 + i, y + k, 1, 1, '#ffffff');
  }
  ctx.restore();
}

// ======================== GOLD & WOOD UI KIT ==============================
//  One house style for every frame in the game: a dark-outlined brass band
//  with scroll filigree at the corners, wrapped around an oiled-wood field.
//  Buttons are stamped brass plaques, headers are planks with steel straps,
//  bars are segmented brass.  Everything is built from these few pieces so
//  the shop, the index, the badges and the HUD all read as one set.
// ==========================================================================
const UGOLD = ['#2a1a06', '#8a5f10', '#d09a1e', '#f0c447', '#ffe89a'];  // outline..shine
const UWOOD = ['#241405', '#40230c', '#5c3413', '#74441c', '#8f5a28'];
const USTEEL = ['#0f2530', '#1d4a5e', '#2f7288', '#4f9fb8', '#9fdcee'];
const UPARCH = ['#2a1a06', '#9a7442', '#c8a06a', '#dfbc8e', '#f0d8b0'];

// the little brass scroll that sits in each corner of a frame
function goldCurl(cx, cy, sx, sy) {
  const px = (dx, dy, w, h, c) => rect(cx + sx * dx - (sx < 0 ? w - 1 : 0), cy + sy * dy - (sy < 0 ? h - 1 : 0), w, h, c);
  px(0, 0, 7, 1, UGOLD[3]);
  px(0, 0, 4, 1, UGOLD[4]);
  px(0, 1, 4, 1, UGOLD[2]);
  px(0, 1, 1, 6, UGOLD[3]);
  px(1, 1, 1, 4, UGOLD[4]);
  px(1, 5, 1, 1, UGOLD[2]);
  px(5, 1, 2, 1, UGOLD[1]);
  px(3, 3, 3, 1, UGOLD[2]);
  px(4, 4, 2, 1, UGOLD[1]);
  px(2, 4, 1, 2, UGOLD[2]);
}

// fixed pixel grain over a rectangle: pits in `dk`, flecks in `lt`
function grainRect(x, y, w, h, dk, lt, dens, seed) {
  dens = dens || 0.05; seed = seed || 0;
  x |= 0; y |= 0;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const q = hash2(i + x * 3 + seed, j + y * 5);
    if (q < dens) rect(x + i, y + j, 1, 1, dk);
    else if (lt && q > 1 - dens * 0.6) rect(x + i, y + j, 1, 1, lt);
  }
}
// oiled plank grain: long broken streaks and the odd knot
function woodGrain(x, y, w, h, dk, lt, seed) {
  seed = seed || 0; x |= 0; y |= 0;
  for (let j = 1; j < h - 1; j += 2) {
    let i = Math.floor(hash2(j, seed) * 9);
    while (i < w - 2) {
      const len = 4 + Math.floor(hash2(i + seed, j) * 14);
      const q = hash2(i, j + seed * 3);
      rect(x + i, y + j, Math.min(len, w - 1 - i), 1, q < 0.5 ? dk : lt);
      i += len + 3 + Math.floor(q * 10);
    }
  }
  if (w > 30 && h > 12) {
    const kx = x + 6 + Math.floor(hash2(seed, 9) * (w - 12)), ky = y + 3 + Math.floor(hash2(9, seed) * (h - 6));
    rr(kx - 2, ky - 1, 5, 3, 1, dk); rect(kx - 1, ky, 3, 1, lt);
  }
}

// A framed tile: brass band, corner scrolls, wood (or custom) field.
// o = { field, fieldD, r, flat, thin, glow }
function goldFrame(x, y, w, h, o) {
  o = o || {};
  x |= 0; y |= 0; w |= 0; h |= 0;
  const r = o.r === undefined ? 4 : o.r;
  const F = o.field || UWOOD[2], FD = o.fieldD || UWOOD[1], FL = o.fieldL || UWOOD[3];
  if (o.glow) { ctx.save(); ctx.globalAlpha = o.glow; rr(x - 3, y - 3, w + 6, h + 6, r + 2, UGOLD[3]); ctx.restore(); }
  rr(x + 1, y + 3, w, h, r, '#00000077');
  rr(x, y, w, h, r, UGOLD[0]);                         // outline
  rr(x + 1, y + 1, w - 2, h - 2, r, UGOLD[1]);         // band shadow
  rr(x + 1, y + 1, w - 2, h - 3, r, UGOLD[2]);         // band
  rect(x + 3, y + 1, w - 6, 1, UGOLD[4]);              // band top light
  rect(x + 1, y + 3, 1, h - 6, UGOLD[3]);
  const b = o.thin ? 2 : 3;
  rr(x + b, y + b, w - b * 2, h - b * 2, Math.max(1, r - 2), UGOLD[0]);
  rr(x + b + 1, y + b + 1, w - b * 2 - 2, h - b * 2 - 2, Math.max(1, r - 2), F);
  if (!o.flat) {                                        // lit top, dithered falloff, shaded floor
    const lh = Math.max(2, (h - b * 2) >> 2);
    rr(x + b + 1, y + b + 1, w - b * 2 - 2, lh, Math.max(1, r - 2), FL);
    for (let i = 0; i < w - b * 2 - 4; i += 2) rect(x + b + 2 + i, y + b + 1 + lh, 1, 1, FL);
    rect(x + b + 1, y + h - b - 3, w - b * 2 - 2, 2, FD);
    if (!o.field || o.grain) woodGrain(x + b + 1, y + b + 2 + lh, w - b * 2 - 2, h - b * 2 - lh - 5, FD, FL, x + y);
  }
  // brass band texture: a few worn pits along the rim
  for (let i = 4; i < w - 4; i += 7) rect(x + i + ((i * 3) % 4), y + h - 2, 1, 1, UGOLD[1]);
  for (let i = 5; i < w - 5; i += 9) rect(x + i, y + 2, 1, 1, UGOLD[3]);
  if (w >= 26 && h >= 26) {
    goldCurl(x + 2, y + 2, 1, 1); goldCurl(x + w - 3, y + 2, -1, 1);
    goldCurl(x + 2, y + h - 3, 1, -1); goldCurl(x + w - 3, y + h - 3, -1, -1);
  }
}

// A stamped brass plaque - the standard button face.  `tint` recolours it.
function plaque(x, y, w, h, o) {
  o = o || {};
  const t = o.tint;
  const g = t ? [mixHex(t, '#000000', 0.7), mixHex(t, '#000000', 0.45), t, mixHex(t, '#ffffff', 0.3), mixHex(t, '#ffffff', 0.62)] : UGOLD;
  const r = o.r === undefined ? 3 : o.r;
  rr(x, y + 2, w, h, r, '#00000088');
  rr(x, y, w, h, r, g[0]);
  rr(x + 1, y + 1, w - 2, h - 2, r, g[1]);
  rr(x + 1, y + 1, w - 2, h - 3, r, g[2]);
  const half = Math.max(1, (h - 4) >> 1);
  rr(x + 2, y + 2, w - 4, half, Math.max(1, r - 1), g[3]);
  for (let i = 0; i < w - 5; i += 2) rect(x + 3 + i, y + 2 + half, 1, 1, g[3]);   // dithered break
  rect(x + 3, y + 2, w - 6, 1, g[4]);
  rect(x + 2, y + h - 3, w - 4, 1, g[1]);
  // stamped-metal grain: brushed streaks and pits, fixed to the plate
  const pits = mixC(g[1], g[2], 0.5), strk = mixC(g[3], g[4], 0.4);
  for (let j = 3; j < h - 3; j += 2) {
    const off = Math.floor(hash2(j, w) * 11);
    for (let i = 4 + off; i < w - 6; i += 13 + (j % 5)) rect(x + i, y + j, 3 + (j % 3), 1, j < 2 + half ? strk : pits);
  }
  if (!o.noStud && w >= 22) {                            // corner rivets
    [[x + 3, y + 3], [x + w - 5, y + 3], [x + 3, y + h - 6], [x + w - 5, y + h - 6]].forEach(([sx, sy]) => {
      rect(sx, sy, 2, 2, g[1]); rect(sx, sy, 1, 1, g[4]);
    });
  }
}

// A plank header with steel straps at both ends - used for titles and rows.
function woodBanner(x, y, w, h, label, o) {
  o = o || {};
  x |= 0; y |= 0;
  rr(x + 1, y + 2, w, h, 2, '#00000077');
  rr(x, y, w, h, 2, UWOOD[0]);
  rr(x + 1, y + 1, w - 2, h - 2, 2, UWOOD[2]);
  rect(x + 2, y + 1, w - 4, 1, UWOOD[4]);
  rect(x + 2, y + h - 2, w - 4, 1, UWOOD[1]);
  [x + 1, x + w - 8].forEach(sx => {                     // steel straps
    rr(sx, y - 1, 7, h + 2, 1, USTEEL[0]);
    rr(sx + 1, y, 5, h, 1, USTEEL[2]);
    rect(sx + 1, y, 2, h, USTEEL[3]);
    rect(sx + 2, y + 1, 1, h - 2, USTEEL[4]);
    rect(sx + 3, y + 2, 1, 1, USTEEL[1]); rect(sx + 3, y + h - 3, 1, 1, USTEEL[1]);
  });
  if (label) drawTextCSh(label, x + w / 2, y + Math.floor((h - 5 * (o.sc || 1)) / 2), o.col || '#ffe6b0', o.sc || 1, '#2a1a06');
}

// A segmented brass meter, like the reference's notched bar.
function segBar(x, y, w, h, frac, o) {
  o = o || {};
  rr(x, y, w, h, 2, UGOLD[0]);
  rr(x + 1, y + 1, w - 2, h - 2, 1, '#2f2212');
  const iw = w - 4, n = Math.max(1, Math.floor(iw / 5));
  const lit = Math.round(n * clamp(frac, 0, 1));
  for (let k = 0; k < n; k++) {
    const cx2 = x + 2 + k * (iw / n);
    const on = k < lit;
    rr(cx2, y + 2, Math.max(2, iw / n - 1), h - 4, 1, on ? (o.tint || UGOLD[2]) : '#4a3a20');
    if (on) rect(cx2, y + 2, Math.max(2, iw / n - 1), 1, o.tintL || UGOLD[4]);
  }
}

// A small steel-framed icon button, the square kind from the reference sheet.
function steelTile(x, y, w, h, o) {
  if (typeof h === 'object' || h === undefined) { o = h; h = w; }
  o = o || {};
  rr(x, y + 2, w, h, 3, '#00000077');
  rr(x, y, w, h, 3, USTEEL[0]);
  rr(x + 1, y + 1, w - 2, h - 2, 3, USTEEL[2]);
  rect(x + 2, y + 1, w - 4, 1, USTEEL[4]);
  rect(x + 1, y + 2, 1, h - 4, USTEEL[3]);
  rr(x + 3, y + 3, w - 6, h - 6, 2, o.field || '#12242e');
  if (o.hot) { ctx.save(); ctx.globalAlpha = 0.25 + Math.sin(tNow * 6) * 0.08; rr(x + 3, y + 3, w - 6, h - 6, 2, USTEEL[4]); ctx.restore(); }
}

// A panel with a real bevel: drop shadow, rim, a lit top-left inner edge and a
// shaded bottom-right, so every box in the game reads as a raised plate.
function panel(x, y, w, h, opts) {
  opts = opts || {};
  const r = opts.r === undefined ? 3 : opts.r;
  const face = opts.face || C.panel, edge = opts.edge || C.edge;
  rr(x + 1, y + 3, w, h, r, opts.sh || '#00000077');
  rr(x, y, w, h, r, edge);
  rr(x + 1, y + 1, w - 2, h - 2, Math.max(0, r - 1), face);
  if (opts.flat) return;
  ctx.save();
  ctx.globalAlpha = 0.16;
  rect(x + 2, y + 1, w - 4, 1, '#ffffff');            // lit top edge
  rect(x + 1, y + 2, 1, h - 4, '#ffffff');
  ctx.globalAlpha = 0.24;
  rect(x + 2, y + h - 2, w - 4, 1, '#000000');        // shaded bottom edge
  rect(x + w - 2, y + 2, 1, h - 4, '#000000');
  ctx.globalAlpha = 0.09;                              // one flat lit band
  rect(x + 2, y + 2, w - 4, Math.min(4, Math.max(1, h - 4)), '#ffffff');
  ctx.restore();
  if (opts.studs) {                                    // brass corner studs
    [[x + 2, y + 2], [x + w - 4, y + 2], [x + 2, y + h - 4], [x + w - 4, y + h - 4]].forEach(([sx, sy]) => {
      rect(sx, sy, 2, 2, '#8a6510'); rect(sx, sy, 1, 1, '#ffe089');
    });
  }
}
function fillCircle(cx, cy, r, col) {
  for (let dy = -r; dy <= r; dy++) {
    const w2 = Math.floor(Math.sqrt(r * r - dy * dy));
    rect(cx - w2, cy + dy, w2 * 2 + 1, 1, col);
  }
}

// --------------------------------------------------- swamp scene themes ---
// a soft light bloom: concentric discs so the falloff never shows a hard rim
// (the rings are painted once per radius+colour at full strength and then
// stamped with the requested alpha - big blooms were costing whole frames)
const GLOW_CACHE = new Map();
function glow(cx, cy, r, col, a) {
  a = a === undefined ? 0.12 : a;
  if (a <= 0) return;
  const R = Math.max(1, Math.round(r)), key = R + col;
  let c = GLOW_CACHE.get(key);
  if (!c) {
    const n = R > 30 ? 10 : 6, s2 = R * 2 + 2;
    c = document.createElement('canvas'); c.width = s2 * RS; c.height = s2 * RS;
    const c2 = c.getContext('2d'); c2.setTransform(RS, 0, 0, RS, 0, 0);
    const main = ctx; ctx = c2;
    try {
      for (let k = n; k >= 1; k--) { const f = k / n; ctx.globalAlpha = (1 - f) * 0.21 + 0.03; fillCircle(R + 1, R + 1, R * f, col); }
    } finally { ctx = main; }
    if (GLOW_CACHE.size > 400) GLOW_CACHE.clear();
    GLOW_CACHE.set(key, c);
  }
  ctx.save(); ctx.globalAlpha *= Math.min(1, a * 3.3);   // matches the old ring stack's build-up
  ctx.drawImage(c, Math.round(cx) - R - 1, Math.round(cy) - R - 1, R * 2 + 2, R * 2 + 2);
  ctx.restore();
}

const WATERY = 198; // waterline
const THEMES = {
  night: {
    sky: ['#0a1626', '#0c1c2e', '#0f2434', '#132c3c', '#17343f'],
    treeFar: '#0d2028', tree: '#071318', water: '#0a2028', waterHi: '#1e4a52',
    waterFront: '#081c24', moon: '#e8e8d0', moonHalo: '#e8e8d022', stars: true,
    reed: '#132d1e', reedHead: '#4a3320', pad: '#1a4a30', padHi: '#2a6a42',
  },
  boss: {
    sky: ['#180a12', '#1e0d16', '#26101a', '#2e141e', '#361822'],
    treeFar: '#22101a', tree: '#120711', water: '#1a0d14', waterHi: '#4a2030',
    waterFront: '#160a10', moon: '#c03830', moonHalo: '#c0383026', stars: false, rain: true,
    reed: '#241018', reedHead: '#3a1a20', pad: '#301820', padHi: '#48242e',
  },
  shop: {
    sky: ['#170f20', '#1e1428', '#281a32', '#32203c', '#3c2a44'],
    treeFar: '#241a30', tree: '#120c1c', water: '#120e20', waterHi: '#3c2a54',
    waterFront: '#100c1a', moon: '#f0d8a0', moonHalo: '#f0d8a022', stars: true,
    reed: '#1e1430', reedHead: '#4a3a28', pad: '#243048', padHi: '#38445e',
  },
  // ---- MALDIVES summer stage: bright turquoise lagoon + white sand ----
  maldives: {
    sky: ['#8fd8f0', '#a4e2f4', '#bceafa', '#d6f4fc', '#f0fbff'],
    treeFar: '#3f9e6a', tree: '#2e7a4e', water: '#2fc0d0', waterHi: '#a4f0ee',
    waterFront: '#28aec0', moon: '#fff4c8', moonHalo: '#fff4c822', stars: false,
    reed: '#3f9e6a', reedHead: '#e8d060', pad: '#3fc8a4', padHi: '#8ff0d0',
    day: true, sun: true, beach: true,
  },
  maldivesDusk: {
    sky: ['#ff9e6a', '#ffb27e', '#ffc79a', '#e0b0c8', '#9a86c8'],
    treeFar: '#7a5a6a', tree: '#3a2a44', water: '#3a86a8', waterHi: '#ffcf9a',
    waterFront: '#2e6e90', moon: '#fff0b0', moonHalo: '#fff0b022', stars: false,
    reed: '#7a5a6a', reedHead: '#e8d060', pad: '#3f8aa4', padHi: '#8fd0e0',
    day: true, sun: true, beach: true, dusk: true,
  },
};
function themeNow() {
  if (G.summer) {
    if (G.state === 'shop') return THEMES.maldives;
    if (G.round === 2 && G.state !== 'menu') return THEMES.maldivesDusk;
    return THEMES.maldives;
  }
  if (G.state === 'shop') return THEMES.shop;
  if (G.round === 2 && G.state !== 'menu') return THEMES.boss;
  return THEMES.night;
}

// scene entities
const fireflies = [];
for (let i = 0; i < 16; i++) fireflies.push({ x: rnd() * W, y: 60 + rnd() * 150, vx: 0, vy: 0, ph: rnd() * 9 });
let ripples = []; // {x,y,r,vr,t,life}
let bubbles = []; // {x,y,t}
let birds = [];   // {x,y,vx,vy,t}
const rain = [];
for (let i = 0; i < 42; i++) rain.push({ x: rnd() * W, y: rnd() * H, s: 2.4 + rnd() * 1.6 });
let bubbleTimer = 0;

function addRipple(x, y, big) {
  ripples.push({ x, y, r: 2, vr: big ? 34 : 20, t: 0, life: big ? 1.1 : 0.7 });
  if (big) ripples.push({ x, y, r: 1, vr: 22, t: -0.15, life: 1.2 });
}
function scareFireflies(x, y, pow) {
  fireflies.forEach(f => {
    const dx = f.x - x, dy = f.y - y, d = Math.max(8, Math.hypot(dx, dy));
    if (d < 90) { f.vx += dx / d * pow; f.vy += dy / d * pow; }
  });
}
function scatterBirds() {
  for (let i = 0; i < 5; i++) {
    birds.push({ x: 20 + rnd() * 90 + (i % 2 ? 330 : 0), y: 92 + rnd() * 30, vx: (rnd() < 0.5 ? -1 : 1) * (40 + rnd() * 30), vy: -30 - rnd() * 25, t: 0 });
  }
}
function splashWater() {
  addRipple(200 + rnd() * 180, 250, true);
  addRipple(180 + rnd() * 220, 258, true);
  for (let i = 0; i < 12; i++) parts.push({ x: 200 + rnd() * 180, y: 250, vx: (rnd() - 0.5) * 90, vy: -60 - rnd() * 80, g: 300, t: 0, life: 0.5 + rnd() * 0.4, col: '#7fb8c8', sz: ri(1, 2) });
  sfx.splash();
}

function updateScene(dt) {
  fireflies.forEach(f => {
    f.vx += (rnd() - 0.5) * 26 * dt; f.vy += (rnd() - 0.5) * 20 * dt;
    f.vx *= 0.985; f.vy *= 0.985;
    f.x += f.vx * dt; f.y += f.vy * dt;
    if (f.x < -8) f.x = W + 8; if (f.x > W + 8) f.x = -8;
    if (f.y < 46) { f.y = 46; f.vy = Math.abs(f.vy); }
    if (f.y > H - 6) { f.y = H - 6; f.vy = -Math.abs(f.vy); }
  });
  ripples = ripples.filter(rp => { rp.t += dt; rp.r += rp.vr * dt; return rp.t < rp.life; });
  bubbles = bubbles.filter(b => { b.t += dt; b.y -= 9 * dt; return b.t < 1.4; });
  birds = birds.filter(b => { b.t += dt; b.x += b.vx * dt; b.y += b.vy * dt; return b.x > -20 && b.x < W + 20 && b.y > -20; });
  bubbleTimer -= dt;
  if (bubbleTimer <= 0) { bubbleTimer = 1.4 + rnd() * 2.2; bubbles.push({ x: 150 + rnd() * 220, y: 246 + rnd() * 18, t: 0 }); }
  if (themeNow().rain) rain.forEach(d => { d.y += d.s * 150 * dt; d.x -= d.s * 22 * dt; if (d.y > H) { d.y = -6; d.x = rnd() * (W + 60); } });
}

function drawSceneBack(th) {
  // sky bands
  const bandH = Math.ceil(WATERY / th.sky.length);
  th.sky.forEach((c, i) => rect(0, i * bandH, W, bandH, c));
  // stars
  if (th.stars) {
    for (let i = 0; i < 34; i++) {
      const sx = (i * 97 + 13) % W, sy = (i * 53 + 7) % 105;
      const tw = Math.sin(tNow * 1.7 + i * 2.3);
      if (tw > -0.3) {
        ctx.globalAlpha = 0.25 + tw * 0.3;
        rect(sx, sy, 1, 1, '#cfe8f0');
        ctx.globalAlpha = 1;
      }
    }
  }
  // moon + halo
  const mx0 = 404, my0 = 40, mr = th === THEMES.boss ? 24 : 19;
  if (th.sun) {
    // blazing summer sun with slowly turning rays
    ctx.save();
    ctx.globalAlpha = 0.5; fillCircle(mx0, my0, mr + 8, th.moon); ctx.globalAlpha = 1;
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2 + tNow * 0.25;
      rect((mx0 + Math.cos(a) * (mr + 7)) | 0, (my0 + Math.sin(a) * (mr + 7)) | 0, 3, 3, th.moon);
    }
    fillCircle(mx0, my0, mr, '#fff0a8'); fillCircle(mx0, my0, mr - 4, '#fffce0');
    ctx.restore();
  } else {
    ctx.globalAlpha = 0.25; fillCircle(mx0, my0, mr + 6, th.moon); ctx.globalAlpha = 1;
    fillCircle(mx0, my0, mr, th.moon);
    ctx.globalAlpha = 0.22;
    fillCircle(mx0 - 6, my0 - 4, 4, '#000'); fillCircle(mx0 + 5, my0 + 6, 3, '#000'); fillCircle(mx0 + 8, my0 - 7, 2, '#000');
    ctx.globalAlpha = 1;
  }
  // soft moonbeam shafts falling toward the water
  ctx.save();
  [[-30, 16, 0.05], [-6, 20, 0.06], [16, 14, 0.04]].forEach(([ox, w2, a]) => {
    ctx.globalAlpha = a;
    for (let d = 0; d < 11; d++) {
      const yy = my0 + 24 + d * 12;
      if (yy > WATERY - 12) break;
      rect(mx0 + ox - d * 4, yy, w2, 12, th.moon);
    }
  });
  ctx.restore();
  // drifting clouds
  for (let k = 0; k < 3; k++) {
    const cw = 70 + k * 28;
    const cx0 = ((tNow * (4 + k * 2) + k * 210) % (W + cw + 60)) - cw - 30;
    const cloudCol = th.day ? '#ffffff' : '#000';
    ctx.globalAlpha = th.day ? 0.55 : 0.16;
    rr(cx0, 32 + k * 22, cw, 8, 3, cloudCol);
    rr(cx0 + 12, 28 + k * 22, cw - 30, 6, 3, cloudCol);
    ctx.globalAlpha = 1;
  }
  if (!th.beach) {
    // far treeline (jagged silhouette)
    for (let x = 0; x < W; x += 6) {
      const h1 = 34 + ((Math.sin(x * 0.13) * 12) | 0) + ((x * 7) % 9);
      rect(x, WATERY - h1, 6, h1, th.treeFar);
    }
    // near trees: two big canopies with trunks + hanging moss
    const treeBlob = (bx, bw, bh) => {
      rr(bx, WATERY - bh, bw, bh, 4, th.tree);
      rr(bx + bw / 4, WATERY - bh - 12, bw / 2, 16, 4, th.tree);
      rect(bx + bw / 2 - 3, WATERY - 28, 6, 28, th.tree);
    };
    treeBlob(-30, 130, 66); treeBlob(392, 120, 74);
    // moss strands
    for (let k = 0; k < 9; k++) {
      const x0 = k < 5 ? 8 + k * 20 : 396 + (k - 5) * 22;
      const len = 10 + (k * 37) % 14;
      const sway = Math.sin(tNow * 1.1 + k * 1.9) * 2;
      for (let seg = 0; seg < len; seg += 2) {
        rect(x0 + sway * (seg / len), WATERY - 62 + seg, 1, 2, th.treeFar);
      }
    }
  } else {
    // distant Maldives sandbars with a few palm silhouettes on the horizon
    for (let x = 0; x < W; x += 8) {
      const s = Math.sin(x * 0.045 + 1.2);
      if (s > -0.1) rect(x, WATERY - 6 - ((s * 6) | 0), 8, 8 + ((s * 6) | 0), th.treeFar);
    }
    [58, 190, 300, 372].forEach((px, i) => {
      const ph = WATERY - 12 - (i % 2) * 4;
      rect(px, ph, 2, 12, th.tree);
      for (let f = 0; f < 5; f++) { const a = f / 4 * Math.PI - Math.PI / 2; rect((px + 1 + Math.cos(a) * 6) | 0, (ph + 1 + Math.sin(a) * 4) | 0, 3, 2, th.tree); }
    });
  }
  // water
  rect(0, WATERY, W, H - WATERY, th.water);
  // moon reflection shimmer
  for (let k = 0; k < 8; k++) {
    const yy = WATERY + 4 + k * 8;
    const off = Math.sin(tNow * 1.3 + k) * (3 + k);
    ctx.globalAlpha = 0.35 - k * 0.035;
    rect(mx0 - 8 + off, yy, 14 - k, 1, th.moon);
    ctx.globalAlpha = 1;
  }
  // ripple highlight rows
  for (let k = 0; k < 5; k++) {
    const yy = WATERY + 6 + k * 13;
    const off = Math.sin(tNow * 0.8 + k * 2.2) * 9;
    for (let d = 0; d < 5; d++) {
      rect(((d * 100 + off + k * 31) % (W + 40)) - 20, yy, 12 + k * 2, 1, th.waterHi);
    }
  }
  // lilypads
  const pad = (px, py, w2) => {
    rr(px, py, w2, 4, 2, th.pad);
    rect(px + 2, py, w2 - 6, 1, th.padHi);
    rect(px + w2 - 4, py + 1, 3, 1, th.water); // notch
  };
  pad(52, 216, 20); pad(438, 228, 22); pad(88, 250, 18);
  rect(58, 213, 2, 2, '#e8a0c0'); // little flower
  // expanding click ripples (behind gator)
  drawRipples(0.5);
}

function drawRipples(alphaMul) {
  ripples.forEach(rp => {
    const a = clamp(1 - rp.t / rp.life, 0, 1) * (alphaMul || 1);
    if (rp.t < 0) return;
    ctx.globalAlpha = a * 0.6;
    const rx = rp.r, ry = rp.r * 0.32;
    for (let k = 0; k < 10; k++) {
      const ang = k / 10 * Math.PI * 2;
      rect(rp.x + Math.cos(ang) * rx, rp.y + Math.sin(ang) * ry, 2, 1, '#9fd8e0');
    }
    ctx.globalAlpha = 1;
  });
}

function drawSceneFront(th) {
  // low swamp mist drifting just above the waterline
  ctx.save();
  for (let m = 0; m < 2; m++) {
    ctx.globalAlpha = 0.05 + m * 0.025;
    for (let k = 0; k < 5; k++) {
      const xx = ((tNow * (6 + m * 4) + k * 110 + m * 55) % (W + 140)) - 70;
      rr(xx, WATERY - 9 + m * 5 + Math.sin(tNow + k) * 1.5, 92, 6, 3, '#cfe8f0');
    }
  }
  ctx.restore();
  // water strip in front of the gator (he sits IN the swamp)
  ctx.globalAlpha = 0.62;
  rect(0, 250, W, H - 250, th.waterFront);
  ctx.globalAlpha = 1;
  for (let d = 0; d < 6; d++) {
    const off = Math.sin(tNow * 0.9 + d * 1.7) * 7;
    rect(((d * 90 + off) % (W + 30)) - 15, 253 + (d % 3) * 5, 16, 1, th.waterHi);
  }
  drawRipples(1);
  // bubbles
  bubbles.forEach(b => {
    const a = 1 - b.t / 1.4;
    ctx.globalAlpha = a * 0.7;
    if (b.t > 1.15) { rect(b.x - 1, b.y, 3, 1, '#9fd8e0'); rect(b.x, b.y - 1, 1, 3, '#9fd8e0'); }
    else rect(b.x, b.y, 2, 2, '#7fb8c8');
    ctx.globalAlpha = 1;
  });
  if (th.beach) {
    // foreground palm trees framing the corners (drooping fronds + coconuts)
    const palm = (bx) => {
      const sway = Math.sin(tNow * 1.0 + bx * 0.1) * 2;
      for (let s = 0; s < 44; s += 2) rect((bx + sway * (s / 44)) | 0, H - s - 2, 3, 2, '#7a5330');
      const tx = (bx + sway) | 0, ty = H - 46;
      [-1.4, -0.9, -0.4, 0.2, 0.7, 1.2].forEach(a => {
        for (let l = 1; l <= 8; l++) rect((tx + 1 + Math.cos(a) * l * 2.6) | 0, (ty + Math.sin(a) * l * 1.8 + l * l * 0.06) | 0, 2, 2, l < 6 ? '#3aa85e' : '#2e7a4a');
      });
      rect(tx - 1, ty, 3, 3, '#8a6238'); rect(tx + 3, ty + 1, 2, 2, '#8a6238');
    };
    palm(122); palm(150); palm(455); palm(470);
    // sun-glints twinkling across the lagoon
    for (let k = 0; k < 16; k++) { const gx = (k * 97 + 23) % W, gy = WATERY + 6 + (k * 53) % 50; if (Math.sin(tNow * 3 + k * 1.7) > 0.55) rect(gx, gy, 2, 1, '#eaffff'); }
    // a couple of gulls drifting over the water
    for (let g = 0; g < 2; g++) {
      const gx = ((tNow * (11 + g * 5) + g * 250) % (W + 40)) - 20, gy = 52 + g * 16 + Math.sin(tNow * 0.8 + g) * 3, fw = Math.sin(tNow * 5 + g) > 0 ? 0 : -1;
      rect((gx - 3) | 0, (gy + fw) | 0, 3, 1, '#3a4c56'); rect((gx + 1) | 0, (gy + fw) | 0, 3, 1, '#3a4c56'); rect(gx | 0, gy | 0, 1, 1, '#3a4c56');
    }
  } else {
    // cattail reeds in the corners (clear of the sidebar)
    const reedAt = (x0, hh, k) => {
      const sway = Math.sin(tNow * 1.4 + k * 2.1) * 2;
      for (let seg = 0; seg < hh; seg += 2) {
        rect(x0 + sway * (seg / hh), H - seg - 2, 1, 2, th.reed);
      }
      rr(x0 + sway - 1, H - hh - 8, 3, 8, 1, th.reedHead);
    };
    reedAt(120, 26, 0); reedAt(128, 34, 1); reedAt(137, 22, 2);
    reedAt(458, 30, 3); reedAt(466, 40, 4); reedAt(473, 24, 5);
  }
  // fireflies (night only)
  if (!th.day) fireflies.forEach((f, i) => {
    const br = (Math.sin(tNow * 2.1 + f.ph) + 1) / 2;
    if (br > 0.55) {
      ctx.globalAlpha = (br - 0.55) * 0.8;
      rect(f.x - 1, f.y - 1, 3, 3, '#d8ff9033');
      rect(f.x, f.y, 1, 1, '#eaffa0');
      ctx.globalAlpha = 1;
      rect(f.x, f.y, 1, 1, '#eaffa0');
    } else {
      ctx.globalAlpha = 0.3; rect(f.x, f.y, 1, 1, '#a8c870'); ctx.globalAlpha = 1;
    }
  });
  // scattering birds
  birds.forEach(b => {
    const fl = Math.floor(b.t * 10) % 2;
    rect(b.x - 2, b.y + (fl ? 0 : -1), 2, 1, '#0a0f12');
    rect(b.x + 1, b.y + (fl ? 0 : -1), 2, 1, '#0a0f12');
    rect(b.x, b.y, 1, 1, '#0a0f12');
  });
  // rain (boss rounds)
  if (th.rain) {
    ctx.globalAlpha = 0.3;
    rain.forEach(d => { rect(d.x, d.y, 1, 5, '#9fb8d8'); rect(d.x - 1, d.y + 5, 1, 2, '#9fb8d8'); });
    ctx.globalAlpha = 1;
  }
}

// ------------------------------------------------------------ icons -------
// 12x12 procedural pixel icons
const ICONS = {
  tooth(x, y, a) { a = a || '#f4f2e4'; rr(x + 2, y + 1, 8, 8, 2, a); rect(x + 2, y + 8, 3, 3, a); rect(x + 7, y + 8, 3, 3, a); rect(x + 4, y + 3, 2, 3, '#00000022'); },
  coin(x, y) { rr(x + 1, y + 1, 10, 10, 3, C.goldD); rr(x + 2, y + 2, 8, 8, 3, C.gold); drawText('$', x + 4, y + 4, C.goldD); },
  skull(x, y) { rr(x + 2, y + 1, 8, 7, 2, '#e8e8e0'); rect(x + 3, y + 8, 6, 3, '#e8e8e0'); rect(x + 4, y + 4, 2, 2, C.ink); rect(x + 7, y + 4, 2, 2, C.ink); rect(x + 5, y + 9, 1, 2, C.ink); rect(x + 7, y + 9, 1, 2, C.ink); },
  eye(x, y) { rr(x + 1, y + 3, 10, 6, 2, '#e8e8e0'); rect(x + 5, y + 4, 3, 4, '#2277cc'); rect(x + 6, y + 5, 1, 1, C.ink); },
  syringe(x, y) { rect(x + 2, y + 4, 7, 4, '#cfe8f0'); rect(x + 9, y + 5, 2, 2, '#8aa'); rect(x + 1, y + 3, 2, 6, '#8aa'); rect(x + 4, y + 5, 2, 2, '#4fb3d9'); },
  star(x, y) { rect(x + 5, y + 1, 2, 10, C.gold); rect(x + 1, y + 5, 10, 2, C.gold); rect(x + 3, y + 3, 2, 2, C.gold); rect(x + 7, y + 3, 2, 2, C.gold); rect(x + 3, y + 7, 2, 2, C.gold); rect(x + 7, y + 7, 2, 2, C.gold); },
  gem(x, y, a) { a = a || '#58b6ff'; rect(x + 3, y + 2, 6, 2, a); rect(x + 2, y + 4, 8, 2, a); rect(x + 3, y + 6, 6, 2, a); rect(x + 4, y + 8, 4, 1, a); rect(x + 5, y + 9, 2, 1, a); rect(x + 4, y + 3, 2, 2, '#ffffff88'); },
  crown(x, y) { rect(x + 2, y + 7, 8, 3, C.gold); rect(x + 2, y + 3, 2, 4, C.gold); rect(x + 5, y + 2, 2, 5, C.gold); rect(x + 8, y + 3, 2, 4, C.gold); },
  drill(x, y) { rect(x + 2, y + 2, 5, 4, '#9fb2b8'); rect(x + 7, y + 3, 3, 2, '#748a91'); rect(x + 10, y + 3, 1, 2, '#e8e8e0'); rect(x + 3, y + 6, 3, 4, '#748a91'); },
  heart(x, y) { rect(x + 2, y + 3, 3, 3, C.red); rect(x + 7, y + 3, 3, 3, C.red); rect(x + 2, y + 5, 8, 2, C.red); rect(x + 3, y + 7, 6, 2, C.red); rect(x + 5, y + 9, 2, 1, C.red); },
  shield(x, y) { rr(x + 2, y + 1, 8, 7, 2, '#8fd0ff'); rect(x + 3, y + 8, 6, 2, '#8fd0ff'); rect(x + 5, y + 10, 2, 1, '#8fd0ff'); rect(x + 5, y + 3, 2, 5, '#2277cc'); },
  fang(x, y) { rect(x + 4, y + 1, 4, 4, '#f4f2e4'); rect(x + 5, y + 5, 3, 3, '#f4f2e4'); rect(x + 6, y + 8, 2, 3, '#f4f2e4'); },
  candy(x, y) { rr(x + 2, y + 2, 8, 8, 3, '#ff8bd0'); rect(x + 3, y + 5, 6, 2, '#fff'); rect(x + 0, y + 5, 2, 2, '#ff8bd0'); rect(x + 10, y + 5, 2, 2, '#ff8bd0'); },
  magnet(x, y) { rect(x + 2, y + 2, 3, 7, C.red); rect(x + 7, y + 2, 3, 7, '#4488ff'); rect(x + 2, y + 8, 8, 2, '#aaa'); rect(x + 2, y + 2, 3, 2, '#e8e8e0'); rect(x + 7, y + 2, 3, 2, '#e8e8e0'); },
  snow(x, y) { rect(x + 5, y + 1, 2, 10, '#bfe8ff'); rect(x + 1, y + 5, 10, 2, '#bfe8ff'); rect(x + 2, y + 2, 2, 2, '#bfe8ff'); rect(x + 8, y + 2, 2, 2, '#bfe8ff'); rect(x + 2, y + 8, 2, 2, '#bfe8ff'); rect(x + 8, y + 8, 2, 2, '#bfe8ff'); },
  fairy(x, y) { rect(x + 5, y + 2, 2, 8, '#e8e8e0'); rect(x + 2, y + 4, 8, 2, '#e8e8e0'); rect(x + 3, y + 1, 1, 1, C.gold); rect(x + 9, y + 3, 1, 1, C.gold); rect(x + 2, y + 9, 1, 1, C.gold); },
  xrayic(x, y) { rr(x + 1, y + 2, 10, 8, 2, '#123'); rr(x + 2, y + 3, 8, 6, 1, '#1a3a55'); ICONS.tooth(x, y - 1, '#9fe8ff'); },
  money(x, y) { rr(x + 1, y + 3, 10, 7, 1, C.greenD); rr(x + 2, y + 4, 8, 5, 1, C.green); drawText('$', x + 4, y + 5, C.greenD); },
  pliers(x, y) { rect(x + 3, y + 1, 2, 5, '#9fb2b8'); rect(x + 7, y + 1, 2, 5, '#9fb2b8'); rect(x + 4, y + 6, 4, 2, '#748a91'); rect(x + 3, y + 8, 2, 3, C.red); rect(x + 7, y + 8, 2, 3, C.red); },
  mirror(x, y) { rr(x + 2, y + 1, 8, 8, 3, '#c8b060'); rr(x + 3, y + 2, 6, 6, 2, '#bfe8ff'); rect(x + 4, y + 3, 2, 2, '#fff'); rect(x + 5, y + 9, 2, 3, '#c8b060'); },
  bottle(x, y) { rect(x + 5, y + 1, 2, 2, '#8a6a3a'); rect(x + 4, y + 3, 4, 2, '#4fae5c'); rr(x + 3, y + 5, 6, 6, 2, '#4fae5c'); rect(x + 4, y + 7, 2, 2, '#8fe89c'); },
  mud(x, y) { rr(x + 1, y + 6, 10, 5, 2, '#6a4a2a'); rect(x + 3, y + 4, 3, 3, '#8a6238'); rect(x + 7, y + 5, 2, 2, '#8a6238'); rect(x + 5, y + 2, 2, 2, '#8a6238'); },
  bolt(x, y) { rect(x + 6, y + 1, 3, 4, C.gold); rect(x + 4, y + 4, 4, 3, C.gold); rect(x + 3, y + 7, 3, 4, C.gold); },
  snake(x, y) { rect(x + 2, y + 2, 6, 2, '#7ec850'); rect(x + 7, y + 3, 2, 4, '#7ec850'); rect(x + 3, y + 6, 5, 2, '#7ec850'); rect(x + 2, y + 8, 2, 3, '#7ec850'); rect(x + 2, y + 2, 1, 1, C.red); },
  moonic(x, y) { fillCircle(x + 6, y + 6, 5, '#e8e8c0'); fillCircle(x + 8, y + 5, 4, '#232f3a'); },
  hourglass(x, y) { rect(x + 3, y + 1, 6, 2, '#c8b060'); rect(x + 3, y + 9, 6, 2, '#c8b060'); rect(x + 4, y + 3, 4, 2, '#bfe8ff'); rect(x + 5, y + 5, 2, 2, '#e8d090'); rect(x + 4, y + 7, 4, 2, '#e8d090'); },
  trap(x, y) { rr(x + 1, y + 4, 10, 5, 2, '#9fb2b8'); rect(x + 2, y + 2, 2, 3, '#e8e8e0'); rect(x + 5, y + 2, 2, 3, '#e8e8e0'); rect(x + 8, y + 2, 2, 3, '#e8e8e0'); rect(x + 5, y + 9, 2, 2, '#748a91'); },
  glove(x, y, a) { a = a || '#e8b088'; rr(x + 2, y + 3, 8, 6, 2, a); rect(x + 1, y + 5, 2, 3, a); rect(x + 3, y + 1, 2, 3, a); rect(x + 6, y + 1, 2, 3, a); rect(x + 2, y + 9, 8, 2, '#3a5560'); },
  cookie(x, y) { fillCircle(x + 6, y + 6, 5, '#c9941a'); fillCircle(x + 6, y + 6, 4, '#e8b45a'); rect(x + 4, y + 4, 2, 2, '#5a3a1e'); rect(x + 8, y + 6, 2, 2, '#5a3a1e'); rect(x + 5, y + 8, 2, 2, '#5a3a1e'); rect(x + 4, y + 3, 3, 1, '#f8d88a'); },
  lantern(x, y) { rect(x + 4, y + 1, 4, 2, '#8a6a3a'); rr(x + 3, y + 3, 6, 7, 2, '#5a4a2a'); rect(x + 4, y + 4, 4, 5, '#ffe08988'); rect(x + 5, y + 5, 2, 3, '#fff6c8'); rect(x + 3, y + 10, 6, 1, '#8a6a3a'); },
  compass(x, y) { fillCircle(x + 6, y + 6, 5, '#c8b060'); fillCircle(x + 6, y + 6, 4, '#e8e8e0'); rect(x + 5, y + 3, 2, 4, C.red); rect(x + 5, y + 6, 2, 3, '#3a5a8a'); },
  canteen(x, y) { rect(x + 5, y + 1, 2, 2, '#8a949c'); rr(x + 2, y + 3, 8, 8, 3, '#3a6a4a'); rr(x + 3, y + 4, 6, 6, 2, '#4a8a5c'); rect(x + 4, y + 5, 2, 2, '#8fd0a0'); },
  skeeter(x, y) { rect(x + 5, y + 4, 3, 4, '#4a4a52'); rect(x + 8, y + 5, 2, 1, '#4a4a52'); rect(x + 2, y + 2, 4, 3, '#9fb8d888'); rect(x + 6, y + 1, 4, 3, '#9fb8d888'); rect(x + 8, y + 8, 2, 2, C.red); rect(x + 4, y + 8, 1, 3, '#4a4a52'); rect(x + 6, y + 8, 1, 3, '#4a4a52'); },
  firecracker(x, y) { rect(x + 4, y + 4, 4, 7, C.red); rect(x + 4, y + 6, 4, 1, '#fff'); rect(x + 4, y + 9, 4, 1, '#fff'); rect(x + 5, y + 2, 1, 2, '#c8b060'); rect(x + 6, y + 1, 1, 1, C.gold); rect(x + 8, y + 1, 1, 1, C.orange); rect(x + 4, y + 0, 1, 1, C.gold); },
  totem(x, y) { rect(x + 3, y + 1, 6, 10, '#6a4a2a'); rect(x + 4, y + 2, 4, 2, '#8a6238'); rect(x + 4, y + 5, 1, 1, '#ffe089'); rect(x + 7, y + 5, 1, 1, '#ffe089'); rect(x + 4, y + 7, 4, 1, '#3a2a18'); rect(x + 2, y + 9, 8, 2, '#8a6238'); },
  hound(x, y) { rect(x + 3, y + 2, 6, 5, '#c8a878'); rect(x + 2, y + 1, 2, 3, '#c8a878'); rect(x + 8, y + 1, 2, 3, '#c8a878'); rect(x + 4, y + 4, 1, 1, C.ink); rect(x + 7, y + 4, 1, 1, C.ink); rect(x + 5, y + 7, 2, 3, '#f4f0dc'); },
  moonshine(x, y) { rect(x + 4, y + 1, 4, 2, '#8a6a3a'); rr(x + 2, y + 3, 8, 8, 2, '#d8ccb8'); rect(x + 3, y + 6, 6, 4, '#c0b4a0'); drawText('X', x + 4, y + 5, '#6a4a2a', 1); },
  // ---- build-badge sprites (the crazy-numbers collection) ----
  amberic(x, y) { fillCircle(x + 6, y + 6, 5, '#a87a28'); fillCircle(x + 6, y + 6, 4, '#e8b45a'); rect(x + 4, y + 4, 2, 2, '#f8d88a'); rect(x + 6, y + 6, 2, 1, '#5a3a10'); rect(x + 7, y + 7, 1, 1, '#5a3a10'); rect(x + 5, y + 7, 1, 1, '#5a3a10'); },
  trex(x, y) { rect(x + 1, y + 2, 9, 5, '#3c7c2e'); rect(x + 2, y + 1, 7, 2, '#5aa843'); rect(x + 1, y + 7, 8, 3, '#2f6626'); rect(x + 2, y + 7, 1, 2, '#f4f0dc'); rect(x + 4, y + 7, 1, 2, '#f4f0dc'); rect(x + 6, y + 7, 1, 2, '#f4f0dc'); rect(x + 3, y + 3, 2, 2, '#ffe089'); rect(x + 4, y + 3, 1, 1, '#1b1408'); rect(x + 9, y + 4, 2, 2, '#3c7c2e'); },
  ruler(x, y) { rr(x + 1, y + 4, 10, 5, 1, '#e8c86a'); rect(x + 1, y + 4, 10, 1, '#f8e6a0'); for (let k = 0; k < 5; k++) rect(x + 2 + k * 2, y + 6, 1, 2, '#8a6510'); },
  domino(x, y) { rr(x + 2, y + 1, 8, 10, 2, '#f4f0e0'); rect(x + 3, y + 6, 6, 1, '#8a8a7a'); rect(x + 4, y + 3, 2, 2, '#1a1a22'); rect(x + 6, y + 8, 2, 2, '#1a1a22'); rect(x + 2, y + 1, 8, 1, '#fffdf6'); },
  wave(x, y) { for (let k = 0; k < 3; k++) { rect(x + 1 + k * 4, y + 5, 3, 1, '#5cc8ff'); rect(x + 2 + k * 4, y + 4, 2, 1, '#9fe8ff'); rect(x + k * 4, y + 8, 3, 1, '#2277cc'); } },
  sunic(x, y) { fillCircle(x + 6, y + 6, 3, '#ffe089'); fillCircle(x + 6, y + 6, 2, '#fff6c8'); for (let k = 0; k < 8; k++) { const a = k / 8 * 6.283; rect((x + 6 + Math.cos(a) * 5) | 0, (y + 6 + Math.sin(a) * 5) | 0, 1, 1, '#ffd54a'); } },
  medal(x, y) { fillCircle(x + 6, y + 5, 4, '#c9941a'); fillCircle(x + 6, y + 5, 3, '#ffd54a'); rect(x + 5, y + 4, 2, 3, '#fff6c8'); rect(x + 4, y + 9, 2, 3, '#c23a4a'); rect(x + 6, y + 9, 2, 3, '#2277cc'); },
  metro(x, y) { rect(x + 4, y + 2, 4, 9, '#8a5a2a'); rect(x + 3, y + 9, 6, 2, '#5a3a1a'); rect(x + 5, y + 3, 2, 6, '#e8dcc8'); rect(x + 6, y + 3, 3, 1, '#c8d2d8'); rect(x + 8, y + 2, 1, 2, '#c8d2d8'); },
  ferris(x, y) { for (let k = 0; k < 8; k++) { const a = k / 8 * 6.283 + 0.4; rect((x + 6 + Math.cos(a) * 4) | 0, (y + 5 + Math.sin(a) * 4) | 0, 2, 2, k % 2 ? '#ff8ab0' : '#7fd4e8'); } rect(x + 5, y + 4, 2, 2, '#e8e8e0'); rect(x + 4, y + 9, 4, 2, '#8a949c'); },
  boomerang(x, y) { rect(x + 2, y + 2, 3, 7, '#e8842a'); rect(x + 2, y + 8, 8, 3, '#e8842a'); rect(x + 3, y + 3, 1, 5, '#ffb066'); rect(x + 4, y + 9, 5, 1, '#ffb066'); },
  flute(x, y) { rect(x + 2, y + 6, 8, 2, '#8a5a2a'); rect(x + 9, y + 4, 3, 4, '#a87838'); rect(x + 4, y + 6, 1, 1, '#3a2410'); rect(x + 6, y + 6, 1, 1, '#3a2410'); rect(x + 3, y + 2, 1, 2, '#9fe8ff'); rect(x + 6, y + 1, 1, 2, '#9fe8ff'); },
  chisel(x, y) { rect(x + 2, y + 7, 4, 4, '#8a5a2a'); rect(x + 5, y + 4, 4, 4, '#c8d2d8'); rect(x + 8, y + 2, 3, 3, '#e8f2f8'); rect(x + 9, y + 2, 1, 1, '#ffffff'); },
  film(x, y) { fillCircle(x + 6, y + 6, 5, '#22262c'); fillCircle(x + 6, y + 6, 4, '#3a444c'); fillCircle(x + 6, y + 6, 1, '#14181c'); [[6, 3], [9, 6], [6, 9], [3, 6]].forEach(([fx, fy]) => rect(x + fx - 1, y + fy - 1, 2, 2, '#14181c')); },
  scope(x, y) { rect(x + 1, y + 7, 5, 3, '#8a6a3a'); rect(x + 5, y + 5, 4, 3, '#a8845a'); rect(x + 8, y + 3, 3, 3, '#c8a878'); rect(x + 10, y + 3, 1, 3, '#9fe8ff'); rect(x + 3, y + 10, 2, 2, '#5a3a1a'); },
  book(x, y) { rr(x + 2, y + 2, 8, 9, 1, '#8a4a2a'); rect(x + 3, y + 3, 6, 7, '#a8623a'); rect(x + 9, y + 2, 1, 9, '#e8dcc8'); rect(x + 4, y + 4, 4, 3, '#f4f0dc'); rect(x + 4, y + 8, 4, 1, '#e8c86a'); },
  stampic(x, y) { rect(x + 2, y + 2, 8, 8, '#e8e0c8'); for (let k = 0; k < 4; k++) { rect(x + 2 + k * 2, y + 1, 1, 1, '#e8e0c8'); rect(x + 2 + k * 2, y + 10, 1, 1, '#e8e0c8'); } rect(x + 4, y + 4, 4, 4, '#c9556a'); rect(x + 5, y + 5, 2, 2, '#f0a0b0'); },
  trophyic(x, y) { rect(x + 3, y + 2, 6, 4, '#ffd54a'); rect(x + 1, y + 2, 2, 3, '#c9941a'); rect(x + 9, y + 2, 2, 3, '#c9941a'); rect(x + 5, y + 6, 2, 2, '#c9941a'); rect(x + 3, y + 8, 6, 2, '#8a6510'); rect(x + 4, y + 2, 2, 2, '#fff6c8'); },
  anchoric(x, y) { rect(x + 5, y + 1, 2, 8, '#8a949c'); fillCircle(x + 6, y + 2, 2, '#aab4bc'); rect(x + 2, y + 4, 8, 1, '#8a949c'); rect(x + 2, y + 8, 2, 2, '#aab4bc'); rect(x + 8, y + 8, 2, 2, '#aab4bc'); rect(x + 3, y + 10, 6, 1, '#8a949c'); },
  lightic(x, y) { rect(x + 4, y + 3, 4, 8, '#e8e0c8'); rect(x + 4, y + 5, 4, 2, '#c23a4a'); rect(x + 4, y + 9, 4, 2, '#c23a4a'); rect(x + 3, y + 1, 6, 3, '#ffe089'); rect(x + 1, y + 1, 2, 1, '#fff6c8'); rect(x + 9, y + 1, 2, 1, '#fff6c8'); },
  crabq(x, y) { rect(x + 3, y + 5, 6, 4, '#ff7a4a'); rect(x + 4, y + 4, 4, 2, '#e8542a'); rect(x + 1, y + 3, 2, 3, '#ff7a4a'); rect(x + 9, y + 3, 2, 3, '#ff7a4a'); rect(x + 4, y + 3, 1, 2, '#101010'); rect(x + 7, y + 3, 1, 2, '#101010'); rect(x + 3, y + 9, 2, 2, '#e8542a'); rect(x + 7, y + 9, 2, 2, '#e8542a'); },
  crane(x, y) { rect(x + 3, y + 5, 6, 4, '#f4f0e8'); rect(x + 2, y + 3, 3, 3, '#ffffff'); rect(x + 1, y + 3, 1, 1, '#e8842a'); rect(x + 8, y + 3, 3, 3, '#e8e0d0'); rect(x + 5, y + 9, 2, 2, '#d8d0c0'); },
  clockic(x, y) { fillCircle(x + 6, y + 6, 5, '#c8b060'); fillCircle(x + 6, y + 6, 4, '#f4f0dc'); rect(x + 6, y + 3, 1, 3, '#3a2a18'); rect(x + 6, y + 6, 3, 1, '#3a2a18'); rect(x + 6, y + 6, 1, 1, '#c23a4a'); },
  ropeic(x, y) { rect(x + 1, y + 8, 10, 1, '#c8a878'); rect(x + 5, y + 3, 2, 2, '#e8b088'); rect(x + 5, y + 5, 2, 3, '#3a5566'); rect(x + 2, y + 5, 8, 1, '#8a6a3a'); },
  // ---- dentist tool sprites ----
  tdrill(x, y) { rect(x + 1, y + 2, 5, 5, '#c8d2d8'); rect(x + 2, y + 3, 3, 3, '#8a98a0'); rect(x + 6, y + 3, 4, 3, '#5a646c'); rect(x + 10, y + 4, 2, 1, '#f4f0dc'); rect(x + 2, y + 7, 3, 4, '#d94f30'); rect(x + 5, y + 1, 1, 2, '#ffe089'); },
  tgold(x, y) { ICONS.tooth(x, y, '#f4f2e4'); rect(x + 4, y + 4, 4, 4, C.gold); rect(x + 5, y + 5, 1, 1, '#fff6c8'); },
  truby(x, y) { ICONS.tooth(x, y, '#f4f2e4'); rect(x + 4, y + 4, 4, 4, '#ff4d6a'); rect(x + 5, y + 5, 1, 1, '#ffb0c0'); },
  tpliers(x, y) { rect(x + 2, y + 1, 2, 5, '#c8d2d8'); rect(x + 8, y + 1, 2, 5, '#c8d2d8'); rect(x + 3, y + 5, 6, 2, '#8a98a0'); rect(x + 2, y + 7, 3, 4, '#3a6a4a'); rect(x + 7, y + 7, 3, 4, '#3a6a4a'); rect(x + 4, y + 0, 4, 2, '#f4f0dc'); },
  twire(x, y) { for (let k = 0; k < 4; k++) { rect(x + 1 + k * 3, y + 4 + (k % 2) * 2, 3, 1, '#c8d2d8'); } rect(x + 1, y + 2, 2, 6, '#8a98a0'); rect(x + 9, y + 2, 2, 6, '#8a98a0'); rect(x + 3, y + 8, 6, 3, '#f4f0dc'); },
  tvial(x, y) { rect(x + 4, y + 1, 4, 2, '#8a98a0'); rect(x + 4, y + 3, 4, 3, '#cfe8f0'); rr(x + 3, y + 5, 6, 6, 2, '#7a3aa8'); rect(x + 4, y + 7, 2, 2, '#b070e8'); rect(x + 8, y + 2, 2, 1, '#b070e8'); },
  tveneer(x, y) { rr(x + 1, y + 2, 10, 8, 2, '#e8e4d8'); rect(x + 2, y + 3, 8, 3, '#fef9e6'); rect(x + 3, y + 7, 6, 2, '#c8c2b2'); rect(x + 9, y + 1, 2, 2, '#ffe089'); },
  tbath(x, y) { rr(x + 1, y + 5, 10, 6, 2, '#4fb3d9'); rect(x + 2, y + 4, 8, 2, '#9fe8ff'); ICONS.tooth(x, y - 3, '#f4f2e4'); rect(x + 3, y + 6, 1, 1, '#e8f8ff'); rect(x + 8, y + 7, 1, 1, '#e8f8ff'); },
  troot(x, y) { rect(x + 5, y + 1, 2, 7, '#c8d2d8'); rect(x + 4, y + 0, 4, 2, '#3a6a4a'); rect(x + 3, y + 8, 2, 3, '#f4f0dc'); rect(x + 7, y + 8, 2, 3, '#f4f0dc'); rect(x + 9, y + 3, 2, 2, C.gold); },
  tdiamond(x, y) { ICONS.gem(x, y, '#eafcff'); rect(x + 5, y + 4, 2, 2, '#fff'); rect(x + 3, y + 10, 6, 1, '#9fe8ff'); },
  // ---- mini-game emblem sprites (shown on the event intro card) ----
  mg_fish(x, y) { rr(x + 1, y + 4, 9, 6, 2, '#2f5561'); rr(x + 1, y + 4, 8, 5, 2, '#5c8a9a'); rect(x + 2, y + 4, 6, 1, '#7fb8c8'); rect(x + 2, y + 8, 6, 1, '#3e6673'); rect(x + 8, y + 2, 4, 8, '#2f5561'); rect(x + 8, y + 3, 3, 6, '#48707e'); rect(x, y + 5, 2, 4, '#48707e'); rect(x + 3, y + 5, 2, 2, '#10181e'); rect(x + 3, y + 5, 1, 1, '#cfe8f0'); rect(x + 5, y + 6, 1, 1, '#a8d0dc'); },
  mg_gator(x, y) { rr(x, y + 5, 11, 5, 2, '#153d12'); rr(x + 1, y + 5, 10, 4, 2, '#3c7c2e'); rect(x + 2, y + 5, 8, 1, '#5aa843'); rr(x + 6, y + 1, 5, 5, 2, '#153d12'); rr(x + 6, y + 2, 5, 4, 2, '#5aa843'); rect(x + 7, y + 2, 3, 1, '#8cd34f'); rect(x + 8, y + 3, 1, 1, '#ffe089'); for (let k = 0; k < 4; k++) rect(x + 2 + k * 2, y + 9, 1, 2, '#f4f0dc'); rect(x + 3, y + 6, 1, 1, '#2f6626'); rect(x + 6, y + 7, 1, 1, '#2f6626'); },
  mg_pot(x, y) { rr(x, y + 4, 12, 7, 2, '#22262c'); rr(x + 1, y + 4, 10, 6, 2, '#3a444c'); rect(x + 2, y + 5, 8, 1, '#5a646c'); rect(x + 2, y + 9, 8, 1, '#2a343c'); rect(x, y + 5, 1, 3, '#5a646c'); rect(x + 11, y + 5, 1, 3, '#5a646c'); rect(x + 2, y + 3, 8, 2, '#2c7d3a'); rect(x + 2, y + 3, 8, 1, '#7ec850'); rect(x + 4, y + 2, 1, 1, '#8ac85a'); rect(x + 7, y + 2, 1, 1, '#8ac85a'); rect(x + 2, y + 4, 3, 1, '#8a98a0'); },
  mg_mallow(x, y) { rect(x + 5, y + 5, 2, 7, '#5f4228'); rect(x + 5, y + 5, 1, 7, '#8a6a3a'); rr(x + 2, y + 1, 8, 7, 2, '#c8a86a'); rr(x + 2, y + 1, 7, 6, 2, '#f4e2c8'); rect(x + 3, y + 2, 4, 1, '#fffdf6'); rect(x + 3, y + 5, 5, 2, '#c8873a'); rect(x + 3, y + 6, 5, 1, '#8a5a20'); rect(x + 4, y + 2, 1, 1, '#ffffff'); },
  mg_duck(x, y) { rr(x + 1, y + 5, 9, 5, 2, '#a87838'); rr(x + 2, y + 5, 7, 4, 2, '#e8b45a'); rect(x + 2, y + 5, 6, 1, '#f0d868'); rr(x + 5, y + 1, 5, 5, 2, '#a87838'); rr(x + 6, y + 2, 4, 4, 2, '#f0d868'); rect(x + 6, y + 2, 2, 1, '#fff2c0'); rect(x + 9, y + 4, 3, 1, '#ff9838'); rect(x + 9, y + 5, 2, 1, '#e8842a'); rect(x + 8, y + 3, 1, 1, '#10181e'); rect(x + 3, y + 6, 4, 2, '#a87838'); },
  mg_frog(x, y) { rr(x + 1, y + 5, 10, 6, 2, '#2c5a22'); rr(x + 2, y + 5, 8, 5, 2, '#5aa843'); rect(x + 3, y + 5, 6, 1, '#7ec850'); rr(x + 1, y + 2, 3, 3, 1, '#5aa843'); rr(x + 8, y + 2, 3, 3, 1, '#5aa843'); rect(x + 2, y + 3, 2, 2, '#f4f0dc'); rect(x + 8, y + 3, 2, 2, '#f4f0dc'); rect(x + 2, y + 3, 1, 1, '#10181e'); rect(x + 9, y + 3, 1, 1, '#10181e'); rect(x + 3, y + 8, 5, 2, '#e8e0b0'); rect(x + 3, y + 10, 1, 1, '#3c7c2e'); rect(x + 8, y + 10, 1, 1, '#3c7c2e'); rect(x + 4, y + 6, 1, 1, '#a8e878'); },
  mg_cam(x, y) { rr(x, y + 3, 12, 8, 2, '#22262c'); rr(x + 1, y + 3, 10, 7, 2, '#3a444c'); rect(x + 2, y + 3, 8, 1, '#5a646c'); rect(x + 3, y + 1, 4, 2, '#2a343c'); rect(x + 3, y + 1, 4, 1, '#5a646c'); fillCircle(x + 6, y + 7, 3, '#1a2228'); fillCircle(x + 6, y + 7, 2, '#4fb3d9'); rect(x + 5, y + 6, 1, 1, '#cfe8f0'); rect(x + 9, y + 4, 2, 1, '#ff5348'); rect(x + 2, y + 4, 1, 1, '#8a98a0'); },
  mg_boat(x, y) { rr(x, y + 6, 11, 4, 1, '#3c464e'); rr(x + 1, y + 6, 9, 3, 1, '#aab4bc'); rect(x + 1, y + 8, 9, 1, '#8a949c'); rect(x + 2, y + 7, 7, 1, '#2c7d3a'); fillCircle(x + 3, y + 3, 3, '#26323a'); fillCircle(x + 3, y + 3, 2, '#0c141a'); rect(x + 2, y + 3, 3, 1, '#c8ccd0'); rect(x + 7, y + 2, 1, 5, '#c8d2d8'); rect(x + 8, y + 1, 2, 2, '#c23a4a'); },
  mg_burger(x, y) { rr(x, y + 2, 12, 4, 2, '#8a5a20'); rr(x + 1, y + 2, 10, 3, 2, '#e0a848'); rect(x + 2, y + 2, 8, 1, '#f4c46a'); rect(x + 3, y + 3, 1, 1, '#fff2c8'); rect(x + 6, y + 3, 1, 1, '#fff2c8'); rect(x + 8, y + 4, 1, 1, '#fff2c8'); rect(x + 1, y + 5, 10, 1, '#4fae5c'); rect(x + 2, y + 5, 3, 1, '#7ec850'); rect(x + 1, y + 6, 10, 2, '#7a4526'); rect(x + 1, y + 6, 10, 1, '#a85838'); rr(x + 1, y + 8, 10, 3, 1, '#8a5a20'); rr(x + 1, y + 8, 10, 2, 1, '#e0a848'); },
  mg_manatee(x, y) { rr(x, y + 3, 11, 8, 3, '#4a555b'); rr(x + 1, y + 3, 9, 7, 3, '#8a969c'); rect(x + 2, y + 4, 7, 1, '#b8c4ca'); rr(x + 8, y + 5, 3, 4, 2, '#7a868c'); rect(x + 2, y + 8, 7, 1, '#7a868c'); rect(x + 3, y + 5, 1, 1, C.ink); rect(x + 6, y + 5, 1, 1, C.ink); rect(x + 2, y + 7, 1, 1, '#5a646c'); rect(x + 4, y + 6, 1, 1, '#5a646c'); rect(x + 2, y + 8, 2, 1, '#7ec850'); rect(x + 6, y + 4, 2, 1, '#7ec850'); rect(x + 6, y + 3, 1, 1, '#a8e878'); },
};

// -------- animal ranger portraits, gator-style tracking eyes --------------
// a big expressive eye that follows the cursor (like the gator's); always open
function critterEye(ex, ey, ew, eh, lidCol, sclera, pupilCol, phase) {
  const cx2 = ex + ew / 2, cy2 = ey + eh / 2;
  const r = Math.max(2, Math.round(Math.min(ew, eh) / 2));
  const dx = Math.round(clamp((mx - cx2) / 70, -1, 1) * 1.2);
  const dy = Math.round(clamp((my - cy2) / 70, -1, 1) * 1);
  fillCircle(cx2 + dx, cy2 + dy, r, pupilCol || '#120b05');
  rect(cx2 + dx - r + 1, cy2 + dy - r + 1, 2, 2, '#ffffff');
  rect(cx2 + dx + r - 2, cy2 + dy + r - 2, 1, 1, '#ffffff55');
}

// ==========================================================================
//  BOBBLE RANGERS  -  hand-shaded chibi pixel actors
// --------------------------------------------------------------------------
//  Each ranger is built from five-tone ramps (outline / shade / mid / light /
//  highlight) raked by an upper-left key light, with dithered tone breaks and
//  a cool rim light down the shaded edge.  The rig runs on springs: the head
//  lags the torso, the scarf trails the head, knees bend on landing and the
//  chest breathes, so even the idle pose is never still.
//  Drawn in a ~46x58 box whose FEET rest on `gy`.  Expressions:
//  happy | calm | wow | worry | mad | sleepy | smug | sad | love | grit
// ==========================================================================
const BOB = {
  scout: { // river otter: warm brown pelt, cream bib, round little ears
    sk: ['#231208', '#6a4222', '#8c5c33', '#ac7a49', '#cfa370'],
    cl: ['#0d1811', '#1c3122', '#2d4a34', '#3f6748', '#5b8a62'],
    ac: '#63d66a', acD: '#2c7a3c', iris: '#6b3d18',
    muz: ['#b99a72', '#e2cba6', '#f8ecd6'],
    ear: ['#3d2210', '#7a4c28', '#a87a52'],
    nose: ['#2a1508', '#54301a', '#8a5a38'],
    otter: 1, whisk: 1, tail: ['#2e1809', '#8a5730', '#b07a4c'],
  },
  medic: { // opossum: ash fur, rose ears, white muzzle
    sk: ['#17131a', '#767683', '#9d9dab', '#c2c2d2', '#e9e9f4'],
    cl: ['#0b1a1e', '#163037', '#234c56', '#2f6b78', '#4691a0'],
    ac: '#7fd4e8', acD: '#2c7c92', iris: '#9a5364',
    ear: ['#8a5666', '#c87a90', '#f0a8bc'],
    muz: ['#c5c5d2', '#e4e4ee', '#fbfbff'],
    nose: ['#7d4450', '#c07a8a', '#eba8b8'],
    cross: 1, whisk: 1, roundear: 1,
  },
  trader: { // raccoon: dusty pelt, bandit mask, gold tooth
    sk: ['#15120d', '#665e51', '#8a8171', '#aca392', '#cfc6b2'],
    cl: ['#160e06', '#2b1c10', '#42301b', '#5a4527', '#7b6038'],
    ac: '#ffc843', acD: '#a8760f', iris: '#c08a2a',
    mask: ['#120f0d', '#221d18', '#332c24'], paleEye: 1,
    ear: ['#3a342c', '#6a6258', '#8a8276'],
    muz: ['#b0a896', '#d4ccb8', '#efe8d4'],
    nose: ['#181410', '#3a342c', '#6a6258'],
    gold: 1, roundear: 1,
  },
  frog: { // bullfrog: swamp green, eyes riding high on the skull
    sk: ['#111f0c', '#478230', '#68a744', '#8bc95e', '#b4e688'],
    cl: ['#0e1a0c', '#203619', '#345228', '#487036', '#68984d'],
    ac: '#d94f30', acD: '#8a2a16', iris: '#f0c040',
    wide: 1, topeyes: 1,
  },
  snail: { // snail sage: cream shell-dweller, two little eye nubs
    sk: ['#1a1510', '#b6a284', '#d5c2a0', '#ecdcbe', '#fcf2e0'],
    cl: ['#181222', '#302848', '#493c68', '#665688', '#8b7bac'],
    ac: '#c8a878', acD: '#8a6a44', iris: '#6a5a8c',
    shell: ['#4f3419', '#7d5528', '#ab7c44', '#d0a668', '#efd6a2'],
    stalk: 1,
  },
};
const BOOT = ['#150e06', '#33230f', '#4d3a1e', '#6c542f', '#8f7343'];
// head silhouette: a round cranium that tapers to a small chin, y = -14 .. +9
const HEADSPAN = [7, 8, 10, 10, 11, 12, 12, 12, 13, 13, 13, 13, 13, 13, 12, 12, 12, 11, 10, 10, 8, 7, 5, 3];

// A shaded blob from a half-width table.  Tone bands are concentric ellipses
// around the key-light point, so the terminator curves like a real sphere
// instead of stepping in stripes; the band edges are 1px dithered.
// shaded blobs are cached the same way as textured boxes: painted once at a
// local origin, stamped thereafter (the shading is all relative to the shape)
const BS_CACHE = new Map();
function bobShape(spans, y0, ramp, o) {
  o = o || {};
  const n = spans.length, ox = o.ox || 0;
  let maxw = 0; for (let i = 0; i < n; i++) maxw = Math.max(maxw, spans[i]);
  const key = spans.join(',') + '|' + ramp.join('') + (o.norim ? 'r' : '') + (o.seed || 0) + '|' + (o.lx === undefined ? '' : o.lx) + '|' + (o.ly === undefined ? '' : o.ly);
  let c = BS_CACHE.get(key);
  const cw = maxw * 2 + 4, ch = n + 4;
  if (!c) {
    c = document.createElement('canvas'); c.width = cw * RS; c.height = ch * RS;
    const c2 = c.getContext('2d'); c2.imageSmoothingEnabled = false; c2.setTransform(RS, 0, 0, RS, 0, 0);
    const main = ctx; ctx = c2;
    try { bobShapeRaw(spans, 2, ramp, Object.assign({}, o, { ox: maxw + 2 })); } finally { ctx = main; }
    if (BS_CACHE.size > 3000) BS_CACHE.clear();
    BS_CACHE.set(key, c);
  }
  ctx.drawImage(c, ox - maxw - 2, y0 - 2, cw, ch);
}
function bobShapeRaw(spans, y0, ramp, o) {
  o = o || {};
  const n = spans.length, ox = o.ox || 0;
  let maxw = 0; for (let i = 0; i < n; i++) maxw = Math.max(maxw, spans[i]);
  // outline: every row widened by one, plus caps
  for (let i = 0; i < n; i++) rect(ox - spans[i] - 1, y0 + i, spans[i] * 2 + 2, 1, ramp[0]);
  rect(ox - spans[0], y0 - 1, spans[0] * 2, 1, ramp[0]);
  rect(ox - spans[n - 1], y0 + n, spans[n - 1] * 2, 1, ramp[0]);
  // key light sits up and to the left of centre
  const Lx = ox - maxw * (o.lx === undefined ? 0.42 : o.lx);
  const Ly = y0 + n * (o.ly === undefined ? 0.26 : o.ly);
  const ra = maxw * 1.22, rb = n * 0.62;
  for (let i = 0; i < n; i++) {
    const hw = spans[i], y = y0 + i;
    const dy = (y - Ly) / rb;
    const run = (d0, col, dith) => {
      const k = d0 * d0 - dy * dy; if (k <= 0) return;
      const w = ra * Math.sqrt(k);
      const a = Math.max(ox - hw, Math.round(Lx - w)), b = Math.min(ox + hw, Math.round(Lx + w));
      if (b > a) rect(a, y, b - a, 1, col);
      if (dith && (i & 1)) { if (b < ox + hw) rect(b, y, 1, 1, col); if (a > ox - hw) rect(a - 1, y, 1, 1, col); }
    };
    rect(ox - hw, y, hw * 2, 1, ramp[1]);   // shade everywhere...
    run(1.24, ramp[2], 1);                  // ...then the lit ellipses on top
    run(0.86, ramp[3], 1);
    run(0.40, ramp[4], 0);
  }
  // fixed speckle grain so the fur/skin reads as a surface, not a moulding
  for (let i = 1; i < n - 1; i++) {
    const hw = spans[i], y = y0 + i;
    for (let xx = -hw + 1; xx < hw - 1; xx++) {
      const q = hash2(xx + 40, i + (o.seed || 0) * 11);
      if (q < 0.045) rect(ox + xx, y, 1, 1, mixC(ramp[1], ramp[2], 0.4));
      else if (q > 0.97 && i < n * 0.6) rect(ox + xx, y, 1, 1, mixC(ramp[3], ramp[4], 0.5));
    }
  }
  if (!o.norim) { // cool bounce light licking the shaded edge
    ctx.save(); ctx.globalAlpha = 0.55;
    const rim = mixHex(ramp[1], '#a8cdf0', 0.62);
    for (let i = (n * 0.22) | 0; i < n - (n * 0.2 | 0); i++) rect(ox + spans[i] - 1, y0 + i, 1, 1, rim);
    ctx.globalAlpha = 0.35;
    for (let i = n - 5; i < n - 1; i++) rect(ox - spans[i], y0 + i, Math.min(4, spans[i]), 1, mixHex(ramp[1], '#ffe3b0', 0.4));
    ctx.restore();
  }
}

// ----------------------------------------------------------- the face -----
// Big low-set eyes, a small mouth and soft brows: the baby proportions that
// make a face read as cute rather than odd.
function bobFace(p, expr, phase, look, opt) {
  opt = opt || {};
  const OL = p.sk[0], EX = opt.topeyes ? 8 : 5, EY = opt.topeyes ? -15 : -1;
  const lx = clamp(look.x, -1, 1), ly = clamp(look.y, -1, 1);
  const shake = (expr === 'scared' || expr === 'panic') ? Math.round(Math.sin(tNow * 22 + phase) * 1) : 0;

  // one small moulded bead, one pixel of shine.  That is the whole eye.
  const bead = (ox, r) => {
    const bx = ox + shake + Math.round(lx * 0.8), by2 = EY + Math.round(ly * 0.6);
    const ew = r * 2 - 1, eh = r * 2;
    rr(bx - r + 1, by2 - r, ew, eh, 1, '#141010');
    rect(bx - r + 1, by2 - r + 1, 1, 1, '#ffffff');
    if (r > 2) rect(bx + r - 3, by2 + r - 2, 1, 1, '#ffffff66');
  };
  const brow = (ox, dy, ang) => { for (let k = 0; k < 5; k++) rect(ox - 2 + k + shake, EY - 6 + dy + Math.round((k - 2) * ang), 1, 1, OL); };

  // eyes never close: every mood is carried by the brows and the mouth
  if (expr === 'happy' || expr === 'love') { [-EX, EX].forEach(ox => { bead(ox, 2); brow(ox, -2, 0); }); }
  else if (expr === 'sleepy') { [-EX, EX].forEach((ox, i) => { bead(ox, 2); brow(ox, 2, i ? 0.25 : -0.25); }); }
  else if (expr === 'smug') { [-EX, EX].forEach((ox, i) => { bead(ox, 2); brow(ox, i ? -2 : 1, 0); }); }
  else if (expr === 'mad' || expr === 'grit') { [-EX, EX].forEach((ox, i) => { bead(ox, 2); brow(ox, 3, i ? -0.6 : 0.6); }); }
  else if (expr === 'wow' || expr === 'shocked' || expr === 'scared' || expr === 'panic') { [-EX, EX].forEach(ox => bead(ox, 3)); }
  else if (expr === 'worry' || expr === 'sad') { [-EX, EX].forEach((ox, i) => { bead(ox, 2); brow(ox, -1, i ? 0.5 : -0.5); }); }
  else { [-EX, EX].forEach(ox => bead(ox, 2)); }

  // one sweat bead is all the panic anyone needs
  if (expr === 'scared' || expr === 'panic' || expr === 'worry') {
    const sw = (tNow * 1.4 + phase) % 2.8;
    if (sw < 1) { ctx.save(); ctx.globalAlpha = 1 - sw * 0.6; rr(EX + 5, EY - 5 + sw * 9, 2, 3, 1, '#8fd8f0'); ctx.restore(); }
  }
  if (expr === 'sleepy') {
    const zz = (tNow * 0.6 + phase) % 3.4;
    if (zz < 2.2) { ctx.save(); ctx.globalAlpha = 0.85 - zz * 0.34; drawText('z', EX + 6 + zz * 2, EY - 8 - zz * 5, '#cfe8f0', 1); ctx.restore(); }
  }
  if (expr === 'love') { [-EX, EX].forEach(ox => { rect(ox - 2, EY - 2, 2, 2, '#e2486a'); rect(ox + 1, EY - 2, 2, 2, '#e2486a'); rect(ox - 2, EY, 5, 1, '#e2486a'); rect(ox - 1, EY + 1, 3, 1, '#e2486a'); }); }

  // ---- mouths: one or two strokes ----
  const MY = opt.topeyes ? 3 : 5, MX = shake;
  if (opt.wide) {
    rect(-7 + MX, MY, 14, 1, OL);
    if (expr === 'happy' || expr === 'wow') rr(-5 + MX, MY + 1, 10, 3, 1, '#6d2434');
  }
  else if (expr === 'wow' || expr === 'shocked' || expr === 'scared') { rr(-2 + MX, MY, 5, 5, 2, '#5d2430'); }
  else if (expr === 'panic') { rr(-3 + MX, MY - 1, 7, 7, 3, '#5d2430'); }
  else if (expr === 'mad' || expr === 'grit') { rect(-3 + MX, MY + 1, 7, 1, OL); rect(-4 + MX, MY, 1, 1, OL); rect(4 + MX, MY, 1, 1, OL); }
  else if (expr === 'worry' || expr === 'sad') { rect(-2, MY + 1, 5, 1, OL); }
  else if (expr === 'sleepy') { rr(-1, MY, 3, 2, 1, '#5d2430'); }
  else if (expr === 'smug') { rect(-3, MY, 5, 1, OL); rect(2, MY - 1, 2, 1, OL); }
  else if (expr === 'talk') { const o3 = Math.abs(Math.sin(tNow * 11 + phase)); rr(-2, MY, 5, 1 + Math.round(o3 * 3), 2, '#5d2430'); }
  else { rect(-2, MY, 5, 1, OL); rect(-3, MY - 1, 1, 1, OL); rect(3, MY - 1, 1, 1, OL); }
  if (p.gold && expr !== 'sleepy') rect(3, MY, 1, 1, '#ffd54a');
  // a flat dab of blush, no gradient
  if (expr !== 'mad' && expr !== 'grit' && expr !== 'sad') {
    ctx.save(); ctx.globalAlpha = 0.3;
    [-1, 1].forEach(s2 => rect(s2 * (EX + 3) - 1, MY - 2, 3, 2, '#ef7f94'));
    ctx.restore();
  }
}

// the head alone, drawn about its own centre (used for portraits + the body)
function bobHead(key, expr, phase, look, lean, ho) {
  ho = ho || {};
  const p = BOB[key] || BOB.scout, OL = p.sk[0];
  lean = lean || 0;
  const earR = k => [p.sk[0], k[0], k[1], k[2], mixHex(k[2], '#ffffff', 0.45)];
  // ---- ears / stalks BEHIND the skull, all moulded blocks ----
  if (p.otter && !ho.noEars) {
    [-1, 1].forEach(s2 => {
      const tw = Math.round(Math.sin(tNow * 1.6 + s2 * 2 + phase) * 0.7);
      plasticBox(s2 * 11 - 5, -17 + tw, 10, 9, 3, earR(p.ear));
      rect(s2 * 11 - 2, -14 + tw, 4, 3, p.ear[0]);
    });
  }
  if (key === 'medic' && !ho.noEars) {
    [-1, 1].forEach(s2 => {
      const tw = Math.round(Math.sin(tNow * 1.5 + s2 * 2 + phase) * 0.8);
      plasticBox(s2 * 11 - 6, -18 + tw, 12, 11, 4, [OL, p.sk[1], p.sk[2], p.sk[3], p.sk[4]]);
      plasticBox(s2 * 11 - 3, -15 + tw, 6, 6, 2, [OL, p.ear[0], p.ear[1], p.ear[2], '#ffd8e2'], { noShine: 1 });
    });
  }
  if (key === 'trader' && !ho.noEars) {
    [-1, 1].forEach(s2 => {
      const tw = Math.round(Math.sin(tNow * 1.3 + s2 + phase) * 0.7);
      plasticBox(s2 * 11 - 5, -19 + tw, 11, 10, 3, earR(p.ear));
      rect(s2 * 11 - 2, -16 + tw, 5, 4, p.ear[0]);
    });
  }
  if (key === 'snail') {
    [-1, 1].forEach(s2 => {
      const sw = Math.round(Math.sin(tNow * 1.1 + s2 * 1.4 + phase) * 1);
      rect(s2 * 6 - 1, -22, 3, 10, OL);
      rect(s2 * 6, -22, 1, 10, p.sk[2]);
      plasticBox(s2 * 8 + sw - 4, -26, 8, 8, 3, [OL, p.sk[1], p.sk[2], p.sk[4], '#ffffff']);
      rect(s2 * 8 + sw - 1 + Math.round(clamp(look.x, -1, 1)), -24, 2, 2, OL);
    });
  }
  // ---- the skull: a soft block with hand-placed fur and skin detail ----
  plasticBox(-13, -14, 26, 24, 6, p.sk, { seed: key.length });
  if (p.otter || key === 'medic' || key === 'trader') {
    // fur tufts break the silhouette at the cheeks and crown
    const tuft = (x0, y0, dir) => {
      rect(x0 + dir * 1, y0, 2 * dir < 0 ? 2 : 2, 1, OL);
      rect(dir < 0 ? x0 - 2 : x0 + 1, y0 + 1, 2, 1, OL);
      rect(dir < 0 ? x0 - 1 : x0, y0 + 1, 1, 1, p.sk[2]);
      rect(dir < 0 ? x0 - 1 : x0, y0 + 2, 2, 1, OL);
      rect(x0, y0 + 2, 1, 1, p.sk[1]);
    };
    tuft(-13, 1, -1); tuft(-13, 4, -1); tuft(12, 1, 1); tuft(12, 4, 1);
    rect(-3, -16, 2, 1, OL); rect(-4, -15, 1, 1, OL); rect(-3, -15, 2, 1, p.sk[3]);
    rect(1, -16, 2, 1, OL); rect(3, -15, 1, 1, OL); rect(1, -15, 2, 1, p.sk[3]);
    // fur strokes: short dark hatches following the head's curve
    for (let k = 0; k < 9; k++) {
      const hx = -9 + ((k * 7) % 18), hy = -11 + ((k * 5) % 9);
      rect(hx, hy, 1, 2, mixC(p.sk[1], p.sk[2], 0.35));
    }
  }
  if (key === 'frog') {
    // the eye domes ride on top of the skull, in front of it
    [-1, 1].forEach(s2 => plasticBox(s2 * 8 - 6, -21, 12, 11, 5, [OL, p.sk[1], p.sk[2], p.sk[3], p.sk[4]], { seed: 3 + s2 }));
    // warty skin: darker blotches with a lit rim
    [[-8, -9, 3], [5, -6, 2], [-3, -4, 2], [8, -11, 2], [-10, -2, 2]].forEach(([wx, wy, wr]) => {
      rr(wx, wy, wr + 1, wr, 1, p.sk[1]); rect(wx, wy - 1, wr, 1, p.sk[3]);
    });
  }
  if (key === 'snail') {
    // soft wrinkles and a slime glint
    rect(-8, -8, 5, 1, p.sk[1]); rect(3, -9, 5, 1, p.sk[1]); rect(-6, 7, 12, 1, p.sk[1]);
    rect(-10, -11, 2, 1, p.sk[4]); rect(-11, -10, 1, 2, p.sk[4]);
  }
  if (key === 'trader') {
    rect(-12, -7, 24, 8, p.mask[1]); rect(-12, -7, 24, 1, p.mask[2]); rect(-12, 1, 24, 1, p.mask[0]);
  }
  if (p.otter) plasticBox(-9, 0, 18, 10, 4, [OL, p.muz[0], p.muz[1], p.muz[2], '#ffffff'], { noShine: 1 });
  else if (p.muz) plasticBox(-7, 1, 14, 9, 4, [OL, p.muz[0], p.muz[1], p.muz[2], '#ffffff'], { noShine: 1 });
  if (key === 'frog') rect(-11, 3, 22, 5, p.sk[4]);
  bobFace(p, expr, phase, look, { wide: !!p.wide, topeyes: !!p.topeyes, gold: !!p.gold });
  // ---- moulded button nose ----
  if (p.nose) {
    const ny = p.otter ? 3 : 4;
    plasticBox(-3, ny, 7, 5, 2, [p.nose[0], p.nose[0], p.nose[1], p.nose[2], '#ffffff'], { noShine: 1 });
    rect(-2, ny + 1, 3, 1, p.nose[2]);
  }
  if (key === 'frog') { rect(-5, -2, 2, 1, p.sk[1]); rect(3, -2, 2, 1, p.sk[1]); }
  if (p.whisk) {
    ctx.save(); ctx.globalAlpha = 0.45;
    const wc = p.otter ? '#f0e2c8' : '#e4e4ee';
    rect(-14, 5, 5, 1, wc); rect(9, 5, 5, 1, wc);
    ctx.restore();
  }
  // ---- neckerchief: a flat moulded band ----
  const trail = Math.round(clamp(-lean * 12, -2, 2));
  plasticBox(-9, 9, 18, 6, 2, [OL, p.acD, p.ac, mixHex(p.ac, '#ffffff', 0.34), '#ffffff'], { noShine: 1 });
  rect(-8, 10, 16, 1, mixHex(p.ac, '#ffffff', 0.5));
  plasticBox(-3 + trail, 13, 6, 5, 2, [OL, p.acD, p.ac, mixHex(p.ac, '#ffffff', 0.3), '#ffffff'], { noShine: 1 });
  if (p.cross) { rect(-2, 10, 4, 2, C.red); rect(-1, 9, 2, 4, C.red); }
}


// ----------------------------------------------------------- full body ----
// o = { sc, expr, act, flip, t, phase, hat, gear, glove }
// acts: idle | walk | row | cheer | point | wave | think
// The motion is deliberately gentle - a slow breath, a soft weight shift and
// the faintest head lag.  Only `cheer` really leaves the ground.
function drawBobble(cx, gy, key, o) {
  o = o || {};
  const p = BOB[key] || BOB.scout, OL = p.sk[0];
  const sc = o.sc || 1, act = o.act || 'idle', expr = o.expr || 'calm';
  const t = (o.t !== undefined ? o.t : tNow) + (o.phase || 0);

  // ---------------- rig -------------------------------------------------
  let hop = 0, sq = 1, lean = 0, stride = 0, dust = 0;
  const breathe = Math.sin(t * 1.3);
  if (act === 'cheer') {
    const k = (t * 0.8) % 1;
    if (k < 0.18) { hop = -1 * (k / 0.18); sq = 1 - 0.09 * (k / 0.18); }
    else if (k < 0.74) { const a = (k - 0.18) / 0.56; hop = Math.sin(a * Math.PI) * 7; sq = 1 + 0.06 * Math.sin(a * Math.PI); }
    else { const a = (k - 0.74) / 0.26; hop = -1 * Math.sin(a * Math.PI); sq = 1 - 0.09 * Math.sin(a * Math.PI); dust = a < 0.2 ? 1 : 0; }
  } else if (act === 'walk') {
    const c = t * 5.4;
    stride = Math.sin(c) * 3;
    hop = Math.abs(Math.sin(c)) * 1.1 + breathe * 0.2;
    sq = 1 - Math.abs(Math.cos(c)) * 0.025;
    lean = 0.03;
  } else if (act === 'row') {
    const s = Math.sin(t * 2.2);
    hop = s * 0.7; lean = s * 0.07; sq = 1 + s * 0.02;
  } else {
    hop = breathe * 0.7;                       // just breathing
    sq = 1 + Math.sin(t * 1.3 + 0.7) * 0.02;
    lean = Math.sin(t * 0.55) * 0.025;         // slow weight shift
  }
  const tilt = lean * 0.7 + Math.sin(t * 1.1 - 0.5) * 0.018;
  const look = { x: clamp((mx - cx) / 80, -1, 1), y: clamp((my - (gy - 38 * sc)) / 80, -1, 1) };

  ctx.save();
  ctx.translate(cx | 0, gy | 0);
  ctx.scale(o.flip ? -sc : sc, sc);

  // ---------------- contact shadow --------------------------------------
  ctx.save(); ctx.globalAlpha = 0.32 - hop * 0.014;
  ctx.translate(0, -1); ctx.scale(1, 0.3); fillCircle(0, 0, 12 - hop * 0.4, '#000');
  ctx.restore();
  if (dust) { for (let d = 0; d < 5; d++) { const a = -0.3 + d * 0.22; ctx.save(); ctx.globalAlpha = 0.3; fillCircle(Math.cos(a) * 13, -2 - Math.abs(Math.sin(a)) * 3, 2, '#c8bda0'); ctx.restore(); } }

  // ---------------- legs + boots ----------------------------------------
  const legY = -13 + hop * 0.3;
  const clR = [OL, p.cl[1], p.cl[2], p.cl[3], p.cl[4]];
  // ---- the outfit: shirt / pants / shoes / costume (only on your own ranger) ----
  const FT = o.fit || null;
  const pick = (cat) => { const k = FT && FT[cat]; return k && FITS[k] && fitUnlocked(k) && FITS[k].src !== 'free' ? FITS[k] : null; };
  const suit = pick('suit'), shirt = suit ? null : pick('shirt'), pants = suit ? null : pick('pants'), shoes = pick('shoes');
  const skR = [OL, p.sk[1], p.sk[2], p.sk[3], p.sk[4]];
  const legR = suit ? rampOf(suit.col) : pants ? rampOf(pants.col) : clR;
  const topR = suit ? rampOf(suit.col) : shirt ? rampOf(shirt.col) : clR;
  [[-5, stride], [4, -stride]].forEach(([lx, s2]) => {
    const lift = act === 'walk' ? Math.max(0, s2) * 0.4 : 0;
    plasticBox(lx - 1, legY - lift, 7, 10, 2, legR, { noShine: 1 });
    if (pants && pants.pat) fitPattern(pants, lx - 1, legY - lift, 7, 10, lx);
    if (pants && pants.shorts) plasticBox(lx - 1, legY - lift + 5, 7, 5, 2, skR, { noShine: 1 });
    if (suit && suit.pat) fitPattern(suit, lx - 1, legY - lift, 7, 10, lx);
    fitShoe(shoes, lx - 3, Math.round(-5 + s2 * 0.26 - lift), 1);
  });
  if (pants && pants.kilt) { plasticBox(-10, legY - 1, 21, 8, 2, legR, { noShine: 1 }); fitPattern(pants, -10, legY - 1, 21, 8, 0); }

  // ---------------- torso: one moulded block ----------------------------
  const by = -29 + hop;
  ctx.save();
  ctx.translate(0, by + 9); ctx.scale(1 / sq, sq); ctx.translate(0, -(by + 9)); ctx.rotate(lean * 0.3);
  if (suit) suitBack(suit, by);
  plasticBox(-10, by, 21, 18, 5, topR);
  if (suit) {
    if (suit.pat) fitPattern(suit, -10, by, 21, 18, 0);
    suitFront(suit, by);
  } else if (shirt) {
    if (shirt.pat) fitPattern(shirt, -10, by, 21, 18, 0);
    fitShirtFront(shirt, by);
    const wb = pants ? rampOf(pants.col) : BOOT;
    rect(-10, by + 14, 21, 2, wb[1]); rect(-10, by + 14, 21, 1, wb[3]);
  } else {
    plasticBox(-4, by + 3, 9, 14, 3, ['#0f120e', '#cfc7ab', '#e6dfc6', '#f6f2e2', '#ffffff'], { noShine: 1 });
    rect(-10, by + 12, 21, 3, BOOT[1]);
    rect(-10, by + 12, 21, 1, BOOT[3]);
    plasticBox(-2, by + 11, 6, 5, 1, [UGOLD[0], UGOLD[1], UGOLD[2], UGOLD[3], UGOLD[4]], { noShine: 1 });
    plasticBox(5, by + 3, 5, 5, 1, [OL, p.acD, p.ac, mixHex(p.ac, '#ffffff', 0.4), '#ffffff'], { noShine: 1 });
  }

  // ---------------- arms ------------------------------------------------
  const g = GLOVES[(o.glove && gloveUnlocked(o.glove)) ? o.glove : 'bare'] || GLOVES.bare;
  const gR = [OL, mixHex(g.skin, '#000000', 0.4), g.skin, mixHex(g.skin, '#ffffff', 0.32), '#ffffff'];
  const pose = (side) => {
    if (act === 'cheer') return { x: side * 11, y: by - 2 + Math.sin(t * 5) * 1.5, r: side * (1.7 + Math.sin(t * 5) * 0.14) };
    if (act === 'row') return { x: side * 10, y: by + 5 + Math.sin(t * 2.2) * 2, r: side * (0.3 + Math.sin(t * 2.2) * 0.34) };
    if (act === 'walk') return { x: side * 10, y: by + 6, r: side * 0.18 + Math.sin(t * 5.4) * 0.34 * side };
    if (act === 'wave' && side > 0) return { x: 11, y: by - 1, r: 2.1 + Math.sin(t * 6) * 0.3 };
    if (act === 'point' && side > 0) return { x: 12, y: by + 3, r: 1.1 };
    if (act === 'think' && side > 0) return { x: 7, y: by - 5, r: -0.5 };
    return { x: side * 10, y: by + 6 + Math.sin(t * 1.3 + side) * 0.6, r: side * (0.14 + Math.sin(t * 1.3 + side) * 0.03) };
  };
  [-1, 1].forEach(side => {
    const a2 = pose(side);
    ctx.save(); ctx.translate(a2.x, a2.y); ctx.rotate(a2.r);
    plasticBox(-3, -2, 6, 10, 2, topR, { noShine: 1 });
    if (shirt && shirt.pat === 'stripes') for (let j = 0; j < 8; j += 3) rect(-2, j, 4, 1, shirt.col2);
    plasticBox(-4, 6, 8, 7, 3, gR, { noShine: 1 });
    ctx.restore();
  });
  ctx.restore(); // squash

  // ---------------- head ------------------------------------------------
  const hy = by - 12;
  ctx.save();
  ctx.translate(0, hy + Math.sin(t * 1.3 + 1.2) * 0.3); ctx.rotate(tilt);
  ctx.save(); ctx.globalAlpha = 0.25; ctx.scale(1, 0.4); fillCircle(0, 14 / 0.4, 9, '#000'); ctx.restore();
  if (suit) suitHoodBack(suit);
  bobHead(key, expr, o.phase || 0, look, tilt, { noEars: !!(suit && suit.hood) });
  if (suit) suitHoodFront(suit, !!p.topeyes);
  const gk = o.gear && gearUnlocked(o.gear) ? o.gear : 'none';
  if (gk !== 'none') drawGearArt(0, -1, gk, 1);
  const hk = o.hat && hatUnlocked(o.hat) ? o.hat : 'none';
  if (hk !== 'none') drawHatArt(0, -12, hk, 1);
  ctx.restore();

  // ---------------- the snail sage's shell -------------------------------
  if (key === 'snail') {
    const s = p.shell, sx = 10, sy = by + 7;
    fillCircle(sx, sy, 10, s[0]); fillCircle(sx, sy, 9, s[2]);
    fillCircle(sx - 1, sy - 1, 7, s[3]); fillCircle(sx - 2, sy - 2, 4, s[4]);
    ctx.save(); ctx.globalAlpha = 0.5;
    for (let a = 0; a < 16; a++) { const an = a / 16 * 6.283, rr2 = 9 - a * 0.42; rect(sx + Math.cos(an * 2) * rr2, sy + Math.sin(an * 2) * rr2, 1, 1, s[1]); }
    ctx.restore();
    fillCircle(sx + 1, sy + 1, 2, s[1]); rect(sx - 4, sy - 5, 2, 1, '#ffffff77');
  }
  ctx.restore();
}

// ======================= MERLE THE MANATEE ================================
//  The shopkeep gets the same five-tone treatment as the rangers: a barrel of
//  a sea-cow lit from the upper-left, with a real expression set, whiskers
//  that twitch, flippers that gesture and a jaw that flaps while he talks.
//  Nothing here is rotated - every pose is a hand-placed pixel offset, so the
//  art never smears.  drawVendor(x, y, o) fills a ~60x64 box from (x, y).
//  o = { expr, talk, phase }   expr: calm|happy|wow|think|sleepy|sad|proud
// ==========================================================================
const MERLE = {
  sk: ['#151d22', '#4d5d69', '#6f8290', '#93a7b4', '#c0d2dc'],
  bel: ['#151d22', '#8a9aa4', '#adbdc6', '#cddce4', '#eef6fa'],
  vest: ['#16210d', '#2f4519', '#446425', '#5c8532', '#7dab4a'],
  algae: ['#3f6b28', '#5f9a3c', '#8fc85a'],
};
// egg-shaped half-width tables, built once so the silhouette is smooth
function eggSpans(n, maxw, bias, minw) {
  const a = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1) - (bias === undefined ? 0.46 : bias)) / 0.58;
    a.push(Math.max(minw === undefined ? 4 : minw, Math.round(maxw * Math.sqrt(Math.max(0, 1 - t * t)))));
  }
  return a;
}
const MERLE_BODY = eggSpans(42, 24, 0.44, 7);
const MERLE_HEAD = eggSpans(21, 16, 0.42, 4);
const MERLE_BELLY = eggSpans(18, 15, 0.5, 5);
const MERLE_FLIP = eggSpans(12, 9, 0.46, 3);
const MERLE_TAIL = eggSpans(15, 13, 0.5, 5);

function drawVendor(x, y, o) {
  o = o || {};
  const p = MERLE, OL = p.sk[0], ph = o.phase || 0;
  const expr = o.expr || 'calm';
  const float = Math.round(Math.sin(tNow * 1.25 + ph) * 2);   // always half-swimming
  const cx = (x + 30) | 0, gy = (y + 64 + float) | 0;
  const look = { x: clamp((mx - cx) / 90, -1, 1), y: clamp((my - (gy - 48)) / 90, -1, 1) };

  ctx.save();
  ctx.translate(cx, gy);
  // ---- water shadow ----
  ctx.save(); ctx.globalAlpha = 0.26; ctx.scale(1, 0.2); fillCircle(0, (-4 - float) / 0.2, 23, '#000'); ctx.restore();

  // ---- tail paddle sweeping behind him (stepped, never rotated) ----
  const sweep = Math.round(Math.sin(tNow * 1.05 + ph) * 3);
  ctx.save(); ctx.translate(24, -24 + sweep); ctx.scale(1.25, 0.8);
  bobShape(MERLE_TAIL, -8, p.sk, { norim: 1 });
  ctx.restore();
  ctx.save(); ctx.globalAlpha = 0.3;
  for (let k = 0; k < 4; k++) rect(22 + k * 4, -30 + sweep, 1, 12, p.sk[1]);
  ctx.restore();

  // ---- far flipper, tucked behind the barrel ----
  const far = Math.round(Math.sin(tNow * 1.4 + ph + 1) * 2);
  ctx.save(); ctx.translate(21, -30 + far); ctx.scale(1.35, 0.95); bobShape(MERLE_FLIP, 0, p.sk, { norim: 1 }); ctx.restore();
  [0, 1, 2].forEach(k => rect(19 + k * 3, -17 + far, 2, 3, p.sk[1]));

  // ---- body ----
  bobShape(MERLE_BODY, -52, p.sk);
  ctx.save(); ctx.globalAlpha = 0.62; bobShape(MERLE_BELLY, -30, p.bel, { norim: 1 }); ctx.restore();
  ctx.save(); ctx.globalAlpha = 0.3; bobShape(eggSpans(10, 13, 0.5, 4), -33, p.sk, { norim: 1 }); ctx.restore();
  ctx.save(); ctx.globalAlpha = 0.28;   // skin folds
  rect(-19, -40, 34, 1, p.sk[1]); rect(-18, -34, 32, 1, p.sk[1]); rect(-15, -28, 27, 1, p.sk[1]);
  ctx.restore();
  [[16, -44, 3], [-18, -33, 2], [15, -26, 2], [-16, -47, 2], [7, -50, 3]].forEach(([ax, ay, ar], i) => {
    fillCircle(ax, ay, ar, p.algae[0]); fillCircle(ax, ay - 1, ar - 1, p.algae[1]);
    if (i % 2) rect(ax - 1, ay - ar, 1, 1, p.algae[2]);
  });

  // ---- ranger vest, hanging down both flanks ----
  [-1, 1].forEach(s => {
    const vx = s < 0 ? -23 : 12;
    rr(vx, -44, 12, 29, 3, p.vest[0]);
    rr(vx + 1, -43, 10, 27, 2, p.vest[2]);
    rect(vx + 1, -43, 4, 25, p.vest[3]);
    rect(vx + 1, -43, 3, 7, p.vest[4]);
    rect(vx + 9, -42, 1, 25, p.vest[1]);
    rr(vx + 2, -29, 7, 7, 1, p.vest[1]); rect(vx + 2, -29, 7, 1, p.vest[3]);
    rect(vx + 3, -27, 5, 1, p.vest[0]);
  });
  rr(-21, -40, 8, 7, 2, '#8a6510'); rr(-21, -40, 7, 6, 2, C.gold);
  rect(-20, -39, 2, 2, '#fff6c8'); rect(-19, -36, 4, 1, '#8a6510');

  // ---- near flipper: gestures with the mood ----
  const gest = expr === 'happy' ? 3 : expr === 'wow' ? 1 : expr === 'think' ? 2 : 0;
  let fy = -30 + Math.round(Math.sin(tNow * 1.6 + ph) * 2), fox = -21;
  if (gest === 3) { fy = -44 + Math.round(Math.abs(Math.sin(tNow * 5 + ph)) * -5); fox = -23; }  // waving
  else if (gest === 1) { fy = -47; fox = -20; }                                                   // both up
  else if (gest === 2) { fy = -52; fox = -11; }                                                   // paw to chin
  ctx.save(); ctx.globalAlpha = 0.28; fillCircle(fox + 6, fy + 5, 6, '#000'); ctx.restore();
  ctx.save(); ctx.translate(fox, fy); ctx.scale(1.35, 0.95); bobShape(MERLE_FLIP, 0, p.sk); ctx.restore();
  [0, 1, 2].forEach(k => { rect(fox - 5 + k * 3, fy + 12, 2, 3, OL); rect(fox - 5 + k * 3, fy + 12, 2, 2, p.sk[1]); });

  // ---- head (merges straight into the barrel, manatees have no neck) ----
  const nod = expr === 'sleepy' ? Math.round(Math.sin(tNow * 1.1 + ph) * 2) : 0;
  const hx = expr === 'think' ? -3 : 0;
  ctx.save();
  ctx.translate(hx, -54 + nod);
  bobShape(MERLE_HEAD, -14, p.sk);
  ctx.save(); ctx.globalAlpha = 0.28; rect(-14, -7, 11, 2, p.sk[1]); rect(3, -7, 11, 2, p.sk[1]); ctx.restore();

  // ---- eyes ----
  const eye = (ex, r) => {                      // one dark bead, one bright catch
    const dx = Math.round(look.x * 1.2), dy = Math.round(look.y * 1);
    const bx = ex + dx, by2 = -4 + dy;
    rr(bx - r + 1, by2 - r, r * 2 - 1, r * 2, 1, '#120b05');
    rect(bx - r + 1, by2 - r + 1, 2, 2, '#ffffff');
    rect(bx + r - 2, by2 + r - 2, 1, 1, '#ffffff55');
  };
  if (expr === 'wow') { [-7, 7].forEach(ex => eye(ex, 4)); }
  else { [-7, 7].forEach(ex => eye(ex, 3)); }
  if (expr === 'sad' || expr === 'think') {
    rect(-13, -12, 6, 2, OL); rect(-12, -13, 4, 1, OL);
    rect(7, -12, 6, 2, OL); rect(8, -13, 4, 1, OL);
  } else if (expr === 'proud' || expr === 'wow') { rect(-13, -13, 7, 2, OL); rect(6, -13, 7, 2, OL); }

  // ---- muzzle: the big prehensile-lipped nose ----
  rr(-11, 0, 22, 14, 6, OL);
  rr(-10, 0, 20, 12, 5, p.sk[3]);
  rr(-9, 0, 11, 6, 4, p.sk[4]);
  rect(3, 2, 6, 10, p.sk[2]);
  rr(-9, 7, 18, 6, 3, p.bel[2]); rect(-8, 7, 11, 1, p.bel[3]);
  rect(-6, 2, 4, 4, p.sk[1]); rect(3, 2, 4, 4, p.sk[1]);
  rect(-6, 2, 4, 1, OL); rect(3, 2, 4, 1, OL);
  ctx.save(); ctx.globalAlpha = 0.75;
  [0, 1, 2].forEach(k => {
    const tw = Math.round(Math.sin(tNow * 3.1 + k * 1.7 + ph) * 0.9);
    rect(-18, 4 + k * 3 + tw, 8, 1, '#d6e4ec'); rect(10, 4 + k * 3 - tw, 8, 1, '#d6e4ec');
  });
  ctx.restore();
  // mouth, flapping while he talks
  const talk = o.talk ? (Math.sin(tNow * 13 + ph) * 0.5 + 0.5) : 0;
  const mh = 1 + Math.round(talk * 4);
  if (expr === 'happy' || expr === 'proud') { rect(-5, 10, 11, 1, '#3f4f59'); rect(-6, 9, 1, 1, '#3f4f59'); rect(6, 9, 1, 1, '#3f4f59'); }
  else if (expr === 'sad') { rect(-4, 11, 9, 1, '#3f4f59'); rect(-5, 10, 1, 1, '#3f4f59'); rect(5, 10, 1, 1, '#3f4f59'); }
  else rect(-4, 10, 9, 1, '#3f4f59');
  if (talk > 0.05) { rr(-4, 10, 9, mh, 2, '#40202a'); rect(-3, 11, 7, Math.max(1, mh - 2), '#9a4f5e'); }
  ctx.restore(); // head

  // ---- mood flourishes ----
  if (expr === 'sleepy') {
    const z = (tNow * 0.55 + ph) % 3;
    if (z < 2.4) { ctx.save(); ctx.globalAlpha = 0.9 - z * 0.35; drawText('z', 16 + z * 3, -68 - z * 7, '#cfe8f0', z < 1.2 ? 1 : 2); ctx.restore(); }
  } else if (expr === 'wow') {
    ctx.save(); ctx.globalAlpha = 0.6 + Math.sin(tNow * 8) * 0.4; drawText('!', 18, -76, '#ffd54a', 2); ctx.restore();
  } else if (expr === 'think') {
    for (let k = 0; k < 3; k++) {
      const f = (tNow * 0.5 + k * 0.33 + ph) % 1;
      ctx.save(); ctx.globalAlpha = 0.7 * (1 - f); fillCircle(18 + k * 3, -66 - f * 20, 1 + k, '#bfe8f2'); ctx.restore();
    }
  }
  ctx.restore();
}

// ---------------------------------------------------- HERO ITEM SPRITES ---
// The 12x12 ICONS stay for chips and lists; these are the 24x24 "hero" sprites
// the shop, the packs and the bench show off.  Shared ramps keep every tool
// looking like it came out of the same sterilised drawer.
const MET = ['#0e171c', '#374954', '#64798a', '#9cb2c0', '#e6f2fa'];   // chrome
const BRS = ['#221403', '#5e3f0d', '#9a7118', '#cfa332', '#ffe9a0'];   // brass
const GRP = ['#0f1a17', '#1d352e', '#2c5348', '#3f7465', '#5a9a86'];   // rubber grip
const ENA = ['#9a9078', '#cfc7ae', '#eee7d2', '#fdfaf0'];              // enamel

// a chrome shaft with a lit top edge and a shaded belly
function metalBar(x, y, w, h, ramp) {
  ramp = ramp || MET;
  rect(x, y, w, h, ramp[0]);
  rect(x, y + 1, w, h - 2, ramp[2]);
  rect(x, y + 1, w, 1, ramp[3]);
  rect(x + 1, y + 1, Math.max(1, w - 2), 1, ramp[4]);
  rect(x, y + h - 2, w, 1, ramp[1]);
}
function metalBarV(x, y, w, h, ramp) {
  ramp = ramp || MET;
  rect(x, y, w, h, ramp[0]);
  rect(x + 1, y, w - 2, h, ramp[2]);
  rect(x + 1, y, 1, h, ramp[3]);
  rect(x + 1, y + 1, 1, Math.max(1, h - 2), ramp[4]);
  rect(x + w - 2, y, 1, h, ramp[1]);
}
function toothBody(x, y, w, h, ramp) {
  ramp = ramp || ENA;
  rr(x, y, w, h - 5, 4, ramp[0]);
  rr(x + 1, y + 1, w - 2, h - 7, 3, ramp[2]);
  rr(x + 1, y + 1, w - 6, h - 10, 3, ramp[3]);
  rect(x, y + h - 7, (w >> 1) - 1, 7, ramp[0]);
  rect(x + (w >> 1) + 1, y + h - 7, (w >> 1) - 1, 7, ramp[0]);
  rect(x + 1, y + h - 7, (w >> 1) - 3, 5, ramp[1]);
  rect(x + (w >> 1) + 2, y + h - 7, (w >> 1) - 3, 5, ramp[1]);
  rect(x + 2, y + 2, 2, 3, ramp[3]);
}

const TOOLART = {
  // ---- the dental handpiece: chrome barrel, knurled grip, spinning burr ----
  tdrill(x, y) {
    const spin = (tNow * 26 | 0) % 3;
    for (let k = 0; k < 7; k++) rect(x + 1 + k, y + 19 - k, 2, 2, '#2b3a44');       // cable
    rect(x + 1, y + 18, 3, 4, '#1c272e'); rect(x + 1, y + 18, 3, 1, '#42565f');
    metalBar(x + 5, y + 10, 13, 7);                                                  // barrel
    for (let k = 0; k < 4; k++) rect(x + 7 + k * 2, y + 11, 1, 5, MET[1]);           // knurling
    rect(x + 5, y + 10, 13, 1, MET[4]);
    metalBar(x + 16, y + 6, 6, 6);                                                   // head
    rect(x + 17, y + 7, 4, 1, MET[4]);
    rect(x + 18, y + 2, 2, 5, MET[1]);                                               // burr shank
    rect(x + 17 + spin, y + 1, 2, 2, MET[4]); rect(x + 20 - spin, y + 2, 1, 1, '#fff');
    rect(x + 5, y + 17, 6, 3, C.red); rect(x + 5, y + 17, 6, 1, '#ff8a6a');           // trigger
    ctx.save(); ctx.globalAlpha = 0.5 + Math.sin(tNow * 18) * 0.3;
    rect(x + 16, y + 0, 5, 1, '#cfe8f0'); ctx.restore();
  },
  // ---- extraction forceps ----
  tpliers(x, y) {
    metalBarV(x + 5, y + 1, 4, 11); metalBarV(x + 15, y + 1, 4, 11);
    rect(x + 6, y + 1, 2, 2, MET[4]); rect(x + 16, y + 1, 2, 2, MET[4]);
    rect(x + 7, y + 9, 10, 4, MET[0]); rect(x + 7, y + 10, 10, 2, MET[2]); rect(x + 7, y + 10, 10, 1, MET[3]);
    fillCircle(x + 12, y + 11, 2, MET[1]); rect(x + 11, y + 10, 1, 1, MET[4]);       // pivot screw
    rr(x + 4, y + 12, 6, 10, 2, GRP[0]); rr(x + 5, y + 13, 4, 8, 2, GRP[2]); rect(x + 5, y + 13, 2, 6, GRP[3]);
    rr(x + 14, y + 12, 6, 10, 2, GRP[0]); rr(x + 15, y + 13, 4, 8, 2, GRP[2]); rect(x + 15, y + 13, 2, 6, GRP[3]);
    for (let k = 0; k < 3; k++) { rect(x + 5, y + 15 + k * 2, 4, 1, GRP[1]); rect(x + 15, y + 15 + k * 2, 4, 1, GRP[1]); }
  },
  // ---- brace wire on a spool ----
  twire(x, y) {
    fillCircle(x + 8, y + 13, 8, MET[0]); fillCircle(x + 8, y + 13, 7, MET[1]);
    fillCircle(x + 7, y + 12, 5, MET[2]); fillCircle(x + 6, y + 11, 3, MET[3]);
    ctx.save(); ctx.globalAlpha = 0.6;
    for (let k = 0; k < 6; k++) fillCircle(x + 8, y + 13, 7 - k, k & 1 ? MET[1] : MET[2]);
    ctx.restore();
    fillCircle(x + 8, y + 13, 2, '#1a242a');
    for (let k = 0; k < 9; k++) rect(x + 14 + k, y + 8 - Math.round(Math.sin(k * 0.8 + tNow * 2) * 2), 2, 1, MET[3]);
    [0, 1, 2].forEach(k => { rect(x + 15 + k * 3, y + 3, 3, 4, MET[0]); rect(x + 15 + k * 3, y + 3, 3, 3, MET[2]); rect(x + 15 + k * 3, y + 3, 1, 3, MET[4]); });
  },
  // ---- infection vial ----
  tvial(x, y) {
    rect(x + 8, y + 1, 8, 4, '#6a4a22'); rect(x + 8, y + 1, 8, 2, '#8f6a34'); rect(x + 9, y + 1, 2, 1, '#c09858');
    rect(x + 7, y + 5, 10, 2, MET[1]); rect(x + 7, y + 5, 10, 1, MET[3]);
    rr(x + 6, y + 6, 12, 16, 4, '#0f1a20');
    rr(x + 7, y + 7, 10, 14, 3, '#1b2f38');
    rr(x + 7, y + 12, 10, 9, 3, '#6b2fa8');                    // fluid
    rect(x + 7, y + 12, 10, 1, '#a86ae0');
    ctx.save(); ctx.globalAlpha = 0.6; rect(x + 8, y + 8, 2, 12, '#bfe8f2'); ctx.restore();
    const bb = (tNow * 1.6) % 1;
    fillCircle(x + 13, y + 20 - bb * 7, 1, '#d8b0ff');
    fillCircle(x + 11, y + 19 - ((bb + 0.5) % 1) * 6, 1, '#d8b0ff');
    rr(x + 8, y + 15, 8, 5, 1, '#e8e0c8'); rect(x + 9, y + 16, 6, 1, '#8a3a3a'); rect(x + 9, y + 18, 4, 1, '#6a6050');
  },
  // ---- veneer kit: a hinged case of shells ----
  tveneer(x, y) {
    rr(x + 1, y + 6, 22, 16, 2, '#241708');
    rr(x + 2, y + 7, 20, 14, 2, '#6a4a2a'); rect(x + 2, y + 7, 20, 2, '#8a6238');
    rect(x + 2, y + 13, 20, 1, '#3a2818');
    rr(x + 3, y + 14, 18, 6, 1, '#2a1c10');
    for (let k = 0; k < 4; k++) { rr(x + 4 + k * 4, y + 15, 3, 5, 1, ENA[1]); rect(x + 4 + k * 4, y + 15, 3, 2, ENA[3]); }
    rr(x + 3, y + 8, 18, 5, 1, '#8a6238'); rect(x + 4, y + 9, 16, 2, '#a87a48');
    drawTextC('VENEER', x + 12, y + 9, '#3a2818', 1);
    rect(x + 10, y + 5, 4, 2, MET[2]); rect(x + 10, y + 5, 4, 1, MET[4]);
    if (Math.sin(tNow * 3) > 0.7) rect(x + 6, y + 15, 1, 1, '#ffffff');
  },
  // ---- fluoride bath: a tray of blue foam ----
  tbath(x, y) {
    rr(x + 1, y + 10, 22, 12, 3, '#0e2630');
    rr(x + 2, y + 11, 20, 10, 2, '#2f7f9a');
    rr(x + 3, y + 11, 18, 5, 2, '#4fb3d9');
    rect(x + 3, y + 11, 14, 1, '#9fe8ff');
    ctx.save(); ctx.globalAlpha = 0.6;
    for (let k = 0; k < 6; k++) { const bx = x + 4 + k * 3, byy = y + 12 + ((tNow * 2 + k) | 0) % 2; fillCircle(bx, byy, 1, '#dff8ff'); }
    ctx.restore();
    rect(x + 1, y + 20, 22, 2, '#123845');
    toothBody(x + 7, y + 1, 11, 14);
    ctx.save(); ctx.globalAlpha = 0.35; rr(x + 7, y + 9, 11, 5, 2, '#4fb3d9'); ctx.restore();
    if (Math.sin(tNow * 4) > 0.4) { rect(x + 18, y + 4, 1, 1, '#fff'); rect(x + 19, y + 6, 1, 1, '#cfe8f0'); }
  },
  // ---- root extractor: a dental elevator ----
  troot(x, y) {
    rr(x + 8, y + 9, 7, 13, 3, '#241708'); rr(x + 9, y + 10, 5, 11, 2, '#6a4a2a');
    rect(x + 9, y + 10, 2, 9, '#8a6238');
    for (let k = 0; k < 4; k++) rect(x + 9, y + 12 + k * 2, 5, 1, '#3a2818');
    metalBarV(x + 9, y + 2, 5, 9);
    rect(x + 8, y + 1, 7, 3, MET[0]); rect(x + 9, y + 1, 5, 2, MET[3]); rect(x + 9, y + 1, 2, 1, MET[4]);
    rect(x + 4, y + 4, 4, 2, BRS[2]); rect(x + 4, y + 4, 4, 1, BRS[4]);   // pried-out gold
    rect(x + 16, y + 6, 3, 3, BRS[1]); rect(x + 16, y + 6, 2, 2, BRS[3]);
    if (Math.sin(tNow * 5) > 0.5) rect(x + 12, y + 0, 1, 1, '#fff');
  },
  // ---- diamond cap ----
  tdiamond(x, y) {
    toothBody(x + 4, y + 8, 16, 14);
    const b = 0.6 + Math.sin(tNow * 3) * 0.25;
    ctx.save(); ctx.globalAlpha = 0.28 * b; fillCircle(x + 12, y + 7, 11, '#9fe8ff'); ctx.restore();
    rect(x + 6, y + 6, 12, 2, '#5fb0d0');
    rect(x + 5, y + 4, 14, 2, '#8fdcf4');
    rect(x + 7, y + 2, 10, 2, '#cff4ff');
    rect(x + 9, y + 8, 6, 2, '#5fb0d0');
    rect(x + 11, y + 10, 2, 1, '#3f8ab0');
    rect(x + 8, y + 3, 3, 2, '#ffffff'); rect(x + 14, y + 5, 2, 1, '#ffffff');
    ctx.save(); ctx.globalAlpha = b; rect(x + 12 - ((tNow * 6 | 0) % 8), y + 1, 1, 1, '#ffffff'); ctx.restore();
  },
  // ---- gold filling ----
  tgold(x, y) {
    toothBody(x + 4, y + 3, 16, 19);
    rr(x + 8, y + 7, 8, 8, 2, BRS[1]);
    rr(x + 8, y + 7, 7, 7, 2, BRS[3]);
    rect(x + 9, y + 8, 4, 2, BRS[4]);
    rect(x + 9, y + 12, 5, 1, BRS[2]);
    ctx.save(); ctx.globalAlpha = 0.8;
    const sh = (tNow * 4 | 0) % 6; rect(x + 8 + sh, y + 7, 1, 8, '#fff6c8'); ctx.restore();
  },
  // ---- ruby inlay ----
  truby(x, y) {
    toothBody(x + 4, y + 3, 16, 19);
    rect(x + 9, y + 7, 6, 2, '#a3162e');
    rect(x + 8, y + 9, 8, 3, '#e0304f');
    rect(x + 9, y + 12, 6, 2, '#ff4d6a');
    rect(x + 11, y + 14, 2, 1, '#a3162e');
    rect(x + 10, y + 8, 2, 1, '#ffb0c0'); rect(x + 13, y + 11, 1, 1, '#ffd8e0');
    if (Math.sin(tNow * 3.5) > 0.6) rect(x + 16, y + 6, 1, 1, '#fff');
  },
};
const TOOL_HERO = k => TOOLART[k] || null;

// a dentist tool presented like a real instrument: brass-cornered display case
// with velvet backing, a hero sprite under glass and an engraved name plate
function drawToolItem(x, y, def, o) {
  o = o || {};
  x |= 0; y |= 0;
  const hero = TOOLART[def.ico];
  // case body
  rr(x + 1, y + 3, 30, 42, 3, '#00000088');
  rr(x, y, 30, 42, 3, '#1a1008');
  rr(x + 1, y + 1, 28, 40, 3, BRS[1]);
  rr(x + 2, y + 2, 26, 38, 2, '#2b1c0c');
  rr(x + 3, y + 3, 24, 30, 2, '#120d18');          // velvet well
  rr(x + 3, y + 3, 24, 12, 2, '#1d1526');
  ctx.save(); ctx.globalAlpha = 0.5; fillCircle(x + 12, y + 12, 11, '#2a2036'); ctx.restore();
  // the instrument itself
  if (hero) { ctx.save(); ctx.translate(x + 3, y + 5); hero(0, 0); ctx.restore(); }
  else { ctx.save(); ctx.translate(x + 3, y + 8); ctx.scale(2, 2); (ICONS[def.ico] || ICONS.tdrill)(0, 0); ctx.restore(); }
  // glass: a raking reflection that slides across the pane
  ctx.save();
  ctx.beginPath(); ctx.rect(x + 3, y + 3, 24, 30); ctx.clip();
  ctx.globalAlpha = 0.13;
  const gsw = ((tNow * 0.35 + (def.id || '').length * 0.21) % 3);
  if (gsw < 1) { const gx = x - 14 + gsw * 46; for (let k = 0; k < 32; k++) rect(gx + k * 0.5, y + 3 + k, 6, 1, '#ffffff'); }
  ctx.globalAlpha = 0.09; rect(x + 4, y + 4, 4, 28, '#cfe8f0');
  ctx.restore();
  // engraved brass name plate
  rr(x + 3, y + 33, 24, 7, 1, BRS[0]);
  rr(x + 3, y + 33, 24, 6, 1, BRS[2]);
  rect(x + 4, y + 34, 22, 1, BRS[4]);
  drawTextC(def.name.split(' ')[0].slice(0, 6), x + 15, y + 34, '#3a2606', 1);
  // corner rivets
  [[x + 2, y + 2], [x + 26, y + 2], [x + 2, y + 37], [x + 26, y + 37]].forEach(([rx, ry]) => {
    rect(rx, ry, 2, 2, BRS[1]); rect(rx, ry, 1, 1, BRS[4]);
  });
  if (o.price !== undefined) {
    rr(x - 3, y - 5, 20, 9, 2, '#00000088');
    drawText('$' + o.price, x - 1, y - 3, o.afford ? C.gold : C.red, 1);
  }
}

// quest-giver NPC faces (28x28, same style as the rangers)
function drawNpcFace(x, y, key) {
  if (key === 'granny') { // old turtle with spectacles
    fillCircle(x + 20, y + 10, 8, '#4a5a2e'); fillCircle(x + 20, y + 10, 6, '#5c7038'); // shell behind
    rr(x + 2, y + 8, 20, 16, 5, '#8fae68');
    rect(x + 3, y + 8, 18, 2, '#00000018');
    // spectacles
    rect(x + 4, y + 12, 7, 1, '#c8b060'); rect(x + 13, y + 12, 7, 1, '#c8b060'); rect(x + 11, y + 13, 2, 1, '#c8b060');
    critterEye(x + 5, y + 12, 6, 6, '#8fae68', '#f8f4dc', '#1b1408', 4.0);
    critterEye(x + 14, y + 12, 6, 6, '#8fae68', '#f8f4dc', '#1b1408', 4.4);
    rect(x + 8, y + 20, 8, 1, '#5c7038'); // wrinkly smile
    rect(x + 6, y + 22, 3, 1, '#5c7038'); rect(x + 15, y + 22, 3, 1, '#5c7038');
    rr(x + 4, y + 3, 16, 6, 3, '#d8c8e8'); // granny bonnet
  } else if (key === 'crow') { // ferryman crow with hood
    rr(x + 4, y + 4, 20, 20, 6, '#2a3038'); // hood
    rr(x + 7, y + 9, 14, 12, 4, '#3a424c'); // face opening
    critterEye(x + 8, y + 11, 5, 6, '#3a424c', '#f8f4dc', '#1b1408', 4.8);
    critterEye(x + 15, y + 11, 5, 6, '#3a424c', '#f8f4dc', '#1b1408', 5.2);
    rect(x + 11, y + 17, 10, 3, '#e8c04a'); // beak
    rect(x + 18, y + 18, 4, 2, '#c89a2a');
    rect(x + 2, y + 22, 24, 3, '#22282e'); // cloak collar
    rect(x + 12, y + 2, 4, 3, '#c8b060'); // lantern glint atop hood
  } else { // doc mudbug: crawfish with head mirror
    rect(x + 3, y + 2, 3, 6, '#c86a5a'); rect(x + 22, y + 2, 3, 6, '#c86a5a'); // antennae
    rr(x + 4, y + 7, 20, 16, 5, '#e08878');
    rect(x + 5, y + 7, 18, 2, '#00000018');
    critterEye(x + 6, y + 10, 6, 7, '#e08878', '#f8f4dc', '#1b1408', 5.6);
    critterEye(x + 16, y + 10, 6, 7, '#e08878', '#f8f4dc', '#1b1408', 6.0);
    fillCircle(x + 14, y + 4, 4, '#c8d2d8'); fillCircle(x + 14, y + 4, 2, '#f4feff'); // head mirror
    rect(x + 10, y + 19, 8, 1, '#a85848'); // smile
    rect(x + 1, y + 14, 4, 6, '#c86a5a'); rect(x + 23, y + 14, 4, 6, '#c86a5a'); // little claws
    rr(x + 4, y + 23, 20, 4, 2, '#f4f0dc'); // doctor collar
  }
}

// ======================= RANGER BADGES =====================================
//  Moulded plastic pin badges: a flat coloured puck with a hard gloss sweep,
//  a cube-headed bust stamped into it and three raised rank pips.  Same toy
//  language as the characters - no felt, no filigree, no texture.
// ==========================================================================
const BADGEPAL = {
  scout: { base: '#2f6b3a', dark: '#17452a', lite: '#4f9a5c', shine: '#8fd89a', fur: ['#2a1608', '#6a4222', '#8c5c33', '#cfa370'], cream: '#f0dcbc' },
  medic: { base: '#26606e', dark: '#123c48', lite: '#3f8d9e', shine: '#88d4e4', fur: ['#1c1820', '#767683', '#9d9dab', '#e2e2ee'], cream: '#fbfbff' },
  trader: { base: '#8a6512', dark: '#513a06', lite: '#b8901f', shine: '#ffd977', fur: ['#191510', '#665e51', '#8a8171', '#cfc6b2'], cream: '#efe8d4' },
  frog: { base: '#8a3620', dark: '#551d10', lite: '#bb5130', shine: '#ff9068', fur: ['#12200c', '#478230', '#68a744', '#b4e688'], cream: '#e2f4c0' },
  snail: { base: '#4a3a66', dark: '#2b2040', lite: '#6d5a92', shine: '#ab97d4', fur: ['#1a1510', '#b6a284', '#d5c2a0', '#fcf2e0'], cream: '#fcf2e0' },
};

// A flat, chunky bust: cube head, block ears, dot eyes.  Two tones only.
function badgeBust(key, P) {
  const [OL, SH, MID, LIT] = P.fur;
  const head = [OL, SH, MID, LIT, mixHex(LIT, '#ffffff', 0.4)];
  if (key === 'scout') {                       // otter
    plasticBox(-8, -8, 5, 5, 2, head, { noShine: 1 });
    plasticBox(3, -8, 5, 5, 2, head, { noShine: 1 });
    plasticBox(-8, -6, 16, 15, 4, head);
    plasticBox(-5, 1, 10, 7, 3, [OL, mixHex(P.cream, '#000000', 0.25), P.cream, '#ffffff', '#ffffff'], { noShine: 1 });
    rect(-2, 1, 5, 3, OL);
    rect(-5, -3, 3, 3, OL); rect(2, -3, 3, 3, OL);
    rect(-5, -3, 1, 1, '#ffffff'); rect(2, -3, 1, 1, '#ffffff');
  } else if (key === 'medic') {                // opossum
    plasticBox(-10, -9, 7, 7, 3, [OL, '#8a5666', '#c87a90', '#f0a8bc', '#ffd8e2'], { noShine: 1 });
    plasticBox(3, -9, 7, 7, 3, [OL, '#8a5666', '#c87a90', '#f0a8bc', '#ffd8e2'], { noShine: 1 });
    plasticBox(-8, -6, 16, 15, 4, head);
    plasticBox(-5, 0, 10, 8, 3, [OL, mixHex(P.cream, '#000000', 0.22), P.cream, '#ffffff', '#ffffff'], { noShine: 1 });
    rect(-2, 2, 5, 3, '#c8708a');
    rect(-5, -3, 3, 3, OL); rect(2, -3, 3, 3, OL);
    rect(-5, -3, 1, 1, '#ffffff'); rect(2, -3, 1, 1, '#ffffff');
  } else if (key === 'trader') {               // raccoon
    plasticBox(-9, -10, 6, 6, 2, head, { noShine: 1 });
    plasticBox(3, -10, 6, 6, 2, head, { noShine: 1 });
    plasticBox(-8, -6, 16, 15, 4, head);
    rect(-8, -4, 16, 6, OL);
    plasticBox(-4, 2, 8, 6, 3, [OL, mixHex(P.cream, '#000000', 0.22), P.cream, '#ffffff', '#ffffff'], { noShine: 1 });
    rect(-2, 3, 5, 3, OL);
    rect(-5, -3, 3, 3, P.cream); rect(2, -3, 3, 3, P.cream);
    rect(-4, -3, 1, 1, OL); rect(3, -3, 1, 1, OL);
  } else if (key === 'frog') {                 // bullfrog
    plasticBox(-10, -10, 8, 8, 3, head, { noShine: 1 });
    plasticBox(2, -10, 8, 8, 3, head, { noShine: 1 });
    rect(-8, -8, 4, 4, '#f8f4e0'); rect(4, -8, 4, 4, '#f8f4e0');
    rect(-7, -7, 2, 2, OL); rect(5, -7, 2, 2, OL);
    plasticBox(-9, -3, 18, 12, 4, head);
    rect(-7, 3, 14, 1, OL);
    plasticBox(-5, 5, 10, 4, 2, [OL, mixHex(P.cream, '#000000', 0.2), P.cream, '#ffffff', '#ffffff'], { noShine: 1 });
  } else {                                     // snail
    plasticBox(1, -6, 15, 15, 6, [OL, '#7d5528', '#ab7c44', '#d0a668', '#efd6a2']);
    rect(6, -1, 5, 5, '#7d5528');
    rect(-7, -12, 2, 7, OL); rect(-2, -14, 2, 9, OL);
    plasticBox(-9, -15, 5, 5, 2, head, { noShine: 1 });
    plasticBox(-4, -17, 5, 5, 2, head, { noShine: 1 });
    plasticBox(-10, -4, 13, 13, 5, head);
    rect(-7, 0, 3, 3, OL); rect(-2, 0, 3, 3, OL);
    rect(-7, 0, 1, 1, '#ffffff'); rect(-2, 0, 1, 1, '#ffffff');
  }
}

const BADGE_METAL = [
  ['#1a120a', '#5a3c18', '#8a5f28', '#b8863f', '#e8bd74'],   // bronze
  ['#141a1e', '#48595f', '#6f838a', '#9db0b6', '#dfeaee'],   // steel
  ['#231704', '#8a5f10', '#d09a1e', '#f0c447', '#ffe89a'],   // gold
  ['#14141c', '#4a4a62', '#7e7e9c', '#b0b0cc', '#f0f0ff'],   // platinum
  ['#1c0a22', '#5a1f7a', '#9a3fc8', '#d07ff0', '#ffd8ff'],   // prismatic
];
function drawRangerBadge(x, y, key, o) {
  o = o || {};
  const P = BADGEPAL[key] || BADGEPAL.scout;
  const sc = o.sc || 1;
  const locked = !!o.locked;
  const tier = o.tier === undefined ? masteryLvl(key) : o.tier;
  const M = BADGE_METAL[clamp(tier, 0, 4)];
  ctx.save();
  ctx.translate((x + 14 * sc) | 0, (y + 14 * sc) | 0);
  if (sc !== 1) ctx.scale(sc, sc);
  if (o.wob) ctx.rotate(Math.sin(tNow * 1.2 + key.length) * 0.02);
  if (o.wob) { ctx.save(); ctx.globalAlpha = 0.22 + Math.sin(tNow * 4) * 0.06; rr(-16, -16, 32, 32, 8, P.shine); ctx.restore(); }
  // the moulded metal rim, its alloy set by mastery rank
  plasticBox(-15, -15, 30, 30, 8, M, { noShine: 1 });
  // milled rim: a ring of struck dots, lit on the top-left
  for (let k = 0; k < 28; k++) {
    const an = k / 28 * Math.PI * 2, rx = Math.round(Math.cos(an) * 13.2), ry = Math.round(Math.sin(an) * 13.2);
    rect(rx, ry, 1, 1, (an > 2.4 && an < 5.4) ? M[4] : M[1]);
  }
  plasticBox(-12, -12, 24, 24, 6, ['#12100a', P.dark, P.base, P.lite, P.shine], { noShine: 1, seed: key.length });
  // enamel field: fine cross-hatch guilloche engraved under the bust
  ctx.save(); ctx.globalAlpha = 0.28;
  for (let k = -10; k < 11; k += 3) { for (let j = -9; j < 10; j += 2) rect(k + ((j >> 1) & 1), j, 1, 1, P.dark); }
  ctx.restore();
  ctx.save(); ctx.translate(0, -2); ctx.scale(0.66, 0.66); badgeBust(key, P); ctx.restore();
  // a laurel notch each side, and one rank pip per mastery level
  [-1, 1].forEach(sd => { for (let k = 0; k < 3; k++) rect(sd * 12 - (sd < 0 ? 1 : 0), -5 + k * 4, 2, 2, M[3]); });
  const pips = Math.max(1, tier + 1);
  for (let k = 0; k < pips; k++) {
    const px = -(pips * 4 - 1) / 2 + k * 4;
    rect(px, 8, 3, 3, M[1]); rect(px, 8, 3, 1, M[4]); rect(px + 1, 9, 1, 1, M[3]);
  }
  if (tier >= 4) {                                   // legend badges sparkle
    const tw = Math.sin(tNow * 4 + key.length);
    if (tw > 0.2) { rect(-13, -6, 2, 1, '#ffffff'); rect(-13, -7, 1, 3, '#ffffff'); }
    if (tw < -0.2) { rect(11, 5, 2, 1, '#ffffff'); rect(12, 4, 1, 3, '#ffffff'); }
  }
  if (locked) {
    ctx.save(); ctx.globalAlpha = 0.76; rr(-13, -13, 26, 26, 6, '#0f141a'); ctx.restore();
    plasticBox(-5, -2, 10, 9, 2, ['#12100a', '#6a5a2a', '#a8902f', '#e0c455', '#fff0a0'], { noShine: 1 });
    rect(-3, -7, 6, 6, '#6a5a2a'); rect(-2, -6, 4, 5, '#0f141a');
    rect(-1, 1, 2, 3, '#4a3f16');
  }
  ctx.restore();
}

// ------------------------------------------------------------ tooth art ---
const TOOTH_STYLE = {
  plain: { a: '#fef9e6', b: '#e3d5ab', c: '#b1a078' },
  infected: { a: '#b8c87a', b: '#8a9a4e', c: '#5a6a2e', gem: '#7a3aa8', gemD: '#4a2068' },
  diamond: { a: '#eafcff', b: '#bfeef5', c: '#7fc6d9', gem: '#ffffff', gemD: '#9fe8ff' },
  amber: { a: '#f5d98a', b: '#dcb45a', c: '#a8823a', gem: '#c8641e', gemD: '#8a4010' },
  emerald: { a: '#d5f0d0', b: '#a8d8a0', c: '#6aa860', gem: '#2e9e4a', gemD: '#1a6a2e' },
  moonstone: { a: '#e8e8f8', b: '#c0c4e0', c: '#8a90b8', gem: '#b8c8ff', gemD: '#7a8ad8' },
  obsidian: { a: '#4a4454', b: '#332e3c', c: '#201c28', gem: '#8a78b0', gemD: '#5a4a80' },
  pearl: { a: '#fdf6ee', b: '#eadfd2', c: '#c0b0a0', gem: '#f0d8e8', gemD: '#c8a8c0' },
  crystal: { a: '#e0f4f8', b: '#b0dce8', c: '#78aec0', gem: '#ffffff', gemD: '#b0dce8' },
  honey: { a: '#f8c860', b: '#e0a438', c: '#a87418', gem: '#f8e8a0', gemD: '#c8a030' },
  fossil: { a: '#c0b49c', b: '#988c74', c: '#6a604c', gem: '#4a4030', gemD: '#302818' },
  wraith: { a: '#9caab8', b: '#6a7a8c', c: '#42505e', gem: '#c8e8f8', gemD: '#8098b0' },
  titan: { a: '#e8dcc8', b: '#c8b898', c: '#98886a', gem: '#d94f30', gemD: '#8a2a16' },
  gold: { a: '#ffe066', b: '#f0b429', c: '#a8781a', gem: '#fff6c8' },
  ruby: { a: '#fef9e6', b: '#e3d5ab', c: '#b1a078', gem: '#ff4d6a', gemD: '#a3162e' },
  sapph: { a: '#eaf6ff', b: '#bcdcf5', c: '#7ba6c9', gem: '#3f8cff', gemD: '#1e4fa3' },
  steel: { a: '#dfe8ec', b: '#aebfc7', c: '#77909b', gem: '#f4feff' },
  lucky: { a: '#e9fbe0', b: '#bfe8a8', c: '#7fb26a', gem: '#3fae4c' },
  rotten: { a: '#c9c99a', b: '#a3a368', c: '#6f7042', gem: '#4c5a23' },
  vamp: { a: '#fef9e6', b: '#e3d5ab', c: '#b1a078', gem: '#d92040' },
};

// A tooth sprite. up=true means crown points UP (bottom row), else DOWN.
function drawTooth(x, y, w, h, up, type, o) {
  o = o || {};
  const st = TOOTH_STYLE[type] || TOOTH_STYLE.plain;
  x |= 0; y |= 0; w |= 0; h |= 0;
  ctx.save();
  // integer translate: a half-pixel offset here blurs every tooth
  ctx.translate(x + Math.floor(w / 2), y + Math.floor(h / 2));
  if (!up) ctx.scale(1, -1);
  ctx.translate(-Math.floor(w / 2), -Math.floor(h / 2));
  const bodyC = o.pressedTint ? st.b : st.a;
  rr(-1, 0, w + 2, h, 3, o.outline || '#00000055');
  rr(0, 0, w, h - 3, 3, bodyC);
  rect(1, h - 4, Math.floor(w / 2) - 2, 4, bodyC);
  rect(w - Math.floor(w / 2) + 1, h - 4, Math.floor(w / 2) - 2, 4, bodyC);
  rect(w - 3, 2, 2, h - 6, st.b);
  rect(w - 2, 3, 1, h - 8, st.c);
  rect(2, h - 6, w - 5, 2, st.b);
  rect(2, 2, 2, Math.max(2, Math.floor(h / 3)), '#ffffff88');
  if (type === 'rotten') { rect(Math.floor(w / 2) - 1, 3, 3, 3, st.gem); rect(2, h - 9, 2, 2, st.gem); }
  if (type === 'vamp') { rect(Math.floor(w / 2) - 1, 0, 3, 3, st.gem); }
  if (st.gem && type !== 'rotten' && type !== 'vamp' && type !== 'gold' && type !== 'steel') {
    const gx = Math.floor(w / 2) - 2, gy = Math.floor(h / 2) - 4;
    rect(gx + 1, gy, 3, 1, st.gemD || st.gem); rect(gx, gy + 1, 5, 2, st.gem);
    rect(gx + 1, gy + 3, 3, 1, st.gemD || st.gem); rect(gx + 2, gy + 4, 1, 1, st.gemD || st.gem);
    rect(gx + 1, gy + 1, 1, 1, '#ffffffcc');
  }
  if (type === 'gold') { rect(2, Math.floor(h / 2) - 2, w - 4, 2, '#fff6c8aa'); }
  if (type === 'steel') { rect(2, Math.floor(h / 2) - 3, w - 4, 1, '#ffffffaa'); rect(2, Math.floor(h / 2) - 1, w - 4, 1, '#77909b'); }
  // x-ray overlay: skeletal negative with root (and the trap, if it is a snapper)
  if (o.xray) {
    rr(0, 0, w, h, 3, '#0a2440e6');
    const cxx = Math.floor(w / 2);
    rect(cxx - 1, 2, 2, h - 8, '#bfe8ff');
    rect(cxx - 3, h - 7, 2, 5, '#bfe8ff'); rect(cxx + 1, h - 7, 2, 5, '#bfe8ff');
    if (o.xraySnap) {
      rect(cxx - 3, Math.floor(h / 2) - 3, 6, 2, C.red);
      rect(cxx - 3, Math.floor(h / 2), 2, 2, C.red); rect(cxx + 1, Math.floor(h / 2), 2, 2, C.red);
    }
    // scan line sweep
    const sw = (o.xrayT * 2.4) % 1;
    ctx.globalAlpha = 0.85;
    rect(0, Math.floor(sw * (h - 1)), w, 1, '#8fe8ff');
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// ------------------------------------------------------ gator variants ----
// body tones a(base) b(dark) c(light) d(outline), maw colors, feature flags
const CROC_STYLES = {
  small: { a: '#5aa843', b: '#3c7c2e', c: '#8cd34f', d: '#295722', maw: '#4a1420', mawD: '#320b14', tongue: '#c94f63', tongueHi: '#e0778a', sclera: '#f8f4dc' },
  turtle: { a: '#8a9a4e', b: '#5c6a2e', c: '#b0bc6a', d: '#3a4420', maw: '#5a2a1a', mawD: '#3a1a0e', tongue: '#d0766a', tongueHi: '#e89a8a', sclera: '#f8f4dc', shell: true, sleepy: true },
  lilgator: { a: '#6cbe4c', b: '#4a9636', c: '#9ce85c', d: '#2e6322', maw: '#4a1420', mawD: '#320b14', tongue: '#c94f63', tongueHi: '#e0778a', sclera: '#f8f4dc', baby: true },
  big: { a: '#4e8f3d', b: '#2f6626', c: '#79b944', d: '#1f4519', maw: '#40101c', mawD: '#2a0a12', tongue: '#b8455a', tongueHi: '#d06a7c', sclera: '#f0e8c8', scars: true, ridge: true },
  twofang: { a: '#57755a', b: '#3a523e', c: '#7d9a80', d: '#263a2a', maw: '#3a0e18', mawD: '#260810', tongue: '#b8455a', tongueHi: '#d06a7c', sclera: '#f0e0c0', fangs: true, scars: true },
  murky: { a: '#7a6a40', b: '#584a28', c: '#9c8c58', d: '#3a3018', maw: '#3a2010', mawD: '#281408', tongue: '#a86040', tongueHi: '#c08058', sclera: '#d8d0a8', algae: true, sleepy: true },
  cotton: { a: '#b8b0a0', b: '#8c8474', c: '#d8d0c0', d: '#5a5448', maw: '#f0ece0', mawD: '#c8c2b2', tongue: '#e08898', tongueHi: '#f0aab8', sclera: '#fff', paleMaw: true },
  lockjaw: { a: '#6a8a5a', b: '#48633c', c: '#8fae7c', d: '#2e4426', maw: '#4a1420', mawD: '#320b14', tongue: '#c94f63', tongueHi: '#e0778a', sclera: '#f0e8c8', brace: true },
  loanshark: { a: '#3a8a8a', b: '#256060', c: '#5cb0ac', d: '#173e3e', maw: '#3a1024', mawD: '#280a18', tongue: '#c94f63', tongueHi: '#e0778a', sclera: '#f8f4dc', hat: true, goldTooth: true },
  ironjaw: { a: '#707a82', b: '#4c545c', c: '#98a2aa', d: '#30363c', maw: '#38141c', mawD: '#240c12', tongue: '#a84858', tongueHi: '#c06a78', sclera: '#e0e0d8', metal: true },
  tender: { a: '#6aa060', b: '#477043', c: '#92c688', d: '#2c4a28', maw: '#78243a', mawD: '#521626', tongue: '#e87890', tongueHi: '#f89cb0', sclera: '#f8f4dc', bandage: true, teary: true },
  diet: { a: '#8a9a78', b: '#647250', c: '#aebc9c', d: '#42503a', maw: '#4a2430', mawD: '#321820', tongue: '#b06a78', tongueHi: '#c88a96', sclera: '#e8e8d0', skinny: true },
  restless: { a: '#6a5a8a', b: '#484060', c: '#8f7cae', d: '#2e2844', maw: '#38102a', mawD: '#240a1c', tongue: '#b8455a', tongueHi: '#d06a7c', sclera: '#e8c8c8', redEye: true, bags: true },
  king: { a: '#4a7a3a', b: '#305424', c: '#74a858', d: '#1e3a16', maw: '#4a1420', mawD: '#320b14', tongue: '#c94f63', tongueHi: '#e0778a', sclera: '#f0e8c8', crown: true, moss: true },
  mudcake: { a: '#8a6a3a', b: '#644a24', c: '#a88c54', d: '#40300f', maw: '#3a2410', mawD: '#281808', tongue: '#a86040', tongueHi: '#c08058', sclera: '#d8d0a8', mudDrips: true },
  shellback: { a: '#6a8a4a', b: '#486030', c: '#8fae68', d: '#2e401e', maw: '#4a2810', mawD: '#321a08', tongue: '#c98a63', tongueHi: '#e0aa8a', sclera: '#f0e8c8', shell: true },
  albino: { a: '#e0d4cc', b: '#b8a89e', c: '#f4ece6', d: '#8a7a70', maw: '#e88898', mawD: '#c06878', tongue: '#f0a8b8', tongueHi: '#f8c8d4', sclera: '#ffe8e8', redEye: true, paleMaw: true },
  twin: { a: '#3a6a72', b: '#26484e', c: '#5a929c', d: '#142a30', maw: '#301024', mawD: '#1e0a16', tongue: '#b8455a', tongueHi: '#d06a7c', sclera: '#e8e8d0', twinEyes: true, ridge: true },
  gold: { a: '#d8b842', b: '#a8882a', c: '#f0d868', d: '#7a6014', maw: '#5a3010', mawD: '#3e2008', tongue: '#e0a050', tongueHi: '#f0c078', sclera: '#fff6dc', goldTooth: true },
  phantom: { a: '#7a9aa8', b: '#5a7684', c: '#a8c4d0', d: '#3a5260', maw: '#28404c', mawD: '#182c36', tongue: '#5a8494', tongueHi: '#7aa4b4', sclera: '#d8f4ff', sleepy: true },
  junkjaw: { a: '#9a6a4a', b: '#6f4a30', c: '#c08a5e', d: '#4a3020', maw: '#3a1c14', mawD: '#28120c', tongue: '#a85848', tongueHi: '#c07860', sclera: '#e8d8c0', metal: true, scars: true },
  bogqueen: { a: '#8a5a9a', b: '#623e70', c: '#b07cc4', d: '#3e2848', maw: '#3a1030', mawD: '#280a20', tongue: '#c94f8a', tongueHi: '#e077aa', sclera: '#f4e8ff', crown: true, bags: true },
  apexpred: { a: '#2e3a34', b: '#1c2620', c: '#48584e', d: '#0e1612', maw: '#2e0810', mawD: '#1c040a', tongue: '#8a3040', tongueHi: '#a84858', sclera: '#e8d0c0', redEye: true, scars: true, fangs: true, ridge: true },
};
// SHARK styles for the MALDIVES summer stage (grey-blue hide, pale bellies)
const SHARK_STYLES = {
  reef: { a: '#7fa8c0', b: '#547e98', c: '#a8ccdc', d: '#3a5c72', maw: '#8a3a4e', mawD: '#5e2434', tongue: '#e0778a', tongueHi: '#f0a0b0', sclera: '#f4f8fc', shark: true },
  tiger: { a: '#5f8296', b: '#3e5c6e', c: '#89aebe', d: '#2a4250', maw: '#7a2f42', mawD: '#521e2c', tongue: '#d06578', tongueHi: '#e890a0', sclera: '#eef4f8', shark: true, scars: true, ridge: true },
  mega: { a: '#42555f', b: '#2c3c44', c: '#66808c', d: '#1a262c', maw: '#5e1e2c', mawD: '#3e121c', tongue: '#a84858', tongueHi: '#c06a78', sclera: '#e8f0f4', shark: true, fangs: true, scars: true, ridge: true, redEye: true },
};
// CROC / SHARK MUTATIONS: rare variants Professor Manta wants photographed.
// tint overrides some hide colors; deco adds a signature feature in drawCroc;
// sizeMul scales the whole maw (body follows); teeth adds mouth slots.
const MUTATIONS = {
  diamond: { name: 'DIAMOND', col: '#9fe8ff', rar: 4, tint: { a: '#8fd6ea', b: '#5fa8c8', c: '#cbf4ff', sclera: '#eafcff' }, flav: 'A hide of living crystal.' },
  dwarf: { name: 'DWARF', col: '#a8e078', rar: 2, sizeMul: 0.72, tint: { a: '#8fd85e', b: '#5fa838', c: '#c0f088', d: '#3a7a24' }, flav: 'Tiny, grumpy, adorable.' },
  extra: { name: 'EXTRA-TOOTHED', col: '#e8d060', rar: 3, teeth: 4, tint: { a: '#c8b24a', b: '#94802c', c: '#e8d878', d: '#5e5018' }, flav: 'Simply too many teeth.' },
  mega: { name: 'MEGA', col: '#ff9048', rar: 4, sizeMul: 1.26, tint: { a: '#3e5e30', b: '#26401c', c: '#5e8a44', d: '#14260e' }, flav: 'A jaw that blots the sun.' },
  alien: { name: 'ALIEN', col: '#9cff8c', rar: 5, tint: { a: '#5fbf52', b: '#3a8a3a', c: '#a8ff9c', d: '#245a24', sclera: '#0c0c14' }, flav: 'Not from this swamp.' },
  spotted: { name: 'SPOTTED', col: '#d8a850', rar: 2, tint: { a: '#c69a4e', b: '#94702e', c: '#e8c878', d: '#5e461e' }, flav: 'Freckled snout to tail.' },
  striped: { name: 'STRIPED', col: '#e88038', rar: 3, tint: { a: '#c86a2e', b: '#94481c', c: '#e89a52', d: '#5e2e10' }, flav: 'Warpaint from the bog.' },
  albino: { name: 'ALBINO', col: '#f4ece6', rar: 4, tint: { a: '#e8dcd4', b: '#c0b0a6', c: '#f6efe9', d: '#8a7a70', maw: '#e88898', mawD: '#c06878', sclera: '#ffe8e8', redEye: true, paleMaw: true }, flav: 'Pale as moonlit water.' },
  // ---- SHOP-AFFECTING mutations: beating one of these salts the next shop's
  // badges with a special EDITION (and a little discount). Swamp-run only.
  gilded: { name: 'GILDED', col: '#ffcf4a', rar: 3, tint: { a: '#d8a838', b: '#a8791a', c: '#ffe08a', d: '#6e4e10', sclera: '#fff4d0' }, flav: 'Dipped in swamp gold.', shop: { ed: 'golden', disc: 0.85, note: 'GOLDEN badges next shop!' } },
  glacial: { name: 'GLACIAL', col: '#bfefff', rar: 4, tint: { a: '#a8dcf0', b: '#6fb0d0', c: '#e6faff', d: '#3a7088', sclera: '#eafcff' }, flav: 'Frozen since the ice age.', shop: { ed: 'diamond', disc: 0.9, note: 'DIAMOND badges next shop!' } },
  corroded: { name: 'CORRODED', col: '#c07038', rar: 2, tint: { a: '#9a5e2e', b: '#6e401c', c: '#c88a4e', d: '#3e240e' }, flav: 'Rust never sleeps.', shop: { ed: 'rusty', disc: 0.7, note: 'RUSTY badges, 30% off!' } },
};
const MUT_ORDER = ['diamond', 'dwarf', 'extra', 'mega', 'alien', 'spotted', 'striped', 'albino'];
// ---- SPECIAL CROC ABILITIES + how rare each variant is ---------------------
// tier drives the roll weight: 0 common ... 4 SUPER RARE. Each variant now
// actually changes the fight, and Merle explains it when you meet one.
const MUT_ABIL = {
  spotted: { tier: 0, tag: 'KEEN EYES', name: 'KEEN EYES', desc: '+1 X-RAY for this round' },
  dwarf: { tier: 0, tag: 'TINY TERROR', name: 'TINY TERROR', desc: '2 fewer teeth, but every bite starts at +6 MULT' },
  extra: { tier: 1, tag: 'OVERCROWDED', name: 'OVERCROWDED', desc: '4 extra teeth crammed into the maw' },
  striped: { tier: 1, tag: 'WARPAINT', name: 'WARPAINT', desc: 'The MULT chain grows +1 EXTRA on every press' },
  corroded: { tier: 1, tag: 'RUST HOARD', name: 'RUST HOARD', desc: 'Next shop stocks RUSTY badges, 30% off' },
  diamond: { tier: 2, tag: 'HARD ENAMEL', name: 'CRYSTAL ENAMEL', desc: 'Every tooth is worth +2 TEETH' },
  mega: { tier: 2, tag: 'COLOSSAL', name: 'COLOSSAL', desc: 'Target +25%, but the cash reward DOUBLES' },
  gilded: { tier: 2, tag: 'GOLD HOARD', name: 'GILDED HOARD', desc: 'Next shop stocks GOLDEN badges' },
  albino: { tier: 3, tag: 'PALE OMEN', name: 'PALE OMEN', desc: 'The first SNAPPER you press is defused' },
  glacial: { tier: 3, tag: 'DEEP FREEZE', name: 'DEEP FREEZE', desc: 'Next shop stocks DIAMOND badges' },
  alien: { tier: 4, tag: 'OTHERWORLDLY', name: 'NOT OF THIS SWAMP', desc: 'X2 MULT on every bank!' },
};
const MUT_TIER_NAME = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'SUPER RARE'];
const MUT_TIER_COL = ['#9ab8a8', '#7fd4e8', '#c8a8f8', '#ffb060', '#ff6a9a'];
const MUT_TIER_W = [100, 26, 6, 1.2, 0.18]; // super rares are a genuine event
const mutIs = id => G.mut === id;
const mutTier = id => (MUT_ABIL[id] ? MUT_ABIL[id].tier : 0);
// weighted pick across every variant this stage allows (null = plain croc).
// Special crocs are RARE: the vast majority of the swamp is plain gators.
function rollMutation(allowShop) {
  if (rnd() >= 0.14) return null; // ~86% of crocs are just crocs
  const pool = MUT_ORDER.concat(allowShop ? SHOP_MUTS : []);
  const wts = pool.map(k => MUT_TIER_W[mutTier(k)] || 1);
  let r = rnd() * wts.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) { r -= wts[i]; if (r <= 0) return pool[i]; }
  return pool[0];
}
// shop mutations roll on swamp crocs only; kept out of MUT_ORDER so the summer
// photo album / Professor Manta collectibles stay the 8 above.
const SHOP_MUTS = ['gilded', 'glacial', 'corroded'];
// BADGE EDITIONS - a badge can carry one of these finishes on top of its normal
// effect (Balatro-style). golden pays $ every round; diamond adds an X-MULT at
// bank; rusty is worn + cheap but dumps flat TEETH at bank.
const EDITIONS = {
  golden: { name: 'GOLDEN', col: '#ffcf4a', edge: '#8a5e10', gem: '#fff0b0', tag: '+$4/RND', desc: 'Earns +$4 at the end of every round', dp: 3, dm: 0.82 },
  diamond: { name: 'DIAMOND', col: '#8fe8ff', edge: '#2f6f90', gem: '#e6faff', tag: 'X1.5 MULT', desc: 'X1.5 MULT every time you bank', dp: 5, dm: 1 },
  rusty: { name: 'RUSTY', col: '#c07038', edge: '#4e2410', gem: '#e8b070', tag: '+40 TEETH', desc: '+40 TEETH at bank, but worn and cheap', dp: -2, dm: 0.6 },
};
const EDITION_KEYS = ['golden', 'diamond', 'rusty'];
const edOf = c => (c && c.ed && EDITIONS[c.ed]) ? c.ed : null;
const mutSizeMul = () => (G.mut && MUTATIONS[G.mut] && MUTATIONS[G.mut].sizeMul) || 1;
// the round-0 "small" node is a lil baby gator (smaller body + mouth, see mouthLayout)
function lilGator() { return G.state !== 'menu' && G.round === 0 && G.nodeType === 'small'; }
function baseCrocStyle() {
  if (G.state === 'menu') { // the title mascot cycles through random variants
    const ml = G.menuLook;
    if (ml && ml.nodeType === 'gold') return CROC_STYLES.gold;
    if (ml && ml.round === 1) return CROC_STYLES.big;
    return CROC_STYLES.small;
  }
  if (G.summer) { // the summer stage is sharks
    if (G.round === 2) return SHARK_STYLES.mega;
    if (G.round === 1) return SHARK_STYLES.tiger;
    return SHARK_STYLES.reef;
  }
  if (G.round === 2 && G.boss) return CROC_STYLES[G.boss.id] || CROC_STYLES.big;
  if (G.nodeType === 'gold') return CROC_STYLES.gold;
  if (G.round === 1) return CROC_STYLES.big;
  if (lilGator()) return CROC_STYLES.lilgator;
  return CROC_STYLES.small;
}
function crocStyle() {
  const base = baseCrocStyle();
  const mut = G.state === 'menu' ? (G.menuLook && G.menuLook.mut) : G.mut;
  if (mut && MUTATIONS[mut]) return Object.assign({}, base, MUTATIONS[mut].tint || {}, { mut });
  return Object.assign({}, base, { mut: null });
}

// ------------------------------------------------------------ game data ---

// ---------------------------------------------------------- croc moods ----
// The gator reacts to the fight instead of staring blankly: it sizes you up,
// gets cocky when you are far from target, narrows its eyes as you close in,
// and flinches when a snapper goes off.  Each mood is a set of dials the eye
// and jaw code reads.
const CROC_MOODS = {
  calm:    { brow: 0, open: 1, pupil: 1, squint: 0, tilt: 0 },
  smug:    { brow: -1, open: 0.72, pupil: 0.85, squint: 0.3, tilt: 0.04 },
  hungry:  { brow: 1, open: 1.12, pupil: 1.35, squint: 0, tilt: -0.03, quiver: 1 },
  angry:   { brow: 2, open: 0.8, pupil: 0.7, squint: 0.55, tilt: 0 },
  worried: { brow: -2, open: 1.18, pupil: 1.45, squint: 0, tilt: 0.02 },
  shocked: { brow: -3, open: 1.3, pupil: 1.6, squint: 0, tilt: 0 },
  hurt:    { brow: 2, open: 0, pupil: 1, squint: 1, tilt: 0.06, cross: 1 },
  sleepy:  { brow: 0, open: 0.4, pupil: 0.9, squint: 0.8, tilt: 0.03 },
};
let crocMoodHold = { m: 'calm', t: 0 };
function crocMood(dt) {
  let m = 'calm';
  const st = crocStyle();
  if (G.state === 'snap') m = 'angry';
  else if (flashRed > 0.08) m = 'hurt';
  else if (G.state === 'menu') m = (tNow % 11) < 3 ? 'smug' : 'calm';
  else if (st && st.sleepy) m = 'sleepy';
  else if (G.state === 'play' || G.state === 'swap') {
    const f = G.target > 0 ? G.score / G.target : 0;
    if (f >= 0.95) m = 'shocked';
    else if (f >= 0.6) m = 'worried';
    else if (G.bites <= 1) m = 'angry';
    else if (G.round === 2 && G.boss) m = 'angry';
    else if (f < 0.12 && G.roundPressed > 2) m = 'smug';
    else m = 'hungry';
  }
  // hold a mood briefly so it cannot strobe between frames
  if (m !== crocMoodHold.m) {
    crocMoodHold.t += dt || 0.016;
    if (crocMoodHold.t > 0.25 || m === 'hurt' || m === 'angry') { crocMoodHold.m = m; crocMoodHold.t = 0; }
  } else crocMoodHold.t = 0;
  return CROC_MOODS[crocMoodHold.m] || CROC_MOODS.calm;
}

const TOOTH_DEFS = {
  plain: { name: 'TOOTH', base: 3, desc: 'A plain tooth. Adds its value to Teeth.', flav: 'Brushed twice a day, allegedly.' },
  infected: { name: 'INFECTED TOOTH', base: 0, cost: 3, desc: '+8 MULT when pressed', flav: 'Do not look at it too long.' },
  diamond: { name: 'DIAMOND TOOTH', base: 15, cost: 6, desc: 'A dazzling +15 TEETH', flav: 'The swamp jeweler wept.' },
  gold: { name: 'GOLD TOOTH', base: 3, cost: 3, desc: 'Earn $2 when pressed', flav: 'The swamp dentist retirement plan.' },
  ruby: { name: 'RUBY TOOTH', base: 2, cost: 3, desc: '+4 MULT when pressed', flav: 'Bites back with style.' },
  sapph: { name: 'SAPPHIRE TOOTH', base: 12, cost: 4, desc: 'A hefty +12 TEETH', flav: 'Dense. Very dense.' },
  steel: { name: 'STEEL TOOTH', base: 2, cost: 4, desc: 'X1.5 MULT when pressed', flav: 'Forged in a bog-side smithy.' },
  lucky: { name: 'LUCKY TOOTH', base: 2, cost: 3, desc: '1 IN 3 chance: +5 MULT', flav: 'Found under a swamp pillow.' },
  rotten: { name: 'ROTTEN TOOTH', base: 0, cost: 2, desc: '+6 MULT when pressed', flav: 'Smells awful. Scores great.' },
  vamp: { name: 'VAMPIRE FANG', base: 4, cost: 4, desc: '+2 TEETH for each tooth pressed before it this bite', flav: 'It vants to count your clicks.' },
  // ---- higher-rarity teeth ----
  amber: { name: 'AMBER TOOTH', base: 5, cost: 5, rar: 2, desc: '+2 MULT and +$1 when pressed', flav: 'There is a bug in it. He helps.' },
  emerald: { name: 'EMERALD TOOTH', base: 4, cost: 5, rar: 2, desc: '+3 MULT when pressed', flav: 'Swamp-grown, cave-polished.' },
  moonstone: { name: 'MOONSTONE TOOTH', base: 2, cost: 5, rar: 2, desc: '+1 X-RAY when pressed', flav: 'It hums at high tide.' },
  obsidian: { name: 'OBSIDIAN TOOTH', base: 8, cost: 7, rar: 3, desc: '+8 TEETH. Its value cannot be reduced', flav: 'Volcano leftovers.' },
  pearl: { name: 'PEARL TOOTH', base: 6, cost: 7, rar: 3, desc: '+10 extra TEETH if pressed FIRST in a bite', flav: 'The oyster wants it back.' },
  crystal: { name: 'CRYSTAL TOOTH', base: 0, cost: 7, rar: 3, desc: 'Copies the value of the previously pressed tooth', flav: 'A perfect mimic.' },
  honey: { name: 'HONEY TOOTH', base: 3, cost: 7, rar: 3, desc: 'The NEXT tooth pressed gives double TEETH', flav: 'Sticky in the best way.' },
  fossil: { name: 'FOSSIL TOOTH', base: 10, cost: 8, rar: 4, desc: '+10 TEETH, but the MULT chain does not grow', flav: 'Older than the swamp itself.' },
  wraith: { name: 'WRAITH FANG', base: 0, cost: 8, rar: 4, desc: '+12 MULT when pressed, but costs $1', flav: 'It whispers percentages.' },
  titan: { name: 'TITAN TOOTH', base: 20, cost: 12, rar: 5, desc: 'A colossal +20 TEETH', flav: 'From a jaw the size of a bus.' },
};
const SHOP_TEETH = ['gold', 'ruby', 'sapph', 'steel', 'lucky', 'rotten', 'vamp'];
// pack pull table: [type, weight] - boost multiplies high-rarity weights
const TOOTH_PULLS = [
  ['gold', 10], ['ruby', 10], ['sapph', 9], ['steel', 9], ['lucky', 9], ['rotten', 9], ['vamp', 9],
  ['amber', 5], ['emerald', 5], ['moonstone', 5],
  ['obsidian', 2.4], ['pearl', 2.4], ['crystal', 2.4], ['honey', 2.4],
  ['fossil', 1.1], ['wraith', 1.1], ['diamond', 1.1],
  ['titan', 0.35],
];
const GEM_TEETH = ['ruby', 'sapph', 'diamond', 'amber', 'emerald', 'moonstone', 'pearl', 'crystal'];

const CHARMS = [
  { id: 'sweet', name: 'SWEET TOOTH', cost: 4, rar: 0, ico: 'candy', desc: '+1 extra MULT for every tooth pressed this bite', flav: 'The gator has a candy problem.' },
  { id: 'overbite', name: 'OVERBITE', cost: 4, rar: 0, ico: 'tooth', desc: 'First tooth of each bite gives +12 TEETH', flav: 'Start strong, bite stronger.' },
  { id: 'greedy', name: 'GREEDY GATOR', cost: 5, rar: 0, ico: 'coin', desc: 'Earn $1 for every 4 teeth pressed', flav: 'Every molar is a money-maker.' },
  { id: 'magnet', name: 'MOLAR MAGNET', cost: 4, rar: 0, ico: 'magnet', desc: '+15 TEETH when you bank', flav: 'Attracts calcium and compliments.' },
  { id: 'babyfangs', name: 'BABY FANGS', cost: 5, rar: 0, ico: 'heart', desc: 'Teeth of value 2 or less give +4 MULT', flav: 'Small teeth, big feelings.' },
  { id: 'crown', name: 'GOLD CROWN', cost: 5, rar: 0, ico: 'crown', desc: 'Gold Teeth earn double money and +5 TEETH', flav: 'Fit for swamp royalty.' },
  { id: 'license', name: 'DENTIST LICENSE', cost: 5, rar: 0, ico: 'eye', desc: '+1 X-RAY every round', flav: 'Framed. Probably real.' },
  { id: 'fairy', name: 'TOOTH FAIRY', cost: 5, rar: 0, ico: 'fairy', desc: 'Earn $2 at the end of every round', flav: 'She works the swamp shift now.' },
  { id: 'tinfang', name: 'TIN FANG', cost: 5, rar: 0, ico: 'shield', desc: 'Plain teeth give double TEETH', flav: 'Cheap alloy, honest work.' },
  { id: 'snaggle', name: 'SNAGGLETOOTH', cost: 4, rar: 0, ico: 'money', desc: 'CLEAN SWEEP also pays +$5', flav: 'Crooked tooth, straight cash.' },
  { id: 'numb', name: 'NUMBING GEL', cost: 7, rar: 1, ico: 'syringe', desc: 'The first SNAP each round is defused', flav: 'You will feel a little pressure.' },
  { id: 'glass', name: 'GLASS JAW', cost: 6, rar: 1, ico: 'skull', desc: 'X2 MULT when banking, but -1 BITE every round', flav: 'Fragile. Furious. Effective.' },
  { id: 'rootcanal', name: 'ROOT CANAL', cost: 7, rar: 1, ico: 'drill', desc: 'Bank with 7+ teeth pressed: X2 MULT', flav: 'Deep work pays deep.' },
  { id: 'chewtoy', name: 'CHEW TOY', cost: 6, rar: 1, ico: 'heart', desc: '+1 BITE every round', flav: 'Squeaks to distract the gator.' },
  { id: 'coldblood', name: 'COLD BLOOD', cost: 6, rar: 1, ico: 'snow', desc: '+3 starting MULT for each snap tooth hidden in the mouth', flav: 'Danger keeps you focused.' },
  { id: 'collector', name: 'FANG COLLECTOR', cost: 7, rar: 1, ico: 'star', desc: 'CLEAN SWEEP bonus becomes X2 MULT (instead of X1.25)', flav: 'One of every kind, thanks.' },
  { id: 'loose', name: 'LOOSE TOOTH', cost: 6, rar: 1, ico: 'pliers', desc: '1 in 3 chance a pressed snap tooth pops out harmlessly', flav: 'Wiggle room, literally.' },
  { id: 'braces', name: 'BRACES', cost: 6, rar: 1, ico: 'gem', desc: '+2 teeth in every mouth', flav: 'Two more years, two more teeth.' },
  { id: 'mirror', name: 'MIRROR MOLAR', cost: 6, rar: 1, ico: 'mirror', desc: '+2 starting MULT for each special tooth in the mouth', flav: 'Reflects well on your deck.' },
  { id: 'goldrush', name: 'GOLD RUSH', cost: 6, rar: 1, ico: 'bolt', desc: '+1 TEETH per $ held when banking (max +30)', flav: 'Wealth you can chew on.' },
  { id: 'slowbite', name: 'PATIENT JAWS', cost: 6, rar: 1, ico: 'hourglass', desc: '+8 TEETH per unpressed tooth when you bank', flav: 'Restraint is a flavor.' },
  { id: 'swampheart', name: 'SWAMP HEART', cost: 7, rar: 1, ico: 'mud', desc: 'The first SNAP each round refunds its bite', flav: 'The bog forgives. Once.' },
  { id: 'wisdom', name: 'WISDOM TOOTH', cost: 8, rar: 2, ico: 'gem', desc: 'Every bite starts with +MULT equal to your ANTE', flav: 'It knows things.' },
  { id: 'apex', name: 'APEX INSTINCT', cost: 9, rar: 2, ico: 'fang', desc: 'X3 MULT when banking with 8+ teeth pressed', flav: 'Eat like nothing can eat you.' },
  { id: 'echo', name: 'ECHO CHOMP', cost: 8, rar: 2, ico: 'moonic', desc: '1 in 4 chance a pressed tooth counts twice', flav: 'chomp. Chomp. CHOMP.' },
  { id: 'bloodpact', name: 'BLOOD PACT', cost: 8, rar: 2, ico: 'snake', desc: 'X3 MULT when banking, but each bank costs $2', flav: 'Sign on the dotted fang.' },
  { id: 'venom', name: 'VENOM GLAND', cost: 8, rar: 2, ico: 'bottle', desc: '+1 starting MULT per 2 teeth pressed this round', flav: 'It builds up in your system.' },
  // ---- Swamp Pass unlockables (join the shop pool once their tier is reached)
  // ---- unique-mechanic charms: rar 3 EPIC, 4 LEGENDARY, 5 MYTHICAL ----
  { id: 'feast', name: 'FEEDING FRENZY', cost: 7, rar: 1, ico: 'bolt', desc: 'Press 3 teeth within 1.5 seconds: +6 MULT', flav: 'Chew fast, think later.' },
  { id: 'dentures', name: 'SPARE DENTURES', cost: 7, rar: 1, ico: 'tooth', desc: 'Once per round, a snapped bite banks HALF its pool instead of losing it', flav: 'Grandpa left you these.' },
  { id: 'gambit', name: 'GATOR GAMBIT', cost: 9, rar: 2, ico: 'trap', tier: 10, desc: 'Bank with exactly 2 snappers still hidden: X2.5 MULT', flav: 'Dance where the traps are.' },
  { id: 'compound', name: 'COMPOUND JAW', cost: 9, rar: 2, ico: 'drill', desc: '+1 permanent starting MULT every time you bank (while held)', flav: 'It remembers every bite.' },
  { id: 'kingmaker', name: 'KINGMAKER', cost: 11, rar: 3, ico: 'crown', desc: '+2 BITES during BOSS rounds', flav: 'Crowns are chewed, not given.' },
  { id: 'prism', name: 'PRISM BADGE', cost: 10, rar: 3, ico: 'gem', desc: 'Gem teeth give +2 extra MULT when pressed', flav: 'Light bends. Scores multiply.' },
  { id: 'undertow', name: 'UNDERTOW', cost: 10, rar: 3, ico: 'moonic', desc: 'After each bank, the FIRST press of your next bite counts twice', flav: 'The river pulls twice.' },
  { id: 'chum', name: 'CHUM BUCKET', cost: 10, rar: 3, ico: 'mud', desc: 'Defused snappers give +15 TEETH to your pool', flav: 'Waste not the dangerous parts.' },
  { id: 'jackpot', name: 'JACKPOT JAW', cost: 14, rar: 4, ico: 'star', tier: 12, desc: 'Bank with EXACTLY 7 presses: X5 MULT', flav: 'Seven teeth. Says so on the machine.' },
  { id: 'ouroboros', name: 'TAIL EATER', cost: 15, rar: 4, ico: 'snake', tier: 14, desc: 'After a CLEAN SWEEP, your next mouth KEEPS the whole MULT chain', flav: 'The bite that never ends.' },
  { id: 'hoard', name: 'DRAGON HOARD', cost: 13, rar: 4, ico: 'coin', tier: 15, desc: 'Interest cap removed, and interest pays $1 per $4 held', flav: 'Sleep on gold, bite like it too.' },
  // ---- gacha-pon exclusive badges (tier = capsule rarity bucket) ----
  { id: 'airfan', name: 'AIRBOAT FAN', cost: 5, rar: 1, ico: 'bolt', tier: 2, desc: '+1 BITE against EASY gators', flav: 'Loud enough to wake the swamp.' },
  { id: 'baitbucket', name: 'BAIT BUCKET', cost: 5, rar: 1, ico: 'mud', tier: 4, desc: '+$1 every time you bank a bite', flav: 'Wriggly money.' },
  { id: 'mosquitonet', name: 'MOSQUITO NET', cost: 6, rar: 1, ico: 'shield', tier: 6, desc: '+1 X-RAY every round', flav: 'See clearly, itch less.' },
  { id: 'duckcall', name: 'DUCK CALL', cost: 5, rar: 1, ico: 'star', tier: 8, desc: '+$3 after every swamp mini-game', flav: 'Quack responsibly.' },
  { id: 'gumbo', name: 'SWAMP GUMBO', cost: 7, rar: 2, ico: 'heart', tier: 10, desc: 'Round targets are 8% smaller', flav: 'Fortifies the spirit.' },
  { id: 'rangerpin', name: 'RANGER PIN', cost: 6, rar: 2, ico: 'crown', tier: 11, desc: '+3 SCOUT COOKIES after every boss you beat', flav: 'Polished nightly.' },
  { id: 'fireflyjar', name: 'FIREFLY JAR', cost: 6, rar: 2, ico: 'gem', tier: 12, desc: '+2 X-RAYS during BOSS rounds', flav: 'Borrowed light. Return it.' },
  { id: 'tacklecharm', name: 'TACKLE CHARM', cost: 5, rar: 1, ico: 'trap', tier: 13, desc: 'Shop rerolls start $1 cheaper', flav: 'Hooks, lines and sinkers.' },
  { id: 'airhorn', name: 'AIR HORN', cost: 7, rar: 2, ico: 'skull', tier: 14, desc: '+1 BITE during BOSS rounds', flav: 'HONK. The boss blinked.' },
  { id: 'goldgrill', name: 'GOLD GRILL', cost: 8, rar: 2, ico: 'tooth', tier: 15, desc: 'GOLDEN gators pay +$5 extra', flav: 'Match their smile.' },
  // ---- nature & wildlife badges (gacha) ----
  { id: 'heronfeather', name: 'HERON FEATHER', cost: 4, rar: 0, ico: 'eye', tier: 1, desc: '+1 X-RAY against SNAPPY GATORS', flav: 'Sharp eyes molt off.' },
  { id: 'otterpaw', name: 'OTTER PAW', cost: 6, rar: 1, ico: 'coin', tier: 4, desc: 'CLEAN SWEEPS pay +$3', flav: 'Slippery little bonus.' },
  { id: 'cypressroot', name: 'CYPRESS ROOT', cost: 7, rar: 2, ico: 'tooth', tier: 6, desc: '+1 tooth in every mouth', flav: 'Everything grows in the glades.' },
  { id: 'dragonfly', name: 'DRAGONFLY WING', cost: 5, rar: 1, ico: 'bolt', tier: 9, desc: 'Mini-games pay +2 SCOUT COOKIES', flav: 'Four wings, no waiting.' },
  { id: 'owlfeather', name: 'OWL FEATHER', cost: 8, rar: 2, ico: 'eye', tier: 11, desc: 'One extra tooth comes pre-revealed each mouth', flav: 'It sees you press.' },
  { id: 'snailshell', name: 'SNAIL SHELL', cost: 6, rar: 1, ico: 'shield', tier: 13, desc: 'Round interest pays +$2 flat', flav: 'Compound patience.' },
  { id: 'leviathan', name: 'LEVIATHAN', cost: 22, rar: 5, ico: 'fang', desc: 'X2 MULT on every bank', flav: 'The swamp has a basement. It lives there.' },
  { id: 'foreverglades', name: 'FOREVERGLADES', cost: 24, rar: 5, ico: 'fairy', desc: '+1 BITE, +1 X-RAY and +$2 every round', flav: 'The park provides, forever.' },
  { id: 'millionfang', name: 'MILLION FANG', cost: 20, rar: 5, ico: 'shield', desc: '+1 TEETH per tooth in your deck when banking', flav: 'Strength in numbers. Specifically teeth.' },
  { id: 'lantern', name: 'FIREFLY LANTERN', cost: 5, rar: 0, ico: 'lantern', tier: 2, desc: 'Pressing an X-rayed SAFE tooth gives +2 MULT', flav: 'Little lights, big ideas.' },
  { id: 'canteen', name: 'SWAMP CANTEEN', cost: 4, rar: 0, ico: 'canteen', tier: 3, desc: 'Bank with 3 or fewer presses: +$3', flav: 'Sips of pure restraint.' },
  { id: 'skeeter', name: 'SKEETER CHARM', cost: 5, rar: 0, ico: 'skeeter', tier: 5, desc: 'Gold Teeth also give +4 MULT', flav: 'It bites the rich.' },
  { id: 'totem', name: 'GATOR TOTEM', cost: 7, rar: 1, ico: 'totem', tier: 6, desc: 'X1.5 MULT when banking against a BOSS', flav: 'Carved from a lost canoe.' },
  { id: 'hound', name: "HOUND'S TOOTH", cost: 7, rar: 1, ico: 'hound', tier: 7, desc: 'Chain MULT grows +2 after your 5th press each bite', flav: 'Loyal to long bites.' },
  { id: 'moonshine', name: 'MOONSHINE JUG', cost: 9, rar: 2, ico: 'moonshine', tier: 8, desc: '+1 BITE and +1 X-RAY every round', flav: 'Ranger fuel. Handle with care.' },
  // ---- SUMMER upgrades (beach flavor, everyday hooks) ----
  { id: 'suncharm', name: 'SUN CHARM', cost: 7, rar: 2, ico: 'bolt', desc: '+MULT equal to your X-RAYS left at the start of each mouth', flav: 'Soaks up rays, radiates points.' },
  { id: 'msgbottle', name: 'MESSAGE BOTTLE', cost: 5, rar: 1, ico: 'bottle', desc: 'Every 3rd bite you bank pays +$6', flav: 'The tide brings good news.' },
  { id: 'starfish', name: 'LUCKY STARFISH', cost: 7, rar: 2, ico: 'star', desc: 'CLEAN SWEEP adds +3 TEETH per tooth pressed', flav: 'Makes a wish on every sweep.' },
  { id: 'coconut', name: 'COCONUT', cost: 7, rar: 2, ico: 'shield', desc: 'Every 5th press in a bite gives +25 TEETH', flav: 'Crack it open for a payout.' },
  { id: 'palmfrond', name: 'PALM FROND', cost: 6, rar: 1, ico: 'gem', desc: '+2 MULT per 3 teeth pressed when you bank', flav: 'Sways in your favor.' },
  // ================= BUILD-AROUND BADGES: numbers get crazy =================
  // pricier than the everyday badges, but these are what runs are built on.
  { id: 'jurassic', name: 'JURASSIC PASS', cost: 16, rar: 3, ico: 'amberic', desc: '+10 MULT per AMBER in the mouth. Hold 5+ AMBER teeth in your deck: it becomes the T-REX HEAD - X5 MULT on every bank!', flav: 'Life, uh, finds a molar.' },
  { id: 'yardstick', name: 'YARDSTICK', cost: 10, rar: 2, ico: 'ruler', desc: '+MULT equal to your ANTE when you bank', flav: 'Measures up, every time.' },
  { id: 'tycoon', name: 'SWAMP TYCOON', cost: 12, rar: 2, ico: 'money', desc: '+1 MULT per $5 held when you bank', flav: 'Money talks. It says CHOMP.' },
  { id: 'domino', name: 'DOMINO RUN', cost: 12, rar: 3, ico: 'domino', desc: 'X2 MULT banking 3+ presses in never-decreasing value order', flav: 'Line them up, knock it down.' },
  { id: 'lowtide', name: 'LOW TIDE', cost: 12, rar: 2, ico: 'wave', desc: 'X2 MULT when you bank 3 or fewer presses', flav: 'Less water, more wallop.' },
  { id: 'highnoon', name: 'HIGH NOON', cost: 14, rar: 3, ico: 'sunic', desc: 'X3 MULT if your chain is 20+ MULT when you bank', flav: 'The swamp goes quiet at noon.' },
  { id: 'perfection', name: 'PERFECTIONIST', cost: 12, rar: 3, ico: 'medal', desc: 'X2 MULT if you used no X-rays this round', flav: 'Eyes closed. Heart open.' },
  { id: 'metronome', name: 'METRONOME', cost: 14, rar: 3, ico: 'metro', desc: 'The FIRST tooth of every bite triggers twice', flav: 'Tick, tock, CHOMP, CHOMP.' },
  { id: 'ricochet', name: 'RICOCHET', cost: 14, rar: 3, ico: 'bolt', desc: 'Every 4th press in a bite triggers twice', flav: 'Around the maw and back.' },
  { id: 'ferris', name: 'FERRIS JAW', cost: 12, rar: 3, ico: 'ferris', desc: 'Each bite starts with +1 MULT per press made last bite', flav: 'Round and round the gums go.' },
  { id: 'boomer', name: 'BOOMERANG', cost: 14, rar: 3, ico: 'boomerang', desc: 'Banking carries 25% of your TEETH into the next bite', flav: 'It always comes back.' },
  { id: 'daredevil', name: 'DAREDEVIL', cost: 12, rar: 3, ico: 'skull', desc: '+4 MULT per press while 2+ snappers are hidden', flav: 'Fear is a flavor enhancer.' },
  { id: 'snakecharm', name: 'SNAKE CHARMER', cost: 12, rar: 2, ico: 'flute', desc: 'Defused snappers give +10 MULT', flav: 'Sing the danger to sleep.' },
  { id: 'gemcutter', name: 'GEM CUTTER', cost: 12, rar: 2, ico: 'chisel', desc: 'GEM teeth give +6 extra TEETH when pressed', flav: 'Facets pay dividends.' },
  // ---- gacha build badges (capsule prizes) ----
  { id: 'insurance', name: 'SWAMP INSURANCE', cost: 8, rar: 1, ico: 'shield', tier: 16, desc: 'Getting SNAPPED pays $5 consolation', flav: 'Read the fine print. It bites.' },
  { id: 'filmreel', name: 'FILM REEL', cost: 10, rar: 2, ico: 'film', tier: 17, desc: '+3 MULT at bank per X-ray used this round', flav: 'Every scan is a keeper.' },
  { id: 'telescope', name: 'SPYGLASS', cost: 12, rar: 2, ico: 'scope', tier: 18, desc: 'X-rays also reveal a neighboring tooth', flav: 'Two teeth, one look.' },
  { id: 'minimalist', name: 'MINIMALIST', cost: 14, rar: 3, ico: 'tooth', tier: 19, desc: 'X2 MULT while your deck holds 16 or fewer teeth', flav: 'Less deck, more bite.' },
  { id: 'librarian', name: 'BOG LIBRARIAN', cost: 12, rar: 2, ico: 'book', tier: 20, desc: '+1 starting MULT per special tooth in your deck (max 15)', flav: 'Shhh. The molars are reading.' },
  { id: 'stampbook', name: 'STAMP BOOK', cost: 12, rar: 2, ico: 'stampic', tier: 21, desc: '+2 MULT at bank per shop visited this run', flav: 'Collect the whole swamp.' },
  { id: 'trophy', name: 'BOSS TROPHY', cost: 12, rar: 2, ico: 'trophyic', tier: 22, desc: '+8 TEETH at bank per boss beaten this run', flav: 'Mounted. Polished. Petty.' },
  { id: 'scrapbook', name: 'SCRAPBOOK', cost: 12, rar: 2, ico: 'mg_cam', tier: 23, desc: '+3 MULT at bank per mutation in your photo album', flav: 'Memories with teeth.' },
  { id: 'sugarrush', name: 'SUGAR RUSH', cost: 12, rar: 2, ico: 'candy', tier: 24, desc: 'After a CLEAN SWEEP the next mouth starts +2 TEETH per tooth', flav: 'The crash is worth it.' },
  { id: 'echofang', name: 'ECHO FANG', cost: 16, rar: 3, ico: 'fang', tier: 25, desc: 'Special teeth have a 1-in-3 chance to trigger twice', flav: 'Say it again, tooth.' },
  { id: 'anchorjaw', name: 'ANCHOR JAW', cost: 10, rar: 2, ico: 'anchoric', tier: 26, desc: 'X1.5 MULT against RISKY gators', flav: 'Heavy is the jaw.' },
  { id: 'lighthouse', name: 'LIGHTHOUSE', cost: 10, rar: 2, ico: 'lightic', tier: 27, desc: 'X-rayed SAFE teeth give +3 extra TEETH', flav: 'Guides bites home.' },
  { id: 'crabclaw', name: 'CRAB CLAW', cost: 10, rar: 2, ico: 'crabq', tier: 28, desc: 'Hermit crabs pay +3 extra and visit more often', flav: 'Pinch me, I am rich.' },
  { id: 'papercrane', name: 'PAPER CRANE', cost: 12, rar: 2, ico: 'crane', tier: 29, desc: 'CLEAN SWEEPS restore +1 X-RAY', flav: 'Folded from a dental chart.' },
  { id: 'hourhand', name: 'HOUR HAND', cost: 14, rar: 3, ico: 'clockic', tier: 30, desc: 'Your FIRST bank each round: X2 MULT', flav: 'Strike while the jaw is hot.' },
  { id: 'tightrope', name: 'TIGHTROPE', cost: 16, rar: 3, ico: 'ropeic', tier: 31, desc: 'X2.5 MULT banking with exactly 1 snapper hidden', flav: 'One wobble from glory.' },
];

const CONS = [
  { id: 'panorama', name: 'PANORAMA', cost: 4, ico: 'xrayic', need: 'bite', desc: 'Reveal every snap tooth in the current mouth', flav: 'Say cheese.' },
  { id: 'novocaine', name: 'NOVOCAINE', cost: 4, ico: 'syringe', need: 'bite', desc: 'Defuse the next snap in this mouth', flav: 'A little pinch, then nothing.' },
  { id: 'extract', name: 'EXTRACTION', cost: 3, ico: 'pliers', target: 'tooth', need: 'bite', desc: 'Drag onto a tooth to yank it out, risk free', flav: 'One good pull.' },
  { id: 'fluoride', name: 'FLUORIDE', cost: 3, ico: 'shield', need: 'bite', desc: '+25 TEETH added to your current bite', flav: 'Swish and swallow. Wait, no.' },
  { id: 'shot', name: 'ADRENALINE', cost: 5, ico: 'heart', need: 'round', desc: '+1 BITE this round', flav: 'Straight to the heart.' },
  { id: 'mudbath', name: 'MUD BATH', cost: 4, ico: 'mud', need: 'bite', desc: 'Swap in a fresh mouth without spending a bite', flav: 'Everyone relax.' },
  { id: 'fairydust', name: 'FAIRY DUST', cost: 5, ico: 'star', need: 'bite', desc: 'Double your current bite TEETH', flav: 'Do not inhale.' },
  { id: 'loupe', name: 'LOUPE', cost: 3, ico: 'eye', need: 'bite', desc: 'X-ray 3 random unknown teeth for free', flav: 'Squint professionally.' },
  { id: 'snack', name: 'GATOR SNACK', cost: 5, ico: 'candy', need: 'bite', desc: 'Remove one random snap tooth from this mouth', flav: 'A well-fed gator forgets a trap.' },
  { id: 'goldmolar', name: 'GOLD MOLAR', cost: 4, ico: 'coin', desc: 'Add a GOLD TOOTH to your deck', flav: 'Investment dentistry.' },
  { id: 'ambermolar', name: 'AMBER MOLAR', cost: 5, ico: 'amberic', desc: 'Add an AMBER TOOTH to your deck', flav: 'A bug is included. He pays rent.' },
  { id: 'rubymolar', name: 'RUBY MOLAR', cost: 4, ico: 'gem', desc: 'Add a RUBY TOOTH to your deck', flav: 'Sparkles when it bites.' },
  { id: 'polish', name: 'POLISH', cost: 4, ico: 'star', desc: 'Upgrade 3 random plain teeth by +2 value, permanently', flav: 'Buff till they blind.' },
  { id: 'cavity', name: 'CAVITY', cost: 4, ico: 'skull', desc: 'Remove the 2 weakest plain teeth from your deck', flav: 'Addition by subtraction.' },
  { id: 'roottonic', name: 'ROOT TONIC', cost: 6, ico: 'bottle', desc: 'ALL plain teeth in your deck gain +1 value', flav: 'Tastes like pond. Works like magic.' },
  { id: 'swampbrew', name: 'SWAMP BREW', cost: 2, ico: 'money', desc: 'Gain $3', flav: 'Legally distilled. Swamp-legal.' },
  // ---- Swamp Pass unlockables
  { id: 'compass', name: 'RANGER COMPASS', cost: 4, ico: 'compass', tier: 1, need: 'bite', desc: 'X-Ray every tooth in the TOP row', flav: 'North is wherever the teeth are.' },
  { id: 'firecracker', name: 'FIRECRACKER', cost: 6, ico: 'firecracker', tier: 4, need: 'bite', desc: 'Reveal ALL snappers, and defuse one of them', flav: 'The swamp bass drop.' },
];

const BOSSES = [
  { id: 'twofang', name: 'TWO-FANG', desc: '2 snap teeth in every mouth' },
  { id: 'murky', name: 'MURKY WATER', desc: 'X-Rays do not work this round' },
  { id: 'cotton', name: 'COTTON MOUTH', desc: 'Tooth values are hidden' },
  { id: 'lockjaw', name: 'LOCKJAW', desc: 'You cannot bank until 4+ teeth are pressed' },
  { id: 'loanshark', name: 'LOAN SHARK', desc: 'Banking costs $2' },
  { id: 'ironjaw', name: 'IRON JAW', desc: 'Chain MULT only grows every 2nd tooth' },
  { id: 'tender', name: 'TENDER GUMS', desc: '2 fewer teeth in every mouth' },
  { id: 'diet', name: 'PLAIN DIET', desc: 'Special teeth lose their powers' },
  { id: 'restless', name: 'THE RESTLESS', desc: 'Snap teeth relocate after every 3rd press' },
  { id: 'king', name: 'SWAMP KING', desc: '+2 teeth per mouth, but +1 snap tooth' },
  { id: 'mudcake', name: 'MUDCAKE', desc: 'Pressed teeth are worth half their TEETH value' },
  { id: 'shellback', name: 'SHELLBACK', desc: 'You cannot bank until 6+ teeth are pressed' },
  { id: 'albino', name: 'THE ALBINO', desc: 'X-Rays LIE 1 in 4 times' },
  { id: 'twin', name: 'TWO-TIMER', desc: 'You must bank at least TWICE to win the round' },
  { id: 'phantom', name: 'THE PHANTOM', desc: 'Your TEETH pool is hidden until you bank' },
  { id: 'junkjaw', name: 'JUNKJAW', desc: 'X-Rays cost $1 each' },
  { id: 'bogqueen', name: 'BOG QUEEN', desc: 'The snappers hide among the 3 highest-value teeth' },
];
const FINAL_BOSS = { id: 'apexpred', name: 'APEX PREDATOR', desc: '2 snap teeth, and only 1 X-Ray' };

// ------------------------------------------------------------ map nodes ---
const NODE_DEFS = {
  small: { name: 'SNAPPY GATOR', mult: 1, reward: 3, col: '#63d66a' },
  big: { name: 'RISKY GATOR', mult: 1.5, reward: 5, col: '#ff9838' },
  gold: { name: 'GOLDEN GATOR', mult: 1.9, reward: 8, col: '#ffc843' },
  event: { name: 'SWAMP EVENT', col: '#c07dff' },
  boss: { name: 'BOSS GATOR', mult: 2, reward: 6, col: '#ff5348' },
};

// node modifiers: every fork is a different gamble, not just a bigger blind
const NODE_MODS = {
  foggy: { name: 'FOGGY', bad: true, col: '#9fb2c8', desc: '-1 X-Ray in this fight' },
  swarming: { name: 'SWARMING', bad: true, col: '#ff5348', desc: '+1 snap tooth in every mouth' },
  brittle: { name: 'BRITTLE', bad: true, col: '#c8a878', desc: 'Teeth are worth -1 (min 1)' },
  tired: { name: 'TIRED ARM', bad: true, col: '#b06a78', desc: '-1 Bite in this fight' },
  toll: { name: 'TOLL GATE', bad: true, col: '#e8a020', desc: 'Pay $3 to enter' },
  blessed: { name: 'BLESSED', col: '#63d66a', desc: 'One tooth starts revealed every mouth' },
  richwater: { name: 'RICH WATERS', col: '#ffc843', desc: 'Reward +$4' },
  gilded: { name: 'GILDED', col: '#ffd54a', desc: 'A visiting GOLD TOOTH in every mouth' },
  tailwind: { name: 'TAILWIND', col: '#7fd4e8', desc: '+1 Bite in this fight' },
  charmed: { name: 'CHARMED', col: '#c07dff', desc: '+2 starting MULT every bite' },
};
const BAD_MODS = Object.keys(NODE_MODS).filter(k => NODE_MODS[k].bad);
const GOOD_MODS = Object.keys(NODE_MODS).filter(k => !NODE_MODS[k].bad);

const ANTE_BASE = [120, 320, 760, 1700, 3800, 7200, 12400, 15000]; // doubled: the swamp shows no mercy
const ROUND_MULT = [1, 1.5, 2];
const ROUND_REWARD = [4, 5, 8];
const ROUND_NAMES = ['SNAPPY GATOR', 'BIG GATOR', 'BOSS'];

function targetFor(ante, round) {
  let base = ante <= 8 ? ANTE_BASE[ante - 1] : ANTE_BASE[7] * Math.pow(1.6, ante - 8);
  return Math.round(base * ROUND_MULT[round]);
}
function rewardFor(ante, round) {
  return ROUND_REWARD[round] + Math.floor(ante / 3); // gentle income scaling for late antes
}

// -------------------------------------------------- gloves + achievements -
const GLOVES = {
  bare: { name: 'BARE HAND', skin: '#e8b088', shade: '#c07850', cuff: '#3a5560', ach: null, flav: 'Just you and the swamp.' },
  rubber: { name: 'RUBBER GLOVE', skin: '#7fd4e8', shade: '#4fa8c8', cuff: '#e8f4f8', ach: 'firstpress', flav: 'Snaps when you put it on.' },
  leather: { name: 'LEATHER MITT', skin: '#b0793a', shade: '#845423', cuff: '#5a3a1a', ach: 'ante3', flav: 'Smells like adventure.' },
  croc: { name: 'CROC-SKIN', skin: '#5aa843', shade: '#3c7c2e', cuff: '#295722', ach: 'boss', pat: 'scale', flav: 'Awkward, honestly.' },
  gold: { name: 'MIDAS TOUCH', skin: '#ffd54a', shade: '#c9941a', cuff: '#8a6510', ach: 'rich', pat: 'shine', flav: 'Everything you press turns to points.' },
  bone: { name: 'BONE SAW', skin: '#e8e8e0', shade: '#a8a89a', cuff: '#1a1a22', ach: 'snap25', pat: 'bones', flav: 'A skeleton of your former grip.' },
  pearl: { name: 'PEARL WHITE', skin: '#f4f0f8', shade: '#c8c0d8', cuff: '#8878a8', ach: 'sweep3', pat: 'dot', flav: 'Immaculate technique.' },
  royal: { name: 'ROYAL GRIP', skin: '#8a4fd0', shade: '#5a2a90', cuff: '#ffd54a', ach: 'win', pat: 'gem', flav: 'The hand that rules the swamp.' },
  neon: { name: 'NEON BOG', skin: '#4ef0c8', shade: '#1fa888', cuff: '#0a5a48', gacha: true, pat: 'shine', flav: 'Glows in the murk.' },
  candy: { name: 'CANDY WRAP', skin: '#ff8ab0', shade: '#d05580', cuff: '#fff0f8', gacha: true, pat: 'dot', flav: 'Do not lick.' },
  starry: { name: 'NIGHT SKY', skin: '#3a4a9a', shade: '#252f6a', cuff: '#ffd54a', gacha: true, pat: 'gem', flav: 'Wears the stars.' },
  chrome: { name: 'CHROME CLAW', skin: '#c8d4dc', shade: '#8a98a0', cuff: '#3a444c', shop: true, flav: 'Polished to a fault.' },
  voodoo: { name: 'VOODOO WRAP', skin: '#7a4fa8', shade: '#4a2a70', cuff: '#e0c060', shop: true, flav: 'Rattles when you floss.' },
  frost: { name: 'FROSTBITE', skin: '#bfe8f5', shade: '#6aa8c8', cuff: '#e8f8ff', gacha: true, flav: 'Numbs the whole hand.' },
  lava: { name: 'MAGMA FIST', skin: '#3a2018', shade: '#1e1008', cuff: '#c93818', gacha: true, flav: 'Cauterizes as it grips.' },
};
const GLOVE_ORDER = ['bare', 'rubber', 'leather', 'croc', 'gold', 'bone', 'pearl', 'royal', 'neon', 'candy', 'starry', 'chrome', 'voodoo', 'frost', 'lava'];
// rarity per glove (0..5) - drives cosmetic-stand price + rarity ring
const GLOVE_RAR = { bare: 0, rubber: 0, leather: 1, croc: 2, bone: 2, gold: 3, pearl: 3, neon: 3, candy: 3, royal: 4, starry: 5, chrome: 3, voodoo: 4, frost: 4, lava: 5 };

// ------------------------------------------- HATS (worn on the hand) ------
// A second cosmetic slot for your dentist hand. Most are bought at the shop's
// cosmetics stand (random rarity); a couple are earned or won in the gacha.
// col/col2 = felt + band/trim; ico decides the pixel silhouette in drawHatArt.
const HATS = {
  none: { name: 'BARE HEAD', rar: 0, free: true, ico: 'none', flav: 'Wind in your knuckle hair.' },
  straw: { name: 'STRAW HAT', rar: 0, free: true, ico: 'straw', col: '#e8c86a', col2: '#b8933a', flav: 'Keeps the bog sun off.' },
  cap: { name: 'CANVAS CAP', rar: 1, shop: true, ico: 'cap', col: '#4a8a5c', col2: '#2c5a38', flav: 'Bent brim, well loved.' },
  bandana: { name: 'SWAMP BANDANA', rar: 1, shop: true, ico: 'bandana', col: '#c9556a', col2: '#f4f2e4', flav: 'Pirate of the shallows.' },
  ranger: { name: 'RANGER PEAK', rar: 2, shop: true, ico: 'ranger', col: '#7a5a34', col2: '#c8a040', flav: 'Protect and re-fill.' },
  cowboy: { name: 'BAYOU STETSON', rar: 2, shop: true, ico: 'cowboy', col: '#a8763a', col2: '#5a3a1e', flav: 'Yeehaw, gently.' },
  top: { name: 'DAPPER TOPPER', rar: 3, shop: true, ico: 'top', col: '#1c2226', col2: '#c8b060', flav: 'For very formal extractions.' },
  wizard: { name: 'BOG CONJURER', rar: 3, shop: true, ico: 'wizard', col: '#4a3a8a', col2: '#ffd54a', flav: 'Molar, meet magic.' },
  crown: { name: 'TIN CROWN', rar: 3, ach: 'boss', ico: 'crownhat', col: '#ffd54a', col2: '#c9941a', flav: 'Bestowed by a beaten boss.' },
  pirate: { name: 'GATOR CORSAIR', rar: 4, shop: true, ico: 'pirate', col: '#20242a', col2: '#e8e8e0', flav: 'Yarr. Floss ye timbers.' },
  halo: { name: 'MARSH ANGEL', rar: 4, gacha: true, ico: 'halo', col: '#ffe089', col2: '#fff6c8', flav: 'Blessed be the bicuspid.' },
  party: { name: 'PARTY CONE', rar: 5, shop: true, ico: 'party', col: '#ff8ab0', col2: '#4ef0c8', flav: 'Every bank is a birthday.' },
  flame: { name: 'SWAMP FIRE', rar: 5, gacha: true, ico: 'flame', col: '#ff6a20', col2: '#ffe089', flav: 'The hottest take in the bog.' },
  beanie: { name: 'KNIT BEANIE', rar: 1, shop: true, ico: 'beanie', col: '#d8503a', col2: '#f4ecd4', flav: 'Toasty ears, cold hands.' },
  chef: { name: 'CHEF TOQUE', rar: 1, shop: true, ico: 'chef', col: '#f8f6f0', col2: '#c8c4b8', flav: 'Gumbo expert. Dentist second.' },
  mushroom: { name: 'MUSHROOM CAP', rar: 2, shop: true, ico: 'mushroom', col: '#d8303a', col2: '#fff4e8', flav: 'Spotted in the damp.' },
  propeller: { name: 'PROPELLER BEANIE', rar: 2, shop: true, ico: 'propeller', col: '#3a8ae8', col2: '#f8d030', flav: 'Almost achieves lift.' },
  bunnyears: { name: 'BUNNY EARS', rar: 2, booth: true, ico: 'bunnyears', col: '#f4eef0', col2: '#f0a0b8', flav: 'Hop hop, open wide.' },
  viking: { name: 'VIKING HELM', rar: 3, shop: true, ico: 'viking', col: '#8a98a0', col2: '#f4ecd4', flav: 'Raid the molars.' },
  gatorcap: { name: 'GATOR MERCH CAP', rar: 3, booth: true, ico: 'gatorcap', col: '#3a8a3a', col2: '#f4ecd4', flav: 'Official BITE DOWN merch. Chomp on your head.' },
  flowers: { name: 'LILY CROWN', rar: 3, booth: true, ico: 'flowers', col: '#f0a0c8', col2: '#5aa84a', flav: 'Picked fresh from the bayou.' },
  wombat: { name: 'WOMBAT HAT', rar: 4, itch: true, ico: 'wombat', col: '#8a6a4a', col2: '#d8b890', flav: 'A gift from Wombaton Studios for following on itch.io.' },
  owlbun: { name: "OWLET'S BUN", rar: 5, owl: true, ico: 'owlbun', col: '#9c968e', col2: '#e8b830', flav: 'Pencil included. Grumpiness sold separately.' },
};
const HAT_ORDER = ['none', 'straw', 'cap', 'bandana', 'beanie', 'chef', 'ranger', 'cowboy', 'mushroom', 'propeller', 'bunnyears', 'top', 'wizard', 'crown', 'viking', 'gatorcap', 'flowers', 'pirate', 'halo', 'wombat', 'party', 'flame', 'owlbun'];
const hatUnlocked = k => HATS[k].free || !!meta.hatOwn[k] || (HATS[k].ach ? !!meta.ach[HATS[k].ach] : false);

// ------------------------------------------- GEAR (worn on the face) --------
// The third cosmetic slot: dentist eyewear + face kit. Shows on your character
// portrait in the DRESSING ROOM and on the traveler crossing the map.
const GEAR = {
  none: { name: 'NO GEAR', rar: 0, free: true, flav: 'Bare-faced and brave.' },
  specs: { name: 'READING SPECS', rar: 0, free: true, col: '#c8d4dc', flav: 'For the small print on charms.' },
  shades: { name: 'BOG SHADES', rar: 1, shop: true, col: '#20242a', flav: 'The swamp got too bright.' },
  goggles: { name: 'DIVE GOGGLES', rar: 1, shop: true, col: '#3a9ad0', flav: 'Fogs up immediately.' },
  mask: { name: 'SURGICAL MASK', rar: 1, shop: true, col: '#bfe8f5', flav: 'Very professional. Very minty.' },
  monocle: { name: 'GATOR MONOCLE', rar: 2, shop: true, col: '#ffd54a', flav: 'One eye of pure class.' },
  eyepatch: { name: 'CORSAIR PATCH', rar: 2, shop: true, col: '#1c1c22', flav: 'Depth perception is a luxury.' },
  snorkel: { name: 'SNORKEL RIG', rar: 2, gacha: true, col: '#ff8a3a', flav: 'Breathe easy down there.' },
  visor: { name: 'WELDING VISOR', rar: 3, shop: true, col: '#4a6a2a', flav: 'For the really stubborn plaque.' },
  nightvis: { name: 'NIGHT SIGHT', rar: 4, gacha: true, col: '#4ef0c8', flav: 'The bog has no secrets now.' },
  starlens: { name: 'STARLIGHT LENS', rar: 5, gacha: true, col: '#c8a8f8', flav: 'You can see next Tuesday.' },
};
const GEAR_ORDER = ['none', 'specs', 'shades', 'goggles', 'mask', 'monocle', 'eyepatch', 'snorkel', 'visor', 'nightvis', 'starlens'];
const gearUnlocked = k => GEAR[k].free || !!meta.gearOwn[k];
// face gear drawn centered on cx with the eye line at `ey`, integer scale sc
function drawGearArt(cx, ey, key, sc) {
  sc = sc || 1;
  const g = GEAR[key]; if (!g || key === 'none') return;
  const col = g.col || '#c8d4dc';
  const R = (dx, dy, w, h, c) => rect((cx + dx * sc) | 0, (ey + dy * sc) | 0, Math.max(1, w * sc) | 0, Math.max(1, h * sc) | 0, c);
  const LENS = '#8fd6ea88', DK = '#00000066';
  switch (key) {
    case 'specs': // thin round wire frames
      R(-9, 0, 7, 6, DK); R(2, 0, 7, 6, DK);
      R(-8, 1, 5, 4, LENS); R(3, 1, 5, 4, LENS);
      R(-2, 2, 4, 1, col); R(-11, 1, 2, 1, col); R(9, 1, 2, 1, col);
      break;
    case 'shades': // wraparound dark lenses
      R(-10, 0, 20, 6, '#0c0c10');
      R(-9, 1, 8, 4, col); R(1, 1, 8, 4, col);
      R(-8, 1, 3, 1, '#ffffff55'); R(2, 1, 3, 1, '#ffffff33');
      break;
    case 'goggles': // rubber strap + twin round lenses
      R(-12, 0, 24, 7, '#1a2830'); R(-12, 1, 24, 1, col);
      R(-9, 1, 7, 5, '#0e1c22'); R(2, 1, 7, 5, '#0e1c22');
      R(-8, 2, 5, 3, LENS); R(3, 2, 5, 3, LENS);
      R(-7, 2, 2, 1, '#ffffff88'); R(4, 2, 2, 1, '#ffffff66');
      break;
    case 'mask': // pleated mask over the snout with ear loops
      R(-8, 4, 16, 8, '#8ab8c8'); R(-7, 5, 14, 6, col);
      R(-7, 7, 14, 1, '#9fc8d8'); R(-7, 9, 14, 1, '#9fc8d8');
      R(-10, 5, 2, 1, '#7a9aa8'); R(8, 5, 2, 1, '#7a9aa8');
      break;
    case 'monocle': // single lens, chain dangling
      R(2, -1, 8, 8, '#8a6510'); R(3, 0, 6, 6, LENS);
      R(4, 1, 2, 1, '#ffffffaa'); R(2, -1, 8, 1, col);
      R(10, 4, 1, 3, col); R(11, 7, 1, 3, col);
      break;
    case 'eyepatch': // patch on one eye + strap across
      R(-11, 1, 22, 1, '#2a2a30');
      R(-10, -1, 9, 8, '#0c0c10'); R(-9, 0, 7, 6, col);
      R(-7, 1, 2, 2, '#3a3a44');
      break;
    case 'snorkel': // mask plus an upright tube
      R(-10, 0, 20, 7, '#1a2830'); R(-9, 1, 18, 5, LENS);
      R(-8, 2, 4, 1, '#ffffff88');
      R(9, -8, 3, 10, col); R(9, -9, 5, 2, col); R(12, -8, 2, 3, '#c85a1a');
      break;
    case 'visor': // flip-down welding plate
      R(-11, -3, 22, 4, '#2a3a18'); R(-11, -2, 22, 2, col);
      R(-10, 1, 20, 7, '#1e2a12'); R(-8, 2, 16, 5, '#0a1408');
      R(-6, 3, 12, 3, '#2a5a2a'); R(-5, 3, 4, 1, '#6aff8a');
      break;
    case 'nightvis': // twin scope barrels on a headband
      R(-12, -1, 24, 3, '#14201c'); R(-12, -1, 24, 1, '#2a4a40');
      R(-9, 1, 7, 7, '#0c1a16'); R(1, 1, 7, 7, '#0c1a16');
      R(-8, 2, 5, 5, col); R(2, 2, 5, 5, col);
      R(-7, 3, 2, 2, '#c8ffe8'); R(3, 3, 2, 2, '#c8ffe8');
      R(-9, 8, 7, 1, '#08120e'); R(1, 8, 7, 1, '#08120e');
      break;
    case 'starlens': // arcane monocle ring with orbiting sparks
      R(1, -2, 10, 10, '#4a2a70'); R(2, -1, 8, 8, '#1a1030');
      R(3, 0, 6, 6, col); R(4, 1, 2, 2, '#ffffff');
      { const a = tNow * 2.4; R(1 + Math.cos(a) * 8, 2 + Math.sin(a) * 8, 1, 1, '#fff6c8'); R(1 + Math.cos(a + 2.1) * 8, 2 + Math.sin(a + 2.1) * 8, 1, 1, '#8fe8ff'); }
      break;
  }
}

// Draws a hat centered at cx with its brim sitting on baseline `by`, scaled by
// integer sc. dy is measured UP from the baseline (negative = higher).
function drawHatArt(cx, by, key, sc) {
  sc = sc || 1;
  const h = HATS[key]; if (!h || h.ico === 'none') return;
  const col = h.col || '#8a6a3a', c2 = h.col2 || '#5a3a1e', dk = '#00000055';
  const SH = '#00000038', LT = '#ffffff2b', HLW = '#ffffffcc', HLG = '#fff6c8';
  const R = (dx, dy, w, hh, c) => rect((cx + dx * sc) | 0, (by + dy * sc) | 0, Math.max(1, w * sc) | 0, Math.max(1, hh * sc) | 0, c);
  switch (h.ico) {
    case 'straw':
      R(-9, -2, 18, 3, dk); R(-8, -2, 16, 2, col);       // wide brim
      R(-5, -7, 10, 5, col); R(-4, -8, 8, 1, col);        // dome
      R(-5, -4, 10, 1, c2); R(-3, -7, 2, 3, '#f8e6a0');   // band + shine
      R(-4, -7, 1, 1, HLG); R(-8, -1, 16, 1, SH); R(-3, -6, 1, 1, LT); R(3, -4, 1, 3, SH);
      break;
    case 'cap':
      R(-5, -6, 10, 5, col); R(-4, -7, 8, 1, col);        // crown
      R(-9, -2, 8, 2, c2); R(-9, -1, 6, 1, dk);           // bill (left)
      R(-4, -4, 8, 1, '#ffffff44');
      R(-5, -6, 1, 1, HLW); R(-5, -2, 10, 1, SH); R(-1, -6, 1, 4, LT);
      break;
    case 'bandana':
      R(-6, -6, 12, 5, col); R(-5, -7, 10, 1, col);       // wrap
      R(-2, -4, 2, 2, c2); R(2, -3, 2, 2, c2);            // white dots
      R(4, -6, 4, 3, col); R(6, -5, 3, 4, col);           // side knot
      R(-6, -6, 1, 1, HLW); R(-6, -1, 12, 1, SH); R(5, -5, 1, 3, SH);
      break;
    case 'ranger':
      R(-9, -2, 18, 2, c2); R(-8, -3, 16, 1, col);        // flat brim
      R(-5, -8, 10, 6, col); R(-4, -9, 8, 1, col);        // peaked crown
      R(-1, -9, 2, 7, c2); R(-5, -5, 10, 1, c2);          // pinch + band
      R(-5, -8, 1, 1, HLW); R(-5, -2, 10, 1, SH); R(4, -8, 1, 6, SH); R(-4, -8, 1, 6, LT);
      break;
    case 'cowboy':
      R(-10, -2, 20, 2, col); R(-10, -1, 20, 1, dk);      // curled brim
      R(-11, -3, 3, 2, col); R(8, -3, 3, 2, col);         // upturned sides
      R(-5, -8, 10, 6, col); R(-4, -9, 8, 1, col);
      R(-2, -9, 1, 7, c2); R(1, -9, 1, 7, c2);            // crease
      R(-5, -4, 10, 1, c2);                               // band
      R(-5, -8, 1, 1, HLW); R(-10, -2, 20, 1, SH); R(-9, -8, 1, 6, LT);
      break;
    case 'top':
      R(-8, -2, 16, 2, col); R(-8, -1, 16, 1, dk);        // brim
      R(-5, -11, 10, 9, col); R(-5, -5, 10, 2, c2);       // tall crown + band
      R(-4, -10, 2, 6, '#ffffff33');
      R(-5, -11, 1, 1, HLW); R(-5, -2, 10, 1, SH); R(4, -11, 1, 9, SH); R(-4, -5, 1, 1, HLG);
      break;
    case 'wizard':
      R(-8, -2, 16, 2, col); R(-7, -3, 14, 1, col);       // brim
      R(-4, -6, 8, 4, col); R(-3, -9, 6, 3, col); R(-1, -12, 3, 3, col); R(0, -14, 2, 2, col); // cone
      R(-3, -5, 2, 2, c2); R(1, -8, 1, 1, c2); R(0, -13, 1, 1, '#fff'); // stars
      R(-4, -6, 1, 1, HLW); R(-4, -2, 8, 1, SH); R(2, -9, 1, 3, SH); R(-1, -11, 1, 2, LT);
      break;
    case 'crownhat':
      R(-6, -3, 12, 3, col); R(-6, -7, 2, 4, col); R(-1, -8, 2, 5, col); R(4, -7, 2, 4, col); // points
      R(-6, -4, 12, 1, c2); R(-5, -2, 2, 1, '#ff5348'); R(3, -2, 2, 1, '#3f8cff');            // jewels
      R(-6, -3, 1, 1, HLW); R(-6, -1, 12, 1, SH); R(4, -7, 1, 4, SH);
      break;
    case 'pirate':
      R(-9, -3, 18, 3, col); R(-7, -5, 14, 3, col); R(-4, -7, 8, 2, col); // tricorne
      R(-9, -3, 18, 1, c2);                                               // trim
      R(-2, -5, 4, 3, c2); R(-2, -4, 1, 1, col); R(1, -4, 1, 1, col); R(-1, -3, 2, 1, col); // skull
      R(-4, -7, 1, 1, HLW); R(-9, -1, 18, 1, SH); R(5, -5, 1, 3, SH);
      break;
    case 'halo': {
      const bob = Math.round(Math.sin(tNow * 2) * sc);
      R(-6, -8 - (bob / sc), 12, 2, col); R(-5, -9 - (bob / sc), 10, 1, h.col2); // ring
      R(-6, -6 - (bob / sc), 1, 1, col); R(5, -6 - (bob / sc), 1, 1, col);
      break;
    }
    case 'party':
      R(-6, -2, 12, 2, c2);                               // rim
      R(-4, -5, 8, 3, col); R(-3, -8, 6, 3, col); R(-1, -11, 3, 3, col); R(0, -13, 2, 2, '#ffd54a'); // cone
      R(-3, -4, 2, 1, '#fff'); R(1, -7, 1, 1, '#fff'); R(-1, -10, 1, 1, c2); // confetti stripes
      R(-4, -5, 1, 1, HLW); R(-6, -1, 12, 1, SH); R(2, -8, 1, 3, SH);
      break;
    case 'beanie':
      R(-6, -6, 12, 5, col); R(-5, -7, 10, 1, col); R(-6, -2, 12, 2, c2);
      for (let k = 0; k < 5; k++) R(-5 + k * 2, -6, 1, 4, SH);
      R(-2, -10, 4, 3, c2); R(-1, -11, 2, 1, c2); R(-5, -6, 1, 1, HLW);
      break;
    case 'chef':
      R(-5, -4, 10, 3, col); R(-5, -2, 10, 1, c2);
      R(-7, -11, 6, 7, col); R(-2, -13, 5, 9, col); R(2, -11, 6, 7, col);
      R(-6, -10, 1, 1, HLW); R(-1, -12, 1, 1, HLW); R(4, -8, 1, 3, SH); R(-3, -5, 1, 2, c2); R(2, -5, 1, 2, c2);
      break;
    case 'mushroom':
      R(-9, -3, 18, 2, '#8a1a1a'); R(-8, -6, 16, 3, col); R(-6, -8, 12, 2, col); R(-3, -9, 6, 1, col);
      R(-5, -7, 2, 2, c2); R(1, -8, 3, 2, c2); R(4, -5, 2, 2, c2); R(-7, -4, 2, 1, c2);
      R(-6, -8, 1, 1, HLW); R(-9, -1, 18, 1, SH);
      break;
    case 'propeller': {
      R(-6, -5, 12, 4, col); R(-5, -6, 10, 1, col); R(-6, -2, 12, 1, '#f84a4a');
      R(-6, -5, 3, 3, '#f84a4a'); R(3, -5, 3, 3, '#5ac86a');
      R(0, -9, 1, 3, '#3a3a3a');
      const sp = Math.cos(tNow * 18), pw = Math.max(1, Math.round(Math.abs(sp) * 6));
      R(-pw, -10, pw * 2, 1, c2); R(-5, -5, 1, 1, HLW);
      break;
    }
    case 'bunnyears':
      R(-7, -3, 14, 2, '#c8c0c8');
      R(-6, -14, 4, 11, col); R(2, -14, 4, 11, col); R(-5, -13, 2, 9, c2); R(3, -13, 2, 9, c2);
      R(-6, -14, 1, 1, HLW); R(5, -12, 1, 8, SH);
      break;
    case 'viking':
      R(-6, -6, 12, 5, col); R(-5, -7, 10, 1, col); R(-6, -2, 12, 2, '#6a5a3a');
      R(-10, -9, 3, 2, c2); R(-9, -7, 3, 2, c2); R(-8, -5, 2, 2, c2); R(7, -9, 3, 2, c2); R(6, -7, 3, 2, c2); R(6, -5, 2, 2, c2);
      R(-1, -7, 2, 5, '#6a7880'); R(-5, -6, 1, 1, HLW); R(4, -6, 1, 4, SH);
      break;
    case 'gatorcap':
      R(-6, -6, 12, 5, col); R(-5, -7, 10, 1, col); R(-10, -2, 9, 2, col); R(-10, -1, 7, 1, dk);
      for (let k = 0; k < 4; k++) R(-10 + k * 2, 0, 1, 1, c2);
      R(-4, -9, 3, 3, col); R(2, -9, 3, 3, col); R(-3, -8, 1, 2, '#f0d040'); R(3, -8, 1, 2, '#f0d040');
      R(-5, -6, 1, 1, HLW); R(-5, -2, 10, 1, SH);
      break;
    case 'flowers':
      R(-7, -3, 14, 2, c2);
      [-6, -2, 2, 6].forEach((fx, i) => { const fc = ['#f0a0c8', '#f8f0f0', '#f8d040', '#c8a0f8'][i]; R(fx - 1, -5, 3, 1, fc); R(fx, -6, 1, 3, fc); R(fx, -5, 1, 1, '#f8d040'); });
      break;
    case 'wombat':
      R(-7, -7, 14, 7, col); R(-6, -8, 12, 1, col);
      R(-8, -10, 3, 3, col); R(5, -10, 3, 3, col); R(-7, -9, 1, 1, c2); R(6, -9, 1, 1, c2);
      R(-3, -5, 6, 3, c2); R(-1, -5, 2, 1, '#2a1a0c'); R(-4, -6, 1, 1, '#1a1208'); R(3, -6, 1, 1, '#1a1208');
      R(-7, -1, 14, 1, SH); R(-6, -7, 1, 1, HLW);
      break;
    case 'owlbun':
      R(-5, -8, 10, 7, col); R(-4, -9, 8, 1, col); R(-4, -6, 8, 1, '#7c7670'); R(-3, -4, 6, 1, '#7c7670');
      R(-9, -10, 16, 1, '#1e150c'); R(-8, -10, 14, 1, c2); R(-10, -11, 2, 2, '#e87a8a'); R(6, -10, 1, 1, '#2a2016');
      R(-4, -8, 1, 1, HLW);
      break;
    case 'flame': {
      const f = tNow * 9;
      R(-6, -3, 12, 3, '#6a3a1e'); R(-6, -4, 12, 1, col); // charred band
      for (let k = 0; k < 5; k++) {
        const fx = -5 + k * 2.4, fh = 4 + Math.abs(Math.sin(f + k * 1.7)) * 4;
        R(fx, -3 - fh, 2, fh, col);
        R(fx, -3 - fh, 1, fh * 0.5, h.col2);
      }
      break;
    }
  }
}

// ---- glove material ramps [outline, shadow, base, light, highlight] ------
const GLOVE_RAMP = {
  croc: { o: '#1e4419', s: '#295722', b: '#5aa843', l: '#7bc85e', h: '#a4e07a' },
  gold: { o: '#6e4a08', s: '#a4741a', b: '#ffd54a', l: '#ffe089', h: '#fff6c8' },
  neon: { o: '#0a5a48', s: '#1fa888', b: '#4ef0c8', l: '#8ffce0', h: '#daffff', glow: '#4ef0c8' },
  starry: { o: '#12163a', s: '#252f6a', b: '#3a4a9a', l: '#5566c0', h: '#aab6ff', star: '#f4f2e4', sgold: '#ffd54a' },
  bone: { o: '#6a6a5e', s: '#a8a89a', b: '#e8e8e0', l: '#f4f4ee', h: '#ffffff', socket: '#1a1a22' },
  candy: { o: '#a83f63', s: '#d05580', b: '#ff8ab0', l: '#fff0f8', h: '#ffffff' },
  pearl: { o: '#8878a8', s: '#c8c0d8', b: '#f4f0f8', l: '#ffffff', h: '#ffffff', ic: '#d6f2ef', ip: '#f6dbe9' },
  royal: { o: '#3a1a68', s: '#5a2a90', b: '#8a4fd0', l: '#a878e0', h: '#d8c0ff', trim: '#ffd54a', gr: '#ff5348', gb: '#3f8cff' },
  chrome: { o: '#3a444c', s: '#8a98a0', b: '#c8d4dc', l: '#eef4f8', h: '#ffffff' },
  voodoo: { o: '#2e1848', s: '#4a2a70', b: '#7a4fa8', l: '#a878d8', h: '#d8c0ff', charm: '#e0c060', bone: '#f0e8d0' },
  frost: { o: '#3a6a88', s: '#6aa8c8', b: '#bfe8f5', l: '#e8f8ff', h: '#ffffff', ice: '#8fd8f0' },
  lava: { o: '#1e1008', s: '#5a2410', b: '#8a3818', l: '#e05828', h: '#ffb040', crack: '#ff9838', hot: '#ffe089' },
};

// distinctive on-hand sprite treatment per glove (keyed on id, pat fallback)
function drawGloveDeco(x, y, fl, gid, g, grab) {
  const R = GLOVE_RAMP[gid];
  const py = grab ? y + 3 : y + fl + 1;
  const px = grab ? x - 4 : x - 3;
  switch (gid) {
    case 'croc':
      if (!grab) {
        rect(x - 3, py, 7, 1, R.s); rect(x - 2, py + 2, 2, 1, R.s); rect(x + 1, py + 2, 2, 1, R.s);
        rect(x - 3, py + 4, 2, 1, R.s); rect(x, py + 4, 2, 1, R.s); rect(x + 3, py + 4, 1, 1, R.s);
        rect(x - 2, py + 1, 1, 1, R.l); rect(x + 2, py + 3, 1, 1, R.l); rect(x + 0, py + 5, 1, 1, R.l);
      } else { for (let k = 0; k < 4; k++) { const kx = x - 5 + k * 3; rect(kx, y - 1, 2, 1, R.l); rect(kx, y + 1, 2, 1, R.s); rect(kx, y + 4, 2, 1, R.s); } }
      break;
    case 'gold':
      if (!grab) {
        rect(x - 1, y + 2, 1, fl - 3, R.l); rect(x, y + 2, 1, 1, R.h);
        rect(x - 4, y + fl - 1, 14, 1, R.l); rect(x - 4, y + fl + 8, 14, 1, R.o);
        rect(x - 2, py + 1, 1, 1, R.h); rect(x + 2, py + 3, 1, 1, R.h);
        const s = (tNow * 22 | 0) % 16; if (s < 8) { for (let i = 0; i < 3; i++) rect(x - 3 + s + i, y + fl + i, 1, 1, R.h); }
      } else { for (let k = 0; k < 4; k++) { const kx = x - 5 + k * 3; rect(kx, y - 1, 2, 1, R.h); rect(kx, y + 2, 2, 1, R.o); rect(kx, y + 0, 1, 1, R.h); } rect(x - 6, y + 3, 14, 1, R.l); }
      break;
    case 'neon':
      if (!grab) { rect(x - 1, y, 1, fl, R.l); rect(x + 9, y + fl + 4, 1, 5, R.l); rect(x - 4, y + fl + 9, 14, 1, R.l); rect(x + 3, y + fl + 3, 1, 1, R.h); }
      else { rect(x - 6, y - 1, 1, 11, R.l); rect(x + 7, y + 2, 1, 7, R.l); rect(x + 2, y + 3, 1, 1, R.h); }
      break;
    case 'starry': {
      const cy = grab ? y + 10 : y + fl + 9, cl = grab ? x - 6 : x - 4;
      rect(cl + 2, cy + 1, 1, 1, R.star); rect(cl + 6, cy + 2, 1, 1, R.h); rect(cl + 9, cy + 1, 1, 1, R.sgold); rect(cl + 12, cy + 2, 1, 1, R.star); rect(cl + 4, cy + 0, 1, 1, R.sgold);
      break; }
    case 'bone':
      if (grab) { for (let k = 0; k < 4; k++) { const kx = x - 5 + k * 3; rect(kx, y - 2, 2, 1, R.socket); fillCircle(kx + 0, y + 0, 1, R.b); rect(kx, y + 1, 2, 1, R.s); rect(kx, y - 1, 1, 1, R.h); } }
      else { rect(x - 3, py + 3, 8, 1, R.b); rect(x - 1, py + 1, 1, 5, R.b); rect(x - 3, py + 4, 8, 1, R.s); rect(x - 1, py + 6, 1, 1, R.socket); for (let k = 0; k < 3; k++) { const kx = x + 3 + k * 3; rect(kx, y + fl - 1 + k, 3, 1, R.b); rect(kx, y + fl + 2 + k, 3, 1, R.s); } }
      break;
    case 'candy': {
      const by0 = grab ? y : y + fl - 1, bx0 = grab ? x - 6 : x - 4, ww = 14, hh = grab ? 10 : 11;
      for (let d = -hh; d < ww; d += 4) for (let r = 0; r < hh; r++) { const cxp = bx0 + d + r; if (cxp >= bx0 && cxp < bx0 + ww) rect(cxp, by0 + r, 1, 1, R.l); }
      rect(bx0, by0, ww, 1, R.h);
      break; }
    case 'pearl':
      rect(px, py, 6, 1, R.l); rect(px + 1, py + 2, 1, 1, R.ic); rect(px + 4, py + 3, 1, 1, R.ip); rect(px + 2, py + 5, 1, 1, R.ic); rect(px + 3, py + 1, 1, 1, R.h);
      break;
    case 'royal':
      rect(px + 2, py + 2, 2, 2, R.trim); rect(px + 2, py + 2, 1, 1, R.gr); rect(px + 3, py + 3, 1, 1, R.gb); rect(px + 2, py + 2, 1, 1, R.h);
      if (grab) { for (let k = 0; k < 4; k += 2) rect(x - 5 + k * 3, y - 1, 1, 1, R.trim); }
      break;
    /* CHROME — mirror-metal plating with a hard specular band */
    case 'chrome':
      if (!grab) { rect(x - 1, y + 2, 1, fl - 2, R.h); rect(x - 4, y + fl - 1, 14, 1, R.h); rect(x - 4, y + fl + 8, 14, 1, R.o); rect(px + 1, py + 2, 4, 1, R.l); rect(px + 2, py + 4, 3, 1, R.s); }
      else { for (let k = 0; k < 4; k++) rect(x - 5 + k * 3, y - 1, 2, 1, R.h); rect(x - 6, y + 3, 14, 1, R.l); rect(x - 6, y + 8, 14, 1, R.o); }
      break;
    /* VOODOO — stitched wrap + a dangling bone charm */
    case 'voodoo': {
      const cy2 = grab ? y + 9 : y + fl + 8;
      rect(px, py + 1, 8, 1, R.s); rect(px + 1, py + 3, 6, 1, R.s); rect(px, py + 5, 8, 1, R.s); // wrap stitches
      rect(px + 2, py + 1, 1, 1, R.l); rect(px + 5, py + 5, 1, 1, R.l);
      rect(px + 6, cy2, 1, 4, R.charm); rect(px + 5, cy2 + 4, 3, 1, R.bone); rect(px + 5, cy2 + 3, 1, 2, R.bone); rect(px + 7, cy2 + 3, 1, 2, R.bone); // bone charm
      break; }
    /* FROSTBITE — frost crystals + icy rim */
    case 'frost':
      if (!grab) { rect(x - 1, y, 1, fl, R.h); rect(px + 1, py + 2, 1, 1, R.h); rect(px + 4, py + 3, 1, 1, R.h); rect(px + 2, py + 5, 1, 1, R.ice); rect(px + 3, py + 1, 1, 3, R.ice); rect(px + 2, py + 2, 3, 1, R.ice); }
      else { rect(x - 6, y - 1, 1, 11, R.h); rect(x - 3, y + 3, 1, 3, R.ice); rect(x - 4, y + 4, 3, 1, R.ice); rect(x + 3, y + 5, 1, 1, R.h); }
      break;
    /* MAGMA — glowing crack lines through cooled rock */
    case 'lava': {
      const hot = (tNow * 4 | 0) % 2 ? R.crack : R.hot;
      if (!grab) { rect(x, y + 2, 1, fl - 2, hot); rect(px + 1, py + 1, 4, 1, R.crack); rect(px + 2, py + 3, 1, 2, hot); rect(px + 4, py + 4, 3, 1, R.crack); rect(px, py + 6, 3, 1, hot); }
      else { for (let k = 0; k < 4; k++) rect(x - 5 + k * 3, y, 1, 3, k % 2 ? hot : R.crack); rect(x - 4, y + 5, 10, 1, R.crack); rect(x, y + 7, 4, 1, hot); }
      break; }
    default:
      if (g.pat === 'scale') { rect(px + 1, py + 1, 2, 2, g.shade); rect(px + 4, py + 3, 2, 2, g.shade); rect(px + 2, py + 6, 2, 2, g.shade); }
      else if (g.pat === 'dot') { rect(px + 1, py + 2, 1, 1, g.shade); rect(px + 4, py + 4, 1, 1, g.shade); rect(px + 2, py + 7, 1, 1, g.shade); }
      else if (g.pat === 'bones') { rect(px, py + 3, 8, 1, '#fff'); rect(px + 2, py + 1, 1, 5, '#fff'); }
      else if (g.pat === 'gem') { rect(px + 3, py + 3, 2, 2, C.gold); }
      else if (g.pat === 'shine') { rect(px, py, 2, 4, '#fff6c8'); }
      if (gid === 'leather') rect(px, py + 4, 7, 1, g.cuff);
      if (gid === 'rubber') rect(px + 3, py, 1, 7, '#e8f4f8');
      break;
  }
}

// signature per-frame effect emitted while a glove is equipped
const GLOVE_FX = {
  gold(x, y, fl, grab) {
    if (rnd() < 0.35) {
      const sx = grab ? x + ri(-5, 7) : x + ri(-4, 8);
      const sy = grab ? y + ri(-1, 9) : y + fl + ri(-2, 8);
      parts.push({ x: sx, y: sy, vx: (rnd() - 0.5) * 10, vy: 8 + rnd() * 16, g: 40, t: 0, life: 0.5 + rnd() * 0.4, col: rnd() < 0.5 ? '#ffe089' : '#fff6c8', sz: 1 });
    }
  },
  neon(x, y, fl, grab) {
    const a = 0.22 + 0.20 * Math.sin(tNow * 5);
    ctx.globalAlpha = clamp(a, 0, 1);
    const cx = grab ? x + 1 : x + 3, cy = grab ? y + 4 : y + fl + 4, rx = 11, ry = grab ? 9 : 11;
    for (let i = 0; i < 8; i++) { const th = i * Math.PI / 4; rect((cx + Math.cos(th) * rx) | 0, (cy + Math.sin(th) * ry) | 0, 1, 1, '#4ef0c8'); }
    ctx.globalAlpha = 1;
  },
  starry(x, y, fl, grab) {
    const cl = grab ? x - 6 : x - 4, cy = grab ? y + 10 : y + fl + 9, cw = 14;
    [[3, 1], [8, 2], [12, 1]].forEach((p, i) => { ctx.globalAlpha = 0.35 + 0.65 * Math.max(0, Math.sin(tNow * 3 + i * 2.1)); rect(cl + p[0], cy + p[1], 1, 1, i === 1 ? '#ffd54a' : '#f4f2e4'); });
    for (let i = 0; i < 2; i++) { const ph = (tNow * 0.35 + i * 0.5) % 1; ctx.globalAlpha = (1 - ph) * 0.9; rect((cl + ((tNow * 5 + i * 7) % cw)) | 0, (cy - 1 - ph * 5) | 0, 1, 1, '#aab6ff'); }
    ctx.globalAlpha = 1;
  },
  royal(x, y, fl, grab) {
    const gx = grab ? x - 2 : x - 1, gy = grab ? y + 5 : y + fl + 3;
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(tNow * 4); rect(gx, gy, 1, 1, '#fff6c8'); ctx.globalAlpha = 1;
  },
  pearl(x, y, fl, grab) {
    const s = (tNow * 9 | 0) % 18; if (s < 7) { ctx.globalAlpha = 0.4; const bx0 = grab ? x - 6 : x - 4, by0 = grab ? y - 1 : y + fl - 1; rect(bx0 + s, by0 + s, 1, 2, '#ffffff'); ctx.globalAlpha = 1; }
  },
  chrome(x, y, fl, grab) { // hard specular glint sweeping the plating
    const s = (tNow * 14 | 0) % 20; if (s < 6) { ctx.globalAlpha = 0.7; const bx0 = grab ? x - 6 : x - 4, by0 = grab ? y - 1 : y + fl - 1; rect(bx0 + s, by0 + s, 1, 3, '#ffffff'); ctx.globalAlpha = 1; }
  },
  voodoo(x, y, fl, grab) { // purple wisp drifting up
    const cx = grab ? x + 1 : x + 2, cy = grab ? y + 4 : y + fl + 4;
    for (let i = 0; i < 2; i++) { const t = (tNow * 0.6 + i * 0.5) % 1; ctx.globalAlpha = (1 - t) * 0.5; rect((cx + Math.sin(tNow * 3 + i * 2) * 3) | 0, (cy - t * 12) | 0, 1, 1, i ? '#a878d8' : '#d8c0ff'); }
    ctx.globalAlpha = 1;
  },
  frost(x, y, fl, grab) { // slow-falling snow motes + icy rim shimmer
    if (rnd() < 0.25) parts.push({ x: (grab ? x : x) + ri(-5, 7), y: (grab ? y : y + fl) + ri(-2, 4), vx: (rnd() - 0.5) * 6, vy: 8 + rnd() * 10, g: 8, t: 0, life: 0.6 + rnd() * 0.4, col: rnd() < 0.5 ? '#e8f8ff' : '#8fd8f0', sz: 1 });
    ctx.globalAlpha = 0.3 + 0.2 * Math.sin(tNow * 3); const rx = grab ? x - 6 : x - 4, ry = grab ? y + 9 : y + fl + 9; rect(rx + ((tNow * 6 | 0) % 14), ry, 1, 1, '#ffffff'); ctx.globalAlpha = 1;
  },
  lava(x, y, fl, grab) { // rising embers + a hot flicker glow
    ctx.globalAlpha = 0.08 + 0.05 * Math.sin(tNow * 11); fillCircle(grab ? x + 1 : x + 2, grab ? y + 4 : y + fl + 3, 9, '#ff6a20'); ctx.globalAlpha = 1;
    if (rnd() < 0.45) parts.push({ x: (grab ? x : x) + ri(-4, 6), y: (grab ? y : y + fl) + ri(0, 6), vx: (rnd() - 0.5) * 6, vy: -8 - rnd() * 12, g: -4, t: 0, life: 0.4 + rnd() * 0.4, col: rnd() < 0.5 ? '#ff9838' : '#ffe089', sz: 1 });
  },
};

// signature per-frame effect emitted while a hat is equipped (bx,by = hat baseline)
const HAT_FX = {
  wizard(bx, by) {
    [[-3, -5], [1, -8], [0, -13]].forEach((p, i) => { ctx.globalAlpha = 0.4 + 0.6 * Math.max(0, Math.sin(tNow * 4 + i * 2)); rect(bx + p[0], by + p[1], 1, 1, '#fff6c8'); });
    for (let i = 0; i < 2; i++) { const t = (tNow * 0.5 + i * 0.5) % 1; ctx.globalAlpha = (1 - t) * 0.85; rect((bx + 1 + Math.sin(tNow * 2 + i * 3) * 2) | 0, (by - 13 - t * 6) | 0, 1, 1, i ? '#ffd54a' : '#ffffff'); }
    ctx.globalAlpha = 1;
  },
  halo(bx, by) {
    const bob = Math.round(Math.sin(tNow * 2)), hx = bx, hy = by - 8 - bob;
    ctx.globalAlpha = 0.12; fillCircle(hx, hy, 4, '#fff6c8');
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + tNow * 0.6, len = 3 + Math.round(1.5 * (0.5 + 0.5 * Math.sin(tNow * 3 + i))); ctx.globalAlpha = 0.5; rect((hx + Math.cos(a) * len) | 0, (hy + Math.sin(a) * len) | 0, 1, 1, '#fff6c8'); }
    ctx.globalAlpha = 1;
  },
  flame(bx, by) {
    const flick = 0.06 + 0.04 * Math.sin(tNow * 13) + 0.03 * Math.sin(tNow * 7.3);
    const jx = meta.set.shake ? ri(-1, 1) : 0;
    ctx.globalAlpha = clamp(flick, 0, 0.16); fillCircle(bx + jx, by - 6, 10, '#ff8a30'); ctx.globalAlpha = 1;
    if (rnd() < 0.5) parts.push({ x: bx + ri(-4, 4), y: by - 4 - ri(0, 4), vx: (rnd() - 0.5) * 6, vy: -10 - rnd() * 12, g: -6, t: 0, life: 0.4 + rnd() * 0.4, col: rnd() < 0.5 ? '#ff6a20' : '#ffe089', sz: 1 });
  },
  party(bx, by) {
    if (rnd() < 0.4) { const cols = ['#ff8ab0', '#4ef0c8', '#ffd54a', '#f4f2e4']; parts.push({ x: bx + 1 + ri(-2, 2), y: by - 12, vx: (rnd() - 0.5) * 44, vy: -30 - rnd() * 30, g: 180, t: 0, life: 0.6 + rnd() * 0.5, col: cols[ri(0, 3)], sz: ri(1, 2) }); }
  },
  crownhat(bx, by) {
    const s = ((tNow * 10) % 18) - 1;
    if (s >= 0 && s < 12) { ctx.globalAlpha = 0.75; rect(bx - 6 + s, by - 4, 1, 1, '#fff6c8'); rect(bx - 6 + s, by - 3, 1, 1, '#ffffff88'); ctx.globalAlpha = 1; }
    ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(tNow * 3)); rect(bx - 5, by - 2, 1, 1, '#ff5348'); rect(bx + 3, by - 2, 1, 1, '#3f8cff'); ctx.globalAlpha = 1;
  },
  pirate(bx, by) {
    rect(bx + 3, by - 10, 1, 3, '#2a1a10');
    const w = 2 + Math.round(0.5 + 0.5 * Math.sin(tNow * 7));
    rect(bx + 4, by - 10, w, 2, '#c9556a'); rect(bx + 4, by - 10, 1, 2, '#8a2a16');
    if (w > 2) rect(bx + 4 + w, by - 9, 1, 1, '#c9556a');
  },
  top(bx, by) {
    const s = (tNow * 8) % 16; if (s < 9) { ctx.globalAlpha = 0.5; rect((bx - 4 + s * 0.6) | 0, (by - 10 + s) | 0, 1, 2, '#ffffffaa'); ctx.globalAlpha = 1; }
  },
};

function drawCosmeticFx(x, y, grab) {
  const gid = gloveUnlocked(meta.glove) ? meta.glove : 'bare';
  const press = handPressT > 0 ? 2 : 0, fl = press ? 7 : 9;
  ctx.save();
  const gf = GLOVE_FX[gid]; if (gf) gf(x, y, fl, grab);
  ctx.globalAlpha = 1;
  ctx.restore();
}
const ACHS = [
  { id: 'firstpress', name: 'FIRST BITE', desc: 'Press your first tooth', glove: 'rubber' },
  { id: 'ante3', name: 'GETTING TOOTHY', desc: 'Reach Ante 3', glove: 'leather' },
  { id: 'boss', name: 'DE-BOSSED', desc: 'Defeat a Boss Gator', glove: 'croc' },
  { id: 'rich', name: 'SWAMP MONEY', desc: 'Hold $50 at once', glove: 'gold' },
  { id: 'snap25', name: 'PAIN TOLERANCE', desc: 'Get snapped 25 times (lifetime)', glove: 'bone' },
  { id: 'sweep3', name: 'SPOTLESS', desc: '3 Clean Sweeps in one run', glove: 'pearl' },
  { id: 'win', name: 'APEX DENTIST', desc: 'Beat all 8 antes', glove: 'royal' },
];
// ------------------------------------- rangers (animal run characters) ----
const RANGERS = {
  scout: {
    name: 'BAYOU SCOUT', animal: 'THE OTTER', col: '#63d66a', ach: null,
    lines: ['+1 TOOTH IN EVERY MOUTH', 'ONE TOOTH PER MOUTH COMES PRE-XRAYED'],
    flav: 'Floats on her back, counting teeth.',
  },
  medic: {
    name: 'SWAMP MEDIC', animal: 'THE OPOSSUM', col: '#7fd4e8', ach: 'boss',
    lines: ['+1 BITE EVERY ROUND', 'STARTS HOLDING A FREE NOVOCAINE'],
    flav: 'Prescribes more biting.',
  },
  trader: {
    name: 'BOG TRADER', animal: 'THE RACCOON', col: '#ffc843', ach: 'rich',
    lines: ['STARTS THE RUN WITH $12', 'INTEREST CAP RAISED TO $8'],
    flav: 'Sells swamp to swimmers.',
  },
  frog: {
    name: 'BULLFROG BRAWLER', animal: 'THE BULLFROG', col: '#7ec850', ach: 'sweep3',
    lines: ['CLEAN SWEEPS PAY X1.75 MULT', 'INSTEAD OF THE USUAL X1.25'],
    flav: 'Croaks first, counts later.',
  },
  snail: {
    name: 'SNAIL SAGE', animal: 'THE SNAIL', col: '#c8a878', ach: 'win',
    lines: ['EVERY BITE STARTS AT +3 MULT', 'BUT -1 BITE EVERY ROUND'],
    flav: 'Slow is smooth. Smooth is rich.',
  },
};
const RANGER_ORDER = ['scout', 'medic', 'trader', 'frog', 'snail'];

// ----------------------------------- swamp mini-games (skill events) ------
// event nodes launch one of ten pixel mini-games; pay scales with skill.
// icon = an mg_* sprite from ICONS, shown on the intro card.
const MINIGAMES = {
  fish: { name: "GONE FISHIN'", icon: 'mg_fish', how: ['Wait for the bobber to DIP -', 'then TAP fast to hook it! 5 casts.'] },
  feed: { name: 'FEEDING TIME', icon: 'mg_gator', how: ['A hungry gator cruises the pool.', 'TAP to lob a drumstick onto the X - lead him! 6 throws.'] },
  cook: { name: 'CAMP GUMBO', icon: 'mg_pot', how: ['TAP to stoke the fire.', 'Hold the needle in the green for 10 seconds.'] },
  mallow: { name: 'MALLOW ROAST', icon: 'mg_mallow', how: ['Marshmallows toast fast and burn faster.', 'TAP to pull each one at peak GOLD. 3 mallows.'] },
  ducks: { name: 'DUCK GALLERY', icon: 'mg_duck', how: ['Wooden ducks cross the stalls - TAP to shoot!', 'Gold ducks pay triple. 14 seconds.'] },
  froggy: { name: 'FROG ROUNDUP', icon: 'mg_frog', how: ['Frogs only rest a moment between hops.', 'TAP one while it sits to bag it! 14 seconds.'] },
  birdy: { name: 'BIRD SNAPS', icon: 'mg_cam', how: ['Line the photo frame up on a flying bird', 'and TAP to snap it. 6 shots of film!'] },
  boat: { name: 'AIRBOAT RUN', icon: 'mg_boat', how: ['MOVE your finger or mouse to steer the airboat.', 'Grab coins, dodge the logs! 15 seconds.'] },
  burger: { name: 'GATOR GRILL', icon: 'mg_burger', how: ['Patties sizzle on the swamp grill.', 'TAP to FLIP at golden-brown - two flips per burger!'] },
  manatee: { name: 'MANATEE SPA', icon: 'mg_manatee', how: ['Sweet Merle is caked in algae.', 'MOVE the brush over the green to scrub him clean! 16s.'] },
};
const MINIGAME_KEYS = Object.keys(MINIGAMES);


// ---------------------------------------------- tools (the tarot analog) --
// Used at the DENTIST BENCH on your deck's teeth. picks = max targets.
const TOOLS = [
  { id: 'polishdrill', name: 'POLISH DRILL', cost: 5, ico: 'tdrill', picks: 2, desc: 'Upgrade up to 2 chosen teeth by +3 value', flav: 'WHIRRRR.' },
  { id: 'goldfill', name: 'GOLD FILLING', cost: 6, ico: 'tgold', picks: 1, tier: 9, desc: 'Convert a chosen tooth into a GOLD TOOTH', flav: 'Smile like a jackpot.' },
  { id: 'rubyinlay', name: 'RUBY INLAY', cost: 6, ico: 'truby', picks: 1, desc: 'Convert a chosen tooth into a RUBY TOOTH', flav: 'Set with tweezers and spite.' },
  { id: 'forceps', name: 'FORCEPS', cost: 4, ico: 'tpliers', picks: 2, desc: 'Remove up to 2 chosen teeth from your deck', flav: 'One clean pull. Two, tops.' },
  { id: 'bracewire', name: 'BRACE WIRE', cost: 7, ico: 'twire', picks: 1, tier: 11, desc: 'Clone a chosen tooth (exact copy joins your deck)', flav: 'Twins run in the bayou.' },
  { id: 'infectvial', name: 'INFECTION VIAL', cost: 5, ico: 'tvial', picks: 1, desc: 'Infect a chosen tooth: value 0, but +8 MULT when pressed', flav: 'For medicinal purposes.' },
  { id: 'veneer', name: 'VENEER KIT', cost: 5, ico: 'tveneer', picks: 1, desc: 'Set a chosen tooth\'s value to 8', flav: 'Hollywood, bayou branch.' },
  { id: 'fluorbath', name: 'FLUORIDE BATH', cost: 6, ico: 'tbath', picks: 1, desc: 'Choose a tooth: ALL teeth of that value gain +2', flav: 'Everyone in the tub.' },
  { id: 'extractor', name: 'ROOT EXTRACTOR', cost: 4, ico: 'troot', picks: 1, desc: 'Sacrifice a chosen tooth: gain $2 per point of its value', flav: 'Teeth are just money that bites.' },
  { id: 'diamondcap', name: 'DIAMOND CAP', cost: 8, ico: 'tdiamond', picks: 1, tier: 13, desc: 'Convert a chosen tooth into a DIAMOND TOOTH (+15)', flav: 'Overkill, beautifully.' },
  // ---- gacha-pon exclusive tools ----
  { id: 'whitening', name: 'WHITENING PEN', cost: 5, ico: 'tveneer', picks: 3, tier: 3, desc: 'Upgrade up to 3 chosen teeth by +2 value', flav: 'Blindingly effective.' },
  { id: 'bigforceps', name: 'GATOR PLIERS', cost: 6, ico: 'tpliers', picks: 3, tier: 5, desc: 'Remove up to 3 chosen teeth from your deck', flav: 'Industrial dentistry.' },
  { id: 'emeraldcap', name: 'EMERALD CAP', cost: 6, ico: 'truby', picks: 1, tier: 7, desc: 'Convert a chosen tooth into an EMERALD TOOTH', flav: 'Green means grow.' },
  { id: 'moonmold', name: 'MOONSTONE MOLD', cost: 7, ico: 'tdiamond', picks: 1, tier: 12, desc: 'Convert a chosen tooth into a MOONSTONE TOOTH', flav: 'Cast under a full moon.' },
  { id: 'luckybrush', name: 'LUCKY BRUSH', cost: 6, ico: 'tbath', picks: 1, tier: 14, desc: 'Convert a chosen tooth into a LUCKY TOOTH', flav: 'Brushes in clover circles.' },
  { id: 'amberresin', name: 'AMBER RESIN', cost: 6, ico: 'truby', picks: 1, tier: 4, desc: 'Convert a chosen tooth into an AMBER TOOTH', flav: 'Sap of the old cypress.' },
  { id: 'pearldive', name: 'PEARL DIVE', cost: 6, ico: 'tbath', picks: 1, tier: 8, desc: 'Convert a chosen tooth into a PEARL TOOTH', flav: 'Fished from the oyster flats.' },
  { id: 'crystalspring', name: 'CRYSTAL SPRING', cost: 7, ico: 'tdiamond', picks: 1, tier: 10, desc: 'Convert a chosen tooth into a CRYSTAL TOOTH', flav: 'Bottled at the source.' },
];

// --------------------------------------------- snack-stand pack products --
const PACK_DEFS = [
  { id: 'gummies', name: 'TOOTHIE GUMMIES', brand: 'TOOTHIE', sub: 'GUMMIES', cost: 5, kind: 'tooth', show: 3, picks: 1, boost: 1, col: '#c9556a', flav: 'Now with 20% more chew.' },
  { id: 'chomppops', name: 'CHOMP-POPS', brand: 'CHOMP', sub: 'POPS', cost: 8, kind: 'tooth', show: 5, picks: 1, boost: 2, col: '#e8a020', flav: 'The lolly that bites back.' },
  { id: 'sundae', name: 'SWAMP SUNDAE', brand: 'SWAMP', sub: 'SUNDAE', cost: 12, kind: 'tooth', show: 5, picks: 2, boost: 3, col: '#7fd4e8', flav: 'Two scoops. Pick two teeth.' },
  { id: 'tacklebox', name: 'DENTAL TOOL KIT 101', brand: 'DENTAL', sub: 'TOOL KIT 101', cost: 6, kind: 'tool', show: 2, picks: 1, col: '#3a9a8a', flav: 'Everything a rookie needs. Sterilized-ish.' },
  { id: 'toolbelt', name: 'RANGER TOOLBELT', brand: 'RANGER', sub: 'TOOLBELT', cost: 11, kind: 'tool', show: 4, picks: 1, col: '#8a6510', flav: 'Every loop holds a promise.' },
];

// ---------------- scout gacha-pon: SPEND COOKIES on capsule prizes --------
// meta.rp is the SCOUT COOKIE balance (kept under the old key so saves migrate)
const GACHA_SPIN = 25;
const PERKS = {
  pocket: { name: 'DEEP POCKETS', desc: 'Start every run with +$3', ico: 'coin' },
  coupon: { name: 'MERLE COUPON', desc: 'First shop reroll each visit is FREE', ico: 'star' },
  bigpack: { name: 'FAT PACKS', desc: 'Snack packs show +1 option', ico: 'gem' },
};
function exchangeItems() {
  return [...CHARMS, ...CONS, ...TOOLS].filter(d => d.tier).sort((a, b) => a.tier - b.tier);
}
function cardUnlocked(def) { return !def.tier || !!(meta.unlocked && meta.unlocked[def.id]); }
// every prize still locked, tagged with capsule rarity 0..3
function gachaPool() {
  const p = [];
  exchangeItems().forEach(d => {
    if (meta.unlocked[d.id]) return;
    p.push({ kind: 'card', def: d, rar: d.tier <= 5 ? 0 : d.tier <= 10 ? 1 : 2 });
  });
  GLOVE_ORDER.forEach(k => { if (GLOVES[k].gacha && !meta.gachaOwn[k]) p.push({ kind: 'glove', k, rar: 2 }); });
  HAT_ORDER.forEach(k => { if (HATS[k].gacha && !meta.hatOwn[k]) p.push({ kind: 'hat', k, rar: 3 }); });
  GEAR_ORDER.forEach(k => { if (GEAR[k].gacha && !meta.gearOwn[k]) p.push({ kind: 'gear', k, rar: 3 }); });
  Object.keys(PERKS).forEach(k => { if (!meta.perks[k]) p.push({ kind: 'perk', k, rar: 3 }); });
  return p;
}
function gachaSpin() {
  if (G.gacha && G.gacha.phase !== 'reveal') return;
  if ((meta.rp || 0) < GACHA_SPIN) { sfx.error(); float(mx, my - 10, 'NOT ENOUGH COOKIES', C.red, 1); return; }
  meta.rp -= GACHA_SPIN;
  const pool = gachaPool();
  let prize;
  if (!pool.length) {
    prize = { kind: 'jar' }; // collection complete: cookie jar refund capsule
  } else {
    const wts = pool.map(z => [100, 45, 16, 6][z.rar]);
    let r = rnd() * wts.reduce((a, b) => a + b, 0);
    prize = pool[0];
    for (let i = 0; i < pool.length; i++) { r -= wts[i]; if (r <= 0) { prize = pool[i]; break; } }
  }
  G.gacha = { phase: 'crank', t: 0, prize, capCol: choice(['#ff8ab0', '#7fd4e8', '#ffe089', '#a8e86a', '#c8a8f8']) };
  saveMeta();
  sfx.buy();
}
function gachaAward(prize) {
  if (prize.kind === 'card') { meta.unlocked[prize.def.id] = true; toasts.push({ name: prize.def.name + ' UNLOCKED!', sub: 'NOW IN YOUR SHOP POOL', t: 0 }); }
  else if (prize.kind === 'glove') { meta.gachaOwn[prize.k] = true; toasts.push({ name: GLOVES[prize.k].name + '!', sub: 'NEW GLOVE ON THE MENU RACK', t: 0 }); }
  else if (prize.kind === 'hat') { meta.hatOwn[prize.k] = true; toasts.push({ name: HATS[prize.k].name + '!', sub: 'NEW HAT ON THE MENU RACK', t: 0 }); }
  else if (prize.kind === 'gear') { meta.gearOwn[prize.k] = true; toasts.push({ name: GEAR[prize.k].name + '!', sub: 'NEW GEAR IN THE DRESSING ROOM', t: 0 }); }
  else if (prize.kind === 'perk') { meta.perks[prize.k] = true; toasts.push({ name: PERKS[prize.k].name + '!', sub: 'PERMANENT UPGRADE ACTIVE', t: 0 }); }
  else { meta.rp = (meta.rp || 0) + 15; toasts.push({ name: 'COOKIE JAR!', sub: '+15 COOKIES BACK', t: 0 }); }
  saveMeta();
  sfx.ach();
}
const gachaPrizeInfo = z =>
  z.kind === 'card' ? { name: z.def.name, desc: z.def.desc, rar: z.rar }
    : z.kind === 'glove' ? { name: GLOVES[z.k].name, desc: 'GLOVE SKIN - ' + GLOVES[z.k].flav, rar: 2 }
      : z.kind === 'hat' ? { name: HATS[z.k].name, desc: 'HAT - ' + HATS[z.k].flav, rar: 3 }
        : z.kind === 'gear' ? { name: GEAR[z.k].name, desc: 'FACE GEAR - ' + GEAR[z.k].flav, rar: GEAR[z.k].rar || 3 }
          : z.kind === 'perk' ? { name: PERKS[z.k].name, desc: PERKS[z.k].desc, rar: 3 }
            : { name: 'COOKIE JAR', desc: 'You own everything! +15 cookies back.', rar: 1 };

// three quest-giver NPCs, each with a PERMANENT quest chain (not daily)
const NPCS = {
  granny: { name: 'GRANNY SNAPPER', who: 'the old turtle', col: '#8fae68', line: 'Back in my day we pressed teeth uphill both ways.' },
  crow: { name: 'FERRYMAN CROW', who: 'the river crow', col: '#9fb2c8', line: 'The trail provides, ranger. For a fee.' },
  doc: { name: 'DOC MUDBUG', who: 'the crawfish dentist', col: '#e08898', line: 'Open wide! Not you, ranger. The gator.' },
};
const NPC_ORDER = ['granny', 'crow', 'doc'];
// -------- QUEST BOARD: 3 simple postings pinned up, accept up to 2 at a time -
// completing a post pays cookies, then a fresh posting is pinned in its place.
// Progress events route through quest(id, n). Kept short + plain on purpose.
const BOARD_POOL = [
  { id: 'press30', name: 'PRESS 40 TEETH', goal: 40, rp: 20, ico: 'tooth' },
  { id: 'bank8', name: 'BANK 10 BITES', goal: 10, rp: 20, ico: 'coin' },
  { id: 'sweep1', name: 'PULL A CLEAN SWEEP', goal: 1, rp: 20, ico: 'star' },
  { id: 'boss1q', name: 'DEFEAT A BOSS', goal: 1, rp: 25, ico: 'skull' },
  { id: 'xray8', name: 'X-RAY 12 TEETH', goal: 12, rp: 20, ico: 'eye' },
  { id: 'buy4', name: 'BUY 5 SHOP ITEMS', goal: 5, rp: 20, ico: 'money' },
  { id: 'ante3q', name: 'REACH ANTE 3', goal: 1, rp: 20, ico: 'compass' },
  { id: 'gold1', name: 'BEAT A GOLDEN GATOR', goal: 1, rp: 25, ico: 'crown' },
  { id: 'run1', name: 'WIN A RUN', goal: 1, rp: 50, ico: 'crown' },
];
const BOARD_SIZE = 3, QUEST_MAX = 2; // fewer notes, simpler cap
// the shopkeeper
const VENDOR = {
  name: 'MERLE', who: 'the manatee shopkeep',
  lines: [
    'Fresh gummies! Only slightly swamp-flavored.',
    'Them badges are hand-stitched. By me. With flippers.',
    'A sundae a day keeps the snappers away. Probably.',
    'Careful with the forceps, sugar.',
    'Cookies? Gacha-Pon machine is out back. Tell em Merle sent ya.',
    'That gator out there? Owes me money.',
    'Mrs Owlet docked my pay for the gummies. Worth it.',
    'You get used to the screaming. Mostly.',
    'I float for a living. You reach into mouths. We both made choices.',
    'Rusty badges are cheap because they ARE rusty. Be honest with yourself.',
    'Diamond finish costs extra. The shine is the whole point, sugar.',
    'No refunds on teeth. House rule. My house.',
    'Every ranger says they will bank early. Every ranger lies.',
    'If it bites you, that is between you and the gator.',
    'The manager wants a written report. I want a nap.',
    'I have seen a snail out-earn a raccoon. Play your strengths.',
  ],
};

let meta = { ach: {}, lifeSnaps: 0, glove: 'bare', hat: 'none', rp: 0, ranger: 'scout', daily: null, unlocked: {}, chains: null, set: null, itchFollow: false, gachaOwn: {}, hatOwn: {}, perks: {}, summer: null, qb: null, mastery: {} };
try { const m = JSON.parse(localStorage.getItem('bd_meta') || 'null'); if (m) meta = Object.assign(meta, m); } catch (e) { }
if (!meta.unlocked) meta.unlocked = {};
if (!meta.gachaOwn) meta.gachaOwn = {};
if (!meta.hatOwn) meta.hatOwn = {};
if (!meta.hat) meta.hat = 'none';
if (!meta.perks) meta.perks = {};
// SUMMER EVENT progress: photographed mutations, tickets earned, quest claims
if (!meta.summer) meta.summer = { caught: {}, tix: 0, q: {}, unlocked: false, won: false };
if (!meta.set) meta.set = { mus: 2, sfx: 2, shake: 1, crt: 1 };
if (!meta.chains) meta.chains = { granny: { step: 0, prog: 0 }, crow: { step: 0, prog: 0 }, doc: { step: 0, prog: 0 } };
if (!meta.gearOwn) meta.gearOwn = {};
if (!meta.gear) meta.gear = 'none';
// CROC INDEX: every variant / boss you have met, and which finds you cashed in
if (!meta.index) meta.index = { seen: {}, claimed: {} };
// per-ranger MASTERY: field hours logged, which rank up into exclusive badges
if (!meta.mastery) meta.mastery = {};
function saveMeta() { try { localStorage.setItem('bd_meta', JSON.stringify(meta)); } catch (e) { } }

// ============================== OUTFITS ====================================
//  Four more wardrobe slots on top of hats, face gear and gloves: SHIRTS,
//  PANTS, SHOES and full-body SUITS (costumes with a hood).  Every piece has
//  a rarity and a place it is sold - the run shop's closet ($), Mrs Owlet's
//  trading booth (cookies), her owl-only specials, or a follow reward.
//  src: 'free' | 'shop' | 'booth' | 'owl' | 'itch' | 'tiktok'
// ==========================================================================
const ITCH_URL = 'https://pukkingdragon123.itch.io/';
const TIKTOK_URL = 'https://www.tiktok.com/@wombaton.studios?_r=1&_t=ZS-9A1PY11nWLM';
const FIT_CATS = ['shirt', 'pants', 'shoes', 'suit'];
const FITS = {
  // ---------------------------------------------------------------- SHIRTS
  rangershirt: { cat: 'shirt', name: 'RANGER JACKET', rar: 0, src: 'free', flav: 'Standard issue. Smells of swamp.' },
  plaintee: { cat: 'shirt', name: 'PLAIN TEE', rar: 0, src: 'shop', col: '#e8e4d8', pat: 'none', flav: 'A blank canvas for gator spit.' },
  sailor: { cat: 'shirt', name: 'SAILOR STRIPES', rar: 1, src: 'shop', col: '#f0ece0', col2: '#2a4a8a', pat: 'stripes', flav: 'Ahoy, molars.' },
  flannel: { cat: 'shirt', name: 'SWAMP FLANNEL', rar: 1, src: 'shop', col: '#b83a2a', col2: '#3a1410', pat: 'plaid', flav: 'Chops wood. Pulls teeth.' },
  hoodie: { cat: 'shirt', name: 'COZY HOODIE', rar: 2, src: 'shop', col: '#8a98a8', col2: '#5a6878', pat: 'hoodie', flav: 'Hood up, worries down.' },
  hawaiian: { cat: 'shirt', name: 'BAYOU HAWAIIAN', rar: 2, src: 'shop', col: '#2aa8a0', col2: '#ff8ab0', pat: 'flowers', flav: 'Vacation mode: permanent.' },
  gatortee: { cat: 'shirt', name: 'BITE DOWN MERCH TEE', rar: 2, src: 'booth', col: '#3a8a3a', col2: '#f4ecd4', pat: 'gatorlogo', flav: 'Official. Mostly.' },
  jersey: { cat: 'shirt', name: 'GATORS #8 JERSEY', rar: 3, src: 'shop', col: '#e8c040', col2: '#2a6a2a', pat: 'jersey', flav: 'Undefeated at the bank.' },
  tiedye: { cat: 'shirt', name: 'TIE-DYE TEE', rar: 3, src: 'booth', col: '#ff8a4a', col2: '#4ab8e8', pat: 'tiedye', flav: 'Far out, gator.' },
  tux: { cat: 'shirt', name: 'BLACK TIE', rar: 4, src: 'booth', col: '#1e2226', col2: '#f4f0e8', pat: 'tux', flav: 'For extractions of the utmost class.' },
  wombattee: { cat: 'shirt', name: 'WOMBAT TEE', rar: 4, src: 'tiktok', col: '#6a8ad0', col2: '#8a6a4a', pat: 'wombat', flav: 'Wombaton Studios, represent.' },
  galaxytee: { cat: 'shirt', name: 'GALAXY TEE', rar: 5, src: 'owl', col: '#2a1a4a', col2: '#c8a8f8', pat: 'galaxy', flav: 'Mrs Owlet found it in lost property.' },
  owlknit: { cat: 'shirt', name: "OWLET'S KNIT", rar: 5, src: 'owl', col: '#673660', col2: '#a8739c', pat: 'knit', flav: 'She knitted it. She will know if you spill.' },
  // ----------------------------------------------------------------- PANTS
  rangerpants: { cat: 'pants', name: 'RANGER TROUSERS', rar: 0, src: 'free', flav: 'Pockets for teeth.' },
  jeans: { cat: 'pants', name: 'BLUE JEANS', rar: 0, src: 'shop', col: '#3a5a9a', col2: '#8aa8d8', pat: 'denim', flav: 'Pre-ripped by a gator.' },
  cargo: { cat: 'pants', name: 'CARGO SHORTS', rar: 1, src: 'shop', col: '#9a8a5a', col2: '#6a5a34', pat: 'cargo', shorts: 1, flav: 'Seven pockets. All wet.' },
  plaidshorts: { cat: 'pants', name: 'PLAID SHORTS', rar: 1, src: 'shop', col: '#c85a3a', col2: '#f4d060', pat: 'plaid', shorts: 1, flav: 'Loud. Proud.' },
  camo: { cat: 'pants', name: 'SWAMP CAMO', rar: 2, src: 'shop', col: '#5a6a3a', col2: '#2e3a1e', pat: 'camo', flav: 'The gators cannot see you. Probably.' },
  polka: { cat: 'pants', name: 'POLKA PANTS', rar: 2, src: 'booth', col: '#e84a6a', col2: '#fff4f0', pat: 'dots', flav: 'Dot dot dot.' },
  pajama: { cat: 'pants', name: 'STARRY PAJAMAS', rar: 2, src: 'booth', col: '#3a4a8a', col2: '#ffe089', pat: 'stars', flav: 'Straight out of bed, onto the job.' },
  kilt: { cat: 'pants', name: 'BAYOU KILT', rar: 3, src: 'shop', col: '#2a6a4a', col2: '#c83a2a', pat: 'plaid', kilt: 1, flav: 'Breezy.' },
  gatorprint: { cat: 'pants', name: 'GATOR PRINT', rar: 3, src: 'booth', col: '#4a8a3a', col2: '#2a5a24', pat: 'scales', flav: 'Wear the enemy.' },
  rainbow: { cat: 'pants', name: 'RAINBOW LEGGINGS', rar: 4, src: 'booth', col: '#e84a4a', pat: 'rainbow', flav: 'Every colour of the marsh at sunset.' },
  goldpants: { cat: 'pants', name: 'GILDED SLACKS', rar: 5, src: 'owl', col: '#e8b830', col2: '#fff0a0', pat: 'shine', flav: 'Heavy. Very heavy.' },
  // ----------------------------------------------------------------- SHOES
  rangerboots: { cat: 'shoes', name: 'RANGER BOOTS', rar: 0, src: 'free', flav: 'Waterproof on a good day.' },
  sneakers: { cat: 'shoes', name: 'SWAMP SNEAKERS', rar: 0, src: 'shop', col: '#e8e4dc', col2: '#d83a3a', style: 'sneaker', flav: 'Squeak on the boardwalk.' },
  rainboots: { cat: 'shoes', name: 'RAIN BOOTS', rar: 1, src: 'shop', col: '#f0c030', col2: '#a87a10', style: 'tall', flav: 'Puddles fear you.' },
  flipflops: { cat: 'shoes', name: 'FLIP FLOPS', rar: 1, src: 'shop', col: '#4ab8e8', col2: '#f0e0a0', style: 'flip', flav: 'Flip. Flop. Flee.' },
  flippers: { cat: 'shoes', name: 'SWIM FLIPPERS', rar: 2, src: 'shop', col: '#3ac86a', col2: '#1a7a3a', style: 'flipper', flav: 'Fast in water. Hilarious on land.' },
  cowboy: { cat: 'shoes', name: 'COWBOY BOOTS', rar: 2, src: 'shop', col: '#8a5a2a', col2: '#c8a060', style: 'cowboy', flav: 'Spurs sold separately.' },
  bunny: { cat: 'shoes', name: 'BUNNY SLIPPERS', rar: 3, src: 'booth', col: '#f8d8e0', col2: '#e87a9a', style: 'bunny', flav: 'Hop to it.' },
  clown: { cat: 'shoes', name: 'CLOWN SHOES', rar: 3, src: 'booth', col: '#d83a3a', col2: '#f4f0e8', style: 'clown', flav: 'Honk honk, dentist.' },
  gatorslip: { cat: 'shoes', name: 'GATOR SLIPPERS', rar: 3, src: 'booth', col: '#4a9a3a', col2: '#f4ecd4', style: 'gator', flav: 'Official merch. They bite back.' },
  skates: { cat: 'shoes', name: 'ROLLER SKATES', rar: 4, src: 'booth', col: '#e84a8a', col2: '#f8e060', style: 'skate', flav: 'Roll up to the maw in style.' },
  goldkicks: { cat: 'shoes', name: 'GOLDEN KICKS', rar: 5, src: 'owl', col: '#e8b830', col2: '#fff4b0', style: 'sneaker', shine: 1, flav: 'Mrs Owlet wore them in 1971.' },
  // ----------------------------------------------------------------- SUITS
  nosuit: { cat: 'suit', name: 'NO COSTUME', rar: 0, src: 'free', flav: 'Just the uniform.' },
  bee: { cat: 'suit', name: 'BUSY BEE', rar: 2, src: 'shop', col: '#f0c030', col2: '#1e1a14', pat: 'stripes', hood: '#1e1a14', extra: 'bee', flav: 'Bzz. Open wide.' },
  ducky: { cat: 'suit', name: 'RUBBER DUCKY', rar: 2, src: 'shop', col: '#f8d840', col2: '#f08a2a', hood: '#f8d840', extra: 'duck', flav: 'Floats. Squeaks. Pulls teeth.' },
  pumpkin: { cat: 'suit', name: 'PUMPKIN PAL', rar: 2, src: 'shop', col: '#e87a2a', col2: '#a84a10', pat: 'ridges', extra: 'pumpkin', flav: 'Carved with love.' },
  shark: { cat: 'suit', name: 'SHARK ONESIE', rar: 3, src: 'shop', col: '#6a8aa8', col2: '#f0f0f0', hood: '#6a8aa8', extra: 'shark', belly: 1, flav: 'The other apex predator.' },
  banana: { cat: 'suit', name: 'BANANA SUIT', rar: 3, src: 'booth', col: '#f8e050', col2: '#c8a820', hood: '#f8e050', extra: 'banana', flav: 'Peak potassium performance.' },
  hotdog: { cat: 'suit', name: 'HOT DOG', rar: 3, src: 'booth', col: '#c8503a', col2: '#e8b870', extra: 'hotdog', flav: 'Relish the moment.' },
  crocsuit: { cat: 'suit', name: 'CROC MERCH ONESIE', rar: 4, src: 'booth', col: '#4a9a3a', col2: '#e8dca8', pat: 'scales', hood: '#4a9a3a', extra: 'croc', belly: 1, flav: 'Official BITE DOWN merch. Very soft.' },
  dino: { cat: 'suit', name: 'DINO SUIT', rar: 4, src: 'booth', col: '#8a5ad0', col2: '#f0a030', hood: '#8a5ad0', extra: 'dino', belly: 1, flav: 'Rawr means open wide in dinosaur.' },
  knight: { cat: 'suit', name: 'MARSH KNIGHT', rar: 4, src: 'shop', col: '#a8b4bc', col2: '#5a6a74', pat: 'plates', hood: '#8a98a0', extra: 'knight', flav: 'Tooth fairy? No. Tooth KNIGHT.' },
  astronaut: { cat: 'suit', name: 'ASTRO RANGER', rar: 5, src: 'owl', col: '#eceae4', col2: '#d8603a', hood: '#eceae4', extra: 'astro', flav: 'One small press for a ranger.' },
};
const FIT_ORDER = {};
FIT_CATS.forEach(c => { FIT_ORDER[c] = Object.keys(FITS).filter(k => FITS[k].cat === c); });
const FIT_DEFAULT = { shirt: 'rangershirt', pants: 'rangerpants', shoes: 'rangerboots', suit: 'nosuit' };
if (!meta.fit) meta.fit = Object.assign({}, FIT_DEFAULT);
if (!meta.fitOwn) meta.fitOwn = {};
const fitUnlocked = k => !!FITS[k] && (FITS[k].src === 'free' || !!meta.fitOwn[k]);
// everything the player's own ranger is wearing, spread into drawBobble opts
function myFit() { return { hat: meta.hat, gear: meta.gear, glove: meta.glove, fit: meta.fit }; }
const rampOf = c => [mixC(c, '#000000', 0.72), mixC(c, '#000000', 0.38), c, mixC(c, '#ffffff', 0.2), mixC(c, '#ffffff', 0.45)];

// a surface pattern painted inside a piece of clothing
function fitPattern(f, x, y, w, h, phase) {
  const c2 = f.col2 || mixC(f.col, '#000000', 0.4);
  ctx.save(); ctx.beginPath(); ctx.rect(x + 1, y + 1, w - 2, h - 2); ctx.clip();
  switch (f.pat) {
    case 'stripes': for (let j = 1; j < h; j += 3) rect(x, y + j, w, 1, c2); break;
    case 'plaid': for (let j = 1; j < h; j += 4) rect(x, y + j, w, 1, c2); for (let i = 1; i < w; i += 4) rect(x + i, y, 1, h, c2); for (let j = 3; j < h; j += 4) for (let i = 3; i < w; i += 4) rect(x + i, y + j, 1, 1, mixC(f.col, '#ffffff', 0.4)); break;
    case 'dots': for (let j = 1; j < h; j += 3) for (let i = 1 + (j % 2); i < w; i += 3) rect(x + i, y + j, 1, 1, c2); break;
    case 'stars': for (let k = 0; k < w * h / 14; k++) { const sx = x + 1 + Math.floor(hash2(k, 3) * (w - 2)), sy = y + 1 + Math.floor(hash2(k, 4) * (h - 2)); rect(sx, sy, 1, 1, c2); } break;
    case 'flowers': for (let k = 0; k < w * h / 18; k++) { const sx = x + 1 + Math.floor(hash2(k, 5) * (w - 3)), sy = y + 1 + Math.floor(hash2(k, 6) * (h - 3)); rect(sx, sy + 1, 3, 1, c2); rect(sx + 1, sy, 1, 3, c2); rect(sx + 1, sy + 1, 1, 1, '#ffe060'); } break;
    case 'camo': for (let k = 0; k < w * h / 8; k++) { const sx = x + Math.floor(hash2(k, 7) * w), sy = y + Math.floor(hash2(k, 8) * h); rect(sx, sy, 2 + (k % 2), 2, k % 3 ? c2 : '#8a8a4a'); } break;
    case 'scales': for (let j = 1; j < h; j += 3) for (let i = (j % 2) * 2; i < w; i += 4) { rect(x + i, y + j, 3, 1, c2); } break;
    case 'denim': for (let i = 2; i < w; i += 3) rect(x + i, y, 1, h, mixC(f.col, '#ffffff', 0.15)); rect(x + (w >> 1), y, 1, h, c2); break;
    case 'cargo': rect(x + 1, y + 3, w - 2, 3, c2); rect(x + 1, y + 3, w - 2, 1, mixC(f.col, '#ffffff', 0.3)); break;
    case 'rainbow': ['#e84a4a', '#f89a3a', '#f8e050', '#5ac86a', '#4a9ae8', '#9a6ad8'].forEach((c, i) => rect(x, y + Math.floor(i * h / 6), w, Math.ceil(h / 6), c)); break;
    case 'shine': rect(x + 1, y + 1, 1, h - 2, '#ffffff'); if (Math.sin(tNow * 4 + phase) > 0.6) rect(x + 2, y + 2, 1, 1, '#ffffff'); break;
    case 'tiedye': for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const d = Math.hypot(i - w / 2, j - h / 2); rect(x + i, y + j, 1, 1, ['#ff8a4a', '#f8e050', '#5ac86a', '#4ab8e8', '#c86ad8'][Math.floor(d / 2) % 5]); } break;
    case 'galaxy': for (let k = 0; k < w * h / 10; k++) { const sx = x + Math.floor(hash2(k, 9) * w), sy = y + Math.floor(hash2(k, 10) * h); rect(sx, sy, 1, 1, k % 4 ? c2 : '#ffffff'); } rect(x + 2, y + (h >> 1), w - 4, 1, mixC(f.col, c2, 0.5)); break;
    case 'knit': for (let j = 0; j < h; j += 2) for (let i = 0; i < w; i += 2) { rect(x + i, y + j + ((i >> 1) & 1), 1, 1, mixC(f.col, '#000000', 0.3)); rect(x + i + 1, y + j + 1 - ((i >> 1) & 1), 1, 1, c2); } break;
    case 'ridges': for (let i = 2; i < w; i += 4) rect(x + i, y, 1, h, c2); break;
    case 'plates': for (let j = 3; j < h; j += 5) { rect(x, y + j, w, 1, c2); rect(x, y + j + 1, w, 1, '#e8f0f4'); } break;
  }
  ctx.restore();
}
// the chest decoration that sits on top of a shirt's fabric
function fitShirtFront(f, by) {
  const c2 = f.col2 || '#ffffff';
  if (f.pat === 'tux') {
    for (let r = 0; r < 12; r++) rect(-Math.max(0, 4 - (r >> 1)), by + 1 + r, Math.max(1, 9 - r), 1, c2);
    rect(-3, by + 1, 7, 1, c2); rr(-3, by + 1, 7, 3, 1, '#c8303a'); rect(0, by + 2, 1, 1, '#801818');
    rect(0, by + 6, 1, 1, '#1a1a1a'); rect(0, by + 9, 1, 1, '#1a1a1a');
  } else if (f.pat === 'hoodie') {
    rr(-5, by + 8, 11, 5, 2, c2); rect(-4, by + 8, 9, 1, mixC(f.col, '#ffffff', 0.25));
    rect(-2, by + 1, 1, 5, '#f0f0f0'); rect(2, by + 1, 1, 5, '#f0f0f0');
  } else if (f.pat === 'jersey') {
    rect(-10, by + 3, 21, 2, c2); drawText('8', -2, by + 7, c2, 1);
  } else if (f.pat === 'gatorlogo') {
    rr(-4, by + 4, 9, 6, 1, '#2a6a2a'); rect(-3, by + 3, 2, 2, '#2a6a2a'); rect(2, by + 3, 2, 2, '#2a6a2a');
    rect(-3, by + 3, 1, 1, '#f8e060'); rect(3, by + 3, 1, 1, '#f8e060');
    for (let k = 0; k < 4; k++) rect(-3 + k * 2, by + 8, 1, 1, c2);
  } else if (f.pat === 'wombat') {
    fillCircle(0, by + 7, 4, c2); rect(-4, by + 3, 2, 2, c2); rect(3, by + 3, 2, 2, c2);
    rr(-2, by + 7, 5, 3, 1, '#d8b890'); rect(-2, by + 6, 1, 1, '#1a1208'); rect(2, by + 6, 1, 1, '#1a1208'); rect(0, by + 7, 1, 1, '#1a1208');
  }
}
// a pair of shoes on one foot at (x, y) - w/h match the old boot box
function fitShoe(f, x, y, sc) {
  if (!f || f.src === 'free') { plasticBox(x, y, 10, 6, 2, BOOT, { noShine: 1 }); return; }
  const R = rampOf(f.col), c2 = f.col2 || '#ffffff';
  switch (f.style) {
    case 'sneaker':
      plasticBox(x, y, 10, 6, 2, R, { noShine: 1, seed: 3 }); rect(x + 1, y + 4, 9, 2, '#f8f8f4'); rect(x + 1, y + 5, 9, 1, '#b8b8b0');
      rect(x + 3, y + 1, 1, 2, c2); rect(x + 5, y + 1, 1, 2, c2); rect(x + 7, y + 2, 2, 1, c2);
      if (f.shine && Math.sin(tNow * 5 + x) > 0.5) rect(x + 2, y + 1, 1, 1, '#ffffff');
      break;
    case 'tall': plasticBox(x, y - 3, 10, 9, 2, R, { seed: 5 }); rect(x + 1, y + 4, 9, 2, R[1]); rect(x + 2, y - 2, 1, 5, R[4]); break;
    case 'flip': rect(x, y + 4, 10, 2, R[0]); rect(x + 1, y + 4, 9, 1, c2); rect(x + 4, y + 1, 1, 3, R[2]); rect(x + 3, y + 1, 3, 1, R[2]); break;
    case 'flipper': plasticBox(x - 1, y + 2, 15, 4, 2, R, { noShine: 1 }); for (let k = 0; k < 3; k++) rect(x + 5 + k * 3, y + 3, 1, 2, R[1]); plasticBox(x, y, 7, 4, 1, R, { noShine: 1 }); break;
    case 'cowboy': plasticBox(x, y - 2, 10, 8, 2, R, { noShine: 1 }); rect(x + 8, y + 3, 3, 3, R[2]); rect(x + 1, y + 5, 3, 1, '#1a1208'); rect(x + 3, y, 5, 1, c2); rect(x + 3, y + 2, 5, 1, c2); break;
    case 'bunny': plasticBox(x - 1, y, 12, 6, 3, R, { noShine: 1 }); rect(x + 1, y - 4, 2, 5, R[2]); rect(x + 5, y - 4, 2, 5, R[2]); rect(x + 1, y - 3, 1, 3, c2); rect(x + 5, y - 3, 1, 3, c2); rect(x + 8, y + 2, 1, 1, '#1a1208'); rect(x + 9, y + 3, 1, 1, c2); break;
    case 'clown': plasticBox(x - 2, y, 15, 6, 3, R, { seed: 2 }); rect(x + 6, y + 1, 3, 2, c2); break;
    case 'gator': plasticBox(x - 1, y, 13, 6, 2, R, { noShine: 1 }); rect(x + 6, y - 1, 2, 2, R[2]); rect(x + 9, y - 1, 2, 2, R[2]); rect(x + 6, y - 1, 1, 1, '#f8e060'); rect(x + 9, y - 1, 1, 1, '#f8e060'); for (let k = 0; k < 4; k++) rect(x + 3 + k * 2, y + 4, 1, 1, c2); break;
    case 'skate': plasticBox(x, y - 2, 10, 6, 2, R, { noShine: 1 }); rect(x, y + 4, 10, 1, '#8a8a8a'); fillCircle(x + 2, y + 6, 1, c2); fillCircle(x + 8, y + 6, 1, c2); break;
    default: plasticBox(x, y, 10, 6, 2, R, { noShine: 1 });
  }
}
// hooded costumes: the back of the hood (drawn before the head)...
function suitHoodBack(f) {
  if (!f.hood) return;
  const R = rampOf(f.hood);
  plasticBox(-16, -19, 32, 31, 11, R, { seed: 11 });
  if (f.extra === 'banana') { for (let k = 0; k < 3; k++) { const px = -12 + k * 10; plasticBox(px, 4, 7, 14, 3, R, { noShine: 1 }); } }
  if (f.extra === 'astro') { ringPx(0, -3, 16, '#1a1a1a'); ringPx(0, -3, 15, '#9ac8e8'); }
}
// ...and the front: a brow band framing the face, plus the costume's trimmings
function suitHoodFront(f, topeyes) {
  if (!f.hood) return;
  const R = rampOf(f.hood);
  if (!topeyes) plasticBox(-15, -20, 30, 9, 5, R, { noShine: 1, seed: 12 });
  const e = f.extra;
  if (e === 'banana') { rect(-1, -26, 3, 6, '#6a4a14'); rect(0, -27, 1, 1, '#3a2a0a'); rect(-10, -18, 20, 1, f.col2); }
  if (e === 'croc') {
    [-8, 8].forEach(sx => { plasticBox(sx - 4, -25, 9, 7, 3, R, { noShine: 1 }); rr(sx - 2, -24, 5, 4, 1, '#f0d040'); rect(sx, -24, 1, 4, '#1a1206'); });
    for (let k = 0; k < 7; k++) { rect(-12 + k * 4, -12, 2, 2, '#f8f4e8'); rect(-11 + k * 4, -10, 1, 1, '#f8f4e8'); }
  }
  if (e === 'shark') { for (let r = 0; r < 8; r++) rect(-1 - (r >> 1), -28 + r, 2 + (r >> 1), 1, R[r < 2 ? 3 : 2]); for (let k = 0; k < 7; k++) rect(-12 + k * 4, -12, 2, 2, '#f8f8f8'); }
  if (e === 'dino') { for (let k = 0; k < 4; k++) { const sx = -9 + k * 6; rect(sx, -23, 3, 3, f.col2); rect(sx + 1, -25, 1, 2, f.col2); } }
  if (e === 'bee') { [-5, 5].forEach(sx => { pxLine(sx, -20, sx * 1.6, -28, '#1e1a14'); fillCircle(sx * 1.6, -29, 2, '#1e1a14'); }); }
  if (e === 'duck') { rr(-5, -14, 11, 4, 2, f.col2); rect(-4, -14, 9, 1, mixC(f.col2, '#ffffff', 0.4)); rect(-9, -19, 2, 2, '#1a1a1a'); rect(8, -19, 2, 2, '#1a1a1a'); }
  if (e === 'knight') { rect(-2, -30, 4, 10, '#c8303a'); rect(-3, -31, 6, 3, '#e84a4a'); for (let k = 0; k < 5; k++) rect(-10 + k * 5, -16, 1, 2, R[1]); }
  if (e === 'astro') { ctx.save(); ctx.globalAlpha = 0.25; rect(-12, -14, 4, 10, '#ffffff'); rect(-7, -16, 2, 4, '#ffffff'); ctx.restore(); rect(-2, -20, 4, 2, f.col2); }
}
// trimmings behind the body (wings, spikes, the other half of the bun)
function suitBack(f, by) {
  const e = f.extra;
  if (e === 'bee') { ctx.save(); ctx.globalAlpha = 0.6; [-1, 1].forEach(s => { const fl = Math.sin(tNow * 30) * 2; rr(s * 10 - (s < 0 ? 9 : 0), by - 4 + fl, 9, 12, 4, '#e8f4ff'); }); ctx.restore(); }
  if (e === 'dino') for (let k = 0; k < 4; k++) { rect(9, by + 2 + k * 5, 4, 3, f.col2); rect(12, by + 3 + k * 5, 2, 1, f.col2); }
  if (e === 'hotdog') { plasticBox(-15, by - 2, 30, 22, 8, rampOf(f.col2), { seed: 4 }); }
  if (e === 'astro') plasticBox(-12, by + 1, 24, 14, 3, ['#1a1a1a', '#8a8a8a', '#c8c8c8', '#e0e0e0', '#ffffff'], { noShine: 1 });
  if (e === 'croc' || e === 'shark') { rect(8, by + 12, 8, 4, rampOf(f.col)[2]); rect(14, by + 13, 4, 2, rampOf(f.col)[1]); }
}
// and the costume's front details over the torso
function suitFront(f, by) {
  const e = f.extra;
  if (f.belly) { rr(-5, by + 3, 11, 13, 4, f.col2); for (let j = by + 5; j < by + 15; j += 3) rect(-4, j, 9, 1, mixC(f.col2, '#000000', 0.15)); }
  if (e === 'hotdog') { for (let k = 0; k < 5; k++) { rect(-7 + k * 3, by + 6 + (k % 2), 2, 1, '#f8d020'); } }
  if (e === 'duck') { plasticBox(-13, by + 10, 27, 6, 3, rampOf('#f08a2a'), { noShine: 1 }); rect(-12, by + 11, 25, 1, '#f8c080'); }
  if (e === 'pumpkin') { rect(-3, by + 5, 2, 2, '#3a1a08'); rect(2, by + 5, 2, 2, '#3a1a08'); for (let k = 0; k < 5; k++) rect(-4 + k * 2, by + 10 + (k % 2), 1, 1, '#3a1a08'); }
  if (e === 'astro') { rr(-4, by + 4, 9, 6, 1, '#3a4a5a'); rect(-3, by + 5, 2, 1, '#ff4a3a'); rect(0, by + 5, 2, 1, '#5ac86a'); rect(3, by + 5, 1, 1, '#f8e060'); rect(-6, by + 12, 13, 1, f.col2); }
  if (e === 'knight') { rr(-3, by + 3, 7, 9, 2, '#c8a040'); rect(-1, by + 4, 3, 7, '#8a2a2a'); rect(-2, by + 6, 5, 2, '#8a2a2a'); }
}

// ======================= THE WHOLE WARDROBE CATALOGUE ======================
//  One interface over all seven slots so the wardrobe, Mrs Owlet's booth and
//  the run shop's closet all talk about "an item" the same way.
// ==========================================================================
const COS_CATS = [
  { id: 'hat', name: 'HATS' }, { id: 'shirt', name: 'SHIRTS' }, { id: 'pants', name: 'PANTS' },
  { id: 'shoes', name: 'SHOES' }, { id: 'suit', name: 'SUITS' }, { id: 'gear', name: 'FACE' }, { id: 'glove', name: 'GLOVES' },
];
const COS_SRC_NAME = {
  free: 'STARTER GEAR', shop: "GATOR'S CLOSET - THE RUN SHOP", booth: "MRS OWLET'S TRADING BOOTH", owl: "OWLET SPECIAL - HER BOOTH ONLY",
  itch: 'FREE: FOLLOW US ON ITCH.IO', tiktok: 'FREE: FOLLOW US ON TIKTOK', ach: 'EARNED BY AN ACHIEVEMENT',
};
const COOKIE_PRICE = [20, 35, 60, 100, 160, 250];
function cosList(cat) {
  if (cat === 'hat') return HAT_ORDER;
  if (cat === 'gear') return GEAR_ORDER;
  if (cat === 'glove') return GLOVE_ORDER;
  return FIT_ORDER[cat] || [];
}
function cosDef(cat, k) {
  if (cat === 'hat') return HATS[k];
  if (cat === 'gear') return GEAR[k];
  if (cat === 'glove') { const g = GLOVES[k]; return g && Object.assign({ rar: GLOVE_RAR[k] || 0 }, g); }
  return FITS[k];
}
function cosSrc(cat, k) {
  const d = cosDef(cat, k); if (!d) return 'free';
  if (d.src) return d.src;
  if (cat === 'glove') return k === 'bare' ? 'free' : d.gacha ? 'booth' : d.shop ? 'shop' : 'ach';
  if (d.free) return 'free';
  if (d.owl) return 'owl';
  if (d.itch) return 'itch';
  if (d.tiktok) return 'tiktok';
  if (d.gacha || d.booth) return 'booth';
  if (d.ach) return 'ach';
  return 'shop';
}
function cosOwned(cat, k) {
  if (cat === 'hat') return hatUnlocked(k);
  if (cat === 'gear') return gearUnlocked(k);
  if (cat === 'glove') return gloveUnlocked(k);
  return fitUnlocked(k);
}
function cosWorn(cat, k) {
  if (cat === 'hat') return meta.hat === k;
  if (cat === 'gear') return meta.gear === k;
  if (cat === 'glove') return meta.glove === k;
  return (meta.fit[cat] || FIT_DEFAULT[cat]) === k;
}
function cosEquip(cat, k) {
  if (cat === 'hat') meta.hat = k; else if (cat === 'gear') meta.gear = k; else if (cat === 'glove') meta.glove = k;
  else { meta.fit[cat] = k; if (cat === 'suit' && k !== 'nosuit') { /* a costume goes over everything */ } }
  saveMeta();
}
function cosGrant(cat, k, wear) {
  if (cat === 'hat') meta.hatOwn[k] = true; else if (cat === 'gear') meta.gearOwn[k] = true; else if (cat === 'glove') meta.gachaOwn[k] = true;
  else meta.fitOwn[k] = true;
  if (wear) cosEquip(cat, k);
  saveMeta();
}
function cosRevoke(cat, k) {
  if (cat === 'hat') { delete meta.hatOwn[k]; if (meta.hat === k) meta.hat = 'none'; }
  else if (cat === 'gear') { delete meta.gearOwn[k]; if (meta.gear === k) meta.gear = 'none'; }
  else if (cat === 'glove') { delete meta.gachaOwn[k]; if (meta.glove === k) meta.glove = 'bare'; }
  else { delete meta.fitOwn[k]; if (meta.fit[cat] === k) meta.fit[cat] = FIT_DEFAULT[cat]; }
  saveMeta();
}
function cosName(cat) { const c = COS_CATS.find(q => q.id === cat); return c ? c.name.replace(/S$/, '') : 'ITEM'; }
// the art for any wearable, centred on (cx, cy), roughly 24px across at sc 1
function cosIcon(cat, k, cx, cy, sc) {
  sc = sc || 1;
  if (cat === 'hat') { if (HATS[k].ico === 'none') { rect(cx - 5 * sc, cy, 10 * sc, 2, '#54707a'); return; } drawHatArt(cx, cy + 6 * sc, k, sc); return; }
  if (cat === 'gear') { if (k === 'none') { rect(cx - 5 * sc, cy, 10 * sc, 2, '#54707a'); return; } drawGearArt(cx, cy - 1, k, sc); return; }
  if (cat === 'glove') { ctx.save(); ctx.translate(cx - 6 * sc, cy - 6 * sc); ctx.scale(sc, sc); ICONS.glove(0, 0, GLOVES[k].skin); ctx.restore(); return; }
  drawFitIcon(cx, cy, k, sc * 0.9);
}

// ============================== THE WARDROBE ================================
//  A dressing room: a tall mirror on the left shows your ranger (hover any
//  piece to try it on), a big oak armoire on the right swings its doors open
//  on a rail of clothes and shelves of hats and shoes.  Every piece shows its
//  rarity, and anything you do not own tells you exactly where it is sold.
// ==========================================================================
function wardrobeStatic() {
  // rose damask wallpaper
  const WP = ['#2a1420', '#4a2434', '#5a2e40', '#6a384c', '#7e465c'];
  rect(0, 0, W, 240, WP[2]);
  for (let x = 0; x < W; x += 12) { rect(x, 0, 1, 240, WP[1]); rect(x + 6, 0, 1, 240, WP[3]); }
  for (let y = 10; y < 236; y += 16) for (let x = 3 + ((y / 16) & 1) * 6; x < W; x += 12) { rect(x, y, 1, 1, WP[4]); rect(x - 1, y + 1, 3, 1, WP[3]); rect(x, y + 2, 1, 1, WP[4]); }
  grainRect(0, 0, W, 240, WP[1], null, 0.02, 7);
  rect(0, 0, W, 4, UWOOD[1]); rect(0, 4, W, 2, UWOOD[3]);
  // floor + rug
  rect(0, 238, W, 32, FLR2[2]); for (let r = 0; r < 4; r++) { rect(0, 238 + r * 8, W, 1, FLR2[0]); woodGrain(0, 239 + r * 8, W, 7, FLR2[1], FLR2[3], r); }
  rr(14, 240, 140, 24, 6, '#3a1428'); rr(17, 242, 134, 20, 5, '#8a2a48'); for (let x = 22; x < 146; x += 10) { rect(x, 250, 5, 3, '#e8b85a'); }
  // the standing mirror
  rr(16, 16, 136, 222, 10, '#1a0e06');
  plasticBox(18, 18, 132, 218, 10, UGOLD, { seed: 3 });
  rr(26, 26, 116, 202, 8, '#0e1a22');
  for (let y = 26; y < 228; y++) rect(27, y, 114, 1, mixC('#1e3440', '#0e1a22', Math.abs(y - 120) / 110));
  for (let k = 0; k < 30; k++) rect(30 + (k * 4), 30 + k * 6, 2, 1, '#ffffff14');
  [[18, 18], [146, 18], [18, 232], [146, 232]].forEach(([cx, cy]) => goldCurl(cx + (cx > 80 ? -3 : 3), cy + (cy > 100 ? -3 : 3), cx > 80 ? -1 : 1, cy > 100 ? -1 : 1));
  // mirror bulbs
  for (let k = 0; k < 8; k++) { fillCircle(30 + k * 15, 12, 3, '#6a5a3a'); }
  // armoire carcass
  rr(164, 18, 312, 222, 4, '#120a04');
  plasticBox(166, 20, 308, 218, 4, UWOOD, { seed: 9, noShine: 1 });
  woodGrain(168, 22, 304, 214, UWOOD[1], UWOOD[3], 13);
  rr(174, 40, 292, 160, 3, '#2a1422');
  for (let y = 41; y < 199; y++) for (let x = 175 + (y & 1); x < 465; x += 2) if (hash2(x, y) < 0.12) rect(x, y, 1, 1, '#3a1c30');
  // cornice + the name plate
  rect(160, 14, 320, 6, UWOOD[4]); rect(160, 14, 320, 1, '#c8905a'); rect(160, 20, 320, 2, UWOOD[0]);
  // info plank frame
  rr(174, 204, 292, 30, 3, '#1a0e06'); rr(175, 205, 290, 28, 3, '#e8dcc0'); grainRect(176, 206, 288, 26, '#d8ccb0', null, 0.05, 3);
}
const WD_CELL = { x0: 180, y0: 46, w: 40, h: 38, cols: 7 };
function wdEnter() { G.wd = { cat: (G.wd && G.wd.cat) || 'hat', t: 0, cheer: 0, sel: null }; sfx.whoosh(); }
function drawSkins() {
  if (!G.wd) wdEnter();
  const wd = G.wd, dt = 1 / 60;
  wd.t += dt; wd.cheer = Math.max(0, wd.cheer - dt);
  paintCached('wardrobe', 0, 0, W, H, wardrobeStatic);
  // mirror bulbs twinkle
  for (let k = 0; k < 8; k++) { const on = ((tNow * 2 + k) | 0) % 6 !== 0; fillCircle(30 + k * 15, 12, 2, on ? '#ffe9a0' : '#6a5a3a'); if (on) { ctx.save(); ctx.globalAlpha = 0.15; fillCircle(30 + k * 15, 12, 6, '#ffe9a0'); ctx.restore(); } }
  const rkey = RANGERS[meta.ranger] && rangerUnlocked(meta.ranger) ? meta.ranger : 'scout';
  const cat = wd.cat, list = cosList(cat);
  // ---- which piece is under the cursor (for try-on + the info plank) ----
  let hovK = null;
  list.forEach((k, i) => { const cx = WD_CELL.x0 + (i % WD_CELL.cols) * WD_CELL.w, cy = WD_CELL.y0 + Math.floor(i / WD_CELL.cols) * WD_CELL.h; if (mx >= cx && mx < cx + WD_CELL.w - 2 && my >= cy && my < cy + WD_CELL.h - 2) hovK = k; });
  // ---- the mirror: your ranger, trying the hovered piece on ----
  const fit = myFit(); fit.fit = Object.assign({}, meta.fit);
  let trying = false;
  if (hovK) {
    trying = !cosOwned(cat, hovK);
    if (cat === 'hat') fit.hat = hovK; else if (cat === 'gear') fit.gear = hovK; else if (cat === 'glove') fit.glove = hovK; else fit.fit[cat] = hovK;
  }
  // try-on ignores ownership for the preview only
  const saveOwn = { h: meta.hatOwn[fit.hat], g: meta.gearOwn[fit.gear], gl: meta.gachaOwn[fit.glove], f: {} };
  if (trying) { if (cat === 'hat') meta.hatOwn[hovK] = 1; else if (cat === 'gear') meta.gearOwn[hovK] = 1; else if (cat === 'glove') meta.gachaOwn[hovK] = 1; else meta.fitOwn[hovK] = 1; }
  ctx.save(); ctx.globalAlpha = 0.35; ctx.scale(1, 0.3); fillCircle(84, 222 / 0.3, 34, '#000'); ctx.restore();
  for (let k = 0; k < 6; k++) { ctx.save(); ctx.globalAlpha = 0.05; fillCircle(84, 150, 70 - k * 10, '#ffe0b0'); ctx.restore(); }
  drawBobble(84, 220, rkey, Object.assign({ sc: 2.3, expr: wd.cheer > 0 ? 'happy' : trying ? 'wow' : 'calm', act: wd.cheer > 0 ? 'cheer' : 'idle' }, fit));
  if (trying) { if (cat === 'hat') { if (!saveOwn.h) delete meta.hatOwn[hovK]; } else if (cat === 'gear') { if (!saveOwn.g) delete meta.gearOwn[hovK]; } else if (cat === 'glove') { if (!saveOwn.gl) delete meta.gachaOwn[hovK]; } else delete meta.fitOwn[hovK]; }
  if (trying) { plasticBox(44, 30, 80, 12, 3, ['#1a0606', '#8a2a1a', '#c84a38', '#e0705a', '#ffc0b0'], { noShine: 1 }); drawTextC('TRYING ON...', 84, 33, '#fff0e0', 1); }
  woodBanner(30, 224, 108, 12, (RANGERS[rkey] || RANGERS.scout).name, { col: '#ffe6b0' });

  // ---- category tabs on top of the armoire ----
  COS_CATS.forEach((c, i) => {
    const tx = 170 + i * 43, on = c.id === cat, tw = 41;
    const own = cosList(c.id).filter(k => cosOwned(c.id, k)).length, tot = cosList(c.id).length;
    plasticBox(tx, on ? 22 : 25, tw, 16, 3, on ? UGOLD : ['#1a0e06', '#4a2c14', '#6a4222', '#86582e', '#a8743e'], { noShine: 1 });
    drawTextC(c.name, tx + tw / 2, on ? 25 : 28, on ? '#3a2606' : '#f4e2b8', 1);
    drawTextC(own + '/' + tot, tx + tw / 2, on ? 32 : 35, on ? '#6a4a10' : '#c8a878', 1);
    hit(tx, 22, tw, 17, { id: 'wdtab' + c.id, cursor: true, cb: () => { if (wd.cat !== c.id) { wd.cat = c.id; wd.t = Math.min(wd.t, 0.3); sfx.click(2); } } });
  });

  // ---- rails and shelves ----
  const rows = Math.ceil(list.length / WD_CELL.cols);
  const hanging = cat === 'shirt' || cat === 'pants' || cat === 'suit';
  for (let r = 0; r < Math.max(4, rows); r++) {
    const ry = WD_CELL.y0 + r * WD_CELL.h;
    if (hanging) { rect(176, ry + 3, 288, 2, '#8a949c'); rect(176, ry + 3, 288, 1, '#d8e0e4'); }
    else { rect(176, ry + WD_CELL.h - 5, 288, 3, UWOOD[3]); rect(176, ry + WD_CELL.h - 5, 288, 1, UWOOD[4]); rect(176, ry + WD_CELL.h - 2, 288, 1, UWOOD[0]); }
  }
  list.forEach((k, i) => {
    const cx = WD_CELL.x0 + (i % WD_CELL.cols) * WD_CELL.w, cy = WD_CELL.y0 + Math.floor(i / WD_CELL.cols) * WD_CELL.h;
    const d = cosDef(cat, k), rar = d.rar || 0, own = cosOwned(cat, k), worn = cosWorn(cat, k), hov = hovK === k;
    const icx = cx + 19, icy = cy + 20;
    // items pop in one after another when the doors open
    const appear = clamp((wd.t - 0.45 - i * 0.02) * 6, 0, 1);
    if (appear <= 0) return;
    ctx.save();
    const sway = hanging ? Math.sin(tNow * 1.6 + i) * 0.05 + (hov ? Math.sin(tNow * 9) * 0.06 : 0) : 0;
    ctx.translate(icx, cy + 4); ctx.rotate(sway); ctx.scale(appear, appear); ctx.translate(-icx, -(cy + 4));
    if (hov) { ctx.save(); ctx.globalAlpha = 0.3 + Math.sin(tNow * 6) * 0.1; fillCircle(icx, icy, 17, RAR_COL[rar]); ctx.restore(); }
    if (rar >= 4 && own) sparkle(icx + 12, icy - 10, '#ffffff', 5, i);
    if (hanging) { rect(icx - 1, cy + 2, 2, 4, '#8a949c'); pxLine(icx, cy + 6, icx - 9, cy + 11, '#c8a060'); pxLine(icx, cy + 6, icx + 9, cy + 11, '#c8a060'); }
    ctx.save(); if (!own) ctx.globalAlpha = 0.28;
    cosIcon(cat, k, icx, icy + (hanging ? 3 : 0), cat === 'shoes' || cat === 'hat' ? 1.3 : 1);
    ctx.restore();
    // rarity tag on a string
    rr(cx + 2, cy + 26, 10, 8, 2, '#1a0e06'); rr(cx + 3, cy + 27, 8, 6, 1, RAR_COL[rar]);
    drawText('' + (rar + 1), cx + 5, cy + 27, '#1a0e06', 1);
    if (!own) { rr(icx + 6, cy + 24, 9, 9, 2, '#1a1206'); rect(icx + 8, cy + 25, 5, 1, '#c89a2a'); rr(icx + 7, cy + 27, 7, 5, 1, '#c89a2a'); rect(icx + 10, cy + 29, 1, 2, '#1a1206'); }
    if (worn) { rr(icx + 5, cy + 24, 11, 9, 2, '#123014'); rect(icx + 7, cy + 28, 2, 2, '#b8f0b0'); rect(icx + 9, cy + 29, 1, 1, '#b8f0b0'); rect(icx + 10, cy + 26, 2, 3, '#b8f0b0'); }
    ctx.restore();
    hit(cx, cy, WD_CELL.w - 2, WD_CELL.h - 2, { id: 'wdi' + k, cursor: true, cb: () => {
      if (own) {
        if (worn && (cat === 'hat' || cat === 'gear' || cat === 'suit')) cosEquip(cat, cat === 'hat' ? 'none' : cat === 'gear' ? 'none' : 'nosuit');
        else cosEquip(cat, k);
        wd.cheer = 1.1; sfx.buy(); fxConfetti(84, 110, 14); fxStars(84, 120, RAR_COL[rar], 6, 80);
      } else { sfx.error(); wd.sel = { k, t: 0 }; }
    } });
  });

  // ---- the armoire doors swing open ----
  const op = easeOut(clamp(wd.t / 0.6, 0, 1));
  if (op < 1) {
    const half = 146, dw = Math.round(half * (1 - op * 0.93));
    if (wd.t < dt * 2) sfx.thunk();
    [[174, 1], [466, -1]].forEach(([ex, s2]) => {
      const x0 = s2 > 0 ? ex : ex - dw;
      plasticBox(x0, 40, dw, 160, 2, UWOOD, { seed: 21 + s2, noShine: 1 });
      if (dw > 20) { rr(x0 + 6, 48, dw - 12, 144, 2, UWOOD[1]); rr(x0 + 8, 50, dw - 16, 140, 2, UWOOD[2]); fillCircle(s2 > 0 ? x0 + dw - 8 : x0 + 8, 120, 3, UGOLD[3]); }
    });
    ctx.save(); ctx.globalAlpha = 0.5 * (1 - op); rect(174 + dw, 40, 292 - dw * 2, 160, '#ffe6b0'); ctx.restore();
  }

  // ---- the info plank ----
  const infoK = hovK || (wd.sel && wd.sel.k);
  if (infoK) {
    const d = cosDef(cat, infoK), rar = d.rar || 0, own = cosOwned(cat, infoK), src = cosSrc(cat, infoK);
    drawText(d.name, 180, 208, mixC(RAR_COL[rar], '#000000', 0.3), 1);
    drawText(RAR_NAME[rar] + ' ' + cosName(cat), 460 - textW(RAR_NAME[rar] + ' ' + cosName(cat), 1), 208, mixC(RAR_COL[rar], '#000000', 0.2), 1);
    drawText(("'" + (d.flav || '') + "'").slice(0, 56), 180, 216, '#6a5a3a', 1);
    if (own) drawText(cosWorn(cat, infoK) ? 'WEARING IT - CLICK TO TAKE OFF' : 'OWNED - CLICK TO WEAR', 180, 224, '#2a6a2a', 1);
    else drawText('GET IT: ' + COS_SRC_NAME[src], 180, 224, '#a83a2a', 1);
  } else {
    const all = COS_CATS.reduce((a, c) => a + cosList(c.id).length, 0), owned = COS_CATS.reduce((a, c) => a + cosList(c.id).filter(k => cosOwned(c.id, k)).length, 0);
    drawTextC('HOVER A PIECE TO TRY IT ON', 320, 210, '#6a5a3a', 1);
    drawTextC('COLLECTION ' + owned + ' / ' + all, 320, 222, '#8a5a1a', 1);
  }

  // ---- buttons ----
  button(4, 250, 64, 16, '< BACK', '#4a4438', '#28241c', () => { G.wd = null; G.state = 'menu'; }, { id: 'skinback' });
  button(314, 244, 92, 22, 'TRADING BOOTH', '#7a4a9a', '#4a2a6a', () => { G.wd = null; ensureDaily(); boothEnter(); G.state = 'pass'; }, { id: 'wdbooth', tip: "MRS OWLET'S TRADING BOOTH|Buy new looks with cookies" });
  button(410, 244, 66, 22, 'FREE GIFTS', '#3a8a4a', '#1c5a24', () => { G.boothOv = 'gifts'; }, { id: 'wdgifts', tip: 'FOLLOW REWARDS|A wombat hat and a wombat tee' });
  if (G.boothOv) drawBoothOverlay();
}

// ========================= MRS OWLET'S TRADING BOOTH ========================
//  She runs a market stall now.  Three items sit on her counter, and every
//  five seconds she swaps them for three more (hold your cursor on one and
//  she will wait - grudgingly).  Cosmetics, shop unlocks, perks, her own
//  owl-only specials and, now and then, a free tin of cookies.
// ==========================================================================
const OWLET_BOOTH_LINES = {
  fresh: ['Fresh stock. Do not touch unless buying.', 'New things. Same prices. Higher, actually.', 'That one is special. So is the price.', 'I found these in lost property.', 'Stop staring. Buy or leave.', 'Five seconds. Then I change my mind.'],
  buy: ['Hm. Good choice. Barely.', 'Sold. No refunds. Ever.', 'Wear it with some dignity.', 'Pleasure doing business. It was not.'],
  broke: ['You cannot afford that. Get more cookies.', 'Come back with cookies, not hope.'],
  tin: ['Take the tin. Do not tell anyone.', 'Free cookies. Once. Do not get used to it.'],
};
const BOOTH_PERIOD = 5;
function boothPool() {
  const p = [];
  COS_CATS.forEach(c => cosList(c.id).forEach(k => {
    const src = cosSrc(c.id, k);
    if ((src === 'booth' || src === 'owl' || src === 'shop') && !cosOwned(c.id, k)) p.push({ kind: 'cos', cat: c.id, k, rar: cosDef(c.id, k).rar || 0, owl: src === 'owl' });
  }));
  gachaPool().forEach(z => { if (z.kind === 'card') p.push({ kind: 'card', def: z.def, rar: z.rar }); else if (z.kind === 'perk') p.push({ kind: 'perk', k: z.k, rar: 3 }); });
  return p;
}
function boothPrice(it) {
  if (it.kind === 'tin') return 0;
  if (it.kind === 'card') return [25, 45, 70][it.rar] || 45;
  if (it.kind === 'perk') return 90;
  const b = COOKIE_PRICE[it.rar] || 60;
  return it.owl ? Math.round(b * 1.3 / 5) * 5 : it.cat && cosSrc(it.cat, it.k) === 'shop' ? Math.round(b * 1.15 / 5) * 5 : b;
}
function boothRoll() {
  let pool = boothPool();
  const out = [];
  for (let n = 0; n < 3 && pool.length; n++) {
    const w = pool.map(z => (z.owl ? 1.4 : 1) * ([10, 7, 5, 3, 2, 1][z.rar] || 1));
    let r = rnd() * w.reduce((a, b) => a + b, 0), pick = pool[0];
    for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) { pick = pool[i]; break; } }
    pool = pool.filter(z => z !== pick);
    out.push(Object.assign({ sold: false }, pick));
  }
  const tinReady = !meta.tinT || Date.now() - meta.tinT > 10 * 60 * 1000;
  if (tinReady && rnd() < 0.12) out[Math.min(2, out.length)] = { kind: 'tin', amt: ri(15, 40), rar: 1, sold: false };
  while (out.length < 3) out.push({ kind: 'empty', rar: 0, sold: true });
  out.forEach(it => { it.price = boothPrice(it); });
  return out;
}
function boothEnter() { G.booth = { stock: boothRoll(), t: 0, flip: 1, say: { txt: choice(OWLET_BOOTH_LINES.fresh), t: 0 }, hold: false }; }
function boothSay(kind) { if (G.booth) G.booth.say = { txt: choice(OWLET_BOOTH_LINES[kind]), t: 0 }; }
function boothItemName(it) {
  if (it.kind === 'cos') return cosDef(it.cat, it.k).name;
  if (it.kind === 'card') return it.def.name;
  if (it.kind === 'perk') return PERKS[it.k].name;
  if (it.kind === 'tin') return 'COOKIE TIN';
  return '';
}
function boothItemDesc(it) {
  if (it.kind === 'cos') return RAR_NAME[it.rar] + ' ' + cosName(it.cat) + (it.owl ? ' - OWL SPECIAL' : '') + '|' + (cosDef(it.cat, it.k).flav || '');
  if (it.kind === 'card') return 'UNLOCK FOR YOUR RUN SHOP|' + it.def.desc;
  if (it.kind === 'perk') return 'PERMANENT PERK|' + PERKS[it.k].desc;
  if (it.kind === 'tin') return 'FREE - ONCE EVERY 10 MINUTES|+' + it.amt + ' COOKIES';
  return '';
}
function boothBuy(it) {
  if (!it || it.sold || it.kind === 'empty') return;
  if ((meta.rp || 0) < it.price) { sfx.error(); boothSay('broke'); float(mx, my - 10, 'NOT ENOUGH COOKIES', C.red, 1); return; }
  meta.rp -= it.price; it.sold = true;
  if (it.kind === 'cos') { cosGrant(it.cat, it.k, true); toasts.push({ name: cosDef(it.cat, it.k).name + '!', sub: 'NOW IN YOUR WARDROBE - AND YOU ARE WEARING IT', t: 0 }); boothSay('buy'); }
  else if (it.kind === 'card') { meta.unlocked[it.def.id] = true; toasts.push({ name: it.def.name + ' UNLOCKED!', sub: 'NOW IN YOUR SHOP POOL', t: 0 }); boothSay('buy'); }
  else if (it.kind === 'perk') { meta.perks[it.k] = true; toasts.push({ name: PERKS[it.k].name + '!', sub: 'PERMANENT UPGRADE ACTIVE', t: 0 }); boothSay('buy'); }
  else if (it.kind === 'tin') { meta.rp = (meta.rp || 0) + it.amt; meta.tinT = Date.now(); toasts.push({ name: '+' + it.amt + ' COOKIES', sub: 'A TIN FROM MRS OWLET', t: 0 }); boothSay('tin'); }
  saveMeta(); sfx.buy(); sfx.coin();
  fxConfetti(mx, my - 10, 18); fxStars(mx, my, RAR_COL[it.rar] || C.gold, 8, 90);
}
// draw a booth item's art centred on (cx, cy)
function boothItemArt(it, cx, cy) {
  if (it.kind === 'cos') { cosIcon(it.cat, it.k, cx, cy, it.cat === 'hat' || it.cat === 'shoes' ? 2 : 1.6); return; }
  ctx.save(); ctx.translate(cx - 12, cy - 12); ctx.scale(2, 2);
  if (it.kind === 'card') (ICONS[it.def.ico] || ICONS.star)(0, 0);
  else if (it.kind === 'perk') (ICONS[PERKS[it.k].ico] || ICONS.star)(0, 0);
  else if (it.kind === 'tin') { rr(1, 2, 10, 9, 2, '#1a2a4a'); rr(2, 3, 8, 7, 2, '#3a6ac8'); rect(2, 3, 8, 2, '#c8a040'); ICONS.cookie(0, -2); }
  ctx.restore();
}
function boothStatic() {
  for (let y = 0; y < H; y += 14) { rect(0, y, W, 14, ((y / 14) | 0) % 2 ? '#33241a' : '#2c1f14'); rect(0, y + 13, W, 1, '#1c1208'); woodGrain(0, y + 1, W, 12, '#241810', '#3e2c1e', y); }
  rect(0, 218, W, H - 218, '#241708'); for (let x = 0; x < W; x += 48) rect(x, 221, 1, H - 221, '#1c1208');
  // the stall's posts and striped awning
  [12, 222].forEach(px => { rect(px, 46, 6, 172, '#1a0e06'); rect(px + 1, 46, 4, 172, '#6a4222'); rect(px + 1, 46, 1, 172, '#8a5a30'); });
  for (let k = 0; k < 9; k++) {
    const col = k % 2 ? '#c23a4a' : '#f0e8d4', dk = k % 2 ? '#8a1e2e' : '#c0b89c';
    rect(10 + k * 24, 46, 24, 16, col); rect(28 + k * 24, 46, 6, 16, dk); rect(10 + k * 24, 46, 24, 2, k % 2 ? '#e05a6a' : '#ffffff');
    for (let j = 0; j < 5; j++) rect(12 + k * 24 + j, 62 + j, 20 - j * 2, 1, col);
  }
  // hanging goods at the stall sides: bunting and a lantern hook
  for (let k = 0; k < 10; k++) { const bx = 16 + k * 21; for (let t = 0; t < 5; t++) rect(bx + 3 + t, 70 + t, 10 - t * 2, 1, ['#e84a5a', '#ffc843', '#4fb3d9'][k % 3]); }
  // the counter
  rr(8, 146, 224, 60, 3, '#120a04');
  plasticBox(10, 146, 220, 58, 3, UWOOD, { seed: 5, noShine: 1 });
  woodGrain(12, 152, 216, 50, UWOOD[1], UWOOD[3], 3);
  rect(6, 142, 228, 6, UWOOD[4]); rect(6, 142, 228, 1, '#c8905a'); rect(6, 148, 228, 2, UWOOD[0]);
  for (let x = 20; x < 226; x += 36) { rr(x, 158, 30, 40, 2, UWOOD[1]); rr(x + 1, 159, 28, 38, 2, UWOOD[2]); }
}
function drawPassScreen(dt) {
  ensureDaily();
  if (!G.booth) boothEnter();
  const B = G.booth;
  paintCached('booth', 0, 0, W, H, boothStatic);
  // string lights over the stall
  for (let k = 0; k < 12; k++) { const lx = 12 + k * 42, ly = 8 + Math.round(Math.sin(k * 1.2) * 4); rect(lx, ly, 42, 1, '#1c1208'); const on = ((tNow * 2 + k) | 0) % 3 !== 0; fillCircle(lx + 20, ly + 4, 2, on ? ['#ffe089', '#ff8ab0', '#7fd4e8'][k % 3] : '#3a2c20'); if (on) { ctx.save(); ctx.globalAlpha = 0.12; fillCircle(lx + 20, ly + 5, 6, '#ffe089'); ctx.restore(); } }
  // the sign board over the awning
  plasticBox(26, 20, 190, 24, 3, ['#140a04', '#4a2c14', '#6a4222', '#86582e', '#a8743e'], { seed: 7 });
  drawTextCSh("OWLET'S", 121, 23, '#f4e2b8', 1, '#1a0e06');
  drawTextCSh('TRADING BOOTH', 121, 31, '#ffd23f', 2, '#1a0e06');
  // cookie balance + GET COOKIES
  plasticBox(350, 8, 124, 22, 3, ['#10180a', '#26321e', '#34462a', '#46603a', '#6a8a50'], { noShine: 1 });
  ICONS.cookie(356, 13); drawText(fmt(meta.rp || 0) + ' COOKIES', 372, 16, C.gold, 1);
  // ---- rotating stock ----
  const hovIdx = B.stock.findIndex((it, i) => { const sx = 76 + i * 52; return mx >= sx && mx < sx + 48 && my >= 86 && my < 146; });
  B.hold = hovIdx >= 0 && !G.boothOv;
  if (!B.hold) B.t += dt;
  if (B.t >= BOOTH_PERIOD) { B.t = 0; B.stock = boothRoll(); B.flip = 0; if (rnd() < 0.5) boothSay('fresh'); sfx.pin(); }
  B.flip = Math.min(1, B.flip + dt * 4);
  // Mrs Owlet behind her counter
  B.say.t += dt;
  const talking = B.say.t < B.say.txt.length / 40 + 0.2;
  drawOwlet(46, 176, { expr: talking ? 'stern' : 'grump', talk: talking, look: { x: 0.8, y: 0.3 }, point: hovIdx >= 0 ? { x: 100 + hovIdx * 52, y: 118 } : null });
  paintCached('boothCounter', 0, 140, W, 70, () => { ctx.save(); ctx.translate(0, -140); boothStatic(); ctx.restore(); });
  hqBubble(70, 74, 150, 9 + wrapCount(B.say.txt, 140) * 7, B.say.txt, B.say.t, { tail: { x: 60, y: 120 } });
  // the timer: how long until she swaps the stock
  const left = BOOTH_PERIOD - B.t;
  segBar(80, 206, 146, 7, left / BOOTH_PERIOD, { tint: B.hold ? '#7fd4e8' : left < 1.5 ? '#d94f30' : '#ffc843', tintL: '#ffffff' });
  drawText(B.hold ? 'SHE IS WAITING...' : 'NEW STOCK IN ' + Math.ceil(left) + 'S', 80, 197, B.hold ? '#9fe8ff' : '#f4e2b8', 1);
  B.stock.forEach((it, i) => {
    const sx = 76 + i * 52, sy = 86, cx = sx + 24, hov = hovIdx === i;
    // velvet cushion on the counter
    rr(sx + 3, 134, 42, 10, 4, '#3a0a1a'); rr(sx + 4, 134, 40, 7, 3, '#8a2040'); rect(sx + 8, 135, 30, 1, '#c84a6a');
    if (it.kind === 'empty') { drawTextC('SOLD', cx, 122, '#8a7a58', 1); return; }
    const sq = Math.abs(Math.cos((1 - B.flip) * Math.PI / 2 + (B.flip < 1 ? 0 : 0)));
    const lift = hov && !it.sold ? -4 + Math.sin(tNow * 8) : 0;
    ctx.save(); ctx.translate(cx, 118 + lift); ctx.scale(B.flip < 1 ? Math.max(0.05, B.flip) : 1, 1); ctx.translate(-cx, -(118 + lift));
    if (!it.sold) {
      ctx.save(); ctx.globalAlpha = 0.25 + Math.sin(tNow * 3 + i) * 0.08 + (hov ? 0.15 : 0); fillCircle(cx, 116 + lift, 20, it.owl ? '#c8a8f8' : RAR_COL[it.rar] || C.gold); ctx.restore();
      if (it.rar >= 3) { sparkle(cx - 16, 100 + lift, '#ffffff', 5, i); sparkle(cx + 15, 108 + lift, '#ffffff', 6, i + 2); }
    }
    ctx.save(); if (it.sold) ctx.globalAlpha = 0.3;
    boothItemArt(it, cx, 116 + lift);
    ctx.restore();
    ctx.restore();
    void sq;
    // the paper price tag on the counter front
    const tagCol = it.sold ? '#b8a898' : (meta.rp || 0) >= it.price ? '#f0d48a' : '#e0b8a8';
    paperSheet(sx + 6, 150, 36, 22, { noCorner: 1, ramp: ['#3a2a14', '#c8b080', tagCol, mixC(tagCol, '#ffffff', 0.4), '#ffffff'] });
    rect(cx - 1, 144, 2, 6, '#8a949c');
    if (it.sold) drawTextC('SOLD!', cx, 158, '#8a2a16', 1);
    else if (it.kind === 'tin') drawTextC('FREE!', cx, 158, '#2a6a2a', 1);
    else { ICONS.cookie(sx + 7, 153); drawText('' + it.price, sx + 21, 157, '#3a2606', 1); }
    const nm = fitLines(boothItemName(it), 46);
    drawTextC(nm[0], cx, 176, '#f4e2b8', 1); if (nm[1]) drawTextC(nm[1], cx, 183, '#f4e2b8', 1);
    if (it.owl && !it.sold) { plasticBox(sx + 2, 88, 44, 9, 2, ['#1a0c26', '#4a2a6a', '#7a4aa8', '#a878d8', '#dcc0ff'], { noShine: 1 }); drawTextC('OWL SPECIAL', cx, 90, '#ffffff', 1); }
    if (!it.sold) hit(sx, 86, 48, 100, { id: 'booth' + i, cursor: true, tip: boothItemName(it) + '|' + boothItemDesc(it) + (it.kind === 'tin' ? '' : '|' + it.price + ' COOKIES - CLICK TO BUY'), cb: () => boothBuy(it) });
  });
  // ---- booth buttons ----
  button(10, 218, 72, 20, 'GET COOKIES', '#c8901a', '#8a5a08', () => { G.boothOv = 'store'; sfx.click(2); }, { id: 'bstore', tip: 'COOKIE STORE|Cookie packs for real money' });
  button(86, 218, 70, 20, 'TRADE IN', '#3a6a8a', '#204458', () => { G.boothOv = 'trade'; G.tradeSel = null; sfx.click(2); }, { id: 'btrade', tip: 'TRADE IN|Swap clothes you own for cookies' });
  button(160, 218, 72, 20, 'FREE GIFTS', '#3a8a4a', '#1c5a24', () => { G.boothOv = 'gifts'; sfx.click(2); }, { id: 'bgifts', tip: 'FOLLOW REWARDS|Free wombat hat + wombat tee' });
  drawQuestBoard();
  drawTextC('EARN COOKIES: QUESTS, ACHIEVEMENTS, EVENTS', 352, 232, '#8a7a58', 1);
  button(10, 246, 70, 18, '< BACK', '#4a4438', '#28241c', () => { G.booth = null; G.state = 'menu'; }, { id: 'passback' });
  button(84, 246, 90, 18, 'WARDROBE', '#8a4a6a', '#5a2a44', () => { G.booth = null; G.state = 'skins'; }, { id: 'bwardrobe' });
  if (G.boothOv) drawBoothOverlay();
}

// ------------------------------------------------------------ overlays ----
const COOKIE_PACKS = [
  { id: 'A', name: 'HANDFUL', amt: 120, price: '$0.99', art: 1 },
  { id: 'B', name: 'COOKIE JAR', amt: 700, price: '$4.99', art: 2, tag: 'POPULAR' },
  { id: 'C', name: 'COOKIE BARREL', amt: 1600, price: '$9.99', art: 3, tag: '+14% BONUS' },
  { id: 'D', name: 'GOLDEN TIN', amt: 3500, price: '$19.99', art: 4, tag: 'BEST VALUE' },
];
const STORE_URL = ITCH_URL;
const CODE_SALT = 'wombaton-bitedown-cookies';
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function fnv32(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
function codeCheck(pack, body) { const h = fnv32(pack + body + CODE_SALT); return CODE_ABC[h % 32] + CODE_ABC[(h >>> 5) % 32]; }
// BDB-7K2QXM-4F: pack letter after BD, six random symbols, two check symbols
function redeemCode(raw) {
  const code = ('' + (raw || '')).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 11 || code.slice(0, 2) !== 'BD') return 'THAT IS NOT A COOKIE CODE';
  const pack = COOKIE_PACKS.find(p => p.id === code[2]);
  const body = code.slice(3, 9), chk = code.slice(9);
  if (!pack || codeCheck(pack.id, body) !== chk) return 'THAT CODE DOES NOT CHECK OUT';
  if (!meta.codes) meta.codes = {};
  if (meta.codes[code]) return 'THAT CODE WAS ALREADY USED';
  meta.codes[code] = 1; meta.rp = (meta.rp || 0) + pack.amt; saveMeta();
  toasts.push({ name: '+' + pack.amt + ' COOKIES', sub: pack.name + ' REDEEMED - THANK YOU!', t: 0 });
  sfx.win(); fxConfetti(W / 2, 100, 30);
  return null;
}
function claimFollow(which) {
  const url = which === 'itch' ? ITCH_URL : TIKTOK_URL;
  try { window.open(url, '_blank', 'noopener'); } catch (e) { }
  if (which === 'itch' && !meta.followItch) { meta.followItch = true; meta.hatOwn.wombat = true; meta.hat = 'wombat'; toasts.push({ name: 'WOMBAT HAT!', sub: 'THANKS FOR FOLLOWING ON ITCH.IO', t: 0 }); sfx.ach(); }
  if (which === 'tiktok' && !meta.followTiktok) { meta.followTiktok = true; meta.fitOwn.wombattee = true; meta.fit.shirt = 'wombattee'; if (meta.fit.suit !== 'nosuit') meta.fit.suit = 'nosuit'; toasts.push({ name: 'WOMBAT TEE!', sub: 'THANKS FOR FOLLOWING ON TIKTOK', t: 0 }); sfx.ach(); }
  saveMeta();
}
function cookieArt(x, y, n) {
  // a pile of cookies in a jar / barrel / tin
  if (n === 1) { ICONS.cookie(x - 6, y - 6); ICONS.cookie(x + 2, y - 2); ICONS.cookie(x - 12, y - 1); return; }
  if (n === 2) { rr(x - 12, y - 14, 24, 26, 6, '#5a8a9a'); rr(x - 11, y - 13, 22, 24, 5, '#b8dce8'); rect(x - 10, y - 17, 20, 4, '#8a5a2a'); for (let k = 0; k < 6; k++) ICONS.cookie(x - 10 + (k % 3) * 7, y - 6 + ((k / 3) | 0) * 8); rect(x - 9, y - 12, 2, 18, '#ffffff66'); return; }
  if (n === 3) { rr(x - 14, y - 14, 28, 28, 5, '#3a2210'); rr(x - 13, y - 13, 26, 26, 4, '#8a5a2a'); rect(x - 13, y - 6, 26, 2, '#3a3a3a'); rect(x - 13, y + 6, 26, 2, '#3a3a3a'); for (let k = 0; k < 5; k++) ICONS.cookie(x - 12 + k * 5, y - 18 + (k % 2) * 2); return; }
  rr(x - 16, y - 10, 32, 22, 4, '#6a4a08'); rr(x - 15, y - 9, 30, 20, 3, '#e8b830'); rect(x - 15, y - 9, 30, 4, '#fff0a0'); rect(x - 16, y - 12, 32, 4, '#c8901a');
  for (let k = 0; k < 3; k++) ICONS.cookie(x - 12 + k * 8, y - 20); sparkle(x + 12, y - 16, '#ffffff', 5, 1);
}
function drawBoothOverlay() {
  const ov = G.boothOv;
  overlayDim(0.75);
  hit(0, 0, W, H, { id: 'bovblock', cb: () => { } });
  const px = 40, py = 20, pw = 400, ph = 228;
  plasticBox(px, py, pw, ph, 5, ['#140a04', '#4a2c14', '#6a4222', '#86582e', '#a8743e'], { seed: 31, noShine: 1 });
  paperSheet(px + 8, py + 8, pw - 16, ph - 16, {});
  if (ov === 'store') {
    drawTextCSh('COOKIE STORE', W / 2, py + 14, '#8a5a1a', 2, '#f4e2b8');
    drawTextC('COOKIES BUY CLOTHES, PERKS AND UNLOCKS AT THE TRADING BOOTH', W / 2, py + 30, '#6a5a3a', 1);
    COOKIE_PACKS.forEach((p, i) => {
      const bx = px + 18 + i * 94, by = py + 42;
      plasticBox(bx, by, 86, 120, 4, ['#1a0e06', '#c8a870', '#ecdcb4', '#f8eed4', '#ffffff'], { noShine: 1, flat: 1 });
      if (p.tag) { plasticBox(bx + 8, by - 5, 70, 10, 2, ['#3a0806', '#a8201a', '#e8403a', '#ff806a', '#ffc0b0'], { noShine: 1 }); drawTextC(p.tag, bx + 43, by - 3, '#ffffff', 1); }
      cookieArt(bx + 43, by + 36, p.art);
      drawTextC(p.name, bx + 43, by + 60, '#3a2606', 1);
      drawTextCSh(fmt(p.amt), bx + 43, by + 70, '#c8901a', 2, '#3a2606');
      drawTextC('COOKIES', bx + 43, by + 83, '#6a5a3a', 1);
      button(bx + 8, by + 94, 70, 20, 'BUY ' + p.price, '#3a8a4a', '#1c5a24', () => { try { window.open(STORE_URL, '_blank', 'noopener'); } catch (e) { } G.storeMsg = 'FINISH ON ITCH.IO - YOUR CODE COMES WITH THE PURCHASE'; }, { id: 'buypack' + p.id, tip: p.name + '|' + fmt(p.amt) + ' COOKIES FOR ' + p.price + '|Opens the store page. Enter your code here after.' });
    });
    button(W / 2 - 60, py + 170, 120, 20, 'REDEEM A CODE', '#7a4a9a', '#4a2a6a', () => {
      let c = null; try { c = window.prompt('Enter your cookie code (like BDB-XXXXXX-XX):'); } catch (e) { }
      if (c === null || c === undefined) return;
      const err = redeemCode(c); G.storeMsg = err || 'CODE REDEEMED! ENJOY THE COOKIES.'; if (err) sfx.error();
    }, { id: 'redeem' });
    if (G.storeMsg) drawTextC(G.storeMsg, W / 2, py + 196, '#a83a2a', 1);
  } else if (ov === 'gifts') {
    drawTextCSh('FREE GIFTS', W / 2, py + 14, '#2a6a2a', 2, '#f4e2b8');
    drawTextC('FOLLOW WOMBATON STUDIOS AND GET A FREE WOMBAT OUTFIT', W / 2, py + 30, '#6a5a3a', 1);
    [['itch', 'ITCH.IO', 'FREE WOMBAT HAT', 'hat', 'wombat', !!meta.followItch, '#fa5c5c'], ['tiktok', 'TIKTOK', 'FREE WOMBAT TEE', 'shirt', 'wombattee', !!meta.followTiktok, '#2a2a2a']].forEach(([id, nm, gift, cat, k, done, col], i) => {
      const bx = px + 30 + i * 180, by = py + 44;
      plasticBox(bx, by, 160, 140, 5, rampOf(col), { seed: i });
      rr(bx + 10, by + 10, 140, 76, 4, '#f4ecd8');
      ctx.save(); ctx.beginPath(); ctx.rect(bx + 10, by + 10, 140, 76); ctx.clip();
      const f = myFit(); f.fit = Object.assign({}, meta.fit);
      const tmp = cat === 'hat' ? meta.hatOwn.wombat : meta.fitOwn.wombattee;
      if (cat === 'hat') { meta.hatOwn.wombat = 1; f.hat = 'wombat'; } else { meta.fitOwn.wombattee = 1; f.fit.shirt = 'wombattee'; f.fit.suit = 'nosuit'; }
      drawBobble(bx + 80, by + 84, RANGERS[meta.ranger] ? meta.ranger : 'scout', Object.assign({ sc: 1.05, expr: 'happy', act: 'wave' }, f));
      if (cat === 'hat') { if (!tmp) delete meta.hatOwn.wombat; } else if (!tmp) delete meta.fitOwn.wombattee;
      ctx.restore();
      drawTextCSh('FOLLOW ON ' + nm, bx + 80, by + 92, '#ffffff', 1);
      drawTextC(gift, bx + 80, by + 102, '#fff0c0', 1);
      button(bx + 20, by + 114, 120, 20, done ? 'CLAIMED - VISIT AGAIN' : 'FOLLOW + CLAIM', done ? '#5a6a58' : '#3a8a4a', '#1c5a24', () => claimFollow(id), { id: 'follow' + id, tip: 'OPENS ' + nm + ' IN A NEW TAB|Your gift is added right away' });
    });
  } else if (ov === 'trade') {
    drawTextCSh('TRADE IN', W / 2, py + 14, '#204458', 2, '#f4e2b8');
    drawTextC('SWAP CLOTHES YOU OWN FOR COOKIES - 40% OF THE BOOTH PRICE', W / 2, py + 30, '#6a5a3a', 1);
    const items = [];
    COS_CATS.forEach(c => cosList(c.id).forEach(k => { const src = cosSrc(c.id, k); if (cosOwned(c.id, k) && ['shop', 'booth', 'owl'].includes(src)) items.push({ cat: c.id, k, rar: cosDef(c.id, k).rar || 0 }); }));
    if (!items.length) drawTextC('NOTHING TO TRADE YET. GO BUY SOMETHING.', W / 2, py + 100, '#8a7a58', 1);
    items.slice(0, 40).forEach((it, i) => {
      const bx = px + 18 + (i % 10) * 37, by = py + 42 + Math.floor(i / 10) * 40;
      const val = Math.floor((COOKIE_PRICE[it.rar] || 20) * 0.4), sel = G.tradeSel && G.tradeSel.k === it.k && G.tradeSel.cat === it.cat;
      plasticBox(bx, by, 34, 36, 3, sel ? ['#3a0806', '#a8201a', '#e8403a', '#ff806a', '#ffc0b0'] : ['#1a0e06', '#c8a870', '#ecdcb4', '#f8eed4', '#ffffff'], { noShine: 1, flat: 1 });
      cosIcon(it.cat, it.k, bx + 17, by + 14, 0.9);
      ICONS.cookie(bx + 2, by + 24); drawText('' + val, bx + 15, by + 27, sel ? '#ffffff' : '#3a2606', 1);
      hit(bx, by, 34, 36, { id: 'trade' + it.cat + it.k, cursor: true, tip: cosDef(it.cat, it.k).name + '|' + (sel ? 'CLICK AGAIN TO TRADE FOR ' + val + ' COOKIES' : 'CLICK TO PICK'), cb: () => {
        if (sel) { cosRevoke(it.cat, it.k); meta.rp = (meta.rp || 0) + val; saveMeta(); G.tradeSel = null; sfx.coin(); float(mx, my - 8, '+' + val, C.gold, 1); }
        else { G.tradeSel = it; sfx.click(2); }
      } });
    });
  }
  button(W / 2 - 36, py + ph - 26, 72, 18, 'CLOSE', '#4a4438', '#28241c', () => { G.boothOv = null; G.storeMsg = null; }, { id: 'bovclose' });
}

// icon for any outfit piece, centred on (cx, cy) - a small mannequin view
function drawFitIcon(cx, cy, k, sc) {
  const f = FITS[k]; if (!f) return;
  sc = sc || 1;
  ctx.save(); ctx.translate(cx, cy); ctx.scale(sc, sc);
  const col = f.col || (f.cat === 'shirt' ? '#2d4a34' : f.cat === 'pants' ? '#3f6748' : '#4d3a1e');
  const R = f.src === 'free' ? (f.cat === 'shoes' ? BOOT : rampOf(col)) : rampOf(col);
  if (f.cat === 'shirt') {
    plasticBox(-8, -7, 16, 14, 4, R, { seed: 1 });
    plasticBox(-12, -7, 6, 8, 2, R, { noShine: 1 }); plasticBox(6, -7, 6, 8, 2, R, { noShine: 1 });
    if (f.pat && f.pat !== 'none') fitPattern(f, -8, -7, 16, 14, 0);
    if (f.src === 'free') plasticBox(-3, -5, 7, 11, 2, ['#0f120e', '#cfc7ab', '#e6dfc6', '#f6f2e2', '#ffffff'], { noShine: 1 });
    fitShirtFront(f, -8);
    rect(-3, -7, 6, 2, R[0]);
  } else if (f.cat === 'pants') {
    plasticBox(-7, -8, 14, 5, 2, R, { noShine: 1 });
    plasticBox(-7, -4, 6, f.shorts ? 6 : 12, 2, R, { noShine: 1 }); plasticBox(1, -4, 6, f.shorts ? 6 : 12, 2, R, { noShine: 1 });
    if (f.kilt) plasticBox(-8, -6, 16, 9, 2, R, { noShine: 1 });
    if (f.pat) { fitPattern(f, -7, -8, 14, f.shorts ? 10 : 16, 0); }
  } else if (f.cat === 'shoes') {
    fitShoe(f, -11, -2, 1); fitShoe(f, 1, -1, 1);
  } else {
    if (k === 'nosuit') { rect(-6, 0, 12, 1, '#54707a'); ctx.restore(); return; }
    ctx.scale(0.62, 0.62);
    if (f.hood) suitHoodBack(f);
    suitBack(f, 8);
    plasticBox(-10, 8, 21, 18, 5, R, { seed: 2 });
    if (f.pat) fitPattern(f, -10, 8, 21, 18, 0);
    suitFront(f, 8);
    rr(-9, -10, 18, 16, 5, '#e8c8a0'); rect(-5, -4, 2, 3, '#1a1206'); rect(3, -4, 2, 3, '#1a1206');
    suitHoodFront(f, false);
  }
  ctx.restore();
}

let toasts = []; // {name, sub, glove, t}

// ---- CROC INDEX ------------------------------------------------------------
// log a sighting; a brand-new find is worth SCOUT COOKIES at the index screen
function indexSee(key, quiet) {
  if (!meta.index.seen[key]) {
    meta.index.seen[key] = true;
    saveMeta();
    if (!quiet) toasts.push({ name: 'NEW INDEX ENTRY!', sub: 'CLAIM COOKIES IN THE INDEX', t: 0 });
  }
}
const indexBounty = key => key.startsWith('boss_') ? 15 : key.startsWith('mut_') ? 10
  : key.startsWith('tooth_') ? 5 : 3;

// ---- MERLE the manatee pops in to explain a special croc's ability ---------
let merle = null; // {name, txt, t}
function sayMerle(name, txt) { merle = { name, txt, t: 0 }; }
function drawMerleTalk(dt) {
  if (!merle) return;
  merle.t += dt;
  if (merle.t > 8.5) { merle = null; return; }
  const slide = merle.t < 0.35 ? easeOut(merle.t / 0.35) : merle.t > 8 ? 1 - easeIn((merle.t - 8) / 0.5) : 1;
  const bx = 118, by = lerp(H + 10, 172, slide), bw = 202, bh = 58;
  ctx.save();
  ctx.globalAlpha = 0.35; rr(bx + 2, by + 3, bw, bh, 4, '#000'); ctx.restore();
  panel(bx, by, bw, bh, { face: '#12262ef6', edge: '#5cb0ac', r: 4 });
  // Merle bobbing in the corner of the bubble
  const bob = Math.round(Math.sin(merle.t * 3.2) * 2);
  const mTalk = merle.t < merle.txt.length / 42 + 0.2;
  ctx.save(); ctx.translate(bx - 10, by - 16 + bob); ctx.scale(0.56, 0.56);
  drawVendor(0, 0, { expr: mTalk ? 'happy' : 'calm', talk: mTalk, phase: 1.3 });
  ctx.restore();
  // speech tail + name plate
  rect(bx + 40, by + 12, 4, 3, '#5cb0ac');
  drawText('MERLE', bx + 46, by + 5, '#7fd4e8', 1);
  drawText(merle.name, bx + 46, by + 15, '#ffe6b0', 1);
  // typewriter body text, wrapped
  const shown = merle.txt.slice(0, Math.floor(merle.t * 42));
  drawSmallWrapped(shown, bx + 46, by + 27, bw - 54, C.white);
  if (merle.t > 0.6 && (tNow % 1) < 0.6) drawText('TAP', bx + bw - 22, by + bh - 10, '#5d7a86', 1);
  hit(bx, by, bw, bh, { id: 'merletalk', cursor: true, cb: () => { merle = null; } });
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}
// pin fresh postings until the board holds BOARD_SIZE (no duplicate quest ids)
function fillBoard() {
  const qb = meta.qb;
  let guard = 40;
  while (qb.posts.length < BOARD_SIZE && guard-- > 0) {
    const def = choice(BOARD_POOL.filter(d => !qb.posts.some(p => p.id === d.id)));
    if (!def) break;
    qb.posts.push({ id: def.id, name: def.name, goal: def.goal, rp: def.rp, ico: def.ico, npc: choice(NPC_ORDER), on: false, prog: 0 });
  }
}
function ensureDaily() {
  if (!meta.qb || !meta.qb.posts) { meta.qb = { posts: [], done: 0 }; fillBoard(); return; }
  // migrate older/larger boards: drop retired quests, shrink to BOARD_SIZE
  const valid = meta.qb.posts.filter(p => BOARD_POOL.some(d => d.id === p.id));
  const active = valid.filter(p => p.on), rest = valid.filter(p => !p.on);
  meta.qb.posts = active.concat(rest).slice(0, BOARD_SIZE);
  fillBoard();
}
const activeQuests = () => (meta.qb && meta.qb.posts || []).filter(p => p.on);
function addRP(n, label) {
  meta.rp = (meta.rp || 0) + n;
  if (label) toasts.push({ name: label, sub: '+' + n + ' SCOUT COOKIES', t: 0 });
  saveMeta();
}
function completeQuest(p) {
  meta.qb.done = (meta.qb.done || 0) + 1;
  meta.qb.posts = meta.qb.posts.filter(x => x !== p);
  fillBoard();
  addRP(p.rp, 'QUEST DONE: ' + p.name);
  sfx.ach();
}
function quest(id, n) {
  ensureDaily();
  let changed = false;
  meta.qb.posts.slice().forEach(p => {
    if (!p.on || p.id !== id || p.prog >= p.goal) return;
    p.prog = Math.min(p.goal, p.prog + n);
    changed = true;
    if (p.prog >= p.goal) completeQuest(p);
    // (no mid-progress pings - the board shows live progress, keep play quiet)
  });
  if (changed) saveMeta();
}
function unlock(id) {
  if (meta.ach[id]) return;
  meta.ach[id] = true;
  const a = ACHS.find(a => a.id === id);
  toasts.push({ name: 'ACHIEVEMENT: ' + a.name, glove: a.glove, t: 0 });
  saveMeta();
  addRP(25);
  sfx.ach();
}
const gloveUnlocked = k => !!meta.gachaOwn[k] || ((GLOVES[k].gacha || GLOVES[k].shop) ? false : (!GLOVES[k].ach || !!meta.ach[GLOVES[k].ach]));
ensureDaily();

// ------------------------------------------------------------ state -------
const G = {
  state: 'menu', // menu | ranger | pass | map | event | play | swap | snap | roundend | shop | gameover | win | bossintro | how
  ante: 1, round: 0, money: 0, target: 0, score: 0, dispScore: 0,
  bites: 0, xrays: 0, deck: [], drawPile: [], mouth: [], pool: null,
  charms: [], cons: [], boss: null, bossOrder: [],
  mode: 'idle', // idle | xray | extract (extract kept for programmatic use)
  extractCons: -1,
  novocaine: false, numbUsed: false, greedyCount: 0,
  shopItems: [], rerollCost: 4,
  snapT: 0, snapIdx: -1, jawClose: 0, swapT: 0,
  cash: null, stats: null, wonOnce: false,
  deckOpen: false, howFrom: 'menu',
  drag: null,      // {kind:'cons'|'charm', idx, x, y, vx}
  inspect: null,   // {kind, def, ...}
  xanim: null,     // {i, t}
  runSweeps: 0, roundPressed: 0, heartUsed: false,
  ranger: 'scout',
  map: null,       // {stages:[[node,..],[node,..],[boss]], stage, picked:[]}
  nodeType: 'small', nodeName: 'SMALL GATOR',
  eventBuffs: { bites: 0, xrays: 0, mult: 0, snapNext: 0 },
  roundBanks: 0,
  event: null,     // {def, phase:'intro'|'outcome', textT, outcome}
  boat: null,      // {x,y,tx,ty,t,node,k} travel animation on the map
  biStart: 0,      // boss intro slam timer
  bench: null,     // {consIdx, def, sel:[], page, ret} dentist bench targeting
  benchFx: null,   // {def, spots:[{x,y,up}], t} per-tool application animation
  pack: null,      // {kind, options, t} pack opening
  paused: false, overlay: null, // overlay: 'settings' | 'credits' (from pause or menu)
  shopPacks: [],
  cut: null,       // run-intro cutscene {t, shot}
  gacha: null,     // gacha-pon machine anim {phase, t, prize, capCol}
  shopEnter: -9,   // walk-in door animation timer
  compoundMult: 0, sweepCarry: 0, denturesUsed: false, feastTimes: [],
  summer: false, mut: null, crabs: [], crabT: 0, seashellUsed: false, // summer stage + mutations
  seq: null,       // Balatro-style bank scoring sequence {steps,total,i,t,dispT,dispM}
  chipPulse: 0,    // TEETH/MULT chip pulse ring timer
  xrayUsedRound: 0, shopsVisited: 0, bossKills: 0, // badge build trackers
  orderOk: true, lastBitePresses: 0, carryTeeth: 0, sugarNext: false,
};
let trans = null;  // iris wipe: {t, cb, fired}
function startTransition(cb) { if (trans) return; trans = { t: 0, cb, fired: false }; sfx.whoosh(); }
let flyers = [];   // bought cards flying to their slot
let best = 0;
try { best = parseInt(localStorage.getItem('bitedown_best') || '0') || 0; } catch (e) { }
function saveBest() { try { localStorage.setItem('bitedown_best', '' + best); } catch (e) { } }

const has = id => G.charms.some(c => c.id === id);
// summer runs spend HERMIT CRABS (CR) instead of dollars
const curLabel = n => '$' + fmt(n); // one currency, coast to swamp
const rangerUnlocked = k => !RANGERS[k].ach || !!meta.ach[RANGERS[k].ach];
const bossIs = id => !!(G.boss && G.round === 2 && G.boss.id === id);
const xraysBlocked = () => bossIs('murky');
const snapCountFor = () => {
  return 1 + ((bossIs('twofang') || bossIs('apexpred') || bossIs('king')) ? 1 : 0)
    + (nodeModOn('swarming') ? 1 : 0);
};

function mkTooth(type, base) {
  indexSee('tooth_' + type, true); // log the tooth type in the INDEX (quietly)
  return { id: uid(), type, base: base !== undefined ? base : TOOTH_DEFS[type].base };
}

// --------------------------------------------------------- fx: floats etc -
let floats = [], parts = [], shake = 0, flashRed = 0;
function clearFx() { floats = []; parts = []; }
function float(x, y, txt, col, sc, life) {
  floats.push({ x, y, txt, col: col || C.white, sc: sc || 1, t: 0, life: life || 1.1 });
}
function burst(x, y, col, n, spd) {
  for (let i = 0; i < (n || 8); i++) {
    const a = rnd() * Math.PI * 2, s = (spd || 60) * (0.4 + rnd());
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, g: 220, t: 0, life: 0.5 + rnd() * 0.5, col, sz: ri(1, 3) });
  }
}
// ---------------------------------------------------------- CARTOON FX -----
// Chunky Saturday-morning effects: spinning stars, popping rings, dust puffs,
// confetti ribbons and speed lines. All ride the same `parts` list.
function fxStars(x, y, col, n, spd) {
  for (let i = 0; i < (n || 5); i++) {
    const a = -Math.PI / 2 + (rnd() - 0.5) * 2.4, s = (spd || 80) * (0.5 + rnd());
    parts.push({ kind: 'star', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 300, t: 0, life: 0.5 + rnd() * 0.4, col: col || '#ffe089', sz: ri(3, 5), spin: (rnd() - 0.5) * 14 });
  }
}
function fxRing(x, y, col, r0, r1, life) {
  parts.push({ kind: 'ring', x, y, vx: 0, vy: 0, g: 0, t: 0, life: life || 0.34, col: col || '#fff6c8', r0: r0 || 3, r1: r1 || 20 });
}
function fxPuff(x, y, n, col) {
  for (let i = 0; i < (n || 4); i++) {
    const a = Math.PI + (rnd() - 0.5) * 2.6;
    parts.push({ kind: 'puff', x: x + (rnd() - 0.5) * 8, y, vx: Math.cos(a) * 26 * (0.4 + rnd()), vy: -14 - rnd() * 18, g: -12, t: 0, life: 0.45 + rnd() * 0.35, col: col || '#cfe0d8', sz: ri(3, 6) });
  }
}
function fxConfetti(x, y, n) {
  const cols = ['#ff8ab0', '#7fd4e8', '#ffe089', '#a8e86a', '#c8a8f8', '#ff9a5a'];
  for (let i = 0; i < (n || 14); i++) {
    const a = -Math.PI / 2 + (rnd() - 0.5) * 2.2, s = 70 + rnd() * 90;
    parts.push({ kind: 'ribbon', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 190, t: 0, life: 0.9 + rnd() * 0.7, col: choice(cols), sz: ri(2, 3), spin: (rnd() - 0.5) * 16 });
  }
}
function fxLines(x, y, col, n, spread) {
  for (let i = 0; i < (n || 6); i++) {
    const a = rnd() * Math.PI * 2, s = (spread || 90) * (0.6 + rnd());
    parts.push({ kind: 'line', x: x + Math.cos(a) * 8, y: y + Math.sin(a) * 8, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 0, t: 0, life: 0.22 + rnd() * 0.12, col: col || '#ffffff', sz: ri(4, 8), ang: a });
  }
}
// one loud cartoon impact: ring + stars + a couple of speed lines
function fxPop(x, y, col) { fxRing(x, y, col, 3, 18); fxStars(x, y, col, 4, 70); fxLines(x, y, col + '88', 4, 70); }

// ------------------------------------------------------------ run flow ----
function newRun(rangerKey) {
  ensureDaily();
  G.ranger = rangerKey || meta.ranger || 'scout';
  if (!rangerUnlocked(G.ranger)) G.ranger = 'scout';
  meta.ranger = G.ranger; saveMeta();
  G.ante = 1; G.round = 0;
  G.money = (G.ranger === 'trader' ? 12 : 4) + (meta.perks.pocket ? 3 : 0);
  G.charms = []; G.cons = []; G.deck = [];
  for (let v = 1; v <= 5; v++) for (let k = 0; k < 4; k++) G.deck.push(mkTooth('plain', v));
  if (G.ranger === 'medic') {
    const nov = CONS.find(c => c.id === 'novocaine');
    if (nov) G.cons.push(nov);
  }
  G.bossOrder = shuffle(BOSSES.slice());
  G.stats = { pressed: 0, snaps: 0, banks: 0, bestBank: 0, moneyEarned: 0 };
  G.wonOnce = false; G.deckOpen = false; G.inspect = null; G.drag = null;
  G.runSweeps = 0;
  G.eventBuffs = { bites: 0, xrays: 0, mult: 0, snapNext: 0 };
  G.compoundMult = 0; G.sweepCarry = 0; G.bench = null; G.pack = null;
  G.summer = false; G.mut = null; G.crabs = []; // normal swamp run by default
  bossShot = null; // never reuse a previous run's boss portrait (shark vs gator!)
  G.shopsVisited = 0; G.bossKills = 0; G.carryTeeth = 0; G.lastBitePresses = 0;
  G.seq = null; G.sugarNext = false; charmPop = {};
  floats = []; parts = []; shake = 0; flyers = [];
  genMap();
  G.state = 'map';
}

// ---------------------------------------------------------- swamp map -----
function genMap() {
  const mk = t => ({ type: t });
  const opt = base => {
    const r = rnd();
    if (r < 0.34) return mk('event');
    if (r < 0.58) return mk('gold');
    return mk(base);
  };
  const s0 = [mk('small'), opt('small')];
  const s1 = [mk('big'), opt('big'), opt('big')]; // three-way fork mid-trail
  // guarantee at least one event per ante so choices always matter
  if (![...s0, ...s1].some(n => n.type === 'event')) {
    (rnd() < 0.5 ? s0 : s1)[1] = mk('event');
  }
  // node modifiers: forks are different gambles, not just bigger blinds
  [...s0, ...s1].forEach(n => {
    if (n.type === 'event') return;
    n.mods = [];
    const modChance = G.ante >= 5 ? 1 : G.ante >= 2 ? 0.6 : 0.35;
    if (rnd() < modChance) n.mods.push(rnd() < (n.type === 'gold' ? 0.62 : 0.45) ? choice(BAD_MODS) : choice(GOOD_MODS));
    if (G.ante >= 5 && rnd() < 0.4) {
      const other = n.mods[0] && NODE_MODS[n.mods[0]].bad ? choice(GOOD_MODS) : choice(BAD_MODS);
      if (!n.mods.includes(other)) n.mods.push(other);
    }
  });
  const boss = mk('boss');
  // pre-roll each fightable node's MUTATION now, so the map can show the variant
  // (bosses only mutate on the ocean stage). startFight reuses node.mut.
  [...s0, ...s1, boss].forEach(n => {
    if (n.type === 'event') { n.mut = null; return; }
    const canMut = G.summer || n.type !== 'boss';
    n.mut = canMut ? rollMutation(true) : null;
  });
  G.map = { stages: [s0, s1, [boss]], stage: 0, picked: [], id: ri(1, 999999) };
  G.boat = null;
}
const nodeModOn = id => (G.nodeMods || []).includes(id);

function pickNode(k) {
  if (G.state !== 'map' || !G.map || trans) return;
  const opts = G.map.stages[G.map.stage];
  if (!opts || !opts[k]) return;
  const node = opts[k];
  G.map.picked[G.map.stage] = k;
  G.map.stage++;
  startTransition(() => launchNode(node));
  sfx.pickup();
}

function launchNode(node) {
  if (node.type === 'event') { startEvent(); return; }
  startFight(node);
}

function startFight(node) {
  G.nodeType = node.type;
  G.nodeMods = node.mods || [];
  G.nodeName = NODE_DEFS[node.type].name;
  if (G.summer) G.nodeName = node.type === 'boss' ? 'MEGALODON' : node.type === 'small' ? 'REEF SHARK' : 'TIGER SHARK';
  G.round = node.type === 'boss' ? 2 : node.type === 'small' ? 0 : 1;
  G.boss = node.type === 'boss' ? (G.ante === 8 ? FINAL_BOSS : G.bossOrder[(G.ante - 1) % G.bossOrder.length]) : null;
  const megaJaw = (node.mut === 'mega'); // COLOSSAL: harder target, double payout
  G.target = Math.round((G.ante <= 8 ? ANTE_BASE[G.ante - 1] : ANTE_BASE[7] * Math.pow(1.7, G.ante - 8)) * NODE_DEFS[node.type].mult
    * (has('gumbo') ? 0.92 : 1) * (megaJaw ? 1.25 : 1));
  G.score = 0; G.dispScore = 0;
  if (nodeModOn('toll')) { G.money = Math.max(0, G.money - 3); float(60, 190, 'TOLL -$3', C.red, 1, 1.4); }
  G.bites = Math.max(1, 3 + (has('chewtoy') ? 1 : 0) + (has('moonshine') ? 1 : 0)
    + (G.ranger === 'medic' ? 1 : 0) - (has('glass') ? 1 : 0) - (G.ranger === 'snail' ? 1 : 0)
    + (has('kingmaker') && node.type === 'boss' ? 2 : 0) + (has('foreverglades') ? 1 : 0)
    + (has('airfan') && node.type === 'small' ? 1 : 0) + (has('airhorn') && node.type === 'boss' ? 1 : 0)
    + (nodeModOn('tailwind') ? 1 : 0) - (nodeModOn('tired') ? 1 : 0)
    + G.eventBuffs.bites);
  G.xrays = 3 + (has('license') ? 1 : 0) + (has('moonshine') ? 1 : 0) + (has('foreverglades') ? 1 : 0)
    + (has('mosquitonet') ? 1 : 0) + (has('fireflyjar') && node.type === 'boss' ? 2 : 0)
    + (has('heronfeather') && node.type === 'small' ? 1 : 0)
    - (nodeModOn('foggy') ? 1 : 0) + G.eventBuffs.xrays
    + (node.mut === 'spotted' ? 1 : 0); // KEEN EYES
  G.xrays = Math.max(0, G.xrays);
  if (has('foreverglades')) gainMoney(2);
  if (bossIs('apexpred')) G.xrays = Math.min(G.xrays, 1);
  G.numbUsed = false; G.greedyCount = 0; G.seashellUsed = false;
  G.xrayUsedRound = 0; G.seq = null;
  // the MUTATION was pre-rolled on the map node so it can be shown there; reuse
  // it (fall back to a fresh roll if this fight was launched without a node).
  if (node && node.mut !== undefined) G.mut = node.mut;
  else G.mut = (G.summer || node.type !== 'boss') ? rollMutation(true) : null;
  if (G.mut) G.nodeName = MUTATIONS[G.mut].name + ' ' + G.nodeName; // Manta wants this photo
  G.mutDefused = false; // ALBINO's free defuse, once per round
  if (G.mut) { // log it in the CROC INDEX and let Merle explain the ability
    indexSee('mut_' + G.mut);
    if (MUT_ABIL[G.mut]) sayMerle(MUTATIONS[G.mut].name + ' ' + (G.summer ? 'SHARK' : 'CROC'), MUT_ABIL[G.mut].name + ': ' + MUT_ABIL[G.mut].desc);
  }
  if (G.boss) indexSee('boss_' + G.boss.id);
  G.crabs = []; G.crabT = 2.5 + rnd() * 3; // hermit crabs (summer only)
  G.roundPressed = 0; G.heartUsed = false; G.roundBanks = 0;
  G.denturesUsed = false; G.feastTimes = [];
  G.roundBuffMult = G.eventBuffs.mult || 0;
  G.drawPile = shuffle(G.deck.slice());
  G.deckOpen = false; G.inspect = null; G.drag = null; G.xanim = null;
  if (G.ante >= 3) { unlock('ante3'); quest('ante3q', 1); }
  newMouth();
  G.eventBuffs = { bites: 0, xrays: 0, mult: 0, snapNext: 0 };
  if (G.boss) { G.state = 'bosscut'; G.bcut = { t: 0 }; sfx.boss(); }
  else { G.state = 'play'; }
}

function afterShop() {
  if (G.map.stage >= 3) {
    G.ante++;
    // the swamp stays a swamp all 8 antes - the OCEAN only opens after a win,
    // when you choose SET SAIL (which sets G.summer). No sharks before that.
    genMap();
  }
  G.state = 'map';
}

// -------------------------------------------------------- swamp events ----
function startEvent() {
  const recent = G.seenEvents || (G.seenEvents = []);
  let pool = MINIGAME_KEYS.filter(k => !recent.includes(k));
  if (!pool.length) { G.seenEvents = []; pool = MINIGAME_KEYS.slice(); }
  const game = choice(pool);
  recent.push(game);
  G.event = { game, phase: 'intro', t: 0, s: null, pay: 0, cookies: 0, lines: [], grade: '' };
  G.state = 'event';
}

// tighten a freshly-initialised mini-game so events are a real challenge:
// less time on the clock, fewer attempts, and stingier per-game knobs.
function hardenEvent(game, s) {
  if (typeof s.timer === 'number' && game !== 'cook') s.timer = Math.max(8, Math.round(s.timer * 0.68));
  if (typeof s.casts === 'number') s.casts = Math.max(3, s.casts - 2);   // fish
  if (typeof s.throws === 'number') s.throws = Math.max(4, s.throws - 2); // feed
  if (typeof s.shots === 'number') s.shots = Math.max(4, s.shots - 2);    // birdy
  if (game === 'cook') s.heat = 0.5;              // starts closer to burning
  if (typeof s.rate === 'number') s.rate = s.rate * 0.7; // burger patties cook faster
}
// a mini-game reports its result here; rewards are paid on CONTINUE
function finishGame(grade, pay, cookies, lines) {
  const ev = G.event; if (!ev || ev.phase === 'done') return;
  ev.phase = 'done'; ev.t = 0;
  // events pay lean now: half the old money, half the bonus cookies
  ev.grade = grade; ev.pay = Math.max(1, Math.round(pay * 0.5)); ev.cookies = Math.floor(cookies * 0.5);
  // rewrite any "+$N" money lines to match the leaner payout
  ev.lines = (lines || []).map(l => l.replace(/\+\$\d+/g, '+$' + ev.pay));
  sfx.win();
}
function collectEvent() {
  const ev = G.event; if (!ev || ev.phase !== 'done') return;
  gainMoney(ev.pay);
  if (has('duckcall')) { gainMoney(3); float(60, 150, 'DUCK CALL +$3', C.gold, 1, 1.2); }
  addRP(1 + ev.cookies + (has('dragonfly') ? 2 : 0), 'FIELD EXPERIENCE');
  quest('event1', 1);
  sfx.buy();
  closeEvent();
}

function closeEvent() {
  if (!G.event) return;
  G.event = null;
  const go = () => {
    if (G.map.stage >= 3) { G.ante++; genMap(); }
    G.state = 'map';
  };
  if (trans) go(); else startTransition(go); // never drop the state change
}

function mouthSizeFor() {
  let size = 10 + (has('braces') ? 2 : 0) + (bossIs('tender') ? -2 : 0) + (bossIs('king') ? 2 : 0)
    + (G.ranger === 'scout' ? 1 : 0) + (has('cypressroot') ? 1 : 0);
  if (G.mut === 'extra') size += 4;           // OVERCROWDED: crammed maw
  if (G.mut === 'mega') size += 2;
  if (G.mut === 'dwarf') size = Math.min(size - 2, 8); // TINY TERROR: fewer teeth
  if (lilGator()) size = Math.min(size, 12);  // cap the lil gator AFTER mutations so it never overcrowds
  return Math.max(6, Math.min(size, G.deck.length));
}

function newMouth() {
  const size = mouthSizeFor();
  let snaps = Math.min(snapCountFor() + (G.eventBuffs.snapNext > 0 ? 1 : 0), Math.max(1, size - 4));
  if (G.eventBuffs.snapNext > 0) { G.eventBuffs.snapNext = 0; float(W / 2 + 50, 100, 'THE SWAMP REMEMBERS: +1 SNAPPER', C.red, 1, 1.6); }
  if (G.drawPile.length < size) G.drawPile = shuffle(G.deck.slice());
  const drawn = G.drawPile.splice(0, size);
  let order;
  if (bossIs('bogqueen')) {
    // snappers lurk among the 3 highest-value teeth
    order = drawn.map((_, i) => i).sort((a, b) => drawn[b].base - drawn[a].base).slice(0, Math.max(3, snaps));
    order = shuffle(order);
  } else {
    order = shuffle(drawn.map((_, i) => i));
  }
  const snapSet = new Set(order.slice(0, snaps));
  G.mouth = drawn.map((t, i) => ({ t, snap: snapSet.has(i), pressed: false, revealed: null, gone: false, pop: 0 }));
  G.pool = { teeth: 0, mult: 1, clicks: 0 };
  if (has('wisdom')) G.pool.mult += G.ante;
  if (has('coldblood')) G.pool.mult += 3 * snaps;
  if (has('mirror')) G.pool.mult += 2 * G.mouth.filter(s => s.t.type !== 'plain').length;
  if (has('venom')) G.pool.mult += Math.floor(G.roundPressed / 2);
  if (G.ranger === 'snail') G.pool.mult += 3;
  if (mutIs('dwarf')) G.pool.mult += 6; // TINY TERROR: small maw, furious start
  if (G.roundBuffMult) G.pool.mult += G.roundBuffMult;
  if (has('compound') && G.compoundMult > 0) G.pool.mult += G.compoundMult;
  if (has('suncharm')) G.pool.mult += G.xrays; // SUN CHARM: bank your unused sight
  if (has('ferris') && G.lastBitePresses > 0) { G.pool.mult += G.lastBitePresses; float(W / 2 + 50, 108, 'FERRIS +' + G.lastBitePresses + ' MULT', C.purple, 1, 1.4); popCharm('ferris'); }
  if (has('boomer') && G.carryTeeth > 0) { G.pool.teeth += G.carryTeeth; float(W / 2 + 50, 116, 'BOOMERANG +' + G.carryTeeth, C.blue, 1, 1.4); popCharm('boomer'); G.carryTeeth = 0; }
  if (has('librarian')) G.pool.mult += Math.min(15, G.deck.filter(x => x.type !== 'plain').length);
  if (has('sugarrush') && G.sugarNext) { G.pool.teeth += 2 * G.mouth.length; float(W / 2 + 50, 124, 'SUGAR RUSH +' + 2 * G.mouth.length, '#ff8ab0', 1, 1.4); popCharm('sugarrush'); G.sugarNext = false; }
  if (has('jurassic')) {
    const amb = G.mouth.filter(s => s.t.type === 'amber').length;
    if (amb > 0) { G.pool.mult += 10 * amb; float(W / 2 + 50, 132, 'JURASSIC +' + 10 * amb + ' MULT', '#e8b45a', 1, 1.5); popCharm('jurassic'); }
  }
  G.orderOk = true; G.lastOrderBase = -1; // DOMINO watches the pressing order
  if (G.sweepCarry > 0) {
    if (has('ouroboros')) { G.pool.mult += G.sweepCarry; float(W / 2 + 50, 104, 'TAIL EATER: +' + G.sweepCarry + ' MULT', C.purple, 1, 1.5); }
    G.sweepCarry = 0;
  }
  G.feastTimes = [];
  G.novocaine = false; G.mode = 'idle'; G.extractCons = -1; G.xanim = null;
  G.jawClose = 0;
  G.lastPressedBase = 0; G.honeyNext = false;
  if (nodeModOn('charmed')) G.pool.mult += 2;
  if (nodeModOn('gilded')) {
    // a visiting gold tooth (not from your deck) replaces a random slot
    const slot = choice(G.mouth.filter(s => !s.snap));
    if (slot) slot.t = mkTooth('gold');
  }
  if (nodeModOn('blessed')) {
    const s = choice(G.mouth);
    if (s) s.revealed = s.snap ? 'snap' : 'safe';
  }
  if (G.ranger === 'scout') {
    // the scout spots one tooth for free
    const s = choice(G.mouth);
    if (s) s.revealed = s.snap ? 'snap' : 'safe';
  }
  if (has('owlfeather')) {
    const s = choice(G.mouth.filter(m => !m.revealed));
    if (s) s.revealed = s.snap ? 'snap' : 'safe';
  }
}

function gainMoney(n) {
  G.money += n;
  G.stats.moneyEarned += Math.max(0, n);
  if (G.money >= 25) quest('money25', 1);
  if (G.money >= 50) unlock('rich');
}

function toothScreenPos(i) {
  const L = mouthLayout();
  const s = L.slots[i];
  return s ? { x: s.x + s.w / 2, y: s.y + s.h / 2 } : { x: W / 2, y: H / 2 };
}

// THE RESTLESS: snap teeth relocate among hidden teeth after every 3rd press
function relocateSnaps() {
  const hidden = G.mouth.map((s, i) => ({ s, i })).filter(o => !o.s.pressed && !o.s.gone);
  if (hidden.length < 2) return;
  const snapCount = hidden.filter(o => o.s.snap).length;
  if (!snapCount) return;
  hidden.forEach(o => { o.s.snap = false; o.s.revealed = null; });
  shuffle(hidden.slice()).slice(0, snapCount).forEach(o => { o.s.snap = true; });
  float(W / 2 + 40, 96, 'THE SNAPPERS MOVED!', C.purple, 1, 1.4);
  sfx.thunk();
}

function pressTooth(i) {
  if (G.state !== 'play' || G.seq) return; // no pressing while the bank pays out
  const s = G.mouth[i];
  if (!s || s.pressed || s.gone) return;
  if (G.xanim && G.xanim.i === i && G.xanim.t < 0.5) return; // mid-scan
  if (G.mode === 'xray') { doXray(i); return; }
  if (G.mode === 'extract') { doExtract(i); return; }
  const p = toothScreenPos(i);
  unlock('firstpress');

  if (s.snap) {
    // possible defusals
    let defused = null;
    if (G.novocaine) { defused = 'NOVOCAINE!'; G.novocaine = false; }
    else if (has('numb') && !G.numbUsed) { defused = 'NUMBED!'; G.numbUsed = true; }
    else if (mutIs('albino') && !G.mutDefused) { defused = 'PALE OMEN!'; G.mutDefused = true; }
    else if (has('loose') && rnd() < 1 / 3) { defused = 'POPPED OUT!'; }
    if (defused) {
      s.gone = true; s.revealed = 'snap';
      float(p.x, p.y - 10, defused, C.green, 1);
      burst(p.x, p.y, C.green, 10, 70);
      if (has('chum')) { G.pool.teeth += 15; float(p.x, p.y - 22, 'CHUM +15 TEETH', C.blue, 1); popCharm('chum'); }
      if (has('snakecharm')) { G.pool.mult += 10; float(p.x, p.y - 34, 'CHARMED +10 MULT', C.purple, 1); popCharm('snakecharm'); }
      sfx.defuse();
      quest('defuse2', 1);
      checkSweep();
      return;
    }
    startSnap(i);
    return;
  }

  s.pressed = true; s.pop = 0.25;
  G.pool.clicks++;
  G.stats.pressed++;
  G.roundPressed++;
  quest('press30', 1);
  if (s.t.type !== 'plain') quest('special5', 1);
  if (has('feast')) {
    G.feastTimes.push(tNow);
    G.feastTimes = G.feastTimes.filter(t2 => tNow - t2 < 1.5);
    if (G.feastTimes.length >= 3) {
      G.pool.mult += 6;
      G.feastTimes = [];
      float(p.x, p.y - 34, 'FRENZY! +6 MULT', C.orange, 1, 1.2);
      sfx.sweep();
    }
  }
  const diet = bossIs('diet');
  const applyPress = (echoed) => {
    let add = s.t.base;
    let mgain = 1;
    if (bossIs('ironjaw') && (G.pool.clicks % 2 === 1)) mgain = 0;
    if (has('hound') && G.pool.clicks >= 6) mgain += 1;
    if (has('sweet')) mgain += 1;
    if (has('lantern') && s.revealed === 'safe') mgain += 2;
    if (has('babyfangs') && s.t.base <= 2) mgain += 4;
    if (has('overbite') && G.pool.clicks === 1 && !echoed) { add += 12; float(p.x, p.y - 22, 'OVERBITE +12', C.blue, 1); popCharm('overbite'); }
    if (has('coconut') && !echoed && G.pool.clicks % 5 === 0) { add += 25; float(p.x, p.y - 22, 'COCONUT +25', '#8fe89c', 1); popCharm('coconut'); }
    if (has('daredevil') && G.mouth.filter(z => z.snap && !z.pressed && !z.gone).length >= 2) { mgain += 4; popCharm('daredevil'); }
    if (has('gemcutter') && GEM_TEETH.includes(s.t.type)) { add += 6; popCharm('gemcutter'); }
    if (has('lighthouse') && s.revealed === 'safe') { add += 3; popCharm('lighthouse'); }
    if (has('tinfang') && s.t.type === 'plain') add *= 2;
    if (mutIs('diamond')) add += 2;  // CRYSTAL ENAMEL: richer teeth
    if (mutIs('striped')) mgain += 1; // WARPAINT: the chain climbs faster
    let steel = false;
    if (s.t.type === 'fossil') mgain = 0; // the chain does not grow on fossils
    if (!diet) {
      switch (s.t.type) {
        case 'gold': { const m = has('crown') ? 4 : 2; gainMoney(m); if (has('crown')) add += 5; float(p.x, p.y - 22, '+$' + m, C.gold, 1); sfx.coin(); break; }
        case 'ruby': mgain += 4; break;
        case 'steel': steel = true; break;
        case 'lucky': if (ri(0, 2) === 0) { mgain += 5; float(p.x, p.y - 22, 'LUCKY! +5 MULT', C.green, 1); } break;
        case 'rotten': mgain += 6; break;
        case 'infected': mgain += 8; break;
        case 'vamp': { const v = 2 * (G.pool.clicks - 1); add += v; if (v > 0) float(p.x, p.y - 22, 'DRAIN +' + v, C.purple, 1); break; }
        case 'amber': mgain += 2; gainMoney(1); float(p.x, p.y - 22, '+$1', C.gold, 1); break;
        case 'emerald': mgain += 3; break;
        case 'moonstone': if (!xraysBlocked()) { G.xrays++; float(p.x, p.y - 22, '+1 X-RAY', C.blue, 1); } break;
        case 'pearl': if (G.pool.clicks === 1) { add += 10; float(p.x, p.y - 22, 'FIRST! +10', C.blue, 1); } break;
        case 'crystal': { add += G.lastPressedBase || 0; if (G.lastPressedBase) float(p.x, p.y - 22, 'COPY +' + G.lastPressedBase, '#b0dce8', 1); break; }
        case 'wraith': mgain += 12; G.money = Math.max(0, G.money - 1); float(p.x, p.y - 22, '+12 MULT -$1', C.purple, 1); break;
      }
      if (has('prism') && GEM_TEETH.includes(s.t.type)) mgain += 2;
    }
    if (G.honeyNext) { add *= 2; G.honeyNext = false; float(p.x, p.y - 28, 'HONEYED X2', '#f8c860', 1); }
    if (!diet && s.t.type === 'honey') G.honeyNext = true;
    if (bossIs('mudcake') && s.t.type !== 'obsidian') add = Math.max(1, Math.ceil(add / 2));
    if (nodeModOn('brittle') && s.t.type !== 'obsidian') add = Math.max(1, add - 1);
    G.lastPressedBase = s.t.base;
    G.pool.teeth += add;
    G.pool.mult += mgain;
    if (steel) { G.pool.mult = Math.round(G.pool.mult * 1.5); float(p.x, p.y - 22, 'X1.5 MULT', C.red, 1); }
    return { add, mgain };
  };
  // DOMINO: the chain only counts if values never went down this bite
  if (G.lastOrderBase >= 0 && s.t.base < G.lastOrderBase) G.orderOk = false;
  G.lastOrderBase = s.t.base;
  const r1 = applyPress(false);
  if (has('echo') && ri(0, 3) === 0) {
    applyPress(true);
    float(p.x, p.y - 30, 'ECHO!', C.purple, 1);
    popCharm('echo');
  }
  if (has('undertow') && G.undertowNext && G.pool.clicks === 1) {
    G.undertowNext = false;
    applyPress(true);
    float(p.x, p.y - 30, 'UNDERTOW!', '#7fd4e8', 1);
    popCharm('undertow');
  }
  if (has('metronome') && G.pool.clicks === 1) {
    applyPress(true);
    float(p.x, p.y - 36, 'METRONOME!', '#8fe8c8', 1);
    popCharm('metronome');
  }
  if (has('ricochet') && G.pool.clicks > 0 && G.pool.clicks % 4 === 0) {
    applyPress(true);
    float(p.x, p.y - 36, 'RICOCHET!', C.orange, 1);
    popCharm('ricochet');
  }
  if (has('echofang') && s.t.type !== 'plain' && ri(0, 2) === 0) {
    applyPress(true);
    float(p.x, p.y - 42, 'ECHO FANG!', '#c07dff', 1);
    popCharm('echofang');
  }
  if (has('greedy')) { G.greedyCount++; if (G.greedyCount % 4 === 0) { gainMoney(1); float(p.x, p.y - 28, 'GREEDY +$1', C.gold, 1); popCharm('greedy'); } }
  G.chipPulse = Math.max(G.chipPulse, 0.25);
  float(p.x - 8, p.y - 12, '+' + r1.add, C.blue, 1);
  if (r1.mgain > 0) float(p.x + 10, p.y - 6, '+' + r1.mgain, C.red, 1);
  burst(p.x, p.y, '#fef9e6', 5, 40);
  fxRing(p.x, p.y, '#fff6c8', 2, 11, 0.26); fxPuff(p.x, p.y + 6, 2, '#e8e0c8');
  sfx.click(G.pool.clicks);
  if (bossIs('restless') && G.pool.clicks % 3 === 0) relocateSnaps();
  checkSweep();
}

function checkSweep() {
  const anySafeLeft = G.mouth.some(s => !s.snap && !s.pressed && !s.gone);
  if (!anySafeLeft) {
    if (G.pool.clicks > 0) {
      float(W / 2 + 50, 96, 'CLEAN SWEEP!', C.gold, 2, 1.6);
      sfx.sweep();
      burst(W / 2 + 50, 130, C.gold, 20, 90);
      fxConfetti(W / 2 + 50, 120, 20); fxRing(W / 2 + 50, 128, '#fff6c8', 4, 40, 0.5);
      G.runSweeps++;
      quest('sweep1', 1);
      if (G.runSweeps >= 3) unlock('sweep3');
      if (has('snaggle')) { gainMoney(5); float(W / 2 + 50, 116, 'SNAGGLETOOTH +$5', C.gold, 1, 1.4); popCharm('snaggle'); }
      if (has('papercrane') && !xraysBlocked()) { G.xrays++; float(W / 2 + 50, 142, 'PAPER CRANE +1 X-RAY', '#9fe8ff', 1, 1.4); popCharm('papercrane'); }
      if (has('sugarrush')) G.sugarNext = true;
      bank(true);
    } else {
      // only snappers left and nothing pressed: the bite fizzles out
      float(W / 2 + 50, 96, 'NOTHING SAFE LEFT!', C.dim, 1, 1.4);
      endBite();
    }
  }
}

// ---- BANK SCORING, Balatro style ------------------------------------------
// bankSteps builds the whole payout as an ordered list of steps; the same list
// both computes the total (pure - no side effects) and drives the on-screen
// activation sequence where each contributing badge pops in turn.
function bankSteps(sweep) {
  const steps = [];
  let t = G.pool ? G.pool.teeth : 0, m = G.pool ? G.pool.mult : 1;
  const clicks = G.pool ? G.pool.clicks : 0;
  const addT = (cid, label, n) => { if (n > 0) { t += n; steps.push({ cid, txt: label + ' +' + fmt(n), col: '#5cc8ff', kind: 't', n }); } };
  const addM = (cid, label, n) => { if (n > 0) { m += n; steps.push({ cid, txt: label + ' +' + n + ' MULT', col: '#ff9a90', kind: 'm', n }); } };
  const xM = (cid, label, f) => { m = m * f; steps.push({ cid, txt: label + ' X' + f, col: C.purple, kind: 'x', n: f }); };
  const cash = (cid, label, n) => steps.push({ cid, txt: label + (n >= 0 ? ' +$' : ' -$') + Math.abs(n), col: n >= 0 ? C.gold : C.red, kind: 'cash', n });
  // ---- flat TEETH ----
  if (has('magnet')) addT('magnet', 'MAGNET', 15);
  if (has('goldrush')) addT('goldrush', 'GOLD RUSH', Math.min(30, G.money));
  if (has('slowbite')) addT('slowbite', 'PATIENT', 8 * G.mouth.filter(s => !s.pressed && !s.gone).length);
  if (has('millionfang')) addT('millionfang', 'MILLION FANG', G.deck.length);
  if (has('trophy')) addT('trophy', 'TROPHY', 8 * (G.bossKills || 0));
  if (sweep && has('starfish')) addT('starfish', 'STARFISH', 3 * clicks);
  // ---- RUSTY edition badges dump flat TEETH ----
  G.charms.forEach(c => { if (edOf(c) === 'rusty') addT(c.id, c.name.split(' ')[0] + ' RUSTY', 40); });
  // ---- flat MULT ----
  if (has('palmfrond')) addM('palmfrond', 'PALM FROND', 2 * Math.floor(clicks / 3));
  if (has('yardstick')) addM('yardstick', 'YARDSTICK', G.ante);
  if (has('tycoon')) addM('tycoon', 'TYCOON', Math.floor(G.money / 5));
  if (has('filmreel')) addM('filmreel', 'FILM REEL', 3 * (G.xrayUsedRound || 0));
  if (has('stampbook')) addM('stampbook', 'STAMPS', 2 * (G.shopsVisited || 0));
  if (has('scrapbook')) addM('scrapbook', 'SCRAPBOOK', 3 * MUT_ORDER.filter(k => meta.summer.caught[k]).length);
  // ---- X MULT (the crazy-build layer) ----
  if (has('highnoon') && m >= 20) xM('highnoon', 'HIGH NOON', 3);
  if (has('glass')) xM('glass', 'GLASS JAW', 2);
  if (has('leviathan')) xM('leviathan', 'LEVIATHAN', 2);
  if (has('bloodpact')) xM('bloodpact', 'BLOOD PACT', 3);
  if (has('rootcanal') && clicks >= 7) xM('rootcanal', 'ROOT CANAL', 2);
  if (has('apex') && clicks >= 8) xM('apex', 'APEX', 3);
  if (has('totem') && G.round === 2) xM('totem', 'TOTEM', 1.5);
  if (has('jackpot') && clicks === 7) xM('jackpot', 'JACKPOT', 5);
  if (has('gambit') && G.mouth.filter(s => s.snap && !s.pressed && !s.gone).length === 2) xM('gambit', 'GAMBIT', 2.5);
  if (has('tightrope') && G.mouth.filter(s => s.snap && !s.pressed && !s.gone).length === 1) xM('tightrope', 'TIGHTROPE', 2.5);
  if (has('lowtide') && clicks <= 3) xM('lowtide', 'LOW TIDE', 2);
  if (has('perfection') && !(G.xrayUsedRound || 0)) xM('perfection', 'PERFECT', 2);
  if (has('domino') && G.orderOk && clicks >= 3) xM('domino', 'DOMINO', 2);
  if (has('minimalist') && G.deck.length <= 16) xM('minimalist', 'MINIMAL', 2);
  if (has('hourhand') && G.roundBanks === 0) xM('hourhand', 'HOUR HAND', 2);
  if (has('anchorjaw') && G.round === 1) xM('anchorjaw', 'ANCHOR', 1.5);
  if (has('jurassic') && G.deck.filter(x => x.type === 'amber').length >= 5) xM('jurassic', 'T-REX', 5);
  if (mutIs('alien')) xM(null, 'ALIEN CROC', 2); // NOT OF THIS SWAMP
  // ---- DIAMOND edition badges each grant an X1.5 ----
  G.charms.forEach(c => { if (edOf(c) === 'diamond') xM(c.id, c.name.split(' ')[0] + ' DIAMOND', 1.5); });
  if (sweep) xM(has('collector') ? 'collector' : null, 'SWEEP', has('collector') ? 2 : (G.ranger === 'frog' ? 1.75 : 1.25));
  // ---- cash payouts ride along the sequence ----
  if (has('canteen') && clicks <= 3) cash('canteen', 'CANTEEN', 3);
  if (has('baitbucket')) cash('baitbucket', 'BAIT', 1);
  if (has('msgbottle') && (G.stats.banks + 1) % 3 === 0) cash('msgbottle', 'BOTTLE', 6);
  if (sweep && has('otterpaw')) cash('otterpaw', 'OTTER', 3);
  if (bossIs('loanshark')) cash(null, 'LOAN SHARK', -2);
  if (has('bloodpact')) cash('bloodpact', 'PACT', -2);
  return { steps, total: Math.floor(t * m), t0: G.pool ? G.pool.teeth : 0, m0: G.pool ? G.pool.mult : 1 };
}
function bankMath(sweep) { return bankSteps(sweep).total; }
const bankValue = () => bankMath(false);

// where a step's float text spawns: over its badge in the top bar, else the chips
function charmSlotPos(cid) {
  const i = G.charms.findIndex(c => c.id === cid);
  if (i >= 0) return { x: 120 + i * 31 + 13, y: 54 };
  return { x: 62, y: 132 };
}
let charmPop = {}; // charm id -> pop timer (badge bounce when it activates)
function popCharm(id) { if (id) charmPop[id] = 0.45; }

function bank(sweep) {
  if (G.state !== 'play' || G.seq) return;
  if (G.pool.clicks === 0) { sfx.error(); float(248, 232, 'PRESS A TOOTH FIRST!', C.red, 1); return; }
  if (!sweep && bossIs('lockjaw') && G.pool.clicks < 4) { sfx.error(); float(248, 232, 'LOCKJAW: NEED 4+ TEETH', C.red, 1); return; }
  if (!sweep && bossIs('shellback') && G.pool.clicks < 6) { sfx.error(); float(248, 232, 'SHELLBACK: NEED 6+ TEETH', C.red, 1); return; }
  const b = bankSteps(!!sweep);
  G.seq = {
    steps: b.steps, total: b.total, sweep: !!sweep, i: -1, t: 0,
    stepDur: clamp(1.5 / Math.max(1, b.steps.length), 0.16, 0.32),
    dispT: b.t0, dispM: b.m0,
  };
  sfx.click(1);
}
// plays the bank sequence: one badge activation per beat, then the total lands
function updateSeq(dt) {
  const q = G.seq; if (!q) return;
  q.t += dt;
  while (q.i < q.steps.length - 1 && q.t >= (q.i + 1) * q.stepDur) {
    q.i++;
    const s = q.steps[q.i];
    if (s.kind === 't') q.dispT += s.n;
    else if (s.kind === 'm') q.dispM += s.n;
    else if (s.kind === 'x') q.dispM = q.dispM * s.n;
    else if (s.kind === 'cash') { if (s.n >= 0) gainMoney(s.n); else G.money = Math.max(0, G.money + s.n); }
    popCharm(s.cid);
    const at = charmSlotPos(s.cid);
    float(at.x, at.y, s.txt, s.col, 1, 0.95);
    G.chipPulse = 0.35;
    sfx.click(2 + q.i);
  }
  if (q.t >= q.steps.length * q.stepDur + 0.4) finishBank(q);
}
function finishBank(q) {
  const val = q.total;
  G.seq = null;
  G.score += val;
  G.stats.banks++;
  G.roundBanks++;
  G.scorePulse = 0.5;
  quest('bank8', 1);
  if (val > G.stats.bestBank) G.stats.bestBank = val;
  if (has('compound')) { G.compoundMult++; float(60, 174, 'COMPOUND +1', C.purple, 1); }
  if (has('undertow')) G.undertowNext = true;
  if (has('boomer')) G.carryTeeth = Math.floor(G.pool.teeth * 0.25);
  if (q.sweep && has('ouroboros')) { G.sweepCarry = G.pool.mult; float(W / 2 + 50, 128, 'THE CHAIN SURVIVES!', C.purple, 1, 1.6); }
  G.lastBitePresses = G.pool.clicks;
  float(60, 96, '+' + fmt(val), C.gold, 2, 1.4);
  burst(60, 100, C.gold, 14, 80);
  fxPop(60, 100, '#ffd54a');
  if (val >= 400) fxConfetti(60, 96, 16);
  addRipple(180 + rnd() * 200, 254, false);
  if (val >= 1200) shake = Math.min(3, 1 + val / 2500); // gentler: only huge banks rumble
  sfx.bank();
  endBite();
}

function startSnap(i) {
  const s = G.mouth[i];
  s.pressed = true; s.revealed = 'snap';
  G.state = 'snap'; G.snapT = 0; G.snapIdx = i;
  G.deckOpen = false; G.drag = null; G.inspect = null;
  if (has('insurance')) { gainMoney(5); float(60, 150, 'INSURANCE +$5', C.gold, 1, 1.4); popCharm('insurance'); }
  { const sp = toothScreenPos(i); fxRing(sp.x, sp.y, '#ff5a4a', 4, 34, 0.4); fxStars(sp.x, sp.y, '#ff8a6a', 7, 110); fxLines(sp.x, sp.y, '#ffffffaa', 8, 120); }
  sfx.snap();
}

function endBite() {
  G.bites--;
  G.mode = 'idle'; G.extractCons = -1; G.deckOpen = false;
  const twinBlock = bossIs('twin') && G.roundBanks < 2;
  if (G.score >= G.target && !twinBlock) { roundWon(); return; }
  if (G.score >= G.target && twinBlock) float(W / 2 + 50, 100, 'TWO-TIMER: BANK ONCE MORE!', C.purple, 1, 1.6);
  if (G.bites <= 0) { gameOver(); return; }
  // short beat before the fresh mouth slides in
  G.state = 'swap'; G.swapT = 0;
}

function roundWon() {
  let base = (NODE_DEFS[G.nodeType].reward || 4) + Math.floor(G.ante / 3) + (nodeModOn('richwater') ? 4 : 0)
    + (has('goldgrill') && G.nodeType === 'gold' ? 5 : 0);
  if (mutIs('mega')) base *= 2; // COLOSSAL: tougher target, double payout
  if (has('rangerpin') && G.round === 2) addRP(3, 'RANGER PIN');
  const perBite = G.bites; // unused bites, $1 each
  const cap = G.ranger === 'trader' ? 8 : 5;
  const interest = (has('hoard') ? Math.floor(G.money / 4) : Math.min(cap, Math.floor(G.money / 5)))
    + (has('snailshell') ? 2 : 0);
  const fairy = has('fairy') ? 2 : 0;
  const golden = 4 * G.charms.filter(c => edOf(c) === 'golden').length; // GOLDEN badges
  G.cash = { base, perBite, interest, fairy, golden, cap, total: base + perBite + interest + fairy + golden };
  addMastery(G.ranger, 4 + G.ante * 2 + (G.round === 2 ? 8 : 0));   // field hours logged
  G.state = 'roundend';
  G.deckOpen = false; G.drag = null; G.inspect = null; clearFx();
  if (G.round === 2) { unlock('boss'); quest('boss1q', 1); G.bossKills = (G.bossKills || 0) + 1; }
  if (G.nodeType === 'gold') quest('gold1', 1);
  sfx.win();
  if (G.ante > best) { best = G.ante; saveBest(); }
  saveMeta(); // persist daily quest progress at round boundaries
}

function cashOut() {
  gainMoney(G.cash.total);
  if (G.ante === 8 && G.round === 2 && !G.wonOnce) {
    G.wonOnce = true;
    unlock('win');
    quest('run1', 1);
    addRP(30, 'RUN WON');
    meta.summer.won = true; meta.summer.unlocked = true; // legacy save fields
    saveMeta();
    G.state = 'win';
    return;
  }
  enterShop();
}

function enterShop() {
  G.shopsVisited = (G.shopsVisited || 0) + 1; // STAMP BOOK keeps count
  G.rerollCost = meta.perks.coupon ? 0 : (has('tacklecharm') ? 3 : 4);
  // a shop-mutation croc (gilded/glacial/corroded) salts THIS shop with its
  // matching badge edition + a discount; consumed once.
  const smut = (G.mut && MUTATIONS[G.mut] && MUTATIONS[G.mut].shop) ? MUTATIONS[G.mut].shop : null;
  G.shopEd = smut ? smut.ed : null;
  G.shopDisc = smut ? (smut.disc || 1) : 1;
  rollShop();
  stockPacks();
  rollCosmetics();
  G.state = 'shop';
  G.shopEnter = tNow; // door swings open, Merle looks up
  G.deckOpen = false; G.drag = null; G.inspect = null; clearFx();
}

function weightedCharm(pool) {
  const w = pool.map(c => c.rar === 0 ? 6 : c.rar === 1 ? 3 : c.rar === 2 ? 1 : 0.4);
  let tot = w.reduce((a, b) => a + b, 0);
  let r = rnd() * tot;
  for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) return pool[i]; }
  return pool[pool.length - 1];
}

// give a shop badge an EDITION: forced by a shop-mutation, else a rare surprise.
// returns a fresh item carrying a def COPY so the master CHARMS list is untouched.
function editionItem(def) {
  let ed = G.shopEd || null;
  if (!ed && rnd() < 0.04) ed = choice(EDITION_KEYS); // rare wild edition (mostly from mutations)
  let price = def.cost;
  let cdef = def;
  if (ed && EDITIONS[ed]) {
    cdef = Object.assign({}, def, { ed });
    price = Math.max(1, Math.round((def.cost + EDITIONS[ed].dp) * (G.shopDisc || 1)));
  }
  return { kind: 'charm', def: cdef, price, sold: false, ed };
}
function rollShop() {
  const items = [];
  let cpool = CHARMS.filter(c => !has(c.id) && cardUnlocked(c));
  for (let k = 0; k < 2 && cpool.length; k++) {
    const def = weightedCharm(cpool);
    cpool = cpool.filter(c => c !== def);
    items.push(editionItem(def));
  }
  const cdef = choice(CONS.filter(cardUnlocked));
  items.push({ kind: 'cons', def: cdef, price: cdef.cost, sold: false });
  const tdef = choice(TOOLS.filter(cardUnlocked));
  items.push({ kind: 'tool', def: tdef, price: tdef.cost, sold: false });
  G.shopItems = items;
}
function stockPacks() {
  // the snack stand carries two random products per visit
  const picks = shuffle(PACK_DEFS.slice()).slice(0, 2);
  G.shopPacks = picks.map(d => ({ kind: d.kind, def: d, price: d.cost, sold: false }));
}
// ---- cosmetics boutique: random-rarity gloves + hats for sale ----
const COSMETIC_PRICE = [6, 10, 16, 24, 36, 52]; // by rarity 0..5
function cosmeticPool() {
  const pool = [];
  // achievement/basic gloves become a buyable alt-path (gacha gloves stay gacha)
  GLOVE_ORDER.forEach(k => {
    if (k === 'bare' || GLOVES[k].gacha || gloveUnlocked(k)) return;
    pool.push({ kind: 'glove', k, rar: GLOVE_RAR[k] || 0 });
  });
  // shop-flagged hats (gacha + achievement hats stay exclusive)
  HAT_ORDER.forEach(k => {
    if (!HATS[k].shop || hatUnlocked(k)) return;
    pool.push({ kind: 'hat', k, rar: HATS[k].rar || 0 });
  });
  // shop-flagged face GEAR
  GEAR_ORDER.forEach(k => {
    if (!GEAR[k].shop || gearUnlocked(k)) return;
    pool.push({ kind: 'gear', k, rar: GEAR[k].rar || 0 });
  });
  // shirts, pants, shoes and costumes sold in the run shop
  Object.keys(FITS).forEach(k => { if (FITS[k].src === 'shop' && !fitUnlocked(k)) pool.push({ kind: 'fit', k, rar: FITS[k].rar || 0 }); });
  return pool;
}
function weightedCosmetic(pool) {
  const w = pool.map(c => [6, 5, 3.5, 2, 1, 0.4][c.rar] || 0.4);
  let tot = w.reduce((a, b) => a + b, 0), r = rnd() * tot;
  for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) return pool[i]; }
  return pool[pool.length - 1];
}
function rollCosmetics() {
  let pool = cosmeticPool();
  const picks = [];
  for (let n = 0; n < 2 && pool.length; n++) {
    const c = weightedCosmetic(pool);
    pool = pool.filter(o => o !== c);
    picks.push({ kind: c.kind, k: c.k, rar: c.rar, price: COSMETIC_PRICE[c.rar], sold: false });
  }
  G.cosmetics = picks;
}
function buyCosmetic(c) {
  if (!c || c.sold) return;
  if (G.money < c.price) { sfx.error(); float(mx, my - 10, 'NOT ENOUGH $', C.red, 1); return; }
  G.money -= c.price;
  c.sold = true;
  if (c.kind === 'glove') { meta.gachaOwn[c.k] = true; meta.glove = c.k; }
  else if (c.kind === 'gear') { meta.gearOwn[c.k] = true; meta.gear = c.k; }
  else if (c.kind === 'fit') { cosGrant(FITS[c.k].cat, c.k, true); }
  else { meta.hatOwn[c.k] = true; meta.hat = c.k; }
  saveMeta();
  quest('buy4', 1);
  sfx.buy();
  burst(mx, my, RAR_COL[c.rar], 12, 70);
  fxPop(mx, my, RAR_COL[c.rar]); fxStars(mx, my, '#ffffff', 4, 60);
}
function buyPack(p) {
  if (!p || p.sold) return;
  if (G.money < p.price) { sfx.error(); float(mx, my - 10, 'NOT ENOUGH $', C.red, 1); return; }
  if (p.kind === 'tool' && G.cons.length >= 3) { sfx.error(); float(mx, my - 10, 'CARD SLOTS FULL', C.red, 1); return; }
  G.money -= p.price;
  p.sold = true;
  quest('buy4', 1);
  openPack(p.def);
}

function buyItem(it) {
  if (it.sold) return;
  if (G.money < it.price) { sfx.error(); float(mx, my - 10, 'NOT ENOUGH $', C.red, 1); return; }
  if (it.kind === 'charm') {
    if (G.charms.length >= 5) { sfx.error(); float(mx, my - 10, 'CHARM SLOTS FULL', C.red, 1); return; }
    G.charms.push(it.def);
    indexSee('charm_' + it.def.id, true);
    flyers.push({ x: mx, y: my, tx: 120 + (G.charms.length - 1) * 31 + 15, ty: 33, t: 0, ico: it.def.ico, col: '#3e8cd0' });
  } else if (it.kind === 'cons' || it.kind === 'tool') {
    if (G.cons.length >= 3) { sfx.error(); float(mx, my - 10, 'CARD SLOTS FULL', C.red, 1); return; }
    G.cons.push(it.def);
    flyers.push({ x: mx, y: my, tx: 385 + (G.cons.length - 1) * 31 + 15, ty: 33, t: 0, ico: it.def.ico, col: it.kind === 'tool' ? '#3a9a8a' : '#8a5fd0' });
  } else if (it.kind === 'tooth') {
    G.deck.push(mkTooth(it.type));
    flyers.push({ x: mx, y: my, tx: 57, ty: 218, t: 0, tooth: it.type });
  }
  G.money -= it.price;
  it.sold = true;
  quest('buy4', 1);
  sfx.buy();
  burst(mx, my, C.gold, 8, 60);
  fxPop(mx, my, '#ffd54a');
}

function sellCharm(i) {
  const c = G.charms[i]; if (!c) return;
  const v = Math.ceil(c.cost / 2);
  gainMoney(v);
  G.charms.splice(i, 1);
  float(mx, my - 10, '+$' + v, C.gold, 1);
  sfx.coin();
}

function reroll() {
  if (G.money < G.rerollCost) { sfx.error(); float(mx, my - 10, 'NOT ENOUGH $', C.red, 1); return; }
  G.money -= G.rerollCost;
  G.rerollCost = G.rerollCost === 0 ? (has('tacklecharm') ? 3 : 4) : G.rerollCost + 1; // coupon perk: first one free
  rollShop();
  sfx.buy();
}

// kept as the programmatic "advance" for bots and the shop button
function nextRound() { afterShop(); }

function gameOver() {
  G.state = 'gameover';
  G.deckOpen = false; G.drag = null; G.inspect = null; clearFx();
  if (G.ante > best) { best = G.ante; saveBest(); }
  quest('run1', 1);
  G.runRP = Math.max(0, (G.ante - 1) * 2);
  if (G.runRP > 0) addRP(G.runRP, 'ANTES BEATEN');
  saveMeta();
  sfx.boss();
}

// --------------------------------------------------------- xray / extract -
function doXray(i) {
  const s = G.mouth[i];
  if (!s || s.pressed || s.gone || s.revealed) { sfx.error(); return; }
  if (bossIs('junkjaw')) { G.money = Math.max(0, G.money - 1); float(60, 190, 'JUNKJAW -$1', C.red, 1); }
  let truth = s.snap;
  if (bossIs('albino') && rnd() < 0.25) truth = !truth; // the Albino's x-rays lie
  s.revealed = truth ? 'snap' : 'safe';
  G.xrays--;
  G.xrayUsedRound = (G.xrayUsedRound || 0) + 1;
  G.mode = 'idle';
  quest('xray8', 1);
  if (has('telescope')) { // the neighboring tooth comes into focus too
    const nb = G.mouth[i + 1] && !G.mouth[i + 1].pressed && !G.mouth[i + 1].gone && !G.mouth[i + 1].revealed ? i + 1 : i - 1;
    const ns = G.mouth[nb];
    if (ns && !ns.pressed && !ns.gone && !ns.revealed) {
      ns.revealed = ns.snap ? 'snap' : 'safe';
      const np = toothScreenPos(nb);
      float(np.x, np.y - 14, 'TELESCOPE!', '#9fe8ff', 1);
      popCharm('telescope');
    }
  }
  G.xanim = { i, t: 0 };
  const p = toothScreenPos(i);
  float(p.x, p.y - 20, 'SCANNING...', '#9fe8ff', 1, 0.5);
  sfx.xray();
}
// what the scan DISPLAYS must match what was reported (the Albino lies)
function xrayShowsSnap(i) { return G.mouth[i] && G.mouth[i].revealed === 'snap'; }

function doExtract(i) {
  const s = G.mouth[i];
  if (!s || s.pressed || s.gone) { sfx.error(); return; }
  s.gone = true;
  const p = toothScreenPos(i);
  float(p.x, p.y - 14, s.snap ? 'YANKED A SNAPPER!' : 'YANKED', s.snap ? C.green : C.dim, 1);
  burst(p.x, p.y, '#fef9e6', 8, 60);
  if (G.extractCons >= 0) { G.cons.splice(G.extractCons, 1); }
  G.extractCons = -1; G.mode = 'idle';
  sfx.defuse();
  checkSweep();
}

// ----------------------------------------------- dentist bench (tools) ----
function openBench(consIdx) {
  const def = G.cons[consIdx];
  if (!def || !def.picks) return;
  if (G.state !== 'shop' && G.state !== 'map') {
    sfx.error(); float(mx, my - 10, 'USE BETWEEN FIGHTS (SHOP OR TRAIL)', C.red, 1);
    return;
  }
  G.bench = { consIdx, def, sel: [], page: 0, ret: G.state };
  G.state = 'bench';
  sfx.xray();
}
function benchToggle(toothId) {
  const b = G.bench; if (!b) return;
  const i = b.sel.indexOf(toothId);
  if (i >= 0) { b.sel.splice(i, 1); sfx.hover(); return; }
  if (b.sel.length >= b.def.picks) { sfx.error(); return; }
  b.sel.push(toothId); sfx.click(2);
}
const TOOL_FX = {
  polishdrill: { style: 'sparks', col: '#ffe089', sfx: 'drill' },
  goldfill: { style: 'drop', col: '#ffd54a', sfx: 'pour' },
  rubyinlay: { style: 'drop', col: '#ff4d6a', sfx: 'pour' },
  forceps: { style: 'rise', col: '#f4f0dc', sfx: 'yank' },
  bracewire: { style: 'sheen', col: '#c8d2d8', sfx: 'pin' },
  infectvial: { style: 'drip', col: '#a860e8', sfx: 'inject' },
  veneer: { style: 'sheen', col: '#ffffff', sfx: 'spray' },
  fluorbath: { style: 'bubbles', col: '#7fd4e8', sfx: 'spray' },
  extractor: { style: 'rise', col: '#ffd54a', sfx: 'yank' },
  diamondcap: { style: 'drop', col: '#9fe8ff', sfx: 'pour' },
};
function benchApply() {
  const b = G.bench; if (!b || !b.sel.length) { sfx.error(); return; }
  if (G.benchFx) return; // animation already running
  const teeth = b.sel.map(id => G.deck.find(t => t.id === id)).filter(Boolean);
  const removing = b.def.id === 'forceps' || b.def.id === 'extractor' || b.def.id === 'bigforceps';
  if (removing && G.deck.length - teeth.length < 9) {
    sfx.error(); float(mx, my - 10, 'DECK TOO SMALL (MIN 9)', C.red, 1); return;
  }
  // run the tool's animation over the visible selected teeth, then commit
  const fx = TOOL_FX[b.def.id] || TOOL_FX.polishdrill;
  const perPage = 14;
  const spots = [];
  b.sel.forEach(id => {
    const di = G.deck.findIndex(t => t.id === id);
    const pi = di - b.page * perPage;
    if (pi >= 0 && pi < perPage) {
      const top = pi < 7, k = top ? pi : pi - 7;
      spots.push({ x: 160 + 10 + k * 29 + 12, y: top ? 108 : 168, up: !top });
    }
  });
  if (sfx[fx.sfx]) sfx[fx.sfx]();
  G.benchFx = { def: b.def, fx, spots, t: 0 };
  return;
}
function benchCommit() {
  const b = G.bench; if (!b) return;
  const teeth = b.sel.map(id => G.deck.find(t => t.id === id)).filter(Boolean);
  switch (b.def.id) {
    case 'polishdrill': teeth.forEach(t => t.base += 3); break;
    case 'goldfill': teeth.forEach(t => { t.type = 'gold'; t.base = Math.max(t.base, 3); }); break;
    case 'rubyinlay': teeth.forEach(t => { t.type = 'ruby'; t.base = Math.max(t.base, 2); }); break;
    case 'forceps': teeth.forEach(t => { const i = G.deck.indexOf(t); if (i >= 0) G.deck.splice(i, 1); }); break;
    case 'bracewire': teeth.forEach(t => G.deck.push({ id: uid(), type: t.type, base: t.base })); break;
    case 'infectvial': teeth.forEach(t => { t.type = 'infected'; t.base = 0; }); break;
    case 'veneer': teeth.forEach(t => t.base = 8); break;
    case 'fluorbath': {
      const v = teeth[0].base;
      G.deck.filter(t => t.base === v).forEach(t => t.base += 2);
      break;
    }
    case 'extractor': {
      let pay = 0;
      teeth.forEach(t => { pay += t.base * 2; const i = G.deck.indexOf(t); if (i >= 0) G.deck.splice(i, 1); });
      gainMoney(pay);
      float(W / 2, 130, '+$' + pay, C.gold, 2, 1.4);
      break;
    }
    case 'diamondcap': teeth.forEach(t => { t.type = 'diamond'; t.base = 15; }); break;
    case 'whitening': teeth.forEach(t => t.base += 2); break;
    case 'bigforceps': teeth.forEach(t => { const i = G.deck.indexOf(t); if (i >= 0) G.deck.splice(i, 1); }); break;
    case 'emeraldcap': teeth.forEach(t => { t.type = 'emerald'; t.base = Math.max(t.base, 3); }); break;
    case 'moonmold': teeth.forEach(t => { t.type = 'moonstone'; t.base = Math.max(t.base, 3); }); break;
    case 'luckybrush': teeth.forEach(t => { t.type = 'lucky'; t.base = Math.max(t.base, 2); }); break;
    case 'amberresin': teeth.forEach(t => { t.type = 'amber'; t.base = Math.max(t.base, 3); }); break;
    case 'pearldive': teeth.forEach(t => { t.type = 'pearl'; t.base = Math.max(t.base, 3); }); break;
    case 'crystalspring': teeth.forEach(t => { t.type = 'crystal'; t.base = Math.max(t.base, 3); }); break;
  }
  G.drawPile = G.drawPile.filter(t => G.deck.includes(t));
  G.cons.splice(b.consIdx, 1);
  quest('tool1', 1);
  toasts.push({ name: b.def.name, sub: 'WORK COMPLETE', t: 0 });
  const ret = b.ret;
  G.bench = null; G.benchFx = null;
  G.state = ret;
  sfx.buy();
  burst(W / 2, 140, '#9fe8ff', 14, 80);
}
function benchCancel() {
  const b = G.bench; if (!b) return;
  const ret = b.ret;
  G.bench = null;
  G.state = ret;
  sfx.thunk();
}

// ------------------------------------------------------------ packs -------
function pullTooth(boost) {
  // higher-rarity weights scale with the pack's boost
  const rows = TOOTH_PULLS.map(([t, w]) => {
    const rar2 = TOOTH_DEFS[t].rar || 0;
    return [t, rar2 >= 2 ? w * (boost || 1) : w];
  });
  let tot = rows.reduce((a, r) => a + r[1], 0), r = rnd() * tot;
  for (const [t, w] of rows) { r -= w; if (r <= 0) return t; }
  return rows[0][0];
}
function openPack(product) {
  let options;
  const show = product.show + (meta.perks.bigpack ? 1 : 0);
  if (product.kind === 'tooth') {
    options = [];
    const seen = new Set();
    while (options.length < show) {
      const t = pullTooth(product.boost);
      if (seen.has(t) && rnd() < 0.6) continue; // discourage dupes, allow some
      seen.add(t);
      options.push({ tooth: t });
    }
  } else {
    const pool = shuffle(TOOLS.filter(cardUnlocked));
    options = pool.slice(0, show).map(t => ({ tool: t }));
  }
  G.pack = { product, options, picksLeft: product.picks, taken: [], t: 0, tear: 0, ripped: false, ripT: 0 };
  quest('pack1', 1);
  sfx.sweep();
}
function pickPack(i) {
  const p = G.pack; if (!p || !p.ripped || p.ripT < 0.45) return;
  const o = p.options[i]; if (!o || o.taken) return;
  if (o.tooth) {
    G.deck.push(mkTooth(o.tooth));
  } else {
    if (G.cons.length >= 3) { sfx.error(); float(mx, my - 10, 'CARD SLOTS FULL', C.red, 1); return; }
    G.cons.push(o.tool);
  }
  o.taken = true;
  p.picksLeft--;
  sfx.buy();
  if (p.picksLeft <= 0) G.pack = null;
}

// useCons(i, targetTooth): drag UI passes a tooth index for targeted cards.
function useCons(i, targetTooth) {
  const def = G.cons[i]; if (!def) return;
  if (def.picks) { openBench(i); return; } // dentist tools go to the bench
  if (G.mode === 'extract' && def.id !== 'extract') { G.mode = 'idle'; G.extractCons = -1; }
  const inPlay = G.state === 'play';
  if (def.need === 'bite' && !inPlay) { sfx.error(); float(mx, my - 10, 'USE DURING A BITE', C.red, 1); return; }
  if (def.need === 'round' && !inPlay) { sfx.error(); float(mx, my - 10, 'USE DURING A ROUND', C.red, 1); return; }
  switch (def.id) {
    case 'panorama': {
      let found = 0;
      G.mouth.forEach(s => { if (s.snap && !s.gone) { s.revealed = 'snap'; found++; } });
      float(W / 2 + 50, 96, found + ' SNAPPER' + (found === 1 ? '' : 'S') + ' REVEALED', C.blue, 1, 1.4);
      sfx.xray(); break;
    }
    case 'novocaine': G.novocaine = true; float(mx, my - 10, 'NUMBED UP', C.green, 1); sfx.defuse(); break;
    case 'extract':
      if (targetTooth !== undefined && targetTooth >= 0) {
        const s = G.mouth[targetTooth];
        if (!s || s.pressed || s.gone) { sfx.error(); float(mx, my - 10, 'PICK A STANDING TOOTH', C.red, 1); return; }
        G.extractCons = i;
        doExtract(targetTooth);
        return; // doExtract consumed the card
      }
      if (G.mode === 'extract' && G.extractCons === i) { G.mode = 'idle'; G.extractCons = -1; return; }
      G.mode = 'extract'; G.extractCons = i; sfx.xray();
      return; // consumed on use
    case 'fluoride': G.pool.teeth += 25; float(60, 120, '+25 TEETH', C.blue, 1); sfx.defuse(); break;
    case 'shot': G.bites++; float(60, 160, '+1 BITE', C.green, 1); sfx.defuse(); break;
    case 'mudbath': {
      newMouth();
      float(W / 2 + 50, 96, 'FRESH MOUTH!', '#8a6238', 1, 1.2);
      addRipple(240, 252, true);
      sfx.splash(); break;
    }
    case 'fairydust': {
      G.pool.teeth *= 2;
      float(60, 120, 'TEETH DOUBLED!', C.gold, 1, 1.3);
      burst(W / 2 + 50, 130, C.gold, 14, 70);
      sfx.sweep(); break;
    }
    case 'loupe': {
      const unknown = shuffle(G.mouth.map((s, k) => ({ s, k })).filter(o => !o.s.pressed && !o.s.gone && !o.s.revealed));
      unknown.slice(0, 3).forEach(o => { o.s.revealed = o.s.snap ? 'snap' : 'safe'; });
      float(W / 2 + 50, 96, Math.min(3, unknown.length) + ' TEETH SCANNED', C.blue, 1, 1.3);
      sfx.xray(); break;
    }
    case 'snack': {
      const snaps = G.mouth.filter(s => s.snap && !s.pressed && !s.gone);
      if (!snaps.length) { sfx.error(); float(mx, my - 10, 'NO SNAPPERS LEFT', C.red, 1); return; }
      const s = choice(snaps);
      s.gone = true; s.revealed = 'snap';
      float(W / 2 + 50, 96, 'THE GATOR IS FED. -1 SNAPPER', C.green, 1, 1.4);
      sfx.defuse();
      quest('defuse2', 1);
      checkSweep(); break;
    }
    case 'compass': {
      const topN = Math.ceil(G.mouth.length / 2);
      let n2 = 0;
      G.mouth.slice(0, topN).forEach(s => {
        if (!s.pressed && !s.gone && !s.revealed) { s.revealed = s.snap ? 'snap' : 'safe'; n2++; }
      });
      float(W / 2 + 50, 96, 'TOP ROW SCANNED (' + n2 + ')', C.blue, 1, 1.3);
      sfx.xray(); break;
    }
    case 'firecracker': {
      let found = 0;
      G.mouth.forEach(s => { if (s.snap && !s.gone && !s.pressed) { s.revealed = 'snap'; found++; } });
      const snaps = G.mouth.filter(s => s.snap && !s.pressed && !s.gone);
      if (snaps.length) {
        const s = choice(snaps);
        s.gone = true;
        quest('defuse2', 1);
      }
      float(W / 2 + 50, 96, 'BANG! ' + found + ' REVEALED, 1 DEFUSED', C.orange, 1, 1.5);
      burst(W / 2 + 50, 130, C.orange, 16, 90);
      shake = 4;
      sfx.snap();
      checkSweep(); break;
    }
    case 'goldmolar': G.deck.push(mkTooth('gold')); float(mx, my - 10, 'GOLD TOOTH ADDED', C.gold, 1); sfx.coin(); break;
    case 'ambermolar': G.deck.push(mkTooth('amber')); float(mx, my - 10, 'AMBER TOOTH ADDED', '#e8b45a', 1); sfx.coin(); break;
    case 'rubymolar': G.deck.push(mkTooth('ruby')); float(mx, my - 10, 'RUBY TOOTH ADDED', C.red, 1); sfx.coin(); break;
    case 'polish': {
      const plains = G.deck.filter(t => t.type === 'plain');
      shuffle(plains).slice(0, 3).forEach(t => t.base += 2);
      float(mx, my - 10, '3 TEETH POLISHED +2', C.blue, 1); sfx.buy(); break;
    }
    case 'roottonic': {
      G.deck.forEach(t => { if (t.type === 'plain') t.base += 1; });
      float(mx, my - 10, 'ALL PLAIN TEETH +1', C.green, 1, 1.3); sfx.buy(); break;
    }
    case 'swampbrew': gainMoney(3); float(mx, my - 10, '+$3', C.gold, 1); sfx.coin(); break;
    case 'cavity': {
      const plains = G.deck.filter(t => t.type === 'plain').sort((a, b) => a.base - b.base);
      if (G.deck.length <= 8 || plains.length < 2) { sfx.error(); float(mx, my - 10, 'NOT ENOUGH TEETH', C.red, 1); return; }
      for (let k = 0; k < 2; k++) {
        const idx = G.deck.indexOf(plains[k]);
        if (idx >= 0) G.deck.splice(idx, 1);
      }
      G.drawPile = G.drawPile.filter(t => G.deck.includes(t));
      float(mx, my - 10, '2 WEAK TEETH REMOVED', C.purple, 1); sfx.buy(); break;
    }
  }
  G.cons.splice(i, 1);
}

function toggleXrayMode() {
  if (G.state !== 'play' || G.seq) return;
  if (G.mode === 'xray') { G.mode = 'idle'; return; }
  if (G.xrays <= 0) { sfx.error(); float(310, 232, 'NO X-RAYS LEFT', C.red, 1); return; }
  if (xraysBlocked()) { sfx.error(); float(310, 232, 'X-RAYS BLOCKED!', C.red, 1); return; }
  G.mode = 'xray'; G.extractCons = -1;
  sfx.xray();
}

// ------------------------------------------------------------ layout ------
const SIDEBAR = { x: 2, y: 2, w: 110, h: 266 };
function mouthLayout() {
  // the lil gator has a smaller, re-centered mouth (body geometry follows the maw)
  const maw = lilGator() ? { x: 204, y: 122, w: 188, h: 82 } : { x: 186, y: 112, w: 216, h: 92 };
  // MEGA / DWARF mutations scale the whole maw about its center; body follows
  const m = mutSizeMul();
  if (m !== 1) {
    const ccx = maw.x + maw.w / 2, ccy = maw.y + maw.h / 2;
    maw.w = Math.round(maw.w * m); maw.h = Math.round(maw.h * m);
    maw.x = Math.round(ccx - maw.w / 2); maw.y = Math.round(ccy - maw.h / 2);
  }
  const n = G.mouth.length;
  const topN = Math.ceil(n / 2), botN = n - topN;
  const slots = [];
  const jawDrop = G.jawClose * (maw.h - 26);
  const mk = (count, up, rowY) => {
    const tw = Math.min(24, Math.floor((maw.w - 16) / Math.max(1, count)) - 3);
    const th = 26;
    const total = count * (tw + 3) - 3;
    let x0 = maw.x + (maw.w - total) / 2;
    for (let k = 0; k < count; k++) {
      slots.push({ x: x0 + k * (tw + 3), y: rowY, w: tw, h: th, up });
    }
  };
  mk(topN, false, maw.y + 2 + jawDrop);
  mk(botN, true, maw.y + maw.h - 28);
  return { maw, slots, jawDrop };
}
function toothAt(px, py) {
  const L = mouthLayout();
  for (let i = 0; i < L.slots.length; i++) {
    const sl = L.slots[i], s = G.mouth[i];
    if (!s || s.pressed || s.gone) continue;
    if (px >= sl.x - 1 && px < sl.x + sl.w + 1 && py >= sl.y - 2 && py < sl.y + sl.h + 2) return i;
  }
  return -1;
}

// ------------------------------------------------------------ input -------
let mx = -40, my = -40, mouseSeen = false, hits = [], hotId = null;
let down = null;        // {x, y, hit} potential click/drag origin
let handPressT = 0;
function hit(x, y, w, h, o) { o.x = x; o.y = y; o.w = w; o.h = h; hits.push(o); }
function topHitAt(px, py) {
  // fat-finger forgiveness: on touch devices small targets grow a soft border
  const pad = IS_TOUCH ? 3 : 0;
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i];
    const p = pad && (h.w < 40 || h.h < 20) ? pad : 0;
    if (px >= h.x - p && px < h.x + h.w + p && py >= h.y - p && py < h.y + h.h + p) return h;
  }
  return null;
}
function pointFromEvent(e) {
  const r = canvas.getBoundingClientRect();
  const cx = (e.touches ? e.touches[0].clientX : e.clientX);
  const cy = (e.touches ? e.touches[0].clientY : e.clientY);
  if (LAYOUT.rot) {
    // canvas is rotated 90deg (clockwise) about its centre — undo the rotation
    // so screen touches map back to game pixels. Centre is rotation-invariant.
    const mxc = r.left + r.width / 2, myc = r.top + r.height / 2;
    return { x: W / 2 + (cy - myc) / LAYOUT.s, y: H / 2 - (cx - mxc) / LAYOUT.s };
  }
  return { x: (cx - r.left) / r.width * W, y: (cy - r.top) / r.height * H };
}
function onDown() {
  if (trans) return; // no input during screen transitions
  handPressT = 0.16;
  scareFireflies(mx, my, 60);
  if (my > WATERY + 8) addRipple(mx, my, false);
  const h = topHitAt(mx, my);
  if (h && (h.dragKind !== undefined || h.click) && !h.disabled) {
    down = { x: mx, y: my, hit: h }; // resolved on mouseup: click or drag
    return;
  }
  if (h && h.cb && !h.disabled) {
    fxRing(mx, my, '#ffffff', 2, 13, 0.24);           // a cartoon tap ripple on every press
    fxStars(mx, my, '#ffe8a0', 3, 46);
    h.cb();
  } else if (h && h.disabled) {
    fxRing(mx, my, '#ff6a6a', 2, 9, 0.2);             // a small refusal blip
  }
  hits.length = 0; // one action per rendered frame: stale rects must not double-fire
  down = null;
}
function onUp() {
  if (G.drag) { resolveDrop(); G.drag = null; down = null; return; }
  if (down && down.hit && down.hit.click && !down.hit.disabled) {
    if (down.hit.id !== 'packtear') { fxRing(mx, my, '#ffffff', 2, 13, 0.24); fxStars(mx, my, '#ffe8a0', 3, 46); }
    down.hit.click();
    hits.length = 0;
  }
  down = null;
}
canvas.addEventListener('mousemove', e => { const p = pointFromEvent(e); mx = p.x; my = p.y; mouseSeen = true; maybeStartDrag(); });
canvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  audio();
  const p = pointFromEvent(e); mx = p.x; my = p.y; mouseSeen = true;
  onDown();
});
addEventListener('mouseup', e => { if (e.button !== 0) return; onUp(); });
canvas.addEventListener('touchstart', e => {
  audio();
  const p = pointFromEvent(e); mx = p.x; my = p.y; mouseSeen = true;
  onDown();
  e.preventDefault();
}, { passive: false });
canvas.addEventListener('touchmove', e => { const p = pointFromEvent(e); mx = p.x; my = p.y; maybeStartDrag(); e.preventDefault(); }, { passive: false });
addEventListener('touchend', () => onUp());
canvas.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('keydown', e => {
  if (e.key === 'm' || e.key === 'M') muted = !muted;
  if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') togglePause();
});

function maybeStartDrag() {
  if (G.drag || !down || down.hit.dragKind === undefined) return;
  if (Math.hypot(mx - down.x, my - down.y) > 5) {
    G.drag = { kind: down.hit.dragKind, idx: down.hit.dragIdx, x: mx, y: my, px: mx, py: my };
    sfx.pickup();
  }
}

function resolveDrop() {
  const d = G.drag; if (!d) return;
  sfx.drop();
  if (d.kind === 'charm') {
    // sell barrel (shop only)
    if (G.state === 'shop' && mx >= BARREL.x - 6 && mx < BARREL.x + BARREL.w + 6 && my >= BARREL.y - 8 && my < BARREL.y + BARREL.h + 8) {
      sellCharm(d.idx);
      burst(BARREL.x + BARREL.w / 2, BARREL.y + 8, C.gold, 10, 70);
      return;
    }
    sfx.thunk();
    return;
  }
  if (d.kind === 'cons') {
    const def = G.cons[d.idx]; if (!def) return;
    if (def.picks) { openBench(d.idx); return; } // tools open the dentist bench
    const L = mouthLayout();
    const overMouth = mx > L.maw.x - 30 && mx < L.maw.x + L.maw.w + 30 && my > L.maw.y - 70 && my < L.maw.y + L.maw.h + 50;
    if (def.target === 'tooth') {
      const ti = toothAt(mx, my);
      if (ti >= 0 && G.state === 'play') { useCons(d.idx, ti); return; }
      sfx.thunk(); float(mx, my - 10, 'DROP IT ON A TOOTH', C.dim, 1);
      return;
    }
    if (def.need === 'bite' || def.need === 'round') {
      if (G.state === 'play' && overMouth) { useCons(d.idx); return; }
      sfx.thunk();
      if (G.state === 'play') float(mx, my - 10, 'DROP IT ON THE GATOR', C.dim, 1);
      else float(mx, my - 10, 'USE DURING A ROUND', C.red, 1);
      return;
    }
    // global cards: drop anywhere outside the card row
    if (my > 58) { useCons(d.idx); return; }
    sfx.thunk();
  }
}

// ------------------------------------------------------------ gator -------
// a cached shading overlay for the croc's jaws: dithered falloff toward the
// base, dark rolled-off sides, a lit rim along the top and a pitted hide grain
function crocShade(part, w, h, st) {
  return getCached('crocShade' + part + w + st.a + st.b + st.c, w, h, () => {
    const up = part === 'up';
    for (let y = 0; y < h; y++) {
      const f = y / h;
      const step = up ? (f > 0.78 ? 2 : f > 0.55 ? 3 : f > 0.38 ? 5 : 0) : (f > 0.7 ? 2 : f > 0.45 ? 3 : 0);
      if (step) for (let x = (y & 1); x < w; x += step) rect(x, y, 1, 1, st.b);
    }
    for (let x = 0; x < 14; x++) {
      const gap = x < 5 ? 2 : x < 10 ? 3 : 4;
      for (let y = 4 + (x & 1); y < h - 4; y += gap) { rect(x + 1, y, 1, 1, st.d); rect(w - 2 - x, y, 1, 1, st.d); }
    }
    if (up) { for (let x = 8; x < w - 8; x++) if (x % 3) rect(x, 2, 1, 1, mixC(st.c, '#ffffff', 0.35)); }
    for (let k = 0; k < w * h / 40; k++) { const gx = Math.floor(hash2(k, 31) * w), gy = Math.floor(hash2(k, 32) * h); rect(gx, gy, 1, 1, k & 1 ? st.d : mixC(st.c, '#ffffff', 0.2)); }
  });
}
function drawCroc(closeT, opts) {
  opts = opts || {};
  const st = crocStyle();
  const L = mouthLayout();
  const maw = L.maw;
  const bodyX = maw.x - 22, bodyW = maw.w + 44;
  const jawDrop = closeT * (maw.h - 26);
  const MD = (opts.mood && CROC_MOODS[opts.mood]) || crocMood(opts.dt);
  const quiver = MD.quiver ? Math.sin(tNow * 13) * 0.7 : 0;
  const breathe = (G.state === 'play' || G.state === 'menu') ? Math.sin(tNow * 1.6) * 1.4 + quiver : 0;
  const mawC = st.maw, mawD = st.mawD;

  // --- tail curling out of the water behind the body ---
  const tailX = bodyX + bodyW - 8, tailSway = Math.sin(tNow * 0.9) * 2;
  rr(tailX, 232, 34, 16, 4, st.b);
  rr(tailX + 26, 222 + tailSway, 22, 16, 4, st.b);
  rr(tailX + 42, 212 + tailSway * 2, 14, 14, 4, st.b);
  rr(tailX + 50, 206 + tailSway * 2, 8, 8, 3, st.a);
  // tail ridge spikes
  [[tailX + 6, 228], [tailX + 20, 226], [tailX + 32, 218 + tailSway], [tailX + 45, 208 + tailSway * 2]].forEach(([sx, sy]) => {
    rect(sx, sy, 4, 4, st.a); rect(sx + 1, sy - 2, 2, 2, st.a);
  });

  // --- front feet with claws at the waterline ---
  [[bodyX - 12, 0], [bodyX + bodyW - 12, 0]].forEach(([fx]) => {
    rr(fx, 240, 24, 12, 3, st.b);
    rr(fx + 2, 242, 20, 8, 3, st.a);
    rect(fx + 3, 250, 4, 3, '#f4f0dc'); rect(fx + 10, 250, 4, 3, '#f4f0dc'); rect(fx + 17, 250, 4, 3, '#f4f0dc');
  });
  // water laps against the hide
  ctx.save(); ctx.globalAlpha = opts.dry ? 0 : 0.45;
  for (let x = bodyX - 18; x < bodyX + bodyW + 18; x += 9) {
    rect(x, 245 + Math.sin(tNow * 2.1 + x * 0.31) * 1.5, 5, 1, '#7fb8c8');
  }
  ctx.restore();

  // --- lower jaw base (behind maw) ---
  rr(bodyX, maw.y + maw.h - 6, bodyW, 40, 4, st.d);
  rr(bodyX + 1, maw.y + maw.h - 6, bodyW - 2, 38, 4, st.b);
  rr(bodyX + 3, maw.y + maw.h + 8, bodyW - 6, 26, 4, st.a);
  ctx.drawImage(crocShade('lo', bodyW, 40, st), bodyX, maw.y + maw.h - 6, bodyW, 40);
  // belly plate bands on the chin, with scutes and pond light playing over them
  ctx.save(); ctx.globalAlpha = 0.42;
  for (let ry = 0; ry < 5; ry++) {
    const sy3 = maw.y + maw.h + 8 + ry * 7, off = (ry % 2) * 5;
    for (let sx3 = bodyX + 10 + off; sx3 < bodyX + bodyW - 10; sx3 += 10) {
      rect(sx3, sy3, 5, 3, st.d); rect(sx3, sy3 - 1, 5, 1, st.c); rect(sx3 + 1, sy3 + 1, 3, 1, st.b);
    }
  }
  ctx.restore();
  for (let k = 0; k < 3; k++) rect(bodyX + 16, maw.y + maw.h + 14 + k * 7, bodyW - 32, 1, st.b);
  ctx.save(); ctx.globalAlpha = 0.18;
  for (let k = 0; k < 16; k++) {
    const cx3 = bodyX + ((k * 53) % (bodyW - 12));
    const cy3 = maw.y + maw.h + 6 + ((k * 19) % 28);
    const wob = Math.sin(tNow * 1.9 + k * 0.7) * 3;
    rect(cx3 + wob, cy3, 8, 1, '#bfe8ff'); rect(cx3 + 2 + wob, cy3 + 1, 4, 1, '#eafcff');
    rect(cx3 - 2 + wob * 0.6, cy3 + 3, 5, 1, '#9fd8f0');
  }
  ctx.restore();
  if (st.skinny) { rect(bodyX + 14, maw.y + maw.h + 14, 3, 14, st.b); rect(bodyX + bodyW - 17, maw.y + maw.h + 14, 3, 14, st.b); }

  // --- maw interior ---
  rr(maw.x - 6, maw.y - 4, maw.w + 12, maw.h + 10, 4, mawD);
  rr(maw.x - 3, maw.y - 1, maw.w + 6, maw.h + 4, 4, mawC);
  // palate ribs arching across the roof of the mouth
  ctx.save(); ctx.globalAlpha = 0.34;
  for (let k = 0; k < 6; k++) {
    const ry2 = maw.y + 4 + k * 4, inset = k * 3;
    rect(maw.x + 6 + inset, ry2, maw.w - 12 - inset * 2, 1, mawD);
  }
  ctx.globalAlpha = 0.14;
  for (let k = 0; k < 30; k++) rect(maw.x + 8 + (k * 37) % (maw.w - 16), maw.y + 6 + (k * 13) % 22, 1, 1, '#ffd8e4');
  ctx.restore();
  // throat shadow receding into the dark
  ctx.save(); ctx.globalAlpha = 0.5;
  rr(maw.x + maw.w / 2 - 34, maw.y + maw.h / 2 - 16, 68, 30, 10, '#2a0a14');
  ctx.globalAlpha = 0.35; rr(maw.x + maw.w / 2 - 24, maw.y + maw.h / 2 - 10, 48, 20, 8, '#170208');
  ctx.restore();
  // gum ridges the teeth grow out of
  ctx.save(); ctx.globalAlpha = 0.55;
  rect(maw.x - 2, maw.y + 1, maw.w + 4, 4, st.paleMaw ? '#e8a8b4' : '#b8536a');
  rect(maw.x - 2, maw.y + maw.h - 5, maw.w + 4, 4, st.paleMaw ? '#d89aa6' : '#9c4258');
  for (let k = 0; k * 15 < maw.w; k++) {
    rect(maw.x + 4 + k * 15, maw.y + 1, 7, 2, st.paleMaw ? '#f4c8d0' : '#d0708a');
    rect(maw.x + 10 + k * 15, maw.y + maw.h - 3, 7, 2, st.paleMaw ? '#c88898' : '#7d2d42');
  }
  ctx.restore();
  const tlick = MD.pupil > 1.2 ? Math.sin(tNow * 2.2) * 4 : Math.sin(tNow * 0.9) * 1.5;
  rr(maw.x + 30, maw.y + maw.h - 34 + tlick * 0.4, maw.w - 60, 28, 4, st.tongue);
  rr(maw.x + 40, maw.y + maw.h - 32 + tlick * 0.4, maw.w - 80, 10, 3, st.tongueHi);
  ctx.save(); ctx.globalAlpha = 0.25;
  rect(maw.x + 46, maw.y + maw.h - 30 + tlick * 0.4, Math.round(maw.w * 0.2), 3, '#ffd8e4');
  ctx.restore();
  rect(maw.x + maw.w / 2 - 1, maw.y + maw.h - 30, 2, 22, st.paleMaw ? '#c88898' : '#a83a4e');

  // --- teeth ---
  L.slots.forEach((sl, i) => {
    const s = G.mouth[i]; if (!s) return;
    if (s.gone) {
      rr(sl.x + 2, sl.up ? sl.y + sl.h - 8 : sl.y, sl.w - 4, 6, 2, '#00000055');
      return;
    }
    const dragTarget = G.drag && G.drag.kind === 'cons' && G.cons[G.drag.idx] && G.cons[G.drag.idx].target === 'tooth';
    const hov = G.state === 'play' && mx >= sl.x && mx < sl.x + sl.w && my >= sl.y && my < sl.y + sl.h && !s.pressed;
    let ty = sl.y, th = sl.h;
    if (s.pressed) {
      th = Math.floor(sl.h * 0.55);
      if (!sl.up) ty = sl.y; else ty = sl.y + (sl.h - th);
    } else if (hov) {
      ty += sl.up ? -2 : 2;
    }
    if (s.pop > 0) { ty += sl.up ? 2 : -2; }
    const snappingThis = (G.state === 'snap' && G.snapIdx === i);
    const scanning = G.xanim && G.xanim.i === i && G.xanim.t < 0.5;
    let outline = '#00000055';
    if (hov) outline = dragTarget ? C.green : C.gold;
    if (s.revealed === 'snap' && !s.pressed) outline = C.red;
    if (snappingThis) outline = (Math.floor(tNow * 14) % 2) ? C.red : C.white;
    drawTooth(sl.x, ty, sl.w, th, sl.up, s.t.type, {
      pressedTint: s.pressed, outline,
      xray: scanning, xraySnap: scanning && xrayShowsSnap(i), xrayT: scanning ? G.xanim.t : 0,
    });
    if (!s.pressed && !scanning && G.state !== 'menu') {
      const hideVal = bossIs('cotton');
      const vs = hideVal ? '?' : '' + s.t.base;
      const vy = sl.up ? ty + th - 7 : ty + 2;
      if (hideVal) drawTextCSh(vs, sl.x + sl.w / 2 + 1, vy, C.white, 1, '#4a1060');
      else drawTextC(vs, sl.x + sl.w / 2, vy, '#6d5c3a', 1);
    }
    if (s.revealed === 'safe' && !s.pressed && !scanning) {
      rr(sl.x + sl.w - 7, sl.up ? sl.y - 5 : sl.y + sl.h - 1, 7, 7, 2, C.greenD);
      drawText('+', sl.x + sl.w - 6, (sl.up ? sl.y - 4 : sl.y + sl.h), C.white, 1);
    }
    if (s.revealed === 'snap' && !s.pressed && !s.gone && !scanning) {
      rr(sl.x + sl.w - 7, sl.up ? sl.y - 5 : sl.y + sl.h - 1, 7, 7, 2, C.redD);
      drawText('!', sl.x + sl.w - 5, (sl.up ? sl.y - 4 : sl.y + sl.h), C.white, 1);
    }
    if (bossIs('diet') && s.t.type !== 'plain' && !s.pressed) {
      rect(sl.x + 1, sl.up ? sl.y + 2 : sl.y + sl.h - 4, 4, 4, C.redD);
      drawText('X', sl.x + 1, sl.up ? sl.y + 2 : sl.y + sl.h - 4, C.white, 1);
    }
    if (G.state === 'play' && !s.pressed) {
      hit(sl.x, sl.y - 2, sl.w, sl.h + 4, {
        cb: () => pressTooth(i),
        id: 'tooth' + i,
        cursor: true,
        tip: toothTip(s),
      });
    }
  });

  // --- lower lip over teeth roots ---
  rr(bodyX, maw.y + maw.h - 2, bodyW, 10, 3, st.b);
  rect(bodyX + 2, maw.y + maw.h - 2, bodyW - 4, 3, st.d);

  // --- upper jaw (snout) ---
  const jy = maw.y - 58 + jawDrop + breathe + Math.round(MD.brow * -0.6);
  rr(bodyX - 4, jy, bodyW + 8, 62, 4, st.d);
  rr(bodyX - 3, jy + 1, bodyW + 6, 60, 4, st.b);
  rr(bodyX - 1, jy + 3, bodyW + 2, 52, 4, st.a);
  rr(bodyX + 6, jy + 5, bodyW - 12, 10, 3, st.c);
  ctx.drawImage(crocShade('up', bodyW + 8, 62, st), bodyX - 4, jy, bodyW + 8, 62);
  for (let k = 0; k < 7; k++) {
    rect(bodyX + 14 + k * 36, jy + 22 + (k % 2) * 8, 3, 3, st.b);
  }
  // osteoderm scute ridges along the snout
  for (let k = 0; k < 6; k++) {
    const sx2 = bodyX + 20 + k * Math.floor((bodyW - 44) / 5);
    rect(sx2, jy + 17, 6, 3, st.b); rect(sx2 + 1, jy + 15, 4, 2, st.c);
    rect(sx2 + 15, jy + 36, 5, 3, st.b);
  }
  // hide speckles
  ctx.save(); ctx.globalAlpha = 0.35;
  for (let k = 0; k < 9; k++) rect(bodyX + 12 + (k * 47) % (bodyW - 24), jy + 26 + (k * 31) % 22, 2, 2, st.d);
  ctx.restore();
  // ---- fine scale texture: a staggered micro-grid of scutes on the snout ----
  ctx.save(); ctx.globalAlpha = 0.32;
  for (let ry = 0; ry < 7; ry++) {
    const sy2 = jy + 8 + ry * 7, off = (ry % 2) * 5;
    for (let sx2 = bodyX + 8 + off; sx2 < bodyX + bodyW - 8; sx2 += 10) {
      rect(sx2, sy2, 5, 3, st.d);          // scute plate
      rect(sx2, sy2 - 1, 5, 1, st.c);      // lit top edge
      rect(sx2 + 1, sy2 + 1, 3, 1, st.b);  // inner shadow
    }
  }
  ctx.restore();
  // pitted skin grain between the plates
  ctx.save(); ctx.globalAlpha = 0.5;
  for (let k = 0; k < 70; k++) {
    const gx = bodyX + 4 + Math.floor(hash2(k, 7) * (bodyW - 8)), gy = jy + 6 + Math.floor(hash2(k, 11) * 46);
    rect(gx, gy, 1, 1, k & 1 ? st.b : st.c);
  }
  ctx.restore();
  // ---- nostrils flaring on the snout tip ----
  (function nostrils() {
    const flare = Math.round(Math.max(0, Math.sin(tNow * 1.6)) * 1.5);
    const nx = bodyX + bodyW / 2;
    [-1, 1].forEach(sd => {
      const px2 = nx + sd * 15 - 5;
      rr(px2 - 1, jy + 3, 12, 9, 4, st.c);          // raised nostril boss
      rr(px2, jy + 4, 10, 7, 3, st.a);
      rect(px2 + 1, jy + 4, 8, 1, mixHex(st.c, '#ffffff', 0.3));
      rr(px2 + 2, jy + 6 - flare, 6, 4 + flare * 2, 2, '#160b06');
      rect(px2 + 3, jy + 6 - flare, 3, 1, '#3a2418');
    });
  })();
  // ---- jowl volume: the sides of the skull roll away from the light ----
  ctx.save(); ctx.globalAlpha = 0.3;
  rect(bodyX - 3, jy + 12, 8, 44, st.d); rect(bodyX + bodyW - 5, jy + 12, 8, 44, st.d);
  ctx.globalAlpha = 0.18; rect(bodyX + 3, jy + 16, 5, 38, st.d); rect(bodyX + bodyW - 8, jy + 16, 5, 38, st.d);
  ctx.restore();
  // ---- neck folds behind the jaw hinge ----
  ctx.save(); ctx.globalAlpha = 0.4;
  for (let k = 0; k < 3; k++) {
    rect(bodyX - 2, maw.y + maw.h + 12 + k * 7, 20, 2, st.d);
    rect(bodyX + bodyW - 18, maw.y + maw.h + 12 + k * 7, 20, 2, st.d);
    rect(bodyX - 2, maw.y + maw.h + 11 + k * 7, 20, 1, st.c);
    rect(bodyX + bodyW - 18, maw.y + maw.h + 11 + k * 7, 20, 1, st.c);
  }
  ctx.restore();
  // ---- rim light along the top of the skull ----
  ctx.save(); ctx.globalAlpha = 0.3;
  rect(bodyX + 4, jy + 1, bodyW - 8, 1, '#eafcff');
  rect(bodyX - 2, jy + 6, 3, 34, '#eafcff'); rect(bodyX + bodyW - 1, jy + 6, 3, 34, '#eafcff');
  ctx.restore();
  // wet sheen sweeping the hide, broken into dithered pixels
  const shx = Math.round(bodyX + ((tNow * 22) % (bodyW + 60)) - 30);
  ctx.save(); ctx.globalAlpha = 0.14;
  for (let k = 0; k < 50; k += 2) { rect(shx + (k & 2), jy + 4 + k, 2, 1, '#eafcff'); rect(shx + 8, jy + 5 + k, 1, 1, '#eafcff'); }
  ctx.restore();
  // ---- drool strings + drips hanging off the upper lip ----
  if (G.state === 'play') {
    ctx.save(); ctx.globalAlpha = 0.72;
    [0.18, 0.5, 0.84].forEach((f, i) => {
      const dx2 = (maw.x + maw.w * f) | 0;
      const len = 3 + ((Math.sin(tNow * 0.9 + i * 2.1) + 1) * 2.5);
      rect(dx2, maw.y + jawDrop + 2, 2, len, '#bfe4f2');
      rect(dx2, maw.y + jawDrop + 2, 1, len, '#eafcff');
      rr(dx2 - 1, maw.y + jawDrop + 1 + len, 4, 4, 2, '#dff2fa');   // hanging bead
      const dp = (tNow * 0.55 + i * 0.4) % 1;                        // one drips free
      ctx.save(); ctx.globalAlpha = 0.5 * (1 - dp);
      rr(dx2 - 1, maw.y + jawDrop + 6 + len + dp * 20, 2, 3, 1, '#dff2fa');
      ctx.restore();
    });
    ctx.restore();
  }
  if (st.ridge) { rect(bodyX + 10, jy + 3, bodyW - 20, 2, st.b); rect(bodyX + 30, jy + 6, bodyW - 60, 1, st.b); }
  if (st.scars) {
    [[bodyX + 30, jy + 18], [bodyX + bodyW - 60, jy + 26]].forEach(([sx, sy]) => {
      rect(sx, sy, 10, 2, st.c); rect(sx + 2, sy - 3, 2, 8, st.c); rect(sx + 6, sy - 3, 2, 8, st.c);
    });
  }
  if (st.moss) {
    [[bodyX + 20, jy + 12], [bodyX + bodyW - 50, jy + 8], [bodyX + 90, jy + 30]].forEach(([sx, sy]) => {
      rr(sx, sy, 14, 4, 2, '#2c5a24'); rect(sx + 3, sy + 4, 3, 3, '#2c5a24');
    });
  }
  if (st.algae) {
    [[bodyX + 24, jy + 40], [bodyX + 90, jy + 46], [bodyX + bodyW - 44, jy + 38]].forEach(([sx, sy], k) => {
      rect(sx, sy, 2, 10 + k * 3, '#4a6a2a'); rect(sx + 4, sy + 4, 2, 7, '#4a6a2a');
    });
  }
  if (st.mudDrips) {
    [[bodyX + 30, jy + 34], [bodyX + 84, jy + 42], [bodyX + 150, jy + 30], [bodyX + bodyW - 52, jy + 40]].forEach(([sx, sy], k) => {
      rr(sx, sy, 10, 6, 2, '#5a4020');
      rect(sx + 3, sy + 6, 2, 6 + ((tNow * 3 + k) % 3 | 0), '#5a4020');
    });
  }
  if (st.shell) {
    // turtle shell dome perched on the head
    const shx = maw.x + maw.w / 2 - 42, shy = jy - 22;
    rr(shx, shy, 84, 24, 4, '#4a5a2e');
    rr(shx + 4, shy + 3, 76, 18, 4, '#5c7038');
    for (let k = 0; k < 3; k++) rect(shx + 14 + k * 22, shy + 6, 12, 10, '#4a5a2e');
    rect(shx + 2, shy + 20, 80, 3, '#38441e');
  }
  // nostrils
  rr(maw.x + maw.w / 2 - 34, jy + 8, 12, 8, 2, st.b);
  rr(maw.x + maw.w / 2 + 22, jy + 8, 12, 8, 2, st.b);
  rect(maw.x + maw.w / 2 - 31, jy + 11, 4, 3, st.d);
  rect(maw.x + maw.w / 2 + 27, jy + 11, 4, 3, st.d);
  // metal snout plate (iron jaw)
  if (st.metal) {
    rr(maw.x + maw.w / 2 - 50, jy + 20, 100, 22, 3, '#8a949c');
    rr(maw.x + maw.w / 2 - 48, jy + 22, 96, 18, 3, '#aab4bc');
    [[-42, 24], [38, 24], [-42, 34], [38, 34]].forEach(([ox, oy]) => rect(maw.x + maw.w / 2 + ox, jy + oy, 2, 2, '#5a646c'));
    rect(maw.x + maw.w / 2 - 40, jy + 24, 30, 2, '#d8e2e8');
  }
  // jaw brace (lockjaw)
  if (st.brace) {
    rect(bodyX + 20, jy + 6, 8, 52, '#8a949c');
    rect(bodyX + bodyW - 28, jy + 6, 8, 52, '#8a949c');
    rect(bodyX + 22, jy + 10, 4, 44, '#aab4bc');
    rect(bodyX + bodyW - 26, jy + 10, 4, 44, '#aab4bc');
    [[24, 12], [24, 46], [bodyW - 24, 12], [bodyW - 24, 46]].forEach(([ox, oy]) => rect(bodyX + ox, jy + oy, 2, 2, '#404a52'));
  }
  // bandage (tender gums)
  if (st.bandage) {
    rect(maw.x + maw.w / 2 - 20, jy + 24, 40, 10, '#f0ece0');
    rect(maw.x + maw.w / 2 - 20, jy + 28, 40, 2, '#d0ccc0');
    rect(maw.x + maw.w / 2 - 4, jy + 20, 8, 18, '#f0ece0');
  }
  // upper lip edge + gum line holding the top teeth
  rect(bodyX - 1, jy + 55, bodyW + 2, 3, st.d);
  rr(bodyX - 1, jy + 52, bodyW + 2, 6, 2, st.b);
  rect(maw.x + 2, jy + 58, maw.w - 4, 3, st.paleMaw ? '#d8a8b8' : C.gum);
  // drool drips off the lip when the maw hangs open
  if (jawDrop > 8) {
    ctx.save(); ctx.globalAlpha = 0.6;
    [maw.x + 10, maw.x + maw.w - 14].forEach((dxp, i) => {
      const ph = (tNow * 0.8 + i * 0.45) % 1;
      if (ph < 0.72) rect(dxp, jy + 60 + ph * 30, 2, 3, '#9fd8e0');
    });
    ctx.restore();
  }
  // big corner fangs (two-fang / apex)
  if (st.fangs) {
    const fy = jy + 56;
    [[maw.x - 14, 0], [maw.x + maw.w + 2, 0]].forEach(([fx]) => {
      rect(fx, fy, 10, 8, '#f4f0dc'); rect(fx + 2, fy + 8, 6, 6, '#f4f0dc');
      rect(fx + 4, fy + 14, 3, 4, '#f4f0dc'); rect(fx + 8, fy + 2, 2, 8, '#cfc8a8');
    });
  }
  // gold glint tooth (loan shark) on the lip
  if (st.goldTooth) { rect(maw.x + 20, jy + 54, 8, 6, '#ffd54a'); rect(maw.x + 22, jy + 55, 2, 2, '#fff6c8'); }

  // --- eyes on top: brows, pupils and lids all driven by the mood ---
  const squeeze = false;   // its eyes never shut - the anger lives in the brow ridge
  const exL = maw.x + 18, exR = maw.x + maw.w - 48, ey = jy - 10;
  // a slow saccade: the eyes flick to a new spot every couple of seconds
  const sac = Math.floor(tNow / 1.9);
  const sacX = ((sac * 2654435761) % 100) / 100 - 0.5, sacY = ((sac * 40503) % 100) / 100 - 0.5;
  [exL, exR].forEach((ex, side) => {
    const socket = [st.d, st.b, st.a, st.c, mixHex(st.c || st.a, '#ffffff', 0.4)];
    plasticBox(ex - 4, ey, 30, 20, 5, socket, { noShine: 1 });
    if (squeeze) {
      rect(ex + 2, ey + 8, 18, 3, st.d);
    } else {
      // the opening is always the same size; a LID slides down over it, so the
      // eye can never vanish into the socket the way it used to
      const EO = { x: ex + 3, y: ey + 4, w: 16, h: 12 };
      rr(EO.x, EO.y, EO.w, EO.h, 3, st.redEye ? '#e8b0a0' : st.sclera);
      if (MD.cross) {
        for (let k = 0; k < 7; k++) { rect(EO.x + 2 + k, EO.y + 2 + k, 2, 2, '#1b1408'); rect(EO.x + 8 - k, EO.y + 2 + k, 2, 2, '#1b1408'); }
      } else {
        const dx = clamp((mx - (ex + 11)) / 60, -1, 1) * 3 + sacX * 2;
        const dy = clamp((my - (ey + 10)) / 60, -1, 1) * 2 + sacY * 1.5;
        const pw = Math.max(2, Math.round(4 * MD.pupil)), ph2 = Math.max(4, Math.round(8 * MD.pupil));
        rect(EO.x + 8 - (pw >> 1) + dx, EO.y + 6 - (ph2 >> 1) + dy, pw, ph2, st.redEye ? '#8a1010' : '#1b1408');
        rect(EO.x + 9 - (pw >> 1) + dx, EO.y + 7 - (ph2 >> 1) + dy, 1, 2, '#fff');
      }
      // one lid value from every source, so they can never fight each other
      // the lid only ever droops - the eye never shuts
      const lidAmt = clamp(Math.max((1 - clamp(MD.open, 0, 1)) * 0.5, MD.squint * 0.34, st.sleepy ? 0.36 : 0), 0, 0.4);
      if (lidAmt > 0.02) {
        const lh = Math.round(lidAmt * (EO.h + 2));
        rr(EO.x - 1, EO.y - 1, EO.w + 2, lh, 3, st.a);       // the lid, in hide colour
        rect(EO.x - 1, EO.y - 1 + lh, EO.w + 2, 1, st.d);    // lash line under its edge
      }
      rect(EO.x, EO.y + EO.h - 1, EO.w, 1, st.b);            // lower lid crease
    }
    // brow ridge: angles with the mood, inner end leading
    const bl = side === 0 ? 1 : -1;
    const bw = 26, bh = 3;
    for (let k = 0; k < bw; k++) {
      const f = k / (bw - 1);
      const lift = Math.round((side === 0 ? (1 - f) : f) * MD.brow);
      rect(ex - 2 + k, ey - 2 - lift, 1, bh + Math.max(0, lift), st.d);   // stays welded to the socket
      if (lift > 0) rect(ex - 2 + k, ey - 2 - lift, 1, 1, st.c);
    }
    if (st.bags) { rect(ex + 2, ey + 17, 18, 2, '#3a2a4a'); }
    if (st.teary) { rect(ex + 4, ey + 16, 2, 3, '#7fd4e8'); rect(ex + 5, ey + 19 + ((tNow * 6 | 0) % 3), 1, 2, '#7fd4e8'); }
    // back scutes flanking each eye
    [[ex - 12, ey + 4], [ex + 28, ey + 6]].forEach(([sx, sy]) => {
      rect(sx, sy, 5, 6, st.b); rect(sx + 1, sy - 3, 3, 3, st.b); rect(sx + 2, sy - 5, 1, 2, st.b);
      rect(sx + 1, sy - 3, 1, 1, st.c);
    });
    void bl;
  });
  // a puff of angry breath from the nostrils when it is riled
  if (MD.brow >= 2 && G.state !== 'menu') {
    const nx0 = bodyX + bodyW / 2;
    [-1, 1].forEach(sd => {
      const f = (tNow * 1.4 + (sd > 0 ? 0.5 : 0)) % 1;
      ctx.save(); ctx.globalAlpha = 0.3 * (1 - f);
      fillCircle(nx0 + sd * 15, jy + 12 + f * 12, 2 + f * 5, '#cfe8f0');
      ctx.restore();
    });
  }
  // second, smaller pair of eyes (two-timer)
  if (st.twinEyes) {
    const tx2 = maw.x + maw.w / 2 - 14, ty2 = ey + 6;
    [tx2, tx2 + 18].forEach(ex2 => {
      rr(ex2 - 2, ty2, 14, 10, 3, st.b);
      rr(ex2 - 1, ty2 + 1, 12, 8, 3, st.a);
      rr(ex2 + 1, ty2 + 2, 8, 6, 2, st.sclera);
      const dx = clamp((mx - ex2) / 60, -1, 1) * 2;
      rect(ex2 + 4 + dx, ty2 + 3, 2, 4, '#1b1408');
    });
  }
  // crown (swamp king)
  if (st.crown) {
    const kx = maw.x + maw.w / 2 - 14, ky = ey - 12;
    rect(kx, ky + 6, 28, 6, C.gold);
    rect(kx, ky, 4, 8, C.gold); rect(kx + 8, ky + 2, 4, 6, C.gold);
    rect(kx + 16, ky, 4, 8, C.gold); rect(kx + 24, ky + 2, 4, 6, C.gold);
    rect(kx + 6, ky + 8, 2, 2, C.red); rect(kx + 20, ky + 8, 2, 2, '#3f8cff');
  }
  // top hat (loan shark)
  if (st.hat) {
    const hx = exR - 2, hy = ey - 20;
    rect(hx - 4, hy + 14, 32, 4, '#14181c');
    rect(hx, hy, 24, 15, '#1c2226');
    rect(hx, hy + 10, 24, 3, C.gold);
    rect(hx + 2, hy + 2, 3, 8, '#3a4248');
  }

  // ---- SHARK features (MALDIVES summer stage) ----
  if (st.shark && G.summer) { // belt-and-braces: no fins/gills outside the OCEAN
    // tall back-swept dorsal fin rising from the crown of the head
    const fnx = maw.x + maw.w / 2, fbase = jy - 2;
    for (let k = 0; k < 18; k++) {
      const half = Math.max(1, 9 - Math.floor(k * 0.5));
      rect(fnx - half + Math.floor(k * 0.5), fbase - k * 2, half * 2, 3, k < 3 ? st.a : st.b);
    }
    rect(fnx - 1, fbase - 34, 2, 6, st.c);
    // gill slits on each cheek
    [[maw.x + 4, 1], [maw.x + maw.w - 12, -1]].forEach(([gxs, dir]) => {
      for (let k = 0; k < 4; k++) rect(gxs + dir * k * 3, jy + 30 - k, 2, 13, st.d);
    });
    // pointed snout tip poking forward
    rect(bodyX - 10, jy + 26, 10, 9, st.a); rect(bodyX - 15, jy + 29, 5, 4, st.b);
  }

  // ---- MUTATION signature features (Professor Manta's photo subjects) ----
  if (st.mut === 'diamond') {
    [[bodyX + 40, jy + 20], [bodyX + bodyW - 56, jy + 22], [maw.x + maw.w / 2 - 4, jy + 34]].forEach(([gx, gy]) => {
      rect(gx + 2, gy, 4, 2, '#eafcff'); rect(gx, gy + 2, 8, 2, '#bff4ff'); rect(gx + 2, gy + 4, 4, 2, '#8fd6ea'); rect(gx + 3, gy + 1, 1, 1, '#fff');
    });
    for (let k = 0; k < 7; k++) { if (Math.sin(tNow * 3 + k * 1.7) > 0.45) rect(bodyX + 20 + (k * 53) % (bodyW - 40), jy + 8 + (k * 29) % 42, 1, 1, '#ffffff'); }
  } else if (st.mut === 'extra') {
    const fy = jy + 56;
    [maw.x - 8, maw.x + maw.w + 2, maw.x + 24, maw.x + maw.w - 28].forEach(fx => {
      rect(fx, fy, 5, 7, '#f4f0dc'); rect(fx + 1, fy + 7, 3, 4, '#e8e0c0');
    });
  } else if (st.mut === 'mega') {
    rect(bodyX + 6, jy + 1, bodyW - 12, 4, st.b);            // heavy brow band
    [exL, exR].forEach(ex => rect(ex - 4, ey - 5, 30, 3, st.d)); // scowling ridges
  } else if (st.mut === 'alien') {
    const acx = maw.x + maw.w / 2;
    [-17, 15].forEach(ox => {
      rect(acx + ox, ey - 18, 2, 13, st.c);
      const gl = Math.sin(tNow * 4 + ox) * 0.5 + 0.5;
      ctx.save(); ctx.globalAlpha = 0.35 + gl * 0.4; fillCircle(acx + ox + 1, ey - 20, 5, '#8fff7c'); ctx.restore();
      fillCircle(acx + ox + 1, ey - 20, 3, '#c8ff9c');
    });
    rr(acx - 5, ey + 2, 11, 9, 3, '#0c0c14'); rr(acx - 3, ey + 3, 7, 6, 2, '#9cff8c'); rect(acx - 1, ey + 4, 2, 4, '#0c0c14');
  } else if (st.mut === 'spotted') {
    ctx.save(); ctx.globalAlpha = 0.55;
    for (let k = 0; k < 16; k++) {
      const sx = bodyX + 12 + (k * 61) % (bodyW - 24), sy = jy + 6 + (k * 43) % 44;
      fillCircle(sx, sy, 2 + (k % 2), st.d);
    }
    ctx.restore();
  } else if (st.mut === 'striped') {
    ctx.save(); ctx.globalAlpha = 0.5;
    const n = 7, span = bodyW - 36;
    for (let k = 0; k < n; k++) { const sx = bodyX + 18 + Math.round(k * span / (n - 1)); rect(sx, jy + 2, 4, 52, st.d); rect(sx + 1, jy + 2, 1, 52, '#00000033'); }
    ctx.restore();
  }
}

function toothTip(s) {
  const d = TOOTH_DEFS[s.t.type];
  let lines = d.name + '|';
  if (bossIs('cotton')) lines += 'VALUE: ?';
  else lines += 'VALUE: ' + s.t.base + ' TEETH';
  if (s.t.type !== 'plain') lines += '|' + d.desc + (bossIs('diet') ? '|(DEBUFFED BY BOSS!)' : '');
  if (s.revealed === 'safe') lines += '|X-RAY: SAFE TO PRESS';
  if (s.revealed === 'snap') lines += '|X-RAY: THIS IS A SNAPPER!';
  return lines;
}

// ------------------------------------------------------------ UI pieces ---
// Every button in the game is a stamped brass plaque: rivets at the corners,
// a lit upper face, a hover halo and real travel when you press it.
function button(x, y, w, h, label, col, colD, cb, o) {
  o = o || {};
  const hov = mx >= x && mx < x + w && my >= y && my < y + h && !o.disabled;
  const pressed = hov && down && down.hit && down.hit.id === (o.id || label);
  const yy = y + (pressed ? 3 : hov ? 1 : 0);
  const tint = o.disabled ? '#5a6268' : col;
  if (hov && !o.disabled) {
    ctx.save(); ctx.globalAlpha = 0.18 + Math.sin(tNow * 7) * 0.05;
    rr(x - 3, y - 3, w + 6, h + 8, 5, mixHex(tint, '#ffffff', 0.4)); ctx.restore();
  }
  plaque(x, yy, w, h - 1, { tint, r: 3 });
  const tcol = o.disabled ? '#9aa4a8' : (o.tcol || C.white);
  const sc = o.sc || 1;
  drawTextCSh(label, x + w / 2, yy + Math.floor((h - 2 - 5 * sc) / 2), tcol, sc, '#00000077');
  if (o.sub) drawTextC(o.sub, x + w / 2, yy + h - 8, o.subCol || tcol, 1);
  hit(x, y, w, h, { cb, disabled: o.disabled, tip: o.tip, id: o.id || label, cursor: true });
}

function chip(x, y, w, h, val, colA, colB, sc) {
  plaque(x, y, w, h, { tint: colA, r: 2, noStud: 1 });
  drawTextCSh(fmt(val), x + w / 2, y + Math.floor((h - 5 * sc) / 2) + 1, C.white, sc, '#00000088');
}

// ---- unified card face (30x42) -------------------------------------------
const RAR_COL = ['#5d7a86', '#3e8cd0', '#d0563e', '#9a4fd0', '#e8a020', '#4fd0c8'];
const RAR_NAME = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHICAL'];

// charms render as park BADGES: a circular emblem with ribbon tails
// JURASSIC PASS goes full T-REX once the deck holds 5+ amber teeth
const trexActive = () => G.charms && G.charms.some(c => c.id === 'jurassic') && G.deck && G.deck.filter(x => x.type === 'amber').length >= 5;
function drawBadgeFace(x, y, def, o) {
  o = o || {};
  x |= 0; y |= 0;
  const trex = def.id === 'jurassic' && trexActive();
  const ed = def.ed && EDITIONS[def.ed]; // GOLDEN / DIAMOND / RUSTY finish
  const rim = trex ? '#ffd54a' : ed ? ed.col : RAR_COL[def.rar || 0];
  const cx2 = x + 15, cy2 = y + 15;
  // edition aura: a soft pulsing halo in the finish colour
  if (ed) { ctx.save(); ctx.globalAlpha = 0.3 + Math.sin(tNow * 4 + cx2) * 0.12; fillCircle(cx2, cy2, 17, ed.col); ctx.restore(); }
  // ribbon tails
  rect(x + 7, y + 26, 6, 12, '#8a2a16');
  rect(x + 17, y + 26, 6, 12, '#8a2a16');
  rect(x + 8, y + 27, 4, 10, '#b8452a');
  rect(x + 18, y + 27, 4, 10, '#b8452a');
  rect(x + 9, y + 36, 2, 3, '#8a2a16'); rect(x + 19, y + 36, 2, 3, '#8a2a16');
  // disc with rarity rim (+ soft outer glow on epic and up)
  if ((def.rar || 0) >= 3 || trex) { ctx.save(); ctx.globalAlpha = 0.22 + Math.sin(tNow * 3) * 0.08; fillCircle(cx2, cy2, 16, rim); ctx.restore(); }
  fillCircle(cx2, cy2 + 2, 14, '#00000066');
  fillCircle(cx2, cy2, 14, rim);
  fillCircle(cx2, cy2, 12, trex ? '#3a3020' : '#2a3a30');
  fillCircle(cx2, cy2 - 1, 11, trex ? '#4a3e28' : '#33463a');
  // brushed top-light arc for a little dimension
  ctx.save(); ctx.globalAlpha = 0.16;
  for (let a = 0; a < 7; a++) { const ang = (-0.85 + a / 7 * 1.2); rect(cx2 + Math.cos(ang - 1.57) * 9 - 1, cy2 + Math.sin(ang - 1.57) * 9 - 1, 2, 1, '#ffffff'); }
  ctx.restore();
  // stitched edge dots
  for (let a = 0; a < 8; a++) {
    const ang = a / 8 * Math.PI * 2;
    rect(cx2 + Math.cos(ang) * 12 - 1, cy2 + Math.sin(ang) * 12 - 1, 1, 1, '#00000055');
  }
  (trex ? ICONS.trex : (ICONS[def.ico] || ICONS.star))(cx2 - 6, cy2 - 7);
  // pin glint
  rect(cx2 - 8, cy2 - 10, 2, 2, '#ffffff88');
  if ((def.rar || 0) >= 4 || trex) { // legendary+ sparkle sweep
    const sh = (tNow * 3 | 0) % 3;
    rect(cx2 - 10 + sh * 8, cy2 - 12, 1, 2, '#bffff8');
    if (Math.sin(tNow * 5) > 0.6) rect(cx2 + 7, cy2 + 6, 1, 1, '#ffffff');
  }
  if (ed) { // edition finish: inner ring + a little gem badge on the ribbon
    ctx.save(); ctx.globalAlpha = 0.9;
    for (let a = 0; a < 12; a++) { const ang = a / 12 * Math.PI * 2; rect(cx2 + Math.cos(ang) * 13 - 1, cy2 + Math.sin(ang) * 13 - 1, 1, 1, ed.edge); }
    ctx.restore();
    // finish-specific shimmer
    if (def.ed === 'diamond') { const sh = (tNow * 4 | 0) % 4; ctx.save(); ctx.globalAlpha = 0.7; rect(cx2 - 12 + sh * 6, cy2 - 10 + sh * 4, 2, 2, '#eaffff'); ctx.restore(); }
    else if (def.ed === 'golden') { if (Math.sin(tNow * 6 + cx2) > 0.5) rect(cx2 + 6 - (tNow * 8 | 0) % 12, cy2 - 8, 1, 1, '#fff6c8'); }
    else { rect(cx2 - 5, cy2 + 5, 1, 1, '#5e2e12'); rect(cx2 + 4, cy2 - 4, 1, 1, '#5e2e12'); } // rusty flecks
    // edition gem set into the base ribbon
    fillCircle(cx2, y + 34, 4, ed.edge);
    fillCircle(cx2, y + 34, 3, ed.col);
    rect(cx2 - 1, y + 32, 1, 1, ed.gem);
  }
  if (o.price !== undefined) {
    rr(x - 3, y - 5, 20, 9, 2, '#00000088');
    drawText('$' + o.price, x - 1, y - 3, o.afford ? C.gold : C.red, 1);
  }
}
function drawCardFace(x, y, def, kind, o) {
  o = o || {};
  x |= 0; y |= 0; // integer position keeps the pixel art crisp
  if (kind === 'charm') { drawBadgeFace(x, y, def, o); return; } // badges, not cards
  if (kind === 'tool' || def.picks) { drawToolItem(x, y, def, o); return; } // real tools, not cards
  const isCons = kind === 'cons';
  const isTool = kind === 'tool' || !!def.picks;
  const frame = isTool ? '#3a9a8a' : isCons ? '#8a5fd0' : RAR_COL[def.rar || 0];
  const face = isTool ? '#1c3230' : isCons ? '#2c2238' : '#232f3a';
  const plate = isTool ? '#264440' : isCons ? '#3c2f4c' : '#31414c';
  // shadow + frame + face + inner trim line
  rr(x + 1, y + 3, 30, 42, 2, '#00000077');
  rr(x, y, 30, 42, 2, frame);
  rr(x + 1, y + 1, 28, 40, 2, face);
  rect(x + 2, y + 2, 26, 1, '#ffffff18');
  rect(x + 2, y + 2, 1, 38, '#ffffff10');
  // icon plate with pinstripes + emblem disc
  rr(x + 3, y + 3, 24, 18, 1, plate);
  for (let k = 0; k < 3; k++) rect(x + 5 + k * 8, y + 4, 1, 16, '#ffffff10');
  fillCircle(x + 15, y + 12, 8, isCons ? '#241a30' : '#1a252e');
  fillCircle(x + 15, y + 12, 8, '#00000030');
  ctx.globalAlpha = 0.5; fillCircle(x + 15, y + 10, 7, isCons ? '#2f2440' : '#22303a'); ctx.globalAlpha = 1;
  (ICONS[def.ico] || ICONS.star)(x + 9, y + 6);
  // corner studs
  rect(x + 2, y + 2, 1, 1, frame); rect(x + 27, y + 2, 1, 1, frame);
  rect(x + 2, y + 39, 1, 1, frame); rect(x + 27, y + 39, 1, 1, frame);
  // name strip
  rr(x + 3, y + 24, 24, 9, 1, '#00000044');
  rect(x + 4, y + 33, 22, 1, '#ffffff0c');
  const short = def.name.split(' ')[0].slice(0, 4);
  drawTextC(short, x + 15, y + 26, C.white, 1);
  // rarity gem / use arrow / tool tag
  if (isTool) { drawText('TOOL', x + 5, y + 35, '#7fd0c0', 1); rect(x + 24, y + 36, 2, 2, '#7fd0c0'); }
  else if (isCons) { drawText('>', x + 22, y + 35, '#c8a8f8', 1); drawText('USE', x + 5, y + 35, '#8a70a8', 1); }
  else { rect(x + 24, y + 35, 3, 3, frame); rect(x + 25, y + 36, 1, 1, '#ffffffaa'); if ((def.rar || 0) === 3) { rect(x + 3, y + 21, 24, 1, '#ffd54a66'); } }
  if (o.price !== undefined) {
    rr(x - 3, y - 5, 20, 9, 2, '#00000088');
    drawText('$' + o.price, x - 1, y - 3, o.afford ? C.gold : C.red, 1);
  }
}

// motion wrapper: integer-stepped bob + hover lift (no idle rotation: rotation
// on the low-res buffer anti-aliases the card into a blur). Skips if dragged.
function drawCardAnim(x, y, def, kind, idx, o) {
  o = o || {};
  if (G.drag && G.drag.kind === o.dragKind && G.drag.idx === o.dragIdx) {
    // origin slot ghost
    rr(x + 2, y + 2, 26, 38, 2, '#ffffff14');
    return;
  }
  const ph = (def.id || '').length * 1.37 + idx * 2.1;
  const hov = mx >= x - 2 && mx < x + 32 && my >= y - 6 && my < y + 44;
  const bob = hov ? -5 : Math.round(Math.sin(tNow * 1.8 + ph) * 2);
  const rar = def.rar || 0;
  // ---- cartoon presentation: pop + squash on hover, lazy wobble at rest ----
  const pop = hov ? 1.14 + Math.sin(tNow * 11) * 0.03 : 1;
  const tilt = hov ? Math.sin(tNow * 8 + ph) * 0.06 : Math.sin(tNow * 1.3 + ph) * 0.022;
  const cxm = x + 15, cym = y + bob + 21;
  ctx.save();
  ctx.translate(cxm, cym); ctx.rotate(tilt); ctx.scale(pop, pop > 1 ? pop * 0.96 : 1); ctx.translate(-cxm, -cym);
  if (hov) { // warm glow pad behind the card
    ctx.save(); ctx.globalAlpha = 0.28 + Math.sin(tNow * 8) * 0.1;
    rr(x - 4, y + bob - 4, 38, 50, 5, '#ffe8a0'); ctx.restore();
  }
  drawCardFace(x, y + bob, def, kind, o);
  // ---- gloss sweep travelling across the face ----
  const sweep = (tNow * 0.5 + idx * 0.31 + ph * 0.07) % 2.6;
  if (sweep < 0.5) {
    const k = sweep / 0.5;
    ctx.save();
    ctx.beginPath(); ctx.rect(x + 1, y + bob + 1, 28, 40); ctx.clip();
    ctx.globalAlpha = 0.34 * (1 - Math.abs(k - 0.5) * 2);
    const gx2 = x - 18 + k * 56;
    for (let ry = 0; ry < 42; ry += 2) rect(gx2 + ry * 0.55, y + bob + ry, 5, 2, '#ffffff');
    ctx.restore();
  }
  ctx.restore();
  // ---- rarity twinkles orbiting the good stuff ----
  if (rar >= 3) {
    for (let s = 0; s < (rar >= 5 ? 3 : 2); s++) {
      const a = tNow * 1.5 + s * 2.3 + ph;
      const sx2 = x + 15 + Math.cos(a) * 19, sy2 = y + bob + 20 + Math.sin(a) * 25;
      const tw = Math.sin(tNow * 6 + s * 2);
      if (tw > -0.2) {
        ctx.save(); ctx.globalAlpha = 0.45 + tw * 0.45;
        const c2 = RAR_COL[rar];
        rect(sx2 - 2, sy2, 5, 1, c2); rect(sx2, sy2 - 2, 1, 5, c2); rect(sx2, sy2, 1, 1, '#ffffff');
        ctx.restore();
      }
    }
  }
  const meta2 = { id: o.id || (kind + idx + (def.id || '')), cursor: true, tip: o.tip };
  if (o.dragKind !== undefined) { meta2.dragKind = o.dragKind; meta2.dragIdx = o.dragIdx; }
  if (o.click) meta2.click = o.click;
  if (o.cb) meta2.cb = o.cb;
  hit(x - 2, y - 4, 34, 48, meta2);
}

// the card currently being dragged, drawn near the cursor with swing
function drawDraggedCard() {
  const d = G.drag; if (!d) return;
  const def = d.kind === 'cons' ? G.cons[d.idx] : G.charms[d.idx];
  if (!def) { G.drag = null; return; }
  d.px = d.px + (mx - d.px) * 0.55;
  d.py = d.py + (my - d.py) * 0.55;
  const vx = mx - d.px;
  ctx.save();
  ctx.translate(Math.round(d.px), Math.round(d.py + 8));
  ctx.rotate(clamp(vx * 0.04, -0.4, 0.4));
  ctx.globalAlpha = 0.92;
  drawCardFace(-15, -21, def, d.kind === 'cons' ? 'cons' : 'charm', {});
  ctx.globalAlpha = 1;
  ctx.restore();
  d.x = mx; d.y = my;
  // drop hints
  if (d.kind === 'cons' && G.cons[d.idx] && G.cons[d.idx].picks) {
    ctx.globalAlpha = 0.5 + Math.sin(tNow * 6) * 0.2;
    drawTextCSh(G.state === 'play' ? 'TOOLS WORK AT THE SHOP OR ON THE TRAIL' : 'RELEASE TO OPEN THE BENCH', W / 2, 66, '#7fd0c0', 1);
    ctx.globalAlpha = 1;
  } else if (d.kind === 'cons' && G.state === 'play') {
    const L = mouthLayout();
    const t2 = G.cons[d.idx];
    ctx.globalAlpha = 0.35 + Math.sin(tNow * 6) * 0.15;
    if (t2 && t2.target === 'tooth') {
      drawTextCSh('DROP ON A TOOTH', L.maw.x + L.maw.w / 2, L.maw.y - 66, C.green, 1);
    } else if (t2 && (t2.need === 'bite' || t2.need === 'round')) {
      rr(L.maw.x - 10, L.maw.y - 8, L.maw.w + 20, L.maw.h + 16, 4, '#63d66a22');
      drawTextCSh('DROP ON THE GATOR', L.maw.x + L.maw.w / 2, L.maw.y - 66, C.green, 1);
    } else {
      drawTextCSh('RELEASE TO USE', L.maw.x + L.maw.w / 2, L.maw.y - 66, C.green, 1);
    }
    ctx.globalAlpha = 1;
  }
  if (d.kind === 'charm' && G.state === 'shop') {
    ctx.globalAlpha = 0.5 + Math.sin(tNow * 6) * 0.2;
    rr(BARREL.x - 4, BARREL.y - 6, BARREL.w + 8, BARREL.h + 10, 3, '#ffc84333');
    drawTextCSh('SELL', BARREL.x + BARREL.w / 2, BARREL.y - 14, C.gold, 1);
    ctx.globalAlpha = 1;
  }
}

// ------------------------------------------------------------ sidebar -----
// pixel flame licks rising off a hot chip; inten 0..1 drives the blaze
function drawFlames(x, y, w2, inten, cols) {
  if (inten <= 0.02) return;
  const n = Math.max(4, Math.floor(w2 / 8));
  for (let k = 0; k < n; k++) {
    const fx = x + 2 + k * (w2 - 5) / (n - 1);
    const hgt = Math.round((2 + inten * 8) * (0.45 + 0.55 * Math.abs(Math.sin(tNow * 8 + k * 2.3))));
    if (hgt < 1) continue;
    ctx.save(); ctx.globalAlpha = 0.7;
    rect(fx, y - hgt, 2, hgt, cols[0]);
    if (hgt > 2) rect(fx, y - Math.floor(hgt * 0.55), 2, Math.floor(hgt * 0.55), cols[1]);
    if (inten > 0.4 && ((tNow * 9 + k * 1.3) | 0) % 4 === 0) rect(fx + 1, y - hgt - 2 - ((tNow * 13 + k) | 0) % 3, 1, 2, cols[2]);
    ctx.restore();
  }
}
function drawSidebar() {
  panel(SIDEBAR.x, SIDEBAR.y, SIDEBAR.w, SIDEBAR.h, { face: '#18242bee' });
  const x = SIDEBAR.x + 5, w = SIDEBAR.w - 10;
  let y = SIDEBAR.y + 5;

  const isBoss = G.round === 2;
  const plateCol = isBoss ? C.redD : G.round === 1 ? '#8a5a16' : '#2c6b38';
  const plateHi = isBoss ? C.red : G.round === 1 ? C.orange : C.green;
  panel(x, y, w, 26, { face: plateCol, edge: plateHi });
  const rname = isBoss && G.boss ? G.boss.name : ROUND_NAMES[G.round];
  drawTextC(rname, x + w / 2, y + 4, C.white, 1);
  drawTextC('ANTE ' + G.ante + (G.ante <= 8 ? '/8' : ''), x + w / 2, y + 15, isBoss ? '#ffb0a8' : '#b8d8b8', 1);
  y += 30;
  if (isBoss && G.boss) {
    panel(x, y, w, 20, { face: '#33161a', edge: C.redD });
    drawSmallWrapped(G.boss.desc, x + 3, y + 3, w - 6, '#ffb0a8');
    y += 24;
  }
  if ((G.nodeMods || []).length && (G.state === 'play' || G.state === 'swap' || G.state === 'snap' || G.state === 'bossintro')) {
    G.nodeMods.forEach(m => {
      const md = NODE_MODS[m];
      panel(x, y, w, 11, { face: md.bad ? '#33161a' : '#1e3220', edge: md.col, r: 2 });
      drawText(md.name, x + 4, y + 3, md.col, 1);
      hit(x, y, w, 11, { id: 'mod' + m, tip: md.name + '|' + md.desc });
      y += 14;
    });
  }

  panel(x, y, w, 40, { face: C.dark2 });
  drawText('TARGET', x + 4, y + 4, C.dim, 1);
  drawText(fmt(G.target), x + 4, y + 12, C.orange, 1);
  drawText('SCORE', x + 4, y + 22, C.dim, 1);
  const sc = G.dispScore >= 100000 ? 1 : 2;
  if (G.scorePulse > 0) {
    ctx.globalAlpha = G.scorePulse * 1.6;
    rr(x + 1, y + 26, w - 2, 14, 2, '#ffc84355');
    ctx.globalAlpha = 1;
  }
  drawText(fmt(Math.round(G.dispScore)), x + 4, y + 29, C.gold, sc);
  const pw = Math.floor(clamp(G.score / G.target, 0, 1) * (w - 8));
  rect(x + 4, y + 41 - 3, w - 8, 2, '#0a1215');
  if (pw > 0) rect(x + 4, y + 41 - 3, pw, 2, C.gold);
  y += 44;

  const half = Math.floor((w - 12) / 2);
  const hidePool = bossIs('phantom') && G.pool && G.pool.clicks > 0;
  // during the bank sequence the chips play back each contribution live
  const showT = G.seq ? Math.round(G.seq.dispT) : (G.pool ? G.pool.teeth : 0);
  const showM = G.seq ? Math.round(G.seq.dispM * 10) / 10 : (G.pool ? G.pool.mult : 0);
  // the hotter the pool burns, the taller the flames
  const tInt = clamp(showT / 60, 0, 1);
  const mInt = clamp((showM - 1) / 8, 0, 1);
  if (!hidePool) drawFlames(x, y, half, tInt, ['#1565b5', '#5cc8ff', '#cfeaff']);
  drawFlames(x + half + 12, y, half, mInt, ['#c22a20', '#ff9838', '#ffe089']);
  if (mInt > 0.35) { ctx.save(); ctx.globalAlpha = 0.12 + Math.sin(tNow * 6) * 0.05; rr(x + half + 9, y - 3, half + 6, 22, 3, '#ff5348'); ctx.restore(); }
  if (hidePool) {
    rr(x, y + 2, half, 16, 2, '#00000066'); rr(x, y, half, 16, 2, '#0c3f75'); drawTextC('??', x + half / 2, y + 6, '#7fb8e8', 1);
  } else chip(x, y, half, 16, showT, '#1565b5', '#0c3f75', 1);
  drawTextC('*', x + half + 6, y + 5, C.red, 2);
  chip(x + half + 12, y, half, 16, showM, '#c22a20', '#801812', 1);
  if (G.chipPulse > 0) { // gold ring flash when a value lands
    ctx.save(); ctx.globalAlpha = G.chipPulse * 2.4;
    rr(x - 2, y - 2, half + 4, 20, 3, '#ffe089'); rr(x + half + 10, y - 2, half + 4, 20, 3, '#ffe089');
    ctx.globalAlpha = 1; ctx.restore();
  }
  drawText('TEETH', x + 2, y + 18, '#7fb8e8', 1);
  drawText('MULT', x + half + 14, y + 18, '#ff9a90', 1);
  y += 27;

  panel(x, y, w, 14, { face: '#252017', edge: '#6b5a2a' });
  drawText('BITE', x + 4, y + 4, C.dim, 1);
  if (bossIs('phantom') && G.pool && G.pool.clicks > 0 && !G.seq) drawText('??', x + 30, y + 4, C.gold, 1);
  else if (G.seq) { // rolling total while the sequence plays
    const run = Math.floor(G.seq.dispT * G.seq.dispM);
    drawTextSh(fmt(run), x + 30, y + 4, '#ffe089', 1);
  } else drawText(fmt(G.pool ? bankValue() : 0), x + 30, y + 4, C.gold, 1);
  y += 19;

  drawText('BITES', x + 2, y + 2, C.dim, 1);
  for (let i = 0; i < Math.min(6, G.bites); i++) {
    ICONS.tooth(x + 34 + i * 12, y - 2);
  }
  if (G.bites > 6) drawText('+' + (G.bites - 6), x + 34 + 6 * 12, y + 2, C.white, 1);
  y += 13;
  drawText('X-RAYS', x + 2, y + 2, C.dim, 1);
  if (xraysBlocked()) {
    drawText('BLOCKED', x + 38, y + 2, C.red, 1);
  } else {
    for (let i = 0; i < Math.min(5, G.xrays); i++) {
      rr(x + 38 + i * 11, y, 9, 9, 2, '#123a52');
      rr(x + 39 + i * 11, y + 1, 7, 7, 2, '#2277cc');
    }
  }
  y += 15;

  panel(x, y, w, 18, { face: '#26321e', edge: '#5a7a3a' });
  drawText(curLabel(G.money), x + 6, y + 5, C.gold, 2);
  drawTextC('MONEY', x + w - 22, y + 7, '#9ab87a', 1);
  y += 23;

  const deckOk = G.state === 'play' || G.state === 'shop' || G.state === 'swap';
  button(x, y, w, 14, 'TEETH ' + G.drawPile.length + '/' + G.deck.length, '#3a5560', '#243a44',
    () => { G.deckOpen = !G.deckOpen; }, { id: 'deckbtn', disabled: !deckOk, tip: 'YOUR TOOTH DECK|CLICK TO VIEW' });
  y += 19;

  drawTextC('BEST ANTE: ' + best, x + w / 2, SIDEBAR.y + SIDEBAR.h - 18, C.dim, 1);
  button(x, SIDEBAR.y + SIDEBAR.h - 12, w, 10, 'II PAUSE (ESC)', '#243a44', '#16262c', () => { togglePause(); }, { id: 'pausebtn' });
}

// split a label into at most 2 lines that fit `w`, breaking long words if need be
function fitLines(name, w) {
  if (textW(name, 1) <= w) return [name];
  if (name.includes(' ')) {
    const cut = name.lastIndexOf(' ');
    const a = name.slice(0, cut), b = name.slice(cut + 1);
    if (textW(a, 1) <= w && textW(b, 1) <= w) return [a, b];
  }
  const per = Math.max(1, Math.floor((w + 1) / 5));
  return [name.slice(0, per), name.slice(per, per * 2)];
}

function drawSmallWrapped(txt, x, y, w, col) {
  const words = ('' + txt).toUpperCase().split(' ');
  let line = '', yy = y;
  const maxChars = Math.floor(w / 5);
  words.forEach(word => {
    if ((line + ' ' + word).trim().length > maxChars) { drawText(line.trim(), x, yy, col, 1); yy += 7; line = word; }
    else line = (line + ' ' + word);
  });
  if (line.trim()) drawText(line.trim(), x, yy, col, 1);
  return yy + 7;
}

// ------------------------------------------------------------ top bar -----
function drawTopBar(inShop) {
  const cx0 = 120;
  drawText('CHARMS ' + G.charms.length + '/5', cx0, 2, C.dim, 1);
  for (let i = 0; i < 5; i++) {
    const x = cx0 + i * 31, y = 12;
    if (i < G.charms.length) {
      const def = G.charms[i];
      const o = {
        id: 'charm' + i + def.id,
        tip: (def.ed && EDITIONS[def.ed] ? EDITIONS[def.ed].name + ' ' : '') + def.name + '|CLICK FOR DETAILS' + (inShop ? '|DRAG TO THE BARREL TO SELL' : ''),
        click: () => { G.inspect = { kind: 'charm', def, idx: i }; },
      };
      if (inShop) { o.dragKind = 'charm'; o.dragIdx = i; }
      const pop = Math.max(0, charmPop[def.id] || 0);
      if (pop > 0) { // the badge bounces + glows when its effect fires
        ctx.save(); ctx.globalAlpha = pop * 1.6; rr(x - 3, y - 3, 32, 42, 4, '#ffe089'); ctx.restore();
        ctx.save();
        const sc2 = 1 + pop * 0.45;
        ctx.translate(x + 13, y + 18); ctx.scale(sc2, sc2); ctx.translate(-(x + 13), -(y + 18));
        drawCardAnim(x, y - Math.round(pop * 6), def, 'charm', i, o);
        ctx.restore();
      } else drawCardAnim(x, y, def, 'charm', i, o);
    } else {
      rr(x, y, 26, 36, 2, '#ffffff18');
      rr(x + 1, y + 1, 24, 34, 2, '#00000030');
    }
  }
  const kx0 = 385;
  drawText('CARDS', kx0, 2, C.dim, 1);
  for (let i = 0; i < 3; i++) {
    const x = kx0 + i * 31, y = 12;
    if (i < G.cons.length) {
      const def = G.cons[i];
      const isTool = !!def.picks;
      drawCardAnim(x, y, def, isTool ? 'tool' : 'cons', i, {
        id: 'cons' + i + def.id,
        tip: def.name + '|CLICK FOR DETAILS|' + (isTool ? 'DRAG OUT TO OPEN THE BENCH (SHOP/TRAIL)' : 'DRAG ONTO THE GATOR TO USE'),
        click: () => { G.inspect = { kind: isTool ? 'tool' : 'cons', def, idx: i }; },
        dragKind: 'cons', dragIdx: i,
      });
    } else {
      rr(x, y, 26, 36, 2, '#ffffff18');
      rr(x + 1, y + 1, 24, 34, 2, '#00000030');
    }
  }
}

// ------------------------------------------------------------ play screen -
function drawPlay() {
  const th = themeNow();
  drawSceneBack(th);
  drawCroc(G.jawClose);
  drawSceneFront(th);
  drawSidebar();
  drawTopBar(false);
  if (G.summer) drawCrabs();
  // Professor Manta's camera: photograph an un-logged mutation for tickets
  // (shop mutations aren't album subjects, so no camera on them)
  if (G.mut && !SHOP_MUTS.includes(G.mut) && meta.summer && !meta.summer.caught[G.mut]) {
    button(284, 44, 96, 20, 'CAPTURE', '#2a8ad0', '#164a80', capturePhoto,
      { id: 'capture', sc: 1, tip: 'PHOTOGRAPH THIS ' + MUTATIONS[G.mut].name + '|Log it for Professor Manta' });
    ICONS.mg_cam(288, 46);
  }
  if (G.photoT > 0) { ctx.save(); ctx.globalAlpha = Math.min(1, G.photoT * 1.8); rect(0, 0, W, H, '#ffffff'); ctx.restore(); }

  if (G.mode === 'xray') {
    drawTextCSh('CLICK A TOOTH TO X-RAY IT', W / 2 + 50, 66, '#9fe8ff', 1);
  } else if (G.mode === 'extract') {
    drawTextCSh('CLICK A TOOTH TO YANK IT OUT', W / 2 + 50, 66, '#9fe8ff', 1);
  }

  const canBank = G.state === 'play' && G.pool && G.pool.clicks > 0 && !(bossIs('lockjaw') && G.pool.clicks < 4);
  button(150, 240, 130, 24, 'BANK BITE', '#e8a020', '#98650e',
    () => bank(false), {
      sc: 1, id: 'bank', disabled: !canBank,
      sub: bossIs('phantom') && G.pool && G.pool.clicks > 0 ? '+??' : '+' + fmt(G.pool ? bankValue() : 0), subCol: '#5a3c08',
      tip: 'BANK BITE|Score TEETH X MULT and end this bite.' + (bossIs('lockjaw') ? '|LOCKJAW: NEEDS 4+ PRESSED' : '')
    });
  const xdis = G.xrays <= 0 || xraysBlocked();
  button(290, 240, 86, 24, G.mode === 'xray' ? 'CANCEL' : 'X-RAY (' + G.xrays + ')', '#2277cc', '#124a80',
    toggleXrayMode, { id: 'xray', disabled: xdis && G.mode !== 'xray', tip: 'X-RAY|Check one tooth: safe or snapper?|' + (xraysBlocked() ? 'BLOCKED THIS ROUND!' : G.xrays + ' LEFT THIS ROUND') });

  const unpressed = G.mouth.filter(s => !s.pressed && !s.gone);
  const snapsLeft = unpressed.filter(s => s.snap).length;
  if (unpressed.length > 0 && G.pool) {
    const risk = Math.round(100 * snapsLeft / unpressed.length);
    drawTextCSh('SNAP RISK ' + risk + '%', 428, 240, risk >= 34 ? C.red : risk >= 15 ? C.orange : C.green, 1);
    drawTextCSh(unpressed.length + (unpressed.length === 1 ? ' TOOTH LEFT' : ' TEETH LEFT'), 428, 252, C.dim, 1);
  }
}

// ------------------------------------------------------------ snap anim ---
function updateSnap(dt) {
  G.snapT += dt;
  if (G.snapT < 0.22) {
    G.jawClose = easeIn(G.snapT / 0.22);
  } else {
    if (G.jawClose < 1) { shake = 7; flashRed = 0.35; burstTeethShards(); scatterBirds(); splashWater(); scareFireflies(W / 2, 150, 140); }
    G.jawClose = 1;
  }
  if (G.snapT > 1.5) {
    const lost = G.pool ? bankValue() : 0;
    G.jawClose = 0;
    G.state = 'play';
    G.stats.snaps++;
    meta.lifeSnaps++;
    if (meta.lifeSnaps >= 25) unlock('snap25');
    saveMeta();
    if (has('dentures') && !G.denturesUsed && lost > 0) {
      G.denturesUsed = true;
      const save2 = Math.floor(lost / 2);
      G.score += save2;
      G.roundBanks++;
      G.scorePulse = 0.4;
      float(60, 88, 'DENTURES SAVED ' + fmt(save2) + '!', C.green, 1, 1.6);
    } else if (lost > 0) float(60, 96, 'LOST ' + fmt(lost) + '!', C.red, 1, 1.4);
    if (has('swampheart') && !G.heartUsed) {
      G.heartUsed = true;
      G.bites++; // endBite will take it right back: net zero
      float(W / 2 + 50, 96, 'SWAMP HEART: BITE REFUNDED', C.green, 1, 1.5);
    }
    endBite();
  }
}
let shardsDone = false;
function burstTeethShards() {
  if (shardsDone) return;
  shardsDone = true;
  const L = mouthLayout();
  burst(L.maw.x + L.maw.w / 2, L.maw.y + L.maw.h / 2, '#fef9e6', 22, 130);
  burst(L.maw.x + L.maw.w / 2, L.maw.y + L.maw.h / 2, C.red, 10, 90);
}

function drawSwap() {
  drawPlay();
  const k = clamp(G.swapT / 0.45, 0, 1);
  ctx.globalAlpha = k < 0.5 ? k * 2 : (1 - k) * 2;
  drawTextCSh('FRESH MOUTH...', W / 2 + 50, 92, C.green, 2);
  ctx.globalAlpha = 1;
}

function drawSnap() {
  drawPlay();
  if (G.snapT > 0.22 && G.snapT < 1.4) {
    const lost = G.pool ? bankValue() : 0;
    panel(W / 2 + 50 - 78, 70, 156, lost > 0 ? 56 : 40, { face: '#2a0e12ee', edge: C.redD });
    drawTextCSh('SNAP!', W / 2 + 50, 78, C.red, 4, '#40000088');
    if (lost > 0) drawTextCSh('BITE LOST: ' + fmt(lost), W / 2 + 50, 112, '#ffb0a8', 1);
  }
}

// ------------------------------------------------------------ shop --------
// preview a cosmetic (glove or hat) centered at (cx,cy) for the boutique/racks
function drawCosmeticArt(cx, cy, kind, k) {
  if (kind === 'fit') { drawFitIcon(cx, cy, k, 1.1); return; }
  if (kind === 'gear') {
    drawGearArt(cx, cy - 4, k, 2);
  } else if (kind === 'hat') {
    if (HATS[k].ico === 'none') { ICONS.skull(cx - 6, cy - 6); return; }
    drawHatArt(cx, cy + 9, k, 2);
  } else {
    ctx.save(); ctx.translate(cx - 12, cy - 11); ctx.scale(2, 2);
    ICONS.glove(0, 0, GLOVES[k].skin); ctx.restore();
  }
}
// the GATOR'S CLOSET boutique: two random-rarity cosmetics for sale (right wall)
// shop material ramps [outline, shadow, base, light, highlight]
const RAMP = {
  steel: ['#1c2429', '#33454e', '#55707c', '#7f97a1', '#b9c9cf'],
  wood: ['#241708', '#3a2818', '#5f4228', '#7a5230', '#9a6a3c'],
  glass: ['#0b2a30', '#12525e', '#1d6f7d', '#3aa6b4', '#bfeef2'],
  appl: ['#5d6a68', '#97a4a2', '#cdd6d4', '#e6ecea', '#ffffff'],
  sign: ['#14361c', '#245c2a', '#2c7d3a', '#63d66a', '#bff0b8'],
};
const STOCK = ['#b5432f', '#2f8b8b', '#c9941a', '#4a6ab0', '#a03a4a', '#5f8440', '#c86a5a', '#7a5230'];

function drawCosmeticStand(X, Y, Wc) {
  X = X === undefined ? 8 : X;
  Y = Y === undefined ? 108 : Y;
  Wc = Wc === undefined ? 120 : Wc;
  const S = SHOPW.steel, railY = Y + 8, baseY = Y + 98;
  // mirror panel on the wall behind the rail
  rr(X + 2, Y - 2, Wc - 4, 98, 4, '#241708');
  rr(X + 4, Y, Wc - 8, 94, 3, '#3a5a66');
  rect(X + 6, Y + 2, Wc - 12, 90, '#46707e');
  ctx.save(); ctx.globalAlpha = 0.22;
  for (let k = 0; k < 3; k++) { ctx.save(); ctx.translate(X + 20 + k * 34, Y + 2); ctx.rotate(0.5); rect(0, 0, 6 - k, 120, '#e8fbff'); ctx.restore(); }
  ctx.restore();
  // chrome rail on two uprights, feet on little casters
  [X + 6, X + Wc - 9].forEach(ux => {
    rect(ux, railY, 3, baseY - railY, S[2]); rect(ux, railY, 1, baseY - railY, S[4]); rect(ux + 2, railY, 1, baseY - railY, S[0]);
    rect(ux - 5, baseY, 13, 3, S[1]); rect(ux - 5, baseY, 13, 1, S[3]);
    fillCircle(ux - 3, baseY + 5, 2, '#1a1a1a'); fillCircle(ux + 6, baseY + 5, 2, '#1a1a1a');
  });
  rect(X + 4, railY - 2, Wc - 8, 4, S[2]); rect(X + 4, railY - 2, Wc - 8, 1, S[4]); rect(X + 4, railY + 1, Wc - 8, 1, S[0]);
  fillCircle(X + 4, railY, 3, S[3]); fillCircle(X + Wc - 4, railY, 3, S[3]);
  // shoe boxes stacked under the rail
  [['#c8302a', 0], ['#3e8cd0', 1], ['#e8b41c', 0]].forEach(([col, st], k) => {
    const bx = X + 14 + k * 32, by = baseY - 10 - st * 9;
    rr(bx, by, 28, 10, 1, '#101418'); rect(bx + 1, by + 1, 26, 8, col); rect(bx + 1, by + 1, 26, 2, mixHex(col, '#ffffff', 0.35));
    rect(bx + 10, by + 4, 8, 3, '#f4ecd8');
    if (st) { rr(bx, by + 9, 28, 10, 1, '#101418'); rect(bx + 1, by + 10, 26, 8, '#8a6a4a'); rect(bx + 1, by + 10, 26, 2, '#a8886a'); rect(bx + 10, by + 13, 8, 3, '#f4ecd8'); }
  });
  // header plaque on little chains
  rect(X + 26, Y - 10, 2, 8, '#8a7a58'); rect(X + Wc - 28, Y - 10, 2, 8, '#8a7a58');
  panel(X + 8, Y - 18, Wc - 16, 15, { face: '#5f4228', edge: '#c8a040', r: 2 });
  drawTextCSh("GATOR'S CLOSET", X + Wc / 2, Y - 14, '#ffe6b0', 1);
  const cos = G.cosmetics || [];
  const hanger = (hx, col) => {
    rect(hx, railY - 5, 1, 5, '#b8c0c8'); rect(hx - 2, railY - 6, 3, 1, '#b8c0c8');
    for (let k = 0; k < 11; k++) { rect(hx - k, railY + 2 + k * 0.45, 1, 2, col); rect(hx + k, railY + 2 + k * 0.45, 1, 2, col); }
    rect(hx - 11, railY + 7, 23, 2, col);
  };
  if (!cos.length) {
    hanger(X + Wc / 2, '#9a7a52');
    drawTextCSh('FRESH OUT!', X + Wc / 2, Y + 34, C.gold, 1);
    drawWrappedC('You own every look, sharp dresser.', X + Wc / 2, Y + 46, Wc - 16, '#e8f4f8');
    return;
  }
  const colW = (Wc - 12) / cos.length;
  cos.forEach((c, i) => {
    const cx = X + 6 + colW * (i + 0.5), rc = RAR_COL[c.rar];
    const hov = mx >= cx - colW / 2 && mx < cx + colW / 2 && my >= Y && my < baseY && !c.sold;
    const sway = Math.sin(tNow * 1.4 + i * 2.1) * 0.05 + (hov ? Math.sin(tNow * 8) * 0.08 : 0);
    ctx.save(); ctx.translate(cx, railY); ctx.rotate(sway); ctx.translate(-cx, -railY);
    hanger(cx, c.sold ? '#6a5a42' : '#c8a070');
    if (c.sold) {
      ctx.restore();
      drawTextCSh('WORN!', cx, Y + 34, C.green, 1);
      drawTextC('LOOKIN', cx, Y + 46, '#e8f4f8', 1); drawTextC('GOOD', cx, Y + 54, '#e8f4f8', 1);
      return;
    }
    // rarity-ringed display disc clipped to the hanger
    if (hov) { ctx.save(); ctx.globalAlpha = 0.3 + Math.sin(tNow * 7) * 0.1; fillCircle(cx, Y + 34, 20, rc); ctx.restore(); }
    fillCircle(cx, Y + 35, 16, '#00000044');
    fillCircle(cx, Y + 34, 16, rc); fillCircle(cx, Y + 34, 14, mixHex(rc, '#ffffff', 0.55)); fillCircle(cx, Y + 33, 12, '#fdf6e6');
    drawCosmeticArt(cx, Y + 34, c.kind, c.k);
    // string + dangling price tag
    const cdefs = { glove: GLOVES, hat: HATS, gear: GEAR, fit: FITS };
    const cdef = (cdefs[c.kind] || HATS)[c.k];
    const kindLbl = c.kind === 'glove' ? 'GLOVE' : c.kind === 'gear' ? 'FACE' : c.kind === 'fit' ? FITS[c.k].cat.toUpperCase() : 'HAT';
    const afford = G.money >= c.price;
    rect(cx, Y + 47, 1, 3, '#f4ecd8');
    const tw = Math.min(colW - 4, 54), tx = cx - tw / 2, ty = Y + 51;
    rr(tx + 1, ty + 1, tw, 34, 2, '#00000055');
    rr(tx, ty, tw, 34, 2, '#8a7448'); rr(tx + 1, ty + 1, tw - 2, 32, 2, '#fbf3dc');
    rect(tx + 1, ty + 1, tw - 2, 6, rc); drawTextC(RAR_NAME[c.rar], cx, ty + 1, '#ffffff', 1);
    rr(cx - 3, ty - 3, 7, 4, 1, '#fbf3dc'); fillCircle(cx, ty - 1, 1, '#241708');
    const nl2 = fitLines(cdef.name, tw - 4);
    if (nl2.length > 1) { drawTextC(nl2[0], cx, ty + 9, '#3a2818', 1); drawTextC(nl2[1], cx, ty + 16, '#3a2818', 1); }
    else drawTextC(nl2[0], cx, ty + 12, '#3a2818', 1);
    drawTextC('$' + c.price, cx, ty + 24, afford ? '#c8302a' : '#8a7a6a', 1);
    ctx.restore();
    hit(cx - colW / 2, Y, colW, baseY - Y - 4, {
      id: 'cos' + i, cursor: true, cb: () => buyCosmetic(c),
      tip: cdef.name + '|' + RAR_NAME[c.rar] + ' ' + kindLbl + '|'
        + cdef.flav + '|$' + c.price + ' - CLICK TO WEAR IT',
    });
  });
}

const BARREL = { x: 6, y: 216, w: 42, h: 44 };
function drawBarrel() {
  // wooden sell barrel
  rr(BARREL.x, BARREL.y + 4, BARREL.w, BARREL.h - 4, 3, '#5a3a1e');
  rr(BARREL.x + 2, BARREL.y + 6, BARREL.w - 4, BARREL.h - 8, 3, '#7a5230');
  for (let k = 1; k < 5; k++) rect(BARREL.x + 2 + k * 8, BARREL.y + 6, 1, BARREL.h - 8, '#5a3a1e');
  rect(BARREL.x, BARREL.y + 12, BARREL.w, 3, '#3a444c');
  rect(BARREL.x, BARREL.y + BARREL.h - 10, BARREL.w, 3, '#3a444c');
  // open top with coins glinting
  rr(BARREL.x + 3, BARREL.y, BARREL.w - 6, 8, 3, '#2a1a0c');
  rect(BARREL.x + 10, BARREL.y + 2, 6, 2, C.gold);
  rect(BARREL.x + 22, BARREL.y + 3, 5, 2, '#c9941a');
  rect(BARREL.x + 16, BARREL.y + 4, 4, 2, '#fff6c8');
  drawTextC('TRADE-IN', BARREL.x + BARREL.w / 2, BARREL.y + BARREL.h + 4, C.gold, 1);
  hit(BARREL.x, BARREL.y, BARREL.w, BARREL.h, { id: 'barrel', tip: 'TRADE-IN BIN|Drag a badge here to sell it|for half its price' });
}

// ===================== THE TRADING POST INTERIOR ==========================
//  A proper room: tongue-and-groove walls over a wainscot, joists and swinging
//  bulbs overhead, board floor running to a rag rug, a steel gondola of goods,
//  a humming cooler, a pegboard of hung tools and Merle behind his counter.
// ==========================================================================
const SHOPW = {
  plank: ['#2a1c10', '#3d2a18', '#4e3721', '#5f452a', '#755538'],
  wains: ['#1b2a22', '#26402f', '#33533d', '#44694c'],
  floor: ['#1c1208', '#2c1e11', '#3b2917', '#4b351f', '#5c4228'],
  steel: ['#12191e', '#2c3c46', '#4c626f', '#7b95a3', '#c3d8e2'],
};

// vertical tongue-and-groove boarding with knots, seams and a nail line
function shopWall() {
  const P = SHOPW.plank;
  rect(0, 0, W, 216, P[2]);
  for (let x = 0; x < W; x += 16) {
    const v = ((x / 16) | 0) % 3;
    rect(x, 0, 15, 216, v === 0 ? P[2] : v === 1 ? P[3] : P[1]);
    rect(x, 0, 1, 216, P[4]);                 // lit bevel
    rect(x + 14, 0, 2, 216, P[0]);            // groove shadow
    // grain
    ctx.save(); ctx.globalAlpha = 0.16;
    for (let g = 0; g < 5; g++) rect(x + 2 + ((x * 7 + g * 13) % 11), (g * 47 + x) % 210, 1, 18 + (x % 13), P[0]);
    ctx.restore();
    if ((x / 16) % 4 === 1) { // knot
      const ky = 30 + (x * 13) % 150;
      fillCircle(x + 7, ky, 3, P[1]); fillCircle(x + 7, ky, 2, P[0]); rect(x + 6, ky - 1, 1, 1, P[3]);
    }
    rect(x + 7, 8, 1, 1, P[0]); rect(x + 7, 206, 1, 1, P[0]); // nails
  }
  // wainscot + chair rail along the bottom of the wall
  const Wn = SHOPW.wains;
  rect(0, 150, W, 66, Wn[2]);
  for (let x = 0; x < W; x += 22) { rect(x, 150, 1, 66, Wn[3]); rect(x + 20, 150, 2, 66, Wn[0]); }
  rect(0, 150, W, 3, Wn[3]); rect(0, 153, W, 1, Wn[1]);
  rect(0, 146, W, 5, SHOPW.plank[4]); rect(0, 146, W, 1, '#8a6a46'); rect(0, 150, W, 1, SHOPW.plank[0]);
  // ceiling joists and gloom
  for (let i = 0; i < 12; i++) { ctx.save(); ctx.globalAlpha = (12 - i) / 12 * 0.55; rect(0, i * 2, W, 2, '#120b06'); ctx.restore(); }
  [44, 148, 252, 356, 440].forEach(jx => { rect(jx, 0, 10, 16, '#24170c'); rect(jx, 0, 2, 16, '#3a2716'); rect(jx, 14, 10, 2, '#100a04'); });
}

// board floor in loose perspective, worn path, rag rug
function shopFloor() {
  const F = SHOPW.floor;
  rect(0, 216, W, H - 216, F[2]);
  rect(0, 216, W, 2, F[0]);
  rect(0, 218, W, 2, F[4]);
  let row = 0;
  for (let y = 220; y < H; y += 11 + row * 2) {
    const h = 11 + row * 2;
    rect(0, y, W, h, row % 2 ? F[2] : F[3]);
    rect(0, y + h - 1, W, 1, F[0]);
    for (let x = ((row * 37) % 60); x < W; x += 60) { rect(x, y, 1, h, F[1]); rect(x + 2, y + 2, 1, 1, F[0]); rect(x + 2, y + h - 3, 1, 1, F[0]); }
    ctx.save(); ctx.globalAlpha = 0.12;
    for (let g = 0; g < 12; g++) rect((g * 43 + row * 17) % W, y + 2 + (g % 3) * 3, 14 + (g % 5) * 4, 1, F[0]);
    ctx.restore();
    row++;
  }
  ctx.save(); ctx.globalAlpha = 0.16; // worn walking path down the aisle
  fillCircle(240, 250, 70, '#8a6a44'); ctx.restore();
  // rag rug under the goods
  rr(168, 230, 184, 28, 5, '#4a2418');
  rr(171, 232, 178, 24, 4, '#7a3f2a');
  for (let k = 0; k < 8; k++) rect(174 + k * 22, 234, 20, 20, k % 2 ? '#a5604a' : '#8a4a32');
  for (let k = 0; k < 8; k++) rect(174 + k * 22, 240, 20, 3, k % 2 ? '#c88a6a' : '#6a3524');
  rect(171, 232, 178, 1, '#b8735a'); rect(171, 255, 178, 1, '#3a1a10');
  ctx.save(); ctx.globalAlpha = 0.25;
  for (let k = 0; k < 20; k++) rect(172 + (k * 29) % 176, 233 + (k * 7) % 22, 2, 1, '#2a1208');
  ctx.restore();
}

// swinging enamel pendant lamp
function shopLamp(lx, ly, drop, warm) {
  const sw = Math.sin(tNow * 0.9 + lx) * 0.06;
  ctx.save(); ctx.translate(lx, ly); ctx.rotate(sw);
  rect(-1, 0, 2, drop, '#1a1208'); rect(-1, 0, 1, drop, '#3a2a18');
  rr(-11, drop, 22, 4, 2, '#0f1a14');
  rr(-10, drop, 20, 3, 2, '#2c7d3a');
  rect(-9, drop, 16, 1, '#63d66a');
  rr(-6, drop + 3, 12, 3, 1, '#e8e0c8');
  rect(-3, drop + 4, 6, 3, '#fff6c8');
  glow(0, drop + 6, 36, '#ffcc6a', (warm ? 0.3 : 0.2) + Math.sin(tNow * 5 + lx) * 0.03);
  glow(0, drop + 20, 62, '#ffcc6a', 0.1);
  ctx.restore();
}

// the main gondola: steel uprights, timber decks, price rail, stocked shelves
function shopRack(gx, gy, gw, gh) {
  const S = SHOPW.steel;
  rr(gx + 3, gy + 4, gw, gh, 2, '#00000066');
  // pegboard back panel
  rect(gx + 6, gy + 2, gw - 12, gh - 4, '#9a8a60');
  rect(gx + 6, gy + 2, gw - 12, 2, '#b8a878');
  rect(gx + 6, gy + gh - 4, gw - 12, 2, '#786a48');
  for (let px = gx + 12; px < gx + gw - 10; px += 8)
    for (let py = gy + 10; py < gy + gh - 6; py += 8) { rect(px, py, 2, 2, '#6a5c3c'); rect(px, py, 2, 1, '#544828'); }
  ctx.save(); ctx.globalAlpha = 0.2; rect(gx + 6, gy + 2, 8, gh - 4, '#ffe8b0'); ctx.restore();
  // uprights
  [gx, gx + gw - 7].forEach(ux => {
    rect(ux, gy, 7, gh, S[2]); rect(ux, gy, 1, gh, S[3]); rect(ux + 1, gy, 1, gh, S[4]);
    rect(ux + 3, gy, 2, gh, S[1]); rect(ux + 6, gy, 1, gh, S[0]);
    for (let sy = gy + 8; sy < gy + gh; sy += 10) { rect(ux + 2, sy, 3, 2, S[0]); rect(ux + 2, sy, 3, 1, S[1]); }
  });
  // timber decks with a yellow price rail
  const deck = (dy) => {
    rect(gx + 6, dy - 2, gw - 12, 2, S[1]);
    rect(gx + 6, dy, gw - 12, 4, '#6a4a2a');
    rect(gx + 6, dy, gw - 12, 1, '#9a6c40');
    rect(gx + 6, dy + 3, gw - 12, 1, '#2e1f10');
    for (let bx = gx + 14; bx < gx + gw - 14; bx += 26) { rect(bx, dy + 4, 3, 4, S[1]); rect(bx, dy + 4, 1, 4, S[3]); }
    rect(gx + 6, dy + 4, gw - 12, 5, '#e8b41c');
    rect(gx + 6, dy + 4, gw - 12, 1, '#ffe38a');
    rect(gx + 6, dy + 8, gw - 12, 1, '#9a7208');
    for (let lx = gx + 12; lx < gx + gw - 16; lx += 19) {
      rect(lx, dy + 5, 13, 3, '#fffaea'); rect(lx, dy + 5, 13, 1, '#ffffff');
      rect(lx + 1, dy + 5, 1, 3, '#b8301c'); rect(lx + 3, dy + 6, 6, 1, '#8a9098');
    }
  };
  deck(gy + 20); deck(gy + 130);
}

// stocked product on the upper shelf: bottles, tins, cartons - each with a label
function shopStock(bx, by, ex) {
  let sx = bx, ki = 0;
  while (sx < ex) {
    const col = STOCK[ki % STOCK.length], dark = mixHex(col, '#000000', 0.42), lite = mixHex(col, '#ffffff', 0.38);
    const kind = ki % 4;
    if (kind === 0) {           // tall bottle
      rr(sx, by - 20, 8, 20, 2, '#101418');
      rr(sx + 1, by - 19, 6, 18, 2, col);
      rect(sx + 1, by - 19, 2, 17, lite); rect(sx + 6, by - 18, 1, 16, dark);
      rect(sx + 2, by - 24, 4, 5, dark); rect(sx + 2, by - 24, 2, 5, col);
      rect(sx + 2, by - 25, 4, 2, '#c8a860'); rect(sx + 2, by - 25, 2, 1, '#f0d898');
      rect(sx + 1, by - 12, 6, 6, '#efe6cc'); rect(sx + 2, by - 11, 4, 1, dark); rect(sx + 2, by - 9, 3, 1, '#8a8270');
    } else if (kind === 1) {    // squat jar
      rr(sx, by - 14, 11, 14, 3, '#101418');
      rr(sx + 1, by - 13, 9, 12, 2, '#cfe3e0');
      rr(sx + 2, by - 9, 7, 7, 2, col); rect(sx + 2, by - 9, 7, 1, lite);
      rect(sx + 1, by - 16, 9, 3, '#7a5a2e'); rect(sx + 1, by - 16, 9, 1, '#a8824a');
      rect(sx + 2, by - 12, 1, 4, '#ffffff77');
    } else if (kind === 2) {    // carton
      rr(sx, by - 18, 12, 18, 1, '#101418');
      rect(sx + 1, by - 17, 10, 16, col);
      rect(sx + 1, by - 17, 10, 2, lite); rect(sx + 10, by - 16, 1, 15, dark);
      rect(sx + 2, by - 13, 8, 6, '#efe6cc');
      rect(sx + 3, by - 12, 6, 1, dark); rect(sx + 3, by - 10, 4, 1, '#8a8270');
      rect(sx + 3, by - 5, 6, 3, dark);
    } else {                    // stacked tins
      for (let t = 0; t < 2; t++) {
        rr(sx, by - 7 - t * 7, 11, 7, 2, '#101418');
        rr(sx + 1, by - 6 - t * 7, 9, 5, 2, t ? lite : col);
        rect(sx + 1, by - 6 - t * 7, 9, 1, '#ffffff66');
        rect(sx + 3, by - 4 - t * 7, 5, 1, dark);
      }
    }
    sx += [11, 14, 15, 14][kind];
    ki++;
  }
}

// the humming drinks cooler
function shopCooler(cx, cy, cw, ch) {
  const S = SHOPW.steel, lit = 0.6 + Math.sin(tNow * 2) * 0.08;
  rr(cx - 2, cy + 3, cw + 4, ch, 3, '#00000077');
  rr(cx, cy, cw, ch, 3, S[0]);
  rr(cx + 1, cy + 1, cw - 2, ch - 2, 2, '#c9d4d8');
  rect(cx + 2, cy + 2, cw - 4, 2, '#f2f8fa'); rect(cx + 2, cy + ch - 5, cw - 4, 3, '#8fa0a8');
  // lit header
  rr(cx + 2, cy + 3, cw - 4, 9, 1, '#123a46');
  rect(cx + 2, cy + 3, cw - 4, 1, '#dff8ff');
  ctx.save(); ctx.globalAlpha = 0.5 + Math.sin(tNow * 9) * 0.05; drawTextC('ICE COLD', cx + cw / 2, cy + 5, '#9fe8ff', 1); ctx.restore();
  const door = (dx, dw) => {
    rr(dx, cy + 14, dw, ch - 22, 2, '#8fa0a8');
    rr(dx + 1, cy + 15, dw - 2, ch - 24, 1, '#0d2b33');
    // shelves of bottles behind the glass
    for (let r = 0; r < 3; r++) {
      const by = cy + 18 + r * ((ch - 30) / 3);
      rect(dx + 2, by + ((ch - 30) / 3) - 3, dw - 4, 2, '#20444e');
      for (let c = 0; c < 3; c++) {
        const bxx = dx + 3 + c * ((dw - 6) / 3), col = STOCK[(r * 3 + c + (dx | 0)) % STOCK.length];
        rr(bxx, by, 5, ((ch - 34) / 3) | 0, 1, mixHex(col, '#000000', 0.3));
        rect(bxx, by, 2, ((ch - 34) / 3) | 0, col);
        rect(bxx, by, 5, 1, '#ffffff55');
        rect(bxx, by + 4, 5, 3, '#efe6cc');
      }
    }
    ctx.save(); ctx.globalAlpha = 0.14; rect(dx + 2, cy + 16, 4, ch - 26, '#dff8ff');
    ctx.globalAlpha = 0.08;
    for (let k = 0; k < 20; k++) rect(dx + 2 + k, cy + 15 + k * 1.4, 3, 1, '#ffffff');
    ctx.restore();
    for (let fy = cy + 17; fy < cy + ch - 12; fy += 5) rect(dx + 2, fy + ((fy / 5) & 1), 1, 1, '#bfeef2'); // frost
    rect(dx + dw - 4, cy + 24, 3, ch - 40, S[3]); rect(dx + dw - 4, cy + 24, 1, ch - 40, S[4]);
  };
  const dw = (cw - 7) / 2; door(cx + 3, dw); door(cx + 4 + dw, dw);
  rect(cx + cw / 2 - 1, cy + 14, 2, ch - 22, '#8fa0a8');
  glow(cx + cw / 2, cy + ch, 48, '#6fd8f0', 0.3 * lit);
  ctx.save(); ctx.globalAlpha = 0.05 * lit; rect(cx - 10, cy, cw + 20, ch + 26, '#6fd8f0'); ctx.restore();
  const vt = tNow % 3;
  if (vt < 1.2) { ctx.save(); ctx.globalAlpha = (1.2 - vt) * 0.25; fillCircle(cx + 9 + vt * 6, cy + ch - 5 - vt * 5, 3 + vt * 2, '#dff8ff'); ctx.restore(); }
}

// fixed clutter that makes it feel like a real shop: a basket stack, a wet
// floor sign, a mirror by the closet, an OPEN sign and a fire extinguisher
function shopExtras() {
  // basket stack by the door
  for (let k = 0; k < 3; k++) { const by = 246 - k * 4; rr(132, by, 34, 12, 2, '#6a1a14'); rr(133, by + 1, 32, 10, 2, '#c8302a'); for (let x = 136; x < 164; x += 4) rect(x, by + 3, 2, 6, '#8a2018'); rect(133, by + 1, 32, 1, '#e86a5a'); }
  rect(140, 232, 18, 2, '#3a3a3a'); rect(139, 230, 2, 4, '#3a3a3a'); rect(157, 230, 2, 4, '#3a3a3a');
  // wet floor sign
  for (let r = 0; r < 22; r++) { const hw = 4 + (r >> 1); rect(454 - hw, 238 + r, hw * 2, 1, r < 2 ? '#1a1a0a' : '#f0c820'); }
  rect(450, 246, 8, 5, '#1a1a0a'); rect(453, 243, 2, 2, '#1a1a0a');
}
// small stock for the bottom shelf: floss boxes, toothpaste tubes, glove boxes
function shopStockSmall(bx, by, ex) {
  let sx = bx, k = 0;
  while (sx < ex - 8) {
    const col = STOCK[(k * 3) % STOCK.length], kind = k % 3;
    if (kind === 0) { rr(sx, by - 10, 9, 10, 1, '#101418'); rect(sx + 1, by - 9, 7, 8, col); rect(sx + 1, by - 9, 7, 2, mixHex(col, '#ffffff', 0.4)); rect(sx + 2, by - 6, 5, 2, '#f4ecd8'); sx += 10; }
    else if (kind === 1) { rr(sx, by - 5, 14, 5, 2, '#101418'); rr(sx + 1, by - 4, 12, 3, 1, '#f0f0ec'); rect(sx + 1, by - 4, 5, 3, col); rect(sx + 12, by - 4, 2, 3, '#c8c8c0'); sx += 15; }
    else { rr(sx, by - 8, 12, 8, 1, '#101418'); rect(sx + 1, by - 7, 10, 6, '#e8e4dc'); rect(sx + 1, by - 7, 10, 2, col); fillCircle(sx + 6, by - 3, 1, col); sx += 13; }
    k++;
  }
}
function drawShop() {
  paintCached('shopRoom', 0, 0, W, H, () => { shopWall(); shopFloor(); shopExtras(); });
  // ---- ceiling lamps over the aisle ----
  shopLamp(170, 0, 12, 1); shopLamp(258, 0, 18, 1); shopLamp(340, 0, 12, 1);
  // light shaft + dust motes drifting through it
  ctx.save(); ctx.globalAlpha = 0.07 + Math.sin(tNow * 3) * 0.008;
  for (let k = 0; k < 8; k++) rect(150 + k * 2, 12, 200 - k * 4, 26 + k * 12, '#ffe6b0');
  ctx.restore();
  ctx.save();
  for (let d = 0; d < 26; d++) {
    const per = 9 + (d % 5) * 3.5, f = ((tNow / per) + d * 0.137) % 1;
    const dx = 150 + ((d * 71) % 200) + Math.sin(tNow * 0.7 + d) * 8;
    ctx.globalAlpha = (0.34 - f * 0.25) * (0.5 + 0.5 * Math.sin(tNow * 3 + d));
    rect(dx, 12 + f * 200, 1, 1, '#fff7d8');
  }
  ctx.restore();

  // ---- hand-painted sign hung on chains over the aisle ----
  rect(240, 8, 2, 12, '#7a6a48'); rect(352, 8, 2, 12, '#7a6a48');
  rect(239, 8, 4, 2, '#9a8a60'); rect(351, 8, 4, 2, '#9a8a60');
  rr(206, 18, 182, 28, 3, '#241708');
  rr(207, 19, 180, 26, 3, '#6a4a2a');
  rr(209, 21, 176, 22, 2, '#5f4228');
  rect(209, 21, 176, 2, '#8a6238'); rect(209, 41, 176, 2, '#3a2818');
  for (let k = 0; k < 6; k++) rect(214 + k * 30, 23, 1, 18, '#00000022');
  drawTextCSh(G.summer ? 'MALDIVES' : 'EVERGLADES', 296, 24, '#ffe6b0', 2);
  drawTextC(G.summer ? 'B E A C H   S H A C K' : 'T R A D I N G   P O S T', 296, 38, '#c8a878', 1);
  [[210, 22], [382, 22], [210, 40], [382, 40]].forEach(([sx, sy]) => { rect(sx, sy, 2, 2, '#c8b060'); rect(sx, sy, 1, 1, '#fff6c8'); });

  // ---- the main gondola of goods ----
  shopRack(134, 44, 220, 140);
  shopStock(146, 64, 344);
  // ---- flickering neon OPEN sign, letters stacked down the wall ----
  (function neon() {
    const on = (tNow % 7) > 0.18 && !((tNow % 7) > 3.1 && (tNow % 7) < 3.2);
    rr(113, 50, 18, 38, 3, '#101010'); rr(114, 51, 16, 36, 2, '#1e0e18');
    rect(118, 44, 1, 6, '#5a5a5a'); rect(125, 44, 1, 6, '#5a5a5a');
    if (on) { ctx.save(); ctx.globalAlpha = 0.22 + Math.sin(tNow * 9) * 0.03; rr(109, 46, 26, 46, 6, '#ff4a8a'); ctx.restore(); }
    'OPEN'.split('').forEach((ch, k) => drawTextC(ch, 122, 54 + k * 8, on ? '#ffd0e4' : '#5a2a40', 1));
  })();

  // ---- the cooler ----
  shopCooler(356, 66, 58, 98);

  // ---- Merle behind his counter (far RIGHT) ----
  const vTalking = (tNow % 6) < 4.2;
  const vMood = ['calm', 'happy', 'think', 'calm', 'proud', 'wow'][Math.floor(tNow / 6) % 6];
  if (G.summer) drawDuckVendor(424, 100); else drawVendor(416, 92, { expr: vMood, talk: vTalking });
  (function counter() {
    const kx = 404, ky = 150, kw = 76, kh = 30, Wd = RAMP.wood, S = SHOPW.steel;
    rr(kx, ky + 3, kw, kh, 2, '#00000077');
    rr(kx, ky, kw, kh, 2, Wd[0]); rr(kx + 1, ky + 1, kw - 2, kh - 3, 2, Wd[2]);
    for (let px = kx + 8; px < kx + kw; px += 13) { rect(px, ky + 4, 1, kh - 7, Wd[1]); rect(px + 1, ky + 4, 1, kh - 7, Wd[3]); }
    ctx.save(); ctx.globalAlpha = 0.18; for (let g = 0; g < 8; g++) rect(kx + 3 + (g * 17) % 68, ky + 6 + (g % 4) * 5, 9, 1, '#2a1a0c'); ctx.restore();
    rect(kx, ky, kw, 4, S[3]); rect(kx, ky, kw, 1, S[4]); rect(kx, ky + 4, kw, 1, S[0]);
    // brass till
    rr(kx + 5, ky + 6, 24, 20, 3, '#241708'); rr(kx + 6, ky + 7, 22, 18, 2, BRS[1]);
    rect(kx + 7, ky + 8, 20, 3, BRS[3]); rect(kx + 7, ky + 8, 12, 1, BRS[4]);
    rect(kx + 11, ky + 13, 12, 9, '#1c2c22'); rect(kx + 12, ky + 14, 10, 7, '#2c5a24');
    rect(kx + 13, ky + 15, 8, 1, '#63d66a');
    rect(kx + 15, ky + 4, 5, 3, BRS[2]); rect(kx + 15, ky + 4, 5, 1, BRS[4]);
    // a jar of gummies and a tip cup
    rr(kx + 34, ky - 12, 14, 14, 3, '#101418'); rr(kx + 35, ky - 11, 12, 12, 2, '#cfe3e0');
    [0, 1, 2, 3].forEach(k => fillCircle(kx + 38 + (k % 2) * 5, ky - 6 + ((k / 2) | 0) * 4, 2, ['#e2486a', '#63d66a', '#ffd54a', '#7fd4e8'][k]));
    rect(kx + 35, ky - 14, 12, 3, '#7a5a2e'); rect(kx + 35, ky - 14, 12, 1, '#a8824a');
    rr(kx + 54, ky - 8, 12, 10, 2, '#3a444c'); rr(kx + 55, ky - 7, 10, 8, 2, '#5a646c');
    rect(kx + 57, ky - 5, 3, 2, C.gold); rect(kx + 61, ky - 4, 3, 2, C.gold);
  })();
  // hanging scale above the counter
  rect(452, 118, 2, 14, '#5a646c');
  rr(444, 132, 18, 10, 2, '#241708'); rr(445, 133, 16, 8, 2, '#c8b060');
  fillCircle(453, 137, 3, '#f4f0dc'); rect(453, 135, 1, 3, '#3a2818');
  rect(447, 142, 12, 2, '#8a7448');

  const vline = VENDOR.lines[Math.floor(tNow / 6) % VENDOR.lines.length];
  if (vTalking) {
    const words = vline.split(' ');
    let l1 = '', l2 = '';
    words.forEach(w2 => { if (textW(l1 + ' ' + w2, 1) < 122 && !l2) l1 = l1 ? l1 + ' ' + w2 : w2; else l2 = (l2 ? l2 + ' ' + w2 : w2); });
    l2 = l2.slice(0, 24);
    const bw = Math.max(textW(l1, 1), textW(l2, 1)) + 14, bh = l2 ? 24 : 16;
    const bx2 = 472 - bw, by2 = 46 + Math.round(Math.sin(tNow * 2) * 1);
    rr(bx2 + 2, by2 + 3, bw, bh, 4, '#00000066');
    rr(bx2, by2, bw, bh, 4, '#8a7a54');
    rr(bx2 + 1, by2 + 1, bw - 2, bh - 2, 3, '#f7f4e6');
    rect(bx2 + 3, by2 + 2, bw - 6, 1, '#ffffff');
    drawText(l1, bx2 + 6, by2 + 4, '#3a2818', 1);
    if (l2) drawText(l2, bx2 + 6, by2 + 13, '#6a5238', 1);
    rect(448, by2 + bh, 6, 3, '#f7f4e6'); rect(450, by2 + bh + 3, 4, 3, '#f7f4e6'); rect(452, by2 + bh + 6, 2, 2, '#f7f4e6');
  }
  hit(414, 92, 64, 80, { id: 'merle', tip: VENDOR.name + '|' + VENDOR.who + "|'" + vline + "'" });

  // =========== GATOR'S CLOSET: the cosmetics boutique (LEFT end-cap) ===========
  drawCosmeticStand(8, 108, 120);

  // ---- money-only HUD: in the shop you only care about your wallet ----
  panel(8, 8, 100, 30, { face: '#26321e', edge: '#5a7a3a' });
  drawText(curLabel(G.money), 18, 16, C.gold, 3);
  drawTextC('YOUR MONEY', 58, 42, '#9ab87a', 1);
  button(8, 52, 100, 16, 'TEETH ' + G.drawPile.length + '/' + G.deck.length, '#3a5560', '#243a44',
    () => { G.deckOpen = !G.deckOpen; }, { id: 'deckbtn', tip: 'YOUR TOOTH DECK|CLICK TO VIEW' });
  drawTopBar(true);

  const bx0 = 148, deckY = 128;
  // middle shelf the goods stand on, with a price rail for the tags
  (function midDeck() {
    const S = SHOPW.steel, gx = 140, gw = 208;
    rect(gx, deckY - 2, gw, 2, S[1]);
    rect(gx, deckY, gw, 4, '#6a4a2a'); rect(gx, deckY, gw, 1, '#9a6c40'); rect(gx, deckY + 3, gw, 1, '#2e1f10');
    rect(gx, deckY + 4, gw, 3, '#e8b41c'); rect(gx, deckY + 4, gw, 1, '#ffe38a'); rect(gx, deckY + 6, gw, 1, '#9a7208');
    ctx.save(); ctx.globalAlpha = 0.25; rect(gx, deckY + 7, gw, 4, '#000'); ctx.restore();
  })();
  shopStockSmall(146, 174, 184); shopStockSmall(332, 174, 346);
  G.shopItems.forEach((it, i) => {
    const x = bx0 + i * 51, y = 82;
    const afford = !it.sold && G.money >= it.price;
    const hovS = mx >= x - 4 && mx < x + 46 && my >= y - 6 && my < deckY + 40;
    // ---- clear acrylic riser the item stands in ----
    ctx.save(); ctx.globalAlpha = 0.35; ctx.scale(1, 0.3); fillCircle(x + 21, (deckY - 1) / 0.3, 16, '#000'); ctx.restore();
    rect(x + 3, deckY - 6, 36, 6, '#cfe8f0'); rect(x + 3, deckY - 6, 36, 1, '#ffffff'); rect(x + 3, deckY - 1, 36, 1, '#7a9aa8');
    ctx.save(); ctx.globalAlpha = 0.28; rect(x + 5, y - 2, 32, deckY - y - 4, '#dff4ff'); ctx.restore();
    rect(x + 5, y - 2, 1, deckY - y - 4, '#ffffff88'); rect(x + 36, y - 2, 1, deckY - y - 4, '#9ab8c888');
    if (hovS) { ctx.save(); ctx.globalAlpha = 0.18 + Math.sin(tNow * 5) * 0.05; rr(x - 2, y - 6, 46, deckY - y + 6, 4, '#ffe6a0'); ctx.restore(); }
    // ---- yellow supermarket shelf tag clipped to the rail ----
    const tgY = deckY + 5, kcol = it.kind === 'tool' ? '#1f8a7a' : it.kind === 'charm' ? '#c86a1a' : '#7a4fc8';
    rr(x - 1, tgY + 1, 44, 34, 1, '#00000055');
    rr(x - 2, tgY, 44, 34, 1, '#8a6a10'); rect(x - 1, tgY + 1, 42, 32, it.sold ? '#d8d0b8' : '#ffe24a');
    rect(x - 1, tgY + 1, 42, 7, kcol);
    drawTextC(it.kind === 'charm' ? 'BADGE' : it.kind === 'tool' ? 'TOOL' : 'CARD', x + 20, tgY + 2, '#ffffff', 1);
    const nl = fitLines(it.def.name, 40);
    if (nl.length > 1) { drawTextC(nl[0], x + 20, tgY + 10, '#2a1a0c', 1); drawTextC(nl[1], x + 20, tgY + 17, '#2a1a0c', 1); }
    else drawTextC(nl[0], x + 20, tgY + 13, '#2a1a0c', 1);
    for (let b = 0; b < 12; b++) rect(x + 1 + b * 1.5, tgY + 27, (b * 7) % 3 ? 1 : 0.5, 5, '#2a1a0c');   // barcode
    if (!it.sold) drawTextSh('$' + it.price, x + 38 - textW('$' + it.price, 1), tgY + 26, afford ? '#d4201a' : '#8a6a5a', 1);
    if (it.sold) {
      ctx.save(); ctx.translate(x + 20, y + 22); ctx.rotate(-0.18);
      rr(-24, -9, 48, 18, 2, '#5a1a12'); rr(-23, -8, 46, 16, 2, '#c8302a');
      rect(-22, -7, 44, 1, '#e86a5a');
      drawTextC('SOLD OUT', 0, -3, '#fff4e0', 1);
      ctx.restore();
      return;
    }
    drawCardAnim(x + 6, deckY - 48, it.def, it.kind, i + 10, {
      id: 'shopitem' + i,
      price: undefined, afford,
      tip: it.def.name + '|CLICK FOR DETAILS',
      click: () => { G.inspect = { kind: 'shop', item: it }; },
    });
    // a spinning SALE starburst on the cheapest thing you can afford
    if (afford && it.price === Math.min.apply(null, G.shopItems.filter(q => !q.sold && G.money >= q.price).map(q => q.price)) && G.shopItems.filter(q => !q.sold).length > 1) {
      const sx2 = x + 4, sy2 = y + 6, spin = tNow * 1.6;
      ctx.save(); ctx.translate(sx2, sy2); ctx.rotate(spin);
      for (let s2 = 0; s2 < 8; s2++) { const a2 = s2 / 8 * Math.PI * 2; rect(Math.cos(a2) * 7 - 1, Math.sin(a2) * 7 - 1, 3, 3, '#ff5a4a'); }
      ctx.restore();
      fillCircle(sx2, sy2, 7, '#ff5a4a'); fillCircle(sx2, sy2 - 1, 6, '#ff8a6a');
      drawTextC('!', sx2, sy2 - 3, '#fff6c8', 1);
    }
  });

  // ---- snack crate: the packs stand in a torn-open display box ----
  (function crate() {
    const cx2 = 180, cy2 = 214, cw2 = 150, chh = 26;
    rr(cx2 - 2, cy2 + 2, cw2 + 4, chh, 2, '#00000066');
    rr(cx2, cy2, cw2, chh, 2, '#3a2412');
    rr(cx2 + 1, cy2 + 1, cw2 - 2, chh - 2, 2, '#7a5230');
    rect(cx2 + 1, cy2 + 1, cw2 - 2, 2, '#9a6a3e');
    for (let k = 0; k * 22 < cw2; k++) rect(cx2 + 4 + k * 22, cy2 + 3, 1, chh - 6, '#5a3a1e');
    rect(cx2 + 4, cy2 + 15, cw2 - 8, 9, '#e8dfc2');
    rect(cx2 + 4, cy2 + 15, cw2 - 8, 1, '#ffffff');
    drawTextC('SNACK STAND', cx2 + cw2 / 2, cy2 + 17, '#8a2a16', 1);
    ctx.save(); ctx.globalAlpha = 0.2;
    for (let k = 0; k < 12; k++) rect(cx2 + 6 + (k * 29) % (cw2 - 12), cy2 + 4 + (k % 3) * 8, 8, 1, '#2a1a0c');
    ctx.restore();
  })();
  // packs shelf
  G.shopPacks.forEach((p, i) => {
    const x = 186 + i * 78, y = 172;
    const hov = mx >= x && mx < x + 64 && my >= y - 4 && my < y + 44;
    const yy = y + (hov ? -4 : Math.round(Math.sin(tNow * 1.6 + i * 2) * 1.5));
    if (p.sold) { panel(x, y, 64, 40, { face: '#141c22' }); drawTextC('OPENED', x + 32, y + 17, C.dim, 1); return; }
    ctx.save(); ctx.globalAlpha = 0.35; ctx.scale(1, 0.25);
    fillCircle(x + 32, (y + 46) / 0.25, 26, '#000'); ctx.restore();
    ctx.save();
    ctx.translate(x + 32, yy + 44); ctx.rotate(Math.sin(tNow * 1.3 + i) * 0.022 + (hov ? Math.sin(tNow * 9) * 0.03 : 0));
    ctx.translate(-(x + 32), -(yy + 44));
    drawPackArt(x, yy, 64, 44, p.def);
    ctx.restore();
    const afford = G.money >= p.price;
    rr(x + 20, yy + 44, 24, 10, 2, '#241708');
    rr(x + 20, yy + 44, 23, 9, 2, afford ? '#f0d48a' : '#b8a898');
    drawTextC('$' + p.price, x + 32, yy + 46, afford ? '#4a3208' : '#6a2a2a', 1);
    hit(x, y - 2, 64, 44, { // clears the NEXT button below
      cb: () => buyPack(p), id: 'pack' + p.kind, cursor: true,
      tip: p.def.name + '|' + (p.kind === 'tooth' ? 'SHOWS ' + p.def.show + ' TEETH, PICK ' + p.def.picks : 'SHOWS ' + p.def.show + ' TOOLS, PICK ' + p.def.picks) + "|'" + p.def.flav + "'",
    });
  });

  drawBarrel();
  button(8, 72, 100, 14, 'II PAUSE', '#243a44', '#16262c', () => { togglePause(); }, { id: 'pausebtn' });
  button(348, 186, 86, 20, G.rerollCost === 0 ? 'REROLL FREE' : 'REROLL $' + G.rerollCost, '#7a4fd0', '#4a2a8a', reroll,
    { id: 'reroll', disabled: G.money < G.rerollCost, tip: 'REROLL|Refresh the 4 shop items|(packs stay)' });
  const nextName = G.map && G.map.stage >= 3 ? 'NEXT ANTE' : 'BACK TO TRAIL';
  button(316, 226, 130, 26, nextName + ' >', '#d94f30', '#8a2a16', () => startTransition(afterShop), { id: 'next', sc: 1, tip: 'Back to the swamp trail' });

  // ---- walk-in: saloon doors swing apart as you step inside ----
  const doorT = clamp((tNow - G.shopEnter) / 0.6, 0, 1);
  if (doorT < 1) {
    const k = easeOut(doorT);
    const drawDoor = (x0, flip) => {
      ctx.save(); ctx.translate(x0, 0);
      rr(0, 0, 242, H, 0, '#3a2818');
      for (let y = 0; y < H; y += 14) rect(0, y + 13, 242, 1, '#241708');
      for (let x = 24; x < 242; x += 48) rect(x, 0, 2, H, '#2e1f12');
      rr(flip ? 14 : 210, 118, 18, 34, 4, '#c8b060'); // handle
      rect(flip ? 20 : 216, 126, 6, 18, '#8a7048');
      ctx.restore();
    };
    drawDoor(-2 - k * 244, false);
    drawDoor(240 + k * 244, true);
    ctx.save(); ctx.globalAlpha = (1 - doorT) * 0.5; rect(0, 0, W, H, '#160e08'); ctx.restore();
    hit(0, 0, W, H, { id: 'doorblock', cb: () => { } }); // no shopping through the doors
  }
}

// ======================= SNACK-STAND PACKAGING ============================
//  Every product gets real packaging: crimped foil edges, a printed brand
//  band, a holo strip that catches the light, a mascot and a serrated tear
//  strip along the top.  `o.tear` (0..1) peels that strip off for the opening
//  animation, so the shelf art and the rip animation are the same sprite.
// ==========================================================================
const PACKPAL = {
  gummies: { a: '#c9556a', b: '#7a2338', c: '#f08fa2', d: '#ffd54a', ink: '#4a1220', holo: ['#ff8fb0', '#ffd0dc', '#b06a8a'] },
  chomppops: { a: '#e8a020', b: '#8a5408', c: '#ffcf6a', d: '#63d66a', ink: '#4a2c04', holo: ['#ffd88a', '#fff2c8', '#c08a20'] },
  sundae: { a: '#4fb3c8', b: '#1d5a68', c: '#9fe4f0', d: '#ff8fb0', ink: '#0d3540', holo: ['#9fe8ff', '#e8fbff', '#5f9ab0'] },
  tacklebox: { a: '#3a9a8a', b: '#175048', c: '#7fd4c4', d: '#ffd54a', ink: '#0c2e2a', holo: ['#8fe8d8', '#e0fff8', '#4a8a80'] },
  toolbelt: { a: '#8a6510', b: '#4a3406', c: '#d0a03a', d: '#e8e0c8', ink: '#2e1f04', holo: ['#e8c46a', '#fff2c8', '#a07820'] },
};

// a grinning tooth mascot - the face of the whole snack range
function packMascot(x, y, s, wink) {
  const w = 10 * s, h = 12 * s;
  rr(x, y, w, h - 3 * s, 3 * s, '#c8bfa0');
  rr(x + s, y + s, w - 2 * s, h - 5 * s, 2 * s, '#fdfaf0');
  rect(x + s, y + s, w - 5 * s, 2 * s, '#ffffff');
  rect(x, y + h - 5 * s, 4 * s, 5 * s, '#c8bfa0'); rect(x + w - 4 * s, y + h - 5 * s, 4 * s, 5 * s, '#c8bfa0');
  rect(x + s, y + h - 5 * s, 2 * s, 3 * s, '#efe8d2'); rect(x + w - 3 * s, y + h - 5 * s, 2 * s, 3 * s, '#efe8d2');
  // face
  if (wink) { rect(x + 2 * s, y + 4 * s, 2 * s, s, '#20140c'); }
  else { rect(x + 2 * s, y + 3 * s, 2 * s, 2 * s, '#20140c'); rect(x + 2 * s, y + 3 * s, s, s, '#ffffff'); }
  rect(x + 6 * s, y + 3 * s, 2 * s, 2 * s, '#20140c'); rect(x + 6 * s, y + 3 * s, s, s, '#ffffff');
  rect(x + 3 * s, y + 7 * s, 5 * s, s, '#20140c');
  rect(x + 4 * s, y + 8 * s, 3 * s, s, '#d2607e');
  ctx.save(); ctx.globalAlpha = 0.45;
  rect(x + s, y + 6 * s, 2 * s, s, '#ef7f94'); rect(x + 7 * s, y + 6 * s, 2 * s, s, '#ef7f94');
  ctx.restore();
}

function drawPackArt(x, y, w, h, def, o) {
  o = o || {};
  x |= 0; y |= 0; w |= 0; h |= 0;
  const P = PACKPAL[def.id] || PACKPAL.gummies;
  const tear = clamp(o.tear || 0, 0, 1);
  const s = w >= 100 ? 2 : 1;                       // 1x on the shelf, 2x when held
  const stripH = 4 * s + 2;                          // the tear-off strip at the top
  const bodyY = y + stripH;
  const crimp = (cy, flip) => {                      // serrated foil crimp
    for (let k = 0; k * 5 < w; k++) {
      rect(x + k * 5, cy, 3, 3, P.b);
      rect(x + k * 5, cy + (flip ? 0 : 1), 3, 1, P.c);
    }
  };

  // ---------------- body ----------------
  rr(x, bodyY, w, y + h - bodyY, 2, P.b);
  rr(x + 1, bodyY + 1, w - 2, y + h - bodyY - 2, 2, P.a);
  ctx.save(); ctx.globalAlpha = 0.5; rect(x + 1, bodyY + 1, w - 2, Math.round(h * 0.28), P.c); ctx.restore();
  rect(x + 1, y + h - 4, w - 2, 3, P.b);
  crimp(y + h - 4, 1);
  // vertical foil creases
  ctx.save(); ctx.globalAlpha = 0.14;
  for (let k = 1; k * 9 < w; k++) rect(x + k * 9, bodyY + 2, 1, y + h - bodyY - 5, '#000000');
  for (let k = 1; k * 9 < w; k++) rect(x + k * 9 + 1, bodyY + 2, 1, y + h - bodyY - 5, '#ffffff');
  ctx.restore();

  // ---------------- holo band that catches the light ----------------
  const hy = bodyY + Math.round(h * 0.1), hh = Math.max(11, Math.round(h * 0.26));
  rect(x + 2, hy - 1, w - 4, hh + 2, P.ink);
  ctx.save();
  ctx.beginPath(); ctx.rect(x + 2, hy, w - 4, hh); ctx.clip();
  const HOLO = [P.holo[0], P.holo[1], '#ffffff', P.holo[1], P.holo[0], P.holo[2], P.a, P.holo[2]];
  for (let k = 0; k < w; k += 2) {
    const f = ((k / 15) + tNow * 0.3) % 1;
    rect(x + 2 + k, hy, 2, hh, HOLO[(f * HOLO.length) | 0]);
  }
  ctx.globalAlpha = 0.22; rect(x + 2, hy, w - 4, Math.ceil(hh / 2), '#ffffff');
  ctx.globalAlpha = 0.25; rect(x + 2, hy + hh - 3, w - 4, 3, '#000000');
  ctx.restore();
  rect(x + 2, hy, w - 4, 1, '#ffffffcc'); rect(x + 2, hy + hh - 1, w - 4, 1, '#00000077');

  // ---------------- brand wordmark, auto-fitted ----------------
  const brand = def.brand || def.name.split(' ')[0];
  let bs = s > 1 ? 3 : 1;
  while (bs > 1 && textW(brand, bs) > w - 14) bs--;
  drawTextCSh(brand, x + w / 2, hy + Math.round((hh - 5 * bs) / 2), '#ffffff', bs, P.ink);
  let sub = def.sub || def.name.split(' ').slice(1).join(' ');
  while (sub && textW(sub, 1) > w - 12) sub = sub.slice(0, -1);
  if (sub) {
    const sy2 = hy + hh + 2;
    rr(x + 4, sy2, w - 8, 9, 1, P.ink);
    drawTextC(sub, x + w / 2, sy2 + 2, P.d, 1);
  }

  // ---------------- product motif ----------------
  const my2 = hy + hh + (sub ? 11 : 3);
  if (def.id === 'tacklebox') {
    // a blister window with the tools on show
    const bw = Math.round(w * 0.42), bx = x + Math.round(w * 0.32), by2 = my2 + s;
    rr(bx - 1, by2 - 1, bw + 2, 14 * s + 2, 2, P.ink);
    rr(bx, by2, bw, 14 * s, 2, '#0d1c20');
    ctx.save(); ctx.globalAlpha = 0.3; rect(bx + 1, by2 + 1, bw - 2, 4 * s, '#bfeef2'); ctx.restore();
    ['tpliers', 'tdrill'].forEach((k, i) => {
      ctx.save(); ctx.translate(bx + 2 + i * (bw / 2 - 1), by2 + 1); ctx.scale(0.6 * s, 0.6 * s);
      (TOOLART[k])(0, 0); ctx.restore();
    });
    ctx.save(); ctx.globalAlpha = 0.2;
    for (let k = 0; k * 6 < bw; k++) rect(bx + k * 6, by2, 2, 14 * s, '#ffffff'); ctx.restore();
    // the 101 roundel
    const rx = x + 9 * s + 2, ry = my2 + 8 * s;
    fillCircle(rx, ry, 9 * s, P.ink);
    fillCircle(rx, ry, 8 * s, P.d);
    fillCircle(rx, ry, 6 * s, '#fff6c8');
    drawTextC('101', rx, ry - 3 * s, P.ink, s);
    if (s > 1) drawTextC('KIT', rx, ry + 5, P.b, 1);
  } else if (def.id === 'toolbelt') {
    ctx.save(); ctx.globalAlpha = 0.25;
    for (let k = 0; k < 14; k++) rect(x + 3 + (k * 13) % (w - 6), bodyY + 3 + (k * 7) % (h - 14), 2, 1, '#2e1f04');
    ctx.restore();
    for (let k = 0; k * 11 < w - 8; k++) { rect(x + 5 + k * 11, y + h - 9, 3, 3, '#c8a860'); rect(x + 5 + k * 11, y + h - 9, 2, 2, '#fff2c8'); }
    ctx.save(); ctx.translate(x + Math.round(w * 0.42), my2); ctx.scale(0.7 * s, 0.7 * s); TOOLART.troot(0, 0); ctx.restore();
    packMascot(x + 4 * s, my2, s, 1);
  } else {
    packMascot(x + 4 * s, my2, s, def.id === 'gummies' ? 1 : 0);
    if (def.id === 'gummies') {           // scattered gummy teeth
      [[0.26, 0.2], [0.3, 0.62], [0.22, 0.86], [0.34, 0.4]].forEach(([fx, fy], i) => {
        const gx = x + fx * w, gy2 = my2 + fy * (y + h - my2 - 4);
        rr(gx, gy2, 4 * s, 4 * s, s, ['#ff8fb0', '#63d66a', '#ffd54a', '#8fd8ff'][i]);
        rect(gx, gy2, 2 * s, s, '#ffffffaa');
      });
      const bump = 1 + Math.sin(tNow * 4) * 0.06;
      ctx.save(); ctx.translate(x + Math.round(w * 0.5) + 4 * s, my2 + 8 * s); ctx.scale(bump, bump);
      for (let k = 0; k < 10; k++) { const a = k / 10 * 6.283; rect(Math.cos(a) * 8 * s - s, Math.sin(a) * 8 * s - s, 2 * s, 2 * s, '#ffd54a'); }
      fillCircle(0, 0, 7 * s, '#ffd54a'); fillCircle(0, -s, 6 * s, '#fff2c8');
      drawTextC('CHEWY', 0, -2 * s, '#c9556a', s > 1 ? 1 : 1);
      ctx.restore();
    } else if (def.id === 'chomppops') { // lolly on a stick with a bite taken out
      const lx = x + Math.round(w * 0.52), ly = my2 + 6 * s;
      rect(lx - s, ly + 5 * s, 2 * s, 8 * s, '#e8dcc0');
      fillCircle(lx, ly, 7 * s, '#8a5408'); fillCircle(lx, ly, 6 * s, '#ff6a4a');
      ctx.save();
      for (let k = 0; k < 8; k++) { const a = k / 8 * 6.283 + tNow; rect(lx + Math.cos(a) * 3 * s, ly + Math.sin(a) * 3 * s, 2 * s, 2 * s, k % 2 ? '#ffd54a' : '#ff6a4a'); }
      ctx.restore();
      fillCircle(lx + 5 * s, ly - 3 * s, 4 * s, P.a);   // bite mark
    } else if (def.id === 'sundae') {
      const gx = x + Math.round(w * 0.48), gy2 = my2 + 3 * s;
      rect(gx, gy2 + 4 * s, 11 * s, 2 * s, '#cfe8f0');
      rect(gx + s, gy2 + 6 * s, 9 * s, 6 * s, '#efe0c8');
      rect(gx + 4 * s, gy2 + 12 * s, 3 * s, 3 * s, '#cfe8f0');
      fillCircle(gx + 4 * s, gy2 + 2 * s, 4 * s, '#f8e8d0'); fillCircle(gx + 8 * s, gy2 + 3 * s, 3 * s, '#c07a4a');
      fillCircle(gx + 5 * s, gy2 - 2 * s, 2 * s, '#e2486a'); rect(gx + 5 * s, gy2 - 5 * s, s, 3 * s, '#5f8440');
    }
  }

  // ---------------- PICK N starburst ----------------
  const br = s > 1 ? 16 : 7;
  const bx2 = x + w - br - 2, by3 = y + h - br - 3;
  ctx.save(); ctx.translate(bx2, by3); ctx.rotate(Math.sin(tNow * 2) * 0.08);
  for (let k = 0; k < 10; k++) { const a = k / 10 * 6.283; rect(Math.cos(a) * (br + 1) - 1, Math.sin(a) * (br + 1) - 1, 2 * s, 2 * s, '#ffe089'); }
  fillCircle(0, 0, br, '#ffe089'); fillCircle(0, 0, br - 1, '#d94f30');
  drawTextC('' + def.picks, 0, s > 1 ? -6 : -3, '#fff', s);
  if (s > 1) drawTextC('PICK', 0, 2, '#ffd0c0', 1);
  ctx.restore();

  // ---------------- tear strip along the top ----------------
  const peel = tear * (w + 30);
  ctx.save();
  if (tear > 0) {
    ctx.translate(peel, -tear * 6);
    ctx.rotate(tear * 0.22);
    ctx.globalAlpha = 1 - tear * 0.25;
  }
  rr(x, y, w, stripH + 2, 2, P.b);
  rr(x + 1, y + 1, w - 2, stripH, 2, mixHex(P.a, '#ffffff', 0.18));
  crimp(y, 0);
  ctx.save(); ctx.globalAlpha = 0.35;
  for (let k = 0; k * 4 < w; k++) rect(x + 2 + k * 4, y + stripH - 1, 2, 1, P.ink);
  ctx.restore();
  if (s > 1) drawTextC('TEAR HERE >>', x + w / 2, y + 2, P.ink, 1);
  // the grab notch
  rect(x + 2, y, 3, stripH + 2, P.ink);
  rect(x + w - 5, y, 3, stripH + 2, P.ink);
  ctx.restore();

  // torn edge + light spilling out of the gap
  if (tear > 0) {
    ctx.save();
    ctx.beginPath(); ctx.rect(x, bodyY - 3, w, 6); ctx.clip();
    for (let k = 0; k * 3 < w; k++) {
      const jag = ((k * 7919) % 5) - 2;
      rect(x + k * 3, bodyY - 3 + jag, 3, 4, P.ink);
      rect(x + k * 3, bodyY - 2 + jag, 3, 1, mixHex(P.a, '#ffffff', 0.5));
    }
    ctx.restore();
    ctx.save(); ctx.globalAlpha = tear * 0.7;
    rect(x + 2, bodyY - 2, w - 4, 3, '#fff6c8');
    ctx.globalAlpha = tear * 0.22; rect(x - 4, bodyY - 10, w + 8, 12, '#fff6c8');
    ctx.restore();
  }

  // ---------------- overall foil shine ----------------
  if (!o.noShine) {
    ctx.save(); ctx.globalAlpha = 0.12;
    const sw2 = ((tNow * 0.6 + (def.id || '').length) % 3);
    if (sw2 < 1) { const gx2 = x - 20 + sw2 * (w + 40); for (let k = 0; k < h; k += 1) rect(gx2 + k * 0.5, y + k, 7, 1, '#ffffff'); }
    ctx.restore();
  }
}

// ------------------------------------------------------ pack opening ------
//  Two beats, like tearing into a real card pack:
//   1. the sealed pack floats centre-screen.  You GRAB the tear strip and DRAG
//      it across - the foil peels, shreds fly and light spills from the gap.
//   2. the strip rips free in a burst and the contents launch out of the mouth
//      and fan into a row you pick from.
function packRip(p) {
  p.ripped = true; p.ripT = 0; p.tear = 1;
  shake = Math.max(shake, 7);
  sfx.sweep(); sfx.buy();
  const cx = W / 2, cy = 96;
  fxRing(cx, cy, '#fff6c8', 6, 120, 0.5);
  fxRing(cx, cy, (PACKPAL[p.product.id] || PACKPAL.gummies).a, 4, 86, 0.42);
  fxStars(cx, cy, '#ffe089', 16, 150);
  fxConfetti(cx, cy, 34);
  fxLines(cx, cy, '#ffffff88', 10, 200);
  // foil shreds
  const P = PACKPAL[p.product.id] || PACKPAL.gummies;
  for (let k = 0; k < 18; k++) {
    parts.push({
      x: cx + (rnd() - 0.5) * 130, y: cy - 22, vx: (rnd() - 0.5) * 190, vy: -60 - rnd() * 130,
      life: 0.9 + rnd() * 0.5, t: 0, col: [P.a, P.b, P.c, P.holo[0]][k % 4], g: 320, kind: 'ribbon', sz: 3,
    });
  }
}

function drawPackOpen(dt) {
  const p = G.pack; if (!p) return;
  p.t += dt;
  if (p.tear === undefined) { p.tear = 0; p.ripped = false; p.ripT = 0; }
  const P = PACKPAL[p.product.id] || PACKPAL.gummies;
  overlayDim(0.88);
  hit(0, 0, W, H, { cb: () => { }, id: 'packblock' });

  // ---- rotating light bloom behind the whole thing ----
  ctx.save();
  ctx.globalAlpha = (p.ripped ? 0.075 : 0.05) + Math.sin(tNow * 2) * 0.012;
  ctx.translate(W / 2, 96);
  for (let k = 0; k < 10; k++) {
    const a = k / 10 * 6.283 + tNow * 0.3;
    ctx.save(); ctx.rotate(a); rect(0, -4, 250, 8, P.holo[1]); ctx.restore();
  }
  ctx.restore();
  ctx.save(); ctx.globalAlpha = 0.14; fillCircle(W / 2, 96, 90, P.a); ctx.restore();

  // ============================ BEAT 1: the rip =============================
  if (!p.ripped) {
    const PW = 150, PH = 116;
    const px = Math.round((W - PW) / 2), py = Math.round(56 + Math.sin(tNow * 1.5) * 2);
    // drag from the tear strip peels the foil
    const holding = down && down.hit && down.hit.id === 'packtear';
    if (holding) {
      p.tear = clamp((mx - down.x) / (PW * 0.7), 0, 1);
      if (p.tear >= 1) { packRip(p); return; }
    } else if (p.tear > 0) p.tear = Math.max(0, p.tear - dt * 2.2);

    // pack shadow + a slight tilt into the pull
    ctx.save();
    ctx.translate(px + PW / 2, py + PH / 2);
    ctx.rotate(p.tear * 0.05 + Math.sin(tNow * 1.1) * 0.012);
    ctx.translate(-(px + PW / 2), -(py + PH / 2));
    ctx.save(); ctx.globalAlpha = 0.45; rr(px + 4, py + 8, PW, PH, 4, '#000'); ctx.restore();
    drawPackArt(px, py, PW, PH, p.product, { tear: p.tear });
    ctx.restore();

    // ---- title + flavour ----
    drawTextCSh(p.product.name, W / 2, 16, C.gold, 2);
    drawTextCSh("'" + p.product.flav + "'", W / 2, 36, '#8fa8b0', 1);

    // ---- drag prompt: a hand that swipes across the strip ----
    const pulse = 0.55 + Math.sin(tNow * 4) * 0.45;
    if (p.tear < 0.9) {
      const hx = px + 18 + ((tNow * 46) % (PW - 44)) * (1 - p.tear * 0.6);
      ctx.save(); ctx.globalAlpha = 0.35 + pulse * 0.4;
      for (let k = 0; k < 5; k++) rect(px + 14 + k * 8, py + 2, 5, 2, '#ffffff');
      ctx.restore();
      // pointing mitt
      ctx.save(); ctx.globalAlpha = 0.9;
      rr(hx - 5, py - 12, 11, 10, 4, '#20140c'); rr(hx - 4, py - 11, 9, 8, 3, '#f0c9a0');
      rect(hx - 1, py - 16, 3, 6, '#20140c'); rect(hx - 1, py - 15, 2, 5, '#f0c9a0');
      ctx.restore();
      // arrow
      ctx.save(); ctx.globalAlpha = pulse;
      const ax = px + PW - 26 + Math.sin(tNow * 5) * 3;
      rect(ax - 16, py + 2, 16, 3, '#ffe089');
      rect(ax, py - 1, 3, 3, '#ffe089'); rect(ax + 2, py + 1, 3, 3, '#ffe089'); rect(ax, py + 4, 3, 3, '#ffe089');
      ctx.restore();
      drawTextCSh(p.tear > 0.05 ? 'KEEP PULLING!' : 'DRAG THE STRIP TO OPEN', W / 2, py + PH + 12, p.tear > 0.05 ? C.gold : '#a8c0c8', 1);
    }
    // tension meter under the pack
    if (p.tear > 0.02) {
      const mw = 120, mx2 = W / 2 - mw / 2, my2 = py + PH + 24;
      rr(mx2 - 2, my2 - 2, mw + 4, 10, 2, '#0d1418');
      rr(mx2, my2, mw, 6, 2, '#243038');
      rr(mx2, my2, Math.round(mw * p.tear), 6, 2, p.tear > 0.8 ? '#ff6a4a' : P.holo[0]);
      rect(mx2, my2, Math.round(mw * p.tear), 1, '#ffffff88');
    }
    hit(px, py - 10, PW, 24, { id: 'packtear', click: () => { }, cursor: true, tip: 'GRAB AND DRAG TO RIP IT OPEN' });
    // a mercy button for anyone who would rather just tap
    if (p.t > 3.5) button(W / 2 - 46, 232, 92, 18, 'JUST RIP IT', '#d94f30', '#8a2a16', () => packRip(p), { id: 'packrip' });
    return;
  }

  // ========================= BEAT 2: the reveal =============================
  p.ripT += dt;
  const rt = p.ripT;
  // the emptied wrapper drops to the bottom of the screen
  const wy = 176 + Math.min(34, rt * 120);
  ctx.save(); ctx.globalAlpha = 0.8;
  drawPackArt(W / 2 - 34, wy, 68, 56, p.product, { tear: 1, noShine: 1 });
  ctx.restore();
  // white flash on the first frames
  if (rt < 0.28) { ctx.save(); ctx.globalAlpha = (1 - rt / 0.28) * 0.85; rect(0, 0, W, H, '#fffaf0'); ctx.restore(); }

  drawTextCSh(p.product.name, W / 2, 14, C.gold, 2);
  drawTextCSh(p.picksLeft > 1 ? 'PICK ' + p.picksLeft : 'PICK ONE', W / 2, 34, C.white, 1);

  const n = p.options.length;
  const spacing = n > 4 ? 66 : 70;
  p.options.forEach((o, i) => {
    const tx = W / 2 - (n * spacing - 14) / 2 + i * spacing;
    if (o.taken) {
      panel(tx - 2, 88, 60, 30, { face: '#141c22' });
      drawTextC('TAKEN', tx + 26, 99, C.green, 1);
      return;
    }
    // launch out of the pack mouth, then settle into the row
    const appear = clamp((rt - 0.12 - i * 0.11) * 2.6, 0, 1);
    if (appear <= 0) return;
    const e = easeOut(appear);
    const x = lerp(W / 2 - 14, tx, e);
    const y = lerp(112, 74, e) - Math.sin(appear * Math.PI) * 26;
    const spin = (1 - e) * (i % 2 ? 0.9 : -0.9);
    const hov = appear >= 1 && mx >= x - 4 && mx < x + 60 && my >= y - 6 && my < y + 112;
    const yy = y + (hov ? -5 : Math.round(Math.sin(tNow * 2 + i) * 1.5));

    ctx.save();
    ctx.translate(x + 28, yy + 54); ctx.rotate(spin);
    const sc2 = 0.5 + e * 0.5; ctx.scale(sc2, sc2);
    ctx.translate(-(x + 28), -(yy + 54));
    if (appear < 0.55) {                       // face-down until it lands
      rr(x, yy + 10, 56, 76, 3, '#2a3a44');
      rr(x + 4, yy + 14, 48, 68, 3, '#1c2830');
      for (let k = 0; k < 4; k++) rect(x + 8, yy + 20 + k * 16, 40, 2, '#26333c');
      drawTextC('?', x + 28, yy + 40, '#41565e', 3);
      ctx.restore();
      return;
    }
    if (hov) { ctx.save(); ctx.globalAlpha = 0.3 + Math.sin(tNow * 8) * 0.12; rr(x - 6, yy - 6, 68, 120, 5, '#ffe8a0'); ctx.restore(); }
    panel(x - 2, yy - 2, 60, 112, { face: '#1a2530f0', edge: hov ? C.gold : '#3a5a50' });
    if (o.tooth) {
      const td = TOOTH_DEFS[o.tooth];
      ctx.save(); ctx.globalAlpha = 0.18; fillCircle(x + 28, yy + 24, 20, '#9fe8ff'); ctx.restore();
      drawTooth(x + 16, yy + 8, 24, 32, true, o.tooth, {});
      drawTextC(td.name.replace(' TOOTH', '').replace(' FANG', ''), x + 28, yy + 48, C.white, 1);
      drawSmallWrapped(td.desc, x + 3, yy + 58, 54, C.dim);
    } else {
      drawCardFace(x + 13, yy + 6, o.tool, 'tool', {});
      drawTextC(o.tool.name.split(' ')[0], x + 28, yy + 54, C.white, 1);
      drawSmallWrapped(o.tool.desc, x + 3, yy + 64, 54, C.dim);
    }
    ctx.restore();
    if (appear >= 1) {
      hit(x - 2, y - 4, 60, 116, {
        cb: () => pickPack(i), id: 'packopt' + i, cursor: true,
        tip: o.tooth ? TOOTH_DEFS[o.tooth].name + '|' + TOOTH_DEFS[o.tooth].desc : o.tool.name + '|' + o.tool.desc,
      });
    }
  });
  drawTextC('CHOOSE WISELY, RANGER', W / 2, 214, '#54707a', 1);
  if (p.picksLeft > 0 && p.options.some(o => o.taken)) {
    button(W / 2 - 40, 228, 80, 16, 'SKIP REST', '#3a5560', '#243a44', () => { G.pack = null; }, { id: 'packskip' });
  }
}

// -------------------------------------------------- the dentist bench -----
function drawBench() {
  const b = G.bench; if (!b) return;
  // dentist office backdrop
  ['#1e3634', '#22403c', '#264a44'].forEach((c, i) => rect(0, i * 60, W, 60, c));
  rect(0, 180, W, H - 180, '#16282a');
  rect(0, 178, W, 3, '#0e1c1e');
  // framed molar poster
  panel(28, 26, 54, 66, { face: '#e8e4d4', edge: '#8a7a58' });
  ICONS.tooth(48, 40, '#b1a078');
  drawTextC('MOLARS', 55, 62, '#8a7a58', 1);
  // lamp arm + light cone
  rect(380, 0, 6, 34, '#3a4a4c');
  rr(368, 32, 30, 12, 3, '#4c5e60');
  rect(372, 42, 22, 3, '#ffe089');
  ctx.globalAlpha = 0.08;
  for (let k = 0; k < 5; k++) rect(340 - k * 8, 46 + k * 24, 110 + k * 18, 24, '#ffe8a0');
  ctx.globalAlpha = 1;
  // instrument tray
  panel(20, 206, 84, 40, { face: '#4c5e60', edge: '#6a8082' });
  ICONS.tpliers(28, 216); ICONS.tdrill(52, 216); ICONS.tvial(76, 216);

  drawTextCSh('THE DENTIST BENCH', W / 2, 8, C.gold, 2);
  drawTextCSh(b.def.name + ':  ' + b.def.desc, W / 2, 26, C.white, 1);
  drawTextCSh('SELECTED ' + b.sel.length + ' / ' + b.def.picks, W / 2, 38, b.sel.length ? C.green : C.dim, 1);

  // the fake mouth: two pink gum bands on a stand
  const mxx = 150, mwx = 220;
  rr(mxx - 14, 62, mwx + 28, 148, 6, '#2a1a20');
  rr(mxx - 10, 66, mwx + 20, 140, 6, '#3a2028');
  rr(mxx, 74, mwx, 16, 5, '#c9556a'); // upper gum
  rr(mxx, 182, mwx, 16, 5, '#c9556a'); // lower gum
  rect(mxx + 4, 76, mwx - 8, 4, '#e0778a');
  rect(mxx + 4, 194, mwx - 8, 4, '#a03a4a');

  // deck teeth, paged: 7 top hang down, 7 bottom stand up
  const perPage = 14;
  const pages = Math.max(1, Math.ceil(G.deck.length / perPage));
  b.page = clamp(b.page, 0, pages - 1);
  const slice = G.deck.slice(b.page * perPage, b.page * perPage + perPage);
  slice.forEach((t, i) => {
    const top = i < 7;
    const k = top ? i : i - 7;
    const tx = mxx + 10 + k * 29, tw = 24, th2 = 30;
    const sel = b.sel.includes(t.id);
    const hov = mx >= tx && mx < tx + tw && my >= (top ? 90 : 150) && my < (top ? 132 : 194);
    let ty = top ? 90 : 152;
    if (sel) ty += top ? 6 : -6;
    else if (hov) ty += top ? 3 : -3;
    let txx = tx;
    if (G.benchFx && sel) { txx += ri(-1, 1); ty += ri(-1, 1); }
    drawTooth(txx, ty, tw, th2, !top, t.type, { outline: sel ? C.gold : hov ? '#ffe8a0' : '#00000055' });
    drawTextC(t.base, txx + tw / 2, top ? ty + th2 - 8 : ty + 2, sel ? C.goldD : '#6d5c3a', 1);
    hit(tx - 1, top ? 88 : 148, tw + 2, 46, {
      cb: () => benchToggle(t.id), id: 'bt' + t.id, cursor: true,
      tip: TOOTH_DEFS[t.type].name + '|VALUE: ' + t.base + (sel ? '|SELECTED' : '|CLICK TO SELECT'),
    });
  });
  if (pages > 1) {
    button(mxx - 34, 128, 22, 20, '<', '#3a5560', '#243a44', () => { b.page = (b.page - 1 + pages) % pages; }, { id: 'bpl' });
    button(mxx + mwx + 12, 128, 22, 20, '>', '#3a5560', '#243a44', () => { b.page = (b.page + 1) % pages; }, { id: 'bpr' });
    drawTextC('PAGE ' + (b.page + 1) + '/' + pages, W / 2, 214, C.dim, 1);
  }

  button(W / 2 - 96, 232, 92, 24, G.benchFx ? 'WORKING...' : 'APPLY', '#e8a020', '#98650e', benchApply,
    { id: 'bapply', disabled: !b.sel.length || !!G.benchFx, tip: b.sel.length ? 'Do the dental work!' : 'Select teeth first' });
  button(W / 2 + 8, 232, 92, 24, 'CANCEL', '#3a5560', '#243a44', benchCancel, { id: 'bcancel', disabled: !!G.benchFx, tip: 'Keep the tool for later' });
}

// per-tool application effects, spawned each frame while benchFx runs
function updateBenchFx(dt) {
  const bf = G.benchFx; if (!bf) return;
  bf.t += dt;
  bf.spots.forEach(sp => {
    const st = bf.fx.style;
    if (st === 'sparks' && rnd() < 0.6) parts.push({ x: sp.x + ri(-8, 8), y: sp.y + ri(-4, 4), vx: ri(-60, 60), vy: ri(-80, -20), g: 260, t: 0, life: 0.4, col: bf.fx.col, sz: ri(1, 2) });
    if (st === 'drop' && rnd() < 0.4) parts.push({ x: sp.x + ri(-6, 6), y: sp.y - 22, vx: 0, vy: 60, g: 160, t: 0, life: 0.45, col: bf.fx.col, sz: 2 });
    if (st === 'drip' && rnd() < 0.4) parts.push({ x: sp.x + ri(-5, 5), y: sp.y - 6, vx: 0, vy: 30, g: 120, t: 0, life: 0.6, col: bf.fx.col, sz: ri(1, 2) });
    if (st === 'bubbles' && rnd() < 0.6) parts.push({ x: sp.x + ri(-8, 8), y: sp.y + 10, vx: ri(-8, 8), vy: -40, g: -20, t: 0, life: 0.6, col: bf.fx.col, sz: ri(1, 2) });
    if (st === 'rise' && rnd() < 0.35) parts.push({ x: sp.x + ri(-8, 8), y: sp.y + ri(-6, 6), vx: 0, vy: -70, g: 0, t: 0, life: 0.5, col: bf.fx.col, sz: 2 });
    if (st === 'sheen' && rnd() < 0.5) parts.push({ x: sp.x - 10 + (bf.t * 60 % 22), y: sp.y + ri(-10, 10), vx: 40, vy: 0, g: 0, t: 0, life: 0.3, col: '#ffffff', sz: 1 });
  });
  if (bf.t > 0.8) { G.benchFx = null; benchCommit(); }
}

// ------------------------------------------------------------ overlays ----
function overlayDim(a) { rect(0, 0, W, H, 'rgba(5,10,10,' + (a === undefined ? 0.72 : a) + ')'); }

function drawRoundEnd() {
  const th = themeNow();
  drawSceneBack(th);
  drawCroc(0.9);
  drawSceneFront(th);
  drawSidebar();
  overlayDim(0.55);
  const px = 150, py = 60, pw = 260, ph = 140;
  panel(px, py, pw, ph, { face: '#1c2b33f2', edge: C.gold });
  drawTextCSh('ROUND WON!', px + pw / 2, py + 10, C.gold, 3);
  let y = py + 42;
  const line = (label, val, col) => {
    drawText(label, px + 24, y, C.white, 1);
    drawText('$' + val, px + pw - 24 - textW('$' + val, 1), y, col || C.gold, 1);
    y += 12;
  };
  line('GATOR DEFEATED', G.cash.base);
  if (G.cash.perBite > 0) line('UNUSED BITES', G.cash.perBite, C.green);
  if (G.cash.interest > 0) line('INTEREST (MAX $5)', G.cash.interest, C.blue);
  if (G.cash.fairy > 0) line('TOOTH FAIRY', G.cash.fairy, C.purple);
  if (G.cash.golden > 0) line('GOLDEN BADGES', G.cash.golden, '#ffcf4a');
  y += 4;
  drawText('TOTAL', px + 24, y, C.white, 1);
  drawText('$' + G.cash.total, px + pw - 24 - textW('$' + G.cash.total, 1), y, C.gold, 1);
  button(px + pw / 2 - 55, py + ph - 32, 110, 24, 'CASH OUT', '#e8a020', '#98650e', () => startTransition(cashOut), { id: 'cashout' });
}

// ------------------------------------------- run-intro cinematic ----------
// paper-cutout night scenes + a floor title card, Binding-of-Isaac style
const ANTE_NAMES = ['THE SHALLOWS', 'MUDBANK BEND', 'CYPRESS HOLLOW', 'MANGROVE MAZE', 'BLACKWATER', 'THE DEEP SLOUGH', 'GATOR ALLEY', "THE KING'S LAIR"];
const anteName = a => a <= 8 ? ANTE_NAMES[a - 1] : 'ENDLESS SWAMP ' + (a - 8);
function startIntro() {
  G.cut = { t: 0, shot: 0, growled: false, ending: false };
  G.state = 'intro';
}
function endIntro() {
  if (!G.cut || G.cut.ending) return;
  // a wipe may still be running (skip pressed instantly): cut straight over
  if (trans) { G.cut = null; G.state = 'map'; return; }
  G.cut.ending = true;
  startTransition(() => { G.cut = null; G.state = 'map'; });
}
const typed = (txt, t, cps) => txt.slice(0, Math.floor(Math.max(0, t) * (cps || 22)));
// a proper Everglades airboat, facing right; y = hull top line
function drawAirboat(cx, y, moving, dt) {
  const spin = tNow * (moving ? 26 : 5);
  // spray kicked up behind the stern while underway
  if (moving && dt !== undefined && (tNow % 0.22) < dt) addRipple(cx - 40, y + 16, false);
  if (moving) {
    ctx.save();
    for (let i = 0; i < 7; i++) {
      const ph = (tNow * 2.4 + i * 0.71) % 1;
      ctx.globalAlpha = (1 - ph) * 0.5;
      rect(cx - 46 - ph * 28, y + 4 - Math.sin(ph * Math.PI) * (6 + i), 2, 2, '#9fd8e0');
    }
    ctx.restore();
  }
  ctx.save(); ctx.globalAlpha = 0.28; rr(cx - 46, y + 13, 96, 5, 2, '#04080a'); ctx.restore();
  // twin rudder fins behind the cage
  rect(cx - 49, y - 24, 3, 24, '#8a2430'); rect(cx - 43, y - 29, 3, 29, '#c23a4a');
  // fan cage with spinning prop
  const fx = cx - 26, fy = y - 16;
  fillCircle(fx, fy, 17, '#26323a');
  fillCircle(fx, fy, 15, '#0c141a');
  ctx.save(); ctx.globalAlpha = 0.5;
  for (let m = -12; m <= 12; m += 6) { const hh = Math.floor(Math.sqrt(Math.max(0, 225 - m * m))); rect(fx + m, fy - hh, 1, hh * 2, '#3a4a55'); }
  ctx.restore();
  ctx.save(); ctx.translate(fx, fy);
  for (let b = 0; b < 3; b++) {
    ctx.save(); ctx.rotate(spin + b * (Math.PI * 2 / 3));
    rect(-1, -14, 3, 13, '#c8ccd0'); rect(-2, -14, 5, 4, '#e8ecf0');
    ctx.restore();
  }
  ctx.restore();
  fillCircle(fx, fy, 3, '#4a565e');
  // flat aluminum hull with upswept bow (right)
  rr(cx - 44, y, 92, 12, 3, '#8a949c');
  rr(cx - 42, y - 3, 88, 6, 3, '#aab4bc');
  rect(cx + 42, y - 6, 8, 9, '#aab4bc'); rect(cx + 46, y - 9, 4, 6, '#8a949c');
  rect(cx - 44, y + 9, 92, 3, '#3c464e');
  rect(cx - 40, y + 3, 84, 3, '#2c7d3a'); // park-service stripe
  // raised driver perch + the ranger up top
  rect(cx - 8, y - 22, 3, 22, '#5a646c'); rect(cx + 14, y - 22, 3, 22, '#5a646c');
  rr(cx - 12, y - 27, 32, 7, 2, '#c23a4a');           // bench seat
  rect(cx - 12, y - 27, 32, 2, '#e05a6a');
  drawBobble(cx + 4, y - 25, G.ranger, {
    sc: 0.62, expr: 'calm', act: 'idle',
    ...myFit(),
  });
  // bow headlamp + beam
  rr(cx + 34, y - 12, 8, 7, 2, '#2a2018'); rect(cx + 40, y - 10, 3, 3, '#ffd54a');
  ctx.save(); ctx.globalAlpha = 0.07 + Math.sin(tNow * 5) * 0.02;
  for (let d = 0; d < 6; d++) rect(cx + 44 + d * 9, y - 10 - d, 9, 8 + d * 2, '#ffb848');
  ctx.restore();
}
function drawIntro(dt) {
  const cut = G.cut; if (!cut) { G.state = 'map'; return; }
  cut.t += dt;
  const DUR = [3.6, 2.8, 3.6, 2.4];
  if (cut.t >= DUR[cut.shot] && !cut.ending) {
    if (cut.shot >= DUR.length - 1) endIntro();
    else { cut.shot++; cut.t = 0; cut.cap = ''; sfx.whoosh(); }
  }
  const t = cut.t, R = RANGERS[G.ranger] || RANGERS.scout;

  if (cut.shot === 0) {
    // --- shot 1: casting off from the ranger station at sundown ---
    paintCached('menu', 0, 0, W, H, menuStatic);
    const RX = 384, RY = 118;
    [[RX + 14, RY + 24], [RX + 84, RY + 24]].forEach(([wx, wy]) => { rect(wx, wy, 22, 18, '#f8c860'); rect(wx + 10, wy, 2, 18, '#3a2410'); rect(wx, wy + 8, 22, 2, '#3a2410'); });
    // Mrs Owlet on the porch with her clipboard
    ctx.save(); ctx.translate(RX - 2, RY + 60); ctx.scale(0.55, 0.55);
    drawOwlet(0, 0, { expr: 'grump', talk: t > 0.4 && t < 2.6, clip: 1, look: { x: -1, y: 0.4 } });
    ctx.restore();
    for (let r = 0; r < 40; r++) { const yy = MENU_HZ + 1 + r * 2, ww = Math.max(2, 22 - r * 0.45); ctx.save(); ctx.globalAlpha = Math.max(0.1, 0.8 - r * 0.018); rect(MENU_SUN.x - ww / 2 + Math.round(Math.sin(tNow * 1.2 + r * 1.9) * 2), yy, ww, 1, r < 4 ? '#fff4d0' : '#f8b870'); ctx.restore(); }
    // the airboat idles, then opens up the throttle
    const go = clamp((t - 1.5) / 2.0, 0, 1);
    const bx = 170 + easeIn(go) * 380, by = 214 + Math.sin(tNow * 2.4) * 1;
    drawAirboat(bx, by, go > 0, dt);
    drawRipples(0.8);
    if (go > 0.05 && (tNow % 0.08) < dt) parts.push({ x: bx - 50, y: by + 8, vx: -60 - rnd() * 60, vy: -30 - rnd() * 40, t: 0, life: 0.5, col: '#bfe0f0', sz: 2, g: 200 });
    cut.cap = typed("MRS OWLET: 'BRING BACK ALL TEN FINGERS.'", t - 0.3) + (t > 2.1 ? '\n' + typed("'...AND MY BOAT.'", t - 2.1) : '');
  } else if (cut.shot === 1) {
    // --- shot 2: full throttle through the glades, parallax whipping past ---
    for (let y = 0; y < 150; y++) { const f = Math.pow(y / 150, 1.3) * (DUSK.length - 1), i = Math.floor(f); rect(0, y, W, 1, DUSK[i]); if (f - i > 0.5 && i + 1 < DUSK.length) for (let x = (y & 1); x < W; x += 2) rect(x, y, 1, 1, DUSK[i + 1]); }
    fillCircle(360, 140, 22, '#fde0a0'); fillCircle(360, 140, 18, '#fff2cc');
    const far = (tNow * 18) % 60, mid = (tNow * 90) % 120, near = (tNow * 320) % 90;
    for (let x = -60; x < W + 60; x += 12) { const h = 8 + ((x / 12 | 0) * 37 % 11); rect(x - far, 150 - h, 13, h, '#3a2848'); }
    for (let x = -120; x < W + 120; x += 60) {
      const tx = x - mid + ((x / 60 | 0) % 2) * 20, top = 60 + ((x / 60 | 0) * 29 % 30);
      rect(tx - 3, top, 6, 150 - top, '#1a1224');
      for (let c = 0; c < 3; c++) { const cw = 14 + c * 6, cy = top + c * 9; rect(tx - cw, cy, cw * 2, 3, '#20182c'); for (let m = 0; m < cw * 2; m += 3) rect(tx - cw + m, cy + 3, 1, 3 + (m * 7 % 9), '#3a3448'); }
    }
    for (let y = 150; y < H; y++) rect(0, y, W, 1, mixC(DUSK[clamp(Math.floor((1 - (y - 150) / 120) * 7) + 1, 0, 8)], '#081018', 0.45 + (y - 150) / 260));
    ctx.save(); ctx.globalAlpha = 0.5;
    for (let k = 0; k < 24; k++) { const yy = 154 + (k * 37 % 110), xx = W - ((tNow * (260 + k * 14) + k * 97) % (W + 80)); rect(xx, yy, 20 + k % 30, 1, k % 3 ? '#8a6a8e' : '#f8b870'); }
    ctx.restore();
    const bob = Math.sin(tNow * 9) * 1.5;
    drawAirboat(200, 206 + bob, true, dt);
    // spray sheet off the stern
    for (let k = 0; k < 10; k++) { const ph = (tNow * 3 + k * 0.1) % 1; ctx.save(); ctx.globalAlpha = (1 - ph) * 0.6; rect(150 - ph * 80, 214 - Math.sin(ph * Math.PI) * 10, 3, 2, '#dff2fa'); ctx.restore(); }
    // reeds whipping by in the foreground
    for (let x = -30; x < W + 30; x += 18) { const h = 30 + ((x / 18 | 0) * 13 % 26); const rx = x - near; rect(rx, H - h, 2, h, '#0c1210'); rect(rx + 3, H - h + 8, 1, h - 8, '#141c16'); rr(rx - 1, H - h - 6, 4, 8, 1, '#2a1a10'); }
    // a flock bursts up out of the reeds
    if (t > 0.9) for (let k = 0; k < 7; k++) { const f = t - 0.9, bx2 = 330 + k * 14 - f * 60, by2 = 140 - f * (60 + k * 8) + Math.sin(k) * 6, fl = Math.sin(tNow * 16 + k) > 0; rect(bx2, by2, 3, 1, '#1a1224'); rect(bx2 - 2, by2 + (fl ? -2 : 1), 2, 1, '#1a1224'); rect(bx2 + 3, by2 + (fl ? -2 : 1), 2, 1, '#1a1224'); }
    // speed lines
    ctx.save(); ctx.globalAlpha = 0.25; for (let k = 0; k < 12; k++) { const yy = 30 + k * 18, xx = W - ((tNow * 700 + k * 131) % (W + 200)); rect(xx, yy, 60, 1, '#ffffff'); } ctx.restore();
    cut.cap = typed('HEADING INTO ' + anteName(G.ante) + '...', t - 0.2) + (t > 1.4 ? '\n' + typed(R.name + ' IS ON THE CLOCK.', t - 1.4) : '');
  } else if (cut.shot === 2) {
    // --- shot 3: the lagoon.  Engine off.  Something surfaces in the lamp. ---
    if (!cut.crocShot) {
      const _r = G.round; G.round = 1;
      ctx.clearRect(0, 0, W, H);
      const _mx = mx, _my = my; mx = 120; my = 140;
      drawCroc(0.4, { mood: 'hungry' });
      mx = _mx; my = _my; G.round = _r;
      const oc = document.createElement('canvas'); oc.width = W * 2; oc.height = H * 2;
      const o = oc.getContext('2d'); o.imageSmoothingEnabled = false;
      o.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, W * 2, H * 2);
      cut.crocShot = oc;
      ctx.setTransform(RS, 0, 0, RS, 0, 0);
    }
    drawLair(t, { rain: 0, eyes: t > 0.9, rise: clamp((t - 1.5) / 1.1, 0, 1), shot: cut.crocShot, eyeCol: '#ffd84a', lamp: 1 });
    if (t > 2.3 && !cut.growled) { cut.growled = true; sfx.boss(); shake = Math.max(shake, 6); fxRing(300, 170, '#ffd84a', 8, 120, 0.5); }
    cut.cap = typed('THE ENGINE CUTS OUT. THE WATER GOES STILL.', t - 0.2) + (t > 1.8 ? '\n' + typed('THE GATORS ARE HUNGRY TONIGHT.', t - 1.8) : '');
  } else {
    // --- shot 4: the ante sign slams into frame ---
    for (let y = 0; y < H; y++) rect(0, y, W, 1, mixC('#0a0c14', '#1a1024', y / H));
    for (let k = 0; k < 20; k++) { const on = Math.sin(tNow * 2 + k * 1.7); if (on > 0.3) { ctx.save(); ctx.globalAlpha = on * 0.8; rect((hash2(k, 1) * W + Math.sin(tNow * 0.4 + k) * 12 + W) % W, 30 + hash2(k, 2) * 200, 1, 1, '#fffcc0'); ctx.restore(); } }
    const drop = t < 0.35 ? (1 - easeOut(t / 0.35)) : 0;
    if (t > 0.35 && !cut.slammed) { cut.slammed = true; shake = Math.max(shake, 8); sfx.thunk(); for (let k = 0; k < 16; k++) parts.push({ kind: 'puff', x: 120 + rnd() * 240, y: 196, vx: (rnd() - 0.5) * 90, vy: -10 - rnd() * 30, t: 0, life: 0.7, col: '#8a7a6a', sz: 5, g: 0 }); }
    const sy = Math.round(56 - drop * 200);
    // posts
    rect(150, sy + 20, 8, 200, '#1a0e06'); rect(151, sy + 20, 6, 200, '#5a3a1a'); rect(322, sy + 20, 8, 200, '#1a0e06'); rect(323, sy + 20, 6, 200, '#5a3a1a');
    rr(92, sy + 3, 296, 118, 6, '#00000088');
    plasticBox(90, sy, 300, 116, 6, ['#140a04', '#4a2c14', '#6a4222', '#86582e', '#a8743e'], { seed: 9 });
    woodGrain(96, sy + 6, 288, 104, '#4a2c14', '#86582e', 31);
    rr(100, sy + 10, 280, 96, 4, '#2a1808');
    rr(102, sy + 12, 276, 92, 3, '#3a2412');
    [[96, sy + 6], [376, sy + 6], [96, sy + 102], [376, sy + 102]].forEach(([nx, ny]) => { rect(nx, ny, 3, 3, '#1a1a1a'); rect(nx, ny, 1, 1, '#9a9a9a'); });
    drawTextCSh('ANTE ' + G.ante, W / 2, sy + 22, '#f4ecd4', 5, '#1a0e06');
    const an = anteName(G.ante);
    drawTextCSh(an, W / 2, sy + 60, '#7ed05a', an.length > 14 ? 2 : 3, '#1a0e06');
    drawTextC(G.ante <= 8 ? (G.ante === 8 ? 'THE KING WAITS' : (8 - G.ante) + ' MORE STRETCHES TO THE KING') : 'THERE IS NO END TO THE SWAMP', W / 2, sy + 88, '#c8b090', 1);
    drawMiniGator(W / 2 - 11, sy + 124, 'small');
  }

  // letterbox bars, subtitles and the skip controls on every shot
  rect(0, 0, W, 24, '#000'); rect(0, H - 26, W, 26, '#000');
  if (cut.shot < 3 && cut.cap) letterboxCaption(cut.cap);
  hit(0, 24, W, H - 50, { id: 'cutadv', cb: () => { if (cut.shot >= 3) endIntro(); else { cut.shot++; cut.t = 0; cut.cap = ''; sfx.whoosh(); } }, cursor: true });
  button(W - 62, 5, 56, 14, 'SKIP >', '#4a4438', '#28241c', endIntro, { id: 'cutskip' });
  for (let k = 0; k < 4; k++) rr(8 + k * 9, 9, 6, 6, 2, k === cut.shot ? '#ffe6a0' : k < cut.shot ? '#8a7a58' : '#3a3428');
}
// captions live inside the lower letterbox bar, like subtitles
function letterboxCaption(txt) {
  const lines = txt.split('\n').filter(Boolean);
  if (lines.length >= 2) { drawTextC(lines[0], W / 2, H - 23, '#f4ecd4', 1); drawTextC(lines[1], W / 2, H - 13, '#ffe6a0', 1); }
  else if (lines[0]) drawTextC(lines[0], W / 2, H - 18, '#f4ecd4', 1);
}

// the gator's lagoon at night: moonlit black water, a treeline, the ranger's
// airboat idling at the left with its lamp on - and whatever is out there.
// o = { rain, eyes, rise (0..1), shot (croc sprite canvas at 2x), eyeCol, lamp, flash }
function drawLair(t, o) {
  // sky and moon
  for (let y = 0; y < 150; y++) { const f = y / 150; rect(0, y, W, 1, mixC('#05070e', '#141a2a', f)); }
  for (let k = 0; k < 50; k++) rect(Math.floor(hash2(k, 7) * W), Math.floor(hash2(k, 8) * 100), 1, 1, k % 6 ? '#6a7a9a' : '#e8f0ff');
  fillCircle(390, 44, 16, '#c8d4e8'); fillCircle(394, 40, 13, '#e8f0fa'); rect(386, 44, 3, 3, '#b8c4d8'); rect(396, 36, 2, 2, '#c8d4e8');
  if (o.flash) { ctx.save(); ctx.globalAlpha = o.flash * 0.35; rect(0, 0, W, 150, '#d8e8f8'); ctx.restore(); }
  // treeline
  for (let x = 0; x < W; x += 3) { const h = 20 + Math.floor(hash2(x >> 2, 5) * 14) + (hash2(x >> 4, 6) > 0.7 ? 18 : 0); rect(x, 150 - h, 3, h, o.flash ? '#1a2430' : '#070a10'); }
  // water
  rect(0, 150, W, H - 150, '#060c12');
  for (let k = 0; k < 16; k++) { const yy = 152 + k * 7, ww = 30 - k; ctx.save(); ctx.globalAlpha = 0.5 - k * 0.025; rect(390 - ww / 2 + Math.sin(tNow * 1.3 + k) * 3, yy, ww, 1, '#a8b8d0'); ctx.restore(); }
  ctx.save(); ctx.globalAlpha = 0.25; for (let k = 0; k < 14; k++) { const yy = 156 + (k * 29 % 100), xx = (tNow * (5 + k) + k * 77) % (W + 40) - 20; rect(xx, yy, 14, 1, '#2a4a5a'); } ctx.restore();
  // the gator rises: sprite drawn from the 2x capture, lit by the lamp
  const cx = 300, wl = 176;
  if (o.shot && o.rise > 0) {
    const sh = o.shot, rise = easeOut(o.rise);
    const sw = 300, shh = 220, top = Math.round(wl + 10 - rise * 150);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, wl + 2); ctx.clip();
    ctx.drawImage(sh, 150 * 2, 10 * 2, 300 * 2, 220 * 2, cx - sw / 2, top, sw, shh);
    ctx.globalAlpha = o.flash ? 0.1 : 0.55; rect(cx - sw / 2, top, sw, shh, '#060a14');
    ctx.restore();
  }
  if (o.eyes && (!o.shot || o.rise < 0.35)) {
    const ey = wl - 4 - Math.round((o.rise || 0) * 20);
    [[cx - 40, 0], [cx + 30, 1]].forEach(([ex]) => {
      ctx.save(); ctx.globalAlpha = 0.3 + Math.sin(tNow * 6) * 0.08; fillCircle(ex + 5, ey + 3, 10, o.eyeCol); ctx.restore();
      rr(ex, ey, 11, 7, 3, '#0a0a06'); rr(ex + 1, ey + 1, 9, 5, 2, o.eyeCol); rect(ex + 5, ey + 1, 1, 5, '#0a0806'); rect(ex + 2, ey + 1, 2, 1, '#ffffff');
    });
    ctx.save(); ctx.globalAlpha = 0.4; rect(cx - 60, wl, 120, 1, '#6a8aa0'); ctx.restore();
  }
  // waterline over the rising head, with laps
  rect(0, wl + 2, W, 2, '#0a141c');
  for (let x = 140; x < 470; x += 12) rect(x + ((tNow * 8 | 0) % 12), wl + 1, 6, 1, '#2a4a5a');
  // ripple rings from the disturbance
  for (let k = 0; k < 3; k++) { const rp = (tNow * 0.5 + k / 3) % 1; ctx.save(); ctx.globalAlpha = (1 - rp) * 0.4; const rw = 40 + rp * 200; rect(cx - rw / 2, wl + 6 + k * 4 + rp * 8, rw, 1, '#4a7a8a'); ctx.restore(); }
  // the airboat and its lamp beam
  const by = 214 + Math.sin(tNow * 1.8) * 1;
  if (o.lamp) {
    // a dithered cone of warm light, brightest at the lamp
    ctx.save();
    for (let r = 0; r < 210; r++) {
      const half = Math.round(4 + r * 0.22), cy = Math.round(by - 9 - r * 0.12);
      ctx.globalAlpha = Math.max(0, 0.2 - r / 1100);
      rect(112 + r, cy - half, 1, half * 2, '#ffd890');
      ctx.globalAlpha = Math.max(0, 0.35 - r / 700);
      if (r & 1) { rect(112 + r, cy - half, 1, 1, '#ffe8b0'); rect(112 + r, cy + half - 1, 1, 1, '#ffe8b0'); }
    }
    ctx.globalAlpha = 0.12; for (let r = 0; r < 5; r++) fillCircle(112, by - 9, 6 + r * 3, '#ffd890');
    ctx.restore();
  }
  if (!o.noBoat) drawAirboat(70, by, false, 0);
  // rain
  if (o.rain) {
    ctx.save(); ctx.globalAlpha = 0.35 * o.rain;
    for (let k = 0; k < 90; k++) { const rx = (hash2(k, 3) * (W + 40) + tNow * 90) % (W + 40) - 20, ry = (hash2(k, 4) * H + tNow * 380) % H; pxLine(rx, ry, rx - 3, ry + 8, '#9ab0c8'); }
    ctx.restore();
  }
}

// one line of menace per boss, shown on the WANTED poster
const BOSS_QUIPS = {
  twofang: 'IT KEEPS A SPARE SNAPPER. JUST FOR YOU.',
  murky: 'THE WATER HIDES WHAT THE X-RAYS CANNOT FIND.',
  cotton: 'EVERY TOOTH LOOKS THE SAME IN THE DARK.',
  lockjaw: 'IT WILL NOT LET GO. NEITHER SHOULD YOU.',
  loanshark: 'YOUR BANKS COME WITH A SERVICE FEE.',
  ironjaw: 'THEY RIVETED ITS SNOUT SHUT. IT CHEWED THROUGH.',
  tender: 'GENTLE GUMS. TERRIBLE TEMPER.',
  diet: 'IT ONLY EATS PLAIN TEETH. AND DENTISTS.',
  restless: 'THE SNAPPERS MOVE WHILE YOU BLINK.',
  king: 'BOW BEFORE THE CROWN. THEN PULL ITS TEETH.',
  mudcake: 'HALF THE TEETH. ALL OF THE BITE.',
  shellback: 'SIX PRESSES OR NOTHING, SAYS THE SHELL.',
  albino: 'ITS X-RAYS LIE. ITS APPETITE DOES NOT.',
  twin: 'ONE BANK IS NEVER ENOUGH FOR TWO FACES.',
  phantom: 'YOUR POOL SWIMS UNSEEN UNTIL YOU BANK.',
  junkjaw: 'EVERY SCAN COSTS. EVERY MISTAKE COSTS MORE.',
  bogqueen: 'HER SNAPPERS SLEEP IN THE RICHEST TEETH.',
  apexpred: 'THE END OF THE SWAMP. THE END OF YOU?',
};
// render the REAL styled croc once per boss and keep the sprite (2x)
let bossShot = null;
function ensureBossShot() {
  const key = (G.boss ? G.boss.id : 'x') + '|' + (G.summer ? 'sea' : 'swamp') + '|' + (G.mut || '-');
  if (bossShot && bossShot.key === key) return bossShot.c;
  ctx.clearRect(0, 0, W, H);
  const _mx = mx, _my = my; mx = 294; my = 150;
  drawCroc(0.42, { angry: true });
  mx = _mx; my = _my;
  const oc = document.createElement('canvas'); oc.width = W * 2; oc.height = H * 2;
  const o = oc.getContext('2d'); o.imageSmoothingEnabled = false;
  o.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, W * 2, H * 2);
  ctx.setTransform(RS, 0, 0, RS, 0, 0);
  bossShot = { key, c: oc };
  return oc;
}
// ---------- BOSS CINEMATIC: a storm, a lamp, and something enormous --------
function drawBossCut(dt) {
  const shot = ensureBossShot();
  const c = G.bcut; if (!c) { G.state = 'bossintro'; G.biStart = tNow; return; }
  c.t += dt;
  const t = c.t;
  const done = () => { G.bcut = null; G.state = 'bossintro'; G.biStart = tNow; };
  const flash = (t > 1.9 && t < 2.3) ? clamp(1 - (t - 1.9) / 0.4, 0, 1) : (Math.sin(t * 5.3) > 0.992 ? 0.6 : 0);
  if (t > 1.9 && !c.thunder) { c.thunder = true; sfx.boss(); shake = Math.max(shake, 4); }
  if (t < 2.9) drawLair(t, { rain: 1, eyes: t > 0.6, rise: clamp((t - 1.2) / 1.4, 0, 1) * 0.8, shot, eyeCol: '#ff3a2a', lamp: 1, flash });
  // the lunge
  if (t > 2.9) {
    drawLair(t, { rain: 1, eyes: false, rise: 0, shot: null, eyeCol: '#ff3a2a', lamp: 1, flash: 0 });
    const f = easeIn(clamp((t - 2.9) / 0.8, 0, 1));
    const sc = lerp(1, 2.6, f), w2 = 300 * sc, h2 = 220 * sc;
    ctx.save(); ctx.globalAlpha = 0.35 * f;
    for (let s = 0; s < 20; s++) {
      const a = s / 20 * Math.PI * 2 + tNow * 0.8, r0 = 60 + f * 90, r1 = r0 + 40 + f * 70;
      pxLine(W / 2 + Math.cos(a) * r0, 140 + Math.sin(a) * r0, W / 2 + Math.cos(a) * r1, 140 + Math.sin(a) * r1, '#ffffff', 2);
    }
    ctx.restore();
    ctx.drawImage(shot, 150 * 2, 10 * 2, 300 * 2, 220 * 2, W / 2 - w2 / 2, 150 - h2 * 0.55, w2, h2);
    if (f > 0.5 && shake < 4) shake = 5 + f * 4;
    if (f > 0.6 && !c.roared) { c.roared = true; sfx.snap(); fxRing(W / 2, 140, '#ff6a4a', 10, 180, 0.5); fxStars(W / 2, 140, '#ffd54a', 10, 150); }
    if (f > 0.8) {
      const k = (f - 0.8) / 0.2;
      ctx.save(); ctx.globalAlpha = k * 0.85; rect(0, 0, W, H, '#6a0a10'); ctx.restore();
      ctx.save(); ctx.globalAlpha = k;
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx2, sy2], i) => {
        let px2 = W / 2, py2 = 140;
        for (let seg = 0; seg < 7; seg++) {
          const nx = px2 + sx2 * (14 + seg * 5) + Math.sin(seg * 2.1 + i) * 9, ny = py2 + sy2 * (10 + seg * 4) + Math.cos(seg * 1.7 + i) * 7;
          pxLine(px2, py2, nx, ny, '#ffe8d0', 2); px2 = nx; py2 = ny;
        }
      });
      ctx.restore();
    }
  }
  rect(0, 0, W, 24, '#000'); rect(0, H - 26, W, 26, '#000');
  if (t < 1.9) letterboxCaption(typed('A STORM ROLLS OVER THE LAIR...', t - 0.2));
  else if (t < 2.9) letterboxCaption('...AND THE BIGGEST GATOR IN THE PARK\n' + typed('HAS BEEN WAITING FOR YOU.', t - 2.1));
  if (t >= 3.8) { done(); return; }
  drawText('TAP TO SKIP', W - 64, 9, '#6a6a6a', 1);
  hit(0, 0, W, H, { id: 'bcutskip', cb: done, cursor: true });
}

// ---------- the VS card: your ranger versus a WANTED poster ---------------
function drawBossIntro() {
  const shot = ensureBossShot();
  const el = tNow - G.biStart;
  const slide = easeOut(clamp(el / 0.45, 0, 1));
  // stormy lagoon behind everything, dimmed
  drawLair(el + 4, { rain: 0.7, eyes: false, rise: 0, shot: null, lamp: 0, noBoat: 1, flash: Math.sin(el * 3.1) > 0.995 ? 0.5 : 0 });
  ctx.save(); ctx.globalAlpha = 0.55; rect(0, 0, W, H, '#05060a'); ctx.restore();

  // ---- your ranger, on a brass-framed plate, sliding in from the left ----
  const R = RANGERS[G.ranger] || RANGERS.scout;
  const dx = Math.round(lerp(-200, 0, slide));
  goldFrame(20 + dx, 30, 132, 150, { field: '#1c2a30', fieldD: '#121c20', fieldL: '#26363e' });
  ctx.save(); ctx.beginPath(); ctx.rect(24 + dx, 34, 124, 142); ctx.clip();
  for (let k = 0; k < 8; k++) { ctx.save(); ctx.globalAlpha = 0.06; fillCircle(86 + dx, 110, 70 - k * 8, '#7fd4e8'); ctx.restore(); }
  drawBobble(86 + dx, 168, G.ranger, { sc: 1.9, expr: 'mad', act: 'idle', ...myFit() });
  ctx.restore();
  woodBanner(26 + dx, 184, 120, 13, R.name, { col: '#ffe6b0' });
  drawTextC('THE DENTIST', 86 + dx, 200, '#7fd4e8', 1);
  drawRangerBadge(122 + dx, 22, G.ranger, { sc: 1.1, wob: 1 });

  // ---- the WANTED poster, nailed up on the right ----
  const bx = Math.round(lerp(200, 0, slide)), px = 296 + bx, py = 16, pw = 164, ph = 218;
  const flap = Math.sin(tNow * 2.3) * 1;
  paperSheet(px, py + flap * 0.3, pw, ph, { ramp: ['#3a2a14', '#c8b080', '#e4d0a0', '#f0e2bc', '#fff8e0'] });
  ctx.save(); ctx.globalAlpha = 0.25; for (let k = 0; k < 40; k++) rect(px + 4 + hash2(k, 1) * (pw - 8), py + 4 + hash2(k, 2) * (ph - 8), 2, 2, '#8a6a3a'); ctx.restore();   // stains
  drawTextCSh('WANTED', px + pw / 2, py + 8, '#5a1a10', 3, '#c8b080');
  rect(px + 10, py + 26, pw - 20, 1, '#5a3a1a');
  // the boss's mugshot, printed in sepia ink
  const fx = px + 14, fy = py + 32, fw = pw - 28, fh = 96;
  rect(fx - 2, fy - 2, fw + 4, fh + 4, '#3a2410');
  ctx.save(); ctx.beginPath(); ctx.rect(fx, fy, fw, fh); ctx.clip();
  rect(fx, fy, fw, fh, '#d8c090');
  ctx.drawImage(shot, 160 * 2, 16 * 2, 270 * 2, 210 * 2, fx - 4, fy - 2, fw + 8, fh + 10);
  ctx.globalCompositeOperation = 'color'; ctx.globalAlpha = 0.7; rect(fx, fy, fw, fh, '#8a5a2a');
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 0.18; for (let y = fy; y < fy + fh; y += 2) rect(fx, y, fw, 1, '#3a2410');
  ctx.restore();
  drawTextC('DEAD OR ALIVE', px + pw / 2, fy + fh + 4, '#5a3a1a', 1);
  const nm = G.boss.name, nsc = textW(nm, 2) <= pw - 12 ? 2 : 1;
  drawTextCSh(nm, px + pw / 2, fy + fh + 13, '#241a10', nsc, '#c8b080');
  drawSmallWrapped("'" + (BOSS_QUIPS[G.boss.id] || 'IT IS VERY HUNGRY.') + "'", px + 10, fy + fh + 30, pw - 20, '#6a4a2a');
  drawSmallWrapped(G.boss.desc, px + 10, fy + fh + 50, pw - 20, '#8a1a10');
  // reward line and nails
  drawText('TARGET ' + fmt(G.target), px + 10, py + ph - 12, '#241a10', 1);
  [[px + 6, py + 5], [px + pw - 8, py + 5], [px + 6, py + ph - 8], [px + pw - 8, py + ph - 8]].forEach(([nx, ny]) => { rect(nx, ny, 3, 3, '#2a2a2a'); rect(nx, ny, 1, 1, '#aaaaaa'); });

  // ---- VS, stamped between them ----
  const vt = clamp((el - 0.5) / 0.25, 0, 1);
  if (el > 0.5) {
    if (el < 0.8 && shake < 2) shake = 7;
    const vsc = Math.round(lerp(12, 6, easeOut(vt)));
    const wob = vt >= 1 ? Math.round(Math.sin(tNow * 3) * 2) : 0;
    const vx = 224, vy = 92 - vsc * 2.5 + wob;
    for (let d = 4; d >= 1; d--) drawTextC('VS', vx + d * 0.5, vy + d, d > 2 ? '#1a0604' : '#6a1a10', vsc);
    [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([ox, oy]) => drawTextC('VS', vx + ox, vy + oy, '#1a0604', vsc));
    drawTextC('VS', vx, vy, '#ffd23f', vsc);
    if (vt >= 1) { ctx.save(); ctx.globalAlpha = 0.5 + Math.sin(tNow * 6) * 0.2; [[-34, -10], [30, -14], [-26, 20], [34, 16]].forEach(([ox, oy]) => { rect(vx + ox, 92 + oy, 3, 1, '#fff6c8'); rect(vx + ox + 1, 91 + oy, 1, 3, '#fff6c8'); }); ctx.restore(); }
  }
  if (el > 1.1) {
    signPlank(154, 206, 136, 26, 1, 'BITE DOWN!', '#b8402a', () => { G.state = 'play'; }, { id: 'bossgo', sc: 2 });
    hit(0, 24, W, 150, { id: 'bossgotap', cb: () => { G.state = 'play'; }, cursor: true });
    if ((tNow % 1) < 0.6) drawTextC('TAP TO FIGHT', W / 2, 250, '#ffb0a8', 1);
  }
}


function drawGameOver() {
  const th = THEMES.boss;
  drawSceneBack(th);
  drawCroc(1, { angry: true });
  drawSceneFront(th);
  overlayDim(0.66);
  drawTextCSh('SNAPPED!', W / 2, 44, C.red, 4);
  drawTextCSh('THE SWAMP CLAIMS ANOTHER DENTIST', W / 2, 80, '#ffb0a8', 1);
  const px = 160, pw = 160;
  panel(px, 96, pw, 84, { face: '#1c2b33f2' });
  let y = 104;
  const st = (l, v) => { drawText(l, px + 12, y, C.dim, 1); drawText('' + v, px + pw - 12 - textW('' + v, 1), y, C.white, 1); y += 12; };
  st('ANTE REACHED', G.ante);
  st('TEETH PRESSED', G.stats.pressed);
  st('TIMES SNAPPED', G.stats.snaps);
  st('BEST BANK', fmt(G.stats.bestBank));
  st('MONEY EARNED', '$' + G.stats.moneyEarned);
  st('BEST ANTE EVER', best);
  if (G.runRP > 0) drawTextCSh('+' + G.runRP + ' SCOUT COOKIES EARNED', W / 2, 186, C.green, 1);
  button(W / 2 - 55, 196, 110, 26, 'NEW RUN', '#d94f30', '#8a2a16', () => { startRun(); }, { id: 'newrun' });
  button(W / 2 - 45, 230, 90, 18, 'MENU', '#3a5560', '#243a44', () => { G.state = 'menu'; }, { id: 'tomenu' });
}

function drawWin() {
  const th = THEMES.night;
  drawSceneBack(th);
  drawCroc(0.15);
  drawSceneFront(th);
  overlayDim(0.6);
  drawTextCSh('YOU WIN!', W / 2, 40, C.gold, 4);
  drawTextCSh('ALL 8 ANTES SURVIVED. THE GATOR RESPECTS YOU.', W / 2, 76, C.white, 1);
  const px = 160, pw = 160;
  panel(px, 92, pw, 72, { face: '#1c2b33f2' });
  let y = 100;
  const st = (l, v) => { drawText(l, px + 12, y, C.dim, 1); drawText('' + v, px + pw - 12 - textW('' + v, 1), y, C.white, 1); y += 12; };
  st('TEETH PRESSED', G.stats.pressed);
  st('TIMES SNAPPED', G.stats.snaps);
  st('BEST BANK', fmt(G.stats.bestBank));
  st('MONEY EARNED', '$' + G.stats.moneyEarned);
  drawTextCSh('+30 SCOUT COOKIES', W / 2, 168, C.green, 1);
  drawTextCSh('THE OCEAN OPENS. SAIL ON, OR CALL IT?', W / 2, 180, '#7fe0f0', 1);
  // SET SAIL: cross into the endless OCEAN level (this is the only way to sharks)
  const eg = Math.sin(tNow * 3) * 0.5 + 0.5;
  ctx.save(); ctx.globalAlpha = 0.25 + eg * 0.3; rr(W / 2 - 84, 188, 168, 26, 5, '#2fb0d0'); ctx.restore();
  button(W / 2 - 80, 189, 160, 24, 'SET SAIL  >', '#2c8aa8', '#164a60', () => { G.summer = true; startTransition(enterShop); sfx.whoosh(); },
    { id: 'setsail', sub: 'INTO THE OCEAN - ENDLESS', subCol: '#bfeeff', tip: 'SET SAIL|Cross into the endless OCEAN: sharks,|hermit-crab cash, ever-growing antes.' });
  button(W / 2 - 55, 220, 110, 20, 'QUIT', '#d94f30', '#8a2a16', () => { G.summer = false; G.state = 'menu'; }, { id: 'winquit', tip: 'QUIT|Bank the win and return to the title.' });
}

// ------------------------------------------------------------ menu --------
// old, rusted, half-broken title sign hung from chains. dy = vertical push
// (negative = shoved up by the croc's snout). No swaying - it rides straight up
// on the head, then drops back and bounces on its chains.
// pick a fresh title-mascot look: a random croc variant + a full mouth of teeth
// Rolled ONCE per page load, so the title mascot is the same gator for the
// whole session (reload for a new one). A special variant is a rare treat.
function rollMenuLook() {
  const bases = [{ round: 0, nodeType: 'small' }, { round: 1, nodeType: 'big' }, { round: 0, nodeType: 'gold' }];
  const look = Object.assign({}, choice(bases));
  // tint/deco variants only (skip mega/dwarf so the mouth geometry stays put)
  const showable = ['diamond', 'spotted', 'striped', 'albino', 'alien', 'extra', 'gilded', 'glacial', 'corroded'];
  look.mut = rnd() < 0.12 ? choice(showable) : null; // usually just a plain gator
  const gems = ['gold', 'ruby', 'sapph', 'emerald', 'amber', 'diamond', 'steel'];
  const n = 12 + ri(0, 2) + (look.mut === 'extra' ? 3 : 0); // a full set of teeth
  const teeth = [];
  for (let i = 0; i < n; i++) {
    const tp = rnd() < 0.62 ? 'plain' : choice(gems);
    const base = tp === 'plain' ? ri(1, 9) : (TOOTH_DEFS[tp] ? TOOTH_DEFS[tp].base : 5);
    teeth.push({ t: { type: tp, base }, pressed: false, gone: false, pop: 0, revealed: null, snap: false });
  }
  look.teeth = teeth;
  G.menuLook = look;
}
// =========================== THE TITLE SCREEN ==============================
//  Sundown on the Everglades.  A bald cypress frames the left of the shot
//  and holds the carved title sign; the ranger station stands on stilts
//  across the water with its windows lit; a gator lurks in the shallows
//  (and now and then shows you exactly what the job is); the menu itself is
//  a trail signpost on the boardwalk, one painted arrow per destination.
// ==========================================================================
const MENU_HZ = 160;                                   // horizon line
const MENU_SUN = { x: 300, y: 150, r: 26 };
function menuStatic() {
  // ---- sky: long dithered bands ----
  for (let y = 0; y < MENU_HZ; y++) {
    const f = Math.pow(y / MENU_HZ, 1.2) * (DUSK.length - 1), i = Math.floor(f), fr = f - i;
    rect(0, y, W, 1, DUSK[i]);
    if (i + 1 < DUSK.length) {
      if (fr > 0.66) { for (let x = (y & 1); x < W; x += 2) rect(x, y, 1, 1, DUSK[i + 1]); }
      else if (fr > 0.33) { for (let x = (y & 1) * 2; x < W; x += 4) rect(x, y, 1, 1, DUSK[i + 1]); }
    }
  }
  for (let k = 0; k < 90; k++) { const sx = Math.floor(hash2(k, 3) * W), sy = Math.floor(hash2(k, 5) * 56); rect(sx, sy, 1, 1, k % 7 ? '#a898c8' : '#ffffff'); }
  // ---- the sun, with a halo of dithered rings ----
  const S = MENU_SUN;
  for (let r = S.r + 22; r > S.r; r -= 2) for (let a = 0; a < 90; a++) { const an = a / 90 * Math.PI * 2, px = S.x + Math.cos(an) * r, py = S.y + Math.sin(an) * r; if (py < MENU_HZ && hash2(a, r) < 0.55 - (r - S.r) / 50) rect(px, py, 1, 1, '#fcd48a'); }
  fillCircle(S.x, S.y, S.r + 3, '#f8b060'); fillCircle(S.x, S.y, S.r, '#fde0a0'); fillCircle(S.x, S.y, S.r - 5, '#fff2cc'); fillCircle(S.x - 5, S.y - 6, S.r - 14, '#fffae8');
  // ---- clouds, lit from beneath ----
  [[20, 44, 120], [150, 30, 90], [260, 60, 150], [390, 38, 100], [60, 92, 110], [330, 108, 140], [180, 120, 70]].forEach(([cx, cy, cw], n) => {
    const lit = cy > 80 ? '#f8b870' : '#d87a8a', dark = cy > 80 ? '#a4527a' : '#5a3a6a';
    for (let r = 0; r < 4; r++) {
      const ww = cw - r * 18, xx = cx + r * 9 + Math.floor(hash2(n, r) * 8);
      rect(xx, cy + r * 2, ww, 2, r < 2 ? dark : mixC(dark, lit, 0.5));
    }
    rect(cx + 6, cy + 8, cw - 30, 1, lit); rect(cx + 14, cy + 9, cw - 50, 1, '#fde0a0');
  });
  // ---- birds far off ----
  // ---- far treeline and a hammock of cypress ----
  for (let x = 0; x < W; x++) {
    const th = 5 + Math.floor(hash2(x >> 1, 7) * 5) + (hash2(x >> 3, 9) > 0.72 ? 7 : 0) + (hash2(x >> 4, 2) > 0.8 ? 10 : 0);
    rect(x, MENU_HZ - th, 1, th, '#3a2848'); rect(x, MENU_HZ - th, 1, 1, '#54385e');
  }
  [[150, 0.8], [196, 1.1], [236, 0.7], [420, 0.9], [462, 1.2]].forEach(([tx, ts], n) => {
    const top = Math.round(MENU_HZ - 64 * ts), tw = Math.max(2, Math.round(2.5 * ts));
    rect(tx - tw, top + 6, tw * 2, MENU_HZ - top - 4, '#261a34');
    for (let c = 0; c < 3; c++) {
      const cw = Math.round((10 + c * 6) * ts), cy = top + c * Math.round(9 * ts);
      rect(tx - cw, cy, cw * 2, 3, '#2e2040'); rect(tx - cw + 2, cy - 1, cw * 2 - 4, 1, '#2e2040');
      for (let m = 0; m < cw * 2; m += 3) rect(tx - cw + m, cy + 3, 1, 2 + Math.floor(hash2(m + n * 40, c) * 8 * ts), '#40345a');
    }
  });
  // ---- water: the sky flipped and darkened, with long calm streaks ----
  for (let y = MENU_HZ; y < H; y++) {
    const f = (1 - (y - MENU_HZ) / (H - MENU_HZ)) * (DUSK.length - 2) + 0.5, i = clamp(Math.floor(f), 0, DUSK.length - 1);
    rect(0, y, W, 1, mixC(DUSK[i], '#081018', 0.42 + (y - MENU_HZ) / 300));
  }
  for (let k = 0; k < 40; k++) { const yy = MENU_HZ + 3 + Math.floor(hash2(k, 1) * 100), xx = Math.floor(hash2(k, 2) * W); rect(xx, yy, 8 + (k % 5) * 6, 1, '#5a3a5e'); }
  // treeline reflection
  ctx.save(); ctx.globalAlpha = 0.5;
  for (let x = 0; x < W; x += 1) { const th = 3 + Math.floor(hash2(x >> 1, 7) * 4); rect(x, MENU_HZ, 1, th, '#1e1426'); }
  ctx.restore();

  // ---- the ranger station on stilts ----
  const RX = 384, RY = 118;
  // stilts + reflection
  [RX + 6, RX + 40, RX + 76, RX + 110].forEach(sx => { rect(sx, RY + 64, 4, 44, '#1e140e'); rect(sx, RY + 64, 1, 44, '#3a2a1a'); ctx.save(); ctx.globalAlpha = 0.4; rect(sx, RY + 108, 4, 20, '#1e140e'); ctx.restore(); });
  rect(RX - 14, RY + 60, 144, 6, '#2a1c12'); rect(RX - 14, RY + 60, 144, 1, '#5a4028');                      // deck
  for (let x = RX - 12; x < RX + 128; x += 6) rect(x, RY + 61, 1, 4, '#1a100a');
  // porch rail
  for (let x = RX - 14; x < RX + 6; x += 5) rect(x, RY + 46, 2, 14, '#3a2a1a');
  rect(RX - 14, RY + 46, 22, 2, '#5a4028');
  // walls: board and batten, sun-bleached green
  const WL = ['#101810', '#2a3a2c', '#34483a', '#405846', '#5a7a60'];
  rect(RX, RY + 16, 124, 44, WL[2]);
  for (let x = RX; x < RX + 124; x += 6) { rect(x, RY + 16, 1, 44, WL[1]); rect(x + 1, RY + 16, 1, 44, WL[3]); }
  grainRect(RX, RY + 16, 124, 44, WL[1], WL[3], 0.05, 4);
  rect(RX + 124, RY + 16, 2, 44, WL[0]);
  // tin roof, rusted
  for (let r = 0; r < 18; r++) { const inset = 18 - r; rect(RX - 10 + inset, RY - 2 + r, 144 - inset * 2, 1, r < 2 ? '#8a5a3a' : r % 3 ? '#6a4a3a' : '#5a3a2e'); }
  for (let x = RX - 8; x < RX + 134; x += 5) rect(x, RY + 8, 1, 8, '#4a2e22');
  grainRect(RX - 6, RY + 2, 136, 14, '#8a3a1a', '#a8704a', 0.05, 7);
  rect(RX - 12, RY + 16, 148, 2, '#2a1810');
  // sign board on the roof
  rr(RX + 24, RY - 12, 76, 13, 2, '#1a120a'); rr(RX + 25, RY - 11, 74, 11, 2, '#e8dcc0');
  drawTextC('RANGER STN', RX + 62, RY - 8, '#2a4a2a', 1);
  // windows (the light itself is live) + door
  [[RX + 14, RY + 24], [RX + 84, RY + 24]].forEach(([wx, wy]) => { rect(wx - 2, wy - 2, 26, 22, '#1a120a'); rect(wx - 2, wy + 20, 26, 2, '#8a6a4a'); });
  rr(RX + 50, RY + 26, 22, 34, 1, '#1a120a'); rr(RX + 51, RY + 27, 20, 33, 1, '#6a3a1a');
  for (let k = 0; k < 3; k++) rect(RX + 53, RY + 30 + k * 10, 16, 8, '#5a3016');
  rect(RX + 66, RY + 44, 2, 2, '#e8c040');
  // chimney pipe
  rect(RX + 104, RY - 20, 6, 22, '#2a2a2a'); rect(RX + 102, RY - 22, 10, 3, '#3a3a3a');
  // tied up skiff
  rr(RX + 6, RY + 100, 46, 7, 3, '#1a100a'); rr(RX + 7, RY + 100, 44, 5, 2, '#6a4a2a'); rect(RX + 9, RY + 100, 40, 1, '#8a6a3a');
  pxLine(RX + 12, RY + 100, RX + 8, RY + 66, '#c8b890');

  // ---- the great cypress framing the left ----
  const T = ['#0c0810', '#1a1220', '#241a2c', '#30243a', '#403250'];
  for (let y = 0; y < 238; y++) {
    const flare = y > 180 ? Math.round(Math.pow((y - 180) / 58, 2) * 22) : 0;
    const w2 = 26 + flare + Math.round(Math.sin(y / 17) * 2);
    rect(0, y, w2, 1, T[2]); rect(w2 - 6, y, 5, 1, T[3]); rect(w2 - 1, y, 1, 1, T[0]);
    if (y % 7 === 0) rect(4 + (y % 3) * 3, y, 10, 1, T[1]);
    if (hash2(y, 4) < 0.3) rect(w2 - 3, y, 1, 1, '#6a4a5e');                         // sunset rim light
  }
  for (let k = 0; k < 6; k++) { const kx = 20 + k * 11, kh = 8 + (k % 3) * 5; rect(kx, 238 - kh, 5, kh, T[2]); rect(kx + 3, 238 - kh, 2, kh, T[3]); rect(kx, 238 - kh, 5, 1, T[0]); }
  // the long bough across the top, with moss curtains
  for (let x = 0; x < 330; x++) {
    const by = 8 + Math.round(Math.sin(x / 60) * 3 + x * 0.02), th = Math.max(3, 9 - Math.floor(x / 45));
    rect(x, by, 1, th, T[2]); rect(x, by, 1, 1, T[4]); rect(x, by + th - 1, 1, 1, T[0]);
  }
  for (let x = 0; x < 340; x += 2) {
    const by = 8 + Math.round(Math.sin(x / 60) * 3 + x * 0.02) + Math.max(3, 9 - Math.floor(x / 45));
    const ml = 4 + Math.floor(hash2(x, 17) * (x < 60 ? 46 : 24));
    for (let j = 0; j < ml; j++) if (hash2(x, j) > 0.18) rect(x + Math.round(Math.sin(j / 5 + x) * 1), by + j, 1, 1, j > ml - 4 ? '#5a6a58' : (x + j) % 3 ? '#3a4a3e' : '#4a5a4a');
  }
  // cypress needles along the bough
  for (let k = 0; k < 120; k++) { const nx = Math.floor(hash2(k, 8) * 330), ny = 6 + Math.round(Math.sin(nx / 60) * 3 + nx * 0.02) - Math.floor(hash2(k, 9) * 6); rect(nx, ny, 3, 1, k % 2 ? '#2a3a2a' : '#1e2e22'); }

  // ---- the boardwalk along the bottom ----
  const BW = ['#1a0e06', '#3a2412', '#4e3218', '#644022', '#7c5430'];
  for (let r = 0; r < 5; r++) {
    const y = 236 + r * 7, h2 = 7;
    rect(0, y, 250 - r * 4, h2, r % 2 ? BW[2] : BW[3]);
    rect(0, y, 250 - r * 4, 1, BW[4]); rect(0, y + h2 - 1, 250 - r * 4, 1, BW[0]);
    woodGrain(0, y + 1, 250 - r * 4, h2 - 2, BW[1], BW[4], r * 9);
    for (let x = (r * 31) % 44; x < 240; x += 44) { rect(x, y + 2, 1, 1, '#8a8a8a'); rect(x, y + 4, 1, 1, '#8a8a8a'); }
  }
  rect(0, 234, 252, 2, BW[0]);
  [20, 120, 232].forEach(px => { rect(px, 222, 8, 48, BW[1]); rect(px, 222, 2, 48, BW[3]); rect(px, 222, 8, 2, BW[4]); rr(px - 1, 226, 10, 3, 1, '#c8b890'); });
  // rope between the posts
  [[24, 124], [124, 236]].forEach(([a, b]) => { for (let x = a; x <= b; x++) { const f = (x - a) / (b - a); rect(x, 227 + Math.round(Math.sin(f * Math.PI) * 6), 1, 2, '#b8a070'); } });
  // lily pads in the open water
  [[272, 216], [300, 232], [258, 248], [330, 226], [316, 258], [440, 238], [470, 252]].forEach(([lx, ly], i) => {
    rr(lx - 6, ly - 2, 13, 5, 2, '#1a3a24'); rr(lx - 5, ly - 2, 11, 3, 2, '#2e5a34'); rect(lx - 3, ly - 2, 4, 1, '#4a8a4a'); rect(lx, ly - 1, 1, 2, '#1a3a24');
    if (i % 3 === 0) { rr(lx - 2, ly - 5, 5, 3, 1, '#e8a8c8'); rect(lx - 1, ly - 6, 3, 1, '#f8d8e8'); rect(lx, ly - 4, 1, 1, '#f0e060'); }
  });
  // reeds at the right edge
  for (let k = 0; k < 40; k++) { const rx = 400 + Math.floor(hash2(k, 51) * 80), rh = 10 + Math.floor(hash2(k, 52) * 24); rect(rx, 262 - rh, 1, rh, k % 3 ? '#1a2418' : '#2a3a26'); if (k % 5 === 0) rr(rx - 1, 262 - rh - 5, 3, 7, 1, '#4a2a18'); }
}

// ---- the title sign: carved letters, painted enamel, extruded ----
function menuLogo() {
  const w = 272, h = 76;
  // the carved board
  rr(2, 4, w - 4, h - 20, 5, '#00000066');
  plasticBox(0, 0, w - 4, h - 22, 5, ['#140a04', '#3a2210', '#50301a', '#684024', '#8a5a32'], { seed: 19 });
  woodGrain(4, 4, w - 12, h - 30, '#3a2210', '#684024', 5);
  rr(6, 5, w - 16, h - 32, 3, '#2a1808');
  rr(7, 6, w - 18, h - 34, 3, '#3a2412');
  // iron corner brackets
  [[2, 2], [w - 18, 2], [2, h - 36], [w - 18, h - 36]].forEach(([bx, by]) => { rr(bx, by, 12, 12, 2, '#1a1a1a'); rr(bx + 1, by + 1, 10, 10, 2, '#4a4a4a'); rect(bx + 2, by + 2, 8, 1, '#7a7a7a'); fillCircle(bx + 6, by + 6, 1, '#1a1a1a'); });
  // letters: extrusion and ink outline on the board...
  const text = 'BITE DOWN', sc = 5, tx = Math.round((w - 4 - textW(text, sc)) / 2), ty = 11;
  for (let d = 4; d >= 1; d--) drawText(text, tx + Math.round(d * 0.5), ty + d, d > 2 ? '#1a0e06' : '#5a3a18', sc);
  [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1], [2, 0], [-2, 0], [0, 2]].forEach(([ox, oy]) => drawText(text, tx + ox, ty + oy, '#1a0e06', sc));
  // ...then the enamel paint on its own layer, so the lighting only touches paint
  const paint = getCached('menulogoPaint', textW(text, sc) + 2, 5 * sc + 2, () => {
    drawText('BITE', 0, 0, '#f4ecd4', sc);
    drawText('DOWN', textW('BITE ', sc) + 1, 0, '#7ed05a', sc);
    ctx.save(); ctx.globalCompositeOperation = 'source-atop';
    for (let y = 0; y < 5 * sc; y++) {
      const f = y / (5 * sc);
      if (f < 0.2) { ctx.globalAlpha = 0.7; rect(0, y, textW(text, sc), 1, '#ffffff'); }
      else if (f < 0.28 && (y & 1)) { ctx.globalAlpha = 0.5; for (let x = 0; x < textW(text, sc); x += 2) rect(x + (y & 2 ? 1 : 0), y, 1, 1, '#ffffff'); }
      else if (f > 0.8) { ctx.globalAlpha = 0.55; rect(0, y, textW(text, sc), 1, '#3a2a10'); }
    }
    ctx.globalAlpha = 0.45;
    for (let k = 0; k < 200; k++) rect(Math.floor(hash2(k, 71) * textW(text, sc)), Math.floor(hash2(k, 72) * 5 * sc), 1, 1, k % 3 ? '#6a5a30' : '#ffffff');
    // enamel teeth: a notch of gum-pink at the foot of BITE
    ctx.globalAlpha = 0.8; for (let x = 0; x < textW('BITE', sc); x += 5) rect(x + 2, 5 * sc - 2, 2, 2, '#d8707e');
    ctx.restore();
  });
  ctx.drawImage(paint, tx, ty, paint.width / RS, paint.height / RS);
  // tagline plank
  const pw = 200, px = Math.round((w - 4 - pw) / 2), py = h - 20;
  rect(px + 20, py - 4, 2, 5, '#b8a070'); rect(px + pw - 22, py - 4, 2, 5, '#b8a070');
  rr(px + 1, py + 2, pw, 14, 2, '#00000066');
  plasticBox(px, py, pw, 14, 2, ['#1a0e06', '#5a3a1a', '#7a522a', '#946638', '#b08050'], { seed: 23, noShine: 1 });
  drawTextC('A SWAMP DENTISTRY ROGUELIKE', px + pw / 2, py + 4, '#f4e2b8', 1);
}

// two small icons only the title screen needs
ICONS.gearic = (x, y) => {
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; rect(x + 5 + Math.round(Math.cos(a) * 4.5), y + 5 + Math.round(Math.sin(a) * 4.5), 2, 2, '#b8c4ca'); }
  fillCircle(x + 6, y + 6, 4, '#8a969c'); fillCircle(x + 6, y + 6, 3, '#c8d4da'); fillCircle(x + 6, y + 6, 1, '#2a1808'); rect(x + 4, y + 3, 2, 1, '#ffffff');
};
ICONS.giftic = (x, y) => {
  rr(x + 1, y + 5, 10, 7, 1, '#c83a2a'); rect(x + 1, y + 4, 10, 2, '#e84a3a'); rect(x + 5, y + 4, 2, 8, '#f8d040');
  rect(x + 3, y + 1, 3, 3, '#f8d040'); rect(x + 6, y + 1, 3, 3, '#f8d040'); rect(x + 5, y + 3, 2, 1, '#c89a20');
};
ICONS.scrollic = (x, y) => {
  rr(x + 1, y + 2, 10, 8, 1, '#c8a870'); rect(x + 2, y + 3, 8, 6, '#f0e0b8'); rr(x, y + 1, 3, 10, 1, '#a88850'); rr(x + 9, y + 1, 3, 10, 1, '#a88850');
  rect(x + 4, y + 4, 4, 1, '#8a6a3a'); rect(x + 4, y + 6, 3, 1, '#8a6a3a');
};
// a painted arrow plank on the signpost - the menu buttons
function signPlank(x, y, w, h, dir, label, col, cb, o) {
  o = o || {};
  const id = o.id || label;
  const hov = mx >= x - 4 && mx < x + w + 4 && my >= y && my < y + h;
  const pressed = hov && down && down.hit && down.hit.id === id;
  const wig = hov ? Math.round(Math.sin(tNow * 14) * 1) : 0;
  const yy = y + (pressed ? 2 : 0) + wig, xx = x + (hov ? dir * 3 : 0);
  const P = [mixC(col, '#000000', 0.72), mixC(col, '#000000', 0.38), col, mixC(col, '#ffffff', 0.18), mixC(col, '#ffffff', 0.42)];
  const tip = Math.floor(h / 2);
  if (hov) { ctx.save(); ctx.globalAlpha = 0.25 + Math.sin(tNow * 6) * 0.08; rr(xx - 6, yy - 4, w + 12, h + 8, 6, '#ffd890'); ctx.restore(); }
  // drop shadow then the arrow-shaped board, row by row
  for (let j = 0; j < h; j++) {
    const cut = Math.abs(j - (h - 1) / 2), inset = Math.round(cut * tip / ((h - 1) / 2)) - tip + tip;
    const x0 = dir > 0 ? xx : xx + inset, x1 = dir > 0 ? xx + w - inset : xx + w;
    rect(x0 + 2, yy + j + 3, x1 - x0, 1, '#00000066');
  }
  for (let j = 0; j < h; j++) {
    const cut = Math.abs(j - (h - 1) / 2), inset = Math.round(cut * tip / ((h - 1) / 2));
    const x0 = dir > 0 ? xx : xx + inset, x1 = dir > 0 ? xx + w - inset : xx + w;
    const tone = j === 0 || j === h - 1 ? P[0] : j === 1 ? P[4] : j < h * 0.35 ? P[3] : j > h * 0.75 ? P[1] : P[2];
    rect(x0, yy + j, x1 - x0, 1, tone);
    rect(x0, yy + j, 1, 1, P[0]); rect(x1 - 1, yy + j, 1, 1, P[0]);
    // weathered paint: bare wood showing through, plank grain
    for (let i = x0 + 2; i < x1 - 2; i++) {
      const q = hash2(i - x + w, j + id.length * 7);
      if (q < 0.035) rect(i, yy + j, 2, 1, '#8a6034');
      else if (q > 0.93) rect(i, yy + j, 1, 1, P[1]);
    }
  }
  for (let j = 3; j < h - 3; j += 3) { const gx = xx + 6 + Math.floor(hash2(j, w) * (w - 30)); rect(gx, yy + j, 10 + (j % 7), 1, P[1]); }
  // nail heads and the rope lashing at the post end
  const ne = dir > 0 ? xx + 5 : xx + w - 7;
  rect(ne, yy + 3, 2, 2, '#2a2a2a'); rect(ne, yy + 3, 1, 1, '#9a9a9a'); rect(ne, yy + h - 5, 2, 2, '#2a2a2a'); rect(ne, yy + h - 5, 1, 1, '#9a9a9a');
  const sc = o.sc || 1;
  const tw = textW(label, sc), lx = xx + (w - tip) / 2 + (dir > 0 ? 0 : tip) - tw / 2 + (o.icon ? 7 : 0);
  if (o.icon) { const ix = lx - 16, iy = yy + Math.floor((h - 12) / 2); (ICONS[o.icon] || ICONS.star)(ix, iy); }
  const ty = yy + Math.floor((h - 5 * sc) / 2) - (o.sub ? 3 : 0);
  drawText(label, lx + 1, ty + 1, P[0], sc);
  drawText(label, lx, ty, o.tcol || '#fff4dc', sc);
  if (o.sub) drawTextC(o.sub, lx + tw / 2, ty + 5 * sc + 2, mixC(col, '#ffffff', 0.6), 1);
  hit(x - 4, y, w + 8, h, { id, cursor: true, cb, tip: o.tip });
}
// small square wooden tile with an icon (settings, credits, sound)
function woodTile(x, y, s, icon, cb, o) {
  o = o || {};
  const hov = mx >= x && mx < x + s && my >= y && my < y + s;
  const yy = y + (hov ? -1 : 0);
  rr(x + 1, yy + 3, s, s, 3, '#00000066');
  plasticBox(x, yy, s, s, 3, ['#140a04', '#4a2c14', '#6a4222', '#86582e', '#a8743e'], { seed: x });
  rr(x + 3, yy + 3, s - 6, s - 6, 2, '#2a1808');
  if (hov) { ctx.save(); ctx.globalAlpha = 0.3; rr(x + 3, yy + 3, s - 6, s - 6, 2, '#ffd890'); ctx.restore(); }
  (ICONS[icon] || ICONS.star)(x + (s - 12) / 2, yy + (s - 12) / 2);
  hit(x, y, s, s, { id: o.id || icon, cursor: true, cb, tip: o.tip });
}

// the REAL croc - the same one you fight - lurking in the shallows up to its
// nostrils.  Every so often it rises, gapes and snaps; click it to provoke it.
const MENU_WATER = 230;
const MENU_CROC_X = 324;
function drawMenuCroc(dt) {
  const g = menuGator;
  g.t += dt;
  const cyc = 9, ct = g.t % cyc;
  // it never ducks under: jaws hang wide open, breathing slowly, then SNAP
  let close = 0.16 + (0.5 + 0.5 * Math.sin(g.t * 0.9)) * 0.12;
  if (ct > 6.4 && ct < 8.4) {
    const k = ct - 6.4;
    close = k < 0.5 ? lerp(close, 0.02, easeOut(k / 0.5)) : k < 0.62 ? lerp(0.02, 1, (k - 0.5) / 0.12) : k < 1.2 ? 1 : lerp(1, close, easeOut((k - 1.2) / 0.8));
    if (k > 0.62 && !g.snapped) { g.snapped = true; sfx.snap(); shake = Math.max(shake, 5); for (let i = 0; i < 20; i++) parts.push({ x: MENU_CROC_X + (rnd() - 0.5) * 200, y: MENU_WATER - 2, vx: (rnd() - 0.5) * 110, vy: -60 - rnd() * 80, t: 0, life: 0.8, col: '#bfe0f0', sz: 2, g: 240 }); addRipple(MENU_CROC_X, MENU_WATER + 2, true); }
  } else g.snapped = false;
  const S = 1, waterY = 212;
  ctx.save();
  // warm backlight halo so the silhouette pops off the sunset
  glow(MENU_CROC_X, 150, 120, '#ffb070', 0.16);
  ctx.beginPath(); ctx.rect(0, 0, W, MENU_WATER); ctx.clip();
  ctx.translate(MENU_CROC_X, MENU_WATER); ctx.scale(S, S); ctx.translate(-294, -waterY);
  const _mx = mx, _my = my; mx = 294 + (mx - MENU_CROC_X) / S; my = waterY + (my - MENU_WATER) / S;
  const sj = G.jawClose; G.jawClose = close;
  drawCroc(close, { mood: close > 0.9 ? 'angry' : 'hungry', dry: 1 });
  G.jawClose = sj; mx = _mx; my = _my;
  ctx.restore();
  // wet reflection and ripples round the head
  ctx.save(); ctx.globalAlpha = 0.3; rect(MENU_CROC_X - 140, MENU_WATER, 280, 12, '#0a1418'); ctx.restore();
  ctx.save(); ctx.globalAlpha = 0.45;
  for (let r = 0; r < 4; r++) { const rw = 280 + r * 22 + Math.sin(tNow * 1.5 + r) * 4; rect(MENU_CROC_X - rw / 2, MENU_WATER + 1 + r * 3, rw, 1, '#a88aa0'); }
  ctx.restore();
  if (Math.sin(tNow * 1.7) > 0.96) addRipple(MENU_CROC_X - 120 + rnd() * 240, MENU_WATER + 3);
  hit(MENU_CROC_X - 130, 70, 260, MENU_WATER - 70, { id: 'menugator', cursor: true, tip: 'THE GATOR|Click it. Go on.', cb: () => { if (ct < 6.4) menuGator.t = Math.floor(menuGator.t / cyc) * cyc + 6.4; } });
}
// the lurking gator: eyes, snout and back scutes breaking the surface.
// Every so often it rears up and snaps at a dragonfly.
let menuGator = { t: 0, snapAt: 9, snapped: false, poke: 0 };
function drawMenuGator(dt) {
  const g = menuGator;
  g.t += dt;
  const cyc = 13, ct = g.t % cyc;
  const gx = 262 + Math.sin(g.t * 0.12) * 8, wy = 210;
  let rise = 0, jaw = 0;
  if (ct > 9 && ct < 12) {
    const k = ct - 9;
    rise = k < 0.6 ? easeOut(k / 0.6) * 10 : k < 2.2 ? 10 : 10 * (1 - (k - 2.2) / 0.8);
    jaw = k < 0.6 ? 0 : k < 1.6 ? easeOut((k - 0.6) / 1) : k < 1.75 ? 1 - (k - 1.6) / 0.15 : 0;
    if (k > 1.75 && !g.snapped) { g.snapped = true; sfx.snap(); shake = Math.max(shake, 3); for (let i = 0; i < 12; i++) parts.push({ x: gx - 30 + rnd() * 30, y: wy - 2, vx: (rnd() - 0.5) * 80, vy: -40 - rnd() * 70, t: 0, life: 0.8, col: '#bfe0f0', sz: 2, g: 240 }); addRipple(gx - 20, wy + 2); }
  } else g.snapped = false;
  if (g.poke > 0) { g.poke -= dt; }
  const HD = ['#0c140a', '#1e3016', '#2a4420', '#3e5e2e', '#5a7e40'];
  const y0 = wy - Math.round(rise);
  ctx.save(); ctx.translate(gx, wy); ctx.scale(1.5, 1.5); ctx.translate(-gx, -wy);
  // reflection and ripples ring around the head
  ctx.save(); ctx.globalAlpha = 0.35;
  for (let r = 0; r < 3; r++) { const rw = 50 + r * 18 + Math.sin(tNow * 1.5 + r) * 3; rect(gx - rw / 2 - 16, wy + 2 + r * 3, rw, 1, '#8a6a8e'); }
  ctx.restore();
  // the back: a line of scutes trailing off to the right
  for (let k = 0; k < 6; k++) {
    const bx = gx + 30 + k * 8, bh = 3 - (k > 5 ? 1 : 0) + (k % 2);
    rect(bx, wy - bh, 5, bh, HD[1]); rect(bx + 1, wy - bh, 3, 1, HD[3]); rect(bx, wy - bh, 1, bh, HD[0]);
  }
  rect(gx + 78, wy - 1, 12, 1, HD[1]);                  // the tail wake
  // lower jaw only shows when it rears
  if (jaw > 0.05) {
    const open = Math.round(jaw * 16);
    for (let x = 0; x < 56; x++) {
      const yt = y0 + 2 + Math.round((x / 56) * open * 0.3), yb = y0 + 2 + Math.round((1 - x / 56) * 2) + open * (1 - x / 70) * 0.9;
      rect(gx - 50 + x, yt, 1, Math.max(1, yb - yt), x < 50 ? '#a83a4a' : '#6a1a2a');
    }
    for (let k = 0; k < 7; k++) { const tx = gx - 46 + k * 7; rect(tx, y0 + 2, 2, 3, '#f4ecd4'); }
    for (let x = 0; x < 58; x++) { const yb = y0 + 3 + Math.round(open * (1 - x / 70) * 0.9); rect(gx - 52 + x, yb, 1, 4, HD[2]); rect(gx - 52 + x, yb + 3, 1, 1, '#c8b890'); }
  }
  // the snout
  const lift = Math.round(jaw * 12);
  for (let x = 0; x < 64; x++) {
    const f = x / 64, top = y0 - 4 - Math.round(Math.sin(f * Math.PI * 0.9) * 2) - Math.round((1 - f) * lift);
    rect(gx - 52 + x, top, 1, y0 + 2 - top - (x < 58 ? Math.round((1 - f) * lift * 0.2) : 0), HD[2]);
    rect(gx - 52 + x, top, 1, 1, HD[3]);
    if (hash2(x, 3) < 0.3) rect(gx - 52 + x, top + 2, 1, 1, HD[1]);
  }
  rr(gx - 52, y0 - 6 - lift, 7, 4, 1, HD[2]); rect(gx - 50, y0 - 6 - lift, 2, 1, '#0a0806');           // nostril bump
  if (jaw > 0.05) for (let k = 0; k < 7; k++) { const tx = gx - 46 + k * 7; rect(tx, y0 + 1 - Math.round((1 - k / 7) * lift * 0.8), 2, 3, '#f4ecd4'); }
  // the eyes: two domes, yellow, slit pupils, always watching the cursor
  [[gx + 6, 0], [gx + 18, 1]].forEach(([ex, i]) => {
    rr(ex - 5, y0 - 10, 11, 9, 4, HD[0]); rr(ex - 4, y0 - 9, 9, 8, 3, HD[2]); rect(ex - 3, y0 - 9, 5, 1, HD[4]);
    const px = clamp(Math.round((mx - ex) / 60), -2, 2);
    rr(ex - 3, y0 - 7, 7, 4, 1, '#d8c030'); rect(ex - 2, y0 - 7, 3, 1, '#f8e880');
    rect(ex + px, y0 - 7, 1, 4, '#0a0806'); rect(ex - 2, y0 - 6, 1, 1, '#ffffff');
  });
  ctx.restore();
  // bubbles
  if (Math.sin(tNow * 1.7) > 0.96) addRipple(gx - 30 + rnd() * 20, wy + 3);
  hit(gx - 84, wy - 26, 120, 34, { id: 'menugator', cursor: true, tip: 'THE GATOR|It is watching you', cb: () => { if (ct < 8.5) menuGator.t = Math.floor(menuGator.t / cyc) * cyc + 9; } });
}

function drawMenu(dt) {
  if (G.summer) { G.summer = false; }
  G.mut = null;
  if (!G.menuLook) rollMenuLook();
  G.mouth = G.menuLook.teeth;
  const dv = G.dive;
  if (dv) dv.t += dt;
  const dk = dv ? clamp(dv.t / 1.0, 0, 1) : 0;
  const zc = { x: MENU_CROC_X, y: 150 };                // straight down the gator's throat
  if (dv) { const z = 1 + easeIn(dk) * 6; ctx.save(); ctx.translate(zc.x, zc.y); ctx.scale(z, z); ctx.translate(-zc.x, -zc.y); }

  paintCached('menu', 0, 0, W, H, menuStatic);
  // ---- live sky: birds crossing the sun ----
  for (let k = 0; k < 5; k++) {
    const bt = ((tNow * 0.03 + k * 0.07) % 1), bx = W + 20 - bt * (W + 60) + k * 9, by = 70 + k * 5 + Math.sin(tNow * 2 + k) * 2;
    const fl = Math.sin(tNow * 8 + k) > 0;
    rect(bx, by, 2, 1, '#2a1a30'); rect(bx - 2, by + (fl ? -1 : 1), 2, 1, '#2a1a30'); rect(bx + 2, by + (fl ? -1 : 1), 2, 1, '#2a1a30');
  }
  // ---- sun glitter and slow ripples on the water ----
  for (let r = 0; r < 44; r++) {
    const yy = MENU_HZ + 1 + r * 2, ww = Math.max(2, 22 - r * 0.45);
    const off = Math.round(Math.sin(tNow * 1.2 + r * 1.9) * (2 + r * 0.08));
    ctx.save(); ctx.globalAlpha = Math.max(0.1, 0.8 - r * 0.018);
    if ((r + Math.floor(tNow * 3)) % 4 !== 0) rect(MENU_SUN.x - ww / 2 + off, yy, ww, 1, r < 4 ? '#fff4d0' : '#f8b870');
    ctx.restore();
  }
  ctx.save(); ctx.globalAlpha = 0.3;
  for (let k = 0; k < 10; k++) { const yy = MENU_HZ + 6 + k * 9, xx = ((tNow * (4 + k) + k * 61) % (W + 40)) - 20; rect(xx, yy, 10 + k, 1, '#d89a9a'); }
  ctx.restore();
  // ---- station lights: flickering windows, lanterns, chimney smoke, flag ----
  const RX = 384, RY = 118;
  [[RX + 14, RY + 24], [RX + 84, RY + 24]].forEach(([wx, wy], i) => {
    const fl = 0.9 + Math.sin(tNow * 7 + i * 3) * 0.05 + Math.sin(tNow * 13 + i) * 0.04;
    ctx.save(); ctx.globalAlpha = fl; rect(wx, wy, 22, 18, '#f8c860'); rect(wx, wy, 22, 5, '#fde098'); ctx.restore();
    rect(wx + 10, wy, 2, 18, '#3a2410'); rect(wx, wy + 8, 22, 2, '#3a2410');
    ctx.save(); ctx.globalAlpha = 0.18 * fl; rect(wx - 4, wy + 116, 30, 22, '#f8c860'); ctx.restore();   // reflection on the water
  });
  // her silhouette crosses the left window
  const ow = (tNow * 0.15) % 2;
  if (ow < 1) { const sx = RX + 14 + ow * 22; ctx.save(); ctx.beginPath(); ctx.rect(RX + 14, RY + 24, 22, 18); ctx.clip(); rr(sx - 5, RY + 28, 10, 14, 4, '#3a2a18'); rect(sx - 5, RY + 26, 2, 3, '#3a2a18'); rect(sx + 3, RY + 26, 2, 3, '#3a2a18'); ctx.restore(); }
  [[RX - 12, RY + 36], [RX + 128, RY + 36]].forEach(([lx, ly], i) => {
    const sw = Math.round(Math.sin(tNow * 1.4 + i) * 1);
    rect(lx, ly - 4, 1, 4, '#2a2a2a');
    ctx.save(); ctx.globalAlpha = 0.22 + Math.sin(tNow * 9 + i * 2) * 0.05; fillCircle(lx + sw, ly + 4, 9, '#ffc860'); ctx.restore();
    rr(lx - 2 + sw, ly, 5, 7, 1, '#1a1a1a'); rect(lx - 1 + sw, ly + 1, 3, 5, '#ffe090');
  });
  for (let k = 0; k < 6; k++) { const st = (tNow * 0.25 + k / 6) % 1; ctx.save(); ctx.globalAlpha = 0.4 * (1 - st); fillCircle(RX + 107 + Math.sin(st * 5 + k) * 4 + st * 14, RY - 24 - st * 40, 2 + st * 5, '#8a7a8a'); ctx.restore(); }
  // flag on the roof
  rect(RX + 4, RY - 30, 1, 30, '#c8c8c8');
  for (let x = 0; x < 16; x++) { const wv = Math.round(Math.sin(tNow * 5 - x * 0.5) * 1.5); rect(RX + 5 + x, RY - 30 + wv, 1, 9, x < 5 ? '#2a4a8a' : (x % 4 < 2 ? '#c83a2a' : '#f4ecd4')); }
  drawRipples && drawRipples();

  // ---- the gator ----
  drawMenuCroc(dt);

  // ---- fireflies over the water and the dock ----
  for (let k = 0; k < 18; k++) {
    const fx = (hash2(k, 81) * W + Math.sin(tNow * 0.3 + k) * 20 + W) % W, fy = 150 + hash2(k, 82) * 90 + Math.sin(tNow * 0.8 + k * 2) * 6;
    const on = Math.sin(tNow * 2 + k * 1.7);
    if (on > 0.3) { ctx.save(); ctx.globalAlpha = on * 0.3; rect(fx - 1, fy - 1, 3, 3, '#f8f080'); ctx.globalAlpha = on; rect(fx, fy, 1, 1, '#fffcc0'); ctx.restore(); }
  }
  // ---- the moss sways a touch in the evening breeze ----
  ctx.save(); ctx.globalAlpha = 0.5;
  for (let x = 6; x < 330; x += 14) { const by = 16 + Math.round(Math.sin(x / 60) * 3 + x * 0.02), ml = 10 + Math.floor(hash2(x, 17) * 16), sw = Math.round(Math.sin(tNow * 1.1 + x) * 1.5); for (let j = 0; j < ml; j += 2) rect(x + Math.round(sw * j / ml), by + j, 1, 2, '#4e5e4c'); }
  ctx.restore();

  if (dv) {
    ctx.restore();
    ctx.save(); ctx.globalAlpha = dk * dk; rect(0, 0, W, H, '#0a0604'); ctx.restore();
    if (dk >= 1) { const cb = dv.cb; G.dive = null; if (cb) cb(); }
    return;
  }

  // ---- the title sign, top-left, hanging on two ropes ----
  const TS = 0.62, lx = 6, ly = 8 + Math.round(Math.sin(tNow * 0.9) * 1);
  [lx + 24, lx + 142].forEach(rx => { for (let y = 0; y < ly + 3; y += 2) rect(rx, y, 2, 2, (y >> 1) & 1 ? '#c8b080' : '#a08858'); });
  ctx.save(); ctx.translate(lx, ly); ctx.scale(TS, TS);
  paintCached('menulogo', 0, 0, 272, 76, menuLogo);
  const gl = (tNow * 0.35) % 2.2;
  if (gl < 1) { ctx.globalAlpha = 0.5; const gx2 = 20 + gl * 230; for (let k = 0; k < 22; k++) rect(gx2 + k * 0.4, 13 + k, 2, 1, '#ffffff'); }
  ctx.restore();

  // ---- the signpost: every option is a trail arrow, all down the left ----
  const PX = 14;
  rect(PX - 4, 58, 9, 190, '#1a0e06'); rect(PX - 3, 58, 7, 190, '#4e3218'); rect(PX - 3, 58, 2, 190, '#6a4a28'); woodGrain(PX - 1, 60, 4, 180, '#3a2412', '#7c5430', 3);
  ensureDaily();
  const idxAll = indexEntries();
  const idxNew = idxAll.filter(e => meta.index.seen[e.key] && !meta.index.claimed[e.key]).length;
  signPlank(6, 60, 158, 30, 1, 'START SHIFT', '#b8402a', diveIn, { id: 'start', sc: 2, sub: 'REPORT TO RANGER HQ', tip: 'START SHIFT|Head to HQ and pick your ranger' });
  signPlank(6, 96, 132, 20, 1, 'WARDROBE', '#3a6a8a', () => { G.wd = null; G.state = 'skins'; sfx.click(2); }, { id: 'skinsbtn', icon: 'glove', tip: 'WARDROBE|Hats, shirts, pants, shoes, costumes and more' });
  signPlank(6, 120, 132, 20, 1, 'TRADING BOOTH', '#7a4a9a', () => { ensureDaily(); boothEnter(); G.state = 'pass'; }, { id: 'passbtn', icon: 'cookie', tip: "MRS OWLET'S TRADING BOOTH|" + fmt(meta.rp || 0) + ' cookies - new stock every 5 seconds' });
  signPlank(6, 144, 132, 20, 1, 'FIELD GUIDE', '#3a7a44', () => { G.state = 'index'; sfx.click(2); }, { id: 'idxbtn', icon: 'book', sub: null, tip: 'FIELD GUIDE|' + (idxNew ? idxNew + ' new finds to claim' : 'Every gator you have met') });
  if (idxNew) { const bx = 128, by = 142; plasticBox(bx, by, 16, 10, 3, ['#3a0806', '#a8201a', '#e8403a', '#ff806a', '#ffc0b0'], { noShine: 1 }); drawTextC('+' + idxNew, bx + 8, by + 3, '#ffffff', 1); }
  woodTile(8, 170, 22, 'gearic', () => { G.overlay = 'settings'; }, { id: 'setbtn', tip: 'SETTINGS' });
  woodTile(34, 170, 22, 'scrollic', () => { G.overlay = 'credits'; }, { id: 'credbtn', tip: 'CREDITS' });
  woodTile(60, 170, 22, 'giftic', () => { G.boothOv = 'gifts'; }, { id: 'giftbtn', tip: 'FREE GIFTS|Follow us for a wombat hat + tee' });
  if (G.boothOv) { drawBoothOverlay(); return; }

  // ---- the shift log, pinned to the pier post ----
  (function board() {
    const bx = 8, by = 200, bw = 76, bh = 56;
    rect(bx + 46, by - 12, 8, 14, '#2a1c12');
    paperSheet(bx, by, bw, bh, { ruled: 1, ruledTop: 16 });
    pushPin(bx + bw / 2, by + 2, PINS[2]);
    drawText('SHIFT LOG', bx + 6, by + 6, '#8a5a1a', 1);
    drawText('QUESTS ' + ((meta.qb && meta.qb.done) || 0), bx + 6, by + 18, '#241a10', 1);
    drawText(fmt(meta.rp || 0) + ' COOKIES', bx + 6, by + 26, '#7a5a10', 1);
    drawText('ANTE ' + best, bx + 6, by + 34, '#241a10', 1);
    drawText('RANGERS ' + RANGER_ORDER.filter(rangerUnlocked).length + '/5', bx + 6, by + 42, '#241a10', 1);
    hit(bx, by, bw, bh, { id: 'menuquests', cursor: true, tip: 'QUEST BOARD|Pinned by the trading booth', cb: () => { boothEnter(); G.state = 'pass'; sfx.click(2); } });
  })();
}
// the title screen hands you off to HQ
function startRun() { lobby = null; G.state = 'ranger'; sfx.whoosh(); }
function diveIn() {
  if (G.dive) return;
  G.dive = { t: 0, cb: startRun };
  sfx.whoosh();
}

// ------------------------------------------------------------- INDEX -------
// A field journal of every croc variant, boss, badge and tooth you have met.
// Each fresh find can be cashed in for SCOUT COOKIES, plus a completion bonus.
function indexEntries() {
  const list = [];
  CHARMS.forEach(c => list.push({ key: 'charm_' + c.id, charm: c, name: c.name, col: RAR_COL[c.rar || 0], tier: c.rar || 0, abil: c.desc, tag: c.desc, flav: c.flav }));
  Object.keys(TOOTH_DEFS).forEach(k => { const d = TOOTH_DEFS[k]; list.push({ key: 'tooth_' + k, tooth: k, name: d.name, col: RAR_COL[d.rar || 0], tier: d.rar || 0, abil: d.desc, tag: d.desc, flav: d.flav }); });
  MUT_ORDER.concat(SHOP_MUTS).forEach(k => {
    const a = MUT_ABIL[k] || { tier: 0, name: '?', desc: '' };
    list.push({ key: 'mut_' + k, mut: k, name: MUTATIONS[k].name, col: MUTATIONS[k].col, tier: a.tier, abil: a.name, tag: a.tag || a.name, desc: a.desc, flav: MUTATIONS[k].flav });
  });
  BOSSES.forEach(b => list.push({ key: 'boss_' + b.id, boss: b.id, name: b.name, col: '#ff8a8a', tier: 3, abil: 'BOSS RULE', tag: 'BOSS RULE', desc: b.desc, flav: BOSS_QUIPS[b.id] || 'It is very hungry.' }));
  return list;
}
function drawIndex() {
  const th = THEMES.night;
  drawSceneBack(th); drawSceneFront(th);
  overlayDim(0.78);
  const all = indexEntries();
  const seenN = all.filter(e => meta.index.seen[e.key]).length;
  const owed = all.filter(e => meta.index.seen[e.key] && !meta.index.claimed[e.key]);
  const owedCk = owed.reduce((a, e) => a + indexBounty(e.key), 0);
  drawTextCSh('SWAMP INDEX', W / 2, 5, C.gold, 2);
  drawTextC('LOGGED ' + seenN + ' / ' + all.length + '  -  FIND THEM IN PLAY TO FILL THE BOOK', W / 2, 20, '#8aa0a8', 1);
  panel(6, 3, 88, 15, { face: '#26321e', edge: '#5a7a3a' });
  ICONS.cookie(10, 6); drawText(fmt(meta.rp || 0) + ' CK', 24, 8, C.gold, 1);
  if (owed.length) {
    button(W - 112, 3, 106, 15, 'CLAIM +' + owedCk + ' CK', '#e8a020', '#98650e', () => {
      owed.forEach(e => { meta.index.claimed[e.key] = true; });
      addRP(owedCk, 'INDEX BOUNTY');
      if (seenN >= all.length && !meta.index.done) { meta.index.done = true; addRP(60, 'INDEX COMPLETE!'); }
      saveMeta(); sfx.ach();
    }, { id: 'idxclaim', tip: 'INDEX BOUNTY|' + owed.length + ' new find(s) to cash in|Fill the book for a +60 bonus' });
  } else drawTextC(seenN >= all.length ? 'BOOK COMPLETE!' : 'NO NEW FINDS', W - 58, 7, seenN >= all.length ? C.green : '#54707a', 1);

  // ---- four tabs, each with its own live count ----
  if (!G.idxTab) G.idxTab = 'mut';
  const TABS = [['mut', 'CROCS', e => e.mut], ['boss', 'BOSSES', e => e.boss], ['charm', 'BADGES', e => e.charm], ['tooth', 'TEETH', e => e.tooth]];
  TABS.forEach(([k, lbl, sel], i) => {
    const tw = 108, tx = 12 + i * (tw + 6), on = G.idxTab === k;
    const grp = all.filter(sel), got = grp.filter(e => meta.index.seen[e.key]).length;
    const fresh = grp.some(e => meta.index.seen[e.key] && !meta.index.claimed[e.key]);
    if (on) plaque(tx, 26, tw, 15, { tint: '#c9941a', r: 2, noStud: 1 });
    else { rr(tx, 26, tw, 16, 2, '#2a3a42'); rr(tx + 1, 27, tw - 2, 14, 2, '#16222a'); }
    drawTextC(lbl + '  ' + got + '/' + grp.length, tx + tw / 2, 31, on ? C.gold : '#7a8a92', 1);
    if (fresh) { ctx.save(); ctx.globalAlpha = 0.5 + Math.sin(tNow * 6) * 0.35; rect(tx + tw - 6, 29, 3, 3, C.gold); ctx.restore(); }
    hit(tx, 26, tw, 16, { id: 'idxtab' + k, cursor: true, cb: () => { G.idxTab = k; sfx.click(2); } });
  });
  const sel = (TABS.find(t => t[0] === G.idxTab) || TABS[0])[2];
  const page = all.filter(sel);

  const tipFor = (e, got, fresh, tierLbl) => got
    ? (e.name + '|' + tierLbl + '|' + e.abil + (e.flav ? "|'" + e.flav + "'" : '') + (fresh ? '|+' + indexBounty(e.key) + ' COOKIES TO CLAIM' : '|CLAIMED'))
    : ('??? UNDISCOVERED|' + (e.charm ? 'Own this badge to log it' : e.tooth ? 'Add this tooth to your deck to log it' : 'Meet it on the trail to log it') + '|Worth +' + indexBounty(e.key) + ' COOKIES');

  if (G.idxTab === 'charm' || G.idxTab === 'tooth') {
    // ---- compact collection grid (98 badges / 20 teeth) ----
    const isT = G.idxTab === 'tooth';
    const cols = isT ? 10 : 14, cell = isT ? 44 : 33, chh = isT ? 60 : 30;
    const gx0 = (W - cols * cell) / 2, gy0 = 50;
    page.forEach((e, i) => {
      const x = gx0 + (i % cols) * cell, y = gy0 + Math.floor(i / cols) * chh;
      const got = !!meta.index.seen[e.key], fresh = got && !meta.index.claimed[e.key];
      const cw = cell - 5, ch2 = chh - 5;
      if (got) {
        goldFrame(x, y, cw, ch2, { r: 3, thin: 1, field: mixHex('#16242c', e.col, 0.22), fieldD: '#0d1720', fieldL: mixHex('#2c4250', e.col, 0.22), glow: fresh ? 0.26 : 0 });
      } else { rr(x, y, cw, ch2, 2, '#243038'); rr(x + 1, y + 1, cw - 2, ch2 - 2, 2, '#0f181e'); }
      if (got) {
        if (isT) drawTooth(x + 7, y + 6, cw - 14, ch2 - 22, true, e.tooth, {});
        else { ctx.save(); ctx.globalAlpha = 1; (ICONS[e.charm.ico] || ICONS.star)(x + cw / 2 - 6, y + 4); ctx.restore(); }
        drawTextC(e.name.split(' ')[0].slice(0, isT ? 7 : 5), x + cw / 2, y + ch2 - 9, '#9fb8c0', 1);
        if (fresh) { ctx.save(); ctx.globalAlpha = 0.5 + Math.sin(tNow * 6) * 0.35; rect(x + cw - 4, y + 2, 3, 3, C.gold); ctx.restore(); }
      } else drawTextC('?', x + cw / 2, y + ch2 / 2 - 4, '#2f4048', 1);
      hit(x, y, cw, ch2, { id: 'idx' + e.key, cursor: true, tip: tipFor(e, got, fresh, RAR_NAME[e.tier] || 'COMMON') });
    });
  } else {
    // ---- detailed journal cards (crocs + bosses) ----
    const cols = 6, cw = 78, ch = 60, gx0 = 8, gy0 = 48;
    page.forEach((e, i) => {
      const x = gx0 + (i % cols) * cw, y = gy0 + Math.floor(i / cols) * ch;
      const got = !!meta.index.seen[e.key], fresh = got && !meta.index.claimed[e.key];
      const tierLbl = e.boss ? 'BOSS' : MUT_TIER_NAME[e.tier];
      const tierCol = e.boss ? '#ff8a8a' : MUT_TIER_COL[e.tier];
      if (got) {
        goldFrame(x, y, cw - 6, ch - 6, {
          r: 4, field: mixHex('#16242c', e.col, 0.2), fieldD: '#0d1720', fieldL: mixHex('#2c4250', e.col, 0.2),
          glow: fresh ? 0.28 + Math.sin(tNow * 4) * 0.08 : 0,
        });
      } else steelTile(x, y, cw - 6, ch - 6, { field: '#101a20' });
      if (got) {
        if (e.boss) {
          const bx = x + 34, by2 = y + 15;
          rr(bx - 12, by2 - 7, 24, 14, 3, '#00000055'); rr(bx - 11, by2 - 6, 22, 12, 3, '#8a3030');
          rect(bx - 7, by2 - 3, 3, 3, C.red); rect(bx + 4, by2 - 3, 3, 3, C.red);
          for (let t = 0; t < 5; t++) rect(bx - 9 + t * 4, by2 + 3, 2, 4, '#f4f0dc');
          rect(bx - 10, by2 - 9, 3, 3, C.redD); rect(bx + 7, by2 - 9, 3, 3, C.redD);
        } else drawMutChip(x + 34, y + 15, e.mut);
        drawTextC(e.name.slice(0, 12), x + 35, y + 26, '#eafcff', 1);
        drawTextC(tierLbl, x + 35, y + 36, tierCol, 1);
        drawTextC(e.tag.slice(0, 13), x + 35, y + 46, '#8aa0a8', 1);
        if (fresh) { ctx.save(); ctx.globalAlpha = 0.5 + Math.sin(tNow * 6) * 0.3; drawTextC('NEW', x + cw - 18, y + 3, C.gold, 1); ctx.restore(); }
      } else {
        drawTextC('?', x + 35, y + 11, '#2f4048', 2);
        drawTextC('NOT MET', x + 35, y + 32, '#2f4048', 1);
        drawTextC('+' + indexBounty(e.key) + ' CK', x + 35, y + 44, '#2f4048', 1);
      }
      hit(x, y, cw - 6, ch - 6, { id: 'idx' + e.key, cursor: true, tip: tipFor(e, got, fresh, tierLbl) });
    });
  }
  button(W / 2 - 45, 250, 90, 15, '< BACK', '#3a5560', '#243a44', () => { G.state = 'menu'; }, { id: 'idxback' });
}

// --------------------------------------------------- SKINS (cosmetics) -----
// a simple horizontal picker row of item icons; click to equip, ? when locked.
function skinRow(y, order, cur, isOpen, drawIco, tipFor, equip, rarOf) {
  const n = order.length, cw = (W - 24) / n, s = Math.min(24, cw - 2);
  order.forEach((k, i) => {
    const gx = Math.round(12 + i * cw), gy = y, on = cur() === k, open = isOpen(k);
    const hovT = mx >= gx && mx < gx + s && my >= gy && my < gy + s;
    if (open) {
      goldFrame(gx, gy, s, s, {
        r: 3, thin: 1,
        field: mixHex('#2a1a10', RAR_COL[rarOf(k)], on ? 0.5 : 0.24),
        fieldD: '#1a1008', fieldL: mixHex('#4a3020', RAR_COL[rarOf(k)], 0.35),
        glow: on ? 0.28 + Math.sin(tNow * 4) * 0.07 : (hovT ? 0.2 : 0),
      });
      drawIco(gx + (s >> 1), gy + (s >> 1), k);
    } else {
      steelTile(gx, gy, s, {});
      drawTextC('?', gx + (s >> 1), gy + (s >> 1) - 4, '#4b6b7a', 1);
    }
    if (on) { rect(gx + (s >> 1) - 3, gy + s - 2, 6, 2, UGOLD[3]); rect(gx + (s >> 1) - 2, gy + s - 2, 4, 1, UGOLD[4]); }
    hit(gx, gy, s, s, { id: 'skin' + k, cursor: true, tip: tipFor(k, open, on), cb: () => { if (open) { equip(k); saveMeta(); sfx.buy(); } else sfx.error(); } });
  });
}

// ------------------------------------------------- interactive tutorial ----
const TUT_STEPS = [
  { t: 'WELCOME, DENTIST!', b: ['A gator hides a mouth full of teeth.', 'Some are safe. ONE is a SNAPPER.'], demo: 'gator' },
  { t: 'PRESS SAFE TEETH', b: ['Each safe tooth adds to TEETH and', 'grows your MULT chain by +1.'], demo: 'press' },
  { t: 'BANK YOUR BITE', b: ['TEETH x MULT is your bite. BANK it', 'to lock the score in - or push your luck.'], demo: 'bank' },
  { t: 'MIND THE SNAPPER', b: ['Press the snap tooth and the jaw SLAMS -', 'you lose the whole unbanked bite!'], demo: 'snap' },
  { t: 'USE YOUR X-RAYS', b: ['Out of ideas? X-RAY reveals if a', 'tooth is safe or a snapper. 3 per round.'], demo: 'xray' },
  { t: "YOU'RE READY!", b: ['Hit the target before your BITES run out,', 'climb 8 antes. Good luck out there!'], demo: 'win' },
];
// ========================= FIELD TRAINING ==================================
//  Mrs Owlet teaches on the model, not on a slideshow.  The script below is
//  a list of beats: each one sets her line, her mood, where she stands and
//  what her pointer is on, and some wait for you to actually DO the thing
//  (press a tooth, bank, scan) before she carries on.  Then a timed pop
//  quiz on her clipboard, then a real practical on the model, then a stamp.
// ==========================================================================
const IV_QS = [
  { q: 'A gator opens wide. What are you actually paid to do?', a: ['Press teeth, then BANK TEETH x MULT', 'Count the gator', 'Run'], right: 0, why: 'Every safe tooth pays. Bank it before the jaws move.' },
  { q: 'One tooth in that mouth is a SNAPPER. Press it and?', a: ['Nothing, it is decorative', 'The jaws slam and the unbanked bite is lost', 'You get paid double'], right: 1, why: 'A snapper ends the bite. Everything unbanked goes with it.' },
  { q: 'You are one tooth from the target. What does a professional do?', a: ['Press every last tooth', 'BANK the bite and keep the score', 'Close their eyes and hope'], right: 1, why: 'Banking locks it in. Greed is how I lose rangers.' },
  { q: 'The X-RAY. What is it for?', a: ['Looking cool', 'Showing if one tooth is safe or a snapper', 'Warming your hands'], right: 1, why: 'A few per gator. Spend them when it matters.' },
];
const IV_TIME = 10;
const IV_TARGET = 40;

function ivModel(snapAt) {
  const vals = [3, 5, 2, 4, 6, 3];
  return { open: 1, openT: 1, sheet: 0, sheetT: -1, xr: -1, xrA: 0, teeth: vals.map((v, i) => ({ v, snap: i === snapAt, pressed: false, rev: null, mark: false })) };
}
function ivReroll(iv, keepSheet) {
  const snap = ri(0, 5);
  iv.m.teeth = iv.m.teeth.map((T, i) => ({ v: ri(2, 7), snap: i === snap, pressed: false, rev: null, mark: false }));
  iv.pool = { teeth: 0, mult: 1 };
}
const OWL_SPOTS = { desk: { x: 176, y: 202 }, model: { x: 252, y: 214 }, board: { x: 238, y: 214 } };

const IV_SCRIPT = [
  { id: 'enter', auto: 2.4, owl: 'desk', expr: 'grump', say: '' },
  { say: "You're late. Everyone is late. Stand there. Do NOT touch anything.", owl: 'desk', expr: 'grump' },
  { say: "I am Mrs Owlet. I run this park, and I train the fools who put their hands in its mouths.", owl: 'desk', expr: 'stern' },
  { say: "And today you learn on THIS.", owl: 'model', expr: 'stern', min: 2.6,
    update: (iv) => { if (iv.t > 1.3 && iv.m.sheetT < 0) { iv.m.sheetT = 0; sfx.whoosh(); fxConfetti(380, 120, 10); } } },
  { say: "Crocodylus dentalis. A full-size training model. It cost more than you do.", owl: 'model', expr: 'pleased', point: 'eye' },
  { say: "Every gator in this park has a mouth full of teeth. Each tooth is worth something. That is your pay.", owl: 'model', point: 'teeth', hl: 'teeth' },
  { say: "Go on. PRESS a tooth. Click one on the model.", owl: 'model', point: 'teeth', press: 1, wait: iv => iv.pressedN >= 1 },
  { say: "Its value goes on the board as TEETH, and every safe tooth adds one to your MULT. Press two more.", owl: 'board', point: 'board', press: 1, hl: 'board', wait: iv => iv.pressedN >= 3 },
  { say: "TEETH times MULT is your BITE. That number is the whole job.", owl: 'board', point: 'board', hl: 'bite', expr: 'pleased' },
  { say: "Now BANK it, bottom right. A banked bite is yours forever.", owl: 'model', point: 'bank', bank: 1, wait: iv => iv.bankedN >= 1 },
  { say: "Good. Now for the part that costs rangers their fingers.", owl: 'model', expr: 'stern' },
  { say: "One tooth in every mouth is a SNAPPER. Press it, and...", owl: 'model', expr: 'stern', point: 'snapper', min: 3.6,
    enter: (iv) => { iv.m.teeth.forEach((T, i) => { T.snap = i === 3; T.pressed = false; T.rev = null; }); iv.pool = { teeth: 0, mult: 1 }; iv.demo = 0; },
    update: (iv) => {
      if (iv.demo === 0 && iv.t > 0.7) { iv.demo = 1; ivPress(iv, 0, true); }
      if (iv.demo === 1 && iv.t > 1.3) { iv.demo = 2; ivPress(iv, 1, true); }
      if (iv.demo === 2 && iv.t > 1.9) { iv.demo = 3; iv.m.teeth[3].mark = true; }
      if (iv.demo === 3 && iv.t > 2.5) { iv.demo = 4; iv.m.teeth[3].mark = false; ivPress(iv, 3, true); iv.broke = true; }
    } },
  { say: "...That was my good pointer.", owl: 'model', expr: 'grump', min: 0.8 },
  { say: "Everything you had NOT banked is gone. The jaws do not negotiate.", owl: 'board', point: 'board', hl: 'lost', expr: 'stern' },
  { say: "So you LOOK before you press. That is the X-RAY.", owl: 'model', point: 'scanner', min: 2.4,
    enter: (iv) => { ivReroll(iv); iv.m.xr = 0; iv.m.xrA = 1; sfx.xray(); },
    update: (iv) => { iv.m.xr = Math.min(1, iv.t / 1.4); } },
  { say: "Your turn. Hit X-RAY, then click a tooth to scan it.", owl: 'model', point: 'xraybtn', xray: 1, wait: iv => iv.scannedN >= 1,
    enter: (iv) => { iv.m.xrA = 0; iv.m.xr = -1; iv.m.teeth.forEach(T => { T.rev = null; }); } },
  { say: (iv) => iv.lastScan === 'snap' ? "Red. That one bites. Leave it ALONE." : "Green. That one is safe to press.", owl: 'model', point: 'scanned', expr: 'pleased' },
  { say: "You get only a few X-RAYS per gator. Spend them when the maw is nearly empty.", owl: 'model', expr: 'stern' },
  { say: "Each gator gives you a few BITES. Beat its TARGET before they run out. Eight antes. Then the King.", owl: 'board', point: 'board', hl: 'target' },
  { say: "Enough talk. Pop quiz. Four questions. The clock is running.", owl: 'board', expr: 'stern', next: 'quiz' },
];

function startTutorial(k) {
  k = k || meta.ranger || 'scout';
  if (!rangerUnlocked(k)) k = 'scout';
  G.iv = {
    k, step: 0, t: 0, sayT: 0, said: '', phase: 'lesson',
    m: ivModel(-1), pool: { teeth: 0, mult: 1 }, banked: 0, pressedN: 0, bankedN: 0, scannedN: 0, lastScan: null,
    owl: { x: OWL_SPOTS.desk.x, y: OWL_SPOTS.desk.y }, rg: { x: -24 }, mode: 'idle', broke: false, lost: 0,
    quiz: null, prac: null, score: 0, fx: [],
  };
  G.iv.m.sheet = 1;
  ivStep(G.iv, 0);
  G.state = 'tutorial';
  sfx.whoosh();
}
function ivStep(iv, n) {
  iv.step = n; iv.t = 0; iv.sayT = 0;
  const S = IV_SCRIPT[n];
  if (!S) return;
  if (S.enter) S.enter(iv);
  iv.said = typeof S.say === 'function' ? S.say(iv) : (S.say || '');
}
function ivSay(txt) { if (G.iv) { G.iv.said = txt; G.iv.sayT = 0; } }
function ivFinish() {
  const iv = G.iv, k = iv ? iv.k : (meta.ranger || 'scout');
  meta.tutDone = true; meta.ranger = k; saveMeta();
  startTransition(() => { G.iv = null; newRun(k); startIntro(); });
}

// press one of the model's training teeth
function ivPress(iv, i, demo) {
  const T = iv.m.teeth[i];
  if (!T || T.pressed) return;
  const r = cmToothRect(i);
  if (T.snap) {
    T.rev = 'snap';
    iv.m.open = 0; iv.m.openT = 0; iv.snapT = 0;
    shake = Math.max(shake, 10); flashRed = 0.35; sfx.snap();
    fxStars(r.cx, r.cy - 10, '#ff6a4a', 10, 120);
    for (let k = 0; k < 8; k++) parts.push({ x: r.cx, y: r.cy - 6, vx: (rnd() - 0.5) * 120, vy: -60 - rnd() * 80, t: 0, life: 0.9, col: '#b0783a', sz: 2, g: 260 });
    iv.lostBite = iv.pool.teeth * iv.pool.mult; iv.lost = 2.2;
    iv.pool = { teeth: 0, mult: 1 };
    if (iv.prac && !demo) { iv.prac.bites--; iv.prac.wait = 1.4; }
    return;
  }
  T.pressed = true;
  iv.pool.teeth += T.v; iv.pool.mult += 1;
  if (!demo) iv.pressedN++;
  float(r.cx, r.cy - 16, '+' + T.v, '#9fe0ff', 1);
  fxPop(r.cx, r.cy - 6, '#ffe089');
  sfx.click(3);
}
function ivBank(iv) {
  const v = iv.pool.teeth * iv.pool.mult;
  if (v <= 0) { sfx.error(); ivSay('Nothing to bank. Press a tooth first.'); return; }
  iv.banked += v; iv.bankedN++;
  iv.pool = { teeth: 0, mult: 1 };
  float(BOARD.x + 60, BOARD.y + 40, '+' + v, '#f0e080', 2, 1.2);
  sfx.coin(); sfx.buy();
  fxConfetti(BOARD.x + 50, BOARD.y + 40, 12);
  // the model snaps shut politely and a fresh set of teeth rolls in
  iv.m.openT = 0; iv.reset = 0.5;
  if (iv.prac) { iv.prac.bites--; iv.prac.wait = 0.9; }
}
function ivScan(iv, i) {
  const T = iv.m.teeth[i];
  if (!T || T.pressed || T.rev) { sfx.error(); return; }
  T.rev = T.snap ? 'snap' : 'safe';
  iv.lastScan = T.rev; iv.scannedN++; iv.scanned = i;
  iv.mode = 'idle';
  iv.beam = { i, t: 0 };
  if (iv.prac) iv.prac.xrays--;
  sfx.xray();
}

// where the pointer should rest for a beat
function ivPointAt(iv, key) {
  const m = iv.m;
  if (key === 'eye') { const e = cmT(208, 36); return { x: e.x, y: e.y }; }
  if (key === 'teeth') {
    const open = m.teeth.map((T, i) => i).filter(i => !m.teeth[i].pressed);
    const i = open.length ? open[Math.floor(tNow / 1.2) % open.length] : 0;
    const r = cmToothRect(i); return { x: r.cx, y: r.y + 2 };
  }
  if (key === 'snapper') { const r = cmToothRect(3); return { x: r.cx, y: r.y + 2 }; }
  if (key === 'scanned') { const r = cmToothRect(iv.scanned || 0); return { x: r.cx, y: r.y }; }
  if (key === 'board') return { x: BOARD.x + BOARD.w - 12, y: BOARD.y + 50 };
  if (key === 'scanner') return { x: 444, y: 70 };
  if (key === 'bank') return { x: 420, y: 250 };
  if (key === 'xraybtn') return { x: 420, y: 226 };
  return null;
}

// ------------------------------------------------------------ chalk -------
function chalkText(s, x, y, col) {
  drawText(s, x + 1, y + 1, '#12241c', 1);
  drawText(s, x, y, col, 1);
  ctx.save(); ctx.globalAlpha = 0.35; for (let k = 0; k < s.length; k += 3) rect(x + k * 5 + 1, y + 2, 1, 1, '#1c342a'); ctx.restore();
}
function chalkCircle(x, y, w, h) {
  const n = 40;
  for (let k = 0; k < n; k++) {
    const a = k / n * Math.PI * 2 + 0.3, j = Math.sin(k * 3.7) * 0.6;
    rect(Math.round(x + w / 2 + Math.cos(a) * (w / 2 + j)), Math.round(y + h / 2 + Math.sin(a) * (h / 2 + j)), 1, 1, '#f8f0a0');
  }
}
function drawChalkboard(iv, hl) {
  const B = BOARD, x = B.x + 6;
  const prac = iv.prac;
  let y = B.y + 6;
  chalkText(prac ? 'PRACTICAL' : 'LESSON', x, y, '#e8ecd8'); y += 10;
  rect(x, y - 3, B.w - 12, 1, '#8aa898');
  chalkText('TEETH', x, y, '#9fd8f0'); chalkText('' + iv.pool.teeth, x + 56, y, '#9fd8f0'); if (hl === 'board') chalkCircle(x - 3, y - 3, B.w - 6, 10); y += 9;
  chalkText('MULT', x, y, '#f0a0a8'); chalkText('X' + iv.pool.mult, x + 56, y, '#f0a0a8'); y += 9;
  const bite = iv.pool.teeth * iv.pool.mult;
  chalkText('BITE', x, y, '#ffffff'); chalkText('' + bite, x + 56, y, '#ffffff');
  if (hl === 'bite') chalkCircle(x - 3, y - 3, B.w - 6, 10);
  if (iv.lost > 0) {                                  // the lost bite, crossed out
    chalkText('' + (iv.lostBite || 0), x + 56, y, '#f06a5a');
    for (let k = 0; k < 18; k++) rect(x + 54 + k, y + 5 - Math.round(k / 3), 1, 1, '#f06a5a');
    chalkText('LOST!', x + 24, y, '#f06a5a');
  }
  if (hl === 'lost') chalkCircle(x - 3, y - 3, B.w - 6, 20);
  y += 10;
  rect(x, y - 2, B.w - 12, 1, '#8aa898');
  chalkText('BANKED', x, y + 1, '#f0e080'); chalkText('' + iv.banked, x + 56, y + 1, '#f0e080');
  y += 10;
  if (prac || hl === 'target') {
    chalkText('TARGET', x, y + 1, '#a8f0a0'); chalkText('' + IV_TARGET, x + 56, y + 1, '#a8f0a0');
    if (hl === 'target') chalkCircle(x - 3, y - 2, B.w - 6, 10);
  }
}

// ---------------------------------------------------- the dialogue box ---
function ivDialog(iv, S, canGo) {
  const x = 4, y = 214, w = 362, h = 52;
  goldFrame(x, y, w, h, { field: '#efe6d0', fieldD: '#d6cab0', fieldL: '#f8f2e2', r: 4 });
  // portrait
  goldFrame(x + 5, y + 5, 42, 42, { field: '#5e3e1e', fieldD: '#4a3016', fieldL: '#704a24', thin: 1, r: 3 });
  ctx.save(); ctx.beginPath(); ctx.rect(x + 8, y + 8, 36, 36); ctx.clip();
  ctx.translate(x + 26, y + 32); ctx.scale(1.05, 1.05);
  const talking = iv.sayT < iv.said.length / 40 + 0.15;
  drawOwletHead({ expr: (S && S.expr) || 'grump', talk: talking, look: { x: 0.4, y: 0.2 } });
  ctx.restore();
  woodBanner(x + 52, y - 6, 74, 11, 'MRS. OWLET', { col: '#ffe6b0' });
  const total = IV_SCRIPT.length;
  if (iv.phase === 'lesson') drawText('LESSON ' + Math.min(total, iv.step + 1) + '/' + total, x + w - 70, y + 6, '#9a8a6a', 1);
  drawSmallWrapped(iv.said.slice(0, Math.floor(iv.sayT * 40)), x + 54, y + 12, w - 64, '#241a10');
  if (canGo && iv.sayT * 40 >= iv.said.length && Math.sin(tNow * 6) > -0.3) {
    for (let k = 0; k < 4; k++) rect(x + w - 16 + k, y + h - 12 + k, 7 - k * 2, 1, '#8a5a2a');
    drawText('CLICK', x + w - 44, y + h - 11, '#9a8a6a', 1);
  }
  if (S && S.wait && !S.wait(iv)) {
    const a = 0.6 + Math.sin(tNow * 5) * 0.3;
    ctx.save(); ctx.globalAlpha = a; drawText('YOUR TURN', x + w - 60, y + h - 11, '#c8401e', 1); ctx.restore();
  }
}

// the practical's scoreboard and the two tools
function ivTools(iv, allow) {
  const x = 370, y = 214, w = 106, h = 52;
  goldFrame(x, y, w, h, { field: '#1c2a30', fieldD: '#121c20', fieldL: '#26363e', r: 4 });
  const P = iv.prac;
  if (P) {
    drawText('BITES', x + 6, y + 5, '#c8d4dc', 1);
    for (let k = 0; k < 2; k++) rr(x + 36 + k * 8, y + 5, 6, 6, 2, k < P.bites ? '#fdfaec' : '#3a4a52');
    drawText('XR', x + 60, y + 5, '#9fd8f0', 1);
    for (let k = 0; k < 2; k++) rr(x + 74 + k * 8, y + 5, 6, 6, 3, k < P.xrays ? '#3f8cff' : '#3a4a52');
  } else drawText('TOOLS', x + 6, y + 5, '#c8d4dc', 1);
  const xrOn = allow.xray && iv.mode !== 'xray', bkOn = allow.bank;
  button(x + 5, y + 14, w - 10, 17, iv.mode === 'xray' ? 'PICK A TOOTH' : 'X-RAY', '#3f8cff', '#1e4fa3', () => {
    if (iv.mode === 'xray') { iv.mode = 'idle'; return; }
    iv.mode = 'xray'; sfx.xray();
  }, { id: 'ivxray', disabled: !allow.xray });
  button(x + 5, y + 33, w - 10, 17, 'BANK BITE', '#3aa84a', '#1c5a24', () => ivBank(iv), { id: 'ivbank', disabled: !bkOn });
  const glow = (bx, by) => { ctx.save(); ctx.globalAlpha = 0.3 + Math.sin(tNow * 6) * 0.2; rr(bx - 2, by - 2, w - 6, 21, 4, '#ffe89a'); ctx.restore(); };
  if (xrOn && !iv.prac) glow(x + 5, y + 14);
  if (bkOn && !iv.prac && iv.pool.teeth > 0) glow(x + 5, y + 33);
}

function drawTutorial(dt) {
  const iv = G.iv; if (!iv) { G.state = 'menu'; return; }
  iv.t += dt; iv.sayT += dt;
  const S = iv.phase === 'lesson' ? IV_SCRIPT[iv.step] : null;
  if (S && S.update) S.update(iv, dt);
  if (iv.lost > 0) iv.lost -= dt;

  // ------------------------------------------------ the model's motion ---
  const m = iv.m;
  if (iv.snapT !== undefined && iv.snapT !== null) {
    iv.snapT += dt;
    if (iv.snapT > 1.1) { m.openT = 1; iv.snapT = null; if (iv.prac) { ivReroll(iv); } }
  }
  if (iv.reset !== undefined && iv.reset !== null) {
    iv.reset -= dt;
    if (iv.reset <= 0) { iv.reset = null; ivReroll(iv); m.openT = 1; }
  }
  m.open += (m.openT - m.open) * Math.min(1, dt * (m.openT > m.open ? 5 : 16));
  if (m.sheetT >= 0 && m.sheetT < 1) { m.sheetT += dt * 1.6; if (m.sheetT >= 1) m.sheet = 0; }

  // ------------------------------------------------ owl and ranger -------
  const spot = OWL_SPOTS[(S && S.owl) || (iv.phase === 'lesson' ? 'model' : 'board')] || OWL_SPOTS.model;
  const O = iv.owl;
  const odx = spot.x - O.x, ody = spot.y - O.y, od = Math.hypot(odx, ody);
  O.walk = od > 0.8;
  if (O.walk) { const sp = 70 * dt; O.x += odx / od * Math.min(sp, od); O.y += ody / od * Math.min(sp, od); }
  const R = iv.rg;
  R.x = Math.min(96, R.x + dt * 70);

  // --------------------------------------------------------- draw -------
  paintCached('office', 0, 0, W, H, officeStatic);
  vistaLive(16, 20, 74, 74, { sunX: 0.3, hz: 0.6, flies: 4 });
  // live office bits: clock hands, CRT text, steam, fan-lit dust
  const hA = tNow * 0.02, mA = tNow * 0.3;
  pxLine(334, 66, 334 + Math.cos(hA) * 4, 66 + Math.sin(hA) * 4, '#1a1206');
  pxLine(334, 66, 334 + Math.cos(mA) * 6, 66 + Math.sin(mA) * 6, '#3a2a1a');
  rect(333, 65, 2, 2, '#a83a2a');
  const crt = ['GATOR.DB', 'RANGERS: 5', 'FINGERS: 47', 'SNAPS: ' + (12 + (meta.lifeSnaps || 0)), 'STATUS: GRUMPY'];
  ctx.save(); ctx.beginPath(); ctx.rect(153, 118, 30, 22); ctx.clip();
  const scroll = Math.floor(tNow * 0.8) % crt.length;
  for (let k = 0; k < 3; k++) { const ln = crt[(scroll + k) % crt.length]; drawText(ln.slice(0, 6), 154, 119 + k * 7, '#5af07a', 1); }
  if (Math.sin(tNow * 6) > 0) rect(154 + 26, 133, 3, 5, '#5af07a');
  ctx.globalAlpha = 0.12; for (let y = 118; y < 140; y += 2) rect(153, y, 30, 1, '#000000');
  ctx.restore();
  drawTextC('' + ((iv.snapCount || 0) ? 0 : 0), 348, 32, '#c83a2a', 2);
  for (let k = 0; k < 3; k++) { const st = (tNow * 0.7 + k * 0.33) % 1; ctx.save(); ctx.globalAlpha = 0.35 * (1 - st); rect(136 + Math.sin(st * 6 + k) * 2, 140 - st * 14, 2, 2, '#f0f0f0'); ctx.restore(); }
  for (let k = 0; k < 3; k++) { const st = (tNow * 0.5 + k * 0.33) % 1; ctx.save(); ctx.globalAlpha = 0.3 * (1 - st); rect(72 + Math.sin(st * 5 + k) * 2, 124 - st * 12, 2, 2, '#f0f0f0'); ctx.restore(); }
  // mug on the desk
  rr(132, 142, 8, 8, 2, '#1a1a1a'); rr(133, 143, 6, 6, 1, '#e8e0d0'); rect(139, 144, 2, 3, '#e8e0d0'); rect(134, 144, 4, 1, '#4a2a14');
  drawChalkboard(iv, S && S.hl);

  // Mrs Owlet is behind the desk until she comes round it
  const owlBehind = O.x < 228 && O.y < 208;
  const owlExpr = (S && S.expr) || (iv.phase === 'quiz' ? (iv.quiz && iv.quiz.timeLeft < 3 ? 'stern' : 'grump') : 'grump');
  const talking = iv.sayT < iv.said.length / 40 + 0.15;
  let pt = S && S.point ? ivPointAt(iv, S.point) : null;
  if (iv.phase === 'prac' && iv.hover >= 0 && iv.hover !== undefined) pt = null;
  const owlO = { flip: !O.walk && pt && pt.x < O.x - 4, expr: owlExpr, talk: talking, walk: O.walk, point: O.walk ? null : pt, broke: iv.broke, look: pt ? { x: 1, y: -0.2 } : { x: -0.6, y: 0.2 }, clip: iv.phase === 'quiz' || (!pt && iv.phase === 'result') };
  if (owlBehind) {
    if (iv.step <= 2 && iv.phase === 'lesson') owlO.look = { x: -0.2, y: 0.8 };   // eyes on the screen
    drawOwlet(O.x, O.y, owlO);
  }
  // redraw the desk front over her legs when she is behind it
  if (owlBehind) {
    ctx.save(); ctx.beginPath(); ctx.rect(100, 150, 134, 52); ctx.clip();
    paintCached('office', 0, 0, W, H, officeStatic);
    rr(132, 142, 8, 8, 2, '#1a1a1a'); rr(133, 143, 6, 6, 1, '#e8e0d0');
    ctx.restore();
  }

  // the model and the student
  let hov = -1;
  const canPress = (S && S.press) || (iv.phase === 'prac' && iv.prac && iv.prac.wait <= 0 && iv.m.open > 0.8);
  const canScan = iv.mode === 'xray' && ((S && S.xray) || iv.phase === 'prac');
  if (canPress || canScan) {
    m.teeth.forEach((T, i) => { const r = cmToothRect(i); if (!T.pressed && mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h) hov = i; });
  }
  iv.hover = hov;
  drawCrocModel(m, { hov });
  if (iv.beam) {
    iv.beam.t += dt;
    const r = cmToothRect(iv.beam.i), f = clamp(iv.beam.t / 0.5, 0, 1);
    ctx.save(); ctx.globalAlpha = 0.5 * (1 - Math.max(0, iv.beam.t - 0.6));
    pxLine(452, 74, r.cx, r.y, '#9fe8ff', 2);
    ctx.globalAlpha *= 0.4; for (let k = -4; k <= 4; k += 2) pxLine(452, 74, r.cx + k, r.y + 4, '#7ad4f0');
    ctx.restore();
    if (f >= 1 && !iv.beam.popped) { iv.beam.popped = true; fxRing(r.cx, r.cy, iv.m.teeth[iv.beam.i].snap ? '#ff4030' : '#63d66a', 4, 50, 0.4); }
    if (iv.beam.t > 1.2) iv.beam = null;
  }
  if (!owlBehind) drawOwlet(O.x, O.y, owlO);
  const rgExpr = iv.lost > 0 ? 'scared' : iv.phase === 'result' ? 'happy' : (iv.pressedN > 0 && iv.t < 1 ? 'happy' : 'calm');
  drawBobble(R.x, 214, iv.k, { sc: 1.2, expr: rgExpr, act: R.x < 95 ? 'walk' : (iv.lost > 0 ? 'idle' : 'idle'), ...myFit() });

  // ------------------------------------------------------ interaction ----
  const typed = iv.sayT * 40 >= iv.said.length;
  let canGo = false;
  if (iv.phase === 'lesson' && S) {
    const waiting = S.wait && !S.wait(iv);
    canGo = !waiting && !S.auto && iv.t >= (S.min || 0.3);
    if (S.wait && !waiting && iv.t > 0.1) { iv.waitDone = (iv.waitDone || 0) + dt; if (iv.waitDone > 0.9) { iv.waitDone = 0; ivAdvance(iv); } }
    if (S.auto && iv.t > S.auto) ivAdvance(iv);
  }
  // clicking the dialogue (or anywhere empty) moves her along
  hit(0, 0, W, H, { id: 'ivadv', cb: () => {
    if (!typed) { iv.sayT = 99; return; }
    if (canGo) ivAdvance(iv);
    else if (iv.phase === 'quizwhy') ivQuizNext(iv);
  } });
  // the teeth on the model
  if (hov >= 0) {
    const r = cmToothRect(hov);
    hit(r.x, r.y, r.w, r.h, { id: 'ivt' + hov, cursor: true, cb: () => {
      if (canScan) { ivScan(iv, hov); return; }
      if (canPress) ivPress(iv, hov, false);
    } });
  }
  // ------------------------------------------------------ phases ---------
  if (iv.phase === 'quiz' || iv.phase === 'quizwhy') drawIvQuiz(iv, dt);
  else if (iv.phase === 'prac') ivPractical(iv, dt);
  else if (iv.phase === 'result') drawIvResult(iv, dt);

  const allow = { xray: (S && S.xray) || (iv.phase === 'prac' && iv.prac && iv.prac.xrays > 0 && iv.prac.wait <= 0), bank: (S && S.bank) || (iv.phase === 'prac' && iv.prac && iv.prac.wait <= 0 && iv.pool.teeth > 0) };
  ivDialog(iv, S, canGo || iv.phase === 'quizwhy');
  if (iv.phase !== 'result') ivTools(iv, allow);

  // letterbox for the opening beat
  if (iv.phase === 'lesson' && iv.step === 0) {
    const bh = Math.round(24 * (1 - clamp((iv.t - 1.6) / 0.8, 0, 1)));
    rect(0, 0, W, bh, '#000'); rect(0, H - bh, W, bh, '#000');
    if (iv.t < 2.2) { ctx.save(); ctx.globalAlpha = clamp(iv.t * 2, 0, 1) * clamp((2.2 - iv.t) * 3, 0, 1); drawTextCSh("EVERGLADES HQ  -  THE PARK MANAGER'S OFFICE", W / 2, 8, '#ffe6b0', 1); ctx.restore(); }
  }
  if (iv.phase !== 'result') button(W - 58, 3, 54, 14, 'SKIP', '#4a4438', '#28241c', ivFinish, { id: 'ivskip', tip: 'SKIP TRAINING|Straight to the swamp' });
}
function ivAdvance(iv) {
  const S = IV_SCRIPT[iv.step];
  iv.waitDone = 0;
  if (S && S.next === 'quiz') { ivStartQuiz(iv); return; }
  if (iv.step + 1 < IV_SCRIPT.length) ivStep(iv, iv.step + 1);
  sfx.click(1);
}

// ------------------------------------------------------ the pop quiz ------
function ivStartQuiz(iv) {
  iv.phase = 'quiz'; iv.quiz = { q: 0, timeLeft: IV_TIME, picked: -1, slide: 0, correct: 0 };
  iv.m.xrA = 0;
  ivSay(IV_QS[0].q);
}
function ivQuizNext(iv) {
  const Q = iv.quiz;
  Q.q++; Q.picked = -1; Q.timeLeft = IV_TIME; iv.phase = 'quiz';
  if (Q.q >= IV_QS.length) { ivStartPractical(iv); return; }
  ivSay(IV_QS[Q.q].q);
}
function drawIvQuiz(iv, dt) {
  const Q = iv.quiz, Qd = IV_QS[Math.min(Q.q, IV_QS.length - 1)];
  Q.slide = Math.min(1, Q.slide + dt * 3);
  if (iv.phase === 'quizwhy' && iv.sayT > 4.5) { ivQuizNext(iv); return; }
  if (iv.phase === 'quiz' && Q.picked < 0) {
    Q.timeLeft -= dt;
    if (Q.timeLeft <= 0) { Q.picked = -2; iv.phase = 'quizwhy'; ivSay('Time. That counts as a no. ' + Qd.why); sfx.error(); }
  }
  const px = Math.round(W + 10 - easeOut(Q.slide) * 236), py = 18, pw = 222, ph = 190;
  // her clipboard, big
  rr(px + 3, py + 4, pw, ph, 4, '#00000077');
  plasticBox(px, py, pw, ph, 4, ['#1e120a', '#5a3818', '#7a4e24', '#946232', '#b88048'], { seed: 13 });
  woodGrain(px + 3, py + 3, pw - 6, ph - 6, '#5a3818', '#946232', 3);
  paperSheet(px + 6, py + 12, pw - 12, ph - 18, {});
  plasticBox(px + pw / 2 - 22, py + 2, 44, 14, 3, MET, { noShine: 1 }); rect(px + pw / 2 - 16, py + 6, 32, 2, MET[1]);
  drawText('POP QUIZ', px + 12, py + 18, '#a83a2a', 1);
  drawText('Q' + (Q.q + 1) + ' OF ' + IV_QS.length, px + pw - 50, py + 18, '#8a7a58', 1);
  // the stopwatch
  const frac = clamp(Q.timeLeft / IV_TIME, 0, 1);
  fillCircle(px + 18, py + 36, 7, '#1a1a1a'); fillCircle(px + 18, py + 36, 6, '#e8e8e0');
  rect(px + 17, py + 27, 3, 3, '#1a1a1a');
  pxLine(px + 18, py + 36, px + 18 + Math.cos(-Math.PI / 2 + (1 - frac) * Math.PI * 2) * 5, py + 36 + Math.sin(-Math.PI / 2 + (1 - frac) * Math.PI * 2) * 5, frac < 0.3 ? '#c8301f' : '#1a1a1a');
  segBar(px + 30, py + 32, pw - 44, 9, frac, { tint: frac < 0.3 ? '#d94f30' : '#63d66a', tintL: '#ffffff' });
  rect(px + 10, py + 46, pw - 20, 1, '#c8b890');
  const qy = drawSmallWrapped(Qd.q, px + 12, py + 51, pw - 24, '#241a10');
  Qd.a.forEach((txt, i) => {
    const ay = Math.max(qy + 4, py + 76) + i * 34;
    const chosen = Q.picked === i, correct = Q.picked !== -1 && i === Qd.right;
    const over = Q.picked === -1 && mx >= px + 10 && mx < px + pw - 10 && my >= ay && my < ay + 30;
    const face = correct ? ['#123014', '#2b6b2c', '#3f9440', '#63d66a', '#b8f0b0'] : chosen ? ['#3a0c0c', '#7a1f1f', '#b03030', '#e06a5a', '#ffb0a0']
      : over ? ['#3a2a0a', '#d8c890', '#f0e2b0', '#f8f0d0', '#ffffff'] : ['#2a1d12', '#c8bca0', '#e4dac2', '#f2ead8', '#ffffff'];
    plasticBox(px + 10, ay + (over ? -1 : 0), pw - 20, 30, 3, face, { noShine: 1, smooth: 1 });
    plasticBox(px + 14, ay + 6 + (over ? -1 : 0), 18, 18, 3, ['#2a1d12', '#9a8f76', '#c4bba2', '#e4dcc6', '#ffffff'], { noShine: 1, smooth: 1 });
    drawTextC(String.fromCharCode(65 + i), px + 23, ay + 12 + (over ? -1 : 0), '#2a1d12', 1);
    drawSmallWrapped(txt, px + 38, ay + 6 + (over ? -1 : 0), pw - 54, correct || chosen ? '#ffffff' : '#241a10');
    if (Q.picked === -1) hit(px + 10, ay, pw - 20, 30, { id: 'ivq' + i, cursor: true, cb: () => {
      Q.picked = i; iv.phase = 'quizwhy';
      if (i === Qd.right) { Q.correct++; iv.score++; ivSay('Correct. ' + Qd.why); sfx.win(); fxStars(px + pw / 2, ay + 15, '#63d66a', 10, 100); }
      else { ivSay('Wrong. ' + Qd.why); sfx.error(); shake = Math.max(shake, 4); }
    } });
  });
  // her red pen marks
  if (Q.picked >= 0 && Q.picked === Qd.right) { ctx.save(); ctx.globalAlpha = 0.85; ringPx(px + pw - 26, py + 30, 10, '#c8301f'); drawTextC('A+', px + pw - 26, py + 27, '#c8301f', 1); ctx.restore(); }
}

// ----------------------------------------------------- the practical ------
function ivStartPractical(iv) {
  iv.phase = 'prac'; iv.banked = 0; iv.pool = { teeth: 0, mult: 1 };
  iv.prac = { bites: 2, xrays: 2, wait: 0.6, tries: (iv.prac && iv.prac.tries) || 0 };
  iv.broke = false;
  ivReroll(iv); iv.m.openT = 1;
  ivSay('Paperwork done. Now the practical. Score ' + IV_TARGET + ' on the model. Two bites. Two X-rays. Go.');
}
function ivPractical(iv, dt) {
  const P = iv.prac;
  if (P.wait > 0) P.wait -= dt;
  if (P.done) return;
  if (iv.banked >= IV_TARGET && P.wait <= 0.3) {
    P.done = true; iv.score++;
    iv.phase = 'result'; iv.t = 0; iv.stamped = false;
    ivSay(iv.score >= 5 ? 'Textbook. Hm. Welcome to the patrol.' : iv.score >= 3 ? 'Adequate. You are hired. Do not make me regret it.' : 'Dreadful. You are hired anyway. We are short-staffed.');
    sfx.win(); fxConfetti(W / 2, 90, 30);
    return;
  }
  if (P.bites <= 0 && P.wait <= 0 && iv.pool.teeth === 0) {
    P.tries++;
    if (P.tries >= 2) {
      P.done = true; iv.phase = 'result'; iv.t = 0; iv.stamped = false;
      ivSay('Pathetic. But the swamp does not wait, and neither do I. You are hired.');
      return;
    }
    ivSay('Out of bites, short of the target. Again. From the top.');
    ivStartPractical(iv);
    iv.said = 'Out of bites, short of the target. Again. From the top.'; iv.sayT = 0;
  }
}
// ----------------------------------------------------- the certificate ----
function drawIvResult(iv, dt) {
  const px = 244, py = 16, pw = 228, ph = 192;
  const sl = easeOut(clamp(iv.t * 2.5, 0, 1));
  const yy = Math.round(py - (1 - sl) * 220);
  paperSheet(px, yy, pw, ph, { ramp: ['#3a2a10', '#d8c890', '#f0e4bc', '#f8f0d8', '#ffffff'] });
  goldFrame(px + 6, yy + 6, pw - 12, ph - 12, { field: '#f4ead0', fieldD: '#e4d8b8', fieldL: '#fbf4e0', thin: 1, flat: 1 });
  drawTextC('CERTIFICATE', px + pw / 2, yy + 16, '#8a5a1a', 2);
  drawTextC('OF FIELD DUTY', px + pw / 2, yy + 30, '#8a5a1a', 1);
  rect(px + 24, yy + 40, pw - 48, 1, '#c8a060');
  drawTextC('THIS CERTIFIES THAT', px + pw / 2, yy + 46, '#6a5a3a', 1);
  drawTextC(RANGERS[iv.k].name, px + pw / 2, yy + 56, '#241a10', 2);
  drawTextC(RANGERS[iv.k].animal, px + pw / 2, yy + 70, '#6a5a3a', 1);
  drawTextC('MAY PUT THEIR HANDS IN GATORS', px + pw / 2, yy + 80, '#6a5a3a', 1);
  const marks = IV_QS.length + 1;
  for (let k = 0; k < marks; k++) {
    const on = k < iv.score, bx = px + pw / 2 - marks * 17 + k * 34 + 4;
    plasticBox(bx, yy + 92, 26, 20, 3, on ? ['#123014', '#2b6b2c', '#3f9440', '#63d66a', '#b8f0b0'] : ['#2a1d12', '#a89e86', '#c4bba2', '#ded6c0', '#ffffff'], { noShine: 1, smooth: 1 });
    if (on) { [[7, 102], [9, 104], [11, 102], [13, 100], [15, 98], [17, 96]].forEach(([cx, cy]) => rect(bx + cx, yy + cy, 2, 2, '#0f2a0f')); }
    else { for (let j = 0; j < 5; j++) { rect(bx + 9 + j, yy + 98 + j, 2, 2, '#8a2a16'); rect(bx + 15 - j, yy + 98 + j, 2, 2, '#8a2a16'); } }
  }
  drawTextC('GRADE: ' + ['F', 'D', 'C', 'B', 'A', 'A+'][clamp(iv.score, 0, 5)], px + pw / 2, yy + 118, '#241a10', 1);
  drawBadgeSeal(px + 30, yy + 150, iv.k);
  rect(px + pw - 96, yy + 158, 80, 1, '#6a5a3a'); drawText('H. OWLET', px + pw - 86, yy + 150, '#2a3a6a', 1);
  // the stamp slams down
  const sT = clamp(iv.t - 0.9, 0, 1);
  if (sT > 0) {
    const drop = (1 - easeOut(sT)) * 60;
    ctx.save();
    ctx.translate(px + pw / 2 + 6, yy + 140 - drop); ctx.rotate(-0.16);
    ctx.globalAlpha = 0.92;
    rr(-58, -15, 116, 30, 4, '#8a2a16'); rr(-55, -12, 110, 24, 3, '#f4e0d0'); rr(-53, -10, 106, 20, 2, '#c23a2a');
    drawTextC('APPROVED', 0, -4, '#ffe8d8', 2);
    ctx.restore();
    if (sT >= 1 && !iv.stamped) { iv.stamped = true; shake = Math.max(shake, 7); sfx.buy(); sfx.thunk(); fxRing(px + pw / 2, yy + 140, '#ff8a6a', 6, 80, 0.4); }
  }
  if (iv.t > 2.0) button(370, 216, 106, 48, 'REPORT FOR DUTY >', '#d94f30', '#8a2a16', ivFinish, { id: 'ivdone' });
}
function drawBadgeSeal(x, y, k) {
  for (let r = 0; r < 12; r++) { const a = r / 12 * Math.PI * 2; rect(x + Math.round(Math.cos(a) * 15) - 2, y + Math.round(Math.sin(a) * 15) - 2, 5, 5, '#c89a2a'); }
  fillCircle(x, y, 14, '#8a5a10'); fillCircle(x, y, 13, '#d8a830'); fillCircle(x, y, 10, '#f0c848');
  drawRangerBadge(x - 10, y - 10, k, { sc: 0.72, tier: 0 });
  rect(x - 10, y + 13, 6, 12, '#a83a2a'); rect(x + 4, y + 13, 6, 12, '#a83a2a'); rect(x - 10, y + 23, 3, 2, '#f4ead0'); rect(x + 7, y + 23, 3, 2, '#f4ead0');
}


// ==================== SUMMER EVENT: hermit crabs, camera, Manta ====================
// a little hermit crab that scuttles onto a tooth in the Maldives stage
function drawCrab(cx, cy, sc) {
  sc = sc || 1;
  const R = (dx, dy, w, h, c) => rect((cx + dx * sc) | 0, (cy + dy * sc) | 0, Math.max(1, (w * sc) | 0), Math.max(1, (h * sc) | 0), c);
  R(-1, -4, 8, 7, '#c86a3a'); R(0, -3, 6, 5, '#e8935a'); R(2, -2, 3, 3, '#f4b47a'); R(1, -1, 2, 2, '#8a4a24'); // spiral shell
  R(-6, 1, 8, 4, '#e8542a'); R(-5, 2, 7, 3, '#ff7a4a');           // body
  R(-7, 4, 2, 2, '#e8542a'); R(-4, 5, 2, 2, '#e8542a'); R(-1, 5, 2, 2, '#e8542a'); // legs
  R(-9, 0, 4, 2, '#ff7a4a'); R(-10, -1, 2, 2, '#ff7a4a'); R(1, 0, 3, 2, '#ff7a4a'); // claws
  R(-5, -2, 1, 3, '#e8542a'); R(-2, -2, 1, 3, '#e8542a'); R(-5, -3, 1, 1, '#101010'); R(-2, -3, 1, 1, '#101010'); // eyestalks
}
function updateCrabs(dt) {
  G.crabs = G.crabs.filter(c => { c.t += dt; const sl = G.mouth[c.i]; return c.t < 6.5 && sl && !sl.pressed && !sl.gone; });
  G.crabT -= dt;
  if (G.crabT <= 0) {
    G.crabT = (3.5 + rnd() * 3.5) * (has('crabclaw') ? 0.6 : 1);
    const avail = G.mouth.map((s, i) => i).filter(i => { const sl = G.mouth[i]; return sl && !sl.pressed && !sl.gone && !G.crabs.some(c => c.i === i); });
    if (avail.length) { G.crabs.push({ i: choice(avail), t: 0 }); }
  }
}
function catchCrab(c) {
  const p = toothScreenPos(c.i);
  const bonus = has('crabclaw') ? 3 : 0;
  gainMoney(2 + bonus);
  G.crabs = G.crabs.filter(x => x !== c);
  float(p.x, p.y - 24, '+' + (2 + bonus) + ' CR', '#ff9838', 1);
  burst(p.x, p.y - 12, '#ff9838', 8, 60);
  quest('crab5', 1);
  sfx.coin();
}
function drawCrabs() {
  G.crabs.forEach(c => {
    const s = G.mouth[c.i]; if (!s || s.pressed || s.gone) return;
    const p = toothScreenPos(c.i), bob = Math.sin(tNow * 6 + c.i) * 1.5;
    const cx = p.x, cy = p.y - 15 + bob;
    drawCrab(cx, cy, 1.4);
    if ((tNow * 3 | 0) % 2) rect((cx + 6) | 0, (cy - 6) | 0, 1, 1, '#fff');
    hit(cx - 12, cy - 8, 24, 22, { id: 'crab' + c.i, cursor: true, tip: 'HERMIT CRAB|Click to catch: +2 CRABS', cb: () => catchCrab(c) });
  });
}
// Professor Manta wants a photo of every mutation
function capturePhoto() {
  if (!G.mut || meta.summer.caught[G.mut]) return;
  meta.summer.caught[G.mut] = true; saveMeta();
  quest('photo1', 1); quest('photo2', 1); quest('photo_' + G.mut, 1);
  G.photoT = 0.4;
  float(W / 2 + 40, 90, 'PHOTO CAPTURED!', '#8fe8ff', 2, 1.6);
  float(W / 2 + 40, 112, MUTATIONS[G.mut].name + ' LOGGED', '#ffffff', 1, 1.6);
  burst(W / 2 + 40, 120, '#ffffff', 16, 80);
  sfx.ach();
}
// summer tickets retired with the summer menu: they quietly pay out as cookies
function addTix(n) { meta.rp = (meta.rp || 0) + n * 10; saveMeta(); }

// a tiny mutation portrait chip for the photo album
function drawMutChip(cx, cy, k) {
  const mu = MUTATIONS[k];
  rr(cx - 11, cy - 6, 22, 13, 3, '#00000055'); rr(cx - 10, cy - 5, 20, 11, 3, mu.col);
  const eye = k === 'albino' ? '#c81818' : '#101018';
  rect(cx - 6, cy - 2, 3, 3, eye); rect(cx + 3, cy - 2, 3, 3, eye);
  for (let t = 0; t < 4; t++) rect(cx - 8 + t * 5, cy + 4, 2, 3, '#f4f0dc');
  if (k === 'diamond') rect(cx - 1, cy - 6, 2, 2, '#ffffff');
  if (k === 'alien') { rect(cx - 6, cy - 10, 1, 4, mu.col); rect(cx + 5, cy - 10, 1, 4, mu.col); rect(cx - 6, cy - 11, 1, 1, '#c8ff9c'); rect(cx + 5, cy - 11, 1, 1, '#c8ff9c'); }
  if (k === 'mega') rect(cx - 10, cy - 7, 20, 2, '#00000055');
  if (k === 'spotted') { rect(cx - 8, cy - 4, 2, 2, mu.tint.d); rect(cx + 6, cy - 3, 2, 2, mu.tint.d); rect(cx - 2, cy + 1, 2, 2, mu.tint.d); rect(cx + 4, cy + 1, 2, 2, mu.tint.d); }
  if (k === 'striped') { for (let s = 0; s < 4; s++) rect(cx - 8 + s * 5, cy - 5, 1, 9, mu.tint.d); }
}
// Professor Manta: a bespectacled manta-ray marine biologist (polished top-view)
function drawManta(x, y) {
  const b = y + Math.round(Math.sin(tNow * 1.4) * 2), fl = Math.sin(tNow * 1.9);
  const D1 = '#1f3448', D2 = '#31506d', D3 = '#4c7392', PALE = '#c8dcec';
  // soft shadow
  ctx.save(); ctx.globalAlpha = 0.2; fillCircle(x, b + 40, 32, '#000'); ctx.restore();
  // ---- broad pectoral wings: columns that sweep up + taper toward the tips ----
  for (let s = 1; s <= 36; s++) {
    const t = s / 36;
    const topY = b + 10 - Math.pow(t, 1.25) * (28 + fl * 6);   // graceful upward wing-beat
    const h = Math.max(2, Math.round(28 * (1 - t * 0.9)));
    const col = s < 5 ? D3 : (s < 24 ? D2 : D1);
    rect((x - 5 - s) | 0, topY | 0, 3, h, col);                // left wing
    rect((x + 2 + s) | 0, topY | 0, 3, h, col);                // right wing
    if (s < 20) rect((x - 5 - s) | 0, (topY + h - 2) | 0, 3, 2, D1); // trailing-edge shade
    if (s < 20) rect((x + 2 + s) | 0, (topY + h - 2) | 0, 3, 2, D1);
  }
  // ---- central body (raised diamond) ----
  fillCircle(x, b + 15, 14, D1); fillCircle(x, b + 14, 12, D2); fillCircle(x - 3, b + 11, 8, D3);
  fillCircle(x + 1, b + 21, 8, '#5f83a0');                       // pale underside gradient
  // gill hint on the back
  ctx.save(); ctx.globalAlpha = 0.35; rect(x - 6, b + 16, 12, 1, D1); rect(x - 5, b + 19, 10, 1, D1); ctx.restore();
  // ---- tail ----
  for (let s = 0; s < 16; s++) rect(x - 1, (b + 30 + s) | 0, 2, 1, s < 4 ? D2 : D1);
  // ---- head + cephalic horns curling forward ----
  rr(x - 10, b - 2, 20, 13, 6, D2); rr(x - 9, b - 1, 18, 11, 5, D3);
  rect(x - 9, b - 7, 3, 7, D2); rect(x - 10, b - 2, 2, 4, D2);   // left horn
  rect(x + 6, b - 7, 3, 7, D2); rect(x + 8, b - 2, 2, 4, D2);    // right horn
  // ---- kind eyes + round gold professor spectacles ----
  critterEye(x - 8, b + 1, 6, 6, D2, '#f8f4dc', '#141c24', 3.0);
  critterEye(x + 2, b + 1, 6, 6, D2, '#f8f4dc', '#141c24', 3.4);
  ring(x - 5, b + 4, 4, '#ffd54a', 1); ring(x + 5, b + 4, 4, '#ffd54a', 1); // round lens rings
  rect(x, b + 3, 2, 1, '#ffd54a');                              // bridge
  rect(x - 12, b + 3, 3, 1, '#ffd54a'); rect(x + 10, b + 3, 3, 1, '#ffd54a'); // temples
  // tiny cheek blush + smile
  rect(x - 4, b + 8, 9, 1, '#20303e');
}

// the summer shopkeep: a cool beach duck in aviators + a lei
function drawDuckVendor(x, y) {
  const b = y + Math.round(Math.sin(tNow * 1.3) * 1.5);
  ctx.save(); ctx.globalAlpha = 0.22; fillCircle(x + 23, b + 54, 24, '#000'); ctx.restore();
  // ---- body (layered) + pale belly ----
  fillCircle(x + 23, b + 33, 22, '#c8901f'); fillCircle(x + 23, b + 32, 21, '#eec24e'); fillCircle(x + 19, b + 28, 16, '#f8d874');
  fillCircle(x + 23, b + 40, 14, '#fbe8a8'); fillCircle(x + 23, b + 38, 11, '#fff2cf');
  // ---- hawaiian vest (teal + pink flowers) ----
  rr(x + 2, b + 20, 13, 27, 3, '#1f8577'); rr(x + 31, b + 20, 13, 27, 3, '#1f8577');
  rect(x + 5, b + 21, 4, 25, '#2fb0a0'); rect(x + 37, b + 21, 4, 25, '#2fb0a0');
  [[6, 26], [9, 34], [35, 29], [38, 39]].forEach(([fx, fy]) => { rect(x + fx, b + fy, 2, 2, '#ff6a8a'); rect(x + fx - 1, b + fy, 1, 1, '#ffd0dc'); });
  // ---- flower lei ----
  [[12, 18], [16, 19], [20, 20], [26, 20], [30, 19], [34, 18]].forEach(([lx, ly], i) => fillCircle(x + lx, b + ly, 2, i % 2 ? '#ff6a8a' : '#ffffff'));
  // ---- head ----
  fillCircle(x + 23, b + 9, 13, '#eec24e'); fillCircle(x + 21, b + 6, 10, '#f8d874'); fillCircle(x + 19, b + 5, 6, '#fce89a');
  // ---- bill ----
  rr(x + 29, b + 8, 13, 5, 2, '#ff9838'); rr(x + 29, b + 12, 11, 3, 1, '#e8842a'); rect(x + 30, b + 9, 8, 1, '#ffbf6a');
  // ---- aviator sunglasses ----
  rr(x + 13, b + 4, 19, 6, 2, '#14141c'); rr(x + 14, b + 5, 7, 4, 1, '#3a6a8a'); rr(x + 23, b + 5, 7, 4, 1, '#3a6a8a');
  rect(x + 15, b + 6, 2, 1, '#8fd0e8'); rect(x + 24, b + 6, 2, 1, '#8fd0e8'); rect(x + 20, b + 6, 3, 1, '#14141c');
  // ---- pink sun visor ----
  rr(x + 11, b + 1, 24, 3, 1, '#ff6a8a'); rr(x + 9, b + 3, 28, 2, 1, '#ff85a0'); rect(x + 20, b, 6, 1, '#ff6a8a');
  // ---- wings ----
  const wave = Math.sin(tNow * 3) > 0.3 ? -5 : 0;
  rr(x - 7, b + 22 + wave, 15, 10, 4, '#c8901f'); rr(x - 6, b + 23 + wave, 13, 8, 4, '#eec24e');
  rr(x + 40, b + 39, 13, 8, 4, '#c8901f'); rr(x + 41, b + 40, 11, 6, 4, '#eec24e');
}

function drawHow() {
  const th = THEMES.shop;
  drawSceneBack(th);
  drawSceneFront(th);
  overlayDim(0.4);
  const px = 60, py = 10, pw = 360, ph = 252;
  panel(px, py, pw, ph, { face: '#16222af5' });
  drawTextCSh('HOW TO BITE', px + pw / 2, py + 8, C.gold, 2);
  const L = [
    ['PRESS TEETH. Each safe tooth adds its value to', C.white],
    ['TEETH and grows your MULT chain by +1.', C.dim],
    ['', C.dim],
    ['ONE (OR MORE) TOOTH IS A SNAPPER. Press it and', C.red],
    ['the jaw SNAPS: your whole unbanked bite is LOST.', C.dim],
    ['', C.dim],
    ['BANK BITE to lock in TEETH X MULT. 3 BITES per', C.gold],
    ['round to reach the target. X-RAYS scan teeth.', C.dim],
    ['', C.dim],
    ['THE SHOP: buy CHARMS (passive powers), CARDS', C.purple],
    ['(one-shot) and SPECIAL TEETH for your deck.', C.dim],
    ['CLICK any card for details. DRAG cards onto the', C.white],
    ['gator to use them. DRAG charms to the barrel', C.white],
    ['to sell. EXTRACTION drags onto a single tooth.', C.white],
    ['', C.dim],
    ['Pick your path on the SWAMP TRAIL each ante:', C.green],
    ['easy, risky or golden gators, and ? EVENTS.', C.dim],
    ['Bosses bend the rules. Earn ACHIEVEMENTS for', C.dim],
    ['GLOVES. Beat 8 antes. Good luck, dentist.', C.green],
  ];
  let y = py + 26;
  L.forEach(([t, c]) => { drawTextC(t, px + pw / 2, y, c, 1); y += 11; });
  button(px + pw / 2 - 45, py + ph - 26, 90, 18, 'GOT IT', '#d94f30', '#8a2a16', () => { G.state = G.howFrom; }, { id: 'gotit' });
}

// ------------------------------------------------------- ranger select ----
let rangerFocus = null;
// ===================== EVERGLADES HQ: THE FRONT OFFICE ====================
//  You do not "pick a character" - you apply for the job.  Mrs Owlet runs the
//  park and reads your file across the desk; the roster is a stack of
//  applications on her clipboard, each with a mastery record and the
//  exclusive badge that rank earns you.
// ==========================================================================
const MASTERY_XP = [0, 50, 150, 350, 700];
const MASTERY_TIER = ['ROOKIE', 'FIELD HAND', 'SENIOR', 'VETERAN', 'LEGEND'];
const MASTERY_COL = ['#9aa4a8', '#c48a3a', '#c8d2d8', '#ffd54a', '#8fe8ff'];
function masteryXp(k) { return (meta.mastery && meta.mastery[k]) || 0; }
function masteryLvl(k) {
  const xp = masteryXp(k);
  let l = 0; for (let i = 0; i < MASTERY_XP.length; i++) if (xp >= MASTERY_XP[i]) l = i;
  return l;
}
function masteryNext(k) {
  const l = masteryLvl(k);
  if (l >= MASTERY_XP.length - 1) return null;
  return { need: MASTERY_XP[l + 1], have: masteryXp(k), from: MASTERY_XP[l] };
}
function addMastery(k, n) {
  if (!k || !n) return;
  if (!meta.mastery) meta.mastery = {};
  const before = masteryLvl(k);
  meta.mastery[k] = (meta.mastery[k] || 0) + n;
  const after = masteryLvl(k);
  if (after > before) {
    toasts.push({ name: (RANGERS[k] || RANGERS.scout).name + ' - ' + MASTERY_TIER[after], sub: 'MASTERY RANK UP! NEW BADGE EARNED', t: 0 });
    sfx.win();
  }
  saveMeta();
}

// ---------------------------------------------------------- MRS OWLET ----
// A grumpy old barn owl in a hand-knit plum cardigan: grey bun with a
// pencil jammed through it, half-moon spectacles on a chain, a string of
// pearls and a pointer stick she is not afraid to use.  Her eyes never shut -
// the grumbling is all in the brows and the beak.
const OWL = {
  fe: ['#1a140e', '#5a4c3c', '#7a6a56', '#9c8a72', '#c2b296'],
  disc: ['#2a2218', '#b4a488', '#d4c6aa', '#eadfc6', '#fbf4e2'],
  knit: ['#1a0c18', '#4a2442', '#673660', '#86507c', '#a8739c'],
  chest: ['#2a2216', '#b8a680', '#dccfae', '#eee4cc', '#ffffff'],
  bun: ['#1c1a18', '#7c7670', '#9c968e', '#bcb6ae', '#e2dcd4'],
  beak: ['#2e2006', '#8a6414', '#c8962a', '#e8c25a', '#fff0b0'],
  iris: '#e8a21a', irisD: '#a0620a',
};
const OWL_BODY = eggSpans(40, 18, 0.58, 9);
const SPEC = ['#2a3036', '#7a8690', '#b4c0c8', '#dde6ec', '#ffffff'];   // silver rims

// a pixel-stepped line (no anti-aliased strokes anywhere in the art)
function pxLine(x0, y0, x1, y1, col, th) {
  th = th || 1;
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) | 0;
  for (let i = 0; i <= n; i++) {
    const f = n ? i / n : 0;
    rect(Math.round(x0 + (x1 - x0) * f), Math.round(y0 + (y1 - y0) * f), th, th, col);
  }
}
// a one-pixel circle outline, optionally only part of it
function ringPx(cx, cy, r, col, a0, a1) {
  a0 = a0 === undefined ? 0 : a0; a1 = a1 === undefined ? Math.PI * 2 : a1;
  const n = Math.max(8, Math.round(r * 7));
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * i / n;
    rect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 1, 1, col);
  }
}
// a sheet of HQ paper: grainy stock, a drop shadow and a dog-eared corner
function paperSheet(x, y, w, h, o) {
  o = o || {};
  x |= 0; y |= 0;
  rr(x + 2, y + 3, w, h, 2, '#00000066');
  plasticBox(x, y, w, h, 2, o.ramp || ['#3a2c18', '#cdbf9c', '#ebe1c6', '#f7f0de', '#ffffff'], { flat: 1, seed: x + y });
  if (o.ruled) for (let yy = y + (o.ruledTop || 14); yy < y + h - 4; yy += 8) rect(x + 4, yy, w - 8, 1, '#d8ccb0');
  if (!o.noCorner) { rect(x + w - 6, y + 1, 5, 1, '#d8ccb0'); rect(x + w - 5, y + 2, 4, 1, '#c8b890'); rect(x + w - 3, y + 3, 2, 1, '#b8a880'); }
}
// how many lines drawSmallWrapped will use for this text at this width
function wrapCount(txt, w) {
  const words = ('' + txt).toUpperCase().split(' '), maxChars = Math.floor(w / 5);
  let line = '', n = 1;
  words.forEach(word => { if ((line + ' ' + word).trim().length > maxChars) { n++; line = word; } else line = line + ' ' + word; });
  return n;
}
// the wooden speech box everyone in HQ talks through
function hqBubble(x, y, w, h, txt, t, o) {
  o = o || {};
  x |= 0; y |= 0;
  rr(x + 2, y + 3, w, h, 4, '#00000066');
  plasticBox(x, y, w, h, 4, ['#1e150c', '#d9cfb6', '#f1ead8', '#faf6ea', '#ffffff'], { flat: 1, seed: 7 });
  if (o.tail) {
    const tx = o.tail.x | 0, dn = o.tail.y > y;
    for (let k = 0; k < 5; k++) rect(tx - (4 - k), dn ? y + h - 1 + k : y - k, (4 - k) * 2 + 1, 1, k === 4 ? '#1e150c' : '#f1ead8');
    rect(tx - 5, dn ? y + h - 1 : y, 1, 1, '#1e150c'); rect(tx + 5, dn ? y + h - 1 : y, 1, 1, '#1e150c');
  }
  if (o.name) drawText(o.name, x + 5, y + 4, o.nameCol || '#8a6a3a', 1);
  const shown = ('' + txt).slice(0, Math.floor(t * 40));
  drawSmallWrapped(shown, x + 5, y + (o.name ? 13 : 5), w - 10, '#241a10');
}

function drawOwletHead(o) {
  o = o || {};
  const P = OWL, ex = o.expr || 'grump', t = tNow + (o.phase || 0);
  const lk = o.look || { x: 0, y: 0 };
  // ---- the bun, a pencil stabbed through it ----
  plasticBox(-8, -26, 16, 11, 5, P.bun, { seed: 2 });
  rect(-5, -23, 9, 1, P.bun[1]); rect(-6, -20, 11, 1, P.bun[1]); rect(-3, -25, 5, 1, P.bun[3]);
  pxLine(-13, -27, 10, -18, '#1e150c', 3);
  pxLine(-12, -26, 9, -19, '#e8b830', 1); pxLine(-12, -27, 9, -20, '#f8d860', 1);
  rect(-14, -28, 3, 3, '#e87a8a'); rect(-14, -28, 3, 1, '#ffb0b8');       // eraser
  rect(10, -19, 2, 2, '#2a2016');                                        // graphite tip
  // ---- ear tufts ----
  [-1, 1].forEach(s => {
    const bx = s * 12;
    for (let k = 0; k < 6; k++) rect(bx - 3 + (s > 0 ? k * 0 : 0) + (s < 0 ? -k * 0.5 : k * 0.5), -20 - k, 6 - k, 1, k === 5 ? P.fe[0] : P.fe[k > 2 ? 3 : 2]);
    rect(bx - 4, -20, 1, 3, P.fe[0]); rect(bx + 3, -20, 1, 3, P.fe[0]);
  });
  // ---- the head itself ----
  plasticBox(-18, -17, 36, 32, 11, P.fe, { seed: 5 });
  for (let k = 0; k < 12; k++) {                                         // speckled plumage
    const sx = -14 + ((k * 11) % 28), sy = -14 + ((k * 7) % 8);
    rect(sx, sy, 2, 1, P.fe[4]); rect(sx + 1, sy + 1, 1, 1, P.fe[1]);
  }
  // ---- facial disc: two soft lobes meeting at a crease ----
  plasticBox(-16, -11, 17, 22, 8, P.disc, { noShine: 1, seed: 1 });
  plasticBox(-1, -11, 17, 22, 8, P.disc, { noShine: 1, seed: 2 });
  rect(-1, -9, 2, 18, P.disc[2]);
  rect(0, -10, 1, 19, P.disc[1]);
  for (let k = 0; k < 7; k++) { rect(-15 + k * 5, 10 - (k % 2), 2, 1, P.disc[1]); }   // ruffled rim
  // ---- eyes: huge, amber, always wide open ----
  const dx = Math.round(clamp(lk.x, -1, 1) * 1.5), dy = Math.round(clamp(lk.y, -1, 1) * 1);
  [-7, 7].forEach(cx => {
    rr(cx - 5, -6, 11, 11, 4, '#1a1206');
    rr(cx - 4, -5, 9, 9, 3, P.iris);
    rect(cx - 3, 1, 7, 2, P.irisD); rect(cx - 3, -4, 3, 1, '#f8c850');
    rr(cx - 2 + dx, -3 + dy, 5, 5, 1, '#0c0804');
    rect(cx - 2 + dx, -3 + dy, 2, 2, '#ffffff');
    rect(cx + 2 + dx, 1 + dy, 1, 1, '#ffffffaa');
    if (ex === 'grump' || ex === 'stern') rect(cx - 4, -5, 9, 1, P.disc[1]);  // a heavy upper lid line, eye still open
  });
  // ---- half-moon spectacles on a chain ----
  [-7, 7].forEach(cx => {
    ringPx(cx, -1, 6, SPEC[1], 0, Math.PI);
    ringPx(cx, -1, 7, SPEC[0], 0.1, Math.PI - 0.1);
    rect(cx - 6, -1, 13, 1, SPEC[3]); rect(cx - 6, 0, 13, 1, SPEC[1]);
    ctx.save(); ctx.globalAlpha = 0.28;
    pxLine(cx - 3, 3, cx + 1, -1, '#ffffff'); pxLine(cx, 4, cx + 3, 1, '#ffffff');
    ctx.restore();
  });
  rect(-2, -1, 4, 1, SPEC[3]);
  rect(-16, -1, 3, 1, SPEC[2]); rect(13, -1, 3, 1, SPEC[2]);
  // ---- brows: thick feathered ledges that do all the acting ----
  const lift = ex === 'shock' ? -4 : ex === 'pleased' ? -2 : ex === 'talk' ? -1 : 0;
  const tiltB = ex === 'grump' ? 3 : ex === 'stern' ? 4 : ex === 'shock' ? -1 : ex === 'pleased' ? -1 : 2;
  [-1, 1].forEach(s => {
    for (let k = 0; k < 11; k++) {
      const f = k / 10, xx = s < 0 ? -13 + k : 13 - k;           // outer -> inner
      const yy = -10 + lift + Math.round(f * tiltB) - (k === 3 ? 1 : 0);
      rect(xx, yy, 1, 3, P.fe[0]);
      rect(xx, yy, 1, 1, P.fe[3]);
    }
    rect(s < 0 ? -15 : 13, -10 + lift, 2, 2, P.fe[0]);            // a stray wisp
  });
  // ---- wrinkles: crow's feet, she has earned them ----
  [-1, 1].forEach(s => { rect(s * 14 - (s < 0 ? 1 : 0), 2, 2, 1, P.disc[1]); rect(s * 15 - (s < 0 ? 0 : 0), 4, 1, 1, P.disc[1]); rect(s * 12, 7, 2, 1, P.disc[1]); });
  // ---- the beak ----
  const talk = o.talk ? Math.abs(Math.sin(t * 11)) : 0;
  const drop = Math.round(talk * 3);
  if (drop > 0) { rr(-3, 6, 6, 3 + drop, 1, '#3a1410'); rect(-2, 7 + drop, 4, 1, '#c8505a'); }
  rect(-3, 3, 6, 1, P.beak[0]); rect(-3, 4, 6, 2, P.beak[3]); rect(-2, 6, 4, 1, P.beak[2]);
  rect(-1, 7, 2, 1, P.beak[2]); rect(0, 8, 1, 1, P.beak[1]); rect(-2, 4, 1, 1, P.beak[4]);
  rr(-2, 8 + drop, 4, 2, 1, P.beak[1]);                                  // lower mandible
  if (ex === 'grump' || ex === 'stern') { rect(-6, 9, 2, 1, P.disc[1]); rect(4, 9, 2, 1, P.disc[1]); rect(-7, 10, 1, 1, P.disc[1]); rect(6, 10, 1, 1, P.disc[1]); }
  if (ex === 'pleased') { rect(-6, 8, 2, 1, P.disc[1]); rect(4, 8, 2, 1, P.disc[1]); ctx.save(); ctx.globalAlpha = 0.3; rect(-15, 4, 4, 2, '#e87a8a'); rect(11, 4, 4, 2, '#e87a8a'); ctx.restore(); }
  if (ex === 'shock') { rect(-1, 11, 2, 2, '#3a1410'); }
}

// (x, y) = the floor between her feet.  o = {expr, talk, point:{x,y}, broke,
// walk, phase, look, clip, flip}
function drawOwlet(x, y, o) {
  o = o || {};
  const P = OWL, t = tNow + (o.phase || 0);
  const walk = !!o.walk;
  const bob = walk ? -Math.abs(Math.sin(t * 7)) * 2 : Math.sin(t * 1.3) * 0.6;
  ctx.save();
  ctx.translate(x | 0, y | 0);
  if (o.flip) ctx.scale(-1, 1);
  // contact shadow
  ctx.save(); ctx.globalAlpha = 0.3; ctx.scale(1, 0.28); fillCircle(0, -3, 17, '#000'); ctx.restore();
  // ---- talons ----
  [-1, 1].forEach(s => {
    const st = walk ? Math.round(Math.sin(t * 7 + (s > 0 ? Math.PI : 0)) * 2) : 0;
    const fx = s * 6 + st;
    rect(fx - 4, -4, 8, 2, '#5a3a0a'); rect(fx - 4, -3, 2, 3, '#c8902a'); rect(fx - 1, -3, 2, 3, '#c8902a'); rect(fx + 2, -3, 2, 3, '#c8902a');
    rect(fx - 4, 0, 1, 1, '#2a1a06'); rect(fx - 1, 0, 1, 1, '#2a1a06'); rect(fx + 2, 0, 1, 1, '#2a1a06');
  });
  ctx.translate(0, Math.round(bob));
  // ---- the feathered body ----
  bobShape(OWL_BODY, -44, P.fe, { seed: 9 });
  // barred breast feathers peeking between the cardigan fronts
  plasticBox(-9, -38, 18, 34, 5, P.chest, { noShine: 1, seed: 4 });
  for (let r = 0; r < 8; r++) for (let c = 0; c < 4; c++) {
    const cx = -6 + c * 4 + (r % 2) * 2, cy = -34 + r * 4;
    rect(cx - 1, cy, 1, 1, P.fe[2]); rect(cx, cy + 1, 1, 1, P.fe[2]); rect(cx + 1, cy, 1, 1, P.fe[2]);
  }
  // ---- the cardigan: two knitted fronts with ribbed texture ----
  [-1, 1].forEach(s => {
    const x0 = s < 0 ? -19 : 7;
    plasticBox(x0, -40, 12, 38, 4, P.knit, { noShine: 1, smooth: 1, seed: s + 3 });
    for (let yy = -38; yy < -4; yy += 2) for (let xx = x0 + 2; xx < x0 + 11; xx += 2) {
      rect(xx, yy + ((xx >> 1) & 1), 1, 1, P.knit[1]);                 // purl stitches
      rect(xx + 1, yy + 1 - ((xx >> 1) & 1), 1, 1, P.knit[3]);
    }
    rect(x0 + (s < 0 ? 10 : 1), -40, 1, 38, P.knit[4]);                 // placket edge
    rect(x0, -6, 12, 3, P.knit[1]); for (let xx = x0 + 1; xx < x0 + 11; xx += 2) rect(xx, -6, 1, 3, P.knit[3]);   // ribbed hem
  });
  [-30, -21, -12].forEach(by => { rect(8, by, 3, 3, '#2a1a0c'); rect(8, by, 2, 2, '#c8a060'); });   // buttons
  // pocket with a tissue tucked in
  plasticBox(-17, -20, 9, 7, 1, P.knit, { noShine: 1, smooth: 1 });
  rect(-16, -23, 5, 3, '#f4f0e6'); rect(-15, -24, 3, 1, '#ffffff'); rect(-14, -22, 1, 2, '#d8d0c0');
  // ---- pearls ----
  for (let k = 0; k < 7; k++) {
    const a = Math.PI * (0.15 + 0.7 * k / 6), px = Math.round(Math.cos(a) * 8), py = -42 + Math.round(Math.sin(a) * 5);
    rect(px - 1, py, 3, 3, '#6a6458'); rect(px - 1, py, 2, 2, '#f4efe6'); rect(px - 1, py, 1, 1, '#ffffff');
  }
  // ---- the wings/arms ----
  const sh = { x: 16, y: -37 };
  // the free wing: resting on a hip, or holding her clipboard
  ctx.save(); ctx.translate(-16, -37); ctx.rotate(o.clip ? -0.5 : 0.18);
  plasticBox(-5, 0, 10, 21, 3, P.knit, { noShine: 1, seed: 1 });
  for (let k = 0; k < 3; k++) rect(-3 + k * 2, 19, 2, 4 - k, P.fe[k === 1 ? 3 : 2]);
  if (o.clip) {
    plasticBox(-10, 16, 16, 20, 2, ['#1e150c', '#6a4a26', '#8a6232', '#a67a42', '#c8985a'], { noShine: 1 });
    paperSheet(-8, 19, 12, 15, { noCorner: 1 });
    rect(-5, 15, 6, 3, '#8a9aa4'); rect(-5, 15, 6, 1, '#d8e4ea');
    for (let k = 0; k < 4; k++) rect(-6, 22 + k * 3, 8 - (k & 1) * 3, 1, '#8a7a5a');
  }
  ctx.restore();
  // the pointer wing
  let ang = 0.35, len = 0;
  if (o.point) {
    const tx = (o.flip ? -1 : 1) * (o.point.x - x) - sh.x, ty = o.point.y - (y + bob) - sh.y;
    ang = Math.atan2(ty, tx);
    len = clamp(Math.hypot(tx, ty) - 12, 10, 70);
    if (o.broke) len = Math.min(len, 16);
  }
  ctx.save(); ctx.translate(sh.x, sh.y); ctx.rotate(o.point ? ang - Math.PI / 2 : -0.18);
  plasticBox(-5, -2, 10, 16, 3, P.knit, { noShine: 1, seed: 2 });
  for (let k = 0; k < 3; k++) rect(-3 + k * 2, 13, 2, 4 - k, P.fe[k === 1 ? 3 : 2]);
  if (o.point) {
    // the stick itself, in local space it runs straight down the wing
    rect(-1, 12, 3, len, '#3a2410'); rect(0, 12, 1, len, '#b0783a');
    if (o.broke) { rect(-2, 12 + len, 2, 2, '#b0783a'); rect(1, 12 + len + 1, 2, 2, '#8a5a2a'); rect(0, 12 + len + 2, 1, 2, '#e8c890'); }
    else { rect(-1, 12 + len, 3, 4, '#2a0c08'); rect(0, 12 + len, 1, 3, '#d8403a'); }
  }
  ctx.restore();
  // ---- the head ----
  ctx.save(); ctx.translate(0, -58 + Math.round(Math.sin(t * 1.3 + 1) * 0.5));
  drawOwletHead({ expr: o.expr, talk: o.talk, phase: o.phase, look: o.look });
  ctx.restore();
  // the spectacle chain, swinging down to her collar
  const sw = Math.sin(t * 1.1) * 1;
  [-1, 1].forEach(s => { for (let k = 0; k < 9; k++) rect(s * (16 - k * 0.3) + sw * k / 9, -59 + k * 2 + Math.round(Math.sin(k / 8 * Math.PI) * 2), 1, 1, SPEC[k & 1 ? 1 : 3]); });
  ctx.restore();
}

// ============================ PAINT CACHE ==================================
//  Heavy static backdrops (the HQ hall, the office, the title vista) are
//  painted once into an offscreen canvas at full supersample resolution and
//  then blitted every frame, so they can carry per-pixel dithering, grain and
//  clutter that would be far too slow to redraw 60 times a second.
// ==========================================================================
const PAINT_CACHE = {};
function paintCached(key, x, y, w, h, fn) {
  let c = PAINT_CACHE[key];
  if (!c) {
    c = document.createElement('canvas'); c.width = w * RS; c.height = h * RS;
    const c2 = c.getContext('2d'); c2.imageSmoothingEnabled = false; c2.setTransform(RS, 0, 0, RS, 0, 0);
    const main = ctx; ctx = c2;
    try { fn(); } finally { ctx = main; }
    PAINT_CACHE[key] = c;
  }
  ctx.drawImage(c, x, y, w, h);
}
// draw a ranger flooded with one colour (locked applicants wait in shadow)
const SIL = document.createElement('canvas'); SIL.width = 100 * RS; SIL.height = 110 * RS;
const SILC = SIL.getContext('2d');
function drawSilhouette(cx, gy, key, o, col, a) {
  SILC.setTransform(1, 0, 0, 1, 0, 0); SILC.clearRect(0, 0, SIL.width, SIL.height);
  SILC.imageSmoothingEnabled = false; SILC.setTransform(RS, 0, 0, RS, 0, 0);
  const main = ctx; ctx = SILC;
  try { drawBobble(50, 104, key, o); } finally { ctx = main; }
  SILC.setTransform(1, 0, 0, 1, 0, 0);
  SILC.globalCompositeOperation = 'source-atop'; SILC.globalAlpha = a; SILC.fillStyle = col;
  SILC.fillRect(0, 0, SIL.width, SIL.height);
  SILC.globalCompositeOperation = 'source-over'; SILC.globalAlpha = 1;
  ctx.drawImage(SIL, (cx | 0) - 50, (gy | 0) - 104, 100, 110);
}

// ======================= THE EVERGLADES AT DUSK ===========================
//  One painted vista reused through every window in HQ: a banded dusk sky,
//  a sun sinking behind a purple treeline, bald cypress with hanging moss
//  and still black water.  Static layer is cached; shimmer + fireflies live.
// ==========================================================================
const DUSK = ['#231a38', '#35264e', '#4e3262', '#744070', '#a45274', '#d06a6a', '#ec925e', '#f8bc6c', '#fde0a0'];
function vistaStatic(w, h, o) {
  o = o || {};
  const hz = Math.round(h * (o.hz || 0.62));
  // sky: dithered bands, no gradients
  for (let y = 0; y < hz; y++) {
    const f = Math.pow(y / hz, 1.25) * (DUSK.length - 1), i = Math.floor(f), fr = f - i;
    rect(0, y, w, 1, DUSK[i]);
    if (fr > 0.3 && i + 1 < DUSK.length) for (let x = (y & 1); x < w; x += (fr > 0.65 ? 1 : 2)) if (fr > 0.65 ? ((x + y) & 1) : 1) rect(x, y, 1, 1, DUSK[i + 1]);
  }
  // high stars in the dark band
  for (let k = 0; k < w / 6; k++) { const sx = Math.floor(hash2(k, 3) * w), sy = Math.floor(hash2(k, 5) * hz * 0.35); rect(sx, sy, 1, 1, k % 5 ? '#b8a8d8' : '#ffffff'); }
  // the sun, half gone
  const sx = Math.round(w * (o.sunX || 0.66)), sr = Math.max(6, Math.round(w * 0.09));
  fillCircle(sx, hz - 2, sr + 2, '#f8c070'); fillCircle(sx, hz - 2, sr, '#fde6b0'); fillCircle(sx, hz - 2, sr - 3, '#fff6dc');
  // cloud bars sliced across it
  [[0.08, 0.46, 0.34], [0.5, 0.52, 0.4], [0.2, 0.72, 0.5], [0.62, 0.8, 0.28]].forEach(([cx, cy, cw]) => {
    const x0 = Math.round(w * cx), y0 = Math.round(hz * cy), ww = Math.round(w * cw);
    rect(x0, y0, ww, 2, DUSK[Math.min(DUSK.length - 1, Math.round(cy * 8) - 1)]);
    rect(x0 + 3, y0 + 2, ww - 8, 1, '#5a3a62');
    rect(x0 + 2, y0 - 1, ww - 10, 1, '#f8c890');
  });
  // far treeline: a ragged purple strip
  for (let x = 0; x < w; x++) {
    const th = 3 + Math.floor(hash2(x >> 1, 7) * 4) + (hash2(x >> 3, 9) > 0.7 ? 4 : 0);
    rect(x, hz - th, 1, th, '#3a2848'); rect(x, hz - th, 1, 1, '#5a3a5e');
  }
  // water: the sky flipped, darker, with long calm streaks
  for (let y = hz; y < h; y++) {
    const f = (1 - (y - hz) / (h - hz)) * (DUSK.length - 3) + 1, i = clamp(Math.floor(f), 0, DUSK.length - 1);
    rect(0, y, w, 1, mixC(DUSK[i], '#0a0c18', 0.45));
  }
  for (let k = 0; k < 12; k++) { const yy = hz + 2 + Math.floor(hash2(k, 1) * (h - hz - 4)), xx = Math.floor(hash2(k, 2) * w); rect(xx, yy, 6 + (k % 4) * 5, 1, '#6a4a6e'); }
  // bald cypress with flared knees and moss
  (o.trees || [[0.12, 1], [0.36, 0.7], [0.88, 1.15]]).forEach(([tx, ts], n) => {
    const bx = Math.round(w * tx), top = Math.round(hz - h * 0.52 * ts), tw = Math.max(2, Math.round(3 * ts));
    rect(bx - tw, top + 6, tw * 2, hz - top - 4, '#140e1c');
    for (let k = 0; k < 5; k++) rect(bx - tw - k, hz - 5 + k, tw * 2 + k * 2, 1, '#140e1c');     // the flared foot
    rect(bx - tw - 5, hz - 1, 2, 2, '#140e1c'); rect(bx + tw + 4, hz, 2, 2, '#140e1c');      // knees
    for (let c = 0; c < 3; c++) {                                                       // flat tiers of canopy
      const cw = Math.round((10 + c * 5) * ts), cy = top + c * Math.round(7 * ts);
      rect(bx - cw, cy, cw * 2, 3, '#1a1424'); rect(bx - cw + 2, cy - 1, cw * 2 - 4, 1, '#1a1424');
      rect(bx - cw + 1, cy + 3, cw * 2 - 2, 1, '#221a2e');
      for (let m = 0; m < cw * 2; m += 3) {                                             // spanish moss
        const ml = 2 + Math.floor(hash2(m + n * 40, c) * 7 * ts);
        rect(bx - cw + m, cy + 3, 1, ml, '#3a3448');
      }
    }
    // reflection
    ctx.save(); ctx.globalAlpha = 0.45; rect(bx - tw, hz, tw * 2, Math.round((hz - top) * 0.4), '#140e1c'); ctx.restore();
  });
  // near reeds and lily pads
  for (let k = 0; k < w; k += 3) {
    const rh = 2 + Math.floor(hash2(k, 11) * 8);
    if (hash2(k, 13) > 0.45) rect(k, h - rh, 1, rh, '#0e0a12');
  }
  for (let k = 0; k < 5; k++) { const lx = Math.floor(hash2(k, 21) * (w - 10)), ly = hz + 5 + Math.floor(hash2(k, 22) * (h - hz - 10)); rr(lx, ly, 7, 2, 1, '#1e3a2a'); rect(lx + 1, ly, 3, 1, '#2e5a3a'); }
}
function vistaLive(x, y, w, h, o) {
  o = o || {};
  const hz = Math.round(h * (o.hz || 0.62)), sx = Math.round(w * (o.sunX || 0.66));
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  // sun glitter on the water, broken dashes that crawl
  for (let r = 0; r < (h - hz) / 2; r++) {
    const yy = y + hz + 1 + r * 2, ww = Math.max(2, 10 - r);
    const off = Math.round(Math.sin(tNow * 1.3 + r * 1.7) * 2);
    ctx.globalAlpha = 0.7 - r * 0.05;
    rect(x + sx - ww / 2 + off, yy, ww, 1, r < 2 ? '#fff0c8' : '#f8b870');
  }
  // slow ripple streaks
  ctx.globalAlpha = 0.35;
  for (let k = 0; k < 4; k++) {
    const yy = y + hz + 3 + k * Math.max(2, Math.floor((h - hz) / 5));
    const xx = x + ((tNow * (3 + k) + k * 37) % (w + 20)) - 10;
    rect(xx, yy, 8, 1, '#c88a8a');
  }
  // fireflies
  for (let k = 0; k < (o.flies || 6); k++) {
    const fx = x + ((hash2(k, 31) * w + Math.sin(tNow * 0.4 + k) * 8) % w), fy = y + hz - 4 - hash2(k, 32) * h * 0.3 + Math.sin(tNow * 0.9 + k * 2) * 3;
    const on = Math.sin(tNow * 2.2 + k * 1.9);
    if (on > 0.2) { ctx.globalAlpha = on * 0.35; rect(fx - 1, fy - 1, 3, 3, '#f8f080'); ctx.globalAlpha = on; rect(fx, fy, 1, 1, '#fffcc0'); }
  }
  // a heron flaps across now and then
  const hp = (tNow / 26) % 1;
  if (hp < 0.4) {
    const bx = x + w + 10 - (hp / 0.4) * (w + 20), by = y + hz * 0.4 + Math.sin(hp * 30) * 2, fl = Math.sin(tNow * 7) > 0;
    ctx.globalAlpha = 0.9;
    rect(bx, by, 4, 1, '#140e1c'); rect(bx - 2, by - 1, 2, 1, '#140e1c'); rect(bx + 4, by + 1, 3, 1, '#140e1c');
    rect(bx + 1, by + (fl ? -2 : 1), 1, 2, '#140e1c'); rect(bx + 2, by + (fl ? -3 : 2), 1, 1, '#140e1c');
  }
  ctx.restore();
}

// ====================== EVERGLADES HQ: THE WAITING HALL ====================
//  The run starts in the corridor outside Mrs Owlet's office.  Five
//  applicants wait behind a velvet rope; click one and they step up to the
//  mark in front of her door.  Locked rangers wait in shadow, and their
//  file lists what it takes to get them hired.  Knock, and she answers.
// ==========================================================================
const LOBBY_Q = [276, 318, 360, 402, 444];
const LOBBY_QY = 224;
const LOBBY_SPOT = { x: 218, y: 238 };
const LOBBY_LINES = {
  scout: ['Hi! I brought snacks. For the gators.', 'I can hold my breath for eight minutes!', 'Is it true they bite? Like, a lot?'],
  medic: ['I am a medic. Mostly I play dead.', 'Is she always this grumpy?', 'I brought a spare set of fingers.'],
  trader: ['Psst. Wanna buy a slightly used tooth?', 'I am only here for the dental plan.', 'Every gator has a price.'],
  frog: ['RIBBIT. I mean... ready.', 'I got bitten once. I bit back.', 'Point me at the big one.'],
  snail: ['I got here early. Three weeks early.', 'The teeth are not going anywhere.', 'Slow is smooth. Smooth is rich.'],
};
const LOCKED_LINES = ['Not yet. I have not earned my stripes.', 'She said come back when I have done something.', 'I am just here for the free coffee.'];
const OWLET_DOOR = {
  first: ['You. New one. Inside. NOW.', 'Hm. Another one. In you come. Wipe your feet.'],
  back: ['Back again? Fine. Try not to get eaten.', 'Paperwork is signed. Get out there.', 'The swamp is waiting. So is my lunch. Go.'],
  locked: ['...NOT YOU. Come back when you have done something.', 'Your file is sealed. Go away.'],
};
let lobby = null;

function lobbyInit() {
  lobby = { sel: null, t: 0, pos: {}, card: 0, say: null, knock: null, hint: 0 };
  RANGER_ORDER.forEach((k, i) => { lobby.pos[k] = { x: LOBBY_Q[i], y: LOBBY_QY, face: -1, walk: 0 }; });
}
function lobbySelect(k) {
  if (!lobby || lobby.knock) return;
  if (lobby.sel === k) return;
  lobby.sel = k; lobby.card = 0;
  const open = rangerUnlocked(k);
  lobby.say = { who: k, txt: choice(open ? LOBBY_LINES[k] : LOCKED_LINES), t: -0.9 };
  sfx.click(2);
  if (open) { meta.ranger = k; saveMeta(); }
}
function lobbyKnock() {
  if (!lobby || !lobby.sel || lobby.knock) return;
  lobby.knock = { t: 0, open: rangerUnlocked(lobby.sel), knocks: 0, said: false };
}
function lobbyGo() {
  const k = lobby.sel;
  lobby = null;
  if (!meta.tutDone) startTutorial(k);
  else startTransition(() => { newRun(k); startIntro(); });
}

// --------------------------------------------------------- the hall -------
const HALLW = ['#10201a', '#1a3228', '#22402f', '#2c4e3a', '#3a624a'];
const FLR = ['#1a0e06', '#36200e', '#4a2c14', '#5e3a1c', '#764a26'];
function hallStatic() {
  // ---- wallpaper with a stamped damask diamond ----
  rect(0, 0, W, 120, HALLW[2]);
  for (let y = 8; y < 118; y++) for (let x = (y % 2); x < W; x += 2) if (hash2(x, y) < 0.08) rect(x, y, 1, 1, HALLW[1]);
  for (let y = 14; y < 116; y += 16) for (let x = ((y / 16) & 1) * 12; x < W; x += 24) {
    rect(x + 3, y, 1, 1, HALLW[3]); rect(x + 2, y + 1, 3, 1, HALLW[3]); rect(x + 1, y + 2, 2, 1, HALLW[3]); rect(x + 4, y + 2, 2, 1, HALLW[3]);
    rect(x + 2, y + 3, 3, 1, HALLW[3]); rect(x + 3, y + 4, 1, 1, HALLW[3]); rect(x + 3, y + 2, 1, 1, HALLW[4]);
  }
  // crown moulding
  rect(0, 0, W, 4, UWOOD[1]); rect(0, 4, W, 2, UWOOD[3]); rect(0, 6, W, 2, UWOOD[0]);
  for (let x = 0; x < W; x += 6) rect(x, 1, 3, 2, UWOOD[2]);
  // chair rail + wainscot panels
  rect(0, 118, W, 2, UWOOD[4]); rect(0, 120, W, 3, UWOOD[2]); rect(0, 123, W, 1, UWOOD[0]);
  rect(0, 124, W, 72, UWOOD[1]);
  woodGrain(0, 124, W, 72, UWOOD[0], UWOOD[2], 3);
  for (let x = 4; x < W; x += 42) {
    rr(x, 130, 36, 58, 2, UWOOD[0]); rr(x + 1, 131, 34, 56, 2, UWOOD[2]);
    rect(x + 2, 131, 32, 1, UWOOD[4]); rect(x + 1, 132, 1, 54, UWOOD[3]);
    rect(x + 2, 186, 33, 1, UWOOD[0]); rect(x + 34, 132, 1, 54, UWOOD[1]);
    woodGrain(x + 3, 134, 30, 50, UWOOD[1], UWOOD[3], x);
  }
  rect(0, 194, W, 6, UWOOD[0]); rect(0, 194, W, 1, UWOOD[3]); rect(0, 196, W, 1, UWOOD[2]);
  // ---- floorboards ----
  rect(0, 200, W, 70, FLR[2]);
  for (let r = 0; r < 7; r++) {
    const y = 200 + r * 10;
    rect(0, y, W, 1, FLR[0]); rect(0, y + 1, W, 1, FLR[3]);
    for (let x = (r * 53) % 70; x < W; x += 70) { rect(x, y + 1, 1, 9, FLR[0]); rect(x + 2, y + 3, 1, 1, FLR[0]); rect(x + 2, y + 7, 1, 1, FLR[0]); rect(x + 1, y + 1, 1, 9, FLR[3]); }
    woodGrain(0, y + 2, W, 8, FLR[1], FLR[3], r * 7);
  }
  // scuffs and boot-worn path toward the door
  ctx.save(); ctx.globalAlpha = 0.18;
  for (let k = 0; k < 60; k++) rect(150 + hash2(k, 1) * 300, 208 + hash2(k, 2) * 50, 3 + hash2(k, 3) * 6, 1, '#c8a878');
  ctx.restore();
  // a long runner rug to the door
  rr(140, 224, 104, 30, 3, '#2a0c10'); rr(142, 226, 100, 26, 2, '#7a2430');
  rect(145, 229, 94, 1, '#c8a050'); rect(145, 248, 94, 1, '#c8a050');
  for (let x = 148; x < 238; x += 8) { rect(x, 236, 4, 1, '#c8a050'); rect(x + 1, 235, 2, 3, '#a8384a'); }
  grainRect(143, 227, 98, 24, '#6a1c28', '#94303e', 0.08, 5);
  for (let x = 142; x < 244; x += 3) { rect(x, 222, 1, 2, '#d8c8a0'); rect(x, 254, 1, 2, '#d8c8a0'); }   // fringe
  // "WAIT HERE" painted feet on the rug
  [[-6, 0], [4, -1]].forEach(([dx, dy]) => { rr(LOBBY_SPOT.x + dx - 2, LOBBY_SPOT.y - 8 + dy, 5, 7, 2, '#e8c840'); rect(LOBBY_SPOT.x + dx - 1, LOBBY_SPOT.y - 11 + dy, 3, 2, '#e8c840'); });

  // ---- the window onto the swamp (left) ----
  rr(10, 16, 104, 94, 2, UWOOD[0]);
  ctx.save(); ctx.translate(15, 21); vistaStatic(94, 84, { trees: [[0.14, 1], [0.44, 0.7], [0.92, 1.1]] }); ctx.restore();
  rect(10, 16, 104, 5, '#e8dcc0'); rect(10, 105, 104, 5, '#e8dcc0');
  rect(10, 16, 5, 94, '#e8dcc0'); rect(109, 16, 5, 94, '#e8dcc0');
  rect(60, 21, 3, 84, '#e8dcc0'); rect(15, 61, 94, 3, '#e8dcc0');
  rect(10, 16, 104, 1, '#fff8e8'); rect(10, 109, 104, 1, '#8a7a5a');
  rect(61, 21, 1, 84, '#fff8e8'); rect(15, 62, 94, 1, '#fff8e8');
  // half-drawn blind
  for (let k = 0; k < 7; k++) { rect(15, 21 + k * 3, 94, 2, '#d8ccac'); rect(15, 23 + k * 3, 94, 1, '#a89a78'); }
  rect(60, 42, 1, 14, '#8a7a5a'); rr(58, 55, 5, 4, 1, '#c8b890');
  // sill with a cactus and a tiny gator figure
  rect(6, 108, 112, 5, UWOOD[3]); rect(6, 108, 112, 1, UWOOD[4]); rect(6, 113, 112, 2, UWOOD[0]);
  rr(20, 100, 10, 8, 2, '#a84a2a'); rect(21, 100, 8, 2, '#c8683a'); rr(22, 88, 6, 13, 2, '#3a7a3a'); rect(23, 89, 2, 10, '#5aa04a'); rr(28, 92, 4, 5, 1, '#3a7a3a');
  rr(86, 102, 16, 6, 2, '#2e5a24'); rect(98, 100, 5, 3, '#2e5a24'); rect(88, 104, 12, 1, '#4a8a36'); rect(99, 100, 1, 1, '#f0e060');
  // ---- poster column: NOW HIRING ----
  paperSheet(118, 28, 26, 70, { ramp: ['#3a2410', '#c89a5a', '#e8c078', '#f4d898', '#fff0c8'] });
  drawText('NOW', 122, 33, '#7a1e14', 1); drawText('HIR', 122, 40, '#7a1e14', 1); drawText('ING', 122, 47, '#7a1e14', 1);
  rr(123, 56, 16, 14, 2, '#4a8a3a'); rect(125, 60, 12, 4, '#fdfaec'); rect(126, 58, 2, 2, '#fdfaec'); rect(134, 58, 2, 2, '#fdfaec');
  drawText('GOOD', 121, 75, '#3a2410', 1); drawText('PAY*', 121, 82, '#3a2410', 1);
  rect(121, 91, 20, 1, '#9a7a4a'); rect(121, 93, 14, 1, '#9a7a4a');
  pushPin(130, 30, PINS[2]);
  // ---- the water cooler ----
  rr(120, 146, 22, 50, 2, '#1a2226'); rr(121, 147, 20, 48, 2, '#dfe6e8');
  rect(122, 148, 5, 46, '#f6fafa'); rect(137, 148, 3, 46, '#aeb8bc');
  rr(124, 118, 14, 30, 5, '#2a5a7a'); rr(125, 119, 12, 28, 4, '#5aa8d8'); rect(127, 121, 3, 22, '#a8e0f8');
  rect(128, 160, 6, 5, '#3a4a50'); rect(129, 161, 2, 2, '#e84a3a'); rect(132, 161, 2, 2, '#3a8ae8');
  rect(124, 168, 14, 8, '#c8d0d4'); rect(126, 176, 10, 2, '#8a969c');
  // ---- the door frame and door (office) ----
  rect(144, 58, 96, 142, UWOOD[0]);
  plasticBox(146, 60, 92, 140, 2, UWOOD, { seed: 11 });
  woodGrain(148, 62, 88, 136, UWOOD[1], UWOOD[3], 44);
  rect(152, 68, 80, 132, '#120a04');
  // transom plate above the door
  plasticBox(158, 46, 68, 12, 2, UGOLD, { noShine: 1 });
  drawTextC('PARK MANAGER', 192, 49, '#3a2606', 1);
  // "NOW SERVING" box
  rr(170, 18, 44, 24, 2, '#0a0a0a'); rr(171, 19, 42, 22, 2, '#2a2a2a');
  drawTextC('NOW SERVING', 192, 21, '#c8c8c8', 1);
  rr(178, 28, 28, 11, 1, '#140404');
  rect(191, 42, 2, 4, '#3a3a3a');
  // ---- trophy case: the patrol's badges ----
  rect(250, 14, 222, 76, UWOOD[0]);
  plasticBox(252, 16, 218, 72, 2, UWOOD, { seed: 17 });
  rect(258, 22, 206, 60, '#0e1a16');
  for (let k = 0; k < 20; k++) rect(260 + hash2(k, 4) * 200, 24 + hash2(k, 6) * 54, 1, 1, '#1e3228');
  rect(258, 66, 206, 3, UWOOD[3]); rect(258, 69, 206, 2, UWOOD[0]);
  woodBanner(300, 8, 122, 12, 'HALL OF RANGERS', { col: '#ffe6b0' });
  // ---- velvet rope and brass posts behind the queue ----
  const posts = [256, 298, 340, 382, 424, 466];
  for (let i = 0; i < posts.length - 1; i++) {
    const a = posts[i], b = posts[i + 1];
    for (let x = a; x <= b; x++) { const f = (x - a) / (b - a), sag = Math.round(Math.sin(f * Math.PI) * 7); rect(x, 176 + sag, 1, 3, '#6a0e1c'); rect(x, 176 + sag, 1, 1, '#b83040'); }
  }
  posts.forEach(px => {
    rect(px - 5, 208, 11, 3, UGOLD[0]); rect(px - 4, 208, 9, 2, UGOLD[2]);
    rect(px - 1, 176, 3, 32, UGOLD[0]); rect(px, 176, 1, 32, UGOLD[3]);
    rr(px - 3, 171, 7, 6, 2, UGOLD[0]); rr(px - 2, 172, 5, 4, 2, UGOLD[3]); rect(px - 1, 172, 1, 1, UGOLD[4]);
  });
  // ---- bench under the window with a paper and a cold coffee ----
  rect(12, 176, 100, 4, UWOOD[3]); rect(12, 176, 100, 1, UWOOD[4]); rect(12, 180, 100, 2, UWOOD[0]);
  rect(12, 160, 100, 3, UWOOD[2]); rect(12, 163, 100, 1, UWOOD[0]);
  [16, 104].forEach(lx => { rect(lx, 160, 4, 40, UWOOD[1]); rect(lx, 160, 1, 40, UWOOD[3]); });
  paperSheet(30, 170, 22, 7, { noCorner: 1 }); rect(32, 172, 12, 1, '#6a5a3a'); rect(32, 174, 16, 1, '#8a7a5a');
  rr(80, 168, 7, 8, 1, '#e8e0d0'); rect(80, 168, 7, 2, '#4a2a14'); rect(87, 170, 2, 3, '#e8e0d0');
  // potted fern, far right
  rr(462, 186, 16, 14, 2, '#6a3a1a'); rect(463, 186, 14, 2, '#8a5a2a');
  for (let k = 0; k < 9; k++) { const a = -2.6 + k * 0.28, l = 14 + (k % 3) * 4; pxLine(470, 186, 470 + Math.cos(a) * l, 186 + Math.sin(a) * l, k % 2 ? '#3a7a3a' : '#2a5a2a'); }
  // brass wall sconces with a dithered pool of light under each
  [[236, 104], [476, 104]].forEach(([lx, ly]) => {
    for (let r = 0; r < 26; r++) for (let x = -r; x <= r; x += 2) if (hash2(x + lx, r) < 0.5 - r / 60) rect(lx + x + (r & 1), ly + 4 + r, 1, 1, '#4a6a52');
    rect(lx - 1, ly - 6, 3, 8, UGOLD[1]); rr(lx - 4, ly - 12, 9, 7, 2, '#f8e0a0'); rect(lx - 3, ly - 11, 3, 5, '#fff4d0'); rect(lx - 4, ly - 5, 9, 1, UGOLD[0]);
  });
}

function drawLobbyDoor(k) {
  const open = k ? k.doorOpen || 0 : 0;
  // what is behind the door: her office glowing warm
  if (open > 0) {
    rect(152, 68, 80, 132, '#3a2410');
    rect(152, 68, 80, 60, '#5a3a1c');
    // her bookcase, glimpsed past the door
    [80, 104, 128].forEach(sy => {
      rect(154, sy + 20, 76, 3, '#6a4020'); rect(154, sy + 20, 76, 1, '#8a5a30');
      let bx = 156;
      while (bx < 226) { const bw = 3 + Math.floor(hash2(bx, sy) * 3), bh = 12 + Math.floor(hash2(sy, bx) * 7); rect(bx, sy + 20 - bh, bw, bh, ['#8a2a1a', '#2a4a7a', '#3a6a2a', '#9a7a2a', '#5a2a5a'][Math.floor(hash2(bx, 3) * 5)]); rect(bx, sy + 22 - bh, bw, 1, '#e8d8a0'); bx += bw + 1; }
    });
    rect(152, 150, 80, 50, '#4a2c14'); for (let r = 0; r < 5; r++) rect(152, 150 + r * 10, 80, 1, '#2a1808');
    ctx.save(); ctx.globalAlpha = 0.35 + Math.sin(tNow * 3) * 0.03; rect(152, 68, 80, 132, '#ffcf80'); ctx.restore();
    if (k && k.owl) drawOwlet(180, 196, { expr: k.open ? 'grump' : 'stern', talk: k.talk, look: { x: 0.2, y: 0.4 } });
    // light spilling out on the floor
    ctx.save(); ctx.globalAlpha = 0.18 * open;
    for (let r = 0; r < 6; r++) rect(152 - r * 6, 200 + r * 5, 80 + r * 12, 5, '#ffd890');
    ctx.restore();
  }
  // the door leaf swings inward: it narrows toward its hinge on the left
  const dw = Math.round(80 * (1 - open * 0.86));
  if (dw > 2) {
    const dx = 152;
    plasticBox(dx, 68, dw, 132, 2, UWOOD, { seed: 23, noShine: 1 });
    if (dw > 30) {
      woodGrain(dx + 2, 70, dw - 4, 128, UWOOD[1], UWOOD[3], 71);
      // frosted glass pane
      const gx = dx + Math.round(8 * dw / 80), gw = Math.round(64 * dw / 80);
      rr(gx - 1, 79, gw + 2, 58, 2, UWOOD[0]);
      rect(gx, 80, gw, 56, '#b8ccc8');
      for (let y = 80; y < 136; y++) for (let x = gx + (y & 1); x < gx + gw; x += 2) if (hash2(x, y) < 0.4) rect(x, y, 1, 1, '#a4bab6');
      if (!open) {
        // her silhouette pacing behind the glass
        const sx = gx + gw / 2 + Math.sin(tNow * 0.35) * gw * 0.28, bob = Math.abs(Math.sin(tNow * 2.4)) * 1;
        ctx.save(); ctx.globalAlpha = 0.34;
        rr(sx - 11, 96 + bob, 22, 20, 7, '#3a4a48'); rect(sx - 10, 93 + bob, 4, 4, '#3a4a48'); rect(sx + 6, 93 + bob, 4, 4, '#3a4a48');
        rr(sx - 5, 91 + bob, 10, 6, 3, '#3a4a48'); rr(sx - 13, 114 + bob, 26, 24, 6, '#3a4a48');
        ctx.restore();
      }
      ctx.save(); ctx.globalAlpha = 0.5; rect(gx + 2, 82, 3, 52, '#e8f4f0'); rect(gx + 7, 82, 1, 52, '#e8f4f0'); ctx.restore();
      if (dw > 70) {
        drawTextC('MRS. OWLET', gx + gw / 2, 100, '#8a6a14', 1); drawTextC('MRS. OWLET', gx + gw / 2 - 1, 99, '#e8c040', 1);
        drawTextC('KNOCK.', gx + gw / 2, 112, '#5a4a3a', 1);
        drawTextC('THEN WAIT.', gx + gw / 2, 120, '#5a4a3a', 1);
      }
      // two raised lower panels
      [0, 1].forEach(i => {
        const px = dx + Math.round((8 + i * 34) * dw / 80), pw = Math.round(30 * dw / 80);
        rr(px, 146, pw, 44, 2, UWOOD[0]); rr(px + 1, 147, pw - 2, 42, 2, UWOOD[2]); rect(px + 2, 147, pw - 4, 1, UWOOD[4]); rect(px + 1, 148, 1, 40, UWOOD[3]);
      });
      // brass kick plate + knob with a sign hanging on it
      rect(dx + 2, 190, dw - 4, 8, UGOLD[1]); rect(dx + 2, 190, dw - 4, 1, UGOLD[3]); grainRect(dx + 3, 191, dw - 6, 6, UGOLD[0], UGOLD[3], 0.08, 4);
      const kx = dx + dw - 10;
      rr(kx - 2, 146, 6, 10, 2, UGOLD[0]); rr(kx - 1, 147, 4, 8, 1, UGOLD[2]);
      fillCircle(kx + 1, 151, 3, UGOLD[0]); fillCircle(kx + 1, 151, 2, UGOLD[3]); rect(kx, 150, 1, 1, UGOLD[4]);
      if (!open) {
        const sw = Math.sin(tNow * 1.4) * 0.12;
        ctx.save(); ctx.translate(kx + 1, 154); ctx.rotate(sw);
        pxLine(0, 0, -6, 8, '#3a2410'); pxLine(0, 0, 6, 8, '#3a2410');
        paperSheet(-10, 8, 20, 12, { noCorner: 1, ramp: ['#3a0c08', '#a83a2a', '#c84a38', '#e0705a', '#ffffff'] });
        drawTextC('BUSY', 0, 12, '#fff0e0', 1);
        ctx.restore();
      }
    }
  }
}

function drawRangerSelect() {
  if (G.summer) { G.summer = false; G.mut = null; }
  if (!lobby) lobbyInit();
  const L = lobby, dt = 1 / 60;
  L.t += dt;
  paintCached('hall', 0, 0, W, H, hallStatic);
  vistaLive(15, 21, 94, 84, {});
  // NOW SERVING digits
  const serving = L.sel ? 1 + RANGER_ORDER.indexOf(L.sel) : 0;
  drawTextC(serving ? '0' + serving : '--', 192, 31, Math.sin(tNow * 4) > -0.6 ? '#ff4030' : '#7a1810', 1);
  // badges in the trophy case, each on a little plinth
  RANGER_ORDER.forEach((k, i) => {
    const bx = 266 + i * 40, open = rangerUnlocked(k);
    drawRangerBadge(bx, 34, k, { sc: 1, locked: !open });
    rect(bx + 2, 64, 24, 2, UGOLD[1]); rect(bx + 2, 64, 24, 1, UGOLD[3]);
  });
  ctx.save(); ctx.globalAlpha = 0.1;
  for (let k = 0; k < 3; k++) { const gx = 262 + k * 70 + Math.round(tNow * 6 % 30); for (let j = 0; j < 44; j++) rect(gx + (j >> 2), 22 + j, 2, 1, '#e8fff8'); }
  ctx.restore();

  const K = L.knock;
  drawLobbyDoor(K);

  // ------------------------------------------------ the applicants ------
  // everyone walks toward their mark; the chosen one to the rug
  RANGER_ORDER.forEach((k, i) => {
    const P = L.pos[k];
    let tx = LOBBY_Q[i], ty = LOBBY_QY;
    if (L.sel === k) { tx = LOBBY_SPOT.x; ty = LOBBY_SPOT.y; }
    if (K && L.sel === k && K.t > 3.0) { tx = 192; ty = 204; }
    const dx = tx - P.x, dy = ty - P.y, d = Math.hypot(dx, dy);
    const sp = 95 * dt;
    if (d > 0.6) { P.x += dx / d * Math.min(sp, d); P.y += dy / d * Math.min(sp, d); P.walk = 1; P.face = dx < 0 ? -1 : 1; }
    else { P.x = tx; P.y = ty; P.walk = 0; }
  });
  const order = RANGER_ORDER.slice().sort((a, b) => L.pos[a].y - L.pos[b].y);
  let hov = null;
  order.forEach(k => {
    const P = L.pos[k], open = rangerUnlocked(k), isSel = L.sel === k;
    const sc = 1.1 + (P.y - LOBBY_QY) / (LOBBY_SPOT.y - LOBBY_QY) * 0.2;
    const inside = K && isSel && K.t > 3.0 ? clamp((K.t - 3.0) / 0.7, 0, 1) : 0;
    const over = mx >= P.x - 16 && mx < P.x + 16 && my >= P.y - 64 * sc && my < P.y && !K;
    if (over) hov = k;
    const act = P.walk ? 'walk' : isSel && open ? (L.card > 0.5 && !K ? 'wave' : 'idle') : 'idle';
    const expr = !open ? 'sleepy' : isSel ? (K ? 'wow' : 'happy') : (over ? 'happy' : 'calm');
    ctx.save();
    if (inside) ctx.globalAlpha = 1 - inside;
    if (over || isSel) { ctx.save(); ctx.globalAlpha *= 0.28 + Math.sin(tNow * 5) * 0.08; ctx.scale(1, 0.3); fillCircle(P.x, (P.y - 1) / 0.3, 18, open ? '#ffe89a' : '#9ab0c0'); ctx.restore(); }
    const o = { sc: sc * (1 - inside * 0.25), expr, act, flip: P.walk && P.face < 0, phase: RANGER_ORDER.indexOf(k) * 0.9, hat: open && isSel ? meta.hat : 'none', gear: open && isSel ? meta.gear : 'none', glove: open && isSel ? meta.glove : 'bare', fit: open && isSel ? meta.fit : null };
    if (open) drawBobble(P.x, P.y, k, o);
    else {
      drawSilhouette(P.x, P.y, k, o, over || isSel ? '#24303a' : '#10161c', over || isSel ? 0.78 : 0.9);
      // padlock tag floating over their head
      const ly = P.y - 66 * sc + Math.sin(tNow * 2 + k.length) * 1.5;
      plasticBox(P.x - 5, ly, 10, 8, 2, ['#1a1206', '#8a6a1a', '#c89a2a', '#e8c450', '#fff0a0'], { noShine: 1 });
      rect(P.x - 3, ly - 4, 6, 1, '#8a6a1a'); rect(P.x - 3, ly - 4, 1, 4, '#8a6a1a'); rect(P.x + 2, ly - 4, 1, 4, '#8a6a1a');
      rect(P.x - 1, ly + 3, 2, 3, '#3a2a06');
    }
    ctx.restore();
    if (!K) hit(P.x - 16, P.y - 64 * sc, 32, 64 * sc, { id: 'lob_' + k, cursor: true, cb: () => lobbySelect(k), tip: open ? RANGERS[k].name + '|' + RANGERS[k].animal : '???|LOCKED - CLICK TO SEE HOW TO HIRE' });
  });
  // a name tag over whoever the cursor is on
  if (hov && hov !== L.sel) {
    const P = L.pos[hov], open = rangerUnlocked(hov), nm = open ? RANGERS[hov].name : '? ? ?';
    const w2 = textW(nm, 1) + 10;
    plasticBox(P.x - w2 / 2, P.y - 88, w2, 12, 2, open ? UGOLD : ['#10161c', '#2a3440', '#3a4654', '#4a5868', '#8a9aa8'], { noShine: 1 });
    drawTextC(nm, P.x, P.y - 85, open ? '#3a2606' : '#c8d4dc', 1);
  }

  // ---------------------------------------------- the speech bubble ------
  if (L.say && !K) {
    L.say.t += dt;
    const P = L.pos[L.say.who];
    if (L.say.t > 0 && L.say.t < 4.5 && P && !P.walk) {
      const bw = 104, bh = 8 + wrapCount(L.say.txt, bw - 10) * 7, bx = clamp(P.x - bw / 2 + 24, 150, W - bw - 4), by = P.y - 88 - bh;
      hqBubble(bx, by, bw, bh, L.say.txt, L.say.t, { tail: { x: P.x + 6, y: P.y } });
    }
  }

  // ------------------------------------------------ the applicant file ---
  if (L.sel) {
    L.card = Math.min(1, L.card + dt * 3.5);
    const k = L.sel, r = RANGERS[k], open = rangerUnlocked(k), lvl = masteryLvl(k);
    const cx = Math.round(-150 + easeOut(L.card) * 154), cy = 16, cw = 140, ch = 204;
    // the clipboard
    rr(cx + 3, cy + 4, cw, ch, 4, '#00000077');
    plasticBox(cx, cy, cw, ch, 4, ['#1e120a', '#5a3818', '#7a4e24', '#946232', '#b88048'], { seed: 31 });
    woodGrain(cx + 3, cy + 3, cw - 6, ch - 6, '#5a3818', '#946232', 12);
    paperSheet(cx + 6, cy + 12, cw - 12, ch - 18, { ruled: 1, ruledTop: 60 });
    plasticBox(cx + cw / 2 - 20, cy + 2, 40, 14, 3, MET, { noShine: 1 });
    rect(cx + cw / 2 - 14, cy + 6, 28, 2, MET[1]); fillCircle(cx + cw / 2, cy + 10, 2, MET[0]);
    const px = cx + 12;
    drawText('APPLICANT FILE', px, cy + 18, '#8a7a58', 1);
    drawText('NO. 00' + (RANGER_ORDER.indexOf(k) + 1), cx + cw - 42, cy + 18, '#a83a2a', 1);
    rect(px, cy + 26, cw - 24, 1, '#c8b890');
    drawRangerBadge(px - 2, cy + 30, k, { sc: 1.15, locked: !open, wob: open });
    const nm = fitLines(r.name, 88);
    nm.forEach((ln, i) => drawText(ln, px + 36, cy + 33 + i * 7, open ? '#241a10' : '#5a4a3a', 1));
    drawText(r.animal, px + 36, cy + 34 + nm.length * 7, '#7a6a4a', 1);
    drawText(open ? MASTERY_TIER[lvl] : 'SEALED', px + 36, cy + 42 + nm.length * 7, open ? mixHex(MASTERY_COL[lvl], '#000000', 0.35) : '#a83a2a', 1);
    let yy = cy + 70;
    if (open) {
      drawText('DUTIES', px, yy, '#8a7a58', 1); yy += 9;
      r.lines.forEach(l => { rect(px, yy + 1, 3, 3, r.col); rect(px, yy + 1, 3, 1, '#ffffff88'); yy = drawSmallWrapped(l, px + 6, yy, cw - 30, '#241a10') + 2; });
      yy += 2;
      yy = drawSmallWrapped("'" + r.flav + "'", px, yy, cw - 24, '#7a6a4a') + 4;
      drawText('MASTERY', px, yy, '#8a7a58', 1); yy += 9;
      const nx = masteryNext(k);
      segBar(px, yy, cw - 24, 8, nx ? (masteryXp(k) - nx.from) / Math.max(1, nx.need - nx.from) : 1, { tint: MASTERY_COL[lvl], tintL: '#ffffff' });
      yy += 11;
      drawText(nx ? (masteryXp(k) - nx.from) + ' / ' + (nx.need - nx.from) + ' XP' : 'MAXED OUT', px, yy, '#6a5a3a', 1);
      if (nx) drawText('NEXT: ' + MASTERY_TIER[lvl + 1], px, yy + 8, '#6a5a3a', 1);
    } else {
      const a2 = ACHS.find(q => q.id === r.ach);
      drawText('TO JOIN THE PATROL', px, yy, '#8a7a58', 1); yy += 10;
      plasticBox(px - 2, yy - 2, cw - 20, 34, 3, ['#3a0c08', '#e8d0b8', '#f4e2cc', '#faeee0', '#ffffff'], { flat: 1 });
      drawText(a2 ? a2.name : 'LOCKED', px + 2, yy + 2, '#a83a2a', 1);
      drawSmallWrapped(a2 ? a2.desc : '', px + 2, yy + 11, cw - 30, '#241a10');
      yy += 38;
      let prog = null;
      if (r.ach === 'win') prog = 'BEST ANTE: ' + Math.max(0, best) + ' / 8';
      if (r.ach === 'boss') prog = 'BEST ANTE: ' + Math.max(0, best);
      if (prog) drawText(prog, px, yy, '#6a5a3a', 1);
      yy += 10;
      drawSmallWrapped('REWARD: ' + r.lines[0], px, yy, cw - 24, '#3a6a2a');
      // the stamp
      ctx.save(); ctx.translate(cx + cw / 2 + 10, cy + ch - 26); ctx.rotate(-0.2); ctx.globalAlpha = 0.85;
      rr(-38, -9, 76, 18, 3, '#a83a2a'); rr(-36, -7, 72, 14, 2, '#f4e8d8'); drawTextC('SEALED', 0, -3, '#a83a2a', 2);
      ctx.restore();
    }
  } else {
    L.hint += dt;
    const a = 0.6 + Math.sin(tNow * 3) * 0.3;
    ctx.save(); ctx.globalAlpha = a;
    plasticBox(282, 94, 158, 14, 3, UWOOD, { noShine: 1 });
    drawTextCSh('CLICK AN APPLICANT TO CALL THEM UP', 361, 98, '#ffe6b0', 1, '#1a0e06');
    ctx.restore();
    const P = L.pos[RANGER_ORDER[0]];
    const by = P.y - 80 + Math.abs(Math.sin(tNow * 4)) * -4;
    for (let k = 0; k < 5; k++) rect(P.x - 4 + k, by + k, 9 - k * 2, 1, '#ffe6b0');
  }

  // --------------------------------------------------- the knock --------
  if (K) {
    K.t += dt;
    [0.1, 0.38, 0.66].forEach((kt, i) => {
      if (K.knocks === i && K.t > kt) { K.knocks++; sfx.thunk(); shake = Math.max(shake, 2); float(214, 110 - i * 6, 'KNOCK', '#ffe6b0', 1, 0.6); }
    });
    if (K.t > 1.0 && K.t < 1.8) hqBubble(166, 34, 56, 14, '...WHAT.', (K.t - 1.0) * 1.2, {});
    if (K.open) {
      K.doorOpen = clamp((K.t - 1.8) / 0.5, 0, 1);
      K.owl = K.t > 1.9;
      if (K.t > 2.0 && !K.said) { K.said = true; K.line = choice(meta.tutDone ? OWLET_DOOR.back : OWLET_DOOR.first); sfx.whoosh(); }
      K.talk = K.said && K.t < 2.0 + K.line.length / 40 + 0.2;
      if (K.said) hqBubble(242, 92, 120, 17 + wrapCount(K.line, 110) * 7, K.line, K.t - 2.0, { name: 'MRS. OWLET', tail: { x: 238, y: 200 } });
      if (K.t > 4.0 && !K.gone) { K.gone = true; lobbyGo(); return; }
    } else {
      if (K.t > 1.9 && !K.said) { K.said = true; K.line = choice(OWLET_DOOR.locked); sfx.error(); }
      if (K.said) hqBubble(242, 92, 132, 17 + wrapCount(K.line, 122) * 7, K.line, K.t - 1.9, { name: 'MRS. OWLET, BEHIND DOOR', tail: { x: 238, y: 120 } });
      if (K.t > 4.4) L.knock = null;
    }
    hit(0, 0, W, H, { id: 'lobskip', cb: () => { if (K.open && K.t > 1.0 && !K.gone) { K.gone = true; lobbyGo(); } } });
    return;
  }

  // ------------------------------------------------------ buttons -------
  const sel = L.sel, open = sel && rangerUnlocked(sel);
  // the knocker on the door is a button too
  if (sel) hit(152, 68, 80, 132, { id: 'lobdoor', cursor: true, cb: lobbyKnock, tip: open ? 'KNOCK|Mrs Owlet will see you now' : 'KNOCK?|She will not see a sealed file' });
  button(W - 126, H - 26, 120, 22, sel ? (open ? 'KNOCK KNOCK >' : 'SEALED FILE') : 'PICK A RANGER', '#d94f30', '#8a2a16', lobbyKnock, { id: 'lobknock', disabled: !sel, sub: null });
  if (meta.tutDone) button(W - 206, H - 26, 76, 22, 'TRAINING', '#3a6a8a', '#204458', () => { if (sel && open) { lobby = null; startTutorial(sel); } else { lobby = null; startTutorial(meta.ranger || 'scout'); } }, { id: 'lobtrain', tip: 'REFRESHER COURSE|Mrs Owlet runs you through it again' });
  button(6, H - 26, 60, 22, '< MENU', '#4a4438', '#28241c', () => { lobby = null; G.state = 'menu'; sfx.click(2); }, { id: 'lobback' });
}

// ======================= MRS OWLET'S OFFICE ===============================
//  Ochre wallpaper, a window on the swamp, a chalkboard she scores you on,
//  a humming CRT, a snack station she pretends is not hers, posters nobody
//  reads, a supply cabinet full of dental kits and - centre stage - the
//  full-size anatomical crocodile she teaches on.
// ==========================================================================
const OFW = ['#24160a', '#5e3e1e', '#704a24', '#83582c', '#9a6c3a'];
const FLR2 = ['#140a06', '#2e1a10', '#3e2416', '#50301c', '#664024'];
const BOARD = { x: 146, y: 12, w: 94, h: 74 };

function getCached(key, w, h, fn) {
  let c = PAINT_CACHE[key];
  if (!c) {
    c = document.createElement('canvas'); c.width = w * RS; c.height = h * RS;
    const c2 = c.getContext('2d'); c2.imageSmoothingEnabled = false; c2.setTransform(RS, 0, 0, RS, 0, 0);
    const main = ctx; ctx = c2;
    try { fn(); } finally { ctx = main; }
    PAINT_CACHE[key] = c;
  }
  return c;
}

function officeStatic() {
  // ---- wallpaper: ochre with a pressed pinstripe and fleur dots ----
  rect(0, 0, W, 150, OFW[2]);
  for (let x = 0; x < W; x += 10) { rect(x, 0, 2, 150, OFW[3]); rect(x + 2, 0, 1, 150, OFW[1]); }
  for (let y = 14; y < 146; y += 14) for (let x = 6 + ((y / 14) & 1) * 5; x < W; x += 10) { rect(x, y, 1, 1, OFW[4]); rect(x - 1, y + 1, 3, 1, OFW[3]); rect(x, y + 2, 1, 1, OFW[4]); }
  grainRect(0, 8, W, 140, OFW[1], OFW[4], 0.03, 3);
  // water stain in the corner - the roof leaks in the rainy season
  ctx.save(); ctx.globalAlpha = 0.25; rr(410, 4, 40, 16, 6, OFW[1]); rr(418, 16, 20, 8, 3, OFW[1]); ctx.restore();
  rect(0, 0, W, 5, UWOOD[1]); rect(0, 5, W, 2, UWOOD[3]); rect(0, 7, W, 2, UWOOD[0]);
  for (let x = 2; x < W; x += 8) rect(x, 1, 4, 3, UWOOD[2]);
  // ---- dark wainscot with a picture rail ----
  rect(0, 146, W, 3, UWOOD[4]); rect(0, 149, W, 2, UWOOD[0]);
  rect(0, 151, W, 50, UWOOD[1]); woodGrain(0, 151, W, 50, UWOOD[0], UWOOD[2], 9);
  for (let x = 6; x < W; x += 38) { rr(x, 156, 32, 38, 2, UWOOD[0]); rr(x + 1, 157, 30, 36, 2, UWOOD[2]); rect(x + 2, 157, 28, 1, UWOOD[3]); }
  rect(0, 198, W, 4, UWOOD[0]); rect(0, 198, W, 1, UWOOD[3]);
  // ---- floor: dark stained boards and a patterned rug ----
  rect(0, 202, W, 68, FLR2[2]);
  for (let r = 0; r < 7; r++) {
    const y = 202 + r * 10;
    rect(0, y, W, 1, FLR2[0]); rect(0, y + 1, W, 1, FLR2[3]);
    for (let x = (r * 41) % 64; x < W; x += 64) { rect(x, y + 1, 1, 9, FLR2[0]); rect(x + 1, y + 1, 1, 9, FLR2[3]); }
    woodGrain(0, y + 2, W, 8, FLR2[1], FLR2[3], r * 5);
  }
  rr(150, 206, 300, 40, 6, '#1a0c10'); rr(152, 208, 296, 36, 5, '#3a1a3a');
  rr(158, 212, 284, 28, 4, '#6a2a3a'); rr(164, 216, 272, 20, 3, '#3a1a3a');
  for (let x = 170; x < 432; x += 12) { rect(x, 224, 6, 4, '#c8a050'); rect(x + 2, 222, 2, 8, '#c8a050'); rect(x + 2, 225, 2, 2, '#6a2a3a'); }
  grainRect(152, 208, 296, 36, '#2a1024', '#8a3a4a', 0.06, 8);

  // ---- window with velvet drapes ----
  rr(12, 16, 82, 82, 2, UWOOD[0]);
  ctx.save(); ctx.translate(16, 20); vistaStatic(74, 74, { sunX: 0.3, hz: 0.6, trees: [[0.2, 0.9], [0.55, 1.2], [0.86, 0.8]] }); ctx.restore();
  rect(12, 16, 82, 4, '#d8c8a8'); rect(12, 94, 82, 4, '#d8c8a8'); rect(12, 16, 4, 82, '#d8c8a8'); rect(90, 16, 4, 82, '#d8c8a8');
  rect(52, 20, 2, 74, '#d8c8a8'); rect(16, 56, 74, 2, '#d8c8a8');
  rect(12, 16, 82, 1, '#fff4dc'); rect(52, 20, 1, 74, '#fff4dc');
  [[4, 1], [86, -1]].forEach(([dx, s]) => {                       // drapes gathered at the sides
    for (let x = 0; x < 16; x++) {
      const tone = ['#3a0c14', '#6a1a28', '#8a2a38', '#a83a48'][(x + (s < 0 ? 1 : 0)) % 4];
      const pinch = Math.round(Math.max(0, 6 - Math.abs(x - 8)) * 0.6);
      rect(dx + x, 12, 1, 60 - pinch, tone); rect(dx + x + (s * pinch) / 2, 72 - pinch, 1, 34 + pinch, tone);
    }
    rect(dx + 2, 70, 12, 3, UGOLD[2]); rect(dx + 2, 70, 12, 1, UGOLD[4]);
  });
  rect(0, 10, 104, 5, '#6a1a28'); for (let x = 2; x < 104; x += 6) rr(x, 13, 4, 5, 2, '#8a2a38');   // valance
  rect(8, 98, 90, 4, UWOOD[3]); rect(8, 98, 90, 1, UWOOD[4]); rect(8, 102, 90, 2, UWOOD[0]);
  rr(30, 88, 12, 10, 2, '#5a2a14'); rect(32, 80, 2, 9, '#3a7a3a'); rect(36, 78, 2, 11, '#4a8a3a'); rect(28, 82, 4, 2, '#3a7a3a'); rect(38, 84, 4, 2, '#3a7a3a');  // snake plant

  // ---- FLOSS OR LOSE poster ----
  paperSheet(100, 18, 40, 58, { ramp: ['#1a2a3a', '#8ac0d8', '#b8e0f0', '#d8f0fa', '#ffffff'] });
  rect(102, 20, 36, 11, '#c83a2a'); drawTextC('FLOSS', 120, 23, '#ffffff', 1);
  rr(111, 34, 18, 18, 5, '#2a3a4a'); rr(112, 35, 16, 16, 4, '#fdfaec'); rect(113, 36, 6, 4, '#ffffff'); rect(118, 49, 4, 6, '#fdfaec'); rect(112, 49, 4, 6, '#fdfaec');
  rect(116, 41, 2, 2, '#1a1a1a'); rect(122, 41, 2, 2, '#1a1a1a'); rect(117, 45, 6, 1, '#1a1a1a');       // a worried tooth
  pxLine(104, 36, 136, 52, '#e8f0f8'); pxLine(104, 37, 136, 53, '#9ab0c0');                          // the string
  drawTextC('OR LOSE', 120, 58, '#1a2a3a', 1);
  rect(104, 66, 32, 6, '#2e5a24'); for (let k = 0; k < 5; k++) rect(106 + k * 6, 65, 3, 2, '#fdfaec');
  pushPin(120, 19, PINS[1]);

  // ---- chalkboard frame + surface ----
  const B = BOARD;
  rr(B.x - 4, B.y - 4, B.w + 8, B.h + 8, 2, UWOOD[0]);
  plasticBox(B.x - 3, B.y - 3, B.w + 6, B.h + 6, 2, UWOOD, { seed: 3, noShine: 1 });
  rect(B.x, B.y, B.w, B.h, '#1c342a');
  for (let y = B.y; y < B.y + B.h; y++) for (let x = B.x + (y & 1); x < B.x + B.w; x += 2) if (hash2(x, y) < 0.16) rect(x, y, 1, 1, '#2a463a');
  for (let k = 0; k < 90; k++) { const sx = B.x + 50 + hash2(k, 1) * 36, sy = B.y + 8 + hash2(k, 2) * 20; rect(sx, sy, 2, 1, '#34503f'); }   // old eraser smudges
  rect(B.x - 3, B.y + B.h + 2, B.w + 6, 3, UWOOD[3]); rect(B.x - 3, B.y + B.h + 5, B.w + 6, 1, UWOOD[0]);
  rect(B.x + 8, B.y + B.h + 1, 8, 2, '#f4f0e0'); rect(B.x + 20, B.y + B.h + 1, 6, 2, '#f0a0a8'); rect(B.x + 30, B.y + B.h + 1, 5, 2, '#9fd8f0');
  rr(B.x + B.w - 22, B.y + B.h - 1, 16, 4, 1, '#3a2a1a'); rect(B.x + B.w - 21, B.y + B.h - 1, 14, 2, '#d8d0c0');

  // ---- anatomy chart on a hanging scroll ----
  rect(250, 8, 50, 3, UWOOD[0]); rect(250, 8, 50, 1, UWOOD[3]); rr(247, 7, 4, 5, 1, UGOLD[2]); rr(299, 7, 4, 5, 1, UGOLD[2]);
  paperSheet(252, 11, 46, 72, { noCorner: 1, ramp: ['#3a2c18', '#c8b890', '#e4d8b8', '#f2ead4', '#ffffff'] });
  rect(250, 82, 50, 3, UWOOD[0]); rect(250, 82, 50, 1, UWOOD[3]);
  drawTextC('CROC', 275, 14, '#5a2a14', 1); drawTextC('SKULL', 275, 21, '#5a2a14', 1);
  // a side-view skull diagram in brown ink
  const sk = (u) => 34 - Math.round(Math.sin(Math.min(1, u / 8) * 1.2) * 4) - Math.round(u * 0.08);
  for (let u = 0; u < 38; u++) { rect(256 + u, 30 + (34 - sk(u)), 1, 1, '#5a3a1a'); rect(256 + u, 44 - Math.round(u * 0.08), 1, 1, '#5a3a1a'); }
  for (let u = 4; u < 36; u += 4) { rect(256 + u, 44 - Math.round(u * 0.08) + 1, 1, 2, '#8a6a3a'); }
  for (let u = 6; u < 34; u += 4) { rect(256 + u, 48, 1, 2, '#8a6a3a'); }
  for (let u = 2; u < 36; u++) rect(256 + u, 50 + Math.round(u * 0.04), 1, 1, '#5a3a1a');
  rr(262, 34, 5, 4, 1, '#5a3a1a'); rect(263, 35, 3, 2, '#e4d8b8');
  [[262, 36, 1], [278, 46, 2], [286, 49, 3]].forEach(([lx, ly, n]) => { pxLine(lx, ly, lx - 4 + n * 3, 60 + n * 5, '#a83a2a'); drawText('' + n, lx - 6 + n * 3, 58 + n * 5, '#a83a2a', 1); });
  for (let k = 0; k < 3; k++) rect(266, 64 + k * 5, 26 - k * 6, 1, '#9a8a6a');

  // ---- DAYS WITHOUT A BITE ----
  rr(306, 14, 56, 36, 2, '#1a1a1a'); plasticBox(307, 15, 54, 34, 2, ['#1a1a1a', '#d8d8d0', '#eeeee8', '#f8f8f4', '#ffffff'], { flat: 1 });
  rect(308, 16, 52, 9, '#2e7a3a'); drawTextC('DAYS SINCE', 334, 18, '#ffffff', 1);
  drawText('LAST', 311, 29, '#1a1a1a', 1); drawText('BITE:', 311, 37, '#1a1a1a', 1);
  rr(339, 27, 18, 18, 2, '#1a1a1a'); rect(340, 36, 16, 1, '#3a3a3a');
  [[306, 1], [360, 1]].forEach(([bx]) => { rect(bx, 12, 2, 3, '#6a6a6a'); });
  // ---- wall clock face (hands are live) ----
  fillCircle(334, 66, 11, UWOOD[0]); fillCircle(334, 66, 10, UWOOD[3]); fillCircle(334, 66, 8, '#f4ecd8');
  for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; rect(334 + Math.round(Math.cos(a) * 7), 66 + Math.round(Math.sin(a) * 7), 1, 1, '#3a2a1a'); }
  // ---- employee of the month: her, again ----
  goldFrame(368, 12, 44, 54, { field: '#3a5a6a', fieldD: '#2a4a5a', fieldL: '#4a6a7a' });
  ctx.save(); ctx.beginPath(); ctx.rect(372, 16, 36, 36); ctx.clip();
  ctx.translate(390, 40); ctx.scale(0.8, 0.8); drawOwletHead({ expr: 'grump' }); ctx.restore();
  rect(371, 52, 38, 11, '#c8a040'); drawTextC('STAFF OF', 390, 53, '#3a2606', 1); drawTextC('THE MONTH', 390, 59, '#3a2606', 1);
  ctx.save(); ctx.translate(404, 22); ctx.rotate(0.4); rr(-9, -3, 18, 7, 1, '#a83a2a'); drawTextC('AGAIN', 0, -2, '#ffe0d0', 1); ctx.restore();

  // ---- the x-ray scanner on its wall rail ----
  rect(420, 14, 56, 4, MET[1]); rect(420, 14, 56, 1, MET[3]);
  for (let x = 424; x < 474; x += 10) rect(x, 15, 2, 2, MET[0]);
  rect(444, 18, 4, 18, MET[1]); rect(444, 18, 1, 18, MET[3]);
  rr(436, 34, 20, 6, 2, MET[0]); rr(437, 35, 18, 4, 1, MET[2]);
  pxLine(446, 40, 456, 50, MET[1], 3); pxLine(456, 50, 450, 58, MET[1], 3);
  rr(438, 56, 26, 16, 3, '#1a1a14'); rr(439, 57, 24, 14, 3, '#e8e0c8'); rect(440, 58, 22, 3, '#fffaf0'); rect(440, 67, 22, 3, '#b8b098');
  fillCircle(444, 64, 3, '#e8c020'); rect(443, 62, 1, 1, '#1a1a1a'); rect(445, 62, 1, 1, '#1a1a1a'); rect(444, 65, 1, 1, '#1a1a1a');   // radiation sticker
  rr(452, 70, 10, 6, 2, '#1a1a14'); rr(453, 70, 8, 5, 2, '#5a6a70');
  drawText('XR', 450, 59, '#5a4a2a', 1);

  // ---- the supply cabinet: dental kits, brushes, floss, snap reports ----
  rect(446, 76, 34, 124, UWOOD[0]); plasticBox(447, 77, 33, 122, 2, UWOOD, { seed: 41, noShine: 1 });
  [80, 106, 132, 158].forEach(sy => { rect(449, sy, 31, 22, '#1e1208'); rect(449, sy + 22, 31, 3, UWOOD[3]); rect(449, sy + 22, 31, 1, UWOOD[4]); });
  [[450, 88, '#f4f0e8'], [459, 86, '#f4f0e8'], [468, 90, '#5ab8c8']].forEach(([bx, by, c], i) => {
    rr(bx, by, 9, 102 - by, 1, '#1a1a1a'); rect(bx + 1, by + 1, 7, 100 - by, c);
    rect(bx + 3, by + 3, 3, 1, '#d83a2a'); rect(bx + 4, by + 2, 1, 3, '#d83a2a');
  });
  for (let k = 0; k < 6; k++) { rect(451 + k * 4, 110 - (k % 3), 2, 18 + (k % 3), ['#e84a5a', '#4a8ae8', '#f0c040', '#5ac86a'][k % 4]); rect(451 + k * 4, 109 - (k % 3), 2, 2, '#ffffff'); }
  rr(450, 118, 26, 10, 2, '#9ac8d8'); rect(451, 119, 24, 2, '#d8f0f8');                                   // toothbrush jar
  for (let k = 0; k < 4; k++) { fillCircle(453 + k * 7, 150, 3, '#3a8a6a'); fillCircle(453 + k * 7, 150, 1, '#e8f8f0'); }                   // floss rolls
  rect(450, 136, 8, 10, '#3a6ae8'); rect(451, 134, 6, 2, '#e8e8e8');                                        // mouthwash
  for (let k = 0; k < 6; k++) { rect(450 + k * 5, 162, 4, 18, ['#8a2a1a', '#2a4a8a', '#2a6a3a', '#8a6a1a'][k % 4]); rect(451 + k * 5, 166, 2, 5, '#f0e8d0'); }   // binders
  drawText('SNAP', 452, 186, '#e8d8b0', 1);

  // ---- snack station: mini fridge, coffee maker, donuts, candy ----
  rr(56, 150, 40, 50, 2, '#1a1e20'); rr(57, 151, 38, 48, 2, '#d8dcdc'); rect(58, 152, 5, 46, '#f0f4f4'); rect(58, 170, 36, 1, '#9aa0a2');
  rect(90, 156, 2, 10, '#8a9092'); rect(90, 174, 2, 14, '#8a9092');
  rr(62, 158, 8, 8, 2, '#e84a3a'); rr(74, 156, 10, 7, 2, '#f0c040'); rect(76, 158, 6, 3, '#3a2a1a'); rr(66, 178, 12, 8, 2, '#5ac86a'); drawText('HI', 68, 180, '#1a3a1a', 1);   // magnets
  paperSheet(78, 176, 12, 14, { noCorner: 1 }); rect(80, 179, 8, 1, '#8a7a5a'); rect(80, 182, 6, 1, '#8a7a5a'); rect(80, 185, 7, 1, '#8a7a5a');
  // coffee maker on the fridge
  rr(62, 124, 24, 26, 2, '#141414'); rr(63, 125, 22, 24, 2, '#2e2e2e'); rect(64, 126, 20, 5, '#3e3e3e');
  rr(66, 134, 16, 12, 3, '#9ac8d8'); rect(67, 139, 14, 6, '#4a2a14'); rect(68, 135, 3, 4, '#d8f0f8');
  rect(78, 128, 3, 2, '#e84a3a');
  // the counter with donuts and a candy jar
  rect(6, 158, 50, 4, UWOOD[3]); rect(6, 158, 50, 1, UWOOD[4]); rect(6, 162, 50, 38, UWOOD[1]); rect(6, 162, 50, 1, UWOOD[0]);
  rr(10, 166, 20, 30, 1, UWOOD[0]); rr(11, 167, 18, 28, 1, UWOOD[2]); rr(32, 166, 20, 30, 1, UWOOD[0]); rr(33, 167, 18, 28, 1, UWOOD[2]);
  rect(26, 180, 2, 3, UGOLD[3]); rect(34, 180, 2, 3, UGOLD[3]);
  rr(8, 148, 28, 10, 1, '#c8587a'); rect(8, 148, 28, 3, '#e87a9a'); drawText('DONUT', 9, 152, '#ffffff', 1);   // pink donut box, lid up
  rr(12, 142, 10, 6, 3, '#c8883a'); rr(14, 143, 6, 3, 2, '#f0a0c8'); rect(16, 144, 2, 1, '#6a3a1a');          // one survivor donut
  rr(38, 140, 14, 18, 4, '#6a8a9a'); rr(39, 141, 12, 16, 3, '#c8e0e8');
  for (let k = 0; k < 9; k++) rect(40 + (k * 5) % 10, 148 + (k * 3) % 8, 2, 2, ['#e84a3a', '#f0c040', '#5ac86a', '#4a8ae8'][k % 4]);   // candy
  rect(41, 138, 8, 3, '#e84a3a');
  // a crumpled bag of GATOR CHIPS
  rr(24, 150, 12, 9, 2, '#e8a020'); rect(25, 151, 10, 2, '#f8d060'); rect(27, 154, 6, 3, '#2e7a3a');

  // ---- the desk: green lamp, CRT, in-tray, phone, nameplate ----
  rect(100, 150, 134, 6, UWOOD[4]); rect(100, 150, 134, 1, '#c8905a'); rect(100, 156, 134, 2, UWOOD[0]);
  plasticBox(102, 158, 130, 44, 2, UWOOD, { seed: 51, noShine: 1 });
  woodGrain(104, 160, 126, 40, UWOOD[1], UWOOD[3], 77);
  [[108, 162], [108, 178], [196, 162], [196, 178]].forEach(([dx, dy]) => { rr(dx, dy, 30, 14, 2, UWOOD[0]); rr(dx + 1, dy + 1, 28, 12, 2, UWOOD[2]); rect(dx + 11, dy + 6, 8, 2, UGOLD[2]); rect(dx + 11, dy + 6, 8, 1, UGOLD[4]); });
  rr(142, 162, 50, 38, 2, UWOOD[0]); rr(143, 163, 48, 36, 2, UWOOD[1]);                              // kneehole
  // banker's lamp
  rect(114, 142, 10, 8, UGOLD[1]); rect(114, 142, 10, 1, UGOLD[3]); rect(118, 132, 2, 10, UGOLD[2]);
  rr(106, 124, 26, 10, 4, '#123a22'); rr(107, 125, 24, 7, 3, '#2a7a44'); rect(109, 126, 14, 2, '#5ab86a');
  // CRT computer
  rr(146, 112, 46, 38, 3, '#2a2618'); rr(147, 113, 44, 36, 3, '#cfc6a4'); rect(148, 114, 42, 3, '#e4dcc0'); rect(188, 116, 2, 30, '#a89e7c');
  rr(151, 116, 34, 26, 3, '#0a1a0e'); rr(152, 117, 32, 24, 2, '#0e2a14');
  rect(150, 144, 38, 4, '#a89e7c'); rect(172, 145, 10, 2, '#3a3a2a'); rect(176, 145, 3, 1, '#e84a3a');
  rr(160, 150, 18, 2, 1, '#2a2618');
  rr(148, 146, 42, 5, 1, '#2a2618'); rect(149, 147, 40, 3, '#b8ae8c'); for (let k = 0; k < 9; k++) rect(150 + k * 4, 148, 3, 1, '#8a8068');
  // in-tray, papers and a red rotary phone
  rr(196, 138, 30, 12, 1, '#3a3020'); rect(197, 139, 28, 10, '#6a5a3a');
  for (let k = 0; k < 4; k++) { paperSheet(198 + k, 134 - k * 2, 24, 10, { noCorner: 1 }); }
  rr(206, 142, 22, 8, 3, '#8a1a14'); rr(207, 143, 20, 6, 2, '#c8301f'); fillCircle(217, 145, 2, '#f0e0d0');
  rr(204, 138, 26, 5, 2, '#8a1a14'); rect(206, 138, 22, 1, '#e8584a');
  // nameplate
  rr(124, 146, 22, 5, 1, UWOOD[0]); rect(125, 146, 20, 3, UGOLD[2]); rect(125, 146, 20, 1, UGOLD[4]);
  // wastebasket with rejected applications
  rr(234, 180, 14, 20, 2, '#2a2a2a'); rr(235, 181, 12, 18, 2, '#5a5a5a'); for (let x = 236; x < 246; x += 3) rect(x, 182, 1, 16, '#3a3a3a');
  fillCircle(238, 179, 3, '#e8e0cc'); fillCircle(243, 178, 3, '#d8d0bc'); rect(236, 178, 2, 1, '#b8b09c');
  fillCircle(252, 198, 2, '#e8e0cc');                                                                 // missed a shot
}

// ============================ THE CROC MODEL ===============================
//  A full-size anatomical crocodile head on a lab plinth, seen in profile:
//  a hinged upper jaw that really opens, glass eye, osteoderm ridge, scale
//  grid, cream jaw, and a row of numbered training teeth on the lower jaw.
//  The painted layers (upper jaw / lower jaw, and their X-ray twins) are
//  cached; only the teeth, the mouth cavity and the hinge motion are live.
// ==========================================================================
// The model IS the game's croc: the real renderer, scaled onto a lab plinth,
// fed a six-tooth training mouth.  What you learn on is exactly what bites.
const CMS = 0.5, CM_OX = 376, CM_OY = 200;
const cmT = (x, y) => ({ x: CM_OX + (x - 294) * CMS, y: CM_OY + (y - 252) * CMS });
function cmWithMouth(m, fn) {
  const sv = G.mouth, sj = G.jawClose, smut = G.mut, sr = G.round, sn = G.nodeType, sb = G.boss;
  G.mouth = m.teeth.map(T => ({ t: { type: 'plain', base: T.v }, pressed: T.pressed, gone: false, revealed: T.rev, snap: T.snap, pop: 0 }));
  G.jawClose = 1 - clamp(m.open, 0, 1); G.mut = null; G.round = 0; G.nodeType = 'small'; G.boss = null;
  try { return fn(); } finally { G.mouth = sv; G.jawClose = sj; G.mut = smut; G.round = sr; G.nodeType = sn; G.boss = sb; }
}
function cmToothRect(i) {
  const m = G.iv ? G.iv.m : null; if (!m) return { x: 0, y: 0, w: 1, h: 1, cx: 0, cy: 0 };
  return cmWithMouth(m, () => {
    const sl = mouthLayout().slots[i]; if (!sl) return { x: 0, y: 0, w: 1, h: 1, cx: 0, cy: 0 };
    const a = cmT(sl.x, sl.y), b = cmT(sl.x + sl.w, sl.y + sl.h);
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  });
}
// m = { open, teeth[], sheet, sheetT, xr, xrA }, st = { hov }
function drawCrocModel(m, st) {
  st = st || {};
  // ---- the lab plinth it stands on ----
  plasticBox(292, 198, 168, 14, 2, UWOOD, { seed: 61, noShine: 1 });
  rect(292, 198, 168, 1, '#c8905a');
  plasticBox(338, 201, 76, 9, 1, UGOLD, { noShine: 1 });
  drawTextC('TRAINING GATOR', 376, 203, '#3a2606', 1);
  ctx.save(); ctx.globalAlpha = 0.3; rr(300, 195, 152, 5, 2, '#000'); ctx.restore();
  // ---- the real croc, scaled down ----
  cmWithMouth(m, () => {
    ctx.save(); ctx.translate(CM_OX, CM_OY); ctx.scale(CMS, CMS); ctx.translate(-294, -252);
    const _mx = mx, _my = my; mx = 294 + (mx - CM_OX) / CMS; my = 252 + (my - CM_OY) / CMS;
    drawCroc(1 - clamp(m.open, 0, 1), { mood: m.open < 0.3 ? 'angry' : m.xr >= 0 ? 'worried' : 'calm', dry: 1 });
    mx = _mx; my = _my;
    ctx.restore();
  });
  // brass bolts: it is a model, after all
  [[294, 168], [458, 168]].forEach(([bx, by]) => { fillCircle(bx, by, 3, UGOLD[0]); fillCircle(bx, by, 2, UGOLD[2]); rect(bx - 1, by - 1, 1, 1, UGOLD[4]); });
  // ---- per-tooth overlays: hover, the snapper she is pointing at ----
  m.teeth.forEach((T, i) => {
    const r = cmToothRect(i), pulse = (Math.sin(tNow * 8) + 1) / 2;
    if (st.hov === i && !T.pressed) { ctx.save(); ctx.globalAlpha = 0.35 + pulse * 0.25; rr(r.x - 2, r.y - 2, r.w + 4, r.h + 4, 3, '#ffe89a'); ctx.restore(); }
    if (T.mark) { ctx.save(); ctx.globalAlpha = 0.3 + pulse * 0.35; rr(r.x - 3, r.y - 3, r.w + 6, r.h + 6, 3, '#ff4030'); ctx.restore(); }
  });
  // ---- the X-ray sweep: a scan line crosses and the snapper glows red ----
  if (m.xr >= 0 && m.xrA > 0) {
    const x0 = 290, x1 = 462, sx = x0 + (x1 - x0) * m.xr;
    ctx.save(); ctx.globalAlpha = 0.22 * m.xrA; rect(x0, 110, sx - x0, 80, '#3a9ad8'); ctx.restore();
    m.teeth.forEach((T, i) => { const r = cmToothRect(i); if (T.snap && r.cx < sx) { ctx.save(); ctx.globalAlpha = (0.5 + Math.sin(tNow * 10) * 0.3) * m.xrA; rr(r.x - 3, r.y - 3, r.w + 6, r.h + 6, 3, '#ff4030'); ctx.restore(); drawTextC('!', r.cx + 1, r.cy - 3, '#ffffff', 1); } });
    if (m.xr < 1) { ctx.save(); ctx.globalAlpha = 0.8 * m.xrA; rect(sx - 1, 106, 2, 88, '#c0f8ff'); ctx.globalAlpha = 0.3 * m.xrA; rect(sx - 4, 106, 8, 88, '#7ad4f0'); ctx.restore(); }
  }
  // ---- the dust sheet it lives under ----
  if (m.sheet > 0) {
    const f = m.sheetT >= 0 ? clamp(m.sheetT, 0, 1) : 0;
    ctx.save();
    ctx.translate(376 + f * 120, 150 - f * 110); ctx.rotate(f * 0.9); ctx.scale(1 - f * 0.4, 1 - f * 0.3);
    ctx.globalAlpha = 1 - f;
    const SH = ['#3a3a3a', '#a8a49a', '#c8c4b8', '#e0dcd0', '#f4f0e6'];
    plasticBox(-90, -52, 180, 86, 18, SH, { seed: 7 });
    for (let k = 0; k < 7; k++) { const fx = -70 + k * 22 + Math.round(Math.sin(tNow * 2 + k) * f * 6); pxLine(fx, -44, fx + 6, 30, SH[1]); pxLine(fx + 1, -44, fx + 7, 30, SH[3]); }
    for (let x = -86; x < 86; x += 8) rr(x, 30 + (x % 16 ? 2 : 0), 8, 5, 2, SH[2]);
    ctx.restore();
  }
}
// tiny pictogram chips for node modifiers (icon, not an ugly bar)
const MOD_ICONS = {
  foggy(x, y) { rr(x, y + 3, 7, 3, 1, '#dfe8ec'); rr(x + 2, y + 1, 4, 3, 1, '#dfe8ec'); },
  swarming(x, y) { rect(x, y + 4, 7, 2, '#fff'); rect(x + 1, y + 1, 1, 3, '#fff'); rect(x + 3, y, 1, 4, '#fff'); rect(x + 5, y + 1, 1, 3, '#fff'); },
  brittle(x, y) { rr(x + 1, y, 5, 6, 1, '#fff'); rect(x + 3, y + 1, 1, 2, '#95251f'); rect(x + 2, y + 3, 1, 1, '#95251f'); rect(x + 4, y + 4, 1, 2, '#95251f'); },
  tired(x, y) { rect(x + 1, y, 5, 1, '#fff'); rect(x + 4, y + 1, 1, 1, '#fff'); rect(x + 3, y + 2, 1, 1, '#fff'); rect(x + 2, y + 3, 1, 1, '#fff'); rect(x + 1, y + 4, 5, 1, '#fff'); },
  toll(x, y) { fillCircle(x + 3, y + 3, 3, '#ffe089'); rect(x + 3, y + 1, 1, 5, '#a4741a'); },
  blessed(x, y) { rr(x, y + 2, 7, 3, 1, '#fff'); rect(x + 3, y + 3, 1, 1, '#1c5c9e'); rect(x + 3, y, 1, 1, '#fff'); rect(x + 3, y + 6, 1, 1, '#fff'); },
  richwater(x, y) { rect(x + 1, y + 4, 5, 2, '#ffe089'); rect(x + 1, y + 1, 5, 2, '#ffe089'); rect(x + 2, y + 2, 1, 1, '#a4741a'); rect(x + 2, y + 5, 1, 1, '#a4741a'); },
  gilded(x, y) { rr(x + 1, y, 5, 4, 1, '#ffe089'); rect(x + 1, y + 4, 2, 2, '#ffe089'); rect(x + 4, y + 4, 2, 2, '#ffe089'); },
  tailwind(x, y) { rect(x, y + 2, 5, 2, '#fff'); rect(x + 4, y + 1, 1, 4, '#fff'); rect(x + 5, y + 2, 1, 2, '#fff'); rect(x + 3, y, 1, 1, '#fff'); rect(x + 3, y + 5, 1, 1, '#fff'); },
  charmed(x, y) { rect(x + 3, y, 1, 6, '#fff'); rect(x + 1, y + 2, 5, 1, '#fff'); rect(x + 2, y + 1, 1, 1, '#fff'); rect(x + 4, y + 1, 1, 1, '#fff'); rect(x + 2, y + 4, 1, 1, '#fff'); rect(x + 4, y + 4, 1, 1, '#fff'); },
};
function drawModChip(x, y, m) {
  const md = NODE_MODS[m];
  x |= 0; y |= 0;
  rr(x, y + 1, 11, 11, 2, '#00000088');
  rr(x, y, 11, 11, 2, md.bad ? '#95251f' : '#2c7d3a');
  rr(x + 1, y + 1, 9, 9, 2, md.bad ? '#33161a' : '#1e3220');
  (MOD_ICONS[m] || MOD_ICONS.charmed)(x + 2, y + 2);
}

// ------------------------------------------------------------ swamp map ---
function drawMiniGator(x, y, type, mut) {
  const cols = { small: ['#6cbe4c', '#4a9636'], big: ['#4e8f3d', '#2f6626'], gold: ['#d8b842', '#a8882a'], boss: ['#8a3030', '#5e1c1c'] };
  // in the OCEAN the map shows SHARKS, in the swamp GATORS - never mixed up
  const sea = !!G.summer;
  const seaCols = { small: ['#7fa8c0', '#547e98'], big: ['#5f8296', '#3e5c6e'], gold: ['#d8b842', '#a8882a'], boss: ['#42555f', '#2c3c44'] };
  let [a, b] = (sea ? seaCols : cols)[type] || (sea ? seaCols : cols).small;
  const mu = mut && MUTATIONS[mut];
  if (mu && mu.tint) { a = mu.tint.a || a; b = mu.tint.b || b; } // variant hide colour
  let sclera = '#f8f4dc', pupil = '#1b1408';
  if (mut === 'albino') pupil = '#c81818';
  if (mut === 'alien') { sclera = '#0c0c14'; pupil = '#9cff8c'; }
  if (sea) {
    // shark: sleek head, dorsal fin, gill slits, toothy grin (no bulging eyes)
    rect(x + 11, y - 5, 2, 5, a); rect(x + 12, y - 3, 3, 3, a); rect(x + 10, y - 1, 5, 2, b); // dorsal fin
    rr(x, y + 2, 22, 8, 3, a);
    rr(x + 1, y + 9, 20, 5, 2, b);
    rect(x + 2, y + 9, 18, 1, '#f4f0dc'); // teeth line
    for (let k = 0; k < 3; k++) rect(x + 3 + k * 2, y + 4, 1, 4, b); // gill slits
    rect(x + 4, y + 5, 3, 2, sclera); rect(x + 5, y + 5, 1, 2, pupil);
    rect(x + 15, y + 5, 3, 2, sclera); rect(x + 16, y + 5, 1, 2, pupil);
    if (type === 'boss') { rect(x + 3, y + 1, 3, 2, C.red); rect(x + 17, y + 1, 3, 2, C.red); } // megalodon scars
  } else {
    // a pocket-sized copy of the real croc, seen head on like in the fight:
    // eye domes riding the snout, a scaly upper jaw, the pink maw with its
    // two rows of teeth, and the lower jaw
    const ink = mixHex(b, '#000000', 0.45), lt = mixHex(a, '#ffffff', 0.3);
    rr(x - 1, y + 15, 24, 4, 1, ink); rr(x, y + 15, 22, 3, 1, b);                   // lower jaw
    rect(x + 1, y + 17, 20, 1, mixHex(b, '#000000', 0.2));
    rr(x + 2, y + 10, 18, 6, 1, '#3a0e18'); rect(x + 3, y + 11, 16, 4, '#8a2438');  // the maw
    for (let k = 0; k < 5; k++) { rect(x + 3 + k * 3 + (k > 2 ? 1 : 0), y + 11, 2, 2, '#f8f2e0'); rect(x + 4 + k * 3, y + 13, 2, 2, '#f4ecd4'); }
    rr(x - 1, y + 3, 24, 8, 2, ink); rr(x, y + 4, 22, 6, 2, a);                     // upper jaw
    rect(x + 1, y + 4, 20, 1, lt);
    for (let k = 0; k < 5; k++) rect(x + 2 + k * 4, y + 6 + (k % 2), 2, 1, b);       // scutes
    rect(x + 8, y + 5, 1, 1, '#1a0e06'); rect(x + 13, y + 5, 1, 1, '#1a0e06');       // nostrils
    [[x], [x + 15]].forEach(([ex]) => {
      rr(ex - 1, y - 1, 9, 6, 2, ink); rr(ex, y, 7, 5, 2, a); rect(ex + 1, y, 5, 1, lt);
      rr(ex + 1, y + 1, 5, 3, 1, sclera);
      rect(ex + 3, y + 1, 1, 3, pupil);
      rect(ex, y - 1, 7, 1, ink);                                                   // brow ridge
    });
    if (type === 'gold' && !mu) { rect(x + 8, y - 3, 2, 2, '#fff6c8'); rect(x + 18, y + 5, 1, 1, '#fff6c8'); }
    if (type === 'boss') { rect(x + 2, y - 2, 3, 3, C.red); rect(x + 9, y - 3, 3, 4, C.red); rect(x + 16, y - 2, 3, 3, C.red); }
  }
  // ---- MUTATION custom marker: a per-variant snout pattern + a floating gem ----
  if (mu) {
    if (mut === 'spotted') { rect(x + 6, y + 6, 2, 2, b); rect(x + 13, y + 7, 2, 2, b); rect(x + 9, y + 10, 2, 2, b); }
    else if (mut === 'striped') { rect(x + 6, y + 5, 1, 6, b); rect(x + 11, y + 5, 1, 6, b); rect(x + 16, y + 5, 1, 6, b); }
    else if (mut === 'diamond') { rect(x + 4, y + 6, 1, 1, '#eafcff'); rect(x + 18, y + 8, 1, 1, '#eafcff'); }
    else if (mut === 'extra') { rect(x + 6, y + 12, 1, 3, '#fff'); rect(x + 10, y + 12, 1, 3, '#fff'); rect(x + 14, y + 12, 1, 3, '#fff'); }
    else if (mut === 'corroded') { rect(x + 7, y + 6, 2, 1, '#3e240e'); rect(x + 13, y + 8, 2, 1, '#3e240e'); }
    // the "custom icon": a little faceted gem in the mutation colour above the head
    const gx = x + 11, gy = y - 5;
    rect(gx - 2, gy, 4, 1, mu.col); rect(gx - 1, gy - 1, 2, 1, mu.col); rect(gx - 1, gy + 1, 2, 1, mu.col); rect(gx, gy + 2, 1, 1, mu.col);
    rect(gx - 1, gy, 1, 1, '#ffffffcc');
  }
}
// ============================ THE FIELD CHART ==============================
//  The trail is a ranger's hand-inked chart spread out on the station's map
//  table: a parchment sheet with burnt edges and fold creases, the swamp
//  painted on it in ink and wash - keys and hammocks of cypress, sawgrass
//  hatching, depth contours, a compass rose - and the route to the boss
//  drawn in dotted ink between wax-seal stops.  The geography is generated
//  per ante and cached, so every ante is a new stretch of swamp.
// ==========================================================================
const CHART = { x: 12, y: 24, w: 456, h: 226 };
const MAP_DOCK = { x: 84, y: 164 };
function nodePos(stage, k, count) {
  const xs = [178, 284, 390];
  const ys = count === 1 ? [134] : count === 2 ? [88, 176] : [72, 134, 196];
  return { x: xs[stage], y: ys[k] };
}
const boatPark = p => ({ x: p.x, y: p.y + 22 });
function routeCtl(ax, ay, bx, by) { return { x: (ax + bx) / 2, y: (ay + by) / 2 + Math.sin((ax + bx) * 0.05) * 12 }; }
function mapRoutes() {
  const legs = [];
  G.map.stages.forEach((opts, s) => opts.forEach((node, k) => {
    const to = boatPark(nodePos(s, k, opts.length));
    const froms = s === 0 ? [{ p: MAP_DOCK, j: 0 }] : G.map.stages[s - 1].map((_, j) => ({ p: boatPark(nodePos(s - 1, j, G.map.stages[s - 1].length)), j }));
    froms.forEach(f => legs.push({ s, k, j: f.j, a: f.p, b: to }));
  }));
  return legs;
}
// smooth value noise from the fixed hash
function vnoise(x, y, cell, seed) {
  const gx = Math.floor(x / cell), gy = Math.floor(y / cell), fx = x / cell - gx, fy = y / cell - gy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(gx + seed, gy), b = hash2(gx + 1 + seed, gy), c = hash2(gx + seed, gy + 1), d = hash2(gx + 1 + seed, gy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy || 1;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / l, 0, 1);
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}
function chartPalette() {
  return G.summer
    ? { paper: ['#6a5230', '#c8b088', '#e2cfa4', '#eee0bc', '#f8f0d8'], water: ['#0e4a66', '#1e6e8e', '#3a92ae', '#76c0d2'], land: ['#a08a50', '#c4ac6c', '#dcc890'], ink: '#3a2410', tree: '#2e6a3a', label: 'HERE BE SHARKS' }
    : { paper: ['#5a4424', '#b89e70', '#d6c092', '#e6d4aa', '#f4e8c8'], water: ['#123e44', '#1e5a5a', '#347a70', '#62a08a'], land: ['#5a6428', '#76823a', '#949c4e'], ink: '#2a1a0a', tree: '#24401e', label: 'HERE BE GATORS' };
}
function chartStatic() {
  const C2 = CHART, P = chartPalette(), seed = ((G.map && G.map.id) || 0) % 9973 + G.ante * 13 + (G.summer ? 500 : 0);
  // ---- the map table ----
  rect(0, 0, W, H, UWOOD[1]);
  for (let y = 0; y < H; y += 9) { rect(0, y, W, 1, UWOOD[0]); woodGrain(0, y + 1, W, 8, UWOOD[0], UWOOD[2], y); }
  // ---- the parchment sheet, with a ragged burnt edge ----
  const edge = (x, y) => {
    const d = Math.min(x - C2.x, C2.x + C2.w - x, y - C2.y, C2.y + C2.h - y);
    return d + (vnoise(x, y, 6, 3) - 0.5) * 7;
  };
  ctx.save(); ctx.globalAlpha = 0.5;
  for (let y = C2.y - 4; y < C2.y + C2.h + 6; y += 2) for (let x = C2.x - 4; x < C2.x + C2.w + 6; x += 2) if (edge(x - 3, y - 4) > 0 && edge(x, y) <= 0) rect(x, y, 2, 2, '#000000');
  ctx.restore();
  const legs = mapRoutes();
  const nodes = [MAP_DOCK];
  G.map.stages.forEach((opts, s) => opts.forEach((_, k) => nodes.push(nodePos(s, k, opts.length))));
  for (let y = C2.y - 3; y < C2.y + C2.h + 3; y += 2) for (let x = C2.x - 3; x < C2.x + C2.w + 3; x += 2) {
    const e = edge(x, y);
    if (e <= 0) continue;
    // land or water: noise, pushed to water along the routes and to land at each stop
    let h = vnoise(x, y, 34, seed) * 0.65 + vnoise(x, y, 13, seed + 7) * 0.35;
    let rd = 99; legs.forEach(L => { const c = routeCtl(L.a.x, L.a.y, L.b.x, L.b.y); rd = Math.min(rd, segDist(x, y, L.a.x, L.a.y, c.x, c.y), segDist(x, y, c.x, c.y, L.b.x, L.b.y)); });
    if (rd < 13) h -= (13 - rd) / 13 * 0.5;
    nodes.forEach(n => { const d = Math.hypot(x - n.x, (y - n.y) * 1.3); if (d < 20) h = Math.max(h, 0.62 + (20 - d) / 60); });
    if (x > C2.x + C2.w - 44) h -= 0.08;                 // open water toward the uncharted east
    const land = h > 0.58, shal = !land && h > 0.5;
    let col;
    if (land) col = h > 0.72 ? P.land[2] : h > 0.64 ? P.land[1] : P.land[0];
    else col = shal ? P.water[3] : h < 0.32 ? P.water[0] : h < 0.42 ? P.water[1] : P.water[2];
    // wash the colour into the paper so it reads as ink on parchment
    const base = e < 5 ? P.paper[1] : e < 9 ? P.paper[2] : P.paper[3];
    rect(x, y, 2, 2, mixC(base, col, e < 6 ? 0.3 : 0.8));
    if (hash2(x, y) < 0.07) rect(x + (y & 1), y, 1, 1, P.paper[e < 6 ? 0 : 1]);
    // shoreline ink: a thin line wherever land meets water
    const hr = vnoise(x + 2, y, 34, seed) * 0.65 + vnoise(x + 2, y, 13, seed + 7) * 0.35;
    const hd = vnoise(x, y + 2, 34, seed) * 0.65 + vnoise(x, y + 2, 13, seed + 7) * 0.35;
    const hn = 0;
    if (e > 6 && rd >= 13 && ((hr > 0.58) !== land || (hd > 0.58) !== land)) rect(x + 1, y + 1, 1, 1, mixC(P.ink, col, 0.25));
    if (e > 6 && land && hd <= 0.58 && rd >= 13) rect(x, y + 2, 2, 1, mixC(P.water[3], '#ffffff', 0.25));   // a lit lip of foam
    // sawgrass hatching on land, wave ticks on open water
    if (land && e > 8 && hash2(x >> 1, y >> 1) < 0.08) { rect(x, y, 1, 2, P.tree); rect(x + 1, y - 1, 1, 2, P.tree); }
    if (!land && !shal && e > 8 && hash2(x, y + 9) < 0.012) { rect(x, y, 2, 1, P.water[3]); rect(x + 2, y - 1, 2, 1, P.water[3]); rect(x + 4, y, 2, 1, P.water[3]); }
    void hn;
  }
  // depth contours: dotted rings in the deep water
  for (let y = C2.y + 8; y < C2.y + C2.h - 8; y += 3) for (let x = C2.x + 8; x < C2.x + C2.w - 8; x += 3) {
    const h = vnoise(x, y, 34, seed) * 0.65 + vnoise(x, y, 13, seed + 7) * 0.35;
    if (Math.abs(h - 0.4) < 0.008 || Math.abs(h - 0.3) < 0.008) rect(x, y, 1, 1, mixC(P.water[0], P.paper[3], 0.3));
  }
  // cypress hammocks: stamped tree symbols on the higher ground
  for (let k = 0; k < 140; k++) {
    const tx = C2.x + 14 + Math.floor(hash2(k, seed) * (C2.w - 28)), ty = C2.y + 14 + Math.floor(hash2(seed, k) * (C2.h - 28));
    const h = vnoise(tx, ty, 34, seed) * 0.65 + vnoise(tx, ty, 13, seed + 7) * 0.35;
    if (h < 0.66) continue;
    if (nodes.some(n => Math.hypot(tx - n.x, ty - n.y) < 20)) continue;
    rect(tx, ty + 3, 1, 3, P.ink);
    rr(tx - 3, ty - 2, 7, 6, 2, P.ink); rr(tx - 2, ty - 1, 5, 4, 2, P.tree); rect(tx - 1, ty - 1, 2, 1, mixC(P.tree, '#ffffff', 0.3));
  }
  // lily pad clusters and a doodled gator in the channel
  for (let k = 0; k < 16; k++) {
    const lx = C2.x + 20 + Math.floor(hash2(k + 50, seed) * (C2.w - 60)), ly = C2.y + 20 + Math.floor(hash2(seed, k + 50) * (C2.h - 40));
    const h = vnoise(lx, ly, 34, seed) * 0.65 + vnoise(lx, ly, 13, seed + 7) * 0.35;
    if (h > 0.55 || h < 0.44) continue;
    rr(lx, ly, 4, 3, 1, '#4a7a3a'); rr(lx + 4, ly + 2, 3, 2, 1, '#4a7a3a');
  }
  const dg = { x: C2.x + 150 + Math.floor(hash2(seed, 99) * 140), y: C2.y + C2.h - 22 };
  pxLine(dg.x, dg.y, dg.x + 26, dg.y - 2, P.ink); pxLine(dg.x + 26, dg.y - 2, dg.x + 32, dg.y, P.ink);
  for (let k = 0; k < 5; k++) rect(dg.x + 4 + k * 5, dg.y - 2 - (k % 2), 2, 2, P.ink);
  rect(dg.x + 24, dg.y - 4, 2, 2, P.ink); rect(dg.x - 6, dg.y, 6, 1, P.ink);
  drawText(P.label, dg.x - 12, dg.y + 4, mixC(P.ink, P.paper[2], 0.3), 1);
  // fold creases
  ctx.save(); ctx.globalAlpha = 0.25;
  for (let y = C2.y + 4; y < C2.y + C2.h - 4; y++) { rect(C2.x + C2.w / 2, y, 1, 1, '#ffffff'); rect(C2.x + C2.w / 2 + 1, y, 1, 1, P.paper[0]); }
  for (let x = C2.x + 4; x < C2.x + C2.w - 4; x++) { rect(x, C2.y + C2.h / 2, 1, 1, '#ffffff'); rect(x, C2.y + C2.h / 2 + 1, 1, 1, P.paper[0]); }
  ctx.restore();
  // coffee ring and an ink blot
  ctx.save(); ctx.globalAlpha = 0.28; ringPx(C2.x + 60, C2.y + C2.h - 40, 13, '#5a3a1a'); ringPx(C2.x + 60, C2.y + C2.h - 40, 12, '#5a3a1a', 0, 4); ctx.restore();
  ctx.save(); ctx.globalAlpha = 0.6; rr(C2.x + C2.w - 70, C2.y + 36, 6, 5, 2, P.ink); rect(C2.x + C2.w - 63, C2.y + 40, 2, 2, P.ink); ctx.restore();
  // uncharted east: cross-hatch fading out
  for (let y = C2.y + 6; y < C2.y + C2.h - 6; y += 2) for (let x = C2.x + C2.w - 40; x < C2.x + C2.w - 4; x += 2) {
    const f = (x - (C2.x + C2.w - 40)) / 36;
    if (((x + y) % 6 === 0 || (x - y + 600) % 6 === 0) && hash2(x, y) < f) rect(x, y, 1, 1, mixC(P.ink, P.paper[3], 0.4));
  }
  ctx.save(); ctx.translate(C2.x + C2.w - 20, C2.y + C2.h / 2); ctx.rotate(-Math.PI / 2); drawTextC('UNCHARTED', 0, -2, mixC(P.ink, P.paper[3], 0.35), 1); ctx.restore();
  // compass rose, bottom right
  const cx = C2.x + C2.w - 70, cy = C2.y + C2.h - 34;
  ringPx(cx, cy, 14, P.ink); ringPx(cx, cy, 12, mixC(P.ink, P.paper[3], 0.5));
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 - Math.PI / 2; for (let r = 0; r < 18; r++) { const w2 = Math.max(0, 3 - Math.floor(r / 6)); rect(cx + Math.round(Math.cos(a) * r) - (k % 2 ? 0 : w2 >> 1), cy + Math.round(Math.sin(a) * r) - (k % 2 ? w2 >> 1 : 0), k % 2 ? 1 : Math.max(1, w2), k % 2 ? Math.max(1, w2) : 1, k === 0 ? '#a83a2a' : P.ink); } }
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; pxLine(cx, cy, cx + Math.cos(a) * 9, cy + Math.sin(a) * 9, mixC(P.ink, P.paper[3], 0.4)); }
  drawTextC('N', cx + 1, cy - 26, '#a83a2a', 1);
  // scale bar, bottom left
  const sx0 = C2.x + 20, sy0 = C2.y + C2.h - 16;
  for (let k = 0; k < 4; k++) rect(sx0 + k * 10, sy0, 10, 3, k % 2 ? P.paper[3] : P.ink);
  rect(sx0, sy0, 40, 1, P.ink); rect(sx0, sy0 + 3, 40, 1, P.ink);
  drawText('1 MILE (ISH)', sx0 + 44, sy0 - 1, mixC(P.ink, P.paper[3], 0.25), 1);
  // the dock where every ante starts
  rr(MAP_DOCK.x - 16, MAP_DOCK.y - 4, 26, 6, 1, P.ink); rr(MAP_DOCK.x - 15, MAP_DOCK.y - 3, 24, 4, 1, '#8a6a3a');
  for (let k = 0; k < 4; k++) rect(MAP_DOCK.x - 13 + k * 6, MAP_DOCK.y - 3, 1, 4, '#5a3a1a');
  rect(MAP_DOCK.x - 20, MAP_DOCK.y - 26, 16, 20, P.ink); rect(MAP_DOCK.x - 19, MAP_DOCK.y - 25, 14, 18, '#6a8a6a');                // ranger tower icon
  for (let k = 0; k < 3; k++) rect(MAP_DOCK.x - 22 + k, MAP_DOCK.y - 28 - k, 20 - k * 2, 1, '#8a3a2a');
  rect(MAP_DOCK.x - 16, MAP_DOCK.y - 20, 4, 4, '#f0d070'); rect(MAP_DOCK.x - 10, MAP_DOCK.y - 20, 4, 4, '#f0d070');
  drawTextC('HQ DOCK', MAP_DOCK.x - 12, MAP_DOCK.y + 12, P.ink, 1);
}

// a stop on the trail: a wax-seal medallion pinned into the chart
function drawMapStop(node, p, st) {
  const d = NODE_DEFS[node.type];
  const P = chartPalette();
  const bob = st.reachable ? Math.round(Math.sin(tNow * 4 + p.x) * 1.5) : 0;
  const x = p.x, y = p.y - bob;
  const mu = node.mut && MUTATIONS[node.mut];
  const rim = node.type === 'boss' ? ['#2a0806', '#6a1410', '#a8261e', '#d84a3a', '#ff9a8a']
    : node.type === 'gold' ? UGOLD
      : node.type === 'event' ? ['#1a0c26', '#4a2a6a', '#7a4aa8', '#a878d8', '#dcc0ff']
        : node.type === 'big' ? ['#0c1a0a', '#1e4a1c', '#2e6a2a', '#4a8a3a', '#8ac86a']
          : ['#0c1a0a', '#2a6a2a', '#3e8a3a', '#62b04e', '#a8e88a'];
  // shadow and glow
  ctx.save(); ctx.globalAlpha = 0.35; ctx.scale(1, 0.5); fillCircle(x + 2, (p.y + 16) / 0.5, 14, '#000'); ctx.restore();
  if (st.reachable) { ctx.save(); ctx.globalAlpha = 0.28 + Math.sin(tNow * 4) * 0.12; fillCircle(x, y, 20, mu ? mu.col : rim[3]); ctx.restore(); }
  if (st.hov) { ctx.save(); ctx.globalAlpha = 0.4; fillCircle(x, y, 22, '#fff4c0'); ctx.restore(); }
  // the wax seal: lumpy rim, pressed face
  // wax drips
  [[0.6, 4], [2.3, 3], [4.1, 3]].forEach(([a, r2]) => { const dx = Math.round(Math.cos(a + x) * 13), dy = Math.round(Math.sin(a + x) * 13); fillCircle(x + dx, y + dy, r2, rim[0]); fillCircle(x + dx, y + dy, r2 - 1, rim[2]); });
  fillCircle(x, y, 15, rim[0]); fillCircle(x, y, 14, rim[1]); fillCircle(x - 1, y - 1, 13, rim[2]); fillCircle(x, y, 11, rim[1]); fillCircle(x, y, 10, rim[2]);
  ringPx(x, y, 12, rim[3], Math.PI * 1.05, Math.PI * 1.6);
  rect(x - 6, y - 10, 5, 1, rim[4]); rect(x - 8, y - 8, 2, 1, rim[4]);
  if (st.passed && !st.visited) { ctx.save(); ctx.globalAlpha = 0.55; fillCircle(x, y, 15, P.paper[2]); ctx.restore(); }
  // the emblem pressed into the wax
  if (node.type === 'event') { drawTextCSh('?', x + 1, y - 5, '#f4e8ff', 2, rim[0]); }
  else drawMiniGator(x - 11, y - 7, node.type, node.mut);
  if (node.type === 'boss') { rect(x - 7, y - 14, 15, 3, '#e8c040'); rect(x - 7, y - 17, 3, 3, '#e8c040'); rect(x - 1, y - 18, 3, 4, '#e8c040'); rect(x + 5, y - 17, 3, 3, '#e8c040'); rect(x - 6, y - 14, 13, 1, '#fff0a0'); }
  if (mu) { ctx.save(); ctx.globalAlpha = 0.3 + Math.sin(tNow * 4 + x) * 0.15; ringPx(x, y, 16, mu.col); ringPx(x, y, 17, mu.col); ctx.restore(); }
  // the paper tag under it
  const seaLbl = { small: 'REEF', big: 'TIGER', gold: 'GOLD', boss: 'MEGALODON' };
  const lbl = mu ? mu.name : node.type === 'boss' ? (G.summer ? 'MEGALODON' : 'BOSS') : G.summer ? (seaLbl[node.type] || node.type.toUpperCase()) : node.type === 'event' ? 'EVENT' : node.type.toUpperCase();
  const tw = textW(lbl, 1) + 8;
  paperSheet(x - tw / 2, y + 15, tw, 10, { noCorner: 1, ramp: ['#3a2a14', '#d8c8a0', '#f0e4c4', '#f8f0dc', '#ffffff'] });
  drawTextC(lbl, x, y + 17, st.visited ? '#2a6a2a' : mu ? mixC(mu.col, '#000000', 0.35) : st.reachable ? '#241a10' : '#8a7a5a', 1);
  (node.mods || []).forEach((m, mi) => { const n2 = node.mods.length; drawModChip(x - (n2 * 13) / 2 + mi * 13 + 1, y + 27, m); });
  if (st.visited) {                                    // inked X over the stop you took
    ctx.save(); ctx.globalAlpha = 0.85;
    for (let k = -8; k <= 8; k++) { rect(x + k, y + k, 2, 2, '#a8261e'); rect(x + k, y - k, 2, 2, '#a8261e'); }
    ctx.restore();
  }
}

function drawMap() {
  const P = chartPalette();
  const key = 'chart_' + G.ante + '_' + (G.summer ? 's' : 'g') + '_' + (G.map.id || 0) + '_' + G.map.stages.map(o => o.length).join('');
  if (G._chartKey !== key) { for (const k in PAINT_CACHE) if (k.startsWith('chart_')) delete PAINT_CACHE[k]; G._chartKey = key; }
  paintCached(key, 0, 0, W, H, chartStatic);
  // lantern light pooling on the table from the top left
  ctx.save(); ctx.globalAlpha = 0.06 + Math.sin(tNow * 7) * 0.01 + Math.sin(tNow * 13) * 0.008;
  for (let r = 0; r < 5; r++) fillCircle(60, 40, 90 + r * 40, '#ffd890');
  ctx.restore();
  // ---- the route: dotted ink between stops, reachable legs march ----
  mapRoutes().forEach(L => {
    const lit = L.s === G.map.stage && (L.s === 0 || G.map.picked[L.s - 1] === L.j);
    const done = L.s < G.map.stage && G.map.picked[L.s] === L.k && (L.s === 0 || G.map.picked[L.s - 1] === L.j);
    const dead = !lit && !done && L.s <= G.map.stage;
    const c = routeCtl(L.a.x, L.a.y, L.b.x, L.b.y);
    const n = 20, march = lit ? (tNow * 1.2) % 1 : 0;
    for (let i = 1; i < n; i++) {
      const t = (i + march) / n, u = 1 - t;
      if (t > 0.94) continue;
      const px = u * u * L.a.x + 2 * u * t * c.x + t * t * L.b.x, py = u * u * L.a.y + 2 * u * t * c.y + t * t * L.b.y;
      if (done) rect(px, py, 2, 2, '#a8261e');
      else if (lit) { rect(px, py, 2, 2, (i & 1) ? '#a8261e' : '#d8503a'); }
      else if (!dead) { if (i % 2) rect(px, py, 1, 1, mixC(P.ink, P.paper[3], 0.5)); }
      else if (i % 3 === 0) rect(px, py, 1, 1, mixC(P.ink, P.paper[3], 0.65));
    }
  });
  // a gator surfaces in a channel now and then (drawn in ink, of course)
  const gs = (tNow * 0.08) % 1;
  if (gs < 0.35) {
    const gx = CHART.x + 120 + gs * 700 % 260, gy = CHART.y + 140 + Math.sin(gs * 20) * 20;
    ctx.save(); ctx.globalAlpha = Math.sin(gs / 0.35 * Math.PI) * 0.8;
    rect(gx, gy, 3, 2, P.ink); rect(gx + 5, gy, 3, 2, P.ink); rect(gx + 1, gy, 1, 1, '#e8c040'); rect(gx + 6, gy, 1, 1, '#e8c040');
    rect(gx - 5, gy + 2, 18, 1, mixC(P.water[3], '#ffffff', 0.3));
    ctx.restore();
  }
  // ---- the stops ----
  let hovNode = null;
  G.map.stages.forEach((opts, s) => opts.forEach((node, k) => {
    const p = nodePos(s, k, opts.length);
    const reachable = s === G.map.stage && !G.boat;
    const hov = reachable && Math.hypot(mx - p.x, my - p.y) < 18;
    if (hov) hovNode = node;
    drawMapStop(node, p, { reachable: s === G.map.stage, visited: G.map.picked[s] === k, passed: s < G.map.stage, hov });
    if (reachable) hit(p.x - 18, p.y - 18, 36, 46, {
      id: 'node' + s + '_' + k, cursor: true, tip: nodeTip(node),
      cb: () => {
        const from2 = s === 0 ? MAP_DOCK : boatPark(nodePos(s - 1, G.map.picked[s - 1], G.map.stages[s - 1].length));
        const to = boatPark(p);
        const dist = Math.hypot(to.x - from2.x, to.y - from2.y);
        G.boat = { x: from2.x, y: from2.y, sx: from2.x, sy: from2.y, tx: to.x, ty: to.y, t: 0, k, dur: clamp(dist / 110, 0.8, 1.6), lean: 0 };
        sfx.splash(); addRipple(from2.x, from2.y + 4, false);
      },
    });
  }));
  // ---- the boat token, ranger aboard ----
  const bpos = G.boat ? G.boat : G.map.stage === 0 ? MAP_DOCK : boatPark(nodePos(G.map.stage - 1, G.map.picked[G.map.stage - 1] || 0, G.map.stages[G.map.stage - 1].length));
  const bob = Math.round(Math.sin(tNow * 2.2) * 1);
  const lean = G.boat ? Math.round(G.boat.lean || 0) : 0;
  ctx.save(); ctx.translate(bpos.x, bpos.y + bob); ctx.scale(0.8, 0.8); ctx.translate(-bpos.x, -(bpos.y + bob));
  drawRowBoat(bpos.x, bpos.y + bob, lean, !!G.boat);
  drawBobble(bpos.x + lean * 0.4, bpos.y + 1 + bob, G.ranger, { sc: 0.42, expr: G.boat ? 'wow' : 'happy', act: G.boat ? 'row' : 'idle', ...myFit() });
  ctx.restore();
  drawRipples(0.6);

  // ---- the title ribbon across the top edge ----
  const tt = G.summer ? 'THE OPEN OCEAN' : 'THE SWAMP TRAIL';
  const rw = textW(tt, 2) + 40, rx = W / 2 - rw / 2;
  [[rx - 14, 1], [rx + rw - 2, -1]].forEach(([ex, s]) => { for (let j = 0; j < 16; j++) { const w2 = 16 - Math.abs(j - 8) * (s > 0 ? 1 : 1); rect(s > 0 ? ex + 16 - w2 : ex, 8 + j, w2, 1, j < 1 || j > 14 ? '#3a0a08' : '#7a1a14'); } });
  plasticBox(rx, 4, rw, 20, 3, ['#2a0806', '#7a1a14', '#a8261e', '#c8403a', '#f08a7a'], { noShine: 1 });
  drawTextCSh(tt, W / 2, 8, '#fff0d8', 2, '#3a0a08');
  const an = G.summer ? 'ANTE ' + G.ante + '  -  ENDLESS SEAS' : 'ANTE ' + G.ante + (G.ante <= 8 ? ' OF 8  -  ' + ANTE_NAMES[G.ante - 1] : '  -  ENDLESS');
  const aw = textW(an, 1) + 12;
  paperSheet(W / 2 - aw / 2, 26, aw, 11, { noCorner: 1 });
  drawTextC(an, W / 2, 29, P.ink, 1);

  // ---- money pouch, pinned top left ----
  plasticBox(16, 28, 62, 18, 3, ['#1a0e06', '#5a3418', '#7a4a24', '#946032', '#b8804a'], { noShine: 1 });
  ICONS.coin(20, 31); drawText(curLabel(G.money), 36, 34, '#ffe089', 1);
  // ---- the quest note ----
  ensureDaily();
  const actQ = activeQuests();
  paperSheet(16, 50, 94, 20 + Math.max(1, Math.min(QUEST_MAX, actQ.length)) * 15, {});
  pushPin(63, 51, PINS[0]);
  drawText('QUESTS', 21, 55, '#6a3a8a', 1);
  if (!actQ.length) { drawText('NONE TAKEN', 21, 66, '#8a7a5a', 1); drawText('SEE THE BOARD', 21, 74, '#8a7a5a', 1); }
  actQ.slice(0, QUEST_MAX).forEach((q, i) => {
    const qy = 66 + i * 15;
    rect(20, qy, 4, 4, NPCS[q.npc] ? NPCS[q.npc].col : C.gold);
    drawText(q.name.slice(0, 13), 27, qy - 1, '#241a10', 1);
    rect(27, qy + 6, 56, 3, '#c8b890');
    const pr = clamp(q.prog / q.goal, 0, 1);
    if (pr > 0) rect(27, qy + 6, Math.floor(56 * pr), 3, '#3a8a3a');
    drawText(q.prog + '/' + q.goal, 86, qy + 4, '#6a5a3a', 1);
    hit(18, qy - 2, 90, 14, { id: 'qtrack' + q.id, tip: q.name + '|' + q.prog + '/' + q.goal + '  (+' + q.rp + ' COOKIES)' });
  });
  // ---- a brass compass and a pencil on the table ----
  fillCircle(452, 24, 13, '#1a1206'); fillCircle(452, 24, 12, UGOLD[1]); fillCircle(452, 24, 10, '#f0e8d0');
  const na = Math.sin(tNow * 0.7) * 0.25 - Math.PI / 2;
  pxLine(452, 24, 452 + Math.cos(na) * 8, 24 + Math.sin(na) * 8, '#c8301f', 2); pxLine(452, 24, 452 - Math.cos(na) * 7, 24 - Math.sin(na) * 7, '#3a3a3a', 1);
  rect(451, 23, 2, 2, UGOLD[0]); rect(446, 14, 4, 1, '#ffffff');
  pxLine(398, 258, 446, 246, '#1a1206', 4); pxLine(399, 257, 445, 245, '#e8b830', 2); rect(446, 244, 4, 4, '#e87a8a'); rect(396, 258, 3, 2, '#3a2a1a');
  drawTextC(G.boat ? 'ROWING...' : hovNode ? 'CLICK TO ROW THERE' : 'PICK YOUR NEXT STOP', W / 2, H - 12, '#f4e2b8', 1);
}

function drawRowBoat(x, y, lean, moving) {
  const stroke = moving ? Math.sin(tNow * 4.6) : Math.sin(tNow * 1.2) * 0.25;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(lean * 0.02);
  // ---- wake / ripples trailing the stern ----
  ctx.save(); ctx.globalAlpha = moving ? 0.45 : 0.22;
  for (let k = 1; k <= 3; k++) {
    const sp = 12 + k * 7;
    rect(-sp - 8, 3 - k, 9 - k, 1, '#7fc8d8'); rect(-sp - 8, 3 + k, 9 - k, 1, '#7fc8d8');
  }
  ctx.restore();
  // ---- oars (behind the hull on the far side, in front on the near) ----
  const oarA = stroke * 0.55;
  [[-1, -6], [1, 6]].forEach(([side, ox]) => {
    ctx.save(); ctx.translate(ox, -3); ctx.rotate(oarA * side);
    rect(0, -1, 17 * (side > 0 ? 1 : -1), 2, '#6a4a28');
    rr(side > 0 ? 15 : -20, -3, 6, 6, 2, '#8a6438');                  // blade
    rect(side > 0 ? 16 : -19, -2, 4, 1, '#a8804a');
    ctx.restore();
    // splash where the blade bites the water
    if (moving && Math.abs(stroke) > 0.86) { ctx.save(); ctx.globalAlpha = 0.5; fillCircle(ox + side * 18, 1, 3, '#bfeaf5'); ctx.restore(); }
  });
  // ---- hull: dark keel, warm planks, bright gunwale ----
  rr(-15, -4, 30, 11, 4, '#2e1d10');
  rr(-14, -4, 28, 9, 4, '#7a5230');
  rr(-13, -3, 26, 4, 3, '#9a6a3e');
  rect(-12, 1, 24, 1, '#5e3c20');
  rect(-12, 3, 24, 2, '#4a2f18');
  [-8, -2, 4, 9].forEach(rx => rect(rx, -3, 1, 7, '#5e3c20'));        // ribs
  rr(-15, -6, 30, 3, 2, '#b08050');                                    // gunwale rail
  rect(-14, -6, 28, 1, '#d2a26a');
  rect(14, -5, 3, 2, '#b08050'); rect(-17, -5, 3, 2, '#b08050');       // bow + stern tips
  // ---- a little lantern on the bow ----
  rect(11, -12, 1, 6, '#3a2818');
  rr(9, -16, 5, 5, 2, '#2a2018'); rect(10, -15, 3, 3, '#ffd54a');
  glow(11, -14, 16, '#ffb848', 0.3 + Math.sin(tNow * 5) * 0.06);
  ctx.restore();
}

function nodeTip(node) {
  const d = NODE_DEFS[node.type];
  if (node.type === 'event') return 'SWAMP EVENT|Something is waiting in the reeds...|No fight. No shop. A choice.';
  const base = G.ante <= 8 ? ANTE_BASE[G.ante - 1] : ANTE_BASE[7] * Math.pow(1.7, G.ante - 8);
  const mu = node.mut && MUTATIONS[node.mut];
  const seaName = { small: 'REEF SHARK', big: 'TIGER SHARK', gold: 'GOLDEN SHARK', boss: 'MEGALODON' };
  const dName = G.summer ? (seaName[node.type] || d.name) : d.name;
  let t = (mu ? mu.name + ' ' : '') + dName + '|TARGET: ' + fmt(Math.round(base * d.mult)) + '|REWARD: $' + (d.reward + Math.floor(G.ante / 3) + ((node.mods || []).includes('richwater') ? 4 : 0));
  if (mu) t += '|' + MUTATIONS[node.mut].flav;
  (node.mods || []).forEach(m => {
    const md = NODE_MODS[m];
    t += '|' + (md.bad ? '! ' : '+ ') + md.name + ': ' + md.desc;
  });
  if (node.type === 'gold') t += '|Tough bite, fat payout';
  if (node.type === 'boss') t += '|A rule-bending boss awaits';
  return t;
}
function updateBoat(dt) {
  const b = G.boat; if (!b) return;
  b.t += dt;
  const f = clamp(b.t / b.dur, 0, 1);
  const e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2; // easeInOut
  // quadratic bezier: the midpoint dips onto the winding channel line
  const ctl = routeCtl(b.sx, b.sy, b.tx, b.ty), mx2 = ctl.x, my2 = ctl.y;
  const u = 1 - e;
  b.x = u * u * b.sx + 2 * u * e * mx2 + e * e * b.tx;
  b.y = u * u * b.sy + 2 * u * e * my2 + e * e * b.ty;
  b.lean = (b.tx - b.sx > 0 ? 1 : -1) * Math.sin(e * Math.PI) * 2; // heels into the ride
  // churning wake while underway
  b.wake = b.wake || 0; b.wake -= dt;
  if (b.wake <= 0 && f > 0.02 && f < 0.96) {
    b.wake = 0.09;
    addRipple(b.x - (b.tx > b.sx ? 10 : -10), b.y + 6, false);
    parts.push({ x: b.x - (b.tx > b.sx ? 12 : -12), y: b.y + 5, vx: (b.sx - b.tx) * 0.25 + (rnd() - 0.5) * 20, vy: -20 - rnd() * 25, g: 190, t: 0, life: 0.35 + rnd() * 0.2, col: '#7fb8c8', sz: 1 });
  }
  if (f >= 1) {
    const k = b.k;
    addRipple(b.tx, b.ty + 2, true); sfx.splash();
    G.boat = null;
    pickNode(k);
  }
}

// --------------------------- scout gacha-pon + quest board ----------------
const RAR_NAMES = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY'];
const RAR_COLS = ['#9fb2c8', '#3e8cd0', '#a860e8', '#ffc843'];
const CAP_COLS = ['#ff8ab0', '#7fd4e8', '#ffe089', '#a8e86a', '#c8a8f8', '#ff9838', '#63d66a'];
function drawGachaMachine(x, y, jolt, crankA, hideCap) {
  // x,y = top-left; 104 wide, 132 tall
  const jx = jolt ? ri(-1, 1) : 0, jy2 = jolt ? ri(-1, 1) : 0;
  ctx.save(); ctx.translate(x + jx, y + jy2);
  // glass dome
  rr(6, 0, 92, 62, 10, '#3a4a55');
  rr(9, 3, 86, 56, 9, '#0e1a22');
  // capsules jostling inside
  CAP_COLS.forEach((c, i) => {
    if (hideCap === i) return; // this one already dropped
    const cx2 = 16 + (i % 4) * 20 + (((i / 4) | 0) % 2) * 9;
    const cy2 = 34 - ((i / 4) | 0) * 16 + (jolt ? ri(-2, 1) : Math.round(Math.sin(tNow * 1.4 + i * 2) * 1));
    fillCircle(cx2 + 6, cy2 + 6, 7, c);
    ctx.save(); ctx.globalAlpha = 0.55; fillCircle(cx2 + 6, cy2 + 8, 6, '#f4f2e4'); ctx.restore();
    rect(cx2 + 3, cy2 + 2, 3, 2, '#ffffffaa');
  });
  // glass shine
  ctx.save(); ctx.globalAlpha = 0.18; rect(14, 6, 5, 48, '#eafcff'); rect(22, 6, 2, 48, '#eafcff'); ctx.restore();
  // body
  rr(0, 60, 104, 56, 6, '#8a2430');
  rr(3, 63, 98, 50, 5, '#c23a4a');
  rect(3, 63, 98, 8, '#d85a66');
  // marquee
  rr(24, 66, 56, 12, 3, '#2a1216');
  drawTextC('GACHA', 52, 69, '#ffe089', 1);
  // coin slot + crank
  rr(10, 84, 18, 22, 3, '#7a1c28');
  rect(16, 88, 6, 2, '#2a1216'); drawTextC('25', 19, 96, '#ffe089', 1);
  const ca = crankA || 0;
  fillCircle(78, 94, 11, '#7a1c28'); fillCircle(78, 94, 9, '#e8e4d0');
  rect(77 + Math.round(Math.cos(ca) * 6), 93 + Math.round(Math.sin(ca) * 6), 4, 4, '#8a2430');
  fillCircle(78, 94, 2, '#8a2430');
  // dispense tray
  rr(34, 92, 34, 20, 3, '#5a1420');
  rr(37, 95, 28, 14, 3, '#1a0a0e');
  // legs
  rect(8, 116, 12, 8, '#5a1420'); rect(84, 116, 12, 8, '#5a1420');
  rect(2, 124, 100, 4, '#2a1216');
  ctx.restore();
}
// ---- ranger-station quest board palettes + push-pin helper --------------
const WOOD = { ink: '#2a1808', dk: '#4a3016', sh: '#5e3c1c', base: '#714a24', lt: '#8a5e30', hi: '#a5743e' };
const CORK = { ink: '#6a4420', dk: '#8a5a28', base: '#b5813f', lt: '#c89a55', fleck: '#d8b070' };
const PAPER = { ink: '#8a7a52', sh: '#d3c48c', base: '#ece0b4', lt: '#f6eecb', hi: '#fffbe8', pen: '#4a3a22', pen2: '#7a6a48' };
const PINS = [{ d: '#1c5a24', b: '#63d66a', l: '#a8f0ac' }, { d: '#153a6a', b: '#3e8cd0', l: '#7ec0ff' }, { d: '#7a1a14', b: '#e5463a', l: '#ff8a7a' }];
function pushPin(cx, cy, ramp, glint) {
  cx |= 0; cy |= 0;
  fillCircle(cx + 1, cy + 2, 3, '#00000055');
  fillCircle(cx, cy, 4, ramp.d); fillCircle(cx, cy, 3, ramp.b); fillCircle(cx - 1, cy - 1, 2, ramp.l);
  ctx.save(); ctx.globalAlpha = 0.35 + 0.65 * glint; rect(cx - 1, cy - 1, 1, 1, '#ffffff'); ctx.restore();
}
function drawQuestBoard() {
  // ---- quest board: carved ranger-station corkboard -------------------
  const BX = 236, BY = 50, BW = 232, BH = 172, CKX = 241, CKY = 55, CKW = 222, CKH = 162;
  rr(BX + 2, BY + 3, BW, BH, 4, '#00000070');
  rr(BX, BY, BW, BH, 4, WOOD.ink); rr(BX + 1, BY + 1, BW - 2, BH - 2, 3, WOOD.base);
  rect(BX + 2, BY + 2, BW - 4, 2, WOOD.hi); rect(BX + 2, BY + BH - 4, BW - 4, 2, WOOD.dk);
  rect(BX + 2, BY + 2, 2, BH - 4, WOOD.lt); rect(BX + BW - 4, BY + 2, 2, BH - 4, WOOD.dk);
  for (let gy = BY + 8; gy < BY + BH - 6; gy += 11) { rect(BX + 3, gy, 1, 7, WOOD.sh); rect(BX + BW - 4, gy + 4, 1, 7, WOOD.sh); }
  rr(CKX - 1, CKY - 1, CKW + 2, CKH + 2, 3, WOOD.ink); rr(CKX, CKY, CKW, CKH, 2, CORK.base);
  for (let fy = CKY + 2; fy < CKY + CKH - 2; fy += 5) for (let fx = CKX + 2; fx < CKX + CKW - 2; fx += 5) {
    const h = (fx * 7 + fy * 13) % 7;
    if (h === 0) rect(fx, fy, 1, 1, CORK.dk); else if (h === 3) rect(fx + 2, fy + 1, 1, 1, CORK.fleck); else if (h === 5) rect(fx + 1, fy + 2, 1, 1, CORK.lt);
  }
  ctx.save(); ctx.globalAlpha = 0.25; rect(CKX, CKY, CKW, 3, CORK.ink); rect(CKX, CKY, 3, CKH, CORK.ink); ctx.globalAlpha = 0.18; rect(CKX, CKY + CKH - 2, CKW, 2, '#ffffff'); ctx.restore();
  pushPin(CKX + 7, CKY + 7, PINS[1], 0.4); pushPin(CKX + CKW - 7, CKY + 7, PINS[2], 0.6);
  pushPin(CKX + 7, CKY + CKH - 7, PINS[0], 0.5); pushPin(CKX + CKW - 7, CKY + CKH - 7, PINS[1], 0.3);
  // carved hanging header sign
  const sx = 290, sy = 40, sw = 124, sh = 24;
  rr(sx + 2, sy + 3, sw, sh, 3, '#00000066');
  rr(sx, sy, sw, sh, 3, WOOD.dk); rr(sx + 1, sy + 1, sw - 2, sh - 2, 2, WOOD.base);
  rect(sx + 2, sy + 2, sw - 4, 2, WOOD.hi); rect(sx + 2, sy + sh - 4, sw - 4, 2, WOOD.ink);
  rect(sx + 4, sy + 9, sw - 8, 1, WOOD.sh); rect(sx + 4, sy + 16, sw - 8, 1, WOOD.sh);
  [sx + 8, sx + sw - 8].forEach(cxs => { fillCircle(cxs, sy + 7, 2, '#d8b060'); rect(cxs - 1, sy + 7, 2, 1, '#8a5a10'); });
  drawTextCSh('QUEST BOARD', 352, sy + 5, C.gold, 1, WOOD.ink);
  ensureDaily();
  const nActive = activeQuests().length;
  drawTextC('PIN UP TO ' + QUEST_MAX + ' - ' + nActive + '/' + QUEST_MAX + ' ACTIVE', 352, sy + 14, '#d8b878', 1);
  meta.qb.posts.forEach((p, i) => {
    const tilt = i % 2 ? 1 : -1;
    const px = 251, py = 70 + i * 30, pw = 200, ph = 27;
    const npc = NPCS[p.npc] || NPCS.granny;
    // tilt shadow + 3-tone paper note (accepted notes glow warmer)
    ctx.save(); ctx.globalAlpha = 0.5; rr(px + tilt, py + 2, pw, ph, 3, '#00000088'); ctx.restore();
    rr(px, py, pw, ph, 3, p.on ? '#7a5a20' : PAPER.ink);
    rr(px + 1, py + 1, pw - 2, ph - 2, 2, p.on ? '#f8ecc0' : PAPER.base);
    rect(px + 2, py + 2, pw - 4, 2, PAPER.hi); rect(px + 2, py + ph - 3, pw - 4, 1, PAPER.sh);
    // quest icon + name
    (ICONS[p.ico] || ICONS.star)(px + 4, py + 3);
    drawText(p.name, px + 20, py + 4, PAPER.pen, 1);
    // reward line: cookies (ticket quests fold their bonus into the total)
    ICONS.cookie(px + 20, py + 12);
    drawText('+' + p.rp, px + 34, py + 15, C.goldD, 1);
    // right side: ACCEPT or live progress + abandon
    if (!p.on) {
      const bx = px + pw - 52, by = py + 7, full = nActive >= QUEST_MAX;
      rr(bx, by + 1, 46, 14, 2, '#00000066');
      rr(bx, by, 46, 13, 2, full ? '#5a5a4a' : '#2c8a5b'); rr(bx, by, 46, 5, 2, full ? '#6a6a58' : '#3aa86e');
      drawTextC(full ? 'FULL' : 'ACCEPT', bx + 23, by + 4, full ? '#b8b8a8' : '#fff', 1);
      hit(bx, by, 46, 13, {
        id: 'qaccept' + p.id, cursor: true,
        tip: full ? 'BOARD FULL|Finish or drop an active quest first' : ('ACCEPT QUEST|' + p.name + '|+' + p.rp + ' COOKIES'),
        cb: () => { if (nActive >= QUEST_MAX) { sfx.error(); } else { p.on = true; saveMeta(); sfx.pin(); } },
      });
    } else {
      const bx = px + pw - 78, by = py + 9, pr = clamp(p.prog / p.goal, 0, 1);
      rr(bx - 1, by - 1, 52, 8, 1, '#0a1215');
      if (pr > 0) { rect(bx, by, Math.round(50 * pr), 6, C.gold); rect(bx, by, Math.round(50 * pr), 2, '#ffe089'); }
      drawText(p.prog + '/' + p.goal, bx + 54, by, PAPER.pen2, 1);
      // little X to drop the quest
      rr(px + pw - 13, py + 3, 10, 10, 2, '#a83a2a');
      drawTextC('X', px + pw - 8, py + 5, '#ffd8c8', 1);
      hit(px + pw - 13, py + 3, 10, 10, { id: 'qdrop' + p.id, cursor: true, tip: 'DROP QUEST|Frees a slot (progress is lost)', cb: () => { p.on = false; p.prog = 0; saveMeta(); sfx.thunk(); } });
    }
    // push-pin: gold-ish green when accepted
    pushPin(px + pw / 2, py, p.on ? PINS[0] : PINS[(i + 1) % PINS.length], 0.5 + 0.5 * Math.sin(tNow * 3 + i * 1.7));
    hit(px, py, pw - 56, ph, { id: 'qnote' + p.id, tip: p.name + '|POSTED BY ' + npc.name + '|+' + p.rp + ' COOKIES' });
  });

}

function drawGachaShowcase() {
  overlayDim(0.78);
  hit(0, 0, W, H, { id: 'gsblock', cb: () => { } });
  const all = [];
  exchangeItems().forEach(d => all.push({ name: d.name, desc: d.desc, ico: d.ico, rar: d.tier <= 5 ? 0 : d.tier <= 10 ? 1 : 2, owned: !!meta.unlocked[d.id], kind: CHARMS.includes(d) ? 'BADGE' : TOOLS.includes(d) ? 'TOOL' : 'CARD' }));
  GLOVE_ORDER.forEach(k => { if (GLOVES[k].gacha) all.push({ name: GLOVES[k].name, desc: 'GLOVE SKIN - ' + GLOVES[k].flav, ico: 'glove', skin: GLOVES[k].skin, rar: 2, owned: !!meta.gachaOwn[k], kind: 'GLOVE' }); });
  HAT_ORDER.forEach(k => { if (HATS[k].gacha) all.push({ name: HATS[k].name, desc: 'HAT - ' + HATS[k].flav, ico: 'hat', hatKey: k, rar: 3, owned: !!meta.hatOwn[k], kind: 'HAT' }); });
  GEAR_ORDER.forEach(k => { if (GEAR[k].gacha) all.push({ name: GEAR[k].name, desc: 'GEAR - ' + GEAR[k].flav, ico: 'gear', gearKey: k, rar: GEAR[k].rar || 3, owned: !!meta.gearOwn[k], kind: 'GEAR' }); });
  Object.keys(PERKS).forEach(k => all.push({ name: PERKS[k].name, desc: PERKS[k].desc, ico: PERKS[k].ico, rar: 3, owned: !!meta.perks[k], kind: 'PERK' }));
  const owned = all.filter(a => a.owned).length;
  const px = 28, py = 12, pw = 424, ph = 246;
  panel(px, py, pw, ph, { face: '#16222af8', edge: C.gold });
  drawTextCSh('CAPSULE PRIZES', W / 2, py + 8, C.gold, 2);
  drawTextC(owned + ' / ' + all.length + ' COLLECTED', W / 2, py + 24, C.green, 1);
  // rarity legend
  RAR_NAMES.forEach((rn, i) => {
    const lx = px + 40 + i * 96;
    rect(lx, py + 36, 6, 6, RAR_COLS[i]);
    drawText(rn, lx + 10, py + 36, RAR_COLS[i], 1);
  });
  const cols = 9, cw = 44, ch = 34;
  const gx0 = px + Math.floor((pw - cols * cw) / 2), gy0 = py + 50;
  all.forEach((a, i) => {
    const x = gx0 + (i % cols) * cw, y = gy0 + Math.floor(i / cols) * ch;
    panel(x, y, cw - 6, ch - 6, { face: a.owned ? '#26321e' : '#141c22', edge: a.owned ? RAR_COLS[a.rar] : RAR_COLS[a.rar] + '66', r: 2 });
    ctx.save(); if (!a.owned) ctx.globalAlpha = 0.35;
    if (a.ico === 'glove') ICONS.glove(x + 13, y + 6, a.skin);
    else if (a.ico === 'hat') drawHatArt(x + 19, y + 16, a.hatKey, 1);
    else if (a.ico === 'gear') drawGearArt(x + 19, y + 10, a.gearKey, 1);
    else (ICONS[a.ico] || ICONS.star)(x + 13, y + 6);
    ctx.restore();
    if (a.owned) { rect(x + cw - 14, y + 3, 6, 6, C.green); drawText('+', x + cw - 13, y + 4, '#0d161b', 1); }
    drawTextC(a.name.split(' ')[0].slice(0, 7), x + (cw - 6) / 2, y + ch - 13, a.owned ? C.white : '#54707a', 1);
    hit(x, y, cw - 6, ch - 6, { id: 'gsp' + i, tip: a.name + '|' + a.kind + ' - ' + RAR_NAMES[a.rar] + '|' + a.desc + '|' + (a.owned ? 'COLLECTED' : 'STILL IN THE DOME') });
  });
  button(W / 2 - 40, py + ph - 18, 80, 14, 'CLOSE', '#d94f30', '#8a2a16', () => { G.gachaShow = false; }, { id: 'gsclose' });
}

// ----------------------------------- swamp mini-games -----------------------
// ---- polish toolkit (pixel-art shading helpers) --------------------------
function dither(x, y, w, h, cA, cB, off) {
  x |= 0; y |= 0; w |= 0; h |= 0; off = off || 0;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) rect(x + i, y + j, 1, 1, ((i + j + off) & 1) ? cB : cA);
}
function ring(cx, cy, r, col, squash) {
  squash = squash === undefined ? 0.5 : squash;
  const n = Math.max(8, r * 4);
  for (let a = 0; a < n; a++) { const an = a / n * 6.2832; rect(cx + Math.cos(an) * r, cy + Math.sin(an) * r * squash, 1, 1, col); }
}
function reflect(cx, topY, botY, w, col, amp, spd) {
  ctx.save();
  for (let yy = topY | 0; yy < botY; yy++) {
    const f = (yy - topY) / (botY - topY);
    ctx.globalAlpha = (1 - f) * 0.45;
    const dx = Math.sin(tNow * (spd || 1.3) + yy * 0.45) * (amp || 2) * (0.4 + f);
    rect(cx - (w >> 1) + dx, yy, w, 1, col);
  }
  ctx.restore();
}
function godRay(x, topY, botY, wTop, wBot, skew, col, a) {
  ctx.save(); ctx.globalAlpha = a;
  for (let yy = topY | 0; yy < botY; yy++) { const f = (yy - topY) / (botY - topY); rect(x + (f * skew | 0), yy, (wTop + (wBot - wTop) * f) | 0, 1, col); }
  ctx.restore();
}
function caustics(x, y, w, h, col, a) {
  ctx.save(); ctx.globalAlpha = a;
  for (let j = 0; j < h; j += 3) for (let i = 0; i < w; i += 4) { if (Math.sin((i + tNow * 22) * 0.32 + (j - tNow * 13) * 0.4) > 0.55) rect(x + i, y + j, 2, 1, col); }
  ctx.restore();
}
function heatHaze(x, y, w, h, col) {
  ctx.save(); ctx.globalAlpha = 0.045;
  for (let yy = 0; yy < h; yy++) rect(x + Math.sin(tNow * 6 + yy * 0.6) * 1.5, y + yy, w, 1, col);
  ctx.restore();
}
function smoke(cx, cy, n, seed, col, rise, spread) {
  rise = rise || 34; spread = spread || 6;
  ctx.save();
  for (let i = 0; i < n; i++) { const ph = (tNow * 0.5 + i / n + seed) % 1; ctx.globalAlpha = (1 - ph) * 0.32; fillCircle(cx + Math.sin(ph * 6 + i) * spread, cy - ph * rise, 1 + ph * 3, col); }
  ctx.restore();
}
function sparkle(x, y, col, period, phase) {
  const s = Math.sin(tNow * (period || 6) + (phase || 0));
  if (s > 0.6) { rect(x, y, 1, 1, col); if (s > 0.9) { rect(x - 1, y, 1, 1, col); rect(x + 1, y, 1, 1, col); rect(x, y - 1, 1, 1, col); rect(x, y + 1, 1, 1, col); } }
}
// shared stage: 40..440 x 26..190; controls drawn under it. each game is
// {init(s), update(s,dt), tap(s), draw(s), idle(s)} over G.event.s
const STAGE = { x: 40, y: 26, w: 400, h: 164 };
const NIGHT = ['#050a16', '#08101e', '#0b1626', '#0e1c2e', '#122436', '#172c3e', '#1e3646'];
// ---- the moonlit swamp: painted once per water tint, then cached ----------
function stageNightStatic(water) {
  const w = STAGE.w, h = STAGE.h, hz = Math.round(h * 0.62);
  // sky: dithered night bands, a faint milky way, a speckle of stars
  for (let y = 0; y < hz; y++) {
    const f = (y / hz) * (NIGHT.length - 1), i = Math.floor(f), fr = f - i;
    rect(0, y, w, 1, NIGHT[i]);
    if (i + 1 < NIGHT.length && fr > 0.5) for (let x = (y & 1); x < w; x += 2) rect(x, y, 1, 1, NIGHT[i + 1]);
  }
  for (let k = 0; k < 900; k++) {
    const t = hash2(k, 11), px = Math.floor(t * w), py = Math.floor(hash2(k, 12) * hz * 0.7);
    const band = Math.abs(py - (hz * 0.55 - px * 0.18)) < 16;
    if (band && hash2(k, 13) < 0.5) rect(px, py, 1, 1, '#1e2a44');
  }
  for (let k = 0; k < 120; k++) { const px = Math.floor(hash2(k, 21) * w), py = Math.floor(hash2(k, 22) * hz * 0.75), b = hash2(k, 23); rect(px, py, 1, 1, b > 0.9 ? '#ffffff' : b > 0.6 ? '#b8c8e0' : '#6a7a98'); if (b > 0.96) { rect(px - 1, py, 3, 1, '#8a9ab8'); rect(px, py - 1, 1, 3, '#8a9ab8'); } }
  // the moon, with craters and a dithered halo (games reflect it at x+w-44)
  const mx0 = w - 44, my0 = 26;
  for (let r = 24; r > 14; r -= 2) for (let a = 0; a < 60; a++) { const an = a / 60 * Math.PI * 2; if (hash2(a, r) < 0.4 - (r - 14) / 30) rect(mx0 + Math.cos(an) * r, my0 + Math.sin(an) * r, 1, 1, '#3a4a66'); }
  fillCircle(mx0, my0, 13, '#c8ccb8'); fillCircle(mx0 - 1, my0 - 1, 12, '#e8e8d4'); fillCircle(mx0 - 3, my0 - 3, 6, '#f8f8e8');
  [[4, 3, 2], [-5, 4, 2], [2, -5, 1], [-2, 7, 1], [7, -2, 1]].forEach(([dx, dy, r]) => { fillCircle(mx0 + dx, my0 + dy, r, '#c0c4ae'); rect(mx0 + dx - r, my0 + dy - r, 1, 1, '#f8f8e8'); });
  // wispy clouds across the moon
  [[w - 110, 20, 60], [w - 70, 36, 44], [40, 30, 70], [150, 16, 50]].forEach(([cx, cy, cw]) => { rect(cx, cy, cw, 1, '#26344a'); rect(cx + 6, cy + 1, cw - 14, 1, '#1e2a3e'); rect(cx + 10, cy - 1, cw - 26, 1, '#34445e'); });
  // far treeline, bluish and hazy
  for (let x = 0; x < w; x++) { const th = 10 + Math.floor(vnoise(x, 0, 14, 5) * 12) + (hash2(x >> 3, 4) > 0.8 ? 6 : 0); rect(x, hz - th, 1, th, '#12202e'); }
  ctx.save(); ctx.globalAlpha = 0.4; for (let y = hz - 10; y < hz; y++) for (let x = (y & 1); x < w; x += 2) rect(x, y, 1, 1, '#2a3a4e'); ctx.restore();
  // near cypress with moss curtains
  [[20, 1.1], [70, 0.8], [128, 0.95], [196, 0.7], [262, 1.0], [318, 0.75]].forEach(([tx, ts], n) => {
    const top = Math.round(hz - 62 * ts), tw = Math.max(2, Math.round(3 * ts));
    rect(tx - tw, top + 8, tw * 2, hz - top - 6, '#060c12');
    for (let k = 0; k < 5; k++) rect(tx - tw - k, hz - 5 + k, tw * 2 + k * 2, 1, '#060c12');
    for (let c = 0; c < 3; c++) {
      const cw = Math.round((10 + c * 6) * ts), cy = top + c * Math.round(9 * ts);
      rect(tx - cw, cy, cw * 2, 3, '#08101a'); rect(tx - cw + 2, cy - 1, cw * 2 - 4, 1, '#08101a');
      rect(tx - cw + 1, cy, cw - 2, 1, '#1a2a3a');                                            // moonlit edge
      for (let m = 0; m < cw * 2; m += 2) { const ml = 2 + Math.floor(hash2(m + n * 30, c) * 10 * ts); for (let j = 0; j < ml; j++) if (hash2(m, j + c) > 0.2) rect(tx - cw + m, cy + 3 + j, 1, 1, j > ml - 3 ? '#2a3a44' : '#18242e'); }
    }
  });
  // water: the given tint, deepening toward the viewer, with tree reflections
  for (let y = hz; y < h; y++) {
    const f = (y - hz) / (h - hz);
    rect(0, y, w, 1, mixC(water, '#02060a', f * 0.5));
    if (f < 0.5 && f > 0.1) for (let x = (y & 1); x < w; x += 2) if (hash2(x, y) < 0.3) rect(x, y, 1, 1, mixC(water, '#2a4a5a', 0.3));
  }
  ctx.save(); ctx.globalAlpha = 0.5;
  for (let x = 0; x < w; x++) { const th = 3 + Math.floor(vnoise(x, 0, 14, 5) * 5); rect(x, hz, 1, th, '#08121a'); }
  ctx.restore();
  // lily pads on the far water and cattails at the right edge
  for (let k = 0; k < 10; k++) { const lx = 130 + Math.floor(hash2(k, 41) * 240), ly = hz + 3 + Math.floor(hash2(k, 42) * 10); rr(lx, ly, 6 + (k % 3), 2, 1, '#14301e'); rect(lx + 1, ly, 3, 1, '#22482c'); }
  for (let k = 0; k < 14; k++) { const cx = w - 22 + Math.floor(hash2(k, 51) * 22), ch = 14 + Math.floor(hash2(k, 52) * 26); rect(cx, h - ch, 1, ch, '#081410'); if (k % 3 === 0) rr(cx - 1, h - ch - 6, 3, 7, 1, '#2a1a10'); }
  for (let k = 0; k < 8; k++) { const cx = Math.floor(hash2(k, 61) * 14), ch = 8 + Math.floor(hash2(k, 62) * 14); rect(cx, h - ch, 1, ch, '#081410'); }
}
function stageNight(water) {
  const { x, y, w, h } = STAGE;
  water = water || '#0a2028';
  paintCached('stageN' + water, x, y, w, h, () => stageNightStatic(water));
  // stars twinkle, fireflies drift, mist slides across the water line
  for (let i = 0; i < 16; i++) {
    const sx = x + Math.floor(hash2(i, 21) * w), sy = y + Math.floor(hash2(i, 22) * h * 0.46);
    const tw = Math.sin(tNow * 1.7 + i * 2.3);
    if (tw > 0.5) { ctx.save(); ctx.globalAlpha = (tw - 0.5) * 2; rect(sx, sy, 1, 1, '#ffffff'); ctx.restore(); }
  }
  const wy = y + Math.round(h * 0.62);
  ctx.save(); ctx.globalAlpha = 0.07;
  for (let k = 0; k < 4; k++) { const mx2 = x + ((tNow * (5 + k * 2) + k * 110) % (w + 120)) - 60; rr(mx2, wy - 8 + k * 3, 70, 5, 2, '#cfe8f0'); }
  ctx.restore();
  for (let k = 0; k < 4; k++) {
    const yy = wy + 5 + k * 12, off = Math.sin(tNow * 0.8 + k * 2.2) * 8;
    ctx.save(); ctx.globalAlpha = 0.3;
    for (let d = 0; d < 5; d++) rect(x + ((d * 90 + off + k * 31 + w * 4) % w), yy, 11, 1, '#2e5a62');
    ctx.restore();
  }
  for (let i = 0; i < 5; i++) {
    const on = Math.sin(tNow * 2.4 + i * 1.9);
    if (on > 0.2) { const fx = x + 30 + ((hash2(i, 71) * 340 + Math.sin(tNow * 0.5 + i) * 14)), fy = wy - 30 + Math.sin(tNow * 0.9 + i * 2) * 10 - hash2(i, 72) * 30; ctx.save(); ctx.globalAlpha = on * 0.35; rect(fx - 1, fy - 1, 3, 3, '#e8f080'); ctx.globalAlpha = on; rect(fx, fy, 1, 1, '#fffcc0'); ctx.restore(); }
  }
  return wy;
}
// ---- the camp clearing: pines, a tent, a canoe, string lights ------------
function stageCampStatic() {
  const w = STAGE.w, h = STAGE.h, gy = h - 48;
  for (let y = 0; y < gy; y++) {
    const f = (y / gy) * (NIGHT.length - 2), i = Math.floor(f), fr = f - i;
    rect(0, y, w, 1, NIGHT[i]);
    if (fr > 0.5) for (let x = (y & 1); x < w; x += 2) rect(x, y, 1, 1, NIGHT[i + 1]);
  }
  for (let k = 0; k < 110; k++) { const px = Math.floor(hash2(k, 81) * w), py = Math.floor(hash2(k, 82) * gy * 0.6), b = hash2(k, 83); rect(px, py, 1, 1, b > 0.85 ? '#ffffff' : '#7a8aa8'); }
  fillCircle(60, 24, 9, '#d8dcc8'); fillCircle(58, 22, 8, '#eeeee0'); fillCircle(63, 24, 7, NIGHT[1]);    // crescent
  // rolling hills far back
  for (let x = 0; x < w; x++) { const hh = 18 + Math.round(Math.sin(x / 50) * 6 + vnoise(x, 3, 20, 9) * 8); rect(x, gy - 24 - hh, 1, hh + 24, '#0e1a26'); }
  // three depths of pines, fogged between
  [[0.6, '#0e1c24', 44, 26], [0.8, '#0a1620', 58, 18], [1.0, '#060e14', 70, 22]].forEach(([sc, col, base, step], layer) => {
    for (let px = -10 + layer * 7; px < w + 10; px += step + Math.floor(hash2(px, layer) * 10)) {
      const ph = Math.round((base + hash2(px, layer + 9) * 20) * sc), top = gy - ph;
      for (let r = 0; r < ph; r++) { const ww = Math.round((r / ph) * 11 * sc) + 1 + ((r % 6) < 2 ? 1 : 0); rect(px - ww, top + r, ww * 2 + 1, 1, col); }
      if (layer === 2) for (let r = 4; r < ph; r += 6) rect(px - Math.round((r / ph) * 11), top + r, 3, 1, '#16283a');      // moonlit tips
      rect(px - 1, gy - 4, 3, 4, '#1a1208');
    }
    ctx.save(); ctx.globalAlpha = 0.18; rect(0, gy - 30 + layer * 8, w, 14, '#2a3a4e'); ctx.restore();
  });
  // ground: dark grass with a trodden dirt patch around the fire
  rect(0, gy, w, h - gy, '#1a2414');
  for (let y = gy; y < h; y++) for (let x = (y & 1); x < w; x += 2) { const q = hash2(x, y); if (q < 0.12) rect(x, y, 1, 1, '#24321a'); else if (q > 0.95) rect(x, y, 1, 1, '#0e160a'); }
  for (let y = gy + 6; y < h; y++) { const hw = Math.round(90 * Math.sqrt(1 - Math.pow((y - gy - 26) / 26, 2) || 0)); if (hw > 0) for (let x = 200 - hw; x < 200 + hw + 60; x++) if (hash2(x, y) < 0.7) rect(x, y, 1, 1, hash2(y, x) < 0.2 ? '#3a2e1c' : '#2e2616'); }
  for (let k = 0; k < 60; k++) { const gx = Math.floor(hash2(k, 91) * w), gy2 = gy + Math.floor(hash2(k, 92) * 44); rect(gx, gy2 - 2, 1, 3, '#2e4420'); rect(gx + 1, gy2 - 1, 1, 2, '#24361a'); }
  for (let k = 0; k < 20; k++) { const sx = Math.floor(hash2(k, 93) * w), sy = gy + 8 + Math.floor(hash2(k, 94) * 38); rr(sx, sy, 3, 2, 1, '#3a3a36'); rect(sx, sy, 2, 1, '#5a5a52'); }
  // the tent, a glowing lantern inside
  const tx = 30, ty = gy - 2;
  for (let r = 0; r < 34; r++) { const hw = Math.round(r * 0.9); rect(tx + 34 - hw, ty - 34 + r, hw * 2, 1, r < 3 ? '#8a6a3a' : '#5a4a2a'); rect(tx + 34 - hw, ty - 34 + r, 1, 1, '#2a1e10'); rect(tx + 33 + hw, ty - 34 + r, 1, 1, '#2a1e10'); }
  for (let r = 10; r < 34; r++) { const hw = Math.round((r - 10) * 0.45); rect(tx + 34 - hw, ty - 34 + r, hw * 2, 1, r < 14 ? '#c89a4a' : '#e8b858'); }
  rect(tx + 33, ty - 36, 2, 36, '#2a1e10');
  pxLine(tx + 2, ty, tx - 6, ty + 4, '#8a7a5a'); pxLine(tx + 66, ty, tx + 74, ty + 4, '#8a7a5a');
  // a canoe leaning against the last tree, paddle beside it
  for (let k = 0; k < 48; k++) { const cx = 356 + k * 0.5, cy = gy - 44 + k; rect(cx, cy, 6 - Math.abs(k - 24) / 8, 1, k % 6 ? '#8a3a2a' : '#c85a3a'); }
  pxLine(372, gy - 40, 380, gy + 4, '#6a4a2a', 2); rr(378, gy - 2, 5, 8, 2, '#6a4a2a');
  // a stacked woodpile and a stump
  for (let r = 0; r < 3; r++) for (let k = 0; k < 4 - r; k++) { const lx = 312 + k * 7 + r * 3, ly = gy + 4 - r * 5; fillCircle(lx, ly, 3, '#4a3018'); fillCircle(lx, ly, 2, '#8a6a3a'); rect(lx, ly, 1, 1, '#5a3a1a'); }
  rr(96, gy + 16, 16, 8, 2, '#3a2412'); rr(97, gy + 16, 14, 3, 1, '#8a6a3a'); ringPx(104, gy + 17, 3, '#5a3a1a', 0, Math.PI);
  // camp sign
  rect(118, gy - 22, 2, 24, '#3a2410'); rr(108, gy - 26, 26, 10, 1, '#1a0e06'); rr(109, gy - 25, 24, 8, 1, '#8a6a3a'); drawTextC('CAMP 7', 121, gy - 23, '#2a1808', 1);
}
function stageCamp() {
  const { x, y, w, h } = STAGE;
  paintCached('stageCamp', x, y, w, h, stageCampStatic);
  const gy = y + h - 48;
  // string lights swag between the pines
  for (let k = 0; k < 2; k++) {
    const a = x + 20 + k * 180, b = a + 170;
    for (let px = a; px < b; px++) { const f = (px - a) / (b - a), sag = Math.round(Math.sin(f * Math.PI) * 10); rect(px, y + 44 + sag, 1, 1, '#2a2a2a'); }
    for (let i = 1; i < 10; i++) { const f = i / 10, px = a + f * (b - a), sag = Math.round(Math.sin(f * Math.PI) * 10), on = Math.sin(tNow * 3 + i + k * 5) > -0.3; ctx.save(); ctx.globalAlpha = on ? 0.3 : 0.1; fillCircle(px, y + 47 + sag, 3, ['#ffd860', '#ff8a6a', '#8ae8ff', '#a8f080'][i % 4]); ctx.restore(); rect(px, y + 46 + sag, 1, 2, ['#ffd860', '#ff8a6a', '#8ae8ff', '#a8f080'][i % 4]); }
  }
  // the tent lantern breathes
  ctx.save(); ctx.globalAlpha = 0.12 + Math.sin(tNow * 5) * 0.03; fillCircle(x + 64, gy - 12, 18, '#ffc860'); ctx.restore();
  for (let i = 0; i < 6; i++) { const on = Math.sin(tNow * 2 + i * 1.7); if (on > 0.3) { const fx = x + 20 + hash2(i, 5) * 360 + Math.sin(tNow * 0.6 + i) * 10, fy = gy - 20 - hash2(i, 6) * 50; ctx.save(); ctx.globalAlpha = on; rect(fx, fy, 1, 1, '#fffcc0'); ctx.globalAlpha = on * 0.3; rect(fx - 1, fy - 1, 3, 3, '#e8f080'); ctx.restore(); } }
  return gy;
}
function drawCampfire(cx, cy, heat) {
  // heat 0..1 scales the flame
  rect(cx - 14, cy - 2, 28, 4, '#3a2818');
  rect(cx - 10, cy - 5, 20, 4, '#4a3320');
  const fl = (tNow * 11 | 0) % 3;
  const fh = 8 + Math.round(heat * 22);
  ctx.save();
  ctx.globalAlpha = 0.14 + heat * 0.1; fillCircle(cx, cy - 8, 20 + heat * 16, '#ff9838');
  ctx.restore();
  rect(cx - 5, cy - fh - fl, 10, fh + fl, '#d94f30');
  rect(cx - 3, cy - fh * 0.7 - fl, 6, fh * 0.7 + fl, '#ff9838');
  rect(cx - 1, cy - fh * 0.4, 3, fh * 0.4, '#ffe089');
  if ((tNow * 6 | 0) % 2) rect(cx + 3 - fl, cy - fh - 3, 2, 2, '#ff9838'); // spark
}
function drawRangerSitting(x, y) {
  // little seated ranger, back view-ish
  drawBobble(x + 9, y + 24, G.ranger, { sc: 0.8, expr: 'happy', act: 'idle', ...myFit() });
}
const GAMES = {
  // ------------------------------------------------ 1. fishing -------------
  fish: {
    init(s) { Object.assign(s, { casts: 5, caught: 0, ph: 'wait', t: 0, wait: 1 + rnd() * 1.8, msg: '', msgT: 0, fx: null }); },
    update(s, dt) {
      s.t += dt; s.msgT -= dt;
      if (s.ph === 'wait' && s.t >= s.wait) { s.ph = 'bite'; s.t = 0; sfx.drop(); addRipple(300, this.wy + 14, false); }
      if (s.ph === 'bite' && s.t > 0.55) { s.ph = 'wait'; s.t = 0; s.wait = 1 + rnd() * 1.8; s.casts--; s.msg = 'IT GOT AWAY...'; s.msgT = 1.2; if (s.casts <= 0) this.done(s); }
      if (s.fx) { s.fx.t += dt; if (s.fx.t > 0.8) s.fx = null; }
    },
    tap(s) {
      if (s.ph === 'bite') {
        s.caught++; s.casts--; s.ph = 'wait'; s.t = 0; s.wait = 1.1 + rnd() * 1.8;
        s.fx = { t: 0 }; s.msg = 'CAUGHT ONE!'; s.msgT = 1.2;
        sfx.coin(); burst(300, this.wy + 10, '#7fb8c8', 10, 70);
      } else if (s.ph === 'wait' && s.t > 0.25) {
        s.casts--; s.ph = 'wait'; s.t = 0; s.wait = 1 + rnd() * 1.8;
        s.msg = 'TOO SOON - SCARED IT OFF'; s.msgT = 1.2;
        sfx.error(); addRipple(300, this.wy + 14, true);
      }
      if (s.casts <= 0) this.done(s);
    },
    done(s) {
      const ck = s.caught >= 5 ? 5 : s.caught >= 3 ? 2 : 0;
      finishGame(s.caught + '/5 FISH', s.caught * 2, ck, ['FISH SOLD: +$' + (s.caught * 2)]);
    },
    draw(s) {
      const wy = this.wy = stageNight('#0a2830');
      // depth: moonbeam shaft, wobbling moon reflection, fish gliding below
      godRay(300, STAGE.y, wy, 4, 34, -46, '#cfe8f0', 0.05);
      reflect(396, wy, 190, 3, '#e8e8d0', 2, 1.3);
      ctx.save(); ctx.globalAlpha = 0.16;
      for (let i = 0; i < 3; i++) {
        const fx = STAGE.x + ((tNow * (13 + i * 7) + i * 150) % (STAGE.w + 40)) - 20;
        const fy = wy + 20 + i * 12 + Math.sin(tNow * 1.4 + i) * 3;
        rr(fx, fy, 11, 4, 2, '#06232b'); rect(fx - 4, fy + 1, 5, 2, '#06232b');
      }
      ctx.restore();
      // rim-lit dock planks + posts
      rect(34, 123, 72, 1, '#8a6a3a'); rect(34, 124, 72, 4, '#5f4228'); rect(34, 128, 72, 2, '#3a2818');
      for (let k = 0; k < 4; k++) rect(34 + k * 18, 124, 1, 4, '#3a2818');
      rect(40, wy + 2, 4, 14, '#3a2818'); rect(43, wy + 2, 1, 14, '#241708'); rect(96, wy + 2, 4, 14, '#3a2818');
      drawRangerSitting(64, wy - 26);
      // hanging lantern (warm key light) + water glimmer
      const lx = 100, ly = wy - 22, flick = 0.85 + Math.sin(tNow * 11) * 0.1 + Math.sin(tNow * 27) * 0.05;
      ctx.save(); ctx.globalAlpha = 0.13 * flick; fillCircle(lx + 2, ly + 5, 24, '#ffc843'); ctx.restore();
      rect(lx + 1, wy - 26, 1, 4, '#241708');
      rr(lx, ly, 6, 10, 2, '#2a343c'); rect(lx, ly, 6, 1, '#5a646c');
      rect(lx + 1, ly + 2, 4, 6, ((tNow * 9 | 0) % 5) ? '#ffc843' : '#fff6c8'); rect(lx + 1, ly + 2, 1, 6, '#fff6c8');
      reflect(lx + 3, wy, 176, 3, '#ffc843', 3, 2.1);
      const rodX = 88, rodY = wy - 30;
      for (let i = 0; i < 14; i++) rect(rodX + i * 2, rodY - i, 2, 2, '#8a6a3a');
      const dip = s && s.ph === 'bite' ? 6 : 0;
      const bobY = wy + 8 + dip + Math.round(Math.sin(tNow * 2.2) * 1.5);
      const tipX = rodX + 28, tipY = rodY - 13;
      ctx.save(); ctx.globalAlpha = 0.4;
      for (let i = 0; i <= 20; i++) {
        const f = i / 20;
        const lx2 = lerp(tipX, 300, f), lyy = lerp(tipY, bobY - 3, f) + Math.sin(f * Math.PI) * 12;
        rect(lx2, lyy, 1, 1, '#cfe8f0');
      }
      ctx.restore();
      // expanding moonlit rings + rim-lit bobber
      if (s) for (let k = 0; k < 2; k++) { const r2 = (tNow * 11 + k * 13) % 24; ctx.save(); ctx.globalAlpha = Math.max(0, 0.42 - r2 / 58); ring(300, bobY + 3, r2, '#7fb8c8'); ctx.restore(); }
      fillCircle(300, bobY - 2, 4, '#7a2410'); fillCircle(300, bobY - 2, 3, '#d94f30'); rect(299, bobY - 4, 1, 1, '#ffb0a0'); rect(298, bobY - 6, 3, 3, '#f4f2e4');
      if (s && s.ph === 'bite') { ctx.save(); ctx.globalAlpha = 0.2 + 0.15 * Math.sin(tNow * 18); fillCircle(300, bobY - 20, 8, '#ffe089'); ctx.restore(); drawTextCSh('!', 300, bobY - 22, C.gold, 2); addRippleThrottle(s, 300, bobY + 4); }
      if (s && s.fx) {
        const f = s.fx.t / 0.8;
        const fx2 = 300 - f * 190, fy = bobY - Math.sin(f * Math.PI) * 60;
        rr(fx2, fy, 14, 6, 3, '#2f5561'); rr(fx2, fy, 13, 5, 2, '#5c8a9a'); rect(fx2 + 1, fy, 10, 1, '#7fb8c8'); rect(fx2 - 4, fy + 1, 5, 4, '#48707e'); rect(fx2 + 10, fy + 2, 3, 2, '#10181e');
      }
      // rim-lit bucket
      rr(38, wy - 14, 16, 12, 2, '#22262c'); rr(38, wy - 14, 16, 11, 2, '#3a444c'); rect(40, wy - 13, 12, 1, '#5a646c'); rect(38, wy - 2, 16, 2, '#2a343c');
      if (s) for (let i = 0; i < s.caught; i++) { rect(40 + (i % 3) * 4, wy - 12 + ((i / 3) | 0) * 4, 3, 2, '#5c8a9a'); rect(40 + (i % 3) * 4, wy - 12 + ((i / 3) | 0) * 4, 1, 1, '#7fb8c8'); }
      // foreground cattails framing the corners
      [38, 434].forEach(cx => { rect(cx, 168, 2, 22, '#132d1e'); rr(cx - 1, 163, 4, 7, 1, '#4a3320'); rect(cx - 1, 163, 1, 4, '#6a4a2a'); });
    },
    hud: s => 'CASTS LEFT: ' + s.casts + '   CAUGHT: ' + s.caught,
  },
  // ------------------------------------------- 2. gator feeding ------------
  feed: {
    init(s) { Object.assign(s, { throws: 6, fed: 0, gx: 220, gdir: 1, chick: null, msg: '', msgT: 0, chomp: 0 }); },
    update(s, dt) {
      s.msgT -= dt; s.chomp = Math.max(0, s.chomp - dt * 3);
      s.gx += s.gdir * 58 * dt;
      if (s.gx > 396) { s.gx = 396; s.gdir = -1; }
      if (s.gx < 150) { s.gx = 150; s.gdir = 1; }
      if (s.chick) {
        s.chick.t += dt;
        if (s.chick.t >= 0.75) {
          const hit2 = Math.abs(s.gx - 300) < 26;
          if (hit2) { s.fed++; s.chomp = 1; sfx.click(4); burst(300, this.wy + 6, '#ffe089', 10, 70); s.msg = 'CHOMP!'; }
          else { sfx.splash(); addRipple(300, this.wy + 10, true); s.msg = 'SPLASH... HE MISSED IT'; }
          s.msgT = 1.1; s.chick = null; s.throws--;
          if (s.throws <= 0) this.done(s);
        }
      }
    },
    tap(s) { if (!s.chick && s.throws > 0) { s.chick = { t: 0 }; sfx.pickup(); } },
    done(s) {
      const ck = s.fed >= 6 ? 5 : s.fed >= 4 ? 2 : 0;
      finishGame(s.fed + '/6 FED', s.fed * 2, ck, ['A GRATEFUL GATOR: +$' + (s.fed * 2)]);
    },
    draw(s) {
      const wy = this.wy = stageNight('#0e2a24');
      reflect(396, wy, 190, 3, '#e8e8d0', 2, 1.3);
      // fireflies drifting over the far reeds
      for (let i = 0; i < 4; i++) { ctx.save(); ctx.globalAlpha = 0.3 + 0.3 * Math.sin(tNow * 4 + i); fillCircle(STAGE.x + 40 + ((tNow * 8 + i * 90) % 320), STAGE.y + 90 + Math.sin(tNow * 2 + i) * 6, 1, '#c8ff9a'); ctx.restore(); }
      // rim-lit feeding platform + ranger with bucket
      rect(52, wy - 5, 50, 1, '#8a6a3a'); rect(52, wy - 4, 50, 5, '#5f4228'); rect(52, wy + 1, 50, 1, '#3a2818');
      rect(56, wy + 2, 4, 14, '#3a2818'); rect(92, wy + 2, 4, 14, '#3a2818');
      drawRangerSitting(60, wy - 26);
      rr(92, wy - 16, 14, 12, 2, '#5f3222'); rr(92, wy - 16, 14, 11, 2, '#8a5038'); rect(94, wy - 15, 10, 1, '#a86a48'); if (s) for (let i = 0; i < Math.min(6, s.throws); i++) rect(94 + (i % 3) * 4, wy - 14 + ((i / 3) | 0) * 5, 3, 3, '#f4e2c8');
      rect(296, wy + 2, 9, 2, '#ffc843'); rect(299, wy - 1, 3, 8, '#ffc843');
      drawTextC('X', 300, wy - 12, '#ffc84388', 1);
      if (s) {
        // swimming wake trailing the gator (direction-aware V)
        ctx.save(); ctx.globalAlpha = 0.22;
        for (let k = 1; k < 5; k++) { const o = k * 6, bx = s.gx - s.gdir * (30 + o); rect(bx, wy + 2 + o, 6, 1, '#1e4a52'); rect(bx, wy + 2 - o, 6, 1, '#1e4a52'); }
        ctx.restore();
        // the cruising gator head (rim-lit, scutes, warm eye)
        const gy = wy - 2 + Math.round(Math.sin(tNow * 1.8) * 2);
        const open = 6 + Math.round(Math.sin(tNow * 6) * 2) - Math.round(s.chomp * 6);
        ctx.save();
        if (s.gdir < 0) { ctx.translate(s.gx * 2, 0); ctx.scale(-1, 1); }
        const hx2 = s.gx - 34;
        rr(hx2, gy - 11, 56, 13, 4, '#153d12'); rr(hx2, gy - 10, 56, 12, 4, '#3c7c2e'); // outline + snout
        rect(hx2 + 4, gy - 10, 48, 1, '#5aa843'); // dorsal light
        for (let k = 0; k < 5; k++) { rect(hx2 + 8 + k * 9, gy - 12, 3, 2, '#2f6626'); rect(hx2 + 8 + k * 9, gy - 12, 3, 1, '#5aa843'); } // scutes
        rr(hx2 + 44, gy - 16, 14, 10, 3, '#3c7c2e'); rect(hx2 + 46, gy - 15, 8, 1, '#8cd34f'); // brow + highlight
        rect(hx2 + 48, gy - 14, 4, 4, '#ffe089'); rect(hx2 + 48, gy - 14, 1, 1, '#fff6c8'); rect(hx2 + 49, gy - 13, 2, 2, '#1b1408'); // eye
        for (let k = 0; k < 5; k++) rect(hx2 + 6 + k * 9, gy + 1, 3, 3, '#f4f0dc'); // teeth
        rr(hx2 + 2, gy + open, 50, 8, 3, '#2f6626'); rect(hx2 + 2, gy + open + 6, 50, 1, '#153d12'); // lower jaw + belly shadow
        dither(hx2 + 6, gy + open, 44, 3, '#4a1420', '#320b14'); rect(hx2 + 16, gy + open + 1, 20, 2, '#c94f63'); // wet throat + tongue
        ctx.restore();
        if (s.chick) {
          const f = s.chick.t / 0.75;
          const cx2 = lerp(100, 300, f), cy2 = (wy - 14) - Math.sin(f * Math.PI) * 54;
          ctx.save(); ctx.translate(cx2 + 2, cy2 + 2); ctx.rotate(f * 7);
          rect(-2, -2, 5, 4, '#7a4526'); rect(-2, -2, 5, 1, '#a85838'); rect(2, -4, 3, 3, '#f8f0d8'); ctx.restore();
        }
        if (s.chomp > 0.4) { drawTextCSh('CHOMP!', 300, wy - 34, C.gold, 2); ctx.save(); ctx.globalAlpha = clamp(s.chomp, 0, 1) * 0.5; ring(300, wy + 8, (1 - s.chomp) * 22, '#cfe8f0'); ctx.restore(); }
      }
    },
    hud: s => 'THROWS LEFT: ' + s.throws + '   FED: ' + s.fed,
  },
  // ---------------------------------------------- 3. camp cooking ----------
  cook: {
    init(s) { Object.assign(s, { timer: 10, heat: 0.55, inZone: 0, wob: 0 }); },
    update(s, dt) {
      s.timer -= dt;
      s.wob += dt;
      s.heat -= (0.24 + Math.sin(s.wob * 1.7) * 0.06) * dt;
      s.heat = clamp(s.heat, 0, 1);
      if (s.heat >= 0.45 && s.heat <= 0.75) s.inZone += dt;
      if (s.timer <= 0) this.done(s);
    },
    tap(s) { s.heat = clamp(s.heat + 0.14, 0, 1); sfx.thunk(); },
    done(s) {
      const pct = s.inZone / 10;
      const [grade, pay, ck] = pct >= 0.8 ? ['PERFECT GUMBO!', 8, 3] : pct >= 0.55 ? ['GOOD GUMBO', 6, 1] : pct >= 0.3 ? ['EDIBLE GUMBO', 4, 0] : ['BURNT MUSH', 2, 0];
      finishGame(grade, pay, ck, ['SIMMER TIME: ' + Math.round(pct * 100) + '%', 'SOLD TO HUNGRY RANGERS: +$' + pay]);
    },
    draw(s) {
      const gy = stageCamp();
      const cx2 = 240, heat = s ? s.heat : 0.5;
      // warm fire glow pool on the ground
      ctx.save(); ctx.globalAlpha = 0.10 + heat * 0.12; fillCircle(cx2, gy + 20, 40 + heat * 18, '#ff9838'); ctx.restore();
      drawRangerSitting(150, gy - 12);
      drawCampfire(cx2, gy + 24, heat);
      // ember sparks rising from the fire
      ctx.save();
      for (let i = 0; i < 5; i++) { const ph = (tNow * 0.8 + i * 0.37) % 1; ctx.globalAlpha = (1 - ph) * 0.9; rect(cx2 + Math.sin(ph * 9 + i) * 10, gy + 18 - ph * 26, 1, 1, ph < .5 ? '#ffe089' : '#ff9838'); }
      ctx.restore();
      // tripod + rim-lit pot
      rect(cx2 - 22, gy - 18, 2, 40, '#2a1a10'); rect(cx2 + 20, gy - 18, 2, 40, '#2a1a10'); rect(cx2 - 22, gy - 19, 44, 2, '#2a1a10');
      rect(cx2 - 1, gy - 17, 2, 8, '#3a444c');
      rr(cx2 - 16, gy - 10, 32, 18, 4, '#22262c'); rr(cx2 - 15, gy - 9, 30, 16, 4, '#3a444c');
      dither(cx2 - 15, gy - 8, 12, 13, '#3a444c', '#5a646c'); rect(cx2 - 3, gy - 8, 12, 13, '#2a343c'); rect(cx2 - 14, gy - 9, 28, 1, '#8a98a0'); // lit/shadow seam + belly rim
      rect(cx2 - 12, gy - 8, 24, 3, '#5a8a3a'); rect(cx2 - 12, gy - 8, 24, 1, '#8ac85a'); // gumbo surface + light
      rect(cx2 + 10, gy - 24, 2, 16, '#8a6a3a'); rr(cx2 + 8, gy - 26, 5, 3, 1, '#5a646c'); // ladle
      heatHaze(cx2 - 14, gy - 20, 30, 10, '#ffd0a0');
      smoke(cx2, gy - 8, 4, 0.0, heat > 0.85 ? '#555' : '#c8d0c0', 30, 5);
      if (s && s.heat >= 0.45 && s.heat <= 0.75) { for (let k = 0; k < 3; k++) sparkle(cx2 - 8 + k * 8, gy - 11, '#e8ffd0', 5, k * 2); }
      // heat gauge
      if (s) {
        const gx2 = 386, gy2 = STAGE.y + 24, gh2 = 110;
        panel(gx2 - 6, gy2 - 8, 30, gh2 + 24, { face: '#10181ee8' });
        rect(gx2, gy2, 8, gh2, '#0a1215');
        rect(gx2, gy2 + gh2 * 0.25, 8, gh2 * 0.3, '#2c7d3a'); // green zone (heat .45-.75 inverted)
        const ny = gy2 + (1 - s.heat) * gh2;
        rect(gx2 - 3, ny - 1, 14, 3, '#f4f0dc');
        drawTextC('HOT', gx2 + 4, gy2 - 6, C.red, 1);
        drawTextC('LOW', gx2 + 4, gy2 + gh2 + 3, '#7fb8c8', 1);
      }
    },
    hud: s => 'TIME: ' + Math.max(0, s.timer).toFixed(1) + 's   IN THE GREEN: ' + Math.round(s.inZone * 10) / 10 + 's',
  },
  // ------------------------------------------ 4. marshmallow roast ---------
  mallow: {
    init(s) { Object.assign(s, { round: 1, toast: 0, results: [], msg: '', msgT: 0, fire: false }); },
    update(s, dt) {
      s.msgT -= dt;
      s.toast += dt * (0.145 + s.round * 0.015);
      if (s.toast > 0.92) s.fire = true;
      if (s.toast >= 1.06) { this.grade(s, true); }
    },
    tap(s) { if (s.msgT <= 0.6) this.grade(s, false); },
    grade(s, burnt) {
      const t = s.toast;
      const [msg, pay] = burnt || t > 0.92 ? ['ASH.', 0] : t >= 0.6 && t <= 0.8 ? ['PEAK GOLD! +$6', 6] : t >= 0.45 ? ['CRISPY +$3', 3] : t >= 0.25 ? ['PALE +$2', 2] : ['RAW +$1', 1];
      s.results.push(pay);
      s.msg = msg; s.msgT = 1.1;
      if (pay >= 6) sfx.coin(); else if (pay === 0) sfx.error(); else sfx.pickup();
      if (s.round >= 3) { this.done(s); return; }
      s.round++; s.toast = 0; s.fire = false;
    },
    done(s) {
      const pay = s.results.reduce((a, b) => a + b, 0);
      const golds = s.results.filter(v => v >= 6).length;
      const ck = golds >= 3 ? 4 : golds >= 2 ? 2 : 0;
      finishGame(golds + '/3 GOLDEN', pay, ck, ['MALLOWS: ' + s.results.map(v => '$' + v).join(' ')]);
    },
    draw(s) {
      const gy = stageCamp();
      ctx.save(); ctx.globalAlpha = 0.12; fillCircle(262, gy + 18, 44, '#ff9838'); ctx.restore();
      drawRangerSitting(170, gy - 12);
      drawCampfire(262, gy + 22, 0.75);
      // ember sparks over the coals
      ctx.save();
      for (let i = 0; i < 5; i++) { const ph = (tNow * 0.8 + i * 0.37) % 1; ctx.globalAlpha = (1 - ph) * 0.9; rect(262 + Math.sin(ph * 9 + i) * 10, gy + 16 - ph * 24, 1, 1, ph < .5 ? '#ffe089' : '#ff9838'); }
      ctx.restore();
      if (s) {
        // skewer (rim-lit) from the ranger to over the coals
        for (let i = 0; i < 22; i++) { rect(192 + i * 3.2, gy - 6 - i * 0.8, 3, 2, '#8a6a3a'); rect(192 + i * 3.2, gy - 6 - i * 0.8, 3, 1, '#c8a86a'); }
        const t = s.toast;
        const shades = ['#f8f6ee', '#f0dfb8', '#e8c878', '#d8a038', '#7a4a20', '#241a10'];
        const idx = t < 0.25 ? 0 : t < 0.45 ? 1 : t < 0.6 ? 2 : t <= 0.8 ? 3 : t <= 0.92 ? 4 : 5;
        const col = shades[idx], nextCol = shades[Math.min(5, idx + 1)];
        const mmx = 262, mmy = gy - 26 + Math.round(Math.sin(tNow * 2) * 1);
        rr(mmx - 7, mmy - 1, 15, 13, 3, '#00000055'); rr(mmx - 6, mmy, 14, 12, 3, col);
        if (t > 0.45 && t < 0.92) dither(mmx - 5, mmy + 5, 12, 6, col, nextCol, (tNow * 3 | 0)); // browning gradient
        ctx.save(); ctx.globalAlpha = clamp(1 - t, 0.2, 1); rect(mmx - 4, mmy + 1, 4, 2, '#fffdf6'); rect(mmx - 4, mmy + 1, 1, 1, '#ffffff'); ctx.restore(); // gloss
        if (t > 0.6) rect(mmx + 2, mmy + 11 + ((tNow * 8) % 4), 1, 2, t > 0.8 ? '#3a2410' : '#c8873a'); // molten drip
        if (s.fire) { const fl = (tNow * 12 | 0) % 3; rect(mmx - 3, mmy - 9 - fl, 6, 9 + fl, '#d94f30'); rect(mmx - 2, mmy - 6 - fl, 4, 6 + fl, '#ff9838'); rect(mmx - 1, mmy - 3, 2, 4, '#ffe089'); rect(mmx + Math.sin(tNow * 20) * 3, mmy - 10 - ((tNow * 30) % 12), 1, 1, '#ffe089'); }
        // toast meter with GOLD zone
        const bx2 = 320, by2 = gy - 46;
        panel(bx2 - 4, by2 - 4, 96, 20, { face: '#10181ee8' });
        rect(bx2, by2, 88, 6, '#0a1215');
        rect(bx2 + 88 * 0.6, by2, 88 * 0.2, 6, '#a4741a');
        rect(bx2 + Math.min(88, t * 88) - 1, by2 - 2, 2, 10, '#f4f0dc');
        drawTextC('GOLD ZONE', bx2 + 44, by2 + 8, '#ffc843', 1);
        if (s.msgT > 0) drawTextCSh(s.msg, 262, gy - 56, s.msg.includes('GOLD') ? C.gold : C.white, 1);
      }
    },
    hud: s => 'MALLOW ' + s.round + '/3   TAP TO PULL IT OFF THE FIRE',
  },
  // ----------------------------------------------- 5. duck gallery ---------
  ducks: {
    init(s) { Object.assign(s, { timer: 14, ducks: [], spawned: 0, goldSpawned: 0, hitsN: 0, goldHits: 0, cool: 0, spawnT: 0.3, pay: 0, flash: 0 }); },
    update(s, dt) {
      s.timer -= dt; s.cool -= dt; s.flash -= dt; s.spawnT -= dt;
      const lanes = [64, 96, 128];
      if (s.spawnT <= 0 && s.spawned < 12 + 2) {
        s.spawnT = 0.8;
        const gold = (s.spawned === 4 || s.spawned === 9) ? 1 : 0;
        const lane = s.spawned % 3;
        const dir = lane % 2 ? -1 : 1;
        s.ducks.push({ lane, x: dir > 0 ? STAGE.x - 20 : STAGE.x + STAGE.w + 20, dir, sp: (42 + lane * 22) * (gold ? 1.7 : 1), gold, dead: 0 });
        s.spawned++;
      }
      s.ducks.forEach(d => {
        if (d.dead > 0) { d.dead += dt; return; }
        d.x += d.dir * d.sp * dt;
      });
      s.ducks = s.ducks.filter(d => d.dead < 0.7 && d.x > STAGE.x - 30 && d.x < STAGE.x + STAGE.w + 30);
      if (s.timer <= 0 || (s.spawned >= 14 && !s.ducks.length)) this.done(s);
    },
    tap(s) {
      if (s.cool > 0) return;
      s.cool = 0.22; s.flash = 0.08; s._smoke = { x: mx, y: my };
      sfx.pin();
      const lanes = [64, 96, 128];
      let best = null;
      s.ducks.forEach(d => {
        if (d.dead) return;
        const dy = STAGE.y + lanes[d.lane], dx2 = d.x;
        if (mx >= dx2 - 13 && mx <= dx2 + 13 && my >= dy - 12 && my <= dy + 10) best = d;
      });
      if (best) {
        best.dead = 0.01;
        const val = best.gold ? 3 : 1;
        s.pay += val; s.hitsN++; if (best.gold) s.goldHits++;
        burst(best.x, STAGE.y + lanes[best.lane], best.gold ? '#ffd54a' : '#c8873a', 8, 80); // wood chips
        sfx.coin(); float(best.x, STAGE.y + lanes[best.lane] - 14, '+$' + val, best.gold ? C.gold : C.white, 1);
      }
    },
    done(s) {
      const ck = s.hitsN >= 14 ? 5 : s.hitsN >= 10 ? 2 : 0;
      finishGame(s.hitsN + '/14 DUCKS', s.pay, ck, ['GALLERY WINNINGS: +$' + s.pay]);
    },
    draw(s) {
      const { x, y, w, h } = STAGE;
      // carnival booth: velvet drapes, painted swamp flat, scalloped awning
      paintCached('duckBooth', x, y, w, h, () => {
        rect(0, 0, w, h, '#120c1a');
        // the painted backdrop flat: a cartoon swamp in poster colours
        for (let yy = 24; yy < 110; yy++) rect(0, yy, w, 1, mixC('#2a1a4a', '#6a3a6a', (yy - 24) / 86));
        fillCircle(w / 2, 96, 30, '#e8a04a'); fillCircle(w / 2, 96, 24, '#f8d070');
        for (let k = 0; k < 9; k++) { const tx = 20 + k * 46, th = 34 + (k * 17) % 22; rect(tx - 2, 110 - th, 4, th, '#1a1030'); rect(tx - 12, 110 - th, 24, 4, '#1a1030'); rect(tx - 8, 110 - th - 3, 16, 3, '#1a1030'); }
        grainRect(0, 24, w, 86, '#1a1030', null, 0.015, 5);
        // velvet side drapes with deep folds
        [[0, 1], [w - 44, -1]].forEach(([dx, sd]) => {
          for (let xx = 0; xx < 44; xx++) {
            const f = (xx % 11) / 11, tone = f < 0.25 ? '#3a0a18' : f < 0.5 ? '#6a1428' : f < 0.8 ? '#8a2038' : '#a83048';
            const bottom = h - 4 - Math.round(Math.max(0, (sd > 0 ? xx : 43 - xx) - 20) * 0.8);
            rect(dx + xx, 14, 1, bottom - 14, tone);
          }
          rect(dx + (sd > 0 ? 30 : 4), 90, 10, 4, UGOLD[2]); rect(dx + (sd > 0 ? 30 : 4), 90, 10, 1, UGOLD[4]);
        });
        // striped awning with a scalloped hem
        for (let k = 0; k < Math.ceil(w / 24); k++) {
          const col = k % 2 ? '#c23a4a' : '#ece6d2', dk = k % 2 ? '#8a1e2e' : '#b8b09a';
          rect(k * 24, 0, 24, 14, col); rect(k * 24 + 18, 0, 6, 14, dk); rect(k * 24, 0, 24, 2, k % 2 ? '#e05a6a' : '#ffffff');
          for (let j = 0; j < 5; j++) rect(k * 24 + 2 + j, 14 + j, 20 - j * 2, 1, col);
        }
        grainRect(0, 0, w, 14, '#00000022', null, 0.08, 3);
        rect(0, 12, w, 1, '#00000055');
        // a painted marquee board
        plasticBox(w / 2 - 62, 16, 124, 12, 3, UGOLD, { noShine: 1 });
        drawTextC('* DUCK GALLERY *', w / 2, 19, '#5a1a0a', 1);
        // stage floor planks
        for (let r = 0; r < 3; r++) { rect(0, h - 14 + r * 5, w, 5, r % 2 ? '#3a2412' : '#4a3018'); rect(0, h - 14 + r * 5, w, 1, '#6a4a28'); }
      });
      // bulbs around the marquee chase each other
      for (let k = 0; k < 12; k++) { const on = ((tNow * 8 | 0) + k) % 3 === 0; rect(x + w / 2 - 60 + k * 11, y + 29, 2, 2, on ? '#fff6c8' : '#6a5a2a'); }
      // two sweeping spotlight cones
      godRay(x + 120, y + 22, y + 140, 4, 26, Math.sin(tNow * 0.6) * 40, '#fff2c0', 0.04);
      godRay(x + 280, y + 22, y + 140, 4, 26, Math.sin(tNow * 0.6 + 2) * -40, '#fff2c0', 0.04);
      // triangular bunting under the awning
      for (let k = 0; k * 20 < w; k++) {
        const bx = x + k * 20, sag = Math.sin(k * 1.3) * 1, col = ['#e84a5a', '#ffc843', '#4fb3d9'][k % 3];
        for (let t = 0; t < 6; t++) rect(bx + 4 + t, y + 17 + sag + t, 12 - t * 2, 1, col);
      }
      // blinking string-light bulbs
      for (let k = 0; k * 16 < w; k++) sparkle(x + 8 + k * 16, y + 15, ['#ffe089', '#ff8fa0', '#9fe8ff'][k % 3], 4, k);
      const lanes = [64, 96, 128];
      // ducks behind the front-most rail rows
      if (s) s.ducks.forEach(d => {
        const dy = y + lanes[d.lane];
        ctx.save();
        if (d.dead) { ctx.translate(d.x, dy + d.dead * 26); ctx.rotate(d.dir * d.dead * 2.4); ctx.translate(-d.x, -dy); ctx.globalAlpha = Math.max(0, 1 - d.dead * 1.3); }
        const c = d.gold ? '#ffd54a' : '#e8b45a', cd = d.gold ? '#c9941a' : '#a87838', clt = d.gold ? '#fff2c0' : '#f0d868';
        ctx.save(); if (d.dir < 0) { ctx.translate(d.x * 2, 0); ctx.scale(-1, 1); }
        rr(d.x - 12, dy - 6, 22, 12, 4, cd);            // outline
        rr(d.x - 11, dy - 5, 20, 11, 4, c);            // body
        rect(d.x - 9, dy - 5, 16, 1, clt);             // back light
        rect(d.x - 11, dy + 3, 20, 2, cd);             // belly shadow
        rect(d.x - 6, dy - 1, 8, 1, cd);               // paint grain
        fillCircle(d.x + 8, dy - 8, 5, c); rect(d.x + 6, dy - 10, 2, 1, clt); // head + glint
        rect(d.x + 11, dy - 9, 6, 3, '#ff9838'); rect(d.x + 16, dy - 9, 1, 1, '#fff6c8'); // bill + tip
        rect(d.x + 7, dy - 10, 2, 2, '#1b1408'); rect(d.x + 8, dy - 10, 1, 1, '#fff'); // eye + catch
        rect(d.x - 6, dy - 3, 8, 4, cd);                // wing
        if (d.gold) { ctx.save(); ctx.globalAlpha = 0.5; rect(d.x - 11 + ((tNow * 30 + d.x) % 22), dy - 4, 2, 8, '#fff6c8'); ctx.restore(); } // shimmer swipe
        ctx.restore();
        ctx.restore();
      });
      // painted wave rails in front
      lanes.forEach((ly, k) => {
        const wy2 = y + ly + 8;
        for (let wx = x; wx < x + w; wx += 12) {
          fillCircle(wx + 6, wy2 + 3, 6, k % 2 ? '#1e4a6a' : '#16405e');
        }
        rect(x, wy2 + 4, w, 6, k % 2 ? '#1e4a6a' : '#16405e');
      });
      rect(x, y + h - 12, w, 12, '#3a2818'); // counter
      // crosshair + muzzle flash
      if (s) {
        ctx.save(); ctx.globalAlpha = 0.9;
        rect(mx - 7, my, 5, 1, C.red); rect(mx + 3, my, 5, 1, C.red);
        rect(mx, my - 7, 1, 5, C.red); rect(mx, my + 3, 1, 5, C.red);
        ctx.restore();
        if (s.flash > 0) {
          const a = clamp(s.flash / 0.08, 0, 1); ctx.save(); ctx.globalAlpha = a;
          fillCircle(mx, my, 5, '#fff6c8'); fillCircle(mx, my, 3, '#ffffff');
          [[6, 0], [-6, 0], [0, 6], [0, -6]].forEach(([ox, oy]) => rect(mx + ox - 1, my + oy - 1, 3, 3, '#ffe089'));
          ctx.restore();
        }
        if (s._smoke) smoke(s._smoke.x, s._smoke.y, 3, 0, '#8a8a9a', 18, 4);
      }
    },
    hud: s => 'TIME: ' + Math.max(0, s.timer).toFixed(1) + 's   BAG: $' + s.pay + '   HIT: ' + s.hitsN + '/14',
  },
  // ------------------------------------------------ 6. frog roundup --------
  froggy: {
    init(s) {
      Object.assign(s, { timer: 14, caught: 0, total: 7, frogs: [], msg: '', msgT: 0 });
      for (let i = 0; i < 7; i++) s.frogs.push({ x: STAGE.x + 40 + i * 46, y: 0, st: 'sit', t: rnd() * 0.8, sitT: 0.8 + rnd() * 0.8, hx: 0, size: 0.9 + rnd() * 0.3 });
    },
    update(s, dt) {
      s.timer -= dt; s.msgT -= dt;
      const wy = this.wy || (STAGE.y + Math.round(STAGE.h * 0.62));
      if (s._pop) { s._pop.r += dt * 60; if (s._pop.r > 20) s._pop = null; }
      s.frogs.forEach(f => {
        f.t += dt;
        if (f.st === 'sit' && f.t >= f.sitT) { f.st = 'hop'; f.t = 0; f.hx = f.x + (rnd() < 0.5 ? -1 : 1) * (40 + rnd() * 70); f.hx = clamp(f.hx, STAGE.x + 20, STAGE.x + STAGE.w - 20); }
        if (f.st === 'hop' && f.t >= 0.5) { f.st = 'sit'; f.t = 0; f.sitT = 0.7 + rnd() * 0.9; f.x = f.hx; addRipple(f.hx, wy + 6, false); burst(f.hx, wy + 4, '#7fb8c8', 5, 45); }
      });
      if (s.timer <= 0) this.done(s);
    },
    tap(s) {
      const wy = STAGE.y + Math.round(STAGE.h * 0.62);
      let got = null;
      s.frogs.forEach(f => { if (f.st === 'sit' && Math.abs(mx - f.x) < 15 && Math.abs(my - (wy + 2)) < 20) got = f; });
      if (got) {
        s.frogs.splice(s.frogs.indexOf(got), 1);
        s.caught++; s.msg = 'GOTCHA!'; s.msgT = 0.9; s._pop = { x: got.x, y: wy, r: 0 };
        sfx.coin(); burst(got.x, wy, '#7ec850', 10, 70);
        if (!s.frogs.length) this.done(s);
      } else { s.msg = 'HOPPED AWAY!'; s.msgT = 0.7; sfx.error(); }
    },
    done(s) {
      const ck = s.caught >= 7 ? 4 : s.caught >= 5 ? 2 : 0;
      finishGame(s.caught + '/7 FROGS', s.caught * 2, ck, ['SOLD TO THE CHOIR: +$' + (s.caught * 2)]);
    },
    draw(s) {
      const wy = this.wy = stageNight('#0e2a20');
      reflect(396, wy, 190, 3, '#e8e8d0', 2, 1.3);
      for (let i = 0; i < 4; i++) { ctx.save(); ctx.globalAlpha = 0.3 + 0.3 * Math.sin(tNow * 4 + i); fillCircle(STAGE.x + 40 + ((tNow * 8 + i * 90) % 320), STAGE.y + 80 + Math.sin(tNow * 2 + i) * 6, 1, '#c8ff9a'); ctx.restore(); }
      // dragonfly darting on a Lissajous path
      const dgx = STAGE.x + 80 + Math.sin(tNow * 1.1) * 90, dgy = STAGE.y + 70 + Math.cos(tNow * 1.7) * 20;
      rect(dgx, dgy, 2, 1, '#8fd0ff'); if ((tNow * 12 | 0) % 2) { rect(dgx - 2, dgy - 1, 2, 1, '#bfe8ff88'); rect(dgx + 2, dgy - 1, 2, 1, '#bfe8ff88'); }
      // rim-lit lilypads with veins, dew glint + occasional flower
      for (let x = STAGE.x + 20; x < STAGE.x + STAGE.w - 10; x += 34) {
        rr(x, wy + 8, 24, 6, 2, '#264a1c'); rr(x, wy + 8, 24, 5, 2, '#3a6a44'); rect(x + 3, wy + 8, 16, 1, '#5aa85a');
        for (let v = 0; v < 3; v++) rect(x + 12, wy + 9, 8 - v * 2, 1, '#2c5228');
        rect(x + 19, wy + 9, 4, 2, '#0a2830'); sparkle(x + 6, wy + 9, '#a8e878', 5, x);
        if (x % 68 < 34) { rect(x + 9, wy + 6, 3, 2, '#f0a8c8'); rect(x + 10, wy + 5, 1, 1, '#fff'); }
      }
      if (s) s.frogs.forEach(f => {
        let fx2 = f.x, fy2 = wy + 2;
        if (f.st === 'hop') { const h = f.t / 0.5; fx2 = lerp(f.x, f.hx, h); fy2 = wy + 2 - Math.sin(h * Math.PI) * 26; }
        const sz = f.size;
        rr(fx2 - 8 * sz - 1, fy2 - 6 * sz - 1, 16 * sz + 2, 10 * sz + 2, 4, '#2c5a22'); // outline
        rr(fx2 - 8 * sz, fy2 - 6 * sz, 16 * sz, 10 * sz, 4, '#5aa843'); rect(fx2 - 6 * sz, fy2 - 6 * sz, 12 * sz, 1, '#7ec850'); // body + dorsal light
        rr(fx2 - 6 * sz, fy2 + 1, 12 * sz, 4, 2, '#e8e0b0'); // belly
        fillCircle(fx2 - 4 * sz, fy2 - 7 * sz, 3, '#5aa843'); fillCircle(fx2 + 4 * sz, fy2 - 7 * sz, 3, '#5aa843');
        rect(fx2 - 5 * sz, fy2 - 8 * sz, 2, 2, '#f4f0dc'); rect(fx2 + 3 * sz, fy2 - 8 * sz, 2, 2, '#f4f0dc'); // eye whites
        rect(fx2 - 5 * sz, fy2 - 8 * sz, 1, 1, '#1b1408'); rect(fx2 + 4 * sz, fy2 - 8 * sz, 1, 1, '#1b1408'); // pupils
        if (f.st === 'hop') { rect(fx2 - 9 * sz, fy2 + 4, 4, 2, '#3c7c2e'); rect(fx2 + 6 * sz, fy2 + 4, 4, 2, '#3c7c2e'); }
        if (f.st === 'sit') { const puff = Math.max(0, Math.sin(tNow * 3 + f.x)) * 3; fillCircle(fx2, fy2, 2 + puff * 0.3, '#e8e0b0'); } // throat sac
      });
      if (s && s._pop) { ctx.save(); ctx.globalAlpha = Math.max(0, 1 - s._pop.r / 20); ring(s._pop.x, s._pop.y, s._pop.r, '#a8e878'); ctx.restore(); }
      if (s && s.msgT > 0) drawTextCSh(s.msg, W / 2, STAGE.y + 16, s.msg === 'GOTCHA!' ? C.gold : '#ffb0a8', 1);
    },
    hud: s => 'TIME: ' + Math.max(0, s.timer).toFixed(1) + 's   BAGGED: ' + s.caught + '/7',
  },
  // ------------------------------------------------ 7. bird photography ----
  birdy: {
    init(s) { Object.assign(s, { timer: 16, shots: 6, snapped: 0, pay: 0, birds: [], spawnT: 0.2, flash: 0, msg: '', msgT: 0 }); },
    update(s, dt) {
      s.timer -= dt; s.flash -= dt; s.msgT -= dt; s.spawnT -= dt;
      if (s.spawnT <= 0 && s.birds.filter(b => !b.done).length < 3) {
        s.spawnT = 1.1;
        const heron = rnd() < 0.18;
        const dir = rnd() < 0.5 ? 1 : -1;
        s.birds.push({ x: dir > 0 ? STAGE.x - 20 : STAGE.x + STAGE.w + 20, y: STAGE.y + 26 + rnd() * 50, dir, sp: heron ? 34 : 52 + rnd() * 26, heron, done: false, ph: rnd() * 9 });
      }
      s.birds.forEach(b => { b.x += b.dir * b.sp * dt; b.y += Math.sin(tNow * 2 + b.ph) * 6 * dt; });
      s.birds = s.birds.filter(b => b.x > STAGE.x - 30 && b.x < STAGE.x + STAGE.w + 30);
      if (s.timer <= 0 || s.shots <= 0 && s.flash <= -0.5) this.done(s);
    },
    tap(s) {
      if (s.shots <= 0) return;
      s.shots--; s.flash = 0.12; sfx.pin();
      let best = null;
      s.birds.forEach(b => { if (!b.done && Math.abs(b.x - mx) < 24 && Math.abs(b.y - my) < 17) best = b; });
      if (best) {
        best.done = true; best.sp *= 2.2; // startled, flies off
        const val = best.heron ? 5 : 2;
        s.pay += val; s.snapped++;
        s.msg = best.heron ? 'THE GOLDEN HERON! +$5' : 'GREAT SHOT! +$2'; s.msgT = 1;
        burst(best.x, best.y, best.heron ? '#ffe6a0' : '#e8f0f4', 7, 50); // feather poof
        sfx.coin(); float(best.x, best.y - 12, 'CLICK!', C.white, 1);
      } else { s.msg = 'JUST REEDS...'; s.msgT = 0.8; }
    },
    done(s) {
      const ck = s.snapped >= 6 ? 4 : s.snapped >= 4 ? 2 : 0;
      finishGame(s.snapped + '/6 PHOTOS', s.pay, ck, ['SOLD TO THE GAZETTE: +$' + s.pay]);
    },
    draw(s) {
      const wy = stageNight('#0a2432');
      reflect(396, wy, 190, 3, '#e8e8d0', 2, 1.3);
      // distant flock drifting on the far layer
      ctx.save(); ctx.globalAlpha = 0.3;
      for (let i = 0; i < 3; i++) { const bx = STAGE.x + ((STAGE.w - (tNow * 6 + i * 130)) % (STAGE.w + 30) + STAGE.w + 30) % (STAGE.w + 30) - 15, by = STAGE.y + 30 + i * 8; rect(bx - 2, by, 2, 1, '#8a98a8'); rect(bx + 1, by, 2, 1, '#8a98a8'); rect(bx, by + 1, 1, 1, '#8a98a8'); }
      ctx.restore();
      // drifting mist band
      ctx.save(); ctx.globalAlpha = 0.06; for (let k = 0; k < 5; k++) rr(STAGE.x + ((k * 90 - tNow * 10) % (STAGE.w + 60) + STAGE.w + 60) % (STAGE.w + 60) - 30, STAGE.y + 70, 40, 8, 4, '#cfe8f0'); ctx.restore();
      if (s) {
        // nearest bird → viewfinder focus check
        let near = null, nd = 1e9;
        s.birds.forEach(b => { const d = Math.abs(b.x - mx) + Math.abs(b.y - my); if (d < nd) { nd = d; near = b; } });
        const focused = near && Math.abs(near.x - mx) < 22 && Math.abs(near.y - my) < 15;
        s.birds.forEach(b => {
          const fl = Math.floor(tNow * 8 + b.ph) % 2;
          const c = b.heron ? '#ffd54a' : '#c8d4dc', cd = b.heron ? '#a4741a' : '#5a666e';
          ctx.save(); if (b.dir < 0) { ctx.translate(b.x * 2, 0); ctx.scale(-1, 1); }
          rr(b.x - 8, b.y - 3, 16, 6, 2, cd); rr(b.x - 7, b.y - 2, 14, 5, 2, c); rect(b.x - 5, b.y - 2, 10, 1, b.heron ? '#fff2c0' : '#e8f0f4'); // outline+body+backlight
          rect(b.x + 6, b.y - 4, 5, 3, c); rect(b.x + 10, b.y - 3, 3, 2, '#e8842a'); rect(b.x + 8, b.y - 3, 1, 1, '#1b1408');
          rect(b.x - 3, b.y - (fl ? 6 : 2), 7, 4, b.heron ? '#e8b45a' : '#a8b4bc'); rect(b.x - 3, b.y - (fl ? 6 : 2), 7, 1, '#e8f0f4'); // wing + leading edge
          if (b.heron) { rect(b.x - 10, b.y, 4, 1, '#e8b45a'); rect(b.x + 2, b.y + 3, 1, 7, c); rect(b.x + 4, b.y + 3, 1, 7, c); ctx.save(); ctx.globalAlpha = 0.5; rect(b.x - 7 + ((tNow * 26 + b.x) % 14), b.y - 2, 2, 5, '#fff6c8'); ctx.restore(); } // legs + shimmer
          ctx.restore();
        });
        // camera viewfinder: brackets breathe toward focus, reticle tints
        ctx.save(); ctx.globalAlpha = 0.9;
        const ins = focused ? 2 : 6, rc = focused ? C.green : C.red;
        const vx = mx - 24, vy = my - 17, vw = 48, vh = 34;
        [[0, 0], [vw - 8, 0], [0, vh - 8], [vw - 8, vh - 8]].forEach(([ox, oy]) => { rect(vx + ox + (ox ? -ins : ins), vy + oy + (oy ? -ins : ins), 8, 2, '#f4f2e4'); rect(vx + ox + (ox ? 6 - ins : ins), vy + oy + (oy ? -ins : ins), 2, 8, '#f4f2e4'); });
        rect(mx - 3, my, 2, 1, rc); rect(mx + 2, my, 2, 1, rc); rect(mx, my - 3, 1, 2, rc); rect(mx, my + 2, 1, 2, rc);
        ctx.restore();
        if (s.flash > 0) { ctx.save(); ctx.globalAlpha = clamp(s.flash * 6, 0, 1); rect(STAGE.x, STAGE.y, STAGE.w, STAGE.h, '#fff'); ctx.globalAlpha = clamp(s.flash * 10, 0, 1); fillCircle(mx, my, 14 - s.flash * 60, '#fff'); ctx.restore(); }
        for (let i = 0; i < 6; i++) rr(STAGE.x + 8 + i * 11, STAGE.y + 8, 8, 12, 2, i < s.shots ? '#ffe089' : '#2a343c');
        if (s.msgT > 0) drawTextCSh(s.msg, W / 2, STAGE.y + 26, s.msg.includes('$') ? C.gold : '#8fa6a8', 1);
      }
      // foreground reed silhouettes (near parallax, sway)
      for (let k = 0; k < 9; k++) { const rx = STAGE.x + 20 + k * 44, sway = Math.sin(tNow * 1.2 + k) * 2; rect(rx + sway, STAGE.y + STAGE.h - 40, 2, 40, '#0a1a12'); rr(rx - 1 + sway, STAGE.y + STAGE.h - 46, 4, 8, 1, '#241708'); }
    },
    hud: s => 'FILM: ' + s.shots + '/6   PHOTOS: ' + s.snapped + '   EARNED: $' + s.pay,
  },
  // ------------------------------------------------ 8. airboat run ---------
  boat: {
    init(s) { Object.assign(s, { timer: 15, py: STAGE.y + 100, coins: 0, stun: 0, things: [], spawnT: 0.4, scroll: 0 }); },
    update(s, dt) {
      s.timer -= dt; s.stun -= dt; s.spawnT -= dt; s.scroll += 92 * dt;
      const y0 = STAGE.y + 52, y1 = STAGE.y + 148;
      const target = clamp(my, y0, y1);
      s.py += (target - s.py) * Math.min(1, 7 * dt);
      if (s.spawnT <= 0) {
        s.spawnT = 0.62;
        const coin = rnd() < 0.62;
        s.things.push({ x: STAGE.x + STAGE.w + 20, y: y0 + rnd() * (y1 - y0), coin, hit: false });
      }
      s.things.forEach(o => {
        o.x -= 92 * dt;
        if (!o.hit && Math.abs(o.x - 120) < (o.coin ? 20 : 24) && Math.abs(o.y - s.py) < (o.coin ? 16 : 13)) {
          o.hit = true;
          if (o.coin) { s.coins++; sfx.coin(); float(o.x, o.y - 10, '+$1', C.gold, 1); }
          else if (s.stun <= 0) { s.stun = 0.7; shake = 4; sfx.splash(); addRipple(120, s.py + 8, true); burst(120, s.py + 8, '#9fd8e0', 12, 90); }
        }
      });
      s.things = s.things.filter(o => o.x > STAGE.x - 40 && !(o.coin && o.hit));
      if (s.timer <= 0) this.done(s);
    },
    tap() { }, // steering only
    done(s) {
      const ck = s.coins >= 12 ? 4 : s.coins >= 8 ? 2 : 0;
      finishGame(s.coins + ' COINS', s.coins, ck, ['SWAMP SALVAGE: +$' + s.coins]);
    },
    draw(s) {
      const { x, y, w, h } = STAGE;
      // scrolling night channel: banks top and bottom, open water between
      const sc = s ? s.scroll : tNow * 60;
      paintCached('boatSky', x, y, w, 40, () => {
        for (let yy = 0; yy < 40; yy++) { rect(0, yy, w, 1, NIGHT[Math.min(NIGHT.length - 1, Math.floor(yy / 7))]); }
        for (let k = 0; k < 60; k++) rect(Math.floor(hash2(k, 3) * w), Math.floor(hash2(k, 4) * 30), 1, 1, k % 5 ? '#6a7a98' : '#ffffff');
      });
      for (let yy = y + 40; yy < y + h - 40; yy++) rect(x, yy, w, 1, mixC('#0c2430', '#061218', (yy - y - 40) / (h - 80)));
      // the far bank of sawgrass and the near bank, both scrolling past
      const bank = (key, bh, spd, yy, flip) => {
        const strip = getCached(key, w, bh, () => {
          for (let xx = 0; xx < w; xx++) {
            const top = flip ? bh - 6 - Math.floor(vnoise(xx, 0, 9, 3) * 6) : Math.floor(vnoise(xx, 0, 9, 3) * 6);
            for (let j = 0; j < bh; j++) {
              const inside = flip ? j < top : j > top;
              if (!inside) continue;
              const q = hash2(xx >> 1, j >> 2), blade = (xx + (j >> 3)) % 3 === 0;
              rect(xx, j, 1, 1, blade ? (j % 7 < 2 ? '#2e5a2e' : '#1e4222') : q < 0.1 ? '#0c1c12' : '#16301c');
            }
            if (hash2(xx, 9) < 0.3) { const bl = 4 + Math.floor(hash2(xx, 8) * 7); for (let j = 0; j < bl; j++) rect(xx, flip ? top + j : top - j, 1, 1, j === bl - 1 ? '#5a8a3a' : '#2a5a2a'); }
          }
        });
        const off = ((sc * spd) % w + w) % w;
        ctx.drawImage(strip, x - off, yy, w, bh); ctx.drawImage(strip, x - off + w, yy, w, bh);
      };
      bank('boatBankTop', 16, 0.9, y + 30, 1);
      bank('boatBankBot', 44, 1.25, y + h - 44, 0);
      // far treeline (slow parallax) + moon glimmer + channel caustics
      for (let tx2 = x; tx2 < x + w; tx2 += 6) { const th2 = 8 + ((Math.sin((tx2 - sc * 0.4) * 0.1) * 5) | 0) + ((tx2 * 7) % 5); rect(tx2, y + 40 - th2, 6, th2, '#0d2028'); }
      fillCircle(x + w - 40, y + 20, 10, '#e8e8d0'); reflect(x + w - 40, y + 40, y + h, 3, '#e8e8d0', 2, 1.3);
      caustics(x, y + 52, w, h - 92, '#1e4a52', 0.18);
      for (let i = 0; i < 4; i++) { ctx.save(); ctx.globalAlpha = 0.4; fillCircle(x + ((x + w - (tNow * 60 + i * 100)) % (w + 40) + w + 40) % (w + 40), y + 46 + i * 22, 1, '#c8ff9a'); ctx.restore(); }
      // drifting bank reeds (parallax rows)
      for (let k = 0; k < 10; k++) {
        const rx2 = x + ((k * 97 - sc) % (w + 40) + w + 40) % (w + 40) - 20;
        rect(rx2, y + 30 - (k % 3) * 4, 2, 12 + (k % 3) * 4, '#132d1e');
        rr(rx2 - 1, y + 24 - (k % 3) * 4, 4, 7, 1, '#4a3320');
        const bx2 = x + ((k * 83 + 40 - sc * 1.25) % (w + 40) + w + 40) % (w + 40) - 20;
        rect(bx2, y + h - 38, 2, 14, '#1a3a24');
      }
      // water speed streaks
      for (let k = 0; k < 8; k++) {
        const lx = x + ((k * 71 - sc * 1.6) % (w + 30) + w + 30) % (w + 30) - 15;
        ctx.save(); ctx.globalAlpha = 0.25; rect(lx, y + 52 + (k * 37) % 90, 14, 1, '#1e4a52'); ctx.restore();
      }
      if (s) {
        // floaters: coins glint, logs roll
        s.things.forEach(o => {
          ctx.save(); ctx.globalAlpha = 0.4; ring(o.x - 8, o.y + 4, 3, '#1e4a52'); ctx.restore(); // bow ripple in front
          if (o.coin && !o.hit) {
            const cw = Math.max(1, Math.abs(Math.cos(tNow * 6 + o.x)) * 6); // spinning squash
            fillCircle(o.x, o.y, 6, '#8a5a10');
            rect(o.x - cw, o.y - 5, cw * 2, 10, '#a4741a'); rect(o.x - cw + 1, o.y - 4, cw * 2 - 2, 8, '#ffc843');
            rect(o.x - 1, o.y - 3, 1, 6, '#fff6c8'); sparkle(o.x, o.y - 3, '#fff6c8', 7, o.x);
          } else if (!o.coin) {
            rr(o.x - 17, o.y - 6, 34, 12, 5, '#241708'); rr(o.x - 16, o.y - 5, 32, 10, 5, '#5f4228'); rect(o.x - 14, o.y - 5, 28, 1, '#8a6a3a'); // bark + rim
            rect(o.x - 6, o.y - 5, 10, 2, '#3c6a2e'); rect(o.x - 3, o.y - 5, 1, 1, '#5aa843'); rect(o.x + 2, o.y - 4, 1, 1, '#5aa843'); // moss patch
            fillCircle(o.x + 13, o.y, 4, '#3a2818'); fillCircle(o.x + 13, o.y, 2, '#5f4228'); fillCircle(o.x + 13, o.y, 1, '#8a6a3a'); // end-grain rings
            ctx.save(); ctx.globalAlpha = 0.6; rect(o.x + 14, o.y - 5, 3, 10, '#cfe8f0'); ctx.restore(); // bow-wave curl
          }
        });
        // bigger bow spray + widening V-wake
        ctx.save();
        for (let i = 0; i < 6; i++) { const ph = (tNow * 3 + i * 0.5) % 1; ctx.globalAlpha = (1 - ph) * 0.5; rect(150 + ph * 14, s.py + 6 - Math.sin(ph * Math.PI) * (4 + i), 2, 2, '#9fd8e0'); }
        ctx.globalAlpha = 0.22; for (let k = 1; k < 6; k++) { rect(120 - 30 - k * 7, s.py + 6 + k * 2, 8, 1, '#1e4a52'); rect(120 - 30 - k * 7, s.py + 6 - k * 2, 8, 1, '#1e4a52'); }
        ctx.restore();
        // the airboat itself (flicker while stunned)
        if (!(s.stun > 0 && ((tNow * 12) | 0) % 2)) {
          ctx.save(); ctx.translate(120, s.py); ctx.scale(0.62, 0.62); drawAirboat(0, 0, true, undefined); ctx.restore();
        }
        if (s.stun > 0.5) { ctx.save(); ctx.globalAlpha = (s.stun - 0.5) * 1.4; ring(120, s.py + 10, (0.7 - s.stun) * 40 + 6, '#cfe8f0'); ctx.restore(); }
      }
    },
    hud: s => 'TIME: ' + Math.max(0, s.timer).toFixed(1) + 's   COINS: $' + s.coins + (s.stun > 0 ? '   *CRUNCH*' : ''),
  },
  // ---------------------------------------------- 9. flippin' burgers -------
  burger: {
    init(s) { Object.assign(s, { timer: 14, served: 0, side: 0, cook: 0, rate: 0.5 + rnd() * 0.12, msg: '', msgT: 0, flash: 0, sizzle: [] }); },
    newPatty(s) { s.side = 0; s.cook = 0; s.rate = 0.5 + rnd() * 0.12; },
    update(s, dt) {
      s.timer -= dt; s.msgT -= dt; s.flash = Math.max(0, s.flash - dt * 3);
      s.cook += s.rate * dt;
      if (s.cook > 0.72 && rnd() < dt * 9) s.sizzle.push({ x: -8 + rnd() * 16, t: 0 });
      s.sizzle.forEach(p => { p.t += dt; });
      s.sizzle = s.sizzle.filter(p => p.t < 0.5);
      if (s.cook > 1.4) { s.msg = 'BURNT IT!'; s.msgT = 1; sfx.error(); this.newPatty(s); }
      if (s.timer <= 0) this.done(s);
    },
    tap(s) {
      if (s.cook < 0.78) { s.msg = 'STILL RAW - WAIT!'; s.msgT = 0.9; sfx.error(); return; }
      const clean = s.cook >= 0.9 && s.cook <= 1.18;
      sfx.click(clean ? 6 : 3); s.flash = 1;
      burst(240, this.gy - 8, clean ? '#ffe089' : '#c88a4a', clean ? 10 : 5, 60);
      if (s.side === 0) { s.side = 1; s.cook = 0; s.rate = 0.5 + rnd() * 0.12; s.msg = clean ? 'PERFECT FLIP!' : 'FLIPPED'; s.msgT = 0.9; }
      else { s.served++; this.newPatty(s); s.msg = clean ? 'ORDER UP! +1' : 'SERVED'; s.msgT = 1; sfx.coin(); }
    },
    done(s) {
      const ck = s.served >= 6 ? 4 : s.served >= 3 ? 2 : 0;
      finishGame(s.served + ' BURGERS', s.served * 2, ck, ['GRILL TIPS: +$' + (s.served * 2)]);
    },
    draw(s) {
      const gy = this.gy = stageCamp() - 6, gx = 240;
      // pulsing coal glow pool
      ctx.save(); ctx.globalAlpha = 0.10 + 0.05 * Math.sin(tNow * 4); fillCircle(gx, gy + 12, 46, '#ff9838'); ctx.restore();
      rect(gx - 46, gy + 6, 6, 20, '#241708'); rect(gx + 40, gy + 6, 6, 20, '#241708'); // legs
      for (let k = 0; k < 5; k++) drawCampfire(gx - 34 + k * 17, gy + 12, 0.5);
      // rim-lit flat-top with hot glow between grate bars
      rr(gx - 52, gy - 4, 104, 10, 3, '#3a444c'); rr(gx - 50, gy - 3, 100, 6, 2, '#5a646c'); rect(gx - 50, gy - 3, 100, 1, '#8a98a0');
      for (let k = 0; k < 9; k++) { rect(gx - 46 + k * 11, gy - 3, 1, 6, '#2a343c'); ctx.save(); ctx.globalAlpha = 0.3 + 0.3 * Math.sin(tNow * 5 + k); rect(gx - 46 + k * 11 + 1, gy - 2, 9, 1, '#ff9838'); ctx.restore(); }
      drawRangerSitting(gx - 92, gy - 30); // line cook off to the left
      // heat-haze + smoke over the cooktop
      heatHaze(gx - 52, gy - 14, 104, 12, '#ffd0a0');
      smoke(gx, gy - 6, 5, 0.2, (s && s.cook > 1.18) ? '#3a3a40' : '#6a6a72', 40, 8);
      ctx.save();
      for (let i = 0; i < 5; i++) { const ph = (tNow * 0.8 + i * 0.31) % 1; ctx.globalAlpha = (1 - ph) * 0.8; rect(gx - 34 + i * 17 + Math.sin(ph * 8 + i) * 4, gy + 8 - ph * 24, 1, 1, ph < .5 ? '#ffe089' : '#ff9838'); }
      ctx.restore();
      if (s) {
        const c = s.cook, col = c < 0.5 ? '#c96a5a' : c < 0.85 ? '#a85838' : c < 1.18 ? '#7a4526' : c < 1.4 ? '#5a3018' : '#2a1a12';
        const py = gy - 8 - (s.flash > 0.5 ? 12 * (s.flash - 0.5) : 0);
        // flame licks between the bars when hot
        if (c > 1.0) for (let k = 0; k < 6; k++) rect(gx - 8 + k * 4, py + 2 - ((tNow * 14 + k) % 4), 2, 4, '#ff9838');
        rr(gx - 15, py, 30, 9, 4, '#2a1a12'); rr(gx - 14, py, 28, 7, 3, col); rect(gx - 12, py, 24, 1, '#a85838'); // outline + patty + top light
        rect(gx - 8, py + 2, 2, 3, '#2a1a12'); rect(gx + 2, py + 2, 2, 3, '#2a1a12'); // sear stripes
        sparkle(gx - 6 + ((tNow * 10) % 12), py + 1, '#ffe0b0', 6, 0); // juice sheen
        if (s.side === 1) { rect(gx - 9, py - 2, 18, 2, '#4fae5c'); rect(gx - 7, py - 3, 14, 1, '#e0a848'); rect(gx + 6, py + 1, 2, 3, '#e0a848'); }
        s.sizzle.forEach(p => { ctx.save(); ctx.globalAlpha = 1 - p.t / 0.5; rect(gx + p.x, py - 2 - p.t * 14, 1, 1, p.t < 0.2 ? '#fff6c8' : '#ffe089'); ctx.restore(); });
        // doneness meter with the golden FLIP zone
        const mX = gx + 74, mY = gy - 62, mH = 62;
        rr(mX, mY, 10, mH, 2, '#1a2228');
        const zTop = mY + mH - Math.floor(1.18 / 1.4 * mH), zBot = mY + mH - Math.floor(0.9 / 1.4 * mH);
        rect(mX + 1, zTop, 8, zBot - zTop, '#2c7d3a');
        const fy = mY + mH - Math.floor(clamp(c / 1.4, 0, 1) * mH);
        rect(mX + 1, fy, 8, mY + mH - fy, c > 1.18 ? C.red : c > 0.78 ? C.gold : '#7fb8e8');
        drawTextC('FLIP', mX + 5, mY - 8, C.green, 1);
        for (let i = 0; i < s.served; i++) { const bx = gx - 62 + (i % 8) * 8, by = gy + 15 + ((i / 8) | 0) * 7; rr(bx, by, 7, 2, 1, '#e0a848'); rect(bx + 1, by - 1, 5, 1, '#f4c46a'); rect(bx + 1, by + 2, 5, 1, '#7a4526'); rect(bx, by + 3, 7, 1, '#c8873a'); rect(bx + 2, by - 1, 1, 1, '#fff2c8'); }
      }
    },
    hud: s => 'TIME: ' + Math.max(0, s.timer).toFixed(1) + 's   SERVED: ' + s.served,
  },
  // ---------------------------------------------- 10. manatee spa ----------
  manatee: {
    init(s) { Object.assign(s, { timer: 16, cleared: 0, bub: [], brush: null }); this.spawn(s); },
    spawn(s) {
      s.spots = [];
      for (let i = 0; i < 9; i++) {
        const a = rnd() * 6.28, r = 6 + rnd() * 38;
        s.spots.push({ x: 240 + Math.cos(a) * r * 1.4, y: STAGE.y + 96 + Math.sin(a) * r * 0.55, life: 1, r: 3 + (rnd() * 2 | 0) });
      }
    },
    update(s, dt) {
      s.timer -= dt;
      const bx = clamp(mx, STAGE.x, STAGE.x + STAGE.w), by = clamp(my, STAGE.y, STAGE.y + STAGE.h);
      s.brush = { x: bx, y: by };
      s.spots.forEach(sp => {
        if (sp.life <= 0) return;
        if (Math.hypot(sp.x - bx, sp.y - by) < 15) {
          sp.life -= 2.0 * dt;
          if (rnd() < dt * 16) s.bub.push({ x: sp.x + (rnd() - .5) * 8, y: sp.y, t: 0 });
          if (sp.life <= 0) { s.cleared++; sfx.pin(); burst(sp.x, sp.y, '#8fd0a0', 6, 40); burst(sp.x, sp.y, '#ffffff', 3, 55); float(sp.x, sp.y - 4, '+', '#cfe8f0', 1); }
        }
      });
      s.bub.forEach(b => { b.t += dt; b.y -= 20 * dt; });
      s.bub = s.bub.filter(b => b.t < 0.6);
      if (s.spots.every(sp => sp.life <= 0)) this.spawn(s);
      if (s.timer <= 0) this.done(s);
    },
    tap() { }, // the brush follows the cursor
    done(s) {
      const ck = s.cleared >= 14 ? 4 : s.cleared >= 8 ? 2 : 0;
      finishGame(s.cleared + ' SCRUBBED', Math.min(14, s.cleared), ck, ['A GRATEFUL MANATEE: +$' + Math.min(14, s.cleared)]);
    },
    draw(s) {
      const wy = stageNight('#123038');
      const cx = 240, cy = STAGE.y + 96;
      // god-ray shafts from the surface + caustics over the body
      godRay(140, STAGE.y, STAGE.y + 120, 4, 30, -30, '#cfe8f0', 0.05);
      godRay(300, STAGE.y, STAGE.y + 120, 4, 30, -30, '#cfe8f0', 0.05);
      caustics(cx - 70, cy - 24, 150, 50, '#7fb8c8', 0.14);
      for (let k = 0; k < 6; k++) { const sx = STAGE.x + 40 + k * 60; ctx.save(); ctx.globalAlpha = 0.07; rr(sx + Math.sin(tNow * 1.5 + k) * 4, wy - 20 - (tNow * 8 + k * 20) % 40, 10, 8, 4, '#cfe8f0'); ctx.restore(); }
      const clean = s ? clamp(s.cleared / 18, 0, 1) : 0;
      // the manatee, lolling at the surface: textured hide, open bead eyes
      const MH = ['#1e262c', '#56636c', '#76858e', '#97a6ae', '#c4d2d8'];
      ctx.save(); ctx.globalAlpha = 0.3; rr(cx - 80, cy + 22, 170, 8, 4, '#02080c'); ctx.restore();
      plasticBox(cx + 56, cy - 10, 28, 24, 10, MH, { seed: 3 });                               // paddle tail
      rect(cx + 60, cy - 2, 20, 1, MH[1]); rect(cx + 62, cy + 4, 16, 1, MH[1]);
      plasticBox(cx - 68, cy - 26, 134, 52, 22, MH, { seed: 7 });                               // body
      for (let i = 0; i < 4; i++) rect(cx - 36 + i * 22, cy - 18 + (i % 2), 12, 1, MH[1]);      // back wrinkles
      for (let i = 0; i < 3; i++) rect(cx - 30 + i * 26, cy - 10 + (i % 2) * 2, 9, 1, MH[1]);
      [[cx - 20, cy - 8], [cx + 24, cy - 4], [cx + 6, cy - 16]].forEach(([bxp, byp]) => { fillCircle(bxp, byp, 2, '#c8c2b2'); rect(bxp - 1, byp - 1, 1, 1, '#f0ece0'); rect(bxp, byp, 1, 1, '#8a8478'); });   // barnacles
      plasticBox(cx - 44, cy + 12, 16, 14, 6, MH, { noShine: 1, seed: 1 }); plasticBox(cx + 20, cy + 12, 16, 14, 6, MH, { noShine: 1, seed: 2 });   // flippers
      plasticBox(cx - 84, cy - 12, 26, 26, 10, MH, { seed: 5 });                               // the big soft snout
      rr(cx - 82, cy + 1, 20, 10, 4, MH[3]); rect(cx - 80, cy + 2, 14, 1, MH[4]);
      for (let k = 0; k < 6; k++) rect(cx - 80 + (k % 3) * 5, cy + 4 + ((k / 3) | 0) * 3, 1, 1, MH[1]);   // whisker pores
      ctx.save(); ctx.globalAlpha = 0.5; [[-1, 0], [1, 1]].forEach(([s2, j]) => { pxLine(cx - 72 + s2 * 12, cy + 5 + j, cx - 72 + s2 * 20, cy + 3 + j * 3, '#e0e8ec'); }); ctx.restore();
      if (clean > 0) { ctx.save(); ctx.globalAlpha = clean * 0.35; dither(cx - 60, cy - 20, 120, 20, MH[3], MH[4], (tNow * 2 | 0)); ctx.restore(); }
      // eyes stay open - happiness shows in the sparkle, the blush and the grin
      [[cx - 77, 0], [cx - 67, 1]].forEach(([ex]) => {
        const lx = clamp(Math.round((mx - ex) / 80), -1, 1);
        rr(ex - 1, cy - 7, 4, 5, 1, '#120b05'); rect(ex + lx, cy - 6, 1, 1, '#ffffff');
        if (clean > 0.6) rect(ex + 2, cy - 4, 1, 1, '#ffffff');
      });
      rect(cx - 79, cy - 10, 5, 1, MH[0]); rect(cx - 69, cy - 10, 5, 1, MH[0]);
      ctx.save(); ctx.globalAlpha = clean * 0.7; rect(cx - 83, cy - 1, 4 + Math.round(clean * 2), 2, '#f0a0b0'); rect(cx - 64, cy - 1, 3 + Math.round(clean * 2), 2, '#f0a0b0'); ctx.restore();
      const sm = Math.round(clean * 2);
      rect(cx - 76, cy + 8, 8, 1, MH[0]); rect(cx - 77, cy + 7 - sm, 1, 1 + sm, MH[0]); rect(cx - 68, cy + 7 - sm, 1, 1 + sm, MH[0]);
      if (clean > 0.85) for (let k = 0; k < 3; k++) sparkle(cx - 90 + k * 30, cy - 30 + (k % 2) * 6, '#ffffff', 5, k * 2);
      // the spring water laps over its lower half
      ctx.save(); ctx.globalAlpha = 0.42; rect(STAGE.x, wy + 4, STAGE.w, STAGE.y + STAGE.h - wy - 4, '#0e3a44'); ctx.restore();
      for (let k = 0; k < 7; k++) { const rx = cx - 90 + k * 26 + Math.sin(tNow * 1.4 + k) * 3; rect(rx, wy + 3 + (k % 2), 14, 1, '#7ab8c4'); }
      if (s) {
        s.spots.forEach(sp => { if (sp.life <= 0) return; ctx.save(); ctx.globalAlpha = 0.35 + sp.life * 0.55; fillCircle(sp.x, sp.y, sp.r + 1, '#264a1c'); fillCircle(sp.x, sp.y, sp.r, '#5aa03a'); rect(sp.x - 1, sp.y - 1, 1, 1, '#a8e878'); ctx.restore(); });
        s.bub.forEach(b => { const wob = Math.sin(b.t * 8) * 0.5; ctx.save(); ctx.globalAlpha = 1 - b.t / 0.6; fillCircle(b.x + wob, b.y, 2, '#cfe8f0'); rect(b.x + wob - 1, b.y - 1, 1, 1, '#ffffff'); ctx.restore(); });
        const bx = s.brush ? s.brush.x : mx, by = s.brush ? s.brush.y : my;
        // soap suds cluster following the brush
        for (let i = 0; i < 5; i++) { const a = i / 5 * 6.28 + tNow * 2, r = 5 + Math.sin(tNow * 4 + i) * 2; ctx.save(); ctx.globalAlpha = 0.6; fillCircle(bx + Math.cos(a) * r, by + Math.sin(a) * r, 2, '#f0f4ff'); ctx.restore(); }
        // rim-lit brush with soapy tips
        rr(bx - 8, by - 5, 16, 5, 2, '#8a5a2a'); rect(bx - 8, by - 5, 16, 1, '#a87038');
        for (let k = 0; k < 5; k++) { rect(bx - 6 + k * 3, by, 2, 5, '#e8e4d0'); rect(bx - 6 + k * 3, by + 4, 2, 1, '#f0f4ff'); }
      }
    },
    hud: s => 'TIME: ' + Math.max(0, s.timer).toFixed(1) + 's   SCRUBBED: ' + s.cleared,
  },
};
function addRippleThrottle(s, x, y) { s._rp = (s._rp || 0) - 0.016; if (s._rp <= 0) { s._rp = 0.3; addRipple(x, y, false); } }

function drawEvent(dt) {
  const th = themeNow();
  drawSceneBack(th);
  drawSceneFront(th);
  overlayDim(0.62);
  const ev = G.event; if (!ev) return;
  const def = MINIGAMES[ev.game], game = GAMES[ev.game];
  ev.t += dt;

  drawTextCSh('SWAMP EVENT: ' + def.name, W / 2, 6, C.gold, 2);
  // the stage
  goldFrame(STAGE.x - 5, STAGE.y - 5, STAGE.w + 10, STAGE.h + 10, { field: '#0a1215', fieldD: '#0a1215', fieldL: '#0a1215', flat: 1, thin: 1 });
  ctx.save();
  ctx.beginPath(); ctx.rect(STAGE.x, STAGE.y, STAGE.w, STAGE.h); ctx.clip();
  game.draw(ev.phase === 'intro' ? null : ev.s);
  ctx.restore();

  if (ev.phase === 'intro') {
    // game "poster": a big park-badge emblem over the previewed stage
    const cxp = W / 2, cyp = STAGE.y + 54;
    fillCircle(cxp, cyp + 2, 30, '#00000088');
    fillCircle(cxp, cyp, 29, '#c8a040');
    fillCircle(cxp, cyp, 26, '#2a3a30');
    fillCircle(cxp, cyp - 1, 24, '#33463a');
    for (let a = 0; a < 10; a++) { const an = a / 10 * Math.PI * 2; rect(cxp + Math.cos(an) * 26 - 1, cyp + Math.sin(an) * 26 - 1, 1, 1, '#00000055'); }
    if (def.icon) { ctx.save(); ctx.translate(cxp - 18, cyp - 18); ctx.scale(3, 3); (ICONS[def.icon] || ICONS.star)(0, 0); ctx.restore(); }
    drawTextCSh(def.name, cxp, cyp + 34, C.gold, 2, '#2a1a0c');
    def.how.forEach((ln, i) => drawTextCSh(ln, W / 2, 200 + i * 11, i ? C.dim : C.white, 1));
    button(W / 2 - 55, 228, 110, 24, 'START >', '#d94f30', '#8a2a16', () => {
      ev.phase = 'play'; ev.s = {}; game.init(ev.s);
      hardenEvent(ev.game, ev.s); // events run a lot tighter now
      sfx.whoosh();
    }, { id: 'evstart' });
  } else if (ev.phase === 'play') {
    game.update(ev.s, dt);
    if (G.event !== ev || ev.phase !== 'play') return; // game may have just finished
    drawTextCSh(game.hud(ev.s), W / 2, 200, C.white, 1);
    if (ev.s.msg && ev.s.msgT > 0) drawTextCSh(ev.s.msg, W / 2, 214, ev.s.msg.includes('!') ? C.gold : '#ffb0a8', 1);
    hit(STAGE.x, STAGE.y, STAGE.w, STAGE.h, { id: 'evtap', cb: () => game.tap(ev.s), cursor: true });
  } else {
    // results card
    const pop = easeOut(clamp(ev.t / 0.3, 0, 1));
    ctx.save(); ctx.globalAlpha = pop;
    panel(W / 2 - 100, 196 - 8 * pop, 200, 66, { face: '#16222af8', edge: C.gold });
    drawTextCSh(ev.grade, W / 2, 198, C.gold, 2);
    let ly = 216;
    ev.lines.forEach(l => { drawTextC(l, W / 2, ly, C.white, 1); ly += 10; });
    drawTextC('+' + (3 + ev.cookies) + ' SCOUT COOKIES', W / 2, ly, C.green, 1);
    ctx.restore();
    button(W / 2 + 110, 218, 66, 24, 'TAKE IT', '#e8a020', '#98650e', collectEvent, { id: 'evgo' });
  }
}
function drawWrappedC(txt, cx, y, w, col) {
  const words = ('' + txt).split(' ');
  const lines = []; let line = '';
  const maxChars = Math.floor(w / 5);
  words.forEach(word => {
    if ((line + ' ' + word).trim().length > maxChars) { lines.push(line.trim()); line = word; }
    else line = line + ' ' + word;
  });
  if (line.trim()) lines.push(line.trim());
  lines.forEach((l, i) => drawTextC(l, cx, y + i * 10, col, 1));
  return y + lines.length * 10;
}

// ------------------------------------------------------------ deck view ---
function drawDeckOverlay() {
  overlayDim(0.6);
  hit(0, 0, W, H, { cb: () => { G.deckOpen = false; }, id: 'deckblock' });
  const px = 100, py = 30, pw = 280, ph = 210;
  panel(px, py, pw, ph, { face: '#16222af5' });
  drawTextCSh('YOUR TOOTH DECK (' + G.deck.length + ')', px + pw / 2, py + 8, C.gold, 2);
  const plain = {};
  const spec = {};
  G.deck.forEach(t => {
    if (t.type === 'plain') plain[t.base] = (plain[t.base] || 0) + 1;
    else spec[t.type] = (spec[t.type] || 0) + 1;
  });
  const x1 = px + 14, x2 = px + pw / 2 + 8;
  let y = py + 30;
  drawText('PLAIN TEETH:', x1, y, C.dim, 1);
  const vals = Object.keys(plain).map(Number).sort((a, b) => a - b);
  let yy = y + 12, col = 0;
  const colMax = py + ph - 42;
  vals.forEach(v => {
    if (yy > colMax) { col = 1; yy = y + 12; }
    drawText('VALUE ' + v + '  X' + plain[v], (col ? x1 + 62 : x1) + 8, yy, C.white, 1);
    yy += 10;
  });
  const specKeys = Object.keys(spec);
  if (specKeys.length) {
    drawText('SPECIAL TEETH:', x2, y, C.dim, 1);
    let sy = y + 12;
    specKeys.forEach(k => {
      if (sy > colMax) return;
      drawTooth(x2 + 4, sy - 3, 9, 11, true, k, {});
      drawText(TOOTH_DEFS[k].name.replace(' TOOTH', '').replace(' FANG', '') + ' X' + spec[k], x2 + 18, sy, C.white, 1);
      sy += 12;
    });
  }
  drawTextC(G.drawPile.length + ' STILL IN THE BAG THIS ROUND', px + pw / 2, py + ph - 30, C.dim, 1);
  button(px + pw / 2 - 40, py + ph - 20, 80, 14, 'CLOSE', '#3a5560', '#243a44', () => { G.deckOpen = false; }, { id: 'deckclose' });
}

// ------------------------------------------------------- inspect modal ----
function drawInspect() {
  const ins = G.inspect; if (!ins) return;
  overlayDim(0.7);
  hit(0, 0, W, H, { cb: () => { G.inspect = null; }, id: 'inspectblock' });
  const px = 90, py = 55, pw = 300, ph = 160;
  panel(px, py, pw, ph, { face: '#16222af8', edge: C.gold });

  let def, kind, price, isShop = false, toothType = null;
  if (ins.kind === 'shop') {
    isShop = true;
    def = ins.item.def; kind = ins.item.kind; price = ins.item.price; toothType = ins.item.type;
  } else { def = ins.def; kind = ins.kind; }

  // left: big rendered card (2x)
  ctx.save();
  ctx.translate(px + 18, py + 24);
  ctx.scale(2, 2);
  if (kind === 'tooth') drawTooth(4, 4, 22, 32, true, toothType, {});
  else drawCardFace(0, 0, def, kind, {});
  ctx.restore();

  // right: details
  const tx = px + 92;
  drawText(def.name, tx, py + 12, C.gold, 2);
  let sub;
  if (kind === 'charm') sub = 'PARK BADGE  -  ' + RAR_NAME[def.rar || 0];
  else if (kind === 'tool' || def.picks) sub = 'DENTIST TOOL  -  WORKS ON YOUR DECK';
  else if (kind === 'cons') sub = 'CARD  -  ONE-TIME USE';
  else sub = 'SPECIAL TOOTH  -  JOINS YOUR DECK';
  drawText(sub, tx, py + 26, def.picks ? '#7fd0c0' : kind === 'cons' ? C.purple : RAR_COL[def.rar || 0], 1);
  let y = py + 40;
  y = drawSmallWrapped(def.desc, tx, y, pw - 110, C.white) + 4;
  // edition finish line (golden / diamond / rusty), highlighted in its colour
  if (kind === 'charm' && def.ed && EDITIONS[def.ed]) {
    const e = EDITIONS[def.ed];
    y = drawSmallWrapped(e.name + ' EDITION: ' + e.desc, tx, y, pw - 110, e.col) + 4;
  }
  if (def.flav) y = drawSmallWrapped("'" + def.flav + "'", tx, y, pw - 110, '#6f8a90') + 6;

  if (isShop) {
    const afford = G.money >= price;
    button(tx, py + ph - 34, 90, 22, 'BUY  $' + price, '#e8a020', '#98650e',
      () => { buyItem(ins.item); if (ins.item.sold) G.inspect = null; },
      { id: 'inspectbuy', disabled: !afford, tip: afford ? null : 'Not enough money' });
  } else if (kind === 'charm') {
    if (G.state === 'shop') {
      button(tx, py + ph - 34, 100, 22, 'SELL  $' + Math.ceil(def.cost / 2), '#7a4fd0', '#4a2a8a',
        () => { sellCharm(ins.idx); G.inspect = null; }, { id: 'inspectsell' });
    } else {
      drawText('SELL IN THE SHOP FOR $' + Math.ceil(def.cost / 2), tx, py + ph - 24, C.dim, 1);
    }
  } else if (def.picks) {
    drawText('DRAG OUT OF THE SLOT AT THE SHOP', tx, py + ph - 32, C.green, 1);
    drawText('OR ON THE TRAIL TO OPEN THE BENCH', tx, py + ph - 23, C.green, 1);
  } else if (kind === 'cons') {
    drawText(def.target === 'tooth' ? 'DRAG ONTO A TOOTH TO USE' : 'DRAG ONTO THE GATOR TO USE', tx, py + ph - 24, C.green, 1);
  }
  drawTextC('CLICK ANYWHERE TO CLOSE', px + pw / 2, py + ph - 10, '#54707a', 1);
}

// ------------------------------------------------------------ toasts ------
function drawToasts(dt) {
  toasts.forEach(t => t.t += dt);
  toasts = toasts.filter(t => t.t < 2.6);
  toasts.slice(0, 2).forEach((t, i) => { // at most two quiet cards, gone quickly
    const slide = t.t < 0.3 ? easeOut(t.t / 0.3) : t.t > 2.2 ? 1 - easeIn((t.t - 2.2) / 0.4) : 1;
    const y = -30 + slide * 34 + i * 30;
    const g = GLOVES[t.glove];
    const sub = t.sub || (g ? 'UNLOCKED: ' + g.name : null);
    const w2 = Math.max(150, textW(t.name, 1) + 30, sub ? textW(sub, 1) + 30 : 0);
    panel(W / 2 - w2 / 2, y, w2, sub ? 26 : 17, { face: '#26321ef2', edge: C.gold });
    drawText(t.name, W / 2 - w2 / 2 + 8, y + 5, C.gold, 1);
    if (sub) drawText(sub, W / 2 - w2 / 2 + 8, y + 15, C.white, 1);
    if (g) ICONS.glove(W / 2 + w2 / 2 - 18, y + 7, g.skin);
  });
}

// ------------------------------------------------------------ tooltip -----
function drawTooltip() {
  if (G.drag) return; // no tooltips while dragging
  const h = topHitAt(mx, my);
  if (h && h.id !== hotId) { hotId = h.id; if (h.cursor) sfx.hover(); }
  if (!h) hotId = null;
  if (!h || !h.tip) return;
  const lines = h.tip.split('|').filter(s => s.length);
  const wmax = Math.max(...lines.map(l => textW(l, 1))) + 12;
  const hh = lines.length * 9 + 8;
  let tx = clamp(mx + 10, 2, W - wmax - 2), ty = clamp(my + 14, 2, H - hh - 2);
  panel(tx, ty, wmax, hh, { face: '#10181cf5', edge: '#5d7a86' });
  lines.forEach((l, i) => {
    const col = i === 0 ? C.gold : (l.includes('SNAPPER') || l.includes('DEBUFF') || l.includes('BLOCKED') || l.includes('LOCKED') ? '#ff9a90' : C.white);
    drawText(l, tx + 6, ty + 5 + i * 9, col, 1);
  });
}

// ------------------------------------------------------------ the hand ----
function drawHand() {
  if (!mouseSeen) return;
  const gid = gloveUnlocked(meta.glove) ? meta.glove : 'bare';
  const g = GLOVES[gid];
  const press = handPressT > 0 ? 2 : 0;
  const grab = !!G.drag;
  const x = mx, y = my + press;
  const skin = g.skin, shade = g.shade, dark = '#20140c';
  if (grab) {
    // fist gripping the card (card already drawn at drag pos)
    rr(x - 7, y - 2, 16, 13, 3, dark);
    rr(x - 6, y - 1, 14, 11, 3, skin);
    for (let k = 0; k < 4; k++) rect(x - 5 + k * 3, y - 1, 2, 3, shade);
    rect(x + 6, y + 2, 2, 5, shade);
    rr(x - 8, y + 3, 4, 6, 2, skin); // thumb wrapping
    drawGloveDeco(x, y, 0, gid, g, true);
    rr(x - 7, y + 10, 16, 5, 1, dark);
    rr(x - 6, y + 10, 14, 4, 1, g.cuff);
  } else {
    // pointing hand, fingertip at cursor
    const fl = press ? 7 : 9; // finger length
    rr(x - 2, y - 1, 5, fl + 2, 2, dark);
    rr(x - 1, y, 3, fl, 1, skin);
    rect(x, y + 1, 1, 2, '#ffffff88'); // nail shine
    rect(x + 1, y + 2, 1, fl - 3, shade);
    // palm
    rr(x - 5, y + fl - 2, 16, 13, 3, dark);
    rr(x - 4, y + fl - 1, 14, 11, 3, skin);
    // folded fingers
    for (let k = 0; k < 3; k++) {
      rect(x + 3 + k * 3, y + fl - 1 + k, 3, 4, shade);
      rect(x + 3 + k * 3, y + fl + 3 + k, 3, 1, dark);
    }
    // thumb
    rr(x - 7, y + fl + 2, 5, 7, 2, dark);
    rr(x - 6, y + fl + 3, 4, 5, 2, skin);
    // knuckle crease
    rect(x - 2, y + fl + 6, 6, 1, shade);
    // signature glove sprite treatment (per-id, pat fallback)
    drawGloveDeco(x, y, fl, gid, g, false);
    // cuff
    rr(x - 5, y + fl + 9, 16, 5, 1, dark);
    rr(x - 4, y + fl + 9, 14, 4, 1, g.cuff);
    rect(x - 4, y + fl + 9, 14, 1, '#ffffff44');
  }
  // the hat is worn on the ranger sprite (drawBobble), not the hand
  // signature per-frame cosmetic effects for the glove (sparkles, glow, embers)
  drawCosmeticFx(x, y, grab);
}

// ------------------------------------------------------------ fx update ---
function updateFx(dt) {
  floats = floats.filter(f => (f.t += dt) < f.life);
  parts = parts.filter(p => {
    p.t += dt;
    p.vy += p.g * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    return p.t < p.life;
  });
  shake = Math.max(0, shake - dt * 22);
  flashRed = Math.max(0, flashRed - dt);
  handPressT = Math.max(0, handPressT - dt);
  G.scorePulse = Math.max(0, (G.scorePulse || 0) - dt);
  flyers = flyers.filter(f => (f.t += dt * 2) < 1);
  if (G.pool) G.dispScore = lerp(G.dispScore, G.score, 1 - Math.pow(0.002, dt));
  else G.dispScore = G.score;
  G.mouth.forEach(s => { if (s.pop > 0) s.pop -= dt; });
  if (G.xanim) { G.xanim.t += dt; if (G.xanim.t > 0.55) G.xanim = null; }
}
function drawFx() {
  // bought cards flying to their slots
  flyers.forEach(f => {
    const k = easeOut(f.t);
    const x = lerp(f.x, f.tx, k), y = lerp(f.y, f.ty, k);
    if (f.tooth) { drawTooth(x - 5, y - 7, 11, 14, true, f.tooth, {}); }
    else {
      rr(x - 8, y - 11, 16, 22, 2, f.col);
      rr(x - 7, y - 10, 14, 20, 2, '#232f3a');
      (ICONS[f.ico] || ICONS.star)(x - 6, y - 7);
    }
  });
  parts.forEach(p => {
    const k = clamp(1 - p.t / p.life, 0, 1);
    ctx.globalAlpha = k;
    if (p.kind === 'star') {                       // chunky 4-point spinner
      const s = p.sz * (0.6 + k * 0.6), a = (p.spin || 0) * p.t;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(a);
      rect(-s, -1, s * 2, 2, p.col); rect(-1, -s, 2, s * 2, p.col);
      rect(-1, -1, 2, 2, '#ffffff');
      ctx.restore();
    } else if (p.kind === 'ring') {                // popping impact ring
      const r = lerp(p.r0, p.r1, 1 - k);
      ctx.save(); ctx.globalAlpha = k * 0.85;
      for (let a = 0; a < 12; a++) { const an = a / 12 * Math.PI * 2; rect(p.x + Math.cos(an) * r - 1, p.y + Math.sin(an) * r - 1, 2, 2, p.col); }
      ctx.restore();
    } else if (p.kind === 'puff') {                // soft expanding dust
      const r = p.sz * (1.4 - k * 0.5);
      ctx.save(); ctx.globalAlpha = k * 0.55;
      fillCircle(p.x, p.y, r, p.col); fillCircle(p.x - r * 0.3, p.y - r * 0.3, r * 0.5, '#ffffff44');
      ctx.restore();
    } else if (p.kind === 'ribbon') {              // tumbling confetti
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate((p.spin || 0) * p.t);
      rect(-p.sz, -1, p.sz * 2, 2, p.col);
      ctx.restore();
    } else if (p.kind === 'line') {                // cartoon speed line
      const dx = Math.cos(p.ang) * p.sz, dy = Math.sin(p.ang) * p.sz;
      ctx.save(); ctx.globalAlpha = k * 0.8;
      for (let s = 0; s < 3; s++) rect(p.x + dx * s / 3, p.y + dy * s / 3, 2, 1, p.col);
      ctx.restore();
    } else rect(p.x, p.y, p.sz, p.sz, p.col);
  });
  ctx.globalAlpha = 1;
  floats.forEach(f => {
    const k = f.t / f.life;
    ctx.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
    drawTextCSh(f.txt, f.x, f.y - easeOut(k) * 24, f.col, f.sc);
  });
  ctx.globalAlpha = 1;
}

// ------------------------------------------------------------ main loop ---
let tNow = 0, tLast = 0;
function frame(ms) {
  requestAnimationFrame(frame);
  const t = ms / 1000;
  let dt = Math.min(0.05, t - tLast);
  tLast = t;
  if (G.paused) dt = 0; // the world freezes
  tNow += dt;

  // base supersample transform: everything below draws in logical 480x270 space
  ctx.setTransform(RS, 0, 0, RS, 0, 0);

  hits = [];
  updateFx(dt);
  updateScene(dt);
  updateBenchFx(dt);
  if (G.state === 'snap') updateSnap(dt); else shardsDone = false;
  if (G.summer && G.state === 'play') updateCrabs(dt);
  if (G.photoT > 0) G.photoT = Math.max(0, G.photoT - dt);
  if (G.state === 'play') updateSeq(dt);
  if (G.chipPulse > 0) G.chipPulse = Math.max(0, G.chipPulse - dt);
  for (const k in charmPop) if (charmPop[k] > 0) charmPop[k] -= dt;
  if (G.state === 'swap') {
    G.swapT += dt;
    if (G.swapT > 0.45) { newMouth(); G.state = 'play'; }
  }
  musicTick();

  ctx.save();
  if (shake > 0 && meta.set.shake) ctx.translate(ri(-shake, shake) / 2, ri(-shake, shake) / 2);

  if (G.state === 'map') updateBoat(dt);
  switch (G.state) {
    case 'menu': drawMenu(dt); break;
    case 'how': drawHow(); break;
    case 'skins': drawSkins(); break;
    case 'tutorial': drawTutorial(dt); break;
    case 'ranger': drawRangerSelect(); break;
    case 'intro': drawIntro(dt); break;
    case 'pass': drawPassScreen(dt); break;
    case 'map': drawMap(); break;
    case 'event': drawEvent(dt); break;
    case 'bench': drawBench(); break;
    case 'play': drawPlay(); break;
    case 'swap': drawSwap(); break;
    case 'snap': drawSnap(); break;
    case 'roundend': drawRoundEnd(); break;
    case 'shop': drawShop(); break;
    case 'bosscut': drawBossCut(dt); break;
    case 'bossintro': drawBossIntro(); break;
    case 'index': drawIndex(); break;
    case 'gameover': drawGameOver(); break;
    case 'win': drawWin(); break;
  }

  if (G.deckOpen && (G.state === 'play' || G.state === 'shop' || G.state === 'swap')) drawDeckOverlay();
  if (G.inspect) drawInspect();
  if (G.pack) drawPackOpen(dt);

  drawFx();
  ctx.restore();

  if (flashRed > 0) { ctx.globalAlpha = flashRed * 1.4; rect(0, 0, W, H, '#a01818'); ctx.globalAlpha = 1; }

  // CRT-ish scanlines + vignette (toggleable)
  if (meta.set.crt) {
    ctx.globalAlpha = 0.06;
    for (let y = 0; y < H; y += 3) rect(0, y, W, 1, '#000');
    ctx.globalAlpha = 1;
  }
  // soft corner vignette: eight stepped bands that pull the eye to the middle
  ctx.save();
  for (let k = 0; k < 9; k++) {
    ctx.globalAlpha = 0.05 - k * 0.005;
    if (ctx.globalAlpha <= 0) break;
    rect(0, 0, W, 2 + k * 2, '#000'); rect(0, H - 2 - k * 2, W, 2 + k * 2, '#000');
    rect(0, 0, 2 + k * 3, H, '#000'); rect(W - 2 - k * 3, 0, 2 + k * 3, H, '#000');
  }
  ctx.restore();
  rect(0, 0, W, 2, '#000000aa'); rect(0, H - 2, W, 2, '#000000aa');
  rect(0, 0, 2, H, '#000000aa'); rect(W - 2, 0, 2, H, '#000000aa');

  // pause + overlays swallow all other input
  if (G.paused || G.overlay) {
    hits.length = 0;
    if (G.overlay === 'settings') drawSettingsOverlay();
    else if (G.overlay === 'credits') drawCreditsOverlay();
    else drawPauseOverlay();
  }

  // Merle's ability briefing rides above the fight, but nowhere else
  if (G.state === 'play' || G.state === 'swap') drawMerleTalk(dt);
  else if (G.state !== 'snap' && G.state !== 'bosscut' && G.state !== 'bossintro') merle = null;
  drawToasts(dt);
  drawTooltip();
  drawDraggedCard();
  drawHand();
  drawTransition(dt);
}
requestAnimationFrame(frame);

// -------------------------------------------- pause, settings, credits ----
function togglePause() {
  if (G.overlay) { G.overlay = null; return; }
  if (G.state === 'menu' || G.state === 'how' || G.state === 'skins' || G.state === 'index' || G.state === 'tutorial' || G.state === 'ranger' || G.state === 'pass') return;
  G.paused = !G.paused;
  sfx.pause();
}
function drawPauseOverlay() {
  overlayDim(0.7);
  panel(W / 2 - 70, 60, 140, 140, { face: '#16222af5', edge: C.gold });
  drawTextCSh('PAUSED', W / 2, 70, C.gold, 2);
  button(W / 2 - 50, 92, 100, 20, 'RESUME', '#d94f30', '#8a2a16', () => { G.paused = false; }, { id: 'presume' });
  button(W / 2 - 50, 116, 100, 20, 'SETTINGS', '#3a5560', '#243a44', () => { G.overlay = 'settings'; }, { id: 'pset' });
  button(W / 2 - 50, 140, 100, 20, 'CREDITS', '#3a5560', '#243a44', () => { G.overlay = 'credits'; }, { id: 'pcred' });
  button(W / 2 - 50, 164, 100, 20, 'QUIT TO MENU', '#7a4fd0', '#4a2a8a', () => { G.paused = false; G.state = 'menu'; }, { id: 'pquit' });
}
function drawSettingsOverlay() {
  overlayDim(0.7);
  panel(W / 2 - 95, 52, 190, 156, { face: '#16222af5', edge: C.gold });
  drawTextCSh('SETTINGS', W / 2, 62, C.gold, 2);
  const rows = [
    ['MUSIC', 'mus', ['OFF', 'LOW', 'FULL']],
    ['SOUND FX', 'sfx', ['OFF', 'LOW', 'FULL']],
    ['SCREEN SHAKE', 'shake', ['OFF', 'ON']],
    ['CRT SCANLINES', 'crt', ['OFF', 'ON']],
  ];
  rows.forEach(([label, key, opts], i) => {
    const y = 86 + i * 22;
    drawText(label, W / 2 - 82, y + 3, C.white, 1);
    button(W / 2 + 18, y, 60, 14, opts[meta.set[key]], '#3a5560', '#243a44', () => {
      meta.set[key] = (meta.set[key] + 1) % opts.length;
      saveMeta();
      sfx.pin();
    }, { id: 'set' + key });
  });
  button(W / 2 - 40, 182, 80, 18, '< BACK', '#d94f30', '#8a2a16', () => { G.overlay = null; }, { id: 'setback' });
}
function drawCreditsOverlay() {
  overlayDim(0.75);
  panel(W / 2 - 110, 52, 220, 128, { face: '#16222af5', edge: C.gold });
  drawTextCSh('BITE DOWN', W / 2, 64, C.gold, 2);
  const L = [
    ['A PUSH-YOUR-LUCK DENTAL ROGUELIKE', C.white],
    ['VERSION 1.0', C.dim],
    ['', 0],
    ['MADE BY', C.dim],
    ['PUKKING DRAGON', C.gold],
  ];
  let y = 86;
  L.forEach(([t, c]) => { if (t) drawTextC(t, W / 2, y, c, 1); y += 11; });
  const itchBtn = () => {
    if (!meta.itchFollow) {
      meta.itchFollow = true;
      meta.rp = (meta.rp || 0) + 200;
      saveMeta();
      sfx.coin();
      addToast('+200 COOKIES', '#63d66a', 60);
    }
    window.open('https://pukking-dragon.itch.io/bite-down', '_blank');
  };
  button(W / 2 - 60, 146, 120, 14, 'FOLLOW ON ITCH +200', '#8a4fd0', '#5a2a8a', itchBtn, { id: 'itchbtn', tip: 'Follow BITE DOWN on itch.io|+200 scout cookies, one time' });
  button(W / 2 - 40, 164, 80, 14, '< BACK', '#d94f30', '#8a2a16', () => { G.overlay = null; }, { id: 'credback' });
}

// pixel iris wipe between screens
function drawTransition(dt) {
  if (!trans) return;
  trans.t += dt;
  const T = trans.t;
  if (!trans.fired && T >= 0.3) { trans.fired = true; if (trans.cb) trans.cb(); }
  if (T >= 0.6) { trans = null; return; }
  const k = T < 0.3 ? 1 - T / 0.3 : (T - 0.3) / 0.3;
  const R = Math.ceil(Math.hypot(W / 2, H / 2) * easeOut(k));
  ctx.fillStyle = '#04080a';
  for (let y = 0; y < H; y += 2) {
    const dy = y - H / 2;
    const q = R * R - dy * dy;
    const hw = q > 0 ? Math.floor(Math.sqrt(q)) : 0;
    ctx.fillRect(0, y, W / 2 - hw, 2);
    ctx.fillRect(W / 2 + hw, y, W / 2 - hw + 1, 2);
  }
}

// menu needs a mouth for the gator preview
(function menuMouth() {
  G.mouth = [];
  for (let i = 0; i < 10; i++) G.mouth.push({ t: mkTooth('plain', ri(1, 5)), snap: false, pressed: false, revealed: null, gone: false, pop: 0 });
  G.pool = null;
  G.deck = G.mouth.map(s => s.t);
  G.drawPile = [];
})();

// ------------------------------------------------------------ debug hook --
window.BD = {
  G,
  press: pressTooth,
  bank: () => bank(false),
  xray: toggleXrayMode,
  newRun,
  useCons,
  buy: i => buyItem(G.shopItems[i]),
  next: nextRound,
  cashOut,
  meta,
  unlock,
  addRP,
  quest,
  pick: pickNode,
  continueEvent: closeEvent,
  collectEvent,
  openBench, benchToggle, benchApply, benchCancel,
  buyPack: i => buyPack(G.shopPacks[i]),
  pickPack,
};

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
const ctx = canvas.getContext('2d');
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
  for (let r = 1; r <= 20; r++) {
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
// ======================= PLASTIC TOY SHADING ==============================
//  The whole game is moulded from the same shiny plastic: a flat base colour,
//  one face turned away from the light, one turned toward it, and a single
//  hard specular blob.  No gradients, no dithering, no surface texture - the
//  silhouette and the gloss do all the work.
//  Every ramp is [outline, shade, base, light, shine].
// ==========================================================================
function plasticBox(x, y, w, h, r, ramp, o) {
  o = o || {};
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  if (w < 2 || h < 2) return;
  const ri = Math.max(1, r - 1);
  rr(x, y, w, h, r, ramp[0]);                                   // moulded edge
  rr(x + 1, y + 1, w - 2, h - 2, ri, ramp[2]);                  // ONE body colour
  if (!o.flat && h > 5) rect(x + 2, y + h - 3, w - 4, 2, ramp[1]);   // one shade strip
  if (!o.noShine && w > 7 && h > 7) {
    const sw = Math.max(2, Math.round(w * 0.2)), sh = Math.max(2, Math.round(h * 0.14));
    rr(x + 3, y + 3, sw, sh, 1, ramp[4]);                        // one hard highlight
  }
}
function plasticRound(cx, cy, rad, ramp, o) {
  o = o || {};
  cx = Math.round(cx); cy = Math.round(cy);
  fillCircle(cx, cy, rad, ramp[0]);
  fillCircle(cx, cy, rad - 1, ramp[1]);
  fillCircle(cx, cy - 1, rad - 2, ramp[2]);
  if (!o.flat && rad > 4) fillCircle(cx - 1, cy - 2, Math.max(1, rad - 4), ramp[3]);
  if (!o.noShine && rad > 3) rect(cx - rad + 2, cy - rad + 2, 2, 2, ramp[4]);
}
// a hard gloss sweep across a panel, the cheap plastic "sheen"
function plasticGloss(x, y, w, h, a) {
  ctx.save(); ctx.globalAlpha = a === undefined ? 0.16 : a;
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  for (let k = 0; k < h; k++) rect(x + Math.round(w * 0.18) + k * 0.7, y + k, Math.max(2, Math.round(w * 0.14)), 1, '#ffffff');
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
  if (!o.flat) {                                        // one flat lit face, plastic style
    rr(x + b + 1, y + b + 1, w - b * 2 - 2, Math.max(2, (h - b * 2) >> 2), Math.max(1, r - 2), FL);
    rect(x + b + 1, y + h - b - 3, w - b * 2 - 2, 2, FD);
  }
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
  rr(x + 2, y + 2, w - 4, Math.max(1, (h - 4) >> 1), Math.max(1, r - 1), g[3]);
  rect(x + 3, y + 2, w - 6, 1, g[4]);
  rect(x + 2, y + h - 3, w - 4, 1, g[1]);
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
function glow(cx, cy, r, col, a) {
  const n = r > 30 ? 10 : 6;                 // more rings on big blooms, so no hard rim
  ctx.save();
  for (let k = n; k >= 1; k--) {
    const f = k / n;
    ctx.globalAlpha = (a === undefined ? 0.12 : a) * (1 - f) * 0.7 + 0.01;
    fillCircle(cx, cy, r * f, col);
  }
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
// a big expressive eye that blinks and follows the cursor (like the gator's)
function critterEye(ex, ey, ew, eh, lidCol, sclera, pupilCol, phase) {
  const cx2 = ex + ew / 2, cy2 = ey + eh / 2;
  const r = Math.max(2, Math.round(Math.min(ew, eh) / 2));
  const blink = ((tNow + (phase || 0)) % 4.1) > 3.95;
  if (blink) { rect(cx2 - r - 1, cy2 - 1, r * 2 + 2, 2, '#20140c'); return; }
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
function bobShape(spans, y0, ramp, o) {
  o = o || {};
  const n = spans.length, ox = o.ox || 0;
  let maxw = 0; for (let i = 0; i < n; i++) maxw = Math.max(maxw, spans[i]);
  for (let i = 0; i < n; i++) {
    const hw = spans[i], y = y0 + i, t = i / (n - 1);
    rect(ox - hw - 1, y, hw * 2 + 2, 1, ramp[0]);           // moulded edge
    rect(ox - hw, y, hw * 2, 1, t > 0.62 ? ramp[1] : ramp[2]);
    if (t < 0.5) { const lw = Math.round(hw * 1.15); if (lw > 0) rect(ox - hw, y, Math.min(lw, hw * 2), 1, ramp[3]); }
    if (t > 0.5 && t <= 0.62) rect(ox + hw - Math.round(hw * 0.5), y, Math.round(hw * 0.5), 1, ramp[1]);
  }
  rect(ox - spans[0], y0 - 1, spans[0] * 2, 1, ramp[0]);
  rect(ox - spans[n - 1], y0 + n, spans[n - 1] * 2, 1, ramp[0]);
  if (!o.noShine && maxw > 6) {                               // one hard highlight
    const sy = y0 + Math.round(n * 0.14);
    rr(ox - Math.round(maxw * 0.62), sy, Math.max(2, Math.round(maxw * 0.34)), Math.max(2, Math.round(n * 0.14)), 1, ramp[4]);
  }
}

// ----------------------------------------------------------- the face -----
// Big low-set eyes, a small mouth and soft brows: the baby proportions that
// make a face read as cute rather than odd.
function bobFace(p, expr, phase, look, opt) {
  opt = opt || {};
  const OL = p.sk[0], EX = opt.topeyes ? 8 : 5, EY = opt.topeyes ? -11 : -1;
  const lx = clamp(look.x, -1, 1), ly = clamp(look.y, -1, 1);
  const shake = (expr === 'scared' || expr === 'panic') ? Math.round(Math.sin(tNow * 22 + phase) * 1) : 0;
  const bt = (tNow + phase * 1.7) % 5.2;
  const blink = bt > 4.98 && bt < 5.1;

  // one small moulded bead, one pixel of shine.  That is the whole eye.
  const bead = (ox, r) => {
    const bx = ox + shake + Math.round(lx * 0.8), by2 = EY + Math.round(ly * 0.6);
    fillCircle(bx, by2, r, '#141010');
    rect(bx - r + 1, by2 - r + 1, 1, 1, '#ffffff');
  };
  const shutEye = (ox) => { rect(ox - 3 + shake, EY, 7, 1, OL); };
  const arcEye = (ox) => { rect(ox - 3, EY + 1, 2, 1, OL); rect(ox - 1, EY - 1, 2, 1, OL); rect(ox + 1, EY + 1, 2, 1, OL); };
  const brow = (ox, dy, ang) => { for (let k = 0; k < 5; k++) rect(ox - 2 + k + shake, EY - 6 + dy + Math.round((k - 2) * ang), 1, 1, OL); };

  if (blink && expr !== 'happy' && expr !== 'love') { [-EX, EX].forEach(shutEye); }
  else if (expr === 'happy' || expr === 'love') { [-EX, EX].forEach(arcEye); }
  else if (expr === 'sleepy' || expr === 'smug') { [-EX, EX].forEach(shutEye); }
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
function bobHead(key, expr, phase, look, lean) {
  const p = BOB[key] || BOB.scout, OL = p.sk[0];
  lean = lean || 0;
  const earR = k => [p.sk[0], k[0], k[1], k[2], mixHex(k[2], '#ffffff', 0.45)];
  // ---- ears / stalks BEHIND the skull, all moulded blocks ----
  if (p.otter) {
    [-1, 1].forEach(s2 => {
      const tw = Math.round(Math.sin(tNow * 1.6 + s2 * 2 + phase) * 0.7);
      plasticBox(s2 * 11 - 5, -17 + tw, 10, 9, 3, earR(p.ear));
      rect(s2 * 11 - 2, -14 + tw, 4, 3, p.ear[0]);
    });
  }
  if (key === 'medic') {
    [-1, 1].forEach(s2 => {
      const tw = Math.round(Math.sin(tNow * 1.5 + s2 * 2 + phase) * 0.8);
      plasticBox(s2 * 11 - 6, -18 + tw, 12, 11, 4, [OL, p.sk[1], p.sk[2], p.sk[3], p.sk[4]]);
      plasticBox(s2 * 11 - 3, -15 + tw, 6, 6, 2, [OL, p.ear[0], p.ear[1], p.ear[2], '#ffd8e2'], { noShine: 1 });
    });
  }
  if (key === 'trader') {
    [-1, 1].forEach(s2 => {
      const tw = Math.round(Math.sin(tNow * 1.3 + s2 + phase) * 0.7);
      plasticBox(s2 * 11 - 5, -19 + tw, 11, 10, 3, earR(p.ear));
      rect(s2 * 11 - 2, -16 + tw, 5, 4, p.ear[0]);
    });
  }
  if (key === 'frog') {
    [-1, 1].forEach(s2 => plasticBox(s2 * 9 - 7, -19, 14, 13, 5, [OL, p.sk[1], p.sk[2], p.sk[3], p.sk[4]]));
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
  // ---- the skull: one moulded cube ----
  plasticBox(-13, -14, 26, 24, 5, p.sk);
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
  const btR = [BOOT[0], BOOT[1], BOOT[2], BOOT[3], BOOT[4]];
  [[-5, stride], [4, -stride]].forEach(([lx, s2]) => {
    const lift = act === 'walk' ? Math.max(0, s2) * 0.4 : 0;
    plasticBox(lx - 1, legY - lift, 7, 10, 2, clR, { noShine: 1 });
    plasticBox(lx - 3, -5 + s2 * 0.26 - lift, 10, 6, 2, btR, { noShine: 1 });
  });

  // ---------------- torso: one moulded block ----------------------------
  const by = -29 + hop;
  ctx.save();
  ctx.translate(0, by + 9); ctx.scale(1 / sq, sq); ctx.translate(0, -(by + 9)); ctx.rotate(lean * 0.3);
  plasticBox(-10, by, 21, 18, 5, clR);
  plasticBox(-4, by + 3, 9, 14, 3, ['#0f120e', '#cfc7ab', '#e6dfc6', '#f6f2e2', '#ffffff'], { noShine: 1 });
  rect(-10, by + 12, 21, 3, BOOT[1]);
  rect(-10, by + 12, 21, 1, BOOT[3]);
  plasticBox(-2, by + 11, 6, 5, 1, [UGOLD[0], UGOLD[1], UGOLD[2], UGOLD[3], UGOLD[4]], { noShine: 1 });
  plasticBox(5, by + 3, 5, 5, 1, [OL, p.acD, p.ac, mixHex(p.ac, '#ffffff', 0.4), '#ffffff'], { noShine: 1 });

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
    plasticBox(-3, -2, 6, 10, 2, clR, { noShine: 1 });
    plasticBox(-4, 6, 8, 7, 3, gR, { noShine: 1 });
    ctx.restore();
  });
  ctx.restore(); // squash

  // ---------------- head ------------------------------------------------
  const hy = by - 12;
  ctx.save();
  ctx.translate(0, hy + Math.sin(t * 1.3 + 1.2) * 0.3); ctx.rotate(tilt);
  ctx.save(); ctx.globalAlpha = 0.25; ctx.scale(1, 0.4); fillCircle(0, 14 / 0.4, 9, '#000'); ctx.restore();
  bobHead(key, expr, o.phase || 0, look, tilt);
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
  const bt = (tNow * 0.9 + ph) % 4.6;
  let lid = 0;
  if (bt > 4.3) { const k = (bt - 4.3) / 0.3; lid = k < 0.4 ? k / 0.4 : k < 0.7 ? 1 : Math.max(0, (1 - k) / 0.3); }
  const eye = (ex, r) => {                      // one dark bead, one bright catch
    const dx = Math.round(look.x * 1.2), dy = Math.round(look.y * 1);
    const bx = ex + dx, by2 = -4 + dy;
    fillCircle(bx, by2, r, '#120b05');
    rect(bx - r + 1, by2 - r + 1, 2, 2, '#ffffff');
    rect(bx + r - 2, by2 + r - 2, 1, 1, '#ffffff55');
    const close = expr === 'sleepy' ? 0.55 + lid * 0.45 : lid;
    if (close > 0) {
      const h = Math.round(close * (r * 2 + 2));
      if (h > 0) { rect(bx - r - 1, by2 - r - 1, r * 2 + 2, h, p.sk[2]); rect(bx - r - 1, by2 - r - 1 + h, r * 2 + 2, 1, OL); }
    }
  };
  if (expr === 'happy' || expr === 'proud') {
    [-8, 8].forEach(ex => { rect(ex - 4, -4, 2, 1, OL); rect(ex - 2, -6, 2, 1, OL); rect(ex, -6, 2, 1, OL); rect(ex + 2, -4, 2, 1, OL); });
  } else if (expr === 'wow') { [-7, 7].forEach(ex => eye(ex, 4)); }
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
  ctx.save(); ctx.globalAlpha = 0.55; rr(-12, -13, 10, 5, 2, M[4]); rect(-1, -13, 3, 3, M[4]); ctx.restore();
  plasticBox(-12, -12, 24, 24, 6, ['#12100a', P.dark, P.base, P.lite, P.shine], { noShine: 1 });
  ctx.save(); ctx.globalAlpha = 0.4; rr(-10, -10, 8, 4, 2, P.shine); ctx.restore();
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
};
const HAT_ORDER = ['none', 'straw', 'cap', 'bandana', 'ranger', 'cowboy', 'top', 'wizard', 'crown', 'pirate', 'halo', 'party', 'flame'];
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
  G.map = { stages: [s0, s1, [boss]], stage: 0, picked: [] };
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
  ctx.save(); ctx.globalAlpha = 0.45;
  for (let x = bodyX - 18; x < bodyX + bodyW + 18; x += 9) {
    rect(x, 245 + Math.sin(tNow * 2.1 + x * 0.31) * 1.5, 5, 1, '#7fb8c8');
  }
  ctx.restore();

  // --- lower jaw base (behind maw) ---
  rr(bodyX, maw.y + maw.h - 6, bodyW, 40, 4, st.d);
  rr(bodyX + 1, maw.y + maw.h - 6, bodyW - 2, 38, 4, st.b);
  rr(bodyX + 3, maw.y + maw.h + 8, bodyW - 6, 26, 4, st.a);
  // belly plate bands on the chin, with scutes and pond light playing over them
  rect(bodyX + 14, maw.y + maw.h + 16, bodyW - 28, 2, st.b);
  ctx.save(); ctx.globalAlpha = 0.18;
  rect(bodyX + 20, maw.y + maw.h + 8, Math.round(bodyW * 0.3), 4, '#eafcff');
  rect(bodyX + 24 + Math.round(bodyW * 0.34), maw.y + maw.h + 8, 6, 4, '#eafcff');
  ctx.restore();
  if (st.skinny) { rect(bodyX + 14, maw.y + maw.h + 14, 3, 14, st.b); rect(bodyX + bodyW - 17, maw.y + maw.h + 14, 3, 14, st.b); }

  // --- maw interior ---
  rr(maw.x - 6, maw.y - 4, maw.w + 12, maw.h + 10, 4, mawD);
  rr(maw.x - 3, maw.y - 1, maw.w + 6, maw.h + 4, 4, mawC);
  ctx.save(); ctx.globalAlpha = 0.12; rr(maw.x + 4, maw.y + 2, maw.w - 8, 6, 3, '#ffd8e4'); ctx.restore();
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
  for (let k = 0; k < 7; k++) {
    rect(bodyX + 14 + k * 36, jy + 22 + (k % 2) * 8, 3, 3, st.b);
  }
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
  // one hard plastic gloss streak across the snout
  ctx.save(); ctx.globalAlpha = 0.2;
  rect(bodyX + 18, jy + 5, Math.round(bodyW * 0.34), 4, '#eafcff');
  rect(bodyX + 18 + Math.round(bodyW * 0.38), jy + 5, 7, 4, '#eafcff');
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
  const squeeze = (closeT > 0.5 || opts.angry) && !MD.cross;
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
      const blinkT = (tNow + (side ? 0.07 : 0)) % 4.3;
      const blink = blinkT > 4.15 ? clamp((blinkT - 4.15) / 0.075, 0, 1) : 0;
      const lidAmt = clamp(Math.max(blink, (1 - clamp(MD.open, 0, 1)) * 0.8, MD.squint * 0.5, st.sleepy ? 0.55 : 0), 0, 1);
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
    rect(ex - 10, ey + 6, 5, 6, st.b); rect(ex + 27, ey + 8, 5, 5, st.b);
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
  // wardrobe carcass + velvet interior
  rr(X - 2, Y + 2, Wc + 4, 106, 4, '#00000066');
  rr(X, Y, Wc, 104, 4, '#6a4a2a');
  rr(X + 2, Y + 2, Wc - 4, 100, 3, '#3a2038');
  rr(X + 4, Y + 4, Wc - 8, 96, 3, '#2a1830');
  rect(X + 4, Y + 4, Wc - 8, 2, '#4a2c50'); // velvet sheen
  // header plaque on little chains
  rect(X + 26, Y - 8, 2, 8, '#8a7a58'); rect(X + Wc - 28, Y - 8, 2, 8, '#8a7a58');
  panel(X + 8, Y - 16, Wc - 16, 15, { face: '#5f4228', edge: '#c8a040', r: 2 });
  drawTextCSh("GATOR'S CLOSET", X + Wc / 2, Y - 12, '#ffe6b0', 1);
  const cos = G.cosmetics || [];
  if (!cos.length) {
    drawTextC('FRESH OUT!', X + Wc / 2, Y + 40, C.gold, 1);
    drawWrappedC('You own every look, sharp dresser.', X + Wc / 2, Y + 54, Wc - 12, C.dim);
    // a lonely coat hanger
    rect(X + Wc / 2 - 10, Y + 74, 20, 1, '#9a8a6a'); rect(X + Wc / 2, Y + 70, 1, 4, '#9a8a6a');
    return;
  }
  cos.forEach((c, i) => {
    const sy = Y + 6 + i * 48, rc = RAR_COL[c.rar];
    const hov = mx >= X + 6 && mx < X + Wc - 6 && my >= sy && my < sy + 44 && !c.sold;
    rr(X + 6, sy, Wc - 12, 44, 3, hov ? rc : '#1c1226');
    rr(X + 7, sy + 1, Wc - 14, 42, 3, '#241832');
    // rarity disc + art
    const cx = X + 28, cy = sy + 21;
    fillCircle(cx, cy + 1, 15, '#00000055');
    fillCircle(cx, cy, 15, rc);
    fillCircle(cx, cy, 12, '#2a1830');
    fillCircle(cx, cy - 1, 11, '#33203c');
    if (c.sold) {
      ctx.save(); ctx.globalAlpha = 0.4; drawCosmeticArt(cx, cy, c.kind, c.k); ctx.restore();
      drawTextCSh('WORN!', X + Wc / 2 + 12, sy + 18, C.green, 1);
      drawTextC('LOOKIN GOOD', X + Wc / 2 + 12, sy + 28, C.dim, 1);
      return;
    }
    drawCosmeticArt(cx, cy, c.kind, c.k);
    // name / rarity / price
    const cdefs = { glove: GLOVES, hat: HATS, gear: GEAR };
    const cdef = (cdefs[c.kind] || HATS)[c.k];
    const kindLbl = c.kind === 'glove' ? 'GLOVE' : c.kind === 'gear' ? 'GEAR' : 'HAT';
    const tx = X + 48, nl2 = fitLines(cdef.name, Wc - 60);
    if (nl2.length > 1) { drawText(nl2[0], tx, sy + 6, C.white, 1); drawText(nl2[1], tx, sy + 15, C.white, 1); }
    else drawText(nl2[0], tx, sy + 8, C.white, 1);
    drawText(RAR_NAME[c.rar], tx, sy + 25, rc, 1);
    const afford = G.money >= c.price;
    rr(tx, sy + 33, 30, 9, 2, afford ? '#3a2c10' : '#2a1a1a');
    drawText('$' + c.price, tx + 3, sy + 34, afford ? C.gold : C.red, 1);
    if (hov) drawTextC(kindLbl, X + Wc - 24, sy + 34, rc, 1);
    hit(X + 6, sy, Wc - 12, 44, {
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
    for (let x = ((row * 37) % 60); x < W; x += 60) rect(x, y, 1, h, F[1]);
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

function drawShop() {
  shopWall();
  shopFloor();
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
  (function posters() {
    // two little hand-painted notices tacked to the pegboard
    const tack = (px, py, pw, phh, face, edge) => {
      ctx.save(); ctx.translate(px, py); ctx.rotate(Math.sin(px * 0.7) * 0.05);
      rr(1, 2, pw, phh, 1, '#00000044'); rr(0, 0, pw, phh, 1, edge); rr(1, 1, pw - 2, phh - 2, 1, face);
      rect(2, 2, pw - 4, 1, '#ffffff55');
      rect(pw / 2 - 1, 1, 2, 2, '#c23a4a');
      ctx.restore();
    };
    tack(140, 76, 46, 13, '#e8dfc2', '#8a7a54');
    drawText('NO BITING', 144, 80, '#8a2a16', 1);
    tack(302, 76, 50, 13, '#cfe3d6', '#4a6a54');
    drawText('TRADE-INS OK', 305, 80, '#1d4a2c', 1);
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

  const bx0 = 148;
  G.shopItems.forEach((it, i) => {
    const x = bx0 + i * 51, y = 96;
    const afford = !it.sold && G.money >= it.price;
    const hovS = mx >= x - 4 && mx < x + 46 && my >= y - 6 && my < y + 76;
    // ---- display niche: slate back, lit cove, timber plinth ----
    goldFrame(x - 4, y - 6, 50, 82, {
      r: 4, field: '#1b2831', fieldD: '#101a20', fieldL: '#2f4756',
      glow: hovS ? 0.24 + Math.sin(tNow * 5) * 0.06 : 0,
    });
    ctx.save(); ctx.globalAlpha = 0.22 + (hovS ? 0.12 : 0) + Math.sin(tNow * 2 + i) * 0.02;
    for (let k = 0; k < 7; k++) rect(x + 2 + k, y - 2, 38 - k * 2, 40, '#ffe6b0');   // spotlight cone
    ctx.restore();
    ctx.save(); ctx.globalAlpha = 0.2; fillCircle(x + 21, y + 46, 15, '#ffd48a'); ctx.restore();
    rect(x - 3, y + 46, 48, 6, '#5f4228');   // plinth
    rect(x - 3, y + 46, 48, 1, '#8a6238');
    rect(x - 3, y + 51, 48, 1, '#2e1f10');
    for (let k = 0; k < 4; k++) rect(x + 2 + k * 12, y + 47, 1, 4, '#4a3320');
    ctx.save(); ctx.globalAlpha = 0.35; ctx.scale(1, 0.3); fillCircle(x + 21, (y + 46) / 0.3, 13, '#000'); ctx.restore();

    if (it.sold) {
      ctx.save(); ctx.globalAlpha = 0.5; rect(x - 3, y - 5, 48, 80, '#0a0f13'); ctx.restore();
      ctx.save(); ctx.translate(x + 21, y + 30); ctx.rotate(-0.18);
      rr(-24, -9, 48, 18, 2, '#5a1a12'); rr(-23, -8, 46, 16, 2, '#8a2a16');
      rect(-22, -7, 44, 1, '#c85a3a');
      drawTextC('SOLD OUT', 0, -3, '#ffd8c0', 1);
      ctx.restore();
      return;
    }
    drawCardAnim(x + 7, y + 2, it.def, it.kind, i + 10, {
      id: 'shopitem' + i,
      price: undefined, afford,
      tip: it.def.name + '|CLICK FOR DETAILS',
      click: () => { G.inspect = { kind: 'shop', item: it }; },
    });
    // ---- swing tag on a wire, carrying the price ----
    const sway = Math.sin(tNow * 1.7 + i * 1.3) * 0.1 + (hovS ? Math.sin(tNow * 9) * 0.06 : 0);
    ctx.save(); ctx.translate(x + 34, y - 4); ctx.rotate(sway);
    rect(-1, 0, 2, 6, '#8a949c');
    rr(-10, 5, 20, 14, 3, '#241708');
    rr(-9, 6, 18, 12, 2, afford ? '#f0d48a' : '#b8a898');
    rect(-8, 7, 16, 1, '#fff4d0');
    rect(-8, 15, 16, 1, '#b8922a');
    fillCircle(0, 8, 2, '#8a7448'); fillCircle(0, 8, 1, '#241708');
    drawTextC('$' + it.price, 0, 11, afford ? '#4a3208' : '#6a2a2a', 1);
    ctx.restore();
    // a spinning cartoon starburst on anything you can afford cheaply
    if (afford && it.price === Math.min.apply(null, G.shopItems.filter(q => !q.sold && G.money >= q.price).map(q => q.price)) && G.shopItems.filter(q => !q.sold).length > 1) {
      const sx2 = x + 5, sy2 = y + 8, spin = tNow * 1.6;
      ctx.save(); ctx.translate(sx2, sy2); ctx.rotate(spin);
      for (let s2 = 0; s2 < 8; s2++) { const a2 = s2 / 8 * Math.PI * 2; rect(Math.cos(a2) * 7 - 1, Math.sin(a2) * 7 - 1, 3, 3, '#ff5a4a'); }
      ctx.restore();
      fillCircle(sx2, sy2, 7, '#ff5a4a'); fillCircle(sx2, sy2 - 1, 6, '#ff8a6a');
      drawTextC('!', sx2, sy2 - 3, '#fff6c8', 1);
    }
    // ---- engraved shelf label ----
    const label = it.kind === 'charm' ? 'BADGE' : it.kind === 'tool' ? 'TOOL' : 'CARD';
    rr(x - 2, y + 52, 46, 22, 2, '#131c22');
    rect(x - 1, y + 53, 44, 1, '#2b3d47');
    drawTextC(label, x + 21, y + 55, it.kind === 'tool' ? '#7fd0c0' : it.kind === 'charm' ? '#e8b45a' : '#c8a8f8', 1);
    const nl = fitLines(it.def.name, 42);
    if (nl.length > 1) { drawTextC(nl[0], x + 21, y + 63, C.white, 1); drawTextC(nl[1], x + 21, y + 70, C.white, 1); }
    else drawTextC(nl[0], x + 21, y + 66, C.white, 1);
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
    hat: meta.hat, gear: meta.gear, glove: meta.glove,
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
  const DUR = [3.6, 3.4, 2.2];
  if (cut.t >= DUR[cut.shot] && !cut.ending) {
    if (cut.shot >= 2) endIntro();
    else { cut.shot++; cut.t = 0; sfx.whoosh(); }
  }
  const t = cut.t;

  if (cut.shot === 0) {
    // --- shot 1: poling through the glades at night ---
    const th = THEMES.night;
    drawSceneBack(th);
    drawSceneFront(th);
    const cx2 = lerp(-80, 226, easeOut(clamp(t / 2.9, 0, 1)));
    const bob = Math.sin(tNow * 2.4) * 1.5;
    const moving = t < 3.0;
    drawAirboat(cx2, 230 + bob, moving, dt, t);
    cut.cap = typed('DEEP IN THE EVERGLADES...', t - 0.3) +
      (t > 2.0 ? '\n' + typed('A GATOR HOARDS A FORTUNE IN GOLDEN TEETH.', t - 2.0) : '');
  } else if (cut.shot === 1) {
    // --- shot 2: the REAL monster surfaces as a silhouette, lantern vs eyes ---
    if (!cut.crocShot) {
      // capture the actual in-game croc (big style), then tint it to a shadow
      const _r = G.round; G.round = 1; // round 1 resolves to the BIG gator style
      ctx.clearRect(0, 0, W, H);
      const _mx = mx, _my = my; mx = 294; my = 120;
      drawCroc(0.5, { angry: true });
      mx = _mx; my = _my; G.round = _r;
      const oc = document.createElement('canvas'); oc.width = W; oc.height = H;
      const o = oc.getContext('2d'); o.imageSmoothingEnabled = false;
      o.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, W, H); // downscale the supersampled backing
      o.globalCompositeOperation = 'source-atop';
      o.globalAlpha = 0.86; o.fillStyle = '#081018'; o.fillRect(0, 0, W, H);
      cut.crocShot = oc;
      // remember where its eyes sit so we can ignite them
      const L = mouthLayout(), maw = L.maw;
      const jy = maw.y - 58 + 0.5 * (maw.h - 26);
      cut.eyes = [[maw.x + 18, jy - 10], [maw.x + maw.w - 48, jy - 10]];
    }
    for (let i = 0; i < 5; i++) rect(0, i * 42, W, 42, ['#040810', '#050b12', '#071016', '#08141a', '#0a181e'][i]);
    for (let i = 0; i < 20; i++) { const sx2 = (i * 97 + 31) % W, sy2 = (i * 53 + 11) % 90; ctx.save(); ctx.globalAlpha = 0.3; rect(sx2, sy2, 1, 1, '#cfe8f0'); ctx.restore(); }
    rect(0, 208, W, H - 208, '#050d10'); // black water
    // the head rises out of the water
    const rise = easeOut(clamp(t / 1.3, 0, 1));
    const riseY = Math.round(lerp(150, 26, rise) + Math.sin(tNow * 1.1) * 1.5);
    ctx.imageSmoothingEnabled = false;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, 208); ctx.clip();
    ctx.drawImage(cut.crocShot, 130, 20, 330, 240, 130, riseY, 330, 240);
    ctx.restore();
    // waterline cut + laps
    rect(0, 208, W, 4, '#071014');
    for (let x = 150, k = 0; x < 470; x += 12, k++) rect(x + ((tNow * 8 | 0) % 12), 206, 6, 2, '#12262066');
    // eyes ignite in the sprite's own sockets
    if (t > 1.15) {
      if (!cut.growled) { cut.growled = true; sfx.boss(); shake = 5; }
      const ec = t > 1.3 ? 1 : (t - 1.15) / 0.15;
      (cut.eyes || []).forEach(([ex0, ey0]) => {
        const ex2 = ex0, ey2 = ey0 + (riseY - 20); // follow the rise offset
        ctx.save(); ctx.globalAlpha = 0.16 * ec; fillCircle(ex2 + 11, ey2 + 9, 22, '#ffc843'); ctx.restore();
        ctx.save(); ctx.globalAlpha = 0.5 + ec * 0.5;
        rr(ex2 + 3, ey2 + 4, 16, 12, 3, '#ffc843');
        rect(ex2 + 9, ey2 + 6, 4, 8, '#1b1408');
        rect(ex2 + 5, ey2 + 5, 3, 3, '#fff6c8');
        ctx.restore();
      });
    }
    // the ranger stands on their moored airboat, lantern held high
    const rb = Math.sin(tNow * 2.1) * 1;
    rr(30, 236 + rb, 70, 8, 3, '#3c464e');
    rect(34, 233 + rb, 62, 4, '#5a646c');
    fillCircle(42, 224 + rb, 10, '#1a242c'); fillCircle(42, 224 + rb, 8, '#0c141a'); // dark fan cage
    drawBobble(66, 236 + rb, G.ranger, { sc: 1, expr: 'calm', act: 'idle', hat: meta.hat, gear: meta.gear, glove: meta.glove });
    rect(74, 210 + rb, 12, 2, '#0c1216');   // arm out
    rect(86, 202 + rb, 2, 8, '#4a3320');
    rr(83, 196 + rb, 8, 8, 2, '#2a2018');
    rect(85, 198 + rb, 4, 4, '#ffd54a');
    ctx.save(); ctx.globalAlpha = 0.12 + Math.sin(tNow * 6) * 0.04; fillCircle(87, 200 + rb, 32, '#ffb848'); ctx.restore();
    cut.cap = typed('TONIGHT, ' + (RANGERS[G.ranger] || RANGERS.scout).name + '...', t - 0.5, 20) +
      (t > 2.0 ? '\n' + typed('YOU BITE BACK.', t - 2.0, 20) : '');
  } else {
    // --- shot 3: the floor card ---
    rect(0, 0, W, H, '#04070a');
    const jx = (tNow * 5 | 0) % 2, jy2 = ((tNow * 5 + 1) | 0) % 2; // paper wobble
    const fade = clamp(t / 0.4, 0, 1);
    ctx.save(); ctx.globalAlpha = fade;
    rr(74 + jx, 44 + jy2, 332, 182, 4, '#c8b898');
    rr(78 + jx, 48 + jy2, 324, 174, 4, '#04070a');
    rr(88 + jy2, 58 + jx, 304, 154, 2, '#00000000');
    ctx.strokeStyle = '#c8b898'; // inner scratchy frame
    rect(88 + jy2, 58 + jx, 304, 1, '#8a7a58'); rect(88 + jy2, 211 + jx, 304, 1, '#8a7a58');
    rect(88 + jy2, 58 + jx, 1, 154, '#8a7a58'); rect(391 + jy2, 58 + jx, 1, 154, '#8a7a58');
    [[84, 54], [392, 54], [84, 214], [392, 214]].forEach(([nx, ny]) => rect(nx + jx, ny + jy2, 4, 4, '#c8b898'));
    drawTextCSh('ANTE ' + G.ante, W / 2 + jx, 92 + jy2, '#e8e0c8', 5, '#00000000');
    drawTextCSh(anteName(G.ante), W / 2 + jx, 142 + jy2, '#8a7a58', 2);
    drawMiniGator(W / 2 - 11, 168 + jy2, 'small');
    // ink specks
    [[120, 200], [352, 74], [340, 196], [130, 70]].forEach(([ix, iy], k) => { rect(ix, iy, 2, 2, '#c8b89844'); rect(ix + 3, iy + 2, 1, 1, '#c8b89833'); });
    ctx.restore();
  }

  // letterbox bars + subtitle + skip controls on every shot
  rect(0, 0, W, 26, '#000'); rect(0, H - 26, W, 26, '#000');
  if (cut.shot < 2 && cut.cap) letterboxCaption(cut.cap);
  hit(0, 26, W, H - 52, { id: 'cutadv', cb: () => { if (cut.shot >= 2) endIntro(); else { cut.shot++; cut.t = 0; cut.cap = ''; sfx.whoosh(); } }, cursor: true });
  button(W - 62, 6, 56, 14, 'SKIP >', '#3a5560', '#243a44', endIntro, { id: 'cutskip' });
  if ((tNow % 1.4) < 0.9) drawText('TAP TO CONTINUE', 8, 10, '#54707a', 1);
}
// captions live inside the lower letterbox bar, like subtitles
function letterboxCaption(txt) {
  const lines = txt.split('\n').filter(Boolean);
  if (lines.length >= 2) { drawTextC(lines[0], W / 2, H - 23, C.white, 1); drawTextC(lines[1], W / 2, H - 13, '#ffe6a0', 1); }
  else if (lines[0]) drawTextC(lines[0], W / 2, H - 18, C.white, 1);
}

// one line of menace per boss, shown on the VS banner
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
// render the REAL styled croc once per boss and keep the sprite
let bossShot = null;
function ensureBossShot() {
  // the key must cover EVERYTHING that changes the sprite - the same boss id is
  // a gator in the swamp and a shark in the ocean, and mutations retint it.
  const key = (G.boss ? G.boss.id : 'x') + '|' + (G.summer ? 'sea' : 'swamp') + '|' + (G.mut || '-');
  if (bossShot && bossShot.key === key) return bossShot.c;
  ctx.clearRect(0, 0, W, H);
  const _mx = mx, _my = my; mx = 294; my = 150;
  drawCroc(0.42, { angry: true });
  mx = _mx; my = _my;
  const oc = document.createElement('canvas'); oc.width = W; oc.height = H;
  const o = oc.getContext('2d'); o.imageSmoothingEnabled = false;
  o.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, W, H); // downscale the supersampled backing
  bossShot = { key, c: oc };
  return oc;
}
// ---------- BOSS CINEMATIC: a scary cold-open before the VS splash ---------
// black water -> eyes rise -> lightning reveal -> the jaws LUNGE at you.
function drawBossCut(dt) {
  const shot = ensureBossShot();      // grab the real styled boss sprite first
  const c = G.bcut; if (!c) { G.state = 'bossintro'; G.biStart = tNow; return; }
  c.t += dt;
  const t = c.t;
  const done = () => { G.bcut = null; G.state = 'bossintro'; G.biStart = tNow; };

  // ---- dead-black swamp night + crawling mist ----
  for (let i = 0; i < 6; i++) rect(0, i * 45, W, 46, ['#03070a', '#04090d', '#050c11', '#060f14', '#071216', '#081518'][i]);
  ctx.save(); ctx.globalAlpha = 0.06;
  for (let k = 0; k < 7; k++) { const my2 = 60 + k * 26, off = (tNow * (6 + k * 2)) % (W + 120); rect(off - 120, my2, 120, 9, '#8fb8c0'); }
  ctx.restore();
  // distant lightning behind the treeline
  const bolt = Math.sin(t * 7.3) > 0.985 || (t > 2.0 && t < 2.16);
  if (bolt) { ctx.save(); ctx.globalAlpha = 0.16; rect(0, 0, W, 150, '#cfe8f0'); ctx.restore(); }
  for (let x2 = 0; x2 < W; x2 += 7) { const h1 = 26 + ((Math.sin(x2 * 0.11) * 12) | 0) + ((x2 * 7) % 9); rect(x2, 150 - h1, 7, h1, bolt ? '#0d1a1e' : '#060e11'); }
  rect(0, 150, W, H - 150, '#040b0e'); // black water

  // ---- ripples spreading from where it lurks ----
  const cx2 = W / 2 + 20;
  for (let k = 0; k < 4; k++) {
    const rp = ((t * 0.55 + k * 0.25) % 1);
    ctx.save(); ctx.globalAlpha = (1 - rp) * 0.4;
    const rw = 24 + rp * 150;
    rect(cx2 - rw / 2, 196 + k * 5 - rp * 6, rw, 1, '#2a6a72');
    ctx.restore();
  }

  // ---- beat 1: two eyes rise out of the black ----
  if (t > 0.55) {
    const rise = easeOut(clamp((t - 0.55) / 1.15, 0, 1));
    const ey = lerp(206, 150, rise);
    const glow = 0.35 + rise * 0.5 + Math.sin(t * 9) * 0.08;
    [[cx2 - 34, 0], [cx2 + 26, 1]].forEach(([ex]) => {
      ctx.save(); ctx.globalAlpha = glow * 0.5; fillCircle(ex + 4, ey + 3, 11, '#c81818'); ctx.restore();
      rr(ex, ey, 9, 7, 2, '#1a0a0a');
      rect(ex + 2, ey + 2, 5, 4, '#ff2a2a');
      rect(ex + 3, ey + 3, 2, 2, '#fff2c8');
    });
    if (rise > 0.4) { // a slick brow breaks the surface
      ctx.save(); ctx.globalAlpha = 0.9 * rise;
      rr(cx2 - 52, ey + 8, 104, 10, 4, '#0d1a14'); rr(cx2 - 46, ey + 9, 92, 5, 3, '#16281c');
      ctx.restore();
    }
  }

  // ---- beat 2: lightning reveals the whole silhouette ----
  if (t > 1.9 && t < 2.9) {
    const f = clamp((t - 1.9) / 0.16, 0, 1) * (t > 2.5 ? clamp((2.9 - t) / 0.4, 0, 1) : 1);
    ctx.save(); ctx.globalAlpha = 0.55 * f;
    ctx.drawImage(shot, 120, 0, 340, 250, 74, 26, 340, 250);
    ctx.globalAlpha = 0.5 * f; rect(0, 0, W, H, '#0a1a20');
    ctx.restore();
    if (t < 2.05 && shake < 2) shake = 3;
  }

  // ---- beat 3: the jaws LUNGE straight at the camera ----
  if (t > 2.85) {
    const f = easeIn(clamp((t - 2.85) / 0.85, 0, 1));
    const sc = lerp(0.65, 2.4, f);
    const w2 = 340 * sc, h2 = 250 * sc;
    // radial speed lines rushing past as it closes in
    ctx.save(); ctx.globalAlpha = 0.35 * f;
    for (let s = 0; s < 18; s++) {
      const a = s / 18 * Math.PI * 2 + tNow * 0.8, r0 = 60 + f * 90, r1 = r0 + 40 + f * 70;
      const x0 = W / 2 + Math.cos(a) * r0, y0 = 140 + Math.sin(a) * r0;
      const x1 = W / 2 + Math.cos(a) * r1, y1 = 140 + Math.sin(a) * r1;
      for (let q = 0; q < 5; q++) rect(lerp(x0, x1, q / 5), lerp(y0, y1, q / 5), 2, 2, '#ffffff');
    }
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = clamp(0.5 + f, 0, 1);
    ctx.drawImage(shot, 120, 0, 340, 250, W / 2 - w2 / 2, 150 - h2 * 0.55, w2, h2);
    ctx.restore();
    if (f > 0.55 && shake < 4) shake = 5 + f * 4;
    if (f > 0.62 && !c.roared) { c.roared = true; fxRing(W / 2, 140, '#ff6a4a', 10, 180, 0.5); fxStars(W / 2, 140, '#ffd54a', 10, 150); }
    if (f > 0.8) {
      const k = (f - 0.8) / 0.2;
      ctx.save(); ctx.globalAlpha = k * 0.8; rect(0, 0, W, H, '#7a0e14'); ctx.restore();
      // jagged "cracked screen" streaks at the moment of impact
      ctx.save(); ctx.globalAlpha = k;
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx2, sy2], i) => {
        let px2 = W / 2, py2 = 140;
        for (let seg = 0; seg < 7; seg++) {
          const nx = px2 + sx2 * (14 + seg * 5) + Math.sin(seg * 2.1 + i) * 9;
          const ny = py2 + sy2 * (10 + seg * 4) + Math.cos(seg * 1.7 + i) * 7;
          for (let q = 0; q < 6; q++) rect(lerp(px2, nx, q / 6), lerp(py2, ny, q / 6), 2, 2, '#ffe8d0');
          px2 = nx; py2 = ny;
        }
      });
      ctx.restore();
    }
  }

  // ---- captions ----
  if (t < 1.9) { ctx.save(); ctx.globalAlpha = clamp(t / 0.6, 0, 1) * (t > 1.5 ? (1.9 - t) / 0.4 : 1); drawTextCSh('SOMETHING STIRS IN THE DARK...', W / 2, 224, '#7a9aa4', 1); ctx.restore(); }
  else if (t < 2.85) { ctx.save(); ctx.globalAlpha = 0.9; drawTextCSh('IT IS ALREADY AWAKE.', W / 2, 224, '#d86a6a', 1); ctx.restore(); }

  if (t >= 3.95) { done(); return; }
  // skippable
  drawTextC('TAP TO SKIP', W / 2, 254, '#3a5560', 1);
  hit(0, 0, W, H, { id: 'bcutskip', cb: done, cursor: true });
}

function drawBossIntro() {
  // ---------- Binding-of-Isaac style VS splash ----------
  const shot = ensureBossShot(); // capture the real croc before painting the splash
  const el = tNow - G.biStart;
  const slide = easeOut(clamp(el / 0.4, 0, 1));
  // moody Everglades night behind the whole card
  drawSceneBack(THEMES.boss);
  drawSceneFront(THEMES.boss);
  // diagonal color wash: dentist teal (top-left) vs boss blood (bottom-right)
  ctx.save();
  for (let y = 0; y < H; y += 2) {
    const cutX = W - (y / H) * W * 0.9 - 40; // diagonal divide
    ctx.globalAlpha = 0.62;
    rect(0, y, Math.max(0, cutX), 2, '#0d2026');
    rect(Math.max(0, cutX), y, W - cutX, 2, '#20080e');
  }
  ctx.restore();
  // rising embers on the boss side, sparks on ours
  for (let i = 0; i < 10; i++) {
    const ph = (tNow * 0.5 + i * 0.37) % 1;
    ctx.save(); ctx.globalAlpha = (1 - ph) * 0.5;
    rect(300 + (i * 43) % 160, 250 - ph * 190, 2, 2, '#ff7a48');
    rect(20 + (i * 37) % 150, 240 - ph * 160, 1, 1, '#7fd4e8');
    ctx.restore();
  }
  // diagonal lightning slash along the divide
  for (let y = 0; y < H; y += 6) {
    const cutX = W - (y / H) * W * 0.9 - 40 + (((y / 6) | 0) % 2) * 3;
    rect(cutX - 2, y, 5, 6, '#f4f0dc');
    rect(cutX + 3, y, 2, 6, '#ffc84366');
  }

  // ---- dentist side (slides in from the left) ----
  const dx = lerp(-180, 0, slide);
  ctx.save(); ctx.translate(dx, 0);
  const R = RANGERS[G.ranger] || RANGERS.scout;
  // portrait: ranger at 3x on a plate
  panel(22, 40, 118, 118, { face: '#10262cee', edge: '#5cb0ac', r: 4 });
  drawBobble(81, 150, G.ranger, { sc: 1.6, expr: 'grit', act: 'idle', hat: meta.hat, gear: meta.gear, glove: meta.glove });
  // crossed forceps behind the ranger, like a crest
  for (let i = 0; i <= 10; i++) { rect(118 + i, 58 - i, 2, 2, '#5cb0ac'); rect(128 - i, 58 - i, 2, 2, '#5cb0ac'); }
  drawTextCSh('RANGER ' + R.name, 81, 162, '#7fd4e8', 1);
  drawTextCSh('THE DENTIST', 81, 172, C.white, 2);
  ctx.restore();

  // ---- boss side (slides in from the right) ----
  const bx2 = lerp(180, 0, slide);
  ctx.save(); ctx.translate(bx2, 0);
  panel(330, 44, 130, 126, { face: '#2a0e12ee', edge: C.redD, r: 4 });
  ctx.imageSmoothingEnabled = false;
  ctx.save(); ctx.beginPath(); ctx.rect(334, 48, 122, 112) ; ctx.clip();
  ctx.drawImage(shot, 148, 8, 290, 236, 331, 51, 128, 104); // the actual in-game croc
  ctx.restore();
  drawTextCSh('BOSS GATOR', 395, 176, '#ffb0a8', 1);
  ctx.restore();

  // ---- VS slam ----
  const vt = clamp((el - 0.45) / 0.25, 0, 1);
  if (el > 0.45) {
    if (el < 0.75 && shake < 2) shake = 7;
    const vsc = Math.round(lerp(11, 5, easeOut(vt)));
    const wob = vt >= 1 ? Math.sin(tNow * 3) * 2 : 0;
    ctx.save(); ctx.globalAlpha = 0.35 + vt * 0.65;
    drawTextCSh('VS', W / 2 + 2, 96 - vsc * 2.5 + wob + 3, '#000', vsc + 1);
    drawTextCSh('VS', W / 2, 96 - vsc * 2.5 + wob, C.gold, vsc);
    ctx.restore();
    if (vt >= 1) { // impact star
      ctx.save(); ctx.globalAlpha = 0.5 + Math.sin(tNow * 6) * 0.2;
      [[-30, -8], [26, -12], [-24, 16], [30, 14]].forEach(([ox, oy]) => rect(W / 2 + ox, 86 + oy, 3, 3, '#fff6c8'));
      ctx.restore();
    }
  }

  // ---- boss name banner ----
  const bt = clamp((el - 0.7) / 0.3, 0, 1);
  if (el > 0.7) {
    const by2 = lerp(H + 20, 192, easeOut(bt));
    panel(60, by2, 360, 66, { face: '#2a0e12f4', edge: C.red, r: 4 });
    drawTextCSh(G.boss.name, W / 2, by2 + 7, C.white, 3);
    drawTextC("'" + (BOSS_QUIPS[G.boss.id] || 'IT IS VERY HUNGRY.') + "'", W / 2, by2 + 30, '#c88a94', 1);
    drawTextCSh(G.boss.desc, W / 2, by2 + 42, '#ffb0a8', 1);
    drawTextCSh('TARGET: ' + fmt(G.target), W / 2, by2 + 54, C.orange, 1);
  }
  if (el > 1.1) {
    button(W / 2 - 55, 168, 110, 24, 'BITE DOWN!', '#d94f30', '#8a2a16', () => { G.state = 'play'; }, { id: 'bossgo' });
    hit(0, 0, W, 160, { id: 'bossgotap', cb: () => { G.state = 'play'; }, cursor: true });
    if ((tNow % 1) < 0.6) drawTextC('TAP TO FIGHT', W / 2, 246, '#ffb0a877', 1);
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
  button(W / 2 - 55, 196, 110, 26, 'NEW RUN', '#d94f30', '#8a2a16', () => { G.state = 'ranger'; }, { id: 'newrun' });
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
function drawRustySign(cx, py, dy) {
  ctx.save();
  ctx.translate(cx, py + dy);
  const bw = 236, bh = 44, bx = -bw / 2, by = 18;
  // --- support chains from the pivot beam down to the board corners ---
  // chains stretch as the board rides up (more links show when dy is negative)
  const links = clamp(4 + Math.round(-dy / 4), 4, 9);
  for (let k = 0; k < links; k++) { const ly = k * (by / links); rr(-88, ly, 5, 4, 2, '#2a2018'); rr(-87, ly + 1, 3, 2, 1, '#6a5238'); }
  for (let k = 0; k < Math.min(2, links); k++) { const ly = k * (by / links); rr(88, ly, 5, 4, 2, '#2a2018'); rr(89, ly + 1, 3, 2, 1, '#6a5238'); }
  rect(90, Math.min(11, by - 5), 2, 5, '#8a4a20'); // dangling broken link stub (right chain snapped)
  // --- the plate: dark rim + rusted iron face ---
  rr(bx + 2, by + 4, bw, bh, 3, '#00000080');
  rr(bx, by, bw, bh, 3, '#241810');
  rr(bx + 2, by + 2, bw - 4, bh - 4, 3, '#7a5230');
  rect(bx + 4, by + 3, bw - 8, 2, '#9a6a3e'); // top light lip
  rect(bx + 4, by + bh - 5, bw - 8, 2, '#3a2614'); // bottom shade
  // --- rust patches + grime speckle ---
  ctx.save(); ctx.globalAlpha = 0.55;
  for (let k = 0; k < 26; k++) { const rx = bx + 8 + (k * 53) % (bw - 16), ry = by + 6 + (k * 37) % (bh - 12); rect(rx, ry, 2 + (k % 3), 2, k % 2 ? '#8a3e1a' : '#a85a2a'); }
  ctx.restore();
  // --- cracks across the metal ---
  rect(bx + 60, by + 6, 1, 18, '#241810'); rect(bx + 61, by + 12, 10, 1, '#241810');
  rect(bx + 150, by + 20, 1, 16, '#241810'); rect(bx + 140, by + 22, 12, 1, '#241810');
  // --- broken/chipped bottom-right corner ---
  rr(bx + bw - 20, by + bh - 12, 22, 14, 2, '#1a120a');
  rect(bx + bw - 16, by + bh - 8, 4, 3, '#3a2614'); rect(bx + bw - 10, by + bh - 5, 3, 3, '#3a2614');
  // --- rivets (bottom-right one popped out) ---
  [[bx + 8, by + 7], [bx + bw - 10, by + 7], [bx + 8, by + bh - 9]].forEach(([rx, ry]) => { fillCircle(rx, ry, 2, '#3a2a18'); rect(rx - 1, ry - 1, 1, 1, '#c8a060'); });
  fillCircle(bx + bw - 10, by + bh - 9, 2, '#160f08'); // empty rivet hole
  // --- weathered title text (rust-eaten) ---
  drawTextCSh('BITE', -60, by + 9, '#d8a838', 5, '#2a1a0c');
  drawTextCSh('DOWN', 64, by + 9, '#4f9a44', 5, '#2a1a0c');
  ctx.save(); ctx.globalAlpha = 0.4; for (let k = 0; k < 10; k++) rect(-104 + (k * 41) % 208, by + 12 + (k * 17) % 18, 2, 2, '#3a2614'); ctx.restore();
  // --- tagline plank: hangs LEVEL from two short links under the sign ---
  const pw2 = 190, px2 = -pw2 / 2, py2 = by + bh + 5;
  rect(px2 + 18, py2 - 4, 2, 4, '#2a2018'); rect(px2 + pw2 - 20, py2 - 4, 2, 4, '#2a2018');
  rr(px2 + 1, py2 + 2, pw2, 13, 2, '#00000066');
  rr(px2, py2, pw2, 13, 2, '#3a2614'); rr(px2 + 1, py2 + 1, pw2 - 2, 11, 2, '#5a3a20');
  rect(px2 + 3, py2 + 2, pw2 - 6, 1, '#7a5230');
  rect(px2 + 62, py2 + 2, 1, 9, '#2a1810'); // weathered split
  drawTextC('A RUST-YOUR-LUCK DENTAL ROGUELIKE', 0, py2 + 3, '#c8b090', 1);
  [px2 + 5, px2 + pw2 - 6].forEach(bx2 => { fillCircle(bx2, py2 + 6, 2, '#2a1c10'); rect(bx2 - 1, py2 + 5, 1, 1, '#c8a060'); });
  ctx.restore();
}

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
function drawMenu(dt) {
  if (G.summer) { G.summer = false; } // a summer run is over once we're back at the title
  G.mut = null;
  if (!G.menuLook) rollMenuLook(); // once per page load only - never mid-session
  G.mouth = G.menuLook.teeth; // a full mouth of teeth (random variant)
  const th = THEMES.night;
  drawSceneBack(th);
  // a distant airboat crosses the far water now and then
  const abT = (tNow % 18) / 18;
  if (abT < 0.4) {
    const ax = lerp(-70, W + 70, abT / 0.4);
    ctx.save(); ctx.translate(ax, 205); ctx.scale(0.45, 0.45); drawAirboat(0, 0, true, undefined); ctx.restore();
  }
  // the jaws never shut any more - the whole title screen lives in its mouth
  const chomp = 0.05 + Math.max(0, Math.sin(tNow * 0.85)) * 0.28;
  const dv = G.dive;
  if (dv) dv.t += dt;
  const dk = dv ? clamp(dv.t / 0.95, 0, 1) : 0;
  const maw0 = mouthLayout().maw;
  const dcx = maw0.x + maw0.w / 2, dcy = maw0.y + maw0.h * 0.62;
  if (dv) { const z = 1 + easeIn(dk) * 7; ctx.save(); ctx.translate(dcx, dcy); ctx.scale(z, z); ctx.translate(-dcx, -dcy); }
  drawCroc(chomp, dv ? { mood: 'hungry' } : undefined);
  drawSceneFront(th);
  if (dv) {
    ctx.restore();
    // rushing speed lines down the throat, then the swallow
    ctx.save();
    ctx.globalAlpha = Math.min(0.7, dk * 1.3);
    for (let k = 0; k < 26; k++) {
      const a = (k / 26) * 6.283 + tNow * 2;
      const r0 = 20 + dk * 180, r1 = r0 + 30 + dk * 90;
      rect(dcx + Math.cos(a) * r0, dcy + Math.sin(a) * r0, Math.cos(a) * (r1 - r0), Math.sin(a) * (r1 - r0) + 1, '#ffd8c0');
    }
    ctx.globalAlpha = dk * dk; rect(0, 0, W, H, '#0a0206');
    ctx.restore();
    if (dk >= 1) { const cb = dv.cb; G.dive = null; if (cb) cb(); }
    return;
  }

  // ============ THE WHOLE MENU LIVES INSIDE THE OPEN JAWS =============
  const maw = mouthLayout().maw;
  const mcx = maw.x + maw.w / 2;
  const sway = Math.sin(tNow * 1.1) * 1.4;

  // ---- the title, on an enamel sign swinging from the palate ----
  (function sign() {
    const sw = 186, sh = 40, sx = mcx - sw / 2, sy = maw.y + 6 + sway;
    [sx + 26, sx + sw - 30].forEach(chx => {
      for (let k = 0; k < 6; k++) { rect(chx, maw.y - 4 + k * 2, 2, 2, k % 2 ? '#8fa8b4' : '#5f7884'); }
    });
    ctx.save(); ctx.globalAlpha = 0.3; rr(sx + 3, sy + 5, sw, sh, 6, '#12020a'); ctx.restore();
    plasticBox(sx, sy, sw, sh, 6, ['#0d2a14', '#16441f', '#1f6a2c', '#2f9a3f', '#7fe08a']);
    plasticBox(sx + 4, sy + 4, sw - 8, sh - 8, 4, ['#0a2010', '#123a1a', '#1a5424', '#26803a', '#63d66a'], { noShine: 1 });
    drawTextCSh('BITE DOWN', mcx, sy + 9, '#ffd23f', 3, '#06180b');
    drawTextC('A PRESS-YOUR-LUCK DENTAL ROGUELIKE', mcx, sy + 30, '#9fe8ac', 1);
    [[sx + 4, sy + 4], [sx + sw - 8, sy + 4], [sx + 4, sy + sh - 8], [sx + sw - 8, sy + sh - 8]].forEach(([bx2, by2]) => {
      rect(bx2, by2, 4, 4, '#8fa8b4'); rect(bx2, by2, 2, 2, '#dfeaee');
    });
    ctx.save(); ctx.globalAlpha = 0.14; for (let k = 0; k < sh - 8; k++) rect(sx + 12 + k * 0.7, sy + 4 + k, 10, 1, '#ffffff'); ctx.restore();
  })();

  // ---- NEW RUN, a big brass plaque on the tongue ----
  const pw2 = 138, phh2 = 34, pxx = mcx - pw2 / 2, pyy = maw.y + maw.h - 46 + sway * 0.5;
  const hov = mx >= pxx && mx < pxx + pw2 && my >= pyy && my < pyy + phh2;
  ctx.save(); ctx.globalAlpha = 0.24 + Math.sin(tNow * 4) * 0.07; rr(pxx - 5, pyy - 5, pw2 + 10, phh2 + 10, 8, '#ffcf3a'); ctx.restore();
  plaque(pxx, pyy + (hov ? 1 : 0), pw2, phh2, { tint: hov ? '#f0662e' : '#d94f30', r: 5 });
  drawTextCSh('NEW RUN', mcx, pyy + 7 + (hov ? 1 : 0), '#fff2d0', 3, '#5a1408');
  drawTextC('STEP INTO THE JAWS', mcx, pyy + 24 + (hov ? 1 : 0), '#ffd9a0', 1);
  hit(pxx - 4, pyy - 4, pw2 + 8, phh2 + 8, { id: 'start', cursor: true, tip: 'NEW RUN|Step into the jaws', cb: diveIn });

  // ---- the shift log, clipped to the lower jaw ----
  ensureDaily();
  (function board() {
    const bx = 14, by = 150, bw = 118, bh = 58;
    plasticBox(bx, by, bw, bh, 4, ['#140c04', '#3a2716', '#5f4326', '#7d5c38', '#9a7548'], { noShine: 1 });
    plasticBox(bx + 4, by + 4, bw - 8, bh - 8, 2, ['#2a1d12', '#c9bfa4', '#e8e0cc', '#f6f0e0', '#ffffff'], { noShine: 1 });
    rect(bx + 8, by + 14, bw - 16, 1, '#c9bfa4');
    drawText('SHIFT LOG', bx + 9, by + 8, '#8a7a58', 1);
    drawText('QUESTS  ' + ((meta.qb && meta.qb.done) || 0), bx + 9, by + 19, '#2a1d12', 1);
    ICONS.cookie(bx + 7, by + 27);
    drawText(fmt(meta.rp || 0) + ' COOKIES', bx + 22, by + 30, '#7a5a10', 1);
    drawText('BEST ANTE  ' + best, bx + 9, by + 41, '#2a1d12', 1);
    plasticBox(bx + bw - 12, by - 4, 8, 8, 2, ['#5a1a10', '#8a2a16', '#c23a2a', '#e06a5a', '#ffb0a0'], { noShine: 1 });
    hit(bx, by, bw, bh, { id: 'menuquests', cursor: true, tip: 'QUEST BOARD|Pinned at the GACHA hall', cb: () => { G.state = 'pass'; sfx.click(2); } });
  })();

  // ---- utility tiles, lined up along the lower jaw ----
  const idxAll = indexEntries();
  const idxNew = idxAll.filter(e => meta.index.seen[e.key] && !meta.index.claimed[e.key]).length;
  const UBTN = [
    ['SKINS', '#8a5f28', 'DRESS UP', 'skinsbtn', () => { G.state = 'skins'; sfx.click(2); }],
    ['INDEX', '#2c7c92', idxNew ? '+' + idxNew + ' NEW' : (idxAll.filter(e => meta.index.seen[e.key]).length + '/' + idxAll.length), 'idxbtn', () => { G.state = 'index'; sfx.click(2); }],
    ['GACHA', '#7a4fd0', fmt(meta.rp || 0) + ' CK', 'passbtn', () => { ensureDaily(); G.state = 'pass'; }],
    ['SETUP', '#4a6a58', null, 'setbtn', () => { G.overlay = 'settings'; }],
    ['CREDITS', '#5a5442', null, 'credbtn', () => { G.overlay = 'credits'; }],
  ];
  const ubw = 56, ugap = 4, utot = UBTN.length * ubw + (UBTN.length - 1) * ugap;
  UBTN.forEach(([label, col, sub, id, cb], i) => {
    const bx = Math.round(W / 2 - utot / 2 + i * (ubw + ugap)), by = 234;
    button(bx, by, ubw, sub ? 24 : 20, label, col, mixHex(col, '#000000', 0.45), cb, { id, sub, subCol: '#ffe6b0' });
  });
}
// first NEW RUN runs the tutorial once, then goes to ranger select
function startRun() { if (!meta.tutDone) startTutorial(); else { G.state = 'ranger'; sfx.whoosh(); } }
// the title-screen gator swallows you into the office
function diveIn() {
  if (G.dive) return;
  G.dive = { t: 0, cb: startRun };
  sfx.whoosh(); sfx.snap();
  shake = Math.max(shake, 6);
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

function drawSkins() {
  const th = THEMES.shop;
  drawSceneBack(th); drawSceneFront(th);
  overlayDim(0.72);
  drawTextCSh('DRESSING ROOM', W / 2, 8, C.gold, 2);
  const rkey = RANGERS[meta.ranger] ? meta.ranger : 'scout';
  const R = RANGERS[rkey];

  // ---- framed portrait: a lit vanity mirror showing just your character head ----
  const cx = W / 2, fy = 26, fw = 118, fh = 80, fx = cx - fw / 2;
  // vanity bulbs around the top of the frame
  for (let k = 0; k < 7; k++) { const bx = fx + 14 + k * 16, on = ((tNow * 2 + k) | 0) % 5 !== 0; fillCircle(bx, fy - 3, 3, on ? '#ffe9a0' : '#6a5a3a'); if (on) { ctx.save(); ctx.globalAlpha = 0.16; fillCircle(bx, fy - 3, 7, '#ffe9a0'); ctx.restore(); } }
  // ornate gold frame + mirror glass with a soft radial sheen
  rr(fx - 4, fy + 3, fw + 8, fh + 6, 6, '#00000077');
  rr(fx - 3, fy, fw + 6, fh, 6, '#c9941a'); rr(fx - 1, fy + 2, fw + 2, fh - 4, 5, '#ffd76a');
  rr(fx + 3, fy + 3, fw - 6, fh - 6, 4, '#1b2a33');
  const grd = ctx.createRadialGradient(cx, fy + fh / 2, 4, cx, fy + fh / 2, fh);
  grd.addColorStop(0, '#2f4a56'); grd.addColorStop(1, '#12202a');
  ctx.save(); ctx.fillStyle = grd; ctx.fillRect(fx + 3, fy + 3, fw - 6, fh - 6); ctx.restore();
  rect(fx + 8, fy + 7, 3, fh - 16, '#ffffff12'); // glass streak
  // pedestal shadow + the character head, scaled up, no body
  ctx.save(); ctx.globalAlpha = 0.3; fillCircle(cx, fy + fh - 10, 22, '#000'); ctx.restore();
  drawBobble(cx, fy + fh - 7, rkey, { sc: 1.0, expr: 'happy', act: 'idle', hat: meta.hat, gear: meta.gear, glove: meta.glove });
  // name plaque
  const gname = gloveUnlocked(meta.glove) ? GLOVES[meta.glove].name : 'BARE HANDS';
  const hname = (meta.hat && hatUnlocked(meta.hat)) ? HATS[meta.hat].name : 'NO HAT';
  const rname = (meta.gear && gearUnlocked(meta.gear)) ? GEAR[meta.gear].name : 'NO GEAR';
  panel(cx - 74, fy + fh + 4, 148, 13, { face: '#2a1f14', edge: '#7a5a30', r: 3 });
  drawTextCSh(R.name + '  -  ' + R.animal, cx, fy + fh + 7, '#ffe6b0', 1);

  // ---- GLOVES row ----
  drawText('GLOVES', 14, 126, '#c8b8a0', 1);
  drawText(gname, 66, 126, '#8aa0a8', 1);
  skinRow(135, GLOVE_ORDER, () => meta.glove, gloveUnlocked,
    (ix, iy, k) => ICONS.glove(ix - 6, iy - 6, GLOVES[k].skin),
    (k, open, on) => { const a = ACHS.find(a => a.id === GLOVES[k].ach); return open ? (GLOVES[k].name + (on ? '|EQUIPPED' : '|CLICK TO WEAR')) : ('LOCKED: ' + GLOVES[k].name + '|' + (GLOVES[k].gacha ? 'WIN IT IN THE GACHA-PON' : GLOVES[k].shop ? 'BUY AT THE SHOP CLOSET' : a ? 'ACHIEVEMENT: ' + a.name : '')); },
    k => { meta.glove = k; }, k => GLOVE_RAR[k] || 0);

  // ---- HATS row (worn on the character + the map traveler) ----
  drawText('HATS', 14, 166, '#c8b8a0', 1);
  drawText(hname, 50, 166, '#8aa0a8', 1);
  skinRow(175, HAT_ORDER, () => meta.hat, hatUnlocked,
    (ix, iy, k) => { if (HATS[k].ico === 'none') rect(ix - 4, iy, 8, 2, '#54707a'); else drawHatArt(ix, iy + 6, k, 1); },
    (k, open, on) => open ? (HATS[k].name + (on ? '|EQUIPPED' : '|CLICK TO WEAR')) : ('LOCKED: ' + HATS[k].name + '|' + (HATS[k].gacha ? 'WIN IT IN THE GACHA-PON' : HATS[k].ach ? 'BEAT A BOSS TO EARN IT' : 'BUY AT THE SHOP CLOSET')),
    k => { meta.hat = k; }, k => HATS[k].rar || 0);

  // ---- GEAR row (face kit: goggles, visors, lenses) ----
  drawText('GEAR', 14, 206, '#c8b8a0', 1);
  drawText(rname, 46, 206, '#8aa0a8', 1);
  skinRow(215, GEAR_ORDER, () => meta.gear, gearUnlocked,
    (ix, iy, k) => { if (k === 'none') rect(ix - 4, iy, 8, 2, '#54707a'); else drawGearArt(ix, iy - 1, k, 1); },
    (k, open, on) => open ? (GEAR[k].name + '|' + GEAR[k].flav + (on ? '|EQUIPPED' : '|CLICK TO WEAR')) : ('LOCKED: ' + GEAR[k].name + '|' + (GEAR[k].gacha ? 'WIN IT IN THE GACHA-PON' : 'BUY AT THE SHOP CLOSET')),
    k => { meta.gear = k; }, k => GEAR[k].rar || 0);

  button(W / 2 - 45, 246, 90, 16, '< BACK', '#3a5560', '#243a44', () => { G.state = 'menu'; }, { id: 'skinback' });
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
// ===================== THE INTERVIEW (tutorial) ===========================
//  Mrs Owlet does not hand out badges.  She runs you through a timed oral
//  exam and then a practical on a training gator, and stamps the form.
// ==========================================================================
const IV_QS = [
  {
    q: 'A gator opens wide. What are you actually paid to do?',
    a: ['Press teeth to bank TEETH x MULT', 'Count the gator', 'Run'],
    right: 0,
    why: 'Every tooth you press adds its value. Bank before the jaws shut.',
  },
  {
    q: 'One tooth in that mouth is a SNAPPER. Press it and?',
    a: ['Nothing, it is decorative', 'The jaws slam and the bite is lost', 'You get paid double'],
    right: 1,
    why: 'A snapper ends the bite and everything unbanked goes with it.',
  },
  {
    q: 'You are one tooth from the target. What does a professional do?',
    a: ['Press every last tooth', 'BANK the bite and keep the score', 'Close their eyes'],
    right: 1,
    why: 'Banking locks the score in. Greed is how we lose rangers.',
  },
  {
    q: 'The X-RAY. What is it for?',
    a: ['Looking cool', 'Revealing whether one tooth is safe or a snapper', 'Warming your hands'],
    right: 1,
    why: 'You get a few per round. Spend them when the maw is nearly empty.',
  },
];
const IV_TIME = 9;

const IV_LESSONS = [
  {
    title: 'THE MOUTH',
    body: 'Every gator holds a row of teeth. Press one and its value goes on the board. Press another, and another - they stack.',
    say: "First, the job itself. You press teeth. The mouth pays you for each one.",
    art: 'press',
  },
  {
    title: 'THE SNAPPER',
    body: 'One tooth in that mouth is a SNAPPER. Press it and the jaws slam. Everything you had not banked is gone.',
    say: "Now the part that costs rangers their fingers. One tooth always bites.",
    art: 'snap',
  },
  {
    title: 'MIRROR AND LEDGER',
    body: 'X-RAY shows you whether one tooth is safe. BANK locks your score in before the jaws move. Use both.',
    say: "Two tools. The mirror looks. The ledger keeps. Greed keeps neither.",
    art: 'tools',
  },
];
// the little diagram on each lesson card
function ivLessonArt(kind, x, y, w, h, t) {
  const gum = ['#3a0a16', '#5a1020', '#8a2438', '#b8405a', '#d4587a'];
  const jaw = ['#1b4a14', '#2f7d22', '#4aa832', '#6fd04a', '#9ae86a'];
  const tooth = ['#8f8468', '#c8bfa0', '#e8e0c4', '#fdfaec', '#ffffff'];
  plasticBox(x, y, w, h, 4, ['#12100a', '#1a2630', '#243038', '#33454e', '#6f8b98'], { noShine: 1 });
  const cx2 = x + w / 2, my2 = y + h / 2;
  if (kind === 'press') {
    plasticBox(x + 10, my2 - 22, w - 20, 12, 3, jaw, { noShine: 1 });
    plasticBox(x + 10, my2 + 14, w - 20, 12, 3, jaw, { noShine: 1 });
    plasticBox(x + 10, my2 - 10, w - 20, 24, 3, gum, { noShine: 1 });
    const pressed = (t * 1.4 | 0) % 4;
    for (let k = 0; k < 4; k++) {
      const tx = x + 18 + k * ((w - 36) / 4), on = k === pressed;
      plasticBox(tx, my2 - 8 + (on ? 5 : 0), 16, on ? 13 : 18, 3, tooth, { noShine: 1 });
      if (!on) drawTextC('' + (3 + k), tx + 8, my2, '#6d5c3a', 1);
    }
    const fy = (t * 40) % 40;
    ctx.save(); ctx.globalAlpha = 1 - fy / 40;
    drawTextC('+' + (3 + pressed), x + 26 + pressed * ((w - 36) / 4), my2 - 14 - fy, '#63d66a', 1);
    ctx.restore();
  } else if (kind === 'snap') {
    const bite = Math.max(0, Math.sin(t * 2)) * 14;
    plasticBox(x + 10, my2 - 24 + bite, w - 20, 12, 3, jaw, { noShine: 1 });
    plasticBox(x + 10, my2 + 16 - bite, w - 20, 12, 3, jaw, { noShine: 1 });
    plasticBox(x + 10, my2 - 12 + bite, w - 20, 28 - bite * 2, 3, gum, { noShine: 1 });
    for (let k = 0; k < 4; k++) {
      const tx = x + 18 + k * ((w - 36) / 4), bad = k === 2;
      plasticBox(tx, my2 - 8 + bite, 16, Math.max(4, 16 - bite), 3,
        bad ? ['#3a0c0c', '#7a1f1f', '#c23a2a', '#e86a4a', '#ffb0a0'] : tooth, { noShine: 1 });
      if (bad && bite < 4) drawTextC('!', tx + 8, my2 - 4, '#fff', 1);
    }
    if (bite > 10) { ctx.save(); ctx.globalAlpha = 0.8; drawTextC('SNAP!', cx2, my2 - 2, '#ff6a4a', 2); ctx.restore(); }
  } else {
    plasticBox(x + 12, my2 - 18, w - 24, 22, 4, ['#0f2540', '#1e4fa3', '#3f8cff', '#77b4ff', '#cfe6ff'], { noShine: 1 });
    drawTextC('X-RAY', cx2, my2 - 11, '#ffffff', 1);
    plasticBox(x + 12, my2 + 8, w - 24, 22, 4, ['#123014', '#2b6b2c', '#63d66a', '#96eb9c', '#dcffd8'], { noShine: 1 });
    drawTextC('BANK BITE', cx2, my2 + 15, '#0f2a0f', 1);
    const bl = Math.sin(t * 4) > 0;
    ctx.save(); ctx.globalAlpha = bl ? 0.9 : 0.3;
    rect(x + 6, my2 - 10, 5, 2, '#9fe8ff'); rect(x + w - 11, my2 + 16, 5, 2, '#a8f0a0');
    ctx.restore();
  }
}

function startTutorial() {
  G.iv = { phase: 'teach', lesson: 0, q: 0, t: 0, timeLeft: IV_TIME, picked: -1, score: 0, mark: 0, drill: null, said: '' };
  ivSay(IV_LESSONS[0].say);
  G.state = 'tutorial';
  sfx.whoosh();
}
function ivSay(txt) { if (G.iv) { G.iv.said = txt; G.iv.sayT = 0; } }
function ivFinish() {
  meta.tutDone = true; saveMeta();
  G.iv = null; G.state = 'ranger'; sfx.whoosh();
}

function drawTutorial(dt) {
  const iv = G.iv; if (!iv) { G.state = 'menu'; return; }
  iv.t += dt; iv.sayT = (iv.sayT || 0) + dt;
  drawOfficeRoom();

  // Mrs Owlet runs the room from behind her desk
  const talking = iv.sayT < iv.said.length / 30 + 0.3;
  const mood = iv.phase === 'result' ? (iv.score >= 3 ? 'happy' : 'stern') : (iv.phase === 'quiz' && iv.timeLeft < 3 ? 'stern' : 'calm');
  drawOwlet(14, 92, { expr: mood, talk: talking, phase: 0.4 });
  drawOwletDesk();
  drawTextCSh('FIELD CERTIFICATION', W / 2, 5, C.gold, 2);

  // her line, on letterhead
  (function bubble() {
    const bx = 96, by = 68, bw = 132, bh = 56;
    plasticBox(bx, by, bw, bh, 4, ['#2a1d12', '#c9bfa4', '#e8e0cc', '#f6f0e0', '#ffffff'], { noShine: 1 });
    drawText('MRS OWLET', bx + 6, by + 5, '#8a7a58', 1);
    rect(bx + 4, by + 12, bw - 8, 1, '#c9bfa4');
    drawSmallWrapped(iv.said.slice(0, Math.floor(iv.sayT * 30)), bx + 6, by + 16, bw - 12, '#2a1d12');
    rect(bx - 4, by + 16, 5, 4, '#e8e0cc');
  })();

  // ------------------------------------------------------ lessons --------
  if (iv.phase === 'teach') {
    const L = IV_LESSONS[iv.lesson];
    const px = 238, py = 36, pw = 234, phh = 184;
    plasticBox(px, py, pw, phh, 4, ['#2a1d12', '#c9bfa4', '#ece5d2', '#f8f2e4', '#ffffff'], { noShine: 1 });
    drawText('LESSON ' + (iv.lesson + 1) + ' OF ' + IV_LESSONS.length, px + 8, py + 7, '#8a7a58', 1);
    drawTextC(L.title, px + pw / 2, py + 18, '#2a1d12', 2);
    rect(px + 8, py + 30, pw - 16, 1, '#c9bfa4');
    ivLessonArt(L.art, px + 16, py + 36, pw - 32, 70, iv.t);
    drawSmallWrapped(L.body, px + 10, py + 114, pw - 20, '#2a1d12');
    // progress pips
    IV_LESSONS.forEach((q, i) => {
      plasticBox(px + pw / 2 - (IV_LESSONS.length * 11) / 2 + i * 11, py + phh - 34, 8, 6, 2,
        i <= iv.lesson ? [UGOLD[0], UGOLD[1], UGOLD[2], UGOLD[3], UGOLD[4]] : ['#2a1d12', '#9a8f76', '#b8ad92', '#ddd4bd', '#ffffff'], { noShine: 1 });
    });
    if (iv.t > 1.2) {
      const last = iv.lesson >= IV_LESSONS.length - 1;
      button(px + pw / 2 - 56, py + phh - 24, 112, 20, last ? 'I AM READY >' : 'GO ON >', '#d94f30', '#8a2a16', () => {
        if (last) { iv.phase = 'quiz'; iv.q = 0; iv.t = 0; iv.picked = -1; iv.timeLeft = IV_TIME; ivSay('Good. Four questions. The clock is running.'); }
        else { iv.lesson++; iv.t = 0; ivSay(IV_LESSONS[iv.lesson].say); }
        sfx.click(2);
      }, { id: 'ivnext' });
    }
  }
  // ---------------------------------------------------- oral exam --------
  else if (iv.phase === 'quiz') {
    const Q = IV_QS[iv.q];
    if (iv.picked < 0) {
      iv.timeLeft -= dt;
      if (iv.timeLeft <= 0) { iv.picked = -2; iv.t = 0; ivSay('Time. That counts as a no.'); sfx.error(); }
    }
    // the paper the question is printed on
    const px = 238, py = 40, pw = 234, phh = 176;
    plasticBox(px, py, pw, phh, 4, ['#2a1d12', '#c9bfa4', '#ece5d2', '#f8f2e4', '#ffffff'], { noShine: 1 });
    drawText('QUESTION ' + (iv.q + 1) + ' OF ' + IV_QS.length, px + 8, py + 7, '#8a7a58', 1);
    // the clock
    const frac = clamp(iv.timeLeft / IV_TIME, 0, 1);
    segBar(px + pw - 78, py + 5, 70, 9, frac, { tint: frac < 0.34 ? '#d94f30' : '#63d66a', tintL: '#ffffff' });
    rect(px + 8, py + 16, pw - 16, 1, '#c9bfa4');
    drawSmallWrapped(Q.q, px + 8, py + 21, pw - 16, '#2a1d12');
    Q.a.forEach((txt, i) => {
      const ay = py + 52 + i * 30;
      const chosen = iv.picked === i, correct = iv.picked >= 0 && i === Q.right;
      const face = correct ? ['#123014', '#2b6b2c', '#3f9440', '#63d66a', '#b8f0b0']
        : chosen ? ['#3a0c0c', '#7a1f1f', '#b03030', '#e06a5a', '#ffb0a0']
          : ['#2a1d12', '#b8ad92', '#ddd4bd', '#f0e9d8', '#ffffff'];
      plasticBox(px + 8, ay, pw - 16, 26, 3, face, { noShine: 1 });
      plasticBox(px + 12, ay + 5, 16, 16, 3, ['#2a1d12', '#9a8f76', '#c4bba2', '#e4dcc6', '#ffffff'], { noShine: 1 });
      drawTextC(String.fromCharCode(65 + i), px + 20, ay + 9, '#2a1d12', 1);
      if (correct) { rect(px + 16, ay + 12, 2, 4, '#1c4a1c'); rect(px + 18, ay + 14, 2, 2, '#1c4a1c'); rect(px + 20, ay + 9, 2, 6, '#1c4a1c'); }
      if (chosen && !correct) { for (let k = 0; k < 5; k++) { rect(px + 15 + k, ay + 7 + k, 2, 2, '#5a1010'); rect(px + 23 - k, ay + 7 + k, 2, 2, '#5a1010'); } }
      drawSmallWrapped(txt, px + 34, ay + 5, pw - 46, correct || chosen ? '#ffffff' : '#2a1d12');
      if (iv.picked < 0) {
        hit(px + 8, ay, pw - 16, 26, {
          id: 'ivq' + i, cursor: true,
          cb: () => {
            iv.picked = i; iv.t = 0;
            if (i === Q.right) { iv.score++; ivSay('Correct. ' + Q.why); sfx.win(); fxStars(px + pw / 2, ay + 13, '#63d66a', 8, 90); }
            else { ivSay('No. ' + Q.why); sfx.error(); shake = Math.max(shake, 4); }
          },
        });
      }
    });
    if (iv.picked !== -1 && iv.t > 2.4) {
      iv.q++; iv.picked = -1; iv.t = 0; iv.timeLeft = IV_TIME;
      if (iv.q >= IV_QS.length) { iv.phase = 'drillIntro'; ivSay('Paperwork done. Now show me you can hold a mirror.'); }
      else ivSay(IV_QS[iv.q].q);
    }
  }
  // ------------------------------------------------- practical drill -----
  else if (iv.phase === 'drillIntro') {
    if (iv.t > 2.4) {
      iv.phase = 'drill'; iv.t = 0;
      const snap = ri(0, 3);
      iv.drill = { teeth: [0, 1, 2, 3].map((k) => ({ v: ri(2, 9), snap: k === snap, shown: false, pressed: false })), xrayed: -1, banked: false, step: 0 };
      ivSay('Four teeth. One bites. X-RAY first, then press a safe one, then BANK.');
    }
  } else if (iv.phase === 'drill') {
    const d = iv.drill;
    const px = 238, py = 40, pw = 234, phh = 176;
    plasticBox(px, py, pw, phh, 4, ['#12100a', '#243038', '#33454e', '#4c626f', '#8fa8b4'], { noShine: 1 });
    drawTextC('TRAINING GATOR', px + pw / 2, py + 7, '#9fd8e8', 1);
    // a little practice maw
    const mx0 = px + 18, my0 = py + 24, mw = pw - 36;
    plasticBox(mx0, my0, mw, 26, 4, ['#1b4a14', '#2f7d22', '#4aa832', '#6fd04a', '#9ae86a'], { noShine: 1 });
    plasticBox(mx0, my0 + 28, mw, 54, 4, ['#3a0a16', '#5a1020', '#8a2438', '#b8405a', '#d4587a'], { noShine: 1 });
    plasticBox(mx0, my0 + 84, mw, 22, 4, ['#1b4a14', '#2f7d22', '#4aa832', '#6fd04a', '#9ae86a'], { noShine: 1 });
    d.teeth.forEach((t2, i) => {
      const tx = mx0 + 10 + i * ((mw - 20) / 4), ty = my0 + 34, tw = 30, th = 40;
      const face = t2.pressed ? ['#3a3428', '#6a6252', '#8f8672', '#b2a892', '#d4ccb4']
        : ['#8f8468', '#c8bfa0', '#e8e0c4', '#fdfaec', '#ffffff'];
      plasticBox(tx, ty + (t2.pressed ? 8 : 0), tw, th - (t2.pressed ? 8 : 0), 4, face, { noShine: 1 });
      if (t2.shown) {
        if (t2.snap) { rr(tx + 6, ty - 12, 18, 11, 3, '#8a2a16'); drawTextC('!', tx + 15, ty - 10, '#fff', 1); }
        else { rr(tx + 6, ty - 12, 18, 11, 3, '#2b6b2c'); drawTextC('+', tx + 15, ty - 10, '#fff', 1); }
      }
      if (!t2.pressed) drawTextC('' + t2.v, tx + 15, ty + 16, '#6d5c3a', 1);
      if (!t2.pressed && !d.banked) {
        hit(tx, ty, tw, th, {
          id: 'ivt' + i, cursor: true,
          cb: () => {
            if (d.step === 0) { ivSay('Mirror first, ranger. Use the X-RAY.'); sfx.error(); return; }
            if (t2.snap) { ivSay('That was the snapper. Look before you press.'); sfx.snap(); shake = Math.max(shake, 8); flashRed = 0.5; t2.shown = true; return; }
            t2.pressed = true; d.step = 2; sfx.click(3);
            fxPop(tx + 15, ty + 16, '#ffe089');
            ivSay('Good. Now BANK it before the jaws move.');
          },
        });
      }
    });
    // the two tools
    const bw2 = 96;
    button(px + 14, py + phh - 34, bw2, 24, 'X-RAY', '#3f8cff', '#1e4fa3', () => {
      if (d.step !== 0) { sfx.error(); return; }
      d.teeth.forEach(t2 => { if (t2.snap) t2.shown = true; });
      d.step = 1; sfx.xray();
      ivSay('There it is. Now press one of the others.');
    }, { id: 'ivxray', disabled: d.step !== 0 });
    button(px + pw - bw2 - 14, py + phh - 34, bw2, 24, 'BANK BITE', '#63d66a', '#2c7a3c', () => {
      if (d.step !== 2) { ivSay('Nothing to bank yet.'); sfx.error(); return; }
      d.banked = true; iv.phase = 'result'; iv.t = 0;
      iv.score++; sfx.win(); fxConfetti(W / 2, 120, 26);
      ivSay(iv.score >= 4 ? 'Textbook. Welcome to the patrol.' : 'Rough, but you are hired. Do not make me regret it.');
    }, { id: 'ivbank', disabled: d.step !== 2 });
  }
  // ------------------------------------------------------- the stamp -----
  else if (iv.phase === 'result') {
    const px = 250, py = 52, pw = 210, phh = 152;
    plasticBox(px, py, pw, phh, 4, ['#2a1d12', '#c9bfa4', '#ece5d2', '#f8f2e4', '#ffffff'], { noShine: 1 });
    drawTextC('CERTIFICATE OF FIELD DUTY', px + pw / 2, py + 12, '#8a7a58', 1);
    rect(px + 10, py + 22, pw - 20, 1, '#c9bfa4');
    drawTextC('SCORE  ' + iv.score + ' / ' + (IV_QS.length + 1), px + pw / 2, py + 34, '#2a1d12', 1);
    for (let k = 0; k < IV_QS.length + 1; k++) {
      const on = k < iv.score;
      plasticBox(px + 24 + k * 34, py + 50, 26, 20, 3, on ? ['#123014', '#2b6b2c', '#3f9440', '#63d66a', '#b8f0b0'] : ['#2a1d12', '#a89e86', '#c4bba2', '#ded6c0', '#ffffff'], { noShine: 1 });
      if (on) { rect(px + 30 + k * 34, py + 60, 2, 4, '#0f2a0f'); rect(px + 32 + k * 34, py + 62, 2, 2, '#0f2a0f'); rect(px + 34 + k * 34, py + 56, 2, 6, '#0f2a0f'); }
    }
    // the stamp slams down
    const sT = clamp(iv.t - 0.6, 0, 1);
    if (sT > 0) {
      const drop = (1 - easeOut(sT)) * 60;
      ctx.save();
      ctx.translate(px + pw / 2, py + 108 - drop); ctx.rotate(-0.16);
      ctx.globalAlpha = 0.9;
      rr(-56, -14, 112, 28, 4, '#8a2a16');
      rr(-53, -11, 106, 22, 3, '#c23a2a');
      drawTextC('APPROVED', 0, -4, '#ffe0d0', 2);
      ctx.restore();
      if (sT >= 1 && !iv.stamped) { iv.stamped = true; shake = Math.max(shake, 7); sfx.buy(); fxRing(px + pw / 2, py + 108, '#ff8a6a', 6, 80, 0.4); }
    }
    if (iv.t > 2.2) button(px + pw / 2 - 56, py + phh - 30, 112, 24, 'REPORT FOR DUTY >', '#d94f30', '#8a2a16', ivFinish, { id: 'ivdone' });
  }

  if (iv.phase !== 'result') {
    button(W - 70, H - 24, 62, 18, 'SKIP', '#3a5560', '#243a44', ivFinish, { id: 'ivskip' });
  }
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
// Barn owl, half-moon spectacles, permanently unimpressed.
const OWLET = {
  face: ['#2a1d12', '#c9b9a0', '#e6dac6', '#f6efe2', '#ffffff'],
  body: ['#211608', '#5d4426', '#7d5f38', '#9c7c4e', '#c2a272'],
  suit: ['#0f1a22', '#1c3442', '#2a4d60', '#3a6a82', '#5f9ab4'],
  beak: ['#6a4a08', '#b8891a', '#e8bb38', '#ffe089'],
};
function drawOwlet(x, y, o) {
  o = o || {};
  const P = OWLET, expr = o.expr || 'calm', ph = o.phase || 0;
  const bob = Math.round(Math.sin(tNow * 1.2 + ph) * 1.4);
  const cx = (x + 30) | 0, gy = (y + 70 + bob) | 0;
  const look = { x: clamp((mx - cx) / 90, -1, 1), y: clamp((my - (gy - 48)) / 90, -1, 1) };
  ctx.save();
  ctx.translate(cx, gy);
  ctx.save(); ctx.globalAlpha = 0.3; ctx.scale(1, 0.22); fillCircle(0, -2 / 0.22, 24, '#000'); ctx.restore();
  // ---- wings folded at her sides ----
  const flap = o.talk ? Math.round(Math.sin(tNow * 5 + ph) * 2) : 0;
  [-1, 1].forEach(s => plasticBox(s * 20 - 6, -40 + (s > 0 ? flap : -flap), 12, 26, 5, P.body, { noShine: 1 }));
  // ---- body in a park-service blazer ----
  plasticBox(-18, -46, 36, 46, 8, P.suit);
  plasticBox(-9, -44, 18, 34, 5, ['#1a1208', '#c6bda6', '#e8e0cc', '#f8f2e4', '#ffffff'], { noShine: 1 });
  rect(-2, -44, 4, 32, P.suit[2]);                    // tie
  rect(-3, -44, 6, 4, P.suit[1]);
  plasticBox(-17, -44, 8, 20, 3, P.suit, { noShine: 1 });
  plasticBox(9, -44, 8, 20, 3, P.suit, { noShine: 1 });
  plasticBox(-16, -38, 6, 5, 1, [UGOLD[0], UGOLD[1], UGOLD[2], UGOLD[3], UGOLD[4]], { noShine: 1 });  // manager pin
  // ---- head: the barn owl's heart-shaped facial disc ----
  ctx.save(); ctx.translate(0, -62 + Math.round(Math.sin(tNow * 0.9 + ph) * 1));
  plasticBox(-17, -18, 34, 34, 10, P.body);
  [-1, 1].forEach(s => { rect(s * 13 - 2, -22, 5, 6, P.body[1]); rect(s * 13 - 1, -22, 3, 4, P.body[3]); }); // ear tufts
  plasticBox(-14, -14, 28, 28, 12, P.face, { noShine: 1 });
  rect(-2, -12, 4, 22, P.face[1]);                     // the heart's centre crease
  // spectacles + big anime owl eyes
  [-7, 7].forEach((ex, i) => {
    const dx = Math.round(look.x * 1.4), dy = Math.round(look.y * 1.2);
    fillCircle(ex, -2, 7, '#2a1d12');
    fillCircle(ex, -2, 6, '#fdfaf0');
    const closed = expr === 'stern' ? 2 : 0;
    fillCircle(ex + dx, -2 + dy, 4, '#c8901a');
    fillCircle(ex + dx, -2 + dy, 3, '#1a1206');
    rect(ex + dx - 3, -5 + dy, 3, 3, '#ffffff');
    rect(ex + dx + 1, 0 + dy, 1, 1, '#ffffff');
    if (closed) { rect(ex - 7, -9, 14, closed + 2, P.face[2]); rect(ex - 7, -9 + closed + 2, 14, 1, '#2a1d12'); }
    if (expr === 'happy') { rect(ex - 5, -3, 2, 1, '#2a1d12'); rect(ex - 3, -5, 2, 1, '#2a1d12'); rect(ex - 1, -5, 2, 1, '#2a1d12'); rect(ex + 1, -3, 2, 1, '#2a1d12'); rect(ex - 6, -9, 12, 6, P.face[2]); }
    // half-moon spectacle
    rect(ex - 8, -2, 16, 1, UGOLD[2]);
    for (let k = 0; k < 9; k++) { const a = Math.PI * (k / 8); rect(ex + Math.round(Math.cos(a) * 8), -2 + Math.round(Math.sin(a) * 6), 1, 1, UGOLD[3]); }
    if (i === 0) rect(ex + 8, -3, 6, 1, UGOLD[2]);
  });
  // brow, set by mood
  const bl = expr === 'stern' ? 3 : expr === 'happy' ? -2 : 0;
  [-7, 7].forEach((ex, i) => { for (let k = 0; k < 9; k++) rect(ex - 4 + k, -11 + Math.round((i ? k : 8 - k) / 8 * bl), 1, 2, '#3a2a18'); });
  // beak + talking jaw
  const talk = o.talk ? Math.abs(Math.sin(tNow * 11 + ph)) : 0;
  rect(-3, 4, 6, 5, P.beak[0]);
  rect(-2, 4, 4, 4, P.beak[2]);
  rect(-1, 4, 2, 2, P.beak[3]);
  if (talk > 0.2) { rr(-3, 8, 6, 1 + Math.round(talk * 4), 2, '#5a2430'); }
  ctx.restore();
  // mood flourish
  if (expr === 'stern' && Math.sin(tNow * 3) > 0.5) { drawText('!', 22, -96, '#ffd54a', 2); }
  ctx.restore();
}

// --------------------------------------------------------- the office ----
// the HQ front office, dressed properly
function drawOfficeRoom() {
  const WL = ['#2a4038', '#36504a', '#3f5a52', '#4e6b5f', '#5d7d6c'];
  rect(0, 0, W, 186, WL[2]);
  for (let x = 0; x < W; x += 22) { rect(x, 0, 1, 186, WL[1]); rect(x + 1, 0, 1, 186, WL[3]); }
  rect(0, 0, W, 8, WL[4]);                                  // cornice
  rect(0, 8, W, 2, WL[0]);
  rect(0, 96, W, 4, WL[4]); rect(0, 100, W, 2, WL[0]);       // dado rail
  rect(0, 102, W, 84, WL[1]);                                 // wainscot below it
  for (let x = 0; x < W; x += 26) { rect(x + 2, 106, 22, 76, WL[2]); rect(x + 2, 106, 22, 1, WL[3]); rect(x + 2, 181, 22, 1, WL[0]); }
  rect(0, 178, W, 8, WL[0]); rect(0, 178, W, 2, WL[3]);       // skirting

  // ---- window onto the moonlit swamp, with a light shaft ----
  (function win2() {
    const wx = 18, wy = 16, ww = 118, wh = 70;
    plasticBox(wx - 5, wy - 5, ww + 10, wh + 10, 3, ['#140c04', '#3a2716', '#5f4326', '#7d5c38', '#9a7548'], { noShine: 1 });
    rect(wx, wy, ww, wh, '#0e2430');
    for (let i = 0; i < wh; i += 2) rect(wx, wy + i, ww, 2, mixHex('#1d4a5e', '#0a1c26', i / wh));
    for (let k = 0; k < 6; k++) { const tx = wx + 8 + k * 20, th = 14 + (k % 3) * 9; rect(tx, wy + wh - th - 12, 3, th, '#081418'); rr(tx - 6, wy + wh - th - 18, 15, 11, 4, '#081418'); }
    rect(wx, wy + wh - 14, ww, 14, '#10323e');
    for (let k = 0; k < 8; k++) rect(wx + 4 + k * 15, wy + wh - 11 + (k % 3) * 3, 9, 1, '#3f8ea8');
    fillCircle(wx + ww - 22, wy + 15, 7, '#f6f2d0');
    rect(wx + ww / 2 - 1, wy, 2, wh, '#5f4326'); rect(wx, wy + wh / 2 - 1, ww, 2, '#5f4326');
    ctx.save(); ctx.globalAlpha = 0.07;                       // shaft of moonlight on the floor
    for (let k = 0; k < 90; k++) rect(wx + 6 + k * 1.1, wy + wh + k, 40, 1, '#cfe8f0');
    ctx.restore();
  })();

  // ---- park map, clock, framed photo, certificate ----
  (function wall() {
    // laminated park map
    plasticBox(150, 14, 74, 54, 2, ['#140c04', '#3a2716', '#5f4326', '#7d5c38', '#9a7548'], { noShine: 1 });
    rect(154, 18, 66, 46, '#d8cfa8');
    rect(154, 18, 66, 8, '#8fae68');
    drawText('PARK', 158, 20, '#2a3a1c', 1);
    for (let k = 0; k < 5; k++) rect(158 + k * 12, 30 + (k % 3) * 9, 9, 6, '#7fb0c8');
    for (let k = 0; k < 8; k++) rect(156 + (k * 13) % 60, 28 + (k * 7) % 30, 2, 2, '#c23a4a');
    for (let k = 0; k < 20; k++) rect(156 + k * 3, 44 + Math.round(Math.sin(k * 0.6) * 5), 3, 1, '#4a7a58');
    // wall clock with real hands
    const cx2 = 246, cy2 = 30;
    fillCircle(cx2, cy2, 13, '#2a1d12'); fillCircle(cx2, cy2, 12, '#e8e0cc'); fillCircle(cx2, cy2, 10, '#f8f2e4');
    for (let k = 0; k < 12; k++) { const a = k / 12 * 6.283; rect(cx2 + Math.cos(a) * 9 - 0.5, cy2 + Math.sin(a) * 9 - 0.5, 1, 1, '#6a5a3a'); }
    const ha = tNow * 0.09, ma = tNow * 1.05;
    rect(cx2, cy2, Math.round(Math.cos(ha) * 5), Math.round(Math.sin(ha) * 5) || 1, '#2a1d12');
    rect(cx2, cy2, Math.round(Math.cos(ma) * 8), Math.round(Math.sin(ma) * 8) || 1, '#2a1d12');
    rect(cx2 - 1, cy2 - 1, 2, 2, '#8a2a16');
    // framed photo of a very large gator
    plasticBox(268, 16, 52, 38, 2, [UGOLD[0], UGOLD[1], UGOLD[2], UGOLD[3], UGOLD[4]], { noShine: 1 });
    rect(272, 20, 44, 30, '#1d3a2a');
    rr(276, 34, 36, 10, 3, '#2f7d22'); rr(276, 28, 36, 6, 2, '#4aa832');
    for (let k = 0; k < 6; k++) rect(279 + k * 6, 34, 3, 3, '#fdfaec');
    rect(282, 24, 4, 4, '#f6f2dc'); rect(303, 24, 4, 4, '#f6f2dc');
    rect(283, 25, 2, 2, '#141010'); rect(304, 25, 2, 2, '#141010');
    // certificate
    plasticBox(330, 16, 44, 34, 2, ['#2a1d12', '#8a7a58', '#c9bfa4', '#e8e0cc', '#ffffff'], { noShine: 1 });
    rect(334, 20, 36, 26, '#f6f0e0');
    for (let k = 0; k < 4; k++) rect(338, 26 + k * 4, 28 - (k % 2) * 8, 1, '#a89468');
    fillCircle(360, 42, 4, '#c23a4a'); rect(358, 44, 4, 4, '#8a2a16');
  })();

  // ---- water cooler, coat rack, filing cabinets, potted palm ----
  (function props() {
    // water cooler
    const wx = 386, wy = 92;
    plasticBox(wx, wy, 26, 46, 3, ['#131c22', '#33454e', '#4c626f', '#7b95a3', '#c3d8e2'], { noShine: 1 });
    plasticBox(wx + 3, wy - 24, 20, 26, 6, ['#0d2a30', '#1d5060', '#2f7d90', '#5fb0c4', '#bfeef2'], { noShine: 1 });
    ctx.save(); ctx.globalAlpha = 0.5; rect(wx + 6, wy - 20, 4, 16, '#dff8ff'); ctx.restore();
    const bb = (tNow * 1.2) % 1;
    fillCircle(wx + 13, wy - 4 - bb * 16, 2, '#9fe8ff');
    rect(wx + 6, wy + 12, 14, 4, '#1d3038'); rect(wx + 10, wy + 16, 6, 4, '#8fa8b4');
    for (let k = 0; k < 3; k++) rect(wx + 4, wy + 26 + k * 5, 8, 4, '#dfeaee');
    // coat rack with hats
    rect(430, 40, 3, 74, '#3a2a18'); rect(420, 40, 24, 3, '#3a2a18');
    rect(418, 42, 4, 4, '#5a4028'); rect(442, 42, 4, 4, '#5a4028');
    drawHatArt(424, 46, 'ranger', 1); drawHatArt(442, 46, 'straw', 1);
    rect(424, 60, 14, 22, '#2c4436'); rect(424, 60, 14, 3, '#3d5c49');   // a spare vest
    // filing cabinets
    plasticBox(150, 86, 46, 52, 3, ['#131c22', '#33454e', '#4c626f', '#7b95a3', '#c3d8e2'], { noShine: 1 });
    for (let k = 0; k < 3; k++) { rect(154, 90 + k * 16, 38, 14, '#3f5560'); rect(154, 90 + k * 16, 38, 1, '#7b95a3'); rect(168, 95 + k * 16, 10, 3, '#c8d2d8'); }
    rect(156, 80, 34, 6, '#2a3a30'); rect(158, 74, 30, 8, '#3a5a44');
    for (let k = 0; k < 5; k++) { rect(160 + k * 6, 68, 3, 8, '#63d66a'); rect(159 + k * 6, 64, 5, 5, '#4aa832'); }   // fern on top
    // stack of crates
    plasticBox(206, 104, 36, 34, 2, ['#241405', '#40230c', '#5c3413', '#74441c', '#8f5a28'], { noShine: 1 });
    rect(210, 108, 28, 2, '#40230c'); rect(210, 122, 28, 2, '#40230c');
    plasticBox(212, 84, 26, 22, 2, ['#241405', '#40230c', '#5c3413', '#74441c', '#8f5a28'], { noShine: 1 });
    drawText('HQ', 220, 92, '#2a1a08', 1);
    // ceiling fan
    const fa = tNow * 3.1;
    rect(236, 0, 2, 9, '#2a3a34');
    ctx.save(); ctx.translate(237, 10);
    for (let k = 0; k < 4; k++) { const a = fa + k * 1.571; rect(Math.cos(a) * 4, Math.sin(a) * 2 - 1, Math.round(Math.cos(a) * 24), 3, '#5a4a30'); }
    ctx.restore();
    fillCircle(237, 10, 3, '#3a2a18');
    // hanging lamp over the desk
    rect(96, 0, 2, 16, '#241708');
    rr(86, 16, 22, 5, 2, '#2c7d3a'); rr(88, 16, 18, 3, 2, '#63d66a');
    rr(92, 21, 10, 4, 1, '#fff6c8');
    glow(97, 24, 40, '#ffcc6a', 0.26);
  })();

  // ---- floor, rug, dust ----
  rect(0, 186, W, H - 186, '#5a4026');
  rect(0, 186, W, 3, '#7a5a38');
  for (let x = -20; x < W; x += 36) { rect(x + 8, 189, 1, H - 189, '#46301c'); }
  for (let y = 196; y < H; y += 18) rect(0, y, W, 1, '#4e3620');
  rr(96, 206, 300, 52, 6, '#2f4a3e');
  rr(102, 210, 288, 44, 5, '#3f6454');
  rect(110, 216, 272, 3, '#2f4a3e'); rect(110, 246, 272, 3, '#2f4a3e');
  for (let k = 0; k < 9; k++) rect(118 + k * 32, 224, 16, 16, '#4e7a66');
  ctx.save();
  for (let d = 0; d < 16; d++) {
    const f = ((tNow / (7 + (d % 4) * 2)) + d * 0.17) % 1;
    ctx.globalAlpha = (0.26 - f * 0.2);
    rect(22 + ((d * 61) % 120), 20 + f * 150, 1, 1, '#cfe8f0');
  }
  ctx.restore();
}

// the desk that Mrs Owlet sits behind
function drawOwletDesk() {
  const dx = 30, dy = 150, dw = 190, dh = 60;
  plasticBox(dx, dy, dw, dh, 4, ['#1c1208', '#4a3520', '#6a4f30', '#8a6a42', '#a98a5c']);
  rect(dx + 4, dy + 14, dw - 8, 2, '#4a3520');
  plasticBox(dx + 10, dy + 20, 54, 34, 2, ['#1c1208', '#3a2a18', '#57402a', '#6f5436', '#8a6a42'], { noShine: 1 });
  for (let k = 0; k < 2; k++) { rect(dx + 14, dy + 24 + k * 15, 46, 12, '#43301c'); rect(dx + 32, dy + 29 + k * 15, 12, 3, UGOLD[2]); }
  // nameplate
  plasticBox(dx + 88, dy - 12, 96, 14, 2, [UGOLD[0], UGOLD[1], UGOLD[2], UGOLD[3], UGOLD[4]], { noShine: 1 });
  drawTextC('MRS OWLET', dx + 136, dy - 10, '#3a2606', 1);
  drawTextC('PARK MANAGER', dx + 136, dy - 4, '#6a4f10', 1);
  // mug + paper stack + stamp
  plasticBox(dx + 152, dy - 34, 14, 12, 3, ['#2a1018', '#7a2a36', '#a8384a', '#d05a6a', '#f09aa6'], { noShine: 1 });
  rect(dx + 166, dy - 31, 4, 6, '#a8384a'); rect(dx + 154, dy - 34, 10, 2, '#f0e8d8');
  ctx.save(); ctx.globalAlpha = 0.4 + Math.sin(tNow * 2) * 0.2;
  for (let k = 0; k < 3; k++) rect(dx + 156 + k * 3, dy - 40 - ((tNow * 8 + k * 4) % 8), 1, 3, '#cfe8f0');
  ctx.restore();
  for (let k = 0; k < 4; k++) rect(dx + 16 + k, dy - 6 - k, 40, 2, k % 2 ? '#e8dfc2' : '#f4ecd6');
  plasticBox(dx + 62, dy - 14, 14, 14, 2, ['#12100a', '#2a2018', '#3f3226', '#5a4834', '#7a6448'], { noShine: 1 });
  rect(dx + 64, dy - 4, 10, 4, '#8a2a16');
}

const OWLET_LINES = {
  idle: [
    "Everglades Dental Patrol. You are the one who answered the advert?",
    "Sit. Mind the chair, the last applicant did not.",
    "Three rangers went into that swamp last season. Two came back.",
    "The pay is teeth. The dental plan is excellent, obviously.",
  ],
  pick: [
    "Hm. I have read your file. Twice.",
    "Field record noted. Do not embarrass the badge.",
    "This one has hands like a surgeon. Or a pickpocket.",
  ],
  hire: ["Then the job is yours. Try to keep all of your fingers."],
};
let owletSay = null;   // {txt, t}
function owletTalk(txt) { owletSay = { txt, t: 0 }; }

// ------------------------------------------- HQ: the job application -----
let rangerSlide = { from: 0, t: 1, dir: 1 };
function rangerStep(d) {
  const i = RANGER_ORDER.indexOf(rangerFocus);
  const n = (i + d + RANGER_ORDER.length) % RANGER_ORDER.length;
  rangerSlide = { from: i, t: 0, dir: d };
  rangerFocus = RANGER_ORDER[n];
  sfx.click(2);
  owletTalk(choice(OWLET_LINES.pick));
}

// ------------------------------------------- HQ: the job application -----
// One applicant at a time, stood on the rug in front of the desk.  Swipe or
// use the arrows to flick through the file, then sign on.
function drawRangerSelect() {
  if (G.summer) { G.summer = false; G.mut = null; }
  if (!rangerFocus) rangerFocus = meta.ranger || 'scout';
  if (!owletSay) owletTalk(choice(OWLET_LINES.idle));
  owletSay.t += 1 / 60;
  rangerSlide.t = Math.min(1, rangerSlide.t + 1 / 12);

  drawOfficeRoom();
  const idx = RANGER_ORDER.indexOf(rangerFocus);
  const r = RANGERS[rangerFocus];
  const focusOpen = rangerUnlocked(rangerFocus);
  const lvl = masteryLvl(rangerFocus);

  // ---- Mrs Owlet at her desk on the left ----
  const talking = owletSay.t < owletSay.txt.length / 30 + 0.3;
  drawOwlet(6, 84, { expr: focusOpen ? (talking ? 'calm' : 'happy') : 'stern', talk: talking });
  drawOwletDesk();
  (function bubble() {
    const bw = 112, bx = 88, by = 62;
    plasticBox(bx, by, bw, 50, 4, ['#2a1d12', '#c9bfa4', '#e8e0cc', '#f6f0e0', '#ffffff'], { noShine: 1 });
    drawText('MRS OWLET', bx + 6, by + 5, '#8a7a58', 1);
    rect(bx + 4, by + 12, bw - 8, 1, '#c9bfa4');
    drawSmallWrapped(owletSay.txt.slice(0, Math.floor(owletSay.t * 30)), bx + 6, by + 16, bw - 12, '#2a1d12');
    rect(bx - 4, by + 18, 5, 4, '#e8e0cc');
    hit(bx, by, bw, 50, { id: 'owlet', cursor: true, cb: () => owletTalk(choice(OWLET_LINES.idle)) });
  })();

  drawTextCSh('APPLICATION FOR FIELD DUTY', W / 2, 5, C.gold, 2);

  // ---- the applicant, centre stage ----
  const stageX = 322, footY = 196;
  ctx.save(); ctx.globalAlpha = 0.28; ctx.scale(1, 0.24); fillCircle(stageX, footY / 0.24, 30, '#000'); ctx.restore();
  const slide = 1 - easeOut(rangerSlide.t);
  ctx.save();
  ctx.translate(slide * rangerSlide.dir * -90, 0);
  ctx.globalAlpha = 1 - slide * 0.8;
  if (!focusOpen) ctx.globalAlpha *= 0.4;
  drawBobble(stageX, footY, rangerFocus, {
    sc: 1.75, expr: focusOpen ? 'happy' : 'sleepy', act: focusOpen ? 'idle' : 'idle',
    hat: meta.hat, gear: meta.gear, glove: meta.glove,
  });
  ctx.restore();
  // their badge on a little stand beside them
  drawRangerBadge(stageX + 44, footY - 78, rangerFocus, { sc: 1.5, locked: !focusOpen, wob: 1 });
  drawTextC(focusOpen ? MASTERY_TIER[lvl] : 'SEALED', stageX + 65, footY - 34, focusOpen ? MASTERY_COL[lvl] : '#8a2a16', 1);

  // ---- name plate + dossier under them ----
  plasticBox(240, 200, 166, 48, 4, ['#2a1d12', '#c9bfa4', '#ece5d2', '#f8f2e4', '#ffffff'], { noShine: 1 });
  drawTextC(focusOpen ? r.name : 'SEALED FILE', 323, 204, focusOpen ? '#2a1d12' : '#8a2a16', 1);
  drawTextC(focusOpen ? r.animal : '- - -', 323, 213, '#7a6a4a', 1);
  rect(246, 221, 154, 1, '#c9bfa4');
  if (focusOpen) {
    const nx = masteryNext(rangerFocus);
    segBar(248, 224, 150, 8, nx ? (masteryXp(rangerFocus) - nx.from) / Math.max(1, nx.need - nx.from) : 1, { tint: MASTERY_COL[lvl], tintL: '#ffffff' });
    drawTextC(nx ? 'MASTERY  ' + (masteryXp(rangerFocus) - nx.from) + ' / ' + (nx.need - nx.from) : 'MASTERY MAXED', 323, 235, '#6a5a3a', 1);
  } else {
    const a2 = ACHS.find(q => q.id === r.ach);
    drawTextC(a2 ? 'EARN: ' + a2.name : 'LOCKED', 323, 227, '#8a2a16', 1);
  }

  // ---- the duties, on HQ paper ----
  plasticBox(8, 196, 214, 56, 3, ['#2a1d12', '#c9bfa4', '#e8e0cc', '#f6f0e0', '#ffffff'], { noShine: 1 });
  drawText('DUTIES OF THE POST', 13, 200, '#8a7a58', 1);
  rect(12, 208, 206, 1, '#c9bfa4');
  if (focusOpen) {
    r.lines.forEach((l, k) => { rect(13, 213 + k * 9, 4, 4, r.col); drawText(l.slice(0, 38), 21, 212 + k * 9, '#2a1d12', 1); });
    drawText("'" + r.flav.slice(0, 40) + "'", 13, 234, '#7a6a4a', 1);
  } else drawSmallWrapped('FILE SEALED BY ORDER OF THE PARK MANAGER.', 13, 214, 200, '#8a2a16');

  // ---- the roster, as a row of file tabs ----
  // ---- carousel pips under the applicant ----
  RANGER_ORDER.forEach((k, i) => {
    const on = i === idx, open = rangerUnlocked(k);
    const px = 323 - (RANGER_ORDER.length * 11) / 2 + i * 11;
    plasticBox(px, 190, 8, 6, 2, on ? [UGOLD[0], UGOLD[1], UGOLD[2], UGOLD[3], UGOLD[4]]
      : open ? ['#1a2620', '#3a5045', '#547265', '#6f9384', '#9fc0b0'] : ['#1a1a1a', '#2c2c2c', '#3c3c3c', '#4c4c4c', '#6a6a6a'], { noShine: 1 });
    hit(px - 1, 187, 10, 12, { id: 'pip' + k, cursor: true, cb: () => { if (k !== rangerFocus) { rangerSlide = { from: idx, t: 0, dir: i > idx ? 1 : -1 }; rangerFocus = k; sfx.click(2); owletTalk(choice(OWLET_LINES.pick)); } }, tip: RANGERS[k].name });
  });

  // ---- arrows, and a swipe anywhere on the stage ----
  const arrow = (ax, dir, id) => {
    const hov = mx >= ax && mx < ax + 30 && my >= 120 && my < 170;
    plasticBox(ax, 126 + (hov ? -2 : 0), 30, 40, 5, [UGOLD[0], UGOLD[1], UGOLD[2], UGOLD[3], UGOLD[4]], { noShine: 1 });
    for (let k = 0; k < 9; k++) { const hh = 2 + k * 2; rect(ax + 15 + dir * (8 - k) - 1, 146 - hh / 2 + (hov ? -2 : 0), 2, hh, '#3a2606'); }
    hit(ax, 120, 30, 52, { id, cursor: true, cb: () => rangerStep(dir) });
  };
  arrow(240, -1, 'prevr'); arrow(432, 1, 'nextr');
  if (down && down.hit && down.hit.id === 'swipe') {
    const dxs = mx - down.x;
    if (Math.abs(dxs) > 34) { rangerStep(dxs < 0 ? 1 : -1); down = null; }
  }
  hit(238, 60, 232, 150, { id: 'swipe', cursor: true, click: () => { }, tip: 'SWIPE OR USE THE ARROWS' });
  drawTextCSh('< SWIPE TO MEET THE PATROL >', 323, 56, '#e8dfc2', 1, '#1a2620');

  button(W - 122, H - 24, 116, 20, focusOpen ? 'SIGN ON >' : 'LOCKED', '#d94f30', '#8a2a16',
    () => {
      if (!focusOpen) { sfx.error(); return; }
      owletTalk(OWLET_LINES.hire[0]); meta.ranger = rangerFocus; saveMeta();
      startTransition(() => { newRun(rangerFocus); startIntro(); });
    }, { id: 'hire', disabled: !focusOpen });
  button(W - 244, H - 24, 60, 20, 'DRILL', '#3a6a8a', '#204458', () => { startTutorial(); }, { id: 'tutbtn', tip: 'REFRESHER DRILL|Mrs Owlet runs you through the basics' });
  button(6, H - 24, 54, 20, '< BACK', '#4a4438', '#28241c', () => { G.state = 'menu'; sfx.click(2); }, { id: 'rback' });
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
function nodePos(stage, k, count) {
  const xs = [190, 292, 394];
  const ys = count === 1 ? [150] : count === 2 ? [104, 190] : [84, 148, 206];
  return { x: xs[stage], y: ys[k] };
}
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
    rr(x, y + 4, 22, 9, 3, a);
    rr(x + 1, y + 10, 20, 4, 2, b);
    [[x + 3], [x + 13]].forEach(([ex]) => {
      rr(ex, y, 7, 7, 2, a);
      rect(ex + 2, y + 2, 3, 3, sclera);
      rect(ex + 3, y + 3, 1, 2, pupil);
    });
    if (type === 'small' && !mu) { rect(x + 5, y + 2, 2, 2, '#4a9636'); rect(x + 15, y + 2, 2, 2, '#4a9636'); rect(x + 3, y + 8, 2, 1, '#9ce85c'); rect(x + 17, y + 8, 2, 1, '#9ce85c'); }
    if (type === 'gold' && !mu) { rect(x + 8, y - 3, 2, 2, '#fff6c8'); rect(x + 16, y + 2, 1, 1, '#fff6c8'); }
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
// ------------------------------------------------------------- THE LAKE ----
// A full pixel-art lake the trail crosses: layered depth bands, a glitter
// path, drifting mist, lily pads, reed beds, cruising fish and a live shore.
const LAKE = { x: 64, y: 44, w: 382, h: 186 };
function lakePal() {
  return G.summer
    ? { deep: '#0a3446', mid: '#11566a', shal: '#1d8298', foam: '#9ff0ff', glint: '#d6fbff', lily: '#2fa07c', lilyD: '#1c6f56', bank: '#c8b078', bankD: '#8f7a48', tree: '#0d4256', reed: '#3aa88a' }
    : { deep: '#0e2b36', mid: '#1a4a5e', shal: '#2a7286', foam: '#8ad8e4', glint: '#c8f4ff', lily: '#4a9a4e', lilyD: '#2c6632', bank: '#3d5434', bankD: '#22361d', tree: '#0d2a20', reed: '#6fae56' };
}
function drawLake() {
  const L = LAKE, P = lakePal();
  ctx.save();
  ctx.beginPath(); ctx.rect(L.x, L.y, L.w, L.h); ctx.clip();
  // ---- far bank + treeline silhouette along the top ----
  rect(L.x, L.y, L.w, 16, G.summer ? '#1b6f86' : '#0b1f26');
  for (let x = L.x; x < L.x + L.w; x += 5) {
    const h = 6 + ((Math.sin(x * 0.17) * 4) | 0) + ((x * 7) % 5);
    rect(x, L.y + 16 - h, 5, h, P.tree);
    if ((x / 5 | 0) % 4 === 0) { rect(x + 1, L.y + 12 - h, 3, 4, P.tree); rect(x + 2, L.y + 9 - h, 1, 4, P.tree); }
  }
  rect(L.x, L.y + 15, L.w, 2, G.summer ? '#0e4a5c' : '#071418');
  // ---- water: depth bands, lightest in the shallows nearest the viewer ----
  const bands = 9, top = L.y + 17, wh = L.h - 17;
  for (let i = 0; i < bands; i++) {
    const f = i / (bands - 1);
    const col = f < 0.5 ? mixHex(P.deep, P.mid, f * 2) : mixHex(P.mid, P.shal, (f - 0.5) * 2);
    rect(L.x, top + Math.floor(wh * i / bands), L.w, Math.ceil(wh / bands) + 1, col);
  }
  // ---- moon/sun glitter column ----
  const gx = L.x + L.w * 0.72;
  for (let i = 0; i < 26; i++) {
    const yy = top + 4 + i * 6, spread = 4 + i * 1.6;
    const off = Math.sin(tNow * 1.1 + i * 0.9) * spread;
    ctx.save(); ctx.globalAlpha = 0.10 + 0.14 * Math.abs(Math.sin(tNow * 1.6 + i));
    rect(gx + off - 5, yy, 11, 1, P.glint);
    ctx.restore();
  }
  ctx.restore();
  // ---- lily pads hugging the left and right margins ----
  const pads = [[14, 30], [30, 78], [12, 124], [34, 168], [20, 200], [352, 36], [370, 92], [344, 148], [362, 192], [336, 214], [58, 212], [300, 218]];
  pads.forEach(([px2, py2], i) => {
    const x = L.x + px2, y = top + (py2 % (wh - 6)) + Math.sin(tNow * 1.1 + i * 1.7) * 1.2;
    const r = 6 + (i % 3);
    ctx.save(); ctx.globalAlpha = 0.22; fillCircle(x + 1, y + 2, r, '#04101a'); ctx.restore();
    fillCircle(x, y, r, P.lilyD); fillCircle(x, y - 1, r - 1, P.lily);
    rect(x, y - 1, r, 2, P.lilyD);                                   // notch
    rect(x - r + 2, y - 2, 3, 1, '#ffffff22');
    if (i % 3 === 0) { fillCircle(x + 2, y - 3, 2, '#f8e0ec'); rect(x + 1, y - 4, 2, 1, '#ffd54a'); } // flower
  });
  // ---- reed beds along the bottom shoreline ----
  rect(L.x, L.y + L.h - 10, L.w, 10, P.bankD);
  rect(L.x, L.y + L.h - 12, L.w, 3, P.bank);
  for (let x = L.x; x < L.x + L.w; x += 6) {
    const sway = Math.sin(tNow * 1.5 + x * 0.09) * 1.5;
    const h = 8 + ((x * 13) % 9);
    rect(x + 1, L.y + L.h - 12 - h, 1, h, P.reed);
    rect(x + 1 + sway, L.y + L.h - 12 - h - 3, 1, 3, P.reed);
    if ((x / 6 | 0) % 5 === 0) rect(x + 1 + sway, L.y + L.h - 12 - h - 6, 2, 3, '#6a5a2a'); // cattail
  }
  // ---- foam line where water meets the bank ----
  ctx.save(); ctx.globalAlpha = 0.4;
  for (let x = L.x; x < L.x + L.w; x += 4) rect(x, L.y + L.h - 13 + Math.sin(tNow * 2 + x * 0.2) * 1, 3, 1, P.foam);
  ctx.restore();
  ctx.restore();
}
// A proper little rowboat: hull, ribs, oars mid-stroke, wake and the ranger.
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

function drawMap() {
  const th = themeNow();
  drawSceneBack(th);
  drawSceneFront(th);
  overlayDim(0.35);
  drawTextCSh(G.summer ? 'THE OPEN OCEAN' : 'THE SWAMP TRAIL', W / 2, 10, G.summer ? '#7fe0f0' : C.gold, 3);
  drawTextCSh(G.summer ? 'ANTE ' + G.ante + ' - ENDLESS SEAS' : 'ANTE ' + G.ante + (G.ante <= 8 ? ' OF 8' : ' - ENDLESS'), W / 2, 34, C.white, 1);
  drawLake();
  rr(LAKE.x - 2, LAKE.y - 2, LAKE.w + 4, LAKE.h + 4, 4, '#00000000');
  // thin frame so the lake reads as a chart window
  rect(LAKE.x, LAKE.y, LAKE.w, 1, '#3a5a50'); rect(LAKE.x, LAKE.y + LAKE.h - 1, LAKE.w, 1, '#3a5a50');
  rect(LAKE.x, LAKE.y, 1, LAKE.h, '#3a5a50'); rect(LAKE.x + LAKE.w - 1, LAKE.y, 1, LAKE.h, '#3a5a50');
  // money + ranger chip
  panel(66, 24, 74, 18, { face: '#26321e', edge: '#5a7a3a' });
  ICONS.coin(72, 28);
  drawText(curLabel(G.money), 88, 29, C.gold, 1);
  // the wooden launch dock the trail starts from
  rr(78, 136, 34, 6, 2, '#3a2818'); rr(79, 135, 32, 5, 2, '#6a4a28');
  for (let k = 0; k < 4; k++) rect(82 + k * 8, 135, 1, 5, '#4a3320');
  rect(84, 141, 3, 12, '#3a2818'); rect(104, 141, 3, 12, '#3a2818');
  drawTextC('DOCK', 95, 156, '#7a8a84', 1);
  // live quest tracker (top-left corner of the chart): your 3 accepted posts
  ensureDaily();
  panel(68, 52, 100, 60, { face: '#10181ecc', edge: '#3a5a50', r: 2 });
  drawText('QUESTS', 74, 56, C.purple, 1);
  const actQ = activeQuests();
  if (!actQ.length) {
    drawText('NONE ACCEPTED', 74, 68, C.dim, 1);
    drawText('VISIT THE', 74, 80, '#8a9a9a', 1);
    drawText('QUEST BOARD!', 74, 90, '#8a9a9a', 1);
  }
  actQ.slice(0, QUEST_MAX).forEach((p, i) => {
    const qy = 65 + i * 15;
    rect(72, qy, 5, 5, NPCS[p.npc] ? NPCS[p.npc].col : C.gold);
    drawText(p.name.slice(0, 12), 81, qy - 1, '#b8c8c8', 1);
    rect(81, qy + 6, 60, 3, '#0a1215');
    const pr = clamp(p.prog / p.goal, 0, 1);
    if (pr > 0) rect(81, qy + 6, Math.floor(60 * pr), 3, C.gold);
    drawText(p.prog + '/' + p.goal, 144, qy + 3, C.dim, 1);
    hit(70, qy - 2, 96, 14, { id: 'qtrack' + p.id, tip: p.name + '|' + p.prog + '/' + p.goal + '  (+' + p.rp + ' COOKIES)' });
  });
  // fog of the next ante on the right
  for (let k = 0; k < 5; k++) {
    ctx.globalAlpha = 0.15 + k * 0.14;
    rect(422 + k * 5, 50, 5, 174, '#060d10');
    ctx.globalAlpha = 1;
  }
  drawTextC('NEXT', 436, 122, '#41565e', 1);
  drawTextC('ANTE', 436, 132, '#41565e', 1);
  // path lines: dock -> stage0 -> stage1 -> boss
  const dotLine = (x1, y1, x2, y2, lit) => {
    const n = 7;
    const march = lit ? (tNow * 1.4) % 1 : 0; // dots flow along active routes
    for (let k = 0; k < n; k++) {
      const f = (k + march) / n;
      if (f <= 0.05 || f >= 0.95) continue;
      const px2 = x1 + (x2 - x1) * f, py2 = y1 + (y2 - y1) * f;
      rect(px2, py2, 2, 2, lit ? '#ffc843aa' : '#3a5a5066');
    }
  };
  // a pair of eyes surfaces in the channel now and then
  if (Math.sin(tNow * 0.35 + 2.1) > 0.55) {
    const ex2 = 240 + Math.sin(tNow * 0.1) * 60;
    const ey2 = 148 + Math.sin(ex2 * 0.03) * 26 - 6;
    [0, 9].forEach(o => {
      rr(ex2 + o, ey2, 7, 5, 2, '#1a3a30');
      rect(ex2 + o + 2, ey2 + 1, 2, 3, '#ffe089');
    });
  }
  // faint web of all routes; the reachable legs glow
  G.map.stages.forEach((opts, s) => {
    opts.forEach((node, k) => {
      const p = nodePos(s, k, opts.length);
      const froms = s === 0
        ? [{ x: 110, y: 148, picked: true }]
        : G.map.stages[s - 1].map((_, j) => Object.assign(nodePos(s - 1, j, G.map.stages[s - 1].length),
          { picked: G.map.picked[s - 1] === j || G.map.picked[s - 1] === undefined }));
      froms.forEach(from => {
        dotLine(from.x + 14, from.y, p.x - 20, p.y, from.picked && s === G.map.stage);
      });
    });
  });
  G.map.stages.forEach((opts, s) => {
    opts.forEach((node, k) => {
      const p = nodePos(s, k, opts.length);
      const d = NODE_DEFS[node.type];
      const reachable = s === G.map.stage;
      const visited = G.map.picked[s] === k;
      const passed = s < G.map.stage;
      const pulse = reachable ? Math.round(Math.sin(tNow * 4) * 1.5) : 0;
      // watery reflection under the island
      ctx.globalAlpha = 0.22;
      rr(p.x - 16, p.y + 20, 32, 5, 2, '#0d2830');
      ctx.globalAlpha = 1;
      // colored glow ring for reachable nodes
      if (s === G.map.stage) {
        ctx.globalAlpha = 0.3 + Math.sin(tNow * 4) * 0.15;
        rr(p.x - 25, p.y - 17 - pulse, 50, 38, 4, d.col);
        ctx.globalAlpha = 1;
      }
      // sandy rim
      rr(p.x - 23, p.y + 14 - pulse, 46, 5, 2, '#8a7a58');
      // island pad
      rr(p.x - 22, p.y - 14 - pulse, 44, 32, 4, passed && !visited ? '#101c1e' : '#16302a');
      rr(p.x - 20, p.y - 12 - pulse, 40, 28, 4, visited ? '#26321e' : reachable ? '#1e3c34' : '#14262a');
      if (reachable) rr(p.x - 22, p.y - 14 - pulse, 44, 32, 4, '#ffc84300');
      // a MUTATION node gets a pulsing halo in its variant colour (like gold's shine)
      const mu = node.mut && MUTATIONS[node.mut];
      if (mu) {
        ctx.save(); ctx.globalAlpha = 0.22 + Math.sin(tNow * 4 + p.x) * 0.14;
        rr(p.x - 24, p.y - 16 - pulse, 48, 36, 5, mu.col); ctx.restore();
      }
      // node art
      if (node.type === 'event') {
        drawTextC('?', p.x, p.y - 8 - pulse, C.purple, 2);
      } else {
        drawMiniGator(p.x - 11, p.y - 10 - pulse, node.type, node.mut);
      }
      // variant name banner above the island, else the plain node type below
      if (mu) drawTextCSh(mu.name, p.x, p.y - 26 - pulse, mu.col, 1, '#0a1215');
      const seaLbl = { small: 'REEF', big: 'TIGER', gold: 'GOLD', boss: 'MEGALODON' };
      const lbl = node.type === 'boss' ? (G.summer ? 'MEGALODON' : 'BOSS')
        : G.summer ? (seaLbl[node.type] || node.type.toUpperCase()) : node.type.toUpperCase();
      drawTextC(lbl, p.x, p.y + 8 - pulse, visited ? C.green : mu ? mu.col : reachable ? d.col : '#41565e', 1);
      (node.mods || []).forEach((m, mi) => {
        const md = NODE_MODS[m];
        const n2 = node.mods.length;
        drawModChip(p.x - (n2 * 13) / 2 + mi * 13 + 1, p.y + 16 - pulse, m);
      });
      if (visited) drawTextC('*', p.x + 24, p.y - 10, C.gold, 1);
      // island dressing: palm on boss, flowers on events, sparkle on gold
      if (node.type === 'boss') {
        rect(p.x + 24, p.y - 22 - pulse, 2, 10, '#4a3320');
        rect(p.x + 20, p.y - 26 - pulse, 5, 3, '#2c5a24'); rect(p.x + 26, p.y - 26 - pulse, 5, 3, '#2c5a24');
        rect(p.x + 23, p.y - 29 - pulse, 4, 3, '#2c5a24');
      }
      if (node.type === 'event') { rect(p.x - 19, p.y + 10 - pulse, 2, 2, '#e8a0c0'); rect(p.x + 17, p.y + 8 - pulse, 2, 2, '#ffe089'); }
      if (node.type === 'gold' && (tNow % 1.2) < 0.2) { rect(p.x + 16, p.y - 12 - pulse, 2, 2, '#fff6c8'); }
      if (reachable && !G.boat) {
        hit(p.x - 22, p.y - 14, 44, 32, {
          id: 'node' + s + '_' + k, cursor: true,
          tip: nodeTip(node),
          cb: () => {
            const from2 = s === 0 ? { x: 97, y: 158 } : (() => { const q = nodePos(s - 1, G.map.picked[s - 1], G.map.stages[s - 1].length); return { x: q.x, y: q.y + 20 }; })();
            const dist = Math.hypot(p.x - from2.x, p.y + 20 - from2.y);
            G.boat = { x: from2.x, y: from2.y, sx: from2.x, sy: from2.y, tx: p.x, ty: p.y + 20, t: 0, k, dur: clamp(dist / 130, 0.7, 1.5), lean: 0 };
            sfx.splash(); addRipple(from2.x, from2.y + 4, false);
          },
        });
      }
    });
  });
  // boat token (ranger aboard)
  const bpos = G.boat ? G.boat
    : G.map.stage === 0 ? { x: 97, y: 158 }
      : (() => { const q = nodePos(G.map.stage - 1, G.map.picked[G.map.stage - 1] || 0, G.map.stages[G.map.stage - 1].length); return { x: q.x, y: q.y + 20 }; })();
  const bob = Math.round(Math.sin(tNow * 2.2) * 1.5);
  const lean = G.boat ? Math.round(G.boat.lean || 0) : 0;
  // wake vee while cruising
  if (G.boat) {
    ctx.save(); ctx.globalAlpha = 0.4;
    const dir = G.boat.tx > G.boat.sx ? -1 : 1;
    for (let k = 1; k <= 4; k++) {
      rect(bpos.x + dir * (12 + k * 6), bpos.y + 4 - k, 5 - k + 2, 1, '#1e4a52');
      rect(bpos.x + dir * (12 + k * 6), bpos.y + 4 + k, 5 - k + 2, 1, '#1e4a52');
    }
    ctx.restore();
  }
  drawRowBoat(bpos.x, bpos.y + bob, lean, !!G.boat);
  drawBobble(bpos.x + lean * 0.4, bpos.y + 1 + bob, G.ranger, {
    sc: 0.42, expr: G.boat ? 'wow' : 'happy', act: G.boat ? 'row' : 'idle',
    hat: meta.hat, gear: meta.gear, glove: meta.glove,
  });
  // the equipped cosmetic GEAR + HAT ride on the traveler
  const gearKey = (meta.gear && gearUnlocked(meta.gear)) ? meta.gear : 'none';
  if (gearKey !== 'none') drawGearArt(bpos.x + lean, bpos.y - 18 + bob, gearKey, 1);
  const hatKey = (meta.hat && hatUnlocked(meta.hat)) ? meta.hat : 'none';
  if (hatKey !== 'none') drawHatArt(bpos.x + lean, bpos.y - 20 + bob, hatKey, 1);
  drawTextC(G.boat ? '. . .' : 'PICK YOUR NEXT STOP', W / 2, 234, C.dim, 1);
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
  const mx2 = (b.sx + b.tx) / 2;
  const my2 = 148 + Math.sin(mx2 * 0.03) * 26 + 8;
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
function drawPassScreen(dt) {
  ensureDaily();
  // cozy back room: dark planks + string lights
  for (let y = 0; y < H; y += 14) {
    rect(0, y, W, 14, ((y / 14) | 0) % 2 ? '#33241a' : '#2c1f14');
    rect(0, y + 13, W, 1, '#1c1208');
  }
  rect(0, 218, W, H - 218, '#241708');
  for (let x = 0; x < W; x += 48) rect(x, 221, 1, H - 221, '#1c1208');
  // string lights
  for (let k = 0; k < 12; k++) {
    const lx = 12 + k * 42, ly = 8 + Math.round(Math.sin(k * 1.2) * 4);
    rect(lx, ly, 42, 1, '#1c1208');
    const on = ((tNow * 2 + k) | 0) % 3 !== 0;
    fillCircle(lx + 20, ly + 4, 2, on ? ['#ffe089', '#ff8ab0', '#7fd4e8'][k % 3] : '#3a2c20');
    if (on) { ctx.save(); ctx.globalAlpha = 0.12; fillCircle(lx + 20, ly + 5, 6, '#ffe089'); ctx.restore(); }
  }
  drawTextCSh('SCOUT GACHA-PON', 130, 20, C.gold, 2);
  drawTextC('TRADE SCOUT COOKIES FOR CAPSULE PRIZES', 130, 38, '#c8a878', 1);
  // cookie balance
  panel(352, 14, 112, 22, { face: '#26321e', edge: '#5a7a3a' });
  ICONS.cookie(358, 19);
  drawText(fmt(meta.rp || 0) + ' COOKIES', 374, 22, C.gold, 1);

  // ---- the machine ----
  const g = G.gacha;
  const mxp = 78, myp = 62;
  const crankA = g && g.phase === 'crank' ? g.t * 14 : 0;
  drawGachaMachine(mxp, myp, g && g.phase === 'crank', crankA, -1);
  const pool = gachaPool();
  const canSpin = (meta.rp || 0) >= GACHA_SPIN && (!g || g.phase === 'reveal');
  button(mxp + 2, 196, 100, 22, 'SPIN', '#d94f30', '#8a2a16', gachaSpin,
    { id: 'gspin', disabled: !canSpin, sub: GACHA_SPIN + ' COOKIES', subCol: '#ffe089', tip: 'GACHA-PON|One capsule per spin: cards, glove skins,|permanent upgrades. Dupes impossible.' });
  const plbl = pool.length ? 'VIEW PRIZES (' + pool.length + ' LEFT) >' : 'EVERY PRIZE COLLECTED!';
  const plw = textW(plbl, 1) + 14;
  panel(mxp + 52 - plw / 2, 222, plw, 13, { face: '#1a2530', edge: '#3a5a50', r: 2 });
  drawTextC(plbl, mxp + 52, 226, pool.length ? '#7fd4e8' : C.gold, 1);
  hit(mxp + 52 - plw / 2, 220, plw, 16, {
    id: 'gshow', cursor: true, tip: 'CAPSULE PRIZE LIST|See everything the machine can drop',
    cb: () => { if (!G.gacha || G.gacha.phase === 'reveal') { G.gacha = null; G.gachaShow = true; sfx.pin(); } },
  });

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

  drawTextC('EARN COOKIES: QUESTS, ACHIEVEMENTS +25, EVENTS +3, ANTES +2', W / 2, 236, '#54707a', 1);
  button(W / 2 - 40, 248, 80, 16, '< BACK', '#3a5560', '#243a44', () => { if (!G.gacha || G.gacha.phase === 'reveal') { G.gacha = null; G.state = 'menu'; } }, { id: 'passback' });

  // ---- prize showcase overlay ----
  if (G.gachaShow) { drawGachaShowcase(); return; }

  // ---- spin animation ----
  if (!g) return;
  g.t += dt;
  if (g.phase === 'crank') {
    if (g.t >= 0.75) { g.phase = 'drop'; g.t = 0; sfx.thunk(); }
  } else if (g.phase === 'drop') {
    // capsule falls from the dome into the tray, two bounces
    const f = clamp(g.t / 0.6, 0, 1);
    const cx2 = mxp + 51, y0 = myp + 40, y1 = myp + 100;
    let yy = y0 + (y1 - y0) * easeIn(Math.min(1, f * 1.4));
    if (f > 0.71) yy = y1 - Math.abs(Math.sin((f - 0.71) * 11)) * 8 * (1 - f);
    fillCircle(cx2, yy, 8, g.capCol);
    ctx.save(); ctx.globalAlpha = 0.5; fillCircle(cx2, yy + 2, 7, '#f4f2e4'); ctx.restore();
    rect(cx2 - 4, yy - 6, 3, 2, '#ffffffaa');
    if (g.t >= 0.72 && !g.bounced) { g.bounced = true; sfx.drop(); }
    if (g.t >= 0.85) { g.phase = 'open'; g.t = 0; sfx.pin(); }
  } else if (g.phase === 'open') {
    // halves fly apart center-screen
    overlayDim(0.5);
    const f = easeOut(clamp(g.t / 0.4, 0, 1));
    const cx2 = W / 2, cy2 = 128;
    ctx.save(); ctx.globalAlpha = 1;
    fillCircle(cx2, cy2 - 14 - f * 46, 13, g.capCol);
    rect(cx2 - 13, cy2 - 14 - f * 46, 26, 7, g.capCol);
    fillCircle(cx2, cy2 + 14 + f * 46, 13, '#f4f2e4');
    rect(cx2 - 13, cy2 + 7 + f * 46, 26, 7, '#f4f2e4');
    ctx.restore();
    if (!g.burst) { g.burst = true; burst(cx2, cy2, g.capCol, 14, 90); }
    if (g.t >= 0.42) { g.phase = 'reveal'; g.t = 0; gachaAward(g.prize); g.info = gachaPrizeInfo(g.prize); if (g.info.rar >= 2) { burst(cx2, cy2, C.gold, 20, 120); sfx.win(); } }
  } else if (g.phase === 'reveal') {
    overlayDim(0.62);
    const info = g.info || gachaPrizeInfo(g.prize);
    const pop = easeOut(clamp(g.t / 0.25, 0, 1));
    const pw2 = 190, ph2 = 96, px2 = W / 2 - pw2 / 2, py2 = 128 - ph2 / 2 * pop;
    ctx.save(); ctx.globalAlpha = pop;
    // rarity halo
    ctx.save(); ctx.globalAlpha = 0.16 * pop + Math.sin(tNow * 4) * 0.03; fillCircle(W / 2, 128, 86, RAR_COLS[info.rar]); ctx.restore();
    panel(px2, py2, pw2, ph2 * pop, { face: '#16222af8', edge: RAR_COLS[info.rar] });
    if (pop >= 1) {
      drawTextC(RAR_NAMES[info.rar], W / 2, py2 + 8, RAR_COLS[info.rar], 1);
      drawTextCSh(info.name, W / 2, py2 + 20, C.white, 2);
      // prize icon
      const iy = py2 + 40;
      if (g.prize.kind === 'glove') ICONS.glove(W / 2 - 6, iy, GLOVES[g.prize.k].skin);
      else if (g.prize.kind === 'hat') drawHatArt(W / 2, iy + 12, g.prize.k, 1);
      else if (g.prize.kind === 'perk') (ICONS[PERKS[g.prize.k].ico] || ICONS.star)(W / 2 - 6, iy);
      else if (g.prize.kind === 'card') (ICONS[g.prize.def.ico] || ICONS.star)(W / 2 - 6, iy);
      else ICONS.cookie(W / 2 - 6, iy);
      drawSmallWrapped(info.desc, px2 + 14, iy + 16, pw2 - 28, '#b8c8c8');
      if ((tNow % 1) < 0.6) drawTextC('TAP ANYWHERE', W / 2, py2 + ph2 - 10, C.dim, 1);
    }
    ctx.restore();
    if (g.t > 0.3) hit(0, 0, W, H, { id: 'greveal', cb: () => { G.gacha = null; }, cursor: true });
  }
}

// every capsule the machine can drop, owned ones lit up
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
function stageNight(water) {
  // starry sky bands + water line inside the stage
  const { x, y, w, h } = STAGE;
  ['#0a1626', '#0c1c2e', '#0f2434', '#132c3c'].forEach((c, i) => rect(x, y + i * (h / 4), w, h / 4 + 1, c));
  for (let i = 0; i < 22; i++) {
    const sx = x + (i * 97 + 13) % w, sy = y + (i * 53 + 7) % (h * 0.5);
    const tw = Math.sin(tNow * 1.7 + i * 2.3);
    if (tw > -0.2) { ctx.save(); ctx.globalAlpha = 0.25 + tw * 0.25; rect(sx, sy, 1, 1, '#cfe8f0'); ctx.restore(); }
  }
  fillCircle(x + w - 44, y + 26, 13, '#e8e8d0');
  ctx.save(); ctx.globalAlpha = 0.2; fillCircle(x + w - 44, y + 26, 17, '#e8e8d0'); ctx.restore();
  for (let tx2 = x; tx2 < x + w; tx2 += 6) {
    const h1 = 16 + ((Math.sin(tx2 * 0.13) * 7) | 0) + ((tx2 * 7) % 7);
    rect(tx2, y + Math.round(h * 0.62) - h1, 6, h1, '#0d2028');
  }
  const wy = y + Math.round(h * 0.62);
  rect(x, wy, w, y + h - wy, water || '#0a2028');
  for (let k = 0; k < 4; k++) {
    const yy = wy + 5 + k * 12, off = Math.sin(tNow * 0.8 + k * 2.2) * 8;
    ctx.save(); ctx.globalAlpha = 0.3;
    for (let d = 0; d < 5; d++) rect(x + ((d * 90 + off + k * 31) % w), yy, 11, 1, '#1e4a52');
    ctx.restore();
  }
  return wy;
}
function stageCamp() {
  // pine-night camp clearing with big fire glow
  const { x, y, w, h } = STAGE;
  ['#0c1420', '#101a28', '#141f30'].forEach((c, i) => rect(x, y + i * (h / 3), w, h / 3 + 1, c));
  for (let i = 0; i < 18; i++) { ctx.save(); ctx.globalAlpha = 0.5; rect(x + (i * 89 + 7) % w, y + (i * 41 + 5) % (h / 2), 1, 1, '#cfe8f0'); ctx.restore(); }
  // pines
  for (let k = 0; k < 7; k++) {
    const px2 = x + 12 + k * (w / 7), ph2 = 34 + (k * 13) % 18, py2 = y + h - 48 - ph2;
    for (let s2 = 0; s2 < 4; s2++) { const ww = 18 - s2 * 4; rect(px2 - ww / 2, py2 + s2 * (ph2 / 4), ww, ph2 / 4 + 1, '#0e2018'); }
    rect(px2 - 2, y + h - 50, 4, 4, '#1c1208');
  }
  rect(x, y + h - 48, w, 48, '#1a2416'); // grass
  for (let k = 0; k < 12; k++) rect(x + (k * 67 + 11) % w, y + h - 46 + (k * 29) % 42, 2, 1, '#28381e');
  return y + h - 48;
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
  drawBobble(x + 9, y + 24, G.ranger, { sc: 0.8, expr: 'happy', act: 'idle', hat: meta.hat, gear: meta.gear, glove: meta.glove });
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
      // carnival booth: striped awning, dark stage, wave rails
      rect(x, y, w, h, '#141020');
      for (let k = 0; k < Math.ceil(w / 24); k++) { rect(x + k * 24, y, 24, 14, k % 2 ? '#c23a4a' : '#e8e4d0'); rect(x + k * 24, y + 14, 24, 2, '#00000055'); }
      drawTextCSh('* DUCK GALLERY *', x + w / 2, y + 20, '#ffe089', 1);
      // back curtain with lit fold seams
      dither(x, y + 24, w, 80, '#1a1230', '#241838');
      for (let k = 0; k * 40 < w; k++) rect(x + 40 * k, y + 24, 1, 80, '#2e2044');
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
      ['#0a1626', '#0d1c2e'].forEach((c, i) => rect(x, y + i * 20, w, 20, c));
      rect(x, y + 40, w, h - 80, '#0c2430');
      rect(x, y + h - 40, w, 40, '#12261a');
      const sc = s ? s.scroll : tNow * 60;
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
      // rim-lit manatee (the hero)
      rr(cx + 58, cy - 8, 24, 22, 9, '#4a555b'); rr(cx + 59, cy - 7, 22, 20, 9, '#7a868c'); // paddle tail
      rr(cx - 67, cy - 25, 132, 50, 20, '#4a555b'); rr(cx - 66, cy - 24, 130, 48, 20, '#8a969c'); // outline + body
      rr(cx - 62, cy - 20, 122, 20, 18, '#9aa6ac'); rect(cx - 58, cy - 21, 116, 1, '#b8c4ca'); // upper light + top rim
      rect(cx - 58, cy + 18, 116, 3, '#7a868c'); // belly shadow
      for (let i = 0; i < 3; i++) rect(cx - 30 + i * 24, cy - 16, 10, 1, '#7a868c'); // back wrinkles
      [[cx - 20, cy - 8], [cx + 24, cy - 4]].forEach(([bxp, byp]) => { fillCircle(bxp, byp, 2, '#c8c2b2'); rect(bxp, byp, 1, 1, '#8a8478'); }); // barnacles
      rr(cx - 42, cy + 16, 15, 11, 5, '#4a555b'); rr(cx - 41, cy + 16, 14, 10, 5, '#7a868c'); rr(cx + 22, cy + 16, 15, 11, 5, '#7a868c'); // flippers
      rr(cx - 80, cy - 10, 22, 22, 9, '#8a969c'); rect(cx - 79, cy - 9, 20, 1, '#9aa6ac'); // snout
      rect(cx - 76, cy + 3, 3, 2, '#5a646c'); rect(cx - 70, cy + 4, 3, 2, '#5a646c'); // whisker snout
      // brightening shine grows as it's cleaned
      if (clean > 0) { ctx.save(); ctx.globalAlpha = clean * 0.4; dither(cx - 60, cy - 18, 120, 36, '#9aa6ac', '#b8c4ca', (tNow * 2 | 0)); ctx.restore(); }
      if (clean > 0.85) { rect(cx - 76, cy - 5, 4, 1, '#1b1408'); rect(cx - 75, cy - 6, 1, 1, '#1b1408'); rect(cx - 67, cy - 5, 4, 1, '#1b1408'); rect(cx - 66, cy - 6, 1, 1, '#1b1408'); } // content ^^ eyes
      else { critterEye(cx - 74, cy - 5, 5, 6, '#8a969c', '#f4f2e4', '#1b1408', 0); critterEye(cx - 65, cy - 5, 5, 6, '#8a969c', '#f4f2e4', '#1b1408', 1.5); }
      // growing happy blush + curving smile
      ctx.save(); ctx.globalAlpha = clean * 0.7; fillCircle(cx - 78, cy + 2, 2 + clean * 2, '#f0a0b0'); fillCircle(cx - 58, cy + 3, 1 + clean * 2, '#f0a0b0'); ctx.restore();
      rect(cx - 74, cy + 6 + Math.round(clean), 6, 1, '#5a646c'); if (clean > 0.4) { rect(cx - 75, cy + 5 + Math.round(clean), 1, 1, '#5a646c'); rect(cx - 68, cy + 5 + Math.round(clean), 1, 1, '#5a646c'); }
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
  panel(STAGE.x - 4, STAGE.y - 4, STAGE.w + 8, STAGE.h + 8, { face: '#0a1215', edge: '#5d7a86' });
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

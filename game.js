'use strict';
/* ==========================================================================
   BITE DOWN — a push-your-luck dental roguelike set in a living swamp.
   - Rounds: Small Gator / Big Gator / Boss Gator across 8 antes
   - Bites (hands), X-Rays (discards), Charms (jokers), tooth deck, shop
   - Procedural pixel art on a 480x270 buffer, WebAudio synth sfx
   - Drag cards to use/sell, click cards for details, unlockable gloves
   ========================================================================== */

// ------------------------------------------------------------ canvas ------
const W = 480, H = 270;
const canvas = document.getElementById('game');
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
    case 'menu': case 'ranger': case 'how': case 'pass': case 'gameover': case 'win': return TRACKS.menu;
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
const RCUT = { 1: [1], 2: [2, 1], 3: [3, 1, 1], 4: [4, 2, 1, 1] };
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
function panel(x, y, w, h, opts) {
  opts = opts || {};
  const r = opts.r === undefined ? 3 : opts.r;
  rr(x + 1, y + 2, w, h, r, opts.sh || '#00000066');
  rr(x, y, w, h, r, opts.edge || C.edge);
  rr(x + 1, y + 1, w - 2, h - 2, Math.max(0, r - 1), opts.face || C.panel);
}
function fillCircle(cx, cy, r, col) {
  for (let dy = -r; dy <= r; dy++) {
    const w2 = Math.floor(Math.sqrt(r * r - dy * dy));
    rect(cx - w2, cy + dy, w2 * 2 + 1, 1, col);
  }
}

// --------------------------------------------------- swamp scene themes ---
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
};
function themeNow() {
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
  ctx.globalAlpha = 0.25; fillCircle(mx0, my0, mr + 6, th.moon); ctx.globalAlpha = 1;
  fillCircle(mx0, my0, mr, th.moon);
  ctx.globalAlpha = 0.22;
  fillCircle(mx0 - 6, my0 - 4, 4, '#000'); fillCircle(mx0 + 5, my0 + 6, 3, '#000'); fillCircle(mx0 + 8, my0 - 7, 2, '#000');
  ctx.globalAlpha = 1;
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
    ctx.globalAlpha = 0.16;
    rr(cx0, 32 + k * 22, cw, 8, 3, '#000');
    rr(cx0 + 12, 28 + k * 22, cw - 30, 6, 3, '#000');
    ctx.globalAlpha = 1;
  }
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
  // fireflies
  fireflies.forEach((f, i) => {
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
};

// -------- animal ranger portraits, gator-style tracking eyes --------------
// a big expressive eye that blinks and follows the cursor (like the gator's)
function critterEye(ex, ey, ew, eh, lidCol, sclera, pupilCol, phase) {
  rr(ex - 1, ey - 1, ew + 2, eh + 2, 2, '#20140c');
  const blink = ((tNow + (phase || 0)) % 4.1) > 3.95;
  rr(ex, ey, ew, eh, 2, sclera);
  if (blink) { rr(ex, ey, ew, eh, 2, lidCol); return; }
  const dx = clamp((mx - (ex + ew / 2)) / 70, -1, 1) * Math.max(1, ew / 5);
  const dy = clamp((my - (ey + eh / 2)) / 70, -1, 1) * Math.max(1, eh / 6);
  const pw = Math.max(2, (ew / 3) | 0), ph2 = Math.max(3, (eh / 2) | 0);
  rect(ex + ew / 2 - pw / 2 + dx, ey + eh / 2 - ph2 / 2 + dy, pw, ph2, pupilCol || '#1b1408');
  rect(ex + ew / 2 - pw / 2 + dx + 1, ey + eh / 2 - ph2 / 2 + dy + 1, 1, 1, '#fff');
}

// Merle the manatee shopkeep: big, round, beloved
function drawVendor(x, y) {
  const bob = Math.round(Math.sin(tNow * 1.3) * 1.5);
  const b = y + bob;
  // great big egg of a body
  fillCircle(x + 23, b + 31, 22, '#6f7e8e');
  fillCircle(x + 23, b + 30, 21, '#9aaab8');
  fillCircle(x + 20, b + 27, 17, '#a8b8c4');
  // pale belly
  fillCircle(x + 23, b + 36, 13, '#c4d0d8');
  fillCircle(x + 23, b + 34, 11, '#d0dce2');
  // park vest, straining at the sides
  rect(x + 4, b + 18, 11, 26, '#4c6a30');
  rect(x + 31, b + 18, 11, 26, '#4c6a30');
  rect(x + 5, b + 19, 4, 24, '#5f8440');
  rect(x + 37, b + 19, 4, 24, '#5f8440');
  rect(x + 6, b + 23, 5, 4, C.gold); // ranger badge
  rect(x + 7, b + 24, 2, 2, '#fff6c8');
  // head sits right on the body, no neck to speak of
  fillCircle(x + 23, b + 8, 14, '#6f7e8e');
  fillCircle(x + 23, b + 7, 13, '#9aaab8');
  fillCircle(x + 21, b + 5, 10, '#a8b8c4');
  // droopy whiskered snout
  rr(x + 13, b + 8, 20, 12, 5, '#aabac8');
  rr(x + 15, b + 14, 16, 6, 3, '#b8c8d4');
  rect(x + 18, b + 11, 2, 3, '#6a7a88'); rect(x + 26, b + 11, 2, 3, '#6a7a88'); // nostrils
  rect(x + 12, b + 16, 3, 1, '#7a8a98'); rect(x + 31, b + 16, 3, 1, '#7a8a98'); // whiskers
  rect(x + 13, b + 18, 2, 1, '#7a8a98'); rect(x + 31, b + 18, 2, 1, '#7a8a98');
  rect(x + 20, b + 19, 6, 1, '#8a98a8'); // gentle smile
  // small kind tracking eyes
  critterEye(x + 12, b + 1, 6, 6, '#9aaab8', '#f8f4dc', '#2a2018', 7.0);
  critterEye(x + 28, b + 1, 6, 6, '#9aaab8', '#f8f4dc', '#2a2018', 7.4);
  // chunky waving flipper
  const wave = Math.sin(tNow * 3) > 0.3 ? -5 : 0;
  rr(x - 8, b + 22 + wave, 15, 9, 4, '#6f7e8e');
  rr(x - 7, b + 23 + wave, 13, 7, 4, '#9aaab8');
  // other flipper resting on the counter
  rr(x + 38, b + 38, 13, 8, 4, '#8a98a8');
}

// a dentist tool as a REAL tool: hanging on a leather shop tag
function drawToolItem(x, y, def, o) {
  o = o || {};
  x |= 0; y |= 0;
  // leather tag with stitching + hook hole
  rr(x + 1, y + 3, 30, 42, 3, '#00000077');
  rr(x, y, 30, 42, 3, '#6a4a2a');
  rr(x + 1, y + 1, 28, 40, 3, '#8a6238');
  for (let k = 0; k < 6; k++) { rect(x + 3 + k * 4, y + 2, 2, 1, '#5a3a1e'); rect(x + 3 + k * 4, y + 39, 2, 1, '#5a3a1e'); }
  fillCircle(x + 15, y + 5, 2, '#4a3018');
  // the tool itself, drawn big (2x icon)
  ctx.save();
  ctx.translate(x + 3, y + 9);
  ctx.scale(2, 2);
  (ICONS[def.ico] || ICONS.tdrill)(0, 0);
  ctx.restore();
  drawTextC(def.name.split(' ')[0].slice(0, 5), x + 15, y + 34, '#f0e0c0', 1);
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

// 28x28 animal faces (animal-crossing-ish: big head, big eyes, tiny features)
function drawRangerFace(x, y, key) {
  const hat = (hx, hy, hw, band) => {
    rect(hx - 3, hy + 6, hw + 6, 3, '#4a3320');
    rr(hx, hy, hw, 8, 2, '#5a4028');
    rect(hx, hy + 5, hw, 2, band);
  };
  if (key === 'scout') { // heron: blue-grey, long yellow beak
    hat(x + 5, y, 18, '#63d66a');
    rr(x + 5, y + 9, 18, 14, 3, '#9fb2c8');
    rect(x + 6, y + 9, 16, 2, '#00000022');
    critterEye(x + 7, y + 12, 6, 7, '#9fb2c8', '#f8f4dc', '#1b1408', 0);
    critterEye(x + 15, y + 12, 6, 7, '#9fb2c8', '#f8f4dc', '#1b1408', 0.4);
    rect(x + 11, y + 20, 14, 3, '#e8c04a'); // long beak
    rect(x + 22, y + 21, 4, 2, '#c89a2a');
    rect(x + 11, y + 22, 10, 1, '#c89a2a');
    rr(x + 3, y + 24, 22, 4, 2, '#63d66a'); // scarf
  } else if (key === 'medic') { // opossum: grey, pink round ears, pink nose
    fillCircle(x + 7, y + 6, 4, '#8a8a92'); fillCircle(x + 7, y + 6, 2, '#e8a0b0');
    fillCircle(x + 21, y + 6, 4, '#8a8a92'); fillCircle(x + 21, y + 6, 2, '#e8a0b0');
    rr(x + 4, y + 8, 20, 16, 4, '#b8b8c0');
    rr(x + 8, y + 14, 12, 10, 3, '#e8e8e8'); // white muzzle patch
    critterEye(x + 6, y + 11, 6, 7, '#b8b8c0', '#f8f4dc', '#2a1a2a', 0.8);
    critterEye(x + 16, y + 11, 6, 7, '#b8b8c0', '#f8f4dc', '#2a1a2a', 1.2);
    rect(x + 12, y + 19, 4, 3, '#e88898'); // pink nose
    rect(x + 13, y + 22, 2, 1, '#8a6a72');
    rr(x + 4, y + 24, 20, 4, 2, '#7fd4e8'); // medic scarf
    rect(x + 12, y + 25, 4, 2, C.red); rect(x + 13, y + 24, 2, 4, C.red); // cross
  } else if (key === 'trader') { // raccoon: mask, striped ears, grin
    rect(x + 4, y + 2, 6, 6, '#6a6258'); rect(x + 18, y + 2, 6, 6, '#6a6258');
    rect(x + 6, y + 4, 2, 2, '#3a342c'); rect(x + 20, y + 4, 2, 2, '#3a342c');
    rr(x + 4, y + 6, 20, 17, 4, '#8a8276');
    rect(x + 4, y + 11, 20, 6, '#3a342c'); // bandit mask
    critterEye(x + 6, y + 11, 6, 6, '#3a342c', '#f8f4dc', '#1b1408', 1.6);
    critterEye(x + 16, y + 11, 6, 6, '#3a342c', '#f8f4dc', '#1b1408', 2.0);
    rr(x + 10, y + 17, 8, 6, 2, '#d8d0c0');
    rect(x + 13, y + 18, 3, 2, '#3a342c'); // nose
    rect(x + 11, y + 21, 6, 1, '#8a6a3a'); // sly grin
    rect(x + 16, y + 20, 2, 1, '#ffd54a'); // gold tooth glint
    rr(x + 4, y + 23, 20, 4, 2, '#ffc843');
  } else if (key === 'frog') { // bullfrog: eyes on top like the gator
    fillCircle(x + 8, y + 6, 5, '#5a9a3c'); fillCircle(x + 20, y + 6, 5, '#5a9a3c');
    critterEye(x + 5, y + 3, 6, 6, '#5a9a3c', '#f8f4dc', '#1b1408', 2.4);
    critterEye(x + 17, y + 3, 6, 6, '#5a9a3c', '#f8f4dc', '#1b1408', 2.8);
    rr(x + 3, y + 8, 22, 15, 5, '#7ec850');
    rect(x + 5, y + 16, 18, 1, '#4a7c2e'); // wide mouth
    rect(x + 4, y + 15, 2, 2, '#4a7c2e'); rect(x + 22, y + 15, 2, 2, '#4a7c2e');
    rect(x + 9, y + 12, 2, 1, '#4a7c2e'); rect(x + 17, y + 12, 2, 1, '#4a7c2e'); // nostrils
    rr(x + 6, y + 19, 16, 4, 2, '#e8e0b0'); // pale chin
    rr(x + 3, y + 23, 22, 4, 2, '#d94f30'); // brawler bandana
  } else if (key === 'snail') { // snail sage: shell + eye stalks
    fillCircle(x + 19, y + 14, 9, '#a87848');
    fillCircle(x + 19, y + 14, 7, '#c8a878');
    fillCircle(x + 20, y + 13, 4, '#a87848');
    rect(x + 19, y + 12, 2, 2, '#7a5430'); // spiral core
    rect(x + 4, y + 5, 2, 8, '#d8c8a8'); rect(x + 10, y + 3, 2, 10, '#d8c8a8'); // stalks
    critterEye(x + 2, y + 1, 5, 5, '#d8c8a8', '#f8f4dc', '#1b1408', 3.2);
    critterEye(x + 8, y - 1, 5, 5, '#d8c8a8', '#f8f4dc', '#1b1408', 3.6);
    rr(x + 2, y + 12, 14, 12, 4, '#e0d0b0'); // head/body
    rect(x + 4, y + 18, 6, 1, '#a89068'); // wise little smile
    rect(x + 3, y + 24, 12, 3, '#8878a8'); // sage wrap
  }
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
function crocStyle() {
  if (G.state !== 'menu' && G.round === 2 && G.boss) return CROC_STYLES[G.boss.id] || CROC_STYLES.big;
  if (G.state !== 'menu' && G.nodeType === 'gold') return CROC_STYLES.gold;
  if (G.state !== 'menu' && G.round === 1) return CROC_STYLES.big;
  if (G.state !== 'menu' && G.round === 0 && G.nodeType === 'small') return CROC_STYLES.turtle;
  return CROC_STYLES.small;
}

// ------------------------------------------------------------ game data ---
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
  { id: 'heronfeather', name: 'HERON FEATHER', cost: 4, rar: 0, ico: 'eye', tier: 1, desc: '+1 X-RAY against SNAPPY TURTLES', flav: 'Sharp eyes molt off.' },
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
  small: { name: 'SNAPPY TURTLE', mult: 1, reward: 3, col: '#63d66a' },
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
const ROUND_NAMES = ['SNAPPY TURTLE', 'BIG GATOR', 'BOSS'];

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
};
const GLOVE_ORDER = ['bare', 'rubber', 'leather', 'croc', 'gold', 'bone', 'pearl', 'royal', 'neon', 'candy', 'starry'];
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
    name: 'BAYOU SCOUT', animal: 'THE HERON', col: '#63d66a', ach: null,
    lines: ['+1 TOOTH IN EVERY MOUTH', 'ONE TOOTH PER MOUTH COMES PRE-XRAYED'],
    flav: 'Knows every log that blinks.',
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
// event nodes launch one of five pixel mini-games; pay scales with skill
const MINIGAMES = {
  fish: { name: "GONE FISHIN'", icon: 'gem', how: ['Wait for the bobber to DIP -', 'then TAP fast to hook it! 5 casts.'] },
  feed: { name: 'FEEDING TIME', how: ['A hungry gator cruises the pool.', 'TAP to lob a drumstick onto the X - lead him! 6 throws.'] },
  cook: { name: 'CAMP GUMBO', how: ['TAP to stoke the fire.', 'Hold the needle in the green for 10 seconds.'] },
  mallow: { name: 'MALLOW ROAST', how: ['Marshmallows toast fast and burn faster.', 'TAP to pull each one at peak GOLD. 3 mallows.'] },
  ducks: { name: 'DUCK GALLERY', how: ['Wooden ducks cross the stalls - TAP to shoot!', 'Gold ducks pay triple. 14 seconds.'] },
  froggy: { name: 'FROG ROUNDUP', how: ['Frogs only rest a moment between hops.', 'TAP one while it sits to bag it! 14 seconds.'] },
  birdy: { name: 'BIRD SNAPS', how: ['Line the photo frame up on a flying bird', 'and TAP to snap it. 6 shots of film!'] },
  boat: { name: 'AIRBOAT RUN', how: ['MOVE your finger or mouse to steer the airboat.', 'Grab coins, dodge the logs! 15 seconds.'] },
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
  { id: 'gummies', name: 'GATOR GUMMIES', cost: 5, kind: 'tooth', show: 3, picks: 1, boost: 1, col: '#c9556a', flav: 'Now with 20% more chew.' },
  { id: 'chomppops', name: 'CHOMP-POPS', cost: 8, kind: 'tooth', show: 5, picks: 1, boost: 2, col: '#e8a020', flav: 'The lolly that bites back.' },
  { id: 'sundae', name: 'SWAMP SUNDAE', cost: 12, kind: 'tooth', show: 5, picks: 2, boost: 3, col: '#7fd4e8', flav: 'Two scoops. Pick two teeth.' },
  { id: 'tacklebox', name: 'TACKLE BOX', cost: 6, kind: 'tool', show: 2, picks: 1, col: '#3a9a8a', flav: 'Sterilized-ish.' },
  { id: 'toolbelt', name: 'RANGER TOOLBELT', cost: 11, kind: 'tool', show: 4, picks: 1, col: '#8a6510', flav: 'Every loop holds a promise.' },
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
  else if (prize.kind === 'perk') { meta.perks[prize.k] = true; toasts.push({ name: PERKS[prize.k].name + '!', sub: 'PERMANENT UPGRADE ACTIVE', t: 0 }); }
  else { meta.rp = (meta.rp || 0) + 15; toasts.push({ name: 'COOKIE JAR!', sub: '+15 COOKIES BACK', t: 0 }); }
  saveMeta();
  sfx.ach();
}
const gachaPrizeInfo = z =>
  z.kind === 'card' ? { name: z.def.name, desc: z.def.desc, rar: z.rar }
    : z.kind === 'glove' ? { name: GLOVES[z.k].name, desc: 'GLOVE SKIN - ' + GLOVES[z.k].flav, rar: 2 }
      : z.kind === 'perk' ? { name: PERKS[z.k].name, desc: PERKS[z.k].desc, rar: 3 }
        : { name: 'COOKIE JAR', desc: 'You own everything! +15 cookies back.', rar: 1 };

// three quest-giver NPCs, each with a PERMANENT quest chain (not daily)
const NPCS = {
  granny: { name: 'GRANNY SNAPPER', who: 'the old turtle', col: '#8fae68', line: 'Back in my day we pressed teeth uphill both ways.' },
  crow: { name: 'FERRYMAN CROW', who: 'the river crow', col: '#9fb2c8', line: 'The trail provides, ranger. For a fee.' },
  doc: { name: 'DOC MUDBUG', who: 'the crawfish dentist', col: '#e08898', line: 'Open wide! Not you, ranger. The gator.' },
};
const NPC_ORDER = ['granny', 'crow', 'doc'];
// chains: [questId, goal override, rp reward]
const QUEST_CHAINS = {
  granny: [
    ['press30', 45, 15], ['bank8', 12, 15], ['sweep1', 2, 20], ['special5', 12, 20],
    ['press30', 180, 30], ['bank8', 45, 30], ['sweep1', 8, 40], ['press30', 600, 60],
  ],
  crow: [
    ['ante3q', 1, 15], ['event1', 3, 15], ['boss1q', 2, 20], ['gold1', 2, 20],
    ['money25', 1, 25], ['event1', 12, 30], ['boss1q', 8, 40], ['run1', 9, 60],
  ],
  doc: [
    ['xray8', 12, 15], ['buy4', 6, 15], ['defuse2', 3, 20], ['tool1', 2, 20],
    ['pack1', 5, 25], ['xray8', 60, 30], ['defuse2', 15, 40], ['tool1', 12, 60],
  ],
};
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
  ],
};

const QUESTS = [
  { id: 'press30', name: 'PRESS 30 TEETH', goal: 30 },
  { id: 'bank8', name: 'BANK 8 BITES', goal: 8 },
  { id: 'sweep1', name: 'PULL OFF A CLEAN SWEEP', goal: 1 },
  { id: 'boss1q', name: 'DEFEAT A BOSS GATOR', goal: 1 },
  { id: 'xray8', name: 'X-RAY 8 TEETH', goal: 8 },
  { id: 'defuse2', name: 'DEFUSE 2 SNAPPERS', goal: 2 },
  { id: 'buy4', name: 'BUY 4 SHOP ITEMS', goal: 4 },
  { id: 'money25', name: 'HOLD $25 AT ONCE', goal: 1 },
  { id: 'ante3q', name: 'REACH ANTE 3', goal: 1 },
  { id: 'special5', name: 'PRESS 5 SPECIAL TEETH', goal: 5 },
  { id: 'run1', name: 'FINISH A RUN', goal: 1 },
  { id: 'event1', name: 'RESOLVE A SWAMP EVENT', goal: 1 },
  { id: 'gold1', name: 'BEAT A GOLDEN GATOR', goal: 1 },
  { id: 'tool1', name: 'USE A DENTIST TOOL', goal: 1 },
  { id: 'pack1', name: 'OPEN A PACK', goal: 1 },
];

let meta = { ach: {}, lifeSnaps: 0, glove: 'bare', rp: 0, ranger: 'scout', daily: null, unlocked: {}, chains: null, set: null, itchFollow: false, gachaOwn: {}, perks: {} };
try { const m = JSON.parse(localStorage.getItem('bd_meta') || 'null'); if (m) meta = Object.assign(meta, m); } catch (e) { }
if (!meta.unlocked) meta.unlocked = {};
if (!meta.gachaOwn) meta.gachaOwn = {};
if (!meta.perks) meta.perks = {};
if (!meta.set) meta.set = { mus: 2, sfx: 2, shake: 1, crt: 1 };
if (!meta.chains) meta.chains = { granny: { step: 0, prog: 0 }, crow: { step: 0, prog: 0 }, doc: { step: 0, prog: 0 } };
function saveMeta() { try { localStorage.setItem('bd_meta', JSON.stringify(meta)); } catch (e) { } }
let toasts = []; // {name, sub, glove, t}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}
function ensureDaily() { if (!meta.chains) meta.chains = { granny: { step: 0, prog: 0 }, crow: { step: 0, prog: 0 }, doc: { step: 0, prog: 0 } }; }
function chainQuest(nk) {
  const ch = meta.chains[nk];
  const row = QUEST_CHAINS[nk][ch.step];
  if (!row) return null; // chain complete
  const def = QUESTS.find(d => d.id === row[0]);
  return { npc: nk, id: row[0], name: def.name.replace(/\d+/, '' + row[1]), goal: row[1], rp: row[2], prog: ch.prog, step: ch.step };
}
function addRP(n, label) {
  meta.rp = (meta.rp || 0) + n;
  if (label) toasts.push({ name: label, sub: '+' + n + ' SCOUT COOKIES', t: 0 });
  saveMeta();
}
let questToastT = -9; // throttle live progress pings
function quest(id, n) {
  ensureDaily();
  NPC_ORDER.forEach(nk => {
    const cq = chainQuest(nk);
    if (!cq || cq.id !== id) return;
    const ch = meta.chains[nk];
    ch.prog = Math.min(cq.goal, ch.prog + n);
    if (ch.prog >= cq.goal) {
      ch.step++; ch.prog = 0;
      sfx.ach();
      addRP(cq.rp, NPCS[nk].name + ': QUEST ' + (cq.step + 1) + ' DONE');
    } else {
      if (tNow - questToastT > 8 && ch.prog / cq.goal >= 0.5) {
        questToastT = tNow;
        toasts.push({ name: cq.name, sub: 'QUEST ' + ch.prog + '/' + cq.goal + ' - ' + NPCS[nk].name, t: 0 });
      }
      saveMeta();
    }
  });
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
const gloveUnlocked = k => GLOVES[k].gacha ? !!meta.gachaOwn[k] : (!GLOVES[k].ach || !!meta.ach[GLOVES[k].ach]);
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
};
let trans = null;  // iris wipe: {t, cb, fired}
function startTransition(cb) { if (trans) return; trans = { t: 0, cb, fired: false }; sfx.whoosh(); }
let flyers = [];   // bought cards flying to their slot
let best = 0;
try { best = parseInt(localStorage.getItem('bitedown_best') || '0') || 0; } catch (e) { }
function saveBest() { try { localStorage.setItem('bitedown_best', '' + best); } catch (e) { } }

const has = id => G.charms.some(c => c.id === id);
const rangerUnlocked = k => !RANGERS[k].ach || !!meta.ach[RANGERS[k].ach];
const bossIs = id => !!(G.boss && G.round === 2 && G.boss.id === id);
const xraysBlocked = () => bossIs('murky');
const snapCountFor = () => {
  return 1 + ((bossIs('twofang') || bossIs('apexpred') || bossIs('king')) ? 1 : 0)
    + (nodeModOn('swarming') ? 1 : 0);
};

function mkTooth(type, base) {
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
  G.map = { stages: [s0, s1, [mk('boss')]], stage: 0, picked: [] };
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
  G.round = node.type === 'boss' ? 2 : node.type === 'small' ? 0 : 1;
  G.boss = node.type === 'boss' ? (G.ante === 8 ? FINAL_BOSS : G.bossOrder[(G.ante - 1) % G.bossOrder.length]) : null;
  G.target = Math.round((G.ante <= 8 ? ANTE_BASE[G.ante - 1] : ANTE_BASE[7] * Math.pow(1.7, G.ante - 8)) * NODE_DEFS[node.type].mult
    * (has('gumbo') ? 0.92 : 1));
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
    - (nodeModOn('foggy') ? 1 : 0) + G.eventBuffs.xrays;
  G.xrays = Math.max(0, G.xrays);
  if (has('foreverglades')) gainMoney(2);
  if (bossIs('apexpred')) G.xrays = Math.min(G.xrays, 1);
  G.numbUsed = false; G.greedyCount = 0;
  G.roundPressed = 0; G.heartUsed = false; G.roundBanks = 0;
  G.denturesUsed = false; G.feastTimes = [];
  G.roundBuffMult = G.eventBuffs.mult || 0;
  G.drawPile = shuffle(G.deck.slice());
  G.deckOpen = false; G.inspect = null; G.drag = null; G.xanim = null;
  if (G.ante >= 3) { unlock('ante3'); quest('ante3q', 1); }
  newMouth();
  G.eventBuffs = { bites: 0, xrays: 0, mult: 0, snapNext: 0 };
  if (G.boss) { G.state = 'bossintro'; G.biStart = tNow; sfx.boss(); }
  else { G.state = 'play'; }
}

function afterShop() {
  if (G.map.stage >= 3) { G.ante++; genMap(); }
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

// a mini-game reports its result here; rewards are paid on CONTINUE
function finishGame(grade, pay, cookies, lines) {
  const ev = G.event; if (!ev || ev.phase === 'done') return;
  ev.phase = 'done'; ev.t = 0;
  ev.grade = grade; ev.pay = pay; ev.cookies = cookies; ev.lines = lines || [];
  sfx.win();
}
function collectEvent() {
  const ev = G.event; if (!ev || ev.phase !== 'done') return;
  gainMoney(ev.pay);
  if (has('duckcall')) { gainMoney(3); toasts.push({ name: 'DUCK CALL', sub: '+$3 BONUS', t: 0 }); }
  addRP(3 + ev.cookies + (has('dragonfly') ? 2 : 0), 'FIELD EXPERIENCE');
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
  if (G.roundBuffMult) G.pool.mult += G.roundBuffMult;
  if (has('compound') && G.compoundMult > 0) G.pool.mult += G.compoundMult;
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
  if (G.state !== 'play') return;
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
    else if (has('loose') && rnd() < 1 / 3) { defused = 'POPPED OUT!'; }
    if (defused) {
      s.gone = true; s.revealed = 'snap';
      float(p.x, p.y - 10, defused, C.green, 1);
      burst(p.x, p.y, C.green, 10, 70);
      if (has('chum')) { G.pool.teeth += 15; float(p.x, p.y - 22, 'CHUM +15 TEETH', C.blue, 1); }
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
    if (has('overbite') && G.pool.clicks === 1 && !echoed) { add += 12; float(p.x, p.y - 22, 'OVERBITE +12', C.blue, 1); }
    if (has('tinfang') && s.t.type === 'plain') add *= 2;
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
  const r1 = applyPress(false);
  if (has('echo') && ri(0, 3) === 0) {
    applyPress(true);
    float(p.x, p.y - 30, 'ECHO!', C.purple, 1);
  }
  if (has('undertow') && G.undertowNext && G.pool.clicks === 1) {
    G.undertowNext = false;
    applyPress(true);
    float(p.x, p.y - 30, 'UNDERTOW!', '#7fd4e8', 1);
  }
  if (has('greedy')) { G.greedyCount++; if (G.greedyCount % 4 === 0) { gainMoney(1); float(p.x, p.y - 28, 'GREEDY +$1', C.gold, 1); } }
  float(p.x - 8, p.y - 12, '+' + r1.add, C.blue, 1);
  if (r1.mgain > 0) float(p.x + 10, p.y - 6, '+' + r1.mgain, C.red, 1);
  burst(p.x, p.y, '#fef9e6', 5, 40);
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
      G.runSweeps++;
      quest('sweep1', 1);
      if (G.runSweeps >= 3) unlock('sweep3');
      if (has('snaggle')) { gainMoney(5); float(W / 2 + 50, 116, 'SNAGGLETOOTH +$5', C.gold, 1, 1.4); }
      bank(true);
    } else {
      // only snappers left and nothing pressed: the bite fizzles out
      float(W / 2 + 50, 96, 'NOTHING SAFE LEFT!', C.dim, 1, 1.4);
      endBite();
    }
  }
}

function bankMath(sweep) {
  let t = G.pool.teeth, m = G.pool.mult;
  if (has('magnet')) t += 15;
  if (has('goldrush')) t += Math.min(30, G.money);
  if (has('slowbite')) t += 8 * G.mouth.filter(s => !s.pressed && !s.gone).length;
  if (has('millionfang')) t += G.deck.length;
  if (has('glass')) m *= 2;
  if (has('leviathan')) m *= 2;
  if (has('bloodpact')) m *= 3;
  if (has('rootcanal') && G.pool.clicks >= 7) m *= 2;
  if (has('apex') && G.pool.clicks >= 8) m *= 3;
  if (has('totem') && G.round === 2) m *= 1.5;
  if (has('jackpot') && G.pool.clicks === 7) m *= 5;
  if (has('gambit') && G.mouth.filter(s => s.snap && !s.pressed && !s.gone).length === 2) m *= 2.5;
  if (sweep) m *= has('collector') ? 2 : (G.ranger === 'frog' ? 1.75 : 1.25);
  return Math.floor(t * m);
}
const bankValue = () => bankMath(false);

function bank(sweep) {
  if (G.state !== 'play') return;
  if (G.pool.clicks === 0) { sfx.error(); float(248, 232, 'PRESS A TOOTH FIRST!', C.red, 1); return; }
  if (!sweep && bossIs('lockjaw') && G.pool.clicks < 4) { sfx.error(); float(248, 232, 'LOCKJAW: NEED 4+ TEETH', C.red, 1); return; }
  if (!sweep && bossIs('shellback') && G.pool.clicks < 6) { sfx.error(); float(248, 232, 'SHELLBACK: NEED 6+ TEETH', C.red, 1); return; }
  const val = bankMath(!!sweep);
  G.score += val;
  G.stats.banks++;
  G.roundBanks++;
  G.scorePulse = 0.4;
  quest('bank8', 1);
  if (val > G.stats.bestBank) G.stats.bestBank = val;
  if (has('canteen') && G.pool.clicks <= 3) { gainMoney(3); float(60, 182, 'CANTEEN +$3', C.gold, 1); }
  if (has('baitbucket')) { gainMoney(1); float(60, 166, 'BAIT +$1', C.gold, 1); }
  if (has('compound')) { G.compoundMult++; float(60, 174, 'COMPOUND +1', C.purple, 1); }
  if (has('undertow')) G.undertowNext = true;
  if (sweep && has('ouroboros')) { G.sweepCarry = G.pool.mult; float(W / 2 + 50, 128, 'THE CHAIN SURVIVES!', C.purple, 1, 1.6); }
  if (sweep && has('otterpaw')) { gainMoney(3); float(60, 158, 'OTTER +$3', C.gold, 1); }
  if (bossIs('loanshark')) { G.money = Math.max(0, G.money - 2); float(60, 190, '-$2', C.red, 1); }
  if (has('bloodpact')) { G.money = Math.max(0, G.money - 2); float(60, 198, 'PACT -$2', C.red, 1); }
  float(60, 96, '+' + fmt(val), C.gold, 2, 1.4);
  burst(60, 100, C.gold, 14, 80);
  addRipple(180 + rnd() * 200, 254, false);
  if (!sweep) sfx.bank();
  endBite();
}

function startSnap(i) {
  const s = G.mouth[i];
  s.pressed = true; s.revealed = 'snap';
  G.state = 'snap'; G.snapT = 0; G.snapIdx = i;
  G.deckOpen = false; G.drag = null; G.inspect = null;
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
  const base = (NODE_DEFS[G.nodeType].reward || 4) + Math.floor(G.ante / 3) + (nodeModOn('richwater') ? 4 : 0)
    + (has('goldgrill') && G.nodeType === 'gold' ? 5 : 0);
  if (has('rangerpin') && G.round === 2) addRP(3, 'RANGER PIN');
  const perBite = G.bites; // unused bites, $1 each
  const cap = G.ranger === 'trader' ? 8 : 5;
  const interest = (has('hoard') ? Math.floor(G.money / 4) : Math.min(cap, Math.floor(G.money / 5)))
    + (has('snailshell') ? 2 : 0);
  const fairy = has('fairy') ? 2 : 0;
  G.cash = { base, perBite, interest, fairy, cap, total: base + perBite + interest + fairy };
  G.state = 'roundend';
  G.deckOpen = false; G.drag = null; G.inspect = null; clearFx();
  if (G.round === 2) { unlock('boss'); quest('boss1q', 1); }
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
    G.state = 'win';
    return;
  }
  enterShop();
}

function enterShop() {
  G.rerollCost = meta.perks.coupon ? 0 : (has('tacklecharm') ? 3 : 4);
  rollShop();
  stockPacks();
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

function rollShop() {
  const items = [];
  let cpool = CHARMS.filter(c => !has(c.id) && cardUnlocked(c));
  for (let k = 0; k < 2 && cpool.length; k++) {
    const def = weightedCharm(cpool);
    cpool = cpool.filter(c => c !== def);
    items.push({ kind: 'charm', def, price: def.cost, sold: false });
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
  G.mode = 'idle';
  quest('xray8', 1);
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
  G.pack = { product, options, picksLeft: product.picks, taken: [], t: 0 };
  quest('pack1', 1);
  sfx.sweep();
}
function pickPack(i) {
  const p = G.pack; if (!p || p.t < 0.35) return;
  const o = p.options[i]; if (!o || o.taken) return;
  if (o.tooth) {
    G.deck.push(mkTooth(o.tooth));
    toasts.push({ name: TOOTH_DEFS[o.tooth].name, sub: 'ADDED TO YOUR DECK', t: 0 });
  } else {
    if (G.cons.length >= 3) { sfx.error(); float(mx, my - 10, 'CARD SLOTS FULL', C.red, 1); return; }
    G.cons.push(o.tool);
    toasts.push({ name: o.tool.name, sub: 'ADDED TO YOUR CARDS', t: 0 });
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
  if (G.state !== 'play') return;
  if (G.mode === 'xray') { G.mode = 'idle'; return; }
  if (G.xrays <= 0) { sfx.error(); float(310, 232, 'NO X-RAYS LEFT', C.red, 1); return; }
  if (xraysBlocked()) { sfx.error(); float(310, 232, 'X-RAYS BLOCKED!', C.red, 1); return; }
  G.mode = 'xray'; G.extractCons = -1;
  sfx.xray();
}

// ------------------------------------------------------------ layout ------
const SIDEBAR = { x: 2, y: 2, w: 110, h: 266 };
function mouthLayout() {
  const maw = { x: 186, y: 112, w: 216, h: 92 };
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
  if (h && h.cb && !h.disabled) h.cb();
  hits.length = 0; // one action per rendered frame: stale rects must not double-fire
  down = null;
}
function onUp() {
  if (G.drag) { resolveDrop(); G.drag = null; down = null; return; }
  if (down && down.hit && down.hit.click && !down.hit.disabled) {
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
  const breathe = (G.state === 'play' || G.state === 'menu') ? Math.sin(tNow * 1.6) * 1 : 0;
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
  // belly plate bands on the chin
  for (let k = 0; k < 3; k++) rect(bodyX + 16, maw.y + maw.h + 14 + k * 7, bodyW - 32, 1, st.b);
  if (st.skinny) { rect(bodyX + 14, maw.y + maw.h + 14, 3, 14, st.b); rect(bodyX + bodyW - 17, maw.y + maw.h + 14, 3, 14, st.b); }

  // --- maw interior ---
  rr(maw.x - 6, maw.y - 4, maw.w + 12, maw.h + 10, 4, mawD);
  rr(maw.x - 3, maw.y - 1, maw.w + 6, maw.h + 4, 4, mawC);
  rr(maw.x + 30, maw.y + maw.h - 34, maw.w - 60, 28, 4, st.tongue);
  rr(maw.x + 40, maw.y + maw.h - 32, maw.w - 80, 10, 3, st.tongueHi);
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
    if (!s.pressed && !scanning) {
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
  const jy = maw.y - 58 + jawDrop + breathe;
  rr(bodyX - 4, jy, bodyW + 8, 62, 4, st.d);
  rr(bodyX - 3, jy + 1, bodyW + 6, 60, 4, st.b);
  rr(bodyX - 1, jy + 3, bodyW + 2, 52, 4, st.a);
  rr(bodyX + 6, jy + 5, bodyW - 12, 10, 3, st.c);
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
  // wet sheen sweeping the hide
  const shx = bodyX + ((tNow * 22) % (bodyW + 60)) - 30;
  ctx.save(); ctx.globalAlpha = 0.08;
  rect(shx, jy + 4, 4, 50, '#eafcff'); rect(shx + 8, jy + 4, 2, 50, '#eafcff');
  ctx.restore();
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

  // --- eyes on top --- (kept left of the charm row, which ends at x~270)
  const squeeze = closeT > 0.5 || opts.angry;
  const exL = maw.x + 18, exR = maw.x + maw.w - 48, ey = jy - 10;
  [exL, exR].forEach((ex) => {
    rr(ex - 4, ey, 30, 20, 4, st.b);
    rr(ex - 3, ey + 1, 28, 17, 4, st.a);
    if (squeeze) {
      rect(ex + 2, ey + 8, 18, 3, st.d);
    } else {
      const blink = (tNow % 4.3) > 4.15 || (st.sleepy && (tNow % 4.3) > 3.9);
      rr(ex + 3, ey + 4, 16, 12, 3, st.redEye ? '#e8b0a0' : st.sclera);
      if (blink) {
        rect(ex + 3, ey + 4, 16, 12, st.a);
      } else {
        const dx = clamp((mx - (ex + 11)) / 60, -1, 1) * 3;
        const dy = clamp((my - (ey + 10)) / 60, -1, 1) * 2;
        rect(ex + 9 + dx, ey + 6 + dy, 4, 8, st.redEye ? '#8a1010' : '#1b1408');
        rect(ex + 10 + dx, ey + 7 + dy, 1, 2, '#fff');
        if (st.sleepy) rect(ex + 3, ey + 4, 16, 5, st.a); // heavy lids
      }
    }
    rect(ex - 2, ey - 2, 26, 3, st.d);
    if (st.bags) { rect(ex + 2, ey + 17, 18, 2, '#3a2a4a'); rect(ex + 4, ey + 19, 14, 1, '#3a2a4a'); }
    if (st.teary) { rect(ex + 4, ey + 16, 2, 3, '#7fd4e8'); rect(ex + 5, ey + 19 + ((tNow * 6 | 0) % 3), 1, 2, '#7fd4e8'); }
    // back scutes flanking each eye
    [[ex - 12, ey + 4], [ex + 28, ey + 6]].forEach(([sx, sy]) => {
      rect(sx, sy, 5, 6, st.b); rect(sx + 1, sy - 3, 3, 3, st.b); rect(sx + 2, sy - 5, 1, 2, st.b);
    });
  });
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
function button(x, y, w, h, label, col, colD, cb, o) {
  o = o || {};
  const hov = mx >= x && mx < x + w && my >= y && my < y + h && !o.disabled;
  const yy = hov ? y + 1 : y;
  rr(x, y + 3, w, h, 3, '#00000088');
  rr(x, yy + 2, w, h - 1, 3, colD);
  rr(x, yy, w, h - 2, 3, o.disabled ? '#3a4a50' : col);
  const tcol = o.disabled ? '#7d8f94' : (o.tcol || C.white);
  const sc = o.sc || 1;
  drawTextC(label, x + w / 2, yy + Math.floor((h - 2 - 5 * sc) / 2), tcol, sc);
  if (o.sub) drawTextC(o.sub, x + w / 2, yy + h - 8, o.subCol || tcol, 1);
  hit(x, y, w, h, { cb, disabled: o.disabled, tip: o.tip, id: o.id || label, cursor: true });
}

function chip(x, y, w, h, val, colA, colB, sc) {
  rr(x, y + 2, w, h, 2, '#00000066');
  rr(x, y, w, h, 2, colB);
  rr(x + 1, y + 1, w - 2, h - 2, 2, colA);
  drawTextC(fmt(val), x + w / 2, y + Math.floor((h - 5 * sc) / 2) + 1, C.white, sc);
}

// ---- unified card face (30x42) -------------------------------------------
const RAR_COL = ['#5d7a86', '#3e8cd0', '#d0563e', '#9a4fd0', '#e8a020', '#4fd0c8'];
const RAR_NAME = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHICAL'];

// charms render as park BADGES: a circular emblem with ribbon tails
function drawBadgeFace(x, y, def, o) {
  o = o || {};
  x |= 0; y |= 0;
  const rim = RAR_COL[def.rar || 0];
  const cx2 = x + 15, cy2 = y + 15;
  // ribbon tails
  rect(x + 7, y + 26, 6, 12, '#8a2a16');
  rect(x + 17, y + 26, 6, 12, '#8a2a16');
  rect(x + 8, y + 27, 4, 10, '#b8452a');
  rect(x + 18, y + 27, 4, 10, '#b8452a');
  rect(x + 9, y + 36, 2, 3, '#8a2a16'); rect(x + 19, y + 36, 2, 3, '#8a2a16');
  // disc with rarity rim
  fillCircle(cx2, cy2 + 2, 14, '#00000066');
  fillCircle(cx2, cy2, 14, rim);
  fillCircle(cx2, cy2, 12, '#2a3a30');
  fillCircle(cx2, cy2 - 1, 11, '#33463a');
  // stitched edge dots
  for (let a = 0; a < 8; a++) {
    const ang = a / 8 * Math.PI * 2;
    rect(cx2 + Math.cos(ang) * 12 - 1, cy2 + Math.sin(ang) * 12 - 1, 1, 1, '#00000055');
  }
  (ICONS[def.ico] || ICONS.star)(cx2 - 6, cy2 - 7);
  // pin glint
  rect(cx2 - 8, cy2 - 10, 2, 2, '#ffffff88');
  if ((def.rar || 0) >= 5) { // mythical shimmer
    const sh = (tNow * 3 | 0) % 3;
    rect(cx2 - 10 + sh * 8, cy2 - 12, 1, 2, '#bffff8');
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
  const bob = hov ? -4 : Math.round(Math.sin(tNow * 1.8 + ph) * 2);
  drawCardFace(x, y + bob, def, kind, o);
  if (hov) { ctx.globalAlpha = 0.35; rr(x - 1, y + bob - 1, 32, 44, 2, '#ffe8a0'); ctx.globalAlpha = 1; drawCardFace(x, y + bob, def, kind, o); }
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
  // the hotter the pool burns, the taller the flames
  const tInt = G.pool ? clamp(G.pool.teeth / 60, 0, 1) : 0;
  const mInt = G.pool ? clamp((G.pool.mult - 1) / 8, 0, 1) : 0;
  if (!hidePool) drawFlames(x, y, half, tInt, ['#1565b5', '#5cc8ff', '#cfeaff']);
  drawFlames(x + half + 12, y, half, mInt, ['#c22a20', '#ff9838', '#ffe089']);
  if (mInt > 0.35) { ctx.save(); ctx.globalAlpha = 0.12 + Math.sin(tNow * 6) * 0.05; rr(x + half + 9, y - 3, half + 6, 22, 3, '#ff5348'); ctx.restore(); }
  if (hidePool) {
    rr(x, y + 2, half, 16, 2, '#00000066'); rr(x, y, half, 16, 2, '#0c3f75'); drawTextC('??', x + half / 2, y + 6, '#7fb8e8', 1);
  } else chip(x, y, half, 16, G.pool ? G.pool.teeth : 0, '#1565b5', '#0c3f75', 1);
  drawTextC('*', x + half + 6, y + 5, C.red, 2);
  chip(x + half + 12, y, half, 16, G.pool ? G.pool.mult : 0, '#c22a20', '#801812', 1);
  drawText('TEETH', x + 2, y + 18, '#7fb8e8', 1);
  drawText('MULT', x + half + 14, y + 18, '#ff9a90', 1);
  y += 27;

  panel(x, y, w, 14, { face: '#252017', edge: '#6b5a2a' });
  drawText('BITE', x + 4, y + 4, C.dim, 1);
  if (bossIs('phantom') && G.pool && G.pool.clicks > 0) drawText('??', x + 30, y + 4, C.gold, 1);
  else drawText(fmt(G.pool ? bankValue() : 0), x + 30, y + 4, C.gold, 1);
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
  drawText('$' + G.money, x + 6, y + 5, C.gold, 2);
  drawTextC('MONEY', x + w - 22, y + 7, '#9ab87a', 1);
  y += 23;

  const deckOk = G.state === 'play' || G.state === 'shop' || G.state === 'swap';
  button(x, y, w, 14, 'TEETH ' + G.drawPile.length + '/' + G.deck.length, '#3a5560', '#243a44',
    () => { G.deckOpen = !G.deckOpen; }, { id: 'deckbtn', disabled: !deckOk, tip: 'YOUR TOOTH DECK|CLICK TO VIEW' });
  y += 19;

  drawTextC('BEST ANTE: ' + best, x + w / 2, SIDEBAR.y + SIDEBAR.h - 18, C.dim, 1);
  button(x, SIDEBAR.y + SIDEBAR.h - 12, w, 10, 'II PAUSE (ESC)', '#243a44', '#16262c', () => { togglePause(); }, { id: 'pausebtn' });
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
        tip: def.name + '|CLICK FOR DETAILS' + (inShop ? '|DRAG TO THE BARREL TO SELL' : ''),
        click: () => { G.inspect = { kind: 'charm', def, idx: i }; },
      };
      if (inShop) { o.dragKind = 'charm'; o.dragIdx = i; }
      drawCardAnim(x, y, def, 'charm', i, o);
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
const BARREL = { x: 124, y: 200, w: 44, h: 46 };
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

function drawShop() {
  // ================= the trading post INTERIOR =================
  // wall: horizontal planks with seams and nails
  for (let y = 0; y < 212; y += 14) {
    rect(0, y, W, 14, ((y / 14) | 0) % 2 ? '#4e3722' : '#463019');
    rect(0, y + 13, W, 1, '#2e1f12');
  }
  [[36, 20], [318, 48], [452, 20], [104, 160], [396, 174]].forEach(([nx, ny]) => rect(nx, ny, 2, 2, '#2e1f12'));
  // gloom at the ceiling
  for (let i = 0; i < 10; i++) { ctx.save(); ctx.globalAlpha = (10 - i) / 10 * 0.5; rect(0, i * 3, W, 3, '#160e08'); ctx.restore(); }
  // floorboards
  rect(0, 212, W, H - 212, '#3a2818');
  rect(0, 212, W, 3, '#241708');
  for (let x = 0; x < W; x += 48) rect(x + ((x / 48) | 0) % 2 * 24, 215, 1, H - 215, '#2e1f12');
  for (let y = 226; y < H; y += 16) rect(0, y, W, 1, '#31210f');
  // woven rug under the goods
  rr(170, 232, 180, 26, 4, '#6a3a2a');
  rr(174, 235, 172, 20, 3, '#8a5038');
  for (let k = 0; k < 4; k++) rect(178 + k * 42, 237, 22, 16, k % 2 ? '#a86a48' : '#6a3a2a');
  rect(174, 244, 172, 2, '#5a3020');
  // window on the left wall, night swamp outside
  panel(20, 60, 88, 74, { face: '#0c1c26', edge: '#2e1f12', r: 2 });
  ['#0a1626', '#0f2434', '#17343f'].forEach((c, i) => rect(22, 62 + i * 24, 84, 24, c));
  fillCircle(84, 78, 9, '#e8e8d0'); ctx.save(); ctx.globalAlpha = 0.25; fillCircle(84, 78, 12, '#e8e8d0'); ctx.restore();
  for (let x = 26; x < 102; x += 6) { const h1 = 10 + ((Math.sin(x * 0.3) * 5) | 0); rect(x, 132 - h1, 6, h1, '#0d2028'); }
  if ((tNow % 3) < 1.6) { const fx2 = 40 + (tNow * 7 % 50); rect(fx2, 90 + Math.sin(tNow * 3) * 8, 1, 1, '#eaffa0'); }
  rect(20, 94, 88, 3, '#2e1f12'); rect(62, 60, 3, 74, '#2e1f12'); // cross frame
  rect(16, 134, 96, 5, '#241708'); // sill
  // hanging lantern between window and sign
  rect(146, 0, 2, 22, '#241708');
  rr(141, 22, 12, 14, 3, '#2a2018');
  rect(144, 25, 6, 8, '#ffd54a');
  rect(145, 26, 2, 3, '#fff6c8');
  ctx.save(); ctx.globalAlpha = 0.10 + Math.sin(tNow * 4) * 0.025; fillCircle(147, 30, 34, '#ffb848'); ctx.globalAlpha = 0.06; fillCircle(147, 32, 52, '#ffb848'); ctx.restore();
  // wooden shelves behind the goods
  const shelf = (sy, sh2) => {
    rr(164, sy, 300, sh2, 3, '#4a3320');
    rr(166, sy + 2, 296, sh2 - 4, 3, '#5f4228');
    for (let k = 0; k < 5; k++) rect(170 + k * 60, sy + 2, 1, sh2 - 4, '#4a332044');
    rect(166, sy + sh2 - 3, 296, 3, '#3a2818');
    rect(170, sy + sh2, 4, 6, '#241708'); rect(456, sy + sh2, 4, 6, '#241708'); // brackets
  };
  shelf(88, 88); shelf(182, 52);
  // hanging wooden sign on ropes
  rect(238, 30, 2, 12, '#8a7a58'); rect(354, 30, 2, 12, '#8a7a58');
  panel(206, 40, 182, 26, { face: '#5f4228', edge: '#8a6a3a', r: 2 });
  drawTextCSh('EVERGLADES', 296, 44, '#ffe6b0', 2);
  drawTextC('T R A D I N G   P O S T', 296, 58, '#c8a878', 1);
  // park arrowhead emblem
  rr(166, 34, 30, 36, 4, '#5a4028');
  rr(168, 36, 26, 32, 4, '#7a5a34');
  rect(172, 42, 8, 12, '#2c5a24'); rect(176, 38, 3, 6, '#2c5a24'); // tree
  rect(182, 52, 8, 4, '#5aa843'); rect(184, 50, 4, 2, '#5aa843'); // gator
  rect(170, 60, 22, 3, '#3f6aa8'); // water stripe
  // mounted "big catch" fish + antler hooks on the free wall
  rr(28, 152, 56, 16, 5, '#5c8a9a'); rect(20, 156, 10, 8, '#5c8a9a'); rect(80, 154, 8, 4, '#48707e'); rect(38, 156, 3, 3, '#10181e');
  rect(24, 172, 60, 4, '#4a3320');
  // Merle the manatee at his counter (right side)
  rr(420, 146, 58, 40, 3, '#4a3320');
  rr(422, 148, 54, 8, 3, '#5f4228');
  rect(424, 186, 4, 26, '#241708'); rect(468, 186, 4, 26, '#241708'); // counter legs
  rr(428, 160, 14, 12, 2, '#c8b060'); rect(430, 158, 10, 3, '#a89040'); // tip jar
  rect(431, 164, 3, 2, C.gold); rect(436, 166, 3, 2, C.gold);
  drawVendor(432, 108);
  const vline = VENDOR.lines[Math.floor(tNow / 6) % VENDOR.lines.length];
  if ((tNow % 6) < 4.2) {
    const bw = Math.min(150, textW(vline, 1) + 12);
    panel(470 - bw, 74, bw, 14, { face: '#f4f2e4', edge: '#c8b060', r: 2 });
    drawText(vline.slice(0, 30), 470 - bw + 5, 78, '#3a2818', 1);
    rect(452, 88, 3, 4, '#f4f2e4'); // bubble tail toward Merle
  }
  hit(424, 104, 52, 78, { id: 'merle', tip: VENDOR.name + '|' + VENDOR.who + "|'" + vline + "'" });

  // ---- money-only HUD: in the shop you only care about your wallet ----
  panel(8, 8, 100, 30, { face: '#26321e', edge: '#5a7a3a' });
  drawText('$' + G.money, 18, 16, C.gold, 3);
  drawTextC('YOUR MONEY', 58, 42, '#9ab87a', 1);
  button(8, 52, 100, 16, 'TEETH ' + G.drawPile.length + '/' + G.deck.length, '#3a5560', '#243a44',
    () => { G.deckOpen = !G.deckOpen; }, { id: 'deckbtn', tip: 'YOUR TOOTH DECK|CLICK TO VIEW' });
  drawTopBar(true);

  const bx0 = 180;
  G.shopItems.forEach((it, i) => {
    const x = bx0 + i * 58, y = 96;
    panel(x - 4, y - 6, 52, 82, { face: '#1a2530dd' });
    if (it.sold) {
      drawTextC('SOLD', x + 22, y + 30, C.dim, 1);
      return;
    }
    const afford = G.money >= it.price;
    drawCardAnim(x + 7, y + 2, it.def, it.kind, i + 10, {
      id: 'shopitem' + i,
      price: it.price, afford,
      tip: it.def.name + '|CLICK FOR DETAILS',
      click: () => { G.inspect = { kind: 'shop', item: it }; },
    });
    const label = it.kind === 'charm' ? 'BADGE' : it.kind === 'tool' ? 'TOOL' : 'CARD';
    drawTextC(label, x + 22, y + 50, it.kind === 'tool' ? '#7fd0c0' : C.dim, 1);
    const nm = it.def.name;
    if (nm.length > 9 && nm.includes(' ')) {
      const cut = nm.lastIndexOf(' ');
      drawTextC(nm.slice(0, cut), x + 22, y + 59, C.white, 1);
      drawTextC(nm.slice(cut + 1), x + 22, y + 67, C.white, 1);
    } else {
      drawTextC(nm, x + 22, y + 62, C.white, 1);
    }
  });

  // packs shelf
  G.shopPacks.forEach((p, i) => {
    const x = 186 + i * 78, y = 186;
    const hov = mx >= x && mx < x + 64 && my >= y - 4 && my < y + 44;
    const yy = y + (hov ? -3 : Math.round(Math.sin(tNow * 1.6 + i * 2) * 1.5));
    if (p.sold) { panel(x, y, 64, 40, { face: '#141c22' }); drawTextC('OPENED', x + 32, y + 17, C.dim, 1); return; }
    drawPackArt(x, yy, 64, 44, p.def);
    const afford = G.money >= p.price;
    drawTextC('$' + p.price, x + 32, yy + 44, afford ? C.gold : C.red, 1);
    hit(x, y - 2, 64, 48, {
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

// foil snack/TCG pack art: crimped edges, mascot, shine
function drawPackArt(x, y, w, h, def) {
  x |= 0; y |= 0;
  const col = def.col || '#c9941a';
  const dark = '#00000055';
  // crimped top and bottom (zigzag teeth)
  for (let k = 0; k < Math.floor(w / 6); k++) {
    rect(x + k * 6 + 1, y, 4, 3, col);
    rect(x + k * 6 + 1, y + h - 3, 4, 3, col);
  }
  rect(x, y + 2, w, 2, col);
  rect(x, y + h - 4, w, 2, col);
  // bag body
  rr(x, y + 3, w, h - 6, 2, col);
  rr(x + 2, y + 5, w - 4, h - 10, 2, '#1a2530');
  // brand band
  rect(x + 2, y + 7, w - 4, 9, col);
  rect(x + 2, y + 16, w - 4, 1, '#ffffff44');
  const words = def.name.split(' ');
  drawTextC(words[0].slice(0, 9), x + w / 2, y + 9, '#fff', 1);
  if (words[1]) drawTextC(words[1].slice(0, 9), x + w / 2, y + 19, '#ffe6b0', 1);
  // mascot gator winking
  const mx2 = x + 8, my2 = y + h - 18;
  rr(mx2, my2 + 4, 16, 7, 3, '#5aa843');
  rr(mx2 + 1, my2, 6, 6, 2, '#5aa843');
  rr(mx2 + 9, my2, 6, 6, 2, '#5aa843');
  rect(mx2 + 3, my2 + 2, 2, 2, '#f8f4dc'); rect(mx2 + 11, my2 + 2, 2, 1, '#1b1408'); // wink
  rect(mx2 + 2, my2 + 8, 12, 1, '#f8f4dc'); // grin
  // product motif
  if (def.kind === 'tooth') { ICONS.tooth(x + w - 18, my2 - 2, '#fff'); }
  else { ctx.save(); ctx.translate(x + w - 19, my2 - 2); ICONS.tdrill(0, 0); ctx.restore(); }
  // starburst 'PICK N!'
  fillCircle(x + w - 9, y + 10, 7, '#ffe089');
  fillCircle(x + w - 9, y + 10, 6, '#d94f30');
  drawTextC('' + def.picks, x + w - 9, y + 8, '#fff', 1);
  // diagonal foil shine
  ctx.globalAlpha = 0.18;
  for (let k = 0; k < 3; k++) rect(x + 6 + k * 3 + ((tNow * 8 | 0) % Math.max(1, w)), y + 4, 2, h - 8, '#ffffff');
  ctx.globalAlpha = 1;
}

// ------------------------------------------------------ pack opening ------
function drawPackOpen(dt) {
  const p = G.pack; if (!p) return;
  p.t += dt;
  overlayDim(0.78);
  hit(0, 0, W, H, { cb: () => { }, id: 'packblock' });
  drawPackArt(W / 2 - 130, 14, 64, 48, p.product);
  drawPackArt(W / 2 + 66, 14, 64, 48, p.product);
  drawTextCSh(p.product.name, W / 2, 24, C.gold, 3);
  drawTextCSh("'" + p.product.flav + "'", W / 2, 46, '#6f8a90', 1);
  drawTextCSh(p.picksLeft > 1 ? 'PICK ' + p.picksLeft : 'PICK ONE', W / 2, 58, C.white, 1);
  const n = p.options.length;
  const spacing = n > 4 ? 66 : 70;
  p.options.forEach((o, i) => {
    const x = W / 2 - (n * spacing - 14) / 2 + i * spacing;
    if (o.taken) {
      panel(x - 2, 88, 60, 30, { face: '#141c22' });
      drawTextC('TAKEN', x + 26, 99, C.green, 1);
      return;
    }
    const appear = clamp(p.t * 2 - i * 0.25, 0, 1);
    if (appear <= 0) return;
    const y = 78 + (1 - easeOut(appear)) * 60;
    const hov = appear >= 1 && mx >= x - 4 && mx < x + 60 && my >= y - 6 && my < y + 108;
    const yy = y + (hov ? -4 : 0);
    // flip-in: show pack back until half-open
    if (appear < 0.5) {
      rr(x, yy + 10, 56, 76, 3, '#2a3a44');
      rr(x + 4, yy + 14, 48, 68, 3, '#1c2830');
      drawTextC('?', x + 28, yy + 40, '#41565e', 3);
      return;
    }
    panel(x - 2, yy - 2, 60, 112, { face: '#1a2530f0', edge: hov ? C.gold : '#3a5a50' });
    if (o.tooth) {
      drawTooth(x + 16, yy + 8, 24, 32, true, o.tooth, {});
      const d = TOOTH_DEFS[o.tooth];
      drawTextC(d.name.replace(' TOOTH', '').replace(' FANG', ''), x + 28, yy + 48, C.white, 1);
      drawSmallWrapped(d.desc, x + 3, yy + 58, 54, C.dim);
    } else {
      drawCardFace(x + 13, yy + 6, o.tool, 'tool', {});
      drawTextC(o.tool.name.split(' ')[0], x + 28, yy + 54, C.white, 1);
      drawSmallWrapped(o.tool.desc, x + 3, yy + 64, 54, C.dim);
    }
    hit(x - 2, y - 4, 60, 116, {
      cb: () => pickPack(i), id: 'packopt' + i, cursor: true,
      tip: o.tooth ? TOOTH_DEFS[o.tooth].name + '|' + TOOTH_DEFS[o.tooth].desc : o.tool.name + '|' + o.tool.desc,
    });
  });
  drawTextC('CHOOSE WISELY, RANGER', W / 2, 216, '#54707a', 1);
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
  rect(cx - 6, y - 22, 3, 22, '#5a646c'); rect(cx + 12, y - 22, 3, 22, '#5a646c');
  rr(cx - 10, y - 27, 28, 7, 2, '#c23a4a');
  rr(cx - 6, y - 32, 20, 7, 2, '#2c4436'); // torso
  drawRangerFace(cx - 4, y - 58, G.ranger);
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
      o.drawImage(canvas, 0, 0);
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
    rr(58, 208 + rb, 16, 26, 4, '#0e161c'); // body silhouette
    drawRangerFace(52, 182 + rb, G.ranger); // face catches the lantern light
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
  const key = G.boss ? G.boss.id : 'x';
  if (bossShot && bossShot.key === key) return bossShot.c;
  ctx.clearRect(0, 0, W, H);
  const _mx = mx, _my = my; mx = 294; my = 150;
  drawCroc(0.42, { angry: true });
  mx = _mx; my = _my;
  const oc = document.createElement('canvas'); oc.width = W; oc.height = H;
  const o = oc.getContext('2d'); o.imageSmoothingEnabled = false; o.drawImage(canvas, 0, 0);
  bossShot = { key, c: oc };
  return oc;
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
  panel(22, 48, 118, 118, { face: '#10262cee', edge: '#5cb0ac', r: 4 });
  ctx.save(); ctx.translate(40, 62); ctx.scale(3, 3); drawRangerFace(0, 0, G.ranger); ctx.restore();
  // gloved fist + forceps under the portrait
  const g = GLOVES[meta.glove] || GLOVES.bare;
  rr(96, 128, 30, 22, 6, g.skin); rr(98, 144, 26, 8, 3, g.shade);
  rect(100, 124, 6, 8, g.skin); rect(108, 122, 6, 10, g.skin); rect(116, 124, 6, 8, g.skin);
  rect(96, 150, 30, 5, g.cuff);
  for (let i = 0; i <= 8; i++) { rect(124 + i, 118 - i, 2, 2, '#5cb0ac'); rect(132 - i, 118 - i, 2, 2, '#5cb0ac'); }
  drawTextCSh('RANGER ' + R.name, 81, 172, '#7fd4e8', 1);
  drawTextCSh('THE DENTIST', 81, 184, C.white, 2);
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
  button(W / 2 - 75, 178, 150, 26, 'ENDLESS MODE >', '#7a4fd0', '#4a2a8a', () => { enterShop(); }, { id: 'endless', tip: 'Keep going!|Targets keep growing forever' });
  button(W / 2 - 55, 212, 110, 22, 'NEW RUN', '#d94f30', '#8a2a16', () => { G.state = 'ranger'; }, { id: 'newrun2' });
}

// ------------------------------------------------------------ menu --------
function drawMenu() {
  const th = THEMES.night;
  drawSceneBack(th);
  // a distant airboat crosses the far water now and then
  const abT = (tNow % 18) / 18;
  if (abT < 0.4) {
    const ax = lerp(-70, W + 70, abT / 0.4);
    ctx.save(); ctx.translate(ax, 205); ctx.scale(0.45, 0.45); drawAirboat(0, 0, true, undefined); ctx.restore();
  }
  const chomp = Math.max(0, Math.sin(tNow * 1.4)) * 0.9;
  drawCroc(chomp);
  drawSceneFront(th);

  // hanging trading-post sign: carved logo on swaying ropes
  const sway = Math.sin(tNow * 1.1) * 2;
  const sx0 = W / 2 - 122 + sway;
  rect(W / 2 - 78 + sway * 0.4, 0, 2, 13, '#8a7a58'); rect(W / 2 + 76 + sway * 0.4, 0, 2, 13, '#8a7a58');
  panel(sx0, 12, 244, 44, { face: '#5f4228', edge: '#8a6a3a', r: 3 });
  rect(sx0 + 6, 16, 232, 1, '#4a332088');
  rect(sx0 + 6, 51, 232, 2, '#3a2818');
  [[4, 16], [236, 16], [4, 48], [236, 48]].forEach(([nx, ny]) => { rect(sx0 + nx, ny, 3, 3, '#3a2818'); rect(sx0 + nx, ny, 1, 1, '#c8b060'); });
  drawTextCSh('BITE', W / 2 - 60 + sway, 21, C.gold, 5, '#2a1a0c');
  drawTextCSh('DOWN', W / 2 + 64 + sway, 21, '#63d66a', 5, '#2a1a0c');
  // tagline plank swings a touch more
  panel(W / 2 - 94 + sway * 1.5, 60, 188, 14, { face: '#4a3320', edge: '#6a4a2a', r: 2 });
  drawTextC('A PUSH-YOUR-LUCK DENTAL ROGUELIKE', W / 2 + sway * 1.5, 64, '#e8d8b0', 1);

  // dock planks under the button row
  rect(120, 244, 360, 26, '#3a2818');
  rect(120, 244, 360, 3, '#4a3320');
  for (let x = 132; x < 480; x += 46) rect(x, 247, 1, 23, '#2e1f12');
  [150, 300, 448].forEach(x => { rect(x, 240, 5, 6, '#241708'); });

  button(W / 2 - 78, 206, 156, 34, 'NEW RUN', '#d94f30', '#8a2a16', () => { G.state = 'ranger'; }, { id: 'start', sc: 2 });
  button(122, 246, 82, 19, 'HOW TO', '#3a5560', '#243a44', () => { G.howFrom = 'menu'; G.state = 'how'; }, { id: 'how' });
  button(210, 246, 82, 19, 'GACHA', '#7a4fd0', '#4a2a8a', () => { ensureDaily(); G.state = 'pass'; }, { id: 'passbtn', tip: 'SCOUT GACHA-PON|Trade cookies for capsule prizes:|cards, glove skins, permanent upgrades|' + (meta.rp || 0) + ' SCOUT COOKIES' });
  button(298, 246, 82, 19, 'SETTINGS', '#3a5560', '#243a44', () => { G.overlay = 'settings'; }, { id: 'setbtn' });
  button(386, 246, 82, 19, 'CREDITS', '#3a5560', '#243a44', () => { G.overlay = 'credits'; }, { id: 'credbtn' });
  ensureDaily();
  const steps = NPC_ORDER.reduce((a, nk) => a + meta.chains[nk].step, 0);
  drawTextSh('QUESTS: ' + steps + '/24', 10, 152, C.dim, 1);
  ICONS.cookie(8, 162);
  drawTextSh(fmt(meta.rp || 0) + ' COOKIES', 24, 165, C.gold, 1);
  if (best > 0) drawTextSh('BEST ANTE: ' + best, 10, 180, '#8fa6a8', 1);

  // glove rack (bottom left) - 6 wide to fit the gacha skins
  panel(6, 194, 110, 68, { face: '#16222acc' });
  drawTextC('GLOVES', 61, 199, C.dim, 1);
  GLOVE_ORDER.forEach((k, i) => {
    const gx = 12 + (i % 6) * 17, gy = 208 + Math.floor(i / 6) * 19;
    const g = GLOVES[k];
    const open = gloveUnlocked(k);
    const sel = meta.glove === k;
    rr(gx, gy, 16, 16, 2, sel ? C.gold : '#0d161b');
    rr(gx + 1, gy + 1, 14, 14, 2, open ? '#243642' : '#141c22');
    if (open) ICONS.glove(gx + 2, gy + 2, g.skin);
    else { drawTextC('?', gx + 8, gy + 5, '#41565e', 1); }
    const a = ACHS.find(a => a.id === g.ach);
    hit(gx, gy, 16, 16, {
      id: 'glove' + k, cursor: open,
      tip: open ? (g.name + '|' + g.flav + (sel ? '|EQUIPPED' : '|CLICK TO EQUIP'))
        : ('LOCKED: ' + g.name + '|' + (g.gacha ? 'WIN IT IN THE GACHA-PON' : a ? 'ACHIEVEMENT: ' + a.name + '|' + a.desc : '')),
      cb: () => { if (open) { meta.glove = k; saveMeta(); sfx.buy(); } else sfx.error(); },
    });
  });
  const done = ACHS.filter(a => meta.ach[a.id]).length;
  drawTextC(done + '/' + ACHS.length + ' UNLOCKED', 61, 250, '#54707a', 1);
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
function drawRangerSelect() {
  const th = THEMES.night;
  drawSceneBack(th);
  drawSceneFront(th);
  overlayDim(0.5);
  drawTextCSh('CHOOSE YOUR RANGER', W / 2, 10, C.gold, 3);
  if (!rangerFocus) rangerFocus = meta.ranger || 'scout';
  // left: tile column of the 5 animals; the pick slides out with an arrow
  RANGER_ORDER.forEach((key, i) => {
    const r = RANGERS[key];
    const open = rangerUnlocked(key);
    const sel = rangerFocus === key;
    const x = sel ? 46 : 40, y = 36 + i * 42;
    panel(x, y, 46, 38, { face: sel ? '#26321e' : open ? '#1a2530ee' : '#10161aee', edge: sel ? C.gold : open ? r.col : '#2c3a44' });
    if (open) drawRangerFace(x + 9, y + 5, key);
    else {
      ctx.globalAlpha = 0.25; drawRangerFace(x + 9, y + 5, key); ctx.globalAlpha = 1;
      drawTextC('?', x + 23, y + 13, '#41565e', 2);
    }
    if (sel) drawText('>', x - 12 + Math.round(Math.sin(tNow * 5) * 1.5), y + 13, C.gold, 2);
    hit(x, y, 46, 38, {
      id: 'rtile' + key, cursor: true, tip: open ? (r.name + '|' + r.animal) : ('LOCKED|' + r.name),
      cb: () => { rangerFocus = key; sfx.hover(); },
    });
  });
  // right: the ranger's dossier on a wooden file board
  const r = RANGERS[rangerFocus];
  const focusOpen = rangerUnlocked(rangerFocus);
  const px = 106, py = 32, pw = 338, ph = 208;
  panel(px, py, pw, ph, { face: '#2e2214f4', edge: '#5a4028', r: 4 });
  drawText('RANGER FILE', px + 12, py + 8, '#8a7a58', 1);
  const stamp = 'EVERGLADES DENTAL PATROL';
  drawText(stamp, px + pw - 12 - textW(stamp, 1), py + 8, '#8a7a5888', 1);
  rect(px + 10, py + 17, pw - 20, 1, '#5a402888');
  // pinned photo card with accent glow
  const fx = px + 16, fy = py + 26;
  rr(fx - 3, fy - 3, 96, 108, 2, '#e8e0c8');
  rr(fx, fy, 90, 90, 2, '#10181e');
  ctx.save(); ctx.globalAlpha = 0.18 + Math.sin(tNow * 2) * 0.05; fillCircle(fx + 45, fy + 45, 40, focusOpen ? r.col : '#2c3a44'); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.rect(fx, fy, 90, 90); ctx.clip();
  ctx.translate(fx + 3, fy + 5); ctx.scale(3, 3);
  if (!focusOpen) ctx.globalAlpha = 0.3;
  drawRangerFace(0, 0, rangerFocus);
  ctx.restore();
  rect(fx + 41, fy - 7, 8, 8, '#c23a4a'); rect(fx + 43, fy - 5, 3, 3, '#e86a6a'); // pin
  drawTextC(focusOpen ? r.animal : '? ? ?', fx + 45, fy + 94, '#8a7a58', 1);
  if (meta.ranger === rangerFocus && focusOpen) {
    rr(fx - 8, fy + 70, 60, 12, 2, C.gold);
    drawText('LAST USED', fx - 3, fy + 73, '#3a2818', 1);
  }
  // traits column
  const tx = px + 126;
  drawText(r.name, tx, py + 28, focusOpen ? r.col : '#41565e', 2);
  rect(tx, py + 44, pw - 142, 1, '#8a7a5866');
  if (focusOpen) {
    r.lines.forEach((l, k) => {
      const ly = py + 54 + k * 15;
      rect(tx, ly, 5, 5, r.col); rect(tx + 1, ly + 1, 3, 3, '#00000044');
      drawText(l, tx + 11, ly - 1, C.white, 1);
    });
    drawText("'" + r.flav + "'", tx, py + 106, '#a89468', 1);
  } else {
    const a = ACHS.find(a2 => a2.id === r.ach);
    drawText('FILE SEALED.', tx, py + 54, '#ff9a90', 1);
    if (a) {
      drawText('EARN: ' + a.name, tx, py + 70, C.gold, 1);
      drawSmallWrapped(a.desc, tx, py + 82, pw - 142, C.white);
    }
  }
  button(px + pw / 2 - 65, py + ph - 42, 130, 28, focusOpen ? 'HEAD OUT >' : 'LOCKED', '#d94f30', '#8a2a16',
    () => { const k = rangerFocus; startTransition(() => { newRun(k); startIntro(); }); }, { id: 'rangergo', sc: 1, disabled: !focusOpen });
  button(W / 2 - 40, 248, 80, 16, '< BACK', '#3a5560', '#243a44', () => { G.state = 'menu'; }, { id: 'rangerback' });
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
function drawMiniGator(x, y, type) {
  const cols = { small: ['#8a9a4e', '#5c6a2e'], big: ['#4e8f3d', '#2f6626'], gold: ['#d8b842', '#a8882a'], boss: ['#8a3030', '#5e1c1c'] };
  const [a, b] = cols[type] || cols.small;
  rr(x, y + 4, 22, 9, 3, a);
  rr(x + 1, y + 10, 20, 4, 2, b);
  [[x + 3], [x + 13]].forEach(([ex]) => {
    rr(ex, y, 7, 7, 2, a);
    rect(ex + 2, y + 2, 3, 3, '#f8f4dc');
    rect(ex + 3, y + 3, 1, 2, '#1b1408');
  });
  if (type === 'small') { rr(x + 4, y - 4, 14, 6, 3, '#5c6a2e'); rect(x + 7, y - 3, 3, 2, '#3a4420'); rect(x + 12, y - 3, 3, 2, '#3a4420'); } // turtle shell
  if (type === 'gold') { rect(x + 8, y - 3, 2, 2, '#fff6c8'); rect(x + 16, y + 2, 1, 1, '#fff6c8'); }
  if (type === 'boss') { rect(x + 2, y - 2, 3, 3, C.red); rect(x + 9, y - 3, 3, 4, C.red); rect(x + 16, y - 2, 3, 3, C.red); }
}
function drawMap() {
  const th = themeNow();
  drawSceneBack(th);
  drawSceneFront(th);
  overlayDim(0.35);
  drawTextCSh('THE SWAMP TRAIL', W / 2, 10, C.gold, 3);
  drawTextCSh('ANTE ' + G.ante + (G.ante <= 8 ? ' OF 8' : ' - ENDLESS'), W / 2, 34, C.white, 1);
  panel(64, 48, 382, 178, { face: '#101c1eee', edge: '#3a5a50' });
  // money + ranger chip
  panel(66, 26, 74, 18, { face: '#26321e', edge: '#5a7a3a' });
  drawText('$' + G.money, 74, 31, C.gold, 1);
  drawRangerFace(112, 22, G.ranger);
  // winding channel
  for (let x = 76; x < 434; x += 4) {
    const yc = 148 + Math.sin(x * 0.03) * 26;
    rect(x, yc - 13, 4, 30, '#0d2830');
    if ((x / 4 | 0) % 5 === 0) rect(x, yc + Math.sin(tNow * 1.2 + x * 0.1) * 3, 3, 1, '#1e4a52');
  }
  // start dock
  rr(84, 138, 26, 22, 3, '#4a3320');
  drawTextC('DOCK', 97, 164, C.dim, 1);
  // live quest tracker (top-left corner of the chart)
  panel(68, 52, 100, 60, { face: '#10181ecc', edge: '#3a5a50', r: 2 });
  drawText('QUESTS', 74, 56, C.purple, 1);
  NPC_ORDER.forEach((nk, i) => {
    const cq = chainQuest(nk);
    const qy = 65 + i * 15;
    rect(72, qy, 5, 5, NPCS[nk].col);
    if (!cq) { drawText('DONE!', 81, qy, C.green, 1); return; }
    drawText(cq.name.slice(0, 12), 81, qy - 1, '#b8c8c8', 1);
    rect(81, qy + 6, 60, 3, '#0a1215');
    const pr = clamp(cq.prog / cq.goal, 0, 1);
    if (pr > 0) rect(81, qy + 6, Math.floor(60 * pr), 3, C.gold);
    drawText(cq.prog + '/' + cq.goal, 144, qy + 3, C.dim, 1);
    hit(70, qy - 2, 96, 14, { id: 'qtrack' + nk, tip: NPCS[nk].name + '|' + cq.name + '|' + cq.prog + '/' + cq.goal + '  (+' + cq.rp + ' COOKIES)' });
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
      // node art
      if (node.type === 'event') {
        drawTextC('?', p.x, p.y - 8 - pulse, C.purple, 2);
      } else {
        drawMiniGator(p.x - 11, p.y - 10 - pulse, node.type);
      }
      drawTextC(node.type === 'boss' ? 'BOSS' : node.type.toUpperCase(), p.x, p.y + 8 - pulse, visited ? C.green : reachable ? d.col : '#41565e', 1);
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
  rr(bpos.x - 12, bpos.y + bob, 24, 7, 3, '#5a3a1e');
  rr(bpos.x - 9, bpos.y - 2 + bob, 18, 4, 2, '#7a5230');
  drawRangerFace(bpos.x - 14 + lean, bpos.y - 26 + bob, G.ranger);
  drawTextC(G.boat ? '. . .' : 'PICK YOUR NEXT STOP', W / 2, 234, C.dim, 1);
}
function nodeTip(node) {
  const d = NODE_DEFS[node.type];
  if (node.type === 'event') return 'SWAMP EVENT|Something is waiting in the reeds...|No fight. No shop. A choice.';
  const base = G.ante <= 8 ? ANTE_BASE[G.ante - 1] : ANTE_BASE[7] * Math.pow(1.7, G.ante - 8);
  let t = d.name + '|TARGET: ' + fmt(Math.round(base * d.mult)) + '|REWARD: $' + (d.reward + Math.floor(G.ante / 3) + ((node.mods || []).includes('richwater') ? 4 : 0));
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

  // ---- quest board (cookies come from these) ----
  panel(236, 50, 232, 172, { face: '#1a121066', edge: '#5a4028', r: 4 });
  drawTextCSh('QUEST BOARD', 352, 56, C.purple, 1);
  drawTextC('FINISH QUESTS TO EARN COOKIES', 352, 66, '#8a7a58', 1);
  NPC_ORDER.forEach((nk, i) => {
    const npc = NPCS[nk];
    const cq = chainQuest(nk);
    const x = 242, y = 74 + i * 48, w2 = 220, h2 = 44;
    panel(x, y, w2, h2, { face: '#1a2530ee', edge: npc.col });
    rr(x + 3, y + 3, 30, 30, 3, '#10181e');
    ctx.save(); ctx.translate(x + 4, y + 4); ctx.scale(0.9, 0.9); drawNpcFace(0, 0, nk); ctx.restore();
    drawText(npc.name, x + 38, y + 4, npc.col, 1);
    // chain pips
    QUEST_CHAINS[nk].forEach((_, s) => {
      const done = meta.chains[nk].step > s;
      rect(x + 150 + s * 8, y + 5, 5, 5, done ? C.gold : '#0a1215');
      if (done) rect(x + 151 + s * 8, y + 6, 3, 3, '#fff6c8');
    });
    if (cq) {
      drawText(cq.name, x + 38, y + 14, C.white, 1);
      rect(x + 38, y + 24, 130, 6, '#0a1215');
      const pr = clamp(cq.prog / cq.goal, 0, 1);
      if (pr > 0) {
        rect(x + 38, y + 24, Math.floor(130 * pr), 6, C.gold);
        rect(x + 38, y + 24, Math.floor(130 * pr), 2, '#ffe089');
      }
      drawText(cq.prog + '/' + cq.goal, x + 38, y + 33, C.dim, 1);
      ICONS.cookie(x + 176, y + 20);
      drawText('+' + cq.rp, x + 190, y + 24, C.gold, 1);
    } else {
      drawText('ALL QUESTS DONE - LEGEND!', x + 38, y + 20, C.green, 1);
    }
    hit(x, y, w2, h2, { id: 'npc' + nk, tip: npc.name + '|' + npc.who + "|'" + npc.line + "'" });
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
    else (ICONS[a.ico] || ICONS.star)(x + 13, y + 6);
    ctx.restore();
    if (a.owned) { rect(x + cw - 14, y + 3, 6, 6, C.green); drawText('+', x + cw - 13, y + 4, '#0d161b', 1); }
    drawTextC(a.name.split(' ')[0].slice(0, 7), x + (cw - 6) / 2, y + ch - 13, a.owned ? C.white : '#54707a', 1);
    hit(x, y, cw - 6, ch - 6, { id: 'gsp' + i, tip: a.name + '|' + a.kind + ' - ' + RAR_NAMES[a.rar] + '|' + a.desc + '|' + (a.owned ? 'COLLECTED' : 'STILL IN THE DOME') });
  });
  button(W / 2 - 40, py + ph - 18, 80, 14, 'CLOSE', '#d94f30', '#8a2a16', () => { G.gachaShow = false; }, { id: 'gsclose' });
}

// ----------------------------------- swamp mini-games -----------------------
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
  rr(x, y + 8, 18, 14, 4, '#2c4436');
  drawRangerFace(x - 3, y - 18, G.ranger);
  rect(x + 2, y + 20, 5, 4, '#1c2a20'); rect(x + 11, y + 20, 5, 4, '#1c2a20');
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
      // dock + seated ranger with rod
      rect(34, wy - 4, 72, 6, '#4a3320'); rect(40, wy + 2, 4, 14, '#3a2818'); rect(96, wy + 2, 4, 14, '#3a2818');
      drawRangerSitting(64, wy - 26);
      const rodX = 88, rodY = wy - 30;
      for (let i = 0; i < 14; i++) rect(rodX + i * 2, rodY - i, 2, 2, '#8a6a3a');
      // line sags from the rod tip out to the bobber
      const dip = s && s.ph === 'bite' ? 6 : 0;
      const bobY = wy + 8 + dip + Math.round(Math.sin(tNow * 2.2) * 1.5);
      const tipX = rodX + 28, tipY = rodY - 13;
      ctx.save(); ctx.globalAlpha = 0.4;
      for (let i = 0; i <= 20; i++) {
        const f = i / 20;
        const lx = lerp(tipX, 300, f), lyy = lerp(tipY, bobY - 3, f) + Math.sin(f * Math.PI) * 12;
        rect(lx, lyy, 1, 1, '#cfe8f0');
      }
      ctx.restore();
      fillCircle(300, bobY - 2, 4, '#d94f30'); rect(298, bobY - 6, 3, 3, '#f4f2e4');
      if (s && s.ph === 'bite') { drawTextCSh('!', 300, bobY - 22, C.gold, 2); addRippleThrottle(s, 300, bobY + 4); }
      // caught fish arc
      if (s && s.fx) {
        const f = s.fx.t / 0.8;
        const fx2 = 300 - f * 190, fy = bobY - Math.sin(f * Math.PI) * 60;
        rr(fx2, fy, 14, 6, 3, '#5c8a9a'); rect(fx2 - 4, fy + 1, 5, 4, '#48707e'); rect(fx2 + 10, fy + 2, 3, 2, '#10181e');
      }
      // bucket with the catch, sitting on the dock
      rr(38, wy - 14, 16, 12, 2, '#3a444c'); rect(40, wy - 16, 12, 3, '#2a343c'); rect(38, wy - 2, 16, 2, '#2a343c');
      if (s) for (let i = 0; i < s.caught; i++) rect(40 + (i % 3) * 4, wy - 12 + ((i / 3) | 0) * 4, 3, 2, '#5c8a9a');
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
      // feeding platform + ranger with bucket of drumsticks
      rect(52, wy - 4, 50, 6, '#4a3320'); rect(56, wy + 2, 4, 14, '#3a2818'); rect(92, wy + 2, 4, 14, '#3a2818');
      drawRangerSitting(60, wy - 26);
      rr(92, wy - 16, 14, 12, 2, '#8a5038'); if (s) for (let i = 0; i < Math.min(6, s.throws); i++) rect(94 + (i % 3) * 4, wy - 14 + ((i / 3) | 0) * 5, 3, 3, '#f4e2c8');
      // landing marker X buoy
      rect(296, wy + 2, 9, 2, '#ffc843'); rect(299, wy - 1, 3, 8, '#ffc843');
      drawTextC('X', 300, wy - 12, '#ffc84388', 1);
      if (s) {
        // the cruising gator head (side view, maw open)
        const gy = wy - 2 + Math.round(Math.sin(tNow * 1.8) * 2);
        const open = 6 + Math.round(Math.sin(tNow * 6) * 2) - Math.round(s.chomp * 6);
        ctx.save();
        if (s.gdir < 0) { ctx.translate(s.gx * 2, 0); ctx.scale(-1, 1); }
        const hx2 = s.gx - 34;
        rr(hx2, gy - 10, 56, 12, 4, '#3c7c2e');          // upper snout
        rr(hx2 + 44, gy - 16, 14, 10, 3, '#3c7c2e');      // brow
        rect(hx2 + 48, gy - 14, 4, 4, '#ffe089'); rect(hx2 + 49, gy - 13, 2, 2, '#1b1408'); // eye
        for (let k = 0; k < 5; k++) rect(hx2 + 6 + k * 9, gy + 1, 3, 3, '#f4f0dc'); // top teeth
        rr(hx2 + 2, gy + open, 50, 8, 3, '#2f6626');      // lower jaw
        rect(hx2 + 4, gy + open - 2, 46, 3, '#a83a4e');   // mouth interior hint
        ctx.restore();
        // lobbed drumstick arc from bucket to X
        if (s.chick) {
          const f = s.chick.t / 0.75;
          const cx2 = lerp(100, 300, f), cy2 = (wy - 14) - Math.sin(f * Math.PI) * 54;
          rect(cx2, cy2, 5, 4, '#c88a4a'); rect(cx2 + 4, cy2 - 2, 3, 3, '#f4e2c8');
        }
        if (s.chomp > 0.4) drawTextCSh('CHOMP!', 300, wy - 34, C.gold, 2);
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
      s.heat -= (0.16 + Math.sin(s.wob * 1.7) * 0.05) * dt;
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
      const cx2 = 240;
      drawRangerSitting(150, gy - 12);
      drawCampfire(cx2, gy + 24, s ? s.heat : 0.5);
      // tripod + pot
      rect(cx2 - 22, gy - 18, 2, 40, '#2a1a10'); rect(cx2 + 20, gy - 18, 2, 40, '#2a1a10'); rect(cx2 - 22, gy - 19, 44, 2, '#2a1a10');
      rect(cx2 - 1, gy - 17, 2, 8, '#3a444c');
      rr(cx2 - 16, gy - 10, 32, 18, 4, '#22262c'); rect(cx2 - 18, gy - 11, 36, 4, '#2c323a');
      rect(cx2 - 12, gy - 8, 24, 3, '#5a8a3a'); // gumbo surface
      if (s && s.heat >= 0.45 && s.heat <= 0.75) { // happy bubbles in the zone
        for (let k = 0; k < 3; k++) { const bb = ((tNow * 4 + k * 2) % 3) | 0; rect(cx2 - 8 + k * 8, gy - 10 - bb, 2, 2, '#8ac85a'); }
      }
      if (s && s.heat > 0.85) { ctx.save(); ctx.globalAlpha = 0.5; rect(cx2 - 10, gy - 22, 3, 8, '#333'); rect(cx2 + 6, gy - 26, 3, 10, '#333'); ctx.restore(); } // scorch smoke
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
      drawRangerSitting(170, gy - 12);
      drawCampfire(262, gy + 22, 0.75);
      if (s) {
        // stick from the ranger to over the coals
        for (let i = 0; i < 22; i++) rect(192 + i * 3.2, gy - 6 - i * 0.8, 3, 2, '#8a6a3a');
        // the marshmallow: white -> gold -> brown -> black
        const t = s.toast;
        const col = t < 0.25 ? '#f8f6ee' : t < 0.45 ? '#f0dfb8' : t < 0.6 ? '#e8c878' : t <= 0.8 ? '#d8a038' : t <= 0.92 ? '#7a4a20' : '#241a10';
        const mmx = 262, mmy = gy - 26 + Math.round(Math.sin(tNow * 2) * 1);
        rr(mmx - 6, mmy, 13, 11, 3, col);
        rect(mmx - 4, mmy + 2, 4, 2, '#ffffff55');
        if (t > 0.5) { rect(mmx - 5, mmy + 8, 11, 2, t > 0.8 ? '#160e08' : '#a87028'); } // toasty bottom
        if (s.fire) { const fl = (tNow * 12 | 0) % 3; rect(mmx - 2, mmy - 8 - fl, 5, 8 + fl, '#ff9838'); rect(mmx, mmy - 4 - fl, 2, 4, '#ffe089'); }
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
      s.cool = 0.22; s.flash = 0.08;
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
      for (let i = 0; i < 26; i++) { ctx.save(); ctx.globalAlpha = 0.4; rect(x + (i * 71 + 9) % w, y + 30 + (i * 37) % 24, 1, 1, '#8a78b0'); ctx.restore(); }
      const lanes = [64, 96, 128];
      // ducks behind the front-most rail rows
      if (s) s.ducks.forEach(d => {
        const dy = y + lanes[d.lane];
        ctx.save();
        if (d.dead) { ctx.translate(d.x, dy + d.dead * 26); ctx.rotate(d.dir * d.dead * 2.4); ctx.translate(-d.x, -dy); ctx.globalAlpha = Math.max(0, 1 - d.dead * 1.3); }
        const c = d.gold ? '#ffd54a' : '#e8b45a', cd = d.gold ? '#c9941a' : '#a87838';
        ctx.save(); if (d.dir < 0) { ctx.translate(d.x * 2, 0); ctx.scale(-1, 1); }
        rr(d.x - 11, dy - 5, 20, 11, 4, c);            // body
        rect(d.x - 11, dy + 2, 20, 4, cd);
        fillCircle(d.x + 8, dy - 8, 5, c);              // head
        rect(d.x + 11, dy - 9, 6, 3, '#e8842a');        // bill
        rect(d.x + 7, dy - 10, 2, 2, '#1b1408');        // eye
        rect(d.x - 6, dy - 3, 8, 4, cd);                // wing
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
        if (s.flash > 0) { fillCircle(mx, my, 4, '#ffe089'); }
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
      s.frogs.forEach(f => {
        f.t += dt;
        if (f.st === 'sit' && f.t >= f.sitT) { f.st = 'hop'; f.t = 0; f.hx = f.x + (rnd() < 0.5 ? -1 : 1) * (40 + rnd() * 70); f.hx = clamp(f.hx, STAGE.x + 20, STAGE.x + STAGE.w - 20); }
        if (f.st === 'hop' && f.t >= 0.5) { f.st = 'sit'; f.t = 0; f.sitT = 0.7 + rnd() * 0.9; f.x = f.hx; }
      });
      if (s.timer <= 0) this.done(s);
    },
    tap(s) {
      const wy = STAGE.y + Math.round(STAGE.h * 0.62);
      let got = null;
      s.frogs.forEach(f => { if (f.st === 'sit' && Math.abs(mx - f.x) < 15 && Math.abs(my - (wy + 2)) < 20) got = f; });
      if (got) {
        s.frogs.splice(s.frogs.indexOf(got), 1);
        s.caught++; s.msg = 'GOTCHA!'; s.msgT = 0.9;
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
      // a row of lilypads marks the hunting ground
      for (let x = STAGE.x + 20; x < STAGE.x + STAGE.w - 10; x += 34) {
        rr(x, wy + 8, 24, 5, 2, '#3a6a44'); rect(x + 3, wy + 8, 16, 1, '#5aa85a'); rect(x + 19, wy + 9, 4, 2, '#0a2830');
      }
      if (s) s.frogs.forEach(f => {
        let fx2 = f.x, fy2 = wy + 2;
        if (f.st === 'hop') { const h = f.t / 0.5; fx2 = lerp(f.x, f.hx, h); fy2 = wy + 2 - Math.sin(h * Math.PI) * 26; }
        const sz = f.size;
        rr(fx2 - 8 * sz, fy2 - 6 * sz, 16 * sz, 10 * sz, 4, '#7ec850');
        rr(fx2 - 6 * sz, fy2 + 1, 12 * sz, 4, 2, '#e8e0b0');
        fillCircle(fx2 - 4 * sz, fy2 - 7 * sz, 3, '#7ec850'); fillCircle(fx2 + 4 * sz, fy2 - 7 * sz, 3, '#7ec850');
        rect(fx2 - 5 * sz, fy2 - 8 * sz, 2, 2, '#1b1408'); rect(fx2 + 3 * sz, fy2 - 8 * sz, 2, 2, '#1b1408');
        if (f.st === 'hop') { rect(fx2 - 9 * sz, fy2 + 4, 4, 2, '#5a9a3c'); rect(fx2 + 6 * sz, fy2 + 4, 4, 2, '#5a9a3c'); }
        if (f.st === 'sit' && ((tNow * 2 + f.x) | 0) % 3 === 0) rect(fx2 - 2, fy2 - 2, 4, 2, '#f0d8a0'); // throat puff
      });
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
        sfx.coin(); float(best.x, best.y - 12, 'CLICK!', C.white, 1);
      } else { s.msg = 'JUST REEDS...'; s.msgT = 0.8; }
    },
    done(s) {
      const ck = s.snapped >= 6 ? 4 : s.snapped >= 4 ? 2 : 0;
      finishGame(s.snapped + '/6 PHOTOS', s.pay, ck, ['SOLD TO THE GAZETTE: +$' + s.pay]);
    },
    draw(s) {
      stageNight('#0a2432');
      if (s) {
        s.birds.forEach(b => {
          const fl = Math.floor(tNow * 8 + b.ph) % 2;
          const c = b.heron ? '#ffd54a' : '#c8d4dc';
          ctx.save(); if (b.dir < 0) { ctx.translate(b.x * 2, 0); ctx.scale(-1, 1); }
          rr(b.x - 7, b.y - 2, 14, 5, 2, c);
          rect(b.x + 6, b.y - 4, 5, 3, c); rect(b.x + 10, b.y - 3, 3, 2, '#e8842a');
          rect(b.x - 3, b.y - (fl ? 6 : 2), 7, 4, b.heron ? '#e8b45a' : '#a8b4bc'); // wing
          if (b.heron) { rect(b.x - 10, b.y, 4, 1, '#e8b45a'); rect(b.x + 2, b.y + 3, 1, 5, c); }
          ctx.restore();
        });
        // the camera viewfinder follows your finger
        ctx.save(); ctx.globalAlpha = 0.9;
        const vx = mx - 24, vy = my - 17, vw = 48, vh = 34;
        [[0, 0], [vw - 8, 0], [0, vh - 8], [vw - 8, vh - 8]].forEach(([ox, oy]) => {
          rect(vx + ox, vy + oy, 8, 2, '#f4f2e4'); rect(vx + ox + (ox ? 6 : 0), vy + oy, 2, 8, '#f4f2e4');
        });
        rect(mx - 2, my, 5, 1, '#f4f2e455'); rect(mx, my - 2, 1, 5, '#f4f2e455');
        ctx.restore();
        if (s.flash > 0) { ctx.save(); ctx.globalAlpha = s.flash * 6; rect(STAGE.x, STAGE.y, STAGE.w, STAGE.h, '#fff'); ctx.restore(); }
        // film counter
        for (let i = 0; i < 6; i++) rr(STAGE.x + 8 + i * 11, STAGE.y + 8, 8, 12, 2, i < s.shots ? '#ffe089' : '#2a343c');
        if (s.msgT > 0) drawTextCSh(s.msg, W / 2, STAGE.y + 26, s.msg.includes('$') ? C.gold : '#8fa6a8', 1);
      }
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
          else if (s.stun <= 0) { s.stun = 0.7; shake = 4; sfx.splash(); addRipple(120, s.py + 8, true); }
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
          if (o.coin && !o.hit) {
            fillCircle(o.x, o.y, 6, '#a4741a'); fillCircle(o.x, o.y, 5, '#ffc843');
            rect(o.x - 1, o.y - 3, 2, 6, '#a4741a');
            if (((tNow * 6 + o.x) | 0) % 4 === 0) rect(o.x - 2, o.y - 5, 2, 2, '#fff6c8');
          } else if (!o.coin) {
            rr(o.x - 17, o.y - 6, 34, 12, 5, '#4a3320');
            rr(o.x - 15, o.y - 4, 30, 5, 3, '#5f4228');
            fillCircle(o.x + 13, o.y, 4, '#3a2818'); fillCircle(o.x + 13, o.y, 2, '#5f4228');
            rect(o.x - 10, o.y - 2, 8, 1, '#3a2818');
          }
        });
        // the airboat itself (flicker while stunned)
        if (!(s.stun > 0 && ((tNow * 12) | 0) % 2)) {
          ctx.save(); ctx.translate(120, s.py); ctx.scale(0.62, 0.62); drawAirboat(0, 0, true, undefined); ctx.restore();
        }
      }
    },
    hud: s => 'TIME: ' + Math.max(0, s.timer).toFixed(1) + 's   COINS: $' + s.coins + (s.stun > 0 ? '   *CRUNCH*' : ''),
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
    def.how.forEach((ln, i) => drawTextCSh(ln, W / 2, 200 + i * 11, i ? C.dim : C.white, 1));
    button(W / 2 - 55, 228, 110, 24, 'START >', '#d94f30', '#8a2a16', () => {
      ev.phase = 'play'; ev.s = {}; game.init(ev.s); sfx.whoosh();
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
  toasts = toasts.filter(t => t.t < 3.4);
  toasts.slice(0, 4).forEach((t, i) => {
    const slide = t.t < 0.3 ? easeOut(t.t / 0.3) : t.t > 3.0 ? 1 - easeIn((t.t - 3.0) / 0.4) : 1;
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
  const g = GLOVES[gloveUnlocked(meta.glove) ? meta.glove : 'bare'];
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
    // pattern
    if (g.pat === 'scale') { rect(x - 2, y + fl + 2, 2, 2, shade); rect(x + 2, y + fl + 4, 2, 2, shade); rect(x - 1, y + fl + 7, 2, 2, shade); }
    if (g.pat === 'dot') { rect(x - 2, y + fl + 3, 1, 1, shade); rect(x + 2, y + fl + 5, 1, 1, shade); rect(x, y + fl + 8, 1, 1, shade); }
    if (g.pat === 'bones') { rect(x - 3, y + fl + 4, 8, 1, '#fff'); rect(x - 1, y + fl + 2, 1, 5, '#fff'); }
    if (g.pat === 'gem') { rect(x + 1, y + fl + 4, 2, 2, C.gold); }
    if (g.pat === 'shine') { rect(x - 3, y + fl + 1, 2, 4, '#fff6c8'); }
    // cuff
    rr(x - 5, y + fl + 9, 16, 5, 1, dark);
    rr(x - 4, y + fl + 9, 14, 4, 1, g.cuff);
    rect(x - 4, y + fl + 9, 14, 1, '#ffffff44');
  }
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
    ctx.globalAlpha = clamp(1 - p.t / p.life, 0, 1);
    rect(p.x, p.y, p.sz, p.sz, p.col);
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

  hits = [];
  updateFx(dt);
  updateScene(dt);
  updateBenchFx(dt);
  if (G.state === 'snap') updateSnap(dt); else shardsDone = false;
  if (G.state === 'swap') {
    G.swapT += dt;
    if (G.swapT > 0.45) { newMouth(); G.state = 'play'; }
  }
  musicTick();

  ctx.save();
  if (shake > 0 && meta.set.shake) ctx.translate(ri(-shake, shake) / 2, ri(-shake, shake) / 2);

  if (G.state === 'map') updateBoat(dt);
  switch (G.state) {
    case 'menu': drawMenu(); break;
    case 'how': drawHow(); break;
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
    case 'bossintro': drawBossIntro(); break;
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
  rect(0, 0, W, 2, '#00000088'); rect(0, H - 2, W, 2, '#00000088');
  rect(0, 0, 2, H, '#00000088'); rect(W - 2, 0, 2, H, '#00000088');

  // pause + overlays swallow all other input
  if (G.paused || G.overlay) {
    hits.length = 0;
    if (G.overlay === 'settings') drawSettingsOverlay();
    else if (G.overlay === 'credits') drawCreditsOverlay();
    else drawPauseOverlay();
  }

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
  if (G.state === 'menu' || G.state === 'how' || G.state === 'ranger' || G.state === 'pass') return;
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

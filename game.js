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

function fit() {
  const raw = Math.min(innerWidth / W, innerHeight / H);
  const s = raw >= 1 ? Math.floor(raw) : raw; // integer scale keeps the pixel grid even
  canvas.style.width = Math.floor(W * s) + 'px';
  canvas.style.height = Math.floor(H * s) + 'px';
}
addEventListener('resize', fit); fit();

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
  g.gain.setValueAtTime((vol || 0.12), t0);
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
  const g = ac.createGain(); g.gain.setValueAtTime(vol, t0);
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
};
// tiny swamp groove
let musicNext = 0;
const BASSSEQ = [55, 0, 65.4, 55, 0, 49, 58.3, 0];
let musicStep = 0;
function musicTick() {
  const ac = AC; if (!ac || muted) return;
  while (musicNext < ac.currentTime + 0.25) {
    if (musicNext < ac.currentTime) musicNext = ac.currentTime;
    const f = BASSSEQ[musicStep % 8];
    if (f) {
      const t0 = musicNext;
      const o = ac.createOscillator(), g = ac.createGain(), fl = ac.createBiquadFilter();
      o.type = 'square'; o.frequency.value = f;
      fl.type = 'lowpass'; fl.frequency.value = 260;
      g.gain.setValueAtTime(0.055, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.26);
      o.connect(fl); fl.connect(g); g.connect(ac.destination); o.start(t0); o.stop(t0 + 0.3);
    }
    if (musicStep % 2 === 0) {
      const t0 = musicNext + 0.11;
      const n = Math.floor(ac.sampleRate * 0.03);
      const buf = ac.createBuffer(1, n, ac.sampleRate); const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (rnd() * 2 - 1) * (1 - i / n);
      const s = ac.createBufferSource(); s.buffer = buf;
      const g = ac.createGain(); g.gain.setValueAtTime(0.018, t0);
      const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
      s.connect(hp); hp.connect(g); g.connect(ac.destination); s.start(t0);
    }
    musicStep++; musicNext += 0.24;
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
  apexpred: { a: '#2e3a34', b: '#1c2620', c: '#48584e', d: '#0e1612', maw: '#2e0810', mawD: '#1c040a', tongue: '#8a3040', tongueHi: '#a84858', sclera: '#e8d0c0', redEye: true, scars: true, fangs: true, ridge: true },
};
function crocStyle() {
  if (G.state !== 'menu' && G.round === 2 && G.boss) return CROC_STYLES[G.boss.id] || CROC_STYLES.big;
  if (G.state !== 'menu' && G.nodeType === 'gold') return CROC_STYLES.gold;
  if (G.state !== 'menu' && G.round === 1) return CROC_STYLES.big;
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
};
const SHOP_TEETH = ['gold', 'ruby', 'sapph', 'steel', 'lucky', 'rotten', 'vamp'];

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
  // ---- unique-mechanic charms (rar 3 = LEGENDARY) ----
  { id: 'feast', name: 'FEEDING FRENZY', cost: 7, rar: 1, ico: 'bolt', desc: 'Press 3 teeth within 1.5 seconds: +6 MULT', flav: 'Chew fast, think later.' },
  { id: 'dentures', name: 'SPARE DENTURES', cost: 7, rar: 1, ico: 'tooth', desc: 'Once per round, a snapped bite banks HALF its pool instead of losing it', flav: 'Grandpa left you these.' },
  { id: 'gambit', name: 'GATOR GAMBIT', cost: 9, rar: 2, ico: 'trap', tier: 10, desc: 'Bank with exactly 2 snappers still hidden: X2.5 MULT', flav: 'Dance where the traps are.' },
  { id: 'compound', name: 'COMPOUND JAW', cost: 9, rar: 2, ico: 'drill', desc: '+1 permanent starting MULT every time you bank (while held)', flav: 'It remembers every bite.' },
  { id: 'jackpot', name: 'JACKPOT JAW', cost: 13, rar: 3, ico: 'star', tier: 12, desc: 'Bank with EXACTLY 7 presses: X5 MULT', flav: 'Seven teeth. Says so on the machine.' },
  { id: 'ouroboros', name: 'TAIL EATER', cost: 14, rar: 3, ico: 'snake', tier: 14, desc: 'After a CLEAN SWEEP, your next mouth KEEPS the whole MULT chain', flav: 'The bite that never ends.' },
  { id: 'hoard', name: 'DRAGON HOARD', cost: 12, rar: 3, ico: 'coin', tier: 15, desc: 'Interest cap removed, and interest pays $1 per $4 held', flav: 'Sleep on gold, bite like it too.' },
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
];
const FINAL_BOSS = { id: 'apexpred', name: 'APEX PREDATOR', desc: '2 snap teeth, and only 1 X-Ray' };

// ------------------------------------------------------------ map nodes ---
const NODE_DEFS = {
  small: { name: 'EASY GATOR', mult: 1, reward: 4, col: '#63d66a' },
  big: { name: 'RISKY GATOR', mult: 1.5, reward: 6, col: '#ff9838' },
  gold: { name: 'GOLDEN GATOR', mult: 1.9, reward: 11, col: '#ffc843' },
  event: { name: 'SWAMP EVENT', col: '#c07dff' },
  boss: { name: 'BOSS GATOR', mult: 2, reward: 8, col: '#ff5348' },
};

const ANTE_BASE = [60, 150, 340, 750, 1600, 3000, 5200, 6000];
const ROUND_MULT = [1, 1.5, 2];
const ROUND_REWARD = [4, 5, 8];
const ROUND_NAMES = ['SMALL GATOR', 'BIG GATOR', 'BOSS'];

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
};
const GLOVE_ORDER = ['bare', 'rubber', 'leather', 'croc', 'gold', 'bone', 'pearl', 'royal'];
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
    name: 'BAYOU SCOUT', animal: 'THE HERON', col: '#63d66a',
    lines: ['+1 tooth in every mouth', 'One tooth in every mouth', 'starts already X-rayed'],
    flav: 'Knows every log that blinks.',
  },
  medic: {
    name: 'SWAMP MEDIC', animal: 'THE OPOSSUM', col: '#7fd4e8',
    lines: ['+1 BITE every round', 'Start every run holding', 'a free NOVOCAINE card'],
    flav: 'Prescribes more biting.',
  },
  trader: {
    name: 'BOG TRADER', animal: 'THE RACCOON', col: '#ffc843',
    lines: ['Start the run with $12', 'Interest cap raised', 'from $5 to $8'],
    flav: 'Sells swamp to swimmers.',
  },
  frog: {
    name: 'BULLFROG BRAWLER', animal: 'THE BULLFROG', col: '#7ec850',
    lines: ['CLEAN SWEEP bonus is', 'X1.75 MULT', 'instead of X1.25'],
    flav: 'Croaks first, counts later.',
  },
  snail: {
    name: 'SNAIL SAGE', animal: 'THE SNAIL', col: '#c8a878',
    lines: ['Every bite starts', 'at +3 MULT', 'but -1 BITE every round'],
    flav: 'Slow is smooth. Smooth is rich.',
  },
};
const RANGER_ORDER = ['scout', 'medic', 'trader', 'frog', 'snail'];

// -------------------------------------------------- swamp events (5) ------
// resolve() applies the outcome and returns the outcome text
const EVENTS = [
  {
    id: 'chest', name: 'THE SUNKEN CHEST', scene: 'chest',
    text: 'Something glints under the duckweed. An old strongbox, half buried in the silt. The water is dark... and something moved down there.',
    choices: [
      {
        label: 'DIVE FOR IT', sub: '50/50: treasure or trouble',
        resolve() {
          if (rnd() < 0.5) { gainMoney(10); return 'You wrench it free! Inside: $10 in dry-ish bills. The swamp giveth.'; }
          G.eventBuffs.bites -= 1;
          return 'Something CLAMPS your boot. You escape, but you are rattled: -1 BITE next round.';
        },
      },
      { label: 'LEAVE IT', sub: '+4 RP for discipline', resolve() { addRP(4); return 'A true ranger knows which glints are teeth. +4 RANGER POINTS.'; } },
    ],
  },
  {
    id: 'hermit', name: 'THE HERMIT DENTIST', scene: 'hermit',
    text: 'A campfire crackles on a stump island. An old hermit grins with suspiciously perfect teeth. \'Polish yer chompers, ranger? Cheap-ish.\'',
    choices: [
      {
        label: 'PAY $4', sub: 'Polish 3 plain teeth +2', money: 4,
        resolve() {
          G.money -= 4;
          const plains = G.deck.filter(t => t.type === 'plain');
          shuffle(plains).slice(0, 3).forEach(t => t.base += 2);
          return 'He hums a shanty and buffs 3 of your plain teeth to +2. Money well spent.';
        },
      },
      {
        label: 'ROB HIM', sub: 'Free polish... 50% bad karma',
        resolve() {
          const plains = G.deck.filter(t => t.type === 'plain');
          shuffle(plains).slice(0, 3).forEach(t => t.base += 2);
          if (rnd() < 0.5) { G.eventBuffs.snapNext += 1; return 'You grab his kit and run. 3 teeth polished... but the swamp saw you. +1 SNAPPER next mouth.'; }
          return 'You grab his kit and run. 3 teeth polished +2. He just laughs. Unsettling.';
        },
      },
      { label: 'WALK AWAY', sub: 'No thanks', resolve() { return 'You nod politely and pole away. His teeth glow in the dark behind you.'; } },
    ],
  },
  {
    id: 'swarm', name: 'THE FIREFLY SWARM', scene: 'swarm',
    text: 'A river of fireflies pours through the reeds, bright as a carnival. Your jar is right there.',
    choices: [
      { label: 'CATCH A JARFUL', sub: '+2 X-RAYS next round', resolve() { G.eventBuffs.xrays += 2; return 'The jar glows like a lantern. +2 X-RAYS next round.'; } },
      { label: 'SELL THE LIGHT', sub: '+$5', resolve() { gainMoney(5); return 'A passing bootlegger pays $5 for the jar. The swamp economy is weird.'; } },
      { label: 'JUST WATCH', sub: '+3 MULT next round', resolve() { G.eventBuffs.mult += 3; return 'You watch until the last light fades. You feel sharper. +3 starting MULT next round.'; } },
    ],
  },
  {
    id: 'sleeper', name: 'THE SLEEPING GATOR', scene: 'sleeper',
    text: 'A colossal gator snores on the bank. One golden tooth glitters in its half-open jaw. Its belly rises... and falls... and rises...',
    choices: [
      {
        label: 'STEAL THE TOOTH', sub: '60%: gold tooth. 40%: uh oh',
        resolve() {
          if (rnd() < 0.6) { G.deck.push(mkTooth('gold')); return 'Your fingers close on gold. A GOLD TOOTH joins your deck. It never even woke up.'; }
          G.eventBuffs.snapNext += 1;
          return 'The eye SNAPS open. You flee through the reeds. Word spreads: +1 SNAPPER next mouth.';
        },
      },
      { label: 'TIPTOE PAST', sub: '+$3', resolve() { gainMoney(3); return 'You slip past and find $3 someone dropped while fleeing earlier. Pragmatism pays.'; } },
    ],
  },
  {
    id: 'witch', name: 'THE SWAMP WITCH', scene: 'witch',
    text: 'A cauldron bubbles violet under a crooked cypress. The witch stirs it with a femur. \'Teeth for treasures, ranger. Fair trades only.\'',
    choices: [
      {
        label: 'TRADE 2 TEETH', sub: 'Weakest 2 plain > 1 RUBY',
        resolve() {
          const plains = G.deck.filter(t => t.type === 'plain').sort((a, b) => a.base - b.base);
          if (plains.length < 2 || G.deck.length <= 8) return 'The witch peers in your bag and cackles. \'Too few teeth to trade, dearie.\'';
          for (let k = 0; k < 2; k++) { const i = G.deck.indexOf(plains[k]); if (i >= 0) G.deck.splice(i, 1); }
          G.drawPile = G.drawPile.filter(t => G.deck.includes(t));
          G.deck.push(mkTooth('ruby'));
          return 'She plucks your two weakest teeth and presses a RUBY TOOTH into your palm. It is warm. Do not ask why.';
        },
      },
      {
        label: 'PAY $5', sub: 'A random card', money: 5,
        resolve() {
          G.money -= 5;
          const pool = CONS.filter(cardUnlocked);
          const def = choice(pool);
          if (G.cons.length >= 3) { gainMoney(5); return 'Your card slots are full. She shrugs and refunds you. Surprisingly professional.'; }
          G.cons.push(def);
          return 'She ladles out... a ' + def.name + '. \'No refunds,\' she says, refunding nothing.';
        },
      },
      { label: 'REFUSE', sub: '+2 RP', resolve() { addRP(2); return 'Never trade teeth with a witch. +2 RANGER POINTS for wisdom.'; } },
    ],
  },
];

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
];

// ------------------------------------------------------------ packs -------
const PACKS = {
  tooth: { name: 'TOOTH PACK', cost: 5, desc: 'Pick 1 of 3 special teeth for your deck', flav: 'Rattles promisingly.' },
  tool: { name: 'TOOL PACK', cost: 6, desc: 'Pick 1 of 2 dentist tools', flav: 'Sterilized-ish.' },
};
const PACK_TEETH = ['gold', 'ruby', 'sapph', 'steel', 'lucky', 'rotten', 'vamp'];

// -------------------------------------- swamp pass: RP, tiers, dailies ----
const PASS_REQ = [25, 50, 80, 110, 145, 180, 220, 260, 305, 355, 410, 470, 535, 605, 680];
function passTierUnlocked(tier) { return (meta.rp || 0) >= PASS_REQ[tier - 1]; }
function cardUnlocked(def) { return !def.tier || passTierUnlocked(def.tier); }
function passCardForTier(tier) {
  return CHARMS.find(c => c.tier === tier) || CONS.find(c => c.tier === tier) || TOOLS.find(c => c.tier === tier);
}

// three quest-giver NPCs; pledge to one for double reward on their quest
const NPCS = {
  granny: { name: 'GRANNY SNAPPER', who: 'the old turtle', col: '#8fae68', line: 'Back in my day we pressed teeth uphill both ways.', pool: ['press30', 'bank8', 'sweep1', 'special5'] },
  crow: { name: 'FERRYMAN CROW', who: 'the river crow', col: '#9fb2c8', line: 'The trail provides, ranger. For a fee.', pool: ['ante3q', 'boss1q', 'money25', 'event1', 'gold1'] },
  doc: { name: 'DOC MUDBUG', who: 'the crawfish dentist', col: '#e08898', line: 'Open wide! Not you, ranger. The gator.', pool: ['xray8', 'defuse2', 'buy4', 'tool1', 'pack1'] },
};
const NPC_ORDER = ['granny', 'crow', 'doc'];

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

let meta = { ach: {}, lifeSnaps: 0, glove: 'bare', rp: 0, ranger: 'scout', daily: null };
try { const m = JSON.parse(localStorage.getItem('bd_meta') || 'null'); if (m) meta = Object.assign(meta, m); } catch (e) { }
function saveMeta() { try { localStorage.setItem('bd_meta', JSON.stringify(meta)); } catch (e) { } }
let toasts = []; // {name, sub, glove, t}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}
function ensureDaily() {
  const today = todayStr();
  if (meta.daily && meta.daily.date === today && Array.isArray(meta.daily.q) && meta.daily.q[0] && meta.daily.q[0].npc) return;
  // date-seeded: each NPC offers one quest from their themed pool
  const d = new Date();
  let seed = (d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()) >>> 0;
  const lcg = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const picked = NPC_ORDER.map(nk => {
    const pool = NPCS[nk].pool;
    return { npc: nk, id: pool[Math.floor(lcg() * pool.length)], prog: 0, done: false };
  });
  meta.daily = { date: today, pledge: null, q: picked };
  saveMeta();
}
function pledgeTo(nk) {
  ensureDaily();
  if (meta.daily.pledge) return; // one pledge per day
  meta.daily.pledge = nk;
  toasts.push({ name: 'PLEDGED TO ' + NPCS[nk].name, sub: 'THEIR QUEST PAYS DOUBLE RP TODAY', t: 0 });
  saveMeta();
  sfx.buy();
}
function addRP(n, label) {
  const before = meta.rp || 0;
  meta.rp = before + n;
  // announce any pass tier crossed
  PASS_REQ.forEach((req, i) => {
    if (before < req && meta.rp >= req) {
      const card = passCardForTier(i + 1);
      if (card) toasts.push({ name: 'PASS TIER ' + (i + 1) + ' REACHED!', sub: 'NEW CARD: ' + card.name, t: 0 });
      sfx.ach();
    }
  });
  if (label) toasts.push({ name: label, sub: '+' + n + ' RANGER POINTS', t: 0 });
  saveMeta();
}
function quest(id, n) {
  ensureDaily();
  const q = meta.daily.q.find(q => q.id === id);
  if (!q || q.done) return;
  const def = QUESTS.find(d => d.id === id);
  q.prog = Math.min(def.goal, q.prog + n);
  if (q.prog >= def.goal) {
    q.done = true;
    sfx.ach();
    const pay = meta.daily.pledge === q.npc ? 30 : 15;
    addRP(pay, NPCS[q.npc].name + ' THANKS YOU');
  }
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
const gloveUnlocked = k => !GLOVES[k].ach || !!meta.ach[GLOVES[k].ach];
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
  pack: null,      // {kind, options, t} pack opening
  shopPacks: [],
  compoundMult: 0, sweepCarry: 0, denturesUsed: false, feastTimes: [],
};
let trans = null;  // iris wipe: {t, cb, fired}
function startTransition(cb) { if (trans) return; trans = { t: 0, cb, fired: false }; }
let flyers = [];   // bought cards flying to their slot
let best = 0;
try { best = parseInt(localStorage.getItem('bitedown_best') || '0') || 0; } catch (e) { }
function saveBest() { try { localStorage.setItem('bitedown_best', '' + best); } catch (e) { } }

const has = id => G.charms.some(c => c.id === id);
const bossIs = id => !!(G.boss && G.round === 2 && G.boss.id === id);
const xraysBlocked = () => bossIs('murky');
const snapCountFor = () => {
  return 1 + ((bossIs('twofang') || bossIs('apexpred') || bossIs('king')) ? 1 : 0);
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
  meta.ranger = G.ranger; saveMeta();
  G.ante = 1; G.round = 0;
  G.money = G.ranger === 'trader' ? 12 : 4;
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
  G.map = { stages: [s0, s1, [mk('boss')]], stage: 0, picked: [] };
  G.boat = null;
}

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
  G.nodeName = NODE_DEFS[node.type].name;
  G.round = node.type === 'boss' ? 2 : node.type === 'small' ? 0 : 1;
  G.boss = node.type === 'boss' ? (G.ante === 8 ? FINAL_BOSS : G.bossOrder[(G.ante - 1) % G.bossOrder.length]) : null;
  G.target = Math.round((G.ante <= 8 ? ANTE_BASE[G.ante - 1] : ANTE_BASE[7] * Math.pow(1.6, G.ante - 8)) * NODE_DEFS[node.type].mult);
  G.score = 0; G.dispScore = 0;
  G.bites = Math.max(1, 3 + (has('chewtoy') ? 1 : 0) + (has('moonshine') ? 1 : 0)
    + (G.ranger === 'medic' ? 1 : 0) - (has('glass') ? 1 : 0) - (G.ranger === 'snail' ? 1 : 0)
    + G.eventBuffs.bites);
  G.xrays = 3 + (has('license') ? 1 : 0) + (has('moonshine') ? 1 : 0) + G.eventBuffs.xrays;
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
  let pool = EVENTS.filter(e => !recent.includes(e.id));
  if (!pool.length) { G.seenEvents = []; pool = EVENTS.slice(); }
  const def = choice(pool);
  recent.push(def.id);
  G.event = { def, phase: 'intro', textT: 0, outcome: '' };
  G.state = 'event';
}

function chooseEvent(k) {
  const ev = G.event; if (!ev || ev.phase !== 'intro') return;
  const ch = ev.def.choices[k]; if (!ch) return;
  if (ch.money && G.money < ch.money) { sfx.error(); float(mx, my - 10, 'NOT ENOUGH $', C.red, 1); return; }
  ev.outcome = ch.resolve();
  ev.phase = 'outcome'; ev.textT = 0;
  addRP(3, 'FIELD EXPERIENCE');
  quest('event1', 1);
  sfx.buy();
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
    + (G.ranger === 'scout' ? 1 : 0);
  return Math.max(6, Math.min(size, G.deck.length));
}

function newMouth() {
  const size = mouthSizeFor();
  let snaps = Math.min(snapCountFor() + (G.eventBuffs.snapNext > 0 ? 1 : 0), Math.max(1, size - 4));
  if (G.eventBuffs.snapNext > 0) { G.eventBuffs.snapNext = 0; float(W / 2 + 50, 100, 'THE SWAMP REMEMBERS: +1 SNAPPER', C.red, 1, 1.6); }
  if (G.drawPile.length < size) G.drawPile = shuffle(G.deck.slice());
  const drawn = G.drawPile.splice(0, size);
  const order = shuffle(drawn.map((_, i) => i));
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
  if (G.ranger === 'scout') {
    // the scout spots one tooth for free
    const s = choice(G.mouth);
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
    if (!diet) {
      switch (s.t.type) {
        case 'gold': { const m = has('crown') ? 4 : 2; gainMoney(m); if (has('crown')) add += 5; float(p.x, p.y - 22, '+$' + m, C.gold, 1); sfx.coin(); break; }
        case 'ruby': mgain += 4; break;
        case 'steel': steel = true; break;
        case 'lucky': if (ri(0, 2) === 0) { mgain += 5; float(p.x, p.y - 22, 'LUCKY! +5 MULT', C.green, 1); } break;
        case 'rotten': mgain += 6; break;
        case 'vamp': { const v = 2 * (G.pool.clicks - 1); add += v; if (v > 0) float(p.x, p.y - 22, 'DRAIN +' + v, C.purple, 1); break; }
      }
    }
    if (bossIs('mudcake')) add = Math.max(1, Math.ceil(add / 2));
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
  if (has('glass')) m *= 2;
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
  if (has('compound')) { G.compoundMult++; float(60, 174, 'COMPOUND +1', C.purple, 1); }
  if (sweep && has('ouroboros')) { G.sweepCarry = G.pool.mult; float(W / 2 + 50, 128, 'THE CHAIN SURVIVES!', C.purple, 1, 1.6); }
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
  const base = (NODE_DEFS[G.nodeType].reward || 4) + Math.floor(G.ante / 3);
  const perBite = G.bites; // unused bites, $1 each
  const cap = G.ranger === 'trader' ? 8 : 5;
  const interest = has('hoard') ? Math.floor(G.money / 4) : Math.min(cap, Math.floor(G.money / 5));
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
  G.rerollCost = 4;
  rollShop();
  stockPacks();
  G.state = 'shop';
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
  G.shopPacks = [
    { kind: 'tooth', def: PACKS.tooth, price: PACKS.tooth.cost, sold: false },
    { kind: 'tool', def: PACKS.tool, price: PACKS.tool.cost, sold: false },
  ];
}
function buyPack(p) {
  if (p.sold) return;
  if (G.money < p.price) { sfx.error(); float(mx, my - 10, 'NOT ENOUGH $', C.red, 1); return; }
  if (p.kind === 'tool' && G.cons.length >= 3) { sfx.error(); float(mx, my - 10, 'CARD SLOTS FULL', C.red, 1); return; }
  G.money -= p.price;
  p.sold = true;
  quest('buy4', 1);
  openPack(p.kind);
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
  G.rerollCost++;
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
function benchApply() {
  const b = G.bench; if (!b || !b.sel.length) { sfx.error(); return; }
  const teeth = b.sel.map(id => G.deck.find(t => t.id === id)).filter(Boolean);
  const removing = b.def.id === 'forceps' || b.def.id === 'extractor';
  if (removing && G.deck.length - teeth.length < 9) {
    sfx.error(); float(mx, my - 10, 'DECK TOO SMALL (MIN 9)', C.red, 1); return;
  }
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
  }
  G.drawPile = G.drawPile.filter(t => G.deck.includes(t));
  G.cons.splice(b.consIdx, 1);
  quest('tool1', 1);
  toasts.push({ name: b.def.name, sub: 'WORK COMPLETE', t: 0 });
  const ret = b.ret;
  G.bench = null;
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
function openPack(kind) {
  let options;
  if (kind === 'tooth') {
    let pool = shuffle(PACK_TEETH.slice());
    options = pool.slice(0, 3).map(t => ({ tooth: t }));
    if (rnd() < 0.12) options[ri(0, 2)] = { tooth: 'diamond' }; // rare shimmer
  } else {
    const pool = shuffle(TOOLS.filter(cardUnlocked));
    options = pool.slice(0, 2).map(t => ({ tool: t }));
  }
  G.pack = { kind, options, t: 0 };
  quest('pack1', 1);
  sfx.sweep();
}
function pickPack(i) {
  const p = G.pack; if (!p || p.t < 0.35) return;
  const o = p.options[i]; if (!o) return;
  if (o.tooth) {
    G.deck.push(mkTooth(o.tooth));
    toasts.push({ name: TOOTH_DEFS[o.tooth].name, sub: 'ADDED TO YOUR DECK', t: 0 });
  } else {
    if (G.cons.length >= 3) { sfx.error(); float(mx, my - 10, 'CARD SLOTS FULL', C.red, 1); return; }
    G.cons.push(o.tool);
    toasts.push({ name: o.tool.name, sub: 'ADDED TO YOUR CARDS', t: 0 });
  }
  G.pack = null;
  sfx.buy();
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
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i];
    if (px >= h.x && px < h.x + h.w && py >= h.y && py < h.y + h.h) return h;
  }
  return null;
}
function pointFromEvent(e) {
  const r = canvas.getBoundingClientRect();
  const cx = (e.touches ? e.touches[0].clientX : e.clientX);
  const cy = (e.touches ? e.touches[0].clientY : e.clientY);
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
const RAR_COL = ['#5d7a86', '#3e8cd0', '#d0563e', '#e8a020'];
const RAR_NAME = ['COMMON', 'UNCOMMON', 'RARE', 'LEGENDARY'];
function drawCardFace(x, y, def, kind, o) {
  o = o || {};
  x |= 0; y |= 0; // integer position keeps the pixel art crisp
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
  chip(x, y, half, 16, G.pool ? G.pool.teeth : 0, '#1565b5', '#0c3f75', 1);
  drawTextC('*', x + half + 6, y + 5, C.red, 2);
  chip(x + half + 12, y, half, 16, G.pool ? G.pool.mult : 0, '#c22a20', '#801812', 1);
  drawText('TEETH', x + 2, y + 18, '#7fb8e8', 1);
  drawText('MULT', x + half + 14, y + 18, '#ff9a90', 1);
  y += 27;

  panel(x, y, w, 14, { face: '#252017', edge: '#6b5a2a' });
  drawText('BITE', x + 4, y + 4, C.dim, 1);
  drawText(fmt(G.pool ? bankValue() : 0), x + 30, y + 4, C.gold, 1);
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
  drawTextC(muted ? 'M: UNMUTE' : 'M: MUTE', x + w / 2, SIDEBAR.y + SIDEBAR.h - 9, '#54707a', 1);
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
      sub: '+' + fmt(G.pool ? bankValue() : 0), subCol: '#5a3c08',
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
  drawTextC('SELL', BARREL.x + BARREL.w / 2, BARREL.y + BARREL.h + 4, C.gold, 1);
  hit(BARREL.x, BARREL.y, BARREL.w, BARREL.h, { id: 'barrel', tip: 'SELL BARREL|Drag a charm here to sell it|for half its price' });
}

function drawShop() {
  const th = themeNow();
  drawSceneBack(th);
  drawSceneFront(th);
  drawSidebar();
  drawTopBar(true);

  drawTextCSh('GATOR SHOP', 296, 56, C.gold, 3, '#00000088');
  drawTextCSh('CLICK FOR DETAILS. DRAG CHARMS TO THE BARREL TO SELL', 296, 78, C.dim, 1);

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
    const label = it.kind === 'charm' ? 'CHARM' : it.kind === 'tool' ? 'TOOL' : 'CARD';
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
    const col = p.kind === 'tooth' ? '#c9941a' : '#3a9a8a';
    rr(x + 1, yy + 3, 64, 40, 3, '#00000077');
    rr(x, yy, 64, 40, 3, col);
    rr(x + 2, yy + 2, 60, 36, 3, p.kind === 'tooth' ? '#8a6510' : '#1c3230');
    rect(x + 29, yy, 6, 40, col); // ribbon
    rect(x + 29, yy + 2, 6, 2, '#ffffff44');
    if (p.kind === 'tooth') ICONS.tooth(x + 8, yy + 12); else ICONS.tdrill(x + 8, yy + 14);
    drawTextC(p.kind === 'tooth' ? 'TOOTH' : 'TOOL', x + 46, yy + 10, C.white, 1);
    drawTextC('PACK', x + 46, yy + 19, C.white, 1);
    const afford = G.money >= p.price;
    drawTextC('$' + p.price, x + 32, yy + 44, afford ? C.gold : C.red, 1);
    hit(x, y - 2, 64, 48, {
      cb: () => buyPack(p), id: 'pack' + p.kind, cursor: true,
      tip: p.def.name + '|' + p.def.desc + '|$' + p.price,
    });
  });

  drawBarrel();
  button(348, 186, 86, 20, 'REROLL $' + G.rerollCost, '#7a4fd0', '#4a2a8a', reroll,
    { id: 'reroll', disabled: G.money < G.rerollCost, tip: 'REROLL|Refresh the 4 shop items|(packs stay)' });
  const nextName = G.map && G.map.stage >= 3 ? 'NEXT ANTE' : 'BACK TO TRAIL';
  button(300, 222, 130, 26, nextName + ' >', '#d94f30', '#8a2a16', () => startTransition(afterShop), { id: 'next', sc: 1, tip: 'Back to the swamp trail' });
}

// ------------------------------------------------------ pack opening ------
function drawPackOpen(dt) {
  const p = G.pack; if (!p) return;
  p.t += dt;
  overlayDim(0.78);
  hit(0, 0, W, H, { cb: () => { }, id: 'packblock' });
  drawTextCSh(p.kind === 'tooth' ? 'TOOTH PACK' : 'TOOL PACK', W / 2, 30, C.gold, 3);
  drawTextCSh('PICK ONE', W / 2, 56, C.white, 1);
  const n = p.options.length;
  p.options.forEach((o, i) => {
    const x = W / 2 - (n * 70 - 14) / 2 + i * 70;
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
  drawTextC('CHOOSE WISELY, RANGER', W / 2, 224, '#54707a', 1);
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
    drawTooth(tx, ty, tw, th2, !top, t.type, { outline: sel ? C.gold : hov ? '#ffe8a0' : '#00000055' });
    drawTextC(t.base, tx + tw / 2, top ? ty + th2 - 8 : ty + 2, sel ? C.goldD : '#6d5c3a', 1);
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

  button(W / 2 - 96, 232, 92, 24, 'APPLY', '#e8a020', '#98650e', benchApply,
    { id: 'bapply', disabled: !b.sel.length, tip: b.sel.length ? 'Do the dental work!' : 'Select teeth first' });
  button(W / 2 + 8, 232, 92, 24, 'CANCEL', '#3a5560', '#243a44', benchCancel, { id: 'bcancel', tip: 'Keep the tool for later' });
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

function drawBossIntro() {
  const th = THEMES.boss;
  drawSceneBack(th);
  drawCroc(Math.abs(Math.sin(tNow * 2.2)) * 0.25, { angry: true });
  drawSceneFront(th);
  drawSidebar();
  overlayDim(0.6);
  // name slams in from huge to normal
  const el = tNow - G.biStart;
  const slam = easeOut(clamp(el / 0.35, 0, 1));
  if (el > 0.35 && el < 0.42 && shake < 2) { shake = 6; }
  const pulse = 1 + Math.sin(tNow * 4) * 0.06;
  drawTextCSh('BOSS GATOR', W / 2, 62, C.red, 2);
  const nameSc = Math.max(3, Math.round(lerp(9, 3 * pulse, slam)));
  ctx.globalAlpha = 0.4 + slam * 0.6;
  drawTextCSh(G.boss.name, W / 2, 84 - (nameSc - 3) * 2, C.white, nameSc);
  ctx.globalAlpha = 1;
  const dw = Math.max(textW(G.boss.desc, 1), textW('TARGET: ' + fmt(G.target), 1)) + 20;
  panel(W / 2 - dw / 2, 116, dw, 34, { face: '#2a0e12ee', edge: C.redD });
  drawTextCSh(G.boss.desc, W / 2, 122, '#ffb0a8', 1);
  drawTextCSh('TARGET: ' + fmt(G.target), W / 2, 136, C.orange, 1);
  button(W / 2 - 55, 168, 110, 26, 'BITE DOWN!', '#d94f30', '#8a2a16', () => { G.state = 'play'; }, { id: 'bossgo' });
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
  if (G.runRP > 0) drawTextCSh('+' + G.runRP + ' RANGER POINTS EARNED', W / 2, 186, C.green, 1);
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
  drawTextCSh('+30 RANGER POINTS', W / 2, 168, C.green, 1);
  button(W / 2 - 75, 178, 150, 26, 'ENDLESS MODE >', '#7a4fd0', '#4a2a8a', () => { enterShop(); }, { id: 'endless', tip: 'Keep going!|Targets keep growing forever' });
  button(W / 2 - 55, 212, 110, 22, 'NEW RUN', '#d94f30', '#8a2a16', () => { G.state = 'ranger'; }, { id: 'newrun2' });
}

// ------------------------------------------------------------ menu --------
function drawMenu() {
  const th = THEMES.night;
  drawSceneBack(th);
  const chomp = Math.max(0, Math.sin(tNow * 1.4)) * 0.9;
  drawCroc(chomp);
  drawSceneFront(th);

  const ty = 20 + Math.sin(tNow * 1.8) * 2;
  drawTextCSh('BITE', W / 2 - 62, ty, C.gold, 5, '#00000088');
  drawTextCSh('DOWN', W / 2 + 66, ty, '#63d66a', 5, '#00000088');
  drawTextCSh('A PUSH-YOUR-LUCK DENTAL ROGUELIKE', W / 2, ty + 32, C.white, 1);

  button(W / 2 - 65, 214, 130, 30, 'NEW RUN', '#d94f30', '#8a2a16', () => { G.state = 'ranger'; }, { id: 'start', sc: 2 });
  button(W / 2 - 98, 248, 62, 14, 'HOW TO', '#3a5560', '#243a44', () => { G.howFrom = 'menu'; G.state = 'how'; }, { id: 'how' });
  button(W / 2 - 32, 248, 64, 14, 'PASS', '#7a4fd0', '#4a2a8a', () => { ensureDaily(); G.state = 'pass'; }, { id: 'passbtn', tip: 'SWAMP PASS|Daily quests + card unlocks|' + (meta.rp || 0) + ' RANGER POINTS' });
  button(W / 2 + 36, 248, 62, 14, muted ? 'UNMUTE' : 'MUTE', '#3a5560', '#243a44', () => { muted = !muted; }, { id: 'mute' });
  if (best > 0) drawTextCSh('BEST ANTE: ' + best, W / 2, 200, C.gold, 1);
  // daily quest ticker
  ensureDaily();
  const qdone = meta.daily.q.filter(q => q.done).length;
  drawTextCSh('DAILY QUESTS: ' + qdone + '/3  -  ' + (meta.rp || 0) + ' RP', W / 2, 190, qdone === 3 ? C.green : C.dim, 1);

  // glove rack (bottom left)
  panel(6, 196, 104, 66, { face: '#16222acc' });
  drawTextC('GLOVES', 58, 201, C.dim, 1);
  GLOVE_ORDER.forEach((k, i) => {
    const gx = 12 + (i % 4) * 25, gy = 212 + Math.floor(i / 4) * 24;
    const g = GLOVES[k];
    const open = gloveUnlocked(k);
    const sel = meta.glove === k;
    rr(gx, gy, 21, 20, 2, sel ? C.gold : '#0d161b');
    rr(gx + 1, gy + 1, 19, 18, 2, open ? '#243642' : '#141c22');
    if (open) ICONS.glove(gx + 4, gy + 4, g.skin);
    else { drawTextC('?', gx + 10, gy + 7, '#41565e', 1); }
    const a = ACHS.find(a => a.id === g.ach);
    hit(gx, gy, 21, 20, {
      id: 'glove' + k, cursor: open,
      tip: open ? (g.name + '|' + g.flav + (sel ? '|EQUIPPED' : '|CLICK TO EQUIP'))
        : ('LOCKED: ' + g.name + '|' + (a ? 'ACHIEVEMENT: ' + a.name + '|' + a.desc : '')),
      cb: () => { if (open) { meta.glove = k; saveMeta(); sfx.buy(); } else sfx.error(); },
    });
  });
  const done = ACHS.filter(a => meta.ach[a.id]).length;
  drawTextC(done + '/' + ACHS.length + ' UNLOCKED', 58, 254, '#54707a', 1);
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
  overlayDim(0.45);
  drawTextCSh('CHOOSE YOUR RANGER', W / 2, 12, C.gold, 3);
  if (!rangerFocus) rangerFocus = meta.ranger || 'scout';
  // left: tile column of the 5 animals
  RANGER_ORDER.forEach((key, i) => {
    const r = RANGERS[key];
    const x = 42, y = 40 + i * 42;
    const sel = rangerFocus === key;
    panel(x, y, 44, 38, { face: sel ? '#26321e' : '#1a2530ee', edge: sel ? C.gold : r.col });
    drawRangerFace(x + 8, y + 5, key);
    hit(x, y, 44, 38, {
      id: 'rtile' + key, cursor: true, tip: r.name + '|' + r.animal,
      cb: () => { rangerFocus = key; sfx.hover(); },
    });
  });
  // right: detail pane for the focused ranger
  const r = RANGERS[rangerFocus];
  const px = 110, py = 40, pw = 330, ph = 200;
  panel(px, py, pw, ph, { face: '#1a2530ee', edge: r.col });
  rr(px + 18, py + 14, 64, 64, 4, '#10181e');
  ctx.save(); ctx.translate(px + 22, py + 18); ctx.scale(2, 2); drawRangerFace(0, 0, rangerFocus); ctx.restore();
  drawText(r.name, px + 96, py + 16, r.col, 2);
  drawText(r.animal, px + 96, py + 32, C.dim, 1);
  rect(px + 96, py + 42, pw - 120, 1, '#ffffff18');
  r.lines.forEach((l, k) => drawText(l, px + 96, py + 50 + k * 11, C.white, 1));
  drawText("'" + r.flav + "'", px + 96, py + 90, '#6f8a90', 1);
  if (meta.ranger === rangerFocus) drawText('LAST USED', px + 18, py + 84, C.gold, 1);
  button(px + pw / 2 - 65, py + ph - 44, 130, 28, 'HEAD OUT >', '#d94f30', '#8a2a16',
    () => { const k = rangerFocus; startTransition(() => newRun(k)); }, { id: 'rangergo', sc: 1 });
  button(W / 2 - 40, 248, 80, 16, '< BACK', '#3a5560', '#243a44', () => { G.state = 'menu'; }, { id: 'rangerback' });
}

// ------------------------------------------------------------ swamp map ---
function nodePos(stage, k, count) {
  const xs = [190, 292, 394];
  const ys = count === 1 ? [150] : count === 2 ? [104, 190] : [84, 148, 206];
  return { x: xs[stage], y: ys[k] };
}
function drawMiniGator(x, y, type) {
  const cols = { small: ['#5aa843', '#3c7c2e'], big: ['#4e8f3d', '#2f6626'], gold: ['#d8b842', '#a8882a'], boss: ['#8a3030', '#5e1c1c'] };
  const [a, b] = cols[type] || cols.small;
  rr(x, y + 4, 22, 9, 3, a);
  rr(x + 1, y + 10, 20, 4, 2, b);
  [[x + 3], [x + 13]].forEach(([ex]) => {
    rr(ex, y, 7, 7, 2, a);
    rect(ex + 2, y + 2, 3, 3, '#f8f4dc');
    rect(ex + 3, y + 3, 1, 2, '#1b1408');
  });
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
      if (visited) drawTextC('*', p.x + 24, p.y - 10, C.gold, 1);
      if (reachable && !G.boat) {
        hit(p.x - 22, p.y - 14, 44, 32, {
          id: 'node' + s + '_' + k, cursor: true,
          tip: nodeTip(node),
          cb: () => {
            const from2 = s === 0 ? { x: 97, y: 148 } : nodePos(s - 1, G.map.picked[s - 1], G.map.stages[s - 1].length);
            G.boat = { x: from2.x, y: from2.y, tx: p.x, ty: p.y + 20, t: 0, k };
            sfx.splash(); addRipple(p.x, p.y + 22, false);
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
  rr(bpos.x - 12, bpos.y + bob, 24, 7, 3, '#5a3a1e');
  rr(bpos.x - 9, bpos.y - 2 + bob, 18, 4, 2, '#7a5230');
  ctx.save(); ctx.translate(bpos.x - 7, bpos.y - 16 + bob); ctx.scale(0.5, 0.5); ctx.restore();
  drawRangerFace(bpos.x - 14, bpos.y - 26 + bob, G.ranger);
  drawTextC('PICK YOUR NEXT STOP', W / 2, 234, C.dim, 1);
}
function nodeTip(node) {
  const d = NODE_DEFS[node.type];
  if (node.type === 'event') return 'SWAMP EVENT|Something is waiting in the reeds...|No fight. No shop. A choice.';
  const base = G.ante <= 8 ? ANTE_BASE[G.ante - 1] : ANTE_BASE[7] * Math.pow(1.6, G.ante - 8);
  let t = d.name + '|TARGET: ' + fmt(Math.round(base * d.mult)) + '|REWARD: $' + (d.reward + Math.floor(G.ante / 3));
  if (node.type === 'gold') t += '|Tough bite, fat payout';
  if (node.type === 'boss') t += '|A rule-bending boss awaits';
  return t;
}
function updateBoat(dt) {
  if (!G.boat) return;
  G.boat.t += dt;
  const k2 = easeOut(clamp(G.boat.t / 0.7, 0, 1));
  G.boat.x = lerp(G.boat.x, G.boat.tx, k2 * 0.2);
  G.boat.y = lerp(G.boat.y, G.boat.ty, k2 * 0.2);
  if (G.boat.t > 0.75) { const k = G.boat.k; G.boat = null; pickNode(k); }
}

// ------------------------------------------------------- swamp pass -------
function drawPassScreen() {
  const th = THEMES.shop;
  drawSceneBack(th);
  drawSceneFront(th);
  overlayDim(0.55);
  ensureDaily();
  drawTextCSh('SWAMP PASS', W / 2, 6, C.gold, 2);
  drawTextCSh(fmt(meta.rp || 0) + ' RANGER POINTS', W / 2, 24, C.green, 1);

  // 15-tier track in two rows
  const tw = 56, rows = [[0, 8], [8, 15]];
  rows.forEach(([a, b2], r) => {
    const count = b2 - a;
    const tx0 = Math.floor(W / 2 - (count * tw - 12) / 2);
    const ty = 36 + r * 52;
    rect(tx0 + 8, ty + 20, (count - 1) * tw + 28, 2, '#3a4a55');
    for (let i = a; i < b2; i++) {
      const x = tx0 + (i - a) * tw, req = PASS_REQ[i], open = passTierUnlocked(i + 1);
      const card = passCardForTier(i + 1);
      panel(x, ty, 46, 44, { face: open ? '#26321e' : '#141c22', edge: open ? C.gold : '#2c3a44' });
      if (card) {
        if (open) (ICONS[card.ico] || ICONS.star)(x + 17, ty + 4);
        else drawTextC('?', x + 23, ty + 7, '#41565e', 2);
        drawTextC(card.name.split(' ')[0].slice(0, 8), x + 23, ty + 22, open ? C.white : '#41565e', 1);
      }
      drawTextC('' + req, x + 23, ty + 32, open ? C.green : C.dim, 1);
      hit(x, ty, 46, 44, {
        id: 'tier' + i, cursor: true,
        tip: card ? ((open ? '' : 'LOCKED: ') + card.name + '|' + card.desc + '|' + (open ? 'IN YOUR POOL!' : 'UNLOCKS AT ' + req + ' RP')) : '',
      });
    }
  });

  // NPC quest board: three quest-givers, pledge one for double RP
  drawTextC('THE QUEST BOARD  -  PLEDGE TO ONE RANGER FRIEND FOR DOUBLE RP', W / 2, 142, C.purple, 1);
  NPC_ORDER.forEach((nk, i) => {
    const npc = NPCS[nk];
    const q = meta.daily.q.find(qq => qq.npc === nk);
    const def = q && QUESTS.find(d => d.id === q.id);
    const x = 34 + i * 142, y = 152, w2 = 130, h2 = 76;
    const pledged = meta.daily.pledge === nk;
    panel(x, y, w2, h2, { face: '#1a2530ee', edge: pledged ? C.gold : npc.col });
    rr(x + 4, y + 4, 34, 34, 3, '#10181e');
    drawNpcFace(x + 7, y + 7, nk);
    drawText(npc.name, x + 42, y + 6, npc.col, 1);
    if (def) {
      drawSmallWrapped(def.name, x + 42, y + 16, w2 - 48, q.done ? C.green : C.white);
      rect(x + 42, y + 36, 70, 4, '#0a1215');
      const p = clamp(q.prog / def.goal, 0, 1);
      if (p > 0) rect(x + 42, y + 36, Math.floor(70 * p), 4, q.done ? C.green : C.gold);
      drawText(q.done ? 'DONE' : q.prog + '/' + def.goal, x + 42, y + 43, q.done ? C.green : C.dim, 1);
    }
    const pay = pledged ? 30 : 15;
    drawText('+' + pay + ' RP', x + 96, y + 43, pledged ? C.gold : C.dim, 1);
    if (pledged) {
      drawTextC('YOUR PARTNER TODAY', x + w2 / 2, y + h2 - 12, C.gold, 1);
    } else if (!meta.daily.pledge) {
      button(x + w2 / 2 - 34, y + h2 - 20, 68, 15, 'PLEDGE', '#7a4fd0', '#4a2a8a', () => pledgeTo(nk), { id: 'pledge' + nk });
    } else {
      drawTextC("'" + npc.line.slice(0, 24) + "...'", x + w2 / 2, y + h2 - 12, '#54707a', 1);
    }
    hit(x, y, w2, 26, { id: 'npc' + nk, tip: npc.name + '|' + npc.who + "|'" + npc.line + "'" });
  });

  drawTextC('RP: ACHIEVEMENTS +25, QUESTS +15 (+30 PLEDGED), EVENTS +3, ANTES +2', W / 2, 234, '#54707a', 1);
  button(W / 2 - 40, 246, 80, 16, '< BACK', '#3a5560', '#243a44', () => { G.state = 'menu'; }, { id: 'passback' });
}

// ------------------------------------------------------- swamp events -----
// animated vignette scenes, drawn into a w x h box
const EVENT_SCENES = {
  chest(x, y, w, h) {
    // murky water gradient + sunken chest with glint
    ['#0a2028', '#0c2830', '#0e3038'].forEach((c, i) => rect(x, y + i * (h / 3), w, h / 3 + 1, c));
    for (let k = 0; k < 8; k++) {
      const bx = x + ((k * 53) % w), by = y + h - ((tNow * 12 + k * 17) % h);
      ctx.globalAlpha = 0.4; rect(bx, by, 2, 2, '#7fb8c8'); ctx.globalAlpha = 1;
    }
    const cx2 = x + w / 2 - 20, cy2 = y + h - 26;
    rr(cx2, cy2, 40, 18, 3, '#5a3a1e');
    rr(cx2 + 2, cy2 + 2, 36, 6, 2, '#7a5230');
    rect(cx2 + 17, cy2 + 6, 6, 6, C.gold);
    if ((tNow % 1.6) < 0.25) { rect(cx2 + 18, cy2 + 4, 2, 2, '#fff6c8'); rect(cx2 + 26, cy2 + 2, 1, 1, '#fff6c8'); }
    rect(x + 8, y + h - 8, 10, 2, '#1a4a30'); rect(x + w - 22, y + h - 6, 14, 2, '#1a4a30');
  },
  hermit(x, y, w, h) {
    rect(x, y, w, h, '#0d1420');
    for (let i = 0; i < 12; i++) { const sx = (i * 41) % w; rect(x + sx, y + 4 + (i * 13) % 20, 1, 1, '#cfe8f055'); }
    rr(x + w / 2 - 30, y + h - 14, 60, 10, 3, '#2c2418'); // stump island
    // hermit silhouette
    rr(x + w / 2 + 8, y + h - 40, 16, 26, 4, '#1a2228');
    fillCircle(x + w / 2 + 16, y + h - 44, 6, '#1a2228');
    rect(x + w / 2 + 12, y + h - 44, 8, 2, '#0e1418'); // hat brim
    if ((tNow % 0.8) < 0.4) rect(x + w / 2 + 13, y + h - 41, 6, 2, '#f4f0dc'); // grin flash
    // campfire flicker
    const fy = y + h - 22, fl = (tNow * 9 | 0) % 3;
    rect(x + w / 2 - 16, fy + 6, 12, 4, '#4a3320');
    rect(x + w / 2 - 13, fy - fl, 6, 6 + fl, '#ff9838');
    rect(x + w / 2 - 11, fy + 2 - fl, 2, 3, '#ffe089');
    ctx.globalAlpha = 0.2 + fl * 0.08; fillCircle(x + w / 2 - 10, fy, 16, '#ff983833'); ctx.globalAlpha = 1;
  },
  swarm(x, y, w, h) {
    rect(x, y, w, h, '#0a1418');
    for (let k = 0; k < 5; k++) rect(x + 10 + k * ((w - 20) / 5), y + h - 14, 2, 14, '#132d1e');
    for (let i = 0; i < 26; i++) {
      const fx = x + w / 2 + Math.sin(tNow * 1.1 + i * 1.7) * (w / 2 - 12) * Math.sin(i);
      const fy = y + h / 2 + Math.cos(tNow * 0.9 + i * 2.3) * (h / 2 - 10);
      const br = (Math.sin(tNow * 3 + i * 2) + 1) / 2;
      ctx.globalAlpha = 0.3 + br * 0.7;
      rect(fx, fy, br > 0.6 ? 2 : 1, br > 0.6 ? 2 : 1, '#eaffa0');
      ctx.globalAlpha = 1;
    }
  },
  sleeper(x, y, w, h) {
    rect(x, y, w, h, '#101c14');
    rect(x, y + h - 10, w, 10, '#1a2c1c');
    // side-view sleeping gator, belly rising
    const br = Math.sin(tNow * 1.4) * 2;
    rr(x + 20, y + h - 34 - br, w - 60, 22 + br, 6, '#3c7c2e');
    rr(x + w - 62, y + h - 28, 44, 16, 5, '#3c7c2e'); // snout
    rect(x + w - 26, y + h - 24, 6, 3, '#295722');
    rect(x + w - 48, y + h - 30, 8, 3, '#295722'); // closed eye
    rect(x + w - 40, y + h - 20, 5, 4, C.gold); // the golden tooth
    // zzz
    const zt = (tNow % 2);
    ctx.globalAlpha = clamp(1 - zt / 2, 0, 1);
    drawText('Z', x + w - 44, y + h - 46 - zt * 10, C.white, 1);
    drawText('Z', x + w - 34, y + h - 54 - zt * 14, C.dim, 1);
    ctx.globalAlpha = 1;
  },
  witch(x, y, w, h) {
    rect(x, y, w, h, '#140e1e');
    // crooked cypress
    rect(x + 14, y + 6, 6, h - 6, '#0c0814'); rect(x + 20, y + 10, 12, 4, '#0c0814');
    // cauldron
    const cx2 = x + w / 2, cy2 = y + h - 18;
    rr(cx2 - 18, cy2 - 8, 36, 16, 5, '#22262c');
    rect(cx2 - 20, cy2 - 10, 40, 4, '#2c323a');
    // bubbling brew
    for (let k = 0; k < 5; k++) {
      const bx = cx2 - 12 + k * 6, bb = ((tNow * 4 + k * 2) % 3) | 0;
      rect(bx, cy2 - 12 - bb, 2, 2, '#a860e8');
    }
    rect(cx2 - 16, cy2 - 9, 32, 3, '#8a4fd0');
    // steam
    ctx.globalAlpha = 0.3;
    rect(cx2 - 4 + Math.sin(tNow * 2) * 4, cy2 - 26, 3, 10, '#c8a8f8');
    rect(cx2 + 6 + Math.sin(tNow * 2.4) * 4, cy2 - 34, 2, 12, '#c8a8f8');
    ctx.globalAlpha = 1;
    // the witch
    rr(cx2 + 26, cy2 - 26, 14, 20, 3, '#1e1428');
    rect(cx2 + 24, cy2 - 28, 18, 3, '#1e1428');
    rect(cx2 + 28, cy2 - 40, 10, 13, '#2a1c38'); // hat
    rect(cx2 + 31, cy2 - 44, 4, 6, '#2a1c38');
    rect(cx2 + 29, cy2 - 22, 2, 2, '#a860e8'); // glowing eye
  },
};

function drawEvent(dt) {
  const th = themeNow();
  drawSceneBack(th);
  drawSceneFront(th);
  overlayDim(0.55);
  const ev = G.event; if (!ev) return;
  ev.textT += dt * 44; // typewriter speed (chars)

  // letterbox bars slide in
  const lb = clamp(ev.barT = (ev.barT || 0) + dt * 3, 0, 1);
  rect(0, 0, W, 26 * lb, '#04080a');
  rect(0, H - 26 * lb, W, 26 * lb, '#04080a');

  drawTextCSh(ev.def.name, W / 2, 8, C.gold, 2);

  // animated vignette
  const vx = W / 2 - 105, vy = 30, vw = 210, vh = 92;
  panel(vx - 3, vy - 3, vw + 6, vh + 6, { face: '#0a1215', edge: '#5d7a86' });
  ctx.save();
  ctx.beginPath(); ctx.rect(vx, vy, vw, vh); ctx.clip();
  (EVENT_SCENES[ev.def.scene] || EVENT_SCENES.chest)(vx, vy, vw, vh);
  // shared dressing: corner reeds, drifting fireflies, soft inner vignette
  for (let k = 0; k < 3; k++) {
    const rx2 = k < 2 ? vx + 4 + k * 6 : vx + vw - 8;
    const sway = Math.sin(tNow * 1.3 + k * 2) * 1.5;
    for (let seg = 0; seg < 14; seg += 2) rect(rx2 + sway * seg / 14, vy + vh - seg - 2, 1, 2, '#132d1e');
  }
  for (let k = 0; k < 4; k++) {
    const br = (Math.sin(tNow * 2.4 + k * 2.7) + 1) / 2;
    if (br > 0.5) {
      ctx.globalAlpha = (br - 0.5) * 1.4;
      rect(vx + 20 + ((k * 67 + tNow * 6) % (vw - 40)), vy + 12 + (k * 23) % (vh - 30), 1, 1, '#eaffa0');
      ctx.globalAlpha = 1;
    }
  }
  ctx.globalAlpha = 0.35;
  rect(vx, vy, vw, 3, '#000'); rect(vx, vy + vh - 3, vw, 3, '#000');
  rect(vx, vy, 3, vh, '#000'); rect(vx + vw - 3, vy, 3, vh, '#000');
  ctx.globalAlpha = 1;
  ctx.restore();

  // typewriter text
  const txt = ev.phase === 'intro' ? ev.def.text : ev.outcome;
  const shown = txt.slice(0, Math.floor(ev.textT));
  const done = shown.length >= txt.length;
  drawWrappedC(shown, W / 2, 134, 340, C.white);
  hit(0, 0, W, H, { cb: () => { if (!done) ev.textT = txt.length; }, id: 'evskip' });

  if (ev.phase === 'intro' && done) {
    ev.def.choices.forEach((ch, k) => {
      const bw = 128, bx = W / 2 - (ev.def.choices.length * (bw + 8) - 8) / 2 + k * (bw + 8);
      const broke = ch.money && G.money < ch.money;
      button(bx, 196, bw, 26, ch.label, '#d94f30', '#8a2a16', () => chooseEvent(k),
        { id: 'evc' + k, disabled: broke, sub: ch.sub, subCol: '#e8c8b0', tip: broke ? 'Not enough money' : null });
    });
  } else if (ev.phase === 'outcome' && done) {
    button(W / 2 - 60, 202, 120, 24, 'CONTINUE >', '#e8a020', '#98650e', closeEvent, { id: 'evgo' });
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
  if (kind === 'charm') sub = 'CHARM  -  ' + RAR_NAME[def.rar || 0];
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
  tLast = t; tNow = t;

  hits = [];
  updateFx(dt);
  updateScene(dt);
  if (G.state === 'snap') updateSnap(dt); else shardsDone = false;
  if (G.state === 'swap') {
    G.swapT += dt;
    if (G.swapT > 0.45) { newMouth(); G.state = 'play'; }
  }
  musicTick();

  ctx.save();
  if (shake > 0) ctx.translate(ri(-shake, shake) / 2, ri(-shake, shake) / 2);

  if (G.state === 'map') updateBoat(dt);
  switch (G.state) {
    case 'menu': drawMenu(); break;
    case 'how': drawHow(); break;
    case 'ranger': drawRangerSelect(); break;
    case 'pass': drawPassScreen(); break;
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

  // CRT-ish scanlines + vignette
  ctx.globalAlpha = 0.06;
  for (let y = 0; y < H; y += 3) rect(0, y, W, 1, '#000');
  ctx.globalAlpha = 1;
  rect(0, 0, W, 2, '#00000088'); rect(0, H - 2, W, 2, '#00000088');
  rect(0, 0, 2, H, '#00000088'); rect(W - 2, 0, 2, H, '#00000088');

  drawToasts(dt);
  drawTooltip();
  drawDraggedCard();
  drawHand();
  drawTransition(dt);
}
requestAnimationFrame(frame);

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
  choose: chooseEvent,
  continueEvent: closeEvent,
  openBench, benchToggle, benchApply, benchCancel,
  buyPack: i => buyPack(G.shopPacks[i]),
  pickPack,
};

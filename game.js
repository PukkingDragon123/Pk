'use strict';
/* ==========================================================================
   BITE DOWN — a push-your-luck dental roguelike (Balatro-style structure)
   - Rounds: Small Croc / Big Croc / Boss Croc across 8 antes
   - Bites (hands), X-Rays (discards), Charms (jokers), tooth deck, shop
   - All art procedural pixel-art on a 480x270 buffer, WebAudio synth sfx
   ========================================================================== */

// ------------------------------------------------------------ canvas ------
const W = 480, H = 270;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

function fit() {
  const s = Math.min(innerWidth / W, innerHeight / H);
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
  '-':'00E00', '$':'7C63E', '*':'0A4A0', '/':'12480', '(':'24442', ')':'42224',
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
  crocA: '#5aa843', crocB: '#3c7c2e', crocC: '#8cd34f', crocD: '#295722',
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
function noiseHit(dur, vol, delay) {
  const ac = AC; if (!ac || muted) return;
  const t0 = ac.currentTime + (delay || 0);
  const n = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (rnd() * 2 - 1) * (1 - i / n);
  const s = ac.createBufferSource(); s.buffer = buf;
  const g = ac.createGain(); g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
  s.connect(f); f.connect(g); g.connect(ac.destination); s.start(t0);
}
const sfx = {
  hover() { tone(700, 0.025, 'square', 0.02); },
  click(chain) { tone(260 + Math.min(chain, 16) * 38, 0.07, 'square', 0.1, 60); tone(520 + chain * 38, 0.05, 'triangle', 0.06, 80, 0.02); },
  bank() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, 'triangle', 0.11, 0, i * 0.06)); },
  coin() { tone(988, 0.06, 'triangle', 0.1); tone(1319, 0.1, 'triangle', 0.1, 0, 0.06); },
  snap() { noiseHit(0.35, 0.35); tone(140, 0.3, 'sawtooth', 0.22, -100); tone(70, 0.4, 'sine', 0.25, -35, 0.05); },
  xray() { tone(420, 0.14, 'sine', 0.09, 480); },
  error() { tone(110, 0.12, 'square', 0.12, -20); },
  buy() { tone(660, 0.06, 'triangle', 0.1); tone(880, 0.08, 'triangle', 0.1, 0, 0.05); tone(1320, 0.1, 'triangle', 0.08, 0, 0.1); },
  boss() { tone(82, 0.4, 'sawtooth', 0.16, -20); tone(62, 0.5, 'sawtooth', 0.16, -14, 0.35); },
  win() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.16, 'square', 0.08, 0, i * 0.09)); },
  defuse() { tone(880, 0.08, 'sine', 0.1, 220); tone(1200, 0.1, 'sine', 0.08, 200, 0.07); },
  sweep() { [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.13, 'triangle', 0.1, 0, i * 0.05)); },
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

// ------------------------------------------------------- swirl background -
const bgC = document.createElement('canvas'); bgC.width = 120; bgC.height = 68;
const bgX = bgC.getContext('2d');
const bgD = bgX.createImageData(120, 68);
const BGPALS = {
  play: [[9, 24, 19], [13, 38, 27], [19, 56, 37], [27, 76, 47]],
  boss: [[26, 10, 14], [40, 13, 18], [58, 19, 24], [80, 27, 30]],
  shop: [[10, 18, 30], [14, 27, 44], [20, 39, 60], [28, 53, 78]],
  menu: [[9, 24, 19], [13, 38, 27], [20, 58, 38], [30, 82, 50]],
};
function drawBG(t, pal) {
  const d = bgD.data; let i = 0;
  for (let y = 0; y < 68; y++) {
    const cy = y - 34;
    for (let x = 0; x < 120; x++) {
      const cx = x - 60;
      const r = Math.sqrt(cx * cx + cy * cy);
      const a = Math.atan2(cy, cx);
      let v = Math.sin(a * 3 + t * 0.38 - r * 0.13 + Math.sin(r * 0.055 - t * 0.22) * 2.3);
      v += Math.sin(x * 0.16 + t * 0.3) * Math.sin(y * 0.19 - t * 0.24) * 0.65;
      let idx = Math.floor((v + 1.9) / 3.8 * pal.length);
      idx = clamp(idx, 0, pal.length - 1);
      const c = pal[idx];
      d[i++] = c[0]; d[i++] = c[1]; d[i++] = c[2]; d[i++] = 255;
    }
  }
  bgX.putImageData(bgD, 0, 0);
  ctx.drawImage(bgC, 0, 0, W, H);
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
};

// ------------------------------------------------------------ tooth art ---
const TOOTH_STYLE = {
  plain: { a: '#fef9e6', b: '#e3d5ab', c: '#b1a078' },
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
  ctx.translate(x + w / 2, y + h / 2);
  if (!up) ctx.scale(1, -1);
  ctx.translate(-w / 2, -h / 2);
  // now draw as if crown up, root at bottom (local 0,0 top-left)
  const bodyC = o.pressedTint ? st.b : st.a;
  // outline
  rr(-1, 0, w + 2, h, 3, o.outline || '#00000055');
  // crown
  rr(0, 0, w, h - 3, 3, bodyC);
  // roots (two nubs at bottom)
  rect(1, h - 4, Math.floor(w / 2) - 2, 4, bodyC);
  rect(w - Math.floor(w / 2) + 1, h - 4, Math.floor(w / 2) - 2, 4, bodyC);
  // shading right + bottom for 3D
  rect(w - 3, 2, 2, h - 6, st.b);
  rect(w - 2, 3, 1, h - 8, st.c);
  rect(2, h - 6, w - 5, 2, st.b);
  // shine top-left
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
  ctx.restore();
}

// ------------------------------------------------------------ game data ---
const TOOTH_DEFS = {
  plain: { name: 'TOOTH', base: 3, desc: 'A plain tooth.' },
  gold: { name: 'GOLD TOOTH', base: 3, cost: 3, desc: 'Earn $2 when pressed' },
  ruby: { name: 'RUBY TOOTH', base: 2, cost: 3, desc: '+4 MULT when pressed' },
  sapph: { name: 'SAPPHIRE TOOTH', base: 12, cost: 4, desc: 'A hefty +12 TEETH' },
  steel: { name: 'STEEL TOOTH', base: 2, cost: 4, desc: 'X1.5 MULT when pressed' },
  lucky: { name: 'LUCKY TOOTH', base: 2, cost: 3, desc: '1 IN 3 chance: +5 MULT' },
  rotten: { name: 'ROTTEN TOOTH', base: 0, cost: 2, desc: '+6 MULT when pressed' },
  vamp: { name: 'VAMPIRE FANG', base: 4, cost: 4, desc: '+2 TEETH for each tooth pressed before it this bite' },
};
const SHOP_TEETH = ['gold', 'ruby', 'sapph', 'steel', 'lucky', 'rotten', 'vamp'];

const CHARMS = [
  { id: 'sweet', name: 'SWEET TOOTH', cost: 4, rar: 0, ico: 'candy', desc: '+1 extra MULT for every tooth pressed this bite' },
  { id: 'overbite', name: 'OVERBITE', cost: 4, rar: 0, ico: 'tooth', desc: 'First tooth of each bite gives +12 TEETH' },
  { id: 'greedy', name: 'GREEDY GATOR', cost: 5, rar: 0, ico: 'coin', desc: 'Earn $1 for every 4 teeth pressed' },
  { id: 'magnet', name: 'MOLAR MAGNET', cost: 4, rar: 0, ico: 'magnet', desc: '+15 TEETH when you bank' },
  { id: 'babyfangs', name: 'BABY FANGS', cost: 5, rar: 0, ico: 'heart', desc: 'Teeth of value 2 or less give +4 MULT' },
  { id: 'crown', name: 'GOLD CROWN', cost: 5, rar: 0, ico: 'crown', desc: 'Gold Teeth earn double money and +5 TEETH' },
  { id: 'license', name: 'DENTIST LICENSE', cost: 5, rar: 0, ico: 'eye', desc: '+1 X-RAY every round' },
  { id: 'fairy', name: 'TOOTH FAIRY', cost: 5, rar: 0, ico: 'fairy', desc: 'Earn $2 at the end of every round' },
  { id: 'numb', name: 'NUMBING GEL', cost: 6, rar: 1, ico: 'syringe', desc: 'The first SNAP each round is defused' },
  { id: 'glass', name: 'GLASS JAW', cost: 6, rar: 1, ico: 'skull', desc: 'X2 MULT when banking, but +1 snap tooth in every mouth' },
  { id: 'rootcanal', name: 'ROOT CANAL', cost: 7, rar: 1, ico: 'drill', desc: 'Bank with 7+ teeth pressed: X2 MULT' },
  { id: 'chewtoy', name: 'CHEW TOY', cost: 6, rar: 1, ico: 'shield', desc: '+1 BITE every round' },
  { id: 'coldblood', name: 'COLD BLOOD', cost: 6, rar: 1, ico: 'snow', desc: '+3 starting MULT for each snap tooth hidden in the mouth' },
  { id: 'collector', name: 'FANG COLLECTOR', cost: 7, rar: 1, ico: 'star', desc: 'CLEAN SWEEP bonus becomes X2 MULT (instead of X1.25)' },
  { id: 'loose', name: 'LOOSE TOOTH', cost: 7, rar: 1, ico: 'pliers', desc: '1 in 5 chance a pressed snap tooth pops out harmlessly' },
  { id: 'braces', name: 'BRACES', cost: 6, rar: 1, ico: 'gem', desc: '+2 teeth in every mouth' },
  { id: 'wisdom', name: 'WISDOM TOOTH', cost: 8, rar: 2, ico: 'gem', desc: 'Every bite starts at +4 MULT' },
  { id: 'apex', name: 'APEX INSTINCT', cost: 9, rar: 2, ico: 'fang', desc: 'X3 MULT when banking with 10+ teeth pressed' },
];

const CONS = [
  { id: 'panorama', name: 'PANORAMA', cost: 4, ico: 'xrayic', need: 'bite', desc: 'Reveal every snap tooth in the current mouth' },
  { id: 'novocaine', name: 'NOVOCAINE', cost: 4, ico: 'syringe', need: 'bite', desc: 'Defuse the next snap in this mouth' },
  { id: 'extract', name: 'EXTRACTION', cost: 3, ico: 'pliers', need: 'bite', desc: 'Yank any one tooth out of the mouth, risk free' },
  { id: 'fluoride', name: 'FLUORIDE', cost: 3, ico: 'shield', need: 'bite', desc: '+25 TEETH added to your current bite' },
  { id: 'shot', name: 'ADRENALINE', cost: 5, ico: 'heart', need: 'round', desc: '+1 BITE this round' },
  { id: 'goldmolar', name: 'GOLD MOLAR', cost: 4, ico: 'coin', desc: 'Add a GOLD TOOTH to your deck' },
  { id: 'rubymolar', name: 'RUBY MOLAR', cost: 4, ico: 'gem', desc: 'Add a RUBY TOOTH to your deck' },
  { id: 'polish', name: 'POLISH', cost: 4, ico: 'star', desc: 'Upgrade 3 random plain teeth by +2 value, permanently' },
  { id: 'cavity', name: 'CAVITY', cost: 4, ico: 'skull', desc: 'Remove the 2 weakest plain teeth from your deck' },
];

const BOSSES = [
  { id: 'twofang', name: 'TWO-FANG', desc: '2 snap teeth in every mouth' },
  { id: 'murky', name: 'MURKY WATER', desc: 'X-Rays do not work this round' },
  { id: 'cotton', name: 'COTTON MOUTH', desc: 'Tooth values are hidden' },
  { id: 'lockjaw', name: 'LOCKJAW', desc: 'You cannot bank until 4+ teeth are pressed' },
  { id: 'loanshark', name: 'LOAN SHARK', desc: 'Banking costs $1' },
  { id: 'ironjaw', name: 'IRON JAW', desc: 'Chain MULT only grows every 2nd tooth' },
  { id: 'tender', name: 'TENDER GUMS', desc: '3 fewer teeth in every mouth' },
  { id: 'diet', name: 'PLAIN DIET', desc: 'Special teeth lose their powers' },
];
const FINAL_BOSS = { id: 'apexpred', name: 'APEX PREDATOR', desc: '2 snap teeth AND X-Rays do not work' };

const ANTE_BASE = [65, 150, 360, 850, 2000, 4500, 10000, 22000];
const ROUND_MULT = [1, 1.5, 2.2];
const ROUND_REWARD = [4, 5, 8];
const ROUND_NAMES = ['SMALL CROC', 'BIG CROC', 'BOSS'];

function targetFor(ante, round) {
  let base = ante <= 8 ? ANTE_BASE[ante - 1] : ANTE_BASE[7] * Math.pow(2.2, ante - 8);
  return Math.round(base * ROUND_MULT[round]);
}

// ------------------------------------------------------------ state -------
const G = {
  state: 'menu', // menu | play | snap | roundend | shop | gameover | win | bossintro | how
  ante: 1, round: 0, money: 0, target: 0, score: 0, dispScore: 0,
  bites: 0, xrays: 0, deck: [], drawPile: [], mouth: [], pool: null,
  charms: [], cons: [], boss: null, bossOrder: [],
  mode: 'idle', // idle | xray | extract
  extractCons: -1,
  novocaine: false, numbUsed: false, greedyCount: 0,
  shopItems: [], rerollCost: 4,
  snapT: 0, snapIdx: -1, jawClose: 0,
  cash: null, stats: null, wonOnce: false,
  deckOpen: false, howFrom: 'menu',
};
let best = 0;
try { best = parseInt(localStorage.getItem('bitedown_best') || '0') || 0; } catch (e) { }
function saveBest() { try { localStorage.setItem('bitedown_best', '' + best); } catch (e) { } }

const has = id => G.charms.some(c => c.id === id);
const bossIs = id => !!(G.boss && G.round === 2 && G.boss.id === id);
const xraysBlocked = () => bossIs('murky') || bossIs('apexpred');
const snapCountFor = () => {
  let n = 1 + ((bossIs('twofang') || bossIs('apexpred')) ? 1 : 0) + (has('glass') ? 1 : 0);
  return n;
};

function mkTooth(type, base) {
  return { id: uid(), type, base: base !== undefined ? base : TOOTH_DEFS[type].base };
}

// --------------------------------------------------------- fx: floats etc -
let floats = [], parts = [], shake = 0, flashRed = 0;
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
function newRun() {
  G.ante = 1; G.round = 0; G.money = 4;
  G.charms = []; G.cons = []; G.deck = [];
  for (let v = 1; v <= 5; v++) for (let k = 0; k < 4; k++) G.deck.push(mkTooth('plain', v));
  G.bossOrder = shuffle(BOSSES.slice());
  G.stats = { pressed: 0, snaps: 0, banks: 0, bestBank: 0, moneyEarned: 0 };
  G.wonOnce = false; G.deckOpen = false;
  floats = []; parts = []; shake = 0;
  startRound();
}

function startRound() {
  G.boss = (G.round === 2) ? (G.ante === 8 ? FINAL_BOSS : G.bossOrder[(G.ante - 1) % G.bossOrder.length]) : null;
  G.target = targetFor(G.ante, G.round);
  G.score = 0; G.dispScore = 0;
  G.bites = 3 + (has('chewtoy') ? 1 : 0);
  G.xrays = 2 + (has('license') ? 1 : 0);
  G.numbUsed = false; G.greedyCount = 0;
  G.drawPile = shuffle(G.deck.slice());
  G.deckOpen = false;
  newMouth();
  if (G.boss) { G.state = 'bossintro'; sfx.boss(); }
  else { G.state = 'play'; }
}

function mouthSizeFor() {
  let size = 10 + (has('braces') ? 2 : 0) + (bossIs('tender') ? -3 : 0);
  return Math.max(6, Math.min(size, G.deck.length));
}

function newMouth() {
  const size = mouthSizeFor();
  let snaps = Math.min(snapCountFor(), Math.max(1, size - 4));
  if (G.drawPile.length < size) G.drawPile = shuffle(G.deck.slice());
  const drawn = G.drawPile.splice(0, size);
  const order = shuffle(drawn.map((_, i) => i));
  const snapSet = new Set(order.slice(0, snaps));
  G.mouth = drawn.map((t, i) => ({ t, snap: snapSet.has(i), pressed: false, revealed: null, gone: false, pop: 0 }));
  G.pool = { teeth: 0, mult: 1, clicks: 0 };
  if (has('wisdom')) G.pool.mult += 4;
  if (has('coldblood')) G.pool.mult += 3 * snaps;
  G.novocaine = false; G.mode = 'idle'; G.extractCons = -1;
  G.jawClose = 0;
}

function gainMoney(n) { G.money += n; G.stats.moneyEarned += Math.max(0, n); }

function toothScreenPos(i) {
  const L = mouthLayout();
  const s = L.slots[i];
  return s ? { x: s.x + s.w / 2, y: s.y + s.h / 2 } : { x: W / 2, y: H / 2 };
}

function pressTooth(i) {
  if (G.state !== 'play') return;
  const s = G.mouth[i];
  if (!s || s.pressed || s.gone) return;
  if (G.mode === 'xray') { doXray(i); return; }
  if (G.mode === 'extract') { doExtract(i); return; }
  const p = toothScreenPos(i);

  if (s.snap) {
    // possible defusals
    let defused = null;
    if (G.novocaine) { defused = 'NOVOCAINE!'; G.novocaine = false; }
    else if (has('numb') && !G.numbUsed) { defused = 'NUMBED!'; G.numbUsed = true; }
    else if (has('loose') && rnd() < 0.2) { defused = 'POPPED OUT!'; }
    if (defused) {
      s.gone = true; s.revealed = 'snap';
      float(p.x, p.y - 10, defused, C.green, 1);
      burst(p.x, p.y, C.green, 10, 70);
      sfx.defuse();
      checkSweep();
      return;
    }
    startSnap(i);
    return;
  }

  s.pressed = true; s.pop = 0.25;
  G.pool.clicks++;
  G.stats.pressed++;
  const diet = bossIs('diet');
  let add = s.t.base;
  let mgain = 1;
  if (bossIs('ironjaw') && (G.pool.clicks % 2 === 1)) mgain = 0;
  if (has('sweet')) mgain += 1;
  if (has('babyfangs') && s.t.base <= 2) mgain += 4;
  if (has('overbite') && G.pool.clicks === 1) { add += 12; float(p.x, p.y - 22, 'OVERBITE +12', C.blue, 1); }
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
  G.pool.teeth += add;
  G.pool.mult += mgain;
  if (steel) { G.pool.mult = Math.round(G.pool.mult * 1.5); float(p.x, p.y - 22, 'X1.5 MULT', C.red, 1); }
  if (has('greedy')) { G.greedyCount++; if (G.greedyCount % 4 === 0) { gainMoney(1); float(p.x, p.y - 28, 'GREEDY +$1', C.gold, 1); } }
  float(p.x - 8, p.y - 12, '+' + add, C.blue, 1);
  if (mgain > 0) float(p.x + 10, p.y - 6, '+' + mgain, C.red, 1);
  burst(p.x, p.y, '#fef9e6', 5, 40);
  sfx.click(G.pool.clicks);
  checkSweep();
}

function checkSweep() {
  const anySafeLeft = G.mouth.some(s => !s.snap && !s.pressed && !s.gone);
  if (!anySafeLeft) {
    if (G.pool.clicks > 0) {
      float(W / 2 + 50, 96, 'CLEAN SWEEP!', C.gold, 2, 1.6);
      sfx.sweep();
      burst(W / 2 + 50, 130, C.gold, 20, 90);
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
  if (has('glass')) m *= 2;
  if (has('rootcanal') && G.pool.clicks >= 7) m *= 2;
  if (has('apex') && G.pool.clicks >= 10) m *= 3;
  if (sweep) m *= has('collector') ? 2 : 1.25;
  return Math.floor(t * m);
}
const bankValue = () => bankMath(false);

function bank(sweep) {
  if (G.state !== 'play') return;
  if (G.pool.clicks === 0) { sfx.error(); float(248, 232, 'PRESS A TOOTH FIRST!', C.red, 1); return; }
  if (!sweep && bossIs('lockjaw') && G.pool.clicks < 4) { sfx.error(); float(248, 232, 'LOCKJAW: NEED 4+ TEETH', C.red, 1); return; }
  const val = bankMath(!!sweep);
  G.score += val;
  G.stats.banks++;
  if (val > G.stats.bestBank) G.stats.bestBank = val;
  if (bossIs('loanshark')) { G.money = Math.max(0, G.money - 1); float(60, 190, '-$1', C.red, 1); }
  float(60, 96, '+' + fmt(val), C.gold, 2, 1.4);
  burst(60, 100, C.gold, 14, 80);
  if (!sweep) sfx.bank();
  endBite();
}

function startSnap(i) {
  const s = G.mouth[i];
  s.pressed = true; s.revealed = 'snap';
  G.state = 'snap'; G.snapT = 0; G.snapIdx = i;
  sfx.snap();
}

function endBite() {
  G.bites--;
  G.mode = 'idle'; G.extractCons = -1;
  if (G.score >= G.target) { roundWon(); return; }
  if (G.bites <= 0) { gameOver(); return; }
  newMouth();
}

function roundWon() {
  const base = ROUND_REWARD[G.round];
  const perBite = G.bites; // unused bites, $1 each
  const interest = Math.min(5, Math.floor(G.money / 5));
  const fairy = has('fairy') ? 2 : 0;
  G.cash = { base, perBite, interest, fairy, total: base + perBite + interest + fairy };
  G.state = 'roundend';
  sfx.win();
  if (G.ante > best) { best = G.ante; saveBest(); }
}

function cashOut() {
  gainMoney(G.cash.total);
  if (G.ante === 8 && G.round === 2 && !G.wonOnce) {
    G.wonOnce = true;
    G.state = 'win';
    return;
  }
  enterShop();
}

function enterShop() {
  G.rerollCost = 4;
  rollShop();
  G.state = 'shop';
}

function weightedCharm(pool) {
  // rar 0 common, 1 uncommon, 2 rare
  const w = pool.map(c => c.rar === 0 ? 6 : c.rar === 1 ? 3 : 1);
  let tot = w.reduce((a, b) => a + b, 0);
  let r = rnd() * tot;
  for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) return pool[i]; }
  return pool[pool.length - 1];
}

function rollShop() {
  const items = [];
  let cpool = CHARMS.filter(c => !has(c.id));
  for (let k = 0; k < 2 && cpool.length; k++) {
    const def = weightedCharm(cpool);
    cpool = cpool.filter(c => c !== def);
    items.push({ kind: 'charm', def, price: def.cost, sold: false });
  }
  let copool = CONS.slice();
  for (let k = 0; k < 2; k++) {
    const def = choice(copool);
    copool = copool.filter(c => c !== def);
    items.push({ kind: 'cons', def, price: def.cost, sold: false });
  }
  const tt = choice(SHOP_TEETH);
  items.push({ kind: 'tooth', def: TOOTH_DEFS[tt], type: tt, price: TOOTH_DEFS[tt].cost, sold: false });
  G.shopItems = items;
}

function buyItem(it) {
  if (it.sold) return;
  if (G.money < it.price) { sfx.error(); float(mx, my - 10, 'NOT ENOUGH $', C.red, 1); return; }
  if (it.kind === 'charm') {
    if (G.charms.length >= 5) { sfx.error(); float(mx, my - 10, 'CHARM SLOTS FULL', C.red, 1); return; }
    G.charms.push(it.def);
  } else if (it.kind === 'cons') {
    if (G.cons.length >= 2) { sfx.error(); float(mx, my - 10, 'CARD SLOTS FULL', C.red, 1); return; }
    G.cons.push(it.def);
  } else if (it.kind === 'tooth') {
    G.deck.push(mkTooth(it.type));
  }
  G.money -= it.price;
  it.sold = true;
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

function nextRound() {
  G.round++;
  if (G.round > 2) { G.round = 0; G.ante++; }
  startRound();
}

function gameOver() {
  G.state = 'gameover';
  if (G.ante > best) { best = G.ante; saveBest(); }
  sfx.boss();
}

// --------------------------------------------------------- xray / extract -
function doXray(i) {
  const s = G.mouth[i];
  if (!s || s.pressed || s.gone || s.revealed) { sfx.error(); return; }
  s.revealed = s.snap ? 'snap' : 'safe';
  G.xrays--;
  G.mode = 'idle';
  const p = toothScreenPos(i);
  float(p.x, p.y - 14, s.snap ? 'SNAPPER!' : 'SAFE', s.snap ? C.red : C.green, 1);
  sfx.xray();
}

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

function useCons(i) {
  const def = G.cons[i]; if (!def) return;
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
      if (G.mode === 'extract' && G.extractCons === i) { G.mode = 'idle'; G.extractCons = -1; return; }
      G.mode = 'extract'; G.extractCons = i; sfx.xray();
      return; // consumed on use
    case 'fluoride': G.pool.teeth += 25; float(60, 120, '+25 TEETH', C.blue, 1); sfx.defuse(); break;
    case 'shot': G.bites++; float(60, 160, '+1 BITE', C.green, 1); sfx.defuse(); break;
    case 'goldmolar': G.deck.push(mkTooth('gold')); float(mx, my - 10, 'GOLD TOOTH ADDED', C.gold, 1); sfx.coin(); break;
    case 'rubymolar': G.deck.push(mkTooth('ruby')); float(mx, my - 10, 'RUBY TOOTH ADDED', C.red, 1); sfx.coin(); break;
    case 'polish': {
      const plains = G.deck.filter(t => t.type === 'plain');
      shuffle(plains).slice(0, 3).forEach(t => t.base += 2);
      float(mx, my - 10, '3 TEETH POLISHED +2', C.blue, 1); sfx.buy(); break;
    }
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
  mk(topN, false, maw.y + 2 + jawDrop);  // top row hangs down, moves with jaw
  mk(botN, true, maw.y + maw.h - 28);
  return { maw, slots, jawDrop };
}

// ------------------------------------------------------------ input -------
let mx = -10, my = -10, hits = [], hotId = null, tooltip = null;
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
canvas.addEventListener('mousemove', e => { const p = pointFromEvent(e); mx = p.x; my = p.y; });
canvas.addEventListener('mousedown', e => {
  audio();
  const p = pointFromEvent(e); mx = p.x; my = p.y;
  const h = topHitAt(mx, my);
  if (h && h.cb && !h.disabled) h.cb();
});
canvas.addEventListener('touchstart', e => {
  audio();
  const p = pointFromEvent(e); mx = p.x; my = p.y;
  const h = topHitAt(mx, my);
  if (h && h.cb && !h.disabled) h.cb();
  e.preventDefault();
}, { passive: false });
addEventListener('keydown', e => {
  if (e.key === 'm' || e.key === 'M') muted = !muted;
});

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

function drawCharmCard(x, y, def, idx, opts) {
  opts = opts || {};
  const wob = Math.sin(tNow * 2.1 + idx * 1.7) * 1.2;
  const hov = mx >= x && mx < x + 26 && my >= y - 4 && my < y + 40;
  const yy = y + (hov ? -3 : wob);
  const rarCol = def.rar === 2 ? C.red : def.rar === 1 ? C.blue : '#5d7a86';
  rr(x + 1, yy + 3, 26, 36, 2, '#00000077');
  rr(x, yy, 26, 36, 2, rarCol);
  rr(x + 1, yy + 1, 24, 34, 2, '#26333c');
  rr(x + 2, yy + 2, 22, 12, 1, '#31414c');
  (ICONS[def.ico] || ICONS.star)(x + 7, yy + 12);
  drawTextC(def.name.split(' ')[0].slice(0, 4), x + 13, yy + 28, C.white, 1);
  let tip = def.name + '|' + def.desc;
  if (opts.sell) tip += '|CLICK TO SELL FOR $' + Math.ceil(def.cost / 2);
  hit(x, y - 2, 26, 40, { cb: opts.cb, tip, id: 'charm' + idx + def.id, cursor: !!opts.cb });
}

function drawConsCard(x, y, def, idx, opts) {
  opts = opts || {};
  const wob = Math.sin(tNow * 2.3 + idx * 2.9) * 1.2;
  const hov = mx >= x && mx < x + 26 && my >= y - 4 && my < y + 40;
  const yy = y + (hov ? -3 : wob);
  rr(x + 1, yy + 3, 26, 36, 2, '#00000077');
  rr(x, yy, 26, 36, 2, C.purple);
  rr(x + 1, yy + 1, 24, 34, 2, '#332640');
  rr(x + 2, yy + 2, 22, 12, 1, '#443355');
  (ICONS[def.ico] || ICONS.star)(x + 7, yy + 12);
  drawTextC(def.name.slice(0, 4), x + 13, yy + 28, C.white, 1);
  let tip = def.name + '|' + def.desc;
  if (opts.use) tip += '|CLICK TO USE';
  hit(x, y - 2, 26, 40, { cb: opts.cb, tip, id: 'cons' + idx + def.id, cursor: !!opts.cb });
}

// ------------------------------------------------------------ croc --------
function drawCroc(closeT, opts) {
  opts = opts || {};
  const L = mouthLayout();
  const maw = L.maw;
  const bodyX = maw.x - 22, bodyW = maw.w + 44;
  const jawDrop = closeT * (maw.h - 26);
  const breathe = G.state === 'play' ? Math.sin(tNow * 1.6) * 1 : 0;

  // --- lower jaw base (behind maw) ---
  rr(bodyX, maw.y + maw.h - 6, bodyW, 40, 4, C.crocD);
  rr(bodyX + 1, maw.y + maw.h - 6, bodyW - 2, 38, 4, C.crocB);
  rr(bodyX + 3, maw.y + maw.h + 8, bodyW - 6, 26, 4, C.crocA);

  // --- maw interior ---
  rr(maw.x - 6, maw.y - 4, maw.w + 12, maw.h + 10, 4, C.mawD);
  rr(maw.x - 3, maw.y - 1, maw.w + 6, maw.h + 4, 4, C.maw);
  // tongue
  rr(maw.x + 30, maw.y + maw.h - 34, maw.w - 60, 28, 4, C.tongue);
  rr(maw.x + 40, maw.y + maw.h - 32, maw.w - 80, 10, 3, C.tongueHi);
  rect(maw.x + maw.w / 2 - 1, maw.y + maw.h - 30, 2, 22, '#a83a4e');

  // --- teeth ---
  const hoveredTooth = (G.state === 'play' && (G.mode !== 'idle' || true));
  L.slots.forEach((sl, i) => {
    const s = G.mouth[i]; if (!s) return;
    if (s.gone) {
      // empty socket
      rr(sl.x + 2, sl.up ? sl.y + sl.h - 8 : sl.y, sl.w - 4, 6, 2, '#00000055');
      return;
    }
    const hov = G.state === 'play' && mx >= sl.x && mx < sl.x + sl.w && my >= sl.y && my < sl.y + sl.h && !s.pressed;
    let ty = sl.y, th = sl.h;
    if (s.pressed) {
      // sunk into gum
      th = Math.floor(sl.h * 0.55);
      if (!sl.up) ty = sl.y; else ty = sl.y + (sl.h - th);
    } else if (hov) {
      ty += sl.up ? -2 : 2;
    }
    if (s.pop > 0) { ty += sl.up ? 2 : -2; }
    const snappingThis = (G.state === 'snap' && G.snapIdx === i);
    let outline = '#00000055';
    if (hov) outline = C.gold;
    if (s.revealed === 'snap' && !s.pressed) outline = C.red;
    if (snappingThis) outline = (Math.floor(tNow * 14) % 2) ? C.red : C.white;
    drawTooth(sl.x, ty, sl.w, th, sl.up, s.t.type, { pressedTint: s.pressed, outline });
    // value label
    if (!s.pressed) {
      const hideVal = bossIs('cotton');
      const vs = hideVal ? '?' : '' + s.t.base;
      const vy = sl.up ? ty + th - 7 : ty + 2;
      drawTextC(vs, sl.x + sl.w / 2, vy, hideVal ? C.purple : '#6d5c3a', 1);
    }
    // revealed badges
    if (s.revealed === 'safe' && !s.pressed) {
      rr(sl.x + sl.w - 7, sl.up ? sl.y - 5 : sl.y + sl.h - 1, 7, 7, 2, C.greenD);
      drawText('+', sl.x + sl.w - 6, (sl.up ? sl.y - 4 : sl.y + sl.h), C.white, 1);
    }
    if (s.revealed === 'snap' && !s.pressed && !s.gone) {
      rr(sl.x + sl.w - 7, sl.up ? sl.y - 5 : sl.y + sl.h - 1, 7, 7, 2, C.redD);
      drawText('!', sl.x + sl.w - 5, (sl.up ? sl.y - 4 : sl.y + sl.h), C.white, 1);
    }
    // debuffed marker
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
  rr(bodyX, maw.y + maw.h - 2, bodyW, 10, 3, C.crocB);
  rect(bodyX + 2, maw.y + maw.h - 2, bodyW - 4, 3, C.crocD);

  // --- upper jaw (snout) ---
  const jy = maw.y - 58 + jawDrop + breathe;
  rr(bodyX - 4, jy, bodyW + 8, 62, 4, C.crocD);
  rr(bodyX - 3, jy + 1, bodyW + 6, 60, 4, C.crocB);
  rr(bodyX - 1, jy + 3, bodyW + 2, 52, 4, C.crocA);
  rr(bodyX + 6, jy + 5, bodyW - 12, 10, 3, C.crocC);
  // scale dots
  for (let k = 0; k < 7; k++) {
    rect(bodyX + 14 + k * 36, jy + 22 + (k % 2) * 8, 3, 3, C.crocB);
  }
  // nostrils
  rr(maw.x + maw.w / 2 - 34, jy + 8, 12, 8, 2, C.crocB);
  rr(maw.x + maw.w / 2 + 22, jy + 8, 12, 8, 2, C.crocB);
  rect(maw.x + maw.w / 2 - 31, jy + 11, 4, 3, C.crocD);
  rect(maw.x + maw.w / 2 + 27, jy + 11, 4, 3, C.crocD);
  // upper lip edge
  rect(bodyX - 1, jy + 55, bodyW + 2, 3, C.crocD);
  rr(bodyX - 1, jy + 52, bodyW + 2, 6, 2, C.crocB);

  // --- eyes on top ---
  const squeeze = closeT > 0.5 || opts.angry;
  const exL = maw.x + 34, exR = maw.x + maw.w - 58, ey = jy - 12;
  [exL, exR].forEach((ex) => {
    rr(ex - 4, ey, 30, 20, 4, C.crocB);
    rr(ex - 3, ey + 1, 28, 17, 4, C.crocA);
    if (squeeze) {
      rect(ex + 2, ey + 8, 18, 3, C.crocD);
    } else {
      const blink = (tNow % 4.3) > 4.15;
      rr(ex + 3, ey + 4, 16, 12, 3, '#f8f4dc');
      if (blink) {
        rect(ex + 3, ey + 4, 16, 12, C.crocA);
      } else {
        const dx = clamp((mx - (ex + 11)) / 60, -1, 1) * 3;
        const dy = clamp((my - (ey + 10)) / 60, -1, 1) * 2;
        rect(ex + 9 + dx, ey + 6 + dy, 4, 8, '#1b1408');
        rect(ex + 10 + dx, ey + 7 + dy, 1, 2, '#fff');
      }
    }
    // brow
    rect(ex - 2, ey - 2, 26, 3, C.crocD);
  });
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

// ------------------------------------------------------------ sidebar -----
function drawSidebar() {
  panel(SIDEBAR.x, SIDEBAR.y, SIDEBAR.w, SIDEBAR.h, { face: '#18242bee' });
  const x = SIDEBAR.x + 5, w = SIDEBAR.w - 10;
  let y = SIDEBAR.y + 5;

  // round plate
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

  // target + score
  panel(x, y, w, 40, { face: C.dark2 });
  drawText('TARGET', x + 4, y + 4, C.dim, 1);
  drawText(fmt(G.target), x + 4, y + 12, C.orange, 1);
  drawText('SCORE', x + 4, y + 22, C.dim, 1);
  const sc = G.dispScore >= 100000 ? 1 : 2;
  drawText(fmt(Math.round(G.dispScore)), x + 4, y + 29, C.gold, sc);
  // progress bar
  const pw = Math.floor(clamp(G.score / G.target, 0, 1) * (w - 8));
  rect(x + 4, y + 41 - 3, w - 8, 2, '#0a1215');
  if (pw > 0) rect(x + 4, y + 41 - 3, pw, 2, C.gold);
  y += 44;

  // teeth x mult
  const half = Math.floor((w - 12) / 2);
  chip(x, y, half, 16, G.pool ? G.pool.teeth : 0, '#1565b5', '#0c3f75', 1);
  drawTextC('*', x + half + 6, y + 5, C.red, 2);
  chip(x + half + 12, y, half, 16, G.pool ? G.pool.mult : 0, '#c22a20', '#801812', 1);
  drawText('TEETH', x + 2, y + 18, '#7fb8e8', 1);
  drawText('MULT', x + half + 14, y + 18, '#ff9a90', 1);
  y += 27;

  // bite value preview
  panel(x, y, w, 14, { face: '#252017', edge: '#6b5a2a' });
  drawText('BITE', x + 4, y + 4, C.dim, 1);
  drawText(fmt(G.pool ? bankValue() : 0), x + 30, y + 4, C.gold, 1);
  y += 19;

  // bites + xrays
  drawText('BITES', x + 2, y + 2, C.dim, 1);
  for (let i = 0; i < Math.min(6, G.bites); i++) {
    const bx = x + 34 + i * 12;
    ICONS.tooth(bx, y - 2);
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

  // money
  panel(x, y, w, 18, { face: '#26321e', edge: '#5a7a3a' });
  drawText('$' + G.money, x + 6, y + 5, C.gold, 2);
  drawTextC('MONEY', x + w - 22, y + 7, '#9ab87a', 1);
  y += 23;

  // deck button
  button(x, y, w, 14, 'TEETH ' + G.drawPile.length + '/' + G.deck.length, '#3a5560', '#243a44',
    () => { G.deckOpen = !G.deckOpen; }, { id: 'deckbtn', tip: 'YOUR TOOTH DECK|CLICK TO VIEW' });
  y += 19;

  // best
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
  // charm slots
  const cx0 = 120;
  drawText('CHARMS ' + G.charms.length + '/5', cx0, 2, C.dim, 1);
  for (let i = 0; i < 5; i++) {
    const x = cx0 + i * 31, y = 12;
    if (i < G.charms.length) {
      drawCharmCard(x, y, G.charms[i], i, inShop ? { sell: true, cb: () => sellCharm(i) } : {});
    } else {
      rr(x, y, 26, 36, 2, '#ffffff18');
      rr(x + 1, y + 1, 24, 34, 2, '#00000030');
    }
  }
  // consumable slots
  const kx0 = 416;
  drawText('CARDS', kx0, 2, C.dim, 1);
  for (let i = 0; i < 2; i++) {
    const x = kx0 + i * 31, y = 12;
    if (i < G.cons.length) {
      const active = G.mode === 'extract' && G.extractCons === i;
      drawConsCard(x, y, G.cons[i], i, { use: true, cb: () => useCons(i) });
      if (active) {
        rr(x - 1, y - 1, 28, 38, 2, '#ffffff44');
      }
    } else {
      rr(x, y, 26, 36, 2, '#ffffff18');
      rr(x + 1, y + 1, 24, 34, 2, '#00000030');
    }
  }
}

// ------------------------------------------------------------ play screen -
function drawPlay() {
  drawBG(tNow, G.round === 2 ? BGPALS.boss : BGPALS.play);
  drawCroc(G.jawClose);
  drawSidebar();
  drawTopBar(false);

  // mode banner
  if (G.mode === 'xray') {
    drawTextCSh('CLICK A TOOTH TO X-RAY IT', W / 2 + 50, 66, '#9fe8ff', 1);
  } else if (G.mode === 'extract') {
    drawTextCSh('CLICK A TOOTH TO YANK IT OUT', W / 2 + 50, 66, '#9fe8ff', 1);
  }

  // buttons
  const canBank = G.pool && G.pool.clicks > 0 && !(bossIs('lockjaw') && G.pool.clicks < 4);
  button(150, 240, 130, 24, 'BANK BITE', '#e8a020', '#98650e',
    () => bank(false), {
      sc: 1, id: 'bank', disabled: !canBank,
      sub: '+' + fmt(G.pool ? bankValue() : 0), subCol: '#5a3c08',
      tip: 'BANK BITE|Score TEETH X MULT and end this bite.' + (bossIs('lockjaw') ? '|LOCKJAW: NEEDS 4+ PRESSED' : '')
    });
  const xdis = G.xrays <= 0 || xraysBlocked();
  button(290, 240, 86, 24, G.mode === 'xray' ? 'CANCEL' : 'X-RAY (' + G.xrays + ')', '#2277cc', '#124a80',
    toggleXrayMode, { id: 'xray', disabled: xdis && G.mode !== 'xray', tip: 'X-RAY|Check one tooth: safe or snapper?|' + (xraysBlocked() ? 'BLOCKED THIS ROUND!' : G.xrays + ' LEFT THIS ROUND') });

  // risk meter: teeth remaining vs snaps hidden
  const unpressed = G.mouth.filter(s => !s.pressed && !s.gone);
  const snapsLeft = unpressed.filter(s => s.snap).length;
  if (unpressed.length > 0 && G.pool) {
    const risk = Math.round(100 * snapsLeft / unpressed.length);
    drawTextCSh('SNAP RISK ' + risk + '%', 428, 240, risk >= 34 ? C.red : risk >= 15 ? C.orange : C.green, 1);
    drawTextCSh(unpressed.length + ' TEETH LEFT', 428, 252, C.dim, 1);
  }
}

// ------------------------------------------------------------ snap anim ---
function updateSnap(dt) {
  G.snapT += dt;
  if (G.snapT < 0.22) {
    G.jawClose = easeIn(G.snapT / 0.22);
  } else {
    if (G.jawClose < 1) { shake = 7; flashRed = 0.35; burstTeethShards(); }
    G.jawClose = 1;
  }
  if (G.snapT > 1.5) {
    const lost = G.pool ? bankValue() : 0;
    G.jawClose = 0;
    G.state = 'play';
    G.stats.snaps++;
    if (lost > 0) float(60, 96, 'LOST ' + fmt(lost) + '!', C.red, 1, 1.4);
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

function drawSnap() {
  drawPlay();
  if (G.snapT > 0.22 && G.snapT < 1.4) {
    drawTextCSh('SNAP!', W / 2 + 50, 80, C.red, 4, '#40000088');
    const lost = G.pool ? bankValue() : 0;
    if (lost > 0) drawTextCSh('BITE LOST: ' + fmt(lost), W / 2 + 50, 116, '#ffb0a8', 1);
  }
}

// ------------------------------------------------------------ shop --------
function drawShop() {
  drawBG(tNow, BGPALS.shop);
  drawSidebar();
  drawTopBar(true);

  drawTextCSh('GATOR SHOP', 296, 58, C.gold, 3, '#00000088');
  drawTextCSh('HOVER CHARMS ABOVE TO SELL THEM', 296, 82, C.dim, 1);

  // items
  const bx0 = 140;
  G.shopItems.forEach((it, i) => {
    const x = bx0 + i * 66, y = 104;
    panel(x - 4, y - 6, 58, 92, { face: '#1a2530dd' });
    if (it.sold) {
      drawTextC('SOLD', x + 25, y + 34, C.dim, 1);
      return;
    }
    if (it.kind === 'charm') {
      drawCharmCard(x + 12, y + 2, it.def, i + 10, { cb: () => buyItem(it) });
    } else if (it.kind === 'cons') {
      drawConsCard(x + 12, y + 2, it.def, i + 10, { cb: () => buyItem(it) });
    } else {
      const hov = mx >= x + 12 && mx < x + 40 && my >= y && my < y + 40;
      drawTooth(x + 14, y + 4 + (hov ? -3 : Math.sin(tNow * 2 + i) * 1.2), 22, 30, true, it.type, {});
      hit(x + 10, y, 30, 40, { cb: () => buyItem(it), tip: it.def.name + '|' + it.def.desc + '|ADDS TO YOUR DECK', id: 'shoptooth' + i, cursor: true });
    }
    const afford = G.money >= it.price;
    drawTextC('$' + it.price, x + 25, y + 48, afford ? C.gold : C.red, 2);
    const label = it.kind === 'charm' ? 'CHARM' : it.kind === 'cons' ? 'CARD' : 'TOOTH';
    drawTextC(label, x + 25, y + 66, C.dim, 1);
    const nm = it.def.name;
    drawTextC(nm.length > 11 ? nm.slice(0, 11) : nm, x + 25, y + 76, C.white, 1);
  });

  button(160, 216, 100, 22, 'REROLL $' + G.rerollCost, '#7a4fd0', '#4a2a8a', reroll,
    { id: 'reroll', disabled: G.money < G.rerollCost, tip: 'REROLL|Refresh all shop items' });
  const nextName = G.round === 2 ? 'NEXT ANTE' : 'NEXT ROUND';
  button(290, 212, 120, 30, nextName + ' >', '#d94f30', '#8a2a16', nextRound, { id: 'next', sc: 1, tip: 'Onward to the ' + (G.round === 2 ? 'next ante!' : ROUND_NAMES[G.round + 1] + '!') });
}

// ------------------------------------------------------------ overlays ----
function overlayDim(a) { rect(0, 0, W, H, 'rgba(5,10,10,' + (a === undefined ? 0.72 : a) + ')'); }

function drawRoundEnd() {
  drawBG(tNow, G.round === 2 ? BGPALS.boss : BGPALS.play);
  drawCroc(0.9);
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
  line('CROC DEFEATED', G.cash.base);
  if (G.cash.perBite > 0) line('UNUSED BITES', G.cash.perBite, C.green);
  if (G.cash.interest > 0) line('INTEREST (MAX $5)', G.cash.interest, C.blue);
  if (G.cash.fairy > 0) line('TOOTH FAIRY', G.cash.fairy, C.purple);
  y += 4;
  drawText('TOTAL', px + 24, y, C.white, 1);
  drawText('$' + G.cash.total, px + pw - 24 - textW('$' + G.cash.total, 1), y, C.gold, 1);
  button(px + pw / 2 - 55, py + ph - 32, 110, 24, 'CASH OUT', '#e8a020', '#98650e', cashOut, { id: 'cashout' });
}

function drawBossIntro() {
  drawBG(tNow, BGPALS.boss);
  drawCroc(Math.abs(Math.sin(tNow * 2.2)) * 0.25, { angry: true });
  drawSidebar();
  overlayDim(0.6);
  const pulse = 1 + Math.sin(tNow * 4) * 0.06;
  drawTextCSh('BOSS CROC', W / 2, 62, C.red, 2);
  drawTextCSh(G.boss.name, W / 2, 84, C.white, Math.round(3 * pulse));
  drawTextCSh(G.boss.desc, W / 2, 122, '#ffb0a8', 1);
  drawTextCSh('TARGET: ' + fmt(G.target), W / 2, 140, C.orange, 1);
  button(W / 2 - 55, 168, 110, 26, 'BITE DOWN!', '#d94f30', '#8a2a16', () => { G.state = 'play'; }, { id: 'bossgo' });
}

function drawGameOver() {
  drawBG(tNow, BGPALS.boss);
  drawCroc(1, { angry: true });
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
  button(W / 2 - 55, 196, 110, 26, 'NEW RUN', '#d94f30', '#8a2a16', newRun, { id: 'newrun' });
  button(W / 2 - 45, 230, 90, 18, 'MENU', '#3a5560', '#243a44', () => { G.state = 'menu'; }, { id: 'tomenu' });
}

function drawWin() {
  drawBG(tNow, BGPALS.menu);
  drawCroc(0.15);
  overlayDim(0.6);
  drawTextCSh('YOU WIN!', W / 2, 40, C.gold, 4);
  drawTextCSh('ALL 8 ANTES SURVIVED. THE CROC RESPECTS YOU.', W / 2, 76, C.white, 1);
  const px = 160, pw = 160;
  panel(px, 92, pw, 72, { face: '#1c2b33f2' });
  let y = 100;
  const st = (l, v) => { drawText(l, px + 12, y, C.dim, 1); drawText('' + v, px + pw - 12 - textW('' + v, 1), y, C.white, 1); y += 12; };
  st('TEETH PRESSED', G.stats.pressed);
  st('TIMES SNAPPED', G.stats.snaps);
  st('BEST BANK', fmt(G.stats.bestBank));
  st('MONEY EARNED', '$' + G.stats.moneyEarned);
  button(W / 2 - 75, 176, 150, 26, 'ENDLESS MODE >', '#7a4fd0', '#4a2a8a', () => { enterShop(); }, { id: 'endless', tip: 'Keep going!|Targets keep growing forever' });
  button(W / 2 - 55, 210, 110, 22, 'NEW RUN', '#d94f30', '#8a2a16', newRun, { id: 'newrun2' });
}

// ------------------------------------------------------------ menu --------
function drawMenu() {
  drawBG(tNow, BGPALS.menu);
  // menu croc: needs a mouth to display — fake a chomping preview
  const chomp = Math.max(0, Math.sin(tNow * 1.4)) * 0.9;
  drawCroc(chomp);

  // title
  const ty = 20 + Math.sin(tNow * 1.8) * 2;
  drawTextCSh('BITE', W / 2 - 62, ty, C.gold, 5, '#00000088');
  drawTextCSh('DOWN', W / 2 + 66, ty, '#63d66a', 5, '#00000088');
  drawTextCSh('A PUSH-YOUR-LUCK DENTAL ROGUELIKE', W / 2, ty + 32, C.white, 1);

  button(W / 2 - 65, 218, 130, 30, 'NEW RUN', '#d94f30', '#8a2a16', () => { newRun(); }, { id: 'start', sc: 2 });
  button(W / 2 - 65, 252, 62, 14, 'HOW TO', '#3a5560', '#243a44', () => { G.howFrom = 'menu'; G.state = 'how'; }, { id: 'how' });
  button(W / 2 + 3, 252, 62, 14, muted ? 'UNMUTE' : 'MUTE', '#3a5560', '#243a44', () => { muted = !muted; }, { id: 'mute' });
  if (best > 0) drawTextCSh('BEST ANTE: ' + best, W / 2, 202, C.gold, 1);
}

function drawHow() {
  drawBG(tNow, BGPALS.shop);
  overlayDim(0.4);
  const px = 60, py = 12, pw = 360, ph = 246;
  panel(px, py, pw, ph, { face: '#16222af5' });
  drawTextCSh('HOW TO BITE', px + pw / 2, py + 8, C.gold, 2);
  const L = [
    ['PRESS TEETH.', C.white],
    ['Each safe tooth adds its value to TEETH', C.dim],
    ['and grows your MULT chain by +1.', C.dim],
    ['', C.dim],
    ['ONE (OR MORE) TOOTH IS A SNAPPER.', C.red],
    ['Press it and the jaw SNAPS: your whole', C.dim],
    ['unbanked bite is LOST.', C.dim],
    ['', C.dim],
    ['BANK BITE to lock in TEETH X MULT.', C.gold],
    ['Each round you get 3 BITES to reach the', C.dim],
    ['target score. X-RAYS scan a tooth safely.', C.dim],
    ['', C.dim],
    ['Between rounds: THE SHOP. Buy CHARMS', C.purple],
    ['(passive powers), CARDS (one-time use) and', C.dim],
    ['SPECIAL TEETH that join your tooth deck.', C.dim],
    ['', C.dim],
    ['Beat 8 antes of SMALL, BIG and BOSS crocs.', C.green],
    ['Bosses bend the rules. Good luck, dentist.', C.dim],
  ];
  let y = py + 26;
  L.forEach(([t, c]) => { drawTextC(t, px + pw / 2, y, c, 1); y += 11; });
  button(px + pw / 2 - 45, py + ph - 26, 90, 18, 'GOT IT', '#d94f30', '#8a2a16', () => { G.state = G.howFrom; }, { id: 'gotit' });
}

// ------------------------------------------------------------ deck view ---
function drawDeckOverlay() {
  overlayDim(0.6);
  // blocker registered first so overlay buttons stay on top of it
  hit(0, 0, W, H, { cb: () => { G.deckOpen = false; }, id: 'deckblock' });
  const px = 120, py = 30, pw = 240, ph = 210;
  panel(px, py, pw, ph, { face: '#16222af5' });
  drawTextCSh('YOUR TOOTH DECK (' + G.deck.length + ')', px + pw / 2, py + 8, C.gold, 2);
  // group plain by value; specials by type
  const plain = {};
  const spec = {};
  G.deck.forEach(t => {
    if (t.type === 'plain') plain[t.base] = (plain[t.base] || 0) + 1;
    else spec[t.type] = (spec[t.type] || 0) + 1;
  });
  let y = py + 30;
  drawText('PLAIN TEETH:', px + 14, y, C.dim, 1); y += 12;
  Object.keys(plain).map(Number).sort((a, b) => a - b).forEach(v => {
    drawText('VALUE ' + v + '  X' + plain[v], px + 22, y, C.white, 1); y += 10;
  });
  y += 4;
  const specKeys = Object.keys(spec);
  if (specKeys.length) {
    drawText('SPECIAL TEETH:', px + 14, y, C.dim, 1); y += 12;
    specKeys.forEach(k => {
      drawTooth(px + 20, y - 3, 9, 11, true, k, {});
      drawText(TOOTH_DEFS[k].name + '  X' + spec[k], px + 34, y, C.white, 1); y += 12;
    });
  }
  drawTextC(G.drawPile.length + ' STILL IN THE BAG THIS ROUND', px + pw / 2, py + ph - 30, C.dim, 1);
  button(px + pw / 2 - 40, py + ph - 20, 80, 14, 'CLOSE', '#3a5560', '#243a44', () => { G.deckOpen = false; }, { id: 'deckclose' });
}

// ------------------------------------------------------------ tooltip -----
function drawTooltip() {
  const h = topHitAt(mx, my);
  canvas.style.cursor = (h && h.cursor) ? 'pointer' : 'default';
  if (h && h.id !== hotId) { hotId = h.id; if (h.cursor) sfx.hover(); }
  if (!h) hotId = null;
  if (!h || !h.tip) return;
  const lines = h.tip.split('|').filter(s => s.length);
  const wmax = Math.max(...lines.map(l => textW(l, 1))) + 12;
  const hh = lines.length * 9 + 8;
  let tx = clamp(mx + 8, 2, W - wmax - 2), ty = clamp(my + 12, 2, H - hh - 2);
  panel(tx, ty, wmax, hh, { face: '#10181cf5', edge: '#5d7a86' });
  lines.forEach((l, i) => {
    const col = i === 0 ? C.gold : (l.includes('SNAPPER') || l.includes('DEBUFF') || l.includes('BLOCKED') ? '#ff9a90' : C.white);
    drawText(l, tx + 6, ty + 5 + i * 9, col, 1);
  });
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
  if (G.pool) G.dispScore = lerp(G.dispScore, G.score, 1 - Math.pow(0.002, dt));
  else G.dispScore = G.score;
  G.mouth.forEach(s => { if (s.pop > 0) s.pop -= dt; });
}
function drawFx() {
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
  if (G.state === 'snap') updateSnap(dt); else shardsDone = false;
  musicTick();

  ctx.save();
  if (shake > 0) ctx.translate(ri(-shake, shake) / 2, ri(-shake, shake) / 2);

  switch (G.state) {
    case 'menu': drawMenu(); break;
    case 'how': drawHow(); break;
    case 'play': drawPlay(); break;
    case 'snap': drawSnap(); break;
    case 'roundend': drawRoundEnd(); break;
    case 'shop': drawShop(); break;
    case 'bossintro': drawBossIntro(); break;
    case 'gameover': drawGameOver(); break;
    case 'win': drawWin(); break;
  }

  if (G.deckOpen && (G.state === 'play' || G.state === 'shop')) drawDeckOverlay();

  drawFx();
  ctx.restore();

  if (flashRed > 0) { ctx.globalAlpha = flashRed * 1.4; rect(0, 0, W, H, '#a01818'); ctx.globalAlpha = 1; }

  // CRT-ish scanlines + vignette
  ctx.globalAlpha = 0.06;
  for (let y = 0; y < H; y += 3) rect(0, y, W, 1, '#000');
  ctx.globalAlpha = 1;
  rect(0, 0, W, 2, '#00000088'); rect(0, H - 2, W, 2, '#00000088');
  rect(0, 0, 2, H, '#00000088'); rect(W - 2, 0, 2, H, '#00000088');

  drawTooltip();
}
requestAnimationFrame(frame);

// menu needs a mouth for the croc preview
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
};

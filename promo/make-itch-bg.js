// Balatro-style swirling paint background for the itch.io page, in the game's
// swamp-and-sunset colours. Pure node, no browser. Loops seamlessly.
//   npm i gifenc   (once)
//   node promo/make-itch-bg.js
// Writes promo/itch-bg-1280x720.gif
const { GIFEncoder } = require('gifenc');
const fs = require('fs');
const FW = 256, FH = 144, PX = 5, FRAMES = 40, DELAY = 80;
const TAU = Math.PI * 2;
// banded palette: dusk purples -> swamp greens -> gator lime, with a sunset accent
const PAL = [
  [0x12, 0x10, 0x22], [0x1e, 0x1a, 0x38], [0x33, 0x24, 0x44],
  [0x16, 0x30, 0x22], [0x22, 0x4a, 0x24], [0x33, 0x66, 0x2c],
  [0x4a, 0x86, 0x38], [0x6c, 0xa8, 0x4a], [0x9a, 0x5a, 0x3a], [0xc8, 0x84, 0x4a],
];
const hx = c => c;
function field(x, y, th) {
  let u = (x - FW / 2) / FH * 2.2, v = (y - FH / 2) / FH * 2.2;
  const len = Math.hypot(u, v);
  const ang = Math.atan2(v, u) + 0.9 * len - th;       // spin, one full turn per loop
  u = Math.cos(ang) * len * 30; v = Math.sin(ang) * len * 30;
  let u2 = u + v, v2 = u + v;
  const cs = Math.cos(th) * 3, sn = Math.sin(th) * 3;
  for (let i = 0; i < 5; i++) {
    const m = Math.sin(Math.max(u, v));
    u2 += m + u; v2 += m + v;
    u += 0.5 * Math.cos(5.1123314 + 0.353 * v2 + cs * 0.4);
    v += 0.5 * Math.sin(u2 - 0.113 * sn);
    const k = Math.cos(u + v) - Math.sin(u * 0.711 - v);
    u -= k; v -= k;
  }
  return Math.hypot(u, v) * 0.035 * 1.6;
}
// the paint strength wraps round a symmetric ramp, so the swirl is all bands
const RAMP = [0, 1, 2, 1, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 8, 9, 8, 2];
function colourIdx(p, x, y) {
  const d = ((x * 7 + y * 13) % 4) / 4 * 0.02;          // tiny ordered dither on the edges
  const f = ((p * 0.3 + d) % 1 + 1) % 1;
  return RAMP[Math.floor(f * RAMP.length)];
}
const palette = PAL.map(hx);
const gif = GIFEncoder();
const W = FW * PX, H = FH * PX;
for (let f = 0; f < FRAMES; f++) {
  const th = f / FRAMES * TAU, idx = new Uint8Array(W * H);
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    const c = colourIdx(field(x, y, th), x, y);
    for (let j = 0; j < PX; j++) idx.fill(c, (y * PX + j) * W + x * PX, (y * PX + j) * W + x * PX + PX);
  }
  gif.writeFrame(idx, W, H, { palette: f === 0 ? palette : undefined, delay: DELAY, repeat: 0 });
}
gif.finish();
fs.writeFileSync(__dirname + '/itch-bg-1280x720.gif', Buffer.from(gif.bytes()));
console.log('wrote itch-bg-1280x720.gif', (gif.bytes().length / 1e6).toFixed(2) + 'MB');

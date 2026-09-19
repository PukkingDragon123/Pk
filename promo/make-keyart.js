// Renders the store art straight out of the live game, so the promo images can
// never drift from what the game actually looks like.
//   node promo/make-keyart.js
// Writes promo/thumbnail-630x500.png, promo/banner-1440x480.png,
// promo/cover-fullart.png.
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = __dirname;

// ---------------------------------------------------------------- page code
const HELPERS = `
// Draw the real fight scene - the same drawCroc() the game uses - at 2x into
// the canvas, then hand back an offscreen copy to composite from.
window.grabCroc = function (Z) {
  Z = Z || 2;
  canvas.width = 480 * Z; canvas.height = 270 * Z;
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(Z, 0, 0, Z, 0, 0);
  newRun('scout');
  G.state = 'menu';
  rollMenuLook();
  G.menuLook.mut = null;               // always the plain swamp gator, never a variant
  G.menuLook.round = 1;                // the big gator: widest jaws, best for key art
  G.menuLook.nodeType = 'big';
  G.mouth = G.menuLook.teeth;
  G.mut = null;
  const th = THEMES.night;
  drawSceneBack(th);
  drawCroc(0.02);                      // jaws all the way open
  drawSceneFront(th);
  const off = document.createElement('canvas');
  off.width = canvas.width; off.height = canvas.height;
  off.getContext('2d').drawImage(canvas, 0, 0);
  return off;
};

// A rusted plank sign carrying the title.
window.titlePlank = function (cx, cy, tsc, o) {
  o = o || {};
  const t1 = 'BITE', t2 = 'DOWN';
  const gapU = 5, gap = gapU * tsc;
  const tw1 = textW(t1, tsc), tw2 = textW(t2, tsc);
  const tot = tw1 + tw2 + gap;
  const pad = Math.max(4, Math.round(tsc * 1.4));
  const pw = tot + pad * 2, ph = 5 * tsc + pad * 2;
  const px = Math.round(cx - pw / 2), py = Math.round(cy - ph / 2);
  ctx.save(); ctx.globalAlpha = 0.6; rr(px + 3, py + 5, pw, ph, 6, '#000'); ctx.restore();
  rr(px, py, pw, ph, 6, '#1d1005');
  rr(px + 2, py + 2, pw - 4, ph - 4, 5, '#5c3413');
  rr(px + 2, py + 2, pw - 4, ph * 0.42, 5, '#74441c');
  ctx.save(); ctx.globalAlpha = 0.22;
  for (let k = 0; k < 18; k++) rect(px + 5 + (k * 53) % Math.max(1, pw - 12), py + 4 + (k % 5) * 3, 10 + (k % 4) * 7, 1, '#241405');
  ctx.restore();
  for (let k = 0; k < 4; k++) {
    const rx = k % 2 ? px + pw - 8 : px + 4, ry = k < 2 ? py + 4 : py + ph - 8;
    rect(rx, ry, 4, 4, '#8a5f10'); rect(rx, ry, 2, 2, '#ffe89a');
  }
  drawTextSh(t1, px + pad, py + pad, '#ffd23f', tsc, '#2a1a06');
  drawTextSh(t2, px + pad + tw1 + gap, py + pad, '#63d66a', tsc, '#2a1a06');
  ctx.save(); ctx.globalAlpha = 0.9;            // a bite chewed out of the corner
  for (let k = 0; k < 3; k++) fillCircle(px + pw - 6 - k * 7, py + ph - 1, 4 + (k % 2) * 2, o.biteCol || '#0a0c10');
  ctx.restore();
  if (o.sub !== false) {
    const sub = 'A PRESS-YOUR-LUCK DENTAL ROGUELIKE';
    const ssc = Math.max(1, Math.min(3, Math.round(pw / 200)));
    const sw = textW(sub, ssc), sy = py + ph + 3 * ssc;
    rr(cx - sw / 2 - 4 * ssc, sy - 2 * ssc, sw + 8 * ssc, 9 * ssc, 2, '#1d1005');
    rr(cx - sw / 2 - 3 * ssc, sy - ssc, sw + 6 * ssc, 7 * ssc, 2, '#40230c');
    drawTextCSh(sub, cx, sy, '#f0d8b0', ssc, '#1d1005');
  }
  return { x: px, y: py, w: pw, h: ph };
};

window.vignette = function (LW, LH, strength) {
  ctx.save();
  for (let k = 0; k < 14; k++) {
    ctx.globalAlpha = (strength || 0.055);
    rect(0, 0, LW, 2 + k * 2, '#000'); rect(0, LH - 2 - k * 2, LW, 2 + k * 2, '#000');
    rect(0, 0, 2 + k * 3, LH, '#000'); rect(LW - 2 - k * 3, 0, 2 + k * 3, LH, '#000');
  }
  ctx.restore();
};

// ------------------------------------------------- COVER / THUMBNAIL -------
// The real croc, cropped so its open jaws frame the shot, with the otter lit
// on the tongue and the title below her.
window.drawCover = function (off, OW, OH, S, crop) {
  canvas.width = OW; canvas.height = OH;
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  rect(0, 0, OW, OH, '#050d14');
  ctx.drawImage(off, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, OW, OH);
  ctx.setTransform(S, 0, 0, S, 0, 0);
  const LW = OW / S, LH = OH / S, U = LH / 100;
  // the croc was rendered at 2x from the 480x270 field, then cropped - so a
  // game coordinate maps into this frame as (game * 2 - crop) / S
  const Z = crop.z || 2;
  const g2l = (gx, gy) => ({ x: (gx * Z - crop.sx) / S, y: (gy * Z - crop.sy) / S });
  const ml = mouthLayout().maw;
  const topL = g2l(ml.x + ml.w / 2, ml.y), botL = g2l(ml.x + ml.w / 2, ml.y + ml.h);
  const hx = topL.x, mawTop = topL.y, mawBot = botL.y, mawH = mawBot - mawTop;

  ctx.save(); ctx.globalAlpha = 0.34; rect(0, 0, LW, LH, '#0a0a18'); ctx.restore();
  ctx.save();                                   // stage light pouring down the throat
  const coneH = mawBot - mawTop + 4;
  for (let i = 0; i < coneH; i++) {
    const f = i / coneH;
    ctx.globalAlpha = 0.1 * (1 - f * 0.4);
    rect(hx - (4 + 22 * f) * U, mawTop + i, (4 + 22 * f) * U * 2, 1, '#ffdf9a');
  }
  ctx.restore();

  const hsc = 0.8 * mawH / 58, hy = mawBot - 2;
  ctx.save(); ctx.globalAlpha = 0.36; ctx.scale(1, 0.24);
  fillCircle(hx, hy / 0.24, 22 * U, '#ffc867'); ctx.restore();
  ctx.save(); ctx.translate(hx, hy + 3 * hsc); ctx.scale(hsc * 1.4, hsc * 1.4); drawRowBoat(0, 0, 0, false); ctx.restore();
  drawBobble(hx - 2 * hsc, hy, 'scout', { sc: hsc, expr: 'wow', act: 'idle', t: 2.1, hat: 'ranger', gear: 'none', glove: 'rubber' });
  const lx = hx + 15 * hsc, ly = hy - 46 * hsc;
  rect(lx - 1, ly + 8 * hsc, 2, 10 * hsc, '#4a3320');
  rr(lx - 5 * hsc, ly, 10 * hsc, 12 * hsc, 3, '#2a2018');
  rr(lx - 3 * hsc, ly + 2 * hsc, 6 * hsc, 8 * hsc, 2, '#ffd54a');
  glow(lx, ly + 6 * hsc, 16 * hsc, '#ffd88a', 0.5);

  for (let k = 0; k < 40; k++) {
    const px = (k * 197) % LW, py = mawTop + ((k * 113) % Math.max(1, mawH));
    ctx.save(); ctx.globalAlpha = 0.2 + (k % 7) / 14;
    rect(px, py, (k % 5 === 0) ? 2 : 1, (k % 5 === 0) ? 2 : 1, k % 3 ? '#ffe089' : '#9ff0c0');
    ctx.restore();
  }
  // size the title so the plank clears the hero's boots and the strapline
  // still lands inside the frame
  const subH = 13;
  const plankBottom = LH - subH - 4;
  let tsc = Math.max(3, Math.round(LW * 0.74 / 43));
  while (tsc > 3) {
    const ph = 5 * tsc + 2 * Math.max(4, Math.round(tsc * 1.4));
    if (plankBottom - ph >= hy + 1) break;
    tsc--;
  }
  const phF = 5 * tsc + 2 * Math.max(4, Math.round(tsc * 1.4));
  titlePlank(LW * 0.5, plankBottom - phF / 2, tsc, {});
  vignette(LW, LH, 0.06);
};

// ------------------------------------------------------------ BANNER -------
// Abbey Road, bayou edition: the four rangers striding over a zebra crossing.
window.drawStreet = function (LW, LH) {
  const U = LH / 100;
  // ---- dusk sky ----
  const sky = ['#161d3a', '#26244a', '#452f52', '#6e3f52', '#a55a4a', '#d98a4a', '#f0b566'];
  for (let i = 0; i < sky.length; i++) rect(0, i * (52 * U / sky.length), LW, 52 * U / sky.length + 1, sky[i]);
  for (let k = 0; k < 60; k++) { const sx = (k * 149) % LW, sy = (k * 37) % (26 * U); ctx.save(); ctx.globalAlpha = 0.5; rect(sx, sy, 1, 1, '#cfe0ff'); ctx.restore(); }
  const sunX = LW * 0.5, sunY = 48 * U;
  glow(sunX, sunY, 40 * U, '#ffc06a', 0.5);
  fillCircle(sunX, sunY, 11 * U, '#ffd88a'); fillCircle(sunX, sunY, 9 * U, '#fff0c0');
  // ---- far treeline ----
  for (let k = 0; k < 40; k++) {
    const tx = (k * LW / 36) - 8, th = U * (5 + ((k * 31) % 8));
    rect(tx, 52 * U - th, 2 + (k % 3), th + 2, '#2a2038');
    rr(tx - 3 * U, 52 * U - th - 3 * U, 7 * U, 5 * U, 2, '#2a2038');
  }
  // ---- bayou-town buildings ----
  const blds = [[4, 30, 34], [40, 22, 26], [66, 38, 30], [100, 26, 22], [128, 34, 28], [300, 30, 26], [336, 24, 34], [366, 36, 24], [404, 28, 30], [440, 34, 26]];
  blds.forEach(([bx, bw, bh], i) => {
    const x = bx * (LW / 480), w = bw * (LW / 480), y = 52 * U - bh * U, h = bh * U + 4 * U;
    rect(x, y, w, h, i % 2 ? '#241d33' : '#2c2440');
    rect(x, y, w, 2, i % 2 ? '#3a3050' : '#463a5e');
    rect(x + w - 2, y, 2, h, '#1a1526');
    for (let wy = y + 5 * U; wy < y + h - 4 * U; wy += 7 * U)
      for (let wx = x + 3 * U; wx < x + w - 4 * U; wx += 7 * U) {
        const on = ((wx * 7 + wy * 3) | 0) % 5 !== 0;
        rect(wx, wy, 3 * U, 4 * U, on ? '#ffd07a' : '#191428');
        if (on) rect(wx, wy, 3 * U, 1, '#fff0c0');
      }
    if (i % 3 === 0) { rect(x + w / 2 - U, y - 6 * U, 2 * U, 6 * U, '#1a1526'); rect(x + w / 2 - 3 * U, y - 8 * U, 6 * U, 2 * U, '#1a1526'); }
  });
  // ---- pavement + kerb ----
  rect(0, 52 * U, LW, 12 * U, '#4a4458');
  rect(0, 52 * U, LW, 2, '#5f586e');
  for (let k = 0; k * 14 * U < LW; k++) rect(k * 14 * U, 52 * U, 1, 12 * U, '#3a3446');
  rect(0, 62 * U, LW, 3 * U, '#6a6278');
  rect(0, 62 * U, LW, 1, '#8a8298');
  rect(0, 65 * U, LW, 2 * U, '#2a2632');
  // ---- road ----
  rect(0, 67 * U, LW, LH - 67 * U, '#32303c');
  ctx.save(); ctx.globalAlpha = 0.25;
  for (let k = 0; k < 90; k++) rect((k * 97) % LW, 68 * U + ((k * 53) % (32 * U)), 3 + (k % 4) * 3, 1, '#4a4858');
  ctx.restore();
  // ---- zebra crossing, widening toward the camera ----
  for (let k = 0; k < 9; k++) {
    const t = k / 8;
    const bx = LW * (0.06 + t * 0.86);
    for (let i = 0; i < 26 * U; i++) {
      const f = i / (26 * U);
      const w = (6 + f * 5) * U;
      ctx.save(); ctx.globalAlpha = 0.96 - f * 0.1;
      rect(bx - w / 2 + f * (bx - LW / 2) * 0.1, 70 * U + i, w, 1, f < 0.12 ? '#fbf6e8' : '#eae2d0');
      ctx.restore();
    }
  }
  ctx.save(); ctx.globalAlpha = 0.13; rect(0, 67 * U, LW, LH - 67 * U, '#1a1826'); ctx.restore();

  // ---- a parked swamp buggy on the left kerb ----
  (function buggy() {
    const bx = 14 * U, by = 66 * U;
    rr(bx, by - 11 * U, 46 * U, 11 * U, 3, '#1b2c22');
    rr(bx + 1, by - 10 * U, 44 * U, 9 * U, 3, '#2f6b3a');
    rect(bx + 3 * U, by - 10 * U, 40 * U, 2 * U, '#49915a');
    rr(bx + 8 * U, by - 17 * U, 26 * U, 7 * U, 2, '#1b2c22');
    rr(bx + 9 * U, by - 16 * U, 24 * U, 5 * U, 2, '#7fc0d8');
    rect(bx + 10 * U, by - 16 * U, 10 * U, 2 * U, '#bfe8f2');
    [bx + 9 * U, bx + 34 * U].forEach(wx => { fillCircle(wx, by, 5 * U, '#17151c'); fillCircle(wx, by, 3 * U, '#3a3644'); fillCircle(wx, by, 1.5 * U, '#6a6278'); });
    rect(bx + 44 * U, by - 8 * U, 3 * U, 3 * U, '#ffd54a');
    glow(bx + 46 * U, by - 7 * U, 12 * U, '#ffd54a', 0.35);
  })();
  // ---- street lamp ----
  (function lamp() {
    const lx = LW - 34 * U;
    rect(lx, 22 * U, 2 * U, 44 * U, '#241f2c');
    rect(lx - 7 * U, 21 * U, 12 * U, 3 * U, '#241f2c');
    rr(lx - 9 * U, 22 * U, 8 * U, 5 * U, 2, '#3a3446');
    rect(lx - 8 * U, 24 * U, 6 * U, 3 * U, '#ffe089');
    glow(lx - 5 * U, 26 * U, 26 * U, '#ffd88a', 0.45);
  })();

  // ---- THE CROSSING: four rangers, in step, long shadows ----
  const crew = ['scout', 'medic', 'trader', 'frog'];
  const hats = ['ranger', 'straw', 'cowboy', 'bandana'];
  const strides = [0.291, 0.873, 1.454, 2.036];   // sin(t*5.4) at +1,-1,+1,-1
  const feetY = 87 * U, sc = LH / 152;
  const startX = LW * 0.29, stepX = LW * 0.108;
  crew.forEach((k, i) => {
    const cx = startX + i * stepX;
    ctx.save(); ctx.globalAlpha = 0.3;           // long shadow thrown back toward the sun
    ctx.translate(cx, feetY); ctx.transform(1, 0, -1.7, 0.26, 0, 0);
    fillCircle(0, 0, 7 * sc, '#0c0a14'); rect(-5 * sc, -50 * sc, 10 * sc, 50 * sc, '#0c0a14');
    ctx.restore();
    drawBobble(cx, feetY, k, {
      sc, act: 'walk', expr: i === 0 ? 'calm' : i === 1 ? 'happy' : i === 2 ? 'smug' : 'wow',
      t: strides[i], hat: hats[i], gear: 'none', glove: i === 1 ? 'rubber' : i === 2 ? 'leather' : 'bare',
    });
  });

  // ---- title on a hanging street sign ----
  const tsc = Math.max(3, Math.round(LW * 0.3 / 43));
  const tcx = Math.min(LW * 0.8, LW - textW('A PRESS-YOUR-LUCK DENTAL ROGUELIKE', 1) / 2 - 8);
  const pk = titlePlank(tcx, 20 * U, tsc, { sub: false, biteCol: '#2c2440' });
  rect(pk.x + pk.w * 0.22, 0, 2, pk.y, '#241f2c');
  rect(pk.x + pk.w * 0.78, 0, 2, pk.y, '#241f2c');
  const sub = 'A PRESS-YOUR-LUCK DENTAL ROGUELIKE';
  const ssc = Math.max(1, Math.round(pk.w / 190));
  const sw = textW(sub, ssc), sy = pk.y + pk.h + 4 * ssc;
  rr(tcx - sw / 2 - 4 * ssc, sy - 2 * ssc, sw + 8 * ssc, 9 * ssc, 2, '#1d1005');
  rr(tcx - sw / 2 - 3 * ssc, sy - ssc, sw + 6 * ssc, 7 * ssc, 2, '#40230c');
  drawTextCSh(sub, tcx, sy, '#f0d8b0', ssc, '#1d1005');

  vignette(LW, LH, 0.05);
};
`;

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const pg = await b.newPage({ viewport: { width: 1500, height: 900 } });
  const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto('file://' + OUT.replace(/\/promo$/, '') + '/index.html');
  await pg.waitForTimeout(800);
  await pg.evaluate(HELPERS);
  await pg.evaluate(() => {   // promo art gets the full wardrobe
    Object.keys(HATS).forEach(k => meta.hatOwn[k] = 1);
    Object.keys(GEAR).forEach(k => meta.gearOwn[k] = 1);
    Object.keys(GLOVES).forEach(k => meta.gachaOwn[k] = 1);
    ACHS.forEach(a => meta.ach[a.id] = 1);
  });

  const save = (name, data) => fs.writeFileSync(OUT + '/' + name, Buffer.from(data.split(',')[1], 'base64'));

  // thumbnail + cover both composite the real croc
  for (const job of [
    { name: 'thumbnail-630x500.png', w: 630, h: 500, s: 2, z: 2, sx: 273, sy: 34, sw: 630, sh: 500 },
    { name: 'cover-fullart.png', w: 960, h: 540, s: 2, z: 2, sx: 0, sy: 0, sw: 960, sh: 540 },
  ]) {
    const data = await pg.evaluate((j) => {
      const off = window.grabCroc(j.z);
      window.drawCover(off, j.w, j.h, j.s, { sx: j.sx, sy: j.sy, sw: j.sw, sh: j.sh, z: j.z });
      return canvas.toDataURL('image/png');
    }, job);
    save(job.name, data);
    console.log('wrote', job.name);
  }

  const banner = await pg.evaluate(() => {
    canvas.width = 1440; canvas.height = 480;
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(3, 0, 0, 3, 0, 0);
    window.drawStreet(480, 160);
    return canvas.toDataURL('image/png');
  });
  save('banner-1440x480.png', banner);
  console.log('wrote banner-1440x480.png');

  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await b.close();
})();

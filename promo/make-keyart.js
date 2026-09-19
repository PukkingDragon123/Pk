const { chromium } = require('playwright');
const fs = require('fs');

const ART = `
window.drawKeyArt = function (LW, LH, opt) {
  opt = opt || {};
  const U = LH / 100;                       // one layout unit
  const wide = LW / LH > 2;
  // ---------------- sky ----------------
  const bands = ['#050d14', '#08151e', '#0d2030', '#123044', '#173f57', '#1d5070'];
  for (let i = 0; i < bands.length; i++) rect(0, i * (46 * U / bands.length), LW, 46 * U / bands.length + 1, bands[i]);
  rect(0, 46 * U, LW, LH, '#0a1a24');
  for (let k = 0; k < 110; k++) {
    const sx = (k * 137) % LW, sy = (k * 61) % (44 * U);
    const bg = (k % 7 === 0);
    rect(sx, sy, bg ? 2 : 1, bg ? 2 : 1, bg ? '#ffffff' : '#9fc8d8');
  }
  const mx2 = LW * (wide ? 0.88 : 0.82), my2 = 15 * U, mr = 9 * U;
  glow(mx2, my2, mr * 3.4, '#cfe8f0', 0.34);
  fillCircle(mx2, my2, mr + 1, '#8fa8b8');
  fillCircle(mx2, my2, mr, '#eef6ef');
  fillCircle(mx2 - mr * 0.2, my2 - mr * 0.15, mr * 0.82, '#fbfff4');
  fillCircle(mx2 + mr * 0.35, my2 + mr * 0.2, mr * 0.2, '#d2dfd0');
  fillCircle(mx2 - mr * 0.4, my2 + mr * 0.35, mr * 0.13, '#d2dfd0');
  // ---------------- treeline ----------------
  const hz = 48 * U;
  for (let k = 0; k < 34; k++) {
    const tx = (k * LW / 30) - 10, th = U * (7 + ((k * 37) % 11));
    rect(tx, hz - th, 2 + (k % 3), th, '#071219');
    rr(tx - 4 * U, hz - th - 4 * U, 10 * U, 7 * U, 3, '#071219');
  }
  rect(0, hz - 2, LW, 3, '#0a1620');
  // ---------------- water ----------------
  for (let y = hz; y < LH; y += 2) rect(0, y, LW, 2, mixHex('#0e2a38', '#061119', (y - hz) / (LH - hz)));
  ctx.save();
  for (let k = 0; k < 80; k++) {
    const gy2 = hz + 3 + ((k * 29) % Math.max(1, LH - hz - 4));
    ctx.globalAlpha = 0.28 * (1 - (gy2 - hz) / (LH - hz) * 0.6);
    rect((k * 83) % LW, gy2, 4 * U + (k % 5) * 3, 1, '#6fc0d8');
  }
  ctx.globalAlpha = 0.16;
  for (let k = 0; k < 30; k++) rect(mx2 - 5 * U + ((k % 3) * 3 * U), hz + k * 2 * U, 8 * U - (k % 4) * 2, 1, '#cfe8f0');
  ctx.restore();

  // ---------------- the maw ----------------
  const jawT = (wide ? 31 : 26) * U, jawB = (wide ? 83 : 80) * U, mawH = jawB - jawT;
  ctx.save();
  ctx.globalAlpha = 0.72; rect(0, jawT, LW, mawH, '#2e0a14');
  ctx.globalAlpha = 0.5; rect(0, jawT, LW, mawH * 0.3, '#5a1020');
  ctx.globalAlpha = 0.55; rect(0, jawB - mawH * 0.22, LW, mawH * 0.22, '#180209');
  for (let k = 0; k < 14; k++) {                 // darken hard toward the corners
    ctx.globalAlpha = 0.07;
    rect(0, jawT, 4 * U + k * 3 * U, mawH, '#12020a');
    rect(LW - 4 * U - k * 3 * U, jawT, 4 * U + k * 3 * U, mawH, '#12020a');
  }
  ctx.restore();

  const G1 = '#1b4a14', G2 = '#2f7d22', G3 = '#4aa832', G4 = '#6fd04a', G5 = '#9ae86a';
  // ---- upper jaw ----
  rr(-12, -20, LW + 24, jawT + 20, 14, G1);
  rr(-10, -20, LW + 20, jawT + 16, 12, G2);
  rr(-8, -20, LW + 16, jawT * 0.6, 12, G3);
  rr(-6, -20, LW + 12, jawT * 0.28, 10, G4);
  ctx.save(); ctx.globalAlpha = 0.45; rect(0, 2, LW, 2, G5); ctx.restore();
  ctx.save(); ctx.globalAlpha = 0.26;
  for (let ry = 0; ry < 4; ry++) for (let sx = -6 + (ry % 2) * 6 * U; sx < LW; sx += 11 * U) rect(sx, 6 * U + ry * 6 * U, 6 * U, 2.5 * U, G1);
  ctx.restore();
  // brow ridges + eyes
  [wide ? 0.2 : 0.26, wide ? 0.74 : 0.74].forEach((f, i) => {
    const ex = LW * f, ey = jawT * 0.6, er = 8 * U;
    rr(ex - er * 2.1, ey - er * 2.2, er * 4.2, er * 2.9, 12, G1);
    rr(ex - er * 1.9, ey - er * 2.2, er * 3.8, er * 2.5, 10, G3);
    rr(ex - er * 1.5, ey - er * 2, er * 3, er * 1.4, 8, G4);
    rr(ex - er * 1.4, ey - er * 0.7, er * 2.8, er * 1.8, 7, '#f6f2dc');
    const look = (i ? -1 : 1) * er * 0.22;
    fillCircle(ex + look, ey + er * 0.25, er * 0.8, '#c9a52a');
    fillCircle(ex + look, ey + er * 0.25, er * 0.66, '#ffd93f');
    rect(ex + look - er * 0.22, ey - er * 0.5, er * 0.45, er * 1.5, '#12100a');
    rect(ex + look - er * 0.5, ey - er * 0.2, er * 0.3, er * 0.3, '#ffffff');
    ctx.save(); ctx.globalAlpha = 0.35; rect(ex - er * 1.4, ey - er * 0.7, er * 2.8, er * 0.4, '#a8832a'); ctx.restore();
  });
  [0.47, 0.53].forEach(f => { rr(LW * f - 3 * U, 3 * U, 6 * U, 4 * U, 3, G1); rr(LW * f - 2.5 * U, 3.5 * U, 5 * U, 2.5 * U, 2, '#0e1a08'); });
  // gum + upper teeth
  rect(-4, jawT - 5 * U, LW + 8, 6 * U, '#a8354f');
  rect(-4, jawT - 5 * U, LW + 8, 2 * U, '#d4587a');
  const tw0 = 17 * U, nT = Math.max(6, Math.round(LW / tw0));
  const fang = (tx, tw, top, tl, down) => {     // a smooth 1px-per-row taper
    const n = Math.max(6, Math.round(tl));
    for (let i = 0; i < n; i++) {
      const f = i / n;
      const w2 = Math.max(2, Math.round(tw * (1 - f * f * 0.88)));
      const xx = Math.round(tx + (tw - w2) / 2);
      const yy = Math.round(down ? top + i : top + tl - i - 1);
      rect(xx - 1, yy, w2 + 2, 1, '#8f8468');
      rect(xx, yy, w2, 1, f < 0.25 ? '#ddd4b6' : f < 0.6 ? '#f2ecd8' : '#fdfaec');
      rect(xx + 1, yy, Math.max(1, Math.round(w2 * 0.3)), 1, '#ffffff');
    }
  };
  for (let k = 0; k < nT; k++) {
    const tw = LW / nT, tx = k * tw + tw * 0.08, w3 = tw * 0.84;
    const tl = tw * (k % 3 === 1 ? 1.15 : k % 3 === 2 ? 0.78 : 0.96);
    ctx.save(); ctx.globalAlpha = 0.3; rr(tx + 2, jawT - U, w3, tl + 2, 3, '#120208'); ctx.restore();
    fang(tx, w3, jawT - 2 * U, tl, true);
  }
  // ---- lower jaw ----
  rr(-12, jawB, LW + 24, LH - jawB + 20, 14, G1);
  rr(-10, jawB + 2, LW + 20, LH - jawB + 18, 12, G2);
  rr(-8, jawB + 4 * U, LW + 16, LH - jawB, 12, G3);
  ctx.save(); ctx.globalAlpha = 0.24;
  for (let ry = 0; ry < 3; ry++) for (let sx = -6 + (ry % 2) * 6 * U; sx < LW; sx += 11 * U) rect(sx, jawB + 8 * U + ry * 5 * U, 6 * U, 2.5 * U, G1);
  ctx.restore();
  rect(-4, jawB - U, LW + 8, 5 * U, '#8f2b42');
  rect(-4, jawB + 4 * U, LW + 8, 1.5 * U, '#5f1a2a');
  for (let k = 0; k < nT; k++) {
    const tw = LW / nT, tx = k * tw + tw * 0.56, w3 = tw * 0.76;
    if (tx > LW - 4) continue;
    const tl = tw * (k % 3 === 0 ? 1.0 : 0.72);
    ctx.save(); ctx.globalAlpha = 0.3; rr(tx + 2, jawB - tl, w3, tl + 2, 3, '#120208'); ctx.restore();
    fang(tx, w3, jawB - tl, tl + 2 * U, false);
  }
  ctx.save(); ctx.globalAlpha = 0.5;
  [0.14, 0.4, 0.62, 0.9].forEach((f, i) => {
    const dx2 = LW * f, dl = (5 + i * 2) * U;
    rect(dx2, jawT + 7 * U, 2, dl, '#cfe8f0');
    rr(dx2 - 1, jawT + 7 * U + dl, 4, 4, 2, '#e8f6fa');
  });
  ctx.restore();

  // ---------------- hero: the otter in her boat ----------------
  const hsc = 0.84 * mawH / 58;
  const hx = LW * (wide ? 0.3 : 0.44), hy = jawB - (wide ? 6 : 4) * U;
  ctx.save();                                   // a soft spotlight cone from the roof
  const coneTop = jawT + 2 * U, coneH = (hy + 4 * U) - coneTop;
  for (let i = 0; i < coneH; i++) {
    const f = i / coneH;
    const halfW = (4 + 34 * f) * U;
    ctx.globalAlpha = 0.16 * (1 - f * 0.5);
    rect(hx - halfW, coneTop + i, halfW * 2, 1, '#ffdf9a');
  }
  ctx.globalAlpha = 0.24; ctx.scale(1, 0.22);
  fillCircle(hx, (hy + 2 * U) / 0.22, 28 * U, '#ffc867');
  ctx.restore();
  ctx.save(); ctx.translate(hx, hy + 2 * hsc); ctx.scale(hsc * 1.5, hsc * 1.5); drawRowBoat(0, 0, 0, false); ctx.restore();
  drawBobble(hx - 2 * hsc, hy, 'scout', {
    sc: hsc, expr: 'wow', act: 'idle', t: 2.1,
    hat: 'ranger', gear: 'none', glove: 'rubber',
  });
  const lx2 = hx + 15 * hsc, ly2 = hy - 46 * hsc;
  rect(lx2 - 1, ly2 + 8 * hsc, 2, 10 * hsc, '#4a3320');
  rr(lx2 - 5 * hsc, ly2, 10 * hsc, 12 * hsc, 3, '#2a2018');
  rr(lx2 - 3 * hsc, ly2 + 2 * hsc, 6 * hsc, 8 * hsc, 2, '#ffd54a');
  glow(lx2, ly2 + 6 * hsc, 20 * hsc, '#ffd88a', 0.55);

  for (let k = 0; k < 46; k++) {
    const px = (k * 197) % LW, py = 20 * U + ((k * 113) % (66 * U));
    ctx.save(); ctx.globalAlpha = 0.22 + (k % 7) / 14;
    rect(px, py, (k % 5 === 0) ? 2 : 1, (k % 5 === 0) ? 2 : 1, k % 3 ? '#ffe089' : '#9ff0c0');
    ctx.restore();
  }

  // ---------------- title ----------------
  const t1 = 'BITE', t2 = 'DOWN';
  const gapW = 5;                                   // gap between the words, in scale units
  const tsc = Math.max(2, Math.round((wide ? LW * 0.42 : LW * 0.84) / (19 + gapW + 19)));
  const tw1 = textW(t1, tsc), tw2 = textW(t2, tsc);
  const gap = gapW * tsc;
  const tot = tw1 + tw2 + gap;
  const pad = Math.max(4, Math.round(tsc * 1.4));
  const plankW = tot + pad * 2, plankH = 5 * tsc + pad * 2;
  const tcx = wide ? LW * 0.66 : LW * 0.5;
  const plankX = Math.round(tcx - plankW / 2);
  const plankY = Math.round(wide ? jawT + mawH * 0.3 : LH - plankH - 7 * U);
  ctx.save(); ctx.globalAlpha = 0.6; rr(plankX + 3, plankY + 5, plankW, plankH, 6, '#000'); ctx.restore();
  rr(plankX, plankY, plankW, plankH, 6, '#1d1005');
  rr(plankX + 2, plankY + 2, plankW - 4, plankH - 4, 5, '#5c3413');
  rr(plankX + 2, plankY + 2, plankW - 4, plankH * 0.42, 5, '#74441c');
  ctx.save(); ctx.globalAlpha = 0.22;
  for (let k = 0; k < 18; k++) rect(plankX + 5 + (k * 53) % Math.max(1, plankW - 12), plankY + 4 + (k % 5) * 3, 10 + (k % 4) * 7, 1, '#241405');
  ctx.restore();
  for (let k = 0; k < 4; k++) {
    const rx2 = k % 2 ? plankX + plankW - 8 : plankX + 4, ry2 = k < 2 ? plankY + 4 : plankY + plankH - 8;
    rect(rx2, ry2, 4, 4, '#8a5f10'); rect(rx2, ry2, 2, 2, '#ffe89a');
  }
  const ty0 = plankY + pad;
  drawTextSh(t1, plankX + pad, ty0, '#ffd23f', tsc, '#2a1a06');
  drawTextSh(t2, plankX + pad + tw1 + gap, ty0, '#63d66a', tsc, '#2a1a06');
  // a bite mark chewed out of the plank's corner, for character
  ctx.save(); ctx.globalAlpha = 0.9;
  for (let k = 0; k < 3; k++) fillCircle(plankX + plankW - 6 - k * 7, plankY + plankH - 1, 4 + (k % 2) * 2, '#0a0c10');
  ctx.restore();

  const sub = 'A PRESS-YOUR-LUCK DENTAL ROGUELIKE';
  const ssc = Math.max(1, Math.min(3, Math.round(plankW / 200)));
  const sw2 = textW(sub, ssc);
  const sy2 = wide ? plankY + plankH + 3 * ssc : plankY - 12 * ssc;
  rr(tcx - sw2 / 2 - 4 * ssc, sy2 - 2 * ssc, sw2 + 8 * ssc, 9 * ssc, 2, '#1d1005');
  rr(tcx - sw2 / 2 - 3 * ssc, sy2 - ssc, sw2 + 6 * ssc, 7 * ssc, 2, '#40230c');
  drawTextCSh(sub, tcx, sy2, '#f0d8b0', ssc, '#1d1005');

  // ---------------- vignette ----------------
  ctx.save();
  for (let k = 0; k < 14; k++) {
    ctx.globalAlpha = 0.055;
    rect(0, 0, LW, 2 + k * 2, '#000'); rect(0, LH - 2 - k * 2, LW, 2 + k * 2, '#000');
    rect(0, 0, 2 + k * 3, LH, '#000'); rect(LW - 2 - k * 3, 0, 2 + k * 3, LH, '#000');
  }
  ctx.restore();

};
`;

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const pg = await b.newPage({ viewport: { width: 1500, height: 900 } });
  const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto('file:///home/user/Pk/index.html');
  await pg.waitForTimeout(800);
  await pg.evaluate(ART);

  const shots = [
    { name: 'thumbnail-630x500.png', w: 630, h: 500, s: 2 },
    { name: 'banner-1440x480.png', w: 1440, h: 480, s: 3 },
    { name: 'cover-fullart.png', w: 960, h: 540, s: 3 },
  ];
  for (const sh of shots) {
    const data = await pg.evaluate(({ w, h, s }) => {
      canvas.width = w; canvas.height = h;
      const c = canvas.getContext('2d');
      c.imageSmoothingEnabled = false;
      ctx.imageSmoothingEnabled = false;
      ctx.setTransform(s, 0, 0, s, 0, 0);
      window.drawKeyArt(w / s, h / s, {});
      return canvas.toDataURL('image/png');
    }, sh);
    fs.writeFileSync('/home/user/Pk/promo/' + sh.name, Buffer.from(data.split(',')[1], 'base64'));
    console.log('wrote', sh.name);
  }
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await b.close();
})();

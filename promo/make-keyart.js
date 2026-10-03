// Renders the store art straight out of the live game, so the promo images can
// never drift from what the game actually looks like: the real title-menu
// scene and gator, the real rangers, and the goofy title lettering the game's
// own sign uses (goofyWord, in the Luckiest Guy UI font).
//   node promo/make-keyart.js
// Writes promo/thumbnail-630x500.png and promo/banner-1440x480.png.
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = __dirname;

// ---------------------------------------------------------------- page code
const HELPERS = `
// The live title-menu scene - sunset swamp, stilt station and the real gator
// with its jaws hanging wide - at Z device pixels per game pixel, without the
// menu UI.  The page's RS must divide evenly into Z so cached layers stay crisp.
window.promoScene = function (Z, A) {
  canvas.width = W * Z; canvas.height = H * Z;
  ctx.setTransform(Z, 0, 0, Z, 0, 0); ctx.imageSmoothingEnabled = false;
  G.state = 'menu'; G.summer = false; G.boss = null; G.mut = null;
  if (!window.promoLook) {
    rollMenuLook();
    Object.assign(G.menuLook, { mut: null, round: 0, nodeType: 'small' });   // the plain swamp gator
    window.promoLook = G.menuLook;
  }
  G.menuLook = window.promoLook;
  menuGator.t = 5.236 + (A ? Math.sin(A.ph * Math.PI * 2) * 0.5 : 0);   // widest point of its breathing
  menuGator.snapped = true;
  G.dive = { t: 0 };                     // the dive branch paints the scene and skips the UI
  drawMenu(0);
  G.dive = null;
};
// the otter ranger standing on the tongue, propping the jaws open
window.promoOtter = function (x, y, sc, A) {
  const t = A ? A.t : 0.42;
  drawBobble(x, y, 'scout', { sc, act: 'cheer', expr: 'shocked', t, hat: 'ranger', gear: 'none', glove: 'rubber' });
  ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc); comicSweat(14, -50, t + 0.3); ctx.restore();
};
// a plain dark wooden strip with goofy lettering
window.promoRibbon = function (txt, cx, y, sc) {
  const w = textW(txt, sc) + 10 * sc, h = 9 * sc, x = cx - w / 2;
  ctx.save(); ctx.globalAlpha = 0.5; rr(x + sc, y + sc * 1.5, w, h, 2 * sc, '#000'); ctx.restore();
  rr(x, y, w, h, 2 * sc, '#1a0d05');
  rr(x + sc * 0.6, y + sc * 0.6, w - sc * 1.2, h - sc * 1.2, 1.6 * sc, '#6a4222');
  rect(x + 2 * sc, y + sc * 0.6, w - 4 * sc, sc, '#86582e');
  drawTextCSh(txt, cx, y + 2 * sc, '#fff4d8', sc, '#1a0d05');
};
// soft fireflies, looping cleanly over a GIF
window.promoFlies = function (x0, x1, y0, y1, ph) {
  for (let k = 0; k < 16; k++) {
    const a = ((ph || 0) + k / 16) * Math.PI * 2, bx = x0 + (k * 71 + 23) % (x1 - x0), by = y0 + (k * 43) % Math.max(1, y1 - y0);
    const on = 0.5 + 0.5 * Math.sin(a * 3);
    ctx.save(); ctx.globalAlpha = 0.25 * on; rect(bx + Math.cos(a) * 5 - 1, by + Math.sin(a * 2) * 3 - 1, 3, 3, '#f8f080');
    ctx.globalAlpha = 0.4 + 0.6 * on; rect(bx + Math.cos(a) * 5, by + Math.sin(a * 2) * 3, 1, 1, '#fffcc0'); ctx.restore();
  }
};

// ------------------------------------------------------------ THUMBNAIL ----
// 630 x 500: the goofy title over the sunset, the gator's jaws wide below and
// the otter holding them open.  Rendered at 4x (page loaded with ?rs=4) and
// halved, so every game pixel is a clean 2 x 2 block.
window.drawThumb = function (A) {
  promoScene(4, A);
  const X0 = 165, Y0 = 0, cx = X0 + 315 / 2;
  promoOtter(MENU_CROC_X + 2, 230, 1.5, A);
  promoFlies(X0, W, 60, 230, A ? A.ph : 0);
  const bob = A ? Math.sin(A.ph * Math.PI * 4) * 1.5 : 0;
  goofyWord(TITLE_WORDS, cx, 9 + bob, 34, { center: true, maxW: 296 });
  promoRibbon('A PRESS-YOUR-LUCK DENTAL ROGUELIKE', cx, 233, 1.4);
  const out = document.createElement('canvas'); out.width = 630; out.height = 500;
  const o = out.getContext('2d'); o.imageSmoothingEnabled = true; o.imageSmoothingQuality = 'high';
  o.drawImage(canvas, X0 * 4, Y0 * 4, 315 * 4, 250 * 4, 0, 0, 630, 500);
  return out;
};

// --------------------------------------------------------------- BANNER ----
// 1440 x 480: the whole menu vista in a letterbox strip - title stacked on the
// left over the sunset, the crew cheering on the dock, the otter in the jaws.
window.drawBanner = function (A) {
  promoScene(3, A);
  const Y0 = 62;
  promoOtter(MENU_CROC_X + 2, 214, 1.1, A);
  const crew = [['medic', 'love', 'bunnyears'], ['trader', 'shocked', 'wombat'], ['frog', 'happy', 'flowers']];
  crew.forEach(([k, ex, hat], i) => drawBobble(40 + i * 54, Y0 + 157, k, { sc: 0.85, act: 'cheer', expr: ex, t: (A ? A.t : 0.2) + i * 0.33, hat, gear: 'none', glove: 'bare' }));
  promoFlies(0, W, Y0 + 20, Y0 + 155, A ? A.ph : 0);
  const bob = A ? Math.sin(A.ph * Math.PI * 4) * 1.2 : 0;
  goofyWord([TITLE_WORDS[0]], 90, Y0 + 5 + bob, 33, { center: true });
  goofyWord([TITLE_WORDS[1]], 100, Y0 + 44 - bob, 33, { center: true });
  promoRibbon('A PRESS-YOUR-LUCK DENTAL ROGUELIKE', 95, Y0 + 86, 1);
  const out = document.createElement('canvas'); out.width = 1440; out.height = 480;
  out.getContext('2d').drawImage(canvas, 0, Y0 * 3, 1440, 480, 0, 0, 1440, 480);
  return out;
};
`;

// each piece of art wants the page at a particular supersample so the cached
// scene layers land on whole device pixels
const JOBS = [
  { name: 'thumbnail-630x500.png', rs: 4, fn: 'drawThumb' },
  { name: 'banner-1440x480.png', rs: 3, fn: 'drawBanner' },
];
async function openPage(b, rs, errs) {
  const pg = await b.newPage({ viewport: { width: 1500, height: 900 } });
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto('file://' + OUT.replace(/\/promo$/, '') + '/index.html' + (rs === 4 ? '?rs=4' : ''));
  await pg.waitForFunction(() => typeof UI_FONT_OK !== 'undefined' && UI_FONT_OK, null, { timeout: 10000 });
  await pg.evaluate(HELPERS);
  await pg.evaluate(() => {   // promo art gets the full wardrobe
    Object.keys(HATS).forEach(k => meta.hatOwn[k] = 1);
    Object.keys(FITS).forEach(k => meta.fitOwn[k] = 1);
  });
  return pg;
}

module.exports = { HELPERS, JOBS, openPage };
if (require.main === module) (async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errs = [];
  for (const job of JOBS) {
    const pg = await openPage(b, job.rs, errs);
    const data = await pg.evaluate(fn => window[fn]().toDataURL('image/png'), job.fn);
    fs.writeFileSync(OUT + '/' + job.name, Buffer.from(data.split(',')[1], 'base64'));
    console.log('wrote', job.name);
    await pg.close();
  }
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await b.close();
})();

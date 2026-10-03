// Animated store art: the thumbnail and banner as looping GIFs, rendered frame
// by frame out of the live game with the same compositions as make-keyart.js.
//   npm i gifenc   (once)
//   node promo/make-gifs.js
// Writes promo/thumbnail-630x500.gif and promo/banner-1440x480.gif.
const { chromium } = require('playwright');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');
const fs = require('fs');
const { JOBS, openPage } = require('./make-keyart.js');
const OUT = __dirname;

// The scene clock is frozen and only the cast moves: two hops of the rangers'
// cheer (1.25s each), the title's bob and the fireflies all close the loop.
const LOOP = 2.5, FRAMES = 30;

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errs = [];
  for (const job of JOBS) {
    const name = job.name.replace(/\.png$/, '.gif');
    const pg = await openPage(b, job.rs, errs);
    const frames = [];
    let w = 0, h = 0;
    for (let f = 0; f < FRAMES; f++) {
      const r = await pg.evaluate(({ fn, ph, t }) => {
        tNow = 40;
        const out = window[fn]({ ph, t });
        const d = out.getContext('2d').getImageData(0, 0, out.width, out.height).data;
        let s = '';
        for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000));
        return { w: out.width, h: out.height, b64: btoa(s) };
      }, { fn: job.fn, ph: f / FRAMES, t: f / FRAMES * LOOP });
      w = r.w; h = r.h;
      frames.push(new Uint8Array(Buffer.from(r.b64, 'base64')));
    }
    await pg.close();
    // one shared palette so colours never shimmer between frames
    const stride = 4 * 7, sample = [];
    [0, FRAMES / 3 | 0, 2 * FRAMES / 3 | 0].forEach(i => {
      const d = frames[i];
      for (let p = 0; p < d.length; p += stride) sample.push(d[p], d[p + 1], d[p + 2], 255);
    });
    const palette = quantize(new Uint8Array(sample), 256);
    const gif = GIFEncoder();
    const delay = Math.round(LOOP / FRAMES * 1000);
    frames.forEach((d, i) => gif.writeFrame(applyPalette(d, palette), w, h, { palette: i === 0 ? palette : undefined, delay, repeat: 0 }));
    gif.finish();
    fs.writeFileSync(OUT + '/' + name, Buffer.from(gif.bytes()));
    console.log('wrote', name, (gif.bytes().length / 1e6).toFixed(2) + 'MB');
  }
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await b.close();
})();

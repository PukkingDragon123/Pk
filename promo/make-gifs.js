// Animated store art: the thumbnail and banner as looping GIFs, rendered frame
// by frame out of the live game with the same compositions as make-keyart.js.
//   npm i gifenc   (once)
//   node promo/make-gifs.js
// Writes promo/thumbnail-630x500.gif and promo/banner-1440x480.gif.
const { chromium } = require('playwright');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');
const fs = require('fs');
const { HELPERS } = require('./make-keyart.js');
const OUT = __dirname;

// Loops are whole cycles of the character animation, so the GIF never hitches:
// the otter's hop repeats every 1.25s, a walking stride every 2*PI/5.4 s.
const JOBS = [
  { name: 'thumbnail-630x500.gif', w: 630, h: 500, loop: 2.5, frames: 30, kind: 'cover' },
  { name: 'banner-1440x480.gif', w: 1440, h: 480, loop: 2 * (2 * Math.PI / 5.4), frames: 28, kind: 'street' },
];

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const pg = await b.newPage({ viewport: { width: 1500, height: 900 } });
  const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto('file://' + OUT.replace(/\/promo$/, '') + '/index.html');
  await pg.waitForTimeout(800);
  await pg.evaluate(HELPERS);
  await pg.evaluate(() => {
    Object.keys(HATS).forEach(k => meta.hatOwn[k] = 1);
    Object.keys(FITS).forEach(k => meta.fitOwn[k] = 1);
    window.grabFrame = function () {
      const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let s = '';
      for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000));
      return btoa(s);
    };
  });

  for (const job of JOBS) {
    const frames = [];
    for (let f = 0; f < job.frames; f++) {
      const b64 = await pg.evaluate(({ j, f }) => {
        const ph = f / j.frames, t = ph * j.loop;
        window.promoAnim = { ph, t };
        tNow = 40 + t;
        if (j.kind === 'cover') {
          const off = window.grabCroc(2);
          window.drawCover(off, j.w, j.h, 2, { sx: 273, sy: 34, sw: 630, sh: 500, z: 2 });
        } else {
          canvas.width = j.w; canvas.height = j.h;
          ctx.imageSmoothingEnabled = false;
          ctx.setTransform(3, 0, 0, 3, 0, 0);
          window.drawStreet(480, 160);
        }
        return window.grabFrame();
      }, { j: job, f });
      frames.push(new Uint8Array(Buffer.from(b64, 'base64')));
    }
    // one shared palette so colours never shimmer between frames
    const stride = 4 * 7, sample = [];
    [0, job.frames / 3 | 0, 2 * job.frames / 3 | 0].forEach(i => {
      const d = frames[i];
      for (let p = 0; p < d.length; p += stride) sample.push(d[p], d[p + 1], d[p + 2], 255);
    });
    const palette = quantize(new Uint8Array(sample), 256);
    const gif = GIFEncoder();
    const delay = Math.round(job.loop / job.frames * 1000);
    frames.forEach((d, i) => {
      gif.writeFrame(applyPalette(d, palette), job.w, job.h, { palette: i === 0 ? palette : undefined, delay, repeat: 0 });
    });
    gif.finish();
    fs.writeFileSync(OUT + '/' + job.name, Buffer.from(gif.bytes()));
    console.log('wrote', job.name, (gif.bytes().length / 1e6).toFixed(2) + 'MB');
  }
  console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
  await b.close();
})();

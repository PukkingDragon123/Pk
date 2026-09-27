// The game trailer, rendered out of the live game: every frame is stepped by
// hand at 30 fps (so nothing depends on how fast this machine is) at 1920x1080
// (?rs=4), every sound the trailer makes is logged and re-rendered offline with
// the soundtrack, then the two are muxed and loudness-normalised.
//   node promo/make-trailer.js            -> promo/trailer/bite-down-trailer.mp4
//   node promo/make-trailer.js preview    -> promo/trailer/p_<t>.png stills
// Needs playwright and an ffmpeg (set FFMPEG=/path/to/ffmpeg if it is not on PATH).
// To just watch it, open index.html?trailer in a browser.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const FF = process.env.FFMPEG || 'ffmpeg';
const D = __dirname + '/trailer/', FPS = 30, GAME = 'file://' + path.resolve(__dirname, '..', 'index.html');
fs.mkdirSync(D, { recursive: true });
(async () => {
  const mode = process.argv[2] || 'all';
  if (mode === 'all') {
    const run = (...a) => new Promise((res, rej) => { const p = spawn(process.execPath, [__filename, ...a], { stdio: 'inherit' }); p.on('close', c => c ? rej(new Error(a[0] + ' failed')) : res()); });
    await run('full'); await run('audio');
    await new Promise((res, rej) => { const p = spawn(FF, ['-y', '-i', D + 'video.mp4', '-i', D + 'audio.wav', '-c:v', 'copy', '-af', 'loudnorm=I=-14:TP=-1.0:LRA=11', '-ar', '48000', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', D + 'bite-down-trailer.mp4'], { stdio: 'inherit' }); p.on('close', c => c ? rej(new Error('mux failed')) : res()); });
    console.log('wrote', D + 'bite-down-trailer.mp4');
    return;
  }
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const pg = await b.newPage({ viewport: { width: 1440, height: 810 } });
  const errs = []; pg.on('pageerror', e => errs.push('PAGEERR ' + e.message + '\n' + e.stack)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.addInitScript(() => {
    window.__raf = []; window.requestAnimationFrame = cb => { window.__raf.push(cb); return 1; };
    window.__ms = 0; window.__adv = (n) => { for (let i = 0; i < n; i++) { window.__ms += 1000 / 30; const q = window.__raf; window.__raf = []; q.forEach(cb => cb(window.__ms)); } };
  });
  await pg.goto(GAME + (mode === 'full' ? '?rs=4' : ''));
  await pg.waitForTimeout(500);
  const grab = () => pg.evaluate(() => document.querySelector('canvas').toDataURL('image/png').slice(22));
  if (mode === 'preview') {
    const T = (process.argv[3] || '1,3,5,6.5,8,10,12,13.5,15,18,22,25,27,29,32,35,38,41,44,47,50,53,55,57.5,60,63,66,70,73.5,75,77').split(',').map(Number);
    await pg.evaluate(() => { TR_LOG = []; startTrailer(); });
    let cur = 0;
    for (const t of T) {
      const n = Math.round((t - cur) * FPS); if (n > 0) await pg.evaluate(n => window.__adv(n), n); cur = t;
      fs.writeFileSync(D + 'p_' + t + '.png', Buffer.from(await grab(), 'base64'));
    }
    console.log('shot at end:', await pg.evaluate(() => TR ? TR.shots[TR.i].id + ' ' + G.state : 'done'));
  } else if (mode === 'full') {
    const total = await pg.evaluate(() => { TR_LOG = []; startTrailer(); return TR.shots[TR.shots.length - 1].t1; });
    const N = Math.ceil(total * FPS);
    const ff = spawn(FF, ['-y', '-f', 'image2pipe', '-framerate', '' + FPS, '-c:v', 'png', '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-tune', 'animation', '-pix_fmt', 'yuv420p', D + 'video.mp4'], { stdio: ['pipe', 'ignore', 'pipe'] });
    let ferr = ''; ff.stderr.on('data', d => { ferr = (ferr + d).slice(-2000); });
    const t0 = Date.now();
    for (let f = 0; f < N; f++) {
      await pg.evaluate(() => window.__adv(1));
      const buf = Buffer.from(await grab(), 'base64');
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (f % 150 === 0) console.log('frame', f, '/', N, ((Date.now() - t0) / 1000).toFixed(0) + 's');
    }
    ff.stdin.end();
    await new Promise(r => ff.on('close', r));
    const log = await pg.evaluate(() => JSON.stringify({ total: TR ? TR.shots[TR.shots.length - 1].t1 : 0, log: TR_LOG }));
    fs.writeFileSync(D + 'log.json', log);
    console.log('video done', ((Date.now() - t0) / 1000).toFixed(0) + 's', ferr.split('\n').slice(-3).join(' | '));
  } else if (mode === 'audio') {
    const { total, log } = JSON.parse(fs.readFileSync(D + 'log.json', 'utf8'));
    const dur = Math.max(total, 82) + 0.5;
    const b64 = await pg.evaluate(async ([log, dur]) => {
      const SR = 44100, off = new OfflineAudioContext(2, Math.ceil(SR * dur), SR);
      let fakeT = 0;
      const prox = new Proxy(off, { get(t, p) { if (p === 'currentTime') return fakeT; const v = t[p]; return typeof v === 'function' ? v.bind(t) : v; } });
      AC = prox; musBus = null; musicSong = null; musicNext = 0; musicStep = 0; muted = false;
      TR_LOG = null; TR = null; meta.set.sfx = 2; meta.set.mus = 2;
      TR_GAIN = ac => trGainAt(ac.currentTime);
      // the logged sound effects, each at its moment
      log.forEach(e => { fakeT = e[1]; if (e[0] === 0) tone(e[2], e[3], e[4], e[5], e[6], e[7]); else noiseHit(e[2], e[3], e[4], e[5]); });
      // the score, cue by cue
      let last;
      for (fakeT = 0; fakeT < dur - 0.3; fakeT += 0.02) { const sg = trSongAt(fakeT); if (sg !== last) { last = sg; if (!sg) musicSong = null; } TR_SONG = sg; musicTick(); }
      TR_SONG = undefined; TR_GAIN = null;
      const buf = await off.startRendering(), L = buf.getChannelData(0), R = buf.getChannelData(1);
      let peak = 0; for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
      const norm = peak > 0.98 ? 0.98 / peak : 1;
      const n = L.length, out = new DataView(new ArrayBuffer(44 + n * 4));
      const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
      w(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); w(8, 'WAVE'); w(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true); out.setUint32(24, SR, true); out.setUint32(28, SR * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * 4, true);
      for (let i = 0; i < n; i++) { out.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i] * norm)) * 32767, true); out.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i] * norm)) * 32767, true); }
      let s = ''; const u8 = new Uint8Array(out.buffer); for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return peak.toFixed(3) + '|' + btoa(s);
    }, [log, dur]);
    const [peak, data] = b64.split('|');
    fs.writeFileSync(D + 'audio.wav', Buffer.from(data, 'base64'));
    console.log('audio peak', peak, 'events', log.length);
  }
  console.log('ERRORS:', errs.length ? errs.slice(0, 5).join('\n') : 'none');
  await b.close();
})();

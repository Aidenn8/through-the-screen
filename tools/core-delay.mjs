#!/usr/bin/env node
// Camera delay measurement, end to end in headless Chrome with fake media.
//
// No real camera: getUserMedia returns a canvas stream (a virtual camera)
// whose brightness follows the app's flash screen D ms late, plus sensor
// noise. The app's own measurement (App.measureDelay) runs unchanged. The
// virtual camera adds its own fixed delivery delay, so the check is that the
// measured delay moves one for one with D.
//
// Usage: node tools/core-delay.mjs [--delays 30,90]

import { launch, watch, BASE } from './core-browser.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const DELAYS = arg('delays', '30,90').split(',').map(Number);

const results = [];
for (const D of DELAYS) {
  const { browser, context } = await launch({});
  await context.addInitScript((delay) => {
    try { localStorage.setItem('window-display:settings:v1', JSON.stringify({ inputMode: 'camera', started: true, cameraPreset: 'builtin-notch', motionVersion: 2, ipdIrisMm: 63 })); } catch { /* ignore */ }
    // Virtual camera: sees the flash screen `delay` ms late.
    const history = [{ t: 0, white: false }];
    const watchFlash = () => {
      const el = document.querySelector('.flash');
      if (el) {
        const white = !el.hidden && el.style.background.includes('255');
        if (white !== history.at(-1).white) history.push({ t: performance.now(), white });
      }
      requestAnimationFrame(watchFlash);
    };
    requestAnimationFrame(watchFlash);
    navigator.mediaDevices.getUserMedia = async () => {
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = 180;
      const ctx = c.getContext('2d');
      const stream = c.captureStream(0);
      const track = stream.getVideoTracks()[0];
      const draw = () => {
        const t = performance.now() - delay;
        let white = false;
        for (const h of history) if (h.t <= t) white = h.white;
        const v = (white ? 170 : 40) + Math.round((Math.random() - 0.5) * 4);
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(0, 0, c.width, c.height);
        track.requestFrame();
      };
      setInterval(draw, 1000 / 30);
      return stream;
    };
  }, D);
  const page = await context.newPage();
  const log = watch(page);
  await page.goto(`${BASE}?e2e&autostart=camera&scene=test-room`);
  await page.waitForFunction(() => window.__wd?.app?.tracker?.state === 'running', null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(async () => {
    const app = window.__wd.app;
    const est = await app.measureDelay();
    return { est, saved: app.cameraDelay(), text: document.querySelector('.card:not([hidden]) .lead')?.textContent };
  });
  results.push({ D, ...r });
  console.log(`virtual camera ${D} ms late: measured ${r.est?.delayMs?.toFixed(1)} ms (±${r.est?.spreadMs?.toFixed(1)}, ${r.est?.n} flashes), saved ${r.saved} ms`);
  console.log(`  card: "${r.text}"`);
  const errs = log.filter((l) => /pageerror|\[error\]/.test(l) && !/XNNPACK/.test(l));
  if (errs.length) console.log(`  errors: ${errs.slice(0, 3).join(' | ')}`);
  await browser.close();
}
if (results.length >= 2) {
  const a = results[0];
  const b = results.at(-1);
  const slope = (b.est.delayMs - a.est.delayMs) / (b.D - a.D);
  const ok = Math.abs(slope - 1) < 0.2;
  console.log(`${ok ? 'pass' : 'FAIL'}  measured change ${(b.est.delayMs - a.est.delayMs).toFixed(1)} ms for a ${b.D - a.D} ms change (slope ${slope.toFixed(2)})`);
  process.exitCode = ok ? 0 : 1;
}

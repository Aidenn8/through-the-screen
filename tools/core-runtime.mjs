#!/usr/bin/env node
// The app's frame loop in a real browser, the cases unit tests cannot reach:
//
// - a fresh start shows the Soundstage first;
// - Box rebuilds for a new window size in metres while the pixel buffer stays
//   the same (two card measurements in a row; page zoom in full screen does
//   the same) and keeps drawing;
// - a scene that throws while drawing does not stop the loop: the status pill
//   says so, the error is logged once, and it clears when drawing works again;
// - a lost WebGL context shows a message, and the scene comes back on restore.
//
// Mouse input; the camera is not used.
//
//   node tools/core-runtime.mjs [--port 5190]
//
// Prints pass/FAIL per check; exits 1 on any failure.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const PORT = Number(arg('port', 5190));

const server = await createServer({
  root,
  configFile: resolve(root, 'tools', 'core-vite.config.mjs'),
  logLevel: 'error',
  server: { port: PORT, strictPort: true, host: '127.0.0.1' },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  channel: 'chromium',
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});

let failed = 0;
const check = (name, ok, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`);
};

try {
  const context = await browser.newContext({ viewport: { width: 1710, height: 1107 }, deviceScaleFactor: 2, screen: { width: 1710, height: 1107 } });
  const page = await context.newPage();
  const log = [];
  page.on('console', (m) => log.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', (e) => log.push({ type: 'pageerror', text: e.message }));
  const app = (fn, a) => page.evaluate(fn, a);
  const ready = () => page.waitForFunction(() => {
    const a = window.__wd?.app;
    return a?.host?.current && !a.hidden && !a.host.loading;
  }, null, { timeout: 60000 });
  const status = () => app(() => document.querySelector('.status .label')?.textContent ?? document.querySelector('[data-tone]')?.textContent);
  const ticks = () => app(() => window.__wd.app.ticks);
  // Mean brightness of the middle of the canvas, read right after the app draws.
  const brightness = () => app(() => new Promise((res) => requestAnimationFrame(() => {
    const gl = window.__wd.app.renderer.getContext();
    const w = 64;
    const x = Math.floor(gl.drawingBufferWidth / 2 - w / 2);
    const y = Math.floor(gl.drawingBufferHeight / 2 - w / 2);
    const px = new Uint8Array(w * w * 4);
    gl.readPixels(x, y, w, w, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let s = 0;
    for (let i = 0; i < px.length; i += 4) s += px[i] + px[i + 1] + px[i + 2];
    res(+(s / (w * w * 3)).toFixed(2));
  })));

  // 1. First scene on a fresh start.
  await page.goto(`http://127.0.0.1:${PORT}/?e2e&autostart=mouse&reset`, { waitUntil: 'load' });
  await ready();
  check('fresh start shows the Soundstage first', (await app(() => window.__wd.app.host.current.id)) === 'soundstage');

  // 2. Box rebuilt at the same pixel buffer.
  await app(() => window.__wd.app.loadScene('box'));
  await page.waitForFunction(() => window.__wd.app.host.current?.id === 'box' && !window.__wd.app.hidden, null, { timeout: 60000 });
  const buf = () => app(() => [window.__wd.app.renderer.domElement.width, window.__wd.app.renderer.domElement.height]);
  await app(() => window.__wd.app.change({ display: 'custom', customDisplay: { widthMm: 330, heightMm: 213.6 } }));
  await page.waitForTimeout(800);
  const b1 = await buf();
  const n0 = log.length;
  const t0 = await ticks();
  await app(() => window.__wd.app.change({ display: 'custom', customDisplay: { widthMm: 327, heightMm: 211.7 } }));
  await page.waitForTimeout(1000);
  const b2 = await buf();
  const errs = log.slice(n0).filter((l) => l.type === 'pageerror' || l.type === 'error');
  const hazeSized = await app(() => !!window.__wd.app.host.current.inst.debug.haze.output);
  check('Box rebuilt at the same buffer keeps drawing', b1.join() === b2.join() && errs.length === 0 && hazeSized && (await ticks()) - t0 > 30,
    { buffer: b2, errors: errs.slice(0, 2).map((e) => e.text), hazeSized });
  check('Box draws a picture after the rebuild', (await brightness()) > 1);
  await app(() => window.__wd.app.change({ display: 'mba15-m2' }));
  await page.waitForTimeout(800);

  // 3. A scene that throws while drawing.
  await app(() => {
    const inst = window.__wd.app.host.current.inst;
    inst.__render = inst.render;
    inst.render = () => { throw new Error('test: the scene broke'); };
  });
  const n1 = log.length;
  const t1 = await ticks();
  await page.waitForTimeout(1000);
  const logged = log.slice(n1).filter((l) => l.text.includes('test: the scene broke'));
  const s1 = await status();
  const dockShown = await app(() => !document.body.classList.contains('idle'));
  check('a throwing scene leaves the loop running', (await ticks()) - t1 > 30, { frames: (await ticks()) - t1 });
  check('the status pill says the scene stopped drawing', s1 === 'The scene stopped drawing' && dockShown, { status: s1, dockShown });
  check('the error is logged once, not every frame', logged.length === 1 && logged[0].type === 'error', { logged: logged.length });
  await app(() => {
    const inst = window.__wd.app.host.current.inst;
    inst.render = inst.__render;
  });
  await page.waitForTimeout(3500);
  check('the pill clears once drawing works again', (await status()) !== 'The scene stopped drawing', { status: await status() });

  // 4. Lost and restored WebGL context.
  const before = await brightness();
  await app(() => window.__wd.app.renderer.forceContextLoss());
  await page.waitForTimeout(500);
  const lost = await app(() => ({ notice: !document.getElementById('notice').hidden, text: document.getElementById('notice').textContent }));
  check('a lost context shows a message', lost.notice && /graphics stopped/i.test(lost.text) && (await status()) === 'Graphics stopped', lost);
  const n2 = log.length;
  await app(() => window.__wd.app.renderer.forceContextRestore());
  await page.waitForFunction(() => !window.__wd.app.contextLost, null, { timeout: 10000 });
  await ready();
  await page.waitForTimeout(800);
  const after = await brightness();
  const restoredErrs = log.slice(n2).filter((l) => l.type === 'pageerror' || l.type === 'error');
  const noticeGone = await app(() => document.getElementById('notice').hidden);
  check('the scene comes back when the context is restored', noticeGone && after > 1 && restoredErrs.length === 0,
    { brightnessBefore: before, brightnessAfter: after, errors: restoredErrs.slice(0, 2).map((e) => e.text) });
  const pageErrors = log.filter((l) => l.type === 'pageerror');
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).map((e) => e.text));
} catch (e) {
  check('run', false, e.message);
} finally {
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 10000))]);
  await server.close();
}
console.log(failed ? `app runtime: ${failed} FAILED` : 'app runtime: ok');
process.exit(failed ? 1 : 0);

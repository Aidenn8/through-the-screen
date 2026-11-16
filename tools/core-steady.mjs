#!/usr/bin/env node
// Steady check memory: hold each step of the steady check for a while and
// watch live geometries and textures (three's renderer.info.memory) and the
// JS heap (after a forced garbage collection). All three must stay flat.
// Then resize the window during the check (the markers are rebuilt for the
// new size) and close it: the check's 4x multisampled target must be freed
// and GPU memory must return to what it was before the check opened.
// Mouse input; the camera is not used.
//
//   node tools/core-steady.mjs [--seconds 60] [--steps 0-6] [--port 5192] [--scene soundstage]
//
// Prints one JSON line per sample and a verdict; exits 1 on growth.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const SECONDS = Number(arg('seconds', 60));
const PORT = Number(arg('port', 5192));
const SCENE = arg('scene', 'soundstage');
const [s0, s1] = String(arg('steps', '0-6')).split('-').map(Number);
const STEPS = [];
for (let i = s0; i <= (Number.isFinite(s1) ? s1 : s0); i++) STEPS.push(i);
const SAMPLE_S = Math.min(5, SECONDS);
const HEAP_SLACK_MB = 4; // allowed heap growth over one step

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
  args: [
    '--enable-gpu', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  ],
});
const failures = [];
try {
  const context = await browser.newContext({ viewport: { width: 1710, height: 1107 }, deviceScaleFactor: 2, screen: { width: 1710, height: 1107 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const within = (p, ms, what) => Promise.race([p, new Promise((_, j) => setTimeout(() => j(new Error(`page stopped answering: ${what}`)), ms))]);
  const ev = (fn, a, what = 'evaluate') => within(page.evaluate(fn, a), 20000, what);
  const mem = () => ev(() => {
    window.gc?.();
    const a = window.__wd.app;
    const m = a.renderer.info.memory;
    return { geometries: m.geometries, textures: m.textures, heapMB: +(performance.memory.usedJSHeapSize / 1e6).toFixed(1), frames: a.ticks };
  }, null, 'memory');

  await page.goto(`http://127.0.0.1:${PORT}/?e2e&autostart=mouse&reset&scene=${SCENE}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__wd?.app?.host?.current && !window.__wd.app.hidden, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const before = await mem();
  console.log(JSON.stringify({ phase: 'before the check', ...before }));
  await page.keyboard.press('c');
  await page.waitForTimeout(500);

  for (const step of STEPS) {
    await ev((i) => window.__wd.app.steadyPanel.go(i), step, 'go to step');
    await page.waitForTimeout(500);
    const rows = [await mem()];
    const tStart = Date.now();
    while (Date.now() - tStart < SECONDS * 1000 - 1) {
      await page.waitForTimeout(Math.min(SAMPLE_S * 1000, SECONDS * 1000 - (Date.now() - tStart)));
      const r = await mem();
      rows.push(r);
      console.log(JSON.stringify({ step: step + 1, s: Math.round((Date.now() - tStart) / 1000), ...r }));
    }
    const range = (k) => Math.max(...rows.map((r) => r[k])) - Math.min(...rows.map((r) => r[k]));
    const heapGrowth = +(rows.at(-1).heapMB - rows[0].heapMB).toFixed(1);
    const fps = +((rows.at(-1).frames - rows[0].frames) / ((Date.now() - tStart) / 1000)).toFixed(1);
    const ok = range('geometries') === 0 && range('textures') === 0 && heapGrowth < HEAP_SLACK_MB && fps > 20;
    const view = await ev(() => window.__wd.app.steady.view, null, 'view');
    console.log(`step ${step + 1} (${view}), ${SECONDS} s: geometries ${rows[0].geometries} -> ${rows.at(-1).geometries}, textures ${rows[0].textures} -> ${rows.at(-1).textures}, heap ${rows[0].heapMB} -> ${rows.at(-1).heapMB} MB, ${fps} fps ${ok ? 'ok' : 'GROWS'}`);
    if (!ok) failures.push(`step ${step + 1}`);
  }

  // A new window size rebuilds the markers: the old ones must be freed.
  await ev(() => window.__wd.app.steadyPanel.go(0), null, 'go to step');
  await page.waitForTimeout(500);
  const r0 = await mem();
  for (const w of [1500, 1600, 1710]) {
    await page.setViewportSize({ width: w, height: 1107 });
    await page.waitForTimeout(600);
  }
  const r1 = await mem();
  const resizeOk = r1.geometries === r0.geometries && r1.textures <= r0.textures;
  console.log(`resizes during the check: geometries ${r0.geometries} -> ${r1.geometries}, textures ${r0.textures} -> ${r1.textures} ${resizeOk ? 'ok' : 'GROWS'}`);
  if (!resizeOk) failures.push('resize');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
  const after = await mem();
  const msaaFreed = await ev(() => window.__wd.app.msaa.target === null && !window.__wd.app.steady.inst, null, 'msaa');
  const closeOk = msaaFreed && after.geometries <= before.geometries && after.textures <= before.textures;
  console.log(`closed: geometries ${before.geometries} -> ${after.geometries}, textures ${before.textures} -> ${after.textures}, heap ${before.heapMB} -> ${after.heapMB} MB, check target freed: ${msaaFreed} ${closeOk ? 'ok' : 'KEPT'}`);
  if (!closeOk) failures.push('close');
  if (errors.length) {
    console.log(`page errors:\n  ${errors.slice(0, 5).join('\n  ')}`);
    failures.push('page errors');
  }
} catch (e) {
  console.log(`FAILED: ${e.message}`);
  failures.push(e.message);
} finally {
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 10000))]);
  await server.close();
}
console.log(failures.length ? `steady check memory: FAIL (${failures.join(', ')})` : 'steady check memory: ok');
process.exit(failures.length ? 1 : 0);

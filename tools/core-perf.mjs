#!/usr/bin/env node
// Render smoothness per scene at the 15-inch Air's full resolution (1710 x 1107
// points at 2x = 3420 x 2214 pixels), with face tracking running on a fake
// webcam. Reports frame-interval percentiles from the app's own loop.
//
// Usage: node tools/core-perf.mjs [--video face.y4m] [--seconds 10] [--scenes a,b]

import { launch, watch, BASE } from './core-browser.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const VIDEO = arg('video');
const SECONDS = Number(arg('seconds', 10));

const { browser, context } = await launch({ video: VIDEO });
await context.addInitScript(() => {
  try {
    localStorage.setItem('window-display:settings:v1', JSON.stringify({ inputMode: 'camera', started: true, cameraPreset: 'builtin-notch' }));
  } catch { /* ignore */ }
});
const page = await context.newPage();
const log = watch(page);
await page.goto(`${BASE}?e2e&autostart=camera&scene=test-room`);
await page.waitForFunction(() => window.__wd?.app?.tracker?.state === 'running', null, { timeout: 30000 });
const ids = arg('scenes') ? arg('scenes').split(',') : await page.evaluate(() => window.__wd.app.scenes.map((s) => s.id).concat('test-room'));
const seen = new Set();
for (const id of ids) {
  if (seen.has(id)) continue;
  seen.add(id);
  if (id === 'test-room' && !(await page.evaluate(() => window.__wd.app.scenes.some((s) => s.id === 'test-room')))) {
    await page.goto(`${BASE}?e2e&autostart=camera&scene=test-room`);
    await page.waitForFunction(() => window.__wd?.app?.tracker?.state === 'running', null, { timeout: 30000 });
  }
  await page.evaluate((s) => window.__wd.app.loadScene(s), id);
  await page.waitForTimeout(2500); // shaders compile, caches warm
  await page.evaluate(() => { const a = window.__wd.app; a.perf.deltas = []; a.perf.work = []; });
  await page.waitForTimeout(SECONDS * 1000);
  const r = await page.evaluate(() => {
    const a = window.__wd.app;
    return { scene: a.host.current?.id, perf: a.perfSummary(), dpr: a.renderer.getPixelRatio(), size: a.canvasSize, hz: a.tracker.stats.hz };
  });
  const p = r.perf;
  console.log(`${String(r.scene).padEnd(12)} ${r.size[0] * r.dpr}x${r.size[1] * r.dpr}px: ${p.fps.toFixed(1)} fps, interval p50 ${p.p50.toFixed(1)} p95 ${p.p95.toFixed(1)} p99 ${p.p99.toFixed(1)} max ${p.max.toFixed(1)} ms, ${p.over20ms}/${p.frames} over 20 ms; loop JS p99 ${p.workP99.toFixed(2)} ms; tracking ${r.hz?.toFixed(1)} Hz`);
}
const errors = log.filter((l) => /pageerror|\[error\]/.test(l) && !/XNNPACK/.test(l));
if (errors.length) console.log(errors.slice(0, 8).join('\n'));
await browser.close();

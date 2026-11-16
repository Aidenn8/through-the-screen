#!/usr/bin/env node
// Does a heavy scene starve the face tracker? Default settings (adaptive
// resolution on), 15-inch Air geometry (1710 x 1107 points at 2x), fake webcam.
// Per scene: let the app settle, then measure render rate, tracking results
// per second, inference time, capture-to-result latency and the pixel ratio
// the app chose.
//
// Usage: node tools/core-starve.mjs --video face.y4m [--scenes box,soundstage]
//          [--settle 14] [--seconds 8] [--dpr 1.5 (fixed, for comparison)]
//          [--hog N (N busy workers in the page: CPU load from outside the app)]

import { launch, watch, BASE } from './core-browser.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const VIDEO = arg('video');
const SCENES = arg('scenes', 'box,soundstage,test-room').split(',');
const SETTLE = Number(arg('settle', 14));
const SECONDS = Number(arg('seconds', 8));
const DPR = arg('dpr');
const HOG = Number(arg('hog', 0));

let worst = Infinity;
for (const scene of SCENES) {
  const { browser, context } = await launch({ video: VIDEO });
  await context.addInitScript(() => {
    try { localStorage.setItem('window-display:settings:v1', JSON.stringify({ inputMode: 'camera', started: true, cameraPreset: 'builtin-notch', motionVersion: 2 })); } catch { /* ignore */ }
  });
  if (HOG) {
    await context.addInitScript((n) => {
      const src = URL.createObjectURL(new Blob(['for (;;) { Math.sqrt(Math.random()); }'], { type: 'text/javascript' }));
      for (let i = 0; i < n; i++) new Worker(src);
    }, HOG);
  }
  const page = await context.newPage();
  const log = watch(page);
  await page.goto(`${BASE}?e2e&autostart=camera&scene=${scene}${DPR ? `&dpr=${DPR}` : ''}`);
  await page.waitForFunction(() => window.__wd?.app?.tracker?.state === 'running', null, { timeout: 60000 });
  await page.waitForTimeout(SETTLE * 1000);
  const s0 = await page.evaluate(() => ({ ...window.__wd.app.tracker.stats, t: performance.now() }));
  await page.evaluate(() => { const a = window.__wd.app; a.perf.deltas = []; a.perf.work = []; });
  await page.waitForTimeout(SECONDS * 1000);
  const r = await page.evaluate(() => {
    const a = window.__wd.app;
    return { s: { ...a.tracker.stats, t: performance.now() }, perf: a.perfSummary(), dpr: a.renderer.getPixelRatio(), scene: a.host.current?.id, buf: [a.renderer.domElement.width, a.renderer.domElement.height] };
  });
  const dt = (r.s.t - s0.t) / 1000;
  const results = (r.s.results - s0.results) / dt;
  const frames = (r.s.framesIn - s0.framesIn) / dt;
  worst = Math.min(worst, results);
  const steps = log.filter((l) => /Rendering at/.test(l)).map((l) => l.replace(/^\[\w+\] /, ''));
  console.log(`${String(r.scene).padEnd(11)} pixel ratio ${r.dpr} (${r.buf.join(' x ')}): render ${r.perf.fps.toFixed(1)} fps, ${r.perf.over20ms} frames > 20 ms | camera ${frames.toFixed(1)}/s, tracking ${results.toFixed(1)} Hz, skipped busy ${r.s.dropped - s0.dropped} | inference ${r.s.inferMs?.toFixed(1)} ms, capture->result ${r.s.latencyMs?.toFixed(1)} ms`);
  for (const l of steps) console.log(`            ${l}`);
  await browser.close();
}
console.log(`lowest tracking rate: ${worst.toFixed(1)} Hz`);

#!/usr/bin/env node
// End-to-end tracking test in headless Chrome with a fake webcam.
//
// Plays a synthetic face video (tools/core-facegen.mjs) as the camera, runs the
// real app (worker landmarker, eye solve, filter, predictor, render loop), and
// compares against ground truth. Each video frame carries a barcode with its
// frame number, read from the same frame the tracker processes.
//
// Usage: node tools/core-e2e.mjs --video face.y4m --truth face.truth.json
//          [--variant worker:CPU:2] [--seconds 40] [--ipd truth|auto] [--out log.json]

import { readFileSync, writeFileSync } from 'node:fs';
import { launch, watch, BASE } from './core-browser.mjs';
import { analyse, report } from './core-e2e-analyse.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const VIDEO = arg('video');
const TRUTH = arg('truth');
const VARIANT = arg('variant', 'worker:CPU:2');
const SECONDS = Number(arg('seconds', 40));
const IPD = arg('ipd', 'truth');
const OUT = arg('out');
const EXTRA = arg('settings', '{}');

const truth = JSON.parse(readFileSync(TRUTH, 'utf8'));
const [mode, delegate, faces] = VARIANT.split(':');
const settings = {
  inputMode: 'camera', started: true, scene: 'test-room', eyeMode: 'one', eye: 'right', autoEye: true,
  // The fake camera's label is a file path; pin the preset the clip was rendered with.
  cameraPreset: 'builtin-notch', fovOverride: { 'builtin-notch': truth.hfovDeg },
  // The fake camera stamps frames when they are made: no hidden sensor delay.
  cameraDelayMs: 0,
  ...(IPD === 'truth' ? { ipdMm: truth.ipd * 1000, ipdManual: true } : {}),
  ...JSON.parse(EXTRA),
};

const { browser, context } = await launch({ video: VIDEO });
await context.addInitScript((s) => {
  try { localStorage.setItem('window-display:settings:v1', JSON.stringify(s)); } catch { /* ignore */ }
}, settings);
const page = await context.newPage();
const log = watch(page);
await page.goto(`${BASE}?e2e&autostart=camera&tracker=${mode}&delegate=${delegate}&faces=${faces}&scene=test-room`);
await page.waitForFunction(() => window.__wd?.app?.tracker?.state === 'running', null, { timeout: 30000 });

await page.evaluate(() => {
  const app = window.__wd.app;
  const tr = app.tracker;
  // Barcode reader: 17 cells of 12 px along the bottom-left edge.
  const c = document.createElement('canvas');
  c.width = 220;
  c.height = 12;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  tr.probe = (video) => {
    const H = video.videoHeight;
    ctx.drawImage(video, 0, H - 24, 220, 12, 0, 0, 220, 12);
    const px = ctx.getImageData(0, 0, 220, 12).data;
    const lum = (k) => { const x = 8 + k * 12 + 6; const i = (6 * 220 + x) * 4; return px[i]; };
    if (lum(0) < 128) return null;
    let id = 0;
    for (let k = 1; k <= 16; k++) if (lum(k) > 128) id |= 1 << (k - 1);
    return id;
  };
  const v = (p) => (p ? { x: p.x, y: p.y, z: p.z } : null);
  window.__log = { results: [], frames: [] };
  tr.onResult((r) => {
    window.__log.results.push({
      tag: r.tag, t: r.t, arrived: r.arrived, faces: r.faces, inferMs: r.inferMs, mode: r.mode,
      eye: v(r.eyeCamera), right: v(r.sol?.right), left: v(r.sol?.left), centre: v(r.sol?.centre),
      sinYaw: r.sol?.sinYaw, irisDistance: r.sol?.irisDistance, distance: r.sol?.distance, ipdUsed: r.ipdUsed,
      open: r.obs ? [r.obs.left.open, r.obs.right.open] : null,
      px: r.obs ? {
        r: [r.obs.right.u, r.obs.right.v], l: [r.obs.left.u, r.obs.left.v],
        ri: [r.obs.right.irisPx.x, r.obs.right.irisPx.y], li: [r.obs.left.irisPx.x, r.obs.left.irisPx.y],
        rd: r.obs.right.irisDiamPx, ld: r.obs.left.irisDiamPx,
      } : null,
      intr: r.intr ? { fx: r.intr.fx, cx: r.intr.cx, cy: r.intr.cy } : null,
    });
  });
  app.frameHook = (t, tShow, eye) => window.__log.frames.push({ t, tShow, eye: v(eye), state: tr.eyes.state });
  app.perf.deltas = [];
  app.perf.work = [];
});

await page.waitForTimeout(SECONDS * 1000);
const data = await page.evaluate(() => {
  const app = window.__wd.app;
  const cfg = app.trackerConfig();
  return {
    log: window.__log,
    camPos: cfg.camPos,
    stats: app.tracker.stats,
    landmarker: app.tracker.landmarkerInfo,
    perf: app.perfSummary(),
    ipdMeasured: app.tracker.ipd.measured,
  };
});
await browser.close();
const errors = log.filter((l) => /pageerror|\[error\]/.test(l) && !/XNNPACK/.test(l));
if (errors.length) console.log(errors.slice(0, 10).join('\n'));
data.variant = VARIANT;
data.settings = settings;
if (OUT) writeFileSync(OUT, JSON.stringify(data));
const a = analyse(data, truth);
console.log(report(a));

// Pass/fail: generous bounds that catch real regressions on this machine.
const checks = [
  ['face found in > 95 % of frames', a.facesFound > 0.95],
  ['tracking > 20 Hz', a.trackHz > 20],
  ['capture to result median < 60 ms', a.latency.median < 60],
  ['raw lateral error (still) < 5 mm RMS', Math.hypot(a.raw.still.rms.x, a.raw.still.rms.y) < 5],
  ['raw depth error (still) < 5 % of distance', Math.abs(a.raw.still.bias.z) < 30],
  ['rendered still jitter < 0.3 mm std (x, y)', a.rendered.still.std.x < 0.3 && a.rendered.still.std.y < 0.3],
  ['rendered sway error < 15 mm RMS', a.rendered.sway.rms.x < 15],
  ['render p95 frame interval < 20 ms', a.perf.p95 < 20],
];
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}
process.exitCode = failed ? 1 : 0;

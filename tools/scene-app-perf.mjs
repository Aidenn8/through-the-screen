#!/usr/bin/env node
// Scene frame rate inside the real app, with face tracking running on a fake
// webcam clip: the app's own render loop, frame statistics and adaptive
// resolution (the same measurement as tools/core-perf.mjs), served from the
// scene lab's port range, and reporting the pixel ratio the app settled on
// and why it changed.
//
//   node tools/scene-app-perf.mjs --video face.y4m [--seconds 20] [--scenes soundstage,box] [--dpr 1.684]
//
//   --dpr R   pin the pixel ratio (the app's ?dpr=), so the scene is judged
//             at that resolution instead of the one adaptive resolution picks
//
// Headless; the camera is the clip (Chromium's fake capture device), never
// the real one.

import { createServer } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, watch } from './core-browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const VIDEO = opt('video');
const SECONDS = Number(opt('seconds', 20));
const SCENES = opt('scenes', 'soundstage,box').split(',');
const DPR = opt('dpr', null);

let server = null;
for (const port of [5194, 5195, 5193]) {
  try {
    server = await createServer({ root, logLevel: 'error', server: { port, strictPort: true, host: '127.0.0.1', hmr: false } });
    await server.listen();
    server.port = port;
    break;
  } catch (e) {
    server = null;
    if (!String(e.message).includes('in use')) throw e;
  }
}
if (!server) throw new Error('ports 5193-5195 busy');
const BASE = `http://127.0.0.1:${server.port}/`;

const { browser, context } = await launch({ video: VIDEO });
try {
  await context.addInitScript(() => {
    try { localStorage.setItem('window-display:settings:v1', JSON.stringify({ inputMode: 'camera', started: true, cameraPreset: 'builtin-notch' })); } catch { /* ignore */ }
  });
  for (const id of SCENES) {
    const page = await context.newPage();
    const log = watch(page);
    await page.goto(`${BASE}?e2e&autostart=camera&scene=${id}${DPR ? `&dpr=${DPR}` : ''}`);
    await page.waitForFunction(() => window.__wd?.app?.tracker?.state === 'running', null, { timeout: 60000 });
    await page.waitForFunction((s) => window.__wd.app.host.current?.id === s, id, { timeout: 60000 });
    await page.waitForTimeout(5000); // shaders compile, caches warm, governor's first windows
    await page.evaluate(() => { const a = window.__wd.app; a.perf.deltas = []; a.perf.work = []; });
    const t0 = await page.evaluate(() => ({ results: window.__wd.app.tracker.stats.results ?? null }));
    await page.waitForTimeout(SECONDS * 1000);
    const r = await page.evaluate(() => {
      const a = window.__wd.app;
      const st = a.tracker.stats || {};
      return { scene: a.host.current?.id, perf: a.perfSummary(), dpr: a.renderer.getPixelRatio(), size: a.canvasSize, hz: st.hz, latency: st.latencyMs ?? st.captureToResultMs ?? null, buffer: [a.renderer.domElement.width, a.renderer.domElement.height] };
    });
    const p = r.perf;
    const steps = log.filter((l) => /Rendering at/.test(l)).map((l) => l.replace(/^\[\w+\] /, ''));
    console.log(`${String(r.scene).padEnd(11)} buffer ${r.buffer.join('x')} (dpr ${r.dpr.toFixed(3)}): ${p.fps.toFixed(1)} fps, interval p50 ${p.p50.toFixed(1)} p95 ${p.p95.toFixed(1)} p99 ${p.p99.toFixed(1)} max ${p.max.toFixed(1)} ms, ${p.over20ms}/${p.frames} over 20 ms (${((100 * p.over20ms) / Math.max(1, p.frames)).toFixed(2)} %); loop JS p99 ${p.workP99.toFixed(2)} ms; tracking ${r.hz?.toFixed(1)} Hz${r.latency ? `, capture->result ${r.latency.toFixed?.(1) ?? r.latency} ms` : ''}`);
    for (const s of steps) console.log(`  ${s}`);
    const errors = log.filter((l) => /pageerror|\[error\]/.test(l) && !/XNNPACK/.test(l));
    if (errors.length) console.log(errors.slice(0, 5).join('\n'));
    void t0;
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

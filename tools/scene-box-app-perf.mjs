#!/usr/bin/env node
// Frame times at every Box station inside the real app, with face tracking
// running on a fake webcam clip (never the real camera): the app glides to
// each station with its own goToStation, settles, then its frame statistics
// are read for a while (the same measure as tools/scene-app-perf.mjs).
//
//   node tools/scene-box-app-perf.mjs --video face.y4m [--seconds 20] [--dpr 1.684] [--stations a,b]
//
// Headless; ports 5196-5197 (waits for one when both are busy).

import { createServer } from 'vite';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { launch, watch } = await import(join(root, 'tools', 'core-browser.mjs'));
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const VIDEO = opt('video');
if (!VIDEO) throw new Error('--video face.y4m is required (a fake webcam clip)');
const SECONDS = Number(opt('seconds', 20));
const DPR = opt('dpr', '1.684');
const box = (await import(join(root, 'src', 'scenes', 'box', 'index.js'))).default;
const only = opt('stations', null);
const STATIONS = box.nav.stations.map((s) => s.id).filter((id) => !only || only.split(',').includes(id));

let server = null;
for (let tries = 0; tries < 200 && !server; tries++) {
  for (const port of [5196, 5197]) {
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
  if (!server) await new Promise((ok) => setTimeout(ok, 3000)); // both busy: wait for one
}
if (!server) throw new Error('ports 5196-5197 stayed busy');

const { browser, context } = await launch({ video: VIDEO });
const rows = [];
try {
  await context.addInitScript(() => {
    try { localStorage.setItem('window-display:settings:v1', JSON.stringify({ inputMode: 'camera', started: true, cameraPreset: 'builtin-notch' })); } catch { /* ignore */ }
  });
  const page = await context.newPage();
  const log = watch(page);
  await page.goto(`http://127.0.0.1:${server.port}/?e2e&autostart=camera&scene=box&dpr=${DPR}`);
  await page.waitForFunction(() => window.__wd?.app?.tracker?.state === 'running', null, { timeout: 60000 });
  await page.waitForFunction(() => window.__wd.app.host.current?.id === 'box', null, { timeout: 60000 });
  await page.waitForTimeout(5000);
  for (const id of STATIONS) {
    await page.evaluate((s) => window.__wd.app.goToStation(s), id);
    await page.waitForTimeout(6000); // the glide there, and settling
    const at = await page.evaluate(() => window.__wd.app.motion?.at ?? null);
    await page.evaluate(() => { const a = window.__wd.app; a.perf.deltas = []; a.perf.work = []; });
    await page.waitForTimeout(SECONDS * 1000);
    const r = await page.evaluate(() => {
      const a = window.__wd.app;
      const st = a.tracker.stats || {};
      return { perf: a.perfSummary(), dpr: a.renderer.getPixelRatio(), hz: st.hz, buffer: [a.renderer.domElement.width, a.renderer.domElement.height] };
    });
    const p = r.perf;
    rows.push({ id, at, ...r });
    console.log(`${id.padEnd(9)} (at ${at}) buffer ${r.buffer.join('x')} dpr ${r.dpr.toFixed(3)}: ${p.fps.toFixed(1)} fps, interval p50 ${p.p50.toFixed(1)} p95 ${p.p95.toFixed(1)} p99 ${p.p99.toFixed(1)} max ${p.max.toFixed(1)} ms, ${p.over20ms}/${p.frames} over 20 ms (${((100 * p.over20ms) / Math.max(1, p.frames)).toFixed(2)} %); loop JS p99 ${p.workP99.toFixed(2)} ms; tracking ${r.hz?.toFixed(1)} Hz`);
  }
  const errors = log.filter((l) => /pageerror|\[error\]/.test(l) && !/XNNPACK/.test(l));
  if (errors.length) console.log(errors.slice(0, 5).join('\n'));
  const steps = log.filter((l) => /Rendering at/.test(l));
  for (const s of steps) console.log(`  ${s}`);
} finally {
  await browser.close();
  await server.close();
}

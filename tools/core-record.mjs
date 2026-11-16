#!/usr/bin/env node
// Headless check of the details panel's "Record tracking log": runs the app
// with a fake camera (Chrome's built-in test pattern, or --video clip.y4m),
// clicks the button, waits for the 20 s recording, catches the download and
// checks it: a normal download (no new window or tab), numbers only (no
// pictures, no face mesh), the fields tools/core-motion.mjs --replay reads.
// Then replays it. Starts and stops its own server (port 5191).
//
// Usage: node tools/core-record.mjs [--video clip.y4m] [--out log.json]

import { createServer } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, watch } from './core-browser.mjs';
import { loadRecorded, scoreRecorded, appTrack } from './core-motion.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const OUT = resolve(arg('out', join(root, 'out', 'tracking-log.json')));
const PORT = 5191;

const server = await createServer({ configFile: join(root, 'tools', 'core-vite.config.mjs'), root, logLevel: 'error', server: { port: PORT, strictPort: true, host: '127.0.0.1', hmr: false } });
await server.listen();
const { browser, context } = await launch({ video: arg('video', null) });
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'pass' : 'FAIL'}  ${what}`); if (!ok) failed++; };
try {
  await context.addInitScript(() => {
    try {
      localStorage.setItem('window-display:settings:v1', JSON.stringify({
        inputMode: 'camera', started: true, scene: 'test-room', hud: true, ipdManual: true, ipdMm: 63, cameraPreset: 'builtin-notch',
      }));
    } catch { /* ignore */ }
  });
  const page = await context.newPage();
  const log = watch(page);
  await page.goto(`http://127.0.0.1:${PORT}/?autostart=camera&scene=test-room&e2e`);
  await page.waitForFunction(() => window.__wd?.app?.tracker?.state === 'running', null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const btn = page.getByRole('button', { name: 'Record tracking log' });
  check(await btn.isVisible(), 'details panel shows "Record tracking log"');
  const hint = await page.locator('.hud-record .hint').textContent();
  check(/numbers only/.test(hint) && /no pictures/.test(hint), `it says what it records: "${hint}"`);
  const downloading = page.waitForEvent('download', { timeout: 40000 });
  const t0 = Date.now();
  await btn.click();
  await page.waitForTimeout(1000);
  check(/Recording/.test(await page.locator('.hud-record button').textContent()), 'the button counts down while recording');
  const dl = await downloading;
  await dl.saveAs(OUT);
  check(Math.abs((Date.now() - t0) / 1000 - 20) < 3, `downloaded after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  check(context.pages().length === 1, `no window or tab opened (${context.pages().length} page)`);
  check(/^window-tracking-\d{8}-\d{6}\.json$/.test(dl.suggestedFilename()), `file name ${dl.suggestedFilename()}`);
  const text = readFileSync(OUT, 'utf8');
  const d = JSON.parse(text);
  check(d.kind === 'window-display tracking log' && d.version === 1, 'kind and version');
  check(!/landmarks|data:image|base64/i.test(text), 'no face mesh, no pictures');
  check(d.frames.length > 900 && d.samples.length > 200, `${d.frames.length} frames, ${d.samples.length} samples`);
  check(d.samples.every((s) => s.length === d.sampleFields.length) && d.frames.every((f) => f.length === d.frameFields.length), 'every row matches its field list');
  check(d.settings && d.settings.view && d.settings.motion && Number.isFinite(d.settings.cameraDelayMs), 'settings snapshot');
  check(d.camera && d.viewport && d.camPos, 'camera, viewport and camera position');
  console.log(`  ${(text.length / 1024).toFixed(0)} KB, ${d.samples.filter((s) => s[3] > 0).length} samples with a face, camera ${d.camera.fps?.toFixed(1)} fps`);
  const rec = loadRecorded(OUT);
  check(rec && rec.frames.length === d.frames.length, 'tools/core-motion.mjs --replay reads it');
  if (rec) scoreRecorded(rec, { track: appTrack() });
  const errors = log.filter((l) => /pageerror|\[error\]/.test(l) && !/XNNPACK/.test(l));
  check(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
} finally {
  await browser.close();
  await server.close();
}
console.log(failed ? `\n${failed} check(s) failed` : `\nall checks pass; log at ${OUT}`);
process.exitCode = failed ? 1 : 0;

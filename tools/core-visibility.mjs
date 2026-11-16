#!/usr/bin/env node
// Hidden tab releases the camera, even after a quick hide / show / hide
// (the second hide lands while the camera is still starting up again).
//
// Usage: node tools/core-visibility.mjs --video face.y4m

import { launch, watch, BASE } from './core-browser.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const VIDEO = arg('video');

const { browser, context } = await launch({ video: VIDEO });
await context.addInitScript(() => {
  try { localStorage.setItem('window-display:settings:v1', JSON.stringify({ inputMode: 'camera', started: true, cameraPreset: 'builtin-notch', motionVersion: 2, ipdIrisMm: 63 })); } catch { /* ignore */ }
  // Let the test hide and show the tab.
  let hidden = false;
  Object.defineProperty(document, 'hidden', { get: () => hidden, configurable: true });
  Object.defineProperty(document, 'visibilityState', { get: () => (hidden ? 'hidden' : 'visible'), configurable: true });
  window.__setHidden = (h) => { hidden = h; document.dispatchEvent(new Event('visibilitychange')); };
});
const page = await context.newPage();
watch(page);
await page.goto(`${BASE}?e2e&autostart=camera&scene=test-room`);
await page.waitForFunction(() => window.__wd?.app?.tracker?.state === 'running', null, { timeout: 60000 });
await page.waitForTimeout(1500);
const snap = () => page.evaluate(() => {
  const tr = window.__wd.app.tracker;
  const live = [...document.querySelectorAll('video')].filter((v) => v.srcObject?.getVideoTracks().some((t) => t.readyState === 'live')).length;
  return { state: tr.state, liveTracks: live, results: tr.stats.results };
});
let failed = 0;
const check = (name, ok, s) => { if (!ok) failed++; console.log(`${ok ? 'pass' : 'FAIL'}  ${name}: ${JSON.stringify(s)}`); };

// Simple hide: camera off.
await page.evaluate(() => window.__setHidden(true));
await page.waitForTimeout(1500);
let s = await snap();
check('hidden: camera released', s.state === 'paused' && s.liveTracks === 0, s);
await page.evaluate(() => window.__setHidden(false));
await page.waitForTimeout(2500);
s = await snap();
check('shown again: tracking', s.state === 'running' && s.liveTracks === 1, s);

// Quick hide / show / hide: the last hide arrives while the camera restarts.
await page.evaluate(async () => {
  window.__setHidden(true);
  await new Promise((r) => setTimeout(r, 60));
  window.__setHidden(false);
  await new Promise((r) => setTimeout(r, 30));
  window.__setHidden(true);
});
await page.waitForTimeout(3000);
s = await snap();
check('quick hide/show/hide: camera released', s.state === 'paused' && s.liveTracks === 0, s);
await page.evaluate(() => window.__setHidden(false));
await page.waitForTimeout(2500);
const r0 = (await snap()).results;
await page.waitForTimeout(1000);
s = await snap();
check('shown again: tracking', s.state === 'running' && s.liveTracks === 1 && s.results > r0, s);
await browser.close();
process.exitCode = failed ? 1 : 0;

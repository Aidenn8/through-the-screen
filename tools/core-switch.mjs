#!/usr/bin/env node
// Scene switch smoothness with tracking on (fake webcam, headless Chrome).
// Switches between scenes and samples every animation frame: is any freeze
// visible (frame interval while the scene shows), how long is the hidden
// stall, and is the face tracked again when the new scene appears?
//
// Usage: node tools/core-switch.mjs --video face.y4m [--from box --to soundstage]

import { launch, watch, BASE } from './core-browser.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const VIDEO = arg('video');
const FROM = arg('from', 'box');
const TO = arg('to', 'soundstage');

const { browser, context } = await launch({ video: VIDEO });
await context.addInitScript(() => {
  try { localStorage.setItem('window-display:settings:v1', JSON.stringify({ inputMode: 'camera', started: true, cameraPreset: 'builtin-notch', motionVersion: 2, ipdIrisMm: 63 })); } catch { /* ignore */ }
});
const page = await context.newPage();
const log = watch(page);
await page.goto(`${BASE}?e2e&autostart=camera&scene=${FROM}`);
await page.waitForFunction(() => window.__wd?.app?.tracker?.state === 'running' && window.__wd.app.tracker.eyes.state === 'tracking', null, { timeout: 60000 });
await page.waitForTimeout(4000);
const r = await page.evaluate(async (to) => {
  const app = window.__wd.app;
  const fade = document.getElementById('fade');
  const samples = [];
  let run = true;
  let last = performance.now();
  const tick = (t) => {
    if (!run) return;
    const op = fade ? Number(getComputedStyle(fade).opacity) : 0;
    samples.push({ t, dt: t - last, op, eyes: app.tracker.eyes.state, scene: app.host.current?.id || null });
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  await new Promise((res) => setTimeout(res, 500));
  const t0 = performance.now();
  await app.loadScene(to);
  const tLoaded = performance.now();
  await new Promise((res) => setTimeout(res, 2500));
  run = false;
  const after = samples.filter((s) => s.t >= t0);
  const visible = after.filter((s) => s.op < 0.95);
  const shown = after.find((s) => s.scene === to && s.op < 0.95);
  const fullyIn = after.find((s) => s.scene === to && s.op <= 0.01);
  return {
    maxVisibleDt: Math.max(...visible.map((s) => s.dt)),
    maxDt: Math.max(...after.map((s) => s.dt)),
    loadMs: tLoaded - t0,
    showAfterMs: shown ? shown.t - t0 : null,
    fullyInAfterMs: fullyIn ? fullyIn.t - t0 : null,
    eyesWhenShown: shown?.eyes,
    stalls: app.perf.stalls?.slice(-3) ?? null,
    worstHud: app.hudWorst?.() ?? null,
  };
}, TO);
console.log(`${FROM} -> ${TO}: load ${r.loadMs.toFixed(0)} ms; longest frame while the scene is visible ${r.maxVisibleDt.toFixed(0)} ms (any frame ${r.maxDt.toFixed(0)} ms)`);
console.log(`  new scene first visible after ${r.showAfterMs?.toFixed(0)} ms, fully faded in after ${r.fullyInAfterMs?.toFixed(0) ?? '-'} ms, face ${r.eyesWhenShown} when it appeared`);
if (r.stalls) console.log(`  stalls logged: ${JSON.stringify(r.stalls)}`);
const slow = log.filter((l) => /Slow frame|stall/i.test(l));
if (slow.length) console.log(`  console: ${slow.slice(-3).join(' | ')}`);
await browser.close();

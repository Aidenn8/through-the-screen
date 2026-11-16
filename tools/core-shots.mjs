#!/usr/bin/env node
// Headless screenshots of every interface state, at the 15-inch Air's default
// 1710 x 1107 points and 2x scale.
//
// Usage: node tools/core-shots.mjs --out DIR [--video face.y4m]
// Needs the dev server (tools/core-vite.config.mjs) on WD_BASE.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { BASE } from './core-browser.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const OUT = arg('out');
const VIDEO = arg('video');
mkdirSync(OUT, { recursive: true });

const SCREEN = { width: 1710, height: 1107 };

async function open({ query = '', settings = null, deny = false, video = VIDEO, viewport = SCREEN, reducedMotion = 'no-preference' } = {}) {
  const args = ['--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist'];
  if (!deny) args.push('--use-fake-ui-for-media-stream');
  if (video) args.push(`--use-file-for-fake-video-capture=${video}`);
  const browser = await chromium.launch({ headless: true, channel: 'chromium', args });
  const context = await browser.newContext({
    viewport, screen: SCREEN, deviceScaleFactor: 2, reducedMotion,
    permissions: deny ? [] : ['camera'],
  });
  if (settings) {
    await context.addInitScript((s) => { try { localStorage.setItem('window-display:settings:v1', JSON.stringify(s)); } catch { /* */ } }, settings);
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/XNNPACK/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${BASE}?e2e${query}`);
  return { browser, page, errors };
}

const shots = [];
async function shot(page, name) {
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path });
  shots.push(path);
}

// The fake camera's label is a file path: pin the built-in camera preset.
const running = { inputMode: 'camera', started: true, scene: 'test-room', cameraPreset: 'builtin-notch' };

// 1. First run.
{
  const { browser, page, errors } = await open({ query: '&reset&scene=test-room' });
  await page.waitForSelector('.card:not([hidden])');
  await page.waitForTimeout(800);
  await shot(page, '01-first-run');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(200);
  await shot(page, '01b-first-run-focus');
  if (errors.length) console.log('first run errors:', errors);
  await browser.close();
}

// 2. Permission denied.
{
  const { browser, page, errors } = await open({ query: '&reset&scene=test-room', deny: true });
  await page.waitForSelector('.card:not([hidden])');
  await page.click('text=Use camera');
  await page.waitForSelector('text=Camera is blocked', { timeout: 15000 });
  await page.waitForTimeout(500);
  await shot(page, '02-permission-denied');
  await page.click('text=Keep using mouse');
  await page.mouse.move(1100, 400);
  await page.waitForTimeout(900);
  await shot(page, '03-mouse-mode');
  if (errors.length) console.log('denied errors:', errors.filter((e) => !/Camera unavailable/.test(e)));
  await browser.close();
}

// 3. Running in a window (not full screen): tip, dock, menu, settings, HUD, steady check, card.
{
  const { browser, page, errors } = await open({
    query: '&autostart=camera&scene=test-room',
    settings: running,
    viewport: { width: 1710, height: 1000 },
  });
  await page.waitForFunction(() => window.__wd?.app?.tracker?.state === 'running', null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.mouse.move(855, 500);
  await page.waitForTimeout(300);
  await shot(page, '04-running-windowed');
  await page.click('.dock .chip-btn');
  await page.waitForTimeout(300);
  await shot(page, '05-scene-menu');
  await page.keyboard.press('Escape');
  await page.keyboard.press('s');
  await page.waitForTimeout(500);
  await shot(page, '06-settings');
  await page.evaluate(() => { document.querySelector('.sheet').scrollTop = 10000; });
  await page.waitForTimeout(200);
  await shot(page, '06b-settings-lower');
  await page.click('.segmented button:has-text("Phone lens")');
  await page.evaluate(() => { document.querySelector('.sheet').scrollTop = 300; });
  await page.waitForTimeout(300);
  await shot(page, '06c-settings-phone');
  await page.click('.segmented button:has-text("One eye")');
  await page.keyboard.press('Escape');
  await page.keyboard.press('d');
  await page.waitForTimeout(1200);
  await shot(page, '07-details');
  await page.keyboard.press('d');
  await page.keyboard.press('c');
  await page.waitForTimeout(800);
  await shot(page, '08-steady-check');
  await page.click('.steady button:has-text("Next")');
  await page.click('.steady button:has-text("Next")');
  await page.waitForTimeout(600);
  await shot(page, '08b-steady-reflection');
  for (let i = 0; i < 5; i++) await page.click('.steady button:has-text("Next")');
  await page.click('.steady button:has-text("Done")');
  await page.keyboard.press('s');
  await page.waitForTimeout(400);
  await page.click('text=Measure with a card');
  await page.waitForTimeout(500);
  await shot(page, '09-card-calibration');
  await page.click('.cardcal button:has-text("Cancel")');
  // Idle: no input for 3 s.
  await page.waitForTimeout(3600);
  await shot(page, '10-idle');
  if (errors.length) console.log('running errors:', errors);
  await browser.close();
}

// 4. Full screen (viewport = screen), face lost (no video).
{
  const { browser, page, errors } = await open({ query: '&autostart=camera&scene=test-room', settings: running, video: null });
  await page.waitForFunction(() => window.__wd?.app?.tracker?.state === 'running', null, { timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.mouse.move(855, 600);
  await page.waitForTimeout(300);
  await shot(page, '11-fullscreen-looking');
  if (errors.length) console.log('fullscreen errors:', errors);
  await browser.close();
}

// 5. Reduced motion + first run, narrow window.
{
  const { browser, page } = await open({ query: '&reset&scene=test-room', reducedMotion: 'reduce', viewport: { width: 520, height: 800 } });
  await page.waitForSelector('.card:not([hidden])');
  await page.waitForTimeout(500);
  await shot(page, '12-narrow-first-run');
  await browser.close();
}

console.log(shots.join('\n'));

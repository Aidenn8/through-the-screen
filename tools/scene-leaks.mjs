#!/usr/bin/env node
// GPU leak check for the scenes: switch Soundstage <-> Box N times and resize
// the Box N times (each resize rebuilds its room), rendering a frame after
// every step, and compare three's renderer.info.memory (live geometries and
// textures) with the baseline. Headless Chromium on the lab ports 5193-5195.
//
//   node tools/scene-leaks.mjs [--n 3]
//
// Prints one JSON line per step and a verdict; exits 1 if memory grows.

import { chromium } from 'playwright';
import { createServer } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const N = Number(argv[argv.indexOf('--n') + 1] || 3) || 3;

// (the GPU tests run side by side and share the lab's three ports: wait
// for one to come free, up to 10 minutes)
let server = null;
for (let tries = 0; !server && tries < 200; tries++) {
  if (tries) await new Promise((ok) => setTimeout(ok, 3000));
  for (const port of [5193, 5194, 5195]) {
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
}
if (!server) throw new Error('ports 5193-5195 are all busy');

const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
let failed = false;
try {
  const context = await browser.newContext({ viewport: { width: 1710, height: 1107 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.port}/lab.html?hud=0&auto=0&scene=soundstage`);
  await page.waitForFunction(() => window.__lab && window.__lab.ready);
  await page.evaluate(() => window.__lab.ready);
  const snap = (label) => page.evaluate((label) => {
    window.__lab.renderAt(2.0);
    const m = window.__lab.renderer.info.memory;
    return { label, scene: window.__lab.state.scene, geometries: m.geometries, textures: m.textures };
  }, label);
  const rows = [];
  const base = await snap('soundstage, first load');
  rows.push(base);
  const switches = [];
  for (let i = 1; i <= N; i++) {
    await page.evaluate(() => window.__lab.load('box'));
    rows.push(await snap(`-> box #${i}`));
    await page.evaluate(() => window.__lab.load('soundstage'));
    const s = await snap(`-> soundstage #${i}`);
    rows.push(s);
    switches.push(s);
  }
  await page.evaluate(() => window.__lab.load('box'));
  const boxBase = await snap('box before resizes');
  rows.push(boxBase);
  const resizes = [];
  for (let i = 1; i <= N; i++) {
    await page.setViewportSize({ width: 1500 + 60 * i, height: 1107 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    const r = await snap(`box after resize #${i}`);
    rows.push(r);
    resizes.push(r);
  }
  for (const r of rows) console.log(JSON.stringify(r));
  const grew = (a, b) => b.geometries > a.geometries || b.textures > a.textures;
  const leakSwitch = switches.filter((s) => grew(base, s));
  const leakResize = resizes.filter((s) => grew(boxBase, s));
  failed = leakSwitch.length > 0 || leakResize.length > 0 || errors.length > 0;
  const last = switches[switches.length - 1];
  const lastR = resizes[resizes.length - 1];
  console.log(`scene switches x${N}: geometries ${base.geometries} -> ${last.geometries}, textures ${base.textures} -> ${last.textures} ${leakSwitch.length ? 'LEAK' : 'ok'}`);
  console.log(`box resizes x${N}: geometries ${boxBase.geometries} -> ${lastR.geometries}, textures ${boxBase.textures} -> ${lastR.textures} ${leakResize.length ? 'LEAK' : 'ok'}`);
  if (errors.length) console.log(`page errors:\n  ${errors.slice(0, 5).join('\n  ')}`);
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
// Which meshes show their backs: for one station and eye, the lab's voidMask
// back-face fraction with each visible mesh hidden in turn; prints the meshes
// whose hiding removes the most red pixels.
//
//   node tools/scene-backfaces.mjs --station catwalk [--eye x,y,z] [--scene soundstage] [--top 12]
//
// Headless; ports 5193-5195.

import { chromium } from 'playwright';
import { createServer } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const STATION = opt('station', null);
const EYE = (opt('eye', '0,0,0.6')).split(',').map(Number);
const SCENE = opt('scene', 'soundstage');
const TOP = Number(opt('top', 12));

let server = null;
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
if (!server) throw new Error('ports 5193-5195 are all busy');
const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1710, height: 1107 }, deviceScaleFactor: 2880 / 1710 })).newPage();
  await page.goto(`http://127.0.0.1:${server.port}/lab.html?hud=0&auto=0&scene=${SCENE}&quality=high`);
  await page.waitForFunction(() => window.__lab && window.__lab.ready);
  await page.evaluate(() => window.__lab.ready);
  const rows = await page.evaluate(({ station, eye }) => {
    const L = window.__lab;
    L.setStation(station);
    L.setEye(...eye);
    L.renderAt(2, 1 / 60);
    const base = L.voidMask().backPx;
    const meshes = [];
    L.handle.scene.traverse((o) => { if (o.isMesh && o.visible) meshes.push(o); });
    const out = [];
    for (const m of meshes) {
      m.visible = false;
      const b = L.voidMask().backPx;
      m.visible = true;
      if (b < base) out.push({ name: m.name || '(unnamed)', parent: m.parent?.name || '', removed: base - b });
    }
    out.sort((a, b) => b.removed - a.removed);
    return { base, out };
  }, { station: STATION, eye: EYE });
  console.log(`back-face pixels at ${STATION} ${EYE.join(',')}: ${rows.base}`);
  for (const r of rows.out.slice(0, TOP)) console.log(`  ${r.name}${r.parent ? ` (in ${r.parent})` : ''}: ${r.removed}`);
} finally {
  await browser.close();
  await server.close();
}

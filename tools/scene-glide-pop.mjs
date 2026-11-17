#!/usr/bin/env node
// Pops along a glide: the rig moved from one station to another in small
// equal steps (as src/core/rig-motion.js moves it: position, yaw the short
// way, pitch, log scale), each frame drawn at the same scene time, and the
// fraction of pixels whose luma changes by more than 8 between neighbouring
// frames. A region switch shows as a step that changes far more than its
// neighbours.
//
//   node tools/scene-glide-pop.mjs --from shot --to camera [--steps 40] [--scene soundstage]
//
// Headless; ports 5193-5195.

import { chromium } from 'playwright';
import { createServer } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const FROM = opt('from', 'shot');
const TO = opt('to', 'camera');
const STEPS = Number(opt('steps', 40));
const SCENE = opt('scene', 'soundstage');

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
  const rows = await page.evaluate(({ from, to, steps }) => {
    const L = window.__lab;
    const st = (id) => L.nav.stations.find((s) => s.id === id).pose;
    const a = st(from);
    const b = st(to);
    let dyaw = (b.yaw - a.yaw) % 360;
    if (dyaw > 180) dyaw -= 360;
    else if (dyaw <= -180) dyaw += 360;
    const gl = L.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    let prev = null;
    const out = [];
    for (let k = 0; k <= steps; k++) {
      const u = k / steps;
      const scale = Math.exp(Math.log(a.scale) + (Math.log(b.scale) - Math.log(a.scale)) * u);
      L.setRig({ position: a.position.map((v, i) => v + (b.position[i] - v) * u), yaw: a.yaw + dyaw * u, pitch: a.pitch + (b.pitch - a.pitch) * u, scale });
      L.setEye(0, 0, 0.6);
      L.renderAt(2, 1 / 60);
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const luma = new Uint8Array(w * h);
      for (let i = 0, j = 0; i < px.length; i += 4, j++) luma[j] = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) | 0;
      if (prev) {
        let n = 0;
        for (let j = 0; j < luma.length; j++) if (Math.abs(luma[j] - prev[j]) > 8) n++;
        out.push({ k, u: +u.toFixed(3), scale: +scale.toFixed(3), changed: +(100 * n / luma.length).toFixed(2) });
      }
      prev = luma;
    }
    return out;
  }, { from: FROM, to: TO, steps: STEPS });
  for (const r of rows) console.log(`step ${String(r.k).padStart(2)} u ${r.u.toFixed(3)} scale ${r.scale.toFixed(3)}: ${r.changed.toFixed(2)} % changed`);
  const s = rows.map((r) => r.changed);
  const ratio = s.map((v, i) => v / Math.max(0.01, (s[i - 1] ?? s[i + 1]) / 2 + (s[i + 1] ?? s[i - 1]) / 2));
  const worst = ratio.indexOf(Math.max(...ratio));
  console.log(`largest step against its neighbours: step ${rows[worst].k} (scale ${rows[worst].scale}), ${rows[worst].changed} % vs neighbours, ratio ${ratio[worst].toFixed(2)}`);
} finally {
  await browser.close();
  await server.close();
}

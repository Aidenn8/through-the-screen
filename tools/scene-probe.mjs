#!/usr/bin/env node
// Ad-hoc renders through the lab: a list of rig poses and eyes, one PNG/JPEG
// each. For trying station poses and checking one thing at a time.
//
//   node tools/scene-probe.mjs --out DIR --shots shots.json [--scene soundstage] [--setup "js"]
//   shots.json: [{ "name": "a", "station": "inside" | null, "rig": {position, yaw, pitch, scale},
//                  "eye": [x, y, z] (window m, default 0,0,0.6), "t": 2, "js": "page code before the render",
//                  "crop": [x0, y0, x1, y1] (fractions of the frame), "width": 1440, "void": true, "png": true }]
//
// Headless only. Ports 5193-5195.

import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i < 0 ? def : argv[i + 1]; };
const OUT = resolve(opt('out', join(root, 'out', 'probe')));
mkdirSync(OUT, { recursive: true });
const SHOTS = JSON.parse(readFileSync(opt('shots'), 'utf8'));
const SCENE = opt('scene', 'soundstage');
const DPR = Number(opt('dpr', 2880 / 1710));
const W = Number(opt('jpeg-width', 1440));

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
  const page = await (await browser.newContext({ viewport: { width: 1710, height: 1107 }, deviceScaleFactor: DPR })).newPage();
  page.on('pageerror', (e) => console.log(`pageerror: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`${m.type()}: ${m.text()}`); });
  await page.goto(`http://127.0.0.1:${server.port}/lab.html?hud=0&auto=0&scene=${SCENE}&quality=high`);
  await page.waitForFunction(() => window.__lab && window.__lab.ready);
  await page.evaluate(() => window.__lab.ready);
  if (opt('setup')) await page.evaluate(opt('setup'));
  for (const s of SHOTS) {
    const r = await page.evaluate(async (s) => {
      const L = window.__lab;
      if (s.station !== undefined) L.setStation(s.station);
      if (s.rig) L.setRig(s.rig);
      const [x, y, z] = s.eye ?? [0, 0, 0.6];
      L.setEye(x, y, z);
      if (s.js) await (0, eval)(`(async () => { ${s.js} })()`);
      L.renderAt(s.t ?? 2, 1 / 60);
      const img = L.capture();
      const v = s.void ? L.voidMask({ image: true }) : null;
      const im = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = img; });
      // crop: [x0, y0, x1, y1] as fractions of the frame
      const [c0, c1, c2, c3] = s.crop ?? [0, 0, 1, 1];
      const sw = (c2 - c0) * im.width;
      const sh = (c3 - c1) * im.height;
      const cv = document.createElement('canvas');
      cv.width = s.width ?? 1440; cv.height = Math.round((cv.width * sh) / sw);
      cv.getContext('2d').drawImage(im, c0 * im.width, c1 * im.height, sw, sh, 0, 0, cv.width, cv.height);
      return { jpg: cv.toDataURL('image/jpeg', 0.9), png: s.png ? img : null, v, view: L.view };
    }, { width: W, ...s });
    writeFileSync(join(OUT, `${s.name}.jpg`), Buffer.from(r.jpg.split(',')[1], 'base64'));
    if (r.png) writeFileSync(join(OUT, `${s.name}.png`), Buffer.from(r.png.split(',')[1], 'base64'));
    if (r.v) {
      writeFileSync(join(OUT, `${s.name}-void.png`), Buffer.from(r.v.url.split(',')[1], 'base64'));
      console.log(`${s.name}: void ${(r.v.void * 100).toFixed(3)}% back ${(r.v.back * 100).toFixed(3)}%`);
    }
    console.log(`${s.name}: eyeWorld ${r.view.eyeWorld.map((v) => v.toFixed(4)).join(', ')} -> ${join(OUT, `${s.name}.jpg`)}`);
  }
} finally {
  await browser.close();
  await server.close();
}

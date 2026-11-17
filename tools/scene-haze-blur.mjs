#!/usr/bin/env node
// GPU check of the haze's depth-aware blur: a pixel whose depth is far from
// every tap's (a twig against a far wall) used to come out 0 / 0 = NaN, and
// the pipeline spread it into dark squares. Headless Chromium on the lab
// ports 5193-5195; nothing opens on screen.
//
//   node tools/scene-haze-blur.mjs     prints one JSON line, exits 1 on NaN

import { chromium } from 'playwright';
import { createServer } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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
let ok = false;
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // a bare page on the server's origin (the app's own page would start tracking)
  const base = `http://127.0.0.1:${server.port}`;
  await page.route(`${base}/__haze-probe.html`, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>probe</title>' }));
  await page.goto(`${base}/__haze-probe.html`);
  const res = await page.evaluate(async () => (await import('/tools/pages/haze-blur-probe.js')).run());
  const near = (v, x) => Math.abs(v - x) < 1e-3;
  ok = res.nonFinite === 0 && near(res.twig[0], 0.2) && near(res.wall[0], 0.2) && errors.length === 0;
  console.log(JSON.stringify({ ...res, errors }));
  console.log(ok ? 'haze blur ok' : 'haze blur FAILED');
} finally {
  await browser.close();
  await server.close();
}
process.exit(ok ? 0 : 1);

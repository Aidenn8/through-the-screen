#!/usr/bin/env node
// What groups of the Soundstage's meshes cost at the shot: lab throughput
// (median of three 120-frame runs on the sway path) with each group hidden.
//   node tools/scene-ablate-groups.mjs <repo root>
// Headless; port 5193.
import { chromium } from 'playwright';
import { createServer } from 'vite';
const root = process.argv[2];
const server = await createServer({ root, logLevel: 'error', server: { port: 5193, strictPort: true, host: '127.0.0.1', hmr: false } });
await server.listen();
const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1710, height: 1107 }, deviceScaleFactor: 2880 / 1710 })).newPage();
  await page.goto('http://127.0.0.1:5193/lab.html?hud=0&auto=0&scene=soundstage&quality=high');
  await page.waitForFunction(() => window.__lab && window.__lab.ready);
  await page.evaluate(() => window.__lab.ready);
  const groups = {
    none: () => false,
    interior: (n) => /^(in_|k_)/.test(n) || ['checker', 'wallIn', 'pendant', 'luan', 'pine', 'deckEdge'].includes(n),
    people: (n) => n === 'in_people' || n === 'crewPeople',
    smallProps: (n) => ['in_cup', 'in_coffee', 'in_glass', 'in_ketchup', 'in_ticket', 'in_food', 'in_fries', 'in_green', 'in_pie', 'in_pieFill', 'in_goods', 'in_ao'].includes(n),
    kitchen: (n) => /^k_/.test(n) || n === 'in_tube',
  };
  for (const [name, f] of Object.entries(groups)) {
    const r = await page.evaluate(async (src) => {
      const fn = (0, eval)(src);
      const L = window.__lab;
      const hidden = [];
      L.handle.scene.traverse((o) => { if (o.isMesh && o.visible && fn(o.name)) { o.visible = false; hidden.push(o); } });
      L.measure(20, 'sway');
      const reps = [];
      for (let i = 0; i < 3; i++) reps.push(L.measure(120, 'sway').throughput);
      const m = L.measure(30, 'sway');
      for (const o of hidden) o.visible = true;
      reps.sort((a, b) => a - b);
      return { throughput: reps[1], draws: m.draws, tris: m.triangles };
    }, f.toString());
    console.log(`${name}: throughput ${r.throughput.toFixed(2)} ms, ${r.draws} draws, ${(r.tris / 1000).toFixed(0)}k tris`);
  }
} finally {
  await browser.close();
  await server.close();
}

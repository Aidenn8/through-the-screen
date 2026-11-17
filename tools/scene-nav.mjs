#!/usr/bin/env node
// One round for a scene's stations (nav, docs/ARCHITECTURE.md "Moving the
// window"): every station rendered from the default eye and from the edges of
// the head-tracking range, each frame checked for void and back faces, boards
// per station and one of all stations, and optionally frame times per station.
//
//   node tools/scene-nav.mjs --out DIR [options]
//     --scene soundstage          (default)
//     --stations a,b,c            (default: all the scene's stations)
//     --eyes center,L45,...       (default: the nine below, then each station's
//                                 typical head moves under its view limits:
//                                 tL/tR +-10 cm sideways, tU/tD +-6 cm, tN/tF +-10 cm
//                                 in depth, at min(3x, maxStrength))
//     --steps stills,void,boards,perf,raf   (default stills,void,boards)
//     --dpr 1.684                 (the app's cap on the 15" Air)
//     --label "text"
//     --setup "js"                evaluated in the lab page after the scene loads
//     --raf-seconds 20            the real rAF loop per station (step raf)
//
// Frames are the app's buffer: 1710 x 1107 CSS points at DPR 2880/1710 =
// 2880 x 1864 pixels. "void" is the fraction of pixels showing the
// background, "back" of pixels showing the back of a one-sided surface (lab
// voidMask; glass, glow cards and rain are not counted).
//
// Headless only (Chromium new headless, GPU through ANGLE/Metal). Ports 5193-5195.

import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const OUT = resolve(opt('out', join(root, 'out', 'nav')));
mkdirSync(OUT, { recursive: true });
const SCENE = String(opt('scene', 'soundstage'));
const STEPS = new Set(String(opt('steps', 'stills,void,boards')).split(','));
const LABEL = opt('label', '') === true ? '' : opt('label', '');
const DPR = Number(opt('dpr', 2880 / 1710));
const CSS = [1710, 1107];
const T_STILL = 2.0;
// The default eye and the edges of the range the scenes are built for
// (docs/SCENES_NOTES.md, "View limits wanted"), at each station.
const NAV_EYES = {
  center: [0, 0, 0.6],
  L45: [-0.45, 0, 0.6], R45: [0.45, 0, 0.6],
  up35: [0, 0.35, 0.6], down30: [0, -0.3, 0.6],
  near35: [0, 0, 0.35], far85: [0, 0, 0.85],
  L45up: [-0.45, 0.25, 0.6], R45down: [0.45, -0.25, 0.6],
};
const EYES = opt('eyes', null) && opt('eyes') !== true
  ? Object.fromEntries(String(opt('eyes')).split(',').map((k) => [k, NAV_EYES[k]]).filter(([, v]) => v))
  : NAV_EYES;
const PORTS = [5193, 5194, 5195];

// The GPU tests run side by side and share the lab's three ports: wait for
// one to come free (up to 10 minutes) rather than fail.
async function startServer() {
  for (let tries = 0; tries < 200; tries++) {
    const s = await tryServer();
    if (s) return s;
    await new Promise((ok) => setTimeout(ok, 3000));
  }
  throw new Error('ports 5193-5195 are all busy');
}

async function tryServer() {
  for (const port of PORTS) {
    try {
      const server = await createServer({ root, logLevel: 'error', server: { port, strictPort: true, host: '127.0.0.1', hmr: false } });
      await server.listen();
      return { server, port };
    } catch (e) {
      if (!String(e.message).includes('in use')) throw e;
    }
  }
  return null;
}

const save = (p, url) => writeFileSync(p, Buffer.from(url.split(',')[1], 'base64'));

async function board(page, out, { title, cols, cellW, cells }) {
  const url = await page.evaluate(async ({ title, cols, cellW, cells }) => {
    const load = (src) => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
    const imgs = await Promise.all(cells.map((c) => load(c.src)));
    const ch = Math.round((cellW * imgs[0].height) / imgs[0].width);
    const pad = 10, head = title ? 46 : 0, lab = 30;
    const rows = Math.ceil(cells.length / cols);
    const cv = document.createElement('canvas');
    cv.width = cols * cellW + (cols + 1) * pad;
    cv.height = head + rows * (ch + lab + pad) + pad;
    const g = cv.getContext('2d');
    g.fillStyle = '#111'; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#eee'; g.font = '24px Menlo, monospace';
    if (title) g.fillText(title, pad, 32);
    g.imageSmoothingQuality = 'high';
    cells.forEach((c, i) => {
      const x = pad + (i % cols) * (cellW + pad);
      const y = head + pad + Math.floor(i / cols) * (ch + lab + pad);
      g.fillStyle = c.bad ? '#ff6a6a' : '#ccc'; g.font = '18px Menlo, monospace';
      g.fillText(c.label, x, y + 21);
      g.drawImage(imgs[i], x, y + lab, cellW, ch);
    });
    return cv.toDataURL('image/jpeg', 0.9);
  }, { title, cols, cellW, cells });
  save(out, url);
  console.log(`board -> ${out}`);
}

async function toJpeg(page, src, w = null, q = 0.9) {
  return page.evaluate(async ({ src, w, q }) => {
    const im = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
    const cv = document.createElement('canvas');
    cv.width = w ?? im.width; cv.height = Math.round((cv.width * im.height) / im.width);
    const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high';
    g.drawImage(im, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', q);
  }, { src, w, q });
}

async function main() {
  const { server, port } = await startServer();
  const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
  const report = { when: new Date().toISOString(), label: LABEL, scene: SCENE, dpr: DPR, stations: {} };
  try {
    const context = await browser.newContext({ viewport: { width: CSS[0], height: CSS[1] }, deviceScaleFactor: DPR });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
    await page.goto(`http://127.0.0.1:${port}/lab.html?hud=0&auto=0&scene=${SCENE}&quality=high`);
    await page.waitForFunction(() => window.__lab && window.__lab.ready);
    await page.evaluate(() => window.__lab.ready);
    const setupFile = opt('setup-file', null);
    const setup = setupFile && setupFile !== true ? readFileSync(setupFile, 'utf8') : opt('setup', null);
    if (setup && setup !== true) await page.evaluate(setup);
    const nav = await page.evaluate(() => window.__lab.nav && JSON.parse(JSON.stringify(window.__lab.nav)));
    if (!nav) throw new Error(`${SCENE} has no nav`);
    const only = opt('stations', null);
    const ids = only && only !== true ? String(only).split(',') : nav.stations.map((s) => s.id);
    const centres = [];
    for (const id of ids) {
      const st = nav.stations.find((s) => s.id === id);
      if (!st) { console.log(`no station ${id}`); continue; }
      const rec = (report.stations[id] = { title: st.title, pose: st.pose, eyes: {} });
      await page.evaluate((id) => window.__lab.setStation(id), id);
      const cells = [];
      // typical head moves as the rendered eye sees them at this station
      const S = Math.min(3, st.view?.maxStrength ?? 3);
      const vb = st.view?.verticalBoost ?? 1.5;
      const dz = 0.1 * (1 + (S - 1) / 2);
      const zMax = st.view?.maxEyeZ ?? 1.4;
      const typical = only && only !== true && opt('eyes', null) ? {} : {
        tL: [-0.1 * S, 0, 0.6], tR: [0.1 * S, 0, 0.6], tU: [0, 0.06 * S * vb, 0.6], tD: [0, -0.06 * S * vb, 0.6],
        tN: [0, 0, 0.6 - dz], tF: [0, 0, Math.min(0.6 + dz, zMax)],
      };
      const eyes = opt('eyes', null) && opt('eyes') !== true ? EYES : { ...EYES, ...typical };
      if (STEPS.has('stills') || STEPS.has('void')) {
        for (const [name, [x, y, z]] of Object.entries(eyes)) {
          const r = await page.evaluate(({ x, y, z, t, still, vd }) => {
            window.__lab.setView('window');
            window.__lab.setEye(x, y, z);
            window.__lab.renderAt(t);
            const luma = window.__lab.lumaStats();
            const img = still ? window.__lab.capture() : null;
            const v = vd ? window.__lab.voidMask({ image: true }) : null;
            return { img, v, luma, view: window.__lab.view };
          }, { x, y, z, t: T_STILL, still: STEPS.has('stills'), vd: STEPS.has('void') });
          const v = r.v ? { void: +r.v.void.toFixed(5), back: +r.v.back.toFixed(5) } : null;
          rec.eyes[name] = { ...(v ?? {}), luma: r.luma, eyeWorld: r.view.eyeWorld.map((q) => +q.toFixed(4)) };
          // a frame whose 90th-percentile luma is under 8 is uniform black
          const black = r.luma.p90 < 8;
          const bad = black || (v && (v.void > 0 || v.back > 0.0002));
          if (r.img) {
            if (name === 'center') save(join(OUT, `${id}-center.png`), r.img);
            const jpg = await toJpeg(page, r.img, 1440, 0.9);
            save(join(OUT, `${id}-${name}.jpg`), jpg);
            cells.push({ src: jpg, label: `${name} (${[x, y, z].map((q) => Math.round(q * 100)).join(',')})${v ? `  void ${(v.void * 100).toFixed(2)}% back ${(v.back * 100).toFixed(2)}%` : ''}`, bad });
            if (name === 'center') centres.push({ src: jpg, label: `${id}: ${st.title}`, bad });
          }
          if (bad && r.v?.url) save(join(OUT, `${id}-${name}-void.png`), r.v.url);
          console.log(`${id} ${name}: ${v ? `void ${(v.void * 100).toFixed(3)}% back ${(v.back * 100).toFixed(3)}% ` : ''}luma p10 ${r.luma.p10} p50 ${r.luma.p50} p90 ${r.luma.p90}${black ? ' BLACK' : ''}${bad ? '  <-- check' : ''}`);
        }
      }
      if (STEPS.has('boards') && cells.length) {
        await board(page, join(OUT, `board-${id}.jpg`), { title: `${SCENE} / ${st.title} (${id}): the default eye and the edges of the range ${LABEL}`, cols: 3, cellW: 960, cells });
      }
      if (STEPS.has('perf')) {
        await page.evaluate(() => window.__lab.measure(30, 'sway'));
        rec.timing = await page.evaluate(() => window.__lab.measure(240, 'sway'));
        rec.passes = await page.evaluate(() => window.__lab.passProfile(90, 'sway'));
        const m = rec.timing;
        console.log(`${id} timing @${m.buffer.join('x')}: throughput ${m.throughput.toFixed(2)} ms; synced mean ${m.mean.toFixed(2)} p95 ${m.p95.toFixed(2)} max ${m.max.toFixed(2)}; ${m.draws} draws ${(m.triangles / 1000).toFixed(0)}k tris`);
        console.log(`${id} passes: ${Object.entries(rec.passes).map(([k, v]) => `${k} ${v.mean.toFixed(2)}`).join(', ')}`);
      }
      if (STEPS.has('raf')) {
        const secs = Number(opt('raf-seconds', 20));
        await page.evaluate(() => window.__lab.rafRun(2, 'sway'));
        rec.raf = await page.evaluate((s) => window.__lab.rafRun(s, 'sway'), secs);
        const f = rec.raf;
        console.log(`${id} rAF ${secs} s: ${f.fps.toFixed(1)} fps, p50 ${f.p50.toFixed(1)} p95 ${f.p95.toFixed(1)} p99 ${f.p99.toFixed(1)} max ${f.max.toFixed(1)} ms, ${f.over20}/${f.frames} over 20 ms`);
      }
    }
    if (STEPS.has('boards') && centres.length) {
      await board(page, join(OUT, 'board-stations.jpg'), { title: `${SCENE}: every station from the default eye ${LABEL}`, cols: 3, cellW: 960, cells: centres });
    }
    report.errors = [...errors];
    if (errors.length) console.log(`page messages:\n  ${errors.slice(0, 8).join('\n  ')}`);
  } finally {
    await browser.close();
    await server.close();
  }
  const prevPath = join(OUT, 'nav.json');
  if (existsSync(prevPath)) {
    try {
      const prev = JSON.parse(readFileSync(prevPath, 'utf8'));
      for (const [id, r] of Object.entries(prev.stations ?? {})) {
        if (!report.stations[id]) report.stations[id] = r;
        else for (const k of Object.keys(r)) if (report.stations[id][k] === undefined) report.stations[id][k] = r[k];
      }
    } catch { /* fresh */ }
  }
  writeFileSync(prevPath, JSON.stringify(report, null, 1));
}

// exit when done: a dev server whose root saw file changes while it ran can
// keep the event loop alive after close (the GPU test then waits forever)
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });

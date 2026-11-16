#!/usr/bin/env node
// Headless contact sheets, head-path sequences, frame timing and the
// window-equivalence check for the scenes, rendered through lab.html at the
// true 15" MacBook Air pixel size (1440 x 932 CSS at DPR 2 = 2880 x 1864).
//
//   node tools/scene-shots.mjs [options]
//     --scenes soundstage,box   scenes to shoot (default: all)
//     --quality high|low|both   (default high)
//     --out DIR                 output folder (default: $SCENE_SHOTS or ./out/scene-shots)
//     --time 2.0                scene time for stills (s)
//     --seq sway|orbit|reveal|push   also render a frame sequence along a head path
//     --fps 12 --seconds 4      sequence sampling
//     --viewer                  also render the viewer's view (laptop in a room)
//     --measure                 frame timing along the sway path (GPU-synced)
//     --check                   window-equivalence check from several eyes
//     --crops "x,y,w,h;..."     1:1 crops (device pixels) of every still
//     --no-stills               skip the contact sheet
//     --setup "js"              evaluate in the page after the scene loads (debug toggles)
//     --only center,left        render only these eye presets
//     --eyes "name:x,y,z;..."   render these viewpoints instead (window coordinates, cm)
//     --ports 5190,5191         ports to try for the server (default 5193-5195)
//     --size panel|chrome       2880x1810 (default) or 3420x2148 device pixels
//
// Uses the GPU via Chromium's new headless mode (ANGLE Metal on Apple silicon).
// Never opens a visible window.

import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
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
const flag = (name) => argv.includes(`--${name}`);

const outDir = resolve(opt('out', process.env.SCENE_SHOTS || join(root, 'out', 'scene-shots')));
mkdirSync(outDir, { recursive: true });
const qualities = opt('quality', 'high') === 'both' ? ['high', 'low'] : [opt('quality', 'high')];
const stillTime = Number(opt('time', 2));
// Fullscreen Chrome on the 15" Air: the canvas is 326.6 x 205.1 mm below the
// notch. 'panel' renders it at the panel's own pixel width (2880 x 1810);
// 'chrome' at what Chrome allocates in the default scaled mode (1710 x 1074
// CSS px at DPR 2 = 3420 x 2148, which macOS then downsamples).
const SIZES = { panel: [1440, 905], chrome: [1710, 1074] };
const [CSS_W, CSS_H] = SIZES[opt('size', 'panel')] ?? SIZES.panel;

const PORTS = opt('ports', null) && opt('ports') !== true ? String(opt('ports')).split(',').map(Number) : [5193, 5194, 5195];

async function startServer() {
  for (const port of PORTS) {
    try {
      const server = await createServer({
        root,
        logLevel: 'error',
        server: { port, strictPort: true, host: '127.0.0.1', hmr: false },
      });
      await server.listen();
      return { server, port };
    } catch (e) {
      if (!String(e.message).includes('in use')) throw e;
    }
  }
  throw new Error(`ports ${PORTS.join(', ')} are all busy`);
}

function saveDataUrl(path, dataUrl) {
  writeFileSync(path, Buffer.from(dataUrl.split(',')[1], 'base64'));
}

// Compose labelled thumbnails into one sheet inside the page.
async function composeSheet(page, cells, { cols = 3, cellW = 960, title = '' } = {}) {
  return page.evaluate(async ({ cells, cols, cellW, title }) => {
    const load = (src) => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
    // One full-size image in memory at a time (a dozen 2880-wide stills at
    // once crashed the page).
    const first = await load(cells[0].src);
    const cellH = Math.round((cellW * first.height) / first.width);
    const pad = 8;
    const head = title ? 40 : 0;
    const lab = 26;
    const rows = Math.ceil(cells.length / cols);
    const cv = document.createElement('canvas');
    cv.width = cols * cellW + (cols + 1) * pad;
    cv.height = head + rows * (cellH + lab + pad) + pad;
    const g = cv.getContext('2d');
    g.fillStyle = '#111'; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#ddd'; g.font = '22px Menlo, monospace';
    if (title) g.fillText(title, pad, 28);
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const x = pad + (i % cols) * (cellW + pad);
      const y = head + pad + Math.floor(i / cols) * (cellH + lab + pad);
      g.fillStyle = '#ccc'; g.font = '17px Menlo, monospace';
      g.fillText(c.label, x, y + 18);
      g.drawImage(i === 0 ? first : await load(c.src), x, y + lab, cellW, cellH);
    }
    return cv.toDataURL('image/png');
  }, { cells, cols, cellW, title });
}

/** A small copy of a still for the contact sheet (full-size data URLs, a dozen at once, crash the page). */
async function thumb(page, src, w = 960) {
  return page.evaluate(async ({ src, w }) => {
    const img = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = Math.round((w * img.height) / img.width);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', 0.9);
  }, { src, w });
}

async function cropAll(page, src, rects) {
  return page.evaluate(async ({ src, rects }) => {
    const img = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
    return rects.map(([x, y, w, h]) => {
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h);
      return cv.toDataURL('image/png');
    });
  }, { src, rects });
}

async function main() {
  const { server, port } = await startServer();
  const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
  const report = { when: new Date().toISOString(), port, scenes: {} };
  try {
    const context = await browser.newContext({ viewport: { width: CSS_W, height: CSS_H }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
    const base = `http://127.0.0.1:${port}/lab.html`;

    await page.goto(`${base}?hud=0&auto=0&scene=box`);
    await page.waitForFunction(() => window.__lab && window.__lab.sceneIds);
    const all = await page.evaluate(() => window.__lab.sceneIds);
    const scenes = opt('scenes', all.join(',')).split(',');
    const gpu = await page.evaluate(() => {
      const gl = window.__lab.renderer.getContext();
      const e = gl.getExtension('WEBGL_debug_renderer_info');
      return gl.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    });
    report.gpu = gpu;
    console.log(`gpu: ${gpu}`);

    for (const id of scenes) {
      for (const quality of qualities) {
        const key = `${id}-${quality}`;
        const rec = (report.scenes[key] = {});
        errors.length = 0;
        await page.goto(`${base}?hud=0&auto=0&scene=${id}&quality=${quality}`);
        await page.waitForFunction(() => window.__lab && window.__lab.ready);
        const t0 = Date.now();
        await page.evaluate(() => window.__lab.ready);
        rec.loadMs = Date.now() - t0;
        const setup = opt('setup', null);
        if (setup && setup !== true) await page.evaluate(setup);
        let presets = await page.evaluate(() => window.__lab.presets);
        let order = ['left', 'center', 'right', 'up', 'down', 'near', 'far'];
        const eyes = opt('eyes', null);
        if (eyes && eyes !== true) {
          presets = {};
          order = [];
          for (const e of eyes.split(';')) {
            const [name, xyz] = e.split(':');
            presets[name] = xyz.split(',').map((v) => Number(v) / 100);
            order.push(name);
          }
        }

        const cells = [];
        if (!flag('no-stills')) {
          const only = opt('only', null);
          for (const name of order) {
            if (only && only !== true && !only.split(',').includes(name)) continue;
            const [x, y, z] = presets[name];
            const src = await page.evaluate(({ x, y, z, t }) => {
              window.__lab.setView('window');
              window.__lab.setEye(x, y, z);
              window.__lab.renderAt(t);
              return window.__lab.capture();
            }, { x, y, z, t: stillTime });
            saveDataUrl(join(outDir, `${key}-${name}.png`), src);
            cells.push({ src: await thumb(page, src), label: `${name}  eye (${(x * 100).toFixed(0)}, ${(y * 100).toFixed(0)}, ${(z * 100).toFixed(0)}) cm` });
            const crops = opt('crops', null);
            if (crops && crops !== true) {
              const rects = crops.split(';').map((r) => r.split(',').map(Number));
              const out = await cropAll(page, src, rects);
              out.forEach((d, i) => saveDataUrl(join(outDir, `${key}-${name}-crop${i}.png`), d));
            }
          }
          if (flag('viewer')) {
            for (const name of ['left', 'center', 'right']) {
              const [x, y, z] = presets[name];
              const src = await page.evaluate(({ x, y, z, t }) => {
                window.__lab.setView('viewer');
                window.__lab.setEye(x, y, z);
                window.__lab.renderAt(t);
                const d = window.__lab.capture();
                window.__lab.setView('window');
                return d;
              }, { x, y, z, t: stillTime });
              saveDataUrl(join(outDir, `${key}-viewer-${name}.png`), src);
              cells.push({ src, label: `viewer's view from ${name}` });
            }
          }
          const sheet = await composeSheet(page, cells, { ...(cells.length > 9 ? { cols: 4, cellW: 720 } : {}), title: `${id} [${quality}]  window 32.7 x 20.5 cm  render ${CSS_W * 2}x${CSS_H * 2}  t=${stillTime}s` });
          saveDataUrl(join(outDir, `${key}-sheet.png`), sheet);
          console.log(`${key}: sheet -> ${join(outDir, `${key}-sheet.png`)}`);
        }

        const seq = opt('seq', null);
        if (seq && seq !== true) {
          const fps = Number(opt('fps', 12));
          const seconds = Number(opt('seconds', 4));
          const n = Math.round(fps * seconds);
          const frames = [];
          const dir = join(outDir, `${key}-seq-${seq}`);
          mkdirSync(dir, { recursive: true });
          for (let i = 0; i < n; i++) {
            const t = i / fps;
            const src = await page.evaluate(({ seq, t, base }) => {
              const [x, y, z] = window.__lab.eyeOnPath(seq, t);
              window.__lab.setEye(x, y, z);
              window.__lab.renderAt(base + t, 1 / 60);
              return window.__lab.capture();
            }, { seq, t, base: stillTime });
            saveDataUrl(join(dir, `f${String(i).padStart(3, '0')}.png`), src);
            if (i % Math.max(1, Math.floor(n / 12)) === 0 && frames.length < 12) {
              // keep only a small copy for the strip (full-size frames are on disk)
              const thumb = await page.evaluate(async (src) => {
                const img = await new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.src = src; });
                const cv = document.createElement('canvas');
                cv.width = 720; cv.height = Math.round((720 * img.height) / img.width);
                cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
                return cv.toDataURL('image/png');
              }, src);
              frames.push({ src: thumb, label: `t=${t.toFixed(2)}s` });
            }
          }
          const strip = await composeSheet(page, frames, { cols: 4, cellW: 700, title: `${id} [${quality}] head path "${seq}"` });
          saveDataUrl(join(outDir, `${key}-seq-${seq}.png`), strip);
          console.log(`${key}: ${n} frames -> ${dir}`);
        }

        if (flag('measure')) {
          // Warm up (shader compiles), then measure along the sway path.
          await page.evaluate(() => window.__lab.measure(30, 'sway'));
          rec.timing = await page.evaluate(() => window.__lab.measure(240, 'sway'));
          const m = rec.timing;
          console.log(`${key}: throughput ${m.throughput.toFixed(2)} ms/frame; per-frame synced ${m.mean.toFixed(2)} ms mean, p50 ${m.p50.toFixed(2)}, p95 ${m.p95.toFixed(2)}, max ${m.max.toFixed(2)}; ${m.draws} draws, ${(m.triangles / 1000).toFixed(0)}k tris, buffer ${m.buffer.join('x')}`);
          rec.passes = await page.evaluate(() => window.__lab.passProfile(90, 'sway'));
          const parts = Object.entries(rec.passes).map(([k, v]) => `${k} ${v.mean.toFixed(2)}`).join(', ');
          if (parts) console.log(`${key}: passes (ms, synced) ${parts}`);
        }

        if (flag('check')) {
          rec.check = [];
          const eyes = [[0, 0, 0.6], [-0.25, 0, 0.6], [0.25, 0.08, 0.5], [0.1, -0.12, 0.35], [-0.15, 0.1, 0.9]];
          for (const pipeline of [false, true]) {
            for (const e of eyes) {
              const images = flag('check-images');
              const r = await page.evaluate(({ e, pipeline, images }) => window.__lab.check(e, { pipeline, images }), { e, pipeline, images });
              r.pipeline = pipeline;
              if (r.images) {
                const tag = `${key}-check-${pipeline ? 'pipe' : 'plain'}-${e.map((v) => Math.round(v * 100)).join('_')}`;
                for (const [k, v] of Object.entries(r.images)) saveDataUrl(join(outDir, `${tag}-${k}.png`), v);
                delete r.images;
              }
              rec.check.push(r);
              console.log(`${key}: check ${pipeline ? 'pipeline' : 'plain   '} eye ${e.map((v) => (v * 100).toFixed(0)).join(',')} cm  colour p50 ${r.colour.p50.toFixed(2)} p90 ${r.colour.p90.toFixed(2)} p99 ${r.colour.p99.toFixed(1)} mean ${r.colour.mean.toFixed(2)} /255  position p50 ${r.position.p50mm.toFixed(3)} mm p95 ${r.position.p95mm.toFixed(2)} mm >2mm ${(r.position.over2mm * 100).toFixed(2)}%  ${r.pass ? 'PASS' : 'FAIL'}`);
            }
          }
        }
        rec.errors = [...errors];
        if (errors.length) console.log(`${key}: page errors:\n  ${errors.slice(0, 8).join('\n  ')}`);
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  const failed = Object.values(report.scenes).some((s) => s.check && s.check.some((c) => !c.pass));
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

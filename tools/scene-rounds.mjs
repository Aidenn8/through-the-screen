#!/usr/bin/env node
// One comparison round for the scenes: the same eyes and head paths every
// round, measured with one instrument for our frames and the reference photos,
// and laid out on side-by-side boards.
//
//   node tools/scene-rounds.mjs --out DIR [options]
//     --scenes soundstage,box     (default both)
//     --steps stills,measure,boards,seq,viewer,perf   (default all but perf)
//     --refs DIR                  reference photo root (see docs/SCENES_NOTES.md)
//     --label "text"              shown on the boards
//     --dpr 1.684                 device pixel ratio (the app's cap on the 15" Air)
//     --setup "js"                evaluated in the lab page after each scene loads
//     --setup-file FILE           the same, read from a file
//     --eyeset base|extremes      the round's eyes (default base); extremes: the
//                                 range Look around 3x reaches (+-45 cm, +-25 cm
//                                 up/down, 35-85 cm, diagonals, cone corners)
//     --viewer-strength 3         viewer's clip with Look around at this strength:
//                                 the phone moves with the head, the image is
//                                 drawn from the mapped eye (default 1: true window)
//
// Frames are the app's buffer at the capped pixel ratio: 1710 x 1107 CSS points
// at DPR 2880/1710 = 2880 x 1864 pixels (window 31.7 x 20.5 cm).
//
// The instrument (measureImage below) is used unchanged for everything: sRGB
// luma (Rec. 709 weights on 8-bit values) percentiles over the frame, and per
// region mean / percentiles. Our regions come from the lab's class mask (each
// mesh drawn in a flat class colour from the same eye); reference regions are
// rectangles drawn into the same kind of mask. "Streak peak" is the maximum
// of the 9 x 9 box-filtered luma inside the region (so single hot pixels do
// not count), at an analysis width of 1600 px.
//
// Headless only (Chromium new headless, GPU through ANGLE/Metal). Ports 5193-5195.

import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { ViewMapper } from '../src/tracking/view-map.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const OUT = resolve(opt('out', join(root, 'out', 'round')));
mkdirSync(OUT, { recursive: true });
const STEPS = new Set(String(opt('steps', 'stills,measure,boards,seq,viewer')).split(','));
const SCENES = String(opt('scenes', 'soundstage,box')).split(',');
const REFS = opt('refs', null);
const LABEL = opt('label', '');
const DPR = Number(opt('dpr', 2880 / 1710));
const CSS = [1710, 1107];
const T_STILL = 2.0;
const BASE_EYES = {
  center: [0, 0, 0.6], left: [-0.25, 0, 0.6], right: [0.25, 0, 0.6],
  up: [0, 0.12, 0.6], down: [0, -0.12, 0.6], near: [0, 0, 0.35], far: [0, 0, 0.9],
  left15: [-0.15, 0, 0.6],
};
// The range Look around reaches at 3x from a 60 cm seat (15 cm lean = 45 cm),
// and the corners of the cone in src/tracking/view-map.js.
const EXTREME_EYES = {
  center: [0, 0, 0.6],
  L45: [-0.45, 0, 0.6], R45: [0.45, 0, 0.6], L30: [-0.3, 0, 0.6], R30: [0.3, 0, 0.6],
  up25: [0, 0.25, 0.6], down25: [0, -0.25, 0.6], up35: [0, 0.35, 0.6], down30: [0, -0.3, 0.6],
  near35: [0, 0, 0.35], far85: [0, 0, 0.85],
  L45up: [-0.45, 0.25, 0.6], R45up: [0.45, 0.25, 0.6], L45down: [-0.45, -0.25, 0.6], R45down: [0.45, -0.25, 0.6],
  L45near: [-0.45, 0, 0.45], R45near: [0.45, 0, 0.45], L35near35: [-0.35, 0, 0.35], R35near35: [0.35, 0, 0.35],
  R45upfar: [0.45, 0.25, 0.85], L45downnear: [-0.4, -0.22, 0.4],
  // head tilt on top of position: up to +-45 cm vertical
  up45: [0, 0.45, 0.6], down45: [0, -0.45, 0.6], L45down45: [-0.45, -0.45, 0.6], R45up45: [0.45, 0.45, 0.6],
};
const EYESET = String(opt('eyeset', 'base'));
const EYES = EYESET === 'extremes' ? EXTREME_EYES : BASE_EYES;
const VIEWER_G = Number(opt('viewer-strength', 1));
const PORTS = [5193, 5194, 5195];

// ------------------------------------------------------------- reference regions
// Rectangles in fractions of width/height, on the reference photos.
const REF_SPECS = [
  { id: 'nr07', path: 'night-rain-street/nr07_mickeys_diner_neon_front.jpg', label: "nr07 Mickey's diner", rects: { interior: [0.40, 0.42, 0.14, 0.17], facade: [0.23, 0.69, 0.34, 0.14], sidewalk: [0.57, 0.9, 0.2, 0.08], sky: [0.75, 0.05, 0.2, 0.1] } },
  { id: 'nr06', path: 'night-rain-street/nr06_wet_asphalt_long_reflections.jpg', label: 'nr06 wet asphalt', rects: { street: [0.0, 0.62, 1.0, 0.38], roadBase: [0.02, 0.86, 0.22, 0.13], sky: [0.3, 0.05, 0.4, 0.1] } },
  { id: 'nr05', path: 'night-rain-street/nr05_barclays_rain_neon_reflections.jpg', label: 'nr05 neon rain', rects: { street: [0.0, 0.72, 1.0, 0.28] } },
  { id: 'nr04', path: 'night-rain-street/nr04_streetlamp_backlit_rain.jpg', label: 'nr04 backlit rain cone', rects: {} },
  { id: 'nr01', path: 'night-rain-street/nr01_aquaman_rain_machine_night.jpg', label: 'nr01 rain rig cone', rects: {} },
  { id: 'ss01', path: 'soundstage-bts/ss01_parenthood_stage44_set_backs.jpg', label: 'ss01 flat backs, drape', rects: { flatBack: [0.25, 0.22, 0.1, 0.15], stageFloor: [0.05, 0.88, 0.15, 0.08], grid: [0.3, 0.01, 0.3, 0.05] } },
  { id: 'ss04', path: 'soundstage-bts/ss04_wissen_macht_ah_tv_studio.jpg', label: 'ss04 set 3-4 stops over stage', rects: {} },
  { id: 'ss05', path: 'soundstage-bts/ss05_vienna_opera_backstage.jpg', label: 'ss05 fly grid', rects: {} },
  { id: 'ss02', path: 'soundstage-bts/ss02_parenthood_livingroom_grid.jpg', label: 'ss02 grid over set', rects: {} },
  { id: 'fb01', path: 'flat-backs/fb01_set_wall_braces_cinderblocks.jpg', label: 'fb01 jacks, cinder blocks', rects: {} },
  { id: 'gg01', path: 'grip-gear/gg01_softboxes_flags_setup.jpg', label: 'gg01 softboxes, flags', rects: {} },
  { id: 'gg05', path: 'grip-gear/gg05_night_exterior_hmis_frames_dtla.jpg', label: 'gg05 night rig', rects: {} },
  { id: 'mi05', path: 'miniatures/mi05_nicks_luncheonette_real_vs_model.jpg', label: 'mi05 real vs 1/12 model', rects: {} },
  { id: 'mi06', path: 'miniatures/mi06_nicks_luncheonette_model.jpg', label: 'mi06 model texture density', rects: {} },
  { id: 'rb01', path: 'room-box/rb01_matton_hotel_hall_sunbeam.jpg', label: 'rb01 Matton: one hard sun', rects: { wallShadow: [0.52, 0.2, 0.05, 0.25], sunPatch: [0.32, 0.77, 0.12, 0.05], window: [0.24, 0.3, 0.04, 0.17] } },
  { id: 'rb02', path: 'room-box/rb02_miniature_library_box.jpg', label: 'rb02 one source, crisp patches', rects: {} },
  { id: 'rb04', path: 'room-box/rb04_todoroki_tokonoma_lantern.jpg', label: 'rb04 lit niche, dark frame', rects: { wall: [0.31, 0.4, 0.1, 0.3], frame: [0.02, 0.05, 0.2, 0.1] } },
  { id: 'rb03', path: 'room-box/rb03_tokonoma_scroll_ikebana.jpg', label: 'rb03 tokonoma dressing', rects: {} },
];

// ------------------------------------------------------------- in-page instrument
// Runs in the browser. img/mask: data URLs. classes: [{ id, color }].
// rects (instead of a mask): { id: [fx, fy, fw, fh] }.
const MEASURE_SRC = `async ({ img, mask, classes, rects }) => {
  const load = (src) => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
  const im = await load(img);
  const k = Math.min(1, 1600 / im.width);
  const W = Math.round(im.width * k), H = Math.round(im.height * k);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(im, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H).data;
  // region labels per pixel
  const lab = new Int16Array(W * H).fill(-1);
  let ids = [];
  if (mask) {
    const mi = await load(mask);
    const mc = document.createElement('canvas'); mc.width = W; mc.height = H;
    const mg = mc.getContext('2d', { willReadFrequently: true });
    mg.imageSmoothingEnabled = false;
    mg.drawImage(mi, 0, 0, W, H);
    const md = mg.getImageData(0, 0, W, H).data;
    ids = classes.map((c) => c.id);
    for (let p = 0, j = 0; p < W * H; p++, j += 4) {
      for (let c = 0; c < classes.length; c++) {
        const col = classes[c].color;
        if (Math.abs(md[j] - col[0]) < 12 && Math.abs(md[j + 1] - col[1]) < 12 && Math.abs(md[j + 2] - col[2]) < 12) { lab[p] = c; break; }
      }
    }
  } else if (rects) {
    ids = Object.keys(rects);
    ids.forEach((id, c) => {
      const [fx, fy, fw, fh] = rects[id];
      for (let y = Math.round(fy * H); y < Math.round((fy + fh) * H); y++) for (let x = Math.round(fx * W); x < Math.round((fx + fw) * W); x++) lab[y * W + x] = c;
    });
  }
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const LUT = new Float32Array(256); for (let i = 0; i < 256; i++) LUT[i] = lin(i);
  const luma = new Float32Array(W * H), lum = new Float32Array(W * H);
  for (let p = 0, j = 0; p < W * H; p++, j += 4) {
    luma[p] = 0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2];
    lum[p] = 0.2126 * LUT[d[j]] + 0.7152 * LUT[d[j + 1]] + 0.0722 * LUT[d[j + 2]];
  }
  // 9x9 box filter (summed-area table) for streak peaks
  const S = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += luma[y * W + x]; S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row; } }
  const box = (x, y, r) => { const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1); return (S[y1 * (W + 1) + x1] - S[y0 * (W + 1) + x1] - S[y1 * (W + 1) + x0] + S[y0 * (W + 1) + x0]) / ((x1 - x0) * (y1 - y0)); };
  const pct = (arr, qs) => { const a = Float32Array.from(arr).sort(); return qs.map((q) => a.length ? +a[Math.min(a.length - 1, Math.floor(q * a.length))].toFixed(1) : null); };
  const all = pct(luma, [0.01, 0.1, 0.5, 0.9, 0.99]);
  const out = { size: [im.width, im.height], p1: all[0], p10: all[1], p50: all[2], p90: all[3], p99: all[4], regions: {} };
  ids.forEach((id, c) => {
    const vals = []; let sl = 0, sy = 0, n = 0, peak = 0, sr = 0, sg = 0, sb = 0;
    for (let p = 0; p < W * H; p++) {
      if (lab[p] !== c) continue;
      vals.push(luma[p]); sy += luma[p]; sl += lum[p]; n++; sr += d[p * 4]; sg += d[p * 4 + 1]; sb += d[p * 4 + 2];
    }
    if (!n) { out.regions[id] = { frac: 0 }; return; }
    // streak peak: max of the 9x9 box mean over pixels whose whole box is in the region
    for (let y = 4; y < H - 4; y += 2) for (let x = 4; x < W - 4; x += 2) {
      const p = y * W + x;
      if (lab[p] !== c || lab[p - 4] !== c || lab[p + 4] !== c || lab[p - 4 * W] !== c || lab[p + 4 * W] !== c) continue;
      const v = box(x, y, 4); if (v > peak) peak = v;
    }
    const q = pct(vals, [0.1, 0.5, 0.9, 0.99]);
    out.regions[id] = { frac: +(n / (W * H)).toFixed(4), mean: +(sy / n).toFixed(1), p10: q[0], p50: q[1], p90: q[2], p99: q[3], lin: +(sl / n).toFixed(4), peak9: +peak.toFixed(1), rgb: [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)] };
  });
  return out;
}`;

async function startServer() {
  for (const port of PORTS) {
    try {
      const server = await createServer({ root, logLevel: 'error', server: { port, strictPort: true, host: '127.0.0.1', hmr: false } });
      await server.listen();
      return { server, port };
    } catch (e) {
      if (!String(e.message).includes('in use')) throw e;
    }
  }
  throw new Error('ports 5193-5195 are all busy');
}

const dataUrl = (p) => `data:image/${extname(p) === '.png' ? 'png' : 'jpeg'};base64,${readFileSync(p).toString('base64')}`;
const save = (p, url) => writeFileSync(p, Buffer.from(url.split(',')[1], 'base64'));

// Compose a board in the page: cells [{ src (data URL), label, crop? }].
async function board(page, out, { title, cols, cellW, cellH, cells }) {
  const url = await page.evaluate(async ({ title, cols, cellW, cellH, cells }) => {
    const load = (src) => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
    const imgs = await Promise.all(cells.map((c) => load(c.src)));
    const rects = cells.map((c, i) => c.crop ?? [0, 0, imgs[i].width, imgs[i].height]);
    const ch = cellH ?? Math.round((cellW * rects[0][3]) / rects[0][2]);
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
      g.fillStyle = '#ccc'; g.font = '18px Menlo, monospace';
      g.fillText(c.label, x, y + 21);
      const [sx, sy, sw, sh] = rects[i];
      const k = Math.min(cellW / sw, ch / sh);
      const dw = sw * k, dh = sh * k;
      g.drawImage(imgs[i], sx, sy, sw, sh, x + (cellW - dw) / 2, y + lab + (ch - dh) / 2, dw, dh);
    });
    return cv.toDataURL('image/jpeg', 0.9);
  }, { title, cols, cellW, cellH, cells });
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

const fmt = (r, k = 'mean') => (r && r.frac ? r[k] : '-');

// Frames v0000.jpg... -> VP9 WebM with Playwright's bundled ffmpeg (it has no
// pipe protocol and no image2 file demuxer, so the JPEGs go in as one
// concatenated MJPEG file through image2pipe).
function encodeClip(dir, out, n, fps) {
  const ff = ['ffmpeg-1013', 'ffmpeg-1011'].map((d) => join(homedir(), 'Library/Caches/ms-playwright', d, 'ffmpeg-mac')).find(existsSync);
  if (!ff) return;
  const cat = join(dir, 'frames.mjpeg');
  writeFileSync(cat, Buffer.concat(Array.from({ length: n }, (_, i) => readFileSync(join(dir, `v${String(i).padStart(4, '0')}.jpg`)))));
  const r = spawnSync(ff, ['-y', '-loglevel', 'error', '-framerate', String(fps), '-f', 'image2pipe', '-c:v', 'mjpeg', '-i', cat, '-c:v', 'libvpx-vp9', '-b:v', '6M', '-pix_fmt', 'yuv420p', out], { encoding: 'utf8' });
  rmSync(cat, { force: true });
  console.log(r.status === 0 ? `clip -> ${out}` : `clip encode failed: ${r.stderr}`);
}
if (opt('encode', null)) {
  // re-encode an existing frame folder: --encode DIR --to OUT.webm
  const d = opt('encode');
  encodeClip(d, opt('to'), Number(opt('frames', 360)), 30);
  process.exit(0);
}

async function main() {
  const { server, port } = await startServer();
  const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
  const report = { when: new Date().toISOString(), label: LABEL, dpr: DPR, scenes: {}, refs: {} };
  const base = `http://127.0.0.1:${port}/lab.html`;
  try {
    const context = await browser.newContext({ viewport: { width: CSS[0], height: CSS[1] }, deviceScaleFactor: DPR });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${base}?hud=0&auto=0&scene=box`);
    await page.waitForFunction(() => window.__lab && window.__lab.sceneIds);
    const measure = (args) => page.evaluate(`(${MEASURE_SRC})(${JSON.stringify(args)})`);

    // ---- references (same instrument)
    const refImg = {};
    if (REFS && REFS !== true) {
      for (const r of REF_SPECS) {
        const p = join(REFS, r.path);
        if (!existsSync(p)) continue;
        refImg[r.id] = { src: dataUrl(p), label: r.label };
        if (STEPS.has('measure')) report.refs[r.id] = await measure({ img: refImg[r.id].src, rects: r.rects });
      }
    }

    for (const id of SCENES) {
      const rec = (report.scenes[id] = { eyes: {} });
      errors.length = 0;
      await page.goto(`${base}?hud=0&auto=0&scene=${id}&quality=high${opt('url-extra', '')}`);
      await page.waitForFunction(() => window.__lab && window.__lab.ready);
      await page.evaluate(() => window.__lab.ready);
      const setupFile = opt('setup-file', null);
      const setup = setupFile && setupFile !== true ? readFileSync(setupFile, 'utf8') : opt('setup', null);
      if (setup && setup !== true) await page.evaluate(setup);
      const shots = {};
      if (STEPS.has('stills') || STEPS.has('measure') || STEPS.has('boards')) {
        const only = opt('eyes', null);
        for (const [name, [x, y, z]] of Object.entries(EYES)) {
          if (only && only !== true && !only.split(',').includes(name)) continue;
          const r = await page.evaluate(({ x, y, z, t }) => {
            window.__lab.setView('window');
            window.__lab.setEye(x, y, z);
            window.__lab.renderAt(t);
            const img = window.__lab.capture();
            const m = window.__lab.classMask();
            return { img, mask: m?.url ?? null, classes: m?.classes ?? [] };
          }, { x, y, z, t: T_STILL });
          shots[name] = r;
          save(join(OUT, `${id}-${name}.png`), r.img);
          if (r.mask) save(join(OUT, `${id}-${name}-mask.png`), r.mask);
          if (STEPS.has('measure')) rec.eyes[name] = await measure({ img: r.img, mask: r.mask, classes: r.classes });
        }
        const c = rec.eyes.center;
        if (c) {
          const R = c.regions;
          console.log(`${id} centre: p1 ${c.p1} p10 ${c.p10} p50 ${c.p50} p90 ${c.p90} | ${Object.entries(R).filter(([, v]) => v.frac > 0.002).map(([k, v]) => `${k} ${v.mean}/${v.p50} pk${v.peak9}`).join(', ')}`);
          for (const e of (EYESET === 'extremes' ? ['L45', 'R45', 'up25', 'down25', 'near35'] : ['left', 'right', 'up', 'down'])) {
            const E = rec.eyes[e];
            if (E) console.log(`${id} ${e}: p10 ${E.p10} p50 ${E.p50} | ${Object.entries(E.regions).filter(([, v]) => v.frac > 0.002).map(([k, v]) => `${k} ${v.mean} (${(v.frac * 100).toFixed(1)}%)`).join(', ')}`);
          }
        }
      }

      // ---- head-path strip (sway) and a sequence for motion checks
      if (STEPS.has('seq')) {
        const dir = join(OUT, `${id}-sway`);
        mkdirSync(dir, { recursive: true });
        const cells = [];
        for (let i = 0; i < 48; i++) {
          const t = i / 12;
          const src = await page.evaluate(({ t, base }) => {
            const [x, y, z] = window.__lab.eyeOnPath('sway', t);
            window.__lab.setEye(x, y, z);
            window.__lab.renderAt(base + t, 1 / 60);
            return window.__lab.capture();
          }, { t, base: T_STILL });
          const jpg = await toJpeg(page, src, 1440, 0.88);
          save(join(dir, `f${String(i).padStart(3, '0')}.jpg`), jpg);
          if (i % 4 === 0) cells.push({ src: jpg, label: `sway t=${t.toFixed(2)} s` });
        }
        await board(page, join(OUT, `${id}-sway-strip.jpg`), { title: `${id}: sway path (+-22 cm), every 4th frame of 12 fps ${LABEL}`, cols: 4, cellW: 720, cells });
      }

      if (STEPS.has('perf') || STEPS.has('timing')) {
        await page.evaluate(() => window.__lab.measure(30, 'sway'));
        rec.timing = await page.evaluate(() => window.__lab.measure(240, 'sway'));
        rec.passes = await page.evaluate(() => window.__lab.passProfile(90, 'sway'));
        const m = rec.timing;
        console.log(`${id} timing @${m.buffer.join('x')}: throughput ${m.throughput.toFixed(2)} ms; synced mean ${m.mean.toFixed(2)} p95 ${m.p95.toFixed(2)} max ${m.max.toFixed(2)}; ${m.draws} draws ${(m.triangles / 1000).toFixed(0)}k tris`);
        console.log(`${id} passes: ${Object.entries(rec.passes).map(([k, v]) => `${k} ${v.mean.toFixed(2)}`).join(', ')}`);
        if (STEPS.has('perf')) {
          rec.ablate = await page.evaluate((s) => window.__lab.ablate(90, 'sway', { synced: s }), !!opt('synced', false));
          console.log(`${id} ablate: ${Object.entries(rec.ablate).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')}`);
        }
      }
      rec.errors = [...errors];
      if (errors.length) console.log(`${id} page errors:\n  ${errors.slice(0, 6).join('\n  ')}`);

      // ---- boards next to the most relevant references
      if (STEPS.has('boards') && Object.keys(shots).length && EYESET === 'extremes') {
        const E = rec.eyes;
        const names = Object.keys(EXTREME_EYES).filter((e) => shots[e]);
        const lab = (e) => `${e} (${EXTREME_EYES[e].map((v) => Math.round(v * 100)).join(',')})  p10 ${E[e]?.p10 ?? '-'} p50 ${E[e]?.p50 ?? '-'}`;
        // full-size PNGs are too big to pass to the page all at once: thumbnails
        const cells = [];
        for (const e of names) cells.push({ src: await toJpeg(page, shots[e].img, 1000, 0.88), label: lab(e) });
        await board(page, join(OUT, `board-9-${id}-extremes.jpg`), {
          title: `9 ${id}: the Look around 3x range (virtual eye, window cm) ${LABEL}`,
          cols: 4, cellW: 720, cells,
        });
      }
      if (STEPS.has('boards') && shots.center && EYESET !== 'extremes') {
        const E = rec.eyes;
        const n = (e, k, f = 'mean') => fmt(E[e]?.regions?.[k], f);
        const ref = (rid, extra = '') => (refImg[rid] ? [{ src: refImg[rid].src, label: refImg[rid].label + extra }] : []);
        const rr = (rid, k, f = 'mean') => fmt(report.refs[rid]?.regions?.[k], f);
        if (id === 'soundstage') {
          await board(page, join(OUT, 'board-1-night.jpg'), {
            title: `1 Night key. OURS p10 ${E.center?.p10} p50 ${E.center?.p50}, interior ${n('center', 'interior')}, street p50 ${n('center', 'street', 'p50')}, upper facade ${n('center', 'facadeUpper')} ${LABEL}`,
            cols: 3, cellW: 1000, cellH: 646,
            cells: [{ src: shots.center.img, label: 'OURS centre (0,0,60)' }, ...ref('nr07', ` interior ${rr('nr07', 'interior')}`), ...ref('nr06', ` road ${rr('nr06', 'roadBase', 'p50')}`), ...ref('nr04'), ...ref('nr01'), ...ref('nr05')],
          });
          await board(page, join(OUT, 'board-2-wet-street.jpg'), {
            title: `2 Wet street. OURS street p50 ${n('center', 'street', 'p50')}, streak peak ${n('center', 'street', 'peak9')} | nr06 road ${rr('nr06', 'roadBase', 'p50')}, peak ${rr('nr06', 'street', 'peak9')} ${LABEL}`,
            cols: 1, cellW: 2400, cellH: 460,
            cells: [{ src: shots.center.img, label: 'OURS centre, lower third', crop: [0, 1180, 2880, 684] },
              { src: shots.left15.img, label: 'OURS lean left 15 cm, lower third', crop: [0, 1180, 2880, 684] },
              ...(refImg.nr06 ? [{ src: refImg.nr06.src, label: 'nr06 lower band', crop: [0, 760, 1920, 456] }] : []),
              ...(refImg.nr05 ? [{ src: refImg.nr05.src, label: 'nr05 lower band', crop: [0, 900, 1920, 456] }] : [])],
          });
          await board(page, join(OUT, 'board-3-reveal.jpg'), {
            title: `3 Reveal. flat backs L ${n('left', 'flatBack')} R ${n('right', 'flatBack')}, stage floor L ${n('left', 'stageFloor')}, gear L ${n('left', 'gear')} | ss01 backs ${rr('ss01', 'flatBack')} ${LABEL}`,
            cols: 3, cellW: 900, cellH: 582,
            cells: [{ src: shots.left.img, label: 'OURS lean left 25' }, ...ref('ss01'), ...ref('gg01'),
              { src: shots.right.img, label: 'OURS lean right 25' }, ...ref('fb01'), ...ref('gg05'),
              { src: shots.down.img, label: 'OURS duck 12' }, ...ref('ss02'), ...ref('ss05')],
          });
          await board(page, join(OUT, 'board-4-eyes.jpg'), {
            title: `4 Soundstage from every eye ${LABEL}`,
            cols: 4, cellW: 720,
            cells: ['left', 'left15', 'center', 'right', 'up', 'down', 'near', 'far'].map((e) => ({ src: shots[e].img, label: `${e} (${EYES[e].map((v) => Math.round(v * 100)).join(',')})  p10 ${E[e]?.p10} p50 ${E[e]?.p50}` })),
          });
          const C = shots.center.img;
          await board(page, join(OUT, 'board-5-crops-1to1.jpg'), {
            title: `5 1:1 crops (device pixels) vs miniature texture refs ${LABEL}`,
            cols: 3, cellW: 760, cellH: 560,
            cells: [{ src: C, label: 'lamp + EATS 1:1', crop: [80, 120, 760, 560] }, { src: C, label: 'DINER neon 1:1', crop: [1150, 330, 760, 560] },
              { src: C, label: 'windows 1:1', crop: [1500, 800, 760, 560] }, { src: C, label: 'street 1:1', crop: [1000, 1300, 760, 560] },
              { src: C, label: 'lower right 1:1', crop: [2100, 1300, 760, 560] }, ...ref('mi06'), ...ref('mi05')],
          });
        } else if (id === 'box') {
          const ratio = (e) => {
            const w = E[e]?.regions?.wall; const f = E[e]?.regions?.floor;
            return w && w.frac ? `${n(e, 'wall', 'p99')}/${n(e, 'wall', 'p10')} luma` : '-';
          };
          await board(page, join(OUT, 'board-6-box.jpg'), {
            title: `6 Box. wall p10 ${n('center', 'wall', 'p10')} p50 ${n('center', 'wall', 'p50')} p99 ${n('center', 'wall', 'p99')}, floor p99 ${n('center', 'floor', 'p99')} | rb01 shadow ${rr('rb01', 'wallShadow')} sun ${rr('rb01', 'sunPatch')}; rb04 wall ${rr('rb04', 'wall')} ${LABEL}`,
            cols: 3, cellW: 900, cellH: 582,
            cells: [{ src: shots.center.img, label: 'OURS centre' }, ...ref('rb01'), ...ref('rb04'),
              { src: shots.left.img, label: 'OURS lean left 25' }, ...ref('rb02'), ...ref('rb03'),
              { src: shots.right.img, label: 'OURS lean right 25' }, { src: shots.up.img, label: 'OURS up 12' }, { src: shots.near.img, label: 'OURS near 35' }],
          });
          await board(page, join(OUT, 'board-7-box-crops.jpg'), {
            title: `7 Box 1:1 crops ${LABEL}`,
            cols: 3, cellW: 760, cellH: 560,
            cells: [{ src: shots.center.img, label: 'moon window 1:1', crop: [1060, 420, 760, 560] }, { src: shots.center.img, label: 'left wall / branch 1:1', crop: [150, 500, 760, 560] },
              { src: shots.center.img, label: 'sun patch 1:1', crop: [1700, 900, 760, 560] }, { src: shots.center.img, label: 'floor 1:1', crop: [900, 1300, 760, 560] },
              { src: shots.near.img, label: 'near 35: bell 1:1', crop: [1100, 0, 760, 560] }, ...ref('rb04')],
          });
        }
      }

      // ---- viewer's view: the laptop seen from a moving eye (the X clip)
      if (STEPS.has('viewer')) {
        const dir = join(OUT, `${id}-viewer`);
        mkdirSync(dir, { recursive: true });
        const vctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 2 });
        const vp = await vctx.newPage();
        await vp.goto(`${base}?hud=0&auto=0&scene=${id}&quality=high&view=viewer`);
        await vp.waitForFunction(() => window.__lab && window.__lab.ready);
        await vp.evaluate(() => window.__lab.ready);
        if (setup && setup !== true) await vp.evaluate(setup);
        // a phone at the eye at about the 2x lens: ~32 degrees vertical in landscape
        await vp.evaluate(() => window.__lab.setViewer({ fov: 30, lookAt: [0, -0.01, 0] }));
        const fps = 30;
        const secs = Number(opt('viewer-seconds', 12));
        // head path (the phone moves with it); with --viewer-strength g the image
        // is drawn from the Look around eye at g (seat at the centre, 60 cm)
        const keys = VIEWER_G > 1
          ? [[0, 0, 0, 0.6], [1.0, 0, 0, 0.6], [3.2, -0.15, 0.004, 0.6], [4.4, -0.15, 0.004, 0.6], [7.4, 0.15, 0, 0.6], [8.6, 0.15, 0, 0.6],
            [10.0, 0, 0.083, 0.6], [11.0, 0, 0.083, 0.6], [12.6, 0, -0.083, 0.6], [13.6, 0, -0.083, 0.6], [15.0, 0, 0, 0.5], [16.0, 0, 0, 0.5], [17.5, 0, 0, 0.6], [18, 0, 0, 0.6]]
          : [[0, 0, 0, 0.6], [1.0, 0, 0, 0.6], [3.5, -0.2, 0.01, 0.58], [4.5, -0.2, 0.01, 0.58], [7.5, 0.2, 0, 0.58], [8.5, 0.2, 0, 0.58], [10, 0, -0.09, 0.6], [11, 0, -0.09, 0.6], [12, 0, 0, 0.6]];
        const vm = new ViewMapper();
        const seat = { x: 0, y: 0, z: 0.6 };
        const mapped = ([x, y, z]) => (VIEWER_G > 1 ? (({ x, y, z }) => [x, y, z])(vm.map({ x, y, z }, { direction: 'look', strength: VIEWER_G }, seat)) : [x, y, z]);
        const secsV = VIEWER_G > 1 ? Number(opt('viewer-seconds', 18)) : secs;
        const at = (t) => {
          let i = 0; while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
          const [t0, ...a] = keys[i]; const [t1, ...b] = keys[i + 1];
          let u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0))); u = u * u * (3 - 2 * u);
          return a.map((v, k) => v + (b[k] - v) * u);
        };
        const strip = [];
        for (let i = 0; i < secsV * fps; i++) {
          const t = i / fps;
          const [x, y, z] = at(t);
          const [vx, vy, vz] = mapped([x, y, z]);
          const src = await vp.evaluate(({ x, y, z, vx, vy, vz, t }) => { window.__lab.setEye(vx, vy, vz); window.__lab.setViewerEye(x, y, z); window.__lab.renderAt(t, 1 / 30); return window.__lab.renderer.domElement.toDataURL('image/jpeg', 0.9); }, { x, y, z, vx, vy, vz, t: T_STILL + t });
          save(join(dir, `v${String(i).padStart(4, '0')}.jpg`), src);
          if (i % 45 === 0) strip.push({ src, label: `t=${t.toFixed(1)} s head (${Math.round(x * 100)},${Math.round(y * 100)},${Math.round(z * 100)}) view (${Math.round(vx * 100)},${Math.round(vy * 100)},${Math.round(vz * 100)})` });
        }
        await vctx.close();
        const tag = VIEWER_G > 1 ? `-${VIEWER_G}x` : '';
        await board(page, join(OUT, `${id}-viewer${tag}-strip.jpg`), { title: `${id}: viewer's view (phone at the eye, ~2x lens)${VIEWER_G > 1 ? `, Look around ${VIEWER_G}x` : ''}, every 1.5 s ${LABEL}`, cols: 3, cellW: 960, cells: strip });
        encodeClip(dir, join(OUT, `${id}-viewer${tag}.webm`), secsV * fps, fps);
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  // merge with an earlier run into the same folder (one scene at a time keeps the other's numbers)
  const prevPath = join(OUT, 'measure.json');
  if (existsSync(prevPath)) {
    try {
      const prev = JSON.parse(readFileSync(prevPath, 'utf8'));
      // per scene and per field: a run without stills keeps the earlier eyes
      for (const [id, prevRec] of Object.entries(prev.scenes ?? {})) {
        const cur = report.scenes[id];
        if (!cur) { report.scenes[id] = prevRec; continue; }
        if (!Object.keys(cur.eyes ?? {}).length) cur.eyes = prevRec.eyes;
        for (const k of Object.keys(prevRec)) if (cur[k] === undefined) cur[k] = prevRec[k];
      }
      report.refs = { ...prev.refs, ...report.refs };
    } catch { /* start fresh */ }
  }
  writeFileSync(prevPath, JSON.stringify(report, null, 1));
  // compact reference summary
  for (const [k, v] of Object.entries(report.refs)) {
    console.log(`ref ${k}: p10 ${v.p10} p50 ${v.p50} | ${Object.entries(v.regions).map(([r, x]) => `${r} ${x.mean}/${x.p50} pk${x.peak9}`).join(', ')}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

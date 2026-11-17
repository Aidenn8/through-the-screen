#!/usr/bin/env node
// Box navigation rounds: renders every station of the Box's `nav` (and any
// extra poses) through the scene lab with the rig camera of
// docs/ARCHITECTURE.md ("Moving the window"), at a set of head-tracking eyes,
// and lays the frames out on boards; checks for void; times each station.
//
//   node tools/scene-box-nav-rounds.mjs --out DIR [options]
//     --steps shots,void,perf,room     (default shots,void)
//     --stations room,window,...       (default all)
//     --eyes C,L,R,...                 (default all head eyes below)
//     --poses FILE.json                extra poses: [{ id, title, pose }]
//     --dpr 1.684                      device pixel ratio (the app's cap)
//     --samples N                      void step: N random rig poses inside bounds and scale (default 40)
//     --corners 0                      void step: skip the bounds' corners
//     --setup "js"                     evaluated in the lab page before the steps
//
// The rig camera: the window frustum is built for eye * scale, W * scale,
// H * scale and near/far * scale, then the camera is placed at
// position + Ry(yaw) Rx(pitch) (scale * eye) with that rotation. update()
// gets view = { eyeWorld, rig }. Void: the scene drawn with flat materials
// on a magenta clear; the sky dome is magenta below y = -0.25 (a hole in
// the ground would show it); any magenta pixel is void.
//
// Headless only (Chromium new headless, GPU through ANGLE/Metal). Ports
// 5196-5197; when both are busy (GPU tests side by side) it waits for one.

import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
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
const OUT = resolve(opt('out', join(root, 'out', 'box-nav')));
mkdirSync(OUT, { recursive: true });
const STEPS = new Set(String(opt('steps', 'shots,void')).split(','));
const DPR = Number(opt('dpr', 2880 / 1710));
const CSS = [1710, 1107];
const PORTS = [5196, 5197];
const T_STILL = 2.0;

// Head eyes (window coordinates, metres): the corners of the view limits in
// src/tracking/view-map.js (x 0.5, y -0.4..0.48, z 0.2..1.4, |x| <= z, |y| <= 0.8 z).
const HEAD = {
  C: [0, 0, 0.6], L: [-0.5, 0, 0.6], R: [0.5, 0, 0.6], U: [0, 0.48, 0.6], D: [0, -0.4, 0.6],
  N: [0, 0, 0.2], F: [0, 0, 1.4], LU: [-0.5, 0.4, 0.6], RU: [0.5, 0.4, 0.6], LD: [-0.5, -0.4, 0.6], RD: [0.5, -0.4, 0.6],
  LN: [-0.3, 0, 0.3],
};
const onlyEyes = opt('eyes', null);
const EYES = Object.fromEntries(Object.entries(HEAD).filter(([k]) => !onlyEyes || onlyEyes === true || onlyEyes.split(',').includes(k)));

// Eyes at a station as the app maps them (Look around 3x by default, the
// station's view limits on top, src/tracking/view-map.js): typical head
// moves (+-10 cm lean, +-6 cm rise, +-10 cm in depth) and the extremes of
// the view cone, each axis's offset from the 60 cm rest scaled to the
// station's strength and vertical boost, the distance capped at maxEyeZ.
function stationEyes(st) {
  const v = st.view ?? {};
  const S = Math.min(3, v.maxStrength ?? 3);
  const VB = v.verticalBoost ?? 1.5;
  const zs = 1 + (S - 1) * 0.5;
  const zMax = v.maxEyeZ ?? 1.4;
  const cz = (z) => Math.min(zMax, z);
  const r = (a) => a.map((x) => Math.round(x * 1000) / 1000);
  const ex = S / 3, ey = (S * VB) / (3 * 1.5), ez = zs / 2;
  return {
    C: [0, 0, 0.6],
    tL: r([-0.1 * S, 0, 0.6]), tR: r([0.1 * S, 0, 0.6]), tU: r([0, 0.06 * S * VB, 0.6]), tD: r([0, -0.06 * S * VB, 0.6]),
    tIn: r([0, 0, 0.6 - 0.1 * zs]), tOut: r([0, 0, cz(0.6 + 0.1 * zs)]),
    eL: r([-0.5 * ex, 0, 0.6]), eR: r([0.5 * ex, 0, 0.6]), eU: r([0, 0.48 * ey, 0.6]), eD: r([0, -0.4 * ey, 0.6]),
    eN: r([0, 0, 0.6 - 0.4 * ez]), eF: r([0, 0, cz(0.6 + 0.8 * ez)]),
  };
}
const eyesFor = (st) => {
  if (opt('eyeset', 'station') !== 'station') return EYES;
  const e = stationEyes(st);
  return onlyEyes && onlyEyes !== true ? Object.fromEntries(Object.entries(e).filter(([k]) => onlyEyes.split(',').includes(k))) : e;
};

const box = (await import(join(root, 'src', 'scenes', 'box', 'index.js'))).default;
const nav = box.nav;
let POSES = nav ? nav.stations.map((s) => ({ id: s.id, title: s.title, pose: s.pose, view: s.view })) : [{ id: 'room', title: 'The room', pose: { position: [0, 0, 0], yaw: 0, pitch: 0, scale: 1 } }];
const posesFile = opt('poses', null);
if (posesFile && posesFile !== true) POSES = POSES.concat(JSON.parse(readFileSync(posesFile, 'utf8')));
const onlyStations = opt('stations', null);
if (onlyStations && onlyStations !== true) POSES = POSES.filter((p) => onlyStations.split(',').includes(p.id));

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

// Other GPU checks may hold both ports for a while: wait for one (as the
// other scene tools do) rather than fail.
async function startServer() {
  for (let tries = 0; tries < 200; tries++) {
    const s = await tryServer();
    if (s) return s;
    await new Promise((ok) => setTimeout(ok, 3000));
  }
  throw new Error('ports 5196-5197 stayed busy');
}

const save = (p, url) => writeFileSync(p, Buffer.from(url.split(',')[1], 'base64'));

// In-page: the rig camera and a render at (pose, eye, time).
const PAGE_SETUP = `(async () => {
  const lab = window.__lab;
  const THREE = lab.THREE;
  const { applyWindowCamera } = await import('/src/core/projection.js');
  const cam = new THREE.PerspectiveCamera();
  const D2R = Math.PI / 180;
  const H0 = 0.205109, W0 = 0.326571;
  const size = () => {
    const c = lab.renderer.domElement;
    const a = c.clientWidth / Math.max(1, c.clientHeight);
    return { W: Math.abs(a - W0 / H0) < 0.01 ? W0 : H0 * a, H: H0 };
  };
  const place = (pose, eye) => {
    const { W, H } = size();
    const s = pose.scale ?? 1;
    const e = new THREE.Vector3(eye[0] * s, eye[1] * s, eye[2] * s);
    applyWindowCamera(cam, e, W * s, H * s, { near: 0.005 * s, far: 200 * s });
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((pose.pitch ?? 0) * D2R, (pose.yaw ?? 0) * D2R, 0, 'YXZ'));
    const p = new THREE.Vector3(...(pose.position ?? [0, 0, 0]));
    cam.position.copy(e.applyQuaternion(q).add(p));
    cam.quaternion.copy(q);
    cam.updateMatrixWorld(true);
    return { eyeWorld: cam.position.clone(), rig: { position: p, quaternion: q, scale: s } };
  };
  const eyeWin = new THREE.Vector3();
  window.__nav = {
    cam, place, size,
    frame(pose, eye, t, dt = 1 / 60) {
      const view = place(pose, eye);
      eyeWin.set(eye[0], eye[1], eye[2]);
      lab.handle.update(dt, t, eyeWin, view);
      lab.renderer.setRenderTarget(null);
      lab.handle.render(lab.renderer, cam);
      return view;
    },
    shot(pose, eye, t) {
      // settle a few frames (the bell, any per-frame state), then capture
      for (let i = 0; i < 3; i++) this.frame(pose, eye, t - (2 - i) / 60);
      return lab.renderer.domElement.toDataURL('image/png');
    },
    // flat-material render: magenta = void (nothing drawn, or the sky dome
    // below y = -0.25, where the ground should be), red = the back of a
    // one-sided surface (as the lab's voidMask); see-through overlays
    // (glass, the stream) are not counted
    voidCheck(pose, eye, t) {
      const view = this.frame(pose, eye, t);
      const r = lab.renderer;
      // the lit frame's luma (every 7th pixel): a uniform black sky passes
      // the mask, so the tests also want the 90th percentile above ~8
      const gl0 = r.getContext();
      const w0 = gl0.drawingBufferWidth, h0 = gl0.drawingBufferHeight;
      const lit = new Uint8Array(w0 * h0 * 4);
      gl0.readPixels(0, 0, w0, h0, gl0.RGBA, gl0.UNSIGNED_BYTE, lit);
      const lum = [];
      for (let i = 0; i < w0 * h0; i += 7) lum.push(0.2126 * lit[i * 4] + 0.7152 * lit[i * 4 + 1] + 0.0722 * lit[i * 4 + 2]);
      lum.sort((a, b) => a - b);
      const p50 = lum[Math.floor(lum.length * 0.5)], p90 = lum[Math.floor(lum.length * 0.9)];
      const scene = lab.handle.scene;
      const vs = 'varying vec3 vW; void main() { vec4 p = vec4(position, 1.0);\\n#ifdef USE_INSTANCING\\np = instanceMatrix * p;\\n#endif\\np = modelMatrix * p; vW = p.xyz; gl_Position = projectionMatrix * viewMatrix * p; }';
      const made = [];
      // back faces carry their mesh's index in blue, to name the culprits
      const mk = (oneSided, idx = 0) => { const m = new THREE.ShaderMaterial({ uniforms: { oneSided: { value: oneSided }, idx: { value: idx / 255 } }, vertexShader: vs, fragmentShader: 'uniform float oneSided; uniform float idx; varying vec3 vW; void main() { gl_FragColor = (gl_FrontFacing || oneSided < 0.5) ? vec4(0.5, 0.5, 0.5, 1.0) : vec4(1.0, 0.0, idx, 1.0); }', side: THREE.DoubleSide }); made.push(m); return m; };
      const both = mk(0);
      const names = [];
      const sky = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, vertexShader: vs, fragmentShader: 'varying vec3 vW; void main(){ gl_FragColor = vW.y < -0.25 ? vec4(1.0,0.0,1.0,1.0) : vec4(0.2,0.3,0.9,1.0); }' });
      made.push(sky);
      const saved = [];
      const hidden = [];
      scene.traverse((o) => {
        if (!(o.isMesh || o.isPoints || o.isLine) || !o.visible) return;
        const m = o.material;
        if (o.userData.skyDome) { saved.push([o, m]); o.material = sky; return; }
        if (!m || m.transparent || m.blending === THREE.AdditiveBlending || m.depthWrite === false) { o.visible = false; hidden.push(o); return; }
        saved.push([o, m]);
        if (m.side === THREE.FrontSide) { names.push(o.name || o.type); o.material = mk(1, Math.min(names.length, 200)); } else o.material = both;
      });
      const bg = scene.background;
      scene.background = new THREE.Color(1, 0, 1);
      r.setRenderTarget(null);
      r.render(scene, cam);
      const gl = r.getContext();
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let n = 0; let back = 0;
      const byName = {};
      for (let i = 0; i < w * h; i++) {
        const R = px[i * 4], G = px[i * 4 + 1], B = px[i * 4 + 2];
        if (R > 240 && G < 15 && B > 240) n++;
        else if (R > 240 && G < 15 && B > 0 && B <= 200) { back++; const k = names[B - 1]; byName[k] = (byName[k] || 0) + 1; }
      }
      const url = n + back > 0 ? r.domElement.toDataURL('image/png') : null;
      scene.background = bg;
      for (const [o, m] of saved) o.material = m;
      for (const o of hidden) o.visible = true;
      for (const m of made) m.dispose();
      return { frac: n / (w * h), n, back, backFrac: back / (w * h), url, eyeWorld: view.eyeWorld.toArray(), byName, p50, p90 };
    },
    // luma of the lit frame over one mesh's pixels (e.g. 'shojiPaper')
    meshLuma(pose, eye, t, name) {
      this.shot(pose, eye, t);
      const r = lab.renderer;
      const gl = r.getContext();
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const lit = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, lit);
      const scene = lab.handle.scene;
      const white = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      const black = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
      const saved = [];
      scene.traverse((o) => { if (o.isMesh) { saved.push([o, o.material]); o.material = o.name === name ? white : black; } });
      const bg = scene.background;
      scene.background = new THREE.Color(0, 0, 0);
      r.setRenderTarget(null);
      r.render(scene, cam);
      const m = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, m);
      scene.background = bg;
      for (const [o, mm] of saved) o.material = mm;
      white.dispose(); black.dispose();
      const v = [];
      for (let i = 0; i < w * h; i += 3) if (m[i * 4] > 128) v.push(0.2126 * lit[i * 4] + 0.7152 * lit[i * 4 + 1] + 0.0722 * lit[i * 4 + 2]);
      v.sort((a, b) => a - b);
      const q = (f) => (v.length ? +v[Math.floor(f * (v.length - 1))].toFixed(1) : null);
      return { frac: +(v.length * 3 / (w * h)).toFixed(3), p10: q(0.1), p50: q(0.5), p90: q(0.9), p99: q(0.99) };
    },
    measure(pose, n = 120) {
      const gl = lab.renderer.getContext();
      const px = new Uint8Array(4);
      const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      // a sway over the head range: +-45 cm, +-20 cm, 45-85 cm
      const at = (i) => { const u = i / 60; return [0.45 * Math.sin(u * 1.1), 0.2 * Math.sin(u * 1.7 + 1), 0.65 + 0.2 * Math.sin(u * 0.7)]; };
      let t = 10;
      for (let i = 0; i < 20; i++) { this.frame(pose, at(i), (t += 1 / 60)); }
      sync();
      const times = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        this.frame(pose, at(i), (t += 1 / 60));
        sync();
        times.push(performance.now() - t0);
      }
      const tp0 = performance.now();
      for (let i = 0; i < n; i++) this.frame(pose, at(i), (t += 1 / 60));
      sync();
      const throughput = (performance.now() - tp0) / n;
      times.sort((a, b) => a - b);
      lab.renderer.info.reset();
      this.frame(pose, at(0), t);
      const info = lab.renderer.info.render;
      return { throughput, p50: times[Math.floor(n / 2)], p95: times[Math.floor(n * 0.95)], max: times[n - 1], draws: info.calls, triangles: info.triangles };
    },
  };
  return true;
})()`;

async function board(page, out, { title, cols, cellW, cells }) {
  const url = await page.evaluate(async ({ title, cols, cellW, cells }) => {
    const load = (src) => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
    const imgs = await Promise.all(cells.map((c) => load(c.src)));
    const ch = Math.round((cellW * imgs[0].height) / imgs[0].width);
    const pad = 8, head = title ? 40 : 0, lab = 24;
    const rows = Math.ceil(cells.length / cols);
    const cv = document.createElement('canvas');
    cv.width = cols * cellW + (cols + 1) * pad;
    cv.height = head + rows * (ch + lab + pad) + pad;
    const g = cv.getContext('2d');
    g.fillStyle = '#111'; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#eee'; g.font = '22px Menlo, monospace';
    if (title) g.fillText(title, pad, 28);
    g.imageSmoothingQuality = 'high';
    cells.forEach((c, i) => {
      const x = pad + (i % cols) * (cellW + pad);
      const y = head + pad + Math.floor(i / cols) * (ch + lab + pad);
      g.fillStyle = '#ccc'; g.font = '16px Menlo, monospace';
      g.fillText(c.label, x, y + 17);
      g.drawImage(imgs[i], x, y + lab, cellW, ch);
    });
    return cv.toDataURL('image/jpeg', 0.92);
  }, { title, cols, cellW, cells });
  save(out, url);
  console.log(`board -> ${out}`);
}

async function jpeg(page, src, w) {
  return page.evaluate(async ({ src, w }) => {
    const im = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = Math.round((w * im.height) / im.width);
    const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high';
    g.drawImage(im, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', 0.9);
  }, { src, w });
}

// Random rig poses inside the bounds and scale range (the void step).
function samplePoses(n, seed = 7) {
  let s = seed;
  const r = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const out = [];
  if (!nav) return out;
  const { min, max } = nav.bounds;
  const [s0, s1] = nav.scale;
  for (let i = 0; i < n; i++) {
    const position = [0, 1, 2].map((k) => min[k] + (max[k] - min[k]) * r());
    const scale = Math.exp(Math.log(s0) + (Math.log(s1) - Math.log(s0)) * r());
    out.push({ id: `rand${i}`, title: `random ${i}`, pose: { position, yaw: -180 + 360 * r(), pitch: -40 + 80 * r(), scale } });
  }
  // the corners of the bounds, looking each way, at both ends of the scale
  if (opt('corners', '1') === '0') return out;
  for (const cx of [0, 1]) for (const cy of [0, 1]) for (const cz of [0, 1]) for (const scale of [s0, s1]) {
    const position = [cx ? max[0] : min[0], cy ? max[1] : min[1], cz ? max[2] : min[2]];
    for (const yaw of [0, 90, 180, 270]) out.push({ id: `corner${cx}${cy}${cz}-${scale}-${yaw}`, title: 'corner', pose: { position, yaw, pitch: cy ? -30 : 30, scale } });
  }
  return out;
}

async function main() {
  const { server, port } = await startServer();
  const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
  const report = { when: new Date().toISOString(), dpr: DPR, stations: {}, void: {}, perf: {} };
  try {
    const context = await browser.newContext({ viewport: { width: CSS[0], height: CSS[1] }, deviceScaleFactor: DPR });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
    await page.goto(`http://127.0.0.1:${port}/lab.html?hud=0&auto=0&scene=box&quality=high`);
    await page.waitForFunction(() => window.__lab && window.__lab.ready);
    await page.evaluate(() => window.__lab.ready);
    await page.evaluate(PAGE_SETUP);
    const setup = opt('setup', null);
    if (setup && setup !== true) await page.evaluate(setup); // e.g. switch a pass off to find an artefact

    if (STEPS.has('shots')) {
      const sheet = [];
      for (const st of POSES) {
        const cells = [];
        for (const [name, eye] of Object.entries(eyesFor(st))) {
          const img = await page.evaluate(({ pose, eye, t }) => window.__nav.shot(pose, eye, t), { pose: st.pose, eye, t: T_STILL });
          if (name === 'C') save(join(OUT, `${st.id}-C.png`), img);
          cells.push({ src: await jpeg(page, img, 960), label: `${st.id} ${name} (${eye.map((v) => Math.round(v * 100)).join(',')})` });
        }
        if (cells.length === 1) sheet.push({ ...cells[0], label: `${st.id} ${JSON.stringify(st.pose)}` });
        else await board(page, join(OUT, `board-${st.id}.jpg`), { title: `${st.title}  pose ${JSON.stringify(st.pose)}`, cols: 3, cellW: 640, cells });
      }
      // one eye only: every pose on one contact sheet
      if (sheet.length) await board(page, join(OUT, 'sheet.jpg'), { title: 'centre eye', cols: 3, cellW: 640, cells: sheet });
    }

    if (STEPS.has('void')) {
      const poses = POSES.concat(samplePoses(Number(opt('samples', 40))));
      let worst = 0;
      let saved = 0;
      const lumas = [];
      const bad = [];
      for (const st of poses) {
        const eyes = st.id.startsWith('rand') || st.id.startsWith('corner') ? { C: HEAD.C, L: HEAD.L, R: HEAD.R, U: HEAD.U, D: HEAD.D } : eyesFor(st);
        for (const [name, eye] of Object.entries(eyes)) {
          const v = await page.evaluate(({ pose, eye, t }) => window.__nav.voidCheck(pose, eye, t), { pose: st.pose, eye, t: T_STILL });
          worst = Math.max(worst, v.frac + v.backFrac);
          lumas.push({ id: st.id, eye: name, p50: +v.p50.toFixed(1), p90: +v.p90.toFixed(1) });
          if (v.n + v.back > 0) {
            bad.push({ id: st.id, eye: name, frac: v.frac, back: v.backFrac, pose: st.pose, eyeWorld: v.eyeWorld, byName: v.byName });
            if ((v.frac > 0 || v.backFrac > 0.0005) && saved++ < 30) save(join(OUT, `void-${st.id}-${name}.png`), v.url);
          }
        }
      }
      report.void = { poses: poses.length, worst, bad, lumas };
      const dark = lumas.filter((l) => l.p90 < 8);
      console.log(`luma: darkest p90 ${Math.min(...lumas.map((l) => l.p90)).toFixed(1)}; frames with p90 < 8: ${dark.length}${dark.length ? ` (${dark.slice(0, 8).map((d) => `${d.id} ${d.eye}`).join(', ')})` : ''}`);
      console.log(`void: ${poses.length} poses, worst ${(worst * 100).toFixed(4)} %, ${bad.length} bad`);
      for (const b of bad.slice(0, 40)) console.log(`  ${b.id} ${b.eye} void ${(b.frac * 100).toFixed(3)} % back ${(b.back * 100).toFixed(3)} % pose ${JSON.stringify(b.pose)} eye ${b.eyeWorld.map((v) => v.toFixed(3))} ${JSON.stringify(b.byName)}`);
    }

    if (STEPS.has('shoji')) {
      for (const st of POSES) {
        for (const [name, eye] of Object.entries(eyesFor(st))) {
          if (!['C', 'tL', 'tR'].includes(name)) continue;
          const m = await page.evaluate(({ pose, eye, t }) => window.__nav.meshLuma(pose, eye, t, 'shojiPaper'), { pose: st.pose, eye, t: T_STILL });
          if (m.frac > 0.002) console.log(`shoji ${st.id} ${name}: ${JSON.stringify(m)}`);
        }
      }
    }

    if (STEPS.has('perf')) {
      for (const st of POSES) {
        const m = await page.evaluate(({ pose }) => window.__nav.measure(pose, 120), { pose: st.pose });
        report.perf[st.id] = m;
        console.log(`perf ${st.id.padEnd(8)} throughput ${m.throughput.toFixed(2)} ms, synced p50 ${m.p50.toFixed(2)} p95 ${m.p95.toFixed(2)} max ${m.max.toFixed(2)} ms, ${m.draws} draws, ${(m.triangles / 1000).toFixed(0)}k tris`);
      }
    }

    if (STEPS.has('room')) {
      // the room's look targets (docs/SCENES_NOTES.md): the lab's class mask and
      // luma percentiles, centre eye and the right lean, default rig
      const r = await page.evaluate(async () => {
        const lab = window.__lab;
        const out = {};
        for (const [k, e] of Object.entries({ center: [0, 0, 0.6], right: [0.25, 0, 0.6] })) {
          lab.setEye(...e);
          lab.renderAt(2.0);
          const img = lab.capture();
          const m = lab.classMask();
          out[k] = { img, mask: m.url, classes: m.classes };
        }
        return out;
      });
      const stats = {};
      for (const [k, v] of Object.entries(r)) {
        save(join(OUT, `room-${k}.png`), v.img);
        stats[k] = await page.evaluate(async ({ img, mask, classes }) => {
          const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
          const im = await load(img); const mi = await load(mask);
          const W = 1600, H = Math.round((1600 * im.height) / im.width);
          const get = (i, smooth) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingEnabled = smooth; g.imageSmoothingQuality = 'high'; g.drawImage(i, 0, 0, W, H); return g.getImageData(0, 0, W, H).data; };
          const d = get(im, true); const md = get(mi, false);
          const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
          const all = []; const reg = {};
          for (let p = 0; p < W * H; p++) {
            const j = p * 4;
            const y = 0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2];
            all.push(y);
            for (const c of classes) if (Math.abs(md[j] - c.color[0]) < 12 && Math.abs(md[j + 1] - c.color[1]) < 12 && Math.abs(md[j + 2] - c.color[2]) < 12) { (reg[c.id] ??= []).push(y); break; }
          }
          const pct = (a, q) => { const s = Float32Array.from(a).sort(); return +s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(1); };
          const out = { p10: pct(all, 0.1), p50: pct(all, 0.5) };
          for (const [id, a] of Object.entries(reg)) if (a.length > 200) out[id] = { p10: pct(a, 0.1), p50: pct(a, 0.5), p90: pct(a, 0.9), p99: pct(a, 0.99), frac: +(a.length / (W * H)).toFixed(4) };
          if (out.wall) out.wall.ratio = +(lin(out.wall.p99) / lin(out.wall.p10)).toFixed(0);
          return out;
        }, v);
      }
      report.room = stats;
      const c = stats.center;
      console.log(`room centre: frame p10 ${c.p10} p50 ${c.p50} | wall p10 ${c.wall?.p10} p90 ${c.wall?.p90} p99 ${c.wall?.p99} ratio ${c.wall?.ratio}:1 | shoji (lean right) p50 ${stats.right.shoji?.p50} p90 ${stats.right.shoji?.p90}`);
    }

    if (STEPS.has('leaks')) {
      // GPU memory must come back to baseline: reload the Box three times and
      // resize it three times (each resize rebuilds the room and the world)
      const snap = () => page.evaluate(() => { const lab = window.__lab; lab.renderAt(2.0); const m = lab.renderer.info.memory; return { geometries: m.geometries, textures: m.textures }; });
      const base = await snap();
      const loads = [];
      for (let i = 0; i < 3; i++) { await page.evaluate(() => window.__lab.load('box')); await page.evaluate(PAGE_SETUP); loads.push(await snap()); }
      const resizes = [];
      for (let i = 1; i <= 3; i++) {
        await page.setViewportSize({ width: CSS[0] - 60 * i, height: CSS[1] });
        await page.evaluate(() => window.dispatchEvent(new Event('resize')));
        resizes.push(await snap());
      }
      await page.setViewportSize({ width: CSS[0], height: CSS[1] });
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
      const back = await snap();
      report.leaks = { base, loads, resizes, back };
      const grew = [...loads, back].some((m) => m.geometries > base.geometries || m.textures > base.textures);
      console.log(`leaks: base ${JSON.stringify(base)}, after 3 reloads ${JSON.stringify(loads[2])}, resizes ${resizes.map((m) => `${m.geometries}/${m.textures}`).join(' ')}, back to the first size ${JSON.stringify(back)} ${grew ? 'LEAK' : 'ok'}`);
    }

    if (errors.length) console.log(`page errors/warnings:\n  ${[...new Set(errors)].slice(0, 10).join('\n  ')}`);
    writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  } finally {
    await browser.close();
    await server.close();
  }
}

await main();

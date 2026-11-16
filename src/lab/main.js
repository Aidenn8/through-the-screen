// Scene lab: renders any scene through the window camera with the eye driven
// by mouse/keys or a scripted head path. Also exposes window.__lab so headless
// tools (tools/scene-shots.mjs, tools/scene-check.mjs) can drive it frame by
// frame.
//
// URL parameters
//   scene=soundstage|box       which scene (folder under src/scenes/)
//   quality=high|low
//   eye=x,y,z                  starting eye in centimetres (default 0,0,60)
//   path=sway|orbit|reveal|push  play a scripted head path
//   w=,h=                      window size in centimetres (default 15" MacBook Air)
//   hud=0                      hide the overlay
//   auto=0                     no animation loop (tools drive frames)
//   view=window|viewer         window image, or the viewer's view of the laptop
//   dpr=                       override device pixel ratio
//
// Keys: arrows/WASD move the eye 1 cm (shift 5 cm), Q/E or +/- move in z,
// 1-7 presets, M toggles mouse-follow, P cycles head paths, V toggles the
// viewer view, L toggles quality, [ ] switch scene, H hides the overlay.

import * as THREE from 'three';
import { applyWindowCamera } from '../core/projection.js';
import { PRESETS, PATHS, SHEET_ORDER } from './paths.js';
import { ViewerView } from './viewer.js';
import { windowCheck } from './check.js';
import { SyncTimer } from './gpu-timer.js';
import { CLASSES, classMaterial } from './classes.js';

const modules = import.meta.glob('../scenes/*/index.js');
const sceneIds = Object.keys(modules)
  .map((k) => k.split('/')[2])
  .filter((id) => !id.startsWith('_'))
  .sort();

const params = new URLSearchParams(location.search);
const cm = (v) => Number(v) / 100;
const state = {
  sceneId: params.get('scene') || (sceneIds.includes('soundstage') ? 'soundstage' : sceneIds[0]),
  quality: params.get('quality') === 'low' ? 'low' : 'high',
  eye: new THREE.Vector3(...(params.get('eye') ? params.get('eye').split(',').map(cm) : PRESETS.center)),
  pathName: params.get('path') || null,
  pathT0: 0,
  mouse: false,
  view: params.get('view') === 'viewer' ? 'viewer' : 'window',
  hud: params.get('hud') !== '0',
  auto: params.get('auto') !== '0',
  // Chrome fullscreen on the 15" Air sits below the notch: 326.571 x 205.109 mm (docs/REFERENCES.md 1.5).
  W: params.get('w') ? cm(params.get('w')) : 0.326571,
  H: params.get('h') ? cm(params.get('h')) : 0.205109,
  time: 0,
  frameMs: [],
};

const canvas = document.getElementById('c');
const hud = document.getElementById('hud');
// The scenes render into their own MSAA targets and finish with one
// full-screen pass, so the canvas itself needs no multisampling (an MSAA
// canvas would make that last pass several times more expensive).
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: params.get('aa') === '1',
  powerPreference: 'high-performance',
  preserveDrawingBuffer: false,
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
const dpr = params.get('dpr') ? Number(params.get('dpr')) : Math.min(window.devicePixelRatio, 2);
renderer.setPixelRatio(dpr);
renderer.info.autoReset = false; // count every pass of a frame

const camera = new THREE.PerspectiveCamera();
const viewer = new ViewerView(state.W, state.H);
let handle = null;
let loading = null;

// Window size follows the canvas aspect so pixels stay square; height is the
// physical reference.
function windowSize() {
  // The viewer's view shows the real laptop, whatever the canvas shape.
  if (state.view === 'viewer' || params.get('fixed') === '1') return { width: state.W, height: state.H };
  const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
  const H = state.H;
  const W = Math.abs(aspect - state.W / state.H) < 0.01 ? state.W : H * aspect;
  return { width: W, height: H };
}

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  const s = windowSize();
  viewer.build(s.width, s.height);
  handle?.resize?.(s);
}

async function loadScene(id, quality) {
  if (handle) {
    handle.dispose?.();
    handle = null;
  }
  const key = `../scenes/${id}/index.js`;
  if (!modules[key]) throw new Error(`no scene "${id}" (have ${sceneIds.join(', ')})`);
  const mod = (await modules[key]()).default;
  const size = windowSize();
  handle = await mod.create({
    THREE,
    renderer,
    size,
    assetBase: `${import.meta.env.BASE_URL}assets/${id}/`,
    quality,
    // lab-only switches for A/B measurements (e.g. bake=1); the app passes none
    flags: Object.fromEntries(params),
  });
  handle.title = mod.title;
  state.sceneId = id;
  state.quality = quality;
}

function renderWindowImage(cam) {
  if (handle.render && !state.plain) handle.render(renderer, cam);
  else { handle.prepare?.(renderer, cam); renderer.render(handle.scene, cam); }
}

let last = performance.now();
function frame(now = performance.now(), { dt: forcedDt } = {}) {
  const dt = forcedDt ?? Math.min((now - last) / 1000, 0.1);
  last = now;
  if (state.auto) state.time += dt;
  if (state.pathName && PATHS[state.pathName] && state.auto) {
    const p = PATHS[state.pathName];
    const t = (state.time - state.pathT0) % p.duration;
    state.eye.set(...p.at(t));
  }
  const s = windowSize();
  applyWindowCamera(camera, state.eye, s.width, s.height, { near: 0.01, far: 60 });
  handle.update?.(dt, state.time, state.eye);
  renderer.info.reset();
  const t0 = performance.now();
  if (state.view === 'viewer') {
    viewer.render(renderer, state.viewerEye ?? state.eye, canvas.clientWidth / canvas.clientHeight, () => renderWindowImage(camera), {
      linear: !handle.render,
    });
  } else {
    renderWindowImage(camera);
  }
  state.frameMs.push(performance.now() - t0);
  if (state.frameMs.length > 120) state.frameMs.shift();
  drawHud();
}

function drawHud() {
  hud.className = state.hud ? '' : 'hidden';
  if (!state.hud) return;
  const e = state.eye;
  const ms = state.frameMs.reduce((a, b) => a + b, 0) / Math.max(state.frameMs.length, 1);
  const info = renderer.info.render;
  hud.textContent =
    `${handle?.title ?? state.sceneId}  [${state.quality}]  view: ${state.view}\n` +
    `eye  x ${(e.x * 100).toFixed(1)}  y ${(e.y * 100).toFixed(1)}  z ${(e.z * 100).toFixed(1)} cm\n` +
    `cpu submit ${ms.toFixed(2)} ms   draws ${info.calls}   tris ${(info.triangles / 1000).toFixed(0)}k\n` +
    `path ${state.pathName ?? '-'}   mouse ${state.mouse ? 'on' : 'off'}`;
}

function loop(now) {
  if (handle && !loading) frame(now);
  if (state.auto) requestAnimationFrame(loop);
}

// ---- input ----
window.addEventListener('resize', resize);
canvas.addEventListener('mousemove', (ev) => {
  if (!state.mouse) return;
  const r = canvas.getBoundingClientRect();
  const u = (ev.clientX - r.left) / r.width - 0.5;
  const v = (ev.clientY - r.top) / r.height - 0.5;
  state.eye.x = u * 0.6;
  state.eye.y = -v * 0.32;
});
canvas.addEventListener('click', () => { state.mouse = !state.mouse; state.pathName = null; });
canvas.addEventListener('wheel', (ev) => {
  state.eye.z = THREE.MathUtils.clamp(state.eye.z + ev.deltaY * 0.0004, 0.2, 1.6);
  ev.preventDefault();
}, { passive: false });

window.addEventListener('keydown', async (ev) => {
  const step = ev.shiftKey ? 0.05 : 0.01;
  const e = state.eye;
  const k = ev.key.toLowerCase();
  if (k === 'arrowleft' || k === 'a') e.x -= step;
  else if (k === 'arrowright' || k === 'd') e.x += step;
  else if (k === 'arrowup' || k === 'w') e.y += step;
  else if (k === 'arrowdown' || k === 's') e.y -= step;
  else if (k === 'q' || k === '-') e.z = Math.min(1.6, e.z + step);
  else if (k === 'e' || k === '=' || k === '+') e.z = Math.max(0.2, e.z - step);
  else if (k >= '1' && k <= '7') { e.set(...PRESETS[SHEET_ORDER[Number(k) - 1]]); state.pathName = null; }
  else if (k === 'm') state.mouse = !state.mouse;
  else if (k === 'h') state.hud = !state.hud;
  else if (k === 'v') state.view = state.view === 'window' ? 'viewer' : 'window';
  else if (k === 'p') {
    const names = [null, ...Object.keys(PATHS)];
    state.pathName = names[(names.indexOf(state.pathName) + 1) % names.length];
    state.pathT0 = state.time;
  } else if (k === 'l') {
    loading = loadScene(state.sceneId, state.quality === 'high' ? 'low' : 'high');
    await loading; loading = null;
  } else if (k === '[' || k === ']') {
    const i = sceneIds.indexOf(state.sceneId);
    const next = sceneIds[(i + (k === ']' ? 1 : sceneIds.length - 1)) % sceneIds.length];
    loading = loadScene(next, state.quality);
    await loading; loading = null;
  } else return;
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's', 'q', 'e'].includes(k)) state.pathName = null;
  ev.preventDefault();
});

// ---- headless API ----
const gl = renderer.getContext();
const syncPixel = new Uint8Array(4);
function gpuSync() {
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, syncPixel);
}

window.__lab = {
  sceneIds,
  presets: PRESETS,
  paths: Object.fromEntries(Object.entries(PATHS).map(([k, v]) => [k, v.duration])),
  ready: null,
  get state() {
    const e = state.eye;
    return { scene: state.sceneId, quality: state.quality, eye: [e.x, e.y, e.z], time: state.time, view: state.view };
  },
  async load(id, quality = state.quality) {
    loading = loadScene(id, quality);
    await loading;
    loading = null;
    frame(performance.now(), { dt: 0 });
    gpuSync();
  },
  setEye(x, y, z) { state.eye.set(x, y, z); state.pathName = null; },
  // Viewer's view only: where the phone (the real eye) is, when the image is
  // drawn from a different eye (Look around, Strength above 1x). null: the same eye.
  setViewerEye(x, y, z) { state.viewerEye = x === null || x === undefined ? null : new THREE.Vector3(x, y, z); },
  setView(v) { state.view = v; },
  // Bypass the scene's own render() (no post-processing), for timing comparisons.
  setPlain(on) { state.plain = !!on; },
  get handle() { return handle; },
  THREE,
  setHud(on) { state.hud = on; drawHud(); },
  // Render one frame at an absolute scene time (seconds).
  renderAt(time, dt = 1 / 60) {
    state.time = time;
    const auto = state.auto;
    state.auto = false;
    frame(performance.now(), { dt });
    state.auto = auto;
  },
  eyeOnPath(name, t) { return PATHS[name].at(t); },
  capture() { return canvas.toDataURL('image/png'); },
  // Frame time with a GPU sync after every frame (an upper bound: no CPU/GPU overlap).
  measure(n = 120, pathName = 'sway') {
    const p = PATHS[pathName];
    const times = [];
    const auto = state.auto;
    state.auto = false;
    for (let i = 0; i < n + 10; i++) {
      const t = (i / 60) % p.duration;
      state.eye.set(...p.at(t));
      state.time += 1 / 60;
      const t0 = performance.now();
      frame(performance.now(), { dt: 1 / 60 });
      gpuSync();
      if (i >= 10) times.push(performance.now() - t0);
    }
    // Throughput: n frames back to back, one sync at the end (CPU and GPU
    // overlap as they would in the app; closest to the real cost per frame).
    const tp0 = performance.now();
    for (let i = 0; i < n; i++) {
      state.eye.set(...p.at((i / 60) % p.duration));
      state.time += 1 / 60;
      frame(performance.now(), { dt: 1 / 60 });
    }
    gpuSync();
    const throughput = (performance.now() - tp0) / n;
    state.auto = auto;
    times.sort((a, b) => a - b);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    return {
      throughput,
      mean,
      p50: times[Math.floor(times.length * 0.5)],
      p95: times[Math.floor(times.length * 0.95)],
      max: times[times.length - 1],
      draws: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    };
  },
  // Per-pass breakdown: the scene's passes are bracketed with renderer.__prof
  // (see gpu-timer.js: each section syncs on the target it wrote).
  passProfile(n = 90, pathName = 'sway') {
    const timer = new SyncTimer(renderer);
    const p = PATHS[pathName];
    const auto = state.auto;
    state.auto = false;
    renderer.__prof = timer;
    const total = [];
    for (let i = 0; i < n; i++) {
      state.eye.set(...p.at((i / 60) % p.duration));
      state.time += 1 / 60;
      timer.fence();
      const t0 = performance.now();
      frame(performance.now(), { dt: 1 / 60 });
      timer.sync(null);
      total.push(performance.now() - t0);
    }
    renderer.__prof = null;
    state.auto = auto;
    const out = timer.summary();
    total.sort((a, b) => a - b);
    out.total = { mean: total.reduce((a, b) => a + b, 0) / total.length, p50: total[Math.floor(total.length / 2)], p95: total[Math.floor(total.length * 0.95)], n: total.length };
    return out;
  },
  // Cost of each feature by ablation: throughput (frames back to back, one
  // sync at the end) with the feature on and off. Differences are real costs
  // with CPU/GPU overlap, unlike per-section syncs.
  ablate(n = 120, pathName = 'sway', { synced = false } = {}) {
    const p = PATHS[pathName];
    const pipe = handle.pipeline;
    const dbg = handle.debug ?? {};
    const auto = state.auto;
    state.auto = false;
    // throughput (frames back to back), or with synced=true the median of
    // per-frame GPU-synced times (CPU and GPU serialised: robust when the
    // back-to-back loop is bound by something else)
    const run = () => {
      for (let i = 0; i < 12; i++) { state.time += 1 / 60; frame(performance.now(), { dt: 1 / 60 }); }
      gpuSync();
      const ts = [];
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        state.eye.set(...p.at((i / 60) % p.duration));
        state.time += 1 / 60;
        const f0 = performance.now();
        frame(performance.now(), { dt: 1 / 60 });
        if (synced) { gpuSync(); ts.push(performance.now() - f0); }
      }
      gpuSync();
      if (synced) { ts.sort((a, b) => a - b); return ts[Math.floor(ts.length / 2)]; }
      return (performance.now() - t0) / n;
    };
    const toggles = dbg.onlyToggles ? { ...dbg.toggles } : {
      haze: (on) => { if (pipe) pipe.enabled.haze = on; },
      bloom: (on) => { if (pipe) pipe.enabled.bloom = on; },
      rain: (on) => { if (dbg.rain) dbg.rain.mesh.visible = on; },
      mirror: (on) => { if (dbg.features) dbg.features.mirror = on; },
      ...(dbg.toggles ?? {}),
    };
    // Interleaved on/off pairs, repeated: the machine's clocks drift by more
    // than some of these effects between runs, but not within a pair.
    const reps = 3;
    const out = { full: 0 };
    const fulls = [];
    for (const [k, f] of Object.entries(toggles)) {
      let saved = 0;
      for (let r = 0; r < reps; r++) {
        const on = run();
        f(false);
        const off = run();
        f(true);
        fulls.push(on);
        saved += (on - off) / reps;
      }
      out[`saves: ${k}`] = saved;
    }
    let all = 0;
    for (let r = 0; r < reps; r++) {
      const on = run();
      for (const f of Object.values(toggles)) f(false);
      const off = run();
      for (const f of Object.values(toggles)) f(true);
      fulls.push(on);
      all += (on - off) / reps;
    }
    out['saves: all'] = all;
    fulls.sort((a, b) => a - b);
    out.full = fulls[Math.floor(fulls.length / 2)];
    state.auto = auto;
    return out;
  },
  // Flat class colours per mesh (src/lab/classes.js), drawn from the current
  // eye with no lighting, MSAA or post: a region mask for the tools.
  classMask() {
    const spec = CLASSES[state.sceneId];
    if (!spec) return null;
    const scene = handle.scene;
    const toWorld = handle.debug?.realToWorld ?? new THREE.Matrix4();
    const worldBox = (b) => {
      const a = new THREE.Vector3(...b.min).applyMatrix4(toWorld);
      const c = new THREE.Vector3(...b.max).applyMatrix4(toWorld);
      return { min: [Math.min(a.x, c.x), Math.min(a.y, c.y), Math.min(a.z, c.z)], max: [Math.max(a.x, c.x), Math.max(a.y, c.y), Math.max(a.z, c.z)] };
    };
    const made = [];
    const saved = [];
    const hidden = [];
    const black = classMaterial(THREE, [0, 0, 0]);
    made.push(black);
    scene.traverse((o) => {
      if (!(o.isMesh || o.isPoints || o.isLine) || !o.visible) return;
      if (spec.hide.includes(o.name) || o.userData.checkExclude) { o.visible = false; hidden.push(o); return; }
      const entries = spec.classes.filter((c) => c.names.includes(o.name));
      let mat = black;
      if (entries.length) {
        const e = entries[0];
        mat = e.box ? classMaterial(THREE, e.color, entries[1]?.color ?? [0, 0, 0], worldBox(e.box)) : classMaterial(THREE, e.color);
        made.push(mat);
      }
      saved.push([o, o.material]);
      o.material = mat;
    });
    const bg = scene.background;
    scene.background = new THREE.Color(0, 0, 0);
    const s = windowSize();
    applyWindowCamera(camera, state.eye, s.width, s.height, { near: 0.01, far: 60 });
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    const url = canvas.toDataURL('image/png');
    scene.background = bg;
    for (const [o, m] of saved) o.material = m;
    for (const o of hidden) o.visible = true;
    for (const m of made) m.dispose();
    return { url, classes: spec.classes.map((c) => ({ id: c.id, color: c.color })) };
  },
  // Viewer's view camera: vertical field of view (degrees) and aim point.
  setViewer({ fov, lookAt } = {}) {
    if (fov) viewer.camera.fov = fov;
    if (lookAt) viewer.lookAt = lookAt;
  },
  async probeTargets(n = 60) {
    const { probeTargets } = await import('./perf-probe.js');
    return probeTargets(renderer, handle.scene, camera, n);
  },
  check(eye, opts = {}) {
    const s = windowSize();
    const draw = opts.pipeline && handle.render
      ? (cam) => handle.render(renderer, cam, { check: true })
      : (cam) => { handle.prepare?.(renderer, cam); renderer.render(handle.scene, cam); };
    return windowCheck(renderer, {
      scene: handle.scene,
      draw,
      W: s.width,
      H: s.height,
      eye: { x: eye[0], y: eye[1], z: eye[2] },
      width: opts.width ?? 1200,
      images: !!opts.images,
      displayReferred: !!(opts.pipeline && handle.render),
    });
  },
  renderer,
};

resize();
window.__lab.ready = loadScene(state.sceneId, state.quality).then(() => {
  frame(performance.now(), { dt: 0 });
  gpuSync();
  if (state.auto) requestAnimationFrame(loop);
  return true;
});
window.__lab.ready.catch((err) => {
  hud.className = '';
  hud.textContent = `failed to load scene: ${err.message}`;
  console.error(err);
});

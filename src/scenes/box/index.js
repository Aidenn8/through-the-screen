// Box: the classic head-tracking room, exactly the window's size and 50 cm
// deep, made into a tokonoma-like niche lit by one low sun (refs: Matton's
// room boxes, a lit tokonoma; docs/SCENES_NOTES.md). Doubles as the
// calibration view:
//   - far markers: the round window on the back wall, with dusk hills and
//     the evening star far behind it (they move the most as you move);
//   - near marker: a brass wind-chime bell hanging 5 cm in front of the glass;
//   - nested dark frames at three depths and floor boards running back give
//     converging lines, so any swimming is easy to see.
// Nothing important sits at the glass depth itself.
//
// Light: the sun comes through a shoji lattice in the left wall. The lattice
// pattern is projected as a cookie computed from the actual lattice bars (so
// it lines up with them exactly and has a sun-sized penumbra, with none of the
// stair-steps a shadow map gives thin bars); the shadow map only carries the
// props. The fill is low, so the shadowed plaster falls to deep umber and the
// sun patch is the key (rb01 ~105:1; target here at least 16:1).

import * as THREE from 'three';
import { FilmPipeline } from '../_lib/pipeline.js';
import { Haze, HazeLight } from '../_lib/haze.js';
import { Builder, boxUV, planeUV, mat4 } from '../_lib/geo.js';
import { plasterCanvas, woodCanvas, paint, fbm, toTexture, makeCanvas, rng } from '../_lib/textures.js';
import { warmUp } from '../_lib/warm.js';
import { addWorkLights } from '../_lib/worklight.js';
import { buildGarden, createGardenMaterials, DOOR } from './garden.js';
import { buildNextRoom, createNextRoomMaterials, lightNextRoom, SIDE } from './nextroom.js';

const DEPTH = 0.5;
const FRAMES = [-0.12, -0.26, -0.4];
// the shoji window in the left wall (window-space metres)
const WIN = { z0: -0.39, z1: -0.15, y0: -0.045, y1: 0.08, cols: 6, rows: 4, bar: 0.0035 };

function metresTex(canvas, metres, opts) {
  const t = toTexture(canvas, opts);
  t.repeat.set(1 / metres, 1 / metres);
  return t;
}

// Dusk sky for the round window: deep blue overhead to a warm band low down,
// with faint high cloud. Seen at a distance through the window.
function skyTexture() {
  return toTexture(paint(256, 512, (u, v) => {
    // v 0 top .. 1 bottom; through the window we see v ~0.33-0.68, the
    // hills' line near 0.6: deep blue overhead, rose then amber at the horizon
    const stops = [[0.0, [8, 14, 40]], [0.32, [14, 24, 62]], [0.48, [40, 46, 92]], [0.58, [150, 92, 96]], [0.68, [214, 140, 88]], [1.0, [220, 150, 90]]];
    let i0 = 0;
    while (i0 < stops.length - 2 && v > stops[i0 + 1][0]) i0++;
    const [va, ca] = stops[i0];
    const [vb, cb] = stops[i0 + 1];
    const k = Math.min(1, Math.max(0, (v - va) / (vb - va)));
    const c = ca.map((a, i) => a + (cb[i] - a) * k * k * (3 - 2 * k));
    const t = v;
    const cl = Math.max(0, fbm(u, v, 3, 5, 17, 0.55, 6) - 0.55) * 1.6 * (1 - t) * t * 3;
    return c.map((a, i) => Math.min(255, a + cl * [150, 110, 120][i]));
  }), { repeat: [1, 1] });
}

// Andon paper: fibres, the inner frame's ribs as soft dark lines, brighter
// toward the top where the flame sits.
function andonTexture() {
  const N = 256;
  const c = paint(N, N, (u, v) => {
    const fib = fbm(u, v, 24, 3, 9, 0.5, 4);
    const glow = 0.72 + 0.28 * Math.exp(-((v - 0.3) ** 2) * 6) - 0.12 * v;
    const edge = Math.min(1, Math.min(u, 1 - u) * 14);
    let k = glow * (0.9 + 0.12 * fib) * (0.82 + 0.18 * edge);
    for (const ry of [0.33, 0.66]) k *= 1 - 0.28 * Math.exp(-(((v - ry) * 90) ** 2));
    return [255 * k, 236 * k, 196 * k];
  });
  return toTexture(c, { repeat: [1, 1] });
}

// Shoji paper with the low sun behind it: long fibres, a hot spot toward the
// sun's side, a little cooler at the far edge.
function shojiTexture() {
  const N = 128;
  return toTexture(paint(N, N, (u, v) => {
    const fib = fbm(u, v, 6, 3, 31, 0.5, 40);
    const k = (0.86 + 0.14 * Math.exp(-(((u - 0.7) ** 2) + ((v - 0.45) ** 2)) * 5)) * (0.94 + 0.08 * fib);
    return [255 * k, 244 * k, 222 * k];
  }), { repeat: [1, 1] });
}

// Glaze for the tea bowl along its profile (lathe v): raw clay foot, dark
// iron glaze, a rust rim where the glaze thins.
function glazeTexture() {
  return toTexture(paint(64, 256, (u, v) => {
    const n = fbm(u, v, 8, 3, 23, 0.5, 16);
    if (v < 0.14) return [150 * (0.9 + 0.2 * n), 116 * (0.9 + 0.2 * n), 82];
    const rim = Math.max(0, (v - 0.45) / 0.12) * Math.max(0, 1 - Math.abs(v - 0.55) / 0.12);
    const base = [46, 30, 22];
    const rust = [150, 80, 40];
    return base.map((a, i) => (a + (rust[i] - a) * Math.min(1, rim)) * (0.85 + 0.3 * n));
  }), { repeat: [1, 1] });
}

// Tapered tube along a smooth curve (a branch): radius r0 -> r1.
function taperTube(points, r0, r1, seg = 24, radial = 7) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const frames = curve.computeFrenetFrames(seg, false);
  const pos = [];
  const nrm = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const p = curve.getPointAt(t);
    const r = r0 + (r1 - r0) * t;
    const N = frames.normals[i];
    const Bn = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const wob = 1 + 0.12 * Math.sin(a * 3 + t * 17);
      const n = N.clone().multiplyScalar(Math.cos(a)).add(Bn.clone().multiplyScalar(Math.sin(a)));
      pos.push(p.x + n.x * r * wob, p.y + n.y * r * wob, p.z + n.z * r * wob);
      nrm.push(n.x, n.y, n.z);
      uv.push(j / radial, t);
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j;
    const b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return { geo: g, curve };
}

// One plum blossom: five cupped petals around a centre, radius r, facing +y.
function blossomGeometry(r) {
  const parts = [];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const g = new THREE.CircleGeometry(r * 0.52, 10);
    g.scale(1, 1.15, 1);
    g.rotateX(-Math.PI / 2 + 0.5); // cup upward
    g.translate(0, 0, r * 0.5);
    g.rotateY(a);
    parts.push(g.toNonIndexed());
  }
  const merged = new THREE.BufferGeometry();
  const arr = [];
  const nr = [];
  for (const p of parts) { arr.push(...p.attributes.position.array); nr.push(...p.attributes.normal.array); }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(nr, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((arr.length / 3) * 2), 2));
  return merged;
}

// The lattice's light pattern as seen from the sun: for every texel of the
// spot's projection, trace the ray to the wall plane and test the opening and
// the bars; supersampled, then blurred by the sun's penumbra.
function latticeCookie(light, target, wallX, N = 1024) {
  const cam = new THREE.PerspectiveCamera((light.angle * 2 * 180) / Math.PI, 1, 0.01, 10);
  cam.position.copy(light.position);
  cam.lookAt(target);
  cam.updateMatrixWorld(true);
  const rot = new THREE.Matrix3().setFromMatrix4(cam.matrixWorld);
  const tanH = Math.tan(light.angle);
  const ss = 3;
  const data = new Float32Array(N * N);
  const d = new THREE.Vector3();
  const colW = (WIN.z1 - WIN.z0) / WIN.cols;
  const rowH = (WIN.y1 - WIN.y0) / WIN.rows;
  for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
    let lit = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const nx = ((px + (sx + 0.5) / ss) / N) * 2 - 1;
      const ny = 1 - ((py + (sy + 0.5) / ss) / N) * 2;
      d.set(nx * tanH, ny * tanH, -1).applyMatrix3(rot);
      const t = (wallX - light.position.x) / d.x;
      if (t <= 0) continue;
      const y = light.position.y + d.y * t;
      const z = light.position.z + d.z * t;
      if (y < WIN.y0 || y > WIN.y1 || z < WIN.z0 || z > WIN.z1) continue;
      const fz = (z - WIN.z0) / colW;
      const fy = (y - WIN.y0) / rowH;
      const bz = Math.abs(fz - Math.round(fz)) * colW;
      const by = Math.abs(fy - Math.round(fy)) * rowH;
      if (bz < WIN.bar / 2 || by < WIN.bar / 2) continue;
      lit++;
    }
    data[py * N + px] = lit / (ss * ss);
  }
  // penumbra: the sun is ~0.53 deg wide; across the room (~0.3 m from the
  // lattice) that is ~2.8 mm, about two cookie texels here
  const blur = (src, r) => {
    const out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let s = 0; let n = 0;
      for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < N) { s += src[y * N + xx]; n++; } }
      out[y * N + x] = s / n;
    }
    const out2 = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let s = 0; let n = 0;
      for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < N) { s += out[yy * N + x]; n++; } }
      out2[y * N + x] = s / n;
    }
    return out2;
  };
  const b = blur(data, 2);
  const c = makeCanvas(N, N);
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    const v = Math.round(255 * Math.pow(b[i], 1 / 2.2));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export default {
  id: 'box',
  title: 'Box',
  order: 2,
  async create(ctx) {
    const { renderer, quality } = ctx;
    const high = quality !== 'low';
    let { width: W, height: H } = ctx.size;

    const prevShadow = { enabled: renderer.shadowMap.enabled, type: renderer.shadowMap.type, auto: renderer.shadowMap.autoUpdate };
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;
    renderer.shadowMap.autoUpdate = false;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0, 0, 0);

    // ---------------- materials
    // ochre clay plaster (rb04), dark timber (rb04's near-black frame), boards
    const plaster = metresTex(plasterCanvas(512, 512, { tone: [206, 162, 92], var: 0.1 }), 0.35);
    const boards = metresTex(woodCanvas(512, 512, { tone: [120, 84, 54], rings: 40, dark: 0.35 }), 0.5);
    const frameWood = metresTex(woodCanvas(512, 64, { tone: [58, 38, 26], rings: 10, dark: 0.4, seed: 9 }), 0.4);
    const ceilWood = metresTex(woodCanvas(512, 128, { tone: [92, 62, 40], rings: 24, dark: 0.35, seed: 4 }), 0.3);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0.08, 0.05, 0.03);
    const envCard = new THREE.Mesh(new THREE.PlaneGeometry(2, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 2.4, 1.4), side: THREE.DoubleSide }));
    envCard.position.set(-2, 0.5, -0.5);
    envCard.lookAt(0, 0, 0);
    envScene.add(envCard);
    const pm = new THREE.PMREMGenerator(renderer);
    const envRT = pm.fromScene(envScene, 0.04);
    pm.dispose();
    envCard.geometry.dispose();
    envCard.material.dispose();
    const mats = {
      wall: new THREE.MeshLambertMaterial({ map: plaster }),
      ceiling: new THREE.MeshLambertMaterial({ map: ceilWood }),
      floor: new THREE.MeshStandardMaterial({ map: boards, roughness: 0.32, metalness: 0, envMap: envRT.texture, envMapIntensity: 0.35 }),
      frame: new THREE.MeshLambertMaterial({ map: frameWood }),
      lacquer: new THREE.MeshStandardMaterial({ color: 0x140805, roughness: 0.2, envMap: envRT.texture, envMapIntensity: 0.6 }),
      ceramic: new THREE.MeshStandardMaterial({ map: glazeTexture(), roughness: 0.3, envMap: envRT.texture, envMapIntensity: 0.5 }),
      ceramicIn: new THREE.MeshStandardMaterial({ color: 0x3c4c44, roughness: 0.22, envMap: envRT.texture, envMapIntensity: 0.6 }),
      brass: new THREE.MeshStandardMaterial({ color: 0xd8aa60, metalness: 1, roughness: 0.25, envMap: envRT.texture, envMapIntensity: 1.6 }),
      string: new THREE.MeshLambertMaterial({ color: 0x9a2a20 }),
      paperStrip: new THREE.MeshLambertMaterial({ color: 0xe8dcc0, side: THREE.DoubleSide }),
      // the shoji paper is the light source as the room sees it: backlit by
      // the sun, the brightest thing in frame
      shojiPaper: new THREE.MeshBasicMaterial({ map: shojiTexture(), color: new THREE.Color(1.0, 0.88, 0.7).multiplyScalar(4.6) }),
      sky: new THREE.MeshBasicMaterial({ map: skyTexture(), color: new THREE.Color(1, 1, 1).multiplyScalar(0.9) }),
      hillFar: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.11, 0.1, 0.16) }),
      hillNear: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.035, 0.032, 0.05) }),
      star: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.95, 0.85).multiplyScalar(30) }),
      pane: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.75, 0.5).multiplyScalar(0.05), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      lanternPaper: new THREE.MeshBasicMaterial({ map: andonTexture(), color: new THREE.Color(1.0, 0.82, 0.6).multiplyScalar(1.15), side: THREE.DoubleSide }),
      branch: new THREE.MeshLambertMaterial({ color: 0x2a1a12 }),
      blossom: new THREE.MeshLambertMaterial({ color: 0xf6e4e4, side: THREE.DoubleSide }),
      blossomBud: new THREE.MeshLambertMaterial({ color: 0xc8506a }),
      stamen: new THREE.MeshLambertMaterial({ color: 0xc89a3a }),
    };
    Object.assign(mats, createGardenMaterials({ boards }), createNextRoomMaterials());
    let nextLit = false;
    // light bounced off the sunlit floor and the sunlit right wall onto the
    // ceiling (the ceiling never sees the sun itself)
    {
      const h = 0.1026; // H / 2 for the default window; the bounce is soft, not exact
      addWorkLights([mats.ceiling], [
        { position: new THREE.Vector3(0.03, -h + 0.01, -0.36), color: new THREE.Color(1.0, 0.62, 0.3).multiplyScalar(0.009) },
        { position: new THREE.Vector3(0.13, -h + 0.01, -0.44), color: new THREE.Color(1.0, 0.62, 0.3).multiplyScalar(0.007) },
        { position: new THREE.Vector3(0.155, -0.01, -0.42), color: new THREE.Color(1.0, 0.62, 0.3).multiplyScalar(0.005) },
      ]);
    }

    const room = new THREE.Group();
    scene.add(room);
    let sun = null;
    let haze = null;
    let bell = null;
    let strip = null;
    let stringMesh = null;
    let cookie = null;

    function build() {
      // a rebuild (window resized) frees the old room first: its geometries,
      // and the sun's shadow maps
      room.traverse((o) => { o.geometry?.dispose(); if (o.isLight) o.dispose?.(); });
      room.clear();
      const B = new Builder();
      const t = 0.02; // wall thickness (outside the box)
      const D = DEPTH;
      const noShadow = { cast: false, receive: false };
      // floor boards running back (strong perspective lines)
      B.add('floor', mats.floor, planeUV(W, D, 1), mat4([0, -H / 2, -D / 2], [-Math.PI / 2, 0, 0]), { cast: false });
      for (let x = -W / 2 + 0.035; x < W / 2; x += 0.035) {
        B.box('frame', mats.frame, [0.0012, 0.0006, D], [x, -H / 2 + 0.0003, -D / 2], [0, 0, 0], { cast: false });
      }
      // ceiling: dark boards on battens, slender rods (sao) running back under
      // them, a molding round the edge; the floor's sun patches bounce onto it
      B.box('ceiling', mats.ceiling, [W, t, D], [0, H / 2 + t / 2, -D / 2]);
      for (let z = -0.03; z > -D; z -= 0.06) B.box('frame', mats.frame, [W, 0.006, 0.008], [0, H / 2 - 0.003, z], [0, 0, 0], noShadow);
      for (let x = -W / 2 + W / 7; x < W / 2 - 0.01; x += W / 7) B.box('frame', mats.frame, [0.003, 0.003, D], [x, H / 2 - 0.0075, -D / 2], [0, 0, 0], noShadow);
      for (const [sx, sz, len, rot] of [[0, -D + 0.004, W, 0], [-W / 2 + 0.004, -D / 2, D, Math.PI / 2], [W / 2 - 0.004, -D / 2, D, Math.PI / 2]]) {
        B.box('frame', mats.frame, [len, 0.008, 0.008], [sx, H / 2 - 0.004, sz], [0, rot, 0], noShadow);
      }
      // back wall with a round opening (a ring of boxes around a circle)
      const R = Math.min(W, H) * 0.24;
      const cy = 0.02;
      const steps = 48;
      for (let i = 0; i < steps; i++) {
        const y0 = -H / 2 + (H * i) / steps;
        const y1 = -H / 2 + (H * (i + 1)) / steps;
        const ym = (y0 + y1) / 2 - cy;
        const half = Math.abs(ym) < R ? Math.sqrt(R * R - ym * ym) : 0;
        if (half <= 0) {
          B.box('wall', mats.wall, [W, y1 - y0, t], [0, (y0 + y1) / 2, -D - t / 2]);
        } else {
          const wl = W / 2 - half;
          B.box('wall', mats.wall, [wl, y1 - y0, t], [-W / 2 + wl / 2, (y0 + y1) / 2, -D - t / 2]);
          B.box('wall', mats.wall, [wl, y1 - y0, t], [W / 2 - wl / 2, (y0 + y1) / 2, -D - t / 2]);
        }
      }
      // round window: a dark timber ring and a bamboo cross, glazed; behind
      // it, far away, a dusk sky, two ranges of hills and the evening star
      B.add('frame', mats.frame, new THREE.TorusGeometry(R, 0.0045, 10, 96), mat4([0, cy, -D + 0.002]));
      B.add('frame', mats.frame, new THREE.TorusGeometry(R, 0.003, 8, 96), mat4([0, cy, -D - t]));
      B.box('frame', mats.frame, [0.0028, 2 * R, 0.003], [0, cy, -D - t / 2], [0, 0, 0], noShadow);
      B.box('frame', mats.frame, [2 * R, 0.0028, 0.003], [0, cy - R * 0.25, -D - t / 2], [0, 0, 0], noShadow);
      B.add('pane', mats.pane, new THREE.CircleGeometry(R, 64), mat4([0, cy, -D - t / 2 + 0.001]), noShadow);
      const skyZ = -D - 2.5;
      B.add('nightSky', mats.sky, new THREE.PlaneGeometry(1.8, 0.9), mat4([0, cy + 0.05, skyZ]), noShadow);
      const hills = (z, base, amp, seed, key, mat, w) => {
        const r = rng(seed);
        const sh = new THREE.Shape();
        sh.moveTo(-w / 2, base - 2);
        const n = 40;
        const ph = [r() * 6, r() * 6, r() * 6];
        for (let i = 0; i <= n; i++) {
          const x = -w / 2 + (w * i) / n;
          const y = base + amp * (0.55 * Math.sin(x * 2.2 / w * 6 + ph[0]) + 0.3 * Math.sin(x * 5.1 / w * 6 + ph[1]) + 0.15 * Math.sin(x * 11 / w * 6 + ph[2]));
          sh.lineTo(x, y);
        }
        sh.lineTo(w / 2, base - 2);
        B.add(key, mat, new THREE.ShapeGeometry(sh), mat4([0, 0, z]), noShadow);
      };
      hills(-D - 1.6, cy - 0.035, 0.03, 3, 'hillFar', mats.hillFar, 1.6);
      hills(-D - 0.7, cy - 0.042, 0.02, 8, 'hillNear', mats.hillNear, 1.0);
      // the evening star, far enough to read as "at infinity"
      B.add('star', mats.star, new THREE.SphereGeometry(0.009, 8, 6), mat4([0.12, 0.26, -D - 6]), noShadow);
      // right wall (solid) and left wall with the shoji window
      // the right wall, with a fusuma slid open near the glass onto the room
      // next door (nextroom.js)
      const RX = W / 2 + t / 2;
      B.box('wall', mats.wall, [t, H, -SIDE.z1], [RX, 0, SIDE.z1 / 2]);
      B.box('wall', mats.wall, [t, H / 2 - SIDE.y1, SIDE.z1 - SIDE.z0], [RX, (H / 2 + SIDE.y1) / 2, (SIDE.z0 + SIDE.z1) / 2]);
      B.box('wall', mats.wall, [t, H, D + SIDE.z0], [RX, 0, (SIDE.z0 - D) / 2]);
      B.box('frame', mats.frame, [0.012, H, 0.01], [W / 2 - 0.004, 0, SIDE.z0 - 0.005]);
      B.box('frame', mats.frame, [0.012, H, 0.008], [W / 2 - 0.004, 0, SIDE.z1 - 0.004]);
      B.box('frame', mats.frame, [t + 0.012, 0.009, SIDE.z1 - SIDE.z0], [RX - 0.004, SIDE.y1 + 0.0045, (SIDE.z0 + SIDE.z1) / 2]);
      B.box('frame', mats.frame, [t + 0.012, 0.004, SIDE.z1 - SIDE.z0], [RX - 0.004, -H / 2 + 0.002, (SIDE.z0 + SIDE.z1) / 2], [0, 0, 0], { cast: false });
      const L = -W / 2 - t / 2;
      // in front of the lattice window, the shoji door stands slid open: the
      // wall is cut from the floor to the lintel, onto the engawa (garden.js)
      B.box('wall', mats.wall, [t, H, -DOOR.z1], [L, 0, DOOR.z1 / 2]);
      B.box('wall', mats.wall, [t, H / 2 - DOOR.y1, DOOR.z1 - DOOR.z0], [L, (H / 2 + DOOR.y1) / 2, (DOOR.z0 + DOOR.z1) / 2]);
      B.box('wall', mats.wall, [t, H, DOOR.z0 - WIN.z1], [L, 0, (DOOR.z0 + WIN.z1) / 2]);
      // its post, lintel and sill (the sill's two grooves are the track)
      B.box('frame', mats.frame, [0.012, H, 0.011], [-W / 2 + 0.004, 0, (DOOR.z0 + WIN.z1) / 2]);
      B.box('frame', mats.frame, [0.012, H, 0.008], [-W / 2 + 0.004, 0, DOOR.z1 - 0.004]);
      B.box('frame', mats.frame, [t + 0.012, 0.009, DOOR.z1 - DOOR.z0], [L + 0.004, DOOR.y1 + 0.0045, (DOOR.z0 + DOOR.z1) / 2]);
      B.box('frame', mats.frame, [t + 0.012, 0.004, DOOR.z1 - DOOR.z0], [L + 0.004, -H / 2 + 0.002, (DOOR.z0 + DOOR.z1) / 2], [0, 0, 0], { cast: false });
      for (const dx of [-0.006, 0.002]) B.box('lacquer', mats.lacquer, [0.0016, 0.0006, DOOR.z1 - DOOR.z0], [L + dx, -H / 2 + 0.0042, (DOOR.z0 + DOOR.z1) / 2], [0, 0, 0], noShadow);
      B.box('wall', mats.wall, [t, H, D + WIN.z0], [L, 0, (WIN.z0 - D) / 2]);
      B.box('wall', mats.wall, [t, H / 2 - WIN.y1, WIN.z1 - WIN.z0], [L, (H / 2 + WIN.y1) / 2, (WIN.z0 + WIN.z1) / 2]);
      B.box('wall', mats.wall, [t, WIN.y0 + H / 2, WIN.z1 - WIN.z0], [L, (WIN.y0 - H / 2) / 2, (WIN.z0 + WIN.z1) / 2]);
      // the lattice itself: dark bars, drawn but not shadow-casting (the
      // cookie projects them)
      for (let k = 1; k < WIN.cols; k++) B.box('frame', mats.frame, [0.006, WIN.y1 - WIN.y0, WIN.bar], [-W / 2 - 0.004, (WIN.y0 + WIN.y1) / 2, WIN.z0 + ((WIN.z1 - WIN.z0) * k) / WIN.cols], [0, 0, 0], noShadow);
      for (let k = 1; k < WIN.rows; k++) B.box('frame', mats.frame, [0.006, WIN.bar, WIN.z1 - WIN.z0], [-W / 2 - 0.004, WIN.y0 + ((WIN.y1 - WIN.y0) * k) / WIN.rows, (WIN.z0 + WIN.z1) / 2], [0, 0, 0], noShadow);
      // the paper, pasted on the outer face of the lattice (the bars read dark
      // against it); no shadow: the cookie already carries the lattice
      B.add('shojiPaper', mats.shojiPaper, new THREE.PlaneGeometry(WIN.z1 - WIN.z0, WIN.y1 - WIN.y0), mat4([-W / 2 - 0.0075, (WIN.y0 + WIN.y1) / 2, (WIN.z0 + WIN.z1) / 2], [0, Math.PI / 2, 0]), noShadow);
      // window casing
      for (const [y, h] of [[WIN.y0 - 0.003, 0.006], [WIN.y1 + 0.003, 0.006]]) B.box('frame', mats.frame, [0.012, h, WIN.z1 - WIN.z0 + 0.012], [-W / 2 + 0.002, y, (WIN.z0 + WIN.z1) / 2], [0, 0, 0], noShadow);
      for (const z of [WIN.z0 - 0.003, WIN.z1 + 0.003]) B.box('frame', mats.frame, [0.012, WIN.y1 - WIN.y0 + 0.012, 0.006], [-W / 2 + 0.002, (WIN.y0 + WIN.y1) / 2, z], [0, 0, 0], noShadow);
      // nested portal frames at three depths (posts and lintels), dark timber
      for (const z of FRAMES) {
        const w = 0.012;
        B.box('frame', mats.frame, [w, H, w], [-W / 2 + w / 2 + 0.002, 0, z]);
        B.box('frame', mats.frame, [w, H, w], [W / 2 - w / 2 - 0.002, 0, z]);
        B.box('frame', mats.frame, [W, w * 1.3, w], [0, H / 2 - w * 0.65 - 0.002, z]);
        B.box('frame', mats.frame, [W, 0.004, w * 1.4], [0, -H / 2 + 0.002, z], [0, 0, 0], { cast: false });
      }
      // low lacquer table with a turned tea bowl
      const tx = 0.055;
      const tz = -0.29;
      B.box('lacquer', mats.lacquer, [0.11, 0.006, 0.06], [tx, -H / 2 + 0.03, tz]);
      for (const [ox, oz] of [[-0.048, -0.024], [0.048, -0.024], [-0.048, 0.024], [0.048, 0.024]]) B.box('lacquer', mats.lacquer, [0.006, 0.027, 0.006], [tx + ox, -H / 2 + 0.0135, tz + oz]);
      const bowlProfile = [[0, 0.0032], [0.0085, 0.0032], [0.009, 0], [0.0122, 0], [0.0127, 0.0035], [0.0158, 0.0055], [0.0188, 0.0115], [0.0207, 0.0195], [0.021, 0.0255], [0.0196, 0.0258], [0.0189, 0.02], [0.017, 0.0122], [0.0135, 0.0072], [0, 0.0062]];
      const bowl = new THREE.LatheGeometry(bowlProfile.map(([r, y]) => new THREE.Vector2(r * 0.85, y * 0.85)), 48);
      B.add('ceramic', mats.ceramic, bowl, mat4([tx + 0.012, -H / 2 + 0.033, tz]));
      // vase (smooth lathe) with a flowering plum branch
      const vx = -0.088;
      const vz = -0.21;
      const vaseProfile = [[0, 0], [0.011, 0], [0.0145, 0.006], [0.0165, 0.016], [0.015, 0.03], [0.009, 0.042], [0.0055, 0.048], [0.0058, 0.054], [0.0068, 0.056], [0.0046, 0.056], [0.0042, 0.05], [0, 0.05]];
      B.add('ceramicIn', mats.ceramicIn, new THREE.LatheGeometry(vaseProfile.map(([r, y]) => new THREE.Vector2(r, y)), 48), mat4([vx, -H / 2, vz]));
      const yb = -H / 2 + 0.05;
      const r0 = rng(21);
      const main = taperTube([[vx, yb, vz], [vx + 0.004, yb + 0.04, vz - 0.004], [vx + 0.018, yb + 0.075, vz - 0.01], [vx + 0.045, yb + 0.095, vz - 0.02], [vx + 0.085, yb + 0.1, vz - 0.03], [vx + 0.115, yb + 0.093, vz - 0.034]], 0.0026, 0.0007);
      B.add('branch', mats.branch, main.geo);
      const twigs = [main.curve];
      for (const [ta, dir, len] of [[0.35, [-0.6, 0.8, 0.1], 0.04], [0.55, [0.2, 1.0, 0.25], 0.035], [0.75, [0.5, 0.6, -0.5], 0.03], [0.9, [0.8, -0.3, 0.3], 0.025]]) {
        const p = main.curve.getPointAt(ta);
        const d = new THREE.Vector3(...dir).normalize();
        const a = p.toArray();
        const mid = p.clone().addScaledVector(d, len * 0.5).add(new THREE.Vector3(0, 0.004, 0)).toArray();
        const b = p.clone().addScaledVector(d, len).toArray();
        const tw = taperTube([a, mid, b], 0.0012, 0.0004, 10, 5);
        B.add('branch', mats.branch, tw.geo);
        twigs.push(tw.curve);
      }
      // blossoms sit on the wood (not floating at the tips), with buds
      const bl = blossomGeometry(0.0042);
      for (const curve of twigs) {
        const n = curve === main.curve ? 9 : 4;
        for (let i = 0; i < n; i++) {
          const ta = 0.25 + 0.75 * (i + r0() * 0.6) / n;
          const p = curve.getPointAt(Math.min(ta, 1));
          const face = new THREE.Euler(-0.4 + r0() * 0.8, r0() * 6.28, -0.6 + r0() * 1.2);
          const off = new THREE.Vector3(0, 0.0014, 0.0016).applyEuler(face);
          const at = p.clone().add(off);
          if (r0() < 0.68) {
            B.add('blossom', mats.blossom, bl.clone(), new THREE.Matrix4().compose(at, new THREE.Quaternion().setFromEuler(face), new THREE.Vector3(1, 1, 1).multiplyScalar(0.8 + r0() * 0.4)));
            B.add('stamen', mats.stamen, new THREE.SphereGeometry(0.0009, 6, 4), new THREE.Matrix4().compose(at.clone().add(new THREE.Vector3(0, 0.0008, 0).applyEuler(face)), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)));
          } else {
            B.add('blossomBud', mats.blossomBud, new THREE.SphereGeometry(0.0016, 8, 6), new THREE.Matrix4().compose(at, new THREE.Quaternion(), new THREE.Vector3(1, 1.2, 1)));
          }
        }
      }
      // standing paper lantern (andon) at front left: legs, rails, four
      // paper panels glowing from within
      const an = [-0.118, -H / 2, -0.075];
      const aw = 0.03;
      const ah = 0.05;
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        const p = new THREE.Vector3(Math.sin(a) * aw / 2, 0, Math.cos(a) * aw / 2);
        B.add('lanternPaper', mats.lanternPaper, new THREE.PlaneGeometry(aw, ah), mat4([an[0] + p.x, an[1] + 0.012 + ah / 2, an[2] + p.z], [0, a, 0]), noShadow);
      }
      for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.box('lacquer', mats.lacquer, [0.003, 0.068, 0.003], [an[0] + (ox * aw) / 2, an[1] + 0.034, an[2] + (oz * aw) / 2]);
      for (const y of [0.012, 0.012 + ah]) {
        for (const s of [-1, 1]) {
          B.box('lacquer', mats.lacquer, [aw + 0.003, 0.0025, 0.0025], [an[0], an[1] + y, an[2] + (s * aw) / 2]);
          B.box('lacquer', mats.lacquer, [0.0025, 0.0025, aw + 0.003], [an[0] + (s * aw) / 2, an[1] + y, an[2]]);
        }
      }
      // the engawa, the garden, the ridges and the evening sky outside the door
      const garden = buildGarden(B, mats, { W, H, D });
      const next = buildNextRoom(B, mats, { W, H, D });
      if (!nextLit) { lightNextRoom(mats, next.lantern); nextLit = true; }
      B.build(room);
      room.add(garden.sky);

      // the wind-chime: string from the ceiling just inside the box to a
      // bell 5 cm in front of the glass, well inside the frame
      const top = new THREE.Vector3(0.05, H / 2, -0.03);
      // 3 cm in front of the glass and a little lower than the top: inside
      // the frame from every eye the view limits allow (tests/scenes)
      const bellPos = new THREE.Vector3(0.05, H / 2 - 0.0626, 0.03);
      const sg = new THREE.CylinderGeometry(0.0004, 0.0004, 1, 4);
      stringMesh = new THREE.Mesh(sg, mats.string);
      stringMesh.name = 'bell';
      room.add(stringMesh);
      bell = new THREE.Group();
      const bellGeo = new THREE.LatheGeometry([[0.0, 0.012], [0.004, 0.0115], [0.0085, 0.008], [0.0105, 0.002], [0.011, 0.0]].map(([r, y]) => new THREE.Vector2(r, y)), 32);
      const bellMesh = new THREE.Mesh(bellGeo, mats.brass);
      bellMesh.castShadow = true;
      bellMesh.name = 'bell';
      bell.add(bellMesh);
      strip = new THREE.Mesh(new THREE.PlaneGeometry(0.008, 0.03), mats.paperStrip);
      strip.position.y = -0.018;
      strip.castShadow = true;
      strip.name = 'bell';
      bell.add(strip);
      bell.userData = { top, rest: bellPos };
      room.add(bell);

      // ---------------- light: a low warm sun through the shoji
      sun = new THREE.SpotLight(0xffbe80, 7.2, 0, 0.3, 0.0, 2);
      sun.position.set(-W / 2 - 0.42, 0.13, -0.1);
      const aimAt = new THREE.Vector3(0.1, -H / 2 + 0.01, -0.36);
      sun.target.position.copy(aimAt);
      sun.castShadow = true;
      sun.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024);
      sun.shadow.camera.near = 0.05;
      sun.shadow.camera.far = 2;
      sun.shadow.radius = 2;
      sun.shadow.blurSamples = 8;
      // wall and floor sit at a grazing angle to this sun: without the extra
      // bias VSM prints diagonal acne inside the lit patches
      sun.shadow.bias = -0.003;
      sun.shadow.normalBias = 0.003;
      cookie?.dispose();
      cookie = latticeCookie(sun, aimAt, -W / 2 - 0.004, high ? 1024 : 512);
      sun.map = cookie;
      room.add(sun, sun.target);
      // low fill: the room's bounce, warm from the floor
      const fill = new THREE.HemisphereLight(0x9a8a78, 0x6a4a30, 0.22);
      room.add(fill);
      room.updateMatrixWorld(true);
      renderer.shadowMap.needsUpdate = true;
      if (haze) haze.dispose();
      haze = new Haze({
        density: 1.4,
        ambient: new THREE.Color(0.0006, 0.0005, 0.0004),
        lights: [HazeLight.fromSpot(sun, { anisotropy: 0.6, intensity: 3.4, shadowSize: high ? 768 : 384 })],
        scale: high ? 6 : 8,
        steps: high ? 16 : 8,
        maxDist: 1.2,
        shadows: high,
        // dust only inside the room
        footprint: { rect: [-W / 2, -DEPTH, W / 2, 0.0], soft: 0.01 },
      });
      haze.bake(renderer, scene);
      if (pipe) pipe.haze = haze;
      // The room's shell blocks the haze bake (the shaft comes through the
      // window only) but needn't cast in the sun's shadow map: the cookie
      // already cuts the window, and VSM self-shadowing on large flat walls
      // at this grazing angle prints diagonal acne inside the sun patches.
      room.traverse((o) => { if (o.isMesh && ['wall', 'floor', 'ceiling'].includes(o.name)) o.castShadow = false; });
      renderer.shadowMap.needsUpdate = true;
    }

    let pipe = null;
    build();
    pipe = new FilmPipeline(renderer, {
      quality,
      haze,
      settings: {
        exposure: 1.5,
        bloom: 0.045,
        bloomTint: new THREE.Color(1.0, 0.94, 0.88),
        // a warm floor under the blacks (luma ~4) so the umber keeps texture
        lift: new THREE.Vector3(0.0016, 0.0011, 0.0014),
        gain: new THREE.Vector3(1.0, 0.98, 0.95),
        saturation: 1.08,
        contrast: 1.06,
      },
    });

    await warmUp(renderer, [scene], (cam) => pipe.render(scene, cam), { width: W, height: H });
    const up = new THREE.Vector3(0, 1, 0);
    const _pos = new THREE.Vector3(); // per-frame scratch (no allocations in update)
    const _dir = new THREE.Vector3();
    return {
      scene,
      pipeline: pipe,
      debug: { get haze() { return haze; }, get sun() { return sun; } },
      update(dt, time) {
        // the bell swings a little, its paper strip flutters
        const { top, rest } = bell.userData;
        const sw = 0.004 * Math.sin(time * 1.3) + 0.0015 * Math.sin(time * 3.1);
        const pos = _pos.copy(rest);
        pos.x += sw;
        pos.z += 0.3 * sw;
        bell.position.copy(pos);
        strip.rotation.set(0.25 * Math.sin(time * 2.2), 0, 0.3 * Math.sin(time * 1.7 + 1));
        const dir = _dir.copy(top).sub(pos);
        const len = dir.length();
        stringMesh.position.copy(pos).addScaledVector(dir, 0.5);
        stringMesh.position.y += 0.006;
        stringMesh.scale.set(1, len, 1);
        stringMesh.quaternion.setFromUnitVectors(up, dir.normalize());
      },
      resize(size) {
        if (Math.abs(size.width - W) < 1e-6 && Math.abs(size.height - H) < 1e-6) return;
        W = size.width;
        H = size.height;
        build();
      },
      render(r, camera, opts = {}) {
        pipe.render(scene, camera, { bloom: !opts.check });
      },
      dispose() {
        pipe.dispose();
        haze?.dispose();
        cookie?.dispose();
        scene.traverse((o) => { o.geometry?.dispose(); if (o.isLight) o.dispose?.(); });
        for (const m of Object.values(mats)) { m.map?.dispose(); m.dispose(); }
        envRT.dispose();
        renderer.shadowMap.enabled = prevShadow.enabled;
        renderer.shadowMap.type = prevShadow.type;
        renderer.shadowMap.autoUpdate = prevShadow.auto;
      },
    };
  },
};

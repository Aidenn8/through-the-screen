#!/usr/bin/env node
// Synthetic webcam video of a head moving along a known 3D path, for testing
// the tracker against ground truth.
//
// A portrait photo is mapped onto MediaPipe's canonical face mesh (UVs = the
// photo's own landmarks), posed in 3D, and rendered through pinhole intrinsics
// identical to the app's camera preset. The ground-truth pupil is the 3D point
// the photo's iris centre lands on. Output: a .y4m Chrome can play as a fake
// webcam (--use-file-for-fake-video-capture) and a truth .json.
//
// Usage: node tools/core-facegen.mjs --photo face.jpg --out DIR [--seconds 19] [--noise 2.5] [--hfov 68]
// Needs the dev server (npm run dev) on WD_BASE (default http://localhost:5190/).

import { readFileSync, writeFileSync, openSync, writeSync, closeSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { canonical, headRotation } from '../tests/helpers/synthetic-face.js';
import { launch, watch, BASE } from './core-browser.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const PHOTO = arg('photo');
const OUT = arg('out');
const SECONDS = Number(arg('seconds', 19));
const FPS = Number(arg('fps', 30));
const NOISE = Number(arg('noise', 2.5));
const HFOV = Number(arg('hfov', 68));
const NAME = arg('name', 'face');
const W = 1280;
const H = 720;
if (!PHOTO || !OUT) {
  console.error('usage: node tools/core-facegen.mjs --photo face.jpg --out DIR');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

// ---- path ---------------------------------------------------------------
const ss = (a, b, t) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };
const env = (a, b, t) => ss(a, a + 0.6, t) * (1 - ss(b - 0.6, b, t));
const BASEPOSE = { x: 0, y: 0.1, z: 0.6, yaw: 0, pitch: -6, roll: 0 };
const STILL2 = { x: 0.07, y: 0.08, z: 0.5, yaw: 18, pitch: -4, roll: 0 };

export function poseAt(t) {
  const p = { ...BASEPOSE };
  const w = 2 * Math.PI;
  // 3-8 s: sideways sway, +-13 cm at 0.4 Hz (peak 0.33 m/s), head turning slightly.
  let e = env(3, 8, t);
  p.x += 0.13 * Math.sin(w * 0.4 * (t - 3)) * e;
  p.yaw += -8 * Math.sin(w * 0.4 * (t - 3)) * e;
  // 8-11.5 s: lean in and out, 40-80 cm.
  e = env(8, 11.5, t);
  p.z += 0.2 * Math.sin(w * 0.3 * (t - 8)) * e;
  // 11.5-14.5 s: bob, turn +-25 deg, roll.
  e = env(11.5, 14.5, t);
  p.y += 0.06 * Math.sin(w * 0.35 * (t - 11.5)) * e;
  p.yaw += 25 * Math.sin(w * 0.33 * (t - 11.5)) * e;
  p.roll += 6 * Math.sin(w * 0.5 * (t - 11.5)) * e;
  // 14.5 s on: move to a second still pose (off-axis, closer, turned), hold,
  // then glide back so the clip loops without a jump.
  const b = ss(14.5, 15.5, t) * (1 - ss(16.8, 18.2, t));
  for (const k of Object.keys(p)) p[k] += (STILL2[k] - BASEPOSE[k]) * b;
  return p;
}

// ---- geometry -------------------------------------------------------------
const c = canonical(); // metres, 468 verts, tris
const verts = c.verts;
const tris = c.tris;

function bary(p, a, b, q) {
  const v0 = [b[0] - a[0], b[1] - a[1]];
  const v1 = [q[0] - a[0], q[1] - a[1]];
  const v2 = [p[0] - a[0], p[1] - a[1]];
  const d = v0[0] * v1[1] - v1[0] * v0[1];
  if (Math.abs(d) < 1e-12) return null;
  const u = (v2[0] * v1[1] - v1[0] * v2[1]) / d;
  const v = (v0[0] * v2[1] - v2[0] * v0[1]) / d;
  return [1 - u - v, u, v];
}

function locate(uv, uvs) {
  for (const [i, j, k] of tris) {
    const w = bary(uv, uvs[i], uvs[j], uvs[k]);
    if (w && w.every((x) => x >= -1e-6)) return { ids: [i, j, k], w };
  }
  return null;
}

const blend = (loc, P) => {
  const o = { x: 0, y: 0, z: 0 };
  loc.ids.forEach((id, n) => { o.x += P[id].x * loc.w[n]; o.y += P[id].y * loc.w[n]; o.z += P[id].z * loc.w[n]; });
  return o;
};

function matVec(m, a) {
  return {
    x: m[0][0] * a.x + m[0][1] * a.y + m[0][2] * a.z,
    y: m[1][0] * a.x + m[1][1] * a.y + m[1][2] * a.z,
    z: m[2][0] * a.x + m[2][1] * a.y + m[2][2] * a.z,
  };
}
const BASE_ROT = [[1, 0, 0], [0, -1, 0], [0, 0, -1]];
const mul3 = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));

// ---- run ------------------------------------------------------------------
const { browser, context } = await launch();
const page = await context.newPage();
const log = watch(page);
await page.goto(`${BASE}tools/core-facegen.html`);
await page.waitForFunction(() => window.facegenReady === true, null, { timeout: 30000 });
const mime = extname(PHOTO).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
const dataUrl = `data:${mime};base64,${readFileSync(PHOTO).toString('base64')}`;
const photo = await page.evaluate((u) => window.photoLandmarks(u), dataUrl);
if (!photo.landmarks) {
  console.error('No face found in the photo.', log.join('\n'));
  await browser.close();
  process.exit(1);
}
const lm = photo.landmarks;
const uvs = lm.slice(0, 468).map((p) => [p.x, p.y]);
// Which photo iris is the subject's right eye: nearest to corners 33/133.
const mid = (a, b) => [(lm[a].x + lm[b].x) / 2, (lm[a].y + lm[b].y) / 2];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const rMid = mid(33, 133);
const i468 = [lm[468].x, lm[468].y];
const i473 = [lm[473].x, lm[473].y];
const [irisR, irisL] = dist(i468, rMid) < dist(i473, rMid) ? [i468, i473] : [i473, i468];
const locR = locate(irisR, uvs);
const locL = locate(irisL, uvs);
if (!locR || !locL) {
  console.error('Iris centre is outside the mesh UVs.');
  await browser.close();
  process.exit(1);
}
const canonR = blend(locR, verts);
const canonL = blend(locL, verts);
const anchor = { x: (canonR.x + canonL.x) / 2, y: (canonR.y + canonL.y) / 2, z: (canonR.z + canonL.z) / 2 };
const ipd = Math.hypot(canonR.x - canonL.x, canonR.y - canonL.y, canonR.z - canonL.z);
console.log(`photo ${photo.width}x${photo.height}, true IPD of the textured mesh ${(ipd * 1000).toFixed(2)} mm`);

const vfov = (2 * Math.atan(Math.tan((HFOV * Math.PI) / 360) * (H / W)) * 180) / Math.PI;
await page.evaluate((o) => window.setupRenderer(o), {
  width: W, height: H, vfovDeg: vfov, photo: dataUrl, uvs: uvs.flat(), tris: tris.flat(),
});

const y4m = join(OUT, `${NAME}.y4m`);
const fd = openSync(y4m, 'w');
writeSync(fd, `YUV4MPEG2 W${W} H${H} F${FPS}:1 Ip A1:1 C420jpeg\n`);
const frames = Math.round(SECONDS * FPS);
const truth = [];
const headCentre = { x: 0, y: 0.015, z: -0.045 };
const headRadii = [0.074, 0.096, 0.086];
const t0 = Date.now();
for (let f = 0; f < frames; f++) {
  const t = f / FPS;
  const p = poseAt(t);
  const R = mul3(headRotation(p.yaw, p.pitch, p.roll), BASE_ROT);
  const place = (q) => {
    const r = matVec(R, { x: q.x - anchor.x, y: q.y - anchor.y, z: q.z - anchor.z });
    return { x: p.x + r.x, y: p.y + r.y, z: p.z + r.z };
  };
  const posed = verts.map(place);
  const right = blend(locR, posed);
  const left = blend(locL, posed);
  const hc = place(headCentre);
  // Column-major 4x4: R * diag(radii), translated to the head centre.
  const head = [];
  for (let col = 0; col < 3; col++) head.push(R[0][col] * headRadii[col], R[1][col] * headRadii[col], R[2][col] * headRadii[col], 0);
  head.push(hc.x, hc.y, hc.z, 1);
  const flat = new Float32Array(468 * 3);
  posed.forEach((q, i) => { flat[i * 3] = q.x; flat[i * 3 + 1] = q.y; flat[i * 3 + 2] = q.z; });
  const b64 = await page.evaluate(([v, h, id, n]) => window.renderFrame(v, h, id, n), [Array.from(flat), head, f, NOISE]);
  writeSync(fd, 'FRAME\n');
  writeSync(fd, Buffer.from(b64, 'base64'));
  const preview = arg('preview');
  if (preview && [0, Math.round(5 * FPS), Math.round(12.8 * FPS), frames - 1].includes(f)) {
    await page.locator('canvas').screenshot({ path: `${preview}-${f}.png` });
  }
  truth.push({ f, t, pose: p, right, left, centre: { x: (right.x + left.x) / 2, y: (right.y + left.y) / 2, z: (right.z + left.z) / 2 } });
  if (f % 60 === 0) process.stdout.write(`frame ${f}/${frames} (${((Date.now() - t0) / 1000).toFixed(0)} s)\n`);
}
closeSync(fd);
writeFileSync(join(OUT, `${NAME}.truth.json`), JSON.stringify({ fps: FPS, width: W, height: H, hfovDeg: HFOV, ipd, noise: NOISE, frames: truth }));
console.log(`wrote ${y4m} (${frames} frames) and truth`);
await browser.close();

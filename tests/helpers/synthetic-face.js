// Synthetic face landmarks: MediaPipe's canonical face mesh (478 points with
// iris), posed in 3D and projected through known pinhole intrinsics. Gives the
// eye solver inputs with exact ground truth.
//
// Physical eye model: eyeball rotation centres sit behind the eye-opening
// centroids; pupils sit PUPIL_R in front of the rotation centres and turn toward
// a gaze target, like real eyes converging on the screen.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export const RIGHT_RING = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
export const LEFT_RING = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
const PUPIL_R = 0.0105;
const IRIS_R = 0.0117 / 2;

let cached = null;
export function canonical() {
  if (cached) return cached;
  const text = readFileSync(join(here, '..', 'fixtures', 'canonical_face_model.obj'), 'utf8');
  const verts = [];
  const tris = [];
  for (const line of text.split('\n')) {
    const p = line.trim().split(/\s+/);
    if (p[0] === 'v') verts.push({ x: +p[1] / 100, y: +p[2] / 100, z: +p[3] / 100 }); // cm -> m
    if (p[0] === 'f') tris.push(p.slice(1, 4).map((s) => parseInt(s, 10) - 1));
  }
  const centroid = (ids) => {
    const c = { x: 0, y: 0, z: 0 };
    for (const i of ids) { c.x += verts[i].x; c.y += verts[i].y; c.z += verts[i].z; }
    return { x: c.x / ids.length, y: c.y / ids.length, z: c.z / ids.length };
  };
  cached = { verts, tris, rightOpen: centroid(RIGHT_RING), leftOpen: centroid(LEFT_RING) };
  return cached;
}

// --- tiny linear algebra -------------------------------------------------
const v = (x, y, z) => ({ x, y, z });
const add = (a, b) => v(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a, b) => v(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a, s) => v(a.x * s, a.y * s, a.z * s);
const len = (a) => Math.hypot(a.x, a.y, a.z);
const norm = (a) => mul(a, 1 / len(a));
const matVec = (m, a) => v(
  m[0][0] * a.x + m[0][1] * a.y + m[0][2] * a.z,
  m[1][0] * a.x + m[1][1] * a.y + m[1][2] * a.z,
  m[2][0] * a.x + m[2][1] * a.y + m[2][2] * a.z,
);
const matMul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const deg = Math.PI / 180;

/**
 * Head rotation in camera (CV) coordinates from yaw/pitch/roll in degrees.
 * yaw > 0 turns the face toward the viewer's own left (camera +x side)...
 * the sign only matters for consistency between truth and solve.
 */
export function headRotation(yawDeg = 0, pitchDeg = 0, rollDeg = 0) {
  const cy = Math.cos(yawDeg * deg), sy = Math.sin(yawDeg * deg);
  const cp = Math.cos(pitchDeg * deg), sp = Math.sin(pitchDeg * deg);
  const cr = Math.cos(rollDeg * deg), sr = Math.sin(rollDeg * deg);
  const Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
  const Rx = [[1, 0, 0], [0, cp, -sp], [0, sp, cp]];
  const Rz = [[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]];
  return matMul(Ry, matMul(Rx, Rz));
}

// Canonical (x: subject's left, y: up, z: out of the face) -> camera facing
// the subject (x right in image, y down, z away from camera).
const BASE = [[1, 0, 0], [0, -1, 0], [0, 0, -1]];

/**
 * Pose the canonical face and project it.
 * @param {object} o
 * @param {{x,y,z}} o.mid   eye-midpoint (rotation centres) position, camera coords (m)
 * @param {number} [o.yaw] [o.pitch] [o.roll] degrees
 * @param {number} [o.ipd] distance between eyeball rotation centres (m)
 * @param {{x,y,z}} [o.gaze] gaze target in camera coords (default: the camera)
 * @param {{fx,fy,cx,cy,width,height}} o.intr
 * @returns {{landmarks, matrix, truth:{right,left,centre,axis,up}}}
 */
export function syntheticFace(o) {
  const c = canonical();
  const ipd = o.ipd ?? 0.063;
  const R = matMul(headRotation(o.yaw, o.pitch, o.roll), BASE);
  const openMid = mul(add(c.rightOpen, c.leftOpen), 0.5);
  const s = ipd / len(sub(c.leftOpen, c.rightOpen));
  // Rotation centres sit ~11 mm behind the eye openings (canonical z is out of the face).
  const behind = v(0, 0, -0.011 / s);
  const toCam = (p) => add(o.mid, matVec(R, mul(sub(p, openMid), s)));
  const rotR = toCam(add(c.rightOpen, behind));
  const rotL = toCam(add(c.leftOpen, behind));
  const midRot = mul(add(rotR, rotL), 0.5);
  // Shift so o.mid is the midpoint of the rotation centres.
  const shift = sub(o.mid, midRot);
  const place = (p) => add(toCam(p), shift);
  const centreR = add(rotR, shift);
  const centreL = add(rotL, shift);
  const gaze = o.gaze ?? v(0, 0, 0);
  const pupilR = add(centreR, mul(norm(sub(gaze, centreR)), PUPIL_R));
  const pupilL = add(centreL, mul(norm(sub(gaze, centreL)), PUPIL_R));

  const pts = c.verts.map(place);
  // Iris rings: circles around each pupil, facing the gaze direction.
  const up = norm(matVec(R, v(0, 1, 0)));
  const ring = (pupil, centre) => {
    const n = norm(sub(pupil, centre));
    const e1 = norm(sub(up, mul(n, up.x * n.x + up.y * n.y + up.z * n.z)));
    const e2 = v(n.y * e1.z - n.z * e1.y, n.z * e1.x - n.x * e1.z, n.x * e1.y - n.y * e1.x);
    return [pupil, add(pupil, mul(e2, IRIS_R)), add(pupil, mul(e1, IRIS_R)), add(pupil, mul(e2, -IRIS_R)), add(pupil, mul(e1, -IRIS_R))];
  };
  pts.push(...ring(pupilR, centreR), ...ring(pupilL, centreL)); // 468-472, 473-477

  const { fx, fy, cx, cy, width: W, height: H } = o.intr;
  const zRef = midRot.z + shift.z;
  const landmarks = pts.map((p) => ({
    x: (fx * p.x / p.z + cx) / W,
    y: (fy * p.y / p.z + cy) / H,
    z: ((p.z - zRef) * fx) / (zRef * W),
  }));

  // MediaPipe-style facial transformation matrix (column-major), metric camera
  // space x right, y up, z toward the viewer: flip y and z of the CV rotation.
  const Rmp = [R[0], R[1].map((x) => -x), R[2].map((x) => -x)];
  const matrix = [
    Rmp[0][0], Rmp[1][0], Rmp[2][0], 0,
    Rmp[0][1], Rmp[1][1], Rmp[2][1], 0,
    Rmp[0][2], Rmp[1][2], Rmp[2][2], 0,
    o.mid.x * 100, -o.mid.y * 100, -o.mid.z * 100, 1,
  ];
  return {
    landmarks,
    matrix,
    truth: {
      right: pupilR,
      left: pupilL,
      centre: mul(add(pupilR, pupilL), 0.5),
      axis: norm(sub(centreL, centreR)),
      up,
    },
  };
}

/** Close the eyelids of a synthetic face: lids collapse, iris points drift. */
export function blink(landmarks, drift = 0.004) {
  const out = landmarks.map((p) => ({ ...p }));
  const pairs = [[159, 145], [158, 153], [160, 144], [386, 374], [385, 380], [387, 373]];
  for (const [u, d] of pairs) {
    const m = { x: (out[u].x + out[d].x) / 2, y: (out[u].y + out[d].y) / 2 };
    out[u].x = out[d].x = m.x;
    out[u].y = out[d].y = m.y;
  }
  for (let i = 468; i < 478; i++) out[i].y += drift; // the model guesses low while the lid is shut
  return out;
}

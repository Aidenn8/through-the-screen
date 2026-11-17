// People for the set: the diner's customers and cook, the crew on the stage.
// Procedural, in real metres (an adult ~1.75 m), posed by where their pelvis,
// hands and feet are (two-bone IK for arms and legs), dressed with vertex
// colours so every person in a region merges into one mesh and one draw.
//
// Body frame: pelvis centre at the origin, the person faces +z, x is their
// left-to-right as seen from behind, y up. `build` scales the whole figure.
// Shapes are built from rings of superellipses (torso, head) so shoulders
// slope into the neck and the chest is flatter than it is wide; hair grows
// from the scalp's own vertices above a hairline, so it sits on the head
// instead of capping it.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

export const SKIN = [0xc89a7a, 0x8a5a3c, 0xe0b49a, 0x6a4430, 0xb47e5e, 0xd8a888];
export const HAIR = { black: 0x161210, brown: 0x3e2a1c, auburn: 0x5a2614, grey: 0x5e5a56, blond: 0x8a7048, dark: 0x241a14 };

const L = { hipW: 0.092, thigh: 0.45, shin: 0.43, ankle: 0.075, shoulderW: 0.178, upper: 0.29, fore: 0.26 };

// cheap smooth noise for organic shapes (deterministic)
function n3(x, y, z) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}
function smoothNoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  let r = 0;
  for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) for (let dz = 0; dz < 2; dz++) {
    r += n3(xi + dx, yi + dy, zi + dz) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  }
  return r;
}

function finish(g, colorFn) {
  g = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
  const p = g.attributes.position;
  const a = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    colorFn(c, p.getX(i), p.getY(i), p.getZ(i), i);
    a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const flat = (color, k = 1) => { const base = new THREE.Color(color); return (c) => c.copy(base).multiplyScalar(k); };
// darker toward y0, full at y1: folds, the underside of a coat
const graded = (color, y0, y1, k = 0.35) => { const base = new THREE.Color(color); return (c, x, y) => c.copy(base).multiplyScalar(1 - k * THREE.MathUtils.clamp((y1 - y) / (y1 - y0), 0, 1)); };
// cloth: folds as soft dark bands around the body (the shade in a fold's
// trough), gathered at the waist of a shirt, hanging straight in a coat's
// skirt; `around` folds per turn, `slant` how much they lean with height
const folded = (colorFn, { around = 7, slant = 6, depth = 0.16, y0 = -1, y1 = 1, seed = 0 } = {}) => (c, x, y, z, i) => {
  colorFn(c, x, y, z, i);
  const a = Math.atan2(x, z);
  const band = 0.5 + 0.5 * Math.sin(a * around + y * slant + seed + 1.7 * smoothNoise(a * 2 + seed, y * 4, 0.5));
  const on = THREE.MathUtils.smoothstep(y, y0, y0 + 0.06) * (1 - THREE.MathUtils.smoothstep(y, y1 - 0.06, y1));
  c.multiplyScalar(1 - depth * on * band * band * band);
};

/**
 * A body of rings: [{ y, w, d, z, e }] half-width, half-depth, forward
 * offset, superellipse exponent (2 = ellipse, higher = squarer).
 */
function ringBody(rings, seg = 18, capTop = true, capBottom = true) {
  const pos = [];
  const idx = [];
  for (const r of rings) {
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const e = 2 / (r.e ?? 2.4);
      const x = Math.sign(ca) * Math.pow(Math.abs(ca), e) * r.w;
      const z = Math.sign(sa) * Math.pow(Math.abs(sa), e) * r.d + (r.z ?? 0);
      pos.push(x, r.y, z);
    }
  }
  const R = rings.length;
  for (let j = 0; j < R - 1; j++) for (let k = 0; k < seg; k++) {
    const a = j * seg + k, b = j * seg + ((k + 1) % seg), c = (j + 1) * seg + k, d = (j + 1) * seg + ((k + 1) % seg);
    idx.push(a, c, b, b, c, d);
  }
  const addCap = (j, up) => {
    const r = rings[j];
    const ci = pos.length / 3;
    pos.push(0, r.y, r.z ?? 0);
    for (let k = 0; k < seg; k++) {
      const a = j * seg + k, b = j * seg + ((k + 1) % seg);
      if (up) idx.push(b, a, ci); else idx.push(a, b, ci);
    }
  };
  if (capBottom) addCap(0, false);
  if (capTop) addCap(R - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function placed(g, pos, quat) {
  g.applyMatrix4(new THREE.Matrix4().compose(pos, quat, V(1, 1, 1)));
  return g;
}

// A tapered limb: a closed ring body along the segment a -> b.
function limb(parts, a, b, ra, rb, colorFn, { seg = 10, flatten = 0.92, roll = 0 } = {}) {
  const d = b.clone().sub(a);
  const len = d.length();
  if (len < 1e-4) return;
  const rings = [];
  const n = 4;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const r = ra + (rb - ra) * t;
    // a little bulge (muscle, a sleeve's fullness) a third of the way down
    const bulge = 1 + 0.08 * Math.sin(Math.PI * Math.min(1, t * 1.4));
    rings.push({ y: t * len, w: r * bulge, d: r * flatten * bulge, e: 2 });
  }
  const g = ringBody(rings, seg, false, false);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize());
  if (roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, roll));
  parts.push(finish(placed(g, a, q), colorFn));
  for (const [p, r] of [[a, ra], [b, rb]]) {
    const s = new THREE.SphereGeometry(r * 0.98, Math.min(seg, 9), 5);
    s.translate(p.x, p.y, p.z);
    parts.push(finish(s, colorFn));
  }
}

function ik(root, target, a, b, pole) {
  const d = target.clone().sub(root);
  let dist = THREE.MathUtils.clamp(d.length(), Math.abs(a - b) * 1.001 + 1e-4, (a + b) * 0.999);
  const dir = d.normalize();
  const cosA = (a * a + dist * dist - b * b) / (2 * a * dist);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const perp = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir)));
  if (perp.lengthSq() < 1e-8) perp.set(0, 0, 1);
  perp.normalize();
  return {
    mid: root.clone().add(dir.clone().multiplyScalar(a * cosA)).add(perp.multiplyScalar(a * sinA)),
    end: root.clone().add(dir.multiplyScalar(dist)),
  };
}

// The head: a sculpted superellipsoid (wider at the cranium, a jaw that
// narrows to the chin, a flat face), with brow, nose and ears. Head frame:
// origin at the head's centre, +z the face, y up. Returns the scalp sampler
// for the hair.
function headParts(parts, M, skin, { female = false } = {}) {
  const sk = new THREE.Color(skin);
  const rings = [];
  // y from chin to crown: half-width, half-depth, forward offset
  const prof = [
    [-0.118, 0.018, 0.02, 0.035], [-0.11, 0.035, 0.045, 0.03], [-0.095, 0.05, 0.07, 0.022], [-0.07, 0.06, 0.085, 0.012],
    [-0.04, 0.066, 0.093, 0.006], [-0.01, 0.07, 0.098, 0.0], [0.02, 0.074, 0.1, -0.003], [0.05, 0.076, 0.1, -0.006],
    [0.075, 0.072, 0.094, -0.008], [0.095, 0.062, 0.082, -0.01], [0.11, 0.045, 0.06, -0.012], [0.12, 0.022, 0.03, -0.012],
  ];
  const sx = female ? 0.95 : 1;
  for (const [y, w, d, z] of prof) rings.push({ y, w: w * sx, d, z, e: 2.15 });
  const head = ringBody(rings, 20);
  // flatten the face a little (the front third)
  const p = head.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    if (z > 0.06) p.setZ(i, 0.06 + (z - 0.06) * 0.7);
  }
  head.computeVertexNormals();
  parts.push(finish(head, (c, x, y) => c.copy(sk).multiplyScalar(0.97 + 0.05 * THREE.MathUtils.smoothstep(y, -0.1, 0.05))).applyMatrix4(M));
  // brow ridge, cheeks, nose, ears, a hint of the eyes' shade
  const add = (g, color) => parts.push(finish(g, flat(color)).applyMatrix4(M));
  const brow = new THREE.SphereGeometry(0.05, 10, 6);
  brow.scale(1.25, 0.32, 0.4);
  brow.translate(0, 0.03, 0.078);
  add(brow, sk);
  const nose = new THREE.CylinderGeometry(0.006, 0.017, 0.052, 6);
  nose.rotateX(-0.42);
  nose.translate(0, 0.0, 0.088);
  add(nose, sk);
  const tip = new THREE.SphereGeometry(0.014, 8, 6);
  tip.translate(0, -0.023, 0.098);
  add(tip, sk);
  for (const s of [-1, 1]) {
    const ear = new THREE.SphereGeometry(0.024, 8, 6);
    ear.scale(0.38, 1.15, 0.75);
    ear.translate(s * 0.074, 0.0, -0.008);
    add(ear, sk.clone().multiplyScalar(0.92));
    const white = new THREE.SphereGeometry(0.0085, 8, 6);
    white.scale(1.35, 0.8, 0.4);
    white.translate(s * 0.028, 0.011, 0.0855);
    add(white, new THREE.Color(0xd8d2c8).multiplyScalar(0.8));
    const iris = new THREE.SphereGeometry(0.0055, 8, 6);
    iris.scale(1, 1, 0.4);
    iris.translate(s * 0.027, 0.011, 0.0885);
    add(iris, new THREE.Color(0x1a120c));
    const cheek = new THREE.SphereGeometry(0.022, 8, 6);
    cheek.scale(1.1, 0.8, 0.6);
    cheek.translate(s * 0.04, -0.022, 0.078);
    add(cheek, sk);
  }
  const lips = new THREE.SphereGeometry(0.02, 8, 5);
  lips.scale(1.15, 0.32, 0.5);
  lips.translate(0, -0.055, 0.086);
  add(lips, sk.clone().multiplyScalar(female ? 0.78 : 0.86).lerp(new THREE.Color(0x8a3a3a), female ? 0.3 : 0.1));
}

// Hair grown from a scalp shell: the head's rings pushed out by a noisy
// thickness above a hairline, tucked inside the head below it.
function hairParts(parts, M, color, style) {
  const base = new THREE.Color(color);
  const rings = [];
  const prof = [
    [-0.13, 0.02, 0.03, 0.0], [-0.118, 0.05, 0.06, 0.0], [-0.1, 0.066, 0.082, 0.0], [-0.07, 0.074, 0.094, 0.0],
    [-0.04, 0.078, 0.1, -0.002], [-0.01, 0.08, 0.104, -0.004], [0.02, 0.082, 0.106, -0.006], [0.05, 0.082, 0.105, -0.008],
    [0.075, 0.078, 0.099, -0.01], [0.095, 0.068, 0.087, -0.012], [0.112, 0.05, 0.064, -0.013], [0.124, 0.024, 0.032, -0.013],
  ];
  // finer than the head: the hairline and the strands need the vertices
  const fine = [];
  for (let k = 0; k < prof.length - 1; k++) {
    for (let j = 0; j < 3; j++) {
      const t = j / 3;
      fine.push(prof[k].map((v, q) => v + (prof[k + 1][q] - v) * t));
    }
  }
  fine.push(prof[prof.length - 1]);
  for (const [y, w, d, z] of fine) rings.push({ y, w, d, z, e: 2.1 });
  const g = ringBody(rings, 40);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ang = Math.atan2(x, z); // 0: front, +-pi: back
    const front = Math.cos(ang);
    // hairline height by direction: forehead high, temples, sides over the
    // ears, the nape low; a bob hangs to the jaw all round but the face
    let line;
    if (style === 'bob') line = front > 0.55 ? 0.035 - (front - 0.55) * 0.02 : -0.085 + 0.02 * front;
    else if (style === 'long') line = front > 0.55 ? 0.04 : -0.13;
    else if (style === 'bun') line = front > 0.4 ? 0.045 : -0.055 + 0.04 * Math.max(0, front);
    else line = front > 0.35 ? 0.05 + 0.02 * (front - 0.35) : (front > -0.3 ? 0.012 + 0.04 * front : -0.07 - 0.01 * front);
    const nz = smoothNoise(x * 60, y * 60, z * 60);
    const strands = style === 'bob' || style === 'long' ? (smoothNoise(ang * 14, 0.5, 0.5) - 0.5) * 0.03 : 0;
    const t = THREE.MathUtils.smoothstep(y - line + (nz - 0.5) * 0.012 + strands, -0.004, 0.006);
    // thickness: fuller on the crown, a little volume at a bob's ends
    let th = 0.006 + 0.012 * nz + (style === 'bob' && y < -0.03 ? 0.01 : 0) + (y > 0.06 ? 0.004 : 0);
    if (style === 'short') th *= 0.7;
    // below the hairline the shell is tucked well inside the head (the head
    // narrows faster than these rings toward the jaw)
    const k = t > 0 ? 0.8 + (0.2 + th / 0.09) * t : 0.8;
    p.setX(i, x * k);
    p.setZ(i, (z + 0.008) * k - 0.008);
  }
  g.computeVertexNormals();
  // strands: streaks of lighter and darker along the fall, a sheen on the crown
  parts.push(finish(g, (c, x, y, z) => {
    const streak = smoothNoise(Math.atan2(x, z) * 9, y * 4, 0.5);
    c.copy(base).multiplyScalar(0.62 + 0.42 * streak + 0.22 * THREE.MathUtils.smoothstep(y, 0.03, 0.11));
  }).applyMatrix4(M));
  if (style === 'bun') {
    const b = new THREE.SphereGeometry(0.042, 10, 8);
    b.scale(1.1, 0.9, 1);
    b.translate(0, 0.07, -0.1);
    parts.push(finish(b, flat(base, 0.85)).applyMatrix4(M));
  }
  if (style === 'long') {
    const back = ringBody([{ y: -0.26, w: 0.075, d: 0.03, z: -0.06 }, { y: -0.12, w: 0.085, d: 0.045, z: -0.07 }, { y: -0.02, w: 0.08, d: 0.06, z: -0.05 }], 14, false, false);
    parts.push(finish(back, flat(base, 0.8)).applyMatrix4(M));
  }
}

function hatParts(parts, M, hat, color) {
  const c = new THREE.Color(color);
  const add = (g, col = c) => parts.push(finish(g, flat(col)).applyMatrix4(M));
  const lathe = (pts, seg = 20) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y)), seg);
  if (hat === 'fedora') {
    // crown pinched at the front, a brim snapped down in front
    const crown = lathe([[0.0, 0.0], [0.086, 0.0], [0.084, 0.07], [0.074, 0.098], [0.035, 0.106], [0.0, 0.094]]);
    crown.scale(0.95, 1, 1.12);
    crown.translate(0, 0.075, -0.008);
    add(crown);
    const brim = ringBody([{ y: 0.0, w: 0.165, d: 0.185, e: 2 }, { y: 0.008, w: 0.16, d: 0.18, e: 2 }], 24);
    const bp = brim.attributes.position;
    for (let i = 0; i < bp.count; i++) { const z = bp.getZ(i), x = bp.getX(i); bp.setY(i, bp.getY(i) - (z > 0 ? z * 0.12 : -z * 0.04) + Math.abs(x) * 0.08 * (z < 0 ? 1 : 0)); }
    brim.computeVertexNormals();
    brim.translate(0, 0.075, -0.008);
    add(brim);
    const band = new THREE.CylinderGeometry(0.087, 0.087, 0.02, 18, 1, true);
    band.scale(0.95, 1, 1.12);
    band.translate(0, 0.087, -0.008);
    add(band, new THREE.Color(0x0c0b0a));
  } else if (hat === 'cap' || hat === 'beanie') {
    const cap = new THREE.SphereGeometry(0.1, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
    cap.scale(0.86, 0.82, 1.06);
    cap.translate(0, 0.045, -0.008);
    add(cap);
    if (hat === 'cap') {
      const bill = ringBody([{ y: 0, w: 0.075, d: 0.06, z: 0.0, e: 2 }, { y: 0.008, w: 0.072, d: 0.058, z: 0.0, e: 2 }], 16);
      bill.rotateX(0.2);
      bill.translate(0, 0.05, 0.11);
      add(bill);
    }
  } else if (hat === 'toque') {
    const t = lathe([[0.0, 0.0], [0.084, 0.0], [0.086, 0.11], [0.112, 0.16], [0.1, 0.205], [0.055, 0.222], [0.0, 0.22]]);
    t.scale(1, 1, 1.12);
    t.translate(0, 0.055, -0.008);
    add(t, new THREE.Color(0xeeeae2));
  } else if (hat === 'paper') {
    const pz = new THREE.BoxGeometry(0.15, 0.06, 0.22);
    pz.translate(0, 0.11, -0.01);
    add(pz, new THREE.Color(0xeeeae2));
  }
}

/**
 * One person. o = {
 *   at: [x, y, z] pelvis centre (real m), turn (rad about y), build,
 *   lean (rad, forward), twist (rad), headTurn, headTilt (rad, down positive),
 *   hands: [[x,y,z] left, right] body frame (null: hanging), elbows: pole dirs,
 *   feet: [[x,y,z] left, right] body frame floor contact (null: standing), knees: pole dirs,
 *   skin, hair, hairStyle 'short'|'bob'|'long'|'bun'|'bald', hat, hatColor,
 *   top, bottom, shoes, coat: { color, length }, apron, sleeves 'short', female,
 *   headset, props: [{ geo, at, rot, color }] body frame,
 * }
 */
export function person(o) {
  const parts = [];
  const top = o.top ?? 0x222222;
  const bottom = o.bottom ?? 0x1c1e24;
  const skin = o.skin ?? SKIN[0];
  const female = !!o.female;
  const lean = o.lean ?? 0;
  const twist = o.twist ?? 0;
  const spineQ = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), lean).multiply(new THREE.Quaternion().setFromAxisAngle(UP, twist));
  const T = new THREE.Matrix4().makeRotationFromQuaternion(spineQ);
  const wear = o.coat ? o.coat.color : top;
  // ---- torso: hips to the base of the neck
  const torsoRings = female
    ? [[-0.12, 0.15, 0.11, 0, 2.2], [-0.03, 0.16, 0.112, 0, 2.2], [0.08, 0.128, 0.092, 0.005, 2.3], [0.2, 0.14, 0.1, 0.012, 2.4], [0.3, 0.155, 0.108, 0.02, 2.4],
      [0.38, 0.162, 0.095, 0.01, 2.6], [0.425, 0.16, 0.078, 0.0, 2.8], [0.455, 0.12, 0.065, -0.005, 2.6], [0.475, 0.065, 0.052, 0.0, 2.2], [0.49, 0.048, 0.045, 0.004, 2.0]]
    : [[-0.12, 0.15, 0.105, 0, 2.2], [-0.03, 0.152, 0.105, 0, 2.2], [0.08, 0.142, 0.1, 0.005, 2.3], [0.2, 0.152, 0.104, 0.012, 2.4], [0.3, 0.172, 0.112, 0.016, 2.5],
      [0.38, 0.185, 0.105, 0.01, 2.7], [0.425, 0.182, 0.085, 0.0, 3.0], [0.455, 0.135, 0.07, -0.005, 2.7], [0.478, 0.07, 0.055, 0.0, 2.2], [0.495, 0.052, 0.048, 0.004, 2.0]];
  const coatOut = o.coat ? 0.012 : 0;
  const torso = ringBody(torsoRings.map(([y, w, d, z, e]) => ({ y, w: w + (y < 0.46 ? coatOut : 0), d: d + (y < 0.46 ? coatOut : 0), z, e })), 20, false, true);
  parts.push(finish(torso.applyMatrix4(T), folded(graded(wear, -0.12, 0.45, 0.28), { around: 6, slant: 9, depth: 0.2, y0: -0.12, y1: 0.36, seed: (o.at?.[0] ?? 0) * 7 })));
  // a coat's skirt: from the waist down past the hips (standing: to the knee)
  if (o.coat) {
    const len = o.feet ? 0.12 : (o.coat.length ?? 0.6);
    const sk = ringBody([{ y: -len - 0.1, w: 0.2 + len * 0.08, d: 0.135 + len * 0.05, z: o.feet ? 0.05 : 0, e: 2.2 }, { y: -0.08, w: 0.17, d: 0.12, e: 2.2 }, { y: 0.06, w: 0.155, d: 0.11, e: 2.2 }], 20, false, false);
    parts.push(finish(sk.applyMatrix4(o.feet ? new THREE.Matrix4() : T), folded(graded(o.coat.color, -len, 0.06, 0.35), { around: 9, slant: 0.5, depth: 0.28, y0: -len - 0.2, y1: 0.0 })));
    // lapels and a turned-up collar
    for (const s of [-1, 1]) {
      const lap = new THREE.BufferGeometry();
      lap.setAttribute('position', new THREE.Float32BufferAttribute([s * 0.01, 0.2, 0.125, s * 0.075, 0.43, 0.095, s * 0.035, 0.465, 0.07, s * 0.0, 0.3, 0.13], 3));
      lap.setIndex(s > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
      lap.computeVertexNormals();
      parts.push(finish(lap.applyMatrix4(T), flat(o.coat.color, 0.82)));
    }
    const col = ringBody([{ y: 0.45, w: 0.085, d: 0.07, z: -0.008, e: 2 }, { y: 0.53, w: 0.075, d: 0.068, z: -0.012, e: 2 }], 16, false, false);
    parts.push(finish(col.applyMatrix4(T), flat(o.coat.color, 0.9)));
  } else if (!o.apron || o.collar) {
    const col = ringBody([{ y: 0.46, w: 0.06, d: 0.054, z: 0.002, e: 2 }, { y: 0.5, w: 0.057, d: 0.051, z: 0.004, e: 2 }], 14, false, false);
    parts.push(finish(col.applyMatrix4(T), flat(o.collarColor ?? top, 0.9)));
  }
  if (o.apron) {
    const ap = ringBody([{ y: -0.4, w: 0.15, d: 0.02, z: 0.125, e: 4 }, { y: 0.0, w: 0.15, d: 0.02, z: 0.118, e: 4 }, { y: 0.32, w: 0.11, d: 0.02, z: 0.118, e: 4 }], 12, true, true);
    parts.push(finish(ap.applyMatrix4(o.feet ? T : T), graded(o.apron, -0.4, 0.3, 0.15)));
  }
  // ---- neck and head
  const neckBase = V(0, 0.47, 0.0).applyMatrix4(T);
  const tilt = o.headTilt ?? 0;
  const headQ = spineQ.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt - lean * 0.7, o.headTurn ?? 0, 0, 'YXZ')));
  const neckDir = V(0, 1, 0.12).normalize().applyQuaternion(headQ);
  const neckTop = neckBase.clone().add(neckDir.clone().multiplyScalar(0.085));
  limb(parts, neckBase, neckTop, 0.05, 0.046, flat(skin, 0.93), { seg: 10 });
  const hc = neckTop.clone().add(V(0, 0.085, 0.02).applyQuaternion(headQ));
  const HM = new THREE.Matrix4().compose(hc, headQ, V(1, 1, 1));
  headParts(parts, HM, skin, { female });
  const style = o.hairStyle ?? 'short';
  if (style !== 'bald' && o.hat !== 'toque' && o.hat !== 'cap') hairParts(parts, HM, HAIR[o.hair ?? 'brown'] ?? o.hair, style);
  else if (o.hat === 'cap' || o.hat === 'toque') hairParts(parts, HM, HAIR[o.hair ?? 'brown'] ?? o.hair, 'short');
  if (o.hat) hatParts(parts, HM, o.hat, o.hatColor ?? 0x2a2622);
  if (o.headset) {
    const band = new THREE.TorusGeometry(0.088, 0.007, 4, 16, Math.PI);
    band.translate(0, 0.01, -0.005);
    parts.push(finish(band.applyMatrix4(HM), flat(0x111111)));
    for (const s of [-1, 1]) {
      const cup = new THREE.CylinderGeometry(0.034, 0.034, 0.03, 12);
      cup.rotateZ(Math.PI / 2);
      cup.translate(s * 0.086, 0.0, -0.005);
      parts.push(finish(cup.applyMatrix4(HM), flat(0x151515)));
    }
  }

  // ---- arms: deltoid, upper arm, forearm, a mitten hand with a thumb
  const sleeve = wear;
  for (const [i, s] of [[0, -1], [1, 1]]) {
    const sh = V(s * L.shoulderW, 0.42, -0.012).applyMatrix4(T);
    const hand = o.hands?.[i] ? V(...o.hands[i]) : sh.clone().add(V(s * 0.05, -(L.upper + L.fore) * 0.96, 0.03));
    const pole = o.elbows?.[i] ? V(...o.elbows[i]) : V(s * 0.5, -0.2, -1);
    const { mid: el, end: wr } = ik(sh, hand, L.upper, L.fore, pole.normalize());
    const delt = new THREE.SphereGeometry(0.06, 12, 8);
    delt.scale(1.0, 1.05, 1.1);
    delt.translate(sh.x - s * 0.006, sh.y + 0.004, sh.z);
    parts.push(finish(delt, flat(sleeve, 0.97)));
    const shortSleeve = o.sleeves === 'short';
    if (shortSleeve) {
      const sl = sh.clone().lerp(el, 0.42);
      limb(parts, sh, sl, 0.056, 0.05, flat(sleeve), { seg: 12 });
      limb(parts, sl.clone().lerp(sh, 0.15), el, 0.04, 0.036, flat(skin));
      limb(parts, el, wr, 0.036, 0.027, flat(skin));
    } else {
      limb(parts, sh, el, 0.054, 0.046, graded(sleeve, el.y - 0.02, sh.y, 0.18), { seg: 12 });
      limb(parts, el, wr, 0.045, 0.036, flat(sleeve, 0.95), { seg: 12 });
      // cuff
      const cuffEnd = wr.clone().add(wr.clone().sub(el).normalize().multiplyScalar(0.012));
      limb(parts, wr, cuffEnd, 0.037, 0.036, flat(sleeve, 0.85), { seg: 12 });
    }
    const dir = wr.clone().sub(el).normalize();
    // the hand: palm toward the body's midline, fingers along the forearm
    const side = V(-s, 0, 0).applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(spineQ));
    const palmN = side.clone().sub(dir.clone().multiplyScalar(side.dot(dir))).normalize();
    // (a right-handed frame: a mirrored one turns the hand inside out)
    const across = dir.clone().cross(palmN).normalize();
    const HB = new THREE.Matrix4().makeBasis(across, dir, palmN).setPosition(wr.clone().add(dir.clone().multiplyScalar(0.012)));
    // the palm (back of the hand a little darker), four fingers curled a
    // little toward the palm, the thumb forward of them
    const palm = ringBody([{ y: 0, w: 0.028, d: 0.016, e: 2.6 }, { y: 0.045, w: 0.04, d: 0.019, e: 3 }, { y: 0.085, w: 0.041, d: 0.015, e: 3 }, { y: 0.098, w: 0.037, d: 0.012, e: 2.6 }], 12);
    parts.push(finish(palm.applyMatrix4(HB), flat(skin, 0.94)));
    for (const [fx, len] of [[-0.027, 0.055], [-0.009, 0.072], [0.009, 0.078], [0.027, 0.07]]) {
      const k0 = V(-s * fx, 0.092, 0.002).applyMatrix4(HB);
      const k1 = V(-s * fx * 1.05, 0.092 + len * 0.55, 0.008).applyMatrix4(HB);
      const k2 = V(-s * fx * 1.08, 0.092 + len * 0.9, 0.026).applyMatrix4(HB);
      limb(parts, k0, k1, 0.0095, 0.0085, flat(skin), { seg: 6 });
      limb(parts, k1, k2, 0.0085, 0.0072, flat(skin), { seg: 6 });
    }
    const th0 = V(-s * 0.03, 0.028, 0.012).applyMatrix4(HB);
    const th1 = V(-s * 0.05, 0.07, 0.024).applyMatrix4(HB);
    const th2 = V(-s * 0.052, 0.1, 0.03).applyMatrix4(HB);
    limb(parts, th0, th1, 0.012, 0.0105, flat(skin), { seg: 7 });
    limb(parts, th1, th2, 0.0105, 0.009, flat(skin), { seg: 6 });
  }

  // ---- legs (two-bone IK to the ankles), hips joining them
  const hips = ringBody([{ y: -0.2, w: 0.1, d: 0.08, e: 2 }, { y: -0.14, w: 0.155, d: 0.11, e: 2.2 }, { y: -0.06, w: 0.16, d: 0.112, e: 2.2 }, { y: 0.02, w: 0.152, d: 0.106, e: 2.2 }], 18, false, true);
  parts.push(finish(hips, graded(o.coat && !o.feet ? o.coat.color : bottom, -0.2, 0.0, 0.3)));
  for (const [i, s] of [[0, -1], [1, 1]]) {
    const hip = V(s * L.hipW, -0.08, 0.0);
    const ank = o.feet?.[i] ? V(...o.feet[i]).add(V(0, L.ankle, 0)) : V(s * 0.105, -0.08 - (L.thigh + L.shin) * 0.996, 0.01);
    const pole = o.knees?.[i] ? V(...o.knees[i]) : V(s * 0.12, 0.0, 1);
    const { mid: kn, end } = ik(hip, ank, L.thigh, L.shin, pole.normalize());
    limb(parts, hip, kn, 0.082, 0.056, graded(bottom, kn.y - 0.05, hip.y, 0.15), { seg: 12, flatten: 0.95 });
    limb(parts, kn, end, 0.054, 0.043, flat(bottom, 0.92), { seg: 12 });
    // shoe: toe along where the shin points forward
    const fwd = V(kn.x - end.x, 0, kn.z - end.z);
    if (fwd.lengthSq() < 4e-4) fwd.set(s * 0.05, 0, 1);
    fwd.normalize();
    const yaw = Math.atan2(fwd.x, fwd.z);
    const SB = new THREE.Matrix4().compose(V(end.x, end.y - L.ankle, end.z), new THREE.Quaternion().setFromAxisAngle(UP, yaw), V(1, 1, 1));
    const shoe = ringBody([{ y: 0.0, w: 0.045, d: 0.13, z: 0.05, e: 2.4 }, { y: 0.045, w: 0.044, d: 0.125, z: 0.045, e: 2.4 }, { y: 0.075, w: 0.038, d: 0.08, z: 0.0, e: 2.2 }, { y: 0.09, w: 0.03, d: 0.04, z: -0.03, e: 2 }], 14);
    parts.push(finish(shoe.applyMatrix4(SB), flat(o.shoes ?? 0x141210)));
    const sole = new THREE.BoxGeometry(0.09, 0.016, 0.27);
    sole.translate(0, 0.008, 0.05);
    parts.push(finish(sole.applyMatrix4(SB), flat(0x0a0908)));
  }
  if (!o.coat && !o.apron) {
    const belt = ringBody([{ y: -0.035, w: 0.157, d: 0.109, e: 2.2 }, { y: -0.005, w: 0.156, d: 0.108, e: 2.2 }], 18, false, false);
    parts.push(finish(belt.applyMatrix4(T), flat(o.belt ?? 0x14100c)));
  }
  for (const p of o.props ?? []) {
    const g = p.geo.clone();
    g.applyMatrix4(new THREE.Matrix4().compose(V(...p.at), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rot ?? [0, 0, 0]))), V(1, 1, 1)));
    parts.push(finish(g, flat(p.color)));
  }
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  const sc = o.build ?? 1;
  merged.applyMatrix4(new THREE.Matrix4().compose(V(...o.at), new THREE.Quaternion().setFromAxisAngle(UP, o.turn ?? 0), V(sc, sc, sc)));
  return merged;
}

/** Merge many people into one geometry (they share one material). */
export function crowd(list) {
  const gs = list.map((o) => person(o));
  const g = mergeGeometries(gs, false);
  for (const x of gs) x.dispose();
  g.computeBoundingSphere();
  return g;
}

/** Seated on a seat `h` above the floor: the pelvis height above the floor. */
export const seatedAt = (h) => h + 0.1;
/** Feet in front of a seat of height h (body frame), knees bent; footRest: height of a rail. */
export function seatedFeet(h, { spread = 0.12, forward = 0.42, footRest = null } = {}) {
  const y = -(h + 0.1) + (footRest ?? 0);
  return [[-spread, y, forward], [spread, y, forward - 0.04]];
}

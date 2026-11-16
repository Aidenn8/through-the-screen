// A parked 1950s-style four-door sedan at the curb: the near layer of the
// shot, 12-20 cm behind the glass, so it slides across the hydrant and the
// diner windows as the head moves. Original design (a generic period shape,
// no make, no badges). A dark wet silhouette whose paint, chrome and glass
// pick up the neon and the windows through an environment captured from
// the set itself. Real metres, car-local: x from the rear bumper (0) to the
// front bumper (5.2), y up from the road, z across (driver side +z).

import * as THREE from 'three';
import { Builder, mat4 } from '../_lib/geo.js';

export const CAR = { length: 5.2, width: 1.95, wheelbase: 3.0, wheelX: [1.1, 4.1], wheelR: 0.36 };

/**
 * The car as two axis-aligned boxes in set metres (body, greenhouse), for
 * occlusion tests. Parked facing -x with its rear bumper at x1, centred on z,
 * standing on ground y0. Matches the profiles in buildCar.
 */
export function carBoxes({ x1, z }, y0) {
  return [
    { min: [x1 - CAR.length, y0 + 0.3, z - CAR.width / 2], max: [x1, y0 + 1.04, z + CAR.width / 2] },
    { min: [x1 - 3.78, y0 + 0.98, z - 0.78], max: [x1 - 1.3, y0 + 1.5, z + 0.78] },
  ];
}

function extrude(shape, width, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.85,
    bevelSegments: 4,
    curveSegments: 16,
  });
  g.translate(0, 0, -(width - 2 * bevel) / 2);
  return g;
}

// Crown an extrusion across its width: tops bow down toward the sides by c at
// the edge (z = +-hw), fading in from y0 to y1, and the glass and roof lean
// in (tumblehome) by tuck at y1. Normals tilt to match, so a hood or roof
// seen from above mirrors a gradient across its width instead of one flat
// slab of neon (the extrusions had flat tops).
function crown(g, hw, c, y0, y1, tuck = 0) {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = ss(y0, y1, y);
    const u = z / hw;
    p.setY(i, y - c * k * u * u);
    p.setZ(i, z * (1 - tuck * k));
    // slope of the crown across: dy/dz = -2 c k z / hw^2
    const slope = (2 * c * k * z) / (hw * hw);
    const nx = n.getX(i);
    let ny = n.getY(i);
    let nz = n.getZ(i);
    if (ny > 0.2) nz += slope * ny;
    if (Math.abs(nz) > 0.5 && tuck) ny += tuck * 2.5 * k * Math.abs(nz);
    const l = Math.hypot(nx, ny, nz) || 1;
    n.setXYZ(i, nx / l, ny / l, nz / l);
  }
  p.needsUpdate = true;
  n.needsUpdate = true;
  return g;
}

/**
 * Build the car into a Builder under one transform.
 * @param {Builder} B
 * @param {object} m materials (carBody, carGlass, carChrome, carTyre, carLamp)
 * @param {THREE.Matrix4} T car-local -> set (real metres) transform
 */
export function buildCar(m, T) {
  const B = new Builder();
  const add = (key, mat, geo, local = null) => B.add(key, mat, geo, local ? new THREE.Matrix4().multiplyMatrices(T, local) : T.clone());
  const [wr, wf] = CAR.wheelX;
  const R = CAR.wheelR;
  const arch = 0.47;
  // lower body: long low hood, rounded fenders, a slight fin over the tail
  const body = new THREE.Shape();
  body.moveTo(0.05, 0.36);
  body.lineTo(wr - arch, 0.36);
  body.absarc(wr, 0.36, arch, Math.PI, 0, true);
  body.lineTo(wf - arch, 0.36);
  body.absarc(wf, 0.36, arch, Math.PI, 0, true);
  body.lineTo(5.1, 0.36);
  body.quadraticCurveTo(5.2, 0.4, 5.2, 0.52);
  body.lineTo(5.2, 0.74);
  body.quadraticCurveTo(5.19, 0.86, 5.05, 0.9);
  body.quadraticCurveTo(4.5, 0.97, 3.75, 1.0);
  body.lineTo(1.35, 1.0);
  body.quadraticCurveTo(0.7, 0.99, 0.28, 0.98);
  body.lineTo(0.1, 1.04); // tail fin
  body.quadraticCurveTo(0.0, 1.0, 0.0, 0.9);
  body.lineTo(0.0, 0.5);
  body.quadraticCurveTo(0.0, 0.38, 0.05, 0.36);
  add('carBody', m.carBody, crown(extrude(body, CAR.width, 0.14), CAR.width / 2, 0.07, 0.7, 0.95));
  // greenhouse: glass all round, then the roof and pillars over it in paint
  const cabin = new THREE.Shape();
  cabin.moveTo(1.3, 0.98);
  cabin.lineTo(1.82, 1.4);
  cabin.quadraticCurveTo(2.45, 1.5, 3.1, 1.46);
  cabin.lineTo(3.78, 0.98);
  cabin.lineTo(1.3, 0.98);
  add('carGlass', m.carGlass, crown(extrude(cabin, 1.56, 0.1), 0.78, 0.05, 1.0, 1.45, 0.06));
  const roof = new THREE.Shape();
  roof.moveTo(1.74, 1.35);
  roof.lineTo(1.82, 1.4);
  roof.quadraticCurveTo(2.45, 1.5, 3.1, 1.46);
  roof.lineTo(3.18, 1.36);
  roof.lineTo(1.74, 1.35);
  add('carBody', m.carBody, crown(extrude(roof, 1.6, 0.06), 0.8, 0.06, 1.3, 1.5, 0.06));
  // roof and hood detail for the views from above: drip rails along the
  // roof's edges, a chrome spear down the hood's centre and one on the
  // deck lid, a hood ornament, a slim aerial on the front fender
  for (const s2 of [-1, 1]) {
    const z = s2 * 0.75 * (1 - 0.06);
    const pts = [[1.8, 1.37], [2.1, 1.43], [2.6, 1.45], [3.05, 1.42], [3.17, 1.36]];
    for (let i = 0; i < pts.length - 1; i++) {
      B.rod('carChrome', m.carChrome, new THREE.Vector3(pts[i][0], pts[i][1] - 0.045, z).applyMatrix4(T).toArray(), new THREE.Vector3(pts[i + 1][0], pts[i + 1][1] - 0.045, z).applyMatrix4(T).toArray(), 0.012, 5);
    }
  }
  add('carChrome', m.carChrome, new THREE.BoxGeometry(1.25, 0.012, 0.035), mat4([4.45, 0.985, 0], [0, 0, -0.06]));
  add('carChrome', m.carChrome, new THREE.BoxGeometry(0.7, 0.012, 0.03), mat4([0.75, 0.99, 0]));
  add('carChrome', m.carChrome, new THREE.ConeGeometry(0.03, 0.14, 8), mat4([5.08, 0.94, 0], [0, 0, Math.PI / 2 + 0.25]));
  B.rod('carChrome', m.carChrome, new THREE.Vector3(4.6, 0.95, -0.82).applyMatrix4(T).toArray(), new THREE.Vector3(4.55, 1.85, -0.84).applyMatrix4(T).toArray(), 0.006, 4);
  for (const s of [-1, 1]) {
    const z = s * 0.74;
    // wide C pillar, thin A and B pillars
    const c = new THREE.Shape();
    c.moveTo(1.3, 0.98); c.lineTo(1.82, 1.4); c.lineTo(2.08, 1.42); c.lineTo(1.75, 0.98); c.lineTo(1.3, 0.98);
    add('carBody', m.carBody, new THREE.ExtrudeGeometry(c, { depth: 0.06, bevelEnabled: false }), mat4([0, 0, z - 0.03]));
    B.rod('carBody', m.carBody, new THREE.Vector3(3.76, 0.99, z).applyMatrix4(T).toArray(), new THREE.Vector3(3.1, 1.45, z * 0.97).applyMatrix4(T).toArray(), 0.035, 6);
    B.rod('carBody', m.carBody, new THREE.Vector3(2.62, 0.99, z).applyMatrix4(T).toArray(), new THREE.Vector3(2.6, 1.46, z * 0.98).applyMatrix4(T).toArray(), 0.03, 6);
    // chrome side spear along the body
    add('carChrome', m.carChrome, new THREE.BoxGeometry(4.3, 0.022, 0.02), mat4([2.65, 0.74, s * (CAR.width / 2 + 0.004)]));
    // window frames
    add('carChrome', m.carChrome, new THREE.BoxGeometry(2.5, 0.018, 0.02), mat4([2.55, 1.0, s * 0.79]));
  }
  // bumpers and grille
  const bumper = (x) => {
    const g = new THREE.CapsuleGeometry(0.075, CAR.width - 0.15, 6, 12);
    add('carChrome', m.carChrome, g, mat4([x, 0.48, 0], [Math.PI / 2, 0, 0]));
  };
  bumper(-0.03);
  bumper(5.23);
  for (let i = 0; i < 7; i++) add('carChrome', m.carChrome, new THREE.BoxGeometry(0.03, 0.03, 1.1), mat4([5.205, 0.6 + i * 0.028, 0]));
  // lamps: round headlights with chrome rings, tail lights (off, dark red glass)
  for (const s of [-1, 1]) {
    const hz = s * 0.72;
    add('carChrome', m.carChrome, new THREE.TorusGeometry(0.11, 0.018, 8, 24), mat4([5.205, 0.76, hz], [0, Math.PI / 2, 0]));
    add('carLamp', m.carLamp, new THREE.CircleGeometry(0.1, 24), mat4([5.215, 0.76, hz], [0, Math.PI / 2, 0]));
    add('carTail', m.carTail, new THREE.CapsuleGeometry(0.05, 0.16, 4, 10), mat4([-0.005, 0.86, hz]));
  }
  // wheels: black tyres, chrome hubcaps, a white wall
  for (const x of CAR.wheelX) {
    for (const s of [-1, 1]) {
      const z = s * (CAR.width / 2 - 0.13);
      add('carTyre', m.carTyre, new THREE.CylinderGeometry(R, R, 0.22, 28), mat4([x, R, z], [Math.PI / 2, 0, 0]));
      add('carTyre', m.carTyre, new THREE.TorusGeometry(R - 0.05, 0.06, 8, 28), mat4([x, R, z + s * 0.1]));
      add('carChrome', m.carChrome, new THREE.CylinderGeometry(0.17, 0.2, 0.04, 24), mat4([x, R, z + s * 0.12], [Math.PI / 2, 0, 0]));
      add('carWhitewall', m.carWhitewall, new THREE.RingGeometry(0.21, 0.28, 28), mat4([x, R, z + s * 0.113], [0, s > 0 ? 0 : Math.PI, 0]));
    }
  }
  // underbody shadow catcher: a dark slab between the wheels
  add('carTyre', m.carTyre, new THREE.BoxGeometry(4.6, 0.12, CAR.width - 0.3), mat4([2.6, 0.3, 0]));
  return B;
}

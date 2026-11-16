// Geometry helpers: build lots of small static parts, then merge them into one
// mesh per material so a detailed set stays at a modest draw-call count.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export function mat4(pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  _e.set(rot[0], rot[1], rot[2]);
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(...pos), _q, _s.set(...scale));
}

// Keep only the attributes every merged geometry shares.
function normalise(g) {
  g = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(g.attributes)) {
    if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
  }
  if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
  }
  return g;
}

export class Builder {
  constructor() {
    this.parts = new Map(); // key -> { material, geoms: [], cast, receive }
  }

  /**
   * @param {string} key   material key (one merged mesh per key)
   * @param {THREE.Material} material
   * @param {THREE.BufferGeometry} geometry (consumed)
   * @param {THREE.Matrix4} matrix
   */
  add(key, material, geometry, matrix, { cast = true, receive = true } = {}) {
    if (!this.parts.has(key)) this.parts.set(key, { material, geoms: [], cast, receive });
    const g = geometry.clone();
    if (matrix) g.applyMatrix4(matrix);
    this.parts.get(key).geoms.push(normalise(g));
    geometry.dispose();
    return this;
  }

  box(key, material, size, pos, rot = [0, 0, 0], opts) {
    return this.add(key, material, boxUV(size[0], size[1], size[2], opts?.uvScale), mat4(pos, rot), opts);
  }

  cyl(key, material, rTop, rBottom, h, pos, rot = [0, 0, 0], seg = 12, opts) {
    return this.add(key, material, new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, false), mat4(pos, rot), opts);
  }

  // Cylinder between two points.
  rod(key, material, a, b, r, seg = 8, opts) {
    const A = new THREE.Vector3(...a);
    const B = new THREE.Vector3(...b);
    const len = A.distanceTo(B);
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
    const mid = A.clone().add(B).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    const m = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1));
    return this.add(key, material, g, m, opts);
  }

  build(parent) {
    const meshes = [];
    for (const [key, p] of this.parts) {
      const g = mergeGeometries(p.geoms, false);
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, p.material);
      mesh.name = key;
      mesh.castShadow = p.cast;
      mesh.receiveShadow = p.receive;
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
      meshes.push(mesh);
      for (const x of p.geoms) x.dispose();
    }
    this.parts.clear();
    return meshes;
  }
}

// Box whose UVs are in metres (world-scaled), so tiling textures keep their
// physical size on every face. uvScale: metres per texture repeat.
export function boxUV(w, h, d, uvScale = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nrm.getX(i));
    const ny = Math.abs(nrm.getY(i));
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let u;
    let v;
    if (nx > 0.5) { u = z; v = y; } else if (ny > 0.5) { u = x; v = z; } else { u = x; v = y; }
    uv.setXY(i, u / uvScale, v / uvScale);
  }
  return g;
}

// Plane with UVs in metres.
export function planeUV(w, h, uvScale = 1, segW = 1, segH = 1) {
  const g = new THREE.PlaneGeometry(w, h, segW, segH);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / uvScale, (uv.getY(i) * h) / uvScale);
  return g;
}

// Tube along a smooth curve through points (cables, pipes).
export function tube(points, r, seg = 64, radial = 6) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
  return new THREE.TubeGeometry(curve, seg, r, radial, false);
}

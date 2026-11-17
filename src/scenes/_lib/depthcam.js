// The same view with a nearer limit on the near plane.
//
// The rig scales the near plane with the viewer (docs/ARCHITECTURE.md): at
// scale 1/16 it sits 16 times closer than at the shot, and a 24-bit depth
// buffer's step at distance z grows as z^2 / near. Seen from across the
// stage, decals a few millimetres in front of a wall (the painted sign on the
// diner's upper wall) then z-fight. This copies the camera with the near
// plane moved out to `nearMin` (world metres) and the frustum's side planes
// scaled with it, so the image is the same except for what lies closer than
// nearMin, and the depth buffer is several times finer.

import * as THREE from 'three';

/**
 * @param {THREE.PerspectiveCamera} src the camera the app placed (any off-axis frustum)
 * @param {number} nearMin world metres
 * @param {THREE.PerspectiveCamera} out reused
 * @returns {THREE.PerspectiveCamera} src itself when its near is already >= nearMin
 */
export function withNearAtLeast(src, nearMin, out) {
  if (!(src.near < nearMin) || !src.isPerspectiveCamera) return src;
  const n = nearMin;
  const f = Math.max(src.far, n * 10);
  out.position.copy(src.position);
  out.quaternion.copy(src.quaternion);
  out.scale.copy(src.scale);
  out.matrixWorld.copy(src.matrixWorld);
  out.matrixWorldInverse.copy(src.matrixWorldInverse);
  out.near = n;
  out.far = f;
  out.fov = src.fov;
  out.aspect = src.aspect;
  out.layers.mask = src.layers.mask;
  // makePerspective(l, r, t, b, n, f): the off-axis terms (0, 5, 8, 9) only
  // depend on the ratios l/n ..., which stay; depth (10, 14) is rebuilt.
  const e = out.projectionMatrix.copy(src.projectionMatrix).elements;
  e[10] = -(f + n) / (f - n);
  e[14] = (-2 * f * n) / (f - n);
  out.projectionMatrixInverse.copy(out.projectionMatrix).invert();
  return out;
}

export function makeDepthCamera() {
  const c = new THREE.PerspectiveCamera();
  c.matrixAutoUpdate = false;
  c.matrixWorldAutoUpdate = false;
  return c;
}

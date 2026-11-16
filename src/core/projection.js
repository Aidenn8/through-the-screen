// Off-axis perspective for a viewer looking through a rectangular window.
//
// Coordinates (see docs/ARCHITECTURE.md): metres, origin at the centre of the
// window (the canvas on the physical screen), x right, y up, z toward the
// viewer. The glass is the plane z = 0. A normal camera assumes the eye sits on
// the window's centre line; here the eye can be anywhere in front of the glass,
// so the frustum is asymmetric. This is the axis-aligned case of Kooima's
// generalized perspective projection (2008).

/**
 * Frustum extents on the near plane for an eye in front of a w x h window.
 * @param {{x:number,y:number,z:number}} eye  eye position, z > 0
 * @param {number} w window width (m)
 * @param {number} h window height (m)
 * @param {number} near near-plane distance (m), must be < eye.z for content at the glass
 */
export function windowFrustum(eye, w, h, near) {
  const d = eye.z;
  if (!(d > 1e-4)) throw new RangeError('eye must be in front of the glass (z > 0)');
  if (!(w > 0 && h > 0)) throw new RangeError('window size must be positive');
  const s = near / d;
  return {
    left: (-w / 2 - eye.x) * s,
    right: (w / 2 - eye.x) * s,
    bottom: (-h / 2 - eye.y) * s,
    top: (h / 2 - eye.y) * s,
    near,
  };
}

/**
 * Point a three.js camera so the canvas behaves as a window seen from `eye`.
 * The camera keeps an identity rotation (it looks straight down -z, parallel
 * to the glass normal); only the frustum is skewed.
 *
 * Never call camera.updateProjectionMatrix() afterwards: it would replace this
 * matrix with a symmetric one.
 */
export function applyWindowCamera(camera, eye, w, h, { near = 0.01, far = 100 } = {}) {
  const f = windowFrustum(eye, w, h, near);
  camera.position.set(eye.x, eye.y, eye.z);
  camera.quaternion.set(0, 0, 0, 1);
  camera.near = near;
  camera.far = far;
  camera.projectionMatrix.makePerspective(f.left, f.right, f.top, f.bottom, near, far);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  // Keep fov/aspect roughly honest for code that reads them (e.g. LOD, effects).
  if ('fov' in camera) {
    camera.aspect = w / h;
    camera.fov = (2 * Math.atan(h / 2 / eye.z) * 180) / Math.PI;
  }
  camera.updateMatrixWorld(true);
  return f;
}

/**
 * Where on the glass (window coords, metres) the eye sees world point p.
 * Reference implementation used by tests and QA tools.
 */
export function glassPoint(eye, p) {
  const t = eye.z / (eye.z - p.z); // ray eye -> p hits z = 0 at parameter t
  return { x: eye.x + (p.x - eye.x) * t, y: eye.y + (p.y - eye.y) * t };
}

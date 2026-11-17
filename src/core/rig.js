// Moving the window through a scene (docs/ARCHITECTURE.md, "Moving the
// window"). The window's placement in the scene is the rig: a position, a yaw,
// a pitch and a scale. A point in window coordinates maps into the scene as
//
//   p_scene = position + Ry(yaw) · Rx(pitch) · (scale · p_window)
//
// yaw and pitch in degrees (positive yaw turns the view left, positive pitch
// tilts it up). The frustum is still built in window coordinates by
// projection.js, from the eye, window and near/far all multiplied by scale;
// the camera is then turned by the rig's rotation and moved to its position.
// The default rig (0, 0, 0, scale 1) gives exactly the frames the app drew
// before the rig existed.

import { applyWindowCamera } from './projection.js';

export const DEG = Math.PI / 180;

/** The default rig: today's view. */
export const IDENTITY_POSE = Object.freeze({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, scale: 1 });

/**
 * The rig's rotation Ry(yaw) · Rx(pitch) as a quaternion [x, y, z, w].
 * (Three's Euler order 'YXZ' with x = pitch, y = yaw gives the same.)
 */
export function rigQuaternion(yawDeg, pitchDeg, out = [0, 0, 0, 1]) {
  const hy = (yawDeg * DEG) / 2;
  const hp = (pitchDeg * DEG) / 2;
  const sy = Math.sin(hy), cy = Math.cos(hy);
  const sp = Math.sin(hp), cp = Math.cos(hp);
  out[0] = cy * sp;
  out[1] = sy * cp;
  out[2] = 0 - sy * sp; // never -0: the default rig is bit for bit today's camera
  out[3] = cy * cp;
  return out;
}

/** Rotate v = [x, y, z] by Ry(yaw) · Rx(pitch) (reference, for tests and motion). */
export function rotate(yawDeg, pitchDeg, v) {
  const a = yawDeg * DEG, b = pitchDeg * DEG;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  // Rx(pitch): y' = cb y - sb z, z' = sb y + cb z
  const x1 = v[0];
  const y1 = cb * v[1] - sb * v[2];
  const z1 = sb * v[1] + cb * v[2];
  // Ry(yaw): x'' = ca x + sa z, z'' = -sa x + ca z
  return [ca * x1 + sa * z1, y1, -sa * x1 + ca * z1];
}

/** Where a point in window coordinates is in the scene, for a pose. */
export function windowToScene(pose, p) {
  const r = rotate(pose.yaw, pose.pitch, [pose.scale * p.x, pose.scale * p.y, pose.scale * p.z]);
  return { x: pose.x + r[0], y: pose.y + r[1], z: pose.z + r[2] };
}

const Q = [0, 0, 0, 1];

/**
 * Place a three.js camera for an eye in window coordinates and a rig pose.
 * Never call camera.updateProjectionMatrix() afterwards (projection.js).
 *
 * @param {object} camera THREE.PerspectiveCamera
 * @param {{x:number,y:number,z:number}} eye eye in window coordinates, z > 0
 * @param {number} w window width (m)
 * @param {number} h window height (m)
 * @param {{x,y,z,yaw,pitch,scale}} pose the rig
 * @param {{near?:number, far?:number}} [planes] at scale 1 (both scale with the rig)
 * @param {{eyeWorld, rig:{position, quaternion, scale}}} [view] filled for scene.update
 * @returns the frustum from projection.js (in scaled window units)
 */
export function applyRigCamera(camera, eye, w, h, pose, { near = 0.01, far = 100 } = {}, view = null) {
  const s = pose.scale;
  const f = applyWindowCamera(camera, { x: eye.x * s, y: eye.y * s, z: eye.z * s }, w * s, h * s, { near: near * s, far: far * s });
  const q = rigQuaternion(pose.yaw, pose.pitch, Q);
  camera.quaternion.set(q[0], q[1], q[2], q[3]);
  camera.position.applyQuaternion(camera.quaternion);
  camera.position.x += pose.x;
  camera.position.y += pose.y;
  camera.position.z += pose.z;
  camera.updateMatrixWorld(true);
  if (view) {
    view.eyeWorld.copy(camera.position);
    view.rig.position.set(pose.x, pose.y, pose.z);
    view.rig.quaternion.copy(camera.quaternion);
    view.rig.scale = s;
  }
  return f;
}

/** A scene point [x, y, z] in window coordinates for a pose (the inverse of windowToScene). */
export function sceneToWindow(pose, p) {
  const d = [p[0] - pose.x, p[1] - pose.y, p[2] - pose.z];
  const a = rotate(-pose.yaw, 0, d); // Ry(-yaw) first...
  const b = rotate(0, -pose.pitch, a); // ...then Rx(-pitch)
  return { x: b[0] / pose.scale, y: b[1] / pose.scale, z: b[2] / pose.scale };
}

/** The nearest eye distance from the glass the app draws from (window metres). */
export const EYE_MIN_Z = 0.08;

/**
 * Keep the eye's world position inside nav.room (docs/ARCHITECTURE.md): the
 * eye in the scene, position + R (scale eye), is clamped to the box and
 * brought back to window coordinates. Clamping is the nearest point inside,
 * so the eye slides along a wall it is pushed against (head tracking still
 * works there, it just cannot push through), a path crossing a wall bends
 * there without a jump, and nothing feeds back, so nothing oscillates. An
 * eye inside is returned as it is (the same object): every frame drawn
 * inside the room is exactly what it was without one, True window included.
 * The eye stays in front of the glass (EYE_MIN_Z) even if that leaves the
 * room: only when the window itself is outside it, which bounds should not
 * allow.
 *
 * @param {{x,y,z}} eye window coordinates
 * @param {{x,y,z,yaw,pitch,scale}} pose the rig
 * @param {{min:number[], max:number[]}|null} room scene coordinates
 * @returns {{x,y,z}} the eye to draw from (window coordinates)
 */
export function keepEyeInRoom(eye, pose, room, minZ = EYE_MIN_Z) {
  if (!room) return eye;
  const w = windowToScene(pose, eye);
  const box = (v) => [
    Math.min(room.max[0], Math.max(room.min[0], v[0])),
    Math.min(room.max[1], Math.max(room.min[1], v[1])),
    Math.min(room.max[2], Math.max(room.min[2], v[2])),
  ];
  const c = box([w.x, w.y, w.z]);
  if (c[0] === w.x && c[1] === w.y && c[2] === w.z) return eye;
  const e = sceneToWindow(pose, c);
  if (e.z >= minZ) return e;
  // The nearest point in the room is too close to the glass (the window is
  // near a wall behind the viewer): the nearest point that is in the room
  // and at least minZ in front of the glass instead. That projection onto
  // box and half-space is clamp(w + lambda n) for the smallest lambda >= 0
  // that reaches the plane (its distance along n grows with lambda), found by
  // bisection; at lambda 0 it is c, so the switch is seamless.
  const n = rotate(pose.yaw, pose.pitch, [0, 0, 1]); // the glass's normal, toward the viewer
  const b = n[0] * pose.x + n[1] * pose.y + n[2] * pose.z + minZ * pose.scale;
  const at = (l) => box([w.x + l * n[0], w.y + l * n[1], w.z + l * n[2]]);
  const reach = (v) => n[0] * v[0] + n[1] * v[1] + n[2] * v[2] - b;
  const span = Math.hypot(room.max[0] - room.min[0], room.max[1] - room.min[1], room.max[2] - room.min[2]);
  let hi = span + Math.hypot(w.x - c[0], w.y - c[1], w.z - c[2]) + 1;
  let lo = 0;
  let best = at(hi);
  if (reach(best) >= 0) {
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      const v = at(mid);
      if (reach(v) >= 0) { hi = mid; best = v; } else lo = mid;
    }
  }
  const f = sceneToWindow(pose, best);
  // Only if the room has no point that far in front of the glass (the window
  // flush against a wall, facing away) does the eye leave it.
  if (f.z < minZ) f.z = minZ;
  return f;
}

/** Whether a scene point lies inside nav.room (within eps metres). */
export function insideRoom(room, p, eps = 1e-9) {
  return !room || (p.x >= room.min[0] - eps && p.x <= room.max[0] + eps
    && p.y >= room.min[1] - eps && p.y <= room.max[1] + eps
    && p.z >= room.min[2] - eps && p.z <= room.max[2] + eps);
}

/** The shortest signed turn (degrees, -180..180] from yaw a to yaw b. */
export function shortYaw(a, b) {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  else if (d <= -180) d += 360;
  return d;
}

const PITCH_MAX = 89;
const num = (v, d) => (Number.isFinite(v) ? v : d);

/** A station's pose in the internal form { x, y, z, yaw, pitch, scale }. */
export function poseFrom(p = {}) {
  const pos = Array.isArray(p.position) ? p.position : [0, 0, 0];
  const scale = num(p.scale, 1);
  return {
    x: num(pos[0], 0),
    y: num(pos[1], 0),
    z: num(pos[2], 0),
    yaw: num(p.yaw, 0),
    pitch: Math.max(-PITCH_MAX, Math.min(PITCH_MAX, num(p.pitch, 0))),
    scale: scale > 0 ? scale : 1,
  };
}

/**
 * Check and complete a scene's `nav` (the contract in docs/ARCHITECTURE.md).
 * Returns null when the scene has no stations (it cannot be moved through).
 * Bounds and the scale range always contain every station, so every station
 * can be reached; a station outside them widens them, with a warning.
 *
 * @returns {null | {
 *   stations: {id:string, title:string, pose:object}[],
 *   bounds: {min:number[], max:number[]}, scale: [number, number],
 *   tour: string[], pitchLimit: number }}
 */
export function normalizeNav(nav, warn = (m) => console.warn(m)) {
  if (!nav || !Array.isArray(nav.stations) || nav.stations.length === 0) return null;
  const seen = new Set();
  const stations = [];
  for (const [i, s] of nav.stations.entries()) {
    let id = typeof s?.id === 'string' && s.id ? s.id : `station-${i + 1}`;
    if (seen.has(id)) {
      warn(`nav: station id "${id}" is used twice; the second is renamed.`);
      id = `${id}-${i + 1}`;
    }
    seen.add(id);
    const st = { id, title: typeof s?.title === 'string' && s.title ? s.title : id, pose: poseFrom(s?.pose) };
    // Optional: a point that must stay in frame (tests), and limits on head
    // tracking here (view-map.js stationLimits reads them).
    if (s?.subject !== undefined) {
      if (Array.isArray(s.subject) && s.subject.length === 3 && s.subject.every(Number.isFinite)) st.subject = [...s.subject];
      else warn(`nav: station "${id}" has a subject that is not [x, y, z]; ignored.`);
    }
    if (s?.view !== undefined) {
      const v = s.view || {};
      const ok = (k, min) => v[k] === undefined || (Number.isFinite(v[k]) && v[k] >= min);
      if (ok('maxStrength', 1e-3) && ok('verticalBoost', 0) && ok('maxEyeZ', 0.05)) st.view = { ...v };
      else warn(`nav: station "${id}" has view limits that are not positive numbers; ignored.`);
    }
    stations.push(st);
  }
  const P = stations.map((s) => [s.pose.x, s.pose.y, s.pose.z]);
  const lo = [0, 1, 2].map((k) => Math.min(...P.map((p) => p[k])));
  const hi = [0, 1, 2].map((k) => Math.max(...P.map((p) => p[k])));
  let min, max;
  const b = nav.bounds;
  if (b && Array.isArray(b.min) && Array.isArray(b.max) && b.min.length === 3 && b.max.length === 3) {
    min = b.min.map((v, k) => num(v, lo[k]));
    max = b.max.map((v, k) => num(v, hi[k]));
    for (let k = 0; k < 3; k++) if (min[k] > max[k]) [min[k], max[k]] = [max[k], min[k]];
  } else {
    // No bounds: the stations' box, a little wider.
    min = lo.map((v) => v - 0.1);
    max = hi.map((v) => v + 0.1);
  }
  for (let k = 0; k < 3; k++) {
    if (lo[k] < min[k] || hi[k] > max[k]) {
      warn('nav: a station lies outside bounds; the bounds are widened to include it.');
      min[k] = Math.min(min[k], lo[k]);
      max[k] = Math.max(max[k], hi[k]);
    }
  }
  const sc = stations.map((s) => s.pose.scale);
  let scale = Array.isArray(nav.scale) && nav.scale.length === 2 && nav.scale.every((v) => v > 0)
    ? [Math.min(...nav.scale), Math.max(...nav.scale)]
    : [Math.min(0.15, ...sc), Math.max(1.5, ...sc)];
  if (Math.min(...sc) < scale[0] || Math.max(...sc) > scale[1]) {
    warn('nav: a station scale lies outside nav.scale; the range is widened to include it.');
    scale = [Math.min(scale[0], ...sc), Math.max(scale[1], ...sc)];
  }
  const ids = new Set(stations.map((s) => s.id));
  let tour = Array.isArray(nav.tour) ? nav.tour.filter((id) => {
    if (ids.has(id)) return true;
    warn(`nav: tour stop "${id}" is not a station; skipped.`);
    return false;
  }) : [];
  if (tour.length === 0) tour = stations.map((s) => s.id);
  const pitchLimit = Math.max(75, ...stations.map((s) => Math.abs(s.pose.pitch)));
  const out = { stations, bounds: { min, max }, scale, tour, pitchLimit };
  // Optional: the box the eye's world position stays inside (keepEyeInRoom).
  const r = nav.room;
  if (r !== undefined) {
    const ok3 = (a) => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
    if (ok3(r?.min) && ok3(r?.max) && r.min.every((v, k) => v < r.max[k])) out.room = { min: [...r.min], max: [...r.max] };
    else warn('nav: room is not { min: [x, y, z], max: [x, y, z] } with min below max; ignored.');
  }
  return out;
}

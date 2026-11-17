// The rig: where the window sits in a scene (src/core/rig.js) and how it
// moves (src/core/rig-motion.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3, Quaternion, Euler } from 'three';
import { applyWindowCamera } from '../src/core/projection.js';
import {
  applyRigCamera, windowToScene, rigQuaternion, rotate, shortYaw, normalizeNav, IDENTITY_POSE, DEG,
} from '../src/core/rig.js';
import { RigMotion, MOTION_DEFAULTS, ease } from '../src/core/rig-motion.js';

const W = 0.3266;
const H = 0.2114;
const EYES = [[0, 0.02, 0.6], [0.25, 0.1, 0.45], [-0.4, -0.15, 0.9], [0.05, 0.3, 0.3]];
const close = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);
const newView = () => ({ eyeWorld: new Vector3(), rig: { position: new Vector3(), quaternion: new Quaternion(), scale: 1 } });

// ------------------------------------------------------------------ rig math

test('rig: the default rig draws exactly the frames drawn before the rig existed', () => {
  for (const [x, y, z] of EYES) {
    const a = new PerspectiveCamera();
    const b = new PerspectiveCamera();
    applyWindowCamera(a, { x, y, z }, W, H, { near: 0.005, far: 200 });
    applyRigCamera(b, { x, y, z }, W, H, IDENTITY_POSE, { near: 0.005, far: 200 });
    // Bit for bit, not merely close.
    assert.deepEqual([...b.projectionMatrix.elements], [...a.projectionMatrix.elements]);
    assert.deepEqual([...b.projectionMatrixInverse.elements], [...a.projectionMatrixInverse.elements]);
    assert.deepEqual([...b.matrixWorld.elements], [...a.matrixWorld.elements]);
    assert.deepEqual([...b.matrixWorldInverse.elements], [...a.matrixWorldInverse.elements]);
    assert.equal(b.near, a.near);
    assert.equal(b.far, a.far);
    assert.equal(b.fov, a.fov);
  }
});

test('rig: a point in window coordinates lands where it did, carried into the scene', () => {
  const poses = [
    { x: 0.3, y: -0.1, z: -2, yaw: 0, pitch: 0, scale: 1 },
    { x: -1.2, y: 0.4, z: 0.5, yaw: 90, pitch: 0, scale: 0.25 },
    { x: 2, y: 1, z: -3, yaw: 180, pitch: -20, scale: 1.5 },
    { x: 0.1, y: 0.2, z: 0.3, yaw: -137, pitch: 33, scale: 0.15 },
  ];
  const pts = [[0, 0, 0], [W / 2, H / 2, 0], [-W / 2, -H / 2, 0], [0.05, -0.04, -0.3], [-0.1, 0.06, 0.05], [0.4, 0.2, -2]];
  for (const pose of poses) {
    for (const [ex, ey, ez] of EYES) {
      const ref = new PerspectiveCamera();
      const cam = new PerspectiveCamera();
      applyWindowCamera(ref, { x: ex, y: ey, z: ez }, W, H, { near: 0.005, far: 200 });
      applyRigCamera(cam, { x: ex, y: ey, z: ez }, W, H, pose, { near: 0.005, far: 200 });
      for (const [px, py, pz] of pts) {
        const a = new Vector3(px, py, pz).project(ref);
        const q = windowToScene(pose, { x: px, y: py, z: pz });
        const b = new Vector3(q.x, q.y, q.z).project(cam);
        close(b.x, a.x, 1e-9, 'ndc x');
        close(b.y, a.y, 1e-9, 'ndc y');
        close(b.z, a.z, 1e-7, 'ndc depth');
      }
      // The window's corners in the scene are the canvas corners.
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const q = windowToScene(pose, { x: (sx * W) / 2, y: (sy * H) / 2, z: 0 });
        const v = new Vector3(q.x, q.y, q.z).project(cam);
        close(v.x, sx, 1e-9);
        close(v.y, sy, 1e-9);
      }
    }
  }
});

test('rig: camera position is position + R (scale eye), its rotation R, and view.eyeWorld is that position', () => {
  const pose = { x: 0.7, y: -0.2, z: -1.1, yaw: 63, pitch: -18, scale: 0.4 };
  const eye = { x: 0.08, y: -0.03, z: 0.55 };
  const cam = new PerspectiveCamera();
  const view = newView();
  applyRigCamera(cam, eye, W, H, pose, { near: 0.005, far: 200 }, view);
  const e = windowToScene(pose, eye);
  close(cam.position.x, e.x, 1e-12);
  close(cam.position.y, e.y, 1e-12);
  close(cam.position.z, e.z, 1e-12);
  assert.ok(view.eyeWorld.equals(cam.position), 'eyeWorld is the camera position');
  const world = new Vector3().setFromMatrixPosition(cam.matrixWorld);
  close(world.distanceTo(view.eyeWorld), 0, 1e-12, 'and the drawn camera is there');
  const q = new Quaternion().setFromEuler(new Euler(pose.pitch * DEG, pose.yaw * DEG, 0, 'YXZ'));
  close(Math.abs(q.dot(cam.quaternion)), 1, 1e-12, 'R = Ry(yaw) Rx(pitch)');
  assert.ok(view.rig.quaternion.equals(cam.quaternion));
  assert.deepEqual(view.rig.position.toArray(), [0.7, -0.2, -1.1]);
  assert.equal(view.rig.scale, 0.4);
  assert.equal(cam.near, 0.005 * 0.4);
  assert.equal(cam.far, 200 * 0.4);
});

test('rig: positive yaw turns the view left, positive pitch tilts it up', () => {
  const f = rotate(90, 0, [0, 0, -1]);
  close(f[0], -1, 1e-12);
  close(f[2], 0, 1e-12);
  const u = rotate(0, 30, [0, 0, -1]);
  assert.ok(u[1] > 0.49);
  const q = rigQuaternion(90, 0);
  const v = new Vector3(0, 0, -1).applyQuaternion(new Quaternion(...q));
  close(v.x, -1, 1e-12);
});

test('rig: the short way round', () => {
  assert.equal(shortYaw(170, -170), 20);
  assert.equal(shortYaw(-170, 170), -20);
  assert.equal(shortYaw(0, 270), -90);
  assert.equal(shortYaw(350, 10), 20);
  assert.equal(shortYaw(10, 10 + 720), 0);
  assert.equal(Math.abs(shortYaw(0, 180)), 180);
});

test('nav: stations are completed, bounds and scale always hold them, bad tour stops skipped', () => {
  const warnings = [];
  const nav = normalizeNav({
    stations: [
      { id: 'a', title: 'A', pose: { position: [0, 0, 0] } },
      { id: 'b', pose: { position: [3, 0, -1], yaw: 200, pitch: 120, scale: 0.05 } },
      { id: 'a', title: 'Again' },
    ],
    bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
    scale: [0.15, 1.5],
    tour: ['b', 'nope', 'a'],
  }, (m) => warnings.push(m));
  assert.equal(nav.stations.length, 3);
  assert.deepEqual(nav.stations[0].pose, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, scale: 1 });
  assert.equal(nav.stations[1].title, 'b');
  assert.equal(nav.stations[1].pose.pitch, 89, 'pitch is kept short of straight up');
  assert.notEqual(nav.stations[2].id, 'a', 'a repeated id is renamed');
  assert.equal(nav.bounds.max[0], 3, 'bounds widened to the station');
  assert.equal(nav.scale[0], 0.05, 'scale widened to the station');
  assert.deepEqual(nav.tour, ['b', 'a']);
  assert.ok(warnings.length >= 3);
  assert.equal(normalizeNav(null), null);
  assert.equal(normalizeNav({ stations: [] }), null);
  const all = normalizeNav({ stations: [{ id: 'x' }, { id: 'y' }] });
  assert.deepEqual(all.tour, ['x', 'y'], 'no tour: every station in order');
});

// ------------------------------------------------------------------ motion

const NAV = normalizeNav({
  stations: [
    { id: 'front', title: 'Front', pose: { position: [0, 0, 0] } },
    { id: 'inside', title: 'Inside', pose: { position: [0.1, -0.05, -0.3], yaw: 170, pitch: -10, scale: 0.25 } },
    { id: 'side', title: 'Side', pose: { position: [-0.12, 0.05, -0.2], yaw: -170, pitch: 5, scale: 0.4 } },
    { id: 'high', title: 'High', pose: { position: [0, 0.1, -0.1], yaw: 0, pitch: -40, scale: 0.6 } },
  ],
  bounds: { min: [-0.15, -0.1, -0.4], max: [0.15, 0.1, 0.2] },
  scale: [0.15, 1.5],
  tour: ['inside', 'high', 'side'],
});

/** Run the motion at frame steps; returns the poses (copies). */
function run(m, seconds, { dt = 1 / 60, rates = null, each = null } = {}) {
  const out = [];
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    each?.(i, m);
    out.push({ ...m.update(dt, rates) });
  }
  return out;
}

const AXES = ['x', 'y', 'z', 'yaw', 'pitch', 'scale'];

test('motion: a scene without nav keeps the default rig whatever the input', () => {
  const m = new RigMotion();
  m.setNav(null);
  m.nudge({ forward: 1, yaw: 30, scaleSteps: 2 });
  const p = run(m, 0.5, { rates: { forward: 1, turn: 1 } }).at(-1);
  assert.deepEqual(p, { ...IDENTITY_POSE });
});

test('motion: starts at the first station, exactly', () => {
  const m = new RigMotion();
  m.setNav(NAV);
  assert.deepEqual({ ...m.pose }, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, scale: 1 });
  assert.equal(m.at, 'front');
});

test('motion: held keys move inside the bounds and the scale range, and stop at them without pushing through', () => {
  const m = new RigMotion();
  m.setNav(NAV);
  // Forward for long enough to cross the room several times.
  const poses = run(m, 8, { rates: { forward: 1, boost: 2.5 } });
  for (const p of poses) assert.ok(p.z >= NAV.bounds.min[2] - 1e-12 && p.z <= NAV.bounds.max[2] + 1e-12, `z ${p.z}`);
  close(poses.at(-1).z, NAV.bounds.min[2], 1e-6, 'reaches the back bound');
  // Strafe right, rise, and grow far past the limits.
  run(m, 6, { rates: { right: 1, up: 1, scale: -1, scaleHeld: 10, boost: 2.5 } });
  const p = m.pose;
  close(p.x, NAV.bounds.max[0], 1e-6);
  close(p.y, NAV.bounds.max[1], 1e-6);
  close(p.scale, NAV.scale[1], 1e-6);
  // Shrink far past the limit with presses.
  for (let i = 0; i < 40; i++) m.nudge({ scaleSteps: 1 });
  run(m, 3);
  close(m.pose.scale, NAV.scale[0], 1e-6);
  // Pitch is limited too.
  m.nudge({ pitch: 500 });
  run(m, 3);
  close(m.pose.pitch, NAV.pitchLimit, 1e-6);
});

test('motion: arrow speed is in window metres, so it is the same at every scale', () => {
  const at = (steps) => {
    const m = new RigMotion();
    m.setNav(normalizeNav({ stations: [{ id: 'a', pose: { position: [0, 0, 0] } }], bounds: { min: [-9, -9, -9], max: [9, 9, 9] }, scale: [0.1, 2] }));
    m.nudge({ scaleSteps: steps });
    run(m, 3);
    const s = m.pose.scale;
    const z0 = m.pose.z;
    run(m, 1, { rates: { forward: 1 } });
    run(m, 2);
    return { s, dz: m.pose.z - z0 };
  };
  const a = at(0);
  const b = at(4);
  close(a.dz, -MOTION_DEFAULTS.moveSpeed, 1e-3, 'scale 1: 1 s of forward moves moveSpeed metres');
  close(b.dz / b.s, a.dz / a.s, 1e-6, 'per unit of scale, the same');
});

test('motion: a released key settles without going past where it stopped (no overshoot)', () => {
  const m = new RigMotion();
  m.setNav(normalizeNav({ stations: [{ id: 'a', pose: { position: [0, 0, 0] } }], bounds: { min: [-9, -9, -9], max: [9, 9, 9] } }));
  run(m, 0.6, { rates: { forward: 1, turn: 1 } });
  const goalZ = m.goal[2], goalYaw = m.goal[3];
  const after = run(m, 3);
  for (let i = 1; i < after.length; i++) {
    assert.ok(after[i].z <= after[i - 1].z + 1e-12, 'z keeps going one way');
    assert.ok(after[i].z >= goalZ - 1e-9, 'and never past the goal');
    assert.ok(after[i].yaw <= goalYaw + 1e-9);
  }
});

test('motion: a glide eases out and in, never overshoots, and lands exactly', () => {
  for (const dt of [1 / 60, 1 / 30, 1 / 120]) {
    const m = new RigMotion();
    m.setNav(NAV);
    m.glideTo('inside');
    const to = { ...NAV.stations[1].pose };
    to.yaw = 170; // 0 -> 170 is the short way
    const from = { ...m.pose };
    const poses = run(m, 6, { dt });
    // Each axis moves one way only, from the start to the station.
    for (const k of AXES) {
      const sign = Math.sign(to[k] - from[k]);
      let prev = from[k];
      for (const p of poses) {
        assert.ok(sign * (p[k] - prev) >= -1e-12, `${k} turned back at dt ${dt}`);
        assert.ok(sign * (to[k] - p[k]) >= -1e-9, `${k} overshot: ${p[k]} past ${to[k]}`);
        prev = p[k];
      }
    }
    // Slow out: the first frame barely moves.
    assert.ok(Math.abs(poses[0].z - from.z) < 1e-4, 'eases out');
    const last = poses.at(-1);
    for (const k of AXES) close(last[k], to[k], 1e-3, k);
    assert.equal(m.at, 'inside');
  }
});

test('motion: glides are continuous: no frame jumps, also when a glide is replaced or taken over midway', () => {
  const m = new RigMotion();
  m.setNav(NAV);
  const steps = [];
  let prev = { ...m.pose };
  const record = (p) => {
    const d = Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z) / Math.min(p.scale, prev.scale);
    steps.push({ d, yaw: Math.abs(shortYaw(prev.yaw, p.yaw)), ls: Math.abs(Math.log(p.scale / prev.scale)) });
    prev = { ...p };
  };
  m.glideTo('inside');
  for (const p of run(m, 0.7)) record(p);
  m.glideTo('high'); // redirected midway
  for (const p of run(m, 0.5)) record(p);
  m.nudge({ yaw: 5 }); // the viewer takes over midway
  for (const p of run(m, 0.4)) record(p);
  m.glideTo('side');
  for (const p of run(m, 6)) record(p);
  // At 60 fps no frame moves more than 2 cm (window units), 3 degrees or 2.5 % of scale.
  const worst = steps.reduce((a, s) => ({ d: Math.max(a.d, s.d), yaw: Math.max(a.yaw, s.yaw), ls: Math.max(a.ls, s.ls) }), { d: 0, yaw: 0, ls: 0 });
  assert.ok(worst.d < 0.02, `position step ${worst.d}`);
  assert.ok(worst.yaw < 3, `yaw step ${worst.yaw}`);
  assert.ok(worst.ls < 0.025, `scale step ${worst.ls}`);
  // Speed changes smoothly too (no jolt when redirected): frame-to-frame
  // change of the step is small.
  let jolt = 0;
  for (let i = 1; i < steps.length; i++) jolt = Math.max(jolt, Math.abs(steps[i].d - steps[i - 1].d));
  assert.ok(jolt < 0.002, `jolt ${jolt}`);
  close(m.pose.yaw, -170, 1e-3);
  assert.equal(m.at, 'side');
});

test('motion: a glide turns the short way round, through 180 and not through 0', () => {
  const m = new RigMotion();
  m.setNav(NAV);
  m.snap(NAV.stations[1].pose); // yaw 170
  m.glideTo('side'); // yaw -170: 20 degrees the short way, across 180
  const poses = run(m, 5);
  for (const p of poses) {
    const a = ((p.yaw % 360) + 360) % 360;
    assert.ok(a >= 170 - 1e-6 && a <= 190 + 1e-6, `yaw ${p.yaw} left the short arc`);
  }
  const end = ((poses.at(-1).yaw % 360) + 360) % 360;
  close(end, 190, 1e-3);
  assert.ok(poses.every((p) => p.yaw > -180 - 1e-9 && p.yaw <= 180 + 1e-9), 'yaw is kept in (-180, 180]');
});

test('motion: scale glides evenly in log space', () => {
  const m = new RigMotion();
  m.setNav(NAV);
  m.glideTo('inside'); // scale 1 -> 0.25
  const dur = m.glide.dur;
  // With the spring's lag the halfway scale is geometric, not arithmetic:
  // when log scale is half way, scale is 0.5, not 0.625.
  const poses = run(m, dur + 2);
  const half = poses.find((p) => p.scale <= 0.5 + 1e-9);
  const zFrac = (half.z - 0) / (-0.3 - 0);
  close(zFrac, 0.5, 0.06, 'scale reaches 0.5 (log half way) when position is half way');
});

test('motion: next and previous step through stations in order and wrap', () => {
  const m = new RigMotion();
  m.setNav(NAV);
  const seen = [];
  for (let i = 0; i < 5; i++) {
    m.step(1);
    run(m, 6);
    seen.push(m.at);
  }
  assert.deepEqual(seen, ['inside', 'side', 'high', 'front', 'inside']);
  m.step(-1);
  run(m, 6);
  assert.equal(m.at, 'front');
  m.glideTo('high');
  run(m, 6);
  m.home();
  run(m, 6);
  assert.equal(m.at, 'front');
});

test('tour: glides through nav.tour in order, holds each stop, loops, and stops on any move', () => {
  const arrivals = [];
  const tours = [];
  const m = new RigMotion({}, { arrive: (s, o) => arrivals.push({ id: s.id, t: m.t, tour: o.tour }), tour: (on) => tours.push(on) });
  m.setNav(NAV);
  assert.equal(m.startTour(), true);
  run(m, 75);
  const ids = arrivals.map((a) => a.id);
  assert.deepEqual(ids.slice(0, 6), ['inside', 'high', 'side', 'inside', 'high', 'side']);
  // Holds: from one arrival to the next glide's start is tourHold seconds;
  // the time between arrivals is the hold plus that glide.
  for (let i = 1; i < arrivals.length; i++) {
    const gap = arrivals[i].t - arrivals[i - 1].t;
    assert.ok(gap >= MOTION_DEFAULTS.tourHold + MOTION_DEFAULTS.glide.min - 1e-6, `gap ${gap}`);
    assert.ok(gap <= MOTION_DEFAULTS.tourHold + MOTION_DEFAULTS.glide.max * MOTION_DEFAULTS.tourSlow + 1, `gap ${gap}`);
  }
  // A move stops the tour.
  m.nudge({ yaw: 1 });
  assert.equal(m.tour.on, false);
  const n = arrivals.length;
  run(m, 20);
  assert.equal(arrivals.length, n, 'no more stops after it ended');
  assert.deepEqual(tours, [true, false]);
});

test('tour: starts after the station the rig is at, holds still at each stop', () => {
  const arrivals = [];
  const m = new RigMotion({}, { arrive: (s) => arrivals.push({ id: s.id, t: m.t }) });
  m.setNav(NAV);
  m.glideTo('high');
  run(m, 6);
  arrivals.length = 0;
  m.startTour();
  // Track the rig during the first hold.
  const poses = [];
  run(m, 30, { each: () => poses.push({ t: m.t, ...m.pose }) });
  assert.equal(arrivals[0].id, 'side', 'high is followed by side in the tour');
  const a0 = arrivals[0].t;
  const during = poses.filter((p) => p.t > a0 + 0.05 && p.t < a0 + MOTION_DEFAULTS.tourHold - 0.05);
  const spread = Math.max(...during.map((p) => p.z)) - Math.min(...during.map((p) => p.z));
  assert.ok(spread < 1e-3, `moved ${spread} m while holding`);
  // T again stops it; a station click during the tour stops it too.
  m.toggleTour();
  assert.equal(m.tour.on, false);
  m.startTour();
  m.glideTo('front');
  assert.equal(m.tour.on, false);
});

test('ease: zero speed at both ends, symmetric', () => {
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  close(ease(0.5), 0.5, 1e-12);
  close(ease(0.01), 0.0003, 1e-4);
  close(ease(0.3) + ease(0.7), 1, 1e-12);
});

test('motion: a glide begun while already moving carries on smoothly and still never passes the station', () => {
  const open = normalizeNav({
    stations: [
      { id: 'a', pose: { position: [0, 0, 0] } },
      { id: 'near', pose: { position: [0, 0, -0.05] } },
      { id: 'far', pose: { position: [0, 0, -1] } },
      { id: 'behind', pose: { position: [0, 0, 0.6] } },
    ],
    bounds: { min: [-2, -2, -2], max: [2, 2, 2] },
  });
  for (const target of ['near', 'far', 'behind']) {
    for (const boost of [1, 2.5]) {
      const m = new RigMotion();
      m.setNav(open);
      run(m, 0.5, { rates: { forward: 1, boost } }); // moving toward -z
      const v0 = m.vel[2];
      const z0 = m.pose.z;
      m.glideTo(target);
      const to = open.stations.find((s) => s.id === target).pose.z;
      const poses = run(m, 7);
      // Never past the station.
      const sign = Math.sign(to - z0);
      for (const p of poses) assert.ok(sign * (to - p.z) >= -1e-9, `${target} x${boost}: ${p.z} passed ${to}`);
      // No jolt where the glide took over: the first frame keeps the speed it
      // had (within the spring's own change in one frame).
      const v1 = (poses[0].z - z0) * 60;
      assert.ok(Math.abs(v1 - v0) < Math.abs(v0) * 0.2 + 1e-3, `${target}: speed ${v0} -> ${v1}`);
      close(poses.at(-1).z, to, 1e-3);
    }
  }
});

test('motion: a move right after a turn goes the new way at once, not along the spring\'s lag', () => {
  const m = new RigMotion();
  m.setNav(normalizeNav({ stations: [{ id: 'a', pose: { position: [0, 0, 0] } }], bounds: { min: [-9, -9, -9], max: [9, 9, 9] } }));
  m.nudge({ yaw: 90 }); // a drag turns the view left a quarter turn
  m.update(1 / 60); // the spring has barely started turning
  assert.ok(m.pose.yaw < 5, `still turning: ${m.pose.yaw}`);
  m.nudge({ forward: 0.1 });
  close(m.goal[0], -0.1, 1e-12, 'forward is now toward -x (the new heading)');
  close(m.goal[2], 0, 1e-12, 'not toward -z (the old one)');
  m.nudge({ right: 0.1 });
  close(m.goal[2], -0.1, 1e-12, 'right is toward -z after a quarter turn left');
  m.nudge({ pitch: 30 });
  m.nudge({ dolly: 0.1 });
  close(m.goal[1], 0.05, 1e-12, 'the dolly climbs with the new tilt');
});

test('motion: a station just ahead of a fast-moving rig is reached without passing it', () => {
  for (const ahead of [0.002, 0.01, 0.03]) {
    const m = new RigMotion();
    m.setNav(normalizeNav({ stations: [{ id: 'a', pose: { position: [0, 0, 0] } }, { id: 'b', pose: { position: [0, 0, -9] } }], bounds: { min: [-10, -10, -10], max: [10, 10, 10] } }));
    run(m, 1.5, { rates: { forward: 1, boost: 2.5 } });
    const z0 = m.pose.z;
    assert.ok(m.vel[2] < -0.3, 'moving fast');
    m.nav.stations[1].pose.z = z0 - ahead; // a station just ahead
    m.glideTo('b');
    const poses = run(m, 5);
    for (const p of poses) assert.ok(p.z >= z0 - ahead - 1e-9, `${ahead}: ${p.z} passed ${z0 - ahead}`);
    close(poses.at(-1).z, z0 - ahead, 1e-4);
  }
});

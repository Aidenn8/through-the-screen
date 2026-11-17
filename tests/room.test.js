// nav.room (docs/ARCHITECTURE.md): the eye's world position stays inside the
// set's room. src/core/rig.js keepEyeInRoom, used by the app every frame.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera } from 'three';
import {
  keepEyeInRoom, insideRoom, windowToScene, sceneToWindow, normalizeNav, applyRigCamera, EYE_MIN_Z,
} from '../src/core/rig.js';
import { RigMotion } from '../src/core/rig-motion.js';

// A stage building: the rig may go a little inside its walls (bounds), the
// eye anywhere inside them (room). Scale 0.05-1, like the Soundstage.
const NAV = normalizeNav({
  stations: [
    { id: 'front', pose: { position: [0, 0.3, 1.2], yaw: 0, scale: 1 } },
    { id: 'corner', pose: { position: [0.7, 0.1, -1.2], yaw: -135, pitch: -10, scale: 0.25 } },
    { id: 'wall', pose: { position: [-0.75, 0.2, 0], yaw: 90, scale: 0.6 } }, // facing the -x wall, close to it
    { id: 'high', pose: { position: [0, 0.6, 0], pitch: -60, scale: 0.1 } },
  ],
  bounds: { min: [-0.8, -0.04, -1.34], max: [0.8, 0.62, 1.47] },
  scale: [0.05, 1],
  room: { min: [-0.866, -0.124, -1.453], max: [0.866, 0.675, 1.59] },
});
const ROOM = NAV.room;

const close = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const lerp = (a, b, u) => a + (b - a) * u;
// A random pose in bounds, as the rig can hold it (RigMotion's clamp).
const motion = new RigMotion();
motion.setNav(NAV);
const randomPose = (lo, hi) => {
  motion.snap({
    x: lerp(NAV.bounds.min[0], NAV.bounds.max[0], rnd()),
    y: lerp(NAV.bounds.min[1], NAV.bounds.max[1], rnd()),
    z: lerp(NAV.bounds.min[2], NAV.bounds.max[2], rnd()),
    yaw: rnd() * 360 - 180,
    pitch: rnd() * 120 - 60,
    scale: Math.exp(lerp(Math.log(lo), Math.log(hi), rnd())),
  });
  return { ...motion.pose };
};
// Eyes (window coordinates): typical (Look around 3x of ±10 cm sideways,
// ±6 cm up and down at 4.5x, ±10 cm in depth at 2x) and the view cone's extremes.
const typicalEye = () => ({ x: lerp(-0.3, 0.3, rnd()), y: lerp(-0.27, 0.27, rnd()), z: lerp(0.4, 0.8, rnd()) });
const extremeEye = () => ({ x: lerp(-0.5, 0.5, rnd()), y: lerp(-0.4, 0.48, rnd()), z: lerp(0.2, 1.4, rnd()) });

test('room: random in-bounds poses at scales 0.05-1, typical and extreme head moves: the eye stays in the room, in front of the glass', () => {
  for (const [lo, hi] of [[0.05, 0.15], [0.15, 0.4], [0.4, 1]]) {
    let wasOut = 0;
    for (let i = 0; i < 6000; i++) {
      const pose = randomPose(lo, hi);
      const eye = i % 2 ? typicalEye() : extremeEye();
      if (!insideRoom(ROOM, windowToScene(pose, eye))) wasOut++;
      const e = keepEyeInRoom(eye, pose, ROOM);
      const w = windowToScene(pose, e);
      assert.ok(insideRoom(ROOM, w, 1e-9), `scale ${pose.scale.toFixed(2)}: eye at ${JSON.stringify(w)}`);
      assert.ok(e.z >= EYE_MIN_Z - 1e-9, `in front of the glass: ${e.z}`);
    }
    assert.ok(wasOut > 0, `some eyes started outside at scale ${lo}-${hi}`);
  }
});

test('room: an eye inside is untouched (the same object), so True window and every frame inside are exact', () => {
  const pose = { x: 0.1, y: 0.3, z: 0.2, yaw: 30, pitch: -5, scale: 0.2 };
  const eye = { x: 0.03, y: -0.02, z: 0.6 };
  assert.ok(insideRoom(ROOM, windowToScene(pose, eye)));
  assert.equal(keepEyeInRoom(eye, pose, ROOM), eye);
  const a = new PerspectiveCamera();
  const b = new PerspectiveCamera();
  applyRigCamera(a, eye, 0.33, 0.21, pose, { near: 0.005, far: 200 });
  applyRigCamera(b, keepEyeInRoom(eye, pose, ROOM), 0.33, 0.21, pose, { near: 0.005, far: 200 });
  assert.deepEqual([...b.projectionMatrix.elements], [...a.projectionMatrix.elements]);
  assert.deepEqual([...b.matrixWorld.elements], [...a.matrixWorld.elements]);
  // No room: nothing changes either.
  assert.equal(keepEyeInRoom(eye, pose, null), eye);
});

test('room: a head moving through a wall stops at it without a jump and slides along it', () => {
  // The window 20 cm from the -x wall at scale 1, facing along +z: leaning
  // left far enough would put the eye through the wall.
  const pose = { x: -0.666, y: 0.3, z: 0.5, yaw: 0, pitch: 0, scale: 1 };
  let prev = null;
  let worst = 0;
  const path = [];
  for (let i = 0; i <= 600; i++) {
    const u = i / 600;
    const eye = { x: lerp(0.1, -0.5, u), y: lerp(-0.1, 0.1, u), z: 0.6 }; // a lean left, rising a little
    const e = keepEyeInRoom(eye, pose, ROOM);
    const w = windowToScene(pose, e);
    if (prev) {
      const step = Math.hypot(w.x - prev.x, w.y - prev.y, w.z - prev.z);
      const input = Math.hypot(0.6 / 600, 0.2 / 600);
      worst = Math.max(worst, step / input);
    }
    prev = w;
    path.push(w);
  }
  assert.ok(worst <= 1 + 1e-9, `never moves more than the head does: ${worst}`);
  const atWall = path.filter((w) => Math.abs(w.x - ROOM.min[0]) < 1e-12);
  assert.ok(atWall.length > 100, 'it reaches the wall and stays there');
  assert.ok(atWall.at(-1).y - atWall[0].y > 0.05, 'and still rises along it (head tracking works at the wall)');
  for (const w of path) assert.ok(w.x >= ROOM.min[0] - 1e-12);
});

test('room: near a wall behind the viewer, the eye keeps to the room and in front of the glass, continuously', () => {
  // The window 10 cm from the -x wall, facing away from it (the viewer
  // stands toward the wall): the nearest point in the room is often too
  // close to the glass, so the eye goes to the nearest point that is both.
  const pose = { x: -0.766, y: 0.3, z: 0, yaw: -90, pitch: 0, scale: 1 };
  let prev = null;
  let worst = 0;
  for (let i = 0; i <= 400; i++) {
    const eye = { x: lerp(-0.4, 0.4, i / 400), y: 0.05, z: 0.6 };
    const e = keepEyeInRoom(eye, pose, ROOM);
    const w = windowToScene(pose, e);
    assert.ok(insideRoom(ROOM, w, 1e-9), JSON.stringify(w));
    assert.ok(e.z >= EYE_MIN_Z - 1e-9);
    if (prev) worst = Math.max(worst, Math.hypot(e.x - prev.x, e.y - prev.y, e.z - prev.z));
    prev = e;
  }
  assert.ok(worst < 0.01, `largest step ${worst} for 2 mm of head`);
});

test('room: the rig is held off a wall behind it, so some eye in front of the glass is always in the room', () => {
  const m = new RigMotion();
  m.setNav(NAV);
  // Backed against the -x wall, facing away from it, at full scale.
  m.snap({ x: -0.8, y: 0.3, z: 0, yaw: -90, pitch: 0, scale: 1 });
  assert.ok(m.pose.x >= ROOM.min[0] + EYE_MIN_Z - 1e-9, `held ${m.pose.x - ROOM.min[0]} m off the wall`);
  // Walking backward into it (the arrows) stops short, smoothly.
  m.snap({ x: -0.6, y: 0.3, z: 0, yaw: -90, pitch: 0, scale: 1 });
  let prev = m.pose.x;
  for (let i = 0; i < 300; i++) {
    m.update(1 / 60, { forward: -1, boost: 2.5 });
    assert.ok(Math.abs(m.pose.x - prev) < 0.02, 'no jump at the wall');
    prev = m.pose.x;
  }
  const q = windowToScene(m.pose, { x: 0, y: 0, z: EYE_MIN_Z });
  assert.ok(insideRoom(ROOM, q, 1e-6), `the nearest eye is in the room: ${JSON.stringify(q)}`);
  // Turned away from it at a smaller scale, it may come closer.
  m.snap({ x: -0.8, y: 0.3, z: 0, yaw: -90, pitch: 0, scale: 0.25 });
  close(m.pose.x, -0.8, 1e-12);
});

test('room: a station inside the wall hold-off is landed just off the wall, and the tour goes on', () => {
  // 'tight' is 5 cm from the -x wall, facing away from it, at full scale:
  // the rig cannot be there (the eye would have to be in the wall).
  const nav = normalizeNav({
    stations: [
      { id: 'a', pose: { position: [0, 0.3, 0] } },
      { id: 'tight', pose: { position: [ROOM.min[0] + 0.05, 0.3, 0], yaw: -90, scale: 1 } },
      { id: 'b', pose: { position: [0.3, 0.3, -0.5], yaw: 30, scale: 0.5 } },
    ],
    bounds: { min: [-0.85, -0.1, -1.4], max: [0.85, 0.65, 1.5] },
    scale: [0.05, 1],
    room: ROOM,
  });
  const arrivals = [];
  const m = new RigMotion({}, { arrive: (s) => arrivals.push(s.id) });
  m.setNav(nav);
  m.startTour();
  for (let i = 0; i < 60 * 60 && arrivals.length < 4; i++) {
    m.update(1 / 60);
    if (m.at === 'tight') {
      const q = windowToScene(m.pose, { x: 0, y: 0, z: EYE_MIN_Z });
      assert.ok(insideRoom(ROOM, q, 1e-6), 'held off the wall at the tight station');
    }
  }
  assert.deepEqual(arrivals.slice(0, 4), ['tight', 'b', 'a', 'tight'], 'the tour does not hang at the tight station');
  assert.ok(m.tour.on);
});

test('room: glides between stations keep the eye in the room, every frame, without jumps', () => {
  const m = new RigMotion();
  m.setNav(NAV);
  const eyes = [{ x: 0, y: 0, z: 0.6 }, { x: 0.45, y: 0.4, z: 1.3 }, { x: -0.45, y: -0.35, z: 0.25 }];
  for (const target of ['corner', 'wall', 'high', 'front', 'wall', 'corner']) {
    m.glideTo(target);
    const prev = eyes.map(() => null);
    for (let f = 0; f < 6 * 60; f++) {
      const pose = { ...m.update(1 / 60) };
      eyes.forEach((eye, k) => {
        const w = windowToScene(pose, keepEyeInRoom(eye, pose, ROOM));
        assert.ok(insideRoom(ROOM, w, 1e-9), `${target}, frame ${f}`);
        if (prev[k]) {
          const step = Math.hypot(w.x - prev[k].x, w.y - prev[k].y, w.z - prev[k].z);
          assert.ok(step < 0.05, `${target}, frame ${f}: the eye jumped ${step} m`);
        }
        prev[k] = w;
      });
    }
    assert.equal(m.at, target);
  }
});

test('room: kept by normalizeNav when well formed, dropped with a warning otherwise; sceneToWindow inverts windowToScene', () => {
  assert.deepEqual(NAV.room, { min: [-0.866, -0.124, -1.453], max: [0.866, 0.675, 1.59] });
  const warnings = [];
  const bad = normalizeNav({ stations: [{ id: 'a' }], room: { min: [0, 0, 0], max: [1, -1, 1] } }, (w) => warnings.push(w));
  assert.equal(bad.room, undefined);
  assert.equal(warnings.length, 1);
  assert.equal(normalizeNav({ stations: [{ id: 'a' }] }).room, undefined);
  const pose = { x: 0.3, y: -0.1, z: 0.7, yaw: 123, pitch: 31, scale: 0.37 };
  const p = { x: 0.02, y: -0.05, z: 0.4 };
  const w = windowToScene(pose, p);
  const back = sceneToWindow(pose, [w.x, w.y, w.z]);
  for (const k of ['x', 'y', 'z']) assert.ok(Math.abs(back[k] - p[k]) < 1e-12);
});

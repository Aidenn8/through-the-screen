import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EyeObserver, solveEyes, eyesFromRays, pixelRay, headAxesFromMatrix, headAxesFromLandmarks,
  pickFace, eyePoint, vec, headAngles,
} from '../src/tracking/eye-solve.js';
import { intrinsicsFor } from '../src/tracking/camera-presets.js';
import { cameraToDisplay, cameraPosition, displaySize } from '../src/core/display.js';
import { syntheticFace, blink } from './helpers/synthetic-face.js';

const INTR = intrinsicsFor(1280, 720, 68);
const mm = (a, b) => 1000 * vec.len(vec.sub(a, b));

// Seeded random poses across the space a laptop viewer can occupy.
function* poses(n, seed = 7) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const z = 0.3 + r() * 0.9;
    // Keep the face inside the frame.
    const x = (r() - 0.5) * z * 0.9;
    const y = (r() - 0.5) * z * 0.45;
    yield { mid: { x, y, z }, yaw: (r() - 0.5) * 70, pitch: (r() - 0.5) * 40, roll: (r() - 0.5) * 30 };
  }
}

test('closed-form solve is exact given exact rays and head axis', () => {
  for (const p of poses(200)) {
    const f = syntheticFace({ ...p, intr: INTR });
    const t = f.truth;
    const rR = vec.norm(t.right);
    const rL = vec.norm(t.left);
    const ipd = vec.len(vec.sub(t.left, t.right));
    const axis = vec.norm(vec.sub(t.left, t.right));
    const s = eyesFromRays(rR, rL, ipd, axis);
    assert.ok(mm(s.right, t.right) < 1e-6 && mm(s.left, t.left) < 1e-6, JSON.stringify(p));
  }
});

test('eye solve from synthetic landmarks + matrix: within a few mm across yaw, pitch and distance', () => {
  let worst = 0;
  let sum = 0;
  let n = 0;
  for (const p of poses(300)) {
    const f = syntheticFace({ ...p, intr: INTR });
    const obs = new EyeObserver().observe(f.landmarks, INTR.width, INTR.height);
    const sol = solveEyes(obs, INTR, headAxesFromMatrix(f.matrix), 0.063);
    const e = mm(sol.centre, f.truth.centre);
    // Error budget scales with distance (vergence model + eye-rotation geometry).
    assert.ok(e < 2 + 2 * p.mid.z, `centre error ${e.toFixed(2)} mm at ${JSON.stringify(p)}`);
    assert.ok(mm(sol.right, f.truth.right) < 4 + 4 * p.mid.z);
    assert.ok(mm(sol.left, f.truth.left) < 4 + 4 * p.mid.z);
    worst = Math.max(worst, e);
    sum += e * e;
    n++;
  }
  const rms = Math.sqrt(sum / n);
  assert.ok(rms < 1.5, `rms ${rms}`);
});

test('eye solve with head axes from landmark depths only (no matrix)', () => {
  let sum = 0;
  let n = 0;
  for (const p of poses(300, 11)) {
    const f = syntheticFace({ ...p, intr: INTR });
    const obs = new EyeObserver().observe(f.landmarks, INTR.width, INTR.height);
    const axes = headAxesFromLandmarks(f.landmarks, INTR.width, INTR.height, INTR);
    const sol = solveEyes(obs, INTR, axes, 0.063);
    const e = mm(sol.centre, f.truth.centre);
    assert.ok(e < 2 + 4 * p.mid.z, `centre error ${e.toFixed(2)} mm at ${JSON.stringify(p)}`);
    sum += e * e;
    n++;
  }
  assert.ok(Math.sqrt(sum / n) < 2, `rms ${Math.sqrt(sum / n)}`);
});

test('ignoring yaw would be wrong: a 30 degree turn changes depth by centimetres', () => {
  const p = { mid: { x: 0, y: 0.05, z: 0.6 }, yaw: 30 };
  const f = syntheticFace({ ...p, intr: INTR });
  const obs = new EyeObserver().observe(f.landmarks, INTR.width, INTR.height);
  const good = solveEyes(obs, INTR, headAxesFromMatrix(f.matrix), 0.063);
  const naive = solveEyes(obs, INTR, { axis: { x: 1, y: 0, z: 0 }, up: { x: 0, y: -1, z: 0 } }, 0.063);
  assert.ok(mm(good.centre, f.truth.centre) < 3);
  assert.ok(mm(naive.centre, f.truth.centre) > 50, `naive error ${mm(naive.centre, f.truth.centre)}`);
});

test('looking at a screen corner instead of the camera moves the pupils a few mm, not more', () => {
  const p = { mid: { x: 0.03, y: 0.12, z: 0.55 }, yaw: 5 };
  const corner = { x: 0.16, y: 0.2, z: 0 };
  const f = syntheticFace({ ...p, intr: INTR, gaze: corner });
  const obs = new EyeObserver().observe(f.landmarks, INTR.width, INTR.height);
  const sol = solveEyes(obs, INTR, headAxesFromMatrix(f.matrix), 0.063);
  assert.ok(mm(sol.centre, f.truth.centre) < 4, `${mm(sol.centre, f.truth.centre)}`);
});

test('wrong eye spacing scales the eye position about the camera', () => {
  const p = { mid: { x: 0.1, y: 0.1, z: 0.6 } };
  const f = syntheticFace({ ...p, intr: INTR });
  const obs = new EyeObserver().observe(f.landmarks, INTR.width, INTR.height);
  const axes = headAxesFromMatrix(f.matrix);
  const a = solveEyes(obs, INTR, axes, 0.063);
  const b = solveEyes(obs, INTR, axes, 0.063 * 1.1);
  for (const k of ['x', 'y', 'z']) assert.ok(Math.abs(b.centre[k] / a.centre[k] - 1.1) < 0.003, k);
});

test('blinks do not move the eye point', () => {
  const p = { mid: { x: -0.05, y: 0.08, z: 0.5 }, yaw: -10, pitch: 5 };
  const f = syntheticFace({ ...p, intr: INTR });
  const axes = headAxesFromMatrix(f.matrix);
  const ob = new EyeObserver({ source: 'iris' });
  const open = solveEyes(ob.observe(f.landmarks, INTR.width, INTR.height), INTR, axes, 0.063);
  const shutObs = ob.observe(blink(f.landmarks), INTR.width, INTR.height);
  assert.equal(shutObs.right.open, false);
  const shut = solveEyes(shutObs, INTR, axes, 0.063);
  assert.ok(mm(open.centre, shut.centre) < 0.5, `moved ${mm(open.centre, shut.centre)} mm`);
  // Without the blink memory, the drifting iris guess would move it.
  const naive = solveEyes(new EyeObserver({ source: 'iris' }).observe(blink(f.landmarks, 0.008), INTR.width, INTR.height), INTR, axes, 0.063);
  assert.ok(mm(open.centre, naive.centre) > 2, `naive moved ${mm(open.centre, naive.centre)} mm`);
  const shut2 = solveEyes(ob.observe(blink(f.landmarks, 0.008), INTR.width, INTR.height), INTR, axes, 0.063);
  assert.ok(mm(open.centre, shut2.centre) < 0.5);
});

test('stable source: a saccade to a screen corner does not move the eye point', () => {
  const p = { mid: { x: 0.02, y: 0.1, z: 0.55 }, yaw: 5 };
  const atCam = syntheticFace({ ...p, intr: INTR });
  const atCorner = syntheticFace({ ...p, intr: INTR, gaze: { x: -0.16, y: 0.2, z: 0 } });
  const axes = headAxesFromMatrix(atCam.matrix);
  const stable = new EyeObserver({ source: 'stable' });
  const live = new EyeObserver({ source: 'iris' });
  let t = 0;
  let a;
  let b;
  for (; t < 3; t += 1 / 30) {
    a = solveEyes(stable.observe(atCam.landmarks, 1280, 720, t), INTR, axes, 0.063);
    b = solveEyes(live.observe(atCam.landmarks, 1280, 720, t), INTR, axes, 0.063);
  }
  // Settled on the true pupils.
  assert.ok(mm(a.centre, atCam.truth.centre) < 1);
  // The eyes jump to the corner of the screen: the live iris follows within a
  // frame, the stable point barely moves on that time scale.
  const a2 = solveEyes(stable.observe(atCorner.landmarks, 1280, 720, t), INTR, axes, 0.063);
  const b2 = solveEyes(live.observe(atCorner.landmarks, 1280, 720, t), INTR, axes, 0.063);
  assert.ok(mm(b2.centre, b.centre) > 2, `live moved ${mm(b2.centre, b.centre)}`);
  assert.ok(mm(a2.centre, a.centre) < 0.2, `stable moved ${mm(a2.centre, a.centre)}`);
});

test('iris diameter gives an independent distance estimate', () => {
  for (const z of [0.35, 0.6, 0.9]) {
    const f = syntheticFace({ mid: { x: 0, y: 0.08, z }, intr: INTR });
    const obs = new EyeObserver().observe(f.landmarks, INTR.width, INTR.height);
    const sol = solveEyes(obs, INTR, headAxesFromMatrix(f.matrix), 0.063);
    const truth = vec.len(f.truth.centre);
    assert.ok(Math.abs(sol.irisDistance / truth - 1) < 0.03, `z ${z}: ${sol.irisDistance} vs ${truth}`);
  }
});

test('sign conventions: viewer moving to their right increases display x', () => {
  const size = displaySize('mba15-m2');
  const cam = cameraPosition(size, { kind: 'notch' });
  const xs = [];
  // Viewer's right is the camera's left: camera x decreasing.
  for (const cx of [0.1, 0, -0.1]) {
    const f = syntheticFace({ mid: { x: cx, y: 0.1, z: 0.6 }, intr: INTR });
    const obs = new EyeObserver().observe(f.landmarks, INTR.width, INTR.height);
    const sol = solveEyes(obs, INTR, headAxesFromMatrix(f.matrix), 0.063);
    xs.push(cameraToDisplay(sol.centre, cam).x);
  }
  assert.ok(xs[0] < xs[1] && xs[1] < xs[2], xs.join(' '));
  // And the viewer's right eye is on the display's right.
  const f = syntheticFace({ mid: { x: 0, y: 0.1, z: 0.6 }, intr: INTR });
  const sol = solveEyes(new EyeObserver().observe(f.landmarks, 1280, 720), INTR, headAxesFromMatrix(f.matrix), 0.063);
  assert.ok(cameraToDisplay(sol.right, cam).x > cameraToDisplay(sol.left, cam).x);
});

test('eye modes and phone lens offset', () => {
  const f = syntheticFace({ mid: { x: 0, y: 0.1, z: 0.6 }, intr: INTR });
  const sol = solveEyes(new EyeObserver().observe(f.landmarks, 1280, 720), INTR, headAxesFromMatrix(f.matrix), 0.063);
  assert.deepEqual(eyePoint(sol, 'left', null), sol.left);
  assert.deepEqual(eyePoint(sol, 'right', null), sol.right);
  assert.deepEqual(eyePoint(sol, 'both', null), sol.centre);
  const cam = { x: 0, y: 0, z: 0 };
  const phone = eyePoint(sol, 'phone', { eye: 'right', rightMm: 40, upMm: 10, forwardMm: 20 });
  const d = cameraToDisplay(phone, cam);
  const r = cameraToDisplay(sol.right, cam);
  // 40 mm to the viewer's right (display +x), 10 mm up, 20 mm toward the screen (display -z).
  assert.ok(Math.abs(d.x - r.x - 0.04) < 0.002, `${d.x - r.x}`);
  assert.ok(Math.abs(d.y - r.y - 0.01) < 0.002, `${d.y - r.y}`);
  assert.ok(Math.abs(d.z - r.z + 0.02) < 0.002, `${d.z - r.z}`);
});

test('the nearest face wins, with hysteresis for similar faces', () => {
  const near = syntheticFace({ mid: { x: 0.15, y: 0.05, z: 0.5 }, intr: INTR }).landmarks;
  const far = syntheticFace({ mid: { x: -0.2, y: 0.05, z: 1.0 }, intr: INTR }).landmarks;
  const similar = syntheticFace({ mid: { x: -0.2, y: 0.05, z: 0.55 }, intr: INTR }).landmarks;
  assert.equal(pickFace([far, near], 1280, 720).index, 1);
  const first = pickFace([near, similar], 1280, 720);
  assert.equal(first.index, 0);
  // Following the slightly smaller face: stay with it.
  const prev = pickFace([similar], 1280, 720).centre;
  assert.equal(pickFace([near, similar], 1280, 720, prev).index, 1);
  assert.equal(pickFace([], 1280, 720), null);
});

test('pixel rays point through the principal point along +z', () => {
  const r = pixelRay(INTR.cx, INTR.cy, INTR);
  assert.ok(Math.abs(r.z - 1) < 1e-12);
});

test('head angles: turning to the viewer\'s right and tilting up read as +yaw and +pitch, from the matrix or the landmarks', () => {
  // Independent of the axes: in the camera picture the nose tip moves the way
  // the face turns (the picture is not mirrored, so the viewer's right is the
  // picture's left, and up is up).
  const at = { x: 0.04, y: 0.05, z: 0.6 };
  const nose = (f) => {
    const lm = f.landmarks;
    return { x: (lm[4].x - (lm[33].x + lm[263].x) / 2) * INTR.width, y: (lm[4].y - (lm[33].y + lm[263].y) / 2) * INTR.height };
  };
  const still = nose(syntheticFace({ mid: at, intr: INTR }));
  for (const [yaw, pitch] of [[20, 0], [-20, 0], [0, 15], [0, -15], [12, -8], [-25, 10]]) {
    const f = syntheticFace({ mid: at, yaw, pitch, intr: INTR });
    const a = headAngles(headAxesFromMatrix(f.matrix));
    const b = headAngles(headAxesFromLandmarks(f.landmarks, INTR.width, INTR.height, INTR));
    const n = nose(f);
    const turnedRight = n.x < still.x - 1; // picture left
    const tiltedUp = n.y < still.y - 1; // picture up
    for (const h of [a, b]) {
      if (yaw !== 0) assert.equal(h.yaw > 0, turnedRight, `yaw ${yaw}: ${h.yaw.toFixed(1)}`);
      if (pitch !== 0) assert.equal(h.pitch > 0, tiltedUp, `pitch ${pitch}: ${h.pitch.toFixed(1)}`);
    }
    // The matrix is exact here; the landmark fallback is close.
    assert.ok(Math.abs(Math.abs(a.yaw) - Math.abs(yaw)) < 1.5 && Math.abs(Math.abs(a.pitch) - Math.abs(pitch)) < 1.5, JSON.stringify(a));
    assert.ok(Math.abs(b.yaw - a.yaw) < 2 && Math.abs(b.pitch - a.pitch) < 2, `landmarks ${JSON.stringify(b)} vs matrix ${JSON.stringify(a)}`);
  }
  const ahead = headAngles(headAxesFromMatrix(syntheticFace({ mid: at, intr: INTR }).matrix));
  assert.ok(Math.abs(ahead.yaw) < 1e-9 && Math.abs(ahead.pitch) < 1e-9, JSON.stringify(ahead));
  assert.equal(headAngles(null), null);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syntheticFace } from './helpers/synthetic-face.js';
import { EyeObserver, solveEyes, headAxesFromMatrix, GazeCompensator, EyeChooser } from '../src/tracking/eye-solve.js';
import { intrinsicsFor } from '../src/tracking/camera-presets.js';

const intr = intrinsicsFor(1280, 720, 68);
const mj = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : 10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5);

/** Head turns 0 -> yawEnd at 3 s while the eyes stay on the screen centre. */
function headTurn(yawEnd, compensate) {
  const gaze = { x: 0, y: 0.103, z: 0 }; // screen centre, camera coords (camera 103 mm above it)
  const obs = new EyeObserver({ source: 'stable' });
  const comp = new GazeCompensator();
  const rows = [];
  for (let k = 0; k < 30 * 8; k++) {
    const t = k / 30;
    const f = syntheticFace({ mid: { x: 0, y: 0.1, z: 0.6 }, yaw: yawEnd * mj((t - 3) / 0.5), pitch: -6, roll: 0, intr, gaze });
    const o = obs.observe(f.landmarks, intr.width, intr.height, t);
    const sol = solveEyes(o, intr, headAxesFromMatrix(f.matrix), 0.063);
    const eye = compensate ? comp.apply(sol, gaze, { left: true, right: true }, t).right : sol.right;
    rows.push({ t, ex: (eye.x - f.truth.right.x) * 1000, x: eye.x * 1000 });
  }
  const at = (t) => rows.reduce((b, r) => (Math.abs(r.t - t) < Math.abs(b.t - t) ? r : b));
  const after = rows.filter((r) => r.t >= 3.6).map((r) => r.x);
  return { jump: Math.abs(at(3.6).ex), creep: Math.max(...after) - Math.min(...after) };
}

test('head turn with the eyes on the screen: the eye point stays on the pupil, no creep', () => {
  const before = headTurn(20, false);
  const after = headTurn(20, true);
  // Review: 2.7 mm off right after the turn, then 2.4 mm of creep over 4 s.
  assert.ok(before.jump > 2 && before.creep > 2, JSON.stringify(before));
  assert.ok(after.jump < 0.6 && after.creep < 0.6, JSON.stringify(after));
});

test('eye choice: blinks never flip the view to the other eye', () => {
  const run = (seq, cfg = { eyeMode: 'one', eye: 'right', autoEye: true }) => {
    const c = new EyeChooser();
    const out = [];
    for (let t = 0; t < seq.length * 33; t += 33) {
      const [l, r] = seq[Math.floor(t / 33)];
      out.push(c.choose(cfg, { left: { open: l }, right: { open: r } }, t));
    }
    return out;
  };
  const frames = (n, l, r) => Array.from({ length: n }, () => [l, r]);
  // Both open, a 450 ms blink with the left lid opening 70 ms early.
  const blink = [...frames(30, true, true), ...frames(12, false, false), ...frames(2, true, false), ...frames(30, true, true)];
  assert.ok(run(blink).every((m) => m === 'right'), 'long blink');
  // Left eye shut on purpose, right blinks for 400 ms.
  const rightBlinks = [...frames(30, false, true), ...frames(12, false, false), ...frames(30, false, true)];
  assert.ok(run(rightBlinks).every((m) => m === 'right'), 'blink of the open eye');
  // Setting says right, but the viewer keeps the LEFT eye open: follow it.
  const keepsLeft = frames(60, true, false);
  const m = run(keepsLeft);
  const switchedAt = m.indexOf('left') * 33;
  assert.ok(switchedAt > 450 && switchedAt < 700, `switched after ${switchedAt} ms`);
  assert.equal(m.at(-1), 'left');
});

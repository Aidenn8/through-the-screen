import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { applyWindowCamera, windowFrustum, glassPoint } from '../src/core/projection.js';

const W = 0.3266; // 15" MacBook Air active area, metres
const H = 0.2114;
const EYES = [
  [0, 0, 0.6],
  [0.25, 0.1, 0.45],
  [-0.4, -0.15, 0.9],
  [0.05, 0.3, 0.3],
  [-0.12, 0.02, 1.4],
];

function ndc(cam, p) {
  return new Vector3(p.x, p.y, p.z).project(cam);
}

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('window corners land on the canvas corners from any eye', () => {
  const cam = new PerspectiveCamera();
  for (const [x, y, z] of EYES) {
    applyWindowCamera(cam, { x, y, z }, W, H);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const v = ndc(cam, { x: (sx * W) / 2, y: (sy * H) / 2, z: 0 });
      close(v.x, sx, 1e-6);
      close(v.y, sy, 1e-6);
    }
  }
});

test('anything on the glass stays put when the eye moves', () => {
  const cam = new PerspectiveCamera();
  const pts = [{ x: 0.1, y: -0.05, z: 0 }, { x: -0.13, y: 0.09, z: 0 }];
  for (const p of pts) {
    const seen = EYES.map(([x, y, z]) => (applyWindowCamera(cam, { x, y, z }, W, H), ndc(cam, p)));
    for (const v of seen) {
      close(v.x, (2 * p.x) / W, 1e-6);
      close(v.y, (2 * p.y) / H, 1e-6);
    }
  }
});

test('points behind and in front of the glass appear where the eye ray crosses it', () => {
  const cam = new PerspectiveCamera();
  const pts = [
    { x: 0.05, y: 0.02, z: -0.4 },
    { x: -0.3, y: 0.2, z: -3 },
    { x: 0.02, y: -0.03, z: 0.12 }, // pops out toward the viewer
  ];
  for (const [x, y, z] of EYES) {
    const eye = { x, y, z };
    applyWindowCamera(cam, eye, W, H);
    for (const p of pts) {
      if (p.z >= eye.z - 0.02) continue;
      const g = glassPoint(eye, p);
      const v = ndc(cam, p);
      close(v.x, (2 * g.x) / W, 1e-6);
      close(v.y, (2 * g.y) / H, 1e-6);
    }
  }
});

test('centred eye gives a symmetric frustum', () => {
  const f = windowFrustum({ x: 0, y: 0, z: 0.6 }, W, H, 0.01);
  close(f.left, -f.right);
  close(f.bottom, -f.top);
});

test('eye behind or on the glass is rejected', () => {
  assert.throws(() => windowFrustum({ x: 0, y: 0, z: 0 }, W, H, 0.01), RangeError);
  assert.throws(() => windowFrustum({ x: 0, y: 0, z: -0.2 }, W, H, 0.01), RangeError);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RecentSamples, fovFromDistance, STEADY_STEPS } from '../src/app/calibration.js';
import { IpdEstimator } from '../src/tracking/ipd.js';

function rng(seed = 7) {
  let s = seed;
  const u = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return () => Math.sqrt(-2 * Math.log(Math.max(u(), 1e-12))) * Math.cos(2 * Math.PI * u());
}

test('distance readout and calibration: the same quantity, averaged over one second', () => {
  // Eye depth at 95 cm in dim light: 8 mm noise per frame (review). One frame
  // can be 2 cm off; the 1 s mean of 30 frames is within a few mm.
  const g = rng(3);
  const r = new RecentSamples(1000);
  for (let t = 0; t < 3000; t += 33) r.add(t, 0.95 + 0.008 * g());
  const m = r.mean(3000);
  assert.ok(m.n >= 29 && m.n <= 31, `n ${m.n}`);
  assert.ok(Math.abs(m.mean - 0.95) < 0.004, `${m.mean}`);
  assert.equal(new RecentSamples(1000).mean(0).n, 0);
  assert.ok(m.std > 0.006 && m.std < 0.01, `std ${m.std}`);
  // Leaning in during the second: the spread gives it away.
  const lean = new RecentSamples(1000);
  for (let t = 0; t < 1000; t += 33) lean.add(t, 0.5 + 0.2 * (t / 1000));
  assert.ok(lean.mean(1000).std > 0.05);
});

test('field of view from a measured distance', () => {
  // Depth scales with the focal length: reading 10 % far means the true
  // field of view is wider.
  const h = fovFromDistance(68, 0.6, 0.66);
  const f = (deg) => 0.5 / Math.tan((deg * Math.PI) / 360);
  assert.ok(Math.abs(f(h) / f(68) - 0.6 / 0.66) < 1e-9);
  assert.ok(h > 68);
});

test('steady check: one plain instruction per step', () => {
  assert.ok(STEADY_STEPS.length >= 5);
  for (const s of STEADY_STEPS) {
    const sentences = s.text.split(/(?<=[.!?])\s+/).filter(Boolean);
    assert.equal(sentences.length, 1, `"${s.text}"`);
    assert.ok(s.text.split(/\s+/).length <= 26, `too long: "${s.text}"`);
    assert.ok(!/field of view|IPD|calibrat/i.test(s.text + s.title), `jargon: "${s.title}: ${s.text}"`);
  }
  // The reflection steps black out everything but the cross.
  assert.ok(STEADY_STEPS.filter((s) => s.view === 'cross').length >= 3);
});

test('eye spacing from the intro carries to the next visit', () => {
  const a = new IpdEstimator();
  for (let i = 0; i < 90; i++) a.add({ irisDistance: 0.6 * (66 / 63), distance: 0.6, sinYaw: 0 }, 0.063);
  const measured = a.measured;
  assert.ok(Math.abs(measured - 0.066) < 1e-9);
  const b = new IpdEstimator();
  b.seed(measured);
  assert.equal(b.measured, measured);
  assert.ok(Math.abs(b.fused(0.063, false) - a.fused(0.063, false)) < 1e-12);
});

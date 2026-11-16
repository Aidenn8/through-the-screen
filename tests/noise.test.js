import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NoiseMeter } from '../src/tracking/noise.js';

function rng(seed = 9) {
  let s = seed;
  const u = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return () => Math.sqrt(-2 * Math.log(Math.max(u(), 1e-12))) * Math.cos(2 * Math.PI * u());
}
const START = { x: 0.0005, y: 0.0006, z: 0.006 };

function feed(m, secs, path, noise, g, t0 = 0) {
  let t = t0;
  for (; t < t0 + secs * 1000; t += 33.3) {
    const p = path(t);
    m.add(t, { x: p.x + g() * noise.x, y: p.y + g() * noise.y, z: p.z + g() * noise.z });
  }
  return t;
}

test('noise meter: finds the per-frame noise of a still head', () => {
  const g = rng();
  const m = new NoiseMeter({ initial: START });
  // 95 cm in the review's degraded clip.
  feed(m, 20, () => ({ x: 0, y: 0, z: 0.95 }), { x: 0.001, y: 0.0027, z: 0.008 }, g);
  assert.ok(Math.abs(m.level.x / 0.001 - 1) < 0.25, `x ${m.level.x}`);
  assert.ok(Math.abs(m.level.y / 0.0027 - 1) < 0.25, `y ${m.level.y}`);
  assert.ok(Math.abs(m.level.z / 0.008 - 1) < 0.25, `z ${m.level.z}`);
});

test('noise meter: head motion barely moves it', () => {
  const g = rng(4);
  const m = new NoiseMeter({ initial: START });
  const noise = { x: 0.0005, y: 0.0006, z: 0.006 };
  let t = feed(m, 6, () => ({ x: 0, y: 0, z: 0.6 }), noise, g);
  const still = m.xy;
  // Sway +-13 cm at 0.4 Hz for 5 s, then 5 s of quick 15 cm leans (0.4 s
  // each, minimum jerk) with 0.6 s holds.
  t = feed(m, 5, (tt) => ({ x: 0.13 * Math.sin(2 * Math.PI * 0.4 * tt / 1000), y: 0, z: 0.6 }), noise, g, t);
  const mj = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : 10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5);
  const t1 = t;
  let worst = 0;
  for (let k = 0; k < 150; k++, t += 33.3) {
    const s = (t - t1) / 1000;
    const n = Math.floor(s);
    const x = 0.15 * ((n % 2 ? 1 - mj((s - n) / 0.4) : mj((s - n) / 0.4)));
    m.add(t, { x: x + g() * noise.x, y: g() * noise.y, z: 0.6 + g() * noise.z });
    worst = Math.max(worst, m.xy);
  }
  assert.ok(worst < 1.5 * still, `still ${(still * 1000).toFixed(2)} mm, worst during motion ${(worst * 1000).toFixed(2)} mm`);
});

test('noise meter: falls at once when it gets quieter, rises over seconds', () => {
  const g = rng(5);
  const m = new NoiseMeter({ initial: { x: 0.003, y: 0.003, z: 0.02 } });
  let t = feed(m, 3, () => ({ x: 0, y: 0, z: 0.6 }), START, g);
  assert.ok(m.xy < 0.0008, `${m.xy}`);
  t = feed(m, 1.5, () => ({ x: 0, y: 0, z: 0.9 }), { x: 0.002, y: 0.002, z: 0.01 }, g, t);
  const soon = m.xy;
  feed(m, 10, () => ({ x: 0, y: 0, z: 0.9 }), { x: 0.002, y: 0.002, z: 0.01 }, g, t);
  assert.ok(soon < m.xy && m.xy > 0.0016, `after 1.5 s ${soon}, after 11.5 s ${m.xy}`);
});

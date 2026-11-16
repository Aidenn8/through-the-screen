import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ResolutionGovernor } from '../src/app/resolution.js';

/**
 * Drive the governor at 60 fps for `secs`. machine(ratio) says what happens
 * at a pixel ratio: { slow (share of late frames), hz (tracking results/s),
 * latencyMs }. Returns the ratio over time.
 */
function run(machine, { secs = 60, cap = 1.684, start = cap, g = new ResolutionGovernor() } = {}) {
  let ratio = start;
  let results = 0;
  let frames = 0;
  let k = 0;
  const trace = [];
  g.reset(0, { results, frames });
  for (let t = 0; t < secs * 1000; t += 1000 / 60) {
    const m = machine(ratio);
    frames += 30 / 60;
    results += m.hz / 60;
    const late = (k++ % 100) < m.slow * 100;
    g.frame(late ? 40 : 16.7, 16.7);
    const r = g.update(t, { cur: ratio, cap, tracking: { results, frames, latencyMs: m.latencyMs } });
    if (r) { ratio = r.ratio; trace.push([Math.round(t / 1000), r.ratio, r.why]); }
  }
  return { ratio, trace };
}

test('resolution: a scene that starves tracking at high resolution steps down until tracking is back', () => {
  // Like Box in the review: 60 fps at every level, but tracking 16 Hz / 60 ms
  // at 2x, 19 Hz at 1.5x, 27.6 Hz at 1x.
  const box = (r) => (r > 1.6 ? { slow: 0, hz: 16, latencyMs: 60 } : r > 1.3 ? { slow: 0, hz: 19, latencyMs: 39 } : r > 1.1 ? { slow: 0, hz: 25, latencyMs: 40 } : { slow: 0, hz: 28.5, latencyMs: 34 });
  const { ratio, trace } = run(box);
  assert.equal(ratio, 1, JSON.stringify(trace));
  assert.ok(trace[0][0] <= 2 && /tracking/.test(trace[0][2]), JSON.stringify(trace));
});

test('resolution: tracking held back by other programs is not chased with lower resolution', () => {
  // Review of the fix round: under outside CPU load tracking ran at ~23 Hz at
  // every resolution; the governor went to 1.0x within 12 s and never came
  // back. Lowering resolution must be tried, found useless, and undone.
  const load = () => ({ slow: 0, hz: 23, latencyMs: 50 });
  const trace = [];
  let ratio = 1.684;
  let low = 0;
  const g = new ResolutionGovernor();
  let results = 0; let frames = 0;
  g.reset(0, { results, frames });
  for (let t = 0; t < 120000; t += 1000 / 60) {
    const m = load(ratio);
    frames += 0.5; results += m.hz / 60;
    g.frame(16.7, 16.7);
    const r = g.update(t, { cur: ratio, cap: 1.684, tracking: { results, frames, latencyMs: m.latencyMs } });
    if (r) { ratio = r.ratio; trace.push([Math.round(t / 1000), r.ratio, r.why]); }
    if (ratio < 1.6) low += 1000 / 60;
  }
  assert.equal(ratio, 1.684, JSON.stringify(trace));
  assert.ok(low < 0.15 * 120000, `below full resolution for ${(low / 1000).toFixed(0)} of 120 s: ${JSON.stringify(trace)}`);
});

test('resolution: slow tracking delay alone also steps down', () => {
  const m = (r) => (r > 1.4 ? { slow: 0, hz: 29.5, latencyMs: 55 } : { slow: 0, hz: 29.5, latencyMs: 30 });
  assert.equal(run(m).ratio, 1.25);
});

test('resolution: a healthy scene keeps full panel resolution', () => {
  const { ratio, trace } = run(() => ({ slow: 0, hz: 29.8, latencyMs: 30 }));
  assert.equal(ratio, 1.684);
  assert.deepEqual(trace, []);
});

test('resolution: dropped render frames step down (as before)', () => {
  const m = (r) => (r > 1.3 ? { slow: 0.2, hz: 29.8, latencyMs: 30 } : { slow: 0, hz: 29.8, latencyMs: 30 });
  assert.equal(run(m).ratio, 1.25);
});

test('resolution: after a passing slowdown it climbs back, but not to a level that failed', () => {
  // Starved for the first 10 s (e.g. something else busy), fine after that,
  // except that 1.684 genuinely starves tracking.
  let t = 0;
  const g = new ResolutionGovernor();
  const m = (r) => {
    t += 1000 / 60;
    if (t < 10000) return { slow: 0, hz: 15, latencyMs: 70 };
    return r > 1.6 ? { slow: 0, hz: 22, latencyMs: 50 } : { slow: 0, hz: 29.8, latencyMs: 30 };
  };
  const { ratio, trace } = run(m, { secs: 200, g });
  assert.equal(ratio, 1.5, JSON.stringify(trace));
  // It probed full resolution at most once more (returns from a useless
  // trial are not probes).
  assert.ok(trace.filter(([, r, why]) => r > 1.6 && why === 'headroom').length <= 1, JSON.stringify(trace));
});

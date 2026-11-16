// View direction and strength (src/tracking/view-map.js): Look around
// mirrors head motion about where the viewer sits, True window is exact,
// Strength scales the offset; switches glide; the rest point stays put
// during a lean.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ViewMapper, viewGain, VIEW_DEFAULTS } from '../src/tracking/view-map.js';
import { EyeTrack } from '../src/tracking/predictor.js';
import { appTrack, leanLag, realLike } from '../tools/core-motion.mjs';

const close = (a, b, eps = 1e-12) => Math.abs(a - b) <= eps;
const rest = { x: 0.01, y: 0.05, z: 0.6 };
// Wide limits so the mapping itself is tested, not the clamps.
const wide = () => new ViewMapper({ limits: { x: 9, yMin: -9, yMax: 9, zMin: -9, zMax: 9, xPerZ: Infinity, yPerZ: Infinity } });

test('view: Look around at 1x mirrors the head about the rest point: sideways and depth exactly, up and down 1.5x', () => {
  const vm = wide();
  const p = { x: 0.13, y: 0.02, z: 0.7 };
  const q = vm.map(p, { direction: 'look', strength: 1 }, rest);
  const share = { x: 1, y: VIEW_DEFAULTS.yGainLook, z: 1 };
  assert.equal(share.y, 1.5);
  for (const k of ['x', 'y', 'z']) assert.ok(close(q[k] - rest[k], -share[k] * (p[k] - rest[k])), `${k}: ${q[k]}`);
  // Leaning right moves the viewpoint left, in moves it back, up moves it down.
  const r = vm.map({ x: rest.x + 0.1, y: rest.y + 0.05, z: rest.z - 0.1 }, { direction: 'look', strength: 1 }, rest);
  assert.ok(r.x < rest.x && r.y < rest.y && r.z > rest.z);
});

test('view: True window at 1x is the identity (rest point irrelevant)', () => {
  const vm = wide();
  const p = { x: -0.2, y: 0.1, z: 0.45 };
  assert.deepEqual(vm.map(p, { direction: 'window', strength: 1 }, rest), p);
  assert.deepEqual(vm.map(p, { direction: 'window', strength: 1 }, null), p);
});

test('view: Strength scales the offset linearly, depth with half the extra gain, up and down 1.5x more in Look around', () => {
  const vm = wide();
  for (const direction of ['look', 'window']) {
    const s = direction === 'look' ? -1 : 1;
    const gyShare = direction === 'look' ? 1.5 : 1;
    for (const g of [1, 1.5, 2, 3, 5]) {
      for (const d of [0.01, 0.05, 0.12]) {
        const q = vm.map({ x: rest.x + d, y: rest.y - d, z: rest.z + d }, { direction, strength: g }, rest);
        const gz = 1 + (g - 1) * VIEW_DEFAULTS.zGainShare;
        assert.ok(close(q.x - rest.x, s * g * d, 1e-12) && close(q.y - rest.y, -s * gyShare * g * d, 1e-12), `${direction} ${g}x x/y`);
        assert.ok(close(q.z - rest.z, s * gz * d, 1e-12), `${direction} ${g}x z`);
      }
    }
  }
  assert.deepEqual(viewGain({ direction: 'look', strength: 2 }), { x: -2, y: -3, z: -1.5 });
  assert.deepEqual(viewGain({ direction: 'look', strength: 3 }), { x: -3, y: -4.5, z: -2 });
  assert.deepEqual(viewGain({ direction: 'look', strength: 9 }), { x: -5, y: -7.5, z: -3 }, 'Strength stops at 5x');
  assert.deepEqual(viewGain({ direction: 'window', strength: 3 }), { x: 3, y: 3, z: 2 }, 'True window: no extra up and down');
});

test('view: at the 3x default the view reaches the range the scenes are built for, and no further than the cone', () => {
  // A viewer seated at 60 cm, centred: a 15 cm lean is a 45 cm swing, a
  // 5.6 cm rise or duck 25 cm (up and down at 4.5x), 12.5 cm in or out
  // 25 cm (depth at 2x).
  const vm = new ViewMapper();
  const seat = { x: 0, y: 0, z: 0.6 };
  const look3 = { direction: 'look', strength: 3 };
  const cases = [
    [{ x: 0.15, y: 0, z: 0.6 }, { x: -0.45, y: 0, z: 0.6 }],
    [{ x: -0.15, y: 0, z: 0.6 }, { x: 0.45, y: 0, z: 0.6 }],
    [{ x: 0, y: 0.25 / 4.5, z: 0.6 }, { x: 0, y: -0.25, z: 0.6 }],
    [{ x: 0, y: -0.25 / 4.5, z: 0.6 }, { x: 0, y: 0.25, z: 0.6 }],
    [{ x: 0, y: 0, z: 0.6 - 0.125 }, { x: 0, y: 0, z: 0.85 }],
    [{ x: 0, y: 0, z: 0.6 + 0.125 }, { x: 0, y: 0, z: 0.35 }],
    [{ x: 0.15, y: 0.25 / 4.5, z: 0.6 }, { x: -0.45, y: -0.25, z: 0.6 }],
    [{ x: -0.15, y: -0.25 / 4.5, z: 0.6 }, { x: 0.45, y: 0.25, z: 0.6 }],
  ];
  for (const [head, want] of cases) {
    const q = vm.map(head, look3, seat);
    for (const k of ['x', 'y', 'z']) assert.ok(Math.abs(q[k] - want[k]) < 1e-9, `${JSON.stringify(head)} -> ${JSON.stringify(q)}, want ${JSON.stringify(want)}`);
  }
  // Up and down reach farther now (4.5x, and head turn on top): an 8 cm rise
  // or duck is 36 cm, inside the limits (it was clipped at 30-36 cm before).
  for (const dy of [0.08, -0.08]) {
    const q = vm.map({ x: 0, y: dy, z: 0.6 }, look3, seat);
    assert.ok(Math.abs(q.y + 4.5 * dy) < 1e-9, `${dy * 100} cm: ${(q.y * 100).toFixed(1)} cm`);
  }
  // Past the range, the cone holds: 45 degrees sideways, about 39 up or down.
  const L = VIEW_DEFAULTS.limits;
  const far = vm.map({ x: -0.4, y: -0.3, z: 0.9 }, { direction: 'look', strength: 5 }, seat);
  assert.ok(far.x <= Math.min(L.x, L.xPerZ * far.z) + 1e-12 && far.y <= Math.min(L.yMax, L.yPerZ * far.z) + 1e-12, JSON.stringify(far));
  assert.ok(L.xPerZ <= 1.0 && L.yPerZ <= 0.8 && L.zMin >= 0.2 && L.yMax <= 0.48 && L.yMin >= -0.4);
});

test('view: the clamps hold (in front of the glass, where the scenes hold up)', () => {
  const vm = new ViewMapper();
  const L = VIEW_DEFAULTS.limits;
  for (const p of [{ x: 0.3, y: 0.2, z: 0.2 }, { x: -0.3, y: -0.2, z: 1.2 }, { x: 0.05, y: 0.02, z: 0.25 }, { x: 0.4, y: -0.3, z: 0.4 }]) {
    for (const g of [1, 2, 3, 5]) {
      for (const direction of ['look', 'window']) {
        const q = vm.map(p, { direction, strength: g }, { x: 0, y: 0.03, z: 0.6 });
        assert.ok(Math.abs(q.x) <= L.x && q.y >= L.yMin && q.y <= L.yMax && q.z >= L.zMin && q.z <= L.zMax, JSON.stringify(q));
        // The cone: no steeper than the contact sheets showed to hold up.
        assert.ok(Math.abs(q.x) <= L.xPerZ * q.z + 1e-12 && Math.abs(q.y) <= L.yPerZ * q.z + 1e-12, JSON.stringify(q));
      }
    }
  }
  assert.ok(L.zMin >= 0.2);
});

/** Seat a viewer at `at` and let the mapper seed (1.5 s of steady samples at 30 Hz). */
function seated(vm, at, t0 = 0) {
  let t = t0;
  for (; t < t0 + 1500; t += 33.3) vm.observe(t, { x: at.x + 0.0003 * Math.sin(t), y: at.y, z: at.z });
  return t;
}

test('view: the rest point seeds from the first steady second and does not drift during a lean', () => {
  const vm = new ViewMapper();
  const at = { x: 0.02, y: 0.04, z: 0.62 };
  let t = seated(vm, at);
  assert.ok(vm.seeded && Math.hypot(vm.rest.x - at.x, vm.rest.y - at.y, vm.rest.z - at.z) < 0.001, JSON.stringify(vm.rest));
  const before = { ...vm.rest };
  // 15 cm lean in 0.6 s, then hold for 0.3 s.
  const mj = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : 10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5);
  const t0 = t;
  let worst = 0;
  for (; t < t0 + 900; t += 33.3) {
    vm.observe(t, { x: at.x + 0.15 * mj((t - t0) / 600), y: at.y, z: at.z });
    worst = Math.max(worst, Math.hypot(vm.rest.x - before.x, vm.rest.y - before.y, vm.rest.z - before.z));
  }
  assert.ok(worst < 0.002, `rest moved ${(worst * 1000).toFixed(2)} mm during the lean`);
  // Holding the lean, it stays put (a lean holds; see the posture test).
  for (const end = t + 6000; t < end; t += 33.3) vm.observe(t, { x: at.x + 0.15, y: at.y, z: at.z });
  assert.ok(Math.abs(vm.rest.x - before.x) < 0.002, `after 6 s held: ${((vm.rest.x - before.x) * 1000).toFixed(1)} mm`);
});

const mj = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : 10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5);
const wiggle = (t) => 0.0003 * Math.sin(t / 700); // a still head is never quite still

test('view: a held 5 cm lean at 2x stays put for 20 s (the rest point does not follow it)', () => {
  // The mapped point is (1 + g) rest - g p: any creep of the rest point
  // while the lean is held slides the view by three times as much at 2x.
  const head = (t) => ({ x: 0.05 * mj((t - 3000) / 600) + wiggle(t), y: 0.03, z: 0.6 });
  const fr = run(head, { direction: 'look', strength: 2 }, () => null, 25000);
  const hold = fr.filter((f) => f.t >= 5100 && f.t <= 25100).map((f) => f.p.x);
  const range = Math.max(...hold) - Math.min(...hold);
  console.log(`  held 5 cm lean at 2x, 20 s: view moved ${(range * 1000).toFixed(2)} mm; rest moved ${(Math.abs(fr.vm.rest.x) * 1000).toFixed(2)} mm`);
  assert.ok(range <= 0.001, `view moved ${(range * 1000).toFixed(2)} mm over 20 s`);
  assert.ok(Math.abs(fr.vm.rest.x) < 0.001);
});

test('view: a slow lean (3 or 2 cm/s, under the freeze speed or at it) does not drag the rest point', () => {
  for (const v of [0.03, 0.02]) {
    const vm = new ViewMapper();
    let t = seated(vm, { x: 0, y: 0.03, z: 0.6 });
    const r0 = vm.rest.x;
    const t0 = t;
    const T = (0.12 / v) * 1000; // 12 cm
    for (const end = t + T + 5000; t < end; t += 66.7) vm.observe(t, { x: 0.12 * Math.min(1, (t - t0) / T) + wiggle(t), y: 0.03, z: 0.6 });
    const moved = vm.rest.x - r0;
    console.log(`  slow ${v * 100} cm/s lean of 12 cm, then 5 s held: rest moved ${(moved * 1000).toFixed(2)} mm`);
    assert.ok(Math.abs(moved) < 0.001, `${v * 100} cm/s: rest moved ${(moved * 1000).toFixed(2)} mm`);
  }
});

test('view: a change of posture is taken up slowly, and Re-centre takes it at once', () => {
  // Sitting 4 cm further left from 1.5 s on, for 60 s.
  const vm = new ViewMapper();
  let t = seated(vm, { x: 0, y: 0.03, z: 0.6 });
  const t0 = t;
  const at = {};
  for (const end = t + 61000; t < end; t += 33.3) {
    vm.observe(t, { x: -0.04 * mj((t - t0) / 800) + wiggle(t), y: 0.03, z: 0.6 });
    for (const s of [10, 25, 40, 60]) if (at[s] === undefined && t - t0 >= s * 1000) at[s] = -vm.rest.x;
  }
  console.log(`  posture 4 cm left: rest taken up ${[10, 25, 40, 60].map((s) => `${(at[s] * 1000).toFixed(1)} mm at ${s} s`).join(', ')}`);
  assert.ok(at[10] < 0.0005 && at[25] < 0.001, 'nothing for the first 25 s (a held lean holds)');
  assert.ok(at[60] > 0.01 && at[60] < 0.035, `slowly after that: ${(at[60] * 1000).toFixed(1)} mm of 40 by 60 s`);
  vm.recentre();
  assert.ok(Math.abs(vm.rest.x + 0.04) < 0.001, `Re-centre: ${(vm.rest.x * 1000).toFixed(1)} mm`);
});

test('view: seeding the rest point does not make it jump', () => {
  let s = 9;
  const g = () => { s = (s * 16807) % 2147483647; return (s / 2147483647 - 0.5) * 2 * 0.0008; };
  const vm = new ViewMapper();
  let prev = null;
  let worst = 0;
  let seededAt = null;
  for (let t = 0; t < 4000; t += 33.3) {
    vm.observe(t, { x: 0.004 * Math.sin(t / 500) + g(), y: 0.03 + g(), z: 0.6 + 4 * g() });
    if (vm.seeded && seededAt === null) seededAt = t;
    if (prev && vm.rest) worst = Math.max(worst, Math.hypot(vm.rest.x - prev.x, vm.rest.y - prev.y));
    prev = vm.rest && { ...vm.rest };
  }
  assert.ok(seededAt !== null, 'seeded');
  // Each sample moves it a fraction of a millimetre, the seed included
  // (it used to jump to the steady second's mean: up to 6 mm, 18 mm of view at 2x).
  assert.ok(worst < 0.0006, `largest step of the rest point ${(worst * 1000).toFixed(2)} mm`);
});

test('view: a strength that is not a number maps as 1x, and bad samples are ignored', () => {
  assert.deepEqual(viewGain({ direction: 'look', strength: NaN }), { x: -1, y: -1.5, z: -1 });
  assert.deepEqual(viewGain({ direction: 'look', strength: null }), { x: -1, y: -1.5, z: -1 });
  const vm = new ViewMapper();
  seated(vm, { x: 0, y: 0.03, z: 0.6 });
  vm.observe(2000, { x: NaN, y: 0.03, z: 0.6 });
  const q = vm.map({ x: 0.05, y: 0.03, z: 0.6 }, { direction: 'look', strength: NaN });
  assert.ok(Number.isFinite(vm.rest.x) && Number.isFinite(q.x) && Math.abs(q.x + 0.05) < 0.001, JSON.stringify(q));
});

test('view: Re-centre puts the rest point where the eye is now', () => {
  const vm = new ViewMapper();
  let t = seated(vm, { x: 0, y: 0.03, z: 0.6 });
  for (const end = t + 600; t < end; t += 33.3) vm.observe(t, { x: 0.08, y: 0.03, z: 0.55 });
  vm.recentre();
  assert.ok(Math.hypot(vm.rest.x - 0.08, vm.rest.z - 0.55) < 0.001, JSON.stringify(vm.rest));
});

/**
 * The tracker's path: raw eye -> ViewMapper.step -> EyeTrack (Smooth
 * follow), at 30 Hz with 80 ms delay, rendered at 60 Hz. `events(t, vm)`
 * may change the view or ask for a re-centre. Returns rendered frames.
 */
function run(head, view, events, ms = 6000, opts = {}) {
  const vm = new ViewMapper(opts);
  const tr = new EyeTrack(appTrack());
  const out = [];
  let k = 0;
  let v = view;
  for (let t = 0; t < ms; t += 1000 / 60) {
    v = events(t, vm) ?? v;
    while (k * 33.3 + 80 <= t) {
      const tc = k * 33.3;
      const m = vm.step(tc, head(tc), v);
      if (m.shift) tr.shift(m.shift, 600);
      tr.setGain(m.gain);
      tr.push(tc, m.p);
      k++;
    }
    out.push({ t, p: vm.clamp(tr.sample(t + 30)) });
  }
  out.vm = vm;
  return out;
}

test('view: switching direction or strength, or re-centring, glides instead of jumping', () => {
  // The viewer sits 10 cm right of where they were seated: a switch moves the
  // mapped point by 30 cm (True window 1x -> Look around 2x).
  const head = (t) => ({ x: t < 2000 ? 0 : 0.1 * Math.min(1, (t - 2000) / 800), y: 0.03, z: 0.6 });
  const cases = [
    ['window -> look', { direction: 'window', strength: 1 }, (t) => (Math.abs(t - 4000) < 9 ? { direction: 'look', strength: 2 } : null)],
    ['look -> window', { direction: 'look', strength: 2 }, (t) => (Math.abs(t - 4000) < 9 ? { direction: 'window', strength: 1 } : null)],
    ['strength 2 -> 3', { direction: 'look', strength: 2 }, (t) => (Math.abs(t - 4000) < 9 ? { direction: 'look', strength: 3 } : null)],
    ['strength 3 -> 5', { direction: 'look', strength: 3 }, (t) => (Math.abs(t - 4000) < 9 ? { direction: 'look', strength: 5 } : null)],
    ['re-centre', { direction: 'look', strength: 2 }, (t, vm) => { if (Math.abs(t - 4000) < 9) vm.requestRecentre(); return null; }],
  ];
  for (const [name, view, events] of cases) {
    // The rest point held still, so only the glide moves the view.
    const fr = run(head, view, events, 6000, { restMs: Infinity }).filter((f) => f.t > 3900);
    let maxStep = 0;
    for (let i = 1; i < fr.length; i++) maxStep = Math.max(maxStep, Math.abs(fr[i].p.x - fr[i - 1].p.x));
    // A 30 cm glide over 600 ms peaks near 0.75 m/s: 12.5 mm a frame at 60 Hz. A jump would be 100-300 mm.
    assert.ok(maxStep < 0.016, `${name}: largest frame step ${(maxStep * 1000).toFixed(1)} mm`);
    // Monotone: it never swings past where it is going.
    const xs = fr.map((f) => f.p.x);
    const end = xs.at(-1);
    const start = xs[0];
    const lo = Math.min(start, end) - 0.002;
    const hi = Math.max(start, end) + 0.002;
    assert.ok(xs.every((x) => x >= lo && x <= hi), `${name}: stays between ${(start * 1000).toFixed(0)} and ${(end * 1000).toFixed(0)} mm`);
  }
});

test('view: Look around 2x leaves the motion filter\'s no-overshoot guarantee intact', () => {
  // A 10 cm lean that stops dead (no noise): the view goes 20 cm the other
  // way and never past where the mapped head stopped.
  const mj = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : 10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5);
  const head = (t) => ({ x: 0.1 * mj((t - 2500) / 500), y: 0.03, z: 0.6 });
  // 3x and 5x: 30 and 50 cm the other way, still never past the stop (the
  // 5x stop is past the cone's 0.5 m, so it is clamped there)
  for (const g of [3, 5]) {
    const f3 = run(head, { direction: 'look', strength: g }, () => null, 5000);
    const m3 = Math.min(...f3.map((f) => f.p.x));
    assert.ok(m3 >= -Math.min(0.1 * g, 0.5) - 1e-6, `${g}x: ${(m3 * 1000).toFixed(3)} mm`);
  }
  const fr = run(head, { direction: 'look', strength: 2 }, () => null, 5000);
  const min = Math.min(...fr.map((f) => f.p.x));
  assert.ok(min >= -0.2 - 1e-6, `${(min * 1000).toFixed(3)} mm (the mapped stop is -200 mm)`);
  // Afterwards the rest point creeps toward the held lean (seconds), and the
  // view follows within its dead-band (6 mm of head = 12 mm of view at 2x).
  const now = fr.vm.map(head(5000), { direction: 'look', strength: 2 });
  assert.ok(Math.abs(fr.at(-1).p.x - now.x) < 0.02, `ends at ${(fr.at(-1).p.x * 1000).toFixed(1)} mm, mapped head ${(now.x * 1000).toFixed(1)} mm`);
});

test('view: at 2x, 3x and 5x a quick lean is followed as fast as at 1x (not mistaken for a new face)', () => {
  // At 15 fps a 0.4 s, 15 cm lean moves the eye ~5 cm between samples: 10-15
  // cm of view at 2-3x, past the 8 cm "new track" threshold unless it scales
  // with the gain (it took 642 ms to reach 90 % before it did).
  for (const fps of [30, 15]) {
    const one = leanLag(0.4, realLike(fps, { track: appTrack() }), [1, 2]);
    for (const strength of [2, 3, 5]) {
      const r = leanLag(0.4, realLike(fps, { track: appTrack(), view: { direction: 'look', strength } }), [1, 2]);
      assert.ok(Math.abs(r.lag - one.lag) < 25 && r.pastMax <= 2 * strength, `${fps} fps ${strength}x: ${r.lag.toFixed(0)} ms vs ${one.lag.toFixed(0)} at 1x, past ${r.pastMax.toFixed(1)} mm`);
    }
  }
});

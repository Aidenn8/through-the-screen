import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OneEuro } from '../src/tracking/one-euro.js';
import { EyeTrack, TRACK_DEFAULTS } from '../src/tracking/predictor.js';

function rng(seed = 1) {
  let s = seed;
  const u = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return () => {
    // Box-Muller
    const a = Math.max(u(), 1e-12);
    return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * u());
  };
}
const std = (a) => { const m = a.reduce((s, x) => s + x, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };

test('One Euro: still head, 1 mm noise at 30 Hz -> under a third of it', () => {
  const g = rng(3);
  const f = new OneEuro(TRACK_DEFAULTS.filterXY);
  const out = [];
  for (let i = 0; i < 900; i++) {
    const y = f.filter(0.001 * g(), i / 30);
    if (i > 60) out.push(y);
  }
  assert.ok(std(out) < 0.00033, `std ${std(out)}`);
});

test('One Euro: a 10 cm step is followed fast (beats a plain low-pass of equal stillness)', () => {
  const g = rng(5);
  const euro = new OneEuro(TRACK_DEFAULTS.filterXY);
  const plain = new OneEuro({ minCutoff: TRACK_DEFAULTS.filterXY.minCutoff, beta: 0 });
  let tEuro = null;
  let tPlain = null;
  for (let i = 0; i < 300; i++) {
    const t = i / 30;
    const x = (t >= 2 ? 0.1 : 0) + 0.002 * g();
    const a = euro.filter(x, t);
    const b = plain.filter(x, t);
    if (t >= 2 && tEuro === null && a > 0.09) tEuro = t - 2;
    if (t >= 2 && tPlain === null && b > 0.09) tPlain = t - 2;
  }
  assert.ok(tEuro !== null && tEuro < 0.2, `one euro reached 90% after ${tEuro}s`);
  assert.ok(tPlain > 2 * tEuro, `plain ${tPlain}s vs one euro ${tEuro}s`);
});

// Simulated pipeline: the head moves along truth(t); the camera captures at
// 30 Hz with jitter; results are noisy; the renderer samples at 120 Hz and
// wants the position at the moment its frame is seen.
function run(truth, { seconds = 6, noise = 0.0015, latency = 0.07, rate = 30, render = 120, track, lostBetween } = {}) {
  const g = rng(11);
  const tr = track || new EyeTrack();
  const frames = [];
  let nextCap = 0;
  for (let k = 0; k < seconds * render; k++) {
    const now = k / render;
    // Deliver every capture whose result is ready by now.
    while (nextCap + latency <= now) {
      const tc = nextCap;
      const lost = lostBetween && tc >= lostBetween[0] && tc < lostBetween[1];
      if (lost) tr.miss(tc * 1000);
      else {
        const p = truth(tc);
        tr.push(tc * 1000, { x: p.x + noise * g(), y: p.y + noise * g(), z: p.z + 3 * noise * g() });
      }
      nextCap += 1 / rate + (g() * 0.002);
    }
    const tShow = now + 0.02; // frame is seen ~20 ms after rAF
    const p = tr.sample(tShow * 1000);
    frames.push({ t: tShow, p, truth: truth(tShow) });
  }
  return frames;
}

test('prediction: a steady 20 cm/s sway is rendered where the head is, not where it was', () => {
  // Full look-ahead, webcam-like noise (0.5 mm). The default look-ahead is
  // lower on purpose (stops; tests/motion.test.js covers its steady pan).
  const truth = (t) => ({ x: 0.2 * t - 0.4, y: 0.05, z: 0.6 });
  const withPred = run(truth, { seconds: 4, noise: 0.0005, track: new EyeTrack({ predictGain: 1 }) });
  const noPred = run(truth, { seconds: 4, noise: 0.0005, track: new EyeTrack({ predictGain: 0 }) });
  const err = (fr) => { const e = fr.filter((f) => f.t > 1.5).map((f) => Math.abs(f.p.x - f.truth.x)); return e.reduce((s, x) => s + x, 0) / e.length; };
  assert.ok(err(withPred) < 0.004, `with prediction ${err(withPred)}`);
  assert.ok(err(noPred) > 3 * err(withPred), `without ${err(noPred)} vs with ${err(withPred)}`);
});

test('upsampling: 30 Hz results drawn at 120 Hz move without steps', () => {
  const truth = (t) => ({ x: 0.1 * t, y: 0, z: 0.6 });
  const fr = run(truth, { seconds: 4, noise: 0 }).filter((f) => f.t > 1.5);
  const steps = [];
  for (let i = 1; i < fr.length; i++) steps.push(fr[i].p.x - fr[i - 1].p.x);
  const ideal = 0.1 / 120;
  for (const s of steps) assert.ok(s > 0.5 * ideal && s < 1.5 * ideal, `step ${s} vs ${ideal}`);
});

test('face lost: hold, then ease to rest; face found: glide back; never a jump', () => {
  const truth = (t) => ({ x: 0.12 + 0.03 * Math.sin(t), y: 0.08, z: 0.5 });
  const fr = run(truth, { seconds: 7, lostBetween: [2, 5] });
  let maxStep = 0;
  for (let i = 1; i < fr.length; i++) {
    const a = fr[i - 1].p, b = fr[i].p;
    maxStep = Math.max(maxStep, Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
  // 120 Hz frames; the fastest motion here is the first glide onto the face
  // (18 cm in ~0.7 s, peaking near 0.4 m/s, 3.3 mm a frame) plus this test's
  // heavy noise (1.5 mm, 4.5 mm in depth). A jump would be centimetres.
  assert.ok(maxStep < 0.006, `largest frame-to-frame step ${maxStep * 1000} mm`);
  const at = (t) => fr.reduce((best, f) => (Math.abs(f.t - t) < Math.abs(best.t - t) ? f : best)).p;
  const lostAt = at(2.07);
  // Still holding 0.4 s later (within a centimetre of where it stopped).
  const held = at(2.45);
  assert.ok(Math.hypot(held.x - lostAt.x, held.y - lostAt.y) < 0.01);
  // Resting by 4.9 s.
  const rest = TRACK_DEFAULTS.rest;
  const r = at(4.9);
  assert.ok(Math.hypot(r.x - rest.x, r.y - rest.y, r.z - rest.z) < 0.002, JSON.stringify(r));
  // Back on the face within ~0.8 s of it reappearing (5 s + latency). This
  // test's noise is 3x a webcam's, so the noise-adapted filter is calmer and
  // trails the slowly moving head by ~6 mm (no prediction below ~8 cm/s).
  const back = at(5.9);
  const tb = truth(5.9);
  assert.ok(Math.hypot(back.x - tb.x, back.y - tb.y) < 0.008, JSON.stringify(back));
});

test('a wild sample (another face, a glitch) is glided to, not jumped to', () => {
  const tr = new EyeTrack();
  let t = 0;
  for (; t < 1000; t += 33) { tr.push(t, { x: 0, y: 0, z: 0.6 }); tr.sample(t + 80); }
  const before = tr.sample(t + 80);
  tr.push(t, { x: 0.3, y: 0, z: 0.6 });
  const after = tr.sample(t + 88);
  assert.ok(Math.abs(after.x - before.x) < 0.01, `moved ${after.x - before.x}`);
});

test('tracker stalls: no news is treated as lost, not extrapolated forever', () => {
  const tr = new EyeTrack();
  let t = 0;
  for (; t < 1000; t += 33) { tr.push(t, { x: t / 1000 * 0.2, y: 0, z: 0.6 }); tr.sample(t + 80); }
  const p1 = tr.sample(t + 600);
  const p2 = tr.sample(t + 900);
  assert.ok(Math.abs(p2.x - p1.x) < 0.005, `${p1.x} -> ${p2.x}`);
  assert.notEqual(tr.state, 'tracking');
});

test('an eye switch glides from one eye to the other, never the wrong way first', () => {
  // Review of the fix round: feeding the 63 mm step in as motion made the
  // fast velocity and brake swing the view to -26 mm (-42 with noise) before
  // it glided over. A switch re-anchors the track instead (EyeTrack.shift).
  for (const [noise, seed] of [[0, 1], [0.0005, 2], [0.0005, 3]]) {
    const g = rng(seed);
    const tr = new EyeTrack();
    const xs = [];
    let k = 0;
    for (let t = 0; t < 3000; t += 1000 / 60) {
      // Camera frame k captured at k * 33.3 ms, result 60 ms later.
      while ((k + 1) * 33.33 + 60 <= t) {
        k++;
        const tc = k * 33.33;
        const after = tc >= 1500;
        if (after && tc - 33.33 < 1500) tr.shift({ x: 0.063, y: 0, z: 0 }, 280);
        tr.push(tc, { x: (after ? 0.063 : 0) + noise * g(), y: noise * g(), z: 0.6 + 3 * noise * g() });
      }
      const p = tr.sample(t + 30);
      if (t > 1400) xs.push({ t, x: p.x });
    }
    const lo = Math.min(...xs.map((q) => q.x));
    const hi = Math.max(...xs.map((q) => q.x));
    const end = xs.filter((q) => q.t > 2200).map((q) => q.x);
    assert.ok(lo > -0.003 && hi < 0.066, `noise ${noise}: range ${(lo * 1000).toFixed(1)} .. ${(hi * 1000).toFixed(1)} mm`);
    assert.ok(Math.abs(end.reduce((s, x) => s + x, 0) / end.length - 0.063) < 0.002, 'arrives at the new eye');
    if (noise === 0) {
      // A glide, not a jump and a swing back: every frame moves toward the new eye.
      for (let i = 1; i < xs.length; i++) assert.ok(xs[i].x >= xs[i - 1].x - 0.0002, `steps back at ${xs[i].t.toFixed(0)} ms: ${(xs[i - 1].x * 1000).toFixed(1)} -> ${(xs[i].x * 1000).toFixed(1)} mm`);
      const steps = xs.slice(1).map((q, i) => q.x - xs[i].x);
      assert.ok(Math.max(...steps) < 0.006, `largest frame step ${(Math.max(...steps) * 1000).toFixed(1)} mm`);
    }
  }
});

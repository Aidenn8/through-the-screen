// Motion quality of "Predict ahead" (One Euro + look-ahead with the brake,
// the first tuning and now the optional responsive mode), on the simulated
// pipeline of tools/core-motion.mjs (30 fps camera, 30 ms hidden camera delay,
// ~30 ms inference, 60 Hz render). Targets come from the core review. The
// default, Smooth follow, is tested in tests/follow.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreCorpora, missedTargets, leanOvershoot, reversalOvershoot, simulate, predictTrack,
  stillHead, NOISE, gapHitch, simulate as sim, scoreAll, panWobble,
} from '../tools/core-motion.mjs';

const P = { track: predictTrack() };

/** Mean lateral error (mm) on a steady pan, after the first 1.5 s. */
function panError(speed, noise, track = predictTrack()) {
  const path = (t) => ({ x: -0.3 + (speed * t) / 1000, y: 0, z: 0.6 });
  const fr = simulate(path, 5000, { track, noise: { x: noise, y: 1.2 * noise, z: 12 * noise }, seed: 4 }).filter((q) => q.t > 1500);
  return (fr.reduce((a, q) => a + Math.abs(q.p.x - path(q.t).x), 0) / fr.length) * 1000;
}

test('stops and reversals: the view does not swing past where the head stopped (corpus targets, pan wobble)', () => {
  const r = scoreAll(P);
  assert.deepEqual(missedTargets(r), [], JSON.stringify(r));
});

test('a steady pan does not shake: wobble near what it was before the brake', () => {
  // Review of the fix round: the brake firing on noise took the wobble on a
  // 0.2 m/s pan at 0.5 mm noise from 1.05 to 4.0 mm (0.94 -> 3.04 at 0.1 m/s).
  const fast = panWobble(0.2, 0.0005, P).wobble;
  const slow = panWobble(0.1, 0.0005, P).wobble;
  const clean = panWobble(0.2, 0.0001, P).wobble;
  assert.ok(fast < 1.3 && slow < 1.2 && clean < 0.3, `wobble ${fast.toFixed(2)} / ${slow.toFixed(2)} / ${clean.toFixed(2)} mm`);
});

test('a quick 15 cm lean stops where the head stops', () => {
  // Review: 63 / 33 / 13 mm past the stop for 0.4 / 0.6 / 1.0 s leans.
  const over = [0.4, 0.6, 1.0].map((T) => leanOvershoot(T, P));
  assert.ok(over[0] < 25 && over[1] < 8 && over[2] < 3, `overshoot ${over.map((x) => x.toFixed(1)).join(' / ')} mm`);
});

test('a sharp reversal at 0.3 m/s runs past the turning point by under 2 cm', () => {
  // Review: 35 mm.
  const over = reversalOvershoot(0.3, P);
  assert.ok(over < 20, `${over.toFixed(1)} mm`);
});

test('the price of braking: a steady 0.2 m/s pan trails by under a centimetre', () => {
  // Look-ahead below 100 % and a 90 ms correction blend trail a steady pan by
  // design (shipped 100 %: 0.8 mm; the review's 60 % suggestion: 12.7 mm).
  // Measured 7.1 / 7.7 mm.
  const clean = panError(0.2, 0.0001);
  const real = panError(0.2, 0.0005);
  assert.ok(clean < 8 && real < 9, `clean ${clean.toFixed(1)} mm, webcam-like ${real.toFixed(1)} mm`);
});

test('far away and in dim light, prediction adds almost no shimmer', () => {
  // Review: at 95 cm prediction multiplied the frame-to-frame swim 4x
  // (0.67 vs 0.17 mm) and depth wobble 3x. Compare with no prediction at all.
  for (const [name, noise, stepMax, zMax] of [['far', NOISE.far, 1.4, 1.25], ['dim', NOISE.dim, 1.3, 1.25]]) {
    const on = stillHead(noise, P);
    const off = stillHead(noise, { track: predictTrack({ predictGain: 0 }) });
    assert.ok(on.step <= stepMax * off.step, `${name}: step ${on.step.toFixed(3)} vs ${off.step.toFixed(3)} mm without prediction`);
    assert.ok(on.zStd <= zMax * off.zStd, `${name}: depth std ${on.zStd.toFixed(2)} vs ${off.zStd.toFixed(2)} mm without prediction`);
  }
});

test('a detection gap under 150 ms is a missing sample, not a lost face', () => {
  // Review: one missed frame during a 0.2 m/s pan reset the filter and glided
  // back over 300 ms (-13 then +6 mm). Now the track coasts on.
  const hitch = [30, 95, 130].map((ms) => gapHitch(ms, P));
  assert.ok(hitch[0] < 3 && hitch[1] < 6 && hitch[2] < 9, `1/3/4 missed frames: ${hitch.map((x) => x.toFixed(1)).join(' / ')} mm`);
  // A longer gap still counts as lost: hold, don't extrapolate.
  const path = (t) => ({ x: 0.2 * Math.max(0, t - 1000) / 1000, y: 0, z: 0.6 });
  const fr = sim(path, 4000, { ...P, missAt: (te) => te > 2000 && te < 2600 });
  assert.ok(fr.some((f) => f.state === 'holding'), 'a 600 ms gap is held');
});

test('stops stay controlled when tracking slows to 20 Hz (busy machine)', () => {
  // The brake's deceleration fit spans ~110 ms counted in samples: a fixed
  // 110 ms window held too few at 20 Hz and went stale (overshoot 24.4 / p90
  // 47 mm). Now 14.1 / 26.6; the previous brake: 12.1 / 32.3.
  const r = scoreCorpora({ track: predictTrack(), fps: 20 });
  assert.ok(r.over <= 15 && r.overP90 <= 30, `20 Hz: overshoot ${r.over.toFixed(1)} / p90 ${r.overP90.toFixed(1)} mm`);
});

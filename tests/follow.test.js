// Smooth follow (src/tracking/follow.js), the default motion: never past the
// head, sway absorbed, smoother than the look-ahead 0 the first real test
// tried, on the simulated real-like pipeline of tools/core-motion.mjs
// (FaceTime camera in a dim room: 48 ms camera delay, dim-room noise, motion
// blur, seated sway with micro-corrections, 30 and 15 fps).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SmoothFollow } from '../src/tracking/follow.js';
import { EyeTrack } from '../src/tracking/predictor.js';
import {
  appTrack, predictTrack, realLike, simulate, swayResponse, leanLag, panSmoothness, scoreLeans,
  makeLeanCorpus, gapHitch, missedFollowTargets,
} from '../tools/core-motion.mjs';

const mj = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : 10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5);

/** Feed samples at `fps` (no noise), render at 120 Hz; returns rendered x per frame. */
function drive(fps, xAt, ms = 3000, opts = {}) {
  const f = new SmoothFollow(opts);
  const out = [];
  let k = 0;
  for (let t = 0; t < ms; t += 1000 / 120) {
    // A sample captured at k/fps arrives 80 ms later.
    while ((k * 1000) / fps + 80 <= t) { const tc = (k * 1000) / fps; f.push(tc, { x: xAt(tc), y: 0, z: 0.6 }, { interval: 1000 / fps }); k++; }
    const p = f.at(t + 30);
    if (p) out.push({ t: t + 30, x: p.x });
  }
  return out;
}

test('smooth follow: a 10 cm step is followed without overshoot, and never moves backwards', () => {
  for (const fps of [30, 15]) {
    const out = drive(fps, (t) => (t >= 1000 ? 0.1 : 0));
    const max = Math.max(...out.map((q) => q.x));
    assert.ok(max <= 0.1 + 1e-9, `${fps} fps: reached ${(max * 1000).toFixed(4)} mm for a 100 mm step`);
    for (let i = 1; i < out.length; i++) assert.ok(out[i].x >= out[i - 1].x - 1e-12, `${fps} fps: moved back at ${out[i].t.toFixed(0)} ms`);
    const end = out.at(-1).x;
    assert.ok(Math.abs(end - 0.1) < 0.002, `${fps} fps: settles on the head (${(end * 1000).toFixed(2)} mm)`);
  }
});

test('smooth follow: a quick lean that stops dead ends where the head stopped, not past it', () => {
  // Noise-free: exactly never past. 15 cm in 0.4 s, the quickest lean in the corpus.
  for (const fps of [30, 15]) {
    const out = drive(fps, (t) => 0.15 * mj((t - 1000) / 400));
    const max = Math.max(...out.map((q) => q.x));
    assert.ok(max <= 0.15 + 1e-9, `${fps} fps: ${((max - 0.15) * 1000).toFixed(4)} mm past the stop`);
  }
  // With dim-room noise, sway and micro-corrections on top: within 2 mm of the farthest the head went.
  for (const fps of [30, 15]) {
    const r = scoreLeans(makeLeanCorpus(5), realLike(fps, { track: appTrack(), seed: 405 }));
    const l = leanLag(0.4, realLike(fps, { track: appTrack() }), [1, 2, 3]);
    assert.ok(r.pastMax <= 2 && l.pastMax <= 2, `${fps} fps: past the head ${r.pastMax.toFixed(2)} mm (corpus max), ${l.pastMax.toFixed(2)} mm (0.4 s leans)`);
  }
});

test('smooth follow: a seated head\'s sway and micro-corrections barely move the view', () => {
  for (const fps of [30, 15]) {
    const r = swayResponse(realLike(fps, { track: appTrack() }), [1, 2]);
    assert.ok(r.response <= 0.3, `${fps} fps: view repeats ${(100 * r.response).toFixed(0)} % of 3 mm sway (target <= 30 %)`);
    assert.ok(r.speed <= 0.2, `${fps} fps: view speed ${(100 * r.speed).toFixed(0)} % of the head's`);
    assert.ok(r.micro <= 0.15, `${fps} fps: ${(100 * r.micro).toFixed(0)} % of each micro-correction`);
    assert.ok(r.zResponse <= 0.35, `${fps} fps: depth ${(100 * r.zResponse).toFixed(0)} %`);
    // The earlier default followed all of it (and more in depth).
    const old = swayResponse(realLike(fps, { track: predictTrack() }), [1]);
    assert.ok(old.response > 0.9, `old default ${(100 * old.response).toFixed(0)} %`);
  }
});

test('smooth follow: smoother than look-ahead 0 at 30 and 15 fps, and keeps up with a 15 cm lean', () => {
  for (const fps of [30, 15]) {
    const sim = realLike(fps, { track: appTrack() });
    const base = realLike(fps, { track: predictTrack({ predictGain: 0 }) });
    const a = panSmoothness(0.1, sim);
    const b = panSmoothness(0.1, base);
    assert.ok(a.jerk < b.jerk / 2.5 && a.stepStd < b.stepStd / 2, `${fps} fps pan: jerk ${a.jerk.toFixed(3)} vs ${b.jerk.toFixed(3)}, step std ${a.stepStd.toFixed(3)} vs ${b.stepStd.toFixed(3)} mm`);
    const sa = swayResponse(sim, [1]);
    const sb = swayResponse(base, [1]);
    assert.ok(sa.jerk < sb.jerk / 4 && sa.step < sb.step / 2.5, `${fps} fps still: jerk ${sa.jerk.toFixed(4)} vs ${sb.jerk.toFixed(4)}, step ${sa.step.toFixed(3)} vs ${sb.step.toFixed(3)} mm`);
    const lag = leanLag(0.6, sim, [1, 2, 3]).lag;
    assert.ok(lag <= (fps === 30 ? 250 : 320), `${fps} fps: ${lag.toFixed(0)} ms to reach 90 % of a 15 cm lean`);
  }
});

test('smooth follow: 30 Hz samples drawn at 120 Hz move without steps', () => {
  const out = drive(30, (t) => 0.1 * t / 1000, 4000).filter((q) => q.t > 1500);
  const ideal = 0.1 / 120;
  for (let i = 1; i < out.length; i++) {
    const s = out[i].x - out[i - 1].x;
    assert.ok(s > 0.9 * ideal && s < 1.1 * ideal, `step ${(s * 1000).toFixed(4)} mm vs ${(ideal * 1000).toFixed(4)}`);
  }
});

test('smooth follow: short detection gaps slow the view a little; a long one is held', () => {
  // No extrapolation: through a gap the view eases toward the last sample
  // and catches up when samples return (a 0.2 m/s pan falls 0.7 / 8 / 14 mm
  // behind for 1 / 3 / 4 missed frames; Predict ahead coasts: 1 / 3 / 4 mm,
  // but it can coast past a stop).
  const o = { track: appTrack() };
  const h = [30, 95, 130].map((ms) => gapHitch(ms, o));
  assert.ok(h[0] < 2 && h[1] < 11 && h[2] < 17, `1/3/4 missed frames: ${h.map((x) => x.toFixed(1)).join(' / ')} mm`);
  const fr = simulate((t) => ({ x: 0.2 * Math.max(0, t - 1000) / 1000, y: 0, z: 0.6 }), 4000, { ...o, missAt: (te) => te > 2000 && te < 2600 });
  assert.ok(fr.some((f) => f.state === 'holding'), 'a 600 ms gap is held');
});

test('smooth follow: switching from Predict ahead glides, it does not jump', () => {
  const tr = new EyeTrack(predictTrack());
  let maxStep = 0;
  let prev = null;
  for (let t = 0, k = 0; t < 3000; t += 1000 / 60) {
    while (k * 33.3 + 80 <= t) { tr.push(k * 33.3, { x: 0.1 * Math.sin(k * 33.3 / 400), y: 0, z: 0.6 }); k++; }
    if (Math.abs(t - 1500) < 8) tr.configure(appTrack());
    const p = tr.sample(t + 30);
    if (prev && t > 300) maxStep = Math.max(maxStep, Math.abs(p.x - prev.x));
    prev = p;
  }
  assert.ok(maxStep < 0.006, `largest frame step ${(maxStep * 1000).toFixed(2)} mm`);
});

test('bench: the default meets the Smooth follow targets (tools/core-motion.mjs --check)', () => {
  assert.deepEqual(missedFollowTargets(true), []);
});

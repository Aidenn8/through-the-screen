import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateDelay, halfwayTime, sensorTime } from '../src/tracking/latency.js';
import { EyeTrack } from '../src/tracking/predictor.js';

function rng(seed = 2) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/**
 * A simulated camera watching the flashing screen. Frames every 33.3 ms,
 * exposure X ms ending at E; Chrome stamps captureTime = E + R. Brightness is
 * the share of the exposure after the photons arrived.
 */
function camera({ R, X, displayMs, flashes = 8, noise = 0.5, seed = 3 }) {
  const u = rng(seed);
  const out = [];
  let t = 1000;
  for (let k = 0; k < flashes; k++) {
    t += 600 + 400 * u();
    const tOn = t;
    const T = tOn + displayMs;
    const phase = u() * 33.3;
    const frames = [];
    for (let E = tOn - 300 + phase; E < tOn + 500; E += 33.3) {
      const lit = Math.min(1, Math.max(0, (E - T) / X));
      frames.push({ t: E + R, lum: 40 + 100 * lit + noise * (u() - 0.5) });
    }
    out.push({ tOn, frames });
    t += 400;
  }
  return out;
}

test('camera delay: recovered from flashes, short or long exposure', () => {
  for (const [R, X] of [[30, 4], [30, 30], [70, 16], [100, 33]]) {
    const displayMs = 30;
    const r = estimateDelay(camera({ R, X, displayMs, flashes: 12 }), { displayMs });
    // The delay the app wants: captureTime minus the middle of the exposure.
    const want = R + X / 2;
    assert.ok(Math.abs(r.delayMs - want) < 8, `R ${R} X ${X}: got ${r.delayMs.toFixed(1)}, want ${want}`);
  }
});

test('camera delay: a flash the camera barely sees is not trusted', () => {
  // A bright room: the flash lifts the picture by 2 levels, sensor noise is 4.
  const u = rng(8);
  const flashes = camera({ R: 40, X: 10, displayMs: 30, noise: 0 }).map((f) => ({ ...f, frames: f.frames.map((x) => ({ ...x, lum: 40 + (x.lum - 40) * 0.02 + 4 * (u() - 0.5) })) }));
  const r = estimateDelay(flashes, { displayMs: 30 });
  assert.equal(r.weak, true);
  assert.equal(halfwayTime({ tOn: 0, frames: [] }), null);
});

test('camera delay: frames without a face are timed on the samples’ clock', () => {
  // With a measured 100 ms delay, two missed frames at 30 Hz are a 67 ms gap:
  // the track coasts through it. Timed on the capture clock instead, the delay
  // counted as gap and two misses read as a lost face (hold, then a glide).
  const delay = 100;
  const frame = 1000 / 30;
  const run = (missClock) => {
    const tr = new EyeTrack();
    let tCap = 0;
    for (; tCap < 1000; tCap += frame) tr.push(sensorTime(tCap, delay), { x: 0.01 * Math.sin(tCap / 200), y: 0, z: 0.6 });
    for (let k = 0; k < 2; k++, tCap += frame) tr.miss(missClock(tCap));
    return tr.state;
  };
  assert.equal(run((t) => sensorTime(t, delay)), 'tracking');
  assert.equal(run((t) => t), 'holding', 'the old mixed clocks lose the face');
  assert.equal(sensorTime(500, undefined), 500);
  assert.equal(sensorTime(500, NaN), 500);
});

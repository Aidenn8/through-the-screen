import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IpdEstimator } from '../src/tracking/ipd.js';
import { MouseEye } from '../src/app/mouse-eye.js';
import { intrinsicsFor, guessCameraPreset, deliveredHfov } from '../src/tracking/camera-presets.js';

// settings.js imports display.js only; give it a localStorage to talk to.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { loadSettings, saveSettings, resetSettings, filterFor, followFor, motionOptions, DEFAULTS } = await import('../src/app/settings.js');

test('settings: defaults to one eye, round-trips, survives a broken store', () => {
  store.clear();
  const s = loadSettings();
  assert.equal(s.eyeMode, 'one');
  assert.equal(s.eye, 'right');
  s.ipdMm = 60.5;
  s.phone.rightMm = 50;
  saveSettings(s);
  const t = loadSettings();
  assert.equal(t.ipdMm, 60.5);
  assert.equal(t.phone.rightMm, 50);
  assert.equal(t.phone.upMm, DEFAULTS.phone.upMm);
  store.set('window-display:settings:v1', '{not json');
  assert.equal(loadSettings().ipdMm, DEFAULTS.ipdMm);
  assert.equal(resetSettings().eyeMode, 'one');
});

test('settings: eye-turn correction is off unless chosen (unvalidated on real eyes)', () => {
  store.clear();
  assert.equal(DEFAULTS.gazeCompensation, false);
  store.set('window-display:settings:v1', JSON.stringify({ motionVersion: 2, ipdMm: 62 }));
  assert.equal(loadSettings().gazeCompensation, false, 'older saved settings get it off');
  const s = loadSettings();
  s.gazeCompensation = true;
  saveSettings(s);
  assert.equal(loadSettings().gazeCompensation, true);
});

test('settings: motion values saved for the old predictor reset to the new defaults, once', () => {
  store.clear();
  store.set('window-display:settings:v1', JSON.stringify({ prediction: 1, smoothing: 0.2, ipdMm: 61 }));
  const s = loadSettings();
  assert.equal(s.prediction, DEFAULTS.prediction);
  assert.equal(s.smoothing, DEFAULTS.smoothing);
  assert.equal(s.ipdMm, 61, 'other settings are kept');
  s.prediction = 0.5;
  saveSettings(s);
  assert.equal(loadSettings().prediction, 0.5, 'a choice made with the new predictor sticks');
});

test('settings: Smooth follow and Look around 3x are the defaults; motion saved before them resets once', () => {
  store.clear();
  assert.equal(DEFAULTS.motionMode, 'follow');
  assert.equal(DEFAULTS.viewDirection, 'look');
  assert.deepEqual(DEFAULTS.strength, { look: 3, window: 1 });
  // Saved under the 2x default (motionVersion 3): the strength takes the new default once.
  store.set('window-display:settings:v1', JSON.stringify({ motionVersion: 3, strength: { look: 2, window: 1 }, viewDirection: 'look', ipdMm: 62 }));
  assert.deepEqual(loadSettings().strength, { look: 3, window: 1 });
  assert.equal(loadSettings().ipdMm, 62);
  // Saved by the version the first real test ran (motionVersion 2).
  store.set('window-display:settings:v1', JSON.stringify({ motionVersion: 2, prediction: 0, smoothing: 0.9, smoothness: 0.1, motionMode: 'predict', ipdMm: 61 }));
  const s = loadSettings();
  assert.equal(s.motionMode, 'follow');
  assert.equal(s.smoothness, DEFAULTS.smoothness);
  assert.equal(s.prediction, DEFAULTS.prediction);
  assert.equal(s.ipdMm, 61);
  s.smoothness = 0.8;
  s.viewDirection = 'window';
  s.strength = { look: 2.5, window: 1 };
  saveSettings(s);
  const t = loadSettings();
  assert.equal(t.smoothness, 0.8, 'a choice made after the reset sticks');
  assert.equal(t.viewDirection, 'window');
  assert.equal(t.strength.look, 2.5);
  const m = motionOptions(t);
  assert.equal(m.mode, 'follow');
  assert.deepEqual(m.follow, followFor(0.8));
});

test('settings: saved motion numbers that are not numbers (or out of range) fall back to the defaults', () => {
  store.clear();
  // JSON stores NaN as null; a hand-edited or corrupted store can hold anything.
  store.set('window-display:settings:v1', JSON.stringify({
    motionVersion: DEFAULTS.motionVersion, strength: { look: null, window: 'x' }, smoothness: null, smoothing: 'a',
    prediction: 99, motionMode: 'fast', viewDirection: 7, ipdMm: 62,
  }));
  const s = loadSettings();
  assert.deepEqual(s.strength, DEFAULTS.strength);
  assert.equal(s.smoothness, DEFAULTS.smoothness);
  assert.equal(s.smoothing, DEFAULTS.smoothing);
  assert.equal(s.prediction, 1.5, 'a number out of range is clamped');
  assert.equal(s.motionMode, DEFAULTS.motionMode);
  assert.equal(s.viewDirection, DEFAULTS.viewDirection);
  store.set('window-display:settings:v1', JSON.stringify({ motionVersion: DEFAULTS.motionVersion, strength: { look: 2.5, window: 0.2 } }));
  assert.deepEqual(loadSettings().strength, { look: 2.5, window: 1 });
  store.set('window-display:settings:v1', JSON.stringify({ motionVersion: DEFAULTS.motionVersion, strength: { look: 9, window: 4.5 } }));
  assert.deepEqual(loadSettings().strength, { look: 5, window: 4.5 }, 'Strength runs 1-5x');
  store.clear();
});

test('settings: head turn steers Look around by default at 1x; a toggle and a strength that round-trip and fall back when broken', () => {
  store.clear();
  assert.equal(DEFAULTS.turnSteer, true);
  assert.equal(DEFAULTS.turnStrength, 1);
  // Saved before head turn existed: it is on, at 1x, and nothing else resets.
  store.set('window-display:settings:v1', JSON.stringify({ motionVersion: DEFAULTS.motionVersion, strength: { look: 2.5, window: 1 }, ipdMm: 62 }));
  let s = loadSettings();
  assert.equal(s.turnSteer, true);
  assert.equal(s.turnStrength, 1);
  assert.equal(s.strength.look, 2.5);
  s.turnSteer = false;
  s.turnStrength = 1.6;
  saveSettings(s);
  s = loadSettings();
  assert.equal(s.turnSteer, false);
  assert.equal(s.turnStrength, 1.6);
  store.set('window-display:settings:v1', JSON.stringify({ motionVersion: DEFAULTS.motionVersion, turnSteer: 'yes', turnStrength: null }));
  s = loadSettings();
  assert.equal(s.turnSteer, true);
  assert.equal(s.turnStrength, 1);
  store.set('window-display:settings:v1', JSON.stringify({ motionVersion: DEFAULTS.motionVersion, turnStrength: 9 }));
  assert.equal(loadSettings().turnStrength, 2, 'Turn strength runs 0.25-2x');
  store.clear();
});

test('smoothness slider: calmer = slower spring and wider dead-band; middle is the tuned default', () => {
  const [a, b, c] = [0, 0.5, 1].map(followFor);
  assert.ok(a.tauMs < b.tauMs && b.tauMs < c.tauMs && a.bandMm < b.bandMm && b.bandMm < c.bandMm);
  assert.ok(Math.abs(b.tauMs - 30) < 1e-9 && Math.abs(b.bandMm - 6) < 1e-9, JSON.stringify(b));
  assert.ok(b.tauZMs > b.tauMs, 'depth is smoothed more');
});

test('steadiness slider: more steadiness, lower cutoff; middle is the tuned default', () => {
  const a = filterFor(0).filterXY.minCutoff;
  const b = filterFor(0.5).filterXY.minCutoff;
  const c = filterFor(1).filterXY.minCutoff;
  assert.ok(a > b && b > c);
  assert.ok(filterFor(0.5).filterZ.minCutoff < b);
});

test('eye spacing from irises: median of implied IPDs, blended in gradually', () => {
  const est = new IpdEstimator();
  assert.equal(est.measured, null);
  assert.equal(est.fused(0.063, false), 0.063);
  // Viewer's true IPD 59 mm: with the 63 mm setting, the IPD-based distance
  // reads 63/59 too far, the iris-based one is right.
  for (let i = 0; i < 200; i++) {
    const noise = 1 + 0.04 * Math.sin(i * 1.7);
    est.add({ irisDistance: 0.6 * noise, distance: 0.6 * (63 / 59), sinYaw: 0.05 }, 0.063);
  }
  assert.ok(Math.abs(est.measured - 0.059) < 0.0008, `${est.measured}`);
  const fused = est.fused(0.063, false);
  assert.ok(fused < 0.0615 && fused > 0.0595, `${fused}`);
  assert.equal(est.fused(0.063, true), 0.063);
  // Turned heads and closed eyes are ignored.
  const n = est.samples.length;
  est.add({ irisDistance: 0.6, distance: 0.6, sinYaw: 0.6 }, 0.063);
  est.add({ irisDistance: null, distance: 0.6, sinYaw: 0 }, 0.063);
  assert.equal(est.samples.length, n);
});

test('mouse fallback: pointer to the right moves the eye right, smoothly', () => {
  const vp = { centre: { x: 0, y: -0.003 }, width: 0.3266, height: 0.2051, metresPerCssPx: 0.3266 / 1710 };
  const m = new MouseEye();
  let p = m.sample(0);
  m.point(1500, 500, vp);
  const xs = [];
  for (let t = 16; t < 1500; t += 16) xs.push((p = m.sample(t)).x);
  assert.ok(xs.at(-1) > 0.1, `${xs.at(-1)}`);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] < 0.02);
  m.leave();
  for (let t = 1500; t < 4000; t += 16) p = m.sample(t);
  assert.ok(Math.abs(p.x) < 0.005);
});

test('camera presets: built-in camera chosen by name; 4:3 is a crop of 16:9', () => {
  assert.equal(guessCameraPreset('FaceTime HD Camera'), 'builtin-notch');
  assert.equal(guessCameraPreset('iPhone Camera'), 'iphone-lid');
  assert.equal(guessCameraPreset('Logitech BRIO'), 'external-top');
  const wide = intrinsicsFor(1280, 720, 68);
  const crop = intrinsicsFor(960, 720, 68);
  assert.ok(Math.abs(wide.fx - crop.fx) < 1e-9);
  assert.ok(Math.abs(deliveredHfov(wide) - 68) < 1e-9);
  assert.ok(deliveredHfov(crop) < 68);
  assert.ok(Math.abs(intrinsicsFor(1920, 1080, 68).fx / wide.fx - 1.5) < 1e-9);
});

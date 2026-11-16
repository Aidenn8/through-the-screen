// Persisted settings. localStorage can be missing or throw (private windows,
// blocked site data); everything works without it.

import { DEFAULT_DISPLAY } from '../core/display.js';
import { STRENGTH, TURN_STRENGTH } from '../tracking/view-map.js';

const KEY = 'window-display:settings:v1';
// Bumped when the filter or predictor changes enough that saved motion
// settings no longer mean the same thing; they then reset to the defaults.
// 3: Smooth follow became the default (the first real-camera test swung).
// 4: Look around at 3x by default (the user asked for bigger motion); a
// strength saved under the old 2x default resets to it.
const MOTION_VERSION = 4;

export const DEFAULTS = Object.freeze({
  display: DEFAULT_DISPLAY,
  customDisplay: null, // { widthMm, heightMm } from the card calibration
  cameraId: null,
  cameraPreset: null, // null = guess from the camera's name
  fovOverride: {}, // { [presetId]: hfovDeg }
  cameraTrimMm: { x: 0, y: 0 },
  // One eye is the default: with both eyes open, stereo says "flat screen" and
  // rendering from the midpoint puts each eye 31 mm off (REFERENCES 5.3).
  eyeMode: 'one', // one | both | phone
  eye: 'right', // the eye kept open (about 2/3 of people are right-eye dominant)
  autoEye: true, // follow whichever eye is open when the other is closed
  phone: { eye: 'right', rightMm: 35, upMm: 0, forwardMm: 10 },
  ipdMm: 63,
  ipdManual: false,
  ipdIrisMm: null, // measured from the irises on the first run (both eyes open)
  eyeSource: 'stable', // stable | iris
  // Correct the stable eye point for the eye turning when the head turns
  // (GazeCompensator). Off until a creep check on a real face shows it helps:
  // on the painted-eye test clips it adds 2-3 mm at 20-30 deg head turns.
  gazeCompensation: false,
  // Motion. 'follow': a dead-band and a critically damped spring, no
  // extrapolation, one Smoothness slider. 'predict': the earlier tuning (One
  // Euro, look-ahead with braking), with Steadiness and Look-ahead.
  motionMode: 'follow',
  smoothness: 0.5, // 0 = responsive .. 1 = calm (followFor)
  // View direction: 'look' (Look around) mirrors head motion about where
  // the viewer sits; 'window' (True window) is the exact window. Strength
  // is a gain on head motion, kept per direction (src/tracking/view-map.js).
  viewDirection: 'look',
  strength: { look: STRENGTH.look, window: STRENGTH.window },
  // Look around only: where the face points steers the view too (tilt back
  // to see more of the top, turn to see a side; src/tracking/head-turn.js),
  // scaled by Turn strength (1x: up to about 25 cm up or down, 30 cm sideways).
  turnSteer: true,
  turnStrength: TURN_STRENGTH.default,
  smoothing: 0.5, // 'predict' Steadiness: 0 = least, 1 = most
  prediction: 0.8, // 'predict' Look-ahead: 0..1.5 of full latency compensation
  motionVersion: MOTION_VERSION,
  // Chrome on macOS stamps captureTime when it receives the frame, so exposure,
  // readout and image processing happen before it (REFERENCES 4.3). Estimate.
  cameraDelayMs: 30,
  cameraDelays: {}, // { [cameraPresetId]: ms } measured with screen flashes
  scene: null,
  hud: false,
  started: false, // the viewer chose camera or mouse before
  inputMode: null, // 'camera' | 'mouse'
});

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

export function loadSettings() {
  let saved = {};
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) saved = JSON.parse(raw) || {};
  } catch {
    saved = {};
  }
  if (saved.motionVersion !== MOTION_VERSION) {
    for (const k of ['motionMode', 'smoothness', 'smoothing', 'prediction', 'strength', 'motionVersion']) delete saved[k];
  }
  const s = { ...clone(DEFAULTS), ...saved };
  s.phone = { ...DEFAULTS.phone, ...(saved.phone || {}) };
  s.cameraTrimMm = { ...DEFAULTS.cameraTrimMm, ...(saved.cameraTrimMm || {}) };
  s.fovOverride = { ...(saved.fovOverride || {}) };
  s.cameraDelays = { ...(saved.cameraDelays || {}) };
  // Motion numbers drive the filter every frame: anything saved that is not
  // a number in range (a NaN is stored as null) falls back to the default.
  const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const st = saved.strength && typeof saved.strength === 'object' ? saved.strength : {};
  s.strength = { look: num(st.look, STRENGTH.min, STRENGTH.max, DEFAULTS.strength.look), window: num(st.window, STRENGTH.min, STRENGTH.max, DEFAULTS.strength.window) };
  s.turnStrength = num(s.turnStrength, TURN_STRENGTH.min, TURN_STRENGTH.max, DEFAULTS.turnStrength);
  if (typeof s.turnSteer !== 'boolean') s.turnSteer = DEFAULTS.turnSteer;
  s.smoothness = num(s.smoothness, 0, 1, DEFAULTS.smoothness);
  s.smoothing = num(s.smoothing, 0, 1, DEFAULTS.smoothing);
  s.prediction = num(s.prediction, 0, 1.5, DEFAULTS.prediction);
  if (!['look', 'window'].includes(s.viewDirection)) s.viewDirection = DEFAULTS.viewDirection;
  if (!['follow', 'predict'].includes(s.motionMode)) s.motionMode = DEFAULTS.motionMode;
  return s;
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not persisted; the session still works.
  }
}

export function resetSettings() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  return clone(DEFAULTS);
}

/**
 * Steadiness slider -> filter settings. The middle is the tuned default
 * (docs/CORE_NOTES.md); "quick" follows faster but shimmers more on a noisy
 * camera, "steady" is calmer but trails fast moves.
 */
export function filterFor(smoothing) {
  const s = Math.min(1, Math.max(0, smoothing));
  const minCutoff = 1.0 * Math.pow(0.25, s); // 1.0 -> 0.5 -> 0.25 Hz
  const beta = 64 * Math.pow(0.25, s); // 64 -> 32 -> 16 per m/s
  const velocityCutoff = 10 * Math.pow(0.36, s); // 10 -> 6 -> 3.6 Hz
  return {
    filterXY: { minCutoff, beta, dCutoff: 1 },
    filterZ: { minCutoff: minCutoff / 2, beta: beta / 2, dCutoff: 1 },
    velocityCutoff,
  };
}

/**
 * Smoothness slider -> SmoothFollow options (src/tracking/follow.js). 0 is
 * responsive, 1 is calm; the middle is the tuned default (docs/CORE_NOTES.md,
 * tools/core-motion.mjs: about 245 ms to reach 90 % of a 15 cm lean at
 * 30 fps, a quarter of a seated head's sway, no overshoot). The spring's time
 * constant and the dead-band grow together: a calmer view also ignores more
 * of the sway.
 */
export function followFor(smoothness) {
  const s = Math.min(1, Math.max(0, smoothness));
  // Geometric through 0 / 0.5 / 1.
  const geo = (a, m, b) => (s <= 0.5 ? a * (m / a) ** (2 * s) : m * (b / m) ** (2 * s - 1));
  return {
    tauMs: geo(18, 30, 75),
    tauZMs: geo(100, 150, 300),
    bandMm: 2.5 + 7 * s, // 2.5 -> 6 -> 9.5 mm
    bandZMm: 5 + 7 * s, // 5 -> 8.5 -> 12 mm
  };
}

/** Everything EyeTrack needs from the settings (App#applyMotionSettings). */
export function motionOptions(s) {
  return {
    ...filterFor(s.smoothing),
    predictGain: s.prediction,
    mode: s.motionMode === 'predict' ? 'predict' : 'follow',
    follow: followFor(s.smoothness),
  };
}

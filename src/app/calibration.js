// Steady check: the steps, and the small pieces of maths behind them.
//
// Why these steps, in this order (docs/CORE_NOTES.md, "Steady check"):
//   - The glossy screen is a mirror. Seen from your own eye, the reflection of
//     that eye sits on the glass straight in front of it, at the eye's (x, y).
//     A cross drawn there must sit on the pupil's reflection. Held still, this
//     test does not depend on delay or prediction at all.
//   - Sideways position from the camera is eye spacing x pixel ratios, with no
//     field of view in it, so a sideways pose checks eye spacing alone.
//   - Straight ahead, after that, what is left vertically is the camera height.
//   - Depth also scales with the camera's focal length, which only a measured
//     distance can pin down: that sets the field of view.
//   - Last, the far rings show the result in motion.

/**
 * view: 'rings' (tunnel and far rings) or 'cross' (everything black except a
 * cross on the glass in front of the tracked eye).
 * control: which input the step shows.
 * {open} and {closed} are replaced with the viewer's eyes.
 */
export const STEADY_STEPS = [
  { id: 'eye', title: 'Close one eye', view: 'rings', control: null,
    text: 'Close your {closed} eye and keep your {open} eye open until the end.' },
  { id: 'dark', title: 'Find your reflection', view: 'cross', control: null,
    text: 'Dim the light behind you until you can see your open eye reflected in the dark screen.' },
  { id: 'left', title: 'Lean left', view: 'cross', control: 'ipd',
    text: 'Lean a hand’s width to your left, hold still, and drag the slider until the cross sits on your eye’s reflection.' },
  { id: 'right', title: 'Lean right', view: 'cross', control: 'ipd',
    text: 'Lean a hand’s width to your right, hold still, and drag the slider until the cross sits on your eye’s reflection.' },
  { id: 'centre', title: 'Sit in the middle', view: 'cross', control: 'height',
    text: 'Sit in the middle, hold still, and drag the slider until the cross sits on your eye’s reflection.' },
  { id: 'distance', title: 'Measure the distance', view: 'cross', control: 'distance',
    text: 'If you have a tape measure, hold your open eye this far from the screen and press Measure.' },
  { id: 'check', title: 'Check it', view: 'rings', control: null,
    text: 'Sway and lean: the far blue rings should stay put, like things seen through a window.' },
];

/** Eye-to-screen distances the steady check's Measure step accepts (cm). */
export const DISTANCE_CM = { min: 25, max: 120 };

/** Values over the last windowMs, for readouts that should not flicker. */
export class RecentSamples {
  constructor(windowMs = 1000) {
    this.windowMs = windowMs;
    this.items = [];
  }

  add(t, v) {
    this.items.push({ t, v });
    while (this.items.length && t - this.items[0].t > this.windowMs) this.items.shift();
  }

  clear() {
    this.items = [];
  }

  /** @returns {{mean:number, std:number, n:number}} over (now - windowMs, now] */
  mean(now) {
    let s = 0;
    let s2 = 0;
    let n = 0;
    for (const it of this.items) {
      if (now - it.t <= this.windowMs) { s += it.v; s2 += it.v * it.v; n++; }
    }
    const mean = n ? s / n : NaN;
    return { mean, std: n ? Math.sqrt(Math.max(0, s2 / n - mean * mean)) : NaN, n };
  }
}

/**
 * Horizontal field of view that makes the estimated distance match a measured
 * one. Depth scales with the focal length; sideways position does not.
 */
export function fovFromDistance(oldHfovDeg, dTrue, dEst) {
  const ratio = dTrue / dEst;
  return (2 * Math.atan(Math.tan((oldHfovDeg * Math.PI) / 360) / ratio) * 180) / Math.PI;
}

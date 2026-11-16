// Adaptive resolution. The illusion needs two things from the machine: a
// steady 60 fps render, and face tracking at the camera's full rate with
// little delay (a heavy GPU load slows inference and the frame hand-off even
// while rendering holds 60 fps). Every window (2 s) this looks at both and
// steps the pixel ratio down a quarter when either suffers.
//
// A tracking shortfall can also come from outside the app (other programs on
// the CPU), where fewer pixels change nothing and only soften the picture.
// So a step taken for tracking is a trial: if tracking has not improved by
// 10 % (or reached the target) after up to two steps, the resolution goes
// back up and tracking-motivated steps pause for a while.
//
// After a long healthy stretch it tries a quarter up again; a level that
// failed soon after being tried becomes the ceiling for this scene.

export const RESOLUTION_DEFAULTS = {
  windowMs: 2000,
  min: 1,
  step: 0.25,
  slowFrac: 0.1, // render frames over 1.5 vsync, share of the window
  trackFrac: 0.85, // tracking results per camera frame below this: starved
  latencyMs: 45, // capture-to-result above this: starved
  healthyWindows: 10, // this many good windows in a row before trying higher
  improveFrac: 0.1, // a trial must improve tracking this much to be kept
  trialSteps: 2, // steps a trial may take before giving up
  cooldownMs: 30000, // after a useless trial, no tracking-motivated steps this long
};

export class ResolutionGovernor {
  constructor(opts = {}) {
    this.opts = { ...RESOLUTION_DEFAULTS, ...opts };
    this.reset(0, null);
  }

  /** New window from t; tracking = { results, frames } counters (or null). */
  start(t, tracking) {
    this.since = t;
    this.total = 0;
    this.slow = 0;
    this.t0 = tracking ? { results: tracking.results, frames: tracking.frames } : null;
  }

  /** Forget everything learned (a new scene). */
  reset(t, tracking) {
    this.ceiling = Infinity;
    this.lastUp = -Infinity;
    this.healthy = 0;
    this.trial = null; // { from, stage, reason, hz, lat }
    this.blockedUntil = -Infinity;
    this.start(t, tracking);
  }

  frame(dt, vsync) {
    this.total++;
    if (dt > 1.5 * vsync) this.slow++;
  }

  #down(cur) {
    const o = this.opts;
    return Math.max(o.min, Math.round((cur - o.step) / o.step) * o.step);
  }

  /**
   * Call every frame after frame(). Returns null, or the new pixel ratio
   * limit and why.
   * @param {number} t now (ms)
   * @param {object} s { cur: current pixel ratio, cap: highest useful,
   *   tracking: { results, frames, latencyMs } counters, or null when the
   *   camera is not tracking }
   */
  update(t, { cur, cap, tracking }) {
    const o = this.opts;
    if (t - this.since < o.windowMs) return null;
    const secs = (t - this.since) / 1000;
    const slowFrac = this.total ? this.slow / this.total : 0;
    let fps = 0;
    let hz = 0;
    const lat = tracking?.latencyMs ?? 0;
    const measured = !!(tracking && this.t0);
    if (measured) {
      fps = (tracking.frames - this.t0.frames) / secs;
      hz = (tracking.results - this.t0.results) / secs;
    }
    this.start(t, tracking);

    // Late render frames: fewer pixels always help.
    if (slowFrac > o.slowFrac) {
      this.trial = null;
      this.healthy = 0;
      if (cur <= o.min + 1e-3) return null;
      if (t - this.lastUp < 3 * o.windowMs + 1) this.ceiling = cur;
      const next = this.#down(cur);
      return next < cur - 1e-3 ? { ratio: next, why: `${Math.round(slowFrac * 100)} % of frames late` } : null;
    }

    const counts = measured && fps > 10;
    const rateShort = counts && hz < o.trackFrac * fps;
    const latShort = measured && lat > o.latencyMs;

    // A trial under way: did fewer pixels help tracking?
    if (this.trial) {
      const tr = this.trial;
      if (!counts) {
        this.trial = null; // camera stopped: nothing to judge
      } else {
        const improved = tr.reason === 'rate'
          ? hz >= tr.hz * (1 + o.improveFrac) || !rateShort
          : lat <= tr.lat * (1 - o.improveFrac) || !latShort;
        if (improved) {
          this.trial = null; // keep it; still short? a new trial below
        } else if (tr.stage < o.trialSteps && cur > o.min + 1e-3) {
          tr.stage++;
          const next = this.#down(cur);
          return { ratio: next, why: 'still short; one more step' };
        } else {
          this.trial = null;
          this.blockedUntil = t + o.cooldownMs;
          this.healthy = 0;
          return { ratio: tr.from, why: 'lower resolution did not help tracking' };
        }
      }
    }

    const blocked = t < this.blockedUntil;
    if ((rateShort || latShort) && !blocked) {
      this.healthy = 0;
      if (cur <= o.min + 1e-3) return null;
      if (t - this.lastUp < 3 * o.windowMs + 1) this.ceiling = cur;
      const next = this.#down(cur);
      if (next >= cur - 1e-3) return null;
      this.trial = { from: cur, stage: 1, reason: rateShort ? 'rate' : 'latency', hz, lat };
      const why = rateShort ? `tracking ${hz.toFixed(0)} of ${fps.toFixed(0)} camera fps` : `tracking delay ${lat.toFixed(0)} ms`;
      return { ratio: next, why };
    }

    // Healthy (or short for reasons resolution cannot fix): maybe try higher.
    const trackingGood = !measured || ((!counts || hz >= 0.95 * fps) && lat <= 0.85 * o.latencyMs);
    const good = slowFrac < 0.02 && (trackingGood || blocked);
    this.healthy = good ? this.healthy + 1 : 0;
    if (this.healthy >= o.healthyWindows && cur < cap - 1e-3) {
      const next = Math.min(cap, Math.round((cur + o.step) / o.step) * o.step);
      if (next < this.ceiling - 1e-3 && next > cur + 1e-3) {
        this.healthy = 0;
        this.lastUp = t;
        return { ratio: next, why: 'headroom' };
      }
    }
    return null;
  }
}

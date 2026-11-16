// Eye track: filtered, latency-compensated, display-rate eye position.
//
// Samples arrive at the tracking rate (~30 Hz) stamped with the time the camera
// captured them. The renderer asks for the eye position at the moment its frame
// will be on screen (60-120 Hz). In between:
//   1. One Euro filter per axis removes jitter.
//   2. Prediction carries the filtered position forward from the capture time
//      to the display time (pipeline latency + filter lag): constant velocity
//      while the head keeps going, constant deceleration that stops where the
//      head would stop when it is slowing down (otherwise every stop and
//      reversal swings past and snaps back).
//   3. When a new sample changes the prediction, the difference is blended out
//      over about one tracking interval, so 30 Hz updates never show as steps.
//   4. Face lost: decelerate and hold, then ease to a resting viewpoint. On
//      reacquiring, glide to the face. Nothing ever jumps.
//
// That is mode 'predict'. Mode 'follow' (the app's default) replaces steps 2
// and 3 with SmoothFollow (src/tracking/follow.js): a dead-band and a
// critically damped spring, no extrapolation. Everything else (noise meter,
// gaps, face lost and found, eye switches) is shared.
//
// All times are milliseconds on one clock (performance.now()). Positions are
// display coordinates in metres.

import { OneEuro3 } from './one-euro.js';
import { NoiseMeter } from './noise.js';
import { SmoothFollow } from './follow.js';

export const TRACK_DEFAULTS = {
  // 'predict': One Euro + look-ahead with the brake (the first tuning, below).
  // 'follow': SmoothFollow; its options in `follow` (FOLLOW_DEFAULTS).
  mode: 'predict',
  follow: {},
  // Tuned by replaying real landmarker output through tools/core-tune-filter.mjs
  // against ground truth (docs/CORE_NOTES.md): the most responsive setting
  // that still stays steady with twice the synthetic clip's noise.
  filterXY: { minCutoff: 0.5, beta: 32, dCutoff: 1 },
  filterZ: { minCutoff: 0.25, beta: 16, dCutoff: 1 },
  velocityCutoff: 6, // Hz, smoothing of the velocity used for prediction
  // Velocity for prediction: slope of a line fitted to the raw samples of the
  // last velWindowMs (less lag than differentiating the filtered output);
  // 0 = differentiate the filtered output instead.
  velWindowMs: 0,
  // A second, fast velocity from the last two raw samples, low-passed at this
  // cutoff (Hz; 0 = off). Per axis, prediction uses whichever of the smooth
  // and fast velocities is smaller, and none when they disagree in direction:
  // the fast one notices within a frame that the head is slowing down, and
  // jitter rarely pushes both the same way.
  fastVelCutoff: 15,
  fastVelZ: false, // also for depth (noisier)
  cautiousVel: true, // predict with the smaller velocity (false: the smooth one only)
  // Brake: when the head slows down, extrapolate with the measured
  // deceleration (beyond the deadband, times this gain) and stop where the
  // velocity reaches zero. 0 = off (constant velocity).
  //
  // The deceleration comes from a quadratic fitted to the last 4 raw samples
  // (accelSource 'fit', accelFitMs): differentiating the fast velocity was
  // quicker but so noisy that at webcam noise the brake fired at random and
  // steady pans wobbled 4 mm (tools/core-motion.mjs, pan wobble). Quick stops
  // decelerate at 2-6 m/s^2, well above the fit's noise, so a deadband of
  // ~1 m/s^2 (scaled with the measured noise) separates them, and a high gain
  // restores the response beyond it. Tuned with overshoot, moving error and
  // pan wobble scored together (docs/CORE_NOTES.md).
  brakeGain: 16,
  brakeDeadband: 1.1, // m/s^2 at the tuned noise level (noiseRef)
  // The deadband follows the measured noise, down to this share of it in a
  // quiet picture (the fit's noise is proportional to the position noise).
  brakeDeadbandMin: 0.3,
  accelSource: 'fit', // 'fit', or 'fast' (differentiated velocity, see accelFromFast)
  // The fit spans about this long, counted in samples at the measured
  // tracking rate (4 at 30 Hz, 3 at 20 Hz): a fixed time window held too few
  // samples at 20 Hz and the brake went stale.
  accelFitMs: 110,
  accelFitMaxMs: 300, // ignore samples older than this (after a gap)
  accelCutoff: Infinity, // Hz, extra smoothing of the acceleration (none)
  accelFromFast: true, // 'fast' source: differentiate the fast velocity, not the smooth one
  maxLagMs: Infinity, // cap on the filter lag added to the horizon
  // Share of the measured delay to extrapolate over. Tuned on a motion corpus
  // with abrupt stops and reversals (tools/core-motion.mjs, docs/CORE_NOTES.md):
  // full look-ahead swung 3-9 cm past every quick stop.
  predictGain: 0.8,
  predictFullSpeed: 0.03, // m/s at which prediction reaches full strength
  // Sideways and depth fade prediction in separately (depth noise must not
  // switch on sideways prediction), depth at its own speed.
  splitRamp: true,
  predictFullSpeedZ: 0.2,
  // Noise adaptation: per-frame noise above what these settings were tuned
  // at (noiseRef, m) lowers the filter cutoffs and raises the speed at which
  // prediction switches on, in proportion (src/tracking/noise.js).
  adaptNoise: true,
  noiseRef: { xy: 0.00055, z: 0.006 },
  noisePower: 1, // cutoff and ramp scale with (noise / noiseRef) ^ noisePower
  noiseWindow: 45, // samples the noise meter looks at (~1.5 s)
  noiseRiseSeconds: 1, // how fast a rising noise level is believed
  lagInDepth: false, // add the depth filter's lag to the depth horizon
  // Cap on extrapolation (latency + filter lag + a short detection gap);
  // clipping stalls motion, so it covers a 4-frame gap at full delay.
  maxHorizonMs: 300,
  // Spread each correction (a new sample moving the prediction) over this
  // long: longer is calmer on a steady pan and a little later on changes.
  blendMs: 90,
  holdMs: 600, // face lost: hold still this long...
  settleMs: 1400, // ...then ease to rest over this long
  reacquireMs: 300, // glide back onto a face found again: this long...
  reacquireMsPerM: 2500, // ...plus this per metre of distance to cover
  reacquireMaxMs: 900,
  staleMs: 150, // no news for this long (+ maxHorizonMs, display time) counts as lost
  // Detections missing for up to this long after the last good one are
  // missing samples: the track coasts on with its filter and velocity.
  // Longer is a lost face (hold, then settle).
  gapMs: 150,
  jumpM: 0.08, // a sample this far from the prediction is a new track, not motion
  rest: { x: 0, y: 0.02, z: 0.6 },
};

const smooth01 = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const lerp3 = (a, b, s) => v3(a.x + (b.x - a.x) * s, a.y + (b.y - a.y) * s, a.z + (b.z - a.z) * s);
const sub3 = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const add3 = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const scale3 = (a, s) => v3(a.x * s, a.y * s, a.z * s);
const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/**
 * Acceleration (m/s^2, per axis) of a quadratic fitted by least squares to
 * the samples (exact through three), or null with fewer than three.
 */
function quadAccel(pts) {
  if (pts.length < 3) return null;
  const tr = pts.at(-1).t;
  // Normal equations for p = a + b u + c u^2 (u in s, relative to the last sample).
  let s0 = 0; let s1 = 0; let s2 = 0; let s3 = 0; let s4 = 0;
  const r0 = v3(); const r1 = v3(); const r2 = v3();
  for (const h of pts) {
    const u = (h.t - tr) / 1000;
    const u2 = u * u;
    s0 += 1; s1 += u; s2 += u2; s3 += u2 * u; s4 += u2 * u2;
    for (const k of ['x', 'y', 'z']) { r0[k] += h.p[k]; r1[k] += u * h.p[k]; r2[k] += u2 * h.p[k]; }
  }
  // Solve [[s0 s1 s2][s1 s2 s3][s2 s3 s4]] [a b c] = r for c (Cramer's rule).
  const det = s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2);
  if (!(Math.abs(det) > 1e-18)) return null;
  const c = (k) => (s0 * (s2 * r2[k] - r1[k] * s3) - s1 * (s1 * r2[k] - r1[k] * s2) + r0[k] * (s1 * s3 - s2 * s2)) / det;
  return v3(2 * c('x'), 2 * c('y'), 2 * c('z'));
}

/** First-order low-pass blend factor for a cutoff (Hz) over dt (s). */
const lowpass = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
/** The smaller of two velocities if they agree in direction, else zero. */
const cautious = (s, f) => (s * f <= 0 ? 0 : Math.abs(f) < Math.abs(s) ? f : s);

/**
 * Displacement over horizon h (s) from velocity v and acceleration a. Only a
 * deceleration is used, and only up to the moment the velocity reaches zero,
 * so the result always lies between 0 and v h: braking never reverses or
 * extends the extrapolation.
 */
function braked(v, a, h) {
  if (h <= 0 || v * a >= 0) return v * h;
  const he = Math.min(h, -v / a);
  return v * he + 0.5 * a * he * he;
}

/** Least-squares slope (per second) of samples at or after t0. */
function slope(hist, t0) {
  const pts = hist.filter((h) => h.t >= t0 - 1e-6);
  if (pts.length < 2) return v3();
  let tm = 0;
  for (const h of pts) tm += h.t;
  tm /= pts.length;
  const m = v3();
  for (const h of pts) { m.x += h.p.x; m.y += h.p.y; m.z += h.p.z; }
  m.x /= pts.length; m.y /= pts.length; m.z /= pts.length;
  let stt = 0;
  const st = v3();
  for (const h of pts) {
    const dt = (h.t - tm) / 1000;
    stt += dt * dt;
    st.x += dt * (h.p.x - m.x);
    st.y += dt * (h.p.y - m.y);
    st.z += dt * (h.p.z - m.z);
  }
  return stt > 0 ? v3(st.x / stt, st.y / stt, st.z / stt) : v3();
}

function correctionAt(list, t) {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const c of list) {
    const u = (t - c.t0) / c.dur;
    if (u >= 1) continue;
    const k = 1 - smooth01(u);
    x += c.offset.x * k;
    y += c.offset.y * k;
    z += c.offset.z * k;
  }
  return v3(x, y, z);
}

export class EyeTrack {
  constructor(opts = {}) {
    this.opts = { ...TRACK_DEFAULTS, ...opts };
    this.filter = new OneEuro3(this.opts.filterXY, this.opts.filterZ);
    this.follower = new SmoothFollow({ noiseRef: this.opts.noiseRef, ...this.opts.follow });
    // The view's gain on head motion (setGain): samples arrive scaled by it,
    // so every threshold in metres (noise, speed, jumps) scales with it too.
    // x, y and z; xy is the rms of x and y (for the Predict ahead thresholds).
    this.gain = { x: 1, y: 1, xy: 1, z: 1 };
    const ref = this.opts.noiseRef;
    this.noise = new NoiseMeter({ initial: { x: ref.xy, y: ref.xy, z: ref.z }, size: this.opts.noiseWindow, riseSeconds: this.opts.noiseRiseSeconds });
    this.noiseFactor = { xy: 1, z: 1 };
    this.state = 'resting'; // 'tracking' | 'holding' | 'settling' | 'resting'
    this.anchor = null; // { t, p, v, lag }: latest filtered sample
    this.prevFiltered = null;
    this.vel = v3();
    this.velFast = null;
    this.acc = v3();
    this.hist = []; // recent raw samples { t, p }
    // Corrections being blended out: each { t0, offset, dur }. Output is the
    // prediction plus the sum of what is left of each.
    this.corrections = [];
    this.out = { ...this.opts.rest };
    this.outT = null;
    this.outVel = v3();
    this.lostAt = null;
    this.holdFrom = null; // { t, p, v }
    this.settleFrom = null; // { t, p }
    this.pending = null; // { dur, fromAnchor }: a new sample not yet shown
    this.interval = 33; // measured tracking interval (ms)
    this.lastPushT = null;
  }

  configure(opts) {
    // Switching modes while tracking: glide from what is on screen.
    if (opts.mode && opts.mode !== this.opts.mode && this.state === 'tracking') this.pending = { dur: this.opts.reacquireMs, fromAnchor: null };
    Object.assign(this.opts, opts);
    this.filter.configure(this.opts.filterXY, this.opts.filterZ);
    this.follower.configure({ noiseRef: this.opts.noiseRef, ...this.opts.follow });
  }

  /** The view's gain on head motion ({x, y, z}, or {xy, z}); see SmoothFollow.gain. */
  setGain(g) {
    const x = g.x ?? g.xy;
    const y = g.y ?? g.xy;
    this.gain = { x, y, xy: Math.sqrt((x * x + y * y) / 2), z: g.z };
    this.follower.gain = { ...this.gain };
  }

  get following() {
    return this.opts.mode === 'follow';
  }

  setRest(p) {
    this.opts.rest = { ...p };
  }

  /**
   * A tracked eye position, captured by the camera at time t.
   * @param {{blendMs?:number, offset?:{x,y,z}}} [opts] blendMs: spread this
   *   update's change over longer (used when the viewpoint switches eyes on
   *   purpose); offset: the part of p that is head-turn steering, already
   *   free of noise, which Smooth follow passes around its dead-band
   *   (SmoothFollow.push). The noise meter measures p without it.
   */
  push(t, p, opts = {}) {
    const off = opts.offset || null;
    if (this.lastPushT !== null) {
      const dt = t - this.lastPushT;
      if (dt > 0 && dt < 200) this.interval += 0.1 * (dt - this.interval);
    }
    this.lastPushT = t;

    const fresh = this.state !== 'tracking' || !this.anchor;
    const follow = this.following;
    const predicted = !this.anchor ? null : follow && this.follower.ready ? this.follower.target : this.#predict(this.anchor, t);
    const jumped = !fresh && dist3(predicted, p) > this.opts.jumpM * Math.max(1, this.gain.x, this.gain.y, this.gain.z);
    // The anchor behind the last rendered frame (several pushes may land
    // between two frames; continuity is with what was actually shown).
    const shownAnchor = this.pending ? this.pending.fromAnchor : this.anchor;
    if (fresh || jumped) {
      this.noise.break();
      this.filter.reset();
      this.prevFiltered = null;
      this.vel = v3();
      this.velFast = null;
      this.acc = v3();
      this.hist = [];
    }
    const o = this.opts;
    this.noise.add(t, off ? v3(p.x - off.x, p.y - off.y, p.z - off.z) : p);
    if (o.adaptNoise) {
      const k = o.noisePower;
      const fxy = Math.max(1, this.noise.xy / (o.noiseRef.xy * this.gain.xy)) ** k;
      const fz = Math.max(1, this.noise.z / (o.noiseRef.z * this.gain.z)) ** k;
      this.noiseFactor = { xy: fxy, z: fz };
      const calm = (c, f0) => ({ ...c, minCutoff: c.minCutoff / f0, beta: c.beta / f0 });
      this.filter.configure(calm(o.filterXY, fxy), calm(o.filterZ, fz));
    } else {
      this.noiseFactor = { xy: 1, z: 1 };
    }
    const f = this.filter.filter(p, t / 1000);
    const prevRaw = this.hist.at(-1);
    this.hist.push({ t, p: { ...p } });
    const keep = Math.max(o.velWindowMs, 100) + 1;
    const fitN = Math.min(6, Math.max(3, Math.round(o.accelFitMs / this.interval) + 1));
    const keepN = Math.max(2, o.accelSource === 'fit' ? fitN : 0);
    while (this.hist.length > keepN && t - this.hist[0].t > keep) this.hist.shift();
    if (this.prevFiltered) {
      const dt = (t - this.prevFiltered.t) / 1000;
      if (dt > 1e-4) {
        const raw = o.velWindowMs > 0 ? slope(this.hist, t - o.velWindowMs) : scale3(sub3(f, this.prevFiltered.p), 1 / dt);
        const prevVel = this.vel;
        this.vel = add3(this.vel, scale3(sub3(raw, this.vel), lowpass(o.velocityCutoff, dt)));
        const prevFast = this.velFast;
        if (o.fastVelCutoff > 0 && prevRaw && t - prevRaw.t > 0.1) {
          const rawFast = scale3(sub3(p, prevRaw.p), 1000 / (t - prevRaw.t));
          this.velFast = prevFast ? add3(prevFast, scale3(sub3(rawFast, prevFast), lowpass(o.fastVelCutoff, dt))) : rawFast;
        }
        if (o.brakeGain > 0) {
          let rawAcc;
          if (o.accelSource === 'fit') {
            rawAcc = quadAccel(this.hist.slice(-fitN).filter((h) => t - h.t <= o.accelFitMaxMs)) ?? this.acc;
          } else {
            const useFast = o.accelFromFast && prevFast && this.velFast;
            rawAcc = useFast ? scale3(sub3(this.velFast, prevFast), 1 / dt) : scale3(sub3(this.vel, prevVel), 1 / dt);
          }
          this.acc = add3(this.acc, scale3(sub3(rawAcc, this.acc), lowpass(o.accelCutoff, dt)));
        }
      }
    }
    this.prevFiltered = { t, p: f };
    const deadband = o.brakeDeadband * this.gain.xy * Math.max(o.brakeDeadbandMin, this.noise.xy / (o.noiseRef.xy * this.gain.xy));
    this.anchor = { t, p: f, v: this.#predictionVelocity(), acc: { ...this.acc }, lag: this.filter.lags, noise: { ...this.noiseFactor }, deadband, gain: { ...this.gain } };
    if (fresh || jumped) this.follower.reset(p, off);
    const lv = this.noise.level;
    this.follower.push(t, p, { noise: { x: lv.x, y: lv.y, xy: this.noise.xy, z: this.noise.z }, interval: this.interval, offset: off });
    if (fresh || jumped) {
      this.pending = { dur: this.opts.reacquireMs, fromAnchor: null };
    } else if (follow) {
      // The spring is continuous between samples: nothing to blend.
      this.pending = null;
    } else {
      const dur = opts.blendMs ?? Math.max(this.opts.blendMs, 0.9 * this.interval);
      this.pending = { dur, fromAnchor: shownAnchor };
    }
    this.state = 'tracking';
    this.lostAt = null;
  }

  #predictionVelocity() {
    const v = this.vel;
    const q = this.velFast;
    if (!(this.opts.fastVelCutoff > 0) || !q || !this.opts.cautiousVel) return { ...v };
    return v3(cautious(v.x, q.x), cautious(v.y, q.y), this.opts.fastVelZ ? cautious(v.z, q.z) : v.z);
  }

  /** The tracker processed a frame (captured at t) and found no face. */
  miss(t) {
    if (this.state !== 'tracking') return;
    if (this.lastPushT === null || t - this.lastPushT > this.opts.gapMs) this.#startHold(t);
  }

  /**
   * The point being tracked moves by d on purpose (switching between eyes, or
   * between one eye and both): move the whole track with it, velocity and
   * acceleration kept, and glide the view across over durMs. Fed in as a
   * sample instead, the step reads as a 2 m/s lunge that the predictor first
   * extrapolates and then brakes, swinging the view the wrong way.
   * @param {{x,y,z}} d metres @param {number} [durMs]
   * @param {{x,y,z}} [offset] the head-turn offset (push) from now on, when
   *   the move changed it (a re-centre or a change of view setting)
   */
  shift(d, durMs = 280, offset = null) {
    if (this.state !== 'tracking' || !this.anchor) return; // the next sample glides in anyway
    const add = (p) => { p.x += d.x; p.y += d.y; p.z += d.z; };
    for (const [f, k] of [[this.filter.fx, 'x'], [this.filter.fy, 'y'], [this.filter.fz, 'z']]) {
      if (f.x !== null) f.x += d[k];
    }
    // Each point once: the anchor and prevFiltered share theirs.
    const pts = new Set([this.prevFiltered?.p, this.anchor.p, this.pending?.fromAnchor?.p, ...this.hist.map((h) => h.p)]);
    for (const q of pts) if (q) add(q);
    this.follower.shift(d, offset);
    this.noise.break();
    // The view stays where it was and glides over.
    this.corrections.push({ t0: this.outT ?? this.anchor.t, offset: v3(-d.x, -d.y, -d.z), dur: durMs });
  }

  /** The face is gone for sure (camera paused, switched or restarting). */
  lose(t) {
    if (this.state === 'tracking') this.#startHold(t);
  }

  #startHold(t) {
    this.state = 'holding';
    this.lostAt = t;
    this.holdFrom = { t: this.outT ?? t, p: { ...this.out }, v: { ...this.outVel } };
    this.corrections = [];
    this.pending = null;
  }

  #predict(a, t) {
    // Below a few cm/s there is little trend to extrapolate, only jitter to
    // amplify: fade prediction in with speed (REFERENCES 4.2), later when the
    // measured noise is higher.
    const o = this.opts;
    const fade = (speed, full) => {
      const r = Math.min(1, speed / full);
      return o.predictGain * r * r * (3 - 2 * r);
    };
    const n0 = a.noise || { xy: 1, z: 1 };
    const g = a.gain || { xy: 1, z: 1 };
    const n = { xy: n0.xy * g.xy, z: n0.z * g.z }; // speeds in view space
    let gxy;
    let gz;
    if (o.splitRamp) {
      gxy = fade(Math.hypot(a.v.x, a.v.y), o.predictFullSpeed * n.xy);
      gz = fade(Math.abs(a.v.z), o.predictFullSpeedZ * n.z);
    } else {
      gxy = fade(Math.hypot(a.v.x, a.v.y, a.v.z), o.predictFullSpeed * n.xy);
      gz = gxy;
    }
    const maxH = o.maxHorizonMs / 1000;
    const h = (t - a.t) / 1000;
    const lagCap = o.maxLagMs / 1000;
    const hx = Math.min(Math.max(h + Math.min(a.lag.x, lagCap), 0), maxH) * gxy;
    const hy = Math.min(Math.max(h + Math.min(a.lag.y, lagCap), 0), maxH) * gxy;
    // Depth: never extrapolate over the filter's own lag. Depth is the noisiest
    // axis and its filter the slowest; a wrong depth mostly scales the scene,
    // which reads far less than a sideways error, so trade lag for calm here.
    const hz = Math.min(Math.max(h + (o.lagInDepth ? Math.min(a.lag.z, lagCap) : 0), 0), maxH) * gz;
    const k = o.brakeGain;
    const d0 = a.deadband ?? o.brakeDeadband;
    const dec = (acc) => (Math.abs(acc) <= d0 ? 0 : (acc - Math.sign(acc) * d0) * k);
    return v3(
      a.p.x + braked(a.v.x, dec(a.acc.x), hx),
      a.p.y + braked(a.v.y, dec(a.acc.y), hy),
      a.p.z + braked(a.v.z, dec(a.acc.z), hz),
    );
  }

  /**
   * Eye position for a frame that will be seen at time t.
   * @returns {{x,y,z}} display coordinates (metres)
   */
  sample(t) {
    const o = this.opts;
    if (this.state === 'tracking' && this.anchor && t - this.anchor.t > o.staleMs + o.maxHorizonMs) {
      this.#startHold(t);
    }
    let p;
    if (this.state === 'tracking') {
      const raw = this.following ? this.follower.at(t) : this.#predict(this.anchor, t);
      if (this.pending) {
        // The prediction just changed under us: continue from what the old
        // prediction shows now and blend the difference away.
        let offset;
        let dur = this.pending.dur;
        if (this.pending.fromAnchor) {
          offset = sub3(this.#predict(this.pending.fromAnchor, t), raw);
        } else {
          this.corrections = [];
          offset = this.outT !== null ? sub3(this.out, raw) : v3();
          const d = Math.hypot(offset.x, offset.y, offset.z);
          dur = Math.min(o.reacquireMaxMs, o.reacquireMs + d * o.reacquireMsPerM);
        }
        this.corrections.push({ t0: t, offset, dur });
        this.pending = null;
      }
      p = add3(raw, correctionAt(this.corrections, t));
      this.corrections = this.corrections.filter((c) => t - c.t0 < c.dur);
    } else if (this.state === 'holding') {
      // Coast to a stop (80 ms), then stay put.
      const h = this.holdFrom;
      const tau = 0.08;
      const dt = Math.max(0, (t - h.t) / 1000);
      p = add3(h.p, scale3(h.v, tau * (1 - Math.exp(-dt / tau))));
      if (t - this.lostAt > o.holdMs) {
        this.state = 'settling';
        this.settleFrom = { t, p: { ...p } };
      }
    } else if (this.state === 'settling') {
      const s = this.settleFrom;
      const u = (t - s.t) / o.settleMs;
      p = lerp3(s.p, o.rest, smooth01(u));
      if (u >= 1) this.state = 'resting';
    } else {
      p = { ...o.rest };
    }
    if (this.outT !== null && t > this.outT) {
      const dt = (t - this.outT) / 1000;
      this.outVel = scale3(sub3(p, this.out), 1 / dt);
    }
    this.out = p;
    this.outT = t;
    return p;
  }
}

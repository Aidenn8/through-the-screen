// Smooth follow: the rendered eye follows the tracked eye like a camera on a
// soft, well-damped mount, instead of chasing (and extrapolating) every
// sample. Three stages, per axis:
//
//   1. Dead-band. A seated head is never still: it sways a few millimetres
//      (0.1-1 Hz) and makes small corrections. The target only moves once the
//      tracked eye leaves a small circle around it (radius `bandMm`, x and y
//      together; depth has its own, wider band), and then only by the amount
//      it left by, so a deliberate lean comes through whole while the sway
//      inside the circle does not. The band widens with the measured noise.
//      The target re-centres on the eye: quickly for a moment after a
//      deliberate move (`settleMs`: the lean's last few millimetres arrive
//      with it), very slowly otherwise (`recentreMs`: sway is not followed).
//   2. Pre-stage. Samples arrive 15-30 times a second and the screen draws
//      60-120: a first-order low-pass over about half a tracking interval
//      turns each sample's step into a ramp.
//   3. Spring. A critically damped spring (time constant tau) pulls the
//      rendered eye toward that. Integrated exactly on every render frame,
//      it has no overshoot by construction (its impulse response is never
//      negative, so it never passes a target that has stopped), and its
//      position and velocity are continuous: no steps between samples.
//
// tau grows with the measured noise and is at least `minTauIntervals`
// tracking intervals, so a dim room or a 15 fps camera makes the view
// calmer, not jumpier.
//
// Optional look-ahead (`lookAhead`, off by default) adds the spring's own
// velocity times part of the delay, but never more than the distance still
// left to the target: it can only take back the spring's own lag, never pass
// what was measured, so it cannot swing past a stop.
//
// Times in ms (one clock); positions in metres.

export const FOLLOW_DEFAULTS = {
  tauMs: 30, // spring time constant, sideways, at the reference noise
  tauZMs: 150, // depth: the noisiest axis, and depth errors only scale the scene
  minTauIntervals: 0.6, // tau at least this many tracking intervals (15 fps: 40 ms)
  noiseTauPower: 0.5, // tau scales with (noise / noiseRef) ^ this, above the reference
  maxTauScale: 3, // ...up to this many times
  preIntervals: 0.5, // pre-stage time constant, in tracking intervals
  interpolate: true, // render the target interpolated at a fixed delay instead
  bandMm: 6, // dead-band radius, sideways (in head millimetres: scaled by the view gain)
  bandZMm: 8, // depth
  bandNoise: 4, // band at least this many times the measured noise (std), sideways
  bandNoiseZ: 3.5, // depth (its noise is ~10x larger; at 2.5 it kicked the band every few seconds)
  recentreMs: 8000, // the target creeps onto the eye with this time constant...
  settleMs: 400, // ...or this one, for settleHoldMs after a deliberate move
  settleHoldMs: 1500,
  moveMm: 12, // a deliberate move: the band dragged this far (head mm) within about 0.5 s
  lookAhead: 0, // share of (display time - sample time) to extrapolate, capped
  maxLookAheadMs: 120,
  noiseRef: { xy: 0.00055, z: 0.006 },
};

const AX = ['x', 'y', 'z'];
const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });

/** One exact step of a critically damped spring toward a fixed target g. */
function springStep(x, v, g, w, h) {
  const y0 = x - g;
  const c = v + w * y0;
  const e = Math.exp(-w * h);
  return [g + (y0 + c * h) * e, (v - w * c * h) * e];
}

export class SmoothFollow {
  constructor(opts = {}) {
    this.o = { ...FOLLOW_DEFAULTS, ...opts };
    this.ready = false;
    this.delay = null; // ms, display time - sensor time the target is rendered at
    this.tau = { xy: this.o.tauMs, z: this.o.tauZMs }; // ms, current
    // Current band: xy in head metres (a circle in head millimetres is an
    // ellipse on screen when up and down get more gain), z in view metres.
    this.band = { xy: this.o.bandMm / 1000, z: this.o.bandZMm / 1000 };
    this.interval = 33;
    // The view's gain on head motion (src/tracking/view-map.js), per axis:
    // samples arrive already scaled, so the fixed band and the deliberate-move
    // threshold scale with it (noise is measured on the scaled samples).
    // { x, y, z }, or { xy, z } for the same gain sideways and up and down.
    this.gain = { x: 1, y: 1, z: 1 };
  }

  /** Sideways and up-and-down gains. */
  #gxy() {
    const g = this.gain;
    return { x: g.x ?? g.xy ?? 1, y: g.y ?? g.xy ?? 1 };
  }

  configure(opts) {
    Object.assign(this.o, opts);
  }

  /** Start at p, at rest (a new track); `off` is the part of p that bypasses the dead-band (push). */
  reset(p, off = null) {
    this.off = off ? { x: off.x, y: off.y, z: off.z } : v3();
    this.A = { x: p.x - this.off.x, y: p.y - this.off.y, z: p.z - this.off.z }; // dead-banded target (head part)
    this.T = { ...p }; // pre-stage
    this.x = { ...p }; // spring position
    this.v = v3(); // spring velocity (m/s)
    this.out = { ...p };
    this.tLast = null; // display time integrated to
    this.tSample = null; // sensor time of the last sample
    this.noiseHeld = null;
    this.buf = []; // recent targets { t, A } by sensor time, for interpolation
    this.peakAge = null; // oldest the newest sample got before the next arrived
    this.moved = 0; // recent drag of the band (m), decaying over 0.5 s
    // When it last added up to a deliberate move. A new track counts as one:
    // its first sample is as noisy as any, so settle onto the eye quickly.
    this.tMoved = null;
    this.ready = true;
  }

  /**
   * Move everything by d (the tracked point changed on purpose). `off`: the
   * offset (push) from now on, when the move changed it (a re-centre drops
   * the head-turn steering): the target moves by d either way, and the head
   * part is what is left.
   */
  shift(d, off = null) {
    if (!this.ready) return;
    for (const q of [this.A, this.T, this.x, this.out, ...this.buf.map((b) => b.A)]) for (const k of AX) q[k] += d[k];
    if (off) {
      for (const k of AX) this.A[k] -= off[k] - this.off[k];
      this.off = { x: off.x, y: off.y, z: off.z };
    }
  }

  /** The target the spring follows: the dead-banded head part plus the offset. */
  get target() {
    return { x: this.A.x + this.off.x, y: this.A.y + this.off.y, z: this.A.z + this.off.z };
  }

  /**
   * A tracked sample p (raw), captured at t (ms).
   * @param {{noise?:{x?:number,y?:number,xy:number,z:number}, interval?:number, offset?:{x,y,z}}} [info]
   *   measured per-frame noise (m, view space: per axis, or xy as the rms of
   *   x and y; of the head part) and tracking interval (ms). `offset` is a
   *   part of p that skips the dead-band and goes straight to the
   *   interpolation and spring: the head-turn steering, which has its own
   *   hold band (src/tracking/head-turn.js) and no sway to hide. The band is
   *   for the head's position.
   */
  push(t, p0, { noise, interval, offset } = {}) {
    const off = offset && Number.isFinite(offset.x) && Number.isFinite(offset.y) && Number.isFinite(offset.z) ? offset : v3();
    if (!this.ready) this.reset(p0, off);
    this.off = { x: off.x, y: off.y, z: off.z };
    const p = { x: p0.x - off.x, y: p0.y - off.y, z: p0.z - off.z };
    const o = this.o;
    if (interval > 0) this.interval = interval;
    const g = this.#gxy();
    const gz = this.gain.z ?? 1;
    // Noise judged in head millimetres: the gain scales signal and noise
    // alike. Sideways and up-and-down may have different gains.
    const n0 = noise || { xy: o.noiseRef.xy * Math.sqrt((g.x ** 2 + g.y ** 2) / 2), z: o.noiseRef.z * gz };
    const n = {
      xy: Number.isFinite(n0.x) && Number.isFinite(n0.y)
        ? Math.sqrt(((n0.x / g.x) ** 2 + (n0.y / g.y) ** 2) / 2)
        : n0.xy / Math.sqrt((g.x ** 2 + g.y ** 2) / 2),
      z: n0.z / gz,
    };
    const scale = (r) => Math.min(o.maxTauScale, Math.max(1, r) ** o.noiseTauPower);
    const floor = o.minTauIntervals * this.interval;
    this.tau = {
      xy: Math.max(o.tauMs * scale(n.xy / o.noiseRef.xy), floor),
      z: Math.max(o.tauZMs * scale(n.z / o.noiseRef.z), floor),
    };
    const dt = this.tSample === null ? this.interval : Math.min(Math.max(t - this.tSample, 0), 250);
    // The band uses the noise level held for a while (up at once, down over
    // 5 s): the meter dips below the real level for moments, and a band
    // that shrinks with it gets kicked by the next noisy sample.
    const fall = 1 - Math.exp(-dt / 5000);
    const held = this.noiseHeld || n;
    this.noiseHeld = {
      xy: n.xy > held.xy ? n.xy : held.xy + (n.xy - held.xy) * fall,
      z: n.z > held.z ? n.z : held.z + (n.z - held.z) * fall,
    };
    // Head metres sideways (x and y divided by their gains), view metres in depth.
    this.band = {
      xy: Math.max(o.bandMm / 1000, o.bandNoise * this.noiseHeld.xy),
      z: Math.max(o.bandZMm / 1000, o.bandNoiseZ * this.noiseHeld.z) * gz,
    };
    // Re-centre a little toward the sample: a slow low-pass of the eye,
    // quicker just after a deliberate move.
    if (this.tMoved === null) this.tMoved = t;
    const tau = t - this.tMoved < o.settleHoldMs ? o.settleMs : o.recentreMs;
    const k = tau > 0 ? 1 - Math.exp(-dt / tau) : 0;
    for (const a of AX) this.A[a] += (p[a] - this.A[a]) * k;
    // Dead-band: x and y as one circle in head millimetres (an ellipse on
    // screen when the gains differ), depth on its own.
    const dx = p.x - this.A.x;
    const dy = p.y - this.A.y;
    const r = Math.hypot(dx / g.x, dy / g.y);
    let drag = 0;
    if (r > this.band.xy) {
      const s = 1 - this.band.xy / r;
      this.A.x += dx * s;
      this.A.y += dy * s;
      drag = r - this.band.xy;
    }
    this.moved = this.moved * Math.exp(-dt / 500) + drag;
    if (this.moved > o.moveMm / 1000) this.tMoved = t;
    const dz = p.z - this.A.z;
    if (Math.abs(dz) > this.band.z) this.A.z += dz - Math.sign(dz) * this.band.z;
    // How far behind the screen a sample can be by the time the next one
    // arrives: the delay that interpolation renders at (up quickly, down
    // slowly; a gap is a missing sample, not a slower pipeline).
    if (this.peakAge !== null && this.tSample !== null && t - this.tSample < 1.7 * this.interval) {
      const a = this.peakAge;
      this.delay = this.delay === null ? a : this.delay + (a - this.delay) * (a > this.delay ? 0.5 : 0.03);
    }
    this.peakAge = null;
    this.buf.push({ t, A: this.target });
    if (this.buf.length > 12) this.buf.shift();
    this.tSample = t;
  }

  /** The dead-banded target at sensor time tq, interpolated between samples (holds past the newest). */
  #targetAt(tq, a) {
    const b = this.buf;
    if (tq >= b[b.length - 1].t) return b[b.length - 1].A[a];
    for (let i = b.length - 2; i >= 0; i--) {
      if (tq >= b[i].t) {
        const u = (tq - b[i].t) / Math.max(1e-6, b[i + 1].t - b[i].t);
        return b[i].A[a] + (b[i + 1].A[a] - b[i].A[a]) * u;
      }
    }
    return b[0].A[a];
  }

  /** The rendered eye for a frame seen at time t (ms). */
  at(t) {
    if (!this.ready) return null;
    if (this.tLast === null) this.tLast = t;
    if (this.tSample !== null) this.peakAge = Math.max(this.peakAge ?? 0, t - this.tSample);
    let dt = (t - this.tLast) / 1000;
    if (dt > 0) {
      this.tLast = t;
      dt = Math.min(dt, 0.25); // after a stall, don't integrate a long jump in one go
      const n = Math.max(1, Math.ceil(dt / 0.006));
      const h = dt / n;
      const interp = this.o.interpolate && this.delay !== null && this.buf.length > 1;
      const pre = Math.max(1, this.o.preIntervals * this.interval) / 1000;
      const kPre = 1 - Math.exp(-h / pre);
      for (const a of AX) {
        const w = 1000 / (a === 'z' ? this.tau.z : this.tau.xy);
        let x = this.x[a];
        let v = this.v[a];
        let T = this.T[a];
        for (let i = 0; i < n; i++) {
          if (interp) {
            // The target as it was `delay` ago, interpolated in sensor time.
            T = this.#targetAt(t - dt * 1000 + (i + 0.5) * h * 1000 - this.delay, a);
            [x, v] = springStep(x, v, T, w, h);
            continue;
          }
          // Spring toward the pre-stage's mid-step value, then advance it.
          const T1 = T + (this.A[a] + this.off[a] - T) * kPre;
          [x, v] = springStep(x, v, 0.5 * (T + T1), w, h);
          T = T1;
        }
        this.x[a] = x;
        this.v[a] = v;
        this.T[a] = T;
      }
      this.out = this.#lookAhead(t);
    }
    return { ...this.out };
  }

  #lookAhead(t) {
    const o = this.o;
    if (!(o.lookAhead > 0) || this.tSample === null) return { ...this.x };
    const hz = Math.min(Math.max(t - this.tSample, 0), o.maxLookAheadMs) * o.lookAhead / 1000;
    const p = {};
    for (const a of AX) {
      const D = this.T[a] - this.x[a]; // what is left to the target
      const L = this.v[a] * hz;
      // A soft minimum of L and D: about L when small, never more than D.
      p[a] = this.x[a] + (L * D > 0 ? D * (1 - Math.exp(-L / D)) : 0);
    }
    return p;
  }
}

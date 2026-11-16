// One Euro filter (Casiez, Roussel, Vogel, CHI 2012): a low-pass filter whose
// cutoff rises with speed. Still -> heavy smoothing (no jitter); moving -> light
// smoothing (little lag).
//
//   cutoff = minCutoff + beta * |dx/dt|
//
// Units: cutoffs in Hz; beta in Hz per (unit / s) of the signal. Here signals
// are metres, so beta is Hz per (m/s).

function alpha(cutoff, dt) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuro {
  constructor({ minCutoff = 1, beta = 0, dCutoff = 1 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }

  reset() {
    this.x = null; // filtered value
    this.dx = 0; // filtered derivative (units / s)
    this.t = null; // seconds
    this.cutoff = this.minCutoff;
  }

  /** @param {number} value raw sample @param {number} t time in seconds */
  filter(value, t) {
    if (this.x === null || this.t === null) {
      this.x = value;
      this.dx = 0;
      this.t = t;
      this.cutoff = this.minCutoff;
      return value;
    }
    const dt = t - this.t;
    if (!(dt > 1e-6)) return this.x;
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.dCutoff, dt) * (rawDx - this.dx);
    this.cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(this.cutoff, dt) * (value - this.x);
    this.t = t;
    return this.x;
  }

  /** Steady-state lag (s) of the filter on a ramp at the current cutoff. */
  get lag() {
    return 1 / (2 * Math.PI * this.cutoff);
  }
}

/**
 * One Euro per axis for a 3D point. x and y share settings; z (depth, the
 * noisiest axis) has its own.
 */
export class OneEuro3 {
  constructor(xy, z = xy) {
    this.fx = new OneEuro(xy);
    this.fy = new OneEuro(xy);
    this.fz = new OneEuro(z);
  }

  configure(xy, z = xy) {
    for (const f of [this.fx, this.fy]) Object.assign(f, pick(xy));
    Object.assign(this.fz, pick(z));
  }

  reset() {
    this.fx.reset();
    this.fy.reset();
    this.fz.reset();
  }

  filter(p, t) {
    return { x: this.fx.filter(p.x, t), y: this.fy.filter(p.y, t), z: this.fz.filter(p.z, t) };
  }

  get velocity() {
    return { x: this.fx.dx, y: this.fy.dx, z: this.fz.dx };
  }

  get lags() {
    return { x: this.fx.lag, y: this.fy.lag, z: this.fz.lag };
  }
}

function pick(o) {
  const r = {};
  for (const k of ['minCutoff', 'beta', 'dCutoff']) if (o[k] !== undefined) r[k] = o[k];
  return r;
}

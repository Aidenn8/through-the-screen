// How noisy is the eye point right now? Webcam noise grows a lot with
// distance and in dim light (review: 0.12 / 0.35 / 2.2 mm per frame at 60 cm,
// 1.0 / 2.7 / 8.0 mm at 95 cm), and filtering and prediction tuned for one
// level shimmer at the other.
//
// Estimate per axis from the third difference of consecutive raw samples,
// d = p[k] - 3 p[k-1] + 3 p[k-2] - p[k-3]: for white noise of std s it has
// std s sqrt(20), while smooth head motion only adds jerk x dt^3 (a 0.4 Hz
// sway: 0.08 mm; the second difference would add 0.9 mm). Quick leans still
// add some, so use a low percentile over a few seconds (motion only ever
// inflates it), and let the level rise slowly and fall quickly.

const Q = 0.25; // percentile of |d| used
const Z_Q = 0.3186; // that percentile of |N(0,1)|
const GAIN = Math.sqrt(20); // std of the third difference of unit white noise

export class NoiseMeter {
  /**
   * @param {object} o
   * @param {{x:number,y:number,z:number}} o.initial level to assume until measured (m)
   * @param {number} [o.size] samples kept per axis (~3 s at 30 Hz)
   * @param {number} [o.riseSeconds] time constant of a rising level
   */
  constructor({ initial, size = 90, riseSeconds = 3, fallSeconds = 0.5 } = {}) {
    this.size = size;
    this.riseSeconds = riseSeconds;
    this.fallSeconds = fallSeconds;
    this.level = { ...initial };
    this.d = { x: [], y: [], z: [] };
    this.last = [];
    this.t = null;
  }

  /** A new track (face found again): the next sample does not follow the last. */
  break() {
    this.last = [];
  }

  /** @param {number} t ms @param {{x,y,z}} p raw sample (m) */
  add(t, p) {
    this.last.push({ t, p });
    if (this.last.length > 4) this.last.shift();
    if (this.last.length < 4) return;
    const [a, b, c, d] = this.last;
    const gaps = [b.t - a.t, c.t - b.t, d.t - c.t];
    // Only evenly spaced runs (a skipped frame would read as noise), from
    // 60 fps down to a camera that slows to 15 fps or less in a dim room.
    const lo = Math.min(...gaps);
    const hi = Math.max(...gaps);
    if (!(lo > 15 && hi < 110 && hi - lo < 0.25 * hi)) return;
    for (const k of ['x', 'y', 'z']) {
      const arr = this.d[k];
      arr.push(Math.abs(d.p[k] - 3 * c.p[k] + 3 * b.p[k] - a.p[k]));
      if (arr.length > this.size) arr.shift();
    }
    if (this.d.x.length < 30) return;
    const dt = this.t === null ? 0 : Math.max(0, (t - this.t) / 1000);
    this.t = t;
    const up = 1 - Math.exp(-dt / this.riseSeconds);
    const down = 1 - Math.exp(-dt / this.fallSeconds);
    for (const ax of ['x', 'y', 'z']) {
      const s = [...this.d[ax]].sort((u, v) => u - v);
      const est = s[Math.floor(Q * (s.length - 1))] / (Z_Q * GAIN);
      const cur = this.level[ax];
      this.level[ax] = cur + (est - cur) * (est < cur ? down : up);
    }
  }

  /** Lateral noise (m): rms of x and y. */
  get xy() {
    return Math.sqrt((this.level.x ** 2 + this.level.y ** 2) / 2);
  }

  get z() {
    return this.level.z;
  }
}

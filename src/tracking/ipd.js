// Personal eye spacing from iris size.
//
// Per frame, depth from eye spacing (IPD) is precise but biased by how far this
// viewer's IPD is from the setting (population SD ~3.5 mm, 5.5 %). Depth from
// the visible iris (11.7 +- 0.5 mm across people) is noisy per frame but biased
// less. Their ratio is independent of the camera's focal length:
//
//   implied IPD = IPD used * (iris distance / IPD distance)
//
// A running median of that ratio over a few seconds removes the noise; blending
// it with the setting (unless the viewer set their IPD by hand) removes most of
// the per-person bias without adding any per-frame jitter.

export class IpdEstimator {
  constructor({ size = 150, weight = 0.6, fullAfter = 90 } = {}) {
    this.size = size;
    this.weight = weight; // trust in the iris estimate once warmed up
    this.fullAfter = fullAfter; // samples until that trust is reached
    this.samples = [];
    this.total = 0;
    this.cached = null;
  }

  reset() {
    this.samples = [];
    this.total = 0;
    this.cached = null;
  }

  /**
   * @param {{irisDistance:number|null, distance:number, sinYaw:number}} sol
   * @param {number} ipdUsed far IPD the solve used (m)
   */
  add(sol, ipdUsed) {
    if (!sol.irisDistance || Math.abs(sol.sinYaw) > 0.4) return;
    if (sol.distance < 0.25 || sol.distance > 1.3) return;
    const implied = ipdUsed * (sol.irisDistance / sol.distance);
    if (!(implied > 0.045 && implied < 0.085)) return;
    this.samples.push(implied);
    if (this.samples.length > this.size) this.samples.shift();
    this.total++;
    this.cached = null;
  }

  /**
   * Start from an earlier measurement (m), as if it had just been made with
   * full confidence; new samples move the median from there.
   */
  seed(ipd, n = this.fullAfter) {
    if (!(ipd > 0.045 && ipd < 0.085)) return;
    this.samples = new Array(Math.min(n, this.size)).fill(ipd);
    this.total = this.samples.length;
    this.cached = null;
  }

  /** Median of recent implied IPDs (m), or null before there is enough data. */
  get measured() {
    if (this.samples.length < 15) return null;
    if (this.cached === null) {
      const s = [...this.samples].sort((a, b) => a - b);
      const m = s.length >> 1;
      this.cached = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }
    return this.cached;
  }

  /** IPD to solve with (m). */
  fused(settingIpd, manual) {
    const m = this.measured;
    if (manual || m === null) return settingIpd;
    const w = this.weight * Math.min(1, this.samples.length / this.fullAfter);
    return settingIpd + w * (m - settingIpd);
  }
}

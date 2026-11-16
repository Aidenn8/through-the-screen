// Mouse or trackpad stands in for the head when there is no camera. The
// pointer's place on the display becomes a viewpoint that drifts toward it
// like a head would (critically damped spring), at a fixed viewing distance.

export class MouseEye {
  constructor({ distance = 0.6, reach = 1.4 } = {}) {
    this.distance = distance;
    this.reach = reach; // how far the eye goes relative to the pointer's offset
    this.target = null; // display coords
    this.pos = null;
    this.vel = { x: 0, y: 0 };
    this.t = null;
    this.rest = { x: 0, y: 0.02, z: distance };
  }

  /**
   * @param {number} px pointer x in CSS px (client coords)
   * @param {number} py pointer y in CSS px
   * @param {object} vp viewport from viewportOnDisplay()
   */
  point(px, py, vp) {
    const x = vp.centre.x + (px / (vp.width / vp.metresPerCssPx) - 0.5) * vp.width;
    const y = vp.centre.y + (0.5 - py / (vp.height / vp.metresPerCssPx)) * vp.height;
    this.target = { x: x * this.reach, y: y * this.reach, z: this.distance };
  }

  /** Pointer left the window: drift back to the middle. */
  leave() {
    this.target = null;
  }

  sample(t) {
    const goal = this.target || this.rest;
    if (!this.pos) {
      this.pos = { ...goal };
      this.t = t;
      return { ...this.pos };
    }
    const dt = Math.min(0.05, Math.max(0, (t - this.t) / 1000));
    this.t = t;
    const w = 9; // rad/s: settles in ~0.4 s
    for (const k of ['x', 'y']) {
      const a = w * w * (goal[k] - this.pos[k]) - 2 * w * this.vel[k];
      this.vel[k] += a * dt;
      this.pos[k] += this.vel[k] * dt;
    }
    this.pos.z = goal.z;
    return { ...this.pos };
  }
}

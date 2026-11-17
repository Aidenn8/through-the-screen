// How the rig moves (src/core/rig.js has the maths of where it is).
//
// Everything the viewer does sets a goal pose; the rig follows the goal
// through a critically damped spring, the same kind that follows the eye, so
// it never swings past where it was sent. Held keys move the goal at a speed;
// a swipe, a drag or a wheel step moves it by an amount. A glide to a station
// moves the goal along an eased path (slow out, slow in), turning the short
// way round and changing scale evenly in log space; the spring follows the
// path. Taking over (any move during a glide) leaves the goal where the rig
// would naturally come to rest, so nothing jumps or bounces back.
//
// The goal is kept inside the scene's bounds, its scale range and a pitch
// limit. Moving speeds are in window metres per second, so they feel the same
// at every scale: at scale 0.25 the rig covers a quarter of the scene distance.
//
// State is six numbers: x, y, z (scene metres), yaw, pitch (degrees) and the
// natural log of scale. Times are seconds.

import { IDENTITY_POSE, EYE_MIN_Z, rotate, shortYaw } from './rig.js';

export const MOTION_DEFAULTS = {
  w: 8, // spring rate (rad/s): about half a second to settle, no overshoot
  moveSpeed: 0.2, // m/s at scale 1: arrow keys
  riseSpeed: 0.12, // m/s at scale 1: Shift + up and down
  boost: 2.5, // a held key speeds up to this...
  boostAfter: 0.6, // ...from this long (s)...
  boostRamp: 1.5, // ...over this long (s)
  turnSpeed: 45, // deg/s: Shift + left and right
  scaleStep: Math.log(1.25), // one press of + or -
  scaleRate: Math.log(2), // per second while + or - is held...
  scaleHoldDelay: 0.35, // ...after this long (s)
  glide: { base: 1.0, per: 0.55, min: 1.2, max: 4.5 }, // duration (s) from the distance
  tourHold: 4, // seconds at each tour stop
  tourSlow: 1.3, // tour glides take this much longer
  arrive: { pos: 0.002, ang: 0.3, ls: 0.003 }, // closer than this (pos in window metres) is there
};

const N = 6;
const ARRIVE_LATE_S = 2.5; // the spring is within the arrival tolerance about 1 s after the path ends
const YAW = 3, PITCH = 4, LS = 5;


/** Slow out, slow in: 0 -> 1 with zero speed at both ends. */
export const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

const toState = (p) => [p.x, p.y, p.z, p.yaw, p.pitch, Math.log(p.scale)];

export class RigMotion {
  /**
   * @param {object} [opts] MOTION_DEFAULTS overrides
   * @param {{arrive?:(station, {tour:boolean})=>void, tour?:(on:boolean)=>void}} [on] events
   */
  constructor(opts = {}, on = {}) {
    this.o = { ...MOTION_DEFAULTS, ...opts, glide: { ...MOTION_DEFAULTS.glide, ...opts.glide }, arrive: { ...MOTION_DEFAULTS.arrive, ...opts.arrive } };
    this.on = on;
    this.nav = null;
    this.cur = toState(IDENTITY_POSE);
    this.vel = new Array(N).fill(0);
    this.goal = toState(IDENTITY_POSE);
    this.glide = null; // { from, to, t, dur, index, tour }
    this.at = null; // id of the station the rig is resting at, or null
    this.last = 0; // index of the station last arrived at or headed for
    this.tour = { on: false, stop: 0, arrivedAt: null };
    this.t = 0;
    this.out = { ...IDENTITY_POSE };
    // The stations' head-tracking limits in force (station `view`, read by
    // src/tracking/view-map.js): weights summing to 1. A glide blends from
    // what was in force to the station's by its progress; taking over keeps
    // the blend where it was; arriving makes it the station's alone.
    this.mix = [{ view: null, w: 1 }];
  }

  /** The stations' view limits in force now, as [{ view, w }] (weights sum to 1). */
  viewMix() {
    const gl = this.glide;
    if (!gl) return this.mix;
    const e = ease(gl.t / gl.dur);
    const out = [];
    const add = (view, w) => {
      if (!(w > 1e-9)) return;
      const m = out.find((x) => x.view === view);
      if (m) m.w += w;
      else out.push({ view, w });
    };
    for (const m of gl.fromMix) add(m.view, m.w * (1 - e));
    add(gl.toView, e);
    return out;
  }

  get enabled() {
    return !!this.nav;
  }

  /** A normalized nav (src/core/rig.js normalizeNav) or null; jumps to the first station. */
  setNav(nav) {
    this.nav = nav ? { ...nav, logScale: [Math.log(nav.scale[0]), Math.log(nav.scale[1])] } : null;
    this.stopTour();
    this.snap(nav ? nav.stations[0].pose : IDENTITY_POSE);
    this.at = nav ? nav.stations[0].id : null;
    this.last = 0;
    this.mix = [{ view: nav?.stations[0].view ?? null, w: 1 }];
  }

  /** Jump (no motion) to a pose. */
  snap(pose) {
    this.cur = toState(pose);
    this.goal = this.cur.slice();
    this.vel.fill(0);
    this.glide = null;
    this.#clamp(this.goal);
    this.cur = this.goal.slice();
  }

  /** The rig now: { x, y, z, yaw, pitch, scale } (the same object every call). */
  get pose() {
    const c = this.cur, o = this.out;
    o.x = c[0]; o.y = c[1]; o.z = c[2]; o.yaw = c[YAW]; o.pitch = c[PITCH]; o.scale = Math.exp(c[LS]);
    return o;
  }

  get scale() {
    return Math.exp(this.cur[LS]);
  }

  /** Index and title of a station by id or index. */
  station(ref) {
    const list = this.nav?.stations || [];
    const i = typeof ref === 'number' ? ref : list.findIndex((s) => s.id === ref);
    return i >= 0 && i < list.length ? { index: i, ...list[i] } : null;
  }

  /** How much faster a key held this long moves (1 .. boost). */
  boostFor(held) {
    const o = this.o;
    const u = Math.min(1, Math.max(0, (held - o.boostAfter) / o.boostRamp));
    return 1 + (o.boost - 1) * ease(u);
  }

  // ------------------------------------------------------------ input

  /**
   * Leave whatever was steering (a glide, the tour) and let the viewer drive:
   * the goal becomes where the rig would come to rest on its own.
   */
  #takeOver() {
    if (this.tour.on) this.stopTour();
    if (this.glide) {
      for (let k = 0; k < N; k++) this.goal[k] = this.cur[k] + this.vel[k] / this.o.w;
      this.mix = this.viewMix(); // the limits stay as blended so far
      this.glide = null;
    }
    this.at = null;
  }

  /**
   * Amounts, applied to the goal at once (a swipe, a drag, a wheel step).
   * @param {{forward?, right?, up?, dolly?, yaw?, pitch?, scaleSteps?}} d
   *   forward / right / up: window metres, level (yaw only);
   *   dolly: window metres along the view (with pitch); yaw / pitch: degrees;
   *   scaleSteps: presses of + (positive shrinks the viewer into the set)
   */
  nudge(d) {
    if (!this.nav) return;
    this.#takeOver();
    const g = this.goal;
    const s = this.scale;
    // Directions from where the view is headed (the goal), so a move right
    // after a turn goes the new way at once, not along the spring's lag.
    const yaw = g[YAW], pitch = g[PITCH];
    if (d.forward || d.right) {
      const f = rotate(yaw, 0, [0, 0, -1]);
      const r = rotate(yaw, 0, [1, 0, 0]);
      const a = (d.forward || 0) * s, b = (d.right || 0) * s;
      g[0] += f[0] * a + r[0] * b;
      g[2] += f[2] * a + r[2] * b;
    }
    if (d.up) g[1] += d.up * s;
    if (d.dolly) {
      const f = rotate(yaw, pitch, [0, 0, -1]);
      for (let k = 0; k < 3; k++) g[k] += f[k] * d.dolly * s;
    }
    if (d.yaw) g[YAW] += d.yaw;
    if (d.pitch) g[PITCH] += d.pitch;
    if (d.scaleSteps) g[LS] -= d.scaleSteps * this.o.scaleStep;
    this.#clamp(g);
  }

  /**
   * Rates while keys are held, each -1..1 (times boost for the move keys).
   * @param {{forward?, right?, up?, turn?, scale?, boost?, scaleHeld?}} r
   *   turn: +1 turns left; scale: +1 shrinks the viewer into the set
   *   (scaleHeld: seconds the scale key has been down; it runs after a pause)
   */
  #rates(r, dt) {
    const o = this.o;
    const scaleOn = r.scale && (r.scaleHeld ?? Infinity) >= o.scaleHoldDelay;
    if (!(r.forward || r.right || r.up || r.turn || scaleOn)) return;
    const b = r.boost || 1;
    this.nudge({
      forward: (r.forward || 0) * o.moveSpeed * b * dt,
      right: (r.right || 0) * o.moveSpeed * b * dt,
      up: (r.up || 0) * o.riseSpeed * b * dt,
      yaw: (r.turn || 0) * o.turnSpeed * dt,
    });
    if (scaleOn) {
      this.goal[LS] -= r.scale * o.scaleRate * dt;
      this.#clamp(this.goal);
    }
  }

  // ------------------------------------------------------------ stations

  /**
   * Glide to a station (id or index), eased, the short way round.
   * @param {{tour?:boolean}} [o] the tour is steering (does not stop it)
   */
  glideTo(ref, { tour = false } = {}) {
    const st = this.station(ref);
    if (!st) return false;
    if (!tour && this.tour.on) this.stopTour();
    const o = this.o;
    const to = toState(st.pose);
    // Where the rig can be (bounds, and held off a wall behind it): a
    // station too near a wall is landed just off it, never waited for.
    this.#clamp(to);
    // Start where the rig would come to rest by itself, so a moving rig
    // carries on smoothly into the glide instead of stopping first, but never
    // from past the station.
    const from = new Array(N);
    for (let k = 0; k < N; k++) from[k] = this.cur[k] + this.vel[k] / o.w;
    to[YAW] = from[YAW] + shortYaw(from[YAW], to[YAW]);
    for (let k = 0; k < N; k++) {
      const a = from[k] - this.cur[k], b = to[k] - this.cur[k];
      if (a * b > 0 && Math.abs(a) > Math.abs(b)) {
        // Heading for the station faster than the spring can stop short of
        // it: slow to the speed it can stop from, rather than pass it and
        // come back.
        from[k] = to[k];
        this.vel[k] = o.w * b;
      }
    }
    this.#clamp(from);
    const sGeo = Math.exp((this.cur[LS] + to[LS]) / 2);
    const d = Math.hypot(to[0] - this.cur[0], to[1] - this.cur[1], to[2] - this.cur[2]) / sGeo / 0.25
      + Math.abs(to[YAW] - this.cur[YAW]) / 90
      + Math.abs(to[PITCH] - this.cur[PITCH]) / 45
      + Math.abs(to[LS] - this.cur[LS]) / Math.LN2;
    const g = o.glide;
    const dur = Math.min(g.max, Math.max(g.min, g.base + g.per * d)) * (tour ? o.tourSlow : 1);
    this.glide = { from, to, t: 0, dur, index: st.index, tour, fromMix: this.viewMix(), toView: st.view ?? null };
    this.at = null;
    this.last = st.index;
    return true;
  }

  /** The next (dir 1) or previous (dir -1) station after the last one. */
  step(dir = 1) {
    const n = this.nav?.stations.length || 0;
    if (!n) return false;
    return this.glideTo((((this.last + dir) % n) + n) % n);
  }

  home() {
    return this.glideTo(0);
  }

  // ------------------------------------------------------------ tour

  /**
   * Glide through nav.tour, holding each stop for tourHold seconds, round and
   * round until stopped. Starts with the stop after the station the rig is at
   * (or last headed for), so it never begins by holding still.
   */
  startTour() {
    if (!this.nav || this.tour.on) return false;
    const order = this.nav.tour;
    const lastId = this.nav.stations[this.last]?.id;
    const i = order.indexOf(lastId);
    this.tour = { on: true, stop: i >= 0 ? (i + 1) % order.length : 0, arrivedAt: null };
    this.glideTo(order[this.tour.stop], { tour: true });
    this.on.tour?.(true);
    return true;
  }

  stopTour() {
    if (!this.tour.on) return;
    this.tour = { on: false, stop: 0, arrivedAt: null };
    if (this.glide?.tour) this.glide.tour = false; // the glide under way still lands
    this.on.tour?.(false);
  }

  toggleTour() {
    if (this.tour.on) this.stopTour();
    else this.startTour();
    return this.tour.on;
  }

  // ------------------------------------------------------------ frame

  /**
   * Advance one frame.
   * @param {number} dt seconds
   * @param {object} [rates] held keys (see #rates)
   * @returns the pose (see `pose`)
   */
  update(dt, rates = null) {
    if (!this.nav || !(dt > 0)) return this.pose;
    this.t += dt;
    if (rates) this.#rates(rates, dt);
    const gl = this.glide;
    if (gl) {
      gl.t += dt;
      const e = ease(gl.t / gl.dur);
      for (let k = 0; k < N; k++) this.goal[k] = gl.from[k] + (gl.to[k] - gl.from[k]) * e;
    }
    // One exact step of a critically damped spring toward the goal, per axis.
    const w = this.o.w;
    const e = Math.exp(-w * dt);
    for (let k = 0; k < N; k++) {
      const y0 = this.cur[k] - this.goal[k];
      const c = this.vel[k] + w * y0;
      this.cur[k] = this.goal[k] + (y0 + c * dt) * e;
      this.vel[k] = (this.vel[k] - w * c * dt) * e;
    }
    this.#clampCur();
    this.#wrapYaw();
    // Arrived when the rig is at the station, or in any case a while after
    // the glide's time is up (whatever might hold it short, the tour goes on).
    if (gl && gl.t >= gl.dur && (this.#near(gl.to) || gl.t >= gl.dur + ARRIVE_LATE_S)) this.#arrive(gl);
    const tr = this.tour;
    if (tr.on && tr.arrivedAt !== null && this.t - tr.arrivedAt >= this.o.tourHold) {
      tr.stop = (tr.stop + 1) % this.nav.tour.length;
      tr.arrivedAt = null;
      this.glideTo(this.nav.tour[tr.stop], { tour: true });
    }
    return this.pose;
  }

  #arrive(gl) {
    this.glide = null;
    const st = this.nav.stations[gl.index];
    this.mix = [{ view: st.view ?? null, w: 1 }];
    this.at = st.id;
    this.last = gl.index;
    if (this.tour.on && gl.tour) this.tour.arrivedAt = this.t;
    this.on.arrive?.(st, { tour: gl.tour });
  }

  #near(to) {
    const a = this.o.arrive, c = this.cur;
    const s = Math.exp(c[LS]);
    return Math.hypot(c[0] - to[0], c[1] - to[1], c[2] - to[2]) < a.pos * s
      && Math.abs(c[YAW] - to[YAW]) < a.ang && Math.abs(c[PITCH] - to[PITCH]) < a.ang
      && Math.abs(c[LS] - to[LS]) < a.ls;
  }

  /** [lo, hi] for axis k (yaw is free). */
  #range(k) {
    const nav = this.nav;
    if (k < 3) return [nav.bounds.min[k], nav.bounds.max[k]];
    if (k === PITCH) return [-nav.pitchLimit, nav.pitchLimit];
    if (k === LS) return nav.logScale;
    return null;
  }

  #clamp(v) {
    if (!this.nav) return;
    for (let k = 0; k < N; k++) {
      const r = this.#range(k);
      if (r) v[k] = Math.min(r[1], Math.max(r[0], v[k]));
    }
    this.#roomStep(v);
  }

  /**
   * With nav.room: the nearest eye the app draws from at the window's centre
   * (EYE_MIN_Z x scale in front of the glass) must be in the room, or no eye
   * could be (a window backed against a wall, facing away from it): move the
   * rig off that wall as far as needed.
   */
  #roomStep(v) {
    const room = this.nav?.room;
    if (!room) return;
    const d = EYE_MIN_Z * Math.exp(v[LS]) * (1 + 1e-6);
    const n = rotate(v[YAW], v[PITCH], [0, 0, 1]);
    for (let k = 0; k < 3; k++) {
      const q = v[k] + d * n[k];
      v[k] += Math.min(room.max[k], Math.max(room.min[k], q)) - q;
    }
  }

  /** The spring cannot leave the bounds either (it stops at the wall). */
  #clampCur() {
    const c = this.cur;
    for (let k = 0; k < N; k++) {
      const r = this.#range(k);
      if (!r) continue;
      if (c[k] < r[0]) { c[k] = r[0]; this.vel[k] = 0; }
      else if (c[k] > r[1]) { c[k] = r[1]; this.vel[k] = 0; }
    }
    // Off a wall behind the window: a continuous push, every frame (no
    // velocity is dropped, so turning near a wall never stutters; the goal
    // is held off the same wall, so nothing keeps pressing into it).
    this.#roomStep(c);
  }

  /** Keep yaw near (-180, 180]: shift every yaw by whole turns together. */
  #wrapYaw() {
    const y = this.cur[YAW];
    if (y > -180 && y <= 180) return;
    const turns = 360 * Math.round(y / 360);
    this.cur[YAW] -= turns;
    this.goal[YAW] -= turns;
    if (this.glide) {
      this.glide.from[YAW] -= turns;
      this.glide.to[YAW] -= turns;
    }
  }
}

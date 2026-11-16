// Head-turn steering (Look around only): where the face points adds to the
// viewpoint's offset, as well as where the head is.
//
// Directions match Look around's position mapping, where rising moves the
// viewpoint down (more of the top shows) and leaning right moves it left
// (more of the right side shows):
//   tilt the head back to look up  -> viewpoint down  -> more of the top
//   look down                      -> viewpoint up    -> more of the bottom
//   turn right                     -> viewpoint left  -> more of the right side
//   turn left                      -> viewpoint right -> more of the left side
//
// Angles are the face's yaw and pitch in display terms (eye-solve.js
// headAngles: yaw > 0 turned to the viewer's right, pitch > 0 tilted up),
// measured from a rest pose that is kept like the rest point (view-map.js):
// seeded with it, followed only while the head is still and within nearDeg
// of it, held otherwise (a held tilt holds), taken up slowly after 25 s still
// somewhere new, and re-centred with R.
//
// Noise. The pose from the facial transformation matrix jitters by about
// 0.5-1 degree a frame, and every degree past the dead-band moves the view
// 2-2.5 cm. Three stages keep that off the screen:
//   1. a one-pole low-pass (smoothMs) on the raw angles;
//   2. a hold band, like Smooth follow's dead-band: the held pose moves only
//      when the smoothed pose leaves a circle around it (radius holdDeg, at
//      least holdNoise x the measured raw noise), and only by the amount it
//      left by; it settles onto the smoothed pose quickly for a moment after a
//      deliberate turn and very slowly otherwise. A pose held still gives a
//      steering offset that does not move at all;
//   3. a dead-band about the rest pose (bandDeg) for the small turns a head
//      makes all the time, then a soft limit (tanh) on the offset.
// Every stage moves monotonically toward its input, and the offset goes
// through the same Smooth follow spring as the head's position, so a turn
// that stops never swings past.
//
// A turn also moves the eye: the eyes sit about 8 cm in front of and 7.5 cm
// above the neck's pivot (the usual neck model), so a 15 degree tilt back
// lifts the eye ~1.8 cm and moves it ~2.2 cm away from the screen. Counted
// once only: the eye movement of the turn past the dead-band (the same
// angles that steer) is taken out of the eye position before the position
// mapping, so a turn steers through this offset alone and does not also zoom
// the scene. Inside the dead-band nothing changes from before. The steering
// of a turn grows faster than the eye movement it replaces until the soft
// limit flattens it; from there on (17 degrees up or down, 26 sideways at
// the defaults) the eye movement is no longer taken out, so turning further
// never pulls the view back: the pose is filtered and lags the eye a little,
// and a correction that grew faster than the steering would show that lag as
// a swing back.
//
// Times in ms, angles in degrees, positions in display metres.

import { NoiseMeter } from './noise.js';

export const TURN_DEFAULTS = {
  // Steering at Turn strength 1x (the slider scales the whole curve).
  bandDeg: { yaw: 5, pitch: 4 }, // dead-band about the rest pose
  gain: { x: 0.02, y: 0.025 }, // m of viewpoint per degree past the band (small turns)
  limit: { x: 0.30, y: 0.25 }, // soft limit (m)
  // Eye relative to the neck's pivot, facing the screen (m).
  pivot: { forward: 0.08, up: 0.075 },
  // Noise.
  smoothMs: 80, // pre-filter time constant
  holdDeg: 0.6, // hold band radius, at least...
  holdNoise: 1.8, // ...this many times the raw noise (std, deg); ~4x the pre-filtered noise
  settleMs: 300, // the held pose settles onto the smoothed one this fast...
  settleHoldMs: 1200, // ...for this long after a deliberate turn...
  recentreMs: 8000, // ...and this slowly otherwise
  moveDeg: 2, // a deliberate turn: the hold band dragged this far within ~0.5 s
  gapMs: 500, // no pose for this long (a lost face): settle quickly onto the new pose
  // Looking down past `from` degrees below the rest pose (a glance at the
  // keyboard), the turn's steering and its eye movement fade out, smoothly,
  // until at `to` degrees the view is where it would be had the head not
  // tilted at all. Looking down 10-15 degrees still steers fully (18 leaves
  // room for the head's own wobble and the glance pitch's hold band).
  glanceDeg: { from: 18, to: 25 },
  // The glance is judged on a quicker pitch than the steering (the eye moves
  // at once; a fade judged on the slow pose would let the eye's whole
  // movement add to steering not yet faded): this pre-filter, then a hold
  // band (3 degrees: about 3.5 times the pre-filtered noise at 1 degree a
  // frame) that settles onto that pitch over glanceSettleMs, so a head held
  // part way into a glance does not make the fade flicker.
  glanceSmoothMs: 20,
  glanceHoldDeg: 3,
  glanceSettleMs: 1000,
  // While the head turns faster than this (deg/s; noise alone reads about
  // 4), the glance band is only glanceMovingDeg, so the fade keeps up with
  // the head and a look-down that stops inside it does not first overshoot.
  glanceFastDegS: 30,
  glanceMovingDeg: 0.5,
  noiseInitial: 0.75, // assumed raw noise (deg) until measured
  // Rest pose (as the rest point, view-map.js).
  restMs: 6000,
  nearDeg: 2,
  postureHoldMs: 25000,
  postureMs: 45000,
  freezeDegS: 15, // turning faster than this (deg/s; 100 ms means 200 ms apart) freezes it...
  freezeHoldMs: 400, // ...and for this long after
  recentreWinMs: 400, // Re-centre uses the mean of this last stretch
};

/** Turn strength: the slider's range and default. */
export const TURN_STRENGTH = { min: 0.25, max: 2, default: 1 };

const ANG = ['yaw', 'pitch'];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rad = Math.PI / 180;

/** A point r (head frame facing the screen: x right, y up, z toward the viewer) turned by yaw, pitch (deg). */
export function turnPoint(r, yaw, pitch) {
  const cp = Math.cos(pitch * rad);
  const sp = Math.sin(pitch * rad);
  const cy = Math.cos(yaw * rad);
  const sy = Math.sin(yaw * rad);
  // Pitch about the head's sideways axis (up tips back), then yaw about vertical (forward turns right).
  const y = r.y * cp - r.z * sp;
  const z1 = r.y * sp + r.z * cp;
  return { x: r.x * cy - z1 * sy, y, z: r.x * sy + z1 * cy };
}

/** Soft limit: s L tanh(k e / L), slope s k at 0. */
const soft = (e, k, L, s) => s * L * Math.tanh((k * e) / L);

/**
 * Where the turn's eye correction stops growing: past this deviation (deg)
 * the soft-limited steering grows more slowly than the eye movement it
 * replaces (g x lever per degree in view metres).
 */
function capDeg(k, L, s, g, lever) {
  const ratio = (g * lever * rad) / (s * k);
  if (!(ratio < 1)) return 0;
  return (L / k) * Math.atanh(Math.sqrt(1 - ratio));
}

export class HeadTurn {
  constructor(opts = {}) {
    const d = TURN_DEFAULTS;
    this.o = {
      ...d, ...opts,
      bandDeg: { ...d.bandDeg, ...opts.bandDeg },
      gain: { ...d.gain, ...opts.gain },
      limit: { ...d.limit, ...opts.limit },
      pivot: { ...d.pivot, ...opts.pivot },
      glanceDeg: { ...d.glanceDeg, ...opts.glanceDeg },
    };
    this.reset();
  }

  /** Forget everything (a new viewer, or a new camera). */
  reset() {
    this.f = null; // pre-filtered pose
    this.gf = null; // quicker pitch for the glance fade, and its held value
    this.gp = null;
    this.held = null; // after the hold band
    this.rest = null; // rest pose
    this.seeded = false;
    this.recent = []; // { t, a } raw, the last second or so
    this.t = null;
    this.tMoved = null;
    this.moved = 0;
    this.interval = 33; // measured time between poses (ms)
    this.h = this.o.holdDeg; // current hold band radius
    this.frozenUntil = -Infinity;
    this.stillSince = null;
    const n = this.o.noiseInitial;
    this.noise = new NoiseMeter({ initial: { x: n, y: n, z: 0 }, size: 45, riseSeconds: 1 });
  }

  #mean(sinceT, untilT = Infinity) {
    const pts = this.recent.filter((q) => q.t >= sinceT && q.t <= untilT);
    if (!pts.length) return null;
    const m = { yaw: 0, pitch: 0, t: 0 };
    for (const q of pts) {
      for (const k of ANG) m[k] += q.a[k] / pts.length;
      m.t += q.t / pts.length;
    }
    return m;
  }

  /** Turning speed (deg/s): 100 ms means 200 ms apart (0 without enough samples). */
  #speed(t) {
    const a = this.#mean(t - 300, t - 200);
    const b = this.#mean(t - 100, t);
    if (!a || !b || !(b.t > a.t)) return 0;
    return Math.hypot(b.yaw - a.yaw, b.pitch - a.pitch) / ((b.t - a.t) / 1000);
  }

  /**
   * A head pose (yaw, pitch in degrees) captured at t.
   * @param {{moving?:boolean, seeded?:boolean}} [ctx] moving: the head's
   *   position is moving (the rest point is frozen); seeded: the rest point
   *   has been seeded (the rest pose seeds with it)
   */
  observe(t, a, { moving = false, seeded = false } = {}) {
    if (!a || !Number.isFinite(a.yaw) || !Number.isFinite(a.pitch)) return;
    const o = this.o;
    const first = this.t === null || !this.f || t < this.t;
    const dt0 = first ? 0 : t - this.t;
    // A detection gap is missing samples: the first pose after it moves the
    // filters no more than one ordinary step would, so the catch-up spreads
    // over the next few samples instead of arriving at once (also after a
    // face lost for longer, which the eye track glides over too).
    const dt = Math.min(dt0, 1.5 * this.interval);
    this.t = t;
    if (first) {
      // First pose: start where the head points now.
      this.f = { yaw: a.yaw, pitch: a.pitch };
      this.held = { ...this.f };
      this.gf = a.pitch;
      this.gp = a.pitch;
      this.noise.break();
      this.recent = [];
      this.moved = 0;
      this.tMoved = t; // settle quickly, as after a deliberate turn
    } else {
      if (dt0 > o.gapMs) {
        // Back after a lost face: settle onto where it points now, quickly.
        this.noise.break();
        this.recent = [];
        this.moved = 0;
        this.tMoved = t;
      } else if (dt0 < 200) {
        this.interval += 0.1 * (dt0 - this.interval);
      }
      const k = 1 - Math.exp(-dt / o.smoothMs);
      for (const q of ANG) this.f[q] += (a[q] - this.f[q]) * k;
      this.gf += (a.pitch - this.gf) * (1 - Math.exp(-dt / o.glanceSmoothMs));
    }
    this.noise.add(t, { x: a.yaw, y: a.pitch, z: 0 });
    this.recent.push({ t, a: { yaw: a.yaw, pitch: a.pitch } });
    while (this.recent.length > 2 && t - this.recent[0].t > 1100) this.recent.shift();

    // Hold band.
    const sigma = Math.max(this.noise.level.x, this.noise.level.y);
    this.h = Math.max(o.holdDeg, o.holdNoise * sigma);
    const tau = t - this.tMoved < o.settleHoldMs ? o.settleMs : o.recentreMs;
    const kr = dt > 0 ? 1 - Math.exp(-dt / tau) : 0;
    for (const q of ANG) this.held[q] += (this.f[q] - this.held[q]) * kr;
    const dy = this.f.yaw - this.held.yaw;
    const dp = this.f.pitch - this.held.pitch;
    const r = Math.hypot(dy, dp);
    let drag = 0;
    if (r > this.h) {
      const s = 1 - this.h / r;
      this.held.yaw += dy * s;
      this.held.pitch += dp * s;
      drag = r - this.h;
    }
    this.moved = this.moved * Math.exp(-dt / 500) + drag;
    if (this.moved > o.moveDeg) this.tMoved = t;
    const hg = this.#speed(t) > o.glanceFastDegS ? o.glanceMovingDeg : o.glanceHoldDeg;
    this.gp += (this.gf - this.gp) * (dt > 0 ? 1 - Math.exp(-dt / o.glanceSettleMs) : 0);
    if (this.gf - this.gp > hg) this.gp = this.gf - hg;
    else if (this.gp - this.gf > hg) this.gp = this.gf + hg;

    this.#adaptRest(t, dt, moving, seeded);
  }

  #adaptRest(t, dt, moving, seeded) {
    const o = this.o;
    if (!this.seeded) {
      // Until the rest point seeds, rest on the last 0.3 s: no offset yet.
      const m = this.#mean(t - 300);
      this.rest = { yaw: m.yaw, pitch: m.pitch };
      if (seeded) {
        // Seeded where it is (no jump), with the rest point.
        this.seeded = true;
        this.stillSince = t;
      }
      return;
    }
    if (moving || this.#speed(t) > o.freezeDegS) {
      this.frozenUntil = t + o.freezeHoldMs;
      this.stillSince = null;
    }
    if (t < this.frozenUntil) return;
    this.stillSince ??= t;
    const m = this.#mean(t - 300) || this.f;
    const near = Math.hypot(m.yaw - this.rest.yaw, m.pitch - this.rest.pitch) <= o.nearDeg;
    const tau = near ? o.restMs : t - this.stillSince >= o.postureHoldMs ? o.postureMs : Infinity;
    if (!Number.isFinite(tau)) return;
    const k = 1 - Math.exp(-dt / tau);
    for (const q of ANG) this.rest[q] += (this.f[q] - this.rest[q]) * k;
  }

  /** Re-centre now: the rest pose becomes where the face points. */
  recentre() {
    const t = this.recent.at(-1)?.t;
    if (t === undefined) return;
    const m = this.#mean(t - this.o.recentreWinMs);
    this.rest = { yaw: m.yaw, pitch: m.pitch };
    this.seeded = true;
    this.stillSince = t;
  }

  /** True while the held pose is past the dead-band (a turn that steers). */
  turned() {
    const e = this.deviation();
    return e.yaw !== 0 || e.pitch !== 0;
  }

  /** The held pose's deviation from rest past the dead-band (deg); 0 inside it. */
  deviation() {
    if (!this.held || !this.rest) return { yaw: 0, pitch: 0 };
    const b = this.o.bandDeg;
    const e = (d, band) => Math.sign(d) * Math.max(0, Math.abs(d) - band);
    return { yaw: e(this.held.yaw - this.rest.yaw, b.yaw), pitch: e(this.held.pitch - this.rest.pitch, b.pitch) };
  }

  /**
   * What the turn does to the viewpoint now.
   * @param {{x:number, y:number}} gain the position mapping's gain (magnitude) sideways and up and down
   * @param {number} strength Turn strength
   * @param {number} [lat] the tracked eye's offset to the viewer's right of
   *   the head's midline (m): +IPD/2 for the right eye, 0 between the eyes
   * @returns {{steer:{x,y,z}, eye:{x,y,z}, eyeBypass:{x,y,z}}} steer: added
   *   to the viewpoint; eye: the eye movement of the turn, taken out of the
   *   eye position; eyeBypass: the part of eye that goes with the steering
   */
  offsets(gain, strength, lat = 0) {
    const zero = { x: 0, y: 0, z: 0 };
    const s = Number.isFinite(strength) ? clamp(strength, 0, TURN_STRENGTH.max) : 0;
    if (!(s > 0) || !this.held || !this.rest) return { steer: zero, eye: zero, eyeBypass: zero };
    const o = this.o;
    const e = this.deviation();
    const steer = { x: -soft(e.yaw, o.gain.x, o.limit.x, s), y: -soft(e.pitch, o.gain.y, o.limit.y, s), z: 0 };
    const capY = capDeg(o.gain.x, o.limit.x, s, gain.x, o.pivot.forward);
    const capP = capDeg(o.gain.y, o.limit.y, s, gain.y, o.pivot.forward);
    const ey = clamp(e.yaw, -capY, capY);
    const ep = clamp(e.pitch, -capP, capP);
    // The arc past the dead-band: from the band's edge (or, on an axis still
    // inside it, the held angle) on by the steering part of the turn.
    const b0 = this.o.bandDeg;
    const edge = {
      yaw: this.rest.yaw + clamp(this.held.yaw - this.rest.yaw, -b0.yaw, b0.yaw),
      pitch: this.rest.pitch + clamp(this.held.pitch - this.rest.pitch, -b0.pitch, b0.pitch),
    };
    const r = { x: lat, y: o.pivot.up, z: -o.pivot.forward };
    const a = turnPoint(r, edge.yaw + ey, edge.pitch + ep);
    const b = turnPoint(r, edge.yaw, edge.pitch);
    const eye = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
    // A glance down at the keyboard: past glanceDeg.from below the rest pose
    // the pitch steering fades out, and the eye movement taken out grows to
    // the whole pitch arc from the rest pose, so by glanceDeg.to the view is
    // where it would be had the head not tilted. Smooth in the held pose.
    const w = this.glanceWeight();
    // eyeBypass: the part of the eye movement taken out that rides with the
    // steering around Smooth follow's dead-band (view-map.js turnBypass);
    // a glance's extra goes through the band with the eye itself, so the
    // view comes back from a glance without swinging past (the band lags
    // the eye that the extra cancels).
    const eyeBypass = { ...eye };
    if (w < 1) {
      steer.y *= w;
      const ga = turnPoint(r, edge.yaw + ey, this.held.pitch);
      const gb = turnPoint(r, edge.yaw, this.rest.pitch);
      for (const k of ['x', 'y', 'z']) {
        eyeBypass[k] = w * eye[k];
        eye[k] = w * eye[k] + (1 - w) * (ga[k] - gb[k]);
      }
    }
    return { steer, eye, eyeBypass };
  }

  /** 1 normally, fading to 0 as the head looks down from glanceDeg.from to .to below the rest pose. */
  glanceWeight() {
    if (this.gp === null || !this.rest) return 1;
    const { from, to } = this.o.glanceDeg;
    const u = (this.rest.pitch - this.gp - from) / Math.max(1e-6, to - from);
    return u <= 0 ? 1 : u >= 1 ? 0 : 1 - u * u * (3 - 2 * u);
  }
}

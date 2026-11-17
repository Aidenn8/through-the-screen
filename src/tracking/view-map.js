// How head motion moves the viewpoint.
//
// 'window' (True window) renders from where the eye is: the physically exact
// mapping, in which the scene holds still behind the glass and leaning right
// shows more of the left side.
// 'look' (Look around) mirrors the head's offset from a rest point on all
// three axes: leaning right moves the viewpoint left, leaning in moves it
// back (the scene grows), rising moves it down. Some viewers read this as
// the natural direction; the first real-camera test found the exact mapping
// "inverted".
//
// Strength is a gain on the offset from the rest point, in both modes (1x is
// exact; 1-5x, 3x by default for Look around). Depth gets half the extra
// gain (3x -> 2x): its noise is ten times the sideways noise, and a tripled
// depth swing scales the whole scene in and out with every small lean
// (docs/CORE_NOTES.md). In Look around, up and down get 1.5 times the
// Strength (3x -> 4.5x): a seated head rises and ducks far less than it
// leans, and the first real test found looking up "doesn't really move much".
//
// Head turn (Look around only, src/tracking/head-turn.js): tilting the head
// back or turning it adds to the offset in the same directions as rising and
// leaning, with the turn's own eye movement taken out of the position so it
// counts once. True window ignores the head's pose.
//
// The rest point is where the viewer sits. The mapped point is
// (1 + g) rest - g p, so every millimetre the rest point moves while the
// head holds still moves the view 1 + g millimetres: it must not follow a
// held lean. It is seeded from the first steady second; then, while the head
// is still, it follows the eye within 1 cm of it (6 s), so small shifts of
// a seated head are absorbed. Farther away it stays put: a lean holds for as
// long as the viewer holds it. Only after 25 s still in a new place (moving
// the chair, sitting back) does it start to follow, slowly (45 s), and
// Re-centre (R) takes it there at once. It is mapped before the motion
// filter, so the filter's guarantees (no overshoot) hold for the mapped
// motion too.
//
// Positions are display coordinates (metres, origin at the screen centre,
// z toward the viewer); times are ms.

import { HeadTurn, TURN_STRENGTH } from './head-turn.js';

export const VIEW_DEFAULTS = {
  restMs: 6000, // the rest point follows a still eye within nearM with this time constant
  nearM: 0.01,
  postureHoldMs: 25000, // farther than nearM: still this long first (a new posture)...
  postureMs: 45000, // ...then follow with this time constant
  // Frozen while the head moves faster than this sideways (m/s; 100 ms means
  // 200 ms apart, so dim-room noise of about 6 mm/s does not trip it; depth
  // noise would), and for freezeHoldMs after.
  freezeSpeed: 0.03,
  freezeHoldMs: 400,
  seedMs: 1000, // the first steady second seeds it
  seedSpread: 0.006, // steady: every sample within this of the mean (m)
  recentreMs: 400, // Re-centre uses the mean of this last stretch
  zGainShare: 0.5, // depth gain = 1 + (gain - 1) * this
  yGainLook: 1.5, // Look around: up and down get this times the Strength
  turn: {}, // HeadTurn options (TURN_DEFAULTS)
  // Where the rendered eye may go: in front of the glass, and within a cone
  // that narrows as the eye comes closer. Both scenes are built out to hold
  // up across it (docs/SCENES_NOTES.md, round 7): +-45 cm to the side, 35-85
  // cm away from a 60 cm seat, 45 degrees sideways. Up and down it was 25 cm
  // and 31 degrees; with 4.5x up and down and head turn, rising and tilting
  // back together reach about 40 cm, so it is now 48 cm above the screen's
  // centre, 40 below, and 39 degrees (yPerZ 0.8), checked with headless
  // renders of both scenes at those edges, the corners, and 35 and 85 cm away
  // (the eye above: the Soundstage floor and car roof, the Box floor; below:
  // the Soundstage truss grid, the Box's dark ceiling with the scene along
  // the bottom edge). To be revisited with the scenes' extended extents.
  limits: { x: 0.5, yMin: -0.4, yMax: 0.48, zMin: 0.2, zMax: 1.4, xPerZ: 1.0, yPerZ: 0.8 },
};

export const DIRECTIONS = ['look', 'window'];
// Strength: the slider's range, and the default per direction.
export const STRENGTH = { min: 1, max: 5, look: 3, window: 1 };
export { TURN_STRENGTH };

const AX = ['x', 'y', 'z'];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const finite3 = (p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
/** What makes two view settings map differently. */
const viewKey = (v) => [v.direction, v.strength, turnStrengthOf(v)].join('|');

/** Strength as used: 1-5, and 1 for anything that is not a number. */
export function strengthOf(view) {
  const g = view?.strength;
  return Number.isFinite(g) ? clamp(g, STRENGTH.min, STRENGTH.max) : 1;
}

/** Per-axis gain for a view setting { direction, strength }. */
export function viewGain(view, o = VIEW_DEFAULTS) {
  const g = strengthOf(view);
  const look = view?.direction === 'look';
  const s = look ? -1 : 1;
  const gz = 1 + (g - 1) * o.zGainShare;
  return { x: s * g, y: s * g * (look ? o.yGainLook : 1), z: s * gz };
}

/**
 * Turn strength in use: 0 unless the view is Look around with head turn on
 * (view.turn = { on, strength }); then 0.25-2, 1 for anything that is not a
 * number.
 */
export function turnStrengthOf(view) {
  if (view?.direction !== 'look' || !view.turn?.on) return 0;
  const s = view.turn.strength;
  return Number.isFinite(s) ? clamp(s, TURN_STRENGTH.min, TURN_STRENGTH.max) : TURN_STRENGTH.default;
}

/** True when the view is the exact window (rest point irrelevant). */
export function isExact(view) {
  return (view?.direction ?? 'window') === 'window' && strengthOf(view) === 1;
}

export class ViewMapper {
  constructor(opts = {}) {
    this.o = { ...VIEW_DEFAULTS, ...opts, limits: { ...VIEW_DEFAULTS.limits, ...opts.limits } };
    this.turn = new HeadTurn(this.o.turn);
    this.reset();
  }

  /** Forget the rest point and rest pose (a new viewer, or a new camera). */
  reset() {
    this.turn.reset();
    this.lat = 0; // the tracked eye's offset from the head's midline (head turn)
    this.rest = null;
    this.lastView = null; // the view setting the last sample was mapped with
    this.recentreWanted = false;
    this.seeded = false;
    this.recent = []; // { t, p } of the last second or so
    this.t = null;
    this.frozenUntil = -Infinity;
    this.stillSince = null; // when the head last stopped moving (seeded only)
  }

  /** Sideways speed of the eye (m/s): 100 ms means 200 ms apart (0 without enough samples). */
  #speedXY(t) {
    const a = this.#mean(t - 300, t - 200);
    const b = this.#mean(t - 100, t);
    if (!a || !b || !(b.t > a.t)) return 0;
    return Math.hypot(b.x - a.x, b.y - a.y) / ((b.t - a.t) / 1000);
  }

  #mean(sinceT, untilT = Infinity) {
    const pts = this.recent.filter((q) => q.t >= sinceT && q.t <= untilT);
    if (!pts.length) return null;
    const m = { x: 0, y: 0, z: 0, t: 0 };
    for (const q of pts) {
      for (const k of AX) m[k] += q.p[k] / pts.length;
      m.t += q.t / pts.length;
    }
    return m;
  }

  /**
   * A tracked eye position (raw, display coordinates) captured at t.
   * @param {{hold?:boolean}} [ctx] hold: the head is turned on purpose (head
   *   turn): the rest point holds as for a held lean, however near it is;
   *   the posture rule (25 s still, then slowly) still applies
   */
  observe(t, p, { hold = false } = {}) {
    const o = this.o;
    if (!finite3(p)) return;
    this.recent.push({ t, p: { ...p } });
    while (this.recent.length > 2 && t - this.recent[0].t > Math.max(o.seedMs, 300, o.recentreMs) + 100) this.recent.shift();
    const dt = this.t === null ? 0 : Math.min(Math.max(t - this.t, 0), 250);
    this.t = t;
    if (!this.seeded) {
      // Until a steady second has been seen, rest on the last 0.3 s: offsets
      // stay small, so nothing is mirrored or amplified much yet.
      this.rest = this.#mean(t - 300);
      const span = t - this.recent[0].t;
      const m = this.#mean(t - o.seedMs);
      const pts = this.recent.filter((q) => q.t >= t - o.seedMs);
      if (span >= o.seedMs - 50 && pts.every((q) => Math.hypot(q.p.x - m.x, q.p.y - m.y, (q.p.z - m.z) / 3) <= o.seedSpread)) {
        // Seeded where it already is (within 6 mm of the steady second's
        // mean): jumping to that mean would move the view up to (1 + g) x
        // 6 mm at once. The near-rest adaptation below closes the rest.
        this.seeded = true;
        this.stillSince = t;
      }
      return;
    }
    if (this.#speedXY(t) > o.freezeSpeed) {
      this.frozenUntil = t + o.freezeHoldMs;
      this.stillSince = null;
    }
    if (t < this.frozenUntil) return;
    this.stillSince ??= t;
    const m = this.#mean(t - 300) || p;
    const near = !hold && Math.hypot(m.x - this.rest.x, m.y - this.rest.y, (m.z - this.rest.z) / 3) <= o.nearM;
    const tau = near ? o.restMs : t - this.stillSince >= o.postureHoldMs ? o.postureMs : Infinity;
    if (!Number.isFinite(tau)) return;
    const k = 1 - Math.exp(-dt / tau);
    for (const a of AX) this.rest[a] += (p[a] - this.rest[a]) * k;
  }

  /**
   * One tracked sample through the mapping, as the tracker does it: update
   * the rest point and rest pose, re-centre if asked, map. When the view
   * setting changed or the view was re-centred since the last sample,
   * `shift` is how far the mapped point moved because of that (the caller
   * glides the track across it with EyeTrack.shift, so the view never
   * jumps); otherwise null.
   * @param {{yaw:number, pitch:number}|null} [pose] head pose (degrees,
   *   eye-solve.js headAngles), for head turn in Look around
   * @param {number} [lat] the tracked eye's offset to the viewer's right of
   *   the head's midline (m)
   * @returns {{p:{x,y,z}, shift:{x,y,z}|null, gain:{x:number,y:number,xy:number,z:number}, offset:{x,y,z}}}
   *   offset: the head-turn part of p (turnOffset; zero when off), for
   *   EyeTrack.push and EyeTrack.shift
   */
  step(t, p, view, pose = null, lat = 0) {
    this.lat = Number.isFinite(lat) ? lat : 0;
    // The pose is followed in every view, so turning head turn on finds a
    // settled rest pose. The rest point's stillness is from the last sample.
    if (pose) this.turn.observe(t, pose, { moving: t < this.frozenUntil, seeded: this.seeded });
    // A held turn holds, as a held lean does: while the head is turned past
    // the dead-band (head turn on), the rest point does not follow the eye
    // nearby. After 25 s still it takes up the new posture slowly, as for a
    // lean, together with the rest pose; it watches the eye with the turn's
    // own movement taken out (where the viewer sits), which is the eye
    // itself whenever the head is inside the dead-band.
    const turned = turnStrengthOf(view) > 0 && this.turn.turned();
    this.observe(t, turned ? this.unturned(p, view) : p, { hold: turned });
    let before = null;
    if (this.recentreWanted) {
      before = this.map(p, this.lastView || view);
      this.recentre();
      this.recentreWanted = false;
    } else if (this.lastView && viewKey(this.lastView) !== viewKey(view)) {
      before = this.map(p, this.lastView);
    }
    const q = this.map(p, view);
    this.lastView = { direction: view.direction, strength: view.strength, turn: view.turn ? { ...view.turn } : undefined };
    const g = viewGain(view, this.o);
    const gx = Math.abs(g.x);
    const gy = Math.abs(g.y);
    return {
      p: q,
      shift: before ? { x: q.x - before.x, y: q.y - before.y, z: q.z - before.z } : null,
      gain: { x: gx, y: gy, xy: Math.sqrt((gx * gx + gy * gy) / 2), z: Math.abs(g.z) },
      offset: this.turnBypass(view),
    };
  }

  /** The eye with the head turn's own eye movement taken out (where the viewer sits). */
  unturned(p, view) {
    const ts = turnStrengthOf(view);
    if (!(ts > 0)) return p;
    const g = viewGain(view, this.o);
    const { eye } = this.turn.offsets({ x: Math.abs(g.x), y: Math.abs(g.y) }, ts, this.lat);
    return { x: p.x - eye.x, y: p.y - eye.y, z: p.z - eye.z };
  }

  /**
   * The head turn's part of the mapped point (view metres; zero unless Look
   * around with head turn on): its steering, minus its own eye movement as
   * the position mapping would have moved the view for it. It changes only
   * with the held pose, so it carries no noise, and away from a downward
   * glance it moves one way through a turn (head-turn.js), as the eye's own
   * mapped movement does: EyeTrack passes it around Smooth follow's
   * dead-band, which is for the head's sway (the eye part still goes
   * through it).
   */
  turnOffset(view) {
    const ts = turnStrengthOf(view);
    if (!(ts > 0)) return { x: 0, y: 0, z: 0 };
    const g = viewGain(view, this.o);
    const { steer, eye } = this.turn.offsets({ x: Math.abs(g.x), y: Math.abs(g.y) }, ts, this.lat);
    return { x: steer.x - g.x * eye.x, y: steer.y - g.y * eye.y, z: steer.z - g.z * eye.z };
  }

  /**
   * The part of turnOffset that EyeTrack passes around Smooth follow's
   * dead-band: all of it, except while glancing down, when the extra eye
   * movement the glance cancels goes through the band with the eye.
   */
  turnBypass(view) {
    const ts = turnStrengthOf(view);
    if (!(ts > 0)) return { x: 0, y: 0, z: 0 };
    const g = viewGain(view, this.o);
    const { steer, eyeBypass } = this.turn.offsets({ x: Math.abs(g.x), y: Math.abs(g.y) }, ts, this.lat);
    return { x: steer.x - g.x * eyeBypass.x, y: steer.y - g.y * eyeBypass.y, z: steer.z - g.z * eyeBypass.z };
  }

  /** Ask for a re-centre at the next sample. */
  requestRecentre() {
    this.recentreWanted = true;
  }

  /** Re-centre now: the rest point becomes where the eye is, the rest pose where the face points. */
  recentre() {
    this.turn.recentre();
    const t = this.recent.at(-1)?.t;
    if (t === undefined) return;
    const m = this.#mean(t - this.o.recentreMs);
    this.rest = { x: m.x, y: m.y, z: m.z };
    this.seeded = true;
    this.stillSince = t;
  }

  /**
   * Switching eyes: the tracked point moves by d (display metres) and its
   * offset from the head's midline becomes lat. Returns how far the mapped
   * point moves because of it (d, plus the change of the head turn's part,
   * which depends on the eye) and the turn's part from now on, for
   * EyeTrack.shift.
   */
  switchEye(d, lat, view) {
    const before = this.turnOffset(view);
    this.shiftRest(d);
    this.lat = Number.isFinite(lat) ? lat : 0;
    const after = this.turnOffset(view);
    return { shift: { x: d.x + after.x - before.x, y: d.y + after.y - before.y, z: d.z + after.z - before.z }, offset: this.turnBypass(view) };
  }

  /** The tracked point moved on purpose by d (switching eyes): so did the viewer's rest. */
  shiftRest(d) {
    if (this.rest) for (const k of AX) this.rest[k] += d[k];
    for (const q of this.recent) for (const k of AX) q.p[k] += d[k];
  }

  /** Keep a viewpoint where the scenes hold up and in front of the glass. */
  clamp(p) {
    return clampToCone(p, this.o.limits);
  }

  /**
   * The viewpoint for a tracked eye p under view { direction, strength,
   * turn? }, about `rest` (default: the current rest point). With head turn
   * on, the turn's eye movement comes out of p and its steering is added.
   */
  map(p, view, rest = this.rest) {
    if (!finite3(rest) || isExact(view)) return this.clamp(p);
    const g = viewGain(view, this.o);
    const turn = this.turnOffset(view);
    const q = {};
    for (const k of AX) q[k] = rest[k] + g[k] * (p[k] - rest[k]) + turn[k];
    return this.clamp(q);
  }
}

// ---------------------------------------------------------------- stations
//
// A place in a scene may limit head tracking there (docs/ARCHITECTURE.md,
// station `view`): far scenes act like a long lens, where an eye moved off
// centre mostly pans the picture, so a typical rise at 3x x 1.5 swings a
// distant subject out of frame. At a station:
//   - the strength used is min(the viewer's Strength, maxStrength);
//   - verticalBoost replaces Look around's 1.5x up and down;
//   - the rendered eye is at most maxEyeZ from the glass.
// The mapping is linear about the rest point, so the limited eye is the
// mapped eye's offset from the rest point scaled per axis by the ratio of
// the limited gain to the viewer's gain. That includes head turn's steering
// (scaled the same way), and it is applied after the motion filter, every
// frame, so the limits can be blended smoothly over a glide.

/** A station's view limits, checked: { maxStrength, verticalBoost, maxEyeZ } (missing: null). */
export function stationLimits(v) {
  if (!v || typeof v !== 'object') return null;
  const pos = (x) => (Number.isFinite(x) && x > 0 ? x : null);
  const out = {
    maxStrength: pos(v.maxStrength),
    verticalBoost: Number.isFinite(v.verticalBoost) && v.verticalBoost >= 0 ? v.verticalBoost : null,
    maxEyeZ: pos(v.maxEyeZ),
  };
  return out.maxStrength === null && out.verticalBoost === null && out.maxEyeZ === null ? null : out;
}

/** Per-axis gains for a direction, a strength and an up-and-down boost (Look around only). */
function gainsFor(direction, g, yBoost, o) {
  const look = direction === 'look';
  const s = look ? -1 : 1;
  return { x: s * g, y: s * g * (look ? yBoost : 1), z: s * (1 + (g - 1) * o.zGainShare) };
}

/**
 * How a station's limits scale the mapped eye's offset from the rest point,
 * per axis (1, 1, 1 without limits), for the viewer's view setting.
 */
export function limitRatio(view, limits, o = VIEW_DEFAULTS) {
  // True window is never held in (it stays exact, for filming): only the
  // distance cap applies there (limitEye).
  if (!limits || view?.direction === 'window' || view?.direction === undefined) return { x: 1, y: 1, z: 1 };
  if (view.direction === 'mouse') {
    // The mouse standing in for the head: its pointer moves the eye
    // `strength` times as far sideways and up and down, with no extra up and
    // down to replace; its distance does not change.
    const g = view.strength > 0 ? view.strength : 1;
    const r = limits.maxStrength !== null ? Math.min(g, limits.maxStrength) / g : 1;
    return { x: r, y: r, z: 1 };
  }
  const g = strengthOf(view);
  const gl = limits.maxStrength !== null ? Math.min(g, limits.maxStrength) : g;
  const yb = limits.verticalBoost !== null ? limits.verticalBoost : o.yGainLook;
  const a = gainsFor('look', g, o.yGainLook, o);
  const b = gainsFor('look', gl, yb, o);
  return { x: b.x / a.x, y: b.y / a.y, z: b.z / a.z };
}

/**
 * Keep a viewpoint where the scenes hold up and in front of the glass: the
 * view cone (VIEW_DEFAULTS.limits), which narrows as the eye comes closer.
 */
export function clampToCone(p, L = VIEW_DEFAULTS.limits) {
  const z = clamp(p.z, L.zMin, L.zMax);
  const xm = Math.min(L.x, (L.xPerZ ?? Infinity) * z);
  const ym = (L.yPerZ ?? Infinity) * z;
  return { x: clamp(p.x, -xm, xm), y: clamp(p.y, Math.max(L.yMin, -ym), Math.min(L.yMax, ym)), z };
}

/**
 * The limits in force: a weighted mix of stations' limits (RigMotion.viewMix,
 * weights summing to 1) blended as ratios and eye distances, so a glide from
 * one station to another changes them smoothly.
 * @returns {{ratio:{x,y,z}, maxEyeZ:number}}
 */
export function blendLimits(mix, view, o = VIEW_DEFAULTS) {
  const ratio = { x: 0, y: 0, z: 0 };
  let maxEyeZ = 0;
  let total = 0;
  // No cap: one knee beyond the view cone's own limit, so the eased cap
  // changes nothing the cone allows (and blends from there continuously).
  const none = o.limits.zMax + EYE_Z_KNEE;
  for (const { view: v, w } of mix || []) {
    const lim = stationLimits(v);
    const r = limitRatio(view, lim, o);
    for (const k of AX) ratio[k] += w * r[k];
    maxEyeZ += w * (lim?.maxEyeZ ?? none);
    total += w;
  }
  if (!(total > 0)) return { ratio: { x: 1, y: 1, z: 1 }, maxEyeZ: none };
  for (const k of AX) ratio[k] /= total;
  return { ratio, maxEyeZ: maxEyeZ / total };
}

/** How far below maxEyeZ the cap starts to ease in (m). */
export const EYE_Z_KNEE = 0.04;

/**
 * The distance cap: z unchanged up to maxEyeZ - knee, then eased toward
 * maxEyeZ without ever reaching past it (continuous in value and slope, so
 * an eye leaning in, or a cap blended down over a glide, never jerks).
 */
export function capEyeZ(z, maxEyeZ, knee = EYE_Z_KNEE) {
  const u = z - (maxEyeZ - knee);
  return u <= 0 ? z : maxEyeZ - knee * Math.exp(-u / knee);
}

/** The mapped eye q limited about the rest point: offset scaled by ratio, distance capped. */
export function limitEye(q, rest, { ratio, maxEyeZ }, o = VIEW_DEFAULTS) {
  const out = { x: q.x, y: q.y, z: q.z };
  // (An axis not held in is left alone: rest + 1 (q - rest) is not always q
  // in floating point, and True window must stay bit for bit.)
  if (finite3(rest)) for (const k of AX) if (ratio[k] !== 1) out[k] = rest[k] + ratio[k] * (q[k] - rest[k]);
  out.z = capEyeZ(out.z, maxEyeZ);
  // Back inside the view cone at the eye's final distance: an up-and-down
  // boost above 1.5x can take the eye past it, and a nearer eye (the cap)
  // has a narrower cone. (The cap is under the cone's own far limit, so this
  // never moves the distance back out; a point the cone holds is unchanged.)
  return clampToCone(out, o.limits);
}

/**
 * Applies the limits every frame. The rest point it scales about is
 * followed smoothly (Re-centre and switching eyes move the tracker's rest
 * point at once; the tracker glides the eye across that, and this follows).
 */
export class StationLimiter {
  constructor({ tauMs = 300, o = VIEW_DEFAULTS } = {}) {
    this.tauMs = tauMs;
    this.o = o;
    this.pivot = null;
    this.last = null; // { ratio, maxEyeZ } used on the last frame
  }

  reset() {
    this.pivot = null;
  }

  /**
   * @param {{x,y,z}} q the rendered eye before the limits (display coordinates)
   * @param {{x,y,z}|null} rest the rest point it was mapped about
   * @param {object} view the viewer's view setting ({ direction, strength })
   * @param {{view:object, w:number}[]} mix the stations' limits in force
   * @param {number} dtMs frame time
   */
  apply(q, rest, view, mix, dtMs) {
    if (finite3(rest)) {
      if (!this.pivot) this.pivot = { ...rest };
      else {
        const k = 1 - Math.exp(-Math.max(0, dtMs) / this.tauMs);
        for (const a of AX) this.pivot[a] += (rest[a] - this.pivot[a]) * k;
      }
    }
    this.last = blendLimits(mix, view, this.o);
    return limitEye(q, this.pivot, this.last);
  }
}

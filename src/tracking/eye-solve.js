// From face landmarks to 3D eye positions in camera coordinates.
//
// Camera coordinates follow the computer-vision convention: x right in the raw
// image, y down, z out of the lens toward the viewer, metres.
//
// Geometry: each pupil lies on the ray through its iris centre pixel. With the
// rays r_R, r_L (unit), the eyes are E = s r. Two facts pin down s_R and s_L:
//   |E_L - E_R| = IPD                         (eye spacing, a user setting)
//   (E_L - E_R) . m = IPD sin(yaw)            (head yaw against the line of sight m)
// where yaw comes from the head pose (facial transformation matrix, or landmark
// depths as a fallback). Solved in closed form below; exact when inputs are.

/** MediaPipe face mesh indices (subject's right/left, not the viewer's). */
export const LM = {
  right: { outer: 33, inner: 133, lids: [[159, 145], [158, 153], [160, 144]] },
  left: { outer: 263, inner: 362, lids: [[386, 374], [385, 380], [387, 373]] },
  irisA: { centre: 468, ring: [469, 470, 471, 472] },
  irisB: { centre: 473, ring: [474, 475, 476, 477] },
  forehead: 10,
  chin: 152,
};

/** Average human iris (visible iris) diameter, metres. */
export const IRIS_DIAMETER = 0.0117;
/** Pupil distance from the eye's centre of rotation, metres (for vergence). */
const PUPIL_ROTATION_RADIUS = 0.0105;
/** Eye aspect ratio below which an eye counts as closed. */
export const BLINK_EAR = 0.14;

const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a) => Math.sqrt(dot(a, a));
const scale = (a, s) => v3(a.x * s, a.y * s, a.z * s);
const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const norm = (a) => { const l = len(a) || 1; return v3(a.x / l, a.y / l, a.z / l); };
const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

export const vec = { v3, dot, len, scale, add, sub, norm, cross };

function px(lm, i, W, H) {
  const p = lm[i];
  return { x: p.x * W, y: p.y * H };
}

/** Inter-ocular distance in pixels (outer corners): a face's apparent size. */
export function faceSizePx(lm, W, H) {
  const a = px(lm, LM.right.outer, W, H);
  const b = px(lm, LM.left.outer, W, H);
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function faceCentrePx(lm, W, H) {
  const a = px(lm, LM.right.outer, W, H);
  const b = px(lm, LM.left.outer, W, H);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Choose the face to follow: the largest (nearest), but stick with the one we
 * were following unless another is clearly bigger, so two people at similar
 * distances do not make the view flip between them.
 * @returns {{index:number, centre:{x,y}}|null}
 */
export function pickFace(faces, W, H, prevCentre = null) {
  if (!faces || faces.length === 0) return null;
  let best = 0;
  let bestSize = -1;
  const sizes = faces.map((lm) => faceSizePx(lm, W, H));
  sizes.forEach((s, i) => { if (s > bestSize) { bestSize = s; best = i; } });
  if (prevCentre && faces.length > 1) {
    let near = 0;
    let nearD = Infinity;
    faces.forEach((lm, i) => {
      const c = faceCentrePx(lm, W, H);
      const d = Math.hypot(c.x - prevCentre.x, c.y - prevCentre.y);
      if (d < nearD) { nearD = d; near = i; }
    });
    if (near !== best && sizes[near] >= 0.8 * bestSize && nearD < sizes[near]) best = near;
  }
  return { index: best, centre: faceCentrePx(faces[best], W, H) };
}

/**
 * Head axes in camera coordinates from MediaPipe's facial transformation
 * matrix (canonical face -> MediaPipe metric camera space: x right, y up,
 * z toward the viewer). The canonical face has +x toward the subject's left
 * eye and +y up. Data is column-major.
 * @returns {{axis:{x,y,z}, up:{x,y,z}}} axis: subject's right eye -> left eye.
 */
export function headAxesFromMatrix(data) {
  // Columns 0 and 1 of the rotation (may carry a uniform scale).
  const ax = v3(data[0], data[1], data[2]);
  const up = v3(data[4], data[5], data[6]);
  // MediaPipe metric space -> CV camera space: flip y and z.
  return {
    axis: norm(v3(ax.x, -ax.y, -ax.z)),
    up: norm(v3(up.x, -up.y, -up.z)),
  };
}

/**
 * Head axes from landmark geometry alone (fallback when no matrix). MediaPipe's
 * normalised z grows away from the camera and is scaled like x (image width).
 * With intrinsics, undo the perspective shear of an off-axis face: a depth
 * step dZ at image offset (X/Z) also shifts the image by (X/Z) dZ.
 */
export function headAxesFromLandmarks(lm, W, H, intr = null) {
  const P = (i) => v3(lm[i].x * W, lm[i].y * H, lm[i].z * W);
  let tx = 0;
  let ty = 0;
  if (intr) {
    const c = P(LM.right.outer);
    const d = P(LM.left.outer);
    tx = ((c.x + d.x) / 2 - intr.cx) / intr.fx;
    ty = ((c.y + d.y) / 2 - intr.cy) / intr.fy;
  }
  const metric = (a) => v3(a.x + tx * a.z, a.y + ty * a.z, a.z);
  const a1 = metric(sub(P(LM.left.outer), P(LM.right.outer)));
  const a2 = metric(sub(P(LM.left.inner), P(LM.right.inner)));
  const axis = norm(add(a1, a2));
  // Image "up" for the face is toward the forehead (negative image y).
  let up = metric(sub(P(LM.forehead), P(LM.chin)));
  up = norm(sub(up, scale(axis, dot(up, axis))));
  return { axis, up };
}

/**
 * Where the face points, in display terms (degrees): yaw > 0 when the face is
 * turned to the viewer's own right (display +x), pitch > 0 when it is tilted
 * up (display +y). Facing the screen straight on is 0, 0. Roll is left out.
 * Head axes are in camera coordinates (headAxesFromMatrix/headAxesFromLandmarks);
 * the face's forward direction is axis x up (canonical x cross y = z, out of
 * the face), and camera -> display flips x and y.
 * @returns {{yaw:number, pitch:number}|null}
 */
export function headAngles(axes) {
  if (!axes?.axis || !axes?.up) return null;
  const f = cross(axes.axis, axes.up);
  const x = -f.x;
  const y = -f.y;
  const z = f.z; // display z points at the viewer; facing the screen is -z
  if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) return null;
  const deg = 180 / Math.PI;
  return { yaw: Math.atan2(x, -z) * deg, pitch: Math.atan2(y, Math.hypot(x, z)) * deg };
}

/**
 * Per-eye pixel positions of the pupils.
 *
 * Two sources:
 *   'stable' (default): the eye-corner midpoint plus where the iris sits
 *     relative to the corners on average (time constant ~2 s). Saccades move
 *     the iris by a few pixels several times a second; the corners do not move
 *     with gaze, so the viewpoint does not twitch when the viewer looks around,
 *     yet it still lands on the pupil for this viewer's anatomy.
 *   'iris': the live iris centre, held from the corners during blinks.
 * Either way a blink (iris landmarks become guesses) never moves the point.
 */
export class EyeObserver {
  constructor({ source = 'stable', averageSeconds = 2 } = {}) {
    this.source = source;
    this.averageSeconds = averageSeconds;
    this.reset();
  }

  reset() {
    this.offset = { right: null, left: null }; // recent iris offset (blink hold)
    this.average = { right: null, left: null }; // slow average iris offset
    this.t = null;
  }

  /** @param {number} [tSec] frame time in seconds (for the slow average) */
  observe(lm, W, H, tSec = null) {
    const dt = tSec !== null && this.t !== null ? Math.max(0, Math.min(tSec - this.t, 0.5)) : 1 / 30;
    if (tSec !== null) this.t = tSec;
    const cA = px(lm, LM.irisA.centre, W, H);
    const cB = px(lm, LM.irisB.centre, W, H);
    const midR = mid2(px(lm, LM.right.outer, W, H), px(lm, LM.right.inner, W, H));
    // Assign iris centres to eyes by proximity: robust to index conventions.
    const aIsRight = dist2(cA, midR) <= dist2(cB, midR);
    const irisR = aIsRight ? LM.irisA : LM.irisB;
    const irisL = aIsRight ? LM.irisB : LM.irisA;
    return {
      right: this.#eye('right', lm, W, H, LM.right, irisR, dt),
      left: this.#eye('left', lm, W, H, LM.left, irisL, dt),
    };
  }

  #eye(side, lm, W, H, eye, iris, dt) {
    const o = px(lm, eye.outer, W, H);
    const n = px(lm, eye.inner, W, H);
    const m = mid2(o, n);
    const ew = Math.hypot(n.x - o.x, n.y - o.y) || 1;
    const e1 = { x: (n.x - o.x) / ew, y: (n.y - o.y) / ew };
    const e2 = { x: -e1.y, y: e1.x };
    let ear = 0;
    for (const [u, d] of eye.lids) {
      const a = px(lm, u, W, H);
      const b = px(lm, d, W, H);
      ear += Math.hypot(a.x - b.x, a.y - b.y);
    }
    ear /= eye.lids.length * ew;
    const c = px(lm, iris.centre, W, H);
    // Iris diameter: the largest distance between ring points. The ring is a
    // circle seen slightly obliquely; its longest chord is the true diameter.
    const r = iris.ring.map((i) => px(lm, i, W, H));
    let diam = 0;
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
      diam = Math.max(diam, Math.hypot(r[i].x - r[j].x, r[i].y - r[j].y));
    }
    const open = ear > BLINK_EAR;
    // Iris position in the eye's own frame, in eye widths.
    const local = { x: ((c.x - m.x) * e1.x + (c.y - m.y) * e1.y) / ew, y: ((c.x - m.x) * e2.x + (c.y - m.y) * e2.y) / ew };
    const fromCorners = (q) => ({ x: m.x + (q.x * e1.x + q.y * e2.x) * ew, y: m.y + (q.x * e1.y + q.y * e2.y) * ew });
    const prev = this.offset[side];
    const avg = this.average[side];
    if (open) {
      this.offset[side] = prev ? lerp2(prev, local, 0.5) : local;
      const k = avg ? 1 - Math.exp(-dt / this.averageSeconds) : 1;
      this.average[side] = avg ? lerp2(avg, local, k) : local;
    }
    let p;
    if (this.source === 'iris') {
      p = open || !prev ? c : fromCorners(prev);
    } else {
      p = this.average[side] ? fromCorners(this.average[side]) : c;
    }
    return { u: p.x, v: p.y, open, ear, irisDiamPx: diam, eyeWidthPx: ew, irisPx: c, cornerMidPx: m };
  }
}

function lerp2(a, b, k) { return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }; }
function mid2(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
function dist2(a, b) { return (a.x - b.x) ** 2 + (a.y - b.y) ** 2; }

/** Unit ray through pixel (u, v). */
export function pixelRay(u, v, intr) {
  return norm(v3((u - intr.cx) / intr.fx, (v - intr.cy) / intr.fy, 1));
}

/**
 * Pupil spacing while looking at something `d` metres away: the eyes turn in,
 * and the pupils sit ~10.5 mm in front of the centre of rotation.
 */
export function convergedIpd(ipd, d) {
  const h = ipd / 2;
  return ipd - (2 * PUPIL_ROTATION_RADIUS * h) / Math.sqrt(d * d + h * h);
}

/**
 * Closed-form eye positions from two pupil rays.
 * @param {{x,y,z}} rR unit ray to the subject's right pupil
 * @param {{x,y,z}} rL unit ray to the subject's left pupil
 * @param {number} ipd pupil spacing (m)
 * @param {{x,y,z}} axis unit head axis, right eye -> left eye (camera coords)
 */
export function eyesFromRays(rR, rL, ipd, axis) {
  const mDir = norm(add(rR, rL));
  const k = dot(rL, mDir); // cos(theta/2)
  const c = dot(rL, rR); // cos(theta)
  let sinYaw = dot(axis, mDir);
  sinYaw = Math.max(-0.9, Math.min(0.9, sinYaw));
  const delta = (ipd * sinYaw) / k; // s_L - s_R
  const oneMinusC = Math.max(1 - c, 1e-12);
  const m2 = (ipd * ipd - (delta * delta * (1 + c)) / 2) / (2 * oneMinusC);
  const m = Math.sqrt(Math.max(m2, 1e-8));
  const sL = m + delta / 2;
  const sR = m - delta / 2;
  return { right: scale(rR, sR), left: scale(rL, sL), sinYaw, distance: m };
}

/**
 * Full solve for one face.
 * @param {object} obs   from EyeObserver.observe
 * @param {object} intr  camera intrinsics {fx, fy, cx, cy}
 * @param {{axis,up}} axes head axes (camera coords)
 * @param {number} ipd   far pupil distance (m), already fused if desired
 * @returns {{right, left, centre, sinYaw, distance, irisDistance, ipdUsed, axes}}
 */
export function solveEyes(obs, intr, axes, ipd) {
  const rR = pixelRay(obs.right.u, obs.right.v, intr);
  const rL = pixelRay(obs.left.u, obs.left.v, intr);
  let sol = eyesFromRays(rR, rL, ipd, axes.axis);
  // Pupils converge on the screen, which is roughly as far as the face is.
  const ipdNear = convergedIpd(ipd, sol.distance);
  sol = eyesFromRays(rR, rL, ipdNear, axes.axis);
  const centre = scale(add(sol.right, sol.left), 0.5);
  // Independent depth cue: visible iris diameter (both eyes open only).
  let irisDistance = null;
  if (obs.right.open && obs.left.open) {
    const dPx = (obs.right.irisDiamPx + obs.left.irisDiamPx) / 2;
    if (dPx > 2) {
      const f = (intr.fx + intr.fy) / 2;
      // A disc facing the camera at distance s along a ray theta off-axis images
      // at f D / (s cos theta) across the ray (and slightly larger along it).
      const zIris = (f * IRIS_DIAMETER) / dPx;
      const dir = norm(centre);
      irisDistance = zIris / Math.max(dir.z, 0.5);
    }
  }
  return {
    right: sol.right,
    left: sol.left,
    centre,
    sinYaw: sol.sinYaw,
    distance: len(centre),
    irisDistance,
    ipdUsed: ipdNear,
    axes,
  };
}

/**
 * The viewpoint to render from, in camera coordinates.
 * @param {'both'|'left'|'right'|'phone'} mode
 * @param {{eye:'left'|'right', rightMm:number, upMm:number, forwardMm:number}} phone
 *   offset of a phone lens from one eye, in the viewer's head frame: right as the
 *   viewer sees it, up, and forward (toward the screen).
 */
export function eyePoint(sol, mode, phone) {
  if (mode === 'left') return sol.left;
  if (mode === 'right') return sol.right;
  if (mode !== 'phone') return sol.centre;
  const base = phone.eye === 'left' ? sol.left : sol.right;
  // Viewer's right in camera coords: from their left eye to their right eye.
  const right = norm(sub(sol.right, sol.left));
  const up = norm(sub(sol.axes.up, scale(right, dot(sol.axes.up, right))));
  // Forward (toward the camera / screen) is -z-ish in camera coords: right x up
  // with right = -axis. right x up points out of the face, toward the camera.
  const fwd = norm(cross(right, up));
  const towardScreen = fwd.z < 0 ? fwd : scale(fwd, -1);
  const mm = 0.001;
  return add(base, add(scale(right, phone.rightMm * mm), add(scale(up, phone.upMm * mm), scale(towardScreen, phone.forwardMm * mm))));
}

/**
 * Keeps the gaze-stable eye point on the pupil when the head turns.
 *
 * The 'stable' pixel point is the eye corners plus where the iris sat
 * relative to them over the last ~2 s. Turn the head while looking at the
 * screen and the eye counter-rotates in the head, so the pupil really moves
 * (10.5 mm x sin of the turn) while the average only creeps after it: 2.7 mm
 * off after a 20 deg turn, settling over 4 s. Model it instead: average the
 * direction from the eye to the screen in head coordinates with the same time
 * constant; the pupil is offset by r x (that direction now - the average,
 * turned with the head). Exact when still, exact once settled, and consistent
 * in between because both averages move together.
 */
export class GazeCompensator {
  constructor({ averageSeconds = 2, radius = PUPIL_ROTATION_RADIUS } = {}) {
    this.averageSeconds = averageSeconds;
    this.radius = radius;
    this.reset();
  }

  reset() {
    this.avg = { right: null, left: null }; // gaze direction, head coordinates
    this.t = null;
  }

  /**
   * @param {object} sol from solveEyes (camera coords, metres)
   * @param {{x,y,z}} target what the viewer looks at, camera coords (the screen)
   * @param {{left:boolean, right:boolean}} open which eyes are open
   * @param {number} tSec frame time (s)
   * @returns {{right, left}} corrected eye positions
   */
  apply(sol, target, open, tSec) {
    const dt = this.t === null ? 1 / 30 : Math.max(0, Math.min(tSec - this.t, 0.5));
    this.t = tSec;
    const k = 1 - Math.exp(-dt / this.averageSeconds);
    const ax = norm(sol.axes.axis);
    const up = norm(sub(sol.axes.up, scale(ax, dot(sol.axes.up, ax))));
    const fw = cross(ax, up);
    const toHead = (v) => v3(dot(v, ax), dot(v, up), dot(v, fw));
    const toCam = (q) => add(add(scale(ax, q.x), scale(up, q.y)), scale(fw, q.z));
    const out = {};
    for (const side of ['right', 'left']) {
      const e = sol[side];
      const g = norm(sub(target, e));
      const gh = toHead(g);
      const prev = this.avg[side];
      if (open[side]) this.avg[side] = prev ? norm(add(prev, scale(sub(gh, prev), k))) : gh;
      const a = this.avg[side] || gh;
      out[side] = add(e, scale(sub(g, toCam(a)), this.radius));
    }
    return out;
  }
}

/**
 * Which eye to render from in one-eye mode. With autoEye it follows the open
 * eye, but only on clear evidence: the chosen eye shut for over 500 ms while
 * the other has been open for over 150 ms. A long blink with one lid opening
 * a little early (both shut ~450 ms) then never flips the view 63 mm to the
 * other eye. Both open for 1.5 s: back to the chosen eye.
 */
export class EyeChooser {
  constructor({ shutMs = 500, openMs = 150, backMs = 1500 } = {}) {
    this.shutMs = shutMs;
    this.openMs = openMs;
    this.backMs = backMs;
    this.reset();
  }

  reset() {
    this.closedSince = { left: null, right: null };
    this.openSince = { left: null, right: null };
    this.current = null;
    this.bothOpenSince = null;
  }

  /**
   * @param {{eyeMode:string, eye:'left'|'right', autoEye:boolean}} cfg
   * @param {{left:{open:boolean}, right:{open:boolean}}} obs
   * @param {number} t ms
   * @returns {'left'|'right'|'both'|'phone'}
   */
  choose(cfg, obs, t) {
    if (cfg.eyeMode === 'both' || cfg.eyeMode === 'phone') return cfg.eyeMode;
    const want = cfg.eye === 'left' ? 'left' : 'right';
    const other = want === 'left' ? 'right' : 'left';
    for (const side of ['left', 'right']) {
      if (obs[side].open) {
        this.closedSince[side] = null;
        this.openSince[side] ??= t;
      } else {
        this.openSince[side] = null;
        this.closedSince[side] ??= t;
      }
    }
    if (!cfg.autoEye) {
      this.current = want;
      return want;
    }
    const shut = (s) => this.closedSince[s] !== null && t - this.closedSince[s] > this.shutMs;
    const open = (s) => this.openSince[s] !== null && t - this.openSince[s] > this.openMs;
    if (shut(want) && open(other)) this.current = other;
    else if (shut(other) && open(want)) this.current = want;
    else if (!this.current) this.current = want;
    // Both open for a while: back to the chosen eye.
    if (this.current !== want && obs.left.open && obs.right.open) {
      this.bothOpenSince ??= t;
      if (t - this.bothOpenSince > this.backMs) this.current = want;
    } else {
      this.bothOpenSince = null;
    }
    return this.current;
  }
}

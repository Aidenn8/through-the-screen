// Head turn (src/tracking/head-turn.js through src/tracking/view-map.js):
// where the face points steers Look around, in the same directions as the
// head's position; a dead-band, a rest pose that holds through a held turn,
// R, True window ignoring the pose, no jump when the face is lost or found,
// no noise while still, and a turn counted once.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ViewMapper, viewGain, turnStrengthOf } from '../src/tracking/view-map.js';
import { TURN_DEFAULTS, turnPoint } from '../src/tracking/head-turn.js';
import { EyeTrack } from '../src/tracking/predictor.js';
import { appTrack, missedTurnTargets, tiltHold, POSE_NOISE } from '../tools/core-motion.mjs';

// A seated head: the neck pivot at SEAT, the tracked (right) eye 8 cm in front
// of it and 7.5 cm above, turned with the head (the code's neck model).
const PIV = TURN_DEFAULTS.pivot;
const LAT = 0.0315;
const SEAT = { x: 0, y: -0.045, z: 0.68 };
const R = { x: LAT, y: PIV.up, z: -PIV.forward };
const REST = { yaw: 0, pitch: -4 };
const head = (yaw, pitch, at = SEAT) => {
  const e = turnPoint(R, yaw, pitch);
  return { p: { x: at.x + e.x, y: at.y + e.y, z: at.z + e.z }, pose: { yaw, pitch } };
};
const LOOK = { direction: 'look', strength: 3, turn: { on: true, strength: 1 } };
const LOOK_OFF = { direction: 'look', strength: 3, turn: { on: false, strength: 1 } };
const mj = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : 10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5);
const DT = 33.3;

/** Feed the mapper a head from `from` to `to` ({yaw, pitch, at}) over ms, then hold; returns the last step and time. */
function move(vm, view, t, from, to, ms = 500, holdMs = 1500, noise = null) {
  let last = null;
  const end = t + ms + holdMs;
  for (; t < end; t += DT) {
    const u = mj((t - (end - ms - holdMs)) / ms);
    const lerp = (a, b) => a + (b - a) * u;
    const at = { x: lerp(from.at?.x ?? SEAT.x, to.at?.x ?? SEAT.x), y: lerp(from.at?.y ?? SEAT.y, to.at?.y ?? SEAT.y), z: lerp(from.at?.z ?? SEAT.z, to.at?.z ?? SEAT.z) };
    const h = head(lerp(from.yaw, to.yaw), lerp(from.pitch, to.pitch), at);
    const pose = noise ? { yaw: h.pose.yaw + noise(), pitch: h.pose.pitch + noise() } : h.pose;
    last = vm.step(t, h.p, view, pose, LAT);
  }
  return { t, m: last };
}

/** A seated viewer at rest for 2 s. */
function seated(view = LOOK, noise = null) {
  const vm = new ViewMapper();
  const { t, m } = move(vm, view, 0, REST, REST, 0, 2000, noise);
  return { vm, t, m };
}

function gauss(seed = 3, sd = 1) {
  let s = seed;
  const u = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  return () => sd * Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

// From an eye at e (display coordinates), the window shows the scene at depth
// D behind the glass between these heights: lower eye, higher top edge.
const SCREEN_H = 0.2;
const shownAt = (e, D = 0.5) => ({
  top: SCREEN_H / 2 + (SCREEN_H / 2 - e.y) * (D / e.z),
  bottom: -SCREEN_H / 2 + (-SCREEN_H / 2 - e.y) * (D / e.z),
  right: 0.16 + (0.16 - e.x) * (D / e.z),
  left: -0.16 + (-0.16 - e.x) * (D / e.z),
});

test('head turn: tilting back shows more of the top, looking down the bottom, turning right the right side, left the left: the same way as rising and leaning', () => {
  const cases = [
    // [name, pose change, position change that Look around already maps the same way, edge that must show more]
    ['tilt up 15', { yaw: 0, pitch: REST.pitch + 15 }, { y: 0.03 }, 'top', +1],
    ['look down 15', { yaw: 0, pitch: REST.pitch - 15 }, { y: -0.03 }, 'bottom', -1],
    ['turn right 20', { yaw: 20, pitch: REST.pitch }, { x: 0.06 }, 'right', +1],
    ['turn left 20', { yaw: -20, pitch: REST.pitch }, { x: -0.06 }, 'left', -1],
  ];
  for (const [name, pose, shift, edge, sign] of cases) {
    const { vm, t, m: m0 } = seated();
    const before = m0.p;
    const turned = move(vm, LOOK, t, REST, pose).m.p;
    // The same seat moved instead (rising, ducking, leaning), head turn off.
    const s = seated(LOOK_OFF);
    const at = { x: SEAT.x + (shift.x ?? 0), y: SEAT.y + (shift.y ?? 0), z: SEAT.z };
    const moved = move(s.vm, LOOK_OFF, s.t, { ...REST, at: SEAT }, { ...REST, at }).m.p;
    const k = shift.x !== undefined ? 'x' : 'y';
    const dTurn = turned[k] - before[k];
    const dMove = moved[k] - s.m.p[k];
    assert.ok(Math.abs(dTurn) > 0.1, `${name}: the view moved ${(dTurn * 1000).toFixed(0)} mm`);
    assert.equal(Math.sign(dTurn), Math.sign(dMove), `${name}: turn ${(dTurn * 1000).toFixed(0)} mm, position ${(dMove * 1000).toFixed(0)} mm`);
    // Rising moves the viewpoint down, leaning right moves it left: the opposite way to the head.
    assert.equal(Math.sign(dTurn), -sign, `${name}: viewpoint moves ${dTurn > 0 ? '+' : '-'}${k}`);
    // And from there the window shows more of that side of the scene.
    const a = shownAt(before);
    const b = shownAt(turned);
    assert.ok(sign * (b[edge] - a[edge]) > 0.05, `${name}: ${edge} edge ${(a[edge] * 100).toFixed(1)} -> ${(b[edge] * 100).toFixed(1)} cm`);
  }
});

test('head turn: rising and tilting back together (or ducking and looking down) move the view about 40 cm at the defaults, inside the view limits', () => {
  for (const [name, dy, dp] of [['rise 4 cm, tilt up 15', 0.04, 15], ['duck 4 cm, look down 15', -0.04, -15]]) {
    const { vm, t, m: m0 } = seated();
    const { m } = move(vm, LOOK, t, { ...REST, at: SEAT }, { yaw: 0, pitch: REST.pitch + dp, at: { x: SEAT.x, y: SEAT.y + dy, z: SEAT.z } });
    const d = m.p.y - m0.p.y;
    // Unclamped, as the mapping would put it.
    const raw = vm.rest.y + viewGain(LOOK).y * (head(0, REST.pitch + dp, { x: SEAT.x, y: SEAT.y + dy, z: SEAT.z }).p.y - vm.rest.y) + vm.turnOffset(LOOK).y;
    console.log(`  ${name}: view ${(d * 100).toFixed(1)} cm, at ${(m.p.y * 100).toFixed(1)} cm (unclamped ${(raw * 100).toFixed(1)})`);
    assert.ok(Math.sign(d) === -Math.sign(dy) && Math.abs(d) > 0.36 && Math.abs(d) < 0.46, `${name}: ${(d * 100).toFixed(1)} cm`);
    assert.ok(Math.abs(m.p.y - raw) < 1e-9, `${name}: clipped at ${(m.p.y * 100).toFixed(1)} cm`);
  }
});

test('head turn: a dead-band of a few degrees (small turns do nothing), then a soft limit', () => {
  const B = TURN_DEFAULTS.bandDeg;
  assert.ok(B.pitch >= 3 && B.pitch <= 6 && B.yaw >= 3 && B.yaw <= 6, JSON.stringify(B));
  const small = [{ yaw: B.yaw - 1, pitch: REST.pitch }, { yaw: -(B.yaw - 1), pitch: REST.pitch }, { yaw: 0, pitch: REST.pitch + B.pitch - 1 }, { yaw: 0, pitch: REST.pitch - (B.pitch - 1) }];
  for (const pose of small) {
    const { vm, t } = seated();
    const { m } = move(vm, LOOK, t, REST, pose);
    assert.deepEqual(m.offset, { x: 0, y: 0, z: 0 }, `${JSON.stringify(pose)}: ${JSON.stringify(m.offset)}`);
    // Exactly what head turn off would show.
    assert.deepEqual(vm.map(head(pose.yaw, pose.pitch).p, LOOK), vm.map(head(pose.yaw, pose.pitch).p, LOOK_OFF));
  }
  // Past the band it grows, ever more slowly, toward the soft limit (1x: 25 cm up or down, 30 cm sideways).
  const steer = (deg) => {
    const { vm, t } = seated();
    move(vm, LOOK, t, REST, { yaw: 0, pitch: REST.pitch + deg });
    return -vm.turn.offsets({ x: 3, y: 4.5 }, 1).steer.y;
  };
  const past = [2, 6, 12, 24, 60];
  const s = past.map((d) => steer(B.pitch + d));
  const mm = s.map((v) => (v * 1000).toFixed(0)).join(', ');
  for (let i = 1; i < s.length; i++) {
    assert.ok(s[i] > s[i - 1], mm);
    if (i > 1) assert.ok((s[i] - s[i - 1]) / (past[i] - past[i - 1]) < (s[i - 1] - s[i - 2]) / (past[i - 1] - past[i - 2]), `flattens: ${mm}`);
  }
  // 2 degrees past the band: close to the small-turn gain (2.5 cm a degree up and down).
  assert.ok(Math.abs(s[0] - 2 * TURN_DEFAULTS.gain.y) < 0.004, mm);
  assert.ok(s.at(-1) < TURN_DEFAULTS.limit.y + 1e-9 && s.at(-1) > 0.95 * TURN_DEFAULTS.limit.y, mm);
  // Turn strength scales the whole curve.
  const { vm, t } = seated();
  move(vm, LOOK, t, REST, { yaw: 15, pitch: REST.pitch });
  const one = vm.turn.offsets({ x: 3, y: 4.5 }, 1).steer.x;
  const two = vm.turn.offsets({ x: 3, y: 4.5 }, 2).steer.x;
  assert.ok(Math.abs(two - 2 * one) < 1e-12 && one < -0.1, `${one} ${two}`);
});

test('head turn: a held tilt holds (rest pose and rest point stay put, the view does not drift back), as a held lean does', () => {
  const noise = gauss(5, 0.75);
  const { vm, t } = seated(LOOK, noise);
  const restPose = { ...vm.turn.rest };
  const restPoint = { ...vm.rest };
  let { t: t1, m } = move(vm, LOOK, t, REST, { yaw: 8, pitch: REST.pitch + 15 }, 500, 3000, noise);
  const settled = m.p;
  // Hold for 20 s more.
  const out = [];
  for (const end = t1 + 20000; t1 < end; t1 += DT) {
    const h = head(8, REST.pitch + 15);
    out.push(vm.step(t1, h.p, LOOK, { yaw: 8 + noise(), pitch: REST.pitch + 15 + noise() }, LAT).p);
  }
  const drift = Math.hypot(vm.turn.rest.yaw - restPose.yaw, vm.turn.rest.pitch - restPose.pitch);
  const restMoved = Math.hypot(vm.rest.x - restPoint.x, vm.rest.y - restPoint.y, vm.rest.z - restPoint.z);
  const ys = out.map((p) => p.y - settled.y);
  console.log(`  held 15 deg tilt 20 s: rest pose moved ${drift.toFixed(2)} deg, rest point ${(restMoved * 1000).toFixed(2)} mm, mapped view y ${(Math.min(...ys) * 1000).toFixed(1)}..${(Math.max(...ys) * 1000).toFixed(1)} mm`);
  assert.ok(drift < 0.3, `rest pose moved ${drift.toFixed(2)} deg`);
  assert.ok(restMoved < 0.001, `rest point moved ${(restMoved * 1000).toFixed(2)} mm`);
  // The view holds where it went: only the eye's own noise is left (it goes through Smooth follow's dead-band later).
  assert.ok(Math.max(...ys.map(Math.abs)) < 0.004, `mapped view moved up to ${(Math.max(...ys.map(Math.abs)) * 1000).toFixed(1)} mm`);
  // ...and the turn's part of it does not move at all.
  const off0 = vm.turnOffset(LOOK);
  for (let k = 0; k < 60; k++, t1 += DT) {
    const h = head(8, REST.pitch + 15);
    vm.step(t1, h.p, LOOK, { yaw: 8 + noise(), pitch: REST.pitch + 15 + noise() }, LAT);
  }
  const off1 = vm.turnOffset(LOOK);
  assert.ok(Math.hypot(off1.x - off0.x, off1.y - off0.y) < 0.002, `turn offset moved ${(Math.hypot(off1.x - off0.x, off1.y - off0.y) * 1000).toFixed(2)} mm in 2 s`);
});

test('head turn: R re-centres the pose too (a held tilt becomes the new rest), and the view glides there', () => {
  const { vm, t } = seated();
  let { t: t1, m } = move(vm, LOOK, t, REST, { yaw: -12, pitch: REST.pitch + 14 });
  assert.ok(Math.hypot(m.offset.x, m.offset.y) > 0.1, 'steering before R');
  vm.requestRecentre();
  const h = head(-12, REST.pitch + 14);
  const r = vm.step(t1, h.p, LOOK, h.pose, LAT);
  t1 += DT;
  assert.ok(Math.abs(vm.turn.rest.yaw + 12) < 0.3 && Math.abs(vm.turn.rest.pitch - REST.pitch - 14) < 0.3, JSON.stringify(vm.turn.rest));
  assert.deepEqual(r.offset, { x: 0, y: 0, z: 0 }, 'no steering right after R');
  // The step reports the move, for EyeTrack.shift to glide across.
  assert.ok(r.shift && Math.abs(r.shift.x - (r.p.x - m.p.x)) < 0.003 && Math.abs(r.shift.y - (r.p.y - m.p.y)) < 0.003, JSON.stringify(r.shift));
  // Turning back to where the head was now steers the other way.
  const back = move(vm, LOOK, t1, { yaw: -12, pitch: REST.pitch + 14 }, REST).m;
  assert.ok(back.offset.x < -0.05 && back.offset.y > 0.05, JSON.stringify(back.offset));
});

test('head turn: True window ignores the pose completely (and so does head turn off)', () => {
  for (const view of [{ direction: 'window', strength: 1 }, { direction: 'window', strength: 3 }, { direction: 'window', strength: 2, turn: { on: true, strength: 2 } }]) {
    assert.equal(turnStrengthOf(view), 0);
    const a = new ViewMapper();
    const b = new ViewMapper();
    let t = 0;
    const g = gauss(9, 20);
    for (; t < 6000; t += DT) {
      const h = head(30 * Math.sin(t / 700), -4 + 20 * Math.sin(t / 900), { x: 0.05 * Math.sin(t / 1100), y: SEAT.y, z: SEAT.z });
      const qa = a.step(t, h.p, view, { yaw: g(), pitch: g() }, LAT);
      const qb = b.step(t, h.p, view, null, LAT);
      assert.deepEqual(qa.p, qb.p);
      assert.deepEqual(qa.offset, { x: 0, y: 0, z: 0 });
      if (view.strength === 1) assert.deepEqual(qa.p, a.clamp(h.p), 'True window at 1x is the eye itself');
    }
  }
  const { vm, t } = seated(LOOK_OFF);
  const { m } = move(vm, LOOK_OFF, t, REST, { yaw: 20, pitch: 10 });
  assert.deepEqual(m.offset, { x: 0, y: 0, z: 0 });
  assert.equal(viewGain(LOOK_OFF).y, -4.5, 'up and down get 1.5x the Strength either way');
});

test('head turn: counted once: a turn moves the view by its steering, not also by the eye movement it causes', () => {
  // A pure 15 degree tilt about the neck's pivot lifts the eye ~1.8 cm and
  // moves it ~2.2 cm back: at 4.5x up and down and 2x depth that alone would
  // move the view ~8 cm down and ~4.4 cm in. Only the part inside the
  // dead-band is left to the position.
  const g = viewGain(LOOK);
  for (const pose of [{ yaw: 0, pitch: REST.pitch + 15 }, { yaw: 0, pitch: REST.pitch - 15 }, { yaw: 18, pitch: REST.pitch }, { yaw: -18, pitch: REST.pitch }]) {
    const { vm, t, m: m0 } = seated();
    const { m } = move(vm, LOOK, t, REST, pose);
    const steer = vm.turn.offsets({ x: Math.abs(g.x), y: Math.abs(g.y) }, 1, LAT).steer;
    const B = TURN_DEFAULTS.bandDeg;
    const inBand = {
      yaw: REST.yaw + Math.sign(pose.yaw - REST.yaw) * Math.min(Math.abs(pose.yaw - REST.yaw), B.yaw),
      pitch: REST.pitch + Math.sign(pose.pitch - REST.pitch) * Math.min(Math.abs(pose.pitch - REST.pitch), B.pitch),
    };
    const e0 = turnPoint(R, REST.yaw, REST.pitch);
    const e1 = turnPoint(R, inBand.yaw, inBand.pitch);
    const eFull = turnPoint(R, pose.yaw, pose.pitch);
    const want = { x: g.x * (e1.x - e0.x) + steer.x, y: g.y * (e1.y - e0.y) + steer.y, z: g.z * (e1.z - e0.z) };
    const got = { x: m.p.x - m0.p.x, y: m.p.y - m0.p.y, z: m.p.z - m0.p.z };
    const doubled = { x: g.x * (eFull.x - e0.x) + steer.x, y: g.y * (eFull.y - e0.y) + steer.y, z: g.z * (eFull.z - e0.z) };
    // Within 3 mm: the rest pose is where the head settled (within a fraction of a degree of REST).
    for (const k of ['x', 'y', 'z']) assert.ok(Math.abs(got[k] - want[k]) < 0.003, `${JSON.stringify(pose)} ${k}: ${(got[k] * 1000).toFixed(1)} mm, want ${(want[k] * 1000).toFixed(1)} (counted twice: ${(doubled[k] * 1000).toFixed(1)})`);
    const main = pose.yaw !== 0 ? 'x' : 'y';
    assert.ok(Math.abs(doubled[main] - want[main]) > 0.03, `the eye's own movement would add ${(Math.abs(doubled[main] - want[main]) * 1000).toFixed(0)} mm`);
    assert.ok(Math.abs(got.z) < 0.012, `depth ${(got.z * 1000).toFixed(1)} mm (counted twice: ${(doubled.z * 1000).toFixed(1)})`);
  }
  // And a lean without turning the head does not steer.
  const { vm, t } = seated();
  const { m } = move(vm, LOOK, t, { ...REST, at: SEAT }, { ...REST, at: { x: SEAT.x + 0.15, y: SEAT.y + 0.03, z: SEAT.z - 0.1 } });
  assert.deepEqual(m.offset, { x: 0, y: 0, z: 0 });
});

test('head turn: pose noise while sitting still moves nothing (1 degree a frame, 30 s)', () => {
  const noise = gauss(11, 1);
  const { vm, t } = seated(LOOK, noise);
  const a = new ViewMapper();
  move(a, LOOK_OFF, 0, REST, REST, 0, 2000, noise);
  let t1 = t;
  for (const end = t + 30000; t1 < end; t1 += DT) {
    const h = head(0.4 * Math.sin(t1 / 900), REST.pitch + 0.4 * Math.sin(t1 / 1300));
    const pose = { yaw: h.pose.yaw + noise(), pitch: h.pose.pitch + noise() };
    const on = vm.step(t1, h.p, LOOK, pose, LAT);
    const off = a.step(t1, h.p, LOOK_OFF, pose, LAT);
    assert.deepEqual(on.offset, { x: 0, y: 0, z: 0 });
    assert.deepEqual(on.p, off.p);
  }
});

/**
 * The tracker's path with a pose: ViewMapper.step -> EyeTrack (Smooth
 * follow), 30 Hz samples, 80 ms delay, 60 Hz render. head(t) -> { p, pose }
 * or null (no face). events(t, vm) may return a new view.
 */
function run(headAt, view, events, ms) {
  const vm = new ViewMapper();
  const tr = new EyeTrack(appTrack());
  const out = [];
  let k = 0;
  let v = view;
  for (let t = 0; t < ms; t += 1000 / 60) {
    v = events(t, vm) ?? v;
    while (k * DT + 80 <= t) {
      const tc = k * DT;
      const h = headAt(tc);
      if (!h) tr.miss(tc);
      else {
        const m = vm.step(tc, h.p, v, h.pose, LAT);
        if (m.shift) tr.shift(m.shift, 600, m.offset);
        tr.setGain(m.gain);
        tr.push(tc, m.p, { offset: m.offset });
      }
      k++;
    }
    out.push({ t, p: vm.clamp(tr.sample(t + 30)) });
  }
  return out;
}

const maxStep = (fr) => {
  let w = 0;
  for (let i = 1; i < fr.length; i++) w = Math.max(w, Math.hypot(fr[i].p.x - fr[i - 1].p.x, fr[i].p.y - fr[i - 1].p.y, fr[i].p.z - fr[i - 1].p.z));
  return w;
};

test('head turn: no jump when the face is lost or comes back, even if the head turned meanwhile', () => {
  // Tilted up 15 deg, then in 0.5 s the head turns 20 deg right and tilts
  // back down: the view crosses ~30 cm, up to ~24 mm a frame when tracked
  // throughout. The face is lost for 1.2 s across that turn (a lost face:
  // held, then found again), or for 120-140 ms in the middle of it (missed
  // detections). A jump would cross the whole way in a frame or two.
  const pose = (t) => (t < 3000 ? { yaw: 0, pitch: REST.pitch + 15 * mj((t - 2000) / 500) } : { yaw: 20 * mj((t - 4000) / 500), pitch: REST.pitch + 15 * (1 - mj((t - 4000) / 500)) });
  const steps = (gap) => maxStep(run((t) => (gap && t >= gap[0] && t < gap[1] ? null : head(pose(t).yaw, pose(t).pitch)), LOOK, () => null, 8000).filter((f) => f.t > 3500));
  const tracked = steps(null);
  for (const gap of [[4000, 5200], [3900, 6000], [4100, 4220], [4200, 4340]]) {
    const s = steps(gap);
    console.log(`  face lost ${gap[0]}-${gap[1]} ms during the turn: largest frame step ${(s * 1000).toFixed(1)} mm (tracked throughout: ${(tracked * 1000).toFixed(1)})`);
    assert.ok(s < 1.6 * tracked + 0.002 && s < 0.045, `lost ${gap[0]}-${gap[1]} ms: ${(s * 1000).toFixed(1)} mm a frame`);
  }
  // Found again after a long loss with the head turned elsewhere: a glide, slower than tracking the turn itself.
  assert.ok(steps([3900, 6000]) <= tracked, 'reacquiring glides');
});

test('head turn: switching it off or on, or R, while turned glides (no jump, never past where it is going)', () => {
  const pose = (t) => ({ yaw: 15 * mj((t - 2000) / 500), pitch: REST.pitch + 12 * mj((t - 2000) / 500) });
  const at = (t) => head(pose(t).yaw, pose(t).pitch);
  const cases = [
    ['off', LOOK, (t) => (Math.abs(t - 4000) < 9 ? LOOK_OFF : null)],
    ['on', LOOK_OFF, (t) => (Math.abs(t - 4000) < 9 ? LOOK : null)],
    ['strength 1 -> 2', LOOK, (t) => (Math.abs(t - 4000) < 9 ? { ...LOOK, turn: { on: true, strength: 2 } } : null)],
    ['R', LOOK, (t, vm) => { if (Math.abs(t - 4000) < 9) vm.requestRecentre(); return null; }],
  ];
  for (const [name, view, events] of cases) {
    const fr = run(at, view, events, 6500).filter((f) => f.t > 3950);
    const step = maxStep(fr);
    assert.ok(step < 0.016, `${name}: largest frame step ${(step * 1000).toFixed(1)} mm`);
    for (const k of ['x', 'y']) {
      const xs = fr.map((f) => f.p[k]);
      const lo = Math.min(xs[0], xs.at(-1)) - 0.003;
      const hi = Math.max(xs[0], xs.at(-1)) + 0.003;
      assert.ok(xs.every((x) => x >= lo && x <= hi), `${name} ${k}: stays between ${(xs[0] * 1000).toFixed(0)} and ${(xs.at(-1) * 1000).toFixed(0)} mm`);
    }
  }
});

test('head turn: an 8 degree slump or tilt back held for a minute is taken up after 25 s, like a new posture (no R needed)', () => {
  for (const dp of [8, -8]) {
    const noise = gauss(21, 0.5);
    const { vm, t, m: m0 } = seated(LOOK, noise);
    let { t: t1, m } = move(vm, LOOK, t, REST, { yaw: 0, pitch: REST.pitch + dp }, 500, 1000, noise);
    const start = Math.abs(m.p.y - m0.p.y);
    const at = {};
    const tHeld = t1;
    for (const end = t1 + 120000; t1 < end; t1 += DT) {
      const h = head(0, REST.pitch + dp);
      m = vm.step(t1, h.p, LOOK, { yaw: noise(), pitch: REST.pitch + dp + noise() }, LAT);
      for (const s of [20, 60, 120]) if (at[s] === undefined && t1 - tHeld >= s * 1000 - DT) at[s] = Math.abs(m.p.y - m0.p.y);
    }
    console.log(`  ${dp > 0 ? 'tilt back' : 'slump'} 8 deg: view ${(start * 1000).toFixed(0)} mm off, ${[20, 60, 120].map((s) => `${(at[s] * 1000).toFixed(0)} mm at ${s} s`).join(', ')}; rest pose ${(vm.turn.rest.pitch - REST.pitch).toFixed(1)} deg along`);
    assert.ok(start > 0.08, `${dp}: it steered (${(start * 1000).toFixed(0)} mm)`);
    assert.ok(at[20] > 0.85 * start, `${dp}: held for the first 25 s (${(at[20] * 1000).toFixed(0)} mm at 20 s)`);
    assert.ok(at[60] < 0.35 * start, `${dp}: mostly taken up by 60 s (${(at[60] * 1000).toFixed(0)} mm)`);
    assert.ok(at[120] < 0.15 * start, `${dp}: nearly all by 120 s (${(at[120] * 1000).toFixed(0)} mm)`);
  }
});

test('head turn: a glance down at the keyboard (25 deg and more) brings the view back near centre while held; 10 and 15 deg still steer', () => {
  const offset = (dp, glanceDeg) => {
    const vm = new ViewMapper(glanceDeg ? { turn: { glanceDeg } } : {});
    const s = move(vm, LOOK, 0, REST, REST, 0, 2000);
    const { m } = move(vm, LOOK, s.t, REST, { yaw: 0, pitch: REST.pitch + dp }, 300, 1500);
    return m.p.y - s.m.p.y;
  };
  const noFade = { from: 90, to: 95 };
  for (const dp of [-10, -15]) {
    const d = offset(dp);
    assert.ok(d > 0.1 && Math.abs(d - offset(dp, noFade)) < 1e-9, `${dp} deg: ${(d * 1000).toFixed(0)} mm, as without the fade`);
  }
  for (const dp of [-25, -30, -40]) {
    const d = offset(dp);
    const without = offset(dp, noFade);
    console.log(`  look down ${-dp} deg and hold: view ${(d * 1000).toFixed(1)} mm from where it was (${(without * 1000).toFixed(0)} mm without the fade)`);
    assert.ok(Math.abs(d) < 0.015 && without > 0.2, `${dp} deg: ${(d * 1000).toFixed(1)} mm`);
  }
  // Tilting back is never faded.
  assert.ok(Math.abs(offset(30) - offset(30, noFade)) < 1e-9);
});

test('head turn: no overshoot through the glance fade: never past the ideal view on the way down, never past where it rests on the way back', () => {
  // Stopping inside the fade (20 deg) settles with a small dip: the fade is
  // judged on the quicker pitch, the steering on the held pose, which
  // arrives a little later. Allowed 5 mm there; through the fade, 2.
  for (const [name, o, backMax] of [['glance 25 deg in 0.3 s', { axis: 'pitch', deg: -25, T: 300 }, 2], ['look down 30 deg in 0.5 s', { axis: 'pitch', deg: -30 }, 2], ['look down 20 deg in 0.5 s', { axis: 'pitch', deg: -20 }, 5]]) {
    const r = tiltHold({ ...o, poseNoise: POSE_NOISE.high, swayMm: 0, micro: false, poseSwayDeg: 0 }, [1, 2, 3]);
    console.log(`  ${name}: ideal view up to ${r.peak.toFixed(0)} mm on the way, past it ${r.pastMax.toFixed(1)} mm, swing past its rest on the way back ${r.back.toFixed(1)} mm, held ${r.drawn.toFixed(0)} mm from the start`);
    assert.ok(r.pastMax <= 2 && r.back <= backMax, `${name}: past ${r.pastMax.toFixed(1)}, back ${r.back.toFixed(1)} mm`);
  }
});

test('head turn: after a lost face the pose glides onto where the head points now; switching eyes moves the view by exactly what it maps to', () => {
  // Lost for 1 s while the head turned 20 deg: the turn's part comes back over several samples, not in one.
  const { vm, t } = seated();
  let { t: t1, m } = move(vm, LOOK, t, REST, REST, 0, 500);
  const before = vm.turnOffset(LOOK).x;
  t1 += 1000;
  const steps = [];
  for (let k = 0; k < 20; k++, t1 += DT) {
    const h = head(20, REST.pitch);
    m = vm.step(t1, h.p, LOOK, h.pose, LAT);
    steps.push(vm.turnOffset(LOOK).x);
  }
  const total = steps.at(-1) - before;
  assert.ok(total < -0.15, `it steers after: ${(total * 1000).toFixed(0)} mm`);
  assert.ok(Math.abs(steps[0] - before) < 0.4 * Math.abs(total), `first sample back: ${((steps[0] - before) * 1000).toFixed(0)} of ${(total * 1000).toFixed(0)} mm`);
  // Switching from the right eye to the left while turned: the mapped point moves by the reported shift.
  const s = seated();
  move(s.vm, LOOK, s.t, REST, { yaw: 20, pitch: REST.pitch + 10 });
  const R2 = { x: -LAT, y: PIV.up, z: -PIV.forward };
  const right = head(20, REST.pitch + 10).p;
  const e = turnPoint(R2, 20, REST.pitch + 10);
  const left = { x: SEAT.x + e.x, y: SEAT.y + e.y, z: SEAT.z + e.z };
  const q1 = s.vm.map(right, LOOK);
  const sw = s.vm.switchEye({ x: left.x - right.x, y: left.y - right.y, z: left.z - right.z }, -LAT, LOOK);
  const q2 = s.vm.map(left, LOOK);
  for (const k of ['x', 'y', 'z']) assert.ok(Math.abs(q2[k] - q1[k] - sw.shift[k]) < 1e-9, `${k}: moved ${((q2[k] - q1[k]) * 1000).toFixed(2)} mm, shift ${(sw.shift[k] * 1000).toFixed(2)}`);
  assert.deepEqual(sw.offset, s.vm.turnBypass(LOOK));
});

test('bench: head turn meets its targets (tools/core-motion.mjs --check): never past the ideal view, no added shimmer held or still', () => {
  const failed = missedTurnTargets(true);
  assert.deepEqual(failed, []);
});

// Per-station limits on head tracking (docs/ARCHITECTURE.md, station `view`
// and `subject`): src/tracking/view-map.js (stationLimits, limitRatio,
// blendLimits, limitEye, StationLimiter), src/core/rig-motion.js (viewMix)
// and src/core/subject-check.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ViewMapper, StationLimiter, blendLimits, limitEye, limitRatio, stationLimits, capEyeZ, EYE_Z_KNEE, VIEW_DEFAULTS } from '../src/tracking/view-map.js';
import { TURN_DEFAULTS, turnPoint } from '../src/tracking/head-turn.js';
import { RigMotion } from '../src/core/rig-motion.js';
import { normalizeNav, windowToScene } from '../src/core/rig.js';
import { checkSubjects, sceneToWindow, TYPICAL_MOVES } from '../src/core/subject-check.js';

const close = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);
const LOOK3 = { direction: 'look', strength: 3 };
const REST = { x: 0.02, y: 0.01, z: 0.6 };
const LIMITS = { maxStrength: 1.5, verticalBoost: 1, maxEyeZ: 0.9 };
const at = (view) => blendLimits([{ view, w: 1 }], LOOK3);

/** A mapper resting at REST (seeded by hand: the mapping is linear about it). */
function mapper(opts) {
  const m = new ViewMapper(opts);
  m.rest = { ...REST };
  m.seeded = true;
  return m;
}

test('station limits: strength min(Strength, maxStrength), verticalBoost instead of 1.5x, the eye no farther than maxEyeZ', () => {
  const user = mapper();
  const limited = mapper({ yGainLook: 1 }); // what Look around at 1.5x with no extra up and down maps to
  for (const d of [[0.08, 0.05, -0.07], [-0.1, -0.06, 0.05], [0.03, 0.06, 0.1], [0, 0, 0]]) {
    const p = { x: REST.x + d[0], y: REST.y + d[1], z: REST.z + d[2] };
    const q = limitEye(user.map(p, LOOK3), REST, at(LIMITS));
    const want = limited.map(p, { direction: 'look', strength: 1.5 });
    close(q.x, want.x, 1e-12, 'x');
    close(q.y, want.y, 1e-12, 'y');
    close(q.z, capEyeZ(want.z, 0.9), 1e-12, 'z');
  }
  // Leaning in 30 cm (Look around mirrors it: the view backs away): 2x depth
  // at 3x would put the eye 1.2 m away; here 1.25x would be 0.975, and the
  // cap holds it at 0.9.
  const back = limitEye(user.map({ ...REST, z: REST.z - 0.3 }, LOOK3), REST, at(LIMITS));
  close(user.map({ ...REST, z: REST.z - 0.3 }, LOOK3).z, 1.2, 1e-12);
  assert.ok(back.z <= 0.9 && back.z > 0.895, `held just under the cap: ${back.z}`);
});

test('station limits: none means the global settings; a lower Strength is kept; True window gets only the distance cap', () => {
  const r0 = limitRatio(LOOK3, null);
  assert.deepEqual(r0, { x: 1, y: 1, z: 1 });
  assert.deepEqual(at(null), { ratio: { x: 1, y: 1, z: 1 }, maxEyeZ: VIEW_DEFAULTS.limits.zMax + EYE_Z_KNEE });
  // Without limits nothing the view cone allows is touched, out to its 1.4 m.
  for (const z of [0.2, 0.6, 1.36, 1.39, 1.4]) assert.equal(limitEye({ x: 0.1, y: 0, z }, REST, at(null)).z, z);
  assert.equal(stationLimits({}), null);
  assert.equal(stationLimits({ maxStrength: -1 }), null);
  const r1 = limitRatio({ direction: 'look', strength: 1.2 }, stationLimits({ maxStrength: 1.5 }));
  assert.deepEqual(r1, { x: 1, y: 1, z: 1 }, 'Strength 1.2 is already under 1.5');
  const r2 = limitRatio({ direction: 'window', strength: 1 }, stationLimits(LIMITS));
  assert.deepEqual(r2, { x: 1, y: 1, z: 1 }, 'True window has no up-and-down boost to replace');
  const q = limitEye({ x: 0.1, y: 0.2, z: 1.3 }, REST, blendLimits([{ view: LIMITS, w: 1 }], { direction: 'window', strength: 1 }));
  assert.deepEqual({ x: q.x, y: q.y }, { x: 0.1, y: 0.2 });
  assert.ok(q.z <= 0.9 && q.z > 0.8999, `capped: ${q.z}`);
  // The cap eases in over the last 4 cm: unchanged below, never past it, no kink.
  assert.equal(capEyeZ(0.8, 0.9), 0.8);
  for (let z = 0.8; z < 2; z += 0.01) assert.ok(capEyeZ(z, 0.9) <= 0.9 && capEyeZ(z + 0.01, 0.9) >= capEyeZ(z, 0.9));
  const slope = (z) => (capEyeZ(z + 1e-7, 0.9) - capEyeZ(z - 1e-7, 0.9)) / 2e-7;
  close(slope(0.86), 1, 1e-3, 'slope 1 where it starts');
  // verticalBoost alone: only up and down change.
  const r3 = limitRatio(LOOK3, stationLimits({ verticalBoost: 1 }));
  close(r3.x, 1, 1e-12);
  close(r3.y, 1 / 1.5, 1e-12);
  close(r3.z, 1, 1e-12);
});

test('station limits: True window stays bit-exact at a station, even one with maxStrength under 1 and a big verticalBoost', () => {
  const tight = { maxStrength: 0.5, verticalBoost: 3, maxEyeZ: 0.9 };
  for (const strength of [1, 2.5]) {
    const view = { direction: 'window', strength };
    assert.deepEqual(limitRatio(view, stationLimits(tight)), { x: 1, y: 1, z: 1 }, `True window ${strength}x is never held in`);
    const L = blendLimits([{ view: tight, w: 1 }], view);
    const vm = mapper();
    for (const d of [[0.08, 0.05, -0.07], [-0.12, -0.06, 0.1], [0.2, 0.1, 0.05], [0, 0, 0], [-0.0301, 0.0123, 0.0457], [0.1111, -0.0333, -0.0777]]) {
      const q = vm.clamp(vm.map({ x: REST.x + d[0], y: REST.y + d[1], z: REST.z + d[2] }, view));
      // Bit for bit (the eye is well under the cap's knee here).
      assert.deepEqual(limitEye(q, REST, L), q);
    }
  }
});

test('station limits: the maxEyeZ cap still applies in True window', () => {
  const view = { direction: 'window', strength: 1 };
  const L = blendLimits([{ view: { maxStrength: 0.5, maxEyeZ: 0.8 }, w: 1 }], view);
  for (const z of [0.85, 1.0, 1.4]) {
    const e = limitEye({ x: 0.05, y: -0.02, z }, REST, L);
    assert.ok(e.z <= 0.8 && e.z > 0.75, `leaning far back to ${z}: drawn from ${e.z}`);
    assert.equal(e.x, 0.05, 'sideways untouched');
    assert.equal(e.y, -0.02);
  }
});

test('station limits: a verticalBoost above 1.5 and a nearer eye stay inside the view cone', () => {
  const C = VIEW_DEFAULTS.limits;
  const inCone = (e) => e.z >= C.zMin - 1e-12 && e.z <= C.zMax + 1e-12
    && Math.abs(e.x) <= Math.min(C.x, C.xPerZ * e.z) + 1e-12
    && e.y <= Math.min(C.yMax, C.yPerZ * e.z) + 1e-12 && e.y >= Math.max(C.yMin, -C.yPerZ * e.z) - 1e-12;
  // A boost of 3 doubles Look around's up and down: a rise mapped to the
  // cone's top would go past it.
  const boost = blendLimits([{ view: { verticalBoost: 3 }, w: 1 }], LOOK3);
  close(boost.ratio.y, 2, 1e-12);
  const vm = mapper();
  for (const dy of [-0.15, -0.1, 0.1, 0.15]) {
    const q = vm.map({ x: REST.x, y: REST.y + dy, z: REST.z }, LOOK3);
    const e = limitEye(q, REST, boost);
    assert.ok(inCone(e), `rise ${dy}: ${JSON.stringify(e)}`);
  }
  // An eye far out to the side, then brought nearer by the cap: the cone is
  // narrower there, and the eye is brought in with it.
  const near = blendLimits([{ view: { maxEyeZ: 0.4 }, w: 1 }], LOOK3);
  const e = limitEye({ x: 0.48, y: 0.3, z: 1.0 }, REST, near);
  assert.ok(e.z <= 0.4, `capped: ${e.z}`);
  assert.ok(inCone(e), JSON.stringify(e));
  assert.ok(Math.abs(e.x) <= C.xPerZ * e.z + 1e-12 && e.y <= C.yPerZ * e.z + 1e-12, 'held to the narrower cone');
  // The mouse counts its 1.4x reach as its strength; True window ignores the limits.
  assert.deepEqual(limitRatio({ direction: 'mouse', strength: 1.4 }, stationLimits({ maxStrength: 0.7, verticalBoost: 3 })), { x: 0.5, y: 0.5, z: 1 });
});

test('station limits: head turn steering is held in the same way as the head position', () => {
  // A seated head (the head-turn tests' neck model) tilts back 15 degrees and holds.
  const LAT = 0.0315;
  const PIV = TURN_DEFAULTS.pivot;
  const SEAT = { x: 0, y: -0.045, z: 0.68 };
  const Rn = { x: LAT, y: PIV.up, z: -PIV.forward };
  const head = (yaw, pitch) => {
    const e = turnPoint(Rn, yaw, pitch);
    return { p: { x: SEAT.x + e.x, y: SEAT.y + e.y, z: SEAT.z + e.z }, pose: { yaw, pitch } };
  };
  const view = { direction: 'look', strength: 3, turn: { on: true, strength: 1 } };
  const vm = new ViewMapper();
  let t = 0;
  let m;
  for (; t < 2000; t += 33.3) { const h = head(0, -4); m = vm.step(t, h.p, view, h.pose, LAT); }
  for (let k = 0; k < 90; k++, t += 33.3) {
    const u = Math.min(1, k / 15);
    const h = head(0, -4 + 15 * u);
    m = vm.step(t, h.p, view, h.pose, LAT);
  }
  const turn = vm.turnOffset(view);
  assert.ok(Math.abs(turn.y) > 0.05, `the tilt steers the view (down, to see more of the top): ${turn.y}`);
  const L = blendLimits([{ view: { maxStrength: 1.5, verticalBoost: 1 }, w: 1 }], view);
  const q = limitEye(m.p, vm.rest, L);
  // The whole offset, the turn's steering with it, is scaled: 1.5 x 1 of 3 x 1.5 up and down.
  close(L.ratio.y, 1 / 3, 1e-12);
  close(q.y - vm.rest.y, (m.p.y - vm.rest.y) / 3, 1e-12);
  assert.ok(Math.abs(m.p.y - vm.rest.y) > 0.05, 'the unheld view moved more than 5 cm');
});

const NAV = normalizeNav({
  stations: [
    { id: 'a', title: 'A', pose: { position: [0, 0, 0] } },
    { id: 'b', title: 'B', pose: { position: [0, 0, -1], scale: 0.5 }, view: { maxStrength: 1, verticalBoost: 1, maxEyeZ: 0.7 } },
    { id: 'c', title: 'C', pose: { position: [0.5, 0, -1] }, view: { maxStrength: 2 } },
  ],
  bounds: { min: [-2, -2, -2], max: [2, 2, 2] },
});

// A head held leaning right 10 cm, up 5 cm and in 15 cm, mapped at Look
// around 3x (the view backs away to 90 cm).
const HELD = (() => {
  const vm = mapper();
  return vm.map({ x: REST.x + 0.1, y: REST.y + 0.05, z: REST.z - 0.15 }, LOOK3);
})();

function frames(motion, limiter, seconds, each = null) {
  const out = [];
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    each?.(i);
    motion.update(1 / 60);
    out.push(limiter.apply(HELD, REST, LOOK3, motion.viewMix(), 1000 / 60));
  }
  return out;
}

const steps = (eyes) => eyes.slice(1).map((e, i) => Math.hypot(e.x - eyes[i].x, e.y - eyes[i].y, e.z - eyes[i].z));

test('station limits: blended over a glide, so the rendered eye never steps', () => {
  const m = new RigMotion();
  m.setNav(NAV);
  const lim = new StationLimiter();
  const before = frames(m, lim, 0.5);
  const free = limitEye(HELD, REST, at(null));
  for (const e of before) assert.deepEqual(e, free, 'at A: the global settings');
  m.glideTo('b');
  const during = frames(m, lim, 6);
  assert.equal(m.at, 'b');
  const end = limitEye(HELD, REST, at(NAV.stations[1].view));
  close(during.at(-1).x, end.x, 1e-12);
  assert.ok(during.at(-1).z <= 0.7 && during.at(-1).z > 0.69, `held under maxEyeZ: ${during.at(-1).z}`);
  for (const e of during) assert.ok(e.z <= Math.max(HELD.z, 0.7) + 1e-12);
  const all = [before.at(-1), ...during];
  const s = steps(all);
  const worst = Math.max(...s);
  // The eye moves 20 cm sideways and 23 cm in depth over the glide, never
  // more than a few millimetres a frame, and its speed changes gently.
  assert.ok(worst < 0.006, `largest step ${(worst * 1000).toFixed(2)} mm`);
  assert.ok(s[0] < 1e-4, 'it starts gently');
  let jolt = 0;
  for (let i = 1; i < s.length; i++) jolt = Math.max(jolt, Math.abs(s[i] - s[i - 1]));
  assert.ok(jolt < 0.001, `speed changed by up to ${(jolt * 1000).toFixed(2)} mm a frame`);
  // Halfway through the glide the limits are halfway.
  const mix = (() => { const n = new RigMotion(); n.setNav(NAV); n.glideTo('b'); n.update(n.glide.dur / 2); return n.viewMix(); })();
  assert.equal(mix.length, 2);
  for (const x of mix) close(x.w, 0.5, 1e-9);
});

test('station limits: moving freely keeps the last station\'s limits; taking over mid-glide keeps the blend as it was', () => {
  const m = new RigMotion();
  m.setNav(NAV);
  const lim = new StationLimiter();
  m.glideTo('b');
  frames(m, lim, 6);
  assert.equal(m.at, 'b');
  const atB = limitEye(HELD, REST, at(NAV.stations[1].view));
  // Arrows, a drag, a swipe: still B's limits.
  const moving = frames(m, lim, 2, (i) => { if (i % 10 === 0) m.nudge({ forward: 0.01, yaw: 2 }); });
  for (const e of moving) assert.deepEqual(e, atB);
  // Glide to C and take over partway: the limits stay where the blend was.
  m.glideTo('c');
  const part = frames(m, lim, m.glide.dur * 0.4);
  const w = m.viewMix().find((x) => x.view === NAV.stations[2].view).w;
  assert.ok(w > 0.1 && w < 0.9, `partway: ${w}`);
  const mid = part.at(-1);
  const after = frames(m, lim, 3, (i) => { if (i < 30) m.nudge({ right: 0.002 }); });
  assert.ok(Math.hypot(after[0].x - mid.x, after[0].y - mid.y, after[0].z - mid.z) < 0.003, 'no step at the take-over');
  for (const e of after) assert.deepEqual(e, after[0], 'and the limits then hold');
  // A scene without limits: the global settings.
  const n = new RigMotion();
  n.setNav(normalizeNav({ stations: [{ id: 'x' }, { id: 'y', pose: { position: [0, 0, -1] } }] }));
  n.glideTo('y');
  const e = frames(n, new StationLimiter(), 4);
  for (const x of e) assert.deepEqual(x, limitEye(HELD, REST, at(null)));
});

test('station limits: the rest point it holds about glides when Re-centre moves it', () => {
  const lim = new StationLimiter();
  const mix = [{ view: LIMITS, w: 1 }];
  let prev = lim.apply(HELD, REST, LOOK3, mix, 16.7);
  const moved = { x: REST.x + 0.1, y: REST.y, z: REST.z };
  let worst = 0;
  for (let i = 0; i < 120; i++) {
    const e = lim.apply(HELD, moved, LOOK3, mix, 16.7);
    worst = Math.max(worst, Math.hypot(e.x - prev.x, e.y - prev.y, e.z - prev.z));
    prev = e;
  }
  assert.ok(worst < 0.004, `step ${(worst * 1000).toFixed(2)} mm`);
  close(lim.pivot.x, moved.x, 1e-3);
});

test('subject check: scene points come back to window coordinates; a far subject leaves the frame at 3x and stays in with limits', () => {
  const pose = { x: 0.4, y: -0.2, z: 1.1, yaw: 63, pitch: -18, scale: 0.4 };
  const p = { x: 0.05, y: -0.03, z: -0.4 };
  const s = windowToScene(pose, p);
  const w = sceneToWindow(pose, [s.x, s.y, s.z]);
  close(w.x, p.x, 1e-12);
  close(w.y, p.y, 1e-12);
  close(w.z, p.z, 1e-12);

  // Near: a target 10 cm behind the glass. Far: the rig at 1:16, its
  // subject 3 m away in the set (48 m behind the glass at window scale):
  // the window is a long lens there, and a lean at 3x pans it out.
  const pose16 = { position: [0, 0, 0], yaw: 30, pitch: 0, scale: 1 / 16 };
  const ahead = windowToScene({ x: 0, y: 0, z: 0, yaw: 30, pitch: 0, scale: 1 / 16 }, { x: 0, y: 0, z: -48 });
  const raw = {
    stations: [
      { id: 'near', pose: { position: [0, 0, 0] }, subject: [0.02, -0.01, -0.1] },
      { id: 'far', pose: pose16, subject: [ahead.x, ahead.y, ahead.z] },
      { id: 'far-held', pose: pose16, subject: [ahead.x, ahead.y, ahead.z], view: { maxStrength: 1, verticalBoost: 1, maxEyeZ: 0.85 } },
      { id: 'none', pose: { position: [0, 0, 0] } },
    ],
  };
  const r = checkSubjects(raw);
  assert.deepEqual(r.map((x) => x.id), ['near', 'far', 'far-held'], 'only stations with a subject');
  const by = Object.fromEntries(r.map((x) => [x.id, x]));
  assert.equal(by.near.ok, true);
  assert.equal(by.far.ok, false, 'at 3x, 10 cm of lean swings the far subject out');
  assert.ok(by.far.reach > 1.5);
  assert.ok(by.far.misses.some((m) => Math.abs(m.head.dx) > 0), 'the sideways moves are the misses');
  assert.equal(by['far-held'].ok, true, `held to 1x: ${JSON.stringify(by['far-held'].worst)}`);
  assert.ok(by['far-held'].reach < 0.7);
  // The same answers from a normalized nav, and a margin can tighten it.
  assert.deepEqual(checkSubjects(normalizeNav(raw, () => {})).map((x) => x.ok), [true, false, true]);
  assert.equal(checkSubjects(raw, { margin: 0.2 })[0].ok, false);
  // The grid: 27 head positions with corners, or 11 along the axes.
  const one = { stations: [{ id: 'n', pose: { position: [0, 0, 0] }, subject: [0, 0, -0.1] }] };
  assert.equal(checkSubjects(one)[0].misses.length, 0);
  const count = (grid) => checkSubjects(one, { grid, margin: 10 })[0].misses.length;
  assert.equal(count('cube'), 27, 'a huge margin misses every head position: 27 of them');
  assert.equal(count('axes'), 11, 'depth alone (2) and sideways with up and down (9)');
  assert.deepEqual(TYPICAL_MOVES, { x: 0.1, y: 0.06, z: 0.1 });
});

test('nav: subject and view are kept on stations, and bad ones dropped with a warning', () => {
  const warnings = [];
  const n = normalizeNav({
    stations: [
      { id: 'a', subject: [1, 2, 3], view: { maxStrength: 1.5, verticalBoost: 1, maxEyeZ: 0.9 } },
      { id: 'b', subject: [1, 2], view: { maxStrength: 'x' } },
    ],
  }, (m) => warnings.push(m));
  assert.deepEqual(n.stations[0].subject, [1, 2, 3]);
  assert.deepEqual(n.stations[0].view, { maxStrength: 1.5, verticalBoost: 1, maxEyeZ: 0.9 });
  assert.equal(n.stations[1].subject, undefined);
  assert.equal(n.stations[1].view, undefined);
  assert.equal(warnings.length, 2);
});

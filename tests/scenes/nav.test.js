// The Soundstage's stations (nav, docs/ARCHITECTURE.md "Moving the window"):
// the shape the contract asks for, every station inside its own bounds and
// scale, and the eye kept inside the stage building (nav.room, which the
// core clamps the eye to): at every station over the head-tracking range,
// along the tour's glides, and at poses anywhere in the bounds at scales
// 0.05-1. (No GPU; the render check that no station shows void is
// tools/scene-nav.mjs, in the GPU test below.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import soundstage from '../../src/scenes/soundstage/index.js';
import { normalizeNav, poseFrom, windowToScene, shortYaw, keepEyeInRoom, insideRoom, EYE_MIN_Z } from '../../src/core/rig.js';
import { toReal } from '../../src/scenes/soundstage/layout.js';
import { ROOM } from '../../src/scenes/soundstage/stage.js';
import { checkSubjects } from '../../src/core/subject-check.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const nav = soundstage.nav;

// the eyes a station is built for: the default, the edges of the range the
// scenes are built for (+-45 cm sideways, 30-35 cm up and down, 35-85 cm back)
const EYES = [];
for (const x of [-0.45, 0, 0.45]) for (const y of [-0.3, 0, 0.35]) for (const z of [0.35, 0.6, 0.85]) EYES.push({ x, y, z });

// inside the stage: nav.room, the box the core keeps the eye in
const inRoom = (p) => insideRoom(nav.room, p);
const real = (p) => toReal(p.x, p.y, p.z).map((v) => v.toFixed(2));

test('soundstage nav: the room is the stage inside, clear of its walls, floor and trusses', () => {
  const lo = toReal(...nav.room.min);
  const hi = toReal(...nav.room.max);
  // ROOM: the walls' inner faces and the trusses' bottom chords; pilasters
  // and paint lines stand up to 17 cm in, and the near plane is 5 cm
  assert.ok(lo[0] >= -ROOM.x + 0.3 && hi[0] <= ROOM.x - 0.3, `x ${lo[0]}..${hi[0]}`);
  assert.ok(lo[2] >= ROOM.back + 0.3 && hi[2] <= ROOM.front - 0.3, `z ${lo[2]}..${hi[2]}`);
  assert.ok(lo[1] >= 0.1 && hi[1] <= ROOM.roof - 0.1, `y ${lo[1]}..${hi[1]}`);
  // and it holds every place the window may go at life size
  const n = normalizeNav(nav);
  assert.deepEqual(n.room, nav.room);
});

test('soundstage nav: the shape of the contract', () => {
  assert.ok(Array.isArray(nav.stations) && nav.stations.length >= 8);
  const ids = new Set();
  for (const s of nav.stations) {
    assert.equal(typeof s.id, 'string');
    assert.ok(s.id && !ids.has(s.id), `station id ${s.id} unique`);
    ids.add(s.id);
    assert.equal(typeof s.title, 'string');
    assert.ok(Array.isArray(s.pose.position) && s.pose.position.length === 3 && s.pose.position.every(Number.isFinite), `${s.id} position`);
    for (const k of ['yaw', 'pitch', 'scale']) assert.ok(Number.isFinite(s.pose[k]), `${s.id} ${k}`);
    assert.ok(s.pose.scale > 0);
    assert.ok(Math.abs(s.pose.pitch) < 89);
  }
  // the first is the default: today's view, the identity rig
  const first = nav.stations[0];
  assert.equal(first.id, 'shot');
  assert.deepEqual(first.pose, { position: [0, 0, 0], yaw: 0, pitch: 0, scale: 1 });
  for (const id of ['sidewalk', 'inside', 'camera', 'village', 'catwalk', 'backstage', 'backdrop']) assert.ok(ids.has(id), id);
  assert.ok(nav.bounds.min.length === 3 && nav.bounds.max.length === 3);
  for (let k = 0; k < 3; k++) assert.ok(nav.bounds.min[k] < nav.bounds.max[k]);
  assert.ok(nav.scale.length === 2 && nav.scale[0] > 0 && nav.scale[0] < nav.scale[1]);
  assert.ok(Array.isArray(nav.tour) && nav.tour.length === nav.stations.length);
  for (const id of nav.tour) assert.ok(ids.has(id), `tour stop ${id}`);
  assert.equal(nav.tour[0], 'shot');
});

test('soundstage nav: every station keeps its subject in frame at typical head moves, under its view limits', () => {
  for (const s of nav.stations) {
    assert.ok(Array.isArray(s.subject) && s.subject.length === 3, `${s.id} has a subject`);
    // life size is a long lens (the subject metres behind a 33 cm window held
    // 60 cm away): every station but the shot holds Look around down
    if (s.id !== 'shot') assert.ok(s.view && s.view.maxStrength <= 1.5 && s.view.verticalBoost === 1 && s.view.maxEyeZ <= 0.9, `${s.id} holds the view`);
  }
  // the app's own mapping of typical head moves (src/core/subject-check.js)
  const results = checkSubjects(nav);
  assert.equal(results.length, nav.stations.length);
  for (const r of results) assert.ok(r.ok, `${r.id}: subject leaves the frame (reach ${r.reach.toFixed(2)}) at ${JSON.stringify(r.worst)}`);
});

test('soundstage nav: every station lies inside the bounds and the scale range (nothing is widened)', () => {
  const warnings = [];
  const n = normalizeNav(nav, (w) => warnings.push(w));
  assert.deepEqual(warnings, []);
  for (const s of nav.stations) {
    for (let k = 0; k < 3; k++) {
      assert.ok(s.pose.position[k] >= nav.bounds.min[k] && s.pose.position[k] <= nav.bounds.max[k], `${s.id} axis ${k} in bounds`);
    }
    assert.ok(s.pose.scale >= nav.scale[0] && s.pose.scale <= nav.scale[1], `${s.id} scale in range`);
  }
  assert.deepEqual(n.bounds, nav.bounds);
});

test('soundstage nav: from every station the eye stays inside the room over the whole head range (never moved by the clamp)', () => {
  for (const s of nav.stations) {
    if (s.id === 'shot') continue; // the shot is today's window (its low eyes reach under the stage floor: the core holds them above it)
    const pose = poseFrom(s.pose);
    for (const e of EYES) {
      const p = windowToScene(pose, e);
      assert.ok(inRoom(p), `${s.id}: eye ${JSON.stringify(e)} at ${real(p)} is outside the room`);
      assert.equal(keepEyeInRoom(e, pose, nav.room), e, `${s.id}: eye ${JSON.stringify(e)} is moved`);
    }
  }
});

test('soundstage nav: no station has a wall just behind its window (the rig would be held off and moved)', () => {
  for (const s of nav.stations) {
    const pose = poseFrom(s.pose);
    // the nearest eye the app draws from, straight behind the glass, and a
    // margin of 30 cm (real) more toward the wall
    for (const z of [EYE_MIN_Z, EYE_MIN_Z + 0.3 / 16 / pose.scale]) {
      const p = windowToScene(pose, { x: 0, y: 0, z });
      assert.ok(inRoom(p), `${s.id}: ${z.toFixed(3)} behind the glass is at ${real(p)}, outside the room`);
    }
  }
});

test('soundstage nav: gliding along the tour keeps the default eye inside the stage', () => {
  // the glide (src/core/rig-motion.js): position, yaw (the short way),
  // pitch and log scale move together, eased
  const byId = Object.fromEntries(nav.stations.map((s) => [s.id, poseFrom(s.pose)]));
  const stops = [...nav.tour, nav.tour[0]];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = byId[stops[i]];
    const b = byId[stops[i + 1]];
    const dyaw = shortYaw(a.yaw, b.yaw);
    for (let k = 0; k <= 40; k++) {
      const u = k / 40;
      const pose = {
        x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u,
        yaw: a.yaw + dyaw * u, pitch: a.pitch + (b.pitch - a.pitch) * u,
        scale: Math.exp(Math.log(a.scale) + (Math.log(b.scale) - Math.log(a.scale)) * u),
      };
      const p = windowToScene(pose, { x: 0, y: 0, z: 0.6 });
      assert.ok(inRoom(p), `${stops[i]} -> ${stops[i + 1]} at ${u}: eye at ${toReal(p.x, p.y, p.z).map((v) => v.toFixed(2))}`);
    }
  }
});

test('soundstage nav: anywhere in the bounds at life size, any heading, the eye is in the room or the clamp moves it only a little', () => {
  let s = 12345;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const { min, max } = nav.bounds;
  for (let i = 0; i < 4000; i++) {
    const pose = {
      x: min[0] + (max[0] - min[0]) * rnd(), y: min[1] + (max[1] - min[1]) * rnd(), z: min[2] + (max[2] - min[2]) * rnd(),
      yaw: rnd() * 360 - 180, pitch: rnd() * 90 - 45, scale: nav.scale[0] + (0.0625 - nav.scale[0]) * rnd(),
    };
    const e = EYES[Math.floor(rnd() * EYES.length)];
    const p = windowToScene(pose, e);
    const q = windowToScene(pose, keepEyeInRoom(e, pose, nav.room));
    const d = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) * 16;
    assert.ok(d < 0.5, `pose ${JSON.stringify(pose)} eye ${JSON.stringify(e)} -> ${real(p)} is moved ${d.toFixed(2)} m`);
  }
});

test('soundstage nav: anywhere in the bounds at any scale 0.05-1, the clamped eye is inside the room and in front of the glass', () => {
  let s = 777;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const { min, max } = nav.bounds;
  let moved = 0;
  for (let i = 0; i < 6000; i++) {
    const pose = {
      x: min[0] + (max[0] - min[0]) * rnd(), y: min[1] + (max[1] - min[1]) * rnd(), z: min[2] + (max[2] - min[2]) * rnd(),
      yaw: rnd() * 360 - 180, pitch: rnd() * 90 - 45, scale: Math.exp(Math.log(0.05) + Math.log(1 / 0.05) * rnd()),
    };
    // the head's whole range, out to a wide lean and 1.4 m back
    const e = { x: (rnd() - 0.5) * 1.2, y: (rnd() - 0.5) * 0.8, z: 0.1 + 1.3 * rnd() };
    const c = keepEyeInRoom(e, pose, nav.room);
    if (c !== e) moved++;
    const p = windowToScene(pose, c);
    assert.ok(insideRoom(nav.room, p, 1e-6), `pose ${JSON.stringify(pose)} eye ${JSON.stringify(e)} -> ${real(p)}`);
    assert.ok(c.z >= EYE_MIN_Z - 1e-9, `eye behind the glass: ${JSON.stringify(c)}`);
    // the eye drawn from is the nearest point inside: inside eyes are untouched
    if (insideRoom(nav.room, windowToScene(pose, e))) assert.equal(c, e);
  }
  // (the clamp does real work at large scales)
  assert.ok(moved > 100, `moved ${moved}`);
});

// GPU: every station from the default eye, the edges of its range and its
// typical head moves shows no uniform black frame (luma p90 >= 8), no
// background (void) at all, and under 0.1 % backs of one-sided surfaces (lab
// voidMask, measured as the frame draws; the lab keeps the eye in nav.room
// as the app does, so the shot's low eyes no longer see the stage floor's
// underside). Headless, ~5 min; opt-in.
const BACK_MAX = 0.1; // per cent of the frame
test('soundstage stations: no void, no holes, from every eye', { skip: process.env.SCENE_GPU_TESTS !== '1', timeout: 1700000 }, () => {
  const out = mkdtempSync(join(tmpdir(), 'scene-nav-'));
  const r = spawnSync(process.execPath, [join(root, 'tools', 'scene-nav.mjs'), '--steps', 'void', '--out', out], { cwd: root, encoding: 'utf8', timeout: 1650000 });
  const lines = (r.stdout || '').split('\n').filter((l) => /: void /.test(l));
  assert.ok(lines.length >= nav.stations.length * 15, `expected a line per station and eye, got:\n${r.stdout}\n${r.stderr}`);
  for (const l of lines) {
    assert.ok(!/BLACK/.test(l), `a uniform black frame (luma p90 < 8): ${l}`);
    const m = l.match(/^(\S+) (\S+): void ([\d.]+)% back ([\d.]+)%/);
    assert.ok(m, l);
    assert.equal(Number(m[3]), 0, `void in ${m[1]} ${m[2]}`);
    assert.ok(Number(m[4]) < BACK_MAX, `back faces in ${m[1]} ${m[2]}: ${m[4]}%`);
  }
  assert.equal(r.status, 0, r.stderr);
});

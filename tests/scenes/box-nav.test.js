// The Box's navigation (docs/ARCHITECTURE.md, "Moving the window"): the nav
// shape, every station inside the bounds and the scale range, each station's
// eye where its name says it is, and (opt-in, GPU) a render-mask check that no
// station view, at any of the head-tracking extremes, shows void or the back
// of a one-sided surface. The GPU part runs headless Chromium (a few
// minutes), so it is opt-in:
//   SCENE_GPU_TESTS=1 npm test
// or directly: node tools/scene-box-nav-rounds.mjs --steps void --samples 0 --corners 0 --out DIR

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeNav, windowToScene, poseFrom } from '../../src/core/rig.js';
import { checkSubjects } from '../../src/core/subject-check.js';
import { eyeOfPose } from '../../src/scenes/box/nav.js';
import { SIDE } from '../../src/scenes/box/nextroom.js';
import { ENGAWA } from '../../src/scenes/box/house.js';
import { TERRACE } from '../../src/scenes/box/world.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const box = (await import(join(root, 'src', 'scenes', 'box', 'index.js'))).default;
const nav = box.nav;
const W = 0.326571; // full screen below the notch (docs/REFERENCES.md 1.5)
const H = 0.205109;
const D = 0.5;

test('box nav: the contract shape, the room first and at rest, the tour in the brief\'s order', () => {
  assert.ok(nav && Array.isArray(nav.stations) && nav.stations.length >= 5);
  const ids = new Set();
  for (const s of nav.stations) {
    assert.equal(typeof s.id, 'string');
    assert.equal(typeof s.title, 'string');
    assert.ok(!ids.has(s.id), `duplicate station ${s.id}`);
    ids.add(s.id);
    const p = s.pose;
    assert.ok(Array.isArray(p.position) && p.position.length === 3 && p.position.every(Number.isFinite), s.id);
    assert.ok(Number.isFinite(p.yaw) && Number.isFinite(p.pitch) && Math.abs(p.pitch) < 89, s.id);
    assert.ok(p.scale > 0, s.id);
  }
  // the first station is today's view, bit for bit (the identity rig)
  assert.equal(nav.stations[0].id, 'room');
  assert.deepEqual(nav.stations[0].pose, { position: [0, 0, 0], yaw: 0, pitch: 0, scale: 1 });
  for (const id of ['window', 'engawa', 'garden', 'nextroom']) assert.ok(ids.has(id), id);
  // one way round the house: next door first, then the window, out to the
  // engawa and its eave, ending in the garden looking back at the lit house
  assert.deepEqual(nav.tour, ['room', 'nextroom', 'window', 'engawa', 'eave', 'garden']);
  for (const id of nav.tour) assert.ok(ids.has(id), `tour stop ${id}`);
});

test('box nav: every station lies inside the bounds and the scale range (the app widens nothing)', () => {
  const { min, max } = nav.bounds;
  for (let k = 0; k < 3; k++) assert.ok(min[k] < max[k]);
  const [s0, s1] = nav.scale;
  assert.ok(s0 > 0 && s0 < s1);
  for (const s of nav.stations) {
    s.pose.position.forEach((v, k) => assert.ok(v >= min[k] && v <= max[k], `${s.id} axis ${k}: ${v} not in [${min[k]}, ${max[k]}]`));
    assert.ok(s.pose.scale >= s0 && s.pose.scale <= s1, `${s.id} scale`);
  }
  const warnings = [];
  const n = normalizeNav(nav, (m) => warnings.push(m));
  assert.deepEqual(warnings, []);
  assert.deepEqual(n.bounds.min, min);
  assert.deepEqual(n.bounds.max, max);
  // the far plane at the smallest scale still reaches the ridges and the sky (app: far 200)
  assert.ok(200 * s0 > 10.5, 'the dome (radius 9.5) and the far ridges stay inside the far plane');
});

test('box nav: each station\'s eye is where its name says (seated, centred eye, the reference window)', () => {
  const at = Object.fromEntries(nav.stations.map((s) => [s.id, eyeOfPose(s.pose)]));
  // the same point through the app's own rig maths
  for (const s of nav.stations) {
    const e = windowToScene(poseFrom(s.pose), { x: 0, y: 0, z: 0.6 });
    assert.ok(Math.abs(e.x - at[s.id].x) < 1e-9 && Math.abs(e.y - at[s.id].y) < 1e-9 && Math.abs(e.z - at[s.id].z) < 1e-9, s.id);
  }
  const FL = -H / 2;
  const inRoom = (e) => Math.abs(e.x) < W / 2 - 0.03 && e.z < -0.02 && e.z > -D + 0.03 && e.y > FL + 0.03 && e.y < H / 2 - 0.03;
  assert.ok(inRoom(at.window), 'by the window: inside the room');
  const xo = -W / 2 - 0.02;
  assert.ok(at.engawa.x < xo && at.engawa.x > xo - ENGAWA.width && at.engawa.z < 0 && at.engawa.z > ENGAWA.z1, 'the engawa: over its boards');
  assert.ok(at.engawa.y > FL + 0.04 && at.engawa.y < FL + 0.08, 'the engawa: a seated eye');
  const GY = FL - 0.035;
  assert.ok(at.garden.x > TERRACE.x0 + 0.05 && at.garden.x < xo - ENGAWA.width - 0.2 && at.garden.z < -0.02 && at.garden.z > TERRACE.z0, 'the garden: on the terrace, back from the house');
  assert.ok(at.garden.y > GY + 0.09 && at.garden.y < GY + 0.16, 'the garden: a standing eye');
  const x0 = W / 2 + 0.02;
  assert.ok(at.nextroom.x > x0 + 0.03 && at.nextroom.x < x0 + SIDE.depth - 0.03 && at.nextroom.z < -0.02 && at.nextroom.z > -D, 'the next room: inside it');
  if (at.eave) assert.ok(at.eave.x < xo && at.eave.x > xo - ENGAWA.width && nav.stations.find((s) => s.id === 'eave').pose.pitch > 15, 'under the eave: on the engawa, looking up');
});

test('box nav: each station names a subject that the core keeps in frame over the full grid of typical head moves; outdoor stations limit the strength', () => {
  for (const st of nav.stations) assert.ok(Array.isArray(st.subject) && st.subject.length === 3, `${st.id} has a subject`);
  // the app's own mapping (src/core/subject-check.js): Look around 3x, 1.5x
  // up and down, the station's limits, the view cone; +-10 cm lean, +-6 cm
  // rise, +-10 cm in depth and every combination of them
  const results = checkSubjects(nav);
  assert.equal(results.length, nav.stations.length);
  for (const r of results) assert.ok(r.ok, `${r.id}: subject leaves the frame (reach ${r.reach.toFixed(3)}): ${JSON.stringify(r.worst)}`);
  for (const id of ['engawa', 'garden', 'eave']) {
    const v = nav.stations.find((s) => s.id === id)?.view;
    if (!v) continue;
    assert.ok(v.maxStrength <= 1.5 && v.verticalBoost <= 1, `${id}: a distant subject, low strength and no extra vertical`);
    assert.ok(v.maxEyeZ > 0.6 && v.maxEyeZ <= 1.4, `${id}: maxEyeZ`);
  }
  // the room keeps the full strength
  assert.equal(nav.stations[0].view, undefined);
});

test('box nav: the far eye (maxEyeZ) stays out of the walls behind the indoor and engawa stations', () => {
  const xo = -W / 2 - 0.02;
  const back = (id) => {
    const st = nav.stations.find((s) => s.id === id);
    return eyeOfPose(st.pose, [0, 0, st.view?.maxEyeZ ?? 1.4]);
  };
  assert.ok(back('engawa').x < xo - 0.005, 'the engawa: the far eye stays outside the room\'s west wall');
  const n = back('nextroom');
  assert.ok(n.z < -0.0105 - 0.005 && n.x > W / 2 + 0.02 + 0.005, 'the next room: the far eye stays inside its walls');
  const w = back('window');
  assert.ok(Math.abs(w.x) < W / 2 - 0.005 && w.y < H / 2 && w.y > -H / 2, 'by the window: the far eye stays in the room');
});

test('box nav: no station view shows void or back faces at the head-tracking extremes (GPU)', { skip: process.env.SCENE_GPU_TESTS !== '1', timeout: 1200000 }, () => {
  const out = mkdtempSync(join(tmpdir(), 'box-nav-'));
  try {
    const r = spawnSync(process.execPath, [join(root, 'tools', 'scene-box-nav-rounds.mjs'), '--out', out, '--steps', 'void', '--samples', '0', '--corners', '0'], { cwd: root, encoding: 'utf8', timeout: 1150000 });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    const rep = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')).void;
    assert.equal(rep.poses, nav.stations.length);
    // a uniform black sky passes the mask: every frame must also carry light
    for (const l of rep.lumas) assert.ok(l.p90 >= 8, `${l.id} ${l.eye}: luma p90 ${l.p90} (a black frame)`);
    for (const b of rep.bad) {
      assert.equal(b.frac, 0, `void at ${b.id} ${b.eye}`);
      // thin boxes leave a few back-facing pixels on their silhouettes when
      // drawn without MSAA; a real back face is thousands
      assert.ok(b.back < 0.001, `back faces at ${b.id} ${b.eye}: ${(b.back * 100).toFixed(3)} % ${JSON.stringify(b.byName)}`);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

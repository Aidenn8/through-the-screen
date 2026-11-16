// Scene contract and design-geometry tests (no GPU needed).
//
// The geometric ones encode the rules the scenes are designed around
// (docs/REFERENCES.md 5.4): things in front of the glass must stay inside the
// frame from every eye in the comfortable range, and the soundstage's reveals
// must be hidden straight on but visible when you lean.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { glassPoint } from '../../src/core/projection.js';
import { toWindow, toReal, SCALE, DECK, DINER, CAR_AT, BCAM, SOFTBOX, FLAG } from '../../src/scenes/soundstage/layout.js';
import { carBoxes } from '../../src/scenes/soundstage/car.js';
import { VIEW_DEFAULTS } from '../../src/tracking/view-map.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const W = 0.326571; // full screen below the notch (docs/REFERENCES.md 1.5)
const H = 0.205109;

// Eye positions the viewer actually uses: lean +-25 cm, +-12 cm up/down, 35-90 cm away.
const EYES = [];
for (const x of [-0.25, -0.12, 0, 0.12, 0.25]) for (const y of [-0.12, 0, 0.12]) for (const z of [0.35, 0.6, 0.9]) EYES.push({ x, y, z });

// The range the scenes are built for (Look around at 3x, with head tilt on
// top): +-45 cm sideways, up to 45 cm down and 50 cm up, 35-85 cm away,
// inside the cone the scenes ask for (docs/SCENES_NOTES.md, "View limits
// wanted": |x| <= z, |y| <= 0.75 z), plus the corners of the cone view-map.js holds.
const WIDE = [];
for (const x of [-0.45, -0.3, 0, 0.3, 0.45]) for (const y of [-0.45, -0.25, 0, 0.25, 0.5]) for (const z of [0.35, 0.45, 0.6, 0.85]) {
  if (Math.abs(x) <= z + 1e-9 && Math.abs(y) <= 0.75 * z + 1e-9) WIDE.push({ x, y, z });
}
for (const z of [0.35, 0.45, 0.6]) for (const sx of [-1, 1]) for (const sy of [-1, 1]) WIDE.push({ x: sx * Math.min(0.45, z), y: sy * Math.min(sy < 0 ? 0.45 : 0.5, 0.75 * z), z });

// The corners of the view limits in src/tracking/view-map.js (owned by the
// motion work; read here so the frame tests follow it).
function coneCorners() {
  const L = VIEW_DEFAULTS.limits;
  const out = [];
  for (const z of [L.zMin, 0.25, 0.35, 0.45, 0.6, 0.85, 1.2]) {
    const xm = Math.min(L.x, L.xPerZ * z);
    for (const sx of [-1, 0, 1]) for (const sy of [-1, 1]) {
      const y = sy > 0 ? Math.min(L.yMax, L.yPerZ * z) : -Math.min(-L.yMin, L.yPerZ * z);
      out.push({ x: sx * xm, y, z });
    }
  }
  return out;
}

const inside = (g, margin = 0) => Math.abs(g.x) < W / 2 - margin && Math.abs(g.y) < H / 2 - margin;
const P = (a) => ({ x: a[0], y: a[1], z: a[2] });

test('every scene folder exports the scene contract', async () => {
  const dirs = readdirSync(join(root, 'src', 'scenes'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name);
  assert.ok(dirs.includes('soundstage') && dirs.includes('box'));
  for (const id of dirs) {
    const file = join(root, 'src', 'scenes', id, 'index.js');
    assert.ok(existsSync(file), `${id}/index.js`);
    const mod = (await import(file)).default;
    assert.equal(mod.id, id);
    assert.equal(typeof mod.title, 'string');
    assert.equal(typeof mod.create, 'function');
  }
});

test('scene order: the Soundstage is the first scene, chosen explicitly', async () => {
  // src/app/scenes.js sorts by order, then title; titles alone would put Box first.
  const soundstage = (await import(join(root, 'src', 'scenes', 'soundstage', 'index.js'))).default;
  const box = (await import(join(root, 'src', 'scenes', 'box', 'index.js'))).default;
  assert.equal(typeof soundstage.order, 'number');
  assert.equal(typeof box.order, 'number');
  assert.ok(soundstage.order < box.order);
});

test('soundstage: the boom mic is in front of the glass and never touches the frame', () => {
  const mic = toWindow(-0.32, 2.88, 6.68);
  const pivot = toWindow(0.96, 6.8, 2.56);
  assert.ok(mic[2] > 0.015, 'windscreen sits in front of the glass');

  const r = 0.26 * SCALE; // windscreen half-length plus fur
  // and every corner of the cone the view is actually held to
  for (const e of coneCorners()) {
    for (const [dx, dy] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
      assert.ok(inside(glassPoint(e, { x: mic[0] + dx, y: mic[1] + dy, z: mic[2] }), 0.002), `mic inside frame from the cone corner ${JSON.stringify(e)}`);
    }
  }
  // where the pole passes through the glass
  const t = mic[2] / (mic[2] - pivot[2]);
  const cross = { x: mic[0] + (pivot[0] - mic[0]) * t, y: mic[1] + (pivot[1] - mic[1]) * t };
  assert.ok(inside(cross, 0.015), 'pole crosses the glass well inside the frame');
  for (const e of [...EYES, ...WIDE]) {
    for (const [dx, dy] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
      const g = glassPoint(e, { x: mic[0] + dx, y: mic[1] + dy, z: mic[2] });
      assert.ok(inside(g, 0.003), `mic inside frame from eye ${JSON.stringify(e)}`);
    }
  }
});

test('soundstage: reveals are hidden straight on and appear when leaning', () => {
  const centre = { x: 0, y: 0, z: 0.6 };
  const left = { x: -0.25, y: 0, z: 0.6 };
  const down = { x: 0, y: -0.12, z: 0.6 };
  // the B-camera: hidden straight on (checked here), seen when leaning (next test)
  const cam = P(toWindow(BCAM.x, BCAM.floor + BCAM.lens, BCAM.z));
  assert.ok(!inside(glassPoint(centre, cam)), 'camera hidden from the centre');
  // the moon HMI hangs above the frame
  const moon = P(toWindow(-3.4, 7.5, -8.6));
  assert.ok(!inside(glassPoint(centre, moon)), 'moon light hidden from the centre');
  assert.ok(inside(glassPoint(down, moon)), 'moon light seen when ducking');
  // the diner facade's right end is just outside the frame
  const end = P(toWindow(5.4, 1.5, 0));
  assert.ok(!inside(glassPoint(centre, end)), 'set edge hidden from the centre');
  assert.ok(inside(glassPoint(left, end)), 'set edge revealed when leaning left');
  // the street deck's front edge hides below the frame
  const deck = P(toWindow(0, 0.1, 5.4));
  assert.ok(!inside(glassPoint(centre, deck)), 'deck edge hidden from the centre');
});

// Segment p -> q against an axis-aligned box (slab test); real metres.
function blocks(p, q, b) {
  let t0 = 0;
  let t1 = 1;
  for (let k = 0; k < 3; k++) {
    const d = q[k] - p[k];
    if (Math.abs(d) < 1e-9) {
      if (p[k] < b.min[k] || p[k] > b.max[k]) return false;
      continue;
    }
    let ta = (b.min[k] - p[k]) / d;
    let tb = (b.max[k] - p[k]) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return t0 < 0.999;
}

test('soundstage: leaning left, nothing hides the B-camera (occlusion, not just frame bounds)', () => {
  // What could stand between the viewer and the camera: the parked car (body
  // and greenhouse), the diner's facade and its end wall, the key softbox.
  const occluders = {
    'car body': carBoxes(CAR_AT, DECK)[0],
    'car greenhouse': carBoxes(CAR_AT, DECK)[1],
    facade: { min: [DINER.x0, 0, -0.14], max: [DINER.x1 + 0.05, DINER.height + 0.1, 0.12] },
    'diner end wall': { min: [DINER.x1 - 0.25, 0, DINER.back], max: [DINER.x1 + 0.05, DINER.height, 0] },
    softbox: { min: [SOFTBOX.head[0] - 0.75, SOFTBOX.head[1] - 0.8, SOFTBOX.head[2] - 0.75], max: [SOFTBOX.head[0] + 0.75, SOFTBOX.head[1] + 0.8, SOFTBOX.head[2] + 0.75] },
    flag: { min: [FLAG.at[0] - 0.45, FLAG.at[1] - 1.25, FLAG.at[2] - 0.45], max: [FLAG.at[0] + 0.45, FLAG.at[1], FLAG.at[2] + 0.45] },
  };
  // the whole camera, not just its centre: a 3x3x3 lattice over its body and
  // matte box (half of it peeking over the car roof is not "seen")
  const parts = [];
  for (const dx of [-0.2, 0, 0.2]) for (const dy of [-0.13, 0, 0.13]) for (const dz of [-0.2, 0, 0.2]) {
    parts.push([BCAM.x + dx, BCAM.floor + BCAM.lens + dy, BCAM.z + dz]);
  }
  const seen = (lean) => {
    const eye = { x: lean, y: 0, z: 0.6 };
    const eyeReal = toReal(eye.x, eye.y, eye.z);
    const hiddenBy = {};
    let n = 0;
    for (const p of parts) {
      if (!inside(glassPoint(eye, P(toWindow(...p))), 0.004)) { hiddenBy.frame = (hiddenBy.frame ?? 0) + 1; continue; }
      const by = Object.entries(occluders).find(([, box]) => blocks(eyeReal, p, box));
      if (by) hiddenBy[by[0]] = (hiddenBy[by[0]] ?? 0) + 1;
      else n++;
    }
    return { frac: n / parts.length, hiddenBy };
  };
  // the reveal preset (25 cm): all of it; a modest 15 cm lean: it is coming into view
  const s25 = seen(-0.25);
  assert.equal(s25.frac, 1, `camera fully seen leaning 25 cm; hidden: ${JSON.stringify(s25.hiddenBy)}`);
  const s15 = seen(-0.15);
  assert.ok(s15.frac >= 0.5, `at least half the camera seen leaning 15 cm (${(s15.frac * 100).toFixed(0)} %); hidden: ${JSON.stringify(s15.hiddenBy)}`);
});

test('box: the bell hangs in front of the glass, inside the frame from every eye', () => {
  const bell = { x: 0.05, y: H / 2 - 0.0626, z: 0.03 };
  for (const e of [...EYES, ...WIDE, ...coneCorners()]) {
    for (const [dx, dy] of [[-0.012, 0.012], [0.012, 0.012], [-0.012, -0.05], [0.012, -0.05]]) {
      assert.ok(inside(glassPoint(e, { x: bell.x + dx, y: bell.y + dy, z: bell.z }), 0.002), `bell from ${JSON.stringify(e)}`);
    }
  }
});

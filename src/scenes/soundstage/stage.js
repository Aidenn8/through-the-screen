// The stage building around the set, for the big Look around swings: the
// walls up to a roof on steel trusses, catwalks along both side walls, chain
// motors carrying the pipe grid, and more lamps hung in the grid. Real metres,
// stage floor at y 0. Near-black under work light (ss02, ss05): the structure
// shows as edges catching a few caged bulbs, never as a lit room.

import * as THREE from 'three';
import { mat4 } from '../_lib/geo.js';

export const ROOF_Y = 14.5;
export const GRID_Y = 8.6;
const WALL_X = 14;
const BACK_Z = -17;
const FRONT_Z = 9;
const CAT_Y = 10.4; // side catwalks, above the pipe grid

export function buildStageShell(B, m) {
  const noShadow = { cast: false, receive: false };
  const H = ROOF_Y;
  const len = FRONT_Z - BACK_Z;
  const zc = (FRONT_Z + BACK_Z) / 2;
  // walls: acoustic panels with vertical ribs, up to the roof
  B.box('stageWall', m.stageWall, [2 * WALL_X + 2, H, 0.3], [0, H / 2, BACK_Z]);
  for (const s of [-1, 1]) B.box('stageWall', m.stageWall, [0.3, H, len], [s * WALL_X, H / 2, zc]);
  for (let x = -13; x <= 13; x += 1.2) B.box('stageWall', m.stageWall, [0.12, H - 1, 0.1], [x, (H - 1) / 2, BACK_Z + 0.2], [0, 0, 0], noShadow);
  for (let z = BACK_Z + 1; z <= FRONT_Z - 1; z += 1.2) {
    for (const s of [-1, 1]) B.box('stageWall', m.stageWall, [0.1, H - 1, 0.12], [s * (WALL_X - 0.2), (H - 1) / 2, z], [0, 0, 0], noShadow);
  }
  // a painted band at catwalk height and a kick rail along the floor, so the
  // walls read as walls even where only the work bulbs touch them
  for (const s of [-1, 1]) {
    B.box('blackPaint', m.blackPaint, [0.05, 0.25, len], [s * (WALL_X - 0.27), 0.125, zc], [0, 0, 0], noShadow);
  }
  B.box('blackPaint', m.blackPaint, [2 * WALL_X, 0.25, 0.05], [0, 0.125, BACK_Z + 0.27], [0, 0, 0], noShadow);

  // roof deck (corrugated, seen from below) on steel trusses every 4 m
  B.box('roof', m.roof, [2 * WALL_X + 2, 0.2, len + 2], [0, H + 0.1, zc], [0, 0, 0], noShadow);
  const top = H - 0.25;
  const bot = H - 1.6;
  for (let z = BACK_Z + 2; z <= FRONT_Z; z += 4) {
    B.box('truss', m.truss, [2 * WALL_X, 0.22, 0.22], [0, top, z], [0, 0, 0], noShadow);
    B.box('truss', m.truss, [2 * WALL_X, 0.18, 0.18], [0, bot, z], [0, 0, 0], noShadow);
    for (let i = 0; i < 28; i++) {
      const x0 = -WALL_X + i;
      const up = i % 2 === 0;
      B.rod('truss', m.truss, [x0, up ? bot : top, z], [x0 + 1, up ? top : bot, z], 0.045, 5, noShadow);
      B.rod('truss', m.truss, [x0, bot, z], [x0, top, z], 0.035, 5, noShadow);
    }
  }
  // work bulbs on cords from the trusses' bottom chords: the hot points of a
  // dark roof (ss03), and what lights the steel around them
  const trussBulbs = [];
  for (const [x, z] of [[-7, -7], [0, -11], [7, -7], [-3, 1], [8, 1], [-9, 5]]) {
    const zz = Math.round((z - (BACK_Z + 2)) / 4) * 4 + BACK_Z + 2;
    const p = [x, bot - 0.9, zz];
    B.rod('cableBlack', m.cableBlack, [x, bot, zz], [x, p[1] + 0.1, zz], 0.012, 4, noShadow);
    B.add('castIron', m.castIron, new THREE.CylinderGeometry(0.09, 0.09, 0.2, 8, 1, true), mat4(p), noShadow);
    B.add('bulb', m.bulb, new THREE.SphereGeometry(0.055, 10, 8), mat4(p), noShadow);
    trussBulbs.push(p);
  }
  // wall-mounted floods high on the side and back walls, burning low: soft
  // warm pools on the acoustic panels (glow cards), so the upper walls read
  // as walls from the low, wide eyes instead of as a black void
  for (const [x, y, z, ry] of [[WALL_X - 0.32, 7.2, -9.5, -Math.PI / 2], [WALL_X - 0.32, 7.2, -2.0, -Math.PI / 2], [WALL_X - 0.32, 7.2, 5.0, -Math.PI / 2],
    [-WALL_X + 0.32, 7.2, -9.5, Math.PI / 2], [-WALL_X + 0.32, 7.2, -2.0, Math.PI / 2], [-WALL_X + 0.32, 7.2, 5.0, Math.PI / 2],
    [-7, 7.2, BACK_Z + 0.32, 0], [7, 7.2, BACK_Z + 0.32, 0]]) {
    const T = mat4([x, y, z], [0, ry, 0]);
    B.add('blackPaint', m.blackPaint, new THREE.BoxGeometry(0.4, 0.3, 0.25), T, noShadow);
    B.add('bulb', m.bulb, new THREE.PlaneGeometry(0.3, 0.18), new THREE.Matrix4().multiplyMatrices(T, mat4([0, 0, 0.13])), noShadow);
    B.add('glowFlood', m.glowFlood, new THREE.PlaneGeometry(3.6, 5.0), new THREE.Matrix4().multiplyMatrices(T, mat4([0, -1.4, -0.06])), noShadow);
  }
  // purlins along the stage between the trusses
  for (let x = -12; x <= 12; x += 3) B.box('truss', m.truss, [0.12, 0.16, len], [x, H - 0.1, zc], [0, 0, 0], noShadow);

  // side catwalks: grating, toe boards, two rails, hangers to the trusses
  const catBulbs = [];
  for (const s of [-1, 1]) {
    const x = s * (WALL_X - 1.0);
    const xo = x - s * 0.55; // the open (stage-side) edge
    B.box('catwalk', m.catwalk, [1.1, 0.06, len - 2], [x, CAT_Y, zc], [0, 0, 0], noShadow);
    B.box('darkMetal', m.darkMetal, [0.03, 0.15, len - 2], [xo, CAT_Y + 0.1, zc], [0, 0, 0], noShadow);
    for (const y of [0.55, 1.05]) B.rod('gripSilver', m.gripSilver, [xo, CAT_Y + y, BACK_Z + 1], [xo, CAT_Y + y, FRONT_Z - 1], 0.025, 6, noShadow);
    for (let z = BACK_Z + 1; z <= FRONT_Z - 1; z += 1.5) {
      B.rod('gripSilver', m.gripSilver, [xo, CAT_Y, z], [xo, CAT_Y + 1.08, z], 0.02, 5, noShadow);
    }
    for (let z = BACK_Z + 2; z <= FRONT_Z; z += 4) B.rod('darkMetal', m.darkMetal, [xo, CAT_Y, z], [xo, bot, z], 0.02, 4, noShadow);
    // caged bulbs under the catwalk, every other one burning
    for (let z = BACK_Z + 3.5, i = 0; z <= FRONT_Z - 2; z += 5, i++) {
      const p = [x, CAT_Y - 0.3, z];
      B.add('castIron', m.castIron, new THREE.CylinderGeometry(0.09, 0.09, 0.2, 8, 1, true), mat4(p), noShadow);
      B.add(i % 2 ? 'bulbOff' : 'bulb', i % 2 ? m.bulbOff : m.bulb, new THREE.SphereGeometry(0.055, 10, 8), mat4(p), noShadow);
      if (!(i % 2)) catBulbs.push(p);
    }
  }

  // chain motors on the trusses' bottom chords, their chains carrying the grid
  const motors = [[-10, -11], [-4, -11], [4, -11], [10, -11], [-10, -3], [-4, -3], [4, -3], [10, -3], [-7, 5], [7, 5]];
  for (const [x, z0] of motors) {
    const z = Math.round((z0 - (BACK_Z + 2)) / 4) * 4 + BACK_Z + 2; // under a truss
    B.rod('darkMetal', m.darkMetal, [x, bot, z], [x, bot - 0.35, z], 0.02, 4, noShadow); // sling
    B.box('motor', m.motor, [0.32, 0.5, 0.3], [x, bot - 0.65, z], [0, 0.3, 0], noShadow);
    B.cyl('motor', m.motor, 0.11, 0.11, 0.36, [x + 0.2, bot - 0.6, z], [0, 0, Math.PI / 2], 10, noShadow);
    // chain bag hanging beside it, and the load chain down to the grid
    B.add('blackCloth', m.blackCloth, new THREE.CylinderGeometry(0.13, 0.09, 0.45, 8), mat4([x - 0.22, bot - 1.05, z]), noShadow);
    B.rod('chain', m.chain, [x, bot - 0.9, z], [x, GRID_Y + 0.05, z], 0.016, 4, noShadow);
    // its status LED, green: the point of light you find looking straight up
    B.add('tally', m.tally, new THREE.SphereGeometry(0.035, 8, 6), mat4([x, bot - 0.88, z + 0.16]), noShadow);
  }
  // two par cans clamped to the trusses over the set, burning: hot points
  // with a pool on the steel around them, seen from below
  for (const [x, z] of [[-2, -11], [2.5, -7]]) {
    const zz = Math.round((z - (BACK_Z + 2)) / 4) * 4 + BACK_Z + 2;
    const p = [x, bot - 0.35, zz + 0.2];
    B.add('blackPaint', m.blackPaint, new THREE.CylinderGeometry(0.13, 0.11, 0.42, 14), mat4(p, [0.25, 0, 0]), noShadow);
    B.add('fresnelLens', m.fresnelLens, new THREE.CircleGeometry(0.105, 18), mat4([p[0], p[1] - 0.215, p[2] + 0.05], [Math.PI / 2 + 0.25, 0, 0]), noShadow);
    B.add('glowFlood', m.glowFlood, new THREE.PlaneGeometry(2.5, 2.5), mat4([x, bot + 0.02, zz], [Math.PI / 2, 0, 0]), noShadow);
  }

  // more of the plot hung in the grid: fresnels (a few burning, aimed at the
  // set), LED soft panels switched low, and a cyc strip toward the back
  const lamps = [];
  for (const [x, z, tx, tz, lit] of [[-9, -1.8, -4, 1.5, true], [-7.5, 2.5, -3, 3, false], [8.5, 1.5, 4, 2, true], [9.5, -8, 6, -3, false],
    [-10.5, -9.5, -7, -6, false], [2.5, 4.6, 1.5, 0.5, true], [-1.5, 4.8, -0.5, 0.5, false], [11, 4, 7, 1, false], [-11, 4.5, -7, 1.5, true]]) {
    lamps.push({ pos: [x, GRID_Y - 0.75, z], target: [tx, 0, tz], lit });
  }
  for (const [x, z] of [[-6, -13.5], [0, -13.5], [6, -13.5]]) {
    B.rod('darkMetal', m.darkMetal, [x, GRID_Y, z], [x, GRID_Y - 0.3, z], 0.015, 4, noShadow);
    B.box('blackPaint', m.blackPaint, [1.4, 0.18, 0.5], [x, GRID_Y - 0.35, z], [-0.5, 0, 0], noShadow);
    B.add('ledPanel', m.ledPanel, new THREE.PlaneGeometry(1.3, 0.42), mat4([x, GRID_Y - 0.35 - 0.092, z + 0.05], [Math.PI / 2 - 0.5, 0, 0]), noShadow);
  }
  return { catBulbs, trussBulbs, lamps };
}

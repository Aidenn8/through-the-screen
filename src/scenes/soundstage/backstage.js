// Everything that gives the set away when you lean: the braced backs of the
// flats, grip and lighting gear, a camera on a dolly, cables, the lighting
// grid and the stage walls. Real metres.

import * as THREE from 'three';
import { Builder, boxUV, mat4, tube } from '../_lib/geo.js';
import { DECK, DINER, BRICK_WALL, RIG, BCAM, SOFTBOX, FLAG, FRONT_EDGE } from './layout.js';
import { buildStageShell } from './stage.js';
import { buildCrewArea } from './crew.js';
import { buildStreetEnd } from './streetend.js';
import { BOOM_TOP } from './boom.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Matrix placing a local frame at pos with +Z pointing at target.
export function aimMatrix(pos, target, up = [0, 1, 0]) {
  const m = new THREE.Matrix4().lookAt(V(...target), V(...pos), V(...up));
  m.setPosition(V(...pos));
  return m;
}
const mul = (a, b) => new THREE.Matrix4().multiplyMatrices(a, b);

// ---------------------------------------------------------------- pieces
export function sandbag(B, m, [x, y, z], rotY = 0) {
  const g = new THREE.CapsuleGeometry(0.11, 0.32, 4, 10);
  g.scale(1, 0.55, 1.0);
  B.add('sandbag', m.sandbag, g, mat4([x, y + 0.07, z], [Math.PI / 2, rotY, 0]));
}

// Stage jack: a triangle of 1x3 behind a flat. `out` is the unit direction
// away from the flat's back, floor at y0.
let jackCount = 0;
function jack(B, m, base, out, h, y0) {
  const [bx, , bz] = base;
  const reach = h * 0.55; // ~61 degrees
  const foot = [bx + out[0] * reach, y0, bz + out[1] * reach];
  B.rod('pine', m.pine, [bx, y0, bz], [bx, y0 + h, bz], 0.022, 4);
  B.rod('pine', m.pine, [bx, y0 + h * 0.95, bz], foot, 0.022, 4);
  B.rod('pine', m.pine, [bx, y0 + 0.03, bz], foot, 0.022, 4);
  // sills weighted with cinder blocks, now and then a sandbag (fb01)
  const sx = foot[0] - out[0] * 0.3;
  const sz = foot[2] - out[1] * 0.3;
  if (jackCount++ % 3 === 2) sandbag(B, m, [sx, y0, sz], Math.atan2(out[1], out[0]));
  else {
    const rot = Math.atan2(out[0], out[1]);
    B.box('cinder', m.cinder, [0.39, 0.19, 0.19], [sx, y0 + 0.095, sz], [0, rot, 0]);
    if (jackCount % 2) B.box('cinder', m.cinder, [0.39, 0.19, 0.19], [sx + out[1] * 0.05, y0 + 0.285, sz - out[0] * 0.05], [0, rot + 0.12, 0]);
  }
}

// Mirror a geometry's u (a back read from the other side).
function flipU(g, on) {
  if (!on) return g;
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, -uv.getX(i));
  return g;
}

// Back of a flat running along z (constant x), back facing +side (±1 in x).
export function flatBackX(B, m, x, z0, z1, y0, y1, side, { jacks = true, stencil = null } = {}) {
  const len = Math.abs(z1 - z0);
  const zc = (z0 + z1) / 2;
  const h = y1 - y0;
  // luan skin (u runs the way the back is read: stencils not mirrored)
  B.add('luan', m.luan, flipU(boxUV(0.006, h, len), side > 0), mat4([x + side * 0.003, y0 + h / 2, zc]));
  const fx = x + side * 0.04;
  // frame: rails top/bottom, stiles every ~1.2 m, toggles every ~0.6 m
  B.box('pine', m.pine, [0.07, 0.07, len], [fx, y0 + 0.035, zc]);
  B.box('pine', m.pine, [0.07, 0.07, len], [fx, y1 - 0.035, zc]);
  const nSt = Math.max(1, Math.round(len / 1.2));
  for (let i = 0; i <= nSt; i++) {
    const z = Math.min(z0, z1) + (len * i) / nSt;
    B.box('pine', m.pine, [0.07, h, 0.07], [fx, y0 + h / 2, z]);
  }
  for (let y = y0 + 0.6; y < y1 - 0.2; y += 0.6) B.box('pine', m.pine, [0.065, 0.06, len], [fx, y, zc]);
  if (jacks) {
    const nJ = Math.max(1, Math.floor(len / 1.25));
    for (let i = 0; i < nJ; i++) {
      const z = Math.min(z0, z1) + (len * (i + 0.5)) / nJ;
      jack(B, m, [x + side * 0.08, 0, z], [side, 0], Math.min(h * 0.82, 3.2), 0);
    }
  }
  return stencil;
}

// Back of a flat running along x (constant z); the back faces -z (side -1)
// or +z (side +1, i.e. toward the viewer).
export function flatBackZ(B, m, z, x0, x1, y0, y1, { jacks = true, side = -1, face = null } = {}) {
  const len = x1 - x0;
  const xc = (x0 + x1) / 2;
  const h = y1 - y0;
  B.add('luan', m.luan, flipU(boxUV(len, h, 0.006), side < 0), mat4([xc, y0 + h / 2, z + side * 0.003]));
  if (face) B.add(face, m[face], boxUV(len, h, 0.006), mat4([xc, y0 + h / 2, z - side * 0.003]));
  const fz = z + side * 0.04;
  B.box('pine', m.pine, [len, 0.07, 0.07], [xc, y0 + 0.035, fz]);
  B.box('pine', m.pine, [len, 0.07, 0.07], [xc, y1 - 0.035, fz]);
  const nSt = Math.max(1, Math.round(len / 1.2));
  for (let i = 0; i <= nSt; i++) B.box('pine', m.pine, [0.07, h, 0.07], [x0 + (len * i) / nSt, y0 + h / 2, fz]);
  for (let y = y0 + 0.6; y < y1 - 0.2; y += 0.6) B.box('pine', m.pine, [len, 0.06, 0.065], [xc, y, fz]);
  if (jacks) {
    const nJ = Math.max(1, Math.floor(len / 1.25));
    for (let i = 0; i < nJ; i++) jack(B, m, [x0 + (len * (i + 0.5)) / nJ, 0, z + side * 0.08], [0, side], Math.min(h * 0.82, 3.2), y0);
  }
}

// C-stand: turtle base, riser, grip head, arm, flag. Floor at y.
export function cStand(B, m, [x, y, z], { height = 2.0, armTo = null, flag = [0.6, 0.9], flagRot = 0 } = {}) {
  const legs = [[0.42, 0.0, 0], [0.38, 0.12, 2.1], [0.36, 0.24, 4.2]];
  for (const [l, hh, a] of legs) {
    B.rod('gripSilver', m.gripSilver, [x, y + 0.42 + hh, z], [x + Math.cos(a) * l, y + 0.01, z + Math.sin(a) * l], 0.011, 5);
  }
  B.rod('gripSilver', m.gripSilver, [x, y + 0.01, z], [x, y + height, z], 0.014, 6);
  B.rod('gripSilver', m.gripSilver, [x, y + height * 0.55, z], [x, y + height * 0.56, z], 0.02, 6);
  sandbag(B, m, [x + 0.3, y, z], 0.2);
  if (armTo) {
    const head = [x, y + height, z];
    B.add('darkMetal', m.darkMetal, new THREE.SphereGeometry(0.04, 8, 6), mat4(head));
    B.rod('gripSilver', m.gripSilver, head, armTo, 0.01, 5);
    // flag frame (black cloth on a steel frame)
    const [fw, fh] = flag;
    const fm = mul(mat4(armTo, [0, flagRot, 0]), mat4([0, -fh / 2, 0]));
    B.add('blackCloth', m.blackCloth, new THREE.PlaneGeometry(fw, fh), fm);
    B.add('blackCloth', m.blackCloth, new THREE.PlaneGeometry(fw, fh), mul(fm, mat4([0, 0, 0], [0, Math.PI, 0])));
    for (const [a, b] of [[[-fw / 2, -fh / 2], [fw / 2, -fh / 2]], [[-fw / 2, fh / 2], [fw / 2, fh / 2]], [[-fw / 2, -fh / 2], [-fw / 2, fh / 2]], [[fw / 2, -fh / 2], [fw / 2, fh / 2]]]) {
      const pa = V(a[0], a[1], 0).applyMatrix4(fm);
      const pb = V(b[0], b[1], 0).applyMatrix4(fm);
      B.rod('gripSilver', m.gripSilver, pa.toArray(), pb.toArray(), 0.008, 4);
    }
  }
}

// Roller stand with a light head aimed at target. Returns head centre.
export function rollerStand(B, m, [x, y, z], height) {
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const fx = x + Math.cos(a) * 0.6;
    const fz = z + Math.sin(a) * 0.6;
    B.rod('blackPaint', m.blackPaint, [x, y + 0.25, z], [fx, y + 0.1, fz], 0.022, 6);
    B.cyl('rubber', m.rubber, 0.06, 0.06, 0.04, [fx, y + 0.06, fz], [Math.PI / 2, a, 0], 10);
  }
  B.rod('blackPaint', m.blackPaint, [x, y + 0.1, z], [x, y + height, z], 0.03, 8);
  B.rod('gripSilver', m.gripSilver, [x, y + height * 0.6, z], [x, y + height, z], 0.022, 8);
}

// Fresnel head: housing pointing +Z in the aim frame, glowing lens, barn doors.
function fresnel(B, m, pos, target, size = 0.3, lit = true) {
  const A = aimMatrix(pos, target);
  const r = size / 2;
  B.add('blackPaint', m.blackPaint, new THREE.CylinderGeometry(r, r * 1.05, size * 1.3, 16), mul(A, mat4([0, 0, -size * 0.2], [Math.PI / 2, 0, 0])));
  B.add('blackPaint', m.blackPaint, new THREE.CylinderGeometry(r * 0.5, r * 0.6, size * 0.3, 12), mul(A, mat4([0, r * 1.05, -size * 0.3])));
  B.add(lit ? 'fresnelLens' : 'blackPaint', lit ? m.fresnelLens : m.blackPaint, new THREE.CircleGeometry(r * 0.85, 20), mul(A, mat4([0, 0, size * 0.46])), { cast: false, receive: false });
  // barn doors, opened
  for (const [ax, ay, rx, ry] of [[0, r * 1.1, -0.9, 0], [0, -r * 1.1, 0.9, 0], [r * 1.1, 0, 0, 0.9], [-r * 1.1, 0, 0, -0.9]]) {
    const d = mul(A, mat4([ax, ay, size * 0.5], [rx, ry, 0]));
    B.add('blackPaint', m.blackPaint, boxUV(ax ? 0.01 : size * 1.0, ay ? 0.01 : size * 1.0, size * 0.55), mul(d, mat4([0, 0, size * 0.25])));
  }
  // yoke
  B.add('blackPaint', m.blackPaint, new THREE.TorusGeometry(r * 1.2, 0.012, 4, 12, Math.PI), mul(A, mat4([0, 0, -size * 0.1], [0, Math.PI / 2, Math.PI / 2])));
  return A;
}

// Softbox / LED panel with a big diffusion face, aimed at target.
// Softbox (gg01, gg05): a black fabric pyramid on a speed ring, the front
// diffusion recessed a few centimetres behind a black fabric lip, so the face
// reads as a soft glowing panel inside a dark frame, not a white card.
function softbox(B, m, pos, target, w = 1.2, h = 1.2) {
  const A = aimMatrix(pos, target);
  const d = 0.62;
  // tapered fabric body, slightly bowed by its rods
  const g = new THREE.CylinderGeometry(Math.SQRT1_2 * w, Math.SQRT1_2 * 0.3, d, 4, 3, true);
  g.rotateY(Math.PI / 4);
  g.rotateX(-Math.PI / 2);
  g.scale(1, h / w, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    const t = 1 - Math.abs(z / (d / 2)); // bulge mid-depth
    p.setX(i, p.getX(i) * (1 + 0.05 * t));
    p.setY(i, p.getY(i) * (1 + 0.05 * t));
  }
  g.computeVertexNormals();
  B.add('softboxBody', m.softboxBody, g, mul(A, mat4([0, 0, -d / 2])));
  // front lip: a black frame 10 cm wide standing 5 cm proud of the diffusion
  const lw = 0.1;
  for (const [x, y, sw, sh] of [[0, h / 2 - lw / 2, w, lw], [0, -h / 2 + lw / 2, w, lw], [-w / 2 + lw / 2, 0, lw, h], [w / 2 - lw / 2, 0, lw, h]]) {
    B.add('softboxBody', m.softboxBody, boxUV(sw, sh, 0.05), mul(A, mat4([x, y, 0.025])));
  }
  B.add('diffusion', m.diffusion, new THREE.PlaneGeometry(w - 2 * lw, h - 2 * lw), mul(A, mat4([0, 0, 0.0])), { cast: false, receive: false });
  // a fabric eggcrate over the face (gg01): from straight on the cells show
  // the lit diffusion; off-axis their black walls close up, so from the side
  // a gridded softbox reads as a dark box with a lit face, not a white card
  const iw = w - 2 * lw;
  const ih = h - 2 * lw;
  const gd = 0.1; // grid depth
  const cells = 9;
  for (let k = 0; k <= cells; k++) {
    const t = -0.5 + k / cells;
    B.add('softboxBody', m.softboxBody, new THREE.PlaneGeometry(gd, ih), mul(A, mat4([t * iw, 0, gd / 2 + 0.002], [0, Math.PI / 2, 0])), { cast: false, receive: false });
    B.add('softboxBody', m.softboxBody, new THREE.PlaneGeometry(iw, gd), mul(A, mat4([0, t * ih, gd / 2 + 0.002], [Math.PI / 2, 0, 0])), { cast: false, receive: false });
  }
  // the four rods that hold the body open, from the speed ring to the corners
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const a = new THREE.Vector3(sx * 0.13, sy * 0.13, -d).applyMatrix4(A);
    const b = new THREE.Vector3((sx * w) / 2, (sy * h) / 2, -0.02).applyMatrix4(A);
    B.rod('gripSilver', m.gripSilver, a.toArray(), b.toArray(), 0.012, 4, { cast: false, receive: false });
  }
  // speed ring and the head behind it
  B.add('gripSilver', m.gripSilver, new THREE.TorusGeometry(0.2, 0.025, 6, 20), mul(A, mat4([0, 0, -d])));
  B.add('blackPaint', m.blackPaint, new THREE.CylinderGeometry(0.17, 0.17, 0.3, 16), mul(A, mat4([0, 0, -d - 0.16], [Math.PI / 2, 0, 0])));
  B.add('blackPaint', m.blackPaint, boxUV(0.08, 0.3, 0.1), mul(A, mat4([0, -0.25, -d - 0.1])));
  return A;
}

// Cable lying on the floor through points (x, z), floor height y.
export function cable(B, m, pts, y, mat = 'cableBlack', r = 0.018) {
  B.add(mat, m[mat], tube(pts.map(([x, z]) => [x, y + r, z]), r, pts.length * 12, 5), null, { cast: false, receive: true });
}

// ---------------------------------------------------------------- build
export function buildBackstage(root, m) {
  const B = new Builder();
  const noShadow = { cast: false, receive: false };

  // Stage floor (beyond and under the set) and the stage walls.
  // (to the front wall at z 32: the A-camera and the crew stand out there)
  const floor = new THREE.PlaneGeometry(30, 50);
  const uv = floor.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 30, uv.getY(i) * 50);
  B.add('stageFloor', m.stageFloor, floor, mat4([0, 0, 7.5], [-Math.PI / 2, 0, 0]), { cast: false, receive: true });
  // walls up to the roof, trusses, catwalks, chain motors (stage.js)
  const shell = buildStageShell(B, m);
  // video village, chairs, craft services, storage, the stage door (crew.js)
  const crew = buildCrewArea(B, m, { cStand, sandbag, cable });
  // the street's far end: the painted drop, the hose run, the pump (streetend.js)
  const end = buildStreetEnd(B, m, { sandbag });
  // elephant door outline + rolling light on the back wall
  B.box('darkMetal', m.darkMetal, [6, 7, 0.1], [7.5, 3.5, -16.8]);
  B.box('redLight', m.redLight, [0.3, 0.3, 0.1], [7.5, 7.5, -16.7], [0, 0, 0], noShadow);
  B.box('gripSilver', m.gripSilver, [0.5, 0.4, 0.15], [7.5, 7.5, -16.78]);

  // ----- backs of flats
  // Diner interior right wall: its back faces +x (seen when leaning left).
  // (the diner's end wall and its braced back are a wild wall: interior.js)
  // the facade's upper flat above the interior wall: back seen from the right
  flatBackZ(B, m, -0.12, DINER.x1 - 1.2, DINER.x1, DECK + 3.4, DINER.height, { jacks: false });
  // Brick wall flat: back faces -x (seen past its near end when leaning right).
  flatBackX(B, m, BRICK_WALL.x - 0.1, BRICK_WALL.z0, BRICK_WALL.z1, 0, BRICK_WALL.height, -1);
  // The next set on the stage, behind the street's right side: we only ever
  // see its braced back (the classic view of a set from the stage floor).
  flatBackZ(B, m, -5.6, 6.2, 10.8, 0, 3.8, { side: +1, face: 'stucco' });
  B.box('pine', m.pine, [0.07, 3.8, 0.6], [6.2, 1.9, -5.9]); // return flat edge
  B.box('stucco', m.stucco, [4.7, 0.2, 0.25], [8.5, 3.9, -5.75]); // top molding peeking over
  // A spare flat standing on the left behind the street's far kerb, its back
  // to us, "WILD" stencilled, braced down onto the street deck.
  flatBackZ(B, m, -1.2, -6.9, -5.45, 0, 3.6, { side: +1, face: 'brick', jacks: false });
  for (const x of [-6.55, -5.8]) {
    B.rod('pine', m.pine, [x, 2.5, -1.12], [x, DECK + 0.02, 0.35], 0.025, 5);
    sandbag(B, m, [x, DECK, 0.42], 0.0);
  }
  // Spare "wild" flats leaning on a rack, backs to us, right side and left side.
  for (let i = 0; i < 0; i++) {
    const z = -4.2 - i * 0.18;
    const x0 = 6.2 + i * 0.1;
    B.add('luan', m.luan, boxUV(1.2, 3.6, 0.006), mul(mat4([x0 + 0.6, 1.75, z], [-0.08, 0, 0]), mat4([0, 0, 0])));
    B.box('pine', m.pine, [1.2, 0.07, 0.07], [x0 + 0.6, 0.1, z + 0.04], [-0.08, 0, 0]);
    B.box('pine', m.pine, [0.07, 3.6, 0.07], [x0 + 0.03, 1.8, z + 0.05 + 0.14], [-0.08, 0, 0]);
    B.box('pine', m.pine, [0.07, 3.6, 0.07], [x0 + 1.17, 1.8, z + 0.05 + 0.14], [-0.08, 0, 0]);
  }

  // ----- right side (seen leaning left)
  // Key softbox on a roller stand, raking across the facade from the right.
  const sbPos = SOFTBOX.head;
  rollerStand(B, m, SOFTBOX.stand, SOFTBOX.head[1] - 0.35);
  softbox(B, m, sbPos, SOFTBOX.aim, SOFTBOX.size, SOFTBOX.size);
  // C-stand flag cutting the softbox off the street front (kept off the
  // sightline to the B-camera, see BCAM)
  cStand(B, m, FLAG.stand, { height: 2.5, armTo: FLAG.at, flag: [0.9, 1.2], flagRot: 0.5 });
  // second C-stand with a net, further back
  cStand(B, m, [7.3, 0, -2.2], { height: 2.6, armTo: [6.6, 2.9, -2.0], flag: [0.6, 0.6], flagRot: 1.1 });
  // 2K fresnel on a stand lighting the interior through the door (warm kicker)
  rollerStand(B, m, [6.9, 0, 1.9], 1.9);
  fresnel(B, m, [6.9, 2.05, 1.9], [3.3, 1.2, -1.0], 0.32, true);
  // B-camera on a dolly with track, on the corner of the sidewalk past the
  // diner's end, raised on a riser and aimed back along the windows. From a
  // left lean it stands over the car's roof in silhouette against the lit
  // flat backs (tests/scenes: occlusion check over the whole camera).
  const track = { x: BCAM.x, z0: BCAM.track[0], z1: BCAM.track[1], y: BCAM.floor };
  for (const dx of [-0.31, 0.31]) B.rod('track', m.track, [track.x + dx, track.y + 0.05, track.z0], [track.x + dx, track.y + 0.05, track.z1], 0.025, 8);
  for (let z = track.z0 + 0.1; z < track.z1; z += 0.5) B.box('wood', m.wood, [0.8, 0.04, 0.1], [track.x, track.y + 0.02, z]);
  const dz = BCAM.z;
  const DY = track.y;
  const lens = BCAM.lens;
  B.box('blackPaint', m.blackPaint, [0.75, 0.16, 1.0], [track.x, DY + 0.23, dz]);
  for (const [ox, oz] of [[-0.31, -0.4], [0.31, -0.4], [-0.31, 0.4], [0.31, 0.4]]) B.cyl('rubber', m.rubber, 0.07, 0.07, 0.06, [track.x + ox, DY + 0.12, dz + oz], [0, 0, Math.PI / 2], 12);
  // column and a riser up to the head
  B.cyl('gripSilver', m.gripSilver, 0.08, 0.1, lens - 0.62, [track.x, DY + 0.31 + (lens - 0.62) / 2, dz], [0, 0, 0], 12);
  B.cyl('blackPaint', m.blackPaint, 0.06, 0.06, 0.12, [track.x, DY + lens - 0.29, dz], [0, 0, 0], 12);
  B.box('blackPaint', m.blackPaint, [0.3, 0.12, 0.3], [track.x, DY + lens - 0.25, dz]); // head
  const camA = aimMatrix([track.x, DY + lens, dz], BCAM.aim);
  B.add('cameraBody', m.cameraBody, boxUV(0.22, 0.26, 0.45), mul(camA, mat4([0, 0, -0.05])));
  B.add('cameraBody', m.cameraBody, new THREE.CylinderGeometry(0.08, 0.08, 0.32, 16), mul(camA, mat4([0, 0, 0.32], [Math.PI / 2, 0, 0])));
  B.add('cameraBody', m.cameraBody, boxUV(0.34, 0.24, 0.12), mul(camA, mat4([0, 0, 0.53]))); // matte box
  B.add('monitor', m.monitor, new THREE.PlaneGeometry(0.17, 0.1), mul(camA, mat4([0.17, 0.08, -0.15], [0, -Math.PI / 2 - 0.5, 0])), noShadow);
  B.add('cameraBody', m.cameraBody, boxUV(0.02, 0.12, 0.19), mul(camA, mat4([0.165, 0.08, -0.15], [0, -0.5, 0])));
  B.rod('blackPaint', m.blackPaint, [track.x - 0.35, DY + 0.32, dz + 0.5], [track.x - 0.35, DY + 1.05, dz + 0.75], 0.015, 6); // push bar
  // apple boxes
  for (const [x, z, y, r] of [[6.75, -0.45, 0, 0.1], [6.73, -0.4, 0.2, -0.05], [7.0, 0.0, 0, 0.6]]) B.box('wood', m.wood, [0.5, 0.2, 0.3], [x, y + 0.1, z], [0, r, 0]);
  // distro box and cable runs
  B.box('darkMetal', m.darkMetal, [0.6, 0.45, 0.4], [8.4, 0.225, -4.0]);
  cable(B, m, [[SOFTBOX.stand[0], SOFTBOX.stand[2]], [7.3, -2.0], [7.6, -2.9], [8.0, -3.5], [8.3, -3.85]], 0);
  cable(B, m, [[6.9, 1.9], [7.0, 0.6], [7.2, -0.4], [7.8, -1.4], [8.1, -2.6], [8.35, -3.8]], 0, 'cableOrange', 0.014);
  cable(B, m, [[6.05, dz - 0.3], [6.7, -1.2], [7.2, -2.6]], 0, 'cableBlack', 0.012); // from the sidewalk's end
  // ghost light: a bare bulb in a cage on a stand, far back
  const gl = [10.2, 0, -8.0];
  B.rod('blackPaint', m.blackPaint, gl, [gl[0], 1.8, gl[2]], 0.025, 6);
  B.cyl('blackPaint', m.blackPaint, 0.35, 0.4, 0.08, [gl[0], 0.04, gl[2]], [0, 0, 0], 16);
  B.add('bulb', m.bulb, new THREE.SphereGeometry(0.07, 14, 10), mat4([gl[0], 1.92, gl[2]]), noShadow);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    B.rod('blackPaint', m.blackPaint, [gl[0], 1.82, gl[2]], [gl[0] + Math.cos(a) * 0.1, 1.95, gl[2] + Math.sin(a) * 0.1], 0.004, 3, noShadow);
  }
  B.add('glowWarmFloor', m.glowWarmFloor, new THREE.PlaneGeometry(5, 5), mat4([gl[0], 0.01, gl[2]], [-Math.PI / 2, 0, 0]), noShadow);

  // ----- left side (seen leaning right)
  // (the street deck runs on past here to the drop: this gear stands on it)
  const kick = [-6.3, DECK + 2.2, 0.4];
  rollerStand(B, m, [-6.3, DECK, 0.4], 2.05);
  fresnel(B, m, kick, [-2.6, 2.5, 1.8], 0.36, true);
  cStand(B, m, [-5.9, DECK, 1.7], { height: 2.1, armTo: [-5.2, DECK + 2.4, 1.6], flag: [0.7, 0.9], flagRot: -0.9 });
  // hazer, with its little status light
  B.box('blackPaint', m.blackPaint, [0.5, 0.35, 0.35], [-6.8, DECK + 0.18, 1.8], [0, 0.4, 0]);
  B.cyl('darkMetal', m.darkMetal, 0.1, 0.1, 0.12, [-6.62, DECK + 0.2, 2.0], [Math.PI / 2, 0.4, 0], 12);
  B.add('redLight', m.redLight, new THREE.SphereGeometry(0.015, 6, 4), mat4([-6.6, DECK + 0.37, 1.7]), noShadow);
  // A-frame ladder
  const lad = (ax, az, bx, bz) => {
    B.rod('gripSilver', m.gripSilver, [ax, 0, az], [(ax + bx) / 2, 2.6, (az + bz) / 2 + 0.0], 0.02, 5);
    B.rod('gripSilver', m.gripSilver, [ax + 0.45, 0, az], [(ax + bx) / 2 + 0.45, 2.6, (az + bz) / 2], 0.02, 5);
    for (let t = 0.12; t < 1; t += 0.14) {
      const x = ax + ((ax + bx) / 2 - ax) * t;
      const z = az + ((az + bz) / 2 - az) * t;
      B.rod('gripSilver', m.gripSilver, [x, 2.6 * t, z], [x + 0.45, 2.6 * t, z], 0.012, 4);
    }
  };
  lad(-7.6, -0.4, -7.6, -1.8);
  lad(-7.6, -3.2, -7.6, -1.8);
  // stage weights and spare sandbags
  for (const [x, z] of [[-6.9, -2.4], [-6.75, -2.6], [5.6, -3.4]]) sandbag(B, m, [x, 0, z], 0.7);
  for (let i = 0; i < 4; i++) B.box('darkMetal', m.darkMetal, [0.4, 0.07, 0.18], [-7.0, 0.035 + i * 0.07, -2.0], [0, 0.05 * i, 0]);
  // coiled spare hose on the deck; the kick's cable over the deck's back edge
  B.add('rubber', m.rubber, new THREE.TorusGeometry(0.4, 0.035, 6, 24), mat4([-7.2, DECK + 0.04, 2.6], [Math.PI / 2, 0, 0]));
  B.add('rubber', m.rubber, new THREE.TorusGeometry(0.33, 0.035, 6, 24), mat4([-7.2, DECK + 0.1, 2.6], [Math.PI / 2, 0, 0]));
  B.add('cableBlack', m.cableBlack, tube([[-6.3, DECK + 0.02, 0.4], [-6.8, DECK + 0.02, 0.0], [-7.1, DECK + 0.01, -0.18], [-7.25, 0.03, -0.45], [-8.0, 0.02, -1.6], [-8.8, 0.02, -2.2], [-10, 0.02, -2.4]], 0.018, 64, 5), null, { cast: false, receive: true });

  // ----- overhead: lighting grid, catwalk, hanging lights, rain bars
  const gy = 8.6;
  // galvanised pipe grid (48 mm), catching the work lights
  // (over the set only: out front, where the camera and crew stand, the
  // roof's trusses carry what hangs; seen from the catwalks the grid stays
  // below the line of sight)
  for (let x = -12; x <= 12; x += 2) B.rod('gridPipe', m.gridPipe, [x, gy, -15], [x, gy, 6], 0.03, 8, noShadow);
  for (let z = -14; z <= 6; z += 2.5) B.rod('gridPipe', m.gridPipe, [-12, gy - 0.07, z], [12, gy - 0.07, z], 0.03, 8, noShadow);
  // the boom mic's pole is rigged to the grid: a pipe stub off the grid pipe
  // at z 1 with a clamp, the pole's top end clamped under it (boom.js)
  B.rod('gridPipe', m.gridPipe, [BOOM_TOP[0], gy - 0.07, 1.0], [BOOM_TOP[0], gy - 0.07, BOOM_TOP[2] - 0.05], 0.025, 8, noShadow);
  B.add('darkMetal', m.darkMetal, boxUV(0.09, 0.09, 0.1), mat4([BOOM_TOP[0], gy - 0.07, 1.0]), noShadow);
  B.rod('darkMetal', m.darkMetal, [BOOM_TOP[0], gy - 0.07, BOOM_TOP[2]], [BOOM_TOP[0], BOOM_TOP[1] + 0.04, BOOM_TOP[2]], 0.03, 8, noShadow);
  B.add('darkMetal', m.darkMetal, boxUV(0.08, 0.08, 0.08), mat4([BOOM_TOP[0], BOOM_TOP[1] + 0.04, BOOM_TOP[2]]), noShadow);
  // black serge borders hung across the stage under the grid, and side legs:
  // pleated so the work light rakes their folds (ss01, ss05)
  const drape = (w, h, pos, rotY = 0) => {
    const g = new THREE.PlaneGeometry(w, h, Math.round(w * 8), 1);
    const q = g.attributes.position;
    for (let i = 0; i < q.count; i++) q.setZ(i, 0.06 * Math.sin(q.getX(i) * 9.0) + 0.02 * Math.sin(q.getX(i) * 23.0));
    g.computeVertexNormals();
    B.add('drape', m.drape, g, mat4(pos, [0, rotY, 0]), noShadow);
  };
  for (const z of [-1.2, -6.5, -11.5]) {
    drape(24, 1.6, [0, 7.6, z]);
    B.rod('gridPipe', m.gridPipe, [-12, 8.42, z], [12, 8.42, z], 0.025, 6, noShadow);
  }
  // side legs masking the stage left; the right is open to the crew area
  for (const z of [-3, -9]) drape(3, 8.4, [-11.2, 4.2, z], Math.PI / 2);
  // catwalk along the back wall
  B.box('darkMetal', m.darkMetal, [26, 0.06, 1.0], [0, 7.4, -15.6], [0, 0, 0], noShadow);
  for (const zz of [-15.1, -16.1]) B.rod('darkMetal', m.darkMetal, [-13, 8.4, zz], [13, 8.4, zz], 0.025, 5, noShadow);
  for (let x = -12; x <= 12; x += 3) B.add('bulb', m.bulb, new THREE.SphereGeometry(0.05, 8, 6), mat4([x, 7.3, -15.15]), noShadow);
  // hanging fresnels (some lit, pointing at the set)
  const hangers = [[-1.5, 7.2, -4.5, [-0.5, 2, 0], true], [3.5, 7.2, -5.5, [2.5, 0, -2], false], [-6, 7.4, -6, [-6, 0, -6], false], [6.5, 7.4, -7, [6.5, 0, -6], true], [0.5, 7.4, -9.5, [0, 3, -9], false]];
  for (const [x, y, z, tgt, lit] of hangers) {
    B.rod('darkMetal', m.darkMetal, [x, gy, z], [x, y + 0.35, z], 0.02, 5, noShadow);
    fresnel(B, m, [x, y, z], tgt, 0.4, lit);
  }
  for (const { pos, target, lit } of shell.lamps) {
    B.rod('darkMetal', m.darkMetal, [pos[0], gy, pos[2]], [pos[0], pos[1] + 0.35, pos[2]], 0.02, 5, noShadow);
    fresnel(B, m, pos, target, 0.4, lit);
  }
  // space lights, switched off for a night exterior: silk cylinders with
  // black skirts drawn down, hanging dark over the set
  for (const [x, z] of [[-2.5, -3.0], [2.0, -5.0], [-6.0, -9.5]]) {
    B.rod('darkMetal', m.darkMetal, [x, gy, z], [x, 7.45, z], 0.015, 4, noShadow);
    B.add('spaceLight', m.spaceLight, new THREE.CylinderGeometry(0.42, 0.42, 0.5, 20, 1, true), mat4([x, 7.15, z]), noShadow);
    B.add('drape', m.drape, new THREE.CylinderGeometry(0.46, 0.5, 0.75, 20, 1, true), mat4([x, 6.6, z]), noShadow);
    B.cyl('blackPaintNS', m.blackPaint, 0.44, 0.44, 0.05, [x, 7.42, z], [0, 0, 0], 20, noShadow);
  }
  // the moon: an HMI hanging over the end of the side street, aimed at us
  const moonPos = [-3.4, 7.5, -8.6];
  // aimed down the side street at the corner: a narrow backlight whose cone
  // edge crosses the frame (rain and haze glow only inside it)
  const moonTarget = [-3.4, 0.0, 1.0];
  B.rod('darkMetal', m.darkMetal, [moonPos[0], gy, moonPos[2]], [moonPos[0], moonPos[1] + 0.5, moonPos[2]], 0.035, 6, noShadow);
  const MA = aimMatrix(moonPos, moonTarget);
  // the housing surrounds the light itself, so it must not cast shadows
  B.add('blackPaintNS', m.blackPaint, new THREE.CylinderGeometry(0.42, 0.45, 0.8, 20), mul(MA, mat4([0, 0, -0.3], [Math.PI / 2, 0, 0])), noShadow);
  B.add('hmiLens', m.hmiLens, new THREE.CircleGeometry(0.36, 24), mul(MA, mat4([0, 0, 0.11])), noShadow);
  for (const [ax, ay, rx, ry] of [[0, 0.46, -0.7, 0], [0, -0.46, 0.7, 0]]) {
    B.add('blackPaintNS', m.blackPaint, boxUV(0.9, 0.01, 0.6), mul(MA, mul(mat4([ax, ay, 0.12], [rx, ry, 0]), mat4([0, 0, 0.3]))), noShadow);
  }
  B.add('blackPaintNS', m.blackPaint, new THREE.TorusGeometry(0.55, 0.03, 5, 14, Math.PI), mul(MA, mat4([0, 0, -0.3], [0, Math.PI / 2, Math.PI / 2])), noShadow);
  // rain bars: galvanised pipes with nozzles every 40 cm, hung on chains over
  // the street and the side street, fed by a hose; the rain falls only below them
  const bar = (a, b) => {
    B.rod('rainBars', m.rainBars, a, b, 0.04, 8, noShadow);
    const n = Math.floor(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.4);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const p = [a[0] + (b[0] - a[0]) * t, a[1] - 0.04, a[2] + (b[2] - a[2]) * t];
      B.cyl('rainBars', m.rainBars, 0.014, 0.02, 0.07, [p[0], p[1] - 0.03, p[2]], [0, 0, 0], 6, noShadow);
    }
    for (const t of [0.12, 0.5, 0.88]) {
      const p = [a[0] + (b[0] - a[0]) * t, a[1], a[2] + (b[2] - a[2]) * t];
      B.rod('darkMetal', m.darkMetal, [p[0], gy, p[2]], p, 0.01, 4, noShadow);
    }
  };
  for (const z of [0.4, 1.7, 3.0, 4.3]) bar([RIG.x0, RIG.y, z], [RIG.x1, RIG.y, z]);
  for (const x of [-4.4, -2.4]) bar([x, RIG.y, -0.6], [x, RIG.y, -10.4]);
  // manifold and supply hose
  B.rod('rainBars', m.rainBars, [RIG.x1, RIG.y, 0.4], [RIG.x1, RIG.y, 4.3], 0.06, 8, noShadow);
  B.add('rubber', m.rubber, tube([[RIG.x1, RIG.y, 2.4], [RIG.x1 + 0.6, RIG.y + 0.4, 2.2], [RIG.x1 + 1.6, 7.6, 1.0], [RIG.x1 + 2.4, gy, -1.0]], 0.05, 32, 6), null, noShadow);

  // work lights: caged bulbs hanging from the grid on cords, two of them low
  // over the flat backs so the backs sit in warm pools (ss01) while the
  // stage around falls off to dark
  const workBulbs = [[7.0, 3.6, -2.4], [-6.9, 3.4, 0.5], [0.5, 6.9, -13.8], [-9.5, 6.4, -8.5], [4.0, 8.2, -3.5], [-3.0, 8.2, -6.0], [8.6, 3.3, -4.3]];
  for (const [x, y, z] of workBulbs) {
    B.rod('cableBlack', m.cableBlack, [x, gy, z], [x, y + 0.12, z], 0.012, 4, noShadow);
    B.add('bulb', m.bulb, new THREE.SphereGeometry(0.06, 10, 8), mat4([x, y, z]), noShadow);
    B.add('castIron', m.castIron, new THREE.CylinderGeometry(0.1, 0.1, 0.22, 8, 1, true), mat4([x, y, z]), noShadow);
  }

  // ----- below the shot (seen rising): the floor along the street deck's
  // front edge: the A-camera's dolly track on wedges, cable runs with a
  // crossover, sandbags, spike tape; actors' marks on the street itself
  {
    const fz = FRONT_EDGE;
    const tz = [fz + 0.45, fz + 1.05];
    for (const z of tz) B.rod('track', m.track, [-6.5, 0.07, z], [6.5, 0.07, z], 0.022, 8);
    for (let x = -6.2; x <= 6.2; x += 0.6) {
      B.box('blackPaint', m.blackPaint, [0.06, 0.04, 0.78], [x, 0.04, (tz[0] + tz[1]) / 2]);
      if (Math.round(x * 10) % 18 === 0) B.box('wood', m.wood, [0.14, 0.03, 0.3], [x + 0.08, 0.015, tz[0]], [0, 0.4, 0]);
    }
    // cable runs along the deck's front, one crossing the track on a ramp
    B.add('cableBlack', m.cableBlack, tube([[-9, 0.016, fz + 0.18], [-3, 0.016, fz + 0.22], [1, 0.016, fz + 0.17], [7, 0.016, fz + 0.2]], 0.016, 96, 5), null, { cast: false, receive: true });
    B.add('cableOrange', m.cableOrange, tube([[-8, 0.013, fz + 0.28], [-2, 0.013, fz + 0.3], [2.5, 0.013, fz + 0.3], [3.2, 0.013, fz + 0.7], [3.4, 0.013, fz + 1.6]], 0.013, 96, 5), null, { cast: false, receive: true });
    B.box('yellowPaint', m.yellowPaint, [0.9, 0.05, 0.5], [3.3, 0.025, fz + 0.75]);
    for (let k = 0; k < 5; k++) B.box('blackPaint', m.blackPaint, [0.12, 0.052, 0.5], [2.98 + k * 0.16, 0.026, fz + 0.75], [0, 0, 0], noShadow);
    for (const [x, dz, r] of [[-5.2, 0.25, 0.3], [-1.4, 0.3, 1.4], [4.6, 0.27, 2.0], [6.4, 0.3, 0.8]]) sandbag(B, m, [x, 0, fz + dz], r);
    // spike tape on the floor (where stands and the dolly's start go)
    const spike = (x, z, key) => {
      B.add(key, m[key], new THREE.PlaneGeometry(0.22, 0.04), mat4([x, 0.003, z], [-Math.PI / 2, 0, 0]), noShadow);
      B.add(key, m[key], new THREE.PlaneGeometry(0.04, 0.22), mat4([x, 0.003, z], [-Math.PI / 2, 0, 0]), noShadow);
    };
    spike(-4.1, fz + 0.12, 'tape');
    spike(-0.6, fz + 0.14, 'tapeRed');
    spike(2.2, fz + 0.12, 'tape');
    spike(5.6, fz + 0.15, 'tapeRed');
    // actors' marks on the street: small T's in coloured tape
    for (const [x, z] of [[-0.9, 2.55], [0.7, 2.7], [3.1, 2.5]]) {
      B.add('yellowPaint', m.yellowPaint, new THREE.PlaneGeometry(0.18, 0.035), mat4([x, DECK + 0.004, z], [-Math.PI / 2, 0, 0]), noShadow);
      B.add('yellowPaint', m.yellowPaint, new THREE.PlaneGeometry(0.035, 0.12), mat4([x, DECK + 0.004, z + 0.07], [-Math.PI / 2, 0, 0]), noShadow);
    }
  }

  B.build(root);
  return { workBulbs, catBulbs: shell.catBulbs, trussBulbs: shell.trussBulbs, railBulbs: shell.railBulbs, crewBulbs: crew.workBulbs, villageFolk: crew.villageFolk, dropGlow: end.glow, moonPos, moonTarget, softboxPos: sbPos, softboxTarget: [0.4, 1.4, 1.3], kickPos: kick, kickTarget: [-2.6, 2.5, 1.8] };
}

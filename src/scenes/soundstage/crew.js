// The rest of the stage on the right, for the big swings (seen past the car
// and the softbox): video village with its monitors burning, director's and
// cast chairs, an apple-box stack, craft services under a clamp light, flats
// in storage against the wall, a second set standing dark, and the stage
// door with its exit sign and the red rolling light. Real metres, floor y 0.
// Work light only (3-4 stops under the set); the monitors, the exit sign and
// the rolling light are the practicals.

import * as THREE from 'three';
import { boxUV, mat4 } from '../_lib/geo.js';
import { SKIN, seatedAt, seatedFeet } from './people.js';

const mul = (a, b) => new THREE.Matrix4().multiplyMatrices(a, b);

// A plane whose UVs cover one row (or one column range) of an atlas.
function atlasPlane(w, h, { row = 0, rows = 1, u0 = 0, u1 = 1 } = {}) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  const v0 = 1 - (row + 1) / rows;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) / rows);
  return g;
}

export const CHAIR_LABELS = ['DIRECTOR', 'D.P.', 'SCRIPT', 'CAST', 'CAST'];
export const SIGN_LABELS = ['DO NOT ENTER WHEN RED LIGHT IS ON', 'STAGE 7', 'KEEP CLEAR'];

// A tall director's chair at T (local: seat toward -z, back toward +z), the
// label on the back's outside.
function chair(B, m, T, label, tall = true) {
  const sy = tall ? 0.76 : 0.46;
  const P = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(T).toArray();
  const w = 0.28;
  const d = 0.21;
  for (const sx of [-1, 1]) {
    // crossed side frames, a vertical post up to the arm and the back
    B.rod('wood', m.wood, P(sx * w, 0, -d), P(sx * w, sy, d), 0.016, 5);
    B.rod('wood', m.wood, P(sx * w, 0, d), P(sx * w, sy, -d), 0.016, 5);
    B.rod('wood', m.wood, P(sx * w, 0, d), P(sx * w, sy + 0.56, d + 0.02), 0.017, 5);
    B.rod('wood', m.wood, P(sx * w, 0, -d), P(sx * w, sy + 0.22, -d), 0.016, 5);
    B.rod('wood', m.wood, P(sx * w, sy + 0.22, -d - 0.02), P(sx * w, sy + 0.22, d + 0.02), 0.018, 5); // arm
  }
  if (tall) B.rod('wood', m.wood, P(-w, 0.3, -d), P(w, 0.3, -d), 0.014, 5); // footrest
  B.rod('wood', m.wood, P(-w, 0.05, 0), P(w, 0.05, 0), 0.012, 4);
  B.add('canvasSeat', m.canvasSeat, boxUV(2 * w - 0.02, 0.015, 2 * d), mul(T, mat4([0, sy, 0])));
  // back: the label outside, plain canvas inside
  const back = mul(T, mat4([0, sy + 0.42, d + 0.025]));
  B.add('chairCanvas', m.chairCanvas, atlasPlane(2 * w - 0.02, 0.2, { row: label, rows: CHAIR_LABELS.length }), back);
  B.add('canvasSeat', m.canvasSeat, new THREE.PlaneGeometry(2 * w - 0.02, 0.2), mul(back, mat4([0, 0, -0.004], [0, Math.PI, 0])));
}

export function buildCrewArea(B, m, { cStand, sandbag, cable }) {
  const noShadow = { cast: false, receive: false };

  // ---------------- video village: a tall cart with two monitors under a
  // black tent, turned toward the set side; three chairs facing it
  const VV = mat4([9.3, 0, -1.4], [0, -0.58, 0]);
  const P = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(VV).toArray();
  for (const y of [0.32, 0.98]) B.add('blackPaint', m.blackPaint, boxUV(1.2, 0.04, 0.7), mul(VV, mat4([0, y, 0])));
  for (const [x, z] of [[-0.57, -0.32], [0.57, -0.32], [-0.57, 0.32], [0.57, 0.32]]) {
    B.rod('gripSilver', m.gripSilver, P(x, 0.1, z), P(x, 1.0, z), 0.018, 6);
    B.add('rubber', m.rubber, new THREE.CylinderGeometry(0.05, 0.05, 0.04, 10), mul(VV, mat4([x, 0.05, z], [0, 0, Math.PI / 2])));
  }
  // monitor pole and the two screens (A and B camera)
  B.rod('gripSilver', m.gripSilver, P(0, 1.0, -0.2), P(0, 1.42, -0.2), 0.022, 6);
  B.add('blackPaint', m.blackPaint, boxUV(1.24, 0.05, 0.08), mul(VV, mat4([0, 1.44, -0.2])));
  for (const [i, x] of [[0, -0.32], [1, 0.32]]) {
    const S = mul(VV, mat4([x, 1.66, -0.16], [-0.12, -x * 0.25, 0]));
    B.add('cameraBody', m.cameraBody, boxUV(0.62, 0.4, 0.05), S);
    // live: the A camera's picture and the B camera's (feeds.js)
    B.add(i ? 'monitorB' : 'monitorA', i ? m.monitorB : m.monitorA, new THREE.PlaneGeometry(0.57, 0.355), mul(S, mat4([0, 0, 0.027])), noShadow);
  }
  // a small on-camera monitor and the wireless receiver with its antennas
  B.add('cameraBody', m.cameraBody, boxUV(0.2, 0.13, 0.04), mul(VV, mat4([0.42, 1.08, 0.12], [-0.3, 0, 0])));
  B.add('monitorA', m.monitorA, new THREE.PlaneGeometry(0.18, 0.11), mul(VV, mat4([0.42, 1.08, 0.142], [-0.3, 0, 0])), noShadow);
  B.add('blackPaint', m.blackPaint, boxUV(0.22, 0.08, 0.16), mul(VV, mat4([-0.38, 1.04, 0.05])));
  for (const x of [-0.46, -0.3]) B.rod('blackPaint', m.blackPaint, P(x, 1.08, 0.0), P(x - 0.03, 1.3, -0.02), 0.006, 4);
  // the tent: a black solid behind the screens and a floppy over them
  const tent = mul(VV, mat4([0, 1.75, -0.48]));
  B.add('blackCloth', m.blackCloth, new THREE.PlaneGeometry(1.5, 1.2), tent);
  B.add('blackCloth', m.blackCloth, new THREE.PlaneGeometry(1.5, 0.95), mul(VV, mat4([0, 2.35, -0.02], [-Math.PI / 2 + 0.08, 0, 0])));
  for (const [a, b] of [[[-0.75, 1.15, -0.48], [-0.75, 2.36, -0.48]], [[0.75, 1.15, -0.48], [0.75, 2.36, -0.48]], [[-0.75, 2.36, -0.48], [0.75, 2.36, -0.48]],
    [[-0.75, 2.36, -0.48], [-0.75, 2.33, 0.45]], [[0.75, 2.36, -0.48], [0.75, 2.33, 0.45]], [[-0.75, 2.33, 0.45], [0.75, 2.33, 0.45]]]) {
    B.rod('gripSilver', m.gripSilver, P(...a), P(...b), 0.01, 4);
  }
  cStand(B, m, P(-0.95, 0, -0.55), { height: 2.3 });
  cStand(B, m, P(0.95, 0, -0.55), { height: 2.3 });
  // the monitors' light on the cart and the floor in front
  B.add('glowCool', m.glowCool, new THREE.PlaneGeometry(1.6, 1.4), mul(VV, mat4([0, 0.01, 0.75], [-Math.PI / 2, 0, 0])), noShadow);
  // director, DP, script supervisor
  // (facing the monitors: the names on their backs face whoever stands behind)
  for (const [i, x] of [[0, -0.7], [1, 0.0], [2, 0.7]]) chair(B, m, mul(VV, mat4([x, 0, 1.25 + Math.abs(x) * -0.15], [0, x * 0.35, 0])), i);

  // ---------------- apple boxes: full, full, half, quarter, pancake; one loose
  let y = 0;
  [[0.2, 0.0], [0.2, 0.08], [0.1, -0.06], [0.05, 0.1], [0.025, -0.03]].forEach(([h, r], i) => {
    const at = [7.75 + (i % 2) * 0.02, y + h / 2, -3.05];
    B.box('appleBox', m.appleBox, [0.51, h, 0.3], at, [0, r, 0]);
    if (h >= 0.1) for (const s of [-1, 1]) B.box('blackPaint', m.blackPaint, [0.13, Math.min(0.04, h * 0.3), 0.004], [at[0] + Math.sin(r) * s * 0.152, at[1], at[2] + Math.cos(r) * s * 0.152], [0, r, 0], noShadow);
    y += h;
  });
  B.box('appleBox', m.appleBox, [0.51, 0.2, 0.3], [8.15, 0.15, -2.55], [0.0, 0.7, Math.PI / 2]);

  // ---------------- craft services: a folding table under a clamp light
  const CT = mat4([11.5, 0, -2.4], [0, 0.35, 0]);
  const Q = (x, yy, z) => new THREE.Vector3(x, yy, z).applyMatrix4(CT).toArray();
  B.add('cloth', m.cloth, boxUV(1.86, 0.02, 0.8), mul(CT, mat4([0, 0.75, 0])));
  B.add('cloth', m.cloth, new THREE.PlaneGeometry(1.86, 0.32), mul(CT, mat4([0, 0.6, 0.401])));
  for (const sx of [-1, 1]) B.add('cloth', m.cloth, new THREE.PlaneGeometry(0.8, 0.32), mul(CT, mat4([sx * 0.931, 0.6, 0], [0, sx * Math.PI / 2, 0])));
  for (const [x, z] of [[-0.85, -0.33], [0.85, -0.33], [-0.85, 0.33], [0.85, 0.33]]) B.rod('darkMetal', m.darkMetal, Q(x, 0, z), Q(x, 0.74, z), 0.014, 5);
  for (const x of [-0.6, -0.3]) {
    B.add('gripSilver', m.gripSilver, new THREE.CylinderGeometry(0.11, 0.11, 0.42, 16), mul(CT, mat4([x, 0.97, -0.15])));
    B.add('blackPaint', m.blackPaint, new THREE.CylinderGeometry(0.06, 0.11, 0.06, 16), mul(CT, mat4([x, 1.21, -0.15])));
    B.add('blackPaint', m.blackPaint, boxUV(0.03, 0.03, 0.05), mul(CT, mat4([x, 0.84, -0.03])));
  }
  for (const [x, z, n] of [[-0.05, 0.1, 6], [0.05, -0.05, 5], [0.15, 0.12, 4]]) B.add('cloth', m.cloth, new THREE.CylinderGeometry(0.04, 0.032, 0.05 * n, 10), mul(CT, mat4([x, 0.76 + 0.025 * n, z])));
  B.add('cloth', m.cloth, new THREE.SphereGeometry(0.17, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mul(CT, mat4([0.45, 0.93, 0.05])));
  for (const [x, z, yy] of [[0.4, 0.02, 0.86], [0.5, 0.08, 0.86], [0.45, -0.06, 0.87], [0.52, -0.03, 0.92], [0.42, 0.08, 0.92]]) B.add('fruit', m.fruit, new THREE.SphereGeometry(0.045, 10, 8), mul(CT, mat4([x, yy, z])));
  for (const [x, z, w, h] of [[0.75, -0.2, 0.22, 0.26], [0.72, 0.12, 0.3, 0.12], [0.25, -0.25, 0.26, 0.18]]) B.add('fruit', m.fruit, boxUV(w, h, 0.16), mul(CT, mat4([x, 0.76 + h / 2, z], [0, 0.2, 0])));
  // clamp light on a stand over the table, and a cooler under it
  const lampAt = Q(0.1, 2.3, 0.55);
  cStand(B, m, Q(0.1, 0, 0.95), { height: 2.2 });
  B.add('castIron', m.castIron, new THREE.ConeGeometry(0.12, 0.16, 12, 1, true), mat4([lampAt[0], lampAt[1] + 0.03, lampAt[2]]));
  B.add('bulb', m.bulb, new THREE.SphereGeometry(0.04, 10, 8), mat4(lampAt), noShadow);
  B.add('fruit', m.fruit, boxUV(0.6, 0.4, 0.38), mul(CT, mat4([-0.4, 0.2, 0.05])));

  // ---------------- cast chairs (low) by craft services
  chair(B, m, mat4([12.55, 0, -1.2], [0, 2.2, 0]), 3, false);
  chair(B, m, mat4([12.85, 0, -1.95], [0, 2.0, 0]), 4, false);

  // ---------------- flats in storage, leaning on the right wall, faces out
  const faces = ['stucco', 'brick2', 'luan', 'tile', 'stucco', 'luan'];
  faces.forEach((face, i) => {
    const x = 13.38 - i * 0.13; // leaning back on the wall: the top 18 cm nearer it
    const z = -10.6 + (i % 3) * 0.35;
    const T = mat4([x, 1.8, z], [0, 0, -0.1]);
    B.add(face, m[face], boxUV(0.03, 3.6, 2.4), T);
    B.add('pine', m.pine, boxUV(0.06, 3.6, 0.07), mul(T, mat4([0.04, 0, 1.17])));
    B.add('pine', m.pine, boxUV(0.06, 3.6, 0.07), mul(T, mat4([0.04, 0, -1.17])));
  });
  // a scenery wagon with a stair unit, parked
  B.box('blackPaint', m.blackPaint, [2.4, 0.25, 1.2], [12.2, 0.18, -8.3]);
  for (let k = 0; k < 5; k++) B.box('luan', m.luan, [1.0, 0.2 * (k + 1), 0.28], [12.2, 0.3 + 0.1 * (k + 1), -8.75 + k * 0.28]);

  // ---------------- the stage door: steel door, exit sign, rolling light
  // (at the end of the gap behind the diner: the backstage view's far end)
  const DZ = -4.65;
  const DX = 13.7; // proud of the wall's ribs
  B.box('darkMetal', m.darkMetal, [0.08, 2.5, 1.3], [DX, 1.25, DZ]);
  B.box('doorSteel', m.doorSteel, [0.05, 2.3, 1.1], [DX - 0.04, 1.15, DZ]);
  B.rod('gripSilver', m.gripSilver, [DX - 0.1, 1.05, DZ - 0.45], [DX - 0.1, 1.05, DZ + 0.4], 0.018, 6);
  B.add('windowDim', m.windowDim, new THREE.PlaneGeometry(0.25, 0.4), mat4([DX - 0.07, 1.65, DZ + 0.25], [0, -Math.PI / 2, 0]), noShadow);
  B.box('blackPaint', m.blackPaint, [0.1, 0.3, 0.62], [DX - 0.02, 2.78, DZ]);
  B.add('exitSign', m.exitSign, new THREE.PlaneGeometry(0.56, 0.24), mat4([DX - 0.075, 2.78, DZ], [0, -Math.PI / 2, 0]), noShadow);
  B.add('glowRed', m.glowRed, new THREE.PlaneGeometry(1.4, 1.0), mat4([DX - 0.16, 2.8, DZ], [0, -Math.PI / 2, 0]), noShadow);
  // the rolling light: a red beacon in a cage beside the door, on
  const RL = [DX - 0.12, 3.15, DZ - 1.05];
  B.box('blackPaint', m.blackPaint, [0.12, 0.12, 0.2], [DX - 0.05, RL[1] - 0.1, RL[2]]);
  B.add('redLight', m.redLight, new THREE.SphereGeometry(0.1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat4([RL[0], RL[1] - 0.04, RL[2]]), noShadow);
  B.add('glowRed', m.glowRed, new THREE.PlaneGeometry(2.4, 2.4), mat4([DX - 0.18, RL[1], RL[2]], [0, -Math.PI / 2, 0]), noShadow);
  B.add('signs', m.signs, atlasPlane(0.9, 0.18, { row: 0, rows: SIGN_LABELS.length }), mat4([DX - 0.08, 2.3, DZ - 1.05], [0, -Math.PI / 2, 0]), noShadow);
  B.add('signs', m.signs, atlasPlane(2.4, 0.6, { row: 1, rows: SIGN_LABELS.length }), mat4([DX - 0.16, 5.2, DZ - 0.3], [0, -Math.PI / 2, 0]), noShadow);
  B.add('signs', m.signs, atlasPlane(1.2, 0.24, { row: 2, rows: SIGN_LABELS.length }), mat4([DX - 0.16, 0.6, DZ + 1.2], [0, -Math.PI / 2, 0]), noShadow);
  // yellow-and-black floor tape across the door's swing, a fire extinguisher
  B.add('yellowPaint', m.yellowPaint, new THREE.PlaneGeometry(1.5, 0.06), mat4([DX - 1.0, 0.004, DZ], [-Math.PI / 2, 0, Math.PI / 2]), noShadow);
  B.add('hydrant', m.hydrant, new THREE.CylinderGeometry(0.08, 0.08, 0.5, 12), mat4([DX - 0.15, 0.85, DZ + 1.0]));

  // ---------------- the wall beside the door: the stage's power panels under
  // a bulkhead light, conduit up to the catwalk, a caged ladder to it
  for (const [z, h] of [[-6.15, 1.9], [-6.9, 1.9], [-7.6, 1.4]]) {
    B.box('doorSteel', m.doorSteel, [0.3, h, 0.66], [DX - 0.12, 0.3 + h / 2, z]);
    B.box('darkMetal', m.darkMetal, [0.02, 0.05, 0.5], [DX - 0.28, 0.3 + h * 0.55, z]); // handle bar
    B.rod('gripSilver', m.gripSilver, [DX - 0.1, 0.3 + h, z], [DX - 0.1, 10.3, z], 0.03, 6, noShadow);
  }
  B.box('signs', m.signs, [0.01, 0.12, 0.5], [DX - 0.275, 1.95, -6.9], [0, 0, 0], noShadow);
  for (const [z0, z1] of [[-6.2, -3.0], [-6.95, -2.6]]) cable(B, m, [[DX - 0.3, z0], [DX - 0.9, (z0 + z1) / 2], [11.4, z1], [10.2, -3.6], [8.6, -4.0]], 0, 'cableBlack', 0.016);
  const bulkhead = [DX - 0.15, 3.3, -6.9];
  B.add('castIron', m.castIron, new THREE.CylinderGeometry(0.14, 0.14, 0.12, 12, 1, false), mat4(bulkhead, [0, 0, Math.PI / 2]));
  B.add('bulb', m.bulb, new THREE.CircleGeometry(0.1, 16), mat4([bulkhead[0] - 0.065, bulkhead[1], bulkhead[2]], [0, -Math.PI / 2, 0]), noShadow);
  B.add('glowWarm', m.glowWarm, new THREE.PlaneGeometry(3.2, 3.6), mat4([DX - 0.17, 2.4, -6.9], [0, -Math.PI / 2, 0]), noShadow);
  const LZ = -2.55;
  for (const dz of [-0.24, 0.24]) B.rod('doorSteel', m.doorSteel, [DX - 0.18, 0, LZ + dz], [DX - 0.18, 10.4, LZ + dz], 0.025, 5);
  for (let yy = 0.3; yy < 10.4; yy += 0.3) B.rod('doorSteel', m.doorSteel, [DX - 0.18, yy, LZ - 0.24], [DX - 0.18, yy, LZ + 0.24], 0.012, 4, noShadow);
  for (let yy = 2.6; yy < 10.4; yy += 0.9) B.add('doorSteel', m.doorSteel, new THREE.TorusGeometry(0.36, 0.012, 4, 16, Math.PI), mat4([DX - 0.18, yy, LZ], [Math.PI / 2, 0, Math.PI / 2]), noShadow);

  // ---------------- cables: distro to the cart, the cart toward the set
  cable(B, m, [[8.4, -4.0], [8.9, -3.2], [9.2, -2.2], [9.1, -1.6]], 0, 'cableBlack', 0.012);
  cable(B, m, [[9.0, -1.0], [8.2, -0.6], [7.0, -0.2], [6.2, 0.4]], 0, 'cableBlack', 0.01);
  sandbag(B, m, [10.4, 0, -0.6], 0.4);
  sandbag(B, m, [10.6, 0, -1.4], 1.1);

  // work bulbs: over the chairs, the clamp light on the table, over the door
  return {
    // where video village's people sit and stand (index.js builds them)
    villageFolk: villageFolk(VV),
    workBulbs: [[8.6, 3.4, 0.3, 0.006], [lampAt[0], lampAt[1], lampAt[2], 0.01], [bulkhead[0] - 0.3, bulkhead[1], bulkhead[2], 0.01]],
  };
}

// The director and the script supervisor in their chairs, the DP standing by
// the cart, all watching the monitors (VV: the village's frame).
function villageFolk(VV) {
  const turnVV = -0.58;
  const W = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(VV).toArray();
  const sitAt = (x) => W(x, seatedAt(0.76), 1.25 + Math.abs(x) * -0.15);
  return [
    { at: sitAt(-0.7), turn: turnVV + Math.PI - 0.7 * 0.35, lean: 0.18, headTilt: -0.05, skin: SKIN[0], hair: 'grey', hairStyle: 'short', headset: true,
      top: 0x3a3632, bottom: 0x22242a, shoes: 0x1a1612, coat: { color: 0x4a4038 },
      hands: [[-0.14, 0.2, 0.33], [0.16, 0.24, 0.36]], elbows: [[-1, -0.6, -0.2], [1, -0.6, -0.2]], feet: seatedFeet(0.76, { footRest: 0.3, forward: 0.3 }) },
    { at: sitAt(0.7), turn: turnVV + Math.PI + 0.7 * 0.35, lean: 0.25, headTilt: 0.2, skin: SKIN[5], hair: 'brown', hairStyle: 'long', female: true, build: 0.94,
      top: 0x6a4a5a, bottom: 0x24262c, shoes: 0x141414,
      hands: [[-0.12, 0.13, 0.3], [0.1, 0.15, 0.32]], elbows: [[-1, -0.5, 0], [1, -0.5, 0]], feet: seatedFeet(0.76, { footRest: 0.3, forward: 0.28, spread: 0.08 }),
      props: [{ geo: new THREE.BoxGeometry(0.26, 0.04, 0.32), at: [0, 0.08, 0.3], rot: [0.5, 0, 0], color: 0x1a2a4a }] },
    { at: W(1.2, 0.95, 0.5), turn: turnVV + Math.PI + 0.3, lean: 0.04, headTilt: 0.05, skin: SKIN[1], hair: 'black', hat: 'cap', hatColor: 0x2a2a2a,
      top: 0x2a2e30, bottom: 0x3a3428, shoes: 0x2a2018,
      hands: [[0.05, 0.25, 0.2], [-0.04, 0.27, 0.22]], elbows: [[-1, -0.2, 0.4], [1, -0.2, 0.4]] },
  ];
}

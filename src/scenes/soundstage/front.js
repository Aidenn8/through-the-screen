// The camera end of the stage, behind the glass: the A-camera on its dolly at
// the shot's own eye (16 m back from the facade, lens at 2 m), its crew, the
// lights and carts out front, and the stage's front wall with the elephant
// door. Seen from inside the diner (out of the windows), from behind the
// camera, from the catwalk. Real metres, stage floor y 0.
//
// The A-camera stands where the viewer's eye is for "The shot": index.js
// hides it while the window is at that station (the viewer is the camera).

import * as THREE from 'three';
import { Builder, boxUV, mat4 } from '../_lib/geo.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { aimMatrix } from './backstage.js';
import { crowd, SKIN } from './people.js';

const mul = (a, b) => new THREE.Matrix4().multiplyMatrices(a, b);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// The shot's eye in set metres (window 0, 0, 0.6): the A-camera's lens.
export const ACAM = { lens: [0, 2.0, 16.0], aim: [0, 2.0, 0.0], track: [12.6, 20.4] };

/** Where the A-camera's monitor screen is: a local frame on the camera. */
export function buildACam(m) {
  const B = new Builder();
  const no = { cast: false, receive: false };
  const C = aimMatrix(ACAM.lens, ACAM.aim); // +z toward the set
  // aimMatrix's local +x is world -x here (the camera looks down -z): parts
  // are written with x = world x (the operator's side, -x, is camera left)
  const at = (x, y, z, rot = [0, 0, 0]) => mul(C, mat4([-x, y, z], [rot[0], -rot[1], -rot[2]]));
  const P = (x, y, z) => V(x, y, z).applyMatrix4(C).toArray();
  // ---- the camera
  // lens: barrel, gear rings, the front element
  B.add('camBlack', m.camBlack, new THREE.CylinderGeometry(0.058, 0.052, 0.27, 24), at(0, 0, -0.035, [Math.PI / 2, 0, 0]));
  for (const z of [-0.12, -0.06, 0.02]) B.add('camRubber', m.camRubber, new THREE.CylinderGeometry(0.064, 0.064, 0.022, 32), at(0, 0, z, [Math.PI / 2, 0, 0]));
  B.add('camBlack', m.camBlack, new THREE.CylinderGeometry(0.066, 0.062, 0.03, 28), at(0, 0, 0.1, [Math.PI / 2, 0, 0]));
  B.add('camGlass', m.camGlass, new THREE.CircleGeometry(0.05, 24), at(0, 0, 0.112), no);
  B.add('camMetal', m.camMetal, new THREE.TorusGeometry(0.052, 0.004, 6, 24), at(0, 0, 0.114));
  // mount ring and body: a machined housing (rounded edges catch the work
  // light), a raised top deck, the lens mount's collar
  const rbox = (w, h, d, r = 0.012) => new RoundedBoxGeometry(w, h, d, 2, r);
  B.add('camMetal', m.camMetal, new THREE.CylinderGeometry(0.07, 0.07, 0.025, 24), at(0, 0, -0.18, [Math.PI / 2, 0, 0]));
  B.add('camBody', m.camBody, rbox(0.17, 0.215, 0.34, 0.016), at(0, 0.025, -0.36));
  B.add('camBody', m.camBody, rbox(0.15, 0.04, 0.3, 0.01), at(0, 0.15, -0.36));
  B.add('camBlack', m.camBlack, rbox(0.15, 0.17, 0.035, 0.01), at(0, 0.02, -0.2));
  // the film gate's door on the operator side: a panel, its latch and hinge
  B.add('camBlack', m.camBlack, rbox(0.008, 0.15, 0.2, 0.003), at(-0.087, 0.02, -0.38));
  B.add('camMetal', m.camMetal, new THREE.CylinderGeometry(0.007, 0.007, 0.13, 8), at(-0.092, 0.02, -0.28));
  B.add('camMetal', m.camMetal, rbox(0.012, 0.03, 0.012, 0.004), at(-0.094, 0.03, -0.47));
  // the side panel with the buttons and a small status screen (the far side)
  B.add('camBlack', m.camBlack, boxUV(0.004, 0.09, 0.14), at(0.087, 0.03, -0.33));
  B.add('camScreen', m.camScreen, new THREE.PlaneGeometry(0.1, 0.05), at(0.0895, 0.05, -0.33, [0, Math.PI / 2, 0]), no);
  for (let k = 0; k < 4; k++) B.add('camMetal', m.camMetal, new THREE.CylinderGeometry(0.006, 0.006, 0.006, 8), at(0.09, -0.01, -0.39 + k * 0.025, [0, 0, Math.PI / 2]));
  // white camera tape on the body and the magazine: the AC's labels
  B.add('camWhite', m.camWhite, boxUV(0.002, 0.024, 0.09), at(0.088, -0.05, -0.27));
  B.add('camWhite', m.camWhite, boxUV(0.002, 0.024, 0.06), at(-0.092, -0.06, -0.3));
  // the film magazine on top: two round lobes (feed and take-up) and the
  // throat into the body, the way a 35 mm camera's silhouette reads
  {
    const R = 0.118, w = 0.1, y = 0.17 + 0.02 + R;
    for (const z of [-0.29, -0.53]) {
      B.add('camBody', m.camBody, new THREE.CylinderGeometry(R, R, w, 40), at(0, y, z, [0, 0, Math.PI / 2]));
      for (const sx of [-1, 1]) {
        // a rim and a hub on each face
        B.add('camBlack', m.camBlack, new THREE.TorusGeometry(R - 0.004, 0.005, 6, 40), at(sx * w / 2, y, z, [0, Math.PI / 2, 0]));
        B.add('camMetal', m.camMetal, new THREE.CylinderGeometry(0.022, 0.022, 0.006, 16), at(sx * (w / 2 + 0.003), y, z, [0, 0, Math.PI / 2]));
      }
    }
    B.add('camBody', m.camBody, rbox(w, 0.17, 0.24, 0.008), at(0, y - 0.03, -0.41));
    B.add('camBlack', m.camBlack, rbox(0.07, 0.04, 0.16, 0.006), at(0, 0.185, -0.41));
    // a tape label across the lobe, and the handle on the magazine's crown
    B.add('camWhite', m.camWhite, boxUV(0.002, 0.03, 0.1), at(w / 2 + 0.002, y + 0.03, -0.53));
    for (const z of [-0.34, -0.48]) B.add('camBlack', m.camBlack, new THREE.CylinderGeometry(0.01, 0.01, 0.05, 8), at(0, y + R + 0.01, z));
    B.add('camRubber', m.camRubber, new THREE.CylinderGeometry(0.014, 0.014, 0.2, 10), at(0, y + R + 0.035, -0.41, [Math.PI / 2, 0, 0]));
  }
  // tally lights (rolling): one over the lens for the cast, one at the back
  B.add('camTally', m.camTally, new THREE.SphereGeometry(0.008, 10, 8), at(0.05, 0.175, -0.215), no);
  B.add('camTally', m.camTally, new THREE.SphereGeometry(0.008, 10, 8), at(0.06, 0.12, -0.536), no);
  // the back: a small display and two connectors over the battery; the
  // battery on its plate, a cable loop
  B.add('camScreen', m.camScreen, new THREE.PlaneGeometry(0.06, 0.022), at(-0.03, 0.112, -0.5315, [0, Math.PI, 0]), no);
  for (const x of [0.03, 0.055]) B.add('camMetal', m.camMetal, new THREE.CylinderGeometry(0.007, 0.007, 0.018, 10), at(x, 0.112, -0.537, [Math.PI / 2, 0, 0]));
  B.add('camBlack', m.camBlack, rbox(0.15, 0.13, 0.014, 0.004), at(0, 0.0, -0.537));
  B.add('camBattery', m.camBattery, rbox(0.12, 0.14, 0.062, 0.012), at(0, 0.0, -0.576));
  B.add('camWhite', m.camWhite, boxUV(0.07, 0.02, 0.002), at(0, 0.035, -0.6075));
  B.add('camTally', m.camTally, new THREE.PlaneGeometry(0.03, 0.004), at(0, -0.04, -0.6078, [0, Math.PI, 0]), no);
  // the viewfinder: an arm out to the operator's side, a knuckle, the
  // eyepiece tube with its focus ring back to a rubber eyecup, a leveller
  B.add('camBlack', m.camBlack, boxUV(0.08, 0.03, 0.03), at(-0.12, 0.13, -0.3));
  B.add('camMetal', m.camMetal, new THREE.CylinderGeometry(0.026, 0.026, 0.05, 16), at(-0.165, 0.13, -0.3, [0, 0, Math.PI / 2]));
  B.add('camBlack', m.camBlack, new THREE.CylinderGeometry(0.032, 0.03, 0.2, 16), at(-0.165, 0.13, -0.4, [Math.PI / 2, 0, 0]));
  B.add('camRubber', m.camRubber, new THREE.CylinderGeometry(0.035, 0.035, 0.03, 20), at(-0.165, 0.13, -0.47, [Math.PI / 2, 0, 0]));
  B.add('camRubber', m.camRubber, new THREE.CylinderGeometry(0.045, 0.034, 0.06, 18, 1, true), at(-0.165, 0.13, -0.53, [Math.PI / 2, 0, 0]));
  B.add('camRubber', m.camRubber, new THREE.TorusGeometry(0.043, 0.006, 6, 18), at(-0.165, 0.13, -0.56));
  B.add('camMetal', m.camMetal, new THREE.CylinderGeometry(0.005, 0.005, 0.2, 6), at(-0.13, 0.1, -0.44, [Math.PI / 2, 0, 0]));
  // 15 mm rods under the lens, the follow focus on the operator's side
  for (const x of [-0.03, 0.03]) B.add('camMetal', m.camMetal, new THREE.CylinderGeometry(0.0075, 0.0075, 0.48, 10), at(x, -0.085, -0.12, [Math.PI / 2, 0, 0]));
  B.add('camBlack', m.camBlack, boxUV(0.07, 0.07, 0.05), at(-0.07, -0.05, -0.06));
  B.add('camMetal', m.camMetal, new THREE.CylinderGeometry(0.036, 0.036, 0.018, 24), at(-0.112, -0.05, -0.06, [0, 0, Math.PI / 2]));
  B.add('camWhite', m.camWhite, new THREE.TorusGeometry(0.034, 0.004, 4, 24), at(-0.122, -0.05, -0.06, [0, Math.PI / 2, 0]));
  B.add('camBlack', m.camBlack, new THREE.CylinderGeometry(0.01, 0.01, 0.05, 8), at(-0.135, -0.05, -0.06, [0, 0, Math.PI / 2]));
  // a wireless focus motor on the other side, with its cable
  B.add('camRed', m.camRed, boxUV(0.05, 0.06, 0.045), at(0.075, -0.05, -0.02));
  B.add('camBlack', m.camBlack, new THREE.TorusGeometry(0.05, 0.004, 4, 10, Math.PI), at(0.075, -0.04, -0.12, [0, Math.PI / 2, 0]));
  // the matte box: bellows from the lens to a frame, flags on top and sides
  {
    const w = 0.34, h = 0.26, z0 = 0.13, z1 = 0.31;
    const bel = new THREE.CylinderGeometry(Math.SQRT1_2 * 1.0, Math.SQRT1_2 * 0.36, z1 - z0, 4, 1, true, Math.PI / 4);
    bel.scale(w / 2, 1, h / 2);
    B.add('camBlack', m.camBlack, bel, at(0, 0, (z0 + z1) / 2, [Math.PI / 2, 0, 0]));
    for (const [x, y, sw, sh] of [[0, h / 2, w + 0.02, 0.02], [0, -h / 2, w + 0.02, 0.02], [-w / 2, 0, 0.02, h], [w / 2, 0, 0.02, h]]) B.add('camBlack', m.camBlack, boxUV(sw, sh, 0.05), at(x, y, z1));
    // filter trays
    for (const z of [z1 - 0.06, z1 - 0.1]) B.add('camMetal', m.camMetal, boxUV(w + 0.03, 0.012, 0.018), at(0, h / 2 + 0.012, z));
    // French flag on top, eyebrows at the sides
    B.add('camBlack', m.camBlack, boxUV(w, 0.004, 0.2), at(0, h / 2 + 0.05, z1 + 0.06, [-0.35, 0, 0]));
    for (const s of [-1, 1]) B.add('camBlack', m.camBlack, boxUV(0.004, h - 0.02, 0.13), at(s * (w / 2 + 0.02), 0, z1 + 0.05, [0, s * 0.45, 0]));
    // its support arm down to the rods
    B.add('camMetal', m.camMetal, boxUV(0.03, 0.07, 0.04), at(0, -h / 2 + 0.01, z1 - 0.07));
  }
  // the camera's own monitor: on an arm off the top handle, turned back
  // toward the dolly grip and whoever stands behind (its picture is the shot)
  // (facing back and to the right: toward whoever stands behind the camera)
  const monM = at(0.2, 0.25, -0.5, [0.15, Math.PI - 0.45, 0]);
  B.add('camBlack', m.camBlack, new THREE.CylinderGeometry(0.008, 0.008, 0.2, 8), at(0.1, 0.24, -0.47, [0, 0, Math.PI / 2 - 0.2]));
  B.add('camBlack', m.camBlack, boxUV(0.2, 0.14, 0.025), mul(monM, mat4([0, 0, -0.014])));
  B.add('camBlack', m.camBlack, boxUV(0.2, 0.012, 0.06), mul(monM, mat4([0, 0.075, 0.02], [-0.5, 0, 0])));
  // ---- the head: a geared head with its wheels
  B.add('camMetal', m.camMetal, boxUV(0.16, 0.025, 0.36), at(0, -0.12, -0.24));
  B.add('camBlack', m.camBlack, boxUV(0.2, 0.14, 0.24), at(0, -0.21, -0.28));
  B.add('camBlack', m.camBlack, new THREE.CylinderGeometry(0.14, 0.14, 0.09, 24), at(0, -0.33, -0.28));
  for (const [x, y, z, rot] of [[-0.14, -0.2, -0.28, [0, 0, Math.PI / 2]], [0, -0.22, -0.46, [Math.PI / 2, 0, 0]]]) {
    B.add('camMetal', m.camMetal, new THREE.TorusGeometry(0.07, 0.009, 6, 24), at(x, y, z, rot[0] ? [0, 0, 0] : [0, Math.PI / 2, 0]));
    B.add('camBlack', m.camBlack, new THREE.CylinderGeometry(0.012, 0.012, 0.06, 8), at(x, y, z, rot));
    B.add('camBlack', m.camBlack, new THREE.CylinderGeometry(0.008, 0.008, 0.05, 6), at(x + (rot[0] ? 0.05 : -0.03), y + 0.05, z + (rot[0] ? -0.03 : 0), rot));
  }
  const lensY = ACAM.lens[1];
  // ---- the dolly: chassis on track wheels, a column on the arm, the seat, the push bar
  const [lx, , lz] = ACAM.lens;
  const dz = lz + 0.25; // the dolly sits back under the camera
  const deckY = 0.42;
  B.box('dollySilver', m.dollySilver, [0.66, 0.2, 1.15], [lx, deckY - 0.1, dz]);
  B.box('dollyDeck', m.dollyDeck, [0.68, 0.02, 1.17], [lx, deckY + 0.01, dz]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    B.box('dollySilver', m.dollySilver, [0.12, 0.1, 0.16], [lx + sx * 0.28, 0.2, dz + sz * 0.46]);
    for (const k of [-1, 1]) B.add('camRubber', m.camRubber, new THREE.CylinderGeometry(0.055, 0.055, 0.04, 16), mat4([lx + sx * 0.3, 0.11, dz + sz * 0.46 + k * 0.045], [0, 0, Math.PI / 2]));
  }
  // the arm (a hydraulic boom, raised) and a riser up to the head
  B.box('dollySilver', m.dollySilver, [0.16, 0.12, 0.7], [lx, deckY + 0.36, dz - 0.1], [0.75, 0, 0]);
  B.add('dollySilver', m.dollySilver, new THREE.CylinderGeometry(0.06, 0.07, lensY - 0.38 - (deckY + 0.6), 16), mat4([lx, (lensY - 0.38 + deckY + 0.6) / 2, lz + 0.28]));
  B.add('camBlack', m.camBlack, new THREE.CylinderGeometry(0.1, 0.1, 0.04, 20), mat4([lx, lensY - 0.4, lz + 0.28]));
  // the seat on its post, back left; the push bar across the back
  B.add('dollySilver', m.dollySilver, new THREE.CylinderGeometry(0.025, 0.025, 0.55, 10), mat4([lx - 0.25, deckY + 0.3, dz + 0.42], [0.25, 0, 0]));
  B.add('dollySeat', m.dollySeat, new THREE.CylinderGeometry(0.15, 0.13, 0.07, 18), mat4([lx - 0.25, deckY + 0.6, dz + 0.5]));
  const pb = [[lx - 0.36, deckY, dz + 0.58], [lx - 0.36, deckY + 0.6, dz + 0.72], [lx + 0.36, deckY + 0.6, dz + 0.72], [lx + 0.36, deckY, dz + 0.58]];
  for (let k = 0; k < 3; k++) B.rod('dollyBlack', m.dollyBlack, pb[k], pb[k + 1], 0.017, 10);
  B.rod('camRubber', m.camRubber, [lx - 0.2, deckY + 0.6, dz + 0.72], [lx + 0.2, deckY + 0.6, dz + 0.72], 0.022, 10);
  // a cable from the camera down off the dolly
  B.add('cableBlack', m.cableBlack, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(lx + 0.05, lensY - 0.02, lz - 0.57 + 0.0).applyMatrix4(new THREE.Matrix4()), V(lx + 0.15, lensY - 0.4, dz + 0.3), V(lx + 0.33, deckY + 0.05, dz + 0.4), V(lx + 0.45, 0.02, dz + 0.9), V(lx + 1.4, 0.015, dz + 2.2)].map((p) => p)), 48, 0.008, 5), null, no);
  const group = new THREE.Group();
  const meshes = B.build(group);
  return { group, meshes, screen: monM, screenSize: [0.18, 0.115] };
}

/** Everything else out front (one merged build into the root). */
export function buildFront(B, m, { cStand, sandbag, cable, rollerStand }) {
  const no = { cast: false, receive: false };
  const [lx, , lz] = ACAM.lens;
  // ---- the A-camera's track: two rails along z on sleepers and wedges
  for (const dx of [-0.3, 0.3]) B.rod('track', m.track, [lx + dx, 0.07, ACAM.track[0]], [lx + dx, 0.07, ACAM.track[1]], 0.022, 10);
  for (let z = ACAM.track[0] + 0.2; z < ACAM.track[1]; z += 0.6) {
    B.box('blackPaint', m.blackPaint, [0.78, 0.04, 0.06], [lx, 0.04, z]);
    if (Math.round(z * 10) % 3 === 0) B.box('wood', m.wood, [0.3, 0.025, 0.12], [lx + 0.32, 0.012, z + 0.06], [0, 0.3, 0]);
  }
  for (const z of [ACAM.track[0] + 0.1, ACAM.track[1] - 0.1]) B.box('yellowPaint', m.yellowPaint, [0.7, 0.05, 0.08], [lx, 0.09, z]);
  // spike marks for the dolly's start and end
  for (const z of [14.2, 16.25]) B.add('tapeRed', m.tapeRed, new THREE.PlaneGeometry(0.3, 0.04), mat4([lx - 0.55, 0.003, z], [-Math.PI / 2, 0, 0]), no);

  // ---- lights: a big HMI on a high roller stand into a 12x12 bounce (soft
  // fill from the camera side), a tube light on a stand burning low, two
  // fresnels off, flags
  const hmi = [7.6, 4.2, 13.4];
  rollerStand(B, m, [hmi[0], 0, hmi[2]], hmi[1] - 0.35);
  const HA = aimMatrix(hmi, [5.4, 3.0, 9.2]);
  B.add('blackPaint', m.blackPaint, new THREE.CylinderGeometry(0.45, 0.48, 0.9, 24), mul(HA, mat4([0, 0, -0.25], [Math.PI / 2, 0, 0])));
  B.add('hmiLens', m.hmiLens, new THREE.CircleGeometry(0.4, 28), mul(HA, mat4([0, 0, 0.21])), no);
  for (const [ax, ay, rx, ry] of [[0, 0.5, -0.8, 0], [0, -0.5, 0.8, 0], [0.5, 0, 0, 0.8], [-0.5, 0, 0, -0.8]]) {
    B.add('blackPaint', m.blackPaint, boxUV(ax ? 0.01 : 0.95, ay ? 0.01 : 0.95, 0.5), mul(HA, mul(mat4([ax, ay, 0.22], [rx, ry, 0]), mat4([0, 0, 0.25]))));
  }
  B.add('blackPaint', m.blackPaint, new THREE.TorusGeometry(0.58, 0.03, 5, 14, Math.PI), mul(HA, mat4([0, 0, -0.25], [0, Math.PI / 2, Math.PI / 2])));
  B.box('blackPaint', m.blackPaint, [0.5, 0.35, 0.6], [hmi[0] - 0.7, 0.18, hmi[2] + 0.4]); // its ballast
  // its spill: daylight off the back of the lamp's barn doors and the
  // bounce's edges, a cool pool on the floor between the stands
  B.add('glowCool', m.glowCool, new THREE.PlaneGeometry(7, 7), mat4([6.4, 0.014, 11.4], [-Math.PI / 2, 0, 0]), no);
  // apple boxes and a spare head cable coiled by the ballast
  B.box('appleBox', m.appleBox, [0.5, 0.2, 0.3], [hmi[0] - 1.5, 0.1, hmi[2] + 0.9], [0, 0.4, 0]);
  B.box('appleBox', m.appleBox, [0.5, 0.2, 0.3], [hmi[0] - 1.45, 0.3, hmi[2] + 0.88], [0, 0.1, 0]);
  B.add('cableBlack', m.cableBlack, new THREE.TorusGeometry(0.28, 0.025, 6, 20), mat4([hmi[0] + 0.2, 0.03, hmi[2] + 1.2], [Math.PI / 2, 0, 0]));
  B.add('cableBlack', m.cableBlack, new THREE.TorusGeometry(0.24, 0.025, 6, 20), mat4([hmi[0] + 0.22, 0.08, hmi[2] + 1.18], [Math.PI / 2, 0, 0]));
  // the 12 x 12: a frame of pipe with a bleached muslin, on two high stands,
  // turned to bounce the HMI onto the set
  {
    const F = aimMatrix([5.4, 3.0, 9.2], [1.5, 1.6, 2.0]);
    const s = 3.6;
    B.add('bounce', m.bounce, new THREE.PlaneGeometry(s, s), F, no);
    B.add('bounceBack', m.bounceBack, new THREE.PlaneGeometry(s, s), mul(F, mat4([0, 0, -0.01], [0, Math.PI, 0])), no);
    for (const [a, b] of [[[-s / 2, -s / 2], [s / 2, -s / 2]], [[-s / 2, s / 2], [s / 2, s / 2]], [[-s / 2, -s / 2], [-s / 2, s / 2]], [[s / 2, -s / 2], [s / 2, s / 2]]]) {
      B.rod('gripSilver', m.gripSilver, V(a[0], a[1], 0).applyMatrix4(F).toArray(), V(b[0], b[1], 0).applyMatrix4(F).toArray(), 0.025, 8);
    }
    for (const sx of [-1, 1]) {
      const top = V(sx * s / 2, 0, 0).applyMatrix4(F);
      cStand(B, m, [top.x, 0, top.z], { height: top.y });
    }
  }
  // a tube light (four lamps) on a stand near the camera, burning low: the
  // eye light for the actors at the door
  {
    const K = aimMatrix([2.4, 1.9, 13.2], [2.8, 1.4, 0]);
    cStand(B, m, [2.4, 0, 13.4], { height: 1.75 });
    B.add('blackPaint', m.blackPaint, boxUV(0.62, 0.36, 0.1), mul(K, mat4([0, 0, -0.05])));
    for (let k = 0; k < 4; k++) B.add('tubeLamp', m.tubeLamp, new THREE.CylinderGeometry(0.016, 0.016, 0.56, 10), mul(K, mat4([0, -0.12 + k * 0.08, 0.012], [0, 0, Math.PI / 2])), no);
    for (const s of [-1, 1]) B.add('blackPaint', m.blackPaint, boxUV(0.01, 0.36, 0.16), mul(K, mat4([s * 0.31, 0, 0.08], [0, s * 0.5, 0])));
  }
  // two fresnels on stands, off, flagged
  for (const [x, z, tx] of [[-2.6, 18.6, -1.5], [3.4, 19.8, 2.0]]) {
    rollerStand(B, m, [x, 0, z], 2.2);
    const A = aimMatrix([x, 2.4, z], [tx, 1.6, 2]);
    B.add('blackPaint', m.blackPaint, new THREE.CylinderGeometry(0.17, 0.18, 0.45, 18), mul(A, mat4([0, 0, -0.08], [Math.PI / 2, 0, 0])));
    B.add('blackPaint', m.blackPaint, new THREE.CircleGeometry(0.15, 18), mul(A, mat4([0, 0, 0.15])), no);
  }
  // a flag off the tube light's top, out of the lens's way
  cStand(B, m, [3.3, 0, 13.6], { height: 2.3, armTo: [2.9, 2.5, 13.0], flag: [0.6, 0.9], flagRot: 0.9 });
  // ---- carts: the camera cart with its cases, a grip cart of stands, road cases
  const cart = (x, z, ry, color) => {
    const T = mat4([x, 0, z], [0, ry, 0]);
    for (const y of [0.25, 0.85]) B.add('dollySilver', m.dollySilver, boxUV(0.6, 0.03, 1.2), mul(T, mat4([0, y, 0])));
    for (const [px, pz] of [[-0.28, -0.58], [0.28, -0.58], [-0.28, 0.58], [0.28, 0.58]]) B.add('dollySilver', m.dollySilver, new THREE.CylinderGeometry(0.014, 0.014, 0.85, 8), mul(T, mat4([px, 0.47, pz])));
    for (const [px, pz] of [[-0.25, -0.5], [0.25, -0.5], [-0.25, 0.5], [0.25, 0.5]]) B.add('camRubber', m.camRubber, new THREE.CylinderGeometry(0.07, 0.07, 0.04, 14), mul(T, mat4([px, 0.07, pz], [0, 0, Math.PI / 2])));
    B.add('dollySilver', m.dollySilver, new THREE.TorusGeometry(0.25, 0.014, 6, 12, Math.PI), mul(T, mat4([0, 1.0, 0.6], [0, 0, 0])));
    // cases
    B.add(color, m[color], boxUV(0.55, 0.32, 0.5), mul(T, mat4([0, 1.03, -0.3])));
    B.add('camBlack', m.camBlack, boxUV(0.5, 0.22, 0.4), mul(T, mat4([0.02, 0.98, 0.25])));
    B.add(color, m[color], boxUV(0.5, 0.35, 0.55), mul(T, mat4([0, 0.44, 0.2])));
    B.add('camBlack', m.camBlack, boxUV(0.45, 0.3, 0.45), mul(T, mat4([0, 0.42, -0.35])));
  };
  cart(2.2, 18.4, 0.3, 'caseOrange');
  cart(-4.2, 20.5, -0.2, 'camBlack');
  // a grip cart of C-stands, risers up
  for (let k = 0; k < 6; k++) {
    const x = -7.5 + k * 0.22, z = 23.0 + (k % 2) * 0.1;
    B.rod('gripSilver', m.gripSilver, [x, 0.25, z], [x, 2.1, z], 0.014, 6);
    B.rod('gripSilver', m.gripSilver, [x, 0.25, z], [x + 0.3, 0.02, z + 0.25], 0.011, 5);
  }
  B.box('blackPaint', m.blackPaint, [1.6, 0.1, 0.8], [-6.95, 0.2, 23.1]);
  // road cases along the front wall
  for (const [x, z, w, h, d, c] of [[5.8, 30.6, 1.2, 0.9, 0.8, 'camBlack'], [7.1, 30.7, 1.0, 1.2, 0.8, 'caseOrange'], [5.9, 30.5, 1.1, 0.7, 0.75, 'camBlack'], [9.8, 30.6, 1.4, 1.0, 0.9, 'camBlack']]) {
    B.box(c, m[c], [w, h, d], [x, h / 2 + 0.06 + (x === 5.9 ? 0.9 : 0), z]);
  }
  sandbag(B, m, [-0.9, 0, 15.2], 0.3);
  sandbag(B, m, [0.95, 0, 17.6], 1.2);
  // cables out to the camera cart and the lights
  cable(B, m, [[1.4, 18.4], [1.9, 18.0], [2.2, 17.8]], 0, 'cableBlack', 0.012);
  cable(B, m, [[hmi[0] - 0.7, hmi[2] + 0.6], [8.0, 15.5], [10.5, 18.0], [12.8, 20.0]], 0, 'cableBlack', 0.022);
  cable(B, m, [[2.4, 13.4], [3.5, 15.5], [6.0, 18.0], [10.5, 19.0], [12.9, 18.0]], 0, 'cableOrange', 0.014);
  // ---- along the stage-left wall at the camera end: lamp carts and stacked
  // cases parked under caged work bulbs (seen from the catwalks)
  const parked = [];
  for (const z of [12.5, 19.5]) {
    const x = -12.55;
    B.box('dollySilver', m.dollySilver, [1.0, 0.05, 1.9], [x, 0.32, z]);
    B.box('dollySilver', m.dollySilver, [1.0, 0.05, 1.9], [x, 1.1, z]);
    for (const [dx, dz] of [[-0.45, -0.9], [0.45, -0.9], [-0.45, 0.9], [0.45, 0.9]]) {
      B.rod('dollySilver', m.dollySilver, [x + dx, 0.1, z + dz], [x + dx, 1.12, z + dz], 0.02, 6);
      B.add('camRubber', m.camRubber, new THREE.CylinderGeometry(0.08, 0.08, 0.05, 12), mat4([x + dx, 0.08, z + dz], [0, 0, Math.PI / 2]));
    }
    for (let k = 0; k < 3; k++) {
      B.add('blackPaint', m.blackPaint, new THREE.CylinderGeometry(0.17, 0.18, 0.42, 16), mat4([x, 0.62, z - 0.6 + k * 0.6], [Math.PI / 2, 0, 0]));
      B.add('blackPaint', m.blackPaint, new THREE.CylinderGeometry(0.14, 0.15, 0.36, 14), mat4([x - 0.1, 1.36, z - 0.6 + k * 0.6], [Math.PI / 2, 0, 0]));
    }
    B.box('caseOrange', m.caseOrange, [0.9, 0.5, 0.7], [x + 1.0, 0.25, z + 0.4], [0, 0.2, 0]);
    B.box('camBlack', m.camBlack, [0.8, 0.45, 0.6], [x + 1.02, 0.73, z + 0.38], [0, 0.1, 0]);
    B.box('camBlack', m.camBlack, [1.1, 0.6, 0.6], [x + 1.1, 0.3, z - 0.7], [0, -0.1, 0]);
    sandbag(B, m, [x + 0.9, 0, z - 1.3], 0.4);
    const wb = [x + 0.6, 3.7, z];
    B.rod('cableBlack', m.cableBlack, [wb[0], 12.9, wb[2]], [wb[0], wb[1] + 0.12, wb[2]], 0.01, 4, no);
    B.add('castIron', m.castIron, new THREE.CylinderGeometry(0.09, 0.09, 0.2, 8, 1, true), mat4(wb), no);
    B.add('bulb', m.bulb, new THREE.SphereGeometry(0.05, 10, 8), mat4(wb), no);
    B.add('glowWarmFloor', m.glowWarmFloor, new THREE.PlaneGeometry(4.5, 4.5), mat4([wb[0], 0.012, wb[2]], [-Math.PI / 2, 0, 0]), no);
    parked.push([wb[0], wb[1], wb[2], 0.022]);
  }
  // ---- the front wall: the elephant door (steel, ribbed), a man door with
  // its exit sign, the stage's name
  const FZ = 31.84;
  B.box('doorSteel', m.doorSteel, [6.0, 7.0, 0.1], [-6, 3.5, FZ]);
  for (let y = 0.5; y < 7; y += 0.5) B.box('darkMetal', m.darkMetal, [6.0, 0.04, 0.06], [-6, y, FZ - 0.06]);
  B.box('blackPaint', m.blackPaint, [6.4, 0.3, 0.3], [-6, 7.15, FZ - 0.1]);
  B.box('yellowPaint', m.yellowPaint, [6.0, 0.01, 0.12], [-6, 0.005, FZ - 0.5]);
  B.box('doorSteel', m.doorSteel, [1.1, 2.2, 0.08], [2.2, 1.1, FZ]);
  B.rod('gripSilver', m.gripSilver, [1.75, 1.05, FZ - 0.08], [2.6, 1.05, FZ - 0.08], 0.018, 6);
  B.box('blackPaint', m.blackPaint, [0.6, 0.28, 0.1], [2.2, 2.55, FZ - 0.02]);
  B.add('exitSign', m.exitSign, new THREE.PlaneGeometry(0.54, 0.22), mat4([2.2, 2.55, FZ - 0.075], [0, Math.PI, 0]), no);
  B.add('glowRed', m.glowRed, new THREE.PlaneGeometry(1.3, 1.0), mat4([2.2, 2.6, FZ - 0.09], [0, Math.PI, 0]), no);
  // a bulkhead light over the man door
  B.add('castIron', m.castIron, new THREE.CylinderGeometry(0.14, 0.14, 0.12, 12), mat4([2.2, 3.1, FZ - 0.08], [Math.PI / 2, 0, 0]));
  B.add('bulb', m.bulb, new THREE.CircleGeometry(0.1, 16), mat4([2.2, 3.1, FZ - 0.145], [0, Math.PI, 0]), no);
  B.add('glowWarm', m.glowWarm, new THREE.PlaneGeometry(3.0, 3.0), mat4([2.2, 2.4, FZ - 0.1], [0, Math.PI, 0]), no);
  return {
    // work light out front: over the camera, by the carts, over the man door
    workBulbs: [[1.2, 3.4, 17.6, 0.03], [-3.0, 3.2, 20.0, 0.016], [2.2, 3.0, FZ - 0.4, 0.012], [-6.0, 4.5, 26.0, 0.01], [-1.5, 3.2, 13.0, 0.012], ...parked],
    // the HMI's spill (daylight) on the floor, stands and the bounce's back
    spill: [[6.6, 3.0, 11.6, 0.03]],
    // the A-camera itself (lens, body, matte box, monitor), for the eye-inside test
    acamBox: { min: [ACAM.lens[0] - 0.32, ACAM.lens[1] - 0.45, ACAM.lens[2] - 0.45], max: [ACAM.lens[0] + 0.35, ACAM.lens[1] + 0.35, ACAM.lens[2] + 0.7] },
    bounce: { center: [5.4, 3.0, 9.2] },
  };
}

/** The A-camera's crew: operator on the dolly, dolly grip, 1st AC. */
export function crewFolk() {
  const [lx, , lz] = ACAM.lens;
  const deck = 0.43;
  return [
    // operator standing on the dolly, eye to the eyepiece, hands on the wheels
    { at: [lx - 0.17, deck + 0.95, lz + 0.62], turn: Math.PI, lean: 0.12, headTilt: 0.05, skin: SKIN[2], hair: 'brown', hat: 'cap', hatColor: 0x161616,
      top: 0x1a1a1c, bottom: 0x2a2c30, shoes: 0x1a1a1a,
      hands: [[-0.02, 0.58, 0.6], [0.17, 0.54, 0.58]], elbows: [[-1, -0.6, 0], [1, -0.7, 0]], feet: [[-0.12, -0.95, 0.02], [0.14, -0.95, -0.05]] },
    // dolly grip at the push bar, behind
    { at: [lx + 0.05, 0.95, lz + 1.35], turn: Math.PI, lean: 0.14, skin: SKIN[3], hair: 'black', hat: 'beanie', hatColor: 0x242a30,
      top: 0x2c3036, bottom: 0x3a3a30, shoes: 0x2a2018, coat: null,
      hands: [[-0.15, 0.1, 0.4], [0.17, 0.1, 0.41]], elbows: [[-1, -0.3, -0.5], [1, -0.3, -0.5]], feet: [[-0.14, -0.95, 0.05], [0.16, -0.95, -0.2]] },
    // the gaffer by the HMI's ballast, watching the bounce
    { at: [6.55, 0.95, 14.5], turn: Math.PI - 0.35, lean: 0.03, headTilt: -0.12, skin: SKIN[0], hair: 'grey', hairStyle: 'short',
      top: 0x4a3a2a, bottom: 0x2a2a2c, shoes: 0x1a1612, coat: { color: 0x3a3a34 },
      hands: [[-0.16, -0.05, 0.12], null], elbows: [[-1, -0.5, -0.2], [1, -0.2, -1]] },
    // 1st AC beside the lens, the focus hand unit in his hands
    { at: [lx - 0.95, 0.95, lz - 0.2], turn: Math.PI - 0.5, lean: 0.06, headTurn: 0.3, skin: SKIN[4], hair: 'dark', hairStyle: 'short',
      top: 0x3a3e46, bottom: 0x1c1e22, shoes: 0x141414, headset: false,
      hands: [[-0.08, 0.18, 0.3], [0.08, 0.19, 0.3]], elbows: [[-1, -0.5, -0.3], [1, -0.5, -0.3]],
      props: [{ geo: new THREE.BoxGeometry(0.14, 0.05, 0.1), at: [0, 0.2, 0.33], color: 0x1a1a1a }] },
  ];
}

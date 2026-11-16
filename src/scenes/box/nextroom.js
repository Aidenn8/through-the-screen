// The room next door, for the big swings to the left: in the right wall a
// fusuma stands slid open onto a dim tatami room lit only by its own paper
// lantern: a chest of drawers, a hanging scroll, a cushion, painted fusuma
// on its far wall. The low sun never reaches it, so it is the cool, dim
// counterweight to the sunlit room and the garden on the other side.
// Window-space metres; the room is W x H x D behind the glass.

import * as THREE from 'three';
import { boxUV, mat4 } from '../_lib/geo.js';
import { paint, fbm, toTexture } from '../_lib/textures.js';
import { maskSpots } from '../_lib/lightmask.js';
import { addWorkLights } from '../_lib/worklight.js';

// The opening in the right wall: floor to the lintel, near the glass.
export const SIDE = { z0: -0.15, z1: -0.012, y1: 0.08, depth: 0.3 };

function tatamiTexture() {
  // rush weave running one way, a little green-gold, with a dark cloth border
  const t = toTexture(paint(256, 512, (u, v) => {
    const weave = 0.86 + 0.14 * Math.sin(v * Math.PI * 2 * 90) * (0.6 + 0.4 * fbm(u, v, 4, 2, 7, 0.5));
    const n = fbm(u, v, 6, 3, 9, 0.5);
    const border = u < 0.06 || u > 0.94;
    if (border) return [28, 24, 22];
    const k = weave * (0.85 + 0.25 * n);
    return [178 * k, 160 * k, 104 * k];
  }));
  return t;
}

function fusumaTexture() {
  // a painted sliding panel: pale gold ground, a far range of hills and a
  // pine bough in ink, the paper's cloud texture
  return toTexture(paint(256, 384, (u, v) => {
    const n = fbm(u, v, 3, 4, 31, 0.55);
    let c = [196 + 20 * n, 172 + 18 * n, 120 + 12 * n];
    const hill = 0.62 + 0.06 * Math.sin(u * 7 + 1) + 0.03 * Math.sin(u * 17);
    if (v > hill) c = c.map((x) => x * 0.78);
    const bough = Math.abs(v - (0.25 + 0.12 * Math.sin(u * 4.5))) < 0.012 + 0.01 * Math.sin(u * 30) ** 2 && u > 0.15;
    if (bough) c = [52, 44, 36];
    for (let k = 0; k < 6; k++) {
      const cx = 0.25 + k * 0.13;
      const cy = 0.25 + 0.12 * Math.sin(cx * 4.5) - 0.04;
      if ((u - cx) ** 2 * 4 + (v - cy) ** 2 * 9 < 0.0012) c = [40, 52, 38];
    }
    return c;
  }));
}

function scrollTexture() {
  // a hanging scroll: silk mount, the painting of a crescent moon over reeds
  return toTexture(paint(96, 320, (u, v) => {
    const mount = u < 0.12 || u > 0.88 || v < 0.16 || v > 0.86;
    if (mount) return [92, 70, 52];
    const n = fbm(u, v, 5, 3, 41, 0.5);
    let c = [214 + 12 * n, 204 + 12 * n, 176 + 10 * n];
    if ((u - 0.62) ** 2 + (v - 0.3) ** 2 < 0.012 && (u - 0.66) ** 2 + (v - 0.29) ** 2 > 0.01) c = [120, 104, 80];
    for (const x of [0.3, 0.38, 0.45, 0.55]) if (Math.abs(u - x - (v - 0.85) * 0.2) < 0.008 && v > 0.55) c = [60, 56, 46];
    return c;
  }));
}

export function createNextRoomMaterials() {
  const lam = (o) => maskSpots(new THREE.MeshLambertMaterial(o), 0);
  return {
    // dim: the room is lit by its lantern and what spills from next door
    nTatami: lam({ map: tatamiTexture(), color: 0x8a8a8a }),
    nWall: lam({ color: 0x5a5044 }),
    nWood: lam({ color: 0x2c1e16 }),
    nFusuma: lam({ map: fusumaTexture(), color: 0x8a8a8a }),
    nScroll: lam({ map: scrollTexture(), color: 0x9a9a9a }),
    nCushion: lam({ color: 0x5a2a24 }),
    nIron: lam({ color: 0x141414 }),
  };
}

/** Light the next room by its lantern (a work-light term on its own materials). */
export function lightNextRoom(mats, lantern) {
  addWorkLights([mats.nTatami, mats.nWall, mats.nWood, mats.nFusuma, mats.nScroll, mats.nCushion, mats.nIron], [
    { position: lantern.clone().add(new THREE.Vector3(0, 0.03, 0)), color: new THREE.Color(1.0, 0.66, 0.36).multiplyScalar(0.0045) },
  ]);
}

export function buildNextRoom(B, mats, { W, H, D }) {
  const noShadow = { cast: false, receive: false };
  const x0 = W / 2 + 0.02; // the right wall's outer face
  const x1 = x0 + SIDE.depth;
  const xc = (x0 + x1) / 2;
  const zf = 0.03;
  const zb = -D - 0.02;
  const zc = (zf + zb) / 2;
  const FL = -H / 2;
  // tatami floor: mats 2:1 laid in a pattern, the far wall's painted fusuma,
  // plaster on the other walls, a dark board ceiling
  B.box('nWood', mats.nWood, [SIDE.depth + 0.02, 0.004, zf - zb + 0.02], [xc, FL - 0.002, zc], [0, 0, 0], noShadow);
  for (const cx of [xc - 0.075, xc + 0.075]) for (const cz of [zf - 0.095, zf - 0.285, zf - 0.475]) {
    B.add('nTatami', mats.nTatami, new THREE.PlaneGeometry(0.149, 0.189), mat4([cx, FL + 0.0005, cz], [-Math.PI / 2, 0, 0]), noShadow);
  }
  B.add('nWall', mats.nWall, boxUV(0.01, H, zf - zb), mat4([x1 + 0.005, 0, zc]), noShadow);
  for (let k = 0; k < 4; k++) {
    const zz = zf - (zf - zb) * (k + 0.5) / 4;
    B.add('nFusuma', mats.nFusuma, new THREE.PlaneGeometry((zf - zb) / 4 - 0.004, SIDE.y1 - FL), mat4([x1 - 0.0005, (SIDE.y1 + FL) / 2, zz], [0, -Math.PI / 2, 0]), noShadow);
  }
  B.box('nWood', mats.nWood, [0.006, 0.008, zf - zb], [x1 - 0.003, SIDE.y1 + 0.004, zc], [0, 0, 0], noShadow);
  B.box('nWall', mats.nWall, [SIDE.depth, H, 0.01], [xc, 0, zb - 0.005], [0, 0, 0], noShadow);
  B.box('nWall', mats.nWall, [SIDE.depth, H, 0.01], [xc, 0, zf + 0.005], [0, 0, 0], noShadow);
  B.box('nWood', mats.nWood, [SIDE.depth + 0.02, 0.01, zf - zb + 0.02], [xc, H / 2 + 0.005, zc], [0, 0, 0], noShadow);
  for (let x = x0 + 0.04; x < x1; x += 0.05) B.box('nWood', mats.nWood, [0.003, 0.004, zf - zb], [x, H / 2 - 0.002, zc], [0, 0, 0], noShadow);
  // a chest of drawers against the far wall, iron pulls
  const tz = -0.42;
  B.box('nWood', mats.nWood, [0.05, 0.075, 0.09], [x1 - 0.026, FL + 0.0375, tz]);
  for (let k = 0; k < 3; k++) {
    B.box('nIron', mats.nIron, [0.002, 0.004, 0.022], [x1 - 0.052, FL + 0.015 + k * 0.023, tz - 0.022], [0, 0, 0], noShadow);
    B.box('nIron', mats.nIron, [0.002, 0.004, 0.022], [x1 - 0.052, FL + 0.015 + k * 0.023, tz + 0.022], [0, 0, 0], noShadow);
  }
  // the scroll on the back wall, a cushion on the mats
  B.add('nScroll', mats.nScroll, new THREE.PlaneGeometry(0.045, 0.15), mat4([xc + 0.03, 0.0, zb + 0.0012]), noShadow);
  B.add('nWood', mats.nWood, new THREE.CylinderGeometry(0.0025, 0.0025, 0.055, 8), mat4([xc + 0.03, -0.077, zb + 0.004], [0, 0, Math.PI / 2]), noShadow);
  B.add('nCushion', mats.nCushion, boxUV(0.045, 0.006, 0.05), mat4([xc - 0.06, FL + 0.003, -0.17], [0, 0.3, 0]));
  // its paper lantern, burning (the room's only light)
  const L = new THREE.Vector3(xc - 0.025, FL, -0.27);
  const aw = 0.026;
  const ah = 0.042;
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    B.add('lanternPaper', mats.lanternPaper, new THREE.PlaneGeometry(aw, ah), mat4([L.x + Math.sin(a) * aw / 2, L.y + 0.012 + ah / 2, L.z + Math.cos(a) * aw / 2], [0, a, 0]), noShadow);
  }
  for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.box('nWood', mats.nWood, [0.0025, 0.058, 0.0025], [L.x + (ox * aw) / 2, L.y + 0.029, L.z + (oz * aw) / 2], [0, 0, 0], noShadow);
  return { lantern: new THREE.Vector3(L.x, L.y + 0.035, L.z) };
}

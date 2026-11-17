// The room next door: in the right wall a fusuma stands slid open onto a dim
// tatami room lit only by its own paper lantern and the warm spill from the
// sunlit room: a tokonoma at the back with a hanging scroll (a crescent moon
// over reeds) and a small incense burner, a chest of drawers with iron pulls,
// a brazier with a kettle over a few live coals, a cushion, painted fusuma
// (closet doors) on the far wall, posts and a lintel beam in dark timber.
// The low sun never reaches it: it is the cool, dim counterweight to the
// sunlit room and the garden on the other side, and a station of its own.
// Window-space metres; the room is W x H x D behind the glass.

import * as THREE from 'three';
import { boxUV, mat4 } from '../_lib/geo.js';
import { paint, fbm, toTexture } from '../_lib/textures.js';
import { maskSpots } from '../_lib/lightmask.js';
import { addWorkLights } from '../_lib/worklight.js';

// The opening in the right wall: floor to the lintel, near the glass.
export const SIDE = { z0: -0.15, z1: -0.012, y1: 0.08, depth: 0.3 };

function tatamiTexture() {
  // rush weave running along the mat, a little green-gold, cloth borders on the long sides
  return toTexture(paint(128, 256, (u, v) => {
    const weave = 0.86 + 0.14 * Math.sin(v * Math.PI * 2 * 70) * (0.6 + 0.4 * fbm(u, v, 4, 2, 7, 0.5));
    const n = fbm(u, v, 6, 3, 9, 0.5);
    if (u < 0.07 || u > 0.93) return [26, 22, 20];
    const k = weave * (0.85 + 0.25 * n);
    return [176 * k, 160 * k, 104 * k];
  }));
}

function fusumaTexture() {
  // painted closet doors: pale gold ground, a far range of hills and a pine
  // bough in ink, the paper's cloud texture
  return toTexture(paint(256, 384, (u, v) => {
    const n = fbm(u, v, 3, 4, 31, 0.55);
    let c = [200 + 20 * n, 176 + 18 * n, 120 + 12 * n];
    const hill = 0.62 + 0.06 * Math.sin(u * 7 + 1) + 0.03 * Math.sin(u * 17);
    if (v > hill) c = c.map((x) => x * 0.8);
    const bough = Math.abs(v - (0.25 + 0.12 * Math.sin(u * 4.5))) < 0.01 + 0.008 * Math.sin(u * 30) ** 2 && u > 0.15;
    if (bough) c = [52, 44, 36];
    for (let k = 0; k < 7; k++) {
      const cx = 0.22 + k * 0.11;
      const cy = 0.25 + 0.12 * Math.sin(cx * 4.5) - 0.04;
      if ((u - cx) ** 2 * 3 + (v - cy) ** 2 * 8 < 0.0016) c = [38, 52, 36];
    }
    // the round pull (hikite)
    if (Math.abs(((u * 2) % 1) - 0.85) < 0.03 && Math.abs(v - 0.55) < 0.02) c = [30, 26, 22];
    return c;
  }));
}

function scrollTexture() {
  // a hanging scroll: brocade mount, the painting of a crescent moon over reeds
  return toTexture(paint(96, 320, (u, v) => {
    const mount = u < 0.1 || u > 0.9 || v < 0.15 || v > 0.86;
    if (mount) {
      const b = fbm(u, v, 12, 2, 43, 0.5);
      return [70 + 30 * b, 52 + 20 * b, 36 + 12 * b];
    }
    const n = fbm(u, v, 5, 3, 41, 0.5);
    let c = [218 + 12 * n, 208 + 12 * n, 178 + 10 * n];
    const dm = (u - 0.62) ** 2 + (v - 0.3) ** 2;
    if (dm < 0.012 && (u - 0.66) ** 2 + (v - 0.285) ** 2 > 0.0095) c = [150, 120, 70];
    for (const x of [0.28, 0.35, 0.43, 0.52, 0.6]) {
      const lean = (v - 0.85) * (0.15 + x * 0.2);
      if (Math.abs(u - x - lean) < 0.006 + 0.004 * (v - 0.55) && v > 0.52) c = [58, 54, 44];
      if (Math.abs(u - x - lean - (v - 0.62) * 0.8) < 0.012 && v > 0.58 && v < 0.66) c = [70, 66, 52];
    }
    return c;
  }));
}

function claytexture() {
  return toTexture(paint(128, 128, (u, v) => {
    const n = fbm(u, v, 8, 4, 47, 0.55);
    const s = fbm(u, v, 30, 2, 48, 0.5);
    const k = 0.85 + 0.2 * n + 0.06 * s;
    return [150 * k, 128 * k, 98 * k];
  }), { repeat: [12, 12] });
}

export function createNextRoomMaterials() {
  const lam = (o) => maskSpots(new THREE.MeshLambertMaterial(o), 0);
  return {
    // dim: the room is lit by its lantern and what spills from next door
    nTatami: lam({ map: tatamiTexture(), color: 0x8a8a8a }),
    nWall: lam({ map: claytexture(), color: 0x9a9088 }),
    nWood: lam({ color: 0x2c1e16 }),
    nWoodLight: lam({ color: 0x6a4a30 }),
    nFusuma: lam({ map: fusumaTexture(), color: 0x8a8a8a }),
    nScroll: lam({ map: scrollTexture(), color: 0xa0a0a0 }),
    nCushion: lam({ color: 0x6a2a24 }),
    nIron: lam({ color: 0x141414 }),
    nCoal: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.22, 0.04).multiplyScalar(0.9) }),
  };
}

/** Light the room next door: its lantern, and warm light spilling in from the sunlit room. */
export function lightNextRoom(mats, lantern, opening, coals) {
  addWorkLights([mats.nTatami, mats.nWall, mats.nWood, mats.nWoodLight, mats.nFusuma, mats.nScroll, mats.nCushion, mats.nIron], [
    // the lantern: a pool on the mats about two stops over the room
    { position: lantern.clone().add(new THREE.Vector3(0, 0.01, 0)), color: new THREE.Color(1.0, 0.64, 0.34).multiplyScalar(0.0095) },
    { position: opening.clone(), color: new THREE.Color(1.0, 0.6, 0.32).multiplyScalar(0.0026) },
    // a soft fill: the lantern's light off the pale ceiling and the mats
    { position: new THREE.Vector3(lantern.x + 0.06, 0.06, lantern.z + 0.04), color: new THREE.Color(1.0, 0.72, 0.46).multiplyScalar(0.0028) },
    { position: coals.clone(), color: new THREE.Color(1.0, 0.36, 0.12).multiplyScalar(0.00035) },
  ]);
}

export function buildNextRoom(B, mats, { W, H, D }) {
  const ns = { cast: false, receive: false };
  const x0 = W / 2 + 0.02; // the right wall's outer face
  const x1 = x0 + SIDE.depth;
  const xc = (x0 + x1) / 2;
  const zf = -0.0105;
  const zb = -D - 0.02;
  const zc = (zf + zb) / 2;
  const FL = -H / 2;
  const CEIL = H / 2;
  // floor: tatami 2:1 in rows, a board strip in front of the tokonoma
  B.box('nWood', mats.nWood, [SIDE.depth + 0.02, 0.004, zf - zb + 0.02], [xc, FL - 0.002, zc], [0, 0, 0], ns);
  const tokoD = 0.06;
  const matW = (SIDE.depth - 0.002) / 2;
  const matL = 0.075;
  for (let k = 0; k * matL < zf - zb - tokoD - matL * 0.5; k++) {
    const cz = zf - matL / 2 - k * matL - 0.001;
    for (const s of [-1, 1]) B.add('nTatami', mats.nTatami, new THREE.PlaneGeometry(matL - 0.001, matW - 0.001), mat4([xc + (s * matW) / 2, FL + 0.0005, cz], [-Math.PI / 2, 0, Math.PI / 2]), ns);
  }
  // walls: clay plaster; the far (east) wall closet doors painted
  B.add('nWall', mats.nWall, boxUV(0.01, H, zf - zb, 0.3), mat4([x1 + 0.005, 0, zc]), ns);
  for (let k = 0; k < 4; k++) {
    const zz = zf - (zf - zb - tokoD) * (k + 0.5) / 4;
    B.add('nFusuma', mats.nFusuma, new THREE.PlaneGeometry((zf - zb - tokoD) / 4 - 0.003, SIDE.y1 - FL), mat4([x1 - 0.0008, (SIDE.y1 + FL) / 2, zz], [0, -Math.PI / 2, 0]), ns);
    B.box('nWood', mats.nWood, [0.003, SIDE.y1 - FL, 0.003], [x1 - 0.0015, (SIDE.y1 + FL) / 2, zf - (zf - zb - tokoD) * k / 4], [0, 0, 0], ns);
  }
  B.box('nWall', mats.nWall, [SIDE.depth, H, 0.01], [xc, 0, zb - 0.005], [0, 0, 0], ns);
  B.box('nWall', mats.nWall, [SIDE.depth, H, 0.01], [xc, 0, zf + 0.005], [0, 0, 0], ns);
  // ceiling boards on battens, a lintel beam (nageshi) round the room, corner posts
  B.box('nWood', mats.nWood, [SIDE.depth + 0.02, 0.01, zf - zb + 0.02], [xc, CEIL + 0.005, zc], [0, 0, 0], ns);
  for (let x = x0 + 0.04; x < x1; x += 0.05) B.box('nWood', mats.nWood, [0.003, 0.004, zf - zb], [x, CEIL - 0.002, zc], [0, 0, 0], ns);
  const yl = SIDE.y1 + 0.004;
  B.box('nWood', mats.nWood, [0.006, 0.008, zf - zb], [x1 - 0.003, yl, zc], [0, 0, 0], ns);
  B.box('nWood', mats.nWood, [SIDE.depth, 0.008, 0.006], [xc, yl, zb + 0.003], [0, 0, 0], ns);
  B.box('nWood', mats.nWood, [SIDE.depth, 0.008, 0.006], [xc, yl, zf - 0.003], [0, 0, 0], ns);
  for (const [x, z] of [[x0 + 0.004, zf - 0.004], [x1 - 0.004, zf - 0.004], [x1 - 0.004, zb + 0.004], [x0 + 0.004, zb + 0.004]]) {
    B.box('nWood', mats.nWood, [0.008, H, 0.008], [x, 0, z], [0, 0, 0], ns);
  }
  // the tokonoma: a raised alcove across the back, a lacquered edge, a
  // natural post at its side, the scroll and an incense burner on its floor
  const tx0 = x0 + 0.1;
  B.box('nWoodLight', mats.nWoodLight, [x1 - tx0, 0.008, tokoD], [(tx0 + x1) / 2, FL + 0.004, zb + tokoD / 2], [0, 0, 0], ns);
  B.box('nIron', mats.nIron, [x1 - tx0, 0.009, 0.004], [(tx0 + x1) / 2, FL + 0.0045, zb + tokoD], [0, 0, 0], ns);
  B.add('nWoodLight', mats.nWoodLight, new THREE.CylinderGeometry(0.0045, 0.005, H, 9), mat4([tx0, 0, zb + tokoD - 0.004]), ns);
  B.box('nWood', mats.nWood, [x1 - tx0, 0.006, tokoD], [(tx0 + x1) / 2, SIDE.y1 + 0.016, zb + tokoD / 2], [0, 0, 0], ns);
  const sx = (tx0 + x1) / 2;
  B.add('nScroll', mats.nScroll, new THREE.PlaneGeometry(0.042, 0.135), mat4([sx, -0.002, zb + 0.0012]), ns);
  B.add('nWood', mats.nWood, new THREE.CylinderGeometry(0.0022, 0.0022, 0.05, 8), mat4([sx, -0.07, zb + 0.0035], [0, 0, Math.PI / 2]), ns);
  B.add('nWood', mats.nWood, new THREE.CylinderGeometry(0.0012, 0.0012, 0.046, 6), mat4([sx, 0.0655, zb + 0.0025], [0, 0, Math.PI / 2]), ns);
  B.add('nIron', mats.nIron, new THREE.CylinderGeometry(0.0004, 0.0004, 0.03, 4), mat4([sx, 0.08, zb + 0.002]), ns);
  const lathe = (pts, seg = 20) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  B.add('nIron', mats.nIron, lathe([[0, 0], [0.006, 0], [0.0085, 0.004], [0.008, 0.008], [0.0065, 0.009], [0, 0.009]]), mat4([sx + 0.03, FL + 0.008, zb + 0.03]), ns);
  // the chest of drawers against the far wall: dark carcass, lighter drawer
  // fronts, iron pulls
  const tz = -0.39;
  B.box('nWood', mats.nWood, [0.05, 0.078, 0.095], [x1 - 0.026, FL + 0.039, tz]);
  for (let k = 0; k < 3; k++) {
    const y = FL + 0.013 + k * 0.024;
    for (const s of [-1, 1]) {
      B.box('nWoodLight', mats.nWoodLight, [0.002, 0.02, 0.043], [x1 - 0.0515, y, tz + s * 0.0235], [0, 0, 0], ns);
      B.box('nIron', mats.nIron, [0.002, 0.004, 0.014], [x1 - 0.0535, y, tz + s * 0.0235], [0, 0, 0], ns);
    }
  }
  B.box('nIron', mats.nIron, [0.052, 0.002, 0.097], [x1 - 0.026, FL + 0.078, tz], [0, 0, 0], ns);
  // a brazier with a kettle over a few live coals
  const hx = xc + 0.03;
  const hz = -0.12;
  B.add('nWoodLight', mats.nWoodLight, lathe([[0, 0], [0.016, 0], [0.018, 0.004], [0.018, 0.02], [0.0155, 0.021], [0, 0.021]], 20), mat4([hx, FL, hz]), ns);
  B.add('nIron', mats.nIron, new THREE.CircleGeometry(0.0145, 20), mat4([hx, FL + 0.0195, hz], [-Math.PI / 2, 0, 0]), ns);
  for (const [dx, dz] of [[0.003, 0.002], [-0.003, 0.0035], [0.0005, -0.003]]) B.add('nCoal', mats.nCoal, new THREE.SphereGeometry(0.0016, 8, 5), mat4([hx + dx, FL + 0.0195, hz + dz], [0, 0, 0], [1, 0.6, 1]), ns);
  B.add('nIron', mats.nIron, lathe([[0, 0.001], [0.0065, 0.0015], [0.0078, 0.006], [0.0058, 0.0108], [0.0028, 0.0118], [0, 0.0118]], 28), mat4([hx, FL + 0.028, hz]), ns);
  B.add('nIron', mats.nIron, new THREE.TorusGeometry(0.0048, 0.0005, 5, 16, Math.PI), mat4([hx, FL + 0.0405, hz]), ns);
  B.add('nIron', mats.nIron, new THREE.CylinderGeometry(0.0006, 0.0006, 0.009, 5), mat4([hx, FL + 0.0236, hz + 0.004]), ns);
  B.add('nIron', mats.nIron, new THREE.CylinderGeometry(0.0006, 0.0006, 0.009, 5), mat4([hx, FL + 0.0236, hz - 0.004]), ns);
  // a cushion on the mats
  B.add('nCushion', mats.nCushion, boxUV(0.042, 0.006, 0.046), mat4([xc - 0.06, FL + 0.003, -0.2], [0, 0.3, 0]));
  // its paper lantern, burning (the room's light)
  const L = new THREE.Vector3(x0 + 0.087, FL, -0.33);
  const aw = 0.026;
  const ah = 0.042;
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    B.add('lanternPaper', mats.lanternPaper, new THREE.PlaneGeometry(aw, ah), mat4([L.x + Math.sin(a) * aw / 2, L.y + 0.012 + ah / 2, L.z + Math.cos(a) * aw / 2], [0, a, 0]), ns);
  }
  for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.box('nWood', mats.nWood, [0.0025, 0.058, 0.0025], [L.x + (ox * aw) / 2, L.y + 0.029, L.z + (oz * aw) / 2], [0, 0, 0], ns);
  for (const y of [0.012, 0.012 + ah]) for (const s of [-1, 1]) {
    B.box('nWood', mats.nWood, [aw + 0.003, 0.002, 0.002], [L.x, L.y + y, L.z + (s * aw) / 2], [0, 0, 0], ns);
    B.box('nWood', mats.nWood, [0.002, 0.002, aw + 0.003], [L.x + (s * aw) / 2, L.y + y, L.z], [0, 0, 0], ns);
  }
  return { lantern: new THREE.Vector3(L.x, L.y + 0.035, L.z), opening: new THREE.Vector3(x0 + 0.01, -0.02, (SIDE.z0 + SIDE.z1) / 2), coals: new THREE.Vector3(hx, FL + 0.026, hz) };
}

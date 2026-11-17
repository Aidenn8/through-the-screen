// The Box's house seen from outside: the room and the room next door under
// one gabled roof of grey tiles, its gable to the south flush with the
// room's open front (the window), so nothing of the house ever stands in
// front of the glass. Plaster and dark timber walls over cedar boards, the
// lattice window's paper sunlit from outside, a dark crawl space on stone
// footings, the engawa along the west under the eave, its rafters, and a
// glass wind chime (fūrin) hanging from the eave beam.
//
// Window-space metres; the room is W x H x D behind the glass.

import * as THREE from 'three';
import { boxUV, mat4 } from '../_lib/geo.js';
import { paint, fbm, toTexture, rng } from '../_lib/textures.js';

export const ENGAWA = { width: 0.075, z0: 0.0, z1: -0.56 };
export const ROOF = { overhang: 0.045, pitch: 0.55, north: 0.06 };

function tex(N, M, fn, metres, repeatV = metres) {
  const t = toTexture(paint(N, M, fn));
  t.repeat.set(1 / metres, 1 / repeatV);
  return t;
}

export function createHouseMaterials(outdoor) {
  const plaster = tex(128, 128, (u, v) => {
    const n = fbm(u, v, 6, 4, 101, 0.5);
    const s = fbm(u, v, 24, 2, 102, 0.5);
    const k = 0.86 + 0.14 * n + 0.04 * s;
    return [192 * k, 178 * k, 152 * k];
  }, 0.12);
  const timber = tex(256, 64, (u, v) => {
    const g = fbm(u, v, 24, 3, 111, 0.5, 4);
    const k = 0.75 + 0.4 * g;
    return [58 * k, 40 * k, 28 * k];
  }, 0.25, 0.06);
  const boards = tex(128, 256, (u, v) => {
    // vertical cedar boards with battens, weathered dark
    const b = (u * 8) % 1;
    const seam = b < 0.06 ? 0.45 : 1;
    const g = fbm(u, v, 8, 3, 121, 0.5, 30);
    const k = (0.7 + 0.45 * g) * seam;
    return [52 * k, 40 * k, 32 * k];
  }, 0.12);
  const tiles = tex(256, 256, (u, v) => {
    // ibushi tiles: rolls running down the slope (across v), courses along u
    const roll = Math.sin(v * Math.PI * 2 * 14);
    const course = (u * 9) % 1;
    const lip = course > 0.88 ? 0.55 : 1;
    const n = fbm(u, v, 8, 3, 131, 0.5);
    const k = (0.62 + 0.3 * roll + 0.12 * n) * lip;
    return [92 * k, 94 * k, 100 * k];
  }, 0.2);
  const paperOut = tex(64, 64, (u, v) => {
    // the paper from outside: sunlit, the lattice a faint shadow behind it
    const fz = (u * 6) % 1;
    const fy = (v * 4) % 1;
    const bar = Math.min(Math.abs(fz - 0.5), Math.abs(fy - 0.5)) > 0.465 ? 0.68 : 1;
    const n = fbm(u, v, 6, 3, 141, 0.5);
    const k = bar * (0.93 + 0.07 * n);
    return [255 * k, 240 * k, 214 * k];
  }, 1);
  paperOut.repeat.set(1, 1);
  const lam = (o, opt) => outdoor.apply(new THREE.MeshLambertMaterial(o), opt);
  return {
    xPlaster: lam({ map: plaster }, { ao: 0.05 }),
    xTimber: lam({ map: timber }),
    xBoard: lam({ map: boards }),
    xTile: lam({ map: tiles }, { spec: 0.32 }),
    xUnder: lam({ map: timber, color: 0xa08a78 }, { fill: 4.0 }),
    // the eave's soffit: planed boards, paler than the rafters, warm with the
    // light bounced up from the sunlit garden
    xSoffit: lam({ map: timber, color: 0xffe6c8 }, { fill: 7.0 }),
    xDark: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.006, 0.005, 0.004), side: THREE.DoubleSide }),
    // the paper diffuses the leaves' small shadows away (at this distance a
    // leaf's penumbra is wider than the leaf): no shadow map on it
    xPaper: lam({ map: paperOut, color: 0xf4ead8, emissive: new THREE.Color(0.16, 0.11, 0.06) }, { sun: 0.95, translucent: 0.0, shadow: false }),
    xGlass: lam({ color: 0x9fb4bc, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }, { spec: 2.6, shadow: false, glint: true }),
    xGlassPaint: lam({ color: 0xb01818, side: THREE.DoubleSide }, { shadow: false }),
    xTanzaku: lam({ color: 0xd8c8a0, side: THREE.DoubleSide }, { translucent: 0.6, shadow: false }),
    xCord: lam({ color: 0x8a2018 }, { shadow: false }),
  };
}

// Rectangle (u0..u1, v0..v1) minus rectangular holes, as cells.
function panels(u0, u1, v0, v1, holes) {
  const us = [u0, u1];
  const vs = [v0, v1];
  for (const h of holes) {
    for (const u of [h[0], h[1]]) if (u > u0 && u < u1) us.push(u);
    for (const v of [h[2], h[3]]) if (v > v0 && v < v1) vs.push(v);
  }
  us.sort((a, b) => a - b);
  vs.sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < us.length - 1; i++) for (let j = 0; j < vs.length - 1; j++) {
    const cu = (us[i] + us[i + 1]) / 2;
    const cv = (vs[j] + vs[j + 1]) / 2;
    if (holes.some((h) => cu > h[0] && cu < h[1] && cv > h[2] && cv < h[3])) continue;
    if (us[i + 1] - us[i] < 1e-5 || vs[j + 1] - vs[j] < 1e-5) continue;
    out.push([us[i], us[i + 1], vs[j], vs[j + 1]]);
  }
  return out;
}

/**
 * @param {import('../_lib/geo.js').Builder} B
 * @returns {{ furin: THREE.Group, eave: object }}
 */
export function buildHouse(B, mats, { W, H, D, DOOR, WIN, SIDE }) {
  const ns = { cast: false, receive: false };
  // never into the room's spot shadow map or the dust shaft's bake (castShadow
  // false); the caller puts these meshes on layer 2, the garden sun's casters
  const cast = { cast: false, receive: false };
  const FL = -H / 2;
  const GY = FL - 0.035;
  const CEIL = H / 2;
  const xo = -W / 2 - 0.02; // west outer face
  const xin = W / 2 + 0.02; // the next room's inner side
  const xe = xin + SIDE.depth + 0.01; // east outer face
  const zNm = -D - 0.02; // the room's north outer face
  const zNn = -D - 0.03; // the room next door's north outer face
  const EW = ENGAWA.width;
  const xE0 = xo - EW - ROOF.overhang; // west eave edge
  const xE1 = xe + ROOF.overhang;
  const yE = CEIL + 0.035;
  const k = ROOF.pitch;
  const xr = (xE0 + xE1) / 2;
  const yR = yE + (xr - xE0) * k;
  const roofY = (x) => yR - Math.abs(x - xr) * k; // underside of the roof boards
  const zS = 0.0;
  const zN = zNn - ROOF.north;
  const off = 0.0008;

  // ---------------- west face of the room (sunlit): plaster over cedar boards,
  // posts and a beam in dark timber, the door and the lattice window open
  const topW = roofY(xo);
  const holesW = [[DOOR.z0, DOOR.z1, FL, DOOR.y1], [WIN.z0, WIN.z1, WIN.y0, WIN.y1]];
  const sill = WIN.y0 - 0.004;
  for (const [z0, z1, y0, y1] of panels(zNm, zS, FL, topW, holesW)) {
    const yb = Math.min(y1, sill);
    if (y0 < sill) B.add('xBoard', mats.xBoard, new THREE.PlaneGeometry(z1 - z0, yb - y0), mat4([xo - off, (y0 + yb) / 2, (z0 + z1) / 2], [0, -Math.PI / 2, 0]), cast);
    if (y1 > sill) {
      const ya = Math.max(y0, sill);
      B.add('xPlaster', mats.xPlaster, new THREE.PlaneGeometry(z1 - z0, y1 - ya), mat4([xo - off, (ya + y1) / 2, (z0 + z1) / 2], [0, -Math.PI / 2, 0]), cast);
    }
  }
  for (const z of [zS - 0.006, DOOR.z0 - 0.005, WIN.z0 - 0.006, zNm + 0.006]) B.box('xTimber', mats.xTimber, [0.006, topW - FL, 0.011], [xo - 0.003, (FL + topW) / 2, z], [0, 0, 0], cast);
  B.box('xTimber', mats.xTimber, [0.005, 0.01, zS - zNm], [xo - 0.0035, DOOR.y1 + 0.009, (zS + zNm) / 2], [0, 0, 0], cast);
  B.box('xTimber', mats.xTimber, [0.005, 0.006, zS - zNm], [xo - 0.0035, topW - 0.003, (zS + zNm) / 2], [0, 0, 0], cast);
  B.box('xTimber', mats.xTimber, [0.004, 0.004, WIN.z1 - WIN.z0 + 0.012], [xo - 0.003, WIN.y0 - 0.003, (WIN.z0 + WIN.z1) / 2], [0, 0, 0], cast);
  // the lattice window's paper, sunlit from outside, and its frame
  // 1.5 mm outside the room-side paper (at -W/2 - 0.0075, facing in): far
  // enough apart that depth never lets the inner sheet's back show through
  // from the garden, at any rig scale
  B.add('xPaper', mats.xPaper, new THREE.PlaneGeometry(WIN.z1 - WIN.z0, WIN.y1 - WIN.y0), mat4([-W / 2 - 0.009, (WIN.y0 + WIN.y1) / 2, (WIN.z0 + WIN.z1) / 2], [0, -Math.PI / 2, 0]), ns);
  for (const [y, h] of [[WIN.y0 + 0.002, 0.004], [WIN.y1 - 0.002, 0.004]]) B.box('xTimber', mats.xTimber, [0.004, h, WIN.z1 - WIN.z0], [-W / 2 - 0.0095, y, (WIN.z0 + WIN.z1) / 2], [0, 0, 0], ns);
  for (const z of [WIN.z0 + 0.002, WIN.z1 - 0.002]) B.box('xTimber', mats.xTimber, [0.004, WIN.y1 - WIN.y0, 0.004], [-W / 2 - 0.0095, (WIN.y0 + WIN.y1) / 2, z], [0, 0, 0], ns);
  // the door's reveal: the wall's thickness in dark timber, the sill's grooves
  B.box('xTimber', mats.xTimber, [0.02, 0.004, DOOR.z1 - DOOR.z0], [xo + 0.01, DOOR.y1 + 0.002, (DOOR.z0 + DOOR.z1) / 2], [0, 0, 0], ns);

  // ---------------- the front (south) face: the room's open front framed in
  // timber, the next room's front wall; all at or behind z = 0
  // a beam over the open front (behind the ceiling's own front face, above
  // its underside, so the room never sees it)
  B.box('xTimber', mats.xTimber, [W + 0.04, 0.02, 0.01], [0, CEIL + 0.0105, -0.0055], [0, 0, 0], cast);
  const sillS = FL + 0.07;
  B.add('xBoard', mats.xBoard, new THREE.PlaneGeometry(xe - xin, sillS - FL), mat4([(xin + xe) / 2, (FL + sillS) / 2, zS - off * 0.5]), cast);
  B.add('xPlaster', mats.xPlaster, new THREE.PlaneGeometry(xe - xin, CEIL + 0.02 - sillS), mat4([(xin + xe) / 2, (sillS + CEIL + 0.02) / 2, zS - off * 0.5]), cast);
  for (const x of [xe - 0.005, (xin + xe) / 2]) B.box('xTimber', mats.xTimber, [0.011, CEIL + 0.02 - FL, 0.006], [x, (FL + CEIL + 0.02) / 2, -0.003], [0, 0, 0], cast);
  B.box('xTimber', mats.xTimber, [xe - xin, 0.006, 0.005], [(xin + xe) / 2, sillS, -0.0025], [0, 0, 0], cast);

  // ---------------- east face of the room next door (in shade)
  const topE = roofY(xe);
  for (const [z0, z1, y0, y1] of panels(zNn, zS, FL, topE, [])) {
    B.add('xBoard', mats.xBoard, new THREE.PlaneGeometry(z1 - z0, sillS - y0), mat4([xe + off, (y0 + sillS) / 2, (z0 + z1) / 2], [0, Math.PI / 2, 0]), cast);
    B.add('xPlaster', mats.xPlaster, new THREE.PlaneGeometry(z1 - z0, y1 - sillS), mat4([xe + off, (sillS + y1) / 2, (z0 + z1) / 2], [0, Math.PI / 2, 0]), cast);
  }
  for (const z of [zS - 0.006, -0.18, -0.36, zNn + 0.006]) B.box('xTimber', mats.xTimber, [0.006, topE - FL, 0.011], [xe + 0.003, (FL + topE) / 2, z], [0, 0, 0], cast);
  B.box('xTimber', mats.xTimber, [0.005, 0.006, zS - zNn], [xe + 0.0035, sillS, (zS + zNn) / 2], [0, 0, 0], cast);

  // ---------------- north faces: the room's (with the round window), the
  // room next door's; then the gable over both
  const R = Math.min(W, H) * 0.24;
  const cy = 0.02;
  const steps = 40;
  const yTopN = CEIL + 0.02;
  for (let i = 0; i < steps; i++) {
    const y0 = FL + ((yTopN - FL) * i) / steps;
    const y1 = FL + ((yTopN - FL) * (i + 1)) / steps;
    const ym = (y0 + y1) / 2 - cy;
    const half = Math.abs(ym) < R ? Math.sqrt(R * R - ym * ym) : 0;
    const key = y1 <= sill ? 'xBoard' : 'xPlaster';
    const segs = half > 0 ? [[xo, -half], [half, xin]] : [[xo, xin]];
    for (const [a, b] of segs) B.add(key, mats[key], new THREE.PlaneGeometry(b - a, y1 - y0), mat4([(a + b) / 2, (y0 + y1) / 2, zNm - off], [0, Math.PI, 0]), cast);
  }
  B.add('xTimber', mats.xTimber, new THREE.TorusGeometry(R + 0.002, 0.004, 8, 64), mat4([0, cy, zNm - 0.002]), ns);
  B.add('xPlaster', mats.xPlaster, new THREE.PlaneGeometry(xe - xin, yTopN - sillS), mat4([(xin + xe) / 2, (sillS + yTopN) / 2, zNn - off], [0, Math.PI, 0]), cast);
  B.add('xBoard', mats.xBoard, new THREE.PlaneGeometry(xe - xin, sillS - FL), mat4([(xin + xe) / 2, (FL + sillS) / 2, zNn - off], [0, Math.PI, 0]), cast);
  // the step between the two north faces, and the posts
  B.box('xTimber', mats.xTimber, [0.012, yTopN - FL, 0.012], [xin - 0.006, (FL + yTopN) / 2, zNn + 0.006], [0, 0, 0], cast);
  for (const x of [xo + 0.006, -0.08, 0.08]) B.box('xTimber', mats.xTimber, [0.011, yTopN - FL, 0.006], [x, (FL + yTopN) / 2, zNm - 0.003], [0, 0, 0], cast);
  B.box('xTimber', mats.xTimber, [xe - xo, 0.006, 0.006], [(xo + xe) / 2, sill, zNn - 0.002], [0, 0, 0], cast);

  // ---------------- gables (south flush with the front, north under the overhang)
  const gable = (z, face) => {
    const sh = new THREE.Shape();
    const yb = CEIL + 0.02;
    sh.moveTo(xo, yb);
    sh.lineTo(xe, yb);
    sh.lineTo(xe, roofY(xe));
    sh.lineTo(xr, yR);
    sh.lineTo(xo, roofY(xo));
    sh.closePath();
    const g = new THREE.ShapeGeometry(sh);
    if (face < 0) g.rotateY(Math.PI); // facing -z: mirror x back
    if (face < 0) g.scale(-1, 1, 1);
    // re-wind after the mirror
    if (face < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i]; ix[i] = ix[i + 1]; ix[i + 1] = t; } g.computeVertexNormals(); }
    B.add('xPlaster', mats.xPlaster, g, mat4([0, 0, z]), cast);
    // timber: a tie beam, a king post, two struts
    const yt = yb + 0.035;
    B.box('xTimber', mats.xTimber, [xe - xo, 0.008, 0.006], [(xo + xe) / 2, yt, z + face * 0.003], [0, 0, 0], ns);
    B.box('xTimber', mats.xTimber, [0.008, yR - yb, 0.006], [xr, (yb + yR) / 2, z + face * 0.003], [0, 0, 0], ns);
    for (const s of [-1, 1]) B.box('xTimber', mats.xTimber, [0.006, (roofY(xr + s * 0.18) - yt), 0.006], [xr + s * 0.18, (yt + roofY(xr + s * 0.18)) / 2, z + face * 0.003], [0, 0, 0], ns);
  };
  gable(-0.002, 1);
  gable(zNn - off, -1);
  // the attic closed from below where the gables don't reach (over the engawa it is the eave)
  B.box('xDark', mats.xDark, [xe - xo, 0.002, zS - zNn], [(xo + xe) / 2, CEIL + 0.021, (zS + zNn) / 2], [0, 0, 0], ns);

  // ---------------- the roof: two slopes of tiles on boards, the ridge, the
  // barge boards, rafters under the eaves
  const a = Math.atan(k);
  const th = 0.008;
  const roofLen = (xr - xE0) / Math.cos(a) + 0.01;
  for (const s of [-1, 1]) {
    const cx = xr + s * (xr - xE0) / 2;
    const cyR = (yR + yE) / 2 + th / 2 / Math.cos(a);
    B.add('xTile', mats.xTile, boxUV(roofLen, th, zS - zN, 1), mat4([cx, cyR, (zS + zN) / 2], [0, 0, -s * a]), cast);
    // the eave's fascia board along the edge
    const ex = s < 0 ? xE0 : xE1;
    B.box('xTimber', mats.xTimber, [0.006, 0.014, zS - zN], [ex + s * 0.002, yE + 0.001, (zS + zN) / 2], [0, 0, -s * a], cast);
  }
  // the ridge: a stack of tiles, ridge-end tiles at both gables
  B.box('xTile', mats.xTile, [0.03, 0.022, zS - zN + 0.008], [xr, yR + 0.016, (zS + zN) / 2], [0, 0, 0], cast);
  B.add('xTile', mats.xTile, new THREE.CylinderGeometry(0.012, 0.012, zS - zN + 0.012, 10, 1), mat4([xr, yR + 0.028, (zS + zN) / 2], [Math.PI / 2, 0, 0]), cast);
  for (const z of [zS + 0.004, zN - 0.004]) B.add('xTile', mats.xTile, boxUV(0.05, 0.05, 0.01), mat4([xr, yR + 0.03, z]), cast);
  // barge boards along the gables' rakes
  for (const z of [zS + 0.001, zN - 0.001]) {
    for (const s of [-1, 1]) {
      const ex = s < 0 ? xE0 : xE1;
      const mx = (xr + ex) / 2;
      B.box('xTimber', mats.xTimber, [roofLen, 0.016, 0.006], [mx, (yR + yE) / 2 + 0.002, z], [0, 0, -s * a], cast);
    }
  }
  // rafters under the west eave (seen from the engawa) and the east eave
  for (let z = zS - 0.012; z > zN + 0.006; z -= 0.022) {
    for (const s of [-1, 1]) {
      const xw = s < 0 ? xo : xe;
      const ex = s < 0 ? xE0 : xE1;
      const len = Math.abs(xw - ex) / Math.cos(a) + 0.006;
      const mx = (xw + ex) / 2;
      B.box('xUnder', mats.xUnder, [len, 0.005, 0.004], [mx, roofY(mx) - 0.0025, z], [0, 0, -s * a], ns);
    }
  }
  // the eave's soffit boards (dark, between the rafters)
  for (const s of [-1, 1]) {
    const xw = s < 0 ? xo : xe;
    const ex = s < 0 ? xE0 : xE1;
    const mx = (xw + ex) / 2;
    const len = Math.abs(xw - ex) / Math.cos(a) + 0.006;
    B.box('xSoffit', mats.xSoffit, [len, 0.002, zS - zN], [mx, roofY(mx) + 0.0005, (zS + zN) / 2], [0, 0, -s * a], ns);
  }

  // ---------------- the engawa: boards on joists, an edge beam, posts up to
  // the eave beam on stone footings, the step stone
  const ez0 = ENGAWA.z0;
  const ez1 = ENGAWA.z1;
  const xEd = xo - EW;
  B.add('gWood', mats.gWood, boxUV(EW, 0.006, ez0 - ez1, 0.5), mat4([xo - EW / 2, FL - 0.003, (ez0 + ez1) / 2]), cast);
  for (let x = xo - 0.0125; x > xEd + 0.002; x -= 0.0125) B.box('gDark', mats.gDark, [0.0008, 0.0004, ez0 - ez1], [x, FL + 0.0002, (ez0 + ez1) / 2], [0, 0, 0], ns);
  B.box('xTimber', mats.xTimber, [0.008, 0.012, ez0 - ez1], [xEd + 0.004, FL - 0.008, (ez0 + ez1) / 2], [0, 0, 0], cast);
  const yk = roofY(xEd + 0.004) - 0.005; // the eave beam (keta) under the rafters
  B.box('xTimber', mats.xTimber, [0.011, 0.014, ez0 - ez1 + 0.02], [xEd + 0.004, yk - 0.007, (ez0 + ez1) / 2], [0, 0, 0], cast);
  const posts = [];
  for (let z = ez0 - 0.008; z > ez1; z -= 0.18) posts.push(z);
  posts.push(ez1 + 0.006);
  for (const z of posts) {
    B.box('xTimber', mats.xTimber, [0.008, yk - 0.014 - FL, 0.008], [xEd + 0.004, (FL + yk - 0.014) / 2, z], [0, 0, 0], cast);
    B.box('gStone', mats.gStone, [0.018, 0.022, 0.018], [xEd + 0.004, GY + 0.007, z], [0, 0, 0], cast);
    B.box('xTimber', mats.xTimber, [0.007, FL - 0.014 - GY - 0.018 + 0.01, 0.007], [xEd + 0.004, (FL - 0.014 + GY + 0.018) / 2, z], [0, 0, 0], ns);
  }
  // short posts on stones under the engawa, the crawl space behind dark
  for (let z = ez0 - 0.06; z > ez1; z -= 0.12) {
    B.box('gStone', mats.gStone, [0.012, 0.014, 0.012], [xo - EW / 2, GY + 0.004, z], [0, 0, 0], ns);
    B.box('xTimber', mats.xTimber, [0.006, FL - GY - 0.02, 0.006], [xo - EW / 2, (FL - 0.006 + GY + 0.011) / 2, z], [0, 0, 0], ns);
  }
  // under the house: a dark crawl space behind a sill beam, on stone footings
  const pz0 = zNn;
  B.box('xDark', mats.xDark, [xe - xo - 0.012, FL - GY + 0.008, zS - pz0 - 0.012], [(xo + xe) / 2, (FL - 0.002 + GY - 0.01) / 2, (zS + pz0) / 2 - 0.004], [0, 0, 0], ns);
  B.box('xTimber', mats.xTimber, [xe - xo, 0.008, 0.008], [(xo + xe) / 2, FL - 0.004, zS - 0.004], [0, 0, 0], ns);
  B.box('xTimber', mats.xTimber, [xe - xo, 0.008, 0.008], [(xo + xe) / 2, FL - 0.004, pz0 + 0.004], [0, 0, 0], ns);
  B.box('xTimber', mats.xTimber, [0.008, 0.008, zS - pz0], [xo + 0.004, FL - 0.004, (zS + pz0) / 2], [0, 0, 0], ns);
  B.box('xTimber', mats.xTimber, [0.008, 0.008, zS - pz0], [xe - 0.004, FL - 0.004, (zS + pz0) / 2], [0, 0, 0], ns);
  for (const [x, z] of [[xo + 0.006, zS - 0.006], [xo + 0.006, pz0 + 0.006], [xe - 0.006, zS - 0.006], [xe - 0.006, pz0 + 0.006], [xin - 0.006, zS - 0.006], [xin - 0.006, pz0 + 0.006], [xo + 0.006, -0.26], [xe - 0.006, -0.26]]) {
    B.box('gStone', mats.gStone, [0.02, 0.026, 0.02], [x, GY + 0.008, z], [0, 0, 0], ns);
  }
  // the step stone at the door
  B.add('gStone', mats.gStone, new THREE.CylinderGeometry(0.03, 0.034, 0.024, 9), mat4([xEd - 0.022, GY + 0.012, (DOOR.z0 + DOOR.z1) / 2], [0, 0.3, 0], [1, 1, 0.78]), cast);

  // ---------------- the fūrin: a glass bell on a cord from the eave beam,
  // its clapper and a paper strip that catches the wind
  const furin = new THREE.Group();
  furin.name = 'furin';
  // from a rafter near the eave's edge, so from the engawa it hangs against the sky
  const hang = new THREE.Vector3(xE0 + 0.006, roofY(xE0 + 0.006) - 0.005, -0.3);
  const cord = 0.045;
  const bellGeo = new THREE.SphereGeometry(0.0065, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.62);
  const bell = new THREE.Mesh(bellGeo, mats.xGlass);
  bell.name = 'furinGlass';
  bell.renderOrder = 2;
  const paint1 = new THREE.Mesh(new THREE.SphereGeometry(0.00655, 18, 4, 0, Math.PI * 2, Math.PI * 0.38, Math.PI * 0.12), mats.xGlassPaint);
  paint1.name = 'furinPaint';
  const clapper = new THREE.Mesh(new THREE.CylinderGeometry(0.0004, 0.0004, 0.011, 4), mats.xCord);
  clapper.position.y = -0.0055;
  clapper.name = 'furinCord';
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.0045, 0.022), mats.xTanzaku);
  strip.position.y = -0.011 - 0.011;
  strip.name = 'furinStrip';
  const swing = new THREE.Group(); // pivots at the hook
  const bob = new THREE.Group();
  bob.position.y = -cord;
  bob.add(bell, paint1, clapper);
  const stripPivot = new THREE.Group();
  stripPivot.position.y = -0.011;
  strip.position.y = -0.011;
  stripPivot.add(strip);
  bob.add(stripPivot);
  const cordMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.0003, 0.0003, cord, 4), mats.xCord);
  cordMesh.position.y = -cord / 2;
  cordMesh.name = 'furinCord';
  swing.add(cordMesh, bob);
  furin.add(swing);
  furin.position.copy(hang);
  furin.userData = { swing, stripPivot };
  return { furin, eave: { xEdge: xE0, y: yE, keta: yk, xPost: xEd + 0.004 }, roof: { xr, yR, roofY } };
}

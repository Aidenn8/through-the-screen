// Outside the Box, for the big swings to the right: the shoji beside the
// lattice window stands slid open onto an engawa (a board veranda under the
// eave) and a small garden at dusk: moss and stepping stones, a stone lantern
// with its candle lit, a maple turning red, a plaster garden wall, and the
// ridges beyond under the evening sky. The same low sun as the room's: it
// rakes the garden from the west (the left), so the near faces sit in shade
// and the tops and west sides catch it; long shadows are painted onto the
// ground. Window-space metres; the room is W x H x D behind the glass.

import * as THREE from 'three';
import { boxUV, mat4 } from '../_lib/geo.js';
import { paint, fbm, toTexture, rng } from '../_lib/textures.js';
import { maskSpots } from '../_lib/lightmask.js';

// The open doorway in the left wall: floor to the lintel, in front of the
// lattice window.
export const DOOR = { z0: -0.14, z1: -0.012, y1: 0.08 };

// The sun as the garden sees it: the room's sun travels this way (from the
// west, low, a little toward the viewer's side).
const SUN_DIR = new THREE.Vector3(0.892, -0.3, -0.34).normalize();

// Garden lighting without shadow maps: the low sun as a directional term, a
// dusk sky fill from above and a dark ground bounce, injected like the
// soundstage's work lights. The room's spot is compiled out (mask 0).
function outdoor(material, { sun = 1, fill = 1, translucent = 0 } = {}) {
  maskSpots(material, 0);
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    shader.uniforms.gSunDir = { value: SUN_DIR };
    shader.uniforms.gSun = { value: new THREE.Vector3(1.0, 0.6, 0.3).multiplyScalar(3.2 * sun) };
    shader.uniforms.gSky = { value: new THREE.Vector3(0.16, 0.18, 0.32).multiplyScalar(0.55 * fill) };
    shader.uniforms.gGround = { value: new THREE.Vector3(0.06, 0.045, 0.03).multiplyScalar(fill) };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 gSunDir;\nuniform vec3 gSun;\nuniform vec3 gSky;\nuniform vec3 gGround;')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          vec3 Nw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          float ndl = dot(Nw, -gSunDir);
          reflectedLight.directDiffuse += diffuseColor.rgb * gSun * max(ndl, 0.0);
          // light through thin leaves from behind
          reflectedLight.directDiffuse += diffuseColor.rgb * gSun * ${translucent.toFixed(3)} * max(-ndl, 0.0);
          reflectedLight.indirectDiffuse += diffuseColor.rgb * mix(gGround, gSky, Nw.y * 0.5 + 0.5);
        }`);
  };
  const prevKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}-outdoor${sun}-${fill}-${translucent}`;
  return material;
}

function noiseTex(N, fn, metres) {
  const t = toTexture(paint(N, N, fn));
  t.repeat.set(1 / metres, 1 / metres);
  return t;
}

// Dusk sky: deep blue overhead to a warm band on the western horizon (where
// the sun is going down), cooler and dimmer toward the east.
function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { sunDir: { value: SUN_DIR.clone().negate() } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float up = clamp(d.y, -0.2, 1.0);
        vec3 s = normalize(vec3(sunDir.x, 0.0, sunDir.z));
        float toward = max(dot(normalize(vec3(d.x, 0.0, d.z)), s), 0.0);
        vec3 zenith = vec3(0.012, 0.024, 0.075);
        float west = 0.5 + 0.5 * dot(normalize(vec3(d.x, 0.0, d.z)), s);
        vec3 horizon = mix(vec3(0.07, 0.05, 0.1), vec3(0.95, 0.42, 0.16), pow(west, 2.2));
        float k = pow(1.0 - clamp(up, 0.0, 1.0), 5.0);
        vec3 c = mix(zenith, horizon, k);
        c = mix(c, vec3(0.05, 0.06, 0.14), smoothstep(0.02, 0.25, up) * (1.0 - smoothstep(0.25, 0.7, up)) * 0.6);
        // the glow around where the sun has just gone behind the ridge
        float g = max(dot(d, normalize(sunDir * vec3(1.0, 0.25, 1.0))), 0.0);
        c += vec3(1.4, 0.6, 0.22) * pow(g, 24.0) * 0.8;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

export function createGardenMaterials(textures) {
  const moss = noiseTex(128, (u, v) => {
    const n = fbm(u, v, 10, 4, 51, 0.55);
    const m = fbm(u, v, 3, 3, 52, 0.5);
    return [26 + 18 * n * m, 36 + 30 * n, 16 + 10 * n];
  }, 0.06);
  const stone = noiseTex(128, (u, v) => {
    const n = fbm(u, v, 8, 5, 61, 0.55);
    const l = fbm(u, v, 2, 3, 62, 0.5);
    return [104 * (0.7 + 0.5 * n) + 10 * l, 102 * (0.7 + 0.5 * n), 96 * (0.7 + 0.5 * n)];
  }, 0.04);
  const gravel = noiseTex(128, (u, v) => {
    const n = fbm(u, v, 30, 2, 71, 0.6);
    const rake = 0.88 + 0.12 * Math.sin(v * Math.PI * 2 * 14);
    const k = (0.62 + 0.4 * n) * rake;
    return [150 * k, 146 * k, 136 * k];
  }, 0.12);
  const plaster = noiseTex(128, (u, v) => {
    const n = fbm(u, v, 6, 4, 81, 0.5);
    return [184 * (0.85 + 0.2 * n), 150 * (0.85 + 0.2 * n), 104 * (0.85 + 0.2 * n)];
  }, 0.15);
  const lam = (o, opts) => outdoor(new THREE.MeshLambertMaterial(o), opts);
  return {
    gMoss: lam({ map: moss }, { sun: 0.45 }),
    gStone: lam({ map: stone }),
    gGravel: lam({ map: gravel }),
    gPlaster: lam({ map: plaster }),
    gTile: lam({ color: 0x2a2b30 }),
    gWood: lam({ map: textures.boards, color: 0xc8b8a8 }),
    gDark: lam({ color: 0x2a1c14 }),
    gTrunk: lam({ color: 0x2c2420 }),
    gLeafRed: lam({ color: 0xa0200c, side: THREE.DoubleSide }, { translucent: 0.45 }),
    gLeafOrange: lam({ color: 0xc04a10, side: THREE.DoubleSide }, { translucent: 0.45 }),
    gLeafAmber: lam({ color: 0xb87818, side: THREE.DoubleSide }, { translucent: 0.4 }),
    gShrub: lam({ color: 0x1c3418 }),
    gShadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    gCandle: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.62, 0.28).multiplyScalar(3.2) }),
    gPaper: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.72, 0.42).multiplyScalar(1.6), side: THREE.DoubleSide }),
    gRidgeNear: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.075, 0.05, 0.075) }),
    gRidgeFar: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.12, 0.13) }),
    gSky: skyMaterial(),
  };
}

// One maple leaf: seven pointed lobes, about r across, in the xz plane.
function leafGeometry(r) {
  const s = new THREE.Shape();
  const n = 7;
  for (let i = 0; i <= n * 2; i++) {
    const a = Math.PI * (0.15 + (0.7 * i) / (n * 2)) * 2 - Math.PI * 0.35;
    const rr = i % 2 === 0 ? r * (0.55 + 0.45 * Math.sin((i / (n * 2)) * Math.PI)) : r * 0.32;
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);
  return g;
}

export function buildGarden(B, mats, { W, H, D }) {
  const noShadow = { cast: false, receive: false };
  const r = rng(33);
  const FL = -H / 2; // the room's floor
  const GY = FL - 0.035; // the garden's ground
  const XW = -W / 2; // the left wall's inner face
  const xo = XW - 0.02; // its outer face

  // ---------------- the engawa: boards along the wall, a beam at its edge,
  // posts up to the eave; the step stone below it
  const EW = 0.075;
  const ez0 = 0.04;
  const ez1 = -D - 0.12;
  B.add('gWood', mats.gWood, boxUV(EW, 0.006, ez0 - ez1, 0.5), mat4([xo - EW / 2, FL - 0.003, (ez0 + ez1) / 2]), noShadow);
  for (let x = xo - 0.012; x > xo - EW; x -= 0.0125) B.box('gDark', mats.gDark, [0.0008, 0.0004, ez0 - ez1], [x, FL + 0.0002, (ez0 + ez1) / 2], [0, 0, 0], noShadow);
  B.box('gDark', mats.gDark, [0.008, 0.012, ez0 - ez1], [xo - EW, FL - 0.008, (ez0 + ez1) / 2], [0, 0, 0], noShadow);
  for (let z = ez0 - 0.02; z > ez1; z -= 0.17) {
    B.box('gDark', mats.gDark, [0.007, 0.32, 0.007], [xo - EW + 0.004, FL + 0.12, z], [0, 0, 0], noShadow);
    B.box('gStone', mats.gStone, [0.016, 0.03, 0.016], [xo - EW + 0.004, GY + 0.012, z], [0, 0, 0], noShadow);
  }
  // the eave: a sloping roof of boards on rafters over the engawa
  const ey = H / 2 + 0.012;
  B.add('gDark', mats.gDark, boxUV(0.14, 0.004, ez0 - ez1 + 0.06), mat4([xo - 0.06, ey + 0.012, (ez0 + ez1) / 2], [0, 0, 0.22]), noShadow);
  for (let z = ez0; z > ez1; z -= 0.02) B.box('gDark', mats.gDark, [0.15, 0.005, 0.004], [xo - 0.06, ey + 0.006, z], [0, 0, 0.22], noShadow);
  B.box('gDark', mats.gDark, [0.012, 0.012, ez0 - ez1], [xo - EW + 0.004, ey - 0.014, (ez0 + ez1) / 2], [0, 0, 0], noShadow);
  // the step stone and the stepping stones leading off into the moss
  B.add('gStone', mats.gStone, new THREE.CylinderGeometry(0.03, 0.034, 0.02, 9), mat4([xo - EW - 0.02, GY + 0.012, DOOR.z0 * 0.5 + DOOR.z1 * 0.5], [0, 0.3, 0], [1, 1, 0.75]), noShadow);
  for (const [x, z, s] of [[-0.31, -0.11, 0.022], [-0.36, -0.17, 0.02], [-0.4, -0.25, 0.021], [-0.47, -0.31, 0.019], [-0.53, -0.4, 0.02]]) {
    B.add('gStone', mats.gStone, new THREE.CylinderGeometry(s, s * 1.08, 0.008, 9), mat4([x, GY + 0.003, z], [0, r() * 3, 0], [1, 1, 0.8 + r() * 0.3]), noShadow);
  }

  // ---------------- the ground: moss, a raked gravel bed, mounds, rocks
  B.add('gMoss', mats.gMoss, new THREE.PlaneGeometry(1.6, 2.4), mat4([XW - 0.8, GY, -0.6], [-Math.PI / 2, 0, 0]), noShadow);
  B.add('gGravel', mats.gGravel, new THREE.CircleGeometry(0.16, 32), mat4([-0.62, GY + 0.0008, -0.18], [-Math.PI / 2, 0, 0], [1.4, 1, 1]), noShadow);
  for (let i = 0; i < 14; i++) {
    const x = -0.28 - r() * 0.6;
    const z = 0.1 - r() * 1.1;
    const s = 0.02 + r() * 0.05;
    B.add('gMoss', mats.gMoss, new THREE.SphereGeometry(s, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat4([x, GY, z], [0, r() * 3, 0], [1.3, 0.35 + r() * 0.2, 1]), noShadow);
  }
  for (const [x, z, s] of [[-0.58, -0.13, 0.03], [-0.66, -0.22, 0.02], [-0.33, -0.5, 0.026]]) {
    B.add('gStone', mats.gStone, new THREE.DodecahedronGeometry(s, 1), mat4([x, GY + s * 0.35, z], [r(), r() * 3, r()], [1.3, 0.75, 1]), noShadow);
  }

  // ---------------- the stone lantern: base, pillar, platform, the fire box
  // with its candle lit, the umbrella roof, the jewel
  const L = [-0.43, GY, -0.33];
  const T = mat4(L, [0, 0.5, 0]);
  const at = (y) => new THREE.Matrix4().multiplyMatrices(T, mat4([0, y, 0]));
  const lathe = (pts, seg = 6) => new THREE.LatheGeometry(pts.map(([rr, y]) => new THREE.Vector2(rr, y)), seg);
  B.add('gStone', mats.gStone, lathe([[0, 0], [0.026, 0], [0.026, 0.006], [0.02, 0.012], [0, 0.012]]), at(0), noShadow);
  B.add('gStone', mats.gStone, new THREE.CylinderGeometry(0.008, 0.009, 0.06, 10), at(0.042), noShadow);
  B.add('gStone', mats.gStone, lathe([[0, 0], [0.012, 0], [0.024, 0.008], [0.024, 0.012], [0, 0.012]]), at(0.072), noShadow);
  B.add('gStone', mats.gStone, boxUV(0.03, 0.026, 0.03), at(0.097), noShadow);
  B.add('gCandle', mats.gCandle, new THREE.PlaneGeometry(0.014, 0.014), new THREE.Matrix4().multiplyMatrices(at(0.098), mat4([0, 0, 0.0152])), noShadow);
  B.add('gCandle', mats.gCandle, new THREE.PlaneGeometry(0.014, 0.014), new THREE.Matrix4().multiplyMatrices(at(0.098), mat4([0.0152, 0, 0], [0, Math.PI / 2, 0])), noShadow);
  B.add('gStone', mats.gStone, lathe([[0, 0], [0.04, 0], [0.042, 0.004], [0.022, 0.016], [0.006, 0.022], [0, 0.022]], 6), at(0.11), noShadow);
  B.add('gStone', mats.gStone, new THREE.SphereGeometry(0.006, 8, 6), at(0.137), noShadow);
  // its long shadow across the moss, away from the sun
  const away = new THREE.Vector2(SUN_DIR.x, SUN_DIR.z).normalize();
  const shadow = (x, z, len, wid) => {
    const a = Math.atan2(away.y, away.x);
    B.add('gShadow', mats.gShadow, new THREE.CircleGeometry(0.5, 20), mat4([x + away.x * len * 0.5, GY + 0.0015, z + away.y * len * 0.5], [-Math.PI / 2, 0, -a], [len, wid, 1]), noShadow);
  };
  shadow(L[0], L[2], 0.32, 0.05);

  // ---------------- the maple: a leaning trunk forking into branches, leaves
  // in clusters along their ends, red to amber
  const M = [-0.62, GY, -0.5];
  const limbs = [];
  const limb = (a, b, r0, r1) => {
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(...a), new THREE.Vector3((a[0] + b[0]) / 2 + 0.01, (a[1] + b[1]) / 2 + 0.01, (a[2] + b[2]) / 2), new THREE.Vector3(...b)]);
    const g = new THREE.TubeGeometry(curve, 10, (r0 + r1) / 2, 6, false);
    B.add('gTrunk', mats.gTrunk, g, null, noShadow);
    limbs.push(curve);
    return b;
  };
  // leaning toward the house, forking low; its branches reach out over the
  // moss in layers, the leaves in dense flat sprays at their ends
  const top = limb([M[0], M[1], M[2]], [M[0] + 0.04, M[1] + 0.1, M[2] + 0.015], 0.0055, 0.0045);
  const fork = limb([M[0] + 0.01, M[1] + 0.03, M[2]], [M[0] - 0.03, M[1] + 0.12, M[2] - 0.03], 0.0035, 0.0028);
  const ends = [];
  const spray = (from, dx, dy, dz) => ends.push(limb(from, [from[0] + dx, from[1] + dy, from[2] + dz], 0.0024, 0.0012));
  spray(top, 0.13, 0.05, 0.1);
  spray(top, 0.1, 0.09, -0.02);
  spray(top, -0.02, 0.12, 0.07);
  spray(top, 0.05, 0.14, -0.09);
  spray([top[0] - 0.01, top[1] - 0.03, top[2]], 0.17, 0.0, 0.13);
  spray(fork, -0.06, 0.08, 0.02);
  spray(fork, 0.03, 0.11, -0.08);
  const leaf = leafGeometry(0.0058);
  const keys = ['gLeafRed', 'gLeafOrange', 'gLeafAmber'];
  for (const e of ends) {
    for (let i = 0; i < 150; i++) {
      // a flat, layered spray around each branch end
      const u = r() * Math.PI * 2;
      const rad = Math.sqrt(r()) * 0.05;
      const p = [e[0] + Math.cos(u) * rad, e[1] + (r() - 0.6) * 0.016 - rad * 0.18, e[2] + Math.sin(u) * rad];
      const k = keys[Math.min(2, Math.floor(r() * r() * 3.2))];
      B.add(k, mats[k], leaf.clone(), mat4(p, [(r() - 0.5) * 0.7, r() * 6.28, (r() - 0.5) * 0.7], [0.8 + r() * 0.5, 1, 0.8 + r() * 0.5]), noShadow);
    }
  }
  leaf.dispose();
  // a few fallen leaves on the moss and the engawa
  for (let i = 0; i < 40; i++) {
    const k = keys[Math.floor(r() * 3)];
    const x = -0.24 - r() * 0.5;
    const z = 0.05 - r() * 0.4;
    B.add(k, mats[k], leafGeometry(0.005), mat4([x, GY + 0.0012, z], [0, r() * 6.28, 0]), noShadow);
  }
  shadow(M[0] + 0.03, M[2], 0.45, 0.16);

  // clipped shrubs along the wall
  for (const [x, z, s] of [[-0.82, 0.05, 0.06], [-0.84, -0.2, 0.07], [-0.8, -0.48, 0.055], [-0.83, -0.75, 0.065]]) {
    B.add('gShrub', mats.gShrub, new THREE.SphereGeometry(s, 16, 10), mat4([x, GY + s * 0.4, z], [0, 0, 0], [1.2, 0.8, 1.3]), noShadow);
  }

  // ---------------- the garden wall: plaster under a tiled cap
  const wx = -0.95;
  B.add('gPlaster', mats.gPlaster, boxUV(0.03, 0.11, 2.4), mat4([wx, GY + 0.055, -0.6]), noShadow);
  B.box('gTile', mats.gTile, [0.032, 0.032, 2.42], [wx, GY + 0.112, -0.6], [0, 0, Math.PI / 4], noShadow);
  B.box('gTile', mats.gTile, [0.07, 0.006, 2.42], [wx, GY + 0.111, -0.6], [0, 0, 0], noShadow);

  // ---------------- the ridges and the sky, far off to the west
  const ridge = (x, base, amp, seed, key, w) => {
    const rr = rng(seed);
    const sh = new THREE.Shape();
    sh.moveTo(-w / 2, base - 3);
    const ph = [rr() * 6, rr() * 6, rr() * 6];
    for (let i = 0; i <= 60; i++) {
      const zz = -w / 2 + (w * i) / 60;
      sh.lineTo(zz, base + amp * (0.55 * Math.sin(zz * 1.3 + ph[0]) + 0.3 * Math.sin(zz * 3.1 + ph[1]) + 0.15 * Math.sin(zz * 7 + ph[2])));
    }
    sh.lineTo(w / 2, base - 3);
    B.add(key, mats[key], new THREE.ShapeGeometry(sh), mat4([x, 0, -1], [0, Math.PI / 2, 0]), noShadow);
  };
  ridge(-3.2, 0.2, 0.13, 5, 'gRidgeNear', 12);
  ridge(-6.0, 0.26, 0.16, 9, 'gRidgeFar', 20);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(9, 32, 16), mats.gSky);
  sky.name = 'gardenSky';
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  return { sky };
}

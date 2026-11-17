// The garden west of the Box's house, on the stone terrace: moss over the
// ground with cushions of it round the stones, stepping stones from the
// engawa's step stone to a water basin (tsukubai) fed by a bamboo spout, a
// stone lantern with its candle lit, a red maple in full autumn leaf (its
// leaves instanced, lit through from behind by the low sun), a raked gravel
// bed with three rocks, clipped azaleas, a low clipped hedge along the
// terrace's edge, plaster walls under tiled caps on the other three sides,
// and a bamboo grove behind the house. The sun is the room's own low sun from
// the west (outdoor.js), with a real shadow map over the terrace.
//
// Window-space metres; the room is W x H x D behind the glass.

import * as THREE from 'three';
import { boxUV, mat4 } from '../_lib/geo.js';
import { paint, fbm, toTexture, rng } from '../_lib/textures.js';
import { SUN_DIR, SKY_GLSL } from './outdoor.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TERRACE } from './world.js';

// The open doorway in the left wall: floor to the lintel, in front of the
// lattice window.
export const DOOR = { z0: -0.14, z1: -0.012, y1: 0.08 };

// Where things stand (scene metres; y is the ground's).
export const SPOTS = {
  basin: [-0.47, -0.3],
  lantern: [-0.58, -0.2],
  maple: [-0.92, -0.37],
  gravel: { x0: -1.24, x1: -0.78, z0: -0.3, z1: -0.05 },
};

function noiseTex(N, fn, metres) {
  const t = toTexture(paint(N, N, fn));
  t.repeat.set(1 / metres, 1 / metres);
  return t;
}

export function createGardenMaterials(outdoor, textures) {
  const moss = noiseTex(256, (u, v) => {
    // cushion moss: rounded clumps with dark gaps, lighter tips, a few dry patches
    const n = fbm(u, v, 16, 4, 51, 0.55);
    const m = fbm(u, v, 4, 3, 52, 0.5);
    const clump = fbm(u, v, 40, 2, 53, 0.5);
    const tips = fbm(u, v, 96, 1, 54, 0.5);
    const k = (0.35 + 0.95 * Math.pow(clump, 1.6)) * (0.8 + 0.4 * n) * (0.9 + 0.25 * tips);
    const dry = Math.max(0, m - 0.6) * 2;
    return [Math.min(255, (40 + 40 * dry) * k), Math.min(255, (64 + 10 * dry) * k), (22 + 6 * dry) * k];
  }, 0.07);
  const stone = noiseTex(128, (u, v) => {
    const n = fbm(u, v, 8, 5, 61, 0.55);
    const l = fbm(u, v, 2, 3, 62, 0.5);
    const lich = fbm(u, v, 12, 3, 63, 0.5) > 0.62 ? 1.12 : 1;
    return [92 * (0.7 + 0.5 * n) * lich + 8 * l, 90 * (0.7 + 0.5 * n) * lich, 84 * (0.7 + 0.5 * n)];
  }, 0.05);
  const gravel = noiseTex(256, (u, v) => {
    const n = fbm(u, v, 60, 2, 71, 0.6);
    const rake = 0.55 + 0.45 * Math.sin(v * Math.PI * 2 * 18) ** 2;
    const k = (0.62 + 0.4 * n) * rake;
    return [168 * k, 162 * k, 150 * k];
  }, 0.2);
  const wallPlaster = noiseTex(128, (u, v) => {
    const n = fbm(u, v, 6, 4, 81, 0.5);
    const stain = fbm(u, v, 3, 3, 82, 0.5);
    const k = 0.82 + 0.22 * n - 0.12 * Math.max(0, stain - 0.55);
    return [206 * k, 178 * k, 128 * k];
  }, 0.2);
  const leafy = noiseTex(128, (u, v) => {
    const n = fbm(u, v, 24, 3, 85, 0.6);
    const k = 0.55 + 0.7 * n;
    return [38 * k, 62 * k, 26 * k];
  }, 0.03);
  const bamboo = toTexture(paint(32, 256, (u, v) => {
    const node = Math.abs(((v * 9) % 1) - 0.5) > 0.47 ? 0.62 : 1;
    const n = fbm(u, v, 2, 3, 87, 0.5, 30);
    const k = node * (0.85 + 0.25 * n);
    return [150 * k, 160 * k, 86 * k];
  }));
  const lam = (o, opts) => outdoor.apply(new THREE.MeshLambertMaterial(o), opts);
  const mossMat = lam({ map: moss, side: THREE.DoubleSide }, { sun: 0.75, lamp: true, earth: true });
  // large-scale variation over the moss (sun-bleached patches, darker hollows)
  const prev = mossMat.onBeforeCompile;
  mossMat.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec2 q = vGW.xz * 3.1;
        float m = sin(q.x * 1.7 + sin(q.y * 1.3)) * sin(q.y * 1.9 + sin(q.x * 0.7)) * 0.5 + 0.5;
        diffuseColor.rgb *= mix(vec3(0.72, 0.8, 0.7), vec3(1.15, 1.12, 0.92), m);
      }`);
  };
  const mk = mossMat.customProgramCacheKey.bind(mossMat);
  mossMat.customProgramCacheKey = () => `${mk()}-mossvar`;
  // stone: moss and lichen settle on the upward faces (the tops of rocks,
  // the lantern's roof, the basin's rim), patchy, never on the sides
  const stoneMat = lam({ map: stone }, { lamp: true, ao: 0.03 });
  const prevS = stoneMat.onBeforeCompile;
  stoneMat.onBeforeCompile = (shader, renderer) => {
    prevS(shader, renderer);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        float sh3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float sn3(vec3 p) { vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(sh3(i), sh3(i + vec3(1, 0, 0)), f.x), mix(sh3(i + vec3(0, 1, 0)), sh3(i + vec3(1, 1, 0)), f.x), f.y),
                     mix(mix(sh3(i + vec3(0, 0, 1)), sh3(i + vec3(1, 0, 1)), f.x), mix(sh3(i + vec3(0, 1, 1)), sh3(i + vec3(1, 1, 1)), f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 Ns = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
          float n = sn3(vGW * 140.0) * 0.6 + sn3(vGW * 420.0) * 0.4;
          float moss = smoothstep(0.5, 0.85, Ns.y) * smoothstep(0.42, 0.62, n);
          float lichen = smoothstep(0.66, 0.8, sn3(vGW * 900.0 + 7.0)) * (1.0 - moss);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.1, 0.15, 0.045) * (0.7 + 0.6 * n), moss);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.44, 0.36), lichen * 0.28);
          diffuseColor.rgb *= 0.88 + 0.24 * sn3(vGW * 1500.0);
        }`);
  };
  const sk = stoneMat.customProgramCacheKey.bind(stoneMat);
  stoneMat.customProgramCacheKey = () => `${sk()}-mossystone`;
  return {
    gMoss: mossMat,
    gStone: stoneMat,
    gGravel: lam({ map: gravel, side: THREE.DoubleSide }, { lamp: true, earth: true }),
    gPlaster: lam({ map: wallPlaster }, { ao: 0.05 }),
    gTile: lam({ color: 0x3a3c42 }, { spec: 0.5 }),
    gWood: lam({ map: textures.boards, color: 0xc8b8a8 }, { spec: 0.12 }),
    gDark: lam({ color: 0x2a1c14 }),
    gTrunk: lam({ color: 0x3a2e26, side: THREE.DoubleSide }, { ao: 0.08 }),
    gLeaf: lam({ color: 0xffffff, side: THREE.DoubleSide }, { translucent: 0.42, lamp: true }),
    gLitter: lam({ color: 0xffffff, side: THREE.DoubleSide }, { translucent: 0.1, lamp: true }),
    gShrub: lam({ map: leafy }, { sun: 0.8, lamp: true }),
    gHedge: lam({ map: leafy, color: 0xd8e0c8 }, { sun: 0.8 }),
    gBamboo: lam({ map: bamboo, side: THREE.DoubleSide }, { shadow: true }), // hollow culms, open at the cut
    gBambooLeaf: lam({ color: 0xffffff, side: THREE.DoubleSide }, { translucent: 0.5, shadow: true }),
    gCandle: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.6, 0.26).multiplyScalar(3.4) }),
    gFireBox: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.5, 0.18).multiplyScalar(0.55) }),
    gWater: waterMaterial(),
    gStream: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.45, 0.42), transparent: true, opacity: 0.7, depthWrite: false }),
    _textures: [bamboo],
  };
}

// Still water in the basin: the dusk sky mirrored by view angle (the camera's
// world position), rings spreading from where the spout's stream falls in.
function waterMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, drop: { value: new THREE.Vector2() }, sunToward: { value: SUN_DIR.clone().negate() } },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float time; uniform vec2 drop; uniform vec3 sunToward;
      varying vec3 vW;
      ${SKY_GLSL}
      void main() {
        vec2 d = vW.xz - drop;
        float r = length(d);
        float w = sin(r * 2600.0 - time * 9.0) * exp(-r * 260.0) + 0.35 * sin(r * 1700.0 - time * 6.0 + 1.3) * exp(-r * 140.0);
        vec3 N = normalize(vec3(d / max(r, 1e-4) * w * 0.12, 1.0).xzy);
        vec3 V = normalize(vW - cameraPosition);
        vec3 R = reflect(V, N);
        float fr = 0.02 + 0.98 * pow(max(1.0 - max(dot(-V, N), 0.0), 0.0), 5.0);
        vec3 sky = duskSky(normalize(vec3(R.x, max(R.y, 0.02), R.z)), sunToward);
        vec3 deep = vec3(0.012, 0.016, 0.013);
        gl_FragColor = vec4(mix(deep, sky * 1.1, fr), 1.0);
      }`,
  });
}

// One maple leaf: seven pointed lobes, about r across, facing +y.
export function leafGeometry(r, lobes = 7) {
  // palmate: broad lobes (wide at the middle, pointed tips), shallow sinuses,
  // the two lowest lobes small, a gap at the stalk
  const s = new THREE.Shape();
  const n = lobes;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a0 = -Math.PI * 0.62 + (Math.PI * 1.24 * (i + 0.5)) / n; // lobe axis, fanning round the top
    const len = r * (0.5 + 0.5 * Math.sin(((i + 0.5) / n) * Math.PI));
    const half = (Math.PI * 1.24) / n / 2;
    pts.push([a0 - half, r * 0.42]); // sinus
    pts.push([a0 - half * 0.5, len * 0.78]);
    pts.push([a0, len]); // tip
    pts.push([a0 + half * 0.5, len * 0.78]);
  }
  pts.push([Math.PI * 0.62, r * 0.42]);
  s.moveTo(0, -r * 0.12);
  for (const [a, rr] of pts) s.lineTo(Math.sin(a) * rr, Math.cos(a) * rr);
  s.lineTo(0, -r * 0.12);
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);
  g.deleteAttribute('uv');
  return g;
}

// Tapered tube along a smooth curve (trunk and branches): radius r0 -> r1.
function taperTube(points, r0, r1, seg = 12, radial = 7) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p))));
  const frames = curve.computeFrenetFrames(seg, false);
  const pos = [];
  const nrm = [];
  const idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const p = curve.getPointAt(t);
    const r = r0 + (r1 - r0) * t;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const wob = 1 + 0.1 * Math.sin(a * 3 + t * 13);
      const n = frames.normals[i].clone().multiplyScalar(Math.cos(a)).add(frames.binormals[i].clone().multiplyScalar(Math.sin(a)));
      pos.push(p.x + n.x * r * wob, p.y + n.y * r * wob, p.z + n.z * r * wob);
      nrm.push(n.x, n.y, n.z);
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j;
    const b = a + radial + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1); // outward-facing
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return { geo: g, curve };
}

// A flat stepping stone: an irregular, slightly domed slab with eased edges.
function slabGeometry(seed) {
  const r = rng(seed);
  const ph = [r() * 6, r() * 6, r() * 6];
  const g = new THREE.CylinderGeometry(1, 1, 1, 22, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 + 0.12 * Math.sin(a * 2 + ph[0]) + 0.07 * Math.sin(a * 3 + ph[1]) + 0.04 * Math.sin(a * 5 + ph[2]);
    const rad = Math.hypot(x, z);
    const top = y > 0.4;
    const edge = top && rad > 0.99 ? 0.9 : 1;
    p.setXYZ(i, x * k * edge, top ? 0.5 + 0.15 * (1 - rad * rad) - (rad > 0.99 ? 0.2 : 0) : y, z * k * edge);
  }
  g.computeVertexNormals();
  return g;
}

// A rough rock: a squashed, noised icosahedron.
function rockGeometry(seed, detail = 3) {
  // weld the seams first (uv and normal split them), or the random
  // displacement below opens cracks along them
  const ico = new THREE.IcosahedronGeometry(1, detail);
  ico.deleteAttribute('uv');
  ico.deleteAttribute('normal');
  const g = mergeVertices(ico);
  ico.dispose();
  const r = rng(seed);
  const p = g.attributes.position;
  const bumps = [0, 1, 2, 3].map(() => new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize());
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    let k = 1;
    for (const b of bumps) k += 0.12 * Math.max(0, v.dot(b));
    v.multiplyScalar(k * (0.92 + 0.12 * r()));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * The garden. Static parts go into the Builder (merged per material); the
 * instanced parts (leaves, litter, moss cushions, pebbles, bamboo) come back
 * as meshes for the caller to add.
 */
export function buildGarden(B, mats, { W, H }) {
  const ns = { cast: false, receive: false };
  const r = rng(33);
  const FL = -H / 2;
  const GY = FL - 0.035;
  const xo = -W / 2 - 0.02;
  const inst = [];
  const lamp = new THREE.Vector3();
  const pinePads = [];

  // ---------------- ground: moss over the terrace, a raked gravel bed with
  // three rocks, kerb stones round it
  const { x0, x1, z0, z1 } = TERRACE;
  const gx0 = x0 + 0.02;
  B.add('gMoss', mats.gMoss, new THREE.PlaneGeometry(x1 - gx0, z1 - z0), mat4([(gx0 + x1) / 2, GY, (z0 + z1) / 2], [-Math.PI / 2, 0, 0]), ns);
  const G = SPOTS.gravel;
  B.add('gGravel', mats.gGravel, new THREE.PlaneGeometry(G.x1 - G.x0, G.z1 - G.z0), mat4([(G.x0 + G.x1) / 2, GY + 0.0012, (G.z0 + G.z1) / 2], [-Math.PI / 2, 0, 0]), ns);
  for (let x = G.x0; x < G.x1 - 0.005; x += 0.028) {
    for (const z of [G.z0, G.z1]) B.add('gStone', mats.gStone, boxUV(0.026, 0.006, 0.01, 0.05), mat4([x + 0.014, GY + 0.002, z], [0, (r() - 0.5) * 0.08, 0]), ns);
  }
  for (let z = G.z0 + 0.01; z < G.z1 - 0.005; z += 0.028) {
    for (const x of [G.x0, G.x1]) B.add('gStone', mats.gStone, boxUV(0.01, 0.006, 0.026, 0.05), mat4([x, GY + 0.002, z + 0.014], [0, (r() - 0.5) * 0.08, 0]), ns);
  }
  for (const [x, z, s, h] of [[-1.08, -0.2, 0.034, 0.9], [-1.0, -0.15, 0.018, 0.7], [-0.92, -0.22, 0.024, 0.6]]) {
    B.add('gStone', mats.gStone, rockGeometry(Math.floor(x * 100)), mat4([x, GY + s * 0.25, z], [r() * 0.3, r() * 6, 0], [s * 1.2, s * h * 1.3, s]), ns);
  }

  // ---------------- stepping stones from the step stone to the basin and on
  // round the lantern toward the maple
  const path = [[-0.345, -0.094], [-0.39, -0.112], [-0.44, -0.124], [-0.5, -0.118], [-0.56, -0.11], [-0.63, -0.118], [-0.7, -0.148], [-0.76, -0.19], [-0.81, -0.245], [-0.85, -0.305], [-0.415, -0.17], [-0.438, -0.235]];
  path.forEach(([x, z], i) => {
    const s = 0.016 + r() * 0.005;
    B.add('gStone', mats.gStone, slabGeometry(40 + i), mat4([x, GY + 0.0005, z], [0, r() * 3, 0], [s, 0.006, s * (0.78 + r() * 0.3)]), ns);
  });

  // ---------------- the tsukubai: a round stone basin with water, the
  // front stone to crouch on, two side stones, pebbles in the "sea" round
  // it, a bamboo spout on a post pouring in from behind
  const [bx, bz] = SPOTS.basin;
  const lathe = (pts, seg = 20) => new THREE.LatheGeometry(pts.map(([rr, y]) => new THREE.Vector2(rr, y)), seg);
  // the sea: a shallow hollow of dark pebbles
  B.add('gStone', mats.gStone, new THREE.CircleGeometry(0.06, 24), mat4([bx, GY + 0.0006, bz], [-Math.PI / 2, 0, 0], [1.2, 1, 1]), ns);
  B.add('gStone', mats.gStone, lathe([[0, 0], [0.024, 0], [0.027, 0.004], [0.026, 0.018], [0.024, 0.026], [0.021, 0.0288], [0.0145, 0.0282], [0.0128, 0.0245], [0.011, 0.021], [0, 0.02]], 28), mat4([bx, GY, bz]), ns);
  const water = new THREE.Mesh(new THREE.CircleGeometry(0.0128, 28), mats.gWater);
  water.rotation.x = -Math.PI / 2;
  water.position.set(bx, GY + 0.0243, bz);
  water.name = 'gWater';
  water.updateMatrix();
  water.matrixAutoUpdate = false;
  inst.push(water);
  mats.gWater.uniforms.drop.value.set(bx - 0.004, bz - 0.003);
  for (const [dx, dz, s, h] of [[0.045, 0.04, 0.026, 0.45], [-0.052, 0.012, 0.02, 0.9], [0.05, -0.03, 0.018, 0.7]]) {
    B.add('gStone', mats.gStone, rockGeometry(Math.floor(dx * 1000 + 7)), mat4([bx + dx, GY + s * h * 0.35, bz + dz], [0, r() * 6, 0], [s * 1.3, s * h, s]), ns);
  }
  // the spout: a bamboo pipe from a bamboo post behind the basin, angled down
  const spoutBase = new THREE.Vector3(bx - 0.03, GY + 0.05, bz - 0.04);
  const spoutTip = new THREE.Vector3(bx - 0.006, GY + 0.043, bz - 0.006);
  B.cyl('gBamboo', mats.gBamboo, 0.0035, 0.0035, 0.055, [spoutBase.x - 0.004, GY + 0.0275, spoutBase.z - 0.004], [0, 0, 0], 10, ns);
  {
    // the spout pipe, closed at its ends (a node at the cut, as cut bamboo is)
    const A = spoutBase.clone().add(new THREE.Vector3(-0.012, 0.004, -0.012));
    const len = A.distanceTo(spoutTip);
    const g = new THREE.CylinderGeometry(0.0022, 0.0022, len, 10, 1, false);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), spoutTip.clone().sub(A).normalize());
    B.add('gBamboo', mats.gBamboo, g, new THREE.Matrix4().compose(A.clone().add(spoutTip).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)), ns);
  }
  const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.0006, 0.0005, spoutTip.y - (GY + 0.0243), 6, 1, true), mats.gStream);
  stream.position.set(spoutTip.x + 0.001, (spoutTip.y + GY + 0.0243) / 2, spoutTip.z + 0.001);
  stream.name = 'gStream';
  stream.updateMatrix();
  stream.matrixAutoUpdate = false;
  inst.push(stream);
  mats.gWater.uniforms.drop.value.set(spoutTip.x + 0.001, spoutTip.z + 0.001);

  // ---------------- the stone lantern (kasuga style): base, hexagonal
  // column, platform, the fire box with its paper windows lit, the curled
  // umbrella roof, the jewel
  const [lx, lz] = SPOTS.lantern;
  const T = mat4([lx, GY, lz], [0, 0.4, 0]);
  const at = (y, rot = [0, 0, 0]) => new THREE.Matrix4().multiplyMatrices(T, mat4([0, y, 0], rot));
  B.add('gStone', mats.gStone, lathe([[0, 0], [0.03, 0], [0.0305, 0.002], [0.03, 0.008], [0.024, 0.012], [0.019, 0.0145], [0.016, 0.016], [0, 0.016]], 28), at(0), ns);
  B.add('gStone', mats.gStone, lathe([[0.0095, 0], [0.009, 0.03], [0.0085, 0.062]], 24), at(0.016), ns);
  B.add('gStone', mats.gStone, lathe([[0, 0], [0.012, 0], [0.02, 0.005], [0.026, 0.009], [0.0265, 0.012], [0.025, 0.014], [0, 0.014]], 28), at(0.078), ns);
  // the fire box: a hexagonal stone box, its paper windows lit from within
  // (a square one front and back, a round "moon" at two sides)
  const fy = 0.092;
  const fh = 0.03;
  const apo = 0.016 * Math.cos(Math.PI / 6);
  B.add('gStone', mats.gStone, new THREE.CylinderGeometry(0.016, 0.016, fh, 6, 1), at(fy + fh / 2, [0, Math.PI / 6, 0]), ns);
  for (const k of [0, 3]) {
    const a = (k / 6) * Math.PI * 2;
    B.add('gCandle', mats.gCandle, new THREE.PlaneGeometry(0.0095, 0.014), new THREE.Matrix4().multiplyMatrices(at(fy + fh / 2 + 0.001, [0, a, 0]), mat4([0, 0, apo + 0.0004])), ns);
  }
  for (const k of [1, 4]) {
    const a = (k / 6) * Math.PI * 2;
    B.add('gFireBox', mats.gFireBox, new THREE.CircleGeometry(0.0042, 16), new THREE.Matrix4().multiplyMatrices(at(fy + fh / 2 + 0.002, [0, a, 0]), mat4([0, 0, apo + 0.0004])), ns);
  }
  // the umbrella roof with its curled corners, the jewel on top
  B.add('gStone', mats.gStone, lathe([[0, 0], [0.044, 0], [0.047, 0.004], [0.038, 0.007], [0.02, 0.019], [0.008, 0.025], [0, 0.025]], 6), at(fy + fh), ns);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    B.add('gStone', mats.gStone, new THREE.SphereGeometry(0.0045, 6, 4), new THREE.Matrix4().multiplyMatrices(at(fy + fh + 0.007, [0, a, 0]), mat4([0.045, 0, 0])), ns);
  }
  B.add('gStone', mats.gStone, lathe([[0, 0], [0.006, 0.002], [0.0075, 0.008], [0.004, 0.014], [0, 0.017]], 10), at(fy + fh + 0.024), ns);
  lamp.set(lx, GY + fy + 0.012, lz);

  // ---------------- the maple: a leaning trunk, branches forking out in
  // layers, the leaves in flat sprays at their ends (instanced)
  const [mx, mz] = SPOTS.maple;
  const twigEnds = [];
  const branch = (p, dir, len, rad, depth) => {
    const bend = new THREE.Vector3((r() - 0.5) * 0.3, 0.12 + r() * 0.1, (r() - 0.5) * 0.3);
    const mid = p.clone().addScaledVector(dir, len * 0.5).addScaledVector(bend, len * 0.25);
    const end = p.clone().addScaledVector(dir, len).addScaledVector(bend, len * 0.15);
    // the last twigs taper to a point (blunt ends read as dark specks end-on)
    const t = taperTube([p, mid, end], rad, depth === 0 ? rad * 0.15 : rad * 0.62, depth > 1 ? 10 : 6, depth > 1 ? 7 : 5);
    B.add('gTrunk', mats.gTrunk, t.geo, null, ns);
    if (depth === 0) { twigEnds.push({ p: end, dir: dir.clone(), along: t.curve }); return; }
    const n = depth >= 3 ? 3 : 2 + (r() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const az = (i / n) * Math.PI * 2 + r() * 1.2;
      const out = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
      // spread outward, flatter with each fork (the layered maple crown)
      const nd = dir.clone().multiplyScalar(0.45).addScaledVector(out, 0.75 + 0.15 * (3 - depth)).add(new THREE.Vector3(0, 0.25 - 0.06 * (3 - depth), 0)).normalize();
      branch(end, nd, len * (0.72 + r() * 0.12), rad * 0.62, depth - 1);
    }
  };
  const trunkTop = new THREE.Vector3(mx + 0.03, GY + 0.1, mz + 0.012);
  const trunk = taperTube([[mx, GY - 0.004, mz], [mx + 0.006, GY + 0.04, mz + 0.004], [mx + 0.02, GY + 0.075, mz + 0.01], trunkTop], 0.0075, 0.005, 14, 9);
  B.add('gTrunk', mats.gTrunk, trunk.geo, null, ns);
  // root flare
  B.add('gTrunk', mats.gTrunk, new THREE.CylinderGeometry(0.007, 0.013, 0.012, 9, 1, true), mat4([mx, GY + 0.004, mz]), ns);
  branch(trunkTop, new THREE.Vector3(0.35, 1, 0.1).normalize(), 0.07, 0.0048, 4);
  branch(trunkTop.clone().add(new THREE.Vector3(-0.004, -0.02, 0)), new THREE.Vector3(-0.7, 0.8, -0.2).normalize(), 0.062, 0.0036, 3);
  branch(trunkTop.clone().add(new THREE.Vector3(0.002, -0.035, 0.002)), new THREE.Vector3(0.6, 0.55, 0.55).normalize(), 0.058, 0.0032, 3);
  branch(trunkTop.clone().add(new THREE.Vector3(0.0, -0.03, -0.003)), new THREE.Vector3(0.3, 0.6, -0.75).normalize(), 0.055, 0.003, 3);
  const leafGeo = leafGeometry(0.0034);
  const leaves = [];
  const centre = new THREE.Vector3(mx + 0.04, GY + 0.22, mz + 0.01);
  for (const tw of twigEnds) {
    const N = 120 + Math.floor(r() * 50);
    // a flat spray around the twig's end, drooping at its edge
    const fwd = new THREE.Vector3(tw.dir.x, 0, tw.dir.z).normalize();
    const side = new THREE.Vector3(-fwd.z, 0, fwd.x);
    for (let i = 0; i < N; i++) {
      const u = (r() - 0.35) * 0.085;
      const v = (r() - 0.5) * 0.08 * (1 - Math.abs(u) * 5);
      const rad = Math.hypot(u, v);
      const p = tw.p.clone().addScaledVector(fwd, u).addScaledVector(side, v);
      p.y += (r() - 0.5) * 0.012 - rad * rad * 6;
      leaves.push(p);
    }
  }
  const lm = new THREE.InstancedMesh(leafGeo, mats.gLeaf, leaves.length);
  const M = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const c = new THREE.Color();
  const reds = [[0.34, 0.012, 0.008], [0.42, 0.022, 0.01], [0.5, 0.05, 0.012], [0.56, 0.12, 0.018], [0.52, 0.24, 0.03], [0.3, 0.26, 0.04]];
  leaves.forEach((p, i) => {
    e.set((r() - 0.5) * 0.9, r() * 6.28, (r() - 0.5) * 0.9);
    q.setFromEuler(e);
    const s = 0.75 + r() * 0.5;
    M.compose(p, q, new THREE.Vector3(s, s, s));
    lm.setMatrixAt(i, M);
    // the outer, sunlit leaves deepest red; inside and low, orange to amber
    const outer = Math.min(1, p.distanceTo(centre) / 0.2);
    const hi = (p.y - GY) / 0.3;
    const kk = Math.max(0, Math.min(5, Math.floor((1 - outer * 0.7 - hi * 0.35) * 5 + r() * 2.2)));
    c.setRGB(...reds[kk]).multiplyScalar(0.85 + 0.3 * r());
    lm.setColorAt(i, c);
  });
  lm.name = 'gLeaf';
  lm.computeBoundingSphere();
  inst.push(lm);
  // fallen leaves on the moss, the stones and the engawa
  const fallen = [];
  for (let i = 0; i < 520; i++) {
    let x; let z; let y = GY + 0.0012;
    if (i < 360) {
      const a = r() * 6.28;
      const d = Math.sqrt(r()) * 0.32;
      x = mx + 0.12 + Math.cos(a) * d * 1.3; z = mz + 0.05 + Math.sin(a) * d;
    } else if (i < 470) { x = -0.3 - r() * 0.5; z = -r() * 0.5; } else {
      x = xo - 0.075 * r(); z = -r() * 0.5; y = FL + 0.0006;
    }
    if (x < TERRACE.x0 + 0.04 || z > -0.02) continue;
    if (x > xo - 0.075 && y < FL) continue;
    fallen.push([x, y, z]);
  }
  const fm = new THREE.InstancedMesh(leafGeo, mats.gLitter, fallen.length);
  fallen.forEach(([x, y, z], i) => {
    e.set((r() - 0.5) * 0.25, r() * 6.28, (r() - 0.5) * 0.25);
    q.setFromEuler(e);
    M.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1).multiplyScalar(0.8 + r() * 0.4));
    fm.setMatrixAt(i, M);
    c.setRGB(...reds[Math.floor(r() * 5)]).multiplyScalar(0.55 + 0.25 * r());
    fm.setColorAt(i, c);
  });
  fm.name = 'gLitter';
  fm.computeBoundingSphere();
  inst.push(fm);

  // ---------------- moss cushions round the stones, the lantern and the trunk
  const cushions = [];
  const around = [[lx, lz, 0.05, 6], [bx, bz, 0.08, 6], [mx, mz, 0.06, 7], [-1.0, -0.42, 0.18, 10], [-0.95, -0.85, 0.3, 14], [-0.45, -0.6, 0.18, 10], [-0.65, -0.05, 0.12, 6]];
  for (const [cx, cz, rad, n] of around) {
    for (let i = 0; i < n; i++) {
      const a = r() * 6.28;
      const d = rad * (0.6 + 0.6 * r());
      cushions.push([cx + Math.cos(a) * d, cz + Math.sin(a) * d, 0.012 + r() * 0.03]);
    }
  }
  const cgeo = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const cm = new THREE.InstancedMesh(cgeo, mats.gMoss, cushions.length);
  cushions.forEach(([x, z, s], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
    M.compose(new THREE.Vector3(x, GY - s * 0.05, z), q, new THREE.Vector3(s * 1.4, s * (0.28 + 0.12 * r()), s));
    cm.setMatrixAt(i, M);
  });
  cm.name = 'gMoss';
  cm.computeBoundingSphere();
  inst.push(cm);

  // ---------------- clipped azaleas (karikomi): bumpy rounded mounds
  const shrubGeo = (() => {
    const ico = new THREE.IcosahedronGeometry(1, 3);
    ico.deleteAttribute('uv');
    ico.deleteAttribute('normal');
    const g = mergeVertices(ico); // welded, so the clipped mounds shade smooth
    ico.dispose();
    const p = g.attributes.position;
    const rr = rng(9);
    const bumps = Array.from({ length: 9 }, () => new THREE.Vector3(rr() - 0.5, rr() * 0.6, rr() - 0.5).normalize());
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      let k = 0.9;
      for (const b of bumps) k += 0.09 * Math.max(0, v.dot(b)) ** 3;
      v.multiplyScalar(k);
      if (v.y < 0) v.y *= 0.3;
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
  })();
  const shrubs = [[-0.68, -0.37, 0.034], [-0.55, -0.36, 0.028], [-1.26, -0.5, 0.06], [-1.25, -0.72, 0.07], [-1.22, -0.95, 0.055], [-0.9, -1.22, 0.07], [-0.6, -1.24, 0.06], [-0.32, -0.92, 0.05], [-0.37, -0.33, 0.024], [-1.2, -0.38, 0.04], [0.62, -0.3, 0.05], [0.7, -0.6, 0.06], [-0.31, -0.48, 0.03]];
  const sm = new THREE.InstancedMesh(shrubGeo, mats.gShrub, shrubs.length);
  shrubs.forEach(([x, z, s], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
    M.compose(new THREE.Vector3(x, GY, z), q, new THREE.Vector3(s * 1.25, s * 0.85, s));
    sm.setMatrixAt(i, M);
  });
  sm.name = 'gShrub';
  sm.computeBoundingSphere();
  inst.push(sm);
  const pm = new THREE.InstancedMesh(shrubGeo, mats.gShrub, pinePads.length);
  pinePads.forEach(([p, sz], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
    M.compose(new THREE.Vector3(p[0], p[1] - sz * 0.15, p[2]), q, new THREE.Vector3(sz * 1.5, sz * 0.55, sz * 1.25));
    pm.setMatrixAt(i, M);
    pm.setColorAt(i, c.setRGB(0.42, 0.55, 0.36));
  });
  pm.name = 'gPine';
  pm.computeBoundingSphere();
  inst.push(pm);

  // ---------------- a small pruned pine by the engawa: its lowest pad sits
  // in the corner of the engawa's view, a near layer for head moves
  {
    const P = [-0.37, GY, -0.41];
    const pine = taperTube([[P[0], GY - 0.003, P[2]], [P[0] + 0.012, GY + 0.035, P[2] + 0.03], [P[0] - 0.004, GY + 0.07, P[2] + 0.07], [P[0] + 0.018, GY + 0.1, P[2] + 0.1]], 0.0048, 0.0022, 14, 8);
    B.add('gTrunk', mats.gTrunk, pine.geo, null, ns);
    const pads = [[0.03, 0.056, 0.115, 0.028], [-0.012, 0.072, 0.06, 0.022], [0.026, 0.098, 0.094, 0.02], [0.006, 0.12, 0.11, 0.016], [-0.02, 0.04, 0.03, 0.018]];
    for (const [dx, dy, dz, sz] of pads) {
      const end = [P[0] + dx, GY + dy, P[2] + dz];
      const t0 = pine.curve.getPointAt(Math.min(0.95, dy / 0.12));
      B.add('gTrunk', mats.gTrunk, taperTube([t0, [(t0.x + end[0]) / 2, (t0.y + end[1]) / 2 + 0.004, (t0.z + end[2]) / 2], end], 0.0016, 0.0009, 6, 5).geo, null, ns);
      pinePads.push([end, sz]);
    }
  }

  // ---------------- the low hedge along the terrace's edge (the valley side)
  const hedge = (xa, xb) => {
    const len = xb - xa;
    B.add('gHedge', mats.gHedge, boxUV(len, 0.026, 0.026, 0.05), mat4([(xa + xb) / 2, GY + 0.013, -0.017]), ns);
    B.add('gHedge', mats.gHedge, new THREE.CylinderGeometry(0.013, 0.013, len, 10, 1, false, 0, Math.PI), mat4([(xa + xb) / 2, GY + 0.026, -0.017], [0, 0, Math.PI / 2]), ns);
  };
  hedge(x0 + 0.03, xo - 0.075 - 0.04);
  hedge(W / 2 + 0.36, x1 - 0.03);

  // ---------------- the garden walls: plaster on a stone footing under a tiled cap
  const wall = (ax, az, bx2, bz2) => {
    const len = Math.hypot(bx2 - ax, bz2 - az);
    const rot = -Math.atan2(bz2 - az, bx2 - ax);
    const cxw = (ax + bx2) / 2;
    const czw = (az + bz2) / 2;
    const hgt = 0.11;
    B.add('gStone', mats.gStone, boxUV(len, 0.014, 0.036, 0.05), mat4([cxw, GY + 0.007, czw], [0, rot, 0]), ns);
    B.add('gPlaster', mats.gPlaster, boxUV(len, hgt - 0.014, 0.03, 0.2), mat4([cxw, GY + 0.014 + (hgt - 0.014) / 2, czw], [0, rot, 0]), ns);
    // horizontal lines and the cap
    for (const s of [-1, 1]) B.add('gTile', mats.gTile, boxUV(len + 0.01, 0.004, 0.032, 0.05), mat4([cxw, GY + hgt + 0.006, czw], [0, rot, 0]).multiply(mat4([0, 0, s * 0.012], [s * 0.45, 0, 0])), ns);
    B.add('gTile', mats.gTile, new THREE.CylinderGeometry(0.006, 0.006, len + 0.012, 8), mat4([cxw, GY + hgt + 0.013, czw], [0, rot, Math.PI / 2]), ns);
    B.add('gDark', mats.gDark, boxUV(len, 0.004, 0.034), mat4([cxw, GY + hgt - 0.002, czw], [0, rot, 0]), ns);
  };
  wall(x0, 0.0, x0, z0);
  wall(x0, z0, x1, z0);
  wall(x1, z0, x1, 0.0);

  // ---------------- a bamboo grove behind the house: culms with nodes,
  // leaves in feathery sprays high up (instanced)
  const culms = [];
  for (let i = 0; i < 400 && culms.length < 70; i++) {
    const x = -0.28 + r() * 1.1;
    const z = -1.28 + r() * 0.62;
    if (z > -0.62) continue;
    if (Math.abs(x) < 0.16 && r() < 0.85) continue; // the round window looks out through a clearing
    if (culms.some(([a, b]) => Math.hypot(a - x, b - z) < 0.035)) continue;
    culms.push([x, z, 0.5 + r() * 0.35, 0.0035 + r() * 0.002, (r() - 0.5) * 0.08, (r() - 0.5) * 0.08]);
  }
  const cg = new THREE.CylinderGeometry(1, 1, 1, 7, 1, true);
  cg.translate(0, 0.5, 0);
  const bm = new THREE.InstancedMesh(cg, mats.gBamboo, culms.length);
  const bl = [];
  culms.forEach(([x, z, h, rad, tx, tz], i) => {
    e.set(tz, 0, -tx);
    q.setFromEuler(e);
    M.compose(new THREE.Vector3(x, GY - 0.01, z), q, new THREE.Vector3(rad, h, rad));
    bm.setMatrixAt(i, M);
    c.setRGB(0.55 + 0.25 * r(), 0.62 + 0.2 * r(), 0.32);
    bm.setColorAt(i, c);
    const top = new THREE.Vector3(0, h, 0).applyQuaternion(q).add(new THREE.Vector3(x, GY - 0.01, z));
    const base = new THREE.Vector3(x, GY - 0.01, z);
    for (let k = 0; k < 55; k++) {
      const t = 0.55 + 0.45 * r();
      const p = base.clone().lerp(top, t);
      const a = r() * 6.28;
      const d = 0.01 + 0.05 * r() * (1.2 - t);
      p.x += Math.cos(a) * d; p.z += Math.sin(a) * d; p.y -= d * 0.4;
      bl.push([p, a]);
    }
  });
  bm.name = 'gBamboo';
  bm.computeBoundingSphere();
  inst.push(bm);
  const blade = new THREE.PlaneGeometry(0.0028, 0.018);
  blade.rotateX(-Math.PI / 2 + 0.5);
  blade.translate(0, -0.003, 0.008);
  const blm = new THREE.InstancedMesh(blade, mats.gBambooLeaf, bl.length);
  bl.forEach(([p, a], i) => {
    e.set((r() - 0.5) * 0.6, a, (r() - 0.5) * 0.4);
    q.setFromEuler(e);
    M.compose(p, q, new THREE.Vector3(1, 1, 1).multiplyScalar(0.8 + 0.5 * r()));
    blm.setMatrixAt(i, M);
    c.setRGB(0.22 + 0.14 * r(), 0.32 + 0.12 * r(), 0.07);
    blm.setColorAt(i, c);
  });
  blm.name = 'gBambooLeaf';
  blm.computeBoundingSphere();
  inst.push(blm);
  return { instanced: inst, lamp };
}

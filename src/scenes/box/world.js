// The world around the Box's house, so the window can be carried out of the
// room and still see a finished place in every direction: the house stands
// on a stone terrace (the garden is on it, west of the house) at the edge of
// a valley; the terrace drops to the valley in a battered stone wall
// (ishigaki) along its south edge, flush with the room's open front, so the
// space in front of the window stays empty air (the room's own view is
// unchanged). Beyond the garden walls the ground rises into wooded hills to
// the north and east and falls away gently to the west, toward the sunset;
// two rings of ridges close the horizon all round under a dusk sky dome.
//
// Scene metres (the room is the window's size, about 1:12). The ground of
// the terrace is GY (35 mm under the room's floor).

import * as THREE from 'three';
import { SUN_DIR, SKY_GLSL, FAR_GLSL } from './outdoor.js';
import { rng, fbm, vnoise, paint, toTexture } from '../_lib/textures.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// The terrace (the garden and the house stand on it), its south edge at z = 0.
export const TERRACE = { x0: -1.38, x1: 0.86, z0: -1.34, z1: 0.0 };
export const VALLEY_Y = -0.78; // the valley floor under the stone wall
export const WALL_RUN = 0.06; // the stone wall's batter (z run from top to foot)
const CENTRE = [-0.25, -0.5];

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// non-periodic fBm over world metres (f: cells per metre), -1..1
export function n2(x, z, f, seed) {
  let s = 0; let a = 0.5; let n = 0; let k = f;
  for (let o = 0; o < 4; o++) { s += a * vnoise(x * k + 1000, z * k + 1000, 1 << 20, 1 << 20, seed + o * 17); n += a; a *= 0.5; k *= 2; }
  return (s / n) * 2 - 1;
}

/** Ground height outside the garden (the terrace itself returns gy - 0.004, under the garden's own ground). */
export function groundHeight(x, z, gy) {
  const { x0, x1, z0, z1 } = TERRACE;
  const dx = Math.max(x0 - x, 0, x - x1);
  const dzN = Math.max(z0 - z, 0);
  const d = Math.hypot(dx, dzN);
  // hills beyond the walls: up to the north and east, a gentler slope to the west
  const west = smooth(0, 1, x0 - x);
  // high to the north and north-east, low toward the valley in the south-east
  const behind = (1 - smooth(0.35, 1.4, Math.abs(x))) * smooth(-0.1, 0.4, z0 - z);
  const amp = (0.62 - 0.38 * west) * (1 - 0.75 * smooth(-0.9, 0.3, z)) * (1 - 0.62 * behind);
  let hill = gy - 0.004 + amp * smooth(0.02, 2.4, d) + 0.05 * smooth(0.1, 1, d) * n2(x, z, 6, 11) + 0.12 * smooth(0.6, 3, d) * n2(x, z, 2.2, 12);
  // the stone wall and the valley to the south
  if (z > z1) {
    const inX = 1 - smooth(0, 0.5, dx); // the vertical wall only under the terrace
    const run = WALL_RUN + (1 - inX) * 0.9;
    const t = smooth(0, run, z - z1);
    const tWall = inX > 0.5 ? Math.min(1, (z - z1) / WALL_RUN) : t;
    const valley = VALLEY_Y + 0.02 * n2(x, z, 9, 13) + 0.95 * smooth(2.2, 5.2, z) * (0.75 + 0.25 * n2(x, z, 1.5, 14)) + 0.5 * smooth(1.6, 4.5, Math.abs(x + 0.25));
    hill = hill + (Math.min(valley, hill) - hill) * (inX > 0.5 ? tWall : t);
  }
  return hill;
}

// Non-uniform grid lines: fine over the terrace and its edges, growing outward.
function gridLines(a, b, fine, lim) {
  const out = [];
  for (let v = a; v <= b + 1e-9; v += fine) out.push(+v.toFixed(5));
  let step = fine;
  for (let v = b; v < lim;) { step *= 1.18; v += step; out.push(Math.min(v, lim)); }
  step = fine;
  for (let v = a; v > -lim;) { step *= 1.18; v -= step; out.unshift(Math.max(v, -lim)); }
  return out;
}

function terrainTexture() {
  // forest floor / grass detail, tiled in metres by the shader
  const t = toTexture(paint(256, 256, (u, v) => {
    const n = fbm(u, v, 12, 4, 91, 0.55);
    const m = fbm(u, v, 3, 3, 92, 0.5);
    const k = 0.7 + 0.5 * n;
    return [120 * k * (0.9 + 0.2 * m), 120 * k, 120 * k * (0.85 + 0.2 * (1 - m))];
  }));
  return t;
}

export function createWorldMaterials(outdoor) {
  const detail = terrainTexture();
  const terrain = outdoor.apply(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), { fog: true, sun: 0.9, earth: true, farClamp: true });
  // world-space detail texture and the stone wall's courses on steep faces
  const prev = terrain.onBeforeCompile;
  terrain.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    shader.uniforms.tDetail = { value: detail };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tDetail;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 Ng = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
          float steep = 1.0 - smoothstep(0.35, 0.6, Ng.y);
          vec3 det = texture2D(tDetail, vGW.xz / 0.25).rgb * 2.0;
          diffuseColor.rgb *= mix(vec3(1.0), det, 0.55);
          // ishigaki: stone courses with staggered joints on the steep faces
          float row = vGW.y / 0.024;
          float ri = floor(row);
          float along = (vGW.x + 0.5 * vGW.z) / 0.034 + ri * 0.47 + fract(sin(ri * 12.9898) * 43758.5) * 0.6;
          float jr = smoothstep(0.0, 0.08, fract(row)) * smoothstep(1.0, 0.92, fract(row));
          float jc = smoothstep(0.0, 0.06, fract(along)) * smoothstep(1.0, 0.94, fract(along));
          float tone = 0.75 + 0.35 * fract(sin(dot(vec2(ri, floor(along)), vec2(12.99, 78.23))) * 43758.5);
          vec3 stone = vec3(0.42, 0.40, 0.37) * tone * mix(0.25, 1.0, jr * jc);
          diffuseColor.rgb = mix(diffuseColor.rgb, stone * det, steep);
        }`);
  };
  const prevKey = terrain.customProgramCacheKey.bind(terrain);
  terrain.customProgramCacheKey = () => `${prevKey()}-terrain`;
  const tree = outdoor.apply(new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), { fog: true, sun: 0.4, shadow: false, farClamp: true });
  // leafy clumps: world-space noise darkens the gaps between clumps, the
  // crowns darker underneath, so a tree reads as foliage, not a smooth blob
  const prevT = tree.onBeforeCompile;
  tree.onBeforeCompile = (shader, renderer) => {
    prevT(shader, renderer);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        float th3(vec3 p) { return fract(sin(dot(p, vec3(17.1, 113.7, 41.3))) * 43758.5453); }
        float tn3(vec3 p) { vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(th3(i), th3(i + vec3(1, 0, 0)), f.x), mix(th3(i + vec3(0, 1, 0)), th3(i + vec3(1, 1, 0)), f.x), f.y),
                     mix(mix(th3(i + vec3(0, 0, 1)), th3(i + vec3(1, 0, 1)), f.x), mix(th3(i + vec3(0, 1, 1)), th3(i + vec3(1, 1, 1)), f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float n = tn3(vGW * 55.0) * 0.6 + tn3(vGW * 140.0) * 0.4;
          diffuseColor.rgb *= mix(0.3, 1.25, smoothstep(0.3, 0.75, n));
        }`);
  };
  const prevTK = tree.customProgramCacheKey.bind(tree);
  tree.customProgramCacheKey = () => `${prevTK()}-leafy`;
  return {
    wTerrain: terrain,
    wTree: tree,
    wTrunk: outdoor.apply(new THREE.MeshLambertMaterial({ color: 0x2a221c }), { fog: true, shadow: false, farClamp: true }),
    wStar: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.95, 0.85).multiplyScalar(30) }),
    wRidge: ridgeMaterial(),
    wSky: skyMaterial(),
    _textures: [detail],
  };
}

// Distant ridges: flat silhouettes, dark and warm toward the sunset, lit
// blue-grey with a pink top to the east, misty at their feet.
function ridgeMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { sunToward: { value: SUN_DIR.clone().negate() } },
    vertexShader: /* glsl */ `
      attribute float aTop;
      attribute float aRing;
      varying vec3 vW; varying float vTop; varying float vRing;
      ${FAR_GLSL}
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz; vTop = aTop; vRing = aRing;
        gl_Position = projectionMatrix * viewMatrix * w;
        gl_Position.z = farClampZ(gl_Position); // the hills close the world at any far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 sunToward;
      varying vec3 vW; varying float vTop; varying float vRing;
      ${SKY_GLSL}
      void main() {
        vec3 dv = vW - cameraPosition;
        vec2 h = normalize(vW.xz - vec2(${CENTRE[0].toFixed(3)}, ${CENTRE[1].toFixed(3)}));
        float west = clamp(0.5 + 0.5 * dot(h, normalize(sunToward.xz)), 0.0, 1.0);
        vec3 lit = mix(vec3(0.034, 0.032, 0.052), vec3(0.016, 0.012, 0.016), pow(west, 1.5));
        // the low sun catches the eastern summits a little
        float crest = smoothstep(-0.12, 0.0, vW.y - vTop);
        lit += vec3(0.03, 0.014, 0.014) * (1.0 - west) * crest;
        lit = mix(lit, lit * 1.5 + vec3(0.02, 0.02, 0.045), vRing);
        // a little mist at the feet, toward the horizon colour; the far ring hazier
        vec3 sky = duskSky(normalize(vec3(dv.x, 0.0, dv.z)), sunToward);
        float mist = (1.0 - smoothstep(vTop - 0.6, vTop - 0.12, vW.y)) * 0.3 + 0.5 * vRing * vRing;
        vec3 c = mix(lit, sky * 0.85, mist);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { sunToward: { value: SUN_DIR.clone().negate() } },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        // centred on the eye and drawn at the far plane: the sky is there at
        // any far plane and any distance from the house
        vec4 w = vec4(cameraPosition + normalize((modelMatrix * vec4(position, 1.0)).xyz) * 9.0, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
        gl_Position.z = gl_Position.w * 0.99999;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 sunToward;
      varying vec3 vW;
      ${SKY_GLSL}
      float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        vec3 d = normalize(vW - cameraPosition);
        vec3 c = duskSky(d, sunToward);
        // thin streaks of cloud low in the west, lit from below
        float az = atan(d.z, d.x);
        float el = d.y;
        vec2 p = vec2(az * 16.0, el * 110.0);
        float cl = vn(p) * 0.5 + vn(p * vec2(2.3, 1.7) + 7.0) * 0.3 + vn(p * vec2(5.1, 3.3) + 3.0) * 0.2;
        cl = smoothstep(0.55, 0.8, cl) * smoothstep(0.02, 0.06, el) * (1.0 - smoothstep(0.12, 0.22, el));
        vec2 hz = normalize(d.xz + vec2(1e-5));
        float west = clamp(0.5 + 0.5 * dot(hz, normalize(sunToward.xz)), 0.0, 1.0);
        c = mix(c, mix(vec3(0.06, 0.04, 0.07), vec3(1.1, 0.45, 0.25), pow(west, 3.0)), cl * 0.8);
        // the first stars where the sky is darkest: points (a fixed angular
        // size), one at most per cell of the sky
        vec2 sp = vec2(az, el) * 160.0;
        vec2 cell = floor(sp);
        float hs = h21(cell);
        vec2 at = cell + 0.2 + 0.6 * vec2(h21(cell + 3.1), h21(cell + 7.7));
        float dd = length((sp - at) * vec2(cos(el), 1.0)) / 160.0;
        float st = step(0.968, hs) * (1.0 - smoothstep(0.0003, 0.0007, dd)) * smoothstep(0.3, 0.75, el) * (0.4 + 0.6 * h21(cell + 11.0));
        c += vec3(0.7, 0.75, 0.9) * st;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

/**
 * Terrain, ridges, the sky dome and the forest on the hills.
 * @returns {{ meshes: THREE.Object3D[] }} add them to the scene; region tags in userData.region
 */
export function buildWorld(mats, { gy }) {
  const out = [];
  // ---------------- terrain (one mesh, vertex colours by region)
  const xs = gridLines(TERRACE.x0 - 0.06, TERRACE.x1 + 0.06, 0.04, 8.6);
  const zs = gridLines(TERRACE.z0 - 0.06, 0.3, 0.03, 8.6);
  // exact rows at the stone wall's top and foot
  for (const z of [0, WALL_RUN]) if (!zs.some((v) => Math.abs(v - z) < 1e-6)) zs.push(z);
  zs.sort((a, b) => a - b);
  const nx = xs.length;
  const nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = xs[i];
    const z = zs[j];
    const y = groundHeight(x, z, gy);
    const k = (j * nx + i) * 3;
    pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
    // colour: moss green on the terrace, dark forest floor on the hills,
    // dry grass to the west, paddy greens and dark water in the valley
    const n = n2(x, z, 14, 21) * 0.5 + 0.5;
    let c = [0.11, 0.16, 0.07];
    if (z > 0.1) {
      const paddy = (Math.floor(x / 0.18 + 100) + Math.floor(z / 0.13 + 100)) % 3;
      c = [[0.16, 0.17, 0.08], [0.2, 0.17, 0.09], [0.12, 0.15, 0.07]][paddy];
    } else if (x < TERRACE.x0) {
      c = [0.2, 0.16, 0.09];
    } else if (z < TERRACE.z0 || x > TERRACE.x1) {
      c = [0.09, 0.1, 0.06];
    }
    col[k] = c[0] * (0.8 + 0.4 * n); col[k + 1] = c[1] * (0.8 + 0.4 * n); col[k + 2] = c[2] * (0.8 + 0.4 * n);
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i;
    const b = a + 1;
    const c = a + nx;
    const d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  tg.setIndex(idx);
  tg.computeVertexNormals();
  const terrain = new THREE.Mesh(tg, mats.wTerrain);
  terrain.name = 'wTerrain';
  terrain.matrixAutoUpdate = false;
  terrain.layers.enable(2);
  out.push(terrain);

  // ---------------- two rings of ridges round the horizon
  const ring = (radius, base, amp, seed, which) => {
    const N = 360;
    const r = rng(seed);
    const ph = [r() * 6, r() * 6, r() * 6, r() * 6];
    const p = [];
    const top = [];
    const rg = [];
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      // lower toward the valley in the south, highest in the north and east
      const dirZ = Math.sin(a);
      const dirX = Math.cos(a);
      const lift = 0.18 * smooth(-0.2, 0.8, -dirZ) + 0.1 * smooth(0, 1, dirX) - 0.12 * smooth(0.3, 1, dirZ);
      const h = base + lift + amp * (0.5 * Math.sin(a * 3 + ph[0]) + 0.28 * Math.sin(a * 7 + ph[1]) + 0.14 * Math.sin(a * 17 + ph[2]) + 0.08 * Math.sin(a * 41 + ph[3]));
      const x = CENTRE[0] + Math.cos(a) * radius;
      const z = CENTRE[1] + Math.sin(a) * radius;
      p.push(x, gy - 3, z, x, h, z);
      top.push(h, h);
      rg.push(which, which);
    }
    const ix = [];
    for (let i = 0; i < N; i++) { const a = i * 2; ix.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('aTop', new THREE.Float32BufferAttribute(top, 1));
    g.setAttribute('aRing', new THREE.Float32BufferAttribute(rg, 1));
    g.setIndex(ix);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mats.wRidge);
    m.name = 'wRidge';
    m.matrixAutoUpdate = false;
    m.renderOrder = -0.5 - 0.1 * which;
    m.frustumCulled = false;
    return m;
  };
  // layered: each ring further, higher and mistier (the classic dusk hills)
  out.push(ring(3.1, 0.06, 0.09, 4, 0.0));
  out.push(ring(4.4, 0.24, 0.14, 5, 0.3));
  out.push(ring(5.8, 0.46, 0.2, 6, 0.6));
  out.push(ring(8.1, 0.85, 0.34, 9, 1.0));

  // ---------------- forest on the hills: cedars (stacked cones) and broadleaf crowns
  const r = rng(77);
  const cones = [];
  const crowns = [];
  for (let i = 0; i < 4000 && (cones.length + crowns.length) < 760; i++) {
    const x = -3.2 + r() * 6.2;
    const z = -3.4 + r() * 4.6;
    const { x0, x1, z0 } = TERRACE;
    const dx = Math.max(x0 - x, 0, x - x1);
    const dz = Math.max(z0 - z, 0);
    const d = Math.hypot(dx, dz);
    if (d < 0.6 || z > 0.6) continue; // not in the garden
    if (groundHeight(x, z, gy) < gy - 0.06) continue; // not down in the valley
    if (z < TERRACE.z0 && Math.abs(x) < 0.25 + 0.3 * (TERRACE.z0 - z)) continue; // open behind the round window: hills and sky
    if (x < x0 - 0.1 && z > -1.6) continue; // open to the west, toward the sunset
    if (Math.hypot(x - CENTRE[0], z - CENTRE[1]) > 3.6) continue;
    const y = groundHeight(x, z, gy);
    const big = 0.1 + 0.14 * smooth(0.6, 2.0, d);
    cones.push([x, y, z, big * (0.8 + 0.5 * r()), r()]);
  }
  const coneGeo = (() => {
    // a cedar: five ragged, drooping tiers on a short trunk (unit height)
    const parts = [];
    const rr = rng(31);
    for (const [y0, h, rad] of [[0.1, 0.3, 0.21], [0.26, 0.28, 0.18], [0.42, 0.26, 0.14], [0.57, 0.24, 0.1], [0.72, 0.28, 0.06]]) {
      const g = new THREE.ConeGeometry(rad, h, 11, 2, true);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const k = 1 + 0.28 * (rr() - 0.5) * (p.getY(i) < h / 2 - 1e-4 ? 1 : 0);
        p.setXYZ(i, p.getX(i) * k, p.getY(i) - (p.getY(i) < 0 ? 0.03 * rr() : 0), p.getZ(i) * k);
      }
      g.translate(0, y0 + h / 2, 0);
      g.computeVertexNormals();
      parts.push(g.toNonIndexed());
    }
    const trunk = new THREE.CylinderGeometry(0.015, 0.02, 0.2, 5, 1, true);
    trunk.translate(0, 0.1, 0);
    parts.push(trunk.toNonIndexed());
    return merge(parts);
  })();
  const crownGeo = (() => {
    // a broadleaf crown: lumpy (a few big bulges, smooth normals)
    const g = mergeVertices(new THREE.IcosahedronGeometry(0.5, 2));
    const p = g.attributes.position;
    const rr = rng(5);
    const lumps = Array.from({ length: 7 }, () => new THREE.Vector3(rr() - 0.5, rr() * 0.8 - 0.1, rr() - 0.5).normalize());
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      const n = v.clone().normalize();
      let k = 0.8;
      for (const l of lumps) k += 0.16 * Math.max(0, n.dot(l)) ** 4;
      v.multiplyScalar(k);
      v.y = v.y * 0.8 + 0.5;
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
  })();
  const inst = (geo, list, name, tint) => {
    const m = new THREE.InstancedMesh(geo, mats.wTree, list.length);
    const M = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    list.forEach(([x, y, z, s, k], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), k * 6.28);
      M.compose(new THREE.Vector3(x, y - 0.01, z), q, new THREE.Vector3(s * (0.8 + 0.3 * k), s, s * (0.8 + 0.3 * k)));
      m.setMatrixAt(i, M);
      c.setRGB(...tint(k));
      m.setColorAt(i, c);
    });
    m.name = name;
    m.computeBoundingSphere();
    m.layers.enable(2);
    return m;
  };
  out.push(inst(coneGeo, cones, 'wCedar', (k) => [0.03 + 0.015 * k, 0.05 + 0.015 * k, 0.036]));
  crownGeo.dispose();

  // ---------------- the evening star, low in the west beside the sunset glow
  {
    const d = new THREE.Vector3(-0.8, 0.26, 0.12).normalize();
    const star = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), mats.wStar);
    star.position.set(CENTRE[0], gy, CENTRE[1]).addScaledVector(d, 7.2);
    star.name = 'wStar';
    star.updateMatrix();
    star.matrixAutoUpdate = false;
    out.push(star);
  }

  // ---------------- the sky dome (drawn first, everything closes over it)
  const sky = new THREE.Mesh(new THREE.SphereGeometry(9.5, 48, 24), mats.wSky);
  sky.name = 'gardenSky';
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  sky.userData.skyDome = true;
  out.push(sky);
  return { meshes: out };
}

function merge(parts) {
  const g = new THREE.BufferGeometry();
  const P = [];
  const N = [];
  for (const p of parts) { P.push(...p.attributes.position.array); N.push(...p.attributes.normal.array); p.dispose(); }
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  return g;
}

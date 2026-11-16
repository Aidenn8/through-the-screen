// Lightmap bake for static lights.
//
// The set never moves and neither do its lights, so the diffuse light from
// the shadowed spots and the work bulbs is rendered once, at load, into
// lightmaps, and the baked materials then shade with one texture fetch
// instead of four spot lights with shadow lookups (the biggest single cost of
// the soundstage's scene pass). What stays live: specular (wet streaks,
// chrome, glass, the car), the hemisphere fill, emissives, rain, haze.
//
//   1. Unwrap: each merged mesh is cut into charts, one per planar quad
//      (two triangles sharing an edge) or per lone triangle, laid flat in
//      the chart's own plane at a texel density given in set metres.
//   2. Pack: charts are shelf-packed per material into shared square pages
//      (a material's charts share one page, so it can use one lightMap).
//   3. Bake: each page is rendered with its meshes drawn in UV space by a
//      white Lambert carrying the original material's spot mask and work
//      lights, through the scene's real shadow maps, writing irradiance.
//   4. Dilate: empty texels around the charts take their neighbours' value,
//      so bilinear lookups at chart edges never pull in black.

import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { maskSpots } from './lightmask.js';
import { addWorkLights } from './worklight.js';

const PAD = 2;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();

function triNormal(p, t, out) {
  _a.fromBufferAttribute(p, t * 3);
  _b.fromBufferAttribute(p, t * 3 + 1);
  _c.fromBufferAttribute(p, t * 3 + 2);
  return out.subVectors(_c, _b).cross(_a.clone().sub(_b)).normalize();
}

// Charts of a non-indexed geometry: arrays of triangle indices with a 2D frame.
function chartsOf(geometry) {
  const p = geometry.attributes.position;
  const nt = p.count / 3;
  const charts = [];
  const n0 = new THREE.Vector3();
  const n1 = new THREE.Vector3();
  const key = (i) => `${p.getX(i).toFixed(5)},${p.getY(i).toFixed(5)},${p.getZ(i).toFixed(5)}`;
  for (let t = 0; t < nt;) {
    triNormal(p, t, n0);
    let tris = [t];
    let shared = null;
    if (t + 1 < nt) {
      triNormal(p, t + 1, n1);
      if (n0.dot(n1) > 0.999) {
        const ka = [key(t * 3), key(t * 3 + 1), key(t * 3 + 2)];
        const kb = [key(t * 3 + 3), key(t * 3 + 4), key(t * 3 + 5)];
        const common = ka.filter((k) => kb.includes(k));
        if (common.length === 2) { tris = [t, t + 1]; shared = common; }
      }
    }
    // u axis: an edge of the first triangle that is not the quad's diagonal
    let best = null;
    for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) {
      const ki = key(t * 3 + i);
      const kj = key(t * 3 + j);
      if (shared && shared.includes(ki) && shared.includes(kj)) continue;
      _a.fromBufferAttribute(p, t * 3 + i);
      _b.fromBufferAttribute(p, t * 3 + j);
      const len = _a.distanceTo(_b);
      if (!best || len > best.len) best = { len, u: _b.clone().sub(_a).normalize() };
    }
    const nrm = n0.clone();
    const u = best && best.len > 1e-9 ? best.u : new THREE.Vector3(1, 0, 0);
    const w = new THREE.Vector3().crossVectors(nrm, u).normalize();
    const o = new THREE.Vector3().fromBufferAttribute(p, t * 3);
    let s0 = Infinity; let s1 = -Infinity; let r0 = Infinity; let r1 = -Infinity;
    for (const tt of tris) for (let k = 0; k < 3; k++) {
      _c.fromBufferAttribute(p, tt * 3 + k).sub(o);
      const s = _c.dot(u);
      const r = _c.dot(w);
      s0 = Math.min(s0, s); s1 = Math.max(s1, s); r0 = Math.min(r0, r); r1 = Math.max(r1, r);
    }
    charts.push({ tris, o, u, w, s0, r0, ws: s1 - s0, hs: r1 - r0 });
    t += tris.length;
  }
  return charts;
}

// Shelf packer over square pages.
class Pages {
  constructor(size) { this.size = size; this.pages = []; this.open(); }
  open() { this.cur = { x: 0, y: 0, shelf: 0 }; this.pages.push(this.cur); return this.pages.length - 1; }
  // place [w,h] boxes (sorted tall first) into the current page; null if they don't fit
  tryPlace(boxes) {
    const st = { ...this.cur };
    const out = [];
    for (const [w, h] of boxes) {
      if (w > this.size || h > this.size) return null;
      if (st.x + w > this.size) { st.y += st.shelf; st.x = 0; st.shelf = 0; }
      if (st.y + h > this.size) return null;
      out.push([st.x, st.y]);
      st.x += w;
      st.shelf = Math.max(st.shelf, h);
    }
    Object.assign(this.cur, st);
    return out;
  }
}

const dilateFrag = /* glsl */ `
  uniform sampler2D src;
  uniform vec2 texel;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(src, vUv);
    if (c.a > 0.5) { gl_FragColor = c; return; }
    vec4 acc = vec4(0.0);
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec4 s = texture2D(src, vUv + vec2(float(x), float(y)) * texel);
      if (s.a > 0.5) acc += vec4(s.rgb, 1.0);
    }
    gl_FragColor = acc.a > 0.0 ? vec4(acc.rgb / acc.a, 1.0) : vec4(0.0);
  }
`;

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene      the full scene (its shadow maps are rendered from it)
 * @param {THREE.Mesh[]} meshes    static meshes to bake (geometry in set units)
 * @param {object} o
 * @param {(mesh) => number} o.texel  set-metres per texel for a mesh
 * @param {number} [o.pageSize]
 * @returns {{ pages: THREE.WebGLRenderTarget[], materials: THREE.Material[], stats: object }}
 */
export function bakeLightmaps(renderer, scene, meshes, { texel, pageSize = 2048 } = {}) {
  // ---- unwrap and pack, material by material
  const byMat = new Map();
  for (const mesh of meshes) {
    if (!byMat.has(mesh.material)) byMat.set(mesh.material, []);
    byMat.get(mesh.material).push(mesh);
  }
  const packer = new Pages(pageSize);
  const plan = [];
  let texels = 0;
  let nCharts = 0;
  const groups = [...byMat.entries()].map(([mat, ms]) => {
    const items = ms.map((mesh) => ({ mesh, charts: chartsOf(mesh.geometry) }));
    return { mat, items };
  });
  for (const g of groups) {
    let tau = Math.min(...g.items.map((it) => texel(it.mesh)));
    for (let attempt = 0; attempt < 8; attempt++) {
      const boxes = [];
      for (const it of g.items) for (const c of it.charts) {
        c.cw = Math.ceil(c.ws / tau) + 1 + 2 * PAD;
        c.ch = Math.ceil(c.hs / tau) + 1 + 2 * PAD;
        boxes.push(c);
      }
      boxes.sort((a, b) => b.ch - a.ch);
      let placed = packer.tryPlace(boxes.map((c) => [c.cw, c.ch]));
      let page = packer.pages.length - 1;
      if (!placed) {
        page = packer.open();
        placed = packer.tryPlace(boxes.map((c) => [c.cw, c.ch]));
      }
      if (placed) {
        boxes.forEach((c, i) => { c.x = placed[i][0]; c.y = placed[i][1]; c.page = page; c.tau = tau; });
        texels += boxes.reduce((s, c) => s + c.cw * c.ch, 0);
        nCharts += boxes.length;
        plan.push({ ...g, page });
        break;
      }
      packer.pages.pop();
      if (!packer.pages.length) packer.open(); else packer.cur = packer.pages[packer.pages.length - 1];
      tau *= 1.4; // too big for a page: coarser
    }
  }
  // ---- uv1 per vertex
  for (const g of plan) for (const it of g.items) {
    const geo = it.mesh.geometry;
    const p = geo.attributes.position;
    const uv1 = new Float32Array(p.count * 2);
    for (const c of it.charts) for (const t of c.tris) for (let k = 0; k < 3; k++) {
      const i = t * 3 + k;
      _c.fromBufferAttribute(p, i).sub(c.o);
      const s = (_c.dot(c.u) - c.s0) / c.tau;
      const r = (_c.dot(c.w) - c.r0) / c.tau;
      uv1[i * 2] = (c.x + PAD + 0.5 + s) / pageSize;
      uv1[i * 2 + 1] = (c.y + PAD + 0.5 + r) / pageSize;
    }
    geo.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
    geo.setAttribute('bakeUv', new THREE.BufferAttribute(uv1, 2));
  }

  // ---- bake materials: white Lambert, same spot mask and work lights, drawn in UV space
  const bakeMats = new Map();
  for (const g of plan) {
    const orig = g.mat;
    const bm = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    if (orig.userData.spotMask !== undefined) maskSpots(bm, orig.userData.spotMask);
    if (orig.userData.workLights) addWorkLights([bm], orig.userData.workLights);
    const prev = bm.onBeforeCompile;
    bm.onBeforeCompile = (s, r) => {
      prev?.call(bm, s, r);
      const v = s.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 bakeUv;');
      const end = v.lastIndexOf('}');
      s.vertexShader = `${v.slice(0, end)}\n  gl_Position = vec4(bakeUv * 2.0 - 1.0, 0.0, 1.0);\n}`;
      // irradiance (W/m^2-like units of three's lights): outgoing for a white Lambert x pi
      s.fragmentShader = s.fragmentShader
        .replace('#include <opaque_fragment>', 'gl_FragColor = vec4(outgoingLight * PI, 1.0);')
        // triangles land in UV space in either winding: never flip the normal
        .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0'));
    };
    const prevKey = bm.customProgramCacheKey.bind(bm);
    bm.customProgramCacheKey = () => `${prevKey()}-bake`;
    bakeMats.set(orig, bm);
  }

  // ---- render
  const pages = packer.pages.map(() => {
    const rt = new THREE.WebGLRenderTarget(pageSize, pageSize, { type: THREE.HalfFloatType, depthBuffer: false });
    rt.texture.generateMipmaps = false;
    rt.texture.minFilter = rt.texture.magFilter = THREE.LinearFilter;
    return rt;
  });
  const scratch = new THREE.WebGLRenderTarget(pageSize, pageSize, { type: THREE.HalfFloatType, depthBuffer: false });
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevAuto = renderer.autoClear;
  const prevBg = scene.background;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  // shadow maps from the whole scene, once
  const tiny = new THREE.WebGLRenderTarget(4, 4);
  renderer.shadowMap.needsUpdate = true;
  renderer.setRenderTarget(tiny);
  renderer.render(scene, cam);
  tiny.dispose();
  renderer.shadowMap.needsUpdate = false;
  // only the baked meshes draw, with the bake materials; fills stay out
  const saved = [];
  scene.traverse((o) => {
    if (o.isMesh || o.isPoints || o.isLine || o.isHemisphereLight || o.isAmbientLight) { saved.push([o, o.visible]); o.visible = false; }
  });
  const swaps = [];
  scene.background = null;
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;
  pages.forEach((rt, pi) => {
    renderer.setRenderTarget(rt);
    renderer.clear();
    const on = [];
    for (const g of plan) {
      if (g.page !== pi) continue;
      for (const it of g.items) {
        swaps.push([it.mesh, it.mesh.material, it.mesh.frustumCulled]);
        it.mesh.material = bakeMats.get(g.mat);
        it.mesh.frustumCulled = false;
        it.mesh.visible = true;
        on.push(it.mesh);
      }
    }
    renderer.render(scene, cam);
    for (const m of on) m.visible = false;
  });
  for (const [m, mat, fc] of swaps) { m.material = mat; m.frustumCulled = fc; }
  for (const [o, v] of saved) o.visible = v;
  scene.background = prevBg;
  // dilate seams
  const quad = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { src: { value: null }, texel: { value: new THREE.Vector2(1 / pageSize, 1 / pageSize) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: dilateFrag,
    depthTest: false,
    depthWrite: false,
  }));
  for (const rt of pages) {
    let a = rt;
    let b = scratch;
    for (let i = 0; i < 4; i++) {
      quad.material.uniforms.src.value = a.texture;
      renderer.setRenderTarget(b);
      quad.render(renderer);
      [a, b] = [b, a];
    }
    // 4 passes: result is back in rt
  }
  quad.material.dispose();
  quad.dispose();
  scratch.dispose();
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.autoClear = prevAuto;
  for (const bm of bakeMats.values()) bm.dispose();
  // the UV-space copy was only for the bake pass; the lightmap reads uv1
  for (const g of plan) for (const it of g.items) it.mesh.geometry.deleteAttribute('bakeUv');

  // ---- switch the baked materials over: lightmap in, spots and work lights out
  for (const g of plan) {
    const m = g.mat;
    m.lightMap = pages[g.page].texture;
    m.lightMap.channel = 1;
    m.userData.baked = true;
    if (m.defines && 'SPOT_MASK' in m.defines) m.defines.SPOT_MASK = 0;
    else maskSpots(m, 0);
    m.needsUpdate = true;
  }
  renderer.shadowMap.needsUpdate = true;
  return {
    pages,
    materials: plan.map((g) => g.mat),
    stats: { pages: pages.length, pageSize, charts: nCharts, texels, fill: texels / (pages.length * pageSize * pageSize) },
  };
}

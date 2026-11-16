// Window-equivalence check.
//
// Claim under test: what the window shows from eye E (off-axis render through
// applyWindowCamera, then displayed on the flat W x H screen) is the same image
// an ordinary perspective camera at E would see looking through a W x H hole.
//
// A  = off-axis render from E (the app's path) into a texture
// A' = that texture on a W x H quad at z = 0, seen by a normal camera C at E
// B  = the scene itself seen by the same normal camera C
// Inside the projected window, A' must match B. Two comparisons:
//   - colour (plain shading, no screen-space post effects);
//   - world position per pixel (a geometric check that ignores shading).

import * as THREE from 'three';
import { applyWindowCamera } from '../core/projection.js';

const posVert = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 p = vec4(position, 1.0);
    #ifdef USE_INSTANCING
      p = instanceMatrix * p;
    #endif
    p = modelMatrix * p;
    vWorld = p.xyz;
    gl_Position = projectionMatrix * viewMatrix * p;
  }
`;
const posFrag = /* glsl */ `
  varying vec3 vWorld;
  void main() { gl_FragColor = vec4(vWorld, 1.0); }
`;

const quadVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const quadFrag = /* glsl */ `
  uniform sampler2D map;
  varying vec2 vUv;
  void main() { gl_FragColor = texture2D(map, vUv); }
`;

function floatTarget(w, h, { samples = 0, nearest = false } = {}) {
  const t = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.FloatType,
    samples,
    depthBuffer: true,
  });
  t.texture.generateMipmaps = false;
  t.texture.minFilter = t.texture.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
  return t;
}

function readFloat(renderer, t) {
  const buf = new Float32Array(t.width * t.height * 4);
  renderer.readRenderTargetPixels(t, 0, 0, t.width, t.height, buf);
  return buf;
}

// Normal camera at the eye that just contains the window.
function viewCamera(eye, W, H, width) {
  const cam = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  cam.position.set(eye.x, eye.y, eye.z);
  cam.up.set(0, 1, 0);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  const inv = cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  let tx = 0;
  let ty = 0;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const v = new THREE.Vector3((sx * W) / 2, (sy * H) / 2, 0).applyMatrix4(inv);
    tx = Math.max(tx, Math.abs(v.x / v.z));
    ty = Math.max(ty, Math.abs(v.y / v.z));
  }
  tx *= 1.03;
  ty *= 1.03;
  cam.aspect = tx / ty;
  cam.fov = (2 * Math.atan(ty) * 180) / Math.PI;
  cam.updateProjectionMatrix();
  const height = Math.round(width / cam.aspect);
  return { cam, width, height };
}

// Pixel-space polygon of the window as seen by cam, shrunk by `margin` px.
function windowMask(cam, W, H, width, height, margin) {
  const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const v = new THREE.Vector3((sx * W) / 2, (sy * H) / 2, 0).project(cam);
    return [((v.x + 1) / 2) * width, ((v.y + 1) / 2) * height];
  });
  const mask = new Uint8Array(width * height);
  // Edge functions for a convex polygon, counter-clockwise in pixel space.
  const edges = pts.map((p, i) => {
    const q = pts[(i + 1) % 4];
    const nx = -(q[1] - p[1]);
    const ny = q[0] - p[0];
    const len = Math.hypot(nx, ny);
    return [nx / len, ny / len, -(nx * p[0] + ny * p[1]) / len];
  });
  const sign = Math.sign(edges[0][0] * pts[2][0] + edges[0][1] * pts[2][1] + edges[0][2]);
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let inside = true;
      for (const [a, b, c] of edges) {
        if (sign * (a * px + b * py + c) < margin) { inside = false; break; }
      }
      if (inside) { mask[y * width + x] = 1; count++; }
    }
  }
  return { mask, count };
}

function percentile(arr, p) {
  if (!arr.length) return NaN;
  const s = Float64Array.from(arr).sort();
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

/**
 * @param renderer THREE.WebGLRenderer
 * @param o.scene  THREE.Scene (used for the position pass)
 * @param o.draw   (camera) => void, renders the scene's colour into the bound target
 * @param o.W, o.H window size (m); o.eye {x,y,z}
 */
export function windowCheck(renderer, { scene, draw, W, H, eye, width = 1400, images = false, displayReferred = false }) {
  // Sub-pixel, eye-facing effects (rain streaks) are resampled differently by
  // construction; scenes mark them userData.checkExclude so the check measures
  // the projection, not the resampling of hairlines.
  const excluded = [];
  scene.traverse((o) => { if (o.userData.checkExclude && o.visible) { o.visible = false; excluded.push(o); } });
  const prevTarget = renderer.getRenderTarget();
  const prevAutoClear = renderer.autoClear;
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  renderer.autoClear = true;

  const { cam, height } = viewCamera(eye, W, H, width);
  const winCam = new THREE.PerspectiveCamera();
  applyWindowCamera(winCam, eye, W, H, { near: 0.01, far: 100 });

  // Texture resolution for A: at least as dense as C's pixels across the window.
  const aW = Math.round(width * 1.5);
  const aH = Math.round((aW * H) / W);

  const quadMat = new THREE.ShaderMaterial({ uniforms: { map: { value: null } }, vertexShader: quadVert, fragmentShader: quadFrag });
  const quadScene = new THREE.Scene();
  quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(W, H), quadMat));
  const posMat = new THREE.ShaderMaterial({ vertexShader: posVert, fragmentShader: posFrag, side: THREE.DoubleSide });

  const run = (kind) => {
    const isPos = kind === 'pos';
    const A = floatTarget(aW, aH, { samples: isPos ? 0 : 4, nearest: isPos });
    const B = floatTarget(width, height, { samples: isPos ? 0 : 4 });
    const C = floatTarget(width, height, { samples: isPos ? 0 : 4 });
    const drawWith = (camera) => {
      if (isPos) {
        const prevOverride = scene.overrideMaterial;
        const prevBg = scene.background;
        scene.overrideMaterial = posMat;
        scene.background = null;
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        renderer.render(scene, camera);
        scene.overrideMaterial = prevOverride;
        scene.background = prevBg;
      } else {
        renderer.setClearColor(0x000000, 1);
        renderer.clear();
        draw(camera);
      }
    };
    renderer.setRenderTarget(A);
    drawWith(winCam);
    renderer.setRenderTarget(B);
    drawWith(cam);
    quadMat.uniforms.map.value = A.texture;
    renderer.setRenderTarget(C);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(quadScene, cam);
    const b = readFloat(renderer, B);
    const c = readFloat(renderer, C);
    A.dispose(); B.dispose(); C.dispose();
    return { b, c };
  };

  const { mask, count } = windowMask(cam, W, H, width, height, 3);

  // Colour: compare after a simple tone curve so HDR highlights don't dominate.
  const col = run('col');
  // Plain renders are linear HDR: compare through a tone curve. The full
  // pipeline already outputs display-referred sRGB: compare it as is (a second
  // curve would blow its +-1/255 dither near black up to ~10/255).
  const tone = displayReferred ? (v) => Math.min(Math.max(v, 0), 1) : (v) => Math.pow(Math.max(v, 0) / (1 + Math.max(v, 0)), 1 / 2.2);
  const colErr = [];
  for (let i = 0; i < width * height; i++) {
    if (!mask[i]) continue;
    let e = 0;
    for (let k = 0; k < 3; k++) e = Math.max(e, Math.abs(tone(col.b[i * 4 + k]) - tone(col.c[i * 4 + k])));
    colErr.push(e * 255);
  }

  // Optional debug images: B, A' and the colour difference (x4), as PNG data URLs.
  let debug = null;
  if (images) {
    const toUrl = (fn) => {
      const cv = document.createElement('canvas');
      cv.width = width;
      cv.height = height;
      const g = cv.getContext('2d');
      const img = g.createImageData(width, height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const o = ((height - 1 - y) * width + x) * 4;
        const c = fn(i);
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      return cv.toDataURL('image/png');
    };
    const px = (buf, i) => [0, 1, 2].map((k) => tone(buf[i * 4 + k]) * 255);
    debug = {
      direct: toUrl((i) => px(col.b, i)),
      window: toUrl((i) => px(col.c, i)),
      diff: toUrl((i) => {
        const a = px(col.b, i);
        const b = px(col.c, i);
        return [0, 1, 2].map((k) => Math.min(255, Math.abs(a[k] - b[k]) * 4 * (mask[i] ? 1 : 0.25) + (mask[i] ? 0 : 20)));
      }),
    };
  }

  // Geometry: world-space distance between the points the two images show.
  const pos = run('pos');
  const posErr = [];
  let bothBg = 0;
  for (let i = 0; i < width * height; i++) {
    if (!mask[i]) continue;
    const ab = pos.b[i * 4 + 3] > 0.5;
    const ac = pos.c[i * 4 + 3] > 0.5;
    if (!ab && !ac) { bothBg++; continue; }
    if (ab !== ac) { posErr.push(1e3); continue; }
    const dx = pos.b[i * 4] - pos.c[i * 4];
    const dy = pos.b[i * 4 + 1] - pos.c[i * 4 + 1];
    const dz = pos.b[i * 4 + 2] - pos.c[i * 4 + 2];
    posErr.push(Math.hypot(dx, dy, dz) * 1000); // mm
  }

  renderer.setRenderTarget(prevTarget);
  renderer.autoClear = prevAutoClear;
  renderer.setClearColor(prevClear, prevAlpha);
  quadMat.dispose();
  posMat.dispose();
  for (const o of excluded) o.visible = true;

  const meanCol = colErr.reduce((a, b) => a + b, 0) / Math.max(colErr.length, 1);
  const over2mm = posErr.filter((e) => e > 2).length / Math.max(posErr.length, 1);
  const result = {
    eye: [eye.x, eye.y, eye.z],
    pixels: count,
    colour: { mean: meanCol, p50: percentile(colErr, 0.5), p90: percentile(colErr, 0.9), p99: percentile(colErr, 0.99) },
    position: { p50mm: percentile(posErr, 0.5), p95mm: percentile(posErr, 0.95), over2mm, background: bothBg / count },
  };
  // Edges (and sub-pixel features like neon tubes and rain) legitimately
  // differ after resampling A into A'; the bulk of the image must agree.
  if (debug) result.images = debug;
  result.pass = result.colour.p50 < 1.0 && result.colour.p90 < 6.0 && result.position.p50mm < 0.5 && over2mm < 0.03;
  return result;
}

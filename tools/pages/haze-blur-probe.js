// In-browser probe for tools/scene-haze-blur.mjs: runs the haze's depth-aware
// blur (src/scenes/_lib/haze.js) on a pixel whose depth differs from every
// tap (a thin twig in front of a far wall) and reads the result back as floats.

import * as THREE from 'three';
import { Haze } from '../../src/scenes/_lib/haze.js';

export function run() {
  const N = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N;
  const renderer = new THREE.WebGLRenderer({ canvas });
  const haze = new Haze({ lights: [], scale: 1, steps: 4, shadows: false });
  // depth: a far wall at 40 m, one twig pixel at 5 cm in the middle
  const z = new Float32Array(N * N * 4).fill(40);
  const mid = (N / 2) * N + N / 2;
  z[mid * 4] = 0.05;
  const tZ = new THREE.DataTexture(z, N, N, THREE.RGBAFormat, THREE.FloatType);
  tZ.minFilter = tZ.magFilter = THREE.NearestFilter;
  tZ.needsUpdate = true;
  // the march's output: an even haze everywhere
  const s = new Float32Array(N * N * 4);
  for (let i = 0; i < N * N; i++) s.set([0.2, 0.3, 0.4, 0.8], i * 4);
  const src = new THREE.DataTexture(s, N, N, THREE.RGBAFormat, THREE.FloatType);
  src.minFilter = src.magFilter = THREE.NearestFilter;
  src.needsUpdate = true;
  const out = new THREE.WebGLRenderTarget(N, N, { type: THREE.FloatType, depthBuffer: false });
  const u = haze.blurMat.uniforms;
  u.src.value = src;
  u.tZ.value = tZ;
  // taps 2-6 texels out: none of them lands on the twig's own pixel
  u.texel.value.set(4 / N, 4 / N);
  haze.pass(haze.blurMat, out, renderer);
  const px = new Float32Array(N * N * 4);
  renderer.readRenderTargetPixels(out, 0, 0, N, N, px);
  const at = (i) => Array.from(px.slice(i * 4, i * 4 + 4));
  let bad = 0;
  for (const v of px) if (!Number.isFinite(v)) bad++;
  const res = { twig: at(mid), wall: at(3 * N + 3), nonFinite: bad };
  haze.dispose?.();
  out.dispose();
  tZ.dispose();
  src.dispose();
  renderer.dispose();
  return res;
}

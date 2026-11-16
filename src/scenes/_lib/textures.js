// Procedural textures painted on canvases at load time. Keeps the repo small
// and lets every surface be tuned in code. All generators are tileable.

import * as THREE from 'three';

// ---- deterministic random + tileable value noise ----
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

// Value noise with period (px, py) in lattice cells.
export function vnoise(x, y, px, py, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const x0 = ((xi % px) + px) % px;
  const y0 = ((yi % py) + py) % py;
  const x1 = (x0 + 1) % px;
  const y1 = (y0 + 1) % py;
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Tileable fBm over [0,1)^2 with base frequency f (cells per tile).
export function fbm(u, v, f = 4, oct = 5, seed = 0, gain = 0.5, fy = f) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let fx = f;
  let fyy = fy;
  for (let o = 0; o < oct; o++) {
    sum += amp * vnoise(u * fx, v * fyy, fx, fyy, seed + o * 17);
    norm += amp;
    amp *= gain;
    fx *= 2;
    fyy *= 2;
  }
  return sum / norm;
}

// ---- canvas helpers ----
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Fill a canvas from a per-pixel function returning [r,g,b] (0..255) or a grey.
export function paint(w, h, fn) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const r = fn(x / w, y / h, x, y);
      const i = (y * w + x) * 4;
      if (typeof r === 'number') { d[i] = d[i + 1] = d[i + 2] = r; }
      else { d[i] = r[0]; d[i + 1] = r[1]; d[i + 2] = r[2]; }
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function toTexture(canvas, { srgb = true, repeat = [1, 1], anisotropy = 8, mipmaps = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = anisotropy;
  t.generateMipmaps = mipmaps;
  t.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// Height canvas (grey) -> tangent-space normal map canvas.
export function normalFromHeight(heightCanvas, strength = 2) {
  const w = heightCanvas.width;
  const h = heightCanvas.height;
  const src = heightCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const H = (x, y) => src[((((y % h) + h) % h) * w + (((x % w) + w) % w)) * 4] / 255;
  return paint(w, h, (u, v, x, y) => {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
    const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const n = [-dx, dy, 1];
    const l = Math.hypot(n[0], n[1], n[2]);
    return [((n[0] / l) * 0.5 + 0.5) * 255, ((n[1] / l) * 0.5 + 0.5) * 255, ((n[2] / l) * 0.5 + 0.5) * 255];
  });
}

const clamp255 = (v) => Math.max(0, Math.min(255, v));
const mix = (a, b, t) => a + (b - a) * t;

// ---- surfaces ----

// Wood grain running along u. tone: [r,g,b] base colour.
export function woodCanvas(w = 512, h = 128, { seed = 3, tone = [150, 110, 72], rings = 18, dark = 0.45 } = {}) {
  return paint(w, h, (u, v) => {
    const warp = fbm(u, v, 2, 4, seed, 0.5, 2) * 2.2;
    const g = (v * rings + warp + fbm(u, v, 8, 3, seed + 5, 0.5, 1) * 0.6) % 1;
    const ring = Math.pow(Math.abs(Math.sin(g * Math.PI)), 6);
    const fine = fbm(u, v, 64, 2, seed + 9, 0.5, 4);
    const k = 1 - dark * ring - 0.12 * fine + 0.06 * fbm(u, v, 3, 3, seed + 2);
    return [clamp255(tone[0] * k), clamp255(tone[1] * k), clamp255(tone[2] * k)];
  });
}

// Matte plaster / paint with soft mottling.
export function plasterCanvas(w = 512, h = 512, { seed = 7, tone = [200, 192, 178], var: vr = 0.08 } = {}) {
  return paint(w, h, (u, v) => {
    const n = fbm(u, v, 4, 6, seed) - 0.5;
    const s = fbm(u, v, 32, 3, seed + 3) - 0.5;
    const k = 1 + n * vr * 2 + s * vr * 0.6;
    return [clamp255(tone[0] * k), clamp255(tone[1] * k), clamp255(tone[2] * k)];
  });
}

// Generic grey fBm (for roughness / height).
export function noiseCanvas(w = 256, h = 256, { seed = 11, freq = 6, oct = 5, lo = 0, hi = 255, gain = 0.5 } = {}) {
  return paint(w, h, (u, v) => mix(lo, hi, fbm(u, v, freq, oct, seed, gain)));
}

export function texFrom(fn, opts) {
  return toTexture(fn(), opts);
}

// Page side of tools/core-facegen.mjs: find landmarks on a portrait photo,
// then render that photo on the canonical face mesh at given 3D poses, as a
// webcam would see it, and hand back I420 frames with sensor noise and a
// frame-number barcode.

import * as THREE from 'three';
import { FaceLandmarker } from '@mediapipe/tasks-vision';
import wasmLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';

const abs = (u) => new URL(u, location.href).href;
let renderer;
let scene;
let camera;
let faceGeo;
let headMesh;
let W;
let H;
let seed = 12345;

function gauss() {
  // xorshift + Box-Muller, deterministic per run
  const u = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return ((seed >>> 0) + 0.5) / 4294967296;
  };
  return Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

window.photoLandmarks = async (dataUrl) => {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const fl = await FaceLandmarker.createFromOptions(
    { wasmLoaderPath: abs(wasmLoaderUrl), wasmBinaryPath: abs(wasmBinaryUrl) },
    { baseOptions: { modelAssetPath: abs('/models/face_landmarker.task'), delegate: 'CPU' }, runningMode: 'IMAGE', numFaces: 1 },
  );
  const res = fl.detect(img);
  fl.close();
  return { width: img.naturalWidth, height: img.naturalHeight, landmarks: res.faceLandmarks[0] || null };
};

/**
 * @param {object} o { width, height, vfovDeg, photo (data URL), uvs (Float32 list, 468*2), tris (flat index list), headRadii }
 */
window.setupRenderer = async (o) => {
  W = o.width;
  H = o.height;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  document.body.append(canvas);
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  // A dim room behind the viewer: soft vertical gradient.
  const bg = document.createElement('canvas');
  bg.width = 4;
  bg.height = 256;
  const g = bg.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#4a4f57');
  grad.addColorStop(0.6, '#2c2f34');
  grad.addColorStop(1, '#1d1e21');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const bgTex = new THREE.CanvasTexture(bg);
  bgTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = bgTex;
  camera = new THREE.PerspectiveCamera(o.vfovDeg, W / H, 0.01, 10);

  const img = new Image();
  img.src = o.photo;
  await img.decode();
  const tex = new THREE.Texture(img);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  faceGeo = new THREE.BufferGeometry();
  faceGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(468 * 3), 3));
  faceGeo.setAttribute('uv', new THREE.Float32BufferAttribute(Float32Array.from(o.uvs), 2));
  faceGeo.setIndex(o.tris);
  const faceMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  scene.add(new THREE.Mesh(faceGeo, faceMat));
  // Back of the head and hair: a dark ellipsoid behind the face mask.
  headMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), new THREE.MeshBasicMaterial({ color: 0x3b2a1f }));
  headMesh.matrixAutoUpdate = false;
  scene.add(headMesh);
  return true;
};

/**
 * Render one frame.
 * @param {number[]} verts 468*3 positions in camera (CV) coords, metres
 * @param {number[]} head 16 numbers, column-major matrix for the unit sphere (CV coords)
 * @param {number} frameId written as a 16-bit barcode
 * @param {number} noise luma noise sigma (8-bit units)
 * @returns {string} base64 of an I420 frame
 */
window.renderFrame = (verts, head, frameId, noise) => {
  // CV (x right, y down, z forward) -> three (x right, y up, z backward).
  const pos = faceGeo.attributes.position.array;
  for (let i = 0; i < 468; i++) {
    pos[i * 3] = verts[i * 3];
    pos[i * 3 + 1] = -verts[i * 3 + 1];
    pos[i * 3 + 2] = -verts[i * 3 + 2];
  }
  faceGeo.attributes.position.needsUpdate = true;
  faceGeo.computeBoundingSphere();
  const flip = new THREE.Matrix4().makeScale(1, -1, -1);
  headMesh.matrix.copy(flip).multiply(new THREE.Matrix4().fromArray(head));
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  const rgba = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  // To I420 (BT.601 limited range), rows flipped (GL is bottom-up).
  const ySize = W * H;
  const out = new Uint8Array(ySize * 1.5);
  const U = ySize;
  const V = ySize + ySize / 4;
  for (let y = 0; y < H; y++) {
    const src = (H - 1 - y) * W * 4;
    for (let x = 0; x < W; x++) {
      const i = src + x * 4;
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      let Y = 16 + 0.257 * r + 0.504 * g + 0.098 * b + noise * gauss();
      out[y * W + x] = Y < 0 ? 0 : Y > 255 ? 255 : Y;
      if ((y & 1) === 0 && (x & 1) === 0) {
        const c = (y >> 1) * (W >> 1) + (x >> 1);
        let u = 128 - 0.148 * r - 0.291 * g + 0.439 * b + 0.5 * noise * gauss();
        let v = 128 + 0.439 * r - 0.368 * g - 0.071 * b + 0.5 * noise * gauss();
        out[U + c] = u < 0 ? 0 : u > 255 ? 255 : u;
        out[V + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
  // Barcode: 16 cells of 12x12 px along the bottom-left edge, plus a white start cell.
  const cell = 12;
  const y0 = H - 2 * cell;
  for (let k = 0; k <= 16; k++) {
    const on = k === 0 ? 1 : (frameId >> (k - 1)) & 1;
    for (let yy = 0; yy < cell; yy++) for (let xx = 0; xx < cell; xx++) {
      out[(y0 + yy) * W + 8 + k * cell + xx] = on ? 235 : 16;
    }
    for (let yy = 0; yy < cell / 2; yy++) for (let xx = 0; xx < cell / 2; xx++) {
      const c = ((y0 >> 1) + yy) * (W >> 1) + ((8 + k * cell) >> 1) + xx;
      out[U + c] = 128;
      out[V + c] = 128;
    }
  }
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < out.length; i += CH) s += String.fromCharCode.apply(null, out.subarray(i, i + CH));
  return btoa(s);
};

window.facegenReady = true;

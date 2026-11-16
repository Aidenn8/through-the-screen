// Compile every shader and allocate every render target while the scene
// loads, so the first visible frames don't stall (the app sheds resolution
// when frames miss vsync early on). Renders a few frames offscreen from a few
// eye positions with the scene's own render path.

import * as THREE from 'three';
import { applyWindowCamera } from '../../core/projection.js';

export async function warmUp(renderer, scenes, render, size) {
  const cam = new THREE.PerspectiveCamera();
  applyWindowCamera(cam, { x: 0, y: 0, z: 0.6 }, size.width, size.height, { near: 0.01, far: 60 });
  if (renderer.compileAsync) {
    for (const s of scenes) {
      try { await renderer.compileAsync(s, cam); } catch { /* fall through to the render below */ }
    }
  }
  const tmp = new THREE.WebGLRenderTarget(4, 4);
  const prev = renderer.getRenderTarget();
  for (const eye of [[0, 0, 0.6], [-0.2, 0.08, 0.5], [0.2, -0.08, 0.8]]) {
    applyWindowCamera(cam, { x: eye[0], y: eye[1], z: eye[2] }, size.width, size.height, { near: 0.01, far: 60 });
    renderer.setRenderTarget(tmp);
    render(cam);
  }
  renderer.setRenderTarget(prev);
  tmp.dispose();
}

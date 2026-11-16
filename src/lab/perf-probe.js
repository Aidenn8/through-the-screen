// Render-target cost probe: how much do MSAA, HDR formats and depth textures
// cost at the full 2880 x 1864 buffer on this GPU? Used to pick the pipeline
// defaults (see docs/SCENES_NOTES.md).

import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

export function probeTargets(renderer, scene, camera, n = 60) {
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const copy = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { t: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(t, vUv).rgb, 1.0); }',
  }));
  const configs = [
    ['rgba8 x1', { type: THREE.UnsignedByteType, samples: 0 }],
    ['r11g11b10 x1', { type: THREE.UnsignedInt101111Type, format: THREE.RGBFormat, samples: 0 }],
    ['r11g11b10 x4', { type: THREE.UnsignedInt101111Type, format: THREE.RGBFormat, samples: 4 }],
    ['r11g11b10 x4 +depthTex', { type: THREE.UnsignedInt101111Type, format: THREE.RGBFormat, samples: 4, depthTex: true }],
    ['r11g11b10 x2 +depthTex', { type: THREE.UnsignedInt101111Type, format: THREE.RGBFormat, samples: 2, depthTex: true }],
    ['r11g11b10 x1 +depthTex', { type: THREE.UnsignedInt101111Type, format: THREE.RGBFormat, samples: 0, depthTex: true }],
    ['rgba16f x4', { type: THREE.HalfFloatType, samples: 4 }],
    ['rgba8 x4', { type: THREE.UnsignedByteType, samples: 4 }],
  ];
  const out = {};
  const time = (fn) => {
    for (let i = 0; i < 8; i++) fn();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t0 = performance.now();
    for (let i = 0; i < n; i++) fn();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return (performance.now() - t0) / n;
  };
  out['canvas direct'] = time(() => { renderer.setRenderTarget(null); renderer.render(scene, camera); });
  for (const [name, c] of configs) {
    let depthTexture;
    if (c.depthTex) {
      depthTexture = new THREE.DepthTexture(size.x, size.y);
      depthTexture.type = THREE.UnsignedIntType;
    }
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: c.type, format: c.format ?? THREE.RGBAFormat, samples: c.samples, depthBuffer: true,
      ...(depthTexture ? { depthTexture } : {}),
    });
    copy.material.uniforms.t.value = rt.texture;
    out[name] = time(() => {
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      copy.render(renderer);
    });
    rt.dispose();
    depthTexture?.dispose();
  }
  copy.dispose();
  return out;
}

// "Viewer view": what a person (or a phone camera) at the eye actually sees.
// The window image is rendered into a texture and shown on a model of the
// laptop screen, which is then drawn by an ordinary perspective camera placed
// at the eye. Useful to judge the illusion in context and for the
// window-equivalence check.

import * as THREE from 'three';

const quadVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Shows a texture that already holds display-referred (sRGB-encoded) values.
const screenFrag = /* glsl */ `
  uniform sampler2D map;
  uniform float encode; // 1: texture is linear, encode to sRGB here
  varying vec2 vUv;
  vec3 toSRGB(vec3 c) {
    c = max(c, 0.0);
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  void main() {
    vec3 c = texture2D(map, vUv).rgb;
    if (encode > 0.5) c = toSRGB(c);
    gl_FragColor = vec4(c, 1.0);
  }
`;

// Flat-shaded room surfaces, already in display space.
const flatFrag = /* glsl */ `
  uniform vec3 color;
  uniform vec3 eye;
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 l = normalize(vec3(0.0, 0.2, 0.6) - vWorld); // glow from the screen
    float d = max(dot(n, l), 0.0);
    float fall = 1.0 / (1.0 + 18.0 * dot(vWorld, vWorld));
    gl_FragColor = vec4(color * (0.25 + 0.75 * d) * fall, 1.0);
  }
`;
const flatVert = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

function flat(color) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, eye: { value: new THREE.Vector3() } },
    vertexShader: flatVert,
    fragmentShader: flatFrag,
  });
}

export class ViewerView {
  constructor(W, H) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050506);
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.01, 20);
    this.target = null;
    this.screenMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, encode: { value: 0 } },
      vertexShader: quadVert,
      fragmentShader: screenFrag,
    });
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.build(W, H);
  }

  build(W, H) {
    this.group.clear();
    this.W = W;
    this.H = H;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(W, H), this.screenMat);
    this.group.add(screen);
    // Bezel and lid (slightly behind the glass so the image is never covered).
    const bezel = 0.008;
    const lidW = W + 2 * bezel;
    const lidTop = H / 2 + bezel;
    const lidBottom = -H / 2 - 0.016;
    const lid = new THREE.Mesh(new THREE.BoxGeometry(lidW, lidTop - lidBottom, 0.006), flat(0x0b0b0c));
    lid.position.set(0, (lidTop + lidBottom) / 2, -0.0032);
    this.group.add(lid);
    // Base with a keyboard well, lying toward the viewer.
    const base = new THREE.Mesh(new THREE.BoxGeometry(lidW, 0.011, 0.235), flat(0x2a2b2e));
    base.position.set(0, lidBottom - 0.0055, 0.235 / 2);
    this.group.add(base);
    const keys = new THREE.Mesh(new THREE.BoxGeometry(lidW * 0.82, 0.0006, 0.105), flat(0x101012));
    keys.position.set(0, lidBottom + 0.0003, 0.07);
    this.group.add(keys);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.0004, 0.1), flat(0x232427));
    pad.position.set(0, lidBottom + 0.0002, 0.17);
    this.group.add(pad);
    const desk = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), flat(0x1c1714));
    desk.rotation.x = -Math.PI / 2;
    desk.position.set(0, lidBottom - 0.011, 0.4);
    this.group.add(desk);
  }

  ensureTarget(w, h) {
    if (!this.target || this.target.width !== w || this.target.height !== h) {
      this.target?.dispose();
      this.target = new THREE.WebGLRenderTarget(w, h, {
        samples: 0,
        type: THREE.UnsignedByteType,
        depthBuffer: true,
      });
      this.target.texture.generateMipmaps = false;
      this.target.texture.minFilter = THREE.LinearFilter;
      this.target.texture.anisotropy = 8;
    }
    return this.target;
  }

  // renderWindow(target) must draw the window image into the bound target.
  render(renderer, eye, aspect, renderWindow, { linear = false } = {}) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const t = this.ensureTarget(size.x, size.y);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(t);
    renderWindow(t);
    renderer.setRenderTarget(prev);
    this.screenMat.uniforms.map.value = t.texture;
    this.screenMat.uniforms.encode.value = linear ? 1 : 0;
    this.camera.aspect = aspect;
    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(...(this.lookAt ?? [0, -0.015, 0]));
    this.camera.updateProjectionMatrix();
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.target?.dispose();
  }
}

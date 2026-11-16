// Volumetric haze: single scattering from spot lights through a uniform (or
// floor-heavy) haze, ray-marched per pixel at reduced resolution.
//
// Each march runs from the eye to the opaque surface behind the pixel, so the
// result is a property of the eye ray, not of the camera's orientation: it is
// correct for the skewed window frustum. Light shafts come from per-light
// depth maps rendered once (the lights never move).

import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const fsVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Full-res depth -> low-res linear view distance (R) for the march and upsample.
const depthDownFrag = /* glsl */ `
  uniform sampler2D tDepth;
  uniform vec2 srcSize;
  uniform float cameraNear;
  uniform float cameraFar;
  uniform float scale;
  varying vec2 vUv;
  float viewZ(float d) { return (cameraNear * cameraFar) / ((cameraFar - cameraNear) * d - cameraFar) * -1.0; }
  void main() {
    // nearest full-res texel at the centre of this low-res pixel
    ivec2 p = ivec2(floor(vUv * srcSize));
    float d = texelFetch(tDepth, p, 0).r;
    gl_FragColor = vec4(viewZ(d), 0.0, 0.0, 1.0);
  }
`;

function marchFrag(n, shadowed = []) {
  // One unrolled block per light: sampler arrays need constant indices.
  // Lights without a baked map skip the shadow lookup entirely.
  let lightBlocks = '';
  for (let k = 0; k < n; k++) {
    lightBlocks += `
      {
        vec3 Lv = lPos[${k}] - X;
        float d2 = dot(Lv, Lv);
        vec3 l = Lv * inversesqrt(d2);
        float cone = smoothstep(lCone[${k}].x, lCone[${k}].y, dot(-l, lDir[${k}]));
        if (cone > 0.0) {
          float vis = 1.0;
          if (${shadowed[k] === false ? 'false' : 'useShadows > 0.5'}) {
            vec4 c = lMat[${k}] * vec4(X, 1.0);
            vec2 uv = c.xy / c.w * 0.5 + 0.5;
            if (c.w > 0.0 && uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
              float storedInv = texture(lMap[${k}], uv).r;
              vis = step(storedInv, inversesqrt(d2) * 1.01);
            }
          }
          Li += lColor[${k}] * cone * vis * hg(lAniso[${k}], dot(l, dir)) / max(d2, 1e-3);
        }
      }`;
  }
  return /* glsl */ `
  #define NL ${n}
  uniform sampler2D tZ;
  uniform mat4 projInv;
  uniform mat4 camWorld;
  uniform vec3 eyePos;
  uniform float density;
  uniform vec3 ambient;
  uniform float maxDist;
  uniform float floorY;
  uniform float heightFalloff;
  uniform float steps;
  uniform float useShadows;
  uniform vec3 clearMin;   // a box with thinner haze (e.g. inside a set interior)
  uniform vec3 clearMax;
  uniform float clearK;
  uniform vec4 foot;       // haze only over this xz footprint (x0, z0, x1, z1), the rest of the stage is clear
  uniform float footSoft;  // width of the fade at the footprint's edge
  #if NL > 0
  uniform vec3 lPos[NL];
  uniform vec3 lDir[NL];
  uniform vec3 lColor[NL];
  uniform vec2 lCone[NL];
  uniform float lAniso[NL];
  uniform mat4 lMat[NL];
  uniform sampler2D lMap[NL];
  #endif
  varying vec2 vUv;

  float bayer4(vec2 p) {
    ivec2 i = ivec2(mod(p, 4.0));
    int idx = i.x + i.y * 4;
    int b[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
    return (float(b[idx]) + 0.5) / 16.0;
  }
  float hg(float g, float c) {
    float g2 = g * g;
    return (1.0 - g2) / (12.566371 * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
  }

  void main() {
    float z = texture2D(tZ, vUv).r;
    vec2 ndc = vUv * 2.0 - 1.0;
    vec4 v = projInv * vec4(ndc, 1.0, 1.0);
    vec3 dv = normalize(v.xyz / v.w);
    float L = min(z / max(-dv.z, 1e-4), maxDist);
    vec3 dir = normalize(mat3(camWorld) * dv);

    float ds = L / steps;
    float j = bayer4(gl_FragCoord.xy);
    float tau = 0.0;
    vec3 S = vec3(0.0);
    for (int i = 0; i < 64; i++) {
      if (float(i) >= steps) break;
      float t = (float(i) + j) * ds;
      vec3 X = eyePos + dir * t;
      float sig = density * exp(-max(X.y - floorY, 0.0) * heightFalloff);
      if (all(greaterThan(X, clearMin)) && all(lessThan(X, clearMax))) sig *= clearK;
      vec2 fo = max(foot.xy - X.xz, X.xz - foot.zw);
      sig *= 1.0 - smoothstep(0.0, footSoft, max(fo.x, fo.y));
      float T = exp(-(tau + 0.5 * sig * ds));
      vec3 Li = ambient;
      ${lightBlocks}
      S += T * sig * Li * ds;
      tau += sig * ds;
    }
    gl_FragColor = vec4(S, exp(-tau));
  }
  `;
}

// Depth-aware 4x4 blur at low res: removes the dither pattern of the march.
const blurFrag = /* glsl */ `
  uniform sampler2D src;
  uniform sampler2D tZ;
  uniform vec2 texel;
  varying vec2 vUv;
  void main() {
    float z0 = texture2D(tZ, vUv).r;
    vec4 acc = vec4(0.0);
    float ws = 0.0;
    for (int y = -2; y <= 1; y++) for (int x = -2; x <= 1; x++) {
      vec2 uv = vUv + (vec2(float(x), float(y)) + 0.5) * texel;
      float z = texture2D(tZ, uv).r;
      float w = exp(-abs(z - z0) / max(0.02 * z0, 1e-3));
      acc += texture2D(src, uv) * w;
      ws += w;
    }
    gl_FragColor = acc / ws;
  }
`;

// Distance from the light, for the shadow-map lookups in the march.
const distVert = /* glsl */ `
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
const distFrag = /* glsl */ `
  uniform vec3 lightPos;
  varying vec3 vWorld;
  // Inverse distance, so the cleared background (0) means "nothing in the way".
  void main() { gl_FragColor = vec4(1.0 / max(distance(vWorld, lightPos), 1e-4), 0.0, 0.0, 1.0); }
`;

/**
 * A spot light as seen by the haze. Mirrors a THREE.SpotLight's placement.
 * intensity is in the same units as the scene lights; colour is linear.
 */
export class HazeLight {
  constructor({ position, target, angle, penumbra = 0.3, color = 0xffffff, intensity = 1, anisotropy = 0.5, shadowSize = 512, shadow = true }) {
    this.shadow = shadow;
    this.position = new THREE.Vector3().copy(position);
    this.target = new THREE.Vector3().copy(target);
    this.angle = angle;
    this.penumbra = penumbra;
    this.color = new THREE.Color(color);
    this.intensity = intensity;
    this.anisotropy = anisotropy;
    this.shadowSize = shadowSize;
    this.map = null;
    this.matrix = new THREE.Matrix4();
  }

  static fromSpot(spot, extra = {}) {
    spot.updateMatrixWorld(true);
    spot.target.updateMatrixWorld(true);
    return new HazeLight({
      position: new THREE.Vector3().setFromMatrixPosition(spot.matrixWorld),
      target: new THREE.Vector3().setFromMatrixPosition(spot.target.matrixWorld),
      angle: spot.angle,
      penumbra: spot.penumbra,
      color: spot.color,
      intensity: spot.intensity,
      ...extra,
    });
  }
}

export class Haze {
  /**
   * @param {object} o
   * @param {number} o.density   extinction per metre
   * @param {THREE.Color} o.ambient  isotropic in-scattered radiance from the room
   * @param {HazeLight[]} o.lights
   * @param {number} o.scale     resolution divisor (4 = quarter res)
   * @param {number} o.steps
   */
  constructor(o) {
    this.density = o.density ?? 0.6;
    this.ambient = new THREE.Color(o.ambient ?? 0x000000);
    this.lights = o.lights ?? [];
    this.scale = o.scale ?? 4;
    this.steps = o.steps ?? 24;
    this.maxDist = o.maxDist ?? 4;
    this.floorY = o.floorY ?? -1;
    this.heightFalloff = o.heightFalloff ?? 0;
    this.shadows = o.shadows ?? true;
    this.quad = new FullScreenQuad(null);
    const n = this.lights.length;
    this.depthMat = new THREE.ShaderMaterial({
      uniforms: { tDepth: { value: null }, srcSize: { value: new THREE.Vector2() }, cameraNear: { value: 0.01 }, cameraFar: { value: 60 }, scale: { value: this.scale } },
      vertexShader: fsVert, fragmentShader: depthDownFrag,
    });
    this.marchMat = new THREE.ShaderMaterial({
      uniforms: {
        tZ: { value: null }, projInv: { value: new THREE.Matrix4() }, camWorld: { value: new THREE.Matrix4() },
        eyePos: { value: new THREE.Vector3() }, density: { value: this.density }, ambient: { value: this.ambient },
        maxDist: { value: this.maxDist }, floorY: { value: this.floorY }, heightFalloff: { value: this.heightFalloff },
        steps: { value: this.steps }, useShadows: { value: this.shadows ? 1 : 0 },
        clearMin: { value: new THREE.Vector3(...(o.clearBox?.min ?? [1e5, 1e5, 1e5])) },
        clearMax: { value: new THREE.Vector3(...(o.clearBox?.max ?? [1e5, 1e5, 1e5])) },
        clearK: { value: o.clearBox?.k ?? 1 },
        foot: { value: new THREE.Vector4(...(o.footprint?.rect ?? [-1e5, -1e5, 1e5, 1e5])) },
        footSoft: { value: o.footprint?.soft ?? 1e-3 },
        lPos: { value: this.lights.map((l) => l.position) },
        lDir: { value: this.lights.map((l) => l.target.clone().sub(l.position).normalize()) },
        lColor: { value: this.lights.map((l) => new THREE.Vector3(l.color.r, l.color.g, l.color.b).multiplyScalar(l.intensity)) },
        lCone: { value: this.lights.map((l) => new THREE.Vector2(Math.cos(l.angle), Math.cos(l.angle * (1 - l.penumbra)))) },
        lAniso: { value: this.lights.map((l) => l.anisotropy) },
        lMat: { value: this.lights.map((l) => l.matrix) },
        lMap: { value: this.lights.map(() => null) },
      },
      vertexShader: fsVert, fragmentShader: marchFrag(n, this.lights.map((l) => l.shadow)),
    });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { src: { value: null }, tZ: { value: null }, texel: { value: new THREE.Vector2() } },
      vertexShader: fsVert, fragmentShader: blurFrag,
    });
    this.distMat = new THREE.ShaderMaterial({
      uniforms: { lightPos: { value: new THREE.Vector3() } },
      vertexShader: distVert, fragmentShader: distFrag, side: THREE.DoubleSide,
    });
    this.output = null;
    this.depthOut = null;
    this.raw = null;
  }

  /** Render each light's distance map once. Meshes that don't cast shadows
   *  (lamp housings around their own light, glass, glow cards) are skipped. */
  bake(renderer, scene) {
    const hidden = [];
    scene.traverse((o) => {
      if ((o.isMesh || o.isPoints || o.isLine) && o.visible && !o.castShadow) { o.visible = false; hidden.push(o); }
    });
    const prevTarget = renderer.getRenderTarget();
    const prevOverride = scene.overrideMaterial;
    const prevBg = scene.background;
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    scene.overrideMaterial = this.distMat;
    scene.background = null;
    this.lights.forEach((l, i) => {
      if (!l.shadow) return;
      if (!l.map) {
        l.map = new THREE.WebGLRenderTarget(l.shadowSize, l.shadowSize, { type: THREE.FloatType, depthBuffer: true });
        l.map.texture.minFilter = l.map.texture.magFilter = THREE.NearestFilter;
        l.map.texture.generateMipmaps = false;
      }
      const cam = new THREE.PerspectiveCamera((l.angle * 2 * 180) / Math.PI + 4, 1, 0.005, 20);
      cam.position.copy(l.position);
      cam.lookAt(l.target);
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
      l.matrix.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      this.distMat.uniforms.lightPos.value.copy(l.position);
      renderer.setRenderTarget(l.map);
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      renderer.render(scene, cam);
      this.marchMat.uniforms.lMap.value[i] = l.map.texture;
    });
    scene.overrideMaterial = prevOverride;
    scene.background = prevBg;
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.setRenderTarget(prevTarget);
    for (const o of hidden) o.visible = true;
  }

  resize(w, h) {
    const lw = Math.max(1, Math.ceil(w / this.scale));
    const lh = Math.max(1, Math.ceil(h / this.scale));
    if (this.output && this.output.width === lw && this.output.height === lh) return;
    this.output?.dispose(); this.depthOut?.dispose(); this.raw?.dispose();
    const mk = (type) => {
      const t = new THREE.WebGLRenderTarget(lw, lh, { type, depthBuffer: false });
      t.texture.generateMipmaps = false;
      t.texture.minFilter = t.texture.magFilter = THREE.LinearFilter;
      return t;
    };
    this.output = mk(THREE.HalfFloatType);
    this.raw = mk(THREE.HalfFloatType);
    this.depthOut = mk(THREE.FloatType);
    this.depthOut.texture.minFilter = this.depthOut.texture.magFilter = THREE.NearestFilter;
    this.fullSize = new THREE.Vector2(w, h);
  }

  pass(mat, target, renderer) {
    this.quad.material = mat;
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
  }

  render(renderer, camera, depthTexture) {
    const d = this.depthMat.uniforms;
    d.tDepth.value = depthTexture;
    d.srcSize.value.copy(this.fullSize);
    d.cameraNear.value = camera.near;
    d.cameraFar.value = camera.far;
    this.pass(this.depthMat, this.depthOut, renderer);

    const m = this.marchMat.uniforms;
    m.tZ.value = this.depthOut.texture;
    m.projInv.value.copy(camera.projectionMatrixInverse);
    m.camWorld.value.copy(camera.matrixWorld);
    m.eyePos.value.setFromMatrixPosition(camera.matrixWorld);
    m.density.value = this.density;
    m.steps.value = this.steps;
    m.maxDist.value = this.maxDist;
    m.floorY.value = this.floorY;
    m.heightFalloff.value = this.heightFalloff;
    this.pass(this.marchMat, this.raw, renderer);

    const b = this.blurMat.uniforms;
    b.src.value = this.raw.texture;
    b.tZ.value = this.depthOut.texture;
    b.texel.value.set(1 / this.raw.width, 1 / this.raw.height);
    this.pass(this.blurMat, this.output, renderer);
  }

  dispose() {
    this.output?.dispose(); this.depthOut?.dispose(); this.raw?.dispose();
    for (const l of this.lights) l.map?.dispose();
    this.depthMat.dispose(); this.marchMat.dispose(); this.blurMat.dispose(); this.distMat.dispose();
    this.quad.dispose();
  }
}

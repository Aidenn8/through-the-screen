// Rain: thin motion-blurred streaks, instanced, lit per drop by the set
// lights with a strong forward-scattering phase, so rain shows up where it
// should on a film set: against the backlight and inside the light cones.
// Streaks face the eye every frame and never get thinner than ~1.5 px, with
// brightness scaled down to match, so they don't shimmer as the camera moves.

import * as THREE from 'three';

const MAX_LIGHTS = 5;

// Per-light block, unrolled (samplers need constant indices). Visibility uses
// the haze's light-space distance maps, so drops in a building's shadow stay dark.
const lightBlock = (k) => `
    {
      vec3 L = lPos[${k}] - c;
      float d2 = dot(L, L);
      vec3 l = L * inversesqrt(d2);
      float cone = smoothstep(lCone[${k}].x, lCone[${k}].y, dot(-l, lDir[${k}]));
      if (cone > 0.0) {
        float vis = 1.0;
        if (lUseMap[${k}] > 0.5) {
          vec4 q = lMat[${k}] * vec4(c, 1.0);
          vec2 uv = q.xy / q.w * 0.5 + 0.5;
          if (q.w > 0.0 && uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
            float storedInv = textureLod(lMap${k}, uv, 0.0).r;
            vis = step(storedInv, inversesqrt(d2) * 1.01);
          }
        }
        col += lColor[${k}] * cone * vis * hg(0.78, dot(-l, view)) / max(d2, 1e-3);
      }
    }`;
// one block per light the shaders declare (tests/scenes/rain.test.js)
export const LIGHT_BLOCKS = Array.from({ length: MAX_LIGHTS }, (_, k) => lightBlock(k)).join('');
export { MAX_LIGHTS };

const vert = /* glsl */ `
  attribute vec4 drop; // x, z (real m), phase 0..1, speed scale
  uniform float uTime;
  uniform float uTop;
  uniform float uBottom;
  uniform float uLen;
  uniform float uWidth;
  uniform float uScale;      // world metres per real metre
  uniform float uPxPerDist;  // world size of one pixel per metre of distance
  uniform vec3 uWind;
  uniform vec3 uAmbient;
  uniform vec3 lPos[${MAX_LIGHTS}];
  uniform vec3 lDir[${MAX_LIGHTS}];
  uniform vec3 lColor[${MAX_LIGHTS}];
  uniform vec2 lCone[${MAX_LIGHTS}];
  uniform mat4 lMat[${MAX_LIGHTS}];
  uniform float lUseMap[${MAX_LIGHTS}];
  ${Array.from({ length: MAX_LIGHTS }, (_, k) => `uniform sampler2D lMap${k};`).join('\n  ')}
  varying vec3 vCol;
  varying vec2 vQ;
  float hg(float g, float c) {
    float g2 = g * g;
    return (1.0 - g2) / (12.566371 * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
  }
  void main() {
    float H = uTop - uBottom;
    float fall = 8.5 * drop.w;
    float y = uTop - mod(drop.z * H + uTime * fall, H);
    vec3 c = (modelMatrix * vec4(drop.x, y, drop.y, 1.0)).xyz;
    vec3 axis = normalize((modelMatrix * vec4(uWind.x, -1.0, uWind.z, 0.0)).xyz);
    vec3 toEye = cameraPosition - c;
    float dist = length(toEye);
    vec3 view = toEye / dist;
    vec3 side = normalize(cross(axis, view));
    float wid = uWidth * uScale;
    float minW = 1.6 * uPxPerDist * dist;
    float energy = wid / max(wid, minW);
    wid = max(wid, minW);
    float len = uLen * uScale * drop.w;
    vec3 p = c + side * position.x * wid * 0.5 + axis * (position.y - 0.5) * len;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    vec3 col = uAmbient;
    ${LIGHT_BLOCKS}
    // fade in/out at the ends of the fall so drops never pop
    float t = (y - uBottom) / H;
    // drops differ in size and catch the light differently
    float vary = 0.25 + 0.75 * fract(drop.z * 91.7 + drop.w * 13.3);
    vCol = col * energy * vary * smoothstep(0.0, 0.04, t) * smoothstep(1.0, 0.9, t);
    vQ = position.xy;
  }
`;

const frag = /* glsl */ `
  varying vec3 vCol;
  varying vec2 vQ;
  void main() {
    float across = 1.0 - abs(vQ.x);
    float along = sin(clamp(vQ.y, 0.0, 1.0) * 3.14159);
    gl_FragColor = vec4(vCol * across * across * along, 1.0);
  }
`;

const splashVert = /* glsl */ `
  attribute vec4 splash; // x, ground y, z (real m), phase
  uniform float uTime;
  uniform float uScale;
  uniform float uPxPerDist;
  uniform vec3 uAmbient;
  uniform vec3 lPos[${MAX_LIGHTS}];
  uniform vec3 lDir[${MAX_LIGHTS}];
  uniform vec3 lColor[${MAX_LIGHTS}];
  uniform vec2 lCone[${MAX_LIGHTS}];
  uniform mat4 lMat[${MAX_LIGHTS}];
  uniform float lUseMap[${MAX_LIGHTS}];
  ${Array.from({ length: MAX_LIGHTS }, (_, k) => `uniform sampler2D lMap${k};`).join('\n  ')}
  varying vec3 vCol;
  varying vec2 vQ;
  varying float vAge;
  float hg(float g, float c) {
    float g2 = g * g;
    return (1.0 - g2) / (12.566371 * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
  }
  void main() {
    // each splash cycles every ~0.55 s and shows for the first 0.12 s
    float cyc = 0.55 + 0.3 * fract(splash.w * 7.3);
    float age = fract(uTime / cyc + splash.w) * cyc;
    float on = step(age, 0.12);
    vAge = age / 0.12;
    vec3 c = (modelMatrix * vec4(splash.x, splash.y, splash.z, 1.0)).xyz;
    vec3 toEye = cameraPosition - c;
    float dist = length(toEye);
    vec3 view = toEye / dist;
    vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), view));
    // a 4-6 cm crown, never under 2 px wide
    float w = max(0.05 * uScale * (0.6 + 0.6 * vAge), 2.0 * uPxPerDist * dist);
    float h = 0.035 * uScale * (0.4 + vAge);
    vec3 p = c + side * position.x * w * 0.5 + vec3(0.0, 1.0, 0.0) * position.y * h * on;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    vec3 col = uAmbient;
    ${LIGHT_BLOCKS}
    vCol = col * on * 0.55;
    vQ = position.xy;
  }
`;
const splashFrag = /* glsl */ `
  varying vec3 vCol;
  varying vec2 vQ;
  varying float vAge;
  void main() {
    // a crown: two thin arcs spraying up and out, fading as they fall
    float x = vQ.x;
    float arc = exp(-pow((abs(x) - 0.55 * vQ.y - 0.15) * 7.0, 2.0));
    float a = arc * (1.0 - vQ.y) * (1.0 - vAge * 0.8);
    gl_FragColor = vec4(vCol * a, 1.0);
  }
`;

export class Rain {
  /**
   * volumes: [{ x0, x1, z0, z1, count }] in real metres; top/bottom in real y.
   * lights: [{ position, direction, color (Vector3, intensity folded in), cone: [cosOuter, cosInner] }] in world space.
   */
  constructor({ volumes, top = 6.3, bottom = 0.1, scale = 1 / 12, length = 0.42, width = 0.004, lights = [], ambient = new THREE.Color(0.0, 0.0, 0.0), seed = 7, splashes = null }) {
    let n = 0;
    for (const v of volumes) n += v.count;
    // every light passed must have a block in the shaders (a fifth light was
    // once passed to four blocks and silently never lit anything)
    if (lights.length > MAX_LIGHTS) throw new Error(`Rain: ${lights.length} lights, the shaders take ${MAX_LIGHTS}`);
    const base = new THREE.PlaneGeometry(2, 1);
    base.translate(0, 0.5, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    const data = new Float32Array(n * 4);
    let s = seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    let i = 0;
    for (const v of volumes) {
      for (let k = 0; k < v.count; k++, i++) {
        data[i * 4] = v.x0 + rnd() * (v.x1 - v.x0);
        data[i * 4 + 1] = v.z0 + rnd() * (v.z1 - v.z0);
        data[i * 4 + 2] = rnd();
        data[i * 4 + 3] = 0.8 + rnd() * 0.4;
      }
    }
    g.setAttribute('drop', new THREE.InstancedBufferAttribute(data, 4));
    g.instanceCount = n;
    const pad = (arr, mk) => { while (arr.length < MAX_LIGHTS) arr.push(mk()); return arr; };
    this.uniforms = {
      uTime: { value: 0 },
      uTop: { value: top },
      uBottom: { value: bottom },
      uLen: { value: length },
      uWidth: { value: width },
      uScale: { value: scale },
      uPxPerDist: { value: 0.0003 },
      uWind: { value: new THREE.Vector3(0.08, 0, 0.04) },
      uAmbient: { value: ambient },
      lPos: { value: pad(lights.map((l) => l.position.clone()), () => new THREE.Vector3(0, 100, 0)) },
      lDir: { value: pad(lights.map((l) => l.direction.clone()), () => new THREE.Vector3(0, -1, 0)) },
      lColor: { value: pad(lights.map((l) => l.color.clone()), () => new THREE.Vector3()) },
      lCone: { value: pad(lights.map((l) => new THREE.Vector2(...l.cone)), () => new THREE.Vector2(2, 3)) },
      lMat: { value: pad(lights.map((l) => l.matrix ?? new THREE.Matrix4()), () => new THREE.Matrix4()) },
      lUseMap: { value: pad(lights.map((l) => (l.map ? 1 : 0)), () => 0) },
    };
    const blank = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    this.blank = blank;
    blank.needsUpdate = true;
    for (let k = 0; k < MAX_LIGHTS; k++) this.uniforms[`lMap${k}`] = { value: lights[k]?.map ?? blank };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.userData.noReflect = true;
    this.mesh.userData.checkExclude = true;
    this.mesh.renderOrder = 10;
    if (splashes) this.#buildSplashes(splashes, volumes, rnd);
  }

  // Splashes: where drops hit the ground a brief crown of spray kicks up
  // (nr01, nr04). Each one is a small eye-facing sprite on the ground that
  // flares for ~0.1 s on its own cycle, lit through the same lights and
  // light-space maps as the drops, so they show inside the backlit cones only.
  #buildSplashes({ count, ground }, volumes, rnd) {
    const base = new THREE.PlaneGeometry(2, 1);
    base.translate(0, 0.5, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    const data = new Float32Array(count * 4);
    const total = volumes.reduce((a, v) => a + (v.x1 - v.x0) * (v.z1 - v.z0), 0);
    for (let i = 0; i < count; i++) {
      // spread over the volumes by area
      let pick = rnd() * total;
      let v = volumes[0];
      for (const vv of volumes) { const a = (vv.x1 - vv.x0) * (vv.z1 - vv.z0); if (pick < a) { v = vv; break; } pick -= a; }
      const x = v.x0 + rnd() * (v.x1 - v.x0);
      const z = v.z0 + rnd() * (v.z1 - v.z0);
      data[i * 4] = x;
      data[i * 4 + 1] = ground(x, z);
      data[i * 4 + 2] = z;
      data[i * 4 + 3] = rnd();
    }
    g.setAttribute('splash', new THREE.InstancedBufferAttribute(data, 4));
    g.instanceCount = count;
    this.splashMesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: splashVert,
      fragmentShader: splashFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.splashMesh.frustumCulled = false;
    this.splashMesh.userData.noReflect = true;
    this.splashMesh.userData.checkExclude = true;
    this.splashMesh.renderOrder = 11;
    this.mesh.add(this.splashMesh);
  }

  dispose() {
    for (const mesh of [this.mesh, this.splashMesh]) {
      if (!mesh) continue;
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.blank.dispose();
  }

  update(time, eyeZ, windowHeight, bufferHeight) {
    this.uniforms.uTime.value = time;
    // one pixel subtends ~ (H / eyeZ) / bufferHeight radians near the axis
    this.uniforms.uPxPerDist.value = windowHeight / Math.max(eyeZ, 0.05) / Math.max(bufferHeight, 1);
  }
}

// the shader sources, for tests/scenes/rain.test.js
export const RAIN_SHADERS = { vert, splashVert };

// Outdoor light for the Box's world (the engawa, the garden, the house's
// outside, the hills): the low sun as a directional term with its own shadow
// map (rendered once: nothing outside moves), a dusk sky fill and a dark
// ground bounce, the stone lantern's candle as a small warm point term, and
// aerial perspective toward a horizon colour that follows the sky. Injected
// into Lambert/Standard materials like the soundstage's work lights, so the
// room's spot never reaches them (mask 0) and nothing here costs the room.
//
// Everything world-space reads three's cameraPosition (the eye in the
// world, which the rig moves), never the window-space eye.

import * as THREE from 'three';
import { maskSpots } from '../_lib/lightmask.js';

// The sun as the world sees it: the room's sun travels this way (from the
// west, low, a little from the viewer's side).
export const SUN_DIR = new THREE.Vector3(0.892, -0.3, -0.34).normalize();

// Past the far plane, geometry is drawn just inside it, still ordered by
// distance (a plain clamp to one depth let overlapping hills resolve by draw
// order at small rig scales). Perspective projections only.
export const FAR_GLSL = /* glsl */ `
  // past the far plane: drawn just inside it, still in order of distance
  // (a clamp to one depth let overlapping hills resolve by draw order)
  float farClampZ(vec4 cp) {
    float P22 = projectionMatrix[2][2];
    float P32 = projectionMatrix[3][2];
    float far = P32 / (P22 + 1.0);
    float wt = 0.97 * far;
    if (cp.w <= wt) return cp.z;
    float zt = -P22 + P32 / wt;
    float k = 1.0 - exp(-(cp.w - wt) / far);
    return (zt + (1.0 - zt) * 0.999 * k) * cp.w;
  }
`;

// The dusk sky as a function of a world direction (shared by the dome, the
// water and the fog so they agree): deep blue overhead, a warm belt low all
// round, strongest toward the sunset in the west.
export const SKY_GLSL = /* glsl */ `
  vec3 duskSky(vec3 d, vec3 sunDir) {
    float up = clamp(d.y, -0.2, 1.0);
    vec2 h = normalize(d.xz + vec2(1e-5));
    vec2 s = normalize(sunDir.xz);
    float west = clamp(0.5 + 0.5 * dot(h, s), 0.0, 1.0); // pow() of a hair below 0 is NaN
    vec3 zenith = vec3(0.010, 0.020, 0.066);
    vec3 belt = mix(vec3(0.085, 0.055, 0.10), vec3(0.95, 0.42, 0.15), pow(west, 2.4));
    belt += vec3(0.05, 0.022, 0.03) * (1.0 - west);
    float k = pow(1.0 - clamp(up, 0.0, 1.0), 6.0);
    vec3 c = mix(zenith, belt, k);
    c = mix(c, vec3(0.045, 0.055, 0.13), smoothstep(0.03, 0.25, up) * (1.0 - smoothstep(0.25, 0.75, up)) * 0.55);
    float g = max(dot(d, normalize(sunDir * vec3(1.0, 0.22, 1.0))), 0.0);
    c += vec3(1.3, 0.55, 0.2) * pow(g, 20.0) * 0.7;
    return c;
  }
`;

/**
 * Per-instance outdoor lighting: shared uniforms (sun shadow map, lantern,
 * time) and `apply(material, opts)`.
 */
export function createOutdoor() {
  const U = {
    gSunDir: { value: SUN_DIR },
    gSunToward: { value: SUN_DIR.clone().negate() },
    gSun: { value: new THREE.Vector3(1.0, 0.6, 0.3).multiplyScalar(2.7) },
    gSky: { value: new THREE.Vector3(0.16, 0.18, 0.32).multiplyScalar(0.55) },
    gGround: { value: new THREE.Vector3(0.06, 0.045, 0.03) },
    gShadowMap: { value: null },
    gShadowMat: { value: new THREE.Matrix4() },
    gShadowOn: { value: 0 },
    gShadowTexel: { value: new THREE.Vector2(1 / 2048, 1 / 2048) },
    gLampPos: { value: new THREE.Vector3(0, -10, 0) },
    gLampCol: { value: new THREE.Vector3(1.0, 0.62, 0.3).multiplyScalar(0.0011) },
    gFog: { value: new THREE.Vector2(2.2, 0.12) }, // start (m), density (/m)
  };

  /**
   * @param {THREE.Material} material Lambert or Standard
   * @param {object} o sun / fill scale, translucent (thin leaves lit from
   *   behind), shadow (receive the sun's shadow map), lamp (the lantern's
   *   pool), fog (aerial perspective), ao (darken toward the ground: ground
   *   contact for walls, trunks and rocks, value = height in m over which it fades)
   */
  function apply(material, { sun = 1, fill = 1, translucent = 0, shadow = true, lamp = false, fog = false, ao = 0, aoY = -0.1376, spec = 0, earth = false, glint = false, farClamp = false } = {}) {
    maskSpots(material, 0);
    const prev = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      prev?.call(material, shader, renderer);
      Object.assign(shader.uniforms, U);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vGW;${farClamp ? FAR_GLSL : ''}`)
        .replace('#include <project_vertex>', `#include <project_vertex>
          {
            vec4 gw = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
              gw = instanceMatrix * gw;
            #endif
            vGW = (modelMatrix * gw).xyz;
          }
          ${farClamp ? 'gl_Position.z = farClampZ(gl_Position);' : ''}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vGW;
          uniform vec3 gSunDir; uniform vec3 gSunToward; uniform vec3 gSun; uniform vec3 gSky; uniform vec3 gGround;
          uniform sampler2DShadow gShadowMap; uniform mat4 gShadowMat; uniform float gShadowOn; uniform vec2 gShadowTexel;
          uniform vec3 gLampPos; uniform vec3 gLampCol; uniform vec2 gFog;
          ${SKY_GLSL}
          float gShadowAt(vec3 p, vec3 n) {
            if (gShadowOn < 0.5) return 1.0;
            vec4 c = gShadowMat * vec4(p + n * 0.0025 + gSunToward * 0.002, 1.0);
            vec3 q = c.xyz * 0.5 + 0.5;
            if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0 || q.z > 1.0) return 1.0;
            // hardware-filtered taps (each a bilinear 2 x 2 compare): soft, no stairs
            float s = 0.0;
            s += texture(gShadowMap, vec3(q.xy + vec2(-0.75, -0.75) * gShadowTexel, q.z));
            s += texture(gShadowMap, vec3(q.xy + vec2(0.75, -0.75) * gShadowTexel, q.z));
            s += texture(gShadowMap, vec3(q.xy + vec2(-0.75, 0.75) * gShadowTexel, q.z));
            s += texture(gShadowMap, vec3(q.xy + vec2(0.75, 0.75) * gShadowTexel, q.z));
            return s * 0.25;
          }`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          {
            vec3 Nw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
            float ndl = dot(Nw, -gSunDir);
            float sh = ${shadow ? 'gShadowAt(vGW, Nw)' : '1.0'};
            reflectedLight.directDiffuse += diffuseColor.rgb * gSun * ${sun.toFixed(3)} * sh * (max(ndl, 0.0) + ${translucent.toFixed(3)} * max(-ndl, 0.0));
            float occl = ${ao > 0 ? `mix(0.45, 1.0, smoothstep(0.0, ${ao.toFixed(4)}, vGW.y - (${aoY.toFixed(4)})))` : '1.0'};
            reflectedLight.indirectDiffuse += diffuseColor.rgb * mix(gGround, gSky, Nw.y * 0.5 + 0.5) * ${fill.toFixed(3)} * occl;
            ${spec > 0 ? `{
              vec3 V = normalize(vGW - cameraPosition);
              vec3 Rf = reflect(V, Nw);
              float fr = 0.04 + 0.96 * pow(max(1.0 - max(dot(-V, Nw), 0.0), 0.0), 5.0);
              reflectedLight.indirectDiffuse += duskSky(normalize(vec3(Rf.x, max(Rf.y, 0.0), Rf.z)), gSunToward) * fr * ${spec.toFixed(3)} * mix(0.3, 1.0, sh);
              ${glint ? `
              // the low sun's highlight on glass: a tight lobe, and a rim where the glass turns away
              reflectedLight.indirectDiffuse += gSun * 2.5 * pow(max(dot(Rf, gSunToward), 0.0), 400.0);
              reflectedLight.indirectDiffuse += vec3(0.5, 0.42, 0.36) * pow(max(1.0 - abs(dot(-V, Nw)), 0.0), 3.0) * 0.35;` : ''}
            }` : ''}
            ${lamp ? `{
              vec3 Lp = gLampPos - vGW;
              float d2 = dot(Lp, Lp);
              reflectedLight.indirectDiffuse += diffuseColor.rgb * gLampCol * max(dot(Nw, Lp * inversesqrt(d2)) * 0.7 + 0.3, 0.0) / max(d2, 2e-4);
            }` : ''}
          }`)
        .replace('#include <opaque_fragment>', `#include <opaque_fragment>
          // never hand the pipeline a NaN (its bloom spreads one into a black square)
          if (any(isnan(gl_FragColor.rgb)) || any(isinf(gl_FragColor.rgb))) gl_FragColor.rgb = vec3(0.0);
          ${earth ? `if (!gl_FrontFacing) {
            // the ground seen from below (an eye under it at a big scale):
            // the earth it stands on, dark soil
            float e = fract(sin(dot(floor(vGW.xz * 400.0), vec2(12.99, 78.23))) * 43758.5);
            gl_FragColor.rgb = vec3(0.016, 0.011, 0.008) * (0.8 + 0.4 * e);
          }` : ''}
          ${fog ? `{
            vec3 dv = vGW - cameraPosition;
            float fd = length(dv);
            float fk = 1.0 - exp(-max(fd - gFog.x, 0.0) * gFog.y);
            vec3 fc = duskSky(normalize(vec3(dv.x, max(dv.y, 0.0) * 0.3, dv.z)), gSunToward) * 1.1;
            gl_FragColor.rgb = mix(gl_FragColor.rgb, fc, clamp(fk, 0.0, 0.92));
          }` : ''}`);
    };
    const prevKey = material.customProgramCacheKey?.bind(material);
    material.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}-boxout${sun}-${fill}-${translucent}-${shadow}-${lamp}-${fog}-${ao}-${aoY}-${spec}-${earth}-${glint}-${farClamp}`;
    material.needsUpdate = true;
    return material;
  }

  /**
   * Render the sun's depth over the casters (objects on layer 2) once.
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {{min:number[],max:number[]}} region world box the shadows fall in
   */
  let rt = null;
  const depthMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  function bakeShadow(renderer, scene, region, size = 2048) {
    rt?.dispose();
    rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true });
    rt.depthTexture = new THREE.DepthTexture(size, size, THREE.UnsignedIntType);
    rt.depthTexture.minFilter = rt.depthTexture.magFilter = THREE.LinearFilter;
    rt.depthTexture.compareFunction = THREE.LessEqualCompare;
    // an orthographic camera looking down the sun over the region's box
    const c = new THREE.Vector3().fromArray(region.min).add(new THREE.Vector3().fromArray(region.max)).multiplyScalar(0.5);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 8);
    cam.position.copy(c).addScaledVector(SUN_DIR, -3);
    cam.up.set(0, 1, 0);
    cam.lookAt(c);
    cam.updateMatrixWorld(true);
    // fit the box's corners in light space
    const inv = cam.matrixWorldInverse;
    let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(i & 1 ? region.max[0] : region.min[0], i & 2 ? region.max[1] : region.min[1], i & 4 ? region.max[2] : region.min[2]).applyMatrix4(inv);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
    }
    cam.left = x0; cam.right = x1; cam.bottom = y0; cam.top = y1;
    cam.near = Math.max(0.01, -z1 - 0.5); cam.far = -z0 + 0.1;
    cam.updateProjectionMatrix();
    cam.layers.set(2);
    const prevTarget = renderer.getRenderTarget();
    const prevOverride = scene.overrideMaterial;
    const prevBg = scene.background;
    scene.overrideMaterial = depthMat;
    scene.background = null;
    renderer.setRenderTarget(rt);
    renderer.clear(true, true, false);
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevTarget);
    scene.overrideMaterial = prevOverride;
    scene.background = prevBg;
    U.gShadowMap.value = rt.depthTexture;
    U.gShadowMat.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    U.gShadowTexel.value.set(1 / size, 1 / size);
    U.gShadowOn.value = 1;
  }

  function dispose() {
    rt?.depthTexture?.dispose();
    rt?.dispose();
    rt = null;
    depthMat.dispose();
  }

  return { uniforms: U, apply, bakeShadow, dispose };
}

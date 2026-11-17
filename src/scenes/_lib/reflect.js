// Wet-ground reflections from a mirrored copy of the set.
//
// The set is cloned (sharing geometry and materials) under a group mirrored
// about the ground plane, and rendered with the *same* window camera into a
// low-resolution target. A ground pixel then reads the reflection at its own
// screen position: the eye ray, continued below the plane, hits exactly the
// mirrored geometry. So parallax in the puddles is right for every eye
// position, with no fixed-view tricks. Roughness is approximated by sampling
// blurrier mips and stretching taps vertically (the streaks of lights on wet
// asphalt).

import * as THREE from 'three';

export class PlanarMirror {
  /**
   * @param {object} o
   * @param {number} o.planeY  world y of the reflecting plane
   * @param {number} o.scale   resolution relative to the drawing buffer
   */
  constructor({ planeY, scale = 0.5 }) {
    this.planeY = planeY;
    this.scale = scale;
    this.scene = new THREE.Scene();
    this.flip = new THREE.Group();
    this.flip.matrixAutoUpdate = false;
    this.flip.matrix
      .makeTranslation(0, planeY, 0)
      .multiply(new THREE.Matrix4().makeScale(1, -1, 1))
      .multiply(new THREE.Matrix4().makeTranslation(0, -planeY, 0));
    this.scene.add(this.flip);
    this.target = null;
    this.owned = []; // materials made here (silhouettes, stand-ins), freed in dispose()
    this.size = new THREE.Vector2();
    this.uniforms = {
      tReflect: { value: null },
      reflectRes: { value: new THREE.Vector2(1, 1) },
      reflectMaxLod: { value: 6 },
    };
  }

  /**
   * Mirror a static object (its current world transform), sharing geometry.
   * cheap: lit materials are replaced by flat unlit stand-ins (a dim version
   * of their colour), so the reflection pass costs almost nothing; emissive
   * (MeshBasic) surfaces keep their own material. The reflection is blurred
   * and dim, and what it mostly carries is the bright sources and the dark
   * shapes that hide them.
   */
  add(object, { cheap = false, dim = 0.04, emissiveOnly = false, silhouette = false } = {}) {
    const stand = new Map();
    // silhouette: drawn black, so a dark object hides the lights behind it in
    // the puddles (a parked car between the street and the neon)
    const black = silhouette ? new THREE.MeshBasicMaterial({ color: 0x000000 }) : null;
    if (black) this.owned.push(black);
    const standIn = (mat) => {
      if (black) return black;
      if (!cheap || mat.isMeshBasicMaterial || mat.isShaderMaterial) return mat;
      if (!stand.has(mat)) {
        const c = (mat.color ? mat.color.clone() : new THREE.Color(0.3, 0.3, 0.3)).multiplyScalar(dim);
        if (mat.emissive && mat.emissiveMap) c.add(mat.emissive.clone().multiplyScalar(0.5));
        stand.set(mat, new THREE.MeshBasicMaterial({ color: c, map: mat.map ?? null, side: mat.side, transparent: mat.transparent, opacity: mat.opacity }));
        this.owned.push(stand.get(mat));
      }
      return stand.get(mat);
    };
    object.updateWorldMatrix(true, true);
    object.traverse((o) => {
      if (!(o.isMesh || o.isLight)) return;
      if (o.userData.noReflect) return;
      if (emissiveOnly && !silhouette && !(o.isMesh && o.material.isMeshBasicMaterial)) return;
      if (silhouette && !o.isMesh) return;
      let c;
      if (o.isMesh) {
        c = new THREE.Mesh(o.geometry, standIn(o.material));
        c.castShadow = false;
        c.receiveShadow = false;
      } else if (cheap) {
        return;
      } else if (o.isSpotLight) {
        c = new THREE.SpotLight(o.color, o.intensity, o.distance, o.angle, o.penumbra, o.decay);
        c.target.matrixAutoUpdate = false;
        c.target.matrix.copy(o.target.matrixWorld);
        this.flip.add(c.target);
      } else if (o.isPointLight) {
        c = new THREE.PointLight(o.color, o.intensity, o.distance, o.decay);
      } else if (o.isHemisphereLight) {
        c = new THREE.HemisphereLight(o.color, o.groundColor, o.intensity);
      } else return;
      c.matrixAutoUpdate = false;
      c.matrix.copy(o.matrixWorld);
      this.flip.add(c);
    });
    this.flip.updateMatrixWorld(true);
  }

  ensure(renderer) {
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.round(this.size.x * this.scale));
    const h = Math.max(1, Math.round(this.size.y * this.scale));
    if (this.target && this.target.width === w && this.target.height === h) return;
    this.target?.dispose();
    this.target = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.uniforms.tReflect.value = this.target.texture;
    this.uniforms.reflectRes.value.set(this.size.x, this.size.y);
    this.uniforms.reflectMaxLod.value = Math.floor(Math.log2(Math.min(w, h))) - 2;
  }

  /** size: pixel size of the target the main pass will draw into. */
  render(renderer, camera, size) {
    this.ensure(renderer);
    if (size) this.uniforms.reflectRes.value.copy(size);
    const prev = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, camera);
    renderer.setRenderTarget(prev);
    renderer.autoClear = prevAuto;
  }

  /**
   * Render the mirror for another camera into `target` (a second, smaller
   * view: a monitor's feed) and point the wet materials at it until restore().
   * size: pixel size of the target that view's main pass draws into.
   */
  renderTo(renderer, camera, target, size) {
    const u = this.uniforms;
    this.saved = { tex: u.tReflect.value, res: u.reflectRes.value.clone(), lod: u.reflectMaxLod.value };
    const prev = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, camera);
    renderer.setRenderTarget(prev);
    renderer.autoClear = prevAuto;
    u.tReflect.value = target.texture;
    u.reflectRes.value.copy(size);
    u.reflectMaxLod.value = Math.max(0, Math.floor(Math.log2(Math.min(target.width, target.height))) - 2);
  }

  restore() {
    if (!this.saved) return;
    const u = this.uniforms;
    u.tReflect.value = this.saved.tex;
    u.reflectRes.value.copy(this.saved.res);
    u.reflectMaxLod.value = this.saved.lod;
    this.saved = null;
  }

  dispose() {
    this.target?.dispose();
    for (const m of this.owned) m.dispose();
    this.owned = [];
  }
}

// Tilt field for the streak glints: two independent random channels, one
// texel per cell, tiling; bilinear filtering gives value noise with no
// per-pixel hashing (16 sin() calls per wet pixel before).
let noiseTex = null;
function noiseTexture() {
  if (noiseTex) return noiseTex;
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  let s = 12345;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < N * N; i++) {
    data[i * 4] = Math.floor(rnd() * 256);
    data[i * 4 + 1] = Math.floor(rnd() * 256);
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
  }
  noiseTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.magFilter = THREE.LinearFilter;
  noiseTex.minFilter = THREE.LinearMipmapLinearFilter;
  noiseTex.generateMipmaps = true;
  noiseTex.needsUpdate = true;
  return noiseTex;
}

/**
 * Crisp reflections of the real light sources on a glossy surface (wet car
 * paint, glass, chrome): one isotropic GGX lobe per emitter, widened by the
 * source's size, added to a MeshStandardMaterial's outgoing light. A cube
 * capture carries the broad surroundings but its prefiltering softens small
 * bright shapes; these are exact for every eye.
 * emitters: as for makeWet; rough: the surface's lobe roughness.
 */
export function addGlints(material, emitters, { gain = 1, rough = 0.05 } = {}) {
  const NE = emitters.length;
  if (!NE) return material;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    shader.uniforms.glintPos = { value: emitters.map((e) => new THREE.Vector4(e.position.x, e.position.y, e.position.z, e.radius)) };
    shader.uniforms.glintCol = { value: emitters.map((e) => new THREE.Vector3(e.color.r, e.color.g, e.color.b).multiplyScalar(gain)) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGlintW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGlintW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGlintW;
        uniform vec4 glintPos[${NE}];
        uniform vec3 glintCol[${NE}];`)
      .replace('#include <opaque_fragment>', `
        {
          vec3 V = normalize(cameraPosition - vGlintW);
          vec3 Nw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          float NoV = max(dot(Nw, V), 0.05);
          vec3 g = vec3(0.0);
          for (int i = 0; i < ${NE}; i++) {
            vec3 Lv = glintPos[i].xyz - vGlintW;
            float d2 = dot(Lv, Lv);
            vec3 l = Lv * inversesqrt(d2);
            float NoL = dot(Nw, l);
            if (NoL <= 0.0) continue;
            vec3 h = normalize(l + V);
            float NoH = max(dot(Nw, h), 0.0);
            float a = min(${rough.toFixed(3)} + glintPos[i].w * inversesqrt(d2) * 0.5, 1.0);
            float a2 = a * a;
            float dd = NoH * NoH * (a2 - 1.0) + 1.0;
            float D = a2 / (3.14159 * dd * dd);
            float F = 0.04 + 0.96 * pow(1.0 - max(dot(V, h), 0.0), 5.0);
            g += glintCol[i] * D * F * 0.25 / max(NoL * NoV, 0.02) * NoL / max(d2, 1e-6);
          }
          outgoingLight += g;
        }
        #include <opaque_fragment>`);
  };
  const prevKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}-glints${NE}-${rough}`;
  material.needsUpdate = true;
  return material;
}

/**
 * Make a MeshStandardMaterial wet: darker, glossier, reflecting the mirror.
 * wetMap (R): 0 dry .. 1 standing water; uses the material's uv.
 * extras.ripples: animated rain rings in standing water.
 */
/*
 * emitters: [{ position: Vector3 (world), radius (world m), color: Color (intensity folded in) }]
 * Glossy reflections of bright sources (lamps, neon, windows) are added
 * analytically with a GGX lobe per source. At the grazing angles of a street
 * seen from eye height the lobe stretches toward the viewer: the long
 * vertical streaks of lights on wet asphalt. Computed from the eye position
 * every frame, so they move correctly as the viewer moves.
 */
export function makeWet(material, mirror, { wetMap = null, wetness = 1, puddleRough = 0.03, wetRough = 0.35, time = { value: 0 }, ripples = true, emitters = [], emitGain = 1, streakAcross = [0.07, 0.03], streakAlong = [0.45, 0.25], reflectGain = 1, sparkle = 0, sparkleFreq = 1600, sparkleAcross = 0.25, wetDarken = 0.3, lobeNormalMix = 0.6, sparkleStretch = 0.3, occluder = null } = {}) {
  const NE = emitters.length;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.tReflect = mirror.uniforms.tReflect;
    shader.uniforms.reflectRes = mirror.uniforms.reflectRes;
    shader.uniforms.reflectMaxLod = mirror.uniforms.reflectMaxLod;
    shader.uniforms.wetMap = { value: wetMap };
    shader.uniforms.wetness = { value: wetness };
    shader.uniforms.puddleRough = { value: puddleRough };
    shader.uniforms.wetRough = { value: wetRough };
    shader.uniforms.uTime = time;
    // roughness of the streak lobes [wet asphalt, standing water]
    shader.uniforms.streakAcross = { value: new THREE.Vector2(...streakAcross) };
    shader.uniforms.streakAlong = { value: new THREE.Vector2(...streakAlong) };
    shader.uniforms.reflectGain = { value: reflectGain };
    shader.uniforms.sparkle = { value: sparkle };
    shader.uniforms.sparkleFreq = { value: sparkleFreq };
    shader.uniforms.sparkleAcross = { value: sparkleAcross };
    shader.uniforms.lobeNormalMix = { value: lobeNormalMix };
    shader.uniforms.sparkleStretch = { value: sparkleStretch };
    shader.uniforms.wetNoiseTex = { value: noiseTexture() };
    // one vertical occluder rectangle (world x0, x1, its z plane, top y): a parked car
    shader.uniforms.occ = { value: new THREE.Vector4(...(occluder ?? [0, 0, 1e5, -1e5])) };
    shader.uniforms.emitPos = { value: emitters.map((e) => new THREE.Vector4(e.position.x, e.position.y, e.position.z, e.radius)) };
    shader.uniforms.emitCol = { value: emitters.map((e) => new THREE.Vector3(e.color.r, e.color.g, e.color.b).multiplyScalar(emitGain)) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWetUv;\nvarying vec3 vWorldPos;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvWetUv = uv;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tReflect;
        uniform vec2 reflectRes;
        uniform float reflectMaxLod;
        uniform sampler2D wetMap;
        uniform float wetness;
        uniform float puddleRough;
        uniform float wetRough;
        uniform float uTime;
        uniform vec2 streakAcross;
        uniform vec2 streakAlong;
        uniform float reflectGain;
        uniform float sparkle;
        uniform float sparkleFreq;
        uniform float sparkleAcross;
        uniform float lobeNormalMix;
        uniform float sparkleStretch;
        uniform sampler2D wetNoiseTex;
        uniform vec4 occ;
        ${NE ? `#define NE ${NE}\n        uniform vec4 emitPos[NE];\n        uniform vec3 emitCol[NE];` : ''}
        varying vec2 vWetUv;
        varying vec3 vWorldPos;
        float wetAmount() {
          ${wetMap ? 'return clamp(texture2D(wetMap, vWetUv * ' + (1 / (wetMap.userData.metres ?? 1)).toFixed(5) + ').r * wetness, 0.0, 1.0);' : 'return wetness;'}
        }
        // Expanding rain rings in standing water (procedural, world-space).
        vec2 ripple(vec2 p, float t) {
          vec2 acc = vec2(0.0);
          for (int i = 0; i < 2; i++) {
            vec2 cell = floor(p * 3.0 + float(i) * 0.37);
            vec2 f = fract(p * 3.0 + float(i) * 0.37) - 0.5;
            float h = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5);
            vec2 o = vec2(fract(h * 13.1), fract(h * 7.7)) - 0.5;
            float ph = fract(t * 1.3 + h);
            vec2 d = f - o * 0.6;
            float r = length(d);
            float ring = sin((r - ph * 0.45) * 60.0) * smoothstep(0.08, 0.0, abs(r - ph * 0.45)) * (1.0 - ph);
            acc += normalize(d + 1e-4) * ring;
          }
          return acc;
        }
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float wetK = wetAmount();
        float standing = smoothstep(0.55, 0.85, wetK);
        roughnessFactor = mix(roughnessFactor, mix(wetRough, puddleRough, standing), smoothstep(0.0, 0.4, wetK));
        // Seen from high above (the big Look around swings) the asphalt's
        // relief under the wet sheen turned into crumpled foil, and so did the
        // ripples in the puddles. From the shot's height (grazing) this is 0.
        float fromAbove = smoothstep(0.35, 0.7, normalize(cameraPosition - vWorldPos).y);
        roughnessFactor = mix(roughnessFactor, max(roughnessFactor, 0.42), fromAbove * (1.0 - standing) * 0.75);
      `)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec2 wetRipple = vec2(0.0);
        ${ripples ? `
        {
          wetRipple = ripple(vWorldPos.xz * 12.0, uTime) * standing * 0.18;
          normal = normalize(normal + (viewMatrix * vec4(wetRipple.x, 0.0, wetRipple.y, 0.0)).xyz);
        }` : ''}
        // standing water is flat: fade out the surface normal detail (and
        // from above, most of the asphalt's relief and the ripples' too)
        normal = normalize(mix(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz), max(standing * (0.85 + 0.12 * fromAbove), fromAbove * 0.8)));
      `)
      .replace('#include <map_fragment>', `#include <map_fragment>
        // wet porous surfaces darken
        diffuseColor.rgb *= mix(1.0, ${wetDarken.toFixed(3)}, smoothstep(0.0, 0.6, wetAmount()));
      `)
      .replace('#include <opaque_fragment>', `
        {
          vec3 V = normalize(cameraPosition - vWorldPos);
          vec3 Nw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          float cosT = clamp(dot(Nw, V), 0.0, 1.0);
          float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
          float rough = mix(wetRough, puddleRough, standing);
          vec2 suv = gl_FragCoord.xy / reflectRes;
          // distort by how far the surface normal tilts away from flat (less
          // from above, where the distortion read as crinkles, not ripples)
          suv += vec2(Nw.x, Nw.z) * vec2(0.03, 0.06) * (1.0 - 0.7 * fromAbove);
          float lod = clamp(rough * 14.0, 0.0, reflectMaxLod);
          vec3 refl = vec3(0.0);
          float stretch = 0.004 + rough * 0.05;
          for (int i = -1; i <= 1; i++) {
            refl += textureLod(tReflect, suv + vec2(0.0, float(i) * stretch * 1.5), lod).rgb;
          }
          refl /= 3.0;
          float wetK2 = smoothstep(0.0, 0.5, wetK);
          // the blurred mirror carries the shapes in standing water; on merely
          // wet asphalt the streak lobes below carry the lights
          outgoingLight = outgoingLight * (1.0 - F * wetK2) + refl * reflectGain * F * wetK2 * mix(0.3, 1.0, standing);
          ${NE ? `
          {
            // Streaks: an anisotropic GGX lobe per source, tight across the
            // plane of incidence and long along it. On wet asphalt the water
            // film's facets tilt mostly toward and away from the viewer
            // (ripples, aggregate), so each light becomes a vertical streak
            // as wide as the source, running from its foot toward the eye
            // (Tokyo / Barclays refs). Per pixel the ripple and asphalt
            // normals break the streak up.
            vec3 spec = vec3(0.0);
            float aAcross = mix(streakAcross.x, streakAcross.y, standing);
            // from above a light in wet asphalt is a soft broken pool, not a
            // streak: widen the lobe across and calm the tilt field
            aAcross = mix(aAcross, max(aAcross, 0.12), fromAbove);
            float aAlong = mix(streakAlong.x, streakAlong.y, standing);
            // Tilt field of the water film. With tight lobes, a streak is the
            // set of facets tilted just right toward the eye, so its length
            // comes from how far the tilts spread (mostly toward/away from
            // the viewer, i.e. along world z here) and it breaks into dashes.
            // Cells are long in z: seen at a grazing angle the ground is
            // foreshortened ~8x, so this keeps each dash a few pixels tall
            // (no crawl). Anchored in world space so nothing swims.
            vec3 Nl = Nw;
            {
              vec2 sp = vec2(vWorldPos.x * sparkleFreq, vWorldPos.z * sparkleFreq * sparkleStretch);
              vec4 nz = texture2D(wetNoiseTex, sp / 256.0);
              vec2 tl = nz.rg - 0.5;
              tl += 0.5 * (texture2D(wetNoiseTex, sp * (2.3 / 256.0) + 0.37).rg - 0.5);
              vec2 tw = vec2(tl.y * sparkleAcross, tl.x);
              // plus the asphalt's own normal map (ripples included, flattened
              // in standing water) at part strength
              Nl = normalize(mix(vec3(0.0, 1.0, 0.0), Nw, lobeNormalMix * (1.0 - 0.6 * fromAbove)) + vec3(tw.x, 0.0, tw.y) * sparkle * (1.0 - 0.6 * standing) * (1.0 - 0.75 * fromAbove));
            }
            float NoV = max(dot(Nl, V), 0.05);
            for (int i = 0; i < NE; i++) {
              vec3 Lv = emitPos[i].xyz - vWorldPos;
              float d2 = dot(Lv, Lv);
              vec3 l = Lv * inversesqrt(d2);
              float NoL = dot(Nl, l);
              if (NoL <= 0.0) continue;
              vec3 h = normalize(l + V);
              // frame: along = horizontal direction from the source toward the eye
              vec3 al = vec3(cameraPosition.x - emitPos[i].x, 0.0, cameraPosition.z - emitPos[i].z);
              al = normalize(al - Nl * dot(al, Nl) + vec3(1e-5, 0.0, 0.0));
              vec3 ac = cross(Nl, al);
              // the source's own size widens the lobe across (sphere-light widening)
              float ax = min(aAcross + emitPos[i].w * inversesqrt(d2) * 0.5, 1.0);
              float ay = aAlong;
              float hx = dot(h, ac) / ax;
              // far off this source's streak (D below ~1/2000 of its peak): skip the rest
              if (hx * hx > 45.0) continue;
              {
                // the path to the source passes through the occluder's plane: blocked?
                float t = (occ.z - vWorldPos.z) / (emitPos[i].z - vWorldPos.z);
                vec3 q = vWorldPos + Lv * t;
                if (t > 0.0 && t < 1.0 && q.x > occ.x && q.x < occ.y && q.y < occ.w) continue;
              }
              float hy = dot(h, al) / ay;
              float hz = dot(h, Nl);
              float k = hx * hx + hy * hy + hz * hz;
              float D = 1.0 / (3.14159 * ax * ay * k * k);
              float VoH = max(dot(V, h), 0.0);
              float Fs = 0.02 + 0.98 * pow(1.0 - VoH, 5.0);
              float vis = 0.25 / max(NoL * NoV, 0.02);
              spec += emitCol[i] * D * Fs * vis * NoL / max(d2, 1e-4);
            }
            outgoingLight += spec * wetK2 * mix(0.6, 1.0, standing);
          }` : ''}
        }
        #include <opaque_fragment>
      `);
  };
  material.customProgramCacheKey = () => `wet-${wetMap ? 'map' : 'flat'}-${ripples}-${NE}-${wetDarken}`;
  material.needsUpdate = true;
  return material;
}

// Stage work lights, applied only to the materials that need them (the backs
// of flats, stands, the stage floor and walls). A real point light would be
// evaluated by every fragment of the frame (~1.2 ms each at 2880 x 1810);
// this costs only where these materials are drawn. Unshadowed, with a soft
// wrap so the dark stage reads as a few dim bulbs, not a flat fill.

import * as THREE from 'three';

/**
 * @param {THREE.Material[]} materials Lambert or Standard materials
 * @param {{position: THREE.Vector3, color: THREE.Color, dir?: THREE.Vector3, cone?: number[]}[]} lights
 *   world space; color has intensity folded in. A shaded lamp (a pendant's
 *   downlight) has `dir` (unit, where it points) and `cone`: [cos outer,
 *   cos inner, what leaks outside the cone (0..1)]; without them, all round.
 */
export function addWorkLights(materials, lights) {
  const n = lights.length;
  const pos = lights.map((l) => l.position.clone());
  const col = lights.map((l) => new THREE.Vector3(l.color.r, l.color.g, l.color.b));
  const dir = lights.map((l) => (l.dir ? l.dir.clone().normalize() : new THREE.Vector3(0, -1, 0)));
  const cone = lights.map((l) => (l.cone ? new THREE.Vector3(...l.cone) : new THREE.Vector3(-2, -1, 1)));
  const shaded = lights.some((l) => l.cone);
  for (const material of materials) {
    material.userData.workLights = lights; // the bake reads these
    const prev = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      prev?.call(material, shader, renderer);
      if (material.userData.baked) return; // already in its lightmap
      shader.uniforms.workPos = { value: pos };
      shader.uniforms.workCol = { value: col };
      if (shaded) {
        shader.uniforms.workDir = { value: dir };
        shader.uniforms.workCone = { value: cone };
      }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorkPos;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWorkPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vWorkPos;\nuniform vec3 workPos[${n}];\nuniform vec3 workCol[${n}];${shaded ? `\nuniform vec3 workDir[${n}];\nuniform vec3 workCone[${n}];` : ''}`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          {
            vec3 Nw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
            for (int i = 0; i < ${n}; i++) {
              vec3 L = workPos[i] - vWorkPos;
              float d2 = dot(L, L);
              float wrap = max(dot(Nw, L * inversesqrt(d2)) * 0.75 + 0.25, 0.0);
              ${shaded ? `float k = dot(-L * inversesqrt(d2), workDir[i]);
              wrap *= mix(workCone[i].z, 1.0, smoothstep(workCone[i].x, workCone[i].y, k));` : ''}
              reflectedLight.indirectDiffuse += diffuseColor.rgb * workCol[i] * wrap / max(d2, 1e-4);
            }
          }`);
    };
    const prevKey = material.customProgramCacheKey?.bind(material);
    material.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}-work${n}${shaded ? 's' : ''}${material.userData.baked ? 'b' : ''}`;
    material.needsUpdate = true;
  }
}

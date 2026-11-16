// Ground grime: real walls darken toward the pavement (splash-back, soot,
// damp), 30-50 cm tall and 25-40 % darker, ragged rather than a clean band
// (refs mi05/mi06: the model's tell is that it lacks exactly this). Applied
// to the albedo in world space, so it follows every wall without new UVs.
//
// y0: world y of the ground; height: world height of the band; k: how much
// darker at the very bottom (0..1); freq: world-space frequency of the
// raggedness along the wall.



export function addGrime(material, { y0, height, k = 0.35, freq = 50, tint = [0.92, 0.95, 1.0] } = {}) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrimeW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGrimeW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGrimeW;
        float grimeHash(float x) { return fract(sin(x * 127.1) * 43758.5453); }
        float grimeNoise(float x) { float i = floor(x); float f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(grimeHash(i), grimeHash(i + 1.0), f); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          float along = vGrimeW.x + vGrimeW.z;
          float ragged = 0.55 * grimeNoise(along * ${freq.toFixed(2)}) + 0.3 * grimeNoise(along * ${(freq * 3.7).toFixed(2)}) + 0.15 * grimeNoise(along * ${(freq * 11.0).toFixed(2)});
          float h = ${height.toFixed(5)} * (0.55 + 0.9 * ragged);
          float g = 1.0 - smoothstep(0.0, h, vGrimeW.y - (${y0.toFixed(5)}));
          diffuseColor.rgb *= mix(vec3(1.0), vec3(${tint.map((v) => v.toFixed(3)).join(', ')}) * ${(1 - k).toFixed(3)}, g);
        }`);
  };
  const prevKey = material.customProgramCacheKey?.bind(material);
  // every value baked into the shader text is part of the program's identity
  material.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}-grime${[y0, height, k, freq, ...tint].map((v) => v.toFixed(5)).join(',')}`;
  material.needsUpdate = true;
  return material;
}


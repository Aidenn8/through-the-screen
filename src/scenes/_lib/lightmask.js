// Per-material spot-light masks. three.js evaluates every light in the scene
// for every fragment; at 3420 x 2214 each shadowed spot costs about a
// millisecond. A mask compiles the unwanted lights out of a material's shader
// entirely (the unrolled light loop is wrapped in a preprocessor bit test),
// so the backs of flats don't pay for the diner's window light, and so on.
//
// Bit i is the i-th spot light in three's light order: shadow-casting lights
// first, then scene traversal order. Callers keep the spot order stable.

import * as THREE from 'three';

const chunk = THREE.ShaderChunk.lights_fragment_begin;
const LOOP = 'for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {';
// the end of the spot loop (whitespace differs between three builds: the
// first version of this matched blank lines three's build no longer has, so
// every mask was silently a no-op until round 7)
const END = /\}(\s*)#pragma unroll_loop_end(\s*)#endif(\s*)#if \( NUM_SUN_LIGHTS > 0 \)/;

export function maskedChunk(src = chunk) {
  if (!src.includes(LOOP) || !END.test(src)) return null; // three changed: fall back to no mask (and warn)
  return src
    .replace(LOOP, `${LOOP}\n\t\t#if ( ( SPOT_MASK >> UNROLLED_LOOP_INDEX ) & 1 ) == 1`)
    .replace(END, (all) => `\t#endif\n\t${all}`);
}
const MASKED = maskedChunk();

/** True when the masks compile in (tests/scenes/lightmask.test.js checks it). */
export const MASKS_ACTIVE = !!MASKED;
let warned = false;

export function maskSpots(material, mask) {
  if (!MASKED) {
    // the scenes still render, only slower and with lights where they
    // shouldn't be: say so once instead of failing silently
    if (!warned) {
      warned = true;
      console.warn(`lightmask: three ${THREE.REVISION}'s lights_fragment_begin no longer matches; spot masks are off`);
    }
    return material;
  }
  material.defines = { ...(material.defines || {}), SPOT_MASK: mask };
  if (material.userData.spotMask === undefined) material.userData.spotMask = mask; // the lights it was built for (the bake reads this)
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', MASKED);
  };
  const prevKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}-spots${mask}`;
  material.needsUpdate = true;
  return material;
}

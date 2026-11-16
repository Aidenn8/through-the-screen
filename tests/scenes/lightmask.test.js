// Per-material spot masks (src/scenes/_lib/lightmask.js) against the three.js
// that is installed: the masked chunk must be produced, wrap every spot
// light's block, and leave the rest of the chunk alone. For a long time the
// pattern matched a layout three's build no longer has and every mask was
// silently a no-op.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { maskedChunk, maskSpots, MASKS_ACTIVE } from '../../src/scenes/_lib/lightmask.js';

test(`lightmask: the masked chunk is produced for the installed three (r${THREE.REVISION})`, () => {
  assert.ok(MASKS_ACTIVE, 'maskedChunk() returned null: the spot loop no longer matches');
  const src = THREE.ShaderChunk.lights_fragment_begin;
  const out = maskedChunk(src);
  assert.ok(out, 'masked chunk');
  // the bit test opens right inside the spot loop and closes before its end
  const open = out.indexOf('#if ( ( SPOT_MASK >> UNROLLED_LOOP_INDEX ) & 1 ) == 1');
  const loop = out.indexOf('for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {');
  const end = out.indexOf('#pragma unroll_loop_end', loop);
  assert.ok(loop >= 0 && open > loop && open < end, 'the mask opens inside the spot loop');
  const close = out.lastIndexOf('#endif', end);
  assert.ok(close > open, 'and closes before the loop ends');
  // nothing else changes: removing the two inserted lines gives the original back
  const back = out.replace(/\n\t\t#if \( \( SPOT_MASK >> UNROLLED_LOOP_INDEX \) & 1 \) == 1/, '').replace(/\t#endif\n\t(\}\s*#pragma unroll_loop_end)/, '$1');
  assert.equal(back, src);
});

test('lightmask: a mask lands in the material (define, cache key, chunk swap)', () => {
  const m = maskSpots(new THREE.MeshLambertMaterial(), 5);
  assert.equal(m.defines.SPOT_MASK, 5);
  assert.match(m.customProgramCacheKey(), /-spots5$/);
  const shader = { fragmentShader: '#include <lights_fragment_begin>\n', vertexShader: '', uniforms: {} };
  m.onBeforeCompile(shader);
  assert.ok(shader.fragmentShader.includes('SPOT_MASK >> UNROLLED_LOOP_INDEX'));
  m.dispose();
});

test('lightmask: an unrecognised chunk is refused rather than half-patched', () => {
  assert.equal(maskedChunk('void main() {}'), null);
});

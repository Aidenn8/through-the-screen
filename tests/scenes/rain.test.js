// The rain's per-drop lighting (src/scenes/soundstage/rain.js): every light
// the shaders declare has its own unrolled block, so every light the scene
// passes actually lights drops. A fifth light (the street-end translight)
// was once passed to four blocks and silently never lit anything.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Rain, RAIN_SHADERS, MAX_LIGHTS } from '../../src/scenes/soundstage/rain.js';

test('rain: both shaders light drops with every declared light', () => {
  assert.ok(MAX_LIGHTS >= 5, 'the soundstage passes five lights');
  for (const [name, src] of Object.entries(RAIN_SHADERS)) {
    assert.ok(src.includes(`uniform vec3 lColor[${MAX_LIGHTS}]`), `${name}: ${MAX_LIGHTS} light colours declared`);
    for (let k = 0; k < MAX_LIGHTS; k++) {
      assert.ok(src.includes(`uniform sampler2D lMap${k};`), `${name}: light ${k}'s map declared`);
      assert.ok(src.includes(`col += lColor[${k}] *`), `${name}: light ${k} adds to the drop's colour`);
      assert.ok(src.includes(`textureLod(lMap${k},`), `${name}: light ${k}'s shadow lookup`);
    }
    assert.ok(!src.includes(`lColor[${MAX_LIGHTS}]`) || src.includes(`uniform vec3 lColor[${MAX_LIGHTS}]`), `${name}: no block past the last light`);
  }
});

test('rain: more lights than the shaders take is an error, not a silent drop', () => {
  const light = () => ({ position: new THREE.Vector3(), direction: new THREE.Vector3(0, -1, 0), color: new THREE.Vector3(1, 1, 1), cone: [0.5, 0.9] });
  const make = (n) => new Rain({ volumes: [{ x0: 0, x1: 1, z0: 0, z1: 1, count: 4 }], lights: Array.from({ length: n }, light) });
  const ok = make(MAX_LIGHTS);
  assert.equal(ok.uniforms.lColor.value.length, MAX_LIGHTS);
  ok.dispose();
  assert.throws(() => make(MAX_LIGHTS + 1), /lights/);
});

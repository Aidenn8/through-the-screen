// The haze's depth-aware blur (src/scenes/_lib/haze.js) on the GPU: a pixel
// whose depth is far from every tap's (a twig against a far wall) must keep a
// finite value. It used to divide 0 by 0 and the NaN spread into squares.
// Headless Chromium, opt-in:  SCENE_GPU_TESTS=1 npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('haze blur: no NaN behind thin geometry (GPU)', { skip: process.env.SCENE_GPU_TESTS !== '1', timeout: 700000 }, () => {
  const r = spawnSync(process.execPath, [join(root, 'tools', 'scene-haze-blur.mjs')], { cwd: root, encoding: 'utf8', timeout: 650000 });
  const out = `${r.stdout}\n${r.stderr}`;
  assert.match(r.stdout || '', /^haze blur ok$/m, out);
  assert.equal(r.status, 0, out);
});

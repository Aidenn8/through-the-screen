// GPU memory must come back to baseline: switching Soundstage <-> Box three
// times, and resizing the Box three times (each rebuilds its room), may not
// grow renderer.info.memory (live geometries and textures). Shadow maps,
// throwaway capture scenes and per-scene materials used to leak here.
// Runs headless Chromium (~1 min), so it is opt-in:
//   SCENE_GPU_TESTS=1 npm test
// or directly: node tools/scene-leaks.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('scene switches and Box resizes return GPU memory to baseline', { skip: process.env.SCENE_GPU_TESTS !== '1', timeout: 600000 }, () => {
  const r = spawnSync(process.execPath, [join(root, 'tools', 'scene-leaks.mjs'), '--n', '3'], { cwd: root, encoding: 'utf8', timeout: 580000 });
  const out = `${r.stdout}\n${r.stderr}`;
  const verdicts = (r.stdout || '').split('\n').filter((l) => /^(scene switches|box resizes)/.test(l));
  assert.equal(verdicts.length, 2, `expected two verdict lines, got:\n${out}`);
  for (const v of verdicts) assert.ok(v.endsWith(' ok'), v);
  assert.equal(r.status, 0, out);
});

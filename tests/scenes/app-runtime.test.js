// The app's frame loop in headless Chromium, with the scenes in it:
// - tools/core-runtime.mjs: Soundstage first; Box rebuilt at the same pixel
//   buffer keeps drawing; a scene that throws does not stop the loop and the
//   status pill says so; a lost WebGL context shows a message and recovers.
// - tools/core-steady.mjs: every step of the steady check holds geometries,
//   textures and the JS heap flat, a resize frees the old markers, and closing
//   the check frees its multisampled target. (Short holds here; run the tool
//   with --seconds 60 for the long version.)
// Opt-in, like the other GPU checks:
//   SCENE_GPU_TESTS=1 node --test tests/scenes/*.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const skip = process.env.SCENE_GPU_TESTS !== '1';
const run = (tool, args) => {
  const r = spawnSync(process.execPath, [join(root, 'tools', tool), ...args], { cwd: root, encoding: 'utf8', timeout: 400000 });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
};

test('app loop: first scene, Box rebuild, scene errors, lost context', { skip, timeout: 420000 }, () => {
  const r = run('core-runtime.mjs', ['--port', '5190']);
  assert.match(r.out, /app runtime: ok/, r.out);
  assert.equal(r.status, 0, r.out);
});

test('steady check: memory stays flat in every step and is freed on close', { skip, timeout: 420000 }, () => {
  const r = run('core-steady.mjs', ['--seconds', '8', '--port', '5192']);
  assert.match(r.out, /steady check memory: ok/, r.out);
  assert.equal(r.status, 0, r.out);
});

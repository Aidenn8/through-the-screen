// GPU check that the window really is a window: for every scene, the
// off-axis render from eye E, laid on the screen and seen from E, must match
// an ordinary perspective render through a window-sized hole (src/lab/check.js).
// Runs headless Chromium (~1 min), so it is opt-in:
//   SCENE_GPU_TESTS=1 npm test
// or directly: node tools/scene-shots.mjs --no-stills --check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('scenes match a true window from five eye positions', { skip: process.env.SCENE_GPU_TESTS !== '1', timeout: 600000 }, () => {
  const out = mkdtempSync(join(tmpdir(), 'scene-check-'));
  const r = spawnSync(process.execPath, [join(root, 'tools', 'scene-shots.mjs'), '--no-stills', '--check', '--out', out], {
    cwd: root,
    encoding: 'utf8',
    timeout: 580000,
  });
  const lines = (r.stdout || '').split('\n').filter((l) => l.includes('check '));
  assert.ok(lines.length >= 10, `expected check lines, got:\n${r.stdout}\n${r.stderr}`);
  const failed = lines.filter((l) => l.endsWith('FAIL'));
  assert.equal(failed.length, 0, failed.join('\n'));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSteadyScene } from '../src/app/steady-scene.js';
import { MsaaPass } from '../src/app/msaa.js';

const SIZE = { width: 0.3266, height: 0.2051 };

function geometries(scene) {
  const set = new Set();
  scene.traverse((o) => { if (o.geometry) set.add(o.geometry); });
  return set;
}

function watchDisposed(set) {
  const disposed = new Set();
  for (const g of set) g.addEventListener('dispose', () => disposed.add(g));
  return disposed;
}

test('steady check: a resize to the same size rebuilds nothing', () => {
  const s = createSteadyScene(THREE, SIZE);
  const g0 = geometries(s.scene);
  const disposed = watchDisposed(g0);
  // The app calls resize every frame.
  for (let i = 0; i < 120; i++) s.resize({ ...SIZE });
  const g1 = geometries(s.scene);
  assert.equal(disposed.size, 0, 'nothing disposed');
  assert.deepEqual([...g1], [...g0], 'same geometry objects');
  s.dispose();
});

test('steady check: a new size frees the old markers before building new ones', () => {
  const s = createSteadyScene(THREE, SIZE);
  const g0 = geometries(s.scene);
  const disposed = watchDisposed(g0);
  s.resize({ width: 0.30, height: 0.19 });
  const g1 = geometries(s.scene);
  assert.equal(g1.size, g0.size, 'as many geometries as before');
  const kept = [...g0].filter((g) => g1.has(g));
  // Only the cross (fixed size, outside the rebuilt group) is kept.
  assert.ok(kept.length > 0 && kept.length < 10, `kept ${kept.length}`);
  for (const g of g0) if (!g1.has(g)) assert.ok(disposed.has(g), 'every replaced geometry was disposed');
  for (const g of kept) assert.ok(!disposed.has(g), 'kept geometries stay alive');
  // Disposing the scene frees everything that is left.
  const left = watchDisposed(g1);
  s.dispose();
  assert.equal(left.size, g1.size);
});

test('steady check: its multisampled target can be freed and comes back when needed', () => {
  const calls = [];
  const fakeRenderer = {
    getDrawingBufferSize: (v) => v.set(64, 40),
    getRenderTarget: () => null,
    setRenderTarget: (t) => calls.push(t ? 'target' : 'canvas'),
    render: () => {},
  };
  const pass = new MsaaPass(THREE, fakeRenderer);
  pass.render(new THREE.Scene(), new THREE.PerspectiveCamera());
  const t = pass.target;
  assert.ok(t && t.width === 64 && t.height === 40);
  let freed = false;
  t.addEventListener('dispose', () => { freed = true; });
  pass.release();
  assert.ok(freed && pass.target === null, 'released');
  pass.render(new THREE.Scene(), new THREE.PerspectiveCamera());
  assert.ok(pass.target && pass.target !== t, 'a new target on the next draw');
  assert.equal(pass.quad.material.map, pass.target.texture);
  pass.dispose();
});

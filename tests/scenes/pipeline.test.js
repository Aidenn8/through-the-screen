// The film pipeline and its haze, driven by a stand-in renderer (no GPU):
// the bookkeeping that decides what gets sized when.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FilmPipeline } from '../../src/scenes/_lib/pipeline.js';
import { Haze, HazeLight } from '../../src/scenes/_lib/haze.js';

function fakeRenderer(w, h) {
  return {
    size: { w, h },
    autoClear: true,
    getRenderTarget: () => null,
    getDrawingBufferSize(v) { return v.set(this.size.w, this.size.h); },
    setRenderTarget() {},
    render() {},
  };
}

function makeHaze(scale = 6) {
  const sun = new THREE.SpotLight(0xffffff, 1, 2, 0.4, 0.2);
  sun.position.set(0, 0.2, -0.1);
  sun.target.position.set(0, -0.1, -0.3);
  sun.updateMatrixWorld(true);
  sun.target.updateMatrixWorld(true);
  return new Haze({ density: 1.4, lights: [HazeLight.fromSpot(sun, { shadowSize: 64 })], scale, steps: 8, shadows: false });
}

const camera = new THREE.PerspectiveCamera(50, 1.6, 0.01, 60);
const scene = new THREE.Scene();

test('pipeline: a haze swapped in at the same buffer size is sized before it draws', () => {
  // Box rebuilds its haze when the window size in metres changes; the pixel
  // buffer can stay the same (page zoom in full screen, a new card measure).
  const r = fakeRenderer(2880, 1808);
  const first = makeHaze();
  const pipe = new FilmPipeline(r, { quality: 'high', haze: first });
  pipe.render(scene, camera);
  assert.equal(first.output.width, Math.ceil(2880 / 6));
  const second = makeHaze();
  pipe.haze = second;
  first.dispose();
  assert.doesNotThrow(() => pipe.render(scene, camera));
  assert.ok(second.output, 'the new haze has its targets');
  assert.equal(second.output.width, Math.ceil(2880 / 6));
  assert.equal(second.output.height, Math.ceil(1808 / 6));
  assert.deepEqual([second.fullSize.x, second.fullSize.y], [2880, 1808]);
  // And it keeps drawing, frame after frame.
  for (let i = 0; i < 3; i++) pipe.render(scene, camera);
  pipe.dispose();
  second.dispose();
});

test('pipeline: a new buffer size resizes the targets and the haze together', () => {
  const r = fakeRenderer(2880, 1864);
  const haze = makeHaze(8);
  const pipe = new FilmPipeline(r, { quality: 'high', haze });
  pipe.render(scene, camera);
  const before = pipe.targets.hdr;
  r.size = { w: 2560, h: 1600 };
  pipe.render(scene, camera);
  assert.notEqual(pipe.targets.hdr, before);
  assert.equal(haze.output.width, Math.ceil(2560 / 8));
  assert.equal(haze.output.height, Math.ceil(1600 / 8));
  pipe.dispose();
  haze.dispose();
});

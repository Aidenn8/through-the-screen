// The Soundstage's monitor feeds (src/scenes/soundstage/feeds.js), driven by a
// stand-in renderer (no GPU): feeds of different sizes keep their targets
// from draw to draw, and the refresh clock survives scene time going back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Feeds } from '../../src/scenes/soundstage/feeds.js';

function fakeRenderer(w, h) {
  let bound = null;
  return {
    autoClear: true,
    getRenderTarget: () => bound,
    getDrawingBufferSize: (v) => v.set(w, h),
    setRenderTarget(t) { bound = t; },
    render() {},
    clear() {},
  };
}

function setup() {
  const r = fakeRenderer(2880, 1864);
  const feeds = new Feeds(r, { settings: {} });
  const place = (cam) => { cam.position.set(0, 0, 1); cam.updateMatrixWorld(true); cam.updateProjectionMatrix(); };
  feeds.add('shot', { w: 512, h: 322, place });
  feeds.add('bcam', { w: 448, h: 280, place });
  Object.assign(feeds.o, { scene: new THREE.Scene(), hide: [] });
  // two screens, one per feed, filling the view of a camera at the origin
  const viewer = new THREE.PerspectiveCamera(40, 1.5, 0.01, 10);
  viewer.updateMatrixWorld(true);
  for (const [id, x] of [['shot', -0.2], ['bcam', 0.2]]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2), feeds.material(id));
    s.position.set(x, 0, -1);
    s.updateMatrixWorld(true);
    feeds.watch(s);
  }
  return { feeds, viewer };
}

test('feeds: two feeds of different sizes keep their pipeline targets between draws', () => {
  const { feeds } = setup();
  const [a, b] = feeds.feeds;
  feeds.draw(a);
  feeds.draw(b);
  const ta = a.pipe.targets.hdr;
  const tb = b.pipe.targets.hdr;
  assert.equal(a.pipe.targets.w, 512);
  assert.equal(b.pipe.targets.w, 448);
  for (let i = 0; i < 10; i++) { feeds.draw(a); feeds.draw(b); }
  assert.equal(a.pipe.targets.hdr, ta, 'the shot feed reused its targets');
  assert.equal(b.pipe.targets.hdr, tb, 'the B feed reused its targets');
  feeds.dispose();
});

test('feeds: round robin at ~8 a second per feed, and time going back does not stall it', () => {
  const { feeds, viewer } = setup();
  let draws = 0;
  for (let i = 0; i < 120; i++) if (feeds.update(viewer, i / 60)) draws++;
  // two feeds in view: 8 + 8 a second, plus the first draw of each (stale)
  assert.ok(draws >= 30 && draws <= 36, `draws in 2 s: ${draws}`);
  // a scene reload starts time at 0 again
  let after = 0;
  for (let i = 0; i < 60; i++) if (feeds.update(viewer, i / 60)) after++;
  assert.ok(after >= 14, `draws in the second after time went back: ${after}`);
  feeds.dispose();
});

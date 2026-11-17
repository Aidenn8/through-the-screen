// Live monitor feeds: what the A-camera sees (the shot, from the default
// eye) and what the B-camera sees, rendered into small targets and shown on
// the camera's own monitor and the monitors at video village.
//
// Budget: a feed is a whole scene render, so each one is drawn at low
// resolution (512 x 322 for the shot), through a light pipeline (no haze, no
// MSAA beyond 4x at that size), each feed about 8 times a second (round
// robin: one feed per frame at most), and only while one of its screens is in
// view and big enough to read. Between updates the screens keep the last
// picture. Each feed has its own pipeline: a pipeline sizes its targets to
// the target it draws into, so feeds of different sizes sharing one would
// rebuild them on every draw.

import * as THREE from 'three';
import { applyWindowCamera } from '../../core/projection.js';
import { FilmPipeline } from '../_lib/pipeline.js';

// A monitor's picture in the HDR scene: the feed is display-referred sRGB;
// decode it, and give the panel a faint line structure and falloff.
const screenVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const screenFrag = /* glsl */ `
  uniform sampler2D map;
  uniform float gain;
  uniform vec4 crop; // u0, v0, u1, v1 of the feed shown
  varying vec2 vUv;
  vec3 lin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
  void main() {
    vec2 uv = mix(crop.xy, crop.zw, vUv);
    vec3 c = lin(texture2D(map, uv).rgb);
    float lines = 0.9 + 0.1 * sin(vUv.y * 700.0);
    vec2 d = vUv - 0.5;
    float fall = 1.0 - 0.35 * dot(d, d);
    // a little black never quite black: the panel's own glow
    gl_FragColor = vec4((c * lines * fall + vec3(0.004, 0.005, 0.007)) * gain, 1.0);
  }
`;

export class Feeds {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} o { scene, mirror, rain, settings (pipeline grade), size (window m), hide: [objects hidden in the feeds],
   *   around(feed, before): called before and after a feed draws (to set the scene as that camera sees it) }
   */
  constructor(renderer, o) {
    this.renderer = renderer;
    this.o = o;
    this.feeds = [];
    this.screens = [];
    this.next = 0;
    this.lastT = -1e9;
    this.interval = 1 / 8;
    this.frustum = new THREE.Frustum();
    this.m4 = new THREE.Matrix4();
    this.sphere = new THREE.Sphere();
    this.size = new THREE.Vector2();
    this.mirrorSize = new THREE.Vector2();
    this.want = new Set();
    this.list = [];
    this.updates = 0;
  }

  /** A feed: a camera placed by `place(camera)` into a w x h target. */
  add(id, { w, h, place }) {
    const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: true });
    target.texture.generateMipmaps = false;
    target.texture.minFilter = THREE.LinearFilter;
    target.texture.magFilter = THREE.LinearFilter;
    const mirrorTarget = new THREE.WebGLRenderTarget(Math.round(w / 2), Math.round(h / 2), {
      type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    });
    const camera = new THREE.PerspectiveCamera();
    const pipe = new FilmPipeline(this.renderer, { quality: 'high', haze: null, samples: 4, settings: this.o.settings });
    pipe.noDepth = true;
    const feed = { id, target, mirrorTarget, camera, place, w, h, pipe, stale: true };
    this.feeds.push(feed);
    return feed;
  }

  /** A screen mesh material showing a feed (crop: part of the picture). */
  material(feedId, { gain = 1.4, crop = [0, 0, 1, 1] } = {}) {
    const feed = this.feeds.find((f) => f.id === feedId);
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: feed.target.texture }, gain: { value: gain }, crop: { value: new THREE.Vector4(...crop) } },
      vertexShader: screenVert,
      fragmentShader: screenFrag,
    });
    mat.userData.feed = feedId;
    return mat;
  }

  /** Register a screen mesh (for the in-view test). */
  watch(mesh) {
    this.screens.push(mesh);
  }

  /** Which feeds have a screen in view of `camera`, at least minPx tall. */
  #wanted(camera, bufH) {
    const want = this.want;
    want.clear();
    this.m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.m4);
    const eye = camera.position;
    const fovY = 2 * Math.atan(1 / camera.projectionMatrix.elements[5]);
    for (const s of this.screens) {
      if (!s.visible) continue;
      s.geometry.boundingSphere || s.geometry.computeBoundingSphere();
      this.sphere.copy(s.geometry.boundingSphere).applyMatrix4(s.matrixWorld);
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      const d = Math.max(1e-6, this.sphere.center.distanceTo(eye));
      const px = (2 * this.sphere.radius / d) / fovY * bufH;
      if (px > 24) for (const f of s.userData.feeds ?? [s.material.userData.feed]) want.add(f);
    }
    return want;
  }

  /**
   * Before the main frame: maybe refresh one feed. `t` seconds.
   * Returns true if a feed was drawn this frame.
   */
  update(camera, t, { force = false } = {}) {
    const r = this.renderer;
    r.getDrawingBufferSize(this.size);
    let want;
    if (force) {
      want = this.want;
      want.clear();
      for (const f of this.feeds) want.add(f.id);
    } else want = this.#wanted(camera, this.size.y);
    if (!want.size) return false;
    // scene time can jump back (a seek, a scene reload): start the clock again
    if (t < this.lastT) this.lastT = t - this.interval;
    if (!force && t - this.lastT < this.interval / want.size && !this.feeds.some((f) => want.has(f.id) && f.stale)) return false;
    const list = this.list;
    list.length = 0;
    for (const f of this.feeds) if (want.has(f.id)) list.push(f);
    const feed = list.find((f) => f.stale) ?? list[this.next++ % list.length];
    this.draw(feed);
    if (force) for (const f of list) if (f !== feed) this.draw(f);
    this.lastT = t;
    return true;
  }

  draw(feed) {
    const r = this.renderer;
    const { scene, mirror, rain } = this.o;
    feed.place(feed.camera);
    this.o.around?.(feed, true);
    const hidden = this.hidden ??= [];
    hidden.length = 0;
    for (const o of this.o.hide ?? []) if (o.visible) { o.visible = false; hidden.push(o); }
    for (const s of this.screens) if (s.visible) { s.visible = false; hidden.push(s); }
    const px = rain?.uniforms.uPxPerDist.value;
    if (rain) rain.uniforms.uPxPerDist.value = 2 * Math.tan(THREE.MathUtils.degToRad(feed.camera.fov) / 2) / feed.h;
    const prev = r.getRenderTarget();
    mirror?.renderTo(r, feed.camera, feed.mirrorTarget, this.mirrorSize.set(feed.w, feed.h));
    r.setRenderTarget(feed.target);
    feed.pipe.render(scene, feed.camera, { bloom: true });
    r.setRenderTarget(prev);
    mirror?.restore();
    if (rain) rain.uniforms.uPxPerDist.value = px;
    for (const o of hidden) o.visible = true;
    this.o.around?.(feed, false);
    feed.stale = false;
    this.updates++;
  }

  dispose() {
    for (const f of this.feeds) { f.target.dispose(); f.mirrorTarget.dispose(); f.pipe.dispose(); }
  }
}

/** Place a camera exactly as the shot sees it: the window at identity, the default eye. */
export function shotPlacer(size) {
  return (camera) => applyWindowCamera(camera, { x: 0, y: 0, z: 0.6 }, size.width, size.height, { near: 0.01, far: 60 });
}

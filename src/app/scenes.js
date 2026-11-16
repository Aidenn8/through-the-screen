// Scene discovery and lifecycle (contract in docs/ARCHITECTURE.md).

import * as THREE from 'three';
import placeholder from './placeholder-scene.js';

const modules = import.meta.glob('../scenes/*/index.js');

/** @returns {Promise<{id:string,title:string,def:object}[]>} */
export async function discoverScenes({ includePlaceholder = false } = {}) {
  const found = [];
  for (const [path, load] of Object.entries(modules)) {
    try {
      const mod = await load();
      const def = mod.default;
      if (def && typeof def.create === 'function') {
        found.push({ id: def.id || path.split('/').at(-2), title: def.title || def.id, def, order: def.order ?? 100 });
      }
    } catch (err) {
      console.warn(`Scene ${path} failed to load:`, err);
    }
  }
  found.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  if (includePlaceholder || found.length === 0) {
    found.push({ id: placeholder.id, title: placeholder.title, def: placeholder, order: 1000 });
  }
  return found;
}

function resetRenderer(renderer) {
  renderer.setRenderTarget(null);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = false;
  renderer.autoClear = true;
  renderer.setClearColor(0x000000, 1);
}

export class SceneHost {
  /**
   * @param {object} renderer THREE.WebGLRenderer
   * @param {{draw?:(scene, camera)=>void}} [o] how to draw a scene that has no
   *   render() of its own (the app passes its multisampled pass)
   */
  constructor(renderer, { draw = null } = {}) {
    this.renderer = renderer;
    this.draw = draw;
    this.current = null; // { id, title, inst }
    this.loading = null;
  }

  /**
   * Swap scenes. The previous scene is disposed first (scenes may restore
   * renderer state in dispose), and the renderer is reset to defaults before
   * the next create. While it loads nothing is drawn, so the last frame stays
   * on screen.
   */
  async load(entry, size, quality = 'high') {
    const token = {};
    this.loading = token;
    const prev = this.current;
    this.current = null;
    if (prev) {
      try { prev.inst.dispose?.(); } catch (err) { console.warn(err); }
    }
    resetRenderer(this.renderer);
    const ctx = {
      THREE,
      renderer: this.renderer,
      size: { ...size },
      assetBase: `${import.meta.env.BASE_URL}assets/${entry.id}/`,
      quality,
    };
    let inst;
    try {
      inst = await entry.def.create(ctx);
    } catch (err) {
      console.error(`Scene ${entry.id} failed to start:`, err);
      if (this.loading === token) this.loading = null;
      throw err;
    }
    if (this.loading !== token) {
      inst.dispose?.();
      return null;
    }
    this.current = { id: entry.id, title: entry.title, inst, size: { ...size } };
    this.loading = null;
    return this.current;
  }

  resize(size) {
    const c = this.current;
    if (!c) return;
    if (Math.abs(c.size.width - size.width) < 1e-6 && Math.abs(c.size.height - size.height) < 1e-6) return;
    c.size = { ...size };
    c.inst.resize?.({ ...size });
  }

  update(dt, time, eye) {
    this.current?.inst.update?.(dt, time, eye);
  }

  render(camera) {
    const inst = this.current?.inst;
    if (!inst) return;
    if (inst.render) inst.render(this.renderer, camera);
    else if (this.draw) this.draw(inst.scene, camera);
    else this.renderer.render(inst.scene, camera);
  }

  dispose() {
    this.current?.inst.dispose?.();
    this.current = null;
  }

  static resetRenderer = resetRenderer;
}

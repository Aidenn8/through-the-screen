// Per-section frame timing for the scene lab.
//
// Timer queries (EXT_disjoint_timer_query_webgl2) are exposed by Chrome on
// Apple silicon but, through ANGLE's Metal backend, report command-buffer
// spans rather than shader time, so they are not trustworthy here. Instead
// each section is bracketed by a full GPU sync and timed on the wall clock.
//
// The sync must depend on the section's own output. Reading a pixel of the
// canvas does not: ANGLE only waits for pending writes to the framebuffer it
// reads, so a canvas read between offscreen passes returns at once and every
// offscreen pass lands in whichever section next touches the canvas. So each
// section ends by reading one pixel of the render target it wrote (passed to
// end()), falling back to gl.finish() when it wrote nothing readable.
//
// This serialises CPU and GPU, so the numbers are upper bounds; the sync
// itself costs ~0.1 ms per section. Scenes call renderer.__prof?.begin(name)
// and renderer.__prof?.end(target) around their passes.

const f32 = new Float32Array(4);
const u8 = new Uint8Array(4);

export class SyncTimer {
  /** @param {THREE.WebGLRenderer} renderer */
  constructor(renderer) {
    this.renderer = renderer;
    this.gl = renderer.getContext();
    this.open = null;
    this.results = new Map();
  }

  // Wait for the GPU to finish writing `target` (a WebGLRenderTarget, or null
  // for the canvas). Reads one pixel through the target's own framebuffer.
  sync(target) {
    const gl = this.gl;
    const prevRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    if (target === null) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, u8);
    } else if (target && target.isWebGLRenderTarget) {
      const p = this.renderer.properties.get(target);
      const fb = Array.isArray(p.__webglFramebuffer) ? p.__webglFramebuffer[0] : p.__webglFramebuffer;
      if (!fb) { gl.finish(); return; }
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
      const type = target.texture.type;
      // float and packed-float targets read back as RGBA/FLOAT (EXT_color_buffer_float)
      if (type === 1015 || type === 1016 || type === 35899 /* UnsignedInt101111Type */) {
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, f32);
      } else {
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, u8);
      }
    } else {
      gl.finish();
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, u8);
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prevRead);
  }

  begin(name) {
    if (this.open) this.end();
    this.open = { name, t0: performance.now() };
  }

  /** @param {THREE.WebGLRenderTarget|null|undefined} target what this section wrote */
  end(target) {
    if (!this.open) return;
    this.sync(target);
    const ms = performance.now() - this.open.t0;
    if (!this.results.has(this.open.name)) this.results.set(this.open.name, []);
    this.results.get(this.open.name).push(ms);
    this.open = null;
  }

  /** Call once before a frame so the first section does not absorb earlier work. */
  fence() {
    this.gl.finish();
    this.sync(null);
  }

  summary() {
    const out = {};
    for (const [k, v] of this.results) {
      const s = [...v].sort((a, b) => a - b);
      out[k] = { mean: s.reduce((a, b) => a + b, 0) / s.length, p50: s[Math.floor(s.length / 2)], p95: s[Math.floor(s.length * 0.95)], n: s.length };
    }
    return out;
  }
}

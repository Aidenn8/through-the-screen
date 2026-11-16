// Multisampled drawing for the app's own scenes (steady check, test room).
//
// The canvas is created without antialiasing: the real scenes multisample
// into their own HDR targets and finish with one full-screen pass, so canvas
// MSAA only cost them 0.2-1.3 ms a frame (docs/SCENES_NOTES.md). Scenes that
// draw straight to the canvas go through this pass instead: render into a
// 4x multisampled target (linear, half float), then copy to the canvas,
// where the renderer's sRGB output conversion applies once.

export class MsaaPass {
  constructor(THREE, renderer, { samples = 4 } = {}) {
    this.THREE = THREE;
    this.renderer = renderer;
    this.samples = samples;
    this.target = null;
    this.size = new THREE.Vector2();
    this.quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false, toneMapped: false }),
    );
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  render(scene, camera) {
    const { THREE, renderer: r } = this;
    r.getDrawingBufferSize(this.size);
    const w = Math.max(1, this.size.x);
    const h = Math.max(1, this.size.y);
    if (!this.target || this.target.width !== w || this.target.height !== h) {
      this.target?.dispose();
      this.target = new THREE.WebGLRenderTarget(w, h, { samples: this.samples, type: THREE.HalfFloatType, depthBuffer: true });
      this.quad.material.map = this.target.texture;
      this.quad.material.needsUpdate = true;
    }
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.target);
    r.render(scene, camera);
    r.setRenderTarget(prev);
    r.render(this.scene, this.camera);
  }

  /**
   * Free the GPU memory: the multisampled target (about 300 MB at 2880 x
   * 1864) and the quad's buffers. The next draw makes them again.
   */
  release() {
    this.target?.dispose();
    this.target = null;
    this.quad.material.map = null;
    this.quad.geometry.dispose();
  }

  dispose() {
    this.release();
    this.quad.material.dispose();
  }
}

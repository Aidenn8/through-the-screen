// Tighter frustum culling for static merged meshes. A Builder merges every
// part with one material into one mesh, so a mesh can span the whole stage;
// three culls by bounding sphere, which for a long, flat spread of parts is
// far bigger than the parts. A world box per mesh, computed once, culls those
// that lie wholly outside the view (behind the eye, off to the side).
//
// Only for meshes that never move. Visibility is the cull's own: reset()
// before anything else renders the scene from another camera (a monitor's
// feed), apply(camera) right before the main view.

import * as THREE from 'three';

export class TightCull {
  /** @param {THREE.Mesh[]} meshes static, matrixWorld already up to date */
  constructor(meshes) {
    this.items = meshes.map((mesh) => {
      mesh.geometry.boundingBox || mesh.geometry.computeBoundingBox();
      return { mesh, box: mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld) };
    });
    this.frustum = new THREE.Frustum();
    this.m4 = new THREE.Matrix4();
    this.culled = 0;
  }

  /** Everything drawn again (another camera is about to render). */
  reset() {
    for (const it of this.items) it.mesh.visible = true;
  }

  /** Hide the meshes whose box is wholly outside `camera`'s view. */
  apply(camera) {
    this.m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.m4);
    let n = 0;
    for (const it of this.items) {
      const v = this.frustum.intersectsBox(it.box);
      it.mesh.visible = v;
      if (!v) n++;
    }
    this.culled = n;
  }
}

// Steady check: markers whose motion exposes calibration errors.
//
// - A thin frame on the glass (z = 0) never moves: it is the physical reference.
// - A tunnel of frames runs back to far rings 2 m behind the glass. If the eye
//   spacing is wrong the whole eye estimate is scaled about the camera, and the
//   far rings slide with (spacing too large) or against (too small) a sideways
//   sway. Eye spacing does not change with distance error from the field of
//   view; leaning in and out does, which is how the two are told apart.
// - A small ring hangs 7 cm in front of the glass: it slides the opposite way.
// - Cross view: everything black except a cross on the glass at the tracked
//   eye's (x, y). The glossy screen is a mirror: held still, with one eye
//   closed, the cross must sit on that eye's reflection. A dark screen makes
//   the reflection visible; the cross is grey and open in the middle so it
//   frames the pupil instead of covering it.

export function createSteadyScene(THREE, size) {
  let W = size.width;
  let H = size.height;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const root = new THREE.Group();
  scene.add(root);

  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const dim = new THREE.MeshBasicMaterial({ color: 0x2b2e34 });
  const far = new THREE.MeshBasicMaterial({ color: 0xbfd4ff });
  const near = new THREE.MeshBasicMaterial({ color: 0xffc06a });
  const crossMat = new THREE.MeshBasicMaterial({ color: 0xa8a8a8, depthTest: false });

  function frame(w, h, z, t, mat) {
    const g = new THREE.Group();
    const bar = (bw, bh, x, y) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), mat);
      m.position.set(x, y, z);
      g.add(m);
    };
    bar(w, t, 0, h / 2 - t / 2);
    bar(w, t, 0, -h / 2 + t / 2);
    bar(t, h, -w / 2 + t / 2, 0);
    bar(t, h, w / 2 - t / 2, 0);
    return g;
  }

  function rings(x, y, z, r, mat, n = 3) {
    const g = new THREE.Group();
    for (let i = 0; i < n; i++) {
      const rr = r * (1 - i * 0.32);
      const m = new THREE.Mesh(new THREE.RingGeometry(rr - r * 0.07, rr, 64), mat);
      g.add(m);
    }
    const dot = new THREE.Mesh(new THREE.CircleGeometry(r * 0.08, 24), mat);
    g.add(dot);
    g.position.set(x, y, z);
    return g;
  }

  const cross = new THREE.Group();
  {
    // Four arms from 7 to 16 mm out, and a thin ring 5 mm across the middle.
    const t = 0.0006;
    const r0 = 0.007;
    const r1 = 0.016;
    const len = r1 - r0;
    const mid = (r0 + r1) / 2;
    for (const [x, y, w, hh] of [[mid, 0, len, t], [-mid, 0, len, t], [0, mid, t, len], [0, -mid, t, len]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), crossMat);
      m.position.set(x, y, 0);
      m.renderOrder = 10;
      cross.add(m);
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.0047, 0.0053, 64), crossMat);
    ring.renderOrder = 10;
    cross.add(ring);
    cross.visible = false;
    scene.add(cross);
  }

  function build() {
    // Free the old markers first: geometries hold GPU buffers until disposed.
    root.traverse((o) => o.geometry?.dispose());
    root.clear();
    // On the glass: the physical reference.
    root.add(frame(W - 0.004, H - 0.004, 0, 0.0012, white));
    // Tunnel back to the far plane.
    for (const z of [-0.05, -0.12, -0.22, -0.36, -0.55, -0.8, -1.2, -2]) root.add(frame(W, H, z, 0.0009 * (1 - z), dim));
    // Far rings: centre and four around it, 2 m behind the glass.
    const zf = -2;
    const rf = 0.08;
    root.add(rings(0, 0, zf, rf, far));
    for (const [sx, sy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) root.add(rings(sx * W * 1.05, sy * H * 1.0, zf, rf * 0.6, far, 2));
    // Near ring in front of the glass, low and right: clear of the far rings
    // and of the panel on the left.
    root.add(rings(W * 0.2, -H * 0.18, 0.07, 0.011, near, 2));
  }
  build();

  return {
    scene,
    /** @param {'rings'|'cross'} view */
    setView(view) {
      cross.visible = view === 'cross';
      root.visible = view !== 'cross';
    },
    update(dt, time, eye) {
      cross.position.set(eye.x, eye.y, 0.0005);
    },
    resize(s) {
      // The app calls this every frame: rebuild only for a new window size.
      if (Math.abs(s.width - W) < 1e-6 && Math.abs(s.height - H) < 1e-6) return;
      W = s.width;
      H = s.height;
      build();
    },
    dispose() {
      scene.traverse((o) => o.geometry?.dispose());
      for (const m of [white, dim, far, near, crossMat]) m.dispose();
    },
  };
}

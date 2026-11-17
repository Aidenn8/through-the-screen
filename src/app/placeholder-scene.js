// Fallback scene when no scenes are installed: a room exactly the size of the
// window running back behind the glass, with targets on stems at several
// depths and one hanging in front of the glass. Cheap to draw.

export default {
  id: 'test-room',
  title: 'Test room',
  // Places to carry the window to (docs/ARCHITECTURE.md), for building and
  // testing navigation. Laid out for the 15-inch Air's window (33 x 21 cm);
  // the room is the window's size and 45 cm deep. At the smaller scales the
  // eye (s x 60 cm in front of the window) stays inside the room.
  nav: {
    stations: [
      { id: 'glass', title: 'At the glass', pose: { position: [0, 0, 0] } },
      { id: 'red', title: 'By the red target', pose: { position: [-0.08, 0.02, -0.2], yaw: 0, pitch: 0, scale: 0.2 } },
      { id: 'right-wall', title: 'Toward the right wall', pose: { position: [-0.06, 0, -0.1], yaw: -60, pitch: 0, scale: 0.15 } },
      { id: 'floor', title: 'Looking down at the floor', pose: { position: [0, 0, -0.2], yaw: 20, pitch: -55, scale: 0.15 } },
      { id: 'up', title: 'Looking up at the ceiling', pose: { position: [0, -0.02, -0.1], yaw: 0, pitch: 50, scale: 0.15 } },
      { id: 'back', title: 'Turned round at the back', pose: { position: [0.05, 0, -0.3], yaw: 150, pitch: -10, scale: 0.2 } },
    ],
    bounds: { min: [-0.14, -0.09, -0.4], max: [0.14, 0.09, 0.1] },
    scale: [0.12, 1.5],
    tour: ['red', 'right-wall', 'floor', 'up', 'back', 'glass'],
  },
  async create(ctx) {
    const { THREE } = ctx;
    let { width: W, height: H } = ctx.size;
    const DEPTH = 0.45;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0c0e);

    const room = new THREE.Group();
    scene.add(room);
    const wall = new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: 0.95 });
    const lineMat = new THREE.MeshBasicMaterial({ color: 0x4a4e57 });
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x9aa0aa, roughness: 0.4, metalness: 0.6 });
    const faceMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 });
    const ringMats = [0xd8483b, 0x2f7fd8, 0xe0a526].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }));

    function strip(w, h, pos, rot) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lineMat);
      m.position.set(...pos);
      m.rotation.set(...rot);
      return m;
    }

    function target(x, y, z, r, mat) {
      const g = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 48), faceMat);
      const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.45, r * 0.75, 48), mat);
      ring.position.z = 0.0005;
      const dot = new THREE.Mesh(new THREE.CircleGeometry(r * 0.18, 32), mat);
      dot.position.z = 0.0005;
      g.add(disc, ring, dot);
      g.position.set(x, y, z);
      // Stem back to the rear wall.
      const len = z + DEPTH;
      if (len > 0.001) {
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, len, 12), stemMat);
        stem.rotation.x = Math.PI / 2;
        stem.position.set(x, y, z - len / 2);
        room.add(stem);
      }
      room.add(g);
    }

    function build() {
      room.clear();
      const add = (w, h, pos, rot) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wall);
        m.position.set(...pos);
        m.rotation.set(...rot);
        room.add(m);
      };
      add(W, H, [0, 0, -DEPTH], [0, 0, 0]);
      add(W, DEPTH, [0, -H / 2, -DEPTH / 2], [-Math.PI / 2, 0, 0]);
      add(W, DEPTH, [0, H / 2, -DEPTH / 2], [Math.PI / 2, 0, 0]);
      add(DEPTH, H, [-W / 2, 0, -DEPTH / 2], [0, Math.PI / 2, 0]);
      add(DEPTH, H, [W / 2, 0, -DEPTH / 2], [0, -Math.PI / 2, 0]);
      // Grid lines every 5 cm on the walls make the depth readable.
      const t = 0.0009;
      for (let z = -0.05; z > -DEPTH; z -= 0.05) {
        room.add(strip(W, t, [0, -H / 2 + 0.0005, z], [-Math.PI / 2, 0, 0]));
        room.add(strip(W, t, [0, H / 2 - 0.0005, z], [Math.PI / 2, 0, 0]));
        room.add(strip(t, H, [-W / 2 + 0.0005, 0, z], [0, Math.PI / 2, 0]));
        room.add(strip(t, H, [W / 2 - 0.0005, 0, z], [0, -Math.PI / 2, 0]));
      }
      for (let x = -W / 2 + 0.05; x < W / 2; x += 0.05) {
        room.add(strip(t, H, [x, 0, -DEPTH + 0.0005], [0, 0, 0]));
        room.add(strip(t, DEPTH, [x, -H / 2 + 0.0005, -DEPTH / 2], [-Math.PI / 2, 0, 0]));
      }
      for (let y = -H / 2 + 0.05; y < H / 2; y += 0.05) {
        room.add(strip(W, t, [0, y, -DEPTH + 0.0005], [0, 0, 0]));
      }
      target(-W * 0.28, H * 0.12, -0.32, 0.022, ringMats[0]);
      target(W * 0.22, -H * 0.18, -0.2, 0.02, ringMats[1]);
      target(W * 0.05, H * 0.2, -0.08, 0.016, ringMats[2]);
      target(-W * 0.12, -H * 0.22, 0.04, 0.012, ringMats[0]);
    }
    build();

    const key = new THREE.PointLight(0xfff1dc, 0.35, 0, 1.4);
    key.position.set(W * 0.2, H * 0.45, 0.05);
    scene.add(key);
    scene.add(new THREE.HemisphereLight(0xc9d6e6, 0x2a2420, 1.4));

    return {
      scene,
      update() {},
      resize(size) {
        W = size.width;
        H = size.height;
        build();
      },
      dispose() {
        scene.traverse((o) => {
          o.geometry?.dispose();
        });
        for (const m of [wall, lineMat, stemMat, faceMat, ...ringMats]) m.dispose();
      },
    };
  },
};

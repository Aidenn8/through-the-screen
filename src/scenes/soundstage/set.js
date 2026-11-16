// The street set: a corner diner front on a rainy night, built as a film set
// would be (flats on a raised street deck), in real metres.

import * as THREE from 'three';
import { Builder, boxUV, planeUV, mat4, tube } from '../_lib/geo.js';
import { neonWord } from './neon.js';
import { DECK, WALK, DINER, SIDE_STREET, BRICK_WALL, FRONT_EDGE, WALK_EDGE, BACKING_Z, STREET_END } from './layout.js';

const FLAT = 0.1; // flat thickness

export function buildSet(root, m) {
  const B = new Builder();
  const noShadow = { cast: false, receive: false };

  // ---------------------------------------------------------- ground
  // Street deck: front strip and side street.
  const deckParts = [
    // [x0, x1, z0, z1]
    [STREET_END, 6.6, -0.2, FRONT_EDGE],
    [SIDE_STREET.x0 - 0.4, SIDE_STREET.x1, SIDE_STREET.back, -0.2],
  ];
  for (const [x0, x1, z0, z1] of deckParts) {
    const w = x1 - x0;
    const d = z1 - z0;
    // top surface (asphalt), separate so it can be wet
    B.add('asphalt', m.asphalt, planeUV(w, d, 1), mat4([(x0 + x1) / 2, DECK, (z0 + z1) / 2], [-Math.PI / 2, 0, 0]), { cast: false, receive: true });
    // deck body below
    B.box('deckEdge', m.deckEdge, [w, DECK - 0.002, d], [(x0 + x1) / 2, DECK / 2 - 0.001, (z0 + z1) / 2]);
  }
  // Sidewalks (raised): in front of the diner, and along both sides of the side street.
  const walks = [
    [DINER.x0 - 1.4, 6.0, 0, WALK_EDGE], // front + corner
    [DINER.x0 - 1.4, DINER.x0, SIDE_STREET.back, 0], // along the diner side
    [BRICK_WALL.x, BRICK_WALL.x + 0.9, SIDE_STREET.back, BRICK_WALL.z0], // along the brick wall
  ];
  for (const [x0, x1, z0, z1] of walks) {
    const w = x1 - x0;
    const d = z1 - z0;
    B.add('sidewalk', m.sidewalk, planeUV(w, d, 1), mat4([(x0 + x1) / 2, WALK, (z0 + z1) / 2], [-Math.PI / 2, 0, 0]), { cast: false, receive: true });
    B.box('curb', m.curb, [w, WALK - DECK - 0.002, d], [(x0 + x1) / 2, (WALK + DECK) / 2, (z0 + z1) / 2]);
  }
  // Painted crosswalk across the side street mouth: strong perspective lines.
  for (let i = 0; i < 6; i++) {
    const x = SIDE_STREET.x0 + 0.95 + i * 0.5;
    if (x > DINER.x0 - 1.5) break;
    B.add('stripe', m.tape, planeUV(0.32, 1.6, 1), mat4([x, DECK + 0.003, WALK_EDGE + 1.0], [-Math.PI / 2, 0, 0]), { cast: false, receive: true });
  }
  // A one-way arrow painted down the street's near lane: from the shot's
  // height it foreshortens to a sliver; from high above it is the mark the
  // eye lands on among the puddles
  {
    const a = new THREE.Shape();
    a.moveTo(0, -0.11); a.lineTo(1.5, -0.11); a.lineTo(1.5, -0.32); a.lineTo(2.2, 0); a.lineTo(1.5, 0.32); a.lineTo(1.5, 0.11); a.lineTo(0, 0.11); a.lineTo(0, -0.11);
    B.add('roadPaint', m.roadPaint, new THREE.ShapeGeometry(a), mat4([-0.2, DECK + 0.003, 4.9], [-Math.PI / 2, 0, Math.PI]), { cast: false, receive: true });
  }
  // Stop line in front of the diner
  B.add('stripe', m.tape, planeUV(2.6, 0.18, 1), mat4([1.6, DECK + 0.003, WALK_EDGE + 1.6], [-Math.PI / 2, 0, 0]), { cast: false, receive: true });

  // ---------------------------------------------------------- diner facade
  const { x0, x1 } = DINER;
  const fz = 0; // facade line
  const W = x1 - x0;
  const cx = (x0 + x1) / 2;
  // wainscot: glossy teal tile with a chrome cap
  B.box('tile', m.tile, [W, 1.0 - WALK, 0.08], [cx, (1.0 + WALK) / 2, fz + 0.04]);
  B.box('chrome', m.chrome, [W, 0.05, 0.11], [cx, 1.02, fz + 0.055]);
  // window band openings: [x0, x1]
  const openings = [[-1.45, -0.15], [-0.03, 1.27], [1.39, 2.69], [2.85, 3.8, 'door'], [3.95, 5.25]];
  const winY0 = 1.05;
  const winY1 = 2.6;
  // piers between openings
  let px = x0;
  for (const [a, b, kind] of openings) {
    if (a > px + 1e-3) B.box('stucco', m.stucco, [a - px, winY1 - winY0, FLAT], [(a + px) / 2, (winY0 + winY1) / 2, fz - FLAT / 2]);
    // aluminium frame around the opening
    const y0 = kind === 'door' ? WALK : winY0;
    B.box('aluminum', m.aluminum, [0.06, winY1 - y0, 0.14], [a + 0.03, (y0 + winY1) / 2, fz]);
    B.box('aluminum', m.aluminum, [0.06, winY1 - y0, 0.14], [b - 0.03, (y0 + winY1) / 2, fz]);
    B.box('aluminum', m.aluminum, [b - a, 0.06, 0.14], [(a + b) / 2, winY1 - 0.03, fz]);
    if (kind !== 'door') B.box('aluminum', m.aluminum, [b - a, 0.05, 0.16], [(a + b) / 2, winY0 + 0.025, fz]);
    // glass
    const gy0 = kind === 'door' ? WALK + 0.1 : winY0 + 0.05;
    const gy1 = kind === 'door' ? winY1 - 0.32 : winY1 - 0.06;
    B.add('glass', m.glass, new THREE.PlaneGeometry(b - a - 0.12, gy1 - gy0), mat4([(a + b) / 2, (gy0 + gy1) / 2, fz - 0.01]), noShadow);
    if (kind === 'door') {
      // door leaf frame, kick plate, push bar, transom
      B.box('aluminum', m.aluminum, [b - a - 0.12, 0.08, 0.05], [(a + b) / 2, winY1 - 0.3, fz]);
      B.box('chrome', m.chrome, [b - a - 0.14, 0.3, 0.04], [(a + b) / 2, WALK + 0.17, fz + 0.01]);
      B.rod('chrome', m.chrome, [a + 0.12, 1.1, fz + 0.09], [b - 0.12, 1.1, fz + 0.09], 0.018, 8);
      B.add('windowLit', m.windowLit, new THREE.PlaneGeometry(b - a - 0.14, 0.18), mat4([(a + b) / 2, winY1 - 0.16, fz - 0.03]), noShadow);
    }
    px = b;
  }
  if (x1 > px) B.box('stucco', m.stucco, [x1 - px, winY1 - winY0, FLAT], [(x1 + px) / 2, (winY0 + winY1) / 2, fz - FLAT / 2]);
  // sign band with chrome speed stripes
  B.box('signBand', m.signBand, [W, 0.9, FLAT + 0.06], [cx, winY1 + 0.45, fz - 0.02]);
  for (const y of [winY1 + 0.08, winY1 + 0.14, winY1 + 0.82]) B.box('chrome', m.chrome, [W, 0.025, 0.02], [cx, y, fz + 0.05]);
  // upper wall and cornice
  B.box('stucco', m.stucco, [W, DINER.height - (winY1 + 0.9), FLAT], [cx, (DINER.height + winY1 + 0.9) / 2, fz - FLAT / 2]);
  B.box('cornice', m.stucco, [W + 0.2, 0.16, 0.3], [cx, DINER.height - 0.08, fz + 0.05]);
  B.box('cornice', m.stucco, [W + 0.1, 0.08, 0.2], [cx, DINER.height - 0.24, fz + 0.02]);
  // brackets under the cornice
  for (let x = x0 + 0.25; x < x1 - 0.1; x += 0.7) {
    B.box('cornice', m.stucco, [0.08, 0.2, 0.16], [x, DINER.height - 0.36, fz + 0.08]);
    B.box('cornice', m.stucco, [0.08, 0.06, 0.1], [x, DINER.height - 0.49, fz + 0.05]);
  }
  // a faded painted sign on the upper wall, lit by three gooseneck sign lamps
  // (their pools are baked into the wall's emissive map)
  const upperY0 = winY1 + 0.9;
  const upperY1 = DINER.height - 0.28;
  B.add('stuccoUpper', m.upperWall, new THREE.PlaneGeometry(W, upperY1 - upperY0), mat4([cx, (upperY0 + upperY1) / 2, fz + 0.003]), { cast: false, receive: true });
  for (const lx of m.upperWallLamps) {
    const x = x0 + lx;
    B.add('castIron', m.castIron, tube([[x, DINER.height - 0.02, fz + 0.18], [x, DINER.height + 0.2, fz + 0.28], [x, DINER.height + 0.24, fz + 0.48], [x, DINER.height + 0.1, fz + 0.62]], 0.014, 24, 6));
    const shade = new THREE.LatheGeometry([[0.0, 0.0], [0.03, 0.0], [0.05, -0.03], [0.1, -0.08], [0.15, -0.14], [0.155, -0.155]].map(([r, y]) => new THREE.Vector2(r, y)), 24);
    // opening tilted down and back toward the wall
    const sm = mat4([x, DINER.height + 0.1, fz + 0.62], [0.55, 0, 0]);
    B.add('shade', m.shade, shade, sm);
    B.add('bulb', m.bulb, new THREE.CircleGeometry(0.06, 16), new THREE.Matrix4().multiplyMatrices(sm, mat4([0, -0.1, 0], [Math.PI / 2, 0, 0])), { cast: false, receive: false });
  }
  // flat edges visible from the side (raw)
  B.box('flatEdge', m.flatEdge, [0.04, DINER.height - DECK, 0.3], [x1 + 0.02, (DINER.height + DECK) / 2, fz - 0.1]);

  // Neon: DINER on the sign band, with dark letter channels behind.
  const neonGeoms = [];
  const word = neonWord('DINER', { size: 0.52, tube: 0.016, spacing: 0.3 });
  const wordX = 1.0 - word.length / 2;
  for (const g of word.geoms) {
    g.applyMatrix4(mat4([wordX, winY1 + 0.2, fz + 0.1]));
    neonGeoms.push(g);
  }
  // OPEN in the door transom glass, teal
  const open = neonWord('OPEN', { size: 0.13, tube: 0.007, spacing: 0.25 });
  for (const g of open.geoms) {
    g.applyMatrix4(mat4([3.32 - open.length / 2, winY1 - 0.23, fz - 0.06]));
    B.add('neonTeal', m.neonTeal, g, null, noShadow);
  }

  // Blade sign EATS at the corner, sticking out into the side street.
  const bx = x0 - 0.5;
  B.box('redEnamel', m.redEnamel, [0.9, 2.1, 0.22], [bx, 3.55, -0.25]);
  B.box('chrome', m.chrome, [0.96, 0.05, 0.26], [bx, 4.62, -0.25]);
  B.box('chrome', m.chrome, [0.96, 0.05, 0.26], [bx, 2.48, -0.25]);
  B.rod('darkMetal', m.darkMetal, [x0, 4.3, -0.25], [bx - 0.4, 4.3, -0.25], 0.02);
  B.rod('darkMetal', m.darkMetal, [x0, 2.8, -0.25], [bx - 0.4, 2.8, -0.25], 0.02);
  const eats = neonWord('EATS', { size: 0.36, tube: 0.014, spacing: 0.12, vertical: true });
  // EATS in cyan against the sodium lamp: the orange/cyan contrast of real rainy streets
  for (const g of eats.geoms) {
    g.applyMatrix4(mat4([bx, 4.15, -0.25 + 0.13]));
    B.add('neonCyan', m.neonTeal, g, null, noShadow);
  }
  for (const g of neonGeoms) B.add('neonPink', m.neonPink, g, null, noShadow);

  // Venetian blinds, part-lowered, in two windows and the corner side window.
  const blinds = (a, b, top, bottom, z, rotY = 0, xc = null) => {
    for (let y = top; y > bottom; y -= 0.075) {
      const geo = boxUV(b - a - 0.14, 0.05, 0.004);
      const mm = rotY
        ? mat4([xc, y, (a + b) / 2], [0.95, rotY, 0])
        : mat4([(a + b) / 2, y, z], [0.95, 0, 0]);
      B.add('blinds', m.blinds, geo, mm);
    }
    // bottom rail and cords
    if (!rotY) {
      B.box('blinds', m.blinds, [b - a - 0.12, 0.03, 0.03], [(a + b) / 2, bottom, z]);
      for (const cx2 of [a + 0.3, b - 0.3]) B.rod('blinds', m.blinds, [cx2, top + 0.03, z + 0.02], [cx2, bottom, z + 0.02], 0.003, 4, noShadow);
    }
  };
  blinds(-0.03, 1.27, 2.5, 1.62, fz - 0.12);
  blinds(1.39, 2.69, 2.5, 2.05, fz - 0.12);
  blinds(-1.45, -0.15, 2.5, 1.9, fz - 0.12);
  blinds(3.95, 5.25, 2.5, 1.75, fz - 0.12);

  // ---------------------------------------------------------- diner interior
  const ib = DINER.back;
  const iw = W - 0.2;
  B.add('checker', m.checker, planeUV(iw, -ib, 1), mat4([cx, DECK + 0.01, ib / 2], [-Math.PI / 2, 0, 0]), { cast: false, receive: true });
  B.box('wallIn', m.wallIn, [iw, 3.4, FLAT], [cx, DECK + 1.7, ib - FLAT / 2]); // back wall
  B.box('wallIn', m.wallIn, [FLAT, 3.4, -ib], [x1 - 0.1 - FLAT / 2, DECK + 1.7, ib / 2]); // right wall
  B.box('wallIn', m.wallIn, [iw, FLAT, -ib], [cx, DECK + 3.4, ib / 2], [0, 0, 0], { cast: false }); // ceiling
  // wainscot inside and a shelf of pies/cups along the back
  B.box('tileIn', m.tileIn, [iw, 1.0, 0.03], [cx, DECK + 0.5, ib + 0.02]);
  for (const y of [1.55, 1.95]) B.box('chromeIn', m.chromeIn, [iw * 0.7, 0.03, 0.25], [cx + 0.4, DECK + y, ib + 0.13]);
  // pass-through to the kitchen (glowing)
  B.add('passThrough', m.passThrough, new THREE.PlaneGeometry(1.6, 0.7), mat4([2.6, DECK + 1.5, ib + 0.012]), noShadow);
  B.box('chromeIn', m.chromeIn, [1.7, 0.05, 0.3], [2.6, DECK + 1.15, ib + 0.15]);
  // clock
  B.cyl('counterTop', m.counterTop, 0.22, 0.22, 0.05, [0.2, DECK + 2.6, ib + 0.03], [Math.PI / 2, 0, 0], 24);
  B.cyl('redEnamel', m.redEnamel, 0.25, 0.25, 0.04, [0.2, DECK + 2.6, ib + 0.015], [Math.PI / 2, 0, 0], 24);
  // counter with stools
  const cz = -1.85;
  B.box('counter', m.counter, [5.6, 1.0, 0.55], [1.7, DECK + 0.5, cz]);
  B.box('chromeIn', m.chromeIn, [5.66, 0.06, 0.62], [1.7, DECK + 1.03, cz]);
  B.box('counterTop', m.counterTop, [5.7, 0.04, 0.66], [1.7, DECK + 1.07, cz]);
  for (let i = 0; i < 8; i++) {
    const sx = -0.8 + i * 0.75;
    B.cyl('chromeIn', m.chromeIn, 0.025, 0.025, 0.62, [sx, DECK + 0.31, -1.25], [0, 0, 0], 8);
    B.cyl('chromeIn', m.chromeIn, 0.16, 0.18, 0.03, [sx, DECK + 0.015, -1.25], [0, 0, 0], 16);
    B.cyl('vinyl', m.vinyl, 0.2, 0.18, 0.1, [sx, DECK + 0.67, -1.25], [0, 0, 0], 18);
  }
  // booths along the windows (backs visible through the glass)
  for (const bxx of [-0.85, 0.65, 2.05, 4.6]) {
    B.box('vinyl', m.vinyl, [1.0, 0.9, 0.12], [bxx, DECK + 0.45, -0.75]);
    B.box('vinyl', m.vinyl, [1.0, 0.12, 0.45], [bxx, DECK + 0.45, -0.5]);
  }
  // pendant lamps
  const pendants = [];
  for (let i = 0; i < 5; i++) {
    const lx = -0.6 + i * 1.4;
    B.rod('darkMetal', m.darkMetal, [lx, DECK + 3.4, -1.5], [lx, DECK + 2.32, -1.5], 0.006, 4, noShadow);
    B.cyl('chromeIn', m.chromeIn, 0.03, 0.16, 0.1, [lx, DECK + 2.3, -1.5], [0, 0, 0], 16, noShadow);
    B.add('pendant', m.pendant, new THREE.SphereGeometry(0.12, 18, 10), mat4([lx, DECK + 2.18, -1.5]), noShadow);
    pendants.push([lx, DECK + 2.18, -1.5]);
  }

  // Dressing behind the counter: coffee urns, a pie case, menu boards over the
  // pass-through, warm pools under the pendants.
  for (const ux of [3.6, 4.0]) {
    B.cyl('chromeIn', m.chromeIn, 0.14, 0.14, 0.55, [ux, DECK + 1.38, ib + 0.35], [0, 0, 0], 16);
    B.cyl('chromeIn', m.chromeIn, 0.08, 0.14, 0.1, [ux, DECK + 1.7, ib + 0.35], [0, 0, 0], 16);
  }
  B.box('counter', m.counter, [5.6, 1.0, 0.5], [1.7, DECK + 0.5, ib + 0.3]); // back counter
  B.box('counterTop', m.counterTop, [5.6, 0.04, 0.55], [1.7, DECK + 1.02, ib + 0.3]);
  B.add('glass', m.glass, new THREE.CylinderGeometry(0.22, 0.22, 0.3, 16, 1, true), mat4([0.4, DECK + 1.24, cz]), noShadow);
  B.cyl('counterTop', m.counterTop, 0.2, 0.2, 0.04, [0.4, DECK + 1.12, cz], [0, 0, 0], 16);
  for (const [mx, mw] of [[1.4, 0.9], [2.6, 1.2], [3.8, 0.9]]) {
    B.box('menuBoard', m.menuBoard, [mw, 0.5, 0.03], [mx, DECK + 2.25, ib + 0.03]);
    for (let r = 0; r < 4; r++) B.add('menuText', m.menuText, new THREE.PlaneGeometry(mw * (0.55 + 0.3 * ((r * 7 + mx * 3) % 1)), 0.035), mat4([mx - 0.05, DECK + 2.42 - r * 0.1, ib + 0.05]), noShadow);
  }
  for (const pp of pendants) B.add('glowWarm', m.glowWarm, new THREE.PlaneGeometry(1.0, 0.7), mat4([pp[0], DECK + 1.1, cz], [-Math.PI / 2, 0, 0]), noShadow);

  // People: two at the counter with their backs to the street, one in a
  // booth, a cook in the pass-through. Read as silhouettes through the blinds.
  // Figures are sculpted for their outline (all that shows through the
  // blinds): a coat turned on a lathe with sloping shoulders, flattened
  // front to back; the head carried forward of the shoulders (a slump);
  // a fedora with a pinched crown and a curled brim; a cook's toque; a bob.
  const lathe = (pts, seg = 20) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  const person = (x, z, { hat = false, lean = 0.1, turn = 0, seat = DECK + 0.77, cook = false, hair = false, slump = 0.06, arms = 'counter' } = {}) => {
    const T = mat4([x, 0, z], [0, turn, 0]);
    const P = (lx, ly, lz) => new THREE.Vector3(lx, ly, lz).applyMatrix4(T).toArray();
    const add = (geo, lx, ly, lz, rot = [0, 0, 0], sc = [1, 1, 1]) => B.add('figure', m.figure, geo, new THREE.Matrix4().multiplyMatrices(T, mat4([lx, ly, lz], rot, sc)));
    const H = 0.64; // seat to the top of the collar
    add(lathe([[0, 0], [0.19, 0], [0.205, 0.06], [0.175, 0.24], [0.188, 0.4], [0.205, 0.49], [0.195, 0.54], [0.13, 0.6], [0.07, 0.63], [0, H]]), 0, seat, 0, [-lean, 0, 0], [1.25, 1, 0.72]);
    const topY = seat + H * Math.cos(lean);
    const topZ = -H * Math.sin(lean);
    const hy = topY + 0.1;
    const hz = topZ - slump;
    add(new THREE.CylinderGeometry(0.045, 0.055, 0.12, 10), 0, topY + 0.03, (topZ + hz) / 2, [-0.5, 0, 0]);
    add(new THREE.SphereGeometry(0.095, 18, 14), 0, hy, hz, [0, 0, 0], [0.88, 1.08, 1]);
    if (hat) {
      add(lathe([[0, 0], [0.088, 0], [0.084, 0.06], [0.07, 0.095], [0.035, 0.1], [0.0, 0.088]]), 0, hy + 0.045, hz, [0.08, 0, 0]);
      add(lathe([[0.085, 0], [0.13, 0.004], [0.165, 0.014], [0.178, 0.03]], 28), 0, hy + 0.045, hz, [0.12, 0, 0]);
    }
    if (cook) add(lathe([[0, 0], [0.092, 0], [0.092, 0.11], [0.125, 0.16], [0.105, 0.205], [0, 0.215]]), 0, hy + 0.06, hz);
    if (hair) add(new THREE.SphereGeometry(0.11, 18, 14), 0, hy - 0.01, hz + 0.02, [0, 0, 0], [1.05, 0.95, 1.12]);
    for (const sx of [-1, 1]) {
      const sh = [sx * 0.2, topY - 0.08, topZ * 0.8];
      const el = arms === 'counter' ? [sx * 0.22, seat + 0.32, -0.26] : arms === 'table' ? [sx * 0.21, seat + 0.38, -0.3] : [sx * 0.23, topY - 0.36, 0.0];
      const ha = arms === 'counter' ? [sx * 0.07, seat + 0.36, -0.44] : arms === 'table' ? [sx * 0.08, seat + 0.42, -0.48] : [sx * 0.18, topY - 0.62, -0.12];
      B.rod('figure', m.figure, P(...sh), P(...el), 0.056, 10);
      B.add('figure', m.figure, new THREE.SphereGeometry(0.052, 10, 8), mat4(P(...el)));
      B.rod('figure', m.figure, P(...el), P(...ha), 0.044, 10);
      B.add('figure', m.figure, new THREE.SphereGeometry(0.045, 10, 8), mat4(P(...ha)), { cast: true, receive: true });
    }
  };
  person(-0.05, -1.3, { hat: true, lean: 0.28, slump: 0.08 });
  person(1.45, -1.3, { lean: 0.16, turn: 0.4, hair: true, slump: 0.03 });
  person(4.55, -0.55, { lean: 0.06, turn: Math.PI, seat: DECK + 0.6, hat: true, arms: 'table' });
  person(2.55, ib + 0.25, { cook: true, seat: DECK + 0.95, turn: Math.PI, lean: 0.12, arms: 'down' });

  // Diner side wall (faces the side street) with one window.
  const sx = x0;
  B.box('stucco', m.stucco, [FLAT, DINER.height - DECK, -ib], [sx - FLAT / 2 + 0.0, (DINER.height + DECK) / 2, ib / 2]);
  B.box('tile', m.tile, [0.08, 1.0 - WALK, -ib], [sx - 0.14, (1.0 + WALK) / 2, ib / 2]);
  B.add('windowLit', m.windowLit, new THREE.PlaneGeometry(1.4, 1.1), mat4([sx - 0.105, 1.8, -1.9], [0, -Math.PI / 2, 0]), noShadow);
  for (let y = 2.3; y > 1.4; y -= 0.055) B.add('blinds', m.blinds, boxUV(0.004, 0.045, 1.3), mat4([sx - 0.12, y, -1.9], [0, 0, 0.55]));
  B.box('aluminum', m.aluminum, [0.12, 1.2, 0.06], [sx - 0.12, 1.8, -1.2]);
  B.box('aluminum', m.aluminum, [0.12, 1.2, 0.06], [sx - 0.12, 1.8, -2.6]);

  // ---------------------------------------------------------- side street
  // Next building along the right side of the side street (beyond the diner).
  B.box('brick2', m.brick2, [FLAT, 6.0, SIDE_STREET.back - ib], [sx - FLAT / 2, 3.0, (ib + SIDE_STREET.back) / 2]);
  for (let i = 0; i < 5; i++) {
    const wz = ib - 1.0 - i * 1.5;
    for (const wy of [2.0, 4.2]) {
      const lit = (i + (wy > 3 ? 1 : 0)) % 2 === 0;
      B.add(lit ? 'windowLit' : 'windowDim', lit ? m.windowLit : m.windowDim, new THREE.PlaneGeometry(0.8, 1.2), mat4([sx - FLAT - 0.01, wy, wz], [0, -Math.PI / 2, 0]), noShadow);
      B.box('stucco', m.stucco, [0.08, 0.06, 1.0], [sx - FLAT - 0.04, wy - 0.63, wz]);
    }
  }
  // Brick building on the left of the side street.
  const bw = BRICK_WALL;
  const blen = bw.z0 - bw.z1;
  B.box('brick', m.brick, [FLAT, bw.height, blen], [bw.x - FLAT / 2, bw.height / 2, (bw.z0 + bw.z1) / 2]);
  // raw edge of the flat at its near end
  B.box('flatEdge', m.flatEdge, [0.12, bw.height, 0.02], [bw.x - 0.06, bw.height / 2, bw.z0 + 0.01]);
  // windows: some lit warm behind shades, some dark
  const brickWins = [];
  for (let i = 0; i < 4; i++) {
    const wz = -2.2 - i * 1.7;
    for (const wy of [2.9, 4.9]) {
      const lit = (i * 3 + (wy > 4 ? 1 : 0)) % 3 === 1;
      B.add(lit ? 'windowLit' : 'windowDim', lit ? m.windowLit : m.windowDim, new THREE.PlaneGeometry(0.75, 1.2), mat4([bw.x + 0.01, wy, wz], [0, Math.PI / 2, 0]), noShadow);
      B.box('stucco', m.stucco, [0.1, 0.08, 0.95], [bw.x + 0.05, wy - 0.64, wz]);
      B.box('stucco', m.stucco, [0.06, 0.1, 0.95], [bw.x + 0.03, wy + 0.65, wz]);
      brickWins.push([wz, wy]);
    }
  }
  // fire escape: platforms, railings, zig-zag ladders
  const fe = (y, z0, z1) => {
    const zc = (z0 + z1) / 2;
    B.box('castIron', m.castIron, [0.9, 0.03, z0 - z1], [bw.x + 0.45, y, zc]);
    for (const yy of [y + 0.5, y + 0.95]) {
      B.rod('castIron', m.castIron, [bw.x + 0.88, yy, z0], [bw.x + 0.88, yy, z1], 0.015, 6);
      B.rod('castIron', m.castIron, [bw.x, yy, z0], [bw.x + 0.88, yy, z0], 0.015, 6);
      B.rod('castIron', m.castIron, [bw.x, yy, z1], [bw.x + 0.88, yy, z1], 0.015, 6);
    }
    for (let z = z1; z <= z0 + 1e-3; z += 0.35) B.rod('castIron', m.castIron, [bw.x + 0.88, y, z], [bw.x + 0.88, y + 0.95, z], 0.008, 4);
  };
  fe(3.85, -2.0, -5.6);
  fe(5.85, -2.0, -5.6);
  const ladder = (yA, yB, zA, zB) => {
    B.rod('castIron', m.castIron, [bw.x + 0.25, yA, zA], [bw.x + 0.25, yB, zB], 0.014, 6);
    B.rod('castIron', m.castIron, [bw.x + 0.7, yA, zA], [bw.x + 0.7, yB, zB], 0.014, 6);
    for (let t = 0.08; t < 1; t += 0.11) {
      const y = yA + (yB - yA) * t;
      const z = zA + (zB - zA) * t;
      B.rod('castIron', m.castIron, [bw.x + 0.25, y, z], [bw.x + 0.7, y, z], 0.01, 4);
    }
  };
  ladder(3.86, 5.84, -2.3, -4.4);
  ladder(1.6, 3.84, -5.3, -5.3); // drop ladder (raised)
  // back door with a caged bulb over it
  B.box('darkMetal', m.darkMetal, [0.06, 2.1, 1.0], [bw.x + 0.03, WALK + 1.05, -6.6]);
  B.box('castIron', m.castIron, [0.25, 0.04, 1.2], [bw.x + 0.12, WALK + 2.25, -6.6]);
  B.add('bulb', m.bulb, new THREE.SphereGeometry(0.06, 12, 8), mat4([bw.x + 0.22, WALK + 2.42, -6.6]), noShadow);
  B.add('castIron', m.castIron, new THREE.CylinderGeometry(0.09, 0.09, 0.2, 8, 1, true), mat4([bw.x + 0.22, WALK + 2.42, -6.6]));
  // trash cans and crates in the side street
  for (const [x, z, r] of [[bw.x + 0.45, -4.1, 0.28], [bw.x + 0.5, -4.8, 0.3]]) {
    B.cyl('aluminum', m.aluminum, r, r * 0.9, 0.85, [x, WALK + 0.425, z], [0, 0, 0], 16);
    B.cyl('aluminum', m.aluminum, r + 0.03, r + 0.03, 0.05, [x, WALK + 0.87, z], [0.06, 0, 0.05], 16);
  }
  B.box('wood', m.wood, [0.6, 0.45, 0.5], [bw.x + 0.5, WALK + 0.225, -7.4], [0, 0.3, 0]);
  B.box('wood', m.wood, [0.55, 0.42, 0.45], [bw.x + 0.45, WALK + 0.66, -7.35], [0, -0.2, 0]);

  // Painted translight across the whole back of the set (emissive), on a frame.
  const BW = 18;
  const BH = 9;
  B.add('backing', m.backing, new THREE.PlaneGeometry(BW, BH), mat4([0, BH / 2, BACKING_Z]), noShadow);
  B.box('blackPaint', m.blackPaint, [BW + 0.2, 0.14, 0.14], [0, BH + 0.05, BACKING_Z - 0.1]);
  for (const x of [-BW / 2 - 0.05, -3, 3, BW / 2 + 0.05]) B.box('blackPaint', m.blackPaint, [0.14, BH, 0.14], [x, BH / 2, BACKING_Z - 0.12]);

  // Upper floors of the building behind the diner: a stepped roofline and a
  // water tower against the sky, a middle layer of depth between the diner
  // and the backing.
  const rz = -5.6;
  const blocks = [[-1.6, 2.4, 6.4], [2.4, 6.6, 5.3]];
  for (const [a, b, h] of blocks) {
    B.box('brick2', m.brick2, [b - a, h, FLAT], [(a + b) / 2, h / 2, rz]);
    B.box('stucco', m.stucco, [b - a + 0.2, 0.18, 0.3], [(a + b) / 2, h - 0.09, rz + 0.1]);
    for (let x = a + 0.55; x < b - 0.4; x += 1.05) {
      // rows start well above the diner's roofline: from the centre eye a
      // lower row shows only as a sliver over the cornice
      for (let y = DINER.height + 1.5; y < h - 0.6; y += 1.5) {
        const lit = Math.abs(Math.sin(x * 12.9 + y * 7.1)) > 0.72;
        B.add(lit ? 'windowLit' : 'windowDim', lit ? m.windowLit : m.windowDim, new THREE.PlaneGeometry(0.6, 0.95), mat4([x, y, rz + FLAT / 2 + 0.01]), noShadow);
        B.box('stucco', m.stucco, [0.75, 0.07, 0.1], [x, y - 0.52, rz + 0.08]);
      }
    }
  }
  // water tower on the lower roof
  const wt = [4.6, 5.3, rz - 0.6];
  for (const [ox, oz] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) {
    B.rod('castIron', m.castIron, [wt[0] + ox, wt[1], wt[2] + oz], [wt[0] + ox * 0.8, wt[1] + 1.4, wt[2] + oz * 0.8], 0.04, 5);
  }
  B.rod('castIron', m.castIron, [wt[0] - 0.55, wt[1] + 0.7, wt[2] - 0.55], [wt[0] + 0.55, wt[1] + 0.7, wt[2] + 0.55], 0.02, 4);
  B.cyl('wood', m.wood, 0.72, 0.72, 1.5, [wt[0], wt[1] + 2.15, wt[2]], [0, 0, 0], 20);
  for (const y of [1.6, 2.15, 2.7]) B.add('castIron', m.castIron, new THREE.TorusGeometry(0.73, 0.02, 4, 24), mat4([wt[0], wt[1] + y, wt[2]], [Math.PI / 2, 0, 0]));
  B.add('castIron', m.castIron, new THREE.ConeGeometry(0.82, 0.55, 20), mat4([wt[0], wt[1] + 3.18, wt[2]]));

  // Glow of the neon and bulbs on nearby surfaces (cheap stand-ins for point lights).
  // neon spill reaches only a few centimetres onto the enamel around the tubes
  B.add('glowPink', m.glowPink, new THREE.PlaneGeometry(3.9, 1.0), mat4([1.0, winY1 + 0.46, fz + 0.075]), noShadow);
  B.add('glowCyan', m.glowCyan, new THREE.PlaneGeometry(1.2, 2.6), mat4([bx, 3.55, -0.12]), noShadow);
  B.add('glowPinkFloor', m.glowPinkFloor, new THREE.PlaneGeometry(3.6, 1.2), mat4([1.0, WALK + 0.01, 0.7], [-Math.PI / 2, 0, 0]), noShadow);
  B.add('glowWarm', m.glowWarm, new THREE.PlaneGeometry(2.0, 1.6), mat4([bw.x + 0.02, WALK + 2.3, -6.6], [0, Math.PI / 2, 0]), noShadow);
  B.add('glowWarmFloor', m.glowWarmFloor, new THREE.PlaneGeometry(2.2, 2.4), mat4([bw.x + 1.1, WALK + 0.01, -6.6], [-Math.PI / 2, 0, 0]), noShadow);

  // ---------------------------------------------------------- lamppost (acorn)
  const lp = [DINER.x0 - 0.95, WALK, 1.75];
  const lathePost = (pts) => lathe(pts, 32);
  // cast-iron post: stepped plinth and a bell base, a fluted shaft with a
  // collar, a turned capital under the globe
  B.add('castIron', m.castIron, lathePost([[0, 0], [0.31, 0], [0.31, 0.05], [0.29, 0.07], [0.29, 0.12], [0.26, 0.15], [0.25, 0.2], [0.235, 0.28], [0.205, 0.4], [0.175, 0.5], [0.155, 0.57], [0.175, 0.59], [0.175, 0.63], [0.135, 0.66], [0.115, 0.72], [0.1, 0.77], [0, 0.77]]), mat4(lp));
  {
    const shaft = new THREE.CylinderGeometry(0.066, 0.092, 2.45, 64, 8, true);
    const p = shaft.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      const a = Math.atan2(z, x);
      const k = 1 + 0.07 * Math.max(0, Math.cos(a * 16)) ** 0.5 - 0.035;
      p.setX(i, x * k);
      p.setZ(i, z * k);
    }
    shaft.computeVertexNormals();
    B.add('castIron', m.castIron, shaft, mat4([lp[0], lp[1] + 0.77 + 1.225, lp[2]]));
  }
  B.add('castIron', m.castIron, new THREE.TorusGeometry(0.083, 0.018, 8, 32), mat4([lp[0], lp[1] + 1.55, lp[2]], [Math.PI / 2, 0, 0]));
  B.add('castIronNS', m.castIron, lathe([[0, 3.2], [0.07, 3.2], [0.085, 3.23], [0.085, 3.27], [0.115, 3.33], [0.125, 3.37], [0.105, 3.41], [0.105, 3.45], [0.075, 3.47], [0, 3.47]]), mat4([lp[0], lp[1] - 0.0, lp[2]]), noShadow);
  B.add('lampGlobe', m.lampGlobe, new THREE.SphereGeometry(0.21, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), mat4([lp[0], lp[1] + 3.65, lp[2]], [Math.PI, 0, 0]), noShadow);
  B.cyl('castIronNS', m.castIron, 0.05, 0.2, 0.14, [lp[0], lp[1] + 3.87, lp[2]], [0, 0, 0], 16, noShadow);
  B.cyl('castIron', m.castIron, 0.012, 0.03, 0.18, [lp[0], lp[1] + 4.02, lp[2]], [0, 0, 0], 8);

  // ---------------------------------------------------------- street props
  // fire hydrant
  const hy = [2.35, WALK, 1.75];
  B.cyl('hydrant', m.hydrant, 0.12, 0.13, 0.55, [hy[0], hy[1] + 0.3, hy[2]], [0, 0, 0], 14);
  B.cyl('hydrant', m.hydrant, 0.16, 0.16, 0.05, [hy[0], hy[1] + 0.03, hy[2]], [0, 0, 0], 14);
  B.add('hydrant', m.hydrant, new THREE.SphereGeometry(0.12, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat4([hy[0], hy[1] + 0.57, hy[2]]));
  B.cyl('hydrant', m.hydrant, 0.05, 0.05, 0.36, [hy[0], hy[1] + 0.42, hy[2]], [0, 0, Math.PI / 2], 10);
  B.cyl('yellowPaint', m.yellowPaint, 0.03, 0.03, 0.06, [hy[0], hy[1] + 0.73, hy[2]], [0, 0, 0], 8);
  // newspaper box
  B.box('newsBox', m.newsBox, [0.5, 0.9, 0.45], [-0.75, WALK + 0.55, 1.65]);
  // a slanted coin-op top, the day's front page behind the window, a label band
  B.box('newsBox', m.newsBox, [0.52, 0.06, 0.5], [-0.75, WALK + 1.02, 1.63], [-0.12, 0, 0]);
  B.add('newsPaper', m.newsPaper, new THREE.PlaneGeometry(0.38, 0.28), mat4([-0.75, WALK + 0.82, 1.876]), noShadow);
  B.add('newsLabel', m.newsLabel, new THREE.PlaneGeometry(0.44, 0.1), mat4([-0.75, WALK + 0.58, 1.877]), noShadow);
  B.box('chrome', m.chrome, [0.1, 0.04, 0.03], [-0.62, WALK + 0.64, 1.89]);
  B.box('glass', m.glass, [0.4, 0.3, 0.01], [-0.75, WALK + 0.82, 1.88], [0, 0, 0], noShadow);
  B.box('darkMetal', m.darkMetal, [0.06, 0.12, 0.4], [-0.95, WALK + 0.05, 1.65]);
  B.box('darkMetal', m.darkMetal, [0.06, 0.12, 0.4], [-0.55, WALK + 0.05, 1.65]);
  // wire trash basket
  B.add('castIron', m.castIron, new THREE.CylinderGeometry(0.27, 0.22, 0.85, 14, 6, true), mat4([4.15, WALK + 0.43, 1.7]));
  // manhole cover
  B.cyl('manhole', m.manhole, 0.35, 0.35, 0.012, [0.9, DECK + 0.006, 3.4], [0, 0, 0], 24, { cast: false, receive: true });

  const meshes = B.build(root);
  return {
    meshes,
    lampPos: [lp[0], lp[1] + 3.6, lp[2]],
    pendants,
    neonCentres: { diner: [1.0, winY1 + 0.45, 0.35], eats: [bx, 3.5, 0.0] },
    // centres of the five DINER letters (one wet-street streak each)
    neonLetters: [0, 1, 2, 3, 4].map((i) => [wordX + i * (0.52 * 0.75 + 0.52 * 0.3) + 0.18, winY1 + 0.46, fz + 0.1]),
    backDoorBulb: [bw.x + 0.22, WALK + 2.42, -6.6],
  };
}

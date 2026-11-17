// The diner's interior, built to be walked into (station "Inside the diner")
// and still read from the shot as a warm room with figures behind half-open
// blinds: booths along the windows, the counter and its stools, the back bar
// (coffee urns, a lit pie case, shelves of cups), letterboard menus, the pass
// with heat lamps and a kitchen behind it, and the people: two at the counter,
// one in a booth, a waitress with the coffee pot, the cook at the pass.
//
// Lit by its own practicals: the pendants over the counter, ceiling domes
// over the booths, the pie case and the kitchen's fluorescent, as work-light
// terms on the interior materials (cheap, unshadowed), plus a little fill;
// contact shadows are dark cards under the furniture. Real metres, the
// diner's floor (the street deck) at y = DECK.

import * as THREE from 'three';
import { Builder, boxUV, planeUV, mat4 } from '../_lib/geo.js';
import { DECK, DINER } from './layout.js';
import { crowd, SKIN, seatedAt, seatedFeet } from './people.js';
import * as IT from './interior-tex.js';
import { metres } from './textures.js';
import { addDetail } from './materials.js';
import { flatBackX, flatBackZ, sandbag, cable } from './backstage.js';

const F = DECK + 0.01; // the diner's floor
export const IN = {
  x0: DINER.x0 + 0.01, x1: DINER.x1 - 0.2, // inside faces of the end walls
  front: -0.1, // inside face of the facade
  back: DINER.back, // inside face of the back wall
  ceil: DECK + 3.4,
  // the counter
  cx0: -0.9, cx1: 4.45, cz0: -2.02, cz1: -2.62, ch: 0.98,
  stoolZ: -1.7, stoolX: (i) => -0.5 + i * 0.68, stools: 8, seat: 0.74,
  // the back counter
  bz0: -3.55, bz1: DINER.back, bh: 0.92,
  // the pass in the back wall, and the kitchen behind it
  pass: { x0: -0.95, x1: 0.45, y0: DECK + 1.22, y1: DECK + 1.86 },
  kitchen: { x0: -1.55, x1: 1.15, z0: DINER.back - 0.1, z1: DINER.back - 1.25, ceil: DECK + 2.95 },
  pendants: [0, 1, 2, 3, 4].map((i) => [-0.5 + i * 1.25, DECK + 2.2, -2.3]),
  domes: [[-0.62, DECK + 3.36, -0.45], [1.05, DECK + 3.36, -0.45], [4.55, DECK + 3.36, -0.45]],
};

// Interior surfaces: albedo, lit by the practicals' work-light terms; a
// little warm fill (light bounced around a small bright room) as emissive.
const FILL = 0.36; // how much of the listed fill the room gives back (one knob for the whole room)
function inMat(o, fill = 0.12, tint = 0xffd0a0) {
  const m = new THREE.MeshLambertMaterial(o);
  m.emissive = new THREE.Color(tint).multiplyScalar(fill * FILL);
  if (o.map) m.emissiveMap = o.map;
  else m.emissive.multiply(new THREE.Color(o.color ?? 0xffffff));
  return m;
}
// a warm room's reflections for interior chrome, steel and glass
function dinerEnvironment(renderer) {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0.1, 0.065, 0.04);
  const card = (w, h, color, pos) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    mesh.position.set(...pos);
    mesh.lookAt(0, 0, 0);
    s.add(mesh);
  };
  for (let i = 0; i < 5; i++) card(0.3, 0.3, new THREE.Color(1, 0.86, 0.66).multiplyScalar(6), [-3 + i * 1.5, 2.2, -0.5]);
  card(8, 1.6, new THREE.Color(0.02, 0.025, 0.035), [0, 0.6, 3]); // the dark windows
  card(8, 1.4, new THREE.Color(0.4, 0.24, 0.12), [0, 0.9, -3]); // the back wall
  card(3, 0.8, new THREE.Color(0.7, 0.75, 0.8), [1.5, 0.6, -3.2]); // the bright pass
  card(10, 10, new THREE.Color(0.04, 0.03, 0.025), [0, -3, 0]); // the floor
  card(10, 10, new THREE.Color(0.22, 0.18, 0.14), [0, 4, 0]); // the ceiling
  card(1.2, 6, new THREE.Color(0.5, 0.06, 0.05), [-3.5, -0.5, 0]); // the red counter
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.04);
  pm.dispose();
  s.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  return rt;
}

/**
 * The people as backlit figures: from far off (the shot, through the blinds of
 * a bright room) they read as dark shapes with a warm rim from the back bar's
 * light, as in the night-window paintings; from close by (inside, the
 * sidewalk) they are lit. Returns the uniform: 0 lit .. 1 silhouette.
 */
export function backlitFigures(material) {
  const k = { value: 0 };
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    shader.uniforms.silK = k;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float silK;')
      .replace('#include <opaque_fragment>', `{
          float facing = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
          float rim = pow(1.0 - facing, 6.0);
          vec3 sil = diffuseColor.rgb * vec3(0.034, 0.028, 0.024) + vec3(1.0, 0.7, 0.42) * 0.22 * rim;
          outgoingLight = mix(outgoingLight, sil, silK);
        }
        #include <opaque_fragment>`);
  };
  const prevKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}-backlit`;
  material.needsUpdate = true;
  return k;
}

// Soft dark card under furniture (multiplied onto the floor): contact shadow.
let aoTex = null;
function aoTexture() {
  if (aoTex) return aoTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const img = g.createImageData(64, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const dx = (x + 0.5) / 32 - 1, dy = (y + 0.5) / 32 - 1;
    // a rounded box falloff: dark in the middle, white (no change) at the edge
    const d = Math.pow(Math.pow(Math.abs(dx), 4) + Math.pow(Math.abs(dy), 4), 0.25);
    const v = Math.min(1, Math.max(0, (d - 0.35) / 0.65));
    const k = 255 * (0.35 + 0.65 * v * v * (3 - 2 * v));
    const i = (y * 64 + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = k;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  aoTex = new THREE.CanvasTexture(c);
  return aoTex;
}
function aoMaterial() {
  return new THREE.MeshBasicMaterial({
    map: aoTexture(), transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
}

/** Materials the interior adds to the scene's set (m). */
export function interiorMaterials(m, renderer) {
  const env = dinerEnvironment(renderer);
  const formT = IT.formica();
  const menuT = IT.menuBoards();
  const clockT = IT.clockFace();
  const kTileT = IT.squareTile({ color: [226, 224, 216], grout: [150, 146, 138], seed: 7, wear: 0.12 });
  const quarryT = IT.squareTile({ color: [122, 54, 38], grout: [58, 46, 40], n: 6, seed: 9, wear: 0.2 });
  const goodsT = IT.shelfGoods();
  for (const t of [formT, kTileT, quarryT]) metres(t.map);
  m.textures.interior = { formT: formT.map, menuT, clockT, kTileT: kTileT.map, quarryT: quarryT.map, goodsT };
  m.dinerEnv = env;
  // a waxed floor and glossy counter tops: the room's lights in them
  const glossy = (o, fill, rough) => {
    const g = new THREE.MeshStandardMaterial({ ...o, roughness: rough, metalness: 0, envMap: env.texture, envMapIntensity: 0.35 });
    g.emissive = new THREE.Color(0xffd0a0).multiplyScalar(fill * FILL * 1.6);
    if (o.map) g.emissiveMap = o.map;
    return g;
  };
  m.checker.dispose();
  m.checker = glossy({ map: m.textures.checkerT.map }, 0.08, 0.32);
  const steel = (color, rough, k = 1) => new THREE.MeshStandardMaterial({ color, metalness: 1, roughness: rough, envMap: env.texture, envMapIntensity: k });
  Object.assign(m, {
    in_formica: glossy({ map: formT.map }, 0.12, 0.28),
    in_chrome: steel(0xd0d2d4, 0.18, 1.1),
    in_steel: steel(0xa8acb0, 0.38, 0.9),
    in_vinyl: glossy({ color: 0x9a1c1a }, 0.05, 0.42),
    in_vinylDark: inMat({ color: 0x4a0e0c }, 0.15),
    in_red: inMat({ color: 0x8a1c1c }, 0.2),
    in_black: inMat({ color: 0x141312 }, 0.15),
    in_cream: inMat({ color: 0xe0d6bc }, 0.22),
    in_wood: inMat({ map: m.textures.pineT.map, color: 0x8a5a36 }, 0.15),
    in_menu: inMat({ map: menuT }, 0.35, 0xffffff),
    in_clock: inMat({ map: clockT }, 0.4, 0xffffff),
    in_goods: inMat({ map: goodsT }, 0.25, 0xffffff),
    in_glass: new THREE.MeshStandardMaterial({ color: 0x0c1012, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.12, envMap: env.texture, envMapIntensity: 1.2, depthWrite: false }),
    in_cup: inMat({ color: 0xf0ece2 }, 0.3),
    in_coffee: inMat({ color: 0x1a0c06 }, 0.05),
    in_pie: inMat({ color: 0xc88a3c }, 0.25),
    in_pieFill: inMat({ color: 0x8a1018, side: THREE.DoubleSide }, 0.2),
    in_food: inMat({ color: 0x6a3a1c }, 0.2),
    in_fries: inMat({ color: 0xd8a83c }, 0.3),
    in_ketchup: inMat({ color: 0x8a0c08 }, 0.2),
    in_green: inMat({ color: 0x4a8a6a }, 0.2),
    in_ceiling: inMat({ color: 0xd8ccb0 }, 0.2),
    in_lining: inMat({ map: m.textures.wallInT.map }, 0.25),
    // the back wall over the back bar: lit by its shelves and the pie case
    // as well as the room (what the shot sees through the windows)
    in_backWall: inMat({ map: m.textures.wallInT.map }, 1.6, 0xffc890),
    in_wainscot: inMat({ map: m.textures.tileT.map }, 0.2),
    in_people: new THREE.MeshLambertMaterial({ vertexColors: true }),
    in_ao: aoMaterial(),
    // emitters
    in_dome: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.88, 0.7).multiplyScalar(5) }),
    in_pieLight: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.92, 0.78).multiplyScalar(2.2) }),
    in_heat: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.32, 0.08).multiplyScalar(6) }),
    in_tube: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.88, 0.96, 1).multiplyScalar(7) }),
    in_ticket: inMat({ color: 0xf2eee0 }, 0.4),
    k_tile: inMat({ map: kTileT.map }, 0.2, 0xe8f0ff),
    bkBrick: addDetail(new THREE.MeshLambertMaterial({ map: m.textures.brick2T.map, normalMap: m.textures.brick2T.normalMap }), 'brick'),
    k_floor: inMat({ map: quarryT.map }, 0.15, 0xe8f0ff),
    k_steel: steel(0x9a9ea2, 0.42, 0.8),
    k_griddle: new THREE.MeshStandardMaterial({ color: 0x141414, metalness: 0.6, roughness: 0.32, envMap: env.texture, envMapIntensity: 0.6 }),
  });
  return m;
}

export function buildInterior(root, m) {
  const B = new Builder();
  const no = { cast: false, receive: false };
  const sh = { cast: true, receive: true };
  const { x0, x1, front, back, ceil } = IN;
  const W = x1 - x0;
  const cx = (x0 + x1) / 2;
  const D = front - back;

  // ---------------------------------------------------------------- room
  B.add('checker', m.checker, planeUV(W, -back, 1), mat4([cx, F, back / 2], [-Math.PI / 2, 0, 0]), { cast: false, receive: true });
  // back wall in four pieces around the pass
  const P = IN.pass;
  const wallH = ceil - DECK;
  const bw = (a, b, y0, y1) => B.box('in_backWall', m.in_backWall, [b - a, y1 - y0, 0.1], [(a + b) / 2, (y0 + y1) / 2, back - 0.05]);
  bw(x0, P.x0, DECK, ceil);
  bw(P.x1, x1, DECK, ceil);
  bw(P.x0, P.x1, DECK, P.y0);
  bw(P.x0, P.x1, P.y1, ceil);
  // the end wall is a wild wall (its own group, below): flown out when the
  // viewer stands where the camera would, at the open end of the room
  // the deck the diner stands on, seen at its open end
  B.box('deckEdge', m.deckEdge, [DINER.x1 - DINER.x0, DECK - 0.002, -back - 0.2], [(DINER.x0 + DINER.x1) / 2, DECK / 2, (back - 0.2) / 2]);
  // left wall lining (inside the stucco side wall), with the side window
  const SW = { z0: -1.2, z1: -2.6, y0: 1.25, y1: 2.35 };
  const lx = x0 - 0.005;
  const lw = (z0, z1, y0, y1) => B.add('in_lining', m.in_lining, planeUV(z0 - z1, y1 - y0, 2), mat4([lx, (y0 + y1) / 2, (z0 + z1) / 2], [0, Math.PI / 2, 0]));
  lw(front, SW.z0, DECK, ceil);
  lw(SW.z1, back, DECK, ceil);
  lw(SW.z0, SW.z1, DECK, SW.y0);
  lw(SW.z0, SW.z1, SW.y1, ceil);
  // wainscot along the left and back walls, a chrome cap
  B.box('in_wainscot', m.in_wainscot, [0.03, 1.0, -back - 0.1], [x0 + 0.01, DECK + 0.5, (front + back) / 2]);
  B.box('in_chrome', m.in_chrome, [0.05, 0.03, -back - 0.1], [x0 + 0.02, DECK + 1.01, (front + back) / 2]);
  // the facade's inside: wainscot under the windows, piers between, the band above
  const openings = [[-1.45, -0.15], [-0.03, 1.27], [1.39, 2.69], [2.85, 3.8, 'door'], [3.95, 5.25]];
  B.box('in_wainscot', m.in_wainscot, [W, 1.0 - DECK, 0.06], [cx, (1.0 + DECK) / 2 + 0.03, front - 0.03]);
  let px = x0;
  for (const [a, b] of openings) {
    const aa = Math.max(a, x0), bb = Math.min(b, x1);
    if (aa > px + 1e-3) B.add('in_lining', m.in_lining, planeUV(aa - px, 2.6 - 1.05, 2), mat4([(aa + px) / 2, (1.05 + 2.6) / 2, front - 0.001], [0, Math.PI, 0]));
    px = bb;
  }
  if (x1 > px) B.add('in_lining', m.in_lining, planeUV(x1 - px, 2.6 - 1.05, 2), mat4([(x1 + px) / 2, (1.05 + 2.6) / 2, front - 0.001], [0, Math.PI, 0]));
  B.add('in_lining', m.in_lining, planeUV(W, ceil - 2.6, 2), mat4([cx, (ceil + 2.6) / 2, front - 0.001], [0, Math.PI, 0]));
  // sills inside the windows
  for (const [a, b, kind] of openings) if (!kind) B.box('in_chrome', m.in_chrome, [Math.min(b, x1) - Math.max(a, x0), 0.025, 0.12], [(Math.min(b, x1) + Math.max(a, x0)) / 2, 1.06, front - 0.05]);
  // the door's inside: a kick plate and a push bar on the glass leaf
  B.rod('in_chrome', m.in_chrome, [2.97, 1.12, -0.06], [3.68, 1.12, -0.06], 0.016, 8);
  // ceiling: painted, with a cove; its top is a flat's back (seen from the grid)
  B.box('in_ceiling', m.in_ceiling, [W, 0.04, D + 0.1], [cx, ceil + 0.02, (front + back) / 2]);
  B.add('luan', m.luan, boxUV(W + 0.1, 0.006, D + 0.2), mat4([cx, ceil + 0.045, (front + back) / 2]));
  for (let x = x0; x <= x1 + 1e-3; x += W / 5) B.box('pine', m.pine, [0.07, 0.09, D + 0.2], [x, ceil + 0.09, (front + back) / 2]);
  B.box('pine', m.pine, [W + 0.1, 0.09, 0.07], [cx, ceil + 0.09, front + 0.02]);
  B.box('pine', m.pine, [W + 0.1, 0.09, 0.07], [cx, ceil + 0.09, back - 0.08]);
  B.box('in_cream', m.in_cream, [W, 0.08, 0.05], [cx, ceil - 0.04, back + 0.025]);
  // side window: aluminium frame, inside sill, blinds (the glass is in set.js)
  B.box('in_chrome', m.in_chrome, [0.12, 0.025, SW.z0 - SW.z1], [x0 + 0.04, SW.y0, (SW.z0 + SW.z1) / 2]);

  // ---------------------------------------------------------------- booths
  const tableTop = DECK + 0.76;
  const bench = (xa, xb, facing, { back: hasBack = true } = {}) => {
    // seat along z from the facade 0.75 deep; facing +1: the sitter faces +x
    const z0 = front, z1 = front - 0.78;
    const zc = (z0 + z1) / 2;
    const seatX0 = facing > 0 ? xa + 0.08 : xa;
    const seatX1 = facing > 0 ? xb : xb - 0.08;
    B.box('in_vinylDark', m.in_vinylDark, [seatX1 - seatX0, DECK + 0.36 - F, z0 - z1], [(seatX0 + seatX1) / 2, (DECK + 0.36 + F) / 2, zc]);
    B.box('in_vinyl', m.in_vinyl, [seatX1 - seatX0, 0.09, z0 - z1 - 0.02], [(seatX0 + seatX1) / 2, DECK + 0.405, zc]);
    // the seat's front roll and the chrome trim along it
    B.add('in_vinyl', m.in_vinyl, new THREE.CylinderGeometry(0.045, 0.045, z0 - z1 - 0.02, 10), mat4([facing > 0 ? seatX1 : seatX0, DECK + 0.4, zc], [Math.PI / 2, 0, 0]));
    B.box('in_chrome', m.in_chrome, [0.012, 0.02, z0 - z1], [facing > 0 ? seatX1 + 0.04 : seatX0 - 0.04, DECK + 0.33, zc]);
    if (hasBack) {
      // high back, tufted: three vertical rolls on the sitter's side
      const bx = facing > 0 ? xa + 0.04 : xb - 0.04;
      B.box('in_vinylDark', m.in_vinylDark, [0.08, 1.12 - 0.36, z0 - z1], [bx, DECK + (1.12 + 0.36) / 2, zc]);
      for (let k = 0; k < 4; k++) {
        const zz = z1 + 0.1 + k * ((z0 - z1 - 0.2) / 3);
        B.add('in_vinyl', m.in_vinyl, new THREE.CylinderGeometry(0.05, 0.05, 0.66, 10), mat4([bx + facing * 0.045, DECK + 0.76, zz]));
      }
      B.add('in_vinyl', m.in_vinyl, new THREE.CylinderGeometry(0.05, 0.05, z0 - z1, 10), mat4([bx + facing * 0.02, DECK + 1.1, zc], [Math.PI / 2, 0, 0]));
      B.box('in_chrome', m.in_chrome, [0.1, 0.02, z0 - z1], [bx, DECK + 1.14, zc]);
    }
  };
  const table = (xa, xb) => {
    const z0 = front, z1 = front - 0.74;
    const xc = (xa + xb) / 2;
    const zc = (z0 + z1) / 2;
    B.box('in_formica', m.in_formica, [xb - xa, 0.03, z0 - z1], [xc, tableTop, zc]);
    B.box('in_chrome', m.in_chrome, [xb - xa + 0.01, 0.028, 0.012], [xc, tableTop - 0.002, z1 - 0.005]);
    for (const x of [xa, xb]) B.box('in_chrome', m.in_chrome, [0.012, 0.028, z0 - z1], [x, tableTop - 0.002, zc]);
    B.cyl('in_chrome', m.in_chrome, 0.035, 0.035, tableTop - F - 0.02, [xc, (tableTop + F) / 2, zc - 0.05], [0, 0, 0], 10);
    B.cyl('in_chrome', m.in_chrome, 0.2, 0.22, 0.025, [xc, F + 0.012, zc - 0.05], [0, 0, 0], 16);
    // a napkin box, sugar, salt and pepper, ketchup against the window
    B.box('in_chrome', m.in_chrome, [0.11, 0.12, 0.08], [xc, tableTop + 0.075, z0 - 0.08]);
    B.cyl('in_glass', m.in_glass, 0.03, 0.035, 0.11, [xc - 0.12, tableTop + 0.07, z0 - 0.08], [0, 0, 0], 10, no);
    B.cyl('in_chrome', m.in_chrome, 0.012, 0.03, 0.025, [xc - 0.12, tableTop + 0.135, z0 - 0.08], [0, 0, 0], 10);
    B.cyl('in_ketchup', m.in_ketchup, 0.028, 0.03, 0.15, [xc + 0.12, tableTop + 0.09, z0 - 0.08], [0, 0, 0], 10);
    B.cyl('in_ketchup', m.in_ketchup, 0.01, 0.026, 0.05, [xc + 0.12, tableTop + 0.19, z0 - 0.08], [0, 0, 0], 8);
    for (const dx of [0.2, 0.235]) B.cyl('in_glass', m.in_glass, 0.012, 0.014, 0.06, [xc + dx, tableTop + 0.045, z0 - 0.14], [0, 0, 0], 8, no);
    B.add('in_ao', m.in_ao, new THREE.PlaneGeometry(xb - xa + 0.3, z0 - z1 + 0.15), mat4([xc, F + 0.002, zc], [-Math.PI / 2, 0, 0]), no);
  };
  // A: in the corner by the side window; B: across the next window; a deuce
  // by the door; D: right of the door
  bench(x0, x0 + 0.45, +1);
  table(x0 + 0.5, x0 + 1.15);
  bench(x0 + 1.2, x0 + 1.68, -1);
  bench(x0 + 1.68, x0 + 2.16, +1);
  table(x0 + 2.21, x0 + 2.86);
  bench(x0 + 2.91, x0 + 3.38, -1);
  bench(x0 + 3.38, x0 + 3.78, +1);
  table(x0 + 3.83, x0 + 4.28);
  bench(3.88, 4.3, +1);
  table(4.35, 4.8);
  bench(4.82, x1, -1);

  // ---------------------------------------------------------------- counter
  const { cx0, cx1, cz0, cz1, ch } = IN;
  const ccx = (cx0 + cx1) / 2;
  const cl = cx1 - cx0;
  B.box('in_red', m.in_red, [cl, ch - 0.12, cz0 - cz1 - 0.06], [ccx, DECK + 0.12 + (ch - 0.12) / 2, (cz0 + cz1) / 2 - 0.03]);
  B.box('in_black', m.in_black, [cl, 0.12, cz0 - cz1 - 0.16], [ccx, DECK + 0.06, (cz0 + cz1) / 2 - 0.05]);
  for (const y of [0.28, 0.55, 0.82]) B.box('in_chrome', m.in_chrome, [cl, 0.025, 0.012], [ccx, DECK + y, cz0 - 0.055]);
  // ends of the counter
  for (const x of [cx0, cx1]) B.box('in_chrome', m.in_chrome, [0.02, ch - 0.12, cz0 - cz1 - 0.06], [x, DECK + 0.12 + (ch - 0.12) / 2, (cz0 + cz1) / 2 - 0.03]);
  // top: formica with a chrome nosing
  B.box('in_formica', m.in_formica, [cl + 0.06, 0.035, cz0 - cz1 + 0.08], [ccx, DECK + ch + 0.017, (cz0 + cz1) / 2 + 0.04]);
  B.box('in_chrome', m.in_chrome, [cl + 0.07, 0.045, 0.014], [ccx, DECK + ch + 0.012, cz0 + 0.087]);
  B.add('in_ao', m.in_ao, new THREE.PlaneGeometry(cl + 0.4, 0.9), mat4([ccx, F + 0.002, (cz0 + cz1) / 2], [-Math.PI / 2, 0, 0]), no);
  // stools
  for (let i = 0; i < IN.stools; i++) {
    const sx = IN.stoolX(i);
    const sz = IN.stoolZ;
    B.cyl('in_chrome', m.in_chrome, 0.16, 0.19, 0.03, [sx, F + 0.015, sz], [0, 0, 0], 18);
    B.cyl('in_chrome', m.in_chrome, 0.032, 0.032, IN.seat - 0.1, [sx, F + (IN.seat - 0.1) / 2, sz], [0, 0, 0], 10);
    B.add('in_chrome', m.in_chrome, new THREE.TorusGeometry(0.13, 0.012, 6, 18), mat4([sx, DECK + 0.3, sz], [Math.PI / 2, 0, 0]));
    B.cyl('in_chrome', m.in_chrome, 0.19, 0.2, 0.04, [sx, DECK + IN.seat - 0.08, sz], [0, 0, 0], 18);
    B.add('in_vinyl', m.in_vinyl, new THREE.CylinderGeometry(0.18, 0.19, 0.07, 18), mat4([sx, DECK + IN.seat - 0.025, sz]));
    B.add('in_vinyl', m.in_vinyl, new THREE.SphereGeometry(0.18, 18, 6, 0, Math.PI * 2, 0, Math.PI * 0.18), mat4([sx, DECK + IN.seat - 0.045, sz]));
    B.add('in_ao', m.in_ao, new THREE.PlaneGeometry(0.55, 0.55), mat4([sx, F + 0.002, sz], [-Math.PI / 2, 0, 0]), no);
  }
  // on the counter: cups and saucers, a cake stand under a glass dome, napkin
  // boxes, sugar pourers, a register at the left end
  const top = DECK + ch + 0.035;
  const cup = (x, z, full = true) => {
    B.cyl('in_cup', m.in_cup, 0.075, 0.07, 0.012, [x, top + 0.006, z], [0, 0, 0], 16);
    // the cup turned with a wall: outside up to the rim, inside down to its floor
    B.add('in_cup', m.in_cup, new THREE.LatheGeometry([[0, 0], [0.033, 0], [0.035, 0.004], [0.043, 0.074], [0.042, 0.077], [0.039, 0.075], [0.031, 0.012], [0, 0.01]].map(([r, y]) => new THREE.Vector2(r, y)), 16), mat4([x, top + 0.0125, z]), sh);
    if (full) B.cyl('in_coffee', m.in_coffee, 0.038, 0.038, 0.004, [x, top + 0.072, z], [0, 0, 0], 14);
    B.add('in_cup', m.in_cup, new THREE.TorusGeometry(0.02, 0.006, 5, 10), mat4([x + 0.05, top + 0.05, z]));
  };
  for (const i of [1, 2]) cup(IN.stoolX(i) + 0.05, cz0 - 0.18);
  cup(IN.stoolX(6) - 0.1, cz0 - 0.22, false);
  // near the counter's open end: a cup of coffee and a slice of pie
  cup(4.05, cz0 - 0.2);
  {
    const x = 3.78, z = cz0 - 0.22;
    B.cyl('in_cup', m.in_cup, 0.1, 0.085, 0.014, [x, top + 0.007, z], [0, 0, 0], 20);
    B.add('in_pie', m.in_pie, new THREE.CylinderGeometry(0.075, 0.075, 0.045, 12, 1, false, 0, 0.62), mat4([x - 0.03, top + 0.036, z + 0.02], [0, 2.2, 0]));
    // the filling on both cut faces of the slice
    for (const th of [0, 0.62]) {
      const f = new THREE.PlaneGeometry(0.075, 0.042);
      f.translate(0.0375, 0, 0);
      f.rotateY(th - Math.PI / 2);
      B.add('in_pieFill', m.in_pieFill, f, mat4([x - 0.03, top + 0.036, z + 0.02], [0, 2.2, 0]));
    }
    B.box('in_chrome', m.in_chrome, [0.012, 0.004, 0.15], [x + 0.08, top + 0.016, z], [0, 0.3, 0]);
  }
  for (const x of [0.45, 2.1, 3.5]) {
    B.box('in_chrome', m.in_chrome, [0.12, 0.13, 0.08], [x, top + 0.065, cz0 - 0.32]);
    B.cyl('in_glass', m.in_glass, 0.032, 0.036, 0.12, [x + 0.14, top + 0.06, cz0 - 0.32], [0, 0, 0], 10, no);
    B.cyl('in_chrome', m.in_chrome, 0.012, 0.033, 0.028, [x + 0.14, top + 0.134, cz0 - 0.32], [0, 0, 0], 10);
  }
  // cake stand and dome
  {
    const x = 3.35, z = cz0 - 0.32;
    B.cyl('in_chrome', m.in_chrome, 0.07, 0.09, 0.012, [x, top + 0.006, z], [0, 0, 0], 18);
    B.cyl('in_chrome', m.in_chrome, 0.02, 0.025, 0.12, [x, top + 0.07, z], [0, 0, 0], 10);
    B.cyl('in_chrome', m.in_chrome, 0.17, 0.17, 0.012, [x, top + 0.136, z], [0, 0, 0], 22);
    B.add('in_pie', m.in_pie, new THREE.CylinderGeometry(0.125, 0.115, 0.045, 24, 1, false, 0.7, Math.PI * 2 - 0.7), mat4([x, top + 0.165, z]));
    B.add('in_pie', m.in_pie, new THREE.TorusGeometry(0.122, 0.012, 5, 24, Math.PI * 2 - 0.7), mat4([x, top + 0.187, z], [Math.PI / 2, 0, -0.7 - Math.PI / 2]));
    B.add('in_pieFill', m.in_pieFill, new THREE.PlaneGeometry(0.12, 0.04), mat4([x + Math.sin(0.7) * 0.06, top + 0.165, z + Math.cos(0.7) * 0.06], [0, 0.7 - Math.PI / 2, 0]));
    B.add('in_pieFill', m.in_pieFill, new THREE.PlaneGeometry(0.12, 0.04), mat4([x, top + 0.165, z + 0.06], [0, Math.PI / 2, 0]));
    B.add('in_glass', m.in_glass, new THREE.SphereGeometry(0.18, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat4([x, top + 0.14, z], [0, 0, 0], [1, 1.25, 1]), no);
    B.add('in_chrome', m.in_chrome, new THREE.SphereGeometry(0.018, 8, 6), mat4([x, top + 0.37, z]));
  }
  // register
  {
    const x = cx0 + 0.3, z = cz0 - 0.36;
    B.box('in_steel', m.in_steel, [0.4, 0.2, 0.38], [x, top + 0.1, z]);
    B.box('in_steel', m.in_steel, [0.36, 0.16, 0.18], [x, top + 0.26, z - 0.08], [-0.5, 0, 0]);
    B.box('in_black', m.in_black, [0.3, 0.08, 0.02], [x, top + 0.38, z - 0.12]);
  }

  // ---------------------------------------------------------------- back bar
  const { bz0, bh } = IN;
  const bbz = (bz0 + back) / 2;
  const bdz = back - bz0;
  B.box('in_steel', m.in_steel, [W - 0.1, bh - 0.1, -bdz], [cx, DECK + 0.1 + (bh - 0.1) / 2, bbz]);
  B.box('in_black', m.in_black, [W - 0.1, 0.1, -bdz - 0.06], [cx, DECK + 0.05, bbz - 0.03]);
  B.box('in_steel', m.in_steel, [W - 0.08, 0.03, -bdz + 0.04], [cx, DECK + bh + 0.015, bbz + 0.02]);
  for (let x = x0 + 0.65; x < x1 - 0.3; x += 0.62) B.box('in_black', m.in_black, [0.012, bh - 0.22, 0.006], [x, DECK + 0.1 + (bh - 0.1) / 2, bz0 + 0.003]);
  for (let x = x0 + 0.35; x < x1 - 0.2; x += 0.62) B.box('in_chrome', m.in_chrome, [0.14, 0.018, 0.02], [x, DECK + bh - 0.12, bz0 + 0.012]);
  const btop = DECK + bh + 0.03;
  // coffee urns: chrome drums with sight glasses and black spigots
  for (const ux of [0.82, 1.17]) {
    const uz = bbz + 0.02;
    B.add('in_chrome', m.in_chrome, new THREE.LatheGeometry([[0, 0], [0.15, 0], [0.15, 0.02], [0.13, 0.05], [0.13, 0.5], [0.142, 0.52], [0.142, 0.55], [0.1, 0.6], [0.04, 0.63], [0.03, 0.68], [0, 0.69]].map(([r, y]) => new THREE.Vector2(r, y)), 24), mat4([ux, btop, uz]));
    B.cyl('in_black', m.in_black, 0.018, 0.018, 0.08, [ux, btop + 0.14, uz + 0.16], [Math.PI / 2, 0, 0], 8);
    B.box('in_black', m.in_black, [0.05, 0.05, 0.04], [ux, btop + 0.12, uz + 0.2]);
    B.cyl('in_glass', m.in_glass, 0.012, 0.012, 0.32, [ux + 0.08, btop + 0.32, uz + 0.115], [0, 0, 0], 8, no);
    B.cyl('in_coffee', m.in_coffee, 0.008, 0.008, 0.22, [ux + 0.08, btop + 0.27, uz + 0.115], [0, 0, 0], 6);
    // a glass pot on the warmer beside
    B.add('in_glass', m.in_glass, new THREE.SphereGeometry(0.075, 14, 10), mat4([ux - 0.24, btop + 0.09, uz + 0.08], [0, 0, 0], [1, 0.9, 1]), no);
    B.cyl('in_coffee', m.in_coffee, 0.07, 0.072, 0.07, [ux - 0.24, btop + 0.07, uz + 0.08], [0, 0, 0], 14);
    B.cyl('in_black', m.in_black, 0.045, 0.06, 0.05, [ux - 0.24, btop + 0.17, uz + 0.08], [0, 0, 0], 12);
  }
  // the pie case: a lit glass box with three shelves of pies
  {
    const x = 1.78, z = bbz + 0.02, w = 0.55, d = 0.5, h = 0.6;
    B.box('in_steel', m.in_steel, [w + 0.04, 0.05, d + 0.04], [x, btop + 0.025, z]);
    B.box('in_steel', m.in_steel, [w + 0.04, 0.06, d + 0.04], [x, btop + h + 0.03, z]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box('in_chrome', m.in_chrome, [0.025, h, 0.025], [x + sx * w / 2, btop + h / 2 + 0.03, z + sz * d / 2]);
    B.add('in_pieLight', m.in_pieLight, new THREE.PlaneGeometry(w - 0.04, 0.025), mat4([x, btop + h - 0.005, z], [Math.PI / 2, 0, 0]), no);
    B.box('in_cream', m.in_cream, [w - 0.02, h - 0.04, 0.01], [x, btop + h / 2 + 0.03, z - d / 2 + 0.01]);
    for (const [k, y] of [0.07, 0.25, 0.43].entries()) {
      B.box('in_glass', m.in_glass, [w - 0.02, 0.008, d - 0.02], [x, btop + y, z], [0, 0, 0], no);
      for (const dx of [-0.13, 0.13]) {
        const cut = (k + (dx > 0 ? 1 : 0)) % 2 === 0;
        B.add('in_pie', m.in_pie, new THREE.CylinderGeometry(0.11, 0.1, 0.05, 18, 1, false, cut ? 0.4 : 0, cut ? Math.PI * 2 - 0.9 : Math.PI * 2), mat4([x + dx, btop + y + 0.03, z]));
        if (cut) B.add('in_pieFill', m.in_pieFill, new THREE.CylinderGeometry(0.095, 0.095, 0.04, 12, 1, false, 0.4 + Math.PI * 2 - 0.9, 0.9), mat4([x + dx, btop + y + 0.03, z]));
      }
    }
    for (const [gx, gz, gw, gd, ry] of [[x, z + d / 2, w, 0.006, 0], [x - w / 2, z, 0.006, d, 0], [x + w / 2, z, 0.006, d, 0]]) B.box('in_glass', m.in_glass, [gw, h - 0.06, gd], [gx, btop + h / 2 + 0.03, gz], [0, ry, 0], no);
  }
  // milkshake mixers, a toaster, stacks of cups and plates
  for (const mx of [2.45, 2.7]) {
    B.box('in_green', m.in_green, [0.14, 0.06, 0.16], [mx, btop + 0.03, bbz + 0.05]);
    B.cyl('in_green', m.in_green, 0.03, 0.04, 0.42, [mx, btop + 0.25, bbz - 0.02], [0, 0, 0], 10);
    B.box('in_green', m.in_green, [0.1, 0.1, 0.18], [mx, btop + 0.47, bbz + 0.02]);
    B.cyl('in_chrome', m.in_chrome, 0.045, 0.04, 0.18, [mx, btop + 0.15, bbz + 0.07], [0, 0, 0], 12);
  }
  B.box('in_chrome', m.in_chrome, [0.3, 0.2, 0.2], [3.25, btop + 0.1, bbz + 0.03]);
  for (let k = 0; k < 6; k++) B.cyl('in_cup', m.in_cup, 0.045, 0.036, 0.075, [3.6 + (k % 3) * 0.1, btop + 0.04 + Math.floor(k / 3) * 0.06, bbz + 0.08], [0, 0, 0], 12);
  for (let k = 0; k < 10; k++) B.cyl('in_cup', m.in_cup, 0.11, 0.09, 0.012, [4.15, btop + 0.006 + k * 0.014, bbz + 0.05], [0, 0, 0], 18);
  // a steel backsplash over the back counter, and dark corners where the
  // walls meet the floor and the ceiling (contact shadow)
  for (const [a, b] of [[x0, P.x0], [P.x1, x1]]) B.box('in_steel', m.in_steel, [b - a, 0.5, 0.012], [(a + b) / 2, btop + 0.25, back + 0.006]);
  B.add('in_ao', m.in_ao, new THREE.PlaneGeometry(W + 0.3, 0.7), mat4([cx, ceil - 0.02, back + 0.2], [Math.PI / 2, 0, 0]), no);
  B.add('in_ao', m.in_ao, new THREE.PlaneGeometry(W + 0.3, 0.8), mat4([cx, ceil - 0.02, front - 0.25], [Math.PI / 2, 0, 0]), no);
  B.add('in_ao', m.in_ao, new THREE.PlaneGeometry(1.0, D + 0.4), mat4([x0 + 0.2, ceil - 0.02, (front + back) / 2], [Math.PI / 2, 0, 0]), no);
  B.add('in_ao', m.in_ao, new THREE.PlaneGeometry(1.0, D + 0.4), mat4([x1 - 0.2, ceil - 0.02, (front + back) / 2], [Math.PI / 2, 0, 0]), no);
  // shelves on the back wall right of the pie case: cups, glasses, boxed goods
  const sh0 = 2.25, sh1 = x1 - 0.1;
  for (const y of [DECK + 1.5, DECK + 1.86]) {
    B.box('in_steel', m.in_steel, [sh1 - sh0, 0.025, 0.24], [(sh0 + sh1) / 2, y, back + 0.12]);
    B.add('in_goods', m.in_goods, new THREE.PlaneGeometry(sh1 - sh0 - 0.1, 0.26), mat4([(sh0 + sh1) / 2, y + 0.14, back + 0.015]), no);
    for (let x = sh0 + 0.15; x < sh1 - 0.1; x += 0.13) B.cyl('in_glass', m.in_glass, 0.035, 0.03, 0.11, [x, y + 0.068, back + 0.17], [0, 0, 0], 10, no);
  }
  // letterboard menus over the back bar, and the clock
  const boards = [[(P.x0 + P.x1) / 2, 1.5], [1.75, 1.7], [3.95, 1.9]];
  const menuY = DECK + 2.42;
  boards.forEach(([bx, bwid], i) => {
    const g = new THREE.PlaneGeometry(bwid, 0.62);
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setY(k, 1 - (i + 1 - uv.getY(k)) / 3);
    B.add('in_menu', m.in_menu, g, mat4([bx, menuY, back + 0.022]), no);
    B.box('in_black', m.in_black, [bwid + 0.04, 0.66, 0.035], [bx, menuY, back + 0.004]);
  });
  B.cyl('in_red', m.in_red, 0.2, 0.2, 0.05, [2.85, DECK + 2.95, back + 0.025], [Math.PI / 2, 0, 0], 28);
  B.add('in_clock', m.in_clock, new THREE.CircleGeometry(0.175, 28), mat4([2.85, DECK + 2.95, back + 0.052]), no);
  // the pass: a steel shelf through the wall, heat lamps under its head,
  // the ticket rail, plates going out
  B.box('in_steel', m.in_steel, [P.x1 - P.x0 + 0.1, 0.03, 0.55], [(P.x0 + P.x1) / 2, P.y0 + 0.015, back - 0.08]);
  B.box('in_steel', m.in_steel, [P.x1 - P.x0 + 0.1, 0.04, 0.12], [(P.x0 + P.x1) / 2, P.y1 - 0.02, back - 0.02]);
  B.box('in_chrome', m.in_chrome, [P.x1 - P.x0 - 0.1, 0.025, 0.03], [(P.x0 + P.x1) / 2, P.y1 - 0.06, back - 0.12]);
  for (let x = P.x0 + 0.2; x < P.x1 - 0.1; x += 0.24) B.add('in_ticket', m.in_ticket, new THREE.PlaneGeometry(0.075, 0.13), mat4([x + Math.sin(x * 9) * 0.02, P.y1 - 0.13, back - 0.137], [0.05 * Math.sin(x * 7), 0, 0.06 * Math.sin(x * 13)]), no);
  for (const lx of [P.x0 + 0.35, (P.x0 + P.x1) / 2, P.x1 - 0.35]) {
    B.cyl('in_steel', m.in_steel, 0.06, 0.075, 0.08, [lx, P.y1 - 0.1, back - 0.05], [0, 0, 0], 12);
    B.add('in_heat', m.in_heat, new THREE.CircleGeometry(0.05, 12), mat4([lx, P.y1 - 0.141, back - 0.05], [Math.PI / 2, 0, 0]), no);
  }
  for (const [px, food] of [[P.x0 + 0.3, 'burger'], [P.x0 + 0.75, 'plate'], [P.x1 - 0.35, 'burger']]) {
    const py = P.y0 + 0.035;
    B.cyl('in_cup', m.in_cup, 0.13, 0.11, 0.018, [px, py + 0.009, back - 0.05], [0, 0, 0], 20);
    if (food === 'burger') {
      B.add('in_pie', m.in_pie, new THREE.SphereGeometry(0.055, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat4([px - 0.03, py + 0.04, back - 0.05], [0, 0, 0], [1, 0.7, 1]));
      B.cyl('in_food', m.in_food, 0.056, 0.056, 0.016, [px - 0.03, py + 0.03, back - 0.05], [0, 0, 0], 12);
      for (let k = 0; k < 7; k++) B.box('in_fries', m.in_fries, [0.009, 0.009, 0.075], [px + 0.06 + (k % 3) * 0.012, py + 0.024 + Math.floor(k / 3) * 0.008, back - 0.05 + (k - 3) * 0.008], [0, k * 0.4, 0]);
    } else {
      B.add('in_food', m.in_food, new THREE.SphereGeometry(0.07, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat4([px, py + 0.018, back - 0.05], [0, 0, 0], [1.2, 0.45, 0.8]));
      B.add('in_green', m.in_green, new THREE.SphereGeometry(0.03, 8, 5), mat4([px + 0.07, py + 0.03, back - 0.03]));
    }
  }

  // ---------------------------------------------------------------- domes and pendants
  for (const [x, y, z] of IN.domes) {
    B.cyl('in_chrome', m.in_chrome, 0.2, 0.2, 0.025, [x, ceil - 0.012, z], [0, 0, 0], 20);
    B.add('in_dome', m.in_dome, new THREE.SphereGeometry(0.17, 18, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI * 0.32), mat4([x, ceil - 0.02, z]), no);
  }
  for (const [x, y, z] of IN.pendants) {
    B.rod('in_black', m.in_black, [x, ceil, z], [x, y + 0.13, z], 0.006, 4, no);
    B.cyl('in_chrome', m.in_chrome, 0.03, 0.15, 0.1, [x, y + 0.11, z], [0, 0, 0], 16, no);
    B.add('pendant', m.pendant, new THREE.SphereGeometry(0.12, 18, 10), mat4([x, y, z]), no);
  }

  // ---------------------------------------------------------------- kitchen
  const K = IN.kitchen;
  const kxc = (K.x0 + K.x1) / 2;
  const kzc = (K.z0 + K.z1) / 2;
  const kw = K.x1 - K.x0;
  const kd = K.z0 - K.z1;
  B.add('k_floor', m.k_floor, planeUV(kw, kd, 1), mat4([kxc, F, kzc], [-Math.PI / 2, 0, 0]), { cast: false, receive: true });
  B.add('k_tile', m.k_tile, planeUV(kw, K.ceil - DECK, 1), mat4([kxc, (K.ceil + DECK) / 2, K.z1]));
  B.add('k_tile', m.k_tile, planeUV(kd, K.ceil - DECK, 1), mat4([K.x0, (K.ceil + DECK) / 2, kzc], [0, Math.PI / 2, 0]));
  B.add('k_tile', m.k_tile, planeUV(kd, K.ceil - DECK, 1), mat4([K.x1, (K.ceil + DECK) / 2, kzc], [0, -Math.PI / 2, 0]));
  // the kitchen side of the dining room's back wall, around the pass
  {
    const kz = K.z0 + 0.001;
    const kf = (a, b, y0, y1) => B.add('k_tile', m.k_tile, planeUV(b - a, y1 - y0, 1), mat4([(a + b) / 2, (y0 + y1) / 2, kz], [0, Math.PI, 0]));
    kf(K.x0, P.x0, DECK, K.ceil);
    kf(P.x1, K.x1, DECK, K.ceil);
    kf(P.x0, P.x1, DECK, P.y0);
    kf(P.x0, P.x1, P.y1, K.ceil);
  }
  B.add('in_ceiling', m.in_ceiling, planeUV(kw, kd, 1), mat4([kxc, K.ceil, kzc], [Math.PI / 2, 0, 0]));
  // its outside: flat backs (seen from behind the set and from the grid)
  B.add('luan', m.luan, boxUV(kw + 0.1, 0.006, kd + 0.1), mat4([kxc, K.ceil + 0.01, kzc]));
  B.add('luan', m.luan, boxUV(kw + 0.12, K.ceil - DECK, 0.006), mat4([kxc, (K.ceil + DECK) / 2, K.z1 - 0.01]));
  for (const x of [K.x0 - 0.01, K.x1 + 0.01]) B.add('luan', m.luan, boxUV(0.006, K.ceil - DECK, kd), mat4([x, (K.ceil + DECK) / 2, kzc]));
  for (let x = K.x0; x <= K.x1 + 1e-3; x += kw / 3) B.box('pine', m.pine, [0.07, K.ceil - DECK, 0.07], [x, (K.ceil + DECK) / 2, K.z1 - 0.05]);
  // the range against the back: a griddle, two burners, a hood with its lamp
  const rz = K.z1 + 0.32;
  const kc = (P.x0 + P.x1) / 2;
  B.box('k_steel', m.k_steel, [1.7, 0.86, 0.62], [kc, DECK + 0.43, rz]);
  B.box('k_griddle', m.k_griddle, [0.95, 0.03, 0.56], [kc - 0.3, DECK + 0.875, rz]);
  for (const bx of [kc + 0.4, kc + 0.65]) B.add('in_black', m.in_black, new THREE.TorusGeometry(0.08, 0.012, 5, 14), mat4([bx, DECK + 0.87, rz], [Math.PI / 2, 0, 0]));
  B.cyl('k_steel', m.k_steel, 0.11, 0.1, 0.2, [kc + 0.52, DECK + 0.98, rz], [0, 0, 0], 16);
  B.box('k_steel', m.k_steel, [1.7, 0.4, 0.02], [kc, DECK + 1.1, K.z1 + 0.012]);
  B.add('k_steel', m.k_steel, new THREE.CylinderGeometry(Math.SQRT1_2 * 0.7, Math.SQRT1_2 * 1.1, 0.5, 4, 1, true, Math.PI / 4), mat4([kc, DECK + 2.2, K.z1 + 0.4], [0, 0, 0], [1.25, 1, 0.75]));
  B.add('in_tube', m.in_tube, new THREE.PlaneGeometry(1.0, 0.05), mat4([kc, DECK + 1.96, K.z1 + 0.4], [Math.PI / 2, 0, 0]), no);
  // a shelf of pots over the range end, a prep table, the ceiling fluorescent
  B.box('k_steel', m.k_steel, [0.8, 0.025, 0.28], [K.x0 + 0.5, DECK + 1.75, K.z1 + 0.14]);
  for (const [x, r, h] of [[K.x0 + 0.3, 0.11, 0.16], [K.x0 + 0.6, 0.13, 0.22], [K.x0 + 0.8, 0.08, 0.12]]) B.cyl('k_steel', m.k_steel, r, r, h, [x, DECK + 1.765 + h / 2, K.z1 + 0.15], [0, 0, 0], 16);
  B.box('k_steel', m.k_steel, [0.45, 0.88, 0.6], [K.x1 - 0.25, DECK + 0.44, rz]);
  B.box('in_tube', m.in_tube, [1.2, 0.03, 0.06], [kxc, K.ceil - 0.03, kzc], [0, 0, 0], no);
  B.box('k_steel', m.k_steel, [1.26, 0.04, 0.12], [kxc, K.ceil - 0.01, kzc], [0, 0, 0], no);

  // ---------------------------------------------------------------- behind the back wall
  // The gap between the diner's back wall and the flat behind it (z -4.3 to
  // -5.55, from the kitchen to the end of the set): the back wall's braced
  // back, kickers to the floor, a stage weight, cable runs, a coiled cable,
  // a ladder laid along it. The station "Backstage" looks down it.
  {
    const zb = back - 0.1;
    flatBackZ(B, m, zb, K.x1 + 0.02, DINER.x1, DECK, ceil, { side: -1, jacks: false });
    for (const x of [2.2, 3.6, 4.9]) {
      B.rod('pine', m.pine, [x, DECK + 2.3, zb - 0.06], [x, 0.03, zb - 0.95], 0.022, 5);
      B.box('darkMetal', m.darkMetal, [0.22, 0.05, 0.3], [x, 0.025, zb - 0.98]); // the weight on its foot
    }
    sandbag(B, m, [2.9, 0, zb - 0.7], 0.1);
    sandbag(B, m, [4.3, 0, zb - 0.62], -0.2);
    cable(B, m, [[1.3, zb - 0.45], [2.6, zb - 0.55], [4.0, zb - 0.4], [5.6, zb - 0.5], [7.5, zb - 0.45], [9.8, -4.1], [12.5, -4.1]], 0, 'cableBlack', 0.016);
    cable(B, m, [[1.5, zb - 0.75], [3.0, zb - 0.8], [5.2, zb - 0.72], [6.6, zb - 0.6], [8.3, -4.05]], 0, 'cableOrange', 0.013);
    B.add('cableBlack', m.cableBlack, new THREE.TorusGeometry(0.22, 0.016, 5, 20), mat4([3.25, 0.02, zb - 0.9], [Math.PI / 2, 0, 0]));
    B.add('cableBlack', m.cableBlack, new THREE.TorusGeometry(0.18, 0.016, 5, 20), mat4([3.27, 0.05, zb - 0.88], [Math.PI / 2, 0, 0.2]));
    // a ladder laid on its side against the flat
    for (const y of [0.04, 0.5]) B.rod('gripSilver', m.gripSilver, [5.0, y, zb - 0.12], [6.6, y, zb - 0.15], 0.018, 5);
    for (let x = 5.15; x < 6.55; x += 0.3) B.rod('gripSilver', m.gripSilver, [x, 0.04, zb - 0.13], [x, 0.5, zb - 0.14], 0.012, 4);
    // the far side of the gap: the painted face of the flat behind the diner,
    // below the diner's roofline (hidden from the shot), lit by the work bulb
    B.add('bkBrick', m.bkBrick, planeUV(DINER.x1 + 1.2 - K.x1, DINER.height - 0.2, 1), mat4([(K.x1 + DINER.x1 + 1.2) / 2, (DINER.height - 0.2) / 2, -5.545]));
    // a caged work bulb on its cord over the gap
    const wb = [3.9, 3.55, zb - 0.62];
    B.rod('cableBlack', m.cableBlack, [wb[0], 8.6, wb[2]], [wb[0], wb[1] + 0.12, wb[2]], 0.01, 4, no);
    B.add('castIron', m.castIron, new THREE.CylinderGeometry(0.09, 0.09, 0.2, 8, 1, true), mat4(wb), no);
    B.add('bulb', m.bulb, new THREE.SphereGeometry(0.05, 10, 8), mat4(wb), no);
  }

  // ---------------------------------------------------------------- people
  // Two at the counter, backs to the street; one in booth D; the waitress
  // with a pot behind the counter; the cook at the pass.
  const S = IN.stoolZ;
  const seat = DECK + IN.seat;
  const folk = [
    // a man in a fedora and a grey trench coat, hunched over his coffee
    { at: [IN.stoolX(1), seatedAt(seat), S], turn: Math.PI - 0.15, lean: 0.32, headTilt: 0.15, skin: SKIN[0], hair: 'brown', hat: 'fedora', hatColor: 0x3a3430,
      coat: { color: 0x5a564e }, bottom: 0x2a2826, shoes: 0x1a1410,
      hands: [[-0.12, 0.25, 0.42], [0.1, 0.26, 0.44]], elbows: [[-1, -0.3, 0], [1, -0.3, 0]], feet: seatedFeet(IN.seat, { footRest: 0.22, forward: 0.3 }) },
    // a woman with a bob in a dark red coat, turned a little toward him
    { at: [IN.stoolX(2), seatedAt(seat), S], turn: Math.PI + 0.35, lean: 0.12, headTurn: -0.25, skin: SKIN[2], hair: 'auburn', hairStyle: 'bob', female: true, build: 0.95,
      coat: { color: 0x5a1416 }, bottom: 0x161618, shoes: 0x0e0c0c,
      hands: [[-0.16, 0.24, 0.4], [0.14, 0.37, 0.33]], elbows: [[-1, -0.2, 0], [1, -0.5, 0]], feet: seatedFeet(IN.seat, { footRest: 0.22, forward: 0.28, spread: 0.06 }) },
    // a man alone in the corner booth in a cap and work jacket
    { at: [x0 + 0.24, seatedAt(DECK + 0.45), -0.42], turn: Math.PI / 2, lean: 0.1, skin: SKIN[3], hair: 'black', hat: 'cap', hatColor: 0x1e2a3a,
      top: 0x3a4a5a, bottom: 0x2a3040, shoes: 0x2a1c12,
      hands: [[-0.12, 0.17, 0.36], [0.14, 0.17, 0.38]], elbows: [[-1, -0.4, 0], [1, -0.4, 0]], feet: seatedFeet(0.45, { forward: 0.4 }) },
    // the waitress, pot in hand, behind the counter
    { at: [1.0, DECK + 0.95, -3.02], turn: 0.25, lean: 0.05, headTurn: 0.3, skin: SKIN[5], hair: 'brown', hairStyle: 'bun', female: true, build: 0.93,
      top: 0x7a9aa8, bottom: 0x7a9aa8, apron: 0xece8de, shoes: 0xece8de, sleeves: 'short',
      hands: [[-0.2, -0.32, 0.12], [0.22, 0.05, 0.3]], elbows: [[-0.6, -0.2, -1], [1, -0.6, -0.5]] },
    // the cook at the pass, both hands on a plate on the shelf
    { at: [(IN.pass.x0 + IN.pass.x1) / 2 - 0.1, DECK + 0.95, IN.back - 0.52], turn: 0, lean: 0.12, headTilt: 0.12, skin: SKIN[1], hair: 'black', hat: 'toque',
      top: 0xe8e4da, bottom: 0x3a3a3c, apron: 0xf0ece4, shoes: 0x111111,
      hands: [[-0.1, 0.27, 0.42], [0.18, 0.27, 0.44]], elbows: [[-1, -0.6, 0], [1, -0.6, 0]] },
  ];
  const peopleGeo = crowd(folk);
  const people = new THREE.Mesh(peopleGeo, m.in_people);
  people.name = 'in_people';
  people.castShadow = true;
  people.receiveShadow = true;
  people.matrixAutoUpdate = false;
  root.add(people);
  // the coffee pot in the waitress's hand
  B.add('in_glass', m.in_glass, new THREE.SphereGeometry(0.075, 14, 10), mat4([1.0 + 0.22 * Math.cos(0.25) + 0.3 * Math.sin(0.25) - 0.02, DECK + 0.95 - 0.06, -3.02 - 0.22 * Math.sin(0.25) + 0.3 * Math.cos(0.25)], [0, 0, 0], [1, 0.9, 1]), no);
  for (const [x, z, s2] of [[IN.stoolX(1), S, 0.75], [IN.stoolX(2), S, 0.7], [x0 + 0.24, -0.42, 0.7], [1.0, -3.02, 0.6], [(IN.pass.x0 + IN.pass.x1) / 2, IN.back - 0.52, 0.6]]) {
    B.add('in_ao', m.in_ao, new THREE.PlaneGeometry(s2, s2), mat4([x, F + 0.003, z], [-Math.PI / 2, 0, 0]), no);
  }

  const meshes = B.build(root);
  meshes.push(people);
  // the wild wall: the end flat (painted inside, braced outside), its own group
  const WB = new Builder();
  WB.box('wallIn', m.wallIn, [0.1, wallH, -back], [x1 + 0.05, DECK + wallH / 2, back / 2]);
  WB.box('flatEdge', m.flatEdge, [0.12, 0.04, -back], [x1 + 0.06, DECK + wallH + 0.02, back / 2]);
  flatBackX(WB, m, DINER.x1 - 0.05, 0, DINER.back, DECK, DECK + 3.4, +1);
  const wild = new THREE.Group();
  wild.name = 'wildWall';
  WB.build(wild);
  root.add(wild);
  for (const mesh of meshes) if (mesh.material === m.in_ao) mesh.renderOrder = 2;
  return { meshes, wild, pendants: IN.pendants, domes: IN.domes, workBulbs: [[3.9, 3.55, DINER.back - 0.72, 0.012]] };
}

/** Where the interior's practicals are (real metres) and how strong (world units). */
const PENDANT = { round: 0.9, pool: 3.4, cone: [0.78, 0.95, 0.0] };
export function interiorLights() {
  const warm = 0xffc890;
  const L = [];
  // each pendant: what its white shade scatters all round, and its pool:
  // the downlight on the counter and the floor below
  for (const p of IN.pendants) {
    L.push({ pos: [p[0], p[1] - 0.05, p[2]], color: warm, power: PENDANT.round });
    L.push({ pos: [p[0], p[1] - 0.05, p[2]], color: warm, power: PENDANT.pool, dir: [0, -1, 0], cone: PENDANT.cone });
  }
  for (const p of IN.domes) L.push({ pos: [p[0], p[1] - 0.2, p[2]], color: 0xffd8a8, power: 1.1 });
  L.push({ pos: [1.78, DECK + IN.bh + 0.6, (IN.bz0 + IN.bz1) / 2 + 0.3], color: 0xfff0d8, power: 0.25 }); // pie case
  L.push({ pos: [(IN.pass.x0 + IN.pass.x1) / 2, IN.pass.y0 + 0.2, IN.back + 0.2], color: 0xe8f0ff, power: 0.35 }); // the kitchen's light through the pass
  return L;
}
export function kitchenLights() {
  const K = IN.kitchen;
  return [
    { pos: [(K.x0 + K.x1) / 2, K.ceil - 0.15, (K.z0 + K.z1) / 2], color: 0xe8f2ff, power: 1.2 },
    { pos: [(IN.pass.x0 + IN.pass.x1) / 2, DECK + 1.85, K.z1 + 0.42], color: 0xfff4e0, power: 0.6 },
  ];
}

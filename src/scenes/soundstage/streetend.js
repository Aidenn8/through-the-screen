// The street's far end, for the big swings to the left: the deck runs on past
// the side street under the end of the rain rig and stops at a translight,
// the street painted on in forced perspective, running on into the city.
// From the side its painted vanishing lines point at nothing, its hem and
// pipe frame show, and the rain stops short of it. The water for the rain
// comes in from the truck outside on a 4-inch hose, through a pump to the
// rig's header. Real metres, stage floor y 0.

import * as THREE from 'three';
import { boxUV, mat4, tube } from '../_lib/geo.js';
import { DECK, RIG, STREET_END, DROP } from './layout.js';
import { GRID_Y } from './stage.js';

export function buildStreetEnd(B, m, { sandbag }) {
  const noShadow = { cast: false, receive: false };
  const { x: DX, z0, z1, y0, h } = DROP;
  const w = z1 - z0;
  const zc = (z0 + z1) / 2;
  // the translight: facing the street (+x), u from the front (z1) back
  B.add('streetDrop', m.streetDrop, new THREE.PlaneGeometry(w, h), mat4([DX, y0 + h / 2, zc], [0, Math.PI / 2, 0]), noShadow);
  // its frame: a top batten and a bottom pipe, side pipes, the hem's grommet
  // ties; picked up to the grid on short chains; sandbags on the bottom pipe
  for (const y of [y0 + h + 0.06, y0 - 0.03]) B.rod('gridPipe', m.gridPipe, [DX - 0.05, y, z0 - 0.3], [DX - 0.05, y, z1 + 0.3], 0.03, 6, noShadow);
  for (const z of [z0 - 0.08, z1 + 0.08]) B.rod('gridPipe', m.gridPipe, [DX - 0.05, y0 - 0.03, z], [DX - 0.05, y0 + h + 0.06, z], 0.025, 6, noShadow);
  for (const z of [z0 + 0.6, zc, z1 - 0.6]) B.rod('chain', m.chain, [DX - 0.05, y0 + h + 0.06, z], [DX - 0.05, GRID_Y, z], 0.012, 4, noShadow);
  for (const z of [z0 + 1.2, zc - 2.5, zc + 2.5, z1 - 1.2]) sandbag(B, m, [DX + 0.18, 0, z], Math.PI / 2);
  // black masking legs at its two ends, a little in front of it
  for (const z of [z0 - 0.7, z1 + 0.7]) B.add('drape', m.drape, new THREE.PlaneGeometry(1.2, h + 0.6), mat4([DX + 0.25, (h + 0.6) / 2, z], [0, Math.PI / 2, 0]), noShadow);
  // the translight's glow on the floor in front of it
  B.add('glowWarmFloor', m.glowWarmFloor, new THREE.PlaneGeometry(2.4, w), mat4([DX + 1.0, 0.012, zc], [-Math.PI / 2, 0, Math.PI / 2]), noShadow);

  // the deck's end: a raw edge with a kick of black paint, a strip of
  // stage floor between it and the drop, spike marks for the drop's feet
  B.box('blackPaint', m.blackPaint, [0.02, DECK * 0.6, 5.6], [STREET_END - 0.012, DECK * 0.3, 2.6], [0, 0, 0], noShadow);
  for (const z of [z0 + 0.2, 2.6, z1 - 0.2]) {
    B.add('tape', m.tape, new THREE.PlaneGeometry(0.3, 0.05), mat4([DX + 0.35, 0.004, z], [-Math.PI / 2, 0, 0]), noShadow);
    B.add('tape', m.tape, new THREE.PlaneGeometry(0.05, 0.3), mat4([DX + 0.35, 0.004, z], [-Math.PI / 2, 0, 0]), noShadow);
  }

  // the rain rig's left end: a header across the bars and the feed riser
  // down behind the deck to a valve manifold on the floor
  const hx = RIG.x0;
  B.rod('rainBars', m.rainBars, [hx, RIG.y, 0.4], [hx, RIG.y, 4.3], 0.06, 8, noShadow);
  B.add('rainBars', m.rainBars, tube([[hx, RIG.y, 0.4], [hx, RIG.y, -0.4], [hx, RIG.y - 0.4, -0.75], [hx, 1.0, -0.75], [hx, 0.45, -0.75]], 0.06, 24, 8), null, noShadow);
  const mf = [hx, 0, -0.75];
  B.box('rainBars', m.rainBars, [0.9, 0.16, 0.16], [mf[0] - 0.2, 0.36, mf[2]]);
  for (const dx of [-0.5, 0.1]) {
    B.cyl('rainBars', m.rainBars, 0.05, 0.05, 0.3, [mf[0] + dx, 0.36, mf[2]], [0, 0, 0], 10);
    B.add('redEnamel', m.redEnamel, new THREE.TorusGeometry(0.11, 0.015, 6, 16), mat4([mf[0] + dx, 0.53, mf[2]], [Math.PI / 2, 0, 0]));
  }
  B.add('gripSilver', m.gripSilver, new THREE.CylinderGeometry(0.06, 0.06, 0.03, 16), mat4([mf[0] - 0.2, 0.36, mf[2] + 0.09], [Math.PI / 2, 0, 0]));
  B.box('blackPaint', m.blackPaint, [0.3, 0.3, 0.3], [mf[0] - 0.2, 0.15, mf[2]]);
  // the pump on its cart: engine box, volute, wheels, a handle
  const P = [-8.5, 0, -3.3];
  B.box('pumpRed', m.pumpRed, [0.75, 0.5, 0.5], [P[0], 0.5, P[2]], [0, 0.4, 0]);
  B.cyl('pumpRed', m.pumpRed, 0.2, 0.2, 0.2, [P[0] + 0.4, 0.4, P[2] + 0.2], [Math.PI / 2, 0.4, 0], 16);
  B.box('darkMetal', m.darkMetal, [0.9, 0.06, 0.6], [P[0], 0.22, P[2]], [0, 0.4, 0]);
  for (const s of [-1, 1]) B.cyl('rubber', m.rubber, 0.2, 0.2, 0.1, [P[0] - 0.1 * s, 0.2, P[2] + 0.32 * s], [Math.PI / 2, 0.4, 0], 14);
  B.rod('gripSilver', m.gripSilver, [P[0] - 0.4, 0.5, P[2] - 0.15], [P[0] - 0.95, 0.95, P[2] - 0.45], 0.018, 5);
  // the hose: in from the truck at the back wall's door, round the
  // ladders to the pump, on to the manifold
  const hose = (pts) => B.add('hoseRed', m.hoseRed, tube(pts.map(([x, z]) => [x, 0.055, z]), 0.055, pts.length * 14, 7), null, { cast: false, receive: true });
  hose([[-7.4, -16.8], [-7.8, -14.5], [-9.3, -12.0], [-9.4, -9.0], [-9.0, -6.5], [-8.9, -4.6], [-8.75, -3.6]]);
  hose([[-8.05, -3.0], [-7.9, -2.2], [-8.2, -1.4], [-7.9, -0.9], [-7.75, -0.78]]);
  // the hose port: a small door in the back wall, propped open on the night
  B.box('doorSteel', m.doorSteel, [1.1, 2.2, 0.06], [-7.4, 1.1, -16.72]);
  B.add('drape', m.drape, new THREE.PlaneGeometry(0.9, 0.5), mat4([-7.4, 0.28, -16.68]), noShadow);
  // the translight's light on the floor and the gear in front of it (a work
  // light term, warm, at its face)
  return { glow: [DX + 0.4, 2.5, -1.5] };
}

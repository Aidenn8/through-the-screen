// Does each station keep its subject in frame while the viewer moves their
// head the usual amount? A CPU check (no rendering) for scene tests:
//
//   import { checkSubjects } from '../../src/core/subject-check.js';
//   for (const r of checkSubjects(NAV)) assert.ok(r.ok, `${r.id}: ${JSON.stringify(r.worst)}`);
//
// For every station with `subject` (a scene point), the head moves through
// a grid of typical moves about where the viewer sits (by default ±10 cm
// sideways, ±6 cm up and down, ±10 cm in depth, with the corners); each head
// position is mapped the way the app maps it (Look around at 3x by default,
// 1.5x up and down, the station's `view` limits, the view cone), and the
// subject must land on the glass inside the window, in front of the eye.
// Head turn is not modelled (it adds at most what the same strength does).

import { ViewMapper, STRENGTH, viewGain, blendLimits, limitEye } from '../tracking/view-map.js';
import { glassPoint } from './projection.js';
import { normalizeNav, sceneToWindow, keepEyeInRoom } from './rig.js';
import { displaySize, DEFAULT_DISPLAY } from './display.js';

export const TYPICAL_MOVES = Object.freeze({ x: 0.1, y: 0.06, z: 0.1 });

export { sceneToWindow };

/**
 * Where the app would draw from for a head at `head` (display = window
 * coordinates in full screen), sitting at `rest`, at a station.
 */
export function eyeAt(head, rest, view, stationView, mapper = new ViewMapper()) {
  const g = viewGain(view);
  const q = {};
  for (const k of ['x', 'y', 'z']) q[k] = rest[k] + g[k] * (head[k] - rest[k]);
  return limitEye(mapper.clamp(q), rest, blendLimits([{ view: stationView ?? null, w: 1 }], view));
}

/**
 * @param {object} nav a scene's nav (as exported, or normalized)
 * @param {object} [o]
 * @param {{direction:string, strength:number}} [o.view] the viewer's setting (default Look around 3x)
 * @param {{width:number, height:number}} [o.size] the window (default: the 15-inch Air's screen)
 * @param {{x,y,z}} [o.rest] where the viewer sits (default 60 cm straight in front)
 * @param {{x,y,z}} [o.moves] the typical head moves (half ranges, metres)
 * @param {number} [o.margin] metres the subject must keep inside the window's edge
 * @param {'cube'|'axes'} [o.grid] 'cube' (default): all 27 combinations,
 *   corners included (leaning, rising and moving in or out at once);
 *   'axes': depth on its own, and sideways with up and down at the seat
 * @returns {{id, title, ok:boolean, reach:number, worst:object, misses:object[]}[]}
 *   reach: the largest |glass x| / (W/2) or |glass y| / (H/2) over the moves (inside is < 1)
 */
export function checkSubjects(nav, {
  view = { direction: 'look', strength: STRENGTH.look },
  size = null,
  rest = { x: 0, y: 0, z: 0.6 },
  moves = TYPICAL_MOVES,
  margin = 0,
  grid = 'cube',
} = {}) {
  const offsets = [];
  for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
    if (grid === 'axes' && dz !== 0 && (dx !== 0 || dy !== 0)) continue;
    offsets.push([dx, dy, dz]);
  }
  const n = nav?.stations?.[0]?.pose && 'x' in nav.stations[0].pose ? nav : normalizeNav(nav, () => {});
  if (!n) return [];
  const win = size || displaySize(DEFAULT_DISPLAY);
  const hw = win.width / 2 - margin;
  const hh = win.height / 2 - margin;
  const mapper = new ViewMapper();
  const out = [];
  for (const st of n.stations) {
    if (!st.subject) continue;
    const s = sceneToWindow(st.pose, st.subject);
    let reach = 0;
    let worst = null;
    const misses = [];
    for (const [dx, dy, dz] of offsets) {
      const head ={ x: rest.x + dx * moves.x, y: rest.y + dy * moves.y, z: rest.z + dz * moves.z };
      const eye = keepEyeInRoom(eyeAt(head, rest, view, st.view, mapper), st.pose, n.room);
      const behind = !(s.z < eye.z - 1e-6);
      const gp = behind ? { x: Infinity, y: Infinity } : glassPoint(eye, s);
      const r = Math.max(Math.abs(gp.x) / (win.width / 2), Math.abs(gp.y) / (win.height / 2));
      const inside = !behind && Math.abs(gp.x) <= hw && Math.abs(gp.y) <= hh;
      const rec = { head: { dx: dx * moves.x, dy: dy * moves.y, dz: dz * moves.z }, eye, glass: gp, behind };
      if (!inside) misses.push(rec);
      if (r >= reach) { reach = r; worst = rec; }
    }
    out.push({ id: st.id, title: st.title, ok: misses.length === 0, reach, worst, misses });
  }
  return out;
}

// Moving the window through the Soundstage (docs/ARCHITECTURE.md, "Moving the
// window"): the stations, the bounds the rig may move in, its scale range and
// the tour.
//
// Each station is written as a person standing (or sitting) in the full-size
// set: where their eye is and what they look at, in real metres (layout.js),
// and the rig scale. At scale 1/16 the viewer is a person in the 1:16 set: the
// diner reads human-sized and a 15 cm lean is 15 cm in the set. The pose
// puts the glass 60 cm (times the scale, in window metres) in front of that
// eye, along the look direction, so the default eye (window 0, 0, 60 cm)
// lands exactly on it.

import { toWindow, SCALE } from './layout.js';
import { ROOM } from './stage.js';

export const HUMAN = SCALE; // the viewer at life size in the set
const DEG = 180 / Math.PI;

/**
 * A rig pose from an eye and a look point (real metres).
 * yaw: positive turns left (about +y) from looking down -z; pitch: up.
 */
export function poseFor({ eye, look, scale = HUMAN, roll = 0 }) {
  void roll;
  const d = [look[0] - eye[0], look[1] - eye[1], look[2] - eye[2]];
  const n = Math.hypot(...d);
  const f = d.map((v) => v / n);
  const yaw = Math.atan2(-f[0], -f[2]) * DEG;
  const pitch = Math.asin(f[1]) * DEG;
  const e = toWindow(...eye);
  // the glass is 0.6 * scale (window metres) in front of the eye
  const position = e.map((v, k) => v + 0.6 * scale * f[k]);
  const r = (v, k = 5) => Number(v.toFixed(k));
  return { position: position.map((v) => r(v)), yaw: r(yaw, 2), pitch: r(pitch, 2), scale: r(scale, 5) };
}

// What the default eye stands on and looks at (real metres, stage floor y 0).
export const STATION_VIEWS = {
  // "On the sidewalk": standing at the curb by the door, a step back from
  // the glass, two windows into the room and the man at the counter
  sidewalk: { eye: [4.83, 1.68, 1.8], look: [0.45, 1.55, -1.2] },
  // "Inside the diner": at the room's open end (its end wall is a wild wall,
  // flown out for the camera), the whole length of it: the counter and its
  // stools on the left, the booths along the windows on the right with the
  // street outside, the back bar, the pass with the cook at the far end
  inside: { eye: [7.3, 1.6, -1.15], look: [-1.45, 1.22, -2.75] },
  // "Behind the camera": over the A-camera's shoulder on its dolly
  camera: { eye: [0.55, 2.2, 18.9], look: [-0.35, 1.6, 0.0] },
  // "Video village": behind the director's chair, the monitors with the shot
  village: { eye: [7.36, 1.72, 2.11], look: [9.39, 1.35, -1.53] },
  // "The catwalk": on the stage-left catwalk at the front, over the camera
  // end and down across the set, the rain rig and video village
  catwalk: { eye: [-12.9, 12.05, 27.0], look: [1.0, 1.0, 2.2] },
  // "Backstage": in the gap behind the diner, between flat backs, down to
  // the stage door with its exit sign and the red light on
  backstage: { eye: [2.35, 1.66, -4.92], look: [13.7, 1.55, -4.62] },
  // "The backdrop": down the street's own line, tilted down so the wet deck
  // runs to its edge, the dry gap where the rain stops, and the painted
  // street carrying on from there to its vanishing point (painted for this
  // line) at the top of the frame
  backdrop: { eye: [-3.1, 2.1, 2.6], look: [-10.2, 0.91, 2.6] },
};

// Each station's subject (set metres: what must stay in frame at typical
// head moves) and its view limits (docs/ARCHITECTURE.md). At life size every
// subject is metres behind a 33 cm window held 60 cm from the eye: the
// window behaves like a long lens, an eye moved off centre mostly pans, so
// these stations hold Look around to 1.2-1.5x with no extra up and down, and
// keep the eye from backing more than 85 cm (life) from the glass.
const SUBJECTS = {
  shot: [-0.32, 2.88, 6.68], // the boom mic in front of the glass (in frame from every eye: scenes.test.js)
  sidewalk: [0.45, 1.55, -1.2], // in through the window, the man at the counter
  inside: [2.05, 1.37, -2.11], // down the counter
  camera: [-0.35, 1.6, 0.0], // the diner's front, over the camera
  backdrop: [-9.8, 0.6, 2.6], // where the real street meets the painted one
  backstage: [13.7, 1.6, -4.65], // the stage door
  village: [9.39, 1.45, -1.53], // the monitors' cart
  catwalk: [1.0, 1.0, 2.2], // the street in front of the diner
};
const VIEW = {
  sidewalk: { maxStrength: 1.5, verticalBoost: 1, maxEyeZ: 0.85 },
  inside: { maxStrength: 1.5, verticalBoost: 1, maxEyeZ: 0.85 },
  camera: { maxStrength: 1.5, verticalBoost: 1, maxEyeZ: 0.85 },
  backdrop: { maxStrength: 1.2, verticalBoost: 1, maxEyeZ: 0.85 },
  backstage: { maxStrength: 1.2, verticalBoost: 1, maxEyeZ: 0.85 },
  village: { maxStrength: 1.5, verticalBoost: 1, maxEyeZ: 0.85 },
  catwalk: { maxStrength: 1.2, verticalBoost: 1, maxEyeZ: 0.8 },
};
const st = (id, title, v) => ({ id, title, pose: poseFor(v), subject: toWindow(...SUBJECTS[id]).map((q) => Number(q.toFixed(5))), view: VIEW[id] });

export const NAV = {
  stations: [
    // the shot keeps the global head-tracking settings (no view limits)
    { id: 'shot', title: 'The shot', pose: { position: [0, 0, 0], yaw: 0, pitch: 0, scale: 1 }, subject: toWindow(...SUBJECTS.shot).map((q) => Number(q.toFixed(5))) },
    st('sidewalk', 'On the sidewalk', STATION_VIEWS.sidewalk),
    st('inside', 'Inside the diner', STATION_VIEWS.inside),
    st('camera', 'Behind the camera', STATION_VIEWS.camera),
    st('backdrop', 'The backdrop', STATION_VIEWS.backdrop),
    st('backstage', 'Backstage', STATION_VIEWS.backstage),
    st('village', 'Video village', STATION_VIEWS.village),
    st('catwalk', 'The catwalk', STATION_VIEWS.catwalk),
  ],
  // Where the rig (the glass) may go, window/scene metres: x +-12.8 m, y
  // 1.3-12 m (eye height up to the catwalks), z -15 to 30 m in the set's
  // real metres. With the eye's range at life size (+-45 cm sideways, 35-85
  // cm back, up and down) that keeps the eye inside the stage's walls
  // (ROOM in stage.js), above its floor and below its trusses
  // (tests/scenes/nav.test.js).
  bounds: { min: [-0.8, -0.04375, -1.3375], max: [0.8, 0.625, 1.475] },
  // from a little smaller than life (the set looks bigger) to the shot.
  // Between them the eye's own reach grows with the scale (1.4 m back from
  // the glass at the shot is 22 m in the set): see room
  scale: [0.05, 1],
  // Where the eye may be (the core clamps it here: at large scales its reach
  // is metres): the stage's inside, clear of what lines it. ROOM is the
  // walls' inner faces and the trusses' bottom chords; the pilasters and the
  // black paint lines stand 15-17 cm in from the walls, and the near plane
  // is 5 cm (depthcam), so the eye keeps 35 cm from the side walls, 40 cm
  // from the back wall, 45 cm from the front wall, 15 cm over the floor and
  // 15 cm under the chords (real metres).
  room: { min: toWindow(-ROOM.x + 0.35, 0.15, ROOM.back + 0.4), max: toWindow(ROOM.x - 0.35, ROOM.roof - 0.15, ROOM.front - 0.45) },
  // the frame -> the street -> inside -> the reveal -> the crew -> up high
  tour: ['shot', 'sidewalk', 'inside', 'camera', 'backdrop', 'backstage', 'village', 'catwalk'],
};

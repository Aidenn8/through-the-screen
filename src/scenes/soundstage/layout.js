// Layout of the soundstage, in real-world metres. The whole set is a 1:16
// miniature: the root group is scaled by SCALE and placed so the set's
// origin (stage floor, on the facade line, centred) sits behind the glass.
//
// Real axes match window axes: x right, y up, z toward the viewer.
// Straight on from 60 cm, the window frames the set like a camera: the eye
// is 16 m (real) in front of the facade at 2 m eye height.

export const SCALE = 1 / 16;
export const FLOOR_Y = -0.125; // window y of the stage floor
export const FACADE_Z = -0.4; // window z of the facade line

export const DECK = 0.1; // street deck height above the stage floor
export const CURB = 0.15; // sidewalk above the deck
export const WALK = DECK + CURB;

export const DINER = { x0: -1.6, x1: 5.4, back: -3.6, height: 4.4 };
export const SIDE_STREET = { x0: -5.2, x1: -1.6, back: -11.0 };
export const BACKING_Z = -11.2; // painted sky backing behind everything
export const BRICK_WALL = { x: -5.2, z0: -1.0, z1: -11.0, height: 6.6 };
export const FRONT_EDGE = 5.4; // front edge of the street deck (hidden below the frame straight on)
export const WALK_EDGE = 2.2; // curb line in front of the diner
// Rain rig: perforated bars hung over the street; rain falls only below them.
export const RIG = { x0: -7.6, x1: 5.4, z1: 5.2, y: 6.3 };
// Past the side street the street deck runs on and ends at a painted
// translight of the street going on into the city (streetend.js); the rain
// rig stops short of it.
export const STREET_END = -9.4; // the deck's far end
export const DROP = { x: -10.2, z0: -6.0, z1: 6.0, y0: 0.15, h: 8.0 };
// Parked sedan at the curb: its front bumper at x1 - 5.2, rear at x1, centred
// on z (12-20 cm behind the glass from 60 cm: the near layer of the shot).
export const CAR_AT = { x1: 6.2, z: 3.45 };
// The B-camera on its dolly (the left lean's payoff: the one prop everyone
// reads as "film set") and the key softbox. The scene builds from these and
// the reveal test checks the camera against them, the car and the set.
// floor: what the dolly stands on; lens: camera height above that floor.
export const BCAM = { x: 5.45, z: 0.6, floor: WALK, lens: 1.7, aim: [1.4, 1.4, 0.9], track: [0.15, 1.95] };
export const SOFTBOX = { head: [6.85, 3.3, -1.4], stand: [7.1, 0, -1.65], aim: [0.8, 1.4, 1.3], size: 1.6 };
// The C-stand flag cutting the softbox off the street front: its stand, and
// the top of the flag (a 0.9 x 1.2 m flag hangs below it).
export const FLAG = { stand: [7.5, 0, 0.3], at: [6.95, 2.55, 0.05] };

export function toWindow(x, y, z) {
  return [x * SCALE, y * SCALE + FLOOR_Y, z * SCALE + FACADE_Z];
}

export function toReal(x, y, z) {
  return [x / SCALE, (y - FLOOR_Y) / SCALE, (z - FACADE_Z) / SCALE];
}

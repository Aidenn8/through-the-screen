// Where the window can be carried in the Box (docs/ARCHITECTURE.md, "Moving
// the window"). Stations are written as where the eye sits (scene metres,
// the seated 60 cm eye), which way it looks and the rig's scale; the rig's
// position follows from them: position = eye - Ry(yaw) Rx(pitch) (0, 0, 0.6 scale).
//
// The house is about 1:12, so scale 0.1 is a viewer a little larger than
// life in it (the window 3.3 x 2 cm, the head's reach +-5 cm); scale 1 is
// the room box on the desk (today's view).

import * as THREE from 'three';

const D2R = Math.PI / 180;
const SEAT = 0.6; // the seated eye's distance from the glass (window metres)

/** Rig pose for an eye at `eye` (scene metres) looking (yaw, pitch) at `scale`. */
export function poseFromEye(eye, yaw, pitch, scale) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * D2R, yaw * D2R, 0, 'YXZ'));
  const back = new THREE.Vector3(0, 0, SEAT * scale).applyQuaternion(q);
  const r = (v) => Math.round(v * 10000) / 10000;
  return { position: [r(eye[0] - back.x), r(eye[1] - back.y), r(eye[2] - back.z)], yaw, pitch, scale };
}

/** The eye (scene metres) of a rig pose, for a window-space eye (default: seated, centred). */
export function eyeOfPose(pose, eye = [0, 0, SEAT]) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((pose.pitch ?? 0) * D2R, (pose.yaw ?? 0) * D2R, 0, 'YXZ'));
  return new THREE.Vector3(...eye).multiplyScalar(pose.scale ?? 1).applyQuaternion(q).add(new THREE.Vector3(...pose.position));
}

// Each station names its subject (a scene point that stays in frame at
// typical head moves; tests/scenes/box-nav.test.js checks it) and limits
// head tracking there (docs/ARCHITECTURE.md): outdoors the subject is many
// window-depths away and an off-centre eye mostly pans the view, so the
// strength is low and there is no extra up-and-down; maxEyeZ keeps the far
// eye out of the wall behind it.
export const nav = {
  stations: [
    // the room keeps the full 3x: its subject is the plum branch's arch over
    // the middle of the room (a point deeper than ~24 cm leaves the frame when
    // the head leans, dips and moves in at once)
    { id: 'room', title: 'The room', pose: { position: [0, 0, 0], yaw: 0, pitch: 0, scale: 1 }, subject: [-0.02, 0, -0.21] },
    { id: 'nextroom', title: 'The next room', pose: poseFromEye([0.24, -0.04, -0.045], -15, -1, 0.1),
      subject: [0.383, -0.035, -0.52], view: { maxStrength: 1.4, verticalBoost: 1, maxEyeZ: 0.8 } },
    { id: 'window', title: 'By the window', pose: poseFromEye([0.0, 0.035, -0.04], 30, -8, 0.1),
      subject: [-0.163, -0.01, -0.32], view: { maxStrength: 1.75, verticalBoost: 1, maxEyeZ: 1.0 } },
    { id: 'engawa', title: 'The engawa', pose: poseFromEye([-0.222, -0.045, -0.27], 89, -2, 0.1),
      subject: [-0.75, -0.08, -0.28], view: { maxStrength: 1.25, verticalBoost: 1, maxEyeZ: 0.85 } },
    { id: 'eave', title: 'Under the eave', pose: poseFromEye([-0.245, -0.035, -0.03], 8, 25, 0.1),
      subject: [-0.29, 0.088, -0.3], view: { maxStrength: 1.25, verticalBoost: 1, maxEyeZ: 0.9 } },
    { id: 'garden', title: 'The garden', pose: poseFromEye([-1.2, -0.016, -0.62], -112.5, 2, 0.1),
      subject: [-0.19, 0.02, -0.2], view: { maxStrength: 1.5, verticalBoost: 1, maxEyeZ: 1.2 } },
  ],
  // the rig's position: over the terrace, from inside the garden walls to
  // the room next door, from just over the floors to over the roof
  bounds: { min: [-1.3, -0.07, -1.25], max: [0.8, 0.35, 0.06] },
  scale: [0.06, 1],
  // one way round: the room, next door, back across to the window, out to
  // the engawa and its eave, then the garden looking back at the lit house
  tour: ['room', 'nextroom', 'window', 'engawa', 'eave', 'garden'],
};

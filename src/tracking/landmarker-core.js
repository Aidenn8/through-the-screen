// MediaPipe FaceLandmarker setup shared by the worker and the main-thread path.
//
// numFaces is 2 on purpose: the task graph applies its own One Euro smoothing to
// the landmarks only when numFaces == 1 (docs/REFERENCES.md 3.1). We filter the
// final eye point ourselves, so raw landmarks avoid stacking two filters' lag,
// and two faces let us follow the nearest viewer.

import { FaceLandmarker } from '@mediapipe/tasks-vision';

export const LANDMARK_COUNT = 478;

export async function createLandmarker({ wasm, modelUrl, delegate = 'GPU', numFaces = 2, canvas }) {
  const options = {
    baseOptions: { modelAssetPath: modelUrl, delegate },
    runningMode: 'VIDEO',
    numFaces,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: true,
  };
  if (canvas) options.canvas = canvas;
  return FaceLandmarker.createFromOptions(wasm, options);
}

/**
 * Flatten a FaceLandmarkerResult into transferable typed arrays.
 * @returns {{faces: Float32Array[], matrices: (Float32Array|null)[]}}
 */
export function packResult(res) {
  const faces = [];
  const matrices = [];
  const lms = res?.faceLandmarks || [];
  for (let i = 0; i < lms.length; i++) {
    const lm = lms[i];
    const a = new Float32Array(lm.length * 3);
    for (let j = 0; j < lm.length; j++) {
      a[j * 3] = lm[j].x;
      a[j * 3 + 1] = lm[j].y;
      a[j * 3 + 2] = lm[j].z;
    }
    faces.push(a);
    const m = res.facialTransformationMatrixes?.[i];
    matrices.push(m && m.data && m.data.length >= 16 ? Float32Array.from(m.data) : null);
  }
  return { faces, matrices };
}

/** Typed array -> [{x,y,z}] as the solver expects. */
export function unpackFace(a) {
  const n = a.length / 3;
  const out = new Array(n);
  for (let j = 0; j < n; j++) out[j] = { x: a[j * 3], y: a[j * 3 + 1], z: a[j * 3 + 2] };
  return out;
}

/** Monotonic millisecond timestamps for detectForVideo. */
export function monotonic() {
  let last = -Infinity;
  return (t) => {
    const ts = Math.max(Math.round(t), last + 1);
    last = ts;
    return ts;
  };
}

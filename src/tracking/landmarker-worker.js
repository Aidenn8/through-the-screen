// Face landmarks off the main thread. The render loop never waits on inference:
// the main thread hands over a VideoFrame and gets typed arrays back.
//
// Messages in:  {type:'init', wasm, modelUrl, delegate, numFaces}
//               {type:'frame', frame: VideoFrame, t, id}   (frame is transferred)
// Messages out: {type:'ready', delegate, initMs} | {type:'error', message}
//               {type:'result', id, t, inferMs, width, height, faces, matrices}

// First: only this server may be reached from here (MediaPipe's usage
// logging would otherwise post to Google once a minute).
import './net-guard-install.js';
import { isSameOriginOnly } from './net-guard.js';
import { createLandmarker, packResult, monotonic } from './landmarker-core.js';

let landmarker = null;
const stamp = monotonic();

async function init(msg) {
  const t0 = performance.now();
  if (!isSameOriginOnly(self)) {
    // Fail closed: no tracking rather than tracking that can call out.
    self.postMessage({ type: 'error', message: 'the network guard is not in place' });
    return;
  }
  const order = msg.delegate === 'CPU' ? ['CPU'] : ['GPU', 'CPU'];
  let lastErr = null;
  for (const delegate of order) {
    try {
      const canvas = delegate === 'GPU' && typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : undefined;
      landmarker = await createLandmarker({ ...msg, delegate, canvas });
      self.postMessage({ type: 'ready', delegate, initMs: performance.now() - t0 });
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  self.postMessage({ type: 'error', message: String(lastErr?.message || lastErr) });
}

function detect(msg) {
  const { frame, t, id } = msg;
  const width = frame.displayWidth;
  const height = frame.displayHeight;
  const t0 = performance.now();
  let packed = { faces: [], matrices: [] };
  let error = null;
  try {
    packed = packResult(landmarker.detectForVideo(frame, stamp(t)));
  } catch (err) {
    error = String(err?.message || err);
  } finally {
    frame.close();
  }
  const inferMs = performance.now() - t0;
  const transfer = [...packed.faces.map((a) => a.buffer), ...packed.matrices.filter(Boolean).map((a) => a.buffer)];
  self.postMessage({ type: 'result', id, t, inferMs, width, height, error, ...packed }, transfer);
}

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') init(msg);
  else if (msg.type === 'frame') {
    if (!landmarker) { msg.frame.close(); return; }
    detect(msg);
  } else if (msg.type === 'close') {
    landmarker?.close();
    landmarker = null;
    self.close();
  }
};

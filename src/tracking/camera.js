// Webcam access: list cameras, open one, stop it.
//
// The FaceTime HD camera delivers at most 30 fps; Continuity Camera can do 60
// (docs/REFERENCES.md 1.3, 1.4). 1280x720 is a native 16:9 mode on both, and the
// landmark model works on a 256x256 face crop, so a larger frame buys little.

import { guessCameraPreset } from './camera-presets.js';

export class CameraError extends Error {
  /** @param {'denied'|'none'|'busy'|'failed'} kind */
  constructor(kind, message, cause) {
    super(message);
    this.kind = kind;
    this.cause = cause;
  }
}

export async function listCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `Camera ${i + 1}`,
      preset: guessCameraPreset(d.label),
    }));
}

/**
 * Open a camera and start a hidden <video> playing it.
 * @returns {Promise<{stream:MediaStream, track:MediaStreamTrack, video:HTMLVideoElement, settings:MediaTrackSettings, label:string, deviceId:string}>}
 */
export async function openCamera({ deviceId = null, width = 1280, height = 720, frameRate = 60 } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('none', 'This browser cannot use a camera here.');
  }
  const video = {
    width: { ideal: width },
    height: { ideal: height },
    frameRate: { ideal: frameRate },
    resizeMode: 'none',
  };
  if (deviceId) video.deviceId = { exact: deviceId };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
  } catch (err) {
    if (deviceId && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
      // The saved camera is gone (phone walked away): fall back to any camera.
      return openCamera({ width, height, frameRate });
    }
    throw toCameraError(err);
  }
  const track = stream.getVideoTracks()[0];
  const el = document.createElement('video');
  el.muted = true;
  el.playsInline = true;
  el.setAttribute('aria-hidden', 'true');
  // Keep it in the document (some engines stop decoding detached videos), but invisible.
  Object.assign(el.style, {
    position: 'fixed', left: '0', top: '0', width: '2px', height: '2px',
    opacity: '0', pointerEvents: 'none', zIndex: '-1',
  });
  el.srcObject = stream;
  document.body.appendChild(el);
  try {
    await el.play();
  } catch (err) {
    stopCamera({ stream, video: el });
    throw new CameraError('failed', 'The camera started but its picture could not be played.', err);
  }
  if (!el.videoWidth) {
    await new Promise((resolve) => el.addEventListener('loadedmetadata', resolve, { once: true }));
  }
  const settings = track.getSettings();
  return { stream, track, video: el, settings, label: track.label, deviceId: settings.deviceId || deviceId };
}

export function stopCamera(cam) {
  if (!cam) return;
  cam.stream?.getTracks().forEach((t) => t.stop());
  if (cam.video) {
    cam.video.srcObject = null;
    cam.video.remove();
  }
}

function toCameraError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError('denied', 'Camera access was blocked.', err);
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CameraError('none', 'No camera was found.', err);
    case 'NotReadableError':
    case 'AbortError':
      return new CameraError('busy', 'The camera is in use by another app, or macOS blocked it.', err);
    default:
      return new CameraError('failed', err?.message || 'The camera could not be started.', err);
  }
}

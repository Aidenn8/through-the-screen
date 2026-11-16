// Tracking log: 20 seconds of per-frame numbers, saved as JSON for tuning the
// motion offline (`node tools/core-motion.mjs --replay file.json`). Numbers
// only: no camera pictures and no face mesh, just the eye positions the
// tracker solved, what was drawn, timings and the settings in use.

import { displayToWindow } from '../core/display.js';

export const LOG_KIND = 'window-display tracking log';
export const LOG_CONTAINS = 'Saves 20 s of eye positions and timings as a JSON file: numbers only, no pictures, no face mesh.';

const r6 = (v) => (Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null); // metres to the micrometre
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null); // ms
const pt = (p) => (p ? [r6(p.x), r6(p.y), r6(p.z)] : null);

export class TrackingRecorder {
  constructor({ durationMs = 20000 } = {}) {
    this.durationMs = durationMs;
    this.active = false;
    this.t0 = 0;
  }

  /** Seconds left while recording, else null. */
  get state() {
    return this.active ? { secondsLeft: Math.max(0, Math.ceil((this.t0 + this.durationMs - performance.now()) / 1000)) } : null;
  }

  /**
   * @param {object} tracker the running Tracker
   * @param {() => object} snapshot settings and environment at the start
   * @param {() => object} viewport current viewport (for window coordinates)
   */
  start(tracker, snapshot, viewport) {
    this.active = true;
    this.t0 = performance.now();
    this.tracker = tracker;
    this.viewport = viewport;
    const t0 = this.t0;
    this.log = {
      kind: LOG_KIND,
      version: 1,
      contains: LOG_CONTAINS,
      units: 'metres; ms from the start of the recording, on one clock. Display coordinates: origin at the screen centre, x right, y up, z toward the viewer. Window coordinates: the same from the centre of the page.',
      startedAt: new Date().toISOString().slice(0, 10),
      durationMs: this.durationMs,
      ...snapshot(),
      // One per tracking result. t: capture time; ts: when the light hit the
      // sensor (t - camera delay); arrived: when the result came back.
      // cam / disp / win: the solved open eye in camera, display and window
      // coordinates; view: after the view mapping (Look around, Strength,
      // head turn); pose: [yaw, pitch] of the face in degrees (yaw > 0
      // turned to the viewer's right, pitch > 0 tilted up).
      samples: [],
      sampleFields: ['t', 'ts', 'arrived', 'faces', 'mode', 'leftOpen', 'rightOpen', 'cam', 'disp', 'win', 'view', 'rest', 'cameraFps', 'inferMs', 'pose'],
      // One per drawn frame. tShow: when it is seen; eye / win: the rendered
      // viewpoint (display / window); target: Smooth follow's dead-banded
      // target; filtered: the One Euro output; state: tracking, holding, ...
      frames: [],
      frameFields: ['t', 'tShow', 'eye', 'win', 'target', 'filtered', 'state', 'faceVisible'],
    };
    this.off = tracker.onResult((r) => {
      if (!this.active) return;
      const vp = this.viewport();
      this.log.samples.push([
        r2(r.t - t0), r2(r.tSensor - t0), r2(r.arrived - t0), r.faces, r.mode ?? null,
        r.obs ? r.obs.left.open : null, r.obs ? r.obs.right.open : null,
        pt(r.eyeCamera), pt(r.eyeDisplay), r.eyeDisplay && vp ? pt(displayToWindow(r.eyeDisplay, vp)) : null,
        pt(r.eyeView), pt(r.rest), r2(tracker.stats.cameraFps), r2(r.inferMs),
        r.pose ? [r2(r.pose.yaw), r2(r.pose.pitch)] : null,
      ]);
    });
  }

  /** A drawn frame (call every rAF while active). @returns {object|null} the finished log */
  frame(t, tShow, eyeDisplay, eyeWindow) {
    if (!this.active) return null;
    const e = this.tracker.eyes;
    const t0 = this.t0;
    this.log.frames.push([
      r2(t - t0), r2(tShow - t0), pt(eyeDisplay), pt(eyeWindow),
      e.follower?.ready ? pt(e.follower.target) : null, e.anchor ? pt(e.anchor.p) : null, e.state, this.tracker.faceVisible,
    ]);
    if (t - t0 < this.durationMs) return null;
    return this.stop();
  }

  stop() {
    this.active = false;
    this.off?.();
    this.off = null;
    const log = this.log;
    this.log = null;
    return log;
  }
}

/** Hand the log to the browser as a normal download (no window opens). */
export function downloadJson(obj, name) {
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return blob.size;
}

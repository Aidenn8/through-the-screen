// Camera -> landmarks -> eye point in display coordinates -> eye track.
//
// The tracker owns the camera, the landmarker and the EyeTrack. The app asks
// it for the eye position at any time (sample) and reads stats for the HUD.

import { openCamera, stopCamera, CameraError } from './camera.js';
import { Landmarker } from './landmarker.js';
import { unpackFace } from './landmarker-core.js';
import {
  EyeObserver, pickFace, solveEyes, headAxesFromMatrix, headAxesFromLandmarks, eyePoint,
  GazeCompensator, EyeChooser, headAngles,
} from './eye-solve.js';
import { intrinsicsFor } from './camera-presets.js';
import { EyeTrack } from './predictor.js';
import { IpdEstimator } from './ipd.js';
import { cameraToDisplay } from '../core/display.js';
import { Watchdog } from './watchdog.js';
import { sensorTime } from './latency.js';
import { ViewMapper } from './view-map.js';

const ema = (prev, x, k) => (prev === null || !Number.isFinite(prev) ? x : prev + k * (x - prev));

export class Tracker {
  /**
   * @param {object} o
   * @param {() => object} o.getConfig returns { preset, hfovDeg, camPos, eyeMode, phone, ipd, ipdManual, eyeSource }
   * @param {object} [o.landmarker] Landmarker options {mode, delegate, numFaces}
   * @param {object} [o.track] EyeTrack options
   */
  constructor({ getConfig, landmarker = {}, track = {} }) {
    this.getConfig = getConfig;
    this.landmarkerOptions = landmarker;
    this.eyes = new EyeTrack(track);
    // Head motion -> viewpoint (Look around / True window, Strength).
    this.view = new ViewMapper();
    this.viewGlideMs = 600; // a change of view setting glides over this long
    this.observer = new EyeObserver();
    this.ipd = new IpdEstimator();
    this.cam = null;
    this.landmarker = null;
    this.state = 'idle'; // idle | starting | running | paused | error
    this.error = null;
    this.deviceId = null;
    this.prevCentre = null;
    this.last = null; // latest processed result, for the HUD
    this.listeners = new Set();
    this.probe = null; // optional (video) => tag, for test instrumentation
    this.taps = new Set(); // (video, captureTime) => void, every camera frame
    this.chooser = new EyeChooser();
    this.gaze = new GazeCompensator();
    this.lastMode = null;
    this.watchdog = new Watchdog();
    this.muted = false; // the system paused the camera (track muted)
    this.restarting = null; // 'camera' | 'model' while a restart runs
    this.wantPaused = false; // the tab is hidden: no camera, even if a start is under way
    // What the status pill should say beyond tracking itself:
    // { kind: 'restarting'|'recovered'|'muted'|'error'|'failed', what: 'camera'|'model', message, until? }
    this.health = null;
    this.onFailure = null; // (CameraError) => void: tracking stopped for good
    this.startedAt = 0; // when tracking last (re)started (performance.now)
    this.stats = {
      hz: null, inferMs: null, latencyMs: null, framesIn: 0, dropped: 0, results: 0,
      faces: 0, lastResultAt: null, lastFaceAt: null, cameraFps: null, width: 0, height: 0,
      errors: 0, restarts: 0, lastError: null,
    };
    this.#frameCb = this.#onFrame.bind(this);
  }

  #frameCb;
  #lastResultT = null;
  #lastFrameT = null;
  #rafPoll = 0;
  #lastMediaTime = -1;
  #watchTimer = 0;
  #trackListeners = null;

  /** Look at every camera frame as it arrives (cheap work only). Returns an unsubscribe function. */
  tap(fn) {
    this.taps.add(fn);
    return () => this.taps.delete(fn);
  }

  /** Subscribe to processed results. Returns an unsubscribe function. */
  onResult(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get faceVisible() {
    return this.eyes.state === 'tracking';
  }

  /** Open the camera and start tracking. Throws CameraError on failure. */
  async start({ deviceId = null, onCamera = null } = {}) {
    // Trying again after the watchdog gave up: a fresh restart budget.
    if (this.state === 'error') this.watchdog.forgive();
    this.state = 'starting';
    this.error = null;
    try {
      const camP = openCamera({ deviceId }).then((cam) => { onCamera?.(cam); return cam; });
      const lmP = this.landmarker ? Promise.resolve() : this.#initLandmarker();
      const [cam] = await Promise.all([camP, lmP]);
      this.deviceId = cam.deviceId;
      if (this.wantPaused) {
        // Hidden again while the camera was starting: don't leave it on.
        stopCamera(cam);
        this.state = 'paused';
        return cam;
      }
      this.#useCamera(cam);
      this.state = 'running';
      this.health = null;
      this.startedAt = performance.now();
      this.watchdog.reset(this.startedAt);
      this.#startWatch();
      this.#schedule();
      return cam;
    } catch (err) {
      this.state = 'error';
      this.error = err instanceof CameraError ? err : new CameraError('failed', String(err?.message || err), err);
      throw this.error;
    }
  }

  async #initLandmarker() {
    const lm = new Landmarker(this.landmarkerOptions);
    await lm.init();
    lm.onfail = (err) => this.#restartModel(`the face tracking worker stopped (${err.message})`);
    this.landmarker = lm;
  }

  #useCamera(cam) {
    this.cam = cam;
    this.deviceId = cam.deviceId;
    this.stats.width = cam.video.videoWidth;
    this.stats.height = cam.video.videoHeight;
    this.muted = !!cam.track?.muted;
    const track = cam.track;
    if (!track) return;
    const onEnded = () => { if (this.cam === cam) this.#restartCamera('the camera was disconnected or taken by another app'); };
    const onMute = () => {
      if (this.cam !== cam) return;
      this.muted = true;
      this.health = { kind: 'muted', what: 'camera', message: 'The system paused the camera.' };
    };
    const onUnmute = () => {
      if (this.cam !== cam) return;
      this.muted = false;
      if (this.health?.kind === 'muted') this.health = null;
    };
    track.addEventListener('ended', onEnded);
    track.addEventListener('mute', onMute);
    track.addEventListener('unmute', onUnmute);
    this.#trackListeners = { track, onEnded, onMute, onUnmute };
  }

  #startWatch() {
    if (!this.#watchTimer) this.#watchTimer = setInterval(() => this.#watch(), 250);
  }

  #stopWatch() {
    clearInterval(this.#watchTimer);
    this.#watchTimer = 0;
  }

  /** Every 250 ms while running: is anything stuck? */
  #watch() {
    if (this.state !== 'running') return;
    const now = performance.now();
    const hidden = typeof document !== 'undefined' && document.hidden;
    const waiting = this.muted || this.restarting !== null || hidden;
    const r = this.watchdog.check(now, { pendingAge: this.landmarker?.pendingAge(now) ?? 0, waiting });
    if (!r) return;
    if (r.what === 'camera') this.#restartCamera(r.reason);
    else this.#restartModel(r.reason);
  }

  #giveUp(what, reason) {
    console.warn(`Tracking stopped: ${reason}`);
    this.#stopWatch();
    this.#stopCamera();
    // A hung worker keeps burning a core; a retry must start a fresh one.
    this.landmarker?.close({ force: true });
    this.landmarker = null;
    this.eyes.lose(performance.now());
    this.restarting = null;
    this.state = 'error';
    this.error = new CameraError('stopped', what === 'camera'
      ? `The camera stopped and could not be restarted (${reason}).`
      : `Face tracking stopped and could not be restarted (${reason}).`);
    this.health = { kind: 'failed', what, message: this.error.message };
    this.onFailure?.(this.error);
  }

  /** Throw away the face model (worker) and start a new one. */
  async #restartModel(reason) {
    if (this.restarting || this.state !== 'running') return;
    const now = performance.now();
    if (!this.watchdog.allow('model', now)) return this.#giveUp('model', reason);
    console.warn(`Restarting face tracking: ${reason}`);
    this.restarting = 'model';
    this.stats.restarts++;
    this.health = { kind: 'restarting', what: 'model', message: reason };
    const old = this.landmarker;
    this.landmarker = null;
    old?.close({ force: true });
    try {
      await this.#initLandmarker();
    } catch (err) {
      this.restarting = null;
      return this.#giveUp('model', String(err?.message || err));
    }
    this.restarting = null;
    if (this.state !== 'running') return; // paused or stopped meanwhile: keep the new model
    // "Restarted" only once a result proves it (see #handle).
    this.health = { kind: 'restarting', what: 'model', message: reason, awaiting: true };
    this.startedAt = performance.now();
    this.watchdog.reset(performance.now());
  }

  /** Close the camera and open it again (same device). */
  async #restartCamera(reason) {
    if (this.restarting || this.state !== 'running') return;
    const now = performance.now();
    if (!this.watchdog.allow('camera', now)) return this.#giveUp('camera', reason);
    console.warn(`Restarting the camera: ${reason}`);
    this.restarting = 'camera';
    this.stats.restarts++;
    this.health = { kind: 'restarting', what: 'camera', message: reason };
    this.#stopCamera();
    this.eyes.lose(now);
    let cam = null;
    try {
      cam = await openCamera({ deviceId: this.deviceId });
    } catch (err) {
      // Not available yet: the watchdog tries again after its grace period.
      this.restarting = null;
      this.health = { kind: 'restarting', what: 'camera', message: String(err?.message || err) };
      this.watchdog.reset(performance.now());
      return;
    }
    this.restarting = null;
    if (this.state !== 'running') {
      stopCamera(cam);
      return;
    }
    this.#useCamera(cam);
    this.health = { kind: 'restarting', what: 'camera', message: reason, awaiting: true };
    this.startedAt = performance.now();
    this.watchdog.reset(performance.now());
    this.#schedule();
  }

  get landmarkerInfo() {
    return this.landmarker ? this.landmarker.info() : null;
  }

  /** Switch cameras without restarting the landmarker. */
  async switchCamera(deviceId) {
    this.#stopCamera();
    this.eyes.lose(performance.now());
    this.view.reset();
    this.observer.reset();
    this.gaze.reset();
    this.chooser.reset();
    return this.start({ deviceId });
  }

  /** Tab hidden: release the camera (its light goes off). */
  pause() {
    this.wantPaused = true;
    if (this.state !== 'running') return; // a start under way checks wantPaused
    this.#stopCamera();
    this.eyes.lose(performance.now());
    this.state = 'paused';
  }

  async resume() {
    this.wantPaused = false;
    if (this.state !== 'paused') return;
    try {
      await this.start({ deviceId: this.deviceId });
    } catch {
      // state/error already set by start()
    }
  }

  stop() {
    this.#stopWatch();
    this.#stopCamera();
    this.landmarker?.close();
    this.landmarker = null;
    this.state = 'idle';
  }

  #stopCamera() {
    cancelAnimationFrame(this.#rafPoll);
    const l = this.#trackListeners;
    if (l) {
      l.track.removeEventListener('ended', l.onEnded);
      l.track.removeEventListener('mute', l.onMute);
      l.track.removeEventListener('unmute', l.onUnmute);
      this.#trackListeners = null;
    }
    stopCamera(this.cam);
    this.cam = null;
    this.muted = false;
  }

  /** Eye position (display coords, metres) for a frame seen at time t (ms). */
  sample(t) {
    // The filter never passes its targets in Smooth follow, but prediction can.
    return this.view.clamp(this.eyes.sample(t));
  }

  /** Re-centre the view on where the viewer sits now (at the next sample). */
  recentre() {
    this.view.requestRecentre();
  }

  #schedule() {
    const v = this.cam?.video;
    if (!v) return;
    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
      v.requestVideoFrameCallback(this.#frameCb);
    } else {
      // Fallback: poll for new frames once per display frame.
      const poll = (now) => {
        if (!this.cam || this.cam.video !== v) return;
        if (v.currentTime !== this.#lastMediaTime) {
          this.#lastMediaTime = v.currentTime;
          this.#onFrame(now, {});
        } else {
          this.#rafPoll = requestAnimationFrame(poll);
        }
      };
      this.#rafPoll = requestAnimationFrame(poll);
    }
  }

  #onFrame(now, meta) {
    const cam = this.cam;
    if (!cam || this.state !== 'running') return;
    // Whatever happens below, ask for the next frame: one exception must
    // never end tracking for good.
    try {
      this.#takeFrame(cam, now, meta);
    } catch (err) {
      this.#frameError(err);
    } finally {
      if (this.cam === cam && this.state === 'running') this.#schedule();
    }
  }

  #takeFrame(cam, now, meta) {
    this.stats.framesIn++;
    // Capture time on the performance.now() clock when the browser knows it.
    const nowMs = performance.now();
    this.watchdog.frame(nowMs);
    let tCap = meta.captureTime;
    if (!(tCap > nowMs - 1000 && tCap <= nowMs + 1)) tCap = meta.receiveTime > nowMs - 1000 ? meta.receiveTime : now;
    if (this.#lastFrameT !== null) {
      const dt = tCap - this.#lastFrameT;
      if (dt > 0 && dt < 500) this.stats.cameraFps = ema(this.stats.cameraFps, 1000 / dt, 0.1);
    }
    this.#lastFrameT = tCap;
    for (const fn of this.taps) fn(cam.video, tCap);
    const lm = this.landmarker;
    if (!lm || lm.busy) {
      // Never queue: an old frame is worth less than the next one. (No model
      // while it restarts.)
      this.stats.dropped++;
      return;
    }
    const tag = this.probe ? this.probe(cam.video, tCap) : null;
    lm.detect(cam.video, tCap).then((res) => {
      if (res.closed || lm !== this.landmarker) return;
      this.#handle(res, tCap, tag);
    }).catch((err) => this.#frameError(err));
  }

  #frameError(err) {
    const msg = String(err?.message || err);
    this.stats.errors++;
    this.stats.lastError = msg;
    this.watchdog.result(performance.now(), msg);
  }

  #handle(res, tCap, tag) {
    const now = performance.now();
    const s = this.stats;
    s.results++;
    this.watchdog.result(now, res.error || null);
    if (res.error) {
      s.errors++;
      s.lastError = res.error;
      if (!this.health) this.health = { kind: 'error', what: 'model', message: res.error };
    } else if (this.health?.kind === 'error') {
      this.health = null;
    } else if (this.health?.awaiting) {
      this.health = { kind: 'recovered', what: this.health.what, message: this.health.message, until: now + 3000 };
    }
    s.inferMs = ema(s.inferMs, res.inferMs, 0.1);
    s.latencyMs = ema(s.latencyMs, now - tCap, 0.1);
    if (this.#lastResultT !== null) {
      const dt = tCap - this.#lastResultT;
      if (dt > 0 && dt < 500) s.hz = ema(s.hz, 1000 / dt, 0.1);
    }
    this.#lastResultT = tCap;
    s.lastResultAt = now;
    s.faces = res.faces.length;
    if (this.state !== 'running') return;

    const cfg = this.getConfig();
    const W = res.width;
    const H = res.height;
    let out = { t: tCap, arrived: now, tag, faces: res.faces.length, width: W, height: H, inferMs: res.inferMs };
    // Samples are stamped with when the light hit the sensor, as best we know;
    // misses too, so a gap is measured on one clock.
    const tSensor = sensorTime(tCap, cfg.cameraDelayMs);
    out.tSensor = tSensor;
    if (!res.faces.length) {
      this.eyes.miss(tSensor);
      this.prevCentre = null;
      this.last = out;
      this.#emit(out);
      return;
    }
    let faces = res.faces.map(unpackFace);
    if (cfg.preset?.mirrored) faces = faces.map((lm) => lm.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z })));
    const pick = pickFace(faces, W, H, this.prevCentre);
    this.prevCentre = pick.centre;
    const lm = faces[pick.index];
    const mat = cfg.preset?.mirrored ? null : res.matrices[pick.index];
    const intr = intrinsicsFor(W, H, cfg.hfovDeg, cfg.preset?.nativeAspect || 16 / 9);
    this.observer.source = cfg.eyeSource || 'stable';
    const obs = this.observer.observe(lm, W, H, tCap / 1000);
    const axes = mat ? headAxesFromMatrix(mat) : headAxesFromLandmarks(lm, W, H, intr);
    const ipdUsed = this.ipd.fused(cfg.ipd, cfg.ipdManual);
    const solved = solveEyes(obs, intr, axes, ipdUsed);
    this.ipd.add(solved, ipdUsed);
    let sol = solved;
    if (this.observer.source === 'stable' && cfg.gazeCompensation) {
      // The viewer looks at the screen: keep the averaged pupil on the real
      // one when the head turns (GazeCompensator). Screen centre in camera
      // coordinates is the camera position, mirrored.
      const target = { x: cfg.camPos.x, y: cfg.camPos.y, z: -cfg.camPos.z };
      const e = this.gaze.apply(solved, target, { left: obs.left.open, right: obs.right.open }, tCap / 1000);
      sol = { ...solved, right: e.right, left: e.left, centre: { x: (e.right.x + e.left.x) / 2, y: (e.right.y + e.left.y) / 2, z: (e.right.z + e.left.z) / 2 } };
    }
    const mode = this.chooser.choose(cfg, obs, tCap);
    const pCam = eyePoint(sol, mode, cfg.phone);
    const pDisp = cameraToDisplay(pCam, cfg.camPos);
    out = {
      ...out, landmarks: lm, pick: pick.index, obs, sol, intr, ipdUsed, eyeCamera: pCam, eyeDisplay: pDisp, mode,
      eyesDisplay: { left: cameraToDisplay(sol.left, cfg.camPos), right: cameraToDisplay(sol.right, cfg.camPos) },
    };
    if (!(pDisp.z > 0.12 && pDisp.z < 3) || !Number.isFinite(pDisp.x) || !Number.isFinite(pDisp.y)) {
      // A solve this far off (or not a number) is a bad detection, not a viewer.
      this.eyes.miss(tSensor);
    } else {
      const view = cfg.view || { direction: 'window', strength: 1 };
      // The head's pose (where the face points) steers Look around when head
      // turn is on; the tracked eye's offset from the head's midline tells
      // how far a turn moves it (src/tracking/head-turn.js).
      const pose = headAngles(sol.axes);
      const lat = mode === 'right' ? ipdUsed / 2 : mode === 'left' ? -ipdUsed / 2 : 0;
      if (this.lastMode && this.lastMode !== mode) {
        // Switching eyes (or one eye <-> both): move the track by exactly the
        // distance between the two points in this frame (and the change of
        // the head turn's part, which depends on the eye), then glide. The
        // viewer did not move, so neither does their rest point.
        const before = cameraToDisplay(eyePoint(sol, this.lastMode, cfg.phone), cfg.camPos);
        const d = { x: pDisp.x - before.x, y: pDisp.y - before.y, z: pDisp.z - before.z };
        const sw = this.view.switchEye(d, lat, view);
        this.eyes.shift(sw.shift, 280, sw.offset);
      }
      // Head motion -> viewpoint. A new view setting or a re-centre moves
      // the mapped point: glide the track across, like an eye switch.
      const m = this.view.step(tSensor, pDisp, view, pose, lat);
      if (m.shift) this.eyes.shift(m.shift, this.viewGlideMs, m.offset);
      this.eyes.setGain(m.gain);
      const pView = m.p;
      if (Number.isFinite(pView.x) && Number.isFinite(pView.y) && Number.isFinite(pView.z)) this.eyes.push(tSensor, pView, { offset: m.offset });
      else this.eyes.miss(tSensor);
      out.pose = pose;
      out.eyeView = pView;
      out.rest = this.view.rest ? { ...this.view.rest } : null;
      this.lastMode = mode;
      s.lastFaceAt = now;
    }
    this.last = out;
    this.#emit(out);
  }

  #emit(out) {
    for (const fn of this.listeners) fn(out);
  }
}

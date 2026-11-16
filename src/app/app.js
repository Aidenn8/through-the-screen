// The app: renderer and loop, eye source (camera or mouse), scenes, interface.

import * as THREE from 'three';
import { applyWindowCamera } from '../core/projection.js';
import {
  displaySize, readScreenInfo, viewportOnDisplay, displayToWindow, cameraPosition,
  cardCssWidth, sizeFromCard, screenMatchesPreset, panelPixelRatio,
} from '../core/display.js';
import { Tracker } from '../tracking/tracker.js';
import { STRENGTH } from '../tracking/view-map.js';
import { listCameras } from '../tracking/camera.js';
import { CAMERA_PRESETS, guessCameraPreset, deliveredHfov } from '../tracking/camera-presets.js';
import { MouseEye } from './mouse-eye.js';
import { SceneHost, discoverScenes } from './scenes.js';
import { createSteadyScene } from './steady-scene.js';
import { loadSettings, saveSettings, resetSettings, motionOptions } from './settings.js';
import { IntroCard } from './ui-intro.js';
import { Dock } from './ui-dock.js';
import { SettingsSheet } from './ui-settings.js';
import { SteadyPanel, CardCalibration } from './ui-panels.js';
import { Hud } from './hud.js';
import { TrackingRecorder, downloadJson } from './recorder.js';
import { ResolutionGovernor } from './resolution.js';
import { RecentSamples, fovFromDistance, DISTANCE_CM } from './calibration.js';
import { DelayCheck } from './ui-delay.js';
import { estimateDelay } from '../tracking/latency.js';
import { MsaaPass } from './msaa.js';

const IDLE_MS = 2500;

export class App {
  constructor({ canvas, uiRoot, params = new URLSearchParams() }) {
    this.canvas = canvas;
    this.params = params;
    this.settings = loadSettings();
    if (params.has('reset')) this.settings = resetSettings();
    this.input = 'mouse';
    this.tracker = null;
    this.mouse = new MouseEye();
    this.cameras = [];
    this.scenes = [];
    this.steady = { open: false, step: 0, view: 'rings', inst: null };
    // Depth of the tracked eye over the last second: the steady check's
    // readout and its distance measurement use exactly this.
    this.eyeZ = new RecentSamples(1000);
    this.tipDismissed = false;
    this.lastActivity = performance.now();
    this.frameTimes = new Float32Array(240);
    this.frameCount = 0;
    this.ticks = 0;
    this.fps = 60;
    this.vsync = 16.67;
    this.lastT = null;
    this.fixedDpr = Number(params.get('dpr')) || null;
    this.maxDpr = this.fixedDpr || Infinity;
    // Adaptive resolution: a smooth 60 fps and full-rate tracking matter more
    // to the illusion than pixels (src/app/resolution.js).
    this.governor = new ResolutionGovernor();
    this.resolutionWhy = null;
    this.panelCap = Infinity;
    this.perf = { deltas: [], work: [], stalls: [] };
    this.fadeEl = typeof document !== 'undefined' ? document.getElementById('fade') : null;
    this.hidden = true; // the fade is covering the scene (frames don't count)
    this.sceneToken = null;
    this.eyeVec = new THREE.Vector3(0, 0, 0.6);
    this.camera3 = new THREE.PerspectiveCamera();
    this.#initRenderer();
    this.#initUi(uiRoot);
    this.#initInput();
    this.frame = this.frame.bind(this);
  }

  // ---------------------------------------------------------------- setup

  #initRenderer() {
    // No canvas MSAA: scenes multisample their own targets; the app's own
    // scenes go through MsaaPass.
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxDpr));
    r.setSize(window.innerWidth, window.innerHeight, false);
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = r;
    this.msaa = new MsaaPass(THREE, r);
    this.host = new SceneHost(r, { draw: (scene, camera) => this.msaa.render(scene, camera) });
    this.canvasSize = [window.innerWidth, window.innerHeight, r.getPixelRatio()];
    // The browser can take the graphics away (a GPU reset, memory pressure).
    // Say so plainly, and when they come back build the scene again: what it
    // drew into textures (baked light, shadow and haze maps) is gone.
    this.contextLost = false;
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault(); // lets the browser restore the context
      this.contextLost = true;
      this.#notice('The graphics stopped. The view comes back by itself when the browser restores them; if it stays dark, reload the page.');
      console.warn('WebGL context lost.');
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.#notice(null);
      this.msaa.release();
      console.info('WebGL context restored: building the scene again.');
      const id = this.host.current?.id || this.settings.scene;
      if (id && this.scenes.length) this.loadScene(id, { save: false });
    });
  }

  /** A message in the middle of the screen, or none. */
  #notice(text) {
    const el = typeof document !== 'undefined' ? document.getElementById('notice') : null;
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || '';
  }

  #initUi(root) {
    this.intro = new IntroCard(root, {
      onCamera: () => this.useCamera(),
      onMouse: () => this.useMouse(),
      onEye: (eye) => this.change({ eye, eyeMode: 'one' }),
      onFullscreen: () => this.toggleFullscreen(),
    });
    this.dock = new Dock(root, {
      onScene: (id) => this.loadScene(id),
      onSteady: () => this.setSteady(!this.steady.open),
      onSettings: () => this.setSettingsOpen(!this.sheet.open),
      onFullscreen: () => this.toggleFullscreen(),
      onDismissTip: () => { this.tipDismissed = true; this.dock.showTip(false); },
    });
    this.sheet = new SettingsSheet(root, {
      onChange: (patch) => this.change(patch),
      onRecentre: () => this.recentre(),
      onCamera: (id) => this.switchCamera(id),
      onCard: () => this.openCard(),
      onDelay: () => this.openDelayCheck(),
      onSteady: () => { this.setSettingsOpen(false); this.setSteady(true); },
      onReset: () => this.reset(),
      onClose: () => this.setSettingsOpen(false),
    });
    this.steadyPanel = new SteadyPanel(root, {
      onStep: (i, st) => {
        this.steady.step = i;
        this.steady.view = st.view;
        this.steady.inst?.setView(st.view);
        this.#refreshSteady();
      },
      onIpd: (v) => this.change({ ipdMm: v, ipdManual: true }),
      onCameraHeight: (v) => this.change({ cameraTrimMm: { ...this.settings.cameraTrimMm, y: v } }),
      onMeasure: (d) => this.calibrateDistance(d),
      onDone: () => this.setSteady(false),
    });
    this.card = new CardCalibration(root, {
      onSave: (w) => {
        const custom = sizeFromCard(w, readScreenInfo(window));
        this.card.hide();
        this.change({ display: 'custom', customDisplay: custom });
      },
      onCancel: () => this.card.hide(),
      describe: (w) => {
        const m = sizeFromCard(w, readScreenInfo(window));
        const inches = Math.hypot(m.widthMm, m.heightMm) / 25.4;
        return `${m.widthMm.toFixed(0)} × ${m.heightMm.toFixed(0)} mm, ${inches.toFixed(1)} inch`;
      },
    });
    this.delayCheck = new DelayCheck(root, {
      onStart: () => this.measureDelay(),
      onClose: () => this.delayCheck.hide(),
    });
    this.hud = new Hud(root, { onRecord: () => this.recordLog() });
    this.hud.setOpen(this.settings.hud);
  }

  #initInput() {
    const activity = () => {
      this.lastActivity = performance.now();
      if (document.body.classList.contains('idle')) document.body.classList.remove('idle');
    };
    window.addEventListener('pointermove', (e) => {
      activity();
      if (this.vp) this.mouse.point(e.clientX, e.clientY, this.vp);
    }, { passive: true });
    window.addEventListener('pointerdown', activity, { passive: true });
    document.documentElement.addEventListener('pointerleave', () => this.mouse.leave());
    window.addEventListener('keydown', (e) => { activity(); this.#onKey(e); });
    document.addEventListener('fullscreenchange', () => {
      // The intro's first step ticks itself off.
      if (this.intro.open && this.intro.isIntro) this.intro.showIntro(this.settings.eye, { fullscreen: !!document.fullscreenElement });
      this.#refreshPanels();
    });
    document.addEventListener('visibilitychange', () => {
      if (!this.tracker) return;
      if (document.hidden) this.tracker.pause();
      else this.tracker.resume().then(() => this.#refreshPanels());
    });
    navigator.mediaDevices?.addEventListener?.('devicechange', () => this.#refreshCameras());
    document.addEventListener('click', (e) => {
      if (!this.dock.menu.hidden && !this.dock.menu.contains(e.target) && e.target !== this.dock.sceneBtn) this.dock.closeMenu();
    });
  }

  #onKey(e) {
    const tag = e.target?.tagName;
    const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
    if (e.key === 'Escape') {
      if (!this.dock.menu.hidden) { this.dock.closeMenu(); this.dock.sceneBtn.focus(); return; }
      if (this.card.open) return this.card.hide();
      if (this.delayCheck.open) return this.delayCheck.hide();
      if (this.sheet.open) return this.setSettingsOpen(false);
      if (this.steady.open) return this.setSteady(false);
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey || this.card.open || this.delayCheck.open) return;
    if (e.key.toLowerCase() === 'f') { // works on the intro card too (its first step)
      this.toggleFullscreen();
      e.preventDefault();
      return;
    }
    if (this.intro.open) return;
    const k = e.key.toLowerCase();
    if (k === 'f') this.toggleFullscreen();
    else if (k === 'd') this.change({ hud: !this.settings.hud });
    else if (k === 'v') this.toggleDirection();
    else if (k === 'r') this.recentre();
    else if (k === 's') this.setSettingsOpen(!this.sheet.open);
    else if (k === 'c') this.setSteady(!this.steady.open);
    else if (k === '[' || k === ']') this.#stepScene(k === ']' ? 1 : -1);
    else if (/^[1-9]$/.test(k) && this.scenes[Number(k) - 1]) this.loadScene(this.scenes[Number(k) - 1].id);
    else return;
    e.preventDefault();
  }

  // ---------------------------------------------------------------- start

  async start() {
    this.size = this.#displaySize();
    this.vp = viewportOnDisplay(readScreenInfo(window), this.size);
    this.scenes = await discoverScenes({ includePlaceholder: this.params.get('scene') === 'test-room' });
    const want = this.params.get('scene') || this.settings.scene;
    const first = this.scenes.find((s) => s.id === want) || this.scenes[0];
    await this.loadScene(first.id, { save: false });
    this.#applyMotionSettings();
    requestAnimationFrame(this.frame);

    const auto = this.params.get('autostart');
    if (auto === 'camera') return this.useCamera();
    if (auto === 'mouse') return this.useMouse();
    // Returning viewers who already allowed the camera go straight in.
    let permission = 'prompt';
    try {
      permission = (await navigator.permissions.query({ name: 'camera' })).state;
    } catch {
      // Not supported: ask through the intro.
    }
    if (this.settings.inputMode === 'camera' && permission === 'granted') return this.useCamera();
    this.intro.showIntro(this.settings.eye, { fullscreen: !!document.fullscreenElement });
    this.#refreshPanels();
  }

  async useCamera() {
    this.intro.showRequesting();
    let permission = 'prompt';
    try {
      permission = (await navigator.permissions.query({ name: 'camera' })).state;
    } catch { /* ignore */ }
    if (permission === 'granted') this.intro.showStarting();
    if (!this.tracker) {
      const mode = this.params.get('tracker') || 'worker';
      const delegate = (this.params.get('delegate') || 'CPU').toUpperCase();
      const numFaces = Number(this.params.get('faces')) || 2;
      this.tracker = new Tracker({ getConfig: () => this.trackerConfig(), landmarker: { mode, delegate, numFaces } });
      this.tracker.onResult((r) => { if (r.eyeDisplay) this.eyeZ.add(performance.now(), r.eyeDisplay.z); });
      if (this.settings.ipdIrisMm) this.tracker.ipd.seed(this.settings.ipdIrisMm / 1000);
      this.tracker.onFailure = (err) => {
        // The watchdog gave up: say so, follow the mouse, offer a retry.
        this.input = 'mouse';
        this.intro.showProblem('stopped', err.message);
        this.#refreshPanels();
      };
      this.#applyMotionSettings();
    }
    try {
      await this.tracker.start({ deviceId: this.settings.cameraId, onCamera: () => this.intro.showStarting() });
      this.input = 'camera';
      this.change({ inputMode: 'camera', started: true, cameraId: this.tracker.deviceId }, { quiet: true });
      await this.#refreshCameras();
      const s = this.settings;
      if (!s.ipdManual && !s.ipdIrisMm && s.eyeMode !== 'both') await this.#measureEyeSpacing();
      this.intro.hide();
    } catch (err) {
      console.warn('Camera unavailable:', err);
      this.input = 'mouse';
      this.intro.showProblem(err.kind || 'failed', err.kind === 'failed' ? err.message : '');
    }
    this.#refreshPanels();
  }

  /**
   * First run: eye spacing comes from the size of the irises, which needs both
   * eyes open (one-eye viewing never shows both). Ask for a moment with both
   * open before the viewer closes one, and keep the result for next time.
   */
  async #measureEyeSpacing() {
    const tr = this.tracker;
    const want = 60; // two seconds of frames
    let skipped = false;
    const card = this.intro.showMeasuring({ onSkip: () => { skipped = true; } });
    const t0 = performance.now();
    while (!skipped && tr.state === 'running' && performance.now() - t0 < 8000 && tr.ipd.samples.length < want) {
      card.setProgress(tr.ipd.samples.length / want);
      card.setLooking(!tr.faceVisible);
      await new Promise((r) => setTimeout(r, 100));
    }
    const m = tr.ipd.measured;
    if (m && tr.ipd.samples.length >= 30) this.change({ ipdIrisMm: Math.round(m * 10000) / 10 }, { quiet: true });
  }

  useMouse() {
    this.input = 'mouse';
    this.tracker?.stop();
    this.tracker = null;
    this.intro.hide();
    this.change({ inputMode: 'mouse', started: true }, { quiet: true });
    this.#refreshPanels();
  }

  async switchCamera(deviceId) {
    if (!this.tracker || !deviceId) return;
    this.change({ cameraId: deviceId, cameraPreset: null }, { quiet: true });
    try {
      await this.tracker.switchCamera(deviceId);
      this.input = 'camera';
    } catch (err) {
      this.input = 'mouse';
      this.intro.showProblem(err.kind || 'failed', err.message);
    }
    this.#refreshPanels();
  }

  async #refreshCameras() {
    try {
      this.cameras = await listCameras();
    } catch {
      this.cameras = [];
    }
    this.#refreshPanels();
  }

  // ---------------------------------------------------------------- settings

  presetId() {
    if (this.settings.cameraPreset && CAMERA_PRESETS[this.settings.cameraPreset]) return this.settings.cameraPreset;
    const label = this.tracker?.cam?.label || this.cameras.find((c) => c.deviceId === this.settings.cameraId)?.label || '';
    return label ? guessCameraPreset(label) : 'builtin-notch';
  }

  hfov() {
    const id = this.presetId();
    return this.settings.fovOverride[id] ?? CAMERA_PRESETS[id].hfovDeg;
  }

  trackerConfig() {
    const s = this.settings;
    const preset = CAMERA_PRESETS[this.presetId()];
    let eyeMode = s.eyeMode;
    if (this.steady.open && eyeMode === 'both') eyeMode = 'one';
    return {
      preset,
      hfovDeg: this.hfov(),
      camPos: cameraPosition(this.size, preset.mount, s.cameraTrimMm),
      eyeMode,
      eye: s.eye,
      autoEye: s.autoEye,
      phone: s.phone,
      ipd: s.ipdMm / 1000,
      ipdManual: s.ipdManual,
      eyeSource: s.eyeSource,
      gazeCompensation: s.gazeCompensation,
      cameraDelayMs: this.cameraDelay(),
      view: this.viewSetting(),
    };
  }

  /**
   * How head motion moves the viewpoint right now. The steady check and the
   * phone lens need the exact window: the cross must sit on the eye's
   * reflection, and the phone films what the lens itself would see. Look
   * around carries head turn ({ on, strength }), off in the True window.
   */
  viewSetting() {
    const s = this.settings;
    if (this.steady.open || s.eyeMode === 'phone') return { direction: 'window', strength: 1 };
    const direction = s.viewDirection === 'window' ? 'window' : 'look';
    const g = s.strength[direction];
    const view = { direction, strength: Number.isFinite(g) ? Math.min(STRENGTH.max, Math.max(STRENGTH.min, g)) : STRENGTH[direction] };
    // Head turn steers Look around only; True window ignores the head's pose.
    if (direction === 'look') view.turn = { on: s.turnSteer !== false, strength: s.turnStrength };
    return view;
  }

  /** V: switch between Look around and True window, and say which is on. */
  toggleDirection() {
    const next = this.settings.viewDirection === 'look' ? 'window' : 'look';
    this.change({ viewDirection: next });
    this.#flash(next === 'look' ? 'Look around: the view turns the way you lean' : 'True window: the scene stays put behind the glass');
  }

  /** R: the viewer's current position becomes the centre. */
  recentre() {
    if (this.input !== 'camera' || !this.tracker) return;
    this.tracker.recentre();
    this.#flash('Centred on where you sit now');
  }

  /**
   * Record 20 s of tracking numbers and download them as JSON (details
   * panel). Numbers only; see src/app/recorder.js.
   */
  recordLog() {
    if (this.recorder?.active) return;
    if (this.input !== 'camera' || this.tracker?.state !== 'running') {
      this.#flash('Turn the camera on first: choose Use camera');
      return;
    }
    this.recorder = this.recorder || new TrackingRecorder();
    const s = this.settings;
    const tr = this.tracker;
    this.recorder.start(tr, () => ({
      settings: {
        motionMode: s.motionMode, smoothness: s.smoothness, smoothing: s.smoothing, prediction: s.prediction,
        motion: motionOptions(s), view: this.viewSetting(), viewDirection: s.viewDirection, strength: s.strength,
        turnSteer: s.turnSteer, turnStrength: s.turnStrength,
        eyeMode: s.eyeMode, eye: s.eye, autoEye: s.autoEye, eyeSource: s.eyeSource, gazeCompensation: s.gazeCompensation,
        cameraDelayMs: this.cameraDelay(), cameraDelayMeasured: s.cameraDelays[this.presetId()] !== undefined,
        display: s.display, cameraPreset: this.presetId(), hfovDeg: this.hfov(), ipdMm: s.ipdMm, ipdManual: s.ipdManual,
      },
      camera: { width: tr.stats.width, height: tr.stats.height, fps: tr.stats.cameraFps, trackingHz: tr.stats.hz, latencyMs: tr.stats.latencyMs },
      camPos: this.trackerConfig().camPos,
      viewport: { width: this.vp.width, height: this.vp.height, centre: this.vp.centre, fullscreen: this.vp.fullscreen },
      renderFps: this.fps,
    }), () => this.vp);
    this.#flash('Recording 20 s of tracking numbers', 1500);
  }

  #finishLog(log) {
    const d = new Date();
    const n2 = (v) => String(v).padStart(2, '0');
    const stamp = `${d.getFullYear()}${n2(d.getMonth() + 1)}${n2(d.getDate())}-${n2(d.getHours())}${n2(d.getMinutes())}${n2(d.getSeconds())}`;
    const bytes = downloadJson(log, `window-tracking-${stamp}.json`);
    this.#flash(`Tracking log saved to Downloads (${Math.round(bytes / 1024)} KB)`, 4000);
  }

  /** A short message in the status pill. */
  #flash(text, ms = 2500) {
    this.flashMsg = { text, until: performance.now() + ms };
  }

  /** Hidden camera delay (ms): measured for this camera, else the estimate. */
  cameraDelay() {
    return this.settings.cameraDelays[this.presetId()] ?? this.settings.cameraDelayMs;
  }

  openDelayCheck() {
    this.setSettingsOpen(false);
    if (this.input !== 'camera' || this.tracker?.state !== 'running') {
      this.delayCheck.showResult('Turn the camera on first: choose Use camera.');
      return;
    }
    this.delayCheck.showIntro();
  }

  /**
   * Flash the screen and time the camera's view of it (src/tracking/latency.js).
   * @returns {Promise<object|null>} the estimate, saved for this camera if good
   */
  async measureDelay({ flashes = 8 } = {}) {
    const tr = this.tracker;
    if (this.input !== 'camera' || tr?.state !== 'running') return null;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const onFrame = (fn) => new Promise((r) => requestAnimationFrame((t) => { fn(); r(t); }));
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 18;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const frames = [];
    const off = tr.tap((video, t) => {
      ctx.drawImage(video, 0, 0, c.width, c.height);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      frames.push({ t, lum: sum / (c.width * c.height) });
    });
    const runs = [];
    try {
      this.delayCheck.dark();
      await sleep(1500); // let auto exposure settle on the dark screen
      for (let k = 0; k < flashes; k++) {
        await sleep(500 + 500 * Math.random()); // random phase against the camera's frames
        const tOn = await onFrame(() => this.delayCheck.set(true));
        await sleep(350);
        await onFrame(() => this.delayCheck.set(false));
        runs.push({ tOn });
      }
      await sleep(300);
    } finally {
      off();
    }
    for (const r of runs) r.frames = frames.filter((f) => f.t > r.tOn - 350 && f.t < r.tOn + 450);
    const est = estimateDelay(runs, { displayMs: 1.5 * this.vsync + 5 });
    let text;
    if (!est || est.weak) {
      text = 'The flashes barely showed in the camera picture. Dim the room, face the screen and try again.';
    } else if (!(est.delayMs > -5 && est.delayMs < 250)) {
      text = `That gave ${est.delayMs.toFixed(0)} ms, which is not plausible. Keep still and try again.`;
    } else {
      const ms = Math.max(0, Math.round(est.delayMs));
      this.change({ cameraDelays: { ...this.settings.cameraDelays, [this.presetId()]: ms } });
      text = `${ms} ms (from ${est.n} flashes, ±${Math.round(est.spreadMs)} ms). Saved for this camera.`;
    }
    this.delayCheck.showResult(text);
    return est;
  }

  change(patch, { quiet = false } = {}) {
    const s = this.settings;
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'phone') s.phone = { ...s.phone, ...v };
      else s[k] = v;
    }
    saveSettings(s);
    if ('display' in patch || 'customDisplay' in patch) this.size = this.#displaySize();
    if (['smoothing', 'prediction', 'smoothness', 'motionMode'].some((k) => k in patch)) this.#applyMotionSettings();
    if ('hud' in patch) this.hud.setOpen(s.hud);
    if ('ipdManual' in patch && !patch.ipdManual) this.tracker?.ipd.reset();
    if ('gazeCompensation' in patch) this.tracker?.gaze.reset();
    if (!quiet) this.#refreshPanels();
  }

  #applyMotionSettings() {
    this.tracker?.eyes.configure(motionOptions(this.settings));
  }

  reset() {
    const keep = { inputMode: this.settings.inputMode, started: this.settings.started, cameraId: this.settings.cameraId };
    this.settings = { ...resetSettings(), ...keep };
    saveSettings(this.settings);
    this.size = this.#displaySize();
    this.tracker?.ipd.reset();
    this.#applyMotionSettings();
    this.hud.setOpen(false);
    this.#refreshPanels();
  }

  #displaySize() {
    const s = this.settings;
    if (s.display === 'custom' && s.customDisplay) return displaySize('custom', s.customDisplay);
    try {
      return displaySize(s.display === 'custom' ? 'mba15-m2' : s.display);
    } catch {
      return displaySize('mba15-m2');
    }
  }

  // ---------------------------------------------------------------- panels

  setSettingsOpen(on) {
    if (on) this.dock.closeMenu();
    this.sheet.setOpen(on);
    this.dock.setPressed('settings', on);
    if (on) this.#refreshPanels();
    else this.dock.settingsBtn.focus({ preventScroll: true });
  }

  setSteady(on) {
    if (on === this.steady.open) return;
    this.steady.open = on;
    if (on) {
      this.setSettingsOpen(false);
      if (!this.steady.inst) this.steady.inst = createSteadyScene(THREE, { width: this.vp.width, height: this.vp.height });
    } else {
      // Give back its markers and the multisampled target (about 300 MB);
      // both are made again when the check reopens.
      this.steady.inst?.dispose();
      this.steady.inst = null;
      this.msaa.release();
    }
    this.steadyPanel.setOpen(on);
    this.dock.setPressed('steady', on);
    this.#refreshPanels();
  }

  /**
   * The viewer holds the open eye at a measured distance from the glass.
   * Depth scales with the focal length while sideways position does not, so
   * the ratio of true to estimated distance corrects the field of view. The
   * estimate is the eye's depth averaged over a fresh second (one frame can be
   * centimetres off), the same quantity the readout shows.
   * @returns {Promise<string>} what happened, in plain words
   */
  async calibrateDistance(dTrue) {
    const tr = this.tracker;
    if (this.input !== 'camera' || !tr?.faceVisible) return 'The camera needs to see your face first.';
    if (!(dTrue * 100 >= DISTANCE_CM.min && dTrue * 100 <= DISTANCE_CM.max)) {
      return `Enter a distance between ${DISTANCE_CM.min} and ${DISTANCE_CM.max} cm.`;
    }
    this.eyeZ.clear();
    await new Promise((r) => setTimeout(r, 1050));
    const m = this.eyeZ.mean(performance.now());
    if (m.n < 10) return 'The camera lost your face. Hold still and try again.';
    // Depth noise is under 1 cm even far away; more spread means the head moved.
    if (m.std > 0.015) return 'You moved during the measurement. Hold still and press Measure again.';
    const old = this.hfov();
    const hfov = fovFromDistance(old, dTrue, m.mean);
    if (!(hfov > 40 && hfov < 110)) return `That would mean a ${hfov.toFixed(0)}° camera, which is unlikely. Check the distance.`;
    this.change({ fovOverride: { ...this.settings.fovOverride, [this.presetId()]: Math.round(hfov * 10) / 10 } });
    return `Done. The camera sees ${hfov.toFixed(1)}° across (it was set to ${old.toFixed(1)}°).`;
  }

  openCard() {
    this.setSettingsOpen(false);
    const info = readScreenInfo(window);
    this.card.show(cardCssWidth(this.size, info));
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
  }

  /**
   * Switch scenes through black. The current scene keeps drawing while it
   * fades out; the next one is built behind the black (building compiles
   * shaders and can stall the main thread for most of a second, which must
   * never show as a frozen picture); it fades in once it has drawn and the
   * tracker has caught up after the stall. (Scenes set shared renderer state
   * in create() and restore it in dispose(), so the old one cannot keep
   * drawing while the new one is built: docs/CORE_NOTES.md.)
   */
  async loadScene(id, { save = true } = {}) {
    const entry = this.scenes.find((s) => s.id === id) || this.scenes[0];
    if (!entry) return;
    const token = {};
    this.sceneToken = token;
    if (this.host.current) await this.#fade(1, 220);
    if (this.sceneToken !== token) return;
    this.hidden = true;
    const size = { width: this.vp.width, height: this.vp.height };
    const quality = this.params.get('quality') || 'high';
    const t0 = performance.now();
    try {
      await this.host.load(entry, size, quality);
    } catch {
      const fallback = this.scenes.find((s) => s.id !== entry.id);
      if (fallback && fallback.id !== id) return this.loadScene(fallback.id, { save });
    }
    console.info(`Scene ${entry.id} built in ${Math.round(performance.now() - t0)} ms (behind the fade).`);
    this.drawError = null;
    if (save) this.change({ scene: entry.id }, { quiet: true });
    this.dock.setScenes(this.scenes, this.host.current?.id);
    // Each scene starts at full resolution and earns its own pixel ratio.
    if (!this.fixedDpr) this.maxDpr = Infinity;
    this.governor.reset(performance.now(), this.#trackingCounters());
    this.resolutionWhy = null;
    await this.#settle();
    if (this.sceneToken !== token) return;
    this.hidden = false;
    this.#fade(0, 400);
  }

  #fade(opacity, ms) {
    const el = this.fadeEl;
    if (!el) return Promise.resolve();
    el.style.transition = `opacity ${ms}ms ease`;
    el.style.opacity = String(opacity);
    return new Promise((r) => setTimeout(r, ms + 20));
  }

  /** A few drawn frames, and the face tracked again after a stall (max 0.8 s). */
  async #settle() {
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    for (let i = 0; i < 3; i++) await frame();
    const t0 = performance.now();
    while (performance.now() - t0 < 800) {
      const tr = this.tracker;
      if (this.input !== 'camera' || !tr || tr.state !== 'running') break;
      if (tr.eyes.state === 'tracking' && performance.now() - (tr.stats.lastFaceAt ?? 0) < 120) break;
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  #stepScene(dir) {
    if (this.scenes.length < 2) return;
    const i = this.scenes.findIndex((s) => s.id === this.host.current?.id);
    this.loadScene(this.scenes[(i + dir + this.scenes.length) % this.scenes.length].id);
  }

  #refreshPanels() {
    const info = readScreenInfo(window);
    const vp = viewportOnDisplay(info, this.size);
    const fs = vp.fullscreen;
    const sidePanel = !fs && vp.sidePanelPt > 4;
    this.dock.setFullscreen(!!document.fullscreenElement);
    this.dock.showTip(!fs && !this.tipDismissed && !this.intro.open && this.settings.started, { sidePanel });
    this.dock.setScenes(this.scenes, this.host.current?.id);
    const zoom = vp.zoom;
    this.sheet.update(this.settings, {
      cameras: this.cameras,
      cameraId: this.tracker?.deviceId || this.settings.cameraId,
      presetId: this.presetId(),
      hfovDeg: this.hfov(),
      measuredIpdMm: this.tracker?.ipd.measured ? this.tracker.ipd.measured * 1000 : null,
      usedIpdMm: this.tracker ? this.tracker.ipd.fused(this.settings.ipdMm / 1000, this.settings.ipdManual) * 1000 : null,
      screenMatches: screenMatchesPreset(info, this.size),
      cameraDelayMs: this.cameraDelay(),
      cameraDelayMeasured: this.settings.cameraDelays[this.presetId()] !== undefined,
      zoom,
      sidePanel,
    });
    this.#refreshSteady();
    this.lastSidePanel = sidePanel;
  }

  #refreshSteady() {
    if (!this.steady.open) return;
    const tr = this.tracker;
    const ipdUsed = tr ? tr.ipd.fused(this.settings.ipdMm / 1000, this.settings.ipdManual) * 1000 : this.settings.ipdMm;
    const eye = tr?.last?.mode === 'left' ? 'left' : tr?.last?.mode === 'right' ? 'right' : this.settings.eye;
    const z = this.eyeZ.mean(performance.now());
    this.steadyPanel.setEyes({ open: eye, closed: eye === 'left' ? 'right' : 'left' });
    this.steadyPanel.update({
      ipdMm: this.settings.ipdManual ? this.settings.ipdMm : ipdUsed,
      trimY: this.settings.cameraTrimMm.y,
      distanceCm: this.input === 'camera' && tr?.faceVisible && z.n >= 5 ? z.mean * 100 : null,
      eye,
    });
  }

  // ---------------------------------------------------------------- loop

  /** A frame failed to draw: log each new error once, and show it for a few seconds. */
  #drawFailed(err) {
    const message = String(err?.message || err);
    if (message !== this.drawError?.message) console.error('The scene could not draw a frame:', err);
    this.drawError = { message, until: performance.now() + 3000 };
  }

  /** @returns {[text:string, tone:'ok'|'warn'|'error'|'muted', detail?:string]} */
  #status() {
    if (this.contextLost) return ['Graphics stopped', 'error', 'The browser reset the graphics. Waiting for them to come back.'];
    if (this.drawError && performance.now() < this.drawError.until) {
      return ['The scene stopped drawing', 'error', `${this.drawError.message}. Choose a scene to load it again.`];
    }
    if (this.flashMsg && performance.now() < this.flashMsg.until) return [this.flashMsg.text, 'ok'];
    if (this.input !== 'camera' || !this.tracker) return ['Following the mouse', 'muted'];
    const tr = this.tracker;
    const hl = tr.health;
    if (tr.state === 'error') return ['Tracking stopped', 'error', tr.error?.message];
    if (tr.state === 'paused') return ['Camera paused', 'muted'];
    if (tr.state !== 'running') return ['Starting camera', 'muted'];
    if (hl?.kind === 'restarting') return [hl.what === 'camera' ? 'Restarting the camera' : 'Restarting face tracking', 'warn', hl.message];
    if (hl?.kind === 'muted') return ['Camera paused by the system', 'warn', hl.message];
    if (hl?.kind === 'error') return ['Face tracking error', 'warn', hl.message];
    if (hl?.kind === 'recovered' && performance.now() < hl.until) {
      return [hl.what === 'camera' ? 'Camera restarted' : 'Face tracking restarted', 'ok', hl.message];
    }
    if (!tr.faceVisible) return ['Looking for you', 'warn'];
    const mode = tr.last?.mode;
    if (mode === 'phone') return ['Following the phone lens', 'ok'];
    if (mode === 'both') return ['Following your eyes', 'ok'];
    return [`Following your ${mode === 'left' ? 'left' : 'right'} eye`, 'ok'];
  }

  frame(t) {
    requestAnimationFrame(this.frame);
    const t0 = performance.now();
    const rawDt = this.lastT === null ? 16.7 : t - this.lastT;
    // Scenes animate with at most a quarter second per frame; statistics
    // keep the real interval.
    const dt = Math.min(rawDt, 250);
    this.lastT = t;
    const counted = !this.hidden && !this.host.loading;
    if (rawDt > 100) {
      this.perf.stalls.push({ t: Math.round(t), ms: Math.round(rawDt), hidden: !counted });
      if (this.perf.stalls.length > 50) this.perf.stalls.shift();
      console.info(`Slow frame: ${Math.round(rawDt)} ms${counted ? '' : ' (hidden behind a scene change)'}.`);
    }
    if (rawDt > 0 && counted) {
      this.vsync += 0.02 * (Math.min(Math.max(rawDt, 6), 34) - this.vsync);
      this.fps += 0.05 * (1000 / rawDt - this.fps);
    }
    if (counted) this.frameTimes[this.frameCount++ % this.frameTimes.length] = rawDt;

    const info = readScreenInfo(window);
    const vp = viewportOnDisplay(info, this.size);
    this.vp = vp;
    // Never more pixels than the panel shows (2880 across on the 15-inch Air).
    // (A hair over, so the buffer is the full 2880, never 2879.)
    this.panelCap = panelPixelRatio(this.size, info, vp.zoom) * (1 + 1e-6);
    const dpr = Math.min(info.dpr, this.maxDpr, this.fixedDpr ? Infinity : this.panelCap);
    if (this.canvasSize[0] !== info.innerWidth || this.canvasSize[1] !== info.innerHeight || this.canvasSize[2] !== dpr) {
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(info.innerWidth, info.innerHeight, false);
      this.canvasSize = [info.innerWidth, info.innerHeight, dpr];
      this.#refreshPanels();
    }
    const size = { width: vp.width, height: vp.height };

    // The frame drawn now is seen about 1.5 frames later, plus LCD response.
    const lead = this.settings.motionMode !== 'predict' || this.settings.prediction > 0 ? 1.5 * this.vsync + 5 : 0;
    const tShow = t + lead;
    const tracking = this.input === 'camera' && this.tracker && this.tracker.state !== 'idle';
    const eyeD = tracking ? this.tracker.sample(tShow) : this.mouse.sample(tShow);
    this.frameHook?.(t, tShow, eyeD);
    const eyeW = displayToWindow(eyeD, vp);
    if (this.recorder?.active) {
      const log = this.recorder.frame(t, tShow, eyeD, eyeW);
      if (log) this.#finishLog(log);
    }
    eyeW.z = Math.max(eyeW.z, 0.08);
    applyWindowCamera(this.camera3, eyeW, vp.width, vp.height, { near: 0.005, far: 200 });
    this.eyeVec.set(eyeW.x, eyeW.y, eyeW.z);

    const secs = t / 1000;
    // One scene error must not stop the loop: the status pill, resolution
    // and idle upkeep below keep running, and the pill says what happened.
    try {
      if (this.contextLost) {
        // Nothing can draw until the browser gives the graphics back.
      } else if (this.steady.open && this.steady.inst) {
        this.steady.inst.resize(size);
        this.steady.inst.update(dt / 1000, secs, this.eyeVec);
        this.msaa.render(this.steady.inst.scene, this.camera3);
      } else if (this.host.current) {
        this.host.resize(size);
        this.host.update(dt / 1000, secs, this.eyeVec);
        this.host.render(this.camera3);
      }
    } catch (err) {
      this.#drawFailed(err);
    }

    // Interface upkeep (cheap, throttled where it matters).
    const [text, tone, detail = ''] = this.#status();
    if (text !== this.lastStatus || detail !== this.lastStatusDetail) {
      this.lastStatus = text;
      this.lastStatusDetail = detail;
      this.dock.setStatus(text, tone, detail);
    }
    this.#adaptResolution(t, dt, info.dpr);
    if (++this.ticks % 15 === 0) {
      const fs = vp.fullscreen;
      if (fs !== this.lastFs || (!fs && (vp.sidePanelPt > 4) !== this.lastSidePanel)) { this.lastFs = fs; this.#refreshPanels(); }
      if (this.steady.open) this.#refreshSteady();
      this.#updateIdle();
    }
    if (this.hud.open) this.hud.update(this.#hudSnapshot(eyeW, vp, info, lead));
    const work = performance.now() - t0;
    if (!counted) return;
    this.perf.deltas.push(rawDt);
    this.perf.work.push(work);
    if (this.perf.deltas.length > 3600) { this.perf.deltas.shift(); this.perf.work.shift(); }
  }

  /** Tracking counters for the resolution governor, or null when not tracking. */
  #trackingCounters() {
    const tr = this.tracker;
    if (this.input !== 'camera' || tr?.state !== 'running' || tr.restarting || tr.muted) return null;
    // The model runs slow for its first seconds (compilation, caches): don't judge it yet.
    if (performance.now() - tr.startedAt < 4000) return null;
    return { results: tr.stats.results, frames: tr.stats.framesIn, latencyMs: tr.stats.latencyMs ?? 0 };
  }

  #adaptResolution(t, dt, deviceDpr) {
    if (this.fixedDpr) return;
    const g = this.governor;
    const tracking = this.#trackingCounters();
    if (this.host.loading || document.hidden || this.steady.open) {
      g.start(t, tracking); // nothing representative to judge
      return;
    }
    g.frame(dt, this.vsync);
    const cap = Math.min(this.panelCap, deviceDpr);
    const r = g.update(t, { cur: this.renderer.getPixelRatio(), cap, tracking });
    if (!r) return;
    this.maxDpr = r.ratio;
    this.resolutionWhy = r.why === 'headroom' || r.ratio >= cap - 1e-3 ? null : r.why;
    console.info(`Rendering at ${r.ratio}x: ${r.why} (panel ${cap}x, device ${deviceDpr}x).`);
  }

  #updateIdle() {
    // A problem keeps the dock (and its status pill) in view.
    const problem = this.contextLost || (this.drawError && performance.now() < this.drawError.until);
    const panelOpen = problem || this.sheet.open || this.intro.open || this.card.open || !this.dock.menu.hidden || this.hud.open;
    const focusInUi = document.activeElement && document.activeElement !== document.body && document.activeElement.closest?.('.ui');
    const idle = !panelOpen && !focusInUi && performance.now() - this.lastActivity > IDLE_MS;
    // The steady panel stays readable; everything else fades.
    document.body.classList.toggle('idle', idle && !this.steady.open);
  }

  #hudSnapshot(eyeW, vp, info, lead) {
    let worst = 0;
    const n = Math.min(this.frameCount, this.frameTimes.length);
    for (let i = 0; i < n; i++) worst = Math.max(worst, this.frameTimes[i]);
    const tr = this.tracker;
    const r = tr?.last;
    const cam = tr?.cam;
    const ipdUsed = tr ? tr.ipd.fused(this.settings.ipdMm / 1000, this.settings.ipdManual) * 1000 : this.settings.ipdMm;
    const intr = r?.intr;
    const mode = this.input !== 'camera' ? 'mouse' : r?.mode === 'both' ? 'between the eyes' : r?.mode === 'phone' ? 'phone lens' : `${r?.mode || this.settings.eye} eye`;
    return {
      eyeWindow: eyeW,
      view: this.viewSetting(),
      viewDirection: this.settings.viewDirection,
      motion: this.settings.motionMode === 'predict' ? `predict, look-ahead ${Math.round(this.settings.prediction * 100)} %` : `smooth follow, smoothness ${Math.round(this.settings.smoothness * 100)} %`,
      recording: this.recorder?.state,
      sol: tr?.faceVisible ? r?.sol : null,
      source: mode,
      stats: tr?.stats,
      landmarker: tr?.landmarkerInfo,
      cameraDelayMs: this.cameraDelay(),
      leadMs: (tr?.stats.latencyMs || 0) + this.cameraDelay() + lead,
      followDelayMs: tr?.eyes.following ? tr.eyes.follower.delay : null,
      fps: this.fps,
      worstMs: worst,
      dpr: this.renderer.getPixelRatio(),
      deviceDpr: info.dpr,
      panelDpr: this.panelCap,
      resolutionWhy: this.resolutionWhy,
      ipdUsedMm: ipdUsed,
      ipdMeasuredMm: tr?.ipd.measured ? tr.ipd.measured * 1000 : null,
      display: `${info.screenWidth} × ${info.screenHeight} pt, ${(vp.metresPerPoint * 1000).toFixed(3)} mm/pt`,
      window: `${(vp.width * 1000).toFixed(0)} × ${(vp.height * 1000).toFixed(0)} mm${vp.fullscreen ? ', full screen' : ''}`,
      centre: `${(vp.centre.x * 1000).toFixed(1)}, ${(vp.centre.y * 1000).toFixed(1)} mm`,
      camera: cam ? `${cam.video.videoWidth} × ${cam.video.videoHeight}, ${intr ? deliveredHfov(intr).toFixed(1) : this.hfov().toFixed(1)}°` : 'off',
      video: cam?.video,
      result: tr?.faceVisible ? r : null,
    };
  }

  /** Frame timing summary for tests and the details panel. */
  perfSummary() {
    const d = [...this.perf.deltas].sort((a, b) => a - b);
    const w = [...this.perf.work].sort((a, b) => a - b);
    const q = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : null);
    return {
      frames: d.length,
      fps: d.length ? 1000 / (d.reduce((s, x) => s + x, 0) / d.length) : null,
      p50: q(d, 0.5), p95: q(d, 0.95), p99: q(d, 0.99), max: d.at(-1),
      over20ms: d.filter((x) => x > 20).length,
      workP50: q(w, 0.5), workP99: q(w, 0.99), workMax: w.at(-1),
    };
  }
}

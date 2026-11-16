// Face landmarker front end: runs MediaPipe in a worker (default) or on the
// main thread, with the same interface. Everything is served locally: the
// WebAssembly runtime is bundled from node_modules by Vite, the model lives in
// public/models/. Requests to any other origin are refused on both paths
// (src/tracking/net-guard.js).

import './net-guard-install.js';
import { isSameOriginOnly } from './net-guard.js';
import wasmLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import wasmModuleLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_module_internal.js?url';
import wasmModuleBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url';
import { createLandmarker, packResult, monotonic } from './landmarker-core.js';

const abs = (u) => new URL(u, location.href).href;

export const MODEL_URL = abs(`${import.meta.env.BASE_URL}models/face_landmarker.task`);

export class Landmarker {
  /**
   * @param {{mode?:'worker'|'main', delegate?:'GPU'|'CPU', numFaces?:number}} opts
   */
  constructor({ mode = 'worker', delegate = 'CPU', numFaces = 2 } = {}) {
    this.requested = { mode, delegate, numFaces };
    this.mode = null;
    this.delegate = null;
    this.initMs = 0;
    this.busy = false;
    this.worker = null;
    this.task = null;
    this.pending = new Map(); // id -> { resolve, t0 }
    this.nextId = 1;
    this.onfail = null; // (Error) => void: the worker died after starting
  }

  /** Age (ms) of the oldest request still waiting for an answer, 0 if none. */
  pendingAge(now = performance.now()) {
    let age = 0;
    for (const p of this.pending.values()) age = Math.max(age, now - p.t0);
    return age;
  }

  async init() {
    if (this.requested.mode === 'worker' && typeof Worker !== 'undefined' && typeof VideoFrame !== 'undefined') {
      try {
        await this.#initWorker();
        return this.info();
      } catch (err) {
        console.warn('Face tracking worker failed, using the main thread instead:', err);
        this.worker?.terminate();
        this.worker = null;
      }
    }
    await this.#initMain();
    return this.info();
  }

  info() {
    return { mode: this.mode, delegate: this.delegate, initMs: this.initMs };
  }

  #initWorker() {
    this.worker = new Worker(new URL('./landmarker-worker.js', import.meta.url), { type: 'module' });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('worker did not start within 20 s')), 20000);
      this.worker.onerror = (e) => { clearTimeout(timer); reject(new Error(e.message || 'worker error')); };
      this.worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'ready') {
          clearTimeout(timer);
          this.mode = 'worker';
          this.delegate = m.delegate;
          this.initMs = m.initMs;
          this.worker.onmessage = (ev) => this.#onWorkerMessage(ev.data);
          // From now on a worker error means it died: nothing pending will
          // ever be answered.
          this.worker.onerror = (ev) => {
            ev.preventDefault?.();
            this.onfail?.(new Error(ev.message || 'the face tracking worker stopped'));
          };
          resolve();
        } else if (m.type === 'error') {
          clearTimeout(timer);
          reject(new Error(m.message));
        }
      };
      this.worker.postMessage({
        type: 'init',
        wasm: { wasmLoaderPath: abs(wasmModuleLoaderUrl), wasmBinaryPath: abs(wasmModuleBinaryUrl) },
        modelUrl: MODEL_URL,
        delegate: this.requested.delegate,
        numFaces: this.requested.numFaces,
      });
    });
  }

  async #initMain() {
    const t0 = performance.now();
    // Fail closed: no tracking rather than tracking that can call out.
    if (!isSameOriginOnly(globalThis)) throw new Error('the network guard is not in place');
    const wasm = { wasmLoaderPath: abs(wasmLoaderUrl), wasmBinaryPath: abs(wasmBinaryUrl) };
    const order = this.requested.delegate === 'CPU' ? ['CPU'] : ['GPU', 'CPU'];
    let lastErr;
    for (const delegate of order) {
      try {
        const canvas = delegate === 'GPU' ? document.createElement('canvas') : undefined;
        this.task = await createLandmarker({ wasm, modelUrl: MODEL_URL, delegate, numFaces: this.requested.numFaces, canvas });
        this.delegate = delegate;
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!this.task) throw lastErr;
    this.mode = 'main';
    this.stamp = monotonic();
    this.initMs = performance.now() - t0;
  }

  #onWorkerMessage(m) {
    if (m.type !== 'result') return;
    const p = this.pending.get(m.id);
    this.pending.delete(m.id);
    this.busy = this.pending.size > 0;
    if (p) p.resolve(m);
  }

  /**
   * Detect faces in the video's current frame.
   * @param {HTMLVideoElement} video
   * @param {number} t capture time (ms, performance.now clock)
   * @returns {Promise<{t, inferMs, width, height, faces: Float32Array[], matrices: (Float32Array|null)[]}>}
   */
  detect(video, t) {
    if (this.mode === 'worker') {
      // May throw (camera reconfigured, frame not ready): the caller carries on.
      const frame = new VideoFrame(video, { timestamp: Math.round(t * 1000) });
      const id = this.nextId++;
      return new Promise((resolve) => {
        this.pending.set(id, { resolve, t0: performance.now() });
        this.busy = true;
        try {
          this.worker.postMessage({ type: 'frame', frame, t, id }, [frame]);
        } catch (err) {
          this.pending.delete(id);
          this.busy = this.pending.size > 0;
          try { frame.close(); } catch { /* already transferred or closed */ }
          resolve({ t, inferMs: 0, width: video.videoWidth, height: video.videoHeight, faces: [], matrices: [], error: String(err?.message || err) });
        }
      });
    }
    const t0 = performance.now();
    let packed = { faces: [], matrices: [] };
    let error = null;
    try {
      packed = packResult(this.task.detectForVideo(video, this.stamp(t)));
    } catch (err) {
      error = String(err?.message || err);
    }
    return Promise.resolve({
      t, inferMs: performance.now() - t0, width: video.videoWidth, height: video.videoHeight, error, ...packed,
    });
  }

  /** @param {{force?:boolean}} [o] force: terminate a worker that may be hung or dead */
  close({ force = false } = {}) {
    for (const p of this.pending.values()) p.resolve({ faces: [], matrices: [], closed: true });
    this.pending.clear();
    if (this.worker) {
      this.worker.onerror = null;
      this.worker.onmessage = null;
      if (force) this.worker.terminate();
      else this.worker.postMessage({ type: 'close' });
      this.worker = null;
    }
    this.task?.close();
    this.task = null;
    this.busy = false;
  }
}

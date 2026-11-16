// Tracking details: camera thumbnail with landmarks, eye position, rates and
// latency. Updated a few times a second, never per frame, to stay out of the
// render loop's way.

import { h, fmt } from './dom.js';
import { LM } from '../tracking/eye-solve.js';
import { LOG_CONTAINS } from './recorder.js';

const ROWS = [
  ['eye', 'Eye x, y, z'],
  ['dist', 'Distance, turn'],
  ['eyeUsed', 'Viewpoint'],
  ['view', 'View (V, R)'],
  ['motion', 'Motion'],
  ['track', 'Tracking'],
  ['infer', 'Face model'],
  ['latency', 'Delay'],
  ['lead', 'Looks ahead'],
  ['render', 'Render'],
  ['ipd', 'Eye spacing'],
  ['display', 'Display'],
  ['window', 'Window'],
  ['centre', 'Window centre'],
  ['camera', 'Camera'],
];

export class Hud {
  constructor(root, { onRecord } = {}) {
    this.canvas = h('canvas', { width: 560, height: 316, 'aria-label': 'Camera view with tracked face points' });
    this.cells = {};
    const dl = h('dl', {});
    for (const [k, label] of ROWS) {
      this.cells[k] = h('dd', { text: '–' });
      dl.append(h('dt', { text: label }), this.cells[k]);
    }
    this.recordBtn = h('button', { class: 'btn small', onclick: () => onRecord?.() }, 'Record tracking log');
    const record = h('div', { class: 'hud-record' }, this.recordBtn, h('p', { class: 'hint', text: LOG_CONTAINS }));
    this.el = h('aside', { class: 'hud glass', 'aria-label': 'Tracking details', hidden: true }, this.canvas, dl, record);
    root.append(this.el);
    this.ctx = this.canvas.getContext('2d');
    this.lastDraw = 0;
  }

  get open() {
    return !this.el.hidden;
  }

  setOpen(on) {
    this.el.hidden = !on;
  }

  /** @param {object} d snapshot assembled by the app */
  update(d) {
    if (this.el.hidden) return;
    const now = performance.now();
    if (now - this.lastDraw < 100) return;
    this.lastDraw = now;
    const c = this.cells;
    const e = d.eyeWindow;
    c.eye.textContent = e ? `${fmt(e.x * 100)}, ${fmt(e.y * 100)}, ${fmt(e.z * 100)} cm` : '–';
    c.dist.textContent = d.sol ? `${fmt(d.sol.distance * 100, 0)} cm, ${fmt(Math.asin(d.sol.sinYaw) * 57.3, 0)}°` : '–';
    c.eyeUsed.textContent = d.source;
    const v = d.view;
    const forced = v && v.direction !== d.viewDirection;
    const turn = v?.turn?.on ? `, head turn ${fmt(v.turn.strength, 2)}x` : '';
    c.view.textContent = v ? `${v.direction === 'look' ? 'Look around' : 'True window'}, ${fmt(v.strength, 1)}x${turn}${forced ? ' (exact here)' : ''}` : '–';
    c.motion.textContent = d.motion || '–';
    const rec = d.recording;
    this.recordBtn.textContent = rec ? `Recording… ${rec.secondsLeft} s` : 'Record tracking log';
    this.recordBtn.disabled = !!rec;
    const t = d.stats;
    c.track.textContent = t ? `${fmt(t.hz, 0)} Hz of ${fmt(t.cameraFps, 0)} fps camera, ${t.dropped} skipped${t.restarts ? `, ${t.restarts} restarts` : ''}` : '–';
    c.track.classList.toggle('warn', !!(t && t.hz && t.cameraFps && t.hz < 0.85 * t.cameraFps));
    c.infer.textContent = d.landmarker ? `${fmt(t?.inferMs, 1)} ms, ${d.landmarker.mode} ${d.landmarker.delegate}` : '–';
    c.latency.textContent = t?.latencyMs ? `${fmt(t.latencyMs, 0)} ms + ${d.cameraDelayMs} ms camera` : '–';
    c.lead.textContent = d.followDelayMs != null
      ? `no (draws ${fmt(d.followDelayMs, 0)} ms behind, smoothly)`
      : t?.latencyMs ? `${fmt(d.leadMs, 0)} ms` : '–';
    const res = `${fmt(d.dpr, 2)}x of ${fmt(Math.min(d.panelDpr, d.deviceDpr), 2)}x`;
    c.render.textContent = `${fmt(d.fps, 0)} fps, worst ${fmt(d.worstMs, 0)} ms, ${res}${d.resolutionWhy ? ` (${d.resolutionWhy})` : ''}`;
    c.ipd.textContent = `${fmt(d.ipdUsedMm, 1)} mm${d.ipdMeasuredMm ? `, irises ${fmt(d.ipdMeasuredMm, 1)}` : ''}`;
    c.display.textContent = d.display;
    c.window.textContent = d.window;
    c.centre.textContent = d.centre;
    c.camera.textContent = d.camera;
    this.#draw(d);
  }

  #draw(d) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const v = d.video;
    if (!v || !v.videoWidth) {
      ctx.fillStyle = '#73767f';
      ctx.font = '22px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No camera', W / 2, H / 2);
      return;
    }
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    // Source crop: around the face when there is one (smoothly), else the whole frame.
    let want = { x: 0, y: 0, w: vw, h: vh };
    const r = d.result;
    if (r?.landmarks) {
      const a = r.landmarks[LM.right.outer];
      const b = r.landmarks[LM.left.outer];
      const span = Math.hypot((a.x - b.x) * vw, (a.y - b.y) * vh);
      const cw = Math.min(vw, span * 4.2);
      const ch = Math.min(vh, (cw * H) / W);
      const cx = ((a.x + b.x) / 2) * vw;
      const cy = ((a.y + b.y) / 2) * vh + span * 0.35;
      want = { x: Math.min(Math.max(cx - cw / 2, 0), vw - cw), y: Math.min(Math.max(cy - ch / 2, 0), vh - ch), w: cw, h: ch };
    }
    const k = this.crop ? 0.25 : 1;
    this.crop = this.crop || want;
    for (const key of ['x', 'y', 'w', 'h']) this.crop[key] += (want[key] - this.crop[key]) * k;
    const c = this.crop;
    // Mirrored, like a mirror: easier to read than the raw image.
    ctx.save();
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    ctx.globalAlpha = 0.9;
    ctx.drawImage(v, c.x, c.y, c.w, c.h, 0, 0, W, H);
    ctx.restore();
    if (!r?.landmarks) return;
    const X = (p) => W - ((p.x * vw - c.x) / c.w) * W;
    const Y = (p) => ((p.y * vh - c.y) / c.h) * H;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    for (let i = 0; i < r.landmarks.length; i += 2) {
      const p = r.landmarks[i];
      ctx.fillRect(X(p) - 1, Y(p) - 1, 2, 2);
    }
    ctx.fillStyle = '#9cc0ff';
    for (const i of [LM.right.outer, LM.right.inner, LM.left.outer, LM.left.inner]) {
      const p = r.landmarks[i];
      ctx.fillRect(X(p) - 2.5, Y(p) - 2.5, 5, 5);
    }
    // The pupil points the solver used; the one being rendered from is ringed.
    for (const side of ['left', 'right']) {
      const o = r.obs[side];
      const p = { x: o.u / r.width, y: o.v / r.height };
      ctx.strokeStyle = o.open ? '#7fd1a5' : '#f0c070';
      ctx.lineWidth = side === r.mode ? 3 : 1.5;
      ctx.beginPath();
      ctx.arc(X(p), Y(p), side === r.mode ? 9 : 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

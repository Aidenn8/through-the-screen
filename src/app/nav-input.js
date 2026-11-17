// Keyboard, trackpad and mouse input that carries the window through a scene
// (src/core/rig-motion.js moves it). Head tracking is untouched: the rig is
// the window's place in the scene, the eye still moves behind the glass.
//
// - Arrow keys are held: forward, back, step left and right; with Shift,
//   rise, sink and turn. A held key speeds up after a moment.
// - Drag (press and move, mouse or trackpad) turns and tilts, the scene
//   following the pointer like a photo sphere. With the mouse standing in for
//   the camera the pointer is the eye, so while the button is down the eye
//   holds still and only the turn happens (App skips the pointer then).
// - Two-finger swipe or scroll wheel: up and down move forward and back
//   (fingers or wheel away from you is forward, with macOS's natural
//   scrolling), sideways turns. A trackpad's two-finger swipe and a wheel are
//   the same event in the browser, so they cannot be told apart; scrolling
//   is the one meaning both share.
// - Pinch: forward and back (pinch out goes in). Chrome sends a pinch as
//   Ctrl + wheel, Safari as gesture events; both are taken here so a pinch
//   never zooms the page, which would move the scene off the display's real
//   size.
// Wheel and drag over the interface (the settings sheet scrolls) are left
// alone. None of this wakes the faded interface: moving is looking.

import { HELD, keyAction } from './keys.js';

export const INPUT_GAINS = {
  dragDegPerPx: 0.1, // a full screen width (1710 points) turns about 170 degrees
  swipeDegPerPx: 0.1,
  swipeMetresPerPx: 0.0006, // window metres; a long swipe with its glide is about half a metre
  pinchMetresPerUnit: 0.005,
  lineHeightPx: 16,
};

export class NavInput {
  /**
   * @param {object} o
   * @param {object} o.motion RigMotion
   * @param {HTMLElement} o.canvas
   * @param {() => boolean} [o.enabled] false while a panel needs the input (steady check, intro)
   * @param {(what:string) => void} [o.onMove] the viewer moved (stops showing a station as current)
   * @param {() => boolean} [o.arrowsTaken] a panel has the arrow keys (keys.js arrowsTaken):
   *   arrows held when it opened stop moving the window
   */
  constructor({ motion, canvas, enabled = () => true, onMove = () => {}, arrowsTaken = () => false }) {
    this.motion = motion;
    this.canvas = canvas;
    this.enabled = enabled;
    this.arrowsTaken = arrowsTaken;
    this.onMove = onMove;
    this.held = new Map(); // key -> time it went down (ms)
    this.scaleKey = null; // { dir, at }
    this.shift = false;
    this.drag = null; // { id, x, y }
    this.pinchScale = null; // Safari pinch: the scale of the last gesturechange
    this.g = { ...INPUT_GAINS };
    this.rate = {}; // reused every frame
  }

  /** Wire up the pointer and wheel listeners (keys come through App). */
  attach(win = window) {
    win.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    // Safari sends a trackpad pinch as gesture events, not Ctrl + wheel.
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      win.addEventListener(type, (e) => this.gesture(e), { passive: false });
    }
    this.canvas.addEventListener('pointerdown', (e) => this.pointerDown(e));
    win.addEventListener('pointermove', (e) => this.pointerMove(e), { passive: true });
    win.addEventListener('pointerup', (e) => this.pointerUp(e));
    win.addEventListener('pointercancel', (e) => this.pointerUp(e));
    win.addEventListener('blur', () => this.release());
    win.addEventListener('keyup', (e) => this.keyUp(e));
    // Shift alone has no action, so App never passes it on: pressing it while
    // an arrow is held must switch to rise and turn at once.
    win.addEventListener('keydown', (e) => { if (e.key === 'Shift') this.shift = true; });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.release(); });
  }

  get dragging() {
    return !!this.drag;
  }

  /** Let go of everything held (focus left the page, Cmd swallowed a key up). */
  release() {
    this.held.clear();
    this.scaleKey = null;
    this.shift = false;
    this.drag = null;
  }

  // ------------------------------------------------------------ keys

  /**
   * A key went down; App has already checked it is for the scene (not typed
   * into a control, no panel in the way). Returns true when it was used.
   */
  keyDown(e) {
    this.shift = !!e.shiftKey;
    if (e.metaKey) {
      // macOS sends no key up for keys released while Cmd is down.
      this.release();
      return false;
    }
    const action = keyAction(e);
    if (!action || !this.motion.enabled || !this.enabled()) return false;
    if (HELD.has(e.key)) {
      if (!this.held.has(e.key)) this.held.set(e.key, e.timeStamp || performance.now());
      this.onMove('keys');
      return true;
    }
    if (action === 'shrink' || action === 'grow') {
      const dir = action === 'shrink' ? 1 : -1;
      if (!e.repeat) {
        this.motion.nudge({ scaleSteps: dir });
        this.scaleKey = { dir, at: e.timeStamp || performance.now() };
        this.onMove('scale');
      }
      return true;
    }
    return false;
  }

  keyUp(e) {
    this.shift = !!e.shiftKey;
    if (e.key === 'Meta') this.release();
    this.held.delete(e.key);
    if (['+', '=', '-', '_'].includes(e.key)) this.scaleKey = null;
  }

  /**
   * Held-key rates for this frame (RigMotion.update's second argument), or
   * null when nothing is held.
   * @param {number} now ms, the clock of the key events (performance.now)
   */
  rates(now) {
    if (!this.held.size && !this.scaleKey) return null;
    if (!this.enabled()) {
      this.release();
      return null;
    }
    if (this.held.size && this.arrowsTaken()) {
      this.held.clear();
      if (!this.scaleKey) return null;
    }
    const on = (k) => (this.held.has(k) ? 1 : 0);
    const r = this.rate;
    const sh = this.shift;
    const ud = on('ArrowUp') - on('ArrowDown');
    const lr = on('ArrowRight') - on('ArrowLeft');
    r.forward = sh ? 0 : ud;
    r.up = sh ? ud : 0;
    r.right = sh ? 0 : lr;
    r.turn = sh ? -lr : 0;
    let first = Infinity;
    for (const t of this.held.values()) first = Math.min(first, t);
    r.boost = Number.isFinite(first) ? this.motion.boostFor((now - first) / 1000) : 1;
    r.scale = this.scaleKey ? this.scaleKey.dir : 0;
    r.scaleHeld = this.scaleKey ? (now - this.scaleKey.at) / 1000 : 0;
    return r;
  }

  // ------------------------------------------------------------ wheel

  /** Over the interface (a scrolling sheet, a menu): not ours. */
  #overUi(e) {
    const t = e.target;
    return !!(t && t !== this.canvas && typeof t.closest === 'function' && t.closest('.ui > *'));
  }

  wheel(e) {
    if (this.#overUi(e)) return;
    // A pinch (Ctrl + wheel) must never zoom the page, even with nothing to move.
    if (e.ctrlKey) e.preventDefault();
    if (!this.motion.enabled || !this.enabled()) return;
    e.preventDefault(); // and no back-swipe navigation from a sideways swipe
    const k = e.deltaMode === 1 ? this.g.lineHeightPx : e.deltaMode === 2 ? 800 : 1;
    const dx = e.deltaX * k;
    const dy = e.deltaY * k;
    if (e.ctrlKey) {
      this.motion.nudge({ dolly: -dy * this.g.pinchMetresPerUnit });
    } else {
      // Fingers move right: the scene follows them, so the view turns left.
      this.motion.nudge({ dolly: dy * this.g.swipeMetresPerPx, yaw: -dx * this.g.swipeDegPerPx });
    }
    this.onMove('wheel');
  }

  /**
   * Safari's pinch: gesturestart, gesturechange (scale since the start),
   * gestureend. Never zooms the page; moves like Chrome's pinch (which sends
   * Ctrl + wheel with deltaY about -100 ln(scale) for the same fingers).
   */
  gesture(e) {
    if (this.#overUi(e)) return;
    e.preventDefault();
    if (e.type === 'gesturestart') {
      this.pinchScale = 1;
      return;
    }
    if (e.type === 'gestureend') {
      this.pinchScale = null;
      return;
    }
    const s = e.scale;
    if (!(s > 0) || !this.pinchScale) return;
    const ratio = s / this.pinchScale;
    this.pinchScale = s;
    if (!this.motion.enabled || !this.enabled()) return;
    this.motion.nudge({ dolly: 100 * Math.log(ratio) * this.g.pinchMetresPerUnit });
    this.onMove('pinch');
  }

  // ------------------------------------------------------------ drag

  pointerDown(e) {
    if (e.button !== 0 || !e.isPrimary) return;
    if (!this.motion.enabled || !this.enabled()) return;
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    try { this.canvas.setPointerCapture?.(e.pointerId); } catch { /* not capturable */ }
  }

  pointerMove(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!dx && !dy) return;
    if (!this.enabled()) {
      this.drag = null;
      return;
    }
    // The scene follows the pointer: drag right and the view turns left;
    // drag up and it tilts down.
    this.motion.nudge({ yaw: dx * this.g.dragDegPerPx, pitch: dy * this.g.dragDegPerPx });
    this.onMove('drag');
  }

  pointerUp(e) {
    if (this.drag && e.pointerId === this.drag.id) this.drag = null;
  }
}

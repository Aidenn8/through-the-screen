// Tracking watchdog: notices when the camera or the face model has stopped
// and says which one to restart. Pure logic on one clock (ms), so it can be
// tested without a browser; the tracker feeds it events and acts on check().
//
// Faults it covers (all seen or injected, docs/CORE_NOTES.md):
//   - the model's worker died or hangs: a request stays unanswered;
//   - frames arrive but no result has come back for a while;
//   - the model answers every frame with an error;
//   - the camera stopped delivering frames without telling anyone.
// A muted track (the system paused the camera) and a hidden tab are waited
// out, not restarted. Restarts back off, and after too many in a short time
// the watchdog gives up so the app can say so instead of looping.

export const WATCHDOG_DEFAULTS = {
  pendingMs: 700, // a single request unanswered this long: the model is stuck
  resultMs: 1500, // frames arriving but no result this long: the model is stuck
  errorRun: 20, // this many failed results in a row: restart the model
  framesMs: 2000, // no camera frame this long: restart the camera
  graceMs: 2000, // after a (re)start, allow this long before judging
  maxRestarts: 4, // restarts of one kind within windowMs before giving up
  windowMs: 60000,
};

export class Watchdog {
  constructor(opts = {}) {
    this.opts = { ...WATCHDOG_DEFAULTS, ...opts };
    this.restarts = { model: [], camera: [] };
    this.reset(0);
  }

  /** Tracking (re)started at t: forget old timings, judge again after a grace. */
  reset(t) {
    this.since = t;
    this.lastFrame = t;
    this.lastResult = t;
    this.errors = 0;
    this.lastError = null;
  }

  frame(t) {
    this.lastFrame = t;
  }

  /** @param {string|null} error the model's error for this frame, if any */
  result(t, error = null) {
    this.lastResult = t;
    if (error) {
      this.errors++;
      this.lastError = error;
    } else {
      this.errors = 0;
    }
  }

  /** Paused, muted or hidden for a while: nothing is expected until it ends. */
  idle(t) {
    this.reset(t);
  }

  /**
   * @param {number} t now
   * @param {{pendingAge?:number, waiting?:boolean}} s pendingAge: age of the
   *   oldest unanswered request (ms, 0 if none); waiting: the camera is muted,
   *   the tab hidden, or a restart is in progress (judge nothing)
   * @returns {null | {what:'model'|'camera', reason:string}} what to restart;
   *   ask allow() before doing it
   */
  check(t, { pendingAge = 0, waiting = false } = {}) {
    if (waiting) {
      this.reset(t);
      return null;
    }
    if (t - this.since < this.opts.graceMs) return null;
    let what = null;
    let reason = '';
    if (t - this.lastFrame > this.opts.framesMs) {
      what = 'camera';
      reason = `no camera frames for ${Math.round(t - this.lastFrame)} ms`;
    } else if (pendingAge > this.opts.pendingMs) {
      what = 'model';
      reason = `a frame went unanswered for ${Math.round(pendingAge)} ms`;
    } else if (this.errors >= this.opts.errorRun) {
      what = 'model';
      reason = `the face model failed ${this.errors} times in a row: ${this.lastError}`;
    } else if (t - this.lastResult > this.opts.resultMs && t - this.lastFrame < 500) {
      // Frames still coming in, answers not: the model, not the camera.
      what = 'model';
      reason = `no result for ${Math.round(t - this.lastResult)} ms`;
    }
    return what ? { what, reason } : null;
  }

  /** The viewer asked to try again: forget earlier restarts. */
  forgive() {
    this.restarts = { model: [], camera: [] };
  }

  /**
   * May `what` be restarted now? Records the restart and restarts the clock
   * if so; false once maxRestarts happened within windowMs (give up).
   */
  allow(what, t) {
    const recent = this.restarts[what].filter((x) => t - x < this.opts.windowMs);
    this.restarts[what] = recent;
    if (recent.length >= this.opts.maxRestarts) return false;
    recent.push(t);
    this.reset(t);
    return true;
  }
}

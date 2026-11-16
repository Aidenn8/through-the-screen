import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Watchdog } from '../src/tracking/watchdog.js';

/** Healthy tracking at 30 fps from t0 to t1: frames and results every 33 ms. */
function healthy(w, t0, t1, { results = true, error = null } = {}) {
  for (let t = t0; t < t1; t += 33) {
    w.frame(t);
    if (results) w.result(t + 25, error);
    const r = w.check(t + 25, { pendingAge: results ? 25 : t + 25 - t0 });
    if (r && w.allow(r.what, t + 25)) return { t, r };
  }
  return null;
}

test('watchdog: healthy tracking is left alone', () => {
  const w = new Watchdog();
  assert.equal(healthy(w, 0, 60000), null);
});

test('watchdog: a request that is never answered restarts the model within a second', () => {
  const w = new Watchdog();
  healthy(w, 0, 5000);
  const hit = healthy(w, 5000, 8000, { results: false });
  assert.ok(hit, 'noticed');
  assert.equal(hit.r.what, 'model');
  assert.ok(hit.t - 5000 < 1000, `after ${hit.t - 5000} ms`);
});

test('watchdog: frames stop arriving -> restart the camera', () => {
  const w = new Watchdog();
  healthy(w, 0, 5000);
  let r = null;
  let t = 5000;
  for (; t < 10000 && !r; t += 100) r = w.check(t);
  assert.equal(r?.what, 'camera');
  assert.ok(t - 5000 <= 2200, `after ${t - 5000} ms`);
});

test('watchdog: a model that fails every frame is restarted; one failure is not', () => {
  const w = new Watchdog();
  healthy(w, 0, 3000);
  w.result(3010, 'boom');
  assert.equal(healthy(w, 3033, 6000), null, 'a single error is forgiven');
  const hit = healthy(w, 6000, 9000, { error: 'boom' });
  assert.equal(hit?.r.what, 'model');
  assert.match(hit.r.reason, /boom/);
});

test('watchdog: a muted camera or hidden tab is waited out, then judged afresh', () => {
  const w = new Watchdog();
  healthy(w, 0, 3000);
  for (let t = 3000; t < 20000; t += 250) assert.equal(w.check(t, { waiting: true }), null);
  // Back: the grace period applies before missing frames count.
  assert.equal(w.check(21000), null);
  assert.equal(w.check(22500)?.what, 'camera');
});

test('watchdog: restarts back off and give up instead of looping', () => {
  const w = new Watchdog();
  const actions = [];
  for (let t = 0; t < 60000; t += 100) {
    const r = w.check(t); // nothing ever arrives
    if (r) {
      if (!w.allow(r.what, t)) { actions.push('give-up'); break; }
      actions.push(r.what);
    }
  }
  assert.deepEqual(actions, ['camera', 'camera', 'camera', 'camera', 'give-up']);
});

test('watchdog: after giving up, a retry by the viewer gets a fresh restart budget', () => {
  const w = new Watchdog();
  let t = 0;
  for (; t < 60000; t += 100) { const r = w.check(t); if (r && !w.allow(r.what, t)) break; }
  assert.equal(w.allow('camera', t + 100), false, 'gave up');
  w.forgive();
  assert.equal(w.allow('camera', t + 200), true, 'the retry may restart again');
});

#!/usr/bin/env node
// Fault injection on the real app in headless Chrome with a fake webcam: does
// tracking come back on its own, and does the status pill say what happened?
//
// Each scenario opens a fresh page, waits until the face is tracked, injects
// one fault, then watches results, tracker state and the status text.
//
// Usage: node tools/core-faults.mjs --video face.y4m [--only name,name]
// Exit code 1 if any scenario fails to recover.

import { launch, watch, BASE } from './core-browser.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const VIDEO = arg('video');
const ONLY = arg('only') ? arg('only').split(',') : null;

const snap = (page) => page.evaluate(() => {
  const tr = window.__wd.app.tracker;
  return {
    state: tr?.state, eyes: tr?.eyes.state, results: tr?.stats.results ?? 0, framesIn: tr?.stats.framesIn ?? 0,
    busy: tr?.landmarker?.busy ?? null, status: document.querySelector('.status .label')?.textContent,
    tone: document.querySelector('.status')?.dataset.tone, camLive: tr?.cam?.track?.readyState ?? null,
  };
});

/** Poll for up to ms; record every distinct status text seen. */
async function watchFor(page, ms, until = null) {
  const seen = new Set();
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) {
    last = await snap(page);
    seen.add(`${last.tone}: ${last.status}`);
    if (until && until(last)) break;
    await page.waitForTimeout(100);
  }
  return { last, seen: [...seen], ms: Date.now() - t0 };
}

// What the status pill must say at some point while the fault is handled.
const EXPECT = {
  'worker-killed': /restarting face tracking|face tracking restarted/i,
  'worker-hangs': /restarting face tracking|face tracking restarted/i,
  'videoframe-throws-once': null, // one lost frame: nothing worth saying
  'detect-errors': /face tracking (error|problem)|restarting face tracking/i,
  'frames-stop': /restarting the camera|camera restarted/i,
  'track-ended': /restarting the camera|camera restarted/i,
  'track-muted': /camera (is )?paused|camera paused/i,
  'camera-gone': /restarting the camera/i,
};

// Scenarios that end with tracking given up on purpose: pass when the viewer
// is told and the view falls back to the mouse.
const GIVES_UP = new Set(['camera-gone']);

const SCENARIOS = {
  // A WebAssembly abort or out-of-memory kills the worker; no reply ever comes.
  'worker-killed': (page) => page.evaluate(() => window.__wd.app.tracker.landmarker.worker.terminate()),
  // The worker stays alive but never answers (a hang).
  'worker-hangs': (page) => page.evaluate(() => {
    const w = window.__wd.app.tracker.landmarker.worker;
    w.postMessage = (m, tr) => { if (m?.frame) m.frame.close(); };
  }),
  // One VideoFrame construction throws (camera reconfigured mid-frame).
  'videoframe-throws-once': (page) => page.evaluate(() => {
    const Real = window.VideoFrame;
    let once = true;
    window.VideoFrame = function VideoFrame(...a) { if (once) { once = false; throw new DOMException('simulated', 'InvalidStateError'); } return new Real(...a); };
  }),
  // The model throws on every frame for 2 s (results carry an error).
  'detect-errors': (page) => page.evaluate(() => {
    const lm = window.__wd.app.tracker.landmarker;
    const w = lm.worker;
    const until = performance.now() + 2000;
    const real = w.onmessage;
    w.onmessage = (e) => {
      if (e.data?.type === 'result' && performance.now() < until) {
        real.call(w, { data: { ...e.data, faces: [], matrices: [], error: 'simulated model failure' } });
      } else real.call(w, e);
    };
  }),
  // The camera stops delivering frames (driver stall): stop the track silently.
  'frames-stop': (page) => page.evaluate(() => { window.__wd.app.tracker.cam.track.stop(); }),
  // The OS ends the track (camera unplugged, taken by another app).
  'track-ended': (page) => page.evaluate(() => {
    const tr = window.__wd.app.tracker.cam.track;
    tr.stop();
    tr.dispatchEvent(new Event('ended'));
  }),
  // The camera is unplugged for good: every reopen fails. The watchdog must
  // give up after a few tries and say so, not retry forever.
  'camera-gone': (page) => page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Requested device not found', 'NotFoundError'));
    const tr = window.__wd.app.tracker.cam.track;
    tr.stop();
    tr.dispatchEvent(new Event('ended'));
  }),
  // The OS mutes the track for 2 s (lid closing, privacy shutter), then unmutes.
  'track-muted': async (page) => {
    await page.evaluate(() => window.__wd.app.tracker.cam.track.dispatchEvent(new Event('mute')));
    const during = await watchFor(page, 1500);
    await page.evaluate(() => window.__wd.app.tracker.cam.track.dispatchEvent(new Event('unmute')));
    return during;
  },
};

let failed = 0;
for (const [name, inject] of Object.entries(SCENARIOS)) {
  if (ONLY && !ONLY.includes(name)) continue;
  const { browser, context } = await launch({ video: VIDEO });
  await context.addInitScript(() => {
    try { localStorage.setItem('window-display:settings:v1', JSON.stringify({ inputMode: 'camera', started: true, cameraPreset: 'builtin-notch', motionVersion: 2 })); } catch { /* ignore */ }
  });
  const page = await context.newPage();
  const log = watch(page);
  await page.goto(`${BASE}?e2e&autostart=camera&scene=test-room`);
  await page.waitForFunction(() => window.__wd?.app?.tracker?.state === 'running' && window.__wd.app.tracker.eyes.state === 'tracking', null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const before = await snap(page);
  const during = await inject(page);
  const r = await watchFor(page, GIVES_UP.has(name) ? 14000 : 8000);
  // Recovered: new results after the fault, face tracked, status says so.
  const after = await snap(page);
  await page.waitForTimeout(1000);
  const later = await snap(page);
  const card = await page.evaluate(() => { const c = document.querySelector('.card'); return c && !c.hidden ? c.querySelector('h1')?.textContent : null; });
  const resumed = GIVES_UP.has(name)
    ? /stopped/i.test(card || '') && later.status === 'Following the mouse'
    : later.results > after.results && later.eyes === 'tracking' && later.tone === 'ok';
  const said = [...(during?.seen || []), ...r.seen].filter((s) => !/^ok: Following/.test(s));
  const want = EXPECT[name];
  const told = !want || said.some((x) => want.test(x));
  const ok = resumed && told;
  if (!ok) failed++;
  if (card) console.log(`      card: "${card}"`);
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(24)} results ${before.results} -> ${later.results} (+${later.results - after.results} in the last 1 s), state ${later.state}, eyes ${later.eyes}, status "${later.status}"`);
  console.log(`      status shown meanwhile: ${said.length ? said.join(' | ') : '(none besides ok)'}${told ? '' : `  <- expected ${want}`}`);
  const errs = log.filter((l) => /pageerror|\[error\]/.test(l) && !/XNNPACK|simulated/.test(l));
  if (errs.length) console.log(`      page errors: ${errs.slice(0, 3).join(' | ')}`);
  await browser.close();
}
// The model hangs in every new worker too, until the watchdog gives up; then
// the hang clears and the viewer presses Try again. Nothing may be left
// running, no restart may be reported as done when no result came, and the
// retry must work.
if (!ONLY || ONLY.includes('model-hangs-then-retry')) {
  const { browser, context } = await launch({ video: VIDEO });
  await context.addInitScript(() => {
    try { localStorage.setItem('window-display:settings:v1', JSON.stringify({ inputMode: 'camera', started: true, cameraPreset: 'builtin-notch', motionVersion: 2, ipdIrisMm: 63 })); } catch { /* ignore */ }
    window.__workers = { made: 0, ended: 0 };
    const Real = window.Worker;
    window.Worker = function Worker(...a) {
      const w = new Real(...a);
      window.__workers.made++;
      const term = w.terminate.bind(w);
      w.terminate = () => { window.__workers.ended++; term(); };
      const post = w.postMessage.bind(w);
      w.postMessage = (m, tr) => {
        if (m?.type === 'close') window.__workers.ended++;
        if (window.__hang && m?.type === 'frame') { m.frame.close(); return; }
        post(m, tr);
      };
      return w;
    };
  });
  const page = await context.newPage();
  watch(page);
  await page.goto(`${BASE}?e2e&autostart=camera&scene=test-room`);
  await page.waitForFunction(() => window.__wd?.app?.tracker?.eyes.state === 'tracking', null, { timeout: 30000 });
  await page.waitForTimeout(1000);
  await page.evaluate(() => { window.__hang = true; });
  const seen = new Set();
  const t0 = Date.now();
  let card = null;
  while (Date.now() - t0 < 25000) {
    const st = await page.evaluate(() => ({ s: document.querySelector('.status .label')?.textContent, card: (() => { const c = document.querySelector('.card'); return c && !c.hidden ? c.querySelector('h1')?.textContent : null; })() }));
    seen.add(st.s);
    if (st.card) { card = st.card; break; }
    await page.waitForTimeout(100);
  }
  const gaveUpAfter = (Date.now() - t0) / 1000;
  const w1 = await page.evaluate(() => ({ ...window.__workers, live: window.__wd.app.tracker.cam?.track?.readyState === 'live' }));
  const falseRestarted = [...seen].some((x) => /restarted/i.test(x || ''));
  await page.evaluate(() => { window.__hang = false; });
  await page.click('.card button:has-text("Try again")');
  await page.waitForTimeout(5000);
  const r0 = await snap(page);
  await page.waitForTimeout(4000);
  const r1 = await snap(page);
  const cardAfter = await page.evaluate(() => { const c = document.querySelector('.card'); return c && !c.hidden ? c.querySelector('h1')?.textContent : null; });
  const w2 = await page.evaluate(() => ({ ...window.__workers }));
  const ok = card === 'Face tracking stopped' && w1.made === w1.ended && !w1.live && !falseRestarted
    && r1.state === 'running' && r1.results > r0.results && r1.eyes === 'tracking' && !cardAfter && w2.made - w2.ended === 1;
  if (!ok) failed++;
  console.log(`${ok ? 'pass' : 'FAIL'}  model-hangs-then-retry   gave up after ${gaveUpAfter.toFixed(1)} s with "${card}"; workers made ${w1.made}, ended ${w1.ended}; camera live ${w1.live}; false "restarted": ${falseRestarted}`);
  console.log(`      after Try again: state ${r1.state}, results ${r0.results} -> ${r1.results} over 4 s, eyes ${r1.eyes}, card ${cardAfter ? `"${cardAfter}"` : 'none'}, workers alive ${w2.made - w2.ended}`);
  console.log(`      status shown: ${[...seen].join(' | ')}`);
  await browser.close();
}
process.exitCode = failed ? 1 : 0;

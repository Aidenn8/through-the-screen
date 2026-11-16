#!/usr/bin/env node
// Motion bench for EyeTrack (filter + prediction): stops, reversals, sway,
// stillness and short gaps, scored against ground truth at display time.
//
// Two sources:
//   corpus  - simulated head paths (random quick leans that stop dead, some
//             reversed straight away, sways, slow drifts) through a simulated
//             30 fps camera, ~30 ms inference and a 60 Hz render loop, with
//             per-frame noise (presets below).
//   replay  - the real landmarker output logged by tools/core-e2e.mjs on a
//             synthetic clip, replayed at 60 Hz exactly like the app. Stops,
//             reversals and still stretches are found from the clip's truth.
//
// Scores (mm, display coordinates, lateral unless marked z):
//   moving    RMS lateral error while the head moves (and the 1.2 s after)
//   over      how far the view runs past the point where the head stopped
//   rev       how far it runs past the turning point of a reversal
//   step      RMS frame-to-frame motion while the head is still (shimmer)
//   z std     depth wobble while still
//   gap       worst deviation caused by a 1 / 3 / 4 frame detection gap
//             during a 0.2 m/s pan, against the same run without the gap
//   wobble    std of the error around its mean on a steady pan (the trail
//             removed): how much the view shakes while the viewer pans,
//             e.g. while filming; mean of 8 seeds
//
// Real-like scenario (the first real-camera test, realLike()): FaceTime
// camera in a dim room at 30 and 15 fps, 48 ms camera delay, motion blur,
// dim-room noise, a seated head's sway and micro-corrections on top of
// leans and stops. Scores: past (how far the view goes beyond the farthest
// point the head reached around a stop), lag to 90 % of a 15 cm lean, sway
// response (share of the sway the view repeats; speed and micro-correction
// variants), frame-to-frame step and jerk (second difference per render
// frame) while still and on steady pans.
//
// A tracking log recorded in the app (details panel, Record tracking log)
// replays with --replay file.json: scored against a smoothed copy of the
// raw eye, since there is no ground truth.
//
// Usage:
//   node tools/core-motion.mjs [--variants file.json] [--track module.js]
//     [--replay log.json:truth.json | --replay tracking-log.json ...]
//     [--view look|window --strength 3 [--turn on|off --turn-strength 1]]
//     [--only real,corpus,turn] [--hidden 0]
//     [--noise real] [--true-delay 30] [--quick] [--check]
// variants.json: [["name", {EyeTrack options}], ...]; options are merged
// over the app's defaults (motionOptions(settings): Smooth follow).
// --check exits non-zero unless Smooth follow meets FOLLOW_TARGETS and
// Predict ahead ({mode: 'predict'}) meets the corpus TARGETS.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cameraToDisplay } from '../src/core/display.js';
import { motionOptions, DEFAULTS as SETTINGS } from '../src/app/settings.js';
import { EyeTrack as AppEyeTrack } from '../src/tracking/predictor.js';
import { ViewMapper, viewGain } from '../src/tracking/view-map.js';
import { turnPoint } from '../src/tracking/head-turn.js';

let EyeTrack = AppEyeTrack;

/** Per-frame noise std (m) of the eye point. */
export const NOISE = {
  clean: { x: 0.00009, y: 0.00036, z: 0.0026 }, // the clean synthetic clip
  real: { x: 0.0005, y: 0.0006, z: 0.006 }, // plausible for a real webcam at 60 cm
  dim: { x: 0.00023, y: 0.00058, z: 0.0037 }, // review's degraded clip, dim light, 60 cm
  far: { x: 0.001, y: 0.0027, z: 0.008 }, // review's degraded clip at 95 cm
  bad: { x: 0.001, y: 0.0012, z: 0.012 }, // dim light, glasses, ~1 m
  // A dim room on the built-in camera, as in the first real test: the
  // review's dim-light numbers x 1.5 (higher gain; motion blur is simulated
  // separately with exposureMs).
  dimRoom: { x: 0.00035, y: 0.00087, z: 0.0056 },
};

/**
 * The first real test: FaceTime camera in a dim room, camera delay measured
 * at 48 ms (and saved, so the app assumes 48), ~30 ms inference, 60 Hz
 * render; the camera exposes for most of each frame (motion blur), at 30 fps
 * or, as dim rooms make it, 15 fps.
 */
export function realLike(fps = 30, extra = {}) {
  return { fps, hiddenMs: 48, cameraDelayMs: 48, inferMs: 30, noise: NOISE.dimRoom, exposureMs: 0.9 * (1000 / fps), ...extra };
}

/** What the app's defaults must reach on the corpus (review finding 1). */
export const TARGETS = { over: 10, overP90: 25, moving: 15.9, step: 0.131, zStd: 4.95, wobble: 1.3 };

function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  const u = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return (s + 0.5) / 4294967296; };
  const g = () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
  return { u, g };
}
const rms = (a) => (a.length ? Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length) : NaN);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mj = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : 10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5);

/** App defaults: what App#applyMotionSettings configures. */
export function appTrack(extra = {}) {
  return { ...motionOptions(SETTINGS), ...extra };
}

/**
 * The view mapping (o.view = { direction, strength }) about a fixed rest
 * point where the viewer sits: what the tracker feeds the eye track once the
 * rest point is settled (it is frozen during quick moves). Identity without
 * o.view. Truth is scored in the mapped space.
 */
export function viewed(o = {}, rest = { x: 0, y: 0, z: 0.6 }) {
  if (!o.view) return (p) => p;
  // No clamps here: they keep the app's viewpoint where the scenes hold up,
  // and are not what this bench scores.
  const vm = new ViewMapper({ limits: { x: 9, yMin: -9, yMax: 9, zMin: -9, zMax: 9, xPerZ: Infinity, yPerZ: Infinity } });
  return (p) => vm.map(p, o.view, rest);
}

/** The earlier default (One Euro + look-ahead 0.8 with the brake), as tuned. */
export function predictTrack(extra = {}) {
  return appTrack({ mode: 'predict', ...extra });
}

// ------------------------------------------------------------------ corpus

/** Random realistic head motion, 1 ms lookup. */
export function makeCorpus(seed = 3, durS = 120) {
  const R = rng(seed);
  const segs = [];
  const stops = [];
  let t = 1.0;
  let cur = { x: 0, y: 0, z: 0.6 };
  while (t < durS - 3) {
    const r = R.u();
    if (r < 0.55) {
      const dx = (R.u() < 0.5 ? -1 : 1) * (0.1 + 0.15 * R.u());
      const to = { x: Math.max(-0.2, Math.min(0.2, cur.x + dx)), y: cur.y + (R.u() - 0.5) * 0.04, z: Math.max(0.42, Math.min(0.8, cur.z + (R.u() - 0.5) * 0.12)) };
      const T = 0.3 + 0.9 * R.u();
      segs.push({ a: t, b: t + T, from: cur, to, kind: 'lean' });
      stops.push({ t: t + T, from: cur, to });
      cur = to;
      t += T;
      if (R.u() < 0.3) {
        const back = { x: cur.x - 0.6 * dx, y: cur.y, z: cur.z };
        const T2 = 0.3 + 0.5 * R.u();
        segs.push({ a: t, b: t + T2, from: cur, to: back, kind: 'lean' });
        stops.push({ t: t + T2, from: cur, to: back });
        cur = back;
        t += T2;
      }
      t += 0.4 + 1.6 * R.u();
    } else if (r < 0.8) {
      const amp = 0.04 + 0.08 * R.u();
      const f = 0.3 + 0.7 * R.u();
      const n = 2 + Math.floor(R.u() * 3);
      segs.push({ a: t, b: t + n / f, from: cur, to: cur, kind: 'sway', amp, f });
      t += n / f + 0.6;
    } else {
      const v = (R.u() < 0.5 ? -1 : 1) * (0.005 + 0.02 * R.u());
      const T = 2 + 2 * R.u();
      const to = { x: cur.x + v * T, y: cur.y, z: cur.z };
      segs.push({ a: t, b: t + T, from: cur, to, kind: 'drift' });
      cur = to;
      t += T + 0.5;
    }
  }
  const N = Math.ceil(durS * 1000) + 1;
  const X = new Float64Array(N); const Y = new Float64Array(N); const Z = new Float64Array(N);
  const still = new Uint8Array(N);
  let p = { x: 0, y: 0, z: 0.6 };
  let si = 0;
  for (let i = 0; i < N; i++) {
    const ts = i / 1000;
    while (si < segs.length && ts >= segs[si].b) { p = segs[si].kind === 'sway' ? segs[si].from : segs[si].to; si++; }
    const s = segs[si];
    let q = p;
    let moving = false;
    if (s && ts >= s.a && ts < s.b) {
      moving = true;
      const u = (ts - s.a) / (s.b - s.a);
      if (s.kind === 'sway') {
        const e = Math.max(0, Math.min(1, (ts - s.a) / 0.3, (s.b - ts) / 0.3));
        q = { x: s.from.x + s.amp * Math.sin(2 * Math.PI * s.f * (ts - s.a)) * e, y: s.from.y, z: s.from.z };
      } else if (s.kind === 'drift') {
        q = { x: s.from.x + (s.to.x - s.from.x) * u, y: s.from.y, z: s.from.z };
      } else {
        const m = mj(u);
        q = { x: s.from.x + (s.to.x - s.from.x) * m, y: s.from.y + (s.to.y - s.from.y) * m, z: s.from.z + (s.to.z - s.from.z) * m };
      }
    }
    X[i] = q.x; Y[i] = q.y; Z[i] = q.z;
    still[i] = moving ? 0 : 1;
  }
  const lastMove = new Float64Array(N);
  let lm = -1e9;
  for (let i = 0; i < N; i++) { if (!still[i]) lm = i; lastMove[i] = lm; }
  const idx = (tMs) => Math.max(0, Math.min(N - 1, Math.round(tMs)));
  return {
    durMs: durS * 1000,
    at: (tMs) => { const i = idx(tMs); return { x: X[i], y: Y[i], z: Z[i] }; },
    stillFor: (tMs) => { const i = idx(tMs); return still[i] ? i - lastMove[i] : 0; },
    stops: stops.map((s) => ({ tMs: s.t * 1000, to: s.to, dir: Math.sign(s.to.x - s.from.x), dist: Math.abs(s.to.x - s.from.x) })),
  };
}

/**
 * Simulated pipeline. Camera exposes at k/fps; Chrome stamps it hiddenMs
 * later; the result arrives ~inferMs after that; the app pushes it stamped
 * (stamp - cameraDelayMs) and renders at renderHz for t + 1.5 vsync + 5.
 * @param {object} o { track, Track, fps, renderHz, hiddenMs (true delay),
 *   cameraDelayMs (assumed), inferMs, noise, seed, missAt(te), missRate,
 *   displayLatencyMs }
 */
export function simulate(path, durMs, o = {}) {
  const Track = o.Track || EyeTrack;
  const tr = new Track(o.track || appTrack());
  const V = viewed(o);
  if (o.view) {
    const g = viewGain(o.view);
    tr.setGain?.({ x: Math.abs(g.x), y: Math.abs(g.y), xy: Math.abs(g.x), z: Math.abs(g.z) });
    const raw = path;
    path = (t) => V(raw(t));
    o = { ...o, noise: o.noise && { x: o.noise.x * Math.abs(g.x), y: o.noise.y * Math.abs(g.y), z: o.noise.z * Math.abs(g.z) } };
  }
  const fps = o.fps ?? 30;
  const vsync = 1000 / (o.renderHz ?? 60);
  const hidden = o.hiddenMs ?? 30;
  const assumed = o.cameraDelayMs ?? 30;
  const inferMs = o.inferMs ?? 30;
  const R = rng(o.seed ?? 11);
  const noise = o.noise || { x: 0, y: 0, z: 0 };
  // Motion blur: the landmarks see the head averaged over the exposure.
  const exp = o.exposureMs ?? 0;
  const seen = exp > 0 ? (te) => {
    const q = { x: 0, y: 0, z: 0 };
    for (let j = 0; j < 5; j++) { const a = path(te + exp * (j / 4 - 0.5)); q.x += a.x / 5; q.y += a.y / 5; q.z += a.z / 5; }
    return q;
  } : path;
  const res = [];
  for (let k = 1; k * (1000 / fps) < durMs; k++) {
    const te = k * (1000 / fps) + R.g();
    const p = seen(te);
    const miss = (o.missAt && o.missAt(te)) || (o.missRate ? R.u() < o.missRate : false);
    res.push({ tc: te + hidden, ta: te + hidden + Math.max(12, inferMs + 4 * R.g()), miss,
      p: { x: p.x + R.g() * noise.x, y: p.y + R.g() * noise.y, z: p.z + R.g() * noise.z } });
  }
  res.sort((a, b) => a.ta - b.ta);
  const lead = 1.5 * vsync + 5;
  const dispLat = o.displayLatencyMs ?? lead;
  const frames = [];
  let i = 0;
  for (let t = 0; t < durMs; t += vsync) {
    while (i < res.length && res[i].ta <= t) {
      const r = res[i++];
      if (r.miss) tr.miss(r.tc - assumed); else tr.push(r.tc - assumed, r.p);
    }
    const p = tr.sample(t + lead);
    frames.push({ t: t + dispLat, p: { ...p }, state: tr.state });
  }
  return frames;
}

export function scoreCorpus(corpus, o = {}) {
  const frames = simulate(corpus.at, corpus.durMs, o);
  const moving = [];
  const steps = [];
  const z = [];
  let prev = null;
  for (const f of frames) {
    if (f.t < 2000) continue;
    const g = corpus.at(f.t);
    const settled = corpus.stillFor(f.t) >= 1200;
    if (!settled) moving.push(Math.hypot(f.p.x - g.x, f.p.y - g.y) * 1000);
    else {
      if (prev?.settled) steps.push(Math.hypot(f.p.x - prev.p.x, f.p.y - prev.p.y) * 1000);
      z.push((f.p.z - g.z) * 1000);
    }
    prev = { p: f.p, settled };
  }
  const overs = [];
  for (const s of corpus.stops) {
    if (s.dist < 0.05) continue;
    const w = frames.filter((f) => f.t >= s.tMs - 50 && f.t < s.tMs + 600);
    if (w.length) overs.push(Math.max(0, ...w.map((f) => (f.p.x - s.to.x) * s.dir * 1000)));
  }
  return { moving: rms(moving), movingP95: pct(moving, 0.95), over: mean(overs), overP90: pct(overs, 0.9), overMax: Math.max(...overs), step: rms(steps), zStd: std(z), nStops: overs.length };
}

/** Corpus scores averaged over seeds (the review's three corpora by default). */
export function scoreCorpora(o = {}, seeds = [3, 17, 29]) {
  const rs = seeds.map((s, i) => scoreCorpus(makeCorpus(s), { noise: NOISE.real, seed: 100 + i, ...o }));
  const out = {};
  for (const k of Object.keys(rs[0])) out[k] = k === 'overMax' ? Math.max(...rs.map((r) => r[k])) : mean(rs.map((r) => r[k]));
  return out;
}

/** A single 15 cm lean taking T seconds, then still: overshoot (mm). */
export function leanOvershoot(T, o = {}) {
  const t0 = 1500;
  const path = (t) => ({ x: 0.15 * mj((t - t0) / (T * 1000)), y: 0, z: 0.6 });
  const frames = simulate(path, t0 + T * 1000 + 1500, o);
  return Math.max(...frames.filter((f) => f.t >= t0).map((f) => f.p.x - 0.15)) * 1000;
}

/** Constant speed v, a 120 ms turn, back at -v: overshoot past the turning point (mm). */
export function reversalOvershoot(v, o = {}) {
  const t0 = 1500; const tA = t0 + 800; const turn = 120;
  const ss = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
  const vel = (t) => (t < t0 ? 0 : t < tA ? v : t < tA + turn ? v * (1 - 2 * ss((t - tA) / turn)) : t < tA + turn + 800 ? -v : 0);
  const xs = []; let x = 0; for (let t = 0; t <= tA + 2600; t++) { xs.push(x); x += vel(t) / 1000; }
  const path = (t) => ({ x: xs[Math.max(0, Math.min(xs.length - 1, Math.round(t)))], y: 0, z: 0.6 });
  const frames = simulate(path, tA + 2600, o);
  return (Math.max(...frames.map((f) => f.p.x)) - Math.max(...xs)) * 1000;
}

/**
 * Detections missing for gapMs (camera frames whose exposure falls in
 * [2000, 2000 + gapMs)) during a 0.2 m/s pan: worst deviation from the run
 * without the gap (mm). 0 ms gap = 0; one frame is ~33 ms.
 */
export function gapHitch(gapMs, o = {}) {
  const path = (t) => ({ x: -0.2 + 0.2 * Math.max(0, t - 1000) / 1000, y: 0, z: 0.6 });
  const base = simulate(path, 3500, o);
  const gap = simulate(path, 3500, { ...o, missAt: (te) => te > 1995 && te < 1995 + gapMs });
  let worst = 0;
  for (let k = 0; k < base.length; k++) worst = Math.max(worst, Math.abs(gap[k].p.x - base[k].p.x) * 1000);
  return worst;
}
export const missHitch = (o = {}) => gapHitch(30, o);

/**
 * Steady pan at `speed` m/s for 6 s with per-frame noise (y 1.2x, z 12x):
 * mean error (trail, negative = behind) and the std around it (wobble), mm,
 * averaged over 8 seeds. Before the brake (look-ahead 100 %) the wobble at
 * 0.2 m/s and 0.5 mm noise was 1.05 mm (review of the fix round).
 */
export function panWobble(speed, noise, o = {}) {
  let trail = 0;
  let wobble = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const path = (t) => ({ x: -0.3 + (speed * t) / 1000, y: 0, z: 0.6 });
    const fr = simulate(path, 6000, { noise: { x: noise, y: 1.2 * noise, z: 12 * noise }, seed, ...o }).filter((f) => f.t > 2000);
    const e = fr.map((f) => (f.p.x - path(f.t).x) * 1000);
    trail += mean(e) / 8;
    wobble += std(e) / 8;
  }
  return { trail, wobble };
}

/** Corpus scores plus pan wobble at 0.2 m/s, 0.5 mm noise: everything TARGETS covers. */
export function scoreAll(o = {}, seeds) {
  return { ...scoreCorpora(o, seeds), wobble: panWobble(0.2, NOISE.real.x, o).wobble };
}

/** Head still at 60 cm for 12 s with the given noise: shimmer and depth wobble. */
export function stillHead(noise, o = {}) {
  const frames = simulate(() => ({ x: 0, y: 0, z: 0.6 }), 12000, { noise, ...o });
  const f = frames.filter((x) => x.t > 2000);
  const steps = [];
  for (let k = 1; k < f.length; k++) steps.push(Math.hypot(f[k].p.x - f[k - 1].p.x, f[k].p.y - f[k - 1].p.y) * 1000);
  return { step: rms(steps), zStd: std(f.map((x) => x.p.z * 1000)), yStd: std(f.map((x) => x.p.y * 1000)) };
}

// ------------------------------------------------- seated sway (real-like)

/**
 * A seated head that is "still", as an offset (m) from where the viewer
 * sits. Postural sway: five sinusoids per axis, 0.1-1 Hz (log-uniform),
 * amplitude falling as f^-0.5 like body sway, scaled so each axis moves like
 * one sinusoid of `ampMm` (x and depth) or half that (height).
 * Micro-corrections (`micro`): every 2-5 s the head shifts 1-3 mm in
 * 0.15-0.35 s (minimum jerk) and relaxes back over ~1.5 s.
 */
export function makeSway(seed = 1, ampMm = 3, { micro = true, sway = true } = {}) {
  const R = rng(seed);
  const axes = {};
  for (const [k, gain] of [['x', 1], ['y', 0.5], ['z', 1]]) {
    const comps = [];
    for (let i = 0; i < 5; i++) { const f = 0.1 * 10 ** R.u(); comps.push({ f, a: f ** -0.5, ph: 2 * Math.PI * R.u() }); }
    const norm = sway ? (ampMm / 1000) * gain / Math.sqrt(comps.reduce((q, c) => q + c.a * c.a, 0)) : 0;
    for (const c of comps) c.a *= norm;
    axes[k] = comps;
  }
  const events = [];
  for (let t = 1000 + 2000 * R.u(); micro && t < 4e5; t += 2000 + 3000 * R.u()) {
    const mag = (1 + 2 * R.u()) / 1000;
    const th = 2 * Math.PI * R.u();
    events.push({ t, T: 150 + 200 * R.u(), m: { x: mag * Math.cos(th), y: 0.5 * mag * Math.sin(th), z: mag * (R.u() - 0.5) }, mag });
  }
  const f = (t) => {
    const s = (t / 1000) * 2 * Math.PI;
    const q = {};
    for (const k of ['x', 'y', 'z']) { let v = 0; for (const c of axes[k]) v += c.a * Math.sin(c.f * s + c.ph); q[k] = v; }
    for (const e of events) {
      if (e.t > t) break;
      if (t - e.t > 9000) continue;
      const u = (t - e.t) / e.T;
      const w = u < 1 ? mj(u) : Math.exp(-(t - e.t - e.T) / 1500);
      for (const k of ['x', 'y', 'z']) q[k] += e.m[k] * w;
    }
    return q;
  };
  f.events = events;
  return f;
}

/**
 * Deliberate leans (8-20 cm sideways, some height and depth, 0.5-1.2 s,
 * minimum jerk) separated by 2-5 s of sitting still, with the seated sway
 * on top all the time. `leans` keep the sway-free path for scoring.
 */
export function makeLeanCorpus(seed = 5, durS = 90, ampMm = 3) {
  const R = rng(seed);
  const sway = makeSway(seed + 1000, ampMm);
  const leans = [];
  let cur = { x: 0, y: 0, z: 0.6 };
  for (let t = 2500 + 2000 * R.u(); t < durS * 1000 - 4000;) {
    const d = (0.08 + 0.12 * R.u()) * (Math.abs(cur.x) > 0.1 ? -Math.sign(cur.x) : R.u() < 0.5 ? -1 : 1);
    const to = { x: cur.x + d, y: Math.max(-0.05, Math.min(0.05, cur.y + (R.u() - 0.5) * 0.04)), z: Math.max(0.45, Math.min(0.75, cur.z + (R.u() - 0.5) * 0.08)) };
    const T = 500 + 700 * R.u();
    leans.push({ a: t, b: t + T, from: cur, to });
    cur = to;
    t += T + 2000 + 3000 * R.u();
  }
  const base = (t) => {
    let p = { x: 0, y: 0, z: 0.6 };
    for (const l of leans) {
      if (t < l.a) break;
      if (t >= l.b) { p = l.to; continue; }
      const m = mj((t - l.a) / (l.b - l.a));
      return { x: l.from.x + (l.to.x - l.from.x) * m, y: l.from.y + (l.to.y - l.from.y) * m, z: l.from.z + (l.to.z - l.from.z) * m };
    }
    return p;
  };
  const at = (t) => { const b = base(t); const w = sway(t); return { x: b.x + w.x, y: b.y + w.y, z: b.z + w.z }; };
  return { durMs: durS * 1000, at, base, leans };
}

const dirOf = (l) => { const dx = l.to.x - l.from.x; const dy = l.to.y - l.from.y; const n = Math.hypot(dx, dy); return { x: dx / n, y: dy / n, n }; };
const along = (p, u) => p.x * u.x + p.y * u.y;
/** First time (ms) at or after t0 that f(t) >= level, scanning frames. */
const crossing = (frames, t0, level, u) => frames.find((f) => f.t >= t0 && along(f.p, u) >= level)?.t ?? NaN;

/**
 * Leans with sway on top. Per lean:
 *   past   how far the view goes beyond the farthest point the head itself
 *          reached (sway included) from 0.1 s before the stop to 1.2 s
 *          after, along the lean (mm; 0 = never past the head)
 *   lag    time from the head (sway-free path) reaching 90 % of the lean to
 *          the view reaching it (ms)
 *   moving RMS sideways error during the leans and 0.5 s after (mm)
 */
export function scoreLeans(corpus, o = {}) {
  const frames = simulate(corpus.at, corpus.durMs, o);
  const V = viewed(o);
  const at = (t) => V(corpus.at(t));
  const past = [];
  const lag = [];
  const moving = [];
  for (const l0 of corpus.leans) {
    const l = { ...l0, from: V(l0.from), to: V(l0.to) };
    const u = dirOf(l);
    let gmax = -Infinity;
    for (let t = l.b - 100; t <= l.b + 1200; t += 5) gmax = Math.max(gmax, along(at(t), u));
    const w = frames.filter((f) => f.t >= l.b - 100 && f.t <= l.b + 1200);
    if (w.length) past.push(Math.max(0, (Math.max(...w.map((f) => along(f.p, u))) - gmax) * 1000));
    const level = along(l.from, u) + 0.9 * u.n;
    let tg = l.a;
    while (along(V(corpus.base(tg)), u) < level) tg += 1;
    lag.push(crossing(frames, l.a, level, u) - tg);
    for (const f of frames) if (f.t >= l.a && f.t < l.b + 500) { const g = at(f.t); moving.push(Math.hypot(f.p.x - g.x, f.p.y - g.y) * 1000); }
  }
  return { past: mean(past), pastMax: Math.max(...past), lag: mean(lag.filter(Number.isFinite)), moving: rms(moving), n: past.length };
}

/** A single 15 cm sideways lean taking T s, with sway and the scenario's noise: lag to 90 % (ms) and how far past the head (mm), mean over seeds. */
export function leanLag(T = 0.6, o = {}, seeds = [1, 2, 3, 4, 5, 6]) {
  const lags = [];
  const pasts = [];
  for (const seed of seeds) {
    const t0 = 2500;
    const sway = makeSway(seed + 50, o.swayMm ?? 3);
    const base = (t) => ({ x: 0.15 * mj((t - t0) / (T * 1000)), y: 0, z: 0.6 });
    const path = (t) => { const b = base(t); const w = sway(t); return { x: b.x + w.x, y: b.y + w.y, z: b.z + w.z }; };
    const fr = simulate(path, t0 + T * 1000 + 2000, { seed: 200 + seed, ...o });
    const V = viewed(o);
    const a = V(base(0)).x;
    const b = V(base(t0 + T * 1000)).x;
    const u = { x: Math.sign(b - a), y: 0 };
    const level = u.x * (a + 0.9 * (b - a));
    let tg = t0;
    while (u.x * V(base(tg)).x < level) tg += 1;
    lags.push(crossing(fr, t0, level, u) - tg);
    let gmax = -Infinity;
    for (let t = t0; t <= t0 + T * 1000 + 1500; t += 5) gmax = Math.max(gmax, u.x * V(path(t)).x);
    pasts.push(Math.max(0, (Math.max(...fr.filter((f) => f.t >= t0).map((f) => u.x * f.p.x)) - gmax) * 1000));
  }
  return { lag: mean(lags), past: mean(pasts), pastMax: Math.max(...pasts) };
}

/** Frame-to-frame steps and jerk (second difference) of the rendered eye, sideways, per render frame (mm). */
function frameSmoothness(frames) {
  const st = [];
  const jk = [];
  for (let k = 2; k < frames.length; k++) {
    const [a, b, c] = [frames[k - 2].p, frames[k - 1].p, frames[k].p];
    st.push(Math.hypot(c.x - b.x, c.y - b.y) * 1000);
    jk.push(Math.hypot(c.x - 2 * b.x + a.x, c.y - 2 * b.y + a.y) * 1000);
  }
  return { step: rms(st), stepStd: std(st), jerk: rms(jk) };
}

/**
 * Sitting "still" for 60 s with sway (swayMm) and micro-corrections: how
 * much of the head's sideways motion the view repeats (response: rendered
 * std over head std; 0 = none, 1 = all), for the sway alone, the
 * micro-corrections alone (each one's largest view move within a second,
 * over its size) and both together; frame-to-frame step and jerk with both;
 * depth response. Mean over seeds.
 */
export function swayResponse(o = {}, seeds = [1, 2, 3]) {
  const acc = { response: 0, speed: 0, swayOnly: 0, micro: 0, zResponse: 0, step: 0, jerk: 0 };
  const n = seeds.length;
  const v = (a, k) => std(a.map((q) => q[k])) ** 2;
  // Speed over 100 ms (6 render frames): what reads as the view swinging.
  const speed = (a) => rms(a.slice(6).map((q, i) => Math.hypot(q.x - a[i].x, q.y - a[i].y)));
  const run = (seed, opts) => {
    const sway = makeSway(seed, o.swayMm ?? 3, opts);
    const path = (t) => { const w = sway(t); return { x: w.x, y: w.y, z: 0.6 + w.z }; };
    // 10 s to settle (the first anchor lands wherever the sway was), then 60 s.
    const fr = simulate(path, 70000, { seed: 300 + seed, ...o }).filter((f) => f.t > 10000);
    const V = viewed(o);
    return { sway, path, fr, g: fr.map((f) => V(path(f.t))), P: fr.map((f) => f.p) };
  };
  for (const seed of seeds) {
    const both = run(seed, {});
    acc.response += Math.sqrt((v(both.P, 'x') + v(both.P, 'y')) / (v(both.g, 'x') + v(both.g, 'y'))) / n;
    acc.speed += speed(both.P) / speed(both.g) / n;
    acc.zResponse += Math.sqrt(v(both.P, 'z') / v(both.g, 'z')) / n;
    const sm = frameSmoothness(both.fr);
    acc.step += sm.step / n;
    acc.jerk += sm.jerk / n;
    const sw = run(seed, { micro: false });
    acc.swayOnly += Math.sqrt((v(sw.P, 'x') + v(sw.P, 'y')) / (v(sw.g, 'x') + v(sw.g, 'y'))) / n;
    const mc = run(seed, { sway: false });
    const r = [];
    for (const e of mc.sway.events) {
      if (e.t < 11000 || e.t > 68000) continue;
      const g = viewGain(o.view || {});
      const u = { x: e.m.x * Math.sign(g.x), y: e.m.y * Math.sign(g.y) };
      const un = Math.hypot(u.x, u.y);
      const w = mc.fr.filter((f) => f.t >= e.t && f.t < e.t + 1000);
      if (w.length < 10) continue;
      const p0 = along(w[0].p, u) / un;
      r.push(Math.max(...w.map((f) => along(f.p, u) / un - p0)) / (un * Math.abs(g.x)));
    }
    acc.micro += mean(r) / n;
  }
  return acc;
}

/**
 * A steady sideways pan at `speed` m/s for 6 s with the scenario's noise:
 * std of the frame-to-frame step (a smooth pan moves the same each frame),
 * jerk, and trail and wobble (mean and std of the error), mm, 6 seeds.
 */
export function panSmoothness(speed, o = {}) {
  const acc = { stepStd: 0, jerk: 0, trail: 0, wobble: 0 };
  const n = 6;
  for (let seed = 1; seed <= n; seed++) {
    const path = (t) => ({ x: -0.3 + (speed * t) / 1000, y: 0, z: 0.6 });
    const fr = simulate(path, 6000, { seed, ...o }).filter((f) => f.t > 2000);
    const sm = frameSmoothness(fr);
    const V = viewed(o);
    const sg = Math.sign(viewGain(o.view || {}).x);
    const e = fr.map((f) => sg * (f.p.x - V(path(f.t)).x) * 1000);
    acc.stepStd += sm.stepStd / n;
    acc.jerk += sm.jerk / n;
    acc.trail += mean(e) / n;
    acc.wobble += std(e) / n;
  }
  return acc;
}

/** Everything the real-like table reports, for one track and frame rate. */
export function scoreRealLike(track, fps, { quick = false, extra = {} } = {}) {
  const sim = realLike(fps, { track, ...extra });
  const corpora = (quick ? [5] : [5, 23]).map((sd) => scoreLeans(makeLeanCorpus(sd), { ...sim, seed: 400 + sd }));
  const leans = { past: mean(corpora.map((r) => r.past)), pastMax: Math.max(...corpora.map((r) => r.pastMax)), lag: mean(corpora.map((r) => r.lag)), moving: mean(corpora.map((r) => r.moving)) };
  const lean15 = leanLag(0.6, sim, quick ? [1, 2] : undefined);
  const quick15 = leanLag(0.4, sim, quick ? [1, 2] : undefined);
  const sway = swayResponse(sim, quick ? [1] : undefined);
  const pan = panSmoothness(0.1, sim);
  const pan2 = panSmoothness(0.2, sim);
  return { leans, lean15, quick15, sway, pan, pan2 };
}

/** What Smooth follow (the app default) must reach in the real-like scenario. */
export const FOLLOW_TARGETS = { past: 2, lag30: 250, swayResponse: 0.3 };

// ------------------------------------------------------ head turn (real-like)

/** Per-frame noise std (degrees) of the head pose from the facial transformation matrix. */
export const POSE_NOISE = { low: 0.5, mid: 0.75, high: 1.0 };

/** The default Look around view with head turn on (or off). */
export const lookView = (turnOn = true, extra = {}) => ({ direction: 'look', strength: 3, turn: { on: turnOn, strength: 1 }, ...extra });

/**
 * A seated head: neck pivot at `seat`, turned by yaw(t) and pitch(t)
 * (degrees, display terms) about it, with the seated sway on the pivot and a
 * slow sway of the pose itself (poseSwayDeg rms). The tracked eye sits
 * `pivot` from the neck (the right eye: lat to the right, forward toward the
 * screen, up), so turning moves it as a real head would. Returns
 * t -> { x, y, z, yaw, pitch }, display metres and degrees.
 */
export function seatedHead({ yaw = () => 0, pitch = () => 0, seed = 1, swayMm = 3, micro = true, poseSwayDeg = 0.5,
  seat = { x: 0, y: -0.045, z: 0.68 }, pivot = { lat: 0.0315, forward: 0.08, up: 0.075 }, rest = { yaw: 0, pitch: -4 } } = {}) {
  const sway = makeSway(seed, swayMm, { micro, sway: swayMm > 0 });
  const R = rng(seed + 77);
  const comps = [0, 1].map(() => [0, 1, 2].map(() => ({ f: 0.1 * 10 ** R.u(), ph: 2 * Math.PI * R.u() })));
  const angSway = (i, t) => (poseSwayDeg * Math.SQRT2 / Math.sqrt(3)) * comps[i].reduce((s, c) => s + Math.sin(2 * Math.PI * c.f * t / 1000 + c.ph), 0);
  const r = { x: pivot.lat, y: pivot.up, z: -pivot.forward };
  return (t) => {
    const w = sway(t);
    const a = { yaw: rest.yaw + yaw(t) + angSway(0, t), pitch: rest.pitch + pitch(t) + angSway(1, t) };
    const e = turnPoint(r, a.yaw, a.pitch);
    return { x: seat.x + w.x + e.x, y: seat.y + w.y + e.y, z: seat.z + w.z + e.z, yaw: a.yaw, pitch: a.pitch };
  };
}

/**
 * The app's path for a moving head with pose: camera at fps with motion
 * blur, noise on the eye (o.noise) and on the pose (o.poseNoise, degrees),
 * hidden and assumed camera delay, inference, then ViewMapper.step (rest
 * point, rest pose, head turn) and EyeTrack (Smooth follow), drawn at
 * 60 Hz. path(t) -> { x, y, z, yaw, pitch }. Frames: { t, p, state }, p in
 * view space (clamped like Tracker.sample).
 */
export function simulateTurn(path, durMs, o = {}) {
  const tr = new EyeTrack(o.track || appTrack());
  const vm = new ViewMapper(o.mapper || {});
  const view = o.view || lookView();
  const fps = o.fps ?? 30;
  const vsync = 1000 / 60;
  const hidden = o.hiddenMs ?? 30;
  const assumed = o.cameraDelayMs ?? 30;
  const inferMs = o.inferMs ?? 30;
  const R = rng(o.seed ?? 11);
  const noise = o.noise || { x: 0, y: 0, z: 0 };
  const pn = o.poseNoise ?? 0;
  const exp = o.exposureMs ?? 0;
  const seen = (te) => {
    if (!(exp > 0)) return path(te);
    const q = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    for (let j = 0; j < 5; j++) { const a = path(te + exp * (j / 4 - 0.5)); for (const k of Object.keys(q)) q[k] += a[k] / 5; }
    return q;
  };
  const res = [];
  for (let k = 1; k * (1000 / fps) < durMs; k++) {
    const te = k * (1000 / fps) + R.g();
    const p = seen(te);
    const miss = !!(o.missAt && o.missAt(te));
    res.push({ tc: te + hidden, ta: te + hidden + Math.max(12, inferMs + 4 * R.g()), miss,
      p: { x: p.x + R.g() * noise.x, y: p.y + R.g() * noise.y, z: p.z + R.g() * noise.z },
      pose: { yaw: p.yaw + R.g() * pn, pitch: p.pitch + R.g() * pn } });
  }
  res.sort((a, b) => a.ta - b.ta);
  const lead = 1.5 * vsync + 5;
  const frames = [];
  let i = 0;
  for (let t = 0; t < durMs; t += vsync) {
    while (i < res.length && res[i].ta <= t) {
      const r = res[i++];
      const ts = r.tc - assumed;
      if (r.miss) { tr.miss(ts); continue; }
      const m = vm.step(ts, r.p, o.viewAt ? o.viewAt(ts) : view, r.pose, o.lat ?? 0.0315);
      if (m.shift) tr.shift(m.shift, 600, m.offset);
      tr.setGain(m.gain);
      tr.push(ts, m.p, { offset: m.offset });
    }
    frames.push({ t: t + lead, p: vm.clamp(tr.sample(t + lead)), state: tr.state });
  }
  frames.vm = vm;
  return frames;
}

/**
 * Shimmer of a drawn stretch (mm, x and y together): the RMS of what is left
 * after a centred 0.5 s moving average (slow drift, such as the dead-band
 * re-centring, removed), plus frame-to-frame step and jerk.
 */
export function shimmer(frames) {
  const r = [];
  const w = 15;
  for (let i = w; i < frames.length - w; i++) {
    let x = 0; let y = 0;
    for (let j = i - w; j <= i + w; j++) { x += frames[j].p.x; y += frames[j].p.y; }
    r.push(Math.hypot(frames[i].p.x - x / (2 * w + 1), frames[i].p.y - y / (2 * w + 1)) * 1000);
  }
  return { ...frameSmoothness(frames), hf: rms(r) };
}

/**
 * Tilt the head back by `deg` (look up; negative looks down) over T ms
 * (minimum jerk) at 6 s and hold it for 10 s, with the seated sway, a slow
 * sway of the pose and the real-like noise (30 fps unless o.fps); axis 'yaw'
 * turns right instead (negative: left). Scored against the same head mapped
 * without noise, delay or pose filtering (a ViewMapper fed every 5 ms), in
 * view space along the move. Mean over seeds:
 *   offset  how far that ideal view moved (mm), and drawn: how far the view did
 *   lag     the ideal view at 90 % of its move -> the drawn view there (ms);
 *           lag50 the same at half way
 *   past    how far the drawn view went beyond the farthest point the ideal
 *           view reached, from the start of the move to 1.5 s after (mm);
 *           back: on the way back from its peak (a glance down goes up and
 *           comes back), how far it swung past where it then rests: the
 *           lowest point in the 1 s after the peak against the mean of the
 *           second after that (meaningful with o.swayMm 0, o.micro false and
 *           o.poseSwayDeg 0; mm, worst seed); peak: the ideal view's largest
 *           excursion (mm)
 *   hold    shimmer while held (from 3 s after the stop, when Smooth follow
 *           has settled), before: while still before the tilt (shimmer());
 *           holdOff: the same head and noise with head turn off (what the
 *           position path alone shows; seated sway at 4.5x up and down)
 *   zMove   depth change of the drawn view, held minus before (mm)
 */
export function tiltHold(o = {}, seeds = [1, 2, 3, 4]) {
  const deg = o.deg ?? 15;
  const T = o.T ?? 500;
  const t0 = 6000;
  const tStop = t0 + T;
  const dur = tStop + 10000;
  const axis = o.axis ?? 'pitch';
  const ramp = (t) => deg * mj((t - t0) / T);
  const k = axis === 'pitch' ? 'y' : 'x';
  const view = o.view || lookView();
  const acc = { offset: 0, drawn: 0, lag: 0, past: 0, pastMax: 0, back: 0, peak: 0, hold: { step: 0, jerk: 0, hf: 0 }, holdOff: { step: 0, jerk: 0, hf: 0 }, before: { step: 0, jerk: 0, hf: 0 }, zMove: 0 };
  const n = seeds.length;
  for (const seed of seeds) {
    const path = seatedHead({ seed, [axis]: ramp, pivot: o.pivot, poseSwayDeg: o.poseSwayDeg ?? 0.5, swayMm: o.swayMm ?? 3, micro: o.micro ?? true });
    const sim = { ...realLike(o.fps ?? 30), poseNoise: o.poseNoise ?? POSE_NOISE.mid, mapper: o.mapper, seed: 500 + seed };
    const fr = simulateTurn(path, dur, { ...sim, view });
    const off = shimmer(simulateTurn(path, dur, { ...sim, view: { ...view, turn: { ...view.turn, on: false } } }).filter((f) => f.t > tStop + 3000));
    for (const q of ['step', 'jerk', 'hf']) acc.holdOff[q] += off[q] / n;
    const ideal = new ViewMapper({ ...o.mapper, turn: { ...o.mapper?.turn, smoothMs: 1, holdDeg: 0, holdNoise: 0, glanceSmoothMs: 1, glanceHoldDeg: 0 } });
    const ref = [];
    for (let t = 0; t < dur; t += 5) {
      const p = path(t);
      ref.push({ t, p: ideal.step(t, p, view, { yaw: p.yaw, pitch: p.pitch }, 0.0315).p });
    }
    const val = (f) => f.p[k];
    const r0 = mean(ref.filter((f) => f.t > t0 - 2500 && f.t < t0).map(val));
    const r1 = mean(ref.filter((f) => f.t > tStop + 300 && f.t < tStop + 1500).map(val));
    // Along the ideal view's largest excursion (a glance down goes up and comes back).
    const moving = ref.filter((f) => f.t >= t0 && f.t <= tStop + 1500);
    const ext = moving.reduce((m, f) => (Math.abs(val(f) - r0) > Math.abs(m) ? val(f) - r0 : m), 0);
    const u = Math.sign(ext) || -1;
    const cross = (frames, share) => frames.find((f) => f.t >= t0 && u * (val(f) - (r0 + share * (r1 - r0))) >= 0)?.t ?? NaN;
    const tr = cross(ref, 0.9);
    const tv = cross(fr, 0.9);
    acc.lag50 = (acc.lag50 ?? 0) + (cross(fr, 0.5) - cross(ref, 0.5)) / n;
    const refMax = Math.max(...moving.map((f) => u * val(f)));
    const drawnTo = fr.filter((f) => f.t >= t0 && f.t <= tStop + 1500);
    const past = Math.max(0, Math.max(...drawnTo.map((f) => u * val(f))) - refMax) * 1000;
    // On the way back from a peak (a glance), never past where the ideal view settles.
    const tPeak = drawnTo.reduce((m, f) => (u * val(f) > u * val(m) ? f : m), drawnTo[0]).t;
    const settled = mean(fr.filter((f) => f.t >= tPeak + 1000 && f.t <= tPeak + 2000).map((f) => u * val(f)));
    const back = Math.max(0, settled - Math.min(...fr.filter((f) => f.t >= tPeak && f.t <= tPeak + 1000).map((f) => u * val(f)))) * 1000;
    acc.back = Math.max(acc.back, back);
    acc.peak += (Math.abs(ext) * 1000) / n;
    const before = fr.filter((f) => f.t > t0 - 3000 && f.t < t0);
    const hold = fr.filter((f) => f.t > tStop + 3000);
    const d0 = mean(before.map(val));
    const d1 = mean(hold.map(val));
    const sh = shimmer(hold);
    const sb = shimmer(before);
    acc.offset += (Math.abs(r1 - r0) * 1000) / n;
    acc.drawn += (Math.abs(d1 - d0) * 1000) / n;
    acc.lag += (tv - tr) / n;
    acc.past += past / n;
    acc.pastMax = Math.max(acc.pastMax, past);
    for (const q of ['step', 'jerk', 'hf']) { acc.hold[q] += sh[q] / n; acc.before[q] += sb[q] / n; }
    acc.zMove += ((mean(hold.map((f) => f.p.z)) - mean(before.map((f) => f.p.z))) * 1000) / n;
  }
  return acc;
}

/**
 * Sitting still for 30 s (sway, pose sway, real-like noise and pose noise):
 * shimmer() of the drawn view and its std (mm, x and y together), with head
 * turn on or off (o.view).
 */
export function stillWithPose(o = {}, seeds = [1, 2, 3]) {
  const acc = { step: 0, jerk: 0, hf: 0, std: 0 };
  for (const seed of seeds) {
    const fr = simulateTurn(seatedHead({ seed, poseSwayDeg: o.poseSwayDeg ?? 0.5 }), 40000,
      { ...realLike(o.fps ?? 30), poseNoise: o.poseNoise ?? POSE_NOISE.mid, view: o.view, mapper: o.mapper, seed: 600 + seed }).filter((f) => f.t > 10000);
    const sh = shimmer(fr);
    for (const q of ['step', 'jerk', 'hf']) acc[q] += sh[q] / seeds.length;
    acc.std += (Math.hypot(std(fr.map((f) => f.p.x)), std(fr.map((f) => f.p.y))) * 1000) / seeds.length;
  }
  return acc;
}

/**
 * What head turn must keep to (--check): no swing past, no added jitter while
 * still or held. Shimmer within 10 % of head turn off, plus 5 micrometres (a
 * pixel of the 15-inch Air is about 110).
 */
export const TURN_TARGETS = { past: 2, stillRatio: 1.1, stillSlackMm: 0.005 };

/** The head-turn cases the bench reports and checks. */
export const TURN_CASES = [
  ['tilt up 15 deg in 0.5 s', { axis: 'pitch', deg: 15 }],
  ['look down 15 deg', { axis: 'pitch', deg: -15 }],
  ['turn right 20 deg', { axis: 'yaw', deg: 20 }],
  ['turn left 20 deg', { axis: 'yaw', deg: -20 }],
  ['quick tilt 25 deg in 0.3 s', { axis: 'pitch', deg: 25, T: 300 }],
  ['slow tilt 15 deg in 1.5 s', { axis: 'pitch', deg: 15, T: 1500 }],
  ['keyboard glance 25 deg 0.3 s', { axis: 'pitch', deg: -25, T: 300 }],
  ['look down 30 deg in 0.5 s', { axis: 'pitch', deg: -30 }],
];

/**
 * Head turn against TURN_TARGETS; returns the failures. Every case at 1 deg
 * pose noise: never past the ideal view. Held, with the head's own pose sway
 * off (so only noise could add anything), and sitting still: no more
 * shimmer than with head turn off.
 */
export function missedTurnTargets(quick = false) {
  const out = [];
  const seeds = quick ? [1, 2] : undefined;
  const within = (on, off) => on <= off * TURN_TARGETS.stillRatio + TURN_TARGETS.stillSlackMm;
  for (const [name, o] of TURN_CASES) {
    const r = tiltHold({ ...o, poseNoise: POSE_NOISE.high }, seeds);
    if (!(r.pastMax <= TURN_TARGETS.past)) out.push(`${name}: past the ideal view ${f1(r.pastMax)} mm > ${TURN_TARGETS.past}`);

  }
  // Glances down: back to where the ideal view settles without swinging past it (no sway, so only the return shows).
  for (const [name, o] of TURN_CASES.filter(([, c]) => c.deg <= -25)) {
    const r = tiltHold({ ...o, poseNoise: POSE_NOISE.high, swayMm: 0, micro: false, poseSwayDeg: 0 }, seeds);
    if (!(r.pastMax <= TURN_TARGETS.past)) out.push(`${name}, no sway: past the ideal view ${f1(r.pastMax)} mm > ${TURN_TARGETS.past}`);
    if (!(r.back <= TURN_TARGETS.past)) out.push(`${name}: swung ${f1(r.back)} mm past where it rests on the way back (> ${TURN_TARGETS.past})`);
    if (!(r.drawn <= 20)) out.push(`${name}: held ${f1(r.drawn, 0)} mm from where it started (a glance should come back)`);
  }
  for (const [name, o] of TURN_CASES.slice(0, 4)) {
    const r = tiltHold({ ...o, poseNoise: POSE_NOISE.high, poseSwayDeg: 0 }, seeds);
    for (const k of ['step', 'jerk', 'hf']) {
      if (!within(r.hold[k], r.holdOff[k])) out.push(`${name}, held: ${k} ${f1(r.hold[k], 4)} mm with head turn, ${f1(r.holdOff[k], 4)} without`);
    }
  }
  for (const pn of [POSE_NOISE.low, POSE_NOISE.high]) {
    const off = stillWithPose({ poseNoise: pn, view: lookView(false) }, quick ? [1] : undefined);
    const on = stillWithPose({ poseNoise: pn, view: lookView(true) }, quick ? [1] : undefined);
    for (const k of ['step', 'jerk', 'hf']) {
      if (!within(on[k], off[k])) out.push(`still ${k} at ${pn} deg pose noise: ${f1(on[k], 4)} mm with head turn, ${f1(off[k], 4)} without`);
    }
  }
  return out;
}

// ------------------------------------------------------------------ replay

export function loadReplay(logPath, truthPath) {
  const data = JSON.parse(readFileSync(logPath, 'utf8'));
  const truth = JSON.parse(readFileSync(truthPath, 'utf8'));
  const N = truth.frames.length;
  const fps = truth.fps;
  const camPos = data.camPos;
  const all = data.log.results;
  const tagged = all.filter((r) => Number.isInteger(r.tag) && r.tag < N);
  const key = tagged.find((r) => r.mode)?.mode === 'left' ? 'left' : 'right';
  // Loop start times: capture time of frame 0 of each pass.
  const starts = [];
  let cur = [];
  let prevTag = -1;
  const flush = () => { if (cur.length > 10) { const s = cur.map((r) => r.t - (r.tag * 1000) / fps).sort((a, b) => a - b); starts.push(s[s.length >> 1]); } };
  for (const r of tagged) { if (r.tag < prevTag) { flush(); cur = []; } cur.push(r); prevTag = r.tag; }
  flush();
  const truthAt = (tv) => {
    const f = tv * fps; const i = Math.max(0, Math.min(N - 2, Math.floor(f))); const u = Math.min(1, Math.max(0, f - i));
    const a = truth.frames[i][key]; const b = truth.frames[i + 1][key];
    return cameraToDisplay({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u }, camPos);
  };
  const lightAt = (tv) => truth.frames[Math.max(0, Math.min(N - 1, Math.round(tv * fps)))].light?.gain ?? 1;
  // Events from the truth (video time, s): stops and reversals of x.
  const dt = 1 / fps;
  const vx = (tv) => (truthAt(tv + dt / 2).x - truthAt(tv - dt / 2).x) / dt;
  const speed = (tv) => { const a = truthAt(tv - dt / 2); const b = truthAt(tv + dt / 2); return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / dt; };
  const stops = [];
  const revs = [];
  const T = N / fps;
  for (let tv = 0.3; tv < T - 0.4; tv += 0.005) {
    const before = Math.max(...[0.05, 0.1, 0.15, 0.2].map((d) => Math.abs(vx(tv - d))));
    if (before > 0.15 && Math.abs(vx(tv)) < 0.01 && Math.abs(vx(tv + 0.15)) < 0.005 && Math.abs(vx(tv + 0.3)) < 0.005) {
      if (!stops.length || tv - stops.at(-1).tv > 0.5) stops.push({ tv, x: truthAt(tv + 0.3).x, dir: Math.sign(truthAt(tv).x - truthAt(tv - 0.3).x) });
    }
    if (vx(tv) > 0 !== vx(tv + 0.005) > 0 && Math.abs(vx(tv - 0.12)) > 0.1 && Math.abs(vx(tv + 0.12)) > 0.1) {
      if (!revs.length || tv - revs.at(-1).tv > 0.3) revs.push({ tv, x: truthAt(tv).x, dir: Math.sign(vx(tv - 0.1)) });
    }
  }
  // Still for a while (1.5 s; 0.35 s for the short hold far away), by condition.
  const stillFor = (tv, s) => { for (let d = 0; d <= s; d += 0.05) if (speed(tv - d) > 0.003) return false; return true; };
  const stillCond = (tv) => {
    if (!stillFor(tv, 0.35)) return null;
    if (truthAt(tv).z > 0.85) return 'far';
    if (!stillFor(tv, 1.5)) return null;
    return lightAt(tv) < 0.7 ? 'dim' : 'near';
  };
  return { name: logPath.split('/').at(-1), camPos, all, starts, truthAt, stops, revs, stillCond, speed, N, fps };
}

export function scoreReplay(rp, o = {}) {
  const Track = o.Track || EyeTrack;
  const tr = new Track(o.track || appTrack());
  const hidden = o.hiddenMs ?? 0;
  const lead = 1.5 * 16.667 + 5;
  const all = rp.all;
  const out = [];
  let i = 0;
  for (let t = all[0].arrived; t < all.at(-1).arrived; t += 16.667) {
    while (i < all.length && all[i].arrived + hidden <= t) {
      const r = all[i++];
      if (r.eye && r.faces > 0) tr.push(r.t, cameraToDisplay(r.eye, rp.camPos));
      else tr.miss(r.t);
    }
    const tShow = t + lead;
    const p = tr.sample(tShow);
    const k = rp.starts.findLastIndex((s) => s <= tShow);
    if (k < 0 || t < all[0].arrived + 1500) continue;
    const tv = (tShow - rp.starts[k]) / 1000;
    if (tv > rp.N / rp.fps - 0.05) continue;
    out.push({ tv, k, p: { ...p } });
  }
  for (const f of out) f.g = rp.truthAt(f.tv);
  const overAt = (ev, w0, w1) => {
    const r = [];
    for (let k = 0; k < rp.starts.length; k++) {
      const w = out.filter((f) => f.k === k && f.tv >= ev.tv + w0 && f.tv < ev.tv + w1);
      if (w.length > 10) r.push(Math.max(...w.map((f) => (f.p.x - ev.x) * ev.dir * 1000)));
    }
    return r;
  };
  const overs = rp.stops.flatMap((s) => overAt(s, -0.05, 0.6));
  const revs = rp.revs.flatMap((s) => overAt(s, -0.1, 0.4));
  const moving = out.filter((f) => rp.speed(f.tv) > 0.03).map((f) => Math.hypot(f.p.x - f.g.x, f.p.y - f.g.y) * 1000);
  const still = {};
  for (let j = 1; j < out.length; j++) {
    const a = out[j - 1]; const b = out[j];
    if (a.k !== b.k) continue;
    const c = rp.stillCond(b.tv);
    if (!c) continue;
    still[c] ??= { steps: [], z: [] };
    still[c].steps.push(Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y) * 1000);
    still[c].z.push((b.p.z - b.g.z) * 1000);
  }
  const s = (c) => (still[c] ? { step: rms(still[c].steps), zStd: std(still[c].z) } : { step: NaN, zStd: NaN });
  return { over: mean(overs), overMax: Math.max(...overs), rev: mean(revs), revMax: Math.max(...revs), moving: rms(moving), near: s('near'), dim: s('dim'), far: s('far'), nStops: overs.length, nRevs: revs.length };
}

// ------------------------------------------------------- recorded log replay

/**
 * A tracking log recorded in the app (details panel, Record tracking log;
 * src/app/recorder.js), or null if the file is something else. There is no
 * ground truth: scores compare against a zero-phase smoothed copy of the
 * raw eye samples (Gaussian, sigma 40 ms), which is close to where the head
 * really was and has no delay.
 */
export function loadRecorded(path) {
  const d = JSON.parse(readFileSync(path, 'utf8'));
  if (d.kind !== 'window-display tracking log') return null;
  const rows = (arr, fields) => arr.map((a) => Object.fromEntries(fields.map((k, i) => [k, a[i]])));
  const P = (a) => (a ? { x: a[0], y: a[1], z: a[2] } : null);
  const samples = rows(d.samples, d.sampleFields).map((s) => ({
    ...s, cam: P(s.cam), disp: P(s.disp), win: P(s.win), view: P(s.view), rest: P(s.rest),
    pose: Array.isArray(s.pose) ? { yaw: s.pose[0], pitch: s.pose[1] } : null,
  }));
  const frames = rows(d.frames, d.frameFields).map((f) => ({ ...f, eye: P(f.eye), win: P(f.win), target: P(f.target), filtered: P(f.filtered) }));
  const good = samples.filter((s) => s.disp && s.faces > 0);
  const sigma = 40;
  const proxy = (t) => {
    let w = 0;
    const q = { x: 0, y: 0, z: 0 };
    for (const s of good) {
      const dt = s.ts - t;
      if (dt < -3 * sigma) continue;
      if (dt > 3 * sigma) break;
      const k = Math.exp(-0.5 * (dt / sigma) ** 2);
      w += k;
      q.x += k * s.disp.x; q.y += k * s.disp.y; q.z += k * s.disp.z;
    }
    return w > 0.3 ? { x: q.x / w, y: q.y / w, z: q.z / w } : null;
  };
  const fpsList = samples.map((s) => s.cameraFps).filter(Number.isFinite);
  return { name: path.split('/').at(-1), meta: d, samples, frames, good, proxy, cameraFps: fpsList.length ? fpsList[fpsList.length >> 1] : null };
}

/** Rendered stream vs the proxy truth: smoothness, sway while still, stops, lag. */
function scoreAgainstProxy(rec, out) {
  const sm = frameSmoothness(out);
  const pts = out.map((f) => ({ ...f, g: rec.proxy(f.tShow) })).filter((f) => f.g);
  const speed = (i) => {
    const a = pts[Math.max(0, i - 6)]; const b = pts[Math.min(pts.length - 1, i + 6)];
    const dt = (b.tShow - a.tShow) / 1000;
    return dt > 0 ? Math.hypot(b.g.x - a.g.x, b.g.y - a.g.y) / dt : 0;
  };
  const sp = pts.map((_, i) => speed(i));
  // Still: proxy under 2 cm/s, from 0.6 s after it slowed down (the view
  // finishing a lean is lag, not sway) for at least 1 s more; response =
  // rendered std / head std, per stretch.
  const stills = [];
  let run = [];
  const flush = () => {
    const r = run.filter((f) => f.tShow >= (run[0]?.tShow ?? 0) + 600);
    if (r.length && r.at(-1).tShow - r[0].tShow >= 1000) stills.push(r);
    run = [];
  };
  pts.forEach((f, i) => { if (sp[i] < 0.02) run.push(f); else flush(); });
  flush();
  let vr = 0; let vg = 0;
  for (const r of stills) {
    for (const k of ['x', 'y']) {
      vr += std(r.map((f) => f.p[k])) ** 2 * r.length;
      vg += std(r.map((f) => f.g[k])) ** 2 * r.length;
    }
  }
  // Stops: faster than 10 cm/s within the last 300 ms, then under 2 cm/s for 300 ms.
  const past = [];
  for (let i = 1; i < pts.length; i++) {
    if (!(sp[i] < 0.02 && sp[i - 1] >= 0.02)) continue;
    const t = pts[i].tShow;
    const before = pts.filter((f, j) => f.tShow > t - 300 && f.tShow < t && sp[j] > 0.1);
    const after = pts.filter((f, j) => f.tShow >= t && f.tShow < t + 300 && sp[j] >= 0.02);
    if (!before.length || after.length) continue;
    const a = before[0].g; const b = pts[i].g;
    const n = Math.hypot(b.x - a.x, b.y - a.y);
    if (n < 0.02) continue;
    const u = { x: (b.x - a.x) / n, y: (b.y - a.y) / n };
    const w = pts.filter((f) => f.tShow >= t - 100 && f.tShow <= t + 1200);
    past.push(Math.max(0, (Math.max(...w.map((f) => along(f.p, u))) - Math.max(...w.map((f) => along(f.g, u)))) * 1000));
  }
  // Lag: the delay that best lines the rendered path up with the proxy while moving.
  const moving = pts.filter((_, i) => sp[i] > 0.05);
  let lag = NaN; let best = Infinity;
  for (let d = 0; d <= 500 && moving.length > 20; d += 5) {
    let e = 0; let n = 0;
    for (const f of moving) { const g = rec.proxy(f.tShow - d); if (g) { e += (f.p.x - g.x) ** 2 + (f.p.y - g.y) ** 2; n++; } }
    if (n && e / n < best) { best = e / n; lag = d; }
  }
  return {
    step: sm.step, jerk: sm.jerk, stillResponse: vg > 0 ? Math.sqrt(vr / vg) : NaN, stillS: stills.reduce((s, r) => s + (r.at(-1).tShow - r[0].tShow) / 1000, 0),
    past: past.length ? mean(past) : NaN, pastMax: past.length ? Math.max(...past) : NaN, nStops: past.length, lag,
    moving: rms(moving.map((f) => Math.hypot(f.p.x - f.g.x, f.p.y - f.g.y) * 1000)),
  };
}

/**
 * Replay a recorded log through a track, at the recorded render times, with
 * results arriving when they arrived. By default the view is the exact
 * window (so scores are in head millimetres); o.view maps like the app.
 */
export function scoreRecorded(rec, o = {}) {
  const Track = o.Track || EyeTrack;
  const tr = new Track(o.track || appTrack());
  const vm = new ViewMapper();
  const view = o.view || { direction: 'window', strength: 1 };
  const S = rec.samples;
  const out = [];
  let i = 0;
  for (const f of rec.frames) {
    while (i < S.length && S[i].arrived <= f.t) {
      const s = S[i++];
      if (s.disp && s.faces > 0) {
        const m = vm.step(s.ts, s.disp, view, s.pose, s.mode === 'left' ? -0.0315 : s.mode === 'right' ? 0.0315 : 0);
        if (m.shift) tr.shift(m.shift, 600, m.offset);
        tr.setGain?.(m.gain);
        tr.push(s.ts, m.p, { offset: m.offset });
      } else tr.miss(s.ts);
    }
    out.push({ t: f.t, tShow: f.tShow, p: vm.clamp(tr.sample(f.tShow)) });
  }
  return scoreAgainstProxy(rec, out);
}

/** The rendered stream as recorded (in whatever view the app was using). */
export function scoreRecordedAsIs(rec) {
  return scoreAgainstProxy(rec, rec.frames.filter((f) => f.eye).map((f) => ({ t: f.t, tShow: f.tShow, p: f.eye })));
}

// ------------------------------------------------------------------ main

const f1 = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '-');

/** Does a corpus score meet the review's targets? Returns the failures. */
export function missedTargets(r) {
  const out = [];
  for (const [k, lim] of Object.entries(TARGETS)) if (!(r[k] <= lim)) out.push(`${k} ${f1(r[k], 3)} > ${lim}`);
  return out;
}

/** Smooth follow (app defaults) against FOLLOW_TARGETS and the look-ahead 0 baseline; returns the failures. */
export function missedFollowTargets(quick = false) {
  const out = [];
  const r30 = scoreRealLike(appTrack(), 30, { quick });
  const b30 = scoreRealLike(predictTrack({ predictGain: 0 }), 30, { quick });
  if (!(r30.leans.pastMax <= FOLLOW_TARGETS.past && r30.lean15.past <= FOLLOW_TARGETS.past)) out.push(`past stop ${f1(r30.leans.pastMax)} / ${f1(r30.lean15.past)} mm > ${FOLLOW_TARGETS.past}`);
  if (!(r30.lean15.lag <= FOLLOW_TARGETS.lag30)) out.push(`lag ${f1(r30.lean15.lag, 0)} ms > ${FOLLOW_TARGETS.lag30}`);
  if (!(r30.sway.response <= FOLLOW_TARGETS.swayResponse)) out.push(`sway response ${f1(r30.sway.response, 2)} > ${FOLLOW_TARGETS.swayResponse}`);
  for (const k of ['jerk', 'stepStd']) if (!(r30.pan[k] < b30.pan[k] / 2)) out.push(`pan ${k} ${f1(r30.pan[k], 3)} not under half of look-ahead 0 (${f1(b30.pan[k], 3)})`);
  if (!(r30.sway.jerk < b30.sway.jerk / 2)) out.push(`still jerk ${f1(r30.sway.jerk, 3)} not under half of look-ahead 0 (${f1(b30.sway.jerk, 3)})`);
  return out;
}

const REAL_HEAD = 'variant'.padEnd(26) + ' fps | past stop mean max | lean 15 cm: lag ms past | lag 0.4 s | sway resp speed micro | still step jerk | pan .1 m/s stepStd jerk trail | pan .2 jerk | moving';
function realRow(name, fps, r) {
  return `${name.padEnd(26)} ${String(fps).padStart(3)} | ${f1(r.leans.past).padStart(14)} ${f1(r.leans.pastMax).padStart(4)} | ${f1(r.lean15.lag, 0).padStart(15)} ${f1(r.lean15.past).padStart(4)} | ${f1(r.quick15.lag, 0).padStart(9)} | ${(f1(100 * r.sway.response, 0) + '%').padStart(10)} ${(f1(100 * r.sway.speed, 0) + '%').padStart(5)} ${(f1(100 * r.sway.micro, 0) + '%').padStart(5)} | ${f1(r.sway.step, 3).padStart(10)} ${f1(r.sway.jerk, 3)} | ${f1(r.pan.stepStd, 3).padStart(18)} ${f1(r.pan.jerk, 3)} ${f1(r.pan.trail).padStart(5)} | ${f1(r.pan2.jerk, 3).padStart(11)} | ${f1(r.leans.moving).padStart(6)}`;
}

async function main() {
  const argv = process.argv.slice(2);
  const args = (k) => argv.flatMap((a, i) => (a === `--${k}` ? [argv[i + 1]] : []));
  const arg = (k, d) => args(k)[0] ?? d;
  const flag = (k) => argv.includes(`--${k}`);
  if (arg('track')) EyeTrack = (await import(pathToFileURL(resolve(arg('track'))).href)).EyeTrack;
  const variants = arg('variants') ? JSON.parse(readFileSync(arg('variants'), 'utf8')) : [
    ['Smooth follow, window 1x', {}],
    ['old default (predict 0.8)', { mode: 'predict' }],
    ['look-ahead 0 (user test)', { mode: 'predict', predictGain: 0 }],
  ];
  const quick = flag('quick');
  const sections = arg('only', 'real,corpus,turn').split(',');
  const replays = [];
  const recorded = [];
  for (const s of args('replay')) {
    const [l, t] = s.split(':');
    if (t) replays.push(loadReplay(l, t));
    else { const r = loadRecorded(l); if (r) recorded.push(r); else console.log(`${l}: not a tracking log (record one in the app: D, Record tracking log)`); }
  }
  const view = arg('view') ? {
    direction: arg('view'), strength: Number(arg('strength', arg('view') === 'look' ? 3 : 1)),
    turn: { on: arg('turn', 'on') !== 'off', strength: Number(arg('turn-strength', 1)) },
  } : null;

  if (sections.includes('real') && !flag('replay-only')) {
    console.log('real-like: FaceTime camera in a dim room (the first real test): camera delay 48 ms (measured, so assumed 48),');
    console.log('  inference ~30 ms, 60 Hz render, dim-room noise x 0.35 / y 0.87 / z 5.6 mm, exposure 90 % of the frame, seated sway 3 mm');
    console.log('  + micro-corrections on top of every lean and stop. mm in view space; lag = head at 90 % of the lean -> view at 90 %.');
    console.log(REAL_HEAD);
    for (const fps of [30, 15]) {
      for (const [name, opts] of variants) console.log(realRow(name, fps, scoreRealLike(appTrack(opts), fps, { quick })));
      console.log(realRow('Smooth follow, look 3x *', fps, scoreRealLike(appTrack(), fps, { quick, extra: { view: { direction: 'look', strength: 3 } } })));
    }
    console.log('* the app default. Other rows: true window at 1x. Only the default row is in view space at 3x (lag and % compare directly; mm are tripled).');
    console.log(`targets for Smooth follow at 30 fps: past stop <= ${FOLLOW_TARGETS.past} mm, lag <= ${FOLLOW_TARGETS.lag30} ms, sway response <= ${100 * FOLLOW_TARGETS.swayResponse} %, pan and still jerk under half of look-ahead 0`);
  }

  if (sections.includes('corpus') && !flag('replay-only')) {
    const noiseName = arg('noise', 'real');
    const trueDelay = Number(arg('true-delay', 30));
    const seeds = quick ? [3] : [3, 17, 29];
    const W = Math.max(...variants.map(([n]) => n.length), 12);
    console.log(`\ncorpus (first tuning): ${seeds.length} x 120 s, noise ${noiseName}; true camera delay ${trueDelay} ms (app assumes 30), inference 30 ms, 60 Hz render`);
    console.log(`targets for Predict ahead: over mean <= ${TARGETS.over}, p90 <= ${TARGETS.overP90}, moving <= ${TARGETS.moving}, still step <= ${TARGETS.step}, z std <= ${TARGETS.zStd}, pan wobble (0.2 m/s, 0.5 mm) <= ${TARGETS.wobble}`);
    console.log(`${'variant'.padEnd(W)} | corpus moving  p95 | over mean  p90  max | still step  z std | lean 0.4/0.6/1.0 s | rev 0.2/0.3 m/s | gap 1/3/4 fr | still step clean/dim/far | z std far | pan trail/wobble .2@.5 .1@.5 .2@.1`);
    for (const [name, opts] of variants) {
      const track = appTrack(opts);
      const sim = { track, hiddenMs: trueDelay };
      const r = scoreCorpora({ ...sim, noise: NOISE[noiseName] }, seeds);
      const lean = [0.4, 0.6, 1.0].map((T) => leanOvershoot(T, sim));
      const rev = [0.2, 0.3].map((v) => reversalOvershoot(v, sim));
      const gaps = [30, 95, 130].map((ms) => gapHitch(ms, sim));
      const st = ['clean', 'dim', 'far'].map((n) => stillHead(NOISE[n], sim));
      const pans = [[0.2, 0.0005], [0.1, 0.0005], [0.2, 0.0001]].map(([v, n]) => panWobble(v, n, sim));
      console.log(`${name.padEnd(W)} | ${f1(r.moving).padStart(13)} ${f1(r.movingP95).padStart(4)} | ${f1(r.over).padStart(9)} ${f1(r.overP90).padStart(4)} ${f1(r.overMax).padStart(4)} | ${f1(r.step, 3).padStart(10)} ${f1(r.zStd, 2).padStart(6)} | ${lean.map((x) => f1(x, 0)).join(' / ').padStart(18)} | ${rev.map((x) => f1(x, 0)).join(' / ').padStart(15)} | ${gaps.map((x) => f1(x, 1)).join(' / ').padStart(12)} | ${st.map((x) => f1(x.step, 3)).join(' / ')} | ${f1(st[2].zStd, 2).padStart(9)} | ${pans.map((x) => `${f1(x.trail)}/${f1(x.wobble, 2)}`).join('  ')}`);
    }
  }

  if (sections.includes('turn') && !flag('replay-only')) {
    const seeds = quick ? [1, 2] : undefined;
    const sh = (s) => `${f1(s.step, 3)} / ${f1(s.jerk, 4)} / ${f1(s.hf, 3)}`;
    console.log('\nhead turn: Look around 3x with head turn on at 1x, the real-like scenario at 30 fps (dim-room noise, 48 ms camera delay,');
    console.log('  seated sway and micro-corrections), the eye turning with the head about a neck pivot 8 cm behind and 7.5 cm below it,');
    console.log('  0.5 deg rms of slow pose sway, pose noise per frame as given. "ideal": the same head mapped with no noise, delay or pose');
    console.log('  filtering; drawn: how far the view moved. Lag: ideal view at 50 / 90 % of its move -> the drawn view there. Past: beyond');
    console.log('  the farthest point the ideal view reached around the stop. Held shimmer from 3 s after the stop: frame step / jerk /');
    console.log('  RMS about a 0.5 s average (mm), with head turn on | off for the same head. Depth: change of the drawn depth while held.');
    console.log('  Glances down past 15 deg fade out by 25 deg: "peak" is the ideal view\'s largest move on the way; for glances, run');
    console.log('  again without sway: past the ideal view / swing past its resting point on the way back (mm).');
    console.log(`${'case'.padEnd(28)} noise | ideal drawn peak mm | lag 50/90 ms | past | calm   | held shimmer on          | off                      | depth`);
    for (const pn of [POSE_NOISE.mid, POSE_NOISE.high]) {
      for (const [name, o] of TURN_CASES) {
        const r = tiltHold({ ...o, poseNoise: pn }, seeds);
        const calm = o.deg <= -25 ? tiltHold({ ...o, poseNoise: pn, swayMm: 0, micro: false, poseSwayDeg: 0 }, seeds) : null;
        const back = calm ? `${f1(calm.pastMax)}/${f1(calm.back)}` : '';
        console.log(`${name.padEnd(28)} ${f1(pn, 2).padStart(5)} | ${f1(r.offset, 0).padStart(5)} ${f1(r.drawn, 0).padStart(5)} ${f1(r.peak, 0).padStart(4)}    | ${f1(r.lag50, 0).padStart(4)} / ${f1(r.lag, 0).padStart(4)}  | ${f1(r.pastMax).padStart(4)} | ${back.padEnd(6)} | ${sh(r.hold).padEnd(24)} | ${sh(r.holdOff).padEnd(24)} | ${f1(r.zMove).padStart(5)}`);
      }
    }
    console.log('sitting still 30 s, x and y: frame step / jerk / RMS about a 0.5 s average, std (mm), head turn off -> on');
    for (const pn of [POSE_NOISE.low, POSE_NOISE.high]) {
      const off = stillWithPose({ poseNoise: pn, view: lookView(false) }, quick ? [1] : undefined);
      const on = stillWithPose({ poseNoise: pn, view: lookView(true) }, quick ? [1] : undefined);
      console.log(`  pose noise ${f1(pn, 2)} deg: ${sh(off)}, ${f1(off.std, 2)}  ->  ${sh(on)}, ${f1(on.std, 2)}`);
    }
    console.log(`targets: never past the ideal view, out or back (<= ${TURN_TARGETS.past} mm, 1 deg noise); held without pose sway and sitting still, no more shimmer than head turn off (x ${TURN_TARGETS.stillRatio} + ${TURN_TARGETS.stillSlackMm} mm)`);
  }

  const hidden = Number(arg('hidden', 0));
  const W = Math.max(...variants.map(([n]) => n.length), 12);
  for (const rp of replays) {
    console.log(`\nreplay ${rp.name}: ${rp.starts.length} loops, stops at ${rp.stops.map((s) => s.tv.toFixed(2)).join(', ')} s, ${rp.revs.length} reversals; arrival +${hidden} ms`);
    console.log(`${'variant'.padEnd(W)} | stop over mean  max | rev mean  max | moving | step near   dim   far | z std near  dim  far`);
    for (const [name, opts] of variants) {
      const r = scoreReplay(rp, { track: appTrack(opts), hiddenMs: hidden });
      console.log(`${name.padEnd(W)} | ${f1(r.over).padStart(14)} ${f1(r.overMax).padStart(4)} | ${f1(r.rev).padStart(8)} ${f1(r.revMax).padStart(4)} | ${f1(r.moving).padStart(6)} | ${f1(r.near.step, 3).padStart(9)} ${f1(r.dim.step, 3)} ${f1(r.far.step, 3)} | ${f1(r.near.zStd, 2).padStart(10)} ${f1(r.dim.zStd, 2)} ${f1(r.far.zStd, 2)}`);
    }
  }
  for (const rec of recorded) {
    const m = rec.meta;
    const dur = (rec.frames.at(-1)?.t ?? 0) / 1000;
    console.log(`\nrecorded ${rec.name}: ${dur.toFixed(1)} s, ${rec.samples.length} samples (${rec.good.length} with a face), camera ${f1(rec.cameraFps, 0)} fps, delay ${m.settings?.cameraDelayMs} ms; recorded with ${m.settings?.motionMode}, ${m.settings?.view?.direction} ${m.settings?.view?.strength}x`);
    console.log(`  scores against the smoothed raw eye (no ground truth); replays use ${view ? `${view.direction} ${view.strength}x` : 'the exact window'} so mm are head mm`);
    console.log(`${'variant'.padEnd(26)} | step   jerk | still resp (s) | past stop mean max (n) | lag ms | moving mm`);
    const row = (name, r) => console.log(`${name.padEnd(26)} | ${f1(r.step, 3)} ${f1(r.jerk, 3)} | ${(f1(100 * r.stillResponse, 0) + '%').padStart(5)} (${f1(r.stillS, 0)}) | ${f1(r.past).padStart(8)} ${f1(r.pastMax)} (${r.nStops}) | ${f1(r.lag, 0).padStart(6)} | ${f1(r.moving)}`);
    row('as recorded', scoreRecordedAsIs(rec));
    for (const [name, opts] of variants) row(name, scoreRecorded(rec, { track: appTrack(opts), view }));
  }

  if (flag('check')) {
    const failed = missedTargets(scoreAll({ track: predictTrack() }));
    if (failed.length) { console.log(`\nFAIL Predict ahead misses its corpus targets: ${failed.join(', ')}`); process.exitCode = 1; }
    else console.log('\npass Predict ahead meets its corpus targets');
    const ff = missedFollowTargets(quick);
    if (ff.length) { console.log(`FAIL Smooth follow misses: ${ff.join(', ')}`); process.exitCode = 1; }
    else console.log('pass Smooth follow (the default) meets its targets');
    const tf = missedTurnTargets(quick);
    if (tf.length) { console.log(`FAIL Head turn misses: ${tf.join(', ')}`); process.exitCode = 1; }
    else console.log('pass Head turn: never past the ideal view, no added shimmer held or still');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();

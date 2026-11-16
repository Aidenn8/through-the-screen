#!/usr/bin/env node
// Filter and prediction tuning by replay.
//
// Takes an e2e log (tools/core-e2e.mjs --out), i.e. the real landmarker's eye
// positions with their capture and arrival times, and replays them through
// EyeTrack with different settings, rendering at 60 Hz exactly as the app does.
// Scores each setting against ground truth at display time:
//   still jitter: RMS frame-to-frame motion and std while the head is still
//   moving error: RMS error during sway, lean and turn
//
// Usage: node tools/core-tune-filter.mjs log.json truth.json

import { readFileSync } from 'node:fs';
import { EyeTrack } from '../src/tracking/predictor.js';
import { cameraToDisplay } from '../src/core/display.js';

const data = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const truth = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const N = truth.frames.length;
const fps = truth.fps;
const camPos = data.camPos;
const results = data.log.results.filter((r) => Number.isInteger(r.tag) && r.tag < N && r.eye);
const key = results[0].mode === 'both' ? 'centre' : results[0].mode === 'left' ? 'left' : 'right';

// Loop start times (capture time of frame 0 of each pass).
const starts = [];
{
  let cur = [];
  let prev = -1;
  const flush = () => {
    if (cur.length > 10) {
      const s = cur.map((r) => r.t - (r.tag * 1000) / fps).sort((a, b) => a - b);
      starts.push(s[s.length >> 1]);
    }
  };
  for (const r of results) {
    if (r.tag < prev) { flush(); cur = []; }
    cur.push(r);
    prev = r.tag;
  }
  flush();
}

function truthAt(tv) {
  const f = tv * fps;
  const i = Math.max(0, Math.min(N - 2, Math.floor(f)));
  const u = Math.min(1, Math.max(0, f - i));
  const a = truth.frames[i][key];
  const b = truth.frames[i + 1][key];
  return cameraToDisplay({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u }, camPos);
}

const seg = (tv) => (tv >= 0.7 && tv < 2.7) || (tv >= 15.8 && tv < 16.8) ? 'still'
  : (tv >= 3.5 && tv < 7.5) || (tv >= 8.5 && tv < 11) || (tv >= 12 && tv < 14) ? 'moving' : null;

function score(opts) {
  const tr = new EyeTrack(opts);
  const lead = 1.5 * 16.67 + 5;
  const t0 = results[0].arrived;
  const t1 = results.at(-1).arrived;
  let i = 0;
  const still = { e: [], steps: [] };
  const moving = [];
  let prev = null;
  for (let t = t0; t < t1; t += 16.667) {
    while (i < results.length && results[i].arrived <= t) {
      const r = results[i++];
      tr.push(r.t, cameraToDisplay(r.eye, camPos));
    }
    const tShow = t + lead;
    const p = tr.sample(tShow);
    const k = starts.findLastIndex((s) => s <= tShow);
    if (k < 0 || tr.state !== 'tracking') { prev = null; continue; }
    const tv = (tShow - starts[k]) / 1000;
    const s = seg(tv);
    const g = truthAt(tv);
    const e = { x: (p.x - g.x) * 1000, y: (p.y - g.y) * 1000, z: (p.z - g.z) * 1000 };
    if (s === 'still') {
      still.e.push(e);
      if (prev) still.steps.push(Math.hypot(p.x - prev.x, p.y - prev.y) * 1000);
    } else if (s === 'moving') moving.push(e);
    prev = p;
  }
  const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
  const std = (a) => { const m = a.reduce((s, x) => s + x, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
  return {
    stillStep: rms(still.steps),
    stillStdXY: Math.hypot(std(still.e.map((e) => e.x)), std(still.e.map((e) => e.y))),
    stillStdZ: std(still.e.map((e) => e.z)),
    moveXY: Math.hypot(rms(moving.map((e) => e.x)), rms(moving.map((e) => e.y))),
    moveZ: rms(moving.map((e) => e.z)),
  };
}

const rows = [];
const grid = {
  minCutoff: [0.3, 0.5, 0.8],
  beta: [16, 32, 64, 128],
  predictGain: [0, 0.8, 1, 1.2],
  vel: [[0, 3], [0, 6], [0, 10], [0, 15], [100, 10]],
  maxHorizonMs: [100, 140, 250],
};
for (const minCutoff of grid.minCutoff) for (const beta of grid.beta) for (const predictGain of grid.predictGain) {
  for (const [velWindowMs, velocityCutoff] of grid.vel) for (const maxHorizonMs of grid.maxHorizonMs) {
    if (predictGain === 0 && (velWindowMs || maxHorizonMs !== 250 || velocityCutoff !== 3)) continue;
    const opts = {
      filterXY: { minCutoff, beta, dCutoff: 1 },
      filterZ: { minCutoff: minCutoff / 2, beta: beta / 2, dCutoff: 1 },
      predictGain, velocityCutoff, velWindowMs, maxHorizonMs,
    };
    rows.push({ minCutoff, beta, predictGain, velocityCutoff, velWindowMs, maxHorizonMs, ...score(opts) });
  }
}
const f = (x, d = 2) => x.toFixed(d);
const show = (r) => `minCutoff ${r.minCutoff} beta ${r.beta} gain ${r.predictGain} vel ${r.velWindowMs}ms/${r.velocityCutoff}Hz cap ${r.maxHorizonMs} | still step ${f(r.stillStep, 3)} std xy ${f(r.stillStdXY)} z ${f(r.stillStdZ)} | moving xy ${f(r.moveXY)} z ${f(r.moveZ)} mm`;
console.log('current defaults:');
console.log(show({ minCutoff: 0.8, beta: 4, predictGain: 1, velocityCutoff: 3, velWindowMs: 0, maxHorizonMs: 250, ...score({}) }));
// Trade-off: best moving error among settings whose still-head output moves
// less than a cap per 60 Hz frame (0.19 mm = one CSS pixel on this display).
for (const cap of [0.03, 0.05, 0.08, 0.12]) {
  const ok = rows.filter((r) => r.stillStep <= cap).sort((a, b) => a.moveXY - b.moveXY);
  console.log(`\nstill step <= ${cap} mm/frame (${ok.length} settings): best by moving error`);
  ok.slice(0, 4).forEach((r) => console.log(show(r)));
}

// Analysis for tools/core-e2e.mjs: accuracy, jitter, rate, latency and lag
// against the synthetic video's ground truth.
//
// Can also be run on a saved log: node tools/core-e2e-analyse.mjs log.json truth.json

import { readFileSync } from 'node:fs';
import { cameraToDisplay } from '../src/core/display.js';

const SEGMENTS = [
  ['still', 0.7, 2.7],
  ['sway', 3.5, 7.5],
  ['in-out', 8.5, 11],
  ['turn', 12, 14],
  ['still2', 15.8, 16.8],
];
const segOf = (tv) => (SEGMENTS.find(([, a, b]) => tv >= a && tv < b) || [null])[0];

const rms = (a) => (a.length ? Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length) : NaN);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const std = (a) => { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

function truthAt(truth, tv, key) {
  const fps = truth.fps;
  const f = tv * fps;
  const i = Math.max(0, Math.min(truth.frames.length - 2, Math.floor(f)));
  const u = Math.min(1, Math.max(0, f - i));
  const a = truth.frames[i][key];
  const b = truth.frames[i + 1][key];
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u };
}

export function analyse(data, truth) {
  const N = truth.frames.length;
  const period = (N / truth.fps) * 1000;
  const all = data.log.results;
  const tagged = all.filter((r) => Number.isInteger(r.tag) && r.tag >= 0 && r.tag < N);
  const out = { variant: data.variant, landmarker: data.landmarker, results: all.length, tagged: tagged.length };

  // Rate and latency.
  const span = (all.at(-1).t - all[0].t) / 1000;
  out.trackHz = (all.length - 1) / span;
  out.cameraFps = data.stats.cameraFps;
  out.dropped = data.stats.dropped;
  out.facesFound = tagged.filter((r) => r.faces > 0).length / Math.max(1, tagged.length);
  const lat = all.map((r) => r.arrived - r.t);
  out.latency = { median: q(lat, 0.5), p95: q(lat, 0.95) };
  const inf = all.map((r) => r.inferMs).filter(Number.isFinite);
  out.infer = { median: q(inf, 0.5), p95: q(inf, 0.95) };

  // Loop starts: capture time of frame 0 for each pass through the file.
  const loops = [];
  let cur = [];
  let prevTag = -1;
  for (const r of tagged) {
    if (r.tag < prevTag) { loops.push(cur); cur = []; }
    cur.push(r);
    prevTag = r.tag;
  }
  loops.push(cur);
  const starts = loops.filter((l) => l.length > 10).map((l) => q(l.map((r) => r.t - (r.tag * 1000) / truth.fps), 0.5));

  // Raw accuracy per segment (camera coords), for the eye being rendered and both eyes.
  const key = (all.find((r) => r.mode)?.mode) || 'right';
  const tkey = key === 'both' ? 'centre' : key === 'left' ? 'left' : 'right';
  out.renderedEye = tkey;
  out.raw = {};
  for (const [name] of SEGMENTS) {
    const rs = tagged.filter((r) => r.right && segOf(r.tag / truth.fps) === name);
    if (!rs.length) continue;
    const e = { x: [], y: [], z: [], d: [], c: [] };
    for (const r of rs) {
      const t = truth.frames[r.tag];
      const p = r[tkey];
      const g = t[tkey];
      e.x.push((p.x - g.x) * 1000);
      e.y.push((p.y - g.y) * 1000);
      e.z.push((p.z - g.z) * 1000);
      e.d.push(Math.hypot(p.x - g.x, p.y - g.y, p.z - g.z) * 1000);
      e.c.push(Math.hypot(r.centre.x - t.centre.x, r.centre.y - t.centre.y, r.centre.z - t.centre.z) * 1000);
    }
    out.raw[name] = {
      n: rs.length,
      bias: { x: mean(e.x), y: mean(e.y), z: mean(e.z) },
      rms: { x: rms(e.x), y: rms(e.y), z: rms(e.z), d: rms(e.d) },
      std: { x: std(e.x), y: std(e.y), z: std(e.z) },
      centreRms: rms(e.c),
    };
  }

  // Filtered, predicted output (what is rendered) vs truth at the display time.
  const camPos = data.camPos;
  const frames = data.log.frames;
  const ok = [];
  // Skip the first 1.5 s: the view glides from its resting point onto the face.
  const settled = all[0].arrived + 1500;
  for (const f of frames) {
    if (f.t < settled) continue;
    const k = starts.findLastIndex((s) => s <= f.tShow);
    if (k < 0) continue;
    const tv = (f.tShow - starts[k]) / 1000;
    if (tv < 0 || tv > period / 1000 - 0.05) continue;
    if (f.state !== 'tracking') continue;
    const g = cameraToDisplay(truthAt(truth, tv, tkey), camPos);
    ok.push({ tv, seg: segOf(tv), e: { x: (f.eye.x - g.x) * 1000, y: (f.eye.y - g.y) * 1000, z: (f.eye.z - g.z) * 1000 }, f, g });
  }
  out.rendered = {};
  for (const [name] of SEGMENTS) {
    const s = ok.filter((o) => o.seg === name);
    if (!s.length) continue;
    out.rendered[name] = {
      n: s.length,
      rms: { x: rms(s.map((o) => o.e.x)), y: rms(s.map((o) => o.e.y)), z: rms(s.map((o) => o.e.z)) },
      std: { x: std(s.map((o) => o.e.x)), y: std(s.map((o) => o.e.y)), z: std(s.map((o) => o.e.z)) },
    };
  }
  // Frame-to-frame smoothness while still: RMS of the change between rendered frames.
  const still = ok.filter((o) => o.seg === 'still' || o.seg === 'still2');
  const steps = [];
  for (let i = 1; i < still.length; i++) {
    const a = still[i - 1].f.eye;
    const b = still[i].f.eye;
    if (still[i].f.t - still[i - 1].f.t < 40) steps.push(Math.hypot(b.x - a.x, b.y - a.y) * 1000);
  }
  out.stillStepRms = rms(steps);

  // Residual lag in the sway: shift that best aligns rendered x with truth x.
  const sway = ok.filter((o) => o.seg === 'sway');
  let best = { lag: 0, err: Infinity };
  for (let lag = -150; lag <= 300; lag += 5) {
    const e = [];
    for (const o of sway) {
      const k = starts.findLastIndex((s) => s <= o.f.tShow);
      const tv = (o.f.tShow - lag - starts[k]) / 1000;
      if (tv < 0) continue;
      const g = cameraToDisplay(truthAt(truth, tv, tkey), camPos);
      e.push((o.f.eye.x - g.x) * 1000);
    }
    const r = rms(e);
    if (r < best.err) best = { lag, err: r };
  }
  out.swayLagMs = best.lag;
  out.swayErrAtBestLag = best.err;
  out.perf = data.perf;
  out.ipdMeasuredMm = data.ipdMeasured ? data.ipdMeasured * 1000 : null;
  out.ipdTrueMm = truth.ipd * 1000;
  return out;
}

const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '–');
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '–');

export function report(a) {
  const L = [];
  L.push(`variant ${a.variant} (${a.landmarker?.mode}/${a.landmarker?.delegate}), ${a.results} results, ${a.tagged} with frame ids, face found ${(a.facesFound * 100).toFixed(1)} %`);
  L.push(`tracking ${f1(a.trackHz)} Hz (camera ${f1(a.cameraFps)} fps, ${a.dropped} skipped); inference median ${f1(a.infer.median)} ms p95 ${f1(a.infer.p95)}; capture->result median ${f1(a.latency.median)} ms p95 ${f1(a.latency.p95)}`);
  L.push(`raw ${a.renderedEye} eye vs truth (mm): segment  n  bias x/y/z  rms x/y/z  std x/y/z  | eye-midpoint rms`);
  for (const [k, v] of Object.entries(a.raw)) {
    L.push(`  ${k.padEnd(7)} ${String(v.n).padStart(4)}  ${f1(v.bias.x)}/${f1(v.bias.y)}/${f1(v.bias.z)}  ${f1(v.rms.x)}/${f1(v.rms.y)}/${f1(v.rms.z)}  ${f2(v.std.x)}/${f2(v.std.y)}/${f2(v.std.z)}  | ${f1(v.centreRms)}`);
  }
  L.push('rendered (filtered + predicted) vs truth at display time (mm): rms x/y/z  std x/y/z');
  for (const [k, v] of Object.entries(a.rendered)) {
    L.push(`  ${k.padEnd(7)} ${String(v.n).padStart(4)}  ${f1(v.rms.x)}/${f1(v.rms.y)}/${f1(v.rms.z)}  ${f2(v.std.x)}/${f2(v.std.y)}/${f2(v.std.z)}`);
  }
  L.push(`still: frame-to-frame step rms ${f2(a.stillStepRms)} mm; sway residual lag ${a.swayLagMs} ms (rms ${f1(a.swayErrAtBestLag)} mm at that lag)`);
  L.push(`eye spacing: true ${f1(a.ipdTrueMm)} mm, measured from irises ${f1(a.ipdMeasuredMm)} mm`);
  const p = a.perf;
  L.push(`render ${f1(p.fps)} fps, frame p50 ${f1(p.p50)} p95 ${f1(p.p95)} p99 ${f1(p.p99)} max ${f1(p.max)} ms, ${p.over20ms}/${p.frames} over 20 ms; loop JS p99 ${f2(p.workP99)} ms`);
  return L.join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('core-e2e-analyse.mjs')) {
  const data = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const truth = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  console.log(report(analyse(data, truth)));
}

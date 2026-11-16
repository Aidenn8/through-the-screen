// A tracking log recorded in the app (src/app/recorder.js) replays through
// tools/core-motion.mjs. The log here is made by the simulator in the same
// format: a viewer leaning and sitting still at 15 fps in a dim room.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRecorded, scoreRecorded, scoreRecordedAsIs, appTrack, predictTrack, makeLeanCorpus, NOISE } from '../tools/core-motion.mjs';

function fakeLog(fps = 15) {
  const corpus = makeLeanCorpus(7, 20);
  let s = 5;
  const g = () => { s = (s * 16807) % 2147483647; const u = s / 2147483647; s = (s * 16807) % 2147483647; return Math.sqrt(-2 * Math.log(Math.max(u, 1e-12))) * Math.cos(2 * Math.PI * (s / 2147483647)); };
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const samples = [];
  for (let k = 1; k * (1000 / fps) < 20000; k++) {
    const te = k * (1000 / fps);
    const p = corpus.at(te);
    const disp = [r6(p.x + g() * NOISE.dimRoom.x), r6(p.y + g() * NOISE.dimRoom.y), r6(p.z + g() * NOISE.dimRoom.z)];
    // captured 48 ms after the light (the camera's delay), back from the model ~30 ms later
    samples.push([te + 48, te, te + 78 + 4 * Math.abs(g()), 1, 'right', false, true, null, disp, disp, disp, null, fps, 25]);
  }
  const frames = [];
  for (let t = 0; t < 20000; t += 1000 / 60) frames.push([t, t + 30, null, null, null, null, 'tracking', true]);
  return {
    kind: 'window-display tracking log', version: 1, durationMs: 20000,
    settings: { cameraDelayMs: 48, motionMode: 'follow', view: { direction: 'window', strength: 1 } },
    samples, sampleFields: ['t', 'ts', 'arrived', 'faces', 'mode', 'leftOpen', 'rightOpen', 'cam', 'disp', 'win', 'view', 'rest', 'cameraFps', 'inferMs'],
    frames, frameFields: ['t', 'tShow', 'eye', 'win', 'target', 'filtered', 'state', 'faceVisible'],
  };
}

test('recorded log: --replay reads it and scores the motion variants against the smoothed eye', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wd-log-'));
  try {
    const file = join(dir, 'log.json');
    writeFileSync(file, JSON.stringify(fakeLog()));
    const rec = loadRecorded(file);
    assert.ok(rec && rec.good.length > 250 && rec.cameraFps === 15);
    const follow = scoreRecorded(rec, { track: appTrack() });
    const old = scoreRecorded(rec, { track: predictTrack() });
    assert.ok(follow.nStops >= 2 && old.nStops >= 2, `stops found: ${follow.nStops}`);
    assert.ok(follow.pastMax < 3 && old.pastMax > follow.pastMax, `past the stop: follow ${follow.pastMax.toFixed(1)}, old ${old.pastMax.toFixed(1)} mm`);
    assert.ok(follow.jerk < old.jerk / 2, `jerk ${follow.jerk.toFixed(3)} vs ${old.jerk.toFixed(3)} mm`);
    // Short holds between leans, mostly within the quick settle after each
    // lean: a looser bound than the bench's 60 s sits.
    assert.ok(follow.stillResponse < 0.8 && old.stillResponse > follow.stillResponse, `still ${follow.stillResponse.toFixed(2)} vs ${old.stillResponse.toFixed(2)}`);
    assert.ok(follow.lag > old.lag && follow.lag < 400, `lag ${follow.lag} vs ${old.lag} ms`);
    // The recorded frames have no eye here: as-recorded scoring copes.
    assert.ok(Number.isNaN(scoreRecordedAsIs(rec).jerk));
    // Anything else is not a tracking log.
    writeFileSync(file, JSON.stringify({ log: {} }));
    assert.equal(loadRecorded(file), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

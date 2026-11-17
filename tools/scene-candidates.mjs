#!/usr/bin/env node
// Write a shots file for tools/scene-probe.mjs from candidate station views
// (eye and look point in set metres, the rig scale), so several framings can
// be compared in one run.
//
//   node tools/scene-candidates.mjs OUT.json name:ex,ey,ez:lx,ly,lz[:scale] ...
//   special: plan (the whole stage from above, roof and grid hidden)

import { writeFileSync } from 'node:fs';
import { poseFor, HUMAN } from '../src/scenes/soundstage/nav.js';

const [out, ...specs] = process.argv.slice(2);
const shots = [];
for (const spec of specs) {
  if (spec === 'plan') {
    shots.push({
      name: 'plan',
      rig: { position: [0.0, 4.9, 0.069], yaw: 90, pitch: -89.9, scale: 1 },
      js: "window.__lab.handle.scene.traverse((o) => { if (['roof', 'truss', 'gridPipe', 'drape', 'catwalk', 'motor', 'chain', 'luan'].includes(o.name)) o.visible = false; });",
      width: 1440,
    });
    continue;
  }
  const [name, e, l, sc] = spec.split(':');
  const eye = e.split(',').map(Number);
  const look = l.split(',').map(Number);
  shots.push({ name, rig: poseFor({ eye, look, scale: sc ? Number(sc) : HUMAN }), width: 960, js: "window.__lab.handle.scene.traverse((o) => { o.visible = true; });" });
}
writeFileSync(out, JSON.stringify(shots, null, 1));
console.log(`${shots.length} shots -> ${out}`);

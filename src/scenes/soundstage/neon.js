// Bent-glass neon lettering: each glyph is a few strokes in a unit box,
// swept into thin tubes. Original lettering, no real signage.

import * as THREE from 'three';

const ell = (cx, cy, rx, ry, a0, a1, n = 14) => {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
};

export const GLYPHS = {
  D: [[[0, 0], [0, 1]], [[0, 1], [0.45, 1], ...ell(0.45, 0.5, 0.45, 0.5, Math.PI / 2, -Math.PI / 2, 12).slice(1), [0, 0]]],
  I: [[[0.5, 0], [0.5, 1]]],
  N: [[[0, 0], [0, 1], [0.9, 0], [0.9, 1]]],
  E: [[[0.85, 1], [0, 1], [0, 0], [0.85, 0]], [[0, 0.52], [0.65, 0.52]]],
  R: [[[0, 0], [0, 1], [0.55, 1], ...ell(0.55, 0.75, 0.3, 0.25, Math.PI / 2, -Math.PI / 2, 8).slice(1), [0, 0.5]], [[0.4, 0.5], [0.9, 0]]],
  A: [[[0, 0], [0.45, 1], [0.9, 0]], [[0.18, 0.4], [0.72, 0.4]]],
  T: [[[0, 1], [0.9, 1]], [[0.45, 1], [0.45, 0]]],
  S: [ell(0.45, 0.75, 0.42, 0.25, 0.15, Math.PI * 1.5, 10).concat(ell(0.45, 0.25, 0.42, 0.25, Math.PI / 2, -Math.PI * 0.85, 10).slice(1))],
  O: [ell(0.45, 0.5, 0.45, 0.5, 0, Math.PI * 2, 24)],
  P: [[[0, 0], [0, 1], [0.55, 1], ...ell(0.55, 0.75, 0.32, 0.25, Math.PI / 2, -Math.PI / 2, 8).slice(1), [0, 0.5]]],
  C: [ell(0.5, 0.5, 0.48, 0.5, Math.PI * 0.25, Math.PI * 1.75, 18)],
  F: [[[0.85, 1], [0, 1], [0, 0]], [[0, 0.52], [0.6, 0.52]]],
};

/**
 * Tubes for a word laid out along x (or stacked down y when vertical).
 * Returns a BufferGeometry in local units (metres), origin at the word's
 * bottom-left, letters `size` tall.
 */
export function neonWord(text, { size = 0.4, tube = 0.012, spacing = 0.28, vertical = false, seg = 6 } = {}) {
  const geoms = [];
  let cursor = 0;
  for (const ch of text) {
    const strokes = GLYPHS[ch];
    if (!strokes) { cursor += size * 0.6; continue; }
    const w = size * 0.75;
    for (const s of strokes) {
      const pts = s.map(([u, v]) => (vertical
        ? new THREE.Vector3((u - 0.45) * w, -cursor + v * size, 0)
        : new THREE.Vector3(cursor + u * w, v * size, 0)));
      // drop duplicate consecutive points
      const clean = pts.filter((p, i) => i === 0 || p.distanceTo(pts[i - 1]) > 1e-5);
      if (clean.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(clean, false, 'catmullrom', 0.1);
      geoms.push(new THREE.TubeGeometry(curve, Math.max(8, clean.length * 4), tube, seg, false));
      // the tube's sealed ends (an open end shows the tube's inside up close)
      for (const p of [clean[0], clean[clean.length - 1]]) {
        const cap = new THREE.SphereGeometry(tube, seg, Math.max(4, seg >> 1));
        cap.translate(p.x, p.y, p.z);
        geoms.push(cap);
      }
    }
    cursor += vertical ? size * (1 + spacing) : w + size * spacing;
  }
  return { geoms, length: cursor };
}

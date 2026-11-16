// Procedural surfaces for the soundstage set, painted on canvases at load.
// Sizes are in real-world metres per texture repeat (the set is modelled at
// full size and shrunk to 1:12 as a whole).

import * as THREE from 'three';
import { makeCanvas, paint, fbm, rng, toTexture, normalFromHeight } from '../_lib/textures.js';

const clamp = (v, a = 0, b = 255) => Math.max(a, Math.min(b, v));

// One shared tileable noise tile used as an overlay pattern.
let noiseTile = null;
function noise() {
  if (!noiseTile) noiseTile = paint(256, 256, (u, v) => 255 * fbm(u, v, 8, 5, 41));
  return noiseTile;
}

function overlayNoise(ctx, w, h, alpha, mode = 'overlay', scale = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = mode;
  const pat = ctx.createPattern(noise(), 'repeat');
  ctx.scale(scale, scale);
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, w / scale, h / scale);
  ctx.restore();
}

function tex(canvas, repeatMetres, opts = {}) {
  const t = toTexture(canvas, opts);
  t.userData.metres = repeatMetres;
  return t;
}

// ---------------------------------------------------------------- brick
// 1.6 x 1.6 m per repeat: 8 bricks across, 24 courses.
export function brick({ seed = 5, base = [112, 52, 40] } = {}) {
  const N = 512;
  const r = rng(seed);
  const col = makeCanvas(N, N);
  const hgt = makeCanvas(N, N);
  const c = col.getContext('2d');
  const h = hgt.getContext('2d');
  c.fillStyle = 'rgb(86,80,74)';
  c.fillRect(0, 0, N, N);
  h.fillStyle = 'rgb(40,40,40)';
  h.fillRect(0, 0, N, N);
  const rows = 24;
  const cols = 8;
  const bh = N / rows;
  const bw = N / cols;
  for (let y = 0; y < rows; y++) {
    const off = (y % 2) * bw * 0.5;
    for (let x = -1; x < cols; x++) {
      const k = 0.72 + r() * 0.5;
      const burnt = r() < 0.12 ? 0.6 : 1;
      const rr = clamp(base[0] * k * burnt + (r() - 0.5) * 18);
      const gg = clamp(base[1] * k * burnt + (r() - 0.5) * 10);
      const bb = clamp(base[2] * k * burnt + (r() - 0.5) * 8);
      const px = x * bw + off + 1.5;
      const py = y * bh + 1.5;
      c.fillStyle = `rgb(${rr},${gg},${bb})`;
      c.fillRect(px, py, bw - 3, bh - 3);
      const hv = 170 + r() * 60;
      h.fillStyle = `rgb(${hv},${hv},${hv})`;
      h.fillRect(px, py, bw - 3, bh - 3);
      // wrap the half brick at the right edge
      if (px + bw > N) {
        c.fillStyle = `rgb(${rr},${gg},${bb})`;
        c.fillRect(px - N, py, bw - 3, bh - 3);
        h.fillRect(px - N, py, bw - 3, bh - 3);
      }
    }
  }
  overlayNoise(c, N, N, 0.55, 'overlay', 1);
  overlayNoise(h, N, N, 0.35, 'overlay', 2);
  // soot and rain streaks running down
  c.save();
  c.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 40; i++) {
    const x = r() * N;
    const w = 4 + r() * 30;
    const g = c.createLinearGradient(0, 0, 0, N);
    const a = 0.15 + r() * 0.25;
    g.addColorStop(0, `rgba(40,40,45,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(x, 0, w, N);
  }
  c.restore();
  return {
    map: tex(col, 1.6),
    normalMap: tex(normalFromHeight(hgt, 3), 1.6, { srgb: false }),
  };
}

// ---------------------------------------------------------------- asphalt
// 3 x 3 m per repeat. Returns albedo, normal and a wetness/puddle mask (R).
export function asphalt({ seed = 9 } = {}) {
  const N = 1024;
  const r = rng(seed);
  const col = paint(N, N, (u, v) => {
    const n = fbm(u, v, 6, 5, seed);
    const m = fbm(u, v, 48, 2, seed + 3);
    const k = 30 + n * 18 + (m - 0.5) * 16;
    return [k * 0.97, k, k * 1.05];
  });
  const c = col.getContext('2d');
  // aggregate speckles
  for (let i = 0; i < 9000; i++) {
    const v = 70 + r() * 70;
    c.fillStyle = `rgba(${v},${v},${v},${0.25 + r() * 0.4})`;
    c.fillRect(r() * N, r() * N, 1 + r() * 1.6, 1 + r() * 1.6);
  }
  // tar-sealed cracks
  c.strokeStyle = 'rgba(14,14,16,0.75)';
  c.lineCap = 'round';
  for (let i = 0; i < 14; i++) {
    let x = r() * N;
    let y = r() * N;
    c.lineWidth = 2 + r() * 4;
    c.beginPath();
    c.moveTo(x, y);
    for (let s = 0; s < 18; s++) {
      x += (r() - 0.5) * 40;
      y += (r() - 0.3) * 30;
      c.lineTo(x, y);
    }
    c.stroke();
  }
  const hgt = paint(N / 2, N / 2, (u, v) => 255 * (0.6 * fbm(u, v, 64, 3, seed + 7) + 0.4 * fbm(u, v, 8, 3, seed + 1)));
  const wet = paint(N / 2, N / 2, (u, v) => {
    const p = fbm(u, v, 3, 5, seed + 11);
    const puddle = Math.min(1, Math.max(0, (p - 0.5) * 7));
    return 255 * (0.35 + 0.65 * puddle);
  });
  return {
    map: tex(col, 3),
    normalMap: tex(normalFromHeight(hgt, 1.6), 3, { srgb: false }),
    wetMap: tex(wet, 3, { srgb: false }),
  };
}

// ---------------------------------------------------------------- concrete sidewalk
// 3 x 3 m per repeat, slabs 1.5 m with joints.
export function sidewalk({ seed = 21 } = {}) {
  const N = 512;
  const col = paint(N, N, (u, v) => {
    const n = fbm(u, v, 5, 5, seed);
    const k = 92 + n * 40;
    return [k, k * 0.99, k * 0.96];
  });
  const c = col.getContext('2d');
  c.fillStyle = 'rgba(30,30,32,0.85)';
  for (const p of [0, N / 2]) {
    c.fillRect(p, 0, 3, N);
    c.fillRect(0, p, N, 3);
  }
  overlayNoise(c, N, N, 0.3, 'multiply', 0.5);
  const hgt = paint(N, N, (u, v, x, y) => {
    const joint = x % (N / 2) < 3 || y % (N / 2) < 3 ? 0 : 1;
    return 255 * (0.2 + 0.6 * joint + 0.2 * fbm(u, v, 40, 2, seed + 4));
  });
  return { map: tex(col, 3), normalMap: tex(normalFromHeight(hgt, 2), 3, { srgb: false }) };
}

// ---------------------------------------------------------------- enamel tile
// 1.2 x 1.2 m per repeat, 15 cm square glazed tiles.
export function tiles({ color = [24, 92, 96], grout = [200, 196, 186], seed = 4 } = {}) {
  const N = 512;
  const r = rng(seed);
  const n = 8;
  const s = N / n;
  const col = makeCanvas(N, N);
  const c = col.getContext('2d');
  c.fillStyle = `rgb(${grout.join(',')})`;
  c.fillRect(0, 0, N, N);
  const hgt = makeCanvas(N, N);
  const h = hgt.getContext('2d');
  h.fillStyle = '#202020';
  h.fillRect(0, 0, N, N);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const k = 0.9 + r() * 0.2;
    c.fillStyle = `rgb(${clamp(color[0] * k)},${clamp(color[1] * k)},${clamp(color[2] * k)})`;
    c.fillRect(x * s + 2, y * s + 2, s - 4, s - 4);
    const g = h.createRadialGradient(x * s + s / 2, y * s + s / 2, s * 0.2, x * s + s / 2, y * s + s / 2, s * 0.7);
    g.addColorStop(0, '#e0e0e0');
    g.addColorStop(1, '#b8b8b8');
    h.fillStyle = g;
    h.fillRect(x * s + 2, y * s + 2, s - 4, s - 4);
  }
  return { map: tex(col, 1.2), normalMap: tex(normalFromHeight(hgt, 2.5), 1.2, { srgb: false }) };
}

// ---------------------------------------------------------------- scenic paint
// Flat painted surface (stucco / sign band / interior walls) with brushwork.
export function paintSurface({ base = [196, 184, 160], seed = 13, grime = 0.35, size = 2 } = {}) {
  const N = 512;
  const col = paint(N, N, (u, v) => {
    const n = fbm(u, v, 4, 5, seed);
    const s = fbm(u, v, 20, 2, seed + 2, 0.5, 60); // vertical brush drag
    const k = 0.86 + 0.18 * n + 0.06 * (s - 0.5);
    const dirt = Math.max(0, fbm(u, v, 2, 4, seed + 9) - 0.45) * grime * 2.5;
    return [clamp(base[0] * k * (1 - dirt)), clamp(base[1] * k * (1 - dirt)), clamp(base[2] * k * (1 - dirt * 1.1))];
  });
  const hgt = paint(N / 2, N / 2, (u, v) => 255 * fbm(u, v, 32, 3, seed + 5));
  return { map: tex(col, size), normalMap: tex(normalFromHeight(hgt, 0.8), size, { srgb: false }) };
}

// ---------------------------------------------------------------- raw lumber
// Pine 1x / 2x stock: grain along u. 2 m per repeat along the grain.
export function pine({ seed = 31, tone = [196, 160, 112] } = {}) {
  const col = paint(512, 64, (u, v) => {
    const warp = fbm(u, v, 2, 3, seed, 0.5, 1) * 1.6;
    const g = (v * 5 + warp + fbm(u, v, 12, 2, seed + 5, 0.5, 1) * 0.4) % 1;
    const ring = Math.pow(Math.abs(Math.sin(g * Math.PI)), 8);
    const k = 1 - 0.22 * ring - 0.08 * fbm(u, v, 64, 2, seed + 9, 0.5, 8);
    const knot = Math.max(0, 1 - Math.hypot((u - 0.3) * 18, (v - 0.5) * 3)) * 0.4;
    return [clamp(tone[0] * k * (1 - knot)), clamp(tone[1] * k * (1 - knot)), clamp(tone[2] * k * (1 - knot * 1.2))];
  });
  return { map: tex(col, 2) };
}

// Luan / plywood back of a flat: pale, slightly blotchy, with stencil marks.
export function luan({ seed = 33 } = {}) {
  const N = 512;
  const col = paint(N, N, (u, v) => {
    const g = fbm(u, v, 3, 4, seed, 0.5, 30);
    const b = fbm(u, v, 3, 5, seed + 4);
    const k = 0.8 + 0.22 * g + 0.12 * (b - 0.5);
    return [clamp(186 * k), clamp(150 * k), clamp(112 * k)];
  });
  const c = col.getContext('2d');
  // shop marks: red WILD stencils and circle marks, grey unit numbers
  c.fillStyle = 'rgba(170,30,24,0.8)';
  c.font = 'bold 54px Impact, Arial Black, sans-serif';
  c.fillText('WILD', 60, 170);
  c.font = 'bold 40px Impact, Arial Black, sans-serif';
  c.fillText('WILD', 300, 430);
  c.strokeStyle = 'rgba(170,30,24,0.75)';
  c.lineWidth = 6;
  c.beginPath(); c.arc(420, 150, 34, 0, Math.PI * 2); c.stroke();
  c.fillStyle = 'rgba(40,40,40,0.6)';
  c.font = 'bold 24px monospace';
  c.fillText('ST 4 / UNIT 12', 40, 330);
  c.fillText('DINER R-3', 300, 60);
  return { map: tex(col, 2.4) };
}

// ---------------------------------------------------------------- stage floor
// Painted concrete with scuffs, 6 x 6 m per repeat.
export function stageFloor({ seed = 51 } = {}) {
  const N = 1024;
  const r = rng(seed);
  const col = paint(N, N, (u, v) => {
    const n = fbm(u, v, 4, 6, seed);
    const k = 38 + n * 22;
    return [k, k, k * 1.03];
  });
  const c = col.getContext('2d');
  // scuffs
  c.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const v = r() < 0.5 ? 70 + r() * 40 : 18;
    c.strokeStyle = `rgba(${v},${v},${v},${0.08 + r() * 0.14})`;
    c.lineWidth = 1 + r() * 6;
    const x = r() * N;
    const y = r() * N;
    const a = r() * Math.PI * 2;
    const l = 10 + r() * 90;
    c.beginPath();
    c.moveTo(x, y);
    c.quadraticCurveTo(x + Math.cos(a + 0.6) * l * 0.5, y + Math.sin(a + 0.6) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    c.stroke();
  }
  // old tape marks
  for (let i = 0; i < 10; i++) {
    const tones = ['200,60,50', '220,190,60', '70,140,200', '230,230,230'];
    c.fillStyle = `rgba(${tones[i % 4]},0.55)`;
    const x = r() * N;
    const y = r() * N;
    c.save();
    c.translate(x, y);
    c.rotate(r() * Math.PI);
    c.fillRect(-14, -2.5, 28, 5);
    if (r() < 0.6) c.fillRect(-2.5, -2.5, 5, 18);
    c.restore();
  }
  overlayNoise(c, N, N, 0.25, 'overlay', 2);
  return { map: tex(col, 6) };
}

// ---------------------------------------------------------------- fabric
export function canvasCloth({ tone = [120, 104, 70], seed = 61 } = {}) {
  const col = paint(256, 256, (u, v, x, y) => {
    const weave = ((x >> 1) + (y >> 1)) % 2 ? 1 : 0.92;
    const n = 0.85 + 0.25 * fbm(u, v, 6, 4, seed);
    return [clamp(tone[0] * weave * n), clamp(tone[1] * weave * n), clamp(tone[2] * weave * n)];
  });
  return { map: tex(col, 0.5) };
}

// ---------------------------------------------------------------- backing
// Painted night-city translight (emissive). Not tiled: one canvas.
export function cityBacking({ seed = 71, w = 3072, h = 1536 } = {}) {
  const r = rng(seed);
  const cv = makeCanvas(w, h);
  const c = cv.getContext('2d');
  // Rain-night sky: blue-black above, the city's sodium glow on low cloud
  // toward the horizon.
  const sky = c.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#04060b');
  sky.addColorStop(0.35, '#0b1220');
  sky.addColorStop(0.62, '#1d2230');
  sky.addColorStop(0.8, '#3a3236');
  sky.addColorStop(1, '#4a3a34');
  c.fillStyle = sky;
  c.fillRect(0, 0, w, h);
  // low clouds catching city glow
  c.save();
  c.globalAlpha = 0.35;
  c.globalCompositeOperation = 'screen';
  const cloud = paint(256, 128, (u, v) => {
    const n = fbm(u, v, 3, 6, seed + 1, 0.55, 2);
    const k = Math.max(0, n - 0.45) * 2.2 * (1 - v * 0.3);
    return [clamp(80 * k), clamp(70 * k), clamp(64 * k)];
  });
  c.drawImage(cloud, 0, h * 0.05, w, h * 0.6);
  c.restore();
  // skyline layers: far (hazy, lighter) to near (darker)
  // Skyline in three layers; nearer layers darker and larger, windows in
  // floors (some whole floors lit, most dark), a few water tanks and masts.
  const layers = [
    { base: 0.58, var: 0.16, color: '#232634', win: 0.05, wcol: [150, 140, 125], fh: 10, ww: 4 },
    { base: 0.64, var: 0.2, color: '#161a24', win: 0.07, wcol: [200, 168, 120], fh: 14, ww: 6 },
    { base: 0.74, var: 0.16, color: '#0b0d13', win: 0.08, wcol: [235, 196, 132], fh: 19, ww: 8 },
  ];
  for (const L of layers) {
    let x = -20;
    while (x < w) {
      const bw = 70 + r() * 220;
      const top = h * (L.base - r() * L.var);
      c.fillStyle = L.color;
      c.fillRect(x, top, bw, h - top);
      if (r() < 0.3) { // stepped crown
        c.fillRect(x + bw * 0.2, top - 18, bw * 0.6, 18);
        if (r() < 0.5) c.fillRect(x + bw * 0.4, top - 34, bw * 0.2, 16);
      }
      if (r() < 0.2) { // water tank
        const tx = x + bw * (0.2 + r() * 0.5);
        c.fillRect(tx, top - 26, 22, 18);
        c.beginPath(); c.moveTo(tx - 2, top - 26); c.lineTo(tx + 11, top - 36); c.lineTo(tx + 24, top - 26); c.fill();
        c.fillRect(tx + 2, top - 8, 2, 8); c.fillRect(tx + 18, top - 8, 2, 8);
      }
      if (r() < 0.15) c.fillRect(x + bw * 0.5, top - 60, 3, 60); // mast
      const floors = Math.floor((h - top) / L.fh);
      for (let f = 1; f < floors; f++) {
        const lit = r() < 0.12 ? 0.6 : L.win; // a few whole floors lit
        const wy = top + f * L.fh;
        for (let wx = x + 6; wx < x + bw - L.ww - 4; wx += L.ww * 2) {
          if (r() < lit) {
            const k = 0.45 + r() * 0.55;
            const cool = r() < 0.2;
            const col = cool ? [150, 175, 200] : L.wcol;
            c.fillStyle = `rgb(${clamp(col[0] * k)},${clamp(col[1] * k)},${clamp(col[2] * k)})`;
            c.fillRect(wx, wy, L.ww, L.fh * 0.55);
          }
        }
      }
      x += bw + r() * 10;
    }
  }
  // atmospheric haze and rain veil toward the horizon
  const hz = c.createLinearGradient(0, h * 0.5, 0, h);
  hz.addColorStop(0, 'rgba(70,64,66,0)');
  hz.addColorStop(1, 'rgba(70,64,66,0.55)');
  c.fillStyle = hz;
  c.fillRect(0, 0, w, h);
  const t = toTexture(cv, { repeat: [1, 1] });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ---------------------------------------------------------------- upper wall
// The diner's upper wall with a faded painted sign, lit by gooseneck sign
// lamps. Returns the paint (albedo) and the same paint multiplied by the
// lamps' light pools (an emissive map: the pools are baked, since the lamps
// and the wall never move). One canvas covers the wall, w x h metres.
// lamps: x positions (m from the wall's left edge) of the lamp heads at the top.
export function upperWall({ w = 7.0, h = 0.82, lamps = [1.2, 3.5, 5.8], text = 'COFFEE  ·  PIE  ·  OPEN ALL NIGHT', seed = 91 } = {}) {
  const W = 2048;
  const H = Math.round((W * h) / w);
  const r = rng(seed);
  // stucco under old paint
  const base = paint(W, H, (u, v) => {
    const n = fbm(u, v, 9, 5, seed, 0.5, 2);
    const s = fbm(u, v, 40, 2, seed + 2, 0.5, 120);
    const k = 0.84 + 0.2 * n + 0.05 * (s - 0.5);
    // rain streaks from the cornice and soot toward the top
    const streak = Math.max(0, fbm(u, v, 60, 2, seed + 7, 0.5, 2) - 0.55) * 1.4 * (1 - v);
    const top = Math.max(0, 0.25 - v) * 1.2;
    const g = 1 - streak - top;
    return [clamp(122 * k * g), clamp(114 * k * g), clamp(100 * k * g)];
  });
  const c = base.getContext('2d');
  // the painted sign: a dark oxblood band with cream lettering, flaking
  const bandY = H * 0.16;
  const bandH = H * 0.66;
  c.fillStyle = 'rgba(78,26,22,0.92)';
  c.fillRect(W * 0.03, bandY, W * 0.94, bandH);
  c.strokeStyle = 'rgba(200,176,128,0.75)';
  c.lineWidth = 5;
  c.strokeRect(W * 0.035, bandY + 8, W * 0.93, bandH - 16);
  c.fillStyle = 'rgba(214,196,150,0.9)';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = `bold ${Math.round(bandH * 0.56)}px Georgia, 'Times New Roman', serif`;
  c.fillText(text, W / 2, bandY + bandH * 0.53, W * 0.86);
  // weathering: flaked paint shows the stucco through, streaks down
  const flake = paint(W / 4, H / 4, (u, v) => {
    const f = fbm(u, v, 12, 4, seed + 11, 0.55, 2);
    return f > 0.6 ? 255 : 0;
  });
  c.save();
  c.globalCompositeOperation = 'destination-out';
  c.globalAlpha = 0.65;
  c.drawImage(flake, 0, 0, W, H);
  c.restore();
  // put stucco back where the paint flaked (destination-out made holes)
  const out = makeCanvas(W, H);
  const o = out.getContext('2d');
  const base2 = paint(W / 2, H / 2, (u, v) => {
    const k = 0.8 + 0.25 * fbm(u, v, 9, 4, seed + 3, 0.5, 2);
    return [clamp(126 * k), clamp(118 * k), clamp(104 * k)];
  });
  o.drawImage(base2, 0, 0, W, H);
  o.drawImage(base, 0, 0);
  for (let i = 0; i < 70; i++) {
    const x = r() * W;
    const a = 0.08 + r() * 0.18;
    const g = o.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, `rgba(30,28,28,${a})`);
    g.addColorStop(1, 'rgba(30,28,28,0)');
    o.fillStyle = g;
    o.fillRect(x, 0, 2 + r() * 10, H);
  }
  // light pools of the gooseneck lamps: each a downward cone from its shade,
  // brightest just under the shade, widening and fading down the wall
  const lit = makeCanvas(W, H);
  const l = lit.getContext('2d');
  l.drawImage(out, 0, 0);
  const pool = paint(W / 4, H / 4, (u, v) => {
    let e = 0;
    for (const lx of lamps) {
      const dx = u * w - lx;
      const dy = v * h + 0.2; // the shades hang ~20 cm above the canvas's top edge
      const width = 0.18 + dy * 0.9;
      e += Math.exp(-(dx * dx) / (width * width)) * (0.32 / (dy * dy + 0.04)) * 0.32;
    }
    // canvas compositing multiplies sRGB values: pre-curve so the product is
    // (close to) albedo x pool in linear light
    const k = Math.min(1, e) ** (1 / 2.2);
    return [255 * k, 255 * k * 0.8, 255 * k * 0.58];
  });
  l.globalCompositeOperation = 'multiply';
  l.drawImage(pool, 0, 0, W, H);
  const map = toTexture(out, { repeat: [1, 1] });
  const litT = toTexture(lit, { repeat: [1, 1] });
  for (const t of [map, litT]) t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return { map, lit: litT };
}

// A newspaper front page (headline bars, columns of grey text, a photo) and
// the box's label band. Generic: no real paper's name or layout.
export function newsPrint({ seed = 95 } = {}) {
  const r = rng(seed);
  const p = makeCanvas(256, 192);
  const g = p.getContext('2d');
  g.fillStyle = '#d8d2c2';
  g.fillRect(0, 0, 256, 192);
  g.fillStyle = '#1a1a1a';
  g.font = 'bold 30px Georgia, serif';
  g.fillText('EVENING', 18, 34);
  g.fillRect(12, 42, 232, 3);
  g.font = 'bold 20px Georgia, serif';
  g.fillText('RAIN TO LAST', 18, 70);
  g.fillStyle = '#6a665e';
  g.fillRect(140, 82, 104, 70); // photo
  g.fillStyle = 'rgba(30,30,30,0.55)';
  for (let col = 0; col < 2; col++) for (let y = 84; y < 186; y += 6) g.fillRect(14 + col * 62, y, 52 * (0.7 + 0.3 * r()), 2);
  const label = makeCanvas(256, 64);
  const l = label.getContext('2d');
  l.fillStyle = '#9a1c18';
  l.fillRect(0, 0, 256, 64);
  l.fillStyle = '#efe6d2';
  l.font = 'bold 40px Arial Black, Impact, sans-serif';
  l.textAlign = 'center';
  l.fillText('NEWS', 128, 48);
  const tp = toTexture(p, { repeat: [1, 1] });
  const tl = toTexture(label, { repeat: [1, 1] });
  for (const t of [tp, tl]) t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return { paper: tp, label: tl };
}

// Checkerboard diner floor, 2 x 2 m per repeat.
export function checker({ seed = 81 } = {}) {
  const N = 512;
  const n = 8;
  const s = N / n;
  const r = rng(seed);
  const cv = makeCanvas(N, N);
  const c = cv.getContext('2d');
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const k = 0.92 + r() * 0.1;
    const v = (x + y) % 2 ? 26 * k : 214 * k;
    c.fillStyle = `rgb(${v},${v * 0.98},${v * 0.94})`;
    c.fillRect(x * s, y * s, s, s);
  }
  overlayNoise(c, N, N, 0.25, 'multiply', 1);
  return { map: tex(cv, 2) };
}

// Apply world-metre UVs: texture repeat = 1 / metres (geometry UVs are metres).
export function metres(t) {
  const m = t.userData.metres ?? 1;
  t.repeat.set(1 / m, 1 / m);
  return t;
}

// ---------------------------------------------------------------- crew area
// Video village feeds: two monitors' pictures side by side (u 0-0.5 A camera,
// 0.5-1 B camera): the diner shot as the cameras see it, with frame lines and
// a timecode burn-in. Painted, not rendered: a monitor across the stage reads
// as its colours and layout.
export function monitorFeeds() {
  const W = 1024;
  const H = 320;
  const cv = makeCanvas(W, H);
  const c = cv.getContext('2d');
  const shot = (x0, cam, close) => {
    const w = W / 2;
    const ih = w / 2.39; // 2.39:1 letterbox inside 16:10
    const iy = (H - ih) / 2;
    c.save();
    c.translate(x0, 0);
    c.fillStyle = '#05060a';
    c.fillRect(0, 0, w, H);
    c.beginPath();
    c.rect(8, iy, w - 16, ih);
    c.clip();
    const g = c.createLinearGradient(0, iy, 0, iy + ih);
    g.addColorStop(0, '#07090f');
    g.addColorStop(0.6, '#0d0b10');
    g.addColorStop(1, '#151018');
    c.fillStyle = g;
    c.fillRect(0, iy, w, ih);
    const s = close ? 1.7 : 1;
    const ox = close ? -150 : 0;
    // warm windows with blinds, the pink letters, the teal blade, the lamp
    for (let i = 0; i < 4; i++) {
      const wx = ox + (120 + i * 82) * s;
      c.fillStyle = '#d99a5a';
      c.fillRect(wx, iy + 56 * s, 70 * s, 34 * s);
      c.fillStyle = 'rgba(60,30,20,0.55)';
      for (let k = 0; k < 4; k++) c.fillRect(wx, iy + (58 + k * 5) * s, 70 * s, 2 * s);
    }
    c.fillStyle = '#ff3a7a';
    c.font = `${Math.round(26 * s)}px sans-serif`;
    c.fillText('DINER', ox + 210 * s, iy + 42 * s);
    c.fillStyle = '#3ae8ff';
    c.fillRect(ox + 72 * s, iy + 12, 12 * s, 58 * s);
    c.fillStyle = '#ffc070';
    c.beginPath();
    c.arc(ox + 50 * s, iy + 22 * s, 7 * s, 0, Math.PI * 2);
    c.fill();
    // wet street streaks under the sources
    for (const [x, col] of [[230, '#ff3a7a'], [280, '#ff3a7a'], [76, '#3ae8ff'], [50, '#ffb060'], [150, '#d99a5a']]) {
      const gg = c.createLinearGradient(0, iy + ih * 0.72, 0, iy + ih);
      gg.addColorStop(0, col);
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = gg;
      c.globalAlpha = 0.6;
      c.fillRect(ox + x * s, iy + ih * 0.72, 5 * s, ih * 0.28);
      c.globalAlpha = 1;
    }
    // the car's dark roof across the lower right
    c.fillStyle = '#030304';
    c.beginPath();
    c.ellipse(ox + 420 * s, iy + ih * 0.95, 160 * s, 40 * s, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
    // frame lines, burn-in, record dot
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.lineWidth = 1;
    c.strokeRect(x0 + 8.5, iy + 0.5, w - 17, ih - 1);
    c.fillStyle = 'rgba(235,235,235,0.85)';
    c.font = '15px monospace';
    c.fillText(`${cam}  01:12:44:08`, x0 + 14, H - 14);
    c.fillText('S 12C  T 4', x0 + w - 104, 22);
    c.fillStyle = '#ff2a20';
    c.beginPath();
    c.arc(x0 + 20, 18, 5, 0, Math.PI * 2);
    c.fill();
  };
  shot(0, 'A CAM', false);
  shot(W / 2, 'B CAM', true);
  const t = toTexture(cv, { repeat: [1, 1] });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// The translight closing the street's far end: the street painted on in
// forced perspective, running on into the city (wet road, lamps, facades,
// the skyline in sodium haze). Painted for the shot's camera; seen from the
// side its vanishing lines point at nothing, and it reads as the drop it is.
// u runs across the drop (u 0 nearest the viewer), v down. road: [u0, u1]
// of the real road where it meets the drop; vp: the vanishing point (u, v).
export function streetDrop({ w = 2048, h = 1366, road = [0.05, 0.52], vp = [0.29, 0.73], seed = 77 } = {}) {
  const r = rng(seed);
  const cv = makeCanvas(w, h);
  const c = cv.getContext('2d');
  const VX = vp[0] * w;
  const VY = vp[1] * h;
  // sky: blue-black overhead, the city's glow on low cloud at the horizon
  const sky = c.createLinearGradient(0, 0, 0, VY);
  sky.addColorStop(0, '#04060b');
  sky.addColorStop(0.5, '#0c1220');
  sky.addColorStop(0.85, '#2a2630');
  sky.addColorStop(1, '#5a4236');
  c.fillStyle = sky;
  c.fillRect(0, 0, w, h);
  // far skyline across the horizon, windows as dots
  for (let x = -10; x < w;) {
    const bw = 30 + r() * 90;
    const top = VY - (20 + r() * 150) * (1 - Math.abs(x - VX) / w * 0.6);
    c.fillStyle = r() < 0.5 ? '#141722' : '#1a1c26';
    c.fillRect(x, top, bw, VY - top + 2);
    for (let yy = top + 6; yy < VY - 4; yy += 7) for (let xx = x + 3; xx < x + bw - 3; xx += 6) {
      if (r() < 0.12) { c.fillStyle = r() < 0.2 ? '#9ab0c8' : '#d8b078'; c.fillRect(xx, yy, 2, 3); }
    }
    x += bw + r() * 6;
  }
  // a building face on one side of the street: a quad from the drop's edge to
  // the vanishing point, with floors of windows converging on it
  const face = (xEdge, yTop, yBot, depth, tone) => {
    // corners: near (at xEdge) top/bottom; far (depth of the way to the VP)
    const fx = xEdge + (VX - xEdge) * depth;
    const fyT = yTop + (VY - yTop) * depth;
    const fyB = yBot + (VY - yBot) * depth;
    c.fillStyle = tone;
    c.beginPath(); c.moveTo(xEdge, yTop); c.lineTo(fx, fyT); c.lineTo(fx, fyB); c.lineTo(xEdge, yBot); c.closePath(); c.fill();
    // floors of small windows converging on the VP, a cornice line every few
    // floors; most dark, some lit warm, a few cool
    const floors = 28;
    const cols = 40;
    for (let f = 0; f < floors; f++) {
      const a = (f + 0.3) / floors;
      const b = (f + 0.72) / floors;
      const litFloor = r() < 0.12;
      for (let k = 0; k < cols; k++) {
        const t0 = Math.pow((k + 0.25) / cols, 0.8) * depth;
        const t1 = Math.pow((k + 0.6) / cols, 0.8) * depth;
        const pt = (t, sv) => {
          const x = xEdge + (VX - xEdge) * t;
          const yt = yTop + (VY - yTop) * t;
          const yb = yBot + (VY - yBot) * t;
          return [x, yt + (yb - yt) * sv];
        };
        const q = [pt(t0, a), pt(t1, a), pt(t1, b), pt(t0, b)];
        const on = r() < (litFloor ? 0.7 : 0.16);
        c.fillStyle = on ? (r() < 0.15 ? '#7a90a8' : (r() < 0.5 ? '#d09858' : '#a87444')) : 'rgba(0,0,0,0.35)';
        c.beginPath(); c.moveTo(...q[0]); for (const p of q.slice(1)) c.lineTo(...p); c.closePath(); c.fill();
      }
      if (f % 7 === 0) {
        c.strokeStyle = 'rgba(70,58,56,0.8)';
        c.lineWidth = 3;
        const p0 = [xEdge, yTop + (yBot - yTop) * (f / floors)];
        c.beginPath(); c.moveTo(...p0); c.lineTo(fx, fyT + (fyB - fyT) * (f / floors)); c.stroke();
      }
    }
  };
  // left of the road (u above road[1]) and right of it (below road[0])
  face(w + 40, h * 0.02, road[1] * 0 + h * 0.86, 0.86, '#1b1416');
  face(w * 0.78, h * 0.22, h * 0.84, 0.7, '#221a1a');
  face(-40, h * 0.08, h * 0.88, 0.82, '#191418');
  // the road: wet asphalt converging on the VP, a broken centre line,
  // reflections of the lamps
  const R0 = road[0] * w;
  const R1 = road[1] * w;
  const rd = c.createLinearGradient(0, VY, 0, h);
  rd.addColorStop(0, '#2a2226');
  rd.addColorStop(1, '#0c0b0e');
  c.fillStyle = rd;
  c.beginPath(); c.moveTo(R0, h); c.lineTo(VX - 2, VY); c.lineTo(VX + 2, VY); c.lineTo(R1, h); c.closePath(); c.fill();
  const mid = (R0 + R1) / 2;
  c.fillStyle = 'rgba(210,190,140,0.5)';
  for (let k = 0; k < 14; k++) {
    const t0 = 1 - Math.pow((k + 0.1) / 14, 0.5);
    const t1 = 1 - Math.pow((k + 0.5) / 14, 0.5);
    const p = (t) => [mid + (VX - mid) * (1 - t), h + (VY - h) * (1 - t)];
    const a = p(t0);
    const b = p(t1);
    const wd = 6 * t0 + 1;
    c.beginPath(); c.moveTo(a[0] - wd, a[1]); c.lineTo(a[0] + wd, a[1]); c.lineTo(b[0] + wd * 0.8, b[1]); c.lineTo(b[0] - wd * 0.8, b[1]); c.closePath(); c.fill();
  }
  // sodium lamps down both kerbs, each with a glow and a streak on the road
  for (const side of [0, 1]) {
    const x0 = side ? R1 + 60 : R0 - 60;
    for (let k = 0; k < 9; k++) {
      const t = Math.pow(0.72, k);
      const x = VX + (x0 - VX) * t;
      const yL = VY + (h * 0.18 - VY) * t;
      const yG = VY + (h - VY) * t;
      const rr = Math.max(1.5, 26 * t);
      const g = c.createRadialGradient(x, yL, 0, x, yL, rr * 4);
      g.addColorStop(0, 'rgba(255,200,120,0.95)');
      g.addColorStop(0.25, 'rgba(255,170,80,0.35)');
      g.addColorStop(1, 'rgba(255,150,60,0)');
      c.fillStyle = g;
      c.fillRect(x - rr * 4, yL - rr * 4, rr * 8, rr * 8);
      c.strokeStyle = '#0a0a0c';
      c.lineWidth = Math.max(1, 6 * t);
      c.beginPath(); c.moveTo(x, yL); c.lineTo(x, yG); c.stroke();
      const s = c.createLinearGradient(0, yG, 0, yG + (h - yG) * 0.5 + 4);
      s.addColorStop(0, 'rgba(255,170,90,0.45)');
      s.addColorStop(1, 'rgba(255,170,90,0)');
      c.fillStyle = s;
      const sx = x + (mid - x) * 0.25;
      c.fillRect(sx - rr * 0.4, yG, rr * 0.8, (h - yG) * 0.5 + 4);
    }
  }
  // tail lights far down the street
  for (const [t, dx] of [[0.12, -6], [0.09, 5], [0.2, 10]]) {
    const x = VX + (mid - VX) * t + dx * t * 10;
    const y = VY + (h - VY) * t;
    c.fillStyle = '#ff3020';
    c.fillRect(x - 6 * t * 10, y - 2, 3 * t * 10 + 1, 2 * t * 10 + 1);
    c.fillRect(x + 3 * t * 10, y - 2, 3 * t * 10 + 1, 2 * t * 10 + 1);
  }
  // rain veil and the brushwork of a painted drop
  const hz = c.createLinearGradient(0, VY - h * 0.25, 0, VY + h * 0.05);
  hz.addColorStop(0, 'rgba(90,74,70,0)');
  hz.addColorStop(0.7, 'rgba(90,74,70,0.35)');
  hz.addColorStop(1, 'rgba(90,74,70,0)');
  c.fillStyle = hz;
  c.fillRect(0, 0, w, h);
  overlayNoise(c, w, h, 0.12, 'overlay', 3);
  // what gives a translight away up close: the lamps behind it make soft hot
  // spots in a grid, the edges fall off, and the printed panels are sewn
  // together in vertical seams
  c.save();
  c.globalCompositeOperation = 'multiply';
  const vg = c.createRadialGradient(w * 0.5, h * 0.55, h * 0.2, w * 0.5, h * 0.55, w * 0.75);
  vg.addColorStop(0, '#ffffff');
  vg.addColorStop(1, '#6a6a6a');
  c.fillStyle = vg;
  c.fillRect(0, 0, w, h);
  c.restore();
  c.save();
  c.globalCompositeOperation = 'screen';
  for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) {
    const x = (i + 0.5) / 6 * w;
    const y = (j + 0.5) / 3 * h;
    const g = c.createRadialGradient(x, y, 0, x, y, w * 0.11);
    g.addColorStop(0, 'rgba(70,58,46,0.55)');
    g.addColorStop(1, 'rgba(70,58,46,0)');
    c.fillStyle = g;
    c.fillRect(x - w * 0.11, y - w * 0.11, w * 0.22, w * 0.22);
  }
  c.restore();
  c.fillStyle = 'rgba(0,0,0,0.45)';
  for (let k = 1; k < 8; k++) c.fillRect((k / 8) * w - 1, 0, 3, h);
  c.fillStyle = 'rgba(0,0,0,0.6)';
  c.fillRect(0, 0, w, 10);
  c.fillRect(0, h - 10, w, 10);
  for (let x = 30; x < w; x += 64) { c.fillStyle = '#b8b0a0'; c.fillRect(x, 3, 5, 5); c.fillRect(x, h - 8, 5, 5); }
  const t = toTexture(cv, { repeat: [1, 1] });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Painted text, one label per row (an atlas: row i of n covers v from
// 1 - (i + 1) / n to 1 - i / n). bg, fg and font may be per-row arrays.
export function labelAtlas(labels, { w = 512, rowH = 128, bg = '#141a2a', fg = '#ece6d6', font = 'bold 64px sans-serif', grain = 0.05, seed = 7 } = {}) {
  const H = rowH * labels.length;
  const cv = makeCanvas(w, H);
  const c = cv.getContext('2d');
  const pick = (v, i) => (Array.isArray(v) ? v[i] : v);
  labels.forEach((text, i) => {
    c.fillStyle = pick(bg, i);
    c.fillRect(0, i * rowH, w, rowH);
    c.fillStyle = pick(fg, i);
    c.font = pick(font, i);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, w / 2, i * rowH + rowH / 2 + 2);
  });
  // weave and wear
  const r = rng(seed);
  c.globalAlpha = grain;
  for (let k = 0; k < (w * H) / 40; k++) {
    c.fillStyle = r() < 0.5 ? '#000' : '#fff';
    c.fillRect(r() * w, r() * H, 1 + r() * 2, 1);
  }
  c.globalAlpha = 1;
  const t = toTexture(cv, { repeat: [1, 1] });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Surfaces for the diner's interior and kitchen, painted on canvases at load.
// Real metres per repeat (textures.js `metres`). All original: no real
// diner's menu, logo or sign.

import * as THREE from 'three';
import { makeCanvas, paint, fbm, rng, toTexture } from '../_lib/textures.js';

const clamp = (v, a = 0, b = 255) => Math.max(a, Math.min(b, v));
const ct = (cv, metres = null, opts = {}) => {
  const t = toTexture(cv, opts);
  if (metres) t.userData.metres = metres;
  else t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
};

// The three letterboards over the back counter (atlas rows, top to bottom):
// white plastic letters pressed into black grooved felt, a little crooked.
export const MENU_ROWS = [
  ['BREAKFAST', [['2 EGGS ANY STYLE', '.45'], ['HOTCAKES', '.35'], ['HAM & EGGS', '.75'], ['TOAST & JAM', '.15']]],
  ['TONIGHT', [['BLUE PLATE', '.85'], ['MEAT LOAF', '.90'], ['HAMBURGER', '.35'], ['CHILI', '.30'], ['GRILLED CHEESE', '.25']]],
  ['PIE · COFFEE', [['PIE  APPLE CHERRY', '.25'], ['A LA MODE', '.10'], ['COFFEE', '.10'], ['MILK SHAKE', '.25']]],
];
export function menuBoards({ w = 1024, rowH = 384, seed = 3 } = {}) {
  const r = rng(seed);
  const cv = makeCanvas(w, rowH * MENU_ROWS.length);
  const c = cv.getContext('2d');
  MENU_ROWS.forEach(([title, items], i) => {
    const y0 = i * rowH;
    c.fillStyle = '#0d0c0c';
    c.fillRect(0, y0, w, rowH);
    // grooves
    for (let y = y0 + 6; y < y0 + rowH; y += 9) { c.fillStyle = 'rgba(70,66,64,0.35)'; c.fillRect(0, y, w, 2); }
    // aluminium frame
    c.strokeStyle = '#8a8680'; c.lineWidth = 10; c.strokeRect(5, y0 + 5, w - 10, rowH - 10);
    const letters = (text, x, y, size, align = 'left', col = '#ece8dc') => {
      c.font = `bold ${size}px "Courier New", monospace`;
      c.textBaseline = 'middle';
      let cx = align === 'right' ? x - c.measureText(text).width : align === 'center' ? x - c.measureText(text).width / 2 : x;
      for (const ch of text) {
        const dw = c.measureText(ch).width;
        c.save();
        c.translate(cx + dw / 2, y + (r() - 0.5) * 3);
        c.rotate((r() - 0.5) * 0.06);
        c.fillStyle = col;
        c.fillText(ch, -dw / 2, 0);
        c.restore();
        cx += dw + 1;
      }
    };
    letters(title, w / 2, y0 + 50, 52, 'center', '#f2d27a');
    const n = items.length;
    const step = (rowH - 110) / n;
    items.forEach(([name, price], k) => {
      const y = y0 + 100 + step * (k + 0.5);
      letters(name, 40, y, 40);
      letters(price, w - 40, y, 40, 'right');
    });
  });
  return ct(cv);
}

// Cream counter and table tops with small boomerangs and gold flecks.
export function formica({ seed = 21 } = {}) {
  const N = 512;
  const r = rng(seed);
  const cv = paint(N, N, (u, v) => {
    const k = 0.95 + 0.05 * fbm(u, v, 6, 3, seed);
    return [clamp(222 * k), clamp(212 * k), clamp(188 * k)];
  });
  const c = cv.getContext('2d');
  for (let i = 0; i < 90; i++) {
    const x = r() * N, y = r() * N, a = r() * Math.PI * 2, s = 10 + r() * 12;
    c.save(); c.translate(x, y); c.rotate(a);
    c.strokeStyle = ['#c25a4a', '#4a8a96', '#3a3a3a', '#c8a050'][i % 4];
    c.lineWidth = 2.2;
    c.beginPath(); c.moveTo(-s, -s * 0.3); c.quadraticCurveTo(0, s * 0.5, s, -s * 0.3); c.stroke();
    c.restore();
  }
  for (let i = 0; i < 700; i++) { c.fillStyle = r() < 0.5 ? '#b89048' : '#8a8a88'; c.fillRect(r() * N, r() * N, 1.5, 1.5); }
  return { map: ct(cv, 0.6) };
}

// Wall clock: cream dial, black hands at twenty to three, a red sweep hand.
export function clockFace() {
  const N = 256;
  const cv = makeCanvas(N, N);
  const c = cv.getContext('2d');
  c.fillStyle = '#efe8d4'; c.fillRect(0, 0, N, N);
  c.translate(N / 2, N / 2);
  for (let i = 0; i < 60; i++) {
    c.save(); c.rotate((i / 60) * Math.PI * 2);
    c.fillStyle = '#141414';
    if (i % 5 === 0) c.fillRect(-4, -118, 8, 22); else c.fillRect(-1.5, -118, 3, 9);
    c.restore();
  }
  const hand = (a, len, wd, col) => { c.save(); c.rotate(a); c.fillStyle = col; c.fillRect(-wd / 2, -len, wd, len + 14); c.restore(); };
  hand(((2 + 40 / 60) / 12) * Math.PI * 2, 62, 9, '#111');
  hand((40 / 60) * Math.PI * 2, 98, 6, '#111');
  hand((12 / 60) * Math.PI * 2, 104, 2, '#b01810');
  c.beginPath(); c.arc(0, 0, 8, 0, Math.PI * 2); c.fillStyle = '#111'; c.fill();
  return ct(cv);
}

// Square tiles: kitchen white (glazed) or quarry red. 1.2 m per repeat.
export function squareTile({ color = [226, 222, 212], grout = [140, 136, 128], n = 8, seed = 7, wear = 0.15 } = {}) {
  const N = 512;
  const r = rng(seed);
  const s = N / n;
  const cv = makeCanvas(N, N);
  const c = cv.getContext('2d');
  c.fillStyle = `rgb(${grout.join(',')})`;
  c.fillRect(0, 0, N, N);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const k = 0.92 + r() * 0.12;
    c.fillStyle = `rgb(${clamp(color[0] * k)},${clamp(color[1] * k)},${clamp(color[2] * k)})`;
    c.fillRect(x * s + 2, y * s + 2, s - 4, s - 4);
  }
  // grease and wear
  const dirt = paint(128, 128, (u, v) => { const d = Math.max(0, fbm(u, v, 3, 4, seed + 3) - 0.5) * 2; return [255 - 120 * d, 255 - 125 * d, 255 - 135 * d]; });
  c.globalCompositeOperation = 'multiply';
  c.globalAlpha = wear * 4;
  c.drawImage(dirt, 0, 0, N, N);
  return { map: ct(cv, 1.2) };
}

// Stacked cereal boxes and canned goods on the shelves: a strip of coloured
// rectangles with lighter labels (no brands).
export function shelfGoods({ seed = 12 } = {}) {
  const r = rng(seed);
  const cv = makeCanvas(512, 64);
  const c = cv.getContext('2d');
  c.fillStyle = '#2a2420'; c.fillRect(0, 0, 512, 64);
  let x = 2;
  // muted: boxes and tins in the back of a warm room, not a toy shelf
  const cols = ['#5a3a30', '#7a6a48', '#3e4650', '#9a9282', '#4a5240', '#6a5038', '#503034'];
  while (x < 510) {
    const w = 10 + r() * 22;
    const h = 30 + r() * 30;
    c.fillStyle = cols[Math.floor(r() * cols.length)];
    c.fillRect(x, 64 - h, w - 2, h);
    c.fillStyle = 'rgba(255,250,235,0.18)';
    c.fillRect(x + 2, 64 - h * 0.7, w - 6, h * 0.3);
    x += w;
  }
  return ct(cv);
}

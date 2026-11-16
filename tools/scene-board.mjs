#!/usr/bin/env node
// Compose a labelled board from local images (headless Chromium, no server).
//   node tools/scene-board.mjs spec.json
// spec: { out, title, cols, cellW, cellH?, cells: [{ path, label, crop?: [x, y, w, h] }] }
// (or an array of such boards). Crops are in source pixels; a 1:1 crop is a
// crop whose size equals the cell size.

import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';

const specs = [].concat(JSON.parse(readFileSync(process.argv[2], 'utf8')));
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');
  for (const spec of specs) {
    const cells = spec.cells.map((c) => ({ ...c, src: `data:image/${extname(c.path) === '.png' ? 'png' : 'jpeg'};base64,${readFileSync(c.path).toString('base64')}` }));
    const url = await page.evaluate(async ({ title, cols, cellW, cellH, cells }) => {
      const load = (src) => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
      const imgs = await Promise.all(cells.map((c) => load(c.src)));
      const rects = cells.map((c, i) => c.crop ?? [0, 0, imgs[i].width, imgs[i].height]);
      const ch = cellH ?? Math.round((cellW * rects[0][3]) / rects[0][2]);
      const pad = 10, head = title ? 46 : 0, lab = 30;
      const rows = Math.ceil(cells.length / cols);
      const cv = document.createElement('canvas');
      cv.width = cols * cellW + (cols + 1) * pad;
      cv.height = head + rows * (ch + lab + pad) + pad;
      const g = cv.getContext('2d');
      g.fillStyle = '#111'; g.fillRect(0, 0, cv.width, cv.height);
      g.fillStyle = '#eee'; g.font = '24px Menlo, monospace';
      if (title) g.fillText(title, pad, 32);
      g.imageSmoothingQuality = 'high';
      cells.forEach((c, i) => {
        const x = pad + (i % cols) * (cellW + pad);
        const y = head + pad + Math.floor(i / cols) * (ch + lab + pad);
        g.fillStyle = '#ccc'; g.font = '18px Menlo, monospace';
        g.fillText(c.label, x, y + 21);
        const [sx, sy, sw, sh] = rects[i];
        const k = Math.min(cellW / sw, ch / sh);
        g.drawImage(imgs[i], sx, sy, sw, sh, x + (cellW - sw * k) / 2, y + lab + (ch - sh * k) / 2, sw * k, sh * k);
      });
      return cv.toDataURL('image/jpeg', 0.9);
    }, { title: spec.title, cols: spec.cols, cellW: spec.cellW, cellH: spec.cellH, cells });
    writeFileSync(spec.out, Buffer.from(url.split(',')[1], 'base64'));
    console.log(`board -> ${spec.out}`);
  }
} finally {
  await browser.close();
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  displaySize, viewportOnDisplay, estimateZoom, isFullscreen, cameraPosition,
  cameraToDisplay, displayToWindow, windowToDisplay, sizeFromCard, cardCssWidth,
  screenMatchesPreset, DISPLAY_PRESETS, CARD_MM, panelPixelRatio,
} from '../src/core/display.js';

const close = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b} (eps ${eps})`);

// 15" MacBook Air at its default "looks like 1710 x 1107" scaling.
const AIR15 = displaySize('mba15-m2');
const fullscreenInfo = (over = {}) => ({
  screenWidth: 1710, screenHeight: 1107, screenX: 0, screenY: 0,
  outerWidth: 1710, outerHeight: 1107, innerWidth: 1710, innerHeight: 1107,
  dpr: 2, elementFullscreen: true, ...over,
});

test('15-inch Air active area matches the published pixels and ppi', () => {
  close(AIR15.width, 0.32657, 1e-4);
  close(AIR15.height, 0.21136, 1e-4);
  for (const id of Object.keys(DISPLAY_PRESETS)) {
    const s = displaySize(id);
    const p = DISPLAY_PRESETS[id];
    close(s.width / s.height, p.pixels[0] / p.pixels[1], 1e-9, id);
  }
  assert.throws(() => displaySize('nope'), RangeError);
  assert.throws(() => displaySize('custom'), RangeError);
});

test('full screen canvas is the whole display, centred', () => {
  const vp = viewportOnDisplay(fullscreenInfo(), AIR15);
  assert.equal(vp.fullscreen, true);
  close(vp.width, AIR15.width, 1e-9);
  // 1864 px / (2880 / 1710) = 1106.75 pt; macOS reports 1107, a 0.05 mm rounding.
  close(vp.height, AIR15.height, 1e-4);
  close(vp.centre.x, 0, 1e-12);
  close(vp.centre.y, 0, 1e-4);
  close(vp.metresPerCssPx, AIR15.width / 1710, 1e-12);
});

test('full screen below the notch: canvas sits at the bottom, centre shifts down', () => {
  const notchPt = 37;
  const vp = viewportOnDisplay(fullscreenInfo({ innerHeight: 1107 - notchPt, outerHeight: 1107 - notchPt }), AIR15);
  const mPerPt = AIR15.width / 1710;
  assert.equal(vp.fullscreen, true);
  close(vp.points.top, notchPt, 1e-9);
  close(vp.height, (1107 - notchPt) * mPerPt, 1e-9);
  close(vp.centre.y, -(notchPt / 2) * mPerPt, 1e-9);
});

test('windowed: browser chrome above, window position from screenX/screenY', () => {
  const info = {
    screenWidth: 1710, screenHeight: 1107, screenX: 100, screenY: 40,
    outerWidth: 1200, outerHeight: 800, innerWidth: 1200, innerHeight: 712,
    dpr: 2, elementFullscreen: false,
  };
  const vp = viewportOnDisplay(info, AIR15);
  const mPerPt = AIR15.width / 1710;
  assert.equal(vp.fullscreen, false);
  close(vp.points.left, 100, 1e-9);
  close(vp.points.top, 40 + 88, 1e-9);
  close(vp.centre.x, (100 + 600 - 855) * mPerPt, 1e-12);
  close(vp.centre.y, (553.5 - (128 + 356)) * mPerPt, 1e-12);
  // A point at the window centre maps to the window origin, and back.
  const p = { x: vp.centre.x, y: vp.centre.y, z: 0.5 };
  const w = displayToWindow(p, vp);
  close(w.x, 0, 1e-12); close(w.y, 0, 1e-12); close(w.z, 0.5, 1e-12);
  const d = windowToDisplay(w, vp);
  close(d.x, p.x, 1e-12); close(d.y, p.y, 1e-12);
});

test('browser zoom changes CSS pixel size but not the physical rectangle', () => {
  const base = {
    screenWidth: 1710, screenHeight: 1107, screenX: 0, screenY: 40,
    outerWidth: 1710, outerHeight: 1000, dpr: 2, elementFullscreen: false,
  };
  const a = viewportOnDisplay({ ...base, innerWidth: 1710, innerHeight: 912 }, AIR15);
  const b = viewportOnDisplay({ ...base, innerWidth: 1368, innerHeight: 729.6, dpr: 2.5 }, AIR15);
  assert.equal(estimateZoom({ ...base, innerWidth: 1368, dpr: 2.5 }), 1.25);
  close(b.width, a.width, 1e-9);
  close(b.height, a.height, 1e-9);
  close(b.metresPerCssPx, a.metresPerCssPx * 1.25, 1e-12);
});

test('fullscreen detection without the Fullscreen API (window fills the screen)', () => {
  assert.equal(isFullscreen(fullscreenInfo({ elementFullscreen: false })), true);
  assert.equal(isFullscreen(fullscreenInfo({ elementFullscreen: false, innerHeight: 1020, outerHeight: 1107 })), false);
});

test('notch camera sits centred, just below the top edge of the active area', () => {
  const cam = cameraPosition(AIR15, { kind: 'notch' });
  close(cam.x, 0, 1e-12);
  // REFERENCES 1.2: lens 0-5 mm below the top edge, start at +103 mm.
  close(cam.y, 0.103, 0.0005);
  const trimmed = cameraPosition(AIR15, { kind: 'notch' }, { x: 0, y: -1.5 });
  close(trimmed.y, cam.y - 0.0015, 1e-12);
  const above = cameraPosition(AIR15, { kind: 'above', offsetMm: { x: 10, y: 18 } });
  close(above.x, 0.01, 1e-12);
  close(above.y, AIR15.height / 2 + 0.018, 1e-12);
});

test('camera -> display: the viewer moving right moves left in the image but right on the display', () => {
  const cam = cameraPosition(AIR15, { kind: 'notch' });
  // A face straight ahead of the camera, then 10 cm to the viewer's right.
  // In the raw (unmirrored) image the viewer's right is image-left: camera x < 0.
  const ahead = cameraToDisplay({ x: 0, y: 0.1, z: 0.6 }, cam);
  const right = cameraToDisplay({ x: -0.1, y: 0.1, z: 0.6 }, cam);
  assert.ok(right.x > ahead.x);
  close(right.x - ahead.x, 0.1, 1e-12);
  // Image y down = display y up flipped: a face lower in the image is lower on the display.
  close(ahead.y, cam.y - 0.1, 1e-12);
  close(ahead.z, 0.6, 1e-12);
});

test('credit card calibration recovers the display size', () => {
  const info = fullscreenInfo();
  const css = cardCssWidth(AIR15, info);
  close(css, (CARD_MM.width / 1000) / (AIR15.width / 1710), 1e-9);
  const back = sizeFromCard(css, info);
  close(back.widthMm, AIR15.width * 1000, 1e-6);
  close(back.heightMm, AIR15.height * 1000, 0.1); // screen.height is whole points
  const custom = displaySize('custom', back);
  close(custom.width, AIR15.width, 1e-9);
});

test('external monitor is flagged by its aspect ratio', () => {
  assert.equal(screenMatchesPreset(fullscreenInfo(), AIR15), true);
  assert.equal(screenMatchesPreset(fullscreenInfo({ screenWidth: 2560, screenHeight: 1440 }), AIR15), false);
});

test('a side panel is not page zoom: zoom comes from devicePixelRatio on the built-in display', () => {
  // Windowed Chrome filling the screen width, toolbar 87 pt, Chrome's side
  // panel (or docked developer tools) 320 pt wide on the right.
  const windowed = {
    screenWidth: 1710, screenHeight: 1107, screenX: 0, screenY: 33, outerWidth: 1710, outerHeight: 1074,
    innerHeight: 987, dpr: 2, elementFullscreen: false,
  };
  const panel = { ...windowed, innerWidth: 1390 };
  assert.equal(estimateZoom(panel, { retina: true }), 1, 'not 1.25');
  const vp = viewportOnDisplay(panel, AIR15, { retina: true });
  close(vp.width, (1390 / 1710) * AIR15.width, 1e-9, 'canvas width (265 mm)');
  close(vp.centre.x, ((695 - 855) / 1710) * AIR15.width, 1e-9, 'centre x (-31 mm)');
  close(vp.sidePanelPt, 320, 1e-9);
  // Page zoom 125 % with the same panel: 1112 CSS px wide, dpr 2.5.
  const zoomed = { ...windowed, innerWidth: 1112, dpr: 2.5 };
  assert.equal(estimateZoom(zoomed, { retina: true }), 1.25);
  close(viewportOnDisplay(zoomed, AIR15, { retina: true }).sidePanelPt, 320, 1e-9);
  // No panel: nothing left over.
  close(viewportOnDisplay({ ...windowed, innerWidth: 1710 }, AIR15, { retina: true }).sidePanelPt, 0, 1e-9);
  // Unknown screens keep the old rule (window width / page width).
  assert.equal(estimateZoom({ ...panel, dpr: 1, innerWidth: 1368 }), 1.25);
});

test('pixel ratio cap: never draw more pixels than the panel has', () => {
  // 15-inch Air at "looks like 1710 x 1107": devicePixelRatio 2 renders
  // 3420 px across a 2880 px panel (macOS downsamples, 41 % wasted).
  close(panelPixelRatio(AIR15, fullscreenInfo()), 2880 / 1710, 1e-9);
  // Page zoom 125 %: one CSS pixel covers 1.25 points.
  close(panelPixelRatio(AIR15, fullscreenInfo({ dpr: 2.5 }), 1.25), (2880 / 1710) * 1.25, 1e-9);
  // "More space" scaling (1920 points across): 1.5 panel pixels per point.
  close(panelPixelRatio(AIR15, fullscreenInfo({ screenWidth: 1920, screenHeight: 1242.5 })), 1.5, 1e-9);
  // Unknown panel (measured with a card) or a different screen: no cap.
  assert.equal(panelPixelRatio(displaySize('custom', { widthMm: 300, heightMm: 200 }), fullscreenInfo()), Infinity);
  assert.equal(panelPixelRatio(AIR15, fullscreenInfo({ screenWidth: 2560, screenHeight: 1440 })), Infinity);
});

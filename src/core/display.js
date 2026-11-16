// Physical display model: where the canvas and the camera sit on the real screen.
//
// Three frames (see docs/ARCHITECTURE.md):
//   camera  - the webcam's own frame, computer-vision convention: x right in the
//             raw (unmirrored) image, y down, z out of the lens toward the viewer.
//   display - metres, origin at the centre of the display's active area, x right
//             (as the viewer sees it), y up, z toward the viewer. Glass at z = 0.
//   window  - same axes as display, origin at the centre of the canvas.
//
// The camera faces the viewer, so its image x runs opposite to display x and its
// image y opposite to display y: display = (-xc, -yc, zc) + cameraPosition.
// When the viewer moves to their right they move left in the raw image, which
// makes display x (and window x) increase.

const MM = 0.001;
const INCH = 0.0254;

/** Credit card, ISO/IEC 7810 ID-1. */
export const CARD_MM = { width: 85.6, height: 53.98 };

/**
 * Built-in display presets. Pixel counts and ppi are Apple's published specs
 * (docs/REFERENCES.md section 1.1). The 15-inch Air notch was measured with
 * NSScreen on the target machine; the lens height inside the notch is not
 * published anywhere, so `cameraBelowTopMm` is an estimate (to verify) that
 * the steady check's reflection test can correct.
 */
export const DISPLAY_PRESETS = {
  'mba15-m2': {
    label: 'MacBook Air 15-inch (M2, M3)',
    pixels: [2880, 1864],
    ppi: 224,
    notchMm: { width: 35.33, height: 6.3 }, // 185 x 33 pt, measured
    cameraBelowTopMm: 2.7, // to verify (REFERENCES 1.2: 0-5 mm)
  },
  'mba13-m2': {
    label: 'MacBook Air 13-inch (M2, M3)',
    pixels: [2560, 1664],
    ppi: 224,
    notchMm: { width: 35, height: 6.3 }, // to verify
    cameraBelowTopMm: 2.7, // to verify
  },
  'mbp14': {
    label: 'MacBook Pro 14-inch',
    pixels: [3024, 1964],
    ppi: 254,
    notchMm: { width: 30, height: 6.3 }, // to verify
    cameraBelowTopMm: 2.7, // to verify
  },
  'mbp16': {
    label: 'MacBook Pro 16-inch',
    pixels: [3456, 2234],
    ppi: 254,
    notchMm: { width: 30, height: 6.3 }, // to verify
    cameraBelowTopMm: 2.7, // to verify
  },
};

export const DEFAULT_DISPLAY = 'mba15-m2';

/**
 * Physical size of a display in metres.
 * @param {string} presetId one of DISPLAY_PRESETS, or 'custom'
 * @param {{widthMm:number,heightMm:number}} [custom] measured size for 'custom'
 */
export function displaySize(presetId, custom) {
  if (presetId === 'custom') {
    if (!custom || !(custom.widthMm > 0 && custom.heightMm > 0)) {
      throw new RangeError('custom display needs widthMm and heightMm');
    }
    return { width: custom.widthMm * MM, height: custom.heightMm * MM, notch: null, cameraBelowTop: 0.0027 };
  }
  const p = DISPLAY_PRESETS[presetId];
  if (!p) throw new RangeError(`unknown display preset ${presetId}`);
  return {
    width: (p.pixels[0] / p.ppi) * INCH,
    height: (p.pixels[1] / p.ppi) * INCH,
    notch: p.notchMm ? { width: p.notchMm.width * MM, height: p.notchMm.height * MM } : null,
    cameraBelowTop: (p.cameraBelowTopMm ?? 2.7) * MM,
    pixels: [...p.pixels],
  };
}

/**
 * Panel pixels per CSS pixel: the most detail the screen can show. A larger
 * drawing buffer is drawn and then thrown away by macOS's downsample (the
 * 15-inch Air at "looks like 1710 x 1107" has devicePixelRatio 2, i.e. 3420
 * pixels across a 2880-pixel panel). Infinity when the panel is unknown
 * (measured with a card) or the page is on a different screen.
 * @param {{pixels?:number[], width:number, height:number}} size from displaySize()
 * @param {object} info from readScreenInfo()
 * @param {number} [zoom] browser zoom (CSS px -> points)
 */
export function panelPixelRatio(size, info, zoom = 1) {
  if (!size.pixels || !screenMatchesPreset(info, size)) return Infinity;
  return (size.pixels[0] / info.screenWidth) * zoom;
}

/** Aspect ratio a preset expects of `screen.width / screen.height`. */
export function presetAspect(presetId, custom) {
  const s = displaySize(presetId, custom);
  return s.width / s.height;
}

const CHROME_ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

function snapZoom(z) {
  let best = 1;
  let err = Infinity;
  for (const c of CHROME_ZOOMS) {
    const e = Math.abs(c - z) / c;
    if (e < err) { err = e; best = c; }
  }
  return err < 0.03 ? best : null;
}

/**
 * Snapshot of everything the browser says about where this page sits.
 * Kept as plain numbers so the mapping is testable without a browser.
 */
export function readScreenInfo(win = globalThis.window) {
  const s = win.screen;
  return {
    screenWidth: s.width,
    screenHeight: s.height,
    screenX: win.screenX,
    screenY: win.screenY,
    outerWidth: win.outerWidth,
    outerHeight: win.outerHeight,
    innerWidth: win.innerWidth,
    innerHeight: win.innerHeight,
    dpr: win.devicePixelRatio || 1,
    elementFullscreen: !!(win.document && win.document.fullscreenElement),
  };
}

/**
 * Browser zoom: CSS pixels -> screen points (DIPs).
 *
 * On a Retina display (every built-in Mac display) devicePixelRatio is the
 * backing scale 2 times the zoom, whatever else is on screen, so dpr / 2 is
 * read first (REFERENCES 1.5). outerWidth / innerWidth also equals the zoom,
 * but only while no side panel or docked developer tools share the window: a
 * 320-point panel beside a 1390-point page reads as 125 % zoom. It is the
 * fallback for screens of unknown backing scale.
 * @param {{retina?:boolean}} [o] retina: the page is on a known Retina display
 */
export function estimateZoom(info, { retina = false } = {}) {
  if (retina) {
    const z = snapZoom(info.dpr / 2);
    if (z) return z;
  }
  if (info.innerWidth > 0) {
    const z = snapZoom(info.outerWidth / info.innerWidth);
    if (z) return z;
  }
  return snapZoom(info.dpr / 2) || 1;
}

/** Is the page on the built-in display a preset describes (a Retina panel)? */
export function onBuiltInDisplay(info, size) {
  return !!size.pixels && screenMatchesPreset(info, size);
}

/**
 * Where the page's viewport sits on the physical display.
 * Returns the viewport rectangle in screen points (DIPs, origin top-left of the
 * screen, y down) and, in display coordinates (metres), its centre and size.
 *
 * Browser chrome on macOS is all above the page. In full screen the content is
 * anchored to the bottom of the screen: on notched displays macOS keeps the
 * strip beside the notch black, so the page starts below it. Width the window
 * has beyond the page is a side panel (sidePanelPt), assumed on the right,
 * where Chrome puts it by default.
 */
export function viewportOnDisplay(info, size, {
  retina = onBuiltInDisplay(info, size),
  zoom = estimateZoom(info, { retina }),
} = {}) {
  const mPerPt = size.width / info.screenWidth;
  const vpW = info.innerWidth * zoom;
  const vpH = info.innerHeight * zoom;
  const fullscreen = isFullscreen(info, zoom);
  let left;
  let top;
  if (fullscreen) {
    left = (info.screenWidth - vpW) / 2;
    top = info.screenHeight - vpH;
  } else {
    left = info.screenX;
    top = info.screenY + Math.max(0, info.outerHeight - vpH);
  }
  return {
    fullscreen,
    zoom,
    sidePanelPt: fullscreen ? 0 : Math.max(0, info.outerWidth - vpW),
    metresPerPoint: mPerPt,
    metresPerCssPx: mPerPt * zoom,
    points: { left, top, width: vpW, height: vpH },
    centre: {
      x: (left + vpW / 2 - info.screenWidth / 2) * mPerPt,
      y: (info.screenHeight / 2 - (top + vpH / 2)) * mPerPt,
    },
    width: vpW * mPerPt,
    height: vpH * mPerPt,
  };
}

/**
 * True when the page covers the screen: element full screen, or the window
 * itself filling the display (green-button full screen with the toolbar hidden).
 */
export function isFullscreen(info, zoom = estimateZoom(info)) {
  if (info.elementFullscreen) return true;
  const w = info.innerWidth * zoom;
  const h = info.innerHeight * zoom;
  // Allow for the notch strip (up to ~40 pt) that macOS leaves black.
  return Math.abs(w - info.screenWidth) <= 2 && h >= info.screenHeight - 44 && info.outerHeight - h <= 2;
}

/**
 * Camera lens position in display coordinates (metres).
 * @param {{kind:'notch'}|{kind:'above', offsetMm:{x:number,y:number,z?:number}}} mount
 *   'notch': centred in the notch of a built-in display.
 *   'above': relative to the top-centre of the active area (y up, so a camera
 *   sitting above the screen has a positive y offset).
 * @param {{x:number,y:number}} [trimMm] user fine-tuning from the steady check
 */
export function cameraPosition(size, mount, trimMm = null) {
  const tx = trimMm ? trimMm.x * MM : 0;
  const ty = trimMm ? trimMm.y * MM : 0;
  if (mount.kind === 'notch') {
    return { x: tx, y: size.height / 2 - size.cameraBelowTop + ty, z: 0 };
  }
  const o = mount.offsetMm || { x: 0, y: 0, z: 0 };
  return { x: o.x * MM + tx, y: size.height / 2 + o.y * MM + ty, z: (o.z || 0) * MM };
}

/** Camera-frame point -> display coordinates. */
export function cameraToDisplay(p, camPos, out = {}) {
  out.x = -p.x + camPos.x;
  out.y = -p.y + camPos.y;
  out.z = p.z + camPos.z;
  return out;
}

/** Camera-frame direction -> display direction (no translation). */
export function cameraDirToDisplay(v, out = {}) {
  out.x = -v.x;
  out.y = -v.y;
  out.z = v.z;
  return out;
}

/** Display-frame point -> window coordinates for a viewport from viewportOnDisplay(). */
export function displayToWindow(p, vp, out = {}) {
  out.x = p.x - vp.centre.x;
  out.y = p.y - vp.centre.y;
  out.z = p.z;
  return out;
}

/** Window-frame point -> display coordinates. */
export function windowToDisplay(p, vp, out = {}) {
  out.x = p.x + vp.centre.x;
  out.y = p.y + vp.centre.y;
  out.z = p.z;
  return out;
}

/**
 * Credit-card calibration: the user resizes an on-screen card outline until it
 * matches a real card held against the glass. From the outline's width in CSS
 * pixels, recover the physical display size.
 */
export function sizeFromCard(cardCssWidth, info, zoom = estimateZoom(info)) {
  if (!(cardCssWidth > 0)) throw new RangeError('card width must be positive');
  const mPerCss = (CARD_MM.width * MM) / cardCssWidth;
  const mPerPt = mPerCss / zoom;
  return {
    widthMm: (info.screenWidth * mPerPt) / MM,
    heightMm: (info.screenHeight * mPerPt) / MM,
  };
}

/** CSS width of a credit card on this display, for drawing the initial outline. */
export function cardCssWidth(size, info, zoom = estimateZoom(info)) {
  const mPerCss = (size.width / info.screenWidth) * zoom;
  return (CARD_MM.width * MM) / mPerCss;
}

/**
 * Does the screen the page is on look like the preset? Catches an external
 * monitor or a wrong preset (all Apple scaled modes keep the panel's aspect).
 */
export function screenMatchesPreset(info, size) {
  const a = info.screenWidth / info.screenHeight;
  const b = size.width / size.height;
  return Math.abs(a - b) / b < 0.015;
}

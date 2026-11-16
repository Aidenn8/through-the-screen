// Camera models: field of view and where the lens sits relative to the display.
//
// Field-of-view numbers are estimates until checked against docs/REFERENCES.md;
// the steady check lets the viewer correct them by eye. The FOV is given for
// the camera's native 16:9 frame. A 4:3 request is a centre crop of that frame
// (same height), so the focal length in pixels follows the frame height.

export const CAMERA_PRESETS = {
  'builtin-notch': {
    label: 'Built-in camera',
    hint: 'The FaceTime HD camera in the notch.',
    hfovDeg: 68, // to verify: FaceTime HD 1080p, ~75 deg diagonal for 16:9
    nativeAspect: 16 / 9,
    mount: { kind: 'notch' },
    mirrored: false,
    toVerify: ['hfovDeg'],
  },
  'iphone-lid': {
    label: 'iPhone on top of the lid',
    hint: 'Continuity Camera. Turn off Center Stage and Desk View: they crop and pan the picture.',
    hfovDeg: 65, // to verify: main (wide) camera, 16:9 stream
    nativeAspect: 16 / 9,
    // Lens above the top edge of the screen; sideways offset depends on the mount.
    mount: { kind: 'above', offsetMm: { x: 0, y: 18, z: 0 } },
    mirrored: false,
    toVerify: ['hfovDeg', 'mount'],
  },
  'external-top': {
    label: 'Webcam on top of the screen',
    hint: 'A USB camera clipped to the top edge.',
    hfovDeg: 70,
    nativeAspect: 16 / 9,
    mount: { kind: 'above', offsetMm: { x: 0, y: 12, z: 0 } },
    mirrored: false,
    toVerify: ['hfovDeg', 'mount'],
  },
};

/** Pick a preset from a device label ("FaceTime HD Camera" vs anything else). */
export function guessCameraPreset(label = '') {
  if (/facetime|built-?in/i.test(label)) return 'builtin-notch';
  if (/iphone|continuity/i.test(label)) return 'iphone-lid';
  // macOS names Continuity Camera "<owner> Camera"; treat unknown cameras on a
  // MacBook as the phone on the lid, which is by far the most common case.
  if (/camera$/i.test(label.trim())) return 'iphone-lid';
  return 'external-top';
}

/**
 * Pinhole intrinsics for a delivered frame.
 * @param {number} width delivered frame width (px)
 * @param {number} height delivered frame height (px)
 * @param {number} hfovDeg horizontal field of view of the native frame
 * @param {number} nativeAspect native frame aspect (width / height)
 */
export function intrinsicsFor(width, height, hfovDeg, nativeAspect = 16 / 9) {
  const tanH = Math.tan((hfovDeg * Math.PI) / 360);
  // Focal length as a fraction of the native frame width, then height.
  const fPerNativeWidth = 0.5 / tanH;
  const fPerNativeHeight = fPerNativeWidth * nativeAspect;
  const aspect = width / height;
  // Narrower than native: crop of the sides, height preserved. Wider: crop of top/bottom.
  const f = aspect <= nativeAspect + 1e-6 ? fPerNativeHeight * height : fPerNativeWidth * width;
  return { fx: f, fy: f, cx: width / 2, cy: height / 2, width, height };
}

/** Horizontal FOV (deg) of a delivered frame, for display in the UI. */
export function deliveredHfov(intr) {
  return (2 * Math.atan(intr.width / 2 / intr.fx) * 180) / Math.PI;
}

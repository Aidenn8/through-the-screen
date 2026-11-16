// Camera delay from screen flashes (REFERENCES 4.3, in-app loopback).
//
// Chrome on macOS stamps a frame's captureTime when it receives it, after
// exposure, readout and image processing. The app needs the time the light
// hit the sensor (the middle of the exposure), so it subtracts a delay that
// differs per camera. To measure it, the screen flashes white in a dark
// room; the face (and room) brighten in the camera picture. For one flash:
//
//   photons appear at   T = tOn + display delay (the frame with the flash
//                       was drawn at tOn, and is seen ~1.5 frames later)
//   a frame's brightness rises with how much of its exposure falls after T,
//   so it is halfway up when the middle of the exposure is at T;
//   interpolating captureTime at half brightness gives t50 = T + delay.
//
//   delay = t50 - tOn - display delay
//
// With short exposures the jump happens within one frame and t50 is only
// known to a frame; flashes at random phases average that out.

/**
 * When the light hit the sensor (ms): the frame's captureTime less the
 * camera's hidden delay. Everything the eye track is told (samples and
 * frames without a face) uses this one clock, or the delay would eat into
 * the gap it coasts through.
 * @param {number} tCap captureTime (ms) @param {number} [delayMs]
 */
export function sensorTime(tCap, delayMs = 0) {
  return tCap - (Number.isFinite(delayMs) ? delayMs : 0);
}

/**
 * @param {{tOn:number, frames:{t:number, lum:number}[]}} flash one flash:
 *   when it was drawn and the camera frames around it (t = captureTime)
 * @returns {{t50:number, jump:number, noise:number}|null}
 */
export function halfwayTime({ tOn, frames }) {
  const before = frames.filter((f) => f.t < tOn).slice(-8);
  const after = frames.filter((f) => f.t >= tOn);
  if (before.length < 3 || after.length < 3) return null;
  const base = before.reduce((s, f) => s + f.lum, 0) / before.length;
  const noise = Math.sqrt(before.reduce((s, f) => s + (f.lum - base) ** 2, 0) / before.length);
  // Peak: brightest of the first frames after the flash (auto exposure soon
  // pulls it back down).
  const early = after.filter((f) => f.t < tOn + 400);
  const peak = Math.max(...early.map((f) => f.lum));
  const jump = peak - base;
  if (!(jump > 0)) return null;
  const half = base + jump / 2;
  let prev = before.at(-1);
  for (const f of after) {
    if (f.lum >= half) {
      const u = (half - prev.lum) / Math.max(1e-9, f.lum - prev.lum);
      return { t50: prev.t + u * (f.t - prev.t), jump, noise };
    }
    prev = f;
  }
  return null;
}

/**
 * @param {Array} flashes see halfwayTime
 * @param {{displayMs:number}} o display delay the app assumes (1.5 vsync + 5)
 * @returns {{delayMs:number, spreadMs:number, n:number, weak:boolean}|null}
 */
export function estimateDelay(flashes, { displayMs }) {
  // A flash the camera barely saw (room too bright) is not usable.
  const usable = flashes
    .map((f) => ({ r: halfwayTime(f), tOn: f.tOn }))
    .filter(({ r }) => r && r.jump > 8 * Math.max(r.noise, 0.5))
    .map(({ r, tOn }) => ({ ...r, tOn }));
  if (usable.length < 3) return { delayMs: NaN, spreadMs: NaN, n: usable.length, weak: true };
  const d = usable.map((r) => r.t50 - r.tOn - displayMs).sort((a, b) => a - b);
  const median = d.length % 2 ? d[d.length >> 1] : (d[d.length / 2 - 1] + d[d.length / 2]) / 2;
  const mean = d.reduce((s, x) => s + x, 0) / d.length;
  const spread = Math.sqrt(d.reduce((s, x) => s + (x - mean) ** 2, 0) / d.length);
  return { delayMs: median, spreadMs: spread, n: d.length, weak: false };
}

// Eye presets and scripted head paths for the scene lab and the shot tools.
// Window coordinates, metres (see docs/ARCHITECTURE.md).

export const PRESETS = {
  center: [0, 0, 0.6],
  left: [-0.25, 0, 0.6],
  right: [0.25, 0, 0.6],
  up: [0, 0.12, 0.6],
  down: [0, -0.12, 0.6],
  near: [0, 0, 0.35],
  far: [0, 0, 0.9],
};

// Order used by the contact sheets.
export const SHEET_ORDER = ['left', 'center', 'right', 'up', 'down', 'near', 'far'];

const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

// Keyframed path: [time s, x, y, z]; eased between keys.
function keyed(keys) {
  const total = keys[keys.length - 1][0];
  return {
    duration: total,
    at(t) {
      const tt = Math.min(Math.max(t, 0), total);
      let i = 0;
      while (i < keys.length - 2 && tt > keys[i + 1][0]) i++;
      const [t0, ...a] = keys[i];
      const [t1, ...b] = keys[i + 1];
      const u = t1 > t0 ? smooth((tt - t0) / (t1 - t0)) : 0;
      return [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
    },
  };
}

export const PATHS = {
  // Side-to-side lean, the most common head motion.
  sway: {
    duration: 4,
    at: (t) => [0.22 * Math.sin((2 * Math.PI * t) / 4), 0.015 * Math.sin((2 * Math.PI * t) / 2), 0.6],
  },
  // Slow circle around the centre line.
  orbit: {
    duration: 6,
    at: (t) => {
      const a = (2 * Math.PI * t) / 6;
      return [0.2 * Math.cos(a), 0.1 * Math.sin(a), 0.6];
    },
  },
  // Choreography for a demo video: hold, lean left, sweep right, up, down, push in, pull out.
  reveal: keyed([
    [0, 0, 0, 0.6],
    [1.2, 0, 0, 0.6],
    [3.4, -0.25, 0.01, 0.58],
    [4.4, -0.25, 0.01, 0.58],
    [7.4, 0.25, 0.0, 0.58],
    [8.4, 0.25, 0.0, 0.58],
    [9.8, 0, 0.12, 0.6],
    [10.6, 0, 0.12, 0.6],
    [12.2, 0, -0.12, 0.6],
    [13.0, 0, -0.12, 0.6],
    [14.6, 0, 0, 0.36],
    [15.4, 0, 0, 0.36],
    [17.4, 0, 0, 0.9],
    [18.4, 0, 0, 0.6],
  ]),
  // Straight push in and pull back.
  push: keyed([
    [0, 0, 0, 0.9],
    [2.5, 0, 0, 0.35],
    [5, 0, 0, 0.9],
  ]),
};

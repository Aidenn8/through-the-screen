# Architecture

The laptop screen becomes a window. The webcam finds the viewer's eyes, and every
frame is drawn from exactly where the eyes are, so the scene behind the screen
holds still in space while the head moves: you can lean to look around things.

## Coordinates

All 3D code uses **window coordinates**:

- units are metres;
- origin at the centre of the canvas as it sits on the physical screen;
- x to the right, y up, z out of the screen toward the viewer;
- the glass is the plane z = 0. Scene content lives mostly at z < 0 (behind the
  glass) and may come forward to z > 0 (in front of it).

The tracker works in **camera coordinates** (the webcam's own frame) and the
display model in **display coordinates** (origin at the centre of the physical
display's active area, same axes as window coordinates). `src/core/display.js`
owns the transforms camera -> display -> window. Window = display shifted by the
canvas centre's offset on the physical display (non-zero when the browser is
not fullscreen).

## Per-frame flow

```
webcam frame -> face landmarks -> eye in camera coords -> filtered + predicted
  -> eye in window coords -> applyWindowCamera(camera, eye, W, H) -> scene.update -> render
```

`src/core/projection.js` (tested in `tests/projection.test.js`) is the single
place the frustum is built. Never call `camera.updateProjectionMatrix()` on the
window camera.

## Scene contract

Each scene is a folder `src/scenes/<id>/` whose `index.js` default-exports:

```js
export default {
  id: 'soundstage',
  title: 'Soundstage',            // shown in the scene picker
  order: 1,                       // optional: place in the scene list (lower first; the first is the default)
  async create(ctx) {
    // ctx = { THREE, renderer, size: { width, height } /* window W x H in metres */,
    //         assetBase /* URL prefix for this scene's files */, quality /* 'high' | 'low' */ }
    return {
      scene,                       // THREE.Scene
      update(dt, time, eye) {},    // eye = THREE.Vector3 in window coords (read only)
      resize(size) {},             // window size changed (metres)
      render(renderer, camera) {}, // optional; default renderer.render(scene, camera)
      dispose() {},
    };
  },
};
```

Scene assets live in `public/assets/<id>/` with a `LICENSES.md` listing every
file's source URL, author and licence. Only CC0 or CC-BY (credited) material.

## Moving the window (navigation)

The window can be carried through a scene. Its placement is the **rig**: a
position, a yaw, a pitch and a scale. A point in window coordinates maps into the
scene's own coordinates as

```
p_scene = position + Ry(yaw) · Rx(pitch) · (scale · p_window)
```

- yaw in degrees, positive turns the view to the left (counter-clockwise about +y);
- pitch in degrees, positive tilts the view up;
- scale > 1 makes the viewer larger than the set (the set looks smaller), scale
  < 1 shrinks the viewer into it (the set looks bigger). The default rig
  (position 0, yaw 0, pitch 0, scale 1) is exactly today's view.

The app builds the frustum in window coordinates as before (`projection.js` is
unchanged), with the eye, window size and near/far multiplied by `scale`, then
places the camera with the rig's rotation and position. Head tracking still adds
its parallax on top of the rig.

A scene opts in by adding `nav` to its default export:

```js
nav: {
  stations: [                      // named viewpoints; the first is the default
    { id: 'shot', title: 'The shot', pose: { position: [0, 0, 0], yaw: 0, pitch: 0, scale: 1 } },
    { id: 'inside', title: 'Inside the diner', pose: { position: [x, y, z], yaw: 180, pitch: -5, scale: 0.25 } },
  ],
  bounds: { min: [x, y, z], max: [x, y, z] }, // where the rig position may go (scene coords)
  scale: [0.15, 1.5],                         // allowed rig scale
  tour: ['shot', 'inside', ...],              // optional order for the guided tour
  room: { min: [x, y, z], max: [x, y, z] },   // optional: the eye's world position stays inside this box
}
```

A station may also carry two optional fields:

```js
{ id: 'garden', title: 'The garden', pose: { ... },
  subject: [x, y, z],        // scene point that should stay in frame at typical head moves (tests use it)
  view: {                    // limits on head tracking while at this station
    maxStrength: 1.5,        // Look around strength here is min(the user's Strength, this)
    verticalBoost: 1,        // replaces the global 1.5x up/down boost here
    maxEyeZ: 0.9,            // metres: the rendered eye's distance from the glass is clamped to this,
                             // so the viewpoint can't back into a wall behind the viewer
  } }
```

Far scenes behave like a telephoto lens: an off-centre eye mostly pans the view,
so outdoor stations want a low `maxStrength`. The app applies the limits of the
station the rig is at or gliding to, blending them over the glide, and keeps
the last station's limits while the viewer moves freely. Without `view` the
global settings apply.

`update(dt, time, eye, view)` gets a fourth argument
`view = { eyeWorld: THREE.Vector3, rig: { position, quaternion, scale } }`.
Scenes must use `view.eyeWorld` (or the camera passed to `render`) for any
world-space effect such as reflections, and may use the rig to switch detail
on and off by region. `eye` stays in window coordinates.

## Network

Everything runs on the device. The page and the face-tracking worker may only
reach the server they were loaded from (the model and the WebAssembly runtime):
`src/tracking/net-guard.js` wraps `fetch`, `XMLHttpRequest` and
`navigator.sendBeacon` before MediaPipe loads and refuses every other origin,
which also stops MediaPipe's built-in usage logging. `index.html` sets a
Content-Security-Policy with `connect-src 'self'` as a second layer for the page.
`tools/core-offline.mjs` checks it end to end.

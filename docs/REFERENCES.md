# References

Facts the window build relies on, with sources (code is in metres; this file quotes mm where
sources do). **MEASURED** = read on the target machine (Mac14,15, macOS 14.4 build 23E214) on
2026-11-12 via AppKit / CoreGraphics / AVFoundation or headless Chrome 157. **DERIVED** = arithmetic
from cited numbers. **UNVERIFIED** = no source found; each says how to measure it.

## 1. Hardware: MacBook Air 15-inch M2 (Mac14,15)

### 1.1 Display

| Quantity | Value | Source |
| --- | --- | --- |
| Panel | 15.3-inch diagonal, 2880 x 1864 at 224 ppi, rounded top corners, "actual viewable area is less" than the rectangle; 60 Hz | [Apple tech specs](https://support.apple.com/en-us/111346); 60.0 Hz MEASURED (`CGDisplayCopyDisplayMode`) |
| Active area | **326.571 x 211.412 mm** (2880/224 x 25.4, 1864/224 x 25.4; diagonal 389.0 mm = 15.32 in) | DERIVED; MEASURED `CGDisplayScreenSize` returns the same, but both come from the rounded 224 ppi panel data. UNVERIFIED below ~0.5 %: a 1500 CSS px line should measure 286.47 mm |
| Default "looks like" | **1710 x 1107** points; backing store 3420 x 2214 downsampled to the panel | MEASURED (`NSScreen.frame`); [MacRumors](https://forums.macrumors.com/threads/why-is-15-mba-default-screen-res-1710-x-1107.2446481) |
| Chrome at 100 % zoom | `screen.width x screen.height` = 1710 x 1107 CSS px; `devicePixelRatio` = 2 (backing scale 2.0 MEASURED) | DERIVED |
| One CSS px | **0.190977 mm** on both axes (326.571/1710 = 211.412/1107); 5.2363 CSS px per mm | DERIVED |
| Notch | `safeAreaInsets.top` = **33 pt**; `auxiliaryTopLeftArea` x 0-763, `auxiliaryTopRightArea` x 948-1710, both 33 pt tall. Notch = **185 x 33 pt = 35.33 x 6.30 mm**, centre at x = 855.5 pt vs 855.0 (+0.1 mm, i.e. centred) | MEASURED (`NSScreen`) |
| Menu bar | `visibleFrame` height 1068 pt, so the menu bar strip is 39 pt (7.45 mm) | MEASURED |
| Other scaled modes | 1440 x 932 (exact 2x), 1710 x 1068, 1440 x 900, 1280 x 828, 1920 x 1243, ... (x1068 / x900 are hidden "below the notch" modes) | MEASURED (`CGDisplayCopyAllDisplayModes`) |

- `devicePixelRatio` does **not** give physical size: the panel shows 1.684 device pixels per CSS px
  (2880/1710), not 2. Use `mmPerCssPx = 326.571 / screen.width`, valid in every scaled mode on the
  built-in display at 100 % page zoom.
- The notch rows are part of the reported screen (`screen.height` = 1107 includes them); pixels
  exist only left and right of the notch.

### 1.2 Camera position relative to the active area

- Horizontal: the FaceTime HD camera is in the notch and the notch is centred within 0.1 mm, so
  **camera x = 0 mm** in display coordinates (UNVERIFIED that the lens is centred in the notch).
- Vertical: **UNVERIFIED** (no teardown or Apple document gives it). The notch reaches 6.30 mm below
  the top edge of the active area and the lens sits in or just above it, so expect the lens centre
  0-5 mm below the top edge: **y_cam ~ +101 to +106 mm** from the display centre (start at +103).
  Measure b = lens centre to the notch's bottom edge with calipers; y_cam = 105.706 - 6.30 + b mm.
- Camera and panel share the rigid lid, so the transform does not change with lid angle. Whether
  the optical axis is exactly normal to the panel is UNVERIFIED; a 1 deg tilt moves the computed eye
  by 600 x tan(1 deg) = 10.5 mm at 60 cm (DERIVED), more when farther. Check it with 1.6.
- Full calibration: film the screen's pattern in a planar mirror from several poses and solve the
  camera-to-screen pose ([Rodrigues et al., ECCV 2010](https://doi.org/10.1007/978-3-642-15561-1_28);
  same problem in webcam gaze tracking, [Gudi et al. 2020](https://arxiv.org/abs/2009.01270)).

### 1.3 Built-in camera: formats, rate, field of view

- MEASURED formats (FaceTime HD Camera): 1920x1080, 1280x720, 640x480, 1760x1328, 1552x1552,
  1080x1920, 1328x1760, all **15-30 fps** (420v). Chrome cannot get more than **30 fps** from it.
  Center Stage: **not supported** on any format; Portrait effect: supported. Apple: "1080p FaceTime
  HD camera ... advanced image signal processor with computational video"
  ([specs](https://support.apple.com/en-us/111346)).
- Chrome sets both `videoMinFrameDuration` and `videoMaxFrameDuration` to 1/requested rate, i.e. a
  fixed rate ([Chromium source](https://chromium.googlesource.com/chromium/src/+/main/media/capture/video/apple/video_capture_device_avfoundation.mm)).
  Whether macOS still drops to 15 fps in dim light is UNVERIFIED: log rVFC `mediaTime` deltas in a
  dim room.
- Use **1280x720**: the landmark model resamples the face to 256x256 anyway (3.1), and in a
  four-tracker benchmark the 1080p webcam added 53-95 ms of latency for every tracker (different
  camera models, so not resolution alone;
  [Scheer & Brinkmann 2026](https://dael.euracoustics.org/confs/fa2026/data/articles/000859.pdf)).
- **Field of view: UNVERIFIED.** No published FOV or intrinsics exist for this camera (searched
  Apple specs, reviews, forums). Calibrate at the exact resolution used: on one laptop webcam the
  4:3 modes were crops, and a naive rescale gave a 24 % focal-length error
  ([webcam-camera-calibration](https://github.com/sakuragi97/webcam-camera-calibration)).
  `fx = (width/2) / tan(HFOV/2)`; placeholder HFOV 55-75 deg gives fx = 1229-834 px at 1280x720
  (DERIVED). fx(1080p) = 1.5 x fx(720p) only if both share the sensor crop (UNVERIFIED).
- Quick calibration (~1-2 %): hold an ID-1 card (85.60 x 53.98 mm,
  [ISO/IEC 7810](https://en.wikipedia.org/wiki/ISO/IEC_7810)) flat to the camera at tape-measured
  distance D from the lens; width w px gives `f = w * D / 85.60`. Better: OpenCV checkerboard
  ([tutorial](https://docs.opencv.org/4.x/dc/dbb/tutorial_py_calibration.html)).
- macOS 14 video effects apply to Chrome too: Portrait (background blur), Studio Light, Reactions
  (hand gestures trigger full-frame overlays), toggled from the Video menu / Control Center
  ([Apple 105117](https://support.apple.com/105117)). Keep Reactions and Portrait off. MEASURED now:
  Center Stage, Portrait and Studio Light all off.

### 1.4 Continuity Camera (the user's iPhone)

- The paired phone reports `iPhone18,1` = iPhone 17 Pro
  ([EveryMac](https://everymac.com/devices/by-identifier/all-iphone-pro-model-identifiers.html),
  [The Apple Wiki](https://theapplewiki.com/wiki/IPhone18,1)).
- MEASURED formats: 640x480, 1280x720, 1920x1080, 1920x1440, each at **up to 60 fps**; Center Stage
  and Portrait supported. A separate "Desk View Camera" device offers 1920x1440 at up to 30 fps.
- Lenses: 48MP Fusion Main 24 mm-equivalent f/1.78; Ultra Wide 13 mm, 120 deg
  ([Apple specs](https://www.apple.com/sa/iphone-17-pro/specs/)). Desk View uses the Ultra Wide
  ([MacRumors](https://www.macrumors.com/how-to/use-continuity-camera-iphone-mac)); Center Stage
  uses the Ultra Wide and pans/crops continuously, and with it off the wide (main) camera is used
  ([Zoom community](https://community.zoom.com/t5/Meetings/macOS-Sonoma-Continuity-Camera-iPhone-13-Wide-Angle-Only-unless/m-p/141923)).
  **Center Stage must be off**: a moving crop changes the intrinsics every frame.
- FOV of the delivered 16:9 stream: UNVERIFIED (24 mm-equivalent is ~72 deg horizontal on a 4:3
  frame, DERIVED, but the stream may be cropped or stabilised); calibrate as in 1.3. The lens
  offset from the display depends on the mount; measure it.
- Requirements: iOS 16+, macOS 13+, same Apple Account, Wi-Fi and Bluetooth on
  ([Apple 102546](https://support.apple.com/en-us/102546)). Benefit: **60 fps** halves the frame
  interval (16.7 vs 33.3 ms) vs the built-in camera.

### 1.5 Chrome fullscreen on a notched MacBook

- macOS native fullscreen keeps app content **below** the notch and paints the strip beside it
  black; a standard fullscreen app cannot draw there (Mozilla's fix notes, matching Safari:
  [bug 1737953](https://bugzilla.mozilla.org/show_bug.cgi?id=1737953);
  [Apple compatibility mode](https://www.macrumors.com/2021/10/19/macos-app-compatibility-mode-notch);
  ["displayed just below the notch"](https://developer.apple.com/forums/thread/693315);
  [black band](https://notes.alinpanaitiu.com/Fullscreen-apps-above-the-MacBook-notch)).
- Since Chrome 114, `window.screen` in fullscreen reports the display, not the window frame
  ([blink-dev PSA](https://groups.google.com/a/chromium.org/g/blink-dev/c/6iQ8yNF5npo)).
- Expected fullscreen values here (DERIVED from the 33 pt safe area; UNVERIFIED in Chrome, check on
  first run): `screen` 1710 x 1107, `innerWidth x innerHeight` = **1710 x 1074**, content top edge
  33 CSS px = **6.30 mm** below the top of the active area. Canvas **326.571 x 205.109 mm**, centre
  at display **(0, -3.151 mm)**.
- Robust rule (fullscreen content is bottom-aligned): `top = screen.height - innerHeight`,
  `left = (screen.width - innerWidth) / 2`. Never hard-code 33: with "Automatically hide and show
  the menu bar" set to Never, browsers have shown a taller top inset
  ([Vivaldi forum](https://forum.vivaldi.net/topic/90039/bug-with-full-screen-mode-and-title-bar)).
  The menu bar otherwise appears inside the black strip without covering content (bug 1737953).

Windowed mode (CSS px, origin at the display's top-left, y down; `screenY` counts from the top of
the display, menu bar included):

```
chromeTop = outerHeight - innerHeight            // tabs + toolbar; nothing docked at the bottom
cx = screenX + (outerWidth - innerWidth) / 2 + rect.left + rect.width / 2
cy = screenY + chromeTop + rect.top + rect.height / 2
k  = 326.571 / screen.width                      // mm per CSS px
canvas centre, display coords (mm): x = (cx - screen.width / 2) * k,  y = (screen.height / 2 - cy) * k
canvas size (mm): rect.width * k by rect.height * k
```

- Page zoom changes `devicePixelRatio` and CSS-px sizes but not `screenX/screenY` in Chrome
  ([W3C list summary](https://lists.w3.org/Archives/Public/public-webapps-github/2017Oct/0208.html)),
  so require `devicePixelRatio === 2` on the built-in display (or rescale by `devicePixelRatio/2`).
  Docked DevTools break the `outer - inner` split. No event fires when the window moves: poll
  `screenX/screenY` and listen for `resize`.

### 1.6 One-glance check of the whole camera-to-display chain (DERIVED)

The panel is glossy (1.63 % total reflections,
[RTINGS](https://www.rtings.com/laptop/tools/compare/apple-macbook-air-13-2022-apple-macbook-air-15-2023/33915/39095)).
With one eye closed, the open eye sees its own reflection on the perpendicular from the eye to the
glass, i.e. at glass point (eye.x, eye.y). Paint the screen black and draw a small cross at the
tracked (eye.x, eye.y) of that eye: it should sit on the pupil's reflection from any head position.
Any offset, and how it changes as you lean in and out, exposes camera offset, tilt and focal-length
errors.

## 2. Prior work and what made it convincing

| Work | Tracking | Latency / rate | Praised | What broke it |
| --- | --- | --- | --- | --- |
| Deering, SIGGRAPH 1992 ([abstract](https://hci.stanford.edu/seminar/abstracts/94-95/941021-deering.html), [patent US5446834](https://patents.google.com/patent/US5446834A/en)) | Ultrasonic head tracker, 120 Hz field-sequential stereo CRT | Patent: perceived lag "no more than 50-100 ms"; prediction | Sub-cm registration by modelling the eye: eyepoint = first nodal point, ~0.6 cm from the eye's rotation centre, moves ~0.4 cm with a 45 deg gaze shift | CRT glass refraction (up to 2 cm) and screen curvature (~1.8 cm at 60 deg) unless corrected |
| Ware, Arthur & Booth, CHI 1993 ([UNH](https://scholars.unh.edu/ccom/178)); Arthur, Booth & Ware, TOIS 1993 ([UNH](https://scholars.unh.edu/ccom/929)); Arthur's thesis ([PDF](https://www.cs.ubc.ca/labs/imager/th/1993/Arthur1993/Arthur1993.pdf)) | Mechanical tracker (< 3 ms) + shutter glasses | Total lag 50-550 ms tested (tracker lag + 1.5 frame intervals; 30/15/10 Hz plus 0-4 frames) | Tree-tracing errors: picture 22 %, stereo 14.7 %, head coupling 3.2 %, both 1.3 %; head coupling without stereo preferred over stereo alone 91 % to 9 % | Total lag above **210 ms** gave worse response times than a static picture; ~10 fps "very jittery" |
| Johnny Lee, Wiimote, Dec 2007 ([project](http://johnnylee.net/projects/wii/), [video](https://www.youtube.com/watch?v=Jd3-eiid-Uw), [FAQ](https://procrastineering.blogspot.com/2007/12/wiimote-desktopvr-faq-and-adv.html), [TED](https://www.ted.com/talks/johnny_lee_free_or_cheap_wii_remote_hacks/transcript)) | Wiimote IR camera (1024x768 blob tracking, 100 Hz, ~45 deg FOV) on two IR LEDs worn on glasses; distance from dot spacing | Not published | Untracked, the image "looks pretty flat... bound to the surface of the screen"; targets on lines popping out of a deep grid room | Lee: "the conflicting stereo depth cues weakens the illusion"; rebuilders: targets "just don't seem to pop off the screen, like they do in the video"; yaw shrinks the dot gap and reads as moving away ([Hackaday](https://hackaday.com/2007/12/21/wiimote-head-tracking-desktop-vr-display)) |
| Kooima, Generalized Perspective Projection, 2008/09 (original csc.lsu.edu PDF now offline; [PsychoPy implementation notes](https://psychopy-hoechenberger.readthedocs.io/en/latest/api/tools/viewtools.html)) | n/a (maths) | n/a | Projection + view from three screen corners and the eye; any screen pose, multiple screens, per-eye stereo. `src/core/projection.js` is its axis-aligned case | n/a |
| headtrackr.js, Oygard 2012 ([post](http://www.auduno.com/2012/06/15/head-tracking-with-webrtc/)) | Viola-Jones + camshift, double-exponential smoothing; FOV guessed by assuming 60 cm at start | Webcam rate | "looks much more convincing on video" | Camshift jitter; auto white balance / exposure |
| TheParallaxView, Norrby 2018 ([repo mirror](https://gitee.com/axiomaster/TheParallaxView)) | iPhone X TrueDepth (ARKit) eye position, asymmetric frustum | ARKit rate | README: "best seen with ONE EYE"; good on video "because video is monoscopic" | Binocular viewing |
| WonkaVision, Shopify 2023 ([write-up](https://shopify.github.io/spatial-commerce-projects/WonkaVision/), [HN](https://news.ycombinator.com/item?id=35016988)) | MediaPipe Face Mesh iris (11.7 mm); checkerboard intrinsics from ~50 photos; screen and camera offset measured in cm | Not published | Renders one eye; filmed with the iPad camera at the right eye | Rendering from the eye midpoint "makes the illusion vanish"; HN: "The latency makes it feel wobbly"; never shipped (intrinsics, screen size, one eye closed) |
| True3D "Window Mode", Habib 2025 ([post](https://danielhabib.substack.com/p/a-simpler-way-to-watch-3d), [repo](https://github.com/True3DLabs/WindowMode)) | MediaPipe FaceLandmarker in a worker; iris + head pose; smoothing with outlier rejection; distance from eye size + webcam FOV | Not published | ~100 informal testers got it with no instructions | No stereo (stated) |
| "Glasses-free 3D using webcam head tracking", HN Oct 2025 ([thread](https://news.ycombinator.com/item?id=45626685)) | Webcam face tracking | ~30 fps | "convincing if you don't move your head too fast" | Most testers saw little depth with both eyes; stutter at ~30 fps; unknown webcam FOV made distance unreliable |
| Off-axis sneaker, Curtis / World Labs 2026 ([80.lv](https://80.lv/articles/check-out-this-off-axis-projection-demo-that-uses-face-tracking-to-create-a-3d-illusion), [repo](https://github.com/icurtis1/off-axis-sneaker)) | MediaPipe Face Mesh; inter-ocular distance as depth, EMA 0.3; calibration wizard for screen size and distance | 30-60 FPS | Gaussian-splat scene with real depth | Not reported |
| Amazon Fire Phone "Dynamic Perspective" 2014 ([Gizmodo](https://gizmodo.com/how-amazons-fire-phone-cameras-know-where-your-face-is-1592859925), [TechRadar](https://www.techradar.com/reviews/phones/amazon-fire-phone-1259146/review/2)) | Four 120 deg IR corner cameras, two at a time | "60 per second" | n/a | A gimmick that "can really be done with just your fingers" |
| Sony Spatial Reality Display ([white paper](https://xyn.sony.net/en/developer/technical/spatial-reality-display/whitepaper)) | Eye-sensing camera + micro-lens stereo | "millisecond response" (no figure) | True per-eye stereo | One viewer, 30-75 cm, >= 100 lux on the face; "delay would degrade the illusion" |

Common thread: every convincing clip is **monocular** (a camera, or one closed eye). The failures
are both-eyes viewing, visible lag at ~30 fps, and wrong scale from an uncalibrated FOV or screen.

## 3. Tracking with MediaPipe FaceLandmarker (@mediapipe/tasks-vision 1.2.3)

### 3.1 What the installed package gives you

Read from `node_modules/@mediapipe/tasks-vision/` (`vision.d.ts`, `README.md`,
`vision_bundle.mjs`), the [guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker)
and the [web guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js).

- BlazeFace short-range detector (192x192) then the landmark model (**256x256 input**), float16,
  **478 landmarks** (468 mesh + 10 iris). The face crop is resampled to 256x256, so at 40-70 cm
  precision depends mostly on the model input, not on 720p vs 1080p (DERIVED: a face at 60 cm spans
  roughly 250-300 px of a 1280x720 frame).
- `faceLandmarks[i]`: x, y normalised to [0, 1] by image width and height; z is relative depth
  "scaled like x" around the head centre, not metric.
- Defaults: `runningMode` IMAGE (use VIDEO), `numFaces` 1, the three confidence thresholds 0.5,
  `outputFaceBlendshapes` and `outputFacialTransformationMatrixes` false. `detectForVideo(frame,
  timestampMs)` needs increasing timestamps.
- **Built-in smoothing:** "Temporal smoothing is applied when numFaces is set to 1" (guide): a One
  Euro filter with **min_cutoff 0.05, beta 80, derivate_cutoff 1.0**, per coordinate, after scaling
  by 1/face size
  ([face_landmarks_detector_graph.cc](https://github.com/google/mediapipe/blob/master/mediapipe/tasks/cc/vision/face_landmarker/face_landmarks_detector_graph.cc),
  [landmarks_smoothing_calculator_utils.cc](https://github.com/google/mediapipe/blob/master/mediapipe/calculators/util/landmarks_smoothing_calculator_utils.cc)).
  Any `runningMode` other than IMAGE sets `use_stream_mode` in this bundle, which enables it; the
  graph smooths only when `num_faces == 1`
  ([face_landmarker_graph.cc](https://github.com/google/mediapipe/blob/master/mediapipe/tasks/cc/vision/face_landmarker/face_landmarker_graph.cc)).
  For raw landmarks (recommended: run one filter on the final eye point), set **`numFaces: 2`**.
  MEASURED (3.4): with `numFaces: 2` jitter on a static noisy face is 6-10x higher, so the filter is
  off. The built-in filter is very sticky at rest, and double filtering adds lag.

### 3.2 Landmark indices

From `FaceLandmarker.FACE_LANDMARKS_*` in the installed bundle. "Left/right" are the **subject's**
(as `vision.d.ts` says for blendshapes); the subject's right eye is on the image's left in an
unmirrored frame.

| Feature | Subject's right eye | Subject's left eye |
| --- | --- | --- |
| Outer corner | 33 | 263 |
| Inner corner | 133 | 362 |
| Iris centre | 468 | 473 |
| Iris contour ring (connection order) | 469-470-471-472 | 474-475-476-477 |
| Opposite contour pairs | (469, 471), (470, 472) | (474, 476), (475, 477) |

- Which pair is horizontal is UNVERIFIED (common code uses 469/471 and 474/476); plot them once.
- Canonical face model, cm, 0-based index
  ([canonical_face_model.obj](https://github.com/google/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model.obj)):
  33 (-4.446, 2.664, 3.173); 133 (-1.856, 2.585, 3.758); 263 (4.446, 2.664, 3.173); 362 (1.856,
  2.585, 3.758); nose tip 1 (0, -1.127, 7.476). Eye-corner midpoints (+-3.151, 2.625, 3.466),
  6.30 cm apart.
- Iris centres move with gaze, so an eye point built from them makes the scene twitch whenever the
  viewer looks around the screen. Eye-corner midpoints (or the canonical eye point pushed through
  the transformation matrix) do not (DERIVED; test by looking at the four corners, head still).

### 3.3 facialTransformationMatrixes

- 4x4 map from the canonical face to the detected face in a metric camera space; **units are
  centimetres** (set by the canonical model)
  ([Face Transform Module docs](https://github.com/google/mediapipe/blob/v0.10.9/docs/solutions/face_mesh.md)).
- `data` is **column-major** (MatrixData default,
  [matrix_data.proto](https://github.com/google/mediapipe/blob/master/mediapipe/framework/formats/matrix_data.proto)):
  `new THREE.Matrix4().fromArray(m.data)` works; translation is `data[12..14]` in cm, z negative.
- Assumed virtual camera: **63 deg vertical FOV**, near 1 cm, far 100 m, principal point at the
  image centre
  ([face_geometry_from_landmarks_graph.cc](https://github.com/google/mediapipe/blob/master/mediapipe/tasks/cc/vision/face_geometry/face_geometry_from_landmarks_graph.cc)).
  Depth comes from the scale that fits a fixed-size canonical face (Procrustes,
  [geometry_pipeline.cc](https://github.com/google/mediapipe/blob/master/mediapipe/tasks/cc/vision/face_geometry/libs/geometry_pipeline.cc)).
  Rescale with `z_true = z_mp * f_true / f_63`, f_63 = (H/2)/tan(31.5 deg) = **587.6 px at 720p**
  (881.4 px at 1080p). 63 deg vertical on 16:9 is 94.9 deg horizontal, wider than any likely
  notch camera, so the raw translation under-reports distance (DERIVED). Individual face size
  still biases it.
- Accuracy: no published figures (UNVERIFIED). The rotation is the useful part: head yaw/pitch to
  correct the IPD (3.5).

### 3.4 Speed, GPU delegate, workers

- GPU delegate needs `canvas` (HTMLCanvasElement or OffscreenCanvas) and WebGL2 (`vision.d.ts`).
  CPU and GPU are "comparable" on an Apple M1 ([Chrome blog](https://developer.chrome.com/blog/io24-webassembly-webgpu-1));
  6.1 ms WASM / 5.2 ms WebGPU median on an M4 Pro, Chrome 134 ([third party](https://cdn.jsdelivr.net/npm/@svenflow/micro-facemesh@0.1.2/README.md)).
- MEASURED on this M2: headless Chrome 157, ANGLE Metal "Apple M2", tasks-vision 1.2.3, float16
  model, 1280x720 `ImageBitmap` input, 200 timed calls after 30 warm-up, a still face photo plus
  synthetic Gaussian noise (sigma 3-4 of 255); two runs, face IPD 58 px and 99 px.

  | Delegate, numFaces | detectForVideo median / p90 (ms) | Raw landmark SD (px) | IPD SD (px) |
  | --- | --- | --- | --- |
  | GPU, 1 (smoothed) | 13.7-21.1 / 19.4-31.5 | 0.01-0.05 | 0.03-0.06 |
  | GPU, 2 (raw) | 18.1-20.1 / 25.9-31.0 | 0.14-0.43 | 0.32-0.33 |
  | CPU, 1 (smoothed) | 15.4-15.7 / 16.2-16.6 | 0.01-0.04 | 0.03-0.05 |
  | CPU, 2 (raw) | 17.7-17.9 / 18.2-18.8 | 0.2-0.8 | 0.41-0.48 |

  Budget **~15-20 ms per frame**; CPU (XNNPACK) was steadier than GPU. Re-time in the real app
  (headless may differ). Synthetic noise is a lower bound on real jitter (no compression, flicker or
  head micro-motion). Raw IPD SD 0.37 px of 99 px is ~2.2 mm of depth noise at 60 cm (DERIVED).
- Keep inference off the render thread: a 15-20 ms synchronous call costs a 60 Hz frame per camera
  frame. In a worker: `canvas` accepts OffscreenCanvas; `FilesetResolver.forVisionTasks(basePath,
  useModule)` with `useModule = true` loads `vision_wasm_module_internal.js` (`vision.d.ts`), needed
  because module workers have no `importScripts`
  ([Stack Overflow](https://stackoverflow.com/questions/76222648/how-to-use-a-web-worker-with-mediapipe-vision)).
  `ImageSource` is `TexImageSource`, so transfer `ImageBitmap`s or `VideoFrame`s.

### 3.5 Depth: iris diameter vs interpupillary distance

| Cue | Population figure | Source |
| --- | --- | --- |
| Horizontal iris diameter | 11.7 +- 0.5 mm "across a wide population" | [Google Research, MediaPipe Iris](https://research.google/blog/mediapipe-iris-real-time-iris-tracking-depth-estimation/) |
| White-to-white corneal diameter | 11.82 +- 0.40 mm, 23,239 eyes | [Hoffmann & Hütz 2010, JCRS](https://pubmed.ncbi.nlm.nih.gov/20692558/) |
| IPD, women | 61.7 +- 3.6 mm (n = 1986; 5th-95th 55.5-67.5) | ANSUR II 2012 (Gordon et al. 2014, NATICK/TR-15/007) via [Wikipedia](https://en.wikipedia.org/wiki/Pupillary_distance) |
| IPD, men | 64.0 +- 3.4 mm (n = 4082; 5th-95th 58.5-70.0) | same |
| IPD, all adults | mean near 63 mm, nearly all 50-75 mm | [Dodgson 2004](https://doi.org/10.1117/12.529999) |

- MediaPipe's iris depth calculator uses 11.8 mm: `depth = 11.8 * sqrt(f^2 + r^2) / irisPx`, r =
  pixel distance of the iris centre from the image centre, averaging both contour-pair diameters
  ([iris_to_depth_calculator.cc](https://github.com/google/mediapipe/blob/master/mediapipe/graphs/iris_tracking/calculators/iris_to_depth_calculator.cc)).
  With a known focal length: 4.3 % mean relative error (SD 2.4 %; 4.8 % with glasses), 200+ people.
- Yaw (DERIVED): projected IPD shrinks by cos(yaw), so IPD depth reads too far by 1/cos(yaw):
  +1.5 % at 10 deg, +6.4 % at 20 deg, +15.5 % at 30 deg (+9, +38, +93 mm at 60 cm). Correct with the
  matrix yaw. The iris foreshortens with the gaze-to-camera angle instead (small while looking at
  the screen; ~10 deg pitch to the screen centre at 60 cm, so use the horizontal pair).
- Noise at 1280x720 (DERIVED; fx ~ 950 px UNVERIFIED, ~0.4 px raw distance noise from 3.4): at
  60 cm the IPD spans ~100 px and the iris ~18.5 px, so per-frame depth noise is ~2-4 mm (IPD) vs
  ~13-23 mm (iris); at 90 cm ~5-10 mm vs ~30-51 mm (grows with distance squared). Bias for an
  unknown person goes the other way: iris +-3.4-4.3 %, IPD +-5.5 %.
- Recommendation: per-frame depth from the yaw-corrected IPD of eye-corner midpoints (or the
  full-face scale); remove the personal bias once by averaging iris depth over 2-3 s at start (or a
  tape-measured 60 cm step) and store the resulting personal IPD.

## 4. Filtering, prediction and latency

### 4.1 One Euro filter (Casiez, Roussel & Vogel, CHI 2012)

- Per sample: `dx = (x - xPrev) * rate`; `edx = lowpass(dx, alpha(dcutoff))`; `cutoff = mincutoff
  + beta * |edx|`; `x = lowpass(x, alpha(cutoff))`; `alpha = 1/(1 + tau/Te)`, `tau = 1/(2 pi
  cutoff)`, `Te = 1/rate`; dcutoff fixed at 1 Hz
  ([paper](https://gery.casiez.net/publications/CHI2012-casiez.pdf),
  [authors' page](https://gery.casiez.net/1euro/)).
- Tuning: beta = 0 and mincutoff ~1 Hz; hold still and lower mincutoff until jitter is acceptable;
  move fast and raise beta until lag is acceptable ("if high speed lag is a problem, increase beta;
  if slow speed jitter is a problem, decrease fcmin"). beta depends on units; step it by factors
  of 10. Paper's mouse example (pixels, 60 Hz): mincutoff 1 Hz, beta 0.007.
- MediaPipe's values (3.1) measure speed in face sizes per second; in metres beta 80 is ~80/0.15
  = ~530 per m (DERIVED). Starting point for our filter on the eye point in metres at 30 Hz
  (DERIVED; tune as above): x/y mincutoff 1 Hz, beta ~50 per m (cutoff ~11 Hz at 0.2 m/s); z
  mincutoff ~0.3 Hz (raw depth noise is ~15x the lateral noise, 3.4). Feed real frame timestamps.

### 4.2 Prediction

- Meta/Oculus gyro data at 1000 Hz, mean error: 20 ms horizon 1.46 deg (none) / 0.19 deg (constant
  rate) / 0.076 deg (constant acceleration); 40 ms 3.36 / 0.57 / 0.17 deg. Error grows "at least
  quadratically" with horizon; cameras give far less trend information than gyros
  ([Meta blog](https://developers.meta.com/vr/blog/the-latent-power-of-prediction/)).
- Azuma kept prediction under 80 ms; error grows with interval and head-motion frequency
  ([Azuma & Bishop 1995](https://history.siggraph.org/?p=118761)). Double exponential smoothing
  predicts as well as Kalman at 50-100 ms, ~135x faster ([LaViola 2003](https://diglib.eg.org/handle/10.2312/EGVE.IPT_EGVE2003.199-206)).
- For a 30 fps webcam (DERIVED): constant-velocity prediction over 50-80 % of the measured latency,
  capped at 80 ms. It overshoots by ~v*T at a reversal (0.2 m/s x 80 ms = 16 mm) and amplifies
  jitter, so scale it down at low speed using the filter's speed estimate.

### 4.3 Measuring latency in Chrome

- `requestVideoFrameCallback` metadata: `presentationTime`, `expectedDisplayTime`, `width`,
  `height`, `mediaTime` (frame PTS, s), `presentedFrames` (gaps = dropped frames),
  `processingDuration`, `captureTime`, WebRTC-only `receiveTime`/`rtpTimestamp`; callbacks run at
  the lower of video and display rate and can be a vsync late
  ([web.dev](https://web.dev/articles/requestvideoframecallback-rvfc), [spec](https://wicg.github.io/video-rvfc/)).
- **On macOS Chrome, `captureTime` is when Chrome received the frame, not the exposure.** Chrome
  drops AVFoundation's sample timestamp unless the feature
  `AVFoundationCaptureForwardSampleTimestamps` (disabled by default) is on
  ([video_capture_device_avfoundation.mm](https://chromium.googlesource.com/chromium/src/+/main/media/capture/video/apple/video_capture_device_avfoundation.mm)),
  uses `base::TimeTicks::Now()` as the reference time
  ([video_capture_device_apple.mm](https://chromium.googlesource.com/chromium/src/+/main/media/capture/video/apple/video_capture_device_apple.mm)),
  and the renderer copies that into `capture_begin_time` "so there is a captureTime available for
  local sources"
  ([video_capture_impl.cc](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/video_capture/video_capture_impl.cc)).
  So `now - captureTime` misses exposure, readout and ISP time. For lab runs try
  `--enable-features=AVFoundationCaptureForwardSampleTimestamps` (UNVERIFIED effect on rVFC).
- Ground truth: film head and screen together in 240 fps slow motion and count frames between a
  head reversal and the on-screen reversal. In-app loopback (DERIVED): flip the screen black/white
  and time until the mean brightness of the face in the camera jumps; that loop is camera latency
  + render-to-photon; add inference time for motion-to-photon.

### 4.4 Typical end-to-end numbers

- Scheer & Brinkmann (TU Berlin, Forum Acusticum 2026): four webcam head trackers on a Mac mini
  M4, 30 fps webcams, OptiTrack reference; latency to tracker output **40 ms** (best, 720p) to
  398 ms, every other combination >= 104 ms; default smoothing "likely contributed"
  ([PDF](https://dael.euracoustics.org/confs/fa2026/data/articles/000859.pdf)).
- Ware & Balakrishnan 1994: total lag = device lag + 1.5 x frame interval; device lags ~45 ms
  (Polhemus), ~72 ms (ultrasonic) ([PDF](https://www.dgp.toronto.edu/~ravin/papers/tochi94_lag.pdf)).
- Our budget (DERIVED, built-in camera at 30 fps): half a frame interval (16.7 ms) + capture/ISP
  (UNVERIFIED, tens of ms) + inference 15-20 ms (MEASURED) + wait for rAF (0-16.7 ms) + compositor
  and scan-out (~1 frame) = roughly **70-110 ms** before prediction. The iPhone at 60 fps saves
  ~8 ms of average frame wait.

## 5. Perception: what the illusion tolerates

### 5.1 Geometry of errors (DERIVED from `glassPoint` in `src/core/projection.js`)

For a point s behind the glass and the eye d in front of it:

- Lateral eye error e moves the point's image by `e * s/(d+s)`: zero at the glass, e/2 at s = d,
  e at infinity. Far content is the most sensitive to tracking error and lag.
- Depth error barely moves images: `(p_x - e_x) * s/(d+s)^2` per unit, 0.074 mm per mm for
  p_x - e_x = 0.2 m, s = 0.3 m, d = 0.6 m.
- A constant error only shears the scene; time-varying error (noise, lag) makes it swim. With a
  depth-scale error k > 1 (x, y, z all scaled), points beyond z = k d/(k-1) move the wrong way;
  k = 1.05 at d = 0.6 m puts that at 12.6 m, so keep k within about +-5 %.
- Lag: head speed v and latency L give eye error v*L: 0.2 m/s x 100 ms = 20 mm, i.e. 10 mm on
  screen at s = d and 20 mm (1.9 deg) at infinity. For scale, acuity ~1 arcmin
  ([Wikipedia](https://en.wikipedia.org/wiki/Visual_acuity)) = 0.175 mm at 60 cm, ~1 CSS px.

### 5.2 Lag

- HMD latency discrimination thresholds ~15-17 ms (Adelstein, Lee & Ellis 2003,
  [PDF](https://hsi.arc.nasa.gov/publications/Adelstein_2003_Head_Tracking_Latency.pdf); Mania et al.
  2004, [abstract](https://www.scilit.net/publications/fe60819969399558db801d606cdd4436); from
  abstracts, full texts not read). Those are for head rotation in a headset; on a desktop window,
  rotation barely moves the eye, so tolerance is looser (5.1).
- Fish tank: above **210 ms** total lag, worse than a static picture (Arthur 1993, section 2). Ware &
  Balakrishnan: head lag of 114-364 ms had no significant effect on reaching because subjects barely
  moved their heads; hand lag was critical (4.4 link). Webcam demos at ~30 fps read as "wobbly"
  and work only with slow head motion (section 2).

### 5.3 One eye vs two, and which eye

- With both eyes open, stereo says "flat at the screen": Lee's quote (section 2); pictures look 3D
  to one eye and flatten "as suddenly and completely as when one closes one eye" in a stereoscope
  ([Enright, NASA NTRS](https://ntrs.nasa.gov/api/citations/19900013606/downloads/19900013606.pdf));
  when both eyes see the picture surface, the brain compensates for oblique viewing
  ([Vishwanath, Girshick & Banks 2005](https://krellinst.org/csgf/conf/2005/abstracts/girshick)).
- Rendering from the midpoint kills the effect for a one-eyed viewer (WonkaVision): each eye is
  half an IPD (~31.5 mm) off, a 1.5 deg shear at s = d (DERIVED).
- About 2/3 of people are right-eye dominant ([Wikipedia](https://en.wikipedia.org/wiki/Ocular_dominance)).
- Recommendation: a one-eye mode rendering from the open eye, chosen automatically from the
  `eyeBlinkLeft/Right` blendshapes (`outputFaceBlendshapes: true`; subject's left/right); a two-eye
  mode rendering from the midpoint, with a dominant-eye toggle to A/B test (benefit UNVERIFIED).
- Eye point depth: Deering's nodal point is ~0.6 cm in front of the eye's rotation centre (section
  2); eye corners sit at the eyelid surface, so push the point ~5 mm into the head (UNVERIFIED; at
  60 cm a 5 mm depth error is negligible, 5.1).

### 5.4 Scene design

- Motion parallax is an independent depth cue, stronger when self-produced
  ([Rogers & Graham 1979](https://www.bohrium.com/paper-details/motion-parallax-as-an-independent-cue-for-depth-perception/812025513693413376-6980)).
  Within ~2 m, occlusion, disparity and motion perspective dominate; haze/aerial perspective helps
  only at large distances ([Cutting & Vishton 1995](https://www.researchgate.net/publication/236964257)).
- Frame occlusion: content behind the glass may be cut by the bezel (correct for a window); content
  in front of the glass touching the bezel is a "window violation" and jumps in depth
  ([Pikes Peak Photo](https://pikespeakphoto.com/grid.html)). Keep pop-out objects inside the frame.
- Cast shadows alone set an object's perceived 3D path
  ([Kersten lab](https://kerstenlab.psych.umn.edu/demos/shadows)): give floating objects shadows on
  the floor or back wall.
- Depth of focus is ~+-0.3 D ([PMC2879326](https://pmc.ncbi.nlm.nih.gov/articles/PMC2879326)): at
  0.6 m, content from ~9 cm in front to ~13 cm behind the glass matches the screen's focus
  (DERIVED); deeper content relies on parallax alone.
- Avoid detailed flat content at the glass depth: zero parallax, so it reads as the screen ("bound
  to the surface of the screen", Lee). Lee's layout: a deep receding grid room plus targets in
  front of the glass tied by lines to the back wall.
- Use a continuous depth range (near objects, mid frame, far wall) so every head move produces
  relative motion. Brightness matching and familiar-size objects: plausible, UNVERIFIED.

## 6. Filming for social video

- The phone lens must be where the scene is rendered from. WonkaVision held an iPad "with the
  camera pressed as closely as possible to our right eye" while rendering the right eye
  ([write-up](https://shopify.github.io/spatial-commerce-projects/WonkaVision/)). Lee's video was
  reportedly shot with the camera held with the tracked sensor
  ([Gigazine](https://gigazine.net/gsc_news/en/20230306-simple-optical-illusion); UNVERIFIED).
- Video is monocular, so it shows the effect better than two eyes
  ([TheParallaxView](https://gitee.com/axiomaster/TheParallaxView),
  [Kitware](https://www.kitware.com/real-time-face-tracking-in-paraview/), HN). Viewers call
  oversold clips "nerd-bait"; visible lag is the main tell
  ([HN](https://news.ycombinator.com/item?id=35016988)).
- Setup (DERIVED): track one eye, hold the lens against it, add a fixed lens offset (lens minus eye
  position, a few cm, measured once with the 1.6 reflection check through the phone), other eye
  closed. A printed face taped behind the phone so the tracker follows the lens: UNVERIFIED, no
  example found.
- Even, bright light on the face ([Sony](https://xyn.sony.net/en/developer/technical/spatial-reality-display/whitepaper));
  lock exposure and focus ("AE/AF Lock", [Apple](https://support.apple.com/en-asia/guide/iphone/iph3dc593597/15.0/ios));
  change distance or angle to remove moire ([guide](https://www.uniquephoto.com/community/qa/how-can-i-photograph-a-computer-or-phone-screen-with-an-iphone-without-glare-banding-or-bad-exposure)).
  Move slowly and show that tracking is live (WonkaVision prints eye coordinates; Curtis shows a
  face inset).

## 7. Quality targets for this build

| Metric | Target | Basis |
| --- | --- | --- |
| End-to-end latency, motion to photon | <= 100 ms measured, aim 70 ms, never > 210 ms | Best webcam tracker 40 ms, most > 100 ms (Scheer & Brinkmann 2026, 4.4); > 210 ms worse than static (Arthur 1993); budget 70-110 ms (4.4) |
| Residual lag after prediction | <= 30 ms equivalent (<= 6 mm eye error at 0.2 m/s) | Lag geometry (5.1); prediction limits (4.2) |
| Jitter, head still, 60 cm | lateral <= 0.2 mm RMS, depth <= 2 mm RMS, after filtering | 0.2 mm ~ 1 CSS px ~ 1 arcmin (5.1); raw noise ~0.15 mm lateral, ~2.2 mm depth (3.4, synthetic lower bound) |
| Eye position, lateral (x, y) | <= 5 mm absolute, checked with the reflection test (1.6) | 5 mm = 0.5 deg shear at 60 cm (5.1); camera offset/tilt errors are this size (1.2) |
| Eye position, depth | within +-5 % (+-30 mm at 60 cm) | Depth-scale tolerance (5.1); iris depth 4.3 % mean error (3.5) |
| Eye choice | One-eye mode renders the open eye, not the midpoint | 31.5 mm error otherwise (5.3) |
| Tracking rate | 30 Hz built-in (hardware maximum), 60 Hz iPhone | MEASURED formats (1.3, 1.4) |
| Inference time | <= 20 ms per frame, off the main thread | MEASURED 14-21 ms median (3.4) |
| Render rate | steady 60 fps (60 Hz display), re-projecting every frame from the predicted eye | MEASURED 60 Hz (1.1); ~10 fps "very jittery" (Arthur 1993) |

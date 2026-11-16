# Core notes: tracking, display model and app shell

What the core does, how to run and test it, what was measured, and what is
still unverified. Coordinates and the scene contract are in
`docs/ARCHITECTURE.md`; hardware facts and their sources are in
`docs/REFERENCES.md`.

## Pipeline

```
FaceTime camera 1280x720 @ 30 fps
  -> requestVideoFrameCallback (main thread) -> VideoFrame, transferred
  -> module worker: MediaPipe FaceLandmarker, CPU (XNNPACK), numFaces 2, raw landmarks
  -> main thread: pick nearest face, gaze-stable pupil pixels, head axis from the
     facial transformation matrix, closed-form eye solve from eye spacing + yaw,
     (optional, off by default: pupil kept on the real one through head turns)
  -> camera -> display coordinates (src/core/display.js)
  -> view mapping (Look around: mirrored about a slowly adapting rest point,
     up and down 1.5x, plus head turn from the face's yaw and pitch about a
     rest pose; True window: exact) with Strength 1-5x, clamped to a cone in
     front of the glass
  -> EyeTrack, Smooth follow (default): dead-band for seated sway, targets
     interpolated by sensor time at the measured delay, critically damped
     spring every frame, no extrapolation. (Predict ahead: One Euro, noise-
     adapted cutoffs, prediction braked at stops.) Hold / settle / glide when
     the face is lost or found
  -> every rAF: display -> window coordinates, applyWindowCamera, scene.update, render
A watchdog restarts the model worker or the camera when either stalls.
```

| File | Role |
| --- | --- |
| `src/core/display.js` | Display presets (15-inch Air measured notch), viewport on the physical display in full screen and windowed Chrome, browser zoom (devicePixelRatio / 2 on the built-in display), side panels, panel pixel ratio, camera position, card calibration of screen size |
| `src/tracking/camera-presets.js` | Camera FOV presets and pinhole intrinsics (4:3 treated as a crop of 16:9) |
| `src/tracking/eye-solve.js` | Face choice, gaze-stable eye pixels, head axes, closed-form eye solve, vergence, eye/phone viewpoint, `GazeCompensator`, `EyeChooser` (which eye, with blink hysteresis) |
| `src/tracking/follow.js` | Smooth follow: dead-band, interpolation at the measured delay, critically damped spring |
| `src/tracking/view-map.js` | Look around / True window, Strength, rest point, viewpoint limits |
| `src/tracking/head-turn.js` | Head turn (Look around): pose filtering and hold band, rest pose, dead-band, soft limit, the turn's own eye movement |
| `src/tracking/one-euro.js`, `predictor.js`, `noise.js` | Eye track (modes follow / predict), filter, prediction (fast velocity, brake), noise meter, gaps, face-lost behaviour |
| `src/app/recorder.js` | Record tracking log: 20 s of numbers, downloaded as JSON |
| `src/tracking/watchdog.js` | Decides when the model or camera has stalled and whether to restart or give up |
| `src/tracking/latency.js` | Camera delay from screen flashes |
| `src/tracking/ipd.js` | Personal eye spacing from iris size (focal-length free ratio) |
| `src/tracking/landmarker*.js` | MediaPipe in a module worker (main-thread fallback); WASM and model served locally |
| `src/tracking/net-guard.js` | Same-origin requests only, in the page and the worker: stops MediaPipe's usage logging (it posts to Google once a minute and has no off switch) |
| `src/tracking/tracker.js` | Camera, frame scheduling, restarts, stats, which eye to render from |
| `src/app/resolution.js` | Adaptive resolution (frame rate and tracking rate) |
| `src/app/calibration.js` | Steady check steps and their maths |
| `src/app/*` | Render loop, scenes (fade through black), interface, steady check, camera delay check, details panel |

## Decisions and why (measured, not guessed)

All numbers below are from headless Chrome (Playwright Chromium, ANGLE on
Metal, Apple M2) on this MacBook Air, with synthetic webcam clips (next
sections) and simulations. Headless differs from a real window in
compositing; the machine was shared with other jobs during some runs, so
rates vary by a few Hz between runs.

**Worker + CPU delegate.** Same clip, same app, 40 s each (first build):

| Variant | Tracking | Inference median | Capture -> result | Render frames > 20 ms |
| --- | --- | --- | --- | --- |
| worker, GPU, numFaces 2 | 17.7 Hz | 31.4 ms | 48 ms | 9 / 2391 |
| **worker, CPU, numFaces 2** | **29.8 Hz** | 22.3 ms | **30 ms** | **0 / 2400** |
| worker, GPU, numFaces 1 | 27.7 Hz | 17.4 ms | 33 ms | 0 / 2400 |
| main thread, CPU, numFaces 2 | 22.3 Hz | 15.7 ms | 32 ms | 3 / 2395 (max 83 ms) |

The GPU delegate competes with rendering for the GPU and loses. numFaces 1
turns on MediaPipe's own smoothing (more lag); numFaces 2 gives raw
landmarks and lets the nearest of two faces win.

**One eye by default.** Rendering from the midpoint between the eyes puts
each eye 31 mm off and kills the depth (REFERENCES 5.3). With "switch to
whichever eye is open", the view follows the open eye only when the chosen
eye has been shut over 500 ms and the other open over 150 ms (a long blink
with one lid opening early used to flip the view 63 mm). A switch moves
the whole track by the distance between the two eye points of that frame
(`EyeTrack.shift`) and glides across in 280 ms; fed in as motion it read as
a 2 m/s lunge and swung the view to -26 mm (-42 with noise) first.

**Gaze-stable eye point.** Iris centres move a few pixels with every
saccade, so the rendered pupil is the eye-corner midpoint plus where the
iris sat relative to the corners over 2 s. When the head turns or moves
while the eyes stay on the screen, the eye counter-rotates and the pupil
really moves; the average only learned that slowly (2.7 mm off after a
20 deg turn, then 2.4 mm of creep). `GazeCompensator` averages the
direction to the screen in head coordinates alongside and offsets the
pupil by the difference: on the synthetic face with converging eyes,
head-turn error and creep fall below 0.6 mm and sway error from 1.58 to
0.03 mm. That test eye is built on the same model, and on the painted-eye
clips it adds error (degraded clip, 20-30 deg turns: 2.3 -> 5.4 mm), so it
is a setting, off by default ("Correct for the eye turning when you turn
your head"). Check on a real face first: in the steady check's cross view,
turn and hold still; if the cross creeps onto the reflection over a few
seconds with it off, turn it on.

**Smooth follow, Look around and Strength (after the first real-camera
test).** The first test with a real face (MacBook Air 15", Chrome, FaceTime
camera, dim room, camera delay measured at 48 ms against the assumed 30)
reported a view that "swings when I move" (not while still), felt
"inverted", and was not sensitive enough. With Look-ahead at 0 it was
"almost" fixed, with a little roughness left. The corpus above had no seated
sway, no 15 fps dim-light case and no stops with tremor; extrapolating every
small real correction through 80 % of the delay, with the fast velocity and
brake, swung past the stops. Three changes:

1. *Smooth follow* (`src/tracking/follow.js`, the default; Predict ahead
   keeps everything above as an option). Per sample: a dead-band (6 mm
   circle in x/y, 8.5 mm in depth, at least 4 and 3.5 noise std) whose
   centre moves only by the amount the eye leaves it; it re-centres on the
   eye over 0.4 s for 1.5 s after a deliberate move (12 mm of drag within
   about 0.5 s; also at the start of a track) and over 8 s otherwise. The
   dead-banded targets are kept by sensor time and drawn interpolated at a
   delay behind display time (the oldest the newest sample gets before the
   next arrives: up at once, down slowly), then a critically damped spring
   (30 ms sideways, 150 ms depth; longer with noise above the reference, at
   least 0.6 tracking intervals) is integrated exactly on every render frame.
   Its impulse response is never negative, so the view never passes a target
   that has stopped, and it never extrapolates.
2. *Look around* (`src/tracking/view-map.js`, the default direction; V
   switches, R re-centres): head offsets from a rest point are mirrored on all
   three axes. True window is the exact mapping. The user confirmed the exact
   mapping was physically right (leaning right revealed more of the left
   side) and still preferred the other; lag made the exact mapping look worse,
   since content slid with the head during a move.
3. *Strength* 1-3x, a gain on the offset from the rest point in both
   directions (2x for Look around, 1x for True window by default), applied
   before the spring so the no-overshoot guarantee holds in view space.

Measured with `tools/core-motion.mjs` (real-like scenario: 48 ms delay,
dim-room noise x 0.35 / y 0.87 / z 5.6 mm, exposure 90 % of the frame, 3 mm
seated sway plus 1-3 mm micro-corrections on top of every lean and stop;
30 / 15 fps). mm are on screen-space eye positions; the 2x column moves the
view twice as far, so its mm are doubled for the same smoothness:

| 30 / 15 fps | Old default (predict 0.8) | Look-ahead 0 (the user's test) | Smooth follow, window 1x | **Smooth follow, Look around 2x (default)** |
| --- | --- | --- | --- | --- |
| Past the farthest head point at stops, mean / max (mm) | 11.1 / 28.6, 17.7 / 42.8 | 0.0 / 0.2, 0.0 / 0.2 | 0 / 0, 0 / 0 | **0 / 0, 0 / 0** |
| 15 cm lean in 0.6 s: lag to 90 % (ms) | 27 / 44 | 188 / 213 | 244 / 296 | **241 / 296** |
| Same lean, past the head (mm) | 17.3 / 28.5 | 0.2 / 0.1 | 0 / 0 | **0 / 0** |
| Sway response: position / speed / micro-corrections | 98 / 100 / 93 %, 97 / 100 / 88 % | 98 / 95 / 91 %, 97 / 94 / 87 % | 24 / 10 / 7 %, 24 / 10 / 7 % | **23 / 10 / 8 %, 22 / 9 / 7 %** |
| Still: frame-to-frame step / jerk (mm) | 0.084 / 0.036, 0.086 / 0.037 | 0.075 / 0.023, 0.076 / 0.027 | 0.008 / 0.002, 0.008 / 0.001 | **0.016 / 0.003, 0.013 / 0.001** |
| Pan 0.1 m/s: step std / jerk (mm) | 0.402 / 0.341, 0.357 / 0.262 | 0.181 / 0.170, 0.278 / 0.260 | 0.063 / 0.052, 0.052 / 0.032 | **0.129 / 0.105, 0.102 / 0.063** |
| Moving error RMS (mm; mostly lag) | 16.4 / 20.0 | 32.0 / 35.1 | 36.6 / 43.1 | 73.2 / 86.2 (2x) |

Targets met (`--check`, also unit-tested): past the stop <= 2 mm; lag <= 250
ms at 30 fps; sway response <= 30 %; still and pan jerk under half of
look-ahead 0. At 15 fps lag is 296 ms (reported, no target). Jerk is the
second difference of the drawn eye per 60 Hz frame; step std is how unevenly
a steady pan advances per frame.

How each part was chosen:

- *Interpolation, not a step per sample.* Stepping the target when a result
  arrives left most of the roughness: noise-free pans still had 0.053 mm of
  jerk, because ±4 ms of inference jitter against 16.7 ms frames lands
  samples 1, 2 or 3 frames apart, a slow irregularity the spring passes.
  Interpolating by sensor time: 0.009-0.021 mm. At 15 fps, for less lag:
  271 ms and jerk 0.042 vs 288 ms and 0.072 stepped.
- *Spring time constant* and the Smoothness slider (lag at 30 fps / pan
  jerk / sway response): Responsive end (18 ms, 2.5 mm band) 194 ms / 0.115
  / 72 %; **middle (30 ms, 6 mm) 244 ms / 0.052 / 24 %**, the fastest under
  the 250 ms target with jerk a third of look-ahead 0's; 40 ms 277 ms /
  0.035; Calm end (75 ms, 9.5 mm) 435 ms / 0.012 / 20 %. Even the
  Responsive end is smoother than look-ahead 0 (0.170) at about its lag.
- *Dead-band* (response to 3 mm sway, position / speed): 3 mm 70 / 47 %,
  4 mm 52 / 30 %, 5 mm 35 / 17 %, **6 mm 24 / 10 %**; 6 mm costs 5 ms of lag
  over 5 mm. The band is a circle in x/y so diagonal leans are not favoured.
  A single 2 s re-centring followed the slow sway (55-77 % response); an 8 s
  one alone left the first anchor (one noisy sample) and the last few
  millimetres of every lean creeping for seconds, hence the quick settle.
- *Depth* noise is ten times the sideways noise. A 2.5 std band was kicked
  every few seconds because the noise meter (built to lower filter cutoffs
  quickly) dips below the real level for moments: depth response 110 %. The
  band now uses the noise level held for 5 s and 3.5 std: 20 %.
- *No look-ahead.* A capped look-ahead (the spring's velocity, never past
  the remaining distance to the target) took 35-45 ms off the lag, but pan
  jerk rose from 0.044 to 0.31 mm, worse than look-ahead 0's 0.17. It stays
  an option (`follow.lookAhead`), off.
- *15 fps.* The noise meter only accepted samples 15-60 ms apart, so at
  15 fps (67 ms) it never measured anything; now up to 110 ms.
- *Gaps.* Smooth follow holds through a missing detection instead of
  coasting: a 0.2 m/s pan falls 0.7 / 8.4 / 13.8 mm behind for 1 / 3 / 4
  missed frames, then catches up (Predict ahead coasts: 0.8 / 3.1 / 4.3, and
  can coast past a stop).
- *Gain.* Samples reach the eye track already scaled, so every threshold in
  metres scales with the gain (dead-band, deliberate-move drag, the 8 cm
  new-track jump, noise references, prediction speeds). Before that, at 2x
  and 15 fps a quick lean crossed the jump threshold between samples and
  took 642 ms to reach 90 %; the doubled noise also slowed the spring (277
  vs 244 ms). Now lag is the same at 1x, 2x and 3x.
- *Depth gain* is 1 + (gain - 1) / 2 (1.5x at 2x). At 2x a 15 cm lean in or
  out would move the eye 30 cm, rescaling the whole scene by about half with
  every lean, and depth noise doubled; at 1.5x depth jitter is 0.75 of that.

The rest point (Look around, and Strength above 1x). The mapped point is
(1 + g) rest - g eye, so the rest point moving while the head holds still
slides the view 1 + g times as far; a first version followed the eye over
6 s whenever it moved slower than 5 cm/s, so a held 5 cm lean at 2x slid
back at about 1.7 cm/s, and slow leans dragged it along (review). Now: seeded
from the first second in which every sample stays within 6 mm of the mean
(until then it follows the last 0.3 s, so nothing is mirrored much), and
seeded where it is, not snapped to that mean (a jump of up to 6 mm, 18 mm of
view at 2x); then, while the head is still, it follows the eye with a 6 s
time constant only within 1 cm of it. Farther away it holds, unless the head
has been still there for 25 s (a new posture), when it follows with a 45 s
time constant. Still means slower than 3 cm/s sideways (100 ms means 200 ms
apart; depth is left out, its noise alone reaches that), and for 0.4 s after.
Tested: a held 5 cm lean at 2x moves the view 0.57 mm in 20 s; slow 12 cm
leans at 3 and 2 cm/s move the rest point 0.6-0.7 mm; sitting 4 cm further
left is taken up 0.1 mm by 25 s, 10.7 mm by 40 s and 21 mm by 60 s, and R
takes it at once (the mean of the last 0.4 s). A change of direction, strength or a
re-centre maps the current sample both ways and moves the track by the
difference with `EyeTrack.shift` (as an eye switch does), so the view glides
across over 600 ms: 30 cm at under 16 mm a 60 Hz frame (tested), never
past where it is going. The steady check and phone lens mode always use the true window
at 1x (the cross must sit on the eye's reflection; the phone films what its
lens sees).

Limits on the viewpoint, from contact sheets of both scenes at the Look
around 2x extremes (`tools/scene-shots.mjs --eyes`: head ±15 cm, ±8 cm up and
down, ±15 cm in depth, and corners): nothing breaks at 60 cm; 30 cm to the
side still reads at 38 cm, but at 20 cm a 30 cm offset (56 degrees) shows
only the Soundstage rig or a grazing floor in both scenes. The eye is kept at
z 0.2-1.4 m, |x| <= min(0.3 m, 0.8 z), y within -0.2..0.3 m and
|y| <= 0.55 z; the cone corners render readably. (Later widened with the
scenes' build-out to |x| <= min(0.5 m, z), y -0.3..0.36 m, |y| <= 0.6 z, and
with head turn, below, to y -0.4..0.48 m, |y| <= 0.8 z.)

**Head turn, and 1.5x up and down (second real-camera report).** "When
looking up it doesn't really move much"; asked whether looking up meant
tilting the head back or raising the whole head: "Both". Rising already
moved the view (at 3x), but a seated head rises and ducks only a few
centimetres, and tilting the head moved only the eye, about 2 cm.

1. *Up and down get 1.5x the Strength in Look around* (`yGainLook`; 4.5x at
   the 3x default, depth still 2x). True window is unchanged, so 1x stays
   exact. Smooth follow now takes a gain per axis: its dead-band is a circle
   in head millimetres (an ellipse on screen) and noise is judged per axis in
   head millimetres, so lag and sway response match the single-gain case
   (identical numbers when the gains are equal). Real-like bench, Look
   around 3x, 30 fps, 1x -> 1.5x up and down: sway response 23 -> 23 %,
   15 cm lean 241 -> 241 ms, still frame step 0.023 -> 0.026 mm and jerk
   0.0048 -> 0.0054 mm (the up-and-down noise, amplified half as much again).
2. *Head turn* (`src/tracking/head-turn.js`; Settings, Motion: "Head turn
   steers the view", on, and "Turn strength", 0.25-2x, Look around only).
   The pose is the face's yaw and pitch in display terms from the facial
   transformation matrix (`headAngles`; the landmark fallback agrees within
   2 degrees on the synthetic face), measured from a rest pose. Directions
   match the position mapping, where rising moves the viewpoint down and
   leaning right moves it left:

   | Action | Viewpoint | What shows more |
   | --- | --- | --- |
   | Tilt the head back (look up) | down | the top of the scene |
   | Look down | up | the bottom |
   | Turn right | left | the right side |
   | Turn left | right | the left side |

   Stages: a one-pole pre-filter (80 ms); a hold band like Smooth follow's
   dead-band (radius max(0.6 deg, 1.8 x the raw pose noise from the
   third-difference meter), settling onto the smoothed pose over 0.3 s for
   1.2 s after a deliberate turn of 2 degrees or more, 8 s otherwise), so a
   held pose gives an offset that does not move at all; a dead-band about
   the rest pose (5 degrees of yaw, 4 of pitch) for the small turns a head
   makes all the time; then a soft limit s L tanh(k e / L), k = 2 cm a
   degree sideways and 2.5 up and down, L = 30 and 25 cm at Turn strength s
   = 1 (a 15 degree tilt: about 20 cm). After missed detections the
   pre-filter steps no further than 1.5 tracking intervals' worth, so the
   catch-up spreads over a few samples. The rest pose is kept like the rest
   point: seeded with it, followed over 6 s only while still and within 2
   degrees, held otherwise, taken up over 45 s after 25 s still somewhere
   new, frozen while turning faster than 15 deg/s or while the head moves,
   and re-centred with R.
3. *A turn counts once.* Turning also moves the eye: in the usual neck model
   the eye is 8 cm in front of and 7.5 cm above the pivot, so a 15 degree
   tilt back lifts it 1.8 cm and moves it 2.2 cm back, which alone moved the
   view ~8 cm down and ~4.4 cm in at the defaults. The eye movement of the
   arc past the dead-band (the angles that steer) is taken out of the
   position; inside the band nothing changes. The correction stops growing
   where the soft-limited steering grows more slowly than the eye movement
   it replaces (17 degrees up or down, 26 sideways at the defaults): the
   pose lags the eye a little, and a correction growing faster than the
   steering would show that lag as a swing back. Bench, 15 degree tilt:
   depth change 38 mm without the correction, 7 with it.
4. *How it reaches the screen.* The turn's part of the mapped point (its
   steering minus the eye movement it removed, `ViewMapper.turnOffset`)
   goes to `EyeTrack.push` as an offset that skips Smooth follow's
   dead-band, which is there for sway (the turn has its own hold band), but
   goes through the same interpolation and spring, so the no-overshoot
   guarantee holds. Through the dead-band, a turn reached 90 % only after
   400-550 ms and small turns crept in over 8 s. Splitting it the other way
   (steering alone as the offset, the eye minus the correction through the
   band) failed: the eye moves before the filtered pose, that part spiked,
   and the band kept the spike, 5-14 mm past the stop. As split now, both
   parts move one way through a turn. Shifts (R, switching head turn or its
   strength) carry the new offset (`EyeTrack.shift`), so they glide.
5. *A held turn holds the rest point too*: while the held pose is past the
   dead-band, the rest point does not follow the eye nearby (when it did,
   the eye with the turn taken out sat within 1 cm of the seat, the rest
   point crept toward it, the view drifted and Smooth follow's band dragged
   noise along: 2.5-3.5x the held shimmer looking down or turning left).
   The posture rule still applies to both: a turn held still for 25 s is
   taken up over 45 s by the rest pose, and the rest point follows the eye
   with the turn taken out (where the viewer sits). A first version froze
   the rest point outright while turned, which also reset the stillness
   clock every frame, and the rest pose froze with it: a slump of 8 degrees
   stayed ~12 cm off until R (review). Now (`tests/head-turn.test.js`): an 8
   degree slump or tilt back moves the view 12 cm, still 12 cm at 20 s,
   7 mm at 60 s and 11-13 mm at 120 s.
6. *A glance down at the keyboard fades out.* Looking down 18-25 degrees
   below the rest pose, the pitch steering fades to nothing (smoothstep) and
   the eye movement taken out grows to the whole pitch arc from the rest
   pose, so from 25 degrees on the view is where it would be had the head
   not tilted: 0.3 mm from where it was at 25, 30 and 40 degrees held,
   against 33-46 cm without the fade; 10 and 15 degrees steer exactly as
   before. The fade is judged on a quicker pitch (20 ms pre-filter, a hold
   band of 3 degrees while the head is still and 0.5 while it turns faster
   than 30 deg/s, settling onto the pitch over 1 s): judged on the held
   pose (~100 ms behind the eye), a quick glance added the eye's whole
   movement to steering not yet faded and went 23 mm past the ideal view.
   The glance's extra eye correction goes through Smooth follow's dead-band
   with the eye (`ViewMapper.turnBypass`): passed around it, the band's lag
   on the eye showed as a swing of 4-7 mm past where the view settles.
   Measured without sway, 1 degree of pose noise: a 25 degree glance in
   0.3 s, a 30 degree look-down in 0.5 s: never past the ideal view, no
   swing past on the way back, held 0-6 mm from where it started. Stopping
   inside the fade (20 degrees) settles with a dip of up to 4 mm (the fade
   arrives on the quick pitch before the steering on the held pose).
7. *Minors.* After a lost face (over 0.5 s) the pose filters glide onto
   the new pose like missed detections, instead of starting over; switching
   eyes shifts the track by the mapped change including the turn's part
   (`ViewMapper.switchEye`).

Measured (`node tools/core-motion.mjs --only turn`): the real-like scenario
at 30 fps (48 ms camera delay, dim-room noise, seated sway and
micro-corrections), the eye turning about the neck model, 0.5 deg rms of
slow pose sway, 1 degree of pose noise a frame. Ideal: the same head mapped
with no noise, delay or pose filtering. Shimmer: frame step / jerk / RMS
about a 0.5 s average (mm, x and y), held from 3 s after the stop, head turn
on and off for the same head:

| Case | Ideal / drawn | Lag 50 / 90 % | Past the ideal | Held shimmer on | off | Depth |
| --- | --- | --- | --- | --- | --- | --- |
| Tilt up 15 deg in 0.5 s | 220 / 222 mm | 311 / 554 ms | 0 | 0.047 / 0.013 / 0.118 | 0.036 / 0.008 / 0.075 | -7 mm |
| Look down 15 deg | 231 / 227 | 314 / 501 | 0 | 0.043 / 0.008 / 0.106 | 0.042 / 0.008 / 0.102 | +9 |
| Turn right 20 deg | 250 / 247 | 309 / 536 | 0 | 0.045 / 0.010 / 0.124 | 0.038 / 0.007 / 0.093 | -5 |
| Turn left 20 deg | 251 / 252 | 299 / 422 | 0 | 0.044 / 0.009 / 0.119 | 0.038 / 0.006 / 0.093 | +5 |
| Quick tilt 25 deg in 0.3 s | 298 / 301 | 271 / 385 | 0 | 0.034 / 0.007 / 0.088 | 0.033 / 0.006 / 0.081 | -36 |
| Slow tilt 15 deg in 1.5 s | 221 / 217 | 438 / 899 | 0 | 0.047 / 0.011 / 0.108 | 0.043 / 0.010 / 0.092 | -2 |

At 0.75 degrees the lags are 10-50 ms shorter. Sitting still (30 s) with 0.5
or 1 degree of pose noise, the drawn view is identical with head turn on and
off (0.022 / 0.0026 / 0.039 mm): the dead-band holds. Held, with the pose
sway removed, on equals off (0.0342 vs 0.0340 mm step): the remaining excess
above is the head's own slow wobble being steered, not noise. A neck unlike
the model (pivot 15 cm below the eye, the whole neck tilting) still never
goes past the ideal view; it keeps ~4.5 cm of depth change on a 15 degree
tilt and 13 % less vertical. `--check` requires: never past the ideal view
(<= 2 mm, all six cases at 1 degree of noise); held without pose sway and
sitting still, shimmer within 10 % + 5 micrometres of head turn off. Unit
tests (`tests/head-turn.test.js`): the four directions against rising and
leaning and against what the window shows, the dead-band and soft limit, a
held tilt (rest pose 0.06 deg and rest point 0.14 mm in 20 s), R, True
window ignoring the pose, counting a turn once, no movement from pose noise
while still, a face lost for 120 ms to 2 s mid-turn, gliding switches, and
the bench check.

The pose noise is assumed, not measured: 0.5-1 degree a frame (the brief's
figure). The synthetic clip that would measure it needs the portrait that is
no longer in the scratch folder, and its matrix is MediaPipe's own fit, so a
clip run would show its noise and whether a sideways lean reads as a turn.
The tracking log now records the pose (`pose`, degrees) and `--replay` uses
it (`--view look --turn on|off`).

View limits for the new vertical range: at the defaults rising 4 cm and
tilting back 15 degrees together move the view ~40 cm (tested, not
clipped), past the old 30-36 cm and 31 degrees. Headless renders of both
scenes (`tools/scene-shots.mjs --eyes`) at y +48 / -40 cm from 60 cm, the
four corners with x +-45 cm, and 35 and 85 cm away all render without holes:
from above, the Soundstage floor and the car's roof, the Box floor; from
below, the Soundstage truss grid, and the Box's dark ceiling with the room
along the bottom edge. Now y -0.4..0.48 m and |y| <= 0.8 z (39 degrees).
These are the ones to revisit once the scenes' extended extents are
reported.

The tracking log (details panel, Record tracking log, `src/app/recorder.js`)
records 20 s per tracking result (capture, sensor and arrival times, faces,
which eye and which are open, the solved eye in camera, display and window
coordinates, the mapped eye and rest point, camera rate, inference time) and
per drawn frame (display time, the drawn eye in display and window
coordinates, Smooth follow's target, the One Euro output, track state), plus
a settings, camera and viewport snapshot, a few hundred KB at most. It downloads as
`window-tracking-<date>-<time>.json`; `node tools/core-motion.mjs --replay
file.json` replays the raw eye samples at the recorded times through each
variant and scores them against a zero-phase smoothed copy (Gaussian, 40 ms):
step and jerk, still response, past the stop, the best-fit lag, plus the
stream as recorded. `tools/core-record.mjs` checks the button headless.

**Prediction brakes at stops (tools/core-motion.mjs).** This and the next
section describe Predict ahead, the default until the first real test and
now an option (Settings, Motion). The first tuning
scored a smooth 0.4 Hz sway, which has no stops, so it rewarded full
extrapolation: the predictor carried a ~70 ms stale velocity ~105 ms ahead
and every quick stop swung 3-9 cm past and snapped back. Now:

- a fast velocity from the last two raw samples (15 Hz) is used whenever it
  is smaller than the smooth one (and none when they disagree in direction),
  so a slowing head is noticed within a frame;
- when the head decelerates, the prediction uses the deceleration of a
  quadratic fitted to the last ~110 ms of raw samples (4 at 30 Hz, 3 at
  20 Hz), beyond a 1.1 m/s^2 deadband that follows the measured noise, times
  16, and stops where the velocity would reach zero; braking only ever
  shortens the extrapolation;
- each new sample's change to the prediction is blended in over 90 ms;
- look-ahead 80 % of the measured delay.

The first version took the deceleration from the differentiated fast
velocity (x4, 0.3 m/s^2 deadband): about 1 m/s^2 of noise at webcam noise,
so the brake fired at random and steady pans wobbled 4 mm. Quick stops
decelerate at 2-6 m/s^2, far above the fit's noise; the deadband separates
them and the gain restores the response beyond it.

Tuned on a corpus of 3 x 120 s of random head motion (minimum-jerk leans of
10-25 cm in 0.3-1.2 s that stop dead, 30 % reversed at once, sways, drifts;
76 stops) through a simulated 30 fps camera with 30 ms hidden delay and
webcam-like noise, then checked on the real landmarker output of the
review's degraded clip. Saved Steadiness and Look-ahead values reset once
(settings `motionVersion` 2). Pan wobble (error std on a steady pan, trail
removed) is scored next to overshoot and moving error.

| Corpus, webcam-like noise | Shipped (100 %) | First brake | **Now** |
| --- | --- | --- | --- |
| Overshoot at stops, mean / p90 | 31.1 / 57.6 mm | 7.3 / 20.7 mm | **9.8 / 18.5 mm** |
| Moving error RMS | 15.9 mm | 13.7 mm | **15.8 mm** |
| Pan wobble, 0.2 / 0.1 m/s (0.5 mm noise) | 1.05 / 0.94 mm | 3.96 / 3.03 mm | **1.25 / 1.10 mm** |
| Still, frame-to-frame step / depth std | 0.131 / 4.95 mm | 0.043 / 2.05 mm | **0.031 / 1.96 mm** |
| 15 cm lean in 0.4 / 0.6 / 1.0 s, overshoot | 63 / 33 / 13 mm | 24 / 1 / 0 mm | **8 / 0 / 0 mm** |
| Reversal at 0.2 / 0.3 m/s, overshoot | 23 / 35 mm | 13 / 19 mm | **12 / 18 mm** |
| 1 / 3 / 4 missed detections mid-pan, hitch | 13.7 / 20.7 / 24.6 mm | 1.1 / 3.7 / 5.1 mm | **0.8 / 3.1 / 4.3 mm** |
| Steady 0.2 m/s pan, trail (noise 0.1 / 0.5 mm) | 0.2 / 0.8 mm | 6.2 / 8.1 mm | **7.1 / 7.7 mm** |
| Tracking at 20 Hz: overshoot mean / p90 | | 12.1 / 32.3 mm | **14.1 / 26.6 mm** |

("Shipped" and "First brake" pan wobble are the review's and this bench's
measurements; the shipped wobble row is with its 100 % look-ahead.)

No setting met overshoot <= 10 mm with wobble at the pre-brake 1.05 mm.
Along the trade-off (fit brake, moving error <= 15.9 mm): wobble 1.13 ->
overshoot 11.7 mm; 1.25 -> 9.8 (chosen); 1.63 -> 9.9 with a 70 ms blend and
14.9 mm moving error; the first brake 3.96 -> 7.3. On the real-landmark
replays of the degraded clip the chosen setting gives stop overshoot means
of 15.5 / 10.3 / 13.3 mm on three runs (first brake 22.9 / 12.2, shipped
58.5) but moving error ~25 mm (first brake ~21.5): the longer blend costs
some lag. Anything under 100 % look-ahead also trails a steady pan by
design; full look-ahead with any brake left 10-18 mm mean overshoot.

**Noise adaptation (src/tracking/noise.js).** Webcam noise grows several
times with distance and in dim light (review: 0.12 / 0.35 / 2.2 mm per
frame at 60 cm, 1.0 / 2.7 / 8.0 mm at 95 cm). Three changes:

- sideways and depth prediction fade in separately (sideways from 3 cm/s,
  depth from 20 cm/s): depth noise used to switch on sideways prediction
  while the head was still;
- a noise meter (third differences of raw samples, 25th percentile over
  1.5 s, rises over 1 s and falls over 0.5 s; head motion moves it little)
  lowers the filter cutoffs and raises the speed prediction needs, in
  proportion to noise above the level the defaults were tuned at;
- depth never extrapolates over its own filter lag.

| Still head | With the brake only | Now | No prediction at all |
| --- | --- | --- | --- |
| Simulated, webcam noise, step | 0.104 mm | 0.043 mm | 0.040 mm |
| Simulated, 95 cm noise, step / depth std | 0.92 / 5.8 mm | 0.117 / 3.2 mm | 0.097 / 2.9 mm |
| Degraded clip replay, dim light, step | 0.108 mm | 0.040 mm | 0.037 mm |
| Same, 95 cm (a 0.65 s hold), step | 0.784 mm | 0.743 mm | 0.223 mm |

The meter needs about a second to believe a rise, so the clip's brief
95 cm hold is barely helped; someone sitting at 95 cm is. Moving error at
95 cm-level noise rises from 14.5 to 18.7 mm (calmer in exchange for some
lag when it is noisy); at webcam and dim-light noise it does not change.

**Short gaps.** A detection missing within 150 ms of the last good one is a
missing sample: the track coasts on with its filter and velocity
(extrapolation capped at 300 ms). Before, one miss reset the filter and
glided back over 300 ms. Pausing or switching the camera drops the face at
once.

**Adaptive resolution watches tracking (src/app/resolution.js).** A heavy
scene can hold 60 fps while slowing inference and the frame hand-off.
Resolution now steps down a quarter when, over 2 s, more than 10 % of
frames are late, tracking delivers under 85 % of camera frames, or
capture-to-result passes 45 ms (not judged in the first 4 s after the
camera starts). A step taken for tracking is a trial: other programs on the
CPU also slow tracking, and fewer pixels do not help that. Unless tracking
improves by 10 % (or reaches the target) within two steps, resolution goes
back up and tracking-motivated steps pause for 30 s. After 20 s of health
it tries a quarter up; a level that failed soon after being tried becomes
the ceiling for that scene. The
pixel ratio is capped at what the panel shows: 2880 / 1710 = 1.684 on the
15-inch Air instead of devicePixelRatio 2 (which drew 3420 pixels across a
2880-pixel panel). The canvas has no MSAA: scenes multisample their own
targets; the steady check and test room draw through a 4x MSAA pass.

| Default settings, 8 s after settling | Before (review) | Before (this session) | **Now** | Today's scenes at fixed 2x |
| --- | --- | --- | --- | --- |
| Box: tracking / inference / capture->result | 16.1 Hz / 44 / 60 ms | 23.4 Hz / 26 / 42 ms | **29.9 Hz / 24.5 / 31.6 ms** | 24.0 Hz / 30 / 45 ms |
| Soundstage | 22.6 Hz / 22 / 37 ms | 15.1 Hz / 64 / 69 ms | **29.9 Hz / 16.4 / 19.8 ms** | 14.6 Hz at 47 fps |
| Test room | 24.3 Hz / 25 / 40 ms | 29.3 Hz | **27.8 Hz / 27.6 / 41.6 ms** | |

("Now" is the review's own `starve.mjs`; the scenes changed during
this work, so the last column re-measures today's scenes at
the old 2x for comparison.)

**Watchdog (src/tracking/watchdog.js).** One exception in the frame callback
used to end tracking for good, and a dead or hung model worker left it busy
forever, silently. The frame callback always reschedules; a request
unanswered for 0.7 s, results stopping for 1.5 s while frames arrive, or 20
failed results in a row restart the model (new worker); no camera frame for
2 s or a track that ends restarts the camera; a muted track is waited out.
Four restarts of one kind in a minute: give up (closing the model, so no
hung worker is left), say so, follow the mouse; Try again starts with a
fresh restart budget. "Restarted" shows only once a result arrives.
`tools/core-faults.mjs`, 9 injected faults (including a model that hangs in
every new worker, then Try again): all handled and named in the status
pill (before: 2 of 7 recovered, none reported).

**Scene changes fade through black.** Building Soundstage stalls the main
thread for ~0.8 s twice (shader compilation, then its first real frame).
Scenes set shared renderer state (shadow map type, one-shot shadow update)
in `create()` and restore it in `dispose()`, so the old scene cannot keep
drawing while the next is built. Instead the old one fades out while still
drawing (a compositor animation, unaffected by main-thread stalls), the new
one is built behind black and fades in once it has drawn and the face is
tracked again. Longest visible frame during Box -> Soundstage: 783 -> 17 ms;
the switch takes ~2.6 s. Stalls are logged with their real length
(`Slow frame: 783 ms (hidden behind a scene change)`) and kept out of frame
statistics; the 250 ms clamp applies only to scene animation.

## Measured results (final defaults)

These clip results are for Predict ahead, the default when they were
measured. The Smooth follow round ran no face clip (the portrait the clip
generator needs is no longer in the scratch folder); its numbers are the
real-like bench above, plus a headless run of Record tracking log on
Chrome's own fake camera.

The clean synthetic clip, `tools/core-e2e.mjs` (exit code 0, all checks pass):

| Metric | Result | Target (REFERENCES 7) |
| --- | --- | --- |
| Tracking rate | 26-30 Hz of a 30 fps camera (shared machine) | 30 Hz |
| Inference (worker, CPU) | 22 ms median | <= 20 ms |
| Capture -> result | 38 ms median, 46 ms p95 | |
| Raw eye position, head still, 60 cm | x 0.0 / y -1.4 mm bias, depth -2.1 mm | lateral <= 5 mm, depth +-5 % |
| Rendered jitter, head still | 0.09 / 0.29 / 1.7 mm std (x, y, depth); 0.02 mm frame to frame | lateral <= 0.2 mm, depth <= 2 mm |
| Rendered error during a 13 cm, 0.4 Hz sway | 10.9 mm RMS (was 8.1), residual lag 45 ms | <= 6 mm at 0.2 m/s |
| Rendered depth while leaning 40-80 cm | 21 mm RMS (18.6 before the noise changes) | |
| Render, test room at 2880 x 1864 | 60.0 fps, 0 of 2400 frames over 20 ms, loop JS p99 0.4 ms | steady 60 fps |

The smooth sway is the one motion full look-ahead handles best, and this
clip's painted eyes turn with the head, so the gaze compensation (right for
real eyes) adds error here (see below).

Review's degraded clip (motion blur, dim light, JPEG, quick leans, 95 cm,
+-30 deg turns), same tool, 55 s, before -> now:

| Segment | Before | Now |
| --- | --- | --- |
| Overshoot after the three abrupt stops, per loop | 70.8, 43.6 / 75.5, 44.1 / 55.1, 74.0 mm | 17.5, 17.9 / 2.6, -6.5 / 19.4, 14.5 mm |
| Sharp-reversal sway: past the extremes / RMS | 35.1 and 45.8 / 24.9 mm | 16.2 and 19.9 / 18.1 mm |
| Quick leans, rendered x RMS | 25.9 mm | 23.3 mm |
| Still 60 cm: step / depth std | 0.023 / 0.70 mm | 0.015 / 0.55 mm |
| Still, dim light: step / depth std | 0.080 / 1.47 mm | 0.032 / 1.03 mm |
| Hold at 95 cm (0.65 s): step / depth std | 1.689 / 10.8 mm | 1.261 / 5.6 mm |
| Head turned 20-30 deg, rendered x RMS | 2.1 mm | 5.5 mm (painted eyes, see above) |
| Tracking | 26.7 Hz | 28.8 Hz |

After the fix round (fitted brake, gaze correction off), same clip, on a
machine loaded by other jobs (tracking 20-24 Hz, 22.5 overall): stops 18.1,
6.7 / 8.7, -3.1 / 2.0, 40.2 mm; sway past the extremes 21 and 28 mm; head
turned 20-30 deg, rendered x 2.4 mm (5.5 with the correction on); still
0.013 mm, dim light 0.027 mm per frame. Re-run on an idle machine for
numbers comparable to the column above.

Unit tests (`npm test`, node:test): 138 pass (4 skipped: the opt-in GPU
checks, `SCENE_GPU_TESTS=1`), including Smooth follow (no overshoot on steps
and stops, sway attenuation, smoother than look-ahead 0, gaps), the view
mapping (exact mirror, linear strength, clamps, gliding switches, rest point
still during a lean), head turn (directions, dead-band, held tilt and posture, glances, R, True
window, counted once, lost face, noise), tracking-log replay, the Predict ahead targets, noise
meter, watchdog, resolution governor, side panel geometry, steady check
maths and its memory, camera delay estimation, gaps timed on the camera's
clock, head-turn compensation, eye switching and the network guard.

### The synthetic webcam

`tools/core-facegen.mjs` maps a public-domain NASA portrait (Christina Birch,
2021, Wikimedia Commons) onto MediaPipe's canonical face mesh, using the
photo's own landmarks as UVs, adds a dark ellipsoid for the back of the head,
and renders it through the built-in camera preset's intrinsics (1280x720,
68 deg) along a 19 s path: still, sway +-13 cm at 0.4 Hz, lean 40-80 cm,
bob and turn +-25 deg, a second still pose off-axis and turned, then back to
the start so it loops. Sensor noise (sigma 2.5 of 255 in luma) and a
frame-number barcode are added; truth is the 3D point each iris centre lands
on. The clip and portrait stay in the scratch folder, not the repo.

What the clips cannot test: the irises are painted on the mesh, about
12.4 mm wide (the iris eye-spacing estimate reads 60.7 mm against 63.7);
they do not converge (the vergence correction costs ~1.7 % of depth here);
and they turn with the head instead of staying on the screen, which real
eyes do: the gaze compensation therefore reads up to r sin(turn), ~3.5 mm,
worse on these clips and better on real eyes (synthetic converging face
above). MediaPipe places this face's iris centres ~1.3 mm low.

## How to run

```
npm install
npm run dev                  # http://localhost:5190/, hot reload
npm test                     # unit tests
npm run build                # dist/
```

URL parameters: `?scene=<id>` (`test-room` is the core's placeholder),
`?tracker=main|worker`, `?delegate=CPU|GPU`, `?faces=1|2`,
`?autostart=camera|mouse`, `?dpr=1.5` (fix the pixel ratio), `?reset`
(forget settings), `?e2e` (exposes `window.__wd` for the tools).

Keys: F full screen (also on the intro), D tracking details, S settings,
C steady check, [ and ] or 1-9 scenes, Escape closes panels.

Test tools (headless only; the test server has no file watching, so
restart it after edits):

```
npx vite --config tools/core-vite.config.mjs --port 5191 --strictPort &
export WD_BASE=http://localhost:5191/
node tools/core-motion.mjs --check [--quick]                  # motion bench, no browser
node tools/core-motion.mjs --replay window-tracking-....json   # a log recorded in the app (D, Record tracking log)
node tools/core-motion.mjs --replay log.json:truth.json        # core-e2e output against clip truth
node tools/core-facegen.mjs --photo face.jpg --out OUT --name face     # ~45 s, ~800 MB y4m
node tools/core-e2e.mjs --video OUT/face.y4m --truth OUT/face.truth.json --out log.json
node tools/core-starve.mjs --video OUT/face.y4m        # tracking rate per scene, default settings
node tools/core-faults.mjs --video OUT/face.y4m        # injected faults: recovery and messages
node tools/core-visibility.mjs --video OUT/face.y4m    # hidden tab releases the camera
node tools/core-switch.mjs --video OUT/face.y4m        # scene change: visible freeze, face on return
node tools/core-delay.mjs                              # camera delay check with a virtual camera
node tools/core-perf.mjs --video OUT/face.y4m
node tools/core-shots.mjs --out SHOTS --video OUT/face.y4m
```

These start their own server (ports 5190-5192, 5195 for the sink):

```
node tools/core-offline.mjs --video OUT/face.y4m   # 80 s tracked: nothing leaves the machine
node tools/core-steady.mjs [--seconds 60]          # steady check memory per step, freed on close
node tools/core-runtime.mjs                        # first scene, Box rebuild, scene errors, lost context
node tools/core-record.mjs [--video OUT/face.y4m]  # Record tracking log: download, contents, replay
node tools/scene-shots.mjs --ports 5190,5191 --eyes "name:x,y,z;..."   # contact sheets from chosen eyes (cm)
```

## Calibration on a real machine

1. Full screen first (the intro asks; F or the button).
2. First run: the intro asks for both eyes open for two seconds and
   measures eye spacing from the irises; kept for later visits.
3. Settings, Camera, "Measure camera delay": dim the room, face the screen,
   keep still; the screen flashes white eight times. The delay is saved
   for this camera type and replaces the 30 ms estimate.
4. Steady check (C), seven steps, one instruction each. With the screen
   black except a cross in front of the tracked eye, the cross must sit on
   the open eye's reflection in the glossy screen (held still, independent
   of delay): lean left and right and set eye spacing (sideways position
   has no field of view in it), sit in the middle and set camera height,
   then hold the open eye a tape-measured distance from the screen and
   press Measure (one second averaged; refused if the head moved) to set the
   field of view. Last, the far rings show the result in motion.
5. Settings, Display: the 15-inch Air preset is the default; other screens:
   "Measure with a card".

6. Motion: Look around at 3x (4.5x up and down) with head turn, and Smooth
   follow are the defaults. V toggles True window, R re-centres (position
   and pose), Settings, Motion holds Strength, Head turn and Turn strength,
   Smoothness and Predict ahead. To tune on a real head: D, Record tracking log, move as
   usual for 20 s (lean, stop, sit still), and replay the file with
   `node tools/core-motion.mjs --replay`.

For filming (REFERENCES 6): Phone lens mode renders from a point offset from
one eye in the head's frame (right, up, forward in mm). Hold the phone beside
that eye with the face still visible to the laptop camera; lock exposure.

## Known gaps

- **One real test so far** (FaceTime camera, dim room), and its motion
  only as described in words. Smooth follow and Look around are tuned on a
  simulated head (sway and micro-correction amplitudes from the brief, not
  measured). A tracking log from the real camera (`--replay`) is the next
  step: real sway, noise and frame rate may move the dead-band and spring.
- **Lag.** Smooth follow reaches 90 % of a 15 cm lean about 245 ms after
  the head (296 ms at 15 fps), against 190-215 ms with look-ahead 0 and
  30-45 ms with Predict ahead, which swung past stops on the real head. The
  view trails a moving head by 3-4 cm (doubled at 2x).
- **Look around is not physically exact.** It mirrors motion about a rest
  point that holds through leans; after a real change of posture the view is
  off-centre until R, or for a minute or so while the rest point follows.
- **Head turn is tuned in simulation.** Pose noise is assumed (0.5-1
  degree a frame), the neck model is the usual one, and whether
  MediaPipe's matrix reads a sideways lean as a turn is unmeasured; a real
  log with `pose` will tell. A turn is followed more slowly than a lean
  (90 % after 0.4-0.55 s against 0.25 s). Leaning while turning the head
  back toward the screen's centre steers against the lean once past the
  dead-band. A glance at the keyboard fades out past 18 degrees below the
  rest pose; a deliberate look down between 18 and 25 degrees is faded too,
  and stopping inside that range settles with a dip of up to 4 mm.
- **Gaps.** Smooth follow holds through missed detections: 8-14 mm behind
  on a 0.2 m/s pan for 3-4 missed frames, then it catches up.
- **Predict ahead** (optional): steady pans trail by 7-8 mm at 0.2 m/s and
  wobble 1.25 mm at webcam noise; at 20 Hz tracking stops overshoot 14 /
  27 mm (corpus mean / p90); single stops on the degraded clip reached
  40 mm at 20-24 Hz.
- **Camera delay and field of view** need the user-run checks above. A card
  cannot set the field of view: anything held at the face scales with the
  eyes, so the focal length cancels; it takes a known distance. The flash
  check's sign and slope are verified with a virtual camera, not the
  FaceTime camera; display latency is assumed 1.5 frames + 5 ms.
- **Full screen below the notch** uses `top = screen.height - innerHeight`
  (REFERENCES 1.5); not yet checked in a real Chrome window, only in tests.
- **Windowed mode**: side panels are now measured but assumed on the right;
  the tip and settings ask to go full screen or close them.
- **Scene changes take ~2.6 s** through black for Soundstage (two ~0.8 s
  main-thread stalls). Building the next scene while the old one draws
  needs a scene contract change: no shared renderer state in `create()`.
- **The canvas is drawn at panel resolution (2880 wide)**, which Chrome
  scales to 3420 and macOS back to 2880; drawing 3420 and letting macOS
  downsample once is slightly sharper but costs 41 % more pixels.
- **Depth trails leans in and out** (~2 cm on the clean clip): the depth
  filter is deliberately slow; depth errors scale the scene, which reads
  less than sideways errors.
- **iPhone Continuity Camera** preset (65 deg, 18 mm above the screen, x 0)
  is unverified; Center Stage must be off.
- Larger head turns than +-30 deg and partial occlusion (a phone near the
  face) are untested.

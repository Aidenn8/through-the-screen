# Scenes notes

Notes on the scenes: what the two scenes are for, how they were judged
against real references, what they cost, and what is still wrong.

## Scenes

### Soundstage (`src/scenes/soundstage/`)

A 1:16 miniature film set behind the glass. Straight on (eye at 60 cm) the
window frames a night-rain shot of a corner diner. The key is the diner's
own interior: warm, bright, figures in silhouette behind half-open blinds.
The street is near black and carries the lights as wet streaks: pink from
the DINER letters, cyan from the EATS blade, sodium from the acorn lamp.
A painted sign on the upper wall ("COFFEE · PIE · OPEN ALL NIGHT") sits in
the pools of three gooseneck sign lamps under a bracketed cornice. A narrow
HMI "moon" backlights the side street from its far end, so the rain shows as
lit streaks inside its cone and the cone's edge reads. A parked sedan at the
curb, 12-20 cm behind the glass, is the near layer: it slides across the
hydrant and the windows as the head moves. A boom mic, rim-lit by the
windows behind it, hangs 2.5 cm in front of the glass.

Lean and the window reveals the set:

- left: the diner's end and the braced back of its interior wall, the key
  softbox (black fabric body, a lip around a toned diffusion face) on a
  roller stand, a C-stand flag, the B-camera on a dolly at the corner of the
  sidewalk (raised, seen over the car in silhouette against the lit flat backs), the next set's braced back in a work-light pool, video village;
- right: the brick flat's braced back and a spare "WILD" flat in a warm
  work-light pool, a 2K fresnel on a stand, a hazer, a ladder, cinder blocks
  on the jacks;
- duck: the rain bars with their nozzles, black serge borders under the
  grid, space lights hanging dark, the moon HMI;
- rise: the wet street and the front edge of the street deck.

Rain falls only inside the rain rig's footprint and the haze lives over it
only: the stage around the set is dry and clear, and dark (work-light pools
on the flat backs, black drapes, the rest falling off).

### Box (`src/scenes/box/`)

The classic head-tracking room, exactly the window's size and 50 cm deep,
made into a tokonoma-like niche lit by one low sun. The sun comes through a
shoji lattice in the left wall (its paper backlit, the brightest thing in frame) and lays the lattice's grid across the floor,
the back wall and the right wall; a dust shaft hangs in the beam; everything
outside the patches falls to deep umber (refs rb01, rb02, rb04). Dark timber
frames at three depths and floor boards running back give converging lines.

- far markers: the round window on the back wall (a glazed pane with a
  bamboo cross) shows a dusk sky, two ranges of hills at 0.7 m and 1.6 m
  behind the wall, and the evening star 6 m away;
- near marker: a brass wind-chime bell with a paper strip hanging 5 cm in
  front of the glass, swaying slightly;
- props: a plum branch in a turned vase (a tapered, gnarled branch with
  five-petal blossoms and buds on the wood), a turned tea bowl with a foot
  ring and a thinning glaze at the rim, a low lacquer table, a paper andon.

Nothing important sits at the glass depth.

## How it is built

- `_lib/pipeline.js`: HDR pipeline (packed-float HDR target, 2x MSAA, haze
  composite, energy-conserving bloom, AgX tone curve with a CDL look,
  lift/gamma/gain, sRGB with dither). Every pass is per eye ray, so it stays
  right for the skewed window frustum.
- `_lib/haze.js`: single-scattering haze ray-marched at low resolution with
  baked light-space distance maps (lights never move), a clear box, and a
  footprint (haze only over a region, soft edge), depth-aware blur and upsample.
- `_lib/reflect.js`: wet ground. A mirrored copy of the emissive sources
  rendered with the same window camera (parallax-correct puddles; dark
  objects such as the car go in as black silhouettes), plus one analytic
  streak lobe per real light source: anisotropic GGX, tight across the plane
  of incidence and long along it, with the water film's tilt field (cells
  long along z so each glint stays a few pixels tall), so every source makes
  a broken vertical streak running toward the eye. A vertical occluder
  rectangle (the car) blocks the streaks behind it.
- `_lib/bake.js` (off by default, lab `?bake=1`): lightmap bake of the static spot and work light at load:
  per-quad charts at a real-metre texel density, shelf-packed per material
  into 2048² pages, rendered in UV space through the scene's own shadow maps,
  dilated; baked materials then compile their spots and work lights out.
- `_lib/lightmask.js`: per-material spot-light masks; `_lib/worklight.js`:
  unshadowed work bulbs on backstage materials; `_lib/grime.js`: ragged
  ground-grime band on the albedo of street-facing walls; `_lib/warm.js`:
  compiles every program while the scene loads.
- Box: the sun is a spot light with a cookie traced from the actual lattice
  bars (each cookie texel's ray is intersected with the wall's lattice,
  supersampled 3x3, blurred by the sun's penumbra), so the projected grid
  lines up with the bars, with none of the stair-steps a shadow map gives
  thin bars.
- Neon tubes and globes are shaded by view angle (whiter core, dimmer
  saturated rim): it reads as neon and keeps thin HDR edges under the core,
  where 2x MSAA can smooth them.
- `soundstage/car.js`: the sedan from extruded side profiles (body,
  greenhouse, roof), lathe and capsule chrome, tyres with white walls;
  its environment is one cube capture of the set from above its roof.
- `soundstage/rain.js`: instanced eye-facing streaks at least 1.6 px wide,
  lit per drop through the haze's light-space maps; splashes on the ground
  (a brief crown per sprite on its own cycle) lit the same way, so both show
  only inside the backlit cones.
- All geometry and textures are procedural code. `public/assets/` is unused.

## Lab and tools

- `lab.html?scene=soundstage` (dev server 5193-5195): eye by mouse (click to
  toggle), arrows/WASD, Q/E, presets 1-7, head paths (P), viewer's view (V),
  quality (L). `window.__lab` drives it headless: `measure`, `passProfile`
  (each section syncs on the target it wrote), `ablate` (interleaved on/off
  pairs; `synced` for per-frame GPU-synced medians), `classMask` (flat class
  colours per mesh for region statistics, `src/lab/classes.js`).
- `node tools/scene-rounds.mjs --out DIR --refs REFS`: one comparison round:
  the same eight eyes for both scenes, region masks, one luma instrument for
  our frames and the reference photos, boards beside the most relevant
  references, a sway strip, a viewer's-view clip (phone at the eye, ~2x
  lens, 12 s, WebM through Playwright's bundled ffmpeg), timing.
  `--eyeset extremes` renders the Look around 3x range instead (25 eyes on
  one board per scene); `--viewer-strength 3` films the viewer's clip with
  the phone moving with the head and the image drawn from the mapped eye.
- `node tools/scene-board.mjs spec.json`: ad-hoc boards and 1:1 crops.
- `node tools/scene-nav.mjs --out DIR [--steps stills,void,boards,perf,raf]`:
  every station of a scene's nav from the default eye and eight edges of the
  head range (L45, R45, up35, down30, near35, far85, L45up, R45down), a
  void and back-face count per frame (lab `voidMask`: void with each
  surface's own side, as the frame draws; back faces of one-sided surfaces
  with everything two-sided), a board per station and one of all stations,
  and per station the lab timings and a real requestAnimationFrame loop
  (`rafRun`). The lab carries the window on the rig: `?station=`,
  `setStation`, `setRig`, N for the next station.
- `node tools/scene-candidates.mjs OUT.json name:eye:look[:scale] ... plan`
  with `node tools/scene-probe.mjs --shots OUT.json`: framings to compare
  (an eye and a look point in set metres), and a plan of the whole stage.
- `node tools/scene-app-perf.mjs --video face.y4m [--dpr 1.684] [--stations all]`:
  the app with face tracking on a fake-webcam clip, served on the lab ports;
  frame statistics, tracking rate and every adaptive-resolution step with
  its reason; with `--stations` the app glides to each place, settles, and
  measures there.
- `node tools/scene-shots.mjs`: older contact sheets and the
  window-equivalence check (`SCENE_GPU_TESTS=1 npm test`). Final run, both
  scenes, five eyes, plain and full pipeline: all 20 PASS; position median
  0.11-0.18 mm, 95th percentile <= 0.82 mm, <= 0.82 % of pixels (edges) off
  by > 2 mm; colour median <= 0.59/255, 90th percentile <= 3.35/255. The
  full-pipeline comparison now reads its display-referred output as is (it
  had been pushed through a second tone curve, which turned the final pass's
  ±1/255 dither near black into ~10/255 once the scenes went dark); the
  pipeline also sizes its internal targets to the target it draws into.

## Fix rounds (2026-11-13)

Driven by the independent visual review. Every round renders the same eyes
(centre, ±25 cm, ±12 cm up/down, 35 and 90 cm, a 15 cm lean, the sway path)
at the app's buffer (2880 x 1864: 1710 x 1107 points at the capped pixel
ratio 1.684), and measures them and the reference photos with one instrument
(sRGB luma, Rec. 709 weights). Our regions come from class masks; the
references' from rectangles. "Peak" is the maximum 9 x 9 box-mean luma.

Soundstage, centre eye unless noted (luma 0-255):

| Measure | Target (review) | Round 0 (HEAD a1dc52c) | 1 | 2 | 3 | 4 | 5 | 6 (fix round 1) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Frame p10 | <= 20 | 40.7 | 4.7 | 4.7 | 4.7 | 4.7 | 4.7 | 4.7 |
| Frame p50 | 35-55 | 75.7 | 45.2 | 43.9 | 43.0 | 43.0 | 43.3 | 42.0 |
| Diner interior, mean / median | ~150 (nr07: 154.5) | 88.7 / - | 132.4 | 133.4 | 131.2 | 137.5 / 144.2 | 143.0 / 151.1 | 143.4 / 151.5 |
| Street median | ~35 (nr06 whole street 42.5; road between streaks 21.9) | 111.1 | 47.8 | 42.6 | 46.0 | 45.8 | 45.8 | 42.2 |
| Street peak (9x9) | streaks ~120 over the road (nr06: 253) | 225.7 (sheet) | 197.3 | 197.3 | 219.4 | 219.4 | 219.4 | 197.3 |
| Upper facade | ~20 | 55.5 | 21.8 | 21.8 | 21.8 | 21.8 | 21.8 | 21.8 |
| Flat backs, lean left / right | 90-110 (ss01: 150.5) | 52.8 / 73.9 | 45.3 / 54.3 | 38.0 / 83.1 | 37.8 / 83.2 | 78.7 / 91.9 | 92.2 / 92.3 | 99.8 / 92.3 |
| Stage floor, lean left | dark (ss01 floor 57) | 31.1 | 11.3 | - | - | - | - | - |

Round 6: with the bake off, the street median and its 9x9 peak go back to
their pre-bake values (rounds 1-2); the strip of flat backs seen leaning
left changed with the moved softbox and camera (its mean rose to 99.8).

What each round changed, and what the boards showed next:

1. **Night re-key and streaks.** Moon HMI narrowed to 0.2 rad and aimed down
   the side street at the corner (its cone edge reads in the rain); interior
   self-illumination x5 with no spots inside; hemisphere fill 0.32 -> 0.12;
   haze density 0.3 -> 0.13 with a footprint over the rain rig; grade lift
   almost removed; isotropic GGX "glints" replaced by anisotropic streak
   lobes from real sources only (lamp, HMI, 2 EATS, 5 DINER letters, 4
   windows); rain at 1:16 (the 1/12 default was the bug) inside the rig only;
   the dead upper wall became a painted sign under three gooseneck lamps and
   a bracketed cornice; rear-building window slivers removed; a lathe-turned,
   fluted cast-iron lamp post. Boards then: the street a smooth glitter sheet,
   the side street a fog bank, reveal dark but weak.
   Iterations inside the round (street 1:1 crops with each term off): the
   lobes were spread sideways by the albedo normal map, then too smooth
   without it; the fix is tight lobes plus a world-anchored tilt field whose
   cells are long along z (each glint stays a few pixels tall at the grazing
   angle). Moon haze cut and rain brightened so the drops carry the cone.
2. **Near layer and the stage.** A parked 1950s-style sedan (original shape,
   no badges) at the curb, 12-20 cm behind the glass, front toward the
   corner, entering from the frame's right edge: its paint, chrome and glass
   reflect a cube capture of the set; it is a black silhouette in the puddle
   mirror and an occluder for the streaks. The B-camera dolly moved clear of
   it. Boom mic: warm backlight rim on the fur, an anodised pole with a
   specular line. Backstage: work-light pools on the flat backs, cinder
   blocks on the jacks, galvanised grid pipes, black serge borders and legs,
   space lights off, a softbox with a black body, lip and speed ring, rain
   bars with nozzles and a feed hose. Box rebuilt (below).
3. **Surfaces and edges.** Neon and globes shaded by view angle (core ~14,
   rim ~2: whiter core, saturated rim, smoother edges); satin window frames
   and chrome trim; sculpted figures (lathe coats, sloping shoulders, slump,
   fedoras, toque, a bob); ragged ground grime on stucco, tile and brick; a
   newsbox with a front page and label. The lighting bake landed here too.
4. **Polish.** Rain splashes inside the lit cones; work bulbs raised and one
   added at the next set's back (flat backs 79 / 92); space lights dark;
   interior up a step; softbox face falls off behind its lip.
5. **Last numbers.** Interior up a step (143 mean, 151 median); the
   left-lean work bulb up (flat backs 92 / 92); the Box sun 9 -> 7.2 (lit
   wall p90 158).

Box (centre eye):

| Measure | Target | Round 0 | 2 | 3 | 4 | 5 | 6 (fix round 1) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Sun patch over shadow (wall p99 / p10, linear) | >= 16:1 (rb01 ~105:1 by rects) | 20:1 (the review's rects: 4:1) | 269:1 | 269:1 | 269:1 | 246:1 (p90 / p10: 142:1) | 184:1 (p90 / p10: 108:1) |
| Shadowed wall (p10 luma) | <= 25 (rb01 11.5) | 32.7 | 7.8 | 7.8 | 7.8 | 7.8 | 10.4 |
| Sun patch (wall p90 / p99 luma) | ~150-170 (rb01 patch 148.8) | 62.5 / 147.3 | 169 / 209 | 169 / 209 | 169 / 209 | 158 / 201 | 158 / 201 |
| Frame p10 | (rb01 3.9, rb02 1.0) | 15.9 | 0.4 | 0.4 | 0.4 | 0.4 | 3.5 |

Box changes (round 2, kept since): one low sun (spot, 9) through a shoji
whose grid is projected by a cookie traced from the bars; fill 1.5 -> 0.22;
VSM acne on the grazing walls cured with bias (PCF soft was blurrier); a dust
shaft at about 3x the old strength; a glazed round window with a bamboo
cross showing a dusk sky, hills at two depths and the evening star; a plum
branch with blossoms on the wood; a turned tea bowl and a 48-segment vase; a
paper andon with ribs, brighter at the top.

## Fix round 1 after the second review (2026-11-14)

The second review (same instrument, HEAD 55c71e2) re-scored lighting 4 -> 8,
depth 6 -> 8, atmosphere 4 -> 7, Box 4 -> 7, and found:

1. **GPU memory leaks.** Each Soundstage <-> Box round trip leaked 17
   textures and 6 geometries; each Box resize 3 and 20. Causes: lights'
   shadow maps never released (VSM: two targets each), the throwaway scenes
   used for the PMREM captures (5 + 1 cards), rain's materials and its
   placeholder texture, the boom's and the mirror's own materials, material
   maps outside `m.textures` (softbox face, upper wall, glow cards), and the
   Box's `room.clear()` without freeing the old room. All freed now;
   `tools/scene-leaks.mjs` (and `tests/scenes/leaks.test.js`, opt-in GPU)
   switches three times and resizes three times: Soundstage 105 geometries / 57
   textures throughout (59 when the bake was on), Box 22 / 24 throughout (before: 59 -> 110 textures); after the round's Box paper, 23 / 25, still flat.
2. **The reveal test passed while the car hid the camera.** The test now
   checks occlusion: a 3x3x3 lattice over the camera body against the car
   (body and greenhouse boxes from `carBoxes`), the facade, the diner's end
   wall, the softbox and the flag. The old placement fails it (at 25 cm the
   greenhouse hides 8 of 27 points, 3 are out of frame; at 15 cm it is out
   of frame entirely).
3. **Bake** off by default (above); its UV copy is dropped after baking.
4. **Left-lean payoff.** The B-camera moved to the corner of the sidewalk
   (BCAM in `layout.js`: x 5.45, z 0.6, on a riser, lens at 1.95 m), aimed
   down the windows; the softbox and the C-stand flag moved off its
   sightline. All 27 lattice points seen from a 20 cm lean on, 15 of 27 at 15 cm, none
   straight on or at 10 cm; the car stays where it is as the near layer. The car's paint
   is darker and glossier (roughness 0.05), its capture 512 instead of 256,
   its environment at half strength, and it carries crisp glints of the real
   sources (`addGlints`: the DINER letters, EATS, the windows, the lamp) so
   the fender and hood mirror the neon instead of a beige wash.


Also from the review's minor list: the Box's shoji paper is now there and
backlit (luma 230 from a right lean; it was an empty opening at ~93 next
to rb01's 245) and a warm lift puts the blacks at p10 3.5 (was 0.4; rb01
3.9); the softbox face reads as a lit diffusion a couple of stops under the
HMI instead of a grey card; the diner's window light lights the rain in
front of the facade (rain gain 0.14 -> 0.45) so the subject reads wet.
Code: per-frame allocations hoisted, the streak occluder test moved after
the cheaper across-lobe rejection, dead hash code removed, the grime
program keyed on every value it bakes in, a no-op string replace removed.

## Build-out for the bigger motion (rounds 7-8, 2026-11-14)

The user asked twice for bigger motion ("a movement with the eye or head
should correspond to a bigger movement on screen"), then for the scenes to
be built out. Look around now runs at 3x by default (Strength 1-5x; depth
gets half the extra, 2x), so a 15 cm lean swings the virtual eye 45 cm and
an 8 cm rise or duck 25 cm. At 2x the earlier contact sheets showed that a
30 cm offset at 20 cm away ran past both sets into nothing: the scenes had
to grow to meet the motion.

**The range the scenes are built for** (virtual eye, window coordinates,
seat at 60 cm): +-45 cm sideways, 25 cm up and down (and on to +-45 cm
for head tilt, below), 35-85 cm away, the diagonals, and the corners of a
cone |x| <= z, |y| <= 0.8 z. `tools/scene-rounds.mjs --eyeset extremes`
renders 21 eyes over it onto one board per scene
(`board-9-<scene>-extremes.jpg`); `--viewer-strength 3` films the viewer's
view with the phone moving with the head while the image is drawn from the
mapped eye.

Where to build was worked out from the frustum, not guessed. From the eye at
45 cm left (real (-7.2, 2, 16) in set metres) the window's right edge ray
reaches real x = 9.15 - 1.022 z at depth z, its left edge 0.45 - 0.478 z, so
the frame sees the stage floor and gear only in a wedge behind the set
(x 7-13 at z -5..1), the right stage wall beyond z -4.95 and the back wall
beyond x 8.6; low things there sit behind the car (anything under ~1.4 m
at z -2). The mirror applies on the left. Looking up from 25-30 cm down
the frame reaches 19 m on the back wall, above the old 12 m walls; looking
down from 25-50 cm up it sees only a 0.4-0.6 m strip of floor in front of
the street deck.

### Soundstage

- **The building** (`stage.js`): walls up to a roof at 14.5 m on steel
  trusses every 4 m, purlins, catwalks with rails along both side walls at
  10.4 m, ten chain motors on the bottom chords with their chains down to
  the grid, nine more fresnels hung in the grid (four burning), three LED
  panels switched low, a painted band and kick rail on the walls. Lit only
  by caged bulbs under the catwalks and on cords from the trusses (their own
  work-light list: the roof steel never pays for the floor's bulbs), so it
  reads as ss02/ss05 do: near-black, cut by lit edges and a few hot points.
- **Stage right, the crew area** (`crew.js`): video village on a tall cart
  under a black tent, its two monitors carrying the shot (a painted A- and
  B-camera feed with frame lines, timecode and the record dot); director's,
  DP's and script supervisor's chairs with their names on the backs, two
  cast chairs; an apple-box stack (full, full, half, quarter, pancake);
  craft services under a clamp light (urns, cups, fruit, a cooler); flats
  in storage leaning on the wall; a parked stair wagon; the stage door with
  its exit sign, a red rolling light (on: they are rolling) and a "do not
  enter when red light is on" plate, "STAGE 7" on the wall, the stage's
  power panels under a bulkhead light with conduit up to the catwalk, a
  caged ladder. The right-hand side legs came out (they hid the wall).
- **Stage left, the street end** (`streetend.js`): the street deck runs on
  past the side street to x -9.4 under the lengthened rain rig (it stops at
  -7.6, rain at the same density), and ends at a 12 x 8 m translight of the
  street going on into the city, painted in forced perspective for the
  shot's camera. From the side its vanishing lines point at nothing, and
  the backlight's hot spots, the sewn seams and the grommet edge show: a
  painted drop. It backlights the rain in front of it (a fifth rain light,
  no shadow map), and its glow lies on the floor at its foot. The rig's
  header and feed riser come down behind the deck to a valve manifold; a
  4-inch hose comes in from the water truck through a door in the back wall,
  through a pump on its cart. The kick light, flag and hazer now stand on
  the deck; the spare WILD flat moved behind the far kerb, braced onto it.
- **Below the shot**: along the deck's front edge the A-camera's dolly
  track on wedges, cable runs and a yellow crossover, sandbags, spike tape;
  actors' T-marks on the street.

### Box

- **The engawa and the garden** (`box/garden.js`): in front of the lattice
  window the wall is cut from the floor to a lintel, the shoji door slid
  away, onto an engawa under its eave (boards, an edge beam, posts, rafters),
  a step stone, and a small garden at dusk: moss with mounds, stepping
  stones, a raked gravel bed, rocks, a stone lantern with its candle lit, a
  maple in red with its leaves in layered sprays, clipped shrubs, a plaster
  garden wall under a tiled cap, two ridges, and a sky dome (deep blue
  overhead, warm on the western horizon). The same low sun lights it as a
  directional term in the garden's own materials (the room's spot is
  compiled out of them), with a dusk sky fill and painted long shadows away
  from the sun; nothing outside casts into the room's shadow map or the
  dust shaft's bake.
- **The room next door** (`box/nextroom.js`, round 8): the right wall gets
  the mirror of the door, a fusuma slid open onto a dim tatami room lit only
  by its own paper lantern (a work-light term on its materials): painted
  fusuma with a pine bough and hills, a chest of drawers, a scroll, a
  cushion. Round 7's boards showed the right wall from the left swings as
  one dead plaster surface; now both swings open the room.
- **Up and down**: the ceiling gets slender rods running back and a molding
  round its edge, and light bounced off the floor's sun patches (a
  work-light term on the ceiling only), so looking up shows boards instead
  of black. The bell hangs 3 cm in front of the glass (was 5), a little
  lower, which keeps it inside the frame from every eye the view allows
  (below).

### Rounds 7 and 8

Boards (kept outside the repo): `round-7/`
(before: `round-7/before/`) and `round-8/`, each with `extremes/` for the
3x range and `<scene>-viewer-3x.webm` for the viewer's clip.

- **Round 7** (build-out in): every extreme had content, but the boards
  showed the Soundstage's right wall as a black void from the low left
  diagonals, and the Box's right wall as one dead surface from every left
  swing. The next-room build also exposed a bug: the room's sun lit the
  next room through the wall with its lattice pattern, though its
  materials were masked. `lightmask.js` matched a blank-line layout of
  three's shader chunk that this three build doesn't have, so every
  per-material spot mask in both scenes had been a no-op. Fixed (regex on
  the loop's end, checked in the compiled shader); the Soundstage's centre
  moved by at most 1.6 luma (interior 143.4 -> 142.2 mean, facade 39.3 ->
  38.1), the street and upper facade not at all.
- **Round 8**: wall floods burning low high on the stage walls, then
  dimmer and smaller (their first pools read as a lit beige wall behind the
  softbox); the room next door; the Box ceiling's bounce up so its boards
  read from below; the crew-area bulbs down (the left lean's flat backs had
  risen to 116).

Near-view look targets, round 6 (before) -> round 8 (same instrument):

| Measure | Target | Round 6 | Round 8 |
| --- | --- | --- | --- |
| Soundstage frame p10 / p50 | <= 20 / 35-55 | 4.7 / 42.0 | 4.7 / 41.1 |
| Diner interior mean / median | ~150 | 143.4 / 151.5 | 142.2 / 150.9 |
| Street median / 9x9 peak | ~35 / streaks | 42.2 / 197.3 | 41.6 / 197.4 |
| Upper facade | ~20 | 21.8 | 21.8 |
| Flat backs, lean left / right | 90-110 | 99.8 / 92.3 | 111.3 / 89.5 |
| Box wall p10 / p90 / p99 | <= 25 / 150-170 | 10.4 / 158 / 201 | 10.2 / 162 / 198 |
| Box sun patch over shadow (p99 / p10, linear) | >= 16:1 | 184:1 | 182:1 |
| Box frame p10 | (rb01 3.9) | 3.5 | 3.5 |
| Box shoji paper, lean right | (rb01 245) | 230 | 230 |

The left lean's flat backs sit 1.3 over the band: the crew area's bulbs
add a little to the backs near video village (they were 116 before those
bulbs came down). The reveal-visibility tests (B-camera fully seen at
25 cm, half at 15 cm; moon, set edge, deck edge) pass unchanged, and the
two things in front of the glass now stay in frame over the whole range.

- **Round 9** (the review of the build-out, REVIEW-3): the translight's
  rain backlight had never run (five lights passed, four shader blocks);
  every declared light now has a block, more lights than blocks is an
  error, and `tests/scenes/rain.test.js` checks both shaders. The spot
  masks warn once if three's chunk stops matching, and
  `tests/scenes/lightmask.test.js` checks the masked chunk against the
  installed three. The softbox gets a fabric eggcrate and its rods; its
  face 2.6 -> 0.6, so its cells read 147 median / 167 p90 at L30 (was a
  210 white card). From high up, the wet asphalt's relief, the puddles'
  ripples, the mirror's distortion and the streak lobes calm with how
  steeply the street is seen (zero from the shot's height), so the
  puddles read as water, not crumpled foil; the car's body, glass and roof
  are crowned (normals bent to match) with drip rails and hood chrome, and
  its neon glints tightened (0.06 / 0.03 -> 0.018 / 0.01) from pink slabs
  to highlights. Focal points: a worn one-way arrow on the street from
  above; green status LEDs on the chain motors and two par cans burning on
  the trusses from below. Centre after: p50 40.6, interior 142.3 / 150.9,
  street median 42.9, upper facade 21.9, flat backs 108 / 89.7; Box
  unchanged. App: 60.0 fps, 0 / 1200 over 20 ms in both scenes; lab
  throughput 7.04 / 4.37 ms.

### View limits wanted

The cone in `src/tracking/view-map.js` belongs to the motion work; these
are the numbers the scenes are built and tested for (the round 7-8 boards
and the frame tests for the two things in front of the glass):

- sideways: |x| <= 0.5 m and |x| <= 1.0 z (45 degrees);
- vertical: up to 0.5 m up and 0.45 m down, |y| <= 0.8 z (39 degrees);
- depth: z 0.2-1.4 m.

The motion side has since set x 0.5, xPerZ 1.0, yMin -0.40, yMax 0.48,
yPerZ 0.8 (commit d3480b4), inside that. At its nearest corner (20 cm away,
16 cm down) the boom mic and the bell touched the frame's top edge, so the
boom's windscreen moved to 1.75 cm in front of the glass (was 2.5) and the
bell to 3 cm (was 5) and 4.6 mm lower. `tests/scenes/scenes.test.js` now
reads the limits from view-map.js and checks both against every corner of
the cone as well as the old eyes and the build-out's range.

## Frame times

All headless Chrome (ANGLE/Metal) on the M2 Air at the app's capped buffer,
2880 x 1864. Lab numbers vary by up to ~2x between runs with the machine's
state (other jobs on the GPU, power, heat); compare rows within one run.

**In the app, with face tracking on the fake-webcam clip**
(`tools/scene-app-perf.mjs`, 20 s per scene after 5 s of settling; final numbers after round 5 below the table):

| Run (round 4 scenes) | Buffer | fps | Frames over 20 ms | Tracking |
| --- | --- | --- | --- | --- |
| Test room (control), pinned 1.684 | 2879 x 1864 | 60.0 | 0 / 1200 | 25.7, 29.5, 24.7 Hz (three runs) |
| Soundstage, pinned 1.684 | 2879 x 1864 | 60.0 | 0 / 1200 | 30.1 Hz (round 2 scenes: 25.2) |
| Box, pinned 1.684 | 2879 x 1864 | 60.0 | 0 / 1200 (each run) | 25.1, 23.7, 28.4 Hz |
| Soundstage, default (adaptive) | 2137 x 1383 (1.25x) | 60.0 | 0 / 1200 | 29.3 Hz; stepped down twice on early tracking dips (24 of 30 camera fps) |
| Box, default (adaptive) | 2880 x 1864 | 60.0 | 0 / 1200 | 30.1 Hz |

After fix round 1 (round 6 scenes, pinned 1.684, 2879 x 1864): test room
60.0 fps, 0 / 1200 over 20 ms, tracking 23.7 Hz; Soundstage 60.0 fps,
0 / 1200, loop JS p99 1.00 ms, tracking 29.8 Hz; Box 60.0 fps, 0 / 1200,
tracking 26.4 Hz.

After the 3x build-out (round 8 scenes, pinned 1.684, 2879 x 1864, a
fresh fake-webcam clip from `tools/core-facegen.mjs`): Soundstage 60.0 fps,
0 / 1200 over 20 ms, loop JS p99 1.60 ms, tracking 30.4 Hz; Box 60.0 fps,
0 / 1200, loop JS p99 0.60 ms, tracking 26.0 Hz. Lab: Soundstage throughput
7.27 ms (round 6: 7.94; the spot masks now work), synced mean 9.41 / p95
11.70 ms, 144 draws, 120k triangles (mirror 0.73, scene 6.62, haze 0.82,
bloom 1.04, final 1.86); Box 4.52 ms, synced 7.49 ms, 50 draws, 30k
triangles. GPU memory stays flat over three scene switches and three Box
resizes (`tools/scene-leaks.mjs`: Soundstage 136 geometries / 62 textures
throughout, Box 36-38 / 28).

Render never misses: 0 frames over 20 ms in every run, both scenes, at the
full capped ratio. Tracking varies run to run by about as much for the
near-empty test room as for the scenes (23.7-30.1 Hz overall), so the
fake-webcam tracking rate is not set by the scene; see Honest gaps.

**Lab, per pass** (each section synced on the target it wrote; serialised,
so an upper bound): round 4 Soundstage mirror 0.71, scene 7.05, haze 0.85,
bloom 1.03, final 1.80 ms; Box scene ~2.9, haze 0.8, bloom 1.0, final 1.8 ms.
Throughput (frames back to back): Soundstage 7.8-9.7 ms, Box 4.3-5.7 ms.
Round 6 (bake off, car glints, 512 car capture, shoji paper): Soundstage
throughput 7.94 ms, synced mean 9.37 / p95 10.40 ms (mirror 0.62, scene
6.62, haze 0.79, bloom 1.00, final 1.82); Box 4.30 ms, synced 5.75 / p95
7.50 ms (scene 3.02). The car glints and the sharper capture did not show
up against the run-to-run spread.

**What the Soundstage frame is spent on** (synced ablation, median frame):
haze + bloom 2.7 ms, 2x MSAA 1.5-2.2 ms, wet street 1.4-1.8 ms; glass,
interior, facade, buildings, backstage each 0.1-0.5 ms (±0.7 ms noise).
The lighting bake removed the per-pixel spot and work-light shading from
26 materials (2 pages of 2048², 4,698 charts, 42 % fill) and reproduces the
frame within ~2 luma, but did not move the frame time measurably in A/B
runs (7.87 vs 7.83-7.87 ms): after the per-material light masks, lit-surface
shading was no longer the bottleneck; the second review's A/B agreed
(10.41 vs 10.38 ms). It is now **off by default** (lab flag `?bake=1`) since
it held 64 MiB of half-float pages and a 32 MiB transient target for nothing
measurable; the live lighting renders within 1.5-5 luma of the baked frame.

The old pass profiler read the canvas between passes; ANGLE only waits for
writes to the framebuffer it reads, so every offscreen pass was billed to
the final pass ("scene 0.9, final 12 ms"). It now syncs on each pass's own
target.

## Licences

All geometry and textures are procedural code in this repo. No third-party
assets are used; `public/assets/` is empty, so there is no LICENSES.md to keep.
Reference photos were only compared against and are not in the repo.

## References used (links only)

Perception and hardware: `docs/REFERENCES.md` (sections 1.5, 5.4, 6).
Photos compared against (kept outside the repo; the links are below):

- Soundstage BTS: https://www.flickr.com/photos/34128007@N04/5536694642/ ,
  https://www.flickr.com/photos/34128007@N04/5528754803/ ,
  https://www.flickr.com/photos/34128007@N04/5528596154/ ,
  https://commons.wikimedia.org/wiki/File:Wissen_macht_Ah!-6912.jpg ,
  https://commons.wikimedia.org/wiki/File:Vienna_-_Vienna_Opera_Backstage_-_9729.jpg ,
  https://www.flickr.com/photos/28752865@N08/7388835780/
- Flat backs: https://www.flickr.com/photos/51035566106@N01/68488183/ ,
  https://www.flickr.com/photos/51035566106@N01/1848740646/ ,
  https://commons.wikimedia.org/wiki/File:Stage_weight_supporting_a_scenery_brace_2014-01-25_11-52.jpg ,
  https://commons.wikimedia.org/wiki/File:Backside_of_Set,_Cinecitt%C3%A0_Studios_(45898195885).jpg
- Grip gear: https://commons.wikimedia.org/wiki/File:Set-up_(3391792777).jpg ,
  https://commons.wikimedia.org/wiki/File:Fisher_dolly_on_track_wide.JPG ,
  https://www.flickr.com/photos/34325628@N05/13158484383/
- Night rain: https://commons.wikimedia.org/wiki/File:Aquaman_night_scene.jpg ,
  https://commons.wikimedia.org/wiki/File:Farol_ilumina_a_chuva_de_noite.JPG ,
  https://commons.wikimedia.org/wiki/File:Barclays_Center_Rain_Night.jpg ,
  https://commons.wikimedia.org/wiki/File:54525452215_-_Flickr_-_mirrors_are_more_fun.jpg ,
  https://commons.wikimedia.org/wiki/File:Late_Saturday_Night_at_Mickey%27s_Diner.jpg
- Miniatures: https://www.flickr.com/photos/50489306@N02/4700998570/ ,
  https://www.flickr.com/photos/50489306@N02/4639168083/ ,
  https://commons.wikimedia.org/wiki/File:Filmmuseum_Berlin_-_Asphalt_Film_Set_Street.jpg ,
  https://commons.wikimedia.org/wiki/File:Filmmuseum_Berlin_-_Metropolis_Model_Upper_City.jpg
- Room box: https://commons.wikimedia.org/wiki/File:Hall_d%27h%C3%B4tel_3_avec_rayon_de_soleil.jpg ,
  https://commons.wikimedia.org/wiki/File:Biblioth%C3%A8que_en_miniature_(9431066162).jpg ,
  https://commons.wikimedia.org/wiki/File:Hanging_scroll_and_Ikebana_in_Tokonoma.jpg ,
  https://commons.wikimedia.org/wiki/File:150921_Todoroki-ke_Azumino_Nagano_pref_Japan16s3.jpg
- Diner interiors (the Soundstage's stations): https://commons.wikimedia.org/wiki/File:Exmore_Diner_Interior_North.jpg ,
  https://commons.wikimedia.org/wiki/File:Interior_of_Lafayette_Coney_Island,_Detroit.jpg ,
  https://commons.wikimedia.org/wiki/File:Belle%27s_Diner,_French_Market_Place,_New_Orleans,_24_May_2016_-_Counter_stools.jpg ,
  https://commons.wikimedia.org/wiki/File:Highspire_Diner_Interior_01.jpg ,
  https://commons.wikimedia.org/wiki/File:Modern_Diner_-_Interior.jpg ,
  https://commons.wikimedia.org/wiki/File:Salem_Oak_Diner_Interior_01.jpg

## Honest gaps

- **Tracking rate.** At the capped pixel ratio the scenes render at 60 fps
  with no frames over 20 ms, but tracking on the fake-webcam clip runs below
  27 Hz on this machine for every scene, including the near-empty test room
  (see the table above): it is set by CPU inference and the machine's state,
  not the scene. In default mode the app's adaptive resolution then steps
  the pixel ratio down on tracking alone (core's `resolution.js`, not a
  scene setting).
- **Street median** sits at ~46 against the review's ~35. The road between
  the streaks is ~28 (measured with the lobes off); the median of the street
  class counts the streak smears too, and on a thin strip of street (about
  9 % of the frame from the centre) the DINER band covers much of it. By
  the same statistic, nr06's street region is 42.5.
- **Interior** 143 mean / 151 median (target ~150): AgX compresses the top
  end; much further and the blinds wash out.
- **The left lean** shows the camera and the flat backs (92) above and
  behind the car: the car still takes the lower right of that view.
- **The car** reads as a glossy near silhouette with the neon on its fender, but its
  front end is simple (rounded fender, rings, no grille detail) and up close
  it looks modelled rather than photographed.
- **Softbox**: gridded since round 9; from the front its cells are still
  the brightest thing in the right third.
- **Grid**: the black borders (as on a real stage) hide most of the pipe
  grid when ducking; the reveal from below is borders, rain bars, the HMI.
- **Optional diner angle** (15-20 degrees about the corner) not done: it
  would need the haze clear box oriented and the reveal geometry re-tested.
- **Thin edges**: neon and globes are shaded so their edges sit well under
  the core, frames and trim are satin; there is no tonemap-before-resolve,
  so a few hot specular edges (car chrome, hood highlight) can still step.
- **Box**: no polished-floor reflections of the sun patches (rb01 has them),
  and the shaft does not carry the lattice's bars (the haze bake doesn't see
  the cookie).

From the 3x build-out (rounds 7-8):

- **The car from high up** is better since round 9 (crowned, trimmed,
  tight glints), but its rear glass still mirrors the sign band as one
  pink panel, and the extrusions' sides stay flat.
- **The painted drop**'s windows are a regular grid of flat squares: it
  reads as a painted city from 30-45 cm to the right, but up close the
  painting looks digital rather than brushed.
- **The maple** reads as sprays of cut leaves, not a dense canopy, and the
  garden's shadows are painted (no shadow map outdoors).
- **The monitors** carry a painted picture of the shot, not the render.
- **The roof** is near-black between lit edges, as on a real stage
  (ss02, ss05); from straight below (40-45 cm down) half the frame is
  trusses and dark roof deck.
- **View limits**: the cone the scenes support is in "View limits wanted";
  the motion side owns `view-map.js`, so applying it is theirs.

## Box navigation (2026-11-16)

The Box is now a house in a world you can carry the window through
(`box/nav.js`; the contract in docs/ARCHITECTURE.md). Stations, written as
where the seated eye sits (`poseFromEye`); scale 0.1 is a viewer a little
larger than life in the 1:12 house:

| Station | Eye (scene m), yaw / pitch, scale | What it shows |
| --- | --- | --- |
| The room | identity rig, 1 | today's view, unchanged |
| By the window | (0, 0.035, -0.04), 30 / -8, 0.1 | the lattice glowing behind the plum branch, dust in the shaft |
| The engawa | (-0.222, -0.045, -0.27), 92 / -1, 0.1 | seated on the veranda: the lit lantern, the maple backlit, raked gravel, the wall, layered ridges, the sunset |
| The garden | (-1.25, -0.016, -0.1), -90 / 4, 0.1 | from the gravel bed: the house under its tile roof, the sunlit shoji, the room inside through the door, the maple overhead |
| The next room | (0.24, -0.045, -0.04), -15 / -3, 0.1 | the tokonoma and its scroll, the lantern, the chest, painted closet doors |
| Under the eave | (-0.235, -0.025, -0.335), 146 / 60, 0.1 | the fūrin against the rafters and the dusk |

Bounds x -1.3..0.8, y -0.07..0.35, z -1.25..0.06; scale 0.06-1 (200 x 0.06
= 12 m of far plane, past the dome at 9.5); tour room, window, engawa,
garden, next room, eave.

What was built: the house from outside (`house.js`: gabled tile roof with
its south gable flush with the open front, plaster over cedar boards, the
shoji paper sunlit outside, a crawl space on stone footings, the engawa,
rafters and a pale soffit, a glass fūrin); the garden on a stone terrace
(`garden.js`: moss with instanced cushions, slab stepping stones, a
tsukubai with a bamboo spout and water that mirrors the sky from the eye's
world position, a lit lantern that lights the moss round it, an instanced
red maple of ~16k leaves, raked gravel with three rocks, azaleas, a hedge
along the terrace edge, plaster walls under tile, a bamboo grove behind the
house); the world (`world.js`: terrain dropping to a valley of paddies
under a battered stone wall, wooded hills to the north and east, four rings
of ridges, a dusk dome with cloud streaks and point stars); the next room
finished for an inside view. Outdoor light (`outdoor.js`): the room's low
sun as a directional term with its own shadow map over the terrace
(rendered once, hardware-filtered), sky fill, aerial perspective; all of it
reads three's `cameraPosition`, i.e. `view.eyeWorld`. Nothing outside casts
into the room's spot shadow or the shaft's bake, and nothing of the house or
the world stands in front of the glass at the room's view (the terrace ends
in a stone wall at z = 0 and the gable is flush), so the room's numbers are
unchanged: wall p10 / p90 / p99 10.2 / 160.9 / 197.7, 182:1, shoji at the
right lean 231, frame p10 3.5.

Regional detail from the rig: the round window's painted dusk only while
the eye is in the room or the rig is at rest; the forest and the bamboo
grove only from outside the house; the dust shaft only while the room is in
the frustum (it is lighter, x0.3, looking into the sun from inside the
room, and no longer rises as a column above the roof).

Checks (`tools/scene-box-nav-rounds.mjs`, ports 5196-5197): every station at 12
head eyes (the view-limit corners, near 20 cm, far 140 cm): void 0, back
faces at most 0.023 % (silhouette pixels of thin boxes); 145 random rig
poses in bounds and scale: void 0. Lab throughput per station 4.9-5.9 ms
(synced p95 7.6-9.4 ms, 41-65 draws, up to 724k triangles in the garden);
in the app with tracking on the fake-webcam clip, pinned 1.684 (2879 x
1864), every station 60.0 fps, 0 / 1200 frames over 20 ms
(`tools/scene-box-app-perf.mjs`). GPU memory flat over three reloads and three
resizes. Tests: `tests/scenes/box-nav.test.js` (GPU part opt-in).

Gaps: the stations are fixed points while the room scales with the window,
so on a much smaller or larger screen they sit a centimetre off; the
narrow window (30 x 19 degrees at 60 cm) makes every station telephoto, so
the head-tracking extremes look far off the composed view (finished, but
mostly sky, ground or walls); at random poses an eye can end up inside a
solid (roof slab, attic, hedge, wall, ceiling slab) and see through it, and
below the ground it sees dark earth; the forest reads as low-poly up close;
the maple's front-lit leaves go salmon at the highlights (AgX); the shaft's
low-resolution haze steps along depth edges at the window station's
extremes; the garden's shadows come from one 2048 map (soft, not crisp, up
close).

## Soundstage navigation (2026-11-17)

The user asked to "build out the 3d scene more and give options to move
around and observe a lot more". The rig (docs/ARCHITECTURE.md, "Moving the
window") carries the window through the scene; the Soundstage's `nav`
(`soundstage/nav.js`) gives it eight places, each a composed view.

### Stations

Each is written as a person in the full-size set: an eye and a look point
in set metres and a scale (`poseFor`); the glass sits 60 cm (times the
scale) in front of that eye, so the default eye lands on it. Scale 1/16 is
life size: a 15 cm lean is 15 cm in the set.

| Station | Scale | Eye (set m) | What it shows |
| --- | --- | --- | --- |
| The shot | 1 | (0, 2, 16) | Today's view, the identity rig, unchanged. |
| On the sidewalk | 1/16 | (4.83, 1.68, 1.8) | A step back from the glass by the door, in through two windows at life size: the man at the counter, the booths, the side window at the far end, blinds, rain in front. |
| Inside the diner | 1/16 | (7.3, 1.6, -1.15) | The whole length of the room from its far end: counter and stools, the couple, the waitress, the back bar (urns, lit pie case), letterboard menus, the pass with the cook and the kitchen behind, booths along the windows, the side window with rain. Lean toward the windows: the street, the rain ending at the rig, the crew and lights out front. |
| Behind the camera | 1/16 | (0.55, 2.2, 18.9) | Over the A-camera on its dolly (a 35 mm film camera: rounded housing, top magazine with two lobes, tally lights, rear display, battery, tape labels, lens with gear rings, matte box with flags, follow focus, a focus motor, rods, viewfinder with eyecup, its monitor showing the shot live, geared head, dolly with arm, seat and push bar on track), the operator on the dolly, and the whole set beyond. |
| The backdrop | 1/16 | (-3.1, 2.1, 2.6) | Down the street's own axis, tilted down 9.5 degrees: the wet deck runs to its edge, the rain stops in the dry gap, and the painted street carries on to its vanishing point at the top of the frame (painted for this line); seams, hot spots and brushwork up close. |
| Backstage | 1/16 | (2.35, 1.66, -4.92) | The gap behind the diner: the back wall's braced back (stencils), kickers and stage weights, cables, a coil, a ladder, a work bulb, the next set's jacks, and at the end the stage door with its exit sign and the red light on. |
| Video village | 1/16 | (7.36, 1.72, 2.11) | Behind the chairs (DIRECTOR, D.P., SCRIPT on the backs), the director in a headset and the script supervisor with her binder, the monitors carrying the A and B cameras live. |
| The catwalk | 1/16 | (-12.9, 12.05, 27) | From the stage-left catwalk's front corner, over the rail: the diner, the rain under its rig, the car, the softbox, video village with its people and monitors, the stage door and exit, the dolly track. |

Tour: shot, sidewalk, inside, camera, backdrop, backstage, village,
catwalk (the frame, the street, inside, the reveal, the crew, up high).

**Bounds and scale.** `bounds` x +-12.8 m, eye height 1.3-12 m, z -15 to
30 m (set metres; window units in nav.js); `scale` [0.05, 1]. With the eye's
range at life size (+-45 cm sideways, 30-35 cm up and down, 35-85 cm back)
that keeps the eye inside the building's walls, above its floor and under
its trusses anywhere in the bounds at any heading (`tests/scenes/nav.test.js`,
4000 random poses), at every station over the range, and along every glide
of the tour. `nav.room` (an extra field) is the building's inside in window
units: at scales near 1 the eye's own reach (1.4 m back from the glass is
22 m in the set) can carry it through a wall when turned sideways near one;
the nav could clamp the eye to `room` (not done here: src/core is not
mine).

### What was built

- **The building** runs on to a front wall at z 32 (it ended at z 9, behind
  the glass): walls, roof, trusses, catwalks, floods, bulbs and motors over
  the camera end, an elephant door, a man door with an exit sign. The pipe
  grid stays over the set only, so from the catwalks the line of sight
  passes under it to the camera end.
- **The camera end** (`front.js`): the A-camera at the shot's own eye (lens
  at (0, 2, 16)) on its dolly and track, its operator, dolly grip and 1st
  AC; an HMI into a 12 x 12 bounce, a tube light burning low, fresnels off,
  flags, a camera cart, a grip cart of stands, road cases, cables.
- **The interior** (`interior.js`), rebuilt to be walked into: booths at
  the windows (tables, napkin boxes, sugar, ketchup), the counter (formica,
  chrome nosing, red panels) and eight stools, the back bar with two urns
  and glass pots, a lit pie case, mixers, cups and plates, shelves, steel
  backsplash, three letterboard menus, a clock, the pass (heat lamps,
  tickets, plates) and a kitchen behind it (range, griddle, hood with its
  lamp, pots, tile, fluorescent). The back wall moved from z -3.6 to -4.2.
  Lit by its practicals (pendants, domes, the pie case, the kitchen through
  the pass) as work-light terms with a little fill; the floor and tops are
  glossy with the pendants' glints; contact-shadow cards under furniture.
- **People** (`people.js`): procedural adults posed by pelvis, hands and
  feet (two-bone IK), superellipse torso and head, hair grown from the
  scalp above a hairline, coats, collars and lapels, aprons, hats, headsets,
  vertex-coloured so every region's people are one draw. In the diner: a
  couple at the counter, a man in the corner booth, the waitress with a pot,
  the cook at the pass; out front: the camera crew; at video village: the
  director, the script supervisor, the DP.
- **Live monitors** (`feeds.js`): the shot (512 x 322) and the B-camera's
  view (448 x 280) rendered into small targets through a light pipeline (no
  haze; 4x MSAA, bloom, the same grade), at most 8 times a second round
  robin, only while one of their screens is in view and at least 24 px
  tall. They show on the A-camera's monitor and the two at video village
  (the painted feeds are gone). Their wet street uses its own small mirror
  target (`PlanarMirror.renderTo`), and the rain's pixel width is set for
  the feed's camera while it draws.
- **The translight** at the street's end: hot spots from a bank of sky pans
  now hung behind it on a pipe frame, eight printed panels a shade apart,
  sewn seams that pass less light, brush streaks, print grain, grommeted
  hems (a shader at real size, `translightDetail`); the baked seams that
  read as black poles up close are gone; both sides drawn (from behind it
  shows its picture mirrored); painted pavement below its horizon.
- **The boom** is rigged: its pole carries on past the pivot to a clamp
  under the grid (it ended in mid-air from every view but the shot's).
- **Video village** chairs face the monitors (they faced away).

### Region switches (all from `view`, never from the window-space eye)

- (Until fix round 1 the camera end and the diner's small props switched
  on at scale 0.6, a pop on every glide out of the shot. Now they are always
  drawn; see below.) The A-camera hides while the eye is inside its body (a
  glide passing through it).
- The diner's end wall is a wild wall: as the eye comes up behind it from
  the stage side, inside the room's length, it flies 4.6 m up into the grid
  (a ramp over 2 m, no pop). Nothing changes at the shot.
- Feeds update only while a screen is in view (frustum and size test).

### World-space effects under the rig

The wet street's mirror and streak lobes, the car's glints, the interior's
glints and the haze all read `cameraPosition` / the camera's world matrix:
they follow the rig (checked at every station's renders). The rain's minimum
streak width is an angle (window height over the eye's distance to the
glass, both scaled by the rig: it cancels), so the window-space eye is right
there; the feeds set it for their own camera. One bug the rig exposed: at
scale 1/16 the near plane comes 16 times closer and the 24-bit depth buffer
loses precision across the stage, so the painted sign 3 mm in front of the
upper wall z-fought from behind the camera. The scene's render now uses a
copy of the camera with the near plane at least 5 cm (real) out
(`_lib/depthcam.js`; the same image, the depth buffer ~6x finer; the shot
is untouched, its near plane is already further out).

### View limits and typical head moves

Every station but the shot carries `subject` and `view` (docs/ARCHITECTURE.md):
at life size every subject is metres behind a 33 cm window held 60 cm away,
so the window acts as a long lens and an eye moved off centre mostly pans.
Look around is held to 1.5x (sidewalk, inside, camera, village) or 1.2x (the
backdrop, backstage and the catwalk, the farthest subjects), with no extra
up and down, and the eye stops 85 cm (80 on the catwalk) from the glass.
The shot keeps the global settings; its subject is the boom mic, the one
thing in frame from every eye by design. The subjects sit on each station's
line of sight; `checkSubjects` (src/core/subject-check.js, the app's own
mapping of +-10 cm sideways, +-6 cm up and down, +-10 cm in depth and the
corners) passes for all eight.

Each station is rendered at its typical moves under those limits as well as
at the eight edges (`tools/scene-nav.mjs`, 15 eyes a station), and no frame
may be uniform black (90th-percentile luma under 8). Round 3 found four:
backstage leaning far right (the gap's far side, the painted face of the
flat behind the diner, had no light: a lit panel of it now, below the
diner's roofline where the shot can't see it) and the catwalk leaning far
left and right (the dark stage-left wall at the camera end and the length
of the catwalk itself: lamp carts and cases parked along the wall under
work bulbs, and caged lights over each catwalk). After: none in 120 frames,
the lowest 90th percentile 9; typical moves 64 and up.

### Rounds

Boards are kept outside the repo, as before: `nav-round-0` (today's scene
from first-guess poses), `nav-round-1` and `nav-round-2` (`board-stations.jpg`,
`board-<station>.jpg` with the eight edges, void masks for frames that had
any, `perf.log`), from `tools/scene-nav.mjs`. Reference photos added for the
interior (Commons, see References): Exmore, Lafayette Coney Island, Belle's,
Highspire, Modern, Salem Oak diners.

- **Round 0**: every station unbuilt: the sidewalk and inside looked at
  flat-shaded silhouettes; the camera station showed the shot with
  z-fighting on the upper wall (the near-plane bug above); the backdrop's
  baked seams read as black poles; the catwalk looked down through the pipe
  grid at the diner's bare ceiling.
- **Round 1**: the interior first seen from a booth: at 30 degrees and life
  size, a 7 m room only gives medium shots, and the near customers filled
  the frame. Candidates from booths, the counter and the door all failed
  the same way; the wild wall gives the room's full length (8.5 m). The
  A-camera came out mirrored (aimMatrix's local +x is world -x); a C-stand
  flag stood in the lens's way; the B-camera feed rendered from inside its
  own body; the catwalk's view crossed the grid (moved out front, the grid
  over the set only); backstage stood in a rack of spare flats (removed;
  the station moved to the gap behind the diner, the stage door to its end).
- **Round 3**: view limits and typical moves (above); the inside station
  stepped back 0.7 m.
- **Round 2**: no void in any of the 72 frames (8 stations x 9 eyes). Back
  faces (one-sided surfaces seen from behind): under 0.6 % everywhere but
  the catwalk (2.7 % at its default eye, in the brick building's braced
  back as seen over the wall, which renders correctly) and the shot's
  lowest eyes, which are under the stage floor and see its underside (the
  frame culls it; unchanged since before the rig).

### The shot after

Same instrument as rounds 6-9 (`tools/scene-rounds.mjs`, centre eye):

| Measure | Target | Round 9 | Now |
| --- | --- | --- | --- |
| Frame p10 / p50 | <= 20 / 35-55 | 4.7 / 40.6 | 4.7 / 42.4 |
| Diner interior mean / median | ~150 | 142.3 / 150.9 | 148.7 / 160.5 |
| Street median / 9x9 peak | ~35 / streaks | 42.9 / 197.4 | 41.9 / 197.4 |
| Upper facade | ~20 | 21.9 | 21.9 |
| Flat backs, lean left / right | 90-110 | 108 / 89.7 | 109 / 95.8 |

The rebuilt interior reads through the windows as a lit room with people at
the counter, the cook in the pass and the waitress behind; its mean is
nearer the target, its median 10 higher (the counter and back wall are
brighter where the pendants are). The B-camera reveal and the boom tests
pass unchanged.

### Frame times

Lab, headless Chromium (ANGLE/Metal) on the M2 Air, 2880 x 1864, the sway
path at each station (`perf.log`):

| Station | Throughput | Synced mean / p95 | Draws | Triangles | rAF loop, 15 s |
| --- | --- | --- | --- | --- | --- |
| shot | 9.91 ms | 12.81 / 15.50 | 190 | 199k | 60.0 fps, 0/900 over 20 ms |
| sidewalk | 7.59 | 9.34 / 10.80 | 138 | 178k | 60.0, 0/900 |
| inside | 7.95 | 9.51 / 12.10 | 146 | 166k | 60.0, 0/900 |
| camera | 8.78 | 13.02 / 21.30 | 220 | 243k | 60.0, 0/900 |
| backdrop | 6.41 | 8.34 / 10.00 | 64 | 77k | 59.9, 1/899 (one 33 ms frame) |
| backstage | 6.97 | 17.98 / 25.80 | 116 | 101k | 60.0, 0/900 |
| village | 6.68 | 10.60 / 17.20 | 76 | 107k | 60.0, 0/900 |
| catwalk | 8.83 | 14.05 / 22.10 | 251 | 247k | 60.0, 0/900 |

The shot's throughput rose from 7.04 ms (round 9) to 9.91 ms: the detailed
interior now shows through its windows (scene pass 6.6 -> 8.1 ms). Feeds
cost 0.05-0.24 ms a frame on average (a feed is drawn about every 4-8
frames, only where a screen is in view; the shot draws none).

**In the app** with face tracking on the fake-webcam clip, pinned at 1.684
(2879 x 1864), each station reached by a glide, settled 2 s, measured 15-20 s
(`tools/scene-app-perf.mjs --stations`):

| Station | fps | Frames over 20 ms | Tracking |
| --- | --- | --- | --- |
| shot | 60.0 | 0/1200 (twice) | 30.0, 30.3 Hz |
| sidewalk | 60.0 | 0/900, 0/1200 | 25.6, 29.5 Hz |
| inside | 60.0 | 0/900 | 23.6 Hz |
| camera | 60.0 | 0/900 | 26.2 Hz |
| backdrop | 59.5 | 7/894 (0.78 %) | 30.6 Hz |
| backstage | 60.0 | 0/900 | 30.2 Hz |
| village | 60.0 | 0/900 | 27.5 Hz |
| catwalk | 60.0 | 0/900, 0/1200 | 30.4, 29.8 Hz |

The first pass over the stations measured the first four right after the
scene loaded and missed frames there (the shot 14 %, tracking starved to
9 Hz); measured again after warm-up they were clean except the shot at
1.12 %. The shot then got two trims (small props, a pixel or two there, are
drawn only away from the shot; lighter joints on people; the diner's and the
camera end's lamps left out of the street's mirror) and measured 0/1200
twice.

### Honest gaps

- **People** read as well-proportioned figures at 3 m and more; closer
  (the sidewalk, video village) their faces and hair are simple: no
  wrinkles in clothes, hands as mittens with a thumb, a bob that reads as a
  helmet from some angles.
- **Narrow window**: at 30 degrees, the life-size stations are medium shots;
  leaning in (35 cm) opens the room to ~50 degrees. The sidewalk frame is
  tight on the windows and busy with mullions.
- **Feeds** have no haze (the moon's beam is missing on the monitors) and
  update at 8 Hz.
- **Transitions**: the camera end appears when a glide's scale crosses 0.6
  (early on the way out of the shot); a glide from the shot to "Behind the
  camera" passes through the A-camera, which hides while the eye is inside
  it.
- **Large scales**: see Bounds and scale (`nav.room` is offered, not used).
- **Catwalk back faces** (2.7-3.3 %): not traced to one mesh (hiding
  candidates by name only shifts the count); the frame there looks right.
  The GPU check holds void at zero and back faces under 4 %.
- **Interior median** 160.5 against ~150 (mean 148.7).
- **The painted drop** reads as painted at the station, but its buildings
  are still grids of quads, not brushwork, under the shader's streaks.
- **Interior light** is work-light terms without shadows: no pendant
  shadows under the stools beyond the contact cards.

(The gaps above are as of the first review; the fix round below closes the
catwalk's back faces, the mittens, the 0.6 switch for the small props and
the unused `nav.room`.)

### After the review (Soundstage fix round 1, 2026-11-17)

The independent review scored the stations 5-7 (shot 7, sidewalk 6, inside
7, camera 7, backdrop 5, backstage 6, village 7, catwalk 7) with no critical
findings. What changed:

- **Feeds** (`feeds.js`): each feed has its own pipeline. Sharing one, two
  feeds of different sizes rebuilt its targets on every draw (30 rebuilds
  in 2 s at video village). No per-frame allocations; the refresh clock
  restarts when scene time goes back (it stalled). About 8 draws a second
  per feed, at most one feed a frame (`tests/scenes/feeds.test.js`).
- **No pop leaving the shot.** The diner's small props (cups, shelf goods,
  mixers) are always drawn: they are in view through the windows, and
  switching them at scale 0.6 changed 9 % of the frame in one step. The
  camera end still shows only under scale 0.6: from the shot's leaning eyes
  its gear (the bounce, the HMI, a gaffer) would stand between the eye and
  the glass, and along a glide out of the shot none of it is in view at the
  switch. `tools/scene-glide-pop.mjs` (shot to camera, 40 steps): the step
  across the switch changes 19.9 % of pixels between neighbours of 22.3 and
  17.3 %, a smooth run. Static merged meshes are culled by their world
  boxes (`_lib/cull.js`; three culls by sphere, far too big for a mesh
  spread over the stage), so the shot draws 172 calls.
- **Inside-out geometry.** `Builder.box` took negative sizes as given (a
  size worked out as a difference), turning boxes inside out: the side
  street's brick and the luan flats seen from the catwalk (the "unexplained"
  2.7-3.3 %). Also inside out or unclosed: the people's hands (a mirrored
  frame), the cups (bare tubes), the pie slice's cut faces, rods (seen end
  on), work-bulb cages, the street lamp's globe, the neon tubes' ends
  (`tools/scene-backfaces.mjs` lists the meshes that show their backs from
  an eye). The station check now holds back faces under 0.1 % (was 4 %).
- **Haze NaN** (`_lib/haze.js`): behind thin geometry every tap of the
  depth-aware blur can sit far from the pixel's depth and the weights
  underflow; 0 / 0 made NaN squares (the Box hit it). The pixel keeps its
  own march then. `tests/scenes/haze-blur.test.js` runs the blur on the GPU
  on a twig pixel and fails without the guard.
- **nav.room**: inset from the walls (35-45 cm, past the pilasters, paint
  lines and the near plane), 15 cm over the floor and under the trusses'
  chords. The core clamps the eye to it; the lab does too. Tests: the room
  clears the structure; no station's eye is moved by the clamp over the
  head range and none has a wall just behind its glass; 6000 random poses
  at scales 0.05-1 end inside the room and in front of the glass.
- **The shot**: the diner's people are backlit shapes again (a dark body
  and a thin warm rim from the back bar), lit up close by the scale (smooth
  along a glide; the shot's monitor feed shows them backlit too). The wheel
  covers are turned chrome (a lip, a dished ring, a bead, a domed centre),
  so they pick up the street in bands instead of reading as grey discs.
- **Behind the camera**: the A-camera is a 35 mm film camera: a rounded
  housing, a top magazine with two lobes, rims and hubs, its handle on the
  crown, the gate door and latch, tally lights front and back, a rear
  display and connectors, a battery, camera tape labels, the viewfinder's
  knuckle, focus ring, eyecup and leveller.
- **Inside the diner**: the pendants are shaded (a work light can now carry
  a cone, `_lib/worklight.js`): each throws a pool on the counter and floor
  and scatters a little all round; the domes and the room's fill come down,
  the chrome glints are stronger, and a camera in the room exposes for it
  (exposure down to 0.45 while the eye is in the room or at its far end,
  by the eye's place, smoothly). Frame p10 / p50 at the station: 54 / 170
  before, 25 / 125 now. The back wall over the back bar has its own fill
  (what the shot sees through the windows).
- **The backdrop** is tilted down 9.5 degrees from a little further back:
  the wet deck runs to its edge, the dry gap, and the painted street carries
  on to its vanishing point at the top of the frame.
- **The sidewalk** steps back 0.5 m and down 18 cm, aimed through two
  windows at the man at the counter.
- **The catwalk**: a right lean landed on a dark empty floor. The HMI's
  daylight spill now lights the floor and the bounce's stands there (a cool
  pool and work-light term), with a gaffer by the ballast, apple boxes and
  coiled cable.
- **Backstage**: brick and luan up close get detail in the shader: the
  mortar drawn sharp from the layout the brick map was painted with, each
  brick's colour from its middle, grain on the faces; fine grain along the
  plywood. Both fade out where the map is minified.
- **People**: hands with four jointed fingers and a two-part thumb (they
  were mittens, and inside out); folds shaded into shirts and coat skirts.

**Round 4** (`nav-round-4`, boards as before): 120 frames (8 stations x 15
eyes), no void, no black frame (lowest 90th percentile 13), back faces at
most 0.081 % (the sidewalk leaning right). Lab throughput at 2880 x 1864
(`perf.log`, the sway path): shot 8.45 ms (172 draws; 9.91 before the
round, 8.6 in the review's run), sidewalk 8.34, inside 8.09, camera 8.12,
backdrop 6.36, backstage 6.89, village 6.54, catwalk 8.52.

The shot, same instrument (`tools/scene-rounds.mjs`, centre eye):

| Measure | Target | Before the round | Now |
| --- | --- | --- | --- |
| Frame p10 / p50 | <= 20 / 35-55 | 4.7 / 42.4 | 4.7 / 40.2 |
| Diner interior mean / median | ~150 (nr07 154.5 / 155.8) | 148.7 / 160.5 | 131.3 / 144.5 |
| Street median / 9x9 peak | ~35 / streaks | 41.9 / 197.4 | 41.6 / 197.4 |
| Upper facade | ~20 | 21.9 | 21.9 |
| Flat backs, lean left / right | 90-110 | 109 / 95.8 | 110.9 / 97.3 |

The interior's mean falls with the backlit people: they are dark shapes
against the bright room by design (the back wall over the back bar was
brightened to hold the rest of the room, median 144.5 against nr07's 155.8).

In the app with face tracking on the fake-webcam clip (`face.y4m` from
round 7; the old default clip is gone), pinned at 1.684 (2879 x 1864), each
station reached by a glide, 15 s (`tools/scene-app-perf.mjs --stations all`):
60.0 fps and 0/900 frames over 20 ms at all eight stations; loop JS p99
0.9-3.3 ms.

Still open after this round:

- **People** have fingers and folds now, but their heads are still
  smooth, painted shapes; up close (video village, inside) they read as
  figures, not as people.
- **The sidewalk**'s mullions still take about a quarter of its frame (they
  are the set's own window frames, 60 cm away).
- **The backdrop**'s painted buildings are grids of quads under the
  shader's streaks.
- **Inside** p10 is 25, a little over the review's 15-20; there are still
  no real shadows under the pendants beyond the contact cards.
- **The shot's interior** reads darker on average with the backlit people
  (they cover part of the windows), see the table above.
- **Feeds** have no haze and update 8 times a second each.

### Box navigation, after the review (2026-11-17)

The review scored the stations: room 8, window 5, engawa 6, garden 5, next
room 4, eave 3. It found:
- outdoor stations that pan instead of showing parallax at 3x;
- a pop at the start of every glide;
- a forest that switched on and off at the house's walls;
- far eyes that landed inside walls.

What changed:
- **Subjects and view limits.** Every station names a `subject` and a
  `view`. Outdoors the strength is 1.25-1.5x with no extra vertical; the
  next room is 1.4x and the window 1.75x. `maxEyeZ` comes from the wall
  behind each station: engawa 0.85, next room 0.8.
- **Tour.** Room, next room, window, engawa, eave, garden.
- **Nothing switches during a glide.**
  - The round window shows the real dusk. The painted cards are gone, and
    the hills behind the house are lower and clear of trees.
  - The forest and the grove are always drawn.
  - The dust and the shoji's glare fade continuously with how deep in the
    room the eye is.
- **Sky at any far plane.** The sky and ridges are drawn at any far plane.
  The lab's 60 × scale far plane clipped them to black at scale 0.1.
- **Stations recomposed.**
  - The garden looks back at the house from beyond the maple.
  - The eave is tilted up 25°, with the fūrin against the dusk.
  - A pruned pine is the engawa's near layer.
- **Surfaces.**
  - Shoji fibres and plaster grain.
  - Moss and lichen on stone tops; smooth rocks, shrubs and lantern.
  - The next room's lantern throws a pool with a soft fill.

Checks:
- **Subjects.** They stay in frame at typical moves (CPU test).
- **Station frames.** At typical moves and extremes: void 0, back faces at
  most 0.12 %, and no frame with p90 luma under 8 (the darkest is 46).
- **The room.** Its targets are unchanged.

Frame times:

| Where | Result |
| --- | --- |
| Lab, 2880 × 1864, chip 61 °C, on AC | 4.6–7.9 ms throughput per station |
| Lab, earlier | 4.9–5.9 ms; the forest and grove were not always drawn then |
| Lab, reviewer, hot chip | 8.3–10 ms |
| App with tracking at 1.684 | 60.0 fps, 0 / 1200 frames over 20 ms at every station |

Still open:
- The window station's lattice casing shows stair-steps from the cookie's
  resolution at 10x magnification.
- The haze steps along depth edges up close.
- The forest is cedar cones.
- The next room's drawers and scroll are simple.

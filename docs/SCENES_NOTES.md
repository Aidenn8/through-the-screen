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
- `node tools/scene-app-perf.mjs --video face.y4m [--dpr 1.684]`: the app
  with face tracking on a fake-webcam clip, served on the lab ports; frame
  statistics, tracking rate and every adaptive-resolution step with its reason.
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

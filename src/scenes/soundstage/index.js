// Soundstage: a miniature film set behind the glass. Straight on it is a lit
// night-rain frame (a corner diner); lean and the window reveals the braced
// flats, the lights on stands, the camera on its dolly and the dark stage.

import * as THREE from 'three';
import { FilmPipeline } from '../_lib/pipeline.js';
import { Haze, HazeLight } from '../_lib/haze.js';
import { PlanarMirror, makeWet, addGlints } from '../_lib/reflect.js';
import { SCALE, FLOOR_Y, FACADE_Z, DECK, WALK, WALK_EDGE, DINER, BRICK_WALL, RIG, CAR_AT, DROP, BCAM, toWindow } from './layout.js';
import { createMaterials } from './materials.js';
import { buildSet } from './set.js';
import { buildBackstage } from './backstage.js';
import { Rain } from './rain.js';
import { BoomMic } from './boom.js';
import { addWorkLights } from '../_lib/worklight.js';
import { maskSpots } from '../_lib/lightmask.js';
import { bakeLightmaps } from '../_lib/bake.js';
import { addGrime } from '../_lib/grime.js';
import { warmUp } from '../_lib/warm.js';
import { mat4 } from '../_lib/geo.js';
import { buildCar, CAR } from './car.js';
import { NAV } from './nav.js';
import { interiorMaterials, buildInterior, interiorLights, kitchenLights, backlitFigures } from './interior.js';
import { buildACam, buildFront, crewFolk, ACAM } from './front.js';
import { Feeds, shotPlacer } from './feeds.js';
import { crowd } from './people.js';
import { cStand, sandbag, cable, rollerStand } from './backstage.js';
import { Builder } from '../_lib/geo.js';
import { withNearAtLeast, makeDepthCamera } from '../_lib/depthcam.js';
import { TightCull } from '../_lib/cull.js';

// Dim stage environment for reflections on chrome, glass and tile: a dark
// box with the softbox, the diner's warm glow and the cool backlight.
function stageEnvironment(renderer) {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0.012, 0.012, 0.014);
  const card = (w, h, color, pos, look) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    mesh.position.set(...pos);
    mesh.lookAt(...look);
    s.add(mesh);
  };
  card(1.6, 1.6, new THREE.Color(0.9, 0.95, 1.05).multiplyScalar(2.2), [4, 1.5, -1], [0, 0, 0]);
  card(4, 1.2, new THREE.Color(1.0, 0.7, 0.42).multiplyScalar(0.9), [0, 0.6, -3], [0, 0, 0]);
  card(1.2, 1.2, new THREE.Color(0.7, 0.82, 1.0).multiplyScalar(3), [-2, 3, -5], [0, 0, 0]);
  card(2, 0.5, new THREE.Color(1.0, 0.2, 0.45).multiplyScalar(0.8), [0, 1.8, -3], [0, 0, 0]);
  card(10, 10, new THREE.Color(0.03, 0.03, 0.035), [0, -2, 0], [0, 0, 0]);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.02);
  pm.dispose();
  // the capture scene is thrown away: free its cards too
  s.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  return rt;
}

function spot(root, { color, intensity, pos, target, angle, penumbra, shadow = 0, radius = 4, bias = -0.0004 }) {
  const l = new THREE.SpotLight(new THREE.Color(...color), intensity, 0, angle, penumbra, 2);
  l.position.set(...pos);
  l.target.position.set(...target);
  root.add(l, l.target);
  if (shadow) {
    l.castShadow = true;
    l.shadow.mapSize.set(shadow, shadow);
    l.shadow.camera.near = 0.02;
    l.shadow.camera.far = 3;
    l.shadow.radius = radius;
    l.shadow.blurSamples = 16;
    l.shadow.bias = bias;
    l.shadow.normalBias = 0.002;
  }
  return l;
}

export default {
  id: 'soundstage',
  title: 'Soundstage',
  order: 1, // the first scene a new viewer sees
  // stations, bounds, scale and tour for moving the window (nav.js)
  nav: NAV,
  async create(ctx) {
    const { renderer, quality } = ctx;
    const high = quality !== 'low';
    let size = { ...ctx.size };

    const prevShadow = { enabled: renderer.shadowMap.enabled, type: renderer.shadowMap.type, auto: renderer.shadowMap.autoUpdate };
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;
    renderer.shadowMap.autoUpdate = false;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0, 0, 0);
    const root = new THREE.Group();
    root.position.set(0, FLOOR_Y, FACADE_Z);
    root.scale.setScalar(SCALE);
    scene.add(root);

    // Reflections of the stage on metal, glass and tile only: a scene-wide
    // environment costs ~7 ms per frame at this resolution.
    const env = stageEnvironment(renderer);
    const m = createMaterials(env.texture);
    interiorMaterials(m, renderer);
    // the grade, shared by the frame and the monitors' feeds
    const grade = {
      exposure: 1.0,
      bloom: 0.05,
      bloomTint: new THREE.Color(1.0, 0.92, 0.88),
      // night grade: blacks lean teal (barely lifted), highlights stay warm
      lift: new THREE.Vector3(0.0, 0.0015, 0.004),
      gamma: new THREE.Vector3(0.98, 1.0, 1.04),
      gain: new THREE.Vector3(1.0, 0.97, 0.92),
      saturation: 1.08,
      contrast: 1.05,
    };
    // live pictures for the monitors (feeds.js): the shot itself, and the B camera
    const feeds = new Feeds(renderer, { settings: grade });
    feeds.add('shot', { w: 512, h: 322, place: (cam) => shotPlacer(size)(cam) });
    feeds.add('bcam', { w: 448, h: 280, place: (cam) => {
      cam.fov = 26;
      cam.aspect = 448 / 280;
      cam.near = 0.002;
      cam.far = 40;
      // just in front of the B-camera's matte box, looking where it looks
      const lens = new THREE.Vector3(BCAM.x, BCAM.floor + BCAM.lens, BCAM.z);
      const aim = new THREE.Vector3(...BCAM.aim);
      const pos = lens.clone().add(aim.clone().sub(lens).normalize().multiplyScalar(0.7));
      cam.position.set(...toWindow(pos.x, pos.y, pos.z));
      cam.updateProjectionMatrix();
      cam.lookAt(...toWindow(...BCAM.aim));
      cam.updateMatrixWorld(true);
    } });
    m.monitorA = feeds.material('shot');
    m.monitorB = feeds.material('bcam');
    const set = buildSet(root, m);
    const inside = buildInterior(root, m);
    const back = buildBackstage(root, m);
    // the camera end of the stage (front.js): shown only when the window is
    // away from the shot (from there, the viewer is the camera)
    const frontGroup = new THREE.Group();
    frontGroup.name = 'front';
    const FB = new Builder();
    const front = buildFront(FB, m, { cStand, sandbag, cable, rollerStand });
    FB.build(frontGroup);
    const acam = buildACam(m);
    const acamScreen = new THREE.Mesh(new THREE.PlaneGeometry(...acam.screenSize), feeds.material('shot', { gain: 1.6 }));
    acamScreen.name = 'monitorA';
    acamScreen.matrixAutoUpdate = false;
    acamScreen.matrix.copy(acam.screen);
    acam.group.add(acamScreen);
    const acamCrew = new THREE.Mesh(crowd(crewFolk()), m.crew_people);
    acamCrew.name = 'crewPeople';
    acam.group.add(acamCrew);
    frontGroup.add(acam.group);
    frontGroup.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    root.add(frontGroup);
    m.acamScreen = acamScreen.material;
    // video village's people (crew.js says where)
    const village = new THREE.Mesh(crowd(back.villageFolk), m.crew_people);
    village.name = 'crewPeople';
    village.matrixAutoUpdate = false;
    root.add(village);
    root.updateMatrixWorld(true);
    for (const o of [acamScreen]) feeds.watch(o);
    root.traverse((o) => { if (o.isMesh && (o.name === 'monitorA' || o.name === 'monitorB') && o !== acamScreen) feeds.watch(o); });
    // the parked sedan, front toward the corner, at the curb (real x 0.4-5.6)
    const carT = mat4([CAR_AT.x1, DECK, CAR_AT.z], [0, Math.PI, 0]);
    const carMeshes = buildCar(m, carT).build(root);

    // ---------------- lights (real-metre positions inside the root)
    const S = high ? 1024 : 512;
    // Night key (refs nr01, nr04, nr06, nr07): the diner interior is the
    // brightest large area; the street sits near black and carries the
    // reflections; the moon HMI is a narrow backlight down the side street,
    // so rain and haze glow only inside its cone and the cone's edge reads.
    const moon = spot(root, { color: [0.62, 0.78, 1.0], intensity: 7.0, pos: back.moonPos, target: back.moonTarget, angle: 0.2, penumbra: 0.35, shadow: S, radius: 3 });
    // The diner's window light: a source inside the room, cut by the window
    // frames and blinds into hard-edged pools on the sidewalk.
    const diner = spot(root, { color: [1.0, 0.64, 0.33], intensity: 0.55, pos: [1.2, 2.7, -2.4], target: [1.2, 0.25, 1.4], angle: 0.8, penumbra: 0.25, shadow: S, radius: 1.5 });
    const lamp = spot(root, { color: [1.0, 0.52, 0.18], intensity: 0.85, pos: [set.lampPos[0], set.lampPos[1] - 0.12, set.lampPos[2]], target: [set.lampPos[0], 0, set.lampPos[2] + 0.3], angle: 0.95, penumbra: 0.8, shadow: high ? 512 : 256, radius: 3 });
    const key = spot(root, { color: [0.72, 0.82, 1.0], intensity: 0.12, pos: back.softboxPos, target: back.softboxTarget, angle: 0.62, penumbra: 1.0, shadow: S, radius: 14 });
    // Four shadowed spots and one ambient term: every extra light costs about
    // 1.2 ms at 2880 x 1810. Neon, bulbs and the diner interior glow through
    // emissive surfaces and glow cards instead of point lights.
    const hemi = new THREE.HemisphereLight(new THREE.Color(0.16, 0.19, 0.26), new THREE.Color(0.06, 0.055, 0.05), 0.12);
    root.add(hemi);
    root.updateMatrixWorld(true);

    // ---------------- work lights on the stage around the set (cheap, per material)
    // Bulb powers (colour x intensity, world units): the two low bulbs make
    // tungsten pools on the flat backs; the cool one is a fluorescent strip on
    // the back wall; two more sit up in the grid.
    const workPower = [0.03, 0.014, 0.03, 0.02, 0.004, 0.004, 0.013];
    const work = back.workBulbs.map(([x, y, z], i) => ({
      position: root.localToWorld(new THREE.Vector3(x, y, z)),
      color: new THREE.Color(i === 2 ? 0xb8c4d0 : 0xffc890).multiplyScalar(workPower[i]),
    }));
    work.push({ position: root.localToWorld(new THREE.Vector3(10.2, 1.92, -8.0)), color: new THREE.Color(0xffc890).multiplyScalar(0.0025) });
    // the crew area: over the chairs, the clamp light on craft services, over the stage door
    // the translight's glow on the floor and gear in front of it
    work.push({ position: root.localToWorld(new THREE.Vector3(...back.dropGlow)), color: new THREE.Color(0xffb878).multiplyScalar(0.008) });
    for (const [x, y, z, p] of [...back.crewBulbs, ...front.workBulbs, ...inside.workBulbs]) work.push({ position: root.localToWorld(new THREE.Vector3(x, y, z)), color: new THREE.Color(0xffc890).multiplyScalar(p) });
    for (const [x, y, z, p] of front.spill) work.push({ position: root.localToWorld(new THREE.Vector3(x, y, z)), color: new THREE.Color(0xc8d8ff).multiplyScalar(p) });
    addWorkLights([m.pine, m.luan, m.sandbag, m.stageFloor, m.stageWall, m.blackPaint, m.darkMetal, m.rubber, m.cableBlack,
      m.cableOrange, m.wood, m.flatEdge, m.deckEdge, m.diffusionBack, m.blackCloth, m.cameraBody, m.gripSilver, m.track, m.rainBars,
      m.gridPipe, m.drape, m.cinder, m.softboxBody, m.spaceLight, m.signs, m.chairCanvas, m.canvasSeat, m.appleBox, m.cloth, m.fruit, m.doorSteel, m.hoseRed, m.pumpRed,
      m.camBlack, m.camBody, m.camRubber, m.camMetal, m.camWhite, m.camRed, m.dollySilver, m.dollyDeck, m.dollySeat, m.dollyBlack, m.caseOrange, m.bounceBack, m.crew_people, m.bkBrick], work);
    // the diner's practicals on its own surfaces (interior.js): pendants over
    // the counter, domes over the booths, the pie case, the kitchen
    const WORK_K = 0.0057; // power 1 = ~1.2 at 1.1 m (real) from the bulb
    const toWork = (L, k = WORK_K) => L.map(({ pos, color, power, dir, cone }) => ({
      position: root.localToWorld(new THREE.Vector3(...pos)),
      color: new THREE.Color(color).multiplyScalar(power * k),
      ...(dir ? { dir: new THREE.Vector3(...dir), cone } : {}),
    }));
    const inMats = Object.entries(m).filter(([k, v]) => v?.isMaterial && /^in_/.test(k) && !v.isMeshBasicMaterial && k !== 'in_glass').map(([, v]) => v);
    addWorkLights([...inMats, m.wallIn, m.checker, m.blinds], toWork(interiorLights(), WORK_K * 1.3));
    addWorkLights([m.k_tile, m.k_floor, m.k_steel, m.k_griddle], toWork(kitchenLights()));
    // the diner's people: lit up close, backlit shapes from the shot
    const backlit = backlitFigures(m.in_people);
    // the roof steel and the catwalks only see the bulbs up there
    const upper = [...back.catBulbs, ...back.trussBulbs].map(([x, y, z], i) => ({
      position: root.localToWorld(new THREE.Vector3(x, y, z)),
      color: new THREE.Color(0xffc890).multiplyScalar(i < back.catBulbs.length ? 0.012 : 0.022),
    }));
    addWorkLights([m.roof, m.truss, m.motor, m.chain], upper);
    // the catwalks' grating also sees their own caged lights (one list: the
    // work-light hook may only be added once per material)
    addWorkLights([m.catwalk], [...upper, ...back.railBulbs.map(([x, y, z]) => ({ position: root.localToWorld(new THREE.Vector3(x, y, z)), color: new THREE.Color(0xffc890).multiplyScalar(0.02) }))]);

    // ---------------- light masks: each surface only evaluates the spots that can reach it
    // bits: 1 moon, 2 diner window light, 4 street lamp, 8 softbox key
    const MASKS = {
      15: ['asphalt', 'sidewalk', 'curb', 'tape', 'tapeRed', 'roadPaint', 'manhole', 'hydrant', 'newsBox', 'newsPaper', 'newsLabel', 'track'],
      4: ['upperWall', 'shade'],
      13: ['castIron', 'wood', 'darkMetal'],
      12: ['stucco', 'tile', 'chrome', 'aluminum', 'signBand', 'redEnamel', 'glass', 'deckEdge', 'stageFloor'],
      5: ['brick', 'brick2'],
      // the interior is lit by its own practicals (self-illumination): no spots
      0: ['wallIn', 'checker', 'counter', 'counterTop', 'vinyl', 'tileIn', 'chromeIn', 'blinds', 'figure',
        ...Object.keys(m).filter((k) => /^(in|k)_/.test(k) && m[k]?.isMaterial && !m[k].isMeshBasicMaterial),
        'camBlack', 'camBody', 'camRubber', 'camMetal', 'camWhite', 'camRed', 'dollySilver', 'dollyDeck', 'dollySeat', 'dollyBlack', 'caseOrange', 'bounceBack', 'crew_people', 'bkBrick',
        // the stage beyond the set: work light only
        'gridPipe', 'drape', 'cinder', 'softboxBody', 'spaceLight', 'roof', 'truss', 'catwalk', 'motor', 'chain', 'bulbOff',
        'signs', 'chairCanvas', 'canvasSeat', 'appleBox', 'cloth', 'fruit', 'doorSteel', 'hoseRed', 'pumpRed'],
      9: ['rainBars'],
      14: ['carBody', 'carGlass', 'carChrome', 'carTyre', 'carLamp', 'carTail', 'carWhitewall'],
      8: ['pine', 'luan', 'sandbag', 'stageWall', 'blackPaint', 'rubber', 'cableBlack', 'cableOrange', 'flatEdge', 'diffusionBack', 'blackCloth', 'cameraBody', 'gripSilver'],
    };
    for (const [mask, names] of Object.entries(MASKS)) for (const n of names) if (m[n]) maskSpots(m[n], Number(mask));

    // ---------------- wet ground with mirrored reflections
    const mirror = new PlanarMirror({ planeY: FLOOR_Y + DECK * SCALE, scale: high ? 0.35 : 0.25 });
    const time = { value: 0 };
    // Bright sources as seen by the wet ground: power = emitted radiance x
    // projected area (world units), so streak brightness follows the sources.
    const S2 = SCALE * SCALE;
    const em = (x, y, z, r, color, power) => ({
      position: root.localToWorld(new THREE.Vector3(x, y, z)),
      radius: r * SCALE,
      color: new THREE.Color(color).multiplyScalar(power),
    });
    // Real sources only, at their real sizes: each makes one streak. Power =
    // radiance x projected area of the source.
    const neonTube = 2 * 0.016; // tube diameter
    const emitters = [
      em(set.lampPos[0], set.lampPos[1] + 0.05, set.lampPos[2], 0.2, 0xffb46a, 16 * Math.PI * 0.2 * 0.2 * S2),
      em(back.moonPos[0], back.moonPos[1], back.moonPos[2], 0.36, 0xdfe8ff, 40 * Math.PI * 0.36 * 0.36 * S2),
      // EATS: a vertical blade sign, two sources along its height
      ...[3.0, 4.0].map((y) => em(set.neonCentres.eats[0], y, -0.1, 0.14, 0x3af0ff, 24 * neonTube * 2.4 * S2)),
      // DINER: one source per letter (tube length ~2 m per letter)
      ...set.neonLetters.map(([x, y, z]) => em(x, y, z, 0.14, 0xff2a6a, 40 * neonTube * 1.9 * S2)),
      // the lit windows, behind the blinds (radiance ~1.5, ~1.3 x 0.9 m showing)
      ...[-0.8, 0.62, 2.04, 4.6].map((x) => em(x, 1.75, -0.2, 0.26, 0xffc27a, 0.5 * 1.2 * S2)),
    ];
    // the car hides the streaks behind it (a vertical rectangle through its middle)
    const occA = root.localToWorld(new THREE.Vector3(CAR_AT.x1 - CAR.length + 0.2, DECK + 1.0, CAR_AT.z));
    const occB = root.localToWorld(new THREE.Vector3(CAR_AT.x1 - 0.2, 0, CAR_AT.z));
    const occluder = [occA.x, occB.x, occA.z, occA.y];
    makeWet(m.asphalt, mirror, { occluder, wetMap: m.textures.asphaltT.wetMap, wetness: 1.0, puddleRough: 0.04, wetRough: 0.22, time, ripples: high, emitters, emitGain: 1.1, streakAcross: [0.03, 0.018], streakAlong: [0.2, 0.12], sparkle: 0.3, sparkleFreq: 1600, sparkleAcross: 0.15, sparkleStretch: 0.3, lobeNormalMix: 0.35, reflectGain: 0.55, wetDarken: 0.2 });
    makeWet(m.sidewalk, mirror, { occluder, wetness: 0.45, puddleRough: 0.2, wetRough: 0.4, time, ripples: false, emitters, emitGain: 0.6, streakAcross: [0.06, 0.04], streakAlong: [0.5, 0.4], sparkle: 0.14, sparkleFreq: 1600, sparkleAcross: 0.3, reflectGain: 0.5 });
    // the car's wet paint, glass and chrome mirror the same sources: crisp neon and
    // window glints that move with the eye (the cube capture carries the rest)
    // a wet clear coat and glass are near mirrors: lobes this tight keep each
    // letter a small hard highlight; wider ones (0.06 / 0.03) spread into
    // pink slabs over the roof and glass in the views from above
    addGlints(m.carBody, emitters, { gain: 1.0, rough: 0.018 });
    addGlints(m.carGlass, emitters, { gain: 1.0, rough: 0.01 });
    addGlints(m.carChrome, emitters, { gain: 0.8, rough: 0.12 });
    // the diner's lights in its waxed floor, counter tops, chrome and steel
    const inEmit = [
      ...inside.pendants.map(([x, y, z]) => em(x, y, z, 0.12, 0xffd6a0, 14 * Math.PI * 0.12 * 0.12 * S2)),
      ...inside.domes.map(([x, y, z]) => em(x, y - 0.06, z, 0.17, 0xffe0b0, 5 * Math.PI * 0.17 * 0.17 * S2)),
    ];
    addGlints(m.checker, inEmit, { gain: 0.5, rough: 0.2 });
    addGlints(m.in_formica, inEmit, { gain: 0.5, rough: 0.16 });
    addGlints(m.in_vinyl, inEmit, { gain: 0.35, rough: 0.3 });
    addGlints(m.in_chrome, inEmit, { gain: 0.4, rough: 0.05 });
    addGlints(m.in_steel, inEmit, { gain: 0.25, rough: 0.16 });
    // makeWet replaced the mask's shader hook: chain the mask again on top
    maskSpots(m.asphalt, 15);
    maskSpots(m.sidewalk, 15);
    for (const mesh of root.children) {
      if (['asphalt', 'sidewalk', 'stageFloor', 'stripe', 'roadPaint'].includes(mesh.name)) mesh.userData.noReflect = true;
    }

    // ---------------- bake the static diffuse light into lightmaps
    // (set metres per texel; finer where shadows are crisp and seen close).
    // Specular stays live: wet streaks, chrome, glass, the car, the lamp post.
    // grime at the foot of every street-facing wall (set metres: 45 cm band)
    const groundY = FLOOR_Y + WALK * SCALE;
    for (const k of ['stucco', 'tile', 'brick', 'brick2']) addGrime(m[k], { y0: groundY, height: 0.45 * SCALE, k: k === 'tile' ? 0.3 : 0.4, freq: 1 / (0.35 * SCALE) });
    const BAKE = {
      asphalt: 0.025, sidewalk: 0.014, curb: 0.03, tape: 0.03, manhole: 0.03,
      stucco: 0.015, signBand: 0.02, tile: 0.015, upperWall: 0.02, brick: 0.025, brick2: 0.035, deckEdge: 0.06,
      flatEdge: 0.03, luan: 0.03, pine: 0.03, stageFloor: 0.08, stageWall: 0.15, blackPaint: 0.05,
      sandbag: 0.04, cinder: 0.03, wood: 0.03, darkMetal: 0.05, cameraBody: 0.04, diffusionBack: 0.05, newsPaper: 0.01, newsLabel: 0.01,
    };
    const bakeTexel = new Map(Object.entries(BAKE).map(([k, v]) => [m[k], v]));
    const bakeMeshes = [];
    root.traverse((o) => { if (o.isMesh && bakeTexel.has(o.material)) bakeMeshes.push(o); });
    // Off by default: A/B runs showed no frame-time gain (lit-surface shading is
    // not the bottleneck once the spot masks are in) for 64 MiB of pages and a
    // 32 MiB transient target. The lab can turn it on with ?bake=1.
    const baked = high && ctx.flags?.bake === '1' ? bakeLightmaps(renderer, scene, bakeMeshes, { texel: (mesh) => bakeTexel.get(mesh.material), pageSize: 2048 }) : null;
    // Only the light sources are mirrored (a dozen draws, no shading): the
    // reflection pass is the costliest thing per pixel of wet ground to keep
    // re-rendering, and what reads in puddles is the lights.
    // (the diner's own lamps and the camera end's are not seen in the street)
    for (const mesh of [...inside.meshes, ...frontGroup.children]) mesh.traverse((o) => { if (o.isMesh && (/^(in_|k_)/.test(o.name) || frontGroup.children.includes(o) || o.parent !== root)) o.userData.noReflect = true; });
    mirror.add(root, { emissiveOnly: true });
    for (const mesh of carMeshes) mirror.add(mesh, { silhouette: true });

    // The car's paint, chrome and glass reflect the set itself: one cube
    // capture from just above its roof (lights and shadows live), prefiltered.
    {
      const cubeRT = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType });
      const cubeCam = new THREE.CubeCamera(0.002, 40, cubeRT);
      cubeCam.position.copy(root.localToWorld(new THREE.Vector3(CAR_AT.x1 - 2.6, DECK + 1.75, CAR_AT.z)));
      for (const mesh of carMeshes) mesh.visible = false;
      renderer.shadowMap.needsUpdate = true;
      cubeCam.update(renderer, scene);
      for (const mesh of carMeshes) mesh.visible = true;
      const pm = new THREE.PMREMGenerator(renderer);
      const carEnv = pm.fromCubemap(cubeRT.texture);
      pm.dispose();
      cubeRT.dispose();
      for (const k of ['carBody', 'carGlass', 'carChrome', 'carLamp', 'carTail']) {
        m[k].envMap = carEnv.texture;
        m[k].needsUpdate = true;
      }
      m.carEnvTarget = carEnv;
    }

    // ---------------- haze (baked light-space depth maps, marched per frame)
    const hazeLights = [
      // haze strength per light is set like a DP sets haze: enough to read the beam, never a veil
      HazeLight.fromSpot(moon, { anisotropy: 0.6, intensity: moon.intensity * 0.22, shadowSize: high ? 768 : 384 }),
      HazeLight.fromSpot(diner, { anisotropy: 0.2, intensity: diner.intensity * 0.12, shadowSize: high ? 768 : 384 }),
      HazeLight.fromSpot(lamp, { anisotropy: 0.3, intensity: lamp.intensity * 0.5, shadow: false }),
    ];
    const keyForRain = HazeLight.fromSpot(key, { shadow: false });
    const toW = (x, z) => [x * SCALE, z * SCALE + FACADE_Z];
    const haze = new Haze({
      density: 0.13,
      // spray haze lives over the rain rig only: the stage around the set is dry and clear
      footprint: { rect: [...toW(RIG.x0 - 0.2, -11), ...toW(5.6, 5.4)], soft: 0.6 * SCALE },
      ambient: new THREE.Color(0.004, 0.0055, 0.008),
      lights: hazeLights,
      // a sixth of the resolution and 18 steps: haze is soft, and at 3420 x 2214
      // the quarter-res, 28-step version cost ~4 ms a frame
      scale: high ? 8 : 10,
      steps: high ? 16 : 10,
      maxDist: 3,
      floorY: FLOOR_Y,
      heightFalloff: 1.2,
      shadows: high,
      // the diner interior is barely hazed (it would glow milky through the glass)
      clearBox: {
        min: [DINER.x0 * SCALE, FLOOR_Y, (DINER.back - 1.3) * SCALE + FACADE_Z],
        max: [5.4 * SCALE, FLOOR_Y + 3.5 * SCALE, FACADE_Z],
        k: 0.12,
      },
    });
    haze.bake(renderer, scene);

    // ---------------- rain (added after the bake: it must not occlude light)
    const worldOf = (l) => new THREE.Vector3().setFromMatrixPosition(l.matrixWorld);
    const dirOf = (l) => new THREE.Vector3().setFromMatrixPosition(l.target.matrixWorld).sub(worldOf(l)).normalize();
    const rainLight = (l, k, hl) => ({
      position: worldOf(l),
      direction: dirOf(l),
      color: new THREE.Vector3(l.color.r, l.color.g, l.color.b).multiplyScalar(l.intensity * k),
      cone: [Math.cos(l.angle), Math.cos(l.angle * (1 - l.penumbra))],
      map: high && hl.map ? hl.map.texture : null,
      matrix: hl.matrix,
    });
    // The translight at the street's end backlights the rain in front of it
    // (no shadow map: nothing stands between them)
    const dropForRain = {
      position: root.localToWorld(new THREE.Vector3(DROP.x, DROP.y0 + 3.0, 1.0)),
      direction: new THREE.Vector3(1, -0.1, 0.15).normalize(),
      color: new THREE.Vector3(1.0, 0.72, 0.45).multiplyScalar(0.22),
      cone: [Math.cos(0.95), Math.cos(0.45)],
      map: null,
      matrix: new THREE.Matrix4(),
    };
    // Rain falls only inside the rig's footprint (the bars over the street and
    // the side street): the backstage stays dry.
    const rain = new Rain({
      volumes: [
        // (the same density as before the rig was lengthened: 3600 over 10.6 m)
        { x0: RIG.x0, x1: RIG.x1, z0: -0.6, z1: RIG.z1, count: Math.round(((high ? 3600 : 1800) * (RIG.x1 - RIG.x0)) / 10.6) },
        { x0: -5.1, x1: -1.7, z0: -10.5, z1: -0.6, count: high ? 1800 : 900 },
      ],
      top: RIG.y - 0.15,
      // splashes on the ground: sidewalk height in front of the diner and along
      // the side street's walls, street deck elsewhere
      splashes: {
        count: high ? 1400 : 600,
        ground: (x, z) => ((z > 0 && z < WALK_EDGE && x > DINER.x0 - 1.4) || (z <= 0 && x > DINER.x0 - 1.4 && x < DINER.x0) || (z < BRICK_WALL.z0 && x < BRICK_WALL.x + 0.9) ? WALK : DECK),
      },
      scale: SCALE,
      lights: [rainLight(moon, 1.6, hazeLights[0]), rainLight(lamp, 0.6, hazeLights[2]), rainLight(diner, 0.45, hazeLights[1]), rainLight(key, 0.05, keyForRain), dropForRain],
      width: 0.003,
      ambient: new THREE.Color(0, 0, 0),
    });
    root.add(rain.mesh);

    // ---------------- boom mic, in front of the glass
    // windscreen at window (-2.0, 5.5, +1.75) cm: in front of the glass, inside
    // the frame from every eye the view limits allow (tests/scenes)
    const boom = new BoomMic(m, { quality, mic: [-0.32, 2.88, 6.68], pivot: [0.96, 6.8, 2.56] });
    root.add(boom.group);

    renderer.shadowMap.needsUpdate = true;

    const pipe = new FilmPipeline(renderer, {
      quality,
      haze,
      settings: grade,
    });

    const buf = new THREE.Vector2();
    const prepare = (r, camera) => {
      const t = r.getRenderTarget();
      if (t) buf.set(t.width, t.height);
      else r.getDrawingBufferSize(buf);
      mirror.render(r, camera, buf);
    };

    const features = { mirror: true };
    const mirrorSize = new THREE.Vector2();
    // At small rig scales the near plane comes 16x closer (life size): keep
    // it at least 5 cm (real) out so the depth buffer stays fine enough for
    // the decals seen from across the stage (_lib/depthcam.js).
    const NEAR_MIN = 0.05 * SCALE;
    const depthCam = makeDepthCamera();
    // the monitors' feeds draw the scene themselves (hidden: what the shot
    // cannot see: the camera end of the stage); the shot's feed shows the
    // diner's people as the shot does, backlit
    let litBefore = 0;
    const around = (feed, before) => {
      if (feed.id !== 'shot') return;
      if (before) { litBefore = backlit.value; backlit.value = 1; } else backlit.value = litBefore;
    };
    Object.assign(feeds.o, { scene, mirror, rain, hide: [frontGroup], around });
    let cull = null;
    const renderFrame = (r, cam, opts = {}) => {
      const camera = withNearAtLeast(cam, NEAR_MIN, depthCam);
      const P = r.__prof;
      cull?.reset();
      P?.begin('feeds');
      const fed = !opts.check && feeds.update(camera, time.value);
      P?.end(fed ? feeds.feeds[0].target : undefined);
      cull?.apply(camera);
      const pt = pipe.ensure();
      P?.begin('mirror');
      if (features.mirror) mirror.render(r, camera, mirrorSize.set(pt.w, pt.h));
      P?.end(features.mirror ? mirror.target : undefined);
      pipe.render(scene, camera, { bloom: !opts.check });
    };
    await warmUp(renderer, [scene, mirror.scene], (cam) => renderFrame(renderer, cam), size);
    feeds.update(depthCam, 0, { force: true });
    // the stage's merged meshes (all static) culled by their boxes: the
    // camera end behind the shot's eye, the set's far side from the catwalk
    root.updateMatrixWorld(true);
    const still = root.children.filter((o) => o.isMesh && o !== rain.mesh);
    frontGroup.traverse((o) => { if (o.isMesh) still.push(o); });
    cull = new TightCull(still);
    // the A-camera hides while the viewer's eye is inside it (gliding through)
    const ROOM_EXPOSURE_DROP = 0.55;
    const inv = new THREE.Matrix4();
    const eyeReal = new THREE.Vector3();
    const acamBox = new THREE.Box3(root.localToWorld(new THREE.Vector3(...front.acamBox.min)), root.localToWorld(new THREE.Vector3(...front.acamBox.max)));
    return {
      scene,
      pipeline: pipe,
      debug: { nearMin: NEAR_MIN, rain, boom, mirror, haze, features, feeds, frontGroup, get cull() { return cull; }, baked: baked?.stats ?? null, realToWorld: root.matrixWorld.clone() },
      update(dt, t, eye, view) {
        time.value = t;
        renderer.getDrawingBufferSize(buf);
        // a pixel's angle is the window's height over the eye's distance from
        // the glass, both in window metres: the rig's scale cancels
        rain.update(t, eye.z, size.height, buf.y);
        boom.update(t);
        // The camera end of the stage stands where the shot's viewer is: at
        // the shot the viewer is the camera, and from its leaning eyes the
        // gear would stand between the eye and the glass. It shows once the
        // window leaves the shot (scale under 0.6; along a glide out of the
        // shot nothing of it is in view at that point), never with the eye
        // inside the A-camera. The diner's small props are always drawn (they
        // are in view through the windows: switching them was a pop).
        // The diner's end wall is a wild wall: as the eye comes up behind it
        // (from the stage side, inside the room's length) it flies out into
        // the grid, so the room can be seen from its open end.
        if (view) {
          inv.copy(root.matrixWorld).invert();
          const e = eyeReal.copy(view.eyeWorld).applyMatrix4(inv);
          const along = THREE.MathUtils.smoothstep(e.z, DINER.back + 0.1, DINER.back + 0.8) * (1 - THREE.MathUtils.smoothstep(e.z, -0.8, -0.1));
          const lift = along * (1 - THREE.MathUtils.smoothstep(e.x, 7.6, 9.5)) * (1 - THREE.MathUtils.smoothstep(e.y, 3.6, 4.6));
          inside.wild.position.y = 4.6 * lift;
          inside.wild.updateMatrixWorld(true);
          // and in the room (or at its open end) the camera exposes for the
          // room, as a camera brought inside would: the bright interior the
          // street sees comes down to mid-tones, the pools under the
          // pendants keep their highlights (by the eye's place: smooth)
          const inRoom = lift * THREE.MathUtils.smoothstep(e.x, DINER.x0 - 0.3, DINER.x0 + 0.3);
          pipe.settings.exposure = 1 - ROOM_EXPOSURE_DROP * inRoom;
        } else pipe.settings.exposure = 1;
        // the people in the diner go to backlit shapes as the window comes
        // back out to the shot (by the rig's scale: smooth along a glide)
        backlit.value = view ? THREE.MathUtils.smoothstep(view.rig.scale, 0.3, 0.85) : 1;
        const away = !!view && view.rig.scale < 0.6;
        frontGroup.visible = away;
        acam.group.visible = away && !acamBox.containsPoint(view.eyeWorld);
      },
      resize(s) { size = { ...s }; },
      prepare,
      render: renderFrame,
      dispose() {
        feeds.dispose();
        pipe.dispose();
        haze.dispose();
        mirror.dispose();
        env.dispose();
        m.carEnvTarget?.dispose();
        m.dinerEnv?.dispose();
        for (const p of baked?.pages ?? []) p.dispose();
        rain.dispose();
        scene.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          // lights own their shadow maps (VSM: two targets each)
          if (o.isLight) o.dispose?.();
        });
        boom.dispose();
        // materials and the maps only they hold (softbox face, upper wall, glow cards...)
        for (const v of Object.values(m)) {
          if (!v || !v.isMaterial) continue;
          for (const k of ['map', 'emissiveMap', 'normalMap', 'alphaMap']) v[k]?.dispose?.();
          v.dispose();
        }
        for (const t of Object.values(m.textures)) {
          if (t.isTexture) t.dispose();
          else for (const x of Object.values(t)) x.dispose?.();
        }
        renderer.shadowMap.enabled = prevShadow.enabled;
        renderer.shadowMap.type = prevShadow.type;
        renderer.shadowMap.autoUpdate = prevShadow.auto;
      },
    };
  },
};

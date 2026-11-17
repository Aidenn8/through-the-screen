// Materials for the soundstage. Colours are chosen as the real paints and
// finishes would be; the lighting and grade do the rest.

import * as THREE from 'three';
import * as T from './textures.js';
import { CHAIR_LABELS, SIGN_LABELS } from './crew.js';

const std = (o) => new THREE.MeshStandardMaterial(o);
// Matte surfaces don't need a specular lobe: Lambert is far cheaper per light
// at 2880 x 1810, and most of the set is matte.
const lam = (o) => new THREE.MeshLambertMaterial(o);

// Soft radial falloff for glow cards (light spill faked on nearby surfaces).
let radial = null;
function radialTexture() {
  if (radial) return radial;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const img = g.createImageData(128, 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const dx = (x + 0.5) / 64 - 1;
    const dy = (y + 0.5) / 64 - 1;
    const r2 = dx * dx + dy * dy;
    const v = Math.max(0, Math.exp(-r2 * 3.2) - Math.exp(-3.2)) / (1 - Math.exp(-3.2));
    const i = (y * 128 + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(255 * Math.pow(v, 1 / 2.2));
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  radial = new THREE.CanvasTexture(c);
  radial.colorSpace = THREE.SRGBColorSpace;
  return radial;
}
export function glowCardMaterial(color, intensity) {
  return new THREE.MeshBasicMaterial({
    map: radialTexture(),
    color: new THREE.Color(color).multiplyScalar(intensity),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}
// Softbox face: hot centre falling off to the edges, with the dark seams of
// the speed-ring frame showing through the diffusion.
function softboxTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const img = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const u = (x + 0.5) / 128 - 1;
    const v = (y + 0.5) / 128 - 1;
    const r = Math.max(Math.abs(u), Math.abs(v)) * 0.6 + Math.hypot(u, v) * 0.4;
    // centre ~1, edges ~0.45: a lit diffusion is brightest where it faces the head
    let k = 0.28 + 0.72 * Math.exp(-r * r * 2.2);
    // the diffusion sits recessed behind the black lip: its outer band falls off
    const edge = Math.pow(Math.min(1, (1 - Math.max(Math.abs(u), Math.abs(v))) * 7), 0.7);
    const seam = Math.min(Math.abs(u - v), Math.abs(u + v)) < 0.012 ? 0.85 : 1;
    k *= edge * seam;
    const i = (y * 256 + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(255 * Math.pow(k, 1 / 2.2));
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Interior surfaces lit by the diner's practicals: albedo glows warm.
function interior(o, k = 0.5, tint = 0xffc890) {
  const m = new THREE.MeshLambertMaterial(o);
  m.emissive = new THREE.Color(tint).multiplyScalar(k);
  if (o.map) m.emissiveMap = o.map;
  else m.emissive.multiply(new THREE.Color(o.color ?? 0xffffff));
  return m;
}

// Detail for textures seen at life size (a 512 px brick or plywood tile is
// magnified ten times or more there): the brick's mortar drawn sharp from the
// layout the texture was painted with, each brick's colour taken from its
// middle (the map's own edges are blurred into the mortar), grain on the
// faces; plywood gets fine grain along the sheet. Fades out where the map is
// minified (from the shot it is the map as it was).
const DETAIL_GLSL = /* glsl */ `
  float dtH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float dtN(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(dtH(i), dtH(i + vec2(1.0, 0.0)), f.x), mix(dtH(i + vec2(0.0, 1.0)), dtH(i + vec2(1.0, 1.0)), f.x), f.y);
  }
`;
export function addDetail(material, kind, { cols = 8, rows = 24, size = 512, parity = 1 } = {}) {
  const prev = material.onBeforeCompile;
  const code = kind === 'brick' ? /* glsl */ `
    {
      vec2 bu = vMapUv * vec2(${cols}.0, ${rows}.0);
      float row = floor(bu.y);
      float shift = mod(row + ${parity}.0, 2.0) * 0.5;
      bu.x -= shift;
      vec2 cell = floor(bu);
      vec2 f = bu - cell;
      vec2 texels = vec2(${size / cols}.0, ${(size / rows).toFixed(4)});
      vec2 w = max(fwidth(bu) * texels, vec2(1e-4));
      vec2 dEdge = min(f, 1.0 - f) * texels;
      vec2 inside = smoothstep(vec2(1.5) - 0.5 * w, vec2(1.5) + 0.5 * w, dEdge);
      float brickMask = inside.x * inside.y;
      vec3 mid = texture2D(map, (cell + vec2(0.5 + shift, 0.5)) / vec2(${cols}.0, ${rows}.0)).rgb;
      vec3 face = mix(mid, sampledDiffuseColor.rgb, smoothstep(1.5, 4.5, min(dEdge.x, dEdge.y)));
      float g = 0.6 * dtN(bu * vec2(26.0, 9.0)) + 0.4 * dtN(bu * vec2(70.0, 23.0));
      vec3 mortar = vec3(0.092, 0.08, 0.069) * (0.8 + 0.4 * dtN(bu * vec2(40.0, 40.0)));
      vec3 sharp = mix(mortar, face * (0.9 + 0.2 * g), brickMask);
      float near = 1.0 - smoothstep(0.35, 0.9, max(w.x, w.y));
      sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, sharp, near);
    }` : /* glsl */ `
    {
      vec2 tu = vMapUv * vec2(${size}.0);
      float w = max(fwidth(tu.x), fwidth(tu.y));
      float near = 1.0 - smoothstep(0.35, 0.9, w);
      float g = 0.55 * dtN(vMapUv * vec2(260.0, 7.0)) + 0.3 * dtN(vMapUv * vec2(700.0, 18.0)) + 0.15 * dtN(vMapUv * vec2(1600.0, 900.0));
      sampledDiffuseColor.rgb *= mix(1.0, 0.9 + 0.2 * g, near);
    }`;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${DETAIL_GLSL}`)
      .replace('#include <map_fragment>', `#ifdef USE_MAP
        vec4 sampledDiffuseColor = texture2D(map, vMapUv);
        ${code}
        diffuseColor *= sampledDiffuseColor;
      #endif`);
  };
  const prevKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}-detail-${kind}`;
  material.needsUpdate = true;
  return material;
}

// Emissive surfaces are plain unlit colours in HDR (values above 1 bloom).
export function glow(color, intensity, extra = {}) {
  const c = new THREE.Color(color).multiplyScalar(intensity);
  return new THREE.MeshBasicMaterial({ color: c, ...extra });
}

// A glowing tube or globe seen through its glass: brightest where we look
// along the normal (the gas column, the filament side), dimmer and more
// saturated toward the silhouette. Besides looking like neon (Mickey's: a
// whitish core in a coloured tube), it keeps the edge pixels of thin HDR
// shapes well below the core, so 2x MSAA can actually smooth them.
// edge: brightness at the silhouette (0..1); power: how fast it falls.
export function limbGlow(color, intensity, { edge = 0.2, power = 1.4, saturate = 0.0 } = {}) {
  const m = glow(color, intensity);
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLimbN;\nvarying vec3 vLimbV;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvLimbN = normalize(normalMatrix * normal);\nvLimbV = -mvPosition.xyz;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLimbN;\nvarying vec3 vLimbV;')
      .replace('#include <opaque_fragment>', `
        {
          float nv = abs(dot(normalize(vLimbN), normalize(vLimbV)));
          float k = ${edge.toFixed(3)} + ${(1 - edge).toFixed(3)} * pow(nv, ${power.toFixed(3)});
          // the rim keeps the hue, the core runs toward white
          vec3 hue = outgoingLight / max(max(outgoingLight.r, outgoingLight.g), max(outgoingLight.b, 1e-4));
          outgoingLight = mix(outgoingLight * k, hue * max(max(outgoingLight.r, outgoingLight.g), outgoingLight.b) * k, ${saturate.toFixed(3)} * (1.0 - nv));
        }
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => `limb-${edge}-${power}-${saturate}`;
  return m;
}

// A translight up close (the street's end, 12 x 8 m): lit from behind by a
// grid of sky pans, so it glows in soft hot spots with darker gaps and edges;
// printed in eight panels 1.5 m wide, each a shade different, sewn together
// in seams that pass less light; brush streaks and grain in the paint; a hem
// with grommets top and bottom. All at real size from the uv (w x h metres),
// so it holds at the "The backdrop" station and costs nothing far away.
export function translightDetail(m, { w, h, panels = 8, lamps = [6, 3] }) {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        float tlH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float tlN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(tlH(i), tlH(i + vec2(1.0, 0.0)), f.x), mix(tlH(i + vec2(0.0, 1.0)), tlH(i + vec2(1.0, 1.0)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec2 P = vMapUv * vec2(${w.toFixed(2)}, ${h.toFixed(2)});
          float bl = 0.0;
          for (int i = 0; i < ${lamps[0]}; i++) for (int j = 0; j < ${lamps[1]}; j++) {
            vec2 c = vec2((float(i) + 0.5) * ${(w / lamps[0]).toFixed(3)}, (float(j) + 0.5) * ${(h / lamps[1]).toFixed(3)});
            vec2 d = P - c;
            bl += exp(-dot(d, d) / 1.3);
          }
          float light = 0.42 + 0.68 * min(bl, 1.25);
          float pu = P.x / ${(w / panels).toFixed(3)};
          float ph = tlH(vec2(floor(pu), 3.7));
          vec3 tint = vec3(1.0 + (ph - 0.5) * 0.07, 1.0 + (ph - 0.5) * 0.02, 1.0 - (ph - 0.5) * 0.06);
          float sd = abs(fract(pu + 0.5) - 0.5) * ${(w / panels).toFixed(3)};
          float seam = 1.0 - 0.42 * (1.0 - smoothstep(0.005, 0.013, sd)) - 0.08 * (1.0 - smoothstep(0.013, 0.035, sd));
          float strokes = 0.6 * tlN(P * vec2(5.0, 48.0) + vec2(tlN(P * 2.0) * 3.0, 0.0)) + 0.4 * tlN(P * vec2(13.0, 110.0));
          float grain = tlN(P * 420.0);
          float paint = 0.88 + 0.2 * strokes + 0.06 * (grain - 0.5);
          float edge = min(P.y, ${h.toFixed(2)} - P.y);
          float hem = mix(0.45, 1.0, smoothstep(0.05, 0.065, edge));
          vec2 g = vec2(mod(P.x, 0.3) - 0.15, edge - 0.03);
          float grommet = 1.0 - 0.8 * (1.0 - smoothstep(0.008, 0.013, length(g))) * step(edge, 0.05);
          diffuseColor.rgb *= light * tint * seam * paint * hem * grommet;
        }`);
  };
  m.customProgramCacheKey = () => `translight-${w}-${h}-${panels}`;
  return m;
}

export function createMaterials(envMap = null) {
  const brickT = T.brick({ seed: 5, base: [118, 54, 40] });
  const brick2T = T.brick({ seed: 9, base: [86, 62, 52] });
  const asphaltT = T.asphalt();
  const walkT = T.sidewalk();
  const tileT = T.tiles({ color: [30, 74, 70], grout: [70, 72, 66] });
  const stuccoT = T.paintSurface({ base: [150, 140, 122], seed: 13, grime: 0.6, size: 2.5 });
  const signT = T.paintSurface({ base: [214, 200, 168], seed: 17, grime: 0.25, size: 2 });
  const wallInT = T.paintSurface({ base: [200, 168, 126], seed: 19, grime: 0.2, size: 2 });
  const pineT = T.pine();
  const luanT = T.luan();
  const floorT = T.stageFloor();
  const sandT = T.canvasCloth({ tone: [62, 58, 50] });
  const checkerT = T.checker();
  const backingT = T.cityBacking();
  const upperLamps = [1.2, 3.5, 5.8];
  const upperT = T.upperWall({ w: 7.0, h: 0.62, lamps: upperLamps });
  const newsT = T.newsPrint();
  const feedT = T.monitorFeeds();
  const chairT = T.labelAtlas(CHAIR_LABELS, { bg: '#18203a', fg: '#efe8d6', font: 'bold 70px sans-serif' });
  const signT2 = T.labelAtlas(SIGN_LABELS, { w: 1024, rowH: 160, bg: ['#d8b020', '#141414', '#d8b020'], fg: ['#101010', '#dcdcd6', '#101010'], font: ['bold 50px sans-serif', 'bold 120px sans-serif', 'bold 90px sans-serif'], grain: 0.08 });
  const dropT = T.streetDrop({ road: [(6.0 - 5.4) / 12, (6.0 + 0.2) / 12], vp: [(6.0 - 2.6) / 12, 1 - (2.0 - 0.15) / 8] });
  const exitT = T.labelAtlas(['EXIT'], { w: 256, rowH: 110, bg: '#120404', fg: '#ff2a1a', font: 'bold 84px sans-serif', grain: 0 });

  for (const t of [brickT, brick2T, asphaltT, walkT, tileT, stuccoT, signT, wallInT]) {
    for (const k of Object.keys(t)) T.metres(t[k]);
  }
  for (const t of [pineT, luanT, floorT, sandT, checkerT]) T.metres(t.map);

  const m = {
    textures: { brickT, brick2T, asphaltT, walkT, tileT, stuccoT, signT, wallInT, pineT, luanT, floorT, sandT, checkerT, backingT, upperT, newsT, feedT, chairT, signsT: signT2, exitT, dropT },
    // painted upper wall; the gooseneck lamps' pools are its emissive map (2700 K)
    upperWall: lam({ map: upperT.map, emissive: new THREE.Color(1.0, 0.86, 0.7).multiplyScalar(1.3), emissiveMap: upperT.lit }),
    upperWallLamps: upperLamps,
    shade: std({ color: 0x1c3a2c, roughness: 0.35, metalness: 0.1, envMap, envMapIntensity: 0.8, side: THREE.DoubleSide }),
    asphalt: std({ map: asphaltT.map, normalMap: asphaltT.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.85 }),
    sidewalk: std({ map: walkT.map, normalMap: walkT.normalMap, roughness: 0.8 }),
    curb: lam({ map: walkT.map, color: 0x9a968e }),
    brick: addDetail(lam({ map: brickT.map, normalMap: brickT.normalMap }), 'brick'),
    brick2: addDetail(lam({ map: brick2T.map, normalMap: brick2T.normalMap }), 'brick'),
    tile: std({ map: tileT.map, normalMap: tileT.normalMap, roughness: 0.2, envMap, envMapIntensity: 0.6 }),
    tileIn: interior({ map: tileT.map }, 1.1),
    stucco: lam({ map: stuccoT.map, normalMap: stuccoT.normalMap }),
    signBand: lam({ map: signT.map, normalMap: signT.normalMap }),
    redEnamel: std({ color: 0x6e1414, roughness: 0.3, envMap, envMapIntensity: 0.6 }),
    chrome: std({ color: 0xd8dde2, metalness: 1, roughness: 0.3, envMap, envMapIntensity: 0.8 }),
    chromeIn: interior({ color: 0x8a8580 }, 2.4),
    // satin anodised frames: sharp env glints on these thin edges crawl under head motion
    aluminum: std({ color: 0x8a9096, metalness: 1, roughness: 0.5, envMap, envMapIntensity: 0.55 }),
    darkMetal: lam({ color: 0x1a1c1f }),
    // (both sides: the work bulbs' cages are open tubes, seen into from above)
    castIron: std({ color: 0x111315, metalness: 0.55, roughness: 0.42, side: THREE.DoubleSide }),
    glass: std({ color: 0x0e1416, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.18, envMap, envMapIntensity: 0.45, depthWrite: false }),
    // the room is lit by its practicals (interior.js work lights); these
    // are the fill left between them (the blinds also glow with the light
    // through them, seen from the street)
    blinds: interior({ color: 0xb8a684, side: THREE.DoubleSide }, 1.5, 0xffb070),
    wallIn: interior({ map: wallInT.map }, 0.3),
    checker: interior({ map: checkerT.map }, 0.1),
    counter: interior({ color: 0x8a1c1c }, 2.0),
    counterTop: interior({ color: 0xb8ac90 }, 1.4),
    vinyl: interior({ color: 0x9a1717 }, 1.6),
    wood: lam({ map: pineT.map, color: 0x9a7a58 }),
    pine: lam({ map: pineT.map }),
    luan: addDetail(lam({ map: luanT.map }), 'wood'),
    flatEdge: lam({ color: 0x5e5246 }),
    deckEdge: lam({ color: 0x1b1b1c }),
    stageFloor: lam({ map: floorT.map }),
    stageWall: lam({ color: 0x1c1d20 }),
    sandbag: lam({ map: sandT.map }),
    blackCloth: lam({ color: 0x0b0b0b, side: THREE.DoubleSide }),
    rainBars: std({ color: 0x8a8d90, metalness: 0.75, roughness: 0.4, envMap, envMapIntensity: 0.7 }),
    gripSilver: std({ color: 0xb4b8bc, metalness: 0.9, roughness: 0.35, envMap, envMapIntensity: 0.8 }),
    blackPaint: lam({ color: 0x141516 }),
    rubber: lam({ color: 0x0f0f10 }),
    cableBlack: lam({ color: 0x0c0c0d }),
    cableOrange: lam({ color: 0x8a3a0e }),
    hydrant: std({ color: 0x8a1a12, roughness: 0.45 }),
    manhole: lam({ color: 0x0e0f10 }),
    figure: interior({ color: 0x1a1714 }, 0.04),
    menuBoard: lam({ color: 0x141210 }),
    menuText: glow(0xf0e0c0, 1.1),
    yellowPaint: std({ color: 0xb08a18, roughness: 0.5 }),
    newsBox: std({ color: 0x1d3b5a, roughness: 0.4, envMap, envMapIntensity: 0.4 }),
    newsPaper: lam({ map: newsT.paper }),
    newsLabel: lam({ map: newsT.label }),
    track: std({ color: 0x8c9196, metalness: 1, roughness: 0.3, envMap, envMapIntensity: 0.8 }),
    cameraBody: lam({ color: 0x141516 }),
    tape: lam({ color: 0x8a8678 }),
    // emissive
    backing: new THREE.MeshBasicMaterial({ map: backingT, color: new THREE.Color(1, 1, 1).multiplyScalar(0.9) }),
    // neon: core ~14x, edges ~2x (saturated); the glow cards and bloom carry the spill
    neonPink: limbGlow(0xff2a6a, 14, { edge: 0.14, power: 1.6 }),
    neonRed: glow(0xff2a1a, 22),
    neonTeal: limbGlow(0x40f0ff, 9, { edge: 0.15, power: 1.6 }),
    neonOff: std({ color: 0x3a1a22, roughness: 0.3, transparent: true, opacity: 0.6 }),
    pendant: limbGlow(0xffd6a0, 14, { edge: 0.45, power: 1.0 }),
    glowPink: glowCardMaterial(0xff2a6a, 0.35),
    glowCyan: glowCardMaterial(0x3af0ff, 0.22),
    glowPinkFloor: glowCardMaterial(0xff2a6a, 0.22),
    glowWarm: glowCardMaterial(0xffb070, 0.5),
    glowWarmFloor: glowCardMaterial(0xffb070, 0.3),
    lampGlobe: limbGlow(0xffb46a, 16, { edge: 0.5, power: 1.0 }),
    bulb: glow(0xffd8a8, 30),
    hmiLens: glow(0xdfe8ff, 60),
    fresnelLens: glow(0xffe0b0, 30),
    // face level chosen so the centre sits near 90 % and the edges near 60 % after the tone curve (gg01), not clipped
    // lit diffusion, not a grey card: a hot centre a couple of stops under
    // the HMI, falling to the edges (the texture)
    // (round 9: 2.6 -> 0.6, under an eggcrate; its cells read ~150-170)
    diffusion: new THREE.MeshBasicMaterial({ map: softboxTexture(), color: new THREE.Color(0xf0f2f8).multiplyScalar(0.6) }),
    softboxBody: lam({ color: 0x0c0c0d, side: THREE.DoubleSide }),
    gridPipe: std({ color: 0x9a9c9e, metalness: 0.35, roughness: 0.45, envMap, envMapIntensity: 1.2 }),
    drape: lam({ color: 0x0d0d0e, side: THREE.DoubleSide }),
    cinder: lam({ color: 0x8c8a84 }),
    // the stage building: corrugated roof deck, painted steel trusses and
    // catwalks, chain motors and their chains, LED panels switched low
    roof: lam({ color: 0x121316 }),
    truss: lam({ color: 0x5c5f63 }),
    catwalk: lam({ color: 0x232427 }),
    motor: lam({ color: 0x1c2532 }),
    chain: std({ color: 0x8a8c8e, metalness: 0.9, roughness: 0.4, envMap, envMapIntensity: 0.9 }),
    ledPanel: glow(0xdfe6ff, 0.22),
    tally: glow(0x30ff60, 6),
    bulbOff: lam({ color: 0x4a443c }),
    // the crew area (crew.js)
    monitorFeed: new THREE.MeshBasicMaterial({ map: feedT, color: new THREE.Color(1, 1, 1).multiplyScalar(1.5) }),
    glowCool: glowCardMaterial(0x7a9ad0, 0.14),
    glowRed: glowCardMaterial(0xff2010, 0.4),
    // the wall floods' pools: 3-4 stops under the set
    glowFlood: glowCardMaterial(0xffb070, 0.11),
    exitSign: new THREE.MeshBasicMaterial({ map: exitT, color: new THREE.Color(1, 1, 1).multiplyScalar(2.2) }),
    signs: lam({ map: signT2 }),
    chairCanvas: lam({ map: chairT, side: THREE.DoubleSide }),
    canvasSeat: lam({ color: 0x18203a, side: THREE.DoubleSide }),
    appleBox: lam({ map: pineT.map, color: 0xb08a5c }),
    cloth: lam({ color: 0xcfc8b8, side: THREE.DoubleSide }),
    fruit: lam({ color: 0xb8541a }),
    doorSteel: lam({ color: 0x4a5058 }),
    // the street's far end (streetend.js): the painted translight, lit from behind
    // (both sides: from behind, a translight shows its picture mirrored)
    streetDrop: translightDetail(new THREE.MeshBasicMaterial({ map: dropT, color: new THREE.Color(1, 0.96, 0.9).multiplyScalar(0.85), side: THREE.DoubleSide }), { w: 12, h: 8 }),
    skyPan: glow(0xfff0dc, 2.6),
    hoseRed: lam({ color: 0x7a2a1c }),
    tapeRed: lam({ color: 0x9a1810 }),
    // worn road paint, wet: a little lighter than the asphalt, not tape-bright
    roadPaint: lam({ color: 0x55534c }),
    pumpRed: lam({ color: 0x8a2416 }),
    // the parked sedan: deep oxblood paint, wet; its envMap is captured from the set at load
    // deep oxblood under a glossy wet clear coat: the hood should mirror the
    // DINER letters and the window frames, not wash beige with the street light
    carBody: std({ color: 0x150509, roughness: 0.05, metalness: 0.0, envMapIntensity: 0.5 }),
    carGlass: std({ color: 0x030405, roughness: 0.03, metalness: 0.0, envMapIntensity: 1.5 }),
    carChrome: std({ color: 0xd8dce0, metalness: 1, roughness: 0.14 }),
    carTyre: lam({ color: 0x0a0a0a }),
    carLamp: std({ color: 0x3c4246, roughness: 0.05, metalness: 0.2 }),
    carTail: std({ color: 0x380606, roughness: 0.12 }),
    carWhitewall: lam({ color: 0x4a4844 }),
    spaceLight: lam({ color: 0x5e5a54, side: THREE.DoubleSide }),
    // the A-camera and its dolly (front.js), the gear out front
    camBlack: std({ color: 0x151517, roughness: 0.42, metalness: 0.3, envMap, envMapIntensity: 0.7 }),
    camBody: std({ color: 0x2c2e33, roughness: 0.5, metalness: 0.25, envMap, envMapIntensity: 0.6 }),
    camRubber: lam({ color: 0x0f0f10 }),
    camGlass: std({ color: 0x0a1222, roughness: 0.04, metalness: 0.6, envMap, envMapIntensity: 1.6 }),
    camMetal: std({ color: 0xa4a8ac, metalness: 1, roughness: 0.32, envMap, envMapIntensity: 0.9 }),
    camWhite: lam({ color: 0xdedad0 }),
    camRed: std({ color: 0x8a1a12, roughness: 0.5, envMap, envMapIntensity: 0.4 }),
    camScreen: glow(0x7aa0c8, 1.0),
    camTally: glow(0xff2a14, 5.0),
    camBattery: std({ color: 0x1c1d20, roughness: 0.62, metalness: 0.1, envMap, envMapIntensity: 0.4 }),
    dollySilver: std({ color: 0xa2a6aa, metalness: 0.9, roughness: 0.38, envMap, envMapIntensity: 0.9 }),
    dollyDeck: lam({ color: 0x55585c }),
    dollySeat: lam({ color: 0x141414 }),
    dollyBlack: std({ color: 0x18181a, roughness: 0.5, metalness: 0.3, envMap, envMapIntensity: 0.6 }),
    caseOrange: std({ color: 0x8a6a1c, roughness: 0.55, envMap, envMapIntensity: 0.3 }),
    tubeLamp: limbGlow(0xeef4ff, 3.2, { edge: 0.4, power: 1.0 }),
    // the 12 x 12 bounce, lit by the HMI beside it (its light is not in the scene: the set's fill stands for it)
    bounce: glow(0xfff2e0, 0.28),
    bounceBack: lam({ color: 0x161616 }),
    crew_people: new THREE.MeshLambertMaterial({ vertexColors: true }),
    diffusionBack: lam({ color: 0x0c0c0c }),
    redLight: glow(0xff1a10, 14),
    monitor: glow(0x6a8ab0, 2.2),
    interiorGlow: glow(0xffc890, 2.5),
    passThrough: glow(0xffc890, 2.6),
    windowLit: glow(0xffc27a, 3.2),
    transomGlow: glow(0xffc27a, 3.2, { depthWrite: false }),
    windowDim: glow(0x6a7a8a, 0.35),
  };
  return m;
}

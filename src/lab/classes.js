// Region classes for measuring renders: every mesh of a scene is drawn in a
// flat class colour (no lighting, no MSAA, no post), so the tools can compute
// luma statistics per region ("diner interior", "street", "flat backs") from
// the matching final frame at any eye, instead of from hand-placed rectangles.
//
// A class is { names: [...mesh names], color: [r,g,b] 0-255 }. A class may
// also split by a world-space box in real (set) metres: fragments of the
// listed meshes inside `box` get `color`, the others fall through to the
// next class that lists the same mesh. Meshes in no class are drawn black
// (class "other"); hidden names are not drawn at all (glass, glow cards, rain).
// A name ending in * matches every mesh name with that prefix.

export const CLASSES = {
  soundstage: {
    hide: ['glass', 'in_glass', 'in_ao', 'glowPink', 'glowCyan', 'glowPinkFloor', 'glowWarm', 'glowWarmFloor', 'glowFloor', 'windowSpill', 'streak', 'glowCool', 'glowRed', 'glowFlood'],
    classes: [
      { id: 'interior', color: [255, 160, 0], names: ['checker', 'wallIn', 'tileIn', 'chromeIn', 'passThrough', 'counter', 'counterTop', 'vinyl', 'pendant', 'menuBoard', 'menuText', 'figure', 'blinds', 'interiorGlow', 'in_*', 'k_*'] },
      { id: 'street', color: [0, 0, 255], names: ['asphalt', 'stripe', 'roadPaint', 'manhole'] },
      { id: 'sidewalk', color: [0, 160, 255], names: ['sidewalk', 'curb'] },
      { id: 'facadeUpper', color: [255, 0, 255], names: ['stucco', 'stuccoUpper', 'ghostSign', 'cornice'], box: { min: [-1.7, 3.55, -0.6], max: [5.6, 5.2, 0.6] } },
      { id: 'facade', color: [160, 0, 255], names: ['tile', 'chrome', 'aluminum', 'signBand', 'stucco', 'redEnamel', 'stuccoUpper', 'cornice'] },
      { id: 'neon', color: [255, 0, 0], names: ['neonPink', 'neonTeal', 'neonCyan', 'lampGlobe', 'bulb'] },
      { id: 'buildings', color: [0, 255, 0], names: ['brick', 'brick2', 'windowLit', 'transomGlow', 'windowDim', 'backing', 'streetDrop', 'castIron', 'castIronNS', 'grime'] },
      { id: 'car', color: [255, 255, 0], names: ['carBody', 'carGlass', 'carChrome', 'carTyre', 'carLamp', 'carTail', 'carWhitewall'] },
      { id: 'flatBack', color: [255, 255, 255], names: ['luan', 'pine', 'flatEdge'] },
      { id: 'stageFloor', color: [128, 128, 128], names: ['stageFloor'] },
      { id: 'gear', color: [0, 255, 255], names: ['blackPaint', 'blackPaintNS', 'gripSilver', 'sandbag', 'rubber', 'cableBlack', 'cableOrange', 'cameraBody', 'monitor', 'diffusion', 'diffusionBack', 'softboxBody', 'hmiLens', 'fresnelLens', 'spaceLight', 'track', 'stageWall', 'blackCloth', 'drape', 'darkMetal', 'gridPipe', 'redLight', 'cinder', 'rainBars', 'speedRing', 'bounce', 'roof', 'truss', 'catwalk', 'motor', 'chain', 'ledPanel', 'tally', 'bulbOff', 'monitorFeed', 'signs', 'chairCanvas', 'canvasSeat', 'appleBox', 'cloth', 'fruit', 'doorSteel', 'exitSign', 'yellowPaint', 'hoseRed', 'pumpRed'] },
      { id: 'boom', color: [255, 128, 128], names: ['boom'] },
    ],
  },
  box: {
    hide: ['shaft', 'gShadow'],
    classes: [
      { id: 'wall', color: [255, 160, 0], names: ['wall'] },
      { id: 'floor', color: [0, 0, 255], names: ['floor'] },
      { id: 'frame', color: [160, 0, 255], names: ['frame', 'ceiling'] },
      { id: 'window', color: [255, 255, 255], names: ['shoji', 'night', 'star', 'nightSky', 'hillFar', 'hillNear', 'pane'] },
      { id: 'props', color: [0, 255, 0], names: ['lacquer', 'ceramic', 'ceramicIn', 'branch', 'blossom', 'blossomBud', 'stamen', 'lanternPaper', 'lanternFrame', 'scroll', 'scrollPaper'] },
      { id: 'bell', color: [255, 128, 128], names: ['bell'] },
      { id: 'shoji', color: [0, 255, 255], names: ['shojiPaper'] },
      { id: 'outside', color: [128, 128, 128], names: ['gMoss', 'gStone', 'gGravel', 'gPlaster', 'gTile', 'gWood', 'gDark', 'gTrunk', 'gLeafRed', 'gLeafOrange', 'gLeafAmber', 'gShrub', 'gCandle', 'gPaper', 'gRidgeNear', 'gRidgeFar', 'gardenSky', 'nTatami', 'nWall', 'nWood', 'nFusuma', 'nScroll', 'nCushion', 'nIron'] },
    ],
  },
};

// GLSL material drawing a class colour, optionally split by a world box.
// `inner`/`outer` colours; box in world coordinates.
/** Does a class's name list cover this mesh name (exact, or a prefix ending in *)? */
export function nameIn(names, name) {
  return names.some((n) => (n.endsWith('*') ? name.startsWith(n.slice(0, -1)) : n === name));
}

export function classMaterial(THREE, inner, outer = null, box = null) {
  const c = (v) => new THREE.Vector3(v[0] / 255, v[1] / 255, v[2] / 255);
  return new THREE.ShaderMaterial({
    uniforms: {
      cIn: { value: c(inner) },
      cOut: { value: c(outer ?? inner) },
      bMin: { value: new THREE.Vector3(...(box?.min ?? [-1e9, -1e9, -1e9])) },
      bMax: { value: new THREE.Vector3(...(box?.max ?? [1e9, 1e9, 1e9])) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 p = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
        #endif
        p = modelMatrix * p;
        vW = p.xyz;
        gl_Position = projectionMatrix * viewMatrix * p;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 cIn; uniform vec3 cOut; uniform vec3 bMin; uniform vec3 bMax;
      varying vec3 vW;
      void main() {
        bool inside = all(greaterThan(vW, bMin)) && all(lessThan(vW, bMax));
        gl_FragColor = vec4(inside ? cIn : cOut, 1.0);
      }`,
    side: THREE.DoubleSide,
  });
}

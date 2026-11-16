// Shared HDR film pipeline for the window scenes.
//
//   scene -> HDR target (MSAA on 'high') -> [haze composite] -> bloom chain
//         -> exposure + AgX tone curve + grade -> sRGB + dither -> output
//
// Everything is computed per pixel from the eye ray, so it stays correct when
// the off-axis camera moves every frame. Nothing here depends on a fixed view.
// The output pass writes display-referred values into whatever target was
// bound when render() was called (the canvas, or a lab texture).

import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const fsVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// 13-tap downsample (Jimenez 2014). The first level also folds in the haze so
// lights seen through haze bloom as they should, and uses a Karis average to
// keep single hot pixels from flickering.
const downFrag = /* glsl */ `
  uniform sampler2D src;
  uniform vec2 texel;      // source texel size
  uniform float first;
  uniform sampler2D haze;
  uniform float useHaze;
  varying vec2 vUv;
  vec3 fetch(vec2 uv) {
    vec3 c = texture2D(src, uv).rgb;
    if (useHaze > 0.5) { vec4 h = texture2D(haze, uv); c = c * h.a + h.rgb; }
    return c;
  }
  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  vec3 karis(vec3 a, vec3 b, vec3 c, vec3 d) {
    float wa = 1.0 / (1.0 + luma(a)), wb = 1.0 / (1.0 + luma(b));
    float wc = 1.0 / (1.0 + luma(c)), wd = 1.0 / (1.0 + luma(d));
    return (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);
  }
  void main() {
    vec2 t = texel;
    if (first > 0.5) {
      // full res -> quarter res: four bilinear taps cover a 4x4 block.
      vec3 p = fetch(vUv + t * vec2(-1.0, -1.0));
      vec3 q = fetch(vUv + t * vec2(1.0, -1.0));
      vec3 r = fetch(vUv + t * vec2(-1.0, 1.0));
      vec3 s = fetch(vUv + t * vec2(1.0, 1.0));
      gl_FragColor = vec4(max(karis(p, q, r, s), 0.0), 1.0);
      return;
    }
    vec3 a = fetch(vUv + t * vec2(-2.0, 2.0));
    vec3 b = fetch(vUv + t * vec2(0.0, 2.0));
    vec3 c = fetch(vUv + t * vec2(2.0, 2.0));
    vec3 d = fetch(vUv + t * vec2(-2.0, 0.0));
    vec3 e = fetch(vUv);
    vec3 f = fetch(vUv + t * vec2(2.0, 0.0));
    vec3 g = fetch(vUv + t * vec2(-2.0, -2.0));
    vec3 h = fetch(vUv + t * vec2(0.0, -2.0));
    vec3 i = fetch(vUv + t * vec2(2.0, -2.0));
    vec3 j = fetch(vUv + t * vec2(-1.0, 1.0));
    vec3 k = fetch(vUv + t * vec2(1.0, 1.0));
    vec3 l = fetch(vUv + t * vec2(-1.0, -1.0));
    vec3 m = fetch(vUv + t * vec2(1.0, -1.0));
    vec3 o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
    gl_FragColor = vec4(max(o, 0.0), 1.0);
  }
`;

// 3x3 tent upsample, added onto the next larger level.
const upFrag = /* glsl */ `
  uniform sampler2D src;
  uniform vec2 texel;
  uniform float radius;
  varying vec2 vUv;
  void main() {
    vec2 t = texel * radius;
    vec3 s = texture2D(src, vUv).rgb * 4.0;
    s += (texture2D(src, vUv + vec2(-t.x, 0.0)).rgb + texture2D(src, vUv + vec2(t.x, 0.0)).rgb
        + texture2D(src, vUv + vec2(0.0, -t.y)).rgb + texture2D(src, vUv + vec2(0.0, t.y)).rgb) * 2.0;
    s += texture2D(src, vUv + vec2(-t.x, -t.y)).rgb + texture2D(src, vUv + vec2(t.x, -t.y)).rgb
       + texture2D(src, vUv + vec2(-t.x, t.y)).rgb + texture2D(src, vUv + vec2(t.x, t.y)).rgb;
    gl_FragColor = vec4(s / 16.0, 1.0);
  }
`;

const finalFrag = /* glsl */ `
  uniform sampler2D tColor;
  uniform sampler2D tBloom;
  uniform sampler2D tHaze;
  uniform sampler2D tDepth;
  uniform sampler2D tHazeDepth;
  uniform vec2 hazeTexel;
  uniform float useHaze;
  uniform float useBloom;
  uniform float bloomStrength;
  uniform vec3 bloomTint;
  uniform float exposure;
  uniform vec3 lift;
  uniform vec3 gamma;
  uniform vec3 gain;
  uniform float saturation;
  uniform float contrast;
  uniform float cameraNear;
  uniform float cameraFar;
  uniform float isPersp;
  varying vec2 vUv;

  float viewZ(float d) {
    // perspective depth -> positive distance along the view axis
    return (cameraNear * cameraFar) / ((cameraFar - cameraNear) * d - cameraFar) * -1.0;
  }

  // Depth-aware upsample of the quarter-res haze: take the low-res neighbour
  // whose depth best matches this pixel, so haze does not bleed across edges.
  vec4 hazeAt(vec2 uv) {
    float z = viewZ(texture2D(tDepth, uv).r);
    vec2 base = uv / hazeTexel - 0.5;
    vec2 f = fract(base);
    vec2 o = (floor(base) + 0.5) * hazeTexel;
    vec4 acc = vec4(0.0);
    float wsum = 0.0;
    for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
      vec2 suv = o + vec2(float(i), float(j)) * hazeTexel;
      float zs = texture2D(tHazeDepth, suv).r;
      float bil = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
      float w = bil * (1.0 / (1e-4 + abs(z - zs) / max(z, 1e-3)));
      acc += texture2D(tHaze, suv) * w;
      wsum += w;
    }
    return acc / max(wsum, 1e-6);
  }

  // AgX (Blender / Filament) with a CDL look in log space.
  const mat3 LIN_SRGB_TO_2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
  const mat3 LIN_2020_TO_SRGB = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
  const mat3 AGX_IN = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 AGX_OUT = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  vec3 agxCurve(vec3 x) {
    vec3 x2 = x * x; vec3 x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
  }
  vec3 agx(vec3 c) {
    c = LIN_SRGB_TO_2020 * c;
    c = AGX_IN * c;
    c = clamp((log2(max(c, 1e-10)) + 12.47393) / 16.5, 0.0, 1.0);
    c = agxCurve(c);
    // look: contrast around mid grey, then saturation
    c = pow(max(c, 0.0), vec3(contrast));
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = l + saturation * (c - l);
    c = AGX_OUT * c;
    c = pow(max(c, 0.0), vec3(2.2));
    return clamp(LIN_2020_TO_SRGB * c, 0.0, 1.0);
  }
  vec3 toSRGB(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  // Triangular dither, +-1 LSB, keeps dark haze gradients free of banding.
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  void main() {
    vec3 c = texture2D(tColor, vUv).rgb;
    if (useHaze > 0.5) { vec4 h = hazeAt(vUv); c = c * h.a + h.rgb; }
    if (useBloom > 0.5) c = mix(c, texture2D(tBloom, vUv).rgb * bloomTint, bloomStrength);
    c *= exposure;
    c = agx(c);
    // lift / gamma / gain on display-linear values
    c = pow(max(c * gain + lift * (1.0 - c), 0.0), 1.0 / gamma);
    c = toSRGB(clamp(c, 0.0, 1.0));
    float n = hash(gl_FragCoord.xy) + hash(gl_FragCoord.xy + 17.17) - 1.0;
    c += n / 255.0;
    gl_FragColor = vec4(c, 1.0);
  }
`;

function makeTarget(w, h, opts = {}) {
  const t = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    ...opts,
  });
  t.texture.generateMipmaps = false;
  t.texture.minFilter = THREE.LinearFilter;
  t.texture.magFilter = THREE.LinearFilter;
  t.texture.wrapS = t.texture.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export class FilmPipeline {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} o
   * @param {'high'|'low'} o.quality
   * @param {object} [o.haze]    a Haze instance (see haze.js) or null
   */
  constructor(renderer, o = {}) {
    this.renderer = renderer;
    this.quality = o.quality ?? 'high';
    this.haze = o.haze ?? null;
    // 2x MSAA: at the app's 3420 x 2214 buffer 4x costs ~4 ms a frame on the
    // M2 (the multisampled target and its resolve go through memory), 2x about
    // half that; macOS then downsamples 3420 to the 2880-pixel panel, which
    // smooths edges further.
    this.samples = o.samples ?? (this.quality === 'high' ? 2 : 0);
    // Packed float HDR: a third of the bandwidth of RGBA16F, which matters at
    // 2880 x 1864 with 4x MSAA.
    this.hdrFormat = o.hdrFormat ?? 'r11g11b10';
    // Internal resolution relative to the drawing buffer ('low' renders smaller).
    this.renderScale = o.renderScale ?? (this.quality === 'high' ? 1 : 0.75);
    this.bloomLevels = this.quality === 'high' ? 4 : 3;
    this.settings = {
      exposure: 1,
      bloom: 0.06,
      bloomRadius: 1,
      bloomTint: new THREE.Color(1, 1, 1),
      lift: new THREE.Vector3(0, 0, 0),
      gamma: new THREE.Vector3(1, 1, 1),
      gain: new THREE.Vector3(1, 1, 1),
      saturation: 1.0,
      contrast: 1.0,
      ...o.settings,
    };
    this.enabled = { bloom: true, haze: true };
    this.size = new THREE.Vector2();
    this.quad = new FullScreenQuad(null);
    this.downMat = new THREE.ShaderMaterial({
      uniforms: {
        src: { value: null }, texel: { value: new THREE.Vector2() }, first: { value: 0 },
        haze: { value: null }, useHaze: { value: 0 },
      },
      vertexShader: fsVert, fragmentShader: downFrag, depthTest: false, depthWrite: false,
    });
    this.upMat = new THREE.ShaderMaterial({
      uniforms: { src: { value: null }, texel: { value: new THREE.Vector2() }, radius: { value: 1 } },
      vertexShader: fsVert, fragmentShader: upFrag, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending, transparent: true,
    });
    this.finalMat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null }, tBloom: { value: null }, tHaze: { value: null }, tDepth: { value: null },
        tHazeDepth: { value: null }, hazeTexel: { value: new THREE.Vector2() },
        useHaze: { value: 0 }, useBloom: { value: 1 }, bloomStrength: { value: 0.05 },
        bloomTint: { value: new THREE.Color() }, exposure: { value: 1 },
        lift: { value: new THREE.Vector3() }, gamma: { value: new THREE.Vector3(1, 1, 1) },
        gain: { value: new THREE.Vector3(1, 1, 1) }, saturation: { value: 1 }, contrast: { value: 1 },
        cameraNear: { value: 0.01 }, cameraFar: { value: 60 }, isPersp: { value: 1 },
      },
      vertexShader: fsVert, fragmentShader: finalFrag, depthTest: false, depthWrite: false,
    });
    this.targets = null;
  }

  ensure() {
    const r = this.renderer;
    // Internal targets match what we draw into: the canvas, or a bound
    // render target (the viewer's view, the window check). Rendering at the
    // canvas size and point-sampling into a smaller target would alias.
    const out = r.getRenderTarget();
    if (out) this.size.set(out.width, out.height);
    else r.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.round(this.size.x * this.renderScale));
    const h = Math.max(1, Math.round(this.size.y * this.renderScale));
    // The haze needs scene depth; resolving an MSAA depth buffer into a
    // texture costs real time at 7.6 MP, so only attach one when needed.
    const wantDepth = !!this.haze && !this.noDepth;
    if (this.targets && this.targets.w === w && this.targets.h === h && !!this.targets.hdr.depthTexture === wantDepth) {
      // A haze swapped in since the targets were made (Box rebuilds its haze
      // when the window size in metres changes, and the pixel buffer can stay
      // the same: page zoom in full screen, a new card measurement) has no
      // targets of its own yet.
      if (this.haze && this.targets.haze !== this.haze) {
        this.haze.resize(w, h);
        this.targets.haze = this.haze;
      }
      return this.targets;
    }
    this.disposeTargets();
    let depthTexture = null;
    if (wantDepth) {
      depthTexture = new THREE.DepthTexture(w, h);
      depthTexture.type = THREE.UnsignedIntType;
      depthTexture.minFilter = depthTexture.magFilter = THREE.NearestFilter;
    }
    const fmt = this.hdrFormat === 'rgba16f'
      ? { type: THREE.HalfFloatType, format: THREE.RGBAFormat }
      : this.hdrFormat === 'rgba8'
        ? { type: THREE.UnsignedByteType, format: THREE.RGBAFormat }
        : { type: THREE.UnsignedInt101111Type, format: THREE.RGBFormat };
    const hdr = makeTarget(w, h, { depthBuffer: true, samples: this.samples, ...(depthTexture ? { depthTexture } : {}), ...fmt });
    const mips = [];
    let mw = w;
    let mh = h;
    for (let i = 0; i < this.bloomLevels; i++) {
      const f = i === 0 ? 4 : 2; // first level is quarter res
      mw = Math.max(1, Math.floor(mw / f));
      mh = Math.max(1, Math.floor(mh / f));
      mips.push(makeTarget(mw, mh));
    }
    this.targets = { w, h, hdr, mips, haze: this.haze };
    this.haze?.resize(w, h);
    return this.targets;
  }

  disposeTargets() {
    if (!this.targets) return;
    this.targets.hdr.depthTexture?.dispose();
    this.targets.hdr.dispose();
    for (const m of this.targets.mips) m.dispose();
    this.targets = null;
  }

  pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.quad.render(this.renderer);
  }

  /** Render scene with camera into the currently bound target. */
  render(scene, camera, { bloom = true } = {}) {
    const r = this.renderer;
    const out = r.getRenderTarget();
    const prevAutoClear = r.autoClear;
    const t = this.ensure();
    const s = this.settings;

    const P = r.__prof; // optional GPU section timer (scene lab)
    r.autoClear = true;
    r.setRenderTarget(t.hdr);
    P?.begin('scene');
    r.render(scene, camera);
    P?.end(t.hdr);
    r.autoClear = false;

    const hazeOn = !!this.haze && this.enabled.haze && !!t.hdr.depthTexture;
    P?.begin('haze');
    if (hazeOn) this.haze.render(r, camera, t.hdr.depthTexture);
    P?.end(hazeOn ? this.haze.output : undefined);

    const bloomOn = bloom && this.enabled.bloom && s.bloom > 0;
    P?.begin('bloom');
    if (bloomOn) {
      const d = this.downMat.uniforms;
      let src = t.hdr;
      for (let i = 0; i < t.mips.length; i++) {
        d.src.value = src.texture;
        d.texel.value.set(1 / src.width, 1 / src.height);
        d.first.value = i === 0 ? 1 : 0;
        d.useHaze.value = i === 0 && hazeOn ? 1 : 0;
        d.haze.value = hazeOn ? this.haze.output.texture : null;
        this.pass(this.downMat, t.mips[i]);
        src = t.mips[i];
      }
      const u = this.upMat.uniforms;
      u.radius.value = s.bloomRadius;
      for (let i = t.mips.length - 1; i > 0; i--) {
        u.src.value = t.mips[i].texture;
        u.texel.value.set(1 / t.mips[i].width, 1 / t.mips[i].height);
        this.pass(this.upMat, t.mips[i - 1]);
      }
    }

    P?.end(bloomOn ? t.mips[0] : undefined);
    const f = this.finalMat.uniforms;
    f.tColor.value = t.hdr.texture;
    f.tDepth.value = t.hdr.depthTexture;
    f.useHaze.value = hazeOn ? 1 : 0;
    if (hazeOn) {
      f.tHaze.value = this.haze.output.texture;
      f.tHazeDepth.value = this.haze.depthOut.texture;
      f.hazeTexel.value.set(1 / this.haze.output.width, 1 / this.haze.output.height);
    }
    f.useBloom.value = bloomOn ? 1 : 0;
    f.tBloom.value = bloomOn ? t.mips[0].texture : null;
    f.bloomStrength.value = s.bloom;
    f.bloomTint.value.copy(s.bloomTint);
    f.exposure.value = s.exposure;
    f.lift.value.copy(s.lift);
    f.gamma.value.copy(s.gamma);
    f.gain.value.copy(s.gain);
    f.saturation.value = s.saturation;
    f.contrast.value = s.contrast;
    f.cameraNear.value = camera.near;
    f.cameraFar.value = camera.far;
    P?.begin('final');
    this.pass(this.finalMat, out);
    P?.end(out);
    r.autoClear = prevAutoClear;
  }

  dispose() {
    this.disposeTargets();
    this.quad.dispose();
    this.downMat.dispose();
    this.upMat.dispose();
    this.finalMat.dispose();
  }
}

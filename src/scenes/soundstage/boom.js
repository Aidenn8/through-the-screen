// A boom mic dipping into the shot: the furry windscreen hangs in front of
// the glass (z > 0 in window coordinates) while the pole runs back behind the
// glass and out through the top of the frame, so nothing in front of the
// glass ever touches the window edges. It bobs slightly, as if hand-held.
// Real metres, inside the scaled root group.

import * as THREE from 'three';
import { mat4 } from '../_lib/geo.js';

// Shell-textured fur: N copies of the windscreen pushed out along the normal,
// each cut by noise, resolved smoothly with alpha-to-coverage under MSAA.
// Backlight rim: the diner windows behind the mic light the fur's silhouette
// (hair glows where it is seen edge-on against a light), strongest underneath.
const RIM = new THREE.Color(1.0, 0.7, 0.42).multiplyScalar(2.2);
function furMaterial(base, shells, len) {
  const m = new THREE.MeshStandardMaterial({ color: base, roughness: 1, alphaToCoverage: true, transparent: false });
  m.onBeforeCompile = (s) => {
    s.uniforms.furLen = { value: len };
    s.uniforms.rimColor = { value: RIM };
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 rimColor;')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          float nv = clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);
          vec3 nW = inverseTransformDirection(normal, viewMatrix);
          float under = clamp(0.45 - 0.55 * nW.y, 0.0, 1.0);
          reflectedLight.indirectDiffuse += diffuseColor.rgb * rimColor * pow(1.0 - nv, 2.0) * under * (0.4 + 0.6 * vShell);
        }`);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float shell;\nuniform float furLen;\nvarying float vShell;\nvarying vec3 vFurP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normal * shell * furLen + vec3(0.0, -1.0, 0.0) * shell * shell * furLen * 0.6;\nvShell = shell;\nvFurP = position;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vShell;\nvarying vec3 vFurP;\nfloat h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }')
      .replace('#include <alphatest_fragment>', `
        float strand = h3(floor(vFurP * 900.0));
        float a = smoothstep(vShell - 0.08, vShell + 0.08, strand * 1.05);
        if (vShell > 0.001) diffuseColor.a = a; else diffuseColor.a = 1.0;
        diffuseColor.rgb *= mix(0.45, 1.15, vShell); // fake self-shadowing toward the roots
      `);
  };
  m.customProgramCacheKey = () => 'fur-shells';
  return m;
}

function shellGeometry(baseGeo, shells) {
  const parts = [];
  for (let i = 0; i < shells; i++) {
    const g = baseGeo.clone();
    const n = g.attributes.position.count;
    g.setAttribute('shell', new THREE.Float32BufferAttribute(new Float32Array(n).fill(i / (shells - 1)), 1));
    parts.push(g);
  }
  // merge manually (attributes identical)
  const merged = new THREE.BufferGeometry();
  const names = ['position', 'normal', 'uv', 'shell'];
  for (const name of names) {
    const arrs = parts.map((p) => p.attributes[name].array);
    const total = arrs.reduce((a, b) => a + b.length, 0);
    const out = new Float32Array(total);
    let o = 0;
    for (const a of arrs) { out.set(a, o); o += a.length; }
    merged.setAttribute(name, new THREE.BufferAttribute(out, parts[0].attributes[name].itemSize));
  }
  const idx = [];
  let off = 0;
  for (const p of parts) {
    for (let k = 0; k < p.index.count; k++) idx.push(p.index.array[k] + off);
    off += p.attributes.position.count;
  }
  merged.setIndex(idx);
  return merged;
}

export class BoomMic {
  /**
   * @param {object} m materials
   * @param {number[]} mic   windscreen centre (real m)
   * @param {number[]} pivot where the operator holds the pole (real m), off-frame
   */
  constructor(m, { mic = [-0.25, 2.16, 5.34], pivot = [1.0, 6.5, -0.5], quality = 'high' } = {}) {
    this.group = new THREE.Group();
    this.pivot = new THREE.Vector3(...pivot);
    this.group.position.copy(this.pivot);
    const arm = new THREE.Group();
    this.arm = arm;
    this.group.add(arm);
    const micV = new THREE.Vector3(...mic).sub(this.pivot);
    const len = micV.length();
    // pole along local -Y from the pivot to the mic end
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), micV.clone().normalize());
    arm.quaternion.copy(q);
    // anodised pole: a long specular line along it reads against the dark set
    const pole = new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.7, roughness: 0.3, envMap: m.gripSilver.envMap, envMapIntensity: 1.6 });
    this.poleMaterial = pole;
    const sections = [[0, 0.45, 0.024], [0.45, 0.75, 0.02], [0.75, 1.0, 0.016]];
    for (const [a, b, r] of sections) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(r, r, (b - a) * len, 16), pole);
      seg.position.y = -((a + b) / 2) * len;
      seg.castShadow = true;
      arm.add(seg);
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.35, r * 1.35, 0.05, 10), m.gripSilver);
      collar.position.y = -b * len + 0.03;
      arm.add(collar);
    }
    // cable spiralling along the pole
    const pts = [];
    for (let t = 0.02; t <= 0.97; t += 0.01) {
      const a = t * 34;
      pts.push(new THREE.Vector3(Math.cos(a) * 0.03, -t * len, Math.sin(a) * 0.03));
    }
    const cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 220, 0.006, 4), m.cableBlack);
    arm.add(cable);
    // shock mount and windscreen, hanging below the pole tip, pointing down at the action
    const tip = new THREE.Group();
    tip.position.y = -len;
    arm.add(tip);
    this.tip = tip;
    const mount = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.008, 6, 16), pole);
    mount.rotation.x = Math.PI / 2;
    tip.add(mount);
    const shells = quality === 'high' ? 12 : 5;
    const capsule = new THREE.CapsuleGeometry(0.055, 0.3, 8, 16);
    const fur = new THREE.Mesh(shellGeometry(capsule, shells), furMaterial(0x5d5a55, shells, 0.03));
    fur.rotation.z = Math.PI / 2;
    fur.position.set(0, -0.08, 0);
    fur.castShadow = true;
    tip.add(fur);
    this.fur = fur;
    // windscreen axis (tip-local x) points back at the actors by the door
    const want = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0.12, -0.3, -1).normalize());
    tip.quaternion.copy(arm.quaternion.clone().invert().multiply(want));
    this.group.traverse((o) => { o.userData.noReflect = true; if (o.isMesh) o.name = 'boom'; });
  }

  // Its own materials (geometries go with the scene traversal).
  dispose() {
    this.poleMaterial.dispose();
    this.fur.material.dispose();
  }

  update(time) {
    // hand-held: slow breathing sway plus a little tremor
    const a = 0.006 * Math.sin(time * 0.9) + 0.002 * Math.sin(time * 2.7 + 1.3);
    const b = 0.004 * Math.sin(time * 0.63 + 0.5) + 0.0015 * Math.sin(time * 3.4);
    this.group.rotation.set(a, 0, b);
  }
}

export { mat4 };

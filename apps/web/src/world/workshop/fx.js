// Alloy Frontier atmosphere kit: sky, time-of-day lighting, GPU particles, wind grass and
// post-processing. Depends only on three.js. Shared verbatim by the Model Workshop and the game
// (apps/web/src/world/EmberholdWorld.ts); keep the two copies in sync.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ---------------------------------------------------------------------------------------------
// Time of day
// ---------------------------------------------------------------------------------------------
/** sun: elevation/azimuth in degrees. glow: multiplier for emissive lamps/crystals. night: 0..1 (fireflies, lamp lights). */
export const TIMES = {
  morning: { label: 'Misty morning', sun: { el: 14, az: 115, color: '#ffd9b0', intensity: 1.9 }, hemi: ['#b9cde6', '#3b3427', 0.75], zenith: '#6f94bf', horizon: '#e9d2b6', fog: ['#c9c2b4', 0.0042], exposure: 1.0, bloom: [0.55, 0.55, 0.86], glow: 1, night: 0.1, grade: { warmth: 0.04, saturation: 0.98, contrast: 1.04, vignette: 0.32 } },
  day: { sun: { el: 52, az: 140, color: '#fff3dc', intensity: 2.6 }, label: 'Frontier day', hemi: ['#cfe1ff', '#3d3527', 0.9], zenith: '#4f7fb8', horizon: '#c7d6e3', fog: ['#b7c4cf', 0.0026], exposure: 1.0, bloom: [0.4, 0.5, 0.9], glow: 0.85, night: 0, grade: { warmth: 0.02, saturation: 1.04, contrast: 1.06, vignette: 0.28 } },
  golden: { sun: { el: 9, az: 250, color: '#ffa860', intensity: 2.8 }, label: 'Golden hour', hemi: ['#ffd2a6', '#2e2620', 0.62], zenith: '#506c9a', horizon: '#ffb070', fog: ['#d89a6a', 0.0034], exposure: 1.05, bloom: [0.7, 0.6, 0.82], glow: 1.15, night: 0.25, grade: { warmth: 0.09, saturation: 1.08, contrast: 1.08, vignette: 0.36 } },
  dusk: { sun: { el: 2, az: 262, color: '#ff7d52', intensity: 1.2 }, label: 'Ember dusk', hemi: ['#7d6f9a', '#1c1820', 0.5], zenith: '#22284a', horizon: '#c66a4a', fog: ['#5a4150', 0.0042], exposure: 1.1, bloom: [0.95, 0.65, 0.72], glow: 1.5, night: 0.75, grade: { warmth: 0.06, saturation: 1.06, contrast: 1.1, vignette: 0.42 } },
  night: { sun: { el: 38, az: 200, color: '#8ea8ff', intensity: 0.45 }, label: 'Forge night', hemi: ['#2c3a5e', '#0b0b10', 0.42], zenith: '#070a14', horizon: '#1b2338', fog: ['#141a28', 0.0048], exposure: 1.2, bloom: [1.15, 0.7, 0.62], glow: 1.9, night: 1, grade: { warmth: -0.03, saturation: 0.95, contrast: 1.12, vignette: 0.48 } },
};

export function sunDirection(t, out = new THREE.Vector3()) {
  const el = THREE.MathUtils.degToRad(t.sun.el);
  const az = THREE.MathUtils.degToRad(t.sun.az);
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
}

// ---------------------------------------------------------------------------------------------
// Sky dome: gradient, sun disc + halo, soft procedural clouds, stars at night
// ---------------------------------------------------------------------------------------------
export function createSky(radius = 1400) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: new THREE.Color('#4f7fb8') },
      uHorizon: { value: new THREE.Color('#c7d6e3') },
      uSunColor: { value: new THREE.Color('#fff3dc') },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uNight: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith, uHorizon, uSunColor, uSunDir;
      uniform float uNight, uTime;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.2, 1.0);
        vec3 col = mix(uHorizon, uZenith, pow(smoothstep(-0.02, 0.6, h), 0.7));
        col = mix(col, uHorizon * 0.55, smoothstep(0.0, -0.2, d.y));
        float s = max(dot(d, normalize(uSunDir)), 0.0);
        col += uSunColor * (pow(s, 8.0) * 0.35 + pow(s, 64.0) * 0.6) * (1.0 - uNight * 0.6);
        col += uSunColor * smoothstep(0.9993, 0.9998, s) * 6.0 * (1.0 - uNight * 0.85);
        // Clouds on a flattened dome.
        vec2 cp = d.xz / max(0.08, d.y + 0.12) * 0.9 + vec2(uTime * 0.004, uTime * 0.002);
        float c = smoothstep(0.52, 0.85, fbm(cp));
        vec3 cloudCol = mix(uHorizon * 1.08, uSunColor, pow(s, 3.0) * 0.6) * (1.0 - uNight * 0.75);
        col = mix(col, cloudCol, c * smoothstep(0.0, 0.18, d.y) * 0.75);
        // Stars.
        vec2 sp = floor(d.xz / max(0.15, d.y + 0.3) * 260.0);
        float star = step(0.9975, hash(sp)) * smoothstep(0.05, 0.4, d.y) * (0.6 + 0.4 * sin(uTime * 2.0 + hash(sp + 1.0) * 40.0));
        col += vec3(star) * uNight * (1.0 - c);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.name = 'sky';
  return mesh;
}

// ---------------------------------------------------------------------------------------------
// GPU particles: one Points draw per preset; motion is computed in the vertex shader.
// ---------------------------------------------------------------------------------------------
export const PARTICLES = {
  embers: { color: '#ff8a3d', intensity: 3.2, size: 0.09, life: 3.2, rise: 5.5, riseVar: 2.5, spread: 0.6, spreadGrow: 0.8, wobble: 0.6, grow: -0.4, fade: 0.55, additive: true },
  sparks: { color: '#ffc46b', intensity: 4.0, size: 0.05, life: 1.1, rise: 1.6, riseVar: 1.2, spread: 0.3, spreadGrow: 2.5, wobble: 0.15, grow: -0.6, fade: 0.4, additive: true },
  smoke: { color: '#6e6a66', intensity: 1, size: 2.2, life: 9, rise: 11, riseVar: 3, spread: 0.5, spreadGrow: 4, wobble: 1.6, grow: 2.4, fade: 0.35, additive: false, opacity: 0.32 },
  dust: { color: '#fff1d0', intensity: 1.4, size: 0.05, life: 14, rise: 1.2, riseVar: 1.5, spread: 1, spreadGrow: 0.1, wobble: 2.2, grow: 0, fade: 0.7, additive: true, volume: true },
  wisps: { color: '#5fe2ff', intensity: 3.5, size: 0.12, life: 7, rise: 1.4, riseVar: 1.2, spread: 1, spreadGrow: 0.2, wobble: 1.4, grow: 0, fade: 0.6, additive: true, blink: true, volume: true },
  motes: { color: '#8fe8ff', intensity: 3, size: 0.06, life: 4, rise: 1.8, riseVar: 1, spread: 0.7, spreadGrow: 0.3, wobble: 0.3, grow: -0.3, fade: 0.5, additive: true, blink: true },
};

export class ParticleField {
  /**
   * emitters: [{ x, y, z, count?, radius?, height? }] — radius/height spread a volume emitter.
   * density scales every emitter's count.
   */
  constructor(preset, emitters, { density = 1, pixelRatio = 1 } = {}) {
    const P = { ...PARTICLES[preset] };
    this.preset = P;
    const pos = [];
    const rnd = [];
    const spread = [];
    let seed = 1;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const e of emitters) {
      const n = Math.max(1, Math.round((e.count ?? 24) * density));
      for (let i = 0; i < n; i++) {
        pos.push(e.x, e.y, e.z);
        rnd.push(r(), r(), r(), r());
        spread.push(e.radius ?? P.spread, e.height ?? 0);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aRand', new THREE.Float32BufferAttribute(rnd, 4));
    g.setAttribute('aSpread', new THREE.Float32BufferAttribute(spread, 2));
    g.computeBoundingSphere();
    if (g.boundingSphere) g.boundingSphere.radius += P.rise + P.riseVar + 20;
    this.uniforms = {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(P.color).multiplyScalar(P.intensity) },
      uSize: { value: P.size },
      uLife: { value: P.life },
      uRise: { value: P.rise },
      uRiseVar: { value: P.riseVar },
      uSpreadGrow: { value: P.spreadGrow },
      uWobble: { value: P.wobble },
      uGrow: { value: P.grow },
      uFade: { value: P.fade },
      uOpacity: { value: P.opacity ?? 1 },
      uBlink: { value: P.blink ? 1 : 0 },
      uVolume: { value: P.volume ? 1 : 0 },
      uScale: { value: pixelRatio * 420 },
      uStrength: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: P.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */ `
        attribute vec4 aRand;
        attribute vec2 aSpread;
        uniform float uTime, uSize, uLife, uRise, uRiseVar, uSpreadGrow, uWobble, uGrow, uFade, uBlink, uVolume, uScale;
        varying float vAlpha;
        void main() {
          float life = fract(uTime / (uLife * (0.75 + aRand.w * 0.5)) + aRand.x);
          vec3 p = position;
          float ang = aRand.y * 6.2831;
          float rad = sqrt(aRand.z) * aSpread.x * (1.0 + life * uSpreadGrow);
          p.x += cos(ang) * rad;
          p.z += sin(ang) * rad;
          p.y += aSpread.y * aRand.w + life * (uRise + aRand.w * uRiseVar) * (1.0 - uVolume * 0.7);
          float t = uTime * 0.7 + aRand.x * 40.0;
          p.x += sin(t * 1.3) * uWobble * (uVolume > 0.5 ? 1.0 : life);
          p.z += cos(t * 1.1) * uWobble * (uVolume > 0.5 ? 1.0 : life);
          p.y += uVolume * sin(t * 0.9) * 0.6;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uSize * (0.6 + aRand.w * 0.8) * max(0.1, 1.0 + life * uGrow) * uScale / max(0.5, -mv.z);
          vAlpha = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(uFade, 1.0, life));
          if (uBlink > 0.5) vAlpha *= 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * 2.4 + aRand.z * 60.0), 3.0);
          vAlpha *= smoothstep(260.0, 120.0, -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity, uStrength;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(uColor, a * a * vAlpha * uOpacity * uStrength);
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.name = `particles:${preset}`;
    this.points.frustumCulled = true;
  }
  update(t) {
    this.uniforms.uTime.value = t;
  }
  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// Wind grass: crossed tapered blades, instanced, swaying in the vertex shader. Lit + shadowed.
// ---------------------------------------------------------------------------------------------
export function grassGeometry() {
  const blades = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI;
    const ca = Math.cos(a) * 0.28;
    const sa = Math.sin(a) * 0.28;
    blades.push(-ca, 0, -sa, ca, 0, sa, 0, 0.55, 0);
    blades.push(-ca * 0.6 + sa * 0.3, 0, -sa * 0.6 - ca * 0.3, ca * 0.6 + sa * 0.3, 0, sa * 0.6 - ca * 0.3, sa * 0.25, 0.42, -ca * 0.25);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(blades, 3));
  const n = [];
  for (let i = 0; i < blades.length / 3; i++) n.push(0, 1, 0);
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  return g;
}
export function createGrass(spots, timeUniform) {
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = timeUniform;
    sh.vertexShader = `uniform float uTime;\n${sh.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      float hgt = max(0.0, position.y);
      vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float wv = sin(uTime * 1.6 + wp.x * 0.31 + wp.z * 0.23) * 0.6 + sin(uTime * 3.3 + wp.x * 1.1 - wp.z * 0.7) * 0.25;
      transformed.x += wv * hgt * 0.35;
      transformed.z += wv * hgt * 0.22;`,
    );
  };
  const mesh = new THREE.InstancedMesh(grassGeometry(), mat, Math.max(1, spots.length));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const c = new THREE.Color();
  spots.forEach((p, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw);
    s.set(p.s, p.s * (0.8 + (p.h ?? 0.4)), p.s);
    m.compose(new THREE.Vector3(p.x, p.y, p.z), q, s);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.set(p.color));
  });
  mesh.count = spots.length;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = 'grass';
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

// ---------------------------------------------------------------------------------------------
// Post-processing: MSAA HDR render -> bloom -> tone map (OutputPass) -> grade (vignette, contrast,
// saturation, warmth, film grain).
// ---------------------------------------------------------------------------------------------
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.32 },
    uContrast: { value: 1.06 },
    uSaturation: { value: 1.04 },
    uWarmth: { value: 0.03 },
    uGrain: { value: 0.035 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette, uContrast, uSaturation, uWarmth, uGrain, uTime;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;
      // Warm highlights, cool shadows.
      col += vec3(uWarmth, uWarmth * 0.35, -uWarmth) * smoothstep(0.2, 0.9, l);
      col += vec3(-uWarmth * 0.4, 0.0, uWarmth * 0.6) * (1.0 - smoothstep(0.0, 0.35, l));
      vec2 d = vUv - 0.5;
      col *= 1.0 - uVignette * smoothstep(0.2, 0.85, dot(d, d) * 2.2);
      col += (hash(vUv * 1000.0 + fract(uTime) * 37.0) - 0.5) * uGrain;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

export function createPost(renderer, scene, camera, { samples = 4 } = {}) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples });
  const composer = new EffectComposer(renderer, target);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.5, 0.55, 0.85);
  const output = new OutputPass();
  const grade = new ShaderPass(GradeShader);
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(output);
  composer.addPass(grade);
  return {
    composer,
    bloom,
    grade,
    setSize(w, h) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
    },
    render(t) {
      grade.uniforms.uTime.value = t;
      composer.render();
    },
    dispose() {
      composer.dispose();
      target.dispose();
    },
  };
}

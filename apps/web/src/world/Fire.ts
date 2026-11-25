/**
 * Hearth fire: a few crossed flame cards drawn with a small noise shader (rising, flickering
 * tongues, hot white-yellow core to deep orange tips), additive so they glow with the bloom.
 */
import * as THREE from 'three';

const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const frag = /* glsl */ `
uniform float uTime;
uniform float uSeed;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  vec2 uv = vUv;
  float t = uTime * 1.6 + uSeed * 10.0;
  // Rising turbulence bends the flame sideways more toward the tip.
  float n1 = noise(vec2(uv.x * 3.0 + uSeed, uv.y * 2.5 - t * 1.4));
  float n2 = noise(vec2(uv.x * 7.0 - uSeed, uv.y * 5.0 - t * 2.3));
  float x = uv.x - 0.5 + (n1 - 0.5) * 0.35 * uv.y;
  // Teardrop: wide at the base, narrowing to a ragged tip.
  float width = mix(0.42, 0.04, pow(uv.y, 0.85));
  float body = 1.0 - smoothstep(width * 0.35, width, abs(x));
  float fade = (1.0 - smoothstep(0.45, 1.0, uv.y + (n2 - 0.5) * 0.35)) * smoothstep(0.0, 0.08, uv.y);
  float f = clamp(body * fade * (0.75 + 0.5 * n2), 0.0, 1.0);
  vec3 tip = vec3(0.95, 0.22, 0.02);
  vec3 mid = vec3(1.0, 0.55, 0.08);
  vec3 core = vec3(1.0, 0.92, 0.6);
  vec3 col = mix(tip, mid, smoothstep(0.15, 0.55, f));
  col = mix(col, core, smoothstep(0.65, 0.95, f) * (1.0 - uv.y));
  gl_FragColor = vec4(col * f * 0.95, f);
}`;

/** Add flame cards to a group sitting on the coal bed (local y = 0 at the coals). */
export function buildFire(group: THREE.Group, uniforms: { uTime: { value: number } }): void {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0, 0.5, 0);
  const cards: Array<[number, number, number, number, number]> = [
    // x, z, width, height, yaw
    [0, 0, 0.9, 1.05, 0],
    [0, 0, 0.9, 1.0, Math.PI / 3],
    [0, 0, 0.9, 0.95, -Math.PI / 3],
    [-0.42, 0.05, 0.55, 0.7, 0.4],
    [0.4, -0.05, 0.55, 0.75, -0.5],
    [0.05, 0.12, 0.45, 0.55, 1.2],
  ];
  cards.forEach(([x, z, w, hgt, yaw], i) => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uTime: uniforms.uTime, uSeed: { value: i * 0.37 + 0.11 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, 0, z);
    m.scale.set(w, hgt, 1);
    m.rotation.y = yaw;
    m.renderOrder = 2;
    group.add(m);
  });
}

/**
 * Analytic daylight sky with drifting cumulus clouds, emitting absolute
 * radiance in scene units (1 = 1000 cd/m²). Values are chosen to match
 * measured clear-sky luminances: ~3–5 kcd/m² at the zenith away from the
 * sun, ~8–10 kcd/m² near the horizon, sunlit cloud tops ~12–15 kcd/m².
 *
 * The same shader renders the visible sky and the environment map used for
 * image-based ambient light, so sky brightness and ambient illumination stay
 * consistent automatically.
 */

import * as THREE from 'three';

export interface SkyParams {
  sunDirection: THREE.Vector3;
  /** Direct-normal sun illuminance in scene units (kilolux). */
  sunIlluminance: number;
  /** Mean albedo of the ground, used for the lower hemisphere. */
  groundAlbedo: THREE.Color;
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // keep the dome on the far plane
}
`;

export const SKY_FUNCTIONS = /* glsl */ `
uniform vec3 uSunDir;
uniform float uSunIlluminance;
uniform vec3 uGroundAlbedo;
uniform float uSkyTime;
uniform float uCloudCover;

float sHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float sNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(sHash(i), sHash(i + vec2(1, 0)), u.x), mix(sHash(i + vec2(0, 1)), sHash(i + vec2(1, 1)), u.x), u.y);
}
float sFbm(vec2 p) {
  float s = 0.0, a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 6; i++) { s += a * sNoise(p); p = r * p * 2.02; a *= 0.5; }
  return s;
}

vec3 clearSky(vec3 dir) {
  float h = max(dir.y, 0.0);
  float cosSun = dot(dir, uSunDir);
  // Rayleigh-like gradient: deeper blue overhead, bright pale haze at the horizon.
  vec3 zenith = vec3(0.19, 0.42, 1.0) * 3.6;
  vec3 horizon = vec3(0.78, 0.88, 1.0) * 8.5;
  float t = pow(1.0 - h, 3.5);
  vec3 sky = mix(zenith, horizon, t);
  // Rayleigh phase: slightly brighter towards and away from the sun.
  sky *= 0.85 + 0.25 * cosSun * cosSun;
  // Darker band 90° from the sun (polarisation-like falloff).
  // Mie forward scattering glow around the sun.
  float mu = max(cosSun, 0.0);
  vec3 sunTint = vec3(1.0, 0.93, 0.82);
  sky += sunTint * (3.5 * pow(mu, 8.0) + 12.0 * pow(mu, 64.0) + 60.0 * pow(mu, 900.0));
  return sky;
}

vec4 clouds(vec3 dir, out float fade) {
  // Intersect a cloud layer ~1.6 km up; project to layer coordinates.
  float h = max(dir.y, 0.02);
  vec2 p = dir.xz / h * 1.6;
  p += vec2(0.012, 0.004) * uSkyTime; // ~10 m/s drift at altitude
  float n = sFbm(p * 0.9 + vec2(3.1, 7.7));
  float d = smoothstep(1.0 - uCloudCover, 1.0 - uCloudCover + 0.22, n);
  fade = smoothstep(0.02, 0.18, dir.y);
  // Self-shadowing: sample towards the sun for a darker base / bright rim.
  float n2 = sFbm(p * 0.9 + vec2(3.1, 7.7) + uSunDir.xz * 0.12);
  float shade = clamp(1.0 - (n2 - n) * 5.0, 0.35, 1.25);
  return vec4(vec3(shade), d);
}

vec3 skyRadiance(vec3 dir, bool withSunDisk) {
  if (dir.y < 0.0) {
    // Lower hemisphere: sunlit ground seen through haze.
    float sunE = uSunIlluminance * max(uSunDir.y, 0.0);
    vec3 ground = uGroundAlbedo * (sunE + 14.0) / 3.14159;
    vec3 haze = clearSky(vec3(dir.x, 0.0, dir.z));
    return mix(haze, ground, smoothstep(0.0, 0.12, -dir.y));
  }
  vec3 sky = clearSky(dir);
  float fade;
  vec4 cl = clouds(dir, fade);
  float mu = max(dot(dir, uSunDir), 0.0);
  vec3 cloudCol = vec3(1.0, 0.97, 0.93) * (6.5 + 7.0 * cl.r) + vec3(1.0, 0.9, 0.75) * 12.0 * pow(mu, 12.0);
  if (withSunDisk && dot(dir, uSunDir) > 0.99996) {
    sky += vec3(1.0, 0.95, 0.85) * 250.0;
  }
  sky = mix(sky, cloudCol, cl.a * fade * 0.95);
  return sky;
}
`;

const SKY_FRAG = /* glsl */ `
${SKY_FUNCTIONS}
varying vec3 vDir;
void main() {
  vec3 dir = normalize(vDir);
  gl_FragColor = vec4(skyRadiance(dir, true), 1.0);
}
`;

export function createSkyMaterial(params: SkyParams): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'SkyDome',
    uniforms: {
      uSunDir: { value: params.sunDirection.clone().normalize() },
      uSunIlluminance: { value: params.sunIlluminance },
      uGroundAlbedo: { value: params.groundAlbedo.clone() },
      uSkyTime: { value: 0 },
      uCloudCover: { value: 0.42 },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

export function createSkyDome(params: SkyParams): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(5000, 64, 32), createSkyMaterial(params));
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = 'sky';
  return mesh;
}

/**
 * Pre-filtered environment map of the sky for image-based ambient light.
 * The visible sky and the ambient light share one shader.
 */
export function createSkyEnvironment(renderer: THREE.WebGLRenderer, params: SkyParams): THREE.Texture {
  const envScene = new THREE.Scene();
  const mat = createSkyMaterial(params);
  // No sun disk in the environment: direct sun is the DirectionalLight.
  mat.fragmentShader = mat.fragmentShader.replace('skyRadiance(dir, true)', 'skyRadiance(dir, false)');
  const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 64, 32), mat);
  envScene.add(dome);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(envScene, 0, 0.1, 500);
  pmrem.dispose();
  dome.geometry.dispose();
  mat.dispose();
  return rt.texture;
}

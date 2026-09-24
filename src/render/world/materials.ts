/**
 * Shared material patches.
 *
 * Sky visibility: image-based ambient light from the sky is not shadowed by
 * three.js. Under a dense tree canopy that makes shade far too bright, which
 * would ruin the dynamic-range lessons (sunlit subject vs deep shade). We
 * approximate the fraction of sky hidden by each canopy (treated as a sphere)
 * analytically in the fragment shader and scale indirect light by it.
 */

import * as THREE from 'three';

export const MAX_CANOPIES = 24;

export const canopyUniforms = {
  uCanopies: { value: Array.from({ length: MAX_CANOPIES }, () => new THREE.Vector4(0, -1000, 0, 0)) },
  uCanopyCount: { value: 0 },
  uWorldTime: { value: 0 },
};

export function registerCanopy(center: THREE.Vector3, radius: number): void {
  const i = canopyUniforms.uCanopyCount.value;
  if (i >= MAX_CANOPIES) return;
  canopyUniforms.uCanopies.value[i].set(center.x, center.y, center.z, radius);
  canopyUniforms.uCanopyCount.value = i + 1;
}

const CANOPY_GLSL = /* glsl */ `
uniform vec4 uCanopies[${MAX_CANOPIES}];
uniform int uCanopyCount;
float canopySkyVisibility(vec3 p) {
  float vis = 1.0;
  for (int i = 0; i < ${MAX_CANOPIES}; i++) {
    if (i >= uCanopyCount) break;
    vec4 c = uCanopies[i];
    vec3 d = c.xyz - p;
    float dist = length(d);
    float r = c.w;
    // Solid-angle fraction of the upper hemisphere covered by the sphere,
    // weighted by how overhead it is (cosine-weighted irradiance).
    float sinA = clamp(r / max(dist, 1e-3), 0.0, 1.0);
    float cap = 1.0 - sqrt(1.0 - sinA * sinA);
    float up = clamp(d.y / max(dist, 1e-3), 0.0, 1.0);
    float inside = smoothstep(r, r * 0.6, dist);
    float cover = max(cap * (0.4 + 1.2 * up), inside * 0.9);
    vis *= 1.0 - 0.82 * clamp(cover, 0.0, 1.0);
  }
  return vis;
}
`;

export interface PatchOptions {
  /** Apply canopy sky-visibility to indirect light (default true). */
  canopy?: boolean;
  /** Extra vertex-shader code inserted after `begin_vertex` (has `transformed`). */
  vertex?: string;
  vertexPars?: string;
  /** Extra fragment code inserted after map sampling (has `diffuseColor`, `vWorldPosC`). */
  fragmentColor?: string;
  fragmentPars?: string;
  uniforms?: Record<string, THREE.IUniform>;
}

/** Patch a MeshStandardMaterial-derived material with world position + sky visibility. */
export function patchMaterial<T extends THREE.MeshStandardMaterial>(mat: T, opts: PatchOptions = {}): T {
  const useCanopy = opts.canopy !== false;
  const key = JSON.stringify([useCanopy, opts.vertex ?? '', opts.fragmentColor ?? '']);
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, canopyUniforms, opts.uniforms ?? {});
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec3 vWorldPosC;\nuniform float uWorldTime;\n${opts.vertexPars ?? ''}`,
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${opts.vertex ?? ''}`)
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        {
          vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_BATCHING
            wp = batchingMatrix * wp;
          #endif
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          vWorldPosC = (modelMatrix * wp).xyz;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec3 vWorldPosC;\nuniform float uWorldTime;\n${CANOPY_GLSL}\n${opts.fragmentPars ?? ''}`,
      )
      .replace('#include <map_fragment>', `#include <map_fragment>\n${opts.fragmentColor ?? ''}`)
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>\n${
          useCanopy
            ? `{ float skyVis = canopySkyVisibility(vWorldPosC);
                 reflectedLight.indirectDiffuse *= skyVis;
                 reflectedLight.indirectSpecular *= mix(1.0, skyVis, 0.85); }`
            : ''
        }`,
      );
  };
  return mat;
}

/** GLSL value noise usable inside patched materials. */
export const GLSL_NOISE = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm2(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s / 0.9375;
}
`;

/**
 * GLSL for the photographic post pipeline. Every stage corresponds to a
 * physical step (see docs/rendering-pipeline.md):
 *   CoC     – thin-lens circle of confusion per pixel from depth
 *   DOF     – gather blur with the per-pixel CoC (scatter-as-gather)
 *   METER   – average scene luminance for the light meter
 *   DEVELOP – exposure → vignetting → sensor noise → clipping → white balance → tone curve → sRGB
 */

export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const COMMON = /* glsl */ `
float lum709(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// Hash-based uniform noise in [0,1).
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

export const COC_FRAG = /* glsl */ `
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform float uNear;
uniform float uFar;
uniform float uFocus;
uniform float uCocK;
uniform float uMaxCoc;
uniform float uClamp;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tColor, vUv).rgb;
  float d = texture2D(tDepth, vUv).x;
  float z = -perspectiveDepthToViewZ(d, uNear, uFar);
  // Thin lens: blur diameter (px) = K·(z − s)/z, signed (negative = in front of focus).
  float coc = 0.5 * uCocK * (z - uFocus) / max(z, 1e-4);
  coc = clamp(coc, -uMaxCoc, uMaxCoc);
  c = min(c, vec3(uClamp));
  gl_FragColor = vec4(c, coc);
}
`;

export const DOF_FRAG = /* glsl */ `
${COMMON}
uniform sampler2D tCoc;
uniform vec2 uTexel;
uniform float uMaxRadius;
uniform float uRadScale;
uniform float uFrame;
varying vec2 vUv;
const float GOLDEN_ANGLE = 2.39996323;
void main() {
  vec4 c = texture2D(tCoc, vUv);
  float centerSize = abs(c.a);
  vec3 color = c.rgb;
  float tot = 1.0;
  float radius = uRadScale;
  float ang = 6.2831853 * ign(gl_FragCoord.xy + uFrame * 17.0);
  for (int i = 0; i < 2048; i++) {
    if (radius >= uMaxRadius) break;
    vec2 tc = vUv + vec2(cos(ang), sin(ang)) * uTexel * radius;
    vec4 s = texture2D(tCoc, tc);
    float sSize = abs(s.a);
    // A sample behind the centre can only blur over it by as much as the centre is blurred.
    if (s.a > c.a) sSize = min(sSize, centerSize * 2.0);
    float m = smoothstep(radius - 0.5, radius + 0.5, sSize);
    color += mix(color / tot, s.rgb, m);
    tot += 1.0;
    ang += GOLDEN_ANGLE;
    radius += uRadScale / radius;
  }
  gl_FragColor = vec4(color / tot, c.a);
}
`;

export const COPY_FRAG = /* glsl */ `
uniform sampler2D tInput;
uniform float uWeight;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(tInput, vUv) * uWeight;
}
`;

export const METER_FRAG = /* glsl */ `
${COMMON}
uniform sampler2D tInput;
uniform vec2 uCell;
varying vec2 vUv;
void main() {
  // 4×4 taps across the cell this texel represents.
  float sum = 0.0;
  float mx = 0.0;
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      vec2 o = (vec2(float(x), float(y)) + 0.5) / 4.0 - 0.5;
      float l = lum709(texture2D(tInput, vUv + o * uCell).rgb);
      sum += l;
      mx = max(mx, l);
    }
  }
  gl_FragColor = vec4(sum / 16.0, mx, 0.0, 1.0);
}
`;

export const DEVELOP_FRAG = /* glsl */ `
${COMMON}
uniform sampler2D tInput;
uniform vec2 uTexel;
uniform float uAspect;
uniform float uExposure;      // scene units → normalised raw (1 = clip)
uniform float uVignette;      // corner fall-off in stops
uniform float uFullScale;     // electrons at raw clip for this ISO
uniform float uReadNoise;     // electrons RMS
uniform float uNoise;         // 0/1
uniform float uSeed;
uniform vec3 uWB;
uniform float uZebra;
uniform float uPeaking;
uniform float uDofZone;
uniform float uCocLimitPx;    // acceptable CoC radius in px
uniform float uTime;
varying vec2 vUv;

vec3 gaussian3(vec2 fc, float seed) {
  vec3 u1 = vec3(hash13(vec3(fc, seed)), hash13(vec3(fc, seed + 11.7)), hash13(vec3(fc, seed + 23.1)));
  vec3 u2 = vec3(hash13(vec3(fc + 0.37, seed + 5.3)), hash13(vec3(fc + 0.71, seed + 17.9)), hash13(vec3(fc + 0.13, seed + 29.3)));
  u1 = max(u1, vec3(1e-6));
  return sqrt(-2.0 * log(u1)) * cos(6.2831853 * u2);
}

// Camera "standard" tone curve: maps raw [0,1] (1 = clip) to display-linear.
// Extended Reinhard with white point at raw clip, placing metered mid-grey
// (raw 0.104) at display-linear 0.18, followed by a mild S-curve.
vec3 toneCurve(vec3 x) {
  const float k = 1.122;
  vec3 y = (1.0 + k) * x / (x + k);
  return y;
}

vec3 srgbEncode(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 rawAt(vec2 uv) {
  vec4 t = texture2D(tInput, uv);
  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
  float r = length(p) / length(vec2(uAspect, 1.0) * 0.5);
  float vig = exp2(-uVignette * pow(r, 2.3));
  return t.rgb * uExposure * vig;
}

void main() {
  vec4 src = texture2D(tInput, vUv);
  vec3 raw = rawAt(vUv);
  if (uNoise > 0.5) {
    vec3 e = max(raw, 0.0) * uFullScale;
    vec3 sigma = sqrt(e + uReadNoise * uReadNoise);
    e += sigma * gaussian3(gl_FragCoord.xy, uSeed);
    raw = e / uFullScale;
  }
  bool clipped = any(greaterThanEqual(raw, vec3(0.995)));
  raw = clamp(raw, 0.0, 1.0);
  vec3 lin = min(raw * uWB, vec3(1.0));
  vec3 disp = toneCurve(lin);
  // Standard-profile saturation (+10 %) around luminance.
  float l = lum709(disp);
  disp = max(vec3(0.0), l + (disp - l) * 1.1);
  vec3 outc = srgbEncode(disp);
  // Mild S-curve in display space.
  outc = mix(outc, outc * outc * (3.0 - 2.0 * outc), 0.22);

  if (uDofZone > 0.5) {
    float inZone = 1.0 - smoothstep(uCocLimitPx, uCocLimitPx * 1.6, abs(src.a));
    outc = mix(outc, vec3(0.15, 0.85, 1.0), 0.28 * inZone);
  }
  if (uPeaking > 0.5) {
    float lc = lum709(toneCurve(clamp(rawAt(vUv) , 0.0, 1.0)));
    float lx = lum709(toneCurve(clamp(rawAt(vUv + vec2(uTexel.x, 0.0)), 0.0, 1.0)));
    float ly = lum709(toneCurve(clamp(rawAt(vUv + vec2(0.0, uTexel.y)), 0.0, 1.0)));
    float g = length(vec2(lx - lc, ly - lc)) / max(lc, 0.05);
    if (g > 0.35 && abs(src.a) < 1.2) outc = mix(outc, vec3(1.0, 0.1, 0.1), 0.85);
  }
  if (uZebra > 0.5 && clipped) {
    float stripe = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y + uTime * 30.0) / 10.0));
    outc = mix(outc, vec3(stripe), 0.7);
  }
  gl_FragColor = vec4(outc, 1.0);
}
`;

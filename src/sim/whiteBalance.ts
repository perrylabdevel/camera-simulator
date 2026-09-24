/**
 * White balance.
 *
 * Colour temperature → chromaticity uses the cubic-spline approximation of
 * the Planckian locus by Kim et al. (2002, US patent 7,024,034; widely
 * reproduced, e.g. Wikipedia "Planckian locus"), valid 1667–25000 K.
 * xy → XYZ (Y = 1) → linear sRGB with the standard IEC 61966-2-1 matrix.
 *
 * The renderer's linear RGB is treated as camera RGB with a D65 white, so
 * a white surface under an illuminant of temperature T records
 * rgb ∝ illuminantRgb(T). Setting the camera's white balance to T applies
 * gains 1 / illuminantRgb(T) (normalised to green = 1), which maps that
 * light back to neutral.
 */

export type WhiteBalancePreset = 'auto' | 'daylight' | 'cloudy' | 'shade' | 'tungsten' | 'fluorescent' | 'flash' | 'kelvin';

export const WB_PRESET_KELVIN: Record<Exclude<WhiteBalancePreset, 'auto' | 'kelvin'>, number> = {
  daylight: 5500,
  cloudy: 6500,
  shade: 7500,
  tungsten: 3200,
  fluorescent: 4000,
  flash: 5500,
};

export const WB_LABELS: Record<WhiteBalancePreset, string> = {
  auto: 'Auto',
  daylight: 'Daylight',
  cloudy: 'Cloudy',
  shade: 'Shade',
  tungsten: 'Tungsten',
  fluorescent: 'Fluorescent',
  flash: 'Flash',
  kelvin: 'Kelvin',
};

export function planckianXy(kelvin: number): [number, number] {
  const T = Math.min(25000, Math.max(1667, kelvin));
  const t = 1e3 / T;
  const x =
    T <= 4000
      ? -0.2661239 * t ** 3 - 0.234358 * t ** 2 + 0.8776956 * t + 0.17991
      : -3.0258469 * t ** 3 + 2.1070379 * t ** 2 + 0.2226347 * t + 0.24039;
  let y: number;
  if (T <= 2222) y = -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683;
  else if (T <= 4000) y = -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867;
  else y = 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  return [x, y];
}

/** Linear sRGB of an illuminant at `kelvin`, normalised so green = 1. */
export function illuminantRgb(kelvin: number): [number, number, number] {
  const [x, y] = planckianXy(kelvin);
  const X = x / y;
  const Z = (1 - x - y) / y;
  const r = 3.2406 * X - 1.5372 - 0.4986 * Z;
  const g = -0.9689 * X + 1.8758 + 0.0415 * Z;
  const b = 0.0557 * X - 0.204 + 1.057 * Z;
  return [Math.max(r, 1e-4) / g, 1, Math.max(b, 1e-4) / g];
}

/**
 * Per-channel gains that neutralise light of temperature `kelvin`.
 * Anchored so 6504 K gives unit gains: the renderer's RGB white is D65,
 * which lies slightly off the Planckian locus.
 */
export function whiteBalanceGains(kelvin: number): [number, number, number] {
  const [r, , b] = illuminantRgb(kelvin);
  const [r0, , b0] = illuminantRgb(6504);
  return [r0 / r, 1, b0 / b];
}

/** Renderer RGB of a white surface lit by light at `kelvin` (D65 white = 1,1,1). */
export function sceneWhiteRgb(kelvin: number): [number, number, number] {
  const [r, , b] = illuminantRgb(kelvin);
  const [r0, , b0] = illuminantRgb(6504);
  return [r / r0, 1, b / b0];
}

/**
 * Estimate the illuminant temperature from an average colour that should be
 * neutral, by finding the Planckian temperature with the same blue/red
 * ratio. Returns Kelvin clamped to 2500–10000.
 */
export function estimateKelvin(avg: [number, number, number]): number {
  const target = Math.log(Math.max(avg[2], 1e-6) / Math.max(avg[0], 1e-6));
  let best = 5500;
  let bestErr = Infinity;
  for (let k = 2500; k <= 10000; k += 50) {
    const [r, , b] = sceneWhiteRgb(k);
    const err = Math.abs(Math.log(b / r) - target);
    if (err < bestErr) {
      bestErr = err;
      best = k;
    }
  }
  return best;
}

/**
 * Auto white balance from a grid of average scene colours (linear RGB
 * triplets). Plain grey-world fails in a park because grass is green and
 * warm, so only bright cells whose colour lies on the Planckian locus
 * count ("grey pixels": clouds, paths, pale surfaces). With too little neutral content the camera
 * falls back to daylight, as many real cameras effectively do.
 */
export function autoWhiteBalance(rgb: ArrayLike<number>): number {
  const n = Math.floor(rgb.length / 3);
  const lums: number[] = [];
  for (let i = 0; i < n; i++) lums.push(0.2126 * rgb[3 * i] + 0.7152 * rgb[3 * i + 1] + 0.0722 * rgb[3 * i + 2]);
  const sorted = [...lums].sort((a, b) => a - b);
  const median = sorted[Math.floor(n / 2)] ?? 0;
  const total = lums.reduce((a, b) => a + b, 0);
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let w = 0;
  for (let i = 0; i < n; i++) {
    const r = rgb[3 * i];
    const g = rgb[3 * i + 1];
    const b = rgb[3 * i + 2];
    if (g <= 0 || lums[i] < median) continue;
    // A grey surface under any natural light lies on the Planckian locus:
    // find the temperature matching its blue/red ratio, then check that its
    // red/green ratio also matches (green grass or magenta flowers do not).
    const k = estimateKelvin([r, g, b]);
    const expected = sceneWhiteRgb(k);
    const dev = Math.abs(Math.log(r / g / expected[0]));
    if (dev > 0.12) continue;
    const weight = (1 - dev / 0.12) * lums[i];
    sr += r * weight;
    sg += g * weight;
    sb += b * weight;
    w += weight;
  }
  if (w <= 0 || w < 0.02 * total) return 5500;
  return Math.min(8000, Math.max(3000, estimateKelvin([sr / w, sg / w, sb / w])));
}

/**
 * Colour cast in "mireds" (1e6 / K) between the light and the WB setting.
 * Positive = image rendered warmer (orange) than neutral, negative = cooler (blue).
 * ~±20 mired is barely visible, ±100 is strong.
 */
export function castMired(sceneKelvin: number, wbKelvin: number): number {
  return 1e6 / sceneKelvin - 1e6 / wbKelvin;
}

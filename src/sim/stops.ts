/**
 * Standard photographic value scales in 1/3-stop increments.
 *
 * Cameras display rounded *nominal* values ("f/5.6", "1/125") while the
 * underlying exposure uses the exact geometric sequence (f/5.657, 1/128 s).
 * The simulator keeps both: nominal for display, exact for all math, so the
 * meter never drifts because of display rounding.
 */

export interface StopValue {
  /** Exact value used for calculations. */
  readonly value: number;
  /** Rounded value a real camera would display. */
  readonly nominal: number;
  /** Position on the scale in 1/3 stops relative to the scale origin. */
  readonly third: number;
}

const APERTURE_NOMINALS = [
  1.0, 1.1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5.0, 5.6, 6.3, 7.1, 8, 9, 10, 11,
  13, 14, 16, 18, 20, 22, 25, 29, 32,
];

/** f-numbers from f/1.0 to f/32. Exact value is sqrt(2)^(k/3). */
export const APERTURES: readonly StopValue[] = APERTURE_NOMINALS.map((nominal, k) => ({
  value: Math.SQRT2 ** (k / 3),
  nominal,
  third: k,
}));

const SHUTTER_NOMINALS_SECONDS = [
  30, 25, 20, 15, 13, 10, 8, 6, 5, 4, 3.2, 2.5, 2, 1.6, 1.3, 1, 0.8, 0.6, 0.5, 0.4, 0.3, 1 / 4, 1 / 5,
  1 / 6, 1 / 8, 1 / 10, 1 / 13, 1 / 15, 1 / 20, 1 / 25, 1 / 30, 1 / 40, 1 / 50, 1 / 60, 1 / 80, 1 / 100,
  1 / 125, 1 / 160, 1 / 200, 1 / 250, 1 / 320, 1 / 400, 1 / 500, 1 / 640, 1 / 800, 1 / 1000, 1 / 1250,
  1 / 1600, 1 / 2000, 1 / 2500, 1 / 3200, 1 / 4000, 1 / 5000, 1 / 6400, 1 / 8000,
];

/**
 * Shutter speeds from 30 s to 1/8000 s. Exact value is 2^(-k/3) relative to
 * 1 s, where 30 s is nominal for 32 s (2^5) exactly as on real cameras.
 */
export const SHUTTER_SPEEDS: readonly StopValue[] = SHUTTER_NOMINALS_SECONDS.map((nominal, i) => {
  const k = i - 15; // index 15 is 1 s
  return { value: 2 ** (-k / 3), nominal, third: k };
});

const ISO_NOMINALS = [
  50, 64, 80, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200,
  4000, 5000, 6400, 8000, 10000, 12800, 16000, 20000, 25600, 32000, 40000, 51200, 64000, 80000, 102400,
];

/** ISO sensitivities. Exact value is 100 * 2^(k/3) with k=0 at ISO 100. */
export const ISOS: readonly StopValue[] = ISO_NOMINALS.map((nominal, i) => {
  const k = i - 3;
  return { value: 100 * 2 ** (k / 3), nominal, third: k };
});

/** Find the scale entry whose nominal value is closest to `nominal` (log distance). */
export function nearestStop(scale: readonly StopValue[], nominal: number): StopValue {
  let best = scale[0];
  let bestD = Infinity;
  for (const s of scale) {
    const d = Math.abs(Math.log(s.nominal) - Math.log(nominal));
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

export function indexOfStop(scale: readonly StopValue[], nominal: number): number {
  return scale.indexOf(nearestStop(scale, nominal));
}

/** Entries of a scale within [min, max] (inclusive, compared on nominal with a small tolerance). */
export function stopsInRange(scale: readonly StopValue[], min: number, max: number): StopValue[] {
  const eps = 1e-6;
  return scale.filter((s) => s.nominal >= min * (1 - eps) - eps && s.nominal <= max * (1 + eps) + eps);
}

export function formatAperture(n: number): string {
  return `f/${n < 10 && !Number.isInteger(n) ? n.toFixed(1) : String(n)}`;
}

export function formatShutter(seconds: number): string {
  if (seconds >= 0.3 - 1e-9) {
    const s = Math.round(seconds * 10) / 10;
    return `${Number.isInteger(s) ? s.toFixed(0) : s.toFixed(1)}"`;
  }
  return `1/${Math.round(1 / seconds)}`;
}

export function formatShutterLong(seconds: number): string {
  if (seconds >= 0.3 - 1e-9) {
    const s = Math.round(seconds * 10) / 10;
    return `${Number.isInteger(s) ? s.toFixed(0) : s.toFixed(1)} s`;
  }
  return `1/${Math.round(1 / seconds)} s`;
}

export function formatIso(iso: number): string {
  return `ISO ${iso}`;
}

export function formatDistance(m: number): string {
  if (!Number.isFinite(m)) return '∞';
  if (m < 1) return `${Math.round(m * 100)} cm`;
  if (m < 10) return `${m.toFixed(2)} m`;
  if (m < 100) return `${m.toFixed(1)} m`;
  return `${Math.round(m)} m`;
}

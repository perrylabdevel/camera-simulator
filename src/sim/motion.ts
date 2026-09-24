/**
 * Motion-blur estimates used for choosing temporal sample counts and for
 * the deterministic photo critique. The rendered photograph integrates the
 * real motion over the shutter interval; these helpers only predict it.
 */

/** Image-plane blur (mm) of a point moving `speedMps` perpendicular to the optical axis at `distanceM`. */
export function subjectBlurMm(speedMps: number, distanceM: number, shutterS: number, focalMm: number): number {
  const travelM = speedMps * shutterS;
  return (travelM / distanceM) * focalMm;
}

/** Shutter time needed to keep subject blur below `limitMm`. */
export function shutterToFreeze(speedMps: number, distanceM: number, focalMm: number, limitMm: number): number {
  return (limitMm * distanceM) / (speedMps * focalMm);
}

export type BlurClass = 'frozen' | 'slight' | 'blurred' | 'streaked';

/** Classify a blur length in output pixels. `sharpPx` is the acceptable-sharpness threshold. */
export function classifyBlur(px: number, sharpPx: number): BlurClass {
  if (px <= sharpPx) return 'frozen';
  if (px <= sharpPx * 4) return 'slight';
  if (px <= sharpPx * 25) return 'blurred';
  return 'streaked';
}

/**
 * Number of temporal sub-frames to integrate for a capture. Enough that
 * consecutive samples are ≤ ~1.5 px apart, bounded for performance. A floor
 * keeps anti-aliasing and depth-of-field sampling smooth even at 1/8000 s.
 */
export function temporalSampleCount(maxBlurPx: number, min = 12, max = 160): number {
  return Math.max(min, Math.min(max, Math.ceil(maxBlurPx / 1.5)));
}

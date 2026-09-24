/**
 * Photometric units used by the renderer.
 *
 * The scene is lit and shaded in *absolute* photometric units scaled by
 * LUMINANCE_UNIT so values fit comfortably in half-float render targets:
 *   - a pixel value of 1.0 in the HDR target is 1000 cd/m² of luminance;
 *   - light intensities are illuminance in kilolux.
 * three.js' physically based materials turn illuminance E into luminance
 * ρ·E/π for a Lambertian surface of albedo ρ, so this scale is consistent.
 */
export const LUMINANCE_UNIT = 1000;

/** Convert illuminance in lux to a three.js light intensity in scene units. */
export function luxToIntensity(lux: number): number {
  return lux / LUMINANCE_UNIT;
}

/** Rec. 709 luminance weights for linear RGB. */
export const LUMA = [0.2126, 0.7152, 0.0722] as const;

/**
 * Exposure model.
 *
 * Sources / derivation:
 *  - Exposure value: EV = log2(N² / t)  (ISO 2720, APEX). Referenced to ISO 100:
 *      EV100 = log2(N² / t) − log2(S / 100)
 *  - Reflected-light meter equation (ISO 2720): N² / t = L·S / K, with the
 *    calibration constant K = 12.5 cd·s/m² (Canon, Nikon, Sekonic). Hence the
 *    EV100 that correctly exposes an average scene luminance L is
 *      EV100 = log2(L · 100 / K)
 *  - Saturation-based sensitivity (ISO 12232): S_sat = 78 / H_sat where the
 *    focal-plane exposure is H = q·L·t / N² with q = 0.65 (lens transmittance,
 *    vignetting and angle factors). Solving for the luminance that just
 *    saturates the sensor:
 *      L_sat = 78·N² / (q·S·t) = 1.2 · 2^EV100   (cd/m²)
 *    This is the same relationship used in "Moving Frostbite to PBR"
 *    (Lagarde & de Rousiers 2014, §5.1).
 *
 * The normalised sensor signal for a surface of luminance L is therefore
 * L / L_sat, where 1.0 means the photosite is full (clipped).
 *
 * Consequence: a correctly metered scene places its average luminance at
 * 1 / (1.2 · 100/12.5) = 0.104 of saturation, i.e. ~3.3 stops of highlight
 * headroom, which matches measured behaviour of real cameras.
 */

export const METER_CALIBRATION_K = 12.5;
export const LENS_TRANSMITTANCE_Q = 0.65;
/** 78 / q / 100 = 1.2: factor between 2^EV100 and saturation luminance. */
export const SATURATION_FACTOR = 78 / (LENS_TRANSMITTANCE_Q * 100);

export interface ExposureTriangle {
  /** Exact f-number. */
  aperture: number;
  /** Exact shutter time in seconds. */
  shutter: number;
  /** Exact ISO sensitivity. */
  iso: number;
}

/** Camera exposure value referenced to ISO 100 (the "EV100" of the settings). */
export function settingsEv100({ aperture, shutter, iso }: ExposureTriangle): number {
  return Math.log2((aperture * aperture) / shutter) - Math.log2(iso / 100);
}

/** EV100 a reflected-light meter recommends for average scene luminance L (cd/m²). */
export function meteredEv100(luminance: number): number {
  return Math.log2((Math.max(luminance, 1e-9) * 100) / METER_CALIBRATION_K);
}

/** Scene luminance (cd/m²) that exactly saturates the sensor for the given settings. */
export function saturationLuminance(settings: ExposureTriangle): number {
  return SATURATION_FACTOR * 2 ** settingsEv100(settings);
}

/**
 * Multiplier that converts scene luminance (cd/m²) to normalised sensor
 * signal (1.0 = full well / clipping).
 */
export function sensorExposureScale(settings: ExposureTriangle): number {
  return 1 / saturationLuminance(settings);
}

/**
 * Exposure error in stops relative to the meter's recommendation.
 * Positive = brighter than the meter recommends (overexposed).
 * `compensation` shifts the meter target (+1 means the photographer asked for 1 stop brighter).
 */
export function meterOffsetStops(
  settings: ExposureTriangle,
  meteredLuminance: number,
  compensation = 0,
): number {
  return meteredEv100(meteredLuminance) - settingsEv100(settings) - compensation;
}

/** Normalised sensor level at which a correctly metered average scene lands. */
export const METERED_MIDTONE_SIGNAL = METER_CALIBRATION_K / (SATURATION_FACTOR * 100);

/** Shutter time that yields EV100 `ev` at the given aperture and ISO. */
export function shutterForEv(ev100: number, aperture: number, iso: number): number {
  return (aperture * aperture) / 2 ** (ev100 + Math.log2(iso / 100));
}

/** Aperture that yields EV100 `ev` at the given shutter and ISO. */
export function apertureForEv(ev100: number, shutter: number, iso: number): number {
  return Math.sqrt(shutter * 2 ** (ev100 + Math.log2(iso / 100)));
}

/** ISO that yields EV100 `ev` at the given aperture and shutter. */
export function isoForEv(ev100: number, aperture: number, shutter: number): number {
  return 100 * 2 ** (Math.log2((aperture * aperture) / shutter) - ev100);
}

/** Clamp an exposure-meter reading to the displayed scale (±3 EV on most bodies). */
export function clampMeter(stops: number, range = 3): number {
  return Math.max(-range, Math.min(range, stops));
}

/**
 * Sensor noise model.
 *
 * A photosite collects photo-electrons; photon arrival is Poisson so the
 * shot noise is sqrt(electrons). Readout adds Gaussian read noise. ISO is
 * modelled as analogue gain: at ISO S the raw clipping point corresponds to
 *    Efs(S) = fullWell · baseIso / S   electrons,
 * so raising ISO does not add light, it only amplifies what little was
 * collected — and uses up highlight headroom. This gives the right
 * qualitative behaviour for free:
 *  - noise rises with ISO because fewer electrons represent the same output level;
 *  - dynamic range (log2(Efs / readNoise)) falls ~1 stop per doubled ISO;
 *  - underexposing and brightening in post looks like high ISO (ISO invariance).
 *
 * Signal is expressed as normalised raw level v ∈ [0, 1] (1 = clip).
 *
 * Approximation: one output pixel is treated as one photosite ("100 % view")
 * so noise is visible at screen sizes. See docs/known-approximations.md.
 */

import type { SensorSpec } from './equipment';

export function fullScaleElectrons(sensor: SensorSpec, iso: number): number {
  return (sensor.fullWellElectrons * sensor.baseIso) / Math.max(iso, sensor.baseIso);
}

/** Standard deviation of the normalised raw signal at level v. */
export function noiseSigma(sensor: SensorSpec, iso: number, v: number): number {
  const efs = fullScaleElectrons(sensor, iso);
  const electrons = Math.max(0, v) * efs;
  return Math.sqrt(electrons + sensor.readNoiseElectrons ** 2) / efs;
}

/** Signal-to-noise ratio at normalised level v. */
export function snr(sensor: SensorSpec, iso: number, v: number): number {
  return v / noiseSigma(sensor, iso, v);
}

/** Engineering dynamic range in stops (full scale over read-noise floor). */
export function dynamicRangeStops(sensor: SensorSpec, iso: number): number {
  return Math.log2(fullScaleElectrons(sensor, iso) / sensor.readNoiseElectrons);
}

/** Pixel pitch in micrometres, assuming square pixels filling the sensor. */
export function pixelPitchUm(sensor: SensorSpec): number {
  const pixels = sensor.resolutionMp * 1e6;
  return Math.sqrt((sensor.widthMm * sensor.heightMm) / pixels) * 1000;
}

/** Parameters the renderer needs for its per-pixel noise shader. */
export interface NoiseUniforms {
  fullScaleElectrons: number;
  readNoiseElectrons: number;
}

export function noiseUniforms(sensor: SensorSpec, iso: number): NoiseUniforms {
  return { fullScaleElectrons: fullScaleElectrons(sensor, iso), readNoiseElectrons: sensor.readNoiseElectrons };
}

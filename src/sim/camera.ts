/**
 * Camera state: the photographer-controlled settings, independent of any renderer.
 */

import type { BodySpec, LensSpec } from './equipment';
import { clampFocal, clampFocus, maxApertureAt } from './equipment';
import { APERTURES, ISOS, SHUTTER_SPEEDS, stopsInRange, type StopValue } from './stops';
import type { Support } from './shake';
import type { ExposureTriangle } from './exposure';

export type FocusMode = 'AF-S' | 'AF-C' | 'MF';
export type MeteringMode = 'evaluative' | 'center' | 'spot';

export interface CameraSettings {
  bodyId: string;
  lensId: string;
  focalLengthMm: number;
  /** Nominal values as displayed; exact values are resolved via the stop tables. */
  apertureNominal: number;
  shutterNominal: number;
  isoNominal: number;
  exposureCompensation: number;
  focusDistanceM: number;
  focusMode: FocusMode;
  /** AF point in normalised frame coordinates (0..1, origin top-left). */
  afPoint: { x: number; y: number };
  metering: MeteringMode;
  stabilization: boolean;
  support: Support;
}

export function availableApertures(lens: LensSpec, focalMm: number): StopValue[] {
  const widest = maxApertureAt(lens, focalMm);
  return stopsInRange(APERTURES, widest - 0.051, lens.minAperture);
}

export function availableShutters(body: BodySpec): StopValue[] {
  return stopsInRange(SHUTTER_SPEEDS, body.shutterRange[0], body.shutterRange[1]).sort((a, b) => b.value - a.value);
}

export function availableIsos(body: BodySpec): StopValue[] {
  return stopsInRange(ISOS, body.isoRange[0], body.isoRange[1]);
}

function pick(scale: StopValue[], nominal: number): StopValue {
  let best = scale[0];
  let bestD = Infinity;
  for (const s of scale) {
    const d = Math.abs(Math.log(s.nominal / nominal));
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

/** Resolve nominal settings to exact values after clamping to the equipment's limits. */
export function resolveExposure(s: CameraSettings, body: BodySpec, lens: LensSpec): ExposureTriangle {
  const focal = clampFocal(lens, s.focalLengthMm);
  return {
    aperture: pick(availableApertures(lens, focal), s.apertureNominal).value,
    shutter: pick(availableShutters(body), s.shutterNominal).value,
    iso: pick(availableIsos(body), s.isoNominal).value,
  };
}

/** Clamp every setting into what the mounted body and lens physically allow. */
export function constrainSettings(s: CameraSettings, body: BodySpec, lens: LensSpec): CameraSettings {
  const focal = clampFocal(lens, s.focalLengthMm);
  return {
    ...s,
    focalLengthMm: focal,
    apertureNominal: pick(availableApertures(lens, focal), s.apertureNominal).nominal,
    shutterNominal: pick(availableShutters(body), s.shutterNominal).nominal,
    isoNominal: pick(availableIsos(body), s.isoNominal).nominal,
    focusDistanceM: clampFocus(lens, s.focusDistanceM),
    exposureCompensation: Math.max(-3, Math.min(3, s.exposureCompensation)),
  };
}

/** Step a nominal value along its scale by `delta` thirds of a stop. */
export function stepStop(scale: StopValue[], nominal: number, delta: number): number {
  const i = scale.indexOf(pick(scale, nominal));
  const j = Math.max(0, Math.min(scale.length - 1, i + delta));
  return scale[j].nominal;
}

export function totalStabilizationStops(s: CameraSettings, body: BodySpec, lens: LensSpec): number {
  if (!s.stabilization) return 0;
  // Coordinated body + lens systems gain roughly half a stop over the better of the two.
  const best = Math.max(body.ibisStops, lens.stabilizationStops);
  const bonus = body.ibisStops > 0 && lens.stabilizationStops > 0 ? 0.5 : 0;
  return best + bonus;
}

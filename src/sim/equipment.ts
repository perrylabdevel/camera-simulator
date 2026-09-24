/**
 * Equipment data model. Bodies and lenses are plain data (see src/data/*.json)
 * so new equipment never requires code changes. Validation lives here so bad
 * data fails loudly at startup rather than producing odd photographs.
 */

import type { SensorGeometry } from './optics';

export interface SensorSpec extends SensorGeometry {
  /** Human-readable format class, e.g. "Full frame". */
  format: string;
  resolutionMp: number;
  /** Native (base) ISO: the gain at which the full well maps to raw clipping. */
  baseIso: number;
  /** Full-well capacity per photosite at base ISO (electrons). */
  fullWellElectrons: number;
  /** Read noise at high gain, referred to the input (electrons RMS). */
  readNoiseElectrons: number;
}

export interface BodySpec {
  id: string;
  name: string;
  sensor: SensorSpec;
  isoRange: [number, number];
  /** Shutter range in seconds [fastest, slowest]. */
  shutterRange: [number, number];
  /** In-body stabilisation effectiveness in stops (0 = none). */
  ibisStops: number;
  /** Nominal aspect of the output image (width / height). */
  aspect: number;
}

export interface LensSpec {
  id: string;
  name: string;
  /** [min, max] focal length in mm. Equal for primes. */
  focalRange: [number, number];
  /** Widest aperture (smallest f-number) — at the shortest focal length for variable zooms. */
  maxAperture: number;
  /** Widest aperture at the long end for variable-aperture zooms. Defaults to maxAperture. */
  maxApertureTele?: number;
  minAperture: number;
  minimumFocusDistanceM: number;
  /** Optical stabilisation effectiveness in stops (0 = none). */
  stabilizationStops: number;
  /** Corner light fall-off wide open, in stops (optical + natural vignetting). */
  vignettingStopsWideOpen: number;
  /** Aperture blade count (affects bokeh shape eventually). */
  apertureBlades: number;
}

export function isZoom(lens: LensSpec): boolean {
  return lens.focalRange[1] > lens.focalRange[0];
}

/** Widest available aperture at a given focal length (linear interpolation for variable zooms). */
export function maxApertureAt(lens: LensSpec, focalMm: number): number {
  const tele = lens.maxApertureTele ?? lens.maxAperture;
  if (!isZoom(lens) || tele === lens.maxAperture) return lens.maxAperture;
  const [a, b] = lens.focalRange;
  const t = Math.min(1, Math.max(0, (focalMm - a) / (b - a)));
  return lens.maxAperture + (tele - lens.maxAperture) * t;
}

export function clampFocal(lens: LensSpec, focalMm: number): number {
  return Math.min(lens.focalRange[1], Math.max(lens.focalRange[0], focalMm));
}

export function clampFocus(lens: LensSpec, distanceM: number): number {
  return Math.max(lens.minimumFocusDistanceM, distanceM);
}

/** Vignetting in stops at the corner for the current aperture: fades out ~2 stops down. */
export function vignettingStops(lens: LensSpec, focalMm: number, aperture: number): number {
  const wideOpen = maxApertureAt(lens, focalMm);
  const stopsDown = Math.max(0, 2 * Math.log2(aperture / wideOpen));
  const optical = lens.vignettingStopsWideOpen * Math.max(0, 1 - stopsDown / 2.5);
  // A small residual (natural cos^4-style) fall-off that never disappears.
  return Math.max(optical, 0.25 * lens.vignettingStopsWideOpen);
}

export function validateLens(l: LensSpec): string[] {
  const e: string[] = [];
  if (!l.id) e.push('lens without id');
  if (!(l.focalRange[0] > 0 && l.focalRange[1] >= l.focalRange[0])) e.push(`${l.id}: bad focalRange`);
  if (!(l.maxAperture > 0 && l.minAperture > l.maxAperture)) e.push(`${l.id}: bad aperture range`);
  if (l.maxApertureTele !== undefined && l.maxApertureTele < l.maxAperture)
    e.push(`${l.id}: maxApertureTele wider than maxAperture`);
  if (!(l.minimumFocusDistanceM > 0)) e.push(`${l.id}: bad minimumFocusDistanceM`);
  if (l.stabilizationStops < 0) e.push(`${l.id}: negative stabilizationStops`);
  return e;
}

export function validateBody(b: BodySpec): string[] {
  const e: string[] = [];
  const s = b.sensor;
  if (!b.id) e.push('body without id');
  if (!(s.widthMm > 0 && s.heightMm > 0)) e.push(`${b.id}: bad sensor size`);
  if (!(s.fullWellElectrons > 0 && s.readNoiseElectrons > 0)) e.push(`${b.id}: bad noise params`);
  if (!(b.isoRange[0] > 0 && b.isoRange[1] > b.isoRange[0])) e.push(`${b.id}: bad isoRange`);
  if (!(b.shutterRange[0] > 0 && b.shutterRange[1] > b.shutterRange[0])) e.push(`${b.id}: bad shutterRange`);
  return e;
}

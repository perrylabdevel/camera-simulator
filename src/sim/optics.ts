/**
 * Geometric optics for a thin-lens camera model.
 *
 * Sources:
 *  - Angle of view: α = 2·atan(d / 2f) (rectilinear lens focused at infinity).
 *  - Crop factor: ratio of the 36×24 mm diagonal (43.27 mm) to the sensor diagonal.
 *  - Circle of confusion limit: diagonal / 1442 (≈0.030 mm on full frame),
 *    the conventional value used by most DOF tables (a variant of the
 *    "Zeiss formula" d/1500).
 *  - Hyperfocal distance H = f²/(N·c) + f and near/far DOF limits:
 *      Dn = s(H − f)/(H + s − 2f),  Df = s(H − f)/(H − s)   (s < H, else ∞)
 *    (Ray, "Applied Photographic Optics", 3rd ed., §6; Wikipedia "Depth of field").
 *  - Blur-disc diameter of an object at distance S2 when focused at S1:
 *      c = A · |S2 − S1| / S2 · f / (S1 − f),   A = f / N
 *    (Wikipedia "Circle of confusion", derived from the thin-lens equation.)
 *  - Airy disk diameter to the first minimum: 2.44·λ·N.
 *
 * All lengths in millimetres unless the name says otherwise. Distances in the
 * public API are metres because that is what the world uses.
 */

export const FULL_FRAME_DIAGONAL_MM = Math.hypot(36, 24);
/** Mid-visible wavelength used for diffraction estimates (mm). */
export const GREEN_WAVELENGTH_MM = 550e-6;

export interface SensorGeometry {
  widthMm: number;
  heightMm: number;
}

export function sensorDiagonalMm(s: SensorGeometry): number {
  return Math.hypot(s.widthMm, s.heightMm);
}

export function cropFactor(s: SensorGeometry): number {
  return FULL_FRAME_DIAGONAL_MM / sensorDiagonalMm(s);
}

/** Full-frame-equivalent focal length. */
export function equivalentFocalLength(focalMm: number, s: SensorGeometry): number {
  return focalMm * cropFactor(s);
}

export function angleOfViewRad(focalMm: number, dimensionMm: number): number {
  return 2 * Math.atan(dimensionMm / (2 * focalMm));
}

export function verticalFovDeg(focalMm: number, s: SensorGeometry): number {
  return (angleOfViewRad(focalMm, s.heightMm) * 180) / Math.PI;
}

export function horizontalFovDeg(focalMm: number, s: SensorGeometry): number {
  return (angleOfViewRad(focalMm, s.widthMm) * 180) / Math.PI;
}

export function diagonalFovDeg(focalMm: number, s: SensorGeometry): number {
  return (angleOfViewRad(focalMm, sensorDiagonalMm(s)) * 180) / Math.PI;
}

/** Acceptable circle of confusion (mm) for a sensor, used for DOF limits. */
export function circleOfConfusionMm(s: SensorGeometry): number {
  return sensorDiagonalMm(s) / 1442;
}

export function hyperfocalDistanceM(focalMm: number, aperture: number, cocMm: number): number {
  return ((focalMm * focalMm) / (aperture * cocMm) + focalMm) / 1000;
}

export interface DepthOfField {
  nearM: number;
  /** Infinity when the focus distance is at or beyond the hyperfocal distance. */
  farM: number;
  totalM: number;
  hyperfocalM: number;
}

export function depthOfField(
  focalMm: number,
  aperture: number,
  focusDistanceM: number,
  cocMm: number,
): DepthOfField {
  const f = focalMm;
  const s = focusDistanceM * 1000;
  const H = hyperfocalDistanceM(focalMm, aperture, cocMm) * 1000;
  const near = (s * (H - f)) / (H + s - 2 * f);
  const far = s < H ? (s * (H - f)) / (H - s) : Infinity;
  return {
    nearM: near / 1000,
    farM: far / 1000,
    totalM: (far - near) / 1000,
    hyperfocalM: H / 1000,
  };
}

/**
 * Diameter (mm, on the sensor) of the defocus blur disc for a point at
 * `objectDistanceM` when the lens is focused at `focusDistanceM`.
 * Pass Infinity for an object at infinity.
 */
export function blurDiscMm(
  focalMm: number,
  aperture: number,
  focusDistanceM: number,
  objectDistanceM: number,
): number {
  const f = focalMm;
  const A = f / aperture;
  const s1 = focusDistanceM * 1000;
  const ratio = Number.isFinite(objectDistanceM)
    ? Math.abs(objectDistanceM * 1000 - s1) / (objectDistanceM * 1000)
    : 1;
  return (A * ratio * f) / (s1 - f);
}

/**
 * Coefficient k such that blur diameter (mm) = k · |1 − s1/s2| for any object
 * distance s2. Lets shaders evaluate the CoC with a single multiply-add:
 *   c(s2) = k · |s2 − s1| / s2.
 */
export function blurCoefficientMm(focalMm: number, aperture: number, focusDistanceM: number): number {
  const f = focalMm;
  return ((f / aperture) * f) / (focusDistanceM * 1000 - f);
}

export function airyDiskDiameterMm(aperture: number, wavelengthMm = GREEN_WAVELENGTH_MM): number {
  return 2.44 * wavelengthMm * aperture;
}

/** Lateral magnification of an object at distance s (thin lens). */
export function magnification(focalMm: number, objectDistanceM: number): number {
  return focalMm / (objectDistanceM * 1000 - focalMm);
}

/** Size in mm of a sensor-plane length expressed in output pixels. */
export function mmToPixels(mm: number, s: SensorGeometry, imageHeightPx: number): number {
  return (mm / s.heightMm) * imageHeightPx;
}

/**
 * Relative corner illumination (natural cos⁴ law) for a point at the sensor
 * corner. Used to derive the vignetting falloff of a rectilinear lens.
 */
export function cos4Falloff(focalMm: number, s: SensorGeometry): number {
  const halfDiag = sensorDiagonalMm(s) / 2;
  const theta = Math.atan(halfDiag / focalMm);
  return Math.cos(theta) ** 4;
}

/**
 * Handheld camera-shake model.
 *
 * Hand tremor is modelled as a smooth random rotation built from a sum of
 * sinusoids (slow sway + physiological tremor around 4–12 Hz). Its RMS angular
 * speed ω is calibrated against the classic reciprocal rule: at t = 1/f
 * (f in mm, full-frame) the blur on the sensor, f·ω·t = ω (mm), should be
 * about one circle of confusion (0.03 mm). That gives ω ≈ 0.03 rad/s.
 *
 * Stabilisation divides the angular speed by 2^stops. It only compensates
 * camera rotation — it cannot freeze a moving subject, which the rest of
 * the pipeline handles separately. A tripod removes shake entirely.
 */

import { mulberry32 } from './random';

/** RMS angular speed of an unsupported, careful photographer (rad/s). */
export const HANDHELD_ANGULAR_SPEED = 0.03;

export type Support = 'handheld' | 'tripod';

export function shakeAngularSpeed(support: Support, stabilizationStops: number): number {
  if (support === 'tripod') return 0;
  return HANDHELD_ANGULAR_SPEED / 2 ** Math.max(0, stabilizationStops);
}

/**
 * Expected shake blur length on the sensor (mm) for exposure time t.
 * For short exposures the motion is roughly linear (ω·t); for long ones it
 * saturates at the sway amplitude because hands oscillate rather than drift.
 */
export function expectedShakeBlurMm(focalMm: number, shutterS: number, angularSpeed: number): number {
  const swayAmplitudeRad = angularSpeed / (2 * Math.PI * 1.2); // dominated by the slowest component
  const angle = Math.min(angularSpeed * shutterS, 2.5 * swayAmplitudeRad);
  return focalMm * angle;
}

/** Rule-of-thumb slowest handheld shutter speed (reciprocal rule with stabilisation). */
export function slowestHandheldShutter(focalEquivalentMm: number, stabilizationStops: number): number {
  return (1 / focalEquivalentMm) * 2 ** stabilizationStops;
}

interface Component {
  freq: number;
  ampYaw: number;
  ampPitch: number;
  ampRoll: number;
  phaseYaw: number;
  phasePitch: number;
  phaseRoll: number;
}

/** Frequencies (Hz) and share of the angular-velocity energy for each component. */
const SPECTRUM: ReadonlyArray<[number, number]> = [
  [0.6, 0.35],
  [1.7, 0.45],
  [4.3, 0.55],
  [7.9, 0.5],
  [11.3, 0.35],
];

export interface ShakeSample {
  yaw: number;
  pitch: number;
  roll: number;
}

/**
 * Deterministic shake trajectory. Returns camera rotation offsets (radians)
 * as a function of time since the shutter opened.
 */
export function createShakeTrajectory(seed: number, angularSpeed: number): (t: number) => ShakeSample {
  const rand = mulberry32(seed);
  const norm = Math.sqrt(SPECTRUM.reduce((s, [, w]) => s + w * w, 0));
  const comps: Component[] = SPECTRUM.map(([freq, w]) => {
    // Per-axis RMS velocity = ω/√2; a·2πf/√2 per component → a = w·ω/(2πf).
    const a = ((w / norm) * angularSpeed) / (2 * Math.PI * freq);
    const jitter = () => 0.8 + 0.4 * rand();
    return {
      freq: freq * jitter(),
      ampYaw: a,
      ampPitch: a,
      ampRoll: a * 0.3,
      phaseYaw: rand() * Math.PI * 2,
      phasePitch: rand() * Math.PI * 2,
      phaseRoll: rand() * Math.PI * 2,
    };
  });
  return (t: number) => {
    let yaw = 0;
    let pitch = 0;
    let roll = 0;
    for (const c of comps) {
      const w = 2 * Math.PI * c.freq * t;
      // Subtract the value at t=0 so the frame starts where the photographer aimed.
      yaw += c.ampYaw * (Math.sin(w + c.phaseYaw) - Math.sin(c.phaseYaw));
      pitch += c.ampPitch * (Math.sin(w + c.phasePitch) - Math.sin(c.phasePitch));
      roll += c.ampRoll * (Math.sin(w + c.phaseRoll) - Math.sin(c.phaseRoll));
    }
    return { yaw, pitch, roll };
  };
}

/**
 * Deterministic photo critique. The simulator knows the true subject
 * distances, speeds, focus distance, exposure and shake, so it can explain
 * cause and effect without any AI. Every note says what happened, why, and
 * what would change it.
 */

import { classifyBlur, shutterToFreeze } from './motion';
import { formatAperture, formatShutterLong, formatDistance } from './stops';

export interface SubjectFacts {
  name: string;
  inFrame: boolean;
  /** Distance along the optical axis (m). */
  distanceM: number;
  /** Speed perpendicular to the line of sight (m/s). */
  lateralSpeedMps: number;
  /** Measured image-plane movement during the exposure (px). */
  motionBlurPx: number;
  /** Defocus blur diameter (px). */
  defocusBlurPx: number;
}

export interface ShotFacts {
  aperture: number;
  shutterS: number;
  iso: number;
  focalMm: number;
  focusDistanceM: number;
  dofNearM: number;
  dofFarM: number;
  /** Exposure relative to the meter in stops (+ = brighter). */
  meterOffsetStops: number;
  exposureCompensation: number;
  highlightClipFraction: number;
  shadowClipFraction: number;
  /** Acceptable blur in output px (circle of confusion). */
  sharpPx: number;
  shakeBlurPx: number;
  stabilizationStops: number;
  tripod: boolean;
  /** Mid-tone signal-to-noise ratio. */
  midtoneSnr: number;
  /** Name of what the AF point landed on, if known. */
  focusTarget?: string;
  subjects: SubjectFacts[];
  /** Output-pixel size in mm on the sensor (for converting blur limits). */
  pxPerMm: number;
}

export type NoteLevel = 'good' | 'warn' | 'info';
export type NoteTopic = 'exposure' | 'focus' | 'motion' | 'shake' | 'noise';

export interface Note {
  level: NoteLevel;
  topic: NoteTopic;
  text: string;
}

const pct = (f: number) => `${(f * 100).toFixed(f < 0.01 ? 1 : 0)}%`;

export function critique(f: ShotFacts): Note[] {
  const notes: Note[] = [];

  // --- Exposure ---------------------------------------------------------
  const off = f.meterOffsetStops + f.exposureCompensation; // relative to the plain meter reading
  const intent = f.exposureCompensation !== 0 ? ` (you dialled ${f.exposureCompensation > 0 ? '+' : ''}${f.exposureCompensation.toFixed(1)} EV of compensation)` : '';
  if (f.highlightClipFraction > 0.02) {
    notes.push({
      level: 'warn',
      topic: 'exposure',
      text: `${pct(f.highlightClipFraction)} of the frame is clipped to pure white — the sensor was full there and no detail was recorded. Exposure was ${fmtStops(off)} relative to the meter${intent}. A faster shutter, smaller aperture or lower ISO would protect those highlights.`,
    });
  } else if (f.shadowClipFraction > 0.08) {
    notes.push({
      level: 'warn',
      topic: 'exposure',
      text: `${pct(f.shadowClipFraction)} of the frame is crushed to black. Exposure was ${fmtStops(off)} relative to the meter${intent}. More light (slower shutter, wider aperture) records shadow detail; raising ISO only amplifies what was captured.`,
    });
  } else if (Math.abs(off) <= 0.7) {
    notes.push({
      level: 'good',
      topic: 'exposure',
      text: `Exposure is within ${Math.abs(off) < 0.2 ? 'a fraction of a stop' : fmtStops(off)} of the meter and highlights are intact${f.highlightClipFraction > 0.001 ? ' apart from tiny specular points' : ''}.`,
    });
  } else {
    notes.push({
      level: 'info',
      topic: 'exposure',
      text: `The image is ${fmtStops(off)} ${off > 0 ? 'brighter' : 'darker'} than the meter suggests${intent}. That can be a creative choice — check the histogram.`,
    });
  }

  // --- Focus --------------------------------------------------------------
  const main = f.subjects.filter((s) => s.inFrame).sort((a, b) => a.distanceM - b.distanceM);
  for (const s of main) {
    const ratio = s.defocusBlurPx / f.sharpPx;
    if (ratio <= 1) {
      notes.push({
        level: 'good',
        topic: 'focus',
        text: `The ${s.name} (${formatDistance(s.distanceM)}) is inside the depth of field (${formatDistance(f.dofNearM)} – ${formatDistance(f.dofFarM)} at ${formatAperture(f.aperture)}).`,
      });
    } else {
      const where = s.distanceM < f.focusDistanceM ? 'behind' : 'in front of';
      const severity = ratio > 6 ? 'clearly out of focus' : 'slightly soft';
      notes.push({
        level: ratio > 6 ? 'warn' : 'info',
        topic: 'focus',
        text: `The ${s.name} is ${severity}: focus was at ${formatDistance(f.focusDistanceM)}, ${where} the ${s.name} at ${formatDistance(s.distanceM)}. The sharp zone at ${formatAperture(f.aperture)} and ${Math.round(f.focalMm)}mm only spans ${formatDistance(f.dofNearM)} – ${formatDistance(f.dofFarM)}.${f.focusTarget ? ` The AF point was on the ${f.focusTarget}.` : ''}`,
      });
    }
  }

  // --- Subject motion -----------------------------------------------------
  for (const s of main) {
    if (s.lateralSpeedMps < 0.2) continue;
    const cls = classifyBlur(s.motionBlurPx, f.sharpPx);
    const freeze = shutterToFreeze(s.lateralSpeedMps, s.distanceM, f.focalMm, f.sharpPx / f.pxPerMm);
    const moved = `moved about ${Math.round(s.motionBlurPx)} px across the frame during the ${formatShutterLong(f.shutterS)} exposure`;
    if (cls === 'frozen') {
      notes.push({ level: 'good', topic: 'motion', text: `The ${s.name}'s motion is frozen — it ${moved.replace('moved about', 'moved only about')}.` });
    } else {
      notes.push({
        level: cls === 'slight' ? 'info' : 'warn',
        topic: 'motion',
        text: `The ${s.name} ${moved}, so it is ${cls === 'slight' ? 'slightly' : cls === 'blurred' ? 'visibly' : 'heavily'} blurred. About ${formatShutterLong(nearestNiceShutter(freeze))} or faster would freeze it${f.stabilizationStops > 0 || f.tripod ? ' — stabilisation and tripods steady the camera, not the subject' : ''}.`,
      });
    }
  }

  // --- Camera shake -------------------------------------------------------
  if (!f.tripod) {
    const cls = classifyBlur(f.shakeBlurPx, f.sharpPx);
    if (cls !== 'frozen') {
      notes.push({
        level: cls === 'slight' ? 'info' : 'warn',
        topic: 'shake',
        text: `Hand-held camera shake smeared the whole frame by ~${Math.round(f.shakeBlurPx)} px at ${formatShutterLong(f.shutterS)} and ${Math.round(f.focalMm)}mm${f.stabilizationStops > 0 ? ` even with ${f.stabilizationStops} stops of stabilisation` : ' (stabilisation off)'}. A faster shutter, stabilisation or a tripod would fix it.`,
      });
    }
  }

  // --- Noise --------------------------------------------------------------
  if (f.midtoneSnr < 12) {
    notes.push({
      level: f.midtoneSnr < 7 ? 'warn' : 'info',
      topic: 'noise',
      text: `At ISO ${Math.round(f.iso)} the sensor had few photons to work with, so noise is ${f.midtoneSnr < 7 ? 'strong' : 'visible'} (mid-tone SNR ≈ ${f.midtoneSnr.toFixed(0)}:1). ISO amplifies the signal; it does not add light.`,
    });
  } else if (f.iso >= 1600) {
    notes.push({ level: 'info', topic: 'noise', text: `ISO ${Math.round(f.iso)} adds some grain in the shadows, but mid-tones stay clean (SNR ≈ ${f.midtoneSnr.toFixed(0)}:1).` });
  }

  return notes;
}

function fmtStops(s: number): string {
  const r = Math.round(s * 3) / 3;
  const sign = r > 0 ? '+' : r < 0 ? '−' : '±';
  return `${sign}${Math.abs(r).toFixed(1)} EV`;
}

const NICE = [1 / 8000, 1 / 4000, 1 / 2000, 1 / 1000, 1 / 500, 1 / 250, 1 / 125, 1 / 60, 1 / 30, 1 / 15, 1 / 8, 1 / 4, 1 / 2, 1];
function nearestNiceShutter(t: number): number {
  // Largest "nice" shutter time that still freezes (≤ t).
  let best = NICE[0];
  for (const n of NICE) if (n <= t * 1.05) best = n;
  return best;
}

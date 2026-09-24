/**
 * Automatic exposure modes. Pure functions: given the meter's target and
 * the photographer's chosen values, decide the remaining settings exactly
 * as a camera would, in 1/3-stop steps within the equipment's limits.
 *
 *   M  – photographer sets everything (Auto ISO may still pick the ISO)
 *   A  – photographer sets the aperture, camera picks the shutter (Av)
 *   S  – photographer sets the shutter, camera picks the aperture (Tv)
 *   P  – camera picks both along a program line
 *
 * Auto ISO keeps the shutter at or faster than a minimum (default 1/focal,
 * the reciprocal rule) by raising ISO, up to a maximum ISO.
 *
 * APEX relation used throughout: log2(N²) + log2(1/t) = EV100 + log2(S/100).
 */

import type { StopValue } from './stops';

export type ExposureMode = 'M' | 'A' | 'S' | 'P';

export interface AutoExposureInput {
  mode: ExposureMode;
  /** EV100 the camera should hit: meter reading minus exposure compensation. */
  targetEv100: number;
  /** Photographer's current nominal choices. */
  apertureNominal: number;
  shutterNominal: number;
  isoNominal: number;
  autoIso: boolean;
  autoIsoMax: number;
  /** Slowest shutter Auto ISO will accept before raising ISO (s). */
  autoIsoMinShutter: number;
  apertures: StopValue[];
  /** Sorted slow → fast. */
  shutters: StopValue[];
  isos: StopValue[];
}

export interface AutoExposureResult {
  apertureNominal: number;
  shutterNominal: number;
  isoNominal: number;
  /** Remaining error in stops after clamping (+ = image will be brighter than target). */
  errorStops: number;
  /** Which limit was hit, if the target could not be reached. */
  limited: 'too-bright' | 'too-dark' | null;
}

const log2 = Math.log2;

function nearest(scale: StopValue[], value: number): StopValue {
  let best = scale[0];
  let d = Infinity;
  for (const s of scale) {
    const e = Math.abs(log2(s.value / value));
    if (e < d) {
      d = e;
      best = s;
    }
  }
  return best;
}

function byNominal(scale: StopValue[], nominal: number): StopValue {
  let best = scale[0];
  let d = Infinity;
  for (const s of scale) {
    const e = Math.abs(log2(s.nominal / nominal));
    if (e < d) {
      d = e;
      best = s;
    }
  }
  return best;
}

/** Brightness error in stops for exact values (+ = brighter than target). */
function errorOf(ev: number, N: number, t: number, iso: number): number {
  return ev + log2(iso / 100) - log2((N * N) / t);
}

export function solveExposure(inp: AutoExposureInput): AutoExposureResult {
  const { apertures, shutters, isos, targetEv100: ev } = inp;
  const minIso = isos[0].value;
  const maxAutoIso = byNominal(isos, inp.autoIsoMax).value;
  let N = byNominal(apertures, inp.apertureNominal).value;
  let t = byNominal(shutters, inp.shutterNominal).value;
  let iso = byNominal(isos, inp.isoNominal).value;
  const tMin = shutters[shutters.length - 1].value; // fastest
  const tMax = shutters[0].value; // slowest
  const nMin = apertures[0].value;
  const nMax = apertures[apertures.length - 1].value;
  const clampT = (x: number) => Math.min(tMax, Math.max(tMin, x));
  const clampN = (x: number) => Math.min(nMax, Math.max(nMin, x));
  const clampIso = (x: number, hi: number) => Math.min(hi, Math.max(minIso, x));
  const tFor = (n: number, s: number) => (n * n) / 2 ** (ev + log2(s / 100));
  const nFor = (tt: number, s: number) => Math.sqrt(tt * 2 ** (ev + log2(s / 100)));
  const isoFor = (n: number, tt: number) => 100 * 2 ** (log2((n * n) / tt) - ev);

  if (inp.autoIso) iso = minIso;

  switch (inp.mode) {
    case 'M':
      if (inp.autoIso) iso = clampIso(isoFor(N, t), maxAutoIso);
      break;
    case 'A': {
      t = tFor(N, iso);
      if (inp.autoIso && t > inp.autoIsoMinShutter) {
        iso = clampIso(isoFor(N, inp.autoIsoMinShutter), maxAutoIso);
        t = tFor(N, iso);
      }
      t = clampT(t);
      break;
    }
    case 'S': {
      N = nFor(t, iso);
      if (inp.autoIso && N < nMin) {
        iso = clampIso(isoFor(nMin, t), maxAutoIso);
        N = nFor(t, iso);
      }
      N = clampN(N);
      break;
    }
    case 'P': {
      // Program line: wide open until the shutter reaches the handheld limit,
      // then split additional light equally between aperture and shutter.
      const handheld = inp.autoIsoMinShutter;
      const evIso = ev + log2(iso / 100);
      const avWide = log2(nMin * nMin);
      const tvHand = log2(1 / handheld);
      if (evIso <= avWide + tvHand) {
        N = nMin;
        t = tFor(N, iso);
        if (inp.autoIso && t > handheld) {
          iso = clampIso(isoFor(N, handheld), maxAutoIso);
          t = tFor(N, iso);
        }
      } else {
        const excess = evIso - (avWide + tvHand);
        N = clampN(Math.sqrt(2 ** (avWide + excess / 2)));
        t = tFor(N, iso);
      }
      t = clampT(t);
      N = clampN(N);
      break;
    }
  }

  // Snap to the camera's 1/3-stop scales.
  const sN = inp.mode === 'S' || inp.mode === 'P' ? nearest(apertures, N) : byNominal(apertures, inp.apertureNominal);
  const sT = inp.mode === 'A' || inp.mode === 'P' ? nearest(shutters, t) : byNominal(shutters, inp.shutterNominal);
  const sIso = inp.autoIso ? nearest(isos, iso) : byNominal(isos, inp.isoNominal);
  const err = errorOf(ev, sN.value, sT.value, sIso.value);
  const limited = Math.abs(err) > 0.34 && inp.mode !== 'M' ? (err > 0 ? 'too-bright' : 'too-dark') : inp.mode === 'M' && inp.autoIso && Math.abs(err) > 0.34 ? (err > 0 ? 'too-bright' : 'too-dark') : null;
  return { apertureNominal: sN.nominal, shutterNominal: sT.nominal, isoNominal: sIso.nominal, errorStops: err, limited };
}

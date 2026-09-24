import { describe, expect, it } from 'vitest';
import bodies from '../src/data/bodies.json';
import lenses from '../src/data/lenses.json';
import type { BodySpec, LensSpec } from '../src/sim/equipment';
import { availableApertures, availableIsos, availableShutters } from '../src/sim/camera';
import { solveExposure, type AutoExposureInput } from '../src/sim/modes';
import { settingsEv100 } from '../src/sim/exposure';
import { nearestStop, APERTURES, SHUTTER_SPEEDS, ISOS } from '../src/sim/stops';

const body = (bodies as BodySpec[])[0];
const lens = (lenses as LensSpec[]).find((l) => l.id === '50-f1.8')!;
const base: AutoExposureInput = {
  mode: 'A',
  targetEv100: 14,
  apertureNominal: 8,
  shutterNominal: 1 / 125,
  isoNominal: 100,
  autoIso: false,
  autoIsoMax: 12800,
  autoIsoMinShutter: 1 / 50,
  apertures: availableApertures(lens, 50),
  shutters: availableShutters(body),
  isos: availableIsos(body),
};

const evOf = (r: { apertureNominal: number; shutterNominal: number; isoNominal: number }) =>
  settingsEv100({
    aperture: nearestStop(APERTURES, r.apertureNominal).value,
    shutter: nearestStop(SHUTTER_SPEEDS, r.shutterNominal).value,
    iso: nearestStop(ISOS, r.isoNominal).value,
  });

describe('exposure modes', () => {
  it('A keeps the aperture and picks the shutter', () => {
    const r = solveExposure(base);
    expect(r.apertureNominal).toBe(8);
    expect(Math.abs(evOf(r) - 14)).toBeLessThan(0.17);
    expect(r.limited).toBeNull();
  });

  it('S keeps the shutter and picks the aperture', () => {
    const r = solveExposure({ ...base, mode: 'S', shutterNominal: 1 / 500 });
    expect(r.shutterNominal).toBeCloseTo(1 / 500, 10);
    expect(Math.abs(evOf(r) - 14)).toBeLessThan(0.17);
  });

  it('S reports when the lens cannot stop down far enough', () => {
    const r = solveExposure({ ...base, mode: 'S', shutterNominal: 1 / 4, targetEv100: 15 });
    expect(r.apertureNominal).toBe(22);
    expect(r.limited).toBe('too-bright');
  });

  it('P opens up in dim light and stops down in bright light', () => {
    const dim = solveExposure({ ...base, mode: 'P', targetEv100: 7 });
    const bright = solveExposure({ ...base, mode: 'P', targetEv100: 15 });
    expect(dim.apertureNominal).toBe(1.8);
    expect(bright.apertureNominal).toBeGreaterThan(4);
    expect(Math.abs(evOf(bright) - 15)).toBeLessThan(0.17);
  });

  it('Auto ISO raises ISO rather than letting the shutter drop below the minimum', () => {
    const r = solveExposure({ ...base, targetEv100: 6, autoIso: true, apertureNominal: 2.8 });
    const t = nearestStop(SHUTTER_SPEEDS, r.shutterNominal).value;
    expect(t).toBeLessThanOrEqual(1 / 50 * 1.13);
    expect(r.isoNominal).toBeGreaterThan(100);
    expect(Math.abs(evOf(r) - 6)).toBeLessThan(0.17);
  });

  it('Auto ISO stays at base ISO in bright light', () => {
    expect(solveExposure({ ...base, autoIso: true }).isoNominal).toBe(100);
  });

  it('M with Auto ISO picks the ISO for the chosen aperture and shutter', () => {
    const r = solveExposure({ ...base, mode: 'M', autoIso: true, apertureNominal: 4, shutterNominal: 1 / 1000, targetEv100: 11 });
    expect(r.apertureNominal).toBe(4);
    expect(Math.abs(evOf(r) - 11)).toBeLessThan(0.17);
  });

  it('M without Auto ISO changes nothing', () => {
    const r = solveExposure({ ...base, mode: 'M' });
    expect([r.apertureNominal, r.isoNominal]).toEqual([8, 100]);
    expect(r.shutterNominal).toBeCloseTo(1 / 125, 10);
  });
});

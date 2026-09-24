import { describe, expect, it } from 'vitest';
import bodies from '../src/data/bodies.json';
import type { BodySpec } from '../src/sim/equipment';
import { dynamicRangeStops, fullScaleElectrons, noiseSigma, pixelPitchUm, snr } from '../src/sim/sensor';
import { METERED_MIDTONE_SIGNAL } from '../src/sim/exposure';

const body = (bodies as BodySpec[])[0];
const sensor = body.sensor;

describe('sensor model', () => {
  it('base ISO uses the whole full well', () => {
    expect(fullScaleElectrons(sensor, 100)).toBe(sensor.fullWellElectrons);
    expect(fullScaleElectrons(sensor, 400)).toBe(sensor.fullWellElectrons / 4);
  });

  it('noise rises with ISO at the same output level', () => {
    const isos = [100, 400, 1600, 6400, 25600];
    const snrs = isos.map((iso) => snr(sensor, iso, METERED_MIDTONE_SIGNAL));
    for (let i = 1; i < snrs.length; i++) expect(snrs[i]).toBeLessThan(snrs[i - 1]);
    // Mid-tone SNR is excellent at base ISO and poor at the top of the range.
    expect(snrs[0]).toBeGreaterThan(50);
    expect(snrs[snrs.length - 1]).toBeLessThan(6);
  });

  it('is shot-noise limited in highlights: SNR ≈ sqrt(electrons)', () => {
    const e = fullScaleElectrons(sensor, 100) * 0.5;
    expect(snr(sensor, 100, 0.5)).toBeCloseTo(Math.sqrt(e), -1);
  });

  it('dynamic range drops about one stop per ISO doubling', () => {
    const dr100 = dynamicRangeStops(sensor, 100);
    const dr200 = dynamicRangeStops(sensor, 200);
    expect(dr100).toBeGreaterThan(13);
    expect(dr100 - dr200).toBeCloseTo(1, 6);
  });

  it('noise floor at zero signal equals read noise', () => {
    expect(noiseSigma(sensor, 100, 0) * fullScaleElectrons(sensor, 100)).toBeCloseTo(sensor.readNoiseElectrons, 10);
  });

  it('24 MP full frame has ~6 µm pixels', () => {
    expect(pixelPitchUm(sensor)).toBeCloseTo(6.0, 1);
  });
});

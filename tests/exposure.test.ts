import { describe, expect, it } from 'vitest';
import {
  METERED_MIDTONE_SIGNAL,
  apertureForEv,
  isoForEv,
  meterOffsetStops,
  meteredEv100,
  saturationLuminance,
  sensorExposureScale,
  settingsEv100,
  shutterForEv,
} from '../src/sim/exposure';

describe('exposure value', () => {
  it('f/1 at 1 s ISO 100 is EV 0', () => {
    expect(settingsEv100({ aperture: 1, shutter: 1, iso: 100 })).toBeCloseTo(0, 10);
  });

  it('each doubling of N² / t adds one stop', () => {
    const a = settingsEv100({ aperture: 2, shutter: 1, iso: 100 });
    const b = settingsEv100({ aperture: 2, shutter: 0.5, iso: 100 });
    expect(a).toBeCloseTo(2, 10);
    expect(b - a).toBeCloseTo(1, 10);
  });

  it('raising ISO one stop lowers EV100 one stop (needs less light)', () => {
    const a = settingsEv100({ aperture: 8, shutter: 1 / 125, iso: 100 });
    const b = settingsEv100({ aperture: 8, shutter: 1 / 125, iso: 200 });
    expect(a - b).toBeCloseTo(1, 10);
  });

  it('equivalent exposures (reciprocity) give identical EV', () => {
    const a = settingsEv100({ aperture: 4, shutter: 1 / 500, iso: 400 });
    const b = settingsEv100({ aperture: 8, shutter: 1 / 125, iso: 400 });
    expect(a).toBeCloseTo(b, 10);
  });
});

describe('reflected-light meter', () => {
  it('uses K = 12.5: 0.125 cd/m² meters EV100 = 0, 16 cd/m² meters EV100 = 7', () => {
    expect(meteredEv100(0.125)).toBeCloseTo(0, 10);
    expect(meteredEv100(16)).toBeCloseTo(7, 10);
  });

  it('agrees with the sunny-16 rule for a sunlit mid-grey scene', () => {
    // ~3500 cd/m²: 18% grey card under ~60 000 lux of sun + sky.
    const ev = meteredEv100(3500);
    const sunny16 = settingsEv100({ aperture: 16, shutter: 1 / 100, iso: 100 });
    expect(Math.abs(ev - sunny16)).toBeLessThan(0.4);
  });

  it('reports zero offset when settings match the meter, and sign follows brightness', () => {
    const L = 3000;
    const ev = meteredEv100(L);
    const shutter = shutterForEv(ev, 8, 100);
    expect(meterOffsetStops({ aperture: 8, shutter, iso: 100 }, L)).toBeCloseTo(0, 8);
    expect(meterOffsetStops({ aperture: 8, shutter: shutter * 2, iso: 100 }, L)).toBeCloseTo(1, 8);
    expect(meterOffsetStops({ aperture: 8, shutter, iso: 100 }, L, 1)).toBeCloseTo(-1, 8);
  });

  it('solver helpers invert settingsEv100', () => {
    const ev = 11.3;
    expect(settingsEv100({ aperture: apertureForEv(ev, 1 / 60, 200), shutter: 1 / 60, iso: 200 })).toBeCloseTo(ev, 8);
    expect(settingsEv100({ aperture: 5.6, shutter: 1 / 60, iso: isoForEv(ev, 5.6, 1 / 60) })).toBeCloseTo(ev, 8);
  });
});

describe('sensor exposure', () => {
  it('saturation luminance is 1.2 · 2^EV100', () => {
    const s = { aperture: 2.8, shutter: 1 / 250, iso: 400 };
    expect(saturationLuminance(s)).toBeCloseTo(1.2 * 2 ** settingsEv100(s), 6);
  });

  it('a metered scene lands ~3.3 stops below clipping', () => {
    const L = 800;
    const s = { aperture: 4, shutter: shutterForEv(meteredEv100(L), 4, 100), iso: 100 };
    const signal = L * sensorExposureScale(s);
    expect(signal).toBeCloseTo(METERED_MIDTONE_SIGNAL, 6);
    expect(Math.log2(1 / signal)).toBeCloseTo(3.26, 1);
  });

  it('doubling shutter time doubles the sensor signal', () => {
    const a = sensorExposureScale({ aperture: 4, shutter: 1 / 100, iso: 100 });
    const b = sensorExposureScale({ aperture: 4, shutter: 1 / 50, iso: 100 });
    expect(b / a).toBeCloseTo(2, 10);
  });
});

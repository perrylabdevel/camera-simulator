import { describe, expect, it } from 'vitest';
import { autoWhiteBalance, castMired, estimateKelvin, illuminantRgb, planckianXy, sceneWhiteRgb, whiteBalanceGains } from '../src/sim/whiteBalance';

describe('white balance', () => {
  it('Planckian locus matches reference chromaticities', () => {
    // CIE 1931 values for blackbodies: 2856 K (illuminant A) ≈ (0.4476, 0.4074); 6500 K ≈ (0.3135, 0.3237)
    const a = planckianXy(2856);
    expect(a[0]).toBeCloseTo(0.4476, 2);
    expect(a[1]).toBeCloseTo(0.4074, 2);
    const d = planckianXy(6500);
    expect(d[0]).toBeCloseTo(0.3135, 2);
    expect(d[1]).toBeCloseTo(0.3237, 2);
  });

  it('~6500 K is close to neutral in sRGB; low K is orange, high K blue', () => {
    const n = illuminantRgb(6500);
    expect(Math.abs(n[0] - 1)).toBeLessThan(0.1);
    expect(Math.abs(n[2] - 1)).toBeLessThan(0.1);
    expect(whiteBalanceGains(6504)).toEqual([1, 1, 1]);
    const warm = illuminantRgb(3200);
    expect(warm[0]).toBeGreaterThan(1.3);
    expect(warm[2]).toBeLessThan(0.6);
    const cool = illuminantRgb(9000);
    expect(cool[2]).toBeGreaterThan(cool[0]);
  });

  it('gains neutralise the illuminant (relative to the D65 white)', () => {
    const w = illuminantRgb(6504);
    for (const k of [3000, 4500, 5500, 7500]) {
      const rgb = illuminantRgb(k);
      const g = whiteBalanceGains(k);
      expect((rgb[0] * g[0]) / w[0]).toBeCloseTo(1, 6);
      expect((rgb[2] * g[2]) / w[2]).toBeCloseTo(1, 6);
    }
  });

  it('estimates the temperature of a neutral scene lit by known light', () => {
    for (const k of [3200, 5200, 7500]) expect(Math.abs(estimateKelvin(sceneWhiteRgb(k)) - k)).toBeLessThan(120);
  });

  it('cast sign: tungsten WB in daylight renders blue (negative mired)', () => {
    expect(castMired(5500, 3200)).toBeLessThan(-100);
    expect(castMired(3200, 5500)).toBeGreaterThan(100);
  });
});

describe('auto white balance', () => {
  const scene = (kelvin: number) => {
    // Grass (green, warm), a grey path and a white wall, all lit by `kelvin`.
    const light = sceneWhiteRgb(kelvin);
    const albedos = [
      [0.08, 0.14, 0.04],
      [0.08, 0.14, 0.04],
      [0.08, 0.14, 0.04],
      [0.3, 0.3, 0.3],
      [0.8, 0.8, 0.8],
    ];
    return albedos.flatMap((a) => a.map((v, i) => v * light[i]));
  };
  it('ignores green grass and finds the light from neutral surfaces', () => {
    for (const k of [3500, 5500, 7500]) expect(Math.abs(autoWhiteBalance(scene(k)) - k)).toBeLessThan(200);
  });
  it('falls back to daylight when nothing is neutral', () => {
    expect(autoWhiteBalance([0.08, 0.14, 0.04, 0.1, 0.2, 0.05])).toBe(5500);
  });
});

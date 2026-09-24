import { describe, expect, it } from 'vitest';
import { APERTURES, ISOS, SHUTTER_SPEEDS, formatAperture, formatShutter, nearestStop } from '../src/sim/stops';

describe('stop scales', () => {
  it('nominal values stay within 7% of the exact geometric sequence', () => {
    for (const scale of [APERTURES, SHUTTER_SPEEDS, ISOS]) {
      for (const s of scale) expect(Math.abs(s.nominal / s.value - 1)).toBeLessThan(0.07);
    }
  });

  it('adjacent entries are 1/3 stop apart in exposure', () => {
    for (let i = 1; i < APERTURES.length; i++) {
      expect(2 * Math.log2(APERTURES[i].value / APERTURES[i - 1].value)).toBeCloseTo(1 / 3, 10);
    }
    for (let i = 1; i < SHUTTER_SPEEDS.length; i++) {
      expect(Math.log2(SHUTTER_SPEEDS[i - 1].value / SHUTTER_SPEEDS[i].value)).toBeCloseTo(1 / 3, 10);
    }
  });

  it('covers the required ranges', () => {
    expect(nearestStop(APERTURES, 1.2).nominal).toBe(1.2);
    expect(nearestStop(APERTURES, 22).nominal).toBe(22);
    expect(nearestStop(SHUTTER_SPEEDS, 30).nominal).toBe(30);
    expect(nearestStop(SHUTTER_SPEEDS, 1 / 8000).nominal).toBeCloseTo(1 / 8000, 12);
    expect(nearestStop(ISOS, 25600).nominal).toBe(25600);
  });

  it('formats like a camera display', () => {
    expect(formatAperture(1.4)).toBe('f/1.4');
    expect(formatAperture(8)).toBe('f/8');
    expect(formatAperture(11)).toBe('f/11');
    expect(formatShutter(1 / 125)).toBe('1/125');
    expect(formatShutter(1 / 4)).toBe('1/4');
    expect(formatShutter(0.5)).toBe('0.5"');
    expect(formatShutter(30)).toBe('30"');
  });
});

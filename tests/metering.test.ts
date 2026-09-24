import { describe, expect, it } from 'vitest';
import { meterLuminance, type LuminanceGrid } from '../src/sim/metering';

function grid(fn: (x: number, yTop: number) => number, W = 48, H = 32): LuminanceGrid {
  const values = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) values[y * W + x] = fn((x + 0.5) / W, 1 - (y + 0.5) / H);
  return { width: W, height: H, values };
}

describe('metering', () => {
  it('a uniform scene meters the same in every mode', () => {
    const g = grid(() => 1000);
    for (const m of ['evaluative', 'center', 'spot'] as const) {
      expect(meterLuminance(g, m, { x: 0.5, y: 0.5 })).toBeCloseTo(1000, 6);
    }
  });

  it('spot metering follows the AF point', () => {
    const g = grid((x) => (x < 0.5 ? 100 : 5000));
    expect(meterLuminance(g, 'spot', { x: 0.2, y: 0.5 })).toBeCloseTo(100, 6);
    expect(meterLuminance(g, 'spot', { x: 0.8, y: 0.5 })).toBeCloseTo(5000, 6);
  });

  it('centre-weighted favours the middle of the frame', () => {
    const g = grid((x, y) => (Math.hypot((x - 0.5) * 1.5, y - 0.5) < 0.17 ? 100 : 1000));
    const v = meterLuminance(g, 'center', { x: 0.5, y: 0.5 });
    expect(v).toBeCloseTo(0.75 * 100 + 0.25 * 1000, -1);
  });

  it('evaluative is not swung by a tiny very bright region', () => {
    const g = grid((x, y) => (x > 0.9 && y < 0.1 ? 1e6 : 1000));
    const v = meterLuminance(g, 'evaluative', { x: 0.5, y: 0.5 });
    expect(v).toBeLessThan(1300);
    const naive = grid((x, y) => (x > 0.9 && y < 0.1 ? 1e6 : 1000));
    let mean = 0;
    for (let i = 0; i < naive.values.length; i++) mean += naive.values[i];
    expect(mean / naive.values.length).toBeGreaterThan(5000);
  });
});

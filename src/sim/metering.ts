/**
 * Light-meter patterns operating on a coarse luminance grid (cd/m²).
 *
 *  - centre-weighted: 75 % of the weight in a central circle of ~1/3 frame
 *    height diameter, 25 % spread over the rest (the classic definition).
 *  - spot: mean of a ~3.5 % area circle around the active AF point.
 *  - evaluative: the frame is split into 8 × 6 zones; zone means are
 *    limited to 4× the median zone (so a sliver of sun or sky cannot swing
 *    the reading), the AF-point zone and the centre get extra weight.
 *    Real multi-zone meters use proprietary scene databases; this heuristic
 *    only aims to behave sensibly and predictably.
 */

import type { MeteringMode } from './camera';

export interface LuminanceGrid {
  width: number;
  height: number;
  /** Row-major, row 0 = bottom of the frame (GL convention). */
  values: ArrayLike<number>;
}

export function meterLuminance(grid: LuminanceGrid, mode: MeteringMode, af: { x: number; y: number }): number {
  const { width: W, height: H, values } = grid;
  const aspect = W / H;
  const at = (x: number, y: number) => values[y * W + x];
  // Normalised coordinates with origin top-left (UI convention).
  const cx = (x: number) => (x + 0.5) / W;
  const cy = (y: number) => 1 - (y + 0.5) / H;

  if (mode === 'spot') {
    const r = Math.sqrt(0.035 / Math.PI);
    let sum = 0;
    let n = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const dx = (cx(x) - af.x) * aspect;
        const dy = cy(y) - af.y;
        if (Math.hypot(dx, dy) <= r) {
          sum += at(x, y);
          n++;
        }
      }
    if (n > 0) return sum / n;
    // Fall back to the nearest cell.
    const x = Math.min(W - 1, Math.max(0, Math.floor(af.x * W)));
    const y = Math.min(H - 1, Math.max(0, Math.floor((1 - af.y) * H)));
    return at(x, y);
  }

  if (mode === 'center') {
    let inner = 0;
    let ni = 0;
    let outer = 0;
    let no = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const d = Math.hypot((cx(x) - 0.5) * aspect, cy(y) - 0.5);
        if (d < 0.17) {
          inner += at(x, y);
          ni++;
        } else {
          outer += at(x, y);
          no++;
        }
      }
    return 0.75 * (inner / Math.max(1, ni)) + 0.25 * (outer / Math.max(1, no));
  }

  // Evaluative.
  const ZX = 8;
  const ZY = 6;
  const zones: { v: number; x: number; y: number }[] = [];
  for (let zy = 0; zy < ZY; zy++)
    for (let zx = 0; zx < ZX; zx++) {
      let sum = 0;
      let n = 0;
      const x0 = Math.floor((zx * W) / ZX);
      const x1 = Math.floor(((zx + 1) * W) / ZX);
      const y0 = Math.floor((zy * H) / ZY);
      const y1 = Math.floor(((zy + 1) * H) / ZY);
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          sum += at(x, y);
          n++;
        }
      zones.push({ v: sum / Math.max(1, n), x: (zx + 0.5) / ZX, y: 1 - (zy + 0.5) / ZY });
    }
  const sorted = zones.map((z) => z.v).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  let sum = 0;
  let wsum = 0;
  for (const z of zones) {
    const v = Math.min(z.v, median * 4);
    const dCenter = Math.hypot((z.x - 0.5) * aspect, z.y - 0.5);
    const dAf = Math.hypot((z.x - af.x) * aspect, z.y - af.y);
    const w = 1 + 1.2 * Math.exp(-(dCenter * dCenter) / 0.08) + 1.5 * Math.exp(-(dAf * dAf) / 0.02);
    sum += v * w;
    wsum += w;
  }
  return sum / wsum;
}

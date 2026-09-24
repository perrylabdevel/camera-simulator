/**
 * Closed 2D path on the ground plane (x, z), parameterised by arc length so
 * actors move at a physically meaningful constant speed.
 */

export interface Vec2 {
  x: number;
  z: number;
}

export interface PathSample {
  position: Vec2;
  /** Unit tangent in the direction of travel. */
  tangent: Vec2;
}

export class LoopPath {
  readonly length: number;
  private readonly pts: Vec2[];
  private readonly cum: number[];

  constructor(points: Vec2[]) {
    if (points.length < 3) throw new Error('LoopPath needs at least 3 points');
    this.pts = points;
    this.cum = [0];
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      this.cum.push(this.cum[i] + Math.hypot(b.x - a.x, b.z - a.z));
    }
    this.length = this.cum[points.length];
  }

  /** Sample the path at arc length s (wraps around). */
  at(s: number): PathSample {
    const L = this.length;
    const d = ((s % L) + L) % L;
    // Binary search the segment.
    let lo = 0;
    let hi = this.pts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cum[mid] <= d) lo = mid;
      else hi = mid - 1;
    }
    const a = this.pts[lo];
    const b = this.pts[(lo + 1) % this.pts.length];
    const segLen = this.cum[lo + 1] - this.cum[lo];
    const u = segLen > 0 ? (d - this.cum[lo]) / segLen : 0;
    const tx = (b.x - a.x) / (segLen || 1);
    const tz = (b.z - a.z) / (segLen || 1);
    return { position: { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u }, tangent: { x: tx, z: tz } };
  }
}

/**
 * Sample a smooth closed "stadium-like" loop: a superellipse gives long,
 * gently curved straights that read well as a park path.
 */
export function superellipsePoints(cx: number, cz: number, a: number, b: number, n = 3, count = 256, clockwise = true): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const t = ((clockwise ? -1 : 1) * i * Math.PI * 2) / count;
    const c = Math.cos(t);
    const s = Math.sin(t);
    pts.push({
      x: cx + a * Math.sign(c) * Math.abs(c) ** (2 / n),
      z: cz + b * Math.sign(s) * Math.abs(s) ** (2 / n),
    });
  }
  return pts;
}

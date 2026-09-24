import { describe, expect, it } from 'vitest';
import { LoopPath } from '../src/world/path';
import { bikePath, cyclistAt, PATH_CENTER, PATH_RADII } from '../src/world/actors';

describe('loop path', () => {
  it('square path has the right length and wraps', () => {
    const p = new LoopPath([
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 1, z: 1 },
      { x: 0, z: 1 },
    ]);
    expect(p.length).toBeCloseTo(4, 10);
    expect(p.at(0.5).position).toEqual({ x: 0.5, z: 0 });
    expect(p.at(4.5).position).toEqual({ x: 0.5, z: 0 });
    expect(p.at(1.5).tangent).toEqual({ x: 0, z: 1 });
  });

  it('cyclist moves at the stated speed', () => {
    const a = cyclistAt(0).position;
    const b = cyclistAt(0.1).position;
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(0.65, 2);
  });

  it('bike path stays within its ellipse bounds', () => {
    for (let s = 0; s < bikePath.length; s += 1) {
      const { position } = bikePath.at(s);
      expect(Math.abs(position.x - PATH_CENTER.x)).toBeLessThanOrEqual(PATH_RADII.a + 1e-6);
      expect(Math.abs(position.z - PATH_CENTER.z)).toBeLessThanOrEqual(PATH_RADII.b + 1e-6);
    }
  });
});

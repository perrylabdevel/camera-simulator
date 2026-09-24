import { describe, expect, it } from 'vitest';
import { GULLS, birdAt, pigeonAt, squirrelAt } from '../src/world/wildlife';

describe('wildlife kinematics', () => {
  it('gulls fly at their airspeed', () => {
    for (const g of GULLS) {
      const a = birdAt(g, 10).position;
      const b = birdAt(g, 10.01).position;
      const horiz = Math.hypot(b.x - a.x, b.z - a.z) / 0.01;
      expect(horiz).toBeCloseTo(Math.abs(g.speed), 0);
    }
  });

  it('heading matches the direction of travel', () => {
    const g = GULLS[1];
    const a = birdAt(g, 3).position;
    const b = birdAt(g, 3.001).position;
    const h = birdAt(g, 3).heading;
    const dx = (b.x - a.x) / 0.001;
    const dz = (b.z - a.z) / 0.001;
    expect((dx * h.x + dz * h.z) / Math.hypot(dx, dz)).toBeGreaterThan(0.99);
  });

  it('wings beat at the flap frequency while flapping', () => {
    const g = GULLS[0];
    const wings = Array.from({ length: 400 }, (_, i) => birdAt(g, i * 0.01).wing);
    expect(Math.max(...wings) - Math.min(...wings)).toBeGreaterThan(0.8);
  });

  it('pigeons alternate between walking and pausing, and stay near their patch', () => {
    let walking = 0;
    for (let t = 0; t < 60; t += 0.1) {
      const p = pigeonAt(0, t);
      if (p.speedMps > 0) walking++;
      expect(Math.hypot(p.position.x + 3, p.position.z + 0.6)).toBeLessThan(1.81);
    }
    expect(walking).toBeGreaterThan(20);
    expect(walking).toBeLessThan(580);
  });

  it('the squirrel darts quickly and is continuous in time', () => {
    let maxStep = 0;
    let prev = squirrelAt(0).position;
    for (let t = 0.01; t < 120; t += 0.01) {
      const p = squirrelAt(t).position;
      maxStep = Math.max(maxStep, Math.hypot(p.x - prev.x, p.z - prev.z));
      prev = p;
    }
    expect(maxStep).toBeLessThan(3.2 * 0.01 * 1.05);
    expect(maxStep).toBeGreaterThan(3.2 * 0.01 * 0.9);
  });
});

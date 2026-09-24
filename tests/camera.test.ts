import { describe, expect, it } from 'vitest';
import bodies from '../src/data/bodies.json';
import lenses from '../src/data/lenses.json';
import type { BodySpec, LensSpec } from '../src/sim/equipment';
import { validateBody, validateLens, maxApertureAt, vignettingStops } from '../src/sim/equipment';
import {
  availableApertures,
  availableIsos,
  availableShutters,
  constrainSettings,
  resolveExposure,
  stepStop,
  totalStabilizationStops,
  type CameraSettings,
} from '../src/sim/camera';
import { createShakeTrajectory, expectedShakeBlurMm, shakeAngularSpeed } from '../src/sim/shake';
import { classifyBlur, shutterToFreeze, subjectBlurMm, temporalSampleCount } from '../src/sim/motion';

const body = (bodies as BodySpec[])[0];
const lensById = (id: string) => (lenses as LensSpec[]).find((l) => l.id === id)!;

const base: CameraSettings = {
  bodyId: body.id,
  lensId: '85-f1.4',
  focalLengthMm: 85,
  apertureNominal: 1.4,
  shutterNominal: 1 / 1000,
  isoNominal: 100,
  exposureCompensation: 0,
  focusDistanceM: 4,
  focusMode: 'AF-S',
  afPoint: { x: 0.5, y: 0.5 },
  metering: 'evaluative',
  stabilization: true,
  support: 'handheld',
};

describe('equipment data', () => {
  it('all bundled equipment validates', () => {
    for (const l of lenses as LensSpec[]) expect(validateLens(l)).toEqual([]);
    for (const b of bodies as BodySpec[]) expect(validateBody(b)).toEqual([]);
  });

  it('prime aperture limits come from the lens', () => {
    const l50 = lensById('50-f1.8');
    const aps = availableApertures(l50, 50);
    expect(aps[0].nominal).toBe(1.8);
    expect(aps[aps.length - 1].nominal).toBe(22);
  });

  it('variable-aperture zooms interpolate', () => {
    const zoom: LensSpec = { ...lensById('70-200-f2.8'), maxAperture: 4, maxApertureTele: 5.6 };
    expect(maxApertureAt(zoom, 70)).toBe(4);
    expect(maxApertureAt(zoom, 200)).toBe(5.6);
  });

  it('body limits ISO and shutter ranges', () => {
    const isos = availableIsos(body);
    expect(isos[0].nominal).toBe(100);
    expect(isos[isos.length - 1].nominal).toBe(25600);
    const sh = availableShutters(body);
    expect(sh[0].nominal).toBe(30);
    expect(sh[sh.length - 1].nominal).toBeCloseTo(1 / 8000, 12);
  });

  it('vignetting fades as the lens is stopped down', () => {
    const l = lensById('85-f1.4');
    expect(vignettingStops(l, 85, 1.4)).toBeGreaterThan(vignettingStops(l, 85, 4));
  });
});

describe('camera settings', () => {
  it('constrains aperture to what the lens can do', () => {
    const s = constrainSettings({ ...base, lensId: '50-f1.8', apertureNominal: 1.4 }, body, lensById('50-f1.8'));
    expect(s.apertureNominal).toBe(1.8);
  });

  it('constrains focus to the minimum focus distance', () => {
    const s = constrainSettings({ ...base, focusDistanceM: 0.3 }, body, lensById('85-f1.4'));
    expect(s.focusDistanceM).toBe(0.85);
  });

  it('constrains focal length to the zoom range', () => {
    const l = lensById('70-200-f2.8');
    expect(constrainSettings({ ...base, focalLengthMm: 300 }, body, l).focalLengthMm).toBe(200);
  });

  it('resolves exact values', () => {
    const e = resolveExposure(base, body, lensById('85-f1.4'));
    expect(e.shutter).toBeCloseTo(2 ** -10, 12);
    expect(e.aperture).toBeCloseTo(Math.SQRT2, 12);
  });

  it('steps in thirds and stops at the ends', () => {
    const isos = availableIsos(body);
    expect(stepStop(isos, 100, 3)).toBe(200);
    expect(stepStop(isos, 100, -1)).toBe(100);
  });

  it('stabilisation combines body and lens', () => {
    expect(totalStabilizationStops(base, body, lensById('85-f1.4'))).toBe(5);
    expect(totalStabilizationStops(base, body, lensById('70-200-f2.8'))).toBe(5.5);
    expect(totalStabilizationStops({ ...base, stabilization: false }, body, lensById('85-f1.4'))).toBe(0);
  });
});

describe('camera shake', () => {
  it('follows the reciprocal rule: blur ≈ 1 CoC at 1/f', () => {
    const w = shakeAngularSpeed('handheld', 0);
    for (const f of [24, 50, 200]) {
      expect(expectedShakeBlurMm(f, 1 / f, w)).toBeCloseTo(0.03, 2);
    }
  });

  it('tripod removes shake; stabilisation reduces it by 2^stops', () => {
    expect(shakeAngularSpeed('tripod', 0)).toBe(0);
    expect(shakeAngularSpeed('handheld', 3)).toBeCloseTo(shakeAngularSpeed('handheld', 0) / 8, 12);
  });

  it('trajectory starts at zero and has the calibrated RMS angular speed', () => {
    const w = 0.03;
    const traj = createShakeTrajectory(1234, w);
    const s0 = traj(0);
    expect(Math.hypot(s0.yaw, s0.pitch)).toBeCloseTo(0, 12);
    // Numerically estimate RMS angular speed over a long window.
    const dt = 1e-3;
    let sum = 0;
    let n = 0;
    for (let t = 0; t < 60; t += dt * 7) {
      const a = traj(t);
      const b = traj(t + dt);
      sum += ((b.yaw - a.yaw) / dt) ** 2 + ((b.pitch - a.pitch) / dt) ** 2;
      n++;
    }
    expect(Math.sqrt(sum / n)).toBeGreaterThan(w * 0.8);
    expect(Math.sqrt(sum / n)).toBeLessThan(w * 1.25);
  });

  it('is reproducible from a seed', () => {
    expect(createShakeTrajectory(7, 0.03)(0.1)).toEqual(createShakeTrajectory(7, 0.03)(0.1));
  });
});

describe('subject motion', () => {
  it('a cyclist at 6.5 m/s, 12 m away, 50mm: 1/1000 freezes, 1/60 blurs, 1/8 streaks', () => {
    const px = (mm: number) => (mm / 24) * 1200;
    expect(classifyBlur(px(subjectBlurMm(6.5, 12, 1 / 1000, 50)), 1.5)).toBe('frozen');
    expect(classifyBlur(px(subjectBlurMm(6.5, 12, 1 / 60, 50)), 1.5)).toBe('blurred');
    expect(classifyBlur(px(subjectBlurMm(6.5, 12, 1 / 8, 50)), 1.5)).toBe('streaked');
  });

  it('shutterToFreeze inverts subjectBlurMm', () => {
    const t = shutterToFreeze(6.5, 12, 50, 0.03);
    expect(subjectBlurMm(6.5, 12, t, 50)).toBeCloseTo(0.03, 10);
  });

  it('temporal sample count is bounded', () => {
    expect(temporalSampleCount(0)).toBe(12);
    expect(temporalSampleCount(90)).toBe(60);
    expect(temporalSampleCount(1e6)).toBe(160);
  });
});

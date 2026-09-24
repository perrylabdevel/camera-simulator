import { describe, expect, it } from 'vitest';
import {
  airyDiskDiameterMm,
  blurCoefficientMm,
  blurDiscMm,
  circleOfConfusionMm,
  cropFactor,
  depthOfField,
  diagonalFovDeg,
  equivalentFocalLength,
  horizontalFovDeg,
  hyperfocalDistanceM,
  verticalFovDeg,
} from '../src/sim/optics';

const FF = { widthMm: 36, heightMm: 24 };
const APSC = { widthMm: 23.5, heightMm: 15.6 };

describe('field of view', () => {
  it('50mm on full frame: 39.6° horizontal, 27.0° vertical, 46.8° diagonal', () => {
    expect(horizontalFovDeg(50, FF)).toBeCloseTo(39.6, 1);
    expect(verticalFovDeg(50, FF)).toBeCloseTo(27.0, 1);
    expect(diagonalFovDeg(50, FF)).toBeCloseTo(46.8, 1);
  });

  it('24mm is 84° diagonal, 85mm is 28.6° diagonal', () => {
    expect(diagonalFovDeg(24, FF)).toBeCloseTo(84.1, 0);
    expect(diagonalFovDeg(85, FF)).toBeCloseTo(28.6, 1);
  });

  it('longer lenses always see less', () => {
    const fovs = [14, 24, 35, 50, 85, 200].map((f) => horizontalFovDeg(f, FF));
    for (let i = 1; i < fovs.length; i++) expect(fovs[i]).toBeLessThan(fovs[i - 1]);
  });
});

describe('crop factor', () => {
  it('full frame is 1.0, APS-C ~1.53', () => {
    expect(cropFactor(FF)).toBeCloseTo(1, 10);
    expect(cropFactor(APSC)).toBeCloseTo(1.53, 2);
  });

  it('a 33mm lens on APS-C frames like ~50mm on full frame', () => {
    expect(equivalentFocalLength(33, APSC)).toBeCloseTo(50.5, 0);
    expect(diagonalFovDeg(33, APSC)).toBeCloseTo(diagonalFovDeg(equivalentFocalLength(33, APSC), FF), 6);
  });
});

describe('depth of field', () => {
  const c = circleOfConfusionMm(FF);

  it('full-frame CoC is 0.030 mm', () => {
    expect(c).toBeCloseTo(0.03, 3);
  });

  it('hyperfocal of 50mm f/8 ≈ 10.5 m', () => {
    expect(hyperfocalDistanceM(50, 8, 0.03)).toBeCloseTo(10.47, 1);
  });

  it('matches published DOF tables: 50mm f/2.8 at 3 m → 2.73–3.33 m (DOFMaster)', () => {
    const d = depthOfField(50, 2.8, 3, 0.03);
    expect(d.nearM).toBeCloseTo(2.73, 2);
    expect(d.farM).toBeCloseTo(3.33, 2);
  });

  it('focusing at the hyperfocal distance gives DOF from H/2 to infinity', () => {
    const H = hyperfocalDistanceM(24, 11, 0.03);
    const d = depthOfField(24, 11, H, 0.03);
    expect(d.farM).toBe(Infinity);
    expect(d.nearM).toBeCloseTo(H / 2, 1);
  });

  it('stopping down increases DOF; longer focal lengths decrease it', () => {
    const wide = depthOfField(85, 1.4, 3, c).totalM;
    const narrow = depthOfField(85, 8, 3, c).totalM;
    expect(narrow).toBeGreaterThan(wide);
    expect(depthOfField(24, 4, 3, c).totalM).toBeGreaterThan(depthOfField(85, 4, 3, c).totalM);
  });

  it('85mm f/1.4 at 3 m has only ~10 cm of DOF', () => {
    expect(depthOfField(85, 1.4, 3, c).totalM).toBeCloseTo(0.1, 2);
  });
});

describe('blur disc', () => {
  it('is zero on the focal plane and equals the CoC at the DOF limits', () => {
    const c = 0.03;
    expect(blurDiscMm(50, 2.8, 3, 3)).toBeCloseTo(0, 10);
    const d = depthOfField(50, 2.8, 3, c);
    expect(blurDiscMm(50, 2.8, 3, d.nearM)).toBeCloseTo(c, 3);
    expect(blurDiscMm(50, 2.8, 3, d.farM)).toBeCloseTo(c, 3);
  });

  it('background at infinity: 85mm f/1.4 focused at 4 m gives ~1.3 mm discs', () => {
    expect(blurDiscMm(85, 1.4, 4, Infinity)).toBeCloseTo(1.32, 2);
  });

  it('coefficient form matches the direct formula', () => {
    const k = blurCoefficientMm(85, 1.4, 4);
    for (const s2 of [1, 2, 3.9, 7, 40]) {
      expect(k * Math.abs(s2 - 4) / s2).toBeCloseTo(blurDiscMm(85, 1.4, 4, s2), 10);
    }
  });
});

describe('diffraction', () => {
  it('Airy disk at f/16 is ~21 µm', () => {
    expect(airyDiskDiameterMm(16)).toBeCloseTo(0.0215, 3);
  });
});

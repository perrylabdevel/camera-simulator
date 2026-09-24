import { describe, expect, it } from 'vitest';
import { critique, type ShotFacts } from '../src/sim/critique';

const base: ShotFacts = {
  aperture: 2.8,
  shutterS: 1 / 1000,
  iso: 100,
  focalMm: 50,
  focusDistanceM: 5,
  dofNearM: 4.4,
  dofFarM: 5.8,
  meterOffsetStops: 0,
  exposureCompensation: 0,
  highlightClipFraction: 0,
  shadowClipFraction: 0,
  sharpPx: 1.5,
  shakeBlurPx: 0.2,
  stabilizationStops: 5,
  tripod: false,
  midtoneSnr: 90,
  subjects: [{ name: 'cyclist', inFrame: true, distanceM: 5, lateralSpeedMps: 6.5, motionBlurPx: 1, defocusBlurPx: 0.5 }],
  pxPerMm: 50,
};

describe('critique', () => {
  it('praises a well exposed, sharp, frozen shot', () => {
    const notes = critique(base);
    expect(notes.every((n) => n.level !== 'warn')).toBe(true);
    expect(notes.find((n) => n.topic === 'motion')?.level).toBe('good');
  });

  it('explains motion blur and suggests a freezing shutter speed', () => {
    const notes = critique({ ...base, shutterS: 1 / 30, subjects: [{ ...base.subjects[0], motionBlurPx: 40 }] });
    const m = notes.find((n) => n.topic === 'motion')!;
    expect(m.level).toBe('warn');
    expect(m.text).toMatch(/1\/\d+ s or faster/);
    expect(m.text).toMatch(/not the subject/);
  });

  it('flags clipped highlights with the cause', () => {
    const notes = critique({ ...base, highlightClipFraction: 0.2, meterOffsetStops: 2 });
    expect(notes.find((n) => n.topic === 'exposure')!.text).toMatch(/clipped/);
  });

  it('reports missed focus and where focus landed', () => {
    const notes = critique({ ...base, focusDistanceM: 12, subjects: [{ ...base.subjects[0], defocusBlurPx: 20 }], focusTarget: 'tree crown' });
    const f = notes.find((n) => n.topic === 'focus')!;
    expect(f.level).toBe('warn');
    expect(f.text).toMatch(/tree crown/);
  });

  it('warns about noise at very high ISO', () => {
    const notes = critique({ ...base, iso: 25600, midtoneSnr: 5 });
    expect(notes.find((n) => n.topic === 'noise')!.level).toBe('warn');
  });

  it('warns about shake when handheld and slow', () => {
    const notes = critique({ ...base, shakeBlurPx: 12 });
    expect(notes.find((n) => n.topic === 'shake')).toBeDefined();
    expect(critique({ ...base, shakeBlurPx: 12, tripod: true }).find((n) => n.topic === 'shake')).toBeUndefined();
  });
});

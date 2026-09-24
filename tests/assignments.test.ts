import { describe, expect, it } from 'vitest';
import data from '../src/data/assignments.json';
import { evaluateAssignment, validateAssignment, type Assignment, type ShotMeasure } from '../src/sim/assignments';

const assignments = data as Assignment[];
const byId = (id: string) => assignments.find((a) => a.id === id)!;

const shot: ShotMeasure = {
  frameHeightPx: 1200,
  sharpPx: 1.5,
  subjects: [
    { name: 'cyclist', inFrame: true, sizeFrac: 0.3, motionPx: 1, defocusPx: 0.5 },
    { name: 'portrait subject', inFrame: true, sizeFrac: 0.4, motionPx: 0.1, defocusPx: 0.5 },
    { name: 'gull', inFrame: true, sizeFrac: 0.02, motionPx: 40, defocusPx: 0.3 },
    { name: 'gull', inFrame: true, sizeFrac: 0.1, motionPx: 1, defocusPx: 0.3 },
  ],
  highlightClip: 0.001,
  shadowClip: 0.01,
  meterOffset: 0.2,
  exposureCompensation: 0,
  shakePx: 0.4,
  panBackgroundPx: 0,
  backgroundDefocusPx: 5,
  dofNearM: 3,
  dofFarM: 6,
  midtoneSnr: 80,
};

describe('assignments', () => {
  it('bundled assignments validate', () => {
    for (const a of assignments) expect(validateAssignment(a)).toEqual([]);
  });

  it('a frozen, well-exposed cyclist passes "freeze the cyclist"', () => {
    expect(evaluateAssignment(byId('freeze-cyclist'), shot).passed).toBe(true);
  });

  it('motion blur fails "freeze" but passes "show the speed"', () => {
    const blurred = { ...shot, subjects: [{ ...shot.subjects[0], motionPx: 40 }] };
    expect(evaluateAssignment(byId('freeze-cyclist'), blurred).passed).toBe(false);
    expect(evaluateAssignment(byId('show-speed'), blurred).passed).toBe(true);
  });

  it('panning needs background streaks and a sharp-enough rider', () => {
    const pan = { ...shot, panBackgroundPx: 60, subjects: [{ ...shot.subjects[0], motionPx: 4 }] };
    expect(evaluateAssignment(byId('pan-cyclist'), pan).passed).toBe(true);
    const noPan = evaluateAssignment(byId('pan-cyclist'), shot);
    expect(noPan.passed).toBe(false);
    expect(noPan.results.find((r) => !r.passed)!.text).toMatch(/not panning/);
  });

  it('portrait separation depends on background blur', () => {
    expect(evaluateAssignment(byId('portrait-separation'), { ...shot, backgroundDefocusPx: 30 }).passed).toBe(true);
    expect(evaluateAssignment(byId('portrait-separation'), shot).passed).toBe(false);
  });

  it('deep focus requires infinity inside the DOF and a close near limit', () => {
    expect(evaluateAssignment(byId('front-to-back'), { ...shot, dofNearM: 1.8, dofFarM: Infinity }).passed).toBe(true);
    expect(evaluateAssignment(byId('front-to-back'), { ...shot, dofNearM: 1.8, dofFarM: 40 }).passed).toBe(false);
  });

  it('picks the largest matching subject when several share a name', () => {
    expect(evaluateAssignment(byId('gull-wings'), shot).passed).toBe(true);
  });

  it('highlight protection is strict about clipping', () => {
    expect(evaluateAssignment(byId('protect-highlights'), { ...shot, highlightClip: 0.02 }).passed).toBe(false);
    expect(evaluateAssignment(byId('protect-highlights'), shot).passed).toBe(true);
  });
});

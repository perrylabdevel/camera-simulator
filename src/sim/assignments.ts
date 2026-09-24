/**
 * Assignments: photographic objectives judged on the outcome, never on the
 * settings used. Criteria are data (src/data/assignments.json), evaluated
 * against measurements the simulator already has for every photograph.
 */

export interface SubjectMeasure {
  name: string;
  /** Inside the frame (not cropped away, in front of the camera). */
  inFrame: boolean;
  /** Subject size as a fraction of the frame height. */
  sizeFrac: number;
  /** Image-plane movement during the exposure (px). */
  motionPx: number;
  /** Defocus blur diameter (px). */
  defocusPx: number;
}

export interface ShotMeasure {
  frameHeightPx: number;
  /** Acceptable blur (px) — one circle of confusion. */
  sharpPx: number;
  subjects: SubjectMeasure[];
  highlightClip: number;
  shadowClip: number;
  /** Exposure relative to the meter (stops). */
  meterOffset: number;
  exposureCompensation: number;
  /** Camera shake blur (px). */
  shakePx: number;
  /** Background sweep from panning (px), 0 if not panning. */
  panBackgroundPx: number;
  /** Defocus blur of a point at infinity (px). */
  backgroundDefocusPx: number;
  dofNearM: number;
  dofFarM: number;
  midtoneSnr: number;
}

export type Criterion =
  | { kind: 'inFrame'; subject: string; minSize?: number; label?: string }
  | { kind: 'frozen'; subject: string; maxBlur?: number }
  | { kind: 'motionBlur'; subject: string; minPx: number }
  | { kind: 'inFocus'; subject: string; maxBlur?: number }
  | { kind: 'panStreak'; minPx: number }
  | { kind: 'staticBackground'; maxPx: number }
  | { kind: 'backgroundBlur'; minFrac: number }
  | { kind: 'deepFocus'; maxNearM: number }
  | { kind: 'exposure'; maxStops?: number; maxHighlightClip?: number; maxShadowClip?: number }
  | { kind: 'noShake'; maxBlur?: number }
  | { kind: 'clean'; minSnr: number };

export interface Assignment {
  id: string;
  title: string;
  /** The photographic goal, phrased as an outcome. */
  brief: string;
  /** Optional nudge shown on request — still about ideas, not exact settings. */
  hint?: string;
  setup?: { x: number; z: number; lookAt: { x: number; y: number; z: number }; lensId?: string };
  criteria: Criterion[];
}

export interface CriterionResult {
  passed: boolean;
  text: string;
}

export interface AssignmentResult {
  passed: boolean;
  results: CriterionResult[];
}

/** Best-placed subject with this name (several gulls share one name). */
function pick(m: ShotMeasure, name: string): SubjectMeasure | undefined {
  const c = m.subjects.filter((s) => s.name === name && s.inFrame);
  return c.sort((a, b) => b.sizeFrac - a.sizeFrac)[0];
}

const px = (v: number) => `${Math.round(v)} px`;

export function evaluateCriterion(c: Criterion, m: ShotMeasure): CriterionResult {
  switch (c.kind) {
    case 'inFrame': {
      const s = pick(m, c.subject);
      const min = c.minSize ?? 0.05;
      if (!s) return { passed: false, text: `The ${c.subject} is not in the frame.` };
      const ok = s.sizeFrac >= min;
      return {
        passed: ok,
        text: ok
          ? `The ${c.subject} fills ${Math.round(s.sizeFrac * 100)}% of the frame height.`
          : `The ${c.subject} is too small (${Math.round(s.sizeFrac * 100)}% of the frame height; aim for at least ${Math.round(min * 100)}%). Get closer or use a longer lens.`,
      };
    }
    case 'frozen': {
      const s = pick(m, c.subject);
      if (!s) return { passed: false, text: `No ${c.subject} to judge for motion.` };
      const limit = (c.maxBlur ?? 1.5) * m.sharpPx;
      const ok = s.motionPx <= limit;
      return {
        passed: ok,
        text: ok ? `Motion frozen: the ${c.subject} moved only ${px(s.motionPx)}.` : `The ${c.subject} moved ${px(s.motionPx)} during the exposure — too much to look frozen (≤ ${px(limit)}).`,
      };
    }
    case 'motionBlur': {
      const s = pick(m, c.subject);
      if (!s) return { passed: false, text: `No ${c.subject} to show movement.` };
      const ok = s.motionPx >= c.minPx;
      return {
        passed: ok,
        text: ok ? `The ${c.subject} streaks ${px(s.motionPx)} — the photo shows speed.` : `The ${c.subject} moved only ${px(s.motionPx)}; it needs at least ${px(c.minPx)} of blur to read as motion.`,
      };
    }
    case 'inFocus': {
      const s = pick(m, c.subject);
      if (!s) return { passed: false, text: `No ${c.subject} to judge for focus.` };
      const limit = (c.maxBlur ?? 1.5) * m.sharpPx;
      const ok = s.defocusPx <= limit;
      return {
        passed: ok,
        text: ok ? `The ${c.subject} is in focus.` : `The ${c.subject} is out of focus (blur ${px(s.defocusPx)}, needs ≤ ${px(limit)}).`,
      };
    }
    case 'panStreak': {
      const ok = m.panBackgroundPx >= c.minPx;
      return {
        passed: ok,
        text: ok
          ? `The background streaks ${px(m.panBackgroundPx)} from your pan.`
          : m.panBackgroundPx > 0
            ? `The background only streaks ${px(m.panBackgroundPx)}; a slower shutter or faster swing gives longer streaks (≥ ${px(c.minPx)}).`
            : 'The camera was not panning when the shutter fired — follow the subject and shoot while still swinging.',
      };
    }
    case 'staticBackground': {
      const moved = Math.max(m.panBackgroundPx, m.shakePx);
      const ok = moved <= c.maxPx;
      return { passed: ok, text: ok ? 'The background is steady.' : `The whole frame moved ${px(moved)} — keep the camera still so only the subject blurs.` };
    }
    case 'backgroundBlur': {
      const frac = m.backgroundDefocusPx / m.frameHeightPx;
      const ok = frac >= c.minFrac;
      return {
        passed: ok,
        text: ok
          ? `The distant background is softly blurred (blur discs ${(frac * 100).toFixed(1)}% of the frame height).`
          : `The background is too sharp to separate the subject (blur ${(frac * 100).toFixed(1)}% of frame height, aim for ${(c.minFrac * 100).toFixed(1)}%). Wider aperture, longer lens, or a closer subject all help.`,
      };
    }
    case 'deepFocus': {
      const ok = !Number.isFinite(m.dofFarM) ? m.dofNearM <= c.maxNearM : false;
      return {
        passed: ok,
        text: ok
          ? `Sharp from ${m.dofNearM.toFixed(1)} m to infinity.`
          : Number.isFinite(m.dofFarM)
            ? `The sharp zone ends at ${m.dofFarM.toFixed(1)} m — the horizon is soft.`
            : `The sharp zone only starts at ${m.dofNearM.toFixed(1)} m; the foreground (${c.maxNearM} m) is soft.`,
      };
    }
    case 'exposure': {
      const maxStops = c.maxStops ?? 1;
      const off = m.meterOffset + m.exposureCompensation;
      const hi = c.maxHighlightClip ?? 0.03;
      const lo = c.maxShadowClip ?? 0.1;
      if (m.highlightClip > hi) return { passed: false, text: `${(m.highlightClip * 100).toFixed(1)}% of the frame is blown to white (allowed ${(hi * 100).toFixed(1)}%).` };
      if (m.shadowClip > lo) return { passed: false, text: `${(m.shadowClip * 100).toFixed(1)}% of the frame is crushed to black.` };
      if (Math.abs(off) > maxStops) return { passed: false, text: `Exposure is ${off > 0 ? '+' : ''}${off.toFixed(1)} EV from the meter — too ${off > 0 ? 'bright' : 'dark'}.` };
      return { passed: true, text: 'Well exposed.' };
    }
    case 'noShake': {
      const limit = (c.maxBlur ?? 1.5) * m.sharpPx;
      const ok = m.shakePx <= limit;
      return { passed: ok, text: ok ? 'No visible camera shake.' : `Camera shake blurred the frame by ${px(m.shakePx)}.` };
    }
    case 'clean': {
      const ok = m.midtoneSnr >= c.minSnr;
      return { passed: ok, text: ok ? `Clean image (mid-tone SNR ${m.midtoneSnr.toFixed(0)}:1).` : `Too noisy (mid-tone SNR ${m.midtoneSnr.toFixed(0)}:1, aim for ${c.minSnr}:1).` };
    }
  }
}

export function evaluateAssignment(a: Assignment, m: ShotMeasure): AssignmentResult {
  const results = a.criteria.map((c) => evaluateCriterion(c, m));
  return { passed: results.every((r) => r.passed), results };
}

export function validateAssignment(a: Assignment): string[] {
  const e: string[] = [];
  if (!a.id || !a.title || !a.brief) e.push(`assignment ${a.id ?? '?'}: missing id/title/brief`);
  if (!a.criteria?.length) e.push(`assignment ${a.id}: no criteria`);
  return e;
}

/**
 * Renderer-independent kinematics for everything that moves in the Exposure
 * Lab. The capture pipeline evaluates these at arbitrary times inside the
 * shutter interval, so they must be pure functions of time.
 */

import { LoopPath, superellipsePoints, type Vec2 } from './path';

export const PATH_CENTER = { x: 0, z: -17 };
export const PATH_RADII = { a: 24, b: 12.5 };
export const PATH_WIDTH = 2.6;

export const bikePath = new LoopPath(superellipsePoints(PATH_CENTER.x, PATH_CENTER.z, PATH_RADII.a, PATH_RADII.b, 3.2, 512, false));

export interface CyclistState {
  position: Vec2;
  /** Direction of travel. */
  heading: Vec2;
  speedMps: number;
  /** Total distance travelled, drives wheel and crank rotation. */
  distanceM: number;
  /** Lean angle into turns (radians, positive = lean left). */
  lean: number;
}

export const CYCLIST_SPEED_MPS = 6.5; // ~23 km/h, a brisk recreational pace
export const WHEEL_RADIUS_M = 0.34;
/** Wheel revolutions per crank revolution (gear ratio). */
export const GEAR_RATIO = 2.6;

export function cyclistAt(t: number, speed = CYCLIST_SPEED_MPS, offset = 20): CyclistState {
  const s = offset + speed * t;
  const p = bikePath.at(s);
  const ahead = bikePath.at(s + 1.5);
  // Curvature estimate → lean angle tan(φ) = v² / (g·r).
  const cross = p.tangent.x * ahead.tangent.z - p.tangent.z * ahead.tangent.x;
  const dTheta = Math.asin(Math.max(-1, Math.min(1, cross)));
  const curvature = dTheta / 1.5;
  const lean = Math.atan((speed * speed * curvature) / 9.81);
  return { position: p.position, heading: p.tangent, speedMps: speed, distanceM: s, lean };
}

export function wheelAngle(distanceM: number): number {
  return distanceM / WHEEL_RADIUS_M;
}

export function crankAngle(distanceM: number): number {
  return wheelAngle(distanceM) / GEAR_RATIO;
}

/** Subtle standing sway of the portrait subject (metres / radians). */
export function portraitSway(t: number): { dx: number; dz: number; yaw: number; breath: number } {
  return {
    dx: 0.006 * Math.sin(t * 2 * Math.PI * 0.21),
    dz: 0.004 * Math.sin(t * 2 * Math.PI * 0.13 + 1.3),
    yaw: 0.02 * Math.sin(t * 2 * Math.PI * 0.07),
    breath: Math.sin(t * 2 * Math.PI * 0.25),
  };
}

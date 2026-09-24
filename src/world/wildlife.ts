/**
 * Renderer-independent wildlife kinematics. Everything is a pure function
 * of world time so the capture pipeline can sample any instant inside the
 * shutter interval (wing beats blur at slow shutter speeds, freeze at fast ones).
 */

import { mulberry32 } from '../sim/random';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/* ------------------------------------------------------------------------ */
/* Birds in flight                                                          */
/* ------------------------------------------------------------------------ */

export interface BirdParams {
  cx: number;
  cz: number;
  radius: number;
  altitude: number;
  /** Airspeed (m/s). Positive = counter-clockwise seen from above. */
  speed: number;
  phase: number;
  /** Wing-beat frequency (Hz). */
  flapHz: number;
  seed: number;
}

export interface BirdState {
  position: Vec3;
  /** Unit direction of flight. */
  heading: Vec3;
  speedMps: number;
  /** Bank angle (radians, positive = right wing down). */
  bank: number;
  /** Wing elevation angle (radians, positive = up). */
  wing: number;
  /** Outer-wing extra fold (radians). */
  wingTip: number;
}

/** Herring-gull-like birds circling over the park, with flap/glide cycles. */
export const GULLS: BirdParams[] = [
  { cx: 3, cz: -9, radius: 15, altitude: 11, speed: 9.5, phase: 0.2, flapHz: 2.9, seed: 1 },
  { cx: -4, cz: -14, radius: 19, altitude: 15, speed: -10.5, phase: 2.4, flapHz: 3.1, seed: 2 },
  { cx: 6, cz: -4, radius: 10, altitude: 7.5, speed: 8.5, phase: 4.1, flapHz: 3.3, seed: 3 },
];

/** Smooth 0..1 envelope: birds flap for a few seconds, then glide. */
function flapEnvelope(t: number, seed: number): number {
  const period = 7 + (seed % 3);
  const u = ((t + seed * 2.3) % period) / period;
  const on = 0.55;
  const edge = 0.08;
  const s = (a: number, b: number, x: number) => {
    const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return k * k * (3 - 2 * k);
  };
  return s(0, edge, u) * (1 - s(on, on + edge, u));
}

export function birdAt(b: BirdParams, t: number): BirdState {
  const omega = b.speed / b.radius;
  const a = b.phase + omega * t;
  const dir = Math.sign(b.speed);
  const position = {
    x: b.cx + Math.cos(a) * b.radius,
    y: b.altitude + 0.8 * Math.sin(t * 0.37 + b.seed) + 0.3 * Math.sin(t * 1.1 + b.seed * 2),
    z: b.cz + Math.sin(a) * b.radius,
  };
  const heading = { x: -Math.sin(a) * dir, y: 0, z: Math.cos(a) * dir };
  const v = Math.abs(b.speed);
  const bank = dir * Math.atan((v * v) / (9.81 * b.radius));
  const env = flapEnvelope(t, b.seed);
  const beat = Math.sin(2 * Math.PI * b.flapHz * t);
  // Gliding: wings held slightly raised (dihedral). Flapping: ±35° about a raised mean.
  const wing = 0.1 + env * (0.08 + 0.6 * beat);
  const wingTip = env * 0.35 * Math.sin(2 * Math.PI * b.flapHz * t - 0.9);
  return { position, heading, speedMps: v, bank, wing, wingTip };
}

/* ------------------------------------------------------------------------ */
/* Ground birds (pigeons)                                                   */
/* ------------------------------------------------------------------------ */

export interface WalkerState {
  position: Vec3;
  /** Yaw (radians, 0 = facing +z). */
  yaw: number;
  speedMps: number;
  /** 0..1 how far the head is lowered (pecking). */
  peck: number;
  /** Head bob offset (m), forward/back as pigeons do while walking. */
  bob: number;
}

interface WalkerPlan {
  times: number[];
  points: { x: number; z: number }[];
  period: number;
}

/** A looping schedule of short walks between random points, with pauses to peck. */
function makeWalkPlan(seed: number, cx: number, cz: number, radius: number, speed: number, legs = 10): WalkerPlan {
  const rand = mulberry32(seed);
  const points: { x: number; z: number }[] = [];
  for (let i = 0; i < legs; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * radius;
    points.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r });
  }
  // times[2i] = arrive at point i and start pause, times[2i+1] = leave point i.
  const times: number[] = [];
  let t = 0;
  for (let i = 0; i < legs; i++) {
    const next = points[(i + 1) % legs];
    const pause = 1.2 + rand() * 3;
    times.push(t, t + pause);
    t += pause + Math.hypot(next.x - points[i].x, next.z - points[i].z) / speed;
  }
  return { times, points, period: t };
}

function walkerAt(plan: WalkerPlan, speed: number, t: number, peckHz: number, stepHz: number): WalkerState {
  const n = plan.points.length;
  const u = ((t % plan.period) + plan.period) % plan.period;
  let i = n - 1;
  for (let k = 0; k < n; k++) {
    if (u < plan.times[2 * k]) {
      i = k - 1;
      break;
    }
  }
  if (i < 0) i = n - 1;
  const p = plan.points[i];
  const q = plan.points[(i + 1) % n];
  const leave = plan.times[2 * i + 1];
  const yaw = Math.atan2(q.x - p.x, q.z - p.z);
  if (u < leave) {
    // Pausing: pecking at the ground.
    const peck = Math.max(0, Math.sin(2 * Math.PI * peckHz * u)) ** 2;
    return { position: { x: p.x, y: 0, z: p.z }, yaw, speedMps: 0, peck, bob: 0 };
  }
  const d = (u - leave) * speed;
  const len = Math.hypot(q.x - p.x, q.z - p.z);
  const f = Math.min(1, d / Math.max(len, 1e-6));
  const bob = 0.012 * Math.sin(2 * Math.PI * stepHz * u);
  return { position: { x: p.x + (q.x - p.x) * f, y: 0, z: p.z + (q.z - p.z) * f }, yaw, speedMps: speed, peck: 0, bob };
}

const PIGEON_SPEED = 0.45;
const pigeonPlans = [makeWalkPlan(11, -3.0, -0.6, 1.8, PIGEON_SPEED), makeWalkPlan(12, -2.2, -0.2, 1.6, PIGEON_SPEED)];
export const PIGEON_COUNT = pigeonPlans.length;

export function pigeonAt(i: number, t: number): WalkerState {
  return walkerAt(pigeonPlans[i], PIGEON_SPEED, t, 1.6, 2.4);
}

/* ------------------------------------------------------------------------ */
/* Squirrel                                                                 */
/* ------------------------------------------------------------------------ */

export interface SquirrelState extends WalkerState {
  /** Bounding-gait phase 0..1 (drives body arch and hop). */
  gait: number;
  /** Vertical hop height (m). */
  hop: number;
}

const SQUIRREL_SPEED = 3.2;
const squirrelPlan = makeWalkPlan(21, -6.5, 1.5, 5.5, SQUIRREL_SPEED, 12);

export function squirrelAt(t: number): SquirrelState {
  const w = walkerAt(squirrelPlan, SQUIRREL_SPEED, t, 0.9, 0);
  const gaitHz = 3.4;
  const gait = ((t * gaitHz) % 1 + 1) % 1;
  const moving = w.speedMps > 0;
  return {
    ...w,
    bob: 0,
    gait: moving ? gait : 0,
    hop: moving ? 0.06 * Math.max(0, Math.sin(gait * Math.PI * 2)) : 0,
    peck: moving ? 0 : w.peck * 0.5,
  };
}

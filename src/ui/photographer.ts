/**
 * The photographer's body: where they stand, how high the camera is and
 * where it points. Movement is intentionally human-paced (walking speed) so
 * choosing a position is a real decision.
 */

import * as THREE from 'three';

export const EYE_HEIGHT_STANDING = 1.6;
export const EYE_HEIGHT_CROUCHING = 0.95;
const WALK_SPEED = 1.4;
const RUN_SPEED = 3.5;
const BOUNDS_CENTER = new THREE.Vector2(0, -12);
const BOUNDS_RADIUS = 65;

export class Photographer {
  position = new THREE.Vector3(0.6, EYE_HEIGHT_STANDING, 10);
  yaw = 0;
  pitch = 0;
  crouching = false;
  private eyeHeight = EYE_HEIGHT_STANDING;
  private keys = new Set<string>();
  /** Obstacles as circles (x, z, radius) the photographer cannot walk through. */
  obstacles: { x: number; z: number; r: number }[] = [];

  setKey(code: string, down: boolean): void {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }

  clearKeys(): void {
    this.keys.clear();
  }

  get moving(): boolean {
    return ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].some((k) => this.keys.has(k));
  }

  /** Aim at a world-space point. */
  lookAt(target: THREE.Vector3): void {
    const d = target.clone().sub(this.position);
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  }

  /** Rotate the view by pointer movement; sensitivity scales with the field of view. */
  look(dxPx: number, dyPx: number, fovRad: number, viewHeightPx: number): void {
    const radPerPx = fovRad / viewHeightPx;
    this.yaw -= dxPx * radPerPx;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dyPx * radPerPx, -1.45, 1.45);
  }

  update(dt: number): void {
    const run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const speed = run ? RUN_SPEED : WALK_SPEED;
    let f = 0;
    let s = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) f += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) f -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) s += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) s -= 1;
    if (f || s) {
      const len = Math.hypot(f, s);
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw);
      const rz = -Math.sin(this.yaw);
      this.position.x += ((fx * f + rx * s) / len) * speed * dt;
      this.position.z += ((fz * f + rz * s) / len) * speed * dt;
    }
    for (const o of this.obstacles) {
      const dx = this.position.x - o.x;
      const dz = this.position.z - o.z;
      const d = Math.hypot(dx, dz);
      if (d < o.r && d > 1e-6) {
        this.position.x = o.x + (dx / d) * o.r;
        this.position.z = o.z + (dz / d) * o.r;
      }
    }
    const p = new THREE.Vector2(this.position.x, this.position.z).sub(BOUNDS_CENTER);
    if (p.length() > BOUNDS_RADIUS) {
      p.setLength(BOUNDS_RADIUS).add(BOUNDS_CENTER);
      this.position.x = p.x;
      this.position.z = p.y;
    }
    const target = this.crouching ? EYE_HEIGHT_CROUCHING : EYE_HEIGHT_STANDING;
    this.eyeHeight += (target - this.eyeHeight) * Math.min(1, dt * 6);
    this.position.y = this.eyeHeight;
  }

  /** Teleport (used by lesson stations); snaps eye height. */
  place(x: number, z: number, crouch = false): void {
    this.position.set(x, crouch ? EYE_HEIGHT_CROUCHING : EYE_HEIGHT_STANDING, z);
    this.crouching = crouch;
    this.eyeHeight = this.position.y;
  }

  apply(camera: THREE.Camera): void {
    camera.position.copy(this.position);
    camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    camera.updateMatrixWorld(true);
  }
}

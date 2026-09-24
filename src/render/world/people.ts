/**
 * The bicycle and its rider, plus standing poses and two-bone IK.
 * Human figures themselves are built in human.ts.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { patchMaterial } from './materials';
import { createPerson, FOREARM, SHIN, THIGH, UPPER_ARM, type Person } from './human';
import { crankAngle, wheelAngle, WHEEL_RADIUS_M, type CyclistState } from '../../world/actors';

export type { Person, PersonLook } from './human';
export { createPerson } from './human';

function mat(color: string, roughness: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return patchMaterial(new THREE.MeshStandardMaterial({ color, roughness, ...opts }));
}

function ellipsoid(rx: number, ry: number, rz: number, w = 24, h = 16): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(rx, ry, rz);
  return g;
}

/** Relaxed standing pose, with optional weight shift and breathing. */
export function poseStanding(p: Person, breath = 0): void {
  p.pelvis.rotation.set(0, 0, 0.025);
  p.chest.rotation.set(-0.02 + breath * 0.006, 0, -0.035);
  p.neck.rotation.set(0.06, 0, 0.02);
  p.head.rotation.set(-0.02, 0.12, 0.04);
  p.arms[0].upper.rotation.set(0.05, 0, -0.1);
  p.arms[0].fore.rotation.set(-0.35, 0, 0);
  p.arms[0].hand.rotation.set(0, 0.3, 0);
  p.arms[1].upper.rotation.set(-0.1, 0, 0.12);
  p.arms[1].fore.rotation.set(-0.25, 0, 0);
  p.arms[1].hand.rotation.set(0, -0.3, 0);
  p.legs[0].thigh.rotation.set(-0.04, 0, -0.06);
  p.legs[0].shin.rotation.set(0.06, 0, 0.03);
  p.legs[0].foot.rotation.set(-0.02, -0.2, 0.03);
  p.legs[1].thigh.rotation.set(0.05, 0, 0.02);
  p.legs[1].shin.rotation.set(0.02, 0, -0.02);
  p.legs[1].foot.rotation.set(-0.07, 0.25, 0);
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);

/** Point a bone (whose rest direction is -y) along a world-space direction. */
function aimBone(bone: THREE.Object3D, worldDir: THREE.Vector3): void {
  bone.parent!.getWorldQuaternion(_q);
  const local = _v1.copy(worldDir).applyQuaternion(_q.invert()).normalize();
  bone.quaternion.setFromUnitVectors(DOWN, local);
  bone.updateMatrixWorld(true);
}

/**
 * Analytic two-bone IK. Places the chain root→mid→end so that end reaches
 * `target`, bending towards `pole`.
 */
function solveTwoBone(
  upper: THREE.Object3D,
  lower: THREE.Object3D,
  l1: number,
  l2: number,
  target: THREE.Vector3,
  pole: THREE.Vector3,
): void {
  const root = upper.getWorldPosition(new THREE.Vector3());
  const toT = _v2.copy(target).sub(root);
  const d = Math.min(Math.max(toT.length(), Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-4);
  const dir = toT.normalize();
  const a = Math.acos(THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const bendAxis = new THREE.Vector3().crossVectors(dir, pole).normalize();
  // Rotate towards the pole so knees and elbows bend the natural way.
  const upperDir = dir.clone().applyAxisAngle(bendAxis, a);
  aimBone(upper, upperDir);
  const mid = root.clone().addScaledVector(upperDir, l1);
  const lowerDir = new THREE.Vector3().subVectors(root.clone().addScaledVector(dir, d), mid).normalize();
  aimBone(lower, lowerDir);
}

/* ------------------------------------------------------------------------ */
/* Bicycle                                                                  */
/* ------------------------------------------------------------------------ */

export interface Cyclist {
  root: THREE.Group;
  person: Person;
  update(state: CyclistState): void;
  meshes: THREE.Mesh[];
}

function tube(a: THREE.Vector3, b: THREE.Vector3, r: number, sides = 10): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, sides, 1);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}

function wheel(meshes: THREE.Mesh[], tire: THREE.Material, rimMat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const R = WHEEL_RADIUS_M;
  const t = new THREE.Mesh(new THREE.TorusGeometry(R - 0.018, 0.018, 12, 64), tire);
  t.rotation.y = Math.PI / 2;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R - 0.04, 0.009, 8, 64), rimMat);
  rim.rotation.y = Math.PI / 2;
  const spokes: THREE.BufferGeometry[] = [];
  const n = 28;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const side = i % 2 === 0 ? 0.025 : -0.025;
    const hub = new THREE.Vector3(side, Math.cos(a + 0.2) * 0.02, Math.sin(a + 0.2) * 0.02);
    const end = new THREE.Vector3(0, Math.cos(a) * (R - 0.045), Math.sin(a) * (R - 0.045));
    spokes.push(tube(hub, end, 0.0018, 4));
  }
  spokes.push(new THREE.CylinderGeometry(0.022, 0.022, 0.08, 12).rotateZ(Math.PI / 2));
  const sp = new THREE.Mesh(mergeGeometries(spokes)!, rimMat);
  for (const m of [t, rim, sp]) {
    m.castShadow = true;
    g.add(m);
    meshes.push(m);
  }
  return g;
}

export function createCyclist(): Cyclist {
  const meshes: THREE.Mesh[] = [];
  const root = new THREE.Group();
  root.name = 'bicycle';
  const leanGroup = new THREE.Group();
  root.add(leanGroup);

  const frameMat = mat('#1f5f73', 0.3, { metalness: 0.6 });
  const darkMetal = mat('#2a2a2a', 0.4, { metalness: 0.8 });
  const silver = mat('#b9bcc0', 0.25, { metalness: 1 });
  const tire = mat('#161616', 0.8);
  const saddleMat = mat('#1a1a1a', 0.5);

  const R = WHEEL_RADIUS_M;
  const rearAxle = new THREE.Vector3(0, R, -0.51);
  const frontAxle = new THREE.Vector3(0, R, 0.51);
  const bb = new THREE.Vector3(0, 0.28, -0.06);
  const seatTop = new THREE.Vector3(0, 0.8, -0.23);
  const headTop = new THREE.Vector3(0, 0.88, 0.37);
  const headBottom = new THREE.Vector3(0, 0.72, 0.41);
  const frameParts = [
    tube(seatTop, headTop, 0.017),
    tube(bb, headBottom, 0.021),
    tube(bb, seatTop, 0.017),
    tube(headBottom, headTop, 0.022),
    tube(new THREE.Vector3(0.05, bb.y, bb.z), new THREE.Vector3(0.06, R, rearAxle.z), 0.01),
    tube(new THREE.Vector3(-0.05, bb.y, bb.z), new THREE.Vector3(-0.06, R, rearAxle.z), 0.01),
    tube(new THREE.Vector3(0.03, 0.78, -0.22), new THREE.Vector3(0.06, R, rearAxle.z), 0.009),
    tube(new THREE.Vector3(-0.03, 0.78, -0.22), new THREE.Vector3(-0.06, R, rearAxle.z), 0.009),
    tube(new THREE.Vector3(0.04, headBottom.y, headBottom.z), new THREE.Vector3(0.05, R, frontAxle.z), 0.011),
    tube(new THREE.Vector3(-0.04, headBottom.y, headBottom.z), new THREE.Vector3(-0.05, R, frontAxle.z), 0.011),
  ];
  const frame = new THREE.Mesh(mergeGeometries(frameParts)!, frameMat);
  frame.castShadow = true;
  leanGroup.add(frame);
  meshes.push(frame);

  const cockpit = new THREE.Mesh(
    mergeGeometries([
      tube(headTop, new THREE.Vector3(0, 0.93, 0.45), 0.013),
      tube(new THREE.Vector3(-0.28, 0.95, 0.46), new THREE.Vector3(0.28, 0.95, 0.46), 0.011),
      tube(seatTop, new THREE.Vector3(0, 0.885, -0.25), 0.012),
    ])!,
    darkMetal,
  );
  cockpit.castShadow = true;
  leanGroup.add(cockpit);
  meshes.push(cockpit);
  const saddle = new THREE.Mesh(ellipsoid(0.07, 0.025, 0.14), saddleMat);
  saddle.position.set(0, 0.9, -0.25);
  saddle.castShadow = true;
  leanGroup.add(saddle);
  meshes.push(saddle);

  const rearWheel = wheel(meshes, tire, silver);
  rearWheel.position.copy(rearAxle);
  const frontWheel = wheel(meshes, tire, silver);
  frontWheel.position.copy(frontAxle);
  leanGroup.add(rearWheel, frontWheel);

  const crank = new THREE.Group();
  crank.position.copy(bb);
  leanGroup.add(crank);
  const chainring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.006, 6, 40), silver);
  chainring.rotation.y = Math.PI / 2;
  chainring.position.x = 0.06;
  crank.add(chainring);
  meshes.push(chainring);
  const crankArms: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.x = sx * 0.08;
    arm.rotation.x = sx > 0 ? 0 : Math.PI;
    crank.add(arm);
    const armMesh = new THREE.Mesh(tube(new THREE.Vector3(), new THREE.Vector3(0, -0.17, 0), 0.01, 6), darkMetal);
    arm.add(armMesh);
    const pedal = new THREE.Object3D();
    pedal.position.set(sx * 0.04, -0.17, 0);
    arm.add(pedal);
    const pedalMesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.015, 0.06), darkMetal);
    pedal.add(pedalMesh);
    meshes.push(armMesh, pedalMesh);
    crankArms.push(pedal);
  }

  const person = createPerson({
    skin: '#b98a6c',
    top: '#e2b714',
    topLongSleeves: false,
    bottom: '#1b1b1f',
    bottomShort: true,
    shoes: '#303030',
    hair: '#2b1d14',
    longHair: false,
    helmet: '#f0f0f0',
    topFabric: 'jersey',
    bottomFabric: 'lycra',
    build: 'm',
    sunglasses: true,
  });
  person.root.position.set(0, 0, -0.24);
  person.pelvis.position.set(0, 0.955, 0);
  leanGroup.add(person.root);
  meshes.push(...person.meshes);
  person.chest.rotation.x = 0.78;
  person.neck.rotation.x = -0.45;
  person.head.rotation.x = -0.35;

  const grips = [new THREE.Vector3(-0.24, 0.95, 0.46), new THREE.Vector3(0.24, 0.95, 0.46)];
  const tmp = new THREE.Vector3();
  const pedalWorld = new THREE.Vector3();

  function update(state: CyclistState) {
    root.position.set(state.position.x, 0, state.position.z);
    root.rotation.set(0, Math.atan2(state.heading.x, state.heading.z), 0);
    leanGroup.rotation.z = -state.lean;
    const w = wheelAngle(state.distanceM);
    rearWheel.rotation.x = w;
    frontWheel.rotation.x = w;
    crank.rotation.x = crankAngle(state.distanceM);
    for (const pedal of crankArms) {
      // Pedals stay level while the cranks turn.
      pedal.rotation.x = -(crank.rotation.x + pedal.parent!.rotation.x);
    }
    root.updateMatrixWorld(true);
    for (let i = 0; i < 2; i++) {
      const leg = person.legs[i];
      crankArms[i === 0 ? 0 : 1].getWorldPosition(pedalWorld);
      pedalWorld.y += 0.05;
      const pole = tmp.set(0, 0, 1).applyQuaternion(root.quaternion);
      solveTwoBone(leg.thigh, leg.shin, THIGH - 0.02, SHIN - 0.02, pedalWorld, pole);
      leg.shin.getWorldQuaternion(_q);
      leg.foot.quaternion.copy(_q.invert().multiply(root.quaternion));
      const arm = person.arms[i];
      const g = grips[i].clone().applyMatrix4(leanGroup.matrixWorld);
      const elbowPole = tmp.set(i === 0 ? -0.5 : 0.5, -1, -0.2).applyQuaternion(root.quaternion);
      solveTwoBone(arm.upper, arm.fore, UPPER_ARM - 0.02, FOREARM + 0.035, g, elbowPole);
      // Palms down on the bar.
      arm.hand.rotation.set(0.25, i === 1 ? Math.PI / 2 : -Math.PI / 2, 0);
    }
  }

  return { root, person, update, meshes };
}

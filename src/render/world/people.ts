/**
 * Procedural articulated people and a bicycle.
 *
 * Proportions follow standard anthropometric tables for a ~1.70 m adult
 * (head ≈ 1/7.5 of height, hip joint ≈ 0.53 H, shoulder ≈ 0.82 H). The figures
 * are stylised mannequins rather than photoreal humans — see
 * docs/known-approximations.md — but scale, pose and silhouette are correct,
 * which is what matters for framing, focus and motion lessons.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { patchMaterial } from './materials';
import { fabricTexture } from './textures';
import { crankAngle, wheelAngle, WHEEL_RADIUS_M, type CyclistState } from '../../world/actors';

export interface PersonLook {
  skin: string;
  top: string;
  topLongSleeves: boolean;
  bottom: string;
  bottomShort: boolean;
  shoes: string;
  hair: string;
  longHair: boolean;
  helmet?: string;
}

export interface Person {
  root: THREE.Group;
  pelvis: THREE.Group;
  chest: THREE.Group;
  neck: THREE.Group;
  head: THREE.Group;
  arms: { upper: THREE.Group; fore: THREE.Group; hand: THREE.Group }[];
  legs: { thigh: THREE.Group; shin: THREE.Group; foot: THREE.Group }[];
  /** Eye positions (for eye-focus and critique). */
  eyes: THREE.Object3D[];
  meshes: THREE.Mesh[];
}

const THIGH = 0.43;
const SHIN = 0.42;
const UPPER_ARM = 0.29;
const FOREARM = 0.26;

let fabricMap: THREE.Texture | null = null;

function mat(color: string, roughness: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return patchMaterial(new THREE.MeshStandardMaterial({ color, roughness, ...opts }));
}

function capsule(radius: number, length: number, rTop = radius, segments = 16): THREE.BufferGeometry {
  // Tapered capsule hanging from the joint (y = 0) down to y = -length:
  // a sphere of radius rTop at the joint blended into a sphere of radius `radius` at the end.
  const pts: THREE.Vector2[] = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(1e-4, radius * Math.sin(a)), -length - radius * Math.cos(a)));
  }
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(1e-4, rTop * Math.cos(a)), rTop * Math.sin(a)));
  }
  const g = new THREE.LatheGeometry(pts, segments);
  g.computeVertexNormals();
  return g;
}

function ellipsoid(rx: number, ry: number, rz: number, w = 24, h = 16): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(rx, ry, rz);
  return g;
}

function headGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 48, 36);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // Egg-shaped cranium, narrower jaw and chin, flatter face.
    const jaw = v.y < 0 ? 1 - 0.28 * Math.pow(-v.y, 1.4) : 1 - 0.05 * v.y;
    let x = v.x * 0.074 * jaw;
    let z = v.z * 0.098 * (v.z > 0 ? 0.95 : 1.05);
    const y = v.y * 0.118;
    if (v.z > 0.4 && v.y < -0.35) z += (-v.y - 0.35) * 0.01; // chin
    if (v.z < -0.2) x *= 1.02;
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

function torsoGeometry(topShape: 'shirt' | 'jersey'): THREE.BufferGeometry {
  // Profile from hips up to the base of the neck (y relative to hip joints).
  const prof: [number, number][] =
    topShape === 'shirt'
      ? [
          [0.001, -0.08],
          [0.15, -0.07],
          [0.172, 0.0],
          [0.16, 0.1],
          [0.145, 0.18],
          [0.158, 0.3],
          [0.178, 0.4],
          [0.19, 0.47],
          [0.17, 0.52],
          [0.1, 0.56],
          [0.062, 0.575],
          [0.001, 0.58],
        ]
      : [
          [0.001, -0.08],
          [0.145, -0.07],
          [0.165, 0.0],
          [0.15, 0.1],
          [0.138, 0.18],
          [0.15, 0.3],
          [0.17, 0.4],
          [0.182, 0.47],
          [0.165, 0.52],
          [0.1, 0.56],
          [0.06, 0.575],
          [0.001, 0.58],
        ];
  const g = new THREE.LatheGeometry(
    prof.map(([r, y]) => new THREE.Vector2(r, y)),
    32,
  );
  g.scale(1, 1, 0.62);
  g.computeVertexNormals();
  return g;
}

function limb(parent: THREE.Object3D, pos: THREE.Vector3, geo: THREE.BufferGeometry, material: THREE.Material, meshes: THREE.Mesh[]) {
  const joint = new THREE.Group();
  joint.position.copy(pos);
  parent.add(joint);
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
  joint.add(m);
  meshes.push(m);
  return joint;
}

export function createPerson(look: PersonLook): Person {
  fabricMap ??= fabricTexture();
  const meshes: THREE.Mesh[] = [];
  const skin = mat(look.skin, 0.55);
  const top = mat(look.top, 0.85, { map: fabricMap });
  const bottom = mat(look.bottom, 0.8);
  const shoes = mat(look.shoes, 0.6);
  const hair = mat(look.hair, 0.6);

  const root = new THREE.Group();
  root.name = look.helmet ? 'cyclist' : 'portrait subject';
  const pelvis = new THREE.Group();
  pelvis.position.set(0, 0.93, 0);
  root.add(pelvis);

  // Hips / trousers seat.
  const hips = new THREE.Mesh(ellipsoid(0.165, 0.11, 0.11), bottom);
  hips.position.set(0, -0.02, 0);
  hips.castShadow = true;
  pelvis.add(hips);
  meshes.push(hips);

  const chest = new THREE.Group();
  chest.position.set(0, 0.02, 0);
  pelvis.add(chest);
  const torso = new THREE.Mesh(torsoGeometry(look.helmet ? 'jersey' : 'shirt'), top);
  torso.castShadow = true;
  torso.receiveShadow = true;
  chest.add(torso);
  meshes.push(torso);

  const neck = new THREE.Group();
  neck.position.set(0, 0.54, 0.0);
  chest.add(neck);
  const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.052, 0.12, 16), skin);
  neckMesh.position.y = 0.05;
  neckMesh.castShadow = true;
  neck.add(neckMesh);
  meshes.push(neckMesh);

  const head = new THREE.Group();
  head.position.set(0, 0.15, 0.012);
  neck.add(head);
  const headMesh = new THREE.Mesh(headGeometry(), skin);
  headMesh.position.y = 0.035;
  headMesh.castShadow = true;
  headMesh.receiveShadow = true;
  head.add(headMesh);
  meshes.push(headMesh);

  // Facial features (relative to head centre at y = 0.035).
  const eyes: THREE.Object3D[] = [];
  const sclera = mat('#e9e4dc', 0.25);
  const iris = mat('#2d1d12', 0.15);
  const brow = mat(look.hair, 0.8);
  const lips = mat('#a8594f', 0.45);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(sx * 0.032, 0.05, 0.078);
    head.add(eye);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.0125, 16, 12), sclera);
    eye.add(ball);
    const ir = new THREE.Mesh(new THREE.SphereGeometry(0.0072, 12, 10), iris);
    ir.position.z = 0.0085;
    eye.add(ir);
    eyes.push(eye);
    const b = new THREE.Mesh(ellipsoid(0.02, 0.0045, 0.006), brow);
    b.position.set(sx * 0.033, 0.074, 0.087);
    b.rotation.z = sx * -0.12;
    head.add(b);
    const ear = new THREE.Mesh(ellipsoid(0.012, 0.03, 0.02), skin);
    ear.position.set(sx * 0.074, 0.035, 0.0);
    head.add(ear);
    meshes.push(ball, ir, b, ear);
  }
  const nose = new THREE.Mesh(ellipsoid(0.013, 0.026, 0.02), skin);
  nose.position.set(0, 0.022, 0.094);
  nose.rotation.x = -0.25;
  head.add(nose);
  const mouth = new THREE.Mesh(ellipsoid(0.022, 0.007, 0.01), lips);
  mouth.position.set(0, -0.022, 0.089);
  head.add(mouth);
  meshes.push(nose, mouth);

  if (look.helmet) {
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.135, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.55),
      mat(look.helmet, 0.35),
    );
    helmet.scale.set(0.95, 0.9, 1.2);
    helmet.position.set(0, 0.07, -0.01);
    helmet.castShadow = true;
    head.add(helmet);
    meshes.push(helmet);
  } else {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24, 0, Math.PI * 2, 0, 2.05), hair);
    cap.scale.set(0.082, 0.126, 0.106);
    cap.position.set(0, 0.043, -0.008);
    cap.rotation.x = 0.42;
    cap.castShadow = true;
    head.add(cap);
    meshes.push(cap);
    if (look.longHair) {
      const fall = new THREE.Mesh(ellipsoid(0.085, 0.16, 0.05), hair);
      fall.position.set(0, -0.07, -0.055);
      fall.rotation.x = 0.12;
      fall.castShadow = true;
      head.add(fall);
      meshes.push(fall);
    }
  }

  // Arms.
  const arms: Person['arms'] = [];
  const sleeve = look.topLongSleeves ? top : skin;
  for (const sx of [-1, 1]) {
    const upper = limb(chest, new THREE.Vector3(sx * 0.19, 0.45, 0), capsule(0.043, UPPER_ARM, 0.052), top, meshes);
    const fore = limb(upper, new THREE.Vector3(0, -UPPER_ARM + 0.02, 0), capsule(0.034, FOREARM, 0.042), sleeve, meshes);
    const hand = limb(fore, new THREE.Vector3(0, -FOREARM + 0.015, 0), ellipsoid(0.025, 0.085, 0.045), skin, meshes);
    (hand.children[0] as THREE.Mesh).position.y = -0.07;
    arms.push({ upper, fore, hand });
  }

  // Legs.
  const legs: Person['legs'] = [];
  const shinMat = look.bottomShort ? skin : bottom;
  for (const sx of [-1, 1]) {
    const thigh = limb(pelvis, new THREE.Vector3(sx * 0.092, -0.02, 0), capsule(0.058, THIGH, 0.082), bottom, meshes);
    const shin = limb(thigh, new THREE.Vector3(0, -THIGH + 0.02, 0), capsule(0.042, SHIN, 0.055), shinMat, meshes);
    const foot = new THREE.Group();
    foot.position.set(0, -SHIN + 0.04, 0);
    shin.add(foot);
    const shoe = new THREE.Mesh(ellipsoid(0.048, 0.042, 0.13), shoes);
    shoe.position.set(0, -0.03, 0.06);
    shoe.castShadow = true;
    foot.add(shoe);
    meshes.push(shoe);
    legs.push({ thigh, shin, foot });
  }

  return { root, pelvis, chest, neck, head, arms, legs, eyes, meshes };
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
  const upperDir = dir.clone().applyAxisAngle(bendAxis, -a);
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
      solveTwoBone(arm.upper, arm.fore, UPPER_ARM - 0.02, FOREARM + 0.05, g, elbowPole);
    }
  }

  return { root, person, update, meshes };
}

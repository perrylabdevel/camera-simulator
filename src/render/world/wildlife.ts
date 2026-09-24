/**
 * Procedural wildlife rigs: gulls in flight, pigeons on the ground and a
 * squirrel. Motion comes from src/world/wildlife.ts (pure functions of time).
 * Sizes are real: a gull spans ~1.3 m, a pigeon is ~0.32 m long, a grey
 * squirrel's body ~0.25 m plus a ~0.2 m tail.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { patchMaterial } from './materials';
import type { BirdState, SquirrelState, WalkerState } from '../../world/wildlife';

function mat(color: string, roughness = 0.7, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return patchMaterial(new THREE.MeshStandardMaterial({ color, roughness, ...extra }));
}

function ellipsoid(rx: number, ry: number, rz: number, w = 20, h = 14): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(rx, ry, rz);
  return g;
}

function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  return o;
}

/* ------------------------------------------------------------------------ */
/* Gull                                                                      */
/* ------------------------------------------------------------------------ */

/**
 * Wing panel from root (x=0) to `span` along +x, with a swept, tapered
 * planform. Vertex colours paint black tips on the outer panel.
 */
function wingPanel(span: number, chordRoot: number, chordTip: number, sweep: number, tipBlack: boolean): THREE.BufferGeometry {
  const seg = 8;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  // Gull wings are pale grey above and white below; we see both sides.
  const grey = new THREE.Color('#c3c9ce');
  const white = new THREE.Color('#eef0f1');
  const black = new THREE.Color('#1c1c1e');
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    const x = u * span;
    const chord = chordRoot + (chordTip - chordRoot) * u * u;
    const lead = -sweep * u * u; // leading edge sweeps back towards the tip
    // Slight camber: the middle of the chord is raised.
    for (const [v, c] of [
      [0, 0],
      [0.5, 1],
      [1, 0],
    ]) {
      const z = lead - v * chord + chord * 0.35;
      pos.push(x, c * chord * 0.06, z);
      const colr = tipBlack && u > 0.55 ? black : v === 1 && !tipBlack && u < 0.2 ? white : grey;
      col.push(colr.r, colr.g, colr.b);
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let k = 0; k < 2; k++) {
      const a = i * 3 + k;
      const b = a + 3;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export interface Gull {
  root: THREE.Group;
  update(s: BirdState): void;
}

export function createGull(): Gull {
  const root = new THREE.Group();
  root.name = 'gull';
  const body = new THREE.Group();
  root.add(body);
  const white = mat('#eef0f1', 0.55);
  const grey = mat('#9aa3ab', 0.6);
  const beakMat = mat('#e9b62a', 0.45);
  const wingMat = mat('#ffffff', 0.6, { vertexColors: true, side: THREE.DoubleSide });

  const torso = new THREE.Mesh(ellipsoid(0.065, 0.06, 0.2), white);
  const back = new THREE.Mesh(ellipsoid(0.06, 0.03, 0.15), grey);
  back.position.set(0, 0.035, -0.02);
  const head = new THREE.Mesh(ellipsoid(0.042, 0.042, 0.05), white);
  head.position.set(0, 0.03, 0.2);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.06, 8), beakMat);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.022, 0.265);
  const tail = new THREE.Mesh(ellipsoid(0.055, 0.01, 0.07), white);
  tail.position.set(0, 0.01, -0.22);
  const eyes = new THREE.Mesh(
    mergeGeometries([new THREE.SphereGeometry(0.006, 8, 6).translate(0.03, 0.04, 0.215), new THREE.SphereGeometry(0.006, 8, 6).translate(-0.03, 0.04, 0.215)])!,
    mat('#111111', 0.2),
  );
  body.add(torso, back, head, beak, tail, eyes);

  const wings: { inner: THREE.Group; outer: THREE.Group; side: number }[] = [];
  for (const side of [-1, 1]) {
    const inner = new THREE.Group();
    inner.position.set(side * 0.05, 0.03, 0.04);
    inner.scale.x = side;
    body.add(inner);
    const innerMesh = new THREE.Mesh(wingPanel(0.3, 0.2, 0.17, 0.02, false), wingMat);
    inner.add(innerMesh);
    const outer = new THREE.Group();
    outer.position.set(0.3, 0, 0);
    inner.add(outer);
    const outerMesh = new THREE.Mesh(wingPanel(0.34, 0.17, 0.06, 0.12, true), wingMat);
    outerMesh.position.z = -0.005;
    outer.add(outerMesh);
    wings.push({ inner, outer, side });
  }
  shadowed(root);

  return {
    root,
    update(s) {
      root.position.set(s.position.x, s.position.y, s.position.z);
      const yaw = Math.atan2(s.heading.x, s.heading.z);
      root.rotation.set(0, yaw, 0);
      body.rotation.set(-0.05, 0, -s.bank);
      for (const w of wings) {
        // inner.scale.x mirrors the right wing, so the same angle raises both.
        w.inner.rotation.z = s.wing;
        w.outer.rotation.z = s.wingTip;
      }
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Pigeon                                                                    */
/* ------------------------------------------------------------------------ */

export interface Pigeon {
  root: THREE.Group;
  update(s: WalkerState): void;
}

export function createPigeon(tint = 0): Pigeon {
  const root = new THREE.Group();
  root.name = 'pigeon';
  const body = new THREE.Group();
  body.position.y = 0.1;
  root.add(body);
  const plumage = mat(new THREE.Color('#7d8590').offsetHSL(0, 0, tint).getStyle(), 0.7);
  const dark = mat('#4a4f57', 0.7);
  const neckMat = mat('#5e7a6e', 0.35, { metalness: 0.3 }); // iridescent neck
  const legMat = mat('#c46a6a', 0.5);

  const torso = new THREE.Mesh(ellipsoid(0.06, 0.06, 0.11), plumage);
  const wingL = new THREE.Mesh(ellipsoid(0.02, 0.04, 0.1), dark);
  wingL.position.set(0.05, 0.01, -0.03);
  const wingR = wingL.clone();
  wingR.position.x = -0.05;
  const tail = new THREE.Mesh(ellipsoid(0.035, 0.01, 0.07), dark);
  tail.position.set(0, 0.01, -0.13);
  tail.rotation.x = -0.25;
  body.add(torso, wingL, wingR, tail);

  const neck = new THREE.Group();
  neck.position.set(0, 0.04, 0.07);
  body.add(neck);
  const neckMesh = new THREE.Mesh(ellipsoid(0.035, 0.05, 0.035), neckMat);
  neckMesh.position.set(0, 0.03, 0.01);
  const head = new THREE.Mesh(ellipsoid(0.026, 0.026, 0.032), plumage);
  head.position.set(0, 0.075, 0.025);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.022, 6), mat('#3a3a3a', 0.5));
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.072, 0.063);
  neck.add(neckMesh, head, beak);

  const legs = new THREE.Mesh(
    mergeGeometries([new THREE.CylinderGeometry(0.004, 0.004, 0.06, 5).translate(0.02, 0.03, 0), new THREE.CylinderGeometry(0.004, 0.004, 0.06, 5).translate(-0.02, 0.03, 0)])!,
    legMat,
  );
  root.add(legs);
  shadowed(root);

  return {
    root,
    update(s) {
      root.position.set(s.position.x, 0, s.position.z);
      root.rotation.y = s.yaw;
      // Pecking: lower the whole front and swing the neck down.
      body.rotation.x = 0.35 * s.peck;
      neck.rotation.x = 0.9 * s.peck;
      neck.position.z = 0.07 + s.bob * 2;
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Squirrel                                                                  */
/* ------------------------------------------------------------------------ */

export interface Squirrel {
  root: THREE.Group;
  update(s: SquirrelState): void;
}

export function createSquirrel(): Squirrel {
  const root = new THREE.Group();
  root.name = 'squirrel';
  const body = new THREE.Group();
  root.add(body);
  const fur = mat('#7c7166', 0.9);
  const belly = mat('#d8cfc2', 0.9);

  const torso = new THREE.Mesh(ellipsoid(0.045, 0.05, 0.1), fur);
  torso.position.set(0, 0.07, 0);
  const chest = new THREE.Mesh(ellipsoid(0.03, 0.035, 0.05), belly);
  chest.position.set(0, 0.055, 0.06);
  const head = new THREE.Group();
  head.position.set(0, 0.1, 0.1);
  const skull = new THREE.Mesh(ellipsoid(0.032, 0.03, 0.04), fur);
  const snout = new THREE.Mesh(ellipsoid(0.018, 0.016, 0.02), fur);
  snout.position.set(0, -0.008, 0.035);
  const ears = new THREE.Mesh(
    mergeGeometries([new THREE.ConeGeometry(0.01, 0.025, 6).translate(0.018, 0.035, -0.01), new THREE.ConeGeometry(0.01, 0.025, 6).translate(-0.018, 0.035, -0.01)])!,
    fur,
  );
  const eyes = new THREE.Mesh(
    mergeGeometries([new THREE.SphereGeometry(0.006, 8, 6).translate(0.022, 0.008, 0.022), new THREE.SphereGeometry(0.006, 8, 6).translate(-0.022, 0.008, 0.022)])!,
    mat('#0b0b0b', 0.15),
  );
  head.add(skull, snout, ears, eyes);

  // Bushy S-shaped tail: a tube along a curve, thicker in the middle.
  const tailGroup = new THREE.Group();
  tailGroup.position.set(0, 0.07, -0.09);
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0.06, -0.07),
    new THREE.Vector3(0, 0.17, -0.06),
    new THREE.Vector3(0, 0.24, 0.0),
    new THREE.Vector3(0, 0.25, 0.04),
  ]);
  const tailGeo = new THREE.TubeGeometry(curve, 24, 1, 10);
  const p = tailGeo.attributes.position as THREE.BufferAttribute;
  // Re-scale the unit-radius tube: radius grows then tapers along the tail.
  const pts = curve.getSpacedPoints(24);
  for (let i = 0; i < p.count; i++) {
    const ring = Math.floor(i / 11);
    const c = pts[Math.min(ring, pts.length - 1)];
    const u = ring / 24;
    const r = 0.012 + 0.038 * Math.sin(Math.PI * Math.min(1, u * 1.1)) ** 0.7;
    const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).sub(c).normalize().multiplyScalar(r).add(c);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  tailGeo.computeVertexNormals();
  tailGroup.add(new THREE.Mesh(tailGeo, fur));

  const legGeo = new THREE.CapsuleGeometry(0.012, 0.04, 3, 6);
  const legs: THREE.Mesh[] = [];
  for (const [x, z] of [
    [0.03, 0.06],
    [-0.03, 0.06],
    [0.035, -0.06],
    [-0.035, -0.06],
  ]) {
    const l = new THREE.Mesh(legGeo, fur);
    l.position.set(x, 0.03, z);
    legs.push(l);
  }
  body.add(torso, chest, head, tailGroup, ...legs);
  shadowed(root);

  return {
    root,
    update(s) {
      root.position.set(s.position.x, s.hop, s.position.z);
      root.rotation.y = s.yaw;
      const g = s.gait * Math.PI * 2;
      const moving = s.speedMps > 0;
      // Bounding gait: the back arches and stretches each stride.
      body.rotation.x = moving ? 0.25 * Math.sin(g) : -0.25; // sits up slightly when stopped
      head.rotation.x = moving ? -0.2 * Math.sin(g) : 0.3 * s.peck - 0.2;
      tailGroup.rotation.x = moving ? -0.6 + 0.25 * Math.sin(g + 1) : 0;
      legs[0].rotation.x = legs[1].rotation.x = moving ? 0.9 * Math.sin(g) : 0;
      legs[2].rotation.x = legs[3].rotation.x = moving ? -0.9 * Math.sin(g) : 0;
    },
  };
}

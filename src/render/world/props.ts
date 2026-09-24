/** Park furniture and architecture: bench, lamp posts, bin and pavilion. */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { patchMaterial } from './materials';
import { plasterTexture, woodTexture } from './textures';

function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  return o;
}

export function createBench(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'bench';
  const wood = patchMaterial(new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.75 }));
  const iron = patchMaterial(new THREE.MeshStandardMaterial({ color: '#1d231f', roughness: 0.5, metalness: 0.7 }));
  const slats: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const s = new THREE.BoxGeometry(1.8, 0.035, 0.09);
    s.translate(0, 0.45, -0.18 + i * 0.12);
    slats.push(s);
  }
  for (let i = 0; i < 3; i++) {
    const s = new THREE.BoxGeometry(1.8, 0.09, 0.03);
    s.rotateX(-0.25);
    s.translate(0, 0.58 + i * 0.12, -0.26 - i * 0.03);
    slats.push(s);
  }
  g.add(new THREE.Mesh(mergeGeometries(slats)!, wood));
  const legs: THREE.BufferGeometry[] = [];
  for (const x of [-0.75, 0.75]) {
    const a = new THREE.BoxGeometry(0.05, 0.45, 0.05);
    a.translate(x, 0.225, 0.12);
    const b = new THREE.BoxGeometry(0.05, 0.85, 0.05);
    b.rotateX(-0.2);
    b.translate(x, 0.42, -0.24);
    const c = new THREE.BoxGeometry(0.05, 0.04, 0.5);
    c.translate(x, 0.42, -0.05);
    legs.push(a, b, c);
  }
  g.add(new THREE.Mesh(mergeGeometries(legs)!, iron));
  return shadowed(g);
}

export function createLampPost(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'lamp';
  const iron = patchMaterial(new THREE.MeshStandardMaterial({ color: '#23302a', roughness: 0.35, metalness: 0.8 }));
  const glass = patchMaterial(
    new THREE.MeshStandardMaterial({ color: '#e9eef0', roughness: 0.08, metalness: 0.0, transparent: false }),
  );
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.07, 3.6, 16), iron);
  pole.position.y = 1.8;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.5, 16), iron);
  base.position.y = 0.25;
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.1, 0.38, 6), glass);
  lantern.position.y = 3.75;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.23, 0.2, 6), iron);
  cap.position.y = 4.04;
  g.add(pole, base, lantern, cap);
  return shadowed(g);
}

export function createTrashBin(): THREE.Group {
  const g = new THREE.Group();
  const m = patchMaterial(new THREE.MeshStandardMaterial({ color: '#2c3b30', roughness: 0.55, metalness: 0.5 }));
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.24, 0.85, 20, 1, true), m);
  body.position.y = 0.43;
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.05, 20), m);
  lid.position.y = 0.88;
  g.add(body, lid);
  return shadowed(g);
}

/** Octagonal white pavilion — the scene's brightest sunlit surfaces. */
export function createPavilion(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'pavilion';
  const plaster = patchMaterial(new THREE.MeshStandardMaterial({ map: plasterTexture(), roughness: 0.8 }));
  const roofMat = patchMaterial(new THREE.MeshStandardMaterial({ color: '#5b6167', roughness: 0.55, metalness: 0.3 }));
  const stone = patchMaterial(new THREE.MeshStandardMaterial({ color: '#b8b2a6', roughness: 0.9 }));
  const R = 3.2;
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.5, R + 0.6, 0.45, 8), stone);
  floor.position.y = 0.22;
  floor.rotation.y = Math.PI / 8;
  g.add(floor);
  const cols: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const c = new THREE.CylinderGeometry(0.14, 0.16, 2.9, 16);
    c.translate(Math.cos(a) * R, 0.45 + 1.45, Math.sin(a) * R);
    cols.push(c);
  }
  const ring = new THREE.CylinderGeometry(R + 0.35, R + 0.35, 0.45, 8, 1, true);
  ring.rotateY(Math.PI / 8);
  ring.translate(0, 3.55, 0);
  cols.push(ring);
  const rail = new THREE.TorusGeometry(R, 0.05, 6, 8);
  rail.rotateX(Math.PI / 2);
  rail.rotateY(Math.PI / 8);
  rail.translate(0, 1.35, 0);
  cols.push(rail);
  g.add(new THREE.Mesh(mergeGeometries(cols.map((c) => c.toNonIndexed()))!, plaster));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(R + 0.9, 2.0, 8, 1), roofMat);
  roof.position.y = 4.75;
  roof.rotation.y = Math.PI / 8;
  const ceiling = new THREE.Mesh(new THREE.CircleGeometry(R + 0.35, 8), plaster);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = 3.33;
  g.add(roof, ceiling);
  return shadowed(g);
}

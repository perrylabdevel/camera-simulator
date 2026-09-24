/**
 * Procedural broadleaf trees: recursive tapered branches plus alpha-tested
 * leaf-cluster cards. Each species is generated once and drawn with
 * instancing, so dozens of trees cost only a handful of draw calls.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from './noise';

export interface TreeStyle {
  seed: number;
  height: number;
  trunkRadius: number;
  /** Height of the first split as a fraction of total height. */
  trunkFraction: number;
  crownRadius: number;
  /** Vertical stretch of the crown (1 = round, >1 = tall oval). */
  crownStretch: number;
  limbs: number;
  depth: number;
  leafCardSize: number;
  leavesPerTip: number;
  /** Radial segments for the trunk (branches use fewer). */
  sides: number;
}

export interface TreeGeometry {
  wood: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
  /** Local-space crown centre and radius (for sky occlusion and focus proxies). */
  crownCenter: THREE.Vector3;
  crownRadius: number;
}

const up = new THREE.Vector3(0, 1, 0);

class TubeBuilder {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  indices: number[] = [];

  /** Add a tapered tube through `pts` with radii `radii`. */
  add(pts: THREE.Vector3[], radii: number[], sides: number): void {
    const base = this.positions.length / 3;
    let prevNormal = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    let vAcc = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (i < pts.length - 1) tangent.subVectors(pts[i + 1], p).normalize();
      else tangent.subVectors(p, pts[i - 1]).normalize();
      if (i === 0) {
        const ref = Math.abs(tangent.y) < 0.9 ? up : new THREE.Vector3(1, 0, 0);
        prevNormal = new THREE.Vector3().crossVectors(tangent, ref).normalize();
      } else {
        // Parallel transport keeps the rings from twisting.
        const b = new THREE.Vector3().crossVectors(tangent, prevNormal);
        prevNormal = new THREE.Vector3().crossVectors(b, tangent).normalize();
      }
      const binormal = new THREE.Vector3().crossVectors(tangent, prevNormal).normalize();
      if (i > 0) vAcc += pts[i].distanceTo(pts[i - 1]);
      for (let s = 0; s <= sides; s++) {
        const a = (s / sides) * Math.PI * 2;
        const n = prevNormal.clone().multiplyScalar(Math.cos(a)).addScaledVector(binormal, Math.sin(a));
        const r = radii[i];
        this.positions.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
        this.normals.push(n.x, n.y, n.z);
        this.uvs.push(s / sides, vAcc / (radii[0] * 6 + 0.2));
      }
    }
    const ring = sides + 1;
    for (let i = 0; i < pts.length - 1; i++) {
      for (let s = 0; s < sides; s++) {
        const a = base + i * ring + s;
        const b = a + ring;
        this.indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setIndex(this.indices);
    return g;
  }
}

function randomUnit(rand: () => number): THREE.Vector3 {
  const z = rand() * 2 - 1;
  const a = rand() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return new THREE.Vector3(r * Math.cos(a), z, r * Math.sin(a));
}

export function generateTree(style: TreeStyle): TreeGeometry {
  const rand = mulberry32(style.seed);
  const wood = new TubeBuilder();
  const tips: THREE.Vector3[] = [];
  const trunkTop = style.height * style.trunkFraction;
  const crownCenter = new THREE.Vector3(0, style.height - style.crownRadius * style.crownStretch * 0.95, 0);

  function branch(start: THREE.Vector3, dir: THREE.Vector3, length: number, radius: number, depth: number) {
    const segs = depth === 0 ? 6 : 4;
    const pts = [start.clone()];
    const radii = [radius];
    const d = dir.clone();
    const p = start.clone();
    for (let i = 1; i <= segs; i++) {
      // Gentle wander plus phototropism.
      d.add(randomUnit(rand).multiplyScalar(0.18)).addScaledVector(up, depth === 0 ? 0.05 : 0.08).normalize();
      p.addScaledVector(d, length / segs);
      pts.push(p.clone());
      radii.push(radius * (1 - (0.65 * i) / segs));
    }
    wood.add(pts, radii, depth === 0 ? style.sides : Math.max(3, style.sides - 2 - depth));
    // Foliage grows along the outer branches, not just at their tips.
    if (depth >= style.depth - 1) {
      const spacing = style.leafCardSize * 0.55;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const n = Math.max(1, Math.round(a.distanceTo(b) / spacing));
        for (let k = 0; k < n; k++) {
          if (depth < style.depth && rand() < 0.5) continue;
          tips.push(a.clone().lerp(b, (k + rand()) / n));
        }
      }
    }
    if (depth >= style.depth) {
      tips.push(p.clone(), p.clone());
      return;
    }
    const children = depth === 0 ? style.limbs : 2 + Math.floor(rand() * 2);
    for (let c = 0; c < children; c++) {
      const along = depth === 0 ? 0.55 + 0.45 * (c / children) + rand() * 0.05 : 0.45 + rand() * 0.55;
      const idx = Math.min(pts.length - 1, Math.max(1, Math.round(along * segs)));
      const origin = pts[idx];
      const r = radii[idx] * (depth === 0 ? 0.72 : 0.68);
      // Spread children around the parent; bias outward from the crown axis.
      const outward = new THREE.Vector3(origin.x, 0, origin.z);
      if (outward.lengthSq() < 1e-4) outward.copy(randomUnit(rand).setY(0));
      outward.normalize();
      const az = (c / children) * Math.PI * 2 + rand() * 0.8;
      const spread = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
      const nd = d
        .clone()
        .multiplyScalar(0.55)
        .addScaledVector(spread, depth === 0 ? 0.9 : 0.6)
        .addScaledVector(outward, 0.4)
        .addScaledVector(up, 0.35 * style.crownStretch)
        .normalize();
      const len =
        depth === 0
          ? style.crownRadius * (0.95 + rand() * 0.3)
          : length * (0.55 + rand() * 0.2);
      branch(origin, nd, len, r, depth + 1);
    }
  }

  branch(new THREE.Vector3(0, -0.3, 0), up.clone(), trunkTop + 0.3 + style.crownRadius * 0.35, style.trunkRadius, 0);
  // Fill the crown interior so it never looks hollow from below or through gaps.
  const fill = Math.round(tips.length * 0.12);
  for (let i = 0; i < fill; i++) {
    const r = Math.cbrt(rand()) * style.crownRadius * 0.75;
    const d = randomUnit(rand).multiplyScalar(r);
    d.y *= style.crownStretch;
    tips.push(crownCenter.clone().add(d));
  }

  // Leaf cards around every branch tip, squeezed into the crown envelope.
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const q = new THREE.Quaternion();
  const corners = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ];
  for (const tip of tips) {
    for (let k = 0; k < style.leavesPerTip; k++) {
      const center = tip.clone().add(randomUnit(rand).multiplyScalar(style.leafCardSize * 0.45));
      // Keep inside the crown ellipsoid so silhouettes stay tree-like.
      const rel = center.clone().sub(crownCenter);
      rel.y /= style.crownStretch;
      const maxR = style.crownRadius * 1.1;
      if (rel.length() > maxR) {
        rel.setLength(maxR - rand() * 0.4);
        rel.y *= style.crownStretch;
        center.copy(crownCenter).add(rel);
      }
      const size = style.leafCardSize * (0.75 + rand() * 0.5);
      q.setFromAxisAngle(randomUnit(rand), rand() * Math.PI * 2);
      const outward = center.clone().sub(crownCenter);
      outward.y /= style.crownStretch;
      outward.normalize().addScaledVector(up, 0.35).normalize();
      const base = positions.length / 3;
      for (const [cx, cy] of corners) {
        const v = new THREE.Vector3(cx * size, cy * size, 0).applyQuaternion(q).add(center);
        positions.push(v.x, v.y, v.z);
        normals.push(outward.x, outward.y, outward.z);
        uvs.push(cx + 0.5, cy + 0.5);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  leaves.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  leaves.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  leaves.setIndex(indices);
  leaves.computeBoundingSphere();

  const woodGeo = wood.build();
  woodGeo.computeBoundingSphere();
  return { wood: woodGeo, leaves, crownCenter, crownRadius: style.crownRadius * 1.05 };
}

export function mergeTreeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(list, false)!;
}

/**
 * Ground vegetation: instanced grass clumps, tall meadow grass and
 * wildflowers. Grass sways with a gentle wind that is a pure function of
 * world time, so long exposures integrate it consistently.
 */

import * as THREE from 'three';
import { GLSL_NOISE, patchMaterial } from './materials';
import { mulberry32 } from './noise';
import { flowerTexture } from './textures';

/** A clump of `blades` curved blades as one geometry. Attribute `aT` = height fraction. */
function clumpGeometry(blades: number, height: number, width: number, seed: number): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const at: number[] = [];
  const idx: number[] = [];
  const segs = 4;
  for (let b = 0; b < blades; b++) {
    const ang = rand() * Math.PI * 2;
    const r = rand() * width * 1.5;
    const ox = Math.cos(ang) * r;
    const oz = Math.sin(ang) * r;
    const h = height * (0.6 + rand() * 0.6);
    const lean = (rand() - 0.2) * 0.6;
    const face = rand() * Math.PI;
    const dx = Math.cos(face);
    const dz = Math.sin(face);
    const bendDir = [Math.cos(ang + 0.5), Math.sin(ang + 0.5)];
    const base = pos.length / 3;
    const shade = 0.75 + rand() * 0.4;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const w = width * (1 - t * 0.92) * 0.5;
      const bend = lean * t * t * h;
      const cx = ox + bendDir[0] * bend;
      const cz = oz + bendDir[1] * bend;
      const y = h * t;
      pos.push(cx - dx * w, y, cz - dz * w, cx + dx * w, y, cz + dz * w);
      // Normals biased upward so blades shade like the lawn they compose.
      for (let k = 0; k < 2; k++) nrm.push(-dz * 0.35, 0.93, dx * 0.35);
      const g = shade * (0.55 + 0.45 * t);
      for (let k = 0; k < 2; k++) col.push(g * 0.95, g, g * 0.9);
      at.push(t, t);
    }
    for (let i = 0; i < segs; i++) {
      const a = base + i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(at, 1));
  g.setIndex(idx);
  return g;
}

const WIND_VERTEX = /* glsl */ `
  {
    vec3 ip = vec3(0.0);
    #ifdef USE_INSTANCING
      ip = instanceMatrix[3].xyz;
    #endif
    float gust = 0.6 + 0.4 * sin(uWorldTime * 0.7 + ip.x * 0.08 + ip.z * 0.05);
    float phase = uWorldTime * 2.3 + ip.x * 0.9 + ip.z * 0.7;
    float sway = (sin(phase) * 0.6 + sin(phase * 2.7 + 1.3) * 0.25) * gust;
    transformed.x += sway * aT * aT * uWindAmp;
    transformed.z += sway * 0.5 * aT * aT * uWindAmp;
  }
`;

export interface ScatterRegion {
  /** Returns density multiplier (0 = none) at a ground position. */
  density(x: number, z: number): number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

function scatter(count: number, region: ScatterRegion, seed: number): THREE.Vector2[] {
  const rand = mulberry32(seed);
  const pts: THREE.Vector2[] = [];
  const { minX, maxX, minZ, maxZ } = region.bounds;
  let tries = 0;
  while (pts.length < count && tries < count * 20) {
    tries++;
    const x = minX + rand() * (maxX - minX);
    const z = minZ + rand() * (maxZ - minZ);
    if (rand() < region.density(x, z)) pts.push(new THREE.Vector2(x, z));
  }
  return pts;
}

export interface GrassOptions {
  count: number;
  height: number;
  width: number;
  bladesPerClump: number;
  windAmp: number;
  seed: number;
  colorA: THREE.Color;
  colorB: THREE.Color;
}

export function createGrass(region: ScatterRegion, o: GrassOptions): THREE.InstancedMesh {
  const geo = clumpGeometry(o.bladesPerClump, o.height, o.width, o.seed);
  const material = patchMaterial(
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }),
    {
      vertexPars: 'attribute float aT; uniform float uWindAmp;',
      vertex: WIND_VERTEX,
      uniforms: { uWindAmp: { value: o.windAmp } },
      fragmentPars: GLSL_NOISE,
    },
  );
  // Grass is lit as if its normals were the ground's, even from behind.
  material.onBeforeCompile = ((orig) => (shader: THREE.WebGLProgramParametersWithUniforms, r: THREE.WebGLRenderer) => {
    orig(shader, r);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      '#include <normal_fragment_begin>\n normal = normalize(vNormal);',
    );
  })(material.onBeforeCompile);
  const pts = scatter(o.count, region, o.seed + 1);
  const mesh = new THREE.InstancedMesh(geo, material, pts.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const rand = mulberry32(o.seed + 2);
  const c = new THREE.Color();
  for (let i = 0; i < pts.length; i++) {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
    const k = 0.7 + rand() * 0.6;
    s.set(k, k * (0.8 + rand() * 0.4), k);
    m.compose(new THREE.Vector3(pts[i].x, 0, pts[i].y), q, s);
    mesh.setMatrixAt(i, m);
    c.copy(o.colorA).lerp(o.colorB, rand());
    mesh.setColorAt(i, c);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  mesh.name = 'grass';
  return mesh;
}

export function createFlowers(region: ScatterRegion, count: number, seed: number, palette: THREE.Color[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'flowers';
  const tex = flowerTexture();
  const headMat = patchMaterial(
    new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6 }),
  );
  const stemMat = patchMaterial(new THREE.MeshStandardMaterial({ color: '#4d6b2a', roughness: 0.8 }));
  const pts = scatter(count, region, seed);
  const rand = mulberry32(seed + 9);
  const head = new THREE.PlaneGeometry(0.06, 0.06);
  head.rotateX(-Math.PI / 2 + 0.35);
  const stem = new THREE.CylinderGeometry(0.0025, 0.003, 1, 4);
  stem.translate(0, 0.5, 0);
  const heads = new THREE.InstancedMesh(head, headMat, pts.length);
  const stems = new THREE.InstancedMesh(stem, stemMat, pts.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < pts.length; i++) {
    const h = 0.3 + rand() * 0.45;
    const tilt = (rand() - 0.5) * 0.3;
    q.setFromEuler(new THREE.Euler(tilt, rand() * Math.PI * 2, (rand() - 0.5) * 0.3));
    m.compose(new THREE.Vector3(pts[i].x, h, pts[i].y), q, new THREE.Vector3(1, 1, 1).multiplyScalar(0.8 + rand() * 0.6));
    heads.setMatrixAt(i, m);
    heads.setColorAt(i, palette[Math.floor(rand() * palette.length)]);
    m.compose(new THREE.Vector3(pts[i].x, 0, pts[i].y), new THREE.Quaternion(), new THREE.Vector3(1, h, 1));
    stems.setMatrixAt(i, m);
  }
  heads.castShadow = true;
  heads.receiveShadow = true;
  stems.receiveShadow = true;
  group.add(heads, stems);
  return group;
}

/**
 * The Exposure Lab: one sunny park, built to exercise every early lesson —
 * a portrait subject at a few metres, foreground meadow for foreground blur,
 * a path with a passing cyclist, deep tree shade, a bright white pavilion,
 * layered trees and a hazy skyline for depth and compression.
 */

import * as THREE from 'three';
import { luxToIntensity } from '../units';
import { createSkyDome, createSkyEnvironment, type SkyParams } from './sky';
import { canopyUniforms, GLSL_NOISE, patchMaterial, registerCanopy } from './materials';
import { barkTexture, lawnTexture, leafClusterTexture, pathTexture } from './textures';
import { generateTree, type TreeStyle } from './trees';
import { createFlowers, createGrass, type ScatterRegion } from './vegetation';
import { createBench, createLampPost, createPavilion, createTrashBin } from './props';
import { createCyclist, createPerson, poseStanding, type Cyclist, type Person } from './people';
import { mulberry32, fbm } from './noise';
import { bikePath, cyclistAt, PATH_CENTER, PATH_RADII, PATH_WIDTH, portraitSway } from '../../world/actors';
import { superellipsePoints } from '../../world/path';
import { birdAt, GULLS, PIGEON_COUNT, pigeonAt, squirrelAt } from '../../world/wildlife';
import { createGull, createPigeon, createSquirrel } from './wildlife';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityProfile {
  grassClumps: number;
  treelineTrees: number;
  shadowMapSize: number;
}

export const QUALITY_PROFILES: Record<Quality, QualityProfile> = {
  low: { grassClumps: 25000, treelineTrees: 70, shadowMapSize: 2048 },
  medium: { grassClumps: 60000, treelineTrees: 120, shadowMapSize: 2048 },
  high: { grassClumps: 110000, treelineTrees: 170, shadowMapSize: 4096 },
  ultra: { grassClumps: 180000, treelineTrees: 220, shadowMapSize: 4096 },
};

/** A photographable subject the critique system can reason about. */
export interface Subject {
  name: string;
  /** World-space point of interest (eyes, rider's torso) at the scene's current time. */
  point(target: THREE.Vector3): THREE.Vector3;
  /** Approximate world-space speed in m/s at time t. */
  speed(t: number): number;
  /** Rough radius, used to decide if it is in frame. */
  radius: number;
}

export interface LabScene {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  /** Objects the autofocus raycaster may hit (includes invisible proxies on layer 1). */
  focusTargets: THREE.Object3D[];
  subjects: Subject[];
  /** Move every animated element to world time t (seconds). */
  setTime(t: number): void;
  portrait: Person;
  cyclist: Cyclist;
}

export const SUN_DIRECTION = new THREE.Vector3(-0.467, 0.643, 0.605).normalize();
/** Direct-normal sun illuminance (lux) for a clear afternoon at ~40° elevation. */
export const SUN_ILLUMINANCE_LUX = 85000;
export const PORTRAIT_POSITION = new THREE.Vector3(0, 0, 2);

function distanceToPath(x: number, z: number): number {
  let best = Infinity;
  for (let s = 0; s < bikePath.length; s += 0.75) {
    const p = bikePath.at(s).position;
    best = Math.min(best, Math.hypot(p.x - x, p.z - z));
  }
  return best;
}

function buildGround(): THREE.Mesh {
  const size = 4000;
  const geo = new THREE.PlaneGeometry(size, size, 220, 220);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const r = Math.hypot(x, z + 15);
    const k = THREE.MathUtils.smoothstep(r, 160, 700);
    p.setY(i, k * (fbm(x / 400, z / 400, 4, 21) - 0.35) * 90);
  }
  geo.computeVertexNormals();
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (size / 1.7), uv.getY(i) * (size / 1.7));
  const mat = patchMaterial(new THREE.MeshStandardMaterial({ map: lawnTexture(), roughness: 0.95 }), {
    fragmentPars: GLSL_NOISE,
    fragmentColor: /* glsl */ `
      {
        vec2 wp = vWorldPosC.xz;
        float macro = fbm2(wp * 0.045);
        float patches = fbm2(wp * 0.21 + 7.0);
        // Mowing stripes, 1.6 m wide, in the lawn near the lab.
        float stripe = step(0.5, fract(wp.x / 3.2)) * 2.0 - 1.0;
        float nearLab = 1.0 - smoothstep(35.0, 60.0, length(wp - vec2(0.0, -12.0)));
        diffuseColor.rgb *= mix(0.78, 1.18, macro) * mix(0.92, 1.06, patches) * (1.0 + 0.045 * stripe * nearLab);
        // Blend to a smoother field colour in the distance to hide tiling.
        float far = smoothstep(40.0, 260.0, length(wp - vec2(0.0, -12.0)));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.085, 0.13, 0.04) * mix(0.8, 1.2, macro), far * 0.8);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  return mesh;
}

function buildPath(): THREE.Mesh {
  const pts = superellipsePoints(PATH_CENTER.x, PATH_CENTER.z, PATH_RADII.a, PATH_RADII.b, 3.2, 720, false);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let along = 0;
  const n = pts.length;
  for (let i = 0; i <= n; i++) {
    const a = pts[i % n];
    const b = pts[(i + 1) % n];
    const tx = b.x - a.x;
    const tz = b.z - a.z;
    const len = Math.hypot(tx, tz) || 1;
    const nx = -tz / len;
    const nz = tx / len;
    const w = PATH_WIDTH / 2;
    pos.push(a.x + nx * w, 0.012, a.z + nz * w, a.x - nx * w, 0.012, a.z - nz * w);
    uv.push(0, along / PATH_WIDTH, 1, along / PATH_WIDTH);
    along += len;
    if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Ensure normals face up regardless of winding.
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
  const tex = pathTexture();
  const mat = patchMaterial(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide }), {
    fragmentPars: GLSL_NOISE,
    fragmentColor: /* glsl */ `
      {
        float edge = min(vMapUv.x, 1.0 - vMapUv.x);
        diffuseColor.rgb *= mix(0.8, 1.0, smoothstep(0.0, 0.06, edge));
        diffuseColor.rgb *= mix(0.9, 1.08, fbm2(vWorldPosC.xz * 0.3));
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'path';
  return mesh;
}

interface Species {
  style: TreeStyle;
  leafPalette: [number, number, number][];
  barkTint: string;
}

const SPECIES: Species[] = [
  {
    style: { seed: 11, height: 12, trunkRadius: 0.32, trunkFraction: 0.32, crownRadius: 4.6, crownStretch: 0.85, limbs: 6, depth: 3, leafCardSize: 1.25, leavesPerTip: 5, sides: 12 },
    leafPalette: [[62, 92, 30], [78, 108, 36], [50, 78, 26], [92, 118, 44]],
    barkTint: '#8a7f72',
  },
  {
    style: { seed: 23, height: 15, trunkRadius: 0.28, trunkFraction: 0.3, crownRadius: 3.6, crownStretch: 1.45, limbs: 5, depth: 3, leafCardSize: 1.15, leavesPerTip: 5, sides: 10 },
    leafPalette: [[54, 84, 34], [70, 98, 40], [44, 70, 30]],
    barkTint: '#7a7064',
  },
  {
    style: { seed: 37, height: 10.5, trunkRadius: 0.18, trunkFraction: 0.35, crownRadius: 2.7, crownStretch: 1.35, limbs: 5, depth: 3, leafCardSize: 0.95, leavesPerTip: 4, sides: 8 },
    leafPalette: [[96, 124, 46], [112, 136, 56], [80, 110, 40]],
    barkTint: '#d8d4cc',
  },
];

const BUSH: Species = {
  style: { seed: 57, height: 1.8, trunkRadius: 0.05, trunkFraction: 0.05, crownRadius: 1.05, crownStretch: 0.75, limbs: 7, depth: 2, leafCardSize: 0.6, leavesPerTip: 4, sides: 5 },
  leafPalette: [[40, 64, 24], [52, 78, 30], [34, 56, 22], [60, 84, 34]],
  barkTint: '#6a5e50',
};

const FEATURE_TREE: Species = {
  style: { seed: 101, height: 13.5, trunkRadius: 0.48, trunkFraction: 0.3, crownRadius: 6.2, crownStretch: 0.78, limbs: 7, depth: 3, leafCardSize: 1.35, leavesPerTip: 6, sides: 14 },
  leafPalette: [[58, 88, 30], [72, 102, 34], [46, 74, 24], [88, 114, 40]],
  barkTint: '#857a6d',
};

interface Placement {
  x: number;
  z: number;
  scale: number;
  rot: number;
}

function buildTrees(species: Species, placements: Placement[], castShadow: boolean, canopy: boolean, focusTargets: THREE.Object3D[]): THREE.Group {
  const group = new THREE.Group();
  const geo = generateTree(species.style);
  const bark = barkTexture();
  bark.repeat.set(1, 1);
  const woodMat = patchMaterial(new THREE.MeshStandardMaterial({ map: bark, color: species.barkTint, roughness: 0.92 }));
  const leafMap = leafClusterTexture(species.style.seed, species.leafPalette);
  const leafMat = patchMaterial(
    new THREE.MeshStandardMaterial({ map: leafMap, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75, alphaToCoverage: true }),
  );
  // Leaves keep their outward "crown" normals on both faces.
  leafMat.onBeforeCompile = ((orig) => (shader: THREE.WebGLProgramParametersWithUniforms, r: THREE.WebGLRenderer) => {
    orig(shader, r);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize(vNormal);')
      // Preserve alpha-tested coverage in distant mip levels so far trees don't go bald.
      .replace(
        '#include <alphatest_fragment>',
        `{
          vec2 ts = vec2(textureSize(map, 0));
          vec2 dx = dFdx(vMapUv * ts);
          vec2 dy = dFdy(vMapUv * ts);
          float mip = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
          diffuseColor.a *= 1.0 + mip * 0.3;
        }
        #include <alphatest_fragment>`,
      );
  })(leafMat.onBeforeCompile);
  leafMat.customProgramCacheKey = () => 'leaf';

  const wood = new THREE.InstancedMesh(geo.wood, woodMat, placements.length);
  const leaves = new THREE.InstancedMesh(geo.leaves, leafMat, placements.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  const rand = mulberry32(species.style.seed * 7);
  placements.forEach((p, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot);
    m.compose(new THREE.Vector3(p.x, 0, p.z), q, new THREE.Vector3(p.scale, p.scale, p.scale));
    wood.setMatrixAt(i, m);
    leaves.setMatrixAt(i, m);
    c.setRGB(0.85 + rand() * 0.3, 0.85 + rand() * 0.3, 0.8 + rand() * 0.25);
    leaves.setColorAt(i, c);
    const center = geo.crownCenter.clone().multiplyScalar(p.scale).add(new THREE.Vector3(p.x, 0, p.z));
    const radius = geo.crownRadius * p.scale;
    if (canopy) registerCanopy(center, radius);
    // Invisible sphere proxy so autofocus can "see" the crown.
    const proxy = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.85, 12, 8), new THREE.MeshBasicMaterial());
    proxy.position.copy(center);
    proxy.scale.y = species.style.crownStretch;
    proxy.layers.set(1);
    proxy.name = 'tree crown';
    group.add(proxy);
    focusTargets.push(proxy);
  });
  wood.castShadow = leaves.castShadow = castShadow;
  wood.receiveShadow = leaves.receiveShadow = true;
  wood.computeBoundingSphere();
  leaves.computeBoundingSphere();
  wood.name = 'tree trunk';
  group.add(wood, leaves);
  focusTargets.push(wood);
  return group;
}

export function buildExposureLab(renderer: THREE.WebGLRenderer, quality: Quality): LabScene {
  const profile = QUALITY_PROFILES[quality];
  const scene = new THREE.Scene();
  const focusTargets: THREE.Object3D[] = [];
  canopyUniforms.uCanopyCount.value = 0;

  // --- Sky, sun and ambient -------------------------------------------------
  const skyParams: SkyParams = {
    sunDirection: SUN_DIRECTION,
    sunIlluminance: luxToIntensity(SUN_ILLUMINANCE_LUX),
    groundAlbedo: new THREE.Color(0.1, 0.14, 0.06),
  };
  const sky = createSkyDome(skyParams);
  scene.add(sky);
  scene.environment = createSkyEnvironment(renderer, skyParams);
  scene.fog = new THREE.FogExp2(new THREE.Color(6.2, 7.0, 8.2), 0.0021);

  const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.95, 0.88), luxToIntensity(SUN_ILLUMINANCE_LUX));
  sun.position.copy(SUN_DIRECTION).multiplyScalar(80).add(new THREE.Vector3(0, 0, -10));
  sun.target.position.set(0, 0, -10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize);
  const sc = sun.shadow.camera;
  sc.left = -42;
  sc.right = 42;
  sc.top = 42;
  sc.bottom = -42;
  sc.near = 1;
  sc.far = 200;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.018;
  sun.shadow.radius = 2.5;
  scene.add(sun, sun.target);

  // --- Ground ---------------------------------------------------------------
  const ground = buildGround();
  scene.add(ground);
  focusTargets.push(ground);
  const path = buildPath();
  scene.add(path);
  focusTargets.push(path);

  // --- Trees ----------------------------------------------------------------
  const feature = buildTrees(FEATURE_TREE, [{ x: -9.5, z: 3.5, scale: 1, rot: 0.6 }], true, true, focusTargets);
  scene.add(feature);

  const rand = mulberry32(777);
  const midCandidates: Placement[] = [];
  const inViewLane = (x: number, z: number) => Math.abs(x) < 6 && z > -3.5 && z < 16;
  let guard = 0;
  while (midCandidates.length < 16 && guard++ < 2000) {
    const x = -38 + rand() * 76;
    const z = -40 + rand() * 60;
    if (inViewLane(x, z)) continue;
    if (distanceToPath(x, z) < 4.5) continue;
    if (Math.hypot(x + 9.5, z - 3.5) < 12) continue; // feature tree
    if (Math.hypot(x - 13, z + 11) < 7) continue; // pavilion
    if (midCandidates.some((p) => Math.hypot(p.x - x, p.z - z) < 9)) continue;
    midCandidates.push({ x, z, scale: 0.8 + rand() * 0.45, rot: rand() * 6.28 });
  }
  SPECIES.forEach((sp, i) => {
    const mine = midCandidates.filter((_, k) => k % SPECIES.length === i);
    scene.add(buildTrees(sp, mine, true, true, focusTargets));
  });

  const ring: Placement[][] = SPECIES.map(() => []);
  for (let i = 0; i < profile.treelineTrees; i++) {
    const a = rand() * Math.PI * 2;
    const r = 52 + rand() * rand() * 110;
    const x = Math.cos(a) * r;
    const z = -15 + Math.sin(a) * r * 0.85;
    ring[i % SPECIES.length].push({ x, z, scale: 0.9 + rand() * 0.7, rot: rand() * 6.28 });
  }
  SPECIES.forEach((sp, i) => scene.add(buildTrees(sp, ring[i], false, false, focusTargets)));

  // --- Vegetation -----------------------------------------------------------
  const lawnRegion: ScatterRegion = {
    bounds: { minX: -32, maxX: 32, minZ: -40, maxZ: 20 },
    density: (x, z) => {
      const onPath = distanceToPathFast(x, z) < PATH_WIDTH / 2 + 0.05;
      if (onPath) return 0;
      if (Math.hypot(x - 13, z + 11) < 4.2) return 0;
      // Dense where the photographer usually stands and looks, sparse far away.
      const dist = Math.hypot(x - 0.3, z - 5);
      return THREE.MathUtils.clamp(1.1 - dist / 22, 0.05, 1);
    },
  };
  scene.add(
    createGrass(lawnRegion, {
      count: profile.grassClumps,
      height: 0.07,
      width: 0.012,
      bladesPerClump: 7,
      windAmp: 0.012,
      seed: 3,
      colorA: new THREE.Color(0.085, 0.13, 0.035),
      colorB: new THREE.Color(0.13, 0.18, 0.05),
    }),
  );
  // Meadow strips with tall grass + flowers (foreground depth for bokeh lessons).
  const meadows = [
    { x: -2.6, z: 6.4, rx: 2.2, rz: 1.3 },
    { x: -10, z: -2.3, rx: 3.5, rz: 1.0 },
    { x: 6.5, z: -2.6, rx: 3.0, rz: 0.9 },
    { x: 5.2, z: 7.8, rx: 1.6, rz: 1.1 },
  ];
  const meadowRegion: ScatterRegion = {
    bounds: { minX: -14, maxX: 10, minZ: -4, maxZ: 9.5 },
    density: (x, z) => {
      let d = 0;
      for (const m of meadows) {
        const e = ((x - m.x) / m.rx) ** 2 + ((z - m.z) / m.rz) ** 2;
        d = Math.max(d, THREE.MathUtils.clamp(1.3 - e, 0, 1));
      }
      return d;
    },
  };
  scene.add(
    createGrass(meadowRegion, {
      count: Math.round(profile.grassClumps * 0.06),
      height: 0.55,
      width: 0.018,
      bladesPerClump: 9,
      windAmp: 0.09,
      seed: 17,
      colorA: new THREE.Color(0.13, 0.17, 0.05),
      colorB: new THREE.Color(0.26, 0.25, 0.1),
    }),
  );
  scene.add(
    createFlowers(meadowRegion, 700, 5, [
      new THREE.Color('#f4f1ea'),
      new THREE.Color('#f2c230'),
      new THREE.Color('#8f5bc8'),
      new THREE.Color('#e0663e'),
    ]),
  );
  for (const m of meadows) {
    const proxy = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.5, 16), new THREE.MeshBasicMaterial());
    proxy.scale.set(m.rx * 0.85, 1, m.rz * 0.85);
    proxy.position.set(m.x, 0.25, m.z);
    proxy.layers.set(1);
    proxy.name = 'meadow grass';
    scene.add(proxy);
    focusTargets.push(proxy);
  }

  // --- Props ----------------------------------------------------------------
  const addProp = (o: THREE.Object3D) => {
    scene.add(o);
    focusTargets.push(o);
  };
  const bench = createBench();
  bench.position.set(-4.3, 0, -1.6);
  bench.rotation.y = 0.35;
  addProp(bench);
  const bin = createTrashBin();
  bin.position.set(-2.6, 0, -1.9);
  addProp(bin);
  for (const x of [-15, -5.5, 5.5, 15]) {
    const lamp = createLampPost();
    lamp.position.set(x, 0, nearSideZ(x) + PATH_WIDTH / 2 + 0.6);
    addProp(lamp);
  }
  const pavilion = createPavilion();
  pavilion.position.set(13, 0, -11);
  addProp(pavilion);
  // Shrub borders: a long row behind the far side of the path and a clump by the big tree.
  const shrubs: Placement[] = [];
  const srand = mulberry32(4242);
  for (let x = -19; x <= 15; x += 1.35 + srand() * 0.5) {
    shrubs.push({ x, z: -33.2 + (srand() - 0.5) * 0.8, scale: 0.85 + srand() * 0.45, rot: srand() * 6.28 });
  }
  for (let i = 0; i < 6; i++) {
    shrubs.push({ x: -19.5 + i * 1.3 + srand() * 0.4, z: 0.5 + i * 0.45 + srand() * 0.4, scale: 0.7 + srand() * 0.4, rot: srand() * 6.28 });
  }
  scene.add(buildTrees(BUSH, shrubs, true, false, focusTargets));

  // --- People ---------------------------------------------------------------
  const portrait = createPerson({
    skin: '#c8987a',
    top: '#b4532f',
    topLongSleeves: true,
    bottom: '#2c3a55',
    bottomShort: false,
    shoes: '#e7e4dc',
    hair: '#3a2416',
    longHair: true,
    topFabric: 'knit',
    bottomFabric: 'denim',
    build: 'f',
  });
  portrait.root.position.copy(PORTRAIT_POSITION);
  portrait.root.rotation.y = -0.3;
  poseStanding(portrait);
  scene.add(portrait.root);
  focusTargets.push(portrait.root);

  const cyclist = createCyclist();
  scene.add(cyclist.root);
  focusTargets.push(cyclist.root);

  // --- Wildlife -------------------------------------------------------------
  const gulls = GULLS.map((params) => ({ params, rig: createGull() }));
  const pigeons = Array.from({ length: PIGEON_COUNT }, (_, i) => createPigeon(i * 0.06 - 0.03));
  const squirrel = createSquirrel();
  for (const o of [...gulls.map((g) => g.rig.root), ...pigeons.map((p) => p.root), squirrel.root]) {
    scene.add(o);
    focusTargets.push(o);
  }

  const eyeMid = new THREE.Vector3();
  const subjects: Subject[] = [
    {
      name: 'portrait subject',
      point: (t) => {
        const a = portrait.eyes[0].getWorldPosition(eyeMid);
        const b = portrait.eyes[1].getWorldPosition(new THREE.Vector3());
        return t.copy(a).add(b).multiplyScalar(0.5);
      },
      speed: () => 0.02,
      radius: 0.9,
    },
    {
      name: 'cyclist',
      point: (t) => cyclist.person.chest.getWorldPosition(t),
      speed: (time) => cyclistAt(time).speedMps,
      radius: 1.0,
    },
    ...gulls.map((g) => ({
      name: 'gull',
      point: (t: THREE.Vector3) => g.rig.root.getWorldPosition(t),
      speed: (time: number) => birdAt(g.params, time).speedMps,
      radius: 0.65,
    })),
    ...pigeons.map((pg, i) => ({
      name: 'pigeon',
      point: (t: THREE.Vector3) => pg.root.getWorldPosition(t).setY(0.14),
      speed: (time: number) => pigeonAt(i, time).speedMps,
      radius: 0.18,
    })),
    {
      name: 'squirrel',
      point: (t) => squirrel.root.getWorldPosition(t).setY(squirrel.root.position.y + 0.08),
      speed: (time) => squirrelAt(time).speedMps,
      radius: 0.2,
    },
  ];

  function setTime(t: number) {
    canopyUniforms.uWorldTime.value = t;
    sky.material.uniforms.uSkyTime.value = t;
    const sway = portraitSway(t);
    portrait.root.position.set(PORTRAIT_POSITION.x + sway.dx, 0, PORTRAIT_POSITION.z + sway.dz);
    portrait.root.rotation.y = -0.3 + sway.yaw;
    poseStanding(portrait, sway.breath);
    cyclist.update(cyclistAt(t));
    for (const g of gulls) g.rig.update(birdAt(g.params, t));
    pigeons.forEach((pg, i) => pg.update(pigeonAt(i, t)));
    squirrel.update(squirrelAt(t));
    scene.updateMatrixWorld(true);
  }
  setTime(0);

  return { scene, sun, sky, focusTargets, subjects, setTime, portrait, cyclist };
}

/** z of the near (camera-side) edge centreline of the bike path at x. */
function nearSideZ(x: number): number {
  const u = Math.min(1, Math.abs(x - PATH_CENTER.x) / PATH_RADII.a);
  return PATH_CENTER.z + PATH_RADII.b * Math.pow(1 - Math.pow(u, 3.2), 1 / 3.2);
}

/** Cheap analytic distance-to-path estimate used when scattering thousands of grass clumps. */
function distanceToPathFast(x: number, z: number): number {
  const u = (x - PATH_CENTER.x) / PATH_RADII.a;
  const v = (z - PATH_CENTER.z) / PATH_RADII.b;
  const r = Math.pow(Math.pow(Math.abs(u), 3.2) + Math.pow(Math.abs(v), 3.2), 1 / 3.2);
  // Radial distance in metres (approx.) from the superellipse centreline.
  const scale = Math.hypot(u * PATH_RADII.a, v * PATH_RADII.b) / Math.max(r, 1e-6);
  return Math.abs(r - 1) * scale;
}

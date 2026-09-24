/**
 * Procedural human figures.
 *
 * The body is one continuous skinned mesh generated around a bone chain
 * (no visible joints), with clothing as material regions of the same
 * surface (cuffs and hems are small steps in the surface). The head is a
 * sculpted sphere with a painted face texture, set-in eyes with lids, and a
 * hair shell whose hairline is the zero-crossing of a thickness field.
 *
 * Proportions follow anthropometric averages for a ~1.70 m adult:
 * head ≈ 0.23 m, shoulder joint ≈ 0.82 H, hip joint ≈ 0.53 H, knee ≈ 0.29 H.
 * Everything is authored in metres in the bind (rest) pose: standing,
 * arms hanging straight down, facing +z.
 */

import * as THREE from 'three';
import { patchMaterial } from './materials';
import { mulberry32, valueNoise } from './noise';

export interface PersonLook {
  skin: string;
  top: string;
  topLongSleeves: boolean;
  /** 'knit' sweater or 'jersey' (smooth, sporty). */
  topFabric?: 'knit' | 'jersey';
  bottom: string;
  bottomShort: boolean;
  /** 'denim' jeans or 'lycra' cycling shorts. */
  bottomFabric?: 'denim' | 'lycra';
  shoes: string;
  hair: string;
  longHair: boolean;
  helmet?: string;
  sunglasses?: boolean;
  /** Broader shoulders / narrower hips when 'm'. */
  build?: 'f' | 'm';
  seed?: number;
}

export interface Person {
  root: THREE.Group;
  pelvis: THREE.Object3D;
  chest: THREE.Object3D;
  neck: THREE.Object3D;
  head: THREE.Object3D;
  arms: { upper: THREE.Object3D; fore: THREE.Object3D; hand: THREE.Object3D }[];
  legs: { thigh: THREE.Object3D; shin: THREE.Object3D; foot: THREE.Object3D }[];
  /** Eye centres (for eye-focus and critique). */
  eyes: THREE.Object3D[];
  meshes: THREE.Mesh[];
}

/* Bone lengths (m), shared with IK in people.ts. */
export const THIGH = 0.42;
export const SHIN = 0.4;
export const UPPER_ARM = 0.28;
export const FOREARM = 0.25;

const PELVIS_Y = 0.93;
const CHEST_Y = 0.02;
const SHOULDER = new THREE.Vector3(0.15, 0.435, -0.01);
const HIP_X = 0.09;
const NECK_Y = 0.52;
const HEAD_Y = 0.075;
/** Head sculpt centre above the head bone. */
const HEAD_CENTER_Y = 0.05;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/* ------------------------------------------------------------------------ */
/* Textures                                                                  */
/* ------------------------------------------------------------------------ */

function canvasTex(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void, repeat = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

const cache = new Map<string, THREE.Texture>();
function cached(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = cache.get(key);
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
}

/** Stocking-stitch knit: rows of small V loops. Greyscale, tinted by material colour. */
function knitTexture() {
  return cached('knit', () =>
    canvasTex(256, (ctx, s) => {
      ctx.fillStyle = '#b8b8b8';
      ctx.fillRect(0, 0, s, s);
      const cols = 32;
      const rows = 40;
      const w = s / cols;
      const h = s / rows;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const x = c * w;
          const y = r * h;
          const g = 205 + ((r * 7 + c * 13) % 5) * 10;
          ctx.fillStyle = `rgb(${g},${g},${g})`;
          ctx.beginPath();
          ctx.ellipse(x + w * 0.3, y + h * 0.5, w * 0.24, h * 0.62, -0.5, 0, Math.PI * 2);
          ctx.ellipse(x + w * 0.7, y + h * 0.5, w * 0.24, h * 0.62, 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
    }),
  );
}

/** Denim twill: diagonal weave with slub variation. */
function denimTexture() {
  return cached('denim', () =>
    canvasTex(256, (ctx, s) => {
      const img = ctx.createImageData(s, s);
      for (let y = 0; y < s; y++)
        for (let x = 0; x < s; x++) {
          const twill = ((x + y * 2) % 6) < 3 ? 1 : 0.82;
          const slub = 0.85 + 0.3 * valueNoise(x / 3, y / 40, 4, s / 3);
          const fade = 0.9 + 0.2 * valueNoise(x / 40, y / 40, 9, s / 40);
          const g = Math.min(255, 215 * twill * slub * fade);
          const i = (y * s + x) * 4;
          img.data[i] = g;
          img.data[i + 1] = g;
          img.data[i + 2] = g;
          img.data[i + 3] = 255;
        }
      ctx.putImageData(img, 0, 0);
    }),
  );
}

/** Fine technical-fabric grain for jerseys and lycra. */
function jerseyTexture() {
  return cached('jersey', () =>
    canvasTex(128, (ctx, s) => {
      const img = ctx.createImageData(s, s);
      for (let y = 0; y < s; y++)
        for (let x = 0; x < s; x++) {
          const g = 225 + 30 * valueNoise(x / 1.5, y / 1.5, 3, s / 1.5);
          const i = (y * s + x) * 4;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.min(255, g);
          img.data[i + 3] = 255;
        }
      ctx.putImageData(img, 0, 0);
    }),
  );
}

/** Hair strands running along the texture's v axis (crown → ends). */
function hairTexture() {
  return cached('hair', () =>
    canvasTex(256, (ctx, s) => {
      ctx.fillStyle = '#7a7a7a';
      ctx.fillRect(0, 0, s, s);
      const rand = mulberry32(8);
      for (let i = 0; i < 2200; i++) {
        const x = rand() * s;
        const g = 50 + rand() * 205;
        ctx.strokeStyle = `rgba(${g},${g},${g},0.55)`;
        ctx.lineWidth = 0.6 + rand() * 1.2;
        ctx.beginPath();
        ctx.moveTo(x, -4);
        ctx.bezierCurveTo(x + (rand() - 0.5) * 6, s * 0.33, x + (rand() - 0.5) * 6, s * 0.66, x + (rand() - 0.5) * 4, s + 4);
        ctx.stroke();
      }
    }),
  );
}

/* Face texture: planar-projected from the front, painted in head-local metres. */
const FACE_HALF_W = 0.085;
const FACE_HALF_H = 0.125;

function faceTexture(look: PersonLook): THREE.Texture {
  return cached(`face:${look.skin}:${look.hair}:${look.build}`, () =>
    canvasTex(
      512,
      (ctx, s) => {
        const P = (x: number, y: number): [number, number] => [(0.5 + x / (2 * FACE_HALF_W)) * s, (0.5 - y / (2 * FACE_HALF_H)) * s];
        const skin = new THREE.Color(look.skin);
        const hex = (c: THREE.Color) => `#${c.getHexString()}`;
        ctx.fillStyle = look.skin;
        ctx.fillRect(0, 0, s, s);
        // Subtle skin tone variation.
        const img = ctx.getImageData(0, 0, s, s);
        for (let y = 0; y < s; y++)
          for (let x = 0; x < s; x++) {
            const i = (y * s + x) * 4;
            const n = 0.97 + 0.06 * valueNoise(x / 6, y / 6, 2) + 0.02 * valueNoise(x / 1.5, y / 1.5, 5);
            img.data[i] = Math.min(255, img.data[i] * n);
            img.data[i + 1] = Math.min(255, img.data[i + 1] * n);
            img.data[i + 2] = Math.min(255, img.data[i + 2] * n);
          }
        ctx.putImageData(img, 0, 0);
        const blob = (x: number, y: number, rx: number, ry: number, color: string, alpha: number) => {
          const [cx, cy] = P(x, y);
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, (rx / (2 * FACE_HALF_W)) * s);
          g.addColorStop(0, color);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.translate(cx, cy);
          ctx.scale(1, ry / rx);
          ctx.translate(-cx, -cy);
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, s, s);
          ctx.restore();
        };
        const warm = hex(skin.clone().lerp(new THREE.Color('#c0504a'), 0.45));
        const shadow = hex(skin.clone().multiplyScalar(0.72));
        for (const sx of [-1, 1]) {
          blob(sx * 0.036, -0.016, 0.024, 0.018, warm, look.build === 'm' ? 0.18 : 0.32); // cheeks
          blob(sx * 0.03, 0.012, 0.018, 0.009, shadow, 0.2); // eye socket shading
        }
        blob(0, -0.05, 0.02, 0.012, warm, 0.25);
        // Eyebrows: short strokes following an arch.
        const brow = hex(new THREE.Color(look.hair).multiplyScalar(0.8));
        ctx.strokeStyle = brow;
        ctx.lineCap = 'round';
        const rand = mulberry32(3);
        for (const sx of [-1, 1]) {
          for (let i = 0; i < 70; i++) {
            const t = rand();
            const x = sx * (0.012 + t * 0.03);
            const y = 0.027 + Math.sin(t * Math.PI * 0.9 + 0.2) * 0.005 - t * 0.002 + (rand() - 0.5) * 0.003;
            const [px, py] = P(x, y);
            const thick = look.build === 'm' ? 3.2 : 2.3;
            ctx.lineWidth = thick * (1 - t * 0.5);
            ctx.globalAlpha = 0.5;
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(px + sx * 5, py - 2 + t * 3);
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
        // Lips.
        const lip = hex(skin.clone().lerp(new THREE.Color('#9e3f3f'), look.build === 'm' ? 0.3 : 0.55));
        const [mx, my] = P(0, -0.058);
        const lw = (0.024 / (2 * FACE_HALF_W)) * s;
        ctx.fillStyle = lip;
        ctx.beginPath();
        ctx.moveTo(mx - lw, my);
        ctx.quadraticCurveTo(mx - lw * 0.5, my - lw * 0.32, mx - lw * 0.1, my - lw * 0.22);
        ctx.quadraticCurveTo(mx, my - lw * 0.16, mx + lw * 0.1, my - lw * 0.22);
        ctx.quadraticCurveTo(mx + lw * 0.5, my - lw * 0.32, mx + lw, my);
        ctx.quadraticCurveTo(mx, my + lw * 0.42, mx - lw, my);
        ctx.fill();
        ctx.strokeStyle = hex(skin.clone().multiplyScalar(0.45));
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(mx - lw, my);
        ctx.quadraticCurveTo(mx, my + lw * 0.06, mx + lw, my);
        ctx.stroke();
        // Nostrils.
        for (const sx of [-1, 1]) blob(sx * 0.0075, -0.034, 0.004, 0.0025, hex(skin.clone().multiplyScalar(0.35)), 0.9);
      },
      false,
    ),
  );
}

function irisTexture(color: string): THREE.Texture {
  return cached(`iris:${color}`, () =>
    canvasTex(
      128,
      (ctx, s) => {
        const c = s / 2;
        ctx.fillStyle = '#f2eee8';
        ctx.fillRect(0, 0, s, s);
        const g = ctx.createRadialGradient(c, c, 0, c, c, c * 0.95);
        const base = new THREE.Color(color);
        g.addColorStop(0, '#050505');
        g.addColorStop(0.3, '#050505');
        g.addColorStop(0.34, `#${base.clone().multiplyScalar(1.3).getHexString()}`);
        g.addColorStop(0.85, `#${base.getHexString()}`);
        g.addColorStop(0.97, '#1a120c');
        g.addColorStop(1, 'rgba(242,238,232,1)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(c, c, c * 0.97, 0, Math.PI * 2);
        ctx.fill();
        const rand = mulberry32(2);
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        for (let i = 0; i < 60; i++) {
          const a = rand() * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(c + Math.cos(a) * c * 0.35, c + Math.sin(a) * c * 0.35);
          ctx.lineTo(c + Math.cos(a) * c * 0.9, c + Math.sin(a) * c * 0.9);
          ctx.stroke();
        }
      },
      false,
    ),
  );
}

/* ------------------------------------------------------------------------ */
/* Skinned body                                                             */
/* ------------------------------------------------------------------------ */

const enum Mat {
  Skin = 0,
  Top = 1,
  Bottom = 2,
}

interface Ring {
  y: number;
  rx: number;
  rz: number;
  cx: number;
  cz: number;
  /** Superellipse exponent (2 = ellipse). */
  p: number;
  mat: Mat;
  bones: [number, number];
  /** Weight of bones[1]. */
  w: number;
  v: number;
}

class BodyBuilder {
  pos: number[] = [];
  uv: number[] = [];
  skinIndex: number[] = [];
  skinWeight: number[] = [];
  tris: number[][] = [[], [], []];

  /** Tube through horizontal rings (bind pose limbs and torso are vertical). */
  tube(rings: Ring[], segments: number, capBottom: boolean, capTop: boolean): void {
    const start = this.pos.length / 3;
    const ringStride = segments + 1;
    for (const r of rings) {
      for (let k = 0; k <= segments; k++) {
        const a = (k / segments) * Math.PI * 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const e = 2 / r.p;
        const x = r.cx + r.rx * Math.sign(c) * Math.abs(c) ** e;
        const z = r.cz + r.rz * Math.sign(s) * Math.abs(s) ** e;
        this.pos.push(x, r.y, z);
        this.uv.push(k / segments, r.v);
        this.skinIndex.push(r.bones[0], r.bones[1], 0, 0);
        this.skinWeight.push(1 - r.w, r.w, 0, 0);
      }
    }
    for (let i = 0; i < rings.length - 1; i++) {
      // Rings are ordered bottom → top and angles run +x → +z, so (a, b, a+1)
      // is counter-clockwise seen from outside: normals point outward.
      const mat = rings[i + 1].mat;
      for (let k = 0; k < segments; k++) {
        const a = start + i * ringStride + k;
        const b = a + ringStride;
        this.tris[mat].push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const cap = (ri: number, top: boolean) => {
      const r = rings[ri];
      const center = this.pos.length / 3;
      this.pos.push(r.cx, r.y + (top ? 0.004 : -0.004), r.cz);
      this.uv.push(0.5, r.v);
      this.skinIndex.push(r.bones[0], r.bones[1], 0, 0);
      this.skinWeight.push(1 - r.w, r.w, 0, 0);
      for (let k = 0; k < segments; k++) {
        const a = start + ri * ringStride + k;
        if (top) this.tris[r.mat].push(a + 1, a, center);
        else this.tris[r.mat].push(a, a + 1, center);
      }
    };
    if (capBottom) cap(0, false);
    if (capTop) cap(rings.length - 1, true);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.skinWeight, 4));
    const index: number[] = [];
    this.tris.forEach((t, m) => {
      g.addGroup(index.length, t.length, m);
      index.push(...t);
    });
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
  }
}

type Profile = [number, number, number, number?][]; // [s, rx, rz, cz]

function sample(profile: Profile, s: number): { rx: number; rz: number; cz: number } {
  if (s <= profile[0][0]) return { rx: profile[0][1], rz: profile[0][2], cz: profile[0][3] ?? 0 };
  for (let i = 1; i < profile.length; i++) {
    const [s1, rx1, rz1, cz1 = 0] = profile[i];
    const [s0, rx0, rz0, cz0 = 0] = profile[i - 1];
    if (s <= s1) {
      const t = (s - s0) / (s1 - s0);
      const u = t * t * (3 - 2 * t);
      return { rx: rx0 + (rx1 - rx0) * u, rz: rz0 + (rz1 - rz0) * u, cz: cz0 + (cz1 - cz0) * u };
    }
  }
  const l = profile[profile.length - 1];
  return { rx: l[1], rz: l[2], cz: l[3] ?? 0 };
}

interface ChainJoint {
  s: number;
  bone: number;
  blend: number;
}

/** Bone pair + weight for arc length s along a chain of joints. */
function chainWeights(joints: ChainJoint[], s: number): { bones: [number, number]; w: number } {
  let i = 0;
  while (i < joints.length - 1 && s > joints[i + 1].s - joints[i + 1].blend) i++;
  const cur = joints[i];
  const next = joints[i + 1];
  if (next && s > next.s - next.blend) {
    return { bones: [cur.bone, next.bone], w: smooth(next.s - next.blend, next.s + next.blend, s) };
  }
  if (i > 0 && s < cur.s + cur.blend) {
    const prev = joints[i - 1];
    return { bones: [prev.bone, cur.bone], w: smooth(cur.s - cur.blend, cur.s + cur.blend, s) };
  }
  return { bones: [cur.bone, cur.bone], w: 0 };
}

interface Region {
  from: number;
  to: number;
  mat: Mat;
  /** Radius multiplier (cloth thickness / looseness). */
  scale: number;
  /** Minimum radius (straight-leg trousers, loose sleeves). */
  min?: number;
}

/**
 * Build a vertical chain (limb/torso/neck) with clothing regions. At every
 * region boundary two rings are emitted at the same height, producing a
 * visible hem or cuff.
 */
function chain(
  b: BodyBuilder,
  opts: {
    x: number;
    yTop: number;
    /** Chain runs downward from yTop when true (limbs), upward otherwise (torso, neck). */
    down: boolean;
    profile: Profile;
    joints: ChainJoint[];
    regions: Region[];
    step: number;
    segments: number;
    p?: number | ((s: number) => number);
    capStart?: boolean;
    capEnd?: boolean;
    xSign?: number;
  },
): void {
  const s0 = opts.profile[0][0];
  const s1 = opts.profile[opts.profile.length - 1][0];
  const stops = new Set<number>();
  for (let s = s0; s < s1; s += opts.step) stops.add(+s.toFixed(4));
  stops.add(s1);
  for (const p of opts.profile) stops.add(p[0]);
  for (const r of opts.regions) {
    if (r.from > s0 && r.from < s1) stops.add(r.from);
    if (r.to > s0 && r.to < s1) stops.add(r.to);
  }
  const list = [...stops].sort((a, b2) => a - b2);
  const regionAt = (s: number, bias: number) => opts.regions.find((r) => s + bias >= r.from && s + bias <= r.to) ?? { from: 0, to: 0, mat: Mat.Skin, scale: 1 };
  const rings: Ring[] = [];
  const pAt = (s: number) => (typeof opts.p === 'function' ? opts.p(s) : (opts.p ?? 2));
  const mk = (s: number, reg: Region): Ring => {
    const pr = sample(opts.profile, s);
    const { bones, w } = chainWeights(opts.joints, s);
    const rx = Math.max(pr.rx * reg.scale, reg.min ?? 0);
    const rz = Math.max(pr.rz * reg.scale, reg.min ?? 0);
    return { y: opts.down ? opts.yTop - s : opts.yTop + s, rx, rz, cx: opts.x, cz: pr.cz, p: pAt(s), mat: reg.mat, bones, w, v: s * 3 };
  };
  for (const s of list) {
    const before = regionAt(s, -1e-4);
    const after = regionAt(s, 1e-4);
    const boundary = opts.regions.some((r) => Math.abs(r.from - s) < 1e-6 || Math.abs(r.to - s) < 1e-6) && (before.mat !== after.mat || before.scale !== after.scale);
    if (boundary) {
      rings.push(mk(s, before), mk(s, after));
    } else rings.push(mk(s, after));
  }
  // Rings must be ordered bottom → top for outward winding.
  if (opts.down) rings.reverse();
  // A ring pair at a boundary takes the material of the upper segment; make the step itself cloth.
  for (let i = 0; i < rings.length - 1; i++) {
    if (Math.abs(rings[i].y - rings[i + 1].y) < 1e-6) rings[i + 1].mat = rings[i].rx > rings[i + 1].rx ? rings[i].mat : rings[i + 1].mat;
  }
  b.tube(rings, opts.segments, opts.down ? !!opts.capEnd : !!opts.capStart, opts.down ? !!opts.capStart : !!opts.capEnd);
}

/* ------------------------------------------------------------------------ */
/* Head                                                                      */
/* ------------------------------------------------------------------------ */

const HR = { x: 0.074, yTop: 0.109, yBot: 0.106, zFront: 0.094, zBack: 0.102 };

function gauss(x: number, y: number, cx: number, cy: number, sx: number, sy: number): number {
  return Math.exp(-(((x - cx) / sx) ** 2) - ((y - cy) / sy) ** 2);
}

/** Map a unit direction to the sculpted head surface (head-local metres, centre at origin). */
function sculpt(d: THREE.Vector3, male: boolean): THREE.Vector3 {
  const { x, y, z } = d;
  let px = x * HR.x * (male ? 1.04 : 1);
  let py = y * (y > 0 ? HR.yTop : HR.yBot);
  let pz = z * (z > 0 ? HR.zFront : HR.zBack);
  if (y < 0) {
    const t = Math.pow(-y, 1.5);
    px *= 1 - (male ? 0.18 : 0.24) * t; // jaw narrows to the chin
    if (z < 0.2) pz *= 1 - 0.3 * t * smooth(0.2, -0.6, z); // back of skull tucks into the neck
  }
  if (z > 0) pz *= 1 - 0.07 * smooth(0.4, 0.9, z) * (1 - Math.abs(x)); // flatter face
  let bump = 0;
  const front = smooth(0.2, 0.7, z);
  bump += 0.0055 * gauss(Math.abs(x), y, 0.36, 0.26, 0.28, 0.08) * front; // brow ridge
  bump -= 0.0045 * gauss(Math.abs(x), y, 0.4, 0.08, 0.16, 0.1) * front; // eye sockets
  bump += 0.005 * gauss(Math.abs(x), y, 0.56, -0.12, 0.2, 0.14) * front; // cheekbones
  // Nose: bridge grows towards the tip, wider at the base.
  const nose = y > 0.18 ? 0 : y > -0.28 ? 0.004 + 0.02 * smooth(0.18, -0.26, y) : 0.024 * smooth(-0.4, -0.28, y);
  const noseW = 0.075 + 0.07 * smooth(-0.1, -0.3, y);
  bump += nose * Math.exp(-((x / noseW) ** 2)) * front;
  bump += 0.006 * gauss(x, y, 0, -0.5, 0.2, 0.05) * front; // upper lip
  bump += 0.0065 * gauss(x, y, 0, -0.6, 0.17, 0.05) * front; // lower lip
  bump -= 0.002 * gauss(x, y, 0, -0.55, 0.22, 0.015) * front; // mouth line
  bump += (male ? 0.008 : 0.006) * gauss(x, y, 0, -0.86, 0.2, 0.12) * front; // chin
  const n = new THREE.Vector3(px, py, pz).normalize();
  return new THREE.Vector3(px, py, pz).addScaledVector(n, bump);
}

function headGeometry(male: boolean): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 96, 72);
  const p = g.attributes.position as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const d = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    d.fromBufferAttribute(p, i);
    const v = sculpt(d, male);
    p.setXYZ(i, v.x, v.y, v.z);
    // Planar front projection for the painted face.
    uv.setXY(i, 0.5 + v.x / (2 * FACE_HALF_W), 0.5 + v.y / (2 * FACE_HALF_H));
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Hair shell: the head surface pushed out by a thickness field. Where the
 * field is negative the shell sinks under the skin, so the hairline is the
 * smooth zero-crossing of the field rather than a jagged triangle edge.
 */
function hairGeometry(male: boolean, long: boolean): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 128, 96);
  const p = g.attributes.position as THREE.BufferAttribute;
  const d = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    d.fromBufferAttribute(p, i);
    const { x, y, z } = d;
    // Face zone: the front of the head below a curved hairline (lower at the temples).
    const frontness = smooth(0.2, 0.55, z) * (1 - smooth(0.72, 0.95, Math.abs(x)));
    const hairline = (male ? 0.6 : 0.52) - 0.3 * x * x;
    const faceZone = frontness * smooth(hairline + 0.12, hairline - 0.1, y);
    let field = 0.6 - 1.6 * faceZone;
    // Irregular, wispy hairline rather than a clean cut.
    field += 0.18 * (valueNoise(x * 18 + 3, y * 18, 5) - 0.5) + 0.08 * (valueNoise(x * 45, y * 45, 6) - 0.5);
    // Ears stay uncovered for short hair.
    if (!long) field -= 1.4 * gauss(Math.abs(x), y, 0.98, -0.05, 0.22, 0.28);
    // Short hair stops at the nape; long hair keeps going into the fall.
    if (!long) field -= 1.0 * smooth(-0.35, -0.7, y);
    else field -= 1.0 * smooth(-0.55, -0.85, y) * smooth(-0.2, 0.3, z);
    // Below the ears hair hangs behind the head instead of hugging the jaw.
    field -= 2.2 * smooth(-0.12, -0.35, y) * smooth(-0.5, -0.2, z);
    const part = 1 - 0.55 * gauss(x, z, 0, 0.35, 0.05, 0.5) * smooth(0.3, 0.8, y); // centre parting
    const volume = (0.004 + 0.005 * Math.max(0, y)) * part + (long ? 0.004 * smooth(0.2, -0.4, y) : 0);
    // Continuous through zero so the hairline is smooth instead of a jagged triangle edge.
    const thickness = -0.004 + (volume + 0.0052) * smooth(-0.15, 0.8, field);
    const s = sculpt(d, male);
    const n = s.clone().normalize();
    if (field < -0.25) s.multiplyScalar(0.8); // well hidden inside the head
    else s.addScaledVector(n, thickness);
    p.setXYZ(i, s.x, s.y, s.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Long hair falling behind the shoulders, following the upper back. */
function hairFallGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.092, 0.098, 0.3, 48, 18, true, Math.PI * 0.7, Math.PI * 0.6);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    const y = p.getY(i);
    let z = p.getZ(i);
    const t = (0.15 - y) / 0.3; // 0 at top, 1 at bottom
    // Drape over the back and taper into rounded ends.
    z -= 0.1 * t * t + 0.018;
    const edge = Math.abs(x) / 0.1;
    x *= 1 + 0.25 * t - 0.25 * t * t * edge;
    const endY = y - 0.035 * Math.cos(x * 30) * t * t;
    p.setXYZ(i, x, endY - 0.13, z);
  }
  g.computeVertexNormals();
  return g;
}

function handGeometry(side: number): THREE.BufferGeometry {
  // Palm faces the body (−x for the right hand); fingers point down.
  const parts: THREE.BufferGeometry[] = [];
  const palm = new THREE.SphereGeometry(1, 20, 14);
  palm.scale(0.016, 0.047, 0.041);
  palm.translate(0, -0.045, 0.002);
  parts.push(palm);
  for (let f = 0; f < 4; f++) {
    const fl = [0.07, 0.078, 0.074, 0.06][f];
    const finger = new THREE.CapsuleGeometry(0.0085, fl - 0.017, 4, 8);
    finger.translate(0, -fl / 2, 0);
    finger.rotateX(-0.25 - f * 0.03); // natural curl
    finger.translate(0, -0.085, 0.028 - f * 0.019);
    parts.push(finger);
  }
  const thumb = new THREE.CapsuleGeometry(0.0105, 0.045, 4, 8);
  thumb.translate(0, -0.03, 0);
  thumb.rotateX(-0.6);
  thumb.rotateZ(side * 0.35);
  thumb.translate(-side * 0.008, -0.025, 0.035);
  parts.push(thumb);
  const merged = mergeAll(parts);
  return merged;
}

function shoeGeometry(): THREE.BufferGeometry {
  // Sneaker upper: a lathe-like rounded shape pointing +z from the ankle.
  const upper = new THREE.SphereGeometry(1, 28, 16);
  const p = upper.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    let y = p.getY(i);
    const z = p.getZ(i);
    if (y < -0.2) y = -0.2 - (y + 0.2) * 0.2; // flat bottom
    const toe = z > 0 ? 1 - 0.35 * z * Math.max(0, y) : 1;
    p.setXYZ(i, x * 0.045 * (z > 0.3 ? 0.95 : 1), y * 0.045 * toe, z * 0.128);
  }
  upper.computeVertexNormals();
  upper.translate(0, -0.05, 0.055);
  return upper;
}

function soleGeometry(): THREE.BufferGeometry {
  const sole = new THREE.CylinderGeometry(1, 1, 1, 32, 1);
  sole.scale(0.05, 0.022, 0.135);
  sole.translate(0, -0.083, 0.055);
  return sole;
}

function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const nonIndexed = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of nonIndexed) for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  const total = nonIndexed.reduce((n, g) => n + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const uvs = new Float32Array(total * 2);
  let o = 0;
  for (const g of nonIndexed) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nrm.set(g.attributes.normal.array as Float32Array, o * 3);
    if (g.attributes.uv) uvs.set(g.attributes.uv.array as Float32Array, o * 2);
    o += g.attributes.position.count;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  m.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return m;
}

/* ------------------------------------------------------------------------ */
/* Assembly                                                                  */
/* ------------------------------------------------------------------------ */

function std(color: string, roughness: number, extra: Partial<THREE.MeshPhysicalMaterialParameters> = {}): THREE.MeshPhysicalMaterial {
  return patchMaterial(new THREE.MeshPhysicalMaterial({ color, roughness, ...extra }));
}

export function createPerson(look: PersonLook): Person {
  const male = look.build === 'm';
  const meshes: THREE.Mesh[] = [];
  const root = new THREE.Group();
  root.name = look.helmet ? 'cyclist' : 'portrait subject';

  // --- Skeleton (bind pose) -------------------------------------------------
  const bone = (name: string, parent: THREE.Object3D | null, x: number, y: number, z: number) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    parent?.add(b);
    return b;
  };
  const pelvis = bone('pelvis', null, 0, PELVIS_Y, 0);
  root.add(pelvis);
  const chest = bone('chest', pelvis, 0, CHEST_Y, 0);
  const neck = bone('neck', chest, 0, NECK_Y, -0.008);
  const head = bone('head', neck, 0, HEAD_Y, 0.018);
  const shoulderX = SHOULDER.x * (male ? 1.08 : 1);
  const arms = [-1, 1].map((sx) => {
    const upper = bone(`upperArm${sx}`, chest, sx * shoulderX, SHOULDER.y, SHOULDER.z);
    const fore = bone(`foreArm${sx}`, upper, 0, -UPPER_ARM, 0);
    const hand = bone(`hand${sx}`, fore, 0, -FOREARM, 0);
    return { upper, fore, hand };
  });
  const legs = [-1, 1].map((sx) => {
    const thigh = bone(`thigh${sx}`, pelvis, sx * HIP_X, -0.02, 0);
    const shin = bone(`shin${sx}`, thigh, 0, -THIGH, 0);
    const foot = bone(`foot${sx}`, shin, 0, -SHIN, 0);
    return { thigh, shin, foot };
  });
  const bones: THREE.Bone[] = [pelvis, chest, neck, head, ...arms.flatMap((a) => [a.upper, a.fore, a.hand]), ...legs.flatMap((l) => [l.thigh, l.shin, l.foot])];
  const bi = (b: THREE.Bone) => bones.indexOf(b);
  root.updateMatrixWorld(true);

  // --- Body surface ---------------------------------------------------------
  const B = new BodyBuilder();
  const sh = male ? 1.1 : 1;
  const hp = male ? 0.92 : 1;
  const bust = male ? 0 : 0.012;
  const torso: Profile = [
    [-0.125, 0.03, 0.03, -0.005],
    [-0.105, 0.115 * hp, 0.085, -0.008],
    [-0.06, 0.158 * hp, 0.106, -0.012],
    [0.0, 0.168 * hp, 0.11, -0.012],
    [0.07, 0.158 * hp, 0.1, -0.004],
    [0.15, 0.138 * (male ? 1.05 : 1), 0.09, 0.002],
    [0.23, 0.142 * (male ? 1.06 : 1), 0.094, 0.006],
    [0.31, 0.152 * sh, 0.102 + bust * 0.4, 0.012],
    [0.37, 0.162 * sh, 0.108 + bust, 0.016 + bust * 0.5],
    [0.425, 0.172 * sh, 0.1, 0.006],
    [0.455, 0.18 * sh, 0.092, -0.002],
    [0.475, 0.176 * sh, 0.086, -0.006],
    [0.495, 0.16 * sh, 0.078, -0.01],
    [0.515, 0.122 * sh, 0.068, -0.012],
    [0.535, 0.078 * (male ? 1.1 : 1), 0.06, -0.01],
    [0.56, 0.062, 0.056, -0.008],
  ];
  const torsoY0 = PELVIS_Y;
  const knit = look.topFabric !== 'jersey';
  chain(B, {
    x: 0,
    yTop: torsoY0,
    down: false,
    profile: torso,
    joints: [
      { s: -1, bone: bi(pelvis), blend: 0 },
      { s: 0.12, bone: bi(chest), blend: 0.08 },
    ],
    regions: [
      { from: -1, to: -0.035, mat: Mat.Bottom, scale: look.bottomFabric === 'lycra' ? 1.01 : 1.03 },
      { from: -0.035, to: 0.52, mat: Mat.Top, scale: knit ? 1.06 : 1.015 },
      // Rolled crew-neck collar.
      { from: 0.52, to: 0.548, mat: Mat.Top, scale: knit ? 1.16 : 1.04 },
      { from: 0.548, to: 1, mat: Mat.Skin, scale: 1 },
    ],
    step: 0.015,
    segments: 48,
    p: (s) => (s > 0.4 ? 2.3 : 2.15),
    capStart: true,
    capEnd: true,
  });

  // Neck.
  chain(B, {
    x: 0,
    yTop: PELVIS_Y + CHEST_Y + 0.5,
    down: false,
    profile: [
      [0, 0.058 * (male ? 1.1 : 1), 0.058, -0.01],
      [0.05, 0.047 * (male ? 1.12 : 1), 0.051, -0.006],
      [0.09, 0.046 * (male ? 1.12 : 1), 0.056, 0.018],
      [0.12, 0.045 * (male ? 1.12 : 1), 0.06, 0.03],
      [0.15, 0.04, 0.05, 0.02],
    ],
    joints: [
      { s: -1, bone: bi(chest), blend: 0 },
      { s: 0.03, bone: bi(neck), blend: 0.03 },
      { s: 0.1, bone: bi(head), blend: 0.025 },
    ],
    regions: [{ from: -1, to: 1, mat: Mat.Skin, scale: 1 }],
    step: 0.02,
    segments: 24,
    capEnd: true,
  });

  // Arms.
  const armProfile: Profile = [
    // Rounded shoulder cap (deltoid) as a dome over the joint.
    ...[-0.044, -0.042, -0.038, -0.032, -0.025, -0.017, -0.008, 0].map((s) => [s, Math.sqrt(Math.max(0, 0.044 ** 2 - s * s)) * sh + 0.002, Math.sqrt(Math.max(0, 0.047 ** 2 - s * s)) + 0.002] as [number, number, number]),
    [0.035, 0.046 * sh, 0.05],
    [0.1, 0.047 * sh, 0.05],
    [0.18, 0.041 * sh, 0.044],
    [0.26, 0.035, 0.037],
    [0.285, 0.034, 0.036, -0.004],
    [0.34, 0.038 * (male ? 1.1 : 1), 0.037],
    [0.42, 0.031, 0.028],
    [0.5, 0.025, 0.02],
    [0.54, 0.023, 0.019],
  ];
  const sleeveEnd = look.topLongSleeves ? 0.495 : 0.15;
  const shoulderWorld = PELVIS_Y + CHEST_Y + SHOULDER.y;
  arms.forEach((a, i) => {
    const sx = i === 0 ? -1 : 1;
    chain(B, {
      x: sx * shoulderX,
      yTop: shoulderWorld,
      down: true,
      profile: armProfile.map(([s, rx, rz, cz]) => [s, rx, rz, (cz ?? 0) + SHOULDER.z] as [number, number, number, number]),
      joints: [
        { s: -1, bone: bi(chest), blend: 0 },
        { s: 0.0, bone: bi(a.upper), blend: 0.05 },
        { s: UPPER_ARM, bone: bi(a.fore), blend: 0.035 },
        { s: UPPER_ARM + FOREARM, bone: bi(a.hand), blend: 0.02 },
      ],
      regions: [
        { from: -1, to: Math.min(0.2, sleeveEnd), mat: Mat.Top, scale: knit ? 1.07 : 1.03 },
        { from: Math.min(0.2, sleeveEnd), to: sleeveEnd, mat: Mat.Top, scale: knit ? 1.07 : 1.03, min: knit ? 0.034 : 0 },
        { from: sleeveEnd, to: 1, mat: Mat.Skin, scale: 1 },
      ],
      step: 0.022,
      segments: 22,
      capStart: true,
      capEnd: true,
    });
  });

  // Legs.
  const legProfile: Profile = [
    // The thigh stays slim above the hip joint so it never pokes through the
    // top's hem; the full thigh/hip volume starts below it, inside the trousers.
    [-0.08, 0.03, 0.03, -0.01],
    [-0.04, 0.05 * hp, 0.055, -0.006],
    [0.0, 0.06 * hp, 0.064, -0.003],
    [0.05, 0.08 * hp, 0.084, 0.004],
    [0.1, 0.08 * hp, 0.084, 0.006],
    [0.2, 0.07, 0.074, 0.008],
    [0.34, 0.058, 0.06, 0.008],
    [0.42, 0.05, 0.055, 0.012],
    [0.5, 0.052, 0.058, -0.008],
    [0.58, 0.05, 0.056, -0.012],
    [0.7, 0.036, 0.04, -0.004],
    [0.79, 0.03, 0.032, 0],
    [0.84, 0.03, 0.032, 0],
  ];
  const hipWorld = PELVIS_Y - 0.02;
  const trouserEnd = look.bottomShort ? 0.3 : 0.8;
  legs.forEach((l, i) => {
    const sx = i === 0 ? -1 : 1;
    chain(B, {
      x: sx * HIP_X,
      yTop: hipWorld,
      down: true,
      profile: legProfile,
      joints: [
        { s: -1, bone: bi(pelvis), blend: 0 },
        { s: 0.0, bone: bi(l.thigh), blend: 0.07 },
        { s: THIGH, bone: bi(l.shin), blend: 0.045 },
        { s: THIGH + SHIN, bone: bi(l.foot), blend: 0.02 },
      ],
      regions: look.bottomShort
        ? [
            { from: -1, to: trouserEnd, mat: Mat.Bottom, scale: 1.02 },
            { from: trouserEnd, to: 1, mat: Mat.Skin, scale: 1 },
          ]
        : [
            { from: -1, to: 0.42, mat: Mat.Bottom, scale: 1.08 },
            { from: 0.42, to: trouserEnd, mat: Mat.Bottom, scale: 1.1, min: 0.056 },
            { from: trouserEnd, to: 1, mat: Mat.Skin, scale: 0.9 },
          ],
      step: 0.025,
      segments: 24,
      capStart: true,
      capEnd: true,
    });
  });

  const bodyGeo = B.build();
  const topMap = knit ? knitTexture() : jerseyTexture();
  const bottomMap = look.bottomFabric === 'lycra' ? jerseyTexture() : denimTexture();
  const skinMat = std(look.skin, 0.52, { sheen: 0.25, sheenRoughness: 0.6, sheenColor: new THREE.Color('#ffd9c8') });
  const topMat = std(look.top, knit ? 0.92 : 0.55, { map: topMap, sheen: knit ? 0.6 : 0.3, sheenRoughness: 0.7, sheenColor: new THREE.Color(look.top).lerp(new THREE.Color('#ffffff'), 0.4) });
  topMat.map!.repeat.set(knit ? 6 : 8, 4);
  const bottomMat = std(look.bottom, look.bottomFabric === 'lycra' ? 0.45 : 0.85, { map: bottomMap, sheen: 0.3, sheenRoughness: 0.8, sheenColor: new THREE.Color(look.bottom).lerp(new THREE.Color('#ffffff'), 0.3) });
  bottomMat.map!.repeat.set(4, 3);
  const body = new THREE.SkinnedMesh(bodyGeo, [skinMat, topMat, bottomMat]);
  body.castShadow = true;
  body.receiveShadow = true;
  body.frustumCulled = false;
  root.add(body);
  body.bind(new THREE.Skeleton(bones));
  meshes.push(body);

  // --- Head -----------------------------------------------------------------
  const headGroup = new THREE.Group();
  headGroup.position.y = HEAD_CENTER_Y;
  head.add(headGroup);
  const faceMat = std('#ffffff', 0.5, { map: faceTexture(look), sheen: 0.25, sheenRoughness: 0.6, sheenColor: new THREE.Color('#ffd9c8') });
  const headMesh = new THREE.Mesh(headGeometry(male), faceMat);
  headMesh.castShadow = true;
  headMesh.receiveShadow = true;
  headGroup.add(headMesh);
  meshes.push(headMesh);

  // Eyes set into the sockets, with glossy corneas and skin lids.
  const eyes: THREE.Object3D[] = [];
  const eyeMat = std('#ffffff', 0.06, { map: irisTexture(male ? '#4a6a7a' : '#5a3a22'), clearcoat: 1, clearcoatRoughness: 0.03 });
  const lidMat = std(look.skin, 0.5);
  for (const sx of [-1, 1]) {
    const surf = sculpt(new THREE.Vector3(sx * 0.4, 0.07, 1).normalize(), male);
    const eye = new THREE.Group();
    eye.position.copy(surf).add(new THREE.Vector3(0, 0, -0.0095));
    headGroup.add(eye);
    const ball = new THREE.Mesh(irisFacingSphere(0.0118), eyeMat);
    eye.add(ball);
    const upperLid = new THREE.Mesh(new THREE.SphereGeometry(0.0128, 24, 12, 0, Math.PI * 2, 0, 1.12), lidMat);
    upperLid.rotation.x = 0.04;
    const lowerLid = new THREE.Mesh(new THREE.SphereGeometry(0.0126, 24, 12, 0, Math.PI * 2, Math.PI - 1.05, 1.05), lidMat);
    lowerLid.rotation.x = -0.1;
    eye.add(upperLid, lowerLid);
    eyes.push(eye);
    meshes.push(ball, upperLid, lowerLid);
    // Ear.
    const ear = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), faceMat);
    ear.scale.set(0.009, 0.029, 0.018);
    ear.position.set(sx * HR.x * 0.97, -0.004, -0.006);
    ear.rotation.y = sx * 0.3;
    headGroup.add(ear);
    meshes.push(ear);
  }

  // Hair.
  const hairColor = new THREE.Color(look.hair);
  const hairMat = std(look.hair, 0.62, {
    map: hairTexture(),
    sheen: 0.6,
    sheenRoughness: 0.4,
    sheenColor: hairColor.clone().lerp(new THREE.Color('#d8b89a'), 0.25),
    side: THREE.DoubleSide,
  });
  hairMat.map!.repeat.set(6, 1);
  const hair = new THREE.Mesh(hairGeometry(male, look.longHair), hairMat);
  hair.castShadow = true;
  hair.receiveShadow = true;
  headGroup.add(hair);
  meshes.push(hair);
  if (look.longHair) {
    const fall = new THREE.Mesh(hairFallGeometry(), hairMat);
    fall.castShadow = true;
    fall.receiveShadow = true;
    headGroup.add(fall);
    meshes.push(fall);
  }

  if (look.helmet) {
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.135, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.52), std(look.helmet, 0.3, { clearcoat: 0.8 }));
    shell.scale.set(0.72, 0.85, 0.92);
    shell.position.set(0, 0.018, -0.01);
    shell.rotation.x = -0.12;
    const vents = new THREE.Mesh(new THREE.SphereGeometry(0.1365, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.2), std('#222222', 0.6));
    vents.scale.copy(shell.scale);
    vents.position.copy(shell.position);
    vents.rotation.copy(shell.rotation);
    headGroup.add(shell, vents);
    meshes.push(shell, vents);
  }
  if (look.sunglasses) {
    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.083, 0.083, 0.032, 40, 1, true, -1.05, 2.1),
      std('#111418', 0.05, { metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.02, side: THREE.DoubleSide }),
    );
    lens.scale.set(1, 1, 1.24);
    lens.position.set(0, 0.012, -0.006);
    headGroup.add(lens);
    meshes.push(lens);
  }

  // Hands and shoes ride rigidly on their bones.
  arms.forEach((a, i) => {
    const hand = new THREE.Mesh(handGeometry(i === 0 ? -1 : 1), skinMat);
    hand.castShadow = true;
    hand.receiveShadow = true;
    a.hand.add(hand);
    meshes.push(hand);
  });
  const shoeMat = std(look.shoes, 0.6, { sheen: 0.2 });
  const soleMat = std(male ? '#2a2a2a' : '#f2f0ea', 0.7);
  legs.forEach((l) => {
    const upper = new THREE.Mesh(shoeGeometry(), shoeMat);
    const sole = new THREE.Mesh(soleGeometry(), soleMat);
    for (const m of [upper, sole]) {
      m.castShadow = true;
      m.receiveShadow = true;
      l.foot.add(m);
      meshes.push(m);
    }
  });

  return { root, pelvis, chest, neck, head, arms, legs, eyes, meshes };
}

/** Sphere whose UV centre (0.5, 0.5) is at +z, so an iris texture faces forward. */
function irisFacingSphere(r: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 24, 16);
  const p = g.attributes.position as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / r;
    const y = p.getY(i) / r;
    const z = p.getZ(i) / r;
    // Azimuthal projection around +z: the iris covers ~40° of the eyeball.
    const ang = Math.acos(Math.max(-1, Math.min(1, z)));
    const k = ang / 0.53; // iris edge at ~29°, as on a real 24 mm eyeball
    const len = Math.hypot(x, y) || 1;
    uv.setXY(i, 0.5 + (x / len) * k * 0.5, 0.5 + (y / len) * k * 0.5);
  }
  return g;
}

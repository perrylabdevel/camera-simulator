/**
 * Procedurally authored textures (no external assets). Each is generated
 * once on a 2D canvas, tiles seamlessly and is tagged sRGB.
 */

import * as THREE from 'three';
import { fbm, mulberry32, valueNoise } from './noise';

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  return [c, ctx];
}

function toTexture(canvas: HTMLCanvasElement, repeat = true, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

type RGB = [number, number, number];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

function fillPixels(size: number, fn: (x: number, y: number) => RGB | [number, number, number, number]) {
  const [canvas, ctx] = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = fn(x, y);
      const i = (y * size + x) * 4;
      img.data[i] = c[0];
      img.data[i + 1] = c[1];
      img.data[i + 2] = c[2];
      img.data[i + 3] = c.length > 3 ? (c as number[])[3] : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, ctx };
}

/** Lawn: fine blade-scale speckle over soft patches, tiles every texture repeat. */
export function lawnTexture(size = 512): THREE.CanvasTexture {
  const P = 8;
  const { canvas, ctx } = fillPixels(size, (x, y) => {
    const u = (x / size) * P;
    const v = (y / size) * P;
    const patches = fbm(u * 0.5, v * 0.5, 3, 3, P / 2);
    const fine = valueNoise(u * 16, v * 16, 11, P * 16);
    const mid = fbm(u * 3, v * 3, 3, 5, P * 3);
    const base: RGB = mix3([58, 84, 30], [92, 116, 44], patches);
    const dry: RGB = [128, 124, 64];
    let c = mix3(base, dry, Math.max(0, mid - 0.62) * 1.6);
    const k = 0.72 + 0.5 * fine;
    c = [c[0] * k, c[1] * k, c[2] * k];
    return c.map((n) => Math.max(0, Math.min(255, n))) as RGB;
  });
  // Blade strokes add directional structure at close range.
  const rand = mulberry32(42);
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 9000; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 3 + rand() * 7;
    const a = -Math.PI / 2 + (rand() - 0.5) * 1.4;
    const g = 70 + rand() * 80;
    ctx.strokeStyle = `rgb(${g * 0.6},${g},${g * 0.35})`;
    ctx.lineWidth = 0.8 + rand() * 0.8;
    for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
      ctx.beginPath();
      ctx.moveTo(x + ox, y + oy);
      ctx.lineTo(x + ox + Math.cos(a) * len, y + oy + Math.sin(a) * len);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  return toTexture(canvas);
}

/** Fine asphalt / compacted gravel for the path. */
export function pathTexture(size = 512): THREE.CanvasTexture {
  const P = 4;
  const { canvas } = fillPixels(size, (x, y) => {
    const u = (x / size) * P;
    const v = (y / size) * P;
    const grain = valueNoise(u * 60, v * 60, 7, P * 60);
    const stones = valueNoise(u * 22, v * 22, 9, P * 22);
    const stain = fbm(u, v, 4, 2, P);
    let g = 118 + (grain - 0.5) * 50 + (stain - 0.5) * 40;
    if (stones > 0.78) g += (stones - 0.78) * 260;
    if (grain < 0.12) g -= 40;
    return [g * 1.02, g * 0.98, g * 0.92];
  });
  return toTexture(canvas);
}

/** Vertical-furrowed bark. */
export function barkTexture(size = 256): THREE.CanvasTexture {
  const P = 4;
  const { canvas } = fillPixels(size, (x, y) => {
    const u = (x / size) * P;
    const v = (y / size) * P;
    const warp = fbm(u * 2, v * 0.5, 3, 4, 0) * 2;
    const ridges = Math.abs(Math.sin((u * 3 + warp) * Math.PI));
    const n = valueNoise(u * 20, v * 8, 3, 0);
    const g = 40 + ridges * 55 + n * 25;
    return [g * 1.05, g * 0.92, g * 0.78];
  });
  return toTexture(canvas);
}

/**
 * A cluster of leaves on a transparent background, used on leaf cards.
 * `hue` shifts the palette per species.
 */
export function leafClusterTexture(seed: number, palette: RGB[], size = 512, count = 170): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(size);
  ctx.clearRect(0, 0, size, size);
  const rand = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    // Leaves are denser near the centre so the card silhouette is organic.
    const r = Math.pow(rand(), 0.7) * size * 0.4;
    const a = rand() * Math.PI * 2;
    const x = size / 2 + Math.cos(a) * r;
    const y = size / 2 + Math.sin(a) * r;
    const len = size * (0.085 + rand() * 0.06);
    const wid = len * (0.42 + rand() * 0.15);
    const rot = rand() * Math.PI * 2;
    const c = palette[Math.floor(rand() * palette.length)];
    const shade = 0.75 + rand() * 0.45;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(-len / 2, 0);
    ctx.quadraticCurveTo(0, -wid, len / 2, 0);
    ctx.quadraticCurveTo(0, wid, -len / 2, 0);
    ctx.fillStyle = `rgb(${c[0] * shade},${c[1] * shade},${c[2] * shade})`;
    ctx.fill();
    // Midrib.
    ctx.strokeStyle = `rgba(${c[0] * 1.25},${c[1] * 1.2},${c[2] * 0.9},0.55)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-len / 2, 0);
    ctx.lineTo(len / 2, 0);
    ctx.stroke();
    // Tiny twig.
    if (rand() < 0.25) {
      ctx.strokeStyle = 'rgb(70,55,40)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-len / 2, 0);
      ctx.lineTo(-len / 2 - len * 0.3, 0);
      ctx.stroke();
    }
    ctx.restore();
  }
  const t = toTexture(canvas, false);
  t.premultiplyAlpha = false;
  return t;
}

/** Painted wood planks (bench). */
export function woodTexture(size = 256): THREE.CanvasTexture {
  const { canvas } = fillPixels(size, (x, y) => {
    const u = x / size;
    const v = y / size;
    const grain = Math.sin((v * 40 + fbm(u * 4, v * 4, 3, 8, 4) * 6) * Math.PI) * 0.5 + 0.5;
    const g = 105 + grain * 40 + valueNoise(u * 64, v * 8, 2, 64) * 20;
    const seam = (y % (size / 4)) < 2 ? 0.55 : 1;
    return [g * 1.1 * seam, g * 0.78 * seam, g * 0.52 * seam];
  });
  return toTexture(canvas);
}

/** Painted plaster / render for the pavilion. */
export function plasterTexture(size = 256): THREE.CanvasTexture {
  const { canvas } = fillPixels(size, (x, y) => {
    const u = (x / size) * 4;
    const v = (y / size) * 4;
    const n = fbm(u * 2, v * 2, 5, 12, 8);
    const g = 222 + (n - 0.5) * 30;
    return [g, g * 0.985, g * 0.95];
  });
  return toTexture(canvas);
}

/** Knitted fabric micro-texture for clothing (used as a colour modulation map). */
export function fabricTexture(size = 128): THREE.CanvasTexture {
  const { canvas } = fillPixels(size, (x, y) => {
    const rib = 0.8 + 0.2 * Math.abs(Math.sin((x / size) * Math.PI * 32));
    const n = valueNoise((x / size) * 64, (y / size) * 64, 5, 64);
    const g = 255 * rib * (0.88 + n * 0.12);
    return [g, g, g];
  });
  return toTexture(canvas);
}

/** Petal / flower head sprite on transparent background. */
export function flowerTexture(size = 128): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(size);
  ctx.clearRect(0, 0, size, size);
  const petals = 6;
  for (let i = 0; i < petals; i++) {
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate((i / petals) * Math.PI * 2);
    ctx.beginPath();
    ctx.ellipse(size * 0.2, 0, size * 0.2, size * 0.1, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.08, 0, Math.PI * 2);
  ctx.fillStyle = '#e8b830';
  ctx.fill();
  const t = toTexture(canvas, false);
  return t;
}

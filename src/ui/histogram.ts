/** Histogram computation and drawing for RGBA8 images. */

export interface Histogram {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  l: Uint32Array;
  total: number;
  /** Fraction of pixels with any channel at 255 (clipped highlights). */
  highlightClip: number;
  /** Fraction of pixels with luminance ≤ 2 (crushed shadows). */
  shadowClip: number;
}

export function computeHistogram(data: ArrayLike<number>, step = 1): Histogram {
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const l = new Uint32Array(256);
  let total = 0;
  let hi = 0;
  let lo = 0;
  for (let i = 0; i < data.length; i += 4 * step) {
    const R = data[i];
    const G = data[i + 1];
    const B = data[i + 2];
    r[R]++;
    g[G]++;
    b[B]++;
    const Y = Math.round(0.2126 * R + 0.7152 * G + 0.0722 * B);
    l[Y]++;
    if (R >= 254 || G >= 254 || B >= 254) hi++;
    if (Y <= 2) lo++;
    total++;
  }
  return { r, g, b, l, total, highlightClip: hi / Math.max(1, total), shadowClip: lo / Math.max(1, total) };
}

export function drawHistogram(canvas: HTMLCanvasElement, h: Histogram, rgb = true): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const H = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  // Scale by a high percentile rather than the max so a single spike does not flatten everything.
  const all = Array.from(h.l).sort((a, b) => a - b);
  const scale = Math.max(1, all[Math.floor(all.length * 0.98)] * 1.1);
  const plot = (bins: Uint32Array, color: string, mode: GlobalCompositeOperation) => {
    ctx.globalCompositeOperation = mode;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * W;
      const y = H - Math.min(1, bins[i] / scale) * H;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  };
  if (rgb) {
    plot(h.r, 'rgba(255,70,70,0.55)', 'lighter');
    plot(h.g, 'rgba(70,255,90,0.55)', 'lighter');
    plot(h.b, 'rgba(80,120,255,0.6)', 'lighter');
  }
  plot(h.l, rgb ? 'rgba(230,230,230,0.35)' : 'rgba(230,230,230,0.8)', 'source-over');
  ctx.globalCompositeOperation = 'source-over';
  // Grid at stops-ish quarters.
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const x = Math.round((i / 4) * W) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  // Clipping indicators.
  if (h.highlightClip > 0.002) {
    ctx.fillStyle = '#ff5a4a';
    ctx.fillRect(W - 4 * dpr, 0, 4 * dpr, H);
  }
  if (h.shadowClip > 0.02) {
    ctx.fillStyle = '#4a8cff';
    ctx.fillRect(0, 0, 4 * dpr, H);
  }
}

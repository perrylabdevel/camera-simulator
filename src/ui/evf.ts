/**
 * Electronic-viewfinder overlay: framing grid, AF point, shooting info and
 * the exposure meter. Purely presentational — it receives a snapshot of
 * camera state each frame.
 */

import { el, setText } from './dom';
import { drawHistogram, type Histogram } from './histogram';

export interface EvfSnapshot {
  mode: string;
  shutter: string;
  aperture: string;
  iso: string;
  meterStops: number;
  ec: number;
  afMode: string;
  focal: string;
  metering: string;
  wb: string;
  support: string;
  afPoint: { x: number; y: number };
  afState: 'idle' | 'focused' | 'miss';
  afContinuous: boolean;
  spot: boolean;
  topLeft: string;
  topRight: string;
  grid: boolean;
  stats: string | null;
  hint: string | null;
}

export class EvfOverlay {
  private readonly afBox: HTMLDivElement;
  private readonly spot: HTMLDivElement;
  private readonly grid: HTMLDivElement;
  private readonly tl: HTMLDivElement;
  private readonly tr: HTMLDivElement;
  private readonly stats: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  readonly hist: HTMLCanvasElement;
  private lastBar = '';

  constructor(overlay: HTMLElement, private readonly bar: HTMLElement) {
    this.grid = el('div');
    for (const f of [1 / 3, 2 / 3]) {
      this.grid.append(el('div', { class: 'grid-line', style: `left:${f * 100}%;top:0;bottom:0;width:1px` }));
      this.grid.append(el('div', { class: 'grid-line', style: `top:${f * 100}%;left:0;right:0;height:1px` }));
    }
    this.spot = el('div', { class: 'spot-circle' });
    this.afBox = el('div', { class: 'af-box' });
    this.tl = el('div');
    this.tr = el('div', { class: 'right' });
    const info = el('div', { class: 'evf-info' }, this.tl, this.tr);
    this.hist = el('canvas', { class: 'evf-hist' });
    this.stats = el('div', { class: 'evf-stats' });
    this.hint = el('div', { class: 'evf-hint' });
    overlay.append(this.grid, this.spot, this.afBox, info, this.hist, this.stats, this.hint);
  }

  update(s: EvfSnapshot): void {
    this.grid.style.display = s.grid ? '' : 'none';
    this.afBox.style.left = `${s.afPoint.x * 100}%`;
    this.afBox.style.top = `${s.afPoint.y * 100}%`;
    const cls = `af-box${s.afState === 'focused' ? ' focused' : s.afState === 'miss' ? ' miss' : ''}${s.afContinuous ? ' continuous' : ''}`;
    if (this.afBox.className !== cls) this.afBox.className = cls;
    this.spot.style.display = s.spot ? '' : 'none';
    this.spot.style.left = `${s.afPoint.x * 100}%`;
    this.spot.style.top = `${s.afPoint.y * 100}%`;
    setText(this.tl, s.topLeft);
    setText(this.tr, s.topRight);
    this.stats.style.display = s.stats ? '' : 'none';
    if (s.stats) setText(this.stats, s.stats);
    this.hint.style.display = s.hint ? '' : 'none';
    if (s.hint) setText(this.hint, s.hint);

    const meter = Math.round(Math.max(-3.4, Math.min(3.4, s.meterStops)) * 3) / 3;
    const key = [s.mode, s.shutter, s.aperture, s.iso, meter, s.ec, s.afMode, s.focal, s.metering, s.wb, s.support].join('|');
    if (key !== this.lastBar) {
      this.lastBar = key;
      const ec = s.ec !== 0 ? `<span>${s.ec > 0 ? '+' : ''}${s.ec.toFixed(1)}</span>` : '';
      this.bar.innerHTML = `<span class="mode">${s.mode}</span><span>${s.shutter}</span><span>${s.aperture}</span><span>${s.iso}</span>${meterSvg(meter)}${ec}<span class="dim">${s.afMode}</span><span class="dim">${s.focal}</span><span class="dim">${s.metering}</span><span class="dim">${s.wb}</span><span class="dim">${s.support}</span>`;
    }
  }

  showHistogram(h: Histogram | null): void {
    this.hist.style.display = h ? '' : 'none';
    if (h) drawHistogram(this.hist, h, false);
  }
}

/** Classic −3…+3 exposure scale with a bar from zero to the reading. */
function meterSvg(stops: number): string {
  const W = 150;
  const H = 22;
  const x = (v: number) => 8 + ((v + 3) / 6) * (W - 16);
  let ticks = '';
  for (let i = -9; i <= 9; i++) {
    const v = i / 3;
    const major = i % 3 === 0;
    ticks += `<line x1="${x(v)}" x2="${x(v)}" y1="${major ? 2 : 5}" y2="9" stroke="#ddd" stroke-width="${major ? 1.4 : 1}"/>`;
  }
  const labels = `<text x="${x(-3)}" y="21" fill="#bbb" font-size="8" text-anchor="middle">−3</text><text x="${x(0)}" y="21" fill="#bbb" font-size="8" text-anchor="middle">0</text><text x="${x(3)}" y="21" fill="#bbb" font-size="8" text-anchor="middle">+3</text>`;
  const clamped = Math.max(-3, Math.min(3, stops));
  const over = Math.abs(stops) > 3.05;
  const x0 = x(0);
  const x1 = x(clamped);
  const bar = Math.abs(clamped) > 0.05 ? `<rect x="${Math.min(x0, x1)}" y="11" width="${Math.abs(x1 - x0)}" height="3" fill="${over ? '#ff6a55' : '#f2b33d'}"/>` : '';
  const needle = `<polygon points="${x1 - 3},16 ${x1 + 3},16 ${x1},11" fill="${over ? '#ff6a55' : '#fff'}"/>`;
  return `<span class="meter" title="Exposure relative to the meter (${stops >= 0 ? '+' : ''}${stops.toFixed(1)} EV)"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${ticks}${bar}${needle}${labels}</svg></span>`;
}

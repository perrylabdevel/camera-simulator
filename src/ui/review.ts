/**
 * Photo storage, filmstrip and the review screen (EXIF, histogram,
 * critique, "what you saw vs what the camera captured", A/B compare).
 */

import type { Note } from '../sim/critique';
import { formatAperture, formatDistance, formatShutterLong } from '../sim/stops';
import { el } from './dom';
import { drawHistogram, type Histogram } from './histogram';

export interface PhotoMeta {
  body: string;
  lens: string;
  focalMm: number;
  aperture: number;
  shutterS: number;
  iso: number;
  ec: number;
  focusDistanceM: number;
  focusMode: string;
  focusTarget?: string;
  metering: string;
  stabilization: string;
  support: string;
  whiteBalance: string;
  meterOffset: number;
  dofNearM: number;
  dofFarM: number;
  samples: number;
  width: number;
  height: number;
  takenAt: Date;
  cameraHeightM: number;
  subjectDistanceM?: number;
}

export interface Photo {
  id: number;
  url: string;
  seenUrl: string;
  thumbUrl: string;
  meta: PhotoMeta;
  notes: Note[];
  hist: Histogram;
}

export function shortSettings(m: PhotoMeta): string {
  return `${Math.round(m.focalMm)}mm ${formatAperture(m.aperture)} ${formatShutterLong(m.shutterS)} ISO ${m.iso}`;
}

export class Gallery {
  photos: Photo[] = [];
  private current = -1;
  private compareId: number | null = null;
  private showSeen = false;
  private zoom = false;

  constructor(
    private readonly strip: HTMLElement,
    private readonly modal: HTMLElement,
    private readonly onClose: () => void,
  ) {
    this.renderStrip();
    modal.addEventListener('keydown', (e) => e.stopPropagation());
  }

  get isOpen(): boolean {
    return !this.modal.classList.contains('hidden');
  }

  add(p: Photo): void {
    this.photos.push(p);
    this.renderStrip();
  }

  private renderStrip(): void {
    this.strip.innerHTML = '';
    if (this.photos.length === 0) {
      this.strip.append(el('span', { class: 'empty', text: 'Photographs you take appear here. Press the shutter (Space) to take one.' }));
      return;
    }
    this.photos.forEach((p, i) => {
      const b = el('button', { class: 'thumb', title: shortSettings(p.meta) }, el('img', { src: p.thumbUrl, alt: `Photo ${p.id}` }), el('span', { text: shortSettings(p.meta) }));
      b.addEventListener('click', () => this.open(i));
      this.strip.append(b);
    });
    this.strip.scrollLeft = this.strip.scrollWidth;
  }

  open(index: number): void {
    if (index < 0 || index >= this.photos.length) return;
    this.current = index;
    this.modal.classList.remove('hidden');
    this.render();
  }

  close(): void {
    this.modal.classList.add('hidden');
    this.onClose();
  }

  handleKey(e: KeyboardEvent): boolean {
    if (!this.isOpen) return false;
    if (e.code === 'Escape' || e.code === 'KeyR') this.close();
    else if (e.code === 'ArrowLeft') this.open(this.current - 1);
    else if (e.code === 'ArrowRight') this.open(this.current + 1);
    else if (e.code === 'KeyS') {
      this.showSeen = !this.showSeen;
      this.render();
    }
    return true;
  }

  private render(): void {
    const p = this.photos[this.current];
    const m = p.meta;
    this.modal.innerHTML = '';
    const nav = (d: number, label: string) => {
      const b = el('button', { class: 'btn', text: label, 'aria-label': d < 0 ? 'Previous photo' : 'Next photo' });
      b.disabled = this.current + d < 0 || this.current + d >= this.photos.length;
      b.addEventListener('click', () => this.open(this.current + d));
      return b;
    };
    const seenToggle = el('div', { class: 'seg', style: 'flex:0 0 auto' });
    for (const [label, seen] of [
      ['Camera captured', false],
      ['What you saw', true],
    ] as const) {
      const b = el('button', { text: label, class: this.showSeen === seen ? 'on' : '', title: 'Toggle with S' });
      b.addEventListener('click', () => {
        this.showSeen = seen;
        this.render();
      });
      seenToggle.append(b);
    }
    const cmp = el('select', { 'aria-label': 'Compare with' });
    cmp.append(el('option', { value: '', text: 'Compare with…' }));
    for (const o of this.photos) if (o.id !== p.id) cmp.append(el('option', { value: String(o.id), text: `#${o.id} · ${shortSettings(o.meta)}` }));
    cmp.value = this.compareId !== null && this.compareId !== p.id ? String(this.compareId) : '';
    cmp.addEventListener('change', () => {
      this.compareId = cmp.value ? Number(cmp.value) : null;
      this.render();
    });
    cmp.className = 'btn';
    const dl = el('a', { class: 'btn', href: this.showSeen ? p.seenUrl : p.url, download: `exposure-lab-${String(p.id).padStart(3, '0')}${this.showSeen ? '-seen' : ''}.jpg`, text: 'Download', style: 'text-decoration:none' });
    const close = el('button', { class: 'btn', text: 'Close ✕', 'aria-label': 'Close review' });
    close.addEventListener('click', () => this.close());
    const toolbar = el('div', { class: 'rv-toolbar' }, nav(-1, '◀'), el('span', { class: 'kbd', text: `${this.current + 1} / ${this.photos.length}` }), nav(1, '▶'), seenToggle, cmp, el('span', { class: 'spacer' }), dl, close);

    const imgs = el('div', { class: 'rv-images' });
    imgs.append(this.imagePanel(p, this.showSeen));
    const other = this.photos.find((o) => o.id === this.compareId && o.id !== p.id);
    if (other) imgs.append(this.imagePanel(other, this.showSeen));
    const main = el('div', { class: 'rv-main' }, toolbar, imgs);

    const side = el('div', { class: 'rv-side' });
    side.append(el('h3', { text: `Photo #${p.id}` }));
    const rows: [string, string][] = [
      ['Camera', m.body],
      ['Lens', m.lens],
      ['Focal length', `${Math.round(m.focalMm)} mm`],
      ['Aperture', formatAperture(m.aperture)],
      ['Shutter', formatShutterLong(m.shutterS)],
      ['ISO', String(m.iso)],
      ['Exposure comp.', `${m.ec > 0 ? '+' : ''}${m.ec.toFixed(1)} EV`],
      ['vs. meter', `${m.meterOffset >= 0 ? '+' : ''}${m.meterOffset.toFixed(1)} EV`],
      ['Metering', m.metering],
      ['Focus mode', m.focusMode],
      ['Focus distance', formatDistance(m.focusDistanceM)],
      ['Depth of field', `${formatDistance(m.dofNearM)} – ${formatDistance(m.dofFarM)}`],
      ['AF point on', m.focusTarget ?? '—'],
      ['Stabilisation', m.stabilization],
      ['Support', m.support],
      ['Camera height', `${m.cameraHeightM.toFixed(2)} m`],
      ['White balance', m.whiteBalance],
      ['Image', `${m.width} × ${m.height}`],
      ['Temporal samples', String(m.samples)],
      ['Taken', m.takenAt.toLocaleTimeString()],
    ];
    const table = el('table', { class: 'exif' });
    for (const [k, v] of rows) table.append(el('tr', {}, el('td', { text: k }), el('td', { text: v })));
    side.append(table);
    side.append(el('h3', { text: 'Histogram' }));
    const hc = el('canvas', { class: 'hist' });
    side.append(hc);
    side.append(
      el('div', {
        class: 'kbd',
        text: `Clipped highlights ${(p.hist.highlightClip * 100).toFixed(1)}% · crushed shadows ${(p.hist.shadowClip * 100).toFixed(1)}%`,
      }),
    );
    side.append(el('h3', { text: 'What happened' }));
    const ul = el('ul', { class: 'notes' });
    for (const n of p.notes) ul.append(el('li', { class: n.level }, el('b', { text: n.topic }), n.text));
    side.append(ul);
    side.append(el('p', { class: 'help', html: 'Click the image for a 100% view. <kbd>←</kbd>/<kbd>→</kbd> browse, <kbd>S</kbd> toggles what you saw, <kbd>Esc</kbd> closes.' }));

    this.modal.append(main, side);
    requestAnimationFrame(() => drawHistogram(hc, p.hist, true));
    close.focus();
  }

  private imagePanel(p: Photo, seen: boolean): HTMLElement {
    const img = el('img', { src: seen ? p.seenUrl : p.url, alt: `Photo ${p.id}` });
    const frame = el('div', { class: `frame${this.zoom ? ' zoom' : ''}` }, img);
    img.addEventListener('click', (e) => {
      this.zoom = !this.zoom;
      frame.classList.toggle('zoom', this.zoom);
      if (this.zoom) {
        // Centre the zoomed view on the clicked point.
        const r = img.getBoundingClientRect();
        const fx = (e.clientX - r.left) / r.width;
        const fy = (e.clientY - r.top) / r.height;
        requestAnimationFrame(() => {
          frame.scrollLeft = fx * img.naturalWidth - frame.clientWidth / 2;
          frame.scrollTop = fy * img.naturalHeight - frame.clientHeight / 2;
        });
      }
    });
    const caption = seen
      ? `#${p.id} · what you saw (instant, eye-adapted, everything in focus)`
      : `#${p.id} · ${shortSettings(p.meta)} · focus ${formatDistance(p.meta.focusDistanceM)}`;
    return el('div', { class: 'rv-img' }, frame, el('div', { class: 'cap', text: caption }));
  }
}

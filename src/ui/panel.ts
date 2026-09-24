/**
 * Camera control panel. Builds DOM once; `refresh()` re-reads state.
 * All camera functions are reachable here (not only via keyboard) so the
 * simulator works with mouse, touch and assistive tech.
 */

import { el, setText } from './dom';

type Refresher = () => void;

export class Panel {
  private refreshers: Refresher[] = [];
  constructor(readonly root: HTMLElement) {}

  refresh(): void {
    for (const r of this.refreshers) r();
  }

  heading(title: string, sub: string): void {
    this.root.append(el('h1', { text: title }), el('p', { class: 'sub', text: sub }));
  }

  group(title: string): HTMLElement {
    const g = el('div', { class: 'group' }, el('h2', { text: title }));
    this.root.append(g);
    return g;
  }

  stepper(parent: HTMLElement, label: string, text: () => string, step: (delta: number) => void, hint = ''): void {
    const val = el('span', { class: 'val' });
    const minus = el('button', { class: 'step', 'aria-label': `${label} decrease`, title: hint, text: '−' });
    const plus = el('button', { class: 'step', 'aria-label': `${label} increase`, title: hint, text: '+' });
    minus.addEventListener('click', () => step(-1));
    plus.addEventListener('click', () => step(1));
    parent.append(el('div', { class: 'row' }, el('span', { class: 'lbl', text: label }), minus, val, plus));
    this.refreshers.push(() => setText(val, text()));
  }

  slider(
    parent: HTMLElement,
    label: string,
    min: number,
    max: number,
    stepSize: number,
    get: () => number,
    set: (v: number) => void,
    enabled: () => boolean = () => true,
    text?: () => string,
  ): void {
    const input = el('input', { type: 'range', min, max, step: stepSize, 'aria-label': label });
    const val = el('span', { class: 'kbd', style: 'flex:0 0 64px;text-align:right' });
    input.addEventListener('input', () => set(Number(input.value)));
    parent.append(el('div', { class: 'row' }, el('span', { class: 'lbl', text: label }), input, val));
    this.refreshers.push(() => {
      if (document.activeElement !== input) input.value = String(get());
      input.disabled = !enabled();
      if (text) setText(val, text());
    });
  }

  segmented<T extends string>(parent: HTMLElement, label: string, options: { value: T; label: string; title?: string }[], get: () => T, set: (v: T) => void): void {
    const seg = el('div', { class: 'seg', role: 'group', 'aria-label': label });
    const buttons = options.map((o) => {
      const b = el('button', { text: o.label, title: o.title ?? o.label });
      b.addEventListener('click', () => set(o.value));
      seg.append(b);
      return b;
    });
    parent.append(el('div', { class: 'row' }, el('span', { class: 'lbl', text: label }), seg));
    this.refreshers.push(() => {
      const v = get();
      options.forEach((o, i) => buttons[i].classList.toggle('on', o.value === v));
    });
  }

  select(parent: HTMLElement, label: string, options: { value: string; label: string }[], get: () => string, set: (v: string) => void): void {
    const s = el('select', { 'aria-label': label });
    for (const o of options) s.append(el('option', { value: o.value, text: o.label }));
    s.addEventListener('change', () => set(s.value));
    parent.append(el('div', { class: 'row' }, el('span', { class: 'lbl', text: label }), s));
    this.refreshers.push(() => {
      if (s.value !== get()) s.value = get();
    });
  }

  checks(parent: HTMLElement, items: { label: string; get: () => boolean; set: (v: boolean) => void; title?: string }[]): void {
    const box = el('div', { class: 'checks' });
    for (const it of items) {
      const input = el('input', { type: 'checkbox' });
      input.addEventListener('change', () => it.set(input.checked));
      box.append(el('label', { title: it.title ?? '' }, input, it.label));
      this.refreshers.push(() => {
        input.checked = it.get();
      });
    }
    parent.append(box);
  }

  readout(parent: HTMLElement, text: () => string): void {
    const r = el('div', { class: 'readout' });
    parent.append(r);
    this.refreshers.push(() => {
      const t = text();
      if (r.innerHTML !== t) r.innerHTML = t;
    });
  }

  buttons(parent: HTMLElement, items: { label: string; onClick: () => void; title?: string }[]): void {
    const box = el('div', { class: 'btns' });
    for (const it of items) {
      const b = el('button', { class: 'btn small', text: it.label, title: it.title ?? '' });
      b.addEventListener('click', it.onClick);
      box.append(b);
    }
    parent.append(box);
  }
}

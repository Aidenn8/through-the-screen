// The places in a scene: a small strip above the dock that lists them by
// name (click one to glide there) with the tour button, and a caption that
// names a place when the window arrives at it. The strip fades with the dock;
// the caption shows by itself and fades on its own.

import { h, icon } from './dom.js';

/**
 * A button clicked with the pointer gives the focus back. Chrome leaves it
 * on the button, and the next key pressed (an arrow, Esc) makes that focus
 * "visible", which keeps the controls on screen (App #updateIdle) through a
 * whole tour. Keyboard presses (detail 0) keep their focus.
 */
function letGo(e) {
  if (e?.detail > 0) e.currentTarget?.blur?.();
}

export class StationStrip {
  /**
   * @param {HTMLElement} root
   * @param {{onStation:(id:string)=>void, onTour:()=>void}} cb
   */
  constructor(root, { onStation, onTour }) {
    this.onStation = onStation;
    this.list = h('div', { class: 'stations-list' });
    this.tourBtn = h('button', { class: 'chip-btn tour-btn', 'aria-pressed': 'false', title: 'Guided tour (T)', onclick: (e) => { letGo(e); onTour(); } },
      icon('play'), h('span', { text: 'Tour' }));
    this.el = h('nav', { class: 'stations glass fades', 'aria-label': 'Places in this scene', hidden: true },
      this.list, h('span', { class: 'sep' }), this.tourBtn);
    root.append(this.el);
    this.buttons = new Map();
    this.current = null;
  }

  /** @param {{id:string,title:string}[]} stations (fewer than two hides the strip) */
  setStations(stations) {
    // A focused place keeps the focus if the new list has it (else the first
    // place takes it), so keyboard users are not dropped onto the page.
    let focusedId = null;
    for (const [id, b] of this.buttons) if (b === document.activeElement) focusedId = id;
    this.buttons.clear();
    const items = (stations || []).map((s, i) => {
      const b = h('button', {
        class: 'chip-btn',
        title: i === 0 ? `${s.title} (H)` : s.title,
        onclick: (e) => { letGo(e); this.onStation(s.id); },
      }, s.title);
      this.buttons.set(s.id, b);
      return b;
    });
    this.list.replaceChildren(...items);
    this.hasPlaces = items.length >= 2;
    this.el.hidden = !this.hasPlaces || this.suppressed;
    this.current = null;
    if (focusedId !== null && !this.el.hidden) {
      (this.buttons.get(focusedId) || items[0])?.focus({ preventScroll: true });
    }
  }

  /** The place the window is at (null between places). */
  setCurrent(id) {
    if (id === this.current) return;
    this.buttons.get(this.current)?.removeAttribute('aria-current');
    this.current = id;
    this.buttons.get(id)?.setAttribute('aria-current', 'true');
  }

  setTour(on) {
    this.tourBtn.setAttribute('aria-pressed', String(on));
    this.tourBtn.replaceChildren(icon(on ? 'stop' : 'play'), h('span', { text: on ? 'Stop tour' : 'Tour' }));
  }

  /** Hidden while something else needs the bottom of the screen (steady check, intro). */
  suppress(on) {
    this.suppressed = on;
    this.el.hidden = on || !this.hasPlaces;
  }
}

export class Caption {
  constructor(root) {
    this.el = h('div', { class: 'caption glass', role: 'status', 'aria-live': 'polite' });
    root.append(this.el);
    this.timer = null;
  }

  /** Show one line for a while, then fade it. */
  show(text, ms = 2200) {
    clearTimeout(this.timer);
    this.el.textContent = text;
    this.el.classList.add('on');
    this.timer = setTimeout(() => this.el.classList.remove('on'), ms);
  }

  hide() {
    clearTimeout(this.timer);
    this.el.classList.remove('on');
  }
}

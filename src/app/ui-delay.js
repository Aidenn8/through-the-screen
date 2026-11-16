// Camera delay check: the screen flashes white a few times while the camera
// watches how your face lights up (src/tracking/latency.js).

import { h } from './dom.js';

export class DelayCheck {
  constructor(root, { onStart, onClose }) {
    this.flash = h('div', { class: 'flash', 'aria-hidden': 'true', hidden: true });
    this.title = h('h1', { id: 'delay-title' });
    this.text = h('p', { class: 'lead' });
    this.startBtn = h('button', { class: 'btn primary', onclick: () => onStart() }, 'Start');
    this.closeBtn = h('button', { class: 'btn', onclick: () => onClose() }, 'Cancel');
    this.card = h('div', { class: 'card glass', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'delay-title', hidden: true },
      this.title, this.text, h('div', { class: 'actions' }, this.startBtn, this.closeBtn));
    root.append(this.flash, this.card);
  }

  get open() {
    return !this.card.hidden || !this.flash.hidden;
  }

  showIntro() {
    this.title.textContent = 'Measure the camera delay';
    this.text.textContent = 'Dim the room, face the screen and keep still: the screen will flash white eight times.';
    this.startBtn.hidden = false;
    this.closeBtn.textContent = 'Cancel';
    this.card.hidden = false;
    requestAnimationFrame(() => this.startBtn.focus());
  }

  showResult(text) {
    this.title.textContent = 'Camera delay';
    this.text.textContent = text;
    this.startBtn.hidden = false;
    this.startBtn.textContent = 'Measure again';
    this.closeBtn.textContent = 'Done';
    this.flash.hidden = true;
    this.card.hidden = false;
  }

  /** Full-screen black, ready to flash. */
  dark() {
    this.card.hidden = true;
    this.flash.style.background = '#000';
    this.flash.hidden = false;
  }

  /** @param {boolean} white */
  set(white) {
    this.flash.style.background = white ? '#fff' : '#000';
  }

  hide() {
    this.card.hidden = true;
    this.flash.hidden = true;
  }
}

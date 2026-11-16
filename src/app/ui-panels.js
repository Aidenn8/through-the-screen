// Steady check panel and credit-card calibration.

import { h, fmt } from './dom.js';
import { CARD_MM } from '../core/display.js';
import { STEADY_STEPS, DISTANCE_CM } from './calibration.js';

function range(id, label, min, max, step, format, onInput) {
  const out = h('span', { class: 'value', id: `${id}-value` });
  const input = h('input', { type: 'range', id, min, max, step, 'aria-describedby': `${id}-value` });
  input.addEventListener('input', () => onInput(Number(input.value)));
  return {
    el: h('div', { class: 'field' }, h('div', { class: 'row' }, h('label', { for: id, text: label }), out), input),
    set(v) {
      if (document.activeElement !== input) input.value = v;
      out.textContent = format(v);
    },
  };
}

export class SteadyPanel {
  /**
   * A short guided check, one instruction per step (STEADY_STEPS).
   * @param {object} cb { onStep(i), onIpd(mm), onCameraHeight(mm), onMeasure(m) -> Promise<string>, onDone() }
   */
  constructor(root, { onStep, onIpd, onCameraHeight, onMeasure, onDone }) {
    this.onStep = onStep;
    this.step = 0;
    this.eyes = { open: 'right', closed: 'left' };
    this.ipd = range('steady-ipd', 'Eye spacing', 50, 76, 0.5, (v) => `${fmt(v, 1)} mm`, onIpd);
    this.height = range('steady-cam', 'Camera height', -6, 6, 0.25, (v) => `${v > 0 ? '+' : ''}${fmt(v, 2)} mm`, onCameraHeight);
    this.distance = h('input', { type: 'number', id: 'steady-distance', min: String(DISTANCE_CM.min), max: String(DISTANCE_CM.max), step: '1', value: '60', style: { width: '64px' }, 'aria-label': 'Distance in cm' });
    this.measureBtn = h('button', { class: 'btn small', onclick: async () => {
      this.measureBtn.disabled = true;
      this.distanceNote.textContent = 'Hold still…';
      try {
        this.distanceNote.textContent = await onMeasure(Number(this.distance.value) / 100);
      } finally {
        this.measureBtn.disabled = false;
      }
    } }, 'Measure');
    this.distanceNote = h('p', { class: 'hint', 'aria-live': 'polite' });
    this.distanceBox = h('div', { class: 'field' },
      h('div', { class: 'row', style: { justifyContent: 'flex-start', alignItems: 'center', gap: '8px' } },
        this.distance, h('span', { text: 'cm' }), this.measureBtn),
      this.distanceNote);
    this.title = h('h2', {});
    this.counter = h('p', { class: 'hint step-count' });
    this.text = h('p', { class: 'lead-step' });
    this.now = h('p', { class: 'now', 'aria-live': 'off' });
    this.back = h('button', { class: 'btn', onclick: () => this.go(this.step - 1) }, 'Back');
    this.next = h('button', { class: 'btn primary', onclick: () => (this.step >= STEADY_STEPS.length - 1 ? onDone() : this.go(this.step + 1)) }, 'Next');
    this.el = h('aside', { class: 'steady glass', 'aria-label': 'Steady check', hidden: true },
      this.counter, this.title, this.text,
      this.ipd.el, this.height.el, this.distanceBox,
      this.now,
      h('div', { class: 'actions' }, this.back, this.next));
    root.append(this.el);
    this.go(0);
  }

  get open() {
    return !this.el.hidden;
  }

  setOpen(on) {
    this.el.hidden = !on;
    if (on) {
      this.go(0);
      requestAnimationFrame(() => this.next.focus());
    }
  }

  /** @param {{open:'left'|'right', closed:'left'|'right'}} eyes */
  setEyes(eyes) {
    if (eyes.open === this.eyes.open) return;
    this.eyes = eyes;
    this.#render();
  }

  go(i) {
    this.step = Math.max(0, Math.min(STEADY_STEPS.length - 1, i));
    this.distanceNote.textContent = '';
    this.#render();
    this.onStep?.(this.step, STEADY_STEPS[this.step]);
  }

  #render() {
    const st = STEADY_STEPS[this.step];
    this.title.textContent = st.title;
    this.counter.textContent = `Step ${this.step + 1} of ${STEADY_STEPS.length}`;
    this.text.textContent = st.text.replace('{open}', this.eyes.open).replace('{closed}', this.eyes.closed);
    this.ipd.el.hidden = st.control !== 'ipd';
    this.height.el.hidden = st.control !== 'height';
    this.distanceBox.hidden = st.control !== 'distance';
    this.back.hidden = this.step === 0;
    this.next.textContent = this.step >= STEADY_STEPS.length - 1 ? 'Done' : 'Next';
  }

  /** @param {{ipdMm:number, trimY:number, distanceCm:number|null, eye:string}} d */
  update({ ipdMm, trimY, distanceCm, eye }) {
    this.ipd.set(ipdMm);
    this.height.set(trimY);
    this.now.textContent = distanceCm
      ? `Your ${eye} eye is ${fmt(distanceCm, 0)} cm from the screen.`
      : 'Looking for your face.';
  }
}

export class CardCalibration {
  constructor(root, { onSave, onCancel, describe = null }) {
    this.describe = describe;
    this.outline = h('div', { class: 'outline', 'aria-hidden': 'true' });
    this.slider = h('input', { type: 'range', id: 'card-size', min: 150, max: 900, step: 0.5, 'aria-label': 'Outline size' });
    this.slider.addEventListener('input', () => this.#set(Number(this.slider.value)));
    this.readout = h('span', { class: 'value' });
    this.el = h('div', { class: 'cardcal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cardcal-title', hidden: true },
      this.outline,
      h('div', { class: 'panel glass' },
        h('h2', { id: 'cardcal-title', text: 'Measure this screen', style: { fontSize: '15px', margin: '0 0 8px' } }),
        h('p', { text: 'Hold any bank or ID card flat against the screen and resize the outline until it matches the card’s edges. Arrow keys fine-tune.' }),
        h('div', { class: 'row' }, h('label', { for: 'card-size', text: 'Screen size' }), this.readout),
        this.slider,
        h('div', { class: 'actions' },
          h('button', { class: 'btn primary', onclick: () => onSave(this.width) }, 'Save'),
          h('button', { class: 'btn', onclick: onCancel }, 'Cancel'))));
    this.el.addEventListener('keydown', (e) => {
      if (e.target === this.slider) return;
      const step = e.shiftKey ? 5 : 0.5;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { this.#set(this.width + step); e.preventDefault(); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { this.#set(this.width - step); e.preventDefault(); }
    });
    root.append(this.el);
    this.width = 450;
  }

  #set(w) {
    this.width = Math.max(150, Math.min(900, w));
    this.slider.value = this.width;
    this.outline.style.width = `${this.width}px`;
    this.outline.style.height = `${(this.width * CARD_MM.height) / CARD_MM.width}px`;
    this.readout.textContent = this.describe ? this.describe(this.width) : `${fmt(this.width, 1)} px`;
  }

  get open() {
    return !this.el.hidden;
  }

  show(initialCssWidth) {
    this.#set(initialCssWidth);
    this.el.hidden = false;
    requestAnimationFrame(() => this.slider.focus());
  }

  hide() {
    this.el.hidden = true;
  }
}

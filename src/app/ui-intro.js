// First-run card, permission states and problems. Plain sentences, two choices.

import { h, icon } from './dom.js';

export class IntroCard {
  constructor(root, { onCamera, onMouse, onEye, onFullscreen = null }) {
    this.onCamera = onCamera;
    this.onFullscreen = onFullscreen;
    this.onEye = onEye;
    this.eye = 'right';
    this.onMouse = onMouse;
    this.el = h('div', { class: 'card glass', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'card-title', hidden: true });
    root.append(this.el);
  }

  #render(title, body, actions, fine = null) {
    this.isIntro = title === 'Look through your screen';
    const parts = [
      h('h1', { id: 'card-title', text: title }),
      ...body,
      actions.length ? h('div', { class: 'actions' }, actions) : null,
      fine ? h('p', { class: 'fine', text: fine }) : null,
    ];
    this.el.replaceChildren(...parts.filter(Boolean));
    this.el.hidden = false;
    const first = this.el.querySelector('.btn.primary') || this.el.querySelector('button');
    if (first) requestAnimationFrame(() => first.focus());
  }

  #privacy() {
    return h('div', { class: 'privacy' }, icon('lock'),
      h('span', { text: 'The video is processed on this computer and never leaves it. Nothing is recorded or uploaded.' }));
  }

  #eyeChoice() {
    const opts = [['right', 'Right eye'], ['left', 'Left eye']];
    const group = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Eye you will keep open' });
    const buttons = opts.map(([v, label]) => h('button', {
      role: 'radio', 'aria-checked': String(v === this.eye), tabindex: v === this.eye ? '0' : '-1',
      onclick: () => {
        this.eye = v;
        for (const b of buttons) {
          const on = b.dataset.v === v;
          b.setAttribute('aria-checked', String(on));
          b.tabIndex = on ? 0 : -1;
        }
        this.onEye?.(v);
      },
      'data-v': v,
    }, label));
    group.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const i = buttons.findIndex((b) => b.dataset.v === this.eye);
      const b = buttons[(i + 1) % buttons.length];
      b.click();
      b.focus();
      e.preventDefault();
    });
    group.append(...buttons);
    return h('div', { class: 'field', style: { margin: '14px 0 4px' } },
      h('span', { class: 'label', text: 'Which eye will you keep open?' }), group,
      h('p', { class: 'hint', text: 'Close the other one. One eye sees real depth; two eyes see a flat screen.' }));
  }

  /** @param {string} eye @param {{fullscreen?:boolean}} [o] already full screen */
  showIntro(eye = 'right', { fullscreen = false } = {}) {
    this.eye = eye;
    const fsStep = fullscreen
      ? h('p', { class: 'step done', text: 'Full screen: done.' })
      : h('div', { class: 'step' },
        h('p', { text: 'First, go full screen so the scene lines up with your display.' }),
        h('button', { class: 'btn small', onclick: () => this.onFullscreen?.() }, 'Go full screen (F)'));
    this.#render(
      'Look through your screen',
      [
        h('p', { class: 'lead', text: 'Your camera follows your eye and redraws the scene from exactly where it is, so the scene holds still in space as you move. Lean to look around things; use the arrow keys, or drag, to move around the set.' }),
        fsStep,
        this.#eyeChoice(),
        this.#privacy(),
      ],
      [
        h('button', { class: 'btn primary', onclick: () => this.onCamera() }, 'Use camera'),
        h('button', { class: 'btn', onclick: () => this.onMouse() }, 'Use mouse instead'),
      ],
      'Sit about an arm’s length away, with your face evenly lit.',
    );
  }

  /**
   * Both eyes open for a moment while eye spacing is measured.
   * @returns {{setProgress(f:number):void}}
   */
  showMeasuring({ onSkip }) {
    const bar = h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, h('span', {}));
    const note = h('p', { class: 'hint', 'aria-live': 'polite' });
    this.#render(
      'Keep both eyes open',
      [h('p', { class: 'lead', text: 'Look at the screen for two seconds while the camera measures the spacing of your eyes.' }), bar, note],
      [h('button', { class: 'btn', onclick: () => onSkip() }, 'Skip')],
    );
    return {
      setProgress(f) {
        const pct = Math.round(Math.max(0, Math.min(1, f)) * 100);
        bar.setAttribute('aria-valuenow', String(pct));
        bar.firstChild.style.width = `${pct}%`;
      },
      /** The camera cannot see a face right now. */
      setLooking(on) {
        const text = on ? 'Looking for your face… Face the screen, with your face evenly lit.' : '';
        if (note.textContent !== text) note.textContent = text;
      },
    };
  }

  showRequesting() {
    this.#render(
      'Allow the camera',
      [h('p', { class: 'lead', text: 'Chrome is asking to use your camera, in a prompt at the top of the screen.' }), this.#privacy()],
      [h('button', { class: 'btn', onclick: () => this.onMouse() }, 'Use mouse instead')],
    );
  }

  showStarting() {
    this.#render(
      'Starting face tracking',
      [h('p', { class: 'lead' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Loading the face model. This takes a moment the first time.')],
      [],
    );
  }

  /** @param {'denied'|'none'|'busy'|'failed'|'stopped'} kind */
  showProblem(kind, detail = '') {
    const copy = {
      denied: ['Camera is blocked', 'The view follows your mouse instead. To use the camera, click the camera icon at the right end of the address bar, choose Allow, then try again. On a Mac, Chrome also needs permission in System Settings, Privacy & Security, Camera.'],
      none: ['No camera found', 'The view follows your mouse instead. Connect a camera, then try again.'],
      busy: ['The camera is busy', 'Another app is using it, so the view follows your mouse for now. Close that app, then try again.'],
      failed: ['Face tracking could not start', `The view follows your mouse instead.${detail ? ` (${detail})` : ''}`],
      stopped: ['Face tracking stopped', `${detail || 'It could not be restarted.'} The view follows your mouse for now.`],
    }[kind] || ['Something went wrong', detail];
    this.#render(copy[0], [h('p', { class: 'lead', text: copy[1] })], [
      h('button', { class: 'btn primary', onclick: () => this.onCamera() }, 'Try again'),
      h('button', { class: 'btn', onclick: () => this.hide() }, 'Keep using mouse'),
    ]);
  }

  hide() {
    this.el.hidden = true;
  }

  get open() {
    return !this.el.hidden;
  }
}

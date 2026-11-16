// The small control pill at the bottom, the scene menu and the full screen tip.

import { h, icon, ICONS } from './dom.js';

export class Dock {
  constructor(root, { onScene, onSteady, onSettings, onFullscreen, onDismissTip }) {
    this.onScene = onScene;
    this.status = h('div', { class: 'status', role: 'status', 'aria-live': 'polite' },
      h('span', { class: 'dot' }), h('span', { class: 'label', text: '' }));
    this.sceneBtn = h('button', { class: 'chip-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: 'Scenes ([ and ])', onclick: () => this.toggleMenu() }, 'Scene');
    this.steadyBtn = h('button', { class: 'icon-btn', 'aria-label': 'Steady check', 'aria-pressed': 'false', title: 'Steady check (C)', onclick: onSteady });
    this.steadyBtn.append(icon('steady'));
    this.settingsBtn = h('button', { class: 'icon-btn', 'aria-label': 'Settings', 'aria-pressed': 'false', title: 'Settings (S)', onclick: onSettings });
    this.settingsBtn.append(icon('settings'));
    this.fsBtn = h('button', { class: 'icon-btn', 'aria-label': 'Full screen', title: 'Full screen (F)', onclick: onFullscreen });
    this.fsBtn.append(icon('fullscreen'));
    this.el = h('nav', { class: 'dock glass fades', 'aria-label': 'Controls' },
      this.status, h('span', { class: 'sep' }), this.sceneBtn, this.steadyBtn, this.settingsBtn, this.fsBtn);
    this.menu = h('div', { class: 'menu glass fades', role: 'menu', hidden: true });
    this.tipText = h('p', { text: 'Full screen lines the scene up with your display.' });
    this.tip = h('div', { class: 'toast glass fades', role: 'note', hidden: true },
      this.tipText,
      h('button', { class: 'btn small primary', onclick: onFullscreen }, 'Go full screen'),
      h('button', { class: 'icon-btn', 'aria-label': 'Dismiss', onclick: onDismissTip }, icon('close')));
    root.append(this.tip, this.menu, this.el);
    this.scenes = [];
    this.current = null;
  }

  setStatus(text, tone = 'muted', detail = '') {
    this.status.querySelector('.label').textContent = text;
    this.status.dataset.tone = tone;
    // The reason behind a warning, on hover (and read out with the status).
    if (detail) this.status.title = detail;
    else this.status.removeAttribute('title');
  }

  setScenes(list, currentId) {
    this.scenes = list;
    this.current = currentId;
    const cur = list.find((s) => s.id === currentId);
    this.sceneBtn.textContent = cur ? cur.title : 'Scene';
    this.sceneBtn.hidden = list.length === 0;
    this.menu.replaceChildren(...list.map((s, i) => h('button', {
      role: 'menuitemradio',
      'aria-checked': String(s.id === currentId),
      onclick: () => { this.closeMenu(); this.onScene(s.id); },
    }, `${s.title}`, i < 9 ? h('span', { class: 'sr-only', text: ` (key ${i + 1})` }) : null)));
  }

  toggleMenu() {
    if (this.menu.hidden) this.openMenu();
    else this.closeMenu();
  }

  openMenu() {
    this.menu.hidden = false;
    this.sceneBtn.setAttribute('aria-expanded', 'true');
    (this.menu.querySelector('[aria-checked="true"]') || this.menu.querySelector('button'))?.focus();
  }

  closeMenu() {
    if (this.menu.hidden) return;
    this.menu.hidden = true;
    this.sceneBtn.setAttribute('aria-expanded', 'false');
  }

  setFullscreen(on) {
    this.fsBtn.innerHTML = on ? ICONS.exitFullscreen : ICONS.fullscreen;
    this.fsBtn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
    this.fsBtn.title = on ? 'Exit full screen (F)' : 'Full screen (F)';
  }

  /** @param {{sidePanel?:boolean}} [o] a side panel is open beside the page */
  showTip(on, { sidePanel = false } = {}) {
    this.tip.hidden = !on;
    this.tipText.textContent = sidePanel
      ? 'A side panel is open, so the scene can’t line up with your display. Go full screen, or close the panel.'
      : 'Full screen lines the scene up with your display.';
  }

  setPressed(which, on) {
    const b = which === 'steady' ? this.steadyBtn : this.settingsBtn;
    b.setAttribute('aria-pressed', String(on));
  }
}

// Settings sheet. Built once; update() pushes values in so focus and slider
// drags are never interrupted.

import { h, icon, fmt } from './dom.js';
import { DISPLAY_PRESETS } from '../core/display.js';
import { CAMERA_PRESETS } from '../tracking/camera-presets.js';
import { STRENGTH, TURN_STRENGTH } from '../tracking/view-map.js';

const EYE_MODES = [['one', 'One eye'], ['both', 'Both eyes'], ['phone', 'Phone lens']];

function segmented(name, options, onPick) {
  const el = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': name });
  const buttons = options.map(([value, label]) => h('button', {
    role: 'radio', 'aria-checked': 'false', 'data-value': value, onclick: () => onPick(value),
  }, label));
  el.append(...buttons);
  // Arrow keys move between options, like native radios.
  el.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    const j = (i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length;
    buttons[j].focus();
    onPick(buttons[j].dataset.value);
    e.preventDefault();
  });
  return {
    el,
    set(value) {
      for (const b of buttons) {
        const on = b.dataset.value === value;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
      }
    },
  };
}

function slider({ id, label, min, max, step, format, onInput }) {
  const out = h('span', { class: 'value', id: `${id}-value` });
  const input = h('input', { type: 'range', id, min, max, step, 'aria-describedby': `${id}-value` });
  input.addEventListener('input', () => onInput(Number(input.value)));
  const field = h('div', { class: 'field' }, h('div', { class: 'row' }, h('label', { for: id, text: label }), out), input);
  return {
    el: field,
    input,
    set(v) {
      if (document.activeElement !== input) input.value = v;
      out.textContent = format(v);
    },
  };
}

export class SettingsSheet {
  constructor(root, { onChange, onCamera, onCard, onDelay, onSteady, onReset, onClose, onRecentre }) {
    this.onChange = onChange;
    this.current = null; // the settings last shown
    const r = (this.refs = {});

    r.display = h('select', { id: 'set-display', onchange: () => onChange({ display: r.display.value }) },
      ...Object.entries(DISPLAY_PRESETS).map(([id, p]) => h('option', { value: id }, p.label)),
      h('option', { value: 'custom' }, 'Measured with a card'));
    r.displayHint = h('p', { class: 'hint', 'aria-live': 'polite' });

    r.camera = h('select', { id: 'set-camera', onchange: () => onCamera(r.camera.value) });
    r.cameraType = h('select', { id: 'set-camera-type', onchange: () => onChange({ cameraPreset: r.cameraType.value }) },
      ...Object.entries(CAMERA_PRESETS).map(([id, p]) => h('option', { value: id }, p.label)));
    r.cameraHint = h('p', { class: 'hint' });
    r.delayHint = h('p', { class: 'hint' });

    r.eyeMode = segmented('Viewpoint', EYE_MODES, (v) => onChange({ eyeMode: v }));
    r.eye = segmented('Eye kept open', [['right', 'Right eye'], ['left', 'Left eye']], (v) => onChange({ eye: v }));
    r.autoEye = h('input', { type: 'checkbox', id: 'set-auto-eye', onchange: () => onChange({ autoEye: r.autoEye.checked }) });
    r.oneBox = h('div', { class: 'field' },
      h('span', { class: 'label', text: 'Eye kept open' }), r.eye.el,
      h('label', { class: 'check', for: 'set-auto-eye' }, r.autoEye, 'Switch to whichever eye is open'));
    r.modeHint = h('p', { class: 'hint' });
    r.phoneEye = segmented('Phone beside', [['left', 'Left eye'], ['right', 'Right eye']], (v) => onChange({ phone: { eye: v } }));
    const num = (key, label) => {
      const input = h('input', { type: 'number', step: '1', min: '-150', max: '150', id: `set-phone-${key}` });
      input.addEventListener('change', () => onChange({ phone: { [key]: Number(input.value) || 0 } }));
      r[`phone_${key}`] = input;
      return h('label', { for: `set-phone-${key}` }, label, input);
    };
    r.phoneBox = h('div', { class: 'field' },
      h('span', { class: 'label', text: 'Phone lens position, in mm from that eye' }),
      r.phoneEye.el,
      h('div', { class: 'grid3' }, num('rightMm', 'Right'), num('upMm', 'Up'), num('forwardMm', 'Forward')),
      h('p', { class: 'hint', text: 'Hold the phone beside your eye, lens level with it, and film. Keep your face visible to the laptop camera.' }));

    r.ipd = slider({
      id: 'set-ipd', label: 'Eye spacing', min: 50, max: 76, step: 0.5,
      format: (v) => `${fmt(v, 1)} mm`, onInput: (v) => onChange({ ipdMm: v, ipdManual: true }),
    });
    r.ipdHint = h('p', { class: 'hint', 'aria-live': 'polite' });
    r.ipdAuto = h('button', { class: 'link', onclick: () => onChange({ ipdManual: false }) }, 'Measure it automatically');

    r.direction = segmented('View direction', [['look', 'Look around'], ['window', 'True window']], (v) => onChange({ viewDirection: v }));
    r.directionHint = h('p', { class: 'hint' });
    r.strength = slider({
      id: 'set-strength', label: 'Strength', min: STRENGTH.min, max: STRENGTH.max, step: 0.1,
      format: (v) => `${fmt(v, 1)}x`,
      onInput: (v) => { const s = this.current; if (s) onChange({ strength: { ...s.strength, [s.viewDirection]: v } }); },
    });
    r.turnSteer = h('input', { type: 'checkbox', id: 'set-turn', onchange: () => onChange({ turnSteer: r.turnSteer.checked }) });
    r.turnStrength = slider({
      id: 'set-turn-strength', label: 'Turn strength', min: TURN_STRENGTH.min, max: TURN_STRENGTH.max, step: 0.05,
      format: (v) => `${fmt(v, 2)}x`, onInput: (v) => onChange({ turnStrength: v }),
    });
    r.smoothness = slider({
      id: 'set-smoothness', label: 'Smoothness', min: 0, max: 1, step: 0.05,
      format: (v) => (v < 0.2 ? 'Responsive' : v < 0.4 ? 'Quick' : v < 0.6 ? 'Balanced' : v < 0.8 ? 'Smooth' : 'Calm'),
      onInput: (v) => onChange({ smoothness: v }),
    });
    r.predict = h('input', { type: 'checkbox', id: 'set-predict', onchange: () => onChange({ motionMode: r.predict.checked ? 'predict' : 'follow' }) });
    r.smoothing = slider({
      id: 'set-smoothing', label: 'Steadiness', min: 0, max: 1, step: 0.05,
      format: (v) => (v < 0.34 ? 'Quick' : v < 0.67 ? 'Balanced' : 'Steady'), onInput: (v) => onChange({ smoothing: v }),
    });
    r.prediction = slider({
      id: 'set-prediction', label: 'Look-ahead', min: 0, max: 1.5, step: 0.05,
      format: (v) => `${Math.round(v * 100)} %`, onInput: (v) => onChange({ prediction: v }),
    });

    r.eyeSource = h('input', { type: 'checkbox', id: 'set-eye-source', onchange: () => onChange({ eyeSource: r.eyeSource.checked ? 'iris' : 'stable' }) });
    r.gaze = h('input', { type: 'checkbox', id: 'set-gaze', onchange: () => onChange({ gazeCompensation: r.gaze.checked }) });
    r.hud = h('input', { type: 'checkbox', id: 'set-hud', onchange: () => onChange({ hud: r.hud.checked }) });

    const closeBtn = h('button', { class: 'icon-btn', 'aria-label': 'Close settings', onclick: onClose });
    closeBtn.append(icon('close'));

    this.el = h('aside', { class: 'sheet glass', 'aria-label': 'Settings', hidden: true },
      h('header', {}, h('h2', { text: 'Settings' }), closeBtn),
      h('section', {},
        h('h3', { text: 'Display' }),
        h('div', { class: 'field' }, h('label', { for: 'set-display', text: 'This screen' }), r.display, r.displayHint),
        h('button', { class: 'btn small', onclick: onCard }, 'Measure with a card')),
      h('section', {},
        h('h3', { text: 'Camera' }),
        h('div', { class: 'field' }, h('label', { for: 'set-camera', text: 'Camera' }), r.camera),
        h('div', { class: 'field' }, h('label', { for: 'set-camera-type', text: 'Where it sits' }), r.cameraType, r.cameraHint),
        h('div', { class: 'field' }, h('button', { class: 'btn small', onclick: onDelay }, 'Measure camera delay'), r.delayHint)),
      h('section', {},
        h('h3', { text: 'Viewpoint' }),
        h('div', { class: 'field' }, r.eyeMode.el, r.modeHint),
        r.oneBox,
        r.phoneBox,
        r.ipd.el, r.ipdHint, r.ipdAuto,
        h('div', { class: 'field', style: { marginTop: '12px' } },
          h('button', { class: 'btn small', onclick: onSteady }, 'Open steady check'))),
      h('section', {},
        h('h3', { text: 'Motion' }),
        h('div', { class: 'field' }, r.direction.el, r.directionHint),
        r.strength.el,
        h('p', { class: 'hint', text: 'How far the view moves for each centimetre you move: 1x is exact, 3x (the Look around default) turns a 15 cm lean into a 45 cm swing. Depth gets half the extra. In Look around, rising and ducking get 1.5 times as much, since a seated head moves up and down less than sideways.' }),
        r.turnBox = h('div', { class: 'field', style: { marginTop: '10px' } },
          h('label', { class: 'check', for: 'set-turn' }, r.turnSteer, 'Head turn steers the view'),
          r.turnStrength.el,
          h('p', { class: 'hint', text: 'Tilt your head back to see more of the top, look down for the bottom, turn right or left to see more of that side. Small turns are ignored. At 1x a big turn moves the view up to about 25 cm up or down, 30 cm sideways.' })),
        h('div', { class: 'field', style: { marginTop: '8px' } }, h('button', { class: 'btn small', onclick: () => onRecentre?.() }, 'Re-centre (R)')),
        r.smoothnessBox = h('div', {},
          r.smoothness.el,
          h('p', { class: 'hint', text: 'Calm follows your head through a soft spring and ignores small sway. Responsive follows sooner.' })),
        h('label', { class: 'check', for: 'set-predict', style: { marginTop: '10px' } }, r.predict, 'Predict ahead (the earlier tuning: quicker, but it can swing past where you stop)'),
        r.predictBox = h('div', {},
          r.smoothing.el,
          r.prediction.el,
          h('p', { class: 'hint', text: 'Look-ahead makes up for camera delay. Lower it if the scene overshoots when you stop moving.' }))),
      h('section', {},
        h('h3', { text: 'Details' }),
        h('label', { class: 'check', for: 'set-hud' }, r.hud, 'Show tracking details (D)'),
        h('label', { class: 'check', for: 'set-eye-source', style: { marginTop: '8px' } }, r.eyeSource, 'Follow pupils live (moves when you glance around)'),
        h('label', { class: 'check', for: 'set-gaze', style: { marginTop: '8px' } }, r.gaze, 'Correct for the eye turning when you turn your head (experimental)'),
        h('p', { class: 'hint', text: 'To test it: in the steady check, turn your head and hold still. If the cross slowly creeps onto your eye’s reflection over a few seconds with this off, turn it on.' }),
        h('p', { style: { marginTop: '14px' } }, h('button', { class: 'link', onclick: onReset }, 'Reset all settings'))));
    root.append(this.el);
  }

  get open() {
    return !this.el.hidden;
  }

  setOpen(on) {
    this.el.hidden = !on;
    if (on) requestAnimationFrame(() => this.el.querySelector('select, button, input')?.focus());
  }

  /**
   * @param {object} s settings
   * @param {object} env { cameras, cameraId, presetId, hfovDeg, measuredIpdMm, usedIpdMm, screenMatches, zoom, sidePanel }
   */
  update(s, env) {
    const r = this.refs;
    r.display.value = s.display;
    r.display.querySelector('option[value="custom"]').disabled = !s.customDisplay;
    const notes = [];
    if (s.display === 'custom' && s.customDisplay) notes.push(`Measured: ${fmt(s.customDisplay.widthMm, 1)} × ${fmt(s.customDisplay.heightMm, 1)} mm.`);
    if (!env.screenMatches) notes.push('This window seems to be on a different screen. Pick its size or measure it with a card.');
    if (env.zoom !== 1) notes.push(`Page zoom is ${Math.round(env.zoom * 100)} %. That is handled, but 100 % is the most reliable.`);
    if (env.sidePanel) notes.push('A side panel or developer tools are open beside the page. Close them, or go full screen, so the scene lines up.');
    r.displayHint.textContent = notes.join(' ');
    r.displayHint.classList.toggle('warn', !env.screenMatches || env.sidePanel);

    const cams = env.cameras || [];
    r.camera.replaceChildren(...(cams.length ? cams : [{ deviceId: '', label: 'No camera in use' }])
      .map((c) => h('option', { value: c.deviceId }, c.label)));
    r.camera.value = env.cameraId || '';
    r.camera.disabled = cams.length < 2;
    r.cameraType.value = env.presetId;
    r.delayHint.textContent = env.cameraDelayMeasured
      ? `This camera's delay: ${env.cameraDelayMs} ms, measured.`
      : `This camera's delay: ${env.cameraDelayMs} ms, an estimate. Measuring it makes the view keep up better.`;
    r.cameraHint.textContent = `${CAMERA_PRESETS[env.presetId]?.hint || ''} It sees ${fmt(env.hfovDeg, 0)}° across; the steady check measures that.`;

    r.eyeMode.set(s.eyeMode);
    r.modeHint.textContent = {
      one: 'Close the other eye: one eye sees real depth, two eyes see a flat screen.',
      both: 'Renders from between your eyes. Easier to watch, much flatter.',
      phone: 'For filming: renders from the phone’s lens instead of your eye.',
    }[s.eyeMode] || '';
    r.oneBox.hidden = s.eyeMode !== 'one';
    r.eye.set(s.eye);
    r.autoEye.checked = s.autoEye;
    r.phoneBox.hidden = s.eyeMode !== 'phone';
    r.phoneEye.set(s.phone.eye);
    for (const k of ['rightMm', 'upMm', 'forwardMm']) {
      if (document.activeElement !== r[`phone_${k}`]) r[`phone_${k}`].value = s.phone[k];
    }

    r.ipd.set(s.ipdManual ? s.ipdMm : (env.usedIpdMm ?? s.ipdMm));
    if (s.ipdManual) {
      r.ipdHint.textContent = env.measuredIpdMm ? `Set by you. Your irises suggest ${fmt(env.measuredIpdMm, 1)} mm.` : 'Set by you.';
    } else {
      r.ipdHint.textContent = env.measuredIpdMm
        ? `Measuring from the size of your irises: ${fmt(env.measuredIpdMm, 1)} mm so far.`
        : 'Measured automatically from the size of your irises once the camera sees you.';
    }
    r.ipdAuto.hidden = !s.ipdManual;

    this.current = s;
    r.direction.set(s.viewDirection);
    const exactHere = s.eyeMode === 'phone';
    r.directionHint.textContent = (s.viewDirection === 'look'
      ? 'Look around: the view turns the way you lean from where you sit, and holds while you hold the lean. Lean right to see more of the right side. Moved your chair? Press R to re-centre.'
      : 'True window: the scene stays put behind the glass, like a real window. Lean right to see more of the left side.')
      + (exactHere ? ' Phone lens mode always uses the true window at 1x.' : ' V switches, R re-centres.');
    r.strength.set(s.strength[s.viewDirection] ?? 1);
    // Head turn is a Look around setting; True window (and the phone lens) ignore it.
    r.turnBox.hidden = s.viewDirection !== 'look' || exactHere;
    r.turnSteer.checked = s.turnSteer !== false;
    r.turnStrength.set(s.turnStrength ?? TURN_STRENGTH.default);
    r.turnStrength.input.disabled = s.turnSteer === false;
    r.smoothness.set(s.smoothness);
    r.predict.checked = s.motionMode === 'predict';
    r.smoothnessBox.hidden = s.motionMode === 'predict';
    r.predictBox.hidden = s.motionMode !== 'predict';
    r.smoothing.set(s.smoothing);
    r.prediction.set(s.prediction);
    r.hud.checked = s.hud;
    r.eyeSource.checked = s.eyeSource === 'iris';
    r.gaze.checked = !!s.gazeCompensation;
    r.gaze.disabled = s.eyeSource === 'iris';
  }
}

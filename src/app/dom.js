// Tiny DOM helpers and icons.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const svg = (body) => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  settings: svg('<path d="M4 6h8M15 6h1M4 14h2M9 14h7"/><circle cx="13.5" cy="6" r="1.8"/><circle cx="7.5" cy="14" r="1.8"/>'),
  fullscreen: svg('<path d="M3.5 7.5v-4h4M12.5 3.5h4v4M16.5 12.5v4h-4M7.5 16.5h-4v-4"/>'),
  exitFullscreen: svg('<path d="M7.5 3.5v4h-4M16.5 7.5h-4v-4M12.5 16.5v-4h4M3.5 12.5h4v4"/>'),
  steady: svg('<circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="2.5"/><path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3"/>'),
  close: svg('<path d="M5 5l10 10M15 5L5 15"/>'),
  lock: svg('<rect x="4.5" y="9" width="11" height="8" rx="2"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/>'),
};

export function icon(name) {
  const span = document.createElement('span');
  span.innerHTML = ICONS[name];
  return span.firstElementChild;
}

export function fmt(n, digits = 1) {
  if (!Number.isFinite(n)) return '–';
  const s = n.toFixed(digits);
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s; // no "-0"
}

// First: the page may only talk to its own server (src/tracking/net-guard.js).
import './tracking/net-guard-install.js';
import './app/styles.css';
import { App } from './app/app.js';

const params = new URLSearchParams(location.search);
const app = new App({
  canvas: document.getElementById('view'),
  uiRoot: document.getElementById('ui'),
  params,
});

// Test hook for the headless end-to-end tools (tools/core-*.mjs).
if (params.has('e2e')) window.__wd = { app };

app.start().catch((err) => {
  console.error(err);
  const el = document.getElementById('fatal');
  el.hidden = false;
  el.textContent = `This page could not start: ${err?.message || err}. WebGL may be turned off in this browser.`;
});

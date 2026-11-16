// Shared headless Chrome launcher for the core tools. Never opens a window.
//
// Uses Playwright's full Chromium in new headless mode (`channel: 'chromium'`),
// which runs WebGL on the Mac's GPU (ANGLE on Metal), unlike the stripped
// headless shell.

import { chromium } from 'playwright';

export const BASE = process.env.WD_BASE || 'http://localhost:5190/';

/**
 * @param {object} o
 * @param {string} [o.video] path to a .y4m or .mjpeg fed as the webcam
 * @param {boolean} [o.denyCamera] make getUserMedia fail with NotAllowedError
 * @param {{width:number,height:number}} [o.viewport]
 */
export async function launch({ video = null, denyCamera = false, viewport = { width: 1710, height: 1107 }, dpr = 2 } = {}) {
  const args = [
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader',
    // Keep timers and rAF running at full rate in the background.
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ];
  if (!denyCamera) args.push('--use-fake-ui-for-media-stream');
  if (video) args.push(`--use-file-for-fake-video-capture=${video}`);
  const browser = await chromium.launch({ headless: true, channel: 'chromium', args });
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: dpr,
    screen: { width: viewport.width, height: viewport.height },
    permissions: denyCamera ? [] : ['camera'],
  });
  return { browser, context };
}

/** Collect console output and page errors. */
export function watch(page, log = []) {
  page.on('console', (m) => log.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`));
  return log;
}

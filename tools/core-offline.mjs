#!/usr/bin/env node
// Does anything leave the machine while the camera is tracking?
//
// Every hostname except localhost resolves to a local TCP listener, so
// nothing can reach the internet; the listener reads the TLS hello to name
// the host each connection was meant for. The page and its worker are
// watched too: any request to another origin counts. Tracking runs longer
// than a minute (MediaPipe's usage logger sends once a minute), then the
// camera stops, which closes the model and would flush anything queued.
//
//   node tools/core-offline.mjs --video face.y4m [--seconds 80] [--port 5191] [--sink 5195]
//
// Prints a JSON summary; exits 1 if the page or its worker asked for anything
// off this machine's server. (Chromium itself also calls home: update,
// accounts and autofill hosts show up at the sink. Those come from the
// browser, not the page; the verdict counts the app's requests and any
// connection to MediaPipe's log host.)

import net from 'node:net';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const VIDEO = arg('video');
const SECONDS = Number(arg('seconds', 80));
const PORT = Number(arg('port', 5191));
const SINK = Number(arg('sink', 5195));
if (!VIDEO) throw new Error('--video face.y4m is required (a fake webcam; the real camera is never used)');

const t0 = Date.now();
const at = () => Math.round((Date.now() - t0) / 1000);

/** Host name from a TLS ClientHello's server_name extension, or null. */
function sni(buf) {
  for (let i = 0; i + 9 < buf.length; i++) {
    if (buf[i] !== 0 || buf[i + 1] !== 0 || buf[i + 6] !== 0) continue;
    const extLen = buf.readUInt16BE(i + 2);
    const listLen = buf.readUInt16BE(i + 4);
    const nameLen = buf.readUInt16BE(i + 7);
    if (extLen === listLen + 2 && listLen === nameLen + 3 && nameLen > 0 && i + 9 + nameLen <= buf.length) {
      const name = buf.subarray(i + 9, i + 9 + nameLen).toString('latin1');
      if (/^[a-z0-9.-]+$/i.test(name)) return name;
    }
  }
  return null;
}

// The sink: every outside connection lands here and is closed at once.
const sink = [];
const listener = net.createServer((sock) => {
  sock.once('data', (buf) => {
    sink.push({ at: at(), host: sni(buf) || '(not TLS)' });
    sock.destroy();
  });
  sock.on('error', () => {});
});
await new Promise((r, j) => listener.once('error', j).listen(SINK, '127.0.0.1', r));

const server = await createServer({
  root,
  configFile: resolve(root, 'tools', 'core-vite.config.mjs'),
  logLevel: 'error',
  server: { port: PORT, strictPort: true, host: '127.0.0.1' },
});
await server.listen();
const BASE = `http://127.0.0.1:${PORT}/`;

const browser = await chromium.launch({
  headless: true,
  channel: 'chromium',
  args: [
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-video-capture=${VIDEO}`,
    '--autoplay-policy=no-user-gesture-required', '--enable-gpu', '--ignore-gpu-blocklist',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    `--host-resolver-rules=MAP * 127.0.0.1:${SINK}, EXCLUDE localhost, EXCLUDE 127.0.0.1`,
  ],
});
let summary;
try {
  const context = await browser.newContext({
    viewport: { width: 1710, height: 1107 }, deviceScaleFactor: 2, screen: { width: 1710, height: 1107 }, permissions: ['camera'],
  });
  const outside = [];
  const local = (u) => u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:');
  context.on('request', (r) => { if (!local(r.url())) outside.push({ at: at(), url: r.url() }); });
  const page = await context.newPage();
  const log = [];
  page.on('console', (m) => log.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`));
  page.on('worker', (w) => w.on('console', (m) => log.push(`[worker ${m.type()}] ${m.text()}`)));
  await page.goto(`${BASE}?e2e&autostart=camera&scene=soundstage`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__wd?.app?.tracker?.state === 'running', null, { timeout: 60000 });
  const startedAt = at();
  await page.waitForTimeout(SECONDS * 1000);
  const stats = await page.evaluate(() => {
    const tr = window.__wd.app.tracker;
    return { results: tr.stats.results, mode: tr.landmarkerInfo?.mode, faceVisible: tr.faceVisible };
  });
  await page.evaluate(() => window.__wd.app.useMouse()); // stops the camera and closes the model
  await page.waitForTimeout(5000);
  summary = {
    trackedSeconds: at() - startedAt,
    tracking: stats,
    outsideRequestsFromApp: outside,
    sinkConnections: sink,
    sinkConnectionsToMediaPipeLog: sink.filter((s) => s.host.startsWith('odml.')).length,
    blockedByApp: log.filter((l) => /Blocked a request/.test(l)),
    cspViolations: log.filter((l) => /Content Security Policy/i.test(l)),
    pageErrors: log.filter((l) => l.startsWith('[pageerror]')),
  };
} finally {
  await browser.close();
  await server.close();
  listener.close();
}
console.log(JSON.stringify(summary, null, 1));
const bad = summary.outsideRequestsFromApp.length + summary.sinkConnectionsToMediaPipeLog;
console.log(`outside requests from the app: ${summary.outsideRequestsFromApp.length}; connections to the MediaPipe log host: ${summary.sinkConnectionsToMediaPipeLog} ${bad ? 'FAIL' : 'ok'}`);
process.exitCode = bad ? 1 : 0;

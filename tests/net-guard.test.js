import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameOriginOnly, isSameOriginOnly } from '../src/tracking/net-guard.js';

const LOG_URL = 'https://odml.pa.googleapis.com/v1/log'; // MediaPipe's usage logger

function fakeScope(href = 'http://localhost:5190/src/tracking/landmarker-worker.js') {
  const sent = { fetch: [], xhr: [], beacon: [] };
  class XMLHttpRequest {
    open(method, url) { this.url = url; }
    send() { sent.xhr.push(this.url); }
  }
  const scope = {
    location: href ? new URL(href) : undefined,
    fetch: (input) => { sent.fetch.push(typeof input === 'string' ? input : input.url ?? String(input)); return Promise.resolve({ ok: true }); },
    XMLHttpRequest,
    navigator: { sendBeacon: (url) => { sent.beacon.push(url); return true; } },
    console: { info: () => {} },
  };
  return { scope, sent };
}

test('network guard: the app’s own server is reachable', async () => {
  const { scope, sent } = fakeScope();
  sameOriginOnly(scope);
  assert.ok(isSameOriginOnly(scope));
  await scope.fetch('/models/face_landmarker.task');
  await scope.fetch('http://localhost:5190/node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm');
  await scope.fetch(new URL('http://localhost:5190/x'));
  await scope.fetch({ url: 'http://localhost:5190/y' }); // a Request
  await scope.fetch('blob:http://localhost:5190/1b2c');
  await scope.fetch('data:application/octet-stream;base64,AAAA');
  assert.equal(sent.fetch.length, 6);
  const x = new scope.XMLHttpRequest();
  x.open('GET', '/a');
  x.send();
  assert.deepEqual(sent.xhr, ['/a']);
  assert.equal(scope.navigator.sendBeacon('/b'), true);
});

test('network guard: MediaPipe’s usage log and every other host are refused', async () => {
  const { scope, sent } = fakeScope();
  sameOriginOnly(scope);
  await assert.rejects(scope.fetch(LOG_URL, { method: 'POST', body: 'x' }), TypeError);
  await assert.rejects(scope.fetch({ url: LOG_URL }), TypeError);
  await assert.rejects(scope.fetch('http://localhost:5191/'), TypeError, 'another port is another origin');
  await assert.rejects(scope.fetch('https://localhost:5190/'), TypeError, 'another scheme is another origin');
  await assert.rejects(scope.fetch('blob:https://example.com/1b2c'), TypeError);
  await assert.rejects(scope.fetch('//example.com/x'), TypeError);
  assert.equal(sent.fetch.length, 0, 'nothing reached the real fetch');
  const x = new scope.XMLHttpRequest();
  assert.throws(() => x.open('POST', LOG_URL));
  assert.equal(scope.navigator.sendBeacon(LOG_URL, 'x'), false);
  assert.deepEqual(sent.xhr, []);
  assert.deepEqual(sent.beacon, []);
});

test('network guard: fails closed when it cannot tell where it is', async () => {
  const { scope, sent } = fakeScope(null);
  sameOriginOnly(scope);
  await assert.rejects(scope.fetch('/models/face_landmarker.task'), TypeError);
  await assert.rejects(scope.fetch('http://[bad'), TypeError);
  assert.equal(sent.fetch.length, 0);
});

test('network guard: installing twice keeps one wrapper', async () => {
  const { scope, sent } = fakeScope();
  sameOriginOnly(scope);
  const f = scope.fetch;
  sameOriginOnly(scope);
  assert.equal(scope.fetch, f);
  await scope.fetch('/ok');
  assert.equal(sent.fetch.length, 1);
});

test('network guard: a scope without the guard is reported as unguarded', () => {
  const { scope } = fakeScope();
  assert.equal(isSameOriginOnly(scope), false);
});

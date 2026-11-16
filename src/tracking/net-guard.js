// Keep the face tracker on this machine: network requests may go only to the
// server the page came from (the model, the WebAssembly runtime).
//
// MediaPipe Tasks (1.2.3) sends usage statistics to Google once a minute and
// on close: task type, running mode, OS, library version and inference
// timings, POSTed with fetch to odml.pa.googleapis.com. No video or landmarks
// are in it, but the app promises that nothing leaves the computer, and the
// library has no option to turn it off. So fetch, XMLHttpRequest and
// navigator.sendBeacon are wrapped before MediaPipe loads (in the worker and
// on the main thread) and refuse every other origin. The logger treats the
// refusal as a failed send and stops its timer.
//
// It fails closed: a URL that cannot be read, or a scope without a location,
// is refused. index.html adds a Content-Security-Policy (connect-src 'self')
// as a second layer for the page; a worker started from a URL does not
// inherit it, which is why the wrapper is needed there.

const MARK = Symbol.for('window-display.sameOriginOnly');

function urlOf(input) {
  if (typeof input === 'string') return input;
  if (input && typeof input.url === 'string') return input.url; // Request
  if (input && typeof input.href === 'string') return input.href; // URL
  return String(input);
}

/**
 * @param {object} scope globalThis of a window or worker
 * @returns {(input:any) => {ok:boolean, host:string}}
 */
function makeCheck(scope) {
  let base = null;
  try {
    base = scope.location ? new URL(String(scope.location.href)) : null;
  } catch {
    base = null;
  }
  const origin = base && (base.protocol === 'http:' || base.protocol === 'https:') ? base.origin : null;
  return (input) => {
    try {
      const u = new URL(urlOf(input), base ?? undefined);
      if (u.protocol === 'data:') return { ok: true, host: '' }; // inline, no network
      // A blob: URL carries the origin that made it.
      const target = u.protocol === 'blob:' ? new URL(u.pathname) : u;
      return { ok: origin !== null && target.origin === origin, host: target.host || u.protocol };
    } catch {
      return { ok: false, host: '(unreadable address)' };
    }
  };
}

/** True when scope's fetch is the same-origin wrapper. */
export function isSameOriginOnly(scope = globalThis) {
  return !!scope.fetch?.[MARK];
}

/**
 * Wrap fetch, XMLHttpRequest and navigator.sendBeacon in scope so that only
 * same-origin requests go through. Safe to call more than once.
 * @param {object} [scope] globalThis of a window or worker
 */
export function sameOriginOnly(scope = globalThis) {
  if (isSameOriginOnly(scope)) return;
  const check = makeCheck(scope);
  const told = new Set();
  const refuse = (host) => {
    if (!told.has(host)) {
      told.add(host);
      scope.console?.info?.(`Blocked a request to ${host}: this app only talks to its own server.`);
    }
    return `Blocked a request to ${host}: this app only talks to its own server.`;
  };

  const realFetch = typeof scope.fetch === 'function' ? scope.fetch.bind(scope) : null;
  const fetch = (input, init) => {
    const c = check(input);
    if (!c.ok) return Promise.reject(new TypeError(refuse(c.host)));
    if (!realFetch) return Promise.reject(new TypeError('fetch is not available'));
    return realFetch(input, init);
  };
  fetch[MARK] = true;
  scope.fetch = fetch;

  const X = scope.XMLHttpRequest;
  if (typeof X === 'function' && X.prototype && typeof X.prototype.open === 'function') {
    const open = X.prototype.open;
    X.prototype.open = function guardedOpen(method, url, ...rest) {
      const c = check(url);
      if (!c.ok) throw new TypeError(refuse(c.host));
      return open.call(this, method, url, ...rest);
    };
  }

  const nav = scope.navigator;
  if (nav && typeof nav.sendBeacon === 'function') {
    const beacon = nav.sendBeacon.bind(nav);
    const guarded = (url, data) => {
      const c = check(url);
      if (!c.ok) {
        refuse(c.host);
        return false;
      }
      return beacon(url, data);
    };
    try {
      Object.defineProperty(nav, 'sendBeacon', { value: guarded, configurable: true, writable: true });
    } catch {
      // Not replaceable: fall back to no beacons at all.
      try { Object.defineProperty(nav, 'sendBeacon', { value: () => false, configurable: true }); } catch { /* checked below */ }
    }
  }
}

// Side-effect module: import it first, before anything that loads MediaPipe,
// so the guard is in place before the library runs (src/tracking/net-guard.js).
import { sameOriginOnly } from './net-guard.js';

sameOriginOnly(globalThis);

// Dev server for the core test tools: no hot reload and no file watching, so
// edits elsewhere in the repo never reload a page in the middle of a run.
// Usage: npx vite --config tools/core-vite.config.mjs --port 5191 --strictPort

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export default {
  root,
  server: { hmr: false, watch: { ignored: ['**/*'] } },
  logLevel: 'warn',
};

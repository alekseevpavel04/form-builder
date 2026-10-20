import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { seedDemoForm } from '../src/demo.js';
import { openStore } from '../src/store.js';

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function makeTempDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'form-builder-test-'));
}

// Starts the app on a free port with data in a temporary folder.
export async function startApp({ seed = true } = {}) {
  const dataDir = await makeTempDir();
  const store = await openStore(dataDir);
  if (seed) await seedDemoForm(store);
  const server = createApp({ store, publicDir: path.join(rootDir, 'public') });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  return {
    baseUrl,
    store,
    dataDir,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await fsp.rm(dataDir, { recursive: true, force: true });
    },
  };
}

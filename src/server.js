import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { seedDemoForm } from './demo.js';
import { CorruptDataError, openStore } from './store.js';

// Paths are resolved from this file, so `node src/server.js` works from any directory.
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(rootDir, 'public');
// DATA_DIR exists for tests, which must not touch the real data/ folder.
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(rootDir, 'data');

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`PORT должен быть числом от 0 до 65535, получено: ${process.env.PORT}`);
  process.exit(1);
}

let store;
try {
  store = await openStore(dataDir);
} catch (err) {
  if (!(err instanceof CorruptDataError)) throw err;
  console.error(err.message);
  process.exit(1);
}
if (await seedDemoForm(store)) {
  console.log('Данных не было, создана демо-форма');
}

const server = createApp({ store, publicDir });
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Порт ${port} занят. Освободите его или запустите на другом порту: PORT=4000 npm start`);
    process.exit(1);
  }
  throw err;
});
server.listen(port, () => {
  const actualPort = server.address().port;
  console.log(`Сервис запущен: http://localhost:${actualPort}`);
  console.log(`Админка: http://localhost:${actualPort}/admin`);
});

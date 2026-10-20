import fsp from 'node:fs/promises';
import path from 'node:path';

const COLLECTIONS = ['forms', 'responses', 'events'];

// On Windows an antivirus or the search indexer can briefly hold the target
// file, and rename over it fails with EPERM or EBUSY. A short retry is enough.
const RENAME_RETRIES = 10;
const RENAME_RETRY_DELAY_MS = 50;
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

// Each collection lives in its own JSON file and is kept in memory.
// A change is made in memory first, then save() writes the whole file.
export class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.forms = [];
    this.responses = [];
    this.events = [];
    this.writeQueues = {};
  }

  async open() {
    await fsp.mkdir(this.dataDir, { recursive: true });
    for (const name of COLLECTIONS) {
      this[name] = await readJsonArray(this.filePath(name));
    }
    return this;
  }

  filePath(name) {
    return path.join(this.dataDir, `${name}.json`);
  }

  // Writes to one file go one at a time. Each write serialises the collection
  // at the moment it runs, so the last write always carries the latest state.
  save(name) {
    const write = () => writeAtomic(this.filePath(name), JSON.stringify(this[name], null, 2));
    const previous = this.writeQueues[name] || Promise.resolve();
    const next = previous.then(write, write);
    this.writeQueues[name] = next;
    return next;
  }
}

export async function openStore(dataDir) {
  return new Store(dataDir).open();
}

async function readJsonArray(filePath) {
  let text;
  try {
    text = await fsp.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw new CorruptDataError(filePath, err.message);
  }
  if (!Array.isArray(value)) throw new CorruptDataError(filePath, 'ожидался массив');
  return value;
}

export class CorruptDataError extends Error {
  constructor(filePath, reason) {
    super(`Файл данных повреждён: ${filePath} (${reason}). Исправьте его или перенесите в другую папку и запустите сервис снова.`);
  }
}

// Temporary file plus rename: if the process dies mid-write, the old file stays intact.
async function writeAtomic(filePath, text) {
  const tmpPath = `${filePath}.tmp`;
  const handle = await fsp.open(tmpPath, 'w');
  try {
    await handle.writeFile(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await renameWithRetry(tmpPath, filePath);
}

async function renameWithRetry(from, to) {
  for (let attempt = 1; ; attempt++) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (err) {
      if (!RETRYABLE_RENAME_CODES.has(err.code) || attempt >= RENAME_RETRIES) throw err;
      await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_DELAY_MS));
    }
  }
}

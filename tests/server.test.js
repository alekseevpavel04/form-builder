import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { makeTempDir, rootDir, startApp } from './helpers.js';

describe('routing and static files', () => {
  let app;
  before(async () => {
    app = await startApp();
  });
  after(() => app.close());

  test('root redirects to the admin page', async () => {
    const res = await fetch(app.baseUrl + '/', { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/admin');
  });

  test('/admin serves html', async () => {
    const res = await fetch(app.baseUrl + '/admin');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
  });

  test('static paths cannot leave the public folder', async () => {
    for (const p of ['/static/..%2f..%2fpackage.json', '/static/%2e%2e/%2e%2e/package.json', '/static/..%5c..%5cpackage.json']) {
      const res = await fetch(app.baseUrl + p);
      assert.equal(res.status, 404, p);
      assert.doesNotMatch(await res.text(), /"name": "form-builder"/, p);
    }
  });

  test('unknown path gives 404', async () => {
    const res = await fetch(app.baseUrl + '/nope');
    assert.equal(res.status, 404);
  });
});

describe('npm start entry point', () => {
  let dataDir;
  before(async () => {
    dataDir = await makeTempDir();
  });
  after(() => fsp.rm(dataDir, { recursive: true, force: true }));

  test('listens on PORT, creates the data folder and seeds the demo form once', async () => {
    const port = await freePort();
    const nested = path.join(dataDir, 'nested');

    const first = startServer({ PORT: String(port), DATA_DIR: nested });
    const output = await first.waitFor(/Админка: http:\/\/localhost:(\d+)\/admin/);
    assert.equal(Number(output.match[1]), port);
    assert.match(output.text, /создана демо-форма/);
    const res = await fetch(`http://127.0.0.1:${port}/admin`);
    assert.equal(res.status, 200);
    await first.stop();

    const second = startServer({ PORT: String(port), DATA_DIR: nested });
    const secondOutput = await second.waitFor(/Админка:/);
    assert.doesNotMatch(secondOutput.text, /демо-форма/);
    await second.stop();

    const forms = JSON.parse(await fsp.readFile(path.join(nested, 'forms.json'), 'utf8'));
    assert.equal(forms.length, 1);
    assert.equal(forms[0].id, 'demo');
  });

  test('busy port gives a readable message and exit code 1', async () => {
    const blocker = net.createServer();
    await new Promise((resolve) => blocker.listen(0, resolve));
    const port = blocker.address().port;
    try {
      const result = await startServer({ PORT: String(port), DATA_DIR: dataDir }).exited;
      assert.equal(result.code, 1);
      assert.match(result.stderr, new RegExp(`Порт ${port} занят`));
    } finally {
      blocker.close();
    }
  });

  test('corrupt data file stops the start instead of being overwritten', async () => {
    const dir = path.join(dataDir, 'corrupt');
    await fsp.mkdir(dir);
    await fsp.writeFile(path.join(dir, 'forms.json'), '{"broken');
    const result = await startServer({ PORT: '0', DATA_DIR: dir }).exited;
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Файл данных повреждён/);
    assert.equal(await fsp.readFile(path.join(dir, 'forms.json'), 'utf8'), '{"broken');
  });

  test('invalid PORT is rejected', async () => {
    const result = await startServer({ PORT: 'abc', DATA_DIR: dataDir }).exited;
    assert.equal(result.code, 1);
    assert.match(result.stderr, /PORT должен быть числом/);
  });
});

function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function startServer(env) {
  const child = spawn(process.execPath, [path.join(rootDir, 'src', 'server.js')], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve({ code, stdout, stderr })));

  return {
    exited,
    waitFor(pattern) {
      return new Promise((resolve, reject) => {
        const check = () => {
          const match = stdout.match(pattern);
          if (match) {
            child.stdout.off('data', check);
            resolve({ match, text: stdout });
          }
        };
        child.stdout.on('data', check);
        exited.then((r) => reject(new Error(`server exited with ${r.code}: ${r.stderr}`)));
        check();
      });
    },
    async stop() {
      child.kill();
      await exited;
    },
  };
}

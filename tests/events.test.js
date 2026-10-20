import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { startApp } from './helpers.js';

let app;
before(async () => {
  app = await startApp();
});
after(() => app.close());

async function call(method, urlPath, body) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch(app.baseUrl + urlPath, init);
  return { status: res.status, data: await res.json() };
}

const fields = [
  { id: 'name', type: 'text', label: 'Имя', required: true, hint: '' },
  { id: 'email', type: 'email', label: 'Email', required: true, hint: '' },
];

async function publishedForm() {
  const created = await call('POST', '/api/forms', { title: 'Стажировка', fields });
  await call('POST', `/api/forms/${created.data.form.id}/publish`);
  return created.data.form.id;
}

const eventsOf = (formId) => app.store.events.filter((e) => e.formId === formId);
const send = (formId, event) => call('POST', `/api/public/forms/${formId}/events`, event);

describe('events', () => {
  test('only session, type, field and time are stored, whatever else is sent', async () => {
    const id = await publishedForm();
    const sessionId = 'session-only-keys';
    assert.equal((await send(id, { sessionId, type: 'view', fieldId: 'name', userAgent: 'Mozilla' })).status, 201);
    assert.equal((await send(id, { sessionId, type: 'start' })).status, 201);
    const completed = await send(id, { sessionId, type: 'field_completed', fieldId: 'name', value: 'секретное-имя', answers: { name: 'секретное-имя' } });
    assert.equal(completed.status, 201);

    const stored = eventsOf(id);
    assert.deepEqual(stored.map((e) => [e.type, e.fieldId]), [['view', null], ['start', null], ['field_completed', 'name']]);
    for (const e of stored) {
      assert.deepEqual(Object.keys(e).sort(), ['at', 'fieldId', 'formId', 'sessionId', 'type']);
      assert.ok(!Number.isNaN(Date.parse(e.at)));
    }
    const onDisk = await fsp.readFile(path.join(app.dataDir, 'events.json'), 'utf8');
    assert.ok(onDisk.includes(sessionId));
    assert.ok(!onDisk.includes('секретное-имя'));
    assert.ok(!onDisk.includes('Mozilla'));
  });

  test('a repeated event from the same session is stored once', async () => {
    const id = await publishedForm();
    const event = { sessionId: 'session-reload', type: 'view' };
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await send(id, event)).status);
    assert.deepEqual(statuses, [201, 200, 200]);
    await send(id, { sessionId: 'session-reload', type: 'field_completed', fieldId: 'email' });
    await send(id, { sessionId: 'session-reload', type: 'field_completed', fieldId: 'email' });
    await send(id, { sessionId: 'session-other', type: 'view' });
    assert.deepEqual(eventsOf(id).map((e) => [e.sessionId, e.type]), [
      ['session-reload', 'view'],
      ['session-reload', 'field_completed'],
      ['session-other', 'view'],
    ]);
  });

  test('unknown types, a client submit, bad session ids and unknown fields are rejected', async () => {
    const id = await publishedForm();
    const bad = [
      { sessionId: 'session-bad-1', type: 'keypress' },
      { sessionId: 'session-bad-1', type: 'submit' },
      { sessionId: 'session-bad-1', type: 'field_completed' },
      { sessionId: 'session-bad-1', type: 'field_completed', fieldId: 'salary' },
      { sessionId: 'short', type: 'view' },
      { sessionId: '<script>alert(1)</script>', type: 'view' },
      { type: 'view' },
      ['view'],
    ];
    for (const event of bad) assert.equal((await send(id, event)).status, 400, JSON.stringify(event));
    assert.equal((await call('POST', `/api/public/forms/${id}/events`, 'null')).status, 400);
    assert.equal(eventsOf(id).length, 0);
  });

  test('an oversized event is refused', async () => {
    const id = await publishedForm();
    const res = await send(id, { sessionId: 'session-big', type: 'view', padding: 'x'.repeat(4096) });
    assert.equal(res.status, 413);
    assert.equal(eventsOf(id).length, 0);
  });

  test('events go only to published forms', async () => {
    const closedId = await publishedForm();
    await call('POST', `/api/forms/${closedId}/close`);
    assert.equal((await send(closedId, { sessionId: 'session-closed', type: 'view' })).status, 410);

    const draft = await call('POST', '/api/forms', { title: 'Черновик', fields });
    assert.equal((await send(draft.data.form.id, { sessionId: 'session-draft', type: 'view' })).status, 404);
    assert.equal((await send('nosuchform', { sessionId: 'session-none', type: 'view' })).status, 404);
    assert.equal(eventsOf(closedId).length + eventsOf(draft.data.form.id).length, 0);
  });

  test('the server records submit when it accepts the answers, once per session', async () => {
    const id = await publishedForm();
    const url = `/api/public/forms/${id}/responses`;
    const sessionId = 'session-submits';
    assert.equal((await call('POST', url, { sessionId, answers: { name: '' } })).status, 400);
    assert.equal(eventsOf(id).length, 0);

    assert.equal((await call('POST', url, { sessionId, answers: { name: 'Анна', email: 'a@b.ru' } })).status, 201);
    assert.equal((await call('POST', url, { sessionId, answers: { name: 'Анна', email: 'a@b.ru' } })).status, 200);
    assert.deepEqual(eventsOf(id).map((e) => [e.sessionId, e.type, e.fieldId]), [[sessionId, 'submit', null]]);
  });
});

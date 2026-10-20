import assert from 'node:assert/strict';
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
    init.body = JSON.stringify(body);
  }
  const res = await fetch(app.baseUrl + urlPath, init);
  return { status: res.status, data: await res.json() };
}

const fields = [
  { id: 'a', type: 'text', label: 'Имя', required: true, hint: '' },
  { id: 'b', type: 'email', label: 'Email', required: true, hint: '' },
  { id: 'c', type: 'text', label: 'Город', required: false, hint: '' },
  { id: 'd', type: 'textarea', label: 'О себе', required: false, hint: '' },
];

async function publishedForm() {
  const created = await call('POST', '/api/forms', { title: 'Воронка', fields });
  await call('POST', `/api/forms/${created.data.form.id}/publish`);
  return created.data.form.id;
}

describe('analytics', () => {
  test('numbers match a hand count over prepared events', async () => {
    const formId = await publishedForm();
    const now = Date.now();
    const old = now - 2 * 60 * 60 * 1000;
    const at = (base, seconds = 0) => new Date(base + seconds * 1000).toISOString();
    const events = [];
    const add = (sessionId, type, fieldId, time) => events.push({ formId, sessionId, type, fieldId: fieldId ?? null, at: time });
    const session = (id, steps, base = old) => {
      add(id, 'view', null, at(base));
      for (const [type, fieldId, seconds] of steps) add(id, type, fieldId, at(base, seconds));
    };

    // Submitted, with start: 60, 120, 300 and 600 seconds, so the median is 210.
    session('s1', [['start', null, 1], ['field_completed', 'a', 10], ['field_completed', 'b', 20], ['submit', null, 61]]);
    session('s2', [['start', null, 0], ['submit', null, 120]]);
    session('s3', [['start', null, 0], ['field_completed', 'a', 5], ['submit', null, 300]]);
    session('s4', [['start', null, 10], ['submit', null, 610]]);
    // Submitted without a start event (beacon lost): counts as started, not timed.
    session('s5', [['submit', null, 30]]);
    // Opened and left without typing.
    session('s6', []);
    session('s7', []);
    // Unfinished, long inactive.
    session('s8', [['start', null, 1]]);
    session('s9', [['start', null, 1], ['field_completed', 'a', 5], ['field_completed', 'b', 9]]);
    session('s10', [['start', null, 1], ['field_completed', 'b', 5]]);
    session('s11', [['start', null, 1], ...fields.map((f, i) => ['field_completed', f.id, i + 2])]);
    session('s13', [['start', null, 1], ['field_completed', 'removed-field', 3]]);
    // Unfinished, active five minutes ago, its view never arrived.
    add('s12', 'start', null, at(now, -300));
    add('s12', 'field_completed', 'a', at(now, -290));
    // Another form's events are not counted.
    add('s1', 'view', null, at(old));
    events[events.length - 1].formId = 'demo';
    app.store.events.push(...events);

    const { status, data } = await call('GET', `/api/forms/${formId}/analytics`);
    assert.equal(status, 200);
    assert.equal(data.views, 13);
    assert.equal(data.started, 11);
    assert.equal(data.submitted, 5);
    assert.equal(data.notStarted, 2);
    assert.equal(data.unfinished, 6);
    assert.equal(data.unfinishedRecent, 1);
    assert.equal(data.medianSeconds, 210);
    assert.equal(data.timedSessions, 4);
    assert.deepEqual(data.dropOff.fields.map((f) => [f.fieldId, f.sessions]), [['a', 2], ['b', 1], ['c', 2], ['d', 0]]);
    assert.equal(data.dropOff.atSubmit, 1);
    assert.equal(data.dropOff.fields[0].label, 'Имя');
  });

  test('a form without events gives zeros and no median, not NaN', async () => {
    const formId = await publishedForm();
    const { status, data } = await call('GET', `/api/forms/${formId}/analytics`);
    assert.equal(status, 200);
    assert.deepEqual(
      { ...data, form: undefined },
      {
        form: undefined,
        views: 0,
        started: 0,
        submitted: 0,
        notStarted: 0,
        unfinished: 0,
        unfinishedRecent: 0,
        medianSeconds: null,
        timedSessions: 0,
        dropOff: { fields: fields.map((f) => ({ fieldId: f.id, label: f.label, required: f.required, sessions: 0 })), atSubmit: 0 },
      },
    );
  });

  test('events sent over HTTP and an accepted submit show up in the funnel', async () => {
    const formId = await publishedForm();
    const send = (sessionId, type, fieldId) => call('POST', `/api/public/forms/${formId}/events`, { sessionId, type, fieldId });
    await send('session-done', 'view');
    await send('session-done', 'start');
    await call('POST', `/api/public/forms/${formId}/responses`, { sessionId: 'session-done', answers: { a: 'Анна', b: 'a@b.ru' } });
    await send('session-left', 'view');
    await send('session-left', 'start');
    await send('session-left', 'field_completed', 'a');

    const { data } = await call('GET', `/api/forms/${formId}/analytics`);
    assert.deepEqual([data.views, data.started, data.submitted, data.unfinished, data.unfinishedRecent], [2, 2, 1, 1, 1]);
    assert.equal(data.timedSessions, 1);
    assert.equal(data.dropOff.fields.find((f) => f.fieldId === 'b').sessions, 1);
  });

  test('unknown form gives 404', async () => {
    assert.equal((await call('GET', '/api/forms/nosuchform/analytics')).status, 404);
  });
});

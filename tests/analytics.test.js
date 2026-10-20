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

  test('errors and time on each field match a hand count', async () => {
    const formId = await publishedForm();
    const base = Date.now() - 60 * 60 * 1000;
    const events = [];
    const session = (sessionId, steps) => {
      events.push({ formId, sessionId, type: 'view', fieldId: null, at: new Date(base).toISOString() });
      steps.forEach(([type, fieldId, extra], i) => {
        events.push({ formId, sessionId, type, fieldId: fieldId ?? null, ...extra, at: new Date(base + (i + 1) * 1000).toISOString() });
      });
    };
    const error = (fieldId, kind) => ['field_error', fieldId, { error: kind }];
    const time = (fieldId, seconds) => ['field_time', fieldId, { ms: seconds * 1000 }];
    const done = (fieldId) => ['field_completed', fieldId];

    session('t1', [['start'], time('a', 4), done('a'), error('b', 'format'), time('b', 20), done('b'), ['submit']]);
    session('t2', [['start'], time('a', 6), done('a'), error('b', 'format'), error('b', 'empty'), time('b', 10)]);
    session('t3', [['start'], error('a', 'empty'), error('b', 'empty'), time('a', 1)]);
    session('t4', [['start'], done('a'), time('a', 2), done('b'), time('c', 30), error('removed-field', 'format')]);
    session('t5', []);
    app.store.events.push(...events);

    const { data } = await call('GET', `/api/forms/${formId}/analytics`);
    const byField = Object.fromEntries(data.dropOff.fields.map((f) => [f.fieldId, f]));
    // a: reached by t1-t4; error only in t3 (empty); times 4, 6, 1, 2 -> median 3.
    assert.deepEqual(
      [byField.a.reached, byField.a.withErrors, byField.a.errorKinds, byField.a.medianSeconds, byField.a.timed],
      [4, 1, { empty: 1, format: 0, option: 0 }, 3, 4],
    );
    // b: reached by t1-t4; errors in t1 (format), t2 (format and empty), t3 (empty); times 20, 10 -> 15.
    assert.deepEqual(
      [byField.b.reached, byField.b.withErrors, byField.b.errorKinds, byField.b.medianSeconds, byField.b.timed],
      [4, 3, { empty: 2, format: 2, option: 0 }, 15, 2],
    );
    // c: only t4 entered it, for 30 s. d: nobody got there.
    assert.deepEqual([byField.c.reached, byField.c.withErrors, byField.c.medianSeconds, byField.c.timed], [1, 0, 30, 1]);
    assert.deepEqual([byField.d.reached, byField.d.withErrors, byField.d.medianSeconds, byField.d.timed], [0, 0, null, 0]);
    // Where they stopped is unchanged by the new events: t3 on a, t2 on b, t4 on c.
    assert.deepEqual(data.dropOff.fields.map((f) => f.sessions), [1, 1, 1, 0]);
    assert.equal(data.views, 5);
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
        dropOff: {
          fields: fields.map((f) => ({
            fieldId: f.id,
            label: f.label,
            required: f.required,
            sessions: 0,
            reached: 0,
            withErrors: 0,
            errorKinds: { empty: 0, format: 0, option: 0 },
            medianSeconds: null,
            timed: 0,
          })),
          atSubmit: 0,
        },
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

  test('errors and time sent over HTTP show up per field, a repeated error once', async () => {
    const formId = await publishedForm();
    const send = (event) => call('POST', `/api/public/forms/${formId}/events`, { sessionId: 'session-http-errors', ...event });
    await send({ type: 'view' });
    await send({ type: 'field_error', fieldId: 'b', error: 'format' });
    await send({ type: 'field_error', fieldId: 'b', error: 'format' });
    await send({ type: 'field_time', fieldId: 'b', ms: 7500 });

    const { data } = await call('GET', `/api/forms/${formId}/analytics`);
    const b = data.dropOff.fields.find((f) => f.fieldId === 'b');
    assert.deepEqual([b.reached, b.withErrors, b.errorKinds.format, b.medianSeconds, b.timed], [1, 1, 1, 7.5, 1]);
  });

  test('unknown form gives 404', async () => {
    assert.equal((await call('GET', '/api/forms/nosuchform/analytics')).status, 404);
  });
});

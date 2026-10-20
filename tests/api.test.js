import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { csvCell } from '../src/responses.js';
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
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data, headers: res.headers };
}

const fields = [
  { id: 'name', type: 'text', label: 'Имя', required: true, hint: '' },
  { id: 'email', type: 'email', label: 'Email', required: true, hint: '' },
  { id: 'format', type: 'radio', label: 'Формат', required: false, hint: '', options: ['Офис', 'Гибрид'] },
  { id: 'topics', type: 'checkbox', label: 'Темы', required: false, hint: '', options: ['Аналитика', 'Разработка'] },
];

async function publishedForm(extraFields = []) {
  const created = await call('POST', '/api/forms', { title: 'Стажировка', fields: [...fields, ...extraFields] });
  assert.equal(created.status, 201);
  const published = await call('POST', `/api/forms/${created.data.form.id}/publish`);
  assert.equal(published.status, 200);
  return created.data.form.id;
}

describe('forms', () => {
  test('a new form is a draft, appears in the list and is hidden from students', async () => {
    const created = await call('POST', '/api/forms', { title: '  Летняя школа ', fields });
    assert.equal(created.status, 201);
    const { form } = created.data;
    assert.match(form.id, /^[a-z2-9]{8}$/);
    assert.equal(form.title, 'Летняя школа');
    assert.equal(form.status, 'draft');

    const list = await call('GET', '/api/forms');
    const item = list.data.forms.find((f) => f.id === form.id);
    assert.deepEqual({ ...item, updatedAt: undefined }, {
      id: form.id, title: 'Летняя школа', status: 'draft', fieldCount: 4, responseCount: 0, updatedAt: undefined,
    });

    assert.equal((await call('GET', `/api/public/forms/${form.id}`)).status, 404);
    assert.equal((await call('GET', `/f/${form.id}`)).status, 404);
  });

  test('invalid definition gives 400 with errors by field id', async () => {
    const res = await call('POST', '/api/forms', {
      title: '',
      fields: [{ id: 'a', type: 'select', label: 'Курс', options: [] }],
    });
    assert.equal(res.status, 400);
    assert.equal(res.data.errors.title, 'Укажите название формы');
    assert.equal(res.data.errors.fields.a, 'Добавьте хотя бы один вариант ответа');
  });

  test('a form without fields cannot be published', async () => {
    const created = await call('POST', '/api/forms', { title: 'Пустая' });
    const res = await call('POST', `/api/forms/${created.data.form.id}/publish`);
    assert.equal(res.status, 400);
    assert.match(res.data.error, /хотя бы одно поле/);
  });

  test('publish opens the public link, close shuts it', async () => {
    const id = await publishedForm();
    const open = await call('GET', `/api/public/forms/${id}`);
    assert.equal(open.status, 200);
    assert.deepEqual(Object.keys(open.data.form).sort(), ['description', 'fields', 'id', 'title']);
    const page = await call('GET', `/f/${id}`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);

    assert.equal((await call('POST', `/api/forms/${id}/close`)).status, 200);
    const closed = await call('GET', `/api/public/forms/${id}`);
    assert.equal(closed.status, 410);
    assert.match(closed.data.error, /закрыта/);
    assert.equal((await call('GET', `/f/${id}`)).status, 410);
  });

  test('unknown form id gives 404 everywhere', async () => {
    for (const [method, p] of [
      ['GET', '/api/forms/nope'],
      ['PUT', '/api/forms/nope'],
      ['POST', '/api/forms/nope/publish'],
      ['GET', '/api/forms/nope/responses'],
      ['GET', '/api/public/forms/nope'],
      ['POST', '/api/public/forms/nope/responses'],
      ['GET', '/f/nope'],
    ]) {
      const res = await call(method, p, method === 'GET' ? undefined : { title: 'x', answers: {} });
      assert.equal(res.status, 404, `${method} ${p}`);
    }
  });

  test('editing keeps answers of renamed and deleted fields', async () => {
    const id = await publishedForm();
    await call('POST', `/api/public/forms/${id}/responses`, { answers: { name: 'Анна', email: 'a@b.ru', format: 'Офис' } });

    const renamed = fields.map((f) => (f.id === 'name' ? { ...f, label: 'Имя и фамилия' } : f)).filter((f) => f.id !== 'format');
    const res = await call('PUT', `/api/forms/${id}`, { title: 'Стажировка', fields: [renamed[1], renamed[0], renamed[2]] });
    assert.equal(res.status, 200);
    assert.deepEqual(res.data.form.removedFields, [{ id: 'format', type: 'radio', label: 'Формат' }]);

    const table = await call('GET', `/api/forms/${id}/responses`);
    assert.deepEqual(table.data.columns, [
      { id: 'email', label: 'Email', removed: false },
      { id: 'name', label: 'Имя и фамилия', removed: false },
      { id: 'topics', label: 'Темы', removed: false },
      { id: 'format', label: 'Формат', removed: true },
    ]);
    assert.equal(table.data.responses[0].answers.format, 'Офис');
  });

  test('field type cannot change once the field exists', async () => {
    const id = await publishedForm();
    const changed = fields.map((f) => (f.id === 'name' ? { ...f, type: 'textarea' } : f));
    const res = await call('PUT', `/api/forms/${id}`, { title: 'Стажировка', fields: changed });
    assert.equal(res.status, 400);
    assert.match(res.data.errors.fields.name, /Тип поля нельзя поменять/);
  });

  test('a published form cannot lose all its fields', async () => {
    const id = await publishedForm();
    const res = await call('PUT', `/api/forms/${id}`, { title: 'Стажировка', fields: [] });
    assert.equal(res.status, 400);
  });
});

describe('submissions', () => {
  test('valid answers are stored normalised, keys outside the schema are dropped', async () => {
    const id = await publishedForm([{ id: 'hours', type: 'number', label: 'Часы', required: false, hint: '' }]);
    const res = await call('POST', `/api/public/forms/${id}/responses`, {
      answers: { name: ' Анна ', email: 'anna@example.com', topics: ['Разработка'], hours: '12,5', isAdmin: true },
    });
    assert.equal(res.status, 201);

    const stored = app.store.responses.filter((r) => r.formId === id);
    assert.equal(stored.length, 1);
    assert.deepEqual(stored[0].answers, { name: 'Анна', email: 'anna@example.com', topics: ['Разработка'], hours: 12.5 });

    const onDisk = JSON.parse(await fsp.readFile(path.join(app.dataDir, 'responses.json'), 'utf8'));
    assert.ok(onDisk.some((r) => r.formId === id && r.answers.name === 'Анна'));
  });

  test('invalid answers give 400 with an error for each field and nothing is stored', async () => {
    const id = await publishedForm();
    const res = await call('POST', `/api/public/forms/${id}/responses`, {
      answers: { name: '', email: 'anna', format: 'Марс', topics: ['Аналитика', 'Космос'] },
    });
    assert.equal(res.status, 400);
    assert.deepEqual(Object.keys(res.data.errors).sort(), ['email', 'format', 'name', 'topics']);
    assert.equal(res.data.errors.email, 'Введите email в формате name@example.com');
    assert.equal(app.store.responses.filter((r) => r.formId === id).length, 0);
  });

  test('submitting to a closed form is rejected and not stored', async () => {
    const id = await publishedForm();
    await call('POST', `/api/forms/${id}/close`);
    const res = await call('POST', `/api/public/forms/${id}/responses`, { answers: { name: 'Анна', email: 'a@b.ru' } });
    assert.equal(res.status, 410);
    assert.match(res.data.error, /закрыта/);
    assert.equal(app.store.responses.filter((r) => r.formId === id).length, 0);
  });

  test('two submits from one session store one response', async () => {
    const id = await publishedForm();
    const body = { sessionId: 'session-1234-abcd', answers: { name: 'Анна', email: 'a@b.ru' } };
    const results = await Promise.all([1, 2, 3].map(() => call('POST', `/api/public/forms/${id}/responses`, body)));
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 200, 201]);
    assert.equal(app.store.responses.filter((r) => r.formId === id).length, 1);
  });

  test('malformed bodies give 4xx and the server keeps working', async () => {
    const id = await publishedForm();
    const url = `/api/public/forms/${id}/responses`;
    assert.equal((await call('POST', url, '{"answers":')).status, 400);
    assert.equal((await call('POST', url, '')).status, 400);
    assert.equal((await call('POST', url, { answers: 'Анна' })).status, 400);
    assert.equal((await call('POST', url, 'null')).status, 400);
    const big = await call('POST', url, { answers: { name: 'я'.repeat(1024 * 1024) } });
    assert.equal(big.status, 413);
    assert.equal((await call('GET', '/api/forms')).status, 200);
  });
});

describe('csv export', () => {
  test('cells are escaped and cannot start a formula', () => {
    assert.equal(csvCell('Анна'), 'Анна');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell('a;b'), '"a;b"');
    assert.equal(csvCell('line 1\nline 2'), '"line 1\nline 2"');
    for (const danger of ['=HYPERLINK("x")', '+7 999', '-5', '@SUM(A1)']) {
      assert.ok(csvCell(danger).replace(/^"/, '').startsWith("'"), danger);
    }
  });

  test('csv has BOM, semicolons, a column per field and multi-choice in one cell', async () => {
    const id = await publishedForm();
    await call('POST', `/api/public/forms/${id}/responses`, {
      answers: { name: '=cmd|"/c calc"', email: 'a@b.ru', topics: ['Аналитика', 'Разработка'] },
    });
    await call('POST', `/api/public/forms/${id}/responses`, { answers: { name: 'Борис\nПетров', email: 'b@c.ru' } });

    const res = await fetch(`${app.baseUrl}/api/forms/${id}/responses.csv`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv; charset=utf-8/);
    assert.match(res.headers.get('content-disposition'), new RegExp(`attachment; filename="${id}-\\d{4}-\\d{2}-\\d{2}\\.csv"`));
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);

    const lines = bytes.toString('utf8').slice(1).split('\r\n');
    assert.equal(lines[0], 'Время отправки;Имя;Email;Формат;Темы');
    assert.equal(lines.length, 4, 'header, two rows and the trailing newline');
    const rows = lines.slice(1, 3).join('\r\n');
    assert.match(rows, /;"Борис\nПетров";b@c\.ru;;$/m);
    assert.match(rows, /;"'=cmd\|""\/c calc""";a@b\.ru;;"Аналитика; Разработка"$/m);
  });
});

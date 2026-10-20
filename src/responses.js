import crypto from 'node:crypto';
import { validateAnswers } from '../public/shared/schema.js';
import { isSessionId, recordEvent } from './events.js';
import { BODY_LIMIT_BYTES, findForm, findPublishedForm } from './forms.js';
import { HttpError, readJson, sendJson, sendText } from './http.js';

// Russian Excel opens a semicolon-separated file with a BOM correctly on double
// click; with commas it puts the whole row into one column.
const CSV_SEPARATOR = ';';

export async function submitResponse({ store, req, res, params }) {
  const form = findPublishedForm(store, params.id);
  const body = await readJson(req, BODY_LIMIT_BYTES);
  if (typeof body !== 'object' || body === null || typeof body.answers !== 'object' || body.answers === null) {
    throw new HttpError(400, 'Ожидается объект answers с ответами по id полей');
  }
  const { values, errors } = validateAnswers(form.fields, body.answers);
  if (errors) throw new HttpError(400, 'Проверьте ответы в отмеченных полях', { errors });

  // The browser sends its session id with the answers. A second submit from the
  // same session (double click, retry after a lost response) is not stored twice.
  const sessionId = isSessionId(body.sessionId) ? body.sessionId : null;
  if (sessionId && store.responses.some((r) => r.formId === form.id && r.sessionId === sessionId)) {
    sendJson(res, 200, { ok: true, duplicate: true });
    return;
  }

  store.responses.push({
    id: crypto.randomUUID(),
    formId: form.id,
    sessionId,
    submittedAt: new Date().toISOString(),
    answers: values,
  });
  await store.save('responses');
  if (sessionId) await recordEvent(store, { formId: form.id, sessionId, type: 'submit' });
  sendJson(res, 201, { ok: true });
}

export function listResponses({ store, res, params }) {
  const form = findForm(store, params.id);
  const responses = responsesOf(store, form);
  sendJson(res, 200, {
    form: { id: form.id, title: form.title, status: form.status },
    columns: responseColumns(form, responses),
    responses: responses.map(({ id, submittedAt, answers }) => ({ id, submittedAt, answers })),
  });
}

export function downloadCsv({ store, res, params }) {
  const form = findForm(store, params.id);
  const responses = responsesOf(store, form);
  const columns = responseColumns(form, responses);
  const header = ['Время отправки', ...columns.map((c) => (c.removed ? `${c.label} (поле удалено)` : c.label))];
  const rows = responses.map((r) => [formatLocalTime(r.submittedAt), ...columns.map((c) => formatValue(r.answers[c.id]))]);
  const csv = '﻿' + [header, ...rows].map((row) => row.map(csvCell).join(CSV_SEPARATOR) + '\r\n').join('');
  const fileName = `${form.id}-${new Date().toISOString().slice(0, 10)}.csv`;
  sendText(res, 200, 'text/csv; charset=utf-8', csv, { 'Content-Disposition': `attachment; filename="${fileName}"` });
}

// Newest first, as the manager reads them.
function responsesOf(store, form) {
  return store.responses.filter((r) => r.formId === form.id).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

// Current fields in their order, then deleted fields that still have answers.
export function responseColumns(form, responses) {
  const columns = form.fields.map((f) => ({ id: f.id, label: f.label, removed: false }));
  for (const f of form.removedFields) {
    if (responses.some((r) => Object.hasOwn(r.answers, f.id))) columns.push({ id: f.id, label: f.label, removed: true });
  }
  return columns;
}

function formatValue(value) {
  if (value === undefined) return '';
  if (Array.isArray(value)) return value.join('; ');
  if (typeof value === 'number') return String(value).replace('.', ',');
  return value;
}

// Excel would run a cell starting with = + - @ as a formula, so such a cell gets
// a leading apostrophe. Quotes, separators and line breaks go inside quotes.
export function csvCell(value) {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[";\r\n]/.test(text)) text = `"${text.replaceAll('"', '""')}"`;
  return text;
}

function formatLocalTime(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

import { ERROR_KINDS } from '../public/shared/schema.js';
import { findPublishedForm } from './forms.js';
import { HttpError, readJson, sendJson } from './http.js';

// An event is a handful of short strings; anything bigger is not from our page.
const EVENT_BODY_LIMIT_BYTES = 2 * 1024;

const SESSION_ID = /^[A-Za-z0-9-]{8,64}$/;

// submit is not here: the server records it when it accepts the answers, because
// a beacon sent from the browser is lost if the tab closes right after sending.
const CLIENT_EVENT_TYPES = new Set(['view', 'start', 'field_completed', 'field_error', 'field_time']);
const FIELD_EVENT_TYPES = new Set(['field_completed', 'field_error', 'field_time']);

// Time on a field longer than a day is a tab left open, not filling in.
const MAX_FIELD_MS = 24 * 60 * 60 * 1000;

export function isSessionId(value) {
  return typeof value === 'string' && SESSION_ID.test(value);
}

// Accepts one event from the student page. Only the whitelisted keys are stored,
// whatever else the body carries, so field contents never reach events.json.
// field_error carries the kind of error, field_time the milliseconds from focus
// to leaving the field.
export async function receiveEvent({ store, req, res, params }) {
  const form = findPublishedForm(store, params.id);
  const body = await readJson(req, EVENT_BODY_LIMIT_BYTES);
  if (typeof body !== 'object' || body === null) throw new HttpError(400, 'Ожидается объект события');
  if (!isSessionId(body.sessionId)) throw new HttpError(400, 'Неверный id сессии');
  if (!CLIENT_EVENT_TYPES.has(body.type)) throw new HttpError(400, 'Неизвестный тип события');

  const event = { formId: form.id, sessionId: body.sessionId, type: body.type, fieldId: null };
  if (FIELD_EVENT_TYPES.has(body.type)) {
    if (!form.fields.some((f) => f.id === body.fieldId)) throw new HttpError(400, 'Поля с таким id нет в форме');
    event.fieldId = body.fieldId;
  }
  if (body.type === 'field_error') {
    if (!ERROR_KINDS.includes(body.error)) throw new HttpError(400, 'Неизвестный вид ошибки');
    event.error = body.error;
  }
  if (body.type === 'field_time') {
    if (!Number.isInteger(body.ms) || body.ms < 0 || body.ms > MAX_FIELD_MS) throw new HttpError(400, 'Неверное время на поле');
    event.ms = body.ms;
  }

  const added = await recordEvent(store, event);
  sendJson(res, added ? 201 : 200, { ok: true });
}

// One event of each kind per session and field (and per kind of error): a
// reload does not add a view, going back to a field does not count it twice,
// and only the first visit to a field is timed. This also caps how many events
// one session can write.
export async function recordEvent(store, { formId, sessionId, type, fieldId = null, ...extra }) {
  const exists = store.events.some(
    (e) => e.formId === formId && e.sessionId === sessionId && e.type === type && e.fieldId === fieldId && e.error === extra.error,
  );
  if (exists) return false;
  store.events.push({ formId, sessionId, type, fieldId, ...extra, at: new Date().toISOString() });
  await store.save('events');
  return true;
}

import { findPublishedForm } from './forms.js';
import { HttpError, readJson, sendJson } from './http.js';

// An event is a handful of short strings; anything bigger is not from our page.
const EVENT_BODY_LIMIT_BYTES = 2 * 1024;

const SESSION_ID = /^[A-Za-z0-9-]{8,64}$/;

// submit is not here: the server records it when it accepts the answers, because
// a beacon sent from the browser is lost if the tab closes right after sending.
const CLIENT_EVENT_TYPES = new Set(['view', 'start', 'field_completed']);

export function isSessionId(value) {
  return typeof value === 'string' && SESSION_ID.test(value);
}

// Accepts one event from the student page. Only the whitelisted keys are stored,
// whatever else the body carries, so field contents never reach events.json.
export async function receiveEvent({ store, req, res, params }) {
  const form = findPublishedForm(store, params.id);
  const body = await readJson(req, EVENT_BODY_LIMIT_BYTES);
  if (typeof body !== 'object' || body === null) throw new HttpError(400, 'Ожидается объект события');
  if (!isSessionId(body.sessionId)) throw new HttpError(400, 'Неверный id сессии');
  if (!CLIENT_EVENT_TYPES.has(body.type)) throw new HttpError(400, 'Неизвестный тип события');

  let fieldId = null;
  if (body.type === 'field_completed') {
    if (!form.fields.some((f) => f.id === body.fieldId)) throw new HttpError(400, 'Поля с таким id нет в форме');
    fieldId = body.fieldId;
  }

  const added = await recordEvent(store, { formId: form.id, sessionId: body.sessionId, type: body.type, fieldId });
  sendJson(res, added ? 201 : 200, { ok: true });
}

// One event of each kind per session and field: a reload does not add a view,
// and going back to a field does not count it twice. This also caps how many
// events one session can write.
export async function recordEvent(store, { formId, sessionId, type, fieldId = null }) {
  const exists = store.events.some(
    (e) => e.formId === formId && e.sessionId === sessionId && e.type === type && e.fieldId === fieldId,
  );
  if (exists) return false;
  store.events.push({ formId, sessionId, type, fieldId, at: new Date().toISOString() });
  await store.save('events');
  return true;
}

import { randomId } from '/static/lib/dom.js';

// The session id and the draft are kept in localStorage per form, so a reload
// or coming back to the link continues the same session: the answers are back
// and no second view is counted. Both are dropped after a successful submit,
// so the next visit is a new session with an empty form.
// localStorage can be off or throw (private mode, blocked storage); then the
// form still works and the session lasts as long as the page.

const keyOf = (formId) => `form-builder:${formId}`;

export function loadSession(formId) {
  const saved = read(keyOf(formId));
  if (saved && typeof saved.sessionId === 'string') {
    return { sessionId: saved.sessionId, values: isPlainObject(saved.values) ? saved.values : {} };
  }
  const session = { sessionId: randomId('s'), values: {} };
  write(keyOf(formId), session);
  return session;
}

export function saveDraft(formId, session, values) {
  session.values = values;
  write(keyOf(formId), session);
}

export function clearSession(formId) {
  try {
    localStorage.removeItem(keyOf(formId));
  } catch {
    // Nothing was stored, nothing to clear.
  }
}

// The form may have changed since the draft was saved: fields deleted, options
// renamed. Only values that still fit a current field are restored, the rest is
// dropped, so an old draft cannot break the page.
export function draftValues(fields, values) {
  const restored = {};
  for (const field of fields) {
    const value = values[field.id];
    if (field.type === 'checkbox') {
      if (Array.isArray(value)) restored[field.id] = value.filter((v) => field.options.includes(v));
    } else if (field.type === 'radio' || field.type === 'select') {
      if (field.options.includes(value)) restored[field.id] = value;
    } else if (typeof value === 'string') {
      restored[field.id] = value;
    }
  }
  return restored;
}

function read(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage is full or disabled: the form still works, only without memory.
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

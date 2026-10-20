import { randomId } from '/static/lib/dom.js';

// The session id is kept in localStorage per form, so a reload or coming back
// to the link continues the same session and does not count a second view.
// It is dropped after a successful submit: the next visit is a new session.
// localStorage can be off or throw (private mode, blocked storage); then the
// session simply lasts as long as the page.

const keyOf = (formId) => `form-builder:${formId}`;

export function loadSession(formId) {
  const saved = read(keyOf(formId));
  if (saved && typeof saved.sessionId === 'string') return saved;
  const session = { sessionId: randomId('s') };
  write(keyOf(formId), session);
  return session;
}

export function clearSession(formId) {
  try {
    localStorage.removeItem(keyOf(formId));
  } catch {
    // Nothing was stored, nothing to clear.
  }
}

function read(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return typeof value === 'object' && value !== null ? value : null;
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

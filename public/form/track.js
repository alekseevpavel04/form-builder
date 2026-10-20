// Sends drop-off analytics: the session id, the event type and, for field
// events, the field id, the kind of error or the time spent. Never the values.
// submit is recorded by the server itself.
export function createTracker(formId, sessionId) {
  const url = `/api/public/forms/${encodeURIComponent(formId)}/events`;
  const sent = new Set();

  function send(type, fieldId, extra = {}) {
    const key = `${type}:${fieldId ?? ''}:${extra.error ?? ''}`;
    if (sent.has(key)) return;
    sent.add(key);
    const body = JSON.stringify({ sessionId, type, fieldId, ...extra });
    // A beacon does not hold up typing and is still delivered when the tab is
    // closed, which is exactly when the last field matters. A string body goes
    // as text/plain, which every browser allows in a beacon.
    if (navigator.sendBeacon?.(url, body)) return;
    // A lost analytics event must not bother the student, so errors are dropped.
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  }

  return {
    view: () => send('view'),
    start: () => send('start'),
    fieldCompleted: (fieldId) => send('field_completed', fieldId),
    fieldError: (fieldId, error) => send('field_error', fieldId, { error }),
    fieldTime: (fieldId, ms) => send('field_time', fieldId, { ms }),
  };
}

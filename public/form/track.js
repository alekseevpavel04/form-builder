// Sends drop-off analytics: the session id, the event type and, for a filled
// field, its id. Never the values. submit is recorded by the server itself.
export function createTracker(formId, sessionId) {
  const url = `/api/public/forms/${encodeURIComponent(formId)}/events`;
  const sent = new Set();

  function send(type, fieldId) {
    const key = `${type}:${fieldId ?? ''}`;
    if (sent.has(key)) return;
    sent.add(key);
    const body = JSON.stringify({ sessionId, type, fieldId });
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
  };
}

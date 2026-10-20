import { ERROR_KINDS } from '../public/shared/schema.js';
import { findForm } from './forms.js';
import { sendJson } from './http.js';

// A session without a submit is "unfinished", but one that was active a moment
// ago may still be filling in. It is counted, and the screen says how many of
// the unfinished sessions were active within this window.
export const ACTIVE_WINDOW_MS = 30 * 60 * 1000;

export function getAnalytics({ store, res, params }) {
  const form = findForm(store, params.id);
  const events = store.events.filter((e) => e.formId === form.id);
  sendJson(res, 200, {
    form: { id: form.id, title: form.title, status: form.status },
    ...computeAnalytics(form, events, Date.now()),
  });
}

// Everything is counted by session. A beacon can be lost, so a later event
// implies the earlier steps: a session with a completed field has started, any
// event means the form was viewed. This keeps the funnel from growing downwards.
export function computeAnalytics(form, events, now) {
  const sessions = new Map();
  for (const e of events) {
    let s = sessions.get(e.sessionId);
    if (!s) {
      s = { startAt: null, submitAt: null, lastAt: 0, completed: new Set(), reached: new Set(), errors: new Map(), fieldMs: new Map() };
      sessions.set(e.sessionId, s);
    }
    const at = Date.parse(e.at);
    s.lastAt = Math.max(s.lastAt, at);
    if (e.type === 'start') s.startAt = at;
    else if (e.type === 'submit') s.submitAt = at;
    else if (e.type === 'field_completed') s.completed.add(e.fieldId);
    else if (e.type === 'field_error') {
      if (!s.errors.has(e.fieldId)) s.errors.set(e.fieldId, new Set());
      s.errors.get(e.fieldId).add(e.error);
    } else if (e.type === 'field_time') s.fieldMs.set(e.fieldId, e.ms);
    if (e.fieldId) s.reached.add(e.fieldId);
  }

  const all = [...sessions.values()];
  const started = all.filter((s) => s.startAt !== null || s.completed.size > 0 || s.submitAt !== null);
  const submitted = all.filter((s) => s.submitAt !== null);
  const unfinished = started.filter((s) => s.submitAt === null);

  // Median, not mean: one tab left open overnight would swamp the mean.
  const durations = submitted.filter((s) => s.startAt !== null && s.startAt <= s.submitAt).map((s) => (s.submitAt - s.startAt) / 1000);

  return {
    views: all.length,
    started: started.length,
    submitted: submitted.length,
    notStarted: all.length - started.length,
    unfinished: unfinished.length,
    unfinishedRecent: unfinished.filter((s) => now - s.lastAt < ACTIVE_WINDOW_MS).length,
    medianSeconds: median(durations),
    timedSessions: durations.length,
    dropOff: dropOff(form, unfinished, all),
  };
}

// Where unfinished sessions stopped. Only completed fields are known, so the
// session is put on the field after the furthest completed one in the current
// form order. A session with every field done stopped at the submit button.
// Errors and time on a field are counted over all sessions, finished or not:
// a field that trips up those who got through also explains those who left.
function dropOff(form, unfinished, all) {
  const counts = new Array(form.fields.length + 1).fill(0);
  const position = new Map(form.fields.map((f, i) => [f.id, i]));
  for (const s of unfinished) {
    let furthest = -1;
    for (const id of s.completed) {
      if (position.has(id)) furthest = Math.max(furthest, position.get(id));
    }
    counts[furthest + 1]++;
  }
  return {
    fields: form.fields.map((f, i) => ({ fieldId: f.id, label: f.label, required: f.required, sessions: counts[i], ...fieldStats(f.id, all) })),
    atSubmit: counts[form.fields.length],
  };
}

// reached: sessions that got to the field (entered it, filled it or saw an
// error at it), the denominator for errors. Time is the first visit only.
function fieldStats(fieldId, all) {
  const reached = all.filter((s) => s.reached.has(fieldId));
  const withErrors = reached.filter((s) => s.errors.has(fieldId));
  const times = reached.filter((s) => s.fieldMs.has(fieldId)).map((s) => s.fieldMs.get(fieldId) / 1000);
  return {
    reached: reached.length,
    withErrors: withErrors.length,
    errorKinds: Object.fromEntries(ERROR_KINDS.map((kind) => [kind, withErrors.filter((s) => s.errors.get(fieldId).has(kind)).length])),
    medianSeconds: median(times),
    timed: times.length,
  };
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

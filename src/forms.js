import crypto from 'node:crypto';
import { validateFormDefinition } from '../public/shared/schema.js';
import { HttpError, readJson, sendJson } from './http.js';

export const BODY_LIMIT_BYTES = 1024 * 1024;

// Form ids double as the public link /f/<id>. Random rather than made from the
// title: titles are Cyrillic, change after publishing, and a draft link should
// not be guessable. The alphabet skips look-alikes (0/o, 1/l/i).
const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const ID_LENGTH = 8;

export function findForm(store, id) {
  const form = store.forms.find((f) => f.id === id);
  if (!form) throw new HttpError(404, 'Форма не найдена');
  return form;
}

// What a student may see and submit to. Drafts look the same as missing forms.
export function findPublishedForm(store, id) {
  const form = store.forms.find((f) => f.id === id);
  if (!form || form.status === 'draft') throw new HttpError(404, 'Форма не найдена. Проверьте ссылку.');
  if (form.status === 'closed') throw new HttpError(410, 'Форма закрыта, ответы больше не принимаются.');
  return form;
}

export function publicView(form) {
  return { id: form.id, title: form.title, description: form.description, fields: form.fields };
}

export function listForms({ store, res }) {
  const counts = {};
  for (const r of store.responses) counts[r.formId] = (counts[r.formId] || 0) + 1;
  const forms = store.forms
    .map((f) => ({
      id: f.id,
      title: f.title,
      status: f.status,
      fieldCount: f.fields.length,
      responseCount: counts[f.id] || 0,
      updatedAt: f.updatedAt,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  sendJson(res, 200, { forms });
}

export function getForm({ store, res, params }) {
  const form = findForm(store, params.id);
  const responseCount = store.responses.filter((r) => r.formId === form.id).length;
  sendJson(res, 200, { form, responseCount });
}

export async function createForm({ store, req, res }) {
  const definition = checkDefinition(await readJson(req, BODY_LIMIT_BYTES));
  const now = new Date().toISOString();
  const form = {
    id: newFormId(store),
    ...definition,
    status: 'draft',
    removedFields: [],
    createdAt: now,
    updatedAt: now,
  };
  store.forms.push(form);
  await store.save('forms');
  sendJson(res, 201, { form });
}

// Editing is allowed after answers arrive. Answers are stored by field id, so a
// renamed or moved field keeps its answers, and a deleted field is remembered in
// removedFields to keep its column in the table and CSV.
export async function updateForm({ store, req, res, params }) {
  const form = findForm(store, params.id);
  const definition = checkDefinition(await readJson(req, BODY_LIMIT_BYTES), form);
  if (form.status === 'published' && definition.fields.length === 0) {
    throw new HttpError(400, 'В опубликованной форме должно остаться хотя бы одно поле', {
      errors: { form: 'Снимите форму с публикации или оставьте хотя бы одно поле' },
    });
  }

  const newIds = new Set(definition.fields.map((f) => f.id));
  const removed = form.fields.filter((f) => !newIds.has(f.id)).map(({ id, type, label }) => ({ id, type, label }));
  form.removedFields = [...form.removedFields.filter((f) => !newIds.has(f.id)), ...removed];
  form.title = definition.title;
  form.description = definition.description;
  form.fields = definition.fields;
  form.updatedAt = new Date().toISOString();
  await store.save('forms');
  sendJson(res, 200, { form });
}

export async function publishForm({ store, res, params }) {
  const form = findForm(store, params.id);
  if (form.fields.length === 0) {
    throw new HttpError(400, 'Добавьте хотя бы одно поле, чтобы опубликовать форму');
  }
  await setStatus(store, form, 'published');
  sendJson(res, 200, { form });
}

export async function closeForm({ store, res, params }) {
  const form = findForm(store, params.id);
  await setStatus(store, form, 'closed');
  sendJson(res, 200, { form });
}

export function getPublicForm({ store, res, params }) {
  sendJson(res, 200, { form: publicView(findPublishedForm(store, params.id)) });
}

async function setStatus(store, form, status) {
  form.status = status;
  form.updatedAt = new Date().toISOString();
  await store.save('forms');
}

function checkDefinition(body, existing) {
  const { form, errors } = validateFormDefinition(body);
  const fieldErrors = errors?.fields || {};
  if (existing) {
    // A changed type would leave old answers that no longer fit the field.
    const knownTypes = new Map([...existing.removedFields, ...existing.fields].map((f) => [f.id, f.type]));
    for (const field of form.fields) {
      if (knownTypes.has(field.id) && knownTypes.get(field.id) !== field.type && !fieldErrors[field.id]) {
        fieldErrors[field.id] = 'Тип поля нельзя поменять: удалите поле и добавьте новое';
      }
    }
  }
  const allErrors = { ...errors, fields: fieldErrors };
  if (Object.keys(fieldErrors).length === 0) delete allErrors.fields;
  if (Object.keys(allErrors).length > 0) throw new HttpError(400, 'Проверьте форму', { errors: allErrors });
  return form;
}

function newFormId(store) {
  for (;;) {
    let id = '';
    for (let i = 0; i < ID_LENGTH; i++) id += ID_ALPHABET[crypto.randomInt(ID_ALPHABET.length)];
    if (!store.forms.some((f) => f.id === id)) return id;
  }
}

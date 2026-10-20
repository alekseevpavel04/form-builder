// Field types and validation rules of a form. The server imports this file to
// check every submission and every form the manager saves; the browser imports
// the same file to show errors next to fields before sending. So it must not
// touch Node APIs or the DOM.

export const FIELD_TYPES = {
  text: 'Короткий текст',
  textarea: 'Длинный текст',
  email: 'Email',
  phone: 'Телефон',
  number: 'Число',
  date: 'Дата',
  radio: 'Один вариант',
  checkbox: 'Несколько вариантов',
  select: 'Выпадающий список',
};

export const CHOICE_TYPES = ['radio', 'checkbox', 'select'];

export const LIMITS = {
  title: 200,
  description: 2000,
  label: 300,
  hint: 500,
  option: 200,
  options: 50,
  fields: 100,
  text: 500,
  textarea: 5000,
  email: 254,
};

const FIELD_ID = /^[A-Za-z0-9_-]{1,40}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_CHARS = /^\+?[\d\s()-]+$/;
// Comma is accepted as a decimal separator: Russian users type 3,5.
const NUMBER = /^-?\d{1,15}([.,]\d{1,6})?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Checks what the manager sent from the builder and returns a clean copy:
// trimmed strings, only known keys, options only for choice types.
// errors: { title, description, form, fields: { <field id>: text } }, empty keys omitted.
export function validateFormDefinition(input) {
  const errors = { fields: {} };
  const source = isPlainObject(input) ? input : {};

  const title = cleanString(source.title);
  if (title === '') errors.title = 'Укажите название формы';
  else if (title.length > LIMITS.title) errors.title = `Название не длиннее ${LIMITS.title} символов`;

  const description = cleanString(source.description);
  if (description.length > LIMITS.description) errors.description = `Описание не длиннее ${LIMITS.description} символов`;

  const rawFields = Array.isArray(source.fields) ? source.fields : [];
  if (source.fields !== undefined && !Array.isArray(source.fields)) errors.form = 'Список полей должен быть массивом';
  if (rawFields.length > LIMITS.fields) errors.form = `В форме не больше ${LIMITS.fields} полей`;

  const fields = [];
  const seenIds = new Set();
  rawFields.forEach((raw, index) => {
    const id = isPlainObject(raw) ? raw.id : undefined;
    if (typeof id !== 'string' || !FIELD_ID.test(id) || seenIds.has(id)) {
      errors.form = `Поле ${index + 1}: неверный или повторяющийся id`;
      return;
    }
    seenIds.add(id);
    const { field, error } = cleanField(raw);
    if (error) errors.fields[id] = error;
    fields.push(field);
  });

  if (Object.keys(errors.fields).length === 0) delete errors.fields;
  const ok = Object.keys(errors).length === 0;
  return { form: { title, description, fields }, errors: ok ? null : errors };
}

function cleanField(raw) {
  const field = {
    id: raw.id,
    type: raw.type,
    label: cleanString(raw.label),
    required: raw.required === true,
    hint: cleanString(raw.hint),
  };
  if (!Object.hasOwn(FIELD_TYPES, field.type)) return { field, error: 'Неизвестный тип поля' };
  if (field.label === '') return { field, error: 'Укажите название поля' };
  if (field.label.length > LIMITS.label) return { field, error: `Название поля не длиннее ${LIMITS.label} символов` };
  if (field.hint.length > LIMITS.hint) return { field, error: `Подсказка не длиннее ${LIMITS.hint} символов` };
  if (!CHOICE_TYPES.includes(field.type)) return { field, error: null };

  field.options = Array.isArray(raw.options) ? raw.options.map(cleanString) : [];
  if (field.options.length === 0) return { field, error: 'Добавьте хотя бы один вариант ответа' };
  if (field.options.length > LIMITS.options) return { field, error: `Не больше ${LIMITS.options} вариантов` };
  if (field.options.includes('')) return { field, error: 'Вариант ответа не может быть пустым' };
  if (field.options.some((o) => o.length > LIMITS.option)) return { field, error: `Вариант не длиннее ${LIMITS.option} символов` };
  const repeated = field.options.find((o, i) => field.options.indexOf(o) !== i);
  if (repeated !== undefined) return { field, error: `Вариант «${repeated}» повторяется` };
  return { field, error: null };
}

// Checks a submission against the form's fields. Keys that are not fields of
// the form are dropped, so nothing outside the schema is ever stored.
// values holds only filled answers, already normalised (trimmed, numbers parsed).
export function validateAnswers(fields, answers) {
  const source = isPlainObject(answers) ? answers : {};
  const values = {};
  const errors = {};
  for (const field of fields) {
    const raw = Object.hasOwn(source, field.id) ? source[field.id] : undefined;
    const { value, error } = validateAnswer(field, raw);
    if (error) errors[field.id] = error;
    else if (value !== undefined) values[field.id] = value;
  }
  return { values, errors: Object.keys(errors).length === 0 ? null : errors };
}

export function validateAnswer(field, raw) {
  if (isEmpty(raw)) {
    if (!field.required) return { value: undefined, error: null };
    if (field.type === 'checkbox') return { error: 'Выберите хотя бы один вариант' };
    if (CHOICE_TYPES.includes(field.type)) return { error: 'Выберите вариант' };
    return { error: 'Заполните это поле' };
  }

  if (field.type === 'checkbox') {
    if (!Array.isArray(raw) || !raw.every((v) => typeof v === 'string')) return { error: 'Неверный формат ответа' };
    if (!raw.every((v) => field.options.includes(v))) return { error: 'Выберите варианты из списка' };
    // Kept in the order of options, so the table and CSV read the same for everyone.
    return { value: field.options.filter((o) => raw.includes(o)), error: null };
  }

  if (typeof raw !== 'string') return { error: 'Неверный формат ответа' };
  const value = raw.trim();

  switch (field.type) {
    case 'text':
    case 'textarea':
      if (value.length > LIMITS[field.type]) return { error: `Не длиннее ${LIMITS[field.type]} символов` };
      return { value, error: null };
    case 'email':
      if (value.length > LIMITS.email || !EMAIL.test(value)) return { error: 'Введите email в формате name@example.com' };
      return { value, error: null };
    case 'phone': {
      // Soft check on purpose: a strict mask for one country rejects real people.
      const digits = value.replace(/\D/g, '').length;
      if (!PHONE_CHARS.test(value) || digits < 10 || digits > 15) {
        return { error: 'Введите телефон с кодом, например +7 999 123-45-67' };
      }
      return { value, error: null };
    }
    case 'number': {
      const compact = value.replace(/\s/g, '');
      if (!NUMBER.test(compact)) return { error: 'Введите число, например 12 или 3,5' };
      return { value: Number(compact.replace(',', '.')), error: null };
    }
    case 'date':
      // Kept as the YYYY-MM-DD string: new Date() would shift the day by the time zone.
      if (!isCalendarDate(value)) return { error: 'Введите дату в формате ГГГГ-ММ-ДД' };
      return { value, error: null };
    case 'radio':
    case 'select':
      if (!field.options.includes(value)) return { error: 'Выберите вариант из списка' };
      return { value, error: null };
    default:
      return { error: 'Неизвестный тип поля' };
  }
}

function isCalendarDate(value) {
  const match = DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  if (year < 1900 || year > 2100) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isEmpty(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

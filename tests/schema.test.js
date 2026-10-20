import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FIELD_TYPES, validateAnswer, validateAnswers, validateFormDefinition } from '../public/shared/schema.js';
import { buildDemoForm } from '../src/demo.js';

const field = (type, extra = {}) => ({ id: 'f', type, label: 'Поле', required: true, hint: '', ...extra });
const options = ['Офис', 'Удалённо', 'Гибрид'];

function accepts(f, raw, expected = raw) {
  const result = validateAnswer(f, raw);
  assert.equal(result.error, null, `${f.type} ${JSON.stringify(raw)}: ${result.error}`);
  assert.deepEqual(result.value, expected);
}

function rejects(f, raw, pattern) {
  const result = validateAnswer(f, raw);
  assert.ok(result.error, `${f.type} ${JSON.stringify(raw)} should be rejected`);
  if (pattern) assert.match(result.error, pattern);
}

describe('answers by field type', () => {
  test('short text', () => {
    accepts(field('text'), '  Анна  ', 'Анна');
    rejects(field('text'), 'а'.repeat(501), /500/);
    rejects(field('text'), 42, /формат/);
  });

  test('long text keeps line breaks', () => {
    accepts(field('textarea'), 'строка 1\nстрока 2');
    accepts(field('textarea'), 'я'.repeat(5000));
    rejects(field('textarea'), 'я'.repeat(5001), /5000/);
  });

  test('email', () => {
    accepts(field('email'), 'anna@example.com');
    accepts(field('email'), ' anna.k+cv@mail.ru ', 'anna.k+cv@mail.ru');
    for (const bad of ['anna', 'anna@', '@example.com', 'anna@example', 'an na@example.com', 'a@b@c.ru']) {
      rejects(field('email'), bad, /name@example\.com/);
    }
  });

  test('phone accepts common spellings and counts digits', () => {
    for (const ok of ['+7 999 123-45-67', '8 (999) 123-45-67', '89991234567', '+44 20 7946 0958']) accepts(field('phone'), ok);
    for (const bad of ['12', '+7 999 12', '1234567890123456', '+7 999 abc-45-67', '7+9991234567', '+7 999 123-45-67 доб. 5']) {
      rejects(field('phone'), bad, /телефон/);
    }
  });

  test('number accepts comma and returns a number', () => {
    accepts(field('number'), '12', 12);
    accepts(field('number'), '3,5', 3.5);
    accepts(field('number'), '-2.25', -2.25);
    accepts(field('number'), '1 000', 1000);
    for (const bad of ['двенадцать', '12abc', '1e5', '3,5,1', '0x10', 'Infinity', '.5', '1.']) rejects(field('number'), bad, /число/);
  });

  test('date is a real calendar day in YYYY-MM-DD', () => {
    accepts(field('date'), '2026-10-23');
    accepts(field('date'), '2024-02-29');
    for (const bad of ['2025-02-29', '2026-13-01', '2026-04-31', '23.10.2026', '2026-1-5', '1800-01-01', '2026-10-23T00:00']) {
      rejects(field('date'), bad, /дату/);
    }
  });

  test('radio and select accept only listed options', () => {
    for (const type of ['radio', 'select']) {
      accepts(field(type, { options }), 'Гибрид');
      rejects(field(type, { options }), 'Марс', /из списка/);
      rejects(field(type, { options }), ['Офис'], /формат/);
    }
  });

  test('checkbox accepts a subset in the order of options', () => {
    const f = field('checkbox', { options });
    accepts(f, ['Гибрид', 'Офис'], ['Офис', 'Гибрид']);
    accepts(f, ['Офис', 'Офис'], ['Офис']);
    rejects(f, ['Офис', 'Марс'], /из списка/);
    rejects(f, 'Офис', /формат/);
    rejects(f, [1], /формат/);
  });

  test('every type is covered above', () => {
    assert.deepEqual(Object.keys(FIELD_TYPES).sort(), ['checkbox', 'date', 'email', 'number', 'phone', 'radio', 'select', 'text', 'textarea']);
  });
});

describe('empty answers', () => {
  test('required field of every type reports an error for empty input', () => {
    for (const type of Object.keys(FIELD_TYPES)) {
      const f = field(type, { options });
      for (const empty of [undefined, null, '', '   ', []]) {
        const { error } = validateAnswer(f, empty);
        assert.ok(error, `${type} ${JSON.stringify(empty)}`);
      }
    }
    assert.equal(validateAnswer(field('checkbox', { options }), []).error, 'Выберите хотя бы один вариант');
    assert.equal(validateAnswer(field('select', { options }), '').error, 'Выберите вариант');
    assert.equal(validateAnswer(field('email'), ' ').error, 'Заполните это поле');
  });

  test('optional empty field is fine and is not stored', () => {
    for (const type of Object.keys(FIELD_TYPES)) {
      const result = validateAnswer(field(type, { options, required: false }), '');
      assert.equal(result.error, null, type);
      assert.equal(result.value, undefined, type);
    }
  });

  test('optional field still checks format when filled', () => {
    rejects(field('email', { required: false }), 'anna', /email/);
  });

  test('errors carry their kind for the analytics: empty, format or option', () => {
    for (const type of Object.keys(FIELD_TYPES)) assert.equal(validateAnswer(field(type, { options }), '').kind, 'empty', type);
    assert.equal(validateAnswer(field('checkbox', { options }), []).kind, 'empty');
    assert.equal(validateAnswer(field('email'), 'anna@').kind, 'format');
    assert.equal(validateAnswer(field('text'), 'а'.repeat(501)).kind, 'format');
    assert.equal(validateAnswer(field('radio', { options }), ['Офис']).kind, 'format');
    assert.equal(validateAnswer(field('select', { options }), 'Марс').kind, 'option');
    assert.equal(validateAnswer(field('checkbox', { options }), ['Офис', 'Марс']).kind, 'option');
    assert.equal(validateAnswer(field('email'), 'a@b.ru').kind, undefined);
  });
});

describe('whole submission', () => {
  const { fields } = buildDemoForm('2026-10-20T00:00:00.000Z');
  const valid = {
    name: 'Анна Иванова',
    email: 'anna@example.com',
    phone: '',
    year: '3 курс',
    format: 'Гибрид',
    areas: ['Разработка'],
    hours: '20',
    start: '2026-11-01',
    project: '',
  };

  test('demo form accepts a valid submission and drops empty optional answers', () => {
    const { values, errors } = validateAnswers(fields, valid);
    assert.equal(errors, null);
    assert.deepEqual(values, {
      name: 'Анна Иванова',
      email: 'anna@example.com',
      year: '3 курс',
      format: 'Гибрид',
      areas: ['Разработка'],
      hours: 20,
      start: '2026-11-01',
    });
  });

  test('errors are keyed by field id, one per broken field', () => {
    const { errors } = validateAnswers(fields, { ...valid, name: '', email: 'anna', hours: 'много', format: 'Марс' });
    assert.deepEqual(Object.keys(errors).sort(), ['email', 'format', 'hours', 'name']);
  });

  test('keys outside the schema are dropped', () => {
    const { values, errors } = validateAnswers(fields, { ...valid, isAdmin: true, __proto__: { x: 1 }, constructor: 'x' });
    assert.equal(errors, null);
    assert.deepEqual(Object.keys(values).sort(), ['areas', 'email', 'format', 'hours', 'name', 'start', 'year']);
  });

  test('a non-object body is treated as all fields empty', () => {
    for (const body of [null, 'text', 42, ['Анна']]) {
      const { errors } = validateAnswers(fields, body);
      assert.ok(errors.name && errors.email, JSON.stringify(body));
    }
  });
});

describe('form definition from the builder', () => {
  const textField = { id: 'f1', type: 'text', label: ' Имя ', required: true, hint: '' };

  test('valid definition is trimmed and stripped of unknown keys', () => {
    const { form, errors } = validateFormDefinition({
      title: '  Стажировка ',
      description: '',
      status: 'published',
      fields: [
        { ...textField, extra: 1, options: ['x'] },
        { id: 'f2', type: 'radio', label: 'Формат', required: 'yes', options: [' Офис ', 'Гибрид'] },
      ],
    });
    assert.equal(errors, null);
    assert.deepEqual(form, {
      title: 'Стажировка',
      description: '',
      fields: [
        { id: 'f1', type: 'text', label: 'Имя', required: true, hint: '' },
        { id: 'f2', type: 'radio', label: 'Формат', required: false, hint: '', options: ['Офис', 'Гибрид'] },
      ],
    });
  });

  test('demo form passes its own schema check', () => {
    const demo = buildDemoForm('2026-10-20T00:00:00.000Z');
    const { form, errors } = validateFormDefinition(demo);
    assert.equal(errors, null);
    assert.deepEqual(form.fields, demo.fields);
  });

  test('empty title and broken fields are reported per field', () => {
    const { errors } = validateFormDefinition({
      title: ' ',
      fields: [
        { id: 'a', type: 'text', label: '' },
        { id: 'b', type: 'select', label: 'Курс', options: [] },
        { id: 'c', type: 'radio', label: 'Формат', options: ['Офис', ''] },
        { id: 'd', type: 'checkbox', label: 'Темы', options: ['Аналитика', 'Аналитика'] },
        { id: 'e', type: 'slider', label: 'Ползунок' },
      ],
    });
    assert.equal(errors.title, 'Укажите название формы');
    assert.deepEqual(errors.fields, {
      a: 'Укажите название поля',
      b: 'Добавьте хотя бы один вариант ответа',
      c: 'Вариант ответа не может быть пустым',
      d: 'Вариант «Аналитика» повторяется',
      e: 'Неизвестный тип поля',
    });
  });

  test('duplicate or malformed field ids are rejected', () => {
    assert.match(validateFormDefinition({ title: 'Т', fields: [textField, textField] }).errors.form, /Поле 2/);
    assert.match(validateFormDefinition({ title: 'Т', fields: [{ ...textField, id: '../x' }] }).errors.form, /Поле 1/);
    assert.match(validateFormDefinition({ title: 'Т', fields: ['x'] }).errors.form, /Поле 1/);
  });

  test('form without fields is a valid draft', () => {
    assert.equal(validateFormDefinition({ title: 'Черновик' }).errors, null);
  });
});

import { errorPage, formHeader, formIdFromPath, publicLink } from '/static/admin/common.js';
import { renderForm } from '/static/form/render.js';
import { api } from '/static/lib/api.js';
import { el, randomId } from '/static/lib/dom.js';
import { CHOICE_TYPES, FIELD_TYPES, validateFormDefinition } from '/static/shared/schema.js';

const app = document.getElementById('app');
const formId = formIdFromPath();

let form; // as last saved on the server
let draft; // what the manager is editing: { title, description, fields }
let responseCount = 0;
let dirty = false;

// Elements that are updated without rebuilding the page.
const ui = {};

function copyOfForm(source) {
  return JSON.parse(JSON.stringify({ title: source.title, description: source.description, fields: source.fields }));
}

function markDirty() {
  dirty = true;
  updateBar();
  renderPreview();
}

window.addEventListener('beforeunload', (e) => {
  if (dirty) e.preventDefault();
});

function showMessage(text, kind = 'error') {
  ui.message.textContent = text;
  ui.message.className = kind === 'error' ? 'form-message' : 'form-message ok';
  ui.message.hidden = !text;
}

function render() {
  document.title = `${form.title}: конструктор`;
  ui.message = el('p', { class: 'form-message', role: 'alert', hidden: true });
  ui.bar = el('section', { class: 'publish-bar' });
  ui.titleError = el('p', { class: 'field-error', hidden: true });
  ui.fieldList = el('ol', { class: 'field-cards' });
  ui.preview = el('div', { class: 'preview-frame' });

  const titleInput = el('input', { id: 'form-title', type: 'text', value: draft.title, maxlength: 200 });
  titleInput.addEventListener('input', () => {
    draft.title = titleInput.value;
    markDirty();
  });
  const descriptionInput = el('textarea', { id: 'form-description', rows: 3, maxlength: 2000 });
  descriptionInput.value = draft.description;
  descriptionInput.addEventListener('input', () => {
    draft.description = descriptionInput.value;
    markDirty();
  });

  const typeSelect = el(
    'select',
    { id: 'new-field-type', 'aria-label': 'Тип нового поля' },
    Object.entries(FIELD_TYPES).map(([type, label]) => el('option', { value: type, text: label })),
  );

  app.replaceChildren(
    formHeader(form, 'builder'),
    ui.bar,
    ui.message,
    el('div', { class: 'builder-grid' }, [
      el('section', { class: 'builder-editor', 'aria-label': 'Редактор' }, [
        el('div', { class: 'field' }, [el('label', { class: 'field-label', for: 'form-title', text: 'Название формы' }), titleInput, ui.titleError]),
        el('div', { class: 'field' }, [
          el('label', { class: 'field-label', for: 'form-description', text: 'Описание' }),
          el('p', { class: 'field-hint', text: 'Необязательно. Что это за отбор и сколько займёт заполнение.' }),
          descriptionInput,
        ]),
        el('h2', { text: 'Поля' }),
        ui.fieldList,
        el('div', { class: 'add-field' }, [typeSelect, el('button', { type: 'button', class: 'btn', text: 'Добавить поле', onclick: () => addField(typeSelect.value) })]),
      ]),
      el('section', { class: 'builder-preview', 'aria-label': 'Превью' }, [
        el('h2', { text: 'Превью' }),
        el('p', { class: 'muted', text: 'Так форму увидит студент. Можно заполнить и проверить ошибки, ответ отсюда не отправляется.' }),
        ui.preview,
      ]),
    ]),
  );
  renderFields();
  updateBar();
  renderPreview();
}

function updateBar() {
  const children = [];
  if (form.status === 'published') {
    const link = publicLink(form.id);
    const linkInput = el('input', { type: 'text', readonly: true, value: link, 'aria-label': 'Ссылка на форму', class: 'link-input' });
    children.push(
      el('div', { class: 'link-row' }, [
        linkInput,
        el('button', { type: 'button', class: 'btn', text: 'Копировать', onclick: () => copyLink(linkInput) }),
        el('a', { href: link, target: '_blank', class: 'btn', text: 'Открыть' }),
      ]),
    );
  } else if (form.status === 'closed') {
    children.push(el('p', { class: 'muted', text: 'Форма снята с публикации: по ссылке студенты видят, что приём ответов закрыт.' }));
  } else {
    children.push(el('p', { class: 'muted', text: 'Черновик: ссылка для студентов появится после публикации.' }));
  }

  const actions = [
    el('button', { type: 'button', class: 'btn', disabled: !dirty, text: dirty ? 'Сохранить' : 'Сохранено', onclick: save }),
  ];
  if (form.status === 'published') {
    actions.push(el('button', { type: 'button', class: 'btn btn-danger', text: 'Снять с публикации', onclick: closeForm }));
  } else {
    const label = form.status === 'closed' ? 'Опубликовать снова' : 'Опубликовать';
    actions.push(el('button', { type: 'button', class: 'btn btn-primary', text: label, onclick: publish }));
  }
  children.push(el('div', { class: 'actions' }, actions));
  if (dirty && form.status === 'published') {
    children.push(el('p', { class: 'muted', text: 'Изменения увидят студенты, которые откроют форму после сохранения.' }));
  }
  ui.bar.replaceChildren(...children);
}

async function copyLink(input) {
  try {
    await navigator.clipboard.writeText(input.value);
    showMessage('Ссылка скопирована', 'ok');
  } catch {
    // The clipboard API is missing on plain http by a LAN address.
    input.select();
    showMessage('Скопируйте ссылку из поля вручную', 'ok');
  }
}

function renderFields() {
  ui.cardErrors = {};
  if (draft.fields.length === 0) {
    ui.fieldList.replaceChildren(el('li', { class: 'empty', text: 'Полей пока нет. Выберите тип ниже и нажмите «Добавить поле».' }));
    return;
  }
  ui.fieldList.replaceChildren(...draft.fields.map((field, index) => renderCard(field, index)));
}

function renderCard(field, index) {
  const prefix = `b-${field.id}`;
  const error = el('p', { class: 'field-error', hidden: true });
  ui.cardErrors[field.id] = error;

  const labelInput = el('input', { id: `${prefix}-label`, type: 'text', value: field.label, maxlength: 300 });
  labelInput.addEventListener('input', () => {
    field.label = labelInput.value;
    markDirty();
  });
  const hintInput = el('input', { id: `${prefix}-hint`, type: 'text', value: field.hint, maxlength: 500 });
  hintInput.addEventListener('input', () => {
    field.hint = hintInput.value;
    markDirty();
  });
  const requiredInput = el('input', { id: `${prefix}-required`, type: 'checkbox', checked: field.required });
  requiredInput.addEventListener('change', () => {
    field.required = requiredInput.checked;
    markDirty();
  });

  let optionsBlock = null;
  if (CHOICE_TYPES.includes(field.type)) {
    const optionsInput = el('textarea', { id: `${prefix}-options`, rows: Math.max(3, field.options.length) });
    optionsInput.value = field.options.join('\n');
    optionsInput.addEventListener('input', () => {
      field.options = optionsInput.value
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
      markDirty();
    });
    optionsBlock = el('div', { class: 'field' }, [
      el('label', { class: 'field-label', for: optionsInput.id, text: 'Варианты ответа' }),
      el('p', { class: 'field-hint', text: 'Каждый вариант с новой строки' }),
      optionsInput,
    ]);
  }

  const last = draft.fields.length - 1;
  return el('li', { class: 'field-card' }, [
    el('div', { class: 'card-head' }, [
      el('span', { class: 'muted', text: `${index + 1}.` }),
      el('span', { class: 'badge', text: FIELD_TYPES[field.type] }),
    ]),
    el('div', { class: 'field' }, [el('label', { class: 'field-label', for: labelInput.id, text: 'Вопрос' }), labelInput]),
    el('div', { class: 'field' }, [el('label', { class: 'field-label', for: hintInput.id, text: 'Подсказка' }), hintInput]),
    optionsBlock,
    el('label', { class: 'choice', for: requiredInput.id }, [requiredInput, el('span', { text: 'Обязательное поле' })]),
    error,
    el('div', { class: 'card-actions' }, [
      el('button', { type: 'button', class: 'btn btn-small', text: '↑ Выше', disabled: index === 0, onclick: () => moveField(index, -1) }),
      el('button', { type: 'button', class: 'btn btn-small', text: '↓ Ниже', disabled: index === last, onclick: () => moveField(index, 1) }),
      el('button', { type: 'button', class: 'btn btn-small btn-danger', text: 'Удалить', onclick: () => removeField(index) }),
    ]),
  ]);
}

function addField(type) {
  const field = { id: randomId('f'), type, label: '', required: false, hint: '' };
  if (CHOICE_TYPES.includes(type)) field.options = ['Вариант 1', 'Вариант 2'];
  draft.fields.push(field);
  renderFields();
  markDirty();
  document.getElementById(`b-${field.id}-label`).focus();
}

function moveField(index, step) {
  const [field] = draft.fields.splice(index, 1);
  draft.fields.splice(index + step, 0, field);
  renderFields();
  markDirty();
  // Keep focus on the same button so several moves in a row are easy.
  const card = ui.fieldList.children[index + step];
  card.querySelector(step < 0 ? 'button' : 'button:nth-child(2)').focus();
}

function removeField(index) {
  const field = draft.fields[index];
  const name = field.label || 'без названия';
  const warning = responseCount > 0 ? ' Уже полученные ответы на него останутся в таблице и CSV.' : '';
  if (!confirm(`Удалить поле «${name}»?${warning}`)) return;
  draft.fields.splice(index, 1);
  renderFields();
  markDirty();
}

function renderPreview() {
  const preview = renderForm(
    { title: draft.title || 'Без названия', description: draft.description, fields: draft.fields },
    {
      onSubmit() {
        preview.showMessage('Все поля заполнены верно. Из превью ответ не отправляется.');
      },
    },
  );
  ui.preview.replaceChildren(preview.element);
}

function showDefinitionErrors(errors) {
  ui.titleError.textContent = errors.title || '';
  ui.titleError.hidden = !errors.title;
  let first = errors.title ? document.getElementById('form-title') : null;
  for (const field of draft.fields) {
    const text = errors.fields?.[field.id] || '';
    const node = ui.cardErrors[field.id];
    if (!node) continue;
    node.textContent = text;
    node.hidden = !text;
    node.closest('.field-card').classList.toggle('has-error', Boolean(text));
    if (text && !first) first = document.getElementById(`b-${field.id}-label`);
  }
  first?.focus();
  showMessage(errors.form || (first ? 'Проверьте отмеченные поля' : ''));
}

async function save() {
  const { errors } = validateFormDefinition(draft);
  if (errors) {
    showDefinitionErrors(errors);
    return false;
  }
  const result = await api('PUT', `/api/forms/${form.id}`, draft);
  if (!result.ok) {
    showDefinitionErrors(result.data.errors || {});
    if (!result.data.errors?.form) showMessage(result.data.error);
    return false;
  }
  form = result.data.form;
  dirty = false;
  showDefinitionErrors({});
  showMessage('Сохранено', 'ok');
  document.title = `${form.title}: конструктор`;
  app.querySelector('.page-header').replaceWith(formHeader(form, 'builder'));
  updateBar();
  return true;
}

async function publish() {
  if (dirty && !(await save())) return;
  const result = await api('POST', `/api/forms/${form.id}/publish`);
  if (!result.ok) {
    showMessage(result.data.error);
    return;
  }
  form = result.data.form;
  render();
  showMessage('Форма опубликована. Отправьте ссылку студентам.', 'ok');
}

async function closeForm() {
  if (!confirm('Снять форму с публикации? Студенты увидят, что приём ответов закрыт. Полученные ответы останутся.')) return;
  const result = await api('POST', `/api/forms/${form.id}/close`);
  if (!result.ok) {
    showMessage(result.data.error);
    return;
  }
  form = result.data.form;
  render();
  showMessage('Форма снята с публикации', 'ok');
}

const { ok, data } = await api('GET', `/api/forms/${encodeURIComponent(formId)}`);
if (ok) {
  form = data.form;
  responseCount = data.responseCount;
  draft = copyOfForm(form);
  render();
} else {
  errorPage(app, data.error);
}

import { publicLink, statusBadge } from '/static/admin/common.js';
import { api } from '/static/lib/api.js';
import { el, formatDateTime } from '/static/lib/dom.js';

const list = document.getElementById('list');
const message = document.getElementById('message');
const createButton = document.getElementById('create');

function showMessage(text) {
  message.textContent = text;
  message.hidden = !text;
}

function renderForms(forms) {
  if (forms.length === 0) {
    list.replaceChildren(
      el('section', { class: 'empty' }, [
        el('p', { text: 'Форм пока нет.' }),
        el('p', { class: 'muted', text: 'Нажмите «Новая форма», добавьте поля и опубликуйте: появится ссылка для студентов.' }),
      ]),
    );
    return;
  }
  list.replaceChildren(
    el(
      'ul',
      { class: 'form-list' },
      forms.map((form) =>
        el('li', { class: 'form-card' }, [
          el('div', { class: 'title-row' }, [
            el('a', { href: `/admin/forms/${form.id}`, class: 'form-card-title', text: form.title }),
            statusBadge(form.status),
          ]),
          el('p', { class: 'muted', text: `Полей: ${form.fieldCount} · изменена ${formatDateTime(form.updatedAt)}` }),
          el('div', { class: 'form-card-links' }, [
            el('a', { href: `/admin/forms/${form.id}`, text: 'Конструктор' }),
            el('a', { href: `/admin/forms/${form.id}/responses`, text: `Ответы (${form.responseCount})` }),
            el('a', { href: `/admin/forms/${form.id}/analytics`, text: 'Аналитика' }),
            form.status === 'published' ? el('a', { href: publicLink(form.id), target: '_blank', text: 'Открыть форму' }) : null,
          ]),
        ]),
      ),
    ),
  );
}

createButton.addEventListener('click', async () => {
  createButton.disabled = true;
  const { ok, data } = await api('POST', '/api/forms', { title: 'Новая форма', description: '', fields: [] });
  if (ok) {
    location.href = `/admin/forms/${data.form.id}`;
    return;
  }
  showMessage(data.error);
  createButton.disabled = false;
});

const { ok, data } = await api('GET', '/api/forms');
if (ok) renderForms(data.forms);
else list.replaceChildren(el('p', { class: 'form-message', text: data.error }));

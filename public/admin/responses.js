import { errorPage, formHeader, formIdFromPath, publicLink } from '/static/admin/common.js';
import { api } from '/static/lib/api.js';
import { el, formatDateTime } from '/static/lib/dom.js';

const app = document.getElementById('app');
const formId = formIdFromPath();

function cellText(value) {
  if (value === undefined) return '';
  if (Array.isArray(value)) return value.join('; ');
  if (typeof value === 'number') return String(value).replace('.', ',');
  return String(value);
}

function render({ form, columns, responses }) {
  document.title = `${form.title}: ответы`;
  const header = formHeader(form, 'responses');

  if (responses.length === 0) {
    const hint =
      form.status === 'published'
        ? `Ответы появятся здесь, когда студенты заполнят форму по ссылке ${publicLink(form.id)}`
        : 'Опубликуйте форму в конструкторе, чтобы получить ссылку для студентов.';
    app.replaceChildren(header, el('section', { class: 'empty' }, [el('p', { text: 'Ответов пока нет.' }), el('p', { class: 'muted', text: hint })]));
    return;
  }

  const table = el('table', { class: 'responses' }, [
    el('thead', {}, el('tr', {}, [
      el('th', { scope: 'col', text: 'Отправлен' }),
      ...columns.map((c) => el('th', { scope: 'col', class: c.removed ? 'removed' : null, text: c.removed ? `${c.label} (поле удалено)` : c.label })),
    ])),
    el('tbody', {}, responses.map((r) =>
      el('tr', {}, [
        el('td', { class: 'nowrap', text: formatDateTime(r.submittedAt) }),
        ...columns.map((c) => el('td', { text: cellText(r.answers[c.id]) })),
      ]),
    )),
  ]);

  app.replaceChildren(
    header,
    el('div', { class: 'toolbar' }, [
      el('p', { text: `Ответов: ${responses.length}` }),
      el('a', { class: 'btn', href: `/api/forms/${form.id}/responses.csv`, download: '', text: 'Скачать CSV' }),
    ]),
    // The table scrolls on its own on a phone, the page does not.
    el('div', { class: 'table-wrap' }, table),
  );
}

const { ok, data } = await api('GET', `/api/forms/${encodeURIComponent(formId)}/responses`);
if (ok) render(data);
else errorPage(app, data.error);

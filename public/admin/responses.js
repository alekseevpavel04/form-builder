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

// An email or a phone number broken in the middle is hard to read and to copy,
// so these stay on one line; long answers get room to wrap.
const NOWRAP_TYPES = new Set(['email', 'phone', 'date', 'number']);

function cellClass(column) {
  if (NOWRAP_TYPES.has(column.type)) return 'nowrap';
  if (column.type === 'textarea') return 'long';
  return null;
}

// A header gets the width of its text, up to a limit, so most stay on one
// line and only really long questions wrap. With one fixed width a long
// question stood five lines tall and left an empty band under the others.
function headerWidth(label) {
  return `min-width: ${Math.min(Math.max(11, Math.ceil(label.length * 0.62)), 24)}em`;
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
      ...columns.map((c) => {
        const label = c.removed ? `${c.label} (поле удалено)` : c.label;
        return el('th', { scope: 'col', class: c.removed ? 'removed' : null, style: headerWidth(label), text: label });
      }),
    ])),
    el('tbody', {}, responses.map((r) =>
      el('tr', {}, [
        el('td', { class: 'nowrap', text: formatDateTime(r.submittedAt) }),
        ...columns.map((c) => el('td', { class: cellClass(c), text: cellText(r.answers[c.id]) })),
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

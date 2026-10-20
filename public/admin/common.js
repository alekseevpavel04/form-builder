import { el } from '/static/lib/dom.js';

export const STATUS_LABELS = {
  draft: 'Черновик',
  published: 'Опубликована',
  closed: 'Снята с публикации',
};

export function statusBadge(status) {
  return el('span', { class: `badge badge-${status}`, text: STATUS_LABELS[status] });
}

export function publicLink(formId) {
  return `${location.origin}/f/${formId}`;
}

// The id is in the page address: /admin/forms/<id>, /admin/forms/<id>/responses and so on.
export function formIdFromPath() {
  return decodeURIComponent(location.pathname.split('/')[3] || '');
}

// Header shared by the pages of one form: back link, title and tabs.
export function formHeader(form, active) {
  const tabs = [
    ['builder', 'Конструктор', `/admin/forms/${form.id}`],
    ['responses', 'Ответы', `/admin/forms/${form.id}/responses`],
    ['analytics', 'Аналитика', `/admin/forms/${form.id}/analytics`],
  ];
  return el('header', { class: 'page-header' }, [
    el('a', { href: '/admin', class: 'back-link', text: '← Все формы' }),
    el('div', { class: 'title-row' }, [el('h1', { text: form.title }), statusBadge(form.status)]),
    el(
      'nav',
      { class: 'tabs' },
      tabs.map(([key, label, href]) =>
        el('a', { href, class: key === active ? 'tab active' : 'tab', 'aria-current': key === active ? 'page' : null, text: label }),
      ),
    ),
  ]);
}

export function errorPage(container, text) {
  container.replaceChildren(
    el('section', { class: 'notice' }, [el('h1', { text: 'Не получилось открыть' }), el('p', { text }), el('a', { href: '/admin', text: '← Все формы' })]),
  );
}

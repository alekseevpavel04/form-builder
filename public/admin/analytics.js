import { errorPage, formHeader, formIdFromPath, publicLink } from '/static/admin/common.js';
import { api } from '/static/lib/api.js';
import { el } from '/static/lib/dom.js';

const app = document.getElementById('app');
const formId = formIdFromPath();

const DEFINITIONS = [
  ['Открыли', 'сессии, в которых форму открыли хотя бы раз. Сессия это один браузер: перезагрузка и повторный переход по ссылке не добавляют просмотр, после отправки начинается новая.'],
  ['Начали', 'сессии, в которых ввели что-то хотя бы в одно поле.'],
  ['Отправили', 'сессии, ответ которых сервер принял.'],
  ['Конверсия', 'отправившие из открывших и из начавших.'],
  ['Незавершённые', 'начали, но не отправили. Сюда попадают и те, кто заполняет прямо сейчас.'],
  ['Где остановились', 'браузер сообщает только о заполненных полях, без их содержимого. Сессия отнесена к полю, которое идёт после самого дальнего заполненного.'],
  ['Медианное время', 'от первого ввода до отправки. Медиана, а не среднее: вкладка, забытая на ночь, не портит число.'],
];

function percent(part, total) {
  return total === 0 ? 0 : Math.round((part / total) * 100);
}

function share(part, total) {
  return total === 0 ? `${part} из ${total}` : `${part} из ${total} (${percent(part, total)}%)`;
}

function plural(n, [one, few, many]) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function formatDuration(seconds) {
  if (seconds < 1) return 'меньше секунды';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} ч ${m} мин`;
  if (m > 0) return s > 0 ? `${m} мин ${s} с` : `${m} мин`;
  return `${s} с`;
}

function bar(part, total) {
  return el('span', { class: 'bar', 'aria-hidden': 'true' }, el('span', { class: 'bar-fill', style: `width: ${percent(part, total)}%` }));
}

function funnel(data) {
  const rows = [
    ['Открыли форму', data.views, String(data.views)],
    ['Начали заполнять', data.started, share(data.started, data.views)],
    ['Отправили', data.submitted, share(data.submitted, data.views)],
  ];
  const median =
    data.medianSeconds === null
      ? 'Медианное время заполнения появится после первой отправки.'
      : `Медианное время заполнения: ${formatDuration(data.medianSeconds)} (по ${data.timedSessions} ${plural(data.timedSessions, ['отправке', 'отправкам', 'отправкам'])}).`;
  return el('section', { class: 'panel' }, [
    el('h2', { text: 'Воронка' }),
    el(
      'div',
      { class: 'funnel' },
      rows.map(([label, value, text]) =>
        el('div', { class: 'funnel-row' }, [el('span', { class: 'funnel-label', text: label }), bar(value, data.views), el('span', { class: 'funnel-value', text })]),
      ),
    ),
    el('p', { text: `Конверсия из начавших: ${share(data.submitted, data.started)}.` }),
    el('p', { text: `Открыли и ушли, ничего не введя: ${share(data.notStarted, data.views)}.` }),
    el('p', { text: median }),
  ]);
}

function dropOff(data) {
  const section = el('section', { class: 'panel' }, [el('h2', { text: 'Где уходят' })]);
  if (data.unfinished === 0) {
    section.append(el('p', { class: 'muted', text: 'Незавершённых сессий нет: все, кто начал заполнять, отправили форму.' }));
    return section;
  }

  const rows = [
    ...data.dropOff.fields.map((f) => ({ label: f.label, required: f.required, sessions: f.sessions })),
    { label: 'Заполнили всё, но не отправили', sessions: data.dropOff.atSubmit, last: true },
  ];
  const top = Math.max(...rows.map((r) => r.sessions));
  const recent =
    data.unfinishedRecent > 0
      ? ` Из них ${data.unfinishedRecent} ${plural(data.unfinishedRecent, ['была активна', 'были активны', 'были активны'])} за последние 30 минут и, возможно, ещё ${plural(data.unfinishedRecent, ['заполняется', 'заполняются', 'заполняются'])}.`
      : '';
  section.append(
    el('p', { text: `Незавершённых сессий: ${data.unfinished}.${recent}` }),
    el('div', { class: 'table-wrap' }, el('table', { class: 'drop-off' }, [
      el('thead', {}, el('tr', {}, [
        el('th', { scope: 'col', text: 'Остановились на поле' }),
        el('th', { scope: 'col', class: 'num', text: 'Сессий' }),
        el('th', { scope: 'col', text: 'Доля' }),
      ])),
      el('tbody', {}, rows.map((r) =>
        el('tr', { class: [r.sessions > 0 && r.sessions === top ? 'top' : '', r.last ? 'last' : ''].join(' ').trim() || null }, [
          el('td', {}, [r.label, r.required ? el('span', { class: 'required', 'aria-label': 'обязательное', text: ' *' }) : null]),
          el('td', { class: 'num', text: String(r.sessions) }),
          el('td', {}, el('span', { class: 'share' }, [bar(r.sessions, data.unfinished), el('span', { text: `${percent(r.sessions, data.unfinished)}%` })])),
        ]),
      )),
    ])),
    el('p', { class: 'muted', text: 'Доля считается от незавершённых сессий. Браузер сообщает только о заполненных полях, поэтому сессия отнесена к полю, которое идёт после последнего заполненного. Звёздочкой отмечены обязательные поля.' }),
  );
  return section;
}

function definitions() {
  return el('details', { class: 'panel definitions' }, [
    el('summary', { text: 'Как считаются числа' }),
    el('dl', {}, DEFINITIONS.flatMap(([term, text]) => [el('dt', { text: term }), el('dd', { text })])),
  ]);
}

function render(data) {
  const { form } = data;
  document.title = `${form.title}: аналитика`;
  const header = formHeader(form, 'analytics');

  if (data.views === 0) {
    const hint =
      form.status === 'published'
        ? `Числа появятся, когда студенты откроют форму по ссылке ${publicLink(form.id)}`
        : 'Опубликуйте форму в конструкторе, чтобы получить ссылку для студентов.';
    app.replaceChildren(header, el('section', { class: 'empty' }, [el('p', { text: 'Форму пока никто не открывал.' }), el('p', { class: 'muted', text: hint })]), definitions());
    return;
  }
  app.replaceChildren(header, funnel(data), dropOff(data), definitions());
}

const { ok, data } = await api('GET', `/api/forms/${encodeURIComponent(formId)}/analytics`);
if (ok) render(data);
else errorPage(app, data.error);

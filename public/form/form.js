import { api } from '/static/lib/api.js';
import { el } from '/static/lib/dom.js';
import { renderForm } from '/static/form/render.js';
import { clearSession, draftValues, loadSession, saveDraft } from '/static/form/session.js';
import { createTracker } from '/static/form/track.js';

const app = document.getElementById('app');
const formId = decodeURIComponent(location.pathname.split('/').pop());

function showNotice(title, text) {
  document.title = title;
  app.replaceChildren(el('section', { class: 'notice' }, [el('h1', { text: title }), el('p', { text })]));
}

// The page has its own words for a closed or missing form: the API text
// repeats the heading and does not tell the student what to do next.
const UNAVAILABLE = {
  410: ['Форма закрыта', 'Ответы больше не принимаются. Если вы не успели, напишите тем, кто прислал вам ссылку.'],
  404: ['Форма не найдена', 'Проверьте ссылку: возможно, в ней опечатка или форму ещё не опубликовали.'],
};

function showUnavailable(status, error) {
  const [title, text] = UNAVAILABLE[status] || ['Форма недоступна', error];
  showNotice(title, text);
}

async function start() {
  const { ok, status, data } = await api('GET', `/api/public/forms/${encodeURIComponent(formId)}`);
  if (!ok) {
    showUnavailable(status, data.error);
    return;
  }

  const { form } = data;
  document.title = form.title;
  // Sent with the answers too, so a double click or a retry is stored once.
  const session = loadSession(formId);
  const { sessionId } = session;
  const tracker = createTracker(formId, sessionId);
  tracker.view();
  const initialValues = draftValues(form.fields, session.values);

  const view = renderForm(form, {
    initialValues,
    onFieldChange() {
      tracker.start();
      saveDraft(formId, session, view.values());
    },
    onFieldCompleted: tracker.fieldCompleted,
    async onSubmit(answers) {
      const result = await api('POST', `/api/public/forms/${encodeURIComponent(formId)}/responses`, { sessionId, answers });
      if (result.ok) {
        clearSession(formId);
        showNotice('Ответ отправлен', 'Спасибо! Ваши ответы получены.');
        window.scrollTo(0, 0);
        return null;
      }
      if (result.status === 410 || result.status === 404) {
        clearSession(formId);
        showUnavailable(result.status, result.data.error);
        return null;
      }
      if (result.data.errors) return { errors: result.data.errors };
      view.showMessage(result.data.error);
      return null;
    },
  });
  if (Object.values(initialValues).some((v) => v.length > 0)) {
    view.showNote('Мы сохранили то, что вы ввели в прошлый раз. Можно продолжить с того же места.');
  }
  app.replaceChildren(view.element);
}

start();

import { api } from '/static/lib/api.js';
import { el, randomId } from '/static/lib/dom.js';
import { renderForm } from '/static/form/render.js';

const app = document.getElementById('app');
const formId = decodeURIComponent(location.pathname.split('/').pop());
// Sent with the answers so a double click or a retry is stored once.
const sessionId = randomId('s');

function showNotice(title, text) {
  document.title = title;
  app.replaceChildren(el('section', { class: 'notice' }, [el('h1', { text: title }), el('p', { text })]));
}

async function start() {
  const { ok, status, data } = await api('GET', `/api/public/forms/${encodeURIComponent(formId)}`);
  if (!ok) {
    const title = status === 410 ? 'Форма закрыта' : status === 404 ? 'Форма не найдена' : 'Форма недоступна';
    showNotice(title, data.error);
    return;
  }

  const { form } = data;
  document.title = form.title;
  const view = renderForm(form, {
    async onSubmit(answers) {
      const result = await api('POST', `/api/public/forms/${encodeURIComponent(formId)}/responses`, { sessionId, answers });
      if (result.ok) {
        showNotice('Ответ отправлен', 'Спасибо! Ваши ответы получены.');
        window.scrollTo(0, 0);
        return null;
      }
      if (result.status === 410 || result.status === 404) {
        showNotice('Форма закрыта', result.data.error);
        return null;
      }
      if (result.data.errors) return { errors: result.data.errors };
      view.showMessage(result.data.error);
      return null;
    },
  });
  app.replaceChildren(view.element);
}

start();

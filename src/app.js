import http from 'node:http';
import path from 'node:path';
import { getAnalytics } from './analytics.js';
import { receiveEvent } from './events.js';
import { closeForm, copyForm, createForm, getForm, getPublicForm, listForms, publishForm, updateForm } from './forms.js';
import { HttpError, redirect, resolveInside, sendJson, sendText, serveFile } from './http.js';
import { downloadCsv, listResponses, submitResponse } from './responses.js';

export function createApp({ store, publicDir }) {
  async function sendPage(res, parts, status = 200) {
    if (!(await serveFile(res, path.join(publicDir, ...parts), status))) {
      throw new Error(`Page is missing: ${parts.join('/')}`);
    }
  }

  // Pages are static files that load their data from /api. The status code
  // still tells whether the form exists, so a missing form is not a 200.
  const adminFormPage = (file) => ({ res, params }) =>
    sendPage(res, ['admin', file], store.forms.some((f) => f.id === params.id) ? 200 : 404);

  const studentPage = ({ res, params }) => {
    const form = store.forms.find((f) => f.id === params.id);
    let status = 200;
    if (!form || form.status === 'draft') status = 404;
    else if (form.status === 'closed') status = 410;
    return sendPage(res, ['form', 'index.html'], status);
  };

  const routes = [
    route('GET', '/', ({ res }) => redirect(res, '/admin')),
    route('GET', '/admin', ({ res }) => sendPage(res, ['admin', 'index.html'])),
    route('GET', '/admin/forms/:id', adminFormPage('builder.html')),
    route('GET', '/admin/forms/:id/responses', adminFormPage('responses.html')),
    route('GET', '/admin/forms/:id/analytics', adminFormPage('analytics.html')),
    route('GET', '/f/:id', studentPage),

    route('GET', '/api/forms', listForms),
    route('POST', '/api/forms', createForm),
    route('GET', '/api/forms/:id', getForm),
    route('PUT', '/api/forms/:id', updateForm),
    route('POST', '/api/forms/:id/publish', publishForm),
    route('POST', '/api/forms/:id/close', closeForm),
    route('POST', '/api/forms/:id/copy', copyForm),
    route('GET', '/api/forms/:id/responses', listResponses),
    route('GET', '/api/forms/:id/responses.csv', downloadCsv),
    route('GET', '/api/forms/:id/analytics', getAnalytics),

    route('GET', '/api/public/forms/:id', getPublicForm),
    route('POST', '/api/public/forms/:id/responses', submitResponse),
    route('POST', '/api/public/forms/:id/events', receiveEvent),
  ];

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.pathname.startsWith('/static/')) {
      const filePath = resolveInside(publicDir, url.pathname.slice('/static/'.length));
      if (filePath && (await serveFile(res, filePath))) return;
      throw new HttpError(404, 'Файл не найден');
    }

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const match = r.regex.exec(url.pathname);
      if (!match) continue;
      const params = {};
      r.names.forEach((name, i) => (params[name] = match[i + 1]));
      await r.handler({ store, req, res, url, params });
      return;
    }
    throw new HttpError(404, 'Страница не найдена');
  }

  return http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!(err instanceof HttpError)) {
        console.error(err);
        err = new HttpError(500, 'Внутренняя ошибка сервера');
      }
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (req.url.startsWith('/api/')) {
        sendJson(res, err.status, { error: err.message, ...err.details });
      } else {
        sendText(res, err.status, 'text/plain; charset=utf-8', err.message);
      }
    });
  });
}

// '/api/forms/:id' becomes a regex with one capture group per :name.
function route(method, pattern, handler) {
  const names = [];
  const source = pattern.replace(/:(\w+)/g, (_, name) => {
    names.push(name);
    return '([^/]+)';
  });
  return { method, regex: new RegExp(`^${source}$`), names, handler };
}

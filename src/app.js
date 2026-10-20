import http from 'node:http';
import path from 'node:path';
import { HttpError, redirect, resolveInside, sendJson, sendText, serveFile } from './http.js';

export function createApp({ store, publicDir }) {
  const routes = [
    route('GET', '/', ({ res }) => redirect(res, '/admin')),
    route('GET', '/admin', ({ res }) => serveFile(res, path.join(publicDir, 'admin', 'index.html'))),
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
      await r.handler({ req, res, url, params });
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

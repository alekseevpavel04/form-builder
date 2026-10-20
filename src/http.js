import fsp from 'node:fs/promises';
import path from 'node:path';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Thrown by handlers for bad input; the router turns it into a 4xx response.
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export function sendText(res, status, contentType, body, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

export function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

export async function readJson(req, limitBytes) {
  const declared = Number(req.headers['content-length']);
  if (declared > limitBytes) throw new HttpError(413, 'Слишком большой запрос');

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new HttpError(413, 'Слишком большой запрос');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text === '') throw new HttpError(400, 'Пустое тело запроса');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Тело запроса не является корректным JSON');
  }
}

// Resolves urlPath inside rootDir. Returns null for anything that would leave
// rootDir after decoding (../, %2e%2e, encoded slashes), so it is just a 404.
export function resolveInside(rootDir, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const filePath = path.resolve(rootDir, '.' + path.sep + decoded);
  if (!filePath.startsWith(rootDir + path.sep)) return null;
  return filePath;
}

export async function serveFile(res, filePath) {
  let body;
  try {
    body = await fsp.readFile(filePath);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') return false;
    throw err;
  }
  const contentType = CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': body.length,
    'Cache-Control': 'no-cache',
  });
  res.end(body);
  return true;
}

// fetch wrapper for the JSON API. Never throws: a network failure comes back as
// status 0 with a message, so every caller handles one shape.
export async function api(method, path, body) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    return { ok: false, status: 0, data: { error: 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.' } };
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = { error: `Сервер ответил ${res.status} без данных` };
  }
  return { ok: res.ok, status: res.status, data };
}

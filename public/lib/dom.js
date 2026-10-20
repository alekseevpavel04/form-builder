// Builds an element. Text goes in through textContent or text nodes, never as
// HTML, so whatever a manager or student typed is shown as text.
//   el('a', { href: '/admin', class: 'link', text: 'Назад' })
//   el('div', {}, [el('p', { text: 'x' }), 'plain text'])
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child !== null && child !== undefined && child !== false) node.append(child);
  }
  return node;
}

// crypto.randomUUID exists only on https or localhost. A phone that opens the
// form by the computer's LAN address is neither, so ids come from getRandomValues.
export function randomId(prefix = '') {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return prefix + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function formatDateTime(iso) {
  return new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

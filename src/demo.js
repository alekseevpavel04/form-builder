// The demo form uses every field type, so a fresh install shows what the
// builder can do without the manager creating anything first.
export function buildDemoForm(now) {
  return {
    id: 'demo',
    title: 'Стажировка в команде продукта',
    description: 'Заполнение займёт около трёх минут. Ответим на почту в течение недели.',
    status: 'published',
    fields: [
      { id: 'name', type: 'text', label: 'Имя и фамилия', required: true, hint: '' },
      { id: 'email', type: 'email', label: 'Email', required: true, hint: 'На него придёт ответ' },
      { id: 'phone', type: 'phone', label: 'Телефон', required: false, hint: 'Чтобы договориться о собеседовании' },
      {
        id: 'year',
        type: 'select',
        label: 'Курс',
        required: true,
        hint: '',
        options: ['1 курс', '2 курс', '3 курс', '4 курс', 'Магистратура', 'Уже выпустился'],
      },
      { id: 'format', type: 'radio', label: 'Формат работы', required: true, hint: '', options: ['Офис', 'Удалённо', 'Гибрид'] },
      {
        id: 'areas',
        type: 'checkbox',
        label: 'Какие направления интересны',
        required: true,
        hint: 'Можно выбрать несколько',
        options: ['Аналитика', 'Разработка', 'Дизайн', 'Маркетинг'],
      },
      { id: 'hours', type: 'number', label: 'Сколько часов в неделю готовы работать', required: true, hint: '' },
      { id: 'start', type: 'date', label: 'Когда можете начать', required: false, hint: '' },
      {
        id: 'project',
        type: 'textarea',
        label: 'Расскажите о проекте, которым гордитесь',
        required: false,
        hint: 'Пара предложений или ссылка на GitHub',
      },
    ],
    removedFields: [],
    createdAt: now,
    updatedAt: now,
  };
}

export async function seedDemoForm(store) {
  if (store.forms.length > 0) return false;
  store.forms.push(buildDemoForm(new Date().toISOString()));
  await store.save('forms');
  return true;
}

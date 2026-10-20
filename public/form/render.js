import { validateAnswer, validateAnswers } from '/static/shared/schema.js';
import { el } from '/static/lib/dom.js';

// Renders a form for filling in. The student page and the preview in the
// builder both use this function, so the manager sees exactly what students get.
//
// options.onSubmit(answers) is called after the browser-side check passes and
// may return { errors } from the server to show next to fields.
// options.onFieldCompleted(fieldId) is called when a field is left filled in
// and valid, onFieldError(fieldId, kind) when an error is shown at a field, and
// onFieldTime(fieldId, ms) when the student leaves a field they were in; the
// student page counts them for the drop-off analytics.
export function renderForm(form, { onSubmit, onFieldChange, onFieldCompleted, onFieldError, onFieldTime, initialValues = {}, submitLabel = 'Отправить' } = {}) {
  const controls = form.fields.map((field) => renderField(field, initialValues[field.id]));
  const message = el('p', { class: 'form-message', role: 'alert', hidden: true });
  const note = el('p', { class: 'form-note', hidden: true });
  const submitButton = el('button', { type: 'submit', class: 'btn btn-primary btn-wide', text: submitLabel });
  const hasRequired = form.fields.some((f) => f.required);
  const progress = hasRequired ? renderProgress(controls.filter((c) => c.field.required)) : null;

  const element = el('form', { class: 'form', novalidate: true }, [
    el('header', { class: 'form-header' }, [
      el('h1', { text: form.title }),
      form.description ? el('p', { class: 'form-description', text: form.description }) : null,
      hasRequired ? el('p', { class: 'muted', text: '* обязательное поле' }) : null,
    ]),
    note,
    progress?.node,
    ...controls.map((c) => c.node),
    message,
    submitButton,
  ]);

  // The field the student is in and since when. Radio buttons and checkboxes
  // of one question are one field, moving between them does not leave it.
  let active = null;
  const leaveField = () => {
    if (!active) return;
    onFieldTime?.(active.control.field.id, Math.round(performance.now() - active.since));
    active = null;
  };

  for (const control of controls) {
    // Text fields are checked when the student leaves them, choices at once.
    // A field that already shows an error is rechecked on every keystroke so
    // the error goes away as soon as it is fixed. Errors seen mid-typing are
    // not reported: clearing a field to retype it is not an "empty" error.
    const check = (report = true) => {
      const { value, error, kind } = validateAnswer(control.field, control.getValue());
      control.setError(error || '');
      if (error && report) onFieldError?.(control.field.id, kind);
      else if (value !== undefined) onFieldCompleted?.(control.field.id);
    };
    control.node.addEventListener('focusin', () => {
      if (active?.control !== control) active = { control, since: performance.now() };
    });
    control.node.addEventListener('focusout', (e) => {
      if (control.node.contains(e.relatedTarget)) return;
      if (active?.control === control) leaveField();
      check();
    });
    control.node.addEventListener('change', () => check());
    control.node.addEventListener('input', () => {
      if (control.hasError()) check(false);
      progress?.update();
      onFieldChange?.(control.field.id, control.getValue());
    });
  }
  progress?.update();

  const controller = {
    element,
    // The student page calls this when the tab is hidden: a phone often closes
    // the tab without moving focus, and the field they gave up on matters most.
    leaveField,
    values() {
      return Object.fromEntries(controls.map((c) => [c.field.id, c.getValue()]));
    },
    showErrors(errors) {
      let first = null;
      for (const control of controls) {
        const text = errors[control.field.id] || '';
        control.setError(text);
        if (text && !first) first = control;
      }
      first?.focus();
      const unknown = Object.keys(errors).some((id) => !controls.some((c) => c.field.id === id));
      if (unknown) controller.showMessage('Форма изменилась, пока вы её заполняли. Обновите страницу.');
      else controller.showMessage(first ? 'Проверьте отмеченные поля' : '');
    },
    showMessage(text) {
      message.textContent = text;
      message.hidden = !text;
    },
    showNote(text) {
      note.textContent = text;
      note.hidden = !text;
    },
    setBusy(busy) {
      submitButton.disabled = busy;
      submitButton.textContent = busy ? 'Отправляем…' : submitLabel;
    },
  };

  let busy = false;
  element.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const answers = controller.values();
    const { errors } = validateAnswers(form.fields, answers);
    controller.showErrors(errors || {});
    for (const control of controls) {
      const { error, kind } = validateAnswer(control.field, answers[control.field.id]);
      if (error) onFieldError?.(control.field.id, kind);
    }
    if (errors || !onSubmit) return;
    busy = true;
    controller.setBusy(true);
    try {
      const result = await onSubmit(answers);
      if (result?.errors) controller.showErrors(result.errors);
    } finally {
      busy = false;
      controller.setBusy(false);
    }
  });

  return controller;
}

// Counts required fields that are filled in and pass the check: a half-typed
// email is not done yet. Optional fields do not count, they never block sending.
function renderProgress(required) {
  const text = el('span', { class: 'progress-text' });
  const fill = el('span', { class: 'bar-fill' });
  const node = el('div', { class: 'form-progress', role: 'status', 'aria-live': 'polite' }, [
    text,
    el('span', { class: 'bar', 'aria-hidden': 'true' }, fill),
  ]);
  return {
    node,
    update() {
      const done = required.filter((c) => {
        const { value, error } = validateAnswer(c.field, c.getValue());
        return !error && value !== undefined;
      }).length;
      const next = done === required.length
        ? `Все обязательные поля заполнены (${done} из ${required.length})`
        : `Заполнено обязательных полей: ${done} из ${required.length}`;
      // Rewriting the same text would make a screen reader repeat it on every key.
      if (text.textContent !== next) text.textContent = next;
      fill.style.width = `${Math.round((done / required.length) * 100)}%`;
    },
  };
}

function renderField(field, initial) {
  const inputId = `field-${field.id}`;
  const hintId = `hint-${field.id}`;
  const errorId = `error-${field.id}`;
  const describedBy = field.hint ? `${hintId} ${errorId}` : errorId;
  const hint = field.hint ? el('p', { id: hintId, class: 'field-hint', text: field.hint }) : null;
  const error = el('p', { id: errorId, class: 'field-error', hidden: true });
  const caption = [field.label, field.required ? el('span', { class: 'required', 'aria-hidden': 'true', text: ' *' }) : null];

  let node;
  let inputs;
  let getValue;

  if (field.type === 'radio' || field.type === 'checkbox') {
    const selected = [].concat(initial ?? []);
    inputs = field.options.map((option, i) =>
      el('input', {
        type: field.type,
        name: field.id,
        id: `${inputId}-${i}`,
        value: option,
        checked: selected.includes(option),
        'aria-describedby': describedBy,
      }),
    );
    node = el('fieldset', { class: 'field' }, [
      el('legend', { class: 'field-label' }, caption),
      hint,
      el(
        'div',
        { class: 'choices' },
        inputs.map((input, i) => el('label', { class: 'choice', for: input.id }, [input, el('span', { text: field.options[i] })])),
      ),
      error,
    ]);
    getValue =
      field.type === 'radio'
        ? () => inputs.find((i) => i.checked)?.value ?? ''
        : () => inputs.filter((i) => i.checked).map((i) => i.value);
  } else {
    const input = renderInput(field, inputId, describedBy, initial);
    inputs = [input];
    node = el('div', { class: 'field' }, [el('label', { class: 'field-label', for: inputId }, caption), hint, input, error]);
    getValue = () => input.value;
  }

  return {
    field,
    node,
    getValue,
    focus: () => inputs[0]?.focus(),
    hasError: () => !error.hidden,
    setError(text) {
      error.textContent = text;
      error.hidden = !text;
      node.classList.toggle('has-error', Boolean(text));
      for (const input of inputs) {
        if (text) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
      }
    },
  };
}

// type, inputmode and autocomplete pick the right phone keyboard. Numbers use a
// text input: type=number refuses "3,5" in some browsers and then reports an
// empty value, so the student would get "fill in this field" for what they typed.
const INPUT_ATTRS = {
  text: { type: 'text' },
  email: { type: 'email', inputmode: 'email', autocomplete: 'email' },
  phone: { type: 'tel', inputmode: 'tel', autocomplete: 'tel' },
  number: { type: 'text', inputmode: 'decimal' },
  date: { type: 'date' },
};

function renderInput(field, id, describedBy, initial) {
  const common = { id, name: field.id, 'aria-describedby': describedBy };
  if (field.type === 'textarea') {
    const textarea = el('textarea', { ...common, rows: 4 });
    textarea.value = initial ?? '';
    return textarea;
  }
  if (field.type === 'select') {
    const select = el('select', common, [
      el('option', { value: '', text: 'Выберите вариант' }),
      ...field.options.map((option) => el('option', { value: option, text: option })),
    ]);
    select.value = field.options.includes(initial) ? initial : '';
    return select;
  }
  const input = el('input', { ...common, ...INPUT_ATTRS[field.type] });
  input.value = initial ?? '';
  return input;
}

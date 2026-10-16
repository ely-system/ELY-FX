// Controles de interface reutilizáveis (slider com campo numérico e seletor).

let uid = 0;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/**
 * Slider com campo numérico. Duplo clique no nome restaura o valor padrão.
 * onInput(v, live): live = true enquanto o usuário arrasta.
 */
export function slider({ label, min, max, step = 1, value, unit = '', default: def, tip, onInput }) {
  const id = 'ctl' + ++uid;
  const root = el('div', 'ctl ctl-range');
  const head = el('div', 'ctl-head');
  const lab = el('label', null, label);
  lab.htmlFor = id;
  if (tip) lab.title = tip;
  const num = el('span', 'ctl-num');
  const input = el('input');
  input.type = 'number';
  Object.assign(input, { min, max, step });
  input.setAttribute('aria-label', label);
  num.append(input);
  if (unit) num.append(el('span', null, unit));
  head.append(lab, num);

  const range = el('input');
  range.type = 'range';
  range.id = id;
  Object.assign(range, { min, max, step });
  root.append(head, range);

  const decimals = (String(step).split('.')[1] || '').length;
  let current = value;

  function setRange(lo, hi) {
    min = lo;
    max = hi;
    for (const e of [range, input]) Object.assign(e, { min, max });
    set(current);
  }
  function paint() {
    range.value = current;
    input.value = Number(current).toFixed(decimals);
    range.style.setProperty('--p', ((current - min) / (max - min)) * 100 + '%');
  }
  function set(v) {
    current = Math.min(max, Math.max(min, Number(v)));
    paint();
  }
  function emit(v, live) {
    set(v);
    onInput?.(current, live);
  }

  range.addEventListener('input', () => emit(range.value, true));
  range.addEventListener('change', () => emit(range.value, false));
  input.addEventListener('change', () => {
    const v = parseFloat(input.value.replace(',', '.'));
    if (Number.isFinite(v)) emit(v, false);
    else paint();
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  lab.addEventListener('dblclick', () => { if (def != null) emit(def, false); });

  set(value);
  return { el: root, set, get: () => current, setRange };
}

export function select({ label, options, value, tip, onInput }) {
  const id = 'ctl' + ++uid;
  const root = el('div', 'ctl ctl-select');
  const head = el('div', 'ctl-head');
  const lab = el('label', null, label);
  lab.htmlFor = id;
  if (tip) lab.title = tip;
  head.append(lab);
  const sel = el('select');
  sel.id = id;
  root.append(head, sel);

  function setOptions(opts) {
    const v = sel.value || value;
    sel.replaceChildren(...opts.map((o) => {
      const op = el('option', null, o.label);
      op.value = o.value;
      return op;
    }));
    sel.value = v;
  }
  setOptions(options);
  sel.value = value;
  sel.addEventListener('change', () => onInput?.(sel.value, false));
  return { el: root, set: (v) => { sel.value = v; }, get: () => sel.value, setOptions };
}

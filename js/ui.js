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

/**
 * Slider para toque, no estilo Lightroom mobile: arrastar na horizontal em qualquer ponto da linha
 * ajusta o valor (relativo, sem saltos); toque solto não muda nada; arrasto vertical rola a lista;
 * dois toques rápidos voltam ao valor padrão; tocar no número permite digitar o valor.
 * `log: true` usa escala logarítmica (ex.: tamanho do pincel).
 */
export function touchSlider({ label, min, max, step = 1, value, unit = '', default: def, log = false, onInput }) {
  const root = el('div', 'tslider');
  root.tabIndex = 0;
  root.setAttribute('role', 'slider');
  root.setAttribute('aria-label', label);
  const head = el('div', 'ts-head');
  const val = el('button', 'ts-value');
  val.type = 'button';
  val.title = 'Tocar para digitar o valor';
  head.append(el('span', 'ts-label', label), val);
  const track = el('div', 'ts-track');
  const fill = el('div', 'ts-fill');
  const thumb = el('div', 'ts-thumb');
  track.append(fill, thumb);
  root.append(head, track);

  const decimals = (String(step).split('.')[1] || '').length;
  const lo = log ? Math.log(Math.max(min, 1e-6)) : min;
  const hi = log ? Math.log(max) : max;
  const toT = (v) => ((log ? Math.log(Math.max(v, 1e-6)) : v) - lo) / (hi - lo);
  const fromT = (t) => { const x = lo + Math.min(1, Math.max(0, t)) * (hi - lo); return log ? Math.exp(x) : x; };
  let current = value;

  function paint() {
    const t = toT(current);
    // Faixas com zero no meio (ex.: ponto de origem) preenchem a partir do zero.
    const z = min < 0 && max > 0 ? toT(0) : 0;
    fill.style.left = Math.min(z, t) * 100 + '%';
    fill.style.width = Math.abs(t - z) * 100 + '%';
    thumb.style.left = t * 100 + '%';
    val.textContent = Number(current).toFixed(decimals) + unit;
    root.setAttribute('aria-valuenow', current);
  }
  function set(v) {
    const s = Math.round(Number(v) / step) * step;
    current = Math.min(max, Math.max(min, Number(s.toFixed(decimals))));
    paint();
  }
  function emit(v, live) {
    const before = current;
    set(v);
    if (current !== before || !live) onInput?.(current, live);
  }

  // Digitar o valor: o número vira um campo; Enter ou sair do campo aplica, Esc cancela.
  let input = null;
  function startEdit() {
    if (input) return;
    input = el('input', 'ts-input');
    // Com valores negativos usa o teclado numérico com sinal de menos.
    if (min < 0) input.type = 'number';
    else { input.type = 'text'; input.inputMode = decimals ? 'decimal' : 'numeric'; }
    input.value = Number(current).toFixed(decimals);
    input.setAttribute('aria-label', label);
    input.enterKeyHint = 'done';
    val.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (apply) => {
      if (done) return;
      done = true;
      const v = parseFloat(String(input.value).replace(',', '.'));
      input.replaceWith(val);
      input = null;
      if (apply && Number.isFinite(v)) emit(v, false);
      else paint();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }
  val.addEventListener('click', startEdit);

  let g = null;
  let lastTap = 0;
  root.addEventListener('pointerdown', (e) => {
    if (e.target === val || e.target === input) { g = null; return; } // toque no número = digitar
    g = { id: e.pointerId, x: e.clientX, y: e.clientY, active: false };
  });
  root.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (!g.active) {
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { g = null; return; } // é rolagem
      if (Math.abs(dx) < 6) return;
      g.active = true;
      g.x = e.clientX;
      g.t0 = toT(current);
      g.w = Math.max(80, track.clientWidth);
      try { root.setPointerCapture(e.pointerId); } catch { /* ignora */ }
      root.classList.add('active');
      return;
    }
    e.preventDefault();
    emit(fromT(g.t0 + (e.clientX - g.x) / g.w), true);
  });
  const end = (e) => {
    if (!g || e.pointerId !== g.id) return;
    if (g.active) emit(current, false);
    else if (e.type === 'pointerup') {
      const now = performance.now();
      if (now - lastTap < 320 && def != null) emit(def, false);
      lastTap = now;
    }
    g = null;
    root.classList.remove('active');
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  root.addEventListener('keydown', (e) => {
    if (e.target !== root) return;
    const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    emit(log ? fromT(toT(current) + d * 0.01) : current + d * step, false);
  });

  set(value);
  return { el: root, set, get: () => current };
}

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
 * onInput(v, live): live = true enquanto o usuário arrasta. `log: true` usa escala logarítmica.
 */
export function slider({ label, min, max, step = 1, value, unit = '', default: def, tip, track, log = false, onInput }) {
  const id = 'ctl' + ++uid;
  const root = el('div', 'ctl ctl-range' + (track ? ' tracked' : ''));
  if (track) root.style.setProperty('--track', `linear-gradient(to right, ${track.join(', ')})`);
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
  // Em escala log, o slider anda de 0 a 1000 e o valor é convertido.
  if (log) Object.assign(range, { min: 0, max: 1000, step: 1 });
  else Object.assign(range, { min, max, step });
  root.append(head, range);

  const decimals = (String(step).split('.')[1] || '').length;
  let current = value;
  const toT = (v) => log
    ? (Math.log(Math.max(v, 1e-6)) - Math.log(Math.max(min, 1e-6))) / (Math.log(max) - Math.log(Math.max(min, 1e-6)))
    : (v - min) / (max - min);
  const fromRange = (rv) => {
    if (!log) return rv;
    const lo = Math.log(Math.max(min, 1e-6));
    const v = Math.exp(lo + (rv / 1000) * (Math.log(max) - lo));
    return Math.round(v / step) * step;
  };

  function setRange(lo, hi) {
    min = lo;
    max = hi;
    if (!log) Object.assign(range, { min, max });
    Object.assign(input, { min, max });
    set(current);
  }
  function paint() {
    range.value = log ? Math.round(toT(current) * 1000) : current;
    input.value = Number(current).toFixed(decimals);
    range.style.setProperty('--p', toT(current) * 100 + '%');
  }
  function set(v) {
    current = Math.min(max, Math.max(min, Number(v)));
    paint();
  }
  function emit(v, live) {
    set(v);
    onInput?.(current, live);
  }

  range.addEventListener('input', () => emit(fromRange(Number(range.value)), true));
  range.addEventListener('change', () => emit(fromRange(Number(range.value)), false));
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
export function touchSlider({ label, min, max, step = 1, value, unit = '', default: def, log = false, track, onInput }) {
  const root = el('div', 'tslider' + (track ? ' tracked' : ''));
  if (track) root.style.setProperty('--track', `linear-gradient(to right, ${track.join(', ')})`);
  root.tabIndex = 0;
  root.setAttribute('role', 'slider');
  root.setAttribute('aria-label', label);
  const head = el('div', 'ts-head');
  const val = el('button', 'ts-value');
  val.type = 'button';
  val.title = 'Tocar para digitar o valor';
  head.append(el('span', 'ts-label', label), val);
  const trackEl = el('div', 'ts-track');
  const fill = el('div', 'ts-fill');
  const thumb = el('div', 'ts-thumb');
  trackEl.append(fill, thumb);
  root.append(head, trackEl);

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
      g.w = Math.max(80, trackEl.clientWidth);
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

// ---------------------------------------------------------------------------
// Cores: conversões e seletor (estilo Lightroom mobile: quadro de matiz × saturação,
// brilho, código hex e cores prontas; aplica ao vivo, "Cancelar" volta à cor anterior).
// ---------------------------------------------------------------------------

export function hexToRgb(hex) {
  let h = String(hex || '').trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
}

export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
}

function rgbToHsv([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}

function hsvToRgb(h, s, v) {
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
}

const SWATCHES = ['#ffffff', '#fff1d6', '#ffd08a', '#ff9a3c', '#ff5a4f', '#ff6ad5', '#a07cff', '#6aa8ff', '#5ce1e6', '#7dff9a'];
let picker = null;

function buildPicker() {
  const dlg = el('dialog', 'dialog color-dialog');
  dlg.innerHTML = `
    <div class="cp-head"><span class="cp-title"></span><span class="cp-preview"></span></div>
    <div class="cp-field"><div class="cp-cursor"></div></div>
    <div class="cp-row"><label>Brilho</label><input class="cp-v" type="range" min="0" max="100" step="1"></div>
    <div class="cp-row"><label for="cpHex">Hex</label><input id="cpHex" class="cp-hex" maxlength="7" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done"></div>
    <div class="cp-swatches"></div>
    <div class="dialog-actions"><button type="button" class="btn ghost cp-cancel">Cancelar</button><button type="button" class="btn primary cp-ok">OK</button></div>`;
  document.body.append(dlg);
  const q = (s) => dlg.querySelector(s);
  const P = { dlg, field: q('.cp-field'), cursor: q('.cp-cursor'), v: q('.cp-v'), hex: q('.cp-hex'), preview: q('.cp-preview'), title: q('.cp-title') };
  P.state = { h: 0, s: 0, v: 1, initial: '#ffffff', onInput: null };

  const paint = (fromHex) => {
    const { h, s, v } = P.state;
    const hex = rgbToHex(hsvToRgb(h, s, v));
    P.cursor.style.left = (h / 360) * 100 + '%';
    P.cursor.style.top = (1 - s) * 100 + '%';
    P.field.style.setProperty('--v', v);
    P.v.value = Math.round(v * 100);
    P.v.style.setProperty('--p', v * 100 + '%');
    P.preview.style.background = hex;
    if (!fromHex) P.hex.value = hex.toUpperCase();
    return hex;
  };
  const emit = (live, fromHex) => { const hex = paint(fromHex); P.state.onInput?.(hex, live); };
  P.paint = paint;

  const pick = (e) => {
    const r = P.field.getBoundingClientRect();
    P.state.h = Math.min(360, Math.max(0, ((e.clientX - r.left) / r.width) * 360));
    P.state.s = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    if (P.state.v < 0.05) P.state.v = 1; // tocar no quadro com brilho zerado traz a cor de volta
    emit(true);
  };
  P.field.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { P.field.setPointerCapture(e.pointerId); } catch { /* ignora */ }
    pick(e);
    const move = (ev) => pick(ev);
    const up = () => { P.field.removeEventListener('pointermove', move); P.field.removeEventListener('pointerup', up); emit(false); };
    P.field.addEventListener('pointermove', move);
    P.field.addEventListener('pointerup', up);
  });
  P.v.addEventListener('input', () => { P.state.v = P.v.value / 100; emit(true); });
  P.v.addEventListener('change', () => emit(false));
  P.hex.addEventListener('input', () => {
    const rgb = hexToRgb(P.hex.value);
    if (!rgb) return;
    [P.state.h, P.state.s, P.state.v] = rgbToHsv(rgb);
    emit(false, true);
  });
  P.hex.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); P.hex.blur(); } });
  P.hex.addEventListener('blur', () => paint());
  const sw = q('.cp-swatches');
  for (const c of SWATCHES) {
    const b = el('button', 'cp-swatch');
    b.type = 'button';
    b.style.background = c;
    b.title = c.toUpperCase();
    b.addEventListener('click', () => { [P.state.h, P.state.s, P.state.v] = rgbToHsv(hexToRgb(c)); emit(false); });
    sw.append(b);
  }
  const cancel = () => { P.state.onInput?.(P.state.initial, false); dlg.close(); };
  q('.cp-cancel').addEventListener('click', cancel);
  q('.cp-ok').addEventListener('click', () => dlg.close());
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); cancel(); }); // Esc
  return P;
}

/** Abre o seletor de cor. onInput(hex, live) é chamado ao vivo; Cancelar devolve a cor inicial. */
export function openColorPicker({ title = 'Cor', value = '#ffffff', onInput }) {
  picker ||= buildPicker();
  const rgb = hexToRgb(value) || [1, 1, 1];
  [picker.state.h, picker.state.s, picker.state.v] = rgbToHsv(rgb);
  picker.state.initial = rgbToHex(rgb);
  picker.state.onInput = onInput;
  picker.title.textContent = title;
  picker.paint();
  picker.dlg.showModal();
}

/** Campo de cor para o painel: amostra + código; tocar abre o seletor. */
export function colorField({ label, value, onInput, className = 'ctl ctl-color' }) {
  const root = el('div', className);
  const lab = el('span', 'ctl-color-label', label);
  const btn = el('button', 'color-btn');
  btn.type = 'button';
  btn.innerHTML = '<span class="color-chip"></span><span class="color-hex"></span>';
  root.append(lab, btn);
  let current = value;
  const set = (v) => {
    current = v;
    btn.querySelector('.color-chip').style.background = v;
    btn.querySelector('.color-hex').textContent = String(v).toUpperCase();
  };
  btn.addEventListener('click', () => openColorPicker({ title: label, value: current, onInput: (hex, live) => { set(hex); onInput?.(hex, live); } }));
  set(value);
  return { el: root, set, get: () => current };
}

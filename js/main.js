import { Renderer } from './gl/renderer.js';
import { MaskLayer, MaskHistory, ADD, SUBTRACT } from './mask.js';
import { Viewport } from './viewport.js';
import { effects, defaultParams } from './effects/index.js';
import { slider, select, touchSlider } from './ui.js';
import { APP_VERSION } from './version.js';

const $ = (s) => document.querySelector(s);
const stage = $('#stage');
const canvas = $('#glcanvas');
const overlay = $('#overlay');
const cursorEl = $('#brushCursor');

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------

let renderer;
try {
  renderer = new Renderer(canvas);
} catch (err) {
  const d = document.createElement('div');
  d.className = 'fatal';
  d.textContent = 'Não foi possível iniciar o editor: ' + err.message + ' Tente um navegador atualizado (Chrome, Edge, Firefox ou Safari).';
  document.body.append(d);
  throw err;
}
// Celulares e tablets têm menos memória de vídeo: máscara e prévia menores.
const coarse = matchMedia('(pointer: coarse)').matches;
const mobileLayout = matchMedia('(max-width: 860px)');
const mask = new MaskLayer(renderer, coarse ? 2560 : 4096);
const history = new MaskHistory(mask);
const view = new Viewport();

const state = {
  loaded: false,
  fileName: 'foto',
  effect: effects[0],
  params: defaultParams(effects[0]),
  tool: 'center',
  brush: { size: 250, hardness: 30, flow: 100 },
  maskOpacity: 100, // opacidade geral da máscara (%)
  fxOpacity: 100,   // opacidade geral do efeito (%)
  showMask: false,
  compare: false,      // modo antes/depois ligado pelo botão
  compareHold: false,  // tecla \ segurada
  space: false,
  previewLong: coarse ? 1280 : 2048,
  live: false, // usuário arrastando um controle → prévia rápida
};

let fxDirty = true;
let raf = 0;
let lastPointer = null;      // posição do ponteiro sobre o palco (null = fora)
let brushPreview = false;    // prévia vermelha do pincel visível por um instante
let brushPreviewTimer = 0;
let muiReady = false;         // interface do celular montada (evita uso antes da inicialização)

function requestRender(fx = false) {
  if (fx) fxDirty = true;
  if (!raf) raf = requestAnimationFrame(frame);
}

function frame() {
  raf = 0;
  if (state.loaded && fxDirty) {
    const p = state.live ? { ...state.params, quality: 'draft' } : state.params;
    renderer.updateFx(state.effect, p, state.previewLong);
    fxDirty = false;
  }
  const dpr = currentDpr();
  renderer.drawScreen({
    view, dpr, mask: state.loaded ? mask : null,
    stroke: mask.stroking ? { mode: mask.mode } : null,
    maskOpacity: state.maskOpacity / 100,
    fxOpacity: state.fxOpacity / 100,
    showOriginal: state.compare || state.compareHold,
    showMask: state.showMask,
  });
  updateOverlay();
}

function currentDpr() { return canvas.width / Math.max(1, stage.clientWidth); }

// ---------------------------------------------------------------------------
// Tamanho do palco
// ---------------------------------------------------------------------------

new ResizeObserver(() => {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = stage.clientWidth, h = stage.clientHeight;
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  view.setSize(w, h);
  updateZoomLabel();
  requestRender();
}).observe(stage);

// ---------------------------------------------------------------------------
// Painel: efeito
// ---------------------------------------------------------------------------

const effectSelect = $('#effectSelect');
for (const fx of effects) effectSelect.append(new Option(fx.name, fx.id));
effectSelect.addEventListener('change', () => switchEffect(effectSelect.value));

function switchEffect(id) {
  const fx = effects.find((f) => f.id === id);
  if (!fx || fx === state.effect) return;
  state.effect = fx;
  effectSelect.value = id;
  // Mantém o ponto de origem ao trocar entre efeitos que o usam.
  const keep = { ox: state.params.ox, oy: state.params.oy };
  state.params = defaultParams(state.effect);
  for (const k in keep) if (k in state.params && keep[k] != null) state.params[k] = keep[k];
  buildEffectControls();
  muiBuild();
  requestRender(true);
}

const fxOpacityControl = slider({
  label: 'Opacidade do efeito', min: 0, max: 100, value: state.fxOpacity, default: 100, unit: '%',
  tip: 'Intensidade geral do efeito sobre a foto original, como a opacidade de uma camada.',
  onInput: (v) => setFxOpacity(v),
});

function setFxOpacity(v) {
  fxOpacityControl.set(v);
  state.fxOpacity = fxOpacityControl.get();
  muiRefresh();
  requestRender();
}

let paramControls = {};
const openGroups = new Set();

function buildEffectControls() {
  const host = $('#effectParams');
  host.replaceChildren();
  paramControls = {};
  const groups = new Map();
  if (!state.effect.params.some((d) => d.id === 'direction')) host.append(fxOpacityControl.el);
  for (const def of state.effect.params) {
    const onInput = (v, live) => {
      if (isOriginParam(def.id)) beginOriginEdit();
      setParam(def.id, v, live);
      if (isOriginParam(def.id) && !live) commitOriginEdit();
    };
    let c;
    if (def.type === 'select') {
      c = select({ ...def, value: state.params[def.id], onInput });
    } else {
      // Faixas que dependem do tamanho da foto (ex.: ponto de origem em px a partir do centro).
      const [min, max] = def.range && state.loaded ? def.range(renderer.src.w, renderer.src.h) : [def.min, def.max];
      c = slider({ ...def, min, max, value: state.params[def.id], onInput });
    }
    paramControls[def.id] = c;

    if (!def.group) {
      host.append(c.el);
      // A opacidade do efeito vem logo depois da direção.
      if (def.id === 'direction') host.append(fxOpacityControl.el);
      continue;
    }
    let g = groups.get(def.group);
    if (!g) {
      const details = document.createElement('details');
      details.className = 'group';
      details.open = openGroups.has(def.group);
      details.addEventListener('toggle', () => {
        if (details.open) openGroups.add(def.group); else openGroups.delete(def.group);
      });
      const summary = document.createElement('summary');
      summary.textContent = def.group;
      g = document.createElement('div');
      g.className = 'controls';
      details.append(summary, g);
      host.append(details);
      groups.set(def.group, g);
    }
    g.append(c.el);
  }
}

// ---- Ponto de origem no histórico (Ctrl+Z / seta de voltar) ----
// Uma "edição de origem" começa no primeiro movimento (arrastar na foto, tocar, slider) e
// vira uma entrada de desfazer quando termina, se a posição mudou.
let originEdit = null;

function beginOriginEdit() {
  if (!originEdit && state.effect.originParams) originEdit = { ox: state.params.ox, oy: state.params.oy };
}

function commitOriginEdit() {
  const before = originEdit;
  originEdit = null;
  if (!before) return;
  const after = { ox: state.params.ox, oy: state.params.oy };
  if (before.ox === after.ox && before.oy === after.oy) return;
  const apply = (o) => { for (const k in o) setParam(k, o[k], false, true); };
  history.push({ undo: () => apply(before), redo: () => apply(after) });
  updateHistoryButtons();
}

const isOriginParam = (id) => id === 'ox' || id === 'oy';

function setParam(id, v, live = false, syncUI = false) {
  state.params[id] = v;
  state.live = live;
  if (syncUI) paramControls[id]?.set(v);
  muiRefresh();
  requestRender(true);
}

$('#btnResetParams').addEventListener('click', resetEffect);

function resetEffect() {
  state.params = defaultParams(state.effect);
  setFxOpacity(100);
  buildEffectControls();
  muiBuild();
  requestRender(true);
}

buildEffectControls();

// ---------------------------------------------------------------------------
// Painel: máscara / pincel
// ---------------------------------------------------------------------------

const brushControls = {
  size: slider({ label: 'Tamanho', min: 1, max: 3000, step: 1, value: state.brush.size, default: 250, unit: 'px',
    tip: 'Diâmetro do pincel em pixels da foto. Atalhos: Alt + roda do mouse, ou [ e ]',
    onInput: (v) => setBrush('size', v) }),
  hardness: slider({ label: 'Dureza', min: 0, max: 100, value: state.brush.hardness, default: 30, unit: '%',
    tip: 'Borda do pincel: 0% bem suave, 100% borda definida. Atalhos: Alt + botão direito + arrastar, ou Shift + [ e ]',
    onInput: (v) => setBrush('hardness', v) }),
  flow: slider({ label: 'Fluxo', min: 1, max: 100, value: state.brush.flow, default: 100, unit: '%',
    tip: 'Quanto cada passada deposita. Fluxo baixo marca aos poucos, acumulando enquanto você pinta. Atalho: teclas 1…0',
    onInput: (v) => setBrush('flow', v) }),
};
$('#brushParams').append(...Object.values(brushControls).map((c) => c.el));

const maskOpacityControl = slider({
  label: 'Opacidade da máscara', min: 0, max: 100, value: state.maskOpacity, default: 100, unit: '%',
  tip: 'Quanto a área marcada protege a foto do efeito. 100% = nenhum efeito na área marcada. Atalho: Shift + 1…0',
  onInput: (v) => setMaskOpacity(v),
});
$('#maskParams').append(maskOpacityControl.el);

function setBrush(key, v) {
  const c = brushControls[key];
  c.set(v);
  state.brush[key] = c.get();
  if (key === 'size' || key === 'hardness') flashBrushPreview();
  else updateCursor();
  muiRefresh();
  requestRender();
}

function setMaskOpacity(v) {
  maskOpacityControl.set(v);
  state.maskOpacity = maskOpacityControl.get();
  muiRefresh();
  requestRender();
}

$('#maskInvert').addEventListener('click', () => maskOp(() => mask.invert()));
$('#maskClear').addEventListener('click', () => maskOp(() => mask.fill(0)));

function maskOp(fn) {
  if (!state.loaded) return;
  history.push(fn());
  updateHistoryButtons();
  requestRender();
}

const showMaskInput = $('#showMask');
showMaskInput.addEventListener('change', () => setShowMask(showMaskInput.checked));

function setShowMask(on) {
  state.showMask = on;
  showMaskInput.checked = on;
  muiRefresh();
  requestRender();
}

// ---------------------------------------------------------------------------
// Painel: prévia
// ---------------------------------------------------------------------------

const PREVIEW_OPTIONS = [
  { value: '1280', label: 'Rápida (1280 px)', short: 'Rápida' },
  { value: '2048', label: 'Equilibrada (2048 px)', short: 'Normal' },
  { value: '3072', label: 'Alta (3072 px)', short: 'Alta' },
  { value: '100000', label: 'Total (mais lenta)', short: 'Total' },
];
const previewControl = select({
  label: 'Resolução da prévia',
  tip: 'Resolução usada para calcular o efeito na tela. A exportação sempre usa a resolução total.',
  options: PREVIEW_OPTIONS,
  value: String(state.previewLong),
  onInput: (v) => setPreviewLong(v),
});
$('#previewParams').append(previewControl.el);

function setPreviewLong(v) {
  previewControl.set(String(v));
  state.previewLong = Number(v);
  muiRefresh();
  requestRender(true);
}

// ---------------------------------------------------------------------------
// Ferramentas
// ---------------------------------------------------------------------------

let lastBrushTool = 'add';

function setTool(tool) {
  state.tool = tool;
  if (tool === 'add' || tool === 'sub') lastBrushTool = tool;
  for (const b of document.querySelectorAll('[data-tool]')) b.classList.toggle('active', b.dataset.tool === tool);
  stage.classList.remove('tool-center', 'tool-add', 'tool-sub', 'tool-pan');
  stage.classList.add('tool-' + tool);
  overlay.classList.toggle('dim', tool === 'add' || tool === 'sub');
  updateCursor();
  muiRefresh();
}
for (const b of document.querySelectorAll('[data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool));
setTool('center');

const isBrush = () => state.tool === 'add' || state.tool === 'sub';

// ---------------------------------------------------------------------------
// Overlay (alvo do centro, anéis da área nítida) e cursor do pincel
// ---------------------------------------------------------------------------

const ovCenter = $('#ovCenter');
const ovRings = $('#ovRings');

function updateOverlay() {
  overlay.style.display = state.loaded && state.effect.overlay ? '' : 'none';
  if (!state.loaded || !state.effect.overlay) return;
  const o = state.effect.overlay(state.params, renderer.src.w, renderer.src.h);
  const [sx, sy] = view.toScreen(o.center[0], o.center[1]);
  ovCenter.setAttribute('transform', `translate(${sx.toFixed(1)} ${sy.toFixed(1)})`);
  const want = o.rings.length * 2;
  while (ovRings.childNodes.length < want) {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    ovRings.append(c);
  }
  while (ovRings.childNodes.length > want) ovRings.lastChild.remove();
  o.rings.forEach((r, i) => {
    const dark = ovRings.childNodes[i * 2], light = ovRings.childNodes[i * 2 + 1];
    for (const c of [dark, light]) {
      c.setAttribute('cx', sx);
      c.setAttribute('cy', sy);
      c.setAttribute('r', Math.max(0, r * view.scale));
    }
    dark.setAttribute('class', 'ring-dark');
    light.setAttribute('class', 'ring-light' + (i > 0 ? ' solid' : ''));
  });
}

/** Mostra por um instante o pincel com o degradê vermelho (no ponteiro ou no centro da foto). */
function flashBrushPreview() {
  brushPreview = true;
  clearTimeout(brushPreviewTimer);
  brushPreviewTimer = setTimeout(() => { brushPreview = false; updateCursor(); }, 900);
  updateCursor();
}

function updateCursor() {
  const d = state.brush.size * view.scale;
  const pos = lastPointer || (brushPreview ? [stage.clientWidth / 2, stage.clientHeight / 2] : null);
  const show = state.loaded && (isBrush() || brushPreview) && pos && !state.space && !panning;
  cursorEl.classList.toggle('visible', !!show && d >= 4);
  stage.classList.toggle('small-brush', d < 4);
  if (!show) return;
  cursorEl.style.width = cursorEl.style.height = d + 'px';
  cursorEl.style.left = pos[0] + 'px';
  cursorEl.style.top = pos[1] + 'px';
  cursorEl.style.setProperty('--inner', (d * state.brush.hardness / 100) + 'px');
  // Ao ajustar tamanho/dureza, mostra o degradê real da ponta do pincel em vermelho (como no Photoshop).
  const preview = drag?.type === 'hardness' || (brushPreview && drag?.type !== 'paint');
  cursorEl.classList.toggle('preview', preview);
  cursorEl.style.background = preview ? falloffGradient(state.brush.hardness / 100) : '';
}

/** Mesma curva do shader do pincel: 1 − smoothstep(dureza, 1, distância / raio). */
function falloffGradient(h) {
  const stops = [`rgba(255,32,48,0.7) 0%`, `rgba(255,32,48,0.7) ${h * 100}%`];
  const n = 16;
  for (let i = 1; i <= n; i++) {
    const t = h + (1 - h) * (i / n);
    const u = (t - h) / Math.max(1e-6, 1 - h);
    const a = 1 - u * u * (3 - 2 * u);
    stops.push(`rgba(255,32,48,${(a * 0.7).toFixed(3)}) ${(t * 100).toFixed(2)}%`);
  }
  return `radial-gradient(circle closest-side, ${stops.join(', ')})`;
}

// ---------------------------------------------------------------------------
// Interação no palco: centro, pincel, mover, zoom, pinça
// ---------------------------------------------------------------------------

const pointers = new Map();
let drag = null;
let panning = false;

function local(e) {
  const r = stage.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

// Gestos de toque:
//  - um dedo só vira ação (pintar / mover origem) depois de andar 10 px E passados TOUCH_GRACE ms
//    sem um segundo dedo; assim o início de uma pinça nunca pinta nem move a origem;
//  - parado por 380 ms = mostrar o original;
//  - depois de uma pinça, o dedo que sobrar é ignorado até todos saírem da tela (gestureLock);
//  - o segundo dedo conta mesmo se cair sobre a barra ou o painel que ficam por cima da foto.
const TOUCH_GRACE = 90;
const TOUCH_SLOP = 10;
let gestureLock = false;

function onPointerDown(e) {
  if (!state.loaded) return;
  const touch = e.pointerType !== 'mouse';
  // Primeiro dedo de um gesto novo: descarta restos de um gesto anterior que não terminou direito.
  if (touch && e.isPrimary && pointers.size) {
    cancelSingleAction();
    drag = null;
    pointers.clear();
    gestureLock = false;
  }
  const p = local(e);
  pointers.set(e.pointerId, p);
  try { stage.setPointerCapture(e.pointerId); } catch { /* ponteiro já liberado */ }
  e.preventDefault();

  if (pointers.size >= 2) {
    if (pointers.size === 2) {
      cancelSingleAction();
      startPinch();
      gestureLock = true;
      requestRender(true);
    }
    return;
  }

  if (touch) {
    if (gestureLock || e.button !== 0 || state.space || state.tool === 'pan') {
      if (!gestureLock && (state.space || state.tool === 'pan')) { drag = { type: 'pan', last: p }; setPanning(true); }
      return;
    }
    drag = { type: 'pending', start: p, t: performance.now(), path: [p], moved: false, timer: setTimeout(startPeek, 380) };
    return;
  }

  if (isBrush() && e.altKey && e.button === 2) {
    // Alt + botão direito + arrastar: ajusta a dureza (direita/cima = mais dura).
    drag = { type: 'hardness', start: p, h0: state.brush.hardness };
    lastPointer = p;
    updateCursor();
  } else if (e.button === 1 || state.space || state.tool === 'pan') {
    drag = { type: 'pan', last: p };
    setPanning(true);
  } else if (e.button !== 0) {
    drag = null;
  } else {
    startAction(p);
  }
}

stage.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.zoombar') && !pointers.size) return;
  onPointerDown(e);
});
// Segundo dedo sobre a barra de cima ou o painel (que ficam por cima da foto): ainda é pinça.
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' || !pointers.size || stage.contains(e.target)) return;
  onPointerDown(e);
}, true);

/** Desfaz o que um único dedo tinha começado (usado quando vira pinça). */
function cancelSingleAction() {
  if (!drag) return;
  if (drag.type === 'pending') clearTimeout(drag.timer);
  if (drag.type === 'peek') setCompareHold(false);
  if (drag.type === 'paint') mask.cancelStroke();
  if (drag.type === 'center' && drag.before) {
    for (const k in drag.before) setParam(k, drag.before[k], false, true);
    originEdit = null;
  }
  if (drag.type === 'pan') setPanning(false);
}

/** Começa a ação da ferramenta atual no ponto p (mover origem, pintar ou, fora da foto, mover a vista). */
function startAction(p) {
  if (state.tool === 'center') {
    if (!insideImage(p)) {
      drag = { type: 'pan', last: p };
      setPanning(true);
      return;
    }
    const before = state.effect.originParams ? { ox: state.params.ox, oy: state.params.oy } : null;
    drag = { type: 'center', before };
    beginOriginEdit();
    moveCenter(p, true);
  } else {
    beginPaint(p);
  }
}

/** Continua a ação em andamento até o ponto p. */
function continueAction(p, e) {
  if (!drag) return;
  if (drag.type === 'pan') {
    view.pan(p[0] - drag.last[0], p[1] - drag.last[1]);
    drag.last = p;
    updateZoomLabel();
    requestRender();
  } else if (drag.type === 'center') {
    moveCenter(p, true);
  } else if (drag.type === 'paint') {
    const events = e?.getCoalescedEvents ? e.getCoalescedEvents() : [];
    if (events.length > 1) for (const ce of events) paintTo(local(ce));
    else paintTo(p);
    requestRender();
  }
}

/** Promove o toque pendente a ação, refazendo o caminho já percorrido pelo dedo. */
function commitPending() {
  const path = drag.path;
  clearTimeout(drag.timer);
  drag = null;
  lastPointer = path[0];
  startAction(path[0]);
  for (let i = 1; i < path.length; i++) continueAction(path[i]);
}

function insideImage(p) {
  const [ix, iy] = view.toImage(p[0], p[1]);
  return ix >= 0 && iy >= 0 && ix <= renderer.src.w && iy <= renderer.src.h;
}

function startPeek() {
  if (drag?.type !== 'pending' || drag.moved || pointers.size !== 1) return;
  drag = { type: 'peek' };
  setCompareHold(true);
  navigator.vibrate?.(10);
}

stage.addEventListener('pointermove', (e) => {
  const p = local(e);
  if (drag?.type === 'hardness') {
    // O círculo do pincel fica parado onde o ajuste começou.
    const delta = (p[0] - drag.start[0]) - (p[1] - drag.start[1]);
    setBrush('hardness', Math.round(drag.h0 + delta * 0.4));
    toast('Dureza ' + state.brush.hardness + '%', 900);
    return;
  }
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
  else if (e.pointerType !== 'mouse') return; // dedo que não começou no palco
  if (drag?.type === 'pinch') { movePinch(); return; }
  if (drag?.type === 'peek') return;
  if (drag?.type === 'pending') {
    drag.path.push(p);
    if (!drag.moved && Math.hypot(p[0] - drag.start[0], p[1] - drag.start[1]) >= TOUCH_SLOP) {
      drag.moved = true;
      clearTimeout(drag.timer);
    }
    if (!drag.moved || performance.now() - drag.t < TOUCH_GRACE) return;
    commitPending();
  }
  lastPointer = p;
  updateCursor();
  continueAction(p, e);
});

function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (!pointers.size) gestureLock = false;
  if (drag?.type === 'pinch') {
    if (pointers.size < 2) { drag = null; state.live = false; requestRender(true); }
    return;
  }
  if (!drag) return;
  if (drag.type === 'pending') {
    // Toque rápido: carimba o pincel ou posiciona o ponto de origem (refazendo o caminho, se houve).
    commitPending();
    if (!drag) return;
  }
  if (drag.type === 'peek') {
    setCompareHold(false);
    drag = null;
    return;
  }
  if (drag.type === 'paint') {
    history.push(mask.endStroke());
    updateHistoryButtons();
  } else if (drag.type === 'center') {
    state.live = false;
    commitOriginEdit();
    requestRender(true);
  }
  if (drag.type === 'pan') setPanning(false);
  drag = null;
  if (e.pointerType !== 'mouse') lastPointer = null;
  updateCursor();
  requestRender();
}
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', (e) => {
  // O sistema tomou o gesto: nada do que um dedo começou deve ficar aplicado.
  if (drag && drag.type !== 'pinch') { cancelSingleAction(); drag = null; requestRender(true); }
  if (pointers.size > 1) gestureLock = true;
  endPointer(e);
});
stage.addEventListener('contextmenu', (e) => { if (state.loaded) e.preventDefault(); });
stage.addEventListener('pointerleave',() => { lastPointer = null; updateCursor(); });

function setPanning(on) {
  panning = on;
  stage.classList.toggle('panning', on);
  updateCursor();
}

function moveCenter(p, live) {
  if (!state.effect.originParams) return;
  const [ix, iy] = view.toImage(p[0], p[1]);
  const o = state.effect.originParams(ix, iy, renderer.src.w, renderer.src.h);
  for (const k in o) setParam(k, o[k], live, true);
}

// --- Pincel ---

function beginPaint(p) {
  const [ix, iy] = view.toImage(p[0], p[1]);
  mask.beginStroke(state.tool === 'add' ? ADD : SUBTRACT);
  drag = { type: 'paint', x: ix, y: iy, carry: 0 };
  dabAt(ix, iy);
  requestRender();
}

function paintTo(p) {
  const [ix, iy] = view.toImage(p[0], p[1]);
  const dx = ix - drag.x, dy = iy - drag.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return;
  // Espaçamento entre carimbos: 10% do diâmetro (padrão do Photoshop é 25%; menor = traço mais liso).
  const spacing = Math.max(0.5, state.brush.size * 0.1);
  let pos = spacing - drag.carry;
  while (pos <= dist) {
    const t = pos / dist;
    dabAt(drag.x + dx * t, drag.y + dy * t);
    pos += spacing;
  }
  drag.carry = dist - (pos - spacing);
  drag.x = ix;
  drag.y = iy;
}

function dabAt(ix, iy) {
  const k = mask.scale;
  mask.dab(ix * k, iy * k, (state.brush.size / 2) * k, state.brush.hardness / 100, state.brush.flow / 100);
}

// --- Pinça (dois dedos) ---

function startPinch() {
  const [a, b] = [...pointers.values()];
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  drag = { type: 'pinch', dist: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, scale: view.scale, anchor: view.toImage(mid[0], mid[1]) };
}

function movePinch() {
  if (pointers.size < 2) return;
  const [a, b] = [...pointers.values()];
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const dist = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
  const s = clamp(drag.scale * (dist / drag.dist), view.minScale, view.maxScale);
  view.scale = s;
  view.x = mid[0] - drag.anchor[0] * s;
  view.y = mid[1] - drag.anchor[1] * s;
  view.fitted = false;
  updateZoomLabel();
  updateCursor();
  requestRender();
}

// --- Zoom ---

stage.addEventListener('wheel', (e) => {
  if (!state.loaded) return;
  e.preventDefault();
  const [sx, sy] = local(e);
  const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
  const dy = e.deltaY * unit;
  if (e.altKey && isBrush()) {
    // Alt + roda: tamanho do pincel (para cima = maior), proporcional ao tamanho atual.
    const s = state.brush.size;
    let next = Math.round(s * Math.exp(-dy * 0.0015));
    if (next === s && dy !== 0) next = s + (dy < 0 ? 1 : -1);
    lastPointer = [sx, sy];
    setBrush('size', next);
    toast('Tamanho ' + state.brush.size + ' px', 900);
    return;
  }
  // Trackpad sem Ctrl → desloca; roda do mouse ou pinça do trackpad (Ctrl) → zoom.
  const isTrackpadPan = !e.ctrlKey && Math.abs(e.deltaX) > 0 && e.deltaMode === 0;
  if (isTrackpadPan) view.pan(-e.deltaX, -dy);
  else view.zoomTo(view.scale * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), sx, sy);
  updateZoomLabel();
  updateCursor();
  requestRender();
}, { passive: false });

function zoomCentered(scale) {
  view.zoomTo(scale, view.w / 2, view.h / 2);
  updateZoomLabel();
  updateCursor();
  requestRender();
}
$('#zoomIn').addEventListener('click', () => zoomCentered(view.step(1)));
$('#zoomOut').addEventListener('click', () => zoomCentered(view.step(-1)));
$('#zoom100').addEventListener('click', () => zoomCentered(1));
$('#zoomFit').addEventListener('click', () => { view.fit(); updateZoomLabel(); updateCursor(); requestRender(); });

function updateZoomLabel() {
  $('#zoomLabel').textContent = Math.round(view.scale * 100) + '%';
  // No celular só aparece o botão "Ajustar", e apenas quando a foto não está enquadrada.
  $('#zoombar').classList.toggle('fitted', view.fitted);
}

// ---------------------------------------------------------------------------
// Abrir foto
// ---------------------------------------------------------------------------

const fileInput = $('#fileInput');
$('#btnOpen').addEventListener('click', () => fileInput.click());
$('#btnOpen2').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) openFile(fileInput.files[0]);
  fileInput.value = '';
});

let dragDepth = 0;
stage.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; stage.classList.add('dragover'); });
stage.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
stage.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; stage.classList.remove('dragover'); } });
stage.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  stage.classList.remove('dragover');
  const f = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|avif|gif|bmp)$/i.test(f.name));
  if (f) openFile(f);
  else toast('Arquivo não reconhecido como imagem.');
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

async function decode(file, opts) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'default', ...opts });
  } catch {
    // Alguns navegadores não aceitam todas as opções.
    return await createImageBitmap(file, opts);
  }
}

async function openFile(file) {
  if (state.loaded && history.canUndo && !confirm('Abrir outra foto? A máscara atual será descartada.')) return;
  toast('Abrindo ' + file.name + '…', 60000);
  try {
    let bmp = await decode(file);
    let w = bmp.width, h = bmp.height;
    const ow = w, oh = h;
    const max = renderer.maxTex;
    if (Math.max(w, h) > max) {
      const k = max / Math.max(w, h);
      w = Math.round(w * k);
      h = Math.round(h * k);
      bmp.close?.();
      bmp = await decode(file, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    }
    renderer.setImage(bmp, w, h);
    bmp.close?.();
    mask.init(w, h);
    history.clear();
    updateHistoryButtons();
    view.setSize(stage.clientWidth, stage.clientHeight);
    view.setImage(w, h);

    state.loaded = true;
    // Ponto de origem volta ao centro e as faixas dos controles passam a seguir o tamanho da foto.
    if ('ox' in state.params) state.params.ox = 0;
    if ('oy' in state.params) state.params.oy = 0;
    buildEffectControls();
    state.fileName = file.name.replace(/\.[^.]+$/, '') || 'foto';
    $('#dropzone').hidden = true;
    $('#zoombar').hidden = false;
    stage.classList.remove('empty');
    $('#btnExport').disabled = false;
    muiBuild();
    if (mobileLayout.matches) muiSetTab('effect', true);
    $('#imgInfo').textContent = `${state.fileName} — ${w} × ${h} px` + (mask.scale < 1 ? ` · máscara ${mask.w} × ${mask.h} px` : '');
    updateZoomLabel();
    requestRender(true);
    if (w !== ow) toast(`Foto reduzida de ${ow}×${oh} para ${w}×${h} px (limite da sua placa de vídeo).`, 6000);
    else toast(`${w} × ${h} px`, 1800);
  } catch (err) {
    console.error(err);
    toast('Não foi possível abrir esta imagem. Formatos aceitos: JPEG, PNG, WebP, AVIF.', 5000);
  }
}

// ---------------------------------------------------------------------------
// Desfazer / Antes-depois
// ---------------------------------------------------------------------------

function updateHistoryButtons() {
  $('#btnUndo').disabled = !history.canUndo;
  $('#btnRedo').disabled = !history.canRedo;
}
const busy = () => drag?.type === 'paint' || drag?.type === 'center';
function undo() { if (!busy() && history.undo()) { updateHistoryButtons(); requestRender(); } }
function redo() { if (!busy() && history.redo()) { updateHistoryButtons(); requestRender(); } }
$('#btnUndo').addEventListener('click', undo);
$('#btnRedo').addEventListener('click', redo);

const btnCompare = $('#btnCompare');

function updateCompare() {
  const on = state.loaded && (state.compare || state.compareHold);
  $('#compareBadge').hidden = !on;
  btnCompare.classList.toggle('pressed', state.compare);
  btnCompare.setAttribute('aria-pressed', String(state.compare));
  requestRender();
}
function setCompare(on) { state.compare = on; updateCompare(); }
function setCompareHold(on) {
  if (state.compareHold === on) return;
  state.compareHold = on;
  updateCompare();
}
btnCompare.addEventListener('click', () => setCompare(!state.compare));

// ---------------------------------------------------------------------------
// Atalhos de teclado
// ---------------------------------------------------------------------------

const isTyping = (e) => {
  const t = e.target;
  return t instanceof HTMLInputElement && t.type !== 'range' && t.type !== 'checkbox' || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement;
};

window.addEventListener('keydown', (e) => {
  if ($('#exportDialog').open) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();

  if (ctrl) {
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
    else if (k === 'o') { e.preventDefault(); fileInput.click(); }
    else if (k === 'e' || k === 's') { e.preventDefault(); openExport(); }
    else if (k === '0') { e.preventDefault(); view.fit(); updateZoomLabel(); requestRender(); }
    else if (k === '1') { e.preventDefault(); zoomCentered(1); }
    else if (k === '=' || k === '+') { e.preventDefault(); zoomCentered(view.step(1)); }
    else if (k === '-') { e.preventDefault(); zoomCentered(view.step(-1)); }
    return;
  }
  // Impede que o Alt sozinho ative o menu do navegador enquanto se usa os atalhos do pincel.
  if (e.key === 'Alt' && state.loaded) { e.preventDefault(); return; }
  if (isTyping(e) || e.altKey) return;

  if (e.code === 'Space') {
    e.preventDefault();
    if (!state.space) { state.space = true; stage.classList.add('space'); updateCursor(); }
    return;
  }
  if (e.code === 'Backslash' || e.code === 'IntlBackslash') { e.preventDefault(); setCompareHold(true); return; }

  switch (e.code) {
    case 'KeyV': setTool('center'); return;
    case 'KeyB': setTool('add'); return;
    case 'KeyE': setTool('sub'); return;
    case 'KeyX': setTool(state.tool === 'add' ? 'sub' : 'add'); return;
    case 'KeyH': setTool('pan'); return;
    case 'KeyM': setShowMask(!state.showMask); return;
    case 'BracketLeft':
    case 'BracketRight': {
      const up = e.code === 'BracketRight';
      if (e.shiftKey) setBrush('hardness', state.brush.hardness + (up ? 10 : -10));
      else setBrush('size', sizeStep(state.brush.size, up));
      e.preventDefault();
      return;
    }
  }
  const digit = /^Digit(\d)$/.exec(e.code);
  if (digit) {
    const v = digit[1] === '0' ? 100 : Number(digit[1]) * 10;
    if (e.shiftKey) setMaskOpacity(v);
    else setBrush('flow', v);
    toast((e.shiftKey ? 'Opacidade da máscara ' : 'Fluxo ') + v + '%', 900);
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'Alt' && state.loaded) e.preventDefault();
  if (e.code === 'Space') { state.space = false; stage.classList.remove('space'); updateCursor(); }
  if (e.code === 'Backslash' || e.code === 'IntlBackslash') setCompareHold(false);
});
window.addEventListener('blur', () => { state.space = false; stage.classList.remove('space'); setCompareHold(false); });

function sizeStep(s, up) {
  const step = s < 10 ? 1 : s < 50 ? 5 : s < 100 ? 10 : s < 300 ? 25 : s < 1000 ? 50 : 100;
  return up ? s + step : Math.max(1, s - step);
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

const dlg = $('#exportDialog');
const expFormat = $('#expFormat');
const expQuality = slider({ label: 'Qualidade', min: 50, max: 100, value: 95, default: 95, unit: '%' });
$('#expQuality').append(expQuality.el);
expFormat.addEventListener('change', () => { expQuality.el.hidden = expFormat.value === 'image/png'; });

$('#btnExport').addEventListener('click', openExport);

let exported = null; // { blob, file, name } pronto para salvar/compartilhar

function openExport() {
  if (!state.loaded || dlg.open) return;
  $('#expInfo').textContent = `${renderer.src.w} × ${renderer.src.h} px, resolução total.`;
  $('#expOptions').hidden = false;
  $('#expReady').hidden = true;
  $('#expGo').textContent = goLabel();
  exported = null;
  dlg.showModal();
}

const canShareFiles = () => coarse && typeof navigator.canShare === 'function';
const goLabel = () => (canShareFiles() ? 'Exportar' : 'Baixar');

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

$('#expShare').addEventListener('click', async () => {
  if (!exported) return;
  try {
    await navigator.share({ files: [exported.file], title: exported.name });
    dlg.close();
  } catch (err) {
    if (err.name !== 'AbortError') toast('Não foi possível compartilhar. Use “Baixar arquivo”.', 4000);
  }
});
$('#expDownload').addEventListener('click', () => {
  if (!exported) return;
  downloadBlob(exported.blob, exported.name);
  dlg.close();
  toast('Foto exportada.', 2000);
});

$('#expGo').addEventListener('click', async (e) => {
  e.preventDefault();
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Processando…';
  await new Promise((r) => setTimeout(r, 30));
  try {
    const type = expFormat.value;
    const img = renderer.exportImage(state.effect, state.params, mask, {
      maskOpacity: state.maskOpacity / 100, fxOpacity: state.fxOpacity / 100, lowMemory: coarse,
    });
    requestRender(true); // os buffers da prévia continuam válidos, mas o estado do GL mudou
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d').putImageData(img, 0, 0);
    const blob = await new Promise((res) => c.toBlob(res, type, expQuality.get() / 100));
    if (!blob) throw new Error('Falha ao codificar a imagem.');
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[type];
    const name = `${state.fileName}_elyfx.${ext}`;
    const file = new File([blob], name, { type });
    // No celular o menu de compartilhar permite "Salvar imagem" direto na galeria.
    // Ele precisa de um toque novo do usuário, por isso aparece como um segundo botão.
    if (coarse && navigator.canShare?.({ files: [file] })) {
      exported = { blob, file, name };
      $('#expOptions').hidden = true;
      $('#expReady').hidden = false;
      return;
    }
    downloadBlob(blob, name);
    dlg.close();
    toast('Foto exportada.', 2000);
  } catch (err) {
    console.error(err);
    toast('Erro ao exportar: ' + err.message, 6000);
  } finally {
    btn.disabled = false;
    btn.textContent = goLabel();
  }
});

// ---------------------------------------------------------------------------
// Celular: interface no estilo Lightroom mobile
//   abas embaixo → painel translúcido com todos os ajustes da aba empilhados
//   (arrasta-se direto no slider, sem tocar antes para escolher). Arrastar a alça ou as
//   abas para baixo recolhe o painel; para cima abre.
// ---------------------------------------------------------------------------

const mui = $('#mui');
const muiList = $('#muiList');
let muiTab = 'effect';
let muiOpen = false;
let muiRows = []; // { it, ctl?, seg?, btn? }
const muiOpenGroups = new Set();

function muiEffectItems() {
  const items = [
    { key: 'effect', label: 'Efeito', type: 'select', get: () => state.effect.id, set: (v) => switchEffect(v),
      options: effects.map((f) => ({ value: f.id, label: f.name, short: f.name.replace(/^Desfoque (de )?/, '').replace(/^./, (c) => c.toUpperCase()) })) },
  ];
  const fxOpacity = { key: 'fxOpacity', label: 'Opacidade', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 100,
    get: () => state.fxOpacity, set: (v) => setFxOpacity(v) };
  if (!state.effect.params.some((d) => d.id === 'direction')) items.push(fxOpacity);
  for (const def of state.effect.params) {
    const [min, max] = def.range && state.loaded ? def.range(renderer.src.w, renderer.src.h) : [def.min, def.max];
    items.push({
      key: def.id, label: def.group ? def.label : (def.chip || def.label), group: def.group,
      type: def.type, options: def.options, min, max, step: def.step, unit: def.unit === '%' ? '%' : (def.unit ? ' ' + def.unit : ''),
      default: def.default, get: () => state.params[def.id],
      set: (v, live) => {
        if (isOriginParam(def.id)) beginOriginEdit();
        setParam(def.id, v, live, true);
        if (isOriginParam(def.id) && !live) commitOriginEdit();
      },
    });
    // A opacidade do efeito vem logo depois da direção.
    if (def.id === 'direction') items.push(fxOpacity);
  }
  items.push({ key: 'preview', label: 'Prévia', type: 'select', options: PREVIEW_OPTIONS,
    get: () => String(state.previewLong), set: (v) => setPreviewLong(v) });
  return items;
}

function muiMaskItems() {
  return [
    { key: 'mode', label: 'Pincel', type: 'select', get: () => lastBrushTool, set: (v) => setTool(v),
      options: [{ value: 'add', label: '+ Marcar' }, { value: 'sub', label: '− Desmarcar' }] },
    { key: 'size', label: 'Tamanho', type: 'range', min: 1, max: 3000, step: 1, unit: ' px', default: 250, log: true,
      get: () => state.brush.size, set: (v) => setBrush('size', v) },
    { key: 'hardness', label: 'Dureza', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 30,
      get: () => state.brush.hardness, set: (v) => setBrush('hardness', v) },
    { key: 'flow', label: 'Fluxo', type: 'range', min: 1, max: 100, step: 1, unit: '%', default: 100,
      get: () => state.brush.flow, set: (v) => setBrush('flow', v) },
    { key: 'maskOpacity', label: 'Opacidade da máscara', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 100,
      get: () => state.maskOpacity, set: (v) => setMaskOpacity(v) },
    { key: 'show', label: 'Ver área', type: 'toggle', get: () => state.showMask, set: (v) => setShowMask(v) },
    { key: 'invert', label: 'Inverter', type: 'action', run: () => { maskOp(() => mask.invert()); toast('Máscara invertida', 1200); } },
    { key: 'clear', label: 'Limpar', type: 'action', run: () => { maskOp(() => mask.fill(0)); toast('Máscara limpa', 1200); } },
  ];
}

function muiSegRow(it) {
  const row = document.createElement('div');
  row.className = 'mrow';
  const label = document.createElement('div');
  label.className = 'mrow-label';
  label.textContent = it.label;
  const seg = document.createElement('div');
  seg.className = 'mrow-seg';
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', it.label);
  for (const o of it.options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.value = o.value;
    b.textContent = o.short || o.label;
    b.addEventListener('click', () => it.set(o.value));
    seg.append(b);
  }
  row.append(label, seg);
  return { row, seg };
}

/** Monta a lista empilhada da aba (troca de aba, de efeito ou nova foto). */
function muiBuild() {
  muiReady = true;
  const items = muiTab === 'effect' ? muiEffectItems() : muiMaskItems();
  muiRows = [];
  const frag = document.createDocumentFragment();
  const groups = new Map();
  let actions = null;
  for (const it of items) {
    let node;
    if (it.type === 'range') {
      const ctl = touchSlider({ label: it.label, min: it.min, max: it.max, step: it.step, unit: it.unit || '',
        value: it.get(), default: it.default, log: it.log, onInput: (v, live) => it.set(v, live) });
      muiRows.push({ it, ctl });
      node = ctl.el;
    } else if (it.type === 'select') {
      const { row, seg } = muiSegRow(it);
      muiRows.push({ it, seg });
      node = row;
    } else {
      if (!actions) { actions = document.createElement('div'); actions.className = 'mrow-actions'; }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mbtn' + (it.type === 'toggle' ? ' toggle' : '');
      btn.textContent = it.label;
      btn.addEventListener('click', () => (it.type === 'toggle' ? it.set(!it.get()) : it.run()));
      muiRows.push({ it, btn });
      actions.append(btn);
      continue;
    }
    if (it.group) {
      let g = groups.get(it.group);
      if (!g) {
        const d = document.createElement('details');
        d.className = 'mgroup';
        d.open = muiOpenGroups.has(it.group);
        d.addEventListener('toggle', () => { if (d.open) muiOpenGroups.add(it.group); else muiOpenGroups.delete(it.group); });
        const sum = document.createElement('summary');
        sum.textContent = it.group;
        g = document.createElement('div');
        d.append(sum, g);
        frag.append(d);
        groups.set(it.group, g);
      }
      g.append(node);
    } else {
      frag.append(node);
    }
  }
  if (actions) frag.insertBefore(actions, frag.children[1] || null); // ações logo abaixo do seletor do pincel
  muiList.replaceChildren(frag);
  muiRefresh();
}

/** Atualiza os valores mostrados (chamada sempre que algo muda, por qualquer caminho). */
function muiRefresh() {
  if (!muiReady) return;
  for (const r of muiRows) {
    if (r.ctl) r.ctl.set(r.it.get());
    if (r.seg) for (const b of r.seg.children) b.classList.toggle('active', b.dataset.value === String(r.it.get()));
    if (r.btn && r.it.type === 'toggle') r.btn.classList.toggle('on', !!r.it.get());
  }
}

/** Tocar na aba ativa recolhe/abre o painel. */
function muiSetTab(tab, forceOpen = false) {
  if (tab === muiTab && muiOpen && !forceOpen) muiOpen = false;
  else {
    const changed = tab !== muiTab;
    muiTab = tab;
    muiOpen = true;
    if (changed) { muiBuild(); muiList.scrollTop = 0; }
  }
  muiApply();
}

function muiApply() {
  mui.classList.toggle('collapsed', !muiOpen);
  // Painel recolhido: nenhuma aba fica marcada.
  for (const b of mui.querySelectorAll('.mtabs [data-tab]')) b.classList.toggle('active', muiOpen && b.dataset.tab === muiTab);
  // No celular a ferramenta segue a aba: Efeito = mover origem, Máscara = pincel.
  if (mobileLayout.matches) setTool(muiTab === 'mask' ? lastBrushTool : 'center');
}

for (const b of mui.querySelectorAll('.mtabs [data-tab]')) b.addEventListener('click', () => muiSetTab(b.dataset.tab));

// Arrastar as abas para baixo recolhe o painel; para cima abre. (A lista rola normalmente.)
{
  let sw = null;
  mui.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.mtabs')) return;
    sw = { x: e.clientX, y: e.clientY, id: e.pointerId, done: false };
  });
  mui.addEventListener('pointermove', (e) => {
    if (!sw || sw.id !== e.pointerId || sw.done) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    if (Math.abs(dy) < 24 || Math.abs(dy) < Math.abs(dx) * 1.4) return;
    sw.done = true;
    const open = dy < 0;
    if (open !== muiOpen) { muiOpen = open; muiApply(); }
    // O toque que terminou o arraste não deve virar "clique" numa aba.
    const block = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    mui.addEventListener('click', block, { capture: true, once: true });
    setTimeout(() => mui.removeEventListener('click', block, { capture: true }), 400);
  });
  const end = () => { sw = null; };
  mui.addEventListener('pointerup', end);
  mui.addEventListener('pointercancel', end);
}

// As barras ficam sobre a foto. O enquadramento desconta a barra de cima e as abas;
// o painel de ajustes é translúcido e deixa a foto aparecer por trás enquanto se ajusta.
function updateInsets() {
  if (!mobileLayout.matches) {
    view.setInsets(0, 0);
    for (const k of ['--inset-top', '--inset-bottom', '--ui-bottom']) stage.style.removeProperty(k);
    return;
  }
  const top = $('.topbar').getBoundingClientRect().height;
  const tabsTop = mui.querySelector('.mtabs').getBoundingClientRect().top;
  const bottom = Math.max(0, window.innerHeight - tabsTop);
  stage.style.setProperty('--inset-top', top + 'px');
  stage.style.setProperty('--inset-bottom', bottom + 'px');
  const panel = mui.getBoundingClientRect().height;
  stage.style.setProperty('--ui-bottom', panel + 'px');
  view.setInsets(top, bottom, panel);
  updateZoomLabel();
  requestRender();
}
new ResizeObserver(updateInsets).observe(mui);
new ResizeObserver(updateInsets).observe($('.topbar'));
mobileLayout.addEventListener('change', () => {
  if (mobileLayout.matches) muiApply();
  updateInsets();
});
muiBuild();
muiApply();

// Safari (iOS) aplica zoom de página com gestos mesmo com touch-action; bloqueia fora dos controles.
document.addEventListener('gesturestart', (e) => e.preventDefault());

// ---------------------------------------------------------------------------
// App instalável (PWA) e tela cheia
// ---------------------------------------------------------------------------

const standalone = matchMedia('(display-mode: standalone)').matches
  || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const btnInstall = $('#btnInstall');
const btnFullscreen = $('#btnFullscreen');
let installEvent = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  btnInstall.hidden = false;
});
window.addEventListener('appinstalled', () => { btnInstall.hidden = true; installEvent = null; });
if (isIOS && !standalone) btnInstall.hidden = false; // Safari não tem prompt: mostra instruções

btnInstall.addEventListener('click', async () => {
  if (installEvent) {
    installEvent.prompt();
    await installEvent.userChoice.catch(() => {});
    installEvent = null;
    btnInstall.hidden = true;
  } else {
    $('#installDialog').showModal();
  }
});

if (!standalone && document.fullscreenEnabled && coarse) btnFullscreen.hidden = false;
btnFullscreen.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
});

let swReg = null;
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').then((r) => { swReg = r; }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Versão sempre atualizada
//   A publicação carimba APP_VERSION no código e gera version.json. O app compara a versão
//   que ESTÁ RODANDO com a publicada (ao abrir, ao voltar para a tela, ao reconectar e a cada
//   5 minutos) e, se houver uma nova, mostra o aviso fixo com o botão "Atualizar".
// ---------------------------------------------------------------------------

// Remove o ?v= usado na atualização, deixando o endereço limpo.
if (new URLSearchParams(location.search).has('v')) {
  window.history.replaceState(null, '', location.pathname + location.hash);
}

async function fetchVersion() {
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch {
    return null; // offline ou rodando localmente
  }
}

let latestVersion = null;

async function checkForUpdate() {
  const v = await fetchVersion();
  if (!v?.version) return;
  latestVersion = v.version;
  if (APP_VERSION === 'dev' || v.version === APP_VERSION) {
    const d = v.date ? new Date(v.date).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
    $('#appVersion').textContent = `Versão ${APP_VERSION === 'dev' ? 'dev' : v.version}${d ? ' · ' + d : ''}`;
    $('#updateBar').hidden = true;
    return;
  }
  $('#appVersion').textContent = `Versão ${APP_VERSION} (nova disponível: ${v.version})`;
  $('#updateBar').hidden = false;
}

/** Recarrega na versão nova com um endereço único, que nenhum cache tem guardado. */
function applyUpdate(version) {
  $('#updating').hidden = false;
  const go = () => location.replace(location.pathname + '?v=' + encodeURIComponent(version));
  Promise.resolve(swReg?.update()).catch(() => {}).finally(() => setTimeout(go, 150));
}

$('#btnUpdate').addEventListener('click', () => {
  if (history.canUndo && !confirm('Atualizar agora? A edição atual será perdida. Exporte antes se quiser guardá-la.')) return;
  applyUpdate(latestVersion);
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
window.addEventListener('pageshow', (e) => { if (e.persisted) checkForUpdate(); });
window.addEventListener('online', checkForUpdate);
setInterval(checkForUpdate, 5 * 60 * 1000);
checkForUpdate();

// ---------------------------------------------------------------------------
// Diagnóstico de tela (5 toques rápidos no logo): medidas reais do aparelho para ajustar margens.
// ---------------------------------------------------------------------------

{
  let taps = [];
  $('.brand').addEventListener('click', () => {
    const now = performance.now();
    taps = taps.filter((t) => now - t < 1500);
    taps.push(now);
    if (taps.length >= 5) { taps = []; toggleDiag(); }
  });
  $('#diag').addEventListener('click', () => { $('#diag').hidden = true; });
}

function toggleDiag() {
  const box = $('#diag');
  if (!box.hidden) { box.hidden = true; return; }
  const probe = document.createElement('div');
  probe.className = 'safe-probe';
  document.body.append(probe);
  const cs = getComputedStyle(probe);
  const safe = ['Top', 'Right', 'Bottom', 'Left'].map((k) => parseFloat(cs['padding' + k]) || 0);
  probe.remove();
  const vv = window.visualViewport;
  const mode = ['fullscreen', 'standalone', 'minimal-ui', 'browser'].find((m) => matchMedia(`(display-mode: ${m})`).matches);
  const rect = (sel) => { const r = $(sel).getBoundingClientRect(); return `${Math.round(r.top)}→${Math.round(r.bottom)}`; };
  const meta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.content || '(padrão)';
  box.textContent = [
    `ELY FX ${APP_VERSION}`,
    `modo: ${mode}${navigator.standalone ? ' (navigator.standalone)' : ''}`,
    `barra de status: ${meta}`,
    `tela: ${screen.width}×${screen.height}  dpr ${devicePixelRatio}`,
    `janela: ${innerWidth}×${innerHeight}`,
    `visualViewport: ${vv ? `${Math.round(vv.width)}×${Math.round(vv.height)} topo ${Math.round(vv.offsetTop)}` : '—'}`,
    `documento: ${document.documentElement.clientWidth}×${document.documentElement.clientHeight}`,
    `área segura: topo ${safe[0]} dir ${safe[1]} base ${safe[2]} esq ${safe[3]}`,
    `barra de cima: ${rect('.topbar')}`,
    `painel/abas: ${rect('#mui')} · abas ${rect('.mtabs')}`,
    `margem embaixo: ${getComputedStyle($('#mui')).paddingBottom}`,
    '',
    'Toque aqui para fechar.',
  ].join('\n');
  box.hidden = false;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

let toastTimer = 0;
function toast(msg, ms = 2500) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

stage.classList.add('empty');
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  toast('A placa de vídeo reiniciou o contexto. Recarregue a página e abra a foto novamente.', 10000);
});
requestRender();

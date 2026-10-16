import { Renderer } from './gl/renderer.js';
import { MaskLayer, MaskHistory, ADD, SUBTRACT } from './mask.js';
import { Viewport } from './viewport.js';
import { effects, defaultParams } from './effects/index.js';
import { slider, select } from './ui.js';

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
effectSelect.addEventListener('change', () => {
  state.effect = effects.find((f) => f.id === effectSelect.value);
  // Mantém o ponto de origem ao trocar entre efeitos que o usam.
  const keep = { ox: state.params.ox, oy: state.params.oy };
  state.params = defaultParams(state.effect);
  for (const k in keep) if (k in state.params && keep[k] != null) state.params[k] = keep[k];
  buildEffectControls();
  requestRender(true);
});

let paramControls = {};
const openGroups = new Set();

function buildEffectControls() {
  const host = $('#effectParams');
  host.replaceChildren();
  paramControls = {};
  const groups = new Map();
  for (const def of state.effect.params) {
    const onInput = (v, live) => setParam(def.id, v, live);
    let c;
    if (def.type === 'select') {
      c = select({ ...def, value: state.params[def.id], onInput });
    } else {
      // Faixas que dependem do tamanho da foto (ex.: ponto de origem em px a partir do centro).
      const [min, max] = def.range && state.loaded ? def.range(renderer.src.w, renderer.src.h) : [def.min, def.max];
      c = slider({ ...def, min, max, value: state.params[def.id], onInput });
    }
    paramControls[def.id] = c;

    if (!def.group) { host.append(c.el); continue; }
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

function setParam(id, v, live = false, syncUI = false) {
  state.params[id] = v;
  state.live = live;
  if (syncUI) paramControls[id]?.set(v);
  requestRender(true);
}

$('#btnResetParams').addEventListener('click', () => {
  state.params = defaultParams(state.effect);
  buildEffectControls();
  requestRender(true);
});

buildEffectControls();

// ---------------------------------------------------------------------------
// Painel: máscara / pincel
// ---------------------------------------------------------------------------

const brushControls = {
  size: slider({ label: 'Tamanho', min: 1, max: 3000, step: 1, value: state.brush.size, default: 250, unit: 'px',
    tip: 'Diâmetro do pincel em pixels da foto. Atalhos: Alt + roda do mouse, ou [ e ]',
    onInput: (v) => { state.brush.size = v; flashBrushPreview(); } }),
  hardness: slider({ label: 'Dureza', min: 0, max: 100, value: state.brush.hardness, default: 30, unit: '%',
    tip: 'Borda do pincel: 0% bem suave, 100% borda definida. Atalhos: Alt + botão direito + arrastar, ou Shift + [ e ]',
    onInput: (v) => { state.brush.hardness = v; flashBrushPreview(); } }),
  flow: slider({ label: 'Fluxo', min: 1, max: 100, value: state.brush.flow, default: 100, unit: '%',
    tip: 'Quanto cada passada deposita. Fluxo baixo marca aos poucos, acumulando enquanto você pinta. Atalho: teclas 1…0',
    onInput: (v) => { state.brush.flow = v; } }),
};
$('#brushParams').append(...Object.values(brushControls).map((c) => c.el));

const maskOpacityControl = slider({
  label: 'Opacidade da máscara', min: 0, max: 100, value: state.maskOpacity, default: 100, unit: '%',
  tip: 'Quanto a área marcada protege a foto do efeito. 100% = nenhum efeito na área marcada. Atalho: Shift + 1…0',
  onInput: (v) => { state.maskOpacity = v; requestRender(); },
});
$('#maskParams').append(maskOpacityControl.el);

function setBrush(key, v) {
  const c = brushControls[key];
  c.set(v);
  state.brush[key] = c.get();
  if (key === 'size' || key === 'hardness') flashBrushPreview();
  else updateCursor();
  requestRender();
}

function setMaskOpacity(v) {
  maskOpacityControl.set(v);
  state.maskOpacity = maskOpacityControl.get();
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
  requestRender();
}

// ---------------------------------------------------------------------------
// Painel: prévia
// ---------------------------------------------------------------------------

$('#previewParams').append(select({
  label: 'Resolução da prévia',
  tip: 'Resolução usada para calcular o efeito na tela. A exportação sempre usa a resolução total.',
  options: [
    { value: '1280', label: 'Rápida (1280 px)' },
    { value: '2048', label: 'Equilibrada (2048 px)' },
    { value: '3072', label: 'Alta (3072 px)' },
    { value: '100000', label: 'Total (mais lenta)' },
  ],
  value: String(state.previewLong),
  onInput: (v) => { state.previewLong = Number(v); requestRender(true); },
}).el);

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

stage.addEventListener('pointerdown', (e) => {
  if (!state.loaded) return;
  if (e.target.closest('.zoombar')) return;
  const p = local(e);
  pointers.set(e.pointerId, p);
  try { stage.setPointerCapture(e.pointerId); } catch { /* ponteiro já liberado */ }
  e.preventDefault();

  if (pointers.size === 2) {
    if (drag?.type === 'paint') mask.cancelStroke();
    if (drag?.type === 'center' && drag.before) {
      for (const k in drag.before) setParam(k, drag.before[k], false, true);
    }
    startPinch();
    requestRender();
    return;
  }
  if (pointers.size > 2) return;

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
  } else if (state.tool === 'center') {
    const before = state.effect.originParams ? { ox: state.params.ox, oy: state.params.oy } : null;
    drag = { type: 'center', before };
    moveCenter(p, true);
  } else {
    beginPaint(p);
  }
});

stage.addEventListener('pointermove', (e) => {
  const p = local(e);
  if (drag?.type === 'hardness') {
    // O círculo do pincel fica parado onde o ajuste começou.
    const delta = (p[0] - drag.start[0]) - (p[1] - drag.start[1]);
    setBrush('hardness', Math.round(drag.h0 + delta * 0.4));
    toast('Dureza ' + state.brush.hardness + '%', 900);
    return;
  }
  lastPointer = p;
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
  updateCursor();
  if (!drag) return;

  if (drag.type === 'pinch') { movePinch(); return; }
  if (drag.type === 'pan') {
    view.pan(p[0] - drag.last[0], p[1] - drag.last[1]);
    drag.last = p;
    updateZoomLabel();
    requestRender();
  } else if (drag.type === 'center') {
    moveCenter(p, true);
  } else if (drag.type === 'paint') {
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ce of events.length ? events : [e]) paintTo(local(ce));
    requestRender();
  }
});

function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (drag?.type === 'pinch') {
    if (pointers.size < 2) { drag = null; state.live = false; requestRender(true); }
    return;
  }
  if (!drag) return;
  if (drag.type === 'paint') {
    history.push(mask.endStroke());
    updateHistoryButtons();
  } else if (drag.type === 'center') {
    state.live = false;
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
  if (drag?.type === 'paint') { mask.cancelStroke(); drag = null; requestRender(); }
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
    if (mobileLayout.matches) setTab('effect', true);
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
function undo() { if (drag?.type !== 'paint' && history.undo()) { updateHistoryButtons(); requestRender(); } }
function redo() { if (drag?.type !== 'paint' && history.redo()) { updateHistoryButtons(); requestRender(); } }
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
    const img = renderer.exportImage(state.effect, state.params, mask, state.maskOpacity / 100, { lowMemory: coarse });
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
// Celular: abas Efeito / Máscara e painel deslizante
// ---------------------------------------------------------------------------

const panel = $('#panel');
let mTab = 'effect';
let sheetOpen = true;

/** Tocar na aba ativa recolhe o painel para mostrar a foto inteira. */
function setTab(tab, forceOpen = false) {
  if (tab === mTab && sheetOpen && !forceOpen) sheetOpen = false;
  else { mTab = tab; sheetOpen = true; }
  applyTab();
}

function applyTab() {
  panel.dataset.tab = mTab;
  panel.classList.toggle('collapsed', !sheetOpen);
  for (const b of document.querySelectorAll('.mtabs [data-tab]')) b.classList.toggle('active', b.dataset.tab === mTab);
  // No celular a ferramenta segue a aba: Efeito = mover origem, Máscara = pincel.
  if (mobileLayout.matches) setTool(mTab === 'mask' ? lastBrushTool : 'center');
}

for (const b of document.querySelectorAll('.mtabs [data-tab]')) b.addEventListener('click', () => setTab(b.dataset.tab));
$('#sheetHandle').addEventListener('click', () => { sheetOpen = false; applyTab(); });
mobileLayout.addEventListener('change', () => {
  if (mobileLayout.matches) applyTab();
  else panel.classList.remove('collapsed');
});
if (mobileLayout.matches) { sheetOpen = false; applyTab(); }

// Safari (iOS) aplica zoom de página com gestos mesmo com touch-action; bloqueia fora dos controles.
document.addEventListener('gesturestart', (e) => e.preventDefault());

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

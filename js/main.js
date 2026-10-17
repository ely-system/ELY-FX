import { Renderer } from './gl/renderer.js';
import { MaskStore, History, ADD, SUBTRACT } from './mask.js';
import { Viewport } from './viewport.js';
import { effectsByGroup, defaultParams, visibleParams } from './effects/index.js';
import { loadPresets, savePresets, makePreset, presetToLayers, presetsFile, parsePresetsFile, uniqueName } from './presets.js';
import { MAX_STARS } from './effects/starburst.js';
import { slider, select, touchSlider, colorField } from './ui.js';
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
// Celulares e tablets têm menos memória de vídeo: máscaras e prévia menores.
const coarse = matchMedia('(pointer: coarse)').matches;
const mobileLayout = matchMedia('(max-width: 860px)');
const masks = new MaskStore(renderer, coarse ? 2560 : 4096);
const history = new History();
const view = new Viewport();

const state = {
  loaded: false,
  fileName: 'foto',
  layers: [],          // camadas de efeito, de baixo (índice 0) para cima
  selected: null,      // camada em edição
  tool: 'center',
  brush: { size: 250, hardness: 30, flow: 100 },
  showMask: false,
  showGuides: true,    // marcador do efeito (ponto de origem / pontos de luz) visível e editável
  compare: false,      // modo antes/depois ligado pelo botão
  compareHold: false,  // tecla \ ou toque longo
  space: false,
  previewLong: coarse ? 1280 : 2048,
  live: false,         // usuário arrastando um controle ou pintando → prévia rápida
};

let raf = 0;
let lastPointer = null;      // posição do ponteiro sobre o palco (null = fora)
let brushPreview = false;    // prévia vermelha do pincel visível por um instante
let brushPreviewTimer = 0;
let muiReady = false;        // interface do celular montada
let strokeLayer = null;      // camada cuja máscara está sendo pintada
let originEdit = null;       // edição do ponto de origem em andamento (para desfazer)
let layerSeq = 0;
let settingsControls = {};   // controles do painel de ajustes (desktop), por id do parâmetro

function requestRender() {
  if (!raf) raf = requestAnimationFrame(frame);
}

function frame() {
  raf = 0;
  let final = null;
  const stroke = masks.stroking && strokeLayer ? { layer: strokeLayer, mode: masks.mode, tex: masks.strokeTex } : null;
  if (state.loaded) {
    final = renderer.updateStack(state.layers, { previewLong: state.previewLong, live: state.live, stroke });
  }
  const sel = state.selected;
  renderer.drawScreen({
    view, dpr: currentDpr(), final,
    mask: sel ? sel.mask : null,
    stroke: stroke && stroke.layer === sel ? stroke : null,
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
// Camadas de efeito
// ---------------------------------------------------------------------------

function createLayer(effect) {
  return {
    id: ++layerSeq, effect, params: defaultParams(effect), fxOpacity: 100, maskOpacity: 100, visible: true,
    mask: masks.create(), fx: null, out: null, fxDirty: true, mixDirty: true, draft: false, refs: 0, destroyed: false,
  };
}

/** Libera a camada da GPU quando ela não está na pilha nem é mais referenciada pelo histórico. */
function maybeDestroy(L) {
  if (L.destroyed || L.refs > 0 || state.layers.includes(L)) return;
  renderer.disposeLayer(L);
  masks.dispose(L.mask);
  L.destroyed = true;
}

/** Algo abaixo mudou: a partir do índice i, todas as camadas precisam refazer o efeito. */
function dirtyFrom(i) {
  for (let k = Math.max(0, i); k < state.layers.length; k++) state.layers[k].fxDirty = true;
  requestRender();
}

function layerHistory(entry, layer) {
  layer.refs++;
  entry.dispose = () => { layer.refs--; maybeDestroy(layer); };
  history.push(entry);
  updateHistoryButtons();
}

function addLayer(effect) {
  if (!state.loaded) { toast('Abra uma foto primeiro.'); return; }
  const L = createLayer(effect);
  // Ponto de origem: começa no centro da foto (faixas dependem do tamanho da foto).
  state.layers.push(L);
  selectLayer(L);
  const idx = state.layers.length - 1;
  layerHistory({
    undo: () => removeLayerAt(state.layers.indexOf(L), false),
    redo: () => { insertLayerAt(L, idx); selectLayer(L); },
  }, L);
  layersChanged();
  dirtyFrom(idx);
}

function insertLayerAt(L, idx) {
  state.layers.splice(Math.min(idx, state.layers.length), 0, L);
  L.fxDirty = true;
  layersChanged();
  dirtyFrom(idx);
}

function removeLayerAt(idx, record = true) {
  const L = state.layers[idx];
  if (!L) return;
  state.layers.splice(idx, 1);
  renderer.disposeLayer(L); // as texturas da prévia são refeitas se a camada voltar
  if (state.selected === L) selectLayer(state.layers[Math.min(idx, state.layers.length - 1)] || null);
  if (record) {
    layerHistory({
      undo: () => { insertLayerAt(L, idx); selectLayer(L); },
      redo: () => removeLayerAt(state.layers.indexOf(L), false),
    }, L);
  }
  layersChanged();
  dirtyFrom(idx);
  maybeDestroy(L);
}

function moveLayer(from, to, record = true) {
  if (from === to || from < 0 || to < 0 || from >= state.layers.length || to >= state.layers.length) return;
  const [L] = state.layers.splice(from, 1);
  state.layers.splice(to, 0, L);
  if (record) {
    history.push({ undo: () => moveLayer(to, from, false), redo: () => moveLayer(from, to, false) });
    updateHistoryButtons();
  }
  layersChanged();
  dirtyFrom(Math.min(from, to));
}

function toggleVisible(L) {
  L.visible = !L.visible;
  layersChanged();
  dirtyFrom(state.layers.indexOf(L));
}

function selectLayer(L) {
  if (state.selected === L) return;
  state.selected = L;
  originEdit = null;
  buildSettings();
  layersChanged();
  muiBuild();
  requestRender();
}

/** Redesenha as listas de camadas (desktop e celular). */
function layersChanged() {
  renderLayerList($('#layerList'));
  if (muiReady && muiTab === 'layers' && !muiPicking) muiBuild();
  $('#layersHint').hidden = state.layers.length < 2;
}

// --- Lista de camadas com arrastar pelo ≡ ---

const ICON_HANDLE = '<svg viewBox="0 0 24 24"><path d="M5 8h14M5 12h14M5 16h14"/></svg>';
const ICON_EYE = '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_EYE_OFF = '<svg viewBox="0 0 24 24"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 4.4-1"/></svg>';
const ICON_DEL = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';

function renderLayerList(host, { onSelect } = {}) {
  host.replaceChildren();
  if (!state.layers.length) {
    const p = document.createElement('p');
    p.className = 'hint layer-empty';
    p.textContent = state.loaded ? 'Nenhum efeito aplicado. Toque em “Adicionar” para começar.' : 'Abra uma foto para adicionar efeitos.';
    host.append(p);
    return;
  }
  const n = state.layers.length;
  // A lista mostra a camada de cima primeiro, como no Photoshop.
  for (let vi = 0; vi < n; vi++) {
    const L = state.layers[n - 1 - vi];
    const row = document.createElement('div');
    row.className = 'layer-row' + (L === state.selected ? ' selected' : '') + (L.visible ? '' : ' off');
    row.setAttribute('role', 'listitem');
    row.innerHTML = `<span class="layer-handle" title="Arraste para mudar a ordem" aria-label="Mover">${ICON_HANDLE}</span>`
      + `<button class="layer-name" type="button"></button>`
      + `<button class="layer-eye" type="button" title="${L.visible ? 'Ocultar' : 'Mostrar'}" aria-label="${L.visible ? 'Ocultar' : 'Mostrar'} efeito">${L.visible ? ICON_EYE : ICON_EYE_OFF}</button>`
      + `<button class="layer-del" type="button" title="Remover efeito" aria-label="Remover efeito">${ICON_DEL}</button>`;
    row.querySelector('.layer-name').textContent = L.effect.name;
    row.querySelector('.layer-name').addEventListener('click', () => { selectLayer(L); onSelect?.(L); });
    row.querySelector('.layer-eye').addEventListener('click', () => toggleVisible(L));
    row.querySelector('.layer-del').addEventListener('click', () => removeLayerAt(state.layers.indexOf(L)));
    attachLayerDrag(row.querySelector('.layer-handle'), row, host, vi);
    host.append(row);
  }
}

/** Arrastar pelo ≡ para cima/baixo reordena (funciona com mouse e dedo). */
function attachLayerDrag(handle, row, host, viewIndex) {
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rows = [...host.querySelectorAll('.layer-row')];
    const h = row.getBoundingClientRect().height + 4;
    const y0 = e.clientY;
    let target = viewIndex;
    try { handle.setPointerCapture(e.pointerId); } catch { /* ignora */ }
    row.classList.add('dragging');
    const move = (ev) => {
      const dy = ev.clientY - y0;
      row.style.transform = `translateY(${dy}px)`;
      target = clamp(Math.round(viewIndex + dy / h), 0, rows.length - 1);
      rows.forEach((r, i) => {
        if (r === row) return;
        let shift = 0;
        if (target > viewIndex && i > viewIndex && i <= target) shift = -h;
        if (target < viewIndex && i < viewIndex && i >= target) shift = h;
        r.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      rows.forEach((r) => { r.style.transform = ''; });
      row.classList.remove('dragging');
      const n = state.layers.length;
      if (target !== viewIndex) moveLayer(n - 1 - viewIndex, n - 1 - target);
      else layersChanged();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}

// --- Menu "Adicionar efeito" com grupos ---

function buildFxPicker(onPick) {
  const wrap = document.createElement('div');
  wrap.className = 'fx-picker';
  for (const g of effectsByGroup()) {
    const sec = document.createElement('div');
    sec.className = 'fx-group';
    const title = document.createElement('div');
    title.className = 'fx-group-title';
    title.textContent = g.name;
    const grid = document.createElement('div');
    grid.className = 'fx-grid';
    if (!g.items.length) {
      const soon = document.createElement('span');
      soon.className = 'fx-soon';
      soon.textContent = 'Em breve';
      grid.append(soon);
    }
    for (const fx of g.items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fx-item';
      b.textContent = fx.name;
      b.addEventListener('click', () => onPick(fx));
      grid.append(b);
    }
    sec.append(title, grid);
    wrap.append(sec);
  }
  return wrap;
}

const fxPopover = $('#fxPopover');
const btnAddFx = $('#btnAddFx');

function closeFxPopover() {
  fxPopover.hidden = true;
  btnAddFx.setAttribute('aria-expanded', 'false');
}
btnAddFx.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!fxPopover.hidden) return closeFxPopover();
  if (!state.loaded) { toast('Abra uma foto primeiro.'); return; }
  fxPopover.replaceChildren(buildFxPicker((fx) => { closeFxPopover(); addLayer(fx); }));
  fxPopover.hidden = false;
  btnAddFx.setAttribute('aria-expanded', 'true');
});
document.addEventListener('pointerdown', (e) => {
  if (!fxPopover.hidden && !fxPopover.contains(e.target) && e.target !== btnAddFx) closeFxPopover();
});

// ---------------------------------------------------------------------------
// Painel: ajustes do efeito selecionado
// ---------------------------------------------------------------------------

const isOriginParam = (id) => id === 'ox' || id === 'oy';
const unitOf = (def) => def.unit;
// Estado aberto/fechado dos grupos recolhíveis (por nome). Sem escolha do usuário, vale o padrão do efeito.
const groupOpen = new Map();
const isGroupOpen = (effect, name) => groupOpen.get(name) ?? !!effect.openGroups?.includes(name);

function paramRange(def) {
  return def.range && state.loaded ? def.range(renderer.src.w, renderer.src.h) : [def.min, def.max];
}

/** Ajusta um parâmetro da camada selecionada (ou de `L`). */
function setParam(id, v, live = false, syncUI = false, L = state.selected) {
  if (!L) return;
  L.params[id] = v;
  L.fxDirty = true;
  state.live = live;
  if (L === state.selected) {
    if (syncUI) settingsControls[id]?.set(v);
    // Parâmetros que mostram/ocultam outros (ex.: tipo de ruído) remontam os controles.
    if (L.effect.params.some((d) => d.showIf) && L.effect.params.find((d) => d.id === id)?.type === 'select') {
      buildSettings();
      muiBuild();
    } else muiRefresh();
  }
  dirtyFrom(state.layers.indexOf(L));
}

function setFxOpacity(v, L = state.selected) {
  if (!L) return;
  L.fxOpacity = v;
  L.mixDirty = true;
  if (L === state.selected) { settingsControls.__fxOpacity?.set(v); muiRefresh(); }
  requestRender();
}

function setMaskOpacity(v, L = state.selected) {
  if (!L) return;
  L.maskOpacity = clamp(v, 0, 100);
  L.mixDirty = true;
  if (L === state.selected) { maskOpacityControl.set(L.maskOpacity); muiRefresh(); }
  requestRender();
}

function onParamInput(def, v, live) {
  if (isOriginParam(def.id)) beginOriginEdit();
  setParam(def.id, v, live);
  if (isOriginParam(def.id) && !live) commitOriginEdit();
}

function buildSettings() {
  const host = $('#effectParams');
  host.replaceChildren();
  settingsControls = {};
  const L = state.selected;
  $('#settingsEmpty').hidden = !!L;
  $('#btnResetParams').hidden = !L;
  $('#settingsTitle').textContent = L ? L.effect.name : 'Ajustes do efeito';
  $('#maskCard').classList.toggle('disabled', !L);
  $('#settingsHint').hidden = !L?.effect.hint;
  $('#settingsHint').textContent = L?.effect.hint || '';
  const actionsEl = $('#effectActions');
  actionsEl.replaceChildren(...effectActionButtons(L, 'btn small ghost'));
  actionsEl.hidden = !actionsEl.children.length;
  if (L) maskOpacityControl.set(L.maskOpacity);
  if (!L) return;

  const opacity = slider({
    label: 'Opacidade do efeito', min: 0, max: 100, value: L.fxOpacity, default: 100, unit: '%',
    tip: 'Intensidade geral do efeito sobre o que está abaixo dele, como a opacidade de uma camada.',
    onInput: (v) => setFxOpacity(v),
  });
  settingsControls.__fxOpacity = opacity;
  const defs = visibleParams(L.effect, L.params);
  if (!defs.some((d) => d.id === 'direction')) host.append(opacity.el);
  const groups = new Map();
  for (const def of defs) {
    const onInput = (v, live) => onParamInput(def, v, live);
    let c;
    if (def.type === 'select') c = select({ ...def, value: L.params[def.id], onInput });
    else if (def.type === 'color') c = colorField({ label: def.label, value: L.params[def.id], onInput });
    else {
      const [min, max] = paramRange(def);
      c = slider({ ...def, min, max, value: L.params[def.id], onInput });
    }
    settingsControls[def.id] = c;
    if (!def.group) {
      host.append(c.el);
      // A opacidade do efeito vem logo depois da direção.
      if (def.id === 'direction') host.append(opacity.el);
      continue;
    }
    let g = groups.get(def.group);
    if (!g) {
      const details = document.createElement('details');
      details.className = 'group';
      details.open = isGroupOpen(L.effect, def.group);
      details.addEventListener('toggle', () => groupOpen.set(def.group, details.open));
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

$('#btnResetParams').addEventListener('click', resetEffect);

/** Botões de ações extras do efeito (ex.: limpar pontos de luz). */
function effectActionButtons(L, cls) {
  return (L?.effect.actions || []).map((a) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = a.label;
    b.addEventListener('click', () => a.run(L, setPoints));
    return b;
  });
}

// ---- Pontos editados na foto (ex.: pontos de luz do filtro estrela) ----

const selectedPoints = () => {
  const L = state.selected;
  return state.showGuides && L && L.visible && L.effect.points ? L : null;
};

/** Troca a lista de pontos da camada, registrando no histórico. */
function setPoints(L, next, before = L.params[L.effect.points]) {
  const key = L.effect.points;
  if (JSON.stringify(before) === JSON.stringify(next)) { L.params[key] = next; return; }
  const apply = (v) => {
    L.params[key] = structuredClone(v);
    L.fxDirty = true;
    dirtyFrom(state.layers.indexOf(L));
  };
  apply(next);
  history.push({ undo: () => apply(before), redo: () => apply(next), bytes: 64 + next.length * 16 });
  updateHistoryButtons();
}

/** Índice do ponto mais perto de p (px da tela) dentro de `radius`, ou -1. */
function nearestPoint(L, p, radius = 24) {
  let best = -1, bestD = radius;
  L.params[L.effect.points].forEach(([ix, iy], i) => {
    const [sx, sy] = view.toScreen(ix, iy);
    const d = Math.hypot(sx - p[0], sy - p[1]);
    if (d <= bestD) { best = i; bestD = d; }
  });
  return best;
}

function resetEffect() {
  const L = state.selected;
  if (!L) return;
  L.params = defaultParams(L.effect);
  L.fxOpacity = 100;
  L.fxDirty = true;
  buildSettings();
  muiBuild();
  dirtyFrom(state.layers.indexOf(L));
}

// ---- Ponto de origem no histórico (Ctrl+Z / seta de voltar) ----

function beginOriginEdit() {
  const L = state.selected;
  if (!originEdit && L?.effect.originParams) originEdit = { layer: L, ox: L.params.ox, oy: L.params.oy };
}

function commitOriginEdit() {
  const e = originEdit;
  originEdit = null;
  if (!e) return;
  const L = e.layer;
  const before = { ox: e.ox, oy: e.oy };
  const after = { ox: L.params.ox, oy: L.params.oy };
  if (before.ox === after.ox && before.oy === after.oy) return;
  const apply = (o) => { for (const k in o) setParam(k, o[k], false, true, L); };
  history.push({ undo: () => apply(before), redo: () => apply(after) });
  updateHistoryButtons();
}

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
  label: 'Opacidade da máscara', min: 0, max: 100, value: 100, default: 100, unit: '%',
  tip: 'Quanto a área marcada protege a foto deste efeito. 100% = nenhum efeito na área marcada. Atalho: Shift + 1…0',
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

$('#maskInvert').addEventListener('click', () => maskOp((m) => masks.invert(m)));
$('#maskClear').addEventListener('click', () => maskOp((m) => masks.fill(m, 0)));

/** Operação na máscara da camada selecionada, registrada no histórico. */
function maskOp(fn) {
  const L = state.selected;
  if (!state.loaded || !L) { toast('Selecione um efeito para editar a máscara.'); return; }
  pushMaskEntry(L, fn(L.mask));
  L.mixDirty = true;
  requestRender();
}

function pushMaskEntry(L, r) {
  if (!r) return;
  const write = (data) => { if (L.destroyed) return; masks.writeRect(L.mask, r.rect, data); L.mixDirty = true; requestRender(); };
  history.push({ undo: () => write(r.before), redo: () => write(r.after), bytes: r.before.length + r.after.length });
  updateHistoryButtons();
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
  tip: 'Resolução usada para calcular os efeitos na tela. A exportação sempre usa a resolução total.',
  options: PREVIEW_OPTIONS,
  value: String(state.previewLong),
  onInput: (v) => setPreviewLong(v),
});
$('#previewParams').append(previewControl.el);

function setPreviewLong(v) {
  previewControl.set(String(v));
  state.previewLong = Number(v);
  muiRefresh();
  dirtyFrom(0);
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
const selectedOrigin = () => {
  const L = state.selected;
  return state.showGuides && L && L.visible && L.effect.originParams ? L : null;
};

// ---------------------------------------------------------------------------
// Overlay (alvo do ponto de origem, anéis da área nítida) e cursor do pincel
// ---------------------------------------------------------------------------

const ovCenter = $('#ovCenter');
const ovRings = $('#ovRings');

const ovPoints = $('#ovPoints');

// Botão do marcador (barra de cima): oculta o alvo do ponto de origem e os pontos de luz.
// Desligado, arrastar na foto só move a vista. A escolha fica salva neste aparelho.
const btnGuides = $('#btnGuides');
function setShowGuides(on) {
  state.showGuides = on;
  btnGuides.classList.toggle('on', on);
  btnGuides.setAttribute('aria-pressed', String(on));
  try { localStorage.setItem('elyfx-guides', on ? '1' : '0'); } catch { /* sem storage */ }
  requestRender();
}
btnGuides.addEventListener('click', () => setShowGuides(!state.showGuides));
try { if (localStorage.getItem('elyfx-guides') === '0') setShowGuides(false); } catch { /* sem storage */ }

function updateOverlay() {
  const L = selectedOrigin();
  const P = selectedPoints();
  // Sem ponto de origem nem pontos editáveis: arrastar move a vista, então o cursor vira a "mão".
  stage.classList.toggle('no-origin', !L && !P);
  overlay.style.display = state.loaded && ((L && L.effect.overlay) || P) ? '' : 'none';
  ovCenter.style.display = L ? '' : 'none';
  drawPointMarkers(P);
  if (!state.loaded || !L || !L.effect.overlay) { ovRings.replaceChildren(); return; }
  const o = L.effect.overlay(L.params, renderer.src.w, renderer.src.h);
  const [sx, sy] = view.toScreen(o.center[0], o.center[1]);
  ovCenter.setAttribute('transform', `translate(${sx.toFixed(1)} ${sy.toFixed(1)})`);
  const want = o.rings.length * 2;
  while (ovRings.childNodes.length < want) ovRings.append(document.createElementNS('http://www.w3.org/2000/svg', 'circle'));
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

/** Marcadores dos pontos de luz da camada selecionada. */
function drawPointMarkers(P) {
  const pts = state.loaded && P ? P.params[P.effect.points] : [];
  while (ovPoints.childNodes.length < pts.length) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.innerHTML = '<circle r="9" class="pt-dark"/><circle r="9" class="pt-light"/><circle r="2" class="pt-dot"/>';
    ovPoints.append(g);
  }
  while (ovPoints.childNodes.length > pts.length) ovPoints.lastChild.remove();
  pts.forEach(([ix, iy], i) => {
    const [sx, sy] = view.toScreen(ix, iy);
    const g = ovPoints.childNodes[i];
    g.setAttribute('transform', `translate(${sx.toFixed(1)} ${sy.toFixed(1)})`);
    g.classList.toggle('active', drag?.type === 'point' && drag.index === i);
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
// Interação no palco: ponto de origem, pincel, mover, zoom, pinça
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
      requestRender();
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
  } else if (e.button === 2 && state.tool === 'center' && selectedPoints()) {
    // Botão direito sobre um ponto de luz: remove.
    const P = selectedPoints();
    const i = nearestPoint(P, p);
    if (i >= 0) setPoints(P, P.params[P.effect.points].filter((_, k) => k !== i));
    drag = null;
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
  if (drag.type === 'paint') { masks.cancelStroke(); strokeLayer = null; state.live = false; dirtyFrom(0); }
  if (drag.type === 'center' && drag.before) {
    for (const k in drag.before) setParam(k, drag.before[k], false, true, drag.layer);
    originEdit = null;
  }
  if (drag.type === 'point') {
    drag.layer.params[drag.layer.effect.points] = drag.before;
    state.live = false;
    dirtyFrom(state.layers.indexOf(drag.layer));
  }
  if (drag.type === 'pan') setPanning(false);
}

/** Começa a ação da ferramenta atual no ponto p (mover origem, pintar ou, fora da foto, mover a vista). */
function startAction(p) {
  if (state.tool === 'center' && selectedPoints()) {
    // Efeito com pontos (filtro estrela): tocar num ponto arrasta; tocar fora cria um novo.
    const P = selectedPoints();
    const key = P.effect.points;
    const before = structuredClone(P.params[key]);
    const hit = nearestPoint(P, p);
    if (hit >= 0) { drag = { type: 'point', layer: P, index: hit, before }; return; }
    if (!insideImage(p)) { drag = { type: 'pan', last: p }; setPanning(true); return; }
    if (before.length >= MAX_STARS) { toast(`Máximo de ${MAX_STARS} pontos por efeito.`); return; }
    const [ix, iy] = view.toImage(p[0], p[1]);
    P.params[key] = [...structuredClone(before), [Math.round(ix), Math.round(iy)]];
    drag = { type: 'point', layer: P, index: P.params[key].length - 1, before };
    dirtyFrom(state.layers.indexOf(P));
    return;
  }
  if (state.tool === 'center') {
    const L = selectedOrigin();
    // Fora da foto, ou sem efeito com ponto de origem selecionado: move a vista.
    if (!insideImage(p) || !L) {
      drag = { type: 'pan', last: p };
      setPanning(true);
      return;
    }
    drag = { type: 'center', layer: L, before: { ox: L.params.ox, oy: L.params.oy } };
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
  } else if (drag.type === 'point') {
    const L = drag.layer;
    const [ix, iy] = view.toImage(p[0], p[1]);
    L.params[L.effect.points][drag.index] = [Math.round(ix), Math.round(iy)];
    state.live = true;
    dirtyFrom(state.layers.indexOf(L));
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
    if (pointers.size < 2) { drag = null; state.live = false; requestRender(); }
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
  if (drag.type === 'paint') endPaint();
  else if (drag.type === 'point') {
    const L = drag.layer;
    let next = L.params[L.effect.points];
    const [ix, iy] = next[drag.index] || [0, 0];
    // Arrastado para fora da foto: remove o ponto.
    if (ix < 0 || iy < 0 || ix > renderer.src.w || iy > renderer.src.h) {
      next = next.filter((_, i) => i !== drag.index);
      toast('Ponto removido', 1000);
    }
    state.live = false;
    setPoints(L, next, drag.before);
  } else if (drag.type === 'center') {
    state.live = false;
    commitOriginEdit();
    if (drag.layer) dirtyFrom(state.layers.indexOf(drag.layer));
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
  if (drag && drag.type !== 'pinch') { cancelSingleAction(); drag = null; requestRender(); }
  if (pointers.size > 1) gestureLock = true;
  endPointer(e);
});
stage.addEventListener('contextmenu', (e) => { if (state.loaded) e.preventDefault(); });
stage.addEventListener('pointerleave', () => { lastPointer = null; updateCursor(); });

function setPanning(on) {
  panning = on;
  stage.classList.toggle('panning', on);
  updateCursor();
}

function moveCenter(p, live) {
  const L = drag?.layer || selectedOrigin();
  if (!L) return;
  const [ix, iy] = view.toImage(p[0], p[1]);
  const o = L.effect.originParams(ix, iy, renderer.src.w, renderer.src.h);
  for (const k in o) setParam(k, o[k], live, true, L);
}

// --- Pincel ---

function beginPaint(p) {
  const L = state.selected;
  if (!L) {
    toast('Adicione ou selecione um efeito para pintar a máscara dele.', 2500);
    drag = { type: 'pan', last: p };
    setPanning(true);
    return;
  }
  const [ix, iy] = view.toImage(p[0], p[1]);
  strokeLayer = L;
  state.live = true;
  masks.beginStroke(state.tool === 'add' ? ADD : SUBTRACT);
  drag = { type: 'paint', x: ix, y: iy, carry: 0 };
  dabAt(ix, iy);
  requestRender();
}

function endPaint() {
  const L = strokeLayer;
  pushMaskEntry(L, masks.endStroke(L?.mask));
  strokeLayer = null;
  state.live = false;
  if (L) { L.mixDirty = true; dirtyFrom(state.layers.indexOf(L) + 1); }
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
  const k = masks.scale;
  masks.dab(ix * k, iy * k, (state.brush.size / 2) * k, state.brush.hardness / 100, state.brush.flow / 100);
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
  if (state.loaded && history.canUndo && !confirm('Abrir outra foto? As máscaras e o histórico atuais serão descartados (os efeitos continuam).')) return;
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
    history.clear();
    masks.init(w, h);
    // As camadas continuam; máscaras novas (vazias) no tamanho da foto e origem no centro.
    for (const L of state.layers) {
      masks.dispose(L.mask);
      L.mask = masks.create();
      if ('ox' in L.params) L.params.ox = 0;
      if ('oy' in L.params) L.params.oy = 0;
    }
    updateHistoryButtons();
    view.setSize(stage.clientWidth, stage.clientHeight);
    view.setImage(w, h);

    state.loaded = true;
    state.fileName = file.name.replace(/\.[^.]+$/, '') || 'foto';
    $('#dropzone').hidden = true;
    $('#zoombar').hidden = false;
    stage.classList.remove('empty');
    $('#btnExport').disabled = false;
    mui.classList.remove('disabled');
    buildSettings();
    layersChanged();
    muiBuild();
    if (mobileLayout.matches) muiSetTab(state.layers.length ? 'adjust' : 'layers', true);
    $('#imgInfo').textContent = `${state.fileName} — ${w} × ${h} px` + (masks.scale < 1 ? ` · máscaras ${masks.w} × ${masks.h} px` : '');
    updateZoomLabel();
    dirtyFrom(0);
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
const busy = () => drag?.type === 'paint' || drag?.type === 'center' || drag?.type === 'point';
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
  if ($('#exportDialog').open || presetDlg?.open) return;
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
  if (e.key === 'Escape') closeFxPopover();
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
    case 'KeyG': setShowGuides(!state.showGuides); return;
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
    const img = renderer.exportStack(state.layers, { lowMemory: coarse });
    requestRender();
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
//   abas Efeitos (camadas) / Ajustes (do efeito selecionado) / Máscara; painel translúcido com
//   os controles empilhados. Arrastar as abas para baixo recolhe o painel; para cima abre.
// ---------------------------------------------------------------------------

const mui = $('#mui');
const muiList = $('#muiList');
let muiTab = 'layers';
let muiOpen = false;
let muiPicking = false; // mostrando o menu "Adicionar efeito"
let muiRows = [];       // { it, ctl?, seg?, btn? }

const unitText = (u) => (u === '%' || u === '°' ? u : u ? ' ' + u : '');

function muiAdjustItems() {
  const L = state.selected;
  if (!L) return [];
  const items = [];
  const fxOpacity = { key: 'fxOpacity', label: 'Opacidade', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 100,
    get: () => L.fxOpacity, set: (v) => setFxOpacity(v) };
  const defs = visibleParams(L.effect, L.params);
  if (!defs.some((d) => d.id === 'direction')) items.push(fxOpacity);
  for (const def of defs) {
    const [min, max] = paramRange(def);
    items.push({
      key: def.id, label: def.group ? def.label : (def.chip || def.label), group: def.group,
      type: def.type, options: def.options, min, max, step: def.step, unit: unitText(unitOf(def)), track: def.track, log: def.log,
      default: def.default, get: () => L.params[def.id], set: (v, live) => onParamInput(def, v, live),
    });
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
    { key: 'show', label: 'Ver área', type: 'toggle', get: () => state.showMask, set: (v) => setShowMask(v) },
    { key: 'invert', label: 'Inverter', type: 'action', run: () => { maskOp((m) => masks.invert(m)); toast('Máscara invertida', 1200); } },
    { key: 'clear', label: 'Limpar', type: 'action', run: () => { maskOp((m) => masks.fill(m, 0)); toast('Máscara limpa', 1200); } },
    { key: 'size', label: 'Tamanho', type: 'range', min: 1, max: 3000, step: 1, unit: ' px', default: 250, log: true,
      get: () => state.brush.size, set: (v) => setBrush('size', v) },
    { key: 'hardness', label: 'Dureza', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 30,
      get: () => state.brush.hardness, set: (v) => setBrush('hardness', v) },
    { key: 'flow', label: 'Fluxo', type: 'range', min: 1, max: 100, step: 1, unit: '%', default: 100,
      get: () => state.brush.flow, set: (v) => setBrush('flow', v) },
    { key: 'maskOpacity', label: 'Opacidade da máscara', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 100,
      get: () => state.selected?.maskOpacity ?? 100, set: (v) => setMaskOpacity(v) },
  ];
}

function muiSegRow(it) {
  const row = document.createElement('div');
  row.className = 'mrow';
  const label = document.createElement('div');
  label.className = 'mrow-label';
  label.textContent = it.label;
  const seg = document.createElement('div');
  const long = it.options.length > 3 && it.options.some((o) => (o.short || o.label).length > 7);
  seg.className = 'mrow-seg' + (long ? ' scroll' : ''); // muitas opções longas: rolagem horizontal
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

function muiMessage(text, buttonLabel, onClick) {
  const box = document.createElement('div');
  box.className = 'mui-empty';
  const p = document.createElement('p');
  p.textContent = text;
  box.append(p);
  if (buttonLabel) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn primary';
    b.textContent = buttonLabel;
    b.addEventListener('click', onClick);
    box.append(b);
  }
  return box;
}

function muiOpenPicker() {
  if (!state.loaded) { toast('Abra uma foto primeiro.'); return; }
  muiPicking = true;
  muiSetTab('layers', true);
  muiBuild();
}

/** Monta o conteúdo da aba (troca de aba, de camada ou nova foto). */
function muiBuild() {
  muiReady = true;
  muiRows = [];
  const frag = document.createDocumentFragment();

  if (muiTab === 'layers') {
    if (muiPicking) {
      const head = document.createElement('div');
      head.className = 'mui-head';
      head.innerHTML = '<span>Adicionar efeito</span>';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'link-btn';
      cancel.textContent = 'Cancelar';
      cancel.addEventListener('click', () => { muiPicking = false; muiBuild(); });
      head.append(cancel);
      frag.append(head, buildFxPicker((fx) => { muiPicking = false; addLayer(fx); muiSetTab('adjust', true); }));
    } else {
      const row = document.createElement('div');
      row.className = 'mui-add-row';
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'btn primary mui-add';
      add.textContent = '+ Adicionar efeito';
      add.addEventListener('click', muiOpenPicker);
      const pre = document.createElement('button');
      pre.type = 'button';
      pre.className = 'btn mui-presets';
      pre.textContent = 'Presets';
      pre.addEventListener('click', openPresets);
      row.append(add, pre);
      const list = document.createElement('div');
      list.className = 'layer-list';
      renderLayerList(list, { onSelect: () => muiSetTab('adjust', true) });
      frag.append(row, list);
    }
    muiList.replaceChildren(frag);
    return;
  }

  if (muiTab === 'adjust' && !state.selected) {
    muiList.replaceChildren(muiMessage(
      state.layers.length ? 'Selecione um efeito na aba Efeitos para ajustar.' : 'Nenhum efeito aplicado ainda.',
      '+ Adicionar efeito', muiOpenPicker));
    return;
  }
  if (muiTab === 'mask' && !state.selected) {
    muiList.replaceChildren(muiMessage('A máscara pertence a um efeito. Adicione ou selecione um efeito primeiro.', '+ Adicionar efeito', muiOpenPicker));
    return;
  }

  if (muiTab === 'adjust') {
    const title = document.createElement('div');
    title.className = 'mui-head';
    title.innerHTML = '<span></span>';
    title.firstChild.textContent = state.selected.effect.name;
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'link-btn';
    reset.textContent = 'Redefinir';
    reset.addEventListener('click', resetEffect);
    title.append(reset);
    frag.append(title);
    if (state.selected.effect.hint) {
      const hint = document.createElement('p');
      hint.className = 'mui-hint';
      hint.textContent = state.selected.effect.hint;
      frag.append(hint);
    }
    const acts = effectActionButtons(state.selected, 'mbtn');
    if (acts.length) {
      const row = document.createElement('div');
      row.className = 'mrow-actions';
      row.append(...acts);
      frag.append(row);
    }
  }

  const items = muiTab === 'adjust' ? muiAdjustItems() : muiMaskItems();
  const groups = new Map();
  let actions = null;
  for (const it of items) {
    let node;
    if (it.type === 'range') {
      const ctl = touchSlider({ label: it.label, min: it.min, max: it.max, step: it.step, unit: it.unit || '',
        value: it.get(), default: it.default, log: it.log, track: it.track, onInput: (v, live) => it.set(v, live) });
      muiRows.push({ it, ctl });
      node = ctl.el;
    } else if (it.type === 'select') {
      const { row, seg } = muiSegRow(it);
      muiRows.push({ it, seg });
      node = row;
    } else if (it.type === 'color') {
      const cf = colorField({ label: it.label, value: it.get(), onInput: (v, live) => it.set(v, live), className: 'mrow mrow-color' });
      muiRows.push({ it, color: cf });
      node = cf.el;
    } else {
      if (!actions) {
        actions = document.createElement('div');
        actions.className = 'mrow-actions';
        frag.append(actions);
      }
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
        d.open = state.selected ? isGroupOpen(state.selected.effect, it.group) : false;
        d.addEventListener('toggle', () => groupOpen.set(it.group, d.open));
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
  muiList.replaceChildren(frag);
  muiRefresh();
}

/** Atualiza os valores mostrados (chamada sempre que algo muda, por qualquer caminho). */
function muiRefresh() {
  if (!muiReady) return;
  for (const r of muiRows) {
    if (r.ctl) r.ctl.set(r.it.get());
    if (r.color) r.color.set(r.it.get());
    if (r.seg) {
      for (const b of r.seg.children) b.classList.toggle('active', b.dataset.value === String(r.it.get()));
      // Na rolagem horizontal, mantém a opção escolhida visível.
      if (r.seg.classList.contains('scroll')) {
        const a = r.seg.querySelector('.active');
        if (a && (a.offsetLeft < r.seg.scrollLeft || a.offsetLeft + a.offsetWidth > r.seg.scrollLeft + r.seg.clientWidth)) {
          r.seg.scrollTo({ left: a.offsetLeft - 8, behavior: 'smooth' });
        }
      }
    }
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
    if (tab !== 'layers') muiPicking = false;
    if (changed || forceOpen) { muiBuild(); muiList.scrollTop = 0; }
  }
  muiApply();
}

function muiApply() {
  mui.classList.toggle('collapsed', !muiOpen);
  mui.classList.toggle('disabled', !state.loaded);
  // Painel recolhido: nenhuma aba fica marcada.
  for (const b of mui.querySelectorAll('.mtabs [data-tab]')) b.classList.toggle('active', muiOpen && b.dataset.tab === muiTab);
  // No celular a ferramenta segue a aba: Máscara = pincel; as outras = mover ponto de origem.
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

buildSettings();
layersChanged();
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
  if ((history.canUndo || state.layers.length) && !confirm('Atualizar agora? A edição atual será perdida. Exporte antes se quiser guardá-la.')) return;
  applyUpdate(latestVersion);
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
window.addEventListener('pageshow', (e) => { if (e.persisted) checkForUpdate(); });
window.addEventListener('online', checkForUpdate);
setInterval(checkForUpdate, 5 * 60 * 1000);
checkForUpdate();

// ---------------------------------------------------------------------------
// Presets: salvar a pilha de efeitos e reaplicar em outras fotos
// ---------------------------------------------------------------------------

const presetDlg = $('#presetDialog');
const ICON_APPLY = '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>';
const ICON_EXPORT = '<svg viewBox="0 0 24 24"><path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/></svg>';

$('#btnPresets').addEventListener('click', openPresets);
$('#presetClose').addEventListener('click', () => presetDlg.close());

function openPresets() {
  renderPresets();
  $('#presetName').value = '';
  presetDlg.showModal();
}

function renderPresets() {
  const host = $('#presetList');
  const list = loadPresets();
  host.replaceChildren();
  $('#presetSave').disabled = !state.layers.length;
  $('#presetName').placeholder = state.layers.length ? 'Nome do novo preset' : 'Adicione efeitos para salvar um preset';
  $('#presetExportAll').disabled = !list.length;
  if (!list.length) {
    const p = document.createElement('div');
    p.className = 'preset-empty';
    p.textContent = 'Nenhum preset salvo ainda.';
    host.append(p);
    return;
  }
  for (const pr of list.slice().reverse()) {
    const row = document.createElement('div');
    row.className = 'preset-row';
    const info = document.createElement('div');
    info.className = 'preset-info';
    const name = document.createElement('div');
    name.className = 'preset-name';
    name.textContent = pr.name;
    const meta = document.createElement('div');
    meta.className = 'preset-meta';
    const n = pr.layers.length;
    meta.textContent = `${n} efeito${n === 1 ? '' : 's'}`;
    info.append(name, meta);
    const apply = document.createElement('button');
    apply.className = 'btn primary small';
    apply.textContent = 'Aplicar';
    apply.addEventListener('click', () => { applyPreset(pr); presetDlg.close(); });
    const exp = document.createElement('button');
    exp.className = 'icon-btn';
    exp.title = 'Exportar este preset';
    exp.setAttribute('aria-label', 'Exportar ' + pr.name);
    exp.innerHTML = ICON_EXPORT;
    exp.addEventListener('click', () => exportPresets([pr], pr.name));
    const del = document.createElement('button');
    del.className = 'icon-btn del';
    del.title = 'Excluir';
    del.setAttribute('aria-label', 'Excluir ' + pr.name);
    del.innerHTML = ICON_DEL;
    del.addEventListener('click', () => {
      if (!confirm(`Excluir o preset “${pr.name}”?`)) return;
      savePresets(loadPresets().filter((p) => p.id !== pr.id));
      renderPresets();
    });
    row.append(info, apply, exp, del);
    host.append(row);
  }
}

function saveCurrentPreset() {
  if (!state.loaded || !state.layers.length) return;
  const list = loadPresets();
  const name = uniqueName($('#presetName').value || `Preset ${list.length + 1}`, list);
  list.push(makePreset(name, state.layers, { w: renderer.src.w, h: renderer.src.h }));
  if (!savePresets(list)) { toast('Não foi possível salvar: armazenamento do navegador cheio ou bloqueado.', 4000); return; }
  $('#presetName').value = '';
  renderPresets();
  toast(`Preset “${name}” salvo.`, 1800);
}
$('#presetSave').addEventListener('click', saveCurrentPreset);
$('#presetName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveCurrentPreset(); } });

/** Troca a pilha inteira (usado pelo preset e pelo desfazer). */
function setStack(next) {
  for (const L of state.layers) if (!next.includes(L)) renderer.disposeLayer(L);
  state.layers = next.slice();
  for (const L of state.layers) { L.fxDirty = true; L.mixDirty = true; }
  state.selected = null;
  selectLayer(state.layers[state.layers.length - 1] || null);
  layersChanged();
  dirtyFrom(0);
}

function applyPreset(pr) {
  if (!state.loaded) { toast('Abra uma foto para aplicar o preset.'); return; }
  const specs = presetToLayers(pr, { w: renderer.src.w, h: renderer.src.h });
  if (!specs.length) { toast('Este preset não tem efeitos compatíveis.'); return; }
  const before = state.layers.slice();
  const after = specs.map((s) => {
    const L = createLayer(s.effect);
    Object.assign(L.params, s.params);
    L.fxOpacity = s.fxOpacity;
    L.maskOpacity = s.maskOpacity;
    L.visible = s.visible;
    return L;
  });
  setStack(after);
  // Desfazer volta à pilha anterior; as camadas ficam guardadas enquanto o histórico precisar delas.
  const all = [...new Set([...before, ...after])];
  for (const L of all) L.refs++;
  history.push({
    undo: () => setStack(before),
    redo: () => setStack(after),
    dispose: () => { for (const L of all) { L.refs--; maybeDestroy(L); } },
  });
  updateHistoryButtons();
  if (mobileLayout.matches) muiSetTab('layers', true);
  toast(`Preset “${pr.name}” aplicado.`, 1800);
}

function exportPresets(list, name) {
  const blob = new Blob([presetsFile(list)], { type: 'application/json' });
  const safe = String(name || 'presets').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'presets';
  const fileName = `elyfx-${safe}.json`;
  const file = new File([blob], fileName, { type: 'application/json' });
  // No celular, o menu de compartilhar permite guardar o arquivo onde quiser (Arquivos, Drive…).
  if (coarse && navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file], title: fileName }).catch((err) => { if (err.name !== 'AbortError') downloadBlob(blob, fileName); });
  } else downloadBlob(blob, fileName);
}
$('#presetExportAll').addEventListener('click', () => exportPresets(loadPresets(), 'presets'));

$('#presetImport').addEventListener('click', () => $('#presetFile').click());
$('#presetFile').addEventListener('change', async () => {
  const f = $('#presetFile').files[0];
  $('#presetFile').value = '';
  if (!f) return;
  try {
    const incoming = parsePresetsFile(await f.text());
    const list = loadPresets();
    for (const p of incoming) list.push({ ...p, name: uniqueName(p.name, list) });
    if (!savePresets(list)) throw new Error('armazenamento do navegador cheio ou bloqueado');
    renderPresets();
    toast(`${incoming.length} preset${incoming.length === 1 ? '' : 's'} importado${incoming.length === 1 ? '' : 's'}.`, 2200);
  } catch (err) {
    toast('Não foi possível importar: ' + err.message, 4000);
  }
});

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
    `efeitos: ${state.layers.length}`,
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

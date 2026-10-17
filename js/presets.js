// Presets: a pilha de efeitos (ordem, parâmetros, opacidades e visibilidade) salva para reaplicar
// em outras fotos. Ficam no armazenamento local do navegador e podem ser exportados/importados
// como arquivo .json (para não se perderem ao limpar os dados do navegador).
//
// As máscaras não entram: dependem de cada foto. Medidas que dependem da foto são guardadas de
// forma relativa e convertidas ao aplicar:
//   - pontos (ex.: pontos de luz) → fração da largura/altura;
//   - ponto de origem (ox/oy)     → fração de meia largura/altura;
//   - demais medidas em px        → escaladas pelo lado maior da foto.

import { effects } from './effects/index.js';

const KEY = 'elyfx-presets';
const FILE_KIND = 'elyfx-presets';

export function loadPresets() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter(isPreset) : [];
  } catch {
    return [];
  }
}

export function savePresets(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

function isPreset(p) {
  return p && typeof p.name === 'string' && Array.isArray(p.layers);
}

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

/** Cria um preset a partir das camadas atuais (de baixo para cima) e do tamanho da foto. */
export function makePreset(name, layers, img) {
  return {
    id: newId(),
    name,
    created: Date.now(),
    refLong: Math.max(img.w, img.h),
    layers: layers.map((L) => {
      const params = {};
      for (const d of L.effect.params) {
        let v = L.params[d.id];
        if (d.type === 'points') v = (v || []).map(([x, y]) => [round4(x / img.w), round4(y / img.h)]);
        else if (d.id === 'ox') v = round4(v / (img.w / 2));
        else if (d.id === 'oy') v = round4(v / (img.h / 2));
        params[d.id] = v;
      }
      return { effect: L.effect.id, params, fxOpacity: L.fxOpacity, maskOpacity: L.maskOpacity, visible: L.visible };
    }),
  };
}

/** Converte um preset para a foto atual: [{ effect, params, fxOpacity, maskOpacity, visible }]. */
export function presetToLayers(preset, img) {
  const k = Math.max(img.w, img.h) / (preset.refLong || Math.max(img.w, img.h));
  const out = [];
  for (const s of preset.layers) {
    const effect = effects.find((e) => e.id === s.effect);
    if (!effect) continue; // efeito de uma versão futura/antiga: ignora
    const params = {};
    for (const d of effect.params) {
      const v = s.params?.[d.id];
      if (v === undefined) continue;
      if (d.type === 'points') {
        if (Array.isArray(v)) params[d.id] = v.filter(isPair).map(([x, y]) => [Math.round(x * img.w), Math.round(y * img.h)]);
      } else if (d.id === 'ox' || d.id === 'oy') {
        const half = (d.id === 'ox' ? img.w : img.h) / 2;
        if (Number.isFinite(v)) params[d.id] = Math.round(Math.max(-half, Math.min(half, v * half)));
      } else if (d.type === 'range') {
        if (!Number.isFinite(v)) continue;
        const scaled = d.unit === 'px' ? v * k : v;
        const stepped = Math.round(scaled / (d.step || 1)) * (d.step || 1);
        params[d.id] = Math.max(d.min, Math.min(d.max, Number(stepped.toFixed(4))));
      } else if (d.type === 'select') {
        if (d.options.some((o) => o.value === v)) params[d.id] = v;
      } else if (d.type === 'color') {
        if (/^#[0-9a-f]{6}$/i.test(v)) params[d.id] = v;
      }
    }
    out.push({
      effect, params,
      fxOpacity: clamp100(s.fxOpacity, 100),
      maskOpacity: clamp100(s.maskOpacity, 100),
      visible: s.visible !== false,
    });
  }
  return out;
}

/** Conteúdo do arquivo de exportação. */
export function presetsFile(list) {
  return JSON.stringify({ kind: FILE_KIND, version: 1, exported: new Date().toISOString(), presets: list }, null, 2);
}

/** Lê um arquivo exportado (ou um preset avulso) e devolve presets válidos com ids novos. */
export function parsePresetsFile(text) {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data?.kind === FILE_KIND ? data.presets : isPreset(data) ? [data] : null;
  if (!Array.isArray(list)) throw new Error('Arquivo não é um preset do ELY FX.');
  return list.filter(isPreset).map((p) => ({ ...p, id: newId() }));
}

/** Nome único dentro da lista ("Nome", "Nome (2)", …). */
export function uniqueName(name, list) {
  const base = (name || 'Preset').trim().slice(0, 60) || 'Preset';
  const names = new Set(list.map((p) => p.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} (${i})`)) i++;
  return `${base} (${i})`;
}

function round4(v) { return Math.round(v * 10000) / 10000; }
function isPair(p) { return Array.isArray(p) && p.length === 2 && p.every(Number.isFinite); }
function clamp100(v, d) { return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : d; }

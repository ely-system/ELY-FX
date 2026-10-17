// Registro de efeitos. Para adicionar um novo efeito, crie um módulo com a mesma forma dos
// existentes (id, name, group, params, render e, opcionalmente, overlay/origin/originParams)
// e inclua-o nesta lista. O menu "Adicionar efeito" agrupa pelos nomes em GROUPS.
//
// render(r, input, w, h, params, target, img):
//   input  = { tex, w, h } — resultado das camadas de baixo (ou a foto original, com mipmaps)
//   w, h   = resolução em que o efeito é calculado (prévia ou total)
//   target = alvos de trabalho (target(0), target(1), …) nessa resolução
//   img    = { w, h } da foto original, para medidas em "px da foto"
// Devolve a textura com o efeito aplicado (pode ser input.tex se não houver o que fazer).
import { radialBlur } from './radialBlur.js';
import { zoomBlur } from './zoomBlur.js';
import { directionalBlur } from './directionalBlur.js';
import { gaussianBlur } from './gaussianBlur.js';
import { noise } from './noise.js';
import { pixelate } from './pixelate.js';

export const effects = [radialBlur, zoomBlur, directionalBlur, gaussianBlur, noise, pixelate];

export const GROUPS = ['Desfoques', 'Estilização'];

export function effectsByGroup() {
  return GROUPS.map((name) => ({ name, items: effects.filter((e) => e.group === name) }));
}

export function defaultParams(effect) {
  return Object.fromEntries(effect.params.map((p) => [p.id, p.default]));
}

/** Parâmetros visíveis agora (alguns só aparecem conforme outros, ex.: cor do ruído tonalizado). */
export function visibleParams(effect, params) {
  return effect.params.filter((d) => !d.showIf || d.showIf(params));
}

// Registro de efeitos. Para adicionar um novo efeito, crie um módulo com a mesma forma dos
// existentes (id, name, params, render e, opcionalmente, overlay/origin/originParams)
// e inclua-o nesta lista.
import { radialBlur } from './radialBlur.js';
import { zoomBlur } from './zoomBlur.js';

export const effects = [radialBlur, zoomBlur];

export function defaultParams(effect) {
  return Object.fromEntries(effect.params.map((p) => [p.id, p.default]));
}

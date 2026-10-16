// Registro de efeitos. Para adicionar um novo efeito, crie um módulo com a mesma forma de
// `radialBlur` (id, name, params, render, overlay opcional) e inclua-o nesta lista.
import { radialBlur } from './radialBlur.js';

export const effects = [radialBlur];

export function defaultParams(effect) {
  return Object.fromEntries(effect.params.map((p) => [p.id, p.default]));
}

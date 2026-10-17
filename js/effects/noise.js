// Ruído / granulado (como Filtro > Ruído > Adicionar Ruído do Photoshop, com opção de grão maior).
//
// 1) Gera um ruído FINO: um valor aleatório por pixel da foto (fixo para cada pixel, nos três canais).
// 2) "Tamanho do grão" suaviza esse ruído com um desfoque gaussiano e reequilibra a intensidade.
//    Assim o grão engrossa no próprio lugar — sem a sensação de uma textura sendo ampliada a partir
//    de um canto — como o granulado do Lightroom.
// O padrão é calculado em coordenadas da FOTO, então é o mesmo na prévia e na exportação. Na prévia,
// quando cada pixel da tela cobre vários grãos, a intensidade é atenuada para parecer com o resultado
// final visto de longe.

import { hexToRgb } from '../ui.js';
import { gaussianBlur } from './gaussianBlur.js';

// Campo de ruído: valor por pixel da foto, guardado como 0.5 + n·0.2 (funciona também em 8 bits).
const FIELD_FS = `#version 300 es
precision highp float;
uniform vec2 uRes;      // resolução do passe (px)
uniform vec2 uImg;      // tamanho da foto (px)
uniform int uDist;      // 0 uniforme, 1 gaussiana
uniform float uSeed;
out vec4 outColor;

float hash(vec2 p, float k) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031 + k * 0.1373);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Valor aleatório com desvio padrão ~1.
float cellNoise(vec2 c, float k) {
  if (uDist == 1) {
    float s = hash(c, k) + hash(c, k + 1.7) + hash(c, k + 3.1) + hash(c, k + 4.9);
    return (s - 2.0) * 1.7320508;
  }
  return (hash(c, k) - 0.5) * 3.4641016;
}

void main() {
  vec2 cell = floor(gl_FragCoord.xy / uRes * uImg) + uSeed * 97.0;
  vec3 n = vec3(cellNoise(cell, 0.0), cellNoise(cell, 11.0), cellNoise(cell, 23.0));
  outColor = vec4(0.5 + n * 0.2, 1.0);
}`;

const APPLY_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform sampler2D uField;
uniform vec2 uRes;
uniform float uLod;
uniform int uType;      // 0 RGB, 1 monocromático, 2 tonalizado
uniform float uNorm;    // devolve ao ruído suavizado a mesma intensidade do fino
uniform float uSigma;   // intensidade (desvio padrão, 0..1)
uniform vec3 uTint;     // cor do ruído tonalizado (luminância 1)
out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 col = textureLod(uTex, uv, uLod);
  vec3 n = (texture(uField, uv).rgb - 0.5) / 0.2 * uNorm;
  if (uType == 1) n = vec3(n.r);
  else if (uType == 2) n = n.r * uTint;
  outColor = vec4(col.rgb + n * uSigma, col.a);
}`;

/** Cor do ruído tonalizado, normalizada para luminância 1 (a intensidade vem da Quantidade). */
function tintFromHex(hex) {
  const rgb = hexToRgb(hex) || [1, 1, 1];
  const luma = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return rgb.map((c) => c / Math.max(0.05, luma));
}

const isTint = (p) => p.type === 'tint';

export const noise = {
  id: 'noise',
  name: 'Ruído / Granulado',
  group: 'Estilização',
  params: [
    { id: 'type', type: 'select', label: 'Tipo', default: 'mono',
      options: [{ value: 'rgb', label: 'RGB' }, { value: 'mono', label: 'Monocromático', short: 'Mono' }, { value: 'tint', label: 'Tonalizado' }] },
    // A cor aparece logo abaixo do tipo quando ele é Tonalizado.
    { id: 'color', type: 'color', label: 'Cor do ruído', default: '#E8A04C', showIf: isTint },
    { id: 'amount', type: 'range', label: 'Quantidade', min: 0, max: 100, step: 1, default: 20, unit: '%' },
    { id: 'size', type: 'range', label: 'Tamanho do grão', chip: 'Grão', min: 1, max: 10, step: 0.1, default: 1, unit: 'px',
      tip: 'Grãos maiores ficam mais suaves, como granulado de filme.' },
    { id: 'dist', type: 'select', label: 'Distribuição', default: 'gauss',
      options: [{ value: 'uniform', label: 'Uniforme' }, { value: 'gauss', label: 'Gaussiana' }] },
    { id: 'seed', type: 'range', label: 'Variação', min: 1, max: 100, step: 1, default: 1,
      tip: 'Muda o padrão aleatório do ruído.' },
  ],

  render(r, src, w, h, p, target, img) {
    if (p.amount <= 0) return src.tex;
    // Na prévia, cada pixel cobre (img.w / w) px da foto: grãos menores que isso se misturam.
    const pxPerPreview = img.w / w;
    const atten = Math.min(1, p.size / pxPerPreview);

    // 1) ruído fino (um valor por pixel da foto)
    const field = r.scratch('noise-field', w, h);
    r.pass(r.program(FIELD_FS), field, { uRes: [w, h], uImg: [img.w, img.h], uDist: p.dist === 'uniform' ? 0 : 1, uSeed: p.seed });

    // 2) tamanho do grão = suavização no lugar (desvio padrão em px da foto)
    const sigmaImg = Math.max(0, p.size - 1) * 0.6;
    const blurred = sigmaImg > 0 ? gaussianBlur.render(r, { tex: field.tex, w, h }, w, h, { radius: sigmaImg }, target, img) : field.tex;
    // Ruído branco suavizado por uma gaussiana de σ px perde intensidade ≈ 1/(2√π·σ): compensa.
    const sigmaPx = sigmaImg / pxPerPreview;
    const norm = Math.max(1, 3.5449 * sigmaPx);

    // 3) aplica na foto
    const out = blurred === target(0).tex ? target(1) : target(0);
    r.pass(r.program(APPLY_FS), out, {
      uTex: src.tex, uField: blurred, uRes: [w, h],
      uLod: Math.max(0, Math.log2(Math.max(src.w / w, src.h / h))),
      uType: p.type === 'rgb' ? 0 : p.type === 'mono' ? 1 : 2,
      uNorm: norm, uSigma: (p.amount / 100) * 0.25 * atten, uTint: tintFromHex(p.color),
    });
    return out.tex;
  },
};

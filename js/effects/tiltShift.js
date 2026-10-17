// Tilt-shift: uma faixa nítida (ou um círculo) e desfoque que cresce aos poucos fora dela,
// como as lentes basculantes — deixa cenas grandes parecendo miniaturas.
//
// O desfoque progressivo mistura três níveis: a foto, um desfoque de 1/3 do raio e o desfoque total.

import { gaussianBlur } from './gaussianBlur.js';
import { originDefs, originAt, originParamsAt } from './radialCommon.js';

const COPY_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
out vec4 outColor;
void main() { outColor = texture(uTex, gl_FragCoord.xy / uRes); }`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform sampler2D uB1;     // desfoque de 1/3
uniform sampler2D uB2;     // desfoque total
uniform vec2 uRes;
uniform vec2 uImg;
uniform float uLod;
uniform int uShape;        // 0 faixa, 1 círculo
uniform vec2 uCenter;      // px da foto
uniform vec2 uNormal;      // normal da faixa (perpendicular a ela)
uniform float uBand;       // meia largura da área nítida (px da foto)
uniform float uFeather;    // largura da transição até o desfoque total (px da foto)
uniform float uSat;        // reforço de saturação (efeito miniatura)
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = uv * uImg;
  vec2 d = p - uCenter;
  float dist = uShape == 0 ? abs(dot(d, uNormal)) : length(d);
  float m = clamp((dist - uBand) / max(uFeather, 1.0), 0.0, 1.0);
  m = m * m * (3.0 - 2.0 * m);
  vec4 c0 = textureLod(uTex, uv, uLod);
  vec4 c1 = texture(uB1, uv);
  vec4 c2 = texture(uB2, uv);
  vec4 c = m < 0.5 ? mix(c0, c1, m * 2.0) : mix(c1, c2, m * 2.0 - 1.0);
  float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  c.rgb = mix(vec3(l), c.rgb, 1.0 + uSat);
  outColor = c;
}`;

const isBand = (p) => p.shape === 'band';

export const tiltShift = {
  id: 'tilt-shift',
  name: 'Tilt-shift',
  group: 'Desfoques',
  description:
    'Mantém nítida só uma faixa (ou um círculo) e desfoca o resto aos poucos, como as lentes tilt-shift. Em fotos de cima — cidades, ruas, praias, eventos — a cena parece uma maquete em miniatura.\n\nArraste o alvo para posicionar a área nítida e use Ângulo, Área nítida e Transição para ajustá-la. Um pouco de Saturação reforça o visual de miniatura.',
  params: [
    { id: 'shape', type: 'select', label: 'Formato', default: 'band',
      options: [{ value: 'band', label: 'Faixa' }, { value: 'circle', label: 'Círculo' }] },
    { id: 'blur', type: 'range', label: 'Desfoque', min: 0, max: 150, step: 0.5, default: 20, unit: 'px' },
    { id: 'band', type: 'range', label: 'Área nítida', min: 0, max: 100, step: 1, default: 15, unit: '%',
      tip: 'Tamanho da área sem desfoque (em % da altura da foto).' },
    { id: 'feather', type: 'range', label: 'Transição', min: 1, max: 100, step: 1, default: 30, unit: '%',
      tip: 'Distância até o desfoque total (em % da altura da foto).' },
    { id: 'angle', type: 'range', label: 'Ângulo', min: -90, max: 90, step: 1, default: 0, unit: '°', showIf: isBand },
    { id: 'sat', type: 'range', label: 'Saturação', min: 0, max: 100, step: 1, default: 15, unit: '%',
      tip: 'Cores mais vivas, que reforçam o visual de miniatura.' },
    ...originDefs(),
  ],

  origin: originAt,
  originParams: originParamsAt,
  overlay(p, w, h) {
    const c = originAt(p, w, h);
    const band = (p.band / 100) * h * 0.5;
    const edge = band + (p.feather / 100) * h * 0.5;
    if (!isBand(p)) return { center: c, rings: band > 0 ? [band, edge] : [edge] };
    // Linhas dos limites da área nítida (tracejadas) e do desfoque total (contínuas).
    const a = (p.angle * Math.PI) / 180;
    const t = [Math.cos(a), -Math.sin(a)];       // direção da faixa
    const n = [-t[1], t[0]];                     // normal
    const L = Math.hypot(w, h);
    const line = (off, solid) => [c[0] + n[0] * off - t[0] * L, c[1] + n[1] * off - t[1] * L,
      c[0] + n[0] * off + t[0] * L, c[1] + n[1] * off + t[1] * L, solid];
    return { center: c, rings: [], lines: [line(band, false), line(-band, false), line(edge, true), line(-edge, true)] };
  },

  render(r, src, w, h, p, target, img) {
    if (p.blur <= 0) return src.tex;
    // Desfoque de 1/3 guardado à parte (o segundo desfoque reutiliza os mesmos alvos).
    const b1src = gaussianBlur.render(r, src, w, h, { radius: p.blur / 3 }, target, img);
    const b1 = r.scratch('tilt-b1', w, h);
    r.pass(r.program(COPY_FS), b1, { uTex: b1src, uRes: [w, h] });
    const b2 = gaussianBlur.render(r, src, w, h, { radius: p.blur }, target, img);
    const out = b2 === target(0).tex ? target(1) : target(0);
    const a = (p.angle * Math.PI) / 180;
    r.pass(r.program(FS), out, {
      uTex: src.tex, uB1: b1.tex, uB2: b2, uRes: [w, h], uImg: [img.w, img.h],
      uLod: Math.max(0, Math.log2(Math.max(src.w / w, src.h / h))),
      uShape: isBand(p) ? 0 : 1, uCenter: originAt(p, img.w, img.h),
      uNormal: [Math.sin(a), Math.cos(a)],
      uBand: (p.band / 100) * img.h * 0.5, uFeather: (p.feather / 100) * img.h * 0.5,
      uSat: p.sat / 100,
    });
    return out.tex;
  },
};

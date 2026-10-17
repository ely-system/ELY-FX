// Aberração cromática: as cores se separam nas bordas, como em lentes simples.
// Radial: a separação cresce do ponto de origem para as bordas (aberração lateral de lente).
// Deslocamento: as cores se separam igualmente numa direção (estilo glitch/3D).

import { originDefs, originAt, originParamsAt } from './radialCommon.js';

const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform vec2 uImg;
uniform float uLod;
uniform int uMode;       // 0 radial, 1 deslocamento
uniform vec2 uCenter;    // px da foto
uniform float uAmount;   // px da foto (nas bordas, no modo radial)
uniform vec2 uDir;       // direção (modo deslocamento)
uniform float uClean;    // raio sem aberração (0..1 da meia-diagonal)
uniform int uColors;     // 0 vermelho/ciano, 1 roxo/verde, 2 azul/amarelo, 3 espectro
out vec4 outColor;

vec4 at(vec2 ip) { return textureLod(uTex, clamp(ip / uImg, 0.0, 1.0), uLod); }

// Cor do espectro (0..1 → vermelho..violeta) com soma ~1 por canal ao longo das amostras.
vec3 spectrum(float t) {
  return clamp(vec3(1.5 - abs(t * 3.0 - 0.5) * 1.5, 1.5 - abs(t * 3.0 - 1.5) * 1.5, 1.5 - abs(t * 3.0 - 2.5) * 1.5), 0.0, 1.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = uv * uImg;
  vec2 off;
  if (uMode == 0) {
    vec2 d = p - uCenter;
    float hd = 0.5 * length(uImg);
    float r = length(d) / hd;
    float k = smoothstep(uClean, uClean + 0.6 * (1.0 - uClean) + 1e-3, r);
    off = d / max(length(d), 1e-3) * uAmount * r * k;
  } else {
    off = uDir * uAmount;
  }
  vec4 base = at(p);
  vec3 col;
  if (uColors == 3) {
    vec3 acc = vec3(0.0), wsum = vec3(0.0);
    for (int i = 0; i < 9; i++) {
      float t = float(i) / 8.0;
      vec3 w = spectrum(t);
      acc += at(p + off * (t - 0.5) * 2.0).rgb * w;
      wsum += w;
    }
    col = acc / wsum;
  } else {
    // Peso de cada canal no deslocamento: um lado vai para fora, o outro para dentro.
    vec3 k = uColors == 0 ? vec3(1.0, -1.0, -1.0) : uColors == 1 ? vec3(-1.0, 1.0, -1.0) : vec3(-1.0, -1.0, 1.0);
    col = vec3(at(p + off * k.r).r, at(p + off * k.g).g, at(p + off * k.b).b);
  }
  outColor = vec4(col, base.a);
}`;

const isRadial = (p) => p.mode === 'radial';

export const chromaticAberration = {
  id: 'chromatic-aberration',
  name: 'Aberração cromática',
  group: 'Luz e lente',
  description:
    'Separa as cores nas bordas dos objetos, como acontece em lentes simples, antigas ou muito abertas: aparecem franjas vermelhas, ciano, roxas ou verdes.\n\nRadial imita a lente: nada no centro e mais separação nas bordas — arraste o alvo para mudar o centro. Deslocamento separa as cores igualmente numa direção, num visual mais gráfico (3D anáglifo, glitch).',
  params: [
    { id: 'mode', type: 'select', label: 'Tipo', default: 'radial',
      options: [{ value: 'radial', label: 'Radial (lente)', short: 'Radial' }, { value: 'shift', label: 'Deslocamento' }] },
    { id: 'colors', type: 'select', label: 'Cores', default: 'rc',
      options: [
        { value: 'rc', label: 'Vermelho / Ciano', short: 'Verm./Ciano' }, { value: 'pg', label: 'Roxo / Verde', short: 'Roxo/Verde' },
        { value: 'by', label: 'Azul / Amarelo', short: 'Azul/Amar.' }, { value: 'spec', label: 'Espectro (arco-íris)', short: 'Espectro' },
      ] },
    { id: 'amount', type: 'range', label: 'Intensidade', min: 0, max: 80, step: 0.5, default: 8, unit: 'px',
      tip: 'Separação das cores (nas bordas da foto, no tipo Radial).' },
    { id: 'clean', type: 'range', label: 'Área limpa', min: 0, max: 90, step: 1, default: 20, unit: '%', showIf: isRadial,
      tip: 'Região em volta do centro sem aberração.' },
    { id: 'angle', type: 'range', label: 'Ângulo', min: -180, max: 180, step: 1, default: 0, unit: '°', showIf: (p) => !isRadial(p) },
    ...originDefs(),
  ],

  origin: originAt,
  originParams: originParamsAt,
  overlay(p, w, h) {
    const half = 0.5 * Math.hypot(w, h);
    return { center: originAt(p, w, h), rings: isRadial(p) && p.clean > 0 ? [(p.clean / 100) * half] : [] };
  },

  render(r, src, w, h, p, target, img) {
    if (p.amount <= 0) return src.tex;
    const out = target(0);
    const a = (p.angle * Math.PI) / 180;
    r.pass(r.program(FS), out, {
      uTex: src.tex, uRes: [w, h], uImg: [img.w, img.h],
      uLod: Math.max(0, Math.log2(Math.max(src.w / w, src.h / h))),
      uMode: isRadial(p) ? 0 : 1, uCenter: originAt(p, img.w, img.h), uAmount: p.amount,
      uDir: [Math.cos(a), -Math.sin(a)], uClean: p.clean / 100,
      uColors: ({ rc: 0, pg: 1, by: 2, spec: 3 })[p.colors] ?? 0,
    });
    return out.tex;
  },
};

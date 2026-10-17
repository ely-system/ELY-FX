// Dreamy glow: uma cópia desfocada (gaussiano) da foto mesclada por cima — tipo Sonho (Tela) ou Leve (Clarear),
// com intensidade entre 10% e 80%. Em "Só as luzes", apenas as áreas acima do limite de brilho
// geram o brilho difuso, como o "bloom" de lentes e filtros de difusão.

import { gaussianBlur } from './gaussianBlur.js';

const EXTRACT_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uLod;
uniform float uThreshold;
out vec4 outColor;
void main() {
  vec4 c = textureLod(uTex, gl_FragCoord.xy / uRes, uLod);
  float l = dot(clamp(c.rgb, 0.0, 1.0), vec3(0.2126, 0.7152, 0.0722));
  outColor = vec4(c.rgb * smoothstep(uThreshold - 0.12, uThreshold + 0.12, l), c.a);
}`;

const BLEND_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform sampler2D uGlow;
uniform vec2 uRes;
uniform float uLod;
uniform int uMode;      // 0 tela, 1 clarear
uniform float uAmount;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 src = textureLod(uTex, uv, uLod);
  vec3 base = clamp(src.rgb, 0.0, 1.0);
  vec3 g = clamp(texture(uGlow, uv).rgb, 0.0, 1.0);
  vec3 res = uMode == 0 ? 1.0 - (1.0 - base) * (1.0 - g) : max(base, g);
  outColor = vec4(mix(base, res, uAmount), src.a);
}`;

const onlyLights = (p) => p.area === 'lights';

export const dreamyGlow = {
  id: 'dreamy-glow',
  name: 'Dreamy glow',
  group: 'Estilização',
  params: [
    { id: 'expansion', type: 'range', label: 'Expansão', min: 0, max: 100, step: 1, default: 40, unit: '%',
      tip: 'Quanto o brilho se espalha (100% = desfoque de 100 px).' },
    { id: 'amount', type: 'range', label: 'Intensidade', min: 10, max: 80, step: 1, default: 40, unit: '%' },
    { id: 'mode', type: 'select', label: 'Tipo', default: 'screen',
      tip: 'Sonho: brilho enevoado (mesclagem Tela). Leve: só clareia onde o brilho é mais claro (Clarear).',
      options: [{ value: 'screen', label: 'Sonho' }, { value: 'lighten', label: 'Leve' }] },
    { id: 'area', type: 'select', label: 'Área', default: 'all',
      options: [{ value: 'all', label: 'Toda a foto' }, { value: 'lights', label: 'Só as luzes' }] },
    { id: 'threshold', type: 'range', label: 'Limite das luzes', chip: 'Limite', min: 0, max: 100, step: 1, default: 65, unit: '%',
      showIf: onlyLights, tip: 'Só áreas mais claras que este valor geram o brilho.' },
  ],

  render(r, src, w, h, p, target, img) {
    const lod = Math.max(0, Math.log2(Math.max(src.w / w, src.h / h)));
    // Fonte do brilho: a foto inteira ou só as luzes (num alvo auxiliar, para não colidir com os do desfoque).
    let glowSrc = src;
    if (onlyLights(p)) {
      const ex = r.scratch('glow-src', w, h);
      r.pass(r.program(EXTRACT_FS), ex, { uTex: src.tex, uRes: [w, h], uLod: lod, uThreshold: p.threshold / 100 });
      glowSrc = { tex: ex.tex, w, h };
    }
    // Expansão: 0–100% → desfoque de 0 a 100 px da foto.
    const blurred = gaussianBlur.render(r, glowSrc, w, h, { radius: p.expansion }, target, img);
    // O desfoque devolve target(1) (raio pequeno) ou um alvo reduzido; a mistura vai para um alvo livre.
    const out = blurred === target(0).tex ? target(1) : target(0);
    r.pass(r.program(BLEND_FS), out, {
      uTex: src.tex, uGlow: blurred, uRes: [w, h], uLod: lod,
      uMode: p.mode === 'lighten' ? 1 : 0, uAmount: p.amount / 100,
    });
    return out.tex;
  },
};

// Duotone: a luminosidade da foto vira um degradê entre duas cores (sombras → luzes).

import { hexToRgb } from '../ui.js';

const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uLod;
uniform vec3 uShadow;
uniform vec3 uLight;
uniform float uContrast;  // -1..1
uniform float uBalance;   // -1..1 (positivo puxa para a cor das luzes)
out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 src = textureLod(uTex, uv, uLod);
  float t = dot(clamp(src.rgb, 0.0, 1.0), vec3(0.2126, 0.7152, 0.0722));
  // Equilíbrio: desloca os meios-tons para uma das cores (curva de gama).
  t = pow(t, exp2(-uBalance * 1.5));
  if (uContrast >= 0.0) t = mix(t, t * t * (3.0 - 2.0 * t), uContrast);
  t = clamp(0.5 + (t - 0.5) * (1.0 + 0.6 * uContrast), 0.0, 1.0);
  outColor = vec4(mix(uShadow, uLight, t), src.a);
}`;

export const duotone = {
  id: 'duotone',
  name: 'Duotone',
  group: 'Cor',
  description:
    'Transforma a foto em um degradê entre duas cores: as sombras ganham uma cor e as luzes outra.\n\nUse o Equilíbrio para puxar os meios-tons para um dos lados e o Contraste para separar mais as duas cores. Muito usado em pôsteres e capas.',
  params: [
    { id: 'shadow', type: 'color', label: 'Cor das sombras', default: '#1D2B6B' },
    { id: 'light', type: 'color', label: 'Cor das luzes', default: '#FFB46A' },
    { id: 'contrast', type: 'range', label: 'Contraste', min: -100, max: 100, step: 1, default: 0 },
    { id: 'balance', type: 'range', label: 'Equilíbrio', min: -100, max: 100, step: 1, default: 0,
      tip: 'Puxa os meios-tons para a cor das sombras (−) ou das luzes (+).' },
  ],

  render(r, src, w, h, p, target) {
    const out = target(0);
    r.pass(r.program(FS), out, {
      uTex: src.tex, uRes: [w, h], uLod: Math.max(0, Math.log2(Math.max(src.w / w, src.h / h))),
      uShadow: hexToRgb(p.shadow) || [0, 0, 0], uLight: hexToRgb(p.light) || [1, 1, 1],
      uContrast: p.contrast / 100, uBalance: p.balance / 100,
    });
    return out.tex;
  },
};

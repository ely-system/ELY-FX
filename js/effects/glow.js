// Glow: as luzes da foto ficam mais fortes e com um leve desfoque em volta (bloom).
// Diferente do Dreamy glow (que espalha a foto inteira), aqui só as áreas claras brilham,
// e o brilho é somado à foto.

import { blurredLights } from './bloomCommon.js';

const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform sampler2D uGlow;
uniform sampler2D uLights;
uniform vec2 uRes;
uniform float uLod;
uniform float uAmount;   // força do brilho
uniform float uBoost;    // reforço das próprias luzes
uniform float uSat;      // saturação do brilho (0 = branco, 1 = cor original)
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 src = textureLod(uTex, uv, uLod);
  vec3 g = texture(uGlow, uv).rgb;
  vec3 l = texture(uLights, uv).rgb;
  float gl = dot(g, vec3(0.2126, 0.7152, 0.0722));
  g = mix(vec3(gl), g, uSat);
  vec3 col = clamp(src.rgb + l * uBoost, 0.0, 1.0);
  // Brilho em modo Tela: clareia em volta das luzes sem estourar em branco chapado.
  col = 1.0 - (1.0 - col) * (1.0 - clamp(g * uAmount, 0.0, 1.0));
  outColor = vec4(col, src.a);
}`;

export const glow = {
  id: 'glow',
  name: 'Glow',
  group: 'Luz e lente',
  description:
    'As luzes da foto ficam mais fortes e ganham um leve desfoque em volta, como o brilho (bloom) de lâmpadas, reflexos e do céu.\n\nO Limite define a partir de que claridade algo brilha; o Raio, o quanto o brilho se espalha; e a Intensidade, a força. Diferente do Dreamy glow, aqui só as áreas claras são afetadas.',
  params: [
    { id: 'amount', type: 'range', label: 'Intensidade', min: 0, max: 200, step: 1, default: 80, unit: '%' },
    { id: 'radius', type: 'range', label: 'Raio', min: 1, max: 200, step: 1, default: 18, unit: 'px', log: true,
      tip: 'Quanto o brilho se espalha em volta das luzes.' },
    { id: 'threshold', type: 'range', label: 'Limite das luzes', chip: 'Limite', min: 0, max: 100, step: 1, default: 60, unit: '%',
      tip: 'Só áreas mais claras que este valor brilham.' },
    { id: 'boost', type: 'range', label: 'Reforço das luzes', chip: 'Reforço', min: 0, max: 100, step: 1, default: 30, unit: '%',
      tip: 'Deixa as próprias luzes mais fortes, além do brilho em volta.' },
    { id: 'sat', type: 'range', label: 'Cor do brilho', chip: 'Cor', min: 0, max: 100, step: 1, default: 100, unit: '%',
      tip: '0% = brilho branco; 100% = brilho com a cor das luzes.' },
  ],

  render(r, src, w, h, p, target, img) {
    if (p.amount <= 0 && p.boost <= 0) return src.tex;
    const { glow: g, lights } = blurredLights(r, src, w, h, img, target, { threshold: p.threshold / 100, radius: p.radius, name: 'glow' });
    const out = g === target(0).tex ? target(1) : target(0);
    r.pass(r.program(FS), out, {
      uTex: src.tex, uGlow: g, uLights: lights, uRes: [w, h],
      uLod: Math.max(0, Math.log2(Math.max(src.w / w, src.h / h))),
      uAmount: (p.amount / 100) * 4.0, uBoost: (p.boost / 100) * 0.6, uSat: p.sat / 100,
    });
    return out.tex;
  },
};

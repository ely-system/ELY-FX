// Halation: o brilho avermelhado em volta das luzes fortes, típico de filmes sem camada anti-halo
// (como o Cinestill 800T). A luz atravessa o filme, reflete na base e volta borrada e vermelha.

import { hexToRgb } from '../ui.js';
import { blurredLights } from './bloomCommon.js';

const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform sampler2D uGlow;
uniform sampler2D uLights;
uniform vec2 uRes;
uniform float uLod;
uniform vec3 uColor;
uniform float uAmount;
uniform float uCore;     // quanto o halo some sobre a própria luz (0..1)
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 src = textureLod(uTex, uv, uLod);
  float g = dot(texture(uGlow, uv).rgb, vec3(0.3333));
  float l = texture(uLights, uv).a;
  // O halo aparece em volta das luzes; sobre elas fica mais fraco (a luz já está estourada).
  float halo = g * (1.0 - l * uCore);
  vec3 add = uColor * halo * uAmount;
  // Mesclagem Tela: clareia sem estourar.
  vec3 base = clamp(src.rgb, 0.0, 1.0);
  outColor = vec4(1.0 - (1.0 - base) * (1.0 - clamp(add, 0.0, 1.0)), src.a);
}`;

export const halation = {
  id: 'halation',
  name: 'Halation',
  group: 'Luz e lente',
  description:
    'Cria o brilho avermelhado em volta das luzes fortes, típico de filmes como o Cinestill 800T: a luz atravessa o filme, reflete na base e volta borrada e vermelha.\n\nFica muito bonito em fotos noturnas com postes, letreiros e faróis, e em contraluz. O Limite escolhe quais luzes geram o halo; o Raio, o quanto ele se espalha.',
  params: [
    { id: 'amount', type: 'range', label: 'Intensidade', min: 0, max: 200, step: 1, default: 70, unit: '%' },
    { id: 'radius', type: 'range', label: 'Raio', min: 1, max: 200, step: 1, default: 25, unit: 'px', log: true,
      tip: 'Quanto o halo se espalha em volta das luzes.' },
    { id: 'threshold', type: 'range', label: 'Limite das luzes', chip: 'Limite', min: 0, max: 100, step: 1, default: 65, unit: '%',
      tip: 'Só áreas mais claras que este valor geram halo.' },
    { id: 'color', type: 'color', label: 'Cor do halo', default: '#FF3A1C' },
    { id: 'core', type: 'range', label: 'Limpar sobre a luz', chip: 'Limpar', min: 0, max: 100, step: 1, default: 60, unit: '%',
      tip: 'Deixa o halo só em volta das luzes, sem tingir a própria luz.' },
  ],

  render(r, src, w, h, p, target, img) {
    if (p.amount <= 0) return src.tex;
    const { glow: g, lights } = blurredLights(r, src, w, h, img, target, { threshold: p.threshold / 100, radius: p.radius, name: 'halation' });
    const out = g === target(0).tex ? target(1) : target(0);
    r.pass(r.program(FS), out, {
      uTex: src.tex, uGlow: g, uLights: lights, uRes: [w, h],
      uLod: Math.max(0, Math.log2(Math.max(src.w / w, src.h / h))),
      uColor: hexToRgb(p.color) || [1, 0.23, 0.1], uAmount: (p.amount / 100) * 2.0, uCore: p.core / 100,
    });
    return out.tex;
  },
};

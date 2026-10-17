// Base dos efeitos de brilho das luzes (Glow, Halation): separa as áreas mais claras que o limite
// e devolve uma cópia desfocada delas.

import { gaussianBlur } from './gaussianBlur.js';

const EXTRACT_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uLod;
uniform float uThreshold;
uniform float uKnee;
out vec4 outColor;
void main() {
  vec4 c = textureLod(uTex, gl_FragCoord.xy / uRes, uLod);
  vec3 rgb = max(c.rgb, 0.0);
  // Claridade: meio termo entre luminância e canal mais forte (luzes coloridas, como neon,
  // também contam, mas um amarelo ou laranja chapado não vira "luz").
  float l = mix(dot(rgb, vec3(0.2126, 0.7152, 0.0722)), max(rgb.r, max(rgb.g, rgb.b)), 0.5);
  // Cresce aos poucos do limite até o branco: só o que é bem claro brilha com força.
  float m = smoothstep(uThreshold - uKnee, max(uThreshold + uKnee, 1.0), l);
  m *= m;
  outColor = vec4(rgb * m, m);
}`;

/**
 * Luzes acima de `threshold` (0..1), desfocadas com `radius` px da foto.
 * Devolve { glow: textura desfocada, lights: textura das luzes sem desfoque }.
 * O resultado pode estar em target(1) ou num alvo reduzido; target(0) fica livre.
 */
export function blurredLights(r, src, w, h, img, target, { threshold, radius, knee = 0.08, name = 'bloom' }) {
  const lights = r.scratch(name + '-src', w, h);
  r.pass(r.program(EXTRACT_FS), lights, {
    uTex: src.tex, uRes: [w, h], uLod: Math.max(0, Math.log2(Math.max(src.w / w, src.h / h))),
    uThreshold: threshold, uKnee: knee,
  });
  const glow = radius > 0
    ? gaussianBlur.render(r, { tex: lights.tex, w, h }, w, h, { radius }, target, img)
    : lights.tex;
  return { glow, lights: lights.tex };
}

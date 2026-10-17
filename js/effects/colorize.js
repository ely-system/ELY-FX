// Colorir: a foto inteira fica de uma cor só.
// Tonalizar mantém a luz e a sombra da foto com o matiz e a saturação da cor escolhida
// (como "Colorir" do Matiz/Saturação do Photoshop); Cor sólida pinta tudo com a cor.

import { hexToRgb } from '../ui.js';

const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uLod;
uniform int uMode;        // 0 tonalizar, 1 cor sólida
uniform vec3 uColor;
uniform float uHue;       // 0..1
uniform float uSat;       // 0..1
uniform float uLight;     // -1..1
out vec4 outColor;

float hue2rgb(float p, float q, float t) {
  t = fract(t);
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}
vec3 hsl2rgb(float h, float s, float l) {
  if (s <= 0.0) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(hue2rgb(p, q, h + 1.0 / 3.0), hue2rgb(p, q, h), hue2rgb(p, q, h - 1.0 / 3.0));
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 src = textureLod(uTex, uv, uLod);
  if (uMode == 1) { outColor = vec4(uColor, src.a); return; }
  float l = dot(clamp(src.rgb, 0.0, 1.0), vec3(0.2126, 0.7152, 0.0722));
  l = uLight >= 0.0 ? mix(l, 1.0, uLight) : l * (1.0 + uLight);
  outColor = vec4(hsl2rgb(uHue, uSat, l), src.a);
}`;

/** Matiz e saturação (HSL) de uma cor rgb 0..1. */
function hueSat([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
  if (d < 1e-6) return [0, 0];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [((h / 6) + 1) % 1, Math.min(1, s)];
}

const isTone = (p) => p.mode === 'tone';

export const colorize = {
  id: 'colorize',
  name: 'Colorir',
  group: 'Cor',
  params: [
    { id: 'color', type: 'color', label: 'Cor', default: '#C8874A' },
    { id: 'mode', type: 'select', label: 'Tipo', default: 'tone',
      tip: 'Tonalizar mantém as luzes e sombras da foto; Cor sólida pinta tudo com a cor.',
      options: [{ value: 'tone', label: 'Tonalizar' }, { value: 'solid', label: 'Cor sólida', short: 'Sólida' }] },
    { id: 'sat', type: 'range', label: 'Saturação', min: 0, max: 100, step: 1, default: 100, unit: '%', showIf: isTone,
      tip: 'Quanto da saturação da cor escolhida é usada.' },
    { id: 'light', type: 'range', label: 'Luminosidade', min: -100, max: 100, step: 1, default: 0, showIf: isTone,
      track: ['#101010', '#808080', '#f2f2f2'] },
  ],

  render(r, src, w, h, p, target) {
    const out = target(0);
    const rgb = hexToRgb(p.color) || [1, 1, 1];
    const [hue, sat] = hueSat(rgb);
    r.pass(r.program(FS), out, {
      uTex: src.tex, uRes: [w, h], uLod: Math.max(0, Math.log2(Math.max(src.w / w, src.h / h))),
      uMode: p.mode === 'solid' ? 1 : 0, uColor: rgb, uHue: hue, uSat: sat * (p.sat / 100), uLight: p.light / 100,
    });
    return out.tex;
  },
};

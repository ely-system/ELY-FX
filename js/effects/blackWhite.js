// Preto e branco (como o ajuste Preto e Branco do Photoshop / P&B do Lightroom).
//
// O cinza parte da luminância da foto e cada faixa de cor (vermelhos, amarelos, verdes, cianos,
// azuis, magentas) pode ficar mais clara ou mais escura, proporcionalmente à saturação do pixel —
// áreas neutras (cinzas) não mudam. Depois vem o contraste.

const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uLod;
uniform vec3 uWa;        // vermelhos, amarelos, verdes   (-1..1)
uniform vec3 uWb;        // cianos, azuis, magentas      (-1..1)
uniform float uContrast; // -1..1
out vec4 outColor;

float weight(int i) { return i < 3 ? uWa[i] : uWb[i - 3]; }

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 src = textureLod(uTex, uv, uLod);
  vec3 c = clamp(src.rgb, 0.0, 1.0);
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float chroma = mx - mn;
  float L = dot(c, vec3(0.2126, 0.7152, 0.0722));

  // Matiz em setores 0..6: 0 vermelho, 1 amarelo, 2 verde, 3 ciano, 4 azul, 5 magenta.
  float h = 0.0;
  if (chroma > 1e-5) {
    if (mx == c.r) h = mod((c.g - c.b) / chroma, 6.0);
    else if (mx == c.g) h = (c.b - c.r) / chroma + 2.0;
    else h = (c.r - c.g) / chroma + 4.0;
  }
  int i0 = int(floor(h)) % 6;
  int i1 = (i0 + 1) % 6;
  float w = mix(weight(i0), weight(i1), fract(h));
  float g = clamp(L + w * chroma * 0.8, 0.0, 1.0);

  // Contraste: curva em S suave para valores positivos, achatamento para negativos.
  if (uContrast >= 0.0) g = mix(g, g * g * (3.0 - 2.0 * g), uContrast);
  g = clamp(0.5 + (g - 0.5) * (1.0 + 0.6 * uContrast), 0.0, 1.0);
  outColor = vec4(vec3(g), src.a);
}`;

const LUM = 'Luminosidade por cor';
// Trilha do slider: escura à esquerda (escurece), a cor da faixa no meio e clara à direita (clareia).
const lum = (id, label, color) => ({ id, type: 'range', group: LUM, label, min: -100, max: 100, step: 1, default: 0,
  track: ['#101010', color, '#f2f2f2'],
  tip: `Deixa os tons ${label.toLowerCase()} da foto mais claros (+) ou mais escuros (−) no P&B.` });

export const blackWhite = {
  id: 'black-white',
  name: 'Preto e branco',
  group: 'Cor',
  description:
    'Converte a foto para preto e branco controlando o quanto cada cor original fica clara ou escura, como o ajuste Preto e branco do Photoshop.\n\nExemplo: escurecer os azuis deixa o céu mais dramático; clarear os vermelhos e amarelos clareia a pele. Áreas sem cor (cinzas) não mudam.',
  params: [
    { id: 'contrast', type: 'range', label: 'Contraste', min: -100, max: 100, step: 1, default: 0 },
    lum('reds', 'Vermelhos', '#c8473f'),
    lum('yellows', 'Amarelos', '#c9b13c'),
    lum('greens', 'Verdes', '#4f9d4a'),
    lum('cyans', 'Cianos', '#3fa9b0'),
    lum('blues', 'Azuis', '#4565c4'),
    lum('magentas', 'Magentas', '#b24aa8'),
  ],
  openGroups: [LUM],

  render(r, src, w, h, p, target) {
    const out = target(0);
    const k = (v) => v / 100;
    r.pass(r.program(FS), out, {
      uTex: src.tex, uRes: [w, h], uLod: Math.max(0, Math.log2(Math.max(src.w / w, src.h / h))),
      uWa: [k(p.reds), k(p.yellows), k(p.greens)], uWb: [k(p.cyans), k(p.blues), k(p.magentas)],
      uContrast: k(p.contrast),
    });
    return out.tex;
  },
};

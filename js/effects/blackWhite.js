// Preto e branco (como o ajuste Preto e Branco do Photoshop / P&B do Lightroom).
//
// O cinza parte da luminância da foto e cada faixa de cor (vermelhos, amarelos, verdes, cianos,
// azuis, magentas) pode ficar mais clara ou mais escura, proporcionalmente à saturação do pixel —
// áreas neutras (cinzas) não mudam. Depois vêm o contraste e a saturação geral, que devolve parte
// da cor original mantendo os tons do P&B.

const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uLod;
uniform vec3 uWa;        // vermelhos, amarelos, verdes   (-1..1)
uniform vec3 uWb;        // cianos, azuis, magentas      (-1..1)
uniform float uContrast; // -1..1
uniform float uSat;      // 0..1
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

  // Saturação geral: traz de volta a cor original com a luminância do P&B.
  vec3 colored = clamp(c * (g / max(L, 1e-3)), 0.0, 1.0);
  outColor = vec4(mix(vec3(g), colored, uSat), src.a);
}`;

const LUM = 'Luminosidade por cor';
const lum = (id, label) => ({ id, type: 'range', group: LUM, label, min: -100, max: 100, step: 1, default: 0,
  tip: `Deixa os tons ${label.toLowerCase()} da foto mais claros (+) ou mais escuros (−) no P&B.` });

export const blackWhite = {
  id: 'black-white',
  name: 'Preto e branco',
  group: 'Cor',
  params: [
    { id: 'contrast', type: 'range', label: 'Contraste', min: -100, max: 100, step: 1, default: 0 },
    { id: 'saturation', type: 'range', label: 'Saturação', min: 0, max: 100, step: 1, default: 0, unit: '%',
      tip: '0% = preto e branco total. Valores maiores devolvem parte da cor, mantendo os tons do P&B.' },
    lum('reds', 'Vermelhos'),
    lum('yellows', 'Amarelos'),
    lum('greens', 'Verdes'),
    lum('cyans', 'Cianos'),
    lum('blues', 'Azuis'),
    lum('magentas', 'Magentas'),
  ],
  openGroups: [LUM],

  render(r, src, w, h, p, target) {
    const out = target(0);
    const k = (v) => v / 100;
    r.pass(r.program(FS), out, {
      uTex: src.tex, uRes: [w, h], uLod: Math.max(0, Math.log2(Math.max(src.w / w, src.h / h))),
      uWa: [k(p.reds), k(p.yellows), k(p.greens)], uWb: [k(p.cyans), k(p.blues), k(p.magentas)],
      uContrast: k(p.contrast), uSat: k(p.saturation),
    });
    return out.tex;
  },
};

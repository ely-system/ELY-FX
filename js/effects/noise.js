// Ruído / granulado (como Filtro > Ruído > Adicionar Ruído do Photoshop, com opção de grão maior).
//
// O padrão é calculado em coordenadas da FOTO (não da tela), então é o mesmo na prévia e na
// exportação. Grãos maiores que 1,5 px usam ruído de valor suavizado, que lembra grão de filme.
// Na prévia, quando cada pixel da tela cobre vários grãos, a intensidade é atenuada para parecer
// com o resultado final visto de longe.

const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;      // resolução do passe (px)
uniform vec2 uImg;      // tamanho da foto (px)
uniform float uLod;
uniform int uType;      // 0 RGB, 1 monocromático, 2 tonalizado
uniform int uDist;      // 0 uniforme, 1 gaussiana
uniform float uSigma;   // intensidade (desvio padrão, 0..1)
uniform float uSize;    // tamanho do grão em px da foto
uniform vec3 uTint;     // cor do ruído tonalizado (luminância 1)
uniform float uSeed;
out vec4 outColor;

float hash(vec2 p, float k) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031 + k * 0.1373);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Valor aleatório com desvio padrão ~1 numa célula.
float cellNoise(vec2 c, float k) {
  if (uDist == 1) {
    float s = hash(c, k) + hash(c, k + 1.7) + hash(c, k + 3.1) + hash(c, k + 4.9);
    return (s - 2.0) * 1.7320508;
  }
  return (hash(c, k) - 0.5) * 3.4641016;
}

float grain(vec2 ip, float k) {
  vec2 p = ip / uSize;
  if (uSize < 1.5) return cellNoise(floor(p), k);
  vec2 i = floor(p - 0.5), f = p - 0.5 - i;
  f = f * f * (3.0 - 2.0 * f);
  float a = cellNoise(i, k), b = cellNoise(i + vec2(1, 0), k);
  float c = cellNoise(i + vec2(0, 1), k), d = cellNoise(i + vec2(1, 1), k);
  // A interpolação reduz a variação; o fator 1.6 devolve uma intensidade parecida com a do grão fino.
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y) * 1.6;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 col = textureLod(uTex, uv, uLod);
  vec2 ip = uv * uImg + uSeed * 97.0;
  vec3 n;
  if (uType == 0) n = vec3(grain(ip, 0.0), grain(ip, 11.0), grain(ip, 23.0));
  else if (uType == 1) n = vec3(grain(ip, 0.0));
  else n = grain(ip, 0.0) * uTint;
  outColor = vec4(col.rgb + n * uSigma, col.a);
}`;

function hueToRgb(h, s) {
  const k = (n) => (n + h / 30) % 12;
  const f = (n) => 1 - Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const rgb = [f(0), f(8), f(4)].map((c) => 1 - s + s * c);
  const luma = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return rgb.map((c) => c / Math.max(0.05, luma));
}

const isTint = (p) => p.type === 'tint';

export const noise = {
  id: 'noise',
  name: 'Ruído / Granulado',
  group: 'Estilização',
  params: [
    { id: 'type', type: 'select', label: 'Tipo', default: 'mono',
      options: [{ value: 'rgb', label: 'RGB' }, { value: 'mono', label: 'Monocromático', short: 'Mono' }, { value: 'tint', label: 'Tonalizado' }] },
    { id: 'amount', type: 'range', label: 'Quantidade', min: 0, max: 100, step: 1, default: 20, unit: '%' },
    { id: 'size', type: 'range', label: 'Tamanho do grão', chip: 'Grão', min: 1, max: 10, step: 0.1, default: 1, unit: 'px',
      tip: 'Grãos maiores ficam mais suaves, como granulado de filme.' },
    { id: 'dist', type: 'select', label: 'Distribuição', default: 'gauss',
      options: [{ value: 'uniform', label: 'Uniforme' }, { value: 'gauss', label: 'Gaussiana' }] },
    { id: 'hue', type: 'range', label: 'Matiz', min: 0, max: 360, step: 1, default: 30, unit: '°', showIf: isTint },
    { id: 'sat', type: 'range', label: 'Saturação da cor', chip: 'Saturação', min: 0, max: 100, step: 1, default: 60, unit: '%', showIf: isTint },
    { id: 'seed', type: 'range', label: 'Variação', min: 1, max: 100, step: 1, default: 1,
      tip: 'Muda o padrão aleatório do ruído.' },
  ],

  render(r, src, w, h, p, target, img) {
    if (p.amount <= 0) return src.tex;
    // Na prévia, cada pixel cobre (img.w / w) px da foto: grãos menores que isso se misturam.
    const pxPerPreview = img.w / w;
    const atten = Math.min(1, p.size / pxPerPreview);
    const out = target(0);
    r.pass(r.program(FS), out, {
      uTex: src.tex, uRes: [w, h], uImg: [img.w, img.h],
      uLod: Math.max(0, Math.log2(Math.max(src.w / w, src.h / h))),
      uType: p.type === 'rgb' ? 0 : p.type === 'mono' ? 1 : 2,
      uDist: p.dist === 'uniform' ? 0 : 1,
      uSigma: (p.amount / 100) * 0.25 * atten,
      uSize: p.size, uTint: hueToRgb(p.hue, p.sat / 100), uSeed: p.seed,
    });
    return out.tex;
  },
};

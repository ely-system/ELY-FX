// Glitch: falhas digitais e de vídeo — faixas da imagem deslocadas, cores separadas, blocos
// corrompidos, linhas de varredura e chiado. Tudo em px da FOTO (prévia = exportação);
// a semente sorteia outro padrão de falhas.

const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform vec2 uImg;
uniform float uLod;
uniform float uShift;     // deslocamento das faixas (0..1)
uniform float uDensity;   // quantidade de faixas com falha (0..1)
uniform float uSize;      // altura base das faixas (px da foto)
uniform float uRgb;       // separação RGB (px da foto)
uniform float uBlocks;    // blocos corrompidos (0..1)
uniform float uScan;      // linhas de varredura (0..1)
uniform float uNoise;     // chiado (0..1)
uniform float uSeed;
out vec4 outColor;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031 + fract(uSeed * 0.1373) * 7.0);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec4 at(vec2 ip) {
  ip.x = mod(ip.x, uImg.x);   // o que sai por um lado entra pelo outro, como num sinal de vídeo
  return textureLod(uTex, clamp(ip, vec2(0.5), uImg - 0.5) / uImg, uLod);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = uv * uImg;
  vec2 q = p;
  float hit = 0.0;

  // Faixas horizontais de alturas variadas: duas escalas sobrepostas.
  for (int k = 0; k < 2; k++) {
    float hgt = uSize * (k == 0 ? 1.0 : 0.25);
    float row = floor(p.y / hgt);
    float r1 = hash(vec2(row, float(k) * 7.1));
    if (r1 < uDensity * (k == 0 ? 0.35 : 0.2)) {
      float r2 = hash(vec2(row, float(k) * 7.1 + 3.3));
      q.x += (r2 - 0.5) * 2.0 * uShift * uImg.x * (k == 0 ? 0.12 : 0.05);
      hit = max(hit, 1.0);
    }
  }

  // Blocos corrompidos: copiam um pedaço de outro lugar da foto.
  vec2 bs = vec2(uSize * 2.0, uSize * 0.6);
  vec2 cell = floor(p / bs);
  float bk = 0.0;
  if (hash(cell + 11.0) < uBlocks * 0.25) {
    vec2 src = floor(vec2(hash(cell + 2.0), hash(cell + 5.0)) * uImg / bs) * bs;
    q = src + mod(p, bs);
    bk = 1.0;
  }

  // Separação RGB (maior nas faixas com falha).
  float split = uRgb * (1.0 + hit * 1.5);
  vec4 c = at(q);
  vec3 col = vec3(at(q + vec2(split, 0.0)).r, c.g, at(q - vec2(split, 0.0)).b);

  // Bloco corrompido: cores posterizadas e um canal trocado.
  if (bk > 0.5) {
    col = floor(col * 4.0 + 0.5) / 4.0;
    if (hash(cell + 9.0) < 0.5) col = col.gbr;
  }

  // Linhas de varredura (espaçamento proporcional à foto, ~500 linhas) e chiado.
  float period = max(3.0, max(uImg.x, uImg.y) / 500.0);
  float scan = 0.5 + 0.5 * cos(p.y / period * 6.2831853);
  col *= 1.0 - uScan * 0.35 * scan;
  float n = hash(floor(p) + 0.5) - 0.5;
  col += n * uNoise * 0.35;
  outColor = vec4(col, c.a);
}`;

export const glitch = {
  id: 'glitch',
  name: 'Glitch',
  group: 'Estilização',
  description:
    'Simula falhas digitais e de vídeo: faixas da imagem deslocadas para o lado, cores separadas (RGB), blocos corrompidos, linhas de varredura de TV e chiado.\n\nCada ajuste pode ser usado sozinho — só a separação RGB e as linhas, por exemplo, dão um visual VHS sutil. A Semente (ou Sortear padrão) escolhe outro desenho de falhas.',
  params: [
    { id: 'shift', type: 'range', label: 'Deslocamento', min: 0, max: 100, step: 1, default: 40, unit: '%',
      tip: 'Quanto as faixas com falha andam para o lado.' },
    { id: 'density', type: 'range', label: 'Quantidade de faixas', chip: 'Faixas', min: 0, max: 100, step: 1, default: 40, unit: '%' },
    { id: 'size', type: 'range', label: 'Altura das faixas', chip: 'Altura', min: 4, max: 400, step: 1, default: 60, unit: 'px', log: true },
    { id: 'rgb', type: 'range', label: 'Separação RGB', chip: 'RGB', min: 0, max: 60, step: 0.5, default: 6, unit: 'px' },
    { id: 'blocks', type: 'range', label: 'Blocos corrompidos', chip: 'Blocos', min: 0, max: 100, step: 1, default: 10, unit: '%' },
    { id: 'scan', type: 'range', label: 'Linhas de varredura', chip: 'Linhas', min: 0, max: 100, step: 1, default: 25, unit: '%' },
    { id: 'noise', type: 'range', label: 'Chiado', min: 0, max: 100, step: 1, default: 15, unit: '%' },
    { id: 'seed', type: 'range', label: 'Semente', min: 1, max: 999, step: 1, default: 1,
      tip: 'Sorteia outro padrão de falhas.' },
  ],

  actions: [
    { id: 'randomize', label: 'Sortear padrão', run: (L, _setPoints, setValue) => {
      let v;
      do v = 1 + Math.floor(Math.random() * 999); while (v === L.params.seed);
      setValue(L, 'seed', v);
    } },
  ],

  render(r, src, w, h, p, target, img) {
    const out = target(0);
    r.pass(r.program(FS), out, {
      uTex: src.tex, uRes: [w, h], uImg: [img.w, img.h],
      uLod: Math.max(0, Math.log2(Math.max(src.w / w, src.h / h))),
      uShift: p.shift / 100, uDensity: p.density / 100, uSize: p.size, uRgb: p.rgb,
      uBlocks: p.blocks / 100, uScan: p.scan / 100, uNoise: p.noise / 100, uSeed: p.seed,
    });
    return out.tex;
  },
};

// Desfoque radial (equivalente ao Filtro > Desfoque > Desfoque Radial do Photoshop).
//
// Giro: cada pixel é a média da imagem girada em torno do centro por ângulos dentro de um arco.
// Zoom: cada pixel é a média da imagem escalada (em escala logarítmica) a partir do centro.
//
// Para obter um rastro contínuo e sem "fantasmas" com poucas amostras, o desfoque é feito em
// vários passes: o passe k cobre o intervalo total / n^k com n amostras. A composição dos passes
// equivale a n^passes amostras uniformemente espaçadas (giros e escalas se compõem exatamente).

const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;        // resolução do passe (px)
uniform vec2 uCenter;     // centro em uv (0..1, origem no topo esquerdo)
uniform int uMode;        // 0 = giro, 1 = zoom
uniform float uAmount;    // giro: ângulo total (rad) | zoom: log da escala total
uniform float uT0;        // intervalo das amostras em frações do total
uniform float uT1;
uniform float uSharpR;    // raio (px) que fica nítido
uniform float uFeather;   // largura (px) da transição nítido → desfocado
uniform int uSamples;
uniform float uLod;       // nível de mipmap ao ler a foto original
out vec4 outColor;

void main() {
  vec2 p = gl_FragCoord.xy;
  vec2 c = uCenter * uRes;
  vec2 d = p - c;
  float r = length(d);
  float w = uFeather > 0.5 ? smoothstep(uSharpR, uSharpR + uFeather, r) : step(uSharpR, r);
  float amt = uAmount * w;
  float n = float(uSamples);
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 64; i++) {
    if (i >= uSamples) break;
    float t = mix(uT0, uT1, (float(i) + 0.5) / n) * amt;
    vec2 q;
    if (uMode == 0) {
      float cs = cos(t), sn = sin(t);
      q = c + vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y);
    } else {
      q = c + d * exp(t);
    }
    acc += textureLod(uTex, q / uRes, uLod);
  }
  outColor = acc / n;
}`;

const QUALITY = {
  draft: { passes: 2, samples: 10 },
  good: { passes: 2, samples: 28 },
  best: { passes: 3, samples: 32 },
};

const SPIN_MAX = Math.PI / 2;  // intensidade 100 = arco de 90°
const ZOOM_MAX = 1.0;          // intensidade 100 = escala de e^±0,5 (≈ 0,61× a 1,65×)

function directionOptions(p) {
  return p.method === 'spin'
    ? [{ value: 'both', label: 'Nos dois sentidos' }, { value: 'cw', label: 'Horário' }, { value: 'ccw', label: 'Anti-horário' }]
    : [{ value: 'both', label: 'Nos dois sentidos' }, { value: 'cw', label: 'Para fora' }, { value: 'ccw', label: 'Para dentro' }];
}

export const radialBlur = {
  id: 'radial-blur',
  name: 'Desfoque radial',
  params: [
    { id: 'method', type: 'select', label: 'Método', default: 'spin',
      options: [{ value: 'spin', label: 'Giro (circular)' }, { value: 'zoom', label: 'Zoom (raios a partir do centro)' }] },
    { id: 'direction', type: 'select', label: 'Direção', default: 'both', options: directionOptions,
      tip: 'Nos dois sentidos espalha o rastro igualmente; os demais criam um rastro de movimento só para um lado.' },
    { id: 'amount', type: 'range', label: 'Intensidade', min: 0, max: 100, step: 1, default: 15 },
    { id: 'cx', type: 'range', label: 'Centro horizontal', min: 0, max: 100, step: 0.1, default: 50, unit: '%',
      tip: 'Também pode ser ajustado arrastando o alvo sobre a foto (ferramenta V).' },
    { id: 'cy', type: 'range', label: 'Centro vertical', min: 0, max: 100, step: 0.1, default: 50, unit: '%' },
    { id: 'sharp', type: 'range', label: 'Área nítida no centro', min: 0, max: 100, step: 1, default: 0, unit: '%',
      tip: 'Raio ao redor do centro que permanece sem desfoque (em % da meia-diagonal da foto).' },
    { id: 'feather', type: 'range', label: 'Suavidade da transição', min: 0, max: 100, step: 1, default: 60, unit: '%',
      tip: 'Quão gradual é a passagem da área nítida para o desfoque total.' },
    { id: 'quality', type: 'select', label: 'Qualidade', default: 'good',
      options: [{ value: 'draft', label: 'Rascunho (rápida)' }, { value: 'good', label: 'Boa' }, { value: 'best', label: 'Ótima' }] },
  ],

  /** Centro e anéis (em px da imagem) para o overlay de edição. */
  overlay(p, w, h) {
    const half = 0.5 * Math.hypot(w, h);
    const r = (p.sharp / 100) * half;
    const rings = r > 0 ? [r, r + featherPx(p, r)] : [];
    return { center: [(p.cx / 100) * w, (p.cy / 100) * h], rings };
  },

  render(r, src, w, h, p, target) {
    const q = QUALITY[p.quality] || QUALITY.good;
    const spin = p.method === 'spin';
    const total = (p.amount / 100) * (spin ? SPIN_MAX : ZOOM_MAX);
    if (total <= 0) return src.tex;

    const [t0, t1] = p.direction === 'cw' ? [-1, 0] : p.direction === 'ccw' ? [0, 1] : [-0.5, 0.5];
    const half = 0.5 * Math.hypot(w, h);
    const sharpR = (p.sharp / 100) * half;
    const prog = r.program(FS);

    let input = src.tex;
    let lod = Math.max(0, Math.log2(Math.max(src.w / w, src.h / h)));
    for (let k = 0; k < q.passes; k++) {
      const out = target(k);
      r.pass(prog, out, {
        uTex: input, uRes: [w, h], uCenter: [p.cx / 100, p.cy / 100], uMode: spin ? 0 : 1,
        uAmount: total / Math.pow(q.samples, k), uT0: t0, uT1: t1,
        uSharpR: sharpR, uFeather: featherPx(p, sharpR), uSamples: q.samples, uLod: lod,
      });
      input = out.tex;
      lod = 0;
    }
    return input;
  },
};

function featherPx(p, sharpR) {
  return sharpR * (p.feather / 100) * 1.5;
}

// Base compartilhada pelos desfoques com ponto de origem (radial/giro e zoom).
//
// Giro: cada pixel é a média da imagem girada em torno do ponto de origem por ângulos dentro de um arco.
// Zoom: cada pixel é a média da imagem escalada (em escala logarítmica) a partir do ponto de origem.
//
// Para obter um rastro contínuo e sem "fantasmas" com poucas amostras, o desfoque é feito em
// vários passes: o passe k cobre o intervalo total / n^k com n amostras. A composição dos passes
// equivale a n^passes amostras uniformemente espaçadas (giros e escalas se compõem exatamente).

const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;        // resolução do passe (px)
uniform vec2 uCenter;     // ponto de origem em uv (0..1, origem no topo esquerdo)
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

export const ORIGIN_GROUP = 'Posição do ponto de origem';

/**
 * Cria um efeito de desfoque com ponto de origem.
 * directions: [{ value, label, range: [t0, t1] }]
 */
export function makeOriginBlur({ id, name, description, mode, maxAmount, directions, amountDefault }) {
  const dirRange = Object.fromEntries(directions.map((d) => [d.value, d.range]));

  return {
    id,
    name,
    description,
    group: 'Desfoques',
    params: [
      { id: 'direction', type: 'select', label: 'Direção', default: directions[0].value,
        options: directions.map(({ value, label, short }) => ({ value, label, short })),
        tip: 'Nos dois sentidos espalha o rastro igualmente; os demais criam um rastro de movimento só para um lado.' },
      { id: 'amount', type: 'range', label: 'Intensidade', min: 0, max: 100, step: 1, default: amountDefault },
      { id: 'sharp', type: 'range', label: 'Área nítida', min: 0, max: 100, step: 1, default: 0, unit: '%',
        tip: 'Raio ao redor do ponto de origem que permanece sem desfoque (em % da meia-diagonal da foto).' },
      { id: 'feather', type: 'range', label: 'Suavidade da transição', chip: 'Suavidade', min: 0, max: 100, step: 1, default: 60, unit: '%',
        tip: 'Quão gradual é a passagem da área nítida para o desfoque total.' },
      { id: 'quality', type: 'select', label: 'Qualidade', default: 'good',
        options: [{ value: 'draft', label: 'Rascunho (rápida)', short: 'Rascunho' }, { value: 'good', label: 'Boa' }, { value: 'best', label: 'Ótima' }] },
      { id: 'ox', type: 'range', group: ORIGIN_GROUP, label: 'Horizontal', chip: 'Origem ↔', min: -1000, max: 1000, step: 1, default: 0, unit: 'px',
        range: (w, h) => [-Math.floor(w / 2), Math.floor(w / 2)],
        tip: 'Distância a partir do centro da foto. Positivo = para a direita, negativo = para a esquerda.' },
      { id: 'oy', type: 'range', group: ORIGIN_GROUP, label: 'Vertical', chip: 'Origem ↕', min: -1000, max: 1000, step: 1, default: 0, unit: 'px',
        range: (w, h) => [-Math.floor(h / 2), Math.floor(h / 2)],
        tip: 'Distância a partir do centro da foto. Positivo = para cima, negativo = para baixo.' },
    ],

    /** Ponto de origem (px da imagem, origem no topo esquerdo) a partir dos parâmetros. */
    origin(p, w, h) {
      return [w / 2 + p.ox, h / 2 - p.oy];
    },

    /** Converte um ponto da imagem nos parâmetros de origem. */
    originParams(ix, iy, w, h) {
      const ox = Math.round(Math.max(-w / 2, Math.min(w / 2, ix - w / 2)));
      const oy = Math.round(Math.max(-h / 2, Math.min(h / 2, h / 2 - iy)));
      return { ox, oy };
    },

    /** Ponto de origem e anéis da área nítida (px da imagem) para o overlay. */
    overlay(p, w, h) {
      const half = 0.5 * Math.hypot(w, h);
      const r = (p.sharp / 100) * half;
      return { center: this.origin(p, w, h), rings: r > 0 ? [r, r + featherPx(p, r)] : [] };
    },

    render(r, src, w, h, p, target, img) {
      const q = QUALITY[p.quality] || QUALITY.good;
      const total = (p.amount / 100) * maxAmount;
      if (total <= 0) return src.tex;

      const [t0, t1] = dirRange[p.direction] || [-0.5, 0.5];
      const [cx, cy] = this.origin(p, img.w, img.h);
      const sharpR = (p.sharp / 100) * 0.5 * Math.hypot(w, h);
      const prog = r.program(FS);

      let input = src.tex;
      let lod = Math.max(0, Math.log2(Math.max(src.w / w, src.h / h)));
      for (let k = 0; k < q.passes; k++) {
        const out = target(k);
        r.pass(prog, out, {
          uTex: input, uRes: [w, h], uCenter: [cx / img.w, cy / img.h], uMode: mode,
          uAmount: total / Math.pow(q.samples, k), uT0: t0, uT1: t1,
          uSharpR: sharpR, uFeather: featherPx(p, sharpR), uSamples: q.samples, uLod: lod,
        });
        input = out.tex;
        lod = 0;
      }
      return input;
    },
  };
}

function featherPx(p, sharpR) {
  return sharpR * (p.feather / 100) * 1.5;
}

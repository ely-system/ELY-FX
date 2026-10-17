// Desfoque direcional (equivalente ao Filtro > Desfoque > Desfoque de Movimento do Photoshop):
// rastro em linha reta com ângulo e distância.
//
// Como no desfoque radial, é feito em passes: o passe k cobre distância / n^k com n amostras,
// e a composição dos passes equivale a n^passes amostras uniformes ao longo da linha
// (translações se compõem exatamente), o que dá um rastro contínuo mesmo com distâncias grandes.

const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;      // resolução do passe (px)
uniform vec2 uDelta;    // deslocamento total do rastro neste passe, em uv
uniform int uSamples;
uniform float uLod;     // nível de mipmap ao ler a foto original
out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float n = float(uSamples);
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 64; i++) {
    if (i >= uSamples) break;
    float t = (float(i) + 0.5) / n - 0.5;
    acc += textureLod(uTex, uv + uDelta * t, uLod);
  }
  outColor = acc / n;
}`;

const QUALITY = {
  draft: { passes: 2, samples: 10 },
  good: { passes: 2, samples: 28 },
  best: { passes: 3, samples: 32 },
};

export const directionalBlur = {
  id: 'directional-blur',
  name: 'Desfoque direcional',
  params: [
    { id: 'angle', type: 'range', label: 'Ângulo', min: -90, max: 90, step: 1, default: 0, unit: '°',
      tip: 'Direção do movimento: 0° horizontal, 90° vertical (como no Desfoque de Movimento do Photoshop).' },
    { id: 'distance', type: 'range', label: 'Distância', min: 0, max: 1000, step: 1, default: 40, unit: 'px',
      tip: 'Comprimento do rastro, em pixels da foto.' },
    { id: 'quality', type: 'select', label: 'Qualidade', default: 'good',
      options: [{ value: 'draft', label: 'Rascunho (rápida)', short: 'Rascunho' }, { value: 'good', label: 'Boa' }, { value: 'best', label: 'Ótima' }] },
  ],

  render(r, src, w, h, p, target) {
    // Distância em px da foto original → px da resolução em que o efeito está sendo calculado.
    const dist = p.distance * (w / src.w);
    if (dist < 0.5) return src.tex;
    const q = QUALITY[p.quality] || QUALITY.good;
    // Ângulo como no Photoshop: positivo gira no sentido anti-horário (y da tela cresce para baixo).
    const a = (p.angle * Math.PI) / 180;
    const dx = (Math.cos(a) * dist) / w;
    const dy = (-Math.sin(a) * dist) / h;
    const prog = r.program(FS);

    let input = src.tex;
    let lod = Math.max(0, Math.log2(Math.max(src.w / w, src.h / h)));
    for (let k = 0; k < q.passes; k++) {
      const f = 1 / Math.pow(q.samples, k);
      const out = target(k);
      r.pass(prog, out, { uTex: input, uRes: [w, h], uDelta: [dx * f, dy * f], uSamples: q.samples, uLod: lod });
      input = out.tex;
      lod = 0;
    }
    return input;
  },
};

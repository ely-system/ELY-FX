// Desfoque gaussiano (equivalente ao Filtro > Desfoque > Desfoque Gaussiano do Photoshop).
//
// Separável: um passe horizontal e um vertical. Para raios grandes o desfoque é feito em
// resolução reduzida (raio de no máximo MAX_SIGMA px por passe) e ampliado com interpolação
// bilinear na composição — num resultado já bem suave isso é imperceptível e mantém o custo baixo.

const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;    // resolução do passe (px)
uniform vec2 uStep;   // passo de 1 px do passe, em uv, na direção do desfoque
uniform float uSigma; // desvio padrão em px do passe
uniform float uLod;   // nível de mipmap ao ler a foto original
out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  int r = int(ceil(uSigma * 3.0));
  float k = -0.5 / (uSigma * uSigma);
  vec4 acc = vec4(0.0);
  float sum = 0.0;
  for (int i = -40; i <= 40; i++) {
    if (i < -r || i > r) continue;
    float w = exp(float(i * i) * k);
    acc += textureLod(uTex, uv + uStep * float(i), uLod) * w;
    sum += w;
  }
  outColor = acc / sum;
}`;

const MAX_SIGMA = 10;

export const gaussianBlur = {
  id: 'gaussian-blur',
  name: 'Desfoque gaussiano',
  group: 'Desfoques',
  params: [
    { id: 'radius', type: 'range', label: 'Raio', min: 0, max: 250, step: 0.5, default: 10, unit: 'px',
      tip: 'Intensidade do desfoque, em pixels da foto (como o Raio do Photoshop).' },
  ],

  render(r, src, w, h, p, target, img) {
    // Raio em px da foto original → px da resolução em que o efeito está sendo calculado.
    const sigma = p.radius * (w / img.w);
    if (sigma < 0.3) return src.tex;

    const s = Math.max(1, sigma / MAX_SIGMA);
    const wl = Math.max(1, Math.round(w / s));
    const hl = Math.max(1, Math.round(h / s));
    const sigmaLow = sigma * (wl / w);
    const [a, b] = s === 1 ? [target(0), target(1)] : [r.scratch('gauss-a', wl, hl), r.scratch('gauss-b', wl, hl)];
    const prog = r.program(FS);
    const lod = Math.max(0, Math.log2(Math.max(src.w / wl, src.h / hl)));

    r.pass(prog, a, { uTex: src.tex, uRes: [wl, hl], uStep: [1 / wl, 0], uSigma: sigmaLow, uLod: lod });
    r.pass(prog, b, { uTex: a.tex, uRes: [wl, hl], uStep: [0, 1 / hl], uSigma: sigmaLow, uLod: 0 });
    return b.tex;
  },
};

// Pixelização (estilo pixel art): a foto vira blocos com a cor média de cada bloco e,
// opcionalmente, uma paleta reduzida. A grade é alinhada à FOTO, então prévia e exportação
// coincidem.

const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;      // resolução do passe (px)
uniform vec2 uImg;      // tamanho da foto (px)
uniform float uCell;    // lado do bloco em px da foto
uniform float uLevels;  // níveis por canal (0 = sem redução)
uniform float uLod;
out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 ip = uv * uImg;
  vec2 c0 = floor(ip / uCell) * uCell;
  vec2 c1 = min(c0 + uCell, uImg);
  vec4 acc = vec4(0.0);
  for (int j = 0; j < 6; j++) {
    for (int i = 0; i < 6; i++) {
      vec2 q = c0 + (vec2(i, j) + 0.5) / 6.0 * (c1 - c0);
      acc += textureLod(uTex, q / uImg, uLod);
    }
  }
  vec4 col = acc / 36.0;
  if (uLevels > 1.5) {
    float n = uLevels - 1.0;
    col.rgb = floor(clamp(col.rgb, 0.0, 1.0) * n + 0.5) / n;
  }
  outColor = col;
}`;

export const pixelate = {
  id: 'pixelate',
  name: 'Pixelização',
  group: 'Estilização',
  params: [
    { id: 'size', type: 'range', label: 'Tamanho do pixel', chip: 'Pixel', min: 2, max: 200, step: 1, default: 16, unit: 'px',
      tip: 'Lado de cada bloco, em pixels da foto.' },
    { id: 'levels', type: 'select', label: 'Cores', default: '0',
      tip: 'Reduz a paleta como em pixel art (níveis por canal de cor).',
      options: [
        { value: '0', label: 'Todas' },
        { value: '8', label: '512 cores', short: '512' },
        { value: '6', label: '216 cores', short: '216' },
        { value: '4', label: '64 cores', short: '64' },
        { value: '3', label: '27 cores', short: '27' },
        { value: '2', label: '8 cores', short: '8' },
      ] },
  ],

  render(r, src, w, h, p, target, img) {
    const out = target(0);
    // Amostras dentro do bloco (6×6); com a foto original usa mipmaps para médias melhores.
    const cellInput = p.size * (src.w / img.w);
    const lod = Math.max(0, Math.log2(Math.max(1, cellInput / 6)));
    r.pass(r.program(FS), out, {
      uTex: src.tex, uRes: [w, h], uImg: [img.w, img.h], uCell: p.size, uLevels: Number(p.levels), uLod: lod,
    });
    return out.tex;
  },
};

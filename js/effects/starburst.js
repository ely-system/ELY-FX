// Raios de luz (filtro estrela / cross screen): pontos de luz com raios em estrela.
//
// Os pontos são criados clicando/tocando na foto (parâmetro `stars`, em px da foto) e todos
// compartilham os mesmos ajustes. Cada raio recebe valores aleatórios próprios (comprimento,
// brilho, leve desvio de ângulo e falhas ao longo do traço), controlados por "Variação" e "Falhas".
// A luz é somada à foto em modo Tela (screen), como no Photoshop.

import { hexToRgb } from '../ui.js';

export const MAX_STARS = 32;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;            // resolução do passe (px)
uniform vec2 uImg;            // tamanho da foto (px)
uniform float uLod;
uniform float uPx;            // px da foto por px do passe
uniform vec2 uStars[${MAX_STARS}];
uniform int uCount;
uniform int uPoints;
uniform float uRot;
uniform float uLen;
uniform float uCore;
uniform float uThick;
uniform float uInt;
uniform float uVar;
uniform float uGaps;
uniform float uSeed;
uniform float uDisp;          // dispersão (arco-íris) ao longo dos raios
uniform float uCoreDisp;      // brilho cromático do centro
uniform float uWide;          // espessura do traço largo e difuso (0 = desligado)
uniform float uWideInt;       // intensidade do traço difuso
uniform vec3 uColor;
out vec4 outColor;

float h1(float n) { return fract(sin(n * 127.1 + uSeed * 311.7) * 43758.5453); }
float vnoise(float x, float s) {
  float i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(h1(i * 7.13 + s), h1((i + 1.0) * 7.13 + s), f);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 col = textureLod(uTex, uv, uLod);
  vec2 p = uv * uImg;
  // Raios mais finos que um pixel da prévia ficam com 1 px e brilho proporcional (mesma "energia").
  float th = max(uThick, uPx * 0.8);
  float gain = uThick / th;
  float cr = max(uCore, uPx);
  vec3 core = vec3(0.0);
  vec3 rays = vec3(0.0);
  float n = float(uPoints);

  for (int i = 0; i < ${MAX_STARS}; i++) {
    if (i >= uCount) break;
    vec2 d = p - uStars[i];
    float r2 = dot(d, d);
    if (uCore > 0.0) {
      // Brilho cromático: cada cor com um raio um pouco diferente (vermelho por fora, azul por dentro)
      // e um halo suave com as cores do espectro, como a aberração de uma lente.
      vec3 crs = cr * (1.0 + uCoreDisp * vec3(0.4, 0.0, -0.3));
      core += exp(-r2 / (crs * crs)) + 0.18 * crs * crs / (r2 + crs * crs);
      if (uCoreDisp > 0.001) {
        float rr = sqrt(r2);
        float ring = exp(-pow((rr - 2.6 * cr) / (0.8 * cr), 2.0)) * 0.4 * uCoreDisp;
        vec3 spec = 0.5 + 0.5 * cos(6.2831853 * (rr / (2.6 * cr) * 0.9 + vec3(0.0, 0.33, 0.67)));
        core += ring * spec;
      }
    }
    if (r2 > uLen * uLen * 1.1) continue;
    float si = float(i) * 17.31;
    for (int k = 0; k < 16; k++) {
      if (k >= uPoints) break;
      float fk = float(k);
      float rl = h1(si + fk * 3.7);          // comprimento
      float rb = h1(si + fk * 5.3 + 1.7);    // brilho
      float ra = h1(si + fk * 9.1 + 3.3);    // desvio de ângulo
      float ang = uRot + fk * 6.2831853 / n + uVar * (ra - 0.5) * 0.35 * 6.2831853 / n;
      vec2 dir = vec2(cos(ang), -sin(ang));
      float t = dot(d, dir);
      if (t <= 0.0) continue;
      float L = uLen * (1.0 - uVar * 0.75 * rl);
      if (t >= L) continue;
      float s = abs(d.x * dir.y - d.y * dir.x);
      float u = t / L;
      float w = th * (1.0 - 0.55 * u) + 1e-4;
      // Traço fino com um leve brilho em volta, como a difração de um filtro real.
      float across = (exp(-(s * s) / (w * w)) + 0.22 * exp(-(s * s) / (w * w * 16.0))) * gain;
      // Traço largo e suave por baixo do nítido (Largura), entrando aos poucos a partir do centro.
      if (uWide > 0.0) {
        float wd = max(uWide, uPx) * (1.0 - 0.3 * u);
        float e = s / wd;
        across += uWideInt * 1.3 * exp(-e * e) * smoothstep(0.0, 1.0, t / wd + 0.3);
      }
      // Forte perto do centro e uma cauda longa que se apaga aos poucos.
      float along = (0.55 * exp(-5.0 * u) + 0.45 * (1.0 - u) * (1.0 - u)) * (1.0 - uVar * 0.6 * rb);
      // Falhas: a opacidade varia suavemente ao longo do raio (várias escalas de irregularidade);
      // no máximo chega a apagar trechos, mas sempre com transição macia.
      float irr = 1.0;
      if (uGaps > 0.001) {
        float x = t / max(L * 0.09, 1.0);
        float s0 = si + fk * 13.7;
        float nf = 0.55 * vnoise(x, s0) + 0.3 * vnoise(x * 2.3 + 5.1, s0 + 3.0) + 0.15 * vnoise(x * 5.3 + 9.7, s0 + 7.0);
        irr = mix(1.0, smoothstep(0.1, 0.9, nf), uGaps * smoothstep(0.02, 0.2, u));
      }
      vec3 tint = vec3(1.0);
      if (uDisp > 0.001) {
        vec3 spec = 0.5 + 0.5 * cos(6.2831853 * (t / max(L * 0.3, 1.0) + rb + vec3(0.0, 0.33, 0.67)));
        tint = mix(vec3(1.0), spec * 1.4, uDisp);
      }
      rays += tint * (across * along * irr * 1.6);
    }
  }
  vec3 add = clamp(uColor * (core + rays) * uInt, 0.0, 1.0);
  outColor = vec4(1.0 - (1.0 - clamp(col.rgb, 0.0, 1.0)) * (1.0 - add), col.a);
}`;

/** Cor da luz com o canal mais forte em 1 (a força vem da Intensidade). */
function lightFromHex(hex) {
  const rgb = hexToRgb(hex) || [1, 1, 1];
  const m = Math.max(...rgb, 0.05);
  return rgb.map((c) => c / m);
}

export const starburst = {
  id: 'starburst',
  name: 'Raios de luz (estrela)',
  group: 'Estilização',
  points: 'stars', // parâmetro com os pontos de luz, editados direto na foto
  hint: 'Clique ou toque na foto para criar um ponto de luz. Arraste um ponto para movê-lo; arraste para fora da foto para removê-lo.',
  params: [
    { id: 'stars', type: 'points', default: [] },
    { id: 'points', type: 'range', label: 'Pontas', min: 2, max: 16, step: 1, default: 8 },
    { id: 'rotation', type: 'range', label: 'Rotação', min: -180, max: 180, step: 1, default: 0, unit: '°',
      tip: 'Gira todos os raios de todos os pontos juntos.' },
    { id: 'length', type: 'range', label: 'Tamanho dos raios', chip: 'Raios', min: 10, max: 4000, step: 1, default: 400, unit: 'px', log: true },
    { id: 'core', type: 'range', label: 'Tamanho do centro', chip: 'Centro', min: 0, max: 300, step: 1, default: 20, unit: 'px' },
    { id: 'thickness', type: 'range', label: 'Espessura dos raios', chip: 'Espessura', min: 0.5, max: 60, step: 0.5, default: 2.5, unit: 'px', log: true,
      tip: 'Espessura do traço nítido de cada raio.' },
    { id: 'wide', type: 'range', label: 'Largura do traço', chip: 'Largura', min: 0, max: 400, step: 1, default: 0, unit: 'px',
      tip: 'Engrossa os raios com um traço largo e suave por baixo do traço nítido (0 = desligado).' },
    { id: 'wideInt', type: 'range', label: 'Brilho do traço largo', chip: 'Brilho largo', min: 0, max: 100, step: 1, default: 60, unit: '%',
      tip: 'Força do traço largo (100% = tão forte quanto o traço nítido).' },
    { id: 'intensity', type: 'range', label: 'Intensidade', min: 0, max: 200, step: 1, default: 100, unit: '%' },
    { id: 'variation', type: 'range', label: 'Variação', min: 0, max: 100, step: 1, default: 40, unit: '%',
      tip: 'Deixa cada raio diferente: comprimento, brilho e leve desvio de ângulo.' },
    { id: 'gaps', type: 'range', label: 'Falhas', min: 0, max: 100, step: 1, default: 45, unit: '%',
      tip: 'Variação suave de opacidade ao longo de cada raio, em pontos diferentes; no máximo apaga trechos.' },
    { id: 'disp', type: 'range', label: 'Dispersão (arco-íris)', chip: 'Dispersão', min: 0, max: 100, step: 1, default: 0, unit: '%',
      tip: 'Leve separação de cores ao longo dos raios, como em filtros estrela reais.' },
    { id: 'coreDisp', type: 'range', label: 'Brilho cromático', chip: 'Cromático', min: 0, max: 100, step: 1, default: 0, unit: '%',
      tip: 'Variação de cor no brilho do centro: bordas avermelhadas/azuladas e um halo nas cores do espectro.' },
    { id: 'color', type: 'color', label: 'Cor da luz', default: '#FFFFFF' },
    { id: 'seed', type: 'range', label: 'Aleatoriedade', min: 1, max: 100, step: 1, default: 1,
      tip: 'Sorteia outro padrão de variação e falhas.' },
  ],

  /** Ações extras no painel (o histórico desfaz). */
  actions: [
    { id: 'removeLast', label: 'Remover último ponto', run: (L, setStars) => setStars(L, L.params.stars.slice(0, -1)) },
    { id: 'clear', label: 'Limpar pontos', run: (L, setStars) => setStars(L, []) },
  ],

  render(r, src, w, h, p, target, img) {
    const stars = (p.stars || []).slice(0, MAX_STARS);
    if (!stars.length || p.intensity <= 0) return src.tex;
    const arr = new Float32Array(MAX_STARS * 2);
    stars.forEach((s, i) => { arr[i * 2] = s[0]; arr[i * 2 + 1] = s[1]; });
    const out = target(0);
    r.pass(r.program(FS), out, {
      uTex: src.tex, uRes: [w, h], uImg: [img.w, img.h],
      uLod: Math.max(0, Math.log2(Math.max(src.w / w, src.h / h))),
      uPx: img.w / w,
      'uStars[0]': arr, uCount: stars.length, uPoints: Math.round(p.points),
      uRot: (p.rotation * Math.PI) / 180, uLen: p.length, uCore: p.core, uThick: p.thickness,
      uInt: p.intensity / 100, uVar: p.variation / 100, uGaps: p.gaps / 100, uSeed: p.seed, uDisp: (p.disp || 0) / 100, uCoreDisp: (p.coreDisp || 0) / 100,
      uWide: p.wide || 0, uWideInt: (p.wideInt ?? 60) / 100,
      uColor: lightFromHex(p.color),
    });
    return out.tex;
  },
};

// Raios de luz (filtro estrela / cross screen): pontos de luz com raios em estrela.
//
// Os pontos são criados clicando/tocando na foto (parâmetro `stars`, em px da foto) e todos
// compartilham os mesmos ajustes. Cada raio recebe valores aleatórios próprios (comprimento,
// brilho, leve desvio de ângulo e falhas ao longo do traço), controlados por "Variação" e "Falhas".
// A luz é somada à foto em modo Tela (screen), como no Photoshop.

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
  float light = 0.0;
  float n = float(uPoints);

  for (int i = 0; i < ${MAX_STARS}; i++) {
    if (i >= uCount) break;
    vec2 d = p - uStars[i];
    float r2 = dot(d, d);
    if (uCore > 0.0) light += exp(-r2 / (cr * cr)) + 0.18 * cr * cr / (r2 + cr * cr);
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
      float w = th * (1.0 - 0.6 * u) + 1e-4;
      float across = exp(-(s * s) / (w * w));
      float along = pow(1.0 - u, 1.6) * (1.0 - uVar * 0.6 * rb);
      float gap = 1.0;
      if (uGaps > 0.001) {
        float g = vnoise(t / max(uLen * 0.05, 1.0), si + fk * 13.7);
        gap = mix(1.0, smoothstep(uGaps - 0.12, uGaps + 0.12, g), smoothstep(0.03, 0.18, u));
      }
      light += across * along * gap * gain * 1.4;
    }
  }
  vec3 add = clamp(uColor * light * uInt, 0.0, 1.0);
  outColor = vec4(1.0 - (1.0 - clamp(col.rgb, 0.0, 1.0)) * (1.0 - add), col.a);
}`;

function hueToRgb(h, s) {
  const k = (n) => (n + h / 30) % 12;
  const f = (n) => 1 - Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)].map((c) => 1 - s + s * c);
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
    { id: 'thickness', type: 'range', label: 'Espessura dos raios', chip: 'Espessura', min: 0.5, max: 20, step: 0.5, default: 2.5, unit: 'px' },
    { id: 'intensity', type: 'range', label: 'Intensidade', min: 0, max: 200, step: 1, default: 100, unit: '%' },
    { id: 'variation', type: 'range', label: 'Variação', min: 0, max: 100, step: 1, default: 40, unit: '%',
      tip: 'Deixa cada raio diferente: comprimento, brilho e leve desvio de ângulo.' },
    { id: 'gaps', type: 'range', label: 'Falhas', min: 0, max: 100, step: 1, default: 30, unit: '%',
      tip: 'Interrupções ao longo dos raios, em pontos diferentes de cada um.' },
    { id: 'sat', type: 'range', label: 'Saturação da cor', chip: 'Saturação', min: 0, max: 100, step: 1, default: 0, unit: '%' },
    { id: 'hue', type: 'range', label: 'Matiz', min: 0, max: 360, step: 1, default: 40, unit: '°' },
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
      uInt: p.intensity / 100, uVar: p.variation / 100, uGaps: p.gaps / 100, uSeed: p.seed,
      uColor: hueToRgb(p.hue, p.sat / 100),
    });
    return out.tex;
  },
};

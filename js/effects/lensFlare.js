// Lens flare: reflexos internos da lente a partir de uma fonte de luz.
//
// As fontes são pontos criados clicando/tocando na foto (parâmetro `sources`, em px da foto).
// Os reflexos ("fantasmas") ficam na linha que vai da fonte, passa pelo centro da foto e segue
// para o lado oposto — como numa lente real. Cada reflexo tem posição, tamanho, cor e suavidade
// sorteados pela semente; formato (círculo, polígono das lâminas do diafragma ou anel) e paleta
// de cores são escolhidos nos ajustes. A luz é somada em modo Tela.

import { hexToRgb } from '../ui.js';

const MAX_SOURCES = 8;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform vec2 uImg;
uniform float uLod;
uniform float uPx;
uniform vec2 uSrc[${MAX_SOURCES}];
uniform int uCount;
uniform float uSize;       // tamanho geral (px da foto)
uniform float uInt;
uniform int uGhosts;
uniform float uGhostSize;
uniform float uSpread;
uniform float uSoft;
uniform int uSides;        // 0 = círculo
uniform int uRingOnly;     // reflexos só com o contorno
uniform float uBladeRot;
uniform int uPalette;      // 0 natural, 1 arco-íris, 2 quente, 3 frio, 4 cor única
uniform vec3 uColor;
uniform vec3 uMainTint;
uniform float uCore;
uniform float uStreak;
uniform float uHalo;
uniform float uSpikes;
uniform float uSeed;
out vec4 outColor;

const float TAU = 6.2831853;
const float PI = 3.1415927;

float h1(float n) { return fract(sin(n * 127.1 + uSeed * 311.7) * 43758.5453); }

vec3 hsv(float h, float s, float v) {
  vec3 k = clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return v * mix(vec3(1.0), k, s);
}

vec3 ghostColor(float r) {
  if (uPalette == 1) return hsv(r, 0.75, 1.0);
  if (uPalette == 2) return hsv(mix(0.0, 0.13, r), 0.75, 1.0);
  if (uPalette == 3) return hsv(mix(0.48, 0.72, r), 0.7, 1.0);
  if (uPalette == 4) return uColor;
  int i = int(floor(r * 5.0));
  if (i == 0) return vec3(1.0, 0.55, 0.25);
  if (i == 1) return vec3(0.35, 1.0, 0.45);
  if (i == 2) return vec3(0.6, 0.35, 1.0);
  if (i == 3) return vec3(0.3, 0.75, 1.0);
  return vec3(1.0, 0.85, 0.4);
}

// Distância "de formato": círculo ou polígono regular de n lados (lâminas do diafragma).
float shapeDist(vec2 d) {
  float r = length(d);
  if (uSides < 3) return r;
  float n = float(uSides);
  float a = atan(d.y, d.x) + uBladeRot;
  float seg = TAU / n;
  return r * cos(PI / n) / cos(mod(a, seg) - seg * 0.5);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 col = textureLod(uTex, uv, uLod);
  vec2 p = uv * uImg;
  vec2 C = uImg * 0.5;
  vec3 lightC = vec3(0.0);
  vec3 ghosts = vec3(0.0);

  for (int s = 0; s < ${MAX_SOURCES}; s++) {
    if (s >= uCount) break;
    vec2 S = uSrc[s];
    vec2 d = p - S;
    float r = length(d);

    // Brilho central.
    if (uCore > 0.0) {
      float c = uSize * 0.06 * (0.3 + uCore);
      lightC += uCore * (exp(-r * r / (c * c)) * 1.2 + 0.35 * c * c / (r * r + c * c));
    }
    // Raio anamórfico (horizontal).
    if (uStreak > 0.0) {
      float sw = max(uSize * 0.004, uPx);
      float ax = abs(d.x);
      lightC += uStreak * (exp(-d.y * d.y / (sw * sw)) * exp(-ax / (uSize * 2.5))
                         + 0.3 * exp(-d.y * d.y / (36.0 * sw * sw)) * exp(-ax / (uSize * 1.2)));
    }
    // Anel em volta da fonte, com leve arco-íris.
    if (uHalo > 0.0) {
      float rr = r / (uSize * 0.75);
      float ring = exp(-pow((rr - 1.0) / 0.06, 2.0));
      vec3 spec = 0.6 + 0.4 * cos(TAU * ((rr - 1.0) * 6.0 + vec3(0.0, 0.33, 0.67)));
      ghosts += uHalo * 0.22 * ring * spec;
    }
    // Pequena estrela de 6 pontas.
    if (uSpikes > 0.0) {
      float seg = TAU / 6.0;
      float ad = mod(atan(d.y, d.x) + uBladeRot, seg) - seg * 0.5;
      float perp = r * abs(sin(ad));
      float sw = max(uPx, uSize * 0.003);
      lightC += uSpikes * exp(-perp * perp / (sw * sw)) * exp(-r / (uSize * 0.35));
    }

    // Reflexos ao longo do eixo fonte → centro → lado oposto.
    vec2 axis = S - C;
    for (int k = 0; k < 16; k++) {
      if (k >= uGhosts) break;
      float fk = float(k) * 13.7 + float(s) * 3.1;
      float t = mix(-0.3 - 1.2 * uSpread, 0.85, h1(fk));
      vec2 g = C + axis * t;
      float R = uSize * uGhostSize * mix(0.03, 0.32, pow(h1(fk + 1.3), 2.0)) * (1.0 + abs(t) * 0.25) + 1.0;
      vec2 dg = p - g;
      if (dot(dg, dg) > R * R * 2.5) continue;
      float dist = shapeDist(dg);
      float soft = clamp(uSoft * mix(0.6, 1.4, h1(fk + 2.9)), 0.02, 0.95);
      float fill = 1.0 - smoothstep(R * (1.0 - soft), R + uPx, dist);
      float rw = max(R * 0.05, uPx);
      float rim = exp(-pow((dist - R * 0.97) / rw, 2.0));
      float a = uRingOnly == 1 ? rim * 0.9 : fill * 0.6 + rim * 0.35 * (1.0 - soft);
      float alpha = mix(0.12, 0.5, h1(fk + 4.7));
      ghosts += ghostColor(h1(fk + 6.1)) * a * alpha;
    }
  }

  vec3 add = clamp((lightC * uMainTint + ghosts) * uInt, 0.0, 1.0);
  outColor = vec4(1.0 - (1.0 - clamp(col.rgb, 0.0, 1.0)) * (1.0 - add), col.a);
}`;

const G = 'Gerais';
const GH = 'Reflexos';
const CO = 'Cor';
const LI = 'Luz da fonte';
const VA = 'Variação';

const SHAPES = { circle: [0, 0], hex: [6, 0], pent: [5, 0], oct: [8, 0], ring: [0, 1] };
const isPolygon = (p) => ['hex', 'pent', 'oct'].includes(p.shape);

// Tom do brilho central/raios para cada paleta.
const MAIN_TINT = { natural: [1, 0.92, 0.8], rainbow: [1, 1, 1], warm: [1, 0.78, 0.5], cold: [0.65, 0.82, 1] };

export const lensFlare = {
  id: 'lens-flare',
  name: 'Lens flare',
  group: 'Luz e lente',
  description:
    'Cria os reflexos coloridos que aparecem quando uma luz forte (sol, poste, farol) entra na lente: brilho na fonte e uma fileira de círculos ou polígonos atravessando a foto.\n\nToque ou clique na foto para criar a fonte de luz. Os reflexos seguem a linha da fonte até o lado oposto do centro, como numa lente real. Escolha o formato (círculo, hexágono, pentágono, octógono ou anel), a paleta de cores e os elementos da luz (brilho, raio anamórfico, anel e estrela). A Semente — ou Sortear padrão — muda a posição, o tamanho e a cor de cada reflexo.',
  points: 'sources',
  maxPoints: MAX_SOURCES,
  hint: 'Clique ou toque na foto para criar uma fonte de luz. O último ponto tocado fica selecionado. Arraste um ponto para movê-lo; arraste para fora da foto para removê-lo.',
  opacityGroup: G,
  openGroups: [G, GH, CO, LI, VA],
  params: [
    { id: 'sources', type: 'points', default: [] },
    // Gerais
    { id: 'intensity', type: 'range', group: G, label: 'Intensidade', min: 0, max: 200, step: 1, default: 100, unit: '%' },
    { id: 'size', type: 'range', group: G, label: 'Tamanho', min: 50, max: 4000, step: 1, default: 600, unit: 'px', log: true,
      tip: 'Escala de todo o flare.' },
    // Reflexos
    { id: 'shape', type: 'select', group: GH, label: 'Formato', default: 'hex',
      options: [{ value: 'circle', label: 'Círculo' }, { value: 'hex', label: 'Hexágono' }, { value: 'pent', label: 'Pentágono' },
        { value: 'oct', label: 'Octógono' }, { value: 'ring', label: 'Anel' }] },
    { id: 'ghosts', type: 'range', group: GH, label: 'Quantidade', min: 0, max: 16, step: 1, default: 7 },
    { id: 'ghostSize', type: 'range', group: GH, label: 'Tamanho dos reflexos', min: 0, max: 100, step: 1, default: 50, unit: '%' },
    { id: 'spread', type: 'range', group: GH, label: 'Espalhamento', min: 0, max: 100, step: 1, default: 60, unit: '%',
      tip: 'Até onde os reflexos vão, do outro lado do centro da foto.' },
    { id: 'soft', type: 'range', group: GH, label: 'Suavidade', min: 0, max: 100, step: 1, default: 35, unit: '%',
      tip: 'Bordas nítidas ou reflexos difusos.' },
    { id: 'bladeRot', type: 'range', group: GH, label: 'Rotação do formato', min: -180, max: 180, step: 1, default: 0, unit: '°',
      showIf: isPolygon },
    // Cor
    { id: 'palette', type: 'select', group: CO, label: 'Paleta', default: 'natural',
      options: [{ value: 'natural', label: 'Natural' }, { value: 'rainbow', label: 'Arco-íris' }, { value: 'warm', label: 'Quente' },
        { value: 'cold', label: 'Frio' }, { value: 'single', label: 'Cor única', short: 'Única' }] },
    { id: 'color', type: 'color', group: CO, label: 'Cor', default: '#7FB8FF', showIf: (p) => p.palette === 'single' },
    // Luz da fonte
    { id: 'core', type: 'range', group: LI, label: 'Brilho central', min: 0, max: 100, step: 1, default: 60, unit: '%' },
    { id: 'halo', type: 'range', group: LI, label: 'Anel', min: 0, max: 100, step: 1, default: 30, unit: '%' },
    { id: 'streak', type: 'range', group: LI, label: 'Raio anamórfico', min: 0, max: 100, step: 1, default: 0, unit: '%',
      tip: 'Risco horizontal de luz, típico de lentes anamórficas de cinema.' },
    { id: 'spikes', type: 'range', group: LI, label: 'Estrela', min: 0, max: 100, step: 1, default: 0, unit: '%' },
    // Variação
    { id: 'seed', type: 'range', group: VA, label: 'Semente', min: 1, max: 999, step: 1, default: 1,
      tip: 'Sorteia outra posição, tamanho e cor para cada reflexo.' },
  ],

  actions: [
    { id: 'randomize', label: 'Sortear padrão', run: (L, _setPoints, setValue) => {
      let v;
      do v = 1 + Math.floor(Math.random() * 999); while (v === L.params.seed);
      setValue(L, 'seed', v);
    } },
    { id: 'deleteSelected', label: 'Excluir selecionado', run: (L, setPts) => {
      const pts = L.params.sources;
      const i = L.selPoint ?? pts.length - 1;
      if (i < 0 || i >= pts.length) return;
      const next = pts.filter((_, k) => k !== i);
      L.selPoint = next.length - 1;
      setPts(L, next);
    } },
    { id: 'clear', label: 'Excluir todos', run: (L, setPts) => { L.selPoint = -1; setPts(L, []); } },
  ],

  render(r, src, w, h, p, target, img) {
    const pts = (p.sources || []).slice(0, MAX_SOURCES);
    if (!pts.length || p.intensity <= 0) return src.tex;
    const arr = new Float32Array(MAX_SOURCES * 2);
    pts.forEach((s, i) => { arr[i * 2] = s[0]; arr[i * 2 + 1] = s[1]; });
    const [sides, ringOnly] = SHAPES[p.shape] || SHAPES.hex;
    const single = hexToRgb(p.color) || [0.5, 0.7, 1];
    const tint = p.palette === 'single' ? single.map((c) => 0.4 + 0.6 * c) : MAIN_TINT[p.palette] || MAIN_TINT.natural;
    const out = target(0);
    r.pass(r.program(FS), out, {
      uTex: src.tex, uRes: [w, h], uImg: [img.w, img.h],
      uLod: Math.max(0, Math.log2(Math.max(src.w / w, src.h / h))), uPx: img.w / w,
      'uSrc[0]': arr, uCount: pts.length,
      uSize: p.size, uInt: p.intensity / 100,
      uGhosts: Math.round(p.ghosts), uGhostSize: p.ghostSize / 100, uSpread: p.spread / 100, uSoft: p.soft / 100,
      uSides: sides, uRingOnly: ringOnly, uBladeRot: (p.bladeRot * Math.PI) / 180,
      uPalette: ({ natural: 0, rainbow: 1, warm: 2, cold: 3, single: 4 })[p.palette] ?? 0,
      uColor: single, uMainTint: tint,
      uCore: p.core / 100, uStreak: p.streak / 100, uHalo: p.halo / 100, uSpikes: p.spikes / 100, uSeed: p.seed,
    });
    return out.tex;
  },
};

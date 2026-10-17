// Vidro: a foto vista através de um vidro texturizado. Seis estilos (fosco, vitral, fractal,
// borrado, quebrado e blocos), cada um com três variações e uma semente: mudar a semente sorteia
// outro desenho no mesmo estilo. O padrão é calculado em px da FOTO, então prévia e exportação
// coincidem.
//
// Para cada pixel o estilo define: deslocamento (refração), desfoque (fosco, em disco ou em linha),
// tonalização (vitral), linhas (chumbo do vitral, rejunte dos blocos, rachaduras) e brilho de borda.

const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;      // resolução do passe (px)
uniform vec2 uImg;      // tamanho da foto (px)
uniform float uLod;
uniform float uPx;      // px da foto por px do passe
uniform int uStyle;     // 0 fosco, 1 vitral, 2 fractal, 3 borrado, 4 quebrado, 5 blocos
uniform int uVariant;   // 0..2
uniform float uScale;   // tamanho do padrão (px da foto)
uniform float uAmount;  // distorção 0..1
uniform float uFrost;   // fosco 0..1
uniform float uLines;   // bordas 0..1
uniform float uTint;    // cores do vitral 0..1
uniform float uRot;     // rotação (rad)
uniform float uSeed;
out vec4 outColor;

const float TAU = 6.2831853;

vec2 hash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973) + fract(uSeed * 0.1373) * 7.0);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float hash1(vec2 p) { return hash2(p).x; }

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash1(i), hash1(i + vec2(1, 0)), f.x), mix(hash1(i + vec2(0, 1)), hash1(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}

vec3 hsv(float h, float s, float v) {
  vec3 k = clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return v * mix(vec3(1.0), k, s);
}

// Voronoi com distância exata até a borda da célula. per > 0 repete o padrão em x a cada 'per' células.
// Devolve borda (dist. até a divisa), id da célula e o vetor do ponto da célula até x.
float voronoi(vec2 x, float jit, float per, out vec2 cid, out vec2 toC) {
  vec2 n = floor(x), f = fract(x);
  vec2 mg = vec2(0.0), mr = vec2(0.0);
  float md = 8.0;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(i, j);
    vec2 c = n + g;
    if (per > 0.0) c.x = mod(c.x, per);
    vec2 o = 0.5 + (hash2(c) - 0.5) * jit;
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = g; }
  }
  float bd = 8.0;
  for (int j = -2; j <= 2; j++)
  for (int i = -2; i <= 2; i++) {
    vec2 g = mg + vec2(i, j);
    vec2 c = n + g;
    if (per > 0.0) c.x = mod(c.x, per);
    vec2 o = 0.5 + (hash2(c) - 0.5) * jit;
    vec2 r = g + o - f;
    if (dot(mr - r, mr - r) > 1e-5) bd = min(bd, dot(0.5 * (mr + r), normalize(r - mr)));
  }
  cid = n + mg;
  if (per > 0.0) cid.x = mod(cid.x, per);
  toC = -mr;
  return bd;
}

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = uv * uImg;                       // px da foto
  float s = uScale;
  float A = uAmount;
  mat2 R = rot(uRot);
  mat2 Ri = rot(-uRot);
  vec2 q = R * (p - uImg * 0.5) / s;         // coordenadas do padrão (1 = tamanho do padrão)
  float aa = uPx / s * 1.2;                 // meia largura de 1 px da prévia, em unidades do padrão

  vec2 off = vec2(0.0);       // deslocamento em px da foto (no espaço do padrão; gira no fim)
  float blurR = 0.0;          // raio do desfoque em disco (px da foto)
  vec2 blurV = vec2(0.0);     // desfoque em linha (px da foto, espaço do padrão)
  vec3 tint = vec3(1.0);
  float line = 0.0;           // 0..1 cobertura da linha (chumbo / rejunte / rachadura)
  vec3 lineCol = vec3(0.06);
  float hi = 0.0;             // brilho somado
  float frostMask = 1.0;
  vec2 jit = hash2(floor(p) + 0.37) - 0.5;  // granulado por pixel da foto

  if (uStyle == 0) {
    // ---- Fosco ----
    if (uVariant == 0) {
      // Fino: jateado uniforme.
      off = jit * A * s * 1.2;
    } else if (uVariant == 1) {
      // Gelo: cristais, cada um refrata para um lado, com arestas claras.
      vec2 cid, toC;
      float bd = voronoi(q * 1.6, 1.0, 0.0, cid, toC);
      off = (hash2(cid + 4.1) - 0.5) * A * s * 0.7 + jit * A * s * 0.15;
      hi = uLines * 0.18 * (1.0 - smoothstep(0.0, 0.03 + aa, bd));
    } else {
      // Nevoado: manchas foscas alternando com áreas quase limpas.
      frostMask = smoothstep(0.35, 0.65, fbm(q * 0.45 + 3.7));
      off = jit * A * s * 1.2 * frostMask;
    }
    blurR = uFrost * s * 0.8 * frostMask;
  } else if (uStyle == 1) {
    // ---- Vitral ----
    vec2 cid, local;
    float bd;
    vec2 qs = q * 0.6;
    float aas = aa * 0.6;
    if (uVariant == 0) {
      bd = voronoi(qs, 0.9, 0.0, cid, local);
    } else if (uVariant == 1) {
      vec2 d = rot(0.785398) * qs * 1.2;
      cid = floor(d);
      vec2 f = fract(d) - 0.5;
      local = f;
      bd = (0.5 - max(abs(f.x), abs(f.y))) / 1.2;
    } else {
      vec2 hr = vec2(1.0, 1.7320508);
      vec2 a = mod(qs, hr) - hr * 0.5;
      vec2 b = mod(qs - hr * 0.5, hr) - hr * 0.5;
      vec2 gv = dot(a, a) < dot(b, b) ? a : b;
      cid = floor((qs - gv) * 2.0 + 0.5);
      local = gv;
      float hx = max(dot(abs(gv), normalize(vec2(1.0, 1.7320508))), abs(gv).x);
      bd = 0.5 - hx;
    }
    // Cada vidro desloca a imagem de um jeito, com textura martelada leve.
    off = (-local * 0.6 + (hash2(cid + 1.3) - 0.5) * 0.5) * A * s * 1.6;
    off += (vec2(vnoise(q * 7.0), vnoise(q * 7.0 + 3.1)) - 0.5) * A * s * 0.12;
    vec3 c = hsv(hash1(cid + 7.7), 0.55 + 0.35 * hash1(cid + 2.2), 1.0);
    tint = mix(vec3(1.0), c * 1.15, uTint);
    float w = 0.008 + uLines * 0.04;
    line = 1.0 - smoothstep(w - aas, w + aas, bd);
    hi = 0.12 * uLines * (1.0 - smoothstep(w, w + 0.06, bd)) * (1.0 - line);
    blurR = uFrost * s * 0.15;
  } else if (uStyle == 2) {
    // ---- Fractal (vidro canelado) ----
    float t;
    vec2 dir = vec2(1.0, 0.0);
    if (uVariant == 0) {
      t = q.x;
    } else if (uVariant == 1) {
      t = q.x + sin(q.y * 0.5 + hash1(vec2(3.0)) * TAU) * 0.7;
    } else {
      vec2 c = (hash2(vec2(7.0, 3.0)) - 0.5) * (uImg / s) * 0.4;
      vec2 d = q - c;
      t = length(d);
      dir = d / max(t, 1e-4);
    }
    float fi = floor(t);
    float f = fract(t);
    // Cada canelura é uma lente cilíndrica: espelha/estica uma faixa da imagem.
    float shift = (f - 0.5) * 1.6 + (hash1(vec2(fi, 9.0)) - 0.5) * 0.5;
    off = dir * shift * A * s;
    hi = uLines * 0.22 * smoothstep(0.8, 1.0, f);
    tint = vec3(1.0 - uLines * 0.3 * (1.0 - smoothstep(0.0, 0.15, f)));
    blurR = uFrost * s * 0.15;
  } else if (uStyle == 3) {
    // ---- Borrado ----
    if (uVariant == 0) {
      // Manchas: marcas de dedo e gordura, arrastando a imagem em direções suaves.
      vec2 w2 = vec2(fbm(q * 0.35), fbm(q * 0.35 + vec2(5.2, 1.3))) - 0.5;
      frostMask = smoothstep(0.35, 0.65, fbm(q * 0.2 + 9.0));
      off = w2 * A * s * 4.0 * frostMask;
      blurV = normalize(w2 + 1e-4) * A * s * 2.5 * frostMask;
    } else if (uVariant == 1) {
      // Escorrido: gotas e escorridos verticais.
      float n = fbm(vec2(q.x * 0.9, q.y * 0.05 + 2.0));
      frostMask = smoothstep(0.4, 0.7, n);
      off = vec2((n - 0.5) * 0.6, n * 2.0) * A * s * frostMask;
      blurV = vec2(0.0, A * s * 4.0 * frostMask);
    } else {
      // Redemoinho: arrastado em curvas.
      float a = fbm(q * 0.2) * TAU * 2.0;
      vec2 v = vec2(cos(a), sin(a));
      frostMask = 0.5 + 0.5 * smoothstep(0.3, 0.7, fbm(q * 0.15 + 4.0));
      off = v * A * s * 2.0 * frostMask;
      blurV = vec2(-v.y, v.x) * A * s * 2.5 * frostMask;
    }
    blurR = uFrost * s * 0.3 * frostMask;
  } else if (uStyle == 4) {
    // ---- Quebrado ----
    vec2 c = uImg * 0.5 + (hash2(vec2(1.7, 9.2)) - 0.5) * uImg * 0.4;
    vec2 d = (p - c) / s;
    float r = length(d);
    float ang = atan(d.y, d.x) / TAU + 0.5;
    vec2 cid, toC;
    float bd;
    if (uVariant == 0) {
      // Estilhaços: cacos que saem do ponto de impacto.
      bd = voronoi(vec2(ang * 18.0, log(1.0 + r * 1.5) * 4.0), 1.0, 18.0, cid, toC);
    } else if (uVariant == 1) {
      // Rachado: cacos irregulares pelo vidro todo.
      bd = voronoi(q * 0.35, 1.0, 0.0, cid, toC);
    } else {
      // Teia: raios e anéis mais regulares.
      bd = voronoi(vec2(ang * 11.0, log(1.0 + r * 1.2) * 2.6), 0.3, 11.0, cid, toC);
    }
    off = (hash2(cid + 5.5) - 0.5) * A * s * 1.2;
    tint = vec3(1.0 + (hash1(cid + 8.1) - 0.5) * 0.3 * A);
    float w = 0.002 + uLines * 0.012;
    line = (1.0 - smoothstep(w - aa * 0.5, w + aa * 0.5, bd)) * 0.75;
    lineCol = vec3(0.95);
    hi = uLines * 0.1 * (1.0 - smoothstep(w, w + 0.05, bd));
    // Perto do impacto o vidro fica pulverizado.
    frostMask = exp(-r * 1.5);
    blurR = (uFrost * 0.2 + frostMask * A * 0.5) * s * 0.4;
  } else {
    // ---- Blocos ----
    vec2 g = q;
    float cs = 1.0;
    if (uVariant == 1) { g = vec2(q.x * 0.5, q.y); g.x += 0.5 * mod(floor(g.y), 2.0); }
    if (uVariant == 2) { cs = 0.35; g = q / cs; }
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float e = (0.5 - max(abs(f.x), abs(f.y))) * cs;   // distância até a borda (unidades do padrão)
    if (uVariant == 2) {
      // Pastilhas: pequenos vidros abaulados.
      off = f * A * s * cs * 0.8;
    } else {
      // Bloco de vidro: imagem invertida e ondulada dentro de cada bloco.
      off = -f * A * s * 1.2 * (uVariant == 1 ? vec2(2.0, 1.0) : vec2(1.0));
      off += vec2(sin(f.y * 12.566 + hash1(id) * TAU), sin(f.x * 12.566 + hash1(id + 2.0) * TAU)) * A * s * 0.05;
    }
    float w = (0.004 + uLines * 0.025) * cs;
    line = 1.0 - smoothstep(w - aa, w + aa, e);
    lineCol = vec3(0.72);
    float bevel = 1.0 - smoothstep(w, w + 0.12 * cs, e);
    float lit = dot(normalize(f + 1e-4), vec2(-0.707, -0.707));
    hi = uLines * 0.25 * bevel * lit;
    blurR = uFrost * s * 0.2 * cs;
  }

  // Volta do espaço do padrão para a foto (rotação).
  off = Ri * off;
  blurV = Ri * blurV;
  vec2 base = p + off;

  vec3 col;
  float alpha;
  if (blurR < 0.5 && length(blurV) < 0.5) {
    vec4 c = textureLod(uTex, clamp(base / uImg, 0.0, 1.0), uLod);
    col = c.rgb;
    alpha = c.a;
  } else {
    vec4 acc = vec4(0.0);
    for (int k = 0; k < 16; k++) {
      vec2 h = hash2(floor(p) + float(k) * 13.17);
      float fk = (float(k) + h.x) / 16.0 - 0.5;
      vec2 disk = sqrt(h.x) * vec2(cos(h.y * TAU), sin(h.y * TAU)) * blurR;
      acc += textureLod(uTex, clamp((base + disk + blurV * fk) / uImg, 0.0, 1.0), uLod);
    }
    col = acc.rgb / 16.0;
    alpha = acc.a / 16.0;
  }
  col *= tint;
  col = mix(col, lineCol, clamp(line, 0.0, 1.0));
  col += hi;
  outColor = vec4(col, alpha);
}`;

const STYLES = ['frost', 'stained', 'fractal', 'smudge', 'broken', 'blocks'];
const is = (st) => (p) => p.style === st;
const variant = (id, st, labels) => ({
  id, type: 'select', label: 'Variação', default: '0', showIf: is(st),
  options: labels.map((label, i) => ({ value: String(i), label })),
});
const VARIANT_OF = { frost: 'vFrost', stained: 'vStained', fractal: 'vFractal', smudge: 'vSmudge', broken: 'vBroken', blocks: 'vBlocks' };

export const glass = {
  id: 'glass',
  name: 'Vidro',
  group: 'Estilização',
  params: [
    { id: 'style', type: 'select', label: 'Estilo', default: 'frost',
      options: [
        { value: 'frost', label: 'Fosco' }, { value: 'stained', label: 'Vitral' }, { value: 'fractal', label: 'Fractal' },
        { value: 'smudge', label: 'Borrado' }, { value: 'broken', label: 'Quebrado' }, { value: 'blocks', label: 'Blocos' },
      ] },
    variant('vFrost', 'frost', ['Fino', 'Gelo', 'Nevoado']),
    variant('vStained', 'stained', ['Celular', 'Losangos', 'Hexágonos']),
    variant('vFractal', 'fractal', ['Retas', 'Onduladas', 'Concêntricas']),
    variant('vSmudge', 'smudge', ['Manchas', 'Escorrido', 'Redemoinho']),
    variant('vBroken', 'broken', ['Estilhaços', 'Rachado', 'Teia']),
    variant('vBlocks', 'blocks', ['Quadrados', 'Tijolos', 'Pastilhas']),
    { id: 'seed', type: 'range', label: 'Semente', min: 1, max: 999, step: 1, default: 1,
      tip: 'Sorteia outro desenho no mesmo estilo.' },
    { id: 'scale', type: 'range', label: 'Tamanho do padrão', chip: 'Tamanho', min: 4, max: 600, step: 1, default: 60, unit: 'px', log: true },
    { id: 'amount', type: 'range', label: 'Distorção', min: 0, max: 100, step: 1, default: 50, unit: '%',
      tip: 'Quanto o vidro desvia a imagem.' },
    { id: 'frost', type: 'range', label: 'Fosco', min: 0, max: 100, step: 1, default: 30, unit: '%',
      tip: 'Desfoque do vidro (jateado).' },
    { id: 'lines', type: 'range', label: 'Bordas', min: 0, max: 100, step: 1, default: 50, unit: '%',
      tip: 'Chumbo do vitral, rejunte dos blocos, rachaduras e brilho das arestas.' },
    { id: 'tint', type: 'range', label: 'Cores do vitral', chip: 'Cores', min: 0, max: 100, step: 1, default: 60, unit: '%',
      showIf: is('stained') },
    { id: 'rotation', type: 'range', label: 'Rotação', min: -180, max: 180, step: 1, default: 0, unit: '°' },
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
    const style = Math.max(0, STYLES.indexOf(p.style));
    r.pass(r.program(FS), out, {
      uTex: src.tex, uRes: [w, h], uImg: [img.w, img.h],
      uLod: Math.max(0, Math.log2(Math.max(src.w / w, src.h / h))), uPx: img.w / w,
      uStyle: style, uVariant: Number(p[VARIANT_OF[p.style]] || 0),
      uScale: p.scale, uAmount: p.amount / 100, uFrost: p.frost / 100, uLines: p.lines / 100,
      uTint: p.tint / 100, uRot: (p.rotation * Math.PI) / 180, uSeed: p.seed,
    });
    return out.tex;
  },
};

// Pipeline de renderização com camadas de efeito:
//
//   foto ─► camada 1 ─► camada 2 ─► … ─► resultado ─► tela / exportação
//
// Cada camada recebe o resultado das camadas de baixo, calcula o seu efeito (fx) e o mistura com a
// entrada conforme a máscara e as opacidades (out). Na prévia, fx e out de cada camada ficam guardados:
// mexer numa camada recalcula só ela e as de cima; pintar a máscara refaz só a mistura.
//
// O canal alfa de "out" guarda quanto da foto original ainda passa intacto (1 = nenhum efeito).
// Na tela isso permite mostrar a foto em resolução TOTAL nas áreas sem efeito, mesmo que a pilha
// seja calculada na resolução de prévia:  tela = fração·original_total + (resultado − fração·original_prévia).

import { createProgram, useProgram, createTarget, deleteTarget, GLSL_HASH } from './glutil.js';

const MIX_FS = `#version 300 es
precision highp float;
uniform sampler2D uIn;
uniform float uInLod;
uniform bool uFirst;        // a entrada é a foto original (alfa da foto não conta)
uniform sampler2D uFx;
uniform float uFxLod;
uniform sampler2D uMask;
uniform sampler2D uStroke;
uniform int uStrokeMode;    // 0 nenhum, 1 marcar área, 2 desmarcar área
uniform float uMaskOpacity;
uniform float uFxOpacity;
uniform vec2 uRes;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 inC = textureLod(uIn, uv, uInLod);
  vec3 fx = textureLod(uFx, uv, uFxLod).rgb;
  float m = texture(uMask, uv).r;
  float s = clamp(texture(uStroke, uv).a, 0.0, 1.0);
  if (uStrokeMode == 1) m = m + (1.0 - m) * s;
  else if (uStrokeMode == 2) m = m * (1.0 - s);
  float a = (1.0 - m * uMaskOpacity) * uFxOpacity;
  float keep = (uFirst ? 1.0 : inC.a) * (1.0 - a);
  outColor = vec4(mix(inC.rgb, fx, a), keep);
}`;

const COPY_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uLod;
uniform vec2 uRes;
out vec4 outColor;
void main() { outColor = textureLod(uTex, gl_FragCoord.xy / uRes, uLod); }`;

// Saída final da exportação: só cor, alfa opaco e dithering contra banding.
const FINAL_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uLod;
uniform vec2 uRes;
out vec4 outColor;
${GLSL_HASH}
void main() {
  vec3 c = textureLod(uTex, gl_FragCoord.xy / uRes, uLod).rgb;
  c += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  outColor = vec4(c, 1.0);
}`;

const DISPLAY_FS = `#version 300 es
precision highp float;
uniform sampler2D uOrig;
uniform sampler2D uFinal;
uniform bool uHasFinal;
uniform float uLowLod;      // mipmap da foto equivalente à resolução da prévia
uniform sampler2D uMask;
uniform sampler2D uStroke;
uniform int uStrokeMode;
uniform vec2 uCanvas;
uniform vec2 uOffset;
uniform float uScale;
uniform vec2 uImg;
uniform bool uShowOriginal;
uniform bool uShowMask;
uniform vec3 uBg;
out vec4 outColor;
${GLSL_HASH}
void main() {
  vec2 fc = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);
  vec2 uv = (fc - uOffset) / uScale / uImg;

  // Amostras antes de qualquer desvio de fluxo (derivadas implícitas precisam de fluxo uniforme).
  vec3 origFull = texture(uOrig, uv).rgb;
  vec3 origLow = textureLod(uOrig, uv, uLowLod).rgb;
  vec4 fin = texture(uFinal, uv);
  float m = texture(uMask, uv).r;
  float s = clamp(texture(uStroke, uv).a, 0.0, 1.0);

  vec3 col = origFull;
  if (uHasFinal && !uShowOriginal) col = fin.a * origFull + (fin.rgb - fin.a * origLow);
  if (uShowMask) {
    if (uStrokeMode == 1) m = m + (1.0 - m) * s;
    else if (uStrokeMode == 2) m = m * (1.0 - s);
    col = mix(col, vec3(1.0, 0.12, 0.18), m * 0.55);
  }
  col += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;

  bool inside = all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)));
  outColor = vec4(inside ? col : uBg, 1.0);
}`;

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('Seu navegador não suporta WebGL2.');
    this.gl = gl;
    this.canvas = canvas;

    const hasFloat = !!gl.getExtension('EXT_color_buffer_float');
    this.hasFloat = hasFloat;
    this.fmt8 = { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
    // Buffers intermediários em meia precisão evitam perda de qualidade entre passes e camadas.
    this.fmtWork = hasFloat ? { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT } : this.fmt8;
    this.maxTex = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), 16384);

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    this.triVao = this._vao([-1, -1, 3, -1, -1, 3]);
    this.quadVao = this._vao([-1, -1, 1, -1, -1, 1, 1, 1]);
    this._programs = new Map();

    this.src = null;            // { tex, w, h } foto original com mipmaps
    this.pool = [];             // alvos de trabalho dos efeitos (prévia)
    this.stackSize = [0, 0];    // resolução da prévia da pilha
    this._scratch = new Map();  // alvos auxiliares nomeados (ex.: desfoque em resolução reduzida)
    this._exporting = null;     // durante a exportação: { temps, fmt }
    this.bg = [0x16 / 255, 0x16 / 255, 0x16 / 255];
    this._magNearest = false;

    // Texturas 1×1 vazias para quando não há traço / máscara.
    this.emptyTex = this._tex1x1([0, 0, 0, 0]);
  }

  _tex1x1(rgba) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
    return t;
  }

  _vao(points) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }

  /** Compila (com cache) um programa a partir do fragment shader. */
  program(fs, vs) {
    const key = (vs || '') + '\u0000' + fs;
    let p = this._programs.get(key);
    if (!p) {
      p = createProgram(this.gl, fs, vs);
      this._programs.set(key, p);
    }
    return p;
  }

  /** Executa um passe de tela cheia em `target` (ou na tela, se null). */
  pass(prog, target, uniforms) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    if (target) gl.viewport(0, 0, target.w, target.h);
    else gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    useProgram(gl, prog, uniforms);
    gl.bindVertexArray(this.triVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  /** Carrega a foto (ImageBitmap/canvas) como textura com mipmaps. */
  setImage(source, w, h) {
    const gl = this.gl;
    if (this.src) gl.deleteTexture(this.src.tex);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    this._magNearest = false;
    this.src = { tex, w, h };
  }

  /** Resolução da prévia: lado maior até previewLong. */
  previewSize(previewLong) {
    const { w: sw, h: sh } = this.src;
    const k = Math.min(1, previewLong / Math.max(sw, sh));
    return [Math.max(1, Math.round(sw * k)), Math.max(1, Math.round(sh * k))];
  }

  /**
   * Alvo auxiliar de tamanho livre para efeitos (ex.: desfoque gaussiano em resolução reduzida).
   * Na prévia fica guardado e é reaproveitado; na exportação é temporário.
   */
  scratch(name, w, h) {
    const gl = this.gl;
    if (this._exporting) {
      const t = createTarget(gl, w, h, this._exporting.fmt);
      this._exporting.temps.push(t);
      return t;
    }
    let t = this._scratch.get(name);
    if (!t || t.w !== w || t.h !== h) {
      deleteTarget(gl, t);
      t = createTarget(gl, w, h, this.fmtWork);
      this._scratch.set(name, t);
    }
    return t;
  }

  _ensurePool(w, h) {
    if (this.pool.length && this.pool[0].w === w && this.pool[0].h === h) return;
    for (const t of this.pool) deleteTarget(this.gl, t);
    this.pool = [createTarget(this.gl, w, h, this.fmtWork), createTarget(this.gl, w, h, this.fmtWork)];
  }

  _lodFor(tex, w, h) {
    return tex === this.src.tex ? Math.max(0, Math.log2(Math.max(this.src.w / w, this.src.h / h))) : 0;
  }

  /** Libera as texturas de prévia de uma camada. */
  disposeLayer(L) {
    deleteTarget(this.gl, L.fx);
    deleteTarget(this.gl, L.out);
    L.fx = L.out = null;
  }

  _mix(target, input, fxTex, L, stroke) {
    const [w, h] = [target.w, target.h];
    this.pass(this.program(MIX_FS), target, {
      uIn: input.tex, uInLod: this._lodFor(input.tex, w, h), uFirst: input.tex === this.src.tex,
      uFx: fxTex, uFxLod: this._lodFor(fxTex, w, h),
      uMask: L.mask ? L.mask.tex : this.emptyTex,
      uStroke: stroke ? stroke.tex : this.emptyTex,
      uStrokeMode: stroke ? stroke.mode : 0,
      uMaskOpacity: L.maskOpacity / 100, uFxOpacity: L.fxOpacity / 100, uRes: [w, h],
    });
  }

  /**
   * Atualiza a pilha na resolução de prévia e devolve a textura do resultado (ou null sem camadas).
   * Camadas com fxDirty refazem o efeito; com mixDirty, só a mistura. Tudo acima de uma camada
   * alterada é refeito. `stroke` = { layer, mode, tex } durante uma pincelada.
   */
  updateStack(layers, { previewLong, live = false, stroke = null }) {
    const [w, h] = this.previewSize(previewLong);
    if (w !== this.stackSize[0] || h !== this.stackSize[1]) {
      for (const L of layers) { this.disposeLayer(L); L.fxDirty = true; }
      this.stackSize = [w, h];
    }
    this._ensurePool(w, h);
    const img = { w: this.src.w, h: this.src.h };
    let input = { tex: this.src.tex, w: this.src.w, h: this.src.h };
    let changed = false;
    let top = null;
    for (const L of layers) {
      if (!L.visible) continue;
      if (!L.fx || L.fx.w !== w || L.fx.h !== h) {
        this.disposeLayer(L);
        L.fx = createTarget(this.gl, w, h, this.fmtWork);
        L.out = createTarget(this.gl, w, h, this.fmtWork);
        L.fxDirty = true;
      }
      const redoFx = L.fxDirty || changed || (L.draft && !live);
      if (redoFx) {
        const p = live && 'quality' in L.params ? { ...L.params, quality: 'draft' } : L.params;
        const res = L.effect.render(this, input, w, h, p, (i) => this.pool[i % 2], img);
        this.pass(this.program(COPY_FS), L.fx, { uTex: res, uLod: this._lodFor(res, w, h), uRes: [w, h] });
        L.fxDirty = false;
        L.draft = live;
      }
      const strokeHere = stroke && stroke.layer === L ? stroke : null;
      if (redoFx || L.mixDirty || changed || strokeHere) {
        this._mix(L.out, input, L.fx.tex, L, strokeHere);
        L.mixDirty = false;
        changed = true;
      }
      input = { tex: L.out.tex, w, h };
      top = L;
    }
    return top ? top.out.tex : null;
  }

  /** Desenha na tela: resultado da pilha (ou a foto original) e, se pedido, a área marcada. */
  drawScreen({ view, dpr, final, mask, stroke, showOriginal, showMask }) {
    const gl = this.gl;
    const cw = gl.drawingBufferWidth, ch = gl.drawingBufferHeight;
    if (!this.src) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, cw, ch);
      gl.clearColor(this.bg[0], this.bg[1], this.bg[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    const scale = view.scale * dpr;
    // Acima de 200% mostra pixels nítidos (como no Photoshop) para inspecionar detalhes da máscara.
    const nearest = scale >= 2;
    if (nearest !== this._magNearest) {
      gl.bindTexture(gl.TEXTURE_2D, this.src.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
      this._magNearest = nearest;
    }
    const [w, h] = this.stackSize;
    this.pass(this.program(DISPLAY_FS), null, {
      uOrig: this.src.tex,
      uFinal: final || this.emptyTex,
      uHasFinal: !!final,
      uLowLod: w ? Math.max(0, Math.log2(Math.max(this.src.w / w, this.src.h / h))) : 0,
      uMask: mask ? mask.tex : this.emptyTex,
      uStroke: stroke ? stroke.tex : this.emptyTex,
      uStrokeMode: stroke ? stroke.mode : 0,
      uCanvas: [cw, ch],
      uOffset: [view.x * dpr, view.y * dpr],
      uScale: scale,
      uImg: [this.src.w, this.src.h],
      uShowOriginal: !!showOriginal,
      uShowMask: !!showMask && !!mask,
      uBg: this.bg,
    });
  }

  /**
   * Processa a pilha em resolução total e devolve ImageData.
   * Usa só 3 alvos em rodízio (entrada, trabalho e saída) para caber na memória de vídeo.
   */
  exportStack(layers, { lowMemory = false } = {}) {
    const gl = this.gl;
    const { w, h } = this.src;
    const temps = [];
    const make = (fmt) => { const t = createTarget(gl, w, h, fmt); temps.push(t); return t; };
    const free = (t) => { deleteTarget(gl, t); temps.splice(temps.indexOf(t), 1); };
    if (this._magNearest) {
      gl.bindTexture(gl.TEXTURE_2D, this.src.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      this._magNearest = false;
    }
    try {
      // Fotos muito grandes ou aparelhos com pouca memória: buffers de 8 bits (metade da memória).
      const fmt = lowMemory || w * h > 16e6 ? this.fmt8 : this.fmtWork;
      const visible = layers.filter((L) => L.visible);
      const T = visible.length ? [make(fmt), make(fmt), make(fmt)] : [];
      this._exporting = { temps, fmt };
      const img = { w, h };
      let input = { tex: this.src.tex, w, h };
      let inputT = null;
      for (const L of visible) {
        const freeT = T.filter((t) => t !== inputT);
        const res = L.effect.render(this, input, w, h, L.params, (i) => freeT[i % 2], img);
        const outT = T.find((t) => t !== inputT && t.tex !== res);
        this._mix(outT, input, res, L, null);
        input = { tex: outT.tex, w, h };
        inputT = outT;
      }
      for (const t of T) if (t !== inputT) free(t);
      const out = make(this.fmt8);
      this.pass(this.program(FINAL_FS), out, { uTex: input.tex, uLod: 0, uRes: [w, h] });

      const data = new Uint8ClampedArray(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
      gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
      // Lê em faixas para não travar drivers com uma leitura gigante única.
      const band = Math.max(1, Math.floor((64 * 1024 * 1024) / (w * 4)));
      for (let y = 0; y < h; y += band) {
        const bh = Math.min(band, h - y);
        gl.readPixels(0, y, w, bh, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(data.buffer, y * w * 4, w * bh * 4));
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (gl.getError() === gl.OUT_OF_MEMORY) throw new Error('Memória de vídeo insuficiente para exportar.');
      return new ImageData(data, w, h);
    } finally {
      this._exporting = null;
      for (const t of [...temps]) deleteTarget(gl, t);
    }
  }
}

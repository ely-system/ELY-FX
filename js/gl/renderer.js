// Pipeline de renderização:
//   foto original ──► efeito (N passes, resolução de prévia ou total) ──► composição com máscara ──► tela / exportação
//
// O efeito só é recalculado quando os parâmetros mudam. Pintar a máscara, dar zoom ou mover a
// visualização só refaz a composição final, que é barata.

import { createProgram, useProgram, createTarget, deleteTarget, GLSL_HASH } from './glutil.js';

const COMPOSITE_FS = `#version 300 es
precision highp float;
uniform sampler2D uOrig;
uniform sampler2D uFx;
uniform sampler2D uMask;
uniform sampler2D uStroke;
uniform vec2 uCanvas;      // tamanho do alvo em px
uniform vec2 uOffset;      // posição (px do alvo) do canto superior esquerdo da imagem
uniform float uScale;      // px do alvo por px da imagem
uniform vec2 uImg;         // tamanho da imagem em px
uniform bool uFlipY;       // true quando o alvo é a tela (origem embaixo)
uniform int uStrokeMode;   // 0 nenhum, 1 marcar área, 2 desmarcar área
uniform float uMaskOpacity; // opacidade geral da máscara
uniform bool uShowOriginal;
uniform bool uShowMask;
uniform vec3 uBg;
out vec4 outColor;
${GLSL_HASH}
void main() {
  vec2 fc = gl_FragCoord.xy;
  if (uFlipY) fc.y = uCanvas.y - fc.y;
  vec2 uv = (fc - uOffset) / uScale / uImg;

  // Amostras antes de qualquer desvio de fluxo (derivadas implícitas precisam de fluxo uniforme).
  vec3 orig = texture(uOrig, uv).rgb;
  vec3 fx = texture(uFx, uv).rgb;
  float m = texture(uMask, uv).r;            // área marcada (1 = sem efeito)
  float s = clamp(texture(uStroke, uv).a, 0.0, 1.0);

  if (uStrokeMode == 1) m = m + (1.0 - m) * s;
  else if (uStrokeMode == 2) m = m * (1.0 - s);

  float amount = 1.0 - m * uMaskOpacity;
  vec3 col = uShowOriginal ? orig : mix(orig, fx, amount);
  if (uShowMask) col = mix(col, vec3(1.0, 0.12, 0.18), m * 0.55);
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
    // Buffers intermediários em meia precisão evitam perda de qualidade entre passes do desfoque.
    this.fmtWork = hasFloat ? { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT } : this.fmt8;
    this.maxTex = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), 16384);

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    this.triVao = this._vao([-1, -1, 3, -1, -1, 3]);
    this.quadVao = this._vao([-1, -1, 1, -1, -1, 1, 1, 1]);

    this._programs = new Map();
    this.composite = this.program(COMPOSITE_FS);

    this.src = null;           // { tex, w, h }
    this.pool = [];            // render targets da prévia
    this.fxTex = null;
    this.fxSize = [0, 0];
    this.bg = [0x16 / 255, 0x16 / 255, 0x16 / 255];
    this._magNearest = false;

    // Textura 1×1 vazia usada como "traço" quando não há pincelada ativa.
    this.emptyTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.emptyTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
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
    this.fxTex = null;
  }

  _ensurePool(w, h) {
    if (this.pool.length && this.pool[0].w === w && this.pool[0].h === h) return;
    for (const t of this.pool) deleteTarget(this.gl, t);
    this.pool = [createTarget(this.gl, w, h, this.fmtWork), createTarget(this.gl, w, h, this.fmtWork)];
  }

  /** Recalcula o efeito na resolução de prévia (lado maior <= previewLong). */
  updateFx(effect, params, previewLong) {
    const { w: sw, h: sh } = this.src;
    const k = Math.min(1, previewLong / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * k));
    const h = Math.max(1, Math.round(sh * k));
    this._ensurePool(w, h);
    this.fxTex = effect.render(this, this.src, w, h, params, (i) => this.pool[i % 2]);
    this.fxSize = [w, h];
  }

  /** Desenha a composição na tela. */
  drawScreen({ view, dpr, mask, stroke, maskOpacity, showOriginal, showMask }) {
    const gl = this.gl;
    const cw = gl.drawingBufferWidth, ch = gl.drawingBufferHeight;
    if (!this.src || !this.fxTex) {
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
    this.pass(this.composite, null, {
      uOrig: this.src.tex,
      uFx: this.fxTex,
      uMask: mask.tex,
      uStroke: stroke ? mask.strokeTex : this.emptyTex,
      uCanvas: [cw, ch],
      uOffset: [view.x * dpr, view.y * dpr],
      uScale: scale,
      uImg: [this.src.w, this.src.h],
      uFlipY: true,
      uStrokeMode: stroke ? stroke.mode : 0,
      uMaskOpacity: maskOpacity,
      uShowOriginal: !!showOriginal,
      uShowMask: !!showMask,
      uBg: this.bg,
    });
  }

  /** Renderiza em resolução total e devolve ImageData. */
  exportImage(effect, params, mask, maskOpacity, { lowMemory = false } = {}) {
    const gl = this.gl;
    const { w, h } = this.src;
    const temps = [];
    const target = (fmt) => { const t = createTarget(gl, w, h, fmt); temps.push(t); return t; };
    try {
      // Em aparelhos com pouca memória usa buffers de 8 bits (metade da memória).
      const work = lowMemory ? this.fmt8 : this.fmtWork;
      const pool = [target(work), target(work)];
      const fxTex = effect.render(this, this.src, w, h, params, (i) => pool[i % 2]);
      const out = target(this.fmt8);
      if (this._magNearest) {
        gl.bindTexture(gl.TEXTURE_2D, this.src.tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        this._magNearest = false;
      }
      this.pass(this.composite, out, {
        uOrig: this.src.tex, uFx: fxTex, uMask: mask.tex, uStroke: this.emptyTex,
        uCanvas: [w, h], uOffset: [0, 0], uScale: 1, uImg: [w, h], uFlipY: false,
        uStrokeMode: 0, uMaskOpacity: maskOpacity, uShowOriginal: false, uShowMask: false, uBg: this.bg,
      });
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
      const err = gl.getError();
      if (err === gl.OUT_OF_MEMORY) throw new Error('Memória de vídeo insuficiente para exportar.');
      return new ImageData(data, w, h);
    } finally {
      for (const t of temps) deleteTarget(gl, t);
    }
  }
}

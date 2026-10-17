// Máscaras pintadas na GPU, uma por camada de efeito.
//
// Cada máscara guarda a ÁREA MARCADA: 1 = marcada (efeito removido), 0 = não marcada (efeito aplicado).
// Para economizar memória, cada camada tem só a sua textura de 1 canal (R8); o buffer da pincelada e
// a textura de trabalho são compartilhados por todas.
//
// Fluxo do pincel (igual ao Photoshop): cada "carimbo" (dab) deposita `fluxo` de tinta no buffer de
// traço, acumulando onde os carimbos se sobrepõem. Ao soltar, o traço é aplicado na máscara da camada.

import { createTarget, deleteTarget } from './gl/glutil.js';

const DAB_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
uniform vec2 uCenter;
uniform float uRadius;
uniform vec2 uRes;
out vec2 vLocal;
void main() {
  float R = uRadius + 1.0;
  vLocal = aPos * R;
  vec2 p = uCenter + aPos * R;
  gl_Position = vec4(p / uRes * 2.0 - 1.0, 0.0, 1.0);
}`;

const DAB_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
uniform float uRadius;
uniform float uHardness;
uniform float uFlow;
out vec4 outColor;
void main() {
  float d = length(vLocal);
  float inner = min(uRadius * uHardness, uRadius - 1.0);
  float a = 1.0 - smoothstep(inner, uRadius, d);
  outColor = vec4(a * uFlow);
}`;

const COMMIT_FS = `#version 300 es
precision highp float;
uniform sampler2D uMask;
uniform sampler2D uStroke;
uniform int uMode;
out vec4 outColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float m = texelFetch(uMask, p, 0).r;
  float s = clamp(texelFetch(uStroke, p, 0).a, 0.0, 1.0);
  float v = uMode == 1 ? m + (1.0 - m) * s : m * (1.0 - s);
  outColor = vec4(v, v, v, 1.0);
}`;

const INVERT_FS = `#version 300 es
precision highp float;
uniform sampler2D uMask;
out vec4 outColor;
void main() {
  float v = 1.0 - texelFetch(uMask, ivec2(gl_FragCoord.xy), 0).r;
  outColor = vec4(v, v, v, 1.0);
}`;

export const ADD = 1;      // pincel (+): marca área
export const SUBTRACT = 2; // pincel (−): desmarca área

export class MaskStore {
  constructor(renderer, maxSide = 4096) {
    this.r = renderer;
    this.maxSide = maxSide;
    this.stroke = this.temp = null;
    this.w = this.h = 0;
    this.scale = 1;
    this.stroking = false;
    this.fmtR8 = { internal: renderer.gl.R8, format: renderer.gl.RED, type: renderer.gl.UNSIGNED_BYTE };
  }

  /** Define o tamanho das máscaras para uma imagem w×h (lado maior limitado a maxSide). */
  init(imgW, imgH) {
    const gl = this.r.gl;
    deleteTarget(gl, this.stroke);
    deleteTarget(gl, this.temp);
    const k = Math.min(1, this.maxSide / Math.max(imgW, imgH));
    this.w = Math.max(1, Math.round(imgW * k));
    this.h = Math.max(1, Math.round(imgH * k));
    this.scale = this.w / imgW; // px da máscara por px da imagem
    this.stroke = createTarget(gl, this.w, this.h, this.r.fmtWork);
    this.temp = createTarget(gl, this.w, this.h, this.fmtR8);
    this.stroking = false;
    this._clear(this.stroke, 0);
  }

  get ready() { return !!this.stroke; }
  get strokeTex() { return this.stroke.tex; }
  get fullRect() { return { x: 0, y: 0, w: this.w, h: this.h }; }

  /** Nova máscara vazia (nada marcado) para uma camada. */
  create() {
    const t = createTarget(this.r.gl, this.w, this.h, this.fmtR8);
    this._clear(t, 0);
    return t;
  }

  dispose(t) { deleteTarget(this.r.gl, t); }

  _clear(t, v) {
    const gl = this.r.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.w, t.h);
    gl.clearColor(v, v, v, v);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Copia a textura de trabalho para a máscara da camada (mantém a mesma textura na camada). */
  _copyTempTo(mask) {
    const gl = this.r.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.temp.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, mask.fbo);
    gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }

  // ---------- Pincelada ----------

  beginStroke(mode) {
    this._clear(this.stroke, 0);
    this.stroking = true;
    this.mode = mode;
    this.dirty = null;
  }

  /** Carimba um dab circular. Coordenadas e raio em px da máscara. */
  dab(x, y, radius, hardness, flow) {
    if (!this.stroking) return;
    const gl = this.r.gl;
    radius = Math.max(0.5, radius);
    const prog = this.r.program(DAB_FS, DAB_VS);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.stroke.fbo);
    gl.viewport(0, 0, this.w, this.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // "sobre" pré-multiplicado: acumula até 1
    gl.useProgram(prog.program);
    gl.uniform2f(prog.uniforms.uCenter.loc, x, y);
    gl.uniform1f(prog.uniforms.uRadius.loc, radius);
    gl.uniform2f(prog.uniforms.uRes.loc, this.w, this.h);
    gl.uniform1f(prog.uniforms.uHardness.loc, hardness);
    gl.uniform1f(prog.uniforms.uFlow.loc, flow);
    gl.bindVertexArray(this.r.quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const R = radius + 2;
    const x0 = Math.max(0, Math.floor(x - R)), y0 = Math.max(0, Math.floor(y - R));
    const x1 = Math.min(this.w, Math.ceil(x + R)), y1 = Math.min(this.h, Math.ceil(y + R));
    if (x1 <= x0 || y1 <= y0) return;
    const d = this.dirty;
    this.dirty = d
      ? { x0: Math.min(d.x0, x0), y0: Math.min(d.y0, y0), x1: Math.max(d.x1, x1), y1: Math.max(d.y1, y1) }
      : { x0, y0, x1, y1 };
  }

  cancelStroke() {
    this.stroking = false;
    this._clear(this.stroke, 0);
  }

  /** Aplica o traço na máscara. Devolve { rect, before, after } para desfazer (ou null). */
  endStroke(mask) {
    if (!this.stroking) return null;
    this.stroking = false;
    const d = this.dirty;
    if (!d || !mask) { this._clear(this.stroke, 0); return null; }
    const rect = { x: d.x0, y: d.y0, w: d.x1 - d.x0, h: d.y1 - d.y0 };
    const before = this.readRect(mask, rect);
    this.r.pass(this.r.program(COMMIT_FS), this.temp, { uMask: mask.tex, uStroke: this.stroke.tex, uMode: this.mode });
    this._copyTempTo(mask);
    this._clear(this.stroke, 0);
    return { rect, before, after: this.readRect(mask, rect) };
  }

  // ---------- Operações na máscara inteira ----------

  fill(mask, v) {
    const rect = this.fullRect;
    const before = this.readRect(mask, rect);
    this._clear(mask, v);
    return { rect, before, after: this.readRect(mask, rect) };
  }

  invert(mask) {
    const rect = this.fullRect;
    const before = this.readRect(mask, rect);
    this.r.pass(this.r.program(INVERT_FS), this.temp, { uMask: mask.tex });
    this._copyTempTo(mask);
    return { rect, before, after: this.readRect(mask, rect) };
  }

  // ---------- Leitura/escrita para desfazer (1 byte por pixel) ----------

  readRect(mask, { x, y, w, h }) {
    const gl = this.r.gl;
    const rgba = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, mask.fbo);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const out = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = rgba[j];
    return out;
  }

  writeRect(mask, { x, y, w, h }, data) {
    const gl = this.r.gl;
    gl.bindTexture(gl.TEXTURE_2D, mask.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RED, gl.UNSIGNED_BYTE, data);
  }
}

/**
 * Histórico de desfazer/refazer com limite de memória. Cada entrada traz undo()/redo(),
 * `bytes` (memória que ocupa) e, opcionalmente, dispose() — chamado quando sai do histórico.
 */
export class History {
  constructor(limitBytes = 400 * 1024 * 1024) {
    this.limit = limitBytes;
    this.undoStack = [];
    this.redoStack = [];
    this.bytes = 0;
  }
  clear() {
    for (const e of [...this.undoStack, ...this.redoStack]) e.dispose?.('cleared');
    this.undoStack = [];
    this.redoStack = [];
    this.bytes = 0;
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  push(entry) {
    if (!entry) return;
    this.undoStack.push(entry);
    this.bytes += entry.bytes || 64;
    for (const e of this.redoStack) { this.bytes -= e.bytes || 64; e.dispose?.('redo-dropped'); }
    this.redoStack = [];
    while (this.bytes > this.limit && this.undoStack.length > 1) {
      const e = this.undoStack.shift();
      this.bytes -= e.bytes || 64;
      e.dispose?.('evicted');
    }
  }
  undo() {
    const e = this.undoStack.pop();
    if (!e) return false;
    e.undo();
    this.redoStack.push(e);
    return true;
  }
  redo() {
    const e = this.redoStack.pop();
    if (!e) return false;
    e.redo();
    this.undoStack.push(e);
    return true;
  }
}

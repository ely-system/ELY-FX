// Camada de máscara pintada na GPU.
//
// Valor 1 = efeito aplicado, 0 = efeito removido (foto original).
//
// Modelo de pincel igual ao do Photoshop:
//  - Fluxo: cada "carimbo" (dab) da pincelada deposita `fluxo` de tinta num buffer de traço,
//    acumulando onde os carimbos se sobrepõem (passar várias vezes no mesmo traço escurece).
//  - Opacidade: o traço inteiro é limitado a `opacidade`, por mais que se acumule.
// Ao soltar o mouse, o traço é aplicado na máscara e um registro de desfazer é criado.

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
uniform float uOpacity;
uniform int uMode;
out vec4 outColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float m = texelFetch(uMask, p, 0).r;
  float s = clamp(texelFetch(uStroke, p, 0).a, 0.0, 1.0) * uOpacity;
  float v = uMode == 1 ? m * (1.0 - s) : m + (1.0 - m) * s;
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

export const ERASE = 1;
export const RESTORE = 2;

export class MaskLayer {
  constructor(renderer, maxSide = 4096) {
    this.r = renderer;
    this.maxSide = maxSide;
    this.a = this.b = this.stroke = null;
    this.stroking = false;
  }

  /** Cria a máscara para uma imagem w×h (resolução limitada a maxSide no lado maior). */
  init(imgW, imgH) {
    const gl = this.r.gl;
    this.dispose();
    const k = Math.min(1, this.maxSide / Math.max(imgW, imgH));
    this.w = Math.max(1, Math.round(imgW * k));
    this.h = Math.max(1, Math.round(imgH * k));
    this.scale = this.w / imgW; // px da máscara por px da imagem
    this.a = createTarget(gl, this.w, this.h, this.r.fmt8);
    this.b = createTarget(gl, this.w, this.h, this.r.fmt8);
    this.stroke = createTarget(gl, this.w, this.h, this.r.fmtWork);
    this._clear(this.a, 1);
    this._clear(this.stroke, 0);
  }

  dispose() {
    const gl = this.r.gl;
    for (const t of [this.a, this.b, this.stroke]) deleteTarget(gl, t);
    this.a = this.b = this.stroke = null;
    this.stroking = false;
  }

  get tex() { return this.a.tex; }
  get strokeTex() { return this.stroke.tex; }
  get fullRect() { return { x: 0, y: 0, w: this.w, h: this.h }; }

  _clear(t, v) {
    const gl = this.r.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.w, t.h);
    gl.clearColor(v, v, v, v);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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

  /** Aplica o traço na máscara. Devolve um registro de desfazer (ou null se nada mudou). */
  endStroke(opacity) {
    if (!this.stroking) return null;
    this.stroking = false;
    const d = this.dirty;
    if (!d || opacity <= 0) { this._clear(this.stroke, 0); return null; }
    const rect = { x: d.x0, y: d.y0, w: d.x1 - d.x0, h: d.y1 - d.y0 };
    const before = this.readRect(rect);
    this.r.pass(this.r.program(COMMIT_FS), this.b, {
      uMask: this.a.tex, uStroke: this.stroke.tex, uOpacity: opacity, uMode: this.mode,
    });
    this._swap();
    this._clear(this.stroke, 0);
    return { rect, before, after: this.readRect(rect) };
  }

  // ---------- Operações na máscara inteira ----------

  fill(v) {
    const rect = this.fullRect;
    const before = this.readRect(rect);
    this._clear(this.a, v);
    return { rect, before, after: this.readRect(rect) };
  }

  invert() {
    const rect = this.fullRect;
    const before = this.readRect(rect);
    this.r.pass(this.r.program(INVERT_FS), this.b, { uMask: this.a.tex });
    this._swap();
    return { rect, before, after: this.readRect(rect) };
  }

  _swap() { const t = this.a; this.a = this.b; this.b = t; }

  // ---------- Leitura/escrita para desfazer (apenas 1 canal, para economizar memória) ----------

  readRect({ x, y, w, h }) {
    const gl = this.r.gl;
    const rgba = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.a.fbo);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const out = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = rgba[j];
    return out;
  }

  writeRect({ x, y, w, h }, data) {
    const gl = this.r.gl;
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0, j = 0; i < data.length; i++, j += 4) {
      const v = data[i];
      rgba[j] = rgba[j + 1] = rgba[j + 2] = v;
      rgba[j + 3] = 255;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.a.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  }
}

/** Histórico de desfazer/refazer da máscara, com limite de memória. */
export class MaskHistory {
  constructor(mask, limitBytes = 400 * 1024 * 1024) {
    this.mask = mask;
    this.limit = limitBytes;
    this.clear();
  }
  clear() { this.undoStack = []; this.redoStack = []; this.bytes = 0; }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  push(entry) {
    if (!entry) return;
    this.undoStack.push(entry);
    this.bytes += size(entry);
    for (const e of this.redoStack) this.bytes -= size(e);
    this.redoStack = [];
    while (this.bytes > this.limit && this.undoStack.length > 1) this.bytes -= size(this.undoStack.shift());
  }
  undo() {
    const e = this.undoStack.pop();
    if (!e) return false;
    this.mask.writeRect(e.rect, e.before);
    this.redoStack.push(e);
    return true;
  }
  redo() {
    const e = this.redoStack.pop();
    if (!e) return false;
    this.mask.writeRect(e.rect, e.after);
    this.undoStack.push(e);
    return true;
  }
}

function size(e) { return e.before.length + e.after.length; }

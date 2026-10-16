// Utilitários WebGL2: programas, uniforms, texturas e render targets.
//
// Convenção de coordenadas usada em todo o app: a linha 0 de qualquer textura é o TOPO da imagem,
// e uv (0,0) = canto superior esquerdo. Em passes fora da tela, uv = gl_FragCoord.xy / resolução.

export const FULLSCREEN_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('Erro ao compilar shader:\n' + log);
  }
  return sh;
}

export function createProgram(gl, fs, vs = FULLSCREEN_VS) {
  const program = gl.createProgram();
  const v = compile(gl, gl.VERTEX_SHADER, vs);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(program, v);
  gl.attachShader(program, f);
  gl.linkProgram(program);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error('Erro ao ligar programa:\n' + gl.getProgramInfoLog(program));
  }
  const uniforms = {};
  const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(program, i);
    uniforms[info.name] = { loc: gl.getUniformLocation(program, info.name), type: info.type };
  }
  return { program, uniforms };
}

/** Ativa o programa e aplica os uniforms (tipos inferidos do shader). Texturas recebem units em sequência. */
export function useProgram(gl, prog, values) {
  gl.useProgram(prog.program);
  let unit = 0;
  for (const name in values) {
    const u = prog.uniforms[name];
    if (!u) continue;
    const v = values[name];
    switch (u.type) {
      case gl.FLOAT: gl.uniform1f(u.loc, v); break;
      case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, v); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, v); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, v); break;
      case gl.INT:
      case gl.BOOL: gl.uniform1i(u.loc, typeof v === 'boolean' ? (v ? 1 : 0) : v); break;
      case gl.SAMPLER_2D:
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, v);
        gl.uniform1i(u.loc, unit);
        unit++;
        break;
      default: throw new Error('Tipo de uniform não suportado: ' + name);
    }
  }
}

export function createTexture(gl, w, h, fmt, { filter = gl.LINEAR, data = null } = {}) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, w, h, 0, fmt.format, fmt.type, data);
  return tex;
}

/** Textura + framebuffer. */
export function createTarget(gl, w, h, fmt) {
  const tex = createTexture(gl, w, h, fmt);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
    throw new Error('Framebuffer incompleto (' + status + ') em ' + w + '×' + h);
  }
  return { tex, fbo, w, h };
}

export function deleteTarget(gl, t) {
  if (!t) return;
  gl.deleteFramebuffer(t.fbo);
  gl.deleteTexture(t.tex);
}

/** Hash usado para dithering (quebra de banding em gradientes suaves). */
export const GLSL_HASH = `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}`;

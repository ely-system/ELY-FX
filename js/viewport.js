// Zoom e deslocamento da visualização. Coordenadas de tela em px CSS relativos ao palco.
export class Viewport {
  constructor() {
    this.scale = 1;
    this.x = 0;
    this.y = 0;
    this.w = 1;
    this.h = 1;
    this.imgW = 0;
    this.imgH = 0;
    this.fitted = true;
    this.minScale = 0.01;
    this.maxScale = 32;
    // Áreas cobertas por barras translúcidas (celular): a foto é enquadrada entre elas.
    // `bottom` é sempre coberto (abas); `panel` é o painel translúcido, que a foto pode ultrapassar.
    this.inset = { top: 0, bottom: 0, panel: 0 };
  }

  setInsets(top, bottom, panel = bottom) {
    const i = this.inset;
    if (top === i.top && bottom === i.bottom && panel === i.panel) return;
    this.inset = { top, bottom, panel };
    if (this.imgW && this.fitted) this.fit();
  }

  setSize(w, h) {
    // Mantém o mesmo ponto da imagem no centro quando o palco muda de tamanho.
    const cx = (this.w / 2 - this.x) / this.scale, cy = (this.h / 2 - this.y) / this.scale;
    this.w = w;
    this.h = h;
    if (!this.imgW) return;
    if (this.fitted) this.fit();
    else { this.x = w / 2 - cx * this.scale; this.y = h / 2 - cy * this.scale; }
  }

  setImage(w, h) {
    this.imgW = w;
    this.imgH = h;
    this.fit();
  }

  fit() {
    const pad = this.w < 600 ? 8 : 32;
    const availH = Math.max(1, this.h - this.inset.top - this.inset.bottom);
    const s = Math.min((this.w - pad * 2) / this.imgW, (availH - pad * 2) / this.imgH);
    this.scale = Math.max(this.minScale, Math.min(s, this.maxScale));
    this.x = (this.w - this.imgW * this.scale) / 2;
    // Centraliza acima do painel se couber; senão começa logo abaixo da barra de cima
    // e o resto fica visível por trás do painel translúcido.
    const h = this.imgH * this.scale;
    const above = Math.max(1, this.h - this.inset.top - this.inset.panel);
    this.y = this.inset.top + (h <= above ? (above - h) / 2 : Math.max(0, Math.min(pad, (availH - h) / 2)));
    this.fitted = true;
  }

  zoomTo(scale, sx = this.w / 2, sy = this.h / 2) {
    scale = Math.max(this.minScale, Math.min(this.maxScale, scale));
    const ix = (sx - this.x) / this.scale, iy = (sy - this.y) / this.scale;
    this.scale = scale;
    this.x = sx - ix * scale;
    this.y = sy - iy * scale;
    this.fitted = false;
  }

  /** Próximo degrau "redondo" de zoom (como no Photoshop). */
  step(dir) {
    const steps = [0.0625, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32];
    const s = this.scale;
    if (dir > 0) return steps.find((v) => v > s * 1.01) ?? this.maxScale;
    return [...steps].reverse().find((v) => v < s / 1.01) ?? this.minScale;
  }

  pan(dx, dy) {
    this.x += dx;
    this.y += dy;
    this.fitted = false;
  }

  toImage(sx, sy) { return [(sx - this.x) / this.scale, (sy - this.y) / this.scale]; }
  toScreen(ix, iy) { return [this.x + ix * this.scale, this.y + iy * this.scale]; }
}

// Desfoque de zoom (equivalente ao Desfoque Radial > Zoom do Photoshop):
// rastro em linha reta saindo do ponto de origem.
import { makeOriginBlur } from './radialCommon.js';

export const zoomBlur = makeOriginBlur({
  id: 'zoom-blur',
  name: 'Desfoque de zoom',
  description:
    'Simula um zoom feito durante a exposição: a imagem ganha rastros em linha reta saindo do ponto de origem, como o Desfoque radial (Zoom) do Photoshop.\n\nArraste o alvo para o assunto principal e use a Área nítida para mantê-lo limpo enquanto o resto “explode” em direção às bordas.',
  mode: 1,
  maxAmount: 1.0, // intensidade 100 = escala de e^±0,5 (≈ 0,61× a 1,65×)
  amountDefault: 15,
  directions: [
    { value: 'both', label: 'Nos dois sentidos', short: 'Ambos', range: [-0.5, 0.5] },
    { value: 'out', label: 'Para fora', range: [-1, 0] },
    { value: 'in', label: 'Para dentro', range: [0, 1] },
  ],
});

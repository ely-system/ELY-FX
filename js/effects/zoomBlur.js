// Desfoque de zoom (equivalente ao Desfoque Radial > Zoom do Photoshop):
// rastro em linha reta saindo do ponto de origem.
import { makeOriginBlur } from './radialCommon.js';

export const zoomBlur = makeOriginBlur({
  id: 'zoom-blur',
  name: 'Desfoque de zoom',
  mode: 1,
  maxAmount: 1.0, // intensidade 100 = escala de e^±0,5 (≈ 0,61× a 1,65×)
  amountDefault: 15,
  directions: [
    { value: 'both', label: 'Nos dois sentidos', range: [-0.5, 0.5] },
    { value: 'out', label: 'Para fora', range: [-1, 0] },
    { value: 'in', label: 'Para dentro', range: [0, 1] },
  ],
});

// Desfoque radial (equivalente ao Filtro > Desfoque > Desfoque Radial > Giro do Photoshop):
// rastro circular ao redor do ponto de origem.
import { makeOriginBlur } from './radialCommon.js';

export const radialBlur = makeOriginBlur({
  id: 'radial-blur',
  name: 'Desfoque radial',
  mode: 0,
  maxAmount: Math.PI / 2, // intensidade 100 = arco de 90°
  amountDefault: 15,
  directions: [
    { value: 'both', label: 'Nos dois sentidos', short: 'Ambos', range: [-0.5, 0.5] },
    { value: 'cw', label: 'Horário', range: [-1, 0] },
    { value: 'ccw', label: 'Anti-horário', range: [0, 1] },
  ],
});

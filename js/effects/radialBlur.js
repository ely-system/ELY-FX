// Desfoque radial (equivalente ao Filtro > Desfoque > Desfoque Radial > Giro do Photoshop):
// rastro circular ao redor do ponto de origem.
import { makeOriginBlur } from './radialCommon.js';

export const radialBlur = makeOriginBlur({
  id: 'radial-blur',
  name: 'Desfoque radial',
  description:
    'Simula a foto girando em volta de um ponto, como o Desfoque radial (Giro) do Photoshop: tudo ganha um rastro circular ao redor do ponto de origem.\n\nArraste o alvo na foto para escolher o centro do giro. Use a Área nítida para manter o assunto no centro sem desfoque. Fica ótimo em rodas, carrosséis e para dar sensação de movimento.',
  mode: 0,
  maxAmount: Math.PI / 2, // intensidade 100 = arco de 90°
  amountDefault: 15,
  directions: [
    { value: 'both', label: 'Nos dois sentidos', short: 'Ambos', range: [-0.5, 0.5] },
    { value: 'cw', label: 'Horário', range: [-1, 0] },
    { value: 'ccw', label: 'Anti-horário', range: [0, 1] },
  ],
});

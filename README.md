# ELY FX

Efeitos fotográficos direto no navegador, sem Photoshop. Tudo roda localmente na placa de vídeo (WebGL2) — a foto nunca sai do computador do usuário.

## Efeitos

### Desfoque radial
Equivalente ao *Filtro › Desfoque › Desfoque radial › Giro* do Photoshop: rastro circular ao redor do ponto de origem.

### Desfoque de zoom
Equivalente ao *Desfoque radial › Zoom* do Photoshop: rastro em linha reta saindo do ponto de origem.

Controles dos dois efeitos:

- **Direção:** nos dois sentidos, ou rastro só para um lado (horário / anti-horário; para fora / para dentro).
- **Intensidade:** 0–100.
- **Área nítida** e **suavidade da transição:** mantém a região do ponto de origem sem desfoque.
- **Qualidade:** rascunho, boa ou ótima.
- **Posição do ponto de origem** (grupo recolhível): em pixels a partir do centro da foto — horizontal positivo = direita, vertical positivo = cima. Também pode ser arrastado sobre a foto (ferramenta V).

## Máscara

A máscara define a **área marcada**, onde o efeito não aparece.

- **Pincel +** (B) marca área; **pincel −** (E) desmarca; X alterna.
- **Tamanho**, **dureza** e **fluxo** do pincel (fluxo baixo marca aos poucos, acumulando).
- **Opacidade da máscara:** geral, controla quanto a área marcada protege a foto.
- **Ver área marcada** (M), **Inverter**, **Limpar** e desfazer/refazer (Ctrl+Z / Ctrl+Shift+Z).

**Antes / Depois** fica na barra de zoom, ao lado do 1:1 (ou segure `\`).

## Celular

Em telas de até 860 px o editor muda para um layout próprio:

- A foto ocupa a tela; embaixo ficam as abas **Efeito** e **Máscara**, que abrem um painel deslizante (tocar na aba ativa recolhe o painel).
- A ferramenta acompanha a aba: em **Efeito**, arrastar com um dedo move o ponto de origem; em **Máscara**, um dedo pinta com o pincel escolhido (**+ Marcar** / **− Desmarcar**).
- Dois dedos fazem zoom e movem a foto (o traço ou o movimento iniciado pelo primeiro dedo é desfeito).
- Ao mudar tamanho ou dureza, uma prévia vermelha do pincel aparece no centro da foto.
- Exportar oferece **Salvar na galeria / Compartilhar** (menu de compartilhamento do sistema) ou baixar o arquivo.
- Em aparelhos de toque a máscara e a prévia usam resolução menor, e a exportação usa buffers de 8 bits para economizar memória.

## Exportação

JPEG, PNG ou WebP na resolução original da foto.

## Rodar localmente

Qualquer servidor estático serve (os módulos JavaScript não carregam via `file://`):

```bash
python -m http.server 5173
```

Depois abra http://localhost:5173.

## Publicação

O site é estático e publicado pelo GitHub Pages a partir da branch `main` (pasta raiz).

## Estrutura

```
index.html
css/style.css
js/main.js              interface, ferramentas, atalhos, exportação
js/gl/renderer.js       pipeline WebGL2 (efeito → composição com máscara)
js/gl/glutil.js         utilitários WebGL
js/mask.js              máscara pintada na GPU + histórico
js/viewport.js          zoom e deslocamento
js/ui.js                controles (sliders, seletores)
js/effects/index.js     registro de efeitos
js/effects/radialCommon.js  base dos desfoques com ponto de origem
js/effects/radialBlur.js
js/effects/zoomBlur.js
```

Para adicionar um efeito novo, crie um módulo em `js/effects/` com `id`, `name`, `params` e `render()` (veja `radialBlur.js` / `radialCommon.js`) e registre-o em `js/effects/index.js`. Os controles do painel são gerados automaticamente a partir de `params`.

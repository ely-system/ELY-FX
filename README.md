# ELY FX

Efeitos fotográficos direto no navegador, sem Photoshop. Tudo roda localmente na placa de vídeo (WebGL2) — a foto nunca sai do computador do usuário.

## Efeitos

### Desfoque radial
Equivalente ao *Filtro › Desfoque › Desfoque radial › Giro* do Photoshop: rastro circular ao redor do ponto de origem.

### Desfoque de zoom
Equivalente ao *Desfoque radial › Zoom* do Photoshop: rastro em linha reta saindo do ponto de origem.

### Desfoque direcional
Equivalente ao *Desfoque de Movimento* do Photoshop: rastro em linha reta com **Ângulo** (−90° a 90°, 0° = horizontal)
e **Distância** (px da foto), em vários passes para um rastro contínuo.

### Desfoque gaussiano
Equivalente ao *Desfoque Gaussiano* do Photoshop, com **Raio** em px da foto. Separável (horizontal + vertical);
raios grandes são calculados em resolução reduzida e ampliados, mantendo a velocidade.

Controles dos desfoques radial e de zoom:

- **Direção:** nos dois sentidos, ou rastro só para um lado (horário / anti-horário; para fora / para dentro).
- **Intensidade:** 0–100.
- **Área nítida** e **suavidade da transição:** mantém a região do ponto de origem sem desfoque.
- **Qualidade:** rascunho, boa ou ótima.
- **Opacidade do efeito:** intensidade geral do efeito sobre a foto original.
- **Posição do ponto de origem** (grupo recolhível): em pixels a partir do centro da foto — horizontal positivo = direita, vertical positivo = cima. Também pode ser arrastado sobre a foto (ferramenta V).

## Máscara

A máscara define a **área marcada**, onde o efeito não aparece.

- **Pincel +** (B) marca área; **pincel −** (E) desmarca; X alterna.
- **Tamanho**, **dureza** e **fluxo** do pincel (fluxo baixo marca aos poucos, acumulando).
- **Opacidade da máscara:** geral, controla quanto a área marcada protege a foto.
- **Ver área marcada** (M), **Inverter**, **Limpar** e desfazer/refazer (Ctrl+Z / Ctrl+Shift+Z).

**Antes / Depois** fica na barra de zoom, ao lado do 1:1 (ou segure `\`).

## Celular

Em telas de até 860 px o editor muda para uma interface no estilo Lightroom / PS mobile:

- A foto ocupa a tela inteira; a barra de cima e o painel de ajustes ficam por cima, translúcidos.
- Abas **Efeito** e **Máscara** embaixo; acima delas, os ajustes **empilhados** como no Lightroom: arraste na horizontal
  em qualquer ponto da linha para ajustar (toque solto não muda nada, dois toques voltam ao padrão).
- A ferramenta acompanha a aba: em **Efeito**, arrastar move o ponto de origem; em **Máscara**, um dedo pinta (**+ Marcar** / **− Desmarcar**).
- **Pressionar e segurar** na foto mostra o original; ao soltar volta ao normal.
- Tocar/arrastar **fora da foto** move a vista (não mexe no ponto de origem).
- Dois dedos fazem zoom e movem a foto.
- Arrastar as abas **para baixo** recolhe o painel, **para cima** abre (ou toque na aba ativa).
- O botão **Ajustar** aparece só quando a foto está com zoom.
- Exportar oferece **Salvar na galeria / Compartilhar** ou baixar o arquivo.

### App instalável (PWA)

O site pode ser instalado como app: no Android aparece o botão de instalar na barra de cima; no iPhone,
**Compartilhar → Adicionar à Tela de Início**. Instalado, abre em tela cheia (sem a barra do navegador)
e funciona offline. Arquivos: `manifest.webmanifest`, `sw.js` e `icons/`.

## Exportação

JPEG, PNG ou WebP na resolução original da foto.

## Rodar localmente

Qualquer servidor estático serve (os módulos JavaScript não carregam via `file://`):

```bash
python -m http.server 5173
```

Depois abra http://localhost:5173.

## Publicação

O site é estático e publicado pelo GitHub Pages pelo fluxo `.github/workflows/pages.yml` a cada push na `main`.
Antes de publicar, o fluxo roda `.github/stamp_version.py`, que carimba o commit em `js/version.js`
(`APP_VERSION`), gera `version.json` e acrescenta `?v=<versão>` aos endereços de JS/CSS e ao cache do
service worker. O app compara a versão **que está rodando** com a publicada ao abrir, ao voltar para a tela,
ao reconectar e a cada 5 minutos; havendo versão nova, mostra um aviso fixo com o botão **Atualizar**. A versão em uso aparece no cartão **Prévia**.

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
js/effects/directionalBlur.js
js/effects/gaussianBlur.js
```

Para adicionar um efeito novo, crie um módulo em `js/effects/` com `id`, `name`, `params` e `render()` (veja `radialBlur.js` / `radialCommon.js`) e registre-o em `js/effects/index.js`. Os controles do painel são gerados automaticamente a partir de `params`.

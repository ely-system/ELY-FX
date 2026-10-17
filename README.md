# ELY FX

Efeitos fotográficos direto no navegador, sem Photoshop. Tudo roda localmente na placa de vídeo (WebGL2) — a foto nunca sai do computador do usuário.

## Camadas de efeito

Vários efeitos podem ser aplicados na mesma foto, como camadas simplificadas:

- **Adicionar efeito** abre um menu agrupado (**Desfoques**, **Cor** e **Estilização**).
- A lista mostra o efeito de cima primeiro; ele é aplicado por último, sobre o resultado dos de baixo.
- Arraste pelo **≡** para mudar a ordem; o olho oculta e o × remove. Tocar/clicar no nome abre os ajustes.
- Cada efeito tem a própria **opacidade**, **máscara** e **opacidade da máscara**.
- Desfazer/refazer inclui adicionar, remover e reordenar efeitos, pinceladas e o ponto de origem.

## Presets

O botão de **Presets** (ícone de marcador no cartão Efeitos; no celular, ao lado de “+ Adicionar efeito”) salva a pilha
atual — efeitos, ordem, ajustes, opacidades e visibilidade — para aplicar em outras fotos. As máscaras não entram,
pois dependem de cada foto. Pontos de luz e ponto de origem são guardados em proporção da foto, e as medidas em px
se ajustam ao tamanho da nova foto. Os presets ficam no navegador (armazenamento local); use **Exportar** para guardar
um arquivo .json e **Importar arquivo** para trazê-los de volta (ou para outro aparelho). Aplicar um preset pode ser desfeito.

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

### Preto e branco
Como o ajuste Preto e Branco do Photoshop: **Luminosidade por cor** (vermelhos, amarelos, verdes, cianos, azuis e
magentas — clareia ou escurece cada faixa, sem mexer nas áreas neutras), **Contraste** e **Saturação** geral
(0% = P&B total; valores maiores devolvem parte da cor mantendo os tons do P&B).

### Duotone
A luminosidade vira um degradê entre a **Cor das sombras** e a **Cor das luzes** (seletor de cor com hex), com
**Contraste** e **Equilíbrio** (puxa os meios-tons para uma das cores).

### Dreamy glow
Aspecto de sonho: uma cópia com desfoque gaussiano (**Raio**) mesclada em **Tela** ou **Clarear**, com
**Intensidade** de 10% a 80%. Em **Área → Só as luzes**, apenas o que passa do **Limite das luzes** gera o brilho
difuso (bloom).

### Ruído / Granulado
Tipos **RGB**, **Monocromático** e **Tonalizado** (com seletor de cor), quantidade, tamanho do grão
(grãos maiores ficam suaves, como filme), distribuição uniforme/gaussiana e variação do padrão.

### Pixelização
Blocos com a cor média (estilo pixel art), com **tamanho do pixel** e redução de **cores** (até 8 cores).

### Raios de luz (estrela)
Pontos de luz no estilo filtro estrela (cross screen). **Clique ou toque na foto** para criar um ponto; arraste para
mover; arraste para fora da foto (ou botão direito no computador) para remover. Todos os pontos compartilham
**Pontas**, **Rotação** (gira todos juntos), **Tamanho dos raios**, **Tamanho do centro**, **Espessura**, um segundo traço largo e difuso (**Espessura difusa** e **Intensidade difusa**) e
**Intensidade**. **Variação** deixa cada raio com comprimento, brilho e ângulo próprios, e **Falhas** varia a opacidade de forma suave ao longo
de cada raio (até apagar trechos); **Dispersão** dá um leve arco-íris aos raios e **Brilho cromático** colore o brilho do centro (bordas e halo no espectro); **Aleatoriedade** sorteia outro padrão. A luz entra em modo Tela (screen).

As cores (ruído tonalizado, cor da luz) abrem um **seletor de cor** no estilo Lightroom mobile: quadro de
matiz × saturação, brilho, campo **hex** e cores prontas; aplica ao vivo e **Cancelar** volta à cor anterior.

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
js/ui.js                controles (sliders, seletores, seletor de cor)
js/presets.js           presets: salvar, aplicar, exportar e importar
js/effects/index.js     registro de efeitos
js/effects/radialCommon.js  base dos desfoques com ponto de origem
js/effects/radialBlur.js
js/effects/zoomBlur.js
js/effects/directionalBlur.js
js/effects/gaussianBlur.js
js/effects/noise.js
js/effects/pixelate.js
js/effects/starburst.js
js/effects/blackWhite.js
js/effects/duotone.js
js/effects/dreamyGlow.js
```

Para adicionar um efeito novo, crie um módulo em `js/effects/` com `id`, `name`, `params` e `render()` (veja `radialBlur.js` / `radialCommon.js`) e registre-o em `js/effects/index.js`. Os controles do painel são gerados automaticamente a partir de `params`.

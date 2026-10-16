# ELY FX

Efeitos fotográficos direto no navegador, sem Photoshop. Tudo roda localmente na placa de vídeo (WebGL2) — a foto nunca sai do computador do usuário.

## Efeitos

### Desfoque radial
Equivalente ao *Filtro › Desfoque › Desfoque radial* do Photoshop.

- **Método:** Giro (rotação em torno do centro) ou Zoom (rastro em direção ao centro).
- **Direção:** nos dois sentidos, ou rastro de movimento só para um lado (horário / anti-horário, para fora / para dentro).
- **Intensidade:** 0–100.
- **Centro:** arraste o alvo sobre a foto (ferramenta V) ou use os controles.
- **Área nítida no centro** e **suavidade da transição:** mantém o centro sem desfoque.
- **Qualidade:** rascunho, boa ou ótima (o desfoque é feito em múltiplos passes para um rastro contínuo).

## Máscara

Pinte sobre a foto para remover o efeito onde ele não deve aparecer, ou restaure-o.

- **Tamanho** e **dureza** do pincel.
- **Opacidade:** limite máximo de cada pincelada, mesmo passando várias vezes.
- **Fluxo:** quanto cada passada deposita; com fluxo baixo o efeito é removido aos poucos (como no Photoshop).
- Inverter, aplicar em tudo, remover de tudo, ver máscara em vermelho (M) e desfazer/refazer (Ctrl+Z / Ctrl+Shift+Z).

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
js/effects/radialBlur.js
```

Para adicionar um efeito novo, crie um módulo em `js/effects/` com `id`, `name`, `params` e `render()` (veja `radialBlur.js`) e registre-o em `js/effects/index.js`. Os controles do painel são gerados automaticamente a partir de `params`.

"""Carimba a versão publicada nos arquivos do site (roda no GitHub Actions antes de publicar).

- js/version.js  → APP_VERSION = '<versão>'  (o app sabe qual versão está rodando)
- version.json   → versão publicada           (o app compara com a que está rodando)
- index.html, js/*.js, sw.js → endereços de JS/CSS ganham ?v=<versão>, então nenhum cache
  (navegador, CDN ou service worker) consegue misturar arquivos de versões diferentes.

Uso: python .github/stamp_version.py <versão>
"""
import datetime
import json
import pathlib
import re
import sys

version = sys.argv[1]
root = pathlib.Path(__file__).resolve().parent.parent
q = f'?v={version}'


def edit(path, fn):
    p = root / path
    text = p.read_text(encoding='utf-8')
    new = fn(text)
    if new == text:
        sys.exit(f'nada para carimbar em {path}')
    p.write_text(new, encoding='utf-8')
    print('carimbado:', path)


edit('js/version.js', lambda t: re.sub(r"APP_VERSION = '[^']*'", f"APP_VERSION = '{version}'", t))

# Importações entre módulos: from './x.js' / from '../x.js'
imports = re.compile(r"""(from\s+['"](?:\.{1,2}/)[^'"?]+\.js)(['"])""")
for js in sorted((root / 'js').rglob('*.js')):
    rel = js.relative_to(root).as_posix()
    text = js.read_text(encoding='utf-8')
    new = imports.sub(lambda m: m.group(1) + q + m.group(2), text)
    if new != text:
        js.write_text(new, encoding='utf-8')
        print('carimbado:', rel)

edit('index.html', lambda t: t.replace('href="css/style.css"', f'href="css/style.css{q}"')
                              .replace('src="js/main.js"', f'src="js/main.js{q}"'))

edit('sw.js', lambda t: re.sub(r"(['\"]\./(?:js|css)/[^'\"?]+\.(?:js|css))(['\"])", r"\1" + q + r"\2",
                               t.replace("const CACHE = 'elyfx-dev'", f"const CACHE = 'elyfx-{version}'")))

(root / 'version.json').write_text(json.dumps({
    'version': version,
    'date': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
}) + '\n', encoding='utf-8')
print('version.json:', version)

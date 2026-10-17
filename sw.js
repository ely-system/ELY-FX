// Service worker do ELY FX: permite instalar o app e usá-lo sem internet.
// Estratégia "rede primeiro": online sempre pega a versão mais nova publicada;
// offline usa a última cópia guardada.

// Na publicação vira 'elyfx-<versão>': cada versão tem seu próprio cache e o anterior é apagado.
const CACHE = 'elyfx-dev';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './favicon.svg',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/main.js',
  './js/version.js',
  './js/ui.js',
  './js/viewport.js',
  './js/mask.js',
  './js/presets.js',
  './js/gl/glutil.js',
  './js/gl/renderer.js',
  './js/effects/index.js',
  './js/effects/radialCommon.js',
  './js/effects/radialBlur.js',
  './js/effects/zoomBlur.js',
  './js/effects/directionalBlur.js',
  './js/effects/gaussianBlur.js',
  './js/effects/noise.js',
  './js/effects/pixelate.js',
  './js/effects/starburst.js',
  './js/effects/blackWhite.js',
  './js/effects/duotone.js',
  './js/effects/dreamyGlow.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.endsWith('/version.json')) return; // sempre direto da rede
  // Sempre revalida com o servidor, para nunca misturar arquivos de versões diferentes.
  const fresh = req.mode === 'navigate' ? new Request(req.url, { cache: 'no-cache' }) : new Request(req, { cache: 'no-cache' });
  e.respondWith(
    fetch(fresh)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))),
  );
});

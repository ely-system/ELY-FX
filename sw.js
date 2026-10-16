// Service worker do ELY FX: permite instalar o app e usá-lo sem internet.
// Estratégia "rede primeiro": online sempre pega a versão mais nova publicada;
// offline usa a última cópia guardada.

const CACHE = 'elyfx-v1';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './favicon.svg',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/main.js',
  './js/ui.js',
  './js/viewport.js',
  './js/mask.js',
  './js/gl/glutil.js',
  './js/gl/renderer.js',
  './js/effects/index.js',
  './js/effects/radialCommon.js',
  './js/effects/radialBlur.js',
  './js/effects/zoomBlur.js',
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
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
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

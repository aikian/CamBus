const CACHE = 'cambus-v2.0.0-hardening';
const SHELL = [
  './', './index.html', './styles.css',
  './app.js', './portal.js', './ads.js', './map-ui.js', './install.js',
  './route-utils.js', './subway-router.js',
  // Leaflet 은 자체 호스팅한다. 캐시에 있어야 오프라인에서도 지도가 뜬다.
  './vendor/leaflet.js', './vendor/leaflet.css',
  './manifest.webmanifest', './privacy.html',
  './icon.svg', './icon-192.png', './icon-512.png',
  './icon-192-maskable.png', './icon-512-maskable.png', './apple-touch-icon.png',
  './data/portal-feed.json', './data/portal-auto.json', './data/local-ads.json',
  './data/route-timings.json', './data/route-stops.json', './data/route-paths.json',
  './data/subway-daegu.json'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(req).then(res => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then(cache => cache.put(req, copy));
    }
    return res;
  }).catch(async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const shell = await caches.match('./index.html');
      if (shell) return shell;
    }
    return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }));
});

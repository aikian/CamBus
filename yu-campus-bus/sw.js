const CACHE = 'bus-at-yu-v5';
const SHELL = [
  './', './index.html', './styles.css', './portal.js', './app.js', './ads.js',
  './manifest.webmanifest', './icon.svg', './route-guide-r1.png', './route-guide-r2.png'
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
  if (url.pathname.startsWith('/api/')) return; // real-time data must never be served from the app shell cache
  event.respondWith(fetch(req).then(res => {
    const copy = res.clone();
    caches.open(CACHE).then(cache => cache.put(req, copy));
    return res;
  }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html'))));
});

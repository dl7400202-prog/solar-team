const CACHE = 'solar-team-v19';
const ASSETS = ['./', './index.html', './styles.css?v=site-map-20261009-2', './app.js?v=site-map-20261009-2', './row-plans.js?v=site-map-20261009-2', './row-plans.css?v=site-map-20261009-2', './site-map.js?v=site-map-20261009-2', './site-map.css?v=site-map-20261009-2', './vendor/proj4-2.22.0.js', './manifest.webmanifest', './icon.svg'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request)));
});


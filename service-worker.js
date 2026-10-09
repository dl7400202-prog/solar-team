const CACHE = 'solar-team-v20';
const ASSETS = ['./', './index.html', './styles.css?v=google-map-20261009-1', './app.js?v=google-map-20261009-1', './row-plans.js?v=google-map-20261009-1', './row-plans.css?v=google-map-20261009-1', './site-map.js?v=google-map-20261009-1', './site-map.css?v=google-map-20261009-1', './vendor/proj4-2.22.0.js', './google-map.js?v=google-map-20261009-1', './google-maps-config.js?v=google-map-20261009-1', './manifest.webmanifest', './icon.svg'];
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


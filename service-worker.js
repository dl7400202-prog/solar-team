const CACHE = 'solar-team-v22';
const ASSETS = ['./', './index.html', './styles.css?v=field-design-20261010-1', './app.js?v=field-design-20261010-1', './row-plans.js?v=field-design-20261010-1', './row-plans.css?v=field-design-20261010-1', './site-map.js?v=field-design-20261010-1', './site-map.css?v=field-design-20261010-1', './vendor/proj4-2.22.0.js', './google-map.js?v=field-design-20261010-1', './google-maps-config.js?v=field-design-20261010-1', './manifest.webmanifest', './icon.svg'];
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


const CACHE = 'solar-team-v26', BUILD='field-mode-20261010b';
const ASSETS = ['./', './index.html', './styles.css?v=field-mode-20261010b', './app.js?v=field-mode-20261010b', './row-plans.js?v=field-mode-20261010b', './row-plans.css?v=field-mode-20261010b', './site-map.js?v=field-mode-20261010b', './site-map.css?v=field-mode-20261010b', './offline-field.js?v=field-mode-20261010b', './vendor/proj4-2.22.0.js', './vendor/supabase-client.js', './vendor/supabase-2.105.0.js', './google-map.js?v=field-mode-20261010b', './google-maps-config.js?v=field-mode-20261010b', './manifest.webmanifest', './icon.svg'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('solar-team-v') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('message', event => {
  if(event.data?.type!=='FIELD_SHELL_STATUS'||!event.ports?.[0])return;
  event.waitUntil(caches.open(CACHE).then(async cache=>{const responses=await Promise.all(ASSETS.map(url=>cache.match(url)));event.ports[0].postMessage({build:BUILD,ready:responses.every(response=>response?.ok)});}));
});
self.addEventListener('fetch', event => {
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);if(url.origin!==self.location.origin)return;
  const asset=ASSETS.find(path=>new URL(path,self.location.href).href===url.href);
  if(!asset&&event.request.mode!=='navigate')return;
  // A completed shell is served as one version. Never cache API data or Google imagery.
  event.respondWith(caches.open(CACHE).then(async cache=>{
    const saved=await cache.match(asset||'./index.html');if(saved)return saved;
    return fetch(event.request);
  }));
});


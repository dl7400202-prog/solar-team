const CACHE = 'solar-team-v36', BUILD='panel-only-20261010';
const ASSETS = ['./', './index.html', './styles.css?v=panel-only-20261010', './app.js?v=panel-only-20261010', './row-plans.js?v=panel-only-20261010', './row-plans.css?v=panel-only-20261010', './site-map.js?v=panel-only-20261010', './site-map.css?v=panel-only-20261010', './offline-field.js?v=panel-only-20261010', './vendor/proj4-2.22.0.js', './vendor/supabase-client.js', './vendor/supabase-2.105.0.js', './google-map.js?v=panel-only-20261010', './google-maps-config.js?v=panel-only-20261010', './manifest.webmanifest', './icon.svg'];
async function shellReady(cache) {
  const responses=await Promise.all(ASSETS.map(url=>cache.match(url)));
  return responses.every(response=>response?.ok)&&(await responses[1].text()).includes('src="app.js?v='+BUILD+'"');
}
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(async cache=>{
  await cache.addAll(ASSETS.map(url=>new Request(new URL(url,self.location.href),{cache:'reload'})));
  if(!await shellReady(cache))throw new Error('Cached index belongs to a different build');
  await self.skipWaiting();
})));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('solar-team-v') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('message', event => {
  if(event.data?.type!=='FIELD_SHELL_STATUS'||!event.ports?.[0])return;
  event.waitUntil(caches.open(CACHE).then(async cache=>{event.ports[0].postMessage({build:BUILD,ready:await shellReady(cache)});}));
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


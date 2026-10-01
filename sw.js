// Macht die App offline nutzbar: eigene Dateien zuerst aus dem Netz (damit Updates sofort ankommen),
// sonst aus dem Zwischenspeicher. Bibliotheken und Schriften kommen direkt aus dem Zwischenspeicher.
const CACHE = 'tagebuch-v1';
const LIBS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const own = url.origin === location.origin;
  const lib = LIBS.includes(url.hostname);
  if (!own && !lib) return; // GitHub-API, Kartenkacheln, Ortssuche: nicht zwischenspeichern
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (lib) {
      const hit = await cache.match(req);
      if (hit) return hit;
    }
    try {
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: own });
      if (hit) return hit;
      throw err;
    }
  })());
});

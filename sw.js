// Macht die App offline nutzbar: eigene Dateien zuerst aus dem Netz (damit Updates sofort ankommen),
// sonst aus dem Zwischenspeicher. Bibliotheken und Schriften kommen direkt aus dem Zwischenspeicher.
const CACHE = 'tagebuch-v8';
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

// Tägliche Erinnerung: Die Nachricht kommt verschlüsselt vom Zeitplan im Daten-Repo.
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(data.title || 'Daily', {
    body: data.body || 'Es ist noch etwas offen.',
    tag: data.tag || 'daily-erinnerung',
    icon: 'icon-512.png',
    badge: 'icon-180.png',
    data: { url: data.url || './' },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) if ('focus' in c) return c.focus();
    return self.clients.openWindow(e.notification.data && e.notification.data.url || './');
  })());
});

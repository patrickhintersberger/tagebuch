// Macht die App offline nutzbar (z.B. im Flugzeug).
// Beim Installieren wird die ganze App samt Bibliotheken und Schriften auf dem Gerät abgelegt.
// Eigene Dateien kommen zuerst aus dem Netz (damit Updates sofort ankommen), aber nur, wenn das Netz
// schnell antwortet; sonst sofort aus dem Zwischenspeicher. Bibliotheken und Schriften kommen direkt aus dem Zwischenspeicher.
const CACHE = 'tagebuch-v28';
const LIBS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const SHELL = ['index.html', 'app.js', 'store.js', 'finanzen.js', 'config.js', 'style.css', 'geo.js', 'manifest.webmanifest',
  'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
const NET_WAIT = 3000; // so lange auf das Netz warten, wenn eine gespeicherte Fassung da ist

// Eigene Dateien ohne ?v=… ablegen, damit immer genau eine (die neueste) Fassung im Speicher liegt.
function ownKey(url) {
  const u = new URL(url, location.href);
  let path = u.pathname;
  if (path.endsWith('/')) path += 'index.html';
  return u.origin + path;
}

self.addEventListener('install', e => e.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  // Eigene Dateien: alle müssen klappen, sonst bleibt die bisherige Fassung aktiv
  await Promise.all(SHELL.map(async f => {
    const res = await fetch(f, { cache: 'no-cache' });
    if (!res.ok) throw new Error(f);
    await cache.put(ownKey(f), res);
  }));
  // Bibliotheken und Schriften aus der index.html heraussuchen
  const html = await (await cache.match(ownKey('index.html'))).text();
  const urls = [...html.matchAll(/(?:href|src)="(https:\/\/[^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&'))
    .filter(u => LIBS.includes(new URL(u).hostname));
  await Promise.allSettled(urls.map(async u => {
    const res = await fetch(u, { mode: 'cors' });
    if (!res.ok) return;
    if (new URL(u).hostname === 'fonts.googleapis.com') {
      // Die Schrift-Beschreibung verweist auf die eigentlichen Schriftdateien – die auch ablegen
      const css = await res.clone().text();
      const fonts = [...css.matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1]);
      await Promise.allSettled(fonts.map(async f => { const r = await fetch(f, { mode: 'cors' }); if (r.ok) await cache.put(f, r); }));
    }
    await cache.put(u, res);
  }));
  self.skipWaiting();
})()));

self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('tagebuch-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const own = url.origin === location.origin && url.pathname.startsWith(new URL(self.registration.scope).pathname);
  const lib = LIBS.includes(url.hostname);
  if (!own && !lib) return; // GitHub-API, Kartenkacheln, Ortssuche: nicht zwischenspeichern
  e.respondWith(own ? fromOwn(req) : fromLib(req));
});

async function fromLib(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

async function fromOwn(req) {
  const cache = await caches.open(CACHE);
  const key = ownKey(req.url);
  const net = fetch(req).then(res => {
    if (res.ok) cache.put(key, res.clone());
    return res;
  });
  let hit = await cache.match(key);
  if (!hit && req.mode === 'navigate') hit = await cache.match(ownKey('index.html'));
  if (!hit) return net;
  // Gespeicherte Fassung vorhanden: Netz nur kurz abwarten (langsames oder kaputtes WLAN im Flugzeug)
  const res = await Promise.race([net.catch(() => null), new Promise(r => setTimeout(() => r(null), NET_WAIT))]);
  return res && res.ok ? res : hit;
}

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

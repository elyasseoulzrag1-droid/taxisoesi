/* Service worker de Plan Solana.
   - Garde une copie des pages, de l'icône et de la bibliothèque de graphiques pour que l'appli
     s'ouvre même sans réseau (les prix, eux, demandent toujours une connexion).
   - Affiche les notifications d'alerte et ouvre l'appli quand on touche une notification. */
const CACHE = 'plan-solana-v1';
const SHELL = [
  './plan.html', './index.html', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png',
];
const LIBS = ['cdn.jsdelivr.net', 'unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  // Chaque fichier est mis de côté séparément : un fichier manquant ne bloque pas l'installation.
  event.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    // Pages et fichiers de l'appli : le réseau d'abord (toujours la dernière version), la copie sinon.
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./plan.html'))),
    );
    return;
  }
  if (LIBS.includes(url.hostname)) {
    // Bibliothèque de graphiques et polices : la copie tout de suite, mise à jour en arrière-plan.
    event.respondWith(
      caches.open(CACHE).then(async cache => {
        const hit = await cache.match(req);
        const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || net;
      }),
    );
  }
  // Données en direct (Binance, actualités...) : jamais mises en cache.
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL('./plan.html#alertes', self.location.href).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow(target);
    }),
  );
});

/* TaskCenter · service worker
 * La versión llega en la URL de registro (sw.js?v=1.0.0), así que solo se cambia en index.html. */
const V = new URL(self.location.href).searchParams.get('v') || '0';
const APP = 'taskcenter-' + V;
const FONTS = 'taskcenter-fonts';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(APP).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('taskcenter-') && k !== APP && k !== FONTS)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Archivos de la app: primero la red (siempre la última versión); sin red, la copia guardada.
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(APP).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req, { ignoreSearch: true }).then((m) => m || caches.match('./index.html'))
        )
    );
    return;
  }

  // Tipografías de Google: copia local para que la app se vea igual sin conexión.
  if (url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open(FONTS).then((c) =>
        c.match(req).then((hit) => {
          const net = fetch(req)
            .then((res) => {
              if (res.ok || res.type === 'opaque') c.put(req, res.clone());
              return res;
            })
            .catch(() => hit);
          return hit || net;
        })
      )
    );
  }
  // Cualquier otra petición (por ejemplo, tu hoja de Google) pasa directa, sin intervenir.
});

// Al tocar un aviso: se abre (o se enfoca) la app en la pantalla correspondiente.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const v = (e.notification.data && e.notification.data.v) || '';
  const url = new URL('./' + (v ? '?v=' + v : ''), self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          if (v) c.postMessage({ type: 'goto', v: v });
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

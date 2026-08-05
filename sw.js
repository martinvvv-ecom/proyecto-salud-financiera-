/* ================================================================
   SALUD FINANCIERA — SERVICE WORKER
   Estrategia: Cache-first para assets propios,
                Network-first para APIs externas (mindicador.cl)
   ================================================================ */

const CACHE_NAME = 'salud-financiera-v3';
const CORE_ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './css/features.css',
  './js/app.js',
  './js/features.js',
  './manifest.json',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  // CDNs externos críticos
  'https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&family=Plus+Jakarta+Sans:wght@300;400;500;600&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js'
];

// ── Install: precargar assets críticos ──
self.addEventListener('install', event => {
  console.log('[SW] Instalando...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // Cachear cada asset por separado para no fallar si uno no carga
        return Promise.allSettled(
          CORE_ASSETS.map(url =>
            cache.add(url).catch(err => console.warn('[SW] No se cacheó:', url, err))
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ── Activate: limpiar caches viejos ──
self.addEventListener('activate', event => {
  console.log('[SW] Activando...');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => k !== CACHE_NAME && caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: estrategia híbrida ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // No interceptar POST u otros no-GET
  if (event.request.method !== 'GET') return;

  // Estrategia network-first para API mindicador.cl y QR generator
  if (url.hostname === 'mindicador.cl' || url.hostname === 'api.qrserver.com') {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          // Cachear respuesta exitosa
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Estrategia cache-first para assets propios
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (res.ok && (url.origin === self.location.origin || url.hostname === 'cdnjs.cloudflare.com' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com')) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return res;
      }).catch(() => {
        // Fallback offline
        if (event.request.destination === 'document') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

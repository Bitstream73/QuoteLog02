const CACHE_NAME = 'quotelog-v32';
const STATIC_ASSETS = ['/', '/css/styles.css', '/js/app.js', '/js/api.js', '/js/home.js', '/js/quote.js', '/js/article.js', '/js/author.js', '/js/topic.js', '/js/category.js', '/js/settings.js', '/js/review.js', '/js/logs.js', '/js/login.js', '/js/resetPassword.js', '/js/analytics.js', '/js/important.js', '/js/charts.js', '/js/admin-actions.js', '/js/swipe.js', '/js/page-transition.js', '/js/bug-report.js', '/js/donate.js', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  const isSameOrigin = url.startsWith(self.location.origin);

  if (url.includes('/api/')) {
    // API: network-first with cache fallback
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
  } else if (event.request.mode === 'navigate') {
    // HTML navigation: network-first so new deploys are picked up immediately
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
  } else if (!isSameOrigin) {
    // External resources (e.g. Wikipedia images): network-only, never cache
    // Prevents caching stale/error responses from third-party CDNs
    return;
  } else {
    // Same-origin static assets: stale-while-revalidate
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fetchPromise = fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
  }
});

// Listen for messages from clients to force refresh
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});

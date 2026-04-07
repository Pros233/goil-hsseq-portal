'use strict';

// ── Cache names ───────────────────────────────────────────────────────────────
var CACHE_APP   = 'goil-hsseq-app-v1';
var CACHE_FONTS = 'goil-hsseq-fonts-v1';
var CACHE_IMGS  = 'goil-hsseq-imgs-v1';

// ── Assets to pre-cache on install ───────────────────────────────────────────
// HTML pages are cached here so they work offline from first launch.
// Versioned JS/CSS/data assets are cached on first access by the fetch handler.
var PRECACHE_URLS = [
  '/index.html',

  // Pages
  '/pages/portal.html',
  '/pages/risk-inspection.html',
  '/pages/GOIL_Facility_Details.html',
  '/pages/GOIL_Checklist_Section1.html',
  '/pages/GOIL_Checklist_Section1_v2.html',
  '/pages/GOIL_Checklist_OfficeDepot.html',
  '/pages/GOIL_Corrective_Action.html',
  '/pages/GOIL_Review_Submit.html',
  '/pages/risk-uncompleted.html',
  '/pages/risk-dashboard.html',
  '/pages/risk-published-register.html',
  '/pages/risk-corrections.html',
  '/pages/risk-corrections-detail.html',
  '/pages/risk-facility-profile.html',
  '/pages/incident-reporting.html',
  '/pages/kpi.html',
  '/pages/corrective-action.html',
  '/pages/facility-details.html',
  '/pages/fuel-station-inspection.html',
  '/pages/review-submit.html',
  '/pages/unit-hse.html',
  '/pages/unit-compliance.html',
  '/pages/unit-security.html',
  '/pages/unit-quality.html',
  '/pages/unit-iso.html',
  '/pages/unit-common.html',

  // CSS
  '/assets/css/styles.css',
  '/assets/css/risk-module.css',

  // JavaScript
  '/assets/js/auth-guard.js',
  '/assets/js/auth.js',
  '/assets/js/workflow-core.js',
  '/assets/js/risk-inspection.js',
  '/assets/js/risk-module-utils.js',
  '/assets/js/portal.js',

  // Images (SVG only — PNG is auto-cached on first access)
  '/assets/img/goil-logo.svg',
  '/assets/img/goil-swirl.svg',

  // Data
  '/assets/data/facilities.json',
  '/assets/data/question-bank.json',
  '/assets/data/template-office.json',
  '/assets/data/template-office-depot.json',
  '/assets/data/template-fuel-station.json',
  '/assets/data/template-lpg-plant.json'
];

// ── Install: pre-cache core assets ────────────────────────────────────────────
self.addEventListener('install', function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_APP).then(function (cache) {
      return Promise.all(
        PRECACHE_URLS.map(function (url) {
          return cache.add(url).catch(function (err) {
            console.warn('[SW] Pre-cache skipped:', url, err.message);
          });
        })
      );
    })
  );
});

// ── Activate: delete old caches ───────────────────────────────────────────────
self.addEventListener('activate', function (event) {
  var CURRENT_CACHES = [CACHE_APP, CACHE_FONTS, CACHE_IMGS];
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (key) { return CURRENT_CACHES.indexOf(key) === -1; })
          .map(function (key) {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// ── Fetch: routing strategies ─────────────────────────────────────────────────
self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;

  var url;
  try { url = new URL(event.request.url); } catch (e) { return; }

  // Google Fonts — stale-while-revalidate
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(event.request, CACHE_FONTS));
    return;
  }

  // Skip other cross-origin requests
  if (url.origin !== self.location.origin) return;

  var path = url.pathname;

  // Images — cache-first, populate on miss, works offline forever after first load
  if (/\.(png|jpe?g|gif|svg|webp|ico)$/i.test(path)) {
    event.respondWith(cacheFirst(event.request, CACHE_IMGS));
    return;
  }

  // HTML pages — network-first so users always get the latest when online,
  // but falls back to cache when offline
  if (path.endsWith('.html') || path === '/' || path === '') {
    event.respondWith(networkFirst(event.request, CACHE_APP));
    return;
  }

  // CSS, JS, JSON data — stale-while-revalidate:
  // serve cached instantly, refresh in background when online
  event.respondWith(staleWhileRevalidate(event.request, CACHE_APP));
});

// ── Strategy helpers ──────────────────────────────────────────────────────────

/**
 * Network-first: try network, update cache, fall back to cache if offline.
 * Best for HTML — always fresh when online, works offline.
 */
function networkFirst(request, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return fetch(request.clone()).then(function (networkResponse) {
      if (networkResponse && networkResponse.ok) {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    }).catch(function () {
      return cache.match(request).then(function (cached) {
        return cached || offlineFallback();
      });
    });
  });
}

/**
 * Stale-while-revalidate: serve cache immediately, update in background.
 * Best for JS/CSS/fonts — instant load, silently updates.
 */
function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(request).then(function (cached) {
      var networkFetch = fetch(request.clone()).then(function (networkResponse) {
        if (networkResponse && networkResponse.ok) {
          cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      }).catch(function () { return null; });

      return cached || networkFetch;
    });
  });
}

/**
 * Cache-first: serve from cache, fetch and cache on miss.
 * Best for images — avoids re-downloading large assets.
 */
function cacheFirst(request, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(request).then(function (cached) {
      if (cached) return cached;
      return fetch(request.clone()).then(function (networkResponse) {
        if (networkResponse && networkResponse.ok) {
          cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      }).catch(function () {
        return new Response('', { status: 404, statusText: 'Not Found' });
      });
    });
  });
}

/**
 * Generic offline page returned when HTML is unavailable offline.
 */
function offlineFallback() {
  var html = [
    '<!DOCTYPE html><html lang="en"><head>',
    '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>GOIL HSSEQ – Offline</title>',
    '<style>',
    'body{margin:0;font-family:sans-serif;background:#1E1E1E;color:#E6EDF3;',
    'display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}',
    '.box{padding:40px;max-width:400px}',
    'h1{color:#F47920;font-size:28px;margin-bottom:12px}',
    'p{color:#A0A0A0;line-height:1.6}',
    '.dot{width:10px;height:10px;border-radius:50%;background:#F47920;',
    'display:inline-block;margin:20px auto;animation:pulse 1.4s ease-in-out infinite}',
    '@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}',
    '</style></head><body>',
    '<div class="box">',
    '<div class="dot"></div>',
    '<h1>You\'re Offline</h1>',
    '<p>GOIL HSSEQ is waiting for a connection.<br>',
    'Any data you\'ve saved locally is safe.<br>',
    'The app will reconnect automatically.</p>',
    '</div></body></html>'
  ].join('');
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

/*!
 * The Little Wings Dashboard service worker (v2.5.0)
 * Caches the app shell so the sign-in page and UI still load offline.
 * NEVER caches or intercepts Supabase API / Auth / Realtime requests.
 * Only same-origin GET requests are handled.
 */
var CACHE_NAME = 'lw-dash-v2.5.0';
var PRECACHE = [
  './',
  './index.html',
  './style.css?v=2.5.0',
  './assets/receipt.css?v=2.5.0',
  './assets/receipt.js?v=2.5.0',
  './assets/xlsx-lite.js?v=2.5.0',
  './app.js?v=2.5.0',
  './config.js?v=2.5.0',
  './assets/vendor/supabase-js-2.119.0.js',
  './assets/logo.jpeg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/apple-touch-icon.png',
  './manifest.webmanifest'
];

function isSupabaseRequest(url) {
  var h = url.hostname || '';
  return /supabase\.(co|in)$/i.test(h) || h.indexOf('supabase') !== -1;
}

function isSameOriginGet(request, url) {
  return request.method === 'GET' && url.origin === self.location.origin;
}

function isHtmlRequest(request, url) {
  if (request.mode === 'navigate') return true;
  var accept = request.headers.get('accept') || '';
  if (accept.indexOf('text/html') !== -1) return true;
  var path = url.pathname || '';
  return /(?:^|\/)index\.html$/.test(path) || /\/$/.test(path);
}

function putCopy(request, response) {
  if (!response || !response.ok) return response;
  var copy = response.clone();
  caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); }).catch(function () {});
  return response;
}

function networkFirst(request) {
  return fetch(request).then(function (res) {
    return putCopy(request, res);
  }).catch(function () {
    return caches.match(request).then(function (cached) {
      if (cached) return cached;
      return caches.match('./index.html').then(function (page) {
        return page || caches.match('./');
      });
    });
  });
}

function staleWhileRevalidate(request) {
  return caches.match(request).then(function (cached) {
    var fetching = fetch(request).then(function (res) {
      return putCopy(request, res);
    }).catch(function () { return cached; });
    return cached || fetching;
  });
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return Promise.all(PRECACHE.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function (err) {
          if (/index\.html|app\.js|style\.css|config\.js|supabase-js|receipt\.js|\/$/.test(url)) throw err;
        });
      }));
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      // Only remove this app's old caches (the Parents app in /parents/ keeps its own).
      return Promise.all(keys.filter(function (k) { return k.indexOf('lw-dash-') === 0 && k !== CACHE_NAME; }).map(function (k) {
        return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  var url;
  try { url = new URL(request.url); } catch (e) { return; }

  // Never cache or intercept Supabase API, Auth or Realtime.
  if (isSupabaseRequest(url)) return;

  // Only same-origin GET. POSTs, WebSockets and third-party calls go to the network.
  if (!isSameOriginGet(request, url)) return;

  // The Parents app (/parents/) has its own service worker; never serve it from here.
  if (/\/parents(\/|$)/.test(url.pathname)) return;

  if (isHtmlRequest(request, url)) {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(staleWhileRevalidate(request));
  }
});

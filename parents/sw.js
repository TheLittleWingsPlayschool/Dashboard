/*!
 * Little Wings Parents service worker (v1.7.0), scope /Dashboard/parents/
 * Caches only the app shell (pages, styles, scripts, icons) so the app opens
 * offline. NEVER caches or intercepts Supabase API / Auth / Realtime requests;
 * the child's data is kept in the app's own storage and cleared on sign-out.
 * Private photos (signed Storage URLs) are Supabase requests too, so they are
 * never cached here. Also shows phone alerts (Web Push) and opens the right screen.
 */
var CACHE_NAME = 'lw-parents-v1.7.0';
var PRECACHE = [
  './',
  './index.html',
  './style.css?v=1.7.0',
  './app.js?v=1.7.0',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  '../config.js?v=2.9.0',
  '../assets/receipt.js?v=2.9.0',
  '../assets/receipt.css?v=2.9.0',
  '../assets/vendor/supabase-js-2.119.0.js',
  '../assets/logo.jpeg'
];
var REQUIRED = /index\.html|app\.js|style\.css|config\.js|supabase-js|receipt\.js|\/$/;

function isSupabase(url) { var h = url.hostname || ''; return /supabase\.(co|in)$/i.test(h) || h.indexOf('supabase') !== -1; }
function isHtml(request, url) {
  if (request.mode === 'navigate') return true;
  var a = request.headers.get('accept') || '';
  return a.indexOf('text/html') !== -1 || /\/parents\/(index\.html)?$/.test(url.pathname);
}
function putCopy(request, res) {
  if (!res || !res.ok) return res;
  var copy = res.clone();
  caches.open(CACHE_NAME).then(function (c) { c.put(request, copy); }).catch(function () {});
  return res;
}
function networkFirst(request) {
  return fetch(request).then(function (res) { return putCopy(request, res); }).catch(function () {
    return caches.match(request, { ignoreSearch: true }).then(function (hit) {
      return hit || caches.match('./index.html').then(function (p) { return p || caches.match('./'); });
    });
  });
}
function staleWhileRevalidate(request) {
  return caches.match(request).then(function (hit) {
    var net = fetch(request).then(function (res) { return putCopy(request, res); }).catch(function () { return hit; });
    return hit || net;
  });
}

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function (cache) {
    return Promise.all(PRECACHE.map(function (u) {
      return cache.add(new Request(u, { cache: 'reload' })).catch(function (err) { if (REQUIRED.test(u)) throw err; });
    }));
  }));
});
self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    // Only this app's old caches; the staff dashboard keeps its own (lw-dash-*).
    return Promise.all(keys.filter(function (k) { return k.indexOf('lw-parents-') === 0 && k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', function (event) {
  var req = event.request, url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (isSupabase(url)) return;                                   // never touch the database / auth
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (isHtml(req, url)) event.respondWith(networkFirst(req));
  else event.respondWith(staleWhileRevalidate(req));
});

/* ---------- phone alerts (Web Push) ---------- */
var TABS = ['home', 'notices', 'updates', 'attendance', 'fees', 'gallery'];
self.addEventListener('push', function (event) {
  var d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data ? event.data.text() : '' }; }
  var title = String(d.title || 'Little Wings').slice(0, 120);
  var opts = {
    body: String(d.body || '').slice(0, 300),
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    lang: d.lang || undefined,
    data: { tab: TABS.indexOf(d.tab) !== -1 ? d.tab : 'home' }
  };
  if (d.tag) { opts.tag = String(d.tag).slice(0, 80); opts.renotify = true; }
  event.waitUntil(self.registration.showNotification(title, opts));
});
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var tab = (event.notification.data && event.notification.data.tab) || 'home';
  if (TABS.indexOf(tab) === -1) tab = 'home';
  var url = new URL('./#tab=' + tab, self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c.url.indexOf(self.registration.scope) === 0 && 'focus' in c) { c.postMessage({ type: 'OPEN_TAB', tab: tab === 'attendance' ? 'calendar' : tab }); return c.focus(); }
    }
    return self.clients.openWindow ? self.clients.openWindow(url) : null;
  }));
});

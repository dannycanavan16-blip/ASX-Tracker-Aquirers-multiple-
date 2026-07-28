/* Service worker for The Acquirer's Multiple.
 *
 * Strategy: NETWORK-FIRST for everything same-origin, cache as the offline fallback.
 *
 * Cache-first would be the usual choice for a static site, and it is the wrong one here:
 * the whole app is a single index.html, so a cache-first worker would pin an installed
 * copy to whatever version it first saw and every future deploy would silently fail to
 * appear. Network-first means an online launch always gets the current build, while the
 * cached copy keeps the app usable with no signal — which matters, since the screen runs
 * off localStorage and only needs the network to refresh prices.
 *
 * Bump CACHE_VERSION to evict old caches.
 */

var CACHE_VERSION = "am-v1";

var PRECACHE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-512-maskable.png"
];

self.addEventListener("install", function (e) {
  // addAll rejects wholesale if any single entry 404s, which would abort the whole
  // install; add individually and tolerate misses so one bad path can't break offline.
  e.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      return Promise.all(PRECACHE.map(function (url) {
        return cache.add(url).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE_VERSION ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;

  // Never touch the Apps Script proxy: quotes and backups must always be live, and a
  // stale cached response would be worse than a failed one.
  if (!sameOrigin && /script\.google(usercontent)?\.com$/.test(url.hostname)) return;

  if (sameOrigin) {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          // Offline navigations to any in-scope URL fall back to the app shell.
          return hit || (req.mode === "navigate" ? caches.match("./index.html") : undefined);
        });
      })
    );
    return;
  }

  // Cross-origin (Google Fonts): serve from cache when present, otherwise fetch and
  // stash opportunistically. Never block on these — the CSS font stacks fall back to
  // system fonts, so offline just renders in the platform default.
  e.respondWith(
    caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        if (res && (res.ok || res.type === "opaque")) {
          var copy = res.clone();
          caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
    })
  );
});

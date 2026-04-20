/* Service Worker — estáticos cache-first; HTML/API network-first com fallback */
/* v3-premium.3: corrige ciclo ESM vendor-react/vendor-baseui agrupando em vendor-ui. */
var STATIC_CACHE = "nossa-lista-static-v3-premium-3";
var RUNTIME_CACHE = "nossa-lista-runtime-v3-premium-3";
var PRECACHE_URLS = [
  "/static/style.css",
  "/static/app.js",
  "/static/favicon.svg",
  "/static/manifest.webmanifest",
  "/static/offline.html"
];

/* Assets versionados pelo Vite (/static/build/assets/*.[hash].js) mudam
   de hash a cada build; tratamos como "stale-while-revalidate" para
   sobrescrever bundles antigos sem quebrar offline. */
function isViteBuildAsset(url) {
  return url.pathname.indexOf("/static/build/") === 0;
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(function (cache) {
      return cache.addAll(PRECACHE_URLS.map(function (u) { return new Request(u, { cache: "reload" }); })).catch(function () {});
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (k) { return k !== STATIC_CACHE && k !== RUNTIME_CACHE; })
          .map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

function isStaticAsset(url) {
  return url.pathname.indexOf("/static/") === 0;
}

function isApiOrSearch(url) {
  var p = url.pathname;
  return (
    p.indexOf("/search") === 0 ||
    p.indexOf("/api/") === 0 ||
    p.indexOf("/suggestions") === 0
  );
}

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (isViteBuildAsset(url)) {
    event.respondWith(
      caches.match(req).then(function (cached) {
        var network = fetch(req)
          .then(function (res) {
            if (res.ok) {
              var copy = res.clone();
              caches.open(STATIC_CACHE).then(function (c) {
                c.put(req, copy);
              });
            }
            return res;
          })
          .catch(function () { return cached; });
        return cached || network;
      })
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(req).then(function (cached) {
        return (
          cached ||
          fetch(req).then(function (res) {
            var copy = res.clone();
            caches.open(STATIC_CACHE).then(function (c) {
              c.put(req, copy);
            });
            return res;
          })
        );
      })
    );
    return;
  }

  if (isApiOrSearch(url) || req.headers.get("accept") && req.headers.get("accept").indexOf("text/html") !== -1) {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          var copy = res.clone();
          caches.open(RUNTIME_CACHE).then(function (c) {
            if (res.ok) c.put(req, copy);
          });
          return res;
        })
        .catch(function () {
          return caches.match(req).then(function (hit) {
            return hit || caches.match("/static/offline.html");
          });
        })
    );
    return;
  }
});

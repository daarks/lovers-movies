/* Service Worker — PWA: escopo /; estáticos em cache; API e HTML sem cache de dados. */
/* v4-pwa.2: ícone PWA (claquete) e botão Instalar no drawer. */
var STATIC_CACHE = "nossa-lista-static-v4-pwa-2";
var PRECACHE_URLS = [
  "/static/style.css",
  "/static/app.js",
  "/static/favicon.svg",
  "/static/manifest.webmanifest",
  "/static/offline.html",
  "/static/pwa-192.png",
  "/static/pwa-512.png"
];

function isViteBuildAsset(url) {
  return url.pathname.indexOf("/static/build/") === 0;
}

function isStaticAsset(url) {
  return url.pathname.indexOf("/static/") === 0;
}

function isApiOrSuggestionsPath(url) {
  var p = url.pathname;
  return (
    p.indexOf("/search") === 0 ||
    p.indexOf("/api/") === 0 ||
    p.indexOf("/suggestions") === 0
  );
}

function wantsHtml(req) {
  var a = req.headers.get("accept");
  return a && a.indexOf("text/html") !== -1;
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
          .filter(function (k) { return k !== STATIC_CACHE; })
          .map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

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

  /* API, busca e /suggestions: só rede (sem cache de JSON; SSE e streams passam direto). */
  if (isApiOrSuggestionsPath(url)) {
    event.respondWith(fetch(req));
    return;
  }

  /* Páginas HTML: rede; se falhar, offline.html (sem guardar respostas dinâmicas no cache). */
  if (wantsHtml(req)) {
    event.respondWith(
      fetch(req).catch(function () {
        return caches.match("/static/offline.html");
      })
    );
    return;
  }

  /* Demais GET (ex.: raros tipos) — rede direta. */
  event.respondWith(fetch(req));
});

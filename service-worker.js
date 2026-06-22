/* =====================================================================
   service-worker.js  —  Cache offline (app shell + bibliotecas)
   PARE OU SIGA — Conservação
   Estratégia: cache-first com atualização em segundo plano.
   ===================================================================== */

const CACHE = "pare-ou-siga-v6";

const ARQUIVOS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./database.js",
  "./dashboard.js",
  "./auth.js",
  "./sync.js",
  "./manifest.json",
  "./lib/chart.umd.js",
  "./lib/xlsx.full.min.js",
  "./lib/jszip.min.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((chaves) =>
      Promise.all(chaves.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // Não intercepta chamadas à Microsoft (auth/Graph) nem CDNs externas
  const url = e.request.url;
  if (url.includes("login.microsoftonline.com") ||
      url.includes("graph.microsoft.com") ||
      url.includes("sharepoint.com")) return;

  e.respondWith(
    caches.match(e.request).then((cacheado) => {
      const rede = fetch(e.request)
        .then((resp) => {
          if (resp && resp.status === 200 && resp.type === "basic") {
            const clone = resp.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return resp;
        })
        .catch(() => cacheado);
      return cacheado || rede;
    })
  );
});

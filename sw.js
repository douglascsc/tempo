// Service worker do "Vai chover?": deixa o site instalável e abrir sem internet.
// Estratégia: sempre tenta a internet primeiro (dados frescos); se falhar, usa a última cópia salva.
const CACHE = "vai-chover-1";
const SHELL = ["./", "index.html", "manifest.webmanifest", "img/icon-192.png", "img/icon-512.png"];

// Só guarda o que é pequeno e útil sem internet: o próprio site, o Leaflet e as respostas das APIs
// (previsão, avisos, rio, lista de imagens do radar). Imagens de mapa e de radar não, pesariam demais.
const KEEP = [
  u => u.origin === self.location.origin,
  u => u.hostname === "cdnjs.cloudflare.com",
  u => u.hostname === "api.open-meteo.com",
  u => u.hostname === "apiprevmet3.inmet.gov.br",
  u => u.hostname === "telemetriaws1.ana.gov.br",
  u => u.hostname === "api.rainviewer.com",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (!KEEP.some(f => f(url))) return; // o resto vai direto para a internet, sem cópia
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok || res.type === "opaque") cache.put(req, res.clone()); // "opaque" = Leaflet carregado por <script>
      return res;
    } catch (err) {
      // sem internet: a mesma página/arquivo salvo antes (ignorando o ?v= dos arquivos do site)
      const hit = await cache.match(req) || (url.origin === self.location.origin && await cache.match(req, { ignoreSearch: true }));
      if (hit) return hit;
      if (req.mode === "navigate") return cache.match("index.html");
      throw err;
    }
  })());
});

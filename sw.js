// Tiene una copia della pagina, così si apre anche senza internet.
// I post-it invece li conserva Firestore nella sua cache e li sincronizza da solo.
// Quando cambi un file, alza il numero di VERSIONE: i telefoni prendono la nuova copia.
const VERSIONE = "v1";
const CACHE = "cose-da-fare-" + VERSIONE;
const FILE = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "firebase-config.js",
  "manifest.webmanifest",
  "icone/icona-180.png",
  "icone/icona-192.png",
  "icone/icona-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const proprio = url.origin === self.location.origin;
  const libreria = url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/");
  if (!proprio && !libreria) return; // Firestore e accesso passano diretti

  // Prima la rete (così gli aggiornamenti arrivano), la copia solo se manca internet
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copia));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});

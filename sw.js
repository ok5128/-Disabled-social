const CACHE_NAME = "daoxin-v80";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=80",
  "./app.js?v=80",
  "./manifest.webmanifest?v=80",
  "./icon-512.png",
  "./favicon.png",
  "./apple-touch-icon.png",
  "./assets/portraits/系统助手.jpeg",
  "./assets/portraits/庄子.png",
  "./assets/portraits/佛陀.png",
  "./assets/portraits/苏格拉底.png",
  "./assets/taiji.png",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});

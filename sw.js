const CACHE_NAME = "daoxin-v79";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=79",
  "./app.js?v=79",
  "./manifest.webmanifest?v=79",
  "./icon.svg",
  "./assets/portraits/my-soul.jpg",
  "./assets/portraits/zhuangzi.jpg",
  "./assets/portraits/buddha.jpg",
  "./assets/portraits/socrates.jpg",
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

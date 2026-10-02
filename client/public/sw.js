// Only the offline notice is cached. Game pages, APIs and stats stay network-only.
const CACHE = "hoop-bids-offline-v1";
const offlineUrl = new URL("offline.html", self.registration.scope).href;
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(offlineUrl)));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("hoop-bids-offline-") && key !== CACHE).map((key) => caches.delete(key)))),
    self.clients.claim(),
  ]));
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || event.request.mode !== "navigate" || !event.request.url.startsWith(self.registration.scope)) return;
  event.respondWith(fetch(event.request).catch(async () => {
    const cached = await caches.match(offlineUrl);
    return cached || new Response("Hoop Bids needs an internet connection. Reconnect and reload.", { headers: { "Content-Type": "text/plain" } });
  }));
});

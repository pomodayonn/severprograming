const C = "runndesu-v1", FILES = ["./", "./runndesu.html", "./icon-192.png", "./manifest.webmanifest"];
self.addEventListener("install", e => e.waitUntil(caches.open(C).then(c => c.addAll(FILES))));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x))))));
// ネットワーク優先、だめならキャッシュ（オフラインでも開ける）
self.addEventListener("fetch", e => { if (e.request.method !== "GET") return;
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request))); });

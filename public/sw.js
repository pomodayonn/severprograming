// るんです。のサービスワーカー（オフラインでも開けるようにする）
// ・画面（HTML）：ネットワーク優先。つながらなければ保存しておいた画面を出す
// ・/assets/（Vite が作る、名前に指紋つきのファイル）：中身が変わらないのでキャッシュ優先
// ・Google Fonts：キャッシュ優先
// ・AIサーバーや Neon Auth など、ほかのサイトへの通信には手を出さない
const C = "runndesu-v2";
const CORE = ["/", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", e => e.waitUntil(caches.open(C).then(c => c.addAll(CORE)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim())));

const put = (req, res) => { if (res.ok) { const cp = res.clone(); caches.open(C).then(c => c.put(req, cp)); } return res; };
const cacheFirst = req => caches.match(req).then(hit => hit ?? fetch(req).then(r => put(req, r)));

self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === "navigate") return e.respondWith(fetch(req).then(r => put("/", r)).catch(() => caches.match("/")));
    if (url.pathname.startsWith("/assets/")) return e.respondWith(cacheFirst(req));
    return e.respondWith(fetch(req).then(r => put(req, r)).catch(() => caches.match(req)));
  }
  if (FONT_HOSTS.includes(url.hostname)) return e.respondWith(cacheFirst(req));
  // それ以外（API・ログインなど）は素通し
});

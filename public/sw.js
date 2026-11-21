// るんです。のサービスワーカー（オフラインでも開けるようにする）
// ・画面（HTML）：ネットワーク優先。つながらなければ保存しておいた画面を出す
// ・/assets/（Vite が作る、名前に指紋つきのファイル）：中身が変わらないのでキャッシュ優先
// ・Google Fonts：キャッシュ優先
// ・/ocr/（文字起こし用のファイル）：キャッシュ優先。置き場所に版の名前が入っている（例：/ocr/tesseract7.0.0-pdfjs6.5.438/）ので、
//   部品を新しい版にすると URL が変わり、新しいファイルを取りに行く。古い版の保存分は消す
//   ただし /ocr/…/lang/（学習データ）は Tesseract.js が自分で IndexedDB に保存するので、ここでは保存しない（二重に保存しないため）
// ・AIサーバーや Neon Auth など、ほかのサイトへの通信には手を出さない
const C = "runndesu-v2";
const CORE = ["/", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", e => e.waitUntil(caches.open(C).then(c => c.addAll(CORE)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim())));

const put = (req, res) => { if (res.ok) { const cp = res.clone(); caches.open(C).then(c => c.put(req, cp)); } return res; };
const cacheFirst = req => caches.match(req).then(hit => hit ?? fetch(req).then(r => put(req, r)));
/** 文字起こし用のファイルのうち、今使っている版（path の /ocr/<版の名前>/ の部分）以外の保存分を消す */
const dropOldOcr = path => {
  const ver = path.split("/")[2];
  caches.open(C).then(c => c.keys().then(ks => ks.forEach(k => {
    const p = new URL(k.url).pathname; if (p.startsWith("/ocr/") && p.split("/")[2] !== ver) c.delete(k);
  })));
};

self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === "navigate") return e.respondWith(fetch(req).then(r => put("/", r)).catch(() => caches.match("/")));
    if (url.pathname.startsWith("/ocr/")) {
      if (url.pathname.includes("/lang/")) return; // 学習データは素通し（Tesseract.js が IndexedDB に保存する）
      return e.respondWith(cacheFirst(req).then(r => { dropOldOcr(url.pathname); return r; }));
    }
    if (url.pathname.startsWith("/assets/")) return e.respondWith(cacheFirst(req));
    return e.respondWith(fetch(req).then(r => put(req, r)).catch(() => caches.match(req)));
  }
  if (FONT_HOSTS.includes(url.hostname)) return e.respondWith(cacheFirst(req));
  // それ以外（API・ログインなど）は素通し
});

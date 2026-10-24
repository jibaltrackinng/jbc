// Service Worker لتطبيق جبال البصرة (JBC)
// يحفظ ملفات الموقع فقط ليفتح بسرعة. طلبات Google Apps Script (الشحنات والدخول) لا تُحفظ أبداً.
const CACHE = 'jbc-v2';
const CORE = ['./', './index.html', './logo.png', './icon-192.png', './icon-512.png', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  // فقط ملفات الموقع نفسه (نفس النطاق) وطلبات GET
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // الشبكة أولاً (حتى يظهر آخر تحديث للموقع)، والنسخة المحفوظة عند انقطاع الإنترنت
  e.respondWith(
    fetch(req, { cache: 'no-cache' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});

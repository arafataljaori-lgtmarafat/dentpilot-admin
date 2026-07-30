/* Service Worker — DentPilot Admin
   يخزّن هيكل الواجهة للعمل كتطبيق مثبَّت (PWA).
   لا يخزّن أبداً استجابات /api (بيانات حيّة يجب أن تبقى من الشبكة).
   جميع مسارات SHELL نسبية إلى مكان هذا الملف نفسه (self.registration.scope)،
   لذا يعمل بصورة صحيحة سواء نُشر على جذر النطاق أو داخل مجلد فرعي مثل
   GitHub Pages (.../dentpilot-admin/) دون كتابة أي مسار مطلق. */
const CACHE = 'dp-admin-v9';
const SHELL = [
  './', './index.html', './styles.css', './app.js', './api.js',
  './config.js', './demo/demo-license.js', './demo/demo-api.js',
  './agent.html', './agent-portal.js',
  './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './favicon.ico', './favicon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // لا تتدخّل في طلبات الـ API إطلاقاً (لا علاقة لها بمجلد نشر الواجهة)
  if (url.pathname.startsWith('/api/')) return;
  if (e.request.method !== 'GET') return;
  // تجاهل أي طلب خارج نطاق تسجيل هذا الـ Service Worker (مثلاً أصول من نطاق آخر)
  if (!e.request.url.startsWith(self.registration.scope)) return;

  // الشبكة أولاً للتنقّل، مع رجوع لهيكل مخزَّن عند انقطاع الشبكة
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('./index.html')));
    return;
  }
  // cache-first للأصول الثابتة
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => { try { c.put(e.request, copy); } catch (x) {} });
      return res;
    }).catch(() => cached))
  );
});

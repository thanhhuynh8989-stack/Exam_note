const CACHE_NAME = 'sgs-exam-app-v1';

// Danh sách các file nội bộ của ứng dụng cần lưu offline
const LOCAL_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './p2p-sync.js',
  './manifest.json',
  './js/timer.module.js',
  './js/picker.module.js',
  './js/student.module.js',
  './js/config.module.js',
  './js/storage.module.js',
  './js/print.module.js',
  './js/session.module.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(LOCAL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Chiến lược: Ưu tiên mạng để luôn cập nhật bản mới trên GitHub; nếu mất mạng thì lấy từ Cache
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const cloned = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});

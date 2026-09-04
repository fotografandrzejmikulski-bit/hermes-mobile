const CACHE_VERSION = 'hermes-apex-pl-v4.0.0';
const STATIC_ASSETS = ['/', '/index.html', '/app.js', '/styles.css', '/manifest.json', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const dynamic =
    url.pathname.startsWith('/hermes-backend/') ||
    url.pathname.startsWith('/healthz') ||
    url.pathname.startsWith('/bridge/');

  if (dynamic || event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(event.request);
      const network = fetch(event.request).then((response) => {
        if (response.ok && response.type === 'basic') cache.put(event.request, response.clone());
        return response;
      }).catch(() => null);
      return cached || network || Response.error();
    }),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'HERMES_TASK_COMPLETED') {
    const { title, body } = event.data;
    event.waitUntil?.(notifyTaskCompleted(title, body));
  }
});

async function notifyTaskCompleted(
  title = 'Hermes zakończył zadanie',
  body = 'Wyniki wykonania polecenia są gotowe do wglądu.',
) {
  await self.registration.showNotification(title, {
    body,
    icon: '/icon.svg',
    badge: '/icon.svg',
    lang: 'pl-PL',
    dir: 'ltr',
    tag: 'hermes-task-complete',
    renotify: true,
  });
}

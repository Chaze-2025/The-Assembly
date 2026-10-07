// An offline landing page is explicit; authenticated/API responses are never cached.
const CACHE = 'assembly-offline-v1';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add('/offline.html')));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return;
  const path = new URL(event.request.url).pathname;
  if (path.startsWith('/_api/') || path.startsWith('/.well-known/') || ['/llms.txt','/robots.txt','/sitemap.xml','/server.json'].includes(path)) return;
  event.respondWith(fetch(event.request).catch(async () => {
    const offline = await caches.match('/offline.html');
    if (!offline) return new Response('The Assembly is offline. Reconnect to read the public record.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    // Assets can redirect .html to its canonical path. Navigation requests use
    // redirect:manual, so construct a fresh response from the cached document.
    return new Response(offline.body, { status: offline.status, headers: offline.headers });
  }));
});

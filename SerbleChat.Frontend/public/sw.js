/* SerbleChat PWA Service Worker */

const CACHE_NAME = 'serble-chat-v1';
// Written by src/push.js: { apiBase, endpoint, vapidKey }
const PUSH_META_CACHE = 'serble-push-meta';
const PUSH_META_URL = '/__push-meta';
const STATIC_CACHE = 'serble-static-v1';
const DYNAMIC_CACHE = 'serble-dynamic-v1';

// Assets to cache on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/offline.html',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => console.error('Cache install failed:', err))
  );
});

self.addEventListener('activate', event => {
  // Clean up old caches
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(name => name !== STATIC_CACHE && name !== DYNAMIC_CACHE && name !== CACHE_NAME && name !== PUSH_META_CACHE)
            .map(name => caches.delete(name))
        );
      })
      .then(() => self.clients.claim())
  );
});

// Network-first strategy for API calls, cache-first for static assets
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip chrome extensions and other non-http(s) requests
  if (!url.protocol.startsWith('http')) return;

  // API requests - network first, no cache
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/hub/')) {
    return; // Let the browser handle it normally
  }

  // Static assets - cache first, network fallback
  event.respondWith(
    caches.match(request)
      .then(cached => {
        if (cached) return cached;

        return fetch(request)
          .then(response => {
            // Don't cache non-successful responses
            if (!response || response.status !== 200 || response.type === 'error') {
              return response;
            }

            // Clone the response
            const responseClone = response.clone();

            // Cache static assets only (js, css, images, fonts)
            if (url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|gif|woff|woff2|ttf|eot|ico)$/)) {
              caches.open(DYNAMIC_CACHE)
                .then(cache => cache.put(request, responseClone));
            }

            return response;
          })
          .catch(err => {
            console.error('Fetch failed:', err);
            // For navigation requests, return cached index.html instead of offline page
            // This allows the app to load and handle connection issues gracefully
            // rather than showing an offline page for transient network errors
            if (request.mode === 'navigate') {
              return caches.match('/index.html');
            }
            // For other requests, try to return cached version
            return caches.match('/index.html');
          });
      })
  );
});


self.addEventListener('push', event => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { type: 'unknown', message: null };
  }

  let title = 'Serble Chat';
  let body = 'New notification';
  let tag = 'serble-notification';
  let data = {};

  if (payload.type === 'message' && payload.message) {
    const msg = payload.message;
    title = msg.author?.username ?? msg.webhook_username ?? msg.author_id ?? 'Serble Chat';
    // content is null when the user turned off "include message content" (content_hidden: true)
    body = msg.content || 'New message';
    tag = `message:${msg.channel_id}`;
    data = { channelId: msg.channel_id };
  }

  const options = {
    body,
    tag,
    data,
    icon: '/favicon.webp',
    badge: '/favicon.webp',
    renotify: true,
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
      .then(() => payload.ack && ackDelivery(payload.ack, Date.now()))
  );
});

async function readPushMeta() {
  try {
    const cache = await caches.open(PUSH_META_CACHE);
    const res = await cache.match(PUSH_META_URL);
    return res ? await res.json() : null;
  } catch {
    return null;
  }
}

async function writePushMeta(meta) {
  const cache = await caches.open(PUSH_META_CACHE);
  await cache.put(PUSH_META_URL, new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
}

/** Tells the server the notification is showing, so it can measure delivery time. Best effort. */
async function ackDelivery(id, shownAt) {
  const meta = await readPushMeta();
  if (!meta?.apiBase) return;
  try {
    await fetch(`${meta.apiBase}/notifications/ack/${encodeURIComponent(id)}?shownAt=${shownAt}`, { method: 'POST', keepalive: true });
  } catch { /* statistics only */ }
}

function base64UrlToUint8Array(base64Url) {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

// The browser replaced our subscription (expired, or the push service rotated it). Until the page next loads the
// server would keep pushing to the dead endpoint, so move it over now. The old endpoint is the proof of ownership.
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    const meta = await readPushMeta();
    if (!meta?.apiBase) return;
    const oldEndpoint = event.oldSubscription?.endpoint ?? meta.endpoint;
    if (!oldEndpoint) return;

    let sub = event.newSubscription;
    if (!sub) {
      const applicationServerKey = event.oldSubscription?.options?.applicationServerKey
        ?? (meta.vapidKey ? base64UrlToUint8Array(meta.vapidKey) : null);
      if (!applicationServerKey) return;
      sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    }
    if (sub.endpoint === oldEndpoint) return;

    const json = sub.toJSON();
    const res = await fetch(`${meta.apiBase}/account/web-push-subscription/rotate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldUrl: oldEndpoint, url: sub.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth }),
    });
    if (res.ok) await writePushMeta({ ...meta, endpoint: sub.endpoint });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  const channelId = event.notification.data?.channelId;
  const url = channelId
    ? `/app/channel/${channelId}`
    : '/app';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Focus an existing tab if possible
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});

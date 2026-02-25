/* SerbleChat Push Notification Service Worker */

self.addEventListener('install', event => {
  // Activate immediately — don't wait for existing tabs to close.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  // Take control of all open clients immediately so that
  // pushManager.subscribe() works without a page reload.
  event.waitUntil(self.clients.claim());
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
    title = msg.author.username ?? msg.author_id;
    body = msg.content ?? 'New message';
    tag = `message:${msg.channel_id}`;
    data = { channelId: msg.channel_id };
  }

  const options = {
    body,
    tag,
    data,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    renotify: true,
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
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

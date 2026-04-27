/* ============================================================
   sw.js — MediSync Service Worker
   Enables background notifications even when browser is closed.
   ============================================================ */
const CACHE_NAME = 'medisync-v1';

// ── Install ────────────────────────────────────────────────────
self.addEventListener('install', e => {
  self.skipWaiting();
});

// ── Activate ───────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

// ── Push Notification Handler ──────────────────────────────────
// Called when backend sends a push event (future MQTT/WebSocket upgrade)
self.addEventListener('push', e => {
  let data = { title: '🚨 MediSync Alert', body: 'A patient may have missed their medicine.' };
  try { data = e.data.json(); } catch (_) {}

  e.waitUntil(
    self.registration.showNotification(data.title, {
      body:             data.body,
      icon:             '/icon-192.png',
      badge:            '/icon-192.png',
      vibrate:          [300, 100, 300, 100, 300],
      requireInteraction: true,   // stays on screen until dismissed
      tag:              'medisync-missed-dose',
      renotify:         true,
      actions: [
        { action: 'view',    title: '📋 View Dashboard' },
        { action: 'dismiss', title: '✓ Dismiss'         },
      ],
    })
  );
});

// ── Notification Click ─────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // Focus existing tab or open new one
      const existing = list.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return clients.openWindow('/');
    })
  );
});

// ── Background Sync (offline retry — future use) ───────────────
self.addEventListener('sync', e => {
  if (e.tag === 'sync-logs') {
    // placeholder for offline log sync
  }
});

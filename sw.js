/**
 * JS Traders ERP - Mobile Staff Service Worker
 * Handles:
 * 1. Background System Push Notifications
 * 2. Notification Clicks (Focuses or launches app)
 * 3. Offline Caching of Mobile App Shell
 */

const CACHE_NAME = 'js-staff-cache-v3';
const ASSETS_TO_CACHE = [
  '/',
  '/mobile.html',
  '/manifest.json',
  '/assets/js/mobileApp.js',
  '/services/storageService.js',
  '/services/gatepassService.js',
  '/services/productService.js',
  '/services/staffAuthService.js',
  '/utils/soundAlert.js',
  '/utils/imageCompressor.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch(err => console.warn('[SW] Cache prefetch warning:', err));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Cache-first / Network-fallback for static shell
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Do not cache API requests
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch fresh copy in background
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => {});
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});

// System Push Notification Handler
self.addEventListener('push', (event) => {
  let data = {
    title: '🚨 Urgent Stock Fetch Assignment',
    body: 'A new Gatepass Outward has been issued by the Warehouse Manager.',
    gatepassId: null,
    gatepassNumber: 'GP'
  };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/assets/images/mobile-qr.png',
    badge: '/assets/images/mobile-qr.png',
    vibrate: [350, 150, 350, 150, 600],
    data: {
      url: '/mobile.html',
      gatepassId: data.gatepassId
    },
    requireInteraction: true,
    tag: data.gatepassNumber || 'gatepass-alert',
    renotify: true
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Notification Click Handler (Open or Focus Mobile App)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/mobile.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('mobile.html') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

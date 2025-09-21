// Service Worker for Flowbox PWA
const CACHE_NAME = 'flowbox-v1.6.3';
const STATIC_CACHE_NAME = 'flowbox-static-v1.6.3';
const DYNAMIC_CACHE_NAME = 'flowbox-dynamic-v1.6.3';

// Files to cache for offline functionality
const STATIC_FILES = [
  './index.html',
  './styles.css',
  './script.js',
  './components.js',
  './favicon.svg',
  './logo.svg',
  './manifest.json',
  // External libraries
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  // Google Fonts
  'https://fonts.googleapis.com/css2?family=Sarabun:wght@100;200;300;400;500;600;700;800&display=swap'
];

// Install event - cache static files
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing...');
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Caching static files');
        return cache.addAll(STATIC_FILES);
      })
      .then(() => {
        console.log('Service Worker: Static files cached successfully');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('Service Worker: Failed to cache static files', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...');
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== STATIC_CACHE_NAME && cacheName !== DYNAMIC_CACHE_NAME) {
              console.log('Service Worker: Deleting old cache', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('Service Worker: Activated successfully');
        return self.clients.claim();
      })
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip chrome-extension and other non-http requests
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Network-first for navigations to avoid HTML/JS mismatches after deploys
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(new Request(request.url, { cache: 'reload' }))
        .then((networkResponse) => {
          const copy = networkResponse.clone();
          caches.open(STATIC_CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          return networkResponse;
        })
        .catch(async () => {
          const cached = await caches.match('./index.html');
          return cached || Response.error();
        })
    );
    return;
  }

  // Network-first for scripts to avoid stale JS after updates
  if (request.destination === 'script' || url.pathname.endsWith('/script.js') || url.pathname.endsWith('/components.js')) {
    event.respondWith(
      fetch(new Request(request.url, { cache: 'reload' }))
        .then((networkResponse) => {
          const copy = networkResponse.clone();
          caches.open(STATIC_CACHE_NAME).then((cache) => cache.put(request, copy));
          return networkResponse;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || Response.error();
        })
    );
    return;
  }

  // Cache-first for other GET requests with dynamic caching fallback
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          console.log('Service Worker: Serving from cache', request.url);
          return cachedResponse;
        }
        console.log('Service Worker: Fetching from network', request.url);
        return fetch(request)
          .then((response) => {
            if (!response || response.status !== 200 || (response.type !== 'basic' && response.type !== 'cors')) {
              return response;
            }
            const responseToCache = response.clone();
            caches.open(DYNAMIC_CACHE_NAME)
              .then((cache) => cache.put(request, responseToCache));
            return response;
          })
          .catch((error) => {
            console.log('Service Worker: Network fetch failed', request.url, error);
            throw error;
          });
      })
  );
});

// Handle background sync (if supported)
self.addEventListener('sync', (event) => {
  console.log('Service Worker: Background sync', event.tag);
  
  if (event.tag === 'background-sync') {
    event.waitUntil(
      // Handle any background sync tasks here
      // For example, sync data when connection is restored
      syncData()
    );
  }
});

// Handle push notifications (if needed in the future)
self.addEventListener('push', (event) => {
  console.log('Service Worker: Push notification received');
  
  const options = {
    body: event.data ? event.data.text() : 'New update available',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      {
        action: 'explore',
        title: 'Open Flowbox',
        icon: '/icons/icon-96x96.png'
      },
      {
        action: 'close',
        title: 'Close',
        icon: '/icons/icon-96x96.png'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification('Flowbox', options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('Service Worker: Notification clicked');
  
  event.notification.close();

  if (event.action === 'explore') {
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});

// Helper function for background sync
async function syncData() {
  try {
    // This is where you would sync any pending data
    // For example, if you had offline changes to sync
    console.log('Service Worker: Syncing data...');
    
    // Since Flowbox uses localStorage, data is already persisted locally
    // This function could be used for future cloud sync features
    
  } catch (error) {
    console.error('Service Worker: Sync failed', error);
  }
}

// Handle messages from the main thread
self.addEventListener('message', (event) => {
  console.log('Service Worker: Message received', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

console.log('Service Worker: Script loaded');

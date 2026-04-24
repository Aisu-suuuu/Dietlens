// DietLens Service Worker
// Cache strategy: NetworkFirst for pages, CacheFirst for static assets.

const VERSION = "v1";
const CACHE_SHELL = `dietlens-shell-${VERSION}`;
const CACHE_STATIC = `dietlens-static-${VERSION}`;

// App shell + icons to precache on install
const PRECACHE_URLS = [
  "/",
  "/offline",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-180.png",
];

// ── Install: precache the app shell ──────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_SHELL)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: purge old cache versions ───────────────────────────────────────
self.addEventListener("activate", (event) => {
  const validCaches = [CACHE_SHELL, CACHE_STATIC];
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !validCaches.includes(key))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Let Supabase API calls pass through — never intercept user data
  if (url.hostname.includes("supabase")) return;

  // CacheFirst for icons and other static assets in /icons/
  if (url.pathname.startsWith("/icons/") || url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, CACHE_STATIC));
    return;
  }

  // NetworkFirst for page navigations — fall back to /offline
  if (request.mode === "navigate") {
    event.respondWith(networkFirstWithOfflineFallback(request));
    return;
  }
});

// NetworkFirst: try network, cache on success, fall back to cache
async function networkFirstWithOfflineFallback(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_SHELL);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Return offline page as last resort
    return caches.match("/offline");
  }
}

// CacheFirst: serve from cache; fetch + cache on miss
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

// ── Push notifications (T16 fills this in — Sprint 3) ────────────────────────
self.addEventListener("push", (event) => {
  // TODO (T16): parse event.data.json(), call self.registration.showNotification(...)
  // Stub: silently ignore until push infra is wired.
  console.log("[SW] push received — handler stubbed for T16");
});

// ── Notification click (T16 fills this in — Sprint 3) ────────────────────────
self.addEventListener("notificationclick", (event) => {
  // TODO (T16): focus existing client or open app URL
  event.notification.close();
  console.log("[SW] notificationclick — handler stubbed for T16");
});

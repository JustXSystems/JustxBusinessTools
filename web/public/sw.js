const CACHE = "jbt-shell-v9";

function appBase() {
  try {
    const pathname = new URL(self.registration.scope).pathname;
    return pathname.replace(/\/$/, "") || "";
  } catch {
    return "";
  }
}

function withBase(path) {
  const base = appBase();
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!base) return p;
  if (p === base || p.startsWith(`${base}/`)) return p;
  return `${base}${p}`;
}

function precacheUrls() {
  return [withBase("/"), withBase("/offline.html"), withBase("/icons/jbt-icon.svg")];
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(precacheUrls()))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const base = appBase();
  const path = url.pathname;
  const under = (prefix) =>
    path === prefix || path.startsWith(`${prefix}/`) || (base && path.startsWith(`${base}${prefix}`));

  if (under("/api")) return;
  if (path.includes("/_next/")) return;
  if (under("/login")) return;
  // Never cache install branding — Chrome install dialog reads these.
  if (
    under("/icons") ||
    under("/uploads") ||
    under("/pwa-icon") ||
    path.includes("manifest")
  ) {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(withBase("/offline.html"))));
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request)),
  );
});

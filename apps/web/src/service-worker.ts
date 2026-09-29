/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

/**
 * Offline support for the static build.
 *
 * `build` and `files` come from the `$service-worker` module: `build` is the
 * immutable hashed asset set and `files` the prerendered page set. Both must be
 * IMPORTED — read as ambient globals they are left unresolved in the bundle and
 * the emitted worker throws on install.
 *
 * Strategy, in order of preference:
 *   1. Navigation requests are served from the precached prerendered HTML, so a
 *      cold load with the network down still renders a page.
 *   2. The immutable asset set is precached on install.
 *   3. Runtime requests fall back to a cached copy when the network fails, so a
 *      tool visited online once still opens offline.
 *
 * pdfium (4.4 MB of WASM) and the pdf.js worker (2.1 MB) are deliberately NOT
 * precached: only a few tools need them, and eagerly caching them would make a
 * first visit download megabytes it never uses. They are still cached at
 * runtime the first time a tool actually needs one.
 */
import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `pdf-complianttools-${version}`;
const OFFLINE_FALLBACK = '/offline.html';

/**
 * SvelteKit's `files` is only the contents of `static/` — it does NOT include
 * prerendered routes. The prerendered HTML is the part that actually makes a
 * cold offline navigation work, so the page list is declared here. Keeping it
 * explicit also means a new route is a deliberate addition rather than an
 * accident of the bundler.
 */
const PRERENDERED_ROUTES = [
  '/',
  '/create-pdf',
  '/invoice-creator',
  '/e-invoice',
  '/merge',
  '/qr-code',
  '/scan-to-pdf',
  '/document-pack-builder',
  '/batch',
  '/recipe',
  '/watch',
  '/webpage-to-pdf',
  '/view-pdf',
  '/compare-pdf',
  '/pdf-to-markdown',
  '/compress-pdf',
  '/organize',
  '/split',
  '/ocr-pdf',
  '/connect-ai',
];

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // addAll is all-or-nothing: one 404 and the install fails, taking offline
      // support down entirely. Cache entries individually and skip the misses so
      // a single bad asset cannot break the whole worker.
      const urls = [...new Set([...build, ...files, ...PRERENDERED_ROUTES])];
      // The heavy runtimes are excluded: pdfium is 4.4 MB of WASM and the
      // pdf.js worker 2.1 MB, and only a few tools touch either. Precaching
      // them would make every first visit download 6.5 MB it never uses, to
      // make offline work for the tools that need them — which is the wrong
      // trade. They are still cached at runtime the first time one is used.
      const DEFERRED = /\.wasm$|_app\/immutable\/assets\/pdf\.worker\./u;
      const precache = urls.filter((url) => !DEFERRED.test(url));
      await Promise.all(
        precache.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: 'reload' }));
          } catch {
            // A page that failed to prerender is simply not available offline.
            // Skipping it beats failing the whole install.
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Version is part of the cache name, so a deploy cannot leave a user on
      // chunks whose hashes no longer resolve. Delete anything older.
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

sw.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);

      // A navigation wants the prerendered HTML for that path. Serving it from
      // the cache first is what makes a cold offline load work at all.
      if (request.mode === 'navigate') {
        const cached = await cache.match(url.pathname);
        if (cached) return cached;
      }

      try {
        const response = await fetch(request);
        // Hashed assets and pages are safe to keep; opaque or error responses
        // are not worth storing.
        if (response.ok && response.type === 'basic') {
          await cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        const cached = await cache.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') {
          const fallback = await cache.match(OFFLINE_FALLBACK);
          if (fallback) return fallback;
        }
        throw error;
      }
    })(),
  );
});

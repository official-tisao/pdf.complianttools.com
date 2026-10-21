import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Connect, type Plugin } from 'vite';

/**
 * The static assets directory.
 *
 * Used so a path that has a real file behind it is never rewritten: `/offline.html`
 * is a shipped asset, not an alias for a route.
 */
const STATIC_DIR = fileURLToPath(new URL('./static', import.meta.url));

/**
 * Serves `/foo.html` as `/foo` in the dev server.
 *
 * The site ships a `.html` alias for a growing set of routes — some of them pages
 * of their own, some of them 301 stubs (`/merge.html` -> `/merge`) — and every one
 * of them exists only in the prerendered build. The dev server has no such file to
 * serve, so `/annotate.html` came back 404 while `/annotate` returned 200: the alias
 * looked broken to anyone testing it, and to anyone following a link that carries
 * the extension.
 *
 * Rewriting the request here rather than adding a `+server.ts` per alias keeps the
 * alias set derived from the route tree. Hand-maintaining one stub per route is
 * what let them drift apart in the first place.
 *
 * Two details make it behave:
 *
 *   - `req.originalUrl` is rewritten as well as `req.url`. SvelteKit's dev
 *     middleware restores `req.url` from `req.originalUrl` before it routes, so
 *     changing `req.url` on its own is undone a line later.
 *   - A path with a real file behind it is left alone, so `/offline.html` still
 *     serves that file instead of being rewritten to a route that does not exist.
 */
function htmlExtensionFallback(): Plugin {
  return {
    name: 'pdf-tools:html-extension-fallback',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url;
        if (!url) return next();

        // The query string is split off first so it survives the rewrite.
        const queryStart = url.indexOf('?');
        const pathname = queryStart === -1 ? url : url.slice(0, queryStart);
        const search = queryStart === -1 ? '' : url.slice(queryStart);

        if (!pathname.endsWith('.html')) return next();

        const file = resolve(STATIC_DIR, `.${pathname}`);
        if (file.startsWith(STATIC_DIR) && existsSync(file)) return next();

        let route = pathname.slice(0, -'.html'.length);
        // `/index.html` is the landing page, as it is on any static host.
        if (route === '/index') route = '/';
        if (!route || route === '/') return next();

        req.url = route + search;
        (req as Connect.IncomingMessage).originalUrl = route + search;

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [sveltekit(), htmlExtensionFallback()],
  server: {
    host: '127.0.0.1',
  },
});

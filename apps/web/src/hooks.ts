import type { Reroute } from '@sveltejs/kit';

/**
 * The production static host serves `/tool.html` directly. Vite's dev server
 * routes by SvelteKit pathname instead, so normalize the cache-friendly form
 * while developing without creating a second route for every tool.
 */
export const reroute: Reroute = ({ url }) => {
  if (url.pathname.length > 1 && url.pathname.endsWith('.html')) {
    return url.pathname.slice(0, -'.html'.length);
  }
  return undefined;
};

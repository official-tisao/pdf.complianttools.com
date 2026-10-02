import { readdir } from 'node:fs/promises';
import path from 'node:path';

const HTML_SUFFIX = '.html';

export function htmlRoute(route) {
  if (route === '/' || route.endsWith(HTML_SUFFIX)) return route;
  return `${route}${HTML_SUFFIX}`;
}

/** Find concrete page routes while ignoring locale wrapper routes. */
export async function findStaticRoutes(routesRoot) {
  const routes = [];

  async function visit(directory, route) {
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name === '+page.svelte')) {
      routes.push(route || '/');
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('[') || entry.name.startsWith('(')) {
        continue;
      }
      await visit(path.join(directory, entry.name), `${route}/${entry.name}`);
    }
  }

  await visit(routesRoot, '');
  return routes.sort((left, right) => left.localeCompare(right));
}

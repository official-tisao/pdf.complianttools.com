import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Enumerates the routes whose page shell accepts a `locale` prop, so the
 * `[locale]` tree can be generated for each.
 *
 * Four shells are localizable — ToolWorkspace, PhaseCTool, ConversionTool,
 * FeaturePage — because a route file is a thin prop-pass to one of them. The
 * localised route therefore re-renders the *same* shell with `locale` set,
 * rather than duplicating the page: one route definition, three locales.
 */

/**
 * The shells a route can mount that resolve copy through the catalogue.
 *
 * The last two are the invoice surfaces. They were not in the original list,
 * which meant the generator skipped `/invoice-creator` and `/e-invoice` — and
 * because the generator owns the tree, skipping them **deleted** the two
 * hand-written localized pages that existed before it.
 */
const SHELLS = [
  'ToolWorkspace',
  'PhaseCTool',
  'ConversionTool',
  'FeaturePage',
  'InvoiceCreatorPage',
  'ENoInvoicePage',
];

export async function pageFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await pageFiles(path)));
    else if (entry.name === '+page.svelte') output.push(path);
  }
  return output;
}

/**
 * @returns {Promise<Array<{ route: string, shell: string }>>} one entry per
 * localizable route, excluding the landing page and anything already inside
 * `[locale]`.
 */
export async function findLocalizableRoutes(routesRoot) {
  const found = [];
  for (const absolute of await pageFiles(routesRoot)) {
    const route = relative(routesRoot, absolute).split('\\').join('/');
    // `foo/+page.svelte` -> `/foo`
    const path = `/${route.replace(/\/?\+page\.svelte$/u, '')}`;
    if (path === '/' || path.startsWith('/[locale]')) continue;
    const source = await readFile(absolute, 'utf8');
    const shell = SHELLS.find((candidate) => new RegExp(`<${candidate}[\\s/>]`, 'u').test(source));
    if (shell) found.push({ route: path, shell, absolute });
  }
  return found.sort((left, right) => left.route.localeCompare(right.route));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const routes = await findLocalizableRoutes(resolve('apps/web/src/routes'));
  const counts = {};
  for (const entry of routes) counts[entry.shell] = (counts[entry.shell] ?? 0) + 1;
  console.log(`${routes.length} localizable routes`);
  console.log(counts);
}

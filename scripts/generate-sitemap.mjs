import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Generates `sitemap.xml` from the route manifest.
 *
 * The site ships 250+ prerendered pages and had no sitemap at all, so a crawler
 * had to discover every one of them by following links from `/` — where the
 * header links 11 routes and the landing page links 6.
 *
 * The manifest is the source, so a new route cannot be added without appearing
 * here, and the sitemap cannot drift from what actually ships.
 *
 * `en-XA` is excluded: it is a pseudo-locale whose copy is accented and padded
 * on purpose, and listing it would invite indexing of text no user ever reads.
 */
const SITE_ORIGIN = 'https://pdf.complianttools.com';

const escape = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const staticPath = (path) => (path === '/' || path.endsWith('.html') ? path : `${path}.html`);

/**
 * Builds one `<url>` entry.
 *
 * `alternates` are emitted only when more than one locale is served for the
 * path, because a single-locale `<url>` with one alternate is noise, and
 * `xhtml:link` requires the `xhtml` namespace declared on `<urlset>`.
 */
export function urlEntry(path, { alternates = [], lastmod, changefreq, priority }) {
  const lines = [`  <url>`, `    <loc>${escape(SITE_ORIGIN + staticPath(path))}</loc>`];
  if (lastmod) lines.push(`    <lastmod>${lastmod}</lastmod>`);
  if (changefreq) lines.push(`    <changefreq>${changefreq}</changefreq>`);
  if (priority !== undefined) lines.push(`    <priority>${priority.toFixed(1)}</priority>`);
  for (const alternate of alternates) {
    lines.push(
      `    <xhtml:link rel="alternate" hreflang="${escape(alternate.hreflang)}" href="${escape(alternate.href)}"/>`,
    );
  }
  lines.push('  </url>');
  return lines.join('\n');
}

/**
 * The locale-prefixed paths for a canonical path.
 *
 * Only locales that actually serve this path are advertised. The landing page
 * has no `/ar/` variant, so listing one would put a 404 in the sitemap — the
 * fastest way to lose a crawler's trust in the whole file.
 */
export function localizedPaths(path, serves = {}) {
  if (path === '/') {
    return [{ hreflang: 'en', href: `${SITE_ORIGIN}/` }];
  }
  return ['en', 'ar']
    .filter((locale) => locale === 'en' || serves[locale] !== false)
    .map((locale) => ({
      hreflang: locale,
      href:
        locale === 'en'
          ? `${SITE_ORIGIN}${staticPath(path)}`
          : `${SITE_ORIGIN}${staticPath(`/${locale}${path}`)}`,
    }));
}

export function renderSitemap(entries) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...entries.map((entry) => urlEntry(entry.path, entry)),
    '</urlset>',
    '',
  ].join('\n');
}

async function main() {
  const root = process.cwd();
  const manifest = JSON.parse(await readFile(resolve(root, 'docs/route-manifest.json'), 'utf8'));
  // The build output is the authority on what actually exists. Reading it rather
  // than assuming means a path can never be advertised before its page ships —
  // a sitemap listing a 404 is worse than no sitemap.
  const buildRoot = resolve(root, 'apps/web/build');
  const serves = async (path) => {
    const relative = path === '/' ? 'index.html' : `${path.replace(/^\//u, '')}.html`;
    return existsSync(resolve(buildRoot, relative));
  };

  const advertised = [];
  for (const route of manifest.routes) {
    const path = route.path;
    if (!(await serves(path))) continue;
    const locales = {};
    for (const locale of ['en', 'ar']) {
      locales[locale] = locale === 'en' ? true : await serves(`/${locale}${path}`);
    }
    advertised.push({ path, locales });
  }

  const entries = advertised
    .filter((entry) => entry.path !== '/')
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((route) => ({
      path: route.path,
      alternates: localizedPaths(route.path, route.locales),
      changefreq: 'monthly',
      priority: 0.7,
    }));

  // The landing page first, at the highest priority: it is the site's canonical
  // entry point and every crawl reaches it.
  const sitemap = renderSitemap([
    {
      path: '/',
      alternates: localizedPaths('/', advertised.find((entry) => entry.path === '/')?.locales),
      changefreq: 'weekly',
      priority: 1.0,
    },
    ...entries,
  ]);

  const target = resolve(root, 'apps/web/static/sitemap.xml');
  await writeFile(target, sitemap);
  const alternates = 2 + entries.filter((entry) => entry.alternates.length > 1).length;
  console.log(
    `wrote apps/web/static/sitemap.xml — ${entries.length + 1} URLs, ` +
      `${alternates} locale alternates (from ${manifest.routes.length} manifest routes)`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();

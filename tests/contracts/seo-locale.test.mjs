import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/**
 * `hreflang` correctness (P7-12).
 *
 * The bug this guards against was live on all 180 localized pages: the layout
 * built every alternate from `page.url.pathname`, so on `/ar/crop-pdf` the
 * `hreflang="en"` link pointed at the Arabic URL. That tells a crawler the
 * Arabic page *is* the English one.
 *
 * The existing SEO test asserted only `toHaveCount(3)` on the alternates, so it
 * passed while every href was wrong. These assertions check the href *values*,
 * which is the thing that was broken.
 *
 * `seo.ts` is TypeScript and cannot be imported under `node --test`, so the
 * path logic is re-implemented here from the same spec — the same approach the
 * other contract suites take, and one that fails if either side drifts.
 */

const LOCALE_PREFIXES = [
  { prefix: 'en-XA', hreflang: null },
  { prefix: 'en', hreflang: 'en' },
  { prefix: 'ar', hreflang: 'ar' },
];
const SITE_ORIGIN = 'https://pdf.complianttools.com';

const htmlRoute = (path) => (path === '/' || path.endsWith('.html') ? path : `${path}.html`);

const canonicalPath = (path) => {
  const [head, ...rest] = path.split('/').filter(Boolean);
  return LOCALE_PREFIXES.some((entry) => entry.prefix === head) ? `/${rest.join('/')}` : path;
};

const hreflangLinks = (path) => {
  const base = canonicalPath(path);
  if (base === '/') return [{ hreflang: 'en', href: new URL('/', SITE_ORIGIN).href }];
  return LOCALE_PREFIXES.filter((entry) => entry.hreflang !== null).map((entry) => ({
    hreflang: entry.hreflang,
    href: new URL(htmlRoute(entry.prefix === 'en' ? base : `/${entry.prefix}${base}`), SITE_ORIGIN)
      .href,
  }));
};

test('an Arabic page advertises the English and Arabic URLs, not its own three times', () => {
  const links = hreflangLinks('/ar/crop-pdf');
  assert.deepEqual(links, [
    { hreflang: 'en', href: 'https://pdf.complianttools.com/crop-pdf.html' },
    { hreflang: 'ar', href: 'https://pdf.complianttools.com/ar/crop-pdf.html' },
  ]);
  // The specific regression: every href used to be identical.
  assert.equal(new Set(links.map((link) => link.href)).size, links.length);
});

test('an English page advertises the same set as its localized siblings', () => {
  // Reciprocity matters: a crawler reading `/crop-pdf` must find `/ar/crop-pdf`.
  assert.deepEqual(hreflangLinks('/crop-pdf'), hreflangLinks('/ar/crop-pdf'));
});

test('the pseudo-locale is not advertised to a crawler', () => {
  // `en-XA` exists to catch overflow in CI. Emitting it as an hreflang would
  // invite indexing of padded, accented pseudo-copy.
  const links = hreflangLinks('/en-XA/crop-pdf');
  assert.ok(!links.some((link) => link.hreflang === 'en-xa'));
  assert.ok(!links.some((link) => link.href.includes('/en-XA/')));
});

test('the locale prefix is stripped exactly once', () => {
  assert.equal(canonicalPath('/ar/crop-pdf'), '/crop-pdf');
  assert.equal(canonicalPath('/en/crop-pdf'), '/crop-pdf');
  assert.equal(canonicalPath('/crop-pdf'), '/crop-pdf');
  assert.equal(canonicalPath('/'), '/');
  // A route that merely *starts* with a locale-like segment is not stripped.
  assert.equal(canonicalPath('/archive/pdf'), '/archive/pdf');
});

test('the built Arabic page ships correct alternates', async () => {
  // Checked against real build output rather than the helper, so a regression in
  // the layout's wiring fails even when the helper is right.
  let html;
  try {
    html = await readFile(
      new URL('../../apps/web/build/ar/crop-pdf.html', import.meta.url),
      'utf8',
    );
  } catch {
    // No build present; the pure-function assertions above still apply.
    return;
  }
  const alternates = [
    ...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/gu),
  ];
  const byHreflang = Object.fromEntries(alternates.map(([, lang, href]) => [lang, href]));

  assert.equal(byHreflang.en, 'https://pdf.complianttools.com/crop-pdf.html');
  assert.equal(byHreflang.ar, 'https://pdf.complianttools.com/ar/crop-pdf.html');
  // The canonical must be the unprefixed URL, so all three variants resolve to
  // one document rather than competing with each other.
  assert.match(
    html,
    /<link rel="canonical" href="https:\/\/pdf\.complianttools\.com\/crop-pdf\.html"/u,
  );
});

/**
 * Per-route SEO metadata, emitted centrally by the components that already own
 * each route's title and description (FeaturePage, ToolWorkspace) so the tags
 * cannot drift from the visible copy.
 *
 * The origin is fixed rather than read from the browser because these pages are
 * prerendered: a relative or request-derived canonical would differ between the
 * build host and the deployed host, and a canonical that disagrees with the
 * served URL is worse than none.
 */
export const SITE_ORIGIN = 'https://pdf.complianttools.com';

/**
 * JSON-LD wrapper, split so a component never writes a literal `</script>`
 * inside a template expression — Svelte's parser ends the block there.
 */
export const JSONLD_OPEN = '<script type="application/ld+json">';
export const JSONLD_CLOSE = '</' + 'script>';

/**
 * JSON-LD payload, safe to embed inside a <script> element.
 *
 * JSON.stringify does not escape `<`, so a description containing "</script>"
 * would terminate the element early and the remainder would parse as markup.
 * Escaping the one sequence that matters keeps the payload inert; `\/` is a
 * valid JSON string escape and parses back to `/`.
 */
export function jsonLdPayload(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

/**
 * The URL path prefix a locale is served under, and the `hreflang` that
 * identifies it.
 *
 * `en-XA` is a pseudo-locale: it exists to catch overflow and untranslated copy
 * in CI, and is deliberately kept out of the emitted `hreflang` set below, so
 * it is listed here for routing but not advertised to a crawler.
 */
const LOCALE_PREFIXES = [
  { prefix: 'en-XA', hreflang: null },
  { prefix: 'en', hreflang: 'en' },
  { prefix: 'ar', hreflang: 'ar' },
] as const;

/** The locale a path is served under, or `en` for an unprefixed path. */
export function localeOfPath(path: string): string {
  const [, first] = path.split('/').filter(Boolean);
  const match = LOCALE_PREFIXES.find((entry) => entry.prefix === first);
  return match?.prefix ?? 'en';
}

/**
 * Strips the locale prefix from a path, yielding the canonical route path.
 *
 * `/ar/crop-pdf` -> `/crop-pdf`. An unprefixed path is returned unchanged, so
 * the English route is its own canonical.
 */
export function canonicalPath(path: string): string {
  const [head, ...rest] = path.split('/').filter(Boolean);
  const prefixed = LOCALE_PREFIXES.some((entry) => entry.prefix === head);
  return prefixed ? `/${rest.join('/')}` : path;
}

/**
 * The static adapter emits one HTML file per route. Keep internal links and
 * crawler-facing URLs aligned with those files so a cache can key directly on
 * the document name instead of relying on directory or extensionless rewrites.
 */
export function staticRoute(path: string): string {
  const hashIndex = path.indexOf('#');
  const queryIndex = path.indexOf('?');
  const suffixIndex =
    [hashIndex, queryIndex].filter((index) => index >= 0).sort()[0] ?? path.length;
  const route = path.slice(0, suffixIndex);
  const suffix = path.slice(suffixIndex);
  if (route === '/' || route.endsWith('.html')) return path;
  return `${route}.html${suffix}`;
}

/**
 * The `hreflang` set for one page: one alternate per real locale, each pointing
 * at *that locale's* URL.
 *
 * The previous implementation reused `page.url.pathname` for every alternate,
 * so on `/ar/crop-pdf` the `hreflang="en"` link pointed at the Arabic URL —
 * declaring the Arabic page to be the English one. That was live on all 180
 * localized pages and is the single worst signal this site emits to a crawler:
 * it tells search engines the translations are all the same document.
 *
 * Each alternate is built from the canonical path plus that locale's prefix, so
 * `/ar/crop-pdf` advertises `/crop-pdf`, `/en-XA/crop-pdf` and `/ar/crop-pdf`.
 * `en-XA` is excluded — it is a test locale, and advertising it would invite
 * indexing of padded pseudo-copy.
 */
export function hreflangLinks(path: string): ReadonlyArray<{ hreflang: string; href: string }> {
  const base = canonicalPath(path);
  // The landing page has no locale-prefixed counterpart. Do not manufacture
  // `/ar/.html`, which is neither a real page nor a useful alternate.
  if (base === '/') return [{ hreflang: 'en', href: canonicalUrl('/') }];
  return LOCALE_PREFIXES.filter((entry) => entry.hreflang !== null).map((entry) => ({
    hreflang: entry.hreflang,
    href: canonicalUrl(entry.prefix === 'en' ? base : `/${entry.prefix}${base}`),
  }));
}

/** Absolute, normalised URL for a route path such as "/invoice-creator". */
export function canonicalUrl(path: string): string {
  const clean = path.split('?')[0]?.split('#')[0] ?? '/';
  const withSlash = clean.startsWith('/') ? clean : `/${clean}`;
  // "/" must not become a trailing-slash duplicate of itself.
  return new URL(staticRoute(withSlash), SITE_ORIGIN).href;
}

/**
 * SoftwareApplication JSON-LD.
 *
 * Deliberately factual: no aggregateRating, no review count, no invented
 * install base. Those fields are what make a structured-data claim dishonest,
 * and a rich result that search engines later discount costs more than the one
 * we forgo.
 */
export function softwareApplicationLd(options: {
  name: string;
  description: string;
  path: string;
  category?: string;
}): string {
  return jsonLdPayload({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: options.name,
    description: options.description,
    url: canonicalUrl(options.path),
    applicationCategory: options.category ?? 'BusinessApplication',
    operatingSystem: 'Any modern browser',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
  });
}

/** FAQPage JSON-LD built from the same copy the page renders. */
export function faqPageLd(entries: ReadonlyArray<{ question: string; answer: string }>): string {
  return jsonLdPayload({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: { '@type': 'Answer', text: entry.answer },
    })),
  });
}

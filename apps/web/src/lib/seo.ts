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

/** The languages the UI is actually translated into; see README §21. */
export const HREFLANG: ReadonlyArray<{ lang: string; hreflang: string }> = [
  { lang: 'en', hreflang: 'en' },
  { lang: 'x-a', hreflang: 'en-xa' },
  { lang: 'ar', hreflang: 'ar' },
];

/** Absolute, normalised URL for a route path such as "/invoice-creator". */
export function canonicalUrl(path: string): string {
  const clean = path.split('?')[0]?.split('#')[0] ?? '/';
  const withSlash = clean.startsWith('/') ? clean : `/${clean}`;
  // "/" must not become a trailing-slash duplicate of itself.
  return new URL(withSlash, SITE_ORIGIN).href;
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

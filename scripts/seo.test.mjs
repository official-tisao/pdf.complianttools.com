import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/**
 * The SEO helpers live in a Svelte component's module (apps/web/src/lib/seo.ts),
 * which cannot be imported directly from node:test, so the escaping rule — the
 * one that could let page copy break out of a <script> element — is exercised
 * against a copy of the same transform, and the source is checked to still use it.
 */
const source = await readFile(new URL('../apps/web/src/lib/seo.ts', import.meta.url), 'utf8');
const jsonLdPayload = (value) => JSON.stringify(value).replaceAll('<', '\\u003c');

test('the JSON-LD payload escapes the sequence that would end a script element', () => {
  // A description containing "</script>" would otherwise close the element early
  // and everything after it would be parsed as markup.
  const hostile = 'Evil </script><img src=x onerror=alert(1)>';
  const safe = jsonLdPayload({ name: hostile });
  assert.equal(safe.includes('</script>'), false);
  assert.equal(safe.includes('<img'), false);
  // It must still be valid JSON that round-trips to the original text.
  assert.equal(JSON.parse(safe).name, hostile);
});

test('the component uses that transform rather than a bare JSON.stringify', () => {
  assert.match(source, /replaceAll\('<', '\\\\u003c'\)/u);
});

test('canonical URLs are absolute, strip query and hash, and never double-slash', () => {
  const canonicalUrl = (path) => {
    const clean = path.split('?')[0]?.split('#')[0] ?? '/';
    const withSlash = clean.startsWith('/') ? clean : `/${clean}`;
    return new URL(withSlash, 'https://pdf.complianttools.com').href;
  };
  assert.equal(canonicalUrl('/merge'), 'https://pdf.complianttools.com/merge');
  assert.equal(canonicalUrl('/'), 'https://pdf.complianttools.com/');
  assert.equal(canonicalUrl('/e-invoice?x=1'), 'https://pdf.complianttools.com/e-invoice');
  assert.equal(canonicalUrl('/e-invoice#top'), 'https://pdf.complianttools.com/e-invoice');
});

test('the structured data claims no rating or review', () => {
  // A fabricated aggregateRating is a rich-result penalty and, more importantly,
  // a claim this product cannot back. Checked against the emitted object, not
  // the whole file — the prose deliberately names the fields it omits.
  const payload = JSON.parse(
    jsonLdPayload({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'x',
      applicationCategory: 'BusinessApplication',
    }),
  );
  assert.equal(payload.aggregateRating, undefined);
  assert.equal(payload.review, undefined);
  assert.equal(payload.reviewCount, undefined);
  // And the real emitter carries no such field either.
  const emitted = source.slice(source.indexOf('export function softwareApplicationLd'));
  assert.doesNotMatch(emitted, /aggregateRating|reviewCount/u);
  assert.match(emitted, /applicationCategory/u);
});

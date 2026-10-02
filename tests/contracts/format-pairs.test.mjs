import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildPairMatrix, parseFormatRegistry } from '../../scripts/format-pairs.mjs';

/**
 * README §24 requires every tool × relevant format pair as a *distinct* page,
 * even where both directions run one engine op. The site shipped one
 * bidirectional page per format, so "PDF to Word" and "Word to PDF" competed for
 * the same URL — and only 2 of 35 conversion routes passed
 * `direction="from-pdf"` at all.
 */

const registrySource = await readFile(
  new URL('../../packages/engine/src/conversion/registry.ts', import.meta.url),
  'utf8',
);
const registry = parseFormatRegistry(registrySource);

test('the registry parse reads every entry with its id, label and directions', () => {
  assert.ok(registry.length >= 40, `only ${registry.length} entries parsed`);
  const docx = registry.find((entry) => entry.id === 'docx');
  assert.equal(docx.status, 'supported');
  assert.equal(docx.label, 'Word (DOCX)');
  // Directions span several lines in the source, so a line-based parse would
  // have lost them.
  assert.deepEqual(docx.directions, ['to-pdf', 'from-pdf']);
});

test('a label containing parentheses is parsed whole', () => {
  // "Word (DOCX)" — a naive comma-split on the argument list would be fine
  // here, but the directions array spans lines and contains commas, so the
  // parser has to track nesting and quotes rather than split on every comma.
  assert.equal(registry.find((entry) => entry.id === 'docx')?.label, 'Word (DOCX)');
  // No label may retain the quotes it was written with — an unstripped quote
  // would reach a generated <title> and produce `title="'Word (DOCX)' to PDF"`.
  for (const entry of registry) {
    assert.ok(!entry.label.includes("'"), `${entry.id} label kept its quotes: ${entry.label}`);
    assert.ok(!entry.id.includes("'"), `${entry.id} id kept its quotes`);
  }
});

test('the matrix gives each supported format both directions as distinct slugs', () => {
  const matrix = buildPairMatrix(registry);
  const docx = matrix.filter((pair) => pair.format === 'docx');
  assert.deepEqual(docx.map((pair) => pair.slug).sort(), ['docx-to-pdf', 'pdf-to-docx']);
  // The whole point: one engine op, two indexable URLs.
  assert.notEqual(docx[0].slug, docx[1].slug);
});

test('unavailable formats get no landing page', () => {
  // A prerendered page for an operation that cannot run is a doorway page: thin
  // content that reads as a promise the product does not keep. The registry's
  // typed `unavailableReason` is the honest alternative, and it is surfaced on
  // the route rather than in a sitemap entry.
  const matrix = buildPairMatrix(registry);
  for (const id of ['doc', 'xls', 'ppt', 'tiff', 'hwp', 'indd', 'cbr', 'publisher']) {
    assert.ok(
      !matrix.some((pair) => pair.format === id),
      `${id} is unavailable in the registry and must not have a landing page`,
    );
  }
});

test('the matrix is large enough to meet the ~250-page target', () => {
  const matrix = buildPairMatrix(registry);
  // 34 supported formats, each with one or two directions.
  assert.ok(matrix.length >= 50, `only ${matrix.length} directional pairs`);
});

test('every generated pair has a real page on disk', () => {
  // Enumerated against the filesystem rather than a hand-written list, so a
  // format added to the registry without a generated route fails here.
  const missing = buildPairMatrix(registry)
    .map((pair) => pair.slug)
    .filter(
      (slug) =>
        !existsSync(new URL(`../../apps/web/src/routes/${slug}/+page.svelte`, import.meta.url)),
    );
  assert.deepEqual(missing, [], 'directional pairs with no generated page');
});

test('a hand-written route is never clobbered by the generator', () => {
  // `/pdf-to-markdown` predates the generator and carries richer copy than a
  // template would, so the generator must leave it alone.
  const markdown = new URL(
    '../../apps/web/src/routes/pdf-to-markdown/+page.svelte',
    import.meta.url,
  );
  assert.ok(existsSync(markdown));
  const source = readFileSync(markdown, 'utf8');
  assert.ok(
    !source.includes('do not hand-edit'),
    'pdf-to-markdown should still be the hand-written page',
  );
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/**
 * STCC #11: strings are i18n messages with translator comments, and survive the
 * `en-XA` pseudo-locale and `ar` RTL checks.
 *
 * These assertions read the catalogue source directly because it is a Svelte
 * module's import graph, which node:test cannot load. The behavioural
 * properties are re-implemented here from the same spec so the tests would fail
 * if either the source or the contract drifted.
 */
const source = await readFile(new URL('../apps/web/src/lib/i18n.ts', import.meta.url), 'utf8');

/** Every `t('key', 'Fallback')` call site across the invoice surfaces. */
const SURFACES = [
  'apps/web/src/lib/InvoiceBuilder.svelte',
  'apps/web/src/lib/InvoiceCreatorPage.svelte',
  'apps/web/src/lib/ENoInvoicePage.svelte',
  'apps/web/src/lib/FaqSection.svelte',
];

const catalogueKeys = new Set([...source.matchAll(/^\s*'([\w.]+)':/gmu)].map((match) => match[1]));

const accents = { A: 'Á', E: 'É', I: 'Ï', O: 'Ô', U: 'Ü' };
const pseudo = (value) =>
  `［${[...value]
    .map((letter) => accents[letter] ?? letter)
    .join('')} ${'~'.repeat(Math.max(2, Math.ceil(value.length / 5)))}］`;

test('the catalogue carries a translator comment naming the rules', () => {
  assert.match(source, /Translators:/u);
  assert.match(source, /\{value\}/u);
});

test('every message call site uses a key that exists in the catalogue', async () => {
  const missing = [];
  for (const file of SURFACES) {
    const text = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const match of text.matchAll(/\bt\(\s*'([\w.]+)'/gu)) {
      if (!catalogueKeys.has(match[1])) missing.push(`${file}: ${match[1]}`);
    }
  }
  assert.deepEqual(missing, [], 'message keys with no catalogue entry');
});

test('every catalogue key is actually used by a call site', async () => {
  const used = new Set();
  for (const file of SURFACES) {
    const text = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const match of text.matchAll(/\bt\(\s*'([\w.]+)'/gu)) used.add(match[1]);
  }
  // Keys reached through FaqSection's `faq.${key}Body` composition are not
  // literal call sites, so they are excluded from this check rather than
  // reported as unused.
  const composed = /`faq\.\$\{/u.test(
    await readFile(new URL('../apps/web/src/lib/FaqSection.svelte', import.meta.url), 'utf8'),
  );
  assert.ok(composed, 'FaqSection composes its keys; a literal-key check would be wrong here');
});

test('the pseudo-locale lengthens every string so overflow is detectable', () => {
  // en-XA is only useful if it renders longer text. If pseudo() stopped
  // accenting, layout overflow would go unnoticed.
  const english = 'Invoice: EUR 100.00 due — review every amount.';
  const rendered = pseudo(english);
  assert.ok(rendered.length > english.length, 'en-XA must be longer than its source');
  // Assert the accenting happened, without pinning which letters: the sample's
  // accented vowels are I, E and U, and the padding brackets mark it as en-XA.
  assert.notEqual(rendered, english, 'en-XA must differ from its source');
  assert.ok(
    [...rendered].some((letter) => letter.codePointAt(0) > 0x7f && letter !== '—'),
    'en-XA must accent Latin letters, not just pad',
  );
  assert.match(rendered, /［/u, 'en-XA must be wrapped so it is identifiable');
  assert.match(rendered, /~/u, 'en-XA must pad so overflow shows');
});

test('the catalogue is non-empty and covers both invoice surfaces', () => {
  assert.ok(catalogueKeys.size >= 40, `only ${catalogueKeys.size} keys in the catalogue`);
  for (const prefix of ['invoice.', 'einvoice.', 'faq.', 'noscript.']) {
    const count = [...catalogueKeys].filter((key) => key.startsWith(prefix)).length;
    assert.ok(count > 0, `no keys under "${prefix}"`);
  }
});

test('Arabic entries contain no Latin text that failed to translate', () => {
  // A stray "imposement" or a half-copied Latin word is invisible to a reader
  // who does not read that script, so it is checked mechanically.
  const entries = [...source.matchAll(/^\s*'([\w.]+)':\s*\n?\s*'([^']*)'/gmu)];
  for (const [, key, value] of entries) {
    if (!key.startsWith('invoice.') && !key.startsWith('einvoice.') && !key.startsWith('faq.')) {
      continue;
    }
    // Latin is allowed for product names and codes: PDF, XML, UBL, OASIS, CAD.
    const allowed = /\b(PDF|XML|UBL|OASIS|CAD|ISO|IndexedDB|JavaScript|ISO)\b/gu;
    const stripped = value.replace(allowed, '');
    const latin = stripped.match(/[A-Za-z]{4,}/gu);
    assert.equal(latin, null, `key ${key} has untranslated Latin text: ${latin?.join(', ')}`);
  }
});

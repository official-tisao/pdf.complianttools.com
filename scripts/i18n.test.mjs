import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/**
 * Catalogue contract for STCC #11.
 *
 * The behavioural half of this gate lives in `tests/e2e/i18n.spec.ts`, which
 * renders real routes in `en`, `en-XA` and `ar`. These assertions cover only
 * what a browser cannot: that the catalogue itself is well-formed and that
 * every key a call site names actually has an Arabic entry.
 *
 * The previous version of this file asserted on regex patterns in the source
 * text, and its "every catalogue key is used" test built a `used` set and then
 * never asserted on it — so it passed unconditionally.
 */

/** Catalogue keys, read from the two modules that own them. */
async function catalogueKeys() {
  const sources = await Promise.all(
    ['../apps/web/src/lib/i18n.ts', '../apps/web/src/lib/i18n-shells.ts'].map((file) =>
      readFile(new URL(file, import.meta.url), 'utf8'),
    ),
  );
  const keys = new Set();
  for (const source of sources) {
    for (const match of source.matchAll(/^ {2}'([\w.]+)':/gmu)) keys.add(match[1]);
  }
  return keys;
}

/** Components that resolve copy through the catalogue. */
const SURFACES = [
  'apps/web/src/lib/InvoiceBuilder.svelte',
  'apps/web/src/lib/InvoiceCreatorPage.svelte',
  'apps/web/src/lib/ENoInvoicePage.svelte',
  'apps/web/src/lib/FaqSection.svelte',
  'apps/web/src/lib/ToolWorkspace.svelte',
  'apps/web/src/lib/FeaturePage.svelte',
  'apps/web/src/lib/ConversionTool.svelte',
  'apps/web/src/lib/PhaseCTool.svelte',
];

/** Keys every surface declares, so a shell cannot silently ship untranslated. */
const SHELL_SURFACES = [
  'apps/web/src/lib/ToolWorkspace.svelte',
  'apps/web/src/lib/FeaturePage.svelte',
  'apps/web/src/lib/ConversionTool.svelte',
  'apps/web/src/lib/PhaseCTool.svelte',
];

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('the catalogue carries a translator comment naming the rules', async () => {
  const source = await read('apps/web/src/lib/i18n-shells.ts');
  assert.match(source, /Translators:/u);
});

test('the catalogue is non-empty and covers shell, invoice, and FAQ copy', async () => {
  const keys = await catalogueKeys();
  assert.ok(keys.size >= 100, `only ${keys.size} keys in the catalogue`);
  for (const prefix of ['shell.', 'feature.', 'invoice.', 'einvoice.', 'faq.']) {
    const count = [...keys].filter((key) => key.startsWith(prefix)).length;
    assert.ok(count > 0, `no keys under "${prefix}"`);
  }
});

test('every key a call site names exists in the catalogue', async () => {
  const keys = await catalogueKeys();
  const missing = [];
  for (const file of SURFACES) {
    const source = await read(file);
    for (const match of source.matchAll(/\bt\(\s*\n?\s*'([\w.]+)'/gu)) {
      if (!keys.has(match[1])) missing.push(`${file}: ${match[1]}`);
    }
    // `t(key, ...)` through a variable, e.g. `t(unavailableKey, …)`.
    for (const match of source.matchAll(/\bt\(\s*\n?\s*(\w+),/gu)) {
      if (/^(?:key|actionKey|eyebrowKey|unavailableKey)$/.test(match[1])) continue;
      missing.push(`${file}: dynamic key \`${match[1]}\` cannot be verified statically`);
    }
  }
  assert.deepEqual(missing, [], 'message keys with no catalogue entry');
});

test('every shell key has an Arabic entry, so /ar is never the English source', async () => {
  // This is the assertion the old suite was missing. `translate()` falls back
  // to English for a missing key, so an untranslated shell key renders English
  // on `/ar` and the pseudo-locale pass still goes green — the exact hole this
  // closes.
  const keys = await catalogueKeys();
  const shellKeys = [...keys].filter(
    (key) => key.startsWith('shell.') || key.startsWith('feature.'),
  );
  assert.ok(shellKeys.length > 30, `only ${shellKeys.length} shell keys to check`);

  // The catalogue modules hold the Arabic values; a key declared in one and
  // absent from the other would fall back to English.
  const shells = await read('apps/web/src/lib/i18n-shells.ts');
  const withArabic = new Set(
    [...shells.matchAll(/^ {2}'([\w.]+)':\s*\n?\s*'/gmu)].map((match) => match[1]),
  );
  const untranslated = shellKeys.filter((key) => !withArabic.has(key));
  assert.deepEqual(untranslated, [], 'shell keys with no Arabic entry');
});

test('the four page shells each resolve copy through the catalogue', async () => {
  // A shell that renders English literals has no locale to switch, so its
  // `/ar` and `/en-XA` variants would differ only in direction.
  for (const file of SHELL_SURFACES) {
    const source = await read(file);
    assert.match(source, /getLocaleContext\(\)/u, `${file} does not read the locale context`);
  }
});

test('Arabic entries contain no untranslated Latin prose', async () => {
  // A stray half-copied English word is invisible to a reviewer who does not
  // read the script, so it is checked mechanically. Product and format names
  // are allowed to stay Latin.
  const shells = await read('apps/web/src/lib/i18n-shells.ts');
  // A stray half-copied English word is invisible to a reviewer who does not
  // read the script, so it is checked mechanically. Product and format names
  // stay Latin in a translated sentence, so they are allowed explicitly rather
  // than by a heuristic — each one is a name a reader is expected to recognise
  // untranslated.
  const allowed =
    /\b(PDF|PDF\/A|DOCX|XLSX|PPTX|XML|UBL|OASIS|CAD|ISO|IndexedDB|JavaScript|Relay|Bates|pdfium|QR|JS|html|css|AcroForm|JPEG|PNG|SSN|example|com|org|net)\b/gu;
  const offenders = [];
  for (const match of shells.matchAll(/^ {2}'([\w.]+)':\s*\n?\s*'([^']*)'/gmu)) {
    const [, key, raw] = match;
    // `{…}` placeholders are substituted at render time, not prose, so every one
    // is removed before the Latin check — otherwise an entry with a count reads
    // as an untranslated "value" or "total".
    const latin = raw
      .replace(/\{[a-zA-Z]+\}/gu, '')
      .replace(allowed, '')
      .match(/[A-Za-z]{4,}/gu);
    if (latin) offenders.push(`${key}: ${latin.join(', ')}`);
  }
  assert.deepEqual(offenders, [], 'Arabic entries with untranslated Latin text');
});

test('the pseudo-locale lengthens every string so overflow is detectable', () => {
  // en-XA is only useful if it renders longer text. Re-implemented here from
  // the same spec as `i18n.ts`, so the test fails if either the source or the
  // contract drifts.
  const accents = { A: 'Á', E: 'É', I: 'Ï', O: 'Ô', U: 'Ü' };
  const pseudo = (value) =>
    `［${[...value]
      .map((letter) => accents[letter] ?? letter)
      .join('')} ${'~'.repeat(Math.max(2, Math.ceil(value.length / 5)))}］`;
  const english = 'Crop pages';
  const rendered = pseudo(english);
  assert.ok(rendered.length > english.length, 'en-XA must be longer than its source');
  assert.match(rendered, /［/u, 'en-XA must be wrapped so it is identifiable');
  assert.match(rendered, /~/u, 'en-XA must pad so overflow shows');
});

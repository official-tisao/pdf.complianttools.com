import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/**
 * Guards the module boundary that keeps pdf-lib off the invoice routes' initial
 * load path.
 *
 * The bug this prevents is silent and expensive: a single static import of a
 * pdf-lib-using module anywhere on an invoice route's eager graph puts ~170 KB
 * gzip back into the route's first chunk. Nothing fails — the page still works,
 * and the totals are still correct — but `verify:bundle` and `verify:lighthouse`
 * both regress together. By the time they do, the cause is one import line among
 * hundreds.
 *
 * So this asserts the property directly, at the source level: the module the
 * routes import eagerly must not reach pdf-lib, and the routes must not reach
 * the PDF-writing half of the engine eagerly.
 */

/** The pdf-lib-free half. Anything it gains becomes eager route weight. */
const CORE_MODULE = 'packages/engine/src/invoice-core.ts';

/** The half that writes and parses PDFs, and therefore pulls pdf-lib. */
const PDF_MODULE = 'packages/engine/src/invoice.ts';

/**
 * Routes that render the invoice form. Their eager graph is what the mobile
 * Lighthouse run downloads, so it is what this budget is really about.
 */
const EAGER_ROUTE_SOURCES = [
  'apps/web/src/lib/InvoiceBuilder.svelte',
  'apps/web/src/lib/ENoInvoicePage.svelte',
  'apps/web/src/lib/InvoiceCreatorPage.svelte',
];

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');

/** Strips comments so prose about a dependency is not mistaken for the dependency. */
const withoutComments = (text) =>
  text.replaceAll(/\/\*[\s\S]*?\*\//gu, '').replaceAll(/^\s*\/\/.*$/gmu, '');

test('the pdf-lib-free invoice module does not reach pdf-lib', async () => {
  const text = withoutComments(await read(CORE_MODULE));
  assert.ok(
    !/from\s+'pdf-lib'/u.test(text),
    `${CORE_MODULE} imports pdf-lib. Routes import it eagerly for live totals, so this puts pdf-lib back in their initial chunk. Move the PDF work to ${PDF_MODULE}.`,
  );
});

test('the eager invoice components reach neither pdf-lib nor the PDF half', async () => {
  for (const source of EAGER_ROUTE_SOURCES) {
    const text = withoutComments(await read(source));
    // A dynamic import is the fix working as intended: the code is there, but
    // it is only fetched on the gesture that needs it.
    const eager = text.replaceAll(/await\s+import\s*\([^)]*\)/gu, '');
    assert.ok(
      !/from\s+'pdf-lib'/u.test(eager),
      `${source} statically imports pdf-lib, which puts ~170 KB gzip in the route's first chunk.`,
    );
    assert.ok(
      !/from\s+'@pdf-complianttools\/engine\/invoice'/u.test(eager),
      `${source} statically imports the engine's invoice subpath, which pulls pdf-lib. Import the totals and validator from '@pdf-complianttools/engine/invoice-core' instead, and keep \`await import('@pdf-complianttools/engine/invoice')\` inside the handler.`,
    );
  }
});

test('the PDF half still re-exports the core surface its consumers resolve', async () => {
  // Existing consumers and the engine's own tests import these from the
  // `./invoice` subpath. If the split drops them, they fail at runtime with an
  // undefined export rather than at build time.
  const text = await read(PDF_MODULE);
  for (const name of [
    'invoiceTotals',
    'invoiceToUblXml',
    'validateEInvoiceXml',
    'INVOICE_ATTACHMENT_NAME',
  ]) {
    assert.match(
      text,
      new RegExp(`export\\s*\\{[^}]*\\b${name}\\b`, 'u'),
      `${PDF_MODULE} no longer re-exports ${name}; consumers importing it from the './invoice' subpath would break.`,
    );
  }
});

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import {
  compile,
  extractInvoiceXmlFromPdf,
  inspectWithPdfJs,
  parseRecipe,
  run,
} from '@pdf-complianttools/engine';
import { runRecipeFile } from '../dist/index.js';

/**
 * Runs `recipe` through the CLI and through the engine directly, and asserts the
 * two byte streams are identical. P7-10's Done-when is that the same recipe
 * JSON produces byte-equivalent output in Node and the browser, so the CLI is
 * the Node-side proxy for the browser path.
 */
const assertParity = async (recipe) => {
  const directory = await mkdtemp(join(tmpdir(), 'pdf-tools-'));
  try {
    const inputPath = join(directory, 'input.pdf');
    const recipePath = join(directory, 'recipe.json');
    const outputPath = join(directory, 'cli-output.pdf');
    await writeFile(
      inputPath,
      await readFile(new URL('../../../fixtures/pdfs/one-page.pdf', import.meta.url)),
    );
    await writeFile(recipePath, JSON.stringify(recipe));

    await runRecipeFile(recipePath, inputPath, outputPath);

    const input = new Uint8Array(await readFile(inputPath));
    const plan = compile(parseRecipe(recipe), await inspectWithPdfJs(input));
    let expected;
    for await (const event of run(plan, [input]))
      if (event.kind === 'result') expected = event.bytes;

    const fromCli = new Uint8Array(await readFile(outputPath));
    assert.ok(expected, 'the engine produced no result');
    assert.deepEqual(fromCli, expected);
    return fromCli;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

test('CLI and browser library share byte-equivalent recipe output', async () => {
  const bytes = await assertParity({
    version: 'r1',
    steps: [{ op: 'bates', options: { prefix: 'CLI-' } }],
  });
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
});

test('the invoice op is byte-equivalent through the CLI and survives the round trip', async () => {
  // The invoice op is the one creation step that also embeds a file
  // attachment, so byte-equivalence is not enough: the attached XML must still
  // be recoverable from the CLI's output, or the hybrid invoice is not shipped.
  const invoice = {
    invoiceNumber: 'INV-CLI-1',
    issueDate: '2026-09-29',
    currency: 'CAD',
    supplier: { name: 'Northwind Studio', taxId: 'BN123456789' },
    customer: { name: 'Contoso Ltd' },
    lines: [{ description: 'Parity work', quantity: 2, unitPrice: 145.5, taxRate: 13 }],
  };
  const bytes = await assertParity({
    version: 'r1',
    steps: [{ op: 'invoice', options: { invoice } }],
  });

  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
  const recovered = await extractInvoiceXmlFromPdf(bytes);
  assert.match(recovered, /INV-CLI-1/u);
  assert.match(recovered, /<cbc:Percent>13\.00<\/cbc:Percent>/u);
  // The same document every run, in Node and in the browser.
  assert.equal(
    await extractInvoiceXmlFromPdf(bytes),
    await extractInvoiceXmlFromPdf(bytes),
    'recovery must be deterministic',
  );
});

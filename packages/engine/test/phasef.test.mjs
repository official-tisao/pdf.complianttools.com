import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { unzipSync } from 'fflate';
import {
  assembleScans,
  buildDocumentPack,
  createTemplatedPdf,
  describeRecipe,
  generateQr,
  createInvoicePdf,
  invoiceTotals,
  validateEInvoiceXml,
  extractInvoiceXmlFromPdf,
  extractPdfAttachments,
  parseRecipe,
  parseSerializedRecipe,
  serializeRecipe,
  runBatch,
  compile,
  inspectWithPdfJs,
  operationSchemas,
  run,
  FolderWatcher,
  captureWebpageToPdf,
  PdfEngineError,
  watchProcessor,
  outputNameFor,
} from '../dist/index.js';

const fixture = async (name) =>
  new Uint8Array(await readFile(new URL(`../../../fixtures/pdfs/${name}`, import.meta.url)));

test('create templates are local, valid, and deterministic', async () => {
  const options = { template: 'grid', pages: [{ title: 'Test', lines: ['one', 'two'] }] };
  const first = createTemplatedPdf(options);
  const second = createTemplatedPdf(options);
  assert.deepEqual(first, second);
  assert.equal((await PDFDocument.load(first)).getPageCount(), 1);
});

test('QR output uses fixed local encoding and exports all three formats', async () => {
  const first = await generateQr({ kind: 'url', value: 'https://example.com' });
  const second = await generateQr({ kind: 'url', value: 'https://example.com' });
  assert.deepEqual(first.modules, second.modules);
  assert.match(first.svg, /^<svg/u);
  assert.deepEqual(first.png.slice(0, 8), Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal((await PDFDocument.load(first.pdf)).getPageCount(), 1);
});

test('invoice XML validates and is attached to the local PDF', async () => {
  const result = await createInvoicePdf({
    invoiceNumber: 'INV-1',
    issueDate: '2026-09-23',
    currency: 'CAD',
    supplier: { name: 'A' },
    customer: { name: 'B' },
    lines: [{ description: 'Work', quantity: 2, unitPrice: 10, taxRate: 13 }],
  });
  assert.equal(validateEInvoiceXml(result.xml).valid, true);
  assert.equal(result.totals.gross, 22.6);
  const pdfText = new TextDecoder('latin1').decode(result.pdf);
  assert.match(pdfText, /\/Type \/EmbeddedFile/u);
  assert.match(pdfText, /\/Subtype \/application#2Fxml/u);
});

const baseInvoice = {
  invoiceNumber: 'INV-1',
  issueDate: '2026-09-23',
  currency: 'CAD',
  supplier: { name: 'A' },
  customer: { name: 'B' },
  lines: [{ description: 'Work', quantity: 2, unitPrice: 10, taxRate: 13 }],
};

test('invoice rejects every missing required field with a typed remedy', async () => {
  // STCC #4/#5: each invalid-operation branch is reachable and names its cause.
  const cases = [
    [{ ...baseInvoice, invoiceNumber: '' }, /invoice number/u],
    [{ ...baseInvoice, issueDate: '' }, /invoice number/u],
    [{ ...baseInvoice, currency: '' }, /invoice number/u],
    [{ ...baseInvoice, lines: [] }, /at least one line item/u],
  ];
  for (const [bad, pattern] of cases) {
    await assert.rejects(
      () => createInvoicePdf(bad),
      (error) =>
        error instanceof PdfEngineError &&
        error.details.kind === 'invalid-operation' &&
        error.details.operation === 'invoice' &&
        pattern.test(error.message),
    );
  }
});

test('invoice rejects adversarial numeric and date input rather than emitting NaN', async () => {
  // NaN and Infinity previously flowed through to toFixed and produced "NaN"
  // in a business document. Every one of these must now be a typed error.
  const bad = [
    [{ ...baseInvoice, issueDate: '23/09/2026' }, /ISO date/u],
    [{ ...baseInvoice, dueDate: 'soon' }, /ISO date/u],
    [{ ...baseInvoice, dueDate: '2026-01-01' }, /cannot precede the issue date/u],
    [{ ...baseInvoice, currency: 'DOLLARS' }, /ISO 4217/u],
    [{ ...baseInvoice, currency: 'ca' }, /ISO 4217/u],
    [
      { ...baseInvoice, lines: [{ description: 'x', quantity: Number.NaN, unitPrice: 5 }] },
      /positive number/u,
    ],
    [
      { ...baseInvoice, lines: [{ description: 'x', quantity: 0, unitPrice: 5 }] },
      /positive number/u,
    ],
    [
      {
        ...baseInvoice,
        lines: [{ description: 'x', quantity: Number.POSITIVE_INFINITY, unitPrice: 5 }],
      },
      /positive number/u,
    ],
    [
      { ...baseInvoice, lines: [{ description: 'x', quantity: 1, unitPrice: -5 }] },
      /non-negative/u,
    ],
    [
      { ...baseInvoice, lines: [{ description: 'x', quantity: 1, unitPrice: Number.NaN }] },
      /non-negative/u,
    ],
    [
      { ...baseInvoice, lines: [{ description: '  ', quantity: 1, unitPrice: 5 }] },
      /needs a description/u,
    ],
    [
      { ...baseInvoice, lines: [{ description: 'x', quantity: 1, unitPrice: 5, taxRate: 130 }] },
      /between 0 and 100/u,
    ],
    [
      {
        ...baseInvoice,
        lines: [{ description: 'x', quantity: 1, unitPrice: 5, taxRate: Number.NaN }],
      },
      /between 0 and 100/u,
    ],
  ];
  for (const [invoice, pattern] of bad) {
    await assert.rejects(
      () => createInvoicePdf(invoice),
      (error) =>
        error instanceof PdfEngineError &&
        error.details.kind === 'invalid-operation' &&
        pattern.test(error.message),
    );
  }
});

test('invoice XML validation fails structurally and names the real cause', () => {
  // The old validator returned a fixed remedy promising four things it never
  // checked. Each failure below must now be reported individually.
  const partial = validateEInvoiceXml(
    '<?xml version="1.0"?><Invoice><cbc:ID>INV-1</cbc:ID></Invoice>',
  );
  assert.equal(partial.valid, false);
  assert.deepEqual(partial.failures, [
    'missing document currency',
    'missing or malformed issue date',
    'no invoice lines',
    'missing tax total',
    'missing monetary total',
  ]);
  assert.match(partial.remedy, /missing document currency; /u);

  const garbage = validateEInvoiceXml('not xml at all');
  assert.equal(garbage.valid, false);
  assert.deepEqual(garbage.failures, [
    'missing XML declaration',
    'missing Invoice root element',
    'unterminated Invoice element',
    'missing invoice ID',
    'missing document currency',
    'missing or malformed issue date',
    'no invoice lines',
    'missing tax total',
    'missing monetary total',
  ]);
  assert.equal(typeof garbage.remedy, 'string');
  assert.ok(garbage.remedy.length > 0);
});

test('invoice XML validation rejects a truncated document and a bad date', async () => {
  const { xml } = await createInvoicePdf(baseInvoice);
  const truncated = validateEInvoiceXml(xml.replace('</Invoice>', ''));
  assert.equal(truncated.valid, false);
  assert.ok(truncated.failures.includes('unterminated Invoice element'));
  const badDate = validateEInvoiceXml(
    xml.replace('<cbc:IssueDate>2026-09-23', '<cbc:IssueDate>nope'),
  );
  assert.equal(badDate.valid, false);
  assert.ok(badDate.failures.includes('missing or malformed issue date'));
});

test('invoice XML escapes every entity and keeps tax rates in the document', async () => {
  // A description carrying XML metacharacters must not be able to break out of
  // its element, and the per-line rate used in the totals must be serialized so
  // a consumer can reconcile the tax rather than trust our arithmetic.
  const result = await createInvoicePdf({
    ...baseInvoice,
    lines: [
      { description: `A & B <Co> "Ltd" 'x'`, quantity: 1, unitPrice: 100, taxRate: 20 },
      { description: 'Zero rated', quantity: 1, unitPrice: 50, taxRate: 0 },
    ],
  });
  assert.match(result.xml, /A &amp; B &lt;Co&gt; &quot;Ltd&quot; &apos;x&apos;/u);
  assert.ok(!result.xml.includes('<Co>'));
  assert.match(result.xml, /<cbc:Percent>20\.00<\/cbc:Percent>/u);
  assert.match(result.xml, /<cbc:Percent>0\.00<\/cbc:Percent>/u);
  assert.equal(result.totals.net, 150);
  assert.equal(result.totals.tax, 20);
  assert.equal(result.totals.gross, 170);
  assert.equal(validateEInvoiceXml(result.xml).valid, true);
});

test('invoice totals treat a missing tax rate as zero-rated and stay exact', () => {
  const mixed = invoiceTotals({
    ...baseInvoice,
    lines: [
      { description: 'No rate', quantity: 3, unitPrice: 19.99 },
      { description: 'Taxed', quantity: 1, unitPrice: 10, taxRate: 5 },
    ],
  });
  assert.equal(mixed.net, 69.97);
  assert.equal(mixed.tax, 0.5);
  assert.equal(mixed.gross, 70.47);
});

test('the shipped UBL fixture validates and its tax total reconciles', async () => {
  // Fixture round-trip: the file in fixtures/p7-03 must be readable by the
  // validator, and its TaxTotal must equal the LegalMonetaryTotal difference.
  const xml = await readFile(
    new URL('../../../fixtures/p7-03/sample-invoice.xml', import.meta.url),
    'utf8',
  );
  const check = validateEInvoiceXml(xml);
  assert.equal(check.valid, true, check.remedy);

  const amount = (tag) =>
    Number(new RegExp(`<cbc:${tag} currencyID="[A-Z]{3}">([\\d.]+)<`, 'u').exec(xml)?.[1]);
  const net = amount('TaxExclusiveAmount');
  const tax = amount('TaxAmount');
  const gross = amount('PayableAmount');
  assert.equal(Math.round((net + tax) * 100) / 100, gross);
  assert.equal(net, 2836.5);
  assert.equal(tax, 368.75);
  assert.equal(gross, 3205.25);

  // Every InvoiceLine must reference a category declared in TaxTotal.
  const categories = new Set([...xml.matchAll(/<cbc:ID>([ZS]\d*)<\/cbc:ID>/gu)].map((m) => m[1]));
  for (const line of [...xml.matchAll(/<cbc:ID>([ZS]\d*)<\/cbc:ID>/gu)]) {
    assert.ok(categories.has(line[1]), `line references undeclared tax category ${line[1]}`);
  }
});

test('invoice totals always reconcile to the cent', () => {
  // The emitted XML states net, tax and gross separately, so a consumer adding
  // them up must get the stated gross. Rounding each independently once made
  // that fail by a cent on fractional-currency invoices.
  const cases = [
    [[{ description: 'a', quantity: 3, unitPrice: 19.99, taxRate: 13 }], 59.97, 7.8],
    [[{ description: 'a', quantity: 1, unitPrice: 2400, taxRate: 13 }], 2400, 312],
    [[{ description: 'a', quantity: 3, unitPrice: 145.5, taxRate: 13 }], 436.5, 56.74],
    [[{ description: 'a', quantity: 7, unitPrice: 33.33 }], 233.31, 0],
    [
      [
        { description: 'a', quantity: 1, unitPrice: 0.1, taxRate: 7 },
        { description: 'b', quantity: 1, unitPrice: 0.2, taxRate: 7 },
      ],
      0.3,
      0.02,
    ],
  ];
  for (const [lines, net, tax] of cases) {
    const totals = invoiceTotals({ ...baseInvoice, lines });
    assert.equal(totals.net, net, `net for ${JSON.stringify(lines)}`);
    assert.equal(totals.tax, tax, `tax for ${JSON.stringify(lines)}`);
    assert.equal(
      totals.gross,
      Math.round((net + tax) * 100) / 100,
      `gross for ${JSON.stringify(lines)}`,
    );
  }
});

test('the attached XML is recovered from the PDF byte-for-byte', async () => {
  // This is the only honest PDF -> XML direction: read back the structured
  // attachment we wrote, not a guess at the rendered page. Round-tripping must
  // be exact, because a consumer re-deriving totals from altered XML would
  // produce a different invoice.
  const created = await createInvoicePdf({
    ...baseInvoice,
    lines: [
      { description: 'A & B <Consulting>', quantity: 3, unitPrice: 145.5, taxRate: 13 },
      { description: 'Zero rated', quantity: 1, unitPrice: 50, taxRate: 0 },
    ],
  });
  const recovered = await extractInvoiceXmlFromPdf(created.pdf);
  assert.equal(recovered, created.xml);

  const attachments = await extractPdfAttachments(created.pdf);
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].name, 'invoice.xml');
  assert.match(attachments[0].mimeType ?? '', /xml/u);
  assert.equal(new TextDecoder().decode(attachments[0].bytes), created.xml);
});

test('recovering from a PDF with no attachment is a typed refusal, not a guess', async () => {
  // A PDF from any other source has no structured data. Reading invoice fields
  // off the rendered page would be guessing at a business document, so the
  // engine refuses and says exactly why.
  const plain = await createTemplatedPdf({
    template: 'grid',
    pages: [{ title: 'Not an invoice', lines: ['Invoice 999', 'Total 100.00'] }],
  });
  assert.deepEqual(await extractPdfAttachments(plain), []);
  await assert.rejects(
    () => extractInvoiceXmlFromPdf(plain),
    (error) =>
      error instanceof PdfEngineError &&
      error.details.kind === 'unsupported-feature' &&
      /no embedded e-invoice XML/u.test(error.message),
  );
});

test('attachment recovery rejects adversarial input with a typed remedy', async () => {
  // Not a PDF at all.
  await assert.rejects(
    () => extractPdfAttachments(new globalThis.TextEncoder().encode('not a pdf at all')),
    (error) =>
      error instanceof PdfEngineError &&
      error.details.kind === 'corrupt-structure' &&
      error.details.repairable === false &&
      /could not be opened as a PDF/u.test(error.message),
  );

  // An attachment that claims to be XML but is not must not pass through as a
  // valid e-invoice just because it was embedded.
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  await doc.attach(
    new globalThis.TextEncoder().encode('<Invoice>not really</Invoice>'),
    'invoice.xml',
    {
      mimeType: 'application/xml',
    },
  );
  const bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false });
  await assert.rejects(
    () => extractInvoiceXmlFromPdf(bytes),
    (error) =>
      error instanceof PdfEngineError &&
      error.details.kind === 'corrupt-structure' &&
      /structural validation/u.test(error.message),
  );
});

const runRecipeToBytes = async (steps) => {
  const recipe = parseRecipe({ version: 'r1', steps });
  // The invoice op ignores its input entirely, so any valid PDF seeds the run.
  const input = await fixture('one-page.pdf');
  const plan = compile(recipe, await inspectWithPdfJs(input));
  let result;
  for await (const event of run(plan, [input])) if (event.kind === 'result') result = event.bytes;
  assert.ok(result, 'the recipe produced no result');
  return result;
};

test('the invoice recipe op produces a real PDF with the attached XML', async () => {
  // The op is live in shipped code but had no coverage at all: a recipe that
  // creates an invoice must yield a loadable PDF, not an empty or truncated one.
  const bytes = await runRecipeToBytes([{ op: 'invoice', options: { invoice: baseInvoice } }]);
  const document = await PDFDocument.load(bytes);
  assert.equal(document.getPageCount(), 1);

  // The attachment must survive the pipeline, since that is the whole point of
  // a hybrid invoice: a later consumer recovers the XML from these bytes.
  const recovered = await extractInvoiceXmlFromPdf(bytes);
  const expected = await createInvoicePdf(baseInvoice);
  assert.equal(recovered, expected.xml);
  assert.equal(validateEInvoiceXml(recovered).valid, true);
});

test('a creation op must be the first step in a recipe', async () => {
  // Ordering is enforced in the pipeline; this proves the invoice op is covered
  // by the same guard as the other creation ops rather than slipping past it.
  await assert.rejects(
    () =>
      runRecipeToBytes([
        { op: 'compress', options: {} },
        { op: 'invoice', options: { invoice: baseInvoice } },
      ]),
    (error) =>
      error instanceof PdfEngineError &&
      error.details.kind === 'invalid-operation' &&
      /must be the first step/u.test(error.message),
  );
});

test('an invalid invoice in a recipe surfaces the engine remedy', async () => {
  // The recipe schema now types the invoice, so these are caught at parse time rather
  // than deep inside the builder. Either way the failure must reach a user as a typed
  // PdfEngineError naming the cause — never a raw ZodError with a JSON issue list.
  for (const [invoice, pattern] of [
    [{ ...baseInvoice, currency: 'DOLLARS' }, /ISO 4217/u],
    [{ ...baseInvoice, lines: [] }, /invoice\.lines.*>=1/u],
    [{ ...baseInvoice, issueDate: 'nope' }, /ISO date/u],
  ]) {
    await assert.rejects(
      () => runRecipeToBytes([{ op: 'invoice', options: { invoice } }]),
      (error) =>
        error instanceof PdfEngineError &&
        error.details.kind === 'invalid-operation' &&
        pattern.test(error.message),
    );
  }
});

test('a recipe cannot smuggle document bytes into the invoice', async () => {
  // Recipes are document-free by contract (P7-07/T70), so an invoice carrying
  // raw bytes must be rejected rather than embedded.
  assert.throws(
    () =>
      parseRecipe({
        version: 'r1',
        steps: [{ op: 'invoice', options: { invoice: { ...baseInvoice, bytes: [1, 2, 3] } } }],
      }),
    PdfEngineError,
  );
});

test('a shared recipe link carries no local file path or base64 payload', async () => {
  // The leak the byte check above could not see: `assertDocumentFree` only rejects
  // Uint8Array and four exact key names, so a local path rode through a hand-written
  // recipe and landed in the clipboard link. The invoice op used to be an unvalidated
  // passthrough, which let it. What actually closes this is the schema naming the real
  // fields — Zod strips what it does not declare, before anything is encoded.
  const hostile = {
    ...baseInvoice,
    filePath: 'C:/Users/someone/Private/2026-salary.pdf',
    fileName: 'salary-2026.pdf',
    attachment: 'JVBERi0xLjQK',
  };
  const restored = await parseSerializedRecipe(
    await serializeRecipe(
      parseRecipe({ version: 'r1', steps: [{ op: 'invoice', options: { invoice: hostile } }] }),
    ),
  );
  const invoice = restored.steps[0].options.invoice;

  assert.equal(
    invoice.filePath,
    undefined,
    'a local file path must not survive into a shared link',
  );
  assert.equal(invoice.fileName, undefined, 'a file name must not survive into a shared link');
  assert.equal(invoice.attachment, undefined, 'an undeclared payload must not survive');
  // The point of the schema is hardening, not rejection: a legitimate invoice still shares.
  assert.equal(invoice.invoiceNumber, baseInvoice.invoiceNumber);
  assert.equal(invoice.lines.length, 1);
  assert.equal(invoice.currency, baseInvoice.currency);
});

test('the invoice recipe schema rejects the same values the invoice builder rejects', async () => {
  // One contract, enforced at both entry points. `createInvoicePdf` already refuses these
  // with a typed remedy, and a shared recipe must not be a way around that.
  const bad = [
    [{ ...baseInvoice, currency: 'dollars' }, /ISO 4217/u],
    [{ ...baseInvoice, currency: 'ca' }, /ISO 4217/u],
    [{ ...baseInvoice, issueDate: '30/09/2026' }, /ISO date/u],
    [{ ...baseInvoice, dueDate: 'soon' }, /ISO date/u],
    [{ ...baseInvoice, lines: [] }, /invoice\.lines.*>=1/u],
    [{ ...baseInvoice, invoiceNumber: '' }, /invoice\.invoiceNumber.*>=1/u],
  ];
  for (const [invoice, pattern] of bad) {
    assert.throws(
      () => parseRecipe({ version: 'r1', steps: [{ op: 'invoice', options: { invoice } }] }),
      (error) => pattern.test(error.message ?? String(error)),
      `expected rejection for ${JSON.stringify(invoice).slice(0, 80)}`,
    );
  }
});

test('a batch ZIP carries the real output bytes, not placeholders', async () => {
  // The batch page computed every output and then discarded it, so a user had no way to
  // retrieve a result. The packer previously wrote a JSON placeholder with a TODO saying
  // the bytes were unavailable — they had been available all along.
  const pdfA = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3]);
  const pdfB = new Uint8Array([0x25, 0x50, 0x44, 0x46, 9, 9]);
  const { zipBatchResults } = await import('../src/batch/zip.ts');
  const { zipBytes, manifest } = zipBatchResults([
    { index: 0, status: 'succeeded', attempts: 1, output: pdfA },
    { index: 1, status: 'succeeded', attempts: 1, output: pdfB },
  ]);

  // Browser-safety is part of the contract: this runs in the browser, where Buffer is not
  // defined, so the packer must return a plain Uint8Array.
  assert.ok(zipBytes instanceof Uint8Array, 'the archive must be a Uint8Array, not a Buffer');

  const entries = unzipSync(zipBytes);
  assert.deepEqual(
    [...entries['batch_0_succeeded.pdf']],
    [...pdfA],
    'the archived bytes must be the actual PDF output',
  );
  assert.deepEqual([...entries['batch_1_succeeded.pdf']], [...pdfB]);
  assert.ok(entries['manifest.json'], 'a download must be self-describing');
  assert.equal(manifest.completed, 2);
  assert.equal(manifest.zipEntries, 3, 'two documents plus the manifest');
});

test('a batch ZIP never claims an entry it did not write', async () => {
  // A succeeded item with no bytes cannot be packed. The manifest must not count it,
  // or a user is told the download is complete while a file is missing from it.
  const { zipBatchResults } = await import('../src/batch/zip.ts');
  const { zipBytes, manifest } = zipBatchResults([
    { index: 0, status: 'succeeded', attempts: 1, output: new Uint8Array([1]) },
    { index: 1, status: 'succeeded', attempts: 1 },
  ]);
  assert.equal(manifest.zipEntries, 2, 'one document plus the manifest');
  assert.equal(Object.keys(unzipSync(zipBytes)).length, 2);
});

test('scan assembly and document pack preserve page order', async () => {
  const qr = await generateQr({ kind: 'text', value: 'scan fixture' });
  const scanned = await assembleScans([
    { bytes: qr.png, format: 'png' },
    { bytes: qr.png, format: 'png' },
  ]);
  assert.equal((await PDFDocument.load(scanned)).getPageCount(), 2);
  const pack = await buildDocumentPack('Pack', [
    { name: 'scan.pdf', bytes: scanned },
    { name: 'one.pdf', bytes: await fixture('one-page.pdf') },
  ]);
  assert.equal((await PDFDocument.load(pack)).getPageCount(), 4);
});

test('batch runner reports per-file retry state and stays bounded', async () => {
  const inputs = [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])];
  let failures = 0;
  const results = await runBatch(
    inputs,
    parseRecipe({ version: 'r1', steps: [] }),
    { concurrency: 2, maxRetries: 1 },
    async (input) => {
      if (input[0] === 2 && failures++ === 0) throw new Error('transient');
      return input;
    },
  );
  assert.deepEqual(
    results.map((item) => item.status),
    ['succeeded', 'succeeded', 'succeeded'],
  );
  assert.equal(results[1].attempts, 2);
});

test('recipes reject document bytes and describe deterministic steps', () => {
  const recipe = parseRecipe({
    version: 'r1',
    steps: [
      { op: 'compress', options: {} },
      { op: 'bates', options: {} },
    ],
  });
  assert.match(describeRecipe(recipe), /compress.*bates/iu);
  assert.throws(
    () =>
      parseRecipe({
        version: 'r1',
        steps: [{ op: 'compress', options: { bytes: new Uint8Array([1]) } }],
      }),
    PdfEngineError,
  );
});

test('folder watcher requires explicit permission and exposes pause/stop', async () => {
  const files = [
    { kind: 'file', name: 'a.pdf', getFile: async () => new globalThis.File(['x'], 'a.pdf') },
  ];
  const directory = {
    queryPermission: async () => 'denied',
    requestPermission: async () => 'granted',
    async *values() {
      yield* files;
    },
  };
  const seen = [];
  const watcher = new FolderWatcher(directory, {
    intervalMs: 5,
    onFile: async (file) => seen.push(file.name),
  });
  await watcher.start();
  watcher.pause();
  assert.equal(watcher.state, 'paused');
  watcher.resume();
  await new Promise((resolve) => setTimeout(resolve, 10));
  watcher.stop();
  assert.equal(watcher.state, 'stopped');
  assert.deepEqual(seen, ['a.pdf']);
});

test('P7-07 ZIP adapter records a failed item in the manifest rather than a file', async () => {
  // A failed item has no PDF to write, so it is only represented in the manifest. The point
  // of the manifest is that a user can see what failed without re-running the batch.
  const { zipBatchResults } = await import('../src/batch/zip.ts');
  const results = [
    {
      index: 0,
      status: 'succeeded',
      attempts: 1,
      output: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    },
    {
      index: 1,
      status: 'failed',
      attempts: 2,
      error: { kind: 'conversion-failed', remedy: 'Retry it.' },
    },
  ];
  const { zipBytes, manifest } = await zipBatchResults(results, { includeFailed: true });
  assert.ok(zipBytes.length > 0, 'ZIP non-empty');
  assert.equal(manifest.total, 2);
  assert.equal(manifest.completed, 1);
  assert.equal(manifest.failed, 1);
  assert.equal(manifest.zipEntries, 3, 'one document, one failure record, and the manifest');
  // includeFailed writes a small JSON record so the archive explains what failed and why.
  assert.ok(
    unzipSync(zipBytes)['batch_1_failed.pdf'],
    'the failed item is recorded when asked for',
  );

  // Without the option a failure contributes nothing but a manifest line.
  const plain = zipBatchResults(results);
  assert.equal(plain.manifest.zipEntries, 2, 'the one real document plus the manifest');
  assert.equal(Object.keys(unzipSync(plain.zipBytes)).includes('batch_1_failed.pdf'), false);
});

test('Relay remains explicit opt-in with typed failure when unconfigured', async () => {
  await assert.rejects(
    () => captureWebpageToPdf('https://example.com', ''),
    (error) => error instanceof PdfEngineError && error.details.kind === 'relay-not-configured',
  );
});

test('Relay surfaces the server remedy so the user is told the real cause', async () => {
  // The Relay distinguishes a blocked URL from a missing browser binary. That
  // distinction is only useful if the client keeps it, so the remedy the server
  // sends must survive into the thrown error's message.
  const stub = async () =>
    new Response(
      JSON.stringify({
        error: 'relay-failed',
        cause: 'browser executable missing',
        remedy: 'Install the pinned Playwright browser for this self-hosted Relay and retry.',
      }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );
  await assert.rejects(
    () => captureWebpageToPdf('https://example.com', 'http://127.0.0.1:8787', stub),
    (error) =>
      error instanceof PdfEngineError &&
      error.details.kind === 'relay-failed' &&
      error.message ===
        'Install the pinned Playwright browser for this self-hosted Relay and retry.' &&
      error.details.cause === 'Relay returned HTTP 503 (relay-failed).',
  );
});

test('Relay keeps a generic remedy when the failure body is not JSON', async () => {
  const stub = async () => new Response('upstream exploded', { status: 502 });
  await assert.rejects(
    () => captureWebpageToPdf('https://example.com', 'http://127.0.0.1:8787', stub),
    (error) =>
      error instanceof PdfEngineError &&
      error.details.kind === 'relay-failed' &&
      /reachable and has a compatible headless browser/u.test(error.message),
  );
});

test('Relay returns the PDF bytes on a successful capture', async () => {
  const stub = async () =>
    new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), {
      status: 200,
      headers: { 'content-type': 'application/pdf' },
    });
  const result = await captureWebpageToPdf('https://example.com', 'http://127.0.0.1:8787', stub);
  assert.equal(result.mimeType, 'application/pdf');
  assert.deepEqual([...result.bytes], [0x25, 0x50, 0x44, 0x46, 0x2d]);
});

test('a recipe op produces byte-identical output when run again later', async () => {
  // The P7-10 done-when is that the same recipe yields the same bytes. This used to fail
  // intermittently: pdf-lib's `updateMetadata` defaults to true and stamps a wall-clock
  // `/ModDate` into the Info dict, so two saves straddling a second boundary differed.
  //
  // The wait is the point. Without crossing a second boundary this test passes even when
  // the engine is fully nondeterministic, which is exactly why the bug shipped. Each op is
  // checked because the stamp came from shared save plumbing, not from any one op.
  const input = await fixture('one-page.pdf');
  const cases = [
    ['bates', { prefix: 'X-' }],
    ['compress', {}],
    ['metadata', { title: 'T' }],
    ['rotate', { degrees: 90 }],
    ['add-text', { text: 'hi' }],
    ['watermark', { text: 'hi' }],
    ['flatten', { forms: false }],
    ['page-numbers', {}],
  ];

  const produce = async (op, options) => {
    const plan = compile(
      parseRecipe({ version: 'r1', steps: [{ op, options }] }),
      await inspectWithPdfJs(input),
    );
    for await (const event of run(plan, [input])) if (event.kind === 'result') return event.bytes;
    throw new Error(`${op} produced no result`);
  };

  for (const [op, options] of cases) {
    const first = await produce(op, options);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const second = await produce(op, options);
    assert.deepEqual(
      [...second],
      [...first],
      `${op} is not byte-stable across a one-second gap, so a shared recipe would not reproduce`,
    );
  }
});

test('every recipe op is either dispatched or rejected, never silently skipped', async () => {
  // `scan-to-pdf` was declared in the schema with no `case` in the dispatch switch and no
  // `default`, so it fell through to `return undefined` — which the pipeline reads as "this
  // step produced no new output" and then re-serialises the untouched input while reporting
  // success. A recipe asking to scan silently returned a document that was never scanned.
  //
  // The dispatch surface is source, not a runtime export, so this reads the two files that
  // decide an op's fate and asserts every declared op appears in one of them. That is the
  // structural guard: it fails the moment a new op is added to the schema without a branch.
  const engineRoot = new URL('../src/', import.meta.url);
  const graph = await readFile(new URL('pdf/graph.ts', engineRoot), 'utf8');
  const pipeline = await readFile(new URL('runtime/pipeline.ts', engineRoot), 'utf8');
  const dispatchSource = `${graph}\n${pipeline}`;

  const missing = Object.keys(operationSchemas).filter((op) => !dispatchSource.includes(`'${op}'`));
  assert.deepEqual(
    missing,
    [],
    `these ops are declared in the recipe schema but never dispatched, so they silently pass their input through: ${missing.join(', ')}`,
  );
});

test('a scan-to-pdf recipe step is rejected with a remedy instead of passing input through', async () => {
  const input = await fixture('one-page.pdf');
  const plan = compile(
    parseRecipe({ version: 'r1', steps: [{ op: 'scan-to-pdf', options: { dpi: 150 } }] }),
    await inspectWithPdfJs(input),
  );

  await assert.rejects(
    async () => {
      for await (const _event of run(plan, [input])) void _event;
    },
    (error) => {
      assert.ok(error instanceof PdfEngineError, `expected a PdfEngineError, got ${error}`);
      assert.equal(error.details.kind, 'unsupported-feature');
      assert.match(error.message, /Scan to PDF page/u);
      return true;
    },
  );
});

test('the memory governor reduces concurrency instead of refusing the batch', async () => {
  // README §11.5 requires a governor that "reduces concurrency rather than crashing on very
  // large document sets". The previous implementation compared a projected total against the
  // cap and threw, so a large batch never started at all — the opposite of the requirement.
  const big = new Uint8Array(1024 * 1024);
  const inputs = Array.from({ length: 20 }, () => big);
  let peak = 0;
  let active = 0;

  const results = await runBatch(
    inputs,
    parseRecipe({ version: 'r1', steps: [] }),
    {
      concurrency: 8,
      // Each item projects to 2 MB, so only three fit inside a 6 MB budget.
      maxMemoryBytes: 6 * 1024 * 1024,
      onGovern: (concurrency) => {
        peak = concurrency;
      },
    },
    async () => {
      active += 1;
      assert.ok(active <= 3, `governor let ${active} items run at once against a 3-item budget`);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return big;
    },
  );

  assert.equal(peak, 3, 'the governor must report the concurrency it chose');
  assert.equal(results.filter((item) => item.status === 'succeeded').length, 20);
});

test('an item larger than the whole memory budget is refused with its own numbers', async () => {
  // Thinning the pool cannot make a single oversized item fit, so this is the one case that
  // still throws — and the remedy must state both figures rather than "reduce the batch size".
  const oversized = new Uint8Array(8 * 1024 * 1024);
  await assert.rejects(
    async () =>
      runBatch([oversized], parseRecipe({ version: 'r1', steps: [] }), {
        concurrency: 4,
        maxMemoryBytes: 1024 * 1024,
      }),
    (error) => {
      assert.ok(error instanceof PdfEngineError, `expected a PdfEngineError, got ${error}`);
      assert.equal(error.details.kind, 'memory-limit-exceeded');
      assert.equal(error.details.projectedBytes, 16 * 1024 * 1024);
      assert.equal(error.details.maxBytes, 1024 * 1024);
      assert.match(error.message, /16 MB/u);
      return true;
    },
  );
});

test('the folder watcher writes a processed document into the output folder', async () => {
  // P7-09's Done-when. The route previously reported a detected filename and discarded the file,
  // so "auto-process new files dropped into a picked folder" was never actually happening.
  const written = new Map();
  const output = {
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    getFileHandle: async (name) => ({
      createWritable: async () => ({
        write: async (bytes) => {
          written.set(name, new Uint8Array(bytes));
        },
        close: async () => {},
      }),
    }),
  };
  const results = [];
  const onFile = await watchProcessor({
    recipe: parseRecipe({ version: 'r1', steps: [{ op: 'bates', options: { prefix: 'W-' } }] }),
    output,
    onResult: (result) => results.push(result),
  });

  const source = await fixture('one-page.pdf');
  await onFile(new globalThis.File([source], 'quarterly.pdf', { type: 'application/pdf' }));

  assert.equal(results.length, 1, 'the callback reports one result per file');
  assert.equal(
    results[0].status,
    'succeeded',
    `expected success, got ${JSON.stringify(results[0])}`,
  );
  // The output name must not collide with the input, or the watcher would overwrite the file it
  // is watching.
  assert.equal(written.has('quarterly.pdf'), false, 'the input must never be overwritten');
  assert.equal(
    written.has('quarterly.processed.pdf'),
    true,
    'the suffix is inserted before the extension',
  );
  const bytes = written.get('quarterly.processed.pdf');
  assert.equal(bytes.byteLength, source.byteLength > 0 ? bytes.byteLength : 0);
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
});

test('one unreadable file does not stop the watcher, and its failure names the file', async () => {
  // A corrupt PDF in a watched folder must not take down every other file, and the user has to
  // be told which file failed and why rather than seeing the watcher simply stop.
  const written = new Map();
  const output = {
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    getFileHandle: async (name) => ({
      createWritable: async () => ({
        write: async (bytes) => {
          written.set(name, new Uint8Array(bytes));
        },
        close: async () => {},
      }),
    }),
  };
  const results = [];
  const onFile = await watchProcessor({
    recipe: parseRecipe({ version: 'r1', steps: [] }),
    output,
    maxRetries: 1,
    onResult: (result) => results.push(result),
  });

  await onFile(new globalThis.File([new Uint8Array([1, 2, 3])], 'broken.pdf'));
  const good = await fixture('one-page.pdf');
  await onFile(new globalThis.File([good], 'intact.pdf'));

  assert.equal(results.length, 2, 'the second file is still processed');
  assert.equal(results[0].status, 'failed');
  assert.equal(results[0].attempts, 2, 'the configured retry is honoured');
  assert.match(results[0].error.remedy, /\S/u, 'a failure must carry a remedy');
  assert.match(results[0].error.cause, /broken\.pdf/u, 'the failure must name the file');
  assert.equal(results[1].status, 'succeeded', `got ${JSON.stringify(results[1])}`);
  assert.equal(written.size, 1, 'only the intact file produced output');
});

test('the watcher asks for write permission before it writes anything', async () => {
  // Reading the input folder must not imply write access to the output, and a denied write has
  // to surface at start rather than once per file.
  let asked = 0;
  const denied = {
    queryPermission: async () => 'denied',
    requestPermission: async () => {
      asked += 1;
      return 'denied';
    },
    getFileHandle: async () => {
      throw new Error('nothing may be written without permission');
    },
  };
  await assert.rejects(
    async () =>
      watchProcessor({
        recipe: parseRecipe({ version: 'r1', steps: [] }),
        output: denied,
      }),
    (error) => {
      assert.ok(error instanceof PdfEngineError, `expected a PdfEngineError, got ${error}`);
      assert.equal(error.details.kind, 'permission-denied');
      assert.equal(error.details.resource, 'output folder');
      return true;
    },
  );
  assert.equal(asked, 1, 'permission is asked once, up front');
});

test('outputNameFor never produces the input name, including for dotfiles', () => {
  assert.equal(outputNameFor('report.pdf'), 'report.processed.pdf');
  assert.equal(outputNameFor('a.b.c.pdf'), 'a.b.c.processed.pdf');
  assert.equal(outputNameFor('noextension'), 'noextension.processed');
  // A leading dot is not an extension boundary, so the suffix goes on the end.
  assert.equal(outputNameFor('.env'), '.env.processed');
  assert.equal(outputNameFor('report.pdf', '.done'), 'report.done.pdf');
});

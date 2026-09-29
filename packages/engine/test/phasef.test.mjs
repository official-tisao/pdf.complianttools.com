import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
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
  runBatch,
  FolderWatcher,
  captureWebpageToPdf,
  PdfEngineError,
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

test('P7-07 ZIP adapter packs completed batch entries without breaking outputs', async () => {
  const { zipBatchResults } = await import('../src/batch/zip.ts');
  const results = [
    { index: 0, status: 'succeeded', attempts: 1 },
    { index: 1, status: 'failed', attempts: 2 },
  ];
  const { zipBuffer, manifest } = await zipBatchResults(results, { includeFailed: true });
  assert.ok(zipBuffer.length > 0, 'ZIP buffer non-empty');
  assert.equal(manifest.total, 2);
  assert.equal(manifest.completed, 1);
  assert.equal(manifest.failed, 1);
  assert.equal(manifest.zipEntries, 2);
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

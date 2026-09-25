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
  validateEInvoiceXml,
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

test('Relay remains explicit opt-in with typed failure when unconfigured', async () => {
  await assert.rejects(
    () => captureWebpageToPdf('https://example.com', ''),
    (error) => error instanceof PdfEngineError && error.details.kind === 'relay-not-configured',
  );
});

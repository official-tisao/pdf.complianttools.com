import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import {
  addAnnotation,
  addHeadersFooters,
  addPageNumbers,
  addTextToPdf,
  auditAccessibility,
  createBlankPdf,
  createFormPdf,
  editTextRun,
  fillFormPdf,
  generateSecurePassword,
  inspectFormFields,
  parseRecipe,
  protectPdf,
  redactPdf,
  removeSignatureBackground,
  textPagesToPdf,
  verifyDigitalSignatures,
  verifyRedaction,
} from '../dist/index.js';

const fixture = async (name) =>
  new Uint8Array(await readFile(new URL(`../../../fixtures/pdfs/${name}`, import.meta.url)));

test('editor seam falls back instead of claiming an in-place edit for non-embedded fonts', async () => {
  const source = createBlankPdf();
  const output = await editTextRun(source, {
    page: 1,
    find: 'missing',
    replace: 'new',
    fallback: { page: 1, text: 'Fallback text', x: 72, y: 72 },
  });
  assert.ok(output.byteLength > 0);
  await assert.rejects(
    () => editTextRun(source, { page: 1, find: 'missing', replace: 'new' }),
    /font|embedded|text box/u,
  );
});

test('text, annotation, headers, and page numbers are local PDF mutations', async () => {
  const source = await fixture('one-page.pdf');
  const withText = await addTextToPdf(source, {
    page: 1,
    text: 'Phase C local text',
    x: 72,
    y: 72,
  });
  const withAnnotation = await addAnnotation(withText, {
    page: 1,
    kind: 'highlight',
    rect: { x: 72, y: 72, width: 100, height: 20 },
  });
  const withHeader = await addHeadersFooters(withAnnotation, {
    header: '{date}',
    footer: 'Page {page} of {total}',
  });
  const numbered = await addPageNumbers(withHeader, { format: 'page-of-total' });
  const document = await PDFDocument.load(numbered);
  assert.equal(document.getPage(0).node.Annots()?.size(), 1);
  assert.ok(numbered.byteLength > source.byteLength);
});

test('AcroForm fields can be created, detected, and filled locally', async () => {
  const formPdf = await createFormPdf(createBlankPdf(), [
    { name: 'fullName', type: 'text', page: 1, x: 72, y: 700, width: 200, height: 24 },
    { name: 'accepted', type: 'checkbox', page: 1, x: 72, y: 660, width: 18, height: 18 },
    {
      name: 'choice',
      type: 'dropdown',
      page: 1,
      x: 72,
      y: 620,
      width: 120,
      height: 24,
      options: ['A', 'B'],
    },
  ]);
  const fields = await inspectFormFields(formPdf);
  assert.deepEqual(
    fields.map((field) => field.name),
    ['fullName', 'accepted', 'choice'],
  );
  const filled = await fillFormPdf(formPdf, { fullName: 'Ada', accepted: true, choice: 'B' });
  assert.ok((await inspectFormFields(filled)).length === 3);
});

test('redaction removes page content and withholds unverifiable exports', async () => {
  const source = await textPagesToPdf([['Sensitive secret 12345']]);
  const result = await redactPdf(source, {
    method: 'text-search-match',
    searchPattern: 'secret',
    removeMetadataOnRedact: true,
  });
  assert.equal(result.verification.passed, true);
  assert.equal(
    (await verifyRedaction(result.bytes, { method: 'text-search-match', searchPattern: 'secret' }))
      .passed,
    true,
  );
  assert.equal((await auditAccessibility(result.bytes)).hasStructureTree, false);
});

test('password and signature boundaries stay honest', async () => {
  const generated = generateSecurePassword({ length: 24 });
  assert.equal(generated.password.length, 24);
  await assert.rejects(() => protectPdf(), /encryption|writer|unsupported/u);
  assert.deepEqual(await verifyDigitalSignatures(createBlankPdf()), {
    status: 'unsigned',
    signatures: [],
    remedy: 'No PDF signature ByteRange was found.',
  });
});

test('signature background removal rejects codecs it cannot decode', () => {
  assert.throws(
    () => removeSignatureBackground(new globalThis.TextEncoder().encode('not a png')),
    /PNG|codec|unsupported/u,
  );
});

test('Phase C recipes validate their typed operations', () => {
  const recipe = parseRecipe({
    version: 'r1',
    steps: [
      { op: 'add-text', options: { text: 'hello' } },
      { op: 'annotate', options: { rect: { x: 1, y: 1, width: 10, height: 10 } } },
      { op: 'redact', options: { method: 'text-search-match', searchPattern: 'secret' } },
    ],
  });
  assert.equal(recipe.steps.length, 3);
});

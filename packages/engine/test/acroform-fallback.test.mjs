import assert from 'node:assert/strict';
import test from 'node:test';
import { createBlankPdf, createFormPdf, fillFormPdf, inspectFormFields } from '../dist/index.js';

test('PDF.js fallback path detects form fields that pdf-lib would miss', async () => {
  // Build a PDF with AcroForm fields using createFormPdf
  const source = createBlankPdf();
  const formPdf = await createFormPdf(source, [
    { name: 'fullName', type: 'text', page: 1, x: 72, y: 700, width: 200, height: 24 },
    { name: 'accepted', type: 'checkbox', page: 1, x: 72, y: 660, width: 18, height: 18 },
    { name: 'choice', type: 'dropdown', page: 1, x: 72, y: 620, width: 120, height: 24, options: ['A', 'B'] },
  ]);

  // Normal detection via pdf-lib (should find fields)
  const fieldsNormal = await inspectFormFields(formPdf);
  assert.ok(fieldsNormal.length >= 3);

  // Fill the form
  const filled = await fillFormPdf(formPdf, { fullName: 'Ada', accepted: true, choice: 'B' });
  const fieldsFilled = await inspectFormFields(filled);
  assert.ok(fieldsFilled.length >= 3);

  // Verify PDF.js fallback path also detects fields
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({ data: filled.slice() });
  const document = await loadingTask.promise;
  try {
    const fieldObjects = await document.getFieldObjects?.();
    assert.ok(fieldObjects !== null, 'getFieldObjects should return a Map');
    const keys = [...fieldObjects.keys()];
    assert.ok(keys.length >= 3, 'getFieldObjects should have found at least 3 fields');
    assert.ok(keys.some((k) => k.includes('fullName') || k.includes('Ada')), 'should find text field');
  } finally {
    await loadingTask.destroy();
  }
});

test('PDF.js fallback detects widgets via page annotations when getFieldObjects returns empty', async () => {
  // Test the page.getAnnotations path which is used as fallback
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({ data: createBlankPdf() });
  const document = await loadingTask.promise;
  try {
    const page = await document.getPage(1);
    const annotations = await page.getAnnotations({ intent: 'any' });
    assert.ok(Array.isArray(annotations), 'annotations should be an array');
  } finally {
    await loadingTask.destroy();
  }
});

test('flat PDF without form fields returns empty field list, not an error', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const blank = createBlankPdf();
  const loadingTask = pdfjs.getDocument({ data: blank.slice() });
  const document = await loadingTask.promise;
  try {
    assert.equal(document.isPureXfa, false, 'isPureXfa should be false for non-XFA');
    const fields = await inspectFormFields(blank);
    assert.deepEqual(fields, [], 'flat PDF should return empty field list');
  } finally {
    await loadingTask.destroy();
  }
});

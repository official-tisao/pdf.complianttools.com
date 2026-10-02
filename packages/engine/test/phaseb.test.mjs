import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  classifyPdfInput,
  convertFromPdf,
  convertToPdf,
  extractBankStatement,
  getAvailableFormats,
  getFormatCapability,
  PdfEngineError,
} from '../dist/index.js';

const fixture = (name) => new URL(`../../../fixtures/conversion/${name}`, import.meta.url);

async function readFirstPageTextItems(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({ data: bytes.slice() });
  const document = await loadingTask.promise;
  try {
    const page = await document.getPage(1);
    const content = await page.getTextContent();
    return content.items;
  } finally {
    await loadingTask.destroy();
  }
}

function styleSignature(item) {
  const transform = Array.isArray(item.transform) ? item.transform : [];
  // The last two transform values are the text position, not its visual style.
  return [
    item.fontName,
    ...transform.slice(0, 4).map((value) => Math.round(value * 100) / 100),
  ].join('|');
}

test('format registry exposes only directionally available targets', () => {
  assert.equal(getFormatCapability('docx').status, 'supported');
  assert.equal(getFormatCapability('publisher').status, 'unavailable');
  assert.ok(getAvailableFormats('to-pdf').some((format) => format.id === 'markdown'));
  assert.ok(!getAvailableFormats('to-pdf').some((format) => format.id === 'publisher'));
});

test('Markdown and CSV fixtures create valid PDFs with deterministic output', async () => {
  const markdown = new Uint8Array(await readFile(fixture('markdown-golden.md')));
  const csv = new Uint8Array(await readFile(fixture('sample.csv')));
  const markdownPdf = await convertToPdf('markdown', markdown, { fileName: 'markdown-golden.md' });
  const csvPdf = await convertToPdf('csv', csv, { fileName: 'sample.csv' });
  assert.equal((await classifyPdfInput(markdownPdf.bytes)).ok, true);
  assert.equal((await classifyPdfInput(csvPdf.bytes)).ok, true);
  assert.match(
    new TextDecoder().decode(await readFile(fixture('markdown-golden.md'))),
    /code blocks/u,
  );
});

test('rich Markdown renders headings, lists, and emphasis with distinct PDF styles', async () => {
  const markdown = [
    '# Release Notes',
    '',
    'A body paragraph with ordinary text.',
    '',
    '- first item',
    '- second item',
    '',
    '**Important**: this sentence is emphasized.',
  ].join('\n');
  const result = await convertToPdf('markdown', new TextEncoder().encode(markdown), {
    fileName: 'rich-markdown.md',
  });
  const items = await readFirstPageTextItems(result.bytes);
  const text = items.map((item) => item.str ?? '').join(' ');
  const heading = items.find((item) => /Release Notes/iu.test(item.str ?? ''));
  const body = items.find((item) => /ordinary text/iu.test(item.str ?? ''));
  const listItem = items.find((item) => /first item/iu.test(item.str ?? ''));
  const emphasis = items.find((item) => /Important/iu.test(item.str ?? ''));

  assert.match(text, /Release Notes/iu);
  assert.match(text, /first item/iu);
  assert.match(text, /Important/iu);
  assert.ok(heading, 'the heading must remain a visible text item');
  assert.ok(body, 'the body paragraph must remain a visible text item');
  assert.ok(listItem, 'the list item must remain a visible text item');
  assert.ok(emphasis, 'the emphasized text must remain a visible text item');
  assert.notEqual(
    styleSignature(heading),
    styleSignature(body),
    'heading and body text must use different PDF styling',
  );
  assert.ok(
    /^[•●▪*-]\s/u.test(listItem.str ?? '') ||
      Math.abs((listItem.transform?.[4] ?? 0) - (body.transform?.[4] ?? 0)) >= 1,
    'list items must have a visible marker or indentation',
  );
  assert.notEqual(
    styleSignature(emphasis),
    styleSignature(body),
    'emphasized text must use different PDF styling',
  );
});

test('PDF text conversion has an explicit review warning', async () => {
  const source = new Uint8Array(
    await readFile(new URL('../../../fixtures/pdfs/one-page.pdf', import.meta.url)),
  );
  const result = await convertFromPdf('pdf-markdown', source, { fileName: 'one-page.pdf' });
  assert.equal(result.extension, '.md');
  assert.ok(result.warnings.some((warning) => /review/u.test(warning)));
  assert.match(new TextDecoder().decode(result.bytes), /^## Page 1/mu);
});

test('bank statement heuristic returns measurable, reviewable rows', async () => {
  const text = new TextDecoder().decode(await readFile(fixture('statement.txt')));
  const extraction = extractBankStatement(text);
  assert.equal(extraction.rows.length, 3);
  assert.ok(extraction.confidence > 0);
  assert.equal(extraction.rows[1].amount, '2500.00');
});

test('unavailable conversion returns a typed remedy and never fabricates output', async () => {
  await assert.rejects(
    () => convertToPdf('publisher', new Uint8Array([1, 2, 3])),
    (error) => {
      assert.ok(error instanceof PdfEngineError);
      assert.equal(error.details.kind, 'unsupported-format');
      assert.match(error.details.remedy, /proprietary|permissive/u);
      return true;
    },
  );
});

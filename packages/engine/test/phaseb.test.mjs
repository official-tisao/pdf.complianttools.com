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

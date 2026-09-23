import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import {
  classifyPdfInput,
  compile,
  createBlankPdf,
  createPdfiumRenderer,
  getPdfJsPageDimensions,
  inspectWithPdfJs,
  mergePdfBuffers,
  parseRecipe,
  WorkerPool,
} from '../dist/index.js';

const require = createRequire(import.meta.url);
const fixture = (name) => new URL(`../../../fixtures/pdfs/${name}`, import.meta.url);

test('merge writes a valid PDF from two fixture PDFs', async () => {
  const first = new Uint8Array(await readFile(fixture('one-page.pdf')));
  const second = new Uint8Array(await readFile(fixture('two-page.pdf')));
  const merged = await mergePdfBuffers([first, second]);
  const document = await PDFDocument.load(merged);
  assert.equal(document.getPageCount(), 3);
});

test('jsPDF creates a valid blank PDF for from-scratch workflows', async () => {
  const bytes = createBlankPdf();
  const document = await PDFDocument.load(bytes);
  assert.equal(document.getPageCount(), 1);
});

test('pdf.js opens the fixture and reports text', async () => {
  const bytes = new Uint8Array(await readFile(fixture('one-page.pdf')));
  const meta = await inspectWithPdfJs(bytes);
  assert.equal(meta.pageCount, 1);
  assert.equal(meta.hasText, true);
});

test('the read path handles a 20-page worker-sized fixture', async () => {
  const bytes = new Uint8Array(await readFile(fixture('twenty-page.pdf')));
  const pool = new WorkerPool(1);
  const meta = await pool.run(() => inspectWithPdfJs(bytes));
  assert.equal(meta.pageCount, 20);
});

test('pdfium and pdf.js agree on first-page dimensions', async () => {
  const bytes = new Uint8Array(await readFile(fixture('one-page.pdf')));
  const pdfiumWasmPath = require.resolve('@embedpdf/pdfium/pdfium.wasm');
  const wasm = await readFile(pdfiumWasmPath);
  const renderer = await createPdfiumRenderer(wasm);
  const rendered = await renderer.renderPage(bytes, 1);
  const dimensions = await getPdfJsPageDimensions(bytes);
  assert.deepEqual([rendered.width, rendered.height], [dimensions.width, dimensions.height]);
  assert.equal(rendered.pixels.byteLength, rendered.width * rendered.height * 4);
});

test('recipe parsing and planning are strict and deterministic', () => {
  const recipe = parseRecipe({ version: 'r1', steps: [{ op: 'merge', options: {} }] });
  const plan = compile(recipe, { pageCount: 2, byteLength: 1000, encrypted: false, hasText: true });
  assert.equal(plan.requiresNetwork, false);
  assert.ok(plan.estimatedPeakBytes >= 2000);
  assert.throws(() => parseRecipe({ version: 'r2', steps: [] }));
});

test('adversarial corpus produces typed outcomes without active-content execution', async () => {
  const adversarialDir = new URL('../../../fixtures/adversarial/', import.meta.url);
  const names = (await readdir(adversarialDir)).filter((name) => name.endsWith('.pdf'));

  assert.equal(names.length, 9);
  for (const name of names) {
    const result = await classifyPdfInput(
      new Uint8Array(await readFile(new URL(name, adversarialDir))),
    );
    if (!result.ok) {
      assert.ok(['corrupt-structure', 'unsupported-feature'].includes(result.error.kind));
      assert.equal(typeof result.error.remedy, 'string');
    } else {
      assert.equal(typeof result.meta.pageCount, 'number');
    }
  }

  const activeContent = await classifyPdfInput(
    new Uint8Array(await readFile(new URL('embedded-javascript.pdf', adversarialDir))),
  );
  assert.equal(activeContent.ok, false);
  if (!activeContent.ok) assert.equal(activeContent.error.kind, 'unsupported-feature');
});

test('worker cancellation is observed within the Phase 0 budget', async () => {
  const pool = new WorkerPool(1);
  const controller = new AbortController();
  const started = performance.now();
  const job = pool.run(async (signal) => {
    while (!signal.aborted) await new Promise((resolve) => setTimeout(resolve, 1));
    throw new DOMException('The task was aborted.', 'AbortError');
  }, controller.signal);
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(job, { name: 'AbortError' });
  assert.ok(performance.now() - started < 50);
});

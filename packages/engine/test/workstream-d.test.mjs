import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  OCR_MODELS,
  comparePdfPixels,
  comparePdfText,
  getOcrCapability,
  getPdfOutline,
  inspectStructure,
  ocrFallback,
  parseRecipe,
  readPdfMetadata,
  searchPdfText,
  setPdfMetadata,
} from '../dist/index.js';

const fixture = (name) => new URL(`../../../fixtures/pdfs/${name}`, import.meta.url);
const bytes = async (name) => new Uint8Array(await readFile(fixture(name)));

test('viewer read APIs expose full-page search and an empty-safe outline', async () => {
  const source = await bytes('hundred-page.pdf');
  const pages = await searchPdfText(source, 'fixture');
  assert.equal(pages.length, 100);
  assert.ok(pages.every((match) => match.pageNumber >= 1));
  assert.deepEqual(await getPdfOutline(source), []);
});

test('text compare reports deterministic changes without a renderer', async () => {
  const report = await comparePdfText(await bytes('one-page.pdf'), await bytes('two-page.pdf'));
  assert.equal(report.identical, false);
  assert.ok(report.pagesCompared >= 2);
  assert.ok(report.changes.some((change) => ['added', 'replaced'].includes(change.kind)));
});

test('pixel compare uses the injected renderer and produces a heatmap seam', async () => {
  let calls = 0;
  const render = async () => ({
    width: 2,
    height: 1,
    pixels: Uint8Array.from(
      calls++ % 2 === 0 ? [0, 0, 0, 255, 255, 255, 255, 255] : [0, 0, 0, 255, 0, 0, 0, 255],
    ),
  });
  const reports = await comparePdfPixels(
    await bytes('one-page.pdf'),
    await bytes('one-page.pdf'),
    render,
  );
  assert.equal(reports[0].changedPixels, 1);
  assert.equal(reports[0].heatmap.length, 8);
  const source = await bytes('one-page.pdf');
  await assert.rejects(
    () =>
      comparePdfPixels(source, source, async () => {
        throw new Error('renderer unavailable');
      }),
    (error) => error.details.kind === 'renderer-unavailable',
  );
});

test('metadata round-trips standard fields, dates, and namespaced XMP', async () => {
  const source = await bytes('one-page.pdf');
  const edited = await setPdfMetadata(source, {
    title: 'Phase D title',
    author: 'Local author',
    keywords: ['local', 'pdf'],
    creationDate: new Date('2026-01-02T03:04:05Z'),
    customXmp: { reviewState: 'needs-review' },
  });
  const metadata = await readPdfMetadata(edited);
  assert.equal(metadata.title, 'Phase D title');
  assert.deepEqual(metadata.keywords, ['local', 'pdf']);
  assert.equal(metadata.customXmp.reviewState, 'needs-review');
  assert.equal(metadata.creationDate?.toISOString(), '2026-01-02T03:04:05.000Z');
});

test('structure report includes font and tag arrays and never executes active content', async () => {
  const report = await inspectStructure(await bytes('one-page.pdf'));
  assert.equal(report.pageCount, 1);
  assert.ok(Array.isArray(report.fonts));
  assert.ok(Array.isArray(report.tagTree));
  assert.equal(report.hasJavaScript, false);
});

test('OCR reports model/runtime capability and keeps selectable-text fallback local', async () => {
  const capability = await getOcrCapability('eng');
  assert.equal(capability.state, 'runtime-not-configured');
  assert.equal(OCR_MODELS[0].source, 'user-supplied-local-model');
  const fallback = await ocrFallback(await bytes('one-page.pdf'));
  assert.equal(fallback.fallback, 'pdf-text-extraction');
  assert.match(new TextDecoder().decode(fallback.bytes), /Phase 0 fixture/u);
  assert.equal(
    parseRecipe({
      version: 'r1',
      steps: [
        { op: 'ocr', options: {} },
        { op: 'compare', options: {} },
      ],
    }).steps.length,
    2,
  );
});

test('OCR adversarial fixtures stay bounded and disclose image-only limitations', async () => {
  const blank = await ocrFallback(await bytes('blank-page.pdf'));
  assert.equal(blank, undefined);
  const rotated = await ocrFallback(await bytes('rotated-scan.pdf'));
  const columns = await ocrFallback(await bytes('multi-column.pdf'));
  assert.match(new TextDecoder().decode(rotated.bytes), /Rotated scan/u);
  assert.match(new TextDecoder().decode(columns.bytes), /Column A/u);
});

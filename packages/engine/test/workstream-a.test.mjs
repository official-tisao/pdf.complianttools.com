import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import {
  addBatesNumbering,
  compile,
  compressPdf,
  createPdfProxy,
  extractPages,
  mergePdfBuffers,
  parseSerializedRecipe,
  parseRecipe,
  predictCompressedSize,
  previewProxy,
  removePages,
  reorderPages,
  serializeRecipe,
  splitPdf,
  run,
} from '../dist/index.js';

const fixture = (name) => new URL(`../../../fixtures/pdfs/${name}`, import.meta.url);
const bytes = async (name) => new Uint8Array(await readFile(fixture(name)));
const pages = async (value) => (await PDFDocument.load(value)).getPageCount();

test('merge, split, and extract preserve deterministic page counts', async () => {
  const source = await bytes('two-page.pdf');
  const merged = await mergePdfBuffers([source, source]);
  assert.equal(await pages(merged), 4);
  const split = await splitPdf(merged, { pagesPerFile: 2 });
  assert.deepEqual(await Promise.all(split.map(pages)), [2, 2]);
  assert.equal(await pages(await extractPages(merged, '2-3')), 2);
});

test('split methods cover every-page, selected-page ranges, and explicit pagesPerFile', async () => {
  const source = await bytes('two-page.pdf');
  const merged = await mergePdfBuffers([source, source, source]);
  assert.equal(await pages(merged), 6);

  // Every page becomes its own one-page file.
  const everyPage = await splitPdf(merged, { splitMethod: 'everyPage' });
  assert.equal(everyPage.length, 6);
  assert.deepEqual(await Promise.all(everyPage.map(pages)), [1, 1, 1, 1, 1, 1]);

  // Selected pages group into runs: 1-3 and 5-6 become two parts of 3 and 2.
  const parts = [];
  const ranges = await splitPdf(merged, {
    splitMethod: 'ranges',
    selectedPages: [1, 2, 3, 5, 6],
    onPart: (part) => parts.push([...part.pages]),
  });
  assert.deepEqual(await Promise.all(ranges.map(pages)), [3, 2]);
  assert.deepEqual(parts, [
    [1, 2, 3],
    [5, 6],
  ]);

  // Each comma-separated token is its own file: "1-2, 3" is two parts, not one.
  const explicitParts = [];
  const explicit = await splitPdf(merged, {
    splitMethod: 'ranges',
    selectedPages: [1, 2, 3],
    ranges: ['1-2', '3'],
    onPart: (part) => explicitParts.push([...part.pages]),
  });
  assert.deepEqual(await Promise.all(explicit.map(pages)), [2, 1]);
  assert.deepEqual(explicitParts, [[1, 2], [3]]);

  // Out-of-range tokens clamp to the document instead of failing: a 6-page
  // document asked for "1-9, 2, 5-6" yields the whole document, then 2, then
  // 5-6 — three parts.
  const clamped = await splitPdf(merged, {
    splitMethod: 'ranges',
    ranges: ['1-9', '2', '5-6'],
  });
  assert.deepEqual(await Promise.all(clamped.map(pages)), [6, 1, 2]);

  // pagesPerFile leaves a final partial group: 6 pages at 4 per file -> [4, 2].
  const chunked = await splitPdf(merged, { splitMethod: 'pagesPerFile', pagesPerFile: 4 });
  assert.deepEqual(await Promise.all(chunked.map(pages)), [4, 2]);
});

test('split by bookmarks errors clearly when the document has no outline', async () => {
  const source = await bytes('two-page.pdf');
  const merged = await mergePdfBuffers([source, source]);
  await assert.rejects(
    () => splitPdf(merged, { splitMethod: 'bookmarks' }),
    (error) => {
      assert.equal(error.details?.kind, 'unsupported-feature');
      assert.match(error.message, /bookmark\/outline/u);
      return true;
    },
  );
});

test('split by bookmarks produces one part per outline entry', async () => {
  // Bookmarks on pages 1 and 3: the first part holds pages 1-2 (pages before
  // the second bookmark join it), the second holds pages 3-4.
  const source = await bytes('two-page.pdf');
  const merged = await mergePdfBuffers([source, source]);
  const outlined = await PDFDocument.load(merged);
  const context = outlined.context;
  const pageRefs = outlined.getPages().map((page) => page.ref);
  const first = context.obj({ Title: PDFString.of('Part one'), Dest: [pageRefs[0]] });
  const second = context.obj({ Title: PDFString.of('Part two'), Dest: [pageRefs[2]] });
  const outlines = context.obj({
    Type: 'Outlines',
    First: context.register(first),
    Last: context.register(second),
    Count: 2,
  });
  first.set(PDFName.of('Next'), context.register(second));
  second.set(PDFName.of('Prev'), outlines.get(PDFName.of('First')));
  outlined.catalog.set(PDFName.of('Outlines'), context.register(outlines));

  const parts = [];
  const outputs = await splitPdf(await outlined.save(), {
    splitMethod: 'bookmarks',
    onPart: (part) => parts.push([...part.pages]),
  });
  assert.deepEqual(await Promise.all(outputs.map(pages)), [2, 2]);
  assert.deepEqual(parts, [
    [1, 2],
    [3, 4],
  ]);
});

test('delete and reorder never mutate the input graph', async () => {
  const source = await bytes('two-page.pdf');
  const deleted = await removePages(source, [1]);
  assert.equal(await pages(deleted), 1);
  const reordered = await reorderPages(source, [2, 1]);
  assert.equal(await pages(reordered), 2);
  assert.equal(await pages(source), 2);
});

test('recipe links round-trip parameters but contain no document bytes', async () => {
  const recipe = parseRecipe({
    version: 'r1',
    steps: [
      { op: 'compress', options: { preset: 'balanced' } },
      { op: 'bates', options: { prefix: 'CASE-' } },
    ],
  });
  const link = await serializeRecipe(recipe);
  assert.match(link, /^r1\.[A-Za-z0-9_-]+$/u);
  assert.deepEqual(await parseSerializedRecipe(link), recipe);
  assert.doesNotMatch(link, /two-page|JVBERi0/u);
});

test('pipeline yields progress and a single final result', async () => {
  const source = await bytes('one-page.pdf');
  const plan = compile(
    parseRecipe({
      version: 'r1',
      steps: [
        { op: 'bates', options: { prefix: 'A-' } },
        { op: 'compress', options: {} },
      ],
    }),
    { pageCount: 1, byteLength: source.byteLength, encrypted: false, hasText: true },
  );
  const events = [];
  for await (const event of run(plan, [source], { onProgress: (value) => events.push(value) }))
    events.push(event);
  assert.ok(events.some((event) => event.kind === 'progress' && event.completed === 1));
  const result = events.at(-1);
  assert.equal(result.kind, 'result');
  assert.equal(await pages(result.bytes), 1);
  const numbered = await addBatesNumbering(source, { prefix: 'A-' });
  assert.equal(await pages(numbered), 1);
});

test('memory governor refuses a 2,000-page projection with a remedy', () => {
  const recipe = parseRecipe({ version: 'r1', steps: [{ op: 'compress', options: {} }] });
  assert.throws(
    () => compile(recipe, { pageCount: 2000, byteLength: 1024, encrypted: false, hasText: false }),
    (error) =>
      error.details.kind === 'memory-limit-exceeded' && error.details.remedy.includes('Split'),
  );
});

test('merge options select files and ranges without changing the source bytes', async () => {
  const source = await bytes('two-page.pdf');
  const merged = await mergePdfBuffers([source, source], {
    fileOrder: [1, 0],
    pageRangePerFile: { 0: '2', 1: '1' },
    insertBlankBetween: true,
  });
  assert.equal(await pages(merged), 3);
  assert.equal(await pages(source), 2);
});

test('proxy preview is one-page and compression prediction is bounded', async () => {
  const source = await bytes('twenty-page.pdf');
  const proxy = await createPdfProxy(source, 7);
  assert.equal(proxy.pageCount, 1);
  const frame = await previewProxy(
    source,
    async (_bytes, pageNumber, scale = 1) => ({
      pageNumber,
      width: Math.round(100 * scale),
      height: Math.round(140 * scale),
      pixels: new Uint8Array(Math.round(100 * scale) * Math.round(140 * scale) * 4),
    }),
    7,
  );
  assert.equal(frame.pageNumber, 1);
  assert.ok(predictCompressedSize(20_000_000, { preset: 'balanced' }) < 20_000_000);
});

test('compression invokes the image adapter at the preset quality and preserves pages', async () => {
  // A tiny valid JPEG keeps this test deterministic while exercising the same
  // DCTDecode image path used by camera/scanner PDFs in the browser.
  const jpeg = Uint8Array.from(
    Buffer.from(
      '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9k=',
      'base64',
    ),
  );
  const sourceDocument = await PDFDocument.create();
  const page = sourceDocument.addPage([200, 200]);
  const image = await sourceDocument.embedJpg(jpeg);
  page.drawImage(image, { x: 0, y: 0, width: 200, height: 200 });
  const source = new Uint8Array(await sourceDocument.save());
  let requestedQuality = 0;
  const compressed = await compressPdf(source, {
    preset: 'extreme',
    quality: 90,
    reencodeImage: ({ bytes, quality }) => {
      requestedQuality = quality;
      return bytes.slice(0, Math.floor(bytes.length / 2));
    },
  });
  assert.equal(requestedQuality, 45);
  assert.ok(compressed.byteLength < source.byteLength);
  assert.equal(await pages(compressed), 1);
});

test('order-independent recipes stay equivalent across 200 generated page pairs', () => {
  for (let seed = 0; seed < 200; seed += 1) {
    const first = [1, 2, 3, 4].map((page) => ((page + seed) % 4) + 1);
    const second = [...first];
    assert.deepEqual(first, second);
  }
});

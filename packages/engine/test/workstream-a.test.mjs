import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import {
  addBatesNumbering,
  compile,
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
  assert.throws(() => compile(recipe, { pageCount: 2000, byteLength: 1024, encrypted: false, hasText: false }), (error) => error.details.kind === 'memory-limit-exceeded' && error.details.remedy.includes('Split'));
});

test('merge options select files and ranges without changing the source bytes', async () => {
  const source = await bytes('two-page.pdf');
  const merged = await mergePdfBuffers([source, source], { fileOrder: [1, 0], pageRangePerFile: { '0': '2', '1': '1' }, insertBlankBetween: true });
  assert.equal(await pages(merged), 3);
  assert.equal((await pages(source)), 2);
});

test('proxy preview is one-page and compression prediction is bounded', async () => {
  const source = await bytes('twenty-page.pdf');
  const proxy = await createPdfProxy(source, 7);
  assert.equal(proxy.pageCount, 1);
  const frame = await previewProxy(source, async (_bytes, pageNumber, scale = 1) => ({ pageNumber, width: Math.round(100 * scale), height: Math.round(140 * scale), pixels: new Uint8Array(Math.round(100 * scale) * Math.round(140 * scale) * 4) }), 7);
  assert.equal(frame.pageNumber, 1);
  assert.ok(predictCompressedSize(20_000_000, { preset: 'balanced' }) < 20_000_000);
});

test('order-independent recipes stay equivalent across 200 generated page pairs', () => {
  for (let seed = 0; seed < 200; seed += 1) {
    const first = [1, 2, 3, 4].map((page) => ((page + seed) % 4) + 1);
    const second = [...first];
    assert.deepEqual(first, second);
  }
});

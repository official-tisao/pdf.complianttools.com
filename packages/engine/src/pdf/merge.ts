import { PDFDocument } from 'pdf-lib';
import { PdfEngineError } from '../errors.js';
import type { MergeOptions } from '../types.js';

function parseRange(value: string, count: number): number[] {
  const pages: number[] = [];
  for (const token of value.split(',')) {
    const [startText, endText] = token.split('-');
    const start = Number(startText);
    const end = Number(endText ?? startText);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start)
      throw new PdfEngineError({
        kind: 'invalid-operation',
        operation: 'merge',
        remedy: 'Use page ranges such as 1-3,5.',
      });
    for (let page = start; page <= Math.min(end, count); page += 1) pages.push(page);
  }
  return [...new Set(pages)];
}

export async function mergePdfBuffers(
  sources: readonly Uint8Array[],
  options: MergeOptions = {},
): Promise<Uint8Array> {
  if (sources.length === 0) {
    throw new PdfEngineError({
      kind: 'invalid-operation',
      operation: 'merge',
      remedy: 'Choose at least one PDF source.',
    });
  }

  const output = await PDFDocument.create();
  const order = options.fileOrder?.length ? options.fileOrder : sources.map((_, index) => index);
  for (const [position, sourceIndex] of order.entries()) {
    const source = sources[sourceIndex];
    if (!source)
      throw new PdfEngineError({
        kind: 'invalid-operation',
        operation: 'merge',
        remedy: 'The merge order refers to a file that is not selected.',
      });
    let input: PDFDocument;
    try {
      input = await PDFDocument.load(source, { ignoreEncryption: false });
    } catch {
      throw new PdfEngineError({
        kind: 'corrupt-structure',
        repairable: true,
        remedy: 'One input could not be opened. Re-export it or use Repair PDF before merging.',
      });
    }
    const range = options.pageRangePerFile?.[String(sourceIndex)];
    const pageNumbers = range
      ? parseRange(range, input.getPageCount())
      : input.getPageIndices().map((page) => page + 1);
    const pages = await output.copyPages(
      input,
      pageNumbers.map((page) => page - 1),
    );
    if (options.insertBlankBetween && position > 0) output.addPage();
    for (const page of pages) output.addPage(page);
  }
  return output.save();
}

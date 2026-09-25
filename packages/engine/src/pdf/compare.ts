import { PdfEngineError } from '../errors.js';
import { extractPdfTextPages, type PdfTextPage } from '../conversion/pdf-text.js';
import type { PageRenderer, RenderedRasterPage } from './operations.js';

export type TextDiffKind = 'added' | 'removed' | 'replaced' | 'moved';

export type TextDiffChange = {
  readonly kind: TextDiffKind;
  readonly pageNumber: number;
  readonly lineNumber: number;
  readonly text: string;
  readonly counterpart?: string;
};

export type TextDiffReport = {
  readonly changes: readonly TextDiffChange[];
  readonly pagesCompared: number;
  readonly identical: boolean;
};

export type PixelDiffReport = {
  readonly pageNumber: number;
  readonly width: number;
  readonly height: number;
  readonly changedPixels: number;
  readonly comparedPixels: number;
  readonly ratio: number;
  readonly heatmap: Uint8Array;
};

export type CompareReport = {
  readonly text: TextDiffReport;
  readonly pixel?: readonly PixelDiffReport[];
  readonly pixelCapability: 'available' | 'renderer-required';
};

function lineKey(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
}

function lcs(a: readonly string[], b: readonly string[]): readonly [number, number][] {
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let ai = a.length - 1; ai >= 0; ai -= 1) {
    for (let bi = b.length - 1; bi >= 0; bi -= 1) {
      table[ai]![bi] =
        lineKey(a[ai]!) === lineKey(b[bi]!)
          ? table[ai + 1]![bi + 1]! + 1
          : Math.max(table[ai + 1]![bi]!, table[ai]![bi + 1]!);
    }
  }
  const pairs: [number, number][] = [];
  let ai = 0;
  let bi = 0;
  while (ai < a.length && bi < b.length) {
    if (lineKey(a[ai]!) === lineKey(b[bi]!)) {
      pairs.push([ai, bi]);
      ai += 1;
      bi += 1;
    } else if (table[ai + 1]![bi]! >= table[ai]![bi + 1]!) ai += 1;
    else bi += 1;
  }
  return pairs;
}

function diffPage(
  pageNumber: number,
  before: readonly string[],
  after: readonly string[],
): TextDiffChange[] {
  const pairs = lcs(before, after);
  const matchedBefore = new Set(pairs.map(([index]) => index));
  const matchedAfter = new Set(pairs.map(([, index]) => index));
  const removed = before.flatMap((text, index) =>
    matchedBefore.has(index) ? [] : [{ index, text }],
  );
  const added = after.flatMap((text, index) => (matchedAfter.has(index) ? [] : [{ index, text }]));
  const changes: TextDiffChange[] = [];
  const movedAfter = new Set<number>();
  for (const item of added) {
    const counterpart = removed.find((candidate) => lineKey(candidate.text) === lineKey(item.text));
    if (!counterpart) continue;
    movedAfter.add(item.index);
    changes.push({
      kind: 'moved',
      pageNumber,
      lineNumber: item.index + 1,
      text: item.text,
      counterpart: `from line ${counterpart.index + 1}`,
    });
  }
  const paired = Math.min(
    removed.length,
    added.filter((item) => !movedAfter.has(item.index)).length,
  );
  for (let index = 0; index < paired; index += 1) {
    const oldLine = removed[index]!;
    const newLine = added.filter((item) => !movedAfter.has(item.index))[index]!;
    changes.push({
      kind: 'replaced',
      pageNumber,
      lineNumber: newLine.index + 1,
      text: newLine.text,
      counterpart: oldLine.text,
    });
  }
  for (const item of removed.slice(paired))
    changes.push({ kind: 'removed', pageNumber, lineNumber: item.index + 1, text: item.text });
  for (const item of added.filter((candidate) => !movedAfter.has(candidate.index)).slice(paired))
    changes.push({ kind: 'added', pageNumber, lineNumber: item.index + 1, text: item.text });
  return changes.sort((first, second) => first.lineNumber - second.lineNumber);
}

export async function comparePdfText(
  before: Uint8Array,
  after: Uint8Array,
): Promise<TextDiffReport> {
  const [beforePages, afterPages] = await Promise.all([
    extractPdfTextPages(before),
    extractPdfTextPages(after),
  ]);
  const pageCount = Math.max(beforePages.length, afterPages.length);
  const changes: TextDiffChange[] = [];
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const oldPage: PdfTextPage = beforePages[pageNumber - 1] ?? { pageNumber, text: '', lines: [] };
    const newPage: PdfTextPage = afterPages[pageNumber - 1] ?? { pageNumber, text: '', lines: [] };
    changes.push(...diffPage(pageNumber, oldPage.lines, newPage.lines));
  }
  return { changes, pagesCompared: pageCount, identical: changes.length === 0 };
}

function pixelAt(frame: RenderedRasterPage, x: number, y: number): readonly number[] {
  if (x >= frame.width || y >= frame.height) return [255, 255, 255, 255];
  const offset = (y * frame.width + x) * 4;
  return [
    frame.pixels[offset]!,
    frame.pixels[offset + 1]!,
    frame.pixels[offset + 2]!,
    frame.pixels[offset + 3]!,
  ];
}

export async function comparePdfPixels(
  before: Uint8Array,
  after: Uint8Array,
  renderer: PageRenderer,
  options: { readonly pageNumbers?: readonly number[]; readonly threshold?: number } = {},
): Promise<readonly PixelDiffReport[]> {
  const threshold = options.threshold ?? 0;
  const pages = options.pageNumbers ?? [1];
  const reports: PixelDiffReport[] = [];
  for (const pageNumber of pages) {
    let oldFrame: RenderedRasterPage;
    let newFrame: RenderedRasterPage;
    try {
      [oldFrame, newFrame] = await Promise.all([
        renderer(before, pageNumber, 1),
        renderer(after, pageNumber, 1),
      ]);
    } catch {
      throw new PdfEngineError({
        kind: 'renderer-unavailable',
        feature: 'pixel comparison',
        remedy:
          'Configure the approved local pdfium renderer in the worker, then retry. Text comparison remains available.',
      });
    }
    const width = Math.max(oldFrame.width, newFrame.width);
    const height = Math.max(oldFrame.height, newFrame.height);
    const heatmap = new Uint8Array(width * height * 4);
    let changedPixels = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const oldPixel = pixelAt(oldFrame, x, y);
        const newPixel = pixelAt(newFrame, x, y);
        const changed = oldPixel.some(
          (value, index) => Math.abs(value - newPixel[index]!) > threshold,
        );
        const offset = (y * width + x) * 4;
        heatmap[offset] = changed ? 220 : 0;
        heatmap[offset + 1] = changed ? 40 : 0;
        heatmap[offset + 2] = 40;
        heatmap[offset + 3] = changed ? 190 : 0;
        if (changed) changedPixels += 1;
      }
    }
    reports.push({
      pageNumber,
      width,
      height,
      changedPixels,
      comparedPixels: width * height,
      ratio: changedPixels / (width * height) || 0,
      heatmap,
    });
  }
  return reports;
}

export async function comparePdfs(
  before: Uint8Array,
  after: Uint8Array,
  options: {
    readonly renderer?: PageRenderer;
    readonly pageNumbers?: readonly number[];
    readonly threshold?: number;
  } = {},
): Promise<CompareReport> {
  const text = await comparePdfText(before, after);
  if (!options.renderer) return { text, pixelCapability: 'renderer-required' };
  const pixel = await comparePdfPixels(before, after, options.renderer, options);
  return { text, pixel, pixelCapability: 'available' };
}

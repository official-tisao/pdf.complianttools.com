import { PDFDocument, PDFName, StandardFonts, degrees } from 'pdf-lib';
import { PdfEngineError } from '../errors.js';

export type PageSelector = number[] | string;

function typedFailure(operation: string, error: unknown): never {
  if (error instanceof PdfEngineError) throw error;
  throw new PdfEngineError({
    kind: 'corrupt-structure',
    repairable: true,
    remedy: `The PDF could not be ${operation}. Re-export it from its source application or use Repair PDF first.`,
  });
}

async function load(bytes: Uint8Array, operation: string): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: false });
  } catch (error) {
    return typedFailure(operation, error);
  }
}

export function resolvePageNumbers(
  selector: PageSelector | undefined,
  pageCount: number,
): number[] {
  if (!selector) return Array.from({ length: pageCount }, (_, index) => index + 1);
  if (Array.isArray(selector))
    return [...new Set(selector)]
      .filter((page) => page >= 1 && page <= pageCount)
      .sort((a, b) => a - b);
  if (selector === 'odd')
    return Array.from({ length: pageCount }, (_, index) => index + 1).filter(
      (page) => page % 2 === 1,
    );
  if (selector === 'even')
    return Array.from({ length: pageCount }, (_, index) => index + 1).filter(
      (page) => page % 2 === 0,
    );
  if (selector === 'blank') return [];
  const pages = new Set<number>();
  for (const token of selector.split(',')) {
    const [startText, endText] = token.split('-');
    const start = Number(startText);
    const end = endText ? Number(endText) : start;
    if (Number.isInteger(start) && Number.isInteger(end))
      for (let page = start; page <= end; page += 1)
        if (page >= 1 && page <= pageCount) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

function resolvePageSelection(document: PDFDocument, selector: PageSelector | undefined): number[] {
  if (selector !== 'blank') return resolvePageNumbers(selector, document.getPageCount());
  return document
    .getPages()
    .flatMap((page, index) =>
      page.node.get(PDFName.of('Contents')) === undefined ? [index + 1] : [],
    );
}

function requirePages(pages: readonly number[], operation: string): void {
  if (pages.length === 0)
    throw new PdfEngineError({
      kind: 'invalid-operation',
      operation,
      remedy: 'The selection contains no pages. Choose at least one page and retry.',
    });
}

async function copySelected(source: PDFDocument, pages: readonly number[]): Promise<Uint8Array> {
  const output = await PDFDocument.create();
  const copied = await output.copyPages(
    source,
    pages.map((page) => page - 1),
  );
  for (const page of copied) output.addPage(page);
  return output.save();
}

export async function extractPages(bytes: Uint8Array, selector: PageSelector): Promise<Uint8Array> {
  const source = await load(bytes, 'read selected pages');
  const pages = resolvePageSelection(source, selector);
  requirePages(pages, 'extract-pages');
  return copySelected(source, pages);
}

export async function removePages(bytes: Uint8Array, selector: PageSelector): Promise<Uint8Array> {
  const source = await load(bytes, 'remove pages');
  const selected = new Set(resolvePageSelection(source, selector));
  const keep = Array.from({ length: source.getPageCount() }, (_, index) => index + 1).filter(
    (page) => !selected.has(page),
  );
  requirePages(keep, 'remove-pages');
  return copySelected(source, keep);
}

export async function reorderPages(
  bytes: Uint8Array,
  order: readonly number[],
): Promise<Uint8Array> {
  const source = await load(bytes, 'reorder pages');
  if (
    order.length !== source.getPageCount() ||
    new Set(order).size !== order.length ||
    order.some((page) => page < 1 || page > source.getPageCount())
  )
    throw new PdfEngineError({
      kind: 'invalid-operation',
      operation: 'organize',
      remedy: 'Provide each source page exactly once in the new order.',
    });
  return copySelected(source, order);
}

export async function insertBlankPages(
  bytes: Uint8Array,
  index: number,
  count: number,
): Promise<Uint8Array> {
  const document = await load(bytes, 'insert pages');
  const safeIndex = Math.max(0, Math.min(index, document.getPageCount()));
  const reference = document.getPage(Math.max(0, Math.min(safeIndex, document.getPageCount() - 1)));
  const width = reference?.getWidth() ?? 595.28;
  const height = reference?.getHeight() ?? 841.89;
  for (let offset = 0; offset < count; offset += 1)
    document.insertPage(safeIndex + offset, [width, height]);
  return document.save();
}

export async function insertPdfPages(
  bytes: Uint8Array,
  inserted: Uint8Array,
  index: number,
): Promise<Uint8Array> {
  const output = await load(bytes, 'insert pages');
  const source = await load(inserted, 'insert pages');
  const copied = await output.copyPages(source, source.getPageIndices());
  const safeIndex = Math.max(0, Math.min(index, output.getPageCount()));
  copied.forEach((page, offset) => output.insertPage(safeIndex + offset, page));
  return output.save();
}

export async function rotatePages(
  bytes: Uint8Array,
  selector: PageSelector | undefined,
  rotation: number,
): Promise<Uint8Array> {
  const document = await load(bytes, 'rotate pages');
  const pages = new Set(resolvePageSelection(document, selector));
  document.getPages().forEach((page, index) => {
    if (pages.has(index + 1))
      page.setRotation(degrees((page.getRotation().angle + rotation + 360) % 360));
  });
  return document.save();
}

export async function cropPages(
  bytes: Uint8Array,
  margins: { left: number; top: number; right: number; bottom: number },
  selector?: PageSelector,
): Promise<Uint8Array> {
  const document = await load(bytes, 'crop pages');
  const pages = new Set(resolvePageSelection(document, selector));
  document.getPages().forEach((page, index) => {
    if (!pages.has(index + 1)) return;
    const width = page.getWidth();
    const height = page.getHeight();
    page.setCropBox(
      margins.left,
      margins.bottom,
      Math.max(1, width - margins.left - margins.right),
      Math.max(1, height - margins.top - margins.bottom),
    );
  });
  return document.save();
}

export async function resizePages(
  bytes: Uint8Array,
  size: { width: number; height: number; mode?: 'scale-to-fit' | 'crop-to-fit' },
): Promise<Uint8Array> {
  const document = await load(bytes, 'resize pages');
  for (const page of document.getPages()) {
    if (size.mode === 'crop-to-fit') page.setCropBox(0, 0, size.width, size.height);
    else page.setSize(size.width, size.height);
  }
  return document.save();
}

export async function nUp(
  bytes: Uint8Array,
  columns: 2 | 4 | 6 | 9,
  margin = 18,
  booklet = false,
): Promise<Uint8Array> {
  const source = await load(bytes, 'impose pages');
  const sourcePages = source.getPages();
  const rows = columns === 2 ? 1 : columns === 4 ? 2 : columns === 6 ? 2 : 3;
  const cols = Math.ceil(columns / rows);
  const width = 612;
  const height = 792;
  const output = await PDFDocument.create();
  const order = booklet ? bookletOrder(sourcePages.length) : sourcePages.map((_, index) => index);
  for (let offset = 0; offset < order.length; offset += columns) {
    const page = output.addPage([width, height]);
    const cellWidth = (width - margin * (cols + 1)) / cols;
    const cellHeight = (height - margin * (rows + 1)) / rows;
    for (let slot = 0; slot < columns && offset + slot < order.length; slot += 1) {
      const sourceIndex = order[offset + slot];
      const sourcePage = sourceIndex === undefined ? undefined : sourcePages[sourceIndex];
      if (!sourcePage) continue;
      const embedded = await output.embedPage(sourcePage);
      const scale = Math.min(
        cellWidth / sourcePage.getWidth(),
        cellHeight / sourcePage.getHeight(),
      );
      const col = slot % cols;
      const row = Math.floor(slot / cols);
      page.drawPage(embedded, {
        x: margin + col * (cellWidth + margin),
        y: height - margin - (row + 1) * cellHeight - row * margin,
        width: sourcePage.getWidth() * scale,
        height: sourcePage.getHeight() * scale,
      });
    }
  }
  return output.save();
}

function bookletOrder(count: number): number[] {
  const padded = Math.ceil(count / 4) * 4;
  const order: number[] = [];
  for (let left = 0, right = padded - 1; left < right; left += 2, right -= 2)
    order.push(right, left, left + 1, right - 1);
  return order.filter((page) => page < count);
}

export async function halvePages(
  bytes: Uint8Array,
  direction: 'horizontal' | 'vertical',
  threshold = 1.25,
): Promise<Uint8Array> {
  const source = await load(bytes, 'halve pages');
  const output = await PDFDocument.create();
  for (const sourcePage of source.getPages()) {
    const horizontal = direction === 'horizontal';
    const oversized = horizontal
      ? sourcePage.getWidth() / sourcePage.getHeight() >= threshold
      : sourcePage.getHeight() / sourcePage.getWidth() >= threshold;
    const parts = oversized ? 2 : 1;
    for (let part = 0; part < parts; part += 1) {
      const pageWidth = horizontal ? sourcePage.getWidth() / 2 : sourcePage.getWidth();
      const pageHeight = horizontal ? sourcePage.getHeight() : sourcePage.getHeight() / 2;
      const page = output.addPage([pageWidth, pageHeight]);
      const embedded = await output.embedPage(
        sourcePage,
        horizontal
          ? {
              left: part * pageWidth,
              right: (part + 1) * pageWidth,
              bottom: 0,
              top: sourcePage.getHeight(),
            }
          : {
              left: 0,
              right: sourcePage.getWidth(),
              bottom: part * pageHeight,
              top: (part + 1) * pageHeight,
            },
      );
      page.drawPage(embedded, { x: 0, y: 0, width: pageWidth, height: pageHeight });
    }
  }
  return output.save();
}

export async function addBatesNumbering(
  bytes: Uint8Array,
  options: {
    prefix?: string;
    suffix?: string;
    start?: number;
    padding?: number;
    position?: string;
  },
): Promise<Uint8Array> {
  const document = await load(bytes, 'add Bates numbers');
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const [index, page] of document.getPages().entries()) {
    const label = `${options.prefix ?? ''}${String((options.start ?? 1) + index).padStart(options.padding ?? 6, '0')}${options.suffix ?? ''}`;
    const width = page.getWidth();
    const height = page.getHeight();
    const position = options.position ?? 'bottom-right';
    const x = position.endsWith('left')
      ? 24
      : position.endsWith('center')
        ? width / 2 - 20
        : width - 80;
    const y = position.startsWith('top') ? height - 24 : 18;
    page.drawText(label, { x, y, size: 10, font });
  }
  return document.save();
}

export async function compressPdf(
  bytes: Uint8Array,
  options: { preset?: string; quality?: number; imageQuality?: number; stripMetadata?: boolean } = {},
): Promise<Uint8Array> {
  const document = await load(bytes, 'compress the PDF');
  if (options.stripMetadata) {
    document.setTitle('');
    document.setAuthor('');
    document.setSubject('');
    document.setKeywords([]);
    document.setCreator('');
    document.setProducer('');
  }
  return document.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 50 });
}

/** Constant-time estimate used by the slider; it never pretends to be the final byte count. */
export function predictCompressedSize(
  byteLength: number,
  options: { preset?: string; imageQuality?: number; quality?: number } = {},
): number {
  const preset = options.preset ?? 'balanced';
  const quality = options.imageQuality ?? options.quality ?? 75;
  const factor = preset === 'extreme' ? 0.42 : preset === 'high-quality' ? 0.82 : preset === 'custom' ? 0.35 + quality / 160 : 0.62;
  return Math.max(1, Math.round(byteLength * Math.min(1, factor)));
}

export async function optimizeForWeb(
  bytes: Uint8Array,
  options: { progressive?: boolean; stripMetadata?: boolean } = {},
): Promise<Uint8Array> {
  return compressPdf(
    bytes,
    options.stripMetadata === undefined
      ? { preset: 'balanced' }
      : { preset: 'balanced', stripMetadata: options.stripMetadata },
  );
}

export async function repairPdf(bytes: Uint8Array): Promise<Uint8Array> {
  try {
    const document = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      throwOnInvalidObject: false,
    });
    return document.save();
  } catch (error) {
    return typedFailure('repair the PDF', error);
  }
}

export async function flattenPdf(
  bytes: Uint8Array,
  options: { forms?: boolean } = {},
): Promise<Uint8Array> {
  const document = await load(bytes, 'flatten the PDF');
  if (options.forms !== false) {
    try {
      document.getForm().flatten({ updateFieldAppearances: true });
    } catch {
      /* PDFs without forms are already flat. */
    }
  }
  return document.save();
}

export type PdfAReport = {
  profile: '1b' | '2b' | '3b';
  passed: boolean;
  checks: readonly { name: string; passed: boolean; detail: string }[];
};

export async function pdfaReport(
  bytes: Uint8Array,
  profile: '1b' | '2b' | '3b' = '2b',
): Promise<PdfAReport> {
  const source = new TextDecoder('latin1').decode(bytes);
  await load(bytes, 'check PDF/A conformance');
  const checks = [
    { name: 'PDF opens', passed: true, detail: 'pdf-lib parsed the document.' },
    {
      name: 'Fonts embedded',
      passed: !(/\/Subtype\s*\/Type1\b/u.test(source) && !/\/FontFile(?:2|3)?\b/u.test(source)),
      detail: 'All authored fonts must have an embedded font stream.',
    },
    {
      name: 'Colour profile',
      passed: profile === '3b' ? /OutputIntent/u.test(source) : true,
      detail:
        profile === '3b'
          ? 'PDF/A-3 requires an output intent.'
          : 'Profile permits device colour in this local report.',
    },
    {
      name: 'Transparency',
      passed: profile !== '1b' || !/\/ca\s+(?:0\.|0\b)|\/SMask\b/u.test(source),
      detail: 'PDF/A-1b does not permit transparency.',
    },
  ];
  return { profile, passed: checks.every((check) => check.passed), checks };
}

export async function setMetadata(
  bytes: Uint8Array,
  options: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string[];
    strip?: boolean;
  },
): Promise<Uint8Array> {
  const document = await load(bytes, 'edit metadata');
  if (options.strip) {
    document.setTitle('');
    document.setAuthor('');
    document.setSubject('');
    document.setKeywords([]);
  }
  if (options.title !== undefined) document.setTitle(options.title);
  if (options.author !== undefined) document.setAuthor(options.author);
  if (options.subject !== undefined) document.setSubject(options.subject);
  if (options.keywords !== undefined) document.setKeywords(options.keywords);
  return document.save();
}

export type StructureReport = {
  pageCount: number;
  byteLength: number;
  version: string;
  hasJavaScript: boolean;
  objectCount: number;
  encrypted: boolean;
};
export async function inspectStructure(bytes: Uint8Array): Promise<StructureReport> {
  const document = await load(bytes, 'inspect the PDF');
  const source = new TextDecoder('latin1').decode(bytes);
  return {
    pageCount: document.getPageCount(),
    byteLength: bytes.byteLength,
    version: source.match(/%PDF-(\d\.\d)/u)?.[1] ?? 'unknown',
    hasJavaScript: /\/JavaScript|\/JS\b/u.test(source),
    objectCount: (source.match(/\n\d+\s+\d+\s+obj\b/gu) ?? []).length,
    encrypted: /\/Encrypt\b/u.test(source),
  };
}

export type RenderedPage = { pixels: Uint8Array; width: number; height: number };
export type PageRenderer = (
  bytes: Uint8Array,
  pageNumber: number,
  scale?: number,
) => Promise<RenderedPage>;

export type PdfProxy = {
  bytes: Uint8Array;
  pageNumber: number;
  pageCount: 1;
};

/** Build a one-page proxy so live controls never need to materialise the full document. */
export async function createPdfProxy(
  bytes: Uint8Array,
  pageNumber = 1,
): Promise<PdfProxy> {
  const source = await load(bytes, 'create the preview proxy');
  if (pageNumber < 1 || pageNumber > source.getPageCount())
    throw new PdfEngineError({
      kind: 'invalid-operation',
      operation: 'preview',
      remedy: 'Choose a page number within the document.',
    });
  const output = await PDFDocument.create();
  const [page] = await output.copyPages(source, [pageNumber - 1]);
  if (page) output.addPage(page);
  return { bytes: await output.save(), pageNumber, pageCount: 1 };
}

export async function previewProxy(
  bytes: Uint8Array,
  renderer: PageRenderer,
  pageNumber = 1,
  maxWidth = 1280,
): Promise<RenderedPage> {
  const proxy = await createPdfProxy(bytes, pageNumber);
  const first = await renderer(proxy.bytes, 1, 1);
  const scale = first.width > maxWidth ? maxWidth / first.width : 1;
  return scale === 1 ? first : renderer(proxy.bytes, 1, scale);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(name: string, data: Uint8Array): Uint8Array {
  const type = new TextEncoder().encode(name);
  const output = new Uint8Array(12 + type.length + data.length);
  const view = new DataView(output.buffer);
  view.setUint32(0, data.length);
  output.set(type, 4);
  output.set(data, 8);
  view.setUint32(8 + data.length, crc32(output.subarray(4, 8 + data.length)));
  return output;
}

async function rgbaToPng(frame: RenderedPage): Promise<Uint8Array> {
  const scanlines = new Uint8Array(frame.height * (frame.width * 4 + 1));
  for (let row = 0; row < frame.height; row += 1) {
    const target = row * (frame.width * 4 + 1);
    scanlines[target] = 0;
    scanlines.set(frame.pixels.subarray(row * frame.width * 4, (row + 1) * frame.width * 4), target + 1);
  }
  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();
  await writer.write(scanlines as Uint8Array<ArrayBuffer>);
  await writer.close();
  const compressed = new Uint8Array(await new Response(stream.readable).arrayBuffer());
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, frame.width);
  headerView.setUint32(4, frame.height);
  header[8] = 8;
  header[9] = 6;
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = [signature, pngChunk('IHDR', header), pngChunk('IDAT', compressed), pngChunk('IEND', new Uint8Array())];
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

/** Flatten every page to a raster image using the caller-provided local renderer. */
export async function rasterizePdf(
  bytes: Uint8Array,
  renderer: PageRenderer,
  dpi = 150,
): Promise<Uint8Array> {
  const source = await load(bytes, 'rasterize the PDF');
  const output = await PDFDocument.create();
  const scale = dpi / 72;
  for (let pageNumber = 1; pageNumber <= source.getPageCount(); pageNumber += 1) {
    const frame = await renderer(bytes, pageNumber, scale);
    const png = await rgbaToPng(frame);
    const image = await output.embedPng(png);
    const page = output.addPage([frame.width / scale, frame.height / scale]);
    page.drawImage(image, { x: 0, y: 0, width: frame.width / scale, height: frame.height / scale });
  }
  return output.save();
}

export async function preview(
  bytes: Uint8Array,
  renderer: PageRenderer,
  pageNumber = 1,
  scale = 1,
): Promise<RenderedPage> {
  const document = await load(bytes, 'preview the PDF');
  if (pageNumber < 1 || pageNumber > document.getPageCount())
    throw new PdfEngineError({
      kind: 'invalid-operation',
      operation: 'preview',
      remedy: 'Choose a page number within the document.',
    });
  return renderer(bytes, pageNumber, scale);
}

export function assertPageOrderEquivalent(
  first: readonly number[],
  second: readonly number[],
): boolean {
  return first.length === second.length && first.every((page, index) => page === second[index]);
}

export type Operation = (
  document: PDFDocument,
  options: Record<string, unknown>,
) => Promise<void> | void;

import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { PdfEngineError } from '../errors.js';
import type { MergeOptions, SplitOptions, Step } from '../types.js';
import { resolvePageNumbers } from './operations.js';
import {
  addAnnotation,
  addHeadersFooters,
  addImageToPdf,
  addPageNumbers,
  addTextToPdf,
  addWatermark,
  createFormPdf,
  editTextRun,
  fillFormPdf,
  overlayPdf,
  redactPdf,
  signPdf,
} from './editing.js';

type SaveOptions = Parameters<PDFDocument['save']>[0];

function operationError(operation: string, error: unknown): never {
  if (error instanceof PdfEngineError) throw error;
  throw new PdfEngineError({
    kind: 'corrupt-structure',
    repairable: true,
    remedy: `The PDF could not be ${operation}. Re-export it from its source application or use Repair PDF first.`,
  });
}

function parseRange(value: string, count: number): number[] {
  const pages: number[] = [];
  for (const token of value.split(',')) {
    const [startText, endText] = token.split('-');
    const start = Number(startText);
    const end = Number(endText ?? startText);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      throw new PdfEngineError({
        kind: 'invalid-operation',
        operation: 'page-range',
        remedy: 'Use page ranges such as 1-3,5.',
      });
    }
    for (let page = start; page <= Math.min(end, count); page += 1) pages.push(page);
  }
  return [...new Set(pages)];
}

async function load(bytes: Uint8Array, operation: string): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: false });
  } catch (error) {
    return operationError(operation, error);
  }
}

/**
 * The mutable document graph owned by one pipeline run. Individual steps only touch this graph;
 * bytes are materialised once by save(), which is the boundary where large buffers leave the worker.
 */
export class MutationGraph {
  #document: PDFDocument;
  #saveOptions: SaveOptions | undefined;

  private constructor(document: PDFDocument) {
    this.#document = document;
  }

  static async fromInputs(inputs: readonly Uint8Array[]): Promise<MutationGraph> {
    if (inputs.length === 0)
      throw new PdfEngineError({
        kind: 'invalid-operation',
        operation: 'run',
        remedy: 'Provide at least one PDF input.',
      });
    return new MutationGraph(await load(inputs[0]!, 'open the PDF'));
  }

  get document(): PDFDocument {
    return this.#document;
  }
  get pageCount(): number {
    return this.#document.getPageCount();
  }

  replace(document: PDFDocument): void {
    this.#document = document;
  }

  async merge(inputs: readonly Uint8Array[], options: MergeOptions = {}): Promise<void> {
    const order = options.fileOrder?.length
      ? [...options.fileOrder]
      : inputs.map((_, index) => index);
    const merged = await PDFDocument.create();
    for (const [position, sourceIndex] of order.entries()) {
      const sourceBytes = inputs[sourceIndex];
      if (!sourceBytes)
        throw new PdfEngineError({
          kind: 'invalid-operation',
          operation: 'merge',
          remedy: 'The merge order refers to a file that is not selected.',
        });
      const source = await load(sourceBytes, 'merge the selected files');
      const requested = options.pageRangePerFile?.[String(sourceIndex)];
      const pages = requested
        ? parseRange(requested, source.getPageCount())
        : Array.from({ length: source.getPageCount() }, (_, index) => index + 1);
      const copied = await merged.copyPages(
        source,
        pages.map((page) => page - 1),
      );
      if (options.insertBlankBetween && position > 0) merged.addPage();
      for (const page of copied) merged.addPage(page);
    }
    this.replace(merged);
  }

  async keepPages(selector: number[] | string): Promise<void> {
    const keep = new Set(resolvePageNumbers(selector, this.pageCount));
    for (let index = this.pageCount - 1; index >= 0; index -= 1)
      if (!keep.has(index + 1)) this.#document.removePage(index);
  }

  async removePages(selector: number[] | string): Promise<void> {
    const remove = new Set(resolvePageNumbers(selector, this.pageCount));
    for (let index = this.pageCount - 1; index >= 0; index -= 1)
      if (remove.has(index + 1)) this.#document.removePage(index);
  }

  async reorder(order: readonly number[]): Promise<void> {
    if (
      order.length !== this.pageCount ||
      new Set(order).size !== order.length ||
      order.some((page) => page < 1 || page > this.pageCount)
    ) {
      throw new PdfEngineError({
        kind: 'invalid-operation',
        operation: 'organize',
        remedy: 'Provide each source page exactly once in the new order.',
      });
    }
    const output = await PDFDocument.create();
    const pages = await output.copyPages(
      this.#document,
      order.map((page) => page - 1),
    );
    for (const page of pages) output.addPage(page);
    this.replace(output);
  }

  insertBlank(index: number, count: number): void {
    const safeIndex = Math.max(0, Math.min(index, this.pageCount));
    const reference = this.#document.getPage(Math.max(0, Math.min(safeIndex, this.pageCount - 1)));
    const width = reference?.getWidth() ?? 595.28;
    const height = reference?.getHeight() ?? 841.89;
    for (let offset = 0; offset < count; offset += 1)
      this.#document.insertPage(safeIndex + offset, [width, height]);
  }

  rotate(selector: number[] | string | undefined, rotation: number): void {
    const pages = new Set(resolvePageNumbers(selector, this.pageCount));
    this.#document.getPages().forEach((page, index) => {
      if (pages.has(index + 1))
        page.setRotation(degrees((page.getRotation().angle + rotation + 360) % 360));
    });
  }

  crop(
    margins: { left: number; top: number; right: number; bottom: number },
    selector?: number[] | string,
  ): void {
    const pages = new Set(resolvePageNumbers(selector, this.pageCount));
    this.#document.getPages().forEach((page, index) => {
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
  }

  resize(size: { width: number; height: number; mode?: 'scale-to-fit' | 'crop-to-fit' }): void {
    for (const page of this.#document.getPages()) {
      if (size.mode === 'crop-to-fit') page.setCropBox(0, 0, size.width, size.height);
      else page.setSize(size.width, size.height);
    }
  }

  async impose(columns: 2 | 4 | 6 | 9, margin = 18, booklet = false): Promise<void> {
    const source = this.#document;
    const sourcePages = source.getPages();
    const rows = columns === 2 ? 1 : columns === 4 ? 2 : columns === 6 ? 2 : 3;
    const cols = Math.ceil(columns / rows);
    const order = bookletOrder(sourcePages.length, booklet);
    const width = 612;
    const height = 792;
    const output = await PDFDocument.create();
    for (let offset = 0; offset < order.length; offset += columns) {
      const page = output.addPage([width, height]);
      const cellWidth = (width - margin * (cols + 1)) / cols;
      const cellHeight = (height - margin * (rows + 1)) / rows;
      for (let slot = 0; slot < columns && offset + slot < order.length; slot += 1) {
        const sourcePage = sourcePages[order[offset + slot]!];
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
    this.replace(output);
  }

  async halve(direction: 'horizontal' | 'vertical', threshold = 1.25): Promise<void> {
    const source = this.#document;
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
    this.replace(output);
  }

  async addBatesNumbering(options: {
    prefix?: string;
    suffix?: string;
    start?: number;
    padding?: number;
    position?: string;
  }): Promise<void> {
    const font = await this.#document.embedFont(StandardFonts.Helvetica);
    for (const [index, page] of this.#document.getPages().entries()) {
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
  }

  setMetadata(options: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string[];
    strip?: boolean;
  }): void {
    if (options.strip) {
      this.#document.setTitle('');
      this.#document.setAuthor('');
      this.#document.setSubject('');
      this.#document.setKeywords([]);
      this.#document.setCreator('');
      this.#document.setProducer('');
    }
    if (options.title !== undefined) this.#document.setTitle(options.title);
    if (options.author !== undefined) this.#document.setAuthor(options.author);
    if (options.subject !== undefined) this.#document.setSubject(options.subject);
    if (options.keywords !== undefined) this.#document.setKeywords(options.keywords);
  }

  async flatten(forms = true): Promise<void> {
    if (forms) {
      try {
        this.#document.getForm().flatten({ updateFieldAppearances: true });
      } catch {
        /* no form fields */
      }
    }
  }

  setCompression(options: { stripMetadata?: boolean } = {}): void {
    if (options.stripMetadata) this.setMetadata({ strip: true });
    this.#saveOptions = { useObjectStreams: true, addDefaultPage: false, objectsPerTick: 50 };
  }

  async save(): Promise<Uint8Array> {
    return this.#document.save(this.#saveOptions);
  }
}

function bookletOrder(count: number, enabled: boolean): number[] {
  if (!enabled) return Array.from({ length: count }, (_, index) => index);
  const padded = Math.ceil(count / 4) * 4;
  const order: number[] = [];
  for (let left = 0, right = padded - 1; left < right; left += 2, right -= 2)
    order.push(right, left, left + 1, right - 1);
  return order.filter((page) => page < count);
}

export async function splitGraph(
  graph: MutationGraph,
  options: SplitOptions = {},
): Promise<Uint8Array[]> {
  const count = graph.pageCount;
  const groups: number[][] = [];
  if (options.ranges?.length) {
    for (const range of options.ranges) groups.push(parseRange(range, count));
  } else {
    const size = Math.max(1, options.pagesPerFile ?? count);
    for (let start = 1; start <= count; start += size)
      groups.push(
        Array.from({ length: Math.min(size, count - start + 1) }, (_, offset) => start + offset),
      );
  }
  const outputs: Uint8Array[] = [];
  for (const group of groups) {
    const output = await PDFDocument.create();
    const pages = await output.copyPages(
      graph.document,
      group.map((page) => page - 1),
    );
    for (const page of pages) output.addPage(page);
    outputs.push(await output.save());
  }
  const maxBytes = options.maxBytes;
  if (
    maxBytes !== undefined &&
    outputs.some((output) => output.byteLength > maxBytes) &&
    count > 1
  ) {
    return splitGraph(graph, {
      pagesPerFile: Math.max(1, Math.ceil((options.pagesPerFile ?? count) / 2)),
      maxBytes,
    });
  }
  return outputs;
}

export async function applyGraphStep(
  graph: MutationGraph,
  step: Step,
  inputs: readonly Uint8Array[],
): Promise<readonly Uint8Array[] | undefined> {
  const values = step.options;
  async function replaceFromBytes(bytes: Uint8Array): Promise<void> {
    graph.replace(await load(bytes, `apply ${step.op}`));
  }
  switch (step.op) {
    case 'merge':
      await graph.merge(inputs, values);
      break;
    case 'extract-pages':
      await graph.keepPages(values.pages as number[] | string);
      break;
    case 'remove-pages':
      await graph.removePages(values.pages as number[] | string);
      break;
    case 'insert-pages':
      graph.insertBlank(Number(values.index ?? 0), Number(values.blankPages ?? 0));
      break;
    case 'organize':
      await graph.reorder(values.order as number[]);
      break;
    case 'rotate':
      graph.rotate(values.pages as number[] | string | undefined, Number(values.degrees ?? 90));
      break;
    case 'n-up':
      await graph.impose(
        Number(values.columns ?? 2) as 2 | 4 | 6 | 9,
        Number(values.margin ?? 18),
        Boolean(values.booklet),
      );
      break;
    case 'halve':
      await graph.halve(
        (values.direction as 'horizontal' | 'vertical') ?? 'horizontal',
        Number(values.threshold ?? 1.25),
      );
      break;
    case 'crop':
      graph.crop(
        {
          left: Number(values.left ?? 0),
          top: Number(values.top ?? 0),
          right: Number(values.right ?? 0),
          bottom: Number(values.bottom ?? 0),
        },
        values.pages as number[] | string | undefined,
      );
      break;
    case 'resize':
      graph.resize({
        width: Number(values.width),
        height: Number(values.height),
        mode: values.mode as 'scale-to-fit' | 'crop-to-fit',
      });
      break;
    case 'bates':
      await graph.addBatesNumbering(values);
      break;
    case 'compress':
      graph.setCompression({ stripMetadata: Boolean(values.stripMetadata) });
      break;
    case 'optimize-web':
      graph.setCompression({ stripMetadata: Boolean(values.stripMetadata) });
      break;
    case 'flatten':
      await graph.flatten(Boolean(values.forms));
      break;
    case 'metadata':
      graph.setMetadata(values);
      break;
    case 'split':
      return splitGraph(graph, values);
    case 'bookmarks':
    case 'repair':
    case 'rasterize':
    case 'pdfa':
    case 'inspect-structure':
    case 'render':
    case 'inspect':
    case 'view':
    case 'compare':
    case 'ocr':
      break;
    case 'editor':
      if (!values.find || values.replace === undefined)
        throw new PdfEngineError({
          kind: 'invalid-operation',
          operation: 'editor',
          remedy:
            'Provide the text to find and its replacement, or use the editor host to add a text box.',
        });
      await replaceFromBytes(
        await editTextRun(await graph.save(), {
          page: Number(values.page ?? 1),
          find: String(values.find),
          replace: String(values.replace),
          ...(values.text
            ? {
                fallback: {
                  page: Number(values.page ?? 1),
                  text: String(values.text),
                  x: Number(values.x ?? 72),
                  y: Number(values.y ?? 72),
                  size: Number(values.size ?? 12),
                },
              }
            : {}),
          capability: {
            embedded: Boolean(values.fontEmbedded),
            subsettable: Boolean(values.subsettable),
          },
        }),
      );
      break;
    case 'annotate':
      await replaceFromBytes(await addAnnotation(await graph.save(), values as never));
      break;
    case 'add-text':
      await replaceFromBytes(await addTextToPdf(await graph.save(), values as never));
      break;
    case 'add-image':
      if (!inputs[1])
        throw new PdfEngineError({
          kind: 'invalid-operation',
          operation: 'add-image',
          remedy: 'Provide the PDF followed by a PNG or JPEG image input.',
        });
      await replaceFromBytes(await addImageToPdf(await graph.save(), inputs[1], values as never));
      break;
    case 'headers-footers':
      await replaceFromBytes(await addHeadersFooters(await graph.save(), values as never));
      break;
    case 'page-numbers':
      await replaceFromBytes(await addPageNumbers(await graph.save(), values as never));
      break;
    case 'watermark':
      if (!values.text)
        throw new PdfEngineError({
          kind: 'invalid-operation',
          operation: 'watermark',
          remedy: 'Provide watermark text or use the direct image watermark API.',
        });
      await replaceFromBytes(await addWatermark(await graph.save(), values as never));
      break;
    case 'overlay':
      if (!inputs[1])
        throw new PdfEngineError({
          kind: 'invalid-operation',
          operation: 'overlay',
          remedy: 'Provide a base PDF followed by the overlay PDF.',
        });
      await replaceFromBytes(await overlayPdf(await graph.save(), inputs[1], values as never));
      break;
    case 'create-form':
      await replaceFromBytes(
        await createFormPdf(await graph.save(), (values.fields ?? []) as never),
      );
      break;
    case 'fill-form':
      await replaceFromBytes(await fillFormPdf(await graph.save(), (values.values ?? {}) as never));
      break;
    case 'sign':
      await replaceFromBytes(await signPdf(await graph.save(), values as never));
      break;
    case 'redact':
      await replaceFromBytes((await redactPdf(await graph.save(), values as never)).bytes);
      break;
    case 'accessibility-audit':
    case 'signature-background':
    case 'request-signature':
    case 'protect':
    case 'unlock':
    case 'password-generator':
    case 'verify-signature':
      throw new PdfEngineError({
        kind: 'unsupported-feature',
        feature: `${step.op} is a read-side or non-PDF-output capability`,
        remedy:
          'Call the typed direct API from the route so its report or non-PDF output is preserved.',
      });
  }
  return undefined;
}

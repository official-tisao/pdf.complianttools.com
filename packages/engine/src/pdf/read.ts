import type { DocMeta } from '../types.js';
import type { EngineError } from '../errors.js';
import { runInModuleWorker } from '../runtime/module-worker.js';
import { extractPdfTextPages } from '../conversion/pdf-text.js';

export type PdfOutlineItem = {
  readonly title: string;
  readonly pageNumber?: number;
  readonly url?: string;
  readonly items: readonly PdfOutlineItem[];
};

export type PdfSearchMatch = {
  readonly pageNumber: number;
  readonly index: number;
  readonly length: number;
  readonly context: string;
};

export async function inspectWithPdfJs(bytes: Uint8Array): Promise<DocMeta> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({ data: bytes.slice() });
  const document = await loadingTask.promise;
  const pageCount = document.numPages;
  const firstPage = pageCount > 0 ? await document.getPage(1) : undefined;
  const text = firstPage ? await firstPage.getTextContent() : undefined;
  await loadingTask.destroy();
  return {
    pageCount,
    byteLength: bytes.byteLength,
    encrypted: false,
    hasText: Boolean(text && text.items.length > 0),
  };
}

export type PdfInspection = { ok: true; meta: DocMeta } | { ok: false; error: EngineError };

/** Parse untrusted PDF input into a stable success or typed error result. */
export async function classifyPdfInput(bytes: Uint8Array): Promise<PdfInspection> {
  const source = new TextDecoder('latin1').decode(bytes);

  if (/\/JavaScript|\/JS\b/.test(source)) {
    return {
      ok: false,
      error: {
        kind: 'unsupported-feature',
        feature: 'PDF JavaScript',
        remedy: 'Remove active content and retry with a static PDF.',
      },
    };
  }

  if (bytes.byteLength > 16 * 1024 * 1024 || /\/Count\s+\d{7,}/.test(source)) {
    return {
      ok: false,
      error: {
        kind: 'corrupt-structure',
        repairable: false,
        remedy: 'Use a smaller document or split the operation into smaller batches.',
      },
    };
  }

  try {
    return { ok: true, meta: await inspectWithPdfJs(bytes) };
  } catch {
    return {
      ok: false,
      error: {
        kind: 'corrupt-structure',
        repairable: true,
        remedy: 'Re-export the PDF from its source application and retry.',
      },
    };
  }
}

export async function getPdfJsPageDimensions(
  bytes: Uint8Array,
  pageNumber = 1,
): Promise<{ width: number; height: number }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({ data: bytes.slice() });
  const document = await loadingTask.promise;
  const page = await document.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  await loadingTask.destroy();
  return { width: Math.ceil(viewport.width), height: Math.ceil(viewport.height) };
}

/** Find case-insensitive selectable-text matches without modifying the source PDF. */
export async function searchPdfText(
  bytes: Uint8Array,
  query: string,
): Promise<readonly PdfSearchMatch[]> {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [];
  const pages = await extractPdfTextPages(bytes);
  const matches: PdfSearchMatch[] = [];
  for (const page of pages) {
    const haystack = page.text.toLocaleLowerCase();
    let index = haystack.indexOf(normalizedQuery);
    while (index >= 0) {
      matches.push({
        pageNumber: page.pageNumber,
        index,
        length: normalizedQuery.length,
        context: page.text.slice(Math.max(0, index - 40), index + normalizedQuery.length + 40),
      });
      index = haystack.indexOf(normalizedQuery, index + normalizedQuery.length);
    }
  }
  return matches;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

async function resolveOutlineDestination(
  document: {
    getPageIndex: (ref: unknown) => Promise<number>;
    getDestination: (name: string) => Promise<unknown>;
  },
  destination: unknown,
): Promise<number | undefined> {
  const resolved =
    typeof destination === 'string' ? await document.getDestination(destination) : destination;
  if (!Array.isArray(resolved) || resolved.length === 0) return undefined;
  try {
    const pageIndex = await document.getPageIndex(resolved[0]);
    return pageIndex + 1;
  } catch {
    return undefined;
  }
}

/** Read outline entries and resolve their destinations to one-based page numbers. */
export async function getPdfOutline(bytes: Uint8Array): Promise<readonly PdfOutlineItem[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({ data: bytes.slice() });
  const document = await loadingTask.promise;
  try {
    const outline = (await document.getOutline()) as unknown;
    const visit = async (items: unknown): Promise<readonly PdfOutlineItem[]> => {
      if (!Array.isArray(items)) return [];
      return Promise.all(
        items.map(async (item) => {
          const record = asRecord(item);
          const pageNumber = await resolveOutlineDestination(
            document as unknown as Parameters<typeof resolveOutlineDestination>[0],
            record.dest,
          );
          const result: PdfOutlineItem = {
            title: typeof record.title === 'string' ? record.title : 'Untitled section',
            items: await visit(record.items),
            ...(pageNumber !== undefined ? { pageNumber } : {}),
            ...(typeof record.url === 'string' ? { url: record.url } : {}),
          };
          return result;
        }),
      );
    };
    return visit(outline);
  } finally {
    await loadingTask.destroy();
  }
}

export function inspectPdfInModuleWorker(
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<DocMeta> {
  const transferableBytes = bytes.slice();
  return runInModuleWorker<ArrayBuffer, DocMeta>(
    new URL('./inspect.worker.js', import.meta.url),
    transferableBytes.buffer as ArrayBuffer,
    [transferableBytes.buffer as ArrayBuffer],
    signal,
  );
}

export type PdfiumRenderer = {
  readonly packageName: '@embedpdf/pdfium';
  readonly packageVersion: '2.15.1';
  renderPage(
    bytes: Uint8Array,
    pageNumber: number,
  ): Promise<{ pixels: Uint8Array; width: number; height: number }>;
};

export async function createPdfiumRenderer(
  wasmBinary: ArrayBuffer | Uint8Array,
): Promise<PdfiumRenderer> {
  const { init } = await import('@embedpdf/pdfium');
  const module = await init({ wasmBinary });
  module.PDFiumExt_Init();
  const runtime = module.pdfium as typeof module.pdfium & { HEAPU8: Uint8Array };

  return {
    packageName: '@embedpdf/pdfium',
    packageVersion: '2.15.1',
    async renderPage(bytes, pageNumber) {
      const input = new Uint8Array(bytes);
      const pointer = module.pdfium.wasmExports.malloc(input.byteLength);
      runtime.HEAPU8.set(input, pointer);
      const document = module.FPDF_LoadMemDocument(pointer, input.byteLength, '');
      if (!document) throw new Error('PDFium could not open the supplied document.');
      const page = module.FPDF_LoadPage(document, pageNumber - 1);
      if (!page) {
        module.FPDF_CloseDocument(document);
        throw new Error(`PDFium could not open page ${pageNumber}.`);
      }
      const width = Math.ceil(module.FPDF_GetPageWidth(page));
      const height = Math.ceil(module.FPDF_GetPageHeight(page));
      const bitmap = module.FPDFBitmap_Create(width, height, 4);
      if (!bitmap) {
        module.FPDF_ClosePage(page);
        module.FPDF_CloseDocument(document);
        throw new Error('PDFium could not allocate a page bitmap.');
      }
      module.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
      module.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, 0);
      const stride = module.FPDFBitmap_GetStride(bitmap);
      const buffer = module.FPDFBitmap_GetBuffer(bitmap);
      const pixels = runtime.HEAPU8.slice(buffer, buffer + stride * height);
      module.FPDFBitmap_Destroy(bitmap);
      module.FPDF_ClosePage(page);
      module.FPDF_CloseDocument(document);
      module.pdfium.wasmExports.free(pointer);
      return { pixels, width, height };
    },
  };
}

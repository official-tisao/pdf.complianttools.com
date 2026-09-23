import type { DocMeta } from '../types.js';
import type { EngineError } from '../errors.js';
import { runInModuleWorker } from '../runtime/module-worker.js';

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

/**
 * PDFium renderer bootstrap — shared by every route that rasterizes a PDF.
 *
 * Mirrors `configure-pdfjs.ts`: the engine owns the import, so this module's
 * only job is to hand over the WASM URL. Loading the `@embedpdf/pdfium`
 * package eagerly would pull a 4.4 MB WASM + Emscripten shell into every
 * route's graph (including the landing page), which would fail the bundle
 * budget. The `?url` import resolves to a URL *string* at build time, so
 * registering the renderer costs a fetch URL and no pdfium code until a
 * route actually needs it.
 *
 * pdfium is deliberately NOT precached by the service worker: only a few
 * tools need it, and eagerly caching 4.4 MB would make every first visit
 * download megabytes it never uses. It is cached at runtime the first time
 * a tool actually renders a page.
 */
import { createPdfiumRenderer, type PdfiumRenderer } from './read.js';
import { requestProvider, assertSafeEndpoint } from '../ai/transport.js';

let rendererPromise: Promise<PdfiumRenderer> | undefined;
let wasmUrl: string | undefined;

export function setPdfiumWasmUrl(url: string): void {
  assertSafeEndpoint(url);
  wasmUrl = url;
}

export function getPdfiumRenderer(): Promise<PdfiumRenderer> {
  if (rendererPromise) return rendererPromise;
  if (!wasmUrl)
    throw new Error(
      'PDFium WASM URL not configured. Import configure-pdfium.ts in the app root layout.',
    );
  rendererPromise = (async () => {
    const response = await requestProvider({ endpoint: wasmUrl, headers: {}, body: {} });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `PDFium WASM could not be loaded (HTTP ${response.status}). Rebuild the app so the pdfium.wasm asset is served from the static folder as /pdfium.wasm.`,
      );
    }
    const wasmBinary = await (response.body as ArrayBuffer);
    return createPdfiumRenderer(wasmBinary);
  })();
  return rendererPromise;
}

export { createPdfiumRenderer, type PdfiumRenderer };

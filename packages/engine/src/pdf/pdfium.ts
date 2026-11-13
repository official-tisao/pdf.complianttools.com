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

let rendererPromise: Promise<PdfiumRenderer> | undefined;
let wasmUrl: string | undefined;

export function setPdfiumWasmUrl(url: string): void {
  // PDFium WASM is a same-origin browser asset served from /pdfium.wasm.
  // Do not use AI transport's assertSafeEndpoint, which validates HTTPS endpoints
  // for external AI services. A relative local asset path is correct here.
  wasmUrl = url;
}

export function getPdfiumRenderer(): Promise<PdfiumRenderer> {
  if (rendererPromise) return rendererPromise;
  if (!wasmUrl)
    throw new Error(
      'PDFium WASM URL not configured. Import configure-pdfium.ts in the app root layout.',
    );
  rendererPromise = (async () => {
    // Load the PDFium WASM binary directly via browser fetch.
    // This is a same-origin asset, not an external AI endpoint, so no transport
    // wrapper is needed. The fetch is lazy and only runs when a route actually
    // needs pdfium (preserving the 4.4 MB WASM from loading on every route).
    let response: Response;
    try {
      response = await fetch(wasmUrl);
    } catch (error: unknown) {
      throw new Error(
        `PDFium WASM could not be loaded: ${error instanceof Error ? error.message : 'network error'}. Rebuild the app so the pdfium.wasm asset is served from the static folder as /pdfium.wasm.`,
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new Error(
        `PDFium WASM could not be loaded (HTTP ${response.status}). Rebuild the app so the pdfium.wasm asset is served from the static folder as /pdfium.wasm.`,
      );
    }
    const wasmBinary = await response.arrayBuffer();
    return createPdfiumRenderer(wasmBinary);
  })();
  return rendererPromise;
}

export { createPdfiumRenderer, type PdfiumRenderer };
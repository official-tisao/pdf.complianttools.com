/**
 * PDFium WASM bootstrap — shared by every route that rasterizes a PDF.
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
import { setPdfiumWasmUrl } from '@pdf-complianttools/engine/pdfium';

setPdfiumWasmUrl('/pdfium.wasm');

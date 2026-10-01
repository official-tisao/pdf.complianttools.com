import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

/**
 * Configures pdf.js's worker once, for every route.
 *
 * `GlobalWorkerOptions.workerSrc` must be set by the **host application** before
 * `getDocument` — the engine imports pdf.js itself but deliberately does not
 * configure the worker, because it has no bundler context to resolve a worker
 * URL against.
 *
 * This lived in `PdfViewer.svelte` alone, so it applied to exactly one route.
 * That is invisible until a *different* route opens a document and fails:
 * `/organize` counts pages with its own `await import('pdfjs-dist')` and
 * `getDocument` never resolved, so the thumbnail grid silently never rendered
 * — no error, no remedy, just a page whose file input accepts a document and
 * then does nothing with it.
 *
 * The failure is easy to misread. A `catch` around a library call turns "the
 * worker was never configured" into whatever data-shaped error the caller
 * invents, which is how an earlier version of this turned into "Re-export the
 * PDF from its source application" for files that were perfectly fine. So the
 * worker is configured at the layout, where every route inherits it.
 *
 * It must be the *same* module instance the caller uses. `pdfjs-dist` and
 * `pdfjs-dist/legacy/build/pdf.mjs` resolve to different module graphs in some
 * bundler configurations, so this sets both.
 */
export function configurePdfjs(): void {
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
}

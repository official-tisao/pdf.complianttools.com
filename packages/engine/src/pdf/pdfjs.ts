/**
 * The engine's single lazy entry point to pdf.js.
 *
 * pdf.js is ~144 KB gzipped — more than several routes' entire per-route budget — so it must only
 * ever be downloaded by code that actually opens a document. The trap this module exists to
 * avoid: a *dynamically* imported module is only lazy if nothing eagerly loaded calls it. An
 * `$effect` in the root layout that awaited a loader here therefore pulled pdf.js into every route
 * on the site, including the landing page, which never touches a PDF. That is how `/` regressed
 * from 39 KB to 183 KB and failed `verify:bundle`.
 *
 * Two rules keep it lazy, and both are load-bearing:
 *
 *  1. Only `loadPdfJs()` may import `pdfjs-dist`. No module in an eagerly-loaded graph may call
 *     it, or the laziness is undone at runtime.
 *  2. `setPdfJsWorkerUrl()` is deliberately free of pdf.js. A host registers the worker's URL as
 *     a plain string (a Vite `?url` import), so arranging the worker costs nothing on the routes
 *     that never render a page.
 *
 * `GlobalWorkerOptions.workerSrc` has to be assigned on the same module instance the engine
 * resolves, so this owns the import *and* the assignment instead of leaving the second half to the
 * host. The host cannot do it itself without importing pdf.js, which is the whole problem.
 */

type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let workerUrl: string | undefined;
let loaded: PdfJsModule | undefined;
let loading: Promise<PdfJsModule> | undefined;

/**
 * Assign the worker URL if pdf.js is already loaded. Called both after the import resolves and
 * when a host registers late, so the two orderings cannot race.
 */
function applyWorkerUrl(): void {
  if (workerUrl && loaded && !loaded.GlobalWorkerOptions.workerSrc) {
    loaded.GlobalWorkerOptions.workerSrc = workerUrl;
  }
}

/**
 * Register where the pdf.js worker lives, without importing pdf.js.
 *
 * Hosts call this at module scope. It is idempotent, so the root layout and an individual viewer
 * can both call it without coordinating.
 */
export function setPdfJsWorkerUrl(url: string): void {
  workerUrl = url;
  applyWorkerUrl();
}

/**
 * Import pdf.js, configuring its worker first if the host registered one.
 *
 * Cached, so concurrent callers share one import and one worker assignment instead of racing to
 * set the same value.
 */
export function loadPdfJs(): Promise<PdfJsModule> {
  loading ??= (async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    loaded = pdfjs;
    applyWorkerUrl();
    return pdfjs;
  })();
  return loading;
}

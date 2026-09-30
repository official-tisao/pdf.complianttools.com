/**
 * pdf.js worker configuration, shared by every route that can open a document.
 *
 * `GlobalWorkerOptions.workerSrc` must be set before `getDocument` is called, and it has to be set
 * on the *same* pdf.js module instance the engine will resolve. The engine imports
 * `pdfjs-dist/legacy/build/pdf.mjs` itself, so this module imports that exact specifier and Vite
 * serves both through one module graph — configuring a second copy would leave the engine's copy
 * without a worker.
 *
 * Previously this was a side effect in `PdfViewer.svelte`, so it only happened on `/view-pdf`.
 * The batch and folder-watcher routes run recipes that inspect documents, and with no worker
 * configured pdf.js threw, `classifyPdfInput` caught it, and the user was told their perfectly
 * valid PDF was corrupt. That is why it belongs here, in the layout, and is called from every
 * route.
 */

let configured: Promise<void> | undefined;

/**
 * Idempotent, and safe to call from several places: the promise is cached, so concurrent callers
 * share one import and one assignment rather than racing to set the same value.
 */
export function configurePdfJs(): Promise<void> {
  configured ??= (async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  })();
  return configured;
}

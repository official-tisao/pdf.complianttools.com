/**
 * pdf.js worker configuration, shared by every route that can open a document.
 *
 * `GlobalWorkerOptions.workerSrc` must be set before `getDocument` is called, and it has to be set
 * on the *same* pdf.js module instance the engine resolves. The engine owns that import (see
 * `$lib/pdfjs-worker-url`), so this module's only job is to hand over the URL.
 *
 * The tempting version of this file imported pdf.js itself and returned a promise the root layout
 * awaited from an `$effect`. That put pdf.js — ~144 KB gzipped — in every route's graph, including
 * the landing page, which never opens a PDF: `/` measured 183 KB against a 60 KB budget and failed
 * `verify:bundle`. A dynamic import is only lazy while nothing eagerly loaded actually calls it.
 *
 * `?url` is the key to doing this cheaply. It resolves to a URL *string* at build time, so
 * registering the worker costs a string assignment and no pdf.js on any route. The engine applies
 * it the first time something actually needs pdf.js.
 */
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
// The `/pdfjs` subpath, not the barrel: the layout imports this module, and `index.ts` re-exports
// every entry point, so importing `setPdfJsWorkerUrl` from `.` pulled pdf-lib and jspdf into the
// landing page and made it heavier than before the fix.
import { setPdfJsWorkerUrl } from '@pdf-complianttools/engine/pdfjs';

setPdfJsWorkerUrl(workerUrl);

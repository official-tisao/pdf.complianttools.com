<script lang="ts">
  import { onMount } from 'svelte';
  import FileDrop from '@pdf-complianttools/ui/FileDrop.svelte';
  import Button from '@pdf-complianttools/ui/Button.svelte';
  import {
    OCR_MODELS,
    createTesseractOcrWorker,
    getOcrCapability,
    ocrFallback,
    ocrPdf,
    type OcrModelStore,
    type OcrResult,
  } from '@pdf-complianttools/engine';
  import { downloadOcrModel } from '$lib/ocr-client';
  import { createOcrModelStore } from '$lib/ocr-store';

  let file = $state<File>();
  let selectedLanguage = $state('eng');
  let outputMode = $state<'invisible-text-layer' | 'searchable-pdf' | 'plain-text-export'>(
    'searchable-pdf',
  );
  let capability = $state<Awaited<ReturnType<typeof getOcrCapability>>>();
  let fallback = $state<OcrResult>();
  let status = $state('Choose a PDF. No runtime or model is downloaded during page load.');
  let resultUrl = $state('');
  let resultName = $state('ocr-result.pdf');
  let progress = $state('');
  let store = $state<OcrModelStore>();
  let worker: ReturnType<typeof createTesseractOcrWorker> | undefined;

  onMount(() => {
    store = createOcrModelStore();
    return () => {
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      void worker?.dispose();
    };
  });

  async function selectFile(files: FileList | null) {
    file = files?.[0];
    fallback = undefined;
    capability = undefined;
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = '';
    if (!file) return;
    status = `${file.name} selected. Prepare the local OCR worker, then download a language model explicitly.`;
  }

  function ensureWorker() {
    worker ??= createTesseractOcrWorker({
      workerPath: '/ocr-runtime/v7.0.0/worker.min.js',
      corePath: '/ocr-runtime/v7.0.0/tesseract-core-lstm.wasm.js',
      onProgress: (event) => {
        progress = `${event.status} (${Math.round(event.progress * 100)}%)`;
      },
    });
    return worker;
  }

  async function checkCapability() {
    const currentStore = store ?? createOcrModelStore();
    store = currentStore;
    capability = await getOcrCapability(selectedLanguage, currentStore, ensureWorker());
    status = capability.message;
  }

  async function downloadModel() {
    const currentStore = store ?? createOcrModelStore();
    store = currentStore;
    progress = 'Starting explicit model download…';
    try {
      const model = await downloadOcrModel(selectedLanguage, currentStore, (loaded, total) => {
        progress = `Downloading ${modelLabel()} (${Math.round((loaded / total) * 100)}%)`;
      });
      capability = await getOcrCapability(selectedLanguage, currentStore, ensureWorker());
      status = `${model.label} is verified and cached locally. Recognition can now run on this device.`;
    } catch (error) {
      status = error instanceof Error ? error.message : 'The OCR model could not be installed.';
    } finally {
      progress = '';
    }
  }

  async function recognize() {
    if (!file) return;
    const currentStore = store ?? createOcrModelStore();
    store = currentStore;
    const currentWorker = ensureWorker();
    capability = await getOcrCapability(selectedLanguage, currentStore, currentWorker);
    if (capability.state !== 'ready') {
      status = capability.message;
      return;
    }
    status = 'Rendering pages locally and recognizing them in the local OCR worker…';
    progress = '';
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      status = 'Rendering PDF pages locally…';
      const result = await ocrPdf(bytes, renderPdfPage, currentWorker, currentStore, {
        language: [selectedLanguage],
        outputMode,
      });
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      resultUrl = URL.createObjectURL(
        new Blob([result.bytes.slice().buffer as ArrayBuffer], { type: result.mimeType }),
      );
      resultName = outputMode === 'plain-text-export' ? 'ocr-result.txt' : 'ocr-result.pdf';
      status = `OCR complete for ${result.pages} page${result.pages === 1 ? '' : 's'}. The result was produced locally.`;
    } catch (error) {
      status = error instanceof Error ? error.message : 'Local OCR failed.';
    }
  }

  async function useTextFallback() {
    if (!file) return;
    try {
      fallback = await ocrFallback(new Uint8Array(await file.arrayBuffer()));
      if (!fallback) {
        status =
          'No selectable text was found. Download an approved model before recognizing image-only pages.';
        return;
      }
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      resultUrl = URL.createObjectURL(
        new Blob([fallback.bytes.slice().buffer as ArrayBuffer], { type: fallback.mimeType }),
      );
      resultName = 'ocr-fallback.txt';
      status = 'Selectable-text fallback ready. This did not OCR image-only content.';
    } catch (error) {
      status =
        error instanceof Error ? error.message : 'The local text fallback could not be created.';
    }
  }

  function modelLabel() {
    return (
      OCR_MODELS.find((model) => model.language === selectedLanguage)?.label ?? selectedLanguage
    );
  }

  async function renderPdfPage(bytes: Uint8Array, pageNumber: number, scale = 1) {
    status = `Rendering page ${pageNumber} locally…`;
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdfDocument = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    const page = await pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('The browser canvas is unavailable for local PDF rendering.');
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    status = `Page ${pageNumber} rendered. Sending it to the local OCR worker…`;
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return { pixels: new Uint8Array(image.data), width: canvas.width, height: canvas.height };
  }
</script>

<svelte:head
  ><title>OCR PDF locally</title><meta
    name="description"
    content="Run explicitly enabled Tesseract.js OCR locally over rendered PDF pages."
  /></svelte:head
>
<section class="page">
  <p class="eyebrow">LOCAL OCR</p>
  <h1>OCR PDF</h1>
  <p class="lede">
    PDF pages are rendered in the browser and sent only to a local Tesseract.js worker. Runtime and
    language models are loaded lazily after an explicit action; PDF pixels are never uploaded.
  </p>
  <FileDrop
    accept=".pdf,application/pdf"
    multiple={false}
    label="Choose a scanned PDF"
    onfiles={selectFile}
  />
  <section class="disclosure" aria-labelledby="download-heading">
    <h2 id="download-heading">Model and language disclosure</h2>
    <p>
      Tesseract.js runtime assets are self-hosted by this application. Language models are fetched
      only from their exact pinned source after you choose Download model, then hash-verified and
      cached in this browser's IndexedDB. First-use offline recognition is unavailable.
    </p>
    <label for="language">Language</label><select
      id="language"
      bind:value={selectedLanguage}
      onchange={() => void checkCapability()}
      >{#each OCR_MODELS as model (model.language)}<option value={model.language}
          >{model.label} — {model.modelBytes.toLocaleString()} bytes — {model.modelLicense}</option
        >{/each}</select
    >
    <label for="output-mode">Output</label><select id="output-mode" bind:value={outputMode}
      ><option value="searchable-pdf">Searchable PDF</option><option value="invisible-text-layer"
        >Invisible text layer PDF</option
      ><option value="plain-text-export">Plain text export</option></select
    >
    {#if capability}<p class={`capability ${capability.state}`}>{capability.message}</p>{/if}
  </section>
  <div class="actions">
    <Button variant="secondary" disabled={!file} onclick={checkCapability}>Prepare local OCR</Button
    >
    <Button variant="secondary" disabled={!file} onclick={downloadModel}>Download model</Button>
    <Button disabled={!file} onclick={recognize}>Run OCR locally</Button>
    <Button variant="secondary" disabled={!file} onclick={useTextFallback}
      >Use selectable-text fallback</Button
    >
    {#if resultUrl}<a href={resultUrl} download={resultName}>Download result</a>{/if}
  </div>
  {#if progress}<p class="progress" role="status">{progress}</p>{/if}
  <p class="status" role="status" aria-live="polite">{status}</p>
  <details>
    <summary>Offline and accuracy boundary</summary>
    <p>
      A model must be downloaded once while online. Later recognition can reuse the browser cache
      when the app, worker, core, and model cache remain available; browser eviction, private
      browsing, and first-use offline mode are not guaranteed. OCR remains best-effort and should be
      reviewed against the source scan.
    </p>
  </details>
</section>

<style>
  .page {
    margin: auto;
    max-width: 960px;
    padding: 72px 40px 0;
  }
  .eyebrow {
    color: var(--color-muted);
    font-size: 0.875rem;
    letter-spacing: 0.12em;
  }
  h1 {
    font-size: clamp(2.5rem, 6vw, 4rem);
    letter-spacing: -0.05em;
    margin: 12px 0;
  }
  .lede,
  .status,
  .progress,
  .disclosure p,
  details p {
    color: var(--color-muted);
  }
  .disclosure {
    background: var(--color-white);
    border: 1px solid var(--color-hairline);
    border-radius: 8px;
    display: grid;
    gap: 12px;
    margin-top: 24px;
    padding: 24px;
  }
  .disclosure h2 {
    font-size: 1.2rem;
    margin: 0;
  }
  .disclosure select {
    border: 1px solid var(--color-hairline);
    border-radius: 6px;
    font: inherit;
    min-height: 38px;
    padding: 6px 8px;
    max-width: 420px;
  }
  .capability {
    border-left: 4px solid var(--color-ink);
    padding-left: 12px;
  }
  .model-download-required {
    border-left-color: #8a6f3d;
  }
  .runtime-not-configured {
    border-left-color: #464442;
  }
  .actions {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 20px;
  }
  .actions a {
    color: inherit;
    font-weight: 600;
  }
  .status,
  .progress {
    min-height: 24px;
  }
  details {
    margin-top: 24px;
  }
  summary {
    cursor: pointer;
    font-weight: 600;
  }
  @media (max-width: 767px) {
    .page {
      padding-inline: 24px;
    }
  }
</style>

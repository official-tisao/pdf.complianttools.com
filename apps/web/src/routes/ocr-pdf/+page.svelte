<script lang="ts">
  import FileDrop from '@pdf-complianttools/ui/FileDrop.svelte';
  import Button from '@pdf-complianttools/ui/Button.svelte';
  import {
    OCR_MODELS,
    getOcrCapability,
    ocrFallback,
    type OcrResult,
  } from '@pdf-complianttools/engine';

  let file = $state<File>();
  let selectedLanguage = $state('eng');
  let capability = $state<Awaited<ReturnType<typeof getOcrCapability>>>();
  let fallback = $state<OcrResult>();
  let status = $state('Choose a PDF. No model is downloaded during page load.');
  let fallbackUrl = $state('');

  async function selectFile(files: FileList | null) {
    file = files?.[0];
    fallback = undefined;
    capability = undefined;
    if (!file) return;
    capability = await getOcrCapability(selectedLanguage);
    status = capability.message;
  }
  async function checkCapability() {
    capability = await getOcrCapability(selectedLanguage);
    status = capability.message;
  }
  async function useTextFallback() {
    if (!file) return;
    try {
      fallback = await ocrFallback(new Uint8Array(await file.arrayBuffer()));
      if (!fallback) {
        status =
          'No selectable text was found. A local OCR worker and installed model are required for scanned pages.';
        return;
      }
      fallbackUrl = URL.createObjectURL(
        new Blob([fallback.bytes.slice().buffer as ArrayBuffer], { type: fallback.mimeType }),
      );
      status = 'Selectable-text fallback ready. This did not OCR image-only content.';
    } catch (error) {
      status =
        error instanceof Error ? error.message : 'The local text fallback could not be created.';
    }
  }
</script>

<svelte:head
  ><title>OCR PDF locally</title><meta
    name="description"
    content="OCR capability disclosure and selectable-text fallback for local PDF processing."
  /></svelte:head
>
<section class="page">
  <p class="eyebrow">LOCAL OCR</p>
  <h1>OCR PDF</h1>
  <p class="lede">
    OCR is model-backed local processing. This build never fetches a model automatically and reports
    exactly whether the worker/model boundary is ready.
  </p>
  <FileDrop
    accept=".pdf,application/pdf"
    multiple={false}
    label="Choose a scanned PDF"
    onchange={selectFile}
  />
  <section class="disclosure" aria-labelledby="download-heading">
    <h2 id="download-heading">Model and language disclosure</h2>
    <p>
      Models are not bundled or downloaded on page load. An approved model must be explicitly
      supplied and verified in local storage before recognition. The model catalogue below discloses
      the expected size and Apache-2.0 status.
    </p>
    <label for="language">Language</label><select
      id="language"
      bind:value={selectedLanguage}
      onchange={() => void checkCapability()}
      >{#each OCR_MODELS as model (model.language)}<option value={model.language}
          >{model.label} — about {(model.modelBytes / 1_000_000).toFixed(0)} MB</option
        >{/each}</select
    >{#if capability}<p class={`capability ${capability.state}`}>{capability.message}</p>{/if}
  </section>
  <div class="actions">
    <Button variant="secondary" disabled={!file} onclick={checkCapability}
      >Check local OCR capability</Button
    ><Button disabled={!file} onclick={useTextFallback}>Use selectable-text fallback</Button
    >{#if fallbackUrl}<a href={fallbackUrl} download="ocr-fallback.txt">Download fallback text</a
      >{/if}
  </div>
  <p class="status" role="status" aria-live="polite">{status}</p>
  <details>
    <summary>Why recognition may be unavailable</summary>
    <p>
      Tesseract.js and its traineddata files are not part of this base bundle yet. The engine
      exposes an injected worker/model contract so a reviewed, locally hosted runtime can be added
      without hidden network calls or a copyleft renderer. Until that boundary is supplied,
      image-only pages remain explicitly unavailable; existing PDF text still has a deterministic
      fallback.
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
    max-width: 360px;
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
  .status {
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

<script lang="ts">
  import Button from '@pdf-complianttools/ui/Button.svelte';
  import PageGrid from '@pdf-complianttools/ui/PageGrid.svelte';
  import { loadPdfJs } from '@pdf-complianttools/engine/pdfjs';
  import type * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
  import { translate, type Locale } from '$lib/i18n';
  import { getLocaleContext } from '../routes/__locale/context';

  let {
    file,
    locale: localeProp,
    onerror,
  }: {
    file?: File;
    locale?: Locale;
    onerror?: (message: string) => void;
  } = $props();

  const locale = $derived(localeProp ?? getLocaleContext());
  const t = (key: string, fallback: string, ...values: Array<string | number | undefined>) =>
    translate(locale, key, fallback, ...values);
  const fileKey = $derived(file ? `${file.name}:${file.size}:${file.lastModified}` : '');

  let loadedFileKey = $state('');
  let pageCount = $state(0);
  let previewDocument = $state<Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>>();
  let selectedPage = $state(1);
  let selectedPreview = $state('');
  let previewError = $state('');
  let previewOpen = $state(false);
  let loadGeneration = 0;

  $effect(() => {
    const key = fileKey;
    if (key === loadedFileKey) return;
    loadedFileKey = key;
    pageCount = 0;
    previewDocument = undefined;
    selectedPage = 1;
    selectedPreview = '';
    previewError = '';
    previewOpen = false;

    const currentFile = file;
    if (!currentFile) return;

    const generation = ++loadGeneration;
    void loadPreview(currentFile, key, generation);
  });

  async function loadPreview(currentFile: File, key: string, generation: number) {
    try {
      const bytes = new Uint8Array(await currentFile.arrayBuffer());
      const document = await (await loadPdfJs()).getDocument({ data: bytes.slice() }).promise;
      if (generation !== loadGeneration || key !== fileKey) return;

      previewDocument = document;
      pageCount = document.numPages;
      if (pageCount > 0) selectedPreview = await renderPreviewPage(1, 0.7);
    } catch (error) {
      if (generation !== loadGeneration || key !== fileKey) return;
      const message =
        error instanceof Error ? error.message : 'This PDF could not be previewed locally.';
      previewError = message;
      onerror?.(message);
    }
  }

  async function renderPreviewPage(pageNumber: number, scale: number): Promise<string> {
    if (!previewDocument) return '';
    const pdfPage = await previewDocument.getPage(pageNumber);
    const viewport = pdfPage.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) return '';
    await pdfPage.render({ canvas, canvasContext: context, viewport }).promise;
    return canvas.toDataURL('image/png');
  }

  async function selectPreviewPage(pageNumber: number) {
    selectedPage = pageNumber;
    selectedPreview = await renderPreviewPage(pageNumber, previewOpen ? 1.35 : 0.7);
  }

  async function openPreview() {
    if (!previewDocument) return;
    previewOpen = true;
    selectedPreview = await renderPreviewPage(selectedPage, 1.35);
  }

  async function closePreview() {
    previewOpen = false;
    if (previewDocument) selectedPreview = await renderPreviewPage(selectedPage, 0.7);
  }

  function handleWindowKeydown(event: Event) {
    if ((event as unknown as { key: string }).key === 'Escape' && previewOpen) void closePreview();
  }

  $effect(() => {
    if (!previewOpen) return;
    const previousOverflow = globalThis.document.body.style.overflow;
    globalThis.document.body.style.overflow = 'hidden';
    return () => {
      globalThis.document.body.style.overflow = previousOverflow;
    };
  });
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if pageCount > 0}
  <div class="pdf-preview">
    <div class="preview-toolbar">
      <h2>{t('shell.preview.title', 'PDF preview')}</h2>
      <Button variant="secondary" onclick={() => void openPreview()}>
        {t('shell.preview.open', 'Open full-screen preview')}
      </Button>
    </div>
    <PageGrid
      {pageCount}
      selected={[selectedPage]}
      thumbnailKey={fileKey}
      thumbnailLoader={(pageNumber) => renderPreviewPage(pageNumber, 0.22)}
      onselect={(pageNumber) => void selectPreviewPage(pageNumber)}
    />
    {#if selectedPreview}
      <div class="selected-page" aria-live="polite">
        <h2>{t('shell.preview.selected', 'Selected page {value}', selectedPage)}</h2>
        <img
          src={selectedPreview}
          alt={t('shell.preview.pageAlt', 'Preview of page {value}', selectedPage)}
        />
      </div>
    {/if}
  </div>
{:else if previewError}
  <p class="preview-error" role="status">{previewError}</p>
{:else if !file}
  <p class="empty">
    {t('shell.preview.empty', 'Page previews appear here after you select a PDF.')}
  </p>
{/if}

{#if previewOpen && previewDocument}
  <div class="preview-backdrop">
    <dialog
      open
      class="preview-modal"
      aria-modal="true"
      aria-label={t('shell.preview.dialog', 'Full-screen PDF preview')}
    >
      <header class="preview-header">
        <div>
          <p class="eyebrow">{t('shell.preview.eyebrow', 'PDF PREVIEW')}</p>
          <h2>{t('shell.preview.dialogTitle', 'Preview PDF')}</h2>
          <p>
            {t(
              'shell.preview.instructions',
              'Choose a page from the rail to inspect it at full size.',
            )}
          </p>
        </div>
        <button
          class="close-button"
          type="button"
          aria-label={t('shell.preview.close', 'Close preview')}
          onclick={() => void closePreview()}
        >
          ×
        </button>
      </header>
      <div class="preview-body">
        <aside class="preview-rail" aria-label={t('shell.preview.pages', 'Pages')}>
          <h3>{t('shell.preview.pages', 'Pages')}</h3>
          <PageGrid
            variant="rail"
            {pageCount}
            selected={[selectedPage]}
            thumbnailKey={fileKey}
            thumbnailLoader={(pageNumber) => renderPreviewPage(pageNumber, 0.22)}
            onselect={(pageNumber) => void selectPreviewPage(pageNumber)}
          />
        </aside>
        <main class="preview-canvas-area">
          <div class="canvas-toolbar" aria-live="polite">
            {t('shell.preview.currentPage', 'Page {value} of {total}', selectedPage, pageCount)}
          </div>
          {#if selectedPreview}
            <div class="preview-page-large">
              <img
                src={selectedPreview}
                alt={t('shell.preview.pageAlt', 'Preview of page {value}', selectedPage)}
              />
            </div>
          {/if}
        </main>
      </div>
    </dialog>
  </div>
{/if}

<style>
  .pdf-preview {
    display: grid;
    gap: 20px;
  }

  .preview-toolbar,
  .canvas-toolbar {
    align-items: center;
    display: flex;
    gap: 16px;
    justify-content: space-between;
  }

  .preview-toolbar h2 {
    font-size: 1rem;
    margin: 0;
  }

  .selected-page {
    margin-top: 0;
  }

  .selected-page h2 {
    font-size: 1rem;
    margin: 0 0 10px;
  }

  .selected-page img {
    background: #fff;
    border: 1px solid var(--color-hairline);
    display: block;
    max-height: 520px;
    max-width: 100%;
    object-fit: contain;
  }

  .empty,
  .preview-error {
    color: var(--color-muted);
  }

  .preview-error {
    overflow-wrap: anywhere;
  }

  .preview-backdrop {
    align-items: center;
    background: rgb(20 19 17 / 68%);
    display: flex;
    inset: 0;
    justify-content: center;
    padding: 24px;
    position: fixed;
    z-index: 20;
  }

  .preview-modal {
    background: var(--color-paper, #f5f3ef);
    border: 0;
    border-radius: var(--radius-panel, 8px);
    box-shadow: 0 24px 80px rgb(0 0 0 / 28%);
    display: grid;
    height: min(92vh, 960px);
    margin: 0;
    max-width: 1400px;
    padding: 0;
    width: min(96vw, 1400px);
  }

  .preview-header {
    align-items: flex-start;
    border-bottom: 1px solid var(--color-hairline);
    display: flex;
    gap: 24px;
    justify-content: space-between;
    padding: 24px 28px;
  }

  .preview-header h2,
  .preview-header p {
    margin: 0;
  }

  .preview-header p:last-child {
    color: var(--color-muted);
    margin-top: 6px;
  }

  .eyebrow {
    color: var(--color-muted);
    font-size: 0.75rem;
    letter-spacing: 0.12em;
    margin-bottom: 6px !important;
  }

  .close-button {
    align-items: center;
    background: var(--color-ink, #1c1a17);
    border: 0;
    border-radius: 999px;
    color: var(--color-white, #fff);
    cursor: pointer;
    display: inline-flex;
    font-size: 1.5rem;
    height: 40px;
    justify-content: center;
    line-height: 1;
    width: 40px;
  }

  .preview-body {
    display: grid;
    gap: 24px;
    grid-template-columns: 220px minmax(0, 1fr);
    min-height: 0;
    padding: 24px;
  }

  .preview-rail {
    min-width: 0;
    overflow: auto;
  }

  .preview-rail h3 {
    margin: 0 0 12px;
  }

  .preview-canvas-area {
    display: grid;
    gap: 12px;
    min-width: 0;
    min-height: 0;
  }

  .canvas-toolbar {
    color: var(--color-muted);
    justify-content: flex-start;
  }

  .preview-page-large {
    align-items: flex-start;
    background: #464442;
    border-radius: var(--radius-panel, 8px);
    display: flex;
    justify-content: center;
    min-height: 0;
    overflow: auto;
    padding: 24px;
  }

  .preview-page-large img {
    background: #fff;
    box-shadow: 0 0 0 1px rgb(28 26 23 / 13%);
    display: block;
    max-height: 100%;
    max-width: 100%;
    object-fit: contain;
  }

  @media (max-width: 767px) {
    .preview-backdrop {
      padding: 0;
    }

    .preview-modal {
      border-radius: 0;
      height: 100vh;
      width: 100vw;
    }

    .preview-header {
      padding: 18px 20px;
    }

    .preview-body {
      gap: 16px;
      grid-template-columns: 112px minmax(0, 1fr);
      padding: 16px;
    }
  }
</style>

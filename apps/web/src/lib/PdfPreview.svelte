<script lang="ts">
  import PageGrid from '@pdf-complianttools/ui/PageGrid.svelte';
  import LoadingProgress from '$lib/LoadingProgress.svelte';
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
  let previewPhase = $state<'idle' | 'loading' | 'thumbnails' | 'page' | 'ready'>('idle');
  let previewProgress = $state<number | null>(null);
  let loadedThumbnails = $state<number[]>([]);
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
    const currentFile = file;
    previewPhase = currentFile ? 'loading' : 'idle';
    previewProgress = currentFile ? null : 0;
    loadedThumbnails = [];

    if (!currentFile) return;

    const generation = ++loadGeneration;
    void loadPreview(currentFile, key, generation);
  });

  async function loadPreview(currentFile: File, key: string, generation: number) {
    try {
      const bytes = new Uint8Array(await currentFile.arrayBuffer());
      if (generation === loadGeneration && key === fileKey) previewProgress = 20;
      const document = await (await loadPdfJs()).getDocument({ data: bytes.slice() }).promise;
      if (generation !== loadGeneration || key !== fileKey) return;

      previewDocument = document;
      pageCount = document.numPages;
      previewProgress = 45;
      if (pageCount > 0) {
        selectedPreview = await renderPreviewPage(1, 0.7);
        previewProgress = 60;
        previewPhase = 'thumbnails';
      } else {
        previewPhase = 'ready';
        previewProgress = 100;
      }
    } catch (error) {
      if (generation !== loadGeneration || key !== fileKey) return;
      previewPhase = 'idle';
      previewProgress = null;
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

  async function loadThumbnail(pageNumber: number): Promise<string> {
    const key = fileKey;
    const generation = loadGeneration;

    function markThumbnailLoaded() {
      if (generation !== loadGeneration || key !== fileKey || loadedThumbnails.includes(pageNumber))
        return;
      loadedThumbnails = [...loadedThumbnails, pageNumber];
      const target = Math.max(1, Math.min(pageCount, 33));
      previewProgress = Math.min(100, 60 + (loadedThumbnails.length / target) * 40);
      if (loadedThumbnails.length >= target) {
        previewProgress = 100;
        previewPhase = 'ready';
      }
    }

    try {
      const src = await renderPreviewPage(pageNumber, 0.22);
      markThumbnailLoaded();
      return src;
    } catch (error) {
      markThumbnailLoaded();
      throw error;
    }
  }

  async function selectPreviewPage(pageNumber: number) {
    selectedPage = pageNumber;
    previewPhase = 'page';
    previewProgress = null;
    selectedPreview = await renderPreviewPage(pageNumber, 0.7);
    previewProgress = 100;
    previewPhase = 'ready';
  }
</script>

{#if previewPhase === 'loading' || previewPhase === 'thumbnails' || previewPhase === 'page'}
  <LoadingProgress
    value={previewProgress}
    label={previewPhase === 'page' ? `Opening page ${selectedPage}` : 'Preparing page previews'}
    detail={previewProgress == null ? 'Working locally…' : `${Math.round(previewProgress)}% ready`}
  />
{/if}

{#if pageCount > 0}
  <div class="pdf-preview">
    <PageGrid
      {pageCount}
      selected={[selectedPage]}
      thumbnailKey={fileKey}
      thumbnailLoader={loadThumbnail}
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

<style>
  .pdf-preview {
    display: grid;
    gap: 20px;
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
</style>

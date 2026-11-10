<script lang="ts">
  import Button from '@pdf-complianttools/ui/Button.svelte';
  import FileDrop from '@pdf-complianttools/ui/FileDrop.svelte';
  import PageGrid from '@pdf-complianttools/ui/PageGrid.svelte';
  import { JSONLD_CLOSE, JSONLD_OPEN, softwareApplicationLd } from '$lib/seo';
  import { translate, type Locale } from '$lib/i18n';
  import { getLocaleContext } from '../routes/__locale/context';
  import { page } from '$app/state';
  import { loadPdfJs } from '@pdf-complianttools/engine/pdfjs';
  import type * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
  import { splitPdf } from '@pdf-complianttools/engine';

  let {
    title = 'Split PDF',
    eyebrow = 'PDF TOOL',
    description = 'Split a PDF by page count or ranges, entirely in your browser.',
    actionLabel = 'Split PDF',
  }: {
    title?: string;
    eyebrow?: string;
    description?: string;
    actionLabel?: string;
  } = $props();

  const locale = $derived(getLocaleContext() as Locale);
  const t = (key: string, fallback: string, ...values: Array<string | number | undefined>) =>
    translate(locale, key, fallback, ...values);
  const structuredData = $derived(
    softwareApplicationLd({ name: title, description, path: page.url.pathname }),
  );

  let files = $state<File[]>([]);
  let values = $state<Record<string, string | number | boolean>>({
    splitMethod: 'pagesPerFile',
    pagesPerFile: 1,
    pageRanges: '',
  });
  let pageCount = $state(0);
  let pages = $state<number[]>([]); // Selected page numbers (1-based)
  let previewDocument = $state<Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>>();
  let previewKey = $state('');
  let focusedPage = $state(1);
  let focusedPreview = $state('');
  let busy = $state(false);
  let outputResult = $state<{ files: Uint8Array[]; pageCounts: number[] } | null>(null);
  let outputError = $state('');
  let status = $state('');
  let seeded = false;

  const selectedPageCount = $derived(pages.length);
  const allPagesSelected = $derived(pageCount > 0 && pages.length === pageCount);
  const noPagesSelected = $derived(pageCount > 0 && pages.length === 0);

  $effect(() => {
    if (!seeded) seeded = true;
  });

  function selectFiles(list: FileList | null) {
    if (!list) return;
    const chosen = Array.from(list);
    if (chosen.length === 0) return;
    if (chosen.length > 1) {
      rejectMultiple();
      return;
    }
    const first = chosen[0];
    if (!first) return;
    files = [first];
    outputResult = null;
    outputError = '';
    status = t('shell.files.ready', '1 file ready locally.');
    void loadPreview(first);
  }

  async function loadPreview(file: File) {
    pageCount = 0;
    previewDocument = undefined;
    previewKey = '';
    focusedPage = 1;
    focusedPreview = '';
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const document_ = await (await loadPdfJs()).getDocument({ data: bytes.slice() }).promise;
      previewDocument = document_;
      previewKey = `${file.name}:${file.size}:${file.lastModified}`;
      pageCount = document_.numPages;
      focusedPreview = await renderPreviewPage(1, 0.7);
    } catch (error_) {
      pageCount = 0;
      previewDocument = undefined;
      outputError =
        error_ instanceof Error ? error_.message : 'This PDF could not be read locally.';
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

  async function focusPage(pageNumber: number) {
    focusedPage = pageNumber;
    focusedPreview = await renderPreviewPage(pageNumber, 0.7);
  }

  function rejectMultiple() {
    outputError = t('shell.files.singleOnly', 'Only one PDF file can be processed at a time.');
  }

  function togglePage(pageNumber: number) {
    if (pages.includes(pageNumber)) {
      pages = pages.filter((p) => p !== pageNumber);
    } else {
      pages = [...pages, pageNumber];
    }
  }

  function selectAllPages() {
    pages = Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  function deselectAllPages() {
    pages = [];
  }

  function invertSelection() {
    pages = Array.from({ length: pageCount }, (_, index) => index + 1).filter(
      (page) => !pages.includes(page),
    );
  }

  function resetTool() {
    files = [];
    pages = [];
    pageCount = 0;
    outputResult = null;
    outputError = '';
    status = '';
    busy = false;
    previewDocument = undefined;
    previewKey = '';
    focusedPage = 1;
    focusedPreview = '';
    values = { splitMethod: 'pagesPerFile', pagesPerFile: 1, pageRanges: '' };
  }

  function downloadFile(bytes: Uint8Array, name: string) {
    const url = globalThis.URL.createObjectURL(
      new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' }),
    );
    const anchor = globalThis.document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    globalThis.URL.revokeObjectURL(url);
  }

  /**
   * Splits "1-5, 7, 10-12" into its verbatim tokens — each comma-separated
   * range becomes exactly one output file, so the token list is what the
   * engine's ranges method consumes.
   */
  function rangeTokens(text: string): string[] {
    return text
      .split(',')
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
  }

  /**
   * Parses "1-5, 7, 10-12" into a page list, clamped to the document, for the
   * grid selection and summary counts.
   */
  function parseRanges(text: string): number[] {
    const result: number[] = [];
    for (const token of rangeTokens(text)) {
      const [startText, endText] = token.split('-');
      const start = Number(startText);
      const end = endText === undefined ? start : Number(endText);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) continue;
      for (let page_ = start; page_ <= Math.min(end, pageCount); page_ += 1) result.push(page_);
    }
    return [...new Set(result)];
  }

  function applyRangesFromText() {
    const text = String(values.pageRanges ?? '');
    if (!text.trim()) return;
    pages = parseRanges(text);
  }

  async function runTool() {
    const first = files[0];
    if (!first) return;
    busy = true;
    outputResult = null;
    outputError = '';
    status = t('shell.status.working', 'Working locally…');
    // The grid selection is authoritative for the ranges method; the text field
    // is one way to set it, so re-parse here so a typed range always lands.
    const splitMethod = String(values.splitMethod ?? 'pagesPerFile');
    const rangeText = String(values.pageRanges ?? '');
    const selectedPages = splitMethod === 'ranges' ? parseRanges(rangeText) : [...pages];
    try {
      const partPages: number[][] = [];
      const outputs = await splitPdf(new Uint8Array(await first.arrayBuffer()), {
        splitMethod: splitMethod as 'pagesPerFile' | 'ranges' | 'everyPage' | 'bookmarks',
        selectedPages,
        ...(splitMethod === 'ranges' && rangeTokens(rangeText).length > 0
          ? { ranges: rangeTokens(rangeText) }
          : {}),
        pagesPerFile: Math.max(1, Number(values.pagesPerFile ?? 1)),
        onPart: (part) => {
          partPages[part.index] = [...part.pages];
        },
      });
      outputResult = {
        files: outputs,
        pageCounts: outputs.map((_, index) => partPages[index]?.length ?? 0),
      };
      status = t('shell.status.done', 'Done. Your original files were not changed.');
    } catch (err) {
      outputError =
        err instanceof Error
          ? err.message
          : t('shell.status.failed', 'The operation could not be completed.');
      status = '';
    } finally {
      busy = false;
    }
  }

  async function downloadAllAsZip() {
    if (!outputResult) return;
    try {
      // Deep subpath and a dynamic import, matching FeaturePage: the ZIP packer stays off the
      // eager path so other routes never load it. zipBatchResults takes BatchItemResult
      // records, so the split parts are presented as succeeded batch items.
      const { zipBatchResults } = await import('@pdf-complianttools/engine/batch-zip');
      const { zipBytes } = zipBatchResults(
        outputResult.files.map((bytes, index) => ({
          index,
          status: 'succeeded' as const,
          attempts: 1,
          output: bytes,
        })),
      );
      const url = globalThis.URL.createObjectURL(
        new globalThis.Blob([zipBytes.slice().buffer as ArrayBuffer], { type: 'application/zip' }),
      );
      const anchor = globalThis.document.createElement('a');
      anchor.href = url;
      anchor.download = 'split-output.zip';
      anchor.click();
      globalThis.URL.revokeObjectURL(url);
    } catch (err) {
      outputError =
        err instanceof Error ? err.message : t('shell.status.failed', 'ZIP download failed.');
    }
  }

  const eachHasSelection = $derived(values.splitMethod === 'ranges' ? pages.length > 0 : true);
</script>

<svelte:head>
  <meta name="description" content={description} />
  <!-- safe-html-reviewed: JSON-LD needs a script element Svelte cannot emit; softwareApplicationLd returns JSON.stringify output with "<" escaped, tested in scripts/seo.test.mjs -->
  {@html JSONLD_OPEN + structuredData + JSONLD_CLOSE}
</svelte:head>

<section class="tool-page">
  <p class="eyebrow">{eyebrow}</p>
  <h1>{title}</h1>
  <p class="lede">{description}</p>

  <FileDrop
    accept=".pdf,application/pdf"
    multiple={false}
    onchange={selectFiles}
    onreject={rejectMultiple}
  />

  <div class="workspace">
    <div class="preview">
      {#if files.length > 0 && pageCount > 0}
        <div class="preview-header">
          <span
            >{t(
              'shell.pageCount',
              pageCount === 1 ? '{value} page' : '{value} pages',
              pageCount,
            )}</span
          >
        </div>
        <PageGrid
          {pageCount}
          selected={pages}
          thumbnailKey={previewKey}
          thumbnailLoader={(pageNumber) => renderPreviewPage(pageNumber, 0.22)}
          onselect={(pageNumber) => {
            togglePage(pageNumber);
            void focusPage(pageNumber);
          }}
        />
        {#if focusedPreview}
          <section class="focused-page" aria-live="polite" aria-label="Selected page preview">
            <h2>{t('split.pagePreview', 'Page {value}', focusedPage)}</h2>
            <img
              src={focusedPreview}
              alt={t('split.previewAlt', 'Preview of page {value}', focusedPage)}
            />
          </section>
        {/if}
      {:else if files.length > 0}
        <p class="empty">
          {t('shell.preview.empty', 'Page previews appear here after you select a PDF.')}
        </p>
      {/if}
    </div>

    <div class="selection-panel">
      {#if files.length > 0 && pageCount > 0}
        <div class="selection-header">
          <h2>{t('split.pageSelection', 'Page Selection')}</h2>
          <div class="selection-info">
            <span>{t('split.totalPages', 'Total: {value}', pageCount)}</span>
            <span>{t('split.selected', 'Selected: {value}', selectedPageCount)}</span>
          </div>
          <div class="selection-controls">
            <Button variant="secondary" onclick={selectAllPages} disabled={allPagesSelected}>
              {t('split.selectAll', 'Select All')}
            </Button>
            <Button variant="secondary" onclick={deselectAllPages} disabled={noPagesSelected}>
              {t('split.deselectAll', 'Deselect All')}
            </Button>
            <Button variant="secondary" onclick={invertSelection}>
              {t('split.invertSelection', 'Invert')}
            </Button>
          </div>
        </div>

        <div class="split-method">
          <label for="split-method">{t('split.splitMethod', 'Split Method')}</label>
          <select id="split-method" bind:value={values.splitMethod}>
            <option value="pagesPerFile">{t('split.pagesPerFile', 'Pages per File')}</option>
            <option value="ranges">{t('split.customRanges', 'Custom Page Ranges')}</option>
            <option value="everyPage">{t('split.everyPage', 'Every Page Separately')}</option>
            <option value="bookmarks">{t('split.byBookmarks', 'By Bookmarks')}</option>
          </select>
        </div>

        {#if values.splitMethod === 'pagesPerFile'}
          <div class="option-field">
            <label for="pagesPerFile">{t('split.pagesPerFileLabel', 'Pages per File')}</label>
            <input
              id="pagesPerFile"
              type="number"
              min="1"
              bind:value={values.pagesPerFile}
              aria-label={t('split.pagesPerFileInput', 'Number of pages per output file')}
            />
          </div>
          <p class="option-hint">
            {t(
              'split.pagesPerFileHint',
              'A 10-page document with 5 pages per file produces 2 output files.',
            )}
          </p>
        {:else if values.splitMethod === 'ranges'}
          <div class="option-field">
            <label for="pageRanges">{t('split.pageRangesLabel', 'Page Ranges')}</label>
            <input
              id="pageRanges"
              type="text"
              bind:value={values.pageRanges}
              placeholder="1-5, 7, 10-12"
              onchange={applyRangesFromText}
              aria-label={t('split.pageRangesInput', 'Comma-separated page ranges')}
            />
          </div>
          <p class="option-hint">
            {t(
              'split.rangesHint',
              'Example: 1-5, 7, 10-12. Pages outside the document range are ignored.',
            )}
          </p>
        {:else if values.splitMethod === 'everyPage'}
          <p class="option-hint">
            {t('split.everyPageHint', 'Generates one output PDF for each page in the document.')}
          </p>
        {:else if values.splitMethod === 'bookmarks'}
          <p class="option-hint">
            {t(
              'split.bookmarksHint',
              'Splits at each bookmark/outline entry in the document. Requires the PDF to have bookmarks.',
            )}
          </p>
        {/if}

        <Button variant="secondary" onclick={resetTool}>
          {t('split.resetLabel', 'Reset')}
        </Button>

        <div class="output-summary">
          <h3>{t('split.outputSummary', 'Output Summary')}</h3>
          {#if values.splitMethod === 'pagesPerFile' && values.pagesPerFile && pageCount > 0}
            <span
              >{t(
                'split.estimatedOutputFiles',
                'Approximately {value} output file(s)',
                Math.ceil(pageCount / Number(values.pagesPerFile)),
              )}</span
            >
          {:else if values.splitMethod === 'everyPage' && pageCount > 0}
            <span
              >{t(
                'split.estimatedOutputFiles',
                'Approximately {value} output file(s)',
                pageCount,
              )}</span
            >
          {:else if values.splitMethod === 'bookmarks' && pageCount > 0}
            <span>{t('split.bookmarkOutputs', 'Output count depends on bookmark count')}</span>
          {:else if values.splitMethod === 'ranges'}
            <span
              >{t(
                'split.selectedRangeFiles',
                'Exactly {value} output file(s)',
                rangeTokens(String(values.pageRanges ?? '')).length,
              )}</span
            >
          {/if}
        </div>

        <Button variant="primary" onclick={runTool} disabled={busy || !eachHasSelection}>
          {actionLabel}
        </Button>
      {:else if files.length > 0 && pageCount === 0}
        <p class="empty">
          {t('shell.preview.empty', 'Page previews appear here after you select a PDF.')}
        </p>
      {:else}
        <p class="empty">{t('split.dropPdf', 'Drop a PDF here or choose a file to begin.')}</p>
      {/if}
    </div>

    {#if busy}
      <div class="processing-indicator" role="status" aria-live="polite">
        {t('shell.status.working', 'Working locally…')}
      </div>
    {/if}
  </div>

  <p class="status" role="status" aria-live="polite">{status}</p>
  {#if outputError}<p class="error" role="alert">{outputError}</p>{/if}

  {#if outputResult}
    <div class="output-results" role="region" aria-label="Split results">
      <h3>{t('split.results', 'Split Results')}</h3>
      <p>{t('split.generated', 'Generated {value} output file(s)', outputResult.files.length)}</p>
      {#each outputResult.files as outputBytes, index (index)}
        <div class="output-file">
          <span>{t('split.file', 'Part {value}', index + 1)}</span>
          <span>{t('split.pages', 'Pages: {value}', outputResult.pageCounts[index])}</span>
          <button
            type="button"
            onclick={() => downloadFile(outputBytes, `document_part_${index + 1}.pdf`)}
          >
            {t('split.download', 'Download')}
          </button>
        </div>
      {/each}
      <Button variant="primary" onclick={() => void downloadAllAsZip()} disabled={busy}>
        {t('split.downloadAllZip', 'Download All as ZIP')}
      </Button>
    </div>
  {/if}
</section>

<style>
  .tool-page {
    margin: auto;
    max-width: 1120px;
    padding: 96px 40px 0;
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
  .lede {
    color: var(--color-muted);
    font-size: 1.125rem;
    max-width: 680px;
  }
  .workspace {
    align-items: start;
    display: grid;
    gap: 24px;
    grid-template-columns: minmax(0, 1.5fr) minmax(0, 0.8fr);
    margin-top: 32px;
  }
  .preview {
    background: color-mix(in srgb, var(--color-white) 55%, transparent);
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-panel);
    box-sizing: border-box;
    min-height: 240px;
    min-width: 0;
    padding: 20px;
  }
  .preview-header {
    margin-bottom: 12px;
    font-weight: 600;
    color: var(--color-muted);
  }
  .focused-page {
    margin-top: 20px;
    max-width: 560px;
  }
  .focused-page h2 {
    font-size: 1rem;
    margin: 0 0 8px;
  }
  .focused-page img {
    background: #fff;
    border: 1px solid var(--color-hairline, #1c1a171a);
    display: block;
    max-width: 100%;
  }
  .error {
    color: #9a2d24;
    overflow-wrap: anywhere;
  }
  @media (max-width: 900px) {
    .tool-page {
      padding-inline: 24px;
      padding-top: 72px;
    }
    .workspace {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .selection-panel {
    background: var(--color-white);
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-panel);
    box-sizing: border-box;
    min-width: 0;
    padding: 20px;
    height: fit-content;
    max-height: 600px;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .selection-header {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--color-hairline);
  }
  .selection-info {
    color: var(--color-muted);
    display: flex;
    flex-wrap: wrap;
    font-size: 0.875rem;
    gap: 4px 12px;
  }
  .selection-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .split-method {
    margin: 16px 0;
    min-width: 0;
  }
  .split-method label {
    display: block;
    font-size: 0.875rem;
    font-weight: 600;
    margin-bottom: 8px;
    color: var(--color-muted);
  }
  .split-method select {
    width: 100%;
    max-width: 100%;
    min-width: 140px;
    padding: 8px 12px;
    border: 1px solid var(--color-hairline);
    border-radius: 6px;
    background: var(--color-white);
  }
  .option-field {
    margin: 12px 0;
  }
  .option-field label {
    display: block;
    font-size: 0.875rem;
    font-weight: 600;
    margin-bottom: 6px;
  }
  .option-field input[type='number'] {
    width: 80px;
    padding: 6px;
    border: 1px solid var(--color-hairline);
    border-radius: 6px;
  }
  .option-field input[type='text'] {
    width: 100%;
    max-width: 100%;
    padding: 8px 12px;
    border: 1px solid var(--color-hairline);
    border-radius: 6px;
  }
  .option-hint {
    font-size: 0.8rem;
    color: var(--color-muted);
    margin-top: 4px;
  }
  .processing-indicator {
    padding: 20px;
    text-align: center;
    color: var(--color-muted);
  }
  .output-results {
    margin-top: 24px;
    max-height: 400px;
    overflow-y: auto;
    overflow-x: hidden;
    min-width: 0;
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-panel);
    padding: 16px;
  }
  .output-file {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 4px 12px;
    padding: 8px 0;
    border-bottom: 1px solid var(--color-hairline);
    min-width: 0;
  }
  .output-file:last-child {
    border-bottom: none;
  }
  .output-file button {
    background: none;
    border: none;
    color: var(--primary-color, #0ea5e9);
    cursor: pointer;
    font-size: 0.875rem;
    text-decoration: none;
  }
  .output-file button:hover {
    text-decoration: underline;
  }
  .output-results :global(.button) {
    margin-top: 16px;
    width: 100%;
  }
  .output-summary {
    margin: 12px 0;
    padding: 12px;
    background: color-mix(in srgb, var(--color-white) 85%, transparent);
    border-radius: var(--radius-panel);
    border: 1px solid var(--color-hairline);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .output-summary h3 {
    font-size: 0.875rem;
    margin: 0 0 8px;
    color: var(--color-muted);
  }
  .empty {
    color: var(--color-muted);
    padding: 20px;
    text-align: center;
  }
</style>

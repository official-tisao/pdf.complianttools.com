<script lang="ts">
  import PageGrid from '@pdf-complianttools/ui/PageGrid.svelte';
  import Button from '@pdf-complianttools/ui/Button.svelte';
  import FileDrop from '@pdf-complianttools/ui/FileDrop.svelte';
  import { download, firstBytes } from '$lib/pdf-download';
  import { JSONLD_CLOSE, JSONLD_OPEN, softwareApplicationLd } from '$lib/seo';
  import { page } from '$app/state';
  import { loadPdfJs } from '@pdf-complianttools/engine/pdfjs';
  import type * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

  let files = $state<File[]>([]);
  let pageCount = $state(0);
  let selected = $state<number[]>([]);
  /**
   * The current page order, 1-based. Held here rather than inside PageGrid
   * because the grid virtualizes: it renders a window of pages and does not
   * know the sequence, so a keyboard move has to be applied by the owner.
   */
  let order = $state<number[]>([]);
  let focusedPage = $state(1);
  let previewDocument = $state<Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>>();
  let previewKey = $state('');
  let focusedPreview = $state('');
  let status = $state('');
  let error = $state('');
  let busy = $state(false);
  const description =
    'Reorder PDF pages in an accessible, keyboard-navigable thumbnail grid. Drag, or use Alt with the arrow keys, and export the new order locally.';
  const structuredData = $derived(
    softwareApplicationLd({ name: 'Organize PDF pages', description, path: page.url.pathname }),
  );

  const originalOrder = $derived(Array.from({ length: pageCount }, (_, index) => index + 1));
  const reordered = $derived(pageCount > 0 && order.some((page, index) => page !== index + 1));

  async function selectFiles(fileList: FileList | null) {
    if (!fileList) return;
    files = Array.from(fileList);
    status = '';
    error = '';
    selected = [];
    order = [];
    focusedPage = 1;
    focusedPreview = '';
    previewDocument = undefined;
    previewKey = '';
    pageCount = 0;
    if (files.length === 0) return;
    try {
      // pdf.js is ~500 KB and is only needed to count pages here, so it is
      // loaded on demand rather than on page load.
      const bytes = await firstBytes(files);
      const document_ = await (await loadPdfJs()).getDocument({ data: bytes.slice() }).promise;
      previewDocument = document_;
      previewKey = `${files[0]!.name}:${files[0]!.size}:${files[0]!.lastModified}`;
      pageCount = document_.numPages;
      order = originalOrder;
      focusedPreview = await renderPreviewPage(1, 0.7);
    } catch (error_) {
      pageCount = 0;
      previewDocument = undefined;
      focusedPreview = '';
      error = error_ instanceof Error ? error_.message : 'This PDF could not be read locally.';
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
    toggle(pageNumber);
  }

  function applyChange(change: readonly number[] | { type: 'move'; page: number; to: number }) {
    // `Array.isArray` does not narrow a `readonly number[]` union member, so
    // the drag shape is detected structurally.
    if (typeof change === 'object' && change !== null && 'type' in change) {
      // Keyboard move: take the page out of its slot and reinsert it, keeping
      // every other page in its existing relative order.
      const next = order.filter((page) => page !== change.page);
      const target = Math.max(0, Math.min(next.length, change.to - 1));
      next.splice(target, 0, change.page);
      order = next;
      return;
    }
    order = [...(change as readonly number[])];
  }

  function toggle(page: number) {
    selected = selected.includes(page) ? selected.filter((p) => p !== page) : [...selected, page];
  }

  function reset() {
    order = [...originalOrder];
    selected = [];
    status = 'Order reset to the original sequence.';
  }

  async function apply() {
    if (files.length === 0 || pageCount === 0) return;
    busy = true;
    status = 'Working locally…';
    try {
      const { reorderPages } = await import('@pdf-complianttools/engine');
      download(
        await reorderPages(
          await firstBytes(files),
          order.length === pageCount ? order : originalOrder,
        ),
        'organized.pdf',
      );
      status = 'Done. Your original file was not changed.';
    } catch (error_) {
      error = error_ instanceof Error ? error_.message : 'The operation could not be completed.';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>Organize PDF pages locally</title>
  <!--
    This route was hand-written during the wiring phase and shipped with a title
    alone. Every other shell owns its description and JSON-LD, and Appendix E
    requires both — the SPCC check is what surfaced the omission.
  -->
  <meta name="description" content={description} />
  <!-- safe-html-reviewed: JSON-LD needs a script element Svelte cannot emit; the payload is JSON.stringify from $lib/seo with "<" escaped, tested in scripts/seo.test.mjs -->
  {@html JSONLD_OPEN + structuredData + JSONLD_CLOSE}
</svelte:head>
<div class="organize">
  <header>
    <h1>Organize Pages</h1>
    <p>{description}</p>
    <p class="hint">
      Use the arrow keys to move focus and <kbd>Alt</kbd> + arrows to move the page itself; no pointer
      required.
    </p>
  </header>

  <FileDrop onchange={selectFiles} multiple={false} label="Drop a PDF here, or choose a file" />

  {#if pageCount > 0}
    <div class="toolbar">
      <span>{pageCount} pages</span>
      <Button onclick={reset} disabled={!reordered}>Reset order</Button>
      <Button onclick={apply} disabled={busy}>
        {reordered ? 'Save new order' : 'Save order'}
      </Button>
    </div>
    <PageGrid
      {pageCount}
      {selected}
      reorderable
      thumbnailKey={previewKey}
      thumbnailLoader={(pageNumber) => renderPreviewPage(pageNumber, 0.22)}
      onselect={(pageNumber) => void focusPage(pageNumber)}
      onreorder={applyChange}
    />
    {#if focusedPreview}
      <section class="focused-page" aria-live="polite" aria-label="Selected page preview">
        <h2>Page {focusedPage}</h2>
        <img src={focusedPreview} alt="Preview of selected PDF page" />
      </section>
    {/if}
    {#if status}<p class="status" role="status">{status}</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  {:else if !error}
    <p class="empty">Choose a PDF to see its pages.</p>
  {/if}
</div>

<style>
  .organize {
    margin: 0 auto;
    max-width: 1100px;
    padding: 48px 40px;
  }
  h1 {
    font-size: clamp(1.75rem, 4vw, 2.5rem);
    letter-spacing: -0.04em;
    margin: 0 0 8px;
  }
  header p {
    color: var(--color-muted, #6b6862);
    margin: 0 0 24px;
    max-width: 62ch;
  }
  kbd {
    background: var(--color-hairline, #1c1a171a);
    border-radius: 4px;
    font-size: 0.875em;
    padding: 1px 5px;
  }
  .toolbar {
    align-items: center;
    display: flex;
    gap: 12px;
    margin: 20px 0 12px;
  }
  .toolbar span {
    color: var(--color-muted, #6b6862);
  }
  .status,
  .empty {
    color: var(--color-muted, #6b6862);
  }
  .error {
    color: #8a2b2b;
  }
  .focused-page {
    margin-top: 20px;
    max-width: 560px;
  }
  .focused-page h2 {
    font-size: 1rem;
  }
  .focused-page img {
    background: #fff;
    border: 1px solid var(--color-hairline, #1c1a171a);
    display: block;
    max-width: 100%;
  }
</style>

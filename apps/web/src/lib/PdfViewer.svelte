<script lang="ts">
  import { onDestroy } from 'svelte';
  import FileDrop from '@pdf-complianttools/ui/FileDrop.svelte';
  import Button from '@pdf-complianttools/ui/Button.svelte';
  import {
    extractPdfTextPages,
    getPdfOutline,
    searchPdfText,
    type PdfOutlineItem,
    type PdfTextPage,
  } from '@pdf-complianttools/engine';
  import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
  import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  type FlatOutline = PdfOutlineItem & { readonly level: number };
  /* global HTMLCanvasElement */
  let canvas: HTMLCanvasElement;
  let bytes = $state<Uint8Array>();
  let pages = $state<PdfTextPage[]>([]);
  let outline = $state<FlatOutline[]>([]);
  let currentPage = $state(1);
  let scale = $state(1);
  let query = $state('');
  let matches = $state<Awaited<ReturnType<typeof searchPdfText>>>([]);
  let status = $state('Choose a PDF to view locally.');
  let document = $state<Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>>();
  let loadingTask: ReturnType<typeof pdfjs.getDocument> | undefined;

  function flatten(items: readonly PdfOutlineItem[], level = 0): FlatOutline[] {
    return items.flatMap((item) => [{ ...item, level }, ...flatten(item.items, level + 1)]);
  }

  async function renderPage() {
    if (!document || !canvas) return;
    const page = await document.getPage(currentPage);
    const viewport = page.getViewport({ scale });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) {
      status = 'The browser canvas is unavailable; the PDF remains available for print.';
      return;
    }
    await page.render({ canvas: canvas, canvasContext: context, viewport }).promise;
    status = `Page ${currentPage} of ${document.numPages}. Local viewer ready.`;
  }

  async function selectFile(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
      loadingTask?.destroy();
      loadingTask = pdfjs.getDocument({ data: bytes });
      document = await loadingTask.promise;
      pages = [...(await extractPdfTextPages(bytes))];
      outline = flatten(await getPdfOutline(bytes));
      currentPage = 1;
      scale = 1;
      await renderPage();
    } catch (error) {
      status = error instanceof Error ? error.message : 'This PDF could not be opened locally.';
    }
  }

  async function findMatches() {
    if (!bytes) return;
    matches = [...(await searchPdfText(bytes, query))];
    const first = matches[0];
    if (first) {
      currentPage = first.pageNumber;
      await renderPage();
    }
  }

  function selectOutline(item: FlatOutline) {
    if (!item.pageNumber) return;
    currentPage = item.pageNumber;
    void renderPage();
  }

  onDestroy(() => loadingTask?.destroy());
</script>

<section class="viewer" aria-labelledby="viewer-heading">
  <div class="intro">
    <p class="eyebrow">LOCAL READER</p>
    <h1 id="viewer-heading">PDF viewer</h1>
    <p class="lede">Read, search, navigate, zoom, and print without uploading the document.</p>
  </div>
  <FileDrop
    accept=".pdf,application/pdf"
    multiple={false}
    label="Drop a PDF here or choose one"
    onchange={selectFile}
  />
  <div class="toolbar" aria-label="Viewer controls">
    <Button
      variant="secondary"
      disabled={!document || scale <= 0.5}
      onclick={() => {
        scale = Math.max(0.5, scale - 0.25);
        void renderPage();
      }}>Zoom out</Button
    >
    <span aria-live="polite"
      >{document
        ? `${currentPage} / ${document.numPages} · ${Math.round(scale * 100)}%`
        : 'No PDF selected'}</span
    >
    <Button
      variant="secondary"
      disabled={!document || scale >= 3}
      onclick={() => {
        scale = Math.min(3, scale + 0.25);
        void renderPage();
      }}>Zoom in</Button
    >
    <Button variant="secondary" disabled={!document} onclick={() => globalThis.print()}
      >Print</Button
    >
  </div>
  <div class="search-row">
    <label for="viewer-search">Search this PDF</label>
    <input
      id="viewer-search"
      bind:value={query}
      onkeydown={(event) => event.key === 'Enter' && void findMatches()}
      placeholder="Find text"
    />
    <Button disabled={!document || !query.trim()} onclick={findMatches}>Find</Button>
    <span aria-live="polite"
      >{matches.length ? `${matches.length} match${matches.length === 1 ? '' : 'es'}` : ''}</span
    >
  </div>
  <div class="viewer-layout">
    <aside class="outline" aria-labelledby="outline-heading">
      <h2 id="outline-heading">Outline</h2>
      {#if outline.length}
        <ul>
          {#each outline as item (item.title + item.level)}
            <li style={`padding-left: ${item.level * 12}px`}>
              <button type="button" disabled={!item.pageNumber} onclick={() => selectOutline(item)}
                >{item.title}{item.pageNumber ? ` · ${item.pageNumber}` : ''}</button
              >
            </li>
          {/each}
        </ul>
      {:else}<p>No outline entries were found.</p>{/if}
      {#if pages.length}<h2>Text pages</h2>
        <p>{pages.length} pages extracted locally for search.</p>{/if}
    </aside>
    <div class="page-column">
      <div class="page-picker">
        <label for="page-number">Page</label>
        <input
          id="page-number"
          type="number"
          min="1"
          max={document?.numPages ?? 1}
          bind:value={currentPage}
          onchange={() => void renderPage()}
        />
      </div>
      <div class="page-stage" aria-label="Rendered PDF page">
        <canvas bind:this={canvas}></canvas>
      </div>
      {#if matches.length}
        <ol class="matches" aria-label="Search matches">
          {#each matches as match, index (match.pageNumber + '-' + match.index)}
            <li>
              <button
                type="button"
                onclick={() => {
                  currentPage = match.pageNumber;
                  void renderPage();
                }}>Match {index + 1}: page {match.pageNumber} — {match.context}</button
              >
            </li>
          {/each}
        </ol>
      {/if}
      <p class="status" role="status" aria-live="polite">{status}</p>
    </div>
  </div>
</section>

<style>
  .viewer {
    margin: auto;
    max-width: 1280px;
    padding: 72px 40px 0;
  }
  .intro {
    max-width: 720px;
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
  h2 {
    font-size: 1rem;
    margin: 0 0 12px;
  }
  .lede,
  .status,
  .outline p {
    color: var(--color-muted);
  }
  .toolbar,
  .search-row,
  .page-picker {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .toolbar,
  .search-row {
    margin-top: 20px;
  }
  .toolbar span,
  .search-row span {
    color: var(--color-muted);
  }
  .search-row label,
  .page-picker label {
    font-weight: 600;
  }
  input {
    border: 1px solid var(--color-hairline);
    border-radius: 6px;
    font: inherit;
    min-height: 36px;
    padding: 6px 8px;
  }
  .search-row input {
    min-width: min(360px, 70vw);
  }
  .viewer-layout {
    display: grid;
    gap: 24px;
    grid-template-columns: 240px minmax(0, 1fr);
    margin-top: 24px;
  }
  .outline {
    background: var(--color-white);
    border: 1px solid var(--color-hairline);
    border-radius: 8px;
    padding: 20px;
  }
  .outline ul,
  .matches {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .outline li + li,
  .matches li + li {
    margin-top: 8px;
  }
  .outline button,
  .matches button {
    background: transparent;
    border: 0;
    cursor: pointer;
    font: inherit;
    padding: 0;
    text-align: left;
  }
  .outline button:disabled {
    color: var(--color-muted);
    cursor: default;
  }
  .page-column {
    min-width: 0;
  }
  .page-picker {
    margin-bottom: 12px;
  }
  .page-picker input {
    width: 80px;
  }
  .page-stage {
    align-items: flex-start;
    background: #464442;
    border-radius: 8px;
    display: flex;
    justify-content: center;
    min-height: 480px;
    overflow: auto;
    padding: 24px;
  }
  canvas {
    background: #fff;
    box-shadow: 0 0 0 1px #1c1a1722;
    max-width: 100%;
    height: auto;
  }
  .matches {
    background: var(--color-white);
    border: 1px solid var(--color-hairline);
    border-radius: 8px;
    margin-top: 16px;
    padding: 16px;
  }
  .status {
    margin-top: 16px;
  }
  @media (max-width: 767px) {
    .viewer {
      padding-inline: 24px;
    }
    .viewer-layout {
      grid-template-columns: 1fr;
    }
    .outline {
      order: 2;
    }
  }
  @media print {
    .intro,
    .viewer > :not(.viewer-layout),
    .outline,
    .page-picker,
    .matches,
    .status {
      display: none;
    }
    .viewer,
    .viewer-layout,
    .page-column,
    .page-stage {
      padding: 0;
      margin: 0;
      display: block;
      background: transparent;
    }
    canvas {
      max-width: 100%;
    }
  }
</style>

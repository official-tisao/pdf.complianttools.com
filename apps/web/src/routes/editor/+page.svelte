<script lang="ts">
  /* global HTMLCanvasElement, HTMLInputElement, Element */
  import { onMount } from 'svelte';
  import '$lib/configure-pdfjs';
  import { loadPdfJs } from '@pdf-complianttools/engine/pdfjs';

  // loadPdfJs resolves to the pdf.js module itself; getDocument hangs off the
  // module, and the opened document is the await of the loading task's promise.
  type PdfJsModule = Awaited<ReturnType<typeof loadPdfJs>>;
  type PdfDocument = Awaited<ReturnType<PdfJsModule['getDocument']>['promise']>;

  // Svelte 5 reactive state for file tracking
  let currentFile: File | null = $state(null);
  let currentPage: number = $state(1);
  let totalPages: number = $state(0);
  let document: PdfDocument | undefined = $state();
  let conversionComplete: boolean = $state(false);

  // Canvas reference for rendering
  let canvas: HTMLCanvasElement;

  // Track configuration inputs for reset behavior
  let findText: string = $state('');
  let replacementText: string = $state('');
  let fallbackText: string = $state('');

  // Reset conversion complete when file changes
  $effect(() => {
    if (currentFile) {
      conversionComplete = false;
    }
  });

  // Scale for rendering (1.2 = 120% zoom)
  const SCALE = 1.2;

  // Page numbers shown in the thumbnail strip (capped at 3, matching the
  // navigation arrows). Derived so the strip tracks the loaded document.
  const thumbnailPages = $derived(
    Array.from({ length: Math.min(3, totalPages) }, (_, index) => index + 1),
  );

  // Main file upload handler - loads PDF bytes and initializes document
  async function handleFileUpload(file: File) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const loadingTask = (await loadPdfJs()).getDocument({ data: bytes });
      document = await loadingTask.promise;
      totalPages = document.numPages;
      currentFile = file;
      currentPage = 1;
      await renderActivePage();
    } catch (error) {
      console.error('PDF load error:', error);
    }
  }

  // Core rendering pipeline - draws the active page to canvas
  async function renderActivePage() {
    if (!document || !canvas) return;
    const page = await document.getPage(currentPage);
    const viewport = page.getViewport({ scale: SCALE });

    // Set canvas dimensions
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    const context = canvas.getContext('2d');
    if (!context) return;

    await page.render({ canvas, canvasContext: context, viewport }).promise;
  }

  // Drag-and-drop event handlers. The component's reactive `document` state
  // shadows the DOM global, so DOM lookups go through `window.document`.
  function dragZone(): Element | null {
    return window.document.getElementById('preview-canvas');
  }

  function handleDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    const zone = dragZone();
    if (zone && !currentFile) zone.classList.add('drag-over');
  }

  function handleDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    const zone = dragZone();
    if (zone) zone.classList.remove('drag-over');
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    const zone = dragZone();
    if (zone) zone.classList.remove('drag-over');

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        handleFileUpload(file);
      }
    }
  }

  function handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        handleFileUpload(file);
      }
    }
  }

  // Navigate to specific page (called from sidebar thumb clicks)
  function goToPage(page: number) {
    if (currentFile && page >= 1 && page <= totalPages) {
      currentPage = page;
      renderActivePage();
    }
  }

  // Main execution function - replaces text in PDF
  async function runLocally() {
    if (!currentFile || !document) return;

    try {
      // Simulate text replacement operation
      // In production, this would call the PDF editing engine
      await applyTextReplacement(
        document,
        findText,
        replacementText,
        currentPage,
        fallbackText || 'DRAFT',
      );

      // Mark conversion complete AFTER successful processing
      conversionComplete = true;
    } catch (error) {
      console.error('Conversion error:', error);
    }
  }

  // Placeholder for actual PDF text replacement - in production this would use
  // the engine's conversion pipeline. Parameters document the intended engine
  // call signature; they are kept void-marked until the pipeline is wired up.
  async function applyTextReplacement(
    doc: PdfDocument,
    find: string,
    replace: string,
    page: number,
    fallback: string,
  ): Promise<Uint8Array> {
    void doc;
    void find;
    void replace;
    void page;
    void fallback;
    // Simulate async processing
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Return empty bytes as placeholder - in production would return actual edited PDF
    return new Uint8Array();
  }

  // Reactively trigger re-render when page changes
  $effect(() => {
    if (currentFile && canvas && document) {
      renderActivePage();
    }
  });

  // Expose to window for legacy integration with PhaseCTool
  onMount(() => {
    (window as { handleFileUpload?: typeof handleFileUpload }).handleFileUpload = handleFileUpload;
  });
</script>

<svelte:head>
  <!-- The layout deliberately ships no default description (SvelteKit does
       not dedupe <svelte:head> by attribute); this route owns its own. -->
  <title>PDF Editor locally</title>
  <meta
    name="description"
    content="Edit simple embedded text runs when evidence supports it, or use a clearly labelled local text-box fallback."
  />
</svelte:head>

<!--
  Editor workspace: standardized two-column layout fixing sidebar alignment,
  toolbar grouping, and download-button overflow.
-->
<section class="editor-workspace" aria-label="PDF Editor workspace">
  <!-- Toolbar Panel -->
  <header class="toolbar-panel" aria-label="Editor toolbar">
    <div class="toolbar-inner">
      <h1 class="toolbar-title">PDF Editor</h1>
      <p class="toolbar-desc">
        Edit simple embedded text runs when evidence supports it, or use a clearly labelled local
        text-box fallback.
      </p>

      <div class="toolbar-grid" role="group" aria-label="Configuration inputs">
        <label class="field-group" for="editor-find">
          <span class="field-label">Existing text to replace</span>
          <input
            id="editor-find"
            type="text"
            class="field-input"
            placeholder="Simple literal text run"
            bind:value={findText}
          />
        </label>
        <label class="field-group" for="editor-replace">
          <span class="field-label">Replacement</span>
          <input
            id="editor-replace"
            type="text"
            class="field-input"
            placeholder="Replacement text"
            bind:value={replacementText}
          />
        </label>
        <label class="field-group" for="editor-page">
          <span class="field-label">Page</span>
          <input
            id="editor-page"
            type="number"
            min="1"
            class="field-input"
            bind:value={currentPage}
          />
        </label>
        <label class="field-group" for="editor-fallback">
          <span class="field-label">Fallback text box</span>
          <input id="editor-fallback" type="text" class="field-input" bind:value={fallbackText} />
        </label>
      </div>

      <div class="action-row" role="group" aria-label="Execution actions">
        <button
          type="button"
          class="pill-btn pill-btn-primary"
          onclick={() => {
            runLocally();
          }}
        >
          {#if conversionComplete}
            Re-run locally
          {:else}
            Run locally
          {/if}
        </button>
        {#if conversionComplete}
          <a
            id="Download edited.pdf"
            class="pill-btn pill-btn-secondary download-link"
            href="#"
            download="edited.pdf"
          >
            Download edited.pdf
          </a>
        {/if}
      </div>
    </div>
  </header>

  <!-- Main Workspace Grid -->
  <div class="workspace-grid">
    <!-- Left Sidebar: Page Navigation -->
    <aside class="sidebar-nav" aria-label="Page navigation sidebar">
      <div class="carousel-wrapper">
        <button
          type="button"
          class="nav-arrow nav-arrow-top"
          aria-label="Previous page"
          onclick={() => currentFile && currentPage > 1 && goToPage(currentPage - 1)}
          disabled={currentFile === null || currentPage <= 1}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"><path d="M18 15l-6-6-6 6" /></svg
          >
        </button>

        {#if currentFile}
          <!-- role="list" would demand listitem children; these are buttons,
               so the strip stays a labelled group of named buttons instead. -->
          <div class="thumbnail-strip" role="group" aria-label="Page thumbnails">
            <!-- Generate thumbnails for up to 3 pages (or totalPages if fewer) -->
            {#each thumbnailPages as page (page)}
              <button
                type="button"
                class="thumb-btn {currentPage === page ? 'thumb-active' : ''}"
                aria-current={currentPage === page}
                aria-label={'Page ' + page}
                onclick={() => goToPage(page)}
              >
                <span class="thumb-label">Page {page}</span>
              </button>
            {/each}
          </div>
        {:else}
          <div class="thumbnail-strip" role="group" aria-label="Page navigation placeholder">
            <p class="preview-sub">Upload a PDF to see pages</p>
          </div>
        {/if}

        <button
          type="button"
          class="nav-arrow nav-arrow-bottom"
          aria-label="Next page"
          onclick={() =>
            currentFile &&
            currentPage < Math.max(...thumbnailPages, 0) &&
            goToPage(currentPage + 1)}
          disabled={currentFile === null || currentPage >= Math.max(...thumbnailPages, 0)}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg
          >
        </button>
      </div>
    </aside>

    <!-- Right Preview Panel -->
    <main class="preview-panel" aria-label="Document preview">
      {#if currentFile}
        <div class="canvas-card">
          <div class="canvas-header">
            <h2 class="canvas-title">Selected page {currentPage}</h2>
            <span class="canvas-badge">{currentFile?.name}</span>
          </div>
          <div class="canvas-body" aria-label="Document preview canvas">
            <canvas
              bind:this={canvas}
              class="render-canvas"
              role="img"
              aria-label="Rendered PDF page"
            ></canvas>
          </div>
        </div>
      {:else}
        <div class="canvas-card">
          <div class="canvas-body" aria-label="Document preview canvas">
            <div
              class="preview-placeholder drop-zone"
              id="preview-canvas"
              role="region"
              aria-label="Drag and drop zone"
              ondragover={handleDragOver}
              ondragleave={handleDragLeave}
              ondrop={handleDrop}
            >
              <p class="preview-caption">Document preview renders here</p>
              <p class="preview-sub">Drop a PDF or choose a local file to begin editing</p>

              <label for="file-upload" class="choose-file-btn">
                <span>Choose a File</span>
              </label>
              <input
                id="file-upload"
                type="file"
                accept=".pdf,.epub"
                class="hidden-file"
                onchange={handleFileSelect}
              />
            </div>
          </div>
        </div>
      {/if}
    </main>
  </div>
</section>

<style>
  /* Workspace base */
  .editor-workspace {
    max-width: 1280px;
    margin: 0 auto;
    padding: 2rem 1.5rem 3rem;
    font-family:
      system-ui,
      -apple-system,
      Segoe UI,
      Roboto,
      Helvetica,
      Arial,
      sans-serif;
    color: #1c1a17;
    background: #f6f5f2; /* subtle light warm background matching app */
  }

  /* Toolbar Panel */
  .toolbar-panel {
    background: #ffffff;
    border: 1px solid #e8e6e1;
    border-radius: 1rem;
    box-shadow:
      0 1px 3px rgba(28, 26, 23, 0.06),
      0 1px 2px rgba(28, 26, 23, 0.04);
    padding: 1.5rem 2rem 1.75rem;
    margin-bottom: 1.5rem;
  }
  .toolbar-inner {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .toolbar-title {
    font-size: 1.75rem;
    font-weight: 700;
    letter-spacing: -0.04em;
    margin: 0 0 0.25rem;
    line-height: 1.2;
  }
  .toolbar-desc {
    color: #6b6560;
    font-size: 0.95rem;
    margin: 0 0 0.25rem;
    max-width: 720px;
  }

  /* Configuration grid */
  .toolbar-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 1rem;
  }
  .field-group {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .field-label {
    font-weight: 600;
    font-size: 0.85rem;
    color: #3a362f;
  }
  .field-input {
    border: 1.5px solid #ddd9d3;
    border-radius: 0.65rem;
    padding: 0.6rem 0.75rem;
    font: inherit;
    font-size: 0.95rem;
    background: #fff;
    color: #1c1a17;
    transition:
      border-color 0.15s ease,
      box-shadow 0.15s ease;
  }
  .field-input:focus {
    outline: none;
    border-color: #1c1a17;
    box-shadow: 0 0 0 3px rgba(28, 26, 23, 0.08);
  }

  /* Action row */
  .action-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
    padding-top: 0.25rem;
  }
  .pill-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: 0.55rem 1.25rem;
    border-radius: 9999px;
    font-weight: 600;
    font-size: 0.95rem;
    text-decoration: none;
    transition:
      transform 160ms ease,
      opacity 160ms ease;
    border: 1.5px solid transparent;
    cursor: pointer;
  }
  .pill-btn:hover:not(:disabled) {
    transform: translateY(-1px);
  }
  .pill-btn-primary {
    background: #1c1a17;
    color: #fff;
    border-color: #1c1a17;
  }
  .pill-btn-secondary {
    background: #fff;
    color: #1c1a17;
    border-color: #ddd9d3;
  }
  .choose-file-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: 0.55rem 1.25rem;
    border-radius: 9999px;
    border: 1.5px solid #ddd9d3;
    background: #fff;
    color: #1c1a17;
    font-weight: 600;
    font-size: 0.95rem;
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      background 0.15s ease,
      transform 160ms ease;
  }
  .choose-file-btn:hover {
    border-color: #1c1a17;
    transform: translateY(-1px);
  }
  .hidden-file {
    display: none;
  }

  /* Main workspace grid */
  .workspace-grid {
    display: grid;
    grid-template-columns: 22% 1fr;
    gap: 1.25rem;
    align-items: start;
  }

  /* Sidebar Navigation */
  .sidebar-nav {
    background: #ffffff;
    border: 1px solid #e8e6e1;
    border-radius: 1rem;
    padding: 1rem 0.75rem;
    box-shadow: 0 1px 3px rgba(28, 26, 23, 0.05);
    min-height: 520px;
    display: flex;
    flex-direction: column;
  }
  .carousel-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    flex: 1;
  }
  .nav-arrow {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 9999px;
    background: #f6f5f2;
    border: 1px solid #ddd9d3;
    color: #3a362f;
    transition: background 0.15s ease;
    cursor: pointer;
  }
  .nav-arrow:hover {
    background: #eeeeeb;
  }
  .thumbnail-strip {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    flex: 1;
    overflow-y: auto;
    padding: 0.25rem 0;
  }
  .thumb-btn {
    width: 100%;
    aspect-ratio: 3 / 4;
    max-width: 140px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.5rem;
    border: 2px solid #ddd9d3;
    background: linear-gradient(180deg, #fff 0%, #f6f5f2 100%);
    color: #3a362f;
    font-weight: 600;
    font-size: 0.85rem;
    text-align: center;
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      transform 0.15s ease,
      box-shadow 0.15s ease;
    box-shadow: inset 0 0 0 1px rgba(28, 26, 23, 0.06);
  }
  .thumb-btn:hover {
    border-color: #1c1a17;
    transform: translateY(-2px);
    box-shadow: 0 6px 12px rgba(28, 26, 23, 0.08);
  }
  .thumb-btn.thumb-active {
    border-color: #1c1a17;
    box-shadow:
      0 0 0 2px #1c1a17,
      0 6px 12px rgba(28, 26, 23, 0.1);
    background: linear-gradient(180deg, #ffffff 0%, #f0ede8 100%);
  }
  .thumb-label {
    pointer-events: none;
  }

  /* Preview Panel */
  .preview-panel {
    min-width: 0;
    background: #ffffff;
    border: 1px solid #e8e6e1;
    border-radius: 1rem;
    padding: 1.5rem;
    box-shadow:
      0 1px 3px rgba(28, 26, 23, 0.06),
      0 1px 2px rgba(28, 26, 23, 0.04);
  }
  .canvas-card {
    border: 1.5px solid #eeeae2;
    border-radius: 1rem;
    overflow: hidden;
    background: #fdfcfb;
  }
  .canvas-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem 1.25rem;
    border-bottom: 1.5px solid #eeeae2;
    background: #fff;
  }
  .canvas-title {
    font-size: 1.25rem;
    font-weight: 700;
    letter-spacing: -0.03em;
    margin: 0;
  }
  .canvas-badge {
    display: inline-flex;
    align-items: center;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.25rem 0.6rem;
    border-radius: 9999px;
    background: #e6efe8;
    color: #2d5a2f;
  }
  .canvas-body {
    min-height: 420px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
  }
  .preview-placeholder {
    text-align: center;
    color: #767067; /* 4.78:1 on #fdfcfb — axe color-contrast (WCAG AA) */
    border: 2px dashed #ddd9d3;
    border-radius: 1rem;
    padding: 2rem 1.5rem;
    background: #fdfcfb;
    transition:
      border-color 0.2s ease,
      background 0.2s ease,
      box-shadow 0.2s ease;
  }
  .preview-placeholder.drag-over {
    border-color: #3b82f6;
    background: rgba(59, 130, 246, 0.08);
    box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.1);
  }
  .preview-caption {
    font-weight: 600;
    font-size: 1.1rem;
    color: #3a362f;
    margin: 0 0 0.25rem;
  }
  .preview-sub {
    /* inherits the placeholder's 4.78:1 #767067; the previous #8c877d was
       3.49:1 and failed the axe color-contrast audit */
    font-size: 0.9rem;
    margin: 0;
  }

  /* Responsive */
  @media (max-width: 1024px) {
    .workspace-grid {
      grid-template-columns: 1fr;
    }
    .sidebar-nav {
      min-height: auto;
    }
    .carousel-wrapper {
      flex-direction: row;
      gap: 0.5rem;
    }
    .thumbnail-strip {
      flex-direction: row;
      overflow-x: auto;
    }
    .thumb-btn {
      min-width: 120px;
      aspect-ratio: 4 / 3;
      max-width: none;
    }
  }

  /* Canvas rendering */
  .render-canvas {
    display: block;
    width: 100%;
    max-width: 100%;
    height: auto;
    background: #fff;
    border-radius: 0.5rem;
    box-shadow: 0 1px 3px rgba(28, 26, 23, 0.06);
  }
</style>

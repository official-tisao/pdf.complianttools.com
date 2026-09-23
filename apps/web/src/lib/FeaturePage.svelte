<script lang="ts">
  /* global HTMLInputElement, HTMLSelectElement, location, navigator */
  import {
    assembleScans,
    buildDocumentPack,
    captureWebpageToPdf,
    createInvoicePdf,
    createTemplatedPdf,
    describeRecipe,
    generateQr,
    pickFolder,
    runBatch,
    serializeRecipe,
    FolderWatcher,
    type InvoiceData,
    type Recipe,
  } from '@pdf-complianttools/engine';
  import { saveLocalJson } from '$lib/indexed-store';

  let {
    kind,
    title,
    description,
  }: {
    kind:
      | 'create'
      | 'qr'
      | 'invoice'
      | 'e-invoice'
      | 'scan'
      | 'pack'
      | 'webpage'
      | 'batch'
      | 'recipe'
      | 'watch';
    title: string;
    description: string;
  } = $props();
  let status = $state('');
  let text = $state('https://pdf.complianttools.com');
  let endpoint = $state('');
  let template = $state<'blank' | 'grid' | 'lined' | 'dot'>('blank');
  let files = $state<File[]>([]);
  let recipe = $state<Recipe>({
    version: 'r1',
    steps: [{ op: 'compress', options: { preset: 'balanced' } }],
  });
  let watcher = $state<FolderWatcher | undefined>();

  function download(bytes: Uint8Array, name: string, mime = 'application/pdf') {
    const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: mime }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  function selectFiles(event: Event) {
    files = Array.from((event.currentTarget as HTMLInputElement).files ?? []);
  }
  async function create() {
    const bytes = createTemplatedPdf({
      template,
      pages: [{ title: 'Local PDF', lines: ['Created in your browser.', 'No file was uploaded.'] }],
    });
    download(bytes, 'created.pdf');
    status = 'Created locally.';
  }
  async function qr() {
    const result = await generateQr({ kind: 'text', value: text });
    download(result.pdf, 'qr-code.pdf');
    status = `Generated deterministic QR version ${result.version}.`;
  }
  const invoice: InvoiceData = {
    invoiceNumber: 'INV-0001',
    issueDate: '2026-09-23',
    currency: 'CAD',
    supplier: { name: 'Local Supplier' },
    customer: { name: 'Local Customer' },
    lines: [{ description: 'PDF service', quantity: 1, unitPrice: 100, taxRate: 13 }],
  };
  async function makeInvoice() {
    await saveLocalJson('invoice.template', invoice);
    const result = await createInvoicePdf(invoice);
    download(result.pdf, 'invoice.pdf');
    status = `Invoice created locally. Total ${result.totals.gross.toFixed(2)} ${invoice.currency}.`;
  }
  async function scan() {
    const frames = files.map(async (file) => ({
      bytes: new Uint8Array(await file.arrayBuffer()),
      format: file.type === 'image/jpeg' ? ('jpg' as const) : ('png' as const),
    }));
    const result = await assembleScans(await Promise.all(frames));
    download(result, 'scan.pdf');
    status =
      'Scan assembled locally; camera permission is only requested after an explicit capture action.';
  }
  async function pack() {
    const attachments = await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      })),
    );
    download(await buildDocumentPack('Document pack', attachments), 'document-pack.pdf');
    status = 'Document pack built locally with a generated table of contents.';
  }
  async function webpage() {
    const result = await captureWebpageToPdf(text, endpoint);
    download(result.bytes, 'webpage.pdf');
    status = 'Relay capture completed.';
  }
  async function batch() {
    const inputs = await Promise.all(
      files.map((file) => file.arrayBuffer().then((bytes) => new Uint8Array(bytes))),
    );
    const results = await runBatch(inputs, recipe, { concurrency: 2 });
    status = `${results.filter((item) => item.status === 'succeeded').length}/${results.length} files completed locally.`;
  }
  async function shareRecipe() {
    await saveLocalJson('recipe.current', recipe);
    const link = `${location.origin}/recipe#${await serializeRecipe(recipe)}`;
    await navigator.clipboard?.writeText(link);
    status = `${describeRecipe(recipe)}. Share link copied; it contains no document bytes.`;
  }
  async function startWatch() {
    const directory = await pickFolder();
    watcher = new FolderWatcher(directory, {
      onFile: async (file) => {
        status = `New file detected: ${file.name}`;
      },
    });
    await watcher.start();
    status = 'Folder watcher running. Processing is local and permissioned.';
  }
</script>

<svelte:head
  ><title>{title} — pdf.complianttools.com</title><meta
    name="description"
    content={description}
  /></svelte:head
>

<section class="feature-page">
  <p class="eyebrow">LOCAL WORKFLOW</p>
  <h1>{title}</h1>
  <p class="lede">{description}</p>
  {#if kind === 'create'}
    <label
      >Template <select bind:value={template}
        ><option value="blank">Blank</option><option value="grid">Grid</option><option value="lined"
          >Lined</option
        ><option value="dot">Dot</option></select
      ></label
    ><button onclick={create}>Create PDF</button>
  {:else if kind === 'qr'}
    <label>Text or URL <input bind:value={text} /></label><button onclick={qr}>Export QR PDF</button
    >
  {:else if kind === 'invoice' || kind === 'e-invoice'}
    <p class="note">
      The starter form is local and deterministic. Review every amount before issuing a business
      document.
    </p>
    <button onclick={makeInvoice}>Create invoice and structured XML</button>
  {:else if kind === 'scan'}
    <input type="file" accept="image/png,image/jpeg" multiple onchange={selectFiles} /><button
      disabled={!files.length}
      onclick={scan}>Assemble scan to PDF</button
    >
  {:else if kind === 'pack'}
    <input type="file" accept="application/pdf,.pdf" multiple onchange={selectFiles} /><button
      disabled={!files.length}
      onclick={pack}>Build document pack</button
    >
  {:else if kind === 'webpage'}
    <label>Public webpage URL <input bind:value={text} /></label><label
      >Your Relay endpoint <input
        bind:value={endpoint}
        placeholder="http://127.0.0.1:8787"
      /></label
    >
    <p class="note">
      Webpage capture is explicit Relay mode. Local PDF tools do not need this endpoint.
    </p>
    <button onclick={webpage}>Capture with Relay</button>
  {:else if kind === 'batch'}
    <input type="file" accept="application/pdf,.pdf" multiple onchange={selectFiles} /><button
      disabled={!files.length}
      onclick={batch}>Run local batch</button
    >
    <p class="note">
      Concurrency and memory are bounded; failed files remain individually retryable in the engine
      API.
    </p>
  {:else if kind === 'recipe'}
    <label
      >Step <select
        onchange={(event) => {
          const op = (event.currentTarget as HTMLSelectElement).value as
            'compress' | 'bates' | 'metadata';
          recipe = { ...recipe, steps: [...recipe.steps, { op, options: {} }] };
        }}
        ><option value="compress">Compress</option><option value="bates">Bates numbering</option
        ><option value="metadata">Metadata</option></select
      ></label
    >
    <p class="recipe-description">{describeRecipe(recipe)}</p>
    <button onclick={shareRecipe}>Copy document-free recipe link</button>
  {:else}
    <button onclick={startWatch}>Choose folder and start watcher</button>{#if watcher}<button
        onclick={() => watcher?.pause()}>Pause</button
      ><button onclick={() => watcher?.resume()}>Resume</button><button
        onclick={() => watcher?.stop()}>Stop</button
      >
      <p class="note">
        State: {watcher.state}. No folder is read before permission is granted.
      </p>{/if}
  {/if}
  <p class="status" role="status" aria-live="polite">{status}</p>
</section>

<style>
  .feature-page {
    margin: auto;
    max-width: 960px;
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
  label {
    display: grid;
    gap: 8px;
    margin: 20px 0;
    max-width: 520px;
  }
  input,
  select {
    border: 1px solid var(--color-hairline);
    border-radius: 8px;
    padding: 12px;
    font: inherit;
  }
  button {
    background: var(--color-ink);
    border: 0;
    border-radius: 999px;
    color: white;
    cursor: pointer;
    margin: 8px 8px 8px 0;
    padding: 12px 22px;
  }
  button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
  .note,
  .status,
  .recipe-description {
    color: var(--color-muted);
    line-height: 1.6;
  }
  @media (max-width: 767px) {
    .feature-page {
      padding: 72px 24px 0;
    }
  }
</style>

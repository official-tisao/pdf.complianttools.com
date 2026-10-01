<script lang="ts">
  /* global HTMLInputElement, HTMLSelectElement, location, navigator */
  // Types are erased at build time, so the type-only import costs nothing. The
  // runtime imports use deep subpaths: the engine barrel re-exports every
  // module, so importing it eagerly would pull pdfjs, mammoth, exceljs and
  // pptxgenjs into all ten routes that share this component. Heavier ops
  // (scan, pack, batch, relay, folder watch) are loaded inside their handlers.
  import type { FolderWatcher, Recipe } from '@pdf-complianttools/engine';
  // recipe.ts is zod-only, so importing it eagerly costs nothing and keeps the
  // recipe description in the prerendered HTML.
  import { describeRecipe, serializeRecipe } from '@pdf-complianttools/engine/recipe';
  import { saveLocalJson } from '$lib/indexed-store';
  import { downloadBytes } from '$lib/download';
  import { JSONLD_CLOSE, JSONLD_OPEN, softwareApplicationLd } from '$lib/seo';
  import { translate, type Locale } from '$lib/i18n';
  import { getLocaleContext } from '../routes/__locale/context';
  import { page } from '$app/state';

  let {
    kind,
    title,
    description,
    children,
    locale: localeProp,
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
    children?: import('svelte').Snippet;
    /** The active UI locale; every string below resolves through `translate`. */
    locale?: Locale;
  } = $props();

  const locale = $derived(localeProp ?? getLocaleContext());
  const t = (key: string, fallback: string, ...values: Array<string | number | undefined>) =>
    translate(locale, key, fallback, ...values);
  let status = $state('');
  // Every kind that renders its own control block in the markup below. The
  // invoice kinds deliberately aren't here: they supply their UI via `children`
  // (InvoiceBuilder), so falling through is correct for them and wrong for
  // anything else. A `kind` that is neither handled nor has children renders
  // this notice instead of silently borrowing another tool's controls — which
  // is how the folder watcher once appeared on the invoice routes.
  const SELF_RENDERED: ReadonlySet<string> = new Set([
    'create',
    'qr',
    'scan',
    'pack',
    'webpage',
    'batch',
    'recipe',
    'watch',
  ]);
  let text = $state('https://pdf.complianttools.com');
  let endpoint = $state('');
  let template = $state<'blank' | 'grid' | 'lined' | 'dot'>('blank');
  let files = $state<File[]>([]);
  let recipe = $state<Recipe>({
    version: 'r1',
    steps: [{ op: 'compress', options: { preset: 'balanced' } }],
  });
  let watcher = $state<FolderWatcher | undefined>();
  const structuredData = $derived(
    softwareApplicationLd({ name: title, description, path: page.url.pathname }),
  );

  function download(bytes: Uint8Array, name: string, mime = 'application/pdf') {
    downloadBytes(bytes, name, mime);
  }
  function selectFiles(event: Event) {
    files = Array.from((event.currentTarget as HTMLInputElement).files ?? []);
  }
  async function create() {
    // jspdf is ~950 KB. Only /create-pdf needs it, so it is loaded here
    // rather than statically, keeping it out of every other route.
    const { createTemplatedPdf } = await import('@pdf-complianttools/engine/create');
    const bytes = createTemplatedPdf({
      template,
      pages: [{ title: 'Local PDF', lines: ['Created in your browser.', 'No file was uploaded.'] }],
    });
    download(bytes, 'created.pdf');
    status = t('feature.status.created', 'Created locally.');
  }
  async function qr() {
    const { generateQr } = await import('@pdf-complianttools/engine/qr');
    const result = await generateQr({ kind: 'text', value: text });
    download(result.pdf, 'qr-code.pdf');
    status = t('feature.status.qr', 'Generated deterministic QR version {value}.', result.version);
  }
  async function scan() {
    const frames = files.map(async (file) => ({
      bytes: new Uint8Array(await file.arrayBuffer()),
      format: file.type === 'image/jpeg' ? ('jpg' as const) : ('png' as const),
    }));
    const { assembleScans } = await import('@pdf-complianttools/engine');
    const result = await assembleScans(await Promise.all(frames));
    download(result, 'scan.pdf');
    status = t(
      'feature.status.scan',
      'Scan assembled locally; camera permission is only requested after an explicit capture action.',
    );
  }
  async function pack() {
    const attachments = await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      })),
    );
    const { buildDocumentPack } = await import('@pdf-complianttools/engine');
    download(await buildDocumentPack('Document pack', attachments), 'document-pack.pdf');
    status = t(
      'feature.status.pack',
      'Document pack built locally with a generated table of contents.',
    );
  }
  async function webpage() {
    try {
      const { captureWebpageToPdf } = await import('@pdf-complianttools/engine');
      const result = await captureWebpageToPdf(text, endpoint);
      download(result.bytes, 'webpage.pdf');
      status = t('feature.status.relay', 'Relay capture completed.');
    } catch (caught) {
      // PdfEngineError sets message to its remedy, so this surfaces the Relay's
      // own guidance — a blocked URL, a missing browser binary — rather than a
      // bare failure.
      status =
        caught instanceof Error
          ? caught.message
          : t('feature.status.failed', 'The operation could not be completed.');
    }
  }
  async function batch() {
    const inputs = await Promise.all(
      files.map((file) => file.arrayBuffer().then((bytes) => new Uint8Array(bytes))),
    );
    const { runBatch } = await import('@pdf-complianttools/engine');
    const results = await runBatch(inputs, recipe, { concurrency: 2 });
    status = t(
      'feature.status.batch',
      '{value} of {total} files completed locally.',
      results.filter((item) => item.status === 'succeeded').length,
      results.length,
    );
  }
  async function shareRecipe() {
    await saveLocalJson('recipe.current', recipe);
    const link = `${location.origin}/recipe#${await serializeRecipe(recipe)}`;
    await navigator.clipboard?.writeText(link);
    status = t('feature.status.recipe', 'Share link copied; it contains no document bytes.');
  }
  async function startWatch() {
    const { FolderWatcher, pickFolder } = await import('@pdf-complianttools/engine');
    const directory = await pickFolder();
    watcher = new FolderWatcher(directory, {
      onFile: async (file) => {
        status = t('feature.status.files', 'New file detected: {value}', file.name);
      },
    });
    await watcher.start();
    status = t(
      'feature.status.watch',
      'Folder watcher running. Processing is local and permissioned.',
    );
  }
</script>

<svelte:head>
  <title>{title} — pdf.complianttools.com</title>
  <meta name="description" content={description} />
  <!--
    Canonical and hreflang are emitted per route rather than once in the layout:
    they are path-specific, and a layout-level tag would point every page at the
    same URL, which is the exact error canonical exists to prevent.
  -->
  <!-- safe-html-reviewed: JSON-LD needs a script element Svelte cannot emit; the payload is JSON.stringify from $lib/seo with "<" escaped, tested in scripts/seo.test.mjs -->
  {@html JSONLD_OPEN + structuredData + JSONLD_CLOSE}
</svelte:head>

<section class="feature-page">
  <p class="eyebrow">{t('feature.eyebrow', 'LOCAL WORKFLOW')}</p>
  <h1>{title}</h1>
  <p class="lede">{description}</p>
  {#if kind === 'create'}
    <label
      >{t('feature.template.label', 'Template')}
      <select bind:value={template}
        ><option value="blank">{t('feature.template.blank', 'Blank')}</option><option value="grid"
          >{t('feature.template.grid', 'Grid')}</option
        ><option value="lined">{t('feature.template.lined', 'Lined')}</option><option value="dot"
          >{t('feature.template.dot', 'Dot')}</option
        ></select
      ></label
    ><button onclick={create}>{t('feature.action.create', 'Create PDF')}</button>
  {:else if kind === 'qr'}
    <label>{t('feature.qr.label', 'Text or URL')} <input bind:value={text} /></label><button
      onclick={qr}>{t('feature.qr.action', 'Export QR PDF')}</button
    >
  {:else if kind === 'scan'}
    <label
      >{t('feature.scan.label', 'Scan images')}
      <input type="file" accept="image/png,image/jpeg" multiple onchange={selectFiles} /></label
    ><button disabled={!files.length} onclick={scan}
      >{t('feature.scan.action', 'Assemble scan to PDF')}</button
    >
  {:else if kind === 'pack'}
    <label
      >{t('feature.pack.label', 'Documents to pack')}
      <input type="file" accept="application/pdf,.pdf" multiple onchange={selectFiles} /></label
    ><button disabled={!files.length} onclick={pack}
      >{t('feature.pack.action', 'Build document pack')}</button
    >
  {:else if kind === 'webpage'}
    <label>{t('feature.webpage.label', 'Public webpage URL')} <input bind:value={text} /></label
    ><label
      >{t('feature.webpage.endpoint', 'Your Relay endpoint')}
      <input bind:value={endpoint} placeholder="http://127.0.0.1:8787" /></label
    >
    <p class="note">
      {t(
        'feature.webpage.note',
        'Webpage capture is explicit Relay mode. Local PDF tools do not need this endpoint.',
      )}
    </p>
    <button disabled={!endpoint.trim()} onclick={webpage}
      >{t('feature.webpage.action', 'Capture with Relay')}</button
    >
  {:else if kind === 'batch'}
    <label
      >{t('feature.batch.label', 'PDFs to process')}
      <input type="file" accept="application/pdf,.pdf" multiple onchange={selectFiles} /></label
    ><button disabled={!files.length} onclick={batch}
      >{t('feature.batch.action', 'Run local batch')}</button
    >
    <p class="note">
      {t(
        'feature.batch.note',
        'Concurrency and memory are bounded; failed files remain individually retryable in the engine API.',
      )}
    </p>
  {:else if kind === 'recipe'}
    <label
      >{t('feature.recipe.step', 'Step')}
      <select
        onchange={(event) => {
          const op = (event.currentTarget as HTMLSelectElement).value as
            'compress' | 'bates' | 'metadata';
          recipe = { ...recipe, steps: [...recipe.steps, { op, options: {} }] };
        }}
        ><option value="compress">{t('feature.recipe.compress', 'Compress')}</option><option
          value="bates">{t('feature.recipe.bates', 'Bates numbering')}</option
        >
        ><option value="metadata">{t('feature.recipe.metadata', 'Metadata')}</option></select
      ></label
    >
    <p class="recipe-description">{describeRecipe(recipe)}</p>
    <button onclick={shareRecipe}
      >{t('feature.recipe.action', 'Copy document-free recipe link')}</button
    >
  {:else if kind === 'watch'}
    <button onclick={startWatch}
      >{t('feature.watch.start', 'Choose folder and start watcher')}</button
    >{#if watcher}<button onclick={() => watcher?.pause()}
        >{t('feature.watch.pause', 'Pause')}</button
      >
      ><button onclick={() => watcher?.resume()}>{t('feature.watch.resume', 'Resume')}</button
      >><button onclick={() => watcher?.stop()}>{t('feature.watch.stop', 'Stop')}</button>
      >
      <p class="note">
        {t(
          'feature.watch.note',
          'State: {value}. No folder is read before permission is granted.',
          watcher.state,
        )}
      </p>{/if}
  {/if}
  {#if !SELF_RENDERED.has(kind) && !children}
    <p class="note">{t('feature.noControls', 'This tool has no controls yet. Nothing was run.')}</p>
  {/if}
  {#if children}{@render children()}{/if}
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

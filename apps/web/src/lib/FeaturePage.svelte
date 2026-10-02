<script lang="ts">
  /* global HTMLSelectElement, location, navigator */
  // Types are erased at build time, so the type-only import costs nothing. The
  // runtime imports use deep subpaths: the engine barrel re-exports every
  // module, so importing it eagerly would pull pdfjs, mammoth, exceljs and
  // pptxgenjs into all ten routes that share this component. Heavier ops
  // (scan, pack, batch, relay, folder watch) are loaded inside their handlers.
  import type {
    BatchItemResult,
    FolderWatcher,
    Recipe,
    ScanFrame,
    WatchedFileResult,
  } from '@pdf-complianttools/engine';
  // recipe.ts is zod-only, so importing it eagerly costs nothing and keeps the
  // recipe description in the prerendered HTML.
  import {
    describeRecipe,
    parseRecipe,
    parseSerializedRecipe,
    serializeRecipe,
  } from '@pdf-complianttools/engine/recipe';
  import { loadLocalJson, saveLocalJson } from '$lib/indexed-store';
  import ScanCapture from '$lib/ScanCapture.svelte';
  import { downloadBytes } from '$lib/download';
  import { JSONLD_CLOSE, JSONLD_OPEN, softwareApplicationLd } from '$lib/seo';
  import { translate, type Locale } from '$lib/i18n';
  import FileDrop from '@pdf-complianttools/ui/FileDrop.svelte';
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
  // Camera-captured pages, owned by ScanCapture. Kept separate from `files` so
  // re-picking the file input cannot discard a live capture.
  let capturedFrames = $state<ScanFrame[]>([]);
  let recipe = $state<Recipe>({
    version: 'r1',
    steps: [{ op: 'compress', options: { preset: 'balanced' } }],
  });
  let batchResults = $state<BatchItemResult[]>([]);
  // The input bytes alongside the results, so retry-failed-only can re-run just the failures
  // rather than reprocessing files that already succeeded.
  let batchInputs: Uint8Array[] = $state([]);
  let batchNote = $state('');
  // The recipe fragment already handed to the decoder, so a re-run of the effect below
  // does not decode the same link twice. Deliberately NOT `$state`: a `$state` write inside
  // the effect would become a tracked dependency, the effect would invalidate and re-run,
  // and it would return early on its own marker — never decoding anything.
  let restoredFragment = '';
  // Marks the recipe editor live. Set by the effect that reads the shared fragment, so it
  // only becomes true once this component is interactive on the one route that uses it.
  let hydrated = $state(false);
  let watcher = $state<FolderWatcher | undefined>();
  let watchedFiles = $state<WatchedFileResult[]>([]);
  // Deliberately not `$state`: `watcher.state` is a plain getter on a class instance, so the
  // template never sees it change. Reading it during render creates no dependency, and the page
  // used to sit on "stopped" forever while the watcher was actually running.
  let watcherState = $state('stopped');
  let watchOutputDir = $state<string | undefined>();
  const structuredData = $derived(
    softwareApplicationLd({ name: title, description, path: page.url.pathname }),
  );

  function download(bytes: Uint8Array, name: string, mime = 'application/pdf') {
    downloadBytes(bytes, name, mime);
  }
  function selectFiles(list: FileList | null) {
    files = list ? Array.from(list) : [];
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
    try {
      // Camera frames arrive first, imported images after, and both are pages of
      // the same local document.
      const imported = await Promise.all(
        files.map(async (file) => ({
          bytes: new Uint8Array(await file.arrayBuffer()),
          format: file.type === 'image/jpeg' ? ('jpg' as const) : ('png' as const),
        })),
      );
      const all = [...capturedFrames, ...imported];
      if (!all.length) {
        status = t('feature.status.scanEmpty', 'Capture a page or add image files first.');
        return;
      }
      const { assembleScans } = await import('@pdf-complianttools/engine/scan');
      download(await assembleScans(all), 'scan.pdf');
      status = t(
        'feature.status.scanAssembled',
        `Assembled {value} ${all.length === 1 ? 'page' : 'pages'} locally. Nothing was uploaded.`,
        all.length,
      );
    } catch (caught) {
      // PdfEngineError's message is its remedy, so the user gets an action
      // rather than a bare failure.
      status =
        caught instanceof Error
          ? caught.message
          : t('feature.status.scanFailed', 'The scan could not be assembled.');
    }
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
    // The per-file inputs are kept so a retry can re-run only the failures. Without them a
    // retry-failed-only control has nothing to re-read, and the successes would be reprocessed.
    batchInputs = inputs;
    batchResults = await runBatch(inputs, recipe, {
      concurrency: 2,
      onItem: (item) => {
        batchResults = batchResults.map((existing, at) => (at === item.index ? item : existing));
      },
      onGovern: (concurrency, projected, max) => {
        if (concurrency < 2)
          batchNote = t(
            'feature.batch.governor',
            'Memory limits reduced concurrency to {value}; projected working set is {total} MB against a {extra} MB budget.',
            concurrency,
            Math.round(projected / 1024 / 1024),
            Math.round(max / 1024 / 1024),
          );
      },
    });
    const done = batchResults.filter((item) => item.status === 'succeeded').length;
    status = t(
      'feature.status.batch',
      '{value} of {total} files completed locally. Download the results to retrieve them.',
      done,
      batchResults.length,
    );
  }
  async function retryFailed() {
    const failed = batchResults.filter((item) => item.status === 'failed');
    if (!failed.length || !batchInputs.length) return;
    const { runBatch } = await import('@pdf-complianttools/engine');
    // Only the failures are re-run. Their original indices are preserved so a retry updates the
    // existing rows rather than appending a second entry for the same file.
    const indices = failed.map((item) => item.index);
    const retried = await runBatch(
      indices.map((index) => batchInputs[index]!),
      recipe,
      { concurrency: 2, maxRetries: 2 },
    );
    const byOriginal = new Map(indices.map((index, at) => [index, retried[at]!]));
    batchResults = batchResults.map((item) => byOriginal.get(item.index) ?? item);
    const stillFailing = batchResults.filter((item) => item.status === 'failed').length;
    status = stillFailing
      ? t(
          'feature.status.batchRetryFailed',
          '{value} file(s) still failing after a retry.',
          stillFailing,
        )
      : t('feature.status.batchRetryComplete', 'Every file completed after retrying the failures.');
  }
  async function downloadBatch() {
    if (!batchResults.length) return;
    // Deep subpath and a dynamic import: the batch route is the only one that needs the ZIP
    // packer, and keeping it off the eager path is what stops it reaching every other route.
    const { zipBatchResults } = await import('@pdf-complianttools/engine/batch-zip');
    const { zipBytes } = zipBatchResults(batchResults);
    downloadBytes(zipBytes, 'batch-results.zip', 'application/zip');
    status = t(
      'feature.status.batchDownload',
      'Downloaded a ZIP of the completed files and a manifest of the rest.',
    );
  }
  async function exportRecipe() {
    // Exported through the same schema as everything else, so a file a user keeps cannot carry
    // a shape the engine would refuse to run later. README §4.10 T70 requires the export.
    try {
      const snapshot = JSON.parse(JSON.stringify(recipe)) as Recipe;
      const json = JSON.stringify(parseRecipe(snapshot), null, 2);
      downloadBytes(new TextEncoder().encode(json), 'recipe.json', 'application/json');
      status = t(
        'feature.status.recipeExported',
        'Exported recipe.json. It contains no document bytes.',
      );
    } catch (caught) {
      status =
        caught instanceof Error
          ? `The recipe could not be exported: ${caught.message}`
          : 'The recipe could not be exported.';
    }
  }
  async function saveRecipe() {
    try {
      // A plain snapshot: IndexedDB's structured clone rejects a Svelte 5 `$state` proxy.
      const snapshot = JSON.parse(JSON.stringify(recipe)) as Recipe;
      await saveLocalJson('recipe.current', snapshot);
      status = t(
        'feature.status.recipeSaved',
        'Saved to this browser. It will be here when you come back.',
      );
    } catch (caught) {
      // Sharing is not the only thing that saves, so this needed its own reporting: a rejection
      // here used to leave a blank status line and a button that looked inert.
      status =
        caught instanceof Error
          ? `The recipe could not be saved: ${caught.message}`
          : 'The recipe could not be saved in this browser.';
    }
  }
  async function shareRecipe() {
    let link: string;
    try {
      // A plain snapshot, never the `$state` proxy. IndexedDB uses the structured clone
      // algorithm, which rejects a Svelte proxy outright, and the engine's validators walk
      // the value with `instanceof` checks that a proxy does not answer cleanly.
      const snapshot = JSON.parse(JSON.stringify(recipe)) as Recipe;
      await saveLocalJson('recipe.current', snapshot);
      link = `${location.origin}/recipe#${await serializeRecipe(snapshot)}`;
    } catch (caught) {
      // Sharing is the point of this button. A failure anywhere in it used to reject out
      // of the handler, leaving the status line blank and the button looking inert.
      status =
        caught instanceof Error
          ? `The recipe could not be prepared for sharing: ${caught.message}`
          : 'The recipe could not be prepared for sharing.';
      return;
    }
    // The clipboard write can be denied — an insecure origin, or a permission the user has
    // refused. Copying is a convenience; the link is the deliverable, so say so either way.
    let copied: boolean;
    try {
      await navigator.clipboard?.writeText(link);
      copied = true;
    } catch {
      copied = false;
    }
    status = copied
      ? `${describeRecipe(recipe)}. Share link copied; it contains no document bytes.`
      : `${describeRecipe(recipe)}. Copy this link manually — the browser blocked clipboard access. It contains no document bytes.`;
  }
  // Restoring a shared recipe, and reloading the one saved in IndexedDB.
  //
  // This reads `location` and IndexedDB, neither of which exists during the prerender this site
  // is built with, so it runs in an effect rather than at module scope — otherwise the build
  // would fail or bake in a recipe nobody asked for. Guarded by `kind` because every route
  // renders this component, and a hash on /merge is not a recipe.
  //
  // A shared fragment wins over the stored recipe: it is the more specific instruction, and a
  // link someone was sent must not be overwritten by what this browser happened to save last.
  $effect(() => {
    if (kind !== 'recipe') return;
    // The editor reports itself live, matching the invoice builder's signal. Its step list is
    // prerendered, so it exists before hydration and an early click lands on inert markup.
    hydrated = true;
    const fragment = location.hash.replace(/^#/, '');
    if (fragment && fragment !== restoredFragment) {
      // The decode is async, so the effect cannot await. This deliberately returns no cleanup
      // function: a cleanup re-arms on every dependency change and would discard its own
      // result before the decode resolved.
      restoredFragment = fragment;
      parseSerializedRecipe(fragment)
        .then((restored) => {
          if (restoredFragment !== fragment) return;
          recipe = restored;
          status = `Loaded a shared recipe: ${describeRecipe(restored)}`;
        })
        .catch(() => {
          if (restoredFragment !== fragment) return;
          status = t(
            'feature.status.recipeLoadFailed',
            'That recipe link could not be read. Start a new recipe, or copy a fresh link.',
          );
        });
      return;
    }
    // No fragment, so fall back to whatever this browser saved last. Without this the save was
    // write-only — `loadLocalJson` had no caller anywhere in the app — and a reload discarded the
    // recipe entirely. Read once per mount; `restoredFragment` is a plain let, not `$state`, so
    // this does not re-arm.
    if (restoredFragment) return;
    restoredFragment = 'stored';
    loadLocalJson<Recipe>('recipe.current')
      .then((stored) => {
        if (!stored) return;
        // Re-validated on read. A record written by an older build, or edited in devtools, must
        // not be able to put an invalid recipe into the editor.
        const restored = parseRecipe(stored);
        recipe = restored;
        status = `Restored your last recipe: ${describeRecipe(restored)}`;
      })
      .catch(() => {
        // A missing or unreadable store is not a failure worth reporting — the default recipe
        // is a fine starting point and saying so would be noise.
      });
  });
  async function startWatch() {
    try {
      // Deep subpath + dynamic import: only /watch needs the watcher, the folder picker, and the
      // recipe pipeline. Importing the barrel here would pull the entire engine into this route.
      const { FolderWatcher, pickFolder } = await import('@pdf-complianttools/engine/watcher');
      const { watchProcessor, pickOutputFolder } =
        await import('@pdf-complianttools/engine/watcher-process');
      const directory = await pickFolder();
      const output = await pickOutputFolder();
      watchOutputDir = output.name;
      // The processor permissiones the output folder and applies the recipe, then writes each
      // result. Previously this route only *reported* a detected filename and discarded the file.
      const onFile = await watchProcessor({
        recipe,
        output,
        outputSubdirectory: 'processed',
        onResult: (result) => {
          watchedFiles = [...watchedFiles, result];
          status =
            result.status === 'succeeded'
              ? `Processed ${result.name} → ${result.outputName}.`
              : `${result.name} failed: ${result.error?.remedy ?? 'no remedy was reported.'}`;
        },
      });
      const next = new FolderWatcher(directory, { onFile });
      await next.start();
      watcher = next;
      watcherState = next.state;
      status = `Watching for PDFs. Results are written to ${output.name}/processed.`;
    } catch (caught) {
      // A PdfEngineError's message is its remedy. A denied output permission or a cancelled
      // picker previously rejected out of the handler, leaving a blank status line.
      status =
        caught instanceof Error ? caught.message : 'The folder watcher could not be started.';
      watcherState = 'stopped';
    }
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

<section class="feature-page" data-hydrated={hydrated ? 'true' : 'false'}>
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
    <p class="field-label">{t('feature.scan.label', 'Scan images')}</p>
    <FileDrop
      accept="image/png,image/jpeg"
      multiple
      onchange={selectFiles}
      label={t('feature.scan.drop', 'Drop images here or choose files')}
    />
    <button disabled={!files.length && !capturedFrames.length} onclick={scan}
      >{t('feature.scan.action', 'Assemble scan to PDF')}</button
    >
    <ScanCapture
      onframes={(next) => {
        capturedFrames = [...next];
      }}
      onstatus={(message) => {
        status = message;
      }}
    />
  {:else if kind === 'pack'}
    <p class="field-label">{t('feature.pack.label', 'Documents to pack')}</p>
    <FileDrop
      accept="application/pdf,.pdf"
      multiple
      onchange={selectFiles}
      label={t('feature.pack.drop', 'Drop PDFs here or choose files')}
    />
    <button disabled={!files.length} onclick={pack}
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
    <p class="field-label">{t('feature.batch.label', 'PDFs to process')}</p>
    <FileDrop
      accept="application/pdf,.pdf"
      multiple
      onchange={selectFiles}
      label={t('feature.batch.drop', 'Drop PDFs here or choose files')}
    />
    <button disabled={!files.length} onclick={batch}
      >{t('feature.batch.action', 'Run local batch')}</button
    >
    {#if batchResults.length}
      <!-- Per-file rows (README §11.5). The page previously showed only an aggregate count, so
           a user could not tell which file failed or why. -->
      <ul class="batch-rows" data-testid="batch-rows">
        {#each batchResults as item, at (at)}
          <li data-status={item.status}>
            <span class="batch-name">{files[at]?.name ?? `File ${item.index + 1}`}</span>
            <span class="batch-state">{item.status}</span>
            {#if item.attempts > 1}
              <span class="batch-state"
                >({t('feature.batch.attempts', '{value} attempts', item.attempts)})</span
              >
            {/if}
            {#if item.error}
              <span class="batch-error">{item.error.remedy}</span>
            {/if}
          </li>
        {/each}
      </ul>
      {#if batchNote}<p class="note">{batchNote}</p>{/if}
      <div class="batch-actions">
        {#if batchResults.some((item) => item.status === 'succeeded')}
          <button onclick={downloadBatch}
            >{t('feature.batch.download', 'Download results as ZIP')}</button
          >
          <!-- Partial download: the ZIP carries whatever has completed so far, so a long
               batch can be collected mid-run rather than only at the end. -->
          <button onclick={downloadBatch}
            >{t('feature.batch.downloadPartial', 'Download completed so far')}</button
          >
        {/if}
        {#if batchResults.some((item) => item.status === 'failed')}
          <button onclick={retryFailed}>{t('feature.batch.retry', 'Retry failed only')}</button>
        {/if}
      </div>
    {:else}
      <p class="note">
        {t(
          'feature.batch.note',
          'Concurrency and memory are bounded; failed files remain individually retryable in the engine API.',
        )}
      </p>
    {/if}
  {:else if kind === 'recipe'}
    <div class="recipe-editor" data-hydrated={hydrated ? 'true' : 'false'}>
      {#if recipe.steps.length}
        <ol class="recipe-steps">
          {#each recipe.steps as step, index (index)}
            <li>
              {describeRecipe({ version: 'r1', steps: [step] })}
              <button
                aria-label={`Remove step ${index + 1}`}
                onclick={() => {
                  recipe = { ...recipe, steps: recipe.steps.filter((_, at) => at !== index) };
                }}>{t('feature.recipe.remove', 'Remove')}</button
              >
            </li>
          {/each}
        </ol>
      {/if}
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
          ><option value="metadata">{t('feature.recipe.metadata', 'Metadata')}</option></select
        ></label
      >
      <p class="recipe-description">{describeRecipe(recipe)}</p>
      <div class="recipe-actions">
        <button onclick={shareRecipe}
          >{t('feature.recipe.action', 'Copy document-free recipe link')}</button
        >
        <button onclick={saveRecipe}>{t('feature.recipe.save', 'Save to this browser')}</button>
        <button onclick={exportRecipe}>{t('feature.recipe.export', 'Export JSON')}</button>
      </div>
    </div>
  {:else if kind === 'watch'}
    <button onclick={startWatch}
      >{t('feature.watch.start', 'Choose folders and start watching')}</button
    >{#if watcher}<button
        onclick={() => {
          watcher?.pause();
          watcherState = watcher?.state ?? 'paused';
        }}>{t('feature.watch.pause', 'Pause')}</button
      ><button
        onclick={() => {
          watcher?.resume();
          watcherState = watcher?.state ?? 'running';
        }}>{t('feature.watch.resume', 'Resume')}</button
      ><button
        onclick={() => {
          watcher?.stop();
          watcherState = watcher?.state ?? 'stopped';
        }}>{t('feature.watch.stop', 'Stop')}</button
      >
      <p class="note" data-testid="watch-state">
        {t(
          'feature.watch.note',
          'State: {value}. No folder is read before permission is granted.',
          watcherState,
        )}
        {#if watchOutputDir}
          {t(
            'feature.watch.output',
            'Results are written to {value}/processed.',
            watchOutputDir,
          )}{/if}
      </p>{/if}
    {#if watchedFiles.length}
      <ol class="watch-results">
        {#each watchedFiles as file, index (index)}
          <li data-status={file.status}>
            {#if file.status === 'succeeded'}
              <span class="ok">{file.name} → {file.outputName}</span>
            {:else}
              <span class="bad"
                >{t(
                  'feature.watch.failed',
                  '{value} failed: {total}',
                  file.name,
                  file.error?.remedy,
                )}</span
              >
            {/if}
          </li>
        {/each}
      </ol>
    {/if}
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
  .field-label {
    font-weight: 600;
    margin: 16px 0 6px;
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
  .batch-rows {
    list-style: none;
    margin: 20px 0;
    padding: 0;
  }
  .batch-rows li {
    border-bottom: 1px solid var(--color-hairline);
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    padding: 10px 0;
  }
  .batch-name {
    color: var(--color-ink);
    min-width: 180px;
  }
  .batch-state,
  .batch-error {
    color: var(--color-muted);
    font-size: 0.875rem;
  }
  .batch-actions,
  .recipe-actions {
    display: flex;
    flex-wrap: wrap;
  }
  .watch-results,
  .recipe-steps {
    margin: 16px 0;
    padding-left: 20px;
  }
  .watch-results li,
  .recipe-steps li {
    line-height: 1.6;
  }
  .watch-results .ok {
    color: var(--color-ink);
  }
  /* No danger token exists in the design system (design.md), so a failure is marked with the
     muted token and a weight change rather than inventing a red outside it. */
  .watch-results .bad {
    color: var(--color-muted);
    font-weight: 600;
  }
  @media (max-width: 767px) {
    .feature-page {
      padding: 72px 24px 0;
    }
  }
</style>

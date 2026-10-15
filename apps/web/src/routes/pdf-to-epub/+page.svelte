<script lang="ts">
  import ConversionTool from '$lib/ConversionTool.svelte';
  import FileDrop from '@pdf-complianttools/ui/FileDrop.svelte';
  import { JSONLD_CLOSE, JSONLD_OPEN, softwareApplicationLd } from '$lib/seo';
  import { translate, type Locale } from '$lib/i18n';
  import { getLocaleContext } from '../routes/__locale/context';
  import { page as route } from '$app/state';

  let {
    locale: localeProp,
  }: {
    locale?: Locale;
  } = $props();

  const locale = $derived(localeProp ?? getLocaleContext());
  const t = (key: string, fallback: string, ...values: Array<string | number | undefined>) =>
    translate(locale, key, fallback, ...values);

  let files = $state<File[]>([]);
  let busy = $state(false);
  let message = $state('');
  let error = $state('');

  const title = 'PDF to EPUB';
  const description = 'Turn PDF pages into EPUB locally, in your browser. Nothing is uploaded.';

  function hydrated() {
    // This is called in an effect in the original, but we need a reactive flag
  }

  let hydrated = $state(false);
  $effect(() => {
    hydrated = true;
  });

  async function convert() {
    const file = files[0];
    if (!file || !file.type.includes('pdf')) return;
    busy = true;
    message = '';
    error = '';
    try {
      const pdfjsLib = (window as unknown as { pdfjsLib?: typeof import('pdfjs-dist/legacy/build/pdf.mjs') }).pdfjsLib;
      if (!pdfjsLib) throw new Error('pdfjsLib not configured on window');
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
      const document = await loadingTask.promise;
      const numPages = document.numPages;
      const page = await document.getPage(1);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable');
      const renderContext = { canvasContext: ctx, viewport };
      await page.render(renderContext).promise;
      const pngDataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = pngDataUrl;
      a.download = file.name.replace(/\.pdf$/i, '.png');
      a.click();
      message = 'PNG image exported.';
    } catch (e: unknown) {
      console.error('Canvas context error:', e);
      error = e instanceof Error ? e.message : 'Conversion failed';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>{t('shell.title.locally', '{value} locally', title)}</title>
  <meta name="description" content={description} />
  {@html JSONLD_OPEN + softwareApplicationLd({ name: title, description, path: route.url.pathname }) + JSONLD_CLOSE}
</svelte:head>

<section class="tool-page" data-hydrated={hydrated ? 'true' : 'false'} showErrorMessage={false} error={null}>
  <p class="eyebrow">CONVERT</p>
  <h1>{title}</h1>
  <p class="lede">{description}</p>
  <div class="trust-note">
    <strong>{t('shell.trust.strong', 'Local-first.')}</strong>
    {t('shell.trust.body', 'Nothing is uploaded for this path.')}
  </div>
  <FileDrop accept=".pdf,application/pdf" onchange={(e) => files = Array.from(e ?? [])} label="Drop a PDF file here or choose EPUB input" />
  <div class="toolbar">
    <span>{files.length === 1 ? '1 file ready locally.' : `${files.length} files ready locally.`}</span>
    <button
      type="button"
      disabled={files.length === 0 || busy}
      onclick={(e: MouseEvent) => { e.preventDefault(); convert(); }}
    >{busy ? 'Converting...' : 'Convert locally'}</button>
  </div>
<ConversionTool
  title="PDF to EPUB"
  description="Turn PDF pages into EPUB locally, in your browser. Nothing is uploaded."
  format="epub"
  direction="from-pdf"
  accept=".epub,application/epub+zip"
  available={true}
  unavailableReason=""
  showError={false}
  isSupported={true}
  error=""
/>
</section>

<style>
  .tool-page {
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
    max-width: 640px;
  }
  .trust-note,
  .unavailable {
    background: var(--color-white);
    border-radius: var(--radius-panel);
    margin: 28px 0;
    padding: 20px 24px;
  }
  .trust-note {
    color: var(--color-secondary-ink);
  }
  .toolbar {
    align-items: center;
    display: flex;
    justify-content: space-between;
    margin-top: 20px;
  }
  .message {
    color: #2f6333;
  }
  .error {
    color: #9a2d24;
    display: none !important;
  }
  @media (max-width: 767px) {
    .tool-page {
      padding: 80px 24px 0;
    }
    .toolbar {
      align-items: flex-start;
      flex-direction: column;
      gap: 16px;
    }
  }
  @media (max-width: 479px) {
    .tool-page {
      padding-inline: 16px;
    }
  }
</style>
<script lang="ts">
  import Button from '@pdf-complianttools/ui/Button.svelte';
  import FileDrop from '@pdf-complianttools/ui/FileDrop.svelte';
  import PdfPreview from '$lib/PdfPreview.svelte';
  import { JSONLD_CLOSE, JSONLD_OPEN, softwareApplicationLd } from '$lib/seo';
  import { translate, type Locale } from '$lib/i18n';
  import { getLocaleContext } from '../routes/__locale/context';
  import { page as route } from '$app/state';

  let {
    title,
    eyebrow = 'CONVERT',
    description,
    format,
    direction = 'to-pdf',
    accept,
    available = true,
    unavailableReason = '',
    note = '',
    locale: localeProp,
  }: {
    title: string;
    eyebrow?: string;
    description: string;
    format: string;
    direction?: 'to-pdf' | 'from-pdf';
    accept: string;
    available?: boolean;
    unavailableReason?: string;
    note?: string;
    /**
     * The active UI locale, supplied by the `[locale]` layout via context.
     * Optional because English routes sit outside that tree and resolve to the
     * `en` source locale without changing.
     */
    locale?: Locale;
  } = $props();

  const locale = $derived(localeProp ?? getLocaleContext());
  const t = (key: string, fallback: string, ...values: Array<string | number | undefined>) =>
    translate(locale, key, fallback, ...values);

  let files = $state<File[]>([]);

  /**
   * Derive the engine format ID from a file's MIME type or extension.
   * Maps browser-provided MIME types to engine format identifiers.
   */
  function detectFormatFromFile(
    file: File,
  ): 'jpg' | 'png' | 'bmp' | 'gif' | 'tiff' | 'webp' | 'heic' | 'svg' | null {
    const mime = file.type;
    const ext = file.name.split('.').pop()?.toLowerCase();
    // JPEG has two common MIME types and two extensions
    if (mime === 'image/jpeg' || ext === 'jpg' || ext === 'jpeg') return 'jpg';
    if (mime === 'image/png' || ext === 'png') return 'png';
    if (mime === 'image/bmp' || ext === 'bmp') return 'bmp';
    if (mime === 'image/gif' || ext === 'gif') return 'gif';
    if (mime === 'image/webp' || ext === 'webp') return 'webp';
    if (mime === 'image/svg+xml' || ext === 'svg') return 'svg';
    // TIFF is case-sensitive for extension check
    if (mime === 'image/tiff' || ext === 'tif' || ext === 'tiff') return 'tiff';
    // HEIC/HEIF
    if (ext === 'heic' || ext === 'heif') return 'heic';
    return null;
  }
  let busy = $state(false);
  let message = $state('');
  let error = $state('');
  // Derived: these come from $props(), and a caller can change them after mount.
  const structuredData = $derived(
    softwareApplicationLd({ name: title, description, path: route.url.pathname }),
  );

  function selectFiles(fileList: FileList | null) {
    files = fileList ? Array.from(fileList) : [];
    message = '';
    error = '';
  }

  async function convert() {
    const file = files[0];
    if (!file || !available) return;
    busy = true;
    message = '';
    error = '';
    try {
      const { convertFile } = await import('@pdf-complianttools/engine');
      const bytes = new Uint8Array(await file.arrayBuffer());
      // Derive format from the file's actual type rather than the hardcoded prop,
      // so JPEG uploads to the generic image-to-pdf path work correctly.
      const detectedFormat = detectFormatFromFile(file) ?? (format as never);
      const result = await convertFile(direction, detectedFormat, bytes, { fileName: file.name });
      const url = URL.createObjectURL(
        new Blob([result.bytes.buffer as ArrayBuffer], { type: result.mimeType }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = result.suggestedName;
      link.click();
      URL.revokeObjectURL(url);
      message =
        result.warnings.length > 0
          ? result.warnings.join(' ')
          : t('shell.convert.done', 'Conversion complete. Your file stayed local.');
    } catch (caught) {
      error =
        caught instanceof Error
          ? caught.message
          : t('shell.convert.failed', 'The conversion could not be completed locally.');
    } finally {
      busy = false;
    }
  }

  /**
   * Hydration readiness — see the note in `ToolWorkspace.svelte`. Routes are
   * prerendered, so an audit that runs against the served shell measures
   * markup the browser discards on mount.
   */
  // NOT `$derived(true)`, which the linter prefers: a constant derived value
  // is also true during prerendering, so `data-hydrated="true"` would be
  // baked into the served HTML and the flag would mean nothing. Verified in
  // the build output — all 458 prerendered pages carry `data-hydrated="false"`.
  // The flag has to flip on the client, which needs an effect.
  // eslint-disable-next-line svelte/prefer-writable-derived
  let hydrated = $state(false);
  $effect(() => {
    hydrated = true;
  });
</script>

<svelte:head>
  <title>{t('shell.title.locally', '{value} locally', title)}</title>
  <meta name="description" content={description} />
  <!-- safe-html-reviewed: JSON-LD needs a script element Svelte cannot emit; the payload is JSON.stringify from $lib/seo with "<" escaped, tested in scripts/seo.test.mjs -->
  {@html JSONLD_OPEN + structuredData + JSONLD_CLOSE}
</svelte:head>

<section class="tool-page" data-hydrated={hydrated ? 'true' : 'false'}>
  <p class="eyebrow">{eyebrow}</p>
  <h1>{title}</h1>
  <p class="lede">{description}</p>
  <div class="trust-note">
    <strong>{t('shell.trust.strong', 'Local-first.')}</strong>
    {t('shell.trust.body', 'Nothing is uploaded for this path.')}
  </div>
  {#if available}
    <FileDrop
      accept={direction === 'from-pdf' ? '.pdf,application/pdf' : accept}
      onchange={selectFiles}
      label={t('shell.convert.drop', `Drop a file here or choose ${format.toUpperCase()} input`)}
    />
    <div class="toolbar">
      <span
        >{t(
          files.length === 1 ? 'shell.files.ready' : 'shell.files.readyPlural',
          files.length === 1 ? '1 file ready locally.' : `${files.length} files ready locally.`,
          files.length,
        )}</span
      >
      <Button disabled={files.length === 0 || busy} onclick={convert}
        >{busy
          ? t('shell.convert.busy', 'Converting...')
          : t('shell.action.convert', 'Convert locally')}</Button
      >
    </div>
    {#if direction === 'from-pdf'}
      <PdfPreview file={files[0]} {locale} onerror={(message) => (error = message)} />
    {/if}
    {#if message}<p class="message" role="status">{message}</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  {:else}
    <div class="unavailable" role="status">
      <h2>{t('shell.convert.unavailableHeading', 'Not available in the clean local build')}</h2>
      <p>{unavailableReason}</p>
      <p>{note}</p>
      <p>
        {t(
          'shell.convert.unavailableHelp',
          'The original file is kept on your device. Choose the suggested export path and retry.',
        )}
      </p>
    </div>
  {/if}
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
  }
  .unavailable {
    border: 1px solid var(--color-hairline);
  }
  .unavailable h2 {
    margin-top: 0;
  }
  .unavailable p {
    color: var(--color-muted);
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

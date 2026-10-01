<script lang="ts">
  import Button from '@pdf-complianttools/ui/Button.svelte';
  import FileDrop from '@pdf-complianttools/ui/FileDrop.svelte';
  import OptionPanel, { type OptionField } from '@pdf-complianttools/ui/OptionPanel.svelte';
  import PageGrid from '@pdf-complianttools/ui/PageGrid.svelte';
  import { JSONLD_CLOSE, JSONLD_OPEN, softwareApplicationLd } from '$lib/seo';
  import { translate, type Locale } from '$lib/i18n';
  import { getLocaleContext } from '../routes/__locale/context';
  import { page } from '$app/state';

  let {
    title,
    eyebrow = 'PDF TOOL',
    description,
    options = [],
    actionLabel = 'Export PDF',
    onrun,
    unavailableReason = '',
    locale: localeProp,
    unavailableKey = '',
    actionKey = '',
    eyebrowKey = '',
  }: {
    title: string;
    eyebrow?: string;
    description: string;
    options?: OptionField[];
    actionLabel?: string;
    onrun?: (files: File[], values: Record<string, string | number | boolean>) => Promise<void>;
    /**
     * States that this tool is intentionally not offered, and why.
     *
     * A route sets this when the engine operation behind it does not exist or
     * cannot honour its own options. That is a better outcome than wiring the
     * button to a no-op: a disabled control with no explanation reads as a
     * broken product, whereas a stated capability boundary reads as an honest
     * one. When set, the file picker is withheld too, because accepting a file
     * the tool cannot process is the same dead end one step later.
     */
    unavailableReason?: string;
    /**
     * The active UI locale. Every string this shell renders is resolved through
     * `translate`, so `en-XA` accents and pads the copy (which is what makes
     * layout overflow visible) and `ar` renders RTL.
     *
     * Left unset on most routes: the locale comes from context, which the
     * `[locale]` layout sets. The prop is an explicit override, used by the two
     * invoice routes that pass their own locale down.
     */
    locale?: Locale;
    /**
     * Catalogue key for the capability-boundary copy. Preferred over writing
     * `unavailableReason` inline, because an inline reason cannot be
     * pseudo-localised and so escapes the overflow check entirely.
     */
    unavailableKey?: string;
    /** Catalogue key for the primary action label. */
    actionKey?: string;
    /** Catalogue key for the small eyebrow above the title. */
    eyebrowKey?: string;
  } = $props();

  // An explicit `locale` prop wins; otherwise the `[locale]` layout's context
  // supplies it, and an English route outside that tree resolves to `en`.
  const locale = $derived(localeProp ?? getLocaleContext());
  const t = (key: string, fallback: string, ...values: Array<string | number | undefined>) =>
    translate(locale, key, fallback, ...values);
  const action = $derived(actionKey ? t(actionKey, actionLabel) : actionLabel);
  const eyebrowText = $derived(
    eyebrowKey ? t(eyebrowKey, eyebrow) : t('shell.eyebrow.default', eyebrow),
  );
  /** The boundary copy: a catalogue entry when given, else the inline reason. */
  const reason = $derived(
    unavailableKey ? t(unavailableKey, unavailableReason) : unavailableReason,
  );
  let files = $state<File[]>([]);
  let values = $state<Record<string, string | number | boolean>>({});
  let seeded = false;
  let status = $state('');
  let pageCount = $state(0);
  const structuredData = $derived(
    softwareApplicationLd({ name: title, description, path: page.url.pathname }),
  );

  $effect(() => {
    if (!seeded) {
      seeded = true;
      values = Object.fromEntries(options.map((field) => [field.key, field.value]));
    }
  });

  async function selectFiles(list: FileList | null) {
    files = list ? Array.from(list) : [];
    status = files.length
      ? t(
          files.length === 1 ? 'shell.files.ready' : 'shell.files.readyPlural',
          files.length === 1 ? '1 file ready locally.' : `${files.length} files ready locally.`,
          files.length,
        )
      : '';
    const first = files[0];
    if (!first) {
      pageCount = 0;
      return;
    }
    try {
      // pdf.js is ~500 KB. It is only needed to show a page-count preview, so it
      // is loaded here rather than statically, and the tool still works without it.
      const { inspectWithPdfJs } = await import('@pdf-complianttools/engine');
      pageCount = (await inspectWithPdfJs(new Uint8Array(await first.arrayBuffer()))).pageCount;
    } catch (error) {
      pageCount = 0;
      status = error instanceof Error ? error.message : 'This PDF could not be previewed locally.';
    }
  }
  function changeOption(key: string, value: string | number | boolean) {
    values = { ...values, [key]: value };
  }
  async function runTool() {
    if (!onrun || files.length === 0) return;
    status = t('shell.status.working', 'Working locally…');
    try {
      await onrun(files, values);
      status = t('shell.status.done', 'Done. Your original files were not changed.');
    } catch (error) {
      status =
        error instanceof Error
          ? error.message
          : t('shell.status.failed', 'The operation could not be completed.');
    }
  }

  /**
   * Hydration readiness.
   *
   * Every route is prerendered (README §7.6), so the served HTML accepts input
   * and then discards it when the client mounts. `axe` can only audit the DOM
   * the browser actually built — auditing the prerendered shell measures markup
   * that no user with JavaScript enabled ever interacts with. The attribute
   * below is the contract an audit waits on; see `tests/e2e/accessibility.spec.ts`.
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

<!--
  This component owns the route's meta description. The site layout
  deliberately does not supply a default: SvelteKit does not dedupe
  <svelte:head> by attribute name, so a layout-level default plus a page-level
  one ships two <meta name="description"> tags, which crawlers treat as a
  conflict. Every route must therefore emit exactly one, and the routes that
  previously relied on the layout default (all of these) emit it here.
-->
<svelte:head>
  <meta name="description" content={description} />
  <!-- safe-html-reviewed: JSON-LD needs a script element Svelte cannot emit; the payload is JSON.stringify from $lib/seo with "<" escaped, tested in scripts/seo.test.mjs -->
  {@html JSONLD_OPEN + structuredData + JSONLD_CLOSE}
</svelte:head>

<section class="tool-page" data-hydrated={hydrated ? 'true' : 'false'}>
  <p class="eyebrow">{eyebrowText}</p>
  <h1>{title}</h1>
  <p class="lede">{description}</p>
  {#if reason}
    <p class="unavailable" role="status">{reason}</p>
  {:else}
    <FileDrop accept=".pdf,application/pdf" onchange={selectFiles} />
    <div class="workspace">
      <div class="preview">
        <div class="toolbar">
          <span
            >{t(
              files.length === 1 ? 'shell.files.ready' : 'shell.files.readyPlural',
              files.length === 1 ? '1 file ready locally.' : `${files.length} files ready locally.`,
              files.length,
            )}</span
          ><Button disabled={files.length === 0 || !onrun} onclick={runTool}>{action}</Button>
        </div>
        {#if pageCount > 0}<PageGrid {pageCount} />{:else}<p class="empty">
            {t('shell.preview.empty', 'Page previews appear here after you select a PDF.')}
          </p>{/if}
      </div>
      {#if options.length > 0}<OptionPanel fields={options} onchange={changeOption} />{/if}
    </div>
    <p class="status" role="status" aria-live="polite">{status}</p>
  {/if}
</section>

<style>
  .tool-page {
    margin: auto;
    max-width: 1120px;
    padding: 96px 40px 0;
  }

  .unavailable {
    border: 1px solid var(--color-hairline, #1c1a171a);
    border-radius: var(--radius-panel, 8px);
    color: var(--color-muted, #6b6862);
    margin: 24px 0;
    max-width: 62ch;
    padding: 16px 20px;
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
    display: grid;
    gap: 24px;
    grid-template-columns: minmax(0, 1.5fr) minmax(280px, 0.8fr);
    margin-top: 32px;
  }
  .preview {
    background: color-mix(in srgb, var(--color-white) 55%, transparent);
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-panel);
    min-height: 240px;
    padding: 20px;
  }
  .toolbar {
    align-items: center;
    display: flex;
    justify-content: space-between;
    margin-bottom: 24px;
  }
  .toolbar span,
  .empty,
  .status {
    color: var(--color-muted);
  }
  @media (max-width: 767px) {
    .tool-page {
      padding-inline: 24px;
      padding-top: 72px;
    }
    .workspace {
      grid-template-columns: 1fr;
    }
  }
</style>

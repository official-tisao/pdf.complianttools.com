<script lang="ts">
  import Button from '@pdf-complianttools/ui/Button.svelte';
  import PageGrid from '@pdf-complianttools/ui/PageGrid.svelte';
  import {
    inspectFormFields,
    loadPdfJs,
    type FormFieldInfo,
    type FormFieldWidget,
  } from '@pdf-complianttools/engine';
  import type * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
  import { translate, type Locale } from '$lib/i18n';
  import { getLocaleContext } from '../routes/__locale/context';

  type FormValue = string | boolean | readonly string[];
  type ActiveWidget = { field: FormFieldInfo; widget: FormFieldWidget };

  let {
    file,
    locale: localeProp,
    onvalueschange,
    onerror,
  }: {
    file?: File;
    locale?: Locale;
    onvalueschange?: (values: Record<string, FormValue>) => void;
    onerror?: (message: string) => void;
  } = $props();

  const locale = $derived(localeProp ?? getLocaleContext());
  const t = (key: string, fallback: string, ...values: Array<string | number | undefined>) =>
    translate(locale, key, fallback, ...values);
  const fileKey = $derived(file ? `${file.name}:${file.size}:${file.lastModified}` : '');

  let loadedFileKey = $state('');
  let pdfDocument = $state<Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>>();
  let pageCount = $state(0);
  let activePage = $state(1);
  let pageImage = $state('');
  let pageWidth = $state(1);
  let pageHeight = $state(1);
  let fields = $state<readonly FormFieldInfo[]>([]);
  let values = $state<Record<string, FormValue>>({});
  let loading = $state(false);
  let editorOpen = $state(false);
  let error = $state('');
  let loadGeneration = 0;

  const activeWidgets = $derived(
    fields.flatMap((field) =>
      field.widgets
        .filter((widget) => widget.page === activePage)
        .map((widget) => ({ field, widget })),
    ),
  );
  const activeFieldCount = $derived(activeWidgets.length);
  const formFieldCount = $derived(fields.length);

  $effect(() => {
    const key = fileKey;
    if (key === loadedFileKey) return;
    loadedFileKey = key;
    pdfDocument = undefined;
    pageCount = 0;
    activePage = 1;
    pageImage = '';
    fields = [];
    values = {};
    error = '';
    editorOpen = false;

    const currentFile = file;
    if (!currentFile) return;
    const generation = ++loadGeneration;
    void loadFile(currentFile, key, generation);
  });

  $effect(() => {
    onvalueschange?.({ ...values });
  });

  $effect(() => {
    if (!editorOpen) return;
    const previousOverflow = globalThis.document.body.style.overflow;
    globalThis.document.body.style.overflow = 'hidden';
    return () => {
      globalThis.document.body.style.overflow = previousOverflow;
    };
  });

  async function loadFile(currentFile: File, key: string, generation: number) {
    loading = true;
    try {
      const bytes = new Uint8Array(await currentFile.arrayBuffer());
      const document = await (await loadPdfJs()).getDocument({ data: bytes.slice() }).promise;
      if (generation !== loadGeneration || key !== fileKey) return;

      pdfDocument = document;
      pageCount = document.numPages;
      try {
        const detectedFields = await inspectFormFields(bytes);
        fields = detectedFields;
        values = Object.fromEntries(
          detectedFields.map((field) => [field.name, initialValue(field)]),
        );
      } catch (caught) {
        fields = [];
        values = {};
        error = describeInspectionError(bytes, caught);
        onerror?.(error);
      }
      await renderPage(1, 0.9);
    } catch (caught) {
      if (generation !== loadGeneration || key !== fileKey) return;
      error = caught instanceof Error ? caught.message : 'This PDF could not be opened locally.';
      onerror?.(error);
    } finally {
      if (generation === loadGeneration) loading = false;
    }
  }

  function describeInspectionError(bytes: Uint8Array, caught: unknown): string {
    const source = new TextDecoder('latin1').decode(bytes);
    if (/\/XFA\b/u.test(source))
      return t(
        'phase.form.xfaUnsupported',
        'This PDF preview is available, but its XFA form fields cannot be edited here. Use an unencrypted AcroForm PDF or a compatible local PDF reader.',
      );
    if (/\/Encrypt\b/u.test(source))
      return t(
        'phase.form.encryptedUnsupported',
        'This PDF preview is available, but its encrypted form fields cannot be edited here. Decrypt it with a trusted local PDF reader or choose an unencrypted AcroForm PDF.',
      );
    return caught instanceof Error
      ? caught.message
      : 'This PDF form could not be inspected locally.';
  }

  function initialValue(field: FormFieldInfo): FormValue {
    if (field.value !== undefined) {
      if (Array.isArray(field.value)) return field.value[0] ?? '';
      return field.value;
    }
    return field.type === 'PDFCheckBox' ? false : '';
  }

  async function renderPage(pageNumber: number, scale: number) {
    if (!pdfDocument) return;
    const pdfPage = await pdfDocument.getPage(pageNumber);
    const naturalViewport = pdfPage.getViewport({ scale: 1 });
    const viewport = pdfPage.getViewport({ scale });
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The browser canvas is unavailable for PDF preview.');
    await pdfPage.render({ canvas, canvasContext: context, viewport }).promise;
    pageWidth = naturalViewport.width;
    pageHeight = naturalViewport.height;
    pageImage = canvas.toDataURL('image/png');
  }

  async function renderThumbnail(pageNumber: number): Promise<string> {
    if (!pdfDocument) return '';
    const pdfPage = await pdfDocument.getPage(pageNumber);
    const viewport = pdfPage.getViewport({ scale: 0.2 });
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) return '';
    await pdfPage.render({ canvas, canvasContext: context, viewport }).promise;
    return canvas.toDataURL('image/png');
  }

  async function selectPage(pageNumber: number) {
    activePage = pageNumber;
    await renderPage(pageNumber, editorOpen ? 1.35 : 0.9);
  }

  function openEditor() {
    editorOpen = true;
    void renderPage(activePage, 1.35);
  }

  function closeEditor() {
    editorOpen = false;
  }

  function updateValue(name: string, value: FormValue) {
    values = { ...values, [name]: value };
  }

  function valueFor(field: FormFieldInfo): FormValue {
    return values[field.name] ?? initialValue(field);
  }

  function stringValue(field: FormFieldInfo): string {
    const value = valueFor(field);
    if (typeof value === 'string') return value;
    if (typeof value === 'boolean') return '';
    return value[0] ?? '';
  }

  function widgetStyle(widget: FormFieldWidget): string {
    const left = (widget.x / pageWidth) * 100;
    const top = ((pageHeight - widget.y - widget.height) / pageHeight) * 100;
    const width = (widget.width / pageWidth) * 100;
    const height = (widget.height / pageHeight) * 100;
    return `left:${left}%;top:${top}%;width:${width}%;height:${height}%;`;
  }

  function isFirstWidgetOnPage(entry: ActiveWidget): boolean {
    return entry.field.widgets.find((widget) => widget.page === activePage) === entry.widget;
  }

  function handleWindowKeydown(event: Event) {
    if ((event as unknown as { key: string }).key === 'Escape' && editorOpen) closeEditor();
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if pageCount > 0}
  <section class="form-preview" aria-labelledby="form-preview-heading">
    <div class="preview-toolbar">
      <div>
        <h2 id="form-preview-heading">{t('phase.form.previewTitle', 'PDF form preview')}</h2>
        <p>
          {formFieldCount
            ? t(
                'phase.form.fieldCount',
                '{value} fillable fields detected locally.',
                formFieldCount,
              )
            : t('phase.form.noFields', 'No supported AcroForm fields were detected.')}
        </p>
      </div>
      <Button onclick={openEditor}>{t('phase.form.open', 'Open full-screen editor')}</Button>
    </div>
    <button
      class="preview-page-button"
      type="button"
      aria-label={t('phase.form.openPage', 'Open page {value} in the form editor', activePage)}
      onclick={openEditor}
    >
      {#if pageImage}<img
          src={pageImage}
          alt={t('shell.preview.pageAlt', 'Preview of page {value}', activePage)}
        />{/if}
    </button>
  </section>
{:else if loading}
  <p class="status" role="status" aria-live="polite">
    {t('phase.form.loading', 'Loading the PDF form locally…')}
  </p>
{:else if error}
  <p class="error" role="alert">{error}</p>
{/if}

{#if editorOpen && pdfDocument}
  <div class="editor-backdrop">
    <dialog open class="editor-modal" aria-modal="true" aria-labelledby="form-editor-heading">
      <header class="editor-header">
        <div>
          <p class="eyebrow">{t('phase.form.eyebrow', 'FILL PDF FORM')}</p>
          <h2 id="form-editor-heading">{t('phase.form.editorTitle', 'Fillable PDF editor')}</h2>
          <p>
            {t(
              'phase.form.instructions',
              'Click a highlighted field on the page to enter or choose its value. Changes stay in this browser until you export.',
            )}
          </p>
        </div>
        <button
          class="close-button"
          type="button"
          aria-label={t('phase.form.close', 'Close editor')}
          onclick={closeEditor}
        >
          ×
        </button>
      </header>
      <div class="editor-body">
        <aside class="page-rail" aria-labelledby="form-pages-heading">
          <h3 id="form-pages-heading">{t('phase.form.pages', 'Pages')}</h3>
          <PageGrid
            variant="rail"
            {pageCount}
            selected={[activePage]}
            thumbnailKey={fileKey}
            thumbnailLoader={renderThumbnail}
            onselect={(pageNumber) => void selectPage(pageNumber)}
          />
        </aside>
        <main class="editor-canvas-area">
          <div class="canvas-toolbar" aria-live="polite">
            <span
              >{t('phase.form.currentPage', 'Page {value} of {total}', activePage, pageCount)}</span
            >
            <span
              >{t(
                'phase.form.currentFields',
                '{value} fields on this page',
                activeFieldCount,
              )}</span
            >
          </div>
          {#if pageImage}
            <div class="document-page" style={`aspect-ratio: ${pageWidth} / ${pageHeight}`}>
              <img
                src={pageImage}
                alt={t('shell.preview.pageAlt', 'Preview of page {value}', activePage)}
              />
              <div class="field-layer">
                {#each activeWidgets as entry (entry.field.name + '-' + entry.widget.x + '-' + entry.widget.y)}
                  {#if entry.field.type === 'PDFRadioGroup' && !isFirstWidgetOnPage(entry)}
                    <!-- The radio group is represented once by a select control. -->
                  {:else if entry.field.type === 'PDFTextField'}
                    <input
                      class="field-control text-control"
                      style={widgetStyle(entry.widget)}
                      aria-label={entry.field.name}
                      value={stringValue(entry.field)}
                      oninput={(event) =>
                        updateValue(
                          entry.field.name,
                          (event.currentTarget as { value: string }).value,
                        )}
                    />
                  {:else if entry.field.type === 'PDFCheckBox'}
                    <button
                      class:checked={valueFor(entry.field) === true}
                      class="field-control checkbox-control"
                      style={widgetStyle(entry.widget)}
                      type="button"
                      aria-label={entry.field.name}
                      aria-pressed={valueFor(entry.field) === true}
                      onclick={() => updateValue(entry.field.name, valueFor(entry.field) !== true)}
                      >{valueFor(entry.field) === true ? '✓' : ''}</button
                    >
                  {:else if entry.field.type === 'PDFDropdown' || entry.field.type === 'PDFRadioGroup'}
                    <select
                      class="field-control select-control"
                      style={widgetStyle(entry.widget)}
                      aria-label={entry.field.name}
                      value={stringValue(entry.field)}
                      onchange={(event) =>
                        updateValue(
                          entry.field.name,
                          (event.currentTarget as { value: string }).value,
                        )}
                    >
                      <option value="">{entry.field.name}</option>
                      {#each entry.field.options ?? [] as option (option)}<option value={option}
                          >{option}</option
                        >{/each}
                    </select>
                  {:else}
                    <span
                      class="field-control unsupported-control"
                      style={widgetStyle(entry.widget)}
                      title={entry.field.type}
                    >
                      {entry.field.name}
                    </span>
                  {/if}
                {/each}
              </div>
            </div>
          {/if}
          {#if activeFieldCount === 0}
            <p class="empty-page" role="status">
              {t(
                'phase.form.noPageFields',
                'This page has no supported fillable fields. Choose another page from the rail.',
              )}
            </p>
          {/if}
        </main>
      </div>
    </dialog>
  </div>
{/if}

<style>
  .form-preview {
    background: color-mix(in srgb, var(--color-white) 55%, transparent);
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-panel);
    padding: 20px;
  }

  .preview-toolbar,
  .editor-header,
  .canvas-toolbar {
    align-items: flex-start;
    display: flex;
    gap: 16px;
    justify-content: space-between;
  }

  h2,
  h3,
  p {
    margin: 0;
  }

  .preview-toolbar p,
  .editor-header p,
  .canvas-toolbar,
  .status {
    color: var(--color-muted);
  }

  .preview-toolbar p,
  .editor-header p {
    margin-top: 6px;
  }

  .preview-page-button {
    background: #fff;
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-panel);
    cursor: pointer;
    display: block;
    margin: 20px auto 0;
    max-width: min(100%, 520px);
    padding: 10px;
  }

  .preview-page-button:hover,
  .preview-page-button:focus-visible {
    border-color: var(--color-focus);
    outline: 3px solid color-mix(in srgb, var(--color-focus) 30%, transparent);
    outline-offset: 3px;
  }

  .preview-page-button img {
    display: block;
    height: auto;
    max-width: 100%;
  }

  .error {
    color: #9a2f24;
  }

  .editor-backdrop {
    background: rgb(28 26 23 / 78%);
    inset: 0;
    padding: 18px;
    position: fixed;
    z-index: 50;
  }

  .editor-modal {
    background: var(--color-canvas);
    border-radius: var(--radius-panel);
    border: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    height: 100%;
    margin: 0;
    max-height: none;
    max-width: none;
    overflow: hidden;
    padding: 0;
    width: 100%;
  }

  .editor-header {
    border-bottom: 1px solid var(--color-hairline);
    padding: 18px 24px;
  }

  .eyebrow {
    color: var(--color-muted);
    font-size: 0.75rem;
    letter-spacing: 0.12em;
  }

  .editor-header h2 {
    margin-top: 4px;
  }

  .close-button {
    background: transparent;
    border: 1px solid var(--color-hairline);
    border-radius: 50%;
    color: inherit;
    cursor: pointer;
    flex: 0 0 auto;
    font-size: 1.75rem;
    height: 44px;
    line-height: 1;
    width: 44px;
  }

  .close-button:hover,
  .close-button:focus-visible {
    background: var(--color-white);
    outline: 3px solid var(--color-focus);
    outline-offset: 3px;
  }

  .editor-body {
    display: grid;
    grid-template-columns: 260px minmax(0, 1fr);
    min-height: 0;
  }

  .page-rail {
    background: color-mix(in srgb, var(--color-white) 65%, transparent);
    border-right: 1px solid var(--color-hairline);
    min-width: 0;
    overflow: auto;
    padding: 18px;
  }

  .page-rail h3 {
    margin-bottom: 12px;
  }

  .editor-canvas-area {
    min-width: 0;
    overflow: auto;
    padding: 18px;
  }

  .canvas-toolbar {
    margin: 0 auto 14px;
    max-width: 900px;
  }

  .document-page {
    background: #fff;
    box-shadow: 0 10px 32px rgb(0 0 0 / 24%);
    margin: 0 auto;
    max-width: 900px;
    position: relative;
    width: min(100%, 900px);
  }

  .document-page > img {
    display: block;
    height: auto;
    width: 100%;
  }

  .field-layer {
    inset: 0;
    pointer-events: none;
    position: absolute;
  }

  .field-control {
    box-sizing: border-box;
    font: 600 clamp(0.55rem, 1.25vw, 0.95rem) var(--font-sans, system-ui, sans-serif);
    min-height: 0;
    pointer-events: auto;
    position: absolute;
  }

  .text-control,
  .select-control {
    background: rgb(255 255 255 / 88%);
    border: 2px solid #2673c8;
    border-radius: 4px;
    color: var(--color-ink);
    padding: 2px 5px;
  }

  .text-control:focus,
  .select-control:focus,
  .checkbox-control:focus-visible {
    outline: 3px solid #f0a400;
    outline-offset: 2px;
  }

  .checkbox-control {
    align-items: center;
    background: rgb(255 255 255 / 88%);
    border: 2px solid #2673c8;
    border-radius: 4px;
    color: #2673c8;
    display: flex;
    justify-content: center;
    padding: 0;
  }

  .checkbox-control.checked {
    background: #e3f0ff;
  }

  .unsupported-control {
    align-items: center;
    background: rgb(190 70 45 / 76%);
    border: 1px dashed #7c2018;
    color: #fff;
    display: flex;
    justify-content: center;
    overflow: hidden;
    padding: 2px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty-page {
    color: var(--color-muted);
    margin: 18px auto;
    max-width: 900px;
  }

  @media (max-width: 700px) {
    .editor-backdrop {
      padding: 0;
    }

    .editor-modal {
      border-radius: 0;
    }

    .editor-header {
      padding: 14px 16px;
    }

    .editor-header p {
      max-width: 34ch;
    }

    .editor-body {
      grid-template-columns: 180px minmax(0, 1fr);
    }

    .page-rail,
    .editor-canvas-area {
      padding: 12px;
    }

    .preview-toolbar {
      align-items: stretch;
      flex-direction: column;
    }
  }
</style>

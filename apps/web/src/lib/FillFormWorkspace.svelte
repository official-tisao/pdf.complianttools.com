<script lang="ts">
  import { tick } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { browser } from '$app/environment';
  import '$lib/configure-pdfjs';
  import { loadPdfJs } from '@pdf-complianttools/engine/pdfjs';
  import { inspectFormFields, fillFormPdf } from '@pdf-complianttools/engine';
  import { downloadBytes } from '$lib/download';
  import { translate, type Locale } from '$lib/i18n';
  import { getLocaleContext } from '../routes/__locale/context';
  import FileDropZone from '$lib/FileDropZone.svelte';
  import Button from '@pdf-complianttools/ui/Button.svelte';
  import PageGrid from '@pdf-complianttools/ui/PageGrid.svelte';

  interface PdfAnnotation {
    fieldName: string;
    fieldType: string;
    value?: string | boolean | readonly string[];
    rect: { x: number; y: number; width: number; height: number };
    pageNumber: number;
    options?: string[];
    readonly?: boolean;
    exportValue?: string;
  }

  let { locale: localeProp }: { locale?: Locale } = $props();
  const locale = $derived(localeProp ?? getLocaleContext());
  const t = (key: string, fallback: string, ...values: Array<string | number | undefined>) =>
    translate(locale, key, fallback, ...values);

  // State
  let file = $state<File | null>(null);
  let bytes = $state<Uint8Array | null>(null);
  let exportBytes = $state<Uint8Array | null>(null);
  let pdfDoc = $state<unknown>(null);
  let pageCount = $state(0);
  let currentPage = $state(1);
  let scale = $state(1.0);
  let annotations = $state<PdfAnnotation[]>([]); // Widget-level annotations for rendering
  let fieldValues = $state<Record<string, string | boolean | readonly string[]>>({});
  let status = $state(t('fillForm.status.idle', 'Drop a PDF with fillable form fields to begin.'));
  let error = $state('');
  let loading = $state(false);
  let canvas = $state<HTMLCanvasElement | null>(null);
  let overlayContainer = $state<HTMLDivElement | null>(null);
  let thumbnailKey = $state('');
  let loadingTask: unknown = undefined;
  let hydrated = $derived(true);
  let hasFormFields = $state(false);
  let unsupportedFields = $state(false);
  let dirty = $state(false);

  // Logical fields derived from annotations (grouped by fieldName for radio buttons)
  let logicalFields = $derived.by(() => {
    if (!annotations.length) return [];
    const groups = new SvelteMap<string, PdfAnnotation[]>();
    for (const annot of annotations) {
      const existing = groups.get(annot.fieldName);
      if (existing) {
        existing.push(annot);
      } else {
        groups.set(annot.fieldName, [annot]);
      }
    }
    // For each fieldName group, create one logical field entry
    const logical: PdfAnnotation[] = [];
    for (const [, widgets] of groups.entries()) {
      // Use the first widget as the representative, but merge radio options
      const first = widgets[0];
      if (first.fieldType.toLowerCase() === 'radio' && widgets.length > 1) {
        // Collect all exportValues as options for radio group
        const radioOptions = widgets
          .map((w) => w.exportValue)
          .filter((v): v is string => typeof v === 'string' && v.length > 0);
        logical.push({
          ...first,
          fieldType: 'radio',
          options: radioOptions.length > 0 ? radioOptions : first.options,
        });
      } else {
        logical.push(first);
      }
    }
    return logical;
  });

  // Guard all PDF processing behind browser check. Returns false rather than
  // throwing so prerendering stays quiet — nothing here should run on the server.
  function ensureBrowser() {
    if (!browser) return false;
    return true;
  }

  async function selectFile(files: File[]) {
    ensureBrowser();
    if (!files.length) return;
    const newFile = files[0];
    file = newFile;
    bytes = null;
    exportBytes = null;
    pdfDoc = null;
    pageCount = 0;
    currentPage = 1;
    scale = 1.0;
    annotations = [];
    fieldValues = {};
    status = t('fillForm.status.loading', 'Loading PDF…');
    error = '';
    loading = true;
    dirty = false;
    hasFormFields = false;
    unsupportedFields = false;

    try {
      const fileBytes = new Uint8Array(await newFile.arrayBuffer());
      // Create independent copies BEFORE pdf.js loads the document,
      // because pdfjs.getDocument({ data }) transfers ownership of the buffer
      // to its worker thread.
      const renderBytes = fileBytes.slice();
      const inspectBytes = fileBytes.slice();
      const exportBuf = fileBytes.slice();
      bytes = renderBytes; // keep for rendering
      exportBytes = exportBuf; // keep for export (independent copy)
      thumbnailKey = `${newFile.name}:${newFile.size}:${newFile.lastModified}`;

      const pdfjs = await loadPdfJs();
      loadingTask?.destroy();
      loadingTask = pdfjs.getDocument({ data: renderBytes });
      pdfDoc = await loadingTask.promise;
      pageCount = pdfDoc.numPages;

      // Inspect form fields using pdf.js document-level + page-level detection.
      // Use the independent inspectBytes copy which was never transferred.
      const fields = await inspectFormFields(inspectBytes);
      if (fields.length === 0) {
        hasFormFields = false;
        status = t(
          'fillForm.status.noFields',
          'No interactive AcroForm fields were found in this document.',
        );
      } else {
        hasFormFields = true;
        // Store field values from detected fields for use in overlays
        for (const field of fields) {
          if (field.value !== undefined) {
            fieldValues = { ...fieldValues, [field.name]: field.value };
          }
        }
        // Get annotations from pdf.js to get widget coordinates
        await loadAnnotations();
        status = t('fillForm.status.ready', '{count} fillable fields ready.', logicalFields.length);
      }
    } catch (err) {
      error = err instanceof Error ? err.message : t('fillForm.error.load', 'Could not load PDF.');
      status = '';
    } finally {
      loading = false;
    }
  }

  async function loadAnnotations() {
    ensureBrowser();
    if (!pdfDoc || !bytes) return;

    await loadPdfJs();
    const newAnnotations: PdfAnnotation[] = [];

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.0 });

      // Get annotations for this page
      const annotationsData = await page.getAnnotations({ intent: 'any' });
      if (!annotationsData) continue;

      for (const annot of annotationsData) {
        // Only process Widget annotations (form fields)
        if (annot.subtype !== 'Widget') continue;
        if (!annot.fieldName) continue;

        // Convert PDF coordinates (bottom-left origin) to viewport coordinates (top-left origin)
        // PDF rect is [x1, y1, x2, y2] where (x1,y1) is bottom-left and (x2,y2) is top-right
        const pdfRect = annot.rect as [number, number, number, number];
        const [x1, y1, x2, y2] = pdfRect;
        const width = x2 - x1;
        const height = y2 - y1;

        const viewportX = x1;
        const viewportY = viewport.height - y2;

        // Field type and value are already resolved by inspectFormFields document-level detection.
        // Use annotation properties as fallback if type is somehow unknown.
        let fieldType = annot.multiLine === true ? 'textarea' :
                        annot.checkBox === true ? 'checkbox' :
                        annot.radioButton === true ? 'radio' :
                        annot.pushButton === true ? 'button' :
                        annot.combo === true ? 'dropdown' :
                        annot.multiSelect === true ? 'dropdown' :
                        annot.fieldType === 'Tx' ? 'text' :
                        annot.fieldType === 'Btn' ? 'checkbox' :
                        annot.fieldType === 'Ch' ? 'dropdown' :
                        annot.fieldType === 'Sig' ? 'button' : 'text';
        let value: string | boolean | readonly string[] | undefined;
        let options: string[] | undefined;
        let readonly = Boolean(annot.readonly);

        // Populate options for dropdowns/list boxes from the annotation's
        // options array (each entry is {exportValue, displayValue}).
        if (annot.options && Array.isArray(annot.options)) {
          options = annot.options.map((opt: { exportValue?: string; displayValue?: string }) =>
            opt.displayValue ?? opt.exportValue ?? ''
          );
        }

        // Use the field value from fieldValues (initialized by inspectFormFields)
        // so overlays show the actual field content instead of empty inputs.
        value = fieldValues[annot.fieldName] !== undefined ? fieldValues[annot.fieldName] : value;

        newAnnotations.push({
          fieldName: annot.fieldName,
          fieldType,
          value,
          rect: { x: viewportX, y: viewportY, width, height },
          pageNumber: pageNum,
          options,
          readonly,
          exportValue: annot.exportValue ?? annot.buttonValue ?? undefined,
        });
      }
    }

    annotations = newAnnotations;
    // Use logical fields for unsupported check to avoid false positives from radio button widgets
    unsupportedFields = logicalFields.some(
      (a) =>
        !['text', 'checkbox', 'radio', 'dropdown', 'button', 'textarea'].includes(
          a.fieldType.toLowerCase(),
        ),
    );
  }

  async function renderPage() {
    ensureBrowser();
    if (!pdfDoc || !canvas) return;
    const page = await pdfDoc.getPage(currentPage);
    const viewport = page.getViewport({ scale });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) return;

    // Clear with white background
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvas, canvasContext: context, viewport }).promise;

    // Update overlay container size
    if (overlayContainer) {
      overlayContainer.style.width = `${canvas.width}px`;
      overlayContainer.style.height = `${canvas.height}px`;
    }

    renderOverlays();
  }

  function renderOverlays() {
    if (!browser || !overlayContainer) return;

    // Clear existing overlays - overlayContainer is managed by us (bind:this), so direct DOM manipulation is intentional
    /* eslint-disable svelte/no-dom-manipulating */
    while (overlayContainer.firstChild) {
      overlayContainer.removeChild(overlayContainer.firstChild);
    }
    /* eslint-enable svelte/no-dom-manipulating */

    const pageAnnotations = annotations.filter((a) => a.pageNumber === currentPage);
    for (const annot of pageAnnotations) {
      const overlay = createFieldOverlay(annot);
      if (overlay) {
        /* eslint-disable svelte/no-dom-manipulating */
        overlayContainer.appendChild(overlay);
        /* eslint-enable svelte/no-dom-manipulating */
      }
    }
  }

  function createFieldOverlay(annot: PdfAnnotation): HTMLElement | null {
    if (!browser) return null;
    const { rect, fieldName, fieldType, value, readonly, options } = annot;

    // Scale rect to current viewport
    const left = rect.x * scale;
    const top = rect.y * scale;
    const width = Math.max(rect.width * scale, 60);
    const height = Math.max(rect.height * scale, 24);

    // Consistent font size matching PDF export (12pt = 16px at default scale)
    // Use 12px as base, scales with viewport scale factor
    const baseFontSize = 12;
    const fontSize = Math.max(10, baseFontSize * scale);

    const wrapper = document.createElement('div');
    wrapper.className = 'field-overlay';
    wrapper.style.cssText = `
      position: absolute;
      left: ${left}px;
      top: ${top}px;
      width: ${width}px;
      height: ${height}px;
      pointer-events: ${readonly ? 'none' : 'auto'};
      z-index: 10;
    `;
    wrapper.dataset.fieldName = fieldName;

    if (readonly) {
      wrapper.style.opacity = '0.5';
    }

    switch (fieldType.toLowerCase()) {
      case 'text': {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = (value as string) || '';
        if (readonly) input.disabled = true;
        input.style.cssText = `
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          border: 1px solid #3b82f6;
          border-radius: 3px;
          background: ${readonly ? '#f3f4f6' : '#eff6ff'};
          padding: 0 6px;
          font: inherit;
          font-size: ${fontSize}px;
          line-height: ${height}px;
          outline: none;
          cursor: ${readonly ? 'not-allowed' : 'text'};
        `;
        input.addEventListener('input', (e) => {
          fieldValues = { ...fieldValues, [fieldName]: (e.target as HTMLInputElement).value };
          dirty = true;
          updateStatus();
        });
        input.addEventListener('focus', () => wrapper.classList.add('focused'));
        input.addEventListener('blur', () => wrapper.classList.remove('focused'));
        wrapper.appendChild(input);
        break;
      }

      case 'textarea': {
        const input = document.createElement('textarea');
        input.value = (value as string) || '';
        if (readonly) input.disabled = true;
        input.style.cssText = `
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          border: 1px solid #3b82f6;
          border-radius: 3px;
          background: ${readonly ? '#f3f4f6' : '#eff6ff'};
          padding: 4px 6px;
          font: inherit;
          font-size: ${fontSize}px;
          line-height: 1.4;
          outline: none;
          resize: none;
          cursor: ${readonly ? 'not-allowed' : 'text'};
        `;
        input.addEventListener('input', (e) => {
          fieldValues = { ...fieldValues, [fieldName]: (e.target as HTMLTextAreaElement).value };
          dirty = true;
          updateStatus();
        });
        input.addEventListener('focus', () => wrapper.classList.add('focused'));
        input.addEventListener('blur', () => wrapper.classList.remove('focused'));
        wrapper.appendChild(input);
        break;
      }

      case 'checkbox': {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = Boolean(value);
        input.style.cssText = `
          width: ${height}px;
          height: ${height}px;
          accent-color: #3b82f6;
          cursor: ${readonly ? 'not-allowed' : 'pointer'};
        `;
        if (readonly) input.disabled = true;
        input.addEventListener('change', (e) => {
          fieldValues = { ...fieldValues, [fieldName]: (e.target as HTMLInputElement).checked };
          dirty = true;
          updateStatus();
        });
        input.addEventListener('focus', () => wrapper.classList.add('focused'));
        input.addEventListener('blur', () => wrapper.classList.remove('focused'));
        wrapper.appendChild(input);
        break;
      }

      case 'radio': {
        // Radio buttons are grouped by fieldName - we need special handling
        // For now, create a single radio - in reality we'd need all options
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = `radio-${fieldName}`;
        input.value = (value as string) || 'on';
        input.checked = Boolean(value);
        input.style.cssText = `
          width: ${height}px;
          height: ${height}px;
          accent-color: #3b82f6;
          cursor: ${readonly ? 'not-allowed' : 'pointer'};
        `;
        if (readonly) input.disabled = true;
        input.addEventListener('change', (e) => {
          if ((e.target as HTMLInputElement).checked) {
            fieldValues = { ...fieldValues, [fieldName]: (e.target as HTMLInputElement).value };
            dirty = true;
            updateStatus();
          }
        });
        input.addEventListener('focus', () => wrapper.classList.add('focused'));
        input.addEventListener('blur', () => wrapper.classList.remove('focused'));
        wrapper.appendChild(input);
        break;
      }

      case 'dropdown':
      case 'combobox': {
        const input = document.createElement('select');
        // Add placeholder
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '— Select —';
        placeholder.disabled = true;
        placeholder.selected = !value;
        input.appendChild(placeholder);

        // Populate options from annotation options if available
        if (options && Array.isArray(options) && options.length > 0) {
          for (const opt of options) {
            const optElement = document.createElement('option');
            optElement.value = String(opt ?? '');
            optElement.textContent = String(opt ?? '');
            // Select the current value if it matches
            if (value !== undefined && String(value) === String(opt)) {
              optElement.selected = true;
            }
            input.appendChild(optElement);
          }
        } else if (value) {
          // Fallback: just show the current value
          const opt = document.createElement('option');
          opt.value = String(value);
          opt.textContent = String(value);
          opt.selected = true;
          input.appendChild(opt);
        }
        input.style.cssText = `
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          border: 1px solid #3b82f6;
          border-radius: 3px;
          background: #eff6ff;
          padding: 0 6px;
          font: inherit;
          font-size: ${fontSize}px;
          line-height: ${height}px;
          outline: none;
          cursor: ${readonly ? 'not-allowed' : 'pointer'};
        `;
        if (readonly) input.disabled = true;
        input.addEventListener('change', (e) => {
          fieldValues = { ...fieldValues, [fieldName]: (e.target as HTMLSelectElement).value };
          dirty = true;
          updateStatus();
        });
        input.addEventListener('focus', () => wrapper.classList.add('focused'));
        input.addEventListener('blur', () => wrapper.classList.remove('focused'));
        wrapper.appendChild(input);
        break;
      }

      default: {
        // Unsupported field type - show indicator
        const badge = document.createElement('span');
        badge.className = 'unsupported-badge';
        badge.textContent = fieldType;
        badge.title = t('fillForm.field.unsupported', 'Unsupported field type: {type}', fieldType);
        wrapper.appendChild(badge);
        wrapper.style.cssText += `
          display: flex;
          align-items: center;
          justify-content: center;
          background: #fef3c7;
          border: 1px dashed #f59e0b;
          border-radius: 3px;
          color: #92400e;
          font-size: 10px;
        `;
        return wrapper;
      }
    }

    return wrapper;
  }

  function updateStatus() {
    if (!hasFormFields) return;
    const total = logicalFields.length;
    const filled = logicalFields.filter((field) => {
      const v = fieldValues[field.fieldName];
      if (v === undefined) return false;
      // Checkbox is always considered filled since it has a boolean value (checked/unchecked)
      if (field.fieldType.toLowerCase() === 'checkbox') return true;
      // Radio group is filled if a value is selected
      if (field.fieldType.toLowerCase() === 'radio') return v !== undefined && v !== '';
      // Text, textarea, dropdown: filled if non-empty
      return v !== '' && !(Array.isArray(v) && v.length === 0);
    }).length;
    if (dirty) {
      status = t(
        'fillForm.status.dirty',
        '{filled}/{total} fields filled — unsaved changes',
        filled,
        total,
      );
    } else {
      status = t('fillForm.status.clean', '{filled}/{total} fields filled', filled, total);
    }
  }

  async function navigatePage(delta: number) {
    ensureBrowser();
    const newPage = Math.max(1, Math.min(pageCount, currentPage + delta));
    if (newPage !== currentPage) {
      currentPage = newPage;
      await renderPage();
    }
  }

  async function goToPage(page: number) {
    ensureBrowser();
    if (page >= 1 && page <= pageCount && page !== currentPage) {
      currentPage = page;
      await renderPage();
    }
  }

  function zoom(delta: number) {
    ensureBrowser();
    const newScale = Math.max(0.25, Math.min(4, scale + delta));
    if (newScale !== scale) {
      scale = newScale;
      renderPage();
    }
  }

  function zoomFit() {
    ensureBrowser();
    if (!canvas) return;
    const container = canvas.parentElement;
    if (!container) return;
    // We'd need the page dimensions to calculate proper fit
    scale = 1.0;
    renderPage();
  }

  // Keyboard navigation
  function handleKeydown(event: KeyboardEvent) {
    if (!hasFormFields) return;

    // Tab navigation between fields
    if (event.key === 'Tab') {
      event.preventDefault();
      const direction = event.shiftKey ? -1 : 1;
      focusNextField(direction);
    }

    // Page navigation with arrows when not in an input
    const activeElement = document.activeElement;
    const isInInput =
      activeElement?.tagName === 'INPUT' ||
      activeElement?.tagName === 'TEXTAREA' ||
      activeElement?.tagName === 'SELECT';

    if (!isInInput) {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        navigatePage(-1);
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        navigatePage(1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        goToPage(1);
      } else if (event.key === 'End') {
        event.preventDefault();
        goToPage(pageCount);
      }
    }

    // Zoom with +/- when not in input
    if (!isInInput) {
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoom(0.25);
      } else if (event.key === '-') {
        event.preventDefault();
        zoom(-0.25);
      } else if (event.key === '0') {
        event.preventDefault();
        zoomFit();
      }
    }
  }

  function focusNextField(direction: number) {
    const pageAnnotations = annotations.filter((a) => a.pageNumber === currentPage && !a.readonly);
    if (pageAnnotations.length === 0) {
      // Try to find field on next/prev page
      let targetPage = currentPage;
      let attempts = 0;
      while (attempts < pageCount) {
        targetPage = Math.max(1, Math.min(pageCount, targetPage + direction));
        const nextPageAnnotations = annotations.filter(
          (a) => a.pageNumber === targetPage && !a.readonly,
        );
        if (nextPageAnnotations.length > 0) {
          goToPage(targetPage).then(() => {
            tick().then(() => {
              const firstField = overlayContainer?.querySelector(
                '[data-field-name] input, [data-field-name] textarea, [data-field-name] select',
              );
              (firstField as HTMLElement)?.focus();
            });
          });
          return;
        }
        attempts++;
      }
      return;
    }

    const currentField = document.activeElement as HTMLElement;
    const currentFieldName = currentField?.dataset?.fieldName;
    let currentIndex = -1;

    if (currentFieldName) {
      currentIndex = pageAnnotations.findIndex((a) => a.fieldName === currentFieldName);
    }

    let nextIndex = direction > 0 ? currentIndex + 1 : currentIndex - 1;

    if (nextIndex >= pageAnnotations.length) {
      // Go to next page
      let targetPage = currentPage;
      let attempts = 0;
      while (attempts < pageCount) {
        targetPage = Math.max(1, Math.min(pageCount, targetPage + 1));
        const nextPageAnnotations = annotations.filter(
          (a) => a.pageNumber === targetPage && !a.readonly,
        );
        if (nextPageAnnotations.length > 0) {
          goToPage(targetPage).then(() => {
            tick().then(() => {
              const firstField = overlayContainer?.querySelector(
                '[data-field-name] input, [data-field-name] textarea, [data-field-name] select',
              );
              (firstField as HTMLElement)?.focus();
            });
          });
          return;
        }
        attempts++;
      }
      // Wrap to first page
      goToPage(1).then(() => {
        tick().then(() => {
          const firstField = overlayContainer?.querySelector(
            '[data-field-name] input, [data-field-name] textarea, [data-field-name] select',
          );
          (firstField as HTMLElement)?.focus();
        });
      });
    } else if (nextIndex < 0) {
      // Go to previous page
      let targetPage = currentPage;
      let attempts = 0;
      while (attempts < pageCount) {
        targetPage = Math.max(1, Math.min(pageCount, targetPage - 1));
        const prevPageAnnotations = annotations.filter(
          (a) => a.pageNumber === targetPage && !a.readonly,
        );
        if (prevPageAnnotations.length > 0) {
          goToPage(targetPage).then(() => {
            tick().then(() => {
              const lastField = overlayContainer?.querySelectorAll(
                '[data-field-name] input, [data-field-name] textarea, [data-field-name] select',
              );
              if (lastField && lastField.length > 0) {
                (lastField[lastField.length - 1] as HTMLElement)?.focus();
              }
            });
          });
          return;
        }
        attempts++;
      }
      // Wrap to last page
      goToPage(pageCount).then(() => {
        tick().then(() => {
          const lastField = overlayContainer?.querySelectorAll(
            '[data-field-name] input, [data-field-name] textarea, [data-field-name] select',
          );
          if (lastField && lastField.length > 0) {
            (lastField[lastField.length - 1] as HTMLElement)?.focus();
          }
        });
      });
    } else {
      const nextField = pageAnnotations[nextIndex];
      const input = overlayContainer?.querySelector(
        `[data-field-name="${nextField.fieldName}"] input, [data-field-name="${nextField.fieldName}"] textarea, [data-field-name="${nextField.fieldName}"] select`,
      );
      (input as HTMLElement)?.focus();
    }
  }

  async function downloadFilled() {
    ensureBrowser();
    if (!exportBytes || !hasFormFields) return;

    error = '';
    status = t('fillForm.status.generating', 'Generating filled PDF…');
    loading = true;

    try {
      const filledBytes = await fillFormPdf(exportBytes!, fieldValues);
      const name = file?.name?.replace(/\.pdf$/i, '') || 'filled-form';
      downloadBytes(filledBytes, `${name}-filled.pdf`);
      status = t('fillForm.status.downloaded', 'Filled PDF downloaded successfully.');
      dirty = false;
      updateStatus();
    } catch (err) {
      error =
        err instanceof Error
          ? err.message
          : t('fillForm.error.download', 'Could not generate filled PDF.');
    } finally {
      loading = false;
    }
  }

  // Register the keyboard listener once on mount and clean it up on destroy.
  // The effect's cleanup runs both the listener removal and the PDF loading
  // task teardown, so there is exactly one place that owns both.
  $effect(() => {
    if (!browser) return;
    document.addEventListener('keydown', handleKeydown);
    return () => {
      document.removeEventListener('keydown', handleKeydown);
      loadingTask?.destroy();
    };
  });

  // Re-render when page or scale changes
  $effect(() => {
    if (!browser) return;
    void currentPage; // track dependency
    void scale; // track dependency
    if (pdfDoc && canvas) {
      renderPage();
    }
  });
</script>



<svelte:head>
  <title>{t('fillForm.title', 'Fill PDF Form')}</title>
  <meta
    name="description"
    content={t(
      'fillForm.desc',
      'Fill out PDF forms locally in your browser. Detect AcroForm fields, edit values, and export a filled PDF. No uploads.',
    )}
  />
</svelte:head>

<section class="fill-form-page" data-hydrated={hydrated ? 'true' : 'false'}>
  <header class="page-header">
    <p class="eyebrow">{t('fillForm.eyebrow', 'EDIT & SECURITY')}</p>
    <h1>{t('fillForm.title', 'Fill PDF Form')}</h1>
    <p class="lede">
      {t(
        'fillForm.desc',
        'Fill out PDF forms locally in your browser. Detect AcroForm fields, edit values, and export a filled PDF. No uploads.',
      )}
    </p>
    <div class="trust">
      <strong>{t('shell.trust.strong', 'Local-first.')}</strong>
      {t(
        'fillForm.trust',
        'This route does not upload document bytes or credentials. All processing happens in your browser.',
      )}
    </div>
  </header>

  {#if !file}
    <FileDropZone
      label={t('fillForm.drop.label', 'PDF with fillable form fields')}
      accept=".pdf,application/pdf"
      onfiles={selectFile}
    />
  {:else}
    <div class="workspace">
      <!-- Toolbar -->
      <div
        class="toolbar"
        role="toolbar"
        aria-label={t('fillForm.toolbar.label', 'Document controls')}
      >
        <div class="toolbar-left">
          <span class="filename" title={file?.name}>{file?.name}</span>
          {#if hasFormFields}
            <span class="field-count" aria-live="polite">
              {logicalFields.length}
              {t('fillForm.fields.count', 'fields')}
            </span>
            {#if unsupportedFields}
              <span class="warning-badge">
                {t('fillForm.warning.unsupported', 'Some field types not supported')}
              </span>
            {/if}
          {:else}
            <span class="no-fields">
              <span class="t">No interactive AcroForm fields found</span>
            </span>
          {/if}
        </div>

        <div class="toolbar-center">
          <Button
            variant="secondary"
            disabled={currentPage <= 1 || loading}
            onclick={() => navigatePage(-1)}
            aria-label={t('fillForm.nav.prev', 'Previous page')}
          >
            ← {t('fillForm.nav.prevShort', 'Prev')}
          </Button>
          <span class="page-indicator" aria-live="polite">
            {t('fillForm.nav.pageOf', 'Page {current} of {total}', currentPage, pageCount)}
          </span>
          <Button
            variant="secondary"
            disabled={currentPage >= pageCount || loading}
            onclick={() => navigatePage(1)}
            aria-label={t('fillForm.nav.next', 'Next page')}
          >
            {t('fillForm.nav.nextShort', 'Next')} →
          </Button>
        </div>

        <div class="toolbar-right">
          <Button
            variant="secondary"
            disabled={scale <= 0.25 || loading}
            onclick={() => zoom(-0.25)}
            aria-label={t('fillForm.zoom.out', 'Zoom out')}
          >
            −
          </Button>
          <span class="zoom-indicator" aria-live="polite">{Math.round(scale * 100)}%</span>
          <Button
            variant="secondary"
            disabled={scale >= 4 || loading}
            onclick={() => zoom(0.25)}
            aria-label={t('fillForm.zoom.in', 'Zoom in')}
          >
            +
          </Button>
          <Button
            variant="secondary"
            disabled={loading}
            onclick={zoomFit}
            aria-label={t('fillForm.zoom.fit', 'Fit to width')}
          >
            ⛶
          </Button>
          <Button
            disabled={!hasFormFields || loading || !dirty}
            onclick={downloadFilled}
            class="download-btn"
          >
            {loading
              ? t('fillForm.status.generating', 'Generating…')
              : t('fillForm.action.download', 'Download filled PDF')}
          </Button>
        </div>
      </div>

      <!-- Main viewer area -->
      <div class="viewer-area">
        <!-- Sidebar with thumbnails -->
        <aside class="sidebar" aria-label={t('fillForm.sidebar.label', 'Page thumbnails')}>
          {#if pageCount > 1}
            <PageGrid
              {pageCount}
              selected={[currentPage]}
              {thumbnailKey}
              thumbnailLoader={async (pageNumber) => {
                if (!pdfDoc) return '';
                const page = await pdfDoc.getPage(pageNumber);
                const viewport = page.getViewport({ scale: 0.22 });
                const thumbCanvas = document.createElement('canvas');
                thumbCanvas.width = Math.ceil(viewport.width);
                thumbCanvas.height = Math.ceil(viewport.height);
                const context = thumbCanvas.getContext('2d');
                if (!context) return '';
                await page.render({ canvas: thumbCanvas, canvasContext: context, viewport })
                  .promise;
                return thumbCanvas.toDataURL('image/png');
              }}
              onselect={(pageNumber) => goToPage(pageNumber)}
            />
          {:else}
            <div class="single-page-badge">
              {t('fillForm.sidebar.single', 'Single page')}
            </div>
          {/if}
        </aside>

        <!-- PDF Canvas with overlays -->
        <main
          class="canvas-area"
          role="application"
          aria-label={t('fillForm.canvas.label', 'PDF form')}
        >
          <div class="canvas-wrapper">
            <canvas bind:this={canvas} class="pdf-canvas"></canvas>
            <div bind:this={overlayContainer} class="overlay-layer"></div>
          </div>
          {#if !hasFormFields && pageCount > 0}
            <div class="no-forms-message">
              <p>
                {t(
                  'fillForm.status.noFields',
                  'No interactive AcroForm fields were found in this document.',
                )}
              </p>
              <p class="hint">
                {t(
                  'fillForm.hint.flat',
                  'This PDF appears to be a flat document or uses unsupported field types.',
                )}
              </p>
            </div>
          {/if}
        </main>
      </div>
    </div>

    <div class="status-bar" role="status" aria-live="polite">
      {#if error}
        <span class="error">{error}</span>
      {:else}
        <span>{status}</span>
      {/if}
    </div>
  {/if}

  <noscript>
    <p class="noscript">
      {t(
        'fillForm.noscript',
        'This tool runs entirely in your browser and needs JavaScript enabled. The file picker above is visible without it, but it cannot read a file or produce a PDF. Nothing you choose is uploaded.',
      )}
    </p>
  </noscript>
</section>

<style>
  .fill-form-page {
    margin: auto;
    max-width: 1280px;
    padding: 48px 24px 0;
  }

  .eyebrow {
    color: var(--color-muted);
    font-size: 0.875rem;
    letter-spacing: 0.12em;
    margin: 0 0 8px;
  }

  h1 {
    font-size: clamp(2rem, 5vw, 3.5rem);
    letter-spacing: -0.05em;
    margin: 0 0 8px;
  }

  .lede {
    color: var(--color-muted);
    font-size: 1.125rem;
    max-width: 680px;
    margin: 0 0 24px;
  }

  .trust {
    background: var(--color-platinum);
    border-radius: var(--radius-panel);
    margin: 0 0 24px;
    padding: 14px 18px;
    font-size: 0.9rem;
  }

  .workspace {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* Toolbar */
  .toolbar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 16px;
    padding: 12px 16px;
    background: var(--color-white);
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-panel);
    flex-wrap: wrap;
  }

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .filename {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 300px;
  }

  .field-count {
    font-size: 0.875rem;
    color: var(--color-muted);
    background: var(--color-platinum);
    padding: 4px 10px;
    border-radius: var(--radius-pill);
  }

  .warning-badge {
    font-size: 0.75rem;
    color: #92400e;
    background: #fef3c7;
    padding: 2px 8px;
    border-radius: var(--radius-pill);
  }

  .no-fields {
    font-size: 0.875rem;
    color: #9a2d24;
  }

  .toolbar-center {
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: center;
  }

  .page-indicator {
    font-weight: 500;
    min-width: 100px;
    text-align: center;
  }

  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: flex-end;
  }

  .zoom-indicator {
    font-weight: 500;
    min-width: 50px;
    text-align: center;
  }

  .download-btn {
    background: var(--color-ink);
    color: var(--color-white);
  }

  /* Viewer area */
  .viewer-area {
    display: grid;
    grid-template-columns: 180px 1fr;
    gap: 16px;
    min-height: 600px;
  }

  .sidebar {
    background: var(--color-white);
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-panel);
    padding: 12px;
    max-height: 70vh;
    overflow: auto;
  }

  .single-page-badge {
    color: var(--color-muted);
    font-size: 0.875rem;
    text-align: center;
    padding: 24px;
  }

  .canvas-area {
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .canvas-wrapper {
    position: relative;
    background: #464442;
    border-radius: 8px;
    box-shadow: 0 0 0 1px #1c1a1722;
    overflow: hidden;
  }

  .pdf-canvas {
    display: block;
    background: #fff;
  }

  .overlay-layer {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
  }

  .overlay-layer > * {
    pointer-events: auto;
  }

  .no-forms-message {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    text-align: center;
    max-width: 80%;
    color: var(--color-muted);
    pointer-events: none;
  }

  .no-forms-message .hint {
    font-size: 0.875rem;
    margin-top: 8px;
  }

  /* Field overlays */
  .field-overlay {
    transition: box-shadow 150ms ease;
  }

  .field-overlay.focused {
    box-shadow: 0 0 0 2px #3b82f6;
    z-index: 20;
  }

  .field-overlay input,
  .field-overlay textarea,
  .field-overlay select {
    transition: box-shadow 150ms ease;
  }

  .field-overlay input:focus,
  .field-overlay textarea:focus,
  .field-overlay select:focus {
    box-shadow: 0 0 0 2px #3b82f6;
  }

  .unsupported-badge {
    white-space: nowrap;
  }

  /* Status bar */
  .status-bar {
    padding: 12px 16px;
    background: var(--color-white);
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-panel);
    font-size: 0.9rem;
  }

  .status-bar .error {
    color: #9a2d24;
  }

  .noscript {
    margin-top: 48px;
    padding: 16px;
    background: #fef3c7;
    border: 1px solid #f59e0b;
    border-radius: 8px;
    color: #92400e;
  }

  @media (max-width: 900px) {
    .viewer-area {
      grid-template-columns: 1fr;
    }

    .sidebar {
      max-height: 200px;
      order: 2;
    }

    .toolbar {
      grid-template-columns: 1fr;
      gap: 12px;
    }

    .toolbar-left,
    .toolbar-center,
    .toolbar-right {
      justify-content: center;
      width: 100%;
    }

    .filename {
      max-width: none;
    }
  }

  @media (max-width: 767px) {
    .fill-form-page {
      padding-inline: 16px;
      padding-top: 40px;
    }

    .toolbar {
      padding: 10px 12px;
    }

    .toolbar-center {
      flex-wrap: wrap;
    }

    .toolbar-right {
      flex-wrap: wrap;
    }
  }

  @media print {
    .toolbar,
    .sidebar,
    .status-bar,
    .overlay-layer {
      display: none;
    }

    .viewer-area {
      display: block;
    }

    .canvas-wrapper {
      box-shadow: none;
      border-radius: 0;
      background: transparent;
    }

    .pdf-canvas {
      max-width: 100%;
      height: auto;
    }
  }
</style>

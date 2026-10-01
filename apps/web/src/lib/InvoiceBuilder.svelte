<script lang="ts">
  /* global HTMLInputElement */
  /**
   * T38/T39 invoice builder. Owns its own state and calls the local engine only
   * on an explicit gesture — nothing is generated or transmitted on keystroke.
   */
  // Deep subpath import, not the engine barrel: `index.ts` re-exports every
  // module, so importing from it pulls pdfjs, mammoth, exceljs and pptxgenjs
  // into every route that renders this form. `invoiceTotals` runs on every
  // keystroke for the live preview, so it stays eager — it is pure arithmetic
  // with no dependencies. `createInvoicePdf` pulls pdf-lib (~170 KB gzip) and is
  // only needed when the user presses the button, so it loads on demand.
  import { invoiceTotals, validateEInvoiceXml } from '@pdf-complianttools/engine/invoice';
  import type { InvoiceData, InvoiceLine } from '@pdf-complianttools/engine';
  import { downloadBytes } from '$lib/download';
  import { localeAttributes, translate, type Locale } from '$lib/i18n';
  import { getLocaleContext } from '../routes/__locale/context';
  import {
    deleteTemplate,
    listTemplates,
    loadTemplate,
    saveTemplate,
    type NamedTemplate,
  } from '$lib/indexed-store';

  let {
    variant = 'creator',
    locale: localeProp,
  }: { variant?: 'creator' | 'e-invoice'; locale?: Locale } = $props();

  // Explicit prop wins; otherwise the `[locale]` layout's context supplies it,
  // so a generated `[locale]` route renders this builder translated without
  // re-declaring its props. English routes fall back to the `en` source.
  const locale = $derived(localeProp ?? getLocaleContext());

  // Every user-facing string goes through the message boundary: the English
  // text is the fallback, and the key selects a translation. A missing
  // translation degrades to English rather than an empty control.
  const t = (key: string, fallback: string) => translate(locale, key, fallback);
  // Derived: `locale` is a prop a caller can change after mount, and a captured
  // value would leave the section's lang/dir pointing at the old locale.
  const attributes = $derived(localeAttributes(locale));

  const today = () => new Date().toISOString().slice(0, 10);

  let invoiceNumber = $state('INV-0001');
  let issueDate = $state(today());
  let dueDate = $state('');
  let currency = $state('CAD');
  let supplierName = $state('');
  let supplierAddress = $state('');
  let supplierTaxId = $state('');
  let customerName = $state('');
  let customerAddress = $state('');
  let customerTaxId = $state('');
  let notes = $state('');
  let lines = $state<InvoiceLine[]>([{ description: '', quantity: 1, unitPrice: 0 }]);
  let status = $state('');
  let templates = $state<NamedTemplate[]>([]);
  let templateName = $state('');
  let preview = $state<string | undefined>();

  const money = (value: number) => value.toFixed(2);

  function current(): InvoiceData {
    return {
      invoiceNumber: invoiceNumber.trim(),
      issueDate,
      ...(dueDate ? { dueDate } : {}),
      currency: currency.trim().toUpperCase(),
      supplier: {
        name: supplierName.trim(),
        ...(supplierAddress.trim() ? { address: supplierAddress.trim() } : {}),
        ...(supplierTaxId.trim() ? { taxId: supplierTaxId.trim() } : {}),
      },
      customer: {
        name: customerName.trim(),
        ...(customerAddress.trim() ? { address: customerAddress.trim() } : {}),
        ...(customerTaxId.trim() ? { taxId: customerTaxId.trim() } : {}),
      },
      lines: lines.map((line) => ({
        description: line.description,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        ...(line.taxRate === undefined || Number.isNaN(line.taxRate)
          ? {}
          : { taxRate: Number(line.taxRate) }),
      })),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
  }

  // Preview totals come from the same engine function the export uses, so the
  // preview cannot disagree with the PDF.
  const totals = $derived(
    invoiceTotals({
      ...current(),
      lines: lines.filter((line) => line.description.trim() !== ''),
    }),
  );

  function updateLine(index: number, patch: Partial<InvoiceLine>) {
    lines = lines.map((line, position) => (position === index ? { ...line, ...patch } : line));
  }
  function addLine() {
    lines = [...lines, { description: '', quantity: 1, unitPrice: 0 }];
  }
  function removeLine(index: number) {
    lines = lines.filter((_, position) => position !== index);
  }

  function download(bytes: Uint8Array, name: string, mime = 'application/pdf') {
    downloadBytes(bytes, name, mime);
  }

  async function create() {
    try {
      const { createInvoicePdf } = await import('@pdf-complianttools/engine/invoice');
      const result = await createInvoicePdf(current());
      download(result.pdf, `${invoiceNumber.trim() || 'invoice'}.pdf`);
      const check = validateEInvoiceXml(result.xml);
      status = `Created locally. ${money(result.totals.gross)} ${currency.toUpperCase()}. The structured XML attached to the PDF ${check.valid ? 'passed local structural validation' : `did NOT validate: ${check.remedy ?? ''}`}.`;
      preview = result.xml;
    } catch (error) {
      // The engine's remedy is written for the end user; surface it verbatim
      // rather than replacing it with a generic failure message.
      status = error instanceof Error ? error.message : 'The invoice could not be created.';
    }
  }

  async function refresh() {
    try {
      templates = await listTemplates();
    } catch {
      templates = [];
      status = 'Saved templates are unavailable in this browser context.';
    }
  }

  async function persist() {
    try {
      const record = await saveTemplate(templateName, current());
      templateName = '';
      status = `Saved template "${record.name}" to this browser only.`;
      await refresh();
    } catch (error) {
      status = error instanceof Error ? error.message : 'The template could not be saved.';
    }
  }

  async function recall(record: NamedTemplate) {
    const stored = await loadTemplate(record.id);
    const value = stored?.value as Partial<InvoiceData> | undefined;
    if (!value) {
      status = `Template "${record.name}" could not be read.`;
      return;
    }
    invoiceNumber = value.invoiceNumber ?? '';
    issueDate = value.issueDate ?? today();
    dueDate = value.dueDate ?? '';
    currency = value.currency ?? 'CAD';
    supplierName = value.supplier?.name ?? '';
    supplierAddress = value.supplier?.address ?? '';
    supplierTaxId = value.supplier?.taxId ?? '';
    customerName = value.customer?.name ?? '';
    customerAddress = value.customer?.address ?? '';
    customerTaxId = value.customer?.taxId ?? '';
    notes = value.notes ?? '';
    lines = value.lines?.length
      ? [...value.lines]
      : [{ description: '', quantity: 1, unitPrice: 0 }];
    status = `Loaded template "${record.name}".`;
  }

  async function forget(record: NamedTemplate) {
    await deleteTemplate(record.id);
    status = `Deleted template "${record.name}".`;
    await refresh();
  }

  // Set once the reactive form is live. A prerendered page ships static markup
  // that accepts input before hydration and then discards it, so anything
  // driving this form must wait for this flag rather than for the elements to
  // merely exist.
  let hydrated = $state(false);
  $effect(() => {
    hydrated = true;
    void refresh();
  });
</script>

<section
  class="builder"
  lang={attributes.lang}
  dir={attributes.dir}
  data-hydrated={hydrated ? 'true' : 'false'}
>
  <fieldset>
    <legend>{t('invoice.legend.invoice', 'Invoice')}</legend>
    <label>{t('invoice.field.number', 'Invoice number')} <input bind:value={invoiceNumber} /></label
    >
    <div class="pair">
      <label
        >{t('invoice.field.issueDate', 'Issue date')}
        <input type="date" bind:value={issueDate} /></label
      >
      <label
        >{t('invoice.field.dueDate', 'Due date')} <input type="date" bind:value={dueDate} /></label
      >
    </div>
    <label
      >{t('invoice.field.currency', 'Currency (3-letter ISO code)')}
      <input bind:value={currency} maxlength="3" autocomplete="off" />
    </label>
  </fieldset>

  <fieldset>
    <legend>{t('invoice.legend.from', 'From')}</legend>
    <label
      >{t('invoice.field.supplierName', 'Supplier name')} <input bind:value={supplierName} /></label
    >
    <label
      >{t('invoice.field.supplierAddress', 'Address')} <input bind:value={supplierAddress} /></label
    >
    <label
      >{t('invoice.field.supplierTaxId', 'Tax ID')}
      <input bind:value={supplierTaxId} autocomplete="off" /></label
    >
  </fieldset>

  <fieldset>
    <legend>{t('invoice.legend.billTo', 'Bill to')}</legend>
    <label
      >{t('invoice.field.customerName', 'Customer name')} <input bind:value={customerName} /></label
    >
    <label
      >{t('invoice.field.customerAddress', 'Address')} <input bind:value={customerAddress} /></label
    >
    <label
      >{t('invoice.field.customerTaxId', 'Tax ID')}
      <input bind:value={customerTaxId} autocomplete="off" /></label
    >
  </fieldset>

  <fieldset>
    <legend>{t('invoice.legend.lines', 'Line items')}</legend>
    {#each lines as line, index (index)}
      <div class="line">
        <label
          >Description
          <input
            value={line.description}
            oninput={(event) =>
              updateLine(index, { description: (event.currentTarget as HTMLInputElement).value })}
          />
        </label>
        <label
          >Qty
          <input
            type="number"
            min="0"
            step="any"
            value={line.quantity}
            oninput={(event) =>
              updateLine(index, {
                quantity: Number((event.currentTarget as HTMLInputElement).value),
              })}
          />
        </label>
        <label
          >Unit price
          <input
            type="number"
            min="0"
            step="any"
            value={line.unitPrice}
            oninput={(event) =>
              updateLine(index, {
                unitPrice: Number((event.currentTarget as HTMLInputElement).value),
              })}
          />
        </label>
        <label
          >Tax %
          <input
            type="number"
            min="0"
            max="100"
            step="any"
            value={line.taxRate ?? ''}
            oninput={(event) => {
              const raw = (event.currentTarget as HTMLInputElement).value;
              updateLine(index, { taxRate: raw === '' ? undefined : Number(raw) });
            }}
          />
        </label>
        <button
          type="button"
          class="remove"
          onclick={() => removeLine(index)}
          disabled={lines.length === 1}
        >
          {t('invoice.action.removeLine', 'Remove')}<span class="sr-only"> line {index + 1}</span>
        </button>
      </div>
    {/each}
    <button type="button" onclick={addLine}>{t('invoice.action.addLine', 'Add line')}</button>
  </fieldset>

  <fieldset>
    <legend>{t('invoice.legend.totals', 'Totals')}</legend>
    <dl class="totals">
      <div>
        <dt>{t('invoice.total.net', 'Net')}</dt>
        <dd>{money(totals.net)} {currency.toUpperCase()}</dd>
      </div>
      <div>
        <dt>{t('invoice.total.tax', 'Tax')}</dt>
        <dd>{money(totals.tax)} {currency.toUpperCase()}</dd>
      </div>
      <div class="gross">
        <dt>{t('invoice.total.gross', 'Total')}</dt>
        <dd>{money(totals.gross)} {currency.toUpperCase()}</dd>
      </div>
    </dl>
    <p class="note">
      Preview totals come from the same engine function the export uses, so they cannot disagree
      with the PDF.
    </p>
  </fieldset>

  <fieldset>
    <legend>{t('invoice.legend.notes', 'Notes')}</legend>
    <label>{t('invoice.field.notes', 'Notes on the invoice')} <input bind:value={notes} /></label>
  </fieldset>

  <fieldset>
    <legend>{t('invoice.legend.templates', 'Templates')}</legend>
    <p class="note">
      Templates are stored in this browser's IndexedDB only. They are never uploaded, and clearing
      site data removes them.
    </p>
    <p class="note">
      {t(
        'invoice.offline',
        'This tool works with no connection once you have visited it. Nothing is uploaded at any point, online or off.',
      )}
    </p>
    <div class="pair">
      <label
        >Template name
        <input bind:value={templateName} placeholder="e.g. Standard consulting" />
      </label>
      <button type="button" onclick={persist} disabled={!templateName.trim()}
        >{t('invoice.action.saveTemplate', 'Save template')}</button
      >
    </div>
    {#if templates.length}
      <ul class="templates">
        {#each templates as record (record.id)}
          <li>
            <span>{record.name}</span>
            <button type="button" onclick={() => recall(record)}
              >{t('invoice.action.loadTemplate', 'Load')}</button
            >
            <button type="button" onclick={() => forget(record)}
              >{t('invoice.action.deleteTemplate', 'Delete')}</button
            >
          </li>
        {/each}
      </ul>
    {:else}
      <p class="note">{t('invoice.template.none', 'No saved templates yet.')}</p>
    {/if}
  </fieldset>

  <button type="button" class="primary" onclick={create}>
    {variant === 'e-invoice'
      ? t('invoice.action.createWithXml', 'Create invoice with structured XML attachment')
      : t('invoice.action.create', 'Create invoice PDF')}
  </button>
  <p class="note">
    {variant === 'e-invoice'
      ? t(
          'invoice.audit.schema',
          'The PDF carries a UBL-style XML file attachment. Local structural validation runs on the result; published-schema validation is not yet available, so check the XML against the schema your recipient requires.',
        )
      : t(
          'invoice.audit.honest',
          'Review every amount before issuing a business document. This tool does not verify tax rates, registration numbers, or legal compliance.',
        )}
  </p>

  {#if preview}
    <details>
      <summary>Attached XML (local structural check)</summary>
      <pre>{preview}</pre>
    </details>
  {/if}

  <p class="status" role="status" aria-live="polite">{status}</p>
</section>

<style>
  .builder {
    margin-top: 32px;
  }
  fieldset {
    border: 1px solid var(--color-hairline);
    border-radius: 12px;
    margin: 0 0 24px;
    padding: 8px 20px 20px;
    /* The UA default for <fieldset> is `min-inline-size: min-content`, which
       floors the box at its widest unbreakable child. A text input carries a
       ~257px intrinsic width, so the fieldset refused to shrink below that and
       pushed the document wider than a 320px phone viewport. */
    min-inline-size: 0;
  }
  legend {
    font-weight: 600;
    padding: 0 8px;
  }
  label {
    display: grid;
    gap: 8px;
    margin: 16px 0;
    max-width: 520px;
    /* A translated or pseudo-localised label is longer than the English, and a
       label without a width floor lets its text wrap rather than widen the row. */
    min-width: 0;
  }
  input {
    border: 1px solid var(--color-hairline);
    border-radius: 8px;
    font: inherit;
    /* `content-box` (the UA default here, since the app sets no global reset)
       adds the 12px padding and 1px border ON TOP of `width: 100%`, so every
       input rendered 26px wider than the label grid track that holds it and
       set a floor under the whole page. `border-box` makes 100% mean the box. */
    box-sizing: border-box;
    /* A fixed width would overflow the grid track once the label is
       translated or pseudo-localised. */
    min-width: 0;
    padding: 12px;
    width: 100%;
  }
  .pair {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
  }
  .pair label {
    /* The 200px basis was a floor that a longer translated label could not fit
       under, forcing the row wider than the page. `minmax(0, …)` lets it shrink
       and wrap instead. */
    flex: 1 1 min(200px, 100%);
  }
  .line {
    align-items: end;
    border-top: 1px solid var(--color-hairline);
    display: grid;
    gap: 12px;
    /* minmax(0, …) lets each track shrink below its content, and the labels
       wrap, so a translated or pseudo-localised string cannot force the row
       wider than the page. Found by the en-XA overflow check. */
    grid-template-columns: minmax(0, 3fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) auto;
    padding-top: 8px;
  }
  .line label {
    margin: 8px 0;
  }
  .totals {
    display: grid;
    gap: 8px;
    margin: 16px 0;
    max-width: 360px;
  }
  .totals div {
    display: flex;
    justify-content: space-between;
  }
  .totals dd {
    font-variant-numeric: tabular-nums;
    margin: 0;
  }
  .totals .gross {
    border-top: 1px solid var(--color-hairline);
    font-weight: 600;
    padding-top: 8px;
  }
  .templates {
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
  }
  .templates li {
    align-items: center;
    border-top: 1px solid var(--color-hairline);
    display: flex;
    gap: 12px;
    justify-content: space-between;
    padding: 10px 0;
  }
  .templates span {
    overflow-wrap: anywhere;
  }
  button {
    background: var(--color-ink);
    border: 0;
    border-radius: 999px;
    color: white;
    cursor: pointer;
    padding: 12px 22px;
    /* `nowrap` kept a pseudo-localised or translated button label on one line,
       and the longest of them ("Create invoice with structured XML attachment")
       then set a min-content width wider than a phone viewport. */
    white-space: normal;
    overflow-wrap: anywhere;
  }
  button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
  .remove {
    background: transparent;
    border: 1px solid var(--color-hairline);
    color: inherit;
  }
  .primary {
    font-size: 1.0625rem;
  }
  .note,
  .status {
    color: var(--color-muted);
    line-height: 1.6;
    /* The pseudo-locale's padding is a run of `~` with no break opportunity, so a
       long string produces one unbreakable token wider than the column and the
       document scrolls sideways at a phone width. Found by the en-XA overflow
       check at 320px. */
    overflow-wrap: anywhere;
  }
  .status {
    margin-top: 20px;
  }
  pre {
    background: var(--color-hairline);
    border-radius: 8px;
    max-height: 320px;
    overflow: auto;
    padding: 12px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .sr-only {
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    height: 1px;
    overflow: hidden;
    position: absolute;
    white-space: nowrap;
    width: 1px;
  }
  @media (max-width: 767px) {
    .line {
      grid-template-columns: 1fr;
    }
  }
</style>

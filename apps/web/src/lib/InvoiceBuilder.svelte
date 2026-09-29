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
  import {
    deleteTemplate,
    listTemplates,
    loadTemplate,
    saveTemplate,
    type NamedTemplate,
  } from '$lib/indexed-store';

  let { variant = 'creator' }: { variant?: 'creator' | 'e-invoice' } = $props();

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

<section class="builder" data-hydrated={hydrated ? 'true' : 'false'}>
  <fieldset>
    <legend>Invoice</legend>
    <label>Invoice number <input bind:value={invoiceNumber} /></label>
    <div class="pair">
      <label>Issue date <input type="date" bind:value={issueDate} /></label>
      <label>Due date <input type="date" bind:value={dueDate} /></label>
    </div>
    <label
      >Currency (3-letter ISO code)
      <input bind:value={currency} maxlength="3" autocomplete="off" />
    </label>
  </fieldset>

  <fieldset>
    <legend>From</legend>
    <label>Supplier name <input bind:value={supplierName} /></label>
    <label>Address <input bind:value={supplierAddress} /></label>
    <label>Tax ID <input bind:value={supplierTaxId} autocomplete="off" /></label>
  </fieldset>

  <fieldset>
    <legend>Bill to</legend>
    <label>Customer name <input bind:value={customerName} /></label>
    <label>Address <input bind:value={customerAddress} /></label>
    <label>Tax ID <input bind:value={customerTaxId} autocomplete="off" /></label>
  </fieldset>

  <fieldset>
    <legend>Line items</legend>
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
          Remove<span class="sr-only"> line {index + 1}</span>
        </button>
      </div>
    {/each}
    <button type="button" onclick={addLine}>Add line</button>
  </fieldset>

  <fieldset>
    <legend>Totals</legend>
    <dl class="totals">
      <div>
        <dt>Net</dt>
        <dd>{money(totals.net)} {currency.toUpperCase()}</dd>
      </div>
      <div>
        <dt>Tax</dt>
        <dd>{money(totals.tax)} {currency.toUpperCase()}</dd>
      </div>
      <div class="gross">
        <dt>Total</dt>
        <dd>{money(totals.gross)} {currency.toUpperCase()}</dd>
      </div>
    </dl>
    <p class="note">
      Preview totals come from the same engine function the export uses, so they cannot disagree
      with the PDF.
    </p>
  </fieldset>

  <fieldset>
    <legend>Notes</legend>
    <label>Notes on the invoice <input bind:value={notes} /></label>
  </fieldset>

  <fieldset>
    <legend>Templates</legend>
    <p class="note">
      Templates are stored in this browser's IndexedDB only. They are never uploaded, and clearing
      site data removes them.
    </p>
    <div class="pair">
      <label
        >Template name
        <input bind:value={templateName} placeholder="e.g. Standard consulting" />
      </label>
      <button type="button" onclick={persist} disabled={!templateName.trim()}>Save template</button>
    </div>
    {#if templates.length}
      <ul class="templates">
        {#each templates as record (record.id)}
          <li>
            <span>{record.name}</span>
            <button type="button" onclick={() => recall(record)}>Load</button>
            <button type="button" onclick={() => forget(record)}>Delete</button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="note">No saved templates yet.</p>
    {/if}
  </fieldset>

  <button type="button" class="primary" onclick={create}>
    {variant === 'e-invoice'
      ? 'Create invoice with structured XML attachment'
      : 'Create invoice PDF'}
  </button>
  <p class="note">
    {variant === 'e-invoice'
      ? 'The PDF carries a UBL-style XML file attachment. Local structural validation runs on the result; published-schema validation is not yet available, so check the XML against the schema your recipient requires.'
      : 'Review every amount before issuing a business document. This tool does not verify tax rates, registration numbers, or legal compliance.'}
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
  }
  input {
    border: 1px solid var(--color-hairline);
    border-radius: 8px;
    font: inherit;
    padding: 12px;
  }
  .pair {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
  }
  .pair label {
    flex: 1 1 200px;
  }
  .line {
    align-items: end;
    border-top: 1px solid var(--color-hairline);
    display: grid;
    gap: 12px;
    grid-template-columns: 3fr 1fr 1fr 1fr auto;
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
    white-space: nowrap;
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

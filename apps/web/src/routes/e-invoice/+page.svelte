<script lang="ts">
  /* global HTMLInputElement */
  /**
   * T39. Three directions, all local: build a PDF with a UBL-style XML
   * attachment, render an existing XML file to PDF, and recover the attached
   * XML from a PDF that carries one. Reading invoice fields out of a rendered
   * page is deliberately not offered — see the note in the recovery section.
   */
  import FeaturePage from '$lib/FeaturePage.svelte';
  import InvoiceBuilder from '$lib/InvoiceBuilder.svelte';
  import { downloadBytes } from '$lib/download';
  import {
    convertToPdf,
    extractInvoiceXmlFromPdf,
    validateEInvoiceXml,
  } from '@pdf-complianttools/engine';

  let fileInput = $state<HTMLInputElement | undefined>();
  let status = $state('');

  function download(bytes: Uint8Array, name: string, mime = 'application/pdf') {
    downloadBytes(bytes, name, mime);
  }

  async function onPick(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const xml = new TextDecoder().decode(new Uint8Array(await file.arrayBuffer()));
      const check = validateEInvoiceXml(xml);
      if (!check.valid) {
        status = `${check.remedy ?? 'The file is not a usable e-invoice.'} Nothing was converted.`;
        return;
      }
      const result = await convertToPdf('xml-einvoice', new TextEncoder().encode(xml), {
        fileName: file.name,
      });
      download(result.bytes, file.name.replace(/\.xml$/iu, '') || 'e-invoice.pdf');
      status = `Converted ${file.name} to a PDF summary locally. Only the fields present in the XML are carried across — the PDF is a readable rendering, not a rebuilt invoice document.`;
    } catch (error) {
      status = error instanceof Error ? error.message : 'The XML could not be converted.';
    }
  }

  let recoverStatus = $state('');
  let recovered = $state<string | undefined>();

  async function onPickPdf(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    recovered = undefined;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const xml = await extractInvoiceXmlFromPdf(bytes);
      const base = file.name.replace(/\.pdf$/iu, '') || 'invoice';
      download(new TextEncoder().encode(xml), `${base}.xml`, 'application/xml');
      recovered = xml;
      recoverStatus = `Recovered the attached XML from ${file.name} exactly as it was embedded, and downloaded it as ${base}.xml. The file was read in this tab and never uploaded.`;
    } catch (error) {
      // The engine's remedy explains the refusal; show it rather than a
      // generic failure, because "no attachment" is a real and common answer.
      recoverStatus = error instanceof Error ? error.message : 'The PDF could not be read.';
    }
  }
</script>

<FeaturePage
  kind="e-invoice"
  title="Electronic invoice"
  description="Create a PDF invoice and a UBL-style structured invoice payload locally; validate before sending it through your own channel."
>
  <InvoiceBuilder variant="e-invoice" />

  <section class="reverse">
    <h2>Existing e-invoice XML to PDF</h2>
    <p class="note">
      Drop an e-invoice XML file to render its fields as a PDF. The file is read in this tab and
      never uploaded.
    </p>
    <input
      type="file"
      accept=".xml,application/xml,text/xml"
      bind:this={fileInput}
      onchange={onPick}
      aria-describedby="xml-help"
    />
    <p id="xml-help" class="note">
      The XML is checked against local structural rules first. A file that fails is reported with
      the specific reason and is not converted.
    </p>
    <p class="status" role="status" aria-live="polite">{status}</p>
  </section>

  <section class="reverse">
    <h2>Recover XML from a hybrid PDF</h2>
    <p class="note">
      Drop a PDF that carries an embedded e-invoice XML file to get that exact XML back. The file is
      read in this tab and never uploaded.
    </p>
    <input
      type="file"
      accept=".pdf,application/pdf"
      onchange={onPickPdf}
      aria-describedby="recover-help"
    />
    <p id="recover-help" class="note">
      This reads the structured attachment only. It will not guess invoice fields out of the
      rendered page, because a misread amount is a wrong invoice — a PDF with no embedded XML has no
      structured data to recover, and you will be told so rather than given a guess.
    </p>
    <p class="status" role="status" aria-live="polite">{recoverStatus}</p>
    {#if recovered}
      <details>
        <summary>Recovered XML</summary>
        <pre>{recovered}</pre>
      </details>
    {/if}
  </section>
</FeaturePage>

<style>
  .reverse {
    border-top: 1px solid var(--color-hairline);
    margin-top: 40px;
    padding-top: 24px;
  }
  h2 {
    font-size: 1.5rem;
    margin: 0 0 8px;
  }
  .note,
  .status {
    color: var(--color-muted);
    line-height: 1.6;
  }
  pre {
    background: var(--color-hairline);
    border-radius: 8px;
    max-height: 320px;
    overflow: auto;
    overflow-wrap: anywhere;
    padding: 12px;
    white-space: pre-wrap;
  }
</style>

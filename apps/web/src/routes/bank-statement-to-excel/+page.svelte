<script lang="ts">
  import Button from '@pdf-complianttools/ui/Button.svelte';
  import FileDrop from '@pdf-complianttools/ui/FileDrop.svelte';

  let file = $state<File | undefined>();
  let status = $state('');
  let downloadHref = $state<string | undefined>();

  async function extract() {
    if (!file) {
      status = 'Choose a statement PDF or text export first.';
      return;
    }
    try {
      const engine = await import('@pdf-complianttools/engine');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const text = file.name.toLowerCase().endsWith('.pdf')
        ? await engine.extractPdfText(bytes)
        : new TextDecoder().decode(bytes);
      const extraction = engine.extractBankStatement(text);
      const xlsx = await engine.bankStatementToXlsx(extraction);
      downloadHref = URL.createObjectURL(
        new Blob([xlsx.buffer as ArrayBuffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      );
      status = `${extraction.rows.length} rows found at ${(extraction.confidence * 100).toFixed(0)}% heuristic confidence. Verify financial values before use.`;
    } catch (error) {
      status = error instanceof Error ? error.message : 'Statement extraction failed.';
    }
  }
</script>

<svelte:head>
  <title>Bank statement to Excel locally</title>
  <meta
    name="description"
    content="Extract ruled or ruleless bank statement rows locally with visible heuristic confidence."
  />
</svelte:head>

<section class="tool-page">
  <p class="eyebrow">STRUCTURED EXTRACTION</p>
  <h1>Bank statement to Excel</h1>
  <p class="lede">
    Local heuristics identify dates, descriptions, amounts, and balances. The confidence score is a
    measured aid, never a universal accuracy claim.
  </p>
  <FileDrop
    accept=".pdf,.txt,.csv,application/pdf,text/plain,text/csv"
    onchange={(list) => {
      file = list?.[0];
    }}
  />
  <Button onclick={extract}>Extract to XLSX</Button>
  <p class="status" role="status">{status}</p>
  {#if downloadHref}<a class="download" href={downloadHref} download="bank-statement.xlsx"
      >Download XLSX</a
    >{/if}
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
  .lede,
  .status {
    color: var(--color-muted);
    max-width: 720px;
  }
  .download {
    color: inherit;
    display: block;
    font-weight: 600;
    margin-top: 18px;
  }
  @media (max-width: 767px) {
    .tool-page {
      padding-inline: 24px;
      padding-top: 72px;
    }
  }
</style>

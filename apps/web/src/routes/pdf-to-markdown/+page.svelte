<script lang="ts">
  import Button from '@pdf-complianttools/ui/Button.svelte';
  import FileDrop from '@pdf-complianttools/ui/FileDrop.svelte';
  import AiEscalationList from '$lib/AiEscalationList.svelte';

  let file = $state<File | undefined>();
  let markdown = $state('');
  let status = $state('');
  let allowAi = $state(false);

  async function extract() {
    if (!file) {
      status = 'Choose a PDF first.';
      return;
    }
    try {
      const engine = await import('@pdf-complianttools/engine');
      markdown = await engine.pdfToMarkdown(new Uint8Array(await file.arrayBuffer()));
      status = 'Local extraction complete. Structure is inferred and should be reviewed.';
      if (allowAi) engine.requestPdfMarkdownEscalation({ allowAiEscalation: true });
    } catch (error) {
      status = error instanceof Error ? error.message : 'PDF-to-Markdown failed.';
    }
  }
</script>

<svelte:head>
  <title>PDF to Markdown locally</title>
  <meta
    name="description"
    content="Extract PDF text to reviewable Markdown locally, with optional explicit BYOK escalation."
  />
</svelte:head>

<section class="tool-page">
  <p class="eyebrow">EXTRACT</p>
  <h1>PDF to Markdown</h1>
  <p class="lede">
    A deterministic local path runs first. Any Tier 3 restructuring remains optional, explicit, and
    BYOK-gated.
  </p>
  <FileDrop
    accept=".pdf,application/pdf"
    onchange={(list) => {
      file = list?.[0];
    }}
  />
  <label
    ><input type="checkbox" bind:checked={allowAi} /> I explicitly want to enable the registered BYOK
    escalation after reviewing local output.</label
  >
  <Button onclick={extract}>Extract locally</Button>
  <p class="status" role="status">{status}</p>
  {#if markdown}<textarea
      class="output"
      bind:value={markdown}
      aria-label="Extracted Markdown"
      rows="18"></textarea>{/if}
  <AiEscalationList />
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
  label {
    display: block;
    margin: 24px 0;
  }
  .output {
    border: 1px solid var(--color-hairline);
    border-radius: 10px;
    font:
      0.95rem/1.5 ui-monospace,
      monospace;
    margin-top: 24px;
    padding: 16px;
    width: 100%;
  }
  @media (max-width: 767px) {
    .tool-page {
      padding-inline: 24px;
      padding-top: 72px;
    }
  }
</style>

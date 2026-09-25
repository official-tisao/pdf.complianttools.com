<script lang="ts">
  import Button from '@pdf-complianttools/ui/Button.svelte';
  import {
    createAiCallPlan,
    textPagesToPdf,
    type AiCallPlan,
    type AiOperationRequest,
  } from '@pdf-complianttools/engine';
  import AiCallConfirm from '$lib/AiCallConfirm.svelte';
  import { getConfiguredConnection, sendConfirmed } from '$lib/ai-client';

  let prompt = $state('');
  let plan = $state<AiCallPlan | undefined>();
  let request = $state<AiOperationRequest | undefined>();
  let generatedText = $state('');
  let status = $state('');
  let busy = $state(false);

  async function prepare() {
    if (!prompt.trim()) {
      status = 'Describe the document you want to create.';
      return;
    }
    try {
      const configured = await getConfiguredConnection();
      if (!configured) {
        status =
          'No provider is configured. Use a deterministic builder for structured documents, or connect your AI first.';
        return;
      }
      request = { capability: 'generate', prompt: prompt.trim() };
      plan = createAiCallPlan(configured.connection.id, request, {
        ...(configured.connection.inputPricePerMillionUsd === undefined
          ? {}
          : { inputPricePerMillionUsd: configured.connection.inputPricePerMillionUsd }),
        ...(configured.connection.outputPricePerMillionUsd === undefined
          ? {}
          : { outputPricePerMillionUsd: configured.connection.outputPricePerMillionUsd }),
      });
      status = 'Review the estimate below. Nothing has been sent.';
    } catch (error) {
      status = error instanceof Error ? error.message : 'Could not prepare the request.';
    }
  }

  async function generate() {
    if (!plan || !request) return;
    busy = true;
    try {
      const configured = await getConfiguredConnection();
      if (!configured || configured.connection.id !== plan.providerId) {
        status = 'The provider connection changed. Prepare a fresh estimate.';
        return;
      }
      const response = await sendConfirmed(configured.connection, configured.secret, request, plan);
      generatedText = response.text;
      plan = undefined;
      status =
        'Generated content received. It is shown for review and can be assembled through the local PDF writer.';
    } catch (error) {
      status = error instanceof Error ? error.message : 'Generation failed.';
    } finally {
      busy = false;
    }
  }

  async function downloadPdf() {
    if (!generatedText) return;
    const bytes = await textPagesToPdf([[generatedText]], { pageSize: 'letter' });
    const url = URL.createObjectURL(
      new Blob([Uint8Array.from(bytes).buffer], { type: 'application/pdf' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'generated-document.pdf';
    link.click();
    URL.revokeObjectURL(url);
    status = 'PDF assembled locally from the reviewed provider text.';
  }
</script>

<svelte:head
  ><title>Generate PDF from a prompt</title><meta
    name="description"
    content="Generate text with an explicit BYOK request, then assemble a PDF locally for review."
  /></svelte:head
>

<section class="page">
  <p class="eyebrow">BYOK AI · LOCAL PDF WRITE</p>
  <h1>Generate PDF from a prompt</h1>
  <p class="lede">
    Prompt authoring is not deterministic. A provider request is optional, explicitly confirmed, and
    never runs without a configured endpoint and key. The returned text is assembled with the local
    PDF writer, not an HTML dump.
  </p>
  <label
    >Prompt<textarea
      bind:value={prompt}
      rows="8"
      placeholder="Create a one-page project brief with an executive summary, risks, and next steps."
    ></textarea></label
  >
  <div class="actions">
    <Button disabled={busy} onclick={() => void prepare()}>Prepare explicit AI request</Button><a
      href="/connect-ai">Connect your AI</a
    >
  </div>
  <p class="status" role="status">{status}</p>
  {#if plan}<AiCallConfirm {plan} onconfirm={() => void generate()} />{/if}
  {#if generatedText}<section class="result" aria-labelledby="generated-heading">
      <h2 id="generated-heading">Review generated text</h2>
      <textarea bind:value={generatedText} rows="16"></textarea><Button
        disabled={busy}
        onclick={() => void downloadPdf()}>Assemble reviewed text as PDF</Button
      >
    </section>{/if}
</section>

<style>
  .page {
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
    max-width: 800px;
  }
  label {
    display: grid;
    gap: 8px;
    margin-top: 28px;
  }
  textarea {
    border: 1px solid var(--color-hairline);
    border-radius: 8px;
    font: inherit;
    padding: 12px;
    resize: vertical;
  }
  .actions {
    align-items: center;
    display: flex;
    gap: 12px;
    margin: 24px 0;
  }
  .actions a {
    color: inherit;
  }
  .result {
    background: var(--color-white);
    border-radius: var(--radius-panel);
    display: grid;
    gap: 16px;
    margin-top: 24px;
    padding: 24px;
  }
  @media (max-width: 767px) {
    .page {
      padding-inline: 24px;
    }
  }
</style>

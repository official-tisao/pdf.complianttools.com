<script lang="ts">
  import Button from '@pdf-complianttools/ui/Button.svelte';
  import {
    AI_ESCALATIONS,
    createDocumentContext,
    type AiCallPlan,
    type AiOperationRequest,
    type EscalationId,
  } from '@pdf-complianttools/engine';
  import AiCallConfirm from '$lib/AiCallConfirm.svelte';
  import { getConfiguredConnection, makePlan, sendConfirmed } from '$lib/ai-client';

  let {
    tool,
    localReady,
    localText,
  }: {
    tool: EscalationId;
    localReady: boolean;
    localText: string;
  } = $props();

  let plan = $state<AiCallPlan | undefined>();
  let request = $state<AiOperationRequest | undefined>();
  let providerResult = $state('');
  let status = $state(
    'Run the local tool first. The optional AI escalation is disabled until then.',
  );
  let busy = $state(false);

  const escalation = $derived(AI_ESCALATIONS[tool]);

  $effect(() => {
    if (!localReady) {
      plan = undefined;
      request = undefined;
      providerResult = '';
      status = 'Run the local tool first. The optional AI escalation is disabled until then.';
    }
  });

  async function prepare() {
    if (!localReady || !localText.trim()) {
      status = 'Run the local tool first. No AI request was prepared.';
      return;
    }
    busy = true;
    providerResult = '';
    try {
      const configured = await getConfiguredConnection();
      if (!configured) {
        status =
          'No provider is configured. The local result remains available and no AI request was made.';
        return;
      }
      const context = createDocumentContext([
        { pageNumber: 1, lines: [localText.slice(0, 120_000)] },
      ]);
      const nextRequest: AiOperationRequest = {
        capability: escalation.capability,
        prompt: `${escalation.label}. Review the local result below and return a concise, reviewable suggestion. Do not claim that the local PDF was changed.`,
        context,
      };
      request = nextRequest;
      plan = makePlan(configured.connection, nextRequest);
      status = 'Review the estimate below. Nothing has been sent.';
    } catch (error) {
      status =
        error instanceof Error ? error.message : 'Could not prepare the optional AI request.';
    } finally {
      busy = false;
    }
  }

  async function send() {
    if (!plan || !request) return;
    busy = true;
    try {
      const configured = await getConfiguredConnection();
      if (!configured || configured.connection.id !== plan.providerId) {
        status = 'The provider connection changed. Prepare a fresh estimate.';
        return;
      }
      const response = await sendConfirmed(configured.connection, configured.secret, request, plan);
      providerResult = response.text;
      status = 'Optional provider result received. Review it before using it.';
      plan = undefined;
      request = undefined;
    } catch (error) {
      status = error instanceof Error ? error.message : 'The optional AI request failed.';
    } finally {
      busy = false;
    }
  }
</script>

<section class="escalation" aria-labelledby={`${tool}-escalation-heading`}>
  <p class="eyebrow">OPTIONAL TIER 3 · {tool}</p>
  <h2 id={`${tool}-escalation-heading`}>{escalation.label}</h2>
  <p>{escalation.reason}</p>
  <p><strong>Local first:</strong> {escalation.localFallback}</p>
  <Button variant="secondary" disabled={busy || !localReady} onclick={() => void prepare()}>
    {busy ? 'Preparing…' : `Prepare ${tool} request`}
  </Button>
  <p class="status" role="status" aria-live="polite">{status}</p>
  {#if plan}<AiCallConfirm {plan} onconfirm={() => void send()} />{/if}
  {#if providerResult}<section class="result" aria-labelledby={`${tool}-result-heading`}>
      <h3 id={`${tool}-result-heading`}>Optional provider result — review before use</h3>
      <pre>{providerResult}</pre>
    </section>{/if}
</section>

<style>
  .escalation {
    background: var(--color-white);
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-panel);
    margin-top: 24px;
    padding: 24px;
  }
  .eyebrow {
    color: var(--color-muted);
    font-size: 0.8rem;
    letter-spacing: 0.1em;
  }
  h2 {
    margin: 8px 0;
  }
  p {
    color: var(--color-muted);
    max-width: 760px;
  }
  .status {
    min-height: 24px;
  }
  .result {
    background: var(--color-platinum);
    margin-top: 20px;
    padding: 16px;
  }
  pre {
    font: 0.95rem/1.5 var(--font-sans);
    white-space: pre-wrap;
  }
</style>

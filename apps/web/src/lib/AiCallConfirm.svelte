<script lang="ts">
  import Button from '@pdf-complianttools/ui/Button.svelte';
  import type { AiCallPlan } from '@pdf-complianttools/engine';

  let {
    plan,
    onconfirm,
  }: {
    plan: AiCallPlan;
    onconfirm: () => void;
  } = $props();

  let acknowledged = $state(false);
</script>

<section class="confirm" aria-labelledby="ai-cost-heading">
  <h2 id="ai-cost-heading">Review before sending</h2>
  <p>
    This request sends the shown document text to <strong>{plan.providerId}</strong> using your configured
    endpoint.
  </p>
  <dl>
    <div>
      <dt>Input</dt>
      <dd>
        {plan.estimate.inputCharacters.toLocaleString()} characters · about {plan.estimate.inputTokens.toLocaleString()}
        tokens
      </dd>
    </div>
    <div>
      <dt>Output budget</dt>
      <dd>about {plan.estimate.outputTokens.toLocaleString()} tokens</dd>
    </div>
    <div>
      <dt>Estimated cost</dt>
      <dd>
        {plan.estimate.estimatedUsd === undefined
          ? 'Provider pricing not configured'
          : `$${plan.estimate.estimatedUsd.toFixed(4)} USD`}
      </dd>
    </div>
  </dl>
  <label>
    <input type="checkbox" bind:checked={acknowledged} />
    I understand this is an external request and confirm the estimate.
  </label>
  <Button disabled={!acknowledged} onclick={onconfirm}>Confirm and send</Button>
</section>

<style>
  .confirm {
    background: var(--color-white);
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-panel);
    margin-top: 24px;
    padding: 24px;
  }
  h2 {
    font-size: 1.25rem;
    margin-top: 0;
  }
  p {
    color: var(--color-muted);
  }
  dl {
    display: grid;
    gap: 8px;
  }
  dl div {
    display: flex;
    gap: 16px;
    justify-content: space-between;
  }
  dt {
    color: var(--color-muted);
  }
  dd {
    margin: 0;
    text-align: right;
  }
  label {
    display: flex;
    gap: 8px;
    margin: 20px 0;
  }
</style>

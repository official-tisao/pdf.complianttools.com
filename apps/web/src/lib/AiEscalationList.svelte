<script lang="ts">
  import Button from '@pdf-complianttools/ui/Button.svelte';
  import { AI_ESCALATIONS, type EscalationId } from '@pdf-complianttools/engine';

  let { onprepare }: { onprepare?: (tool: EscalationId) => void } = $props();
</script>

<section class="list" aria-labelledby="escalations-heading">
  <h2 id="escalations-heading">Optional AI escalations</h2>
  <p>
    Each local result comes first. These controls are never selected by default and only prepare a
    costed request.
  </p>
  <div class="cards">
    {#each Object.values(AI_ESCALATIONS) as escalation (escalation.tool)}
      <article>
        <p class="tool">{escalation.tool} · Tier 3</p>
        <h3>{escalation.label}</h3>
        <p>{escalation.reason}</p>
        <p><strong>Local first:</strong> {escalation.localFallback}</p>
        {#if onprepare}<Button variant="secondary" onclick={() => onprepare?.(escalation.tool)}
            >Prepare {escalation.tool} request</Button
          >{/if}
      </article>
    {/each}
  </div>
</section>

<style>
  .list {
    margin-top: 40px;
  }
  .list > p {
    color: var(--color-muted);
  }
  .cards {
    display: grid;
    gap: 16px;
    grid-template-columns: repeat(2, 1fr);
  }
  article {
    background: var(--color-white);
    border-radius: var(--radius-panel);
    padding: 20px;
  }
  article p {
    color: var(--color-muted);
  }
  .tool {
    font-size: 0.875rem;
    letter-spacing: 0.08em;
  }
  @media (max-width: 767px) {
    .cards {
      grid-template-columns: 1fr;
    }
  }
</style>

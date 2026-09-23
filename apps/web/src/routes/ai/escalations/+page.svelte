<script lang="ts">
  import AiEscalationList from '$lib/AiEscalationList.svelte';
</script>

<svelte:head><title>Document AI escalations</title></svelte:head>
<section class="page">
  <p class="eyebrow">LOCAL FIRST · TIER 3 OPTIONAL</p>
  <h1>Document AI escalations</h1>
  <p class="lede">
    The host tools for T29, T44, T52, T59, and T61 run their deterministic path first. This page
    keeps their registered AI remedies visible while the corresponding editing/viewer surfaces
    remain independently owned by their workstreams.
  </p>
  <AiEscalationList />
  <a href="/connect-ai">Connect your AI</a>
</section>

<style>
  .page {
    margin: auto;
    max-width: 1120px;
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
  .lede {
    color: var(--color-muted);
    max-width: 800px;
  }
  a {
    color: inherit;
    display: inline-block;
    margin-top: 24px;
  }
  @media (max-width: 767px) {
    .page {
      padding-inline: 24px;
    }
  }
</style>

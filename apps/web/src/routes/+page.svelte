<script lang="ts">
  import Button from '@pdf-complianttools/ui/Button.svelte';
  import FileDrop from '@pdf-complianttools/ui/FileDrop.svelte';

  let files = $state<File[]>([]);

  function acceptFiles(fileList: FileList | null) {
    files = fileList ? Array.from(fileList) : [];
  }
</script>

<svelte:head>
  <title>Local-first PDF tools</title>
  <meta name="description" content="Merge, organize, and transform PDFs locally in your browser." />
</svelte:head>

<section class="hero">
  <p class="eyebrow">LOCAL-FIRST DOCUMENT TOOLS</p>
  <h1>Every PDF tool. In your browser.</h1>
  <p class="lede">Merge, organize, convert, sign, and inspect documents without uploading them.</p>
  <div class="actions">
    <Button><a href="/merge">Start with Merge PDF</a></Button>
    <Button variant="secondary"><a href="/#tools">Browse tools</a></Button>
  </div>
  <FileDrop onchange={acceptFiles} />
  {#if files.length > 0}
    <p class="status" role="status">
      {files.length} file{files.length === 1 ? '' : 's'} selected locally.
    </p>
  {/if}
</section>

<section id="tools" class="tool-grid" aria-labelledby="tools-heading">
  <h2 id="tools-heading">A calm, capable PDF workspace</h2>
  <div class="cards">
    <article>
      <h3>Local by default</h3>
      <p>Your files stay in the browser for deterministic tools.</p>
    </article>
    <article>
      <h3>Honest capability</h3>
      <p>Unsupported inputs explain what happened and what to try next.</p>
    </article>
    <article>
      <h3>Composable workflows</h3>
      <p>Recipes, previews, and batch work share one engine contract.</p>
    </article>
  </div>
</section>

<style>
  .hero,
  .tool-grid {
    margin: auto;
    max-width: 1280px;
    padding: 120px 40px 0;
  }

  .hero {
    text-align: center;
  }

  .eyebrow {
    color: var(--color-muted);
    font-size: 0.875rem;
    letter-spacing: 0.12em;
  }

  h1 {
    font-size: clamp(2.5rem, 6vw, 3.5rem);
    letter-spacing: -0.05em;
    line-height: 1.1;
    margin: 16px auto;
    max-width: 800px;
  }

  .lede {
    color: var(--color-muted);
    font-size: 1.25rem;
    margin: auto;
    max-width: 640px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    justify-content: center;
    margin: 32px 0;
  }

  :global(.actions a) {
    color: inherit;
    text-decoration: none;
  }

  .status {
    color: var(--color-muted);
  }

  .tool-grid {
    padding-top: 100px;
  }

  h2 {
    font-size: 2rem;
    letter-spacing: -0.04em;
  }

  .cards {
    display: grid;
    gap: 16px;
    grid-template-columns: repeat(3, 1fr);
  }

  article {
    background: var(--color-white);
    border-radius: var(--radius-panel);
    padding: 24px;
  }

  article p {
    color: var(--color-muted);
  }

  @media (max-width: 767px) {
    .hero,
    .tool-grid {
      padding-inline: 24px;
      padding-top: 80px;
    }

    .cards {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 479px) {
    .hero,
    .tool-grid {
      padding-inline: 16px;
    }
  }
</style>

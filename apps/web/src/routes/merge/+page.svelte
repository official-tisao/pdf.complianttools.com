<script lang="ts">
  import Button from '@pdf-complianttools/ui/Button.svelte';
  import FileDrop from '@pdf-complianttools/ui/FileDrop.svelte';
  import PageThumb from '@pdf-complianttools/ui/PageThumb.svelte';

  let files = $state<File[]>([]);

  function selectFiles(fileList: FileList | null) {
    files = fileList ? Array.from(fileList) : [];
  }
</script>

<svelte:head>
  <title>Merge PDF locally</title>
  <meta name="description" content="Combine PDF files locally in your browser." />
</svelte:head>

<section class="tool-page">
  <p class="eyebrow">ORGANIZE</p>
  <h1>Merge PDF</h1>
  <p class="lede">
    Combine files, preview the page order, and export one PDF without uploading your documents.
  </p>
  <FileDrop accept=".pdf,application/pdf" onchange={selectFiles} />
  <div class="toolbar">
    <span>{files.length} file{files.length === 1 ? '' : 's'} ready</span>
    <Button disabled={files.length === 0}>Merge files</Button>
  </div>
  <div class="thumbs" aria-label="Page preview">
    {#each [1, 2, 3] as pageNumber (pageNumber)}
      <PageThumb {pageNumber} />
    {/each}
  </div>
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

  .lede {
    color: var(--color-muted);
    font-size: 1.125rem;
    max-width: 640px;
  }

  .toolbar {
    align-items: center;
    display: flex;
    justify-content: space-between;
    margin: 24px 0;
  }

  .toolbar span {
    color: var(--color-muted);
  }

  .thumbs {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(3, minmax(72px, 1fr));
    max-width: 360px;
  }

  @media (max-width: 767px) {
    .tool-page {
      padding-inline: 24px;
      padding-top: 72px;
    }
  }
</style>

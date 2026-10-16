<script lang="ts">
  import ConversionTool from '$lib/ConversionTool.svelte';
</script>

<main class="pdf-to-txt-page">
  <ConversionTool
    title="PDF to Plain text"
    description="Turn PDF pages into Plain text locally, in your browser. Nothing is uploaded."
    format="txt"
    direction="from-pdf"
    accept=".txt,text/plain"
  />
</main>

<style>
  .pdf-to-txt-page {
    max-width: 100%;
    padding: 0 24px;
  }

  @media (max-width: 767px) {
    .pdf-to-txt-page {
      padding: 0 16px;
    }
  }
</style>

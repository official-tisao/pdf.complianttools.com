<script lang="ts">
  import ConversionTool from '$lib/ConversionTool.svelte';
</script>

<main class="pdf-to-zip-page">
  <ConversionTool
    title="PDF to ZIP of pages or images"
    description="Turn PDF pages into ZIP of pages or images locally, in your browser. Nothing is uploaded."
    format="zip"
    direction="from-pdf"
    accept=".zip,application/zip"
  />
</main>

<style>
  .pdf-to-zip-page {
    max-width: 100%;
    padding: 0 24px;
  }

  @media (max-width: 767px) {
    .pdf-to-zip-page {
      padding: 0 16px;
    }
  }
</style>

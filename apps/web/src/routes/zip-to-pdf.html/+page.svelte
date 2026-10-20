<script lang="ts">
  import ConversionTool from '$lib/ConversionTool.svelte';
</script>

<main class="zip-to-pdf-page">
  <ConversionTool
    title="ZIP of pages or images to PDF"
    description="Convert ZIP of pages or images files to PDF locally, in your browser. Nothing is uploaded."
    format="zip"
    direction="to-pdf"
    accept=".zip,application/zip"
  />
</main>

<style>
  .zip-to-pdf-page {
    max-width: 100%;
    padding: 0 24px;
  }

  @media (max-width: 767px) {
    .zip-to-pdf-page {
      padding: 0 16px;
    }
  }
</style>

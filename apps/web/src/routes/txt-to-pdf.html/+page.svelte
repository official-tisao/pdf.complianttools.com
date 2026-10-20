<script lang="ts">
  import ConversionTool from '$lib/ConversionTool.svelte';
</script>

<main class="txt-to-pdf-page">
  <ConversionTool
    title="Plain text to PDF"
    description="Convert Plain text files to PDF locally, in your browser. Nothing is uploaded."
    format="txt"
    direction="to-pdf"
    accept=".txt,text/plain"
  />
</main>

<style>
  .txt-to-pdf-page {
    max-width: 100%;
    padding: 0 24px;
  }

  @media (max-width: 767px) {
    .txt-to-pdf-page {
      padding: 0 16px;
    }
  }
</style>

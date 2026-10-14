<script lang="ts">
  import ConversionTool from '$lib/ConversionTool.svelte';
</script>

<main class="image-to-pdf-page" >
  <ConversionTool
    title="Image to PDF"
    description="Combine supported images into PDF pages locally. PNG alpha is composited over a chosen background."
    format="png"
    accept="image/jpeg,image/png,image/bmp,image/gif,image/tiff,image/webp,image/svg+xml,.jpg,.jpeg,.png,.bmp,.gif,.tif,.tiff,.webp,.svg"
  />
</main>

<style>
  .image-to-pdf-page {
    max-width: 100%;
    padding: 0 24px;
  }

  @media (max-width: 767px) {
    .image-to-pdf-page {
      padding: 0 16px;
    }
  }
</style>

<script lang="ts">
  import ConversionTool from '$lib/ConversionTool.svelte';
</script>

<ConversionTool
  title="Image to PDF"
  description="Combine supported images into PDF pages locally. PNG alpha is composited over a chosen background."
  format="png"
  accept="image/jpeg,image/png,image/bmp,image/gif,image/tiff,image/webp,image/svg+xml,.jpg,.jpeg,.png,.bmp,.gif,.tif,.tiff,.webp,.svg"
/>

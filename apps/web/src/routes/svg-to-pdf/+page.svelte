<script lang="ts">
  import ConversionTool from '$lib/ConversionTool.svelte';
</script>

<ConversionTool
  title="SVG image to PDF"
  description="Convert SVG image files to PDF locally, in your browser. Nothing is uploaded."
  format="svg"
  direction="to-pdf"
  accept=".svg,image/svg+xml"
/>

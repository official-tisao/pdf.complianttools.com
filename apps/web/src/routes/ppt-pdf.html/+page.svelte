<script lang="ts">
  import ConversionTool from '$lib/ConversionTool.svelte';
</script>

<ConversionTool
  title="PowerPoint to PDF"
  description="Convert PPTX slides to a PDF locally while preserving slide order and extracted text."
  format="pptx"
  accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
/>

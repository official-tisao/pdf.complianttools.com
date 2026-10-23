<script lang="ts">
  import ConversionTool from '$lib/ConversionTool.svelte';
</script>

<ConversionTool
  title="PowerPoint to PDF"
  description="Convert PPTX slides to a PDF locally, keeping the slide size, shapes, colours, and text positions, and following the deck's master, layout, and theme. One slide becomes one page, laid out to match the original."
  format="pptx"
  accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
/>

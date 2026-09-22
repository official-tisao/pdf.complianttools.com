<script lang="ts">
  import ConversionTool from '$lib/ConversionTool.svelte';
</script>

<ConversionTool
  title="EPUB to PDF"
  description="Turn a reflowable EPUB into a readable PDF in spine order, locally."
  format="epub"
  accept=".epub,application/epub+zip"
/>

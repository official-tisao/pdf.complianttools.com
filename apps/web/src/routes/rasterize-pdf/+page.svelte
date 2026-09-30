<script lang="ts">
  import ToolWorkspace from '$lib/ToolWorkspace.svelte';
</script>

<svelte:head><title>Rasterize PDF — renderer not yet available</title></svelte:head>
<ToolWorkspace
  title="Rasterize PDF"
  eyebrow="EXPORT"
  description="Turn PDF pages into PNG images at a chosen DPI."
  unavailableReason="This tool is not offered yet. Rasterizing needs a local renderer, and the pdfium WASM build this project cleared for licence reasons is not bundled with the site yet. Rather than offer a button that would fail after you have chosen a file, the page says so here. Converting a PDF to images is still available."
/>

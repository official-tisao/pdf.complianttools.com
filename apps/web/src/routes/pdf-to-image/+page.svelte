<script lang="ts">
  import ConversionTool from '$lib/ConversionTool.svelte';
</script>

<ConversionTool
  title="PDF to image"
  description="Render PDF pages as page images. Rendered pages are distinct from the original embedded-image extraction tool."
  format="pdf-image"
  accept="application/pdf,.pdf"
  direction="from-pdf"
  available={false}
  unavailableReason="This route needs the approved pdfium renderer to be initialized for the current browser worker."
  note="The engine exposes renderPdfPageToPng once a renderer is injected; no server-side rasterizer is used."
/>

<script lang="ts">
  import { onMount } from 'svelte';
  import { getPdfiumRenderer, type PdfiumRenderer } from '@pdf-complianttools/engine/pdfium';
  import ConversionTool from '$lib/ConversionTool.svelte';

  let renderer = $state<PdfiumRenderer | null>(null);
  let rendererError = $state<string | null>(null);
  let rendererReady = $state(false);

  onMount(async () => {
    try {
      renderer = await getPdfiumRenderer();
      rendererReady = true;
    } catch (error) {
      rendererError = error instanceof Error ? error.message : 'Failed to initialize PDF renderer';
      console.error('Failed to initialize pdfium renderer:', error);
    }
  });
</script>

<!--
  PDF to CBZ conversion — requires pdfium renderer for page rasterization.
  The renderer is initialized using the shared getPdfiumRenderer() which handles
  WASM fetching, caching, and error handling.
-->
<ConversionTool
  title="PDF to Comic book archive"
  description="Turn PDF pages into Comic book archive locally, in your browser. Nothing is uploaded."
  format="cbz"
  direction="from-pdf"
  accept=".pdf,application/pdf"
  available={rendererReady}
  unavailableReason={rendererError ?? 'Initializing PDF renderer…'}
  {renderer}
/>

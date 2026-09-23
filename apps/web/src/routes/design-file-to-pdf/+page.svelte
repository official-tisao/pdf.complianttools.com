<script lang="ts">
  import ConversionTool from '$lib/ConversionTool.svelte';
</script>

<ConversionTool
  title="Design file to PDF"
  description="Extract a flattened composite from supported design files where a clean browser decoder exists; layer-aware re-export is never claimed."
  format="psd"
  accept=".psd,.ai,.indd,image/vnd.adobe.photoshop,application/postscript"
  available={false}
  unavailableReason="PSD, AI, and INDD need format-specific composite decoders; this clean build does not silently substitute a rasterized or re-laid-out result."
  note="Export a flattened PNG, SVG, or PDF from the design application and use the local image or PDF route."
/>

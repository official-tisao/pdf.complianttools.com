<script lang="ts">
  import ConversionTool from '$lib/ConversionTool.svelte';
</script>

<!--
  T33 / README §5.5: PSD and PDF-backed AI converted to PDF (flattened composite only);
  INDD remains unavailable — proprietary container with no permissive browser reader.
  Direction must be to-pdf; format is psd (primary) with AI handled via same accept.
-->
<ConversionTool
  title="Design file to PDF"
  description="Convert supported design files to PDF locally. Only the flattened composite is exported (PSD, PDF-backed AI); layer-aware re-export is never claimed. INDD requires a proprietary export-and-import workflow."
  direction="to-pdf"
  format="psd"
  accept=".psd,.ai,application/postscript,application/pdf,image/vnd.adobe.photoshop"
  available={true}
  unavailableReason="INDD is a proprietary InDesign container with no permissive browser reader; export to PDF or IDML from InDesign and retry."
  note="PSD and PDF-backed AI files are converted to PDF using the local flattened-composite decoder. Only 8-bit RGB/CMYK flattened composites are supported; layered edits are not preserved. For INDD, export to PDF locally and use the PDF route."
/>

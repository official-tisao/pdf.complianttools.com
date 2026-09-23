<script lang="ts">
  import ConversionTool from '$lib/ConversionTool.svelte';
</script>

<ConversionTool
  title="Legacy and niche formats to PDF"
  eyebrow="CONVERT"
  description="Publisher and HWP are listed honestly, with a specific local remedy when no clean browser reader is available."
  format="publisher"
  accept=".pub,.hwp"
  available={false}
  unavailableReason="Publisher and HWP are proprietary binary containers without a permissively licensed browser reader in this build."
  note="Export the file as DOCX, ODT, PDF, or a page image from its source application, then use the corresponding local route."
/>

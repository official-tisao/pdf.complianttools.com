<script lang="ts">
  import ConversionTool from '$lib/ConversionTool.svelte';
</script>

<ConversionTool
  title="CSV to PDF"
  description="Render comma-separated data as a bounded, readable table without uploading it."
  format="csv"
  accept=".csv,text/csv"
/>

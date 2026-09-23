<script lang="ts">
  import ConversionTool from '$lib/ConversionTool.svelte';
</script>

<ConversionTool
  title="Excel to PDF"
  description="Render XLSX sheets to a PDF locally with sheet order and cell values intact."
  format="xlsx"
  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
/>

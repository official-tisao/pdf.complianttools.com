<script lang="ts">
  import PhaseCTool from '$lib/PhaseCTool.svelte';
</script>

<PhaseCTool
  title="Redact PDF"
  operation="redact"
  description="Remove matching page content, strip metadata and structure, then withhold export unless the local verification pass succeeds."
/>

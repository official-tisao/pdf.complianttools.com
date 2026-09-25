<script lang="ts">
  import PhaseCTool from '$lib/PhaseCTool.svelte';
</script>

<PhaseCTool
  title="PDF Overlay"
  operation="overlay"
  accept=".pdf,application/pdf"
  description="Stamp one local PDF over another without a server-side merge."
/>

<script lang="ts">
  import PhaseCTool from '$lib/PhaseCTool.svelte';
</script>

<PhaseCTool
  title="Remove Signature Background"
  operation="signature-background"
  accept=".png,image/png"
  description="Remove edge-connected near-background pixels from an 8-bit RGBA PNG signature photo locally."
/>

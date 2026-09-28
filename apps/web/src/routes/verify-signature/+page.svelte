<script lang="ts">
  import PhaseCTool from '$lib/PhaseCTool.svelte';
</script>

<PhaseCTool
  title="Verify Digital Signature"
  operation="verify-signature"
  description="Inspect PDF signature evidence locally. Add an explicit DER or PEM trust anchor when you want certificate-path verification; no root store is bundled."
/>

<script lang="ts">
  import PhaseCTool from '$lib/PhaseCTool.svelte';
</script>

<PhaseCTool
  title="Verify Digital Signature"
  operation="verify-signature"
  description="Inspect PDF signature evidence locally. Certificate-chain verification remains unsupported without a user-supplied trust anchor or dedicated verifier."
/>

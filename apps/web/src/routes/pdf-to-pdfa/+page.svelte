<script lang="ts">
  import ToolWorkspace from '$lib/ToolWorkspace.svelte';
</script>

<svelte:head
  ><title>Convert to PDF/A — reporting only, conversion not yet available</title></svelte:head
>
<ToolWorkspace
  title="PDF to PDF/A"
  eyebrow="STANDARDS"
  description="Check whether a PDF conforms to the PDF/A-1b, 2b, or 3b profile."
  unavailableReason="Checking is available; converting is not. A local PDF/A conformance report can be produced from an explicit per-check pass or fail, but no permissive browser writer can author a PDF/A file without re-encoding the whole document. This page therefore offers nothing rather than a button that would produce an ordinary PDF wearing a PDF/A label."
/>

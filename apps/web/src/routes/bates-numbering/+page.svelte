<script lang="ts">
  import ToolWorkspace from '$lib/ToolWorkspace.svelte';
  import { fieldsFor } from '$lib/tool-options';
</script>

<svelte:head><title>Bates numbering locally</title></svelte:head>
<ToolWorkspace
  title="Bates Numbering"
  eyebrow="DOCUMENT CONTROL"
  description="Add a prefix, padded sequence, suffix, and position to every page."
  options={fieldsFor('bates')}
/>

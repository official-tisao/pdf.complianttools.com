<script lang="ts">
  import ToolWorkspace from '$lib/ToolWorkspace.svelte';
  import { fieldsFor } from '$lib/tool-options';
</script>

<svelte:head><title>Rotate PDF pages locally</title></svelte:head>
<ToolWorkspace
  title="Rotate Pages"
  eyebrow="ORGANIZE"
  description="Rotate every page or a selected range in 90-degree steps."
  options={fieldsFor('rotate')}
/>

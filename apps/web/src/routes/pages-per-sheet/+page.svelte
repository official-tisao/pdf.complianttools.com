<script lang="ts">
  import ToolWorkspace from '$lib/ToolWorkspace.svelte';
  import { fieldsFor } from '$lib/tool-options';
</script>

<svelte:head><title>Pages per sheet locally</title></svelte:head>
<ToolWorkspace
  title="Pages Per Sheet"
  eyebrow="ORGANIZE"
  description="Impose 2, 4, 6, or 9 pages per sheet with booklet-aware ordering."
  options={fieldsFor('n-up')}
/>

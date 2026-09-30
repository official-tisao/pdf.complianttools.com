<script lang="ts">
  import ToolWorkspace from '$lib/ToolWorkspace.svelte';
</script>

<svelte:head><title>Bookmark editor — not yet available locally</title></svelte:head>
<ToolWorkspace
  title="Bookmark Editor"
  eyebrow="ORGANIZE"
  description="Add and edit a PDF's outline tree so its sections are navigable."
  unavailableReason="This tool is not offered yet. Reading a PDF's bookmarks works locally, but there is no permissive browser writer for the outline tree, so the editor cannot save one without round-tripping your document through something that would rewrite it. Your file is not read, uploaded, or modified on this page."
/>

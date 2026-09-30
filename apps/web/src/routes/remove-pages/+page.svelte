<script lang="ts">
  import ToolWorkspace from '$lib/ToolWorkspace.svelte';
  import { fieldsFor } from '$lib/tool-options';
  import { download, firstBytes, selector, type ToolValues } from '$lib/pdf-download';

  async function remove(files: File[], values: ToolValues) {
    const { removePages } = await import('@pdf-complianttools/engine');
    download(
      await removePages(await firstBytes(files), selector(values.pages)),
      'pages-removed.pdf',
    );
  }
</script>

<svelte:head><title>Remove PDF pages locally</title></svelte:head>
<ToolWorkspace
  title="Remove Pages"
  eyebrow="ORGANIZE"
  description="Delete the pages you select — ranges, lists, and odd/even selectors."
  options={fieldsFor('remove-pages')}
  actionLabel="Remove pages"
  onrun={remove}
/>

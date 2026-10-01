<script lang="ts">
  import ToolWorkspace from '$lib/ToolWorkspace.svelte';
  import { fieldsFor } from '$lib/tool-options';
  import { download, firstBytes, selector, type ToolValues } from '$lib/pdf-download';

  async function extract(files: File[], values: ToolValues) {
    const { extractPages } = await import('@pdf-complianttools/engine');
    download(await extractPages(await firstBytes(files), selector(values.pages)), 'extracted.pdf');
  }
</script>

<svelte:head><title>Extract PDF pages locally</title></svelte:head>
<ToolWorkspace
  title="Extract Pages"
  eyebrow="ORGANIZE"
  description="Keep only the pages you choose — ranges, lists, and odd/even selectors."
  options={fieldsFor('extract-pages')}
  actionKey="shell.action.extract"
  actionLabel="Extract pages"
  onrun={extract}
/>

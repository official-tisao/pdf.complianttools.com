<script lang="ts">
  import ToolWorkspace from '$lib/ToolWorkspace.svelte';
  import { fieldsFor } from '$lib/tool-options';
  import { download, firstBytes, numberOf, selector, type ToolValues } from '$lib/pdf-download';

  async function rotate(files: File[], values: ToolValues) {
    const { rotatePages } = await import('@pdf-complianttools/engine');
    download(
      await rotatePages(
        await firstBytes(files),
        selector(values.pages),
        numberOf(values.degrees, 90),
      ),
      'rotated.pdf',
    );
  }
</script>

<svelte:head><title>Rotate PDF locally</title></svelte:head>
<ToolWorkspace
  title="Rotate PDF"
  eyebrow="ORGANIZE"
  description="Rotate every page or a selection of pages, entirely in your browser."
  options={fieldsFor('rotate')}
  actionLabel="Rotate pages"
  onrun={rotate}
/>

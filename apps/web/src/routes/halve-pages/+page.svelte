<script lang="ts">
  import ToolWorkspace from '$lib/ToolWorkspace.svelte';
  import { fieldsFor } from '$lib/tool-options';
  import { download, firstBytes, numberOf, textOf, type ToolValues } from '$lib/pdf-download';

  async function halve(files: File[], values: ToolValues) {
    const { halvePages } = await import('@pdf-complianttools/engine');
    download(
      await halvePages(
        await firstBytes(files),
        textOf(values.direction, 'horizontal') === 'vertical' ? 'vertical' : 'horizontal',
        numberOf(values.threshold, 1.25),
      ),
      'halved.pdf',
    );
  }
</script>

<svelte:head><title>Halve PDF pages locally</title></svelte:head>
<ToolWorkspace
  title="Halve Pages"
  eyebrow="ORGANIZE"
  description="Split oversized pages in half along the long or short edge."
  options={fieldsFor('halve')}
  actionKey="shell.action.halve"
  actionLabel="Halve pages"
  onrun={halve}
/>

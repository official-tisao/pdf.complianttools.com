<script lang="ts">
  import ToolWorkspace from '$lib/ToolWorkspace.svelte';
  import { fieldsFor } from '$lib/tool-options';
  import { download, firstBytes, numberOf, textOf, type ToolValues } from '$lib/pdf-download';

  async function resize(files: File[], values: ToolValues) {
    const { resizePages } = await import('@pdf-complianttools/engine');
    const mode = textOf(values.mode, 'scale-to-fit');
    download(
      await resizePages(await firstBytes(files), {
        width: numberOf(values.width, 612),
        height: numberOf(values.height, 792),
        mode: mode === 'crop-to-fit' ? 'crop-to-fit' : 'scale-to-fit',
      }),
      'resized.pdf',
    );
  }
</script>

<svelte:head><title>Change PDF page size locally</title></svelte:head>
<ToolWorkspace
  title="Change Page Size"
  eyebrow="ORGANIZE"
  description="Set every page to a new size, scaling the content or cropping to fit."
  options={fieldsFor('resize')}
  actionKey="shell.action.resize"
  actionLabel="Change page size"
  onrun={resize}
/>

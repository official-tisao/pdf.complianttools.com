<script lang="ts">
  import ToolWorkspace from '$lib/ToolWorkspace.svelte';
  import { fieldsFor } from '$lib/tool-options';
  import { download, firstBytes, numberOf, selector, type ToolValues } from '$lib/pdf-download';

  async function crop(files: File[], values: ToolValues) {
    // pdf-lib is ~170 KB gzip, so the writer is loaded on the first crop
    // rather than on page load — the same treatment the merge route uses.
    const { cropPages } = await import('@pdf-complianttools/engine');
    download(
      await cropPages(
        await firstBytes(files),
        {
          left: numberOf(values.left),
          top: numberOf(values.top),
          right: numberOf(values.right),
          bottom: numberOf(values.bottom),
        },
        selector(values.pages),
      ),
      'cropped.pdf',
    );
  }
</script>

<svelte:head><title>Crop PDF locally</title></svelte:head>
<ToolWorkspace
  title="Crop PDF"
  eyebrow="ORGANIZE"
  description="Trim pages with numeric margins while keeping your original file untouched."
  options={fieldsFor('crop')}
  actionKey="shell.action.crop"
  actionLabel="Crop pages"
  onrun={crop}
/>

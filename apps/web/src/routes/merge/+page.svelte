<script lang="ts">
  import ToolWorkspace from '$lib/ToolWorkspace.svelte';
  import { fieldsFor } from '$lib/tool-options';

  async function merge(files: File[], values: Record<string, string | number | boolean>) {
    void values;
    // pdf-lib is ~170 KB gzip. The merge route is usable before a file is even
    // chosen, so the writer is loaded on the first merge rather than on page
    // load. This is the same treatment the invoice routes use.
    const { mergePdfBuffers } = await import('@pdf-complianttools/engine/merge');
    const result = await mergePdfBuffers(
      await Promise.all(files.map(async (file) => new Uint8Array(await file.arrayBuffer()))),
    );
    download(result, 'merged.pdf');
  }
  function download(bytes: Uint8Array, name: string) {
    const url = globalThis.URL.createObjectURL(
      new globalThis.Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' }),
    );
    const anchor = globalThis.document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    globalThis.URL.revokeObjectURL(url);
  }
</script>

<svelte:head><title>Merge PDF locally</title></svelte:head>
<ToolWorkspace
  title="Merge PDF"
  eyebrow="ORGANIZE"
  description="Combine files, preview the page order, and export one PDF without uploading your documents."
  options={fieldsFor('merge')}
  actionKey="shell.action.merge"
  actionLabel="Merge files"
  onrun={merge}
/>

<script lang="ts">
  import ToolWorkspace from '$lib/ToolWorkspace.svelte';
  import { mergePdfBuffers } from '@pdf-complianttools/engine';
  import { fieldsFor } from '$lib/tool-options';

  async function merge(files: File[], values: Record<string, string | number | boolean>) {
    void values;
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

<svelte:head
  ><title>Merge PDF locally</title><meta
    name="description"
    content="Combine PDF files locally in your browser."
  /></svelte:head
>
<ToolWorkspace
  title="Merge PDF"
  eyebrow="ORGANIZE"
  description="Combine files, preview the page order, and export one PDF without uploading your documents."
  options={fieldsFor('merge')}
  actionLabel="Merge files"
  onrun={merge}
/>

<script lang="ts">
  import ToolWorkspace from '$lib/ToolWorkspace.svelte';
  import { splitPdf } from '@pdf-complianttools/engine';
  import { fieldsFor } from '$lib/tool-options';
  async function split(files: File[], values: Record<string, string | number | boolean>) {
    const outputs = await splitPdf(new Uint8Array(await files[0].arrayBuffer()), {
      pagesPerFile: Number(values.pagesPerFile ?? 1),
    });
    outputs.forEach((bytes, index) => download(bytes, `split-${index + 1}.pdf`));
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

<svelte:head><title>Split PDF locally</title></svelte:head>
<ToolWorkspace
  title="Split PDF"
  eyebrow="ORGANIZE"
  description="Split a PDF by page count or ranges, entirely in your browser."
  options={fieldsFor('split')}
  actionLabel="Split PDF"
  onrun={split}
/>

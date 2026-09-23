<script lang="ts">
  import ToolWorkspace from '$lib/ToolWorkspace.svelte';
  import { compressPdf } from '@pdf-complianttools/engine';
  import { fieldsFor } from '$lib/tool-options';
  async function compress(files: File[], values: Record<string, string | number | boolean>) {
    const bytes = await compressPdf(new Uint8Array(await files[0].arrayBuffer()), {
      preset: String(values.preset ?? 'balanced'),
      quality: Number(values.quality ?? 75),
    });
    download(bytes, 'compressed.pdf');
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

<svelte:head><title>Compress PDF locally</title></svelte:head>
<ToolWorkspace
  title="Compress PDF"
  eyebrow="OPTIMIZE"
  description="Reduce PDF size with a bounded, local export and an honest quality preset."
  options={fieldsFor('compress')}
  actionLabel="Compress PDF"
  onrun={compress}
/>

<script lang="ts">
  import ToolWorkspace from '$lib/ToolWorkspace.svelte';
  import { compressPdf } from '@pdf-complianttools/engine';
  import { fieldsFor } from '$lib/tool-options';

  async function compress(files: File[], values: Record<string, string | number | boolean>) {
    const inputBytes = new Uint8Array(await files[0].arrayBuffer());
    const bytes = await compressPdf(inputBytes, {
      preset: String(values.preset ?? 'balanced'),
      quality: Number(values.quality ?? 75),
      stripMetadata: Boolean(values.stripMetadata),
      reencodeImage: reencodeJpeg,
    });
    download(bytes, 'compressed.pdf');
    const change = Math.round((1 - bytes.byteLength / inputBytes.byteLength) * 100);
    return `Compressed locally: ${formatBytes(inputBytes.byteLength)} → ${formatBytes(bytes.byteLength)} (${change >= 0 ? `${change}% smaller` : `${Math.abs(change)}% larger`}).`;
  }

  function formatBytes(value: number): string {
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  }

  async function reencodeJpeg(image: {
    bytes: Uint8Array;
    width: number;
    height: number;
    quality: number;
  }): Promise<Uint8Array | undefined> {
    if (typeof globalThis.createImageBitmap !== 'function') return undefined;
    const bitmap = await globalThis.createImageBitmap(
      new globalThis.Blob([image.bytes.buffer as ArrayBuffer], { type: 'image/jpeg' }),
    );
    try {
      const canvas = globalThis.document.createElement('canvas');
      canvas.width = image.width || bitmap.width;
      canvas.height = image.height || bitmap.height;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) return undefined;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const output = await new Promise<globalThis.Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', image.quality / 100),
      );
      return output ? new Uint8Array(await output.arrayBuffer()) : undefined;
    } finally {
      bitmap.close();
    }
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
  actionKey="shell.action.compress"
  actionLabel="Compress PDF"
  onrun={compress}
/>

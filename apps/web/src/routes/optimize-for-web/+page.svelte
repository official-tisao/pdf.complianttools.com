<script lang="ts">
  import ToolWorkspace from '$lib/ToolWorkspace.svelte';
  import { download, firstBytes } from '$lib/pdf-download';

  async function optimize(files: File[], values: Record<string, string | number | boolean>) {
    // `optimizeForWeb` is a thin wrapper over `compressPdf` with the balanced
    // preset, so that is called directly. The route deliberately does NOT take
    // the old `progressive` option: the engine ignored it, so a checkbox that
    // appeared to control it was a control that lied. Removing the option is
    // the honest fix; the underlying web preset is genuinely applied.
    void values;
    const { compressPdf } = await import('@pdf-complianttools/engine');
    download(
      await compressPdf(await firstBytes(files), { preset: 'balanced' }),
      'optimized-for-web.pdf',
    );
  }
</script>

<svelte:head><title>Optimize PDF for web locally</title></svelte:head>
<ToolWorkspace
  title="Web-Optimize PDF"
  eyebrow="ORGANIZE"
  description="Compress a PDF with the balanced preset for fast delivery over the web."
  options={[]}
  actionKey="shell.action.optimize"
  actionLabel="Optimize for web"
  onrun={optimize}
/>

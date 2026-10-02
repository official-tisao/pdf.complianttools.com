<script lang="ts">
  import ToolWorkspace from '$lib/ToolWorkspace.svelte';
  import { fieldsFor } from '$lib/tool-options';
  import { download, firstBytes } from '$lib/pdf-download';

  async function repair(files: File[]) {
    // `repairPdf` is called directly rather than through the recipe graph:
    // `applyGraphStep` has an empty arm for `repair` (graph.ts), so a recipe
    // step would silently do nothing.
    const { repairPdf } = await import('@pdf-complianttools/engine');
    download(await repairPdf(await firstBytes(files)), 'repaired.pdf');
  }
</script>

<svelte:head><title>Repair PDF locally</title></svelte:head>
<ToolWorkspace
  title="Repair PDF"
  eyebrow="ORGANIZE"
  description="Re-save a damaged PDF's object structure locally, or get a typed reason why it cannot."
  options={fieldsFor('repair')}
  actionKey="shell.action.repair"
  actionLabel="Repair PDF"
  onrun={repair}
/>

<script lang="ts">
  import ToolWorkspace from '$lib/ToolWorkspace.svelte';
  import { fieldsFor } from '$lib/tool-options';
  import { download, firstBytes, flag, type ToolValues } from '$lib/pdf-download';

  async function flatten(files: File[], values: ToolValues) {
    const { flattenPdf } = await import('@pdf-complianttools/engine');
    download(
      await flattenPdf(await firstBytes(files), { forms: flag(values.forms) }),
      'flattened.pdf',
    );
  }
</script>

<svelte:head><title>Flatten PDF locally</title></svelte:head>
<ToolWorkspace
  title="Flatten PDF"
  eyebrow="ORGANIZE"
  description="Bake form fields and annotations into page content so they can no longer be edited."
  options={fieldsFor('flatten')}
  actionLabel="Flatten PDF"
  onrun={flatten}
/>

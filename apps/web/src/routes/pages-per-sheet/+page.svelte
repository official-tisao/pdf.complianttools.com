<script lang="ts">
  import ToolWorkspace from '$lib/ToolWorkspace.svelte';
  import { fieldsFor } from '$lib/tool-options';
  import { download, firstBytes, flag, numberOf, type ToolValues } from '$lib/pdf-download';

  async function nUp(files: File[], values: ToolValues) {
    const { nUp: impose } = await import('@pdf-complianttools/engine');
    // The engine accepts 2, 4, 6 or 9 columns; the option is a string, so it
    // is narrowed here rather than passed through unchecked.
    const chosen = [2, 4, 6, 9].includes(numberOf(values.columns, 2))
      ? (numberOf(values.columns, 2) as 2 | 4 | 6 | 9)
      : 2;
    download(
      await impose(
        await firstBytes(files),
        chosen,
        numberOf(values.margin, 18),
        flag(values.booklet),
      ),
      'pages-per-sheet.pdf',
    );
  }
</script>

<svelte:head><title>Pages per sheet (N-up) locally</title></svelte:head>
<ToolWorkspace
  title="Pages Per Sheet"
  eyebrow="ORGANIZE"
  description="Impose several pages onto each sheet, optionally in booklet order."
  options={fieldsFor('n-up')}
  actionKey="shell.action.nup"
  actionLabel="Impose pages"
  onrun={nUp}
/>

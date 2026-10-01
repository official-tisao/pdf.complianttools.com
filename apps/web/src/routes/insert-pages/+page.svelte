<script lang="ts">
  import ToolWorkspace from '$lib/ToolWorkspace.svelte';
  import { fieldsFor } from '$lib/tool-options';
  import { download, numberOf, readBytes, type ToolValues } from '$lib/pdf-download';

  async function insert(files: File[], values: ToolValues) {
    const { insertBlankPages, insertPdfPages } = await import('@pdf-complianttools/engine');
    const index = numberOf(values.index, 1);
    const blanks = numberOf(values.blankPages, 0);
    // The first file is the document being edited. If further files were
    // chosen, the first of those is the PDF to insert at `index`; otherwise the
    // route inserts `blankPages` blanks at the same position.
    const [source, ...rest] = await readBytes(files);
    const output =
      rest.length > 0
        ? await insertPdfPages(source, rest[0], index)
        : blanks > 0
          ? await insertBlankPages(source, index, blanks)
          : source;
    download(output, 'pages-inserted.pdf');
  }
</script>

<svelte:head><title>Insert PDF pages locally</title></svelte:head>
<ToolWorkspace
  title="Insert Pages"
  eyebrow="ORGANIZE"
  description="Insert blank pages, or pages from another PDF, at any position."
  options={fieldsFor('insert')}
  actionKey="shell.action.insert"
  actionLabel="Insert pages"
  onrun={insert}
/>

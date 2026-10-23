<script lang="ts">
  import ToolWorkspace from '$lib/ToolWorkspace.svelte';
  import { fieldsFor } from '$lib/tool-options';
  import { download, firstBytes, numberOf, textOf, type ToolValues } from '$lib/pdf-download';

  const POSITIONS = [
    'top-left',
    'top-center',
    'top-right',
    'bottom-left',
    'bottom-center',
    'bottom-right',
  ] as const;

  const NUMBERING_TYPES = [
    'numeric',
    'roman-lowercase',
    'roman-uppercase',
    'alphabetical-lowercase',
  ] as const;

  const ALIGNMENTS = ['left', 'center', 'right'] as const;

  async function bates(files: File[], values: ToolValues) {
    const { addBatesNumbering } = await import('@pdf-complianttools/engine');
    const position = textOf(values.position, 'bottom-right');
    const numberingType = textOf(values.numberingType, 'numeric');
    const alignment = textOf(values.alignment, 'right');
    download(
      await addBatesNumbering(await firstBytes(files), {
        prefix: textOf(values.prefix),
        suffix: textOf(values.suffix),
        start: numberOf(values.start, 1),
        padding: numberOf(values.padding, 6),
        position: (POSITIONS as readonly string[]).includes(position) ? position : 'bottom-right',
        numberingType: (NUMBERING_TYPES as readonly string[]).includes(numberingType)
          ? numberingType
          : 'numeric',
        alignment: (ALIGNMENTS as readonly string[]).includes(alignment) ? alignment : 'right',
      }),
      'bates-numbered.pdf',
    );
  }
</script>

<svelte:head><title>Bates numbering locally</title></svelte:head>
<ToolWorkspace
  title="Bates Numbering"
  eyebrow="ORGANIZE"
  description="Stamp a sequential, configurable number on every page, entirely in your browser."
  options={fieldsFor('bates')}
  actionKey="shell.action.bates"
  actionLabel="Add Bates numbers"
  onrun={bates}
  singleFile
/>
